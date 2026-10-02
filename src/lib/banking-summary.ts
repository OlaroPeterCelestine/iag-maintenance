/**
 * Banking helpers: live opening/closing balances, uncategorized money,
 * transfer validation, and per-account transaction activity.
 *
 * Bank & Cash closing balance:
 *   opening + receipts + transfers in − payments − transfers out
 *
 * Source of truth: Go API (`GET /api/records/.../bank-and-cash-accounts`
 * enrichment and `GET /api/banking/bank-balances`). Client recompute is fallback.
 */

import { formatMoney } from "@/lib/ledger/money";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords } from "@/lib/records-store";
import { convertBetween, convertToBase, recordToBase } from "@/lib/ledger/fx";
import { bankAccountsMatch } from "@/lib/accounting-party-bank";
import { apiFetch } from "@/lib/api-auth";
import { getMemoryRecords, setMemoryRecords } from "@/lib/db/client-store";
export function isUncategorizedMoney(record: ManagerRecord): boolean {
  if (/draft|void|voided|cancelled|canceled|inactive/i.test(record.status || "")) return false;
  const applied = (record.appliedTo || "").trim();
  const posting = (record.postingAccount || "").trim();
  const allocations = (record.allocations || "").trim();
  if (applied || allocations) return false;
  // Empty or Suspense posting — still needs categorisation to a real account.
  return !posting || /^suspense$/i.test(posting);
}

export function moneyAllocationLabel(record: ManagerRecord): string {
  const applied = (record.appliedTo || "").trim();
  if (applied) return `Allocated · ${applied}`;
  const posting = (record.postingAccount || "").trim();
  if (posting) return `Posted · ${posting}`;
  return "Uncategorized · Suspense";
}

function normKey(value: string | undefined | null) {
  return (value || "").trim().toLowerCase();
}

/**
 * Resolve a Bank & Cash row by exact name, or by code only when that code is
 * unique. Many operational banks share one CoA code (e.g. Bank-UGX → 1050);
 * fuzzy/code matching would make every bank inherit the first bank's balance.
 */
function findBankAccountRow(accountName: string): ManagerRecord | null {
  const key = normKey(accountName);
  if (!key) return null;
  const accounts = loadRecords("banking", "bank-and-cash-accounts");
  const byName = accounts.find(
    (r) => normKey(r.name || r.account) === key || normKey(r.name) === key,
  );
  if (byName) return byName;
  const byCode = accounts.filter((r) => normKey(r.code) === key);
  return byCode.length === 1 ? byCode[0] : null;
}

/** Match a receipt/payment bank field to one operational bank (name-first). */
function sameAccount(candidate: string | undefined, accountName: string) {
  const left = (candidate || "").trim();
  const right = accountName.trim();
  if (!left || !right) return false;
  if (normKey(left) === normKey(right)) return true;
  // Alias / rename tolerance — bankAccountsMatch must not treat shared CoA
  // codes or shared glAccount labels as identity (see accounting-party-bank).
  return bankAccountsMatch(left, right);
}

/** Operational cash fields on receipts/payments (any one may hold the bank). */
function moneyBankField(record: ManagerRecord): string {
  return (
    record.account ||
    record.bankAccount ||
    record.paidFrom ||
    record.depositTo ||
    ""
  ).trim();
}

/** Currency for a Bank & Cash account (field, then name hints like “… USD”). */
export function bankAccountCurrency(accountName: string): string {
  const key = accountName.trim();
  if (!key) return "";
  const account = findBankAccountRow(key);
  const displayName = (account?.name || account?.account || key).trim();
  return (
    account?.currency ||
    account?.currencyCode ||
    (/\bUSD\b/i.test(displayName) ? "USD" : "") ||
    (/\bEUR\b/i.test(displayName) ? "EUR" : "") ||
    (/\bGBP\b/i.test(displayName) ? "GBP" : "") ||
    ""
  )
    .toString()
    .trim()
    .toUpperCase();
}

function isVoidOrDraft(status: string | undefined) {
  return /void|voided|cancelled|canceled|draft/i.test(status || "");
}

