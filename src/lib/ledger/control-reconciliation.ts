import { parseAmount, roundMoney, type AccountBalance } from "@/lib/ledger/types";
import { computeAccountBalances } from "@/lib/ledger/posting";
import {
  findAccount,
  loadChartOfAccounts,
  resolveCompanyBankGlName,
} from "@/lib/ledger/chart-of-accounts";
import { buildAgedReport } from "@/lib/ar-ap";
import { inventoryOnHandSummary } from "@/lib/inventory-movement";
import { loadRecords } from "@/lib/records-store";
import { convertBetween } from "@/lib/ledger/fx";
import { loadBankStatements } from "@/lib/ledger/bank-statements";
import type { ManagerRecord } from "@/lib/manager-entities";
import { operationalBankBalance } from "@/lib/banking-summary";

export type ControlReconcileRow = {
  control: string;
  ledgerAccount: string;
  ledgerBalance: number;
  subledgerBalance: number;
  difference: number;
  balanced: boolean;
};

function isNonPostingStatus(status: string | undefined) {
  return /^(draft|void|voided|cancelled|canceled|inactive|pending|submitted|awaiting approval|unapproved)$/i.test(
    (status || "").trim(),
  );
}

function isCleared(record: ManagerRecord) {
  // Statement-reconciled only — "Cleared" on receipts/payments means allocated to a
  // party document, not that it appears on the bank statement.
  return /reconciled|statement.?matched|matched.?statement/i.test(
    record.clearance || record.reconciliationStatus || "",
  );
}

/** Sum GL balances for a control (aliases + multi-currency siblings). */
function controlLedgerBalance(
  balances: AccountBalance[],
  queries: string[],
  groupHints: string[] = [],
): { balance: number; label: string } {
  const accounts = loadChartOfAccounts();
  const matchedIds = new Set<string>();
  const labels: string[] = [];
  const inventoryControl = queries.some((q) => /inventory/i.test(q));

  for (const query of queries) {
    const found = findAccount(accounts, query);
    if (!found) continue;
    matchedIds.add(found.id);
    if (!labels.includes(found.name)) labels.push(found.name);
    for (const sibling of accounts) {
      if (sibling.inactive) continue;
      // Currency siblings only (e.g. Accounts Receivable-UGX / -USD).
      const base = found.name.replace(/-(UGX|USD|EUR|GBP)$/i, "").toLowerCase();
      const sib = sibling.name.replace(/-(UGX|USD|EUR|GBP)$/i, "").toLowerCase();
      if (base && sib === base) matchedIds.add(sibling.id);
    }
  }

  if (inventoryControl) {
    for (const acct of accounts) {
      if (acct.inactive) continue;
      if (/inventory/i.test(acct.name) && !/wip|work.?in.?progress/i.test(acct.name)) {
        matchedIds.add(acct.id);
        if (!labels.includes(acct.name)) labels.push(acct.name);
      }
    }
  } else {
    for (const hint of groupHints) {
      const h = hint.toLowerCase();
      for (const acct of accounts) {
        if (acct.inactive) continue;
        if (acct.group.toLowerCase() === h) {
          matchedIds.add(acct.id);
          if (!labels.includes(acct.name)) labels.push(acct.name);
        }
      }
    }
  }

  const balance = roundMoney(
    balances
      .filter((b) => matchedIds.has(b.accountId))
      .reduce((s, b) => s + b.balance, 0),
  );

  if (!matchedIds.size) {
    const fallback = roundMoney(
      balances
        .filter((b) =>
          queries.some((q) => b.name.toLowerCase() === q.trim().toLowerCase()),
        )
        .reduce((s, b) => s + b.balance, 0),
    );
    return { balance: fallback, label: queries[0] || "" };
  }

  return {
    balance,
    label: labels.slice(0, 3).join(", ") || queries[0] || "",
  };
}

