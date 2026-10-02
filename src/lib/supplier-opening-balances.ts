/**
 * Multi-currency opening balances on supplier masters.
 * Stored as JSON on the supplier (`openingBalances`), synced to Active
 * opening purchase invoices so AP / payments / aging stay consistent.
 */
import { OPENING_BALANCES_EQUITY_NAME } from "@/lib/ledger/chart-of-accounts";
import { convertToBase, normalizeCurrency } from "@/lib/ledger/fx";
import { postRecordToLedger } from "@/lib/ledger/api-post";
import { unsyncRecordFromLedger } from "@/lib/ledger/sync-record";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { currencySelectOptions } from "@/lib/manager-settings";
import { loadRecords, saveRecordsAsync, notifyPersistFailure } from "@/lib/records-store";

export type OpeningBalanceMap = Record<string, string>;

const OPENING_BILL_PREFIX = "ob-sup-";

export function openingBillId(supplierId: string, currency: string) {
  return `${OPENING_BILL_PREFIX}${supplierId}-${normalizeCurrency(currency).toLowerCase()}`;
}

export function isSupplierOpeningBill(record: ManagerRecord | Record<string, string>) {
  if (record.isOpeningBalance === "true") return true;
  if (/opening/i.test(record.entryType || "")) return true;
  if (/^OB-SUP-/i.test(record.reference || "")) return true;
  if ((record.id || "").startsWith(OPENING_BILL_PREFIX)) return true;
  return false;
}

export function parseOpeningBalances(raw: string | undefined | null): OpeningBalanceMap {
  if (!raw || !String(raw).trim()) return {};
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: OpeningBalanceMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const code = normalizeCurrency(key);
      if (!code) continue;
      const amount = String(value ?? "").trim();
      if (!amount || !parseAmount(amount)) continue;
      out[code] = amount;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeOpeningBalances(map: OpeningBalanceMap): string {
  const cleaned: OpeningBalanceMap = {};
  for (const [key, value] of Object.entries(map)) {
    const code = normalizeCurrency(key);
    const amount = String(value ?? "").trim();
    if (!code || !amount || !parseAmount(amount)) continue;
    cleaned[code] = amount;
  }
  return Object.keys(cleaned).length ? JSON.stringify(cleaned) : "";
}

/** One row per allowed currency (base + foreign), filled from stored map. */
export function openingBalanceRows(
  stored?: string | null,
): { code: string; label: string; amount: string }[] {
  const map = parseOpeningBalances(stored);
  return currencySelectOptions().map((opt) => ({
    code: opt.code,
    label: opt.label,
    amount: map[opt.code] || "",
  }));
}

export function sumOpeningBalancesBase(
  stored: string | undefined | null,
  asOfDate?: string,
): number {
  const map = parseOpeningBalances(stored);
  let total = 0;
  for (const [currency, amount] of Object.entries(map)) {
    total += convertToBase(parseAmount(amount), currency, asOfDate);
  }
  return roundMoney(total);
}

function openingBillRecord(
  supplier: ManagerRecord,
  currency: string,
  amount: number,
  date: string,
  previous?: ManagerRecord,
): ManagerRecord {
  const now = new Date().toISOString();
  const code = normalizeCurrency(currency);
  const supplierCode = (supplier.code || supplier.id || "SUP").toString().trim();
  return {
    id: openingBillId(supplier.id, code),
    reference: `OB-SUP-${supplierCode}-${code}`,
    date,
    dueDate: date,
    party: supplier.name || "",
    supplier: supplier.name || "",
    currency: code,
    currencyCode: code,
    description: `Opening balance (${code}) — ${supplier.name || "supplier"}`,
    amount: String(amount),
    amountPaid: previous?.amountPaid || "0",
    balanceDue: String(amount),
    status: "Active",
    entryType: "Opening balance",
    isOpeningBalance: "true",
    account: OPENING_BALANCES_EQUITY_NAME,
    tax: "",
    division: "",
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
}

function isBillForSupplier(row: ManagerRecord, supplierId: string) {
  return row.id.startsWith(`${OPENING_BILL_PREFIX}${supplierId}-`);
}

/**
 * Upsert / remove opening purchase invoices for each currency amount on the supplier.
 * Call after the supplier master row is durable in Postgres.
 */
export async function syncSupplierOpeningBalanceInvoices(
  supplier: ManagerRecord,
): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined") return { ok: true };
  const name = (supplier.name || "").trim();
  if (!name || !supplier.id) return { ok: true };

  const amounts = parseOpeningBalances(supplier.openingBalances);
  const date =
    (supplier.openingBalanceDate || "").trim() ||
    new Date().toISOString().slice(0, 10);
  const invoices = loadRecords("purchases", "purchase-invoices");

  const kept: ManagerRecord[] = [];
  for (const row of invoices) {
    if (!isBillForSupplier(row, supplier.id)) {
      kept.push(row);
      continue;
    }
    const currency = normalizeCurrency(row.currency || row.currencyCode);
    const amount = parseAmount(amounts[currency] || "0");
    if (amount <= 0) {
      unsyncRecordFromLedger(row.id);
      continue;
    }
    // Replaced below from the amounts map.
  }

  const wantedIds = new Set<string>();
  for (const [currency, raw] of Object.entries(amounts)) {
    const amount = parseAmount(raw);
    if (amount <= 0) continue;
    const id = openingBillId(supplier.id, currency);
    wantedIds.add(id);
    const previous = invoices.find((row) => row.id === id);
    kept.push(openingBillRecord(supplier, currency, amount, date, previous));
  }

  // Unsync any prior currency bills for this supplier that are no longer wanted.
  for (const row of invoices) {
    if (!isBillForSupplier(row, supplier.id)) continue;
    if (wantedIds.has(row.id)) continue;
    unsyncRecordFromLedger(row.id);
  }

  const persisted = await saveRecordsAsync("purchases", "purchase-invoices", kept);
  if (!persisted.ok || persisted.durable !== "postgres") {
    return {
      ok: false,
      error: persisted.error || "Could not save supplier opening balance invoices.",
    };
  }

  const posted: string[] = [];
  for (const row of kept) {
    if (!isBillForSupplier(row, supplier.id)) continue;
    const result = await postRecordToLedger("purchases", "purchase-invoices", row);
    if (!result.ok) {
      // Reverse any opening-balance postings from earlier in this same batch.
      for (const id of posted) unsyncRecordFromLedger(id);
      return {
        ok: false,
        error: result.error || "Ledger posting failed for opening balance.",
      };
    }
    posted.push(row.id);
  }

  return { ok: true };
}

/** Remove opening bills when a supplier master is deleted. */
export async function removeSupplierOpeningBalanceInvoices(
  supplier: ManagerRecord,
): Promise<void> {
  if (typeof window === "undefined" || !supplier.id) return;
  const invoices = loadRecords("purchases", "purchase-invoices");
  let changed = false;
  const next = invoices.filter((row) => {
    if (!isBillForSupplier(row, supplier.id)) return true;
    unsyncRecordFromLedger(row.id);
    changed = true;
    return false;
  });
  if (changed) {
    const saved = await saveRecordsAsync("purchases", "purchase-invoices", next);
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "purchases/purchase-invoices",
        saved.error ||
          "Opening balance ledger postings were reversed, but the invoice rows could not be removed.",
      );
    }
  }
}
