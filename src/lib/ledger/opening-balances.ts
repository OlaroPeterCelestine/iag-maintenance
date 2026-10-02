import {
  OPENING_BALANCES_EQUITY_CODE,
  OPENING_BALANCES_EQUITY_NAME,
  ensureAccount,
  findAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { postBalancedEntry, removePostingsForSource } from "@/lib/ledger/posting";
import { parseAmount, roundMoney } from "@/lib/ledger/types";

/** System journal that converts CoA opening balances into balanced double-entry. */
export const OPENING_BALANCES_SOURCE_ID = "__system-opening-balances__";

/**
 * IAS 1 / GAAP: opening balances must be dual-sided.
 * Rebuilds one system entry so Assets = Liabilities + Equity after openings.
 * Contra account: Opening balances equity (plug).
 */
export function rebuildOpeningBalanceEntry(asOfDate?: string): {
  ok: true;
  plugged: number;
} | { ok: false; error: string } {
  removePostingsForSource(OPENING_BALANCES_SOURCE_ID);

  let accounts = loadChartOfAccounts();
  const ensured = ensureAccount(
    accounts,
    OPENING_BALANCES_EQUITY_NAME,
    "Equity",
    "Equity",
    OPENING_BALANCES_EQUITY_CODE,
  );
  accounts = ensured.accounts;
  // Opening equity itself must never carry a stored opening (it is the plug).
  accounts = accounts.map((a) =>
    a.id === ensured.account.id || a.code === OPENING_BALANCES_EQUITY_CODE
      ? { ...a, openingBalance: 0 }
      : a,
  );
  saveChartOfAccounts(accounts);

  const plug = findAccount(accounts, OPENING_BALANCES_EQUITY_CODE) ?? ensured.account;
  const lines: {
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
  }[] = [];

  for (const account of accounts) {
    if (account.id === plug.id || account.code === OPENING_BALANCES_EQUITY_CODE) continue;
    if (account.inactive) continue;
    const opening = roundMoney(parseAmount(account.openingBalance));
    if (!opening) continue;

    const abs = Math.abs(opening);
    const debitNormal = account.type === "Asset" || account.type === "Expense";
    if (debitNormal) {
      lines.push({
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        debit: opening > 0 ? abs : 0,
        credit: opening < 0 ? abs : 0,
      });
    } else {
      lines.push({
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        debit: opening < 0 ? abs : 0,
        credit: opening > 0 ? abs : 0,
      });
    }
  }

  if (!lines.length) {
    return { ok: true, plugged: 0 };
  }

  const totalDebit = roundMoney(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = roundMoney(lines.reduce((s, l) => s + l.credit, 0));
  const diff = roundMoney(totalDebit - totalCredit);

  if (diff !== 0) {
    lines.push({
      accountId: plug.id,
      accountCode: plug.code,
      accountName: plug.name,
      debit: diff < 0 ? Math.abs(diff) : 0,
      credit: diff > 0 ? diff : 0,
    });
  }

  if (lines.filter((l) => l.debit > 0 || l.credit > 0).length < 2) {
    return { ok: true, plugged: 0 };
  }

  const result = postBalancedEntry({
    date: asOfDate || "2000-01-01",
    narration: "Opening balances (system)",
    sourceModule: "accounts",
    sourceEntity: "opening-balances",
    sourceRecordId: OPENING_BALANCES_SOURCE_ID,
    lines,
    system: true,
  });

  if (!result.ok) return result;
  return { ok: true, plugged: diff };
}