function inventorySubledgerValue(asOf?: string): number {
  const items = inventoryOnHandSummary();
  const live = roundMoney(items.reduce((s, i) => s + i.value, 0));
  if (!asOf) return live;

  // Reconstruct as-of value from opening + dated movement maps when available.
  const sourceDates = new Map<string, string>();
  const buckets = [
    ["inventory", "stock-in"],
    ["purchases", "goods-receipts"],
    ["purchases", "purchase-invoices"],
    ["sales", "credit-notes"],
    ["inventory", "inventory-write-offs"],
    ["purchases", "debit-notes"],
    ["inventory", "inventory-sales"],
    ["pos", "pos-sales"],
    ["pos", "pos-returns"],
    ["pos", "cash-sessions"],
    ["pos", "daily-closings"],
    ["fleet", "fuel-logs"],
    ["fleet", "maintenance-requests"],
    ["sales", "sales-invoices"],
  ] as const;
  for (const [mod, entity] of buckets) {
    for (const rec of loadRecords(mod, entity)) {
      const d = (rec.date || rec.issueDate || "").slice(0, 10);
      if (d) sourceDates.set(rec.id, d);
    }
  }

  const stockItems = loadRecords("inventory", "inventory-items");
  let total = 0;
  let usedMoves = false;
  for (const item of stockItems) {
    let valueMoves: Record<string, number> = {};
    try {
      valueMoves = item.inventoryValueMoves
        ? (JSON.parse(String(item.inventoryValueMoves)) as Record<string, number>)
        : {};
    } catch {
      valueMoves = {};
    }
    const keys = Object.keys(valueMoves);
    if (!keys.length) {
      total +=
        item.inventoryValue !== undefined && item.inventoryValue !== ""
          ? parseAmount(item.inventoryValue)
          : roundMoney(
              parseAmount(item.quantity) *
                parseAmount(item.averageCost || item.unitCost || item.cost || item.purchasePrice),
            );
      continue;
    }
    usedMoves = true;
    const unit = parseAmount(
      item.averageCost || item.unitCost || item.cost || item.purchasePrice || item.unitValue,
    );
    const closingQty = parseAmount(item.quantity || item.closingStock);
    let moves: Record<string, number> = {};
    try {
      moves = item.inventoryMoves
        ? (JSON.parse(String(item.inventoryMoves)) as Record<string, number>)
        : {};
    } catch {
      moves = {};
    }
    const movementQty = Object.values(moves).reduce((s, v) => s + parseAmount(v), 0);
    const openingQty =
      item.openingStock !== undefined && String(item.openingStock).trim() !== ""
        ? parseAmount(item.openingStock)
        : roundMoney(closingQty - movementQty);
    const closingValue =
      item.inventoryValue !== undefined && String(item.inventoryValue).trim() !== ""
        ? parseAmount(item.inventoryValue)
        : roundMoney(closingQty * unit);
    const movementValue = Object.values(valueMoves).reduce((s, v) => s + parseAmount(v), 0);
    let value = roundMoney(
      item.openingStock !== undefined && String(item.openingStock).trim() !== ""
        ? Math.max(0, openingQty * unit)
        : Math.max(0, closingValue - movementValue),
    );
    for (const [sourceId, moveValue] of Object.entries(valueMoves)) {
      const d = sourceDates.get(sourceId);
      if (!d || d <= asOf) value = roundMoney(value + parseAmount(moveValue));
    }
    total += value;
  }
  return roundMoney(usedMoves ? total : live);
}

