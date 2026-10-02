import { buildAgedReport } from "@/lib/ar-ap";
import { addMonths, shiftPeriod } from "@/lib/ledger/comparative";
import { loadChartOfAccounts } from "@/lib/ledger/chart-of-accounts";
import {
  balanceSheet,
  cashFlowStatement,
  loadLedgerLinesForBasis,
  profitAndLoss,
} from "@/lib/ledger/posting";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { loadList, saveList } from "@/lib/manager-settings";

export const BUDGETS_KEY = "financeiag-budgets";
export const FORECASTS_KEY = "financeiag-forecasts";
export const NOTES_KEY = "financeiag-financial-notes";

export type BudgetLine = {
  id: string;
  accountCode: string;
  accountName: string;
  period: string;
  amount: string;
};

export type ForecastAssumption = {
  id: string;
  name: string;
  growthPercent: string;
};

export type FinancialNote = {
  id: string;
  number: string;
  title: string;
  body: string;
  asOf: string;
};

export function loadBudgets(): BudgetLine[] {
  return loadList(BUDGETS_KEY, [] as BudgetLine[]);
}

export function loadForecasts(): ForecastAssumption[] {
  return loadList(FORECASTS_KEY, [
    { id: "1", name: "Revenue growth", growthPercent: "5" },
    { id: "2", name: "Expense growth", growthPercent: "3" },
  ] as ForecastAssumption[]);
}

export function saveForecasts(rows: ForecastAssumption[]) {
  saveList(FORECASTS_KEY, rows);
}

export function loadFinancialNotes(): FinancialNote[] {
  return loadList(NOTES_KEY, [
    {
      id: "1",
      number: "1",
      title: "Basis of preparation",
      body: "These financial statements are prepared on the accrual basis under IFRS-aligned policies.",
      asOf: new Date().toISOString().slice(0, 10),
    },
    {
      id: "2",
      number: "2",
      title: "Going concern",
      body: "Management considers the going concern basis appropriate for at least twelve months from the reporting date.",
      asOf: new Date().toISOString().slice(0, 10),
    },
  ] as FinancialNote[]);
}

export function budgetVsActual(periodFrom: string, periodTo: string) {
  const budgets = loadBudgets();
  const pl = profitAndLoss(periodFrom, periodTo);
  const actualByCode = new Map<string, number>();
  for (const row of [...pl.income, ...pl.expenses]) {
    actualByCode.set(row.code, row.balance);
  }
  const rows = budgets.map((b) => {
    const budget = parseAmount(b.amount);
    const actual = actualByCode.get(b.accountCode) || 0;
    const variance = roundMoney(actual - budget);
    return {
      code: b.accountCode,
      name: b.accountName,
      budget,
      actual,
      variance,
      variancePercent: budget ? roundMoney((variance / budget) * 100, 1) : 0,
    };
  });
  return {
    from: periodFrom,
    to: periodTo,
    rows,
    totalBudget: roundMoney(rows.reduce((s, r) => s + r.budget, 0)),
    totalActual: roundMoney(rows.reduce((s, r) => s + r.actual, 0)),
  };
}

export function forecastAssumptions(overrides?: {
  revenueGrowth?: number;
  expenseGrowth?: number;
}) {
  const assumptions = loadForecasts();
  const revGrowth =
    overrides?.revenueGrowth ??
    (parseAmount(assumptions.find((a) => /revenue|sales|income/i.test(a.name))?.growthPercent) || 5);
  const expGrowth =
    overrides?.expenseGrowth ??
    (parseAmount(assumptions.find((a) => /expense|cost/i.test(a.name))?.growthPercent) || 3);
  return { revenueGrowth: revGrowth, expenseGrowth: expGrowth };
}

