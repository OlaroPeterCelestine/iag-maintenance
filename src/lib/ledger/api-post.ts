/**
 * Server-authoritative ledger posting + reports.
 *
 * Go builds and upserts journal lines via POST /api/ledger/post for every
 * accounting document entity. The browser only applies returned lines to
 * memory for UI — it must not invent the GL for these entities.
 */

import { apiFetch } from "@/lib/api-auth";
import { getMemoryLedgerLines, setMemoryLedgerLines } from "@/lib/db/client-store";
import { adoptLedgerLinesRevision } from "@/lib/db/sync";
import type { AccountBalance, LedgerLine } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { syncRecordToLedger } from "@/lib/ledger/sync-record";
import { awaitLedgerPostingDurable } from "@/lib/ledger/posting";

/** Must stay in sync with backend apiPostEntities. */
const API_POST_ENTITIES = new Set([
  "journal-entries",
  "recurring-journal-entries",
  "receipts",
  "payments",
  "inter-account-transfers",
  "sales-invoices",
  "invoices",
  "credit-notes",
  "purchase-invoices",
  "bills",
  "debit-notes",
  "withholding-tax",
  "withholding-tax-receipts",
  "expense-claims",
  "payslips",
  "statutory-remittances",
  "leave-requests",
  "depreciation-entries",
  "amortization-entries",
  "inventory-write-offs",
  "stock-in",
  "pos-stock-in",
  "inventory-sales",
  "pos-sales",
  "pos-returns",
  "fuel-logs",
  "maintenance-requests",
  "cash-sessions",
  "daily-closings",
  "project-expenses",
  "project-billings",
  "late-payment-fees",
  "leases",
  "revenue-contracts",
  "provisions",
  "share-based-payments",
  "fixed-assets",
  "intangible-assets",
  "investments",
  "capital-accounts",
  "capital-subaccounts",
  "matching-entries",
  "accruals-and-prepayments",
  "production-orders",
  "inventory-kits",
  "billable-time",
  "billable-expenses",
]);

export function isApiLedgerPostEntity(_module: string, entity: string): boolean {
  return API_POST_ENTITIES.has(entity);
}

export type ApiLedgerPostResult =
  | { ok: true; ledgerPosted: boolean; cleared?: boolean; lines: LedgerLine[] }
  | { ok: false; error: string };

function mapApiLines(
  raw: unknown[],
  fallback: { module: string; entity: string; recordId: string },
): LedgerLine[] {
  return raw
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      id: String(row.id || crypto.randomUUID()),
      accountId: String(row.accountId || ""),
      accountCode: String(row.accountCode || ""),
      accountName: String(row.accountName || ""),
      debit: Number(row.debit || 0),
      credit: Number(row.credit || 0),
      date: String(row.date || new Date().toISOString().slice(0, 10)),
      narration: String(row.narration || ""),
      sourceModule: String(row.sourceModule || fallback.module),
      sourceEntity: String(row.sourceEntity || fallback.entity),
      sourceRecordId: String(row.sourceRecordId || fallback.recordId),
      ...(row.division ? { division: String(row.division) } : {}),
      ...(row.project ? { project: String(row.project) } : {}),
      createdAt: String(row.createdAt || new Date().toISOString()),
    }));
}

function applyLinesToMemory(recordId: string, lines: LedgerLine[], revision?: string) {
  const keep = getMemoryLedgerLines().filter((line) => line.sourceRecordId !== recordId);
  setMemoryLedgerLines([...keep, ...lines]);
  if (revision) adoptLedgerLinesRevision(revision);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
  }
}

/** POST /api/ledger/post — Go builds + persists journals for one document. */
export async function postRecordToLedgerApi(
  module: string,
  entity: string,
  recordId: string,
): Promise<ApiLedgerPostResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: "Not in browser" };
  }
  if (!recordId.trim()) {
    return { ok: false, error: "Record id required" };
  }
  try {
    const res = await apiFetch("/api/ledger/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module,
        entity,
        recordId,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      code?: string;
      ledgerPosted?: boolean;
      cleared?: boolean;
      ledgerLines?: unknown[];
      ledgerRevision?: string;
    };
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        error: json.error || `Ledger post API error (HTTP ${res.status})`,
      };
    }
    const lines = mapApiLines(Array.isArray(json.ledgerLines) ? json.ledgerLines : [], {
      module,
      entity,
      recordId,
    });
    applyLinesToMemory(recordId, lines, json.ledgerRevision);
    return {
      ok: true,
      ledgerPosted: json.ledgerPosted === true,
      cleared: json.cleared === true,
      lines,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Ledger post API unavailable",
    };
  }
}

/**
 * Preferred posting entry: API for all ported entities; client engine only as
 * last-resort fallback (probe/validation IDs, or unknown entities).
 */
export async function postRecordToLedger(
  module: string,
  entity: string,
  record: ManagerRecord,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = (record.id || "").trim();
  if (isApiLedgerPostEntity(module, entity) && id && !id.startsWith("validate") && id !== "__validate_create__") {
    const api = await postRecordToLedgerApi(module, entity, id);
    if (api.ok) return { ok: true };
    // Hard failure — do not silently invent GL in the browser for ported entities.
    return { ok: false, error: api.error };
  }
  const sync = syncRecordToLedger(module, entity, record);
  if (!sync.ok) return sync;
  const durable = await awaitLedgerPostingDurable();
  if (!durable.ok) {
    return {
      ok: false,
      error: durable.error || "Could not save journal lines to the database.",
    };
  }
  return { ok: true };
}

/** Fire-and-forget API post when an async await is awkward (imports/resync). */
export function enqueueLedgerPost(module: string, entity: string, record: ManagerRecord) {
  void postRecordToLedger(module, entity, record);
}

