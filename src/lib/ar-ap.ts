import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords } from "@/lib/records-store";
import { setMemoryRecords } from "@/lib/db/client-store";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { baseCurrencyCode, recordCurrency, recordToBase } from "@/lib/ledger/fx";
import { partiesMatch } from "@/lib/accounting-party-bank";

function loadEntityRecords(module: string, entity: string) {
  return loadRecords(module, entity);
}

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

export type AgedRow = {
  party: string;
  reference: string;
  date: string;
  dueDate: string;
  total: number;
  paid: number;
  balance: number;
  daysPastDue: number;
  bucket: AgingBucket;
  status: string;
  id: string;
};

export type AgedReport = {
  asOf: string;
  rows: AgedRow[];
  totals: Record<AgingBucket | "balance", number>;
};

export type StatementLine = {
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  kind: "invoice" | "credit" | "receipt" | "payment" | "debit";
};

export type PartyStatement = {
  party: string;
  asOf: string;
  /** Inclusive period start. Empty / omitted means the statement runs from the first movement. */
  from?: string;
  opening: number;
  lines: StatementLine[];
  closing: number;
};

/** Keep movements through `to`, and optionally roll prior activity into opening. */
export function applyStatementPeriod(
  lines: StatementLine[],
  opts: { from?: string; to: string },
): { opening: number; lines: StatementLine[]; closing: number } {
  const to = (opts.to || "").slice(0, 10);
  const from = (opts.from || "").slice(0, 10);
  const throughTo = to ? lines.filter((line) => !line.date || line.date <= to) : lines;
  if (!from) {
    const closing = throughTo.length ? throughTo[throughTo.length - 1].balance : 0;
    return { opening: 0, lines: throughTo, closing };
  }
  const start = to && from > to ? to : from;
  const prior = throughTo.filter((line) => line.date && line.date < start);
  const opening = prior.length ? prior[prior.length - 1].balance : 0;
  const period = throughTo.filter((line) => !line.date || line.date >= start);
  const closing = period.length ? period[period.length - 1].balance : opening;
  return { opening, lines: period, closing };
}

export function statementHasContent(statement: PartyStatement | null | undefined): boolean {
  if (!statement) return false;
  return statement.lines.length > 0 || (Boolean(statement.from) && statement.opening !== 0);
}

function daysBetween(from: string, to: string) {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function bucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "1-30";
  if (daysPastDue <= 60) return "31-60";
  if (daysPastDue <= 90) return "61-90";
  return "90+";
}

function partyOf(record: ManagerRecord) {
  return (record.party || record.customer || record.supplier || record.name || "—").trim();
}

/**
 * Document total in BASE currency. The subledger is kept in base so it always
 * agrees with the Accounts receivable / Accounts payable control accounts,
 * even when documents and their payments are in different currencies.
 */
function docTotal(record: ManagerRecord) {
  return recordToBase(record, parseAmount(record.amount || record.total));
}

/** Document total in the currency it was raised in (for display). */
export function docTotalInDocumentCurrency(record: ManagerRecord) {
  return parseAmount(record.amount || record.total);
}

/**
 * Paid amounts for many documents in one pass over receipts/payments (+ WHT).
 * Avoids O(invoices × payments) scans that freeze invoice tables.
 */
