/**
 * Documents held off the ledger until approved (Draft / Pending / Awaiting approval).
 * Surfaced on report drill-downs so reviewers see what is still missing from figures.
 */
import { REQUIRED_ACCOUNTING_DOCUMENTS } from "@/lib/accounting-documents";
import { hrefForSourceDocument } from "@/lib/module-data";
import type { ManagerRecord } from "@/lib/manager-entities";
import { parseAmount } from "@/lib/ledger/types";
import { loadRecords } from "@/lib/records-store";

export type PendingApprovalDoc = {
  id: string;
  reference: string;
  date: string;
  amount: number;
  status: string;
  label: string;
  entityKey: string;
  module: string;
  href: string;
};

const PENDING_STATUS =
  /^(draft|pending|submitted|awaiting approval|unapproved)$/i;

/** True when status keeps the document off the ledger pending approval. */
export function isPendingApprovalStatus(status: string | undefined): boolean {
  return PENDING_STATUS.test((status || "").trim());
}

function recordTouchesAccount(record: ManagerRecord, accountHint: string): boolean {
  const hint = accountHint.trim().toLowerCase();
  if (!hint) return true;
  const haystack = [
    record.account,
    record.bankAccount,
    record.glAccount,
    record.from,
    record.to,
    record.fromAccount,
    record.toAccount,
    record.debitAccount,
    record.creditAccount,
    record.expenseAccount,
    record.incomeAccount,
    record.inventoryAccount,
    record.lines,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(hint);
}

/** List source documents awaiting approval (optionally filtered to an account). */
export function listPendingApprovalDocuments(accountHint?: string): PendingApprovalDoc[] {
  if (typeof window === "undefined") return [];
  const out: PendingApprovalDoc[] = [];
  const seen = new Set<string>();

  for (const doc of REQUIRED_ACCOUNTING_DOCUMENTS) {
    if (doc.module === "reports") continue;
    const moduleSlug = doc.storageModule || doc.module;
    const rows = loadRecords(moduleSlug, doc.entityKey);
    for (const record of rows) {
      if (!isPendingApprovalStatus(record.status)) continue;
      if (accountHint && !recordTouchesAccount(record, accountHint)) continue;
      const key = `${moduleSlug}:${doc.entityKey}:${record.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const reference =
        String(record.reference || record.name || record.code || "").trim() || String(record.id || "").slice(0, 10);
      out.push({
        id: record.id,
        reference,
        date: record.date || record.issueDate || "",
        amount: parseAmount(record.amount || record.total || record.netPay || "0"),
        status: String(record.status || "Pending").trim(),
        label: doc.label,
        entityKey: doc.entityKey,
        module: moduleSlug,
        href: hrefForSourceDocument(moduleSlug, doc.entityKey, reference),
      });
    }
  }

  return out.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.reference.localeCompare(b.reference));
}
