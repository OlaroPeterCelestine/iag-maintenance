import { roundMoney } from "@/lib/ledger/types";
import {
  balanceSheet,
  cashFlowStatement,
  profitAndLoss,
} from "@/lib/ledger/posting";

export type CompareMode = "off" | "prior-month" | "prior-year" | "custom";

export type ComparativeRow = {
  code: string;
  name: string;
  current: number;
  prior: number;
  variance: number;
  variancePercent: number | null;
};

function parseIso(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Shift a calendar date by whole months, clamping to month-end when needed. */
export function addMonths(iso: string, months: number): string {
  const date = parseIso(iso);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return toIso(date);
}

export function addYears(iso: string, years: number): string {
  return addMonths(iso, years * 12);
}

export function shiftPeriod(
  from: string,
  to: string,
  mode: "prior-month" | "prior-year",
): { from: string; to: string } {
  if (mode === "prior-year") {
    return { from: addYears(from, -1), to: addYears(to, -1) };
  }
  return { from: addMonths(from, -1), to: addMonths(to, -1) };
}

export function shiftAsOf(asOf: string, mode: "prior-month" | "prior-year"): string {
  return mode === "prior-year" ? addYears(asOf, -1) : addMonths(asOf, -1);
}

export function resolveComparePeriod(
  from: string,
  to: string,
  mode: CompareMode,
  customFrom: string,
  customTo: string,
): { from: string; to: string } | null {
  if (mode === "off") return null;
  if (mode === "custom") return { from: customFrom, to: customTo };
  return shiftPeriod(from, to, mode);
}

export function resolveCompareAsOf(
  asOf: string,
  mode: CompareMode,
  customAsOf: string,
): string | null {
  if (mode === "off") return null;
  if (mode === "custom") return customAsOf;
  return shiftAsOf(asOf, mode);
}

export function joinComparativeRows(
  current: { code: string; name: string; balance: number }[],
  prior: { code: string; name: string; balance: number }[],
): ComparativeRow[] {
  const map = new Map<string, ComparativeRow>();
  for (const row of current) {
    map.set(row.code || row.name, {
      code: row.code,
      name: row.name,
      current: row.balance,
      prior: 0,
      variance: row.balance,
      variancePercent: null,
    });
  }
  for (const row of prior) {
    const key = row.code || row.name;
    const existing = map.get(key);
    if (existing) {
      existing.prior = row.balance;
      existing.variance = roundMoney(existing.current - row.balance);
      existing.variancePercent = row.balance
        ? roundMoney((existing.variance / Math.abs(row.balance)) * 100, 1)
        : null;
    } else {
      map.set(key, {
        code: row.code,
        name: row.name,
        current: 0,
        prior: row.balance,
        variance: roundMoney(-row.balance),
        variancePercent: row.balance ? -100 : null,
      });
    }
  }
  for (const row of map.values()) {
    if (row.prior && row.variancePercent === null) {
      row.variancePercent = roundMoney((row.variance / Math.abs(row.prior)) * 100, 1);
    } else if (!row.prior && row.current) {
      row.variancePercent = null;
    }
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
}

export type ProfitAndLossReport = {
  from: string;
  to: string;
  income: { code: string; name: string; balance: number }[];
  expenses: { code: string; name: string; balance: number }[];
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
};

export function comparativeProfitAndLossFromReports(
  current: ProfitAndLossReport,
  prior: ProfitAndLossReport,
) {
  return {
    current,
    prior,
    income: joinComparativeRows(current.income, prior.income),
    expenses: joinComparativeRows(current.expenses, prior.expenses),
    totals: {
      income: {
        current: current.totalIncome,
        prior: prior.totalIncome,
        variance: roundMoney(current.totalIncome - prior.totalIncome),
      },
      expenses: {
        current: current.totalExpenses,
        prior: prior.totalExpenses,
        variance: roundMoney(current.totalExpenses - prior.totalExpenses),
      },
      netProfit: {
        current: current.netProfit,
        prior: prior.netProfit,
        variance: roundMoney(current.netProfit - prior.netProfit),
      },
    },
  };
}

export function comparativeProfitAndLoss(
  from: string,
  to: string,
  compareFrom: string,
  compareTo: string,
) {
  return comparativeProfitAndLossFromReports(
    profitAndLoss(from, to),
    profitAndLoss(compareFrom, compareTo),
  );
}

export function comparativeBalanceSheetFromReports(
  current: {
    assets: { code: string; name: string; balance: number }[];
    liabilities: { code: string; name: string; balance: number }[];
    equity: { code: string; name: string; balance: number }[];
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    netProfit: number;
  },
  prior: {
    assets: { code: string; name: string; balance: number }[];
    liabilities: { code: string; name: string; balance: number }[];
    equity: { code: string; name: string; balance: number }[];
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    netProfit: number;
  },
) {
  return {
    current,
    prior,
    assets: joinComparativeRows(current.assets, prior.assets),
    liabilities: joinComparativeRows(current.liabilities, prior.liabilities),
    equity: joinComparativeRows(current.equity, prior.equity),
    totals: {
      assets: {
        current: current.totalAssets,
        prior: prior.totalAssets,
        variance: roundMoney(current.totalAssets - prior.totalAssets),
      },
      liabilities: {
        current: current.totalLiabilities,
        prior: prior.totalLiabilities,
        variance: roundMoney(current.totalLiabilities - prior.totalLiabilities),
      },
      equity: {
        current: current.totalEquity,
        prior: prior.totalEquity,
        variance: roundMoney(current.totalEquity - prior.totalEquity),
      },
      netProfit: {
        current: current.netProfit,
        prior: prior.netProfit,
        variance: roundMoney(current.netProfit - prior.netProfit),
      },
    },
  };
}

export function comparativeBalanceSheet(asOf: string, compareAsOf: string) {
  return comparativeBalanceSheetFromReports(balanceSheet(asOf), balanceSheet(compareAsOf));
}

export function comparativeCashFlow(
  from: string,
  to: string,
  compareFrom: string,
  compareTo: string,
) {
  const current = cashFlowStatement(from, to);
  const prior = cashFlowStatement(compareFrom, compareTo);
  const section = (label: string, cur: number, prev: number) => ({
    label,
    current: cur,
    prior: prev,
    variance: roundMoney(cur - prev),
    variancePercent: prev ? roundMoney(((cur - prev) / Math.abs(prev)) * 100, 1) : null,
  });
  return {
    current,
    prior,
    sections: [
      section("Operating activities", current.operating, prior.operating),
      section("Investing activities", current.investing, prior.investing),
      section("Financing activities", current.financing, prior.financing),
      section("Net change in cash", current.netChange, prior.netChange),
    ],
  };
}

export function compareModeLabel(mode: CompareMode): string {
  switch (mode) {
    case "prior-month":
      return "vs prior month";
    case "prior-year":
      return "vs prior year";
    case "custom":
      return "vs custom period";
    default:
      return "";
  }
}