export function buildDocumentPaidMap(
  documents: ManagerRecord[],
  side: "receivable" | "payable",
  asOf?: string,
): Map<string, number> {
  const paidById = new Map<string, number>();
  if (!documents.length) return paidById;

  const byId = new Map<string, ManagerRecord>();
  const byRef = new Map<string, ManagerRecord>();
  for (const doc of documents) {
    byId.set(doc.id.toLowerCase(), doc);
    const ref = (doc.reference || "").trim().toLowerCase();
    if (ref && !byRef.has(ref)) byRef.set(ref, doc);
    paidById.set(doc.id, 0);
  }

  const resolveDoc = (raw: string): ManagerRecord | undefined => {
    const key = raw.trim().toLowerCase();
    if (!key) return undefined;
    return byId.get(key) || byRef.get(key);
  };

  const addPaid = (doc: ManagerRecord, amount: number) => {
    if (!amount) return;
    paidById.set(doc.id, roundMoney((paidById.get(doc.id) || 0) + amount));
  };

  const money =
    side === "receivable"
      ? loadEntityRecords("banking", "receipts")
      : loadEntityRecords("banking", "payments");
  const wht =
    side === "receivable"
      ? loadEntityRecords("sales", "withholding-tax-receipts")
      : loadEntityRecords("purchases", "withholding-tax");

  for (const r of money) {
    const paymentDate = r.date || r.issueDate || "";
    if (asOf && paymentDate && paymentDate > asOf) continue;
    if (/draft|void|voided|cancelled|canceled|inactive/i.test(r.status || "")) continue;

    const parts = parseAllocationParts(r);
    if (parts.length) {
      for (const part of parts) {
        const doc = resolveDoc(part.document);
        if (doc) addPaid(doc, recordToBase(r, part.amount));
      }
      continue;
    }

    const applied = (r.appliedTo || r.invoice || r.bill || "").trim();
    if (!applied) continue;
    const doc = resolveDoc(applied);
    if (doc) addPaid(doc, recordToBase(r, parseAmount(r.amount)));
  }

  for (const r of wht) {
    const d = r.date || r.issueDate || "";
    if (asOf && d && d > asOf) continue;
    if (/draft|void|voided|cancelled|canceled|inactive/i.test(r.status || "")) continue;
    const applied = (r.appliedTo || r.invoice || r.bill || r.name || "").trim();
    if (!applied) continue;
    let doc = resolveDoc(applied);
    if (!doc) {
      // Preserve legacy fuzzy WHT match: applied string contains invoice ref.
      const key = applied.toLowerCase();
      for (const [ref, candidate] of byRef) {
        if (key.includes(ref)) {
          doc = candidate;
          break;
        }
      }
    }
    if (doc) addPaid(doc, recordToBase(r, parseAmount(r.amount || r.total)));
  }

  return paidById;
}

/** Sum of receipts/payments allocated to a document (by id or reference), in base currency. */
export function allocatedToDocument(
  document: ManagerRecord,
  side: "receivable" | "payable",
  asOf?: string,
): number {
  return buildDocumentPaidMap([document], side, asOf).get(document.id) || 0;
}

/** Attach amountPaid / balanceDue using one payment pass (for table enrichment). */
export function enrichDocumentsWithPaidBalances(
  records: ManagerRecord[],
  side: "receivable" | "payable",
): ManagerRecord[] {
  if (!records.length) return records;
  const paidMap = buildDocumentPaidMap(records, side);
  return records.map((r) => {
    const paid = paidMap.get(r.id) || 0;
    return {
      ...r,
      amountPaid: String(paid),
      balanceDue: String(roundMoney(Math.max(0, docTotal(r) - paid))),
    };
  });
}

/**
 * Open balance of a row that `enrichDocumentsWithPaidBalances` already costed.
 *
 * `documentOpenBalance` rebuilds the entire paid map — every receipt, payment
 * and WHT record, re-parsing every allocation — to answer for ONE document.
 * Called once that is fine; called per row it makes an invoice table
 * O(rows × payments) on every render, which is what locked the tab up on
 * Purchases → Purchase invoices. Table rows are enriched in a single pass
 * upstream, so read the number that pass already produced. Same arithmetic:
 * `max(0, docTotal - paid)`, rounded.
 */
export function enrichedOpenBalance(record: ManagerRecord): number {
  const due = String(record.balanceDue ?? "").trim();
  if (due) return parseAmount(due);
  // Not enriched (or an older row): fall back to the stored paid amount rather
  // than rescanning — a missing amountPaid reads as unpaid, which is what an
  // un-enriched document means anyway.
  return roundMoney(Math.max(0, docTotal(record) - parseAmount(record.amountPaid)));
}

