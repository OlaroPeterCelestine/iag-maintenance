import {
  ensureAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { postBalancedEntry } from "@/lib/ledger/posting";
import { roundMoney } from "@/lib/ledger/types";

/** Withholding tax on supplier payment — Dr Expense/AP, Cr WHT payable. */
export function postWithholdingTax(input: {
  date: string;
  grossAmount: number;
  ratePercent: number;
  sourceRecordId: string;
  expenseOrApAccount?: string;
}): { ok: true; wht: number } | { ok: false; error: string } {
  const wht = roundMoney(Math.max(0, input.grossAmount) * (Math.max(0, input.ratePercent) / 100));
  if (!wht) return { ok: true, wht: 0 };
  let accounts = loadChartOfAccounts();
  const payable = ensureAccount(accounts, "Withholding tax payable", "Liability", "Current liabilities", "2140");
  accounts = payable.accounts;
  const contra = ensureAccount(
    accounts,
    input.expenseOrApAccount || "Accounts payable",
    "Liability",
    "Current liabilities",
    "2000",
  );
  accounts = contra.accounts;
  saveChartOfAccounts(accounts);
  return postBalancedEntry({
    date: input.date,
    narration: `WHT ${input.ratePercent}%`,
    sourceModule: "purchases",
    sourceEntity: "withholding-tax",
    sourceRecordId: input.sourceRecordId,
    lines: [
      {
        accountId: contra.account.id,
        accountCode: contra.account.code,
        accountName: contra.account.name,
        debit: wht,
        credit: 0,
      },
      {
        accountId: payable.account.id,
        accountCode: payable.account.code,
        accountName: payable.account.name,
        debit: 0,
        credit: wht,
      },
    ],
  }).ok
    ? { ok: true, wht }
    : { ok: false, error: "Could not post WHT." };
}

/** IFRS 2 — Share-based payment expense accrual. */
export function postShareBasedPayment(input: {
  date: string;
  amount: number;
  sourceRecordId: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.amount));
  if (!amount) return { ok: false, error: "Amount required." };
  let accounts = loadChartOfAccounts();
  const expense = ensureAccount(
    accounts,
    "Share-based payment expense",
    "Expense",
    "Operating expenses",
    "5750",
  );
  accounts = expense.accounts;
  const equity = ensureAccount(accounts, "Share-based payment reserve", "Equity", "Equity", "3400");
  accounts = equity.accounts;
  saveChartOfAccounts(accounts);
  return postBalancedEntry({
    date: input.date,
    narration: "IFRS 2 share-based payment",
    sourceModule: "capital",
    sourceEntity: "share-based-payments",
    sourceRecordId: input.sourceRecordId,
    lines: [
      {
        accountId: expense.account.id,
        accountCode: expense.account.code,
        accountName: expense.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: equity.account.id,
        accountCode: equity.account.code,
        accountName: equity.account.name,
        debit: 0,
        credit: amount,
      },
    ],
  }).ok
    ? { ok: true }
    : { ok: false, error: "Could not post share-based payment." };
}

/** Materiality threshold helper — flag amounts below policy. */
export function isMaterial(amount: number, threshold: number) {
  return Math.abs(amount) >= Math.abs(threshold);
}
