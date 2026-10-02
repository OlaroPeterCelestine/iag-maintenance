/**
 * Customer / supplier subledgers: balances, open documents, payment capture
 * and printable statements. Built on the AR/AP helpers so the subledger always
 * agrees with the Accounts receivable / Accounts payable control accounts.
 */

import {
  buildAgedReport,
  buildDocumentPaidMap,
  buildPartyStatement,
  documentOpenBalance,
  refreshAllocatedDocument,
  type PartyStatement,
} from "@/lib/ar-ap";
import { nextEntityCode } from "@/lib/document-references";
import { postRecordToLedger } from "@/lib/ledger/api-post";
import { baseCurrencyCode, recordCurrency, recordToBase } from "@/lib/ledger/fx";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { getAppFlag, setAppFlag } from "@/lib/db/app-prefs";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecords, saveRecordsAsync } from "@/lib/records-store";
import {
  canonicalBankAccountName,
  canonicalPartyName,
  partiesMatch,
} from "@/lib/accounting-party-bank";

export type PartySide = "receivable" | "payable";

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function isInactivePartyStatus(status?: string) {
  return /inactive|obsolete|archived|disabled|draft/i.test((status || "").trim());
}

function isActivePartyStatus(status?: string) {
  return /^active$/i.test((status || "").trim());
}

export type PartyRow = {
  /** Lower-cased key used for matching. */
  key: string;
  name: string;
  code: string;
  email: string;
  balance: number;
  overdue: number;
  openCount: number;
  oldestDueDate: string;
  /** True when the party exists in the Customers / Suppliers master list. */
  onFile: boolean;
};

export type OpenDocument = {
  id: string;
  reference: string;
  party: string;
  date: string;
  dueDate: string;
  /** Base-currency total (ties to the AR/AP control account). */
  total: number;
  paid: number;
  balance: number;
  /** Currency the document was raised in. */
  documentCurrency: string;
  /** Total as entered, in the document's own currency. */
  documentTotal: number;
  daysPastDue: number;
  status: string;
};

export function partyName(record: ManagerRecord) {
  return (record.party || record.customer || record.supplier || record.name || "").trim();
}

function masterModule(side: PartySide) {
  return side === "receivable"
    ? ({ module: "sales", entity: "customers" } as const)
    : ({ module: "purchases", entity: "suppliers" } as const);
}

export type PartySelectOption = {
  value: string;
  code: string;
  label: string;
  currency: string;
  /** Dropdown section: Suppliers / Contractors / Customers */
  group?: string;
  /** Short type tag shown under the name */
  kind?: string;
};