/** Parse multi-document allocations from a receipt/payment. */
export function parseAllocationParts(
  record: ManagerRecord,
): { document: string; amount: number }[] {
  if (record.allocations) {
    try {
      const parsed = JSON.parse(record.allocations) as { document?: string; amount?: string | number }[];
      if (Array.isArray(parsed) && parsed.length) {
        return parsed
          .filter((p) => p.document)
          .map((p) => ({
            document: String(p.document),
            amount: roundMoney(parseAmount(p.amount)),
          }));
      }
    } catch {
      /* fall through */
    }
  }
  // Format: "INV-1:1000;INV-2:500"
  const applied = (record.appliedTo || "").trim();
  if (applied.includes(";") || /:\s*[\d.]/.test(applied)) {
    return applied
      .split(";")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [doc, amt] = chunk.split(":");
        return {
          document: (doc || "").trim(),
          amount: amt ? parseAmount(amt) : 0,
        };
      })
      .filter((p) => p.document && p.amount > 0);
  }
  return [];
}

export function documentOpenBalance(document: ManagerRecord, side: "receivable" | "payable") {
  const total = docTotal(document);
  const paid = allocatedToDocument(document, side);
  return roundMoney(Math.max(0, total - paid));
}

/** Refresh Paid / Partial / Unpaid on invoice-like records from allocations.
 * UI-only: Go already refreshes document paid status on money writes / settle.
 * Do not dual-write to Postgres from the browser.
 */
export function refreshDocumentPaymentStatus(
  moduleSlug: string,
  entityKey: string,
  documentId: string,
) {
  const side =
    entityKey.includes("purchase") || entityKey === "bills" || entityKey === "debit-notes"
      ? "payable"
      : "receivable";
  const records = loadEntityRecords(moduleSlug, entityKey);
  const idx = records.findIndex((r) => r.id === documentId);
  if (idx < 0) return;
  const doc = records[idx];
  const total = docTotal(doc);
  const paid = allocatedToDocument(doc, side);
  let status = doc.status || "Active";
  if (total > 0 && paid >= total) status = "Paid";
  else if (paid > 0) status = "Partial";
  else if (!/draft|inactive/i.test(status)) status = status === "Paid" || status === "Partial" ? "Active" : status;
  const amountPaid = String(paid);
  const balanceDue = String(roundMoney(Math.max(0, total - paid)));
  // Skip identical updates — always bumping updatedAt + broadcasting froze invoice pages.
  if (
    doc.status === status &&
    String(doc.amountPaid ?? "") === amountPaid &&
    String(doc.balanceDue ?? "") === balanceDue
  ) {
    return;
  }
  const next = [...records];
  next[idx] = {
    ...doc,
    status,
    amountPaid,
    balanceDue,
    updatedAt: new Date().toISOString(),
  };
  setMemoryRecords(moduleSlug, entityKey, next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("financeiag-records-changed", {
        detail: { module: moduleSlug, entity: entityKey },
      }),
    );
  }
}

export function refreshAllocatedDocument(appliedTo: string) {
  if (!appliedTo?.trim()) return;
  // Multi-doc payments pack "REF:amt;REF2:amt" or JSON allocations — refresh each.
  const parts = parseAllocationParts({
    id: "",
    createdAt: "",
    updatedAt: "",
    allocations: "",
    appliedTo,
  } as ManagerRecord);
  const keys =
    parts.length > 0
      ? parts.map((p) => p.document)
      : appliedTo
          .split(";")
          .map((chunk) => chunk.split(":")[0]?.trim() || "")
          .filter(Boolean);
  const unique = Array.from(new Set(keys.length ? keys : [appliedTo.trim()]));
  for (const raw of unique) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    const sales = [
      ["sales", "sales-invoices"],
      ["sales", "invoices"],
      ["sales", "credit-notes"],
    ] as const;
    const purchases = [
      ["purchases", "purchase-invoices"],
      ["purchases", "bills"],
      ["purchases", "debit-notes"],
    ] as const;
    for (const [mod, ent] of [...sales, ...purchases]) {
      const records = loadEntityRecords(mod, ent);
      const match = records.find(
        (r) =>
          r.id.toLowerCase() === key ||
          (r.reference || "").trim().toLowerCase() === key ||
          `${(r.reference || "").trim()} — ${partyOf(r)}`.toLowerCase() === key,
      );
      if (match) {
        refreshDocumentPaymentStatus(mod, ent, match.id);
        break;
      }
    }
  }
}

