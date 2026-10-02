import { apiFetch } from "@/lib/api-auth";
import type { ManagerRecord } from "@/lib/manager-entities";
import { getCurrentSessionUser } from "@/lib/session-profile";
import { loadRecords, saveRecordsAsync } from "@/lib/records-store";
import { hydrateEntityFromDatabase } from "@/lib/db/sync";

export const COMMS_MODULE = "comms";
export const COMMS_ENTITY = "messages";

export type CommChannel = "email" | "sms" | "internal";
export type CommStatus = "draft" | "scheduled" | "sent" | "failed" | "queued";

export type CommMessage = {
  id: string;
  channel: CommChannel;
  status: CommStatus;
  subject: string;
  body: string;
  /** Comma-separated emails or phone numbers */
  to: string;
  /** YYYY-MM-DD for calendar placement */
  date: string;
  /** HH:mm optional */
  time: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string;
  error: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function emptyCommDraft(
  channel: CommChannel = "internal",
): Omit<CommMessage, "id" | "createdAt" | "updatedAt" | "createdBy"> {
  return {
    channel,
    status: "draft",
    subject: "",
    body: "",
    to: "",
    date: todayIso(),
    time: nowTime(),
    sentAt: "",
    error: "",
  };
}

function asMessage(row: ManagerRecord): CommMessage {
  const channel = String(row.channel || "internal") as CommChannel;
  const status = String(row.status || "draft") as CommStatus;
  return {
    id: String(row.id || ""),
    channel:
      channel === "email" || channel === "sms" || channel === "internal"
        ? channel
        : "internal",
    status:
      status === "draft" ||
      status === "scheduled" ||
      status === "sent" ||
      status === "failed" ||
      status === "queued"
        ? status
        : "draft",
    subject: String(row.subject || ""),
    body: String(row.body || ""),
    to: String(row.to || ""),
    date: String(row.date || "").slice(0, 10) || todayIso(),
    time: String(row.time || "").slice(0, 5),
    createdBy: String(row.createdBy || ""),
    createdAt: String(row.createdAt || ""),
    updatedAt: String(row.updatedAt || ""),
    sentAt: String(row.sentAt || ""),
    error: String(row.error || ""),
  };
}

function toRecord(msg: CommMessage): ManagerRecord {
  return {
    id: msg.id,
    channel: msg.channel,
    status: msg.status,
    subject: msg.subject,
    body: msg.body,
    to: msg.to,
    date: msg.date,
    time: msg.time,
    createdBy: msg.createdBy,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
    sentAt: msg.sentAt,
    error: msg.error,
  };
}

export function loadCommMessages(): CommMessage[] {
  return loadRecords(COMMS_MODULE, COMMS_ENTITY)
    .map(asMessage)
    .filter((row) => row.id)
    .sort((a, b) => {
      const ad = `${a.date}T${a.time || "00:00"}`;
      const bd = `${b.date}T${b.time || "00:00"}`;
      return bd.localeCompare(ad);
    });
}

export async function hydrateCommMessages(): Promise<CommMessage[]> {
  await hydrateEntityFromDatabase(COMMS_MODULE, COMMS_ENTITY);
  return loadCommMessages();
}

export async function saveCommMessages(messages: CommMessage[]): Promise<boolean> {
  const result = await saveRecordsAsync(
    COMMS_MODULE,
    COMMS_ENTITY,
    messages.map(toRecord),
  );
  return result.ok;
}

export function authorName(): string {
  const user = getCurrentSessionUser();
  return user.name || user.username || user.email || "User";
}

export function splitRecipients(raw: string): string[] {
  return String(raw || "")
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isValidPhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  return /^\+?\d{9,15}$/.test(digits);
}

/** Build calendar cells for a month (Sun–Sat rows). */
export function calendarCells(year: number, monthIndex: number): Array<{
  date: string | null;
  day: number | null;
}> {
  const first = new Date(year, monthIndex, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<{ date: string | null; day: number | null }> = [];
  for (let i = 0; i < startPad; i += 1) cells.push({ date: null, day: null });
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ date, day });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
  return cells;
}

export async function sendCommEmail(input: {
  to: string[];
  subject: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: input.to,
        subject: input.subject,
        body: input.body,
        html: false,
      }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: { message?: string } | string }
      | null;
    if (!res.ok || !json?.ok) {
      const err = json?.error;
      const message =
        typeof err === "string"
          ? err
          : err?.message || `Email send failed (HTTP ${res.status})`;
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Email send failed",
    };
  }
}

/**
 * Credentials and the EgoSMS handshake live entirely on the server
 * (`src/lib/sms/egosms.ts`) — the browser only supplies recipients and text.
 */
export async function sendCommSms(input: {
  to: string[];
  body: string;
}): Promise<{ ok: boolean; error?: string; via?: string }> {
  try {
    const res = await apiFetch("/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: input.to, body: input.body }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; via?: string; error?: { message?: string } | string }
      | null;
    if (!res.ok || !json?.ok) {
      const err = json?.error;
      const message =
        typeof err === "string"
          ? err
          : err?.message || `SMS send failed (HTTP ${res.status})`;
      return { ok: false, error: message };
    }
    return { ok: true, via: json.via };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "SMS send failed",
    };
  }
}
