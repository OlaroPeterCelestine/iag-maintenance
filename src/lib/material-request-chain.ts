/**
 * Material request approval chains (Project Manager → Material Requests):
 *
 * Stores path (stock available):
 *   Technician / initiator → Quantity surveyor → Project manager → Stores manager (issues)
 *
 * Low / no stock (procurement path):
 *   Procurement initiator → Finance review → GM review → CEO approve
 *   → Finance payment → Procurement follow-up
 */

export type MaterialFulfillmentPath = "stores" | "procurement";

export type MaterialStoresStage =
  | "requestor"
  | "qs"
  | "pm"
  | "stores"
  | "done"
  | "rejected"
  | "unknown";

export type MaterialProcurementStage =
  | "requestor"
  | "finance_review"
  | "gm"
  | "ceo"
  | "finance_pay"
  | "procurement_followup"
  | "done"
  | "rejected"
  | "unknown";

export type MaterialActionableStage =
  | "qs"
  | "pm"
  | "stores"
  | "finance_review"
  | "gm"
  | "ceo"
  | "finance_pay"
  | "procurement_followup";

export const MATERIAL_STORES_CHAIN_LABEL =
  "Initiator → Quantity Surveyor → Project Manager → Stores (issues)";

export const MATERIAL_PROCUREMENT_CHAIN_LABEL =
  "Procurement → Finance review → GM → CEO → Finance payment → Procurement follow-up";

export const MATERIAL_STORES_STATUSES = [
  "Draft",
  "Returned for Amendment",
  "Submitted",
  "QS Approved",
  "PM Approved",
  "Issued",
  "Rejected",
  "Cancelled",
] as const;

export const MATERIAL_PROCUREMENT_STATUSES = [
  "Draft",
  "Returned for Amendment",
  "Submitted",
  "Finance Reviewed",
  "GM Approved",
  "CEO Approved",
  "Paid",
  "Follow-up Complete",
  "Rejected",
  "Cancelled",
] as const;

/** Combined status list for the Material Requests form select. */
export const MATERIAL_REQUEST_STATUSES = [
  "Draft",
  "Returned for Amendment",
  "Submitted",
  "QS Approved",
  "PM Approved",
  "Issued",
  "Finance Reviewed",
  "GM Approved",
  "CEO Approved",
  "Paid",
  "Follow-up Complete",
  "Rejected",
  "Cancelled",
] as const;

export const MATERIAL_FULFILLMENT_OPTIONS = [
  "Stores issue",
  "Procurement (low / no stock)",
] as const;

export function materialFulfillmentPath(
  value: string | undefined | null,
): MaterialFulfillmentPath {
  const s = String(value || "").trim().toLowerCase();
  if (s.includes("procurement") || s.includes("low") || s.includes("no stock") || s.includes("purchase")) {
    return "procurement";
  }
  return "stores";
}

export function materialChainLabel(path: MaterialFulfillmentPath): string {
  return path === "procurement"
    ? MATERIAL_PROCUREMENT_CHAIN_LABEL
    : MATERIAL_STORES_CHAIN_LABEL;
}

const STORES_ROLE: Record<"qs" | "pm" | "stores", RegExp> = {
  qs: /quantity\s*surveyor|\bqs\b|qty\s*surveyor/i,
  pm: /project\s*manager|\bpm\b/i,
  stores: /stores?\s*manager|store\s*keeper|warehouse\s*manager|inventory\s*manager/i,
};

const PROCUREMENT_ROLE: Record<
  "finance_review" | "gm" | "ceo" | "finance_pay" | "procurement_followup",
  RegExp
> = {
  finance_review:
    /\bfinance\b|finance\s*manager|finance\s*officer|cashier|paymaster|treasurer|accounts?\s*assistant|account\s*assistant|accounts?\s*asst|\baa\b|accounts?\s*officer|\baccountant\b/i,
  gm: /general\s*manager|\bgm\b|gen\.?\s*manager/i,
  ceo: /\bceo\b|chief\s*executive/i,
  // After CEO — same finance-department queue as payment Make payment.
  finance_pay:
    /\bfinance\b|finance\s*manager|finance\s*officer|cashier|paymaster|treasurer|accounts?\s*assistant|account\s*assistant|accounts?\s*asst|\baa\b|accounts?\s*officer|\baccountant\b/i,
  procurement_followup: /procurement|purchasing|buyer/i,
};

export const MATERIAL_AUDIT_FIELD: Record<MaterialActionableStage, string> = {
  qs: "approvedByQs",
  pm: "approvedByPm",
  stores: "issuedBy",
  finance_review: "reviewedByFinance",
  gm: "approvedByGm",
  ceo: "approvedByCeo",
  finance_pay: "paidBy",
  procurement_followup: "followedUpBy",
};

