import { getMemoryLedgerLines } from "@/lib/db/client-store";
import {
  beginBulkRecordsWrite,
  endBulkRecordsWrite,
  loadRecords,
  saveRecords,
} from "@/lib/records-store";
import { postRecordToLedger } from "@/lib/ledger/api-post";
import { rebuildOpeningBalanceEntry } from "@/lib/ledger/opening-balances";
import {
  beginLedgerBatch,
  endLedgerBatch,
  loadLedgerLines,
} from "@/lib/ledger/posting";
import type { ManagerRecord } from "@/lib/manager-entities";
import { getAppFlag, setAppFlag } from "@/lib/db/app-prefs";
import { parseAmount } from "@/lib/ledger/types";

const SOURCES: { module: string; entity: string }[] = [
  { module: "sales", entity: "sales-invoices" },
  { module: "sales", entity: "invoices" },
  { module: "sales", entity: "credit-notes" },
  { module: "purchases", entity: "purchase-invoices" },
  { module: "purchases", entity: "bills" },
  { module: "purchases", entity: "debit-notes" },
  { module: "banking", entity: "receipts" },
  { module: "banking", entity: "payments" },
  { module: "banking", entity: "inter-account-transfers" },
  { module: "banking", entity: "bank-and-cash-accounts" },
  { module: "accounts", entity: "journal-entries" },
  { module: "accounts", entity: "recurring-journal-entries" },
  { module: "expense-claims", entity: "expense-claims" },
  { module: "payroll", entity: "payslips" },
  { module: "payroll", entity: "statutory-remittances" },
  { module: "payroll", entity: "leave-requests" },
  { module: "assets", entity: "fixed-assets" },
  { module: "assets", entity: "depreciation-entries" },
  { module: "assets", entity: "amortization-entries" },
  { module: "inventory", entity: "inventory-write-offs" },
  { module: "inventory", entity: "stock-in" },
  { module: "inventory", entity: "inventory-sales" },
  { module: "pos", entity: "pos-stock-in" },
  { module: "pos", entity: "pos-sales" },
  { module: "sales", entity: "late-payment-fees" },
  { module: "sales", entity: "withholding-tax-receipts" },
  { module: "purchases", entity: "withholding-tax" },
];

/** One-shot full rebuild after under-posted ledgers (v3 = non-blocking incremental). */
const LEDGER_REPAIR_FLAG = "financeiag-ledger-repair-v3";

/** One-shot: flip Draft/Inactive register assets to Active so they capitalize onto the BS. */
const ACTIVATE_FIXED_ASSETS_FLAG = "financeiag-activate-fixed-assets-v1";

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), { timeout: 32 });
      return;
    }
    setTimeout(resolve, 0);
  });
}

function sourceDocuments(): Array<{
  module: string;
  entity: string;
  record: ManagerRecord;
}> {
  const out: Array<{ module: string; entity: string; record: ManagerRecord }> = [];
  for (const { module, entity } of SOURCES) {
    for (const record of loadRecords(module, entity)) {
      if (!record?.id) continue;
      out.push({ module, entity, record });
    }
  }
  return out;
}

function sourceDocumentCount() {
  return sourceDocuments().length;
}

function postedSourceIds() {
  const ids = new Set<string>();
  for (const line of loadLedgerLines()) {
    const id = (line.sourceRecordId || "").trim();
    if (!id || id.startsWith("__system")) continue;
    ids.add(id);
  }
  return ids;
}

function unpostedSources() {
  const posted = postedSourceIds();
  return sourceDocuments().filter(({ record }) => !posted.has(record.id));
}

/** Re-post source documents after accounting basis (or other settings) change. */
export async function resyncLedgerFromRecords() {
  if (typeof window === "undefined") return;
  beginLedgerBatch();
  try {
    for (const { module, entity, record } of sourceDocuments()) {
      await postRecordToLedger(module, entity, record);
    }
    rebuildOpeningBalanceEntry();
  } finally {
    await endLedgerBatch();
  }
}

async function resyncDocuments(
  docs: Array<{ module: string; entity: string; record: ManagerRecord }>,
) {
  beginLedgerBatch();
  try {
    for (let i = 0; i < docs.length; i += 1) {
      const { module, entity, record } = docs[i]!;
      await postRecordToLedger(module, entity, record);
      if (i > 0 && i % 25 === 0) await yieldToMain();
    }
    rebuildOpeningBalanceEntry();
  } finally {
    await endLedgerBatch();
  }
}

let ensureInFlight: Promise<boolean> | null = null;
let lastAttemptKey = "";

/**
 * Keep the general ledger aligned with receipts, payments, invoices, etc.
 * Only posts *missing* document gaps — never invents a full journal when the
 * Postgres log is empty (reports must print from the API ledger log).
 */
export function ensureLedgerRepostedIfEmpty(): Promise<boolean> {
  return ensureLedgerSyncedFromRecords();
}

