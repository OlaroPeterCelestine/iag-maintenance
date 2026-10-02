/**
 * Payment request approval chain — advances/rejects via Go API.
 * Finance Paid uses POST /api/approvals/.../settle (payment + Paid in one TX).
 */
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecordsAsync, notifyPersistFailure } from "@/lib/records-store";
import { getCurrentSessionUser } from "@/lib/session-profile";
import { parseAmount } from "@/lib/ledger/types";
import { postRecordToLedger } from "@/lib/ledger/api-post";
import { notifyRequestParties } from "@/lib/export/notify-request-email";
import { mutateApprovalViaApi, settleApprovalViaApi } from "@/lib/approval-api";
import {
  assertRequisitionChainStatusChange,
  canAdvanceRequisitionStatus,
  canAmendRequisitionStatus,
  canRejectRequisitionStatus,
  isAdminRole,
  requisitionAdvanceActionLabel,
  requisitionChainProgress,
  requisitionChainStage,
  requisitionChainWaitingOn,
  roleMatchesRequisitionStage,
  type RequisitionActionableStage,
  type RequisitionChainStage,
  REQUISITION_CHAIN_STATUSES_NO_PM,
} from "@/lib/requisition-chain";

const PAYMENT_REQUESTS_MODULE = "projects";
const PAYMENT_REQUESTS_ENTITY = "payment-requests";

export type PaymentChainStage = RequisitionChainStage;

export const PAYMENT_CHAIN_STATUSES = REQUISITION_CHAIN_STATUSES_NO_PM;

export { isAdminRole };

export function paymentChainStage(status: string): PaymentChainStage {
  return requisitionChainStage(status, PAYMENT_REQUESTS_ENTITY);
}

export function paymentChainWaitingOn(status: string): string {
  return requisitionChainWaitingOn(status, PAYMENT_REQUESTS_ENTITY);
}

export function paymentChainProgress(status: string) {
  return requisitionChainProgress(status, PAYMENT_REQUESTS_ENTITY);
}

export function roleMatchesPaymentStage(
  role: string,
  stage: RequisitionActionableStage | "requestor" | "dept-head",
): boolean {
  if (stage === "requestor" || stage === "dept-head") {
    return roleMatchesRequisitionStage(role, "accounts") || isAdminRole(role);
  }
  return roleMatchesRequisitionStage(role, stage);
}

export function canAdvancePaymentRequest(
  status: string,
  role = getCurrentSessionUser()?.role || "",
) {
  return canAdvanceRequisitionStatus(status, role, PAYMENT_REQUESTS_ENTITY);
}

export function canRejectPaymentRequest(
  status: string,
  role = getCurrentSessionUser()?.role || "",
): boolean {
  return canRejectRequisitionStatus(status, role, PAYMENT_REQUESTS_ENTITY);
}

export function canAmendPaymentRequest(
  status: string,
  role = getCurrentSessionUser()?.role || "",
  record?: Record<string, string | undefined | null> | null,
): boolean {
  return canAmendRequisitionStatus(status, role, PAYMENT_REQUESTS_ENTITY, record, getCurrentSessionUser());
}

function loadPaymentRequest(id: string): ManagerRecord | null {
  return (
    loadRecords(PAYMENT_REQUESTS_MODULE, PAYMENT_REQUESTS_ENTITY).find((row) => row.id === id) ||
    null
  );
}

export function assertPaymentRequestStatusChange(
  previousStatus: string | undefined,
  nextStatus: string,
): string | null {
  return assertRequisitionChainStatusChange(
    previousStatus,
    nextStatus,
    PAYMENT_REQUESTS_ENTITY,
  );
}

/**
 * Settle cash via Go only — never invent banking payments in the browser.
 * Prefer settleApprovalViaApi from Finance Paid; this helper is a thin wrapper
 * for callers that still pass a full request row.
 */
