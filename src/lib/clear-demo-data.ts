import {
  listMemoryRecordKeys,
  setMemoryLedgerAccounts,
  setMemoryLedgerLines,
  setMemoryRecords,
} from "@/lib/db/client-store";
import {
  persistLedgerAccountsToDb,
  persistLedgerLinesToDb,
  persistRecordsToDb,
} from "@/lib/db/sync";
import { getAppFlag, setAppFlag } from "@/lib/db/app-prefs";

const MIGRATION_KEY = "financeiag-demo-cleared-v1";
const BOOKS_RESET_KEY = "financeiag-books-reset-balance-check-v1";
const CASH_AT_HAND_CLEANUP_KEY = "financeiag-removed-cash-at-hand-001ca-v1";

function wipeBooksStorage() {
  for (const { module, entity } of listMemoryRecordKeys()) {
    setMemoryRecords(module, entity, []);
    void persistRecordsToDb(module, entity, [], { mode: "replace", allowEmpty: true });
  }
  setMemoryLedgerLines([]);
  void persistLedgerLinesToDb([], { allowEmpty: true });
  setMemoryLedgerAccounts([]);
  void persistLedgerAccountsToDb([]);
}

/**
 * One-time stamp so legacy boot paths do not wipe books.
 * Must NOT delete records — that erased real Postgres-backed data.
 */
export function resetBooksOnce() {
  if (typeof window === "undefined") return;
  try {
    if (getAppFlag(BOOKS_RESET_KEY)) return;
    setAppFlag(BOOKS_RESET_KEY, true);
  } catch {
    // ignore storage failures
  }
}

/** Clear everything accounting-related right now (callable from Settings). */
export function resetBooksNow() {
  if (typeof window === "undefined") return;
  wipeBooksStorage();
  setAppFlag(BOOKS_RESET_KEY, true);
  window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
  window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
  window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
}

/**
 * Legacy demo-cleanup marker only — does NOT delete rows.
 * Auto-filtering demo IDs on boot risked wiping real short-id records.
 */
export function clearDemoDataOnce() {
  if (typeof window === "undefined") return;
  try {
    resetBooksOnce();
    if (getAppFlag(MIGRATION_KEY)) return;
    setAppFlag(MIGRATION_KEY, true);
  } catch {
    // ignore storage failures
  }
}

/**
 * Legacy one-shot marker only — does NOT delete Cash-at-hand / CoA rows.
 * Auto-delete on boot removed user accounts; delete accounts from the UI instead.
 */
export function removeCashAtHandAccountOnce() {
  if (typeof window === "undefined") return;
  try {
    if (getAppFlag(CASH_AT_HAND_CLEANUP_KEY)) return;
    setAppFlag(CASH_AT_HAND_CLEANUP_KEY, true);
  } catch {
    // ignore storage failures
  }
}
