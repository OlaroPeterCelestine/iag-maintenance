/**
 * Shared requisition / payment approval chain:
 * Project payment / equipment / document, oral, general, fleet, and payroll:
 *   Requestor → Accounts Assistant → GM → CEO → Finance → Paid (no PM)
 *
 * Material requests use material-request-chain (QS → PM → Stores on the stores path).
 */
export type RequisitionChainStage =
  | "requestor"
  | "pm"
  | "accounts"
  | "gm"
  | "ceo"
  | "finance"
  | "done"
  | "rejected"
  | "unknown";

export type RequisitionActionableStage =
  | "pm"
  | "accounts"
  | "gm"
  | "ceo"
  | "finance";

export type RequisitionTrackerStepId =
  | "requestor"
  | "pm"
  | "accounts"
  | "gm"
  | "ceo"
  | "finance"
  | "paid";

/** @deprecated Prefer REQUISITION_CHAIN_LABEL_NO_PM — payment entities no longer include PM. */
export const REQUISITION_CHAIN_LABEL =
  "Requestor → Accounts Assistant → GM → CEO → Finance → Paid";

/** Standard payment / request chain (no Project Manager desk step). */
export const REQUISITION_CHAIN_LABEL_NO_PM =
  "Requestor → Accounts Assistant → GM → CEO → Finance → Paid";

export const REQUISITION_CHAIN_STATUSES = [
  "Draft",
  "Returned for Amendment",
  "Submitted",
  "PM Approved",
  "Accounts Assistant Approved",
  "GM Approved",
  "CEO Approved",
  "Paid",
  "Rejected",
  "Cancelled",
] as const;

export const REQUISITION_CHAIN_STATUSES_NO_PM = [
  "Draft",
  "Returned for Amendment",
  "Submitted",
  "Accounts Assistant Approved",
  "GM Approved",
  "CEO Approved",
  "Paid",
  "Rejected",
  "Cancelled",
] as const;

/** Entities that use this chain end-to-end. Material requests use material-request-chain.
 *  `leave-requests` is listed so the approval desk can load them; leave uses leave-request-chain
 *  (HOD → HR), not the payment stages. */
export const REQUISITION_CHAIN_ENTITIES = new Set([
  "payment-requests",
  "oral-payment-requests",
  "general-requests",
  "fuel-requests",
  "trip-requests",
  "maintenance-requests",
  "equipment-and-vehicle-requests",
  "document-requests",
  "leave-requests",
  "payroll-runs",
]);

/** Payment / request entities that skip the Project Manager desk step. */
export const REQUISITION_NO_PM_ENTITIES = new Set([
  "payment-requests",
  "equipment-and-vehicle-requests",
  "document-requests",
  "oral-payment-requests",
  "general-requests",
  "fuel-requests",
  "trip-requests",
  "maintenance-requests",
  "payroll-runs",
]);

export function requisitionIncludesPm(entityKey?: string | null): boolean {
  const key = (entityKey || "").trim();
  if (!key) return true;
  return !REQUISITION_NO_PM_ENTITIES.has(key);
}

export function requisitionChainLabel(entityKey?: string | null): string {
  return requisitionIncludesPm(entityKey)
    ? REQUISITION_CHAIN_LABEL
    : REQUISITION_CHAIN_LABEL_NO_PM;
}

/** Statuses allowed after Finance marks Paid (fulfillment / issue / provide). */
export const REQUISITION_POST_APPROVAL_STATUSES = [
  "Fulfilled",
  "Completed",
  "Issued",
  "Provided",
  "Returned",
] as const;

export const REQUISITION_TRACKER_STEPS: {
  id: RequisitionTrackerStepId;
  label: string;
}[] = [
  { id: "requestor", label: "Requestor" },
  { id: "pm", label: "PM" },
  { id: "accounts", label: "Accounts Asst" },
  { id: "gm", label: "GM" },
  { id: "ceo", label: "CEO" },
  { id: "finance", label: "Finance" },
  { id: "paid", label: "Paid" },
];

export const REQUISITION_TRACKER_STEPS_NO_PM: {
  id: RequisitionTrackerStepId;
  label: string;
}[] = [
  { id: "requestor", label: "Requestor" },
  { id: "accounts", label: "Accounts Asst" },
  { id: "gm", label: "GM" },
  { id: "ceo", label: "CEO" },
  { id: "finance", label: "Finance" },
  { id: "paid", label: "Paid" },
];