/**
 * Operational balance for one Bank & Cash Accounts row:
 * opening + receipts + transfers in − payments − transfers out
 * for that bank name only.
 *
 * Do not use the shared Chart of Accounts (glAccount) balance here — many
 * banks often post to the same CoA account (e.g. Bank-UGX), and copying that
 * GL total onto every bank makes one receipt look like it hit all accounts.
 *
 * When `nativeCurrency` is true, keep the balance in the bank account's own
 * currency (e.g. USD for a USD account) — no conversion to base/USh.
 */
export function operationalBankBalance(
  accountName: string,
  options?: { nativeCurrency?: boolean },
): number {
  const key = accountName.trim();
  if (!key) return 0;

  const account = findBankAccountRow(key);
  const displayName = (account?.name || account?.account || key).trim();
  const bankCurrency = (
    account?.currency ||
    account?.currencyCode ||
    (/\bUSD\b/i.test(displayName) ? "USD" : "") ||
    (/\bEUR\b/i.test(displayName) ? "EUR" : "") ||
    (/\bGBP\b/i.test(displayName) ? "GBP" : "") ||
    ""
  )
    .toString()
    .trim()
    .toUpperCase();
  const native = Boolean(options?.nativeCurrency) && Boolean(bankCurrency);
  // Base-mode totals must use the resolved bank currency (incl. “… USD” name hints)
  // so foreign banks convert via FX instead of being treated as base 1:1.
  const amountCurrency = bankCurrency || undefined;

  let balance = native
    ? parseAmount(account?.openingBalance)
    : convertToBase(
        parseAmount(account?.openingBalance),
        amountCurrency,
        account?.openingBalanceDate || account?.date,
      );

  for (const record of loadRecords("banking", "receipts")) {
    if (isVoidOrDraft(record.status)) continue;
    if (!sameAccount(moneyBankField(record), displayName)) continue;
    const amt = native
      ? amountInCurrency(record, bankCurrency)
      : Math.max(0, postingToBase(record, amountCurrency));
    balance = roundMoney(balance + Math.max(0, amt));
  }

  for (const record of loadRecords("banking", "payments")) {
    if (isVoidOrDraft(record.status)) continue;
    if (!sameAccount(moneyBankField(record), displayName)) continue;
    const amt = native
      ? amountInCurrency(record, bankCurrency)
      : Math.max(0, postingToBase(record, amountCurrency));
    balance = roundMoney(balance - Math.max(0, amt));
  }

  for (const record of loadRecords("banking", "inter-account-transfers")) {
    if (isVoidOrDraft(record.status)) continue;
    const from = (record.from || record.fromAccount || "").trim();
    const to = (record.to || record.toAccount || "").trim();
    const isOut = sameAccount(from, displayName);
    const isIn = sameAccount(to, displayName);
    if (!isOut && !isIn) continue;
    const amt = native
      ? amountInCurrency(record, bankCurrency)
      : Math.max(0, postingToBase(record, amountCurrency));
    const value = Math.max(0, amt);
    if (isIn) balance = roundMoney(balance + value);
    if (isOut) balance = roundMoney(balance - value);
  }

  return balance;
}

/** Record amount expressed in a target currency (no forced base conversion). */
function amountInCurrency(record: ManagerRecord, targetCurrency: string): number {
  const amount = parseAmount(record.amount);
  if (!amount) return 0;
  const from = (record.currency || record.currencyCode || targetCurrency || "")
    .toString()
    .trim()
    .toUpperCase();
  const to = targetCurrency.toUpperCase();
  if (!from || !to || from === to) return roundMoney(amount);
  return roundMoney(convertBetween(amount, from, to, record.date || record.issueDate));
}

/** Convert a bank posting to base; fall back to the bank account currency when the row has none. */
function postingToBase(record: ManagerRecord, bankCurrency?: string): number {
  const amount = parseAmount(record.amount);
  if (!amount) return 0;
  const code = (record.currency || record.currencyCode || bankCurrency || "")
    .toString()
    .trim()
    .toUpperCase();
  return convertToBase(amount, code || undefined, record.date || record.issueDate);
}