function isInactiveDocument(status: string | undefined) {
  return /draft|void|voided|cancelled|canceled|inactive/i.test(status || "");
}

function openDocuments(side: "receivable" | "payable"): ManagerRecord[] {
  if (side === "receivable") {
    return [
      ...loadEntityRecords("sales", "sales-invoices"),
      ...loadEntityRecords("sales", "invoices"),
      ...loadEntityRecords("sales", "late-payment-fees"),
    ].filter((r) => !isInactiveDocument(r.status));
  }
  return [
    ...loadEntityRecords("purchases", "purchase-invoices"),
    ...loadEntityRecords("purchases", "bills"),
  ].filter((r) => !isInactiveDocument(r.status));
}

export function buildAgedReport(side: "receivable" | "payable", asOf?: string): AgedReport {
  const asOfDate = asOf || new Date().toISOString().slice(0, 10);
  const docs = openDocuments(side);
  const paidMap = buildDocumentPaidMap(docs, side, asOfDate);
  const rows: AgedRow[] = [];
  for (const doc of docs) {
    const documentDate = doc.date || doc.issueDate || "";
    if (documentDate && documentDate > asOfDate) continue;
    const total = docTotal(doc);
    if (!total) continue;
    const paid = paidMap.get(doc.id) || 0;
    const balance = roundMoney(Math.max(0, total - paid));
    if (balance <= 0) continue;
    const due = doc.dueDate || doc.date || asOfDate;
    const daysPastDue = daysBetween(due, asOfDate);
    rows.push({
      party: partyOf(doc),
      reference: doc.reference || doc.id.slice(0, 8),
      date: documentDate,
      dueDate: due,
      total,
      paid,
      balance,
      daysPastDue,
      bucket: bucketFor(daysPastDue),
      status: doc.status || "",
      id: doc.id,
    });
  }
  // Unallocated credit/debit notes reduce the oldest open document for the
  // same party so the subledger agrees with the AR/AP control account.
  const notes =
    side === "receivable"
      ? loadEntityRecords("sales", "credit-notes")
      : loadEntityRecords("purchases", "debit-notes");
  const creditsByParty = new Map<string, number>();
  for (const note of notes) {
    const noteDate = note.date || note.issueDate || "";
    if ((noteDate && noteDate > asOfDate) || isInactiveDocument(note.status)) {
      continue;
    }
    const key = partyOf(note).toLowerCase();
    creditsByParty.set(key, roundMoney((creditsByParty.get(key) || 0) + docTotal(note)));
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  for (const row of rows) {
    const key = row.party.toLowerCase();
    const available = creditsByParty.get(key) || 0;
    if (available <= 0) continue;
    const appliedCredit = Math.min(available, row.balance);
    row.paid = roundMoney(row.paid + appliedCredit);
    row.balance = roundMoney(row.balance - appliedCredit);
    creditsByParty.set(key, roundMoney(available - appliedCredit));
  }
  const openRows = rows.filter((row) => row.balance > 0);
  openRows.sort((a, b) => b.daysPastDue - a.daysPastDue || a.party.localeCompare(b.party));
  const totals: AgedReport["totals"] = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
    balance: 0,
  };
  for (const row of openRows) {
    totals[row.bucket] = roundMoney(totals[row.bucket] + row.balance);
    totals.balance = roundMoney(totals.balance + row.balance);
  }
  // Unapplied credit/debit note leftovers still sit in the control account.
  let leftoverCredits = 0;
  for (const credit of creditsByParty.values()) {
    leftoverCredits = roundMoney(leftoverCredits + credit);
  }
  if (leftoverCredits) {
    totals.current = roundMoney(totals.current - leftoverCredits);
    totals.balance = roundMoney(totals.balance - leftoverCredits);
  }
  return { asOf: asOfDate, rows: openRows, totals };
}

