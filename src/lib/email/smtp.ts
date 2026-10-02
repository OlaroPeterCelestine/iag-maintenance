import nodemailer from "nodemailer";

export type SmtpConfig = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  useTLS?: boolean;
};

export type EmailAttachment = {
  filename?: string;
  contentType?: string;
  data?: string; // base64
};

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

export async function sendSmtpMail(opts: {
  to: unknown;
  subject?: string;
  body?: string;
  html?: boolean;
  attachments?: EmailAttachment[];
  smtp: SmtpConfig;
}): Promise<void> {
  const host = opts.smtp.host?.trim() ?? "";
  const fromEmail = opts.smtp.fromEmail?.trim() ?? "";
  if (!host || !fromEmail) {
    throw new Error("SMTP host and fromEmail are required");
  }
  const recipients = normalizeRecipients(opts.to);
  if (!recipients.length) {
    throw new Error("at least one recipient is required");
  }

  const port = opts.smtp.port && opts.smtp.port > 0 ? opts.smtp.port : 587;
  // 465 = implicit TLS; 587 = plain + STARTTLS (Gmail). Never set secure on 587.
  const secure = port === 465;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: port === 587 || Boolean(opts.smtp.useTLS),
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
    auth:
      opts.smtp.username || opts.smtp.password
        ? {
            user: opts.smtp.username || "",
            pass: opts.smtp.password || "",
          }
        : undefined,
  });

  const from =
    opts.smtp.fromName?.trim()
      ? `${opts.smtp.fromName.trim()} <${fromEmail}>`
      : fromEmail;

  await transporter.sendMail({
    from,
    to: recipients.join(", "),
    replyTo: opts.smtp.replyTo?.trim() || undefined,
    subject: opts.subject || "(no subject)",
    text: opts.html ? undefined : opts.body || "",
    html: opts.html ? opts.body || "" : undefined,
    attachments: (opts.attachments || [])
      .filter((a) => a.data)
      .map((a) => ({
        filename: a.filename || "attachment.bin",
        contentType: a.contentType || "application/octet-stream",
        content: Buffer.from(a.data!, "base64"),
      })),
  });
}