/**
 * Live balances keyed by bank account name — each bank's own activity,
 * not the shared CoA cash control account. Codes are only indexed when unique
 * (shared Bank-UGX codes must not overwrite every bank with one total).
 */
export function liveBankBalances(): Map<string, number> {
  const accounts = loadRecords("banking", "bank-and-cash-accounts");
  const codeCounts = new Map<string, number>();
  for (const record of accounts) {
    const code = normKey(record.code);
    if (!code) continue;
    codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
  }

  const map = new Map<string, number>();
  for (const record of accounts) {
    const name = (record.name || record.account || "").trim();
    const code = (record.code || "").trim();
    if (!name && !code) continue;
    const bal = operationalBankBalance(name || code);
    if (name) map.set(name.toLowerCase(), bal);
    if (code && (codeCounts.get(code.toLowerCase()) || 0) === 1) {
      map.set(code.toLowerCase(), bal);
    }
  }
  return map;
}

function uncategorizedForAccount(
  side: "receipts" | "payments",
  accountName: string,
): { count: number; amount: number } {
  let count = 0;
  let amount = 0;
  for (const record of loadRecords("banking", side)) {
    if (!isUncategorizedMoney(record)) continue;
    if (!sameAccount(moneyBankField(record), accountName)) continue;
    count += 1;
    amount = roundMoney(amount + recordToBase(record, parseAmount(record.amount)));
  }
  return { count, amount };
}

/** Enrich Bank & Cash Account rows with closing balance + uncategorized totals.
 * Prefer server-computed balances (GET /api/records/... or /api/banking/bank-balances).
 */
export function enrichBankAccounts(records: ManagerRecord[]): ManagerRecord[] {
  // Tab-level cache from the last successful /api/banking/bank-balances call —
  // beats stale React/memory rows that still hold a wrong persisted balance.
  if (serverBankBalanceCache && serverBankBalanceCache.size > 0) {
    return records.map((record) => applyServerBankBalance(record, serverBankBalanceCache!));
  }
  const serverBacked = records.some((r) => (r.balanceSource || "").toLowerCase() === "server");
  if (serverBacked) {
    return records.map((record) => {
      if ((record.balanceSource || "").toLowerCase() !== "server") {
        return enrichBankAccountsLocal([record])[0];
      }
      return {
        ...record,
        openingBalance: record.openingBalance || "0",
        balance: record.balance || record.closingBalance || "0",
        closingBalance: record.closingBalance || record.balance || "0",
        uncategorizedReceipts: record.uncategorizedReceipts || "—",
        uncategorizedPayments: record.uncategorizedPayments || "—",
      };
    });
  }
  return enrichBankAccountsLocal(records);
}

function enrichBankAccountsLocal(records: ManagerRecord[]): ManagerRecord[] {
  const balances = liveBankBalances();
  return records.map((record) => {
    const name = (record.name || "").trim();
    const code = (record.code || "").trim();
    const currency =
      bankAccountCurrency(name || code) || record.currency || record.currencyCode;
    const openingBase = convertToBase(
      parseAmount(record.openingBalance),
      currency,
      record.openingBalanceDate || record.date,
    );
    // Prefer the bank's own name/code balance — never the shared glAccount total.
    // Never fall back to the persisted `balance` field — that can be a stale
    // shared figure (e.g. USh 10,000,000) left in Postgres/tab memory.
    const live =
      balances.get(name.toLowerCase()) ??
      (code && balances.has(code.toLowerCase()) ? balances.get(code.toLowerCase())! : openingBase);
    const receipts = uncategorizedForAccount("receipts", name);
    const payments = uncategorizedForAccount("payments", name);
    return {
      ...record,
      openingBalance: record.openingBalance || "0",
      balance: String(live),
      closingBalance: String(live),
      uncategorizedReceipts:
        receipts.count === 0
          ? "—"
          : `${receipts.count} · ${formatMoney(receipts.amount)}`,
      uncategorizedPayments:
        payments.count === 0
          ? "—"
          : `${payments.count} · ${formatMoney(payments.amount)}`,
    };
  });
}