export function buildPartyStatement(
  side: "receivable" | "payable",
  partyFilter: string,
  asOf?: string,
  from?: string,
): PartyStatement | null {
  const asOfDate = asOf || new Date().toISOString().slice(0, 10);
  const fromDate = (from || "").slice(0, 10);
  if (!partyFilter.trim()) return null;

  const invoices =
    side === "receivable"
      ? [...loadEntityRecords("sales", "sales-invoices"), ...loadEntityRecords("sales", "invoices")]
      : [
          ...loadEntityRecords("purchases", "purchase-invoices"),
          ...loadEntityRecords("purchases", "bills"),
        ];
  const credits =
    side === "receivable"
      ? loadEntityRecords("sales", "credit-notes")
      : loadEntityRecords("purchases", "debit-notes");
  const money =
    side === "receivable"
      ? loadEntityRecords("banking", "receipts")
      : loadEntityRecords("banking", "payments");

  const matchParty = (r: ManagerRecord) => partiesMatch(partyOf(r), partyFilter);

  type Raw = { date: string; reference: string; description: string; debit: number; credit: number; kind: StatementLine["kind"] };
  const raw: Raw[] = [];

  for (const inv of invoices.filter(matchParty)) {
    const amt = docTotal(inv);
    if (!amt) continue;
    raw.push({
      date: inv.date || "",
      reference: inv.reference || "",
      description: inv.description || (side === "receivable" ? "Sales invoice" : "Purchase invoice"),
      debit: side === "receivable" ? amt : 0,
      credit: side === "payable" ? amt : 0,
      kind: "invoice",
    });
  }
  for (const cn of credits.filter(matchParty)) {
    const amt = docTotal(cn);
    if (!amt) continue;
    raw.push({
      date: cn.date || "",
      reference: cn.reference || "",
      description: cn.description || (side === "receivable" ? "Credit note" : "Debit note"),
      debit: side === "payable" ? amt : 0,
      credit: side === "receivable" ? amt : 0,
      kind: side === "receivable" ? "credit" : "debit",
    });
  }
  for (const m of money.filter(matchParty)) {
    const amt = recordToBase(m, parseAmount(m.amount));
    if (!amt) continue;
    raw.push({
      date: m.date || "",
      reference: m.reference || m.appliedTo || "",
      description: m.description || (side === "receivable" ? "Receipt" : "Payment"),
      debit: side === "payable" ? amt : 0,
      credit: side === "receivable" ? amt : 0,
      kind: side === "receivable" ? "receipt" : "payment",
    });
  }

  raw.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  let running = 0;
  const allLines: StatementLine[] = raw
    .filter((l) => !l.date || l.date <= asOfDate)
    .map((l) => {
      running = roundMoney(running + l.debit - l.credit);
      return { ...l, balance: running };
    });
  const period = applyStatementPeriod(allLines, { from: fromDate, to: asOfDate });

  const displayParty =
    invoices.find(matchParty)?.party ||
    money.find(matchParty)?.party ||
    partyFilter;

  return {
    party: displayParty,
    asOf: asOfDate,
    from: fromDate || undefined,
    opening: period.opening,
    lines: period.lines,
    closing: period.closing,
  };
}

export function openInvoiceOptions(side: "receivable" | "payable") {
  const base = baseCurrencyCode();
  const docs = openDocuments(side);
  const paidMap = buildDocumentPaidMap(docs, side);
  return docs
    .map((doc) => {
      // Balances are base-currency so they can be compared and allocated
      // against payments raised in any currency.
      const paid = paidMap.get(doc.id) || 0;
      const balance = roundMoney(Math.max(0, docTotal(doc) - paid));
      const currency = recordCurrency(doc);
      const documentTotal = docTotalInDocumentCurrency(doc);
      const foreignHint =
        currency !== base ? ` [${currency} ${documentTotal}]` : "";
      return {
        id: doc.id,
        reference: doc.reference || doc.id.slice(0, 8),
        party: partyOf(doc),
        balance,
        currency,
        documentTotal,
        label: `${doc.reference || doc.id.slice(0, 8)} — ${partyOf(doc)} (${balance} ${base} due)${foreignHint}`,
      };
    })
    .filter((o) => o.balance > 0);
}
