import {
  ensureAccount,
  findAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import {
  loadLedgerLines,
  loadLedgerLinesForBasis,
  postBalancedEntry,
  removePostingsForSource,
  profitAndLoss,
} from "@/lib/ledger/posting";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { logHistory } from "@/lib/history";

export const YEAR_END_CLOSE_PREFIX = "__system-year-end-close__";

export function yearEndCloseSourceId(fiscalYearEnd: string) {
  return `${YEAR_END_CLOSE_PREFIX}${fiscalYearEnd}`;
}

/**
 * Inclusive start date of the fiscal year that ends on `fiscalYearEnd`.
 * Example: end 2025-06-30 → start 2024-07-01.
 */
export function fiscalYearStartFromEnd(fiscalYearEnd: string): string {
  const parts = fiscalYearEnd.split("-").map((p) => Number.parseInt(p, 10));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return `${fiscalYearEnd.slice(0, 4)}-01-01`;
  const end = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  start.setUTCDate(start.getUTCDate() + 1);
  return start.toISOString().slice(0, 10);
}

/**
 * Close Income and Expense into Retained Earnings for the fiscal year ending on
 * `fiscalYearEnd` (YYYY-MM-DD). Matching principle: period earnings become equity.
 */
export function closeFiscalYear(fiscalYearEnd: string): { ok: true; netProfit: number } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fiscalYearEnd)) {
    return { ok: false, error: "Fiscal year end must be a valid date (YYYY-MM-DD)." };
  }
  const from = fiscalYearStartFromEnd(fiscalYearEnd);
  const sourceId = yearEndCloseSourceId(fiscalYearEnd);
  removePostingsForSource(sourceId);

  const pl = profitAndLoss(from, fiscalYearEnd);
  const net = roundMoney(pl.netProfit);
  if (!pl.income.length && !pl.expenses.length) {
    return { ok: false, error: "No income or expense activity to close for this period." };
  }

  let accounts = loadChartOfAccounts();
  const re = ensureAccount(accounts, "Retained earnings", "Equity", "Equity", "3100");
  accounts = re.accounts;
  saveChartOfAccounts(accounts);

  const lines: {
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
  }[] = [];

  for (const row of pl.income) {
    if (!row.balance) continue;
    const account = findAccount(accounts, row.code) || findAccount(accounts, row.name);
    if (!account) continue;
    lines.push({
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      debit: row.balance,
      credit: 0,
    });
  }
  for (const row of pl.expenses) {
    if (!row.balance) continue;
    const account = findAccount(accounts, row.code) || findAccount(accounts, row.name);
    if (!account) continue;
    lines.push({
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      debit: 0,
      credit: row.balance,
    });
  }

  if (net >= 0) {
    lines.push({
      accountId: re.account.id,
      accountCode: re.account.code,
      accountName: re.account.name,
      debit: 0,
      credit: net,
    });
  } else {
    lines.push({
      accountId: re.account.id,
      accountCode: re.account.code,
      accountName: re.account.name,
      debit: Math.abs(net),
      credit: 0,
    });
  }

  const result = postBalancedEntry({
    date: fiscalYearEnd,
    narration: `Year-end close ${from} → ${fiscalYearEnd}`,
    sourceModule: "accounts",
    sourceEntity: "year-end-close",
    sourceRecordId: sourceId,
    lines,
    system: true,
  });
  if (!result.ok) return result;

  logHistory({
    action: "Year-end close",
    module: "Accounts",
    entity: "year-end-close",
    record: { reference: fiscalYearEnd, name: `Close ${fiscalYearEnd}` },
    details: `Closed P&L ${from} → ${fiscalYearEnd} into Retained earnings. Net profit (loss): ${net}`,
  });
  return { ok: true, netProfit: net };
}

export function listYearEndCloses() {
  return loadLedgerLines()
    .filter((l) => l.sourceEntity === "year-end-close")
    .reduce((ids, line) => {
      if (!ids.includes(line.sourceRecordId)) ids.push(line.sourceRecordId);
      return ids;
    }, [] as string[]);
}

/** Closed fiscal years: P&L after close date should exclude closed periods for BS earnings. */
export function latestClosedFiscalYearEnd(): string | null {
  const closes = listYearEndCloses()
    .map((id) => id.replace(YEAR_END_CLOSE_PREFIX, ""))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return closes.length ? closes[closes.length - 1]! : null;
}

/**
 * Accrual / prepaid matching entry.
 * Prepaid expense: Dr Prepaid / Cr Bank (or expense later via amortization).
 * Accrued expense: Dr Expense / Cr Accrued liabilities.
 * Deferred revenue: Dr Bank / Cr Deferred revenue.
 * Accrued revenue: Dr Accrued receivables / Cr Income.
 */