type ServerBankBalanceRow = {
  id?: string;
  name?: string;
  closingBalance?: number;
  uncategorizedReceipts?: string;
  uncategorizedPayments?: string;
  receiptsTotal?: number;
  paymentsTotal?: number;
};

/** Last successful Railway bank-balance payload, keyed by id and lowercased name. */
let serverBankBalanceCache: Map<string, ServerBankBalanceRow> | null = null;

function applyServerBankBalance(
  record: ManagerRecord,
  cache: Map<string, ServerBankBalanceRow>,
): ManagerRecord {
  const hit =
    (record.id ? cache.get(record.id) : undefined) ||
    cache.get((record.name || record.account || "").trim().toLowerCase());
  if (!hit) {
    return {
      ...record,
      openingBalance: record.openingBalance || "0",
      balance: record.balance || record.closingBalance || "0",
      closingBalance: record.closingBalance || record.balance || "0",
      uncategorizedReceipts: record.uncategorizedReceipts || "—",
      uncategorizedPayments: record.uncategorizedPayments || "—",
    };
  }
  const closing = String(hit.closingBalance ?? record.balance ?? "0");
  return {
    ...record,
    openingBalance: record.openingBalance || "0",
    balance: closing,
    closingBalance: closing,
    uncategorizedReceipts: hit.uncategorizedReceipts || record.uncategorizedReceipts || "—",
    uncategorizedPayments: hit.uncategorizedPayments || record.uncategorizedPayments || "—",
    receiptsTotal:
      hit.receiptsTotal != null ? String(hit.receiptsTotal) : record.receiptsTotal,
    paymentsTotal:
      hit.paymentsTotal != null ? String(hit.paymentsTotal) : record.paymentsTotal,
    balanceSource: "server",
  };
}

