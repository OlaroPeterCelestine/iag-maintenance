import type { ManagerRecord } from "@/lib/manager-entities";
import {
  getMemoryRecords,
  setMemoryRecords,
} from "@/lib/db/client-store";
import {
  consumeLastRecordsPersistError,
  createRecordInDb,
  deleteRecordInDb,
  patchRecordInDb,
  persistRecordsToDb,
  type PersistRecordsOptions,
} from "@/lib/db/sync";
import { loadServerActivityCache } from "@/lib/realtime-notifications";
import { FRONTEND_ONLY } from "@/lib/frontend-only";

export type SaveRecordsResult = {
  ok: boolean;
  /** Only `"postgres"` means the write is durable. Failed saves return `"none"`. */
  durable: "postgres" | "memory" | "none";
  error?: string;
};

export type SaveRecordsOptions = PersistRecordsOptions;

/**
 * Normalize a form/modal record to the shape stored in Postgres `entity_records.data`.
 * Same keys as EntityField.key (+ id / createdAt / updatedAt); all values are strings.
 */
export function shapeRecordForDatabase(record: ManagerRecord): ManagerRecord {
  const now = new Date().toISOString();
  const shaped: ManagerRecord = {
    id: String(record.id || crypto.randomUUID()),
    createdAt: String(record.createdAt || now),
    updatedAt: String(record.updatedAt || now),
  };
  for (const [key, value] of Object.entries(record)) {
    if (key === "id" || key === "createdAt" || key === "updatedAt") continue;
    if (value == null) continue;
    shaped[key] = typeof value === "string" ? value : String(value);
  }
  return shaped;
}

export function shapeRecordsForDatabase(records: ManagerRecord[]): ManagerRecord[] {
  return records.map(shapeRecordForDatabase);
}

