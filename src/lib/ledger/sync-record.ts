import {
  ensureAccount,
  extractAccountCode,
  findAccount,
  loadChartOfAccounts,
  normalizeAccountType,
  OPENING_BALANCES_EQUITY_CODE,
  OPENING_BALANCES_EQUITY_NAME,
  removeChartAccounts,
  resolveCompanyBankGlName,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import {
  documentLinesByAccount,
  documentLinesFromRecord,
  documentLinesTotal,
  journalLinesFromRecord,
  journalLinesTotals,
} from "@/lib/document-lines";
import {
  ACCRUAL_ONLY_ENTITIES,
  loadLedgerLines,
  postBalancedEntry,
  removePostingsForSource,
  saveLedgerLines,
} from "@/lib/ledger/posting";
import { rebuildOpeningBalanceEntry } from "@/lib/ledger/opening-balances";
import { convertToBase, recordToBase, hasExchangeRate, isBaseCurrency, recordCurrency } from "@/lib/ledger/fx";
import { isUncategorizedMoney } from "@/lib/banking-summary";
import { postFixedAssetCapitalization } from "@/lib/ledger/fixed-assets";
import { capitalizeLease } from "@/lib/ledger/ifrs16-leases";
import { recognizePercentComplete, postContractLiability } from "@/lib/ledger/ifrs15-revenue";
import { raiseProvision } from "@/lib/ledger/ias37-provisions";
import { postShareBasedPayment } from "@/lib/ledger/tax-and-equity-extras";
import { consumeInventoryCost } from "@/lib/ledger/inventory-costing";
import { postMatchingEntry } from "@/lib/ledger/year-end-close";
import { reverseSourceEntry } from "@/lib/ledger/reversals";
import {
  isPaidLeaveType,
  releaseLeaveLiability,
  remittanceKindFromRecord,
  postStatutoryRemittance,
} from "@/lib/ledger/ias19-benefits";
import {
  employeeDailyRate,
  findEmployeeByNameOrCode,
  recomputeEmployeeLeaveBalance,
} from "@/lib/hr-ops";
import {
  parseAmount,
  roundMoney,
  type AccountType,
  type LedgerAccount,
} from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadManagerSettings } from "@/lib/manager-settings";
import { loadRecords } from "@/lib/records-store";

function resolve(
  accounts: LedgerAccount[],
  name: string,
  fallbackType: AccountType,
  fallbackGroup: string,
  code?: string,
) {
  const found = findAccount(accounts, name);
  if (found) return { accounts, account: found };
  return ensureAccount(accounts, name || "Suspense", fallbackType, fallbackGroup, code);
}

function bankAccount(accounts: LedgerAccount[], name: string) {
  const ledgerName = resolveCompanyBankGlName(name || "Bank-UGX");
  return resolve(accounts, ledgerName || "Bank-UGX", "Asset", "Cash and cash equivalents", "1050");
}

function expenseAccount(accounts: LedgerAccount[], name: string) {
  return resolve(accounts, name || "Operating Expenses", "Expense", "Expenses", "6200");
}

function incomeAccount(accounts: LedgerAccount[], name: string) {
  return resolve(accounts, name || "Coffee Sales", "Income", "Income", "4000");
}

function inventoryAccount(accounts: LedgerAccount[]) {
  return resolve(accounts, "Inventory Asset", "Asset", "Other Current Asset", "1250");
}

function costOfGoodsSoldAccount(accounts: LedgerAccount[]) {
  return resolve(accounts, "Coffee Products COS", "Expense", "Cost Of Goods Sold", "5000");
}

function arAccount(accounts: LedgerAccount[]) {
  return resolve(accounts, "Accounts Receivable-UGX", "Asset", "Accounts Receivable", "1200");
}

function apAccount(accounts: LedgerAccount[]) {
  return resolve(accounts, "Accounts Payable-UGX", "Liability", "Accounts Payable", "2000");
}

/** Prefer Accounts Payable-{currency} when that control account exists. */
function apAccountForCurrency(accounts: LedgerAccount[], currency?: string) {
  const code = (currency || "").trim().toUpperCase();
  if (code) {
    const named = findAccount(accounts, `Accounts Payable-${code}`);
    if (named) return { accounts, account: named };
  }
  return apAccount(accounts);
}

function isOpeningPayableBill(record: ManagerRecord) {
  return (
    record.isOpeningBalance === "true" ||
    /opening/i.test(record.entryType || "") ||
    (record.id || "").startsWith("ob-sup-") ||
    /^OB-SUP-/i.test(record.reference || "")
  );
}

function taxPayableAccount(accounts: LedgerAccount[], name?: string) {
  return resolve(accounts, name || "VAT Account", "Liability", "Other Current Liability", "2101");
}

/**
 * Input VAT is an asset (recoverable from URA), not a liability.
 *
 * The seeded "VAT 18%" tax code names the OUTPUT VAT liability account and is
 * applied to purchase documents as well as sales. Honouring that override
 * blindly debited input VAT straight into the output-VAT liability, collapsing
 * both sides into one control account and leaving the seeded asset (1400)
 * permanently unused — so the balance sheet could never show VAT recoverable.
 *
 * An override is only accepted when it resolves to an existing Asset account
 * (a genuinely custom input-tax account). Anything else falls back to the
 * asset default rather than creating a second account under a liability name.
 */
function taxReceivableAccount(accounts: LedgerAccount[], name?: string) {
  const override = (name || "").trim();
  if (override) {
    const found = findAccount(accounts, override);
    if (found && found.type === "Asset") return { accounts, account: found };
  }
  return resolve(accounts, "Tax Claimable Accounts", "Asset", "Other Current Asset", "1400");
}

function employeeClearingAccount(accounts: LedgerAccount[]) {
  return resolve(accounts, "Payroll Liabilities", "Liability", "Other Current Liability", "2050");
}

function suspense(accounts: LedgerAccount[]) {
  return resolve(accounts, "Suspense", "Liability", "Other Current Liability", "2400");
}

type PostResult = { ok: true } | { ok: false; error: string };

function isNonPostingStatus(status: string | undefined) {
  const s = (status || "").trim();
  if (
    /^(draft|void|voided|cancelled|canceled|inactive|pending|submitted|awaiting approval|unapproved)$/i.test(
      s,
    )
  ) {
    return true;
  }
  if (!loadManagerSettings().requireApprovalToPost) return false;
  // Approval workflow: only explicitly approved/active/settled statuses post.
  if (!s) return true;
  return !/^(active|approved|paid|partial|unpaid|posted|complete|completed|closed|cleared|reconciled|overdue|fulfilled|received)$/i.test(
    s,
  );
}

/** Convert foreign-currency document amount into base currency. */
function baseAmount(record: ManagerRecord, foreign: number) {
  return recordToBase(record, foreign);
}

/** Block posting when a foreign amount has no usable exchange rate. */
function missingFxError(record: ManagerRecord): string | null {
  const code = recordCurrency(record);
  if (isBaseCurrency(code)) return null;
  const asOf =
    record.date ||
    record.issueDate ||
    record.asOf ||
    record.acquired ||
    record.purchaseDate;
  if (hasExchangeRate(code, asOf)) return null;
  // Documents use amount/total; fixed assets use cost / totalAcquisitionCost.
  const raw = parseAmount(
    record.amount ||
      record.total ||
      record.totalAcquisitionCost ||
      record.cost ||
      record.purchasePrice ||
      record.otherCosts,
  );
  if (!raw) return null;
  return `No exchange rate for ${code}. Add one under Settings → Exchange rates before posting.`;
}

/** True when the record explicitly stores a tax amount (including zero). */
function hasStoredTax(record: ManagerRecord) {
  const raw = record.taxAmount;
  return raw !== undefined && raw !== null && String(raw).trim() !== "";
}

export function alignRowsToTotal<T extends { account: string; amount: number }>(
  rows: T[],
  target: number,
): T[] {
  if (!rows.length) return rows;
  const current = rows.reduce((sum, row) => sum + row.amount, 0);
  // Round before diffing — summing floats accumulates epsilon drift (e.g.
  // 1200.0000000000002), so a strict `!difference` check never fires and
  // every call nudges row 0 by a sub-cent amount that then compounds across
  // postings. Rounding both operands to whole currency units first makes
  // "already balanced" actually compare equal.
  const difference = roundMoney(target) - roundMoney(current);
  if (!difference) return rows;
  return rows.map((row, index) =>
    index === 0 ? { ...row, amount: roundMoney(row.amount + difference) } : row,
  );
}

function inventoryItemFor(value: string) {
  const key = value.trim().toLowerCase();
  if (!key) return undefined;
  return loadRecords("inventory", "inventory-items").find((item) =>
    [item.id, item.name, item.item, item.code, item.sku]
      .filter(Boolean)
      .some((candidate) => candidate!.trim().toLowerCase() === key),
  );
}

