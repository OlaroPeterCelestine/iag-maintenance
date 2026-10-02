import { balanceSheet, loadLedgerLines, profitAndLoss } from "@/lib/ledger/posting";
import { computeAccountBalances } from "@/lib/ledger/posting";
import { parseAmount, roundMoney, type LedgerLine } from "@/lib/ledger/types";
import { isBaseCurrency, recordToBase } from "@/lib/ledger/fx";
import { formatMoney, signedMoney } from "@/lib/ledger/money";
import { loadManagerSettings } from "@/lib/manager-settings";
import type { ManagerRecord } from "@/lib/manager-entities";
import { originLinkForLedgerLine, type ModuleKpi, type ModuleSlug } from "@/lib/module-data";
import {
  bankAccountCurrency,
  enrichBankAccounts,
  enrichMoneyRecords,
  liveBankBalances,
} from "@/lib/banking-summary";
import { inventoryStockRollforward } from "@/lib/inventory-movement";
import { enrichDocumentsWithPaidBalances } from "@/lib/ar-ap";
import { reconcileBankAccount } from "@/lib/ledger/control-reconciliation";
import { loadRecords } from "@/lib/records-store";
import { isActiveEmployeeStatus } from "@/lib/hr-ops";
import { buildFleetServiceReminders } from "@/lib/fleet-service-reminders";

export type LiveDocument = {
  id: string;
  reference: string;
  party: string;
  initials: string;
  category: "Sales" | "Expense" | "Purchase";
  amount: number;
  status: string;
  date: string;
  due: string;
  href: string;
};

export type LiveActivity = {
  id: string;
  title: string;
  copy: string;
  amount: string;
  positive: boolean | null;
  time: string;
  date: string;
  tone: string;
  kind: "receipt" | "payment" | "invoice" | "bill" | "journal" | "transfer" | "other";
  href?: string;
};

function activityHref(line: LedgerLine): string | undefined {
  const origin = originLinkForLedgerLine(line);
  return origin?.href;
}

