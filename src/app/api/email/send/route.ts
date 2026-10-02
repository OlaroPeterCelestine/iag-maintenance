import { NextResponse } from "next/server";
import { deliverServerMail } from "@/lib/email/server-mail";
import type { SmtpConfig } from "@/lib/email/smtp";
import { requireApiSend } from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "fra1";

type Body = {
  to?: unknown;
  subject?: string;
  body?: string;
  html?: boolean;
  attachments?: {
    filename?: string;
    contentType?: string;
    data?: string;
  }[];
  smtp?: Partial<SmtpConfig>;
};

/** Simple in-memory rate limit: 30 sends per uid per hour. */
const sendBuckets = new Map<string, { count: number; resetAt: number }>();
const SEND_LIMIT = 30;
const SEND_WINDOW_MS = 60 * 60 * 1000;

function allowSend(uid: string): boolean {
  const now = Date.now();
  const key = uid || "anon";
  const bucket = sendBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    sendBuckets.set(key, { count: 1, resetAt: now + SEND_WINDOW_MS });
    return true;
  }
  if (bucket.count >= SEND_LIMIT) return false;
  bucket.count += 1;
  return true;
}

export async function POST(request: Request) {
  const auth = await requireApiSend(request);
  if ("response" in auth) return auth.response;

  if (!allowSend(auth.principal.uid || auth.principal.email || "anon")) {
    return NextResponse.json(
      { ok: false, error: { message: "Email send rate limit exceeded (30/hour)." } },
      { status: 429 },
    );
  }

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
      subject: body.subject,
      body: body.body,
      html: body.html,
      attachments: body.attachments,
      smtp: body.smtp,
    });
    return NextResponse.json({ ok: true, via: result.via });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Email send failed";
    return NextResponse.json(
      { ok: false, error: { message } },
      { status: 502 },
    );
  }
}
