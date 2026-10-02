"use client";

import { Button } from "@/components/ui/button";
import {
  consumeJustLoggedOut,
  getKeepSignedInPreference,
  isAuthenticated,
  loginWithCredentials,
} from "@/lib/auth";
import { waitForDataAccess } from "@/lib/api-auth";
import { defaultHomePath } from "@/lib/access-control";
import { restoreAuthSessionFromDatabase } from "@/lib/db/sync";
import { enforceSessionValidity } from "@/lib/session-activity";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, Suspense } from "react";
import { LoginPageSkeleton } from "@/components/page-loading";

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

/**
 * Bounded session checks. An existing session only skips the form when the API
 * confirms it quickly; a slow API leaves the form usable instead of hanging.
 */
const RESUME_PROBE = {
  attempts: 3,
  delayMs: 250,
  budgetMs: 2000,
  timeoutMs: 2500,
} as const;

function safePostLoginPath(searchParams: URLSearchParams): string {
  const reason = searchParams.get("reason");
  // After expiry / forced logout, use the role's home — never restore old tabs.
  if (
    reason === "idle" ||
    reason === "auth" ||
    reason === "expired" ||
    reason === "logout"
  ) {
    return defaultHomePath();
  }
  const next = searchParams.get("next");
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return defaultHomePath();
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(true);
  const restoreAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    const ac = new AbortController();
    restoreAbortRef.current = ac;

    // Intentional logout / expired session — never auto-restore from a race.
    let skipRestore = false;
    try {
      const reason = searchParams.get("reason");
      if (
        reason === "logout" ||
        reason === "idle" ||
        reason === "auth" ||
        reason === "expired"
      ) {
        skipRestore = true;
      }
      // Durable flag set by forceSessionLogout — survives hard nav even if
      // the query string is stripped or the cookie revoke is still in flight.
      if (consumeJustLoggedOut()) skipRestore = true;
    } catch {
      /* ignore */
    }

    try {
      if (!skipRestore) {
        void restoreAuthSessionFromDatabase(ac.signal).then(async (ok) => {
          if (ac.signal.aborted) return;
          setKeepSignedIn(getKeepSignedInPreference());
          if (ok && isAuthenticated() && enforceSessionValidity()) {
            const dataReady = await waitForDataAccess(RESUME_PROBE);
            if (ac.signal.aborted) return;
            if (!dataReady) return;
            router.replace(safePostLoginPath(searchParams));
          }
        });
        setKeepSignedIn(getKeepSignedInPreference());
        if (isAuthenticated() && enforceSessionValidity()) {
          void waitForDataAccess(RESUME_PROBE).then((dataReady) => {
            if (ac.signal.aborted || !dataReady) return;
            router.replace(safePostLoginPath(searchParams));
          });
        }
      } else {
        setKeepSignedIn(getKeepSignedInPreference());
      }
    } catch {
      // ignore
    }
    const t = window.setTimeout(() => setReady(true), 20);
    return () => {
      ac.abort();
      if (restoreAbortRef.current === ac) restoreAbortRef.current = null;
      window.clearTimeout(t);
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [router, searchParams]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    // Stop any in-flight login-page restore so it cannot clear/revoke the new JWT.
    restoreAbortRef.current?.abort();
    restoreAbortRef.current = null;
    try {
      const result = await loginWithCredentials(email, password, keepSignedIn);
      if (!result.ok) {
        setError(result.error);
        setLoading(false);
        return;
      }
      // Short confirmation only. The login grace window already trusts this token,
      // so a cold API must not hold the button — the shell hydrates in the
      // background exactly as it does on a normal page load.
      await waitForDataAccess({
        attempts: 2,
        delayMs: 200,
        budgetMs: 1200,
        timeoutMs: 2500,
      });
      // Hard navigate so AppShell remounts cleanly for the new user (no stale
      // bootReady / previous identity painted from the soft SPA transition).
      window.location.assign(safePostLoginPath(searchParams));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }

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
              IAG Maintenance
            </p>
            <h2 className="mt-3 max-w-[26rem] text-[32px] leading-[1.12] font-semibold tracking-tight text-slate-900">
              Sign in to your workspace.
            </h2>
            <p className="mt-3 max-w-[26rem] text-[14px] leading-relaxed text-slate-500">
              One sign-in for everyone — staff and contractors. Access is controlled by your
              assigned role after you log in.
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
              <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">Sign in</h1>
              <p className="mt-1.5 text-[14px] leading-relaxed text-slate-500">
                Sign in with your IAG platform account.
              </p>

              <form onSubmit={onSubmit} className="mt-6 space-y-4" data-testid="login-form">
                {searchParams.get("reason") === "idle" ? (
                  <p
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
                    data-testid="session-idle-message"
                  >
                    You were signed out after inactivity. Sign in again to continue.
                  </p>
                ) : null}
                {searchParams.get("reason") === "auth" ? (
                  <p
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
                    data-testid="session-auth-message"
                  >
                    Your session expired or could not be verified. Sign in again to continue.
                  </p>
                ) : null}
                <div className="space-y-1.5">
                  <label htmlFor="email" className="block text-[13px] font-medium text-slate-700">
                    Email or username
                  </label>
                  <input
                    id="email"
                    data-testid="login-email"
                    type="text"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-500/10"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="password" className="block text-[13px] font-medium text-slate-700">
                      Password
                    </label>
                    <Link
                      href="/forgot-password"
                      className="text-[12px] font-medium text-orange-600 underline-offset-2 hover:underline"
                      data-testid="forgot-password-link"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      data-testid="login-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 pr-11 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-500/10"
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

                <label className="flex items-center gap-2.5 text-[13px] text-slate-600 select-none">
                  <input
                    type="checkbox"
                    checked={keepSignedIn}
                    onChange={(e) => setKeepSignedIn(e.target.checked)}
                    className="size-4 rounded border-slate-300 text-orange-500 accent-orange-500"
                  />
                  Keep me signed in
                </label>

                {error ? (
                  <p className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
                ) : null}

                <Button
                  type="submit"
                  data-testid="login-submit"
                  className="mt-1 h-11 w-full rounded-xl bg-orange-500 text-[15px] font-medium text-white shadow-sm transition hover:bg-orange-600 hover:shadow-md"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin" /> Signing in…
                    </>
                  ) : (
                    "Sign in"
                  )}
                </Button>
              </form>
            </div>

            <p className="mt-6 text-center text-[12px] text-slate-400 lg:hidden">
              © {new Date().getFullYear()} Inspire Africa Group ·{" "}
              <Link href="/" className="text-slate-500 underline-offset-2 hover:underline">
                Home
              </Link>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}
