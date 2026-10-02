import {
  ensureAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { postBalancedEntry, removePostingsForSource } from "@/lib/ledger/posting";
import { roundMoney } from "@/lib/ledger/types";

/**
 * IAS 37 — Provisions, contingent liabilities and contingent assets.
 * Recognize when: present obligation, probable outflow, reliable estimate.
 */
export function raiseProvision(input: {
  name: string;
  amount: number;
  date: string;
  expenseAccount?: string;
  sourceRecordId: string;
  kind?: "warranty" | "legal" | "restructuring" | "other";
}): { ok: true } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.amount));
  if (!amount) return { ok: false, error: "Provision amount required." };
  let accounts = loadChartOfAccounts();
  const expense = ensureAccount(
    accounts,
    input.expenseAccount || `${input.kind || "other"} provision expense`,
    "Expense",
    "Operating expenses",
    "5710",
  );
  accounts = expense.accounts;
  const provision = ensureAccount(
    accounts,
    "Provisions",
    "Liability",
    "Current liabilities",
    "2450",
  );
  accounts = provision.accounts;
  saveChartOfAccounts(accounts);
  return postBalancedEntry({
    date: input.date,
    narration: `IAS 37 provision · ${input.name}`,
    sourceModule: "accounts",
    sourceEntity: "provisions",
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
        accountId: provision.account.id,
        accountCode: provision.account.code,
        accountName: provision.account.name,
        debit: 0,
        credit: amount,
      },
    ],
  }).ok
    ? { ok: true }
    : { ok: false, error: "Could not raise provision." };
}

export function settleProvision(input: {
  amount: number;
  date: string;
  sourceRecordId: string;
  bankAccount?: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.amount));
  if (!amount) return { ok: false, error: "Amount required." };
  let accounts = loadChartOfAccounts();
  const provision = ensureAccount(accounts, "Provisions", "Liability", "Current liabilities", "2450");
  accounts = provision.accounts;
  const bank = ensureAccount(
    accounts,
    input.bankAccount || "Cash at bank",
    "Asset",
    "Current assets",
    "1100",
  );
  accounts = bank.accounts;
  saveChartOfAccounts(accounts);
  return postBalancedEntry({
    date: input.date,
    narration: "Settle provision",
    sourceModule: "accounts",
    sourceEntity: "provision-settlements",
    sourceRecordId: input.sourceRecordId,
    lines: [
      {
        accountId: provision.account.id,
        accountCode: provision.account.code,
        accountName: provision.account.name,
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
    ],
  }).ok
    ? { ok: true }
    : { ok: false, error: "Could not settle provision." };
}

export function releaseProvision(input: {
  amount: number;
  date: string;
  sourceRecordId: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.amount));
  if (!amount) {
    removePostingsForSource(input.sourceRecordId);
    return { ok: true };
  }
  let accounts = loadChartOfAccounts();
  const provision = ensureAccount(accounts, "Provisions", "Liability", "Current liabilities", "2450");
  accounts = provision.accounts;
  const income = ensureAccount(accounts, "Other income", "Income", "Non-operating income", "4100");
  accounts = income.accounts;
  saveChartOfAccounts(accounts);
  return postBalancedEntry({
    date: input.date,
    narration: "Release unused provision",
    sourceModule: "accounts",
    sourceEntity: "provision-releases",
    sourceRecordId: input.sourceRecordId,
    lines: [
      {
        accountId: provision.account.id,
        accountCode: provision.account.code,
        accountName: provision.account.name,
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
    ],
  }).ok
    ? { ok: true }
    : { ok: false, error: "Could not release provision." };
}