function inventoryCostForRecord(record: ManagerRecord) {
  // One scratch copy per item, carried across lines, so a document listing the
  // same item twice consumes successive cost layers. Peeking per line instead
  // restarted from the unconsumed layers each time, letting both lines take
  // the cheapest stock and understating COGS. The copies are local to this
  // call — stored layers are only mutated later by applyInventoryMovement.
  const scratch = new Map<string, ManagerRecord>();
  return documentLinesFromRecord(record).reduce((total, line) => {
    const item = inventoryItemFor(line.item || record.item || "");
    if (!item) return total;
    let draft = scratch.get(item.id);
    if (!draft) {
      draft = { ...item };
      scratch.set(item.id, draft);
    }
    const quantity = Math.max(0, parseAmount(line.quantity) || 1);
    const batch =
      line.item && /batch|serial/i.test(line.description || "")
        ? line.description
        : record.batch || record.serial || undefined;
    return total + consumeInventoryCost(draft, quantity, batch).cogs;
  }, 0);
}

function purchasePostingRows(record: ManagerRecord, fallback: string) {
  const grouped = new Map<string, { account: string; amount: number; division: string }>();
  for (const line of documentLinesFromRecord(record)) {
    // Line amounts are in document currency — post in base.
    const amount = Math.max(0, recordToBase(record, parseAmount(line.amount)));
    if (!amount) continue;
    const account = inventoryItemFor(line.item || record.item || "")
      ? "Inventory Asset"
      : line.account || fallback;
    const division = (line.division || record.division || record.costCenter || "").trim();
    const key = `${account.toLowerCase()}::${division.toLowerCase()}`;
    const prev = grouped.get(key);
    if (prev) prev.amount = roundMoney(prev.amount + amount);
    else grouped.set(key, { account, amount, division });
  }
  return [...grouped.values()];
}

/** Document line splits converted from document currency into base currency. */
function basePostingRows(record: ManagerRecord, fallbackAccount: string) {
  const grouped = new Map<string, { account: string; amount: number; division: string }>();
  for (const line of documentLinesFromRecord(record)) {
    const amount = Math.max(0, recordToBase(record, parseAmount(line.amount)));
    if (!amount) continue;
    const item = inventoryItemFor(line.item || record.item || "");
    const account =
      (line.account || "").trim() ||
      (item?.salesAccount || "").trim() ||
      fallbackAccount ||
      "sale of coffee";
    const division = (line.division || record.division || record.costCenter || "").trim();
    const key = `${account.toLowerCase()}::${division.toLowerCase()}`;
    const prev = grouped.get(key);
    if (prev) prev.amount = roundMoney(prev.amount + amount);
    else grouped.set(key, { account, amount, division });
  }
  return [...grouped.values()];
}

function appliedDocument(side: "receivable" | "payable", appliedTo: string | undefined) {
  const key = (appliedTo || "").trim().toLowerCase();
  if (!key) return undefined;
  const sources =
    side === "receivable"
      ? [
          ["sales", "sales-invoices"],
          ["sales", "invoices"],
        ]
      : [
          ["purchases", "purchase-invoices"],
          ["purchases", "bills"],
        ];
  return sources
    .flatMap(([moduleSlug, entityKey]) => loadRecords(moduleSlug, entityKey))
    .find((document) => {
      const reference = (document.reference || "").trim().toLowerCase();
      return (
        document.id.toLowerCase() === key ||
        reference === key
      );
    });
}

