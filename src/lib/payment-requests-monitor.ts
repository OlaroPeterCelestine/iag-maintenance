/**
 * Cross-cutting payment requests: project/finance queue fed from invoices,
 * bills, and project documents for Finance approval.
 */
import { hrefForRecordDetail, hrefForSourceDocument } from "@/lib/module-data";
import type { ManagerRecord } from "@/lib/manager-entities";
import { parseAmount } from "@/lib/ledger/types";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";
import { isPendingApprovalStatus } from "@/lib/pending-approvals";
import { nextDocumentReference } from "@/lib/document-references";
import { getCurrentSessionUser } from "@/lib/session-profile";
import {
  assertPaymentRequestStatusChange,
  paymentChainWaitingOn,
} from "@/lib/payment-approval-chain";
import { notifyRequestParties } from "@/lib/export/notify-request-email";

export const PAYMENT_REQUESTS_MODULE = "projects";
export const PAYMENT_REQUESTS_ENTITY = "payment-requests";

/** Documents that can raise a payment request for Finance. */
export const PAYMENT_REQUEST_SOURCE_ENTITIES = new Set([
  "purchase-invoices",
  "purchase-orders",
  "debit-notes",
  "progress-certificates",
  "project-expenses",
  "requisitions",
  "milestones",
  "payment-requests",
  "expense-claims",
  "sales-invoices",
  "credit-notes",
]);

export type PaymentRequestMonitorRow = {
  id: string;
  reference: string;
  date: string;
  dueDate: string;
  department: string;
  project: string;
  payTo: string;
  payee: string;
  contractor: string;
  amount: number;
  currency: string;
  status: string;
  description: string;
  href: string;
  overdue: boolean;
  awaiting: boolean;
  waitingOn: string;
  sourceLabel: string;
  sourceRef: string;
  sourceHref: string;
  /** Chained entity key when this row is on the multi-type approval desk. */
  entityKey?: string;
};

export type PaymentRequestBucket =
  | "all"
  | "awaiting"
  | "approved"
  | "paid"
  | "rejected"
  | "overdue";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function canRaisePaymentRequest(entityKey: string): boolean {
  return PAYMENT_REQUEST_SOURCE_ENTITIES.has(entityKey) && entityKey !== "payment-requests";
}

export function paymentRequestBucket(status: string): Exclude<PaymentRequestBucket, "all" | "overdue" | "awaiting"> | "awaiting" | "other" {
  const s = (status || "").trim();
  // Still in the approval chain (Accounts → GM → CEO → Finance).
  if (
    isPendingApprovalStatus(s) ||
    /^(submitted|open|in review|accounts assistant approved|aa approved|dept head approved|gm approved)$/i.test(s)
  ) {
    return "awaiting";
  }
  // CEO signed off — waiting on Finance to pay.
  if (/^(ceo approved|approved)$/i.test(s)) return "approved";
  if (/^(paid|complete|completed|settled)$/i.test(s)) return "paid";
  if (/^(rejected|declined|void|voided|cancelled|canceled)$/i.test(s)) return "rejected";
  return "other";
}