export function forecastProfitAndLoss(
  from: string,
  to: string,
  overrides?: { revenueGrowth?: number; expenseGrowth?: number },
) {
  const pl = profitAndLoss(from, to);
  const { revenueGrowth: revGrowth, expenseGrowth: expGrowth } = forecastAssumptions(overrides);
  const forecastIncome = roundMoney(pl.totalIncome * (1 + revGrowth / 100));
  const forecastExpenses = roundMoney(pl.totalExpenses * (1 + expGrowth / 100));
  return {
    baseFrom: from,
    baseTo: to,
    revenueGrowth: revGrowth,
    expenseGrowth: expGrowth,
    baseIncome: pl.totalIncome,
    baseExpenses: pl.totalExpenses,
    baseNetProfit: pl.netProfit,
    forecastIncome,
    forecastExpenses,
    forecastNetProfit: roundMoney(forecastIncome - forecastExpenses),
  };
}

export type ForecastMonth = {
  key: string;
  label: string;
  from: string;
  to: string;
  income: number;
  expenses: number;
  netProfit: number;
  isProjected: boolean;
};

/**
 * Builds a month-by-month P&L series: trailing actual months in the base range,
 * then projected months using compound monthly growth from the last actual month.
 */
export function forecastSeries(
  from: string,
  to: string,
  horizonMonths = 6,
  overrides?: { revenueGrowth?: number; expenseGrowth?: number },
): {
  months: ForecastMonth[];
  revenueGrowth: number;
  expenseGrowth: number;
  actualIncome: number;
  actualExpenses: number;
  actualNetProfit: number;
  forecastIncome: number;
  forecastExpenses: number;
  forecastNetProfit: number;
} {
  const { revenueGrowth, expenseGrowth } = forecastAssumptions(overrides);
  const monthlyRevRate = revenueGrowth / 100 / 12;
  const monthlyExpRate = expenseGrowth / 100 / 12;

  const actualMonths: ForecastMonth[] = [];
  let cursor = `${from.slice(0, 7)}-01`;
  const endMonth = to.slice(0, 7);
  while (cursor.slice(0, 7) <= endMonth) {
    const y = Number(cursor.slice(0, 4));
    const m = Number(cursor.slice(5, 7));
    const toDay = new Date(y, m, 0).getDate();
    const monthFrom = `${cursor.slice(0, 7)}-01`;
    const monthTo = `${cursor.slice(0, 7)}-${String(toDay).padStart(2, "0")}`;
    const pl = profitAndLoss(monthFrom, monthTo);
    actualMonths.push({
      key: monthFrom.slice(0, 7),
      label: new Date(`${monthFrom}T12:00:00`).toLocaleString("en-US", {
        month: "short",
        year: "numeric",
      }),
      from: monthFrom,
      to: monthTo,
      income: pl.totalIncome,
      expenses: pl.totalExpenses,
      netProfit: pl.netProfit,
      isProjected: false,
    });
    cursor = addMonths(monthFrom, 1);
    if (actualMonths.length > 36) break;
  }

  const last =
    actualMonths[actualMonths.length - 1] ||
    ({
      key: to.slice(0, 7),
      income: 0,
      expenses: 0,
      netProfit: 0,
      from: from,
      to,
      label: "",
      isProjected: false,
    } satisfies ForecastMonth);

  let income = last.income;
  let expenses = last.expenses;
  const projected: ForecastMonth[] = [];
  let nextFrom = addMonths(last.from || `${to.slice(0, 7)}-01`, 1);
  for (let i = 0; i < Math.max(1, horizonMonths); i++) {
    income = roundMoney(income * (1 + monthlyRevRate));
    expenses = roundMoney(expenses * (1 + monthlyExpRate));
    const y = Number(nextFrom.slice(0, 4));
    const m = Number(nextFrom.slice(5, 7));
    const toDay = new Date(y, m, 0).getDate();
    const monthTo = `${nextFrom.slice(0, 7)}-${String(toDay).padStart(2, "0")}`;
    projected.push({
      key: nextFrom.slice(0, 7),
      label: new Date(`${nextFrom}T12:00:00`).toLocaleString("en-US", {
        month: "short",
        year: "numeric",
      }),
      from: nextFrom,
      to: monthTo,
      income,
      expenses,
      netProfit: roundMoney(income - expenses),
      isProjected: true,
    });
    nextFrom = addMonths(nextFrom, 1);
  }

  const months = [...actualMonths, ...projected];
  const actualIncome = roundMoney(actualMonths.reduce((s, r) => s + r.income, 0));
  const actualExpenses = roundMoney(actualMonths.reduce((s, r) => s + r.expenses, 0));
  const forecastIncome = roundMoney(projected.reduce((s, r) => s + r.income, 0));
  const forecastExpenses = roundMoney(projected.reduce((s, r) => s + r.expenses, 0));

  return {
    months,
    revenueGrowth,
    expenseGrowth,
    actualIncome,
    actualExpenses,
    actualNetProfit: roundMoney(actualIncome - actualExpenses),
    forecastIncome,
    forecastExpenses,
    forecastNetProfit: roundMoney(forecastIncome - forecastExpenses),
  };
}

