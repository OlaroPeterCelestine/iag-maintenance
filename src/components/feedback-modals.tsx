"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { bankAccountSelectOptions } from "@/lib/ledger/chart-of-accounts";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export type SuccessFeedback = {
  kind: "success";
  title: string;
  message: string;
  undoLabel?: string;
  onUndo?: () => void;
  /** Fired when the success modal is dismissed (OK / overlay). */
  onDismiss?: () => void;
  /** When true (default for inserts), show a modal. Toast-only when false. */
  modal?: boolean;
  /** Auto-dismiss success modal (ms). Default 900. */
  autoCloseMs?: number;
};

export type ConfirmExtras = {
  comment?: string;
  /** Revised amount entered in the confirm dialog (string as typed). */
  amount?: string;
  /** How Finance is paying (Cash, Bank transfer, …). */
  paymentMethod?: string;
  /** Bank / cash account the payment is paid from. */
  bankAccount?: string;
};

/** Options shown when Finance marks a request Paid. */
export const REQUEST_PAYMENT_METHODS = [
  "Cash",
  "Bank transfer",
  "Mobile money",
  "Cheque",
  "Other",
] as const;

export type WarningFeedback = {
  kind: "warning";
  title: string;
  message: string;
  /** If set, show Cancel + Confirm (destructive). Otherwise a single OK. */
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Optional comment/reason textarea (e.g. rejection / approval notes). */
  commentLabel?: string;
  commentPlaceholder?: string;
  commentRequired?: boolean;
  /** Optional amount field so approvers can revise figures before confirming. */
  amountLabel?: string;
  amountValue?: string;
  amountCurrency?: string;
  amountRequired?: boolean;
  /** Optional payment method select (Make payment). */
  paymentMethodLabel?: string;
  paymentMethodOptions?: readonly string[];
  paymentMethodValue?: string;
  paymentMethodRequired?: boolean;
  /** Optional paid-from bank/cash account (Make payment). */
  bankAccountLabel?: string;
  bankAccountValue?: string;
  bankAccountRequired?: boolean;
  onConfirm?: (comment?: string, extras?: ConfirmExtras) => void;
  /** Fired when the user dismisses/cancels without confirming. */
  onCancel?: () => void;
};

export type Feedback = SuccessFeedback | WarningFeedback | null;

function pushSuccessToast(
  title: string,
  message: string,
  options?: { undoLabel?: string; onUndo?: () => void },
) {
  const requestLike =
    /request|advanced|approved|rejected|paid|issued|submitted|ipc/i.test(
      `${title} ${message}`,
    );
  toast.add({
    title,
    description: message,
    type: "success",
    // Request/approval feedback stays on screen longer so the popup is readable.
    timeout: options?.onUndo ? 4500 : requestLike ? 4800 : 1600,
    actionProps: options?.onUndo
      ? {
          children: options.undoLabel ?? "Undo",
          onClick: () => options.onUndo?.(),
        }
      : undefined,
  });
}

function pushWarningToast(title: string, message: string) {
  toast.add({
    title,
    description: message,
    type: "warning",
    timeout: 3000,
  });
}

/** @deprecated Prefer showSuccess — kept for direct imports. */
export function SuccessToast({
  open,
  title,
  message,
  onClose,
  undoLabel = "Undo",
  onUndo,
}: {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
  autoCloseMs?: number;
  undoLabel?: string;
  onUndo?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    pushSuccessToast(title, message, { undoLabel, onUndo });
    onClose();
  }, [open, title, message, undoLabel, onUndo, onClose]);
  return null;
}