export function requisitionTrackerSteps(entityKey?: string | null) {
  return requisitionIncludesPm(entityKey)
    ? REQUISITION_TRACKER_STEPS
    : REQUISITION_TRACKER_STEPS_NO_PM;
}

const STAGE_LABEL: Record<RequisitionChainStage, string> = {
  requestor: "Requestor",
  pm: "Project Manager",
  accounts: "Accounts Assistant",
  gm: "General Manager",
  ceo: "CEO",
  finance: "Finance (make payment)",
  done: "Paid",
  rejected: "Rejected",
  unknown: "Unknown",
};

/** Status written when the current actionable stage advances. */
export const REQUISITION_STAGE_NEXT_STATUS: Record<RequisitionActionableStage, string> = {
  pm: "PM Approved",
  accounts: "Accounts Assistant Approved",
  gm: "GM Approved",
  ceo: "CEO Approved",
  finance: "Paid",
};

export const REQUISITION_STAGE_ROLE: Record<RequisitionActionableStage, RegExp> = {
  pm: /project\s*manager|\bpm\b/i,
  accounts:
    /accounts?\s*assistant|account\s*assistant|accounts?\s*asst|\baa\b|accounts?\s*officer|\baccountant\b/i,
  gm: /general\s*manager|\bgm\b|gen\.?\s*manager/i,
  ceo: /\bceo\b|chief\s*executive/i,
  // Payment confirmation after CEO — whole finance department (not only role "Finance").
  finance:
    /\bfinance\b|finance\s*manager|finance\s*officer|finance\s*clerk|cashier|paymaster|treasurer|accounts?\s*payable/i,
};

export const REQUISITION_AUDIT_FIELD: Record<RequisitionActionableStage, string> = {
  pm: "approvedByPm",
  accounts: "approvedByAccounts",
  gm: "approvedByGm",
  ceo: "approvedByCeo",
  finance: "paidBy",
};

/** Display date under a chain step (e.g. "2 Aug 2026"). */
export function formatRequisitionChainDate(raw: string | undefined | null): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const isoDay = /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
  const d = isoDay
    ? new Date(`${isoDay}T12:00:00`)
    : new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Dates for each tracker step, from approval audit fields on the record.
 * Requestor uses submittedAt / date / createdAt once the request leaves Draft.
 */
export function requisitionChainStepDates(
  record: Record<string, string | undefined | null> | null | undefined,
): Partial<Record<RequisitionTrackerStepId, string>> {
  if (!record) return {};
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const formatted = formatRequisitionChainDate(record[key]);
      if (formatted) return formatted;
    }
    return "";
  };
  const status = String(record.status || "").trim();
  const leftDraft = status && !/^draft$/i.test(status);
  return {
    requestor: leftDraft ? pick("submittedAt", "date", "createdAt") : "",
    pm: pick("approvedByPmAt"),
    accounts: pick("approvedByAccountsAt"),
    gm: pick("approvedByGmAt"),
    ceo: pick("approvedByCeoAt"),
    finance: "",
    paid: pick("paidAt"),
  };
}

export function isAdminRole(role: string): boolean {
  const r = (role || "").trim().toLowerCase().replace(/\s+/g, " ");
  return r === "administrator" || r === "super admin";
}

/**
 * Map status → waiting stage.
 * Legacy "Dept Head Approved" / oral "Reviewed" still resolve into this chain.
 * Submitted waits on Accounts Assistant (no PM).
 * Legacy "PM Approved" still resolves to Accounts.
 */
export function requisitionChainStage(
  status: string,
  entityKey?: string | null,
): RequisitionChainStage {
  const s = String(status ?? "").trim();
  if (/^(rejected|declined|void|voided|cancelled|canceled)$/i.test(s)) return "rejected";
  if (/^(paid|complete|completed|settled|fulfilled|issued|returned)$/i.test(s)) {
    return "done";
  }
  if (/^(ceo approved|approved)$/i.test(s)) return "finance";
  if (/^gm approved$/i.test(s)) return "ceo";
  if (/^(accounts?\s*assistant approved|aa approved)$/i.test(s)) return "gm";
  if (/^(pm approved|project\s*manager approved)$/i.test(s)) return "accounts";
  if (/^reviewed$/i.test(s)) return "ceo";
  if (/^dept head approved$/i.test(s)) return "gm";
  if (/^(draft|returned for amendment|amendment required|needs amendment)$/i.test(s)) return "requestor";
  if (/^(pending|submitted|awaiting approval|unapproved|open|in review)$/i.test(s)) {
    return requisitionIncludesPm(entityKey) ? "pm" : "accounts";
  }
  return "unknown";
}

