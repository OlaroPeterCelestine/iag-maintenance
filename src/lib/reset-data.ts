/**
 * Clean-up helpers for wiping test data.
 * - cleanTransactions: remove every transaction + ledger posting but keep the
 *   setup (chart of accounts, customers, suppliers, items, employees, banks…).
 * - resetBusinessData: wipe the whole business back to a blank slate.
 */

import { rebuildOpeningBalanceEntry } from "@/lib/ledger/opening-balances";
import { apiFetch } from "@/lib/api-auth";
import {
  clearMemoryStore,
  getMemoryLedgerAccounts,
  getMemoryRecords,
  getMemorySetting,
  listMemoryRecordKeys,
  removeMemorySetting,
  setMemoryLedgerAccounts,
  setMemoryLedgerLines,
  setMemoryRecords,
  setMemorySetting,
  snapshotMemoryStore,
} from "@/lib/db/client-store";
import {
  HYDRATE_SESSION_KEY,
  persistLedgerLinesToDb,
  persistRecordsToDb,
  persistSettingToDb,
} from "@/lib/db/sync";
import { getAppFlag, setAppFlag, removeAppPref, persistFlagImmediate } from "@/lib/db/app-prefs";
import type { ManagerRecord } from "@/lib/manager-entities";

const FIELD_AUDIT_KEY = "financeiag-field-audit";
const BANK_STATEMENTS_KEY = "financeiag-bank-statements";
const HISTORY_ENTITY = "history";
const DELETED_RECORDS_ENTITY = "deleted-records";

/** Audit entities preserved when clearHistory is false. */
const AUDIT_ENTITIES = new Set([HISTORY_ENTITY, DELETED_RECORDS_ENTITY]);

/** Record stores that hold master/setup data and must survive a transaction clean. */
const KEEP_ENTITIES = new Set([
  "chart-of-accounts",
  "customers",
  "suppliers",
  "employees",
  "inventory-items",
  "non-inventory-items",
  "inventory-kits",
  "inventory-locations",
  "bank-and-cash-accounts",
  "projects",
  "capital-accounts",
  "capital-subaccounts",
  "folders",
]);

/** Movement fields written onto inventory items by transactions. */
const INVENTORY_MOVEMENT_FIELDS = [
  "inventoryMoves",
  "inventoryValueMoves",
  "costLayers",
  "inventoryConsumedLayers",
];

/** Bump to force a fresh blank-slate wipe for every browser / deploy. */
export const USER_DATA_WIPE_KEY = "financeiag-user-data-wiped-v5";

/** One-shot wipe that keeps Chart of Accounts only. */
export const KEEP_COA_WIPE_KEY = "financeiag-wipe-keep-coa-v1";

/** After keep-CoA wipe, do not re-seed demo samples. */
export const KEEP_BLANK_SLATE_KEY = "financeiag-keep-blank-slate-v1";

/** One-shot: skip the next hydrate in this tab (memory only). */
let skipHydrateOnce = false;

export function markSkipHydrateOnce() {
  skipHydrateOnce = true;
}

export function consumeSkipHydrateOnce(): boolean {
  const v = skipHydrateOnce;
  skipHydrateOnce = false;
  return v;
}

/** Auth + light UI that survive a full business wipe (in memory settings). */
const KEEP_AUTH_SETTING_KEYS = new Set([
  "financeiag-users",
  "financeiag-roles",
  "financeiag-enabled-tabs",
]);

function dispatchDataChanged() {
  window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
  window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
  window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
  window.dispatchEvent(new Event("financeiag-tabs-changed"));
}

export type CleanTransactionsResult = {
  clearedStores: number;
  keptStores: number;
};

/**
 * Delete all transactions and ledger postings, keeping the chart of accounts
 * and other master data. Inventory on-hand movements are reset too.
 */