export type MaterialTrackerStep = {
  id: string;
  label: string;
};

export const MATERIAL_STORES_TRACKER_STEPS: MaterialTrackerStep[] = [
  { id: "requestor", label: "Initiator" },
  { id: "qs", label: "QS" },
  { id: "pm", label: "PM" },
  { id: "stores", label: "Stores" },
  { id: "issued", label: "Issued" },
];

export const MATERIAL_PROCUREMENT_TRACKER_STEPS: MaterialTrackerStep[] = [
  { id: "requestor", label: "Procurement" },
  { id: "finance_review", label: "Finance" },
  { id: "gm", label: "GM" },
  { id: "ceo", label: "CEO" },
  { id: "finance_pay", label: "Payment" },
  { id: "procurement_followup", label: "Follow-up" },
  { id: "done", label: "Closed" },
];

const STORES_NEXT: Record<"qs" | "pm" | "stores", string> = {
  qs: "QS Approved",
  pm: "PM Approved",
  stores: "Issued",
};

const PROCUREMENT_NEXT: Record<
  "finance_review" | "gm" | "ceo" | "finance_pay" | "procurement_followup",
  string
> = {
  finance_review: "Finance Reviewed",
  gm: "GM Approved",
  ceo: "CEO Approved",
  finance_pay: "Paid",
  procurement_followup: "Follow-up Complete",
};

export function materialStoresStage(status: string): MaterialStoresStage {
  const s = (status || "").trim();
  if (/^(rejected|declined|void|voided|cancelled|canceled)$/i.test(s)) return "rejected";
  if (/^(issued|fulfilled|complete|completed)$/i.test(s)) return "done";
  if (/^(pm approved|project\s*manager approved)$/i.test(s)) return "stores";
  if (/^(qs approved|quantity\s*surveyor approved)$/i.test(s)) return "pm";
  // Legacy payment-chain statuses on old requisitions → approximate stores path
  if (/^accounts?\s*assistant approved$/i.test(s)) return "pm";
  if (/^(gm approved|ceo approved|paid)$/i.test(s)) return "done";
  if (
    /^draft$/i.test(s) ||
    /^(returned for amendment|amendment required|needs amendment)$/i.test(s)
  ) {
    return "requestor";
  }
  if (/^(pending|submitted|awaiting approval|unapproved|open|in review)$/i.test(s)) {
    return "qs";
  }
  return "unknown";
}

export function materialProcurementStage(status: string): MaterialProcurementStage {
  const s = (status || "").trim();
  if (/^(rejected|declined|void|voided|cancelled|canceled)$/i.test(s)) return "rejected";
  if (/^(follow-?up complete|closed|complete|completed)$/i.test(s)) return "done";
  if (/^paid$/i.test(s)) return "procurement_followup";
  if (/^(ceo approved|approved)$/i.test(s)) return "finance_pay";
  if (/^gm approved$/i.test(s)) return "ceo";
  if (/^(finance reviewed|accounts?\s*assistant approved|aa approved)$/i.test(s)) {
    return "gm";
  }
  if (/^(pm approved|qs approved)$/i.test(s)) return "finance_review";
  if (
    /^draft$/i.test(s) ||
    /^(returned for amendment|amendment required|needs amendment)$/i.test(s)
  ) {
    return "requestor";
  }
  if (/^(pending|submitted|awaiting approval|unapproved|open|in review)$/i.test(s)) {
    return "finance_review";
  }
  return "unknown";
}

function roleMatches(role: string, pattern: RegExp): boolean {
  const r = (role || "").trim();
  if (!r) return false;
  // Admin may view every desk queue but does not auto-match stage roles.
  return pattern.test(r);
}

/** Contact / user role match for the material stage waiting on action. */
export function roleMatchesMaterialStage(
  role: string,
  stage: MaterialActionableStage,
): boolean {
  if (stage === "qs" || stage === "pm" || stage === "stores") {
    return roleMatches(role, STORES_ROLE[stage]);
  }
  return roleMatches(role, PROCUREMENT_ROLE[stage]);
}

/** Current actionable stage for email targeting, or null when none. */
export function materialActionableStage(
  status: string,
  path: MaterialFulfillmentPath,
): MaterialActionableStage | null {
  if (path === "stores") {
    const stage = materialStoresStage(status);
    if (stage === "qs" || stage === "pm" || stage === "stores") return stage;
    return null;
  }
  const stage = materialProcurementStage(status);
  if (
    stage === "finance_review" ||
    stage === "gm" ||
    stage === "ceo" ||
    stage === "finance_pay" ||
    stage === "procurement_followup"
  ) {
    return stage;
  }
  return null;
}

