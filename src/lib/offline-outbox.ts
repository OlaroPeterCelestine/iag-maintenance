"use client";

/**
 * Saves made on the floor without a connection.
 *
 * A technician fills a job card, marks a checklist step or records running
 * hours where the signal is poor; an operator reports a fault in a corner of
 * the plant with none. Losing that work to a dead connection is how paper
 * comes back. For the entities below, a save that could not leave the device
 * is kept here and sent, oldest first, when the connection returns.
 *
 * Only failures that never reached the server are queued: the device says it
 * is offline, or the request failed before any response. A timeout is not
 * queued — the server may have stored it, and the records API has no
 * idempotency key to make a replay safe. A save the server refuses (a missing
 * field, a value it does not accept) is kept as failed with its reason, never
 * dropped, so it can be put right and re-entered.
 */
import { apiFetch } from "@/lib/api-auth";

export const OFFLINE_ENTITIES = new Set([
  "production/fault-reports",
  "production/batch-records",
  "production/meter-readings",
  "production/checklist-steps",
]);

export const OUTBOX_EVENT = "iag-outbox-changed";
const KEY = "iag-maintenance-outbox-v1";

export type OutboxItem = {
  id: string;
  module: string;
  entity: string;
  method: "POST" | "PATCH";
  recordId?: string;
  payload: unknown;
  /** What it was, in words, for the list of waiting saves. */
  label: string;
  queuedAt: string;
  /** Set when the server refused it; the item then waits for the user. */
  error?: string;
};

export function canQueueOffline(moduleSlug: string, entityKey: string, method: string): boolean {
  return method !== "DELETE" && OFFLINE_ENTITIES.has(`${moduleSlug}/${entityKey}`);
}

/** The device says it has no connection. */
export function deviceOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** A failure that happened before any response — the request never landed. */
export function neverReachedServer(err: unknown): boolean {
  if (deviceOffline()) return true;
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  // fetch rejects with a TypeError for DNS, refused and dropped connections;
  // an AbortError (our timeout) is deliberately not here.
  // Only the browsers' own wording for "no response at all" — a TypeError
  // from our code is a bug, not a connection, and must not be queued.
  return /Failed to fetch|NetworkError when attempting to fetch|Load failed|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED/i.test(msg) &&
    !/AbortError|timed? ?out/i.test(msg);
}

function read(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function write(items: OutboxItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage full or blocked: the item stays in memory for this session only */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OUTBOX_EVENT));
}

export function outboxItems(): OutboxItem[] {
  return read();
}

export function labelFor(entity: string, payload: unknown): string {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const s = (k: string) => String(p[k] ?? "").trim();
  switch (entity) {
    case "fault-reports":
      return `Fault on ${s("workCenter") || "a machine"}: ${s("title")}`.trim();
    case "batch-records":
      return `Job card for ${s("workOrder") || "a work order"}`;
    case "meter-readings":
      return `${s("hours")} h on ${s("workCenter")}`;
    case "checklist-steps":
      return `Checklist step ${s("result") ? `marked ${s("result")}` : ""}`.trim();
    default:
      return entity;
  }
}

export function enqueue(item: Omit<OutboxItem, "id" | "queuedAt" | "label"> & { label?: string }): OutboxItem {
  const full: OutboxItem = {
    ...item,
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()),
    queuedAt: new Date().toISOString(),
    label: item.label || labelFor(item.entity, item.payload),
  };
  write([...read(), full]);
  return full;
}

export function discard(id: string) {
  write(read().filter((i) => i.id !== id));
}

function path(item: OutboxItem): string {
  const base = `/api/records/${encodeURIComponent(item.module)}/${encodeURIComponent(item.entity)}`;
  return item.recordId ? `${base}/${encodeURIComponent(item.recordId)}` : base;
}

let flushing = false;

/**
 * Send what is waiting, oldest first. Stops at the first save that still
 * cannot reach the server (still offline) so order is kept; a refused save
 * is marked failed and the rest continue.
 */
export async function flushOutbox(): Promise<{ sent: number; failed: number; waiting: number }> {
  if (flushing || deviceOffline()) {
    const all = read();
    return { sent: 0, failed: all.filter((i) => i.error).length, waiting: all.filter((i) => !i.error).length };
  }
  flushing = true;
  let sent = 0;
  try {
    for (const item of read().filter((i) => !i.error)) {
      let res: Response;
      try {
        res = await apiFetch(path(item), {
          method: item.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.payload),
          timeoutMs: 30_000,
        });
      } catch {
        break; // still no way through; try again later, in the same order
      }
      if (res.ok) {
        discard(item.id);
        sent++;
        continue;
      }
      if (res.status === 401 || res.status === 408 || res.status === 429 || res.status >= 500) break;
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      write(read().map((i) => (i.id === item.id ? { ...i, error: body?.error || `HTTP ${res.status}` } : i)));
    }
  } finally {
    flushing = false;
  }
  if (sent && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
  }
  const all = read();
  return { sent, failed: all.filter((i) => i.error).length, waiting: all.filter((i) => !i.error).length };
}

let installed = false;

/** Send when the connection returns, on load, and every minute while anything waits. */
export function installOutbox() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("online", () => void flushOutbox());
  void flushOutbox();
  window.setInterval(() => {
    if (read().some((i) => !i.error)) void flushOutbox();
  }, 60_000);
}