function recordOrderTime(record: ManagerRecord): number {
  const stamp = String(record.updatedAt || record.createdAt || "").trim();
  const ms = stamp ? Date.parse(stamp) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Stable newest-first order for a records table.
 *
 * A collection PUT rewrites every row with one timestamp, so neither the API
 * echo nor the next GET carries an inherent order the browser can rely on.
 * Tables page at ten rows, so an unordered list drops a just-saved record onto
 * a random page and it reads as lost. Sort by the record's own stamp instead,
 * with the id as tie-break so equal timestamps never shuffle between renders.
 */
export function sortRecordsNewestFirst(records: ManagerRecord[]): ManagerRecord[] {
  // Parse each stamp once — this runs on every keystroke of the list filter,
  // and tables here carry thousands of rows.
  const keyed = records.map((record) => ({ record, at: recordOrderTime(record) }));
  keyed.sort((a, b) => {
    if (a.at !== b.at) return b.at - a.at;
    return String(a.record.id).localeCompare(String(b.record.id));
  });
  return keyed.map((entry) => entry.record);
}

/** When > 0, saveRecords skips per-write UI events (bulk seed/demo). */
let suppressRecordsChanged = 0;

export function beginBulkRecordsWrite() {
  suppressRecordsChanged += 1;
}

export function endBulkRecordsWrite() {
  suppressRecordsChanged = Math.max(0, suppressRecordsChanged - 1);
  if (suppressRecordsChanged === 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
  }
}

export function loadRecords(moduleSlug: string, entityKey: string): ManagerRecord[] {
  if (typeof window === "undefined") return [];
  const local = getMemoryRecords(moduleSlug, entityKey);
  if (moduleSlug !== "documents" || entityKey !== "history") return local;

  // Merge server ActivityLog (settings/auth/ledger + record diffs) into History.
  try {
    const server = loadServerActivityCache() as ManagerRecord[];
    if (!server.length) return local;
    const seen = new Set<string>();
    const merged: ManagerRecord[] = [];
    const fingerprint = (row: ManagerRecord) => {
      const action = String(row.action || "");
      const mod = String(row.module || "");
      const ent = String(row.entity || "");
      const label = String(row.recordLabel || "");
      const ts = String(row.timestamp || row.createdAt || "").slice(0, 16);
      return `${action}|${mod}|${ent}|${label}|${ts}`;
    };
    for (const row of [...server, ...local]) {
      const id = String(row.id || "");
      const fp = fingerprint(row);
      if (id && seen.has(`id:${id}`)) continue;
      if (seen.has(`fp:${fp}`)) continue;
      if (id) seen.add(`id:${id}`);
      seen.add(`fp:${fp}`);
      merged.push(row);
    }
    return merged.slice(0, 2000);
  } catch {
    return local;
  }
}

/**
 * Memory update + durable Postgres write via the Go API.
 * There is no offline mode — saves fail if the API/database is unreachable.
 */
export function saveRecords(
  moduleSlug: string,
  entityKey: string,
  records: ManagerRecord[],
  options?: SaveRecordsOptions,
): Promise<SaveRecordsResult> {
  return saveRecordsAsync(moduleSlug, entityKey, records, options);
}

/** Await Postgres durability. Fails closed if the API is unreachable. */
export async function saveRecordsAsync(
  moduleSlug: string,
  entityKey: string,
  records: ManagerRecord[],
  options?: SaveRecordsOptions,
): Promise<SaveRecordsResult> {
  if (typeof window === "undefined") {
    return { ok: false, durable: "none", error: "Not in browser" };
  }

  const shaped = shapeRecordsForDatabase(records);
  const previous = getMemoryRecords(moduleSlug, entityKey);
  // Optimistic paint only — durable truth comes back from the API.
  setMemoryRecords(moduleSlug, entityKey, shaped);
  if (suppressRecordsChanged === 0) {
    window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
  }

  const ok = await persistRecordsToDb(moduleSlug, entityKey, shaped, options);
  if (ok) {
    if (FRONTEND_ONLY) return { ok: true, durable: "memory" };
    return { ok: true, durable: "postgres" };
  }

  const detail = consumeLastRecordsPersistError();
  // If persist did not replace memory with a server conflict payload, revert the optimistic paint.
  const current = getMemoryRecords(moduleSlug, entityKey);
  const stillOptimistic =
    current.length === shaped.length &&
    current.every((row, i) => row.id === shaped[i]?.id);
  if (stillOptimistic) {
    setMemoryRecords(moduleSlug, entityKey, previous);
    if (suppressRecordsChanged === 0) {
      window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
    }
  }
  return {
    ok: false,
    durable: "none",
    error:
      detail ||
      "Could not save to the database. Nothing was stored until the API accepts the write.",
  };
}

export type ItemSaveResult = SaveRecordsResult & {
  /** The row as Postgres stored it (server stamps applied). */
  record?: ManagerRecord | null;
  /** True when the API already posted this document's journal. */
  ledgerPosted?: boolean;
  ledgerError?: string;
  code?: string;
};

/**
 * Durable single-row writes.
 *
 * saveRecordsAsync sends the entire collection on every save, so one new
 * payment costs a payload proportional to every payment ever entered — and the
 * API rewrites the whole table to store it. These send one row. Bulk paths
 * (CSV import, restore, admin reset) keep using the collection write, which is
 * what it is actually for.
 */
export async function createRecordAsync(
  moduleSlug: string,
  entityKey: string,
  record: ManagerRecord,
): Promise<ItemSaveResult> {
  if (typeof window === "undefined") {
    return { ok: false, durable: "none", error: "Not in browser" };
  }
  const shaped = shapeRecordForDatabase(record);
  const result = await createRecordInDb(moduleSlug, entityKey, shaped);
  if (!result.ok) {
    return { ok: false, durable: "none", error: result.error, code: result.code };
  }
  return {
    ok: true,
    durable: "postgres",
    record: result.record,
    ledgerPosted: result.ledgerPosted,
    ledgerError: result.ledgerError,
  };
}

export async function updateRecordAsync(
  moduleSlug: string,
  entityKey: string,
  id: string,
  values: Record<string, string>,
): Promise<ItemSaveResult> {
  if (typeof window === "undefined") {
    return { ok: false, durable: "none", error: "Not in browser" };
  }
  // Send only the fields the form changed — the API merges onto the stored row.
  const patch: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === "id" || key === "createdAt" || key === "updatedAt") continue;
    if (value == null) continue;
    patch[key] = typeof value === "string" ? value : String(value);
  }
  const result = await patchRecordInDb(moduleSlug, entityKey, id, patch);
  if (!result.ok) {
    return { ok: false, durable: "none", error: result.error, code: result.code };
  }
  return {
    ok: true,
    durable: "postgres",
    record: result.record,
    ledgerPosted: result.ledgerPosted,
    ledgerError: result.ledgerError,
  };
}

/** Delete rows one call each; the first failure stops and reports. */
export async function deleteRecordsAsync(
  moduleSlug: string,
  entityKey: string,
  ids: string[],
): Promise<SaveRecordsResult> {
  if (typeof window === "undefined") {
    return { ok: false, durable: "none", error: "Not in browser" };
  }
  for (const id of ids) {
    const result = await deleteRecordInDb(moduleSlug, entityKey, id);
    if (!result.ok) {
      return { ok: false, durable: "none", error: result.error };
    }
  }
  return { ok: true, durable: "postgres" };
}

/** Shared UI event for a durable write that did not reach Postgres. */
export function notifyPersistFailure(key: string, error: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("financeiag-persist-failed", {
      detail: { kind: "records", key, error },
    }),
  );
}

/** Imports / critical path: require Postgres. */
export async function saveRecordsToPostgresOrThrow(
  moduleSlug: string,
  entityKey: string,
  records: ManagerRecord[],
  options?: SaveRecordsOptions,
): Promise<SaveRecordsResult> {
  const result = await saveRecordsAsync(moduleSlug, entityKey, records, options);
  if (result.durable === "postgres") return result;
  throw new Error(result.error || `Failed to save ${moduleSlug}/${entityKey}`);
}
