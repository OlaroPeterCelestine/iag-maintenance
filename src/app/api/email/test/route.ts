import { NextResponse } from "next/server";
import { deliverServerMail } from "@/lib/email/server-mail";
import type { SmtpConfig } from "@/lib/email/smtp";
import { requireApiAdmin } from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "fra1";

type Body = {
  to?: unknown;
  subject?: string;
  body?: string;
  /** Settings → Email payload; server env still wins when set. */
  smtp?: Partial<SmtpConfig>;
};

export async function POST(request: Request) {
  const auth = await requireApiAdmin(request);
  if ("response" in auth) return auth.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: { message: "invalid JSON" } },
      { status: 400 },
    );
  }

  try {
    const result = await deliverServerMail({
      to: body.to,
      subject: body.subject || "FinaceIAG SMTP test",
      body: body.body || "This is a test email from FinaceManagerIAG (Vercel SMTP).",
      html: false,
      smtp: body.smtp,
    });
    return NextResponse.json({ ok: true, via: result.via });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email test failed";
    return NextResponse.json(
      { ok: false, error: { message } },
      { status: 502 },
    );
  }
}
