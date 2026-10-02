import { loadLedgerLinesForBasis, postBalancedEntry, removePostingsForSource } from "@/lib/ledger/posting";
import {
  ensureAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";

/**
 * IFRS 9 — Fair value measurement for investments.
 */
export function markInvestmentToMarket(input: {
  investmentId: string;
  fairValue: number;
  date: string;
  through: "pnl" | "oci";
}): { ok: true; gainLoss: number } | { ok: false; error: string } {
  const investments = loadRecords("investments", "investments");
  const inv = investments.find((r) => r.id === input.investmentId);
  if (!inv) return { ok: false, error: "Investment not found." };
  const carrying = parseAmount(inv.marketValue || inv.cost || inv.amount);
  const fv = roundMoney(Math.max(0, input.fairValue));
  const gainLoss = roundMoney(fv - carrying);
  const sourceId = `fv-${inv.id}-${input.date}`;
  if (!gainLoss) {
    removePostingsForSource(sourceId);
    return { ok: true, gainLoss: 0 };
  }

  let accounts = loadChartOfAccounts();
  const asset = ensureAccount(accounts, inv.account || "Investments", "Asset", "Non-current assets", "1600");
  accounts = asset.accounts;
  const pnl = ensureAccount(
    accounts,
    "Unrealized investment gains (losses)",
    "Expense",
    "Non-operating expenses",
    "5610",
  );
  accounts = pnl.accounts;
  const oci = ensureAccount(accounts, "OCI — Fair value reserve", "Equity", "Equity", "3200");
  accounts = oci.accounts;
  saveChartOfAccounts(accounts);

  const contra = input.through === "oci" ? oci.account : pnl.account;
  const abs = Math.abs(gainLoss);
  const lines =
    gainLoss > 0
      ? [
          {
            accountId: asset.account.id,
            accountCode: asset.account.code,
            accountName: asset.account.name,
            debit: abs,
            credit: 0,
          },
          {
            accountId: contra.id,
            accountCode: contra.code,
            accountName: contra.name,
            debit: 0,
            credit: abs,
          },
        ]
      : [
          {
            accountId: contra.id,
            accountCode: contra.code,
            accountName: contra.name,
            debit: abs,
            credit: 0,
          },
          {
            accountId: asset.account.id,
            accountCode: asset.account.code,
            accountName: asset.account.name,
            debit: 0,
            credit: abs,
          },
        ];

  const result = postBalancedEntry({
    date: input.date,
    narration: `IFRS 9 FV · ${inv.name || inv.code} (${input.through.toUpperCase()})`,
    sourceModule: "investments",
    sourceEntity: "fair-value",
    sourceRecordId: sourceId,
    lines,
  });
  if (!result.ok) return result;
  inv.marketValue = String(fv);
  inv.lastValuationDate = input.date;
  void saveRecords("investments", "investments", investments).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "investments/investments",
        saved.error ||
          "Fair value was posted to the ledger, but the investment record could not be updated.",
      );
    }
  });
  return { ok: true, gainLoss };
}

/** Statement of other comprehensive income (OCI) items. */
export function otherComprehensiveIncome(from?: string | null, to?: string | null) {
  const accounts = loadChartOfAccounts().filter((a) =>
    /oci|fair value reserve|revaluation surplus|hyperinflation/i.test(`${a.name} ${a.group}`),
  );
  const lines = loadLedgerLinesForBasis().filter((l) => {
    if (from && l.date < from) return false;
    if (to && l.date > to) return false;
    return accounts.some((a) => a.id === l.accountId);
  });
  const rows = accounts.map((account) => {
    const matched = lines.filter((l) => l.accountId === account.id);
    const credit = roundMoney(matched.reduce((s, l) => s + l.credit, 0));
    const debit = roundMoney(matched.reduce((s, l) => s + l.debit, 0));
    return {
      code: account.code,
      name: account.name,
      amount: roundMoney(credit - debit),
    };
  });
  return {
    from: from ?? "",
    to: to ?? new Date().toISOString().slice(0, 10),
    rows: rows.filter((r) => r.amount !== 0),
    totalOci: roundMoney(rows.reduce((s, r) => s + r.amount, 0)),
  };
}
