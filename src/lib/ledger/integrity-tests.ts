/**
 * Accounting integrity self-tests (run in browser / reports / CLI).
 * Covers double-entry, control reconciliation, equation balance, Suspense,
 * opening equity classification, and period P&L.
 */
import {
  auditLedgerIntegrity,
  balanceSheet,
  divisionExceptionLines,
  loadLedgerLines,
  profitAndLoss,
  trialBalance,
} from "@/lib/ledger/posting";
import { reconcileControlAccounts } from "@/lib/ledger/control-reconciliation";
import { loadChartOfAccounts, OPENING_BALANCES_EQUITY_CODE } from "@/lib/ledger/chart-of-accounts";
import { isUncategorizedMoney } from "@/lib/banking-summary";
import { loadRecords } from "@/lib/records-store";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { buildAgedReport } from "@/lib/ar-ap";

export type IntegrityTestResult = {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
};

export function runAccountingIntegrityTests(asOf?: string): IntegrityTestResult[] {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  const integrity = auditLedgerIntegrity(date);
  const tb = trialBalance(date);
  const bs = balanceSheet(date);
  const controls = reconcileControlAccounts(date);
  const yearStart = `${date.slice(0, 4)}-01-01`;
  const missingClass = divisionExceptionLines(yearStart, date);
  const pl = profitAndLoss(yearStart, date);
  const accounts = loadChartOfAccounts();
  const lines = loadLedgerLines().filter((l) => !asOf || l.date <= date);

  const openingEquity = accounts.find(
    (a) =>
      a.code === OPENING_BALANCES_EQUITY_CODE ||
      /opening balances equity/i.test(a.name),
  );
  const openingEquityOk = Boolean(openingEquity && openingEquity.type === "Equity");

  // Suspense must equal net uncategorized bank money (receipts − payments).
  const suspenseAcct = accounts.find((a) => /^suspense$/i.test(a.name) || a.code === "2400");
  const suspenseBal = bs.liabilities.find((r) => r.accountId === suspenseAcct?.id)?.balance
    ?? bs.assets.find((r) => r.accountId === suspenseAcct?.id)?.balance
    ?? 0;
  // Credit-normal: liability balance is positive when credited.
  const signedSuspense =
    suspenseAcct && (suspenseAcct.type === "Liability" || suspenseAcct.type === "Equity")
      ? suspenseBal
      : -suspenseBal;

  let uncatIn = 0;
  let uncatOut = 0;
  for (const r of loadRecords("banking", "receipts")) {
    if (isUncategorizedMoney(r)) uncatIn = roundMoney(uncatIn + parseAmount(r.amount));
  }
  for (const r of loadRecords("banking", "payments")) {
    if (isUncategorizedMoney(r)) uncatOut = roundMoney(uncatOut + parseAmount(r.amount));
  }
  const expectedSuspense = roundMoney(uncatIn - uncatOut);
  const suspenseOk =
    uncatIn === 0 && uncatOut === 0
      ? true
      : Math.abs(signedSuspense - expectedSuspense) < 0.02;

  // Aged AR/AP should match control rows when books are seeded cleanly.
  const arAged = buildAgedReport("receivable", date);
  const apAged = buildAgedReport("payable", date);
  const arControl = controls.find((c) => /receivable/i.test(c.control));
  const apControl = controls.find((c) => /payable/i.test(c.control));
  const arAgedOk = !arControl || Math.abs(arControl.subledgerBalance - arAged.totals.balance) < 0.02;
  const apAgedOk = !apControl || Math.abs(apControl.subledgerBalance - apAged.totals.balance) < 0.02;

  // Every posted source must balance; no line with both debit and credit.
  const dualSide = lines.filter((l) => l.debit > 0 && l.credit > 0);
  const dualSideOk = dualSide.length === 0;

  // Soft: P&L function ran and totals are finite.
  const plFinite =
    Number.isFinite(pl.netProfit) &&
    Number.isFinite(pl.totalIncome) &&
    Number.isFinite(pl.totalExpenses);

  return [
    {
      id: "double-entry",
      name: "Double-entry balance",
      ok: integrity.ok,
      detail: integrity.ok
        ? "All journal lines balance (debits = credits)."
        : integrity.issues.join("; ") || "Ledger is out of balance.",
    },
    {
      id: "trial-balance",
      name: "Trial balance",
      ok: tb.balanced,
      detail: tb.balanced
        ? `TB balanced at ${tb.totalDebit}.`
        : `TB difference ${roundMoney(tb.totalDebit - tb.totalCredit)}.`,
    },
    {
      id: "accounting-equation",
      name: "Accounting equation",
      ok: bs.balanced,
      detail: bs.balanced
        ? `Assets ${bs.totalAssets} = Liabilities ${bs.totalLiabilities} + Equity ${bs.totalEquity}.`
        : `Equation difference ${bs.difference}.`,
    },
    {
      id: "opening-equity-type",
      name: "Opening balances equity is Equity",
      ok: openingEquityOk,
      detail: openingEquityOk
        ? `Account ${OPENING_BALANCES_EQUITY_CODE} typed as Equity.`
        : `Opening balances equity missing or typed as ${openingEquity?.type || "n/a"} (must be Equity).`,
    },
    {
      id: "no-dual-side-lines",
      name: "No dual debit+credit lines",
      ok: dualSideOk,
      detail: dualSideOk
        ? "Every ledger line is either debit or credit."
        : `${dualSide.length} line(s) have both debit and credit.`,
    },
    {
      id: "suspense-uncategorized",
      name: "Uncategorized cash in Suspense",
      ok: suspenseOk,
      detail: suspenseOk
        ? expectedSuspense === 0
          ? "No uncategorized bank money."
          : `Suspense ${signedSuspense} matches uncategorized net ${expectedSuspense}.`
        : `Suspense ${signedSuspense} ≠ uncategorized net ${expectedSuspense} (in ${uncatIn} − out ${uncatOut}).`,
    },
    {
      id: "aged-ar-matches-control",
      name: "Aged receivables = AR subledger",
      ok: arAgedOk,
      detail: arAgedOk
        ? `Aged AR ${arAged.totals.balance} agrees with control subledger.`
        : `Aged AR ${arAged.totals.balance} ≠ control ${arControl?.subledgerBalance}.`,
    },
    {
      id: "aged-ap-matches-control",
      name: "Aged payables = AP subledger",
      ok: apAgedOk,
      detail: apAgedOk
        ? `Aged AP ${apAged.totals.balance} agrees with control subledger.`
        : `Aged AP ${apAged.totals.balance} ≠ control ${apControl?.subledgerBalance}.`,
    },
    {
      id: "profit-and-loss",
      name: "Profit & loss computable",
      ok: plFinite,
      detail: `Income ${pl.totalIncome} − Expenses ${pl.totalExpenses} = Net ${pl.netProfit}.`,
    },
    ...controls.map((c) => ({
      id: `control-${c.control}`,
      name: `Control · ${c.control}`,
      ok: c.balanced,
      detail: c.balanced
        ? `Balanced — GL ${c.ledgerBalance} = subledger ${c.subledgerBalance} (${c.ledgerAccount}).`
        : `Out of balance — GL ${c.ledgerBalance} vs subledger ${c.subledgerBalance} (diff ${c.difference}) · ${c.ledgerAccount}.`,
    })),
    {
      id: "class-tracking",
      name: "Class / division on P&L",
      ok: true,
      detail:
        missingClass.length === 0
          ? "All income and expense lines have a class."
          : `Advisory: ${missingClass.length} P&L line(s) missing Class — see Division Exception Report.`,
    },
  ];
}

export function allIntegrityTestsPassed(asOf?: string): {
  ok: boolean;
  results: IntegrityTestResult[];
  passed: number;
  failed: number;
} {
  const results = runAccountingIntegrityTests(asOf);
  const failed = results.filter((r) => !r.ok).length;
  return {
    ok: failed === 0,
    results,
    passed: results.length - failed,
    failed,
  };
}
