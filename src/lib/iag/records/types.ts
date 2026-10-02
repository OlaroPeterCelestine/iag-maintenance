/**
 * Record adapter contract.
 *
 * The app talks to one generic endpoint — `/api/records/:module/:entity` — and
 * expects a flat collection of `ManagerRecord` (every value a string). Each
 * adapter translates one module/entity pair onto the IAG service that actually
 * owns that data.
 */
import type { ServiceKey } from "@/lib/iag/config";

/** Mirrors ManagerRecord in src/lib/manager-entities.ts. */
export type AppRecord = Record<string, string> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type AdapterContext = {
  module: string;
  entity: string;
  /** Raw query string from the incoming request (filters, paging). */
  query: URLSearchParams;
};

/**
 * A verb on one record that is not create, update or delete.
 *
 * Real services expose plenty of these — post a receipt, approve a count,
 * authorise a slip — and a collection-shaped client had nowhere to put them.
 * The consequence was concrete: Stock In and Stock Out create documents that
 * sit in `draft`, stock moves only on `POST /receipts/:id/post`, and with no
 * way to express that verb the app recorded paperwork that never moved stock.
 *
 * `permission` is the codename the service gates the verb on. It is checked in
 * the browser only to decide whether to offer the button; the service decides
 * whether it runs.
 */
export type RecordAction = {
  /** Stable id, used in the URL: /api/records/:module/:entity/:id/:action. */
  id: string;
  /** Button label, in the user's words. */
  label: string;
  /** Past tense, for the confirmation: "Posted". */
  doneLabel: string;
  /** Service permission that gates the verb, when there is one. */
  permission?: string;
  /**
   * When set, the action is offered only for records whose status matches
   * (compared case-insensitively). A posted receipt cannot be posted again,
   * and offering the button anyway means the only way to learn that is to
   * press it.
   */
  whenStatus?: string[];
  run(ctx: AdapterContext, id: string): Promise<AppRecord | null>;
};

/** The action as the browser sees it — everything but the call itself. */
export type RecordActionDescriptor = Omit<RecordAction, "run">;

export type RecordAdapter = {
  service: ServiceKey;
  /** Upstream path, for docs and the coverage report. */
  resource: string;
  /** Set when the upstream is read-only for this app. */
  readOnly?: boolean;
  list(ctx: AdapterContext): Promise<AppRecord[]>;
  create?(ctx: AdapterContext, record: AppRecord): Promise<AppRecord | null>;
  update?(
    ctx: AdapterContext,
    id: string,
    record: AppRecord,
  ): Promise<AppRecord | null>;
  remove?(ctx: AdapterContext, id: string): Promise<void>;
  /** Per-record verbs beyond CRUD. See RecordAction. */
  actions?: RecordAction[];
};

/** Strip the server-only half so the list response can carry the rest. */
export function describeActions(
  adapter: RecordAdapter,
): RecordActionDescriptor[] {
  return (adapter.actions || []).map(({ run: _run, ...rest }) => rest);
}

/**
 * The record's attachments as *references only*, ready to send upstream.
 *
 * Two things make this its own function rather than a field mapping.
 *
 * First, correctness of the thing being stored. A record written before blob
 * storage still carries its files inline as base64 `dataUrl`s — up to 1.5 MB
 * each, 8 MB in total. Putting those into a JSONB column would bloat a row that
 * stock queries join, so anything without a `storageId` is dropped here: its
 * bytes were never uploaded, and a reference to nothing is worse than nothing.
 *
 * Second, it is the same decision on every screen. Four adapters carry
 * attachments and each doing its own filtering is four chances to ship a data
 * URL into a database. `registry.test.ts` asserts no create body ever contains
 * the string `data:` for exactly this reason.
 *
 * Returns undefined when there is nothing to send, so `omitEmpty` drops the key
 * and a save with no attachments does not clear one that is already stored.
 */
export type AttachmentRef = {
  id: string;
  storageId: string;
  name: string;
  mime: string;
  size: number;
  uploadedAt: string;
};

export function attachmentRefs(raw: unknown): AttachmentRef[] | undefined {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;

  const out: AttachmentRef[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const storageId = str(rec.storageId).trim();
    // No storage id means the bytes are still inline and were never uploaded.
    if (!storageId) continue;
    const name = str(rec.name).trim();
    if (!name) continue;
    out.push({
      id: str(rec.id).trim() || storageId,
      storageId,
      name,
      mime: str(rec.mime).trim() || "application/octet-stream",
      size: Number(rec.size) || 0,
      uploadedAt: str(rec.uploadedAt).trim(),
    });
    // Matches ATTACHMENT_MAX_FILES; a longer list is a client that ignored it.
    if (out.length >= 10) break;
  }
  return out.length ? out : undefined;
}

/** The inverse: what came back from a service, as the flat record's JSON string. */
export function attachmentsJson(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value.length ? JSON.stringify(value) : "";
}

/** Coerce any upstream scalar into the string the UI expects. */
export function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => str(v)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    // Common shapes: { name }, { code }, { id }
    for (const key of ["name", "title", "label", "code", "reference", "id"]) {
      if (typeof rec[key] === "string") return rec[key] as string;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

/** Money fields arrive as numbers, strings or {amount,currency}; normalise. */
export function money(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    if (rec.amount !== undefined) return money(rec.amount);
    if (rec.value !== undefined) return money(rec.value);
  }
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : str(value);
}

/** ISO date, trimmed to YYYY-MM-DD when the UI shows a date-only field. */
export function isoDate(value: unknown): string {
  const raw = str(value);
  if (!raw) return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? match[1] : raw;
}

/** First non-empty value across a list of candidate keys. */
export function pick(
  row: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/**
 * Revision token the sync layer uses for optimistic concurrency:
 * `${count}:${maxUpdatedAtMs}` — see `revisionParts` in src/lib/db/sync.ts.
 */
export function revisionFor(records: AppRecord[]): string {
  let maxMs = 0;
  for (const record of records) {
    const ms = Date.parse(record.updatedAt || record.createdAt || "");
    if (Number.isFinite(ms) && ms > maxMs) maxMs = ms;
  }
  return `${records.length}:${maxMs}`;
}/**
 * Coerce a UI date string into what Go's encoding/json will accept for a
 * `time.Time` field — RFC3339, or `undefined` so the key is omitted entirely.
 *
 * A date-only value ("2026-08-21") fails to unmarshal into time.Time and 400s
 * the whole request, so it is widened to midnight UTC. Anything already
 * carrying a time component is passed through untouched.
 */
export function rfc3339(value: unknown): string | undefined {
  const raw = str(value).trim();
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00Z`;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** Drop empty strings so optional upstream fields stay absent, not blank. */
export function omitEmpty(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out;
}
