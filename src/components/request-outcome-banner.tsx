"use client";

import { Button } from "@/components/ui/button";
import { isApprovalRequestOwner } from "@/lib/requisition-chain";
import {
  canRedoRejectedRequest,
  requestNeedsRequestorAttention,
} from "@/lib/request-amend-flow";
import { getCurrentSessionUser } from "@/lib/session-profile";
import type { ManagerRecord } from "@/lib/manager-entities";

/** Prominent banner when a request was rejected or returned for amendment. */
export function RequestOutcomeBanner({
  record,
  onRedo,
}: {
  record: ManagerRecord;
  /** Owner redo: reopen Rejected as Returned for Amendment so they can edit and resubmit. */
  onRedo?: () => void;
}) {
  const user = getCurrentSessionUser();
  const role = user?.role || "";
  const mine = isApprovalRequestOwner(record, user);
  const status = (record.status || "").trim();
  const rejected = /^(rejected|declined)$/i.test(status);
  const needsAttention = requestNeedsRequestorAttention(record);
  const canRedo = Boolean(onRedo) && canRedoRejectedRequest(status, role, record, user);

  if (rejected) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-950">
        <p className="font-semibold tracking-tight">Request rejected</p>
        <p className="mt-1 text-rose-800/90">
          {record.rejectedBy ? `By ${record.rejectedBy}` : "By an approver"}
          {record.rejectedAt ? ` · ${record.rejectedAt}` : ""}.
          {mine
            ? " Read the reason below, then Redo to reopen it for amendment, fix it, and resubmit."
            : ""}
        </p>
        {(record.rejectionReason || "").trim() ? (
          <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-[12px] text-rose-900">
            <span className="font-medium">Reason: </span>
            {record.rejectionReason}
          </p>
        ) : (
          <p className="mt-2 text-[12px] text-rose-800/80">No rejection reason was recorded.</p>
        )}
        {canRedo ? (
          <div className="mt-3">
            <Button
              type="button"
              className="h-9 bg-rose-700 px-4 text-white hover:bg-rose-800"
              onClick={onRedo}
            >
              Redo request
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (needsAttention || (record.amendmentReason || "").trim()) {
    const returnTo = (record.amendedReturnTo || "").trim() || "Requestor";
    const isDraft =
      /^draft$/i.test(status) ||
      /^(returned for amendment|amendment required|needs amendment)$/i.test(status);
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-950">
        <p className="font-semibold tracking-tight">Returned for amendment</p>
        <p className="mt-1 text-amber-900/90">
          {record.amendedBy ? `By ${record.amendedBy}` : "By an approver"}
          {record.amendedAt ? ` · ${record.amendedAt}` : ""}
          {" · "}
          Waiting on <span className="font-medium">{returnTo}</span>
          {isDraft && mine ? " — edit what was requested, set Status to Submitted, then save." : "."}
        </p>
        {(record.amendmentReason || "").trim() ? (
          <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-[12px] text-amber-950">
            <span className="font-medium">What to change: </span>
            {record.amendmentReason}
          </p>
        ) : null}
        {(record.rejectionReason || "").trim() ? (
          <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-[12px] text-rose-900">
            <span className="font-medium">Earlier rejection: </span>
            {record.rejectionReason}
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}