/** Prove AR / AP / Inventory control accounts equal their subledgers. */
export function reconcileControlAccounts(asOf?: string): ControlReconcileRow[] {
  const balances = computeAccountBalances(asOf);
  const arAged = buildAgedReport("receivable", asOf);
  const apAged = buildAgedReport("payable", asOf);
  const inventoryValue = inventorySubledgerValue(asOf);

  const ar = controlLedgerBalance(
    balances,
    ["Accounts receivable", "Accounts Receivable-UGX"],
    ["Accounts Receivable"],
  );
  const ap = controlLedgerBalance(
    balances,
    ["Accounts payable", "Accounts Payable-UGX"],
    ["Accounts Payable"],
  );
  const inv = controlLedgerBalance(
    balances,
    ["Inventory on hand", "Inventory Asset"],
    [],
  );

  const rows: Omit<ControlReconcileRow, "difference" | "balanced">[] = [
    {
      control: "Accounts receivable",
      ledgerAccount: ar.label || "Accounts Receivable-UGX",
      ledgerBalance: ar.balance,
      subledgerBalance: arAged.totals.balance,
    },
    {
      control: "Accounts payable",
      ledgerAccount: ap.label || "Accounts Payable-UGX",
      ledgerBalance: ap.balance,
      subledgerBalance: apAged.totals.balance,
    },
    {
      control: "Inventory on hand",
      ledgerAccount: inv.label || "Inventory Asset",
      ledgerBalance: inv.balance,
      subledgerBalance: inventoryValue,
    },
  ];

  return rows.map((row) => {
    const difference = roundMoney(row.ledgerBalance - row.subledgerBalance);
    return { ...row, difference, balanced: difference === 0 };
  });
}

export type BankReconciliationResult = {
  account: string;
  glAccount: string;
  /** Bank account currency — statement/book/discrepancy are in this currency. */
  currency: string;
  statementBalance: number;
  bookBalance: number;
  unclearedReceipts: number;
  unclearedPayments: number;
  unclearedTransfersIn: number;
  unclearedTransfersOut: number;
  adjustedBook: number;
  discrepancy: number;
  balanced: boolean;
  pending: { id: string; reference: string; date: string; amount: number; kind: string }[];
};

function accountMatchesBank(recordAcct: string, bankName: string) {
  const acct = recordAcct.trim().toLowerCase();
  const bank = bankName.trim().toLowerCase();
  // Match the operational bank name only — never the shared CoA glAccount
  // (many banks can post to the same Bank-UGX control).
  return Boolean(acct && bank && acct === bank);
}

/** Amount in the bank account's currency (keep USD as USD — do not force base/USh). */
function postingAmountInBankCurrency(
  record: ManagerRecord,
  bankCurrency: string,
): number {
  const amount = parseAmount(record.amount);
  if (!amount) return 0;
  const from = (record.currency || record.currencyCode || bankCurrency || "")
    .toString()
    .trim()
    .toUpperCase();
  const to = (bankCurrency || "").toUpperCase();
  if (!to || !from || from === to) return roundMoney(amount);
  return roundMoney(convertBetween(amount, from, to, record.date || record.issueDate));
}