export async function settlePaymentRequestCash(
  request: ManagerRecord,
): Promise<{ ok: true; paymentId: string } | { ok: false; error: string }> {
  const amount = parseAmount(request.amount);
  if (amount <= 0) {
    return { ok: false, error: "Amount must be greater than zero before marking paid." };
  }
  const existingId = (request.paymentRecordId || "").trim();
  if (existingId) {
    const existing = loadRecords("banking", "payments").find((row) => row.id === existingId);
    if (existing) {
      const sync = await postRecordToLedger("banking", "payments", existing);
      if (!sync.ok) {
        return { ok: false, error: sync.error || "Could not post linked payment to the ledger." };
      }
      return { ok: true, paymentId: existing.id };
    }
  }

  const bankAccount = (
    request.bankAccount ||
    request.paidFrom ||
    ""
  ).trim();
  const paymentMethod = (request.paymentMethod || "").trim();
  if (!bankAccount || !paymentMethod) {
    return {
      ok: false,
      error:
        "Use Finance → Settle (Paid) with bank account and payment method. Cash settlement runs only on the Go API.",
    };
  }

  const settled = await settleApprovalViaApi(PAYMENT_REQUESTS_ENTITY, request.id, {
    paymentMethod,
    bankAccount,
    amount: String(amount),
  });
  if (!settled.ok) {
    return { ok: false, error: settled.error || "Settle API failed." };
  }
  const paymentId = (settled.paymentId || settled.record?.paymentRecordId || "").trim();
  if (!paymentId) {
    return {
      ok: false,
      error: "Settle API succeeded but did not return a banking payment id.",
    };
  }
  return { ok: true, paymentId };
}

export async function advancePaymentRequest(
  id: string,
  options?: {
    comment?: string;
    amount?: string;
    paymentMethod?: string;
    bankAccount?: string;
    forwardTo?: "ceo" | "finance";
  },
): Promise<{
  ok: boolean;
  error?: string;
  record?: ManagerRecord;
  nextStatus?: string;
  paymentId?: string;
  amended?: boolean;
}> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const existing = loadPaymentRequest(id);
  if (!existing) return { ok: false, error: "Payment request not found." };

  const user = getCurrentSessionUser();
  const gate = canAdvancePaymentRequest(existing.status || "", user?.role || "");
  if (!gate.ok || !gate.nextStatus) {
    return { ok: false, error: gate.reason || "Cannot advance this request." };
  }

  const comment = (options?.comment || "").trim();
  const amount = (options?.amount || "").trim();
  const paymentMethod = (options?.paymentMethod || "").trim();
  const bankAccount = (options?.bankAccount || "").trim();
  const forwardTo = options?.forwardTo;
  const amountChanging =
    Boolean(amount) &&
    String(parseAmount(amount)) !== String(parseAmount(existing.amount || "0"));

  // Finance Paid: Go creates/links banking payment + marks Paid atomically.
  // Amount changes are allowed at settle when a comment is provided.
  if (gate.stage === "finance") {
    const checkAmount = amount
      ? parseAmount(amount)
      : parseAmount(existing.amount);
    if (checkAmount <= 0) {
      return { ok: false, error: "Amount must be greater than zero before marking paid." };
    }
    if (!paymentMethod) {
      return { ok: false, error: "Select a payment method before making payment." };
    }
    if (!bankAccount) {
      return { ok: false, error: "Select the bank / cash account to pay from." };
    }
    if (amountChanging && !comment) {
      return {
        ok: false,
        error: "Add a comment when changing the amount at payment.",
      };
    }

    const settled = await settleApprovalViaApi(PAYMENT_REQUESTS_ENTITY, id, {
      paymentMethod,
      bankAccount,
      comment: comment || undefined,
      amount: amount || undefined,
    });
    if (!settled.ok || !settled.record) {
      return {
        ok: false,
        error: settled.error || "Settle API rejected this payment.",
      };
    }

    // Ledger is posted in the settle TX when the API supports it; repair only if not.
    if (settled.payment && !settled.ledgerPosted) {
      const repaired = await postRecordToLedger("banking", "payments", settled.payment);
      if (!repaired.ok) {
        notifyPersistFailure(
          "banking/payments",
          repaired.error ||
            `Payment request ${id} was marked Paid but the ledger repair posting failed.`,
        );
      }
    }

    notifyRequestParties({
      entityKey: PAYMENT_REQUESTS_ENTITY,
      record: settled.record,
      event: "paid",
      previousStatus: existing.status,
      comment: comment || undefined,
    });
    return {
      ok: true,
      record: settled.record,
      nextStatus: settled.nextStatus,
      paymentId: settled.paymentId,
    };
  }

  const api = await mutateApprovalViaApi(PAYMENT_REQUESTS_ENTITY, id, "advance", {
    comment: comment || undefined,
    amount: amount || undefined,
    forwardTo,
  });
  if (!api.ok || !api.record) {
    return {
      ok: false,
      error: api.error || "Approval API rejected this advance.",
    };
  }

  if (api.event === "amended") {
    notifyRequestParties({
      entityKey: PAYMENT_REQUESTS_ENTITY,
      record: api.record,
      event: "amended",
      previousStatus: existing.status,
      comment: comment || undefined,
    });
    return {
      ok: true,
      record: api.record,
      nextStatus: api.nextStatus,
      amended: true,
    };
  }

  let record = {
    ...api.record,
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(bankAccount ? { bankAccount, paidFrom: bankAccount } : {}),
  } as ManagerRecord;
  let paymentId: string | undefined;
  // Safety net if Paid arrived without a prior settle (should be rare after settle TX).
  if (/^paid$/i.test(api.nextStatus || "")) {
    const cash = await settlePaymentRequestCash(record);
    if (!cash.ok) {
      return { ok: false, error: cash.error, record, nextStatus: api.nextStatus };
    }
    paymentId = cash.paymentId;
    record = { ...record, paymentRecordId: paymentId, paymentId };
    const rows = loadRecords(PAYMENT_REQUESTS_MODULE, PAYMENT_REQUESTS_ENTITY);
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) {
      const next = [...rows];
      next[index] = record;
      const linked = await saveRecordsAsync(
        PAYMENT_REQUESTS_MODULE,
        PAYMENT_REQUESTS_ENTITY,
        next,
      );
      if (!linked.ok) {
        return {
          ok: false,
          error: linked.error || "Payment created but request link failed to save.",
          record,
          nextStatus: api.nextStatus,
          paymentId,
        };
      }
    }
  }

  notifyRequestParties({
    entityKey: PAYMENT_REQUESTS_ENTITY,
    record,
    event: /^paid$/i.test(api.nextStatus || "") ? "paid" : "advanced",
    previousStatus: existing.status,
    comment: comment || undefined,
  });

  return { ok: true, record, nextStatus: api.nextStatus, paymentId };
}

