import {
  ACCOUNT_NAME_ALIASES,
  accountTypeFromCode,
  loadChartOfAccounts,
  repairLedgerAccount,
} from "@/lib/ledger/chart-of-accounts";
import {
  parseAmount,
  roundMoney,
  signedBalance,
  type AccountBalance,
  type AccountType,
  type LedgerAccount,
  type LedgerLine,
} from "@/lib/ledger/types";
import { loadManagerSettings } from "@/lib/manager-settings";
import { isDateLocked } from "@/lib/history";
import { assertPeriodOpen } from "@/lib/ledger/period-calendar";
import { assertPermission, currentUserCan } from "@/lib/access-control";
import { getMemoryLedgerLines, setMemoryLedgerLines } from "@/lib/db/client-store";
import {
  awaitLedgerLinesPersist,
  consumeLastLedgerPersistError,
  persistLedgerLinesToDb,
  adoptLedgerLinesRevision,
} from "@/lib/db/sync";
import { getServerBalanceCache } from "@/lib/ledger/balance-cache";
import { apiFetch } from "@/lib/api-auth";
import { notifyPersistFailure } from "@/lib/records-store";

/** Source entities that recognize income/expense on invoice date (accrual only). */
export const ACCRUAL_ONLY_ENTITIES = new Set([
  "sales-invoices",
  "invoices",
  "purchase-invoices",
  "bills",
  "credit-notes",
  "debit-notes",
  "late-payment-fees",
]);

export function loadLedgerLines(): LedgerLine[] {
  if (typeof window === "undefined") return [];
  return getMemoryLedgerLines();
}

/** Lines visible under the current accounting basis (cash excludes unpaid invoice postings). */
export function loadLedgerLinesForBasis(basis?: "accrual" | "cash"): LedgerLine[] {
  const lines = loadLedgerLines();
  const mode = basis ?? loadManagerSettings().accountingBasis;
  if (mode !== "cash") return lines;
  return lines.filter((l) => !ACCRUAL_ONLY_ENTITIES.has(l.sourceEntity));
}

/** Memory + durable Postgres write for journal lines. */
let ledgerBatchDepth = 0;
/** In-flight POST /api/ledger/journal from postBalancedEntry — awaited by awaitLedgerPostingDurable. */
let lastJournalPersist: Promise<boolean> | null = null;

/** Mute ledger-changed events and coalesce Postgres PUTs during bulk resync. */
export function beginLedgerBatch() {
  ledgerBatchDepth += 1;
}

export function endLedgerBatch(): Promise<boolean> {
  if (ledgerBatchDepth <= 0) return Promise.resolve(true);
  ledgerBatchDepth -= 1;
  if (ledgerBatchDepth > 0) return Promise.resolve(true);
  if (typeof window === "undefined") return Promise.resolve(false);
  window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
  return persistLedgerLinesToDb(getMemoryLedgerLines());
}

export function saveLedgerLines(
  lines: LedgerLine[],
  options?: {
    allowEmpty?: boolean;
    mode?: "sourceUpsert" | "replace";
    sourceRecordId?: string;
  },
): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  setMemoryLedgerLines(lines);
  if (ledgerBatchDepth > 0) return Promise.resolve(true);
  window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
  return persistLedgerLinesToDb(lines, options);
}

/**
 * Wait for the journal write triggered by postBalancedEntry / syncRecordToLedger
 * to reach Postgres, and report whether it actually landed.
 *
 * postBalancedEntry returns synchronously once the entry validates and balances —
 * that is NOT proof of durability. Any caller that tells the user something was
 * saved, or that moves a request to a settled state, must await this and treat a
 * false result as a failed operation.
 */
export async function awaitLedgerPostingDurable(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (typeof window === "undefined") return { ok: false, error: "Not in browser" };
  if (lastJournalPersist) {
    const ok = await lastJournalPersist.catch(() => false);
    lastJournalPersist = null;
    if (!ok) {
      const error = consumeLastLedgerPersistError();
      return { ok: false, error: error || "Journal post did not reach the server." };
    }
    return { ok: true };
  }
  await awaitLedgerLinesPersist();
  const error = consumeLastLedgerPersistError();
  if (error) return { ok: false, error };
  return { ok: true };
}