/** Regex used to match request-email contact roles for a material stage. */
export function materialStageContactRole(stage: MaterialActionableStage): RegExp {
  if (stage === "qs" || stage === "pm" || stage === "stores") {
    return STORES_ROLE[stage];
  }
  return PROCUREMENT_ROLE[stage];
}

export function materialRequestWaitingOn(
  status: string,
  path: MaterialFulfillmentPath,
): string {
  if (path === "stores") {
    const stage = materialStoresStage(status);
    if (stage === "requestor") return "Initiator (submit)";
    if (stage === "qs") return "Quantity Surveyor";
    if (stage === "pm") return "Project Manager";
    if (stage === "stores") return "Stores Manager";
    if (stage === "done") return "Issued";
    if (stage === "rejected") return "Rejected";
    return "—";
  }
  const stage = materialProcurementStage(status);
  if (stage === "requestor") return "Procurement (submit)";
  if (stage === "finance_review") return "Finance (review)";
  if (stage === "gm") return "General Manager";
  if (stage === "ceo") return "CEO";
  if (stage === "finance_pay") return "Finance (payment)";
  if (stage === "procurement_followup") return "Procurement (follow-up)";
  if (stage === "done") return "Closed";
  if (stage === "rejected") return "Rejected";
  return "—";
}

export function materialRequestProgress(
  status: string,
  path: MaterialFulfillmentPath,
): {
  waitingOn: string;
  chainLabel: string;
  steps: { id: string; label: string; done: boolean; current: boolean }[];
} {
  const chainLabel = materialChainLabel(path);
  const waitingOn = materialRequestWaitingOn(status, path);

  if (path === "stores") {
    const stage = materialStoresStage(status);
    const currentIndex =
      stage === "requestor"
        ? 0
        : stage === "qs"
          ? 1
          : stage === "pm"
            ? 2
            : stage === "stores"
              ? 3
              : stage === "done"
                ? 5
                : -1;
    return {
      waitingOn,
      chainLabel,
      steps: MATERIAL_STORES_TRACKER_STEPS.map((step, index) => ({
        id: step.id,
        label: step.label,
        done: currentIndex > index,
        current: currentIndex === index,
      })),
    };
  }

  const stage = materialProcurementStage(status);
  const currentIndex =
    stage === "requestor"
      ? 0
      : stage === "finance_review"
        ? 1
        : stage === "gm"
          ? 2
          : stage === "ceo"
            ? 3
            : stage === "finance_pay"
              ? 4
              : stage === "procurement_followup"
                ? 5
                : stage === "done"
                  ? 7
                  : -1;
  return {
    waitingOn,
    chainLabel,
    steps: MATERIAL_PROCUREMENT_TRACKER_STEPS.map((step, index) => ({
      id: step.id,
      label: step.label,
      done: currentIndex > index,
      current: currentIndex === index,
    })),
  };
}

export function materialRequestStepDates(
  record: Record<string, string | undefined | null> | null | undefined,
  path: MaterialFulfillmentPath,
): Record<string, string> {
  if (!record) return {};
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const raw = String(record[key] || "").trim();
      if (!raw) continue;
      const isoDay = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
      const d = isoDay ? new Date(`${isoDay}T12:00:00`) : new Date(raw);
      if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
      return d.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    }
    return "";
  };
  const status = String(record.status || "").trim();
  const leftDraft = status && !/^draft$/i.test(status);
  const requestor = leftDraft ? pick("submittedAt", "date", "createdAt") : "";

  if (path === "stores") {
    return {
      requestor,
      qs: pick("approvedByQsAt"),
      pm: pick("approvedByPmAt"),
      stores: pick("issuedByAt", "fulfilledDate"),
      issued: pick("fulfilledDate", "issuedByAt"),
    };
  }
  return {
    requestor,
    finance_review: pick("reviewedByFinanceAt"),
    gm: pick("approvedByGmAt"),
    ceo: pick("approvedByCeoAt"),
    finance_pay: pick("paidAt"),
    procurement_followup: pick("followedUpByAt"),
    done: pick("followedUpByAt", "paidAt"),
  };
}