export async function rejectPaymentRequest(
  id: string,
  options?: { comment?: string; amount?: string },
): Promise<{
  ok: boolean;
  error?: string;
  record?: ManagerRecord;
}> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const existing = loadPaymentRequest(id);
  if (!existing) return { ok: false, error: "Payment request not found." };

  const user = getCurrentSessionUser();
  if (!canRejectPaymentRequest(existing.status || "", user?.role || "")) {
    return {
      ok: false,
      error: `Waiting on ${paymentChainWaitingOn(existing.status || "")}. Your role cannot reject this step.`,
    };
  }

  const comment = (options?.comment || "").trim();
  if (!comment) {
    return {
      ok: false,
      error: "A reason is required when rejecting a request so the requestor knows what went wrong.",
    };
  }
  const amount = (options?.amount || "").trim();
  const api = await mutateApprovalViaApi(PAYMENT_REQUESTS_ENTITY, id, "reject", {
    comment,
    amount: amount || undefined,
  });
  if (!api.ok || !api.record) {
    return { ok: false, error: api.error || "Approval API rejected this reject." };
  }

  notifyRequestParties({
    entityKey: PAYMENT_REQUESTS_ENTITY,
    record: api.record,
    event: "rejected",
    previousStatus: existing.status,
    comment,
  });

  return { ok: true, record: api.record };
}

export async function amendPaymentRequest(
  id: string,
  options?: { comment?: string; amount?: string; returnMode?: "previous" },
): Promise<{
  ok: boolean;
  error?: string;
  record?: ManagerRecord;
}> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const existing = loadPaymentRequest(id);
  if (!existing) return { ok: false, error: "Payment request not found." };

  const user = getCurrentSessionUser();
  if (!canAmendPaymentRequest(existing.status || "", user?.role || "", existing)) {
    return {
      ok: false,
      error: `Waiting on ${paymentChainWaitingOn(existing.status || "")}. Your role cannot amend this step.`,
    };
  }

  const comment = (options?.comment || "").trim();
  if (!comment) {
    return {
      ok: false,
      error: "A comment is required when amending a request so the previous user knows what to change.",
    };
  }

  const amount = (options?.amount || "").trim();
  const api = await mutateApprovalViaApi(PAYMENT_REQUESTS_ENTITY, id, "amend", {
    comment,
    amount: amount || undefined,
    returnMode: options?.returnMode,
  });
  if (!api.ok || !api.record) {
    return { ok: false, error: api.error || "Approval API rejected this amend." };
  }

  notifyRequestParties({
    entityKey: PAYMENT_REQUESTS_ENTITY,
    record: api.record,
    event: "amended",
    previousStatus: existing.status,
    comment,
  });

  return { ok: true, record: api.record };
}

export function advanceActionLabel(status: string): string {
  return requisitionAdvanceActionLabel(status);
}