/** Master-list options for Supplier / Customer form pickers. */
export function partySelectOptions(side: PartySide): PartySelectOption[] {
  const { module, entity } = masterModule(side);
  const options: PartySelectOption[] = [];
  // Allow the same display name under Supplier and Contractor (different masters).
  const seen = new Set<string>();

  function pushOption(
    name: string,
    code: string,
    currency: string,
    group: string,
    kind: string,
  ) {
    const key = `${group}:${name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    options.push({
      value: name,
      code,
      currency,
      group,
      kind,
      label: code
        ? currency
          ? `${code} — ${name} (${currency})`
          : `${code} — ${name}`
        : currency
          ? `${name} (${currency})`
          : name,
    });
  }

  for (const record of loadRecords(module, entity)) {
    if (/inactive|obsolete|archived|disabled/i.test(record.status || "")) continue;
    const name = (record.name || "").trim();
    if (!name) continue;
    const group = side === "receivable" ? "Customers" : "Suppliers";
    const kind = side === "receivable" ? "Customer" : "Supplier";
    pushOption(
      name,
      (record.code || "").trim(),
      (record.currency || record.currencyCode || "").trim().toUpperCase(),
      group,
      kind,
    );
  }

  // Payables also include Contract Manager → Contractors (same Payee / Supplier pickers).
  if (side === "payable") {
    for (const record of loadRecords("projects", "contractors")) {
      if (/inactive|obsolete|archived|disabled/i.test(record.status || "")) continue;
      const name = (record.company || record.name || "").trim();
      if (!name) continue;
      pushOption(
        name,
        (record.code || "").trim(),
        (record.currency || record.currencyCode || "").trim().toUpperCase(),
        "Contractors",
        "Contractor",
      );
    }
  }

  // Contractors first so Payee pickers surface both lists without scrolling
  // past a long supplier directory.
  const groupOrder = (g?: string) => {
    if (g === "Contractors") return 0;
    if (g === "Suppliers") return 1;
    if (g === "Customers") return 2;
    return 3;
  };
  return options.sort((a, b) => {
    const byGroup = groupOrder(a.group) - groupOrder(b.group);
    if (byGroup !== 0) return byGroup;
    return a.value.localeCompare(b.value);
  });
}

function buildPartyMasterRecord(
  entity: string,
  existing: ManagerRecord[],
  name: string,
  target: PartySide,
  extras: Partial<ManagerRecord> = {},
): ManagerRecord {
  const now = new Date().toISOString();
  const currency = (
    extras.currency ||
    extras.currencyCode ||
    baseCurrencyCode()
  )
    .toString()
    .trim()
    .toUpperCase() || baseCurrencyCode();
  const code =
    (extras.code || "").toString().trim() ||
    nextEntityCode(
      entity,
      existing,
      target === "receivable" ? "Customer" : "Supplier",
    );
  return {
    id: newId(),
    name,
    code,
    category:
      (extras.category || "").toString().trim() ||
      (target === "payable" ? "General" : ""),
    contacts: (extras.contacts || "").toString().trim() || name,
    location: (extras.location || "").toString().trim(),
    email: (extras.email || "").toString().trim(),
    phone: (extras.phone || "").toString().trim(),
    address: (extras.address || "").toString().trim(),
    currency,
    currencyCode: currency,
    creditLimit: (extras.creditLimit || "").toString().trim(),
    balance: (extras.balance || "").toString().trim() || "0",
    openingBalanceDate: (extras.openingBalanceDate || "").toString().trim(),
    openingBalances: (extras.openingBalances || "").toString().trim(),
    status: (extras.status || "").toString().trim() || "Active",
    notes: (extras.notes || "").toString().trim(),
    createdAt: now,
    updatedAt: now,
  };
}

/** Re-activate an inactive master row and persist (sync helper). */
function reactivatePartyRecord(
  module: string,
  entity: string,
  existing: ManagerRecord[],
  match: ManagerRecord,
): ManagerRecord {
  if (isActivePartyStatus(match.status) && !isInactivePartyStatus(match.status)) {
    return match;
  }
  const now = new Date().toISOString();
  const activated = { ...match, status: "Active", updatedAt: now };
  const next = existing.map((row) => (row.id === match.id ? activated : row));
  void saveRecordsAsync(module, entity, next).then((result) => {
    if (!result.ok || result.durable !== "postgres") {
      window.dispatchEvent(
        new CustomEvent("financeiag-persist-failed", {
          detail: {
            kind: "records",
            key: `${module}/${entity}`,
            error: result.error || "Could not re-activate party in Postgres",
          },
        }),
      );
    }
  });
  return activated;
}

/** Re-activate and await Postgres — used on payee / update paths. */
async function reactivatePartyRecordAsync(
  module: string,
  entity: string,
  existing: ManagerRecord[],
  match: ManagerRecord,
): Promise<ManagerRecord | null> {
  if (isActivePartyStatus(match.status) && !isInactivePartyStatus(match.status)) {
    return match;
  }
  const now = new Date().toISOString();
  const activated = { ...match, status: "Active", updatedAt: now };
  const next = existing.map((row) => (row.id === match.id ? activated : row));
  const persisted = await saveRecordsAsync(module, entity, next);
  if (!persisted.ok || persisted.durable !== "postgres") return null;
  return activated;
}

/**
 * Create a Customer (receivable) or Supplier (payable) from a form picker.
 * "both" defaults to Supplier so Payee fields land on the purchases master list.
 * Returns the existing row when the name already matches (re-activates if needed).
 */
export function ensurePartyRecord(
  name: string,
  side: PartySide | "both",
): ManagerRecord | null {
  const trimmed = name.trim();
  if (!trimmed || typeof window === "undefined") return null;

  const target: PartySide = side === "both" || side === "payable" ? "payable" : "receivable";
  const { module, entity } = masterModule(target);

  const existing = loadRecords(module, entity);
  const match = existing.find(
    (row) => (row.name || "").trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (match) return reactivatePartyRecord(module, entity, existing, match);

  if (target === "payable") {
    const contractors = loadRecords("projects", "contractors");
    const contractor = contractors.find((row) => {
      const label = (row.company || row.name || "").trim().toLowerCase();
      return label === trimmed.toLowerCase();
    });
    if (contractor) return contractor;
  }

  const record = buildPartyMasterRecord(entity, existing, trimmed, target);
  // Optimistic paint + durable write; surface failure if Postgres rejects.
  void saveRecordsAsync(module, entity, [record, ...existing]).then((result) => {
    if (!result.ok || result.durable !== "postgres") {
      window.dispatchEvent(
        new CustomEvent("financeiag-persist-failed", {
          detail: {
            kind: "records",
            key: `${module}/${entity}`,
            error: result.error || "Could not save party master in Postgres",
          },
        }),
      );
    }
  });
  return record;
}

/** Create/reactivate supplier/customer and wait until Postgres accepts the write. */
export async function ensurePartyRecordAsync(
  name: string,
  side: PartySide | "both",
  extras: Partial<ManagerRecord> = {},
): Promise<ManagerRecord | null> {
  const trimmed = name.trim();
  if (!trimmed || typeof window === "undefined") return null;

  const target: PartySide = side === "both" || side === "payable" ? "payable" : "receivable";
  const { module, entity } = masterModule(target);

  const existing = loadRecords(module, entity);
  const match = existing.find(
    (row) => (row.name || "").trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (match) {
    const hasExtras = Object.keys(extras).some((key) => {
      const val = extras[key as keyof ManagerRecord];
      return val !== undefined && String(val).trim() !== "";
    });
    if (hasExtras) {
      const currency = (
        extras.currency ||
        extras.currencyCode ||
        match.currency ||
        match.currencyCode ||
        baseCurrencyCode()
      )
        .toString()
        .trim()
        .toUpperCase();
      const updated: ManagerRecord = {
        ...match,
        ...Object.fromEntries(
          Object.entries(extras).filter(([, v]) => v !== undefined && String(v).trim() !== ""),
        ),
        name: trimmed,
        currency,
        currencyCode: currency,
        status: (extras.status || match.status || "Active").toString().trim() || "Active",
        updatedAt: new Date().toISOString(),
      };
      const next = existing.map((row) => (row.id === match.id ? updated : row));
      const persisted = await saveRecordsAsync(module, entity, next);
      if (!persisted.ok || persisted.durable !== "postgres") return null;
      return updated;
    }
    return reactivatePartyRecordAsync(module, entity, existing, match);
  }

  if (target === "payable") {
    const contractors = loadRecords("projects", "contractors");
    const contractor = contractors.find((row) => {
      const label = (row.company || row.name || "").trim().toLowerCase();
      return label === trimmed.toLowerCase();
    });
    if (contractor) return contractor;
  }

  const record = buildPartyMasterRecord(entity, existing, trimmed, target, extras);
  const persisted = await saveRecordsAsync(module, entity, [record, ...existing]);
  if (!persisted.ok || persisted.durable !== "postgres") {
    return null;
  }
  return record;
}

/** One-shot: flip Draft/Inactive suppliers (and customers) to Active, durable in Postgres. */
const ACTIVATE_PARTY_MASTERS_FLAG = "financeiag-activate-party-masters-v1";

let partyActivateInFlight: Promise<number> | null = null;
let partyActivateScheduled = false;

export async function activatePartyMastersOnce(): Promise<number> {
  if (typeof window === "undefined") return 0;
  if (getAppFlag(ACTIVATE_PARTY_MASTERS_FLAG)) return 0;
  if (partyActivateInFlight) return partyActivateInFlight;

  partyActivateInFlight = (async () => {
    let activated = 0;
    const now = new Date().toISOString();
    const masters = [
      { module: "purchases", entity: "suppliers" },
      { module: "sales", entity: "customers" },
    ] as const;

    for (const { module, entity } of masters) {
      const current = loadRecords(module, entity);
      let changed = false;
      const next = current.map((record) => {
        if (!record?.id) return record;
        if (isActivePartyStatus(record.status) && !isInactivePartyStatus(record.status)) {
          return record;
        }
        // Keep explicitly voided / deleted out of the Active list.
        if (/void|voided|deleted/i.test(record.status || "")) return record;
        changed = true;
        activated += 1;
        return { ...record, status: "Active", updatedAt: now };
      });
      if (!changed) continue;
      const persisted = await saveRecordsAsync(module, entity, next);
      if (!persisted.ok || persisted.durable !== "postgres") {
        // Leave flag unset so the next session retries.
        return activated;
      }
    }

    setAppFlag(ACTIVATE_PARTY_MASTERS_FLAG, true);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
    }
    return activated;
  })().finally(() => {
    partyActivateInFlight = null;
  });

  return partyActivateInFlight;
}

/** Idle: activate inactive suppliers/customers once (same pattern as fixed assets). */
export function schedulePartyMasterActivation(onDone?: (count: number) => void): void {
  if (typeof window === "undefined") return;
  if (partyActivateScheduled || partyActivateInFlight) return;
  if (getAppFlag(ACTIVATE_PARTY_MASTERS_FLAG)) return;
  partyActivateScheduled = true;

  const run = () => {
    void activatePartyMastersOnce()
      .then((count) => onDone?.(count))
      .finally(() => {
        partyActivateScheduled = false;
      });
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 5000 });
  } else {
    window.setTimeout(run, 1200);
  }
}

/**
 * Which master list a party-like form field should pick from.
 * Only keys that store a chosen party (not the master name/code fields).
 */
export function partyPickerSide(
  key: string,
  label?: string,
): PartySide | "both" | null {
  if (
    key !== "party" &&
    key !== "customer" &&
    key !== "supplier" &&
    key !== "payee"
  ) {
    return null;
  }
  const blob = (label || "").toLowerCase();
  if (key === "customer") return "receivable";
  if (key === "supplier" || key === "payee") return "payable";
  // key === "party"
  if (/customer\s*\/\s*supplier/.test(blob)) return "both";
  if (/paid by|\bcustomer\b/.test(blob)) return "receivable";
  if (/payee|\bsupplier\b|\bcontractor\b/.test(blob)) return "payable";
  return "both";
}

export function moneyModule(side: PartySide) {
  return side === "receivable"
    ? ({ module: "banking", entity: "receipts" } as const)
    : ({ module: "banking", entity: "payments" } as const);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export type PayablePartySource = "suppliers" | "contractors";

/** Master list for payable ledgers — suppliers (Purchases) or contractors (Contract Manager). */
function payableMaster(source: PayablePartySource = "suppliers") {
  return source === "contractors"
    ? ({ module: "projects", entity: "contractors" } as const)
    : ({ module: "purchases", entity: "suppliers" } as const);
}

function masterDisplayName(record: ManagerRecord, source: PayablePartySource) {
  if (source === "contractors") {
    return (record.company || record.name || "").trim();
  }
  return (record.name || "").trim();
}

/**
 * Every customer / supplier / contractor with their live subledger balance.
 * Contractor ledgers use the same AP aging merge as suppliers; only the master
 * list (and alias map) differs.
 */
export function listParties(
  side: PartySide,
  asOf?: string,
  options?: { payableSource?: PayablePartySource },
): PartyRow[] {
  const asOfDate = asOf || today();
  const payableSource = options?.payableSource ?? "suppliers";
  const { module, entity } =
    side === "payable" ? payableMaster(payableSource) : masterModule(side);
  const master = loadRecords(module, entity);
  const report = buildAgedReport(side, asOfDate);

  const rows = new Map<string, PartyRow>();
  /** Maps contractor company/name/code aliases onto the canonical master key. */
  const aliasToCanonical = new Map<string, string>();

  for (const record of master) {
    const name = masterDisplayName(record, side === "payable" ? payableSource : "suppliers");
    if (!name) continue;
    const key = name.toLowerCase();
    rows.set(key, {
      key,
      name,
      code: record.code || "",
      email: record.email || "",
      balance: 0,
      overdue: 0,
      openCount: 0,
      oldestDueDate: "",
      onFile: true,
    });
    if (side === "payable" && payableSource === "contractors") {
      for (const alias of [record.company, record.name, record.code]) {
        const a = (alias || "").trim().toLowerCase();
        if (a) aliasToCanonical.set(a, key);
      }
    }
  }

  for (const row of report.rows) {
    const rawKey = row.party.trim().toLowerCase();
    if (!rawKey) continue;
    const key =
      side === "payable" && payableSource === "contractors"
        ? (aliasToCanonical.get(rawKey) ?? (rows.has(rawKey) ? rawKey : ""))
        : rawKey;
    // Contractor view: only parties on the contractors master (or their aliases).
    // Supplier/customer view: same as before — include aged parties not on file.
    if (!key) continue;
    if (
      side === "payable" &&
      payableSource === "contractors" &&
      !rows.has(key)
    ) {
      continue;
    }
    const existing =
      rows.get(key) ??
      ({
        key,
        name: row.party,
        code: "",
        email: "",
        balance: 0,
        overdue: 0,
        openCount: 0,
        oldestDueDate: "",
        onFile: false,
      } satisfies PartyRow);
    existing.balance = roundMoney(existing.balance + row.balance);
    existing.openCount += 1;
    if (row.daysPastDue > 0) existing.overdue = roundMoney(existing.overdue + row.balance);
    if (!existing.oldestDueDate || (row.dueDate && row.dueDate < existing.oldestDueDate)) {
      existing.oldestDueDate = row.dueDate;
    }
    rows.set(key, existing);
  }

  return Array.from(rows.values()).sort(
    (a, b) => b.balance - a.balance || a.name.localeCompare(b.name),
  );
}

/** Same AP logic as supplier ledgers; master list is Contract Manager → Contractors. */
export function listContractorLedgerParties(asOf?: string): PartyRow[] {
  return listParties("payable", asOf, { payableSource: "contractors" });
}

function documentSources(side: PartySide) {
  return side === "receivable"
    ? ([
        ["sales", "sales-invoices"],
        ["sales", "invoices"],
        ["sales", "late-payment-fees"],
      ] as const)
    : ([
        ["purchases", "purchase-invoices"],
        ["purchases", "bills"],
      ] as const);
}

/** Open (unpaid / part-paid) invoices or bills for one party. */
export function partyOpenDocuments(
  side: PartySide,
  party: string,
  asOf?: string,
): OpenDocument[] {
  const asOfDate = asOf || today();
  if (!party.trim()) return [];
  const candidates: ManagerRecord[] = [];

  for (const [module, entity] of documentSources(side)) {
    for (const doc of loadRecords(module, entity)) {
      if (/draft|void|voided|cancelled|canceled/i.test(doc.status || "")) continue;
      if (!partiesMatch(partyName(doc), party)) continue;
      candidates.push(doc);
    }
  }

  const paidMap = buildDocumentPaidMap(candidates, side, asOfDate);
  const out: OpenDocument[] = [];
  for (const doc of candidates) {
    // Balances are held in base currency so they tie to the AR/AP control accounts.
    const total = recordToBase(doc, parseAmount(doc.amount || doc.total));
    if (!total) continue;
    const paid = paidMap.get(doc.id) || 0;
    const balance = roundMoney(Math.max(0, total - paid));
    if (balance <= 0) continue;
    const date = doc.date || doc.issueDate || "";
    const dueDate = doc.dueDate || date || asOfDate;
    const days = Math.floor(
      (new Date(`${asOfDate}T00:00:00`).getTime() - new Date(`${dueDate}T00:00:00`).getTime()) /
        86_400_000,
    );
    out.push({
      id: doc.id,
      reference: doc.reference || doc.id.slice(0, 8).toUpperCase(),
      party: partyName(doc),
      date,
      dueDate,
      total,
      paid,
      balance,
      documentCurrency: recordCurrency(doc),
      documentTotal: parseAmount(doc.amount || doc.total),
      daysPastDue: Number.isFinite(days) ? days : 0,
      status: doc.status || "",
    });
  }

  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.date.localeCompare(b.date));
}

export type Allocation = { documentId: string; reference: string; amount: number };

/** Oldest-due-first allocation of a payment across open documents. */
export function autoAllocate(docs: OpenDocument[], amount: number): Allocation[] {
  let left = roundMoney(Math.max(0, amount));
  const out: Allocation[] = [];
  for (const doc of docs) {
    if (left <= 0) break;
    const take = roundMoney(Math.min(left, doc.balance));
    if (take <= 0) continue;
    out.push({ documentId: doc.id, reference: doc.reference, amount: take });
    left = roundMoney(left - take);
  }
  return out;
}

export type PaymentInput = {
  side: PartySide;
  party: string;
  date: string;
  /** Bank / cash account name from the chart of accounts. */
  bankAccount: string;
  reference?: string;
  description?: string;
  allocations: Allocation[];
};

export type PaymentResult =
  | { ok: true; record: ManagerRecord; total: number }
  | { ok: false; error: string };

/**
 * Record a receipt (customer) or payment (supplier) allocated to open
 * documents, post it to the ledger, and refresh each document's paid status.
 */
export async function recordPartyPayment(input: PaymentInput): Promise<PaymentResult> {
  const allocations = input.allocations.filter((a) => a.amount > 0);
  if (!input.party.trim()) return { ok: false, error: "Choose a customer or supplier." };
  if (!allocations.length) {
    return { ok: false, error: "Enter an amount to allocate to at least one document." };
  }
  if (!input.bankAccount.trim()) {
    return {
      ok: false,
      error:
        input.side === "receivable"
          ? "Choose the bank or cash account the money was received in."
          : "Choose the bank or cash account the money was paid from.",
    };
  }

  const total = roundMoney(allocations.reduce((sum, a) => sum + a.amount, 0));
  if (total <= 0) return { ok: false, error: "The payment amount must be greater than zero." };

  // Stamp master party + bank names so supplier/customer statements and bank
  // activity stay tied to the control accounts (faithful representation).
  const party = canonicalPartyName(input.side, input.party);
  const bankAccount = canonicalBankAccountName(input.bankAccount);
  if (!party) return { ok: false, error: "Choose a customer or supplier." };
  if (!bankAccount) {
    return {
      ok: false,
      error:
        input.side === "receivable"
          ? "Choose the bank or cash account the money was received in."
          : "Choose the bank or cash account the money was paid from.",
    };
  }

  // Guard against over-allocation on any single document.
  const open = partyOpenDocuments(input.side, party, input.date);
  for (const allocation of allocations) {
    const doc = open.find((d) => d.id === allocation.documentId);
    if (!doc) {
      return { ok: false, error: `Document ${allocation.reference} is no longer open.` };
    }
    if (allocation.amount > doc.balance + 0.0001) {
      return {
        ok: false,
        error: `Allocation to ${allocation.reference} exceeds its open balance.`,
      };
    }
  }

  const { module, entity } = moneyModule(input.side);
  const records = loadRecords(module, entity);
  const now = new Date().toISOString();
  const isReceipt = input.side === "receivable";
  const prefix = isReceipt ? "REC" : "PAY";
  const reference =
    input.reference?.trim() ||
    `${prefix}-${String(records.length + 1).padStart(4, "0")}`;

  // appliedTo drives the accrual contra account (AR/AP) in sync-record.
  const appliedTo =
    allocations.length === 1
      ? allocations[0]!.reference
      : allocations.map((a) => `${a.reference}:${a.amount}`).join(";");

  const record: ManagerRecord = {
    id: globalThis.crypto.randomUUID(),
    reference,
    date: input.date || today(),
    account: bankAccount,
    bankAccount,
    ...(isReceipt ? { depositTo: bankAccount } : { paidFrom: bankAccount }),
    party,
    appliedTo,
    // Open balances and allocations are computed in base currency, so the
    // payment is recorded in base currency too — no silent FX mismatch.
    currency: baseCurrencyCode(),
    allocations: JSON.stringify(
      allocations.map((a) => ({ document: a.reference, amount: a.amount })),
    ),
    description:
      input.description?.trim() ||
      `${isReceipt ? "Receipt from" : "Payment to"} ${party}`,
    postingAccount: "",
    amount: String(total),
    clearance: "Cleared",
    status: "Active",
    createdAt: now,
    updatedAt: now,
  };

  const saved = await saveRecords(module, entity, [...records, record]);
  if (!saved.ok || saved.durable !== "postgres") {
    return {
      ok: false,
      error: saved.error || "Could not save the payment in the database.",
    };
  }

  const posted = await postRecordToLedger(module, entity, record);
  if (!posted.ok) {
    // Roll back the stored record so the books stay consistent.
    const rolledBack = await saveRecords(module, entity, records);
    if (!rolledBack.ok || rolledBack.durable !== "postgres") {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("financeiag-persist-failed", {
            detail: {
              kind: "records",
              key: `${module}/${entity}`,
              error:
                rolledBack.error ||
                "Could not roll back an unposted payment record.",
            },
          }),
        );
      }
    }
    return { ok: false, error: posted.error };
  }

  for (const allocation of allocations) {
    refreshAllocatedDocument(allocation.reference);
  }

  return { ok: true, record, total };
}

/** Full running-balance statement for one party, optionally sliced to `from`–`asOf`. */
export function partyStatement(
  side: PartySide,
  party: string,
  asOf?: string,
  from?: string,
): PartyStatement | null {
  return buildPartyStatement(side, party, asOf, from);
}

export function statementCsv(statement: PartyStatement): string {
  const escape = (value: string | number) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = ["Date", "Reference", "Description", "Debit", "Credit", "Balance"];
  const period = statement.from
    ? `Period,${escape(statement.from)} – ${escape(statement.asOf)}`
    : `As of,${statement.asOf}`;
  const rows: (string | number)[][] = [];
  if (statement.from) {
    rows.push(["", "", "Opening balance", "", "", statement.opening]);
  }
  for (const line of statement.lines) {
    rows.push([
      line.date,
      line.reference,
      line.description,
      line.debit || "",
      line.credit || "",
      line.balance,
    ]);
  }
  return [
    `Statement,${escape(statement.party)}`,
    period,
    "",
    header.join(","),
    ...rows.map((row) => row.map(escape).join(",")),
    "",
    `Closing balance,,,,,${statement.closing}`,
  ].join("\n");
}

export function downloadStatementCsv(statement: PartyStatement) {
  const blob = new Blob([statementCsv(statement)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const span = statement.from ? `${statement.from}-${statement.asOf}` : statement.asOf;
  anchor.download = `statement-${statement.party.replace(/[^\w-]+/g, "-")}-${span}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Convenience: the open balance for one document (re-exported for UI use). */
export { documentOpenBalance };