export function cleanTransactions(
  options: { clearHistory?: boolean } = {},
): CleanTransactionsResult {
  if (typeof window === "undefined") return { clearedStores: 0, keptStores: 0 };
  const clearHistory = options.clearHistory ?? true;

  let clearedStores = 0;
  let keptStores = 0;

  for (const { module, entity } of listMemoryRecordKeys()) {
    if (AUDIT_ENTITIES.has(entity) && !clearHistory) {
      keptStores += 1;
      continue;
    }
    if (KEEP_ENTITIES.has(entity)) {
      keptStores += 1;
      continue;
    }
    setMemoryRecords(module, entity, []);
    void persistRecordsToDb(module, entity, [], { mode: "replace", allowEmpty: true });
    clearedStores += 1;
  }

  const items = getMemoryRecords("inventory", "inventory-items");
  if (items.length) {
    const reset = items.map((item) => {
      const next = { ...item } as ManagerRecord;
      for (const field of INVENTORY_MOVEMENT_FIELDS) delete next[field];
      return next;
    });
    setMemoryRecords("inventory", "inventory-items", reset);
    void persistRecordsToDb("inventory", "inventory-items", reset);
  }

  setMemoryLedgerLines([]);
  void persistLedgerLinesToDb([], { allowEmpty: true });
  removeMemorySetting(BANK_STATEMENTS_KEY);
  void persistSettingToDb(BANK_STATEMENTS_KEY, []);
  if (clearHistory) {
    removeMemorySetting(FIELD_AUDIT_KEY);
    void persistSettingToDb(FIELD_AUDIT_KEY, []);
  }

  try {
    rebuildOpeningBalanceEntry();
  } catch {
    /* opening balances rebuild is best-effort */
  }

  dispatchDataChanged();
  return { clearedStores, keptStores };
}

export type ResetBusinessResult = { keysRemoved: number };

/**
 * Wipe the entire business (records, ledger, settings, profile) back to blank.
 * UI preferences are preserved. Caller should reload the page afterwards.
 */
export function resetBusinessData(): ResetBusinessResult {
  if (typeof window === "undefined") return { keysRemoved: 0 };
  const before = Object.keys(snapshotMemoryStore()).length;
  clearMemoryStore();
  dispatchDataChanged();
  return { keysRemoved: before };
}

/**
 * Full business wipe that keeps the signed-in user / roles so the operator is
 * not kicked out mid-clean.
 */
export function resetBusinessDataKeepingAuth(): ResetBusinessResult {
  if (typeof window === "undefined") return { keysRemoved: 0 };
  const keep: Record<string, unknown> = {};
  for (const key of KEEP_AUTH_SETTING_KEYS) {
    const value = getMemorySetting(key, undefined as unknown);
    if (value !== undefined) keep[key] = value;
  }
  const before = Object.keys(snapshotMemoryStore()).length;
  clearMemoryStore();
  for (const [key, value] of Object.entries(keep)) {
    setMemorySetting(key, value);
  }
  dispatchDataChanged();
  return { keysRemoved: Math.max(0, before - Object.keys(keep).length) };
}

/** Mark every one-shot seed/demo flag so a blank slate is not refilled. */
export function lockBlankSlateFlags() {
  setAppFlag(KEEP_BLANK_SLATE_KEY, true);
  setAppFlag("financeiag-populate-demo-v2", true);
  setAppFlag("financeiag-demo-cleared-v1", true);
  setAppFlag("financeiag-books-reset-balance-check-v1", true);
  setAppFlag("financeiag-clear-default-bank-seeds-v3", true);
  setAppFlag("financeiag-clear-imported-statements-v1", true);
  setAppFlag("financeiag-bank-friendly-names-v1", true);
  setAppFlag("financeiag-removed-cash-at-hand-001ca-v1", true);
  markSkipHydrateOnce();
  try {
    sessionStorage.removeItem("financeiag-db-hydrated-v1");
    sessionStorage.removeItem("financeiag-skip-hydrate-once");
  } catch {
    /* ignore */
  }
}