/** Pull opening+receipts+transfers−payments from the Go API and stamp into memory. */
export async function refreshBankBalancesFromApi(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const res = await apiFetch("/api/banking/bank-balances", { cache: "no-store" });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean; data?: ServerBankBalanceRow[] };
    if (!json?.ok || !Array.isArray(json.data)) return false;

    const cache = new Map<string, ServerBankBalanceRow>();
    for (const row of json.data) {
      if (row.id) cache.set(row.id, row);
      if (row.name) cache.set(row.name.trim().toLowerCase(), row);
    }
    serverBankBalanceCache = cache;

    const current = getMemoryRecords("banking", "bank-and-cash-accounts");
    if (!current.length) return true; // cache alone still drives enrichBankAccounts
    const next = current.map((record) => applyServerBankBalance(record, cache));
    setMemoryRecords("banking", "bank-and-cash-accounts", next);
    window.dispatchEvent(
      new CustomEvent("financeiag-records-changed", {
        detail: {
          silent: true,
          reason: "bank-balances-api",
          module: "banking",
          entity: "bank-and-cash-accounts",
        },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Enrich receipts/payments with a readable Allocation column. */
export function enrichMoneyRecords(records: ManagerRecord[]): ManagerRecord[] {
  return records.map((record) => ({
    ...record,
    allocation: moneyAllocationLabel(record),
  }));
}

export function validateInterAccountTransfer(values: Record<string, string>): string | null {
  const from = (values.from || values.fromAccount || "").trim();
  const to = (values.to || values.toAccount || "").trim();
  const amount = parseAmount(values.amount);
  if (!from) return "Choose the bank account to pay from.";
  if (!to) return "Choose the bank account receiving the transfer.";
  if (from.toLowerCase() === to.toLowerCase()) {
    return "Paid from and Received in must be different bank accounts.";
  }
  if (amount <= 0) return "Enter a transfer amount greater than zero.";
  return null;
}

export type BankActivityKind = "opening" | "receipt" | "payment" | "transfer-in" | "transfer-out";

export type BankActivityLine = {
  id: string;
  date: string;
  kind: BankActivityKind;
  reference: string;
  party: string;
  description: string;
  allocation: string;
  moneyIn: number;
  moneyOut: number;
  balance: number;
  href?: string;
  status: string;
};

export type BankAccountActivity = {
  account: string;
  currency: string;
  openingBalance: number;
  closingBalance: number;
  lines: BankActivityLine[];
  receiptCount: number;
  paymentCount: number;
  transferCount: number;
  uncategorizedCount: number;
};

/** Full transaction history that explains a bank account's closing balance. */
export function bankAccountActivity(accountName: string): BankAccountActivity | null {
  const key = accountName.trim();
  if (!key) return null;

  const account = findBankAccountRow(key);
  const displayName = (account?.name || account?.account || key).trim();
  const currency = (account?.currency || "").trim().toUpperCase();
  const opening = convertToBase(
    parseAmount(account?.openingBalance),
    currency || account?.currencyCode,
    account?.openingBalanceDate || account?.date,
  );

  type Raw = Omit<BankActivityLine, "balance">;
  const raw: Raw[] = [];

  if (opening) {
    raw.push({
      id: `opening-${displayName}`,
      date: String(account?.openingBalanceDate || account?.date || account?.createdAt || "").slice(0, 10),
      kind: "opening",
      reference: "Opening",
      party: "—",
      description: "Opening balance",
      allocation: "—",
      moneyIn: opening > 0 ? opening : 0,
      moneyOut: opening < 0 ? Math.abs(opening) : 0,
      status: "Posted",
    });
  }

  for (const record of loadRecords("banking", "receipts")) {
    if (isVoidOrDraft(record.status)) continue;
    if (!sameAccount(moneyBankField(record), displayName)) continue;
    const amount = Math.max(0, recordToBase(record, parseAmount(record.amount)));
    const uncategorized = isUncategorizedMoney(record);
    raw.push({
      id: record.id,
      date: record.date || record.issueDate || "",
      kind: "receipt",
      reference: record.reference || record.id.slice(0, 8).toUpperCase(),
      party: record.party || record.paidBy || record.customer || "—",
      description: record.description || "Receipt",
      allocation: moneyAllocationLabel(record),
      moneyIn: amount,
      moneyOut: 0,
      href: uncategorized
        ? `/receipts-payments?view=receipts&account=${encodeURIComponent(displayName)}&allocation=uncategorized&edit=1&open=${encodeURIComponent(record.id)}`
        : `/receipts-payments?view=receipts&q=${encodeURIComponent(record.reference || record.id)}`,
      status: record.status || "Complete",
    });
  }

  for (const record of loadRecords("banking", "payments")) {
    if (isVoidOrDraft(record.status)) continue;
    if (!sameAccount(moneyBankField(record), displayName)) continue;
    const amount = Math.max(0, recordToBase(record, parseAmount(record.amount)));
    const uncategorized = isUncategorizedMoney(record);
    raw.push({
      id: record.id,
      date: record.date || record.issueDate || "",
      kind: "payment",
      reference: record.reference || record.id.slice(0, 8).toUpperCase(),
      party: record.party || record.payee || record.supplier || "—",
      description: record.description || "Payment",
      allocation: moneyAllocationLabel(record),
      moneyIn: 0,
      moneyOut: amount,
      href: uncategorized
        ? `/receipts-payments?view=payments&account=${encodeURIComponent(displayName)}&allocation=uncategorized&edit=1&open=${encodeURIComponent(record.id)}`
        : `/receipts-payments?view=payments&q=${encodeURIComponent(record.reference || record.id)}`,
      status: record.status || "Complete",
    });
  }

  for (const record of loadRecords("banking", "inter-account-transfers")) {
    if (isVoidOrDraft(record.status)) continue;
    const from = (record.from || record.fromAccount || "").trim();
    const to = (record.to || record.toAccount || "").trim();
    const isOut = sameAccount(from, displayName);
    const isIn = sameAccount(to, displayName);
    if (!isOut && !isIn) continue;
    const amount = Math.max(0, recordToBase(record, parseAmount(record.amount)));
    const reference = record.reference || record.id.slice(0, 8).toUpperCase();
    const href = `/banking?view=inter-account-transfers&q=${encodeURIComponent(reference)}`;
    if (isIn) {
      raw.push({
        id: `${record.id}-in`,
        date: record.date || record.issueDate || "",
        kind: "transfer-in",
        reference,
        party: from || "—",
        description:
          record.description ||
          (from ? `Transfer from ${from}` : "Inter-account transfer in"),
        allocation: "Transfer",
        moneyIn: amount,
        moneyOut: 0,
        href,
        status: record.status || "Complete",
      });
    }
    if (isOut) {
      raw.push({
        id: `${record.id}-out`,
        date: record.date || record.issueDate || "",
        kind: "transfer-out",
        reference,
        party: to || "—",
        description:
          record.description ||
          (to ? `Transfer to ${to}` : "Inter-account transfer out"),
        allocation: "Transfer",
        moneyIn: 0,
        moneyOut: amount,
        href,
        status: record.status || "Complete",
      });
    }
  }

  raw.sort((a, b) => {
    const byDate = (a.date || "").localeCompare(b.date || "");
    if (byDate) return byDate;
    if (a.kind === "opening") return -1;
    if (b.kind === "opening") return 1;
    return a.reference.localeCompare(b.reference);
  });

  let running = 0;
  const lines: BankActivityLine[] = raw.map((line) => {
    running = roundMoney(running + line.moneyIn - line.moneyOut);
    return { ...line, balance: running };
  });

  return {
    account: displayName,
    currency,
    openingBalance: opening,
    // Closing = this bank's running activity, not the shared CoA cash total.
    closingBalance: running,
    lines,
    receiptCount: lines.filter((l) => l.kind === "receipt").length,
    paymentCount: lines.filter((l) => l.kind === "payment").length,
    transferCount: lines.filter((l) => l.kind === "transfer-in" || l.kind === "transfer-out").length,
    uncategorizedCount: lines.filter((l) => /uncategorized/i.test(l.allocation)).length,
  };
}

/**
 * Bank ledger for one operational account, optionally limited to a date range.
 * Opening is the balance immediately before `from` (account opening + earlier movements).
 */
export function buildBankLedger(
  accountName: string,
  options?: { from?: string; to?: string },
): BankAccountActivity | null {
  const full = bankAccountActivity(accountName);
  if (!full) return null;
  const from = (options?.from || "").trim();
  const to = (options?.to || "").trim();
  if (!from && !to) return full;

  const movements = full.lines.filter((line) => line.kind !== "opening");
  let periodOpening = full.openingBalance;
  for (const line of movements) {
    if (from && (line.date || "") < from) {
      periodOpening = line.balance;
    }
  }

  const period = movements.filter((line) => {
    const date = line.date || "";
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });

  type Raw = Omit<BankActivityLine, "balance">;
  const raw: Raw[] = [
    {
      id: `opening-${full.account}-${from || "start"}`,
      date: from || full.lines.find((l) => l.kind === "opening")?.date || "",
      kind: "opening",
      reference: "Opening",
      party: "—",
      description: from ? `Opening balance as of ${from}` : "Opening balance",
      allocation: "—",
      moneyIn: periodOpening > 0 ? periodOpening : 0,
      moneyOut: periodOpening < 0 ? Math.abs(periodOpening) : 0,
      status: "Posted",
    },
    ...period.map(({ balance: _balance, ...rest }) => rest),
  ];

  let running = 0;
  const lines: BankActivityLine[] = raw.map((line) => {
    running = roundMoney(running + line.moneyIn - line.moneyOut);
    return { ...line, balance: running };
  });

  return {
    account: full.account,
    currency: full.currency,
    openingBalance: periodOpening,
    closingBalance: running,
    lines,
    receiptCount: lines.filter((l) => l.kind === "receipt").length,
    paymentCount: lines.filter((l) => l.kind === "payment").length,
    transferCount: lines.filter((l) => l.kind === "transfer-in" || l.kind === "transfer-out")
      .length,
    uncategorizedCount: lines.filter((l) => /uncategorized/i.test(l.allocation)).length,
  };
}