export function ensureLedgerSyncedFromRecords(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (ensureInFlight) return ensureInFlight;

  ensureInFlight = (async () => {
    try {
      // Empty journal in memory after hydrate means empty in Postgres —
      // do not rebuild from browser documents (that invents a fake log).
      if (getMemoryLedgerLines().length === 0) {
        return false;
      }

      const sources = sourceDocuments();
      if (!sources.length) return false;

      const missing = unpostedSources();
      if (missing.length === 0) {
        setAppFlag(LEDGER_REPAIR_FLAG, true);
        return false;
      }

      const attemptKey = `miss:${missing
        .map((m) => m.record.id)
        .sort()
        .join(",")
        .slice(0, 240)}`;
      if (attemptKey === lastAttemptKey) return false;
      lastAttemptKey = attemptKey;

      await resyncDocuments(missing);

      void import("@/lib/db/sync").then(({ awaitInFlightPersists }) => {
        void awaitInFlightPersists();
      });
      setAppFlag(LEDGER_REPAIR_FLAG, true);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
      }
      return true;
    } finally {
      ensureInFlight = null;
    }
  })();

  return ensureInFlight;
}

function assetHasCost(record: ManagerRecord) {
  const cost = parseAmount(
    record.totalAcquisitionCost || record.cost || record.amount || record.purchasePrice,
  );
  const extras = parseAmount(record.otherCosts);
  return cost + extras > 0;
}

function isDisposedAsset(record: ManagerRecord) {
  return /void|voided|sold|disposed|written\s*off/i.test(record.status || "");
}

/** Avoid re-trying the same FA capitalize failure on every navigation. */
const faAttemptedThisSession = new Set<string>();
let faRepairInFlight: Promise<number> | null = null;
let faRepairScheduled = false;

/**
 * Idle/background: activate Draft FA once, then capitalize unposted Active assets
 * in small chunks so the dashboard / BS stay responsive.
 */
export async function resyncUnpostedFixedAssets(): Promise<number> {
  if (typeof window === "undefined") return 0;
  if (faRepairInFlight) return faRepairInFlight;

  faRepairInFlight = (async () => {
    let activated = 0;
    if (!getAppFlag(ACTIVATE_FIXED_ASSETS_FLAG)) {
      const now = new Date().toISOString();
      beginBulkRecordsWrite();
      try {
        for (const entity of ["fixed-assets", "intangible-assets"] as const) {
          const current = loadRecords("assets", entity);
          let changed = false;
          const next = current.map((record) => {
            if (!record?.id || isDisposedAsset(record)) return record;
            if (/^active$/i.test((record.status || "").trim())) return record;
            changed = true;
            activated += 1;
            return { ...record, status: "Active", updatedAt: now };
          });
          if (changed) {
            await saveRecords("assets", entity, next);
          }
        }
      } finally {
        endBulkRecordsWrite();
      }
      setAppFlag(ACTIVATE_FIXED_ASSETS_FLAG, true);
      await yieldToMain();
    }

    const posted = postedSourceIds();
    const toPost = (["fixed-assets", "intangible-assets"] as const).flatMap((entity) =>
      loadRecords("assets", entity)
        .filter((record) => {
          if (!record?.id || posted.has(record.id)) return false;
          if (faAttemptedThisSession.has(record.id)) return false;
          if (isDisposedAsset(record)) return false;
          if (!/^active$/i.test((record.status || "").trim())) return false;
          return assetHasCost(record);
        })
        .map((record) => ({ entity, record })),
    );
    if (!toPost.length) return activated;

    let postedCount = 0;
    beginLedgerBatch();
    try {
      for (let i = 0; i < toPost.length; i += 1) {
        const { entity, record } = toPost[i]!;
        faAttemptedThisSession.add(record.id);
        const result = await postRecordToLedger("assets", entity, record);
        if (result.ok) postedCount += 1;
        if (i > 0 && i % 8 === 0) await yieldToMain();
      }
    } finally {
      await endLedgerBatch();
    }

    if (postedCount > 0) {
      lastAttemptKey = "";
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
      }
    }
    return activated + postedCount;
  })().finally(() => {
    faRepairInFlight = null;
  });

  return faRepairInFlight;
}

/** Schedule FA ledger repair after first paint — never on the critical boot path. */
export function scheduleFixedAssetLedgerRepair(onDone?: (count: number) => void): void {
  if (typeof window === "undefined") return;
  if (faRepairScheduled || faRepairInFlight) return;
  faRepairScheduled = true;

  const run = () => {
    void resyncUnpostedFixedAssets()
      .then((count) => onDone?.(count))
      .finally(() => {
        faRepairScheduled = false;
      });
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 5000 });
  } else {
    window.setTimeout(run, 1200);
  }
}

export { sourceDocumentCount, unpostedSources };