export function removePostingsForSource(sourceRecordId: string) {
  const current = loadLedgerLines();
  // Empty memory usually means hydrate has not finished — never persist [] and wipe Postgres.
  if (!current.length) return current;
  const next = current.filter((l) => l.sourceRecordId !== sourceRecordId);
  if (next.length === current.length) return current;
  void saveLedgerLines(next, {
    mode: "sourceUpsert",
    sourceRecordId,
  });
  return next;
}

export function postBalancedEntry(input: {
  date: string;
  narration: string;
  sourceModule: string;
  sourceEntity: string;
  sourceRecordId: string;
  lines: {
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    division?: string;
    project?: string;
    entityId?: string;
    location?: string;
  }[];
  division?: string;
  project?: string;
  entityId?: string;
  location?: string;
  /**
   * System journals (opening balances, year-end close) bypass lock date and
   * period soft-close so the accounting equation can still be maintained.
   */
  system?: boolean;
}): { ok: true; lines: LedgerLine[] } | { ok: false; error: string } {
  const date = input.date || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00`))) {
    return { ok: false, error: "A valid transaction date is required." };
  }
  if (!input.system) {
    if (isDateLocked(date)) {
      return {
        ok: false,
        error:
          "This date is on or before the lock date. Enable Allow backdating or unlock in Settings → Lock Date.",
      };
    }
    const periodBlock = assertPeriodOpen(date);
    if (periodBlock) {
      if (/hard-closed/i.test(periodBlock)) return { ok: false, error: periodBlock };
      // Soft-closed: only users who can close periods (Administrators) may post.
      const softBlock = assertPermission("close-period");
      if (softBlock) return { ok: false, error: periodBlock };
    }
  }
  if (typeof window !== "undefined" && !input.system) {
    const postBlock = assertPermission("post");
    // Approvers (and void-capable roles) may still sync when finalizing status changes.
    if (postBlock && !currentUserCan("approve") && !currentUserCan("void")) {
      return { ok: false, error: postBlock };
    }
  }

  const prepared = input.lines
    .map((l) => ({
      ...l,
      debit: roundMoney(Math.max(0, l.debit)),
      credit: roundMoney(Math.max(0, l.credit)),
    }))
    .filter((l) => l.debit > 0 || l.credit > 0);

  if (prepared.length < 2) {
    return { ok: false, error: "A journal entry needs at least two posting lines." };
  }
  if (prepared.some((line) => !line.accountId || !line.accountCode || !line.accountName)) {
    return { ok: false, error: "Every posting line must use a valid chart-of-accounts account." };
  }
  if (prepared.some((line) => line.debit > 0 && line.credit > 0)) {
    return { ok: false, error: "A posting line cannot contain both a debit and a credit." };
  }

  const totalDebit = roundMoney(prepared.reduce((s, l) => s + l.debit, 0));
  const totalCredit = roundMoney(prepared.reduce((s, l) => s + l.credit, 0));
  if (totalDebit !== totalCredit) {
    return {
      ok: false,
      error: `Entry is out of balance. Debits ${totalDebit} ≠ Credits ${totalCredit}.`,
    };
  }

  const now = new Date().toISOString();
  const stamped: LedgerLine[] = prepared.map((l) => ({
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    accountId: l.accountId,
    accountCode: l.accountCode,
    accountName: l.accountName,
    debit: l.debit,
    credit: l.credit,
    date,
    narration: input.narration,
    sourceModule: input.sourceModule,
    sourceEntity: input.sourceEntity,
    sourceRecordId: input.sourceRecordId,
    createdAt: now,
    division: l.division || input.division,
    project: l.project || input.project,
    entityId: l.entityId || input.entityId,
    location: l.location || input.location,
  }));

  const without = loadLedgerLines().filter((l) => l.sourceRecordId !== input.sourceRecordId);
  setMemoryLedgerLines([...stamped, ...without]);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
  }

  // Durable write on Go only — never invent journals via PUT /ledger/lines from specialty helpers.
  lastJournalPersist = (async () => {
    try {
      const res = await apiFetch("/api/ledger/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          narration: input.narration,
          sourceModule: input.sourceModule,
          sourceEntity: input.sourceEntity,
          sourceRecordId: input.sourceRecordId,
          system: Boolean(input.system),
          division: input.division || "",
          project: input.project || "",
          lines: prepared.map((l) => ({
            accountId: l.accountId,
            accountCode: l.accountCode,
            accountName: l.accountName,
            debit: l.debit,
            credit: l.credit,
            division: l.division || input.division || "",
            project: l.project || input.project || "",
          })),
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        lines?: LedgerLine[];
        revision?: string;
      } | null;
      if (!res.ok || !body?.ok) {
        notifyPersistFailure(
          `${input.sourceModule}/${input.sourceEntity}`,
          body?.error || `Journal post failed (HTTP ${res.status})`,
        );
        return false;
      }
      if (body.revision) adoptLedgerLinesRevision(body.revision);
      if (Array.isArray(body.lines) && body.lines.length) {
        const mapped = body.lines.map((l) => ({
          ...l,
          id: String(l.id || ""),
          accountId: String(l.accountId || ""),
          accountCode: String(l.accountCode || ""),
          accountName: String(l.accountName || ""),
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          date: String(l.date || date),
          narration: String(l.narration || input.narration),
          sourceModule: String(l.sourceModule || input.sourceModule),
          sourceEntity: String(l.sourceEntity || input.sourceEntity),
          sourceRecordId: String(l.sourceRecordId || input.sourceRecordId),
          createdAt: String(l.createdAt || now),
        }));
        const keep = getMemoryLedgerLines().filter(
          (line) => line.sourceRecordId !== input.sourceRecordId,
        );
        setMemoryLedgerLines([...keep, ...mapped]);
        window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
      }
      return true;
    } catch (err) {
      notifyPersistFailure(
        `${input.sourceModule}/${input.sourceEntity}`,
        err instanceof Error ? err.message : "Journal post failed",
      );
      return false;
    }
  })();

  return { ok: true, lines: stamped };
}

export function lineMatchesAccount(
  line: { accountId?: string; accountCode?: string; accountName?: string },
  account: { id: string; code: string; name: string },
): boolean {
  if (line.accountId && line.accountId === account.id) return true;
  const code = (line.accountCode || "").trim().toLowerCase();
  if (code && code === (account.code || "").trim().toLowerCase()) return true;
  const name = (line.accountName || "").trim().toLowerCase();
  if (name && name === (account.name || "").trim().toLowerCase()) return true;
  return false;
}

export function buildAccountLookup(accounts: LedgerAccount[]) {
  const byId = new Map<string, LedgerAccount>();
  const byCode = new Map<string, LedgerAccount>();
  const byName = new Map<string, LedgerAccount>();
  for (const account of accounts) {
    byId.set(account.id, account);
    const code = (account.code || "").trim().toLowerCase();
    if (code && !byCode.has(code)) byCode.set(code, account);
    const name = (account.name || "").trim().toLowerCase();
    if (name && !byName.has(name)) byName.set(name, account);
  }
  return { byId, byCode, byName };
}

export function resolveLineAccount(
  lookup: ReturnType<typeof buildAccountLookup>,
  line: { accountId?: string; accountCode?: string; accountName?: string },
): LedgerAccount | undefined {
  if (line.accountId) {
    const byId = lookup.byId.get(line.accountId);
    if (byId) return byId;
  }
  const code = (line.accountCode || "").trim().toLowerCase();
  if (code) {
    const byCode = lookup.byCode.get(code);
    if (byCode) return byCode;
  }
  const name = (line.accountName || "").trim().toLowerCase();
  if (name) {
    const byName = lookup.byName.get(name);
    if (byName) return byName;
    const aliased = ACCOUNT_NAME_ALIASES[name];
    if (aliased) return lookup.byName.get(aliased.toLowerCase());
  }
  return undefined;
}

export function computeAccountBalances(
  asOf?: string | null,
  options?: { division?: string | null },
): AccountBalance[] {
  const accounts = loadChartOfAccounts().filter((a) => !a.inactive).map(repairLedgerAccount);
  const divisionFilter = (options?.division || "").trim();
  const lines = loadLedgerLines();

  // While journal hydrate is still in flight, paint from SQL aggregates of
  // ledger_lines (same posted log — not invented browser balances).
  if (!lines.length) {
    const cached = getServerBalanceCache(asOf, divisionFilter);
    if (cached?.length) return cached;
  }

  // Single pass over lines — O(lines + accounts), not O(accounts × lines).
  // Resolve by id, then code, then name so stale accountIds still roll up.
  const lookup = buildAccountLookup(accounts);
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    if (asOf && l.date > asOf) continue;
    if (divisionFilter) {
      const div = (l.division || "").trim();
      if (divisionFilter === "__unassigned__") {
        if (div) continue;
      } else if (div.toLowerCase() !== divisionFilter.toLowerCase()) {
        continue;
      }
    }
    const account = resolveLineAccount(lookup, l);
    if (!account) continue;
    const cur = totals.get(account.id) || { debit: 0, credit: 0 };
    cur.debit += parseAmount(l.debit);
    cur.credit += parseAmount(l.credit);
    totals.set(account.id, cur);
  }

  // Opening balances are posted as a balanced system journal (see opening-balances.ts).
  // Do not apply account.openingBalance unilaterally — that breaks Assets = L + E.
  return accounts
    .map((account) => {
      const matched = totals.get(account.id) || { debit: 0, credit: 0 };
      const debit = matched.debit;
      const credit = matched.credit;
      const balance = signedBalance(account.type, debit, credit);

      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        group: account.group,
        debit: roundMoney(debit),
        credit: roundMoney(credit),
        balance: roundMoney(balance),
      };
    })
    .filter((b) => b.debit !== 0 || b.credit !== 0 || b.balance !== 0);
}

export function auditLedgerIntegrity(asOf?: string | null) {
  const accounts = loadChartOfAccounts();
  const accountIds = new Set(accounts.map((account) => account.id));
  // Integrity must inspect every posted line, including accrual-only entities.
  const lines = loadLedgerLines().filter((line) => !asOf || line.date <= asOf);
  const issues: string[] = [];
  const ids = new Set<string>();
  const entries = new Map<string, { debit: number; credit: number }>();

  for (const line of lines) {
    if (ids.has(line.id)) issues.push(`Duplicate ledger line ID ${line.id}.`);
    ids.add(line.id);
    if (!accountIds.has(line.accountId)) {
      issues.push(`Posting references missing account ${line.accountName || line.accountCode}.`);
    }
    if (line.debit < 0 || line.credit < 0 || (line.debit > 0 && line.credit > 0)) {
      issues.push(`Invalid debit/credit values on ${line.narration || line.id}.`);
    }
    const entry = entries.get(line.sourceRecordId) || { debit: 0, credit: 0 };
    entry.debit += line.debit;
    entry.credit += line.credit;
    entries.set(line.sourceRecordId, entry);
  }

  for (const [sourceId, entry] of entries) {
    if (roundMoney(entry.debit) !== roundMoney(entry.credit)) {
      issues.push(`Source ${sourceId} is out of balance.`);
    }
  }

  return { ok: issues.length === 0, issues };
}

export function trialBalance(asOf?: string | null) {
  const rows = computeAccountBalances(asOf);
  const totalDebit = roundMoney(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = roundMoney(rows.reduce((s, r) => s + r.credit, 0));
  const difference = roundMoney(totalDebit - totalCredit);
  // Skip the expensive full-ledger integrity walk when totals already balance.
  const integrity =
    difference === 0
      ? { ok: true, issues: [] as string[] }
      : auditLedgerIntegrity(asOf);
  return {
    asOf: asOf ?? new Date().toISOString().slice(0, 10),
    rows: rows.sort((a, b) => a.code.localeCompare(b.code)),
    totalDebit,
    totalCredit,
    difference,
    balanced: difference === 0 && integrity.ok,
    integrity,
  };
}

/**
 * Balance sheet per the accounting equation (IAS 1):
 *   Assets = Liabilities + Equity
 * where Equity includes equity accounts + earnings to date (Income − Expenses).
 *
 * Class/division filters affect displayed rows only. The equation status always
 * uses the full unfiltered books — a class slice is not expected to self-balance.
 */
export function balanceSheet(asOf?: string | null, options?: { division?: string | null }) {
  const asOfDate = asOf ?? new Date().toISOString().slice(0, 10);
  const divisionFilter = (options?.division || "").trim();
  const fullRows = computeAccountBalances(asOfDate);
  const rows = divisionFilter ? computeAccountBalances(asOfDate, options) : fullRows;

  const split = (source: AccountBalance[]) => ({
    assets: source.filter((r) => r.type === "Asset"),
    liabilities: source.filter((r) => r.type === "Liability"),
    equityAccounts: source.filter((r) => r.type === "Equity"),
    income: source.filter((r) => r.type === "Income"),
    expenses: source.filter((r) => r.type === "Expense"),
  });

  const display = split(rows);
  const full = split(fullRows);

  const totalsFrom = (parts: ReturnType<typeof split>) => {
    const totalIncome = roundMoney(parts.income.reduce((s, r) => s + r.balance, 0));
    const totalExpenses = roundMoney(parts.expenses.reduce((s, r) => s + r.balance, 0));
    const netProfit = roundMoney(totalIncome - totalExpenses);
    const totalAssets = roundMoney(parts.assets.reduce((s, r) => s + r.balance, 0));
    const totalLiabilities = roundMoney(parts.liabilities.reduce((s, r) => s + r.balance, 0));
    const equityCapital = roundMoney(parts.equityAccounts.reduce((s, r) => s + r.balance, 0));
    const totalEquity = roundMoney(equityCapital + netProfit);
    const financing = roundMoney(totalLiabilities + totalEquity);
    const difference = roundMoney(totalAssets - financing);
    return {
      netProfit,
      totalAssets,
      totalLiabilities,
      equityCapital,
      totalEquity,
      financing,
      difference,
    };
  };

  const displayed = totalsFrom(display);
  const books = totalsFrom(full);
  const equationHolds = books.difference === 0;
  const integrity =
    equationHolds
      ? { ok: true, issues: [] as string[] }
      : auditLedgerIntegrity(asOfDate);

  return {
    asOf: asOfDate,
    division: divisionFilter,
    assets: display.assets,
    liabilities: display.liabilities,
    equity: display.equityAccounts,
    // Display totals follow the (optional) class filter.
    netProfit: displayed.netProfit,
    equityCapital: displayed.equityCapital,
    totalAssets: displayed.totalAssets,
    totalLiabilities: displayed.totalLiabilities,
    totalEquity: displayed.totalEquity,
    financing: displayed.financing,
    // Equation status always reflects the full books.
    difference: books.difference,
    equationHolds,
    /** True when full-book Assets = Liabilities + Equity and the ledger is intact. */
    balanced: equationHolds && integrity.ok,
    integrity,
    equation: {
      left: books.totalAssets,
      right: books.financing,
      label: "Assets = Liabilities + Equity",
    },
  };
}

/**
 * Default P&L "From" date. Uses current calendar year Jan 1, but if the ledger
 * has activity in an earlier year (sample/demo books, prior FY), opens From at
 * that year's Jan 1 so the report is not empty by default.
 */
export function defaultProfitAndLossFrom(to?: string | null): string {
  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;
  void to;
  try {
    const lines = loadLedgerLines().filter(
      (l) => l.sourceEntity !== "year-end-close" && /^\d{4}-\d{2}-\d{2}$/.test(l.date || ""),
    );
    if (!lines.length) return yearStart;
    const dates = lines.map((l) => l.date).sort();
    const earliest = dates[0]!;
    const earliestYear = Number(earliest.slice(0, 4));
    if (earliestYear < year) return `${earliestYear}-01-01`;
    return yearStart;
  } catch {
    return yearStart;
  }
}

/** Earliest non-close ledger date, if any (YYYY-MM-DD). */
export function earliestLedgerActivityDate(): string | null {
  try {
    const dates = loadLedgerLines()
      .filter((l) => l.sourceEntity !== "year-end-close" && /^\d{4}-\d{2}-\d{2}$/.test(l.date || ""))
      .map((l) => l.date)
      .sort();
    return dates[0] ?? null;
  } catch {
    return null;
  }
}

function inferPlType(line: {
  accountCode?: string;
  accountName?: string;
}): AccountType | undefined {
  const fromCode = accountTypeFromCode(line.accountCode);
  if (fromCode === "Income" || fromCode === "Expense") return fromCode;
  if (/sales?|income|revenue|turnover/i.test(line.accountName || "")) return "Income";
  if (/expense|cogs|cost of/i.test(line.accountName || "")) return "Expense";
  return undefined;
}

/** Pure P&L from in-memory books — used by the report and unit tests. */
export function profitAndLossFromBooks(
  accounts: LedgerAccount[],
  allLines: LedgerLine[],
  from?: string | null,
  to?: string | null,
  options?: { division?: string | null },
) {
  const repaired = accounts.filter((a) => !a.inactive).map(repairLedgerAccount);
  const divisionFilter = (options?.division || "").trim();
  const lines = allLines.filter((l) => {
    if (l.sourceEntity === "year-end-close") return false;
    if (from && l.date < from) return false;
    if (to && l.date > to) return false;
    if (!divisionFilter) return true;
    if (divisionFilter === "__unassigned__") return !(l.division || "").trim();
    return (l.division || "").trim().toLowerCase() === divisionFilter.toLowerCase();
  });

  const lookup = buildAccountLookup(repaired);
  const totals = new Map<string, { account: LedgerAccount; debit: number; credit: number }>();
  const unmatched: LedgerLine[] = [];

  for (const line of lines) {
    const account = resolveLineAccount(lookup, line);
    if (!account) {
      unmatched.push(line);
      continue;
    }
    const cur = totals.get(account.id) || { account, debit: 0, credit: 0 };
    cur.debit += parseAmount(line.debit);
    cur.credit += parseAmount(line.credit);
    totals.set(account.id, cur);
  }

  // Posted 4xxx / named sales lines still appear even if the CoA row is missing.
  for (const line of unmatched) {
    const type = inferPlType(line);
    if (type !== "Income" && type !== "Expense") continue;
    const code = (line.accountCode || "").trim() || "4000";
    const name = (line.accountName || "").trim() || "Coffee Sales";
    const key = `orphan-${code.toLowerCase()}-${name.toLowerCase()}`;
    const existing = totals.get(key);
    if (existing) {
      existing.debit += parseAmount(line.debit);
      existing.credit += parseAmount(line.credit);
      continue;
    }
    totals.set(key, {
      account: {
        id: key,
        code,
        name,
        type,
        group: type,
        openingBalance: 0,
        currency: "UGX",
        inactive: false,
      },
      debit: parseAmount(line.debit),
      credit: parseAmount(line.credit),
    });
  }

  const rows = [...totals.values()]
    .filter((entry) => entry.account.type === "Income" || entry.account.type === "Expense")
    .map((entry) => {
      const balance = signedBalance(entry.account.type, entry.debit, entry.credit);
      return {
        accountId: entry.account.id,
        code: entry.account.code,
        name: entry.account.name,
        type: entry.account.type,
        group: entry.account.group,
        debit: roundMoney(entry.debit),
        credit: roundMoney(entry.credit),
        balance: roundMoney(balance),
      };
    })
    .filter((r) => r.balance !== 0);

  const income = rows.filter((r) => r.type === "Income");
  const expenses = rows.filter((r) => r.type === "Expense");
  const totalIncome = roundMoney(income.reduce((s, r) => s + r.balance, 0));
  const totalExpenses = roundMoney(expenses.reduce((s, r) => s + r.balance, 0));
  return {
    from: from ?? "",
    to: to ?? new Date().toISOString().slice(0, 10),
    division: options?.division || "",
    income,
    expenses,
    totalIncome,
    totalExpenses,
    netProfit: roundMoney(totalIncome - totalExpenses),
  };
}

export function profitAndLoss(
  from?: string | null,
  to?: string | null,
  options?: { division?: string | null },
) {
  return profitAndLossFromBooks(
    loadChartOfAccounts(),
    loadLedgerLinesForBasis(),
    from,
    to,
    options,
  );
}

/** P&L columns by class/division for the period. */
export function profitAndLossByDivision(from?: string | null, to?: string | null) {
  const lines = loadLedgerLinesForBasis().filter((l) => {
    if (l.sourceEntity === "year-end-close") return false;
    if (from && l.date < from) return false;
    if (to && l.date > to) return false;
    return true;
  });
  const accounts = loadChartOfAccounts()
    .filter((a) => !a.inactive)
    .map(repairLedgerAccount)
    .filter((a) => a.type === "Income" || a.type === "Expense");
  const lookup = buildAccountLookup(accounts);
  const classNames = new Set<string>();
  for (const line of lines) {
    const name = (line.division || "").trim() || "Unassigned";
    classNames.add(name);
  }
  const columns = [...classNames].sort((a, b) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });

  type Row = {
    accountId: string;
    code: string;
    name: string;
    type: string;
    byClass: Record<string, number>;
    total: number;
  };
  const rowMap = new Map<string, Row>();

  for (const line of lines) {
    const account = resolveLineAccount(lookup, line);
    if (!account) continue;
    const className = (line.division || "").trim() || "Unassigned";
    const signed = signedBalance(account.type, line.debit, line.credit);
    if (!signed) continue;
    let row = rowMap.get(account.id);
    if (!row) {
      row = {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        byClass: {},
        total: 0,
      };
      rowMap.set(account.id, row);
    }
    row.byClass[className] = roundMoney((row.byClass[className] || 0) + signed);
    row.total = roundMoney(row.total + signed);
  }

  const rows = [...rowMap.values()].sort((a, b) => a.code.localeCompare(b.code));
  const income = rows.filter((r) => r.type === "Income");
  const expenses = rows.filter((r) => r.type === "Expense");
  const classTotals: Record<string, { income: number; expenses: number; net: number }> = {};
  for (const col of columns) {
    const inc = roundMoney(income.reduce((s, r) => s + (r.byClass[col] || 0), 0));
    const exp = roundMoney(expenses.reduce((s, r) => s + (r.byClass[col] || 0), 0));
    classTotals[col] = { income: inc, expenses: exp, net: roundMoney(inc - exp) };
  }
  return {
    from: from ?? "",
    to: to ?? new Date().toISOString().slice(0, 10),
    columns,
    income,
    expenses,
    classTotals,
    totalIncome: roundMoney(income.reduce((s, r) => s + r.total, 0)),
    totalExpenses: roundMoney(expenses.reduce((s, r) => s + r.total, 0)),
    netProfit: roundMoney(
      income.reduce((s, r) => s + r.total, 0) - expenses.reduce((s, r) => s + r.total, 0),
    ),
  };
}

/** Income/expense postings missing a class — matching QuickBooks Division Exception. */
export function divisionExceptionLines(from?: string | null, to?: string | null) {
  const lookup = buildAccountLookup(loadChartOfAccounts().map(repairLedgerAccount));
  return loadLedgerLinesForBasis()
    .filter((l) => {
      if (from && l.date < from) return false;
      if (to && l.date > to) return false;
      if ((l.division || "").trim()) return false;
      const account = resolveLineAccount(lookup, l);
      return account?.type === "Income" || account?.type === "Expense";
    })
    .map((l) => ({
      id: l.id,
      date: l.date,
      account: l.accountName,
      narration: l.narration,
      debit: l.debit,
      credit: l.credit,
      sourceModule: l.sourceModule,
      sourceEntity: l.sourceEntity,
      sourceRecordId: l.sourceRecordId,
    }));
}

export function taxSummary(from?: string | null, to?: string | null) {
  const lines = loadLedgerLinesForBasis().filter((line) => {
    if (from && line.date < from) return false;
    if (to && line.date > to) return false;
    return /tax|vat|gst/i.test(`${line.accountName} ${line.accountCode}`);
  });
  // The account name/code test above is deliberately loose (`tax|vat|gst`), so
  // these entity allow-lists are what actually keep non-VAT tax accounts
  // (PAYE, NSSF, WHT, income tax, deferred tax) out of the VAT position —
  // those post from payslips / withholding-tax / journals, none of which are
  // listed here. Anything added below must be a genuine VAT-bearing document.
  const salesEntities = new Set([
    "sales-invoices",
    "invoices",
    "credit-notes",
    "late-payment-fees",
    "receipts",
    // POS splits inclusive VAT out on every sale and credits the same VAT
    // control account, so omitting it understated output tax for any
    // retail/POS business.
    "pos-sales",
  ]);
  const purchaseEntities = new Set(["purchase-invoices", "bills", "debit-notes", "payments"]);
  const outputTax = roundMoney(
    lines
      .filter((line) => salesEntities.has(line.sourceEntity))
      .reduce((sum, line) => sum + line.credit - line.debit, 0),
  );
  const inputTax = roundMoney(
    lines
      .filter((line) => purchaseEntities.has(line.sourceEntity))
      .reduce((sum, line) => sum + line.debit - line.credit, 0),
  );
  return {
    from: from ?? "",
    to: to ?? new Date().toISOString().slice(0, 10),
    outputTax,
    inputTax,
    netTaxPayable: roundMoney(outputTax - inputTax),
    lines,
  };
}

export function cashFlowStatement(from?: string | null, to?: string | null) {
  const accounts = loadChartOfAccounts();
  const cashAccountIds = new Set(
    accounts
      .filter(
        (account) =>
          account.type === "Asset" &&
          /cash|bank|petty|wallet|mobile money/i.test(`${account.name} ${account.group}`),
      )
      .map((account) => account.id),
  );
  const lines = loadLedgerLinesForBasis().filter((line) => {
    if (from && line.date < from) return false;
    if (to && line.date > to) return false;
    return line.sourceEntity !== "opening-balances";
  });
  const entries = new Map<string, LedgerLine[]>();
  for (const line of lines) {
    const group = entries.get(line.sourceRecordId) || [];
    group.push(line);
    entries.set(line.sourceRecordId, group);
  }

  const sections = {
    operating: 0,
    investing: 0,
    financing: 0,
  };
  for (const entry of entries.values()) {
    const cashChange = roundMoney(
      entry
        .filter((line) => cashAccountIds.has(line.accountId))
        .reduce((sum, line) => sum + line.debit - line.credit, 0),
    );
    if (!cashChange) continue;
    const source = `${entry[0]?.sourceModule || ""} ${entry[0]?.sourceEntity || ""}`;
    const counterpart = entry
      .filter((line) => !cashAccountIds.has(line.accountId))
      .map((line) => line.accountName)
      .join(" ");
    if (/asset|investment|fixed|intangible|property|equipment|disposal|depreciation/i.test(`${source} ${counterpart}`)) {
      sections.investing = roundMoney(sections.investing + cashChange);
    } else if (
      /capital|equity|loan|borrow|dividend|owner|retained|drawing|financing|year-end/i.test(
        `${source} ${counterpart}`,
      )
    ) {
      sections.financing = roundMoney(sections.financing + cashChange);
    } else if (/tax payable|paye|nssf|wages payable|payroll|payslip/i.test(`${source} ${counterpart}`)) {
      sections.operating = roundMoney(sections.operating + cashChange);
    } else {
      sections.operating = roundMoney(sections.operating + cashChange);
    }
  }

  return {
    from: from ?? "",
    to: to ?? new Date().toISOString().slice(0, 10),
    ...sections,
    netChange: roundMoney(sections.operating + sections.investing + sections.financing),
  };
}

export function ledgerForAccount(accountIdOrCode: string, asOf?: string | null) {
  const accounts = loadChartOfAccounts();
  const q = accountIdOrCode.trim().toLowerCase();
  const account =
    accounts.find(
      (a) =>
        a.id === accountIdOrCode ||
        a.code === accountIdOrCode ||
        a.name.trim().toLowerCase() === q ||
        a.code.toLowerCase() === q,
    ) ?? null;
  if (!account) return { account: null, lines: [] as LedgerLine[] };
  const lines = loadLedgerLinesForBasis()
    .filter((l) => lineMatchesAccount(l, account) && (!asOf || l.date <= asOf))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  return { account, lines };
}