export type ManagementMetric = {
  key: string;
  label: string;
  value: number;
  prior: number | null;
  variance: number | null;
  format: "money" | "percent" | "ratio" | "days";
  insight: string;
};

export function managementAnalysis(from: string, to: string) {
  const pl = profitAndLoss(from, to);
  const priorPeriod = shiftPeriod(from, to, "prior-month");
  const priorYear = shiftPeriod(from, to, "prior-year");
  const plMom = profitAndLoss(priorPeriod.from, priorPeriod.to);
  const plYoy = profitAndLoss(priorYear.from, priorYear.to);
  const bs = balanceSheet(to);
  const bsPrior = balanceSheet(priorPeriod.to);
  const cash = cashFlowStatement(from, to);
  const ar = buildAgedReport("receivable", to);
  const ap = buildAgedReport("payable", to);

  const currentAssets = roundMoney(
    bs.assets
      .filter((a) => /current|cash|bank|receivable|inventory|prepaid/i.test(`${a.name} ${a.group}`))
      .reduce((s, a) => s + a.balance, 0) ||
      bs.assets.reduce((s, a) => s + a.balance, 0),
  );
  const inventory = roundMoney(
    bs.assets
      .filter((a) => /inventory/i.test(a.name))
      .reduce((s, a) => s + a.balance, 0),
  );
  const currentLiabilities = roundMoney(
    bs.liabilities
      .filter((a) => /current|payable|accrued|tax|wage|short/i.test(`${a.name} ${a.group}`))
      .reduce((s, a) => s + a.balance, 0) ||
      bs.liabilities.reduce((s, a) => s + a.balance, 0),
  );
  const cashBalance = roundMoney(
    bs.assets
      .filter((a) => /cash|bank|petty|wallet|mobile money/i.test(a.name))
      .reduce((s, a) => s + a.balance, 0),
  );

  const cogs = roundMoney(
    pl.expenses
      .filter((e) => /cost of|cogs|\bcos\b/i.test(`${e.group} ${e.name}`))
      .reduce((s, e) => s + e.balance, 0),
  );
  const grossProfit = roundMoney(pl.totalIncome - cogs);
  const grossMargin = pl.totalIncome
    ? roundMoney((grossProfit / pl.totalIncome) * 100, 1)
    : 0;
  const expenseRatio = pl.totalIncome
    ? roundMoney((pl.totalExpenses / pl.totalIncome) * 100, 1)
    : 0;
  const currentRatio = currentLiabilities
    ? roundMoney(currentAssets / currentLiabilities, 2)
    : currentAssets
      ? 999
      : 0;
  const quickRatio = currentLiabilities
    ? roundMoney((currentAssets - inventory) / currentLiabilities, 2)
    : 0;
  const workingCapital = roundMoney(currentAssets - currentLiabilities);
  const periodDays = Math.max(
    1,
    Math.round(
      (parseIsoMs(to) - parseIsoMs(from)) / (1000 * 60 * 60 * 24),
    ) + 1,
  );
  const dso =
    pl.totalIncome > 0
      ? roundMoney((ar.totals.balance / pl.totalIncome) * periodDays, 0)
      : 0;
  const dpo =
    pl.totalExpenses > 0
      ? roundMoney((ap.totals.balance / pl.totalExpenses) * periodDays, 0)
      : 0;

  const metric = (
    key: string,
    label: string,
    value: number,
    prior: number | null,
    format: ManagementMetric["format"],
    insight: string,
  ): ManagementMetric => ({
    key,
    label,
    value,
    prior,
    variance: prior === null ? null : roundMoney(value - prior, format === "percent" || format === "ratio" ? 2 : 0),
    format,
    insight,
  });

  const metrics: ManagementMetric[] = [
    metric(
      "income",
      "Revenue",
      pl.totalIncome,
      plMom.totalIncome,
      "money",
      pl.totalIncome >= plMom.totalIncome
        ? "Revenue is ahead of the prior month."
        : "Revenue softened versus the prior month.",
    ),
    metric(
      "expenses",
      "Operating expenses",
      pl.totalExpenses,
      plMom.totalExpenses,
      "money",
      pl.totalExpenses <= plMom.totalExpenses
        ? "Cost discipline held versus last month."
        : "Expenses rose versus the prior month — review major cost lines.",
    ),
    metric(
      "net-profit",
      "Net profit",
      pl.netProfit,
      plMom.netProfit,
      "money",
      pl.netProfit >= 0
        ? "The period remains profitable."
        : "The period is loss-making — prioritise margin recovery.",
    ),
    metric(
      "margin",
      "Net margin",
      grossMargin,
      plMom.totalIncome
        ? roundMoney((plMom.netProfit / plMom.totalIncome) * 100, 1)
        : null,
      "percent",
      grossMargin >= 15
        ? "Net margin is healthy for most trading businesses."
        : "Net margin is thin — pressure-test pricing and mix.",
    ),
    metric(
      "expense-ratio",
      "Expense ratio",
      expenseRatio,
      plMom.totalIncome
        ? roundMoney((plMom.totalExpenses / plMom.totalIncome) * 100, 1)
        : null,
      "percent",
      expenseRatio <= 85
        ? "Expense ratio leaves room for contribution."
        : "Expense ratio is elevated relative to revenue.",
    ),
    metric(
      "current-ratio",
      "Current ratio",
      currentRatio,
      bsPrior.totalLiabilities
        ? roundMoney(
            (bsPrior.assets.reduce((s, a) => s + a.balance, 0) || 0) /
              Math.max(1, bsPrior.totalLiabilities),
            2,
          )
        : null,
      "ratio",
      currentRatio >= 1.2
        ? "Short-term liquidity covers near-term obligations."
        : "Liquidity is tight versus current liabilities.",
    ),
    metric(
      "quick-ratio",
      "Quick ratio",
      quickRatio,
      null,
      "ratio",
      quickRatio >= 1
        ? "Liquid assets cover current liabilities without inventory."
        : "Quick ratio suggests reliance on inventory or receivables conversion.",
    ),
    metric(
      "working-capital",
      "Working capital",
      workingCapital,
      null,
      "money",
      workingCapital >= 0
        ? "Working capital is positive."
        : "Negative working capital — watch cash timing.",
    ),
    metric("cash", "Cash & bank", cashBalance, null, "money", "Closing cash on the balance sheet."),
    metric(
      "cash-change",
      "Net cash change",
      cash.netChange,
      null,
      "money",
      cash.netChange >= 0
        ? "Cash increased over the period."
        : "Cash declined over the period — review operating and financing flows.",
    ),
    metric(
      "dso",
      "Days sales outstanding",
      dso,
      null,
      "days",
      dso <= 45
        ? "Collections appear timely."
        : "Receivables days are elevated — chase overdue invoices.",
    ),
    metric(
      "dpo",
      "Days payable outstanding",
      dpo,
      null,
      "days",
      "Supplier payment cycle implied by open payables.",
    ),
  ];

  const highlights = metrics
    .filter((m) => m.key === "net-profit" || m.key === "income" || m.key === "current-ratio" || m.key === "cash-change")
    .map((m) => m.insight);

  const risks: string[] = [];
  if (pl.netProfit < 0) risks.push("Period net loss requires a recovery plan.");
  if (currentRatio < 1) risks.push("Current liabilities exceed current assets.");
  if (dso > 60) risks.push(`Receivables average ${dso} days — collection risk.`);
  if (cash.netChange < 0 && pl.netProfit > 0) {
    risks.push("Profitable on paper but cash declined — check working capital.");
  }
  if (pl.totalIncome < plYoy.totalIncome) {
    risks.push(
      `Revenue is below the same period last year (${formatDelta(pl.totalIncome - plYoy.totalIncome)}).`,
    );
  }

  const opportunities: string[] = [];
  if (pl.totalIncome > plMom.totalIncome && pl.totalIncome > 0) {
    opportunities.push("Momentum versus last month can be locked in with pipeline follow-up.");
  }
  if (expenseRatio < 80 && pl.totalIncome > 0) {
    opportunities.push("Cost base leaves headroom to reinvest in growth.");
  }
  if (ar.totals.balance > 0) {
    opportunities.push(
      `${formatMoneyPlain(ar.totals.balance)} in open receivables can be accelerated into cash.`,
    );
  }

  const narrative = [
    `Management report for ${from} to ${to}.`,
    `Revenue ${formatMoneyPlain(pl.totalIncome)}, expenses ${formatMoneyPlain(pl.totalExpenses)}, net ${formatMoneyPlain(pl.netProfit)} (${grossMargin}% margin).`,
    `Versus prior month, profit moved ${formatDelta(pl.netProfit - plMom.netProfit)}; versus prior year, ${formatDelta(pl.netProfit - plYoy.netProfit)}.`,
    `Balance sheet working capital is ${formatMoneyPlain(workingCapital)} with a current ratio of ${currentRatio}.`,
    cash.netChange === 0
      ? "No net cash movement in the period."
      : `Cash changed by ${formatMoneyPlain(cash.netChange)} (operating ${formatMoneyPlain(cash.operating)}, investing ${formatMoneyPlain(cash.investing)}, financing ${formatMoneyPlain(cash.financing)}).`,
  ].join(" ");

  return {
    from,
    to,
    priorMonth: priorPeriod,
    priorYear,
    pl,
    plMom,
    plYoy,
    bs,
    cash,
    arTotal: ar.totals.balance,
    apTotal: ap.totals.balance,
    metrics,
    highlights,
    risks,
    opportunities,
    narrative,
  };
}

