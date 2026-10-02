import { getCurrentSessionUser } from "@/lib/session-profile";
import { getMemorySetting, setMemorySetting } from "@/lib/db/client-store";
import { persistSettingToDb } from "@/lib/db/sync";
import { FRONTEND_ONLY } from "@/lib/frontend-only";
import { postToolsAuditEvent } from "@/lib/tools-activity-client";

export const FIELD_AUDIT_KEY = "financeiag-field-audit";

export type FieldAuditEntry = {
  id: string;
  timestamp: string;
  user: string;
  module: string;
  entity: string;
  recordId: string;
  field: string;
  from: string;
  to: string;
};

export function loadFieldAudit(limit = 500): FieldAuditEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = getMemorySetting<FieldAuditEntry[] | null>(FIELD_AUDIT_KEY, null);
    return Array.isArray(stored) ? stored.slice(0, limit) : [];
  } catch {
    return [];
  }
}

function write(entries: FieldAuditEntry[]) {
  const next = entries.slice(0, 5000);
  setMemorySetting(FIELD_AUDIT_KEY, next);
  void persistSettingToDb(FIELD_AUDIT_KEY, next);
}

/** Diff previous vs next record and append immutable field-level audit rows. */
export function logFieldChanges(input: {
  module: string;
  entity: string;
  recordId: string;
  previous?: Record<string, string> | null;
  next: Record<string, string>;
}) {
  if (typeof window === "undefined") return;
  const prev = input.previous || {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(input.next)]);
  const skip = new Set(["updatedAt", "createdAt", "id"]);
  const user = getCurrentSessionUser().name;
  const now = new Date().toISOString();
  const additions: FieldAuditEntry[] = [];
  for (const key of keys) {
    if (skip.has(key)) continue;
    const from = prev[key] ?? "";
    const to = input.next[key] ?? "";
    if (from === to) continue;
    additions.push({
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      timestamp: now,
      user,
      module: input.module,
      entity: input.entity,
      recordId: input.recordId,
      field: key,
      from,
      to,
    });
  }
  if (!additions.length) return;
  write([...additions, ...loadFieldAudit(5000)]);
  if (!FRONTEND_ONLY) return;
  for (const row of additions) {
    postToolsAuditEvent({
      action: "FieldChange",
      module: row.module,
      entity: row.entity,
      recordId: row.recordId,
      recordLabel: row.recordId,
      details: `${row.field}: “${row.from || "—"}” → “${row.to || "—"}”`,
      meta: {
        field: row.field,
        from: row.from.slice(0, 500),
        to: row.to.slice(0, 500),
      },
    });
  }
}
