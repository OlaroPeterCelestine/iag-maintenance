"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeOwnPassword } from "@/lib/auth-api";
import {
  AUTH_CHANGED_EVENT,
  clearMustChangePasswordFlag,
  getKeepSignedInPreference,
  logout,
  readAuthSession,
  writeAuthSession,
} from "@/lib/auth";
import {
  evaluatePasswordStrength,
  suggestStrongPassword,
  validateStrongPassword,
  type PasswordStrength,
} from "@/lib/password-strength";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, Sparkles } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  required,
  defaultVisible = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  disabled?: boolean;
  required?: boolean;
  defaultVisible?: boolean;
}) {
  const [visible, setVisible] = useState(defaultVisible);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          disabled={disabled}
          className="pr-10"
        />
        <button
          type="button"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-800"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          tabIndex={-1}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function StrengthMeter({ strength }: { strength: PasswordStrength }) {
  const tones = [
    "bg-slate-200",
    "bg-rose-400",
    "bg-amber-400",
    "bg-lime-500",
    "bg-emerald-500",
  ] as const;
  const labelTone = [
    "text-slate-500",
    "text-rose-700",
    "text-amber-700",
    "text-lime-700",
    "text-emerald-700",
  ] as const;

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
          Password strength
        </p>
        <p className={cn("text-[12px] font-semibold", labelTone[strength.score])}>
          {strength.label}
        </p>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((step) => (
          <div
            key={step}
            className={cn(
              "h-1.5 rounded-full",
              strength.score >= step ? tones[strength.score] : "bg-slate-200",
            )}
          />
        ))}
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {strength.checks.map((check) => (
          <li
            key={check.id}
            className={cn(
              "text-[11px]",
              check.ok ? "text-emerald-700" : "text-slate-500",
            )}
          >
            {check.ok ? "✓" : "○"} {check.label}
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-relaxed text-slate-600">
        Recommended: 10+ characters with upper, lower, number, and a symbol. Avoid
        common words and anything reused from another system.
      </p>
    </div>
  );
}

export function ChangePasswordForm({
  forced = false,
  monthly = false,
  onSuccess,
  submitLabel = "Update password",
}: {
  forced?: boolean;
  monthly?: boolean;
  onSuccess?: () => void;
  submitLabel?: string;
}) {
  const baseId = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const strength = useMemo(
    () => evaluatePasswordStrength(newPassword),
    [newPassword],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setDone(false);
    if (!newPassword.trim()) {
      setError("New password is required");
      return;
    }
    const strengthError = validateStrongPassword(newPassword);
    if (strengthError) {
      setError(strengthError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match");
      return;
    }
    if (currentPassword && newPassword === currentPassword) {
      setError("New password must be different from your current password");
      return;
    }
    setBusy(true);
    try {
      await changeOwnPassword({ currentPassword, newPassword });
      clearMustChangePasswordFlag();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setDone(true);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      {forced ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          {monthly
            ? "It has been about a month since your last password update. Choose a strong new password to continue — you will not be asked again until next month."
            : "An administrator asked you to set a new password before continuing. Choose a strong password you have not used elsewhere. After you save, this prompt appears only once a month."}
        </p>
      ) : null}
      <PasswordField
        id={`${baseId}-current`}
        label="Current password"
        value={currentPassword}
        onChange={setCurrentPassword}
        autoComplete="current-password"
        required
        disabled={busy}
      />
      <PasswordField
        id={`${baseId}-new`}
        label="New password"
        value={newPassword}
        onChange={setNewPassword}
        autoComplete="new-password"
        required
        disabled={busy}
        defaultVisible
      />
      <StrengthMeter strength={strength} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          className="gap-1.5"
          onClick={() => {
            const suggestion = suggestStrongPassword();
            setNewPassword(suggestion);
            setConfirmPassword(suggestion);
            setError("");
            setDone(false);
          }}
        >
          <Sparkles className="size-3.5" />
          Suggest strong password
        </Button>
      </div>
      <PasswordField
        id={`${baseId}-confirm`}
        label="Confirm new password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        autoComplete="new-password"
        required
        disabled={busy}
        defaultVisible
      />
      {error ? (
        <p className="text-[12px] font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {done && !forced ? (
        <p className="text-[12px] font-medium text-emerald-700">Password updated.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" disabled={busy || (!!newPassword && !strength.ok)} className="min-w-28">
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Blocking dialog when the signed-in user must rotate their password. */
export function ForceChangePasswordDialog() {
  const [open, setOpen] = useState(false);
  const [monthlyDue, setMonthlyDue] = useState(false);

  const syncFromSession = useCallback(() => {
    const session = readAuthSession();
    if (session?.mustChangePassword) {
      setOpen(true);
    }
  }, []);

  const syncFromServer = useCallback(async () => {
    try {
      const { fetchAuthMe } = await import("@/lib/auth-api");
      const me = await fetchAuthMe();
      const session = readAuthSession();
      if (!session) return;
      if (me.mustChangePassword) {
        const monthly = !me.passwordChangeForced;
        setMonthlyDue(monthly);
        if (!session.mustChangePassword) {
          writeAuthSession(
            { ...session, mustChangePassword: true },
            getKeepSignedInPreference(),
          );
        }
        setOpen(true);
      } else if (session.mustChangePassword) {
        clearMustChangePasswordFlag();
        setMonthlyDue(false);
        setOpen(false);
      } else {
        setMonthlyDue(false);
        setOpen(false);
      }
    } catch {
      /* keep local flag */
    }
  }, []);

  useEffect(() => {
    syncFromSession();
    void syncFromServer();
    window.addEventListener(AUTH_CHANGED_EVENT, syncFromSession);
    window.addEventListener("storage", syncFromSession);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncFromServer();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, syncFromSession);
      window.removeEventListener("storage", syncFromSession);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncFromSession, syncFromServer]);

  return (
    <Dialog
      open={open}
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next) return;
        setOpen(next);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change your password</DialogTitle>
          <DialogDescription>
            {monthlyDue
              ? "For security, update your password once a month. After you save, this prompt will not appear again until next month."
              : "Choose a strong password to finish signing in. You will only be asked again once a month, or if an administrator resets your password."}
          </DialogDescription>
        </DialogHeader>
        <ChangePasswordForm
          forced
          monthly={monthlyDue}
          submitLabel="Save and continue"
          onSuccess={() => {
            clearMustChangePasswordFlag();
            setMonthlyDue(false);
            setOpen(false);
          }}
        />
        <DialogFooter className="sm:justify-start">
          <Button type="button" variant="ghost" size="sm" onClick={() => logout()}>
            Sign out instead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