export function canAdvanceMaterialRequest(
  status: string,
  role: string,
  path: MaterialFulfillmentPath,
): {
  ok: boolean;
  stage: MaterialActionableStage | "requestor" | "done" | "rejected" | "unknown";
  reason?: string;
  nextStatus?: string;
} {
  if (path === "stores") {
    const stage = materialStoresStage(status);
    if (stage === "done") {
      return { ok: false, stage, reason: "This material request is already issued." };
    }
    if (stage === "rejected") {
      return { ok: false, stage, reason: "This material request was rejected." };
    }
    if (stage === "requestor") {
      return {
        ok: false,
        stage,
        reason: "Initiator must submit first (Draft → Submitted).",
      };
    }
    if (stage === "unknown" || !(stage in STORES_NEXT)) {
      return { ok: false, stage, reason: "Status is not part of the stores issue chain." };
    }
    const actionable = stage as "qs" | "pm" | "stores";
    if (!roleMatches(role, STORES_ROLE[actionable])) {
      return {
        ok: false,
        stage: actionable,
        reason: `Waiting on ${materialRequestWaitingOn(status, path)}. Your role (${role || "none"}) cannot act.`,
      };
    }
    return { ok: true, stage: actionable, nextStatus: STORES_NEXT[actionable] };
  }

  const stage = materialProcurementStage(status);
  if (stage === "done") {
    return { ok: false, stage, reason: "This material request is already closed." };
  }
  if (stage === "rejected") {
    return { ok: false, stage, reason: "This material request was rejected." };
  }
  if (stage === "requestor") {
    return {
      ok: false,
      stage,
      reason: "Procurement must submit first (Draft → Submitted).",
    };
  }
  if (stage === "unknown" || !(stage in PROCUREMENT_NEXT)) {
    return {
      ok: false,
      stage,
      reason: "Status is not part of the procurement chain.",
    };
  }
  const actionable = stage as
    | "finance_review"
    | "gm"
    | "ceo"
    | "finance_pay"
    | "procurement_followup";
  if (!roleMatches(role, PROCUREMENT_ROLE[actionable])) {
    return {
      ok: false,
      stage: actionable,
      reason: `Waiting on ${materialRequestWaitingOn(status, path)}. Your role (${role || "none"}) cannot act.`,
    };
  }
  return { ok: true, stage: actionable, nextStatus: PROCUREMENT_NEXT[actionable] };
}

export function canRejectMaterialRequest(
  status: string,
  role: string,
  path: MaterialFulfillmentPath,
): boolean {
  // Same role that can advance at the current step can reject — except finance pay
  // (payment confirmation is locked, mirrors Go IsRejectableInFlightStatus).
  if (!isMaterialStatusRejectableInFlight(status, path)) return false;
  return canAdvanceMaterialRequest(status, role, path).ok;
}

/** Status-only in-flight check (mirrors Go IsRejectableInFlightStatus for material). */
export function isMaterialStatusRejectableInFlight(
  status: string,
  path: MaterialFulfillmentPath,
): boolean {
  if (path === "stores") {
    const stage = materialStoresStage(status);
    return stage === "qs" || stage === "pm" || stage === "stores";
  }
  const stage = materialProcurementStage(status);
  if (
    stage === "done" ||
    stage === "rejected" ||
    stage === "unknown" ||
    stage === "requestor"
  ) {
    return false;
  }
  // Finance payment confirmation after CEO — no reject / amend.
  if (stage === "finance_pay") return false;
  return (
    stage === "finance_review" ||
    stage === "gm" ||
    stage === "ceo" ||
    stage === "procurement_followup"
  );
}

export function materialAdvanceActionLabel(
  status: string,
  path: MaterialFulfillmentPath,
): string {
  if (path === "stores") {
    const stage = materialStoresStage(status);
    if (stage === "qs") return "Approve (QS)";
    if (stage === "pm") return "Approve (PM)";
    if (stage === "stores") return "Issue from stores";
    return "Approve";
  }
  const stage = materialProcurementStage(status);
  if (stage === "finance_review") return "Finance review";
  if (stage === "gm") return "Approve (GM)";
  if (stage === "ceo") return "Approve (CEO)";
  if (stage === "finance_pay") return "Make payment";
  if (stage === "procurement_followup") return "Complete follow-up";
  return "Approve";
}

export function materialRequestChainLockMessage(path: MaterialFulfillmentPath): string {
  return `Material request status can only change through the approval chain (${materialChainLabel(path)}).`;
}

export function assertMaterialRequestStatusChange(
  previousStatus: string | undefined,
  nextStatus: string,
  path: MaterialFulfillmentPath,
): string | null {
  const prev = (previousStatus || "Draft").trim();
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
  return materialRequestChainLockMessage(path);
}

export function pathFromRecord(
  record: Record<string, string | undefined | null> | null | undefined,
): MaterialFulfillmentPath {
  return materialFulfillmentPath(record?.fulfillmentPath || record?.stockPath || "");
}