/** Compare bank statement balance to book, adjusting for uncleared receipts/payments. */
export function reconcileBankAccount(input: {
  account: string;
  statementBalance: number;
  asOf: string;
}): BankReconciliationResult {
  const bankName = input.account.trim();
  const glName = resolveCompanyBankGlName(bankName) || bankName;
  const accounts = loadChartOfAccounts();
  const glAccount = findAccount(accounts, glName) || findAccount(accounts, bankName);

  const bankRec = loadRecords("banking", "bank-and-cash-accounts").find(
    (r) =>
      (r.name || "").trim().toLowerCase() === bankName.toLowerCase() ||
      (r.code || "").trim().toLowerCase() === bankName.toLowerCase(),
  );
  const bankCurrency = (
    bankRec?.currency ||
    bankRec?.currencyCode ||
    (/\bUSD\b/i.test(bankName) ? "USD" : "") ||
    (/\bEUR\b/i.test(bankName) ? "EUR" : "") ||
    (/\bGBP\b/i.test(bankName) ? "GBP" : "") ||
    ""
  )
    .toString()
    .trim()
    .toUpperCase();

  // Reconcile in the bank's own currency (USD account → USD figures, no USh conversion).
  const book = operationalBankBalance(bankName, { nativeCurrency: true });
  const statementBalance = roundMoney(input.statementBalance);

  const receipts = loadRecords("banking", "receipts").filter((r) => {
    const acct = r.account || r.bankAccount || "";
    return (
      accountMatchesBank(acct, bankName) &&
      (!r.date || r.date <= input.asOf) &&
      !isNonPostingStatus(r.status) &&
      !isCleared(r)
    );
  });
  const payments = loadRecords("banking", "payments").filter((r) => {
    const acct = r.account || r.bankAccount || "";
    return (
      accountMatchesBank(acct, bankName) &&
      (!r.date || r.date <= input.asOf) &&
      !isNonPostingStatus(r.status) &&
      !isCleared(r)
    );
  });

  const unclearedReceipts = roundMoney(
    receipts.reduce((s, r) => s + postingAmountInBankCurrency(r, bankCurrency), 0),
  );
  const unclearedPayments = roundMoney(
    payments.reduce((s, r) => s + postingAmountInBankCurrency(r, bankCurrency), 0),
  );

  const transfers = loadRecords("banking", "inter-account-transfers").filter((r) => {
    if (isNonPostingStatus(r.status) || isCleared(r)) return false;
    if (r.date && r.date > input.asOf) return false;
    const from = r.from || r.fromAccount || "";
    const to = r.to || r.toAccount || "";
    return accountMatchesBank(from, bankName) || accountMatchesBank(to, bankName);
  });
  const unclearedTransfersIn = roundMoney(
    transfers
      .filter((r) => accountMatchesBank(r.to || r.toAccount || "", bankName))
      .reduce((s, r) => s + postingAmountInBankCurrency(r, bankCurrency), 0),
  );
  const unclearedTransfersOut = roundMoney(
    transfers
      .filter((r) => accountMatchesBank(r.from || r.fromAccount || "", bankName))
      .reduce((s, r) => s + postingAmountInBankCurrency(r, bankCurrency), 0),
  );

  // System closing = operational book in the bank's currency.
  // Discrepancy compares statement to that book balance (same figure shown in the form).
  const adjustedBook = roundMoney(
    book - unclearedReceipts - unclearedTransfersIn + unclearedPayments + unclearedTransfersOut,
  );
  const bookBalance = roundMoney(book);
  const discrepancy = roundMoney(statementBalance - bookBalance);

  return {
    account: bankName,
    glAccount: glAccount?.name || glName,
    currency: bankCurrency,
    statementBalance,
    bookBalance,
    unclearedReceipts,
    unclearedPayments,
    unclearedTransfersIn,
    unclearedTransfersOut,
    adjustedBook,
    discrepancy,
    balanced: discrepancy === 0,
    pending: [
      ...receipts.map((r) => ({
        id: r.id,
        reference: r.reference || r.id.slice(0, 8),
        date: r.date || "",
        amount: postingAmountInBankCurrency(r, bankCurrency),
        kind: "Receipt",
      })),
      ...payments.map((r) => ({
        id: r.id,
        reference: r.reference || r.id.slice(0, 8),
        date: r.date || "",
        amount: postingAmountInBankCurrency(r, bankCurrency),
        kind: "Payment",
      })),
      ...transfers.map((r) => {
        const isIn = accountMatchesBank(r.to || r.toAccount || "", bankName);
        return {
          id: r.id,
          reference: r.reference || r.id.slice(0, 8),
          date: r.date || "",
          amount: postingAmountInBankCurrency(r, bankCurrency),
          kind: isIn ? "Transfer in" : "Transfer out",
        };
      }),
    ],
  };
}

/** Latest imported statement closing balance for a bank account (if any). */
export function latestStatementBalanceForAccount(account: string): number | null {
  const key = account.trim().toLowerCase();
  if (!key) return null;
  const statements = loadBankStatements()
    .filter((s) => s.account.trim().toLowerCase() === key)
    .sort(
      (a, b) =>
        (b.asOf || "").localeCompare(a.asOf || "") ||
        (b.importedAt || "").localeCompare(a.importedAt || ""),
    );
  if (!statements.length) return null;
  return roundMoney(statements[0].closingBalance);
}
