import { NextResponse } from "next/server";
import { requireApiSend } from "@/lib/api-guard";
import {
  describeSmsConfig,
  isSmsEnabled,
  isValidPhone,
  normalizePhone,
  normalizeRecipients,
  sendViaEgoSms,
} from "@/lib/sms/egosms";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = "fra1";

type Body = {
  to?: unknown;
  body?: string;
};

/** Simple in-memory rate limit: 20 SMS per uid per hour. */
const sendBuckets = new Map<string, { count: number; resetAt: number }>();
const SEND_LIMIT = 20;
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

/** Config status for Settings → SMS. Returns no credentials. */
export async function GET(request: Request) {
  const auth = await requireApiSend(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ ok: true, config: describeSmsConfig() });
}

export async function POST(request: Request) {
  const auth = await requireApiSend(request);
  if ("response" in auth) return auth.response;

  // Checked before the rate limit so a disabled service never burns quota.
  if (!isSmsEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: { message: "SMS sending is disabled (EGO_SMS_ENABLED=false)." },
      },
      { status: 503 },
    );
  }

  if (!allowSend(auth.principal.uid || auth.principal.email || "anon")) {
    return NextResponse.json(
      { ok: false, error: { message: "SMS send rate limit exceeded (20/hour)." } },
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

  const recipients = normalizeRecipients(body.to).map(normalizePhone).filter(Boolean);
  const message = String(body.body || "").trim();
  if (!recipients.length) {
    return NextResponse.json(
      { ok: false, error: { message: "At least one phone number is required." } },
      { status: 400 },
    );
  }
  if (!message) {
    return NextResponse.json(
      { ok: false, error: { message: "SMS body is required." } },
      { status: 400 },
    );
  }
  if (message.length > 1600) {
    return NextResponse.json(
      { ok: false, error: { message: "SMS body is too long (max 1600 characters)." } },
      { status: 400 },
    );
  }
  const invalid = recipients.find((phone) => !isValidPhone(phone));
  if (invalid) {
    return NextResponse.json(
      { ok: false, error: { message: `Invalid phone number: ${invalid}` } },
      { status: 400 },
    );
  }

  try {
    const { via } = await sendViaEgoSms(recipients, message);
    return NextResponse.json({
      ok: true,
      via: "egosms",
      transport: via,
      count: recipients.length,
    });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "SMS send failed";
    return NextResponse.json(
      { ok: false, error: { message: messageText } },
      { status: 502 },
    );
  }
}
