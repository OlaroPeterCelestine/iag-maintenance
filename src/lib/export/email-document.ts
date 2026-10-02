import {
  buildDocumentPdfBlob,
  formTypeForEntity,
} from "@/lib/export/document-pdf";
import { getCompanyLetterhead } from "@/lib/export/letterhead";
import type { ManagerRecord } from "@/lib/manager-entities";
import {
  EMAIL_TEMPLATES_KEY,
  defaultEmailTemplates,
  loadEmailSettings,
  loadList,
  type EmailSettings,
  type EmailTemplateRow,
} from "@/lib/manager-settings";
import { parseAmount } from "@/lib/ledger/types";
import { apiFetch } from "@/lib/api-auth";

function fillTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

function partyOf(record: ManagerRecord) {
  return record.customer || record.supplier || record.party || record.employee || "";
}

function partyEmail(record: ManagerRecord, allRecords?: ManagerRecord[]) {
  if (record.email) return record.email;
  const name = partyOf(record);
  if (!name || !allRecords) return "";
  const match = allRecords.find(
    (row) =>
      (row.name || row.customer || row.supplier || "") === name && Boolean(row.email),
  );
  return match?.email || "";
}

export function resolveEmailTemplate(entityKey: string, entityLabel: string) {
  const formType = formTypeForEntity(entityKey, entityLabel);
  const templates = loadList(EMAIL_TEMPLATES_KEY, defaultEmailTemplates);
  return (
    templates.find((t) => t.formType === formType) ||
    templates[0] ||
    defaultEmailTemplates[0]
  );
}

export function buildEmailContent(
  entityKey: string,
  entityLabel: string,
  record: ManagerRecord,
  template?: EmailTemplateRow,
) {
  const company = getCompanyLetterhead();
  const tpl = template || resolveEmailTemplate(entityKey, entityLabel);
  const vars = {
    reference: record.reference || record.code || record.id.slice(0, 8),
    business: company.businessName,
    party: partyOf(record) || "Customer",
    amount: `${record.currency || company.currency} ${parseAmount(record.amount).toLocaleString()}`,
    date: record.date || "",
    dueDate: record.dueDate || "",
  };
  return {
    subject: fillTemplate(tpl.subject, vars),
    body: fillTemplate(tpl.body, vars),
    to: "",
    template: tpl,
  };
}

function smtpPayload(settings: EmailSettings) {
  const port = Number.parseInt(settings.port || "587", 10);
  return {
    host: settings.host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    username: settings.username,
    password: settings.password,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo,
    useTLS: settings.useTls,
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function safePdfName(title: string, reference: string) {
  return `${title}-${reference}`.replace(/[^\w.-]+/g, "_").slice(0, 80) + ".pdf";
}

/**
 * Send via Next `/api/email/send` (Vercel SMTP).
 * Go Gin email handlers exist but are not proxied — Railway Hobby blocks outbound SMTP.
 * Falls back to mailto: when SMTP host / from email are not configured.
 */
export async function emailDocument(
  entityKey: string,
  entityLabel: string,
  record: ManagerRecord,
  options?: { partyRecords?: ManagerRecord[]; to?: string },
) {
  const content = buildEmailContent(entityKey, entityLabel, record);
  const to = (options?.to || partyEmail(record, options?.partyRecords) || "").trim();
  const emailSettings = loadEmailSettings();
  const smtpConfigured = Boolean(emailSettings.host && emailSettings.fromEmail);

  const { blob, model } = await buildDocumentPdfBlob(entityKey, entityLabel, record);
  const filename = safePdfName(model.title, model.reference);

  if (!smtpConfigured) {
    const { downloadBlob } = await import("@/lib/export/download");
    downloadBlob(blob, filename);
    const params = new URLSearchParams();
    params.set("subject", content.subject);
    params.set(
      "body",
      `${content.body}\n\n---\nPDF downloaded: attach the file before sending.\nFrom: ${emailSettings.fromName || ""} <${emailSettings.fromEmail || ""}>`.trim(),
    );
    window.location.href = `mailto:${encodeURIComponent(to)}?${params.toString()}`;
    return { to, subject: content.subject, smtpConfigured: false, sent: false };
  }

  if (!to) {
    throw new Error("Add an email address on the customer/supplier (or pass To) before sending.");
  }

  const data = await blobToBase64(blob);
  const res = await apiFetch("/api/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: [to],
      subject: content.subject,
      body: content.body,
      html: false,
      attachments: [
        {
          filename,
          contentType: "application/pdf",
          data,
        },
      ],
      smtp: smtpPayload(emailSettings),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: { message?: string };
  };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error?.message || `Email failed (${res.status})`);
  }
  return { to, subject: content.subject, smtpConfigured: true, sent: true };
}

/** Send a test message using Settings → Email SMTP values. */
export async function sendTestEmail(to: string, settings?: EmailSettings) {
  const emailSettings = settings || loadEmailSettings();
  if (!emailSettings.host || !emailSettings.fromEmail) {
    throw new Error("Set SMTP host and from email first.");
  }
  const recipient = to.trim() || emailSettings.fromEmail;
  const res = await apiFetch("/api/email/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: recipient,
      subject: "FinaceManagerIAG SMTP test",
      body: "This is a test email from FinaceManagerIAG SMTP settings.",
      smtp: smtpPayload(emailSettings),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: { message?: string };
  };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error?.message || `Test email failed (${res.status})`);
  }
  return recipient;
}
