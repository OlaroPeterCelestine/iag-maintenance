/**
 * In-memory client store. When FRONTEND_ONLY, also persist to localStorage.
 */

import type { ManagerRecord } from "@/lib/manager-entities";
import type { LedgerAccount, LedgerLine } from "@/lib/ledger/types";
import { FRONTEND_ONLY } from "@/lib/frontend-only";

const RECORDS_PREFIX = "financeiag-records:";
const LEDGER_ACCOUNTS_KEY = "financeiag-ledger:accounts";
const LEDGER_LINES_KEY = "financeiag-ledger:lines";
const FRONTEND_STORE_KEY = "iag-maintenance-store-v1";

/** Prefer empty — prefs/flags live in memory + Postgres. No durable localStorage keys. */
export const LOCAL_UI_KEYS = new Set<string>();

function isBusinessLocalStorageKey(key: string) {
  return key.startsWith("financeiag-") || key.startsWith(RECORDS_PREFIX);
}

/** Scrub every financeiag-* key from localStorage (DB is SoT). Skipped in frontend-only mode. */
export function scrubBusinessLocalStorage() {
  if (typeof window === "undefined") return;
  if (FRONTEND_ONLY) return;
  if (typeof window === "undefined") return;
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (isBusinessLocalStorageKey(key)) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

const recordsMem = new Map<string, ManagerRecord[]>();
const settingsMem = new Map<string, unknown>();
let ledgerAccountsMem: LedgerAccount[] | null = null;
let ledgerLinesMem: LedgerLine[] | null = null;
let migratedFromLocal = false;
let frontendStoreHydrated = false;

function persistFrontendStore() {
  if (!FRONTEND_ONLY || typeof window === "undefined") return;
  try {
    localStorage.setItem(
      FRONTEND_STORE_KEY,
      JSON.stringify({
        records: Object.fromEntries(recordsMem),
        settings: Object.fromEntries(settingsMem),
        accounts: ledgerAccountsMem,
        lines: ledgerLinesMem,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function hydrateFrontendLocalStore() {
  if (!FRONTEND_ONLY || typeof window === "undefined" || frontendStoreHydrated) return;
  frontendStoreHydrated = true;
  try {
    const raw = localStorage.getItem(FRONTEND_STORE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      records?: Record<string, ManagerRecord[]>;
      settings?: Record<string, unknown>;
      accounts?: LedgerAccount[] | null;
      lines?: LedgerLine[] | null;
    };
    if (parsed.records && typeof parsed.records === "object") {
      for (const [key, rows] of Object.entries(parsed.records)) {
        if (Array.isArray(rows)) recordsMem.set(key, rows);
      }
    }
    if (parsed.settings && typeof parsed.settings === "object") {
      for (const [key, value] of Object.entries(parsed.settings)) {
        settingsMem.set(key, value);
      }
    }
    if (Array.isArray(parsed.accounts)) ledgerAccountsMem = parsed.accounts;
    if (Array.isArray(parsed.lines)) ledgerLinesMem = parsed.lines;
  } catch {
    /* ignore corrupt store */
  }
}

function recordKey(moduleSlug: string, entityKey: string) {
  return `${moduleSlug}:${entityKey}`;
}


function recordFieldString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (rec.Time != null || rec.time != null) {
      return recordFieldString(rec.Time ?? rec.time);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

function coerceMemoryRecord(row: ManagerRecord): ManagerRecord {
  // row already satisfies ManagerRecord (id/createdAt/updatedAt present as
  // strings), so the loop below always copies them through — next just can't
  // be typed as ManagerRecord until it's fully populated.
  const next: Record<string, string> = {};
  let changed = false;
  for (const [key, value] of Object.entries(row)) {
    if (value == null) {
      changed = true;
      continue;
    }
    if (typeof value === "string") {
      next[key] = value;
      continue;
    }
    changed = true;
    next[key] = recordFieldString(value);
  }
  return changed ? (next as ManagerRecord) : row;
}

function coerceMemoryRecords(records: ManagerRecord[]): ManagerRecord[] {
  let changed = false;
  const next = records.map((row) => {
    const coerced = coerceMemoryRecord(row);
    if (coerced !== row) changed = true;
    return coerced;
  });
  return changed ? next : records;
}

export function getMemoryRecords(moduleSlug: string, entityKey: string): ManagerRecord[] {
  hydrateFrontendLocalStore();
  const key = recordKey(moduleSlug, entityKey);
  const rows = recordsMem.get(key) ?? [];
  const coerced = coerceMemoryRecords(rows);
  if (coerced !== rows) recordsMem.set(key, coerced);
  return coerced;
}

export function setMemoryRecords(
  moduleSlug: string,
  entityKey: string,
  records: ManagerRecord[],
) {
  recordsMem.set(recordKey(moduleSlug, entityKey), coerceMemoryRecords(records));
  persistFrontendStore();
}

export function getMemorySetting<T>(key: string, fallback: T): T {
  hydrateFrontendLocalStore();
  if (!settingsMem.has(key)) return fallback;
  return settingsMem.get(key) as T;
}

export function hasMemorySetting(key: string): boolean {
  hydrateFrontendLocalStore();
  return settingsMem.has(key);
}

export function setMemorySetting(key: string, value: unknown) {
  settingsMem.set(key, value);
  persistFrontendStore();
}

export function removeMemorySetting(key: string) {
  settingsMem.delete(key);
  persistFrontendStore();
}

export function getMemoryLedgerAccounts(): LedgerAccount[] {
  hydrateFrontendLocalStore();
  return ledgerAccountsMem ? [...ledgerAccountsMem] : [];
}

export function setMemoryLedgerAccounts(accounts: LedgerAccount[]) {
  ledgerAccountsMem = accounts;
  persistFrontendStore();
}

export function getMemoryLedgerLines(): LedgerLine[] {
  hydrateFrontendLocalStore();
  return ledgerLinesMem ? [...ledgerLinesMem] : [];
}

export function setMemoryLedgerLines(lines: LedgerLine[]) {
  ledgerLinesMem = lines;
  persistFrontendStore();
}

export function listMemoryRecordKeys(): Array<{ module: string; entity: string }> {
  return [...recordsMem.keys()].map((key) => {
    const colon = key.indexOf(":");
    return { module: key.slice(0, colon), entity: key.slice(colon + 1) };
  });
}

/**
 * Discard leftover financeiag-* keys from localStorage.
 * Never imports them into memory or Postgres — DB is the only source of truth.
 */
export function migrateBusinessDataOutOfLocalStorage(): boolean {
  if (typeof window === "undefined") return false;
  if (FRONTEND_ONLY) return false;
  if (migratedFromLocal) return false;
  migratedFromLocal = true;
  scrubBusinessLocalStorage();
  return false;
}

export function listMemorySettingKeys(): string[] {
  return [...settingsMem.keys()];
}

/** Snapshot all in-memory business data as serializable key → JSON string. */
export function snapshotMemoryStore(): Record<string, string> {
  const store: Record<string, string> = {};
  for (const [key, records] of recordsMem) {
    store[`${RECORDS_PREFIX}${key}`] = JSON.stringify(records);
  }
  if (ledgerAccountsMem) {
    store[LEDGER_ACCOUNTS_KEY] = JSON.stringify(ledgerAccountsMem);
  }
  if (ledgerLinesMem) {
    store[LEDGER_LINES_KEY] = JSON.stringify(ledgerLinesMem);
  }
  for (const [key, value] of settingsMem) {
    // Tab/JWT identity must never enter shared backups or cross-user restores.
    if (key === "financeiag-session") continue;
    store[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return store;
}

/** Load one financeiag-* key into the in-memory store (used by backup restore / migrate). */
export function applyRawKeyToMemory(key: string, raw: string) {
  try {
    if (key.startsWith(RECORDS_PREFIX)) {
      const rest = key.slice(RECORDS_PREFIX.length);
      const colon = rest.indexOf(":");
      if (colon > 0) {
        const moduleSlug = rest.slice(0, colon);
        const entity = rest.slice(colon + 1);
        const parsed = JSON.parse(raw) as ManagerRecord[];
        if (Array.isArray(parsed)) {
          recordsMem.set(recordKey(moduleSlug, entity), parsed);
        }
      }
      return;
    }
    if (key === LEDGER_ACCOUNTS_KEY) {
      const parsed = JSON.parse(raw) as LedgerAccount[];
      if (Array.isArray(parsed)) ledgerAccountsMem = parsed;
      return;
    }
    if (key === LEDGER_LINES_KEY) {
      const parsed = JSON.parse(raw) as LedgerLine[];
      if (Array.isArray(parsed)) ledgerLinesMem = parsed;
      return;
    }
    if (key.startsWith("financeiag-")) {
      // Never import another desk's login identity into this tab.
      if (key === "financeiag-session") return;
      try {
        settingsMem.set(key, JSON.parse(raw) as unknown);
      } catch {
        settingsMem.set(key, raw);
      }
    }
  } catch {
    /* ignore bad key */
  }
}

export function clearMemoryStore(options?: { keepSession?: boolean }) {
  const keepSession = options?.keepSession === true;
  const sessionKeys = [
    "financeiag-session",
    "financeiag-keep-signed-in",
    "financeiag-sessions",
    "financeiag-idle-timeout-ms",
  ];
  const preserved = new Map<string, unknown>();
  if (keepSession) {
    for (const key of sessionKeys) {
      if (settingsMem.has(key)) preserved.set(key, settingsMem.get(key));
    }
  }
  recordsMem.clear();
  settingsMem.clear();
  ledgerAccountsMem = null;
  ledgerLinesMem = null;
  for (const [key, value] of preserved) {
    settingsMem.set(key, value);
  }
  persistFrontendStore();
}
