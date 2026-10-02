import { documentLinesFromRecord, journalLinesFromRecord, journalLinesTotals } from "@/lib/document-lines";
import { openInvoiceOptions, parseAllocationParts } from "@/lib/ar-ap";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import {
  baseCurrencyCode,
  hasExchangeRate,
  isBaseCurrency,
  recordCurrency,
  recordFxDate,
  recordToBase,
} from "@/lib/ledger/fx";
import { loadLedgerLines } from "@/lib/ledger/posting";
import { normalizeToIsoDate } from "@/lib/data-import";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadManagerSettings } from "@/lib/manager-settings";
import { loadRecords } from "@/lib/records-store";
import { assertPaymentRequestStatusChange } from "@/lib/payment-approval-chain";
import { assertOralPaymentRequestStatusChange } from "@/lib/oral-payment-approval-chain";
import { assertPayrollRunStatusChange } from "@/lib/payroll-run-chain";
import { assertGenericRequisitionStatusChange } from "@/lib/generic-requisition-chain";

const POSTING_ENTITIES = new Set([
  "sales-invoices",
  "invoices",
  "purchase-invoices",
  "bills",
  "credit-notes",
  "debit-notes",
  "receipts",
  "payments",
  "inter-account-transfers",
  "journal-entries",
  "recurring-journal-entries",
  "expense-claims",
  "payslips",
  "statutory-remittances",
  "leave-requests",
  "depreciation-entries",
  "amortization-entries",
  "inventory-write-offs",
  "late-payment-fees",
  "fixed-assets",
  "intangible-assets",
  "investments",
  "matching-entries",
  "accruals-and-prepayments",
  "production-orders",
  "inventory-kits",
]);

function nonPostingStatus(record: ManagerRecord) {
  return /^(draft|void|voided|cancelled|canceled|inactive)$/i.test((record.status || "").trim());
}

function transactionDate(record: ManagerRecord) {
  const raw =
    record.date ||
    record.issueDate ||
    record.startDate ||
    record.nextIssueDate ||
    record.asOf ||
    record.acquired ||
    record.purchaseDate ||
    record.commencementDate ||
    "";
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  // Prefer ISO normalization so CSV imports (DD/MM/YYYY, Excel serials, etc.) still post.
  return normalizeToIsoDate(trimmed) || trimmed.slice(0, 10);
}

