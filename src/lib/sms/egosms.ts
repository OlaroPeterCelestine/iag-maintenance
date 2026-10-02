/**
 * EgoSMS transport. Kept out of the route handler so the env-var behaviour
 * (EGO_SMS_ENABLED / EGO_SMS_API_URL) can be exercised directly by scripts.
 */

export const EGO_SMS_JSON_URL = "https://www.egosms.co/api/v1/json/";

const DISABLED_VALUES = ["false", "0", "no", "off"];

/**
 * Opt-out kill switch: unset means enabled, so deployments that only set
 * credentials keep working.
 */
export function isSmsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.EGO_SMS_ENABLED || "").trim().toLowerCase();
  if (!raw) return true;
  return !DISABLED_VALUES.includes(raw);
}

export type Transport = { url: string; mode: "json" | "plain" };

/**
 * EgoSMS ships two endpoints: `/api/v1/json/` (POST, batch) and `/api/v1/plain`
 * (GET, one number per call). EGO_SMS_API_URL picks which one we talk to; the
 * wire format is derived from the path so a single var stays in sync with it.
 */
export function resolveTransport(env: NodeJS.ProcessEnv = process.env): Transport {
  const raw = (env.EGO_SMS_API_URL || "").trim();
  if (!raw) return { url: EGO_SMS_JSON_URL, mode: "json" };

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`EGO_SMS_API_URL is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("EGO_SMS_API_URL must be an http(s) URL.");
  }
  const mode: "json" | "plain" = /\/plain\/?$/.test(parsed.pathname)
    ? "plain"
    : "json";
  return { url: parsed.toString(), mode };
}

export type Credentials = { username: string; password: string; sender: string };

/**
 * Server env is the only source of credentials — the browser never holds or
 * transmits the EgoSMS password.
 */
export function resolveCredentials(
  env: NodeJS.ProcessEnv = process.env,
): Credentials {
  const username = (env.EGO_SMS_USERNAME || "").trim();
  const password = (env.EGO_SMS_PASSWORD || "").trim();
  const sender = (env.EGO_SMS_SENDER || "").trim();
  if (!username || !password || !sender) {
    const missing = [
      !username && "EGO_SMS_USERNAME",
      !password && "EGO_SMS_PASSWORD",
      !sender && "EGO_SMS_SENDER",
    ].filter(Boolean);
    throw new Error(
      `SMS is not configured on the server. Set ${missing.join(" / ")} in the environment (Vercel → Project → Environment Variables).`,
    );
  }
  if (sender.length > 11) {
    throw new Error("Sender ID must be at most 11 characters.");
  }
  return { username, password, sender };
}

export type SmsConfigStatus = {
  enabled: boolean;
  configured: boolean;
  missing: string[];
  /** Safe to expose — a sender ID is public on every delivered message. */
  sender: string;
  transport: "json" | "plain";
  endpoint: string;
};

/** Never returns the username or password. */
export function describeSmsConfig(
  env: NodeJS.ProcessEnv = process.env,
): SmsConfigStatus {
  const missing = [
    !(env.EGO_SMS_USERNAME || "").trim() && "EGO_SMS_USERNAME",
    !(env.EGO_SMS_PASSWORD || "").trim() && "EGO_SMS_PASSWORD",
    !(env.EGO_SMS_SENDER || "").trim() && "EGO_SMS_SENDER",
  ].filter(Boolean) as string[];

  let transport: "json" | "plain" = "json";
  let endpoint = EGO_SMS_JSON_URL;
  try {
    const resolved = resolveTransport(env);
    transport = resolved.mode;
    endpoint = resolved.url;
  } catch {
    /* invalid EGO_SMS_API_URL — surface via missing instead of throwing */
    missing.push("EGO_SMS_API_URL (invalid)");
  }

  return {
    enabled: isSmsEnabled(env),
    configured: missing.length === 0,
    missing,
    sender: (env.EGO_SMS_SENDER || "").trim(),
    transport,
    endpoint,
  };
}

/**
 * EgoSMS expects international digits (e.g. 2567…). Local UG 07… is expanded to
 * 2567…. Server-side so the browser never has to know the carrier's format.
 */
export function normalizePhone(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  let digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) {
    digits = `256${digits.slice(1)}`;
  }
  return digits;
}

export function isValidPhone(value: string): boolean {
  return /^\d{9,15}$/.test(value);
}

export function normalizeRecipients(to: unknown): string[] {
  if (Array.isArray(to)) {
    return to.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof to === "string") {
    return to
      .split(/[,;\n]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

type EgoSmsResponse = {
  Status?: string;
  Message?: string;
  Cost?: string;
  MsgFollowUpUniqueCode?: string;
};

async function sendJsonBatch(
  url: string,
  numbers: string[],
  message: string,
  creds: Credentials,
): Promise<void> {
  const payload = {
    method: "SendSms",
    userdata: { username: creds.username, password: creds.password },
    msgdata: numbers.map((number) => ({
      number,
      message,
      senderid: creds.sender,
    })),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => "");
  let parsed: EgoSmsResponse = {};
  try {
    parsed = JSON.parse(text) as EgoSmsResponse;
  } catch {
    /* non-JSON body */
  }

  const status = String(parsed.Status || "").trim().toUpperCase();
  if (!res.ok || status !== "OK") {
    const detail =
      (parsed.Message || "").trim() ||
      text.slice(0, 300) ||
      `EgoSMS HTTP ${res.status}`;
    throw new Error(detail);
  }
}

/**
 * The plain endpoint takes a single recipient per request and answers with a
 * bare `Ok` / `Failed: reason` body, so we fan out and report per-number.
 */
async function sendPlainOne(
  url: string,
  number: string,
  message: string,
  creds: Credentials,
): Promise<void> {
  const target = new URL(url);
  target.searchParams.set("username", creds.username);
  target.searchParams.set("password", creds.password);
  target.searchParams.set("sender", creds.sender);
  target.searchParams.set("number", number);
  target.searchParams.set("message", message);

  const res = await fetch(target.toString(), {
    method: "GET",
    headers: { Accept: "text/plain" },
  });
  const text = (await res.text().catch(() => "")).trim();
  if (!res.ok) {
    throw new Error(text.slice(0, 300) || `EgoSMS HTTP ${res.status}`);
  }
  if (!/^ok\b/i.test(text)) {
    throw new Error(text.slice(0, 300) || "EgoSMS rejected the message.");
  }
}

export async function sendViaEgoSms(
  numbers: string[],
  message: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ via: "json" | "plain" }> {
  if (!isSmsEnabled(env)) {
    throw new Error("SMS sending is disabled (EGO_SMS_ENABLED=false).");
  }

  const creds = resolveCredentials(env);
  const transport = resolveTransport(env);

  if (transport.mode === "json") {
    await sendJsonBatch(transport.url, numbers, message, creds);
    return { via: "json" };
  }

  const results = await Promise.allSettled(
    numbers.map((number) => sendPlainOne(transport.url, number, message, creds)),
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          `${numbers[index]}: ${
            result.reason instanceof Error ? result.reason.message : "send failed"
          }`,
        ]
      : [],
  );
  if (failures.length) {
    throw new Error(
      failures.length === numbers.length
        ? failures.join("; ")
        : `Sent to ${numbers.length - failures.length} of ${numbers.length}. Failed — ${failures.join("; ")}`,
    );
  }
  return { via: "plain" };
}