function initials(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

export function loadEntityRecords(module: string, entity: string): ManagerRecord[] {
  if (typeof window === "undefined") return [];
  return loadRecords(module, entity);
}

export function getLiveSummary() {
  const settings = loadManagerSettings();
  const year = new Date().getFullYear();
  const from = `${year}-01-01`;
  const to = new Date().toISOString().slice(0, 10);
  const bs = balanceSheet(to);
  const pl = profitAndLoss(from, to);
  const docs = getLiveDocuments();
  const paid = docs.filter((d) => /paid|complete|cleared/i.test(d.status)).length;
  const pending = docs.filter((d) => /pending|draft|active|due/i.test(d.status)).length;
  const overdue = docs.filter((d) => /overdue/i.test(d.status)).length;
  const ar = computeAccountBalances(to).find((a) => a.code === "1200" || /receivable/i.test(a.name));
  const ap = computeAccountBalances(to).find((a) => a.code === "2000" || /payable/i.test(a.name));

  return {
    businessName: settings.businessName,
    address: settings.address,
    currency: settings.baseCurrencyCode,
    asOf: to,
    year,
    totalAssets: bs.totalAssets,
    totalLiabilities: bs.totalLiabilities,
    totalEquity: bs.totalEquity,
    netProfit: pl.netProfit,
    totalIncome: pl.totalIncome,
    totalExpenses: pl.totalExpenses,
    accountsReceivable: ar?.balance ?? 0,
    accountsPayable: ap?.balance ?? 0,
    paidCount: paid,
    pendingCount: pending,
    overdueCount: overdue,
    documentCount: docs.length,
    balanced: bs.balanced,
    formatted: {
      assets: formatMoney(bs.totalAssets, true),
      liabilities: formatMoney(bs.totalLiabilities, true),
      equity: formatMoney(bs.totalEquity, true),
      netProfit: formatMoney(pl.netProfit, true),
      income: formatMoney(pl.totalIncome, true),
      expenses: formatMoney(pl.totalExpenses, true),
      ar: formatMoney(ar?.balance ?? 0),
      ap: formatMoney(ap?.balance ?? 0),
    },
  };
}

export function getMonthlyIncomeSeries(year = new Date().getFullYear()) {
  const lines = loadLedgerLines().filter((l) => l.date.startsWith(String(year)));
  const months = Array.from({ length: 12 }, (_, i) => {
    const month = String(i + 1).padStart(2, "0");
    const prefix = `${year}-${month}`;
    const monthLines = lines.filter((l) => l.date.startsWith(prefix));
    // Income accounts: credit increases income; use lines on income-type accounts via name heuristics + CoA
    const income = monthLines
      .filter((l) => /^4/.test(l.accountCode) || /sales|income|revenue/i.test(l.accountName))
      .reduce((s, l) => s + l.credit - l.debit, 0);
    return {
      key: prefix,
      label: new Date(year, i, 1).toLocaleString("en-US", { month: "short" }),
      income: Math.max(0, income),
    };
  });
  const max = Math.max(1, ...months.map((m) => m.income));
  return months.map((m) => ({
    ...m,
    height: Math.round((m.income / max) * 100),
    formatted: formatMoney(m.income, true),
  }));
}

function activityKind(line: LedgerLine): LiveActivity["kind"] {
  const e = line.sourceEntity || "";
  if (e.includes("receipt")) return "receipt";
  if (e.includes("payment")) return "payment";
  if (e.includes("sales-invoice") || e.includes("invoice")) return "invoice";
  if (e.includes("purchase") || e.includes("bill")) return "bill";
  if (e.includes("journal")) return "journal";
  if (e.includes("transfer")) return "transfer";
  return "other";
}

function activityMeta(kind: LiveActivity["kind"]) {
  switch (kind) {
    case "receipt":
      return { title: "Receipt posted", tone: "bg-emerald-50 text-emerald-600", positive: true as boolean | null };
    case "payment":
      return { title: "Payment posted", tone: "bg-rose-50 text-rose-600", positive: false };
    case "invoice":
      return { title: "Sales invoice", tone: "bg-sky-50 text-sky-600", positive: null };
    case "bill":
      return { title: "Purchase invoice", tone: "bg-amber-50 text-amber-600", positive: null };
    case "journal":
      return { title: "Journal entry", tone: "bg-violet-50 text-violet-600", positive: null };
    case "transfer":
      return { title: "Transfer", tone: "bg-cyan-50 text-cyan-600", positive: null };
    default:
      return { title: "Ledger posting", tone: "bg-slate-100 text-slate-600", positive: null };
  }
}

export function getLiveActivity(limit = 6): LiveActivity[] {
  const lines = loadLedgerLines()
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.date.localeCompare(a.date));

  // One row per source record (take first line of each entry)
  const seen = new Set<string>();
  const items: LiveActivity[] = [];
  for (const line of lines) {
    const key = line.sourceRecordId || line.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = activityKind(line);
    const meta = activityMeta(kind);
    const amount = line.debit || line.credit;
    const direction =
      kind === "receipt" || (kind === "invoice" && line.debit > 0)
        ? "in"
        : kind === "payment" || (kind === "bill" && line.credit > 0)
          ? "out"
          : "neutral";
    const time = line.createdAt
      ? new Date(line.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      : "";
    items.push({
      id: key,
      title: meta.title,
      copy: line.narration || `${line.accountCode} ${line.accountName}`,
      amount:
        direction === "neutral"
          ? formatMoney(amount)
          : signedMoney(amount, direction),
      positive: meta.positive,
      time,
      date: line.date,
      tone: meta.tone,
      kind,
      href: activityHref(line),
    });
    if (items.length >= limit) break;
  }
  return items;
}

export function getLiveDocuments(): LiveDocument[] {
  const sales = loadEntityRecords("sales", "sales-invoices");
  const purchases = loadEntityRecords("purchases", "purchase-invoices");
  const mapDoc = (
    record: ManagerRecord,
    category: LiveDocument["category"],
    href: string,
  ): LiveDocument => {
    const party = record.party || record.customer || record.supplier || record.name || "—";
    return {
      id: record.id,
      reference: record.reference || String(record.id || "").slice(0, 8).toUpperCase() || "—",
      party,
      initials: initials(party),
      category,
      amount: recordToBase(record, parseAmount(record.amount || record.total)),
      status: record.status || "Active",
      date: recordDateValue(record.date || record.issueDate || record.createdAt),
      due: record.dueDate || record.due || "",
      href,
    };
  };
  return [
    ...sales.map((r) => mapDoc(r, "Sales", "/sales?view=sales-invoices")),
    ...purchases.map((r) => mapDoc(r, "Purchase", "/purchases?view=purchase-invoices")),
  ].sort((a, b) => b.date.localeCompare(a.date));
}

/** Party AR balance from invoices − receipts − credit notes */
export function customerBalances(): Map<string, number> {
  const map = new Map<string, number>();
  const add = (name: string, delta: number) => {
    const key = String(name ?? "").trim().toLowerCase();
    if (!key) return;
    map.set(key, (map.get(key) || 0) + delta);
  };
  const skip = (status?: string) =>
    /draft|void|voided|cancelled|canceled|inactive/i.test(status || "");
  for (const r of loadEntityRecords("sales", "sales-invoices")) {
    if (skip(r.status)) continue;
    add(r.party || r.customer || "", recordToBase(r, parseAmount(r.amount)));
  }
  for (const r of loadEntityRecords("sales", "credit-notes")) {
    if (skip(r.status)) continue;
    add(r.party || r.customer || "", -recordToBase(r, parseAmount(r.amount)));
  }
  for (const r of loadEntityRecords("banking", "receipts")) {
    if (skip(r.status)) continue;
    add(r.party || r.customer || r.paidBy || "", -recordToBase(r, parseAmount(r.amount)));
  }
  return map;
}

/** Party AP balance from bills − payments − debit notes */
export function supplierBalances(): Map<string, number> {
  const map = new Map<string, number>();
  const add = (name: string, delta: number) => {
    const key = String(name ?? "").trim().toLowerCase();
    if (!key) return;
    map.set(key, (map.get(key) || 0) + delta);
  };
  const skip = (status?: string) =>
    /draft|void|voided|cancelled|canceled|inactive/i.test(status || "");
  for (const r of loadEntityRecords("purchases", "purchase-invoices")) {
    if (skip(r.status)) continue;
    add(r.party || r.supplier || "", recordToBase(r, parseAmount(r.amount)));
  }
  for (const r of loadEntityRecords("purchases", "debit-notes")) {
    if (skip(r.status)) continue;
    add(r.party || r.supplier || "", -recordToBase(r, parseAmount(r.amount)));
  }
  for (const r of loadEntityRecords("banking", "payments")) {
    if (skip(r.status)) continue;
    add(r.party || r.supplier || r.payee || "", -recordToBase(r, parseAmount(r.amount)));
  }
  return map;
}

export function bankBalancesByName(): Map<string, number> {
  return liveBankBalances();
}

/** Enrich module table rows with live calculated money fields */
export function enrichRecordsWithLiveBalances(
  entityKey: string,
  records: ManagerRecord[],
): ManagerRecord[] {
  if (entityKey === "chart-of-accounts") {
    const balances = computeAccountBalances();
    const byCode = new Map(balances.map((b) => [b.code, b.balance]));
    const byName = new Map(balances.map((b) => [b.name.toLowerCase(), b.balance]));
    return records.map((r) => ({
      ...r,
      balance: String(
        byCode.get(r.code) ?? byName.get((r.name || "").toLowerCase()) ?? parseAmount(r.balance),
      ),
    }));
  }

  if (entityKey === "bank-and-cash-accounts") {
    return enrichBankAccounts(records);
  }

  if (entityKey === "reconciliations") {
    return records.map((r) => {
      const account = String(r.account || r.bankAccount || "").trim();
      if (!account) return r;
      const asOf = r.date || new Date().toISOString().slice(0, 10);
      const result = reconcileBankAccount({
        account,
        statementBalance: parseAmount(r.statementBalance),
        asOf,
      });
      return {
        ...r,
        systemBalance: String(result.bookBalance),
        discrepancy: String(result.discrepancy),
        status: result.balanced ? "Reconciled" : "Not reconciled",
        ...(result.currency
          ? { currency: result.currency, currencyCode: result.currency }
          : {}),
      };
    });
  }

  if (entityKey === "receipts" || entityKey === "payments") {
    return enrichMoneyRecords(records);
  }

  if (entityKey.includes("bank") && entityKey !== "bank-statements") {
    return enrichBankAccounts(records);
  }

  if (entityKey === "customers") {
    const ar = customerBalances();
    return records.map((r) => ({
      ...r,
      balance: String(ar.get((r.name || "").toLowerCase()) ?? parseAmount(r.balance)),
      creditLimit: r.creditLimit || "",
    }));
  }

  if (entityKey === "suppliers") {
    const ap = supplierBalances();
    return records.map((r) => ({
      ...r,
      balance: String(ap.get((r.name || "").toLowerCase()) ?? parseAmount(r.balance)),
    }));
  }

  if (entityKey === "fixed-assets" || entityKey === "intangible-assets") {
    return records.map((r) => {
      const cost = parseAmount(
        r.totalAcquisitionCost || r.cost || r.amount || r.purchasePrice || "0",
      );
      const accum = parseAmount(r.accumulatedDepreciation || "0");
      const stored = parseAmount(r.bookValue);
      const book = stored || roundMoney(Math.max(0, cost - accum));
      return {
        ...r,
        bookValue: String(book || stored || ""),
      };
    });
  }

  if (
    entityKey === "sales-invoices" ||
    entityKey === "invoices" ||
    entityKey === "late-payment-fees"
  ) {
    return enrichDocumentsWithPaidBalances(records, "receivable");
  }

  if (entityKey === "purchase-invoices" || entityKey === "bills") {
    return enrichDocumentsWithPaidBalances(records, "payable");
  }

  return records;
}

/** Sum record amounts in BASE currency — records may be in different currencies. */
function sumAmount(records: ManagerRecord[], keys: string[] = ["amount", "total"]) {
  return records.reduce((sum, r) => {
    for (const key of keys) {
      if (r[key]) return sum + recordToBase(r, parseAmount(r[key]));
    }
    return sum;
  }, 0);
}

function monthPrefix(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}


/** Coerce API dates (string, unix, Go NullTime) so `.slice` / `.startsWith` cannot crash a page. */
export function recordDateValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    return match ? match[1] : value.slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return recordDateValue(rec.Time ?? rec.time ?? rec.date ?? rec.createdAt);
  }
  return String(value).slice(0, 10);
}