export type ApiReportAccountRow = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  group: string;
  debit: number;
  credit: number;
  balance: number;
  openingBalance?: number;
};

async function fetchLedgerReport(
  path: string,
  params?: Record<string, string | undefined>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v) qs.set(k, v);
    }
    qs.set("_", String(Date.now()));
    const suffix = `?${qs}`;
    const res = await apiFetch(`/api/ledger/reports/${path}${suffix}`, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      data?: unknown;
    };
    if (!res.ok || json.ok === false) {
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Report API unavailable" };
  }
}

function asAccountRows(raw: unknown): AccountBalance[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as ApiReportAccountRow;
    return {
      accountId: String(r.accountId || ""),
      code: String(r.code || ""),
      name: String(r.name || ""),
      type: (r.type || "Asset") as AccountBalance["type"],
      group: String(r.group || ""),
      debit: Number(r.debit) || 0,
      credit: Number(r.credit) || 0,
      balance: Number(r.balance) || 0,
    };
  });
}

export async function fetchTrialBalanceFromApi(asOf?: string, division?: string) {
  const result = await fetchLedgerReport("trial-balance", { asOf, division });
  if (!result.ok) return result;
  const raw = result.data as {
    asOf?: string;
    rows?: unknown;
    data?: unknown;
    totalDebit?: number;
    totalCredit?: number;
    difference?: number;
    balanced?: boolean;
  };
  const totalDebit = Number(raw.totalDebit) || 0;
  const totalCredit = Number(raw.totalCredit) || 0;
  return {
    ok: true as const,
    data: {
      asOf: raw.asOf || asOf || "",
      rows: asAccountRows(raw.rows || raw.data),
      totalDebit,
      totalCredit,
      difference: Number(raw.difference) || totalDebit - totalCredit,
      balanced: Boolean(raw.balanced),
    },
  };
}

export async function fetchBalanceSheetFromApi(asOf?: string, division?: string) {
  const result = await fetchLedgerReport("balance-sheet", { asOf, division });
  if (!result.ok) return result;
  const raw = result.data as {
    asOf?: string;
    division?: string;
    assets?: unknown;
    liabilities?: unknown;
    equity?: unknown;
    totalAssets?: number;
    totalLiabilities?: number;
    totalEquity?: number;
    equityCapital?: number;
    financing?: number;
    netIncome?: number;
    netProfit?: number;
    difference?: number;
    balanced?: boolean;
  };
  const totalAssets = Number(raw.totalAssets) || 0;
  const totalLiabilities = Number(raw.totalLiabilities) || 0;
  const totalEquity = Number(raw.totalEquity) || 0;
  const netProfit = Number(raw.netProfit ?? raw.netIncome) || 0;
  const financing = Number(raw.financing) || totalLiabilities + totalEquity;
  const difference = Number(raw.difference) || totalAssets - financing;
  const balanced = Boolean(raw.balanced);
  return {
    ok: true as const,
    data: {
      asOf: raw.asOf || asOf || "",
      division: raw.division || division || "",
      assets: asAccountRows(raw.assets),
      liabilities: asAccountRows(raw.liabilities),
      equity: asAccountRows(raw.equity),
      netProfit,
      equityCapital: Number(raw.equityCapital) || totalEquity - netProfit,
      totalAssets,
      totalLiabilities,
      totalEquity,
      financing,
      difference,
      equationHolds: balanced,
      balanced,
      integrity: {
        ok: balanced,
        issues: balanced ? [] : ["Assets do not equal Liabilities + Equity"],
      },
    },
  };
}

export async function fetchProfitAndLossFromApi(
  from?: string,
  to?: string,
  division?: string,
) {
  const result = await fetchLedgerReport("profit-and-loss", { from, to, division });
  if (!result.ok) return result;
  const raw = result.data as {
    from?: string;
    to?: string;
    division?: string;
    earliestDate?: string;
    income?: unknown;
    expenses?: unknown;
    totalIncome?: number;
    totalExpenses?: number;
    netProfit?: number;
  };
  return {
    ok: true as const,
    data: {
      from: raw.from || from || "",
      to: raw.to || to || "",
      division: raw.division || division || "",
      earliestDate: raw.earliestDate || "",
      income: asAccountRows(raw.income),
      expenses: asAccountRows(raw.expenses),
      totalIncome: Number(raw.totalIncome) || 0,
      totalExpenses: Number(raw.totalExpenses) || 0,
      netProfit: Number(raw.netProfit) || 0,
    },
  };
}

export type ProfitAndLossByClassReport = {
  from: string;
  to: string;
  columns: string[];
  income: {
    accountId: string;
    code: string;
    name: string;
    type: string;
    byClass: Record<string, number>;
    total: number;
  }[];
  expenses: {
    accountId: string;
    code: string;
    name: string;
    type: string;
    byClass: Record<string, number>;
    total: number;
  }[];
  classTotals: Record<string, { income: number; expenses: number; net: number }>;
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
};

export async function fetchProfitAndLossByClassFromApi(from?: string, to?: string) {
  const result = await fetchLedgerReport("profit-and-loss-by-class", { from, to });
  if (!result.ok) return result;
  const raw = result.data as Partial<ProfitAndLossByClassReport>;
  return {
    ok: true as const,
    data: {
      from: raw.from || from || "",
      to: raw.to || to || "",
      columns: Array.isArray(raw.columns) ? raw.columns : [],
      income: Array.isArray(raw.income) ? raw.income : [],
      expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
      classTotals: raw.classTotals || {},
      totalIncome: Number(raw.totalIncome) || 0,
      totalExpenses: Number(raw.totalExpenses) || 0,
      netProfit: Number(raw.netProfit) || 0,
    } satisfies ProfitAndLossByClassReport,
  };
}