function validIsoDate(value: string) {
  const day = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00`));
}

function sameAllocation(left: string | undefined, right: string | undefined) {
  return (left || "").trim().toLowerCase() === (right || "").trim().toLowerCase();
}

/** The currency a named bank / cash account is denominated in. */
function bankAccountCurrency(accountName: string): string | null {
  const key = (accountName || "").trim().toLowerCase();
  if (!key) return null;
  const match = loadRecords("banking", "bank-and-cash-accounts").find(
    (candidate) => (candidate.name || candidate.account || "").trim().toLowerCase() === key,
  );
  if (match) {
    const currency = (match.currency || "").trim();
    return currency ? currency.toUpperCase() : null;
  }
  // CoA bank/cash fallback when Bank & Cash Accounts is empty.
  const coa = loadRecords("accounts", "chart-of-accounts").find((candidate) => {
    const name = (candidate.name || "").trim().toLowerCase();
    const code = (candidate.code || "").trim().toLowerCase();
    return name === key || code === key;
  });
  if (!coa) return null;
  const currency = (coa.currency || "").trim();
  return currency ? currency.toUpperCase() : null;
}

/**
 * Foreign-currency controls. A document may only post when its currency can be
 * translated into the base currency, and cash must move through an account held
 * in that same currency — otherwise the ledger silently books an FX error.
 */
function validateCurrency(entityKey: string, record: ManagerRecord): string | null {
  const currency = recordCurrency(record);
  const base = baseCurrencyCode();

  if (!isBaseCurrency(currency) && !hasExchangeRate(currency, recordFxDate(record))) {
    return `No exchange rate for ${currency}. Add one under Settings → Exchange rates before posting, otherwise it would post 1:1 against ${base}.`;
  }

  if (entityKey === "receipts" || entityKey === "payments") {
    const accountCurrency = bankAccountCurrency(record.account || record.bankAccount || "");
    if (accountCurrency && accountCurrency !== currency) {
      return `This ${
        entityKey === "receipts" ? "receipt" : "payment"
      } is in ${currency} but “${record.account || record.bankAccount}” is a ${accountCurrency} account. Use a ${currency} account or record the amount in ${accountCurrency}.`;
    }
  }

  if (entityKey === "inter-account-transfers") {
    const fromCurrency = bankAccountCurrency(record.from || record.fromAccount || "");
    const toCurrency = bankAccountCurrency(record.to || record.toAccount || "");
    if (fromCurrency && toCurrency && fromCurrency !== toCurrency) {
      return `Cross-currency transfers (${fromCurrency} → ${toCurrency}) are not supported here. Record a payment out and a receipt in, so the exchange difference is posted.`;
    }
  }

  return null;
}

/**
 * Central pre-save accounting controls. Returning an error blocks persistence,
 * inventory movement, and general-ledger posting as one transaction.
 */
export function validateAccountingRecord(input: {
  moduleSlug: string;
  entityKey: string;
  record: ManagerRecord;
  previous?: ManagerRecord | null;
}): string | null {
  const { moduleSlug, entityKey, record, previous } = input;

  if (entityKey === "payment-requests" && previous) {
    const statusBlock = assertPaymentRequestStatusChange(previous.status, record.status || "");
    if (statusBlock) return statusBlock;
  }

  if (entityKey === "oral-payment-requests" && previous) {
    const statusBlock = assertOralPaymentRequestStatusChange(
      previous.status,
      record.status || "",
    );
    if (statusBlock) return statusBlock;
  }

  if (entityKey === "payroll-runs" && previous) {
    const statusBlock = assertPayrollRunStatusChange(
      previous.status,
      record.status || "",
    );
    if (statusBlock) return statusBlock;
  }

  if (
    (entityKey === "requisitions" ||
      entityKey === "general-requests" ||
      entityKey === "fuel-requests" ||
      entityKey === "trip-requests" ||
      entityKey === "maintenance-requests" ||
      entityKey === "equipment-and-vehicle-requests" ||
      entityKey === "document-requests" ||
      entityKey === "leave-requests") &&
    previous
  ) {
    const statusBlock = assertGenericRequisitionStatusChange(
      entityKey,
      previous.status,
      record.status || "",
      record,
    );
    if (statusBlock) return statusBlock;
  }

  if (entityKey === "chart-of-accounts" && (record.kind || "Account") !== "Group") {
    const code = (record.code || "").trim().toLowerCase();
    const name = (record.name || "").trim().toLowerCase();
    if (!name) return "Account name is required.";
    const duplicate = loadRecords(moduleSlug, entityKey).find(
      (candidate) =>
        candidate.id !== record.id &&
        (candidate.kind || "Account") !== "Group" &&
        ((code && (candidate.code || "").trim().toLowerCase() === code) ||
          (candidate.name || "").trim().toLowerCase() === name),
    );
    if (duplicate) return "Account codes and names must be unique.";

    if (
      previous &&
      (previous.code !== record.code ||
        previous.name !== record.name ||
        previous.type !== record.type)
    ) {
      const hasPostings = loadLedgerLines().some(
        (line) =>
          line.accountId === previous.id ||
          line.accountCode === previous.code ||
          line.accountName.toLowerCase() === (previous.name || "").toLowerCase(),
      );
      if (hasPostings) {
        return "An account with ledger activity cannot have its code, name, or type changed.";
      }
    }
    return null;
  }

  if (!POSTING_ENTITIES.has(entityKey) || nonPostingStatus(record)) return null;

  // Immutable posted documents: material changes require void / draft first.
  if (
    previous &&
    !nonPostingStatus(previous) &&
    loadManagerSettings().requireApprovalToPost
  ) {
    const material =
      parseAmount(previous.amount || previous.total) !== parseAmount(record.amount || record.total) ||
      (previous.date || previous.issueDate) !== (record.date || record.issueDate) ||
      previous.appliedTo !== record.appliedTo ||
      JSON.stringify(documentLinesFromRecord(previous)) !==
        JSON.stringify(documentLinesFromRecord(record));
    if (material && !nonPostingStatus(record) && !/void|voided/i.test(record.status || "")) {
      return "Posted documents are immutable under approval controls. Set status to Draft or Void, then re-enter.";
    }
  }

  const date = transactionDate(record);
  if (!date || !validIsoDate(date)) {
    return "A valid transaction date is required before this record can be posted.";
  }

  const amount = parseAmount(record.amount || record.total || record.balance);
  if (amount < 0) {
    return "Transaction amounts cannot be negative. Use the appropriate credit/debit note or reversal.";
  }

  const currencyError = validateCurrency(entityKey, record);
  if (currencyError) return currencyError;

  const reference = (record.reference || "").trim().toLowerCase();
  if (reference) {
    const duplicate = loadRecords(moduleSlug, entityKey).some(
      (candidate) =>
        candidate.id !== record.id &&
        (candidate.reference || "").trim().toLowerCase() === reference &&
        !/void|voided|cancelled|canceled/i.test(candidate.status || ""),
    );
    if (duplicate) return `Reference “${record.reference}” is already in use.`;
  }

  if (entityKey === "journal-entries" || entityKey === "recurring-journal-entries") {
    const lines = journalLinesFromRecord(record);
    for (const [index, line] of lines.entries()) {
      const debit = parseAmount(line.debit);
      const credit = parseAmount(line.credit);
      if (!debit && !credit) continue;
      if (!line.account.trim()) return `Journal line ${index + 1} needs an account.`;
      if (debit < 0 || credit < 0) return `Journal line ${index + 1} cannot be negative.`;
      if (debit > 0 && credit > 0) {
        return `Journal line ${index + 1} cannot contain both a debit and a credit.`;
      }
    }
    const { debit, credit, balanced } = journalLinesTotals(lines);
    if (debit > 0 || credit > 0) {
      if (!balanced) {
        return `Journal entry is out of balance. Debits ${debit} ≠ Credits ${credit}.`;
      }
    }
  }

  if (
    ["sales-invoices", "invoices", "purchase-invoices", "bills", "credit-notes", "debit-notes"].includes(
      entityKey,
    )
  ) {
    const lines = documentLinesFromRecord(record);
    if (!lines.some((line) => parseAmount(line.amount) > 0)) {
      return "At least one line item with a positive amount is required.";
    }
    for (const [index, line] of lines.entries()) {
      if (parseAmount(line.quantity) < 0 || parseAmount(line.unitPrice) < 0) {
        return `Line ${index + 1} cannot have a negative quantity or unit price.`;
      }
      if (line.discountType === "percent" && parseAmount(line.discount) > 100) {
        return `Line ${index + 1} discount cannot exceed 100%.`;
      }
    }
  }

  if ((entityKey === "receipts" || entityKey === "payments") && (record.appliedTo?.trim() || record.allocations)) {
    if (amount <= 0) return "An allocated receipt or payment must have a positive amount.";
    const side = entityKey === "receipts" ? "receivable" : "payable";
    // Open balances are held in base currency — compare like with like.
    const amountBase = recordToBase(record, amount);
    const parts = parseAllocationParts(record);
    if (parts.length) {
      const partsTotal = roundMoney(parts.reduce((s, p) => s + p.amount, 0));
      if (partsTotal > amount) {
        return `Allocation lines (${partsTotal}) exceed the receipt/payment amount (${amount}).`;
      }
      for (const part of parts) {
        const target = openInvoiceOptions(side).find((option) => {
          const key = part.document.trim().toLowerCase();
          return (
            option.id.toLowerCase() === key ||
            option.reference.toLowerCase() === key ||
            option.label.toLowerCase() === key
          );
        });
        if (!target) return `Allocated document “${part.document}” is not open or cannot be found.`;
        const partBase = recordToBase(record, part.amount);
        if (partBase > target.balance + 0.0001) {
          return `Allocation to ${part.document} exceeds its open balance of ${target.balance} ${baseCurrencyCode()}.`;
        }
      }
    } else if (record.appliedTo?.trim()) {
      const target = openInvoiceOptions(side).find((option) => {
        const key = record.appliedTo!.trim().toLowerCase();
        return (
          option.id.toLowerCase() === key ||
          option.reference.toLowerCase() === key ||
          option.label.toLowerCase() === key
        );
      });
      if (!target) return "The selected invoice is no longer open or cannot be found.";
      const previousAmount =
        previous && sameAllocation(previous.appliedTo, record.appliedTo)
          ? recordToBase(previous, parseAmount(previous.amount))
          : 0;
      const available = roundMoney(target.balance + previousAmount);
      if (amountBase > available) {
        return `Allocation exceeds the open balance of ${available} ${baseCurrencyCode()}.`;
      }
    }
  }

  if (entityKey === "inter-account-transfers") {
    const from = (record.from || record.fromAccount || "").trim().toLowerCase();
    const to = (record.to || record.toAccount || "").trim().toLowerCase();
    if (from && to && from === to) return "Transfer-from and transfer-to accounts must be different.";
  }

  return null;
}

export function validateAccountDeletion(record: ManagerRecord): string | null {
  if ((record.kind || "Account") === "Group") {
    const name = (record.name || "").trim().toLowerCase();
    const hasChildren = loadRecords("accounts", "chart-of-accounts").some(
      (candidate) =>
        candidate.id !== record.id &&
        [(candidate.group || "").trim(), (candidate.parentGroup || "").trim()]
          .map((value) => value.toLowerCase())
          .includes(name),
    );
    return hasChildren
      ? `Group “${record.name}” contains accounts or subgroups and cannot be deleted.`
      : null;
  }
  const used = loadLedgerLines().some(
    (line) =>
      line.accountId === record.id ||
      line.accountCode === record.code ||
      line.accountName.toLowerCase() === (record.name || "").toLowerCase(),
  );
  return used
    ? `Account “${record.name || record.code}” has ledger activity and cannot be deleted. Mark it inactive instead.`
    : null;
}
