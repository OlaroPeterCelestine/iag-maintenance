/**
 * Manager.io–style business backup / restore.
 * Packs in-memory business data (synced to Postgres) into one downloadable file.
 */

import {
  applyRawKeyToMemory,
  clearMemoryStore,
  LOCAL_UI_KEYS,
  snapshotMemoryStore,
} from "@/lib/db/client-store";
import {
  flushPendingPersists,
  persistLedgerAccountsToDb,
  persistLedgerLinesToDb,
  persistRecordsToDb,
  persistSettingToDb,
} from "@/lib/db/sync";
import { getMemorySetting } from "@/lib/db/client-store";
import {
  getMemoryLedgerAccounts,
  getMemoryLedgerLines,
  listMemoryRecordKeys,
  getMemoryRecords,
} from "@/lib/db/client-store";
import { purgeRemoteBusinessData } from "@/lib/reset-data";

export const BACKUP_FORMAT = "financeiag-business-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_EXTENSION = "financeiag";

export type BusinessBackupOptions = {
  /** Exclude Documents → History audit rows */
  excludeHistory?: boolean;
  /** Exclude email settings and email templates */
  excludeEmails?: boolean;
  /** Exclude document attachments folders/files */
  excludeAttachments?: boolean;
  /** Exclude field-level audit trail */
  excludeFieldAudit?: boolean;
};

export type BusinessBackupFile = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  businessName: string;
  app: "FinanceIAG";
  options: BusinessBackupOptions;
  /** Key → raw JSON string value */
  store: Record<string, string>;
};

const HISTORY_KEY = "financeiag-records:documents:history";
const DELETED_RECORDS_KEY = "financeiag-records:documents:deleted-records";
const ATTACHMENTS_PREFIXES = [
  "financeiag-records:documents:attachments",
  "financeiag-records:documents:folders",
];
const EMAIL_KEYS = new Set([
  "financeiag-email-settings",
  "financeiag-email-templates",
  "financeiag-request-email-contacts",
]);
const FIELD_AUDIT_KEY = "financeiag-field-audit";

/** UI-only keys that should not travel with a business backup. */
const EXCLUDED_ALWAYS = new Set([
  "financeiag-sidebar-collapsed",
  "financeiag-demo-cleared-v1",
  "financeiag-books-reset-balance-check-v1",
  ...LOCAL_UI_KEYS,
]);

function isFinanceiagKey(key: string) {
  return key.startsWith("financeiag-");
}

