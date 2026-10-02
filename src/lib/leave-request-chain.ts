/**
 * Leave request approval chain:
 * Requestor → HOD → HR → Approved
 */

export type LeaveChainStage =
  | "requestor"
  | "hod"
  | "hr"
  | "done"
  | "rejected"
  | "unknown";

export type LeaveActionableStage = "hod" | "hr";

export const LEAVE_CHAIN_LABEL = "Requestor → HOD → HR → Approved";

export const LEAVE_REQUEST_STATUSES = [
  "Draft",
  "Returned for Amendment",
  "Submitted",
  "HOD Approved",
  "Approved",
  "Rejected",
  "Cancelled",
] as const;

export const LEAVE_AUDIT_FIELD: Record<LeaveActionableStage, string> = {
  hod: "approvedByHod",
  hr: "approvedByHr",
};

export const LEAVE_TRACKER_STEPS = [
  { id: "requestor", label: "Requestor" },
  { id: "hod", label: "HOD" },
  { id: "hr", label: "HR" },
  { id: "approved", label: "Approved" },
] as const;

const HOD_ROLE =
  /\bhod\b|head\s*of\s*department|department\s*head|dept\.?\s*head|departmental\s*head/i;
const HR_ROLE =
  /\bhr\b|human\s*resources?|people\s*ops|people\s*operations|hr\s*manager|hr\s*officer/i;

export function leaveChainStage(status: string): LeaveChainStage {
  const s = String(status ?? "").trim();
  if (/^(rejected|declined|void|voided|cancelled|canceled)$/i.test(s)) return "rejected";
  // Final approved, plus legacy "HR Approved" (old chain intermediate waiting on GM).
  if (/^(approved|complete|completed|hr approved)$/i.test(s)) return "done";
  if (/^hod approved$/i.test(s)) return "hr";
  if (
    /^draft$/i.test(s) ||
    /^(returned for amendment|amendment required|needs amendment)$/i.test(s) ||
    !s
  ) {
    return "requestor";
  }
  if (/^(pending|submitted|awaiting approval|unapproved|open|in review)$/i.test(s)) {
    return "hod";
  }
  return "unknown";
}

export function leaveChainWaitingOn(status: string): string {
  if (/^(returned for amendment|amendment required|needs amendment)$/i.test(String(status ?? "").trim())) {
    return "Requestor (amend & resubmit)";
  }
  switch (leaveChainStage(status)) {
    case "requestor":
      return "Requestor (submit)";
    case "hod":
      return "HOD";
    case "hr":
      return "HR";
    case "done":
      return "Approved";
    case "rejected":
      return "Rejected";
    default:
      return "—";
  }
}

export function roleMatchesLeaveStage(
  role: string,
  stage: LeaveActionableStage,
): boolean {
  const r = (role || "").trim();
  if (!r) return false;
  // Admin may view every desk queue but does not auto-match stage roles.
  if (stage === "hod") return HOD_ROLE.test(r);
  if (stage === "hr") return HR_ROLE.test(r);
  return false;
}

export function canAdvanceLeaveRequest(
  status: string,
  role = "",
): {
  ok: boolean;
  stage: LeaveChainStage;
  nextStatus?: string;
  auditField?: string;
  reason?: string;
} {
  const stage = leaveChainStage(status);
  if (stage === "done") {
    return { ok: false, stage, reason: "This leave request is already approved." };
  }
  if (stage === "rejected") {
    return { ok: false, stage, reason: "This leave request was rejected." };
  }
  if (stage === "requestor") {
    return {
      ok: false,
      stage,
      reason: "Requestor must submit first (Draft → Submitted).",
    };
  }
  if (stage === "unknown") {
    return { ok: false, stage, reason: "This status is not part of the leave chain." };
  }

  const actionable = stage as LeaveActionableStage;
  const nextStatus = actionable === "hod" ? "HOD Approved" : "Approved";
  if (!roleMatchesLeaveStage(role, actionable)) {
    return {
      ok: false,
      stage,
      reason: `Waiting on ${leaveChainWaitingOn(status)}. Your role (${role || "none"}) cannot act on this step.`,
    };
  }
  return {
    ok: true,
    stage,
    nextStatus,
    auditField: LEAVE_AUDIT_FIELD[actionable],
  };
}

export function canRejectLeaveRequest(status: string, role = ""): boolean {
  if (!isLeaveStatusRejectableInFlight(status)) return false;
  const stage = leaveChainStage(status) as LeaveActionableStage;
  return roleMatchesLeaveStage(role, stage);
}

/** Status-only in-flight check (mirrors Go IsRejectableInFlightStatus for leave). */
export function isLeaveStatusRejectableInFlight(status: string): boolean {
  const stage = leaveChainStage(status);
  return stage === "hod" || stage === "hr";
}

export function leaveAdvanceActionLabel(status: string): string {
  switch (leaveChainStage(status)) {
    case "hod":
      return "Approve (HOD)";
    case "hr":
      return "Approve (HR)";
    default:
      return "Approve";
  }
}

export function leaveChainProgress(status: string) {
  const stage = leaveChainStage(status);
  let currentIndex = -1;
  switch (stage) {
    case "requestor":
      currentIndex = 0;
      break;
    case "hod":
      currentIndex = 1;
      break;
    case "hr":
      currentIndex = 2;
      break;
    case "done":
      currentIndex = 4;
      break;
    default:
      currentIndex = -1;
  }
  const steps = LEAVE_TRACKER_STEPS.map((step, i) => ({
    id: step.id,
    label: step.label,
    done: currentIndex > i,
    current: currentIndex === i,
  }));
  return {
    stage,
    waitingOn: leaveChainWaitingOn(status),
    chainLabel: LEAVE_CHAIN_LABEL,
    steps,
  };
}

export function leaveChainStepDates(
  record?: Record<string, string | undefined | null> | null,
): Record<string, string> {
  if (!record) return {};
  return {
    hod: String(record.approvedByHodAt || record.hodApprovedAt || "").trim(),
    hr: String(record.approvedByHrAt || record.hrApprovedAt || "").trim(),
    approved: String(record.approvedAt || record.approvedByHrAt || "").trim(),
  };
}

export function assertLeaveRequestStatusChange(
  previousStatus: string | undefined,
  nextStatus: string,
): string | null {
  const prev = (previousStatus || "Draft").trim() || "Draft";
  const next = (nextStatus || "").trim();
  if (!next || prev.toLowerCase() === next.toLowerCase()) return null;
  if (/^draft$/i.test(prev) && /^(submitted|pending|awaiting approval)$/i.test(next)) {
    return null;
  }
  if (
    /^(returned for amendment|amendment required|needs amendment)$/i.test(prev) &&
    /^(submitted|pending|awaiting approval)$/i.test(next)
  ) {
    return null;
  }
  return `Leave status can only move Draft / Returned for Amendment → Submitted here. Use Approve / Reject on the desk for ${LEAVE_CHAIN_LABEL}.`;
}
