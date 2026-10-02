import {
  ensureAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { postBalancedEntry, removePostingsForSource } from "@/lib/ledger/posting";
import { computeAccountBalances } from "@/lib/ledger/posting";
import { parseAmount, roundMoney } from "@/lib/ledger/types";

/**
 * IAS 12 — Deferred tax.
 * Temporary difference × tax rate → deferred tax asset/liability.
 */
export function postDeferredTax(input: {
  date: string;
  temporaryDifference: number;
  taxRatePercent: number;
  sourceRecordId?: string;
}): { ok: true; deferredTax: number } | { ok: false; error: string } {
  const rate = Math.max(0, input.taxRatePercent) / 100;
  const deferred = roundMoney(input.temporaryDifference * rate);
  const sourceId = input.sourceRecordId || `deferred-tax-${input.date}`;
  if (!deferred) {
    removePostingsForSource(sourceId);
    return { ok: true, deferredTax: 0 };
  }
  let accounts = loadChartOfAccounts();
  const expense = ensureAccount(accounts, "Income tax expense", "Expense", "Tax expense", "5950");
  accounts = expense.accounts;
  const dta = ensureAccount(accounts, "Deferred tax asset", "Asset", "Non-current assets", "1700");
  accounts = dta.accounts;
  const dtl = ensureAccount(accounts, "Deferred tax liability", "Liability", "Non-current liabilities", "2700");
  accounts = dtl.accounts;
  saveChartOfAccounts(accounts);

  const lines =
    deferred > 0
      ? [
          {
            accountId: expense.account.id,
            accountCode: expense.account.code,
            accountName: expense.account.name,
            debit: deferred,
            credit: 0,
          },
          {
            accountId: dtl.account.id,
            accountCode: dtl.account.code,
            accountName: dtl.account.name,
            debit: 0,
            credit: deferred,
          },
        ]
      : [
          {
            accountId: dta.account.id,
            accountCode: dta.account.code,
            accountName: dta.account.name,
            debit: Math.abs(deferred),
            credit: 0,
          },
          {
            accountId: expense.account.id,
            accountCode: expense.account.code,
            accountName: expense.account.name,
            debit: 0,
            credit: Math.abs(deferred),
          },
        ];

  const result = postBalancedEntry({
    date: input.date,
    narration: `IAS 12 deferred tax @ ${input.taxRatePercent}%`,
    sourceModule: "accounts",
    sourceEntity: "deferred-tax",
    sourceRecordId: sourceId,
    lines,
  });
  return result.ok ? { ok: true, deferredTax: deferred } : result;
}

/** Estimate temporary difference from fixed assets NBV vs tax WDV if provided on settings-like input. */
export function estimateTemporaryDifferenceFromAssets(taxWdvTotal: number) {
  const balances = computeAccountBalances();
  // Sum the whole "Fixed Asset" group rather than matching account names. The
  // old code looked for an account literally named "fixed assets, at cost",
  // which the seeded chart never creates (it uses Furniture and Equipment,
  // Motor Vehicles, …), so NBV was always 0 and this returned -taxWdvTotal.
  // Accumulated Depreciation (1590) is in the same group and is credit-normal,
  // so its signed balance is already negative — summing the group gives NBV.
  const nbv = roundMoney(
    balances
      .filter((b) => b.type === "Asset" && /^fixed asset/i.test((b.group || "").trim()))
      .reduce((sum, b) => sum + b.balance, 0),
  );
  return roundMoney(nbv - taxWdvTotal);
}

export function currentTaxProvision(input: {
  date: string;
  taxableProfit: number;
  taxRatePercent: number;
}): { ok: true; tax: number } | { ok: false; error: string } {
  const tax = roundMoney(Math.max(0, input.taxableProfit) * (input.taxRatePercent / 100));
  if (!tax) return { ok: true, tax: 0 };
  let accounts = loadChartOfAccounts();
  const expense = ensureAccount(accounts, "Income tax expense", "Expense", "Tax expense", "5950");
  accounts = expense.accounts;
  const payable = ensureAccount(accounts, "Income tax payable", "Liability", "Current liabilities", "2130");
  accounts = payable.accounts;
  saveChartOfAccounts(accounts);
  return postBalancedEntry({
    date: input.date,
    narration: `Current income tax @ ${input.taxRatePercent}%`,
    sourceModule: "accounts",
    sourceEntity: "current-tax",
    sourceRecordId: `current-tax-${input.date}`,
    lines: [
      {
        accountId: expense.account.id,
        accountCode: expense.account.code,
        accountName: expense.account.name,
        debit: tax,
        credit: 0,
      },
      {
        accountId: payable.account.id,
        accountCode: payable.account.code,
        accountName: payable.account.name,
        debit: 0,
        credit: tax,
      },
    ],
  }).ok
    ? { ok: true, tax }
    : { ok: false, error: "Could not post current tax." };
}

void parseAmount;