export function requisitionChainWaitingOn(
  status: string,
  entityKey?: string | null,
): string {
  const stage = requisitionChainStage(status, entityKey);
  if (stage === "requestor") {
    if (/^(returned for amendment|amendment required|needs amendment)$/i.test(status)) {
      return "Requestor (amend & resubmit)";
    }
    return "Requestor (submit)";
  }
  if (stage === "done") return "Paid";
  if (stage === "rejected") return "Rejected";
  if (stage === "unknown") return "—";
  return STAGE_LABEL[stage];
}

export function requisitionChainProgress(
  status: string,
  entityKey?: string | null,
): {
  stage: RequisitionChainStage;
  waitingOn: string;
  chainLabel: string;
  steps: {
    id: RequisitionTrackerStepId;
    label: string;
    done: boolean;
    current: boolean;
  }[];
} {
  const includePm = requisitionIncludesPm(entityKey);
  const stage = requisitionChainStage(status, entityKey);
  const defs = requisitionTrackerSteps(entityKey);
  const currentIndex = includePm
    ? stage === "requestor"
      ? 0
      : stage === "pm"
        ? 1
        : stage === "accounts"
          ? 2
          : stage === "gm"
            ? 3
            : stage === "ceo"
              ? 4
              : stage === "finance"
                ? 5
                : stage === "done"
                  ? 7
                  : -1
    : stage === "requestor"
      ? 0
      : stage === "accounts"
        ? 1
        : stage === "gm"
          ? 2
          : stage === "ceo"
            ? 3
            : stage === "finance"
              ? 4
              : stage === "done"
                ? 6
                : -1;

  return {
    stage,
    waitingOn: requisitionChainWaitingOn(status, entityKey),
    chainLabel: requisitionChainLabel(entityKey),
    steps: defs.map((step, index) => ({
      id: step.id,
      label: step.label,
      done: currentIndex > index,
      current: currentIndex === index,
    })),
  };
}

export function roleMatchesRequisitionStage(
  role: string,
  stage: RequisitionActionableStage,
): boolean {
  const r = (role || "").trim();
  if (!r) return false;
  // Admin may view every desk queue but does not auto-match stage roles.
  // Make payment after CEO is a finance-department queue (Finance + Accounts).
  if (stage === "finance") {
    return (
      REQUISITION_STAGE_ROLE.finance.test(r) || REQUISITION_STAGE_ROLE.accounts.test(r)
    );
  }
  return REQUISITION_STAGE_ROLE[stage].test(r);
}

export function canAdvanceRequisitionStatus(
  status: string,
  role: string,
  entityKey?: string | null,
): {
  ok: boolean;
  stage: RequisitionChainStage;
  reason?: string;
  nextStatus?: string;
} {
  const stage = requisitionChainStage(status, entityKey);
  if (stage === "done") {
    return { ok: false, stage, reason: "This request is already paid." };
  }
  if (stage === "rejected") {
    return { ok: false, stage, reason: "This request was rejected." };
  }
  if (stage === "requestor") {
    return {
      ok: false,
      stage,
      reason: "Requestor must submit the request first (Draft → Submitted).",
    };
  }
  if (stage === "unknown" || !(stage in REQUISITION_STAGE_NEXT_STATUS)) {
    return { ok: false, stage, reason: "This status is not part of the approval chain." };
  }
  const actionable = stage as RequisitionActionableStage;
  if (!roleMatchesRequisitionStage(role, actionable)) {
    return {
      ok: false,
      stage,
      reason: `Waiting on ${STAGE_LABEL[actionable]}. Your role (${role || "none"}) cannot act on this step.`,
    };
  }
  return {
    ok: true,
    stage,
    nextStatus: REQUISITION_STAGE_NEXT_STATUS[actionable],
  };
}

export function canRejectRequisitionStatus(
  status: string,
  role: string,
  entityKey?: string | null,
): boolean {
  if (!isRequisitionStatusRejectableInFlight(status, entityKey)) return false;
  const stage = requisitionChainStage(status, entityKey) as RequisitionActionableStage;
  return roleMatchesRequisitionStage(role, stage);
}