/** Confirm / blocking alert via Alert Dialog. */
export function WarningModal({
  open,
  title,
  message,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  danger = false,
  commentLabel,
  commentPlaceholder,
  commentRequired = false,
  amountLabel,
  amountValue = "",
  amountCurrency = "UGX",
  amountRequired = false,
  paymentMethodLabel,
  paymentMethodOptions = REQUEST_PAYMENT_METHODS,
  paymentMethodValue = "",
  paymentMethodRequired = false,
  bankAccountLabel,
  bankAccountValue = "",
  bankAccountRequired = false,
  onConfirm,
  onCancel,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  commentLabel?: string;
  commentPlaceholder?: string;
  commentRequired?: boolean;
  amountLabel?: string;
  amountValue?: string;
  amountCurrency?: string;
  amountRequired?: boolean;
  paymentMethodLabel?: string;
  paymentMethodOptions?: readonly string[];
  paymentMethodValue?: string;
  paymentMethodRequired?: boolean;
  bankAccountLabel?: string;
  bankAccountValue?: string;
  bankAccountRequired?: boolean;
  onConfirm?: (comment?: string, extras?: ConfirmExtras) => void;
  onCancel?: () => void;
  onClose: () => void;
}) {
  const needsConfirm = Boolean(onConfirm);
  const showComment = Boolean(commentLabel);
  const showAmount = Boolean(amountLabel);
  const showPaymentMethod = Boolean(paymentMethodLabel);
  const showBankAccount = Boolean(bankAccountLabel);
  const confirmedRef = useRef(false);
  const pendingConfirmRef = useRef<(() => void) | null>(null);
  const [comment, setComment] = useState("");
  const [amount, setAmount] = useState(amountValue);
  const [paymentMethod, setPaymentMethod] = useState(paymentMethodValue);
  const [bankAccount, setBankAccount] = useState(bankAccountValue);
  const [bankOptions, setBankOptions] = useState<{ value: string; label: string }[]>(() =>
    typeof window === "undefined" ? [] : bankAccountSelectOptions(),
  );
  const [fieldError, setFieldError] = useState("");
  const buttonClass =
    "h-9 min-w-[96px] flex-1 px-4 text-[13px] sm:flex-none";
  const wideForm = showComment || showAmount || showPaymentMethod || showBankAccount;

  useEffect(() => {
    if (!open) {
      setComment("");
      setAmount(amountValue);
      setPaymentMethod(paymentMethodValue);
      setBankAccount(bankAccountValue);
      setFieldError("");
      return;
    }
    setAmount(amountValue);
    setPaymentMethod(paymentMethodValue);
    setBankAccount(bankAccountValue);
    setComment("");
    setFieldError("");
    if (showBankAccount) {
      setBankOptions(bankAccountSelectOptions());
    }
  }, [open, amountValue, paymentMethodValue, bankAccountValue, showBankAccount]);

  function validateFields(): boolean {
    if (showComment && commentRequired && !comment.trim()) {
      setFieldError("Please add a comment before continuing.");
      return false;
    }
    if (showPaymentMethod && paymentMethodRequired && !paymentMethod.trim()) {
      setFieldError("Select a payment method before continuing.");
      return false;
    }
    if (showBankAccount && bankAccountRequired && !bankAccount.trim()) {
      setFieldError("Select the bank / cash account to pay from.");
      return false;
    }
    if (showAmount && amountRequired && !String(amount).trim()) {
      setFieldError("Please enter an amount before continuing.");
      return false;
    }
    if (showAmount && String(amount).trim()) {
      const n = Number(String(amount).replace(/,/g, "").trim());
      if (!Number.isFinite(n) || n < 0) {
        setFieldError("Enter a valid amount (0 or greater).");
        return false;
      }
    }
    return true;
  }

  function submitConfirm() {
    if (!validateFields()) return;
    const note = comment.trim();
    const extras: ConfirmExtras = {
      comment: note || undefined,
      amount: String(amount).trim() || undefined,
      paymentMethod: paymentMethod.trim() || undefined,
      bankAccount: bankAccount.trim() || undefined,
    };
    // Run the action after close. Do NOT rely only on AlertDialog onOpenChange —
    // clearing FeedbackModals host state unmounts this dialog, and Base UI may
    // never emit onOpenChange(false), which made Confirm look like a no-op.
    confirmedRef.current = true;
    pendingConfirmRef.current = null;
    onClose();
    queueMicrotask(() => onConfirm?.(note || undefined, extras));
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          const confirmed = confirmedRef.current;
          const pending = pendingConfirmRef.current;
          confirmedRef.current = false;
          pendingConfirmRef.current = null;
          // Clear host state immediately so portaled overlays cannot follow route changes.
          onClose();
          if (confirmed) {
            // submitConfirm already queued onConfirm — only run a leftover pending
            // from other close paths (e.g. legacy AlertDialogAction).
            if (pending) queueMicrotask(() => pending());
          } else {
            onCancel?.();
          }
        }
      }}
    >
      <AlertDialogContent
        size={wideForm ? "default" : "sm"}
        className={cn(
          "w-[min(100vw-2rem,22rem)] gap-0 p-0 sm:max-w-[22rem]",
          wideForm &&
            "max-h-[min(90vh,40rem)] w-[min(100vw-1.5rem,28rem)] overflow-y-auto sm:max-w-[28rem]",
        )}
      >
        <div className="px-5 pt-5 pb-4">
          <AlertDialogHeader className="place-items-center gap-2 text-center sm:place-items-center sm:text-center">
            <AlertDialogMedia
              className={cn(
                "mb-1 size-11 rounded-full",
                danger
                  ? "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                  : "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
              )}
            >
              <AlertTriangle size={22} strokeWidth={2} />
            </AlertDialogMedia>
            <AlertDialogTitle className="text-[15px] font-semibold tracking-tight text-slate-900">
              {title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-[12.5px] leading-relaxed text-slate-500">
              {message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {showPaymentMethod ? (
            <div className="mt-4 text-left">
              <label className="mb-1.5 block text-[12px] font-medium text-slate-700">
                {paymentMethodLabel}
                {paymentMethodRequired ? (
                  <span className="text-rose-600"> *</span>
                ) : null}
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => {
                  setPaymentMethod(e.target.value);
                  if (fieldError) setFieldError("");
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none focus:border-slate-400"
              >
                <option value="">Select payment method…</option>
                {paymentMethodOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {showBankAccount ? (
            <div className={cn("text-left", showPaymentMethod ? "mt-3" : "mt-4")}>
              <label className="mb-1.5 block text-[12px] font-medium text-slate-700">
                {bankAccountLabel}
                {bankAccountRequired ? (
                  <span className="text-rose-600"> *</span>
                ) : null}
              </label>
              <select
                value={bankAccount}
                onChange={(e) => {
                  setBankAccount(e.target.value);
                  if (fieldError) setFieldError("");
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none focus:border-slate-400"
              >
                <option value="">Select bank / cash account…</option>
                {bankOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {!bankOptions.length ? (
                <p className="mt-1.5 text-[11px] text-amber-700">
                  Add accounts under Banking → Bank &amp; Cash Accounts first.
                </p>
              ) : null}
            </div>
          ) : null}
          {showAmount ? (
            <div
              className={cn(
                "text-left",
                showPaymentMethod || showBankAccount ? "mt-3" : "mt-4",
              )}
            >
              <label className="mb-1.5 block text-[12px] font-medium text-slate-700">
                {amountLabel}
                {amountRequired ? (
                  <span className="text-rose-600"> *</span>
                ) : (
                  <span className="font-normal text-slate-400">
                    {" "}
                    (adjust to revise)
                  </span>
                )}
              </label>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[12px] font-medium text-slate-500">
                  {amountCurrency}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (fieldError) setFieldError("");
                  }}
                  placeholder="0"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-slate-400"
                />
              </div>
              {amountValue.trim() ? (
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Original / current figure: {amountCurrency} {amountValue.trim()}
                </p>
              ) : null}
            </div>
          ) : null}
          {showComment ? (
            <div
              className={cn(
                "text-left",
                showAmount || showPaymentMethod || showBankAccount ? "mt-3" : "mt-4",
              )}
            >
              <label className="mb-1.5 block text-[12px] font-medium text-slate-700">
                {commentLabel}
                {commentRequired ? (
                  <span className="text-rose-600"> *</span>
                ) : (
                  <span className="font-normal text-slate-400"> (optional)</span>
                )}
              </label>
              <textarea
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  if (fieldError) setFieldError("");
                }}
                rows={3}
                placeholder={commentPlaceholder || "Add a note for the parties involved…"}
                className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-slate-400"
              />
            </div>
          ) : null}
          {fieldError ? (
            <p className="mt-2 text-left text-[12px] text-rose-600">{fieldError}</p>
          ) : null}
        </div>
        <AlertDialogFooter
          className={cn(
            "sticky bottom-0 mx-0 mb-0 grid grid-cols-2 gap-2 rounded-none border-t border-slate-100 bg-slate-50/95 p-3 sm:flex sm:flex-row sm:justify-end",
            !needsConfirm && "grid-cols-1 sm:justify-center",
          )}
        >
          {needsConfirm ? (
            <>
              <AlertDialogCancel
                size="default"
                variant="outline"
                className={cn(buttonClass, "border-slate-200 bg-white shadow-none")}
              >
                {cancelLabel}
              </AlertDialogCancel>
              {/* Regular Button (not Close) so failed validation keeps the dialog open. */}
              <Button
                type="button"
                size="default"
                className={cn(
                  buttonClass,
                  danger
                    ? "bg-rose-600 text-white hover:bg-rose-700"
                    : "bg-slate-900 text-white hover:bg-slate-800",
                )}
                onClick={submitConfirm}
              >
                {confirmLabel}
              </Button>
            </>
          ) : (
            <AlertDialogAction
              size="default"
              className={cn(buttonClass, "bg-slate-900 text-white hover:bg-slate-800")}
              onClick={() => onClose()}
            >
              OK
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Success confirmation modal (used after insert / durable saves). */
export function SuccessModal({
  open,
  title,
  message,
  onClose,
  autoCloseMs = 900,
  undoLabel = "Undo",
  onUndo,
  onDismiss,
}: {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
  /** Auto-dismiss after this many ms (0 = stay until OK). */
  autoCloseMs?: number;
  undoLabel?: string;
  onUndo?: () => void;
  onDismiss?: () => void;
}) {
  const buttonClass =
    "h-9 min-w-[96px] flex-1 px-4 text-[13px] sm:flex-none";
  const skipFollowUpRef = useRef(false);

  useEffect(() => {
    if (!open || !autoCloseMs || autoCloseMs <= 0) return;
    const timer = window.setTimeout(() => {
      skipFollowUpRef.current = true;
      onClose();
    }, autoCloseMs);
    return () => window.clearTimeout(timer);
  }, [open, autoCloseMs, onClose]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          const followUp = !skipFollowUpRef.current;
          skipFollowUpRef.current = false;
          onClose();
          if (followUp && onDismiss) queueMicrotask(() => onDismiss());
        }
      }}
    >
      <AlertDialogContent
        size="sm"
        className="w-[min(100vw-2rem,22rem)] gap-0 overflow-hidden p-0 sm:max-w-[22rem]"
        data-testid="success-modal"
      >
        <div className="px-5 pt-5 pb-4">
          <AlertDialogHeader className="place-items-center gap-2 text-center sm:place-items-center sm:text-center">
            <AlertDialogMedia className="mb-1 size-11 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
              <CheckCircle2 size={22} strokeWidth={2} />
            </AlertDialogMedia>
            <AlertDialogTitle className="text-[15px] font-semibold tracking-tight text-slate-900">
              {title}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-[12.5px] leading-relaxed text-slate-500">
              {message}
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        <AlertDialogFooter
          className={cn(
            "mx-0 mb-0 gap-2 rounded-none border-t border-slate-100 bg-slate-50/80 p-3",
            onUndo ? "grid grid-cols-2 sm:flex sm:flex-row sm:justify-end" : "grid grid-cols-1 sm:justify-center",
          )}
        >
          {onUndo ? (
            <>
              <AlertDialogCancel
                size="default"
                variant="outline"
                className={cn(buttonClass, "border-slate-200 bg-white shadow-none")}
                onClick={() => {
                  skipFollowUpRef.current = true;
                  const fn = onUndo;
                  queueMicrotask(() => fn?.());
                }}
              >
                {undoLabel}
              </AlertDialogCancel>
              <AlertDialogAction
                size="default"
                className={cn(buttonClass, "bg-emerald-600 text-white hover:bg-emerald-700")}
              >
                OK
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction
              size="default"
              className={cn(
                buttonClass,
                "mx-auto max-w-[140px] bg-emerald-600 text-white hover:bg-emerald-700",
              )}
            >
              OK
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function FeedbackModals({
  feedback,
  onClose,
}: {
  feedback: Feedback;
  onClose: () => void;
}) {
  if (!feedback) return null;

  if (feedback.kind === "success") {
    return (
      <SuccessModal
        open
        title={feedback.title}
        message={feedback.message}
        undoLabel={feedback.undoLabel}
        onUndo={feedback.onUndo}
        onDismiss={feedback.onDismiss}
        autoCloseMs={feedback.autoCloseMs}
        onClose={onClose}
      />
    );
  }

  return (
    <WarningModal
      open
      title={feedback.title}
      message={feedback.message}
      confirmLabel={feedback.confirmLabel}
      cancelLabel={feedback.cancelLabel}
      danger={feedback.danger}
      commentLabel={feedback.commentLabel}
      commentPlaceholder={feedback.commentPlaceholder}
      commentRequired={feedback.commentRequired}
      amountLabel={feedback.amountLabel}
      amountValue={feedback.amountValue}
      amountCurrency={feedback.amountCurrency}
      amountRequired={feedback.amountRequired}
      paymentMethodLabel={feedback.paymentMethodLabel}
      paymentMethodOptions={feedback.paymentMethodOptions}
      paymentMethodValue={feedback.paymentMethodValue}
      paymentMethodRequired={feedback.paymentMethodRequired}
      bankAccountLabel={feedback.bankAccountLabel}
      bankAccountValue={feedback.bankAccountValue}
      bankAccountRequired={feedback.bankAccountRequired}
      onConfirm={feedback.onConfirm}
      onCancel={feedback.onCancel}
      onClose={onClose}
    />
  );
}

export function useFeedbackModals() {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const pathname = usePathname();

  const close = useCallback(() => setFeedback(null), []);

  // Soft navigations keep portals mounted if state isn't cleared — dismiss on route change.
  useEffect(() => {
    setFeedback(null);
  }, [pathname]);

  const showSuccess = useCallback(
    (
      title: string,
      message: string,
      options?: {
        undoLabel?: string;
        onUndo?: () => void;
        onDismiss?: () => void;
        /** @deprecated Ignored — every success now renders as a modal. */
        modal?: boolean;
        /** 0 (default) keeps the modal until the user acknowledges it. */
        autoCloseMs?: number;
      },
    ) => {
      // Every successful insert / import / edit / delete is confirmed with a
      // blocking modal the user acknowledges, so a save can never be missed.
      // The route-change effect above clears it, which is what previously made
      // success modals linger and stack on top of the next page.
      setFeedback({
        kind: "success",
        title,
        message,
        undoLabel: options?.undoLabel,
        onUndo: options?.onUndo,
        onDismiss: options?.onDismiss,
        // Stay until acknowledged unless a caller opts into auto-dismiss.
        autoCloseMs: options?.autoCloseMs ?? 0,
      });
    },
    [],
  );

  const showWarning = useCallback(
    (title: string, message: string, options?: { toast?: boolean }) => {
      // Soft follow-up after a success modal — don't replace it.
      if (options?.toast) {
        pushWarningToast(title, message);
        return;
      }
      // Always use the in-app pop modal — never window.alert / browser dialogs.
      setFeedback({
        kind: "warning",
        title,
        message,
      });
    },
    [],
  );

  const askConfirm = useCallback(
    (options: {
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
      commentLabel?: string;
      commentPlaceholder?: string;
      commentRequired?: boolean;
      amountLabel?: string;
      amountValue?: string;
      amountCurrency?: string;
      amountRequired?: boolean;
      paymentMethodLabel?: string;
      paymentMethodOptions?: readonly string[];
      paymentMethodValue?: string;
      paymentMethodRequired?: boolean;
      bankAccountLabel?: string;
      bankAccountValue?: string;
      bankAccountRequired?: boolean;
      onConfirm: (comment?: string, extras?: ConfirmExtras) => void;
      onCancel?: () => void;
    }) => {
      setFeedback({
        kind: "warning",
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? "Delete",
        cancelLabel: options.cancelLabel ?? "Cancel",
        danger: options.danger ?? true,
        commentLabel: options.commentLabel,
        commentPlaceholder: options.commentPlaceholder,
        commentRequired: options.commentRequired,
        amountLabel: options.amountLabel,
        amountValue: options.amountValue,
        amountCurrency: options.amountCurrency,
        amountRequired: options.amountRequired,
        paymentMethodLabel: options.paymentMethodLabel,
        paymentMethodOptions: options.paymentMethodOptions,
        paymentMethodValue: options.paymentMethodValue,
        paymentMethodRequired: options.paymentMethodRequired,
        bankAccountLabel: options.bankAccountLabel,
        bankAccountValue: options.bankAccountValue,
        bankAccountRequired: options.bankAccountRequired,
        onConfirm: options.onConfirm,
        onCancel: options.onCancel,
      });
    },
    [],
  );

  return {
    feedback,
    close,
    showSuccess,
    showWarning,
    askConfirm,
    FeedbackHost: () => <FeedbackModals feedback={feedback} onClose={close} />,
  };
}
