import type { ManagerRecord } from "@/lib/manager-entities";
import { getCurrentSessionUser } from "@/lib/session-profile";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";

export const DELETED_RECORDS_ENTITY = "deleted-records";
export const DELETED_RECORDS_MODULE = "documents";

const MAX_ROWS = 5000;

/** Audit keys owned by the deleted-records row (not copied from the source). */
export const DELETED_RECORD_META_KEYS = new Set([
  "id",
  "createdAt",
  "updatedAt",
  "timestamp",
  "deletedBy",
  "deletedByUserId",
  "deletedByUsername",
  "deletedByEmail",
  "deletedByRole",
  "module",
  "entity",
  "recordId",
  "recordLabel",
  "details",
  "status",
  "snapshot",
]);

export type DeletedRecordEntry = ManagerRecord & {
  timestamp: string;
  deletedBy: string;
  deletedByUserId: string;
  deletedByUsername: string;
  deletedByEmail: string;
  deletedByRole: string;
  module: string;
  entity: string;
  recordId: string;
  recordLabel: string;
  details: string;
  status: string;
};

function actor() {
  if (typeof window === "undefined") {
    return {
      id: "",
      name: "Administrator",
      username: "administrator",
      email: "",
      role: "",
    };
  }
  try {
    const user = getCurrentSessionUser();
    return {
      id: user.id || "",
      name: user.name || user.username || user.email || "Unknown",
      username: user.username || "",
      email: user.email || "",
      role: user.role || "",
    };
  } catch {
    return {
      id: "",
      name: "Administrator",
      username: "administrator",
      email: "",
      role: "",
    };
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

/** Turn camelCase / snake_case keys into readable labels. */
export function humanizeFieldKey(key: string): string {
  return key
    .replace(/^original/, "Original ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Copy source record fields onto the deleted-records entry as normal string fields
 * (not a JSON blob). Conflicting meta keys are renamed.
 */
export function flattenDeletedRecordData(
  record: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value == null || value === "") continue;
    const text = typeof value === "string" ? value : String(value);
    if (key === "id") continue;
    if (key === "status") {
      out.originalStatus = text;
      continue;
    }
    if (key === "createdAt") {
      out.originalCreatedAt = text;
      continue;
    }
    if (key === "updatedAt") {
      out.originalUpdatedAt = text;
      continue;
    }
    if (DELETED_RECORD_META_KEYS.has(key)) {
      out[`original${key.charAt(0).toUpperCase()}${key.slice(1)}`] = text;
      continue;
    }
    out[key] = text;
  }
  return out;
}

function readDeleted(): DeletedRecordEntry[] {
  if (typeof window === "undefined") return [];
  return loadRecords(DELETED_RECORDS_MODULE, DELETED_RECORDS_ENTITY) as DeletedRecordEntry[];
}

function writeDeleted(entries: DeletedRecordEntry[]) {
  void saveRecords(DELETED_RECORDS_MODULE, DELETED_RECORDS_ENTITY, entries.slice(0, MAX_ROWS)).then(
    (saved) => {
      if (!saved.ok || saved.durable !== "postgres") {
        notifyPersistFailure(
          `${DELETED_RECORDS_MODULE}/${DELETED_RECORDS_ENTITY}`,
          saved.error ||
            "A record was deleted, but its backup copy could not be saved — it cannot be restored.",
        );
      }
    },
  );
}

/**
 * Persist deleted record fields as normal data, attributed to the signed-in account.
 * Shown under Documents → Deleted Records.
 */
export function logDeletedRecord(input: {
  module: string;
  entity: string;
  record: Record<string, string>;
  details?: string;
}) {
  if (typeof window === "undefined") return;
  if (input.entity === DELETED_RECORDS_ENTITY || input.entity === "history") return;

  const who = actor();
  const now = new Date().toISOString();
  const label = recordLabel(input.record);
  const entry: DeletedRecordEntry = {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    createdAt: now,
    updatedAt: now,
    timestamp: now.slice(0, 19).replace("T", " "),
    deletedBy: who.name,
    deletedByUserId: who.id,
    deletedByUsername: who.username,
    deletedByEmail: who.email,
    deletedByRole: who.role,
    module: input.module,
    entity: input.entity,
    recordId: String(input.record.id || ""),
    recordLabel: label,
    details:
      input.details ||
      `Deleted by ${who.name}${who.email ? ` (${who.email})` : ""}`,
    status: "Deleted",
    ...flattenDeletedRecordData(input.record),
  };
  writeDeleted([entry, ...readDeleted()]);
}