export function postMatchingEntry(input: {
  kind: "prepaid-expense" | "accrued-expense" | "deferred-revenue" | "accrued-revenue";
  date: string;
  amount: number;
  description: string;
  sourceRecordId: string;
  contraAccount?: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.amount));
  if (!amount) return { ok: false, error: "Amount is required." };
  let accounts = loadChartOfAccounts();
  const lines: {
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
  }[] = [];

  if (input.kind === "prepaid-expense") {
    const prepaid = ensureAccount(accounts, "Prepaid expenses", "Asset", "Current assets", "1410");
    accounts = prepaid.accounts;
    const bank = ensureAccount(
      accounts,
      input.contraAccount || "Cash at bank",
      "Asset",
      "Current assets",
      "1100",
    );
    accounts = bank.accounts;
    lines.push(
      {
        accountId: prepaid.account.id,
        accountCode: prepaid.account.code,
        accountName: prepaid.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: bank.account.id,
        accountCode: bank.account.code,
        accountName: bank.account.name,
        debit: 0,
        credit: amount,
      },
    );
  } else if (input.kind === "accrued-expense") {
    const exp = ensureAccount(
      accounts,
      input.contraAccount || "Operating expenses",
      "Expense",
      "Operating expenses",
      "5100",
    );
    accounts = exp.accounts;
    const accrued = ensureAccount(accounts, "Accrued liabilities", "Liability", "Current liabilities", "2400");
    accounts = accrued.accounts;
    lines.push(
      {
        accountId: exp.account.id,
        accountCode: exp.account.code,
        accountName: exp.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: accrued.account.id,
        accountCode: accrued.account.code,
        accountName: accrued.account.name,
        debit: 0,
        credit: amount,
      },
    );
  } else if (input.kind === "deferred-revenue") {
    const bank = ensureAccount(
      accounts,
      input.contraAccount || "Cash at bank",
      "Asset",
      "Current assets",
      "1100",
    );
    accounts = bank.accounts;
    const deferred = ensureAccount(accounts, "Deferred revenue", "Liability", "Current liabilities", "2500");
    accounts = deferred.accounts;
    lines.push(
      {
        accountId: bank.account.id,
        accountCode: bank.account.code,
        accountName: bank.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: deferred.account.id,
        accountCode: deferred.account.code,
        accountName: deferred.account.name,
        debit: 0,
        credit: amount,
      },
    );
  } else {
    const accrued = ensureAccount(accounts, "Accrued receivables", "Asset", "Current assets", "1210");
    accounts = accrued.accounts;
    const income = ensureAccount(
      accounts,
      input.contraAccount || "Other income",
      "Income",
      "Non-operating income",
      "4100",
    );
    accounts = income.accounts;
    lines.push(
      {
        accountId: accrued.account.id,
        accountCode: accrued.account.code,
        accountName: accrued.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: income.account.id,
        accountCode: income.account.code,
        accountName: income.account.name,
        debit: 0,
        credit: amount,
      },
    );
  }

  saveChartOfAccounts(accounts);
  const result = postBalancedEntry({
    date: input.date,
    narration: input.description || input.kind,
    sourceModule: "accounts",
    sourceEntity: "matching-entries",
    sourceRecordId: input.sourceRecordId,
    lines,
  });
  return result.ok ? { ok: true } : result;
}

export function statementOfChangesInEquity(from?: string | null, to?: string | null) {
  const accounts = loadChartOfAccounts().filter((a) => a.type === "Equity" && !a.inactive);
  const lines = loadLedgerLinesForBasis().filter((l) => {
    if (from && l.date < from) return false;
    if (to && l.date > to) return false;
    return true;
  });
  const rows = accounts.map((account) => {
    const matched = lines.filter((l) => l.accountId === account.id);
    const debit = roundMoney(matched.reduce((s, l) => s + parseAmount(l.debit), 0));
    const credit = roundMoney(matched.reduce((s, l) => s + parseAmount(l.credit), 0));
    const movement = roundMoney(credit - debit);
    return {
      code: account.code,
      name: account.name,
      opening: roundMoney(parseAmount(account.openingBalance)),
      movement,
      closing: roundMoney(parseAmount(account.openingBalance) + movement),
    };
  });
  const pl = profitAndLoss(from, to);
  const closed = latestClosedFiscalYearEnd();
  return {
    from: from ?? "",
    to: to ?? new Date().toISOString().slice(0, 10),
    rows,
    earningsNotYetClosed: closed && to && to <= closed ? 0 : pl.netProfit,
    totalClosing: roundMoney(
      rows.reduce((s, r) => s + r.closing, 0) +
        (closed && to && to <= closed ? 0 : pl.netProfit),
    ),
  };
}
