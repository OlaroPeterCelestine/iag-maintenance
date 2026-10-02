import { NextResponse } from "next/server";
import { deliverServerMail } from "@/lib/email/server-mail";
import { adapterEnabled } from "@/lib/iag/config";
import { gatewayFetch } from "@/lib/iag/gateway";
import { gatewayErrorResponse } from "@/lib/iag/session";
import { checkRateLimit, loginRateLimitPerMinute } from "@/lib/rate-limit";
import { getRequestIp } from "@/lib/request-ip";
import { FRONTEND_ONLY } from "@/lib/frontend-only";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "fra1";

const GENERIC_OK = {
  ok: true as const,
  message:
    "If an account exists for that email or username, a reset code has been sent.",
  data: { expiresInSeconds: 15 * 60 },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildOtpEmail(name: string, otp: string, expiresMinutes: number) {
  const safeName = escapeHtml(name.trim() || "there");
  const safeOtp = escapeHtml(otp);
  const subject = "Your password reset code";
  const text = `Hi ${name.trim() || "there"},\n\nYour FinanceIAG password reset code is: ${otp}\n\nThis code expires in ${expiresMinutes} minutes. If you did not request a reset, you can ignore this email.\n`;
  const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f4f6f8;padding:24px;color:#0f172a">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e2e8f0">
    <p style="margin:0 0 8px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#ea580c;font-weight:600">FinanceIAG</p>
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:600">Password reset code</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#64748b">Hi ${safeName}, use this one-time code to reset your password:</p>
    <p style="margin:0 0 24px;text-align:center;font-size:32px;letter-spacing:.35em;font-weight:700;color:#0f172a">${safeOtp}</p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#94a3b8">Expires in ${expiresMinutes} minutes. If you did not request this, ignore this email.</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

/**
 * Public forgot-password entrypoint.
 *
 * Two flows, because the two identity stores do not reset passwords the same
 * way and pretending otherwise would send a code for an account that does not
 * exist:
 *
 *   platform (adapter on)  iag-authentication owns the credential. Its
 *                          POST /v1/auth/forgot-password emails a reset LINK
 *                          carrying a token, and POST /v1/auth/reset-password
 *                          consumes {token, newPassword}. There is no code to
 *                          type, so the response says so and the page stops at
 *                          "check your email" instead of asking for one that
 *                          will never arrive.
 *
 *   legacy   (adapter off) the shared Go API issues a hashed OTP and this route
 *                          emails the plaintext code over SMTP.
 *
 * Both return the same non-committal message: whether an account exists is not
 * something an unauthenticated caller gets to learn.
 */
export async function POST(request: Request) {
  // Unauthenticated, and each call costs an upstream round trip plus an
  // outbound send. Without a limit one caller can drain the mail quota and bomb
  // a real person's inbox.
  const ip = getRequestIp(request);
  const limited = checkRateLimit(`forgot-password:${ip}`, loginRateLimitPerMinute());
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many reset requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  let body: { emailOrUsername?: string };
  try {
    body = (await request.json()) as { emailOrUsername?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const emailOrUsername = (body.emailOrUsername || "").trim();
  if (!emailOrUsername) {
    return NextResponse.json(
      { ok: false, error: "emailOrUsername is required" },
      { status: 400 },
    );
  }

  // Standalone build: there is no account store to reset against. Say that
  // plainly rather than failing with a server-config error the reader can do
  // nothing about.
  //
  // This also stops the reader being stranded mid-flow. Steps two and three
  // (/api/auth/verify-reset-otp, /api/auth/reset-password) have no route
  // handler in this app — they resolve only once GO_API_URL is set and
  // next.config proxies the /api/auth prefix to it.
  if (FRONTEND_ONLY) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Password reset needs a connection to the IAG platform. This build runs standalone.",
      },
      { status: 400 },
    );
  }

  if (adapterEnabled()) {
    try {
      // The service rate-limits this per email itself, and always answers 200
      // whether or not the account exists.
      await gatewayFetch({
        service: "authentication",
        path: "/v1/auth/forgot-password",
        method: "POST",
        body: { email: emailOrUsername },
      });
    } catch (err) {
      return gatewayErrorResponse(err);
    }
    return NextResponse.json({
      ok: true,
      message:
        "If an account exists for that email, a password reset link has been sent. Open it to choose a new password.",
      data: { deliveredVia: "email-link" as const },
    });
  }

  const go = (process.env.GO_API_URL || "").trim().replace(/\/$/, "");
  const apiKey = (process.env.API_KEY || "").trim();
  if (!go) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Password reset is unavailable — this app is not connected to an account service yet.",
      },
      { status: 503 },
    );
  }
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Password reset is unavailable — reset codes cannot be issued from this deployment.",
      },
      { status: 503 },
    );
  }

  let issueJson: {
    ok?: boolean;
    error?: string;
    data?: {
      email?: string;
      name?: string;
      otp?: string;
      expiresInSeconds?: number;
    } | null;
  };
  try {
    const issueRes = await fetch(`${go}/api/auth/forgot-password/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({ emailOrUsername }),
      cache: "no-store",
    });
    issueJson = (await issueRes.json()) as typeof issueJson;
    if (issueRes.status === 429) {
      return NextResponse.json(
        { ok: false, error: issueJson.error || "Please wait a minute before requesting another code." },
        { status: 429 },
      );
    }
    if (!issueRes.ok || !issueJson.ok) {
      return NextResponse.json(
        { ok: false, error: issueJson.error || "Could not start password reset" },
        { status: issueRes.status >= 400 ? issueRes.status : 502 },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Go API unreachable";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  // No matching account — same public response (do not leak existence).
  if (!issueJson.data?.email || !issueJson.data?.otp) {
    return NextResponse.json(GENERIC_OK);
  }

  const expiresIn = issueJson.data.expiresInSeconds || 15 * 60;
  const mail = buildOtpEmail(
    issueJson.data.name || "",
    issueJson.data.otp,
    Math.max(1, Math.round(expiresIn / 60)),
  );

  try {
    await deliverServerMail({
      to: issueJson.data.email,
      subject: mail.subject,
      body: mail.html,
      html: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email send failed";
    return NextResponse.json(
      {
        ok: false,
        error: `Could not send the reset email via Vercel SMTP: ${message}`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ...GENERIC_OK,
    data: { expiresInSeconds: expiresIn },
  });
}
