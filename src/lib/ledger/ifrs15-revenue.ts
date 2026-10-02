import {
  ensureAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { postBalancedEntry, removePostingsForSource } from "@/lib/ledger/posting";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";

/**
 * IFRS 15 — Revenue from contracts with customers.
 * Recognize revenue when (or as) performance obligations are satisfied.
 */
export function recognizeContractRevenue(input: {
  contractId: string;
  date: string;
  amount: number;
  obligation?: string;
  customer?: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.amount));
  if (!amount) return { ok: false, error: "Recognition amount required." };
  let accounts = loadChartOfAccounts();
  const ar = ensureAccount(accounts, "Accounts receivable", "Asset", "Current assets", "1200");
  accounts = ar.accounts;
  const contractAsset = ensureAccount(accounts, "Contract assets", "Asset", "Current assets", "1220");
  accounts = contractAsset.accounts;
  const deferred = ensureAccount(accounts, "Contract liabilities", "Liability", "Current liabilities", "2520");
  accounts = deferred.accounts;
  const sales = ensureAccount(accounts, "Sales", "Income", "Operating income", "4000");
  accounts = sales.accounts;
  saveChartOfAccounts(accounts);

  const sourceId = `ifrs15-${input.contractId}-${input.date}-${input.obligation || "all"}`;
  return postBalancedEntry({
    date: input.date,
    narration: `IFRS 15 · ${input.obligation || "Performance obligation"} · ${input.customer || ""}`.trim(),
    sourceModule: "sales",
    sourceEntity: "revenue-contracts",
    sourceRecordId: sourceId,
    lines: [
      {
        accountId: ar.account.id,
        accountCode: ar.account.code,
        accountName: ar.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: sales.account.id,
        accountCode: sales.account.code,
        accountName: sales.account.name,
        debit: 0,
        credit: amount,
      },
    ],
  }).ok
    ? { ok: true }
    : { ok: false, error: "Could not recognize contract revenue." };
}

/** Receive cash before performance → contract liability (deferred). */
export function postContractLiability(input: {
  contractId: string;
  date: string;
  amount: number;
  bankAccount?: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.amount));
  if (!amount) return { ok: false, error: "Amount required." };
  let accounts = loadChartOfAccounts();
  const bank = ensureAccount(
    accounts,
    input.bankAccount || "Cash at bank",
    "Asset",
    "Current assets",
    "1100",
  );
  accounts = bank.accounts;
  const liability = ensureAccount(accounts, "Contract liabilities", "Liability", "Current liabilities", "2520");
  accounts = liability.accounts;
  saveChartOfAccounts(accounts);
  return postBalancedEntry({
    date: input.date,
    narration: `Contract liability · ${input.contractId}`,
    sourceModule: "sales",
    sourceEntity: "contract-liabilities",
    sourceRecordId: `cl-${input.contractId}-${input.date}`,
    lines: [
      {
        accountId: bank.account.id,
        accountCode: bank.account.code,
        accountName: bank.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: liability.account.id,
        accountCode: liability.account.code,
        accountName: liability.account.name,
        debit: 0,
        credit: amount,
      },
    ],
  }).ok
    ? { ok: true }
    : { ok: false, error: "Could not post contract liability." };
}

/**
 * Progress / % of completion recognition.
 * percentComplete 0–100 of totalContractValue.
 */
export function recognizePercentComplete(contract: ManagerRecord, asOf: string) {
  const total = parseAmount(contract.amount || contract.total || contract.contractValue);
  const percent = Math.min(100, Math.max(0, parseAmount(contract.percentComplete)));
  const toDate = roundMoney((total * percent) / 100);
  const previously = parseAmount(contract.recognizedToDate);
  const increment = roundMoney(Math.max(0, toDate - previously));
  if (!increment) return { ok: true as const, recognized: 0 };
  const result = recognizeContractRevenue({
    contractId: contract.id,
    date: asOf,
    amount: increment,
    obligation: "POC",
    customer: contract.customer || contract.party,
  });
  if (!result.ok) return result;
  const all = loadRecords("sales", "revenue-contracts");
  const idx = all.findIndex((r) => r.id === contract.id);
  if (idx >= 0) {
    all[idx] = { ...all[idx]!, recognizedToDate: String(toDate), updatedAt: new Date().toISOString() };
    void saveRecords("sales", "revenue-contracts", all).then((saved) => {
      if (!saved.ok || saved.durable !== "postgres") {
        notifyPersistFailure(
          "sales/revenue-contracts",
          saved.error ||
            "Revenue was recognized in the ledger, but the contract's recognized-to-date could not be updated.",
        );
      }
    });
  }
  return { ok: true as const, recognized: increment };
}
