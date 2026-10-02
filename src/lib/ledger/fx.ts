import { loadManagerSettings, latestExchangeRate } from "@/lib/manager-settings";
import {
  ensureAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { postBalancedEntry, removePostingsForSource, loadLedgerLines } from "@/lib/ledger/posting";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";

/** The reporting/base currency every ledger posting is expressed in. */
export function baseCurrencyCode(): string {
  return (loadManagerSettings().baseCurrencyCode || "UGX").toUpperCase();
}

/** Normalize a currency code, defaulting to the base currency. */
export function normalizeCurrency(currencyCode?: string | null): string {
  return (currencyCode || "").trim().toUpperCase() || baseCurrencyCode();
}

export function isBaseCurrency(currencyCode?: string | null): boolean {
  return normalizeCurrency(currencyCode) === baseCurrencyCode();
}

/** True when a usable rate exists (base currency always does). */
export function hasExchangeRate(currencyCode?: string | null, asOf?: string): boolean {
  const code = normalizeCurrency(currencyCode);
  if (code === baseCurrencyCode()) return true;
  return parseAmount(latestExchangeRate(code, asOf)) > 0;
}

/** Units of base currency per 1 unit of foreign currency (0 if unknown — never invent 1:1). */
export function exchangeRateToBase(currencyCode?: string | null, asOf?: string): number {
  const code = normalizeCurrency(currencyCode);
  if (code === baseCurrencyCode()) return 1;
  const rate = parseAmount(latestExchangeRate(code, asOf));
  return rate > 0 ? rate : 0;
}

/** Convert a foreign amount into base currency using the best available rate for `asOf`. */
export function convertToBase(amount: number, currencyCode?: string | null, asOf?: string): number {
  if (!amount) return 0;
  if (isBaseCurrency(currencyCode)) return roundMoney(amount);
  const rate = exchangeRateToBase(currencyCode, asOf);
  // Fail closed: missing FX must not silently post/display 1:1.
  if (rate <= 0) return 0;
  return roundMoney(amount * rate);
}

/** The currency a stored record's amounts are expressed in. */
export function recordCurrency(record: Partial<ManagerRecord> | null | undefined): string {
  return normalizeCurrency(record?.currency || record?.currencyCode);
}

/** The date used to pick an exchange rate for a record. */
export function recordFxDate(record: Partial<ManagerRecord> | null | undefined): string | undefined {
  const raw =
    record?.date ||
    record?.issueDate ||
    record?.asOf ||
    record?.acquired ||
    record?.purchaseDate ||
    undefined;
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 10) : undefined;
}

/**
 * Convert an amount stored on a record (document currency) into base currency.
 * Every ledger posting and subledger balance must go through this.
 */
export function recordToBase(
  record: Partial<ManagerRecord> | null | undefined,
  amount: number,
): number {
  return convertToBase(amount, recordCurrency(record), recordFxDate(record));
}

/** Convert an amount from one currency into another via the base currency. */
export function convertBetween(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  asOf?: string,
): number {
  if (!amount) return 0;
  const settings = loadManagerSettings();
  const base = (settings.baseCurrencyCode || "").toUpperCase();
  const from = (fromCurrency || base).toUpperCase();
  const to = (toCurrency || base).toUpperCase();
  if (from === to) return roundMoney(amount);
  const inBase = convertToBase(amount, from, asOf);
  const toRate = exchangeRateToBase(to, asOf);
  if (toRate <= 0) return 0;
  return roundMoney(inBase / toRate);
}

/**
 * Month-end FX revaluation for foreign-currency bank/customer/supplier balances.
 * Posts unrealized FX gain/loss against the control account.
 */
export function revalueForeignBalance(input: {
  accountName: string;
  foreignAmount: number;
  currencyCode: string;
  asOf: string;
  sourceRecordId: string;
}): { ok: true; gainLoss: number } | { ok: false; error: string } {
  const settings = loadManagerSettings();
  const code = (input.currencyCode || "").toUpperCase();
  if (!code || code === settings.baseCurrencyCode.toUpperCase()) {
    removePostingsForSource(input.sourceRecordId);
    return { ok: true, gainLoss: 0 };
  }

  let accounts = loadChartOfAccounts();
  const account =
    accounts.find(
      (a) =>
        a.name.toLowerCase() === input.accountName.trim().toLowerCase() ||
        a.code === input.accountName.trim(),
    ) || null;
  if (!account) return { ok: false, error: `Account “${input.accountName}” not found.` };

  const baseValue = convertToBase(input.foreignAmount, code, input.asOf);
  const bookLines = loadLedgerLines().filter(
    (l) => l.accountId === account.id && (!input.asOf || l.date <= input.asOf),
  );
  const rawBook = roundMoney(bookLines.reduce((s, l) => s + l.debit - l.credit, 0));
  const signedBook =
    account.type === "Asset" || account.type === "Expense" ? rawBook : -rawBook;
  const gainLoss = roundMoney(baseValue - signedBook);
  if (!gainLoss) {
    removePostingsForSource(input.sourceRecordId);
    return { ok: true, gainLoss: 0 };
  }

  const fx = ensureAccount(
    accounts,
    "Foreign exchange gains (losses)",
    "Expense",
    "Non-operating expenses",
    "5600",
  );
  accounts = fx.accounts;
  saveChartOfAccounts(accounts);

  const abs = Math.abs(gainLoss);
  const debitNormal = account.type === "Asset" || account.type === "Expense";
  // Debit-normal: gainLoss>0 → Dr account / Cr FX; gainLoss<0 → Dr FX / Cr account.
  // Credit-normal (liability/equity/income): opposite control side so the entry stays balanced.
  const lines =
    gainLoss > 0
      ? debitNormal
        ? [
            {
              accountId: account.id,
              accountCode: account.code,
              accountName: account.name,
              debit: abs,
              credit: 0,
            },
            {
              accountId: fx.account.id,
              accountCode: fx.account.code,
              accountName: fx.account.name,
              debit: 0,
              credit: abs,
            },
          ]
        : [
            {
              accountId: fx.account.id,
              accountCode: fx.account.code,
              accountName: fx.account.name,
              debit: abs,
              credit: 0,
            },
            {
              accountId: account.id,
              accountCode: account.code,
              accountName: account.name,
              debit: 0,
              credit: abs,
            },
          ]
      : debitNormal
        ? [
            {
              accountId: fx.account.id,
              accountCode: fx.account.code,
              accountName: fx.account.name,
              debit: abs,
              credit: 0,
            },
            {
              accountId: account.id,
              accountCode: account.code,
              accountName: account.name,
              debit: 0,
              credit: abs,
            },
          ]
        : [
            {
              accountId: account.id,
              accountCode: account.code,
              accountName: account.name,
              debit: abs,
              credit: 0,
            },
            {
              accountId: fx.account.id,
              accountCode: fx.account.code,
              accountName: fx.account.name,
              debit: 0,
              credit: abs,
            },
          ];

  const result = postBalancedEntry({
    date: input.asOf,
    narration: `FX revaluation ${code} · ${input.accountName}`,
    sourceModule: "accounts",
    sourceEntity: "fx-revaluation",
    sourceRecordId: input.sourceRecordId,
    lines,
  });
  return result.ok ? { ok: true, gainLoss } : result;
}