function parseIsoMs(iso: string) {
  return new Date(`${iso}T12:00:00`).getTime();
}

function formatMoneyPlain(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function formatDelta(n: number) {
  const abs = formatMoneyPlain(Math.abs(n));
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

/** Cash flow with working-capital rollforward (indirect method sketch). */
export function cashFlowIndirect(from?: string | null, to?: string | null) {
  const pl = profitAndLoss(from, to);
  const lines = loadLedgerLinesForBasis().filter((l) => {
    if (from && l.date < from) return false;
    if (to && l.date > to) return false;
    return true;
  });
  const accounts = loadChartOfAccounts();
  const movement = (nameRe: RegExp) => {
    const ids = new Set(
      accounts.filter((a) => nameRe.test(a.name)).map((a) => a.id),
    );
    return roundMoney(
      lines
        .filter((l) => ids.has(l.accountId))
        .reduce((s, l) => s + l.debit - l.credit, 0),
    );
  };
  // Increase in AR/inventory uses cash; increase in AP provides cash.
  // movement() is debit−credit: AR/inventory rises positive; AP rises negative → flip AP.
  const deltaAR = movement(/accounts receivable/i);
  const deltaInventory = movement(/inventory asset|inventory on hand/i);
  const deltaAP = -movement(/accounts payable/i);
  const depreciation = Math.abs(movement(/depreciation/i));
  const operating = roundMoney(
    pl.netProfit + depreciation - deltaAR - deltaInventory + deltaAP,
  );
  return {
    from: from ?? "",
    to: to ?? new Date().toISOString().slice(0, 10),
    netProfit: pl.netProfit,
    depreciation,
    deltaAR,
    deltaInventory,
    deltaAP,
    operating,
    method: "indirect" as const,
  };
}