function sourceLabelFor(entityKey: string): string {
  return entityKey
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function listAllPaymentRequests(): PaymentRequestMonitorRow[] {
  if (typeof window === "undefined") return [];
  const today = todayIso();
  const rows = loadRecords(PAYMENT_REQUESTS_MODULE, PAYMENT_REQUESTS_ENTITY);
  return rows
    .map((record) => {
      const reference =
        String(record.reference || record.name || record.code || "").trim() || String(record.id || "").slice(0, 10);
      const dueDate = String(record.dueDate || "").trim();
      const status = String(record.status || "Draft").trim();
      const awaiting = paymentRequestBucket(status) === "awaiting";
      const overdue = Boolean(dueDate) && dueDate < today && awaiting;
      const sourceModule = record.sourceModule || "";
      const sourceEntity = record.sourceEntity || "";
      const sourceRecordId = record.sourceRecordId || "";
      const sourceRef = record.sourceReference || "";
      return {
        id: record.id,
        reference,
        date: record.date || record.issueDate || "",
        dueDate,
        department: record.department || "",
        project: record.project || "",
        payTo: record.payTo || "",
        payee: record.payee || record.contractor || record.party || "",
        contractor: record.contractor || "",
        amount: parseAmount(record.amount || record.total || "0"),
        currency: record.currency || "UGX",
        status,
        description: record.description || record.notes || "",
        href: hrefForRecordDetail(PAYMENT_REQUESTS_MODULE, PAYMENT_REQUESTS_ENTITY, record.id),
        overdue,
        awaiting,
        waitingOn: paymentChainWaitingOn(status),
        sourceLabel: record.sourceLabel || (sourceEntity ? sourceLabelFor(sourceEntity) : ""),
        sourceRef,
        sourceHref:
          sourceModule && sourceEntity
            ? hrefForSourceDocument(sourceModule, sourceEntity, sourceRecordId || sourceRef)
            : "",
        entityKey: PAYMENT_REQUESTS_ENTITY,
      };
    })
    .sort((a, b) => {
      if (a.awaiting !== b.awaiting) return a.awaiting ? -1 : 1;
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return (b.date || "").localeCompare(a.date || "") || a.reference.localeCompare(b.reference);
    });
}

export function paymentRequestSummary(rows: PaymentRequestMonitorRow[]) {
  const awaiting = rows.filter((r) => r.awaiting);
  const overdue = rows.filter((r) => r.overdue);
  const approved = rows.filter((r) => paymentRequestBucket(r.status) === "approved");
  const paid = rows.filter((r) => paymentRequestBucket(r.status) === "paid");
  const totalAwaiting = awaiting.reduce((sum, r) => sum + r.amount, 0);
  const totalAll = rows.reduce((sum, r) => sum + r.amount, 0);
  return {
    count: rows.length,
    awaiting: awaiting.length,
    overdue: overdue.length,
    approved: approved.length,
    paid: paid.length,
    totalAwaiting,
    totalAll,
  };
}

export function filterPaymentRequests(
  rows: PaymentRequestMonitorRow[],
  opts: {
    bucket?: PaymentRequestBucket;
    department?: string;
    query?: string;
  },
): PaymentRequestMonitorRow[] {
  const q = (opts.query || "").trim().toLowerCase();
  const dept = (opts.department || "").trim().toLowerCase();
  return rows.filter((row) => {
    if (dept && row.department.toLowerCase() !== dept) return false;
    if (opts.bucket && opts.bucket !== "all") {
      if (opts.bucket === "overdue") {
        if (!row.overdue) return false;
      } else if (opts.bucket === "awaiting") {
        if (!row.awaiting) return false;
      } else if (paymentRequestBucket(row.status) !== opts.bucket) {
        return false;
      }
    }
    if (!q) return true;
    const hay = [
      row.reference,
      row.department,
      row.project,
      row.payee,
      row.payTo,
      row.contractor,
      row.status,
      row.description,
      row.sourceLabel,
      row.sourceRef,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function getPaymentRequest(id: string): ManagerRecord | null {
  return (
    loadRecords(PAYMENT_REQUESTS_MODULE, PAYMENT_REQUESTS_ENTITY).find((row) => row.id === id) ||
    null
  );
}

export function updatePaymentRequestStatus(
  id: string,
  status: string,
): ManagerRecord | null {
  const rows = loadRecords(PAYMENT_REQUESTS_MODULE, PAYMENT_REQUESTS_ENTITY);
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return null;
  const previous = rows[index]!;
  const blocked = assertPaymentRequestStatusChange(previous.status, status);
  if (blocked) return null;
  const updated: ManagerRecord = {
    ...previous,
    status,
    updatedAt: new Date().toISOString(),
  };
  const next = [...rows];
  next[index] = updated;
  void saveRecords(PAYMENT_REQUESTS_MODULE, PAYMENT_REQUESTS_ENTITY, next).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        `${PAYMENT_REQUESTS_MODULE}/${PAYMENT_REQUESTS_ENTITY}`,
        saved.error || "Could not save the payment request status change.",
      );
    }
  });
  return updated;
}

export function departmentsFromPaymentRequests(rows: PaymentRequestMonitorRow[]): string[] {
  return Array.from(
    new Set(rows.map((r) => r.department.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
}

function existingOpenRequestForSource(sourceRecordId: string): ManagerRecord | undefined {
  return loadRecords(PAYMENT_REQUESTS_MODULE, PAYMENT_REQUESTS_ENTITY).find(
    (row) =>
      row.sourceRecordId === sourceRecordId &&
      !/^(paid|rejected|declined|void|voided|cancelled|canceled)$/i.test(row.status || ""),
  );
}

function findMilestoneForRecord(record: ManagerRecord): ManagerRecord | null {
  const milestoneName = (record.milestone || "").trim();
  if (!milestoneName) return null;
  const project = (record.project || "").trim().toLowerCase();
  return (
    loadRecords(PAYMENT_REQUESTS_MODULE, "milestones").find((row) => {
      if ((row.name || "").trim().toLowerCase() !== milestoneName.toLowerCase()) return false;
      if (!project) return true;
      return (row.project || "").trim().toLowerCase() === project;
    }) || null
  );
}

/**
 * Raise a payment request from an invoice, bill, or project document.
 * Routes into Projects → Payment Requests for Requestor → Accounts Assistant → GM → CEO → Finance → Paid.
 */
export async function createPaymentRequestFromSource(input: {
  moduleSlug: string;
  entityKey: string;
  record: ManagerRecord;
  department?: string;
}): Promise<
  { ok: true; request: ManagerRecord; existing?: boolean } | { ok: false; error: string }
> {
  if (typeof window === "undefined") return { ok: false, error: "Not available." };
  if (!canRaisePaymentRequest(input.entityKey)) {
    return { ok: false, error: "This document type cannot raise a payment request." };
  }
  if (/draft|void|voided|cancelled|canceled/i.test(input.record.status || "")) {
    return {
      ok: false,
      error: "Approve or activate the document before requesting payment.",
    };
  }

  // Progress certificates must be Approved before money is requested.
  if (
    input.entityKey === "progress-certificates" &&
    !/^approved$/i.test(input.record.status || "")
  ) {
    return {
      ok: false,
      error: "Approve the progress certificate before requesting payment.",
    };
  }

  // Milestone documents: the milestone itself must be Approved.
  if (input.entityKey === "milestones") {
    if (!/^approved$/i.test(input.record.status || "")) {
      return {
        ok: false,
        error: `Milestone “${input.record.name || "this milestone"}” must be Approved before requesting payment.`,
      };
    }
  } else if ((input.record.milestone || "").trim()) {
    // Linked milestone on requisitions / certs / expenses must be Approved.
    const milestone = findMilestoneForRecord(input.record);
    if (!milestone) {
      return {
        ok: false,
        error: `Milestone “${input.record.milestone}” was not found on this project.`,
      };
    }
    if (!/^approved$/i.test(milestone.status || "")) {
      return {
        ok: false,
        error: `Milestone “${milestone.name}” must be Approved before requesting payment.`,
      };
    }
  }

  const existing = existingOpenRequestForSource(input.record.id);
  if (existing) {
    return { ok: true, request: existing, existing: true };
  }

  const amount = String(
    input.record.amount ||
      input.record.total ||
      input.record.balance ||
      input.record.paymentAmount ||
      "0",
  );
  if (parseAmount(amount) <= 0) {
    return { ok: false, error: "Amount must be greater than zero." };
  }

  const sourceRef =
    input.record.reference || input.record.code || input.record.name || input.record.id.slice(0, 8);
  const payee =
    input.record.supplier ||
    input.record.contractor ||
    input.record.payee ||
    input.record.customer ||
    input.record.party ||
    input.record.employee ||
    "";
  const isSales = /sales-|credit-notes/.test(input.entityKey);
  const rows = loadRecords(PAYMENT_REQUESTS_MODULE, PAYMENT_REQUESTS_ENTITY);
  const user = getCurrentSessionUser();
  const now = new Date().toISOString();
  const request: ManagerRecord = {
    id: globalThis.crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    createdBy: user.username || user.id || "",
    reference: nextDocumentReference(PAYMENT_REQUESTS_ENTITY, rows),
    date: todayIso(),
    dueDate: input.record.dueDate || "",
    project: input.record.project || "",
    phase: input.record.phase || "",
    milestone:
      input.entityKey === "milestones"
        ? input.record.name || ""
        : input.record.milestone || "",
    department:
      input.department ||
      input.record.department ||
      (input.moduleSlug === "projects" ? "Projects" : isSales ? "Sales" : "Purchases"),
    contractor: input.record.contractor || payee,
    payTo: isSales ? "Customer refund" : input.record.payTo || "Supplier",
    payee,
    amount,
    currency: input.record.currency || "UGX",
    status: "Submitted",
    description:
      input.record.description ||
      `Payment request from ${sourceLabelFor(input.entityKey)} ${sourceRef}${
        input.entityKey === "milestones"
          ? ` · milestone ${input.record.name || ""}`
          : input.record.milestone
            ? ` · milestone ${input.record.milestone}`
            : ""
      }`,
    notes: input.record.notes || "",
    sourceModule: input.moduleSlug,
    sourceEntity: input.entityKey,
    sourceRecordId: input.record.id,
    sourceReference: sourceRef,
    sourceLabel: sourceLabelFor(input.entityKey),
  };

  const saved = await saveRecords(PAYMENT_REQUESTS_MODULE, PAYMENT_REQUESTS_ENTITY, [
    ...rows,
    request,
  ]);
  if (!saved.ok || saved.durable !== "postgres") {
    return {
      ok: false,
      error: saved.error || "Could not save the payment request.",
    };
  }
  notifyRequestParties({
    entityKey: PAYMENT_REQUESTS_ENTITY,
    record: request,
    event: "submitted",
  });
  return { ok: true, request };
}
