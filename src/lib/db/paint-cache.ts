/**
 * IndexedDB paint cache — read-only snapshot for instant refresh.
 *
 * Postgres is the only write source of truth. This store never accepts CRUD
 * (create / update / delete / form save). It only mirrors rows already echoed
 * from a successful API hydrate so a hard refresh can paint chrome + open-route
 * rows before network returns. A failed save must never call savePaintCache.
 */

import type { ManagerRecord } from "@/lib/manager-entities";
import type { LedgerAccount, LedgerLine } from "@/lib/ledger/types";
import {
  getMemoryLedgerAccounts,
  getMemoryLedgerLines,
  getMemoryRecords,
  getMemorySetting,
  listMemoryRecordKeys,
  listMemorySettingKeys,
  setMemoryLedgerAccounts,
  setMemoryLedgerLines,
  setMemoryRecords,
  setMemorySetting,
} from "@/lib/db/client-store";

const DB_NAME = "financeiag-paint-v1";
const DB_VERSION = 1;
const STORE = "snapshot";
const SNAPSHOT_KEY = "latest";

/** Settings that affect chrome / first paint — keep the cache small. */
const PAINT_SETTING_KEYS = [
  "financeiag-manager-settings",
  "financeiag-enabled-tabs-v3",
  "financeiag-enabled-tabs",
  "financeiag-roles",
  "financeiag-users",
  "financeiag-theme",
  "financeiag-business-logo",
  "financeiag-business-profile",
  "financeiag-tax-codes",
  "financeiag-foreign-currencies",
  "financeiag-exchange-rates",
  "financeiag-divisions",
] as const;

/** Cap journal lines in the paint cache — full journal continues via API pages. */
const MAX_CACHED_LEDGER_LINES = 2_000;
/** Cap rows per entity in the paint cache. */
const MAX_CACHED_ENTITY_ROWS = 400;
/** Prefer caching the open-route + banking/sales masters. */
const MAX_CACHED_ENTITIES = 24;

export type PaintCacheSnapshot = {
  savedAt: number;
  userId?: string;
  settings: Record<string, unknown>;
  accounts: LedgerAccount[];
  lines: LedgerLine[];
  records: Array<{ module: string; entity: string; rows: ManagerRecord[] }>;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error("IndexedDB open failed"));
    };
  });
  return dbPromise;
}

function idbGet(db: IDBDatabase, key: string): Promise<PaintCacheSnapshot | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as PaintCacheSnapshot) || null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: PaintCacheSnapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function pickEntitiesForCache(): Array<{ module: string; entity: string }> {
  const all = listMemoryRecordKeys();
  if (typeof window === "undefined") return all.slice(0, MAX_CACHED_ENTITIES);
  const seg = window.location.pathname.replace(/^\//, "").split("/")[0] || "";
  const want: Array<{ module: string; entity: string }> = [];
  const seen = new Set<string>();
  const push = (module: string, entity: string) => {
    const id = `${module}:${entity}`;
    if (seen.has(id)) return;
    seen.add(id);
    want.push({ module, entity });
  };
  for (const row of all) {
    if (row.module === seg || (seg === "" && row.module === "banking")) {
      push(row.module, row.entity);
    }
  }
  for (const row of all) {
    if (
      (row.module === "accounts" && row.entity === "chart-of-accounts") ||
      (row.module === "banking" && row.entity === "bank-and-cash-accounts") ||
      (row.module === "sales" && row.entity === "customers") ||
      (row.module === "purchases" && row.entity === "suppliers")
    ) {
      push(row.module, row.entity);
    }
  }
  for (const row of all) {
    if (want.length >= MAX_CACHED_ENTITIES) break;
    push(row.module, row.entity);
  }
  return want.slice(0, MAX_CACHED_ENTITIES);
}

/**
 * Mirror already-hydrated tab memory into IndexedDB for the next hard refresh.
 * Call only after a successful server hydrate — never from a CRUD save path.
 */
export async function savePaintCache(userId?: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    // Refuse to snapshot an empty / pre-hydrate shell — that would cache a lie.
    if (!getMemoryLedgerAccounts().length && !listMemoryRecordKeys().length) {
      return;
    }
    const settings: Record<string, unknown> = {};
    for (const key of PAINT_SETTING_KEYS) {
      if (!listMemorySettingKeys().includes(key)) continue;
      settings[key] = getMemorySetting(key, null);
    }
    const records = pickEntitiesForCache().map(({ module, entity }) => ({
      module,
      entity,
      rows: getMemoryRecords(module, entity).slice(0, MAX_CACHED_ENTITY_ROWS),
    }));
    const snapshot: PaintCacheSnapshot = {
      savedAt: Date.now(),
      userId,
      settings,
      accounts: getMemoryLedgerAccounts(),
      lines: getMemoryLedgerLines().slice(0, MAX_CACHED_LEDGER_LINES),
      records,
    };
    const db = await openDb();
    await idbPut(db, SNAPSHOT_KEY, snapshot);
  } catch {
    /* private mode / quota — paint cache is best-effort */
  }
}

/**
 * Apply a cached snapshot into tab memory for instant first paint.
 * Returns true when something was restored. Caller must still hydrate from API.
 */
export async function restorePaintCache(expectedUserId?: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const db = await openDb();
    const snap = await idbGet(db, SNAPSHOT_KEY);
    if (!snap || !snap.savedAt) return false;
    // Discard stale snapshots (> 7 days) or wrong user.
    if (Date.now() - snap.savedAt > 7 * 24 * 60 * 60 * 1000) return false;
    if (
      expectedUserId &&
      snap.userId &&
      snap.userId !== expectedUserId
    ) {
      return false;
    }
    for (const [key, value] of Object.entries(snap.settings || {})) {
      if (value != null) setMemorySetting(key, value);
    }
    if (Array.isArray(snap.accounts) && snap.accounts.length) {
      setMemoryLedgerAccounts(snap.accounts);
    }
    if (Array.isArray(snap.lines) && snap.lines.length) {
      setMemoryLedgerLines(snap.lines);
    }
    for (const entry of snap.records || []) {
      if (!entry?.module || !entry?.entity || !Array.isArray(entry.rows)) continue;
      setMemoryRecords(entry.module, entry.entity, entry.rows);
    }
    return true;
  } catch {
    return false;
  }
}

export async function clearPaintCache(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const db = await openDb();
    await idbDelete(db, SNAPSHOT_KEY);
  } catch {
    /* ignore */
  }
}
