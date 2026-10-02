import type { ManagerRecord } from "@/lib/manager-entities";
import { getCurrentSessionUser } from "@/lib/session-profile";
import { createRecordAsync } from "@/lib/records-store";
import { getMemoryRecords, setMemoryRecords } from "@/lib/db/client-store";
import { loadManagerSettings } from "@/lib/manager-settings";
import { isHandlingUnauthorized } from "@/lib/api-auth";

export const HISTORY_STORAGE_KEY = "financeiag-records:documents:history";

export type HistoryAction = "Created" | "Updated" | "Deleted" | "Cloned" | "Copied" | "Imported";

export type HistoryEntry = ManagerRecord & {
  timestamp: string;
  user: string;
  userId: string;
  username: string;
  email: string;
  action: HistoryAction | string;
  module: string;
  entity: string;
  recordLabel: string;
  details: string;
  status: string;
};

function currentActor() {
  if (typeof window === "undefined") {
    return { name: "Administrator", id: "", username: "", email: "" };
  }
  try {
    const user = getCurrentSessionUser();
    return {
      name: user.name || user.username || user.email || "Administrator",
      id: user.id || "",
      username: user.username || "",
      email: user.email || "",
    };
  } catch {
    return { name: "Administrator", id: "", username: "", email: "" };
  }
}

function recordLabel(record: Record<string, string>): string {
  return (
    record.reference ||
    record.name ||
    record.customer ||
    record.party ||
    record.employee ||
    record.code ||
    record.id?.slice(0, 8) ||
    "Record"
  );
}

/** Local client history only — never merge server ActivityLog (avoids write-back loops). */
function readHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  return getMemoryRecords("documents", "history") as HistoryEntry[];
}

/**
 * Append one audit row. Prefer a single-row POST over rewriting the whole
 * documents/history collection (which raced, double-toasted, and 401'd loudly
 * when the session was already gone).
 */
function writeHistory(entry: HistoryEntry) {
  const previous = readHistory();
  const next = [entry, ...previous].slice(0, 2000);
  setMemoryRecords("documents", "history", next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
  }
  if (isHandlingUnauthorized()) return;

  void createRecordAsync("documents", "history", entry).then((saved) => {
    if (saved.ok && saved.durable === "postgres") return;
    const err = saved.error || "";
    // Session is gone — apiFetch already starts sign-out; keep the optimistic
    // row until logout clears memory, and do not fire a second toast (itemWrite
    // already notified, and 401s are softened in the toaster).
    if (/\(401\)/.test(err) || /Unauthorized|Sign in required/i.test(err)) {
      return;
    }
    // Non-auth failure: roll back the optimistic row if the server never took it.
    const current = readHistory();
    if (current.some((row) => row.id === entry.id)) {
      setMemoryRecords(
        "documents",
        "history",
        current.filter((row) => row.id !== entry.id),
      );
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
      }
    }
  });
}

/** Append an audit row into Documents → History (memory + Postgres). */
export function logHistory(input: {
  action: HistoryAction | string;
  module: string;
  entity: string;
  record: Record<string, string>;
  details?: string;
}) {
  if (typeof window === "undefined") return;
  if (input.entity === "history" || input.entity === "deleted-records") return;

  const who = currentActor();
  const now = new Date().toISOString();
  const entry: HistoryEntry = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    createdAt: now,
    updatedAt: now,
    timestamp: now.slice(0, 16).replace("T", " "),
    user: who.name,
    userId: who.id,
    username: who.username,
    email: who.email,
    action: input.action,
    module: input.module,
    entity: input.entity,
    recordLabel: recordLabel(input.record),
    details: input.details || `${input.action} ${input.entity}`,
    status: "Logged",
  };
  writeHistory(entry);
}

/** Whether a transaction date is locked under Settings → Lock Date. */
export function isDateLocked(dateValue: string | undefined | null): boolean {
  if (typeof window === "undefined" || !dateValue) return false;
  try {
    const settings = loadManagerSettings();
    // Historical data load: suspend lock while backdating is allowed.
    if (settings.allowBackdating !== false) return false;
    if (!settings.lockEnabled || !settings.lockDate) return false;
    const tx = dateValue.slice(0, 10);
    return tx <= settings.lockDate;
  } catch {
    return false;
  }
}

export function assertUnlocked(values: Record<string, string>): string | null {
  const date =
    values.date ||
    values.issueDate ||
    values.startDate ||
    values.nextIssueDate ||
    values.asOf ||
    values.acquired ||
    values.purchaseDate ||
    values.timestamp;
  if (isDateLocked(date)) {
    return `This date is on or before the lock date. Enable “Allow backdating” or unlock in Settings → Lock Date.`;
  }
  return null;
}
