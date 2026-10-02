"use client";

import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  requestPasswordReset,
  resetPasswordWithToken,
  verifyPasswordResetOTP,
} from "@/lib/auth-api";
import {
  evaluatePasswordStrength,
  validateStrongPassword,
  type PasswordStrength,
} from "@/lib/password-strength";
import { cn } from "@/lib/utils";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Step = "email" | "otp" | "password" | "done";

function CompanyLogo({
  className,
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <span className={`relative inline-flex ${className ?? ""}`}>
      <Image
        src="/iag-logo.png"
        alt="Inspire Africa Group"
        fill
        className="object-contain object-left"
        sizes="360px"
        priority={priority}
      />
    </span>
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
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            className={cn(
              "h-1.5 rounded-full",
              strength.score >= n ? tones[strength.score] : "bg-slate-200",
            )}
          />
        ))}
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<Step>("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  const strength = useMemo(() => evaluatePasswordStrength(password), [password]);

  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 20);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const result = await requestPasswordReset(emailOrUsername);
      setInfo(result.message);
      setOtp("");
      setStep("otp");
      setResendIn(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset code");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await verifyPasswordResetOTP(emailOrUsername, otp);
      setResetToken(result.resetToken);
      setStep("password");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  }

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const msg = validateStrongPassword(password);
    if (msg) {
      setError(msg);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const message = await resetPasswordWithToken(resetToken, password);
      setInfo(message);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setLoading(false);
    }
  }

  const title =
    step === "email"
      ? "Forgot password"
      : step === "otp"
        ? "Enter reset code"
        : step === "password"
          ? "Set new password"
          : "Password updated";

  const subtitle =
    step === "email"
      ? "Enter your company email or username. We’ll email a one-time code."
      : step === "otp"
        ? "Enter the 6-digit code from your email. It expires in 15 minutes."
        : step === "password"
          ? "Choose a strong password you haven’t used before."
          : "You can now sign in with your new password.";

  return (
    <div className="relative h-dvh overflow-hidden bg-[#f4f6f8] text-slate-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(249,115,22,0.08)_0%,_transparent_42%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(15,23,42,0.035)_0%,_transparent_40%)]" />

      <div className="relative grid h-full lg:grid-cols-[1fr_1.05fr]">
        <aside
          className={`hidden min-h-0 flex-col px-10 py-10 xl:px-14 xl:py-12 lg:flex transition-all duration-700 ease-out ${
            ready ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
          }`}
        >
          <CompanyLogo className="h-[72px] w-[240px] shrink-0" priority />
          <div className="mt-10 min-h-0 flex-1 pr-2">
            <p className="text-[12px] font-semibold tracking-[0.18em] text-orange-600 uppercase">
              Account recovery
            </p>
            <h2 className="mt-3 max-w-[26rem] text-[32px] leading-[1.12] font-semibold tracking-tight text-slate-900">
              Reset access with an email code.
            </h2>
            <p className="mt-3 max-w-[26rem] text-[14px] leading-relaxed text-slate-500">
              We send a short-lived OTP to your registered email. No admin ticket needed for a
              forgotten password.
            </p>
          </div>
          <p className="mt-6 shrink-0 text-[12px] text-slate-400">
            © {new Date().getFullYear()} Inspire Africa Group
          </p>
        </aside>

        <main className="flex items-center justify-center overflow-y-auto px-5 py-8 sm:px-8">
          <div
            className={`w-full max-w-[440px] transition-all duration-700 ease-out ${
              ready ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
            }`}
            style={{ transitionDelay: "80ms" }}
          >
            <div className="mb-6 lg:hidden">
              <CompanyLogo className="mx-auto h-[52px] w-[176px]" priority />
            </div>

            <div className="rounded-2xl border border-white/80 bg-white/90 p-6 shadow-[0_20px_50px_-28px_rgba(15,23,42,0.35)] backdrop-blur-sm sm:p-8">
              <Link
                href="/login"
                className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 transition hover:text-slate-800"
              >
                <ArrowLeft size={15} /> Back to sign in
              </Link>

              <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">{title}</h1>
              <p className="mt-1.5 text-[14px] leading-relaxed text-slate-500">{subtitle}</p>

              {step === "email" ? (
                <form onSubmit={sendCode} className="mt-6 space-y-4" data-testid="forgot-email-form">
                  <div className="space-y-1.5">
                    <label htmlFor="reset-email" className="block text-[13px] font-medium text-slate-700">
                      Email or username
                    </label>
                    <input
                      id="reset-email"
                      data-testid="forgot-email"
                      type="text"
                      autoComplete="username"
                      required
                      value={emailOrUsername}
                      onChange={(e) => setEmailOrUsername(e.target.value)}
                      placeholder="you@company.com"
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-500/10"
                    />
                  </div>
                  {error ? (
                    <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
                  ) : null}
                  <Button
                    type="submit"
                    data-testid="forgot-send-code"
                    className="mt-1 h-11 w-full rounded-xl bg-orange-500 text-[15px] font-medium text-white shadow-sm transition hover:bg-orange-600"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="animate-spin" /> Sending code…
                      </>
                    ) : (
                      "Send reset code"
                    )}
                  </Button>
                </form>
              ) : null}

              {step === "otp" ? (
                <form onSubmit={verifyOtp} className="mt-6 space-y-4" data-testid="forgot-otp-form">
                  {info ? (
                    <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
                      {info}
                    </p>
                  ) : null}
                  <div className="flex justify-center py-2">
                    <InputOTP
                      maxLength={6}
                      value={otp}
                      onChange={setOtp}
                      containerClassName="gap-2"
                      data-testid="forgot-otp"
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }).map((_, i) => (
                          <InputOTPSlot key={i} index={i} className="size-10 text-base" />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  {error ? (
                    <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
                  ) : null}
                  <Button
                    type="submit"
                    data-testid="forgot-verify-otp"
                    className="h-11 w-full rounded-xl bg-orange-500 text-[15px] font-medium text-white shadow-sm transition hover:bg-orange-600"
                    disabled={loading || otp.length !== 6}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="animate-spin" /> Verifying…
                      </>
                    ) : (
                      "Verify code"
                    )}
                  </Button>
                  <button
                    type="button"
                    className="w-full text-center text-[13px] font-medium text-orange-600 disabled:text-slate-400"
                    disabled={loading || resendIn > 0}
                    onClick={() => void sendCode()}
                  >
                    {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                  </button>
                </form>
              ) : null}

              {step === "password" ? (
                <form
                  onSubmit={submitNewPassword}
                  className="mt-6 space-y-4"
                  data-testid="forgot-password-form"
                >
                  <div className="space-y-1.5">
                    <label htmlFor="new-password" className="block text-[13px] font-medium text-slate-700">
                      New password
                    </label>
                    <div className="relative">
                      <input
                        id="new-password"
                        data-testid="forgot-new-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 pr-11 text-[15px] text-slate-900 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-500/10"
                      />
                      <button
                        type="button"
                        className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </div>
                  </div>
                  <StrengthMeter strength={strength} />
                  <div className="space-y-1.5">
                    <label
                      htmlFor="confirm-password"
                      className="block text-[13px] font-medium text-slate-700"
                    >
                      Confirm password
                    </label>
                    <input
                      id="confirm-password"
                      data-testid="forgot-confirm-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 text-[15px] text-slate-900 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-500/10"
                    />
                  </div>
                  {error ? (
                    <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
                  ) : null}
                  <Button
                    type="submit"
                    data-testid="forgot-reset-submit"
                    className="h-11 w-full rounded-xl bg-orange-500 text-[15px] font-medium text-white shadow-sm transition hover:bg-orange-600"
                    disabled={loading || !strength.ok}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="animate-spin" /> Updating…
                      </>
                    ) : (
                      "Update password"
                    )}
                  </Button>
                </form>
              ) : null}

              {step === "done" ? (
                <div className="mt-6 space-y-4" data-testid="forgot-done">
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
                    {info || "Password updated. You can sign in with your new password."}
                  </p>
                  <Button
                    type="button"
                    className="h-11 w-full rounded-xl bg-orange-500 text-[15px] font-medium text-white shadow-sm transition hover:bg-orange-600"
                    onClick={() => router.replace("/login")}
                  >
                    Go to sign in
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
