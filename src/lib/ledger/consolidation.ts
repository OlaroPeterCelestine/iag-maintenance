import { loadChartOfAccounts } from "@/lib/ledger/chart-of-accounts";
import { loadLedgerLines, postBalancedEntry } from "@/lib/ledger/posting";
import {
  ensureAccount,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { roundMoney } from "@/lib/ledger/types";
import { getMemorySetting, setMemorySetting } from "@/lib/db/client-store";
import { persistSettingToDb } from "@/lib/db/sync";

export const ENTITIES_KEY = "financeiag-legal-entities";

export type LegalEntity = {
  id: string;
  name: string;
  code: string;
  ownershipPercent: string;
};

const defaultEntities: LegalEntity[] = [
  { id: "parent", name: "Parent", code: "P", ownershipPercent: "100" },
];

export function loadLegalEntities(): LegalEntity[] {
  if (typeof window === "undefined") return defaultEntities;
  try {
    const stored = getMemorySetting<LegalEntity[] | null>(ENTITIES_KEY, null);
    if (!stored || !Array.isArray(stored) || !stored.length) {
      setMemorySetting(ENTITIES_KEY, defaultEntities);
      void persistSettingToDb(ENTITIES_KEY, defaultEntities);
      return defaultEntities;
    }
    return stored;
  } catch {
    return defaultEntities;
  }
}

/**
 * Consolidation skeleton — eliminate intercompany balances tagged with
 * narration/source containing "intercompany".
 */
export function postIntercompanyElimination(input: {
  date: string;
  amount: number;
  receivableAccount?: string;
  payableAccount?: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.amount));
  if (!amount) return { ok: false, error: "Elimination amount required." };
  let accounts = loadChartOfAccounts();
  const ar = ensureAccount(
    accounts,
    input.receivableAccount || "Intercompany receivable",
    "Asset",
    "Current assets",
    "1250",
  );
  accounts = ar.accounts;
  const ap = ensureAccount(
    accounts,
    input.payableAccount || "Intercompany payable",
    "Liability",
    "Current liabilities",
    "2050",
  );
  accounts = ap.accounts;
  saveChartOfAccounts(accounts);
  return postBalancedEntry({
    date: input.date,
    narration: "Consolidation · intercompany elimination",
    sourceModule: "accounts",
    sourceEntity: "consolidations",
    sourceRecordId: `elim-${input.date}-${amount}`,
    lines: [
      {
        accountId: ap.account.id,
        accountCode: ap.account.code,
        accountName: ap.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: ar.account.id,
        accountCode: ar.account.code,
        accountName: ar.account.name,
        debit: 0,
        credit: amount,
      },
    ],
  }).ok
    ? { ok: true }
    : { ok: false, error: "Elimination failed." };
}

export function consolidatedTrialBalance(asOf?: string) {
  const lines = loadLedgerLines().filter((l) => !asOf || l.date <= asOf);
  const elim = lines.filter((l) => l.sourceEntity === "consolidations");
  const operating = lines.filter((l) => l.sourceEntity !== "consolidations");
  return {
    asOf: asOf ?? new Date().toISOString().slice(0, 10),
    operatingLines: operating.length,
    eliminationLines: elim.length,
    note: "Single-book consolidation skeleton — tag entityId on lines for multi-entity roll-up.",
  };
}

/** IAS 23 — Capitalize borrowing costs into qualifying asset. */
export function capitalizeBorrowingCost(input: {
  assetAccount: string;
  amount: number;
  date: string;
  sourceRecordId: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.amount));
  if (!amount) return { ok: false, error: "Amount required." };
  let accounts = loadChartOfAccounts();
  const asset = ensureAccount(
    accounts,
    input.assetAccount || "Fixed assets, at cost",
    "Asset",
    "Non-current assets",
    "1500",
  );
  accounts = asset.accounts;
  const interest = ensureAccount(accounts, "Interest expense", "Expense", "Finance costs", "5910");
  accounts = interest.accounts;
  // Capitalize: reverse interest expense into asset
  saveChartOfAccounts(accounts);
  return postBalancedEntry({
    date: input.date,
    narration: "IAS 23 borrowing cost capitalization",
    sourceModule: "assets",
    sourceEntity: "borrowing-costs",
    sourceRecordId: input.sourceRecordId,
    lines: [
      {
        accountId: asset.account.id,
        accountCode: asset.account.code,
        accountName: asset.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: interest.account.id,
        accountCode: interest.account.code,
        accountName: interest.account.name,
        debit: 0,
        credit: amount,
      },
    ],
  }).ok
    ? { ok: true }
    : { ok: false, error: "Could not capitalize borrowing costs." };
}

/**
 * IAS 29 hyperinflation — apply a general price index factor to non-monetary items.
 * Posts a hyperinflation adjustment to equity.
 */
export function applyHyperinflationFactor(input: {
  date: string;
  factor: number;
  sourceRecordId: string;
}): { ok: true; adjustment: number } | { ok: false; error: string } {
  if (input.factor <= 1) return { ok: true, adjustment: 0 };
  const accounts = loadChartOfAccounts().filter(
    (a) =>
      a.type === "Asset" &&
      /fixed|intangible|inventory|investment/i.test(a.name) &&
      !/accumulat|allowance|depreciation/i.test(a.name),
  );
  // Simplified: adjust opening equity plug for demo factor on first fixed asset cost
  const target = accounts[0];
  if (!target) return { ok: false, error: "No non-monetary assets found." };
  const lines = loadLedgerLines().filter((l) => l.accountId === target.id);
  const carrying = roundMoney(lines.reduce((s, l) => s + l.debit - l.credit, 0));
  const adjustment = roundMoney(carrying * (input.factor - 1));
  if (!adjustment) return { ok: true, adjustment: 0 };
  let coa = loadChartOfAccounts();
  const equity = ensureAccount(coa, "Hyperinflation reserve", "Equity", "Equity", "3300");
  coa = equity.accounts;
  saveChartOfAccounts(coa);
  const result = postBalancedEntry({
    date: input.date,
    narration: `IAS 29 restatement factor ${input.factor}`,
    sourceModule: "accounts",
    sourceEntity: "hyperinflation",
    sourceRecordId: input.sourceRecordId,
    lines: [
      {
        accountId: target.id,
        accountCode: target.code,
        accountName: target.name,
        debit: adjustment,
        credit: 0,
      },
      {
        accountId: equity.account.id,
        accountCode: equity.account.code,
        accountName: equity.account.name,
        debit: 0,
        credit: adjustment,
      },
    ],
  });
  return result.ok ? { ok: true, adjustment } : result;
}