function inMonth(record: ManagerRecord, prefix = monthPrefix()) {
  return recordDateValue(record.date || record.issueDate || record.createdAt).startsWith(prefix);
}

function statusMatches(record: ManagerRecord, pattern: RegExp) {
  return pattern.test(String(record.status ?? ""));
}

function kpi(
  title: string,
  value: string,
  delta: string,
  positive: boolean,
  hint?: string,
): ModuleKpi {
  return { title, value, delta, positive, hint };
}

/** Live module KPI cards from in-memory records + ledger balances. */
export function getModuleKpis(slug: ModuleSlug): ModuleKpi[] {
  if (typeof window === "undefined") return [];
  try {
    return computeModuleKpis(slug);
  } catch {
    return [];
  }
}

function computeModuleKpis(slug: ModuleSlug): ModuleKpi[] {
  // Lazy: full BS/P&L summary is expensive — only build when a case needs it.
  let summaryCache: ReturnType<typeof getLiveSummary> | null = null;
  const summary = () => {
    if (!summaryCache) summaryCache = getLiveSummary();
    return summaryCache;
  };
  const prefix = monthPrefix();
  const countHint = (n: number) => (n === 0 ? "no data yet" : "live");

  switch (slug) {
    case "banking": {
      const accounts = loadEntityRecords("banking", "bank-and-cash-accounts");
      const transfers = loadEntityRecords("banking", "inter-account-transfers").filter((r) =>
        inMonth(r, prefix),
      );
      // Balances are already converted to base (USh) via FX for foreign banks.
      const banks = bankBalancesByName();
      let cash = 0;
      let bank = 0;
      let foreignBanks = 0;
      for (const a of accounts) {
        const name = String(a.name || a.account || "").trim();
        const currency = bankAccountCurrency(name) || a.currency || a.currencyCode || "";
        if (currency && !isBaseCurrency(currency)) foreignBanks += 1;
        const live =
          banks.get(name.toLowerCase()) ??
          banks.get((a.code || "").toLowerCase()) ??
          0;
        if (/cash|petty/i.test(a.name || "") || /cash/i.test(a.type || "")) cash += live;
        else bank += live;
      }
      if (!accounts.length) {
        for (const row of computeAccountBalances()) {
          if (row.type !== "Asset") continue;
          if (!/cash|bank|1100|1000/i.test(`${row.code} ${row.name}`)) continue;
          if (/cash/i.test(row.name)) cash += row.balance;
          else bank += row.balance;
        }
      }
      const unreconciled = accounts.filter((a) => !/reconcil/i.test(a.status || "")).length;
      const fxHint = foreignBanks > 0 ? "incl. FX" : "ledger";
      return [
        kpi("Cash on hand", formatMoney(cash, true), countHint(accounts.length), true, fxHint),
        kpi("Bank balance", formatMoney(bank, true), countHint(accounts.length), true, fxHint),
        kpi("Unreconciled", String(unreconciled), unreconciled ? "to review" : "clear", unreconciled === 0, "accounts"),
        kpi("Transfers MTD", formatMoney(sumAmount(transfers), true), `${transfers.length}`, true, "this month"),
      ];
    }
    case "receipts-payments": {
      const receipts = loadEntityRecords("banking", "receipts");
      const payments = loadEntityRecords("banking", "payments");
      const receiptsMtd = receipts.filter((r) => inMonth(r, prefix));
      const paymentsMtd = payments.filter((r) => inMonth(r, prefix));
      const netMtd = sumAmount(receiptsMtd) - sumAmount(paymentsMtd);
      return [
        kpi(
          "Received MTD",
          formatMoney(sumAmount(receiptsMtd), true),
          `${receiptsMtd.length}`,
          true,
          "this month",
        ),
        kpi(
          "Paid MTD",
          formatMoney(sumAmount(paymentsMtd), true),
          `${paymentsMtd.length}`,
          true,
          "this month",
        ),
        kpi("Net movement", formatMoney(netMtd, true), netMtd >= 0 ? "inflow" : "outflow", netMtd >= 0, "this month"),
        kpi(
          "Transactions",
          String(receipts.length + payments.length),
          countHint(receipts.length + payments.length),
          true,
          "all time",
        ),
      ];
    }
    case "expense-claims": {
      const claims = loadEntityRecords("expense-claims", "expense-claims");
      const open = claims.filter((c) => statusMatches(c, /pending|draft|active|review/i));
      const approved = claims.filter((c) => statusMatches(c, /approved/i) && inMonth(c, prefix));
      const paid = claims.filter((c) => statusMatches(c, /paid|reimburs/i) && inMonth(c, prefix));
      const awaiting = claims.filter((c) => statusMatches(c, /approved/i));
      return [
        kpi("Open claims", String(open.length), countHint(claims.length), open.length === 0, "to review"),
        kpi("Approved MTD", formatMoney(sumAmount(approved), true), `${approved.length}`, true, "vs ledger"),
        kpi("Reimbursed", formatMoney(sumAmount(paid), true), `${paid.length}`, true, "paid"),
        kpi("Awaiting pay", formatMoney(sumAmount(awaiting), true), `${awaiting.length}`, awaiting.length === 0, "approved"),
      ];
    }
    case "requests":
    case "general-requests":
    case "oral-payment-requests": {
      const general = loadEntityRecords("requests", "general-requests");
      const oral = loadEntityRecords("requests", "oral-payment-requests");
      const closed =
        /^(draft|paid|rejected|declined|cancelled|canceled|void|voided|complete|completed|fulfilled)$/i;
      if (slug === "general-requests") {
        const open = general.filter((r) => {
          const s = String(r.status ?? "").trim();
          return Boolean(s) && !closed.test(s);
        });
        const inApproval = open.filter((r) =>
          statusMatches(r, /submitted|approved|accounts|gm|ceo|pending|review/i),
        );
        const paidMtd = general.filter((r) => statusMatches(r, /paid/i) && inMonth(r, prefix));
        return [
          kpi("Open general", String(open.length), countHint(general.length), open.length === 0, "to review"),
          kpi("In approval", String(inApproval.length), `${open.length} open`, inApproval.length === 0, "pipeline"),
          kpi("Paid MTD", String(paidMtd.length), countHint(paidMtd.length), true, "this month"),
          kpi("Total", String(general.length), "all time", true, "records"),
        ];
      }
      if (slug === "oral-payment-requests") {
        const open = oral.filter((r) => {
          const s = String(r.status ?? "").trim();
          return Boolean(s) && !closed.test(s);
        });
        const inApproval = open.filter((r) =>
          statusMatches(r, /submitted|approved|accounts|gm|ceo|pending|review/i),
        );
        const paidMtd = oral.filter((r) => statusMatches(r, /paid/i) && inMonth(r, prefix));
        return [
          kpi("Open oral", String(open.length), countHint(oral.length), open.length === 0, "to review"),
          kpi("In approval", String(inApproval.length), `${open.length} open`, inApproval.length === 0, "pipeline"),
          kpi("Paid MTD", String(paidMtd.length), countHint(paidMtd.length), true, "this month"),
          kpi("Total", String(oral.length), "all time", true, "records"),
        ];
      }
      const all = [...general, ...oral];
      const open = all.filter((r) => {
        const s = String(r.status ?? "").trim();
        return Boolean(s) && !closed.test(s);
      });
      const inApproval = open.filter((r) =>
        statusMatches(r, /submitted|approved|pm|accounts|gm|ceo|pending|review/i),
      );
      const paidMtd = all.filter((r) => statusMatches(r, /paid/i) && inMonth(r, prefix));
      const oralOpen = oral.filter((r) => {
        const s = String(r.status ?? "").trim();
        return Boolean(s) && !closed.test(s);
      });
      return [
        kpi("Open requests", String(open.length), countHint(all.length), open.length === 0, "to review"),
        kpi("In approval", String(inApproval.length), `${open.length} open`, inApproval.length === 0, "pipeline"),
        kpi("Paid MTD", String(paidMtd.length), countHint(paidMtd.length), true, "this month"),
        kpi("Oral open", String(oralOpen.length), `${oral.length} total`, oralOpen.length === 0, "requisitions"),
      ];
    }
    case "sales": {
      const invoices = loadEntityRecords("sales", "sales-invoices");
      const customers = loadEntityRecords("sales", "customers");
      const quotes = loadEntityRecords("sales", "sales-quotes").filter((q) =>
        statusMatches(q, /pending|draft|quoted|open|active/i),
      );
      const mtd = invoices.filter((i) => inMonth(i, prefix));
      const open = invoices.filter((i) => !statusMatches(i, /paid|complete|void|cancelled/i));
      return [
        kpi("Revenue MTD", formatMoney(sumAmount(mtd), true), countHint(mtd.length), true, "this month"),
        kpi("Open invoices", formatMoney(sumAmount(open), true), `${open.length}`, open.length === 0, "receivable"),
        kpi("Customers", String(customers.length), countHint(customers.length), true, "active"),
        kpi("Quotes open", String(quotes.length), countHint(quotes.length), true, "awaiting"),
      ];
    }
    case "purchases": {
      const invoices = loadEntityRecords("purchases", "purchase-invoices");
      const suppliers = loadEntityRecords("purchases", "suppliers");
      const orders = loadEntityRecords("purchases", "purchase-orders").filter((o) =>
        statusMatches(o, /pending|ordered|open|active|draft/i),
      );
      const mtd = invoices.filter((i) => inMonth(i, prefix));
      const open = invoices.filter((i) => !statusMatches(i, /paid|complete|void|cancelled/i));
      return [
        kpi("Spend MTD", formatMoney(sumAmount(mtd), true), countHint(mtd.length), true, "this month"),
        kpi("Open bills", formatMoney(sumAmount(open), true), `${open.length}`, open.length === 0, "payable"),
        kpi("Suppliers", String(suppliers.length), countHint(suppliers.length), true, "active"),
        kpi("POs open", String(orders.length), countHint(orders.length), orders.length === 0, "awaiting"),
      ];
    }
    case "inventory": {
      const roll = inventoryStockRollforward();
      const locations = loadEntityRecords("inventory", "inventory-locations");
      const low =
        roll.items.filter((i) => i.closingQty > 0 && i.closingQty <= 10).length +
        roll.items.filter((i) => i.closingQty === 0).length;
      return [
        kpi(
          "Total inventory",
          String(roll.items.length),
          roll.items.length === 1 ? "1 item" : `${roll.items.length} items`,
          true,
          "SKUs on file",
        ),
        kpi(
          "Stock value",
          formatMoney(roll.stockValue, true),
          `Open ${formatMoney(roll.openingValue, true)} · In ${formatMoney(roll.stockInValue, true)} · Write-offs ${formatMoney(roll.writeOffValue, true)} · Sold ${formatMoney(roll.soldValue, true)}`,
          true,
          "open + in − write-offs − sold",
        ),
        kpi(
          "Closing inventory",
          formatMoney(roll.closingValue, true),
          `${roll.closingQty} units on hand`,
          true,
          "closing value",
        ),
        kpi("Low stock", String(low), low ? "alerts" : "ok", low === 0, `${locations.length} locations`),
      ];
    }
    case "projects": {
      const projects = loadEntityRecords("projects", "projects");
      const managers = loadEntityRecords("projects", "project-managers").filter(
        (m) => !statusMatches(m, /inactive|void|archived/i),
      );
      const contractors = loadEntityRecords("projects", "contractors").filter(
        (c) => !statusMatches(c, /inactive|void|archived/i),
      );
      const paymentRequests = loadEntityRecords("projects", "payment-requests");
      const active = projects.filter((p) => statusMatches(p, /active|running|open|planning/i));
      const openPay = paymentRequests.filter(
        (r) => !statusMatches(r, /paid|cancelled|canceled|rejected/i),
      );
      return [
        kpi("Project managers", String(managers.length), countHint(managers.length), true, "staff"),
        kpi("Contractors", String(contractors.length), countHint(contractors.length), true, "companies"),
        kpi("Active projects", String(active.length), countHint(projects.length), true, "running"),
        kpi(
          "Payment requests",
          String(openPay.length),
          countHint(paymentRequests.length),
          openPay.length === 0,
          "open",
        ),
      ];
    }
    case "fleet": {
      const vehicles = loadEntityRecords("fleet", "vehicles");
      const fuelRequests = loadEntityRecords("fleet", "fuel-requests");
      const fuelLogs = loadEntityRecords("fleet", "fuel-logs");
      const tripRequests = loadEntityRecords("fleet", "trip-requests");
      const maintenance = loadEntityRecords("fleet", "maintenance-requests");
      const active = vehicles.filter((v) => !statusMatches(v, /inactive|disposed|void/i));
      const pendingFuel = fuelRequests.filter((r) =>
        statusMatches(r, /draft|pending|submitted|awaiting approval|unapproved/i),
      );
      const pendingTrips = tripRequests.filter((r) =>
        statusMatches(r, /draft|pending|submitted|awaiting approval|unapproved/i),
      );
      const openMaint = maintenance.filter(
        (m) => !statusMatches(m, /completed|cancelled|canceled/i),
      );
      const fuelSpend = sumAmount(
        fuelLogs.filter((r) => !statusMatches(r, /draft|void/i)),
        ["amount"],
      );
      const maintSpend = sumAmount(
        maintenance.filter((m) => statusMatches(m, /completed|posted|approved/i)),
        ["actualCost", "estimatedCost", "amount"],
      );
      const insuranceDue = vehicles.filter((v) => {
        const exp = String(v.insuranceExpiry ?? "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) return false;
        const days = (Date.parse(`${exp}T00:00:00`) - Date.now()) / 86_400_000;
        return days >= 0 && days <= 45;
      }).length;
      const serviceDue = buildFleetServiceReminders().filter(
        (r) => r.severity === "overdue" || r.severity === "due-soon",
      ).length;
      return [
        kpi("Active vehicles", String(active.length), countHint(vehicles.length), true, "fleet"),
        kpi(
          "Service due",
          String(serviceDue),
          `${pendingTrips.length} trips · ${openMaint.length} maint open`,
          serviceDue === 0,
          "compliance",
        ),
        kpi(
          "Fuel + maint spend",
          formatMoney(roundMoney(fuelSpend + maintSpend), true),
          `${pendingFuel.length} fuel requests`,
          true,
          "ops",
        ),
        kpi(
          "Insurance ≤45d",
          String(insuranceDue),
          insuranceDue ? "renew soon" : "ok",
          insuranceDue === 0,
          "compliance",
        ),
      ];
    }
    case "pos": {
      const sales = loadEntityRecords("pos", "pos-sales").filter((p) => inMonth(p, prefix));
      const returns = loadEntityRecords("pos", "pos-returns").filter((p) => inMonth(p, prefix));
      const sessions = loadEntityRecords("pos", "cash-sessions");
      const openSessions = sessions.filter((s) => statusMatches(s, /open/i));
      const products = loadEntityRecords("pos", "pos-products").filter(
        (p) => !statusMatches(p, /inactive|discontinued|void/i),
      );
      const salesTotal = sumAmount(sales, ["amount", "total"]);
      const returnsTotal = sumAmount(returns, ["amount", "total"]);
      return [
        kpi("Sales MTD", formatMoney(salesTotal, true), `${sales.length} tickets`, true, "gross"),
        kpi(
          "Net MTD",
          formatMoney(roundMoney(salesTotal - returnsTotal), true),
          returns.length ? `${returns.length} returns` : "no returns",
          true,
          "after returns",
        ),
        kpi("Open sessions", String(openSessions.length), countHint(sessions.length), openSessions.length === 0, "tills"),
        kpi("POS products", String(products.length), "sellable", true, "catalog"),
      ];
    }
    case "payroll": {
      const employees = loadEntityRecords("payroll", "employees");
      const active = employees.filter((e) => isActiveEmployeeStatus(e.status));
      const payslips = loadEntityRecords("payroll", "payslips").filter((p) => inMonth(p, prefix));
      const leavePending = loadEntityRecords("payroll", "leave-requests").filter((r) =>
        statusMatches(r, /pending|submitted|awaiting/i),
      );
      const today = new Date().toISOString().slice(0, 10);
      const present = loadEntityRecords("payroll", "attendance").filter(
        (a) => a.date === today && statusMatches(a, /present|remote|on.?site/i),
      );
      return [
        kpi("Headcount", String(active.length), countHint(employees.length), true, "active"),
        kpi("Present today", String(present.length), `${present.length} logged`, true, "attendance"),
        kpi("Leave pending", String(leavePending.length), countHint(leavePending.length), leavePending.length === 0, "approvals"),
        kpi(
          "Payroll MTD",
          formatMoney(sumAmount(payslips, ["amount", "netPay", "earnings"]), true),
          `${payslips.length} slips`,
          true,
          "net",
        ),
      ];
    }
    case "investments": {
      const holdings = loadEntityRecords("investments", "investments");
      const book = sumAmount(holdings, ["book", "bookValue", "amount", "cost"]);
      return [
        kpi("Portfolio value", formatMoney(book, true), countHint(holdings.length), true, "book"),
        kpi("Holdings", String(holdings.length), countHint(holdings.length), true, "securities"),
        kpi("Active", String(holdings.filter((h) => statusMatches(h, /active/i)).length || holdings.length), "positions", true, "listed"),
        kpi("Qty total", String(holdings.reduce((s, h) => s + parseAmount(h.qty || h.quantity), 0)), "units", true, "sum"),
      ];
    }
    case "assets": {
      const fixed = loadEntityRecords("assets", "fixed-assets");
      const intangible = loadEntityRecords("assets", "intangible-assets");
      const depr = loadEntityRecords("assets", "depreciation-entries").filter((d) => inMonth(d, prefix));
      const book =
        sumAmount(fixed, ["book", "bookValue", "amount"]) +
        sumAmount(intangible, ["book", "bookValue", "amount"]);
      return [
        kpi("Book value", formatMoney(book, true), countHint(fixed.length + intangible.length), true, "assets"),
        kpi("Asset count", String(fixed.length + intangible.length), countHint(fixed.length), true, "active"),
        kpi("Depreciation MTD", formatMoney(sumAmount(depr), true), `${depr.length}`, true, "expense"),
        kpi("Intangibles", formatMoney(sumAmount(intangible, ["book", "bookValue", "amount"]), true), `${intangible.length}`, true, "book"),
      ];
    }
    case "capital": {
      const members = loadEntityRecords("capital", "capital-accounts");
      const capital = sumAmount(members, ["capital", "amount", "balance"]);
      const drawings = sumAmount(members, ["drawings"]);
      const live = summary();
      return [
        kpi("Members", String(members.length), countHint(members.length), true, "active"),
        kpi("Capital total", formatMoney(capital || live.totalEquity, true), countHint(members.length), true, "equity"),
        kpi("Drawings YTD", formatMoney(drawings, true), countHint(members.length), drawings === 0, "withdrawn"),
        kpi("Equity", formatMoney(live.totalEquity, true), live.balanced ? "balanced" : "check TB", live.balanced, "ledger"),
      ];
    }
    case "accounts": {
      const chart = loadEntityRecords("accounts", "chart-of-accounts");
      const journals = loadEntityRecords("accounts", "journal-entries").filter((j) => inMonth(j, prefix));
      const special = loadEntityRecords("accounts", "special-accounts");
      const balances = computeAccountBalances();
      const live = summary();
      return [
        kpi("Accounts", String(chart.length || balances.length), countHint(chart.length || balances.length), true, "mapped"),
        kpi("Journals MTD", String(journals.length), countHint(journals.length), true, "posted"),
        kpi("Special ledgers", String(special.length), countHint(special.length), true, "custom"),
        kpi("Trial balance", live.balanced ? "OK" : "Diff", live.balanced ? "Balanced" : "Review", live.balanced, "as of today"),
      ];
    }
    case "documents": {
      const folders = loadEntityRecords("documents", "folders");
      const attachments = loadEntityRecords("documents", "attachments");
      const added = attachments.filter((a) => inMonth(a, prefix));
      const unfiled = attachments.filter((a) => !a.folder || a.folder === "—" || /unfiled|inbox/i.test(a.status || a.folder || ""));
      return [
        kpi("Folders", String(folders.length), countHint(folders.length), true, "organized"),
        kpi("Attachments", String(attachments.length), countHint(attachments.length), true, "stored"),
        kpi("Added MTD", String(added.length), countHint(added.length), true, "files"),
        kpi("Unfiled", String(unfiled.length), unfiled.length ? "to sort" : "clear", unfiled.length === 0, "files"),
      ];
    }
    case "production": {
      // Maintenance — this app's "production" module is the machinery
      // maintenance desk on iag-mes. The strip used to count coffee
      // production orders and roast/pack runs, which this app never shows.
      const machines = loadEntityRecords("production", "work-centers").filter(
        (m) => !statusMatches(m, /retired|inactive|void/i),
      );
      const stopped = machines.filter((m) => statusMatches(m, /^down$|maintenance|^pm$/i));
      const orders = loadEntityRecords("production", "work-orders");
      const openOrders = orders.filter(
        (o) => !statusMatches(o, /complete|completed|cancelled|canceled|void/i),
      );
      const overdueOrders = openOrders.filter((o) => o.dueDate && o.dueDate < new Date().toISOString().slice(0, 10));
      const overduePm = loadEntityRecords("production", "pm-schedules").filter((s) =>
        statusMatches(s, /overdue/i),
      );
      const downtime = loadEntityRecords("production", "downtime-logs").filter((d) =>
        statusMatches(d, /open/i),
      );
      return [
        kpi(
          "Machines",
          String(machines.length),
          stopped.length ? `${stopped.length} stopped` : countHint(machines.length),
          stopped.length === 0,
          "registered",
        ),
        kpi(
          "Open work orders",
          String(openOrders.length),
          overdueOrders.length ? `${overdueOrders.length} past due` : countHint(orders.length),
          overdueOrders.length === 0,
          "to do",
        ),
        kpi(
          "Overdue PM",
          String(overduePm.length),
          overduePm.length ? "service due" : "on schedule",
          overduePm.length === 0,
          "preventive",
        ),
        kpi(
          "Open downtime",
          String(downtime.length),
          downtime.length ? "machines stopped" : "clear",
          downtime.length === 0,
          "stoppages",
        ),
      ];
    }
    case "lab": {
      const samples = loadEntityRecords("lab", "lab-samples");
      const results = loadEntityRecords("lab", "lab-results");
      const openSamples = samples.filter(
        (s) => !statusMatches(s, /complete|completed|released|rejected|void|cancelled/i),
      );
      const resultsMtd = results.filter((r) => inMonth(r, prefix));
      const holds = [...samples, ...results].filter((r) =>
        statusMatches(r, /hold|quarantine|pending/i),
      );
      const stability = loadEntityRecords("lab", "stability-studies").filter(
        (s) => !statusMatches(s, /closed|complete|completed|cancelled/i),
      );
      return [
        kpi("Open samples", String(openSamples.length), countHint(samples.length), openSamples.length === 0, "in lab"),
        kpi("Results MTD", String(resultsMtd.length), countHint(resultsMtd.length), true, "this month"),
        kpi("On hold", String(holds.length), holds.length ? "review" : "clear", holds.length === 0, "samples"),
        kpi("Stability open", String(stability.length), countHint(stability.length), true, "studies"),
      ];
    }
    case "qa": {
      const checks = loadEntityRecords("qa", "quality-checks");
      const incoming = loadEntityRecords("qa", "incoming-inspections");
      const ncrs = loadEntityRecords("qa", "non-conformances");
      const capa = loadEntityRecords("qa", "capa-actions");
      const openNcr = ncrs.filter(
        (n) => !statusMatches(n, /closed|complete|completed|void|cancelled/i),
      );
      const openCapa = capa.filter(
        (c) => !statusMatches(c, /closed|complete|completed|void|cancelled/i),
      );
      const fails = [...checks, ...incoming].filter((r) =>
        statusMatches(r, /fail|reject|rejected/i),
      );
      const holds = loadEntityRecords("qa", "hold-and-release-log").filter((h) =>
        statusMatches(h, /hold|quarantine|open/i),
      );
      return [
        kpi("Open NCRs", String(openNcr.length), countHint(ncrs.length), openNcr.length === 0, "quality"),
        kpi("Open CAPA", String(openCapa.length), countHint(capa.length), openCapa.length === 0, "actions"),
        kpi("Fails / rejects", String(fails.length), countHint(fails.length), fails.length === 0, "checks"),
        kpi("On hold", String(holds.length), holds.length ? "blocked" : "clear", holds.length === 0, "release"),
      ];
    }
    case "contract-manager": {
      const contractors = loadEntityRecords("contract-manager", "contractors").filter(
        (c) => !statusMatches(c, /inactive|void|archived/i),
      );
      // Contractors also live under projects for shared pickers.
      const projectContractors = loadEntityRecords("projects", "contractors").filter(
        (c) => !statusMatches(c, /inactive|void|archived/i),
      );
      const invoices = loadEntityRecords("contract-manager", "contractor-invoices");
      const openInv = invoices.filter(
        (i) => !statusMatches(i, /paid|void|cancelled|canceled/i),
      );
      const ledgers = loadEntityRecords("contract-manager", "contractor-ledgers");
      const contractorCount = Math.max(contractors.length, projectContractors.length);
      return [
        kpi("Contractors", String(contractorCount), countHint(contractorCount), true, "active"),
        kpi("Open invoices", String(openInv.length), countHint(invoices.length), openInv.length === 0, "billing"),
        kpi("Invoices", String(invoices.length), countHint(invoices.length), true, "all"),
        kpi("Ledgers", String(ledgers.length), countHint(ledgers.length), true, "accounts"),
      ];
    }
    case "crm": {
      const leads = loadEntityRecords("crm", "leads");
      const openLeads = leads.filter(
        (l) => !statusMatches(l, /won|lost|converted|closed|void/i),
      );
      const opportunities = loadEntityRecords("crm", "opportunities").filter(
        (o) => !statusMatches(o, /won|lost|closed|void/i),
      );
      const followUps = loadEntityRecords("crm", "follow-ups").filter((a) => inMonth(a, prefix));
      const contacts = loadEntityRecords("crm", "contacts");
      return [
        kpi("Open leads", String(openLeads.length), countHint(leads.length), true, "pipeline"),
        kpi("Opportunities", String(opportunities.length), countHint(opportunities.length), true, "active"),
        kpi("Follow-ups MTD", String(followUps.length), countHint(followUps.length), true, "this month"),
        kpi("Contacts", String(contacts.length), countHint(contacts.length), true, "directory"),
      ];
    }
    case "logistics": {
      const shipments = loadEntityRecords("logistics", "shipments");
      const inTransit = shipments.filter((s) =>
        statusMatches(s, /transit|shipped|dispatched|in.?progress/i),
      );
      const pods = loadEntityRecords("logistics", "proof-of-delivery").filter((d) =>
        inMonth(d, prefix),
      );
      const routes = loadEntityRecords("logistics", "routes").filter(
        (r) => !statusMatches(r, /inactive|void|archived/i),
      );
      const carriers = loadEntityRecords("logistics", "carriers").filter(
        (c) => !statusMatches(c, /inactive|void/i),
      );
      return [
        kpi("In transit", String(inTransit.length), countHint(shipments.length), true, "shipments"),
        kpi("PODs MTD", String(pods.length), countHint(pods.length), true, "this month"),
        kpi("Active routes", String(routes.length), countHint(routes.length), true, "network"),
        kpi("Carriers", String(carriers.length), countHint(carriers.length), true, "partners"),
      ];
    }
    case "distribution": {
      const orders = loadEntityRecords("distribution", "distribution-orders");
      const open = orders.filter(
        (o) => !statusMatches(o, /delivered|complete|completed|cancelled|canceled|void/i),
      );
      const picking = loadEntityRecords("distribution", "picking-lists").filter(
        (p) => !statusMatches(p, /complete|completed|cancelled|void/i),
      );
      const runs = loadEntityRecords("distribution", "delivery-runs").filter((r) =>
        inMonth(r, prefix),
      );
      const returns = loadEntityRecords("distribution", "distribution-returns").filter((r) =>
        inMonth(r, prefix),
      );
      return [
        kpi("Open orders", String(open.length), countHint(orders.length), open.length === 0, "fulfill"),
        kpi("Open picks", String(picking.length), countHint(picking.length), picking.length === 0, "warehouse"),
        kpi("Runs MTD", String(runs.length), countHint(runs.length), true, "this month"),
        kpi("Returns MTD", String(returns.length), countHint(returns.length), returns.length === 0, "this month"),
      ];
    }
    case "rnd": {
      const experiments = loadEntityRecords("rnd", "experiments");
      const active = experiments.filter((p) =>
        statusMatches(p, /active|running|open|pilot|in.?progress/i),
      );
      const pilots = loadEntityRecords("rnd", "pilot-batches").filter(
        (t) => !statusMatches(t, /complete|completed|cancelled|void/i),
      );
      const formulations = loadEntityRecords("rnd", "formulations");
      const panels = loadEntityRecords("rnd", "sensory-panels").filter((p) => inMonth(p, prefix));
      return [
        kpi("Active experiments", String(active.length), countHint(experiments.length), true, "R&D"),
        kpi("Open pilots", String(pilots.length), countHint(pilots.length), true, "in flight"),
        kpi("Formulations", String(formulations.length), countHint(formulations.length), true, "library"),
        kpi("Panels MTD", String(panels.length), countHint(panels.length), true, "sensory"),
      ];
    }
    case "benchmark": {
      const systems = loadEntityRecords("benchmark", "work-systems").filter(
        (s) => !statusMatches(s, /retired|inactive|void/i),
      );
      const studies = loadEntityRecords("benchmark", "benchmark-studies");
      const openStudies = studies.filter(
        (s) => !statusMatches(s, /closed|complete|completed|cancelled/i),
      );
      const actions = loadEntityRecords("benchmark", "improvement-actions").filter(
        (a) => !statusMatches(a, /closed|complete|completed|cancelled/i),
      );
      const kpis = loadEntityRecords("benchmark", "kpi-definitions").filter(
        (k) => !statusMatches(k, /retired|inactive|void/i),
      );
      return [
        kpi("Work systems", String(systems.length), countHint(systems.length), true, "active"),
        kpi("Open studies", String(openStudies.length), countHint(studies.length), true, "benchmark"),
        kpi("Open actions", String(actions.length), countHint(actions.length), actions.length === 0, "improve"),
        kpi("KPI defs", String(kpis.length), countHint(kpis.length), true, "tracked"),
      ];
    }
    case "reports": {
      const docs = getLiveDocuments();
      const live = summary();
      return [
        kpi("Documents", String(docs.length), countHint(docs.length), true, "sales + purchases"),
        kpi("Net profit", formatMoney(live.netProfit, true), live.year.toString(), live.netProfit >= 0, "YTD"),
        kpi("Receivable", live.formatted.ar, `${live.overdueCount} overdue`, live.overdueCount === 0, "AR"),
        kpi("Payable", live.formatted.ap, `${live.pendingCount} open`, true, "AP"),
      ];
    }
    default:
      return [];
  }
}

