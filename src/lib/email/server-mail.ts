/**
 * Server-side outbound mail for Next/Vercel.
 * SMTP only (Gmail / Settings SMTP).
 */
import { sendSmtpMail, type EmailAttachment, type SmtpConfig } from "@/lib/email/smtp";

export type ServerMailInput = {
  to: unknown;
  subject?: string;
  body?: string;
  html?: boolean;
  attachments?: EmailAttachment[];
  /** Client Settings → Email payload; server env wins when set. */
  smtp?: Partial<SmtpConfig>;
};

function envSmtp(): SmtpConfig {
  const portRaw = (process.env.SMTP_PORT || "").trim();
  const port = Number.parseInt(portRaw || "587", 10);
  return {
    host: (process.env.SMTP_HOST || "").trim(),
    port: Number.isFinite(port) && port > 0 ? port : 587,
    username: (process.env.SMTP_USERNAME || "").trim(),
    password: process.env.SMTP_PASSWORD || "",
    fromName: (process.env.SMTP_FROM_NAME || "").trim() || "FinanceIAG",
    fromEmail: (process.env.SMTP_FROM_EMAIL || "").trim(),
    replyTo: (process.env.SMTP_REPLY_TO || "").trim(),
    useTLS: (process.env.SMTP_USE_TLS || "true").toLowerCase() !== "false",
  };
}

function mergeSmtp(client?: Partial<SmtpConfig>): SmtpConfig {
  const env = envSmtp();
  const c = client || {};
  return {
    host: env.host || (c.host || "").trim(),
    port: env.port || c.port || 587,
    username: env.username || (c.username || "").trim(),
    password: env.password || c.password || "",
    fromName: env.fromName || (c.fromName || "").trim() || "FinanceIAG",
    fromEmail: env.fromEmail || (c.fromEmail || "").trim(),
    replyTo: env.replyTo || (c.replyTo || "").trim(),
    useTLS: env.useTLS ?? c.useTLS ?? true,
  };
}

function normalizeRecipients(to: unknown): string[] {
  if (typeof to === "string") {
    return to
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(to)) {
    return to.map((s) => String(s).trim()).filter(Boolean);
  }
  return [];
}

/** Deliver mail via SMTP (Vercel / Next `/api/email/*`). */
export async function deliverServerMail(input: ServerMailInput): Promise<{ via: "smtp" }> {
  const recipients = normalizeRecipients(input.to);
  if (!recipients.length) {
    throw new Error("at least one recipient is required");
  }
  const smtp = mergeSmtp(input.smtp);
  const subject = input.subject || "(no subject)";
  const body = input.body || "";
  const html = Boolean(input.html);

  if (!smtp.host || !smtp.fromEmail || !smtp.password) {
    throw new Error(
      "Email is not configured — set SMTP_HOST, SMTP_FROM_EMAIL, and SMTP_PASSWORD on Vercel",
    );
  }

  await sendSmtpMail({
    to: recipients,
    subject,
    body,
    html,
    attachments: input.attachments,
    smtp,
  });
  return { via: "smtp" };
}
