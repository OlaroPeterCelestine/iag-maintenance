/**
 * Amend always sends one step back for amendment — never jumps to a blank Draft.
 * When the previous actor is the requestor, status becomes "Returned for Amendment".
 */
import {
  canAmendRequisitionStatus,
  canRejectRequisitionStatus,
  isAdminRole,
  isApprovalRequestOwner,
} from "@/lib/requisition-chain";
import { getCurrentSessionUser } from "@/lib/session-profile";
import type { ManagerRecord } from "@/lib/manager-entities";

/** Status when a request is sent back to the requestor to correct (not a blank Draft). */
export const RETURNED_FOR_AMENDMENT_STATUS = "Returned for Amendment";

export type AmendReturnMode = "previous";

/** Desk may send one step back when they own this approval step. */
export function canReturnRequestOneStep(
  status: string,
  role: string,
  entityKey?: string | null,
): boolean {
  return canRejectRequisitionStatus(status, role, entityKey);
}

/** Owner or admin may reopen a Rejected request for correction and resubmit. */
export function canRedoRejectedRequest(
  status: string,
  role: string,
  record?: Record<string, string | undefined | null> | null,
  user?: { id?: string; name?: string; username?: string; email?: string } | null,
): boolean {
  if (!/^(rejected|declined)$/i.test((status || "").trim())) return false;
  if (isAdminRole(role)) return true;
  const session = user || getCurrentSessionUser();
  return isApprovalRequestOwner(record || {}, session);
}

/**
 * Owner/admin may trigger one-step amend on in-flight requests, or reopen rejected
 * as Returned for Amendment (not Draft).
 */
export function canRecallRequestToDraft(
  status: string,
  role: string,
  entityKey?: string | null,
  record?: Record<string, string | undefined | null> | null,
  user?: { id?: string; name?: string; username?: string; email?: string } | null,
): boolean {
  if (canRedoRejectedRequest(status, role, record, user)) return true;
  return canAmendRequisitionStatus(status, role, entityKey, record, user);
}

export function isReturnedForAmendmentStatus(status: string | null | undefined): boolean {
  return /^(returned for amendment|amendment required|needs amendment)$/i.test(
    (status || "").trim(),
  );
}

export function amendDestinationLabel(previousReturnTo?: string): string {
  return previousReturnTo?.trim() || "Previous step";
}

/** Rejected or returned-for-amendment — requestor must see and act. */
export function requestNeedsRequestorAttention(record: ManagerRecord): boolean {
  const status = (record.status || "").trim();
  if (/^(rejected|declined)$/i.test(status)) return true;
  if (isReturnedForAmendmentStatus(status)) return true;
  if (/^draft$/i.test(status) && (record.amendmentReason || "").trim()) return true;
  return false;
}

/** Sort key: own attention items first, then rejected, then amendment returns, then rest. */
export function requestAttentionSortRank(
  record: ManagerRecord,
  user?: { id?: string; name?: string; username?: string; email?: string } | null,
): number {
  const session = user || getCurrentSessionUser();
  const mine = isApprovalRequestOwner(record, session);
  if (mine && /^(rejected|declined)$/i.test(record.status || "")) return 0;
  if (mine && isReturnedForAmendmentStatus(record.status || "")) return 1;
  if (mine && /^draft$/i.test(record.status || "") && (record.amendmentReason || "").trim()) {
    return 1;
  }
  if (/^(rejected|declined)$/i.test(record.status || "")) return 2;
  if (isReturnedForAmendmentStatus(record.status || "") || (record.amendmentReason || "").trim()) {
    return 3;
  }
  return 10;
}

/** Urgent first — used as a secondary sort for request inboxes. */
export function requestPrioritySortRank(priority: string | undefined): number {
  switch ((priority || "").trim().toLowerCase()) {
    case "urgent":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    default:
      return 4;
  }
}

/**
 * Workflow order for the list: active chain stages first, then terminal
 * outcomes. Mirrors the no-PM general/oral path and keeps PM statuses in place.
 */
export function requestStatusSortRank(status: string | undefined): number {
  const s = (status || "").trim().toLowerCase();
  const order: Record<string, number> = {
    draft: 0,
    "returned for amendment": 1,
    "amendment required": 1,
    "needs amendment": 1,
    submitted: 2,
    "pm approved": 3,
    "accounts assistant approved": 4,
    "gm approved": 5,
    "ceo approved": 6,
    paid: 7,
    fulfilled: 8,
    completed: 8,
    issued: 8,
    provided: 8,
    returned: 9,
    rejected: 10,
    declined: 10,
    cancelled: 11,
  };
  return order[s] ?? 6;
}

export function sortRecordsForRequestorAttention(
  rows: ManagerRecord[],
  user?: { id?: string; name?: string; username?: string; email?: string } | null,
): ManagerRecord[] {
  const session = user || getCurrentSessionUser();
  return [...rows].sort((a, b) => {
    const ra = requestAttentionSortRank(a, session);
    const rb = requestAttentionSortRank(b, session);
    if (ra !== rb) return ra - rb;

    const pa = requestPrioritySortRank(a.priority);
    const pb = requestPrioritySortRank(b.priority);
    if (pa !== pb) return pa - pb;

    const sa = requestStatusSortRank(a.status);
    const sb = requestStatusSortRank(b.status);
    if (sa !== sb) return sa - sb;

    return String(b.updatedAt || b.date || b.createdAt || "").localeCompare(
      String(a.updatedAt || a.date || a.createdAt || ""),
    );
  });
}

export function isRequestChainEntityKey(key: string): boolean {
  return (
    key === "payment-requests" ||
    key === "oral-payment-requests" ||
    key === "general-requests" ||
    key === "requisitions" ||
    key === "fuel-requests" ||
    key === "trip-requests" ||
    key === "maintenance-requests" ||
    key === "equipment-and-vehicle-requests" ||
    key === "document-requests" ||
    key === "leave-requests" ||
    key === "payroll-runs"
  );
}

/**
 * Form field edit for chain requests: owner/admin only, and only while the
 * request is with the requestor (Draft / Returned for Amendment). Desk roles
 * use Approve / Reject / Amend — they must not rewrite others' in-flight forms.
 */
export function canEditRequestChainRecord(
  entityKey: string,
  status: string,
  role: string,
  record?: Record<string, string | undefined | null> | null,
  user?: { id?: string; name?: string; username?: string; email?: string } | null,
): boolean {
  if (!isRequestChainEntityKey(entityKey)) return true;
  const s = (status || "").trim();
  if (!/^(draft|returned for amendment|amendment required|needs amendment)$/i.test(s)) {
    return false;
  }
  if (isAdminRole(role)) return true;
  const session = user || getCurrentSessionUser();
  return isApprovalRequestOwner(record || {}, session);
}