function shouldSkipKey(key: string, options: BusinessBackupOptions) {
  if (EXCLUDED_ALWAYS.has(key)) return true;
  if (
    options.excludeHistory &&
    (key === HISTORY_KEY || key === DELETED_RECORDS_KEY)
  ) {
    return true;
  }
  if (options.excludeFieldAudit && key === FIELD_AUDIT_KEY) return true;
  if (options.excludeEmails && EMAIL_KEYS.has(key)) return true;
  if (
    options.excludeAttachments &&
    ATTACHMENTS_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}`))
  ) {
    return true;
  }
  return false;
}

export function listBackupKeys(options: BusinessBackupOptions = {}): string[] {
  if (typeof window === "undefined") return [];
  return Object.keys(snapshotMemoryStore())
    .filter((key) => isFinanceiagKey(key) && !shouldSkipKey(key, options))
    .sort();
}

export function readBusinessName(): string {
  try {
    const settings = getMemorySetting<{ businessName?: string } | null>(
      "financeiag-manager-settings",
      null,
    );
    if (settings?.businessName?.trim()) return settings.businessName.trim();
    const profile = getMemorySetting<{ businessName?: string } | null>(
      "financeiag-business-profile",
      null,
    );
    if (profile?.businessName?.trim()) return profile.businessName.trim();
  } catch {
    /* ignore */
  }
  return "Business";
}

export function createBusinessBackup(
  options: BusinessBackupOptions = {},
): BusinessBackupFile {
  const full = snapshotMemoryStore();
  const store: Record<string, string> = {};
  for (const key of Object.keys(full)) {
    if (!isFinanceiagKey(key) || shouldSkipKey(key, options)) continue;
    store[key] = full[key];
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    businessName: readBusinessName(),
    app: "FinanceIAG",
    options,
    store,
  };
}

export function backupFileName(backup: BusinessBackupFile) {
  const safe = backup.businessName
    .replace(/[^\w\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const stamp = backup.createdAt.slice(0, 10);
  return `${safe || "business"}-${stamp}.${BACKUP_EXTENSION}`;
}

/** Download the current business as a local `.financeiag` file. */
export function downloadBusinessBackup(options: BusinessBackupOptions = {}) {
  const backup = createBusinessBackup(options);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = backupFileName(backup);
  anchor.click();
  URL.revokeObjectURL(url);
  return backup;
}

export function parseBusinessBackup(text: string): BusinessBackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON. Choose a FinanceIAG business backup.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid backup file.");
  }
  const file = parsed as Partial<BusinessBackupFile>;
  if (file.format !== BACKUP_FORMAT) {
    throw new Error(
      "This is not a FinanceIAG business backup. Export from Settings → Backup & Restore.",
    );
  }
  if (!file.store || typeof file.store !== "object") {
    throw new Error("Backup is missing business data.");
  }
  const store: Record<string, string> = {};
  for (const [key, value] of Object.entries(file.store)) {
    if (!isFinanceiagKey(key)) continue;
    if (typeof value !== "string") {
      store[key] = JSON.stringify(value);
    } else {
      store[key] = value;
    }
  }
  if (!Object.keys(store).length) {
    throw new Error("Backup contains no FinanceIAG data keys.");
  }
  return {
    format: BACKUP_FORMAT,
    version: typeof file.version === "number" ? file.version : BACKUP_VERSION,
    createdAt: file.createdAt || new Date().toISOString(),
    businessName: file.businessName || "Imported business",
    app: "FinanceIAG",
    options: file.options || {},
    store,
  };
}

async function persistMemoryToDb(options?: {
  replace?: boolean;
}): Promise<boolean> {
  const replace = options?.replace === true;
  const tasks: Array<Promise<boolean>> = [];
  for (const { module, entity } of listMemoryRecordKeys()) {
    tasks.push(
      persistRecordsToDb(module, entity, getMemoryRecords(module, entity), {
        ...(replace ? { mode: "replace" as const, allowEmpty: true } : {}),
      }),
    );
  }
  const accounts = getMemoryLedgerAccounts();
  // After a replace purge, empty CoA in the backup is already empty remotely —
  // never PUT [] (API refuses clearing the chart).
  if (accounts.length) {
    tasks.push(persistLedgerAccountsToDb(accounts));
  }
  tasks.push(
    persistLedgerLinesToDb(getMemoryLedgerLines(), {
      ...(replace ? { allowEmpty: true } : {}),
    }),
  );
  for (const [key, value] of Object.entries(snapshotMemoryStore())) {
    if (key.startsWith("financeiag-records:") || key.startsWith("financeiag-ledger:")) {
      continue;
    }
    if (LOCAL_UI_KEYS.has(key)) continue;
    try {
      tasks.push(persistSettingToDb(key, JSON.parse(value)));
    } catch {
      tasks.push(persistSettingToDb(key, value));
    }
  }
  const results = await Promise.all(tasks);
  await flushPendingPersists();
  return results.every(Boolean);
}

export type RestoreMode = "replace" | "merge";

/**
 * Restore a business backup into memory and push to Postgres.
 * - replace: purge Postgres first, wipe tab memory, then load backup
 * - merge: write backup keys on top of existing data
 */
export async function restoreBusinessBackup(
  backup: BusinessBackupFile,
  mode: RestoreMode = "replace",
): Promise<{ keys: number; businessName: string; remotePurged: boolean }> {
  let remotePurged = false;
  if (mode === "replace") {
    remotePurged = await purgeRemoteBusinessData("all");
    if (!remotePurged) {
      throw new Error(
        "Could not purge Postgres before restore. Check that the API is online and you are signed in as an administrator, then retry.",
      );
    }
    clearMemoryStore();
  }
  let written = 0;
  for (const [key, value] of Object.entries(backup.store)) {
    if (!isFinanceiagKey(key) || EXCLUDED_ALWAYS.has(key)) continue;
    applyRawKeyToMemory(key, value);
    written += 1;
  }
  const pushed = await persistMemoryToDb({ replace: mode === "replace" });
  if (!pushed) {
    throw new Error(
      "Backup loaded into this tab but some writes to Postgres failed. Do not reload until saves succeed — check the connection and try restore again.",
    );
  }
  window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
  window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
  window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
  window.dispatchEvent(new Event("financeiag-tabs-changed"));
  return { keys: written, businessName: backup.businessName, remotePurged };
}

export async function importBusinessBackupFile(
  file: File,
  mode: RestoreMode = "replace",
) {
  const text = await file.text();
  const backup = parseBusinessBackup(text);
  return { backup, result: await restoreBusinessBackup(backup, mode) };
}

export function summarizeBackup(backup: BusinessBackupFile) {
  const keys = Object.keys(backup.store);
  const recordKeys = keys.filter((k) => k.startsWith("financeiag-records:")).length;
  const hasLedger = keys.some((k) => k.startsWith("financeiag-ledger:"));
  return {
    businessName: backup.businessName,
    createdAt: backup.createdAt,
    keyCount: keys.length,
    recordStores: recordKeys,
    hasLedger,
  };
}
