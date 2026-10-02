/** Double-entry ledger types — Manager-style accounting engine */

export type AccountType = "Asset" | "Liability" | "Equity" | "Income" | "Expense";

export type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  group: string;
  openingBalance: number;
  /** Account currency (UGX / USD / EUR). Defaults to base currency when omitted. */
  currency?: string;
  isControl?: boolean;
  inactive?: boolean;
};

export type LedgerLine = {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  date: string;
  narration: string;
  sourceModule: string;
  sourceEntity: string;
  sourceRecordId: string;
  createdAt: string;
  /** Cost center / profit center dimension */
  division?: string;
  /** Project / job dimension */
  project?: string;
  /** Legal entity for consolidation */
  entityId?: string;
  /** Location for inventory / warehouse */
  location?: string;
};

export type AccountBalance = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  group: string;
  debit: number;
  credit: number;
  balance: number;
};

export const LEDGER_ACCOUNTS_KEY = "financeiag-ledger:accounts";
export const LEDGER_LINES_KEY = "financeiag-ledger:lines";

export function parseAmount(value: string | number | undefined | null): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(n: number, decimals?: number): number {
  const safePrecision = Math.min(6, Math.max(0, decimals ?? 0));
  const f = 10 ** safePrecision;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export function normalBalanceSign(type: AccountType): 1 | -1 {
  return type === "Asset" || type === "Expense" ? 1 : -1;
}

/** Debit-normal: positive balance means debit side; credit-normal: positive means credit */
export function signedBalance(type: AccountType, debit: number, credit: number): number {
  const raw = debit - credit;
  return type === "Asset" || type === "Expense" ? raw : -raw;
}