/**
 * Status-only rejectable/amendable in-flight check (mirrors Go IsRejectableInFlightStatus).
 * Do not probe with a fake "Administrator" stage match.
 */
export function isRequisitionStatusRejectableInFlight(
  status: string,
  entityKey?: string | null,
): boolean {
  const stage = requisitionChainStage(status, entityKey);
  if (stage === "done" || stage === "rejected" || stage === "unknown" || stage === "requestor") {
    return false;
  }
  // After CEO approval, Finance confirms payment only — no reject / amend.
  if (stage === "finance") return false;
  return stage in REQUISITION_STAGE_NEXT_STATUS;
}

/** True when the signed-in user raised / created this request. */
export function isApprovalRequestOwner(
  record: Record<string, string | undefined | null> | null | undefined,
  user?: { id?: string; name?: string; username?: string; email?: string } | null,
): boolean {
  if (!record || !user) return false;
  const candidates = [user.username, user.id, user.email, user.name]
    .map((s) => (s || "").trim().toLowerCase())
    .filter(Boolean);
  if (!candidates.length) return false;
  const fields = [
    record.createdBy,
    record.requestedBy,
    record.initiator,
    record.contractor,
    record.employee,
    record.createdByUserId,
    record.userId,
  ]
    .map((s) => String(s || "").trim().toLowerCase())
    .filter(Boolean);
  return fields.some((field) => candidates.includes(field));
}

/**
 * Amend when:
 * - desk role waiting on this step (API sends one step back), or
 * - Administrator, or
 * - the requestor/owner (API sends one step back / Returned for Amendment).
 */
export function canAmendRequisitionStatus(
  status: string,
  role: string,
  entityKey?: string | null,
  record?: Record<string, string | undefined | null> | null,
  user?: { id?: string; name?: string; username?: string; email?: string } | null,
): boolean {
  // Payment confirmation after CEO is locked — no amend / amount change.
  if (requisitionChainStage(status, entityKey) === "finance") return false;
  if (canRejectRequisitionStatus(status, role, entityKey)) return true;
  // Owner/admin may reopen Rejected → Returned for Amendment to correct and resubmit.
  if (/^(rejected|declined)$/i.test(status || "")) {
    if (isAdminRole(role)) return true;
    return isApprovalRequestOwner(record, user);
  }
  if (!isRequisitionStatusRejectableInFlight(status, entityKey)) return false;
  if (isAdminRole(role)) return true;
  return isApprovalRequestOwner(record, user);
}

export function requisitionAdvanceActionLabel(
  status: string,
  entityKey?: string | null,
): string {
  const stage = requisitionChainStage(status, entityKey);
  if (stage === "finance") return "Make payment";
  if (stage === "pm") return "Approve (PM)";
  if (stage === "accounts") return "Approve (Accounts Assistant)";
  if (stage === "gm") return "Approve (GM)";
  if (stage === "ceo") return "Approve (CEO)";
  return "Approve";
}

export function requisitionChainLockMessage(entityKey?: string | null): string {
  return `Request status can only change through the approval chain (${requisitionChainLabel(entityKey)}).`;
}

/** Allow Draft → Submitted from the form (requestor submit), and post-Paid ops. */
export function assertRequisitionChainStatusChange(
  previousStatus: string | undefined,
  nextStatus: string,
  entityKey?: string | null,
): string | null {
  const prev = (previousStatus || "Draft").trim();
  const next = (nextStatus || "").trim();
  if (!next || prev.toLowerCase() === next.toLowerCase()) return null;
  if (/^draft$/i.test(prev) && /^(submitted|pending|awaiting approval)$/i.test(next)) {
    return null;
  }
  // Returned for amendment → resubmit (same as Draft → Submitted for the requestor).
  if (
    /^(returned for amendment|amendment required|needs amendment)$/i.test(prev) &&
    /^(submitted|pending|awaiting approval)$/i.test(next)
  ) {
    return null;
  }
  // After Finance marks Paid (or already fulfilled), allow operational completion.
  if (
    /^(paid|fulfilled|completed|settled)$/i.test(prev) &&
    /^(fulfilled|completed|issued|provided|returned)$/i.test(next)
  ) {
    return null;
  }
  if (/^issued$/i.test(prev) && /^returned$/i.test(next)) {
    return null;
  }
  return requisitionChainLockMessage(entityKey);
}