/** Sync a source record into the ledger (replace prior postings for that record). */
export function syncRecordToLedger(
  moduleSlug: string,
  entityKey: string,
  record: ManagerRecord,
): PostResult {
  // Draft, void and cancelled records never affect the general ledger (net).
  if (entityKey !== "chart-of-accounts" && isNonPostingStatus(record.status)) {
    if (/void|voided|cancelled|canceled/i.test(record.status || "")) {
      // Audit trail: keep original postings and add a reversing journal.
      const reverseDate =
        record.voidDate ||
        record.date ||
        record.issueDate ||
        new Date().toISOString().slice(0, 10);
      const reversed = reverseSourceEntry({
        sourceRecordId: record.id,
        reverseDate,
        narration: `Void ${record.reference || record.id.slice(0, 8)}`,
      });
      if (!reversed.ok && reversed.error !== "No ledger lines found to reverse.") {
        return { ok: false, error: reversed.error };
      }
      return { ok: true };
    }
    removePostingsForSource(record.id);
    removePostingsForSource(`rev-${record.id}`);
    return { ok: true };
  }
  // Re-activating a previously voided document: drop its reversing journal first.
  removePostingsForSource(`rev-${record.id}`);
  const fxMissing = missingFxError(record);
  if (fxMissing) return { ok: false, error: fxMissing };
  const basis = loadManagerSettings().accountingBasis;
  // Cash basis: invoice/bill recognition waits for receipt/payment (still stored as docs).
  if (basis === "cash" && ACCRUAL_ONLY_ENTITIES.has(entityKey)) {
    removePostingsForSource(record.id);
    return { ok: true };
  }
  let accounts = loadChartOfAccounts();
  const date =
    record.date ||
    record.issueDate ||
    record.asOf ||
    record.acquired ||
    record.purchaseDate ||
    record.startDate ||
    new Date().toISOString().slice(0, 10);
  // Everything below is expressed in BASE currency: document amounts are
  // converted once here so header, tax and line splits can never disagree.
  const lineTotalDoc = documentLinesTotal(documentLinesFromRecord(record));
  const rawAmountDoc = parseAmount(record.amount || record.total || record.balance) || lineTotalDoc;
  const lineTotal = baseAmount(record, lineTotalDoc);
  const amount = baseAmount(record, rawAmountDoc);
  // A stored tax of zero is authoritative — only infer tax when none was captured.
  const taxAmount = hasStoredTax(record)
    ? Math.max(0, baseAmount(record, parseAmount(record.taxAmount)))
    : Math.max(0, roundMoney(amount - lineTotal));
  const taxAccountName = record.taxAccount || "";
  const clearEmpty = (): PostResult => {
    removePostingsForSource(record.id);
    return { ok: true };
  };

  const post = (
    narration: string,
    lines: {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
      division?: string;
    }[],
  ): PostResult => {
    const result = postBalancedEntry({
      date,
      narration,
      sourceModule: moduleSlug,
      sourceEntity: entityKey,
      sourceRecordId: record.id,
      lines,
      division: record.division || record.costCenter,
      project: record.project || record.job,
      entityId: record.entityId || record.legalEntity,
      location: record.location || record.warehouse,
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  };

  // —— Chart of Accounts: upsert ledger account from record ——
  if (entityKey === "chart-of-accounts") {
    const kind = (record.kind || "Account").toLowerCase();
    // Groups organise the chart; they are not postable ledger accounts.
    if (kind === "group") {
      return { ok: true };
    }
    const code = record.code || record.accountCode || "";
    const name = record.name || record.account || "";
    const type = normalizeAccountType(
      record.type,
      record.code || record.accountCode || "",
      record.name || record.account || "",
    );
    const group = record.group || type;
    const opening = parseAmount(record.openingBalance);
    const inactive = /^(inactive|obsolete|archived|disabled|hidden)$/i.test(
      (record.status || "").trim(),
    );
    const currency = (record.currency || "UGX").toUpperCase();
    if (!name) return { ok: true };
    const existing = findAccount(accounts, code || name);
    if (existing) {
      accounts = accounts.map((a) =>
        a.id === existing.id
          ? {
              ...a,
              code: code || a.code,
              name,
              type,
              group,
              openingBalance: opening,
              currency,
              inactive,
            }
          : a,
      );
    } else {
      accounts = [
        ...accounts,
        {
          id: `acct-${code || Date.now()}`,
          code: code || String(9000 + accounts.length),
          name,
          type,
          group,
          openingBalance: opening,
          currency,
          inactive,
        },
      ];
    }
    saveChartOfAccounts(accounts);
    // Dual-entry openings so Assets = Liabilities + Equity always holds.
    const rebuilt = rebuildOpeningBalanceEntry();
    return rebuilt.ok ? { ok: true } : { ok: false, error: rebuilt.error };
  }

  // —— Journal Entries (multi-line) ——
  if (entityKey === "journal-entries" || entityKey === "recurring-journal-entries") {
    const jLines = journalLinesFromRecord(record);
    const { debit: totalDebit, credit: totalCredit, balanced } = journalLinesTotals(jLines);
    if (!totalDebit && !totalCredit) {
      return { ok: false, error: "Journal entry needs debit and credit amounts." };
    }
    if (!balanced) {
      return {
        ok: false,
        error: `Journal entry is out of balance. Debit ${totalDebit} ≠ Credit ${totalCredit}.`,
      };
    }
    const postingLines: {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
      division?: string;
    }[] = [];
    for (const jl of jLines) {
      // Journal lines are captured in document currency — post in base.
      const d = baseAmount(record, parseAmount(jl.debit));
      const c = baseAmount(record, parseAmount(jl.credit));
      if (!d && !c) continue;
      const accountQuery =
        jl.account || (d ? record.debitAccount : record.creditAccount) || "Suspense";
      const inferred = normalizeAccountType("", extractAccountCode(accountQuery), accountQuery);
      const resolved = resolve(
        accounts,
        accountQuery,
        d ? (inferred === "Expense" ? "Expense" : "Asset") : inferred === "Income" ? "Income" : "Equity",
        d ? (inferred === "Expense" ? "Expenses" : "Current assets") : inferred === "Income" ? "Income" : "Equity",
        extractAccountCode(accountQuery),
      );
      accounts = resolved.accounts;
      postingLines.push({
        accountId: resolved.account.id,
        accountCode: resolved.account.code,
        accountName: resolved.account.name,
        debit: d,
        credit: c,
        division: jl.division || record.division || record.costCenter || undefined,
      });
    }
    // FX line-by-line conversion can leave a 1-cent imbalance — absorb on matching side.
    const postedDebit = roundMoney(postingLines.reduce((s, l) => s + l.debit, 0));
    const postedCredit = roundMoney(postingLines.reduce((s, l) => s + l.credit, 0));
    const fxDiff = roundMoney(postedDebit - postedCredit);
    if (fxDiff > 0) {
      const target = postingLines.find((l) => l.credit > 0) || postingLines[0];
      target.credit = roundMoney(target.credit + fxDiff);
    } else if (fxDiff < 0) {
      const target = postingLines.find((l) => l.debit > 0) || postingLines[0];
      target.debit = roundMoney(target.debit - fxDiff);
    }
    return post(record.narration || record.description || "Journal entry", postingLines);
  }

  // —— Receipts (money in) ——
  if (entityKey === "receipts") {
    if (!amount) return clearEmpty();
    const bank = bankAccount(accounts, record.account || record.bankAccount || "Cash at bank");
    accounts = bank.accounts;
    const applied = Boolean(record.appliedTo?.trim());
    if (basis === "cash" && applied) {
      const invoice = appliedDocument("receivable", record.appliedTo);
      // Invoice totals are in document currency; receipt amount is already base.
      const invoiceTotalBase = invoice
        ? Math.max(0, recordToBase(invoice, parseAmount(invoice.amount || invoice.total)))
        : 0;
      const invoiceTaxBase = invoice
        ? Math.max(0, recordToBase(invoice, parseAmount(invoice.taxAmount)))
        : 0;
      const taxPortion = roundMoney(
        invoiceTotalBase > 0 ? Math.min(amount, (amount * invoiceTaxBase) / invoiceTotalBase) : 0,
      );
      const revenuePortion = roundMoney(amount - taxPortion);
      const income = incomeAccount(
        accounts,
        record.postingAccount || invoice?.account || "Sales",
      );
      accounts = income.accounts;
      const lines = [
        {
          accountId: bank.account.id,
          accountCode: bank.account.code,
          accountName: bank.account.name,
          debit: amount,
          credit: 0,
        },
        {
          accountId: income.account.id,
          accountCode: income.account.code,
          accountName: income.account.name,
          debit: 0,
          credit: revenuePortion,
        },
      ];
      if (taxPortion > 0) {
        const tax = taxPayableAccount(accounts, invoice?.taxAccount);
        accounts = tax.accounts;
        lines.push({
          accountId: tax.account.id,
          accountCode: tax.account.code,
          accountName: tax.account.name,
          debit: 0,
          credit: taxPortion,
        });
      }
      return post(record.description || `Receipt — ${record.appliedTo}`, lines);
    }
    let contra;
    // Uncategorized cash stays in Suspense until allocated to a document or posting account.
    if (isUncategorizedMoney(record)) {
      contra = suspense(accounts);
    } else if (basis === "accrual" && applied) {
      contra = arAccount(accounts);
    } else if (basis === "accrual" && !(record.postingAccount || "").trim()) {
      // Multi-document allocations without a free-form posting account clear AR.
      contra = arAccount(accounts);
    } else {
      contra = incomeAccount(
        accounts,
        record.postingAccount || record.category || record.incomeAccount || "Sales",
      );
    }
    accounts = contra.accounts;
    return post(
      record.description ||
        (applied ? `Receipt — ${record.appliedTo}` : record.reference) ||
        "Receipt",
      [
        {
          accountId: bank.account.id,
          accountCode: bank.account.code,
          accountName: bank.account.name,
          debit: amount,
          credit: 0,
        },
        {
          accountId: contra.account.id,
          accountCode: contra.account.code,
          accountName: contra.account.name,
          debit: 0,
          credit: amount,
        },
      ],
    );
  }

  // —— Payments (money out) ——
  if (entityKey === "payments") {
    if (!amount) return clearEmpty();
    const bank = bankAccount(accounts, record.account || record.bankAccount || "Cash at bank");
    accounts = bank.accounts;
    const applied = Boolean(record.appliedTo?.trim());
    if (basis === "cash" && applied) {
      const bill = appliedDocument("payable", record.appliedTo);
      // Bill totals are in document currency; payment amount is already base.
      const billTotalBase = bill
        ? Math.max(0, recordToBase(bill, parseAmount(bill.amount || bill.total)))
        : 0;
      const billTaxBase = bill
        ? Math.max(0, recordToBase(bill, parseAmount(bill.taxAmount)))
        : 0;
      const taxPortion = roundMoney(
        billTotalBase > 0 ? Math.min(amount, (amount * billTaxBase) / billTotalBase) : 0,
      );
      const expensePortion = roundMoney(amount - taxPortion);
      const expense = expenseAccount(
        accounts,
        record.postingAccount || bill?.account || bill?.expenseAccount || "Operating expenses",
      );
      accounts = expense.accounts;
      const lines = [
        {
          accountId: expense.account.id,
          accountCode: expense.account.code,
          accountName: expense.account.name,
          debit: expensePortion,
          credit: 0,
        },
        {
          accountId: bank.account.id,
          accountCode: bank.account.code,
          accountName: bank.account.name,
          debit: 0,
          credit: amount,
        },
      ];
      if (taxPortion > 0) {
        const tax = taxReceivableAccount(accounts, bill?.taxAccount);
        accounts = tax.accounts;
        lines.push({
          accountId: tax.account.id,
          accountCode: tax.account.code,
          accountName: tax.account.name,
          debit: taxPortion,
          credit: 0,
        });
      }
      return post(record.description || `Payment — ${record.appliedTo}`, lines);
    }
    let contra;
    if (isUncategorizedMoney(record)) {
      // Uncategorized cash stays in Suspense until allocated to a bill or posting account.
      contra = suspense(accounts);
    } else if (basis === "accrual" && applied) {
      // Paying a payslip clears Wages payable rather than AP.
      if (/payslip|wage|salary|payroll/i.test(record.appliedTo || "") || /wages payable/i.test(record.postingAccount || "")) {
        contra = resolve(accounts, "Wages payable", "Liability", "Current liabilities", "2210");
      } else if (/paye/i.test(record.postingAccount || "")) {
        contra = resolve(accounts, "PAYE payable", "Liability", "Current liabilities", "2052");
      } else if (/nssf/i.test(record.postingAccount || "")) {
        contra = resolve(accounts, "NSSF payable", "Liability", "Current liabilities", "2053");
      } else {
        contra = apAccount(accounts);
      }
    } else if (basis === "accrual" && /wages payable/i.test(record.postingAccount || "")) {
      contra = resolve(accounts, "Wages payable", "Liability", "Current liabilities", "2210");
    } else if (basis === "accrual" && !(record.postingAccount || "").trim()) {
      // Multi-document allocations without a free-form posting account clear AP.
      contra = apAccount(accounts);
    } else {
      contra = expenseAccount(
        accounts,
        record.postingAccount || record.category || record.expenseAccount || "Operating expenses",
      );
    }
    accounts = contra.accounts;
    return post(
      record.description ||
        (applied ? `Payment — ${record.appliedTo}` : record.reference) ||
        "Payment",
      [
        {
          accountId: contra.account.id,
          accountCode: contra.account.code,
          accountName: contra.account.name,
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
    );
  }

  if (entityKey === "inter-account-transfers") {
    if (!amount) return clearEmpty();
    const fromName = (record.from || record.fromAccount || "").trim();
    const toName = (record.to || record.toAccount || "").trim();
    if (!fromName || !toName) {
      return { ok: false, error: "Choose both Paid from and Received in bank accounts." };
    }
    if (fromName.toLowerCase() === toName.toLowerCase()) {
      return { ok: false, error: "Paid from and Received in must be different accounts." };
    }
    const from = bankAccount(accounts, fromName);
    accounts = from.accounts;
    const to = bankAccount(accounts, toName);
    accounts = to.accounts;
    return post(
      record.description ||
        `Transfer ${from.account.name} → ${to.account.name}` ||
        "Inter-account transfer",
      [
        {
          accountId: to.account.id,
          accountCode: to.account.code,
          accountName: to.account.name,
          debit: amount,
          credit: 0,
        },
        {
          accountId: from.account.id,
          accountCode: from.account.code,
          accountName: from.account.name,
          debit: 0,
          credit: amount,
        },
      ],
    );
  }

  // —— Sales invoices (multi-line) ——
  if (entityKey === "sales-invoices" || entityKey === "invoices") {
    if (!amount) return clearEmpty();
    const ar = arAccount(accounts);
    accounts = ar.accounts;
    const byAccount = basePostingRows(record, record.account || "Sales");
    const revenueTotal = Math.max(0, amount - taxAmount);
    const creditLines = alignRowsToTotal(
      byAccount.length > 0
        ? byAccount
        : [{ account: record.account || "Sales", amount: revenueTotal, division: record.division || "" }],
      revenueTotal,
    );
    const lines: {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
      division?: string;
    }[] = [
      {
        accountId: ar.account.id,
        accountCode: ar.account.code,
        accountName: ar.account.name,
        debit: amount,
        credit: 0,
        division: record.division || record.costCenter || undefined,
      },
    ];
    for (const row of creditLines) {
      const sales = incomeAccount(accounts, row.account || "Sales");
      accounts = sales.accounts;
      lines.push({
        accountId: sales.account.id,
        accountCode: sales.account.code,
        accountName: sales.account.name,
        debit: 0,
        credit: row.amount,
        division: row.division || record.division || record.costCenter || undefined,
      });
    }
    if (taxAmount > 0) {
      const tax = taxPayableAccount(accounts, taxAccountName);
      accounts = tax.accounts;
      lines.push({
        accountId: tax.account.id,
        accountCode: tax.account.code,
        accountName: tax.account.name,
        debit: 0,
        credit: taxAmount,
      });
    }
    const inventoryCost = inventoryCostForRecord(record);
    if (inventoryCost > 0) {
      const cogs = costOfGoodsSoldAccount(accounts);
      accounts = cogs.accounts;
      const inventory = inventoryAccount(accounts);
      accounts = inventory.accounts;
      lines.push(
        {
          accountId: cogs.account.id,
          accountCode: cogs.account.code,
          accountName: cogs.account.name,
          debit: inventoryCost,
          credit: 0,
        },
        {
          accountId: inventory.account.id,
          accountCode: inventory.account.code,
          accountName: inventory.account.name,
          debit: 0,
          credit: inventoryCost,
        },
      );
    }
    return post(
      record.reference || record.description || `Invoice ${record.party || record.customer || ""}`.trim(),
      lines,
    );
  }

  // —— Credit notes ——
  if (entityKey === "credit-notes") {
    if (!amount) return clearEmpty();
    const ar = arAccount(accounts);
    accounts = ar.accounts;
    const byAccount = basePostingRows(record, record.account || "Sales");
    const revenueTotal = Math.max(0, amount - taxAmount);
    const debitLines = alignRowsToTotal(
      byAccount.length > 0
        ? byAccount
        : [{ account: record.account || "Sales", amount: revenueTotal, division: record.division || "" }],
      revenueTotal,
    );
    const lines: {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
      division?: string;
    }[] = [
      {
        accountId: ar.account.id,
        accountCode: ar.account.code,
        accountName: ar.account.name,
        debit: 0,
        credit: amount,
        division: record.division || record.costCenter || undefined,
      },
    ];
    for (const row of debitLines) {
      const sales = incomeAccount(accounts, row.account || "Sales");
      accounts = sales.accounts;
      lines.push({
        accountId: sales.account.id,
        accountCode: sales.account.code,
        accountName: sales.account.name,
        debit: row.amount,
        credit: 0,
        division: row.division || record.division || record.costCenter || undefined,
      });
    }
    if (taxAmount > 0) {
      const tax = taxPayableAccount(accounts, taxAccountName);
      accounts = tax.accounts;
      lines.push({
        accountId: tax.account.id,
        accountCode: tax.account.code,
        accountName: tax.account.name,
        debit: taxAmount,
        credit: 0,
      });
    }
    const inventoryCost = inventoryCostForRecord(record);
    if (inventoryCost > 0) {
      const inventory = inventoryAccount(accounts);
      accounts = inventory.accounts;
      const cogs = costOfGoodsSoldAccount(accounts);
      accounts = cogs.accounts;
      lines.push(
        {
          accountId: inventory.account.id,
          accountCode: inventory.account.code,
          accountName: inventory.account.name,
          debit: inventoryCost,
          credit: 0,
        },
        {
          accountId: cogs.account.id,
          accountCode: cogs.account.code,
          accountName: cogs.account.name,
          debit: 0,
          credit: inventoryCost,
        },
      );
    }
    return post(record.reference || "Credit note", lines);
  }

  // —— Purchase invoices / bills (multi-line) ——
  if (entityKey === "purchase-invoices" || entityKey === "bills") {
    if (!amount) return clearEmpty();
    const ap = apAccountForCurrency(accounts, recordCurrency(record));
    accounts = ap.accounts;

    // Supplier opening balances: Dr Opening balances equity, Cr AP (not expense).
    if (isOpeningPayableBill(record)) {
      const equity = ensureAccount(
        accounts,
        OPENING_BALANCES_EQUITY_NAME,
        "Equity",
        "Equity",
        OPENING_BALANCES_EQUITY_CODE,
      );
      accounts = equity.accounts;
      return post(
        record.reference ||
          record.description ||
          `Opening balance ${record.party || record.supplier || ""}`.trim(),
        [
          {
            accountId: ap.account.id,
            accountCode: ap.account.code,
            accountName: ap.account.name,
            debit: 0,
            credit: amount,
            division: record.division || record.costCenter || undefined,
          },
          {
            accountId: equity.account.id,
            accountCode: equity.account.code,
            accountName: equity.account.name,
            debit: amount,
            credit: 0,
          },
        ],
      );
    }

    const byAccount = purchasePostingRows(
      record,
      record.account || record.expenseAccount || "Operating expenses",
    );
    const expenseTotal = Math.max(0, amount - taxAmount);
    const debitLines = alignRowsToTotal(
      byAccount.length > 0
        ? byAccount
        : [{
            account: record.account || record.expenseAccount || "Operating expenses",
            amount: expenseTotal,
            division: record.division || "",
          }],
      expenseTotal,
    );
    const lines: {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
      division?: string;
    }[] = [
      {
        accountId: ap.account.id,
        accountCode: ap.account.code,
        accountName: ap.account.name,
        debit: 0,
        credit: amount,
        division: record.division || record.costCenter || undefined,
      },
    ];
    for (const row of debitLines) {
      const exp = (row.account || "").toLowerCase().includes("inventory")
        ? inventoryAccount(accounts)
        : expenseAccount(accounts, row.account || "Operating expenses");
      accounts = exp.accounts;
      lines.push({
        accountId: exp.account.id,
        accountCode: exp.account.code,
        accountName: exp.account.name,
        debit: row.amount,
        credit: 0,
        division: row.division || record.division || record.costCenter || undefined,
      });
    }
    if (taxAmount > 0) {
      const tax = taxReceivableAccount(accounts, taxAccountName);
      accounts = tax.accounts;
      lines.push({
        accountId: tax.account.id,
        accountCode: tax.account.code,
        accountName: tax.account.name,
        debit: taxAmount,
        credit: 0,
      });
    }
    return post(
      record.reference || record.description || `Bill ${record.party || record.supplier || ""}`.trim(),
      lines,
    );
  }

  // —— Debit notes ——
  if (entityKey === "debit-notes") {
    if (!amount) return clearEmpty();
    const ap = apAccount(accounts);
    accounts = ap.accounts;
    const byAccount = purchasePostingRows(record, record.account || "Operating expenses");
    const expenseTotal = Math.max(0, amount - taxAmount);
    const creditLines = alignRowsToTotal(
      byAccount.length > 0
        ? byAccount
        : [{
            account: record.account || "Operating expenses",
            amount: expenseTotal,
            division: record.division || "",
          }],
      expenseTotal,
    );
    const lines: {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
      division?: string;
    }[] = [
      {
        accountId: ap.account.id,
        accountCode: ap.account.code,
        accountName: ap.account.name,
        debit: amount,
        credit: 0,
        division: record.division || record.costCenter || undefined,
      },
    ];
    for (const row of creditLines) {
      const exp = (row.account || "").toLowerCase().includes("inventory")
        ? inventoryAccount(accounts)
        : expenseAccount(accounts, row.account || "Operating expenses");
      accounts = exp.accounts;
      lines.push({
        accountId: exp.account.id,
        accountCode: exp.account.code,
        accountName: exp.account.name,
        debit: 0,
        credit: row.amount,
        division: row.division || record.division || record.costCenter || undefined,
      });
    }
    if (taxAmount > 0) {
      const tax = taxReceivableAccount(accounts, taxAccountName);
      accounts = tax.accounts;
      lines.push({
        accountId: tax.account.id,
        accountCode: tax.account.code,
        accountName: tax.account.name,
        debit: 0,
        credit: taxAmount,
      });
    }
    return post(record.reference || "Debit note", lines);
  }

  // —— Withholding tax (sales certificates & purchase WHT) ——
  if (entityKey === "withholding-tax" || entityKey === "withholding-tax-receipts") {
    if (!amount) return clearEmpty();
    let accountsLocal = accounts;
    const isSalesCert = entityKey === "withholding-tax-receipts";
    const whtAccount = isSalesCert
      ? resolve(accountsLocal, "WHT Claimable", "Asset", "Other Current Asset", "1402")
      : resolve(
          accountsLocal,
          "Withholding tax payable",
          "Liability",
          "Current liabilities",
          "2140",
        );
    accountsLocal = whtAccount.accounts;
    const contra = isSalesCert ? arAccount(accountsLocal) : apAccount(accountsLocal);
    accountsLocal = contra.accounts;
    accounts = accountsLocal;
    // Sales WHT certificate: Dr WHT Claimable, Cr AR (reduces receivable).
    // Purchase WHT: Dr AP (reduces payable), Cr WHT payable.
    return post(record.reference || record.description || "Withholding tax", [
      {
        accountId: isSalesCert ? whtAccount.account.id : contra.account.id,
        accountCode: isSalesCert ? whtAccount.account.code : contra.account.code,
        accountName: isSalesCert ? whtAccount.account.name : contra.account.name,
        debit: amount,
        credit: 0,
        division: record.division || undefined,
      },
      {
        accountId: isSalesCert ? contra.account.id : whtAccount.account.id,
        accountCode: isSalesCert ? contra.account.code : whtAccount.account.code,
        accountName: isSalesCert ? contra.account.name : whtAccount.account.name,
        debit: 0,
        credit: amount,
        division: record.division || undefined,
      },
    ]);
  }

  // —— Expense claims ——
  if (entityKey === "expense-claims") {
    if (!amount) return clearEmpty();
    const exp = expenseAccount(accounts, record.account || record.category || "Operating expenses");
    accounts = exp.accounts;
    const payable = employeeClearingAccount(accounts);
    accounts = payable.accounts;
    return post(record.description || "Expense claim", [
      {
        accountId: exp.account.id,
        accountCode: exp.account.code,
        accountName: exp.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: payable.account.id,
        accountCode: payable.account.code,
        accountName: payable.account.name,
        debit: 0,
        credit: amount,
      },
    ]);
  }

  // —— Payslips ——
  if (entityKey === "payslips") {
    const adjusted =
      baseAmount(record, parseAmount(record.adjustedBasic || record.earnings || record.amount || record.gross));
    const arrears = baseAmount(record, parseAmount(record.arrears));
    const gross = roundMoney(adjusted + arrears);
    const paye = baseAmount(record, parseAmount(record.paye));
    const nssfEmployee = baseAmount(record, parseAmount(record.nssfEmployee));
    const advances = baseAmount(record, parseAmount(record.advances));
    // Legacy: when paye/nssf not stored separately, treat deductions as PAYE only.
    const deductions = paye || nssfEmployee || advances
      ? roundMoney(paye + nssfEmployee + advances)
      : baseAmount(record, parseAmount(record.deductions));
    const nssfEmployer = baseAmount(
      record,
      parseAmount(record.nssfEmployer || record.contributions),
    );
    const net =
      baseAmount(record, parseAmount(record.netPay)) ||
      Math.max(0, roundMoney(gross - deductions));
    if (!gross && !net) return clearEmpty();
    const wageExp = expenseAccount(accounts, record.expenseAccount || "Wages & salaries");
    accounts = wageExp.accounts;
    const wagesPay = resolve(accounts, "Wages payable", "Liability", "Current liabilities", "2210");
    accounts = wagesPay.accounts;
    const lines: {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
    }[] = [
      {
        accountId: wageExp.account.id,
        accountCode: wageExp.account.code,
        accountName: wageExp.account.name,
        debit: gross || net,
        credit: 0,
      },
      {
        accountId: wagesPay.account.id,
        accountCode: wagesPay.account.code,
        accountName: wagesPay.account.name,
        debit: 0,
        credit: net,
      },
    ];
    if (paye > 0) {
      const taxPay = resolve(accounts, "PAYE payable", "Liability", "Current liabilities", "2052");
      accounts = taxPay.accounts;
      lines.push({
        accountId: taxPay.account.id,
        accountCode: taxPay.account.code,
        accountName: taxPay.account.name,
        debit: 0,
        credit: paye,
      });
    } else if (deductions > 0 && !nssfEmployee && !advances) {
      // Legacy payslips that only stored a combined deductions figure as PAYE.
      const taxPay = resolve(accounts, "PAYE payable", "Liability", "Current liabilities", "2052");
      accounts = taxPay.accounts;
      lines.push({
        accountId: taxPay.account.id,
        accountCode: taxPay.account.code,
        accountName: taxPay.account.name,
        debit: 0,
        credit: deductions,
      });
    }
    const employeeNssf = nssfEmployee || 0;
    const employerNssf = nssfEmployer || 0;
    if (employeeNssf > 0 || employerNssf > 0) {
      const nssf = resolve(accounts, "NSSF payable", "Liability", "Current liabilities", "2053");
      accounts = nssf.accounts;
      if (employeeNssf > 0) {
        lines.push({
          accountId: nssf.account.id,
          accountCode: nssf.account.code,
          accountName: nssf.account.name,
          debit: 0,
          credit: employeeNssf,
        });
      }
      if (employerNssf > 0) {
        const contribExp = expenseAccount(accounts, "Employer contributions");
        accounts = contribExp.accounts;
        lines.push(
          {
            accountId: contribExp.account.id,
            accountCode: contribExp.account.code,
            accountName: contribExp.account.name,
            debit: employerNssf,
            credit: 0,
          },
          {
            accountId: nssf.account.id,
            accountCode: nssf.account.code,
            accountName: nssf.account.name,
            debit: 0,
            credit: employerNssf,
          },
        );
      }
    }
    if (advances > 0) {
      const staffAdv = resolve(accounts, "Staff advances", "Asset", "Current assets", "1430");
      accounts = staffAdv.accounts;
      lines.push({
        accountId: staffAdv.account.id,
        accountCode: staffAdv.account.code,
        accountName: staffAdv.account.name,
        debit: 0,
        credit: advances,
      });
    }
    return post(record.reference || `Payslip ${record.employee || ""}`.trim(), lines);
  }

  // —— Statutory remittances (clear PAYE / NSSF payable when Paid) ——
  if (entityKey === "statutory-remittances") {
    if (!/^(paid|filed)$/i.test((record.status || "").trim())) {
      return clearEmpty();
    }
    const remitAmount = amount || baseAmount(record, parseAmount(record.total));
    if (!remitAmount) return clearEmpty();
    const kind = remittanceKindFromRecord(record.kind || record.name || "");
    const result = postStatutoryRemittance({
      kind,
      amount: remitAmount,
      date,
      bankAccount: record.paidFrom || record.account || record.bankAccount || "Cash at bank",
      sourceRecordId: record.id,
      narration:
        record.reference ||
        `${kind} remittance ${record.period || ""}`.trim(),
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  // —— Leave requests (release leave accrual when Paid / Approved paid leave) ——
  if (entityKey === "leave-requests") {
    const employeeName = record.employee || "";
    recomputeEmployeeLeaveBalance(employeeName);
    if (!/^(paid|approved)$/i.test((record.status || "").trim())) {
      return clearEmpty();
    }
    if (!isPaidLeaveType(record.leaveType || "")) {
      return clearEmpty();
    }
    const emp = findEmployeeByNameOrCode(employeeName);
    const days = parseAmount(record.days);
    const rate = emp ? employeeDailyRate(emp) : 0;
    if (!days || !rate) return clearEmpty();
    const leaveDate = record.startDate || record.date || date;
    const result = releaseLeaveLiability({
      employeeId: emp?.id || employeeName,
      days,
      dailyRate: rate,
      date: leaveDate,
      sourceRecordId: record.id,
      narration:
        record.reference ||
        `Leave taken · ${employeeName} · ${record.leaveType || "Leave"}`.trim(),
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  // —— Depreciation / amortization ——
  if (entityKey === "depreciation-entries" || entityKey === "amortization-entries") {
    if (!amount) return clearEmpty();
    const isAmort = entityKey === "amortization-entries";
    const exp = expenseAccount(
      accounts,
      record.account || (isAmort ? "Amortization expense" : "Depreciation expense"),
    );
    accounts = exp.accounts;
    const contra = resolve(
      accounts,
      record.contraAccount ||
        (isAmort ? "Accumulated amortization" : "Fixed assets, accumulated depreciation"),
      "Asset",
      "Non-current assets",
      isAmort ? "1520" : "1510",
    );
    accounts = contra.accounts;
    return post(record.reference || record.description || (isAmort ? "Amortization" : "Depreciation"), [
      {
        accountId: exp.account.id,
        accountCode: exp.account.code,
        accountName: exp.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: contra.account.id,
        accountCode: contra.account.code,
        accountName: contra.account.name,
        debit: 0,
        credit: amount,
      },
    ]);
  }

  // —— Inventory write-offs ——
  if (entityKey === "inventory-write-offs") {
    const qty = parseAmount(record.quantity);
    const unit = baseAmount(record, parseAmount(record.unitCost || record.cost || record.amount));
    const value = amount || roundMoney(qty * unit);
    if (!value) return clearEmpty();
    const reasonLabel = record.reasonType ? `${record.reasonType}: ` : "";
    const exp = expenseAccount(
      accounts,
      record.allocation ||
        record.account ||
        (record.reasonType === "Theft"
          ? "Inventory theft"
          : record.reasonType === "Damage"
            ? "Inventory damage"
            : record.reasonType === "Loss"
              ? "Inventory loss"
              : "Inventory write-offs"),
    );
    accounts = exp.accounts;
    const inv = resolve(accounts, "Inventory Asset", "Asset", "Other Current Asset", "1250");
    accounts = inv.accounts;
    return post(
      record.reference ||
        `${reasonLabel}${record.description || "Inventory write-off"}`.trim(),
      [
        {
          accountId: exp.account.id,
          accountCode: exp.account.code,
          accountName: exp.account.name,
          debit: value,
          credit: 0,
        },
        {
          accountId: inv.account.id,
          accountCode: inv.account.code,
          accountName: inv.account.name,
          debit: 0,
          credit: value,
        },
      ],
    );
  }

  // —— Stock in (receive inventory into a warehouse/location) ——
  if (entityKey === "stock-in" || entityKey === "pos-stock-in") {
    const qty = parseAmount(record.quantity);
    const unit = baseAmount(record, parseAmount(record.unitCost || record.cost));
    const value = amount || roundMoney(qty * unit);
    if (!value) return clearEmpty();
    const inv = inventoryAccount(accounts);
    accounts = inv.accounts;
    // Contra: goods received clearing — later matched when supplier bill is entered.
    const clearing = resolve(
      accounts,
      "Goods received not invoiced",
      "Liability",
      "Current liabilities",
      "2150",
    );
    accounts = clearing.accounts;
    return post(
      record.reference ||
        record.description ||
        (entityKey === "pos-stock-in" ? "POS stock in" : "Stock in"),
      [
      {
        accountId: inv.account.id,
        accountCode: inv.account.code,
        accountName: inv.account.name,
        debit: value,
        credit: 0,
      },
      {
        accountId: clearing.account.id,
        accountCode: clearing.account.code,
        accountName: clearing.account.name,
        debit: 0,
        credit: value,
      },
    ],
    );
  }

  // —— Inventory sales (stock out with revenue + COGS) ——
  if (entityKey === "inventory-sales") {
    const qty = parseAmount(record.quantity);
    const unitPrice = baseAmount(record, parseAmount(record.unitPrice || record.salesPrice));
    const salesAmount = amount || roundMoney(qty * unitPrice);
    if (!salesAmount) return clearEmpty();
    const ar = arAccount(accounts);
    accounts = ar.accounts;
    const sales = incomeAccount(accounts, record.account || "Sales");
    accounts = sales.accounts;
    const lines: {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
    }[] = [
      {
        accountId: ar.account.id,
        accountCode: ar.account.code,
        accountName: ar.account.name,
        debit: salesAmount,
        credit: 0,
      },
      {
        accountId: sales.account.id,
        accountCode: sales.account.code,
        accountName: sales.account.name,
        debit: 0,
        credit: salesAmount,
      },
    ];
    const inventoryCost = inventoryCostForRecord({
      ...record,
      lines: JSON.stringify([
        {
          item: record.item,
          quantity: record.quantity,
          amount: String(
            roundMoney(
              qty *
                parseAmount(
                  inventoryItemFor(record.item || "")?.averageCost ||
                    inventoryItemFor(record.item || "")?.purchasePrice ||
                    record.unitCost ||
                    "0",
                ),
            ),
          ),
        },
      ]),
    } as ManagerRecord);
    if (inventoryCost > 0) {
      const cogs = costOfGoodsSoldAccount(accounts);
      accounts = cogs.accounts;
      const inventory = inventoryAccount(accounts);
      accounts = inventory.accounts;
      lines.push(
        {
          accountId: cogs.account.id,
          accountCode: cogs.account.code,
          accountName: cogs.account.name,
          debit: inventoryCost,
          credit: 0,
        },
        {
          accountId: inventory.account.id,
          accountCode: inventory.account.code,
          accountName: inventory.account.name,
          debit: 0,
          credit: inventoryCost,
        },
      );
    }
    return post(
      record.reference ||
        record.description ||
        `Inventory sale ${record.party || record.customer || ""}`.trim(),
      lines,
    );
  }

  // —— POS sales (cash/card tender + stock out + COGS + optional VAT) ——
  if (entityKey === "pos-sales") {
    const qty = parseAmount(record.quantity);
    const unitPrice = baseAmount(record, parseAmount(record.unitPrice || record.salesPrice));
    const salesAmount = amount || roundMoney(qty * unitPrice);
    if (!salesAmount) return clearEmpty();
    const bank = bankAccount(
      accounts,
      record.account || record.bankAccount || record.register || "Cash at bank",
    );
    accounts = bank.accounts;
    const tipLine = /tip|gratuity/i.test(record.item || "") || /tip/i.test(record.salesAccount || "");
    const sales = incomeAccount(
      accounts,
      tipLine
        ? record.salesAccount || "Tips Received"
        : record.salesAccount || record.accountName || "Sales",
    );
    accounts = sales.accounts;
    const taxAmt = hasStoredTax(record)
      ? Math.max(0, baseAmount(record, parseAmount(record.taxAmount)))
      : 0;
    const netSales = Math.max(0, roundMoney(salesAmount - taxAmt));
    const lines: {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
    }[] = [
      {
        accountId: bank.account.id,
        accountCode: bank.account.code,
        accountName: bank.account.name,
        debit: salesAmount,
        credit: 0,
      },
      {
        accountId: sales.account.id,
        accountCode: sales.account.code,
        accountName: sales.account.name,
        debit: 0,
        credit: netSales,
      },
    ];
    if (taxAmt > 0) {
      const tax = taxPayableAccount(accounts, record.taxAccount);
      accounts = tax.accounts;
      lines.push({
        accountId: tax.account.id,
        accountCode: tax.account.code,
        accountName: tax.account.name,
        debit: 0,
        credit: taxAmt,
      });
    }
    const inventoryCost =
      record.lineKind === "service" ||
      record.lineKind === "open" ||
      tipLine ||
      /^no$/i.test(String(record.tracksStock || ""))
        ? 0
        : inventoryCostForRecord({
            ...record,
            lines: JSON.stringify([
              {
                item: record.item,
                quantity: record.quantity,
                amount: String(
                  roundMoney(
                    qty *
                      parseAmount(
                        inventoryItemFor(record.item || "")?.averageCost ||
                          inventoryItemFor(record.item || "")?.purchasePrice ||
                          record.unitCost ||
                          "0",
                      ),
                  ),
                ),
              },
            ]),
          } as ManagerRecord);
    if (inventoryCost > 0) {
      const cogs = costOfGoodsSoldAccount(accounts);
      accounts = cogs.accounts;
      const inventory = inventoryAccount(accounts);
      accounts = inventory.accounts;
      lines.push(
        {
          accountId: cogs.account.id,
          accountCode: cogs.account.code,
          accountName: cogs.account.name,
          debit: inventoryCost,
          credit: 0,
        },
        {
          accountId: inventory.account.id,
          accountCode: inventory.account.code,
          accountName: inventory.account.name,
          debit: 0,
          credit: inventoryCost,
        },
      );
    }
    return post(
      record.reference ||
        record.description ||
        `POS sale ${record.register || ""}`.trim(),
      lines,
    );
  }

  // —— POS returns (refund tender + stock in + reverse COGS) ——
  if (entityKey === "pos-returns") {
    const qty = parseAmount(record.quantity);
    const unitPrice = baseAmount(record, parseAmount(record.unitPrice || record.salesPrice));
    const refundAmount = amount || roundMoney(qty * unitPrice);
    if (!refundAmount) return clearEmpty();
    const bank = bankAccount(
      accounts,
      record.account || record.bankAccount || record.register || "Cash at bank",
    );
    accounts = bank.accounts;
    const sales = incomeAccount(
      accounts,
      record.salesAccount || "Sales",
    );
    accounts = sales.accounts;
    const lines: {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
    }[] = [
      {
        accountId: sales.account.id,
        accountCode: sales.account.code,
        accountName: sales.account.name,
        debit: refundAmount,
        credit: 0,
      },
      {
        accountId: bank.account.id,
        accountCode: bank.account.code,
        accountName: bank.account.name,
        debit: 0,
        credit: refundAmount,
      },
    ];
    const inventoryCost = inventoryCostForRecord({
      ...record,
      lines: JSON.stringify([
        {
          item: record.item,
          quantity: record.quantity,
          amount: String(
            roundMoney(
              qty *
                parseAmount(
                  inventoryItemFor(record.item || "")?.averageCost ||
                    inventoryItemFor(record.item || "")?.purchasePrice ||
                    record.unitCost ||
                    "0",
                ),
            ),
          ),
        },
      ]),
    } as ManagerRecord);
    if (inventoryCost > 0) {
      const cogs = costOfGoodsSoldAccount(accounts);
      accounts = cogs.accounts;
      const inventory = inventoryAccount(accounts);
      accounts = inventory.accounts;
      lines.push(
        {
          accountId: inventory.account.id,
          accountCode: inventory.account.code,
          accountName: inventory.account.name,
          debit: inventoryCost,
          credit: 0,
        },
        {
          accountId: cogs.account.id,
          accountCode: cogs.account.code,
          accountName: cogs.account.name,
          debit: 0,
          credit: inventoryCost,
        },
      );
    }
    return post(
      record.reference ||
        record.description ||
        `POS return ${record.register || ""}`.trim(),
      lines,
    );
  }

  // —— Fleet fuel logs (Dr Fuel Expense / Cr Bank or Cash) ——
  if (entityKey === "fuel-logs") {
    if (!amount) return clearEmpty();
    const exp = expenseAccount(accounts, record.expenseAccount || "Fuel Expense");
    accounts = exp.accounts;
    const bank = bankAccount(
      accounts,
      record.bankAccount || record.paidFrom || record.account || "Cash-UGX",
    );
    accounts = bank.accounts;
    return post(
      record.reference ||
        `Fuel ${record.vehicle || ""} ${record.litres || ""}L`.trim(),
      [
        {
          accountId: exp.account.id,
          accountCode: exp.account.code,
          accountName: exp.account.name,
          debit: amount,
          credit: 0,
          division: record.division || record.department || undefined,
        },
        {
          accountId: bank.account.id,
          accountCode: bank.account.code,
          accountName: bank.account.name,
          debit: 0,
          credit: amount,
          division: record.division || record.department || undefined,
        },
      ],
    );
  }

  // —— Fleet maintenance (when Completed — Dr Motor Vehicle Expense / Cr Bank or AP) ——
  if (entityKey === "maintenance-requests") {
    const cost =
      amount ||
      baseAmount(record, parseAmount(record.actualCost || record.estimatedCost));
    if (!cost) return clearEmpty();
    if (!/completed|posted|approved/i.test(record.status || "")) {
      return clearEmpty();
    }
    const exp = expenseAccount(
      accounts,
      record.expenseAccount || "Motor Vehicle Expense",
    );
    accounts = exp.accounts;
    const creditName = (record.bankAccount || record.account || "").trim();
    if (creditName) {
      const bank = bankAccount(accounts, creditName);
      accounts = bank.accounts;
      return post(
        record.reference ||
          record.description ||
          `Maintenance ${record.vehicle || ""}`.trim(),
        [
          {
            accountId: exp.account.id,
            accountCode: exp.account.code,
            accountName: exp.account.name,
            debit: cost,
            credit: 0,
            division: record.division || undefined,
          },
          {
            accountId: bank.account.id,
            accountCode: bank.account.code,
            accountName: bank.account.name,
            debit: 0,
            credit: cost,
            division: record.division || undefined,
          },
        ],
      );
    }
    const ap = apAccount(accounts);
    accounts = ap.accounts;
    return post(
      record.reference ||
        record.description ||
        `Maintenance ${record.vehicle || ""}`.trim(),
      [
        {
          accountId: exp.account.id,
          accountCode: exp.account.code,
          accountName: exp.account.name,
          debit: cost,
          credit: 0,
          division: record.division || undefined,
        },
        {
          accountId: ap.account.id,
          accountCode: ap.account.code,
          accountName: ap.account.name,
          debit: 0,
          credit: cost,
          division: record.division || undefined,
        },
      ],
    );
  }

  // —— POS cash session close (till over/short) ——
  if (entityKey === "cash-sessions") {
    const variance = baseAmount(record, parseAmount(record.variance));
    if (!variance || !/closed|reconciled|posted/i.test(record.status || "")) {
      return clearEmpty();
    }
    const till = bankAccount(
      accounts,
      record.registerAccount || record.account || record.register || "Cash-UGX",
    );
    accounts = till.accounts;
    const overShort = expenseAccount(accounts, "Cash Over/Short");
    accounts = overShort.accounts;
    if (variance > 0) {
      // Over: Dr Till / Cr Cash over/short
      return post(`Till over ${record.reference || ""}`.trim(), [
        {
          accountId: till.account.id,
          accountCode: till.account.code,
          accountName: till.account.name,
          debit: variance,
          credit: 0,
        },
        {
          accountId: overShort.account.id,
          accountCode: overShort.account.code,
          accountName: overShort.account.name,
          debit: 0,
          credit: variance,
        },
      ]);
    }
    const abs = Math.abs(variance);
    return post(`Till short ${record.reference || ""}`.trim(), [
      {
        accountId: overShort.account.id,
        accountCode: overShort.account.code,
        accountName: overShort.account.name,
        debit: abs,
        credit: 0,
      },
      {
        accountId: till.account.id,
        accountCode: till.account.code,
        accountName: till.account.name,
        debit: 0,
        credit: abs,
      },
    ]);
  }

  // —— POS daily closing (optional bank deposit of cash sales) ——
  if (entityKey === "daily-closings") {
    const deposit = baseAmount(
      record,
      parseAmount(record.bankDeposit || record.cashDeposit || "0"),
    );
    if (!deposit || !/closed|posted/i.test(record.status || "")) {
      return clearEmpty();
    }
    const bank = bankAccount(accounts, record.depositTo || record.bankAccount || "Bank-UGX");
    accounts = bank.accounts;
    const till = bankAccount(
      accounts,
      record.registerAccount || record.register || "Cash-UGX",
    );
    accounts = till.accounts;
    return post(
      record.reference || `Daily closing deposit ${record.register || ""}`.trim(),
      [
        {
          accountId: bank.account.id,
          accountCode: bank.account.code,
          accountName: bank.account.name,
          debit: deposit,
          credit: 0,
        },
        {
          accountId: till.account.id,
          accountCode: till.account.code,
          accountName: till.account.name,
          debit: 0,
          credit: deposit,
        },
      ],
    );
  }

  // —— Project expenses ——
  if (entityKey === "project-expenses") {
    if (!amount) return clearEmpty();
    const expense = expenseAccount(
      accounts,
      record.expenseAccount || record.account || "Operating expenses",
    );
    accounts = expense.accounts;
    const creditSide = bankAccount(
      accounts,
      record.paidFrom || record.bankAccount || "Cash at bank",
    );
    accounts = creditSide.accounts;
    return post(
      record.reference ||
        record.description ||
        `Project expense ${record.project || ""}`.trim(),
      [
        {
          accountId: expense.account.id,
          accountCode: expense.account.code,
          accountName: expense.account.name,
          debit: amount,
          credit: 0,
        },
        {
          accountId: creditSide.account.id,
          accountCode: creditSide.account.code,
          accountName: creditSide.account.name,
          debit: 0,
          credit: amount,
        },
      ],
    );
  }

  // —— Project billings ——
  if (entityKey === "project-billings") {
    if (!amount) return clearEmpty();
    const ar = arAccount(accounts);
    accounts = ar.accounts;
    const income = incomeAccount(
      accounts,
      record.incomeAccount || record.account || "Sales",
    );
    accounts = income.accounts;
    return post(
      record.reference ||
        record.description ||
        `Project billing ${record.project || ""}`.trim(),
      [
        {
          accountId: ar.account.id,
          accountCode: ar.account.code,
          accountName: ar.account.name,
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
    );
  }

  // —— Late payment fees ——
  if (entityKey === "late-payment-fees") {
    if (!amount) return clearEmpty();
    const ar = arAccount(accounts);
    accounts = ar.accounts;
    const income = incomeAccount(accounts, record.account || "Late payment fees");
    accounts = income.accounts;
    return post(record.reference || "Late payment fee", [
      {
        accountId: ar.account.id,
        accountCode: ar.account.code,
        accountName: ar.account.name,
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
    ]);
  }

  // —— Leases (IFRS 16) ——
  if (entityKey === "leases") {
    return capitalizeLease(record);
  }

  // —— Revenue contracts (IFRS 15) ——
  if (entityKey === "revenue-contracts") {
    if (/liability|deferred|advance/i.test(record.kind || record.type || "")) {
      return postContractLiability({
        contractId: record.id,
        date,
        amount,
        bankAccount: record.bankAccount,
      });
    }
    const poc = recognizePercentComplete(record, date);
    return poc.ok ? { ok: true } : poc;
  }

  // —— IAS 37 provisions ——
  if (entityKey === "provisions") {
    if (!amount) return clearEmpty();
    return raiseProvision({
      name: record.name || record.reference || "Provision",
      amount,
      date,
      expenseAccount: record.account,
      sourceRecordId: record.id,
      kind: (record.kind as "warranty" | "legal" | "restructuring" | "other") || "other",
    });
  }

  // —— Share-based payments (IFRS 2) ——
  if (entityKey === "share-based-payments") {
    if (!amount) return clearEmpty();
    return postShareBasedPayment({ date, amount, sourceRecordId: record.id });
  }

  // —— Fixed assets (capitalize at historical cost) ——
  if (entityKey === "fixed-assets") {
    return postFixedAssetCapitalization(record);
  }

  if (entityKey === "intangible-assets") {
    const cost = baseAmount(record, parseAmount(record.cost || record.amount));
    if (!cost) return clearEmpty();
    const opening = /opening/i.test(record.entryType || record.balanceType || "");
    const accum = roundMoney(
      Math.min(
        cost,
        Math.max(0, baseAmount(record, parseAmount(record.accumulatedAmortization))),
      ),
    );
    const net = roundMoney(Math.max(0, cost - accum));
    const asset = resolve(
      accounts,
      record.assetAccount || record.category || "Intangible assets",
      "Asset",
      "Non-current assets",
      "1530",
    );
    accounts = asset.accounts;
    const lines: {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
    }[] = [
      {
        accountId: asset.account.id,
        accountCode: asset.account.code,
        accountName: asset.account.name,
        debit: cost,
        credit: 0,
      },
    ];
    if (opening) {
      if (accum > 0) {
        const accumAcc = resolve(
          accounts,
          record.accumulatedAmortizationAccount || "Accumulated Amortization",
          "Asset",
          "Non-current assets",
          "1539",
        );
        accounts = accumAcc.accounts;
        lines.push({
          accountId: accumAcc.account.id,
          accountCode: accumAcc.account.code,
          accountName: accumAcc.account.name,
          debit: 0,
          credit: accum,
        });
      }
      const equity = resolve(
        accounts,
        OPENING_BALANCES_EQUITY_NAME,
        "Equity",
        "Equity",
        OPENING_BALANCES_EQUITY_CODE,
      );
      accounts = equity.accounts;
      if (net > 0) {
        lines.push({
          accountId: equity.account.id,
          accountCode: equity.account.code,
          accountName: equity.account.name,
          debit: 0,
          credit: net,
        });
      }
    } else {
      const bank = bankAccount(accounts, record.paidFrom || record.account || "Cash at bank");
      accounts = bank.accounts;
      lines.push({
        accountId: bank.account.id,
        accountCode: bank.account.code,
        accountName: bank.account.name,
        debit: 0,
        credit: cost,
      });
    }
    saveChartOfAccounts(accounts);
    return post(record.name || record.reference || (opening ? "Intangible opening balance" : "Intangible asset"), lines);
  }

  // —— Investments ——
  if (entityKey === "investments") {
    const cost = baseAmount(record, parseAmount(record.cost || record.amount || record.marketValue));
    if (!cost) return clearEmpty();
    const inv = resolve(accounts, record.account || "Investments", "Asset", "Non-current assets", "1600");
    accounts = inv.accounts;
    const bank = bankAccount(accounts, record.paidFrom || "Cash at bank");
    accounts = bank.accounts;
    return post(record.name || record.reference || "Investment purchase", [
      {
        accountId: inv.account.id,
        accountCode: inv.account.code,
        accountName: inv.account.name,
        debit: cost,
        credit: 0,
      },
      {
        accountId: bank.account.id,
        accountCode: bank.account.code,
        accountName: bank.account.name,
        debit: 0,
        credit: cost,
      },
    ]);
  }

  // —— Capital accounts (owner equity contributions / drawings) ——
  if (entityKey === "capital-accounts" || entityKey === "capital-subaccounts") {
    const contribution = baseAmount(
      record,
      parseAmount(record.contribution || record.amount || record.openingBalance),
    );
    if (!contribution) return clearEmpty();
    const equity = resolve(
      accounts,
      record.name || record.account || "Owner's equity",
      "Equity",
      "Equity",
      "3000",
    );
    accounts = equity.accounts;
    const bank = bankAccount(accounts, record.bankAccount || "Cash at bank");
    accounts = bank.accounts;
    const isDrawing = /drawing|withdraw/i.test(record.type || record.kind || "") || contribution < 0;
    const abs = Math.abs(contribution);
    return post(record.reference || record.name || "Capital movement", [
      {
        accountId: isDrawing ? equity.account.id : bank.account.id,
        accountCode: isDrawing ? equity.account.code : bank.account.code,
        accountName: isDrawing ? equity.account.name : bank.account.name,
        debit: abs,
        credit: 0,
      },
      {
        accountId: isDrawing ? bank.account.id : equity.account.id,
        accountCode: isDrawing ? bank.account.code : equity.account.code,
        accountName: isDrawing ? bank.account.name : equity.account.name,
        debit: 0,
        credit: abs,
      },
    ]);
  }

  // —— Matching: prepaid / deferred / accruals ——
  if (entityKey === "matching-entries" || entityKey === "accruals-and-prepayments") {
    const kind = (record.kind || record.type || "prepaid-expense") as
      | "prepaid-expense"
      | "accrued-expense"
      | "deferred-revenue"
      | "accrued-revenue";
    if (!amount) return clearEmpty();
    return postMatchingEntry({
      kind,
      date,
      amount,
      description: record.description || record.reference || kind,
      sourceRecordId: record.id,
      contraAccount: record.account || record.contraAccount,
    });
  }

  // —— Production orders / inventory kits (transfer component cost → finished goods) ——
  if (entityKey === "production-orders" || entityKey === "inventory-kits") {
    const finishedValue = baseAmount(
      record,
      parseAmount(record.finishedValue || record.amount || record.cost),
    );
    if (!finishedValue) return clearEmpty();
    // No P&L impact: Dr finished inventory / Cr WIP or component inventory (same control).
    const inv = inventoryAccount(accounts);
    accounts = inv.accounts;
    // Neutral reclass within inventory — use WIP clearing if provided.
    const wip = resolve(accounts, record.wipAccount || "Work in progress", "Asset", "Current assets", "1310");
    accounts = wip.accounts;
    return post(record.reference || record.name || "Production / kit", [
      {
        accountId: inv.account.id,
        accountCode: inv.account.code,
        accountName: inv.account.name,
        debit: finishedValue,
        credit: 0,
      },
      {
        accountId: wip.account.id,
        accountCode: wip.account.code,
        accountName: wip.account.name,
        debit: 0,
        credit: finishedValue,
      },
    ]);
  }

  // —— Billable time / expenses (accrue until invoiced — matching principle) ——
  if (entityKey === "billable-time" || entityKey === "billable-expenses") {
    if (!amount) return clearEmpty();
    if (/invoiced|billed/i.test(record.status || "")) {
      // Recognition moved to the sales invoice; clear accrual.
      removePostingsForSource(record.id);
      return { ok: true };
    }
    const ar = resolve(accounts, "Accrued receivables", "Asset", "Current assets", "1210");
    accounts = ar.accounts;
    const income = incomeAccount(accounts, record.account || "Sales");
    accounts = income.accounts;
    return post(record.reference || record.description || "Billable accrual", [
      {
        accountId: ar.account.id,
        accountCode: ar.account.code,
        accountName: ar.account.name,
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
    ]);
  }

  // —— Bank / cash: store opening on CoA, then rebuild dual-entry openings ——
  if (entityKey === "bank-and-cash-accounts" || entityKey === "bank-accounts" || entityKey === "cash-accounts") {
    // Opening balances are entered in the account's own currency; the chart of
    // accounts is kept in base currency so the balance sheet stays consistent.
    const opening = convertToBase(
      parseAmount(record.openingBalance),
      record.currency || record.currencyCode,
      record.openingBalanceDate || record.date,
    );
    const ledgerName =
      record.glAccount || record.name || record.account || "Cash at bank";
    const bank = bankAccount(accounts, ledgerName);
    accounts = bank.accounts.map((a) =>
      a.id === bank.account.id ? { ...a, openingBalance: opening } : a,
    );
    saveChartOfAccounts(accounts);
    const rebuilt = rebuildOpeningBalanceEntry();
    return rebuilt.ok ? { ok: true } : { ok: false, error: rebuilt.error };
  }

  // Unhandled entities: no ledger impact
  return { ok: true };
}

export function unsyncRecordFromLedger(recordId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const reversed = reverseSourceEntry({
    sourceRecordId: recordId,
    reverseDate: today,
    narration: `Deleted ${recordId.slice(0, 8)}`,
  });
  if (!reversed.ok) {
    // Fallback if nothing to reverse (draft never posted).
    removePostingsForSource(recordId);
    removePostingsForSource(`rev-${recordId}`);
  }
}

/**
 * Fully delete Chart of Accounts rows: remove from CoA store, strip their
 * ledger lines (including opening-balance postings), then rebuild openings.
 */
export function deleteChartOfAccountsRecords(
  records: ManagerRecord[],
): { removed: number } {
  if (!records.length) return { removed: 0 };
  const ids = records.map((r) => r.id);
  const codes = records.map((r) => r.code || "").filter(Boolean);
  const names = records.map((r) => r.name || "").filter(Boolean);
  const { removed } = removeChartAccounts({ ids, codes, names });
  if (removed.length) {
    const removedIds = new Set(removed.map((a) => a.id));
    const removedCodes = new Set(removed.map((a) => a.code.toLowerCase()));
    const removedNames = new Set(removed.map((a) => a.name.toLowerCase()));
    const lines = loadLedgerLines().filter((line) => {
      if (removedIds.has(line.accountId)) return false;
      if (removedCodes.has((line.accountCode || "").toLowerCase())) return false;
      if (removedNames.has((line.accountName || "").toLowerCase())) return false;
      return true;
    });
    saveLedgerLines(lines);
  }
  rebuildOpeningBalanceEntry();
  return { removed: removed.length };
}