/** Allow sample/demo load again after a blank-slate lock. */
export function unlockBlankSlateForSamples() {
  if (typeof window === "undefined") return;
  removeAppPref(KEEP_BLANK_SLATE_KEY);
  removeAppPref("financeiag-populate-demo-v2");
  skipHydrateOnce = false;
  try {
    sessionStorage.removeItem("financeiag-skip-hydrate-once");
    sessionStorage.removeItem(HYDRATE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export type PurgeMode = "all" | "transactions" | "keep-coa";

/** Best-effort wipe of Postgres business tables (auth tables stay). */
export async function purgeRemoteBusinessData(
  mode: PurgeMode = "all",
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const res = await apiFetch("/api/data/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        confirm:
          mode === "all"
            ? "PURGE_ALL"
            : mode === "keep-coa"
              ? "PURGE_KEEP_COA"
              : "PURGE_TRANSACTIONS",
      }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Full system reset from Settings: purge Postgres + clear browser business data.
 * Keeps login. Blocks sample/demo auto-seed until you load samples manually.
 */
export async function resetEntireSystem(): Promise<
  ResetBusinessResult & { remotePurged: boolean }
> {
  if (typeof window === "undefined") {
    return { keysRemoved: 0, remotePurged: false };
  }
  const remotePurged = await purgeRemoteBusinessData("all");
  const result = resetBusinessDataKeepingAuth();
  lockBlankSlateFlags();
  setAppFlag(USER_DATA_WIPE_KEY, true);
  return { ...result, remotePurged };
}

/**
 * Reset browser + Postgres but keep Chart of Accounts (local + remote accounts).
 */
export async function resetKeepingChartOfAccountsSystem(): Promise<
  ResetBusinessResult & { remotePurged: boolean }
> {
  if (typeof window === "undefined") {
    return { keysRemoved: 0, remotePurged: false };
  }
  const remotePurged = await purgeRemoteBusinessData("keep-coa");
  const result = resetKeepingChartOfAccounts();
  return { ...result, remotePurged };
}

/**
 * Clear transactions locally and in Postgres; keep masters / CoA.
 */
export async function cleanTransactionsSystem(
  options: { clearHistory?: boolean } = {},
): Promise<CleanTransactionsResult & { remotePurged: boolean }> {
  if (typeof window === "undefined") {
    return { clearedStores: 0, keptStores: 0, remotePurged: false };
  }
  const remotePurged = await purgeRemoteBusinessData("transactions");
  const result = cleanTransactions(options);
  setAppFlag(KEEP_BLANK_SLATE_KEY, true);
  markSkipHydrateOnce();
  try {
    sessionStorage.removeItem("financeiag-skip-hydrate-once");
  } catch {
    /* ignore */
  }
  return { ...result, remotePurged };
}

/**
 * Reset this browser's business data to a blank default, but keep the Chart of
 * Accounts (ledger accounts + Accounts → Chart of Accounts records).
 */
export function resetKeepingChartOfAccounts(): ResetBusinessResult {
  if (typeof window === "undefined") return { keysRemoved: 0 };

  const coaLedger = getMemoryLedgerAccounts();
  const coaRecords = getMemoryRecords("accounts", "chart-of-accounts");
  const users = getMemorySetting("financeiag-users", undefined);
  const roles = getMemorySetting("financeiag-roles", undefined);
  const tabs = getMemorySetting("financeiag-enabled-tabs", undefined);

  const before = Object.keys(snapshotMemoryStore()).length;
  clearMemoryStore();

  if (coaLedger.length) setMemoryLedgerAccounts(coaLedger);
  if (coaRecords.length) setMemoryRecords("accounts", "chart-of-accounts", coaRecords);
  if (users !== undefined) setMemorySetting("financeiag-users", users);
  if (roles !== undefined) setMemorySetting("financeiag-roles", roles);
  if (tabs !== undefined) setMemorySetting("financeiag-enabled-tabs", tabs);
  setMemoryLedgerLines([]);
  removeMemorySetting(BANK_STATEMENTS_KEY);
  removeMemorySetting(FIELD_AUDIT_KEY);

  lockBlankSlateFlags();
  setAppFlag("financeiag-coa-iag-v1", true);

  try {
    rebuildOpeningBalanceEntry();
  } catch {
    /* best-effort */
  }

  dispatchDataChanged();
  return { keysRemoved: before };
}

/**
 * One-shot: previously wiped browser data keeping CoA.
 * Disabled — auto wipe deleted uploads. Use Settings reset instead.
 */
export function wipeKeepChartOfAccountsOnce(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (getAppFlag(KEEP_COA_WIPE_KEY)) return false;
    setAppFlag(KEEP_COA_WIPE_KEY, true);
    return false;
  } catch {
    return false;
  }
}

/**
 * Legacy one-shot wipe marker sync — does NOT purge Postgres or browser data.
 * Auto-wipe on boot deleted user uploads; full reset is Settings → resetEntireSystem only.
 */
export async function wipeAllUserDataOnce(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    if (getAppFlag(USER_DATA_WIPE_KEY)) return false;

    try {
      const res = await apiFetch(`/api/settings/${encodeURIComponent(USER_DATA_WIPE_KEY)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const json = (await res.json()) as { data?: unknown };
        if (json.data === "1" || json.data === true) {
          setAppFlag(USER_DATA_WIPE_KEY, true);
          return false;
        }
      }
    } catch {
      /* ignore */
    }

    // Stamp the marker so older clients stop attempting wipe — never purge here.
    setAppFlag(USER_DATA_WIPE_KEY, true);
    await persistFlagImmediate(USER_DATA_WIPE_KEY, true);
    return false;
  } catch {
    try {
      setAppFlag(USER_DATA_WIPE_KEY, true);
    } catch {
      /* ignore */
    }
    return false;
  }
}
