/**
 * Role-scoped approval desks (HR / PM / Accounts / GM / CEO / Finance / QS / Stores / Procurement).
 * Same route; label, widgets, and queue depend on the signed-in role.
 */
import {
  isAdminRole,
  roleMatchesPaymentStage,
  type PaymentChainStage,
} from "@/lib/payment-approval-chain";
import type { PaymentRequestMonitorRow } from "@/lib/payment-requests-monitor";
import type { ManagerRecord } from "@/lib/manager-entities";
import { hrefForRecordDetail } from "@/lib/module-data";
import { parseAmount } from "@/lib/ledger/types";
import { loadRecords } from "@/lib/records-store";
import { getCurrentSessionUser } from "@/lib/session-profile";
import {
  REQUISITION_CHAIN_LABEL,
  REQUISITION_CHAIN_ENTITIES,
  requisitionChainStage,
  requisitionChainWaitingOn,
} from "@/lib/requisition-chain";
import {
  leaveChainStage,
  leaveChainWaitingOn,
  roleMatchesLeaveStage,
} from "@/lib/leave-request-chain";
import {
  materialProcurementStage,
  materialStoresStage,
  pathFromRecord,
  roleMatchesMaterialStage,
} from "@/lib/material-request-chain";

export type ApprovalDeskKind =
  | "hod"
  | "hr"
  | "pm"
  | "accounts"
  | "gm"
  | "ceo"
  | "finance"
  | "qs"
  | "stores"
  | "procurement"
  | "admin";

export type ApprovalDeskProfile = {
  kind: ApprovalDeskKind;
  navLabel: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  stage:
    | Exclude<PaymentChainStage, "done" | "rejected" | "unknown" | "requestor">
    | "hod"
    | "hr"
    | "qs"
    | "stores"
    | "procurement"
    | null;
  showBusinessWidgets: boolean;
  showExecutiveTabs: boolean;
  showDocuments: boolean;
};

const PROFILES: Record<ApprovalDeskKind, ApprovalDeskProfile> = {
  hod: {
    kind: "hod",
    navLabel: "HOD desk",
    eyebrow: "Leave",
    title: "HOD desk",
    subtitle:
      "Only leave requests waiting on Head of Department. Approve here to send them to HR.",
    stage: "hod",
    showBusinessWidgets: false,
    showExecutiveTabs: false,
    showDocuments: false,
  },
  hr: {
    kind: "hr",
    navLabel: "HR desk",
    eyebrow: "Leave",
    title: "HR desk",
    subtitle:
      "Only leave requests waiting on HR after HOD approval. Approve here to complete the leave chain.",
    stage: "hr",
    showBusinessWidgets: false,
    showExecutiveTabs: false,
    showDocuments: false,
  },
  pm: {
    kind: "pm",
    navLabel: "PM desk",
    eyebrow: "Approvals",
    title: "Project Manager desk",
    subtitle:
      "QS-approved material requests on the stores path waiting on PM. Payment requests skip this desk (Accounts → GM → CEO).",
    stage: "pm",
    showBusinessWidgets: false,
    showExecutiveTabs: false,
    showDocuments: false,
  },
  accounts: {
    kind: "accounts",
    navLabel: "Accounts desk",
    eyebrow: "Approvals",
    title: "Accounts desk",
    subtitle:
      "Submitted payments / oral / general / fleet / payroll waiting on Accounts, plus CEO-approved Make payment / Release payroll (shared with Finance).",
    stage: "accounts",
    showBusinessWidgets: false,
    showExecutiveTabs: false,
    showDocuments: false,
  },
  gm: {
    kind: "gm",
    navLabel: "GM desk",
    eyebrow: "Approvals",
    title: "GM desk",
    subtitle:
      "Accounts-approved payments and material procurement. Forward to CEO or skip CEO and send to Finance for payment.",
    stage: "gm",
    showBusinessWidgets: false,
    showExecutiveTabs: false,
    showDocuments: false,
  },
  ceo: {
    kind: "ceo",
    navLabel: "CEO desk",
    eyebrow: "Executive",
    title: "CEO desk",
    subtitle:
      "Business overview plus payments, oral/general, fleet, payroll runs, and material procurement waiting on CEO approval.",
    stage: "ceo",
    showBusinessWidgets: true,
    showExecutiveTabs: true,
    showDocuments: true,
  },
  finance: {
    kind: "finance",
    navLabel: "Finance desk",
    eyebrow: "Payments",
    title: "Finance desk",
    subtitle:
      "After CEO approval — Make payment / Release payroll is your task (shared finance department queue).",
    stage: "finance",
    showBusinessWidgets: false,
    showExecutiveTabs: false,
    showDocuments: false,
  },
  qs: {
    kind: "qs",
    navLabel: "QS desk",
    eyebrow: "Materials",
    title: "Quantity Surveyor desk",
    subtitle: "Only Submitted material requests on the stores path waiting on QS.",
    stage: "qs",
    showBusinessWidgets: false,
    showExecutiveTabs: false,
    showDocuments: false,
  },
  stores: {
    kind: "stores",
    navLabel: "Stores desk",
    eyebrow: "Materials",
    title: "Stores desk",
    subtitle: "Only PM-approved material requests waiting to be issued from stores.",
    stage: "stores",
    showBusinessWidgets: false,
    showExecutiveTabs: false,
    showDocuments: false,
  },
  procurement: {
    kind: "procurement",
    navLabel: "Procurement desk",
    eyebrow: "Materials",
    title: "Procurement desk",
    subtitle: "Material procurement follow-up after Finance marks paid.",
    stage: "procurement",
    showBusinessWidgets: false,
    showExecutiveTabs: false,
    showDocuments: false,
  },
  admin: {
    kind: "admin",
    navLabel: "Approval desk",
    eyebrow: "Executive",
    title: "Approval desk",
    subtitle: `Full queue: project (${REQUISITION_CHAIN_LABEL}), oral/general, payroll runs, leave, and material. Each role still only acts on its own step.`,
    stage: null,
    showBusinessWidgets: true,
    showExecutiveTabs: true,
    showDocuments: true,
  },
};

/** Map a role string to a desk profile, or null if they have no approval desk. */
export function approvalDeskForRole(role: string): ApprovalDeskProfile | null {
  const r = (role || "").trim();
  if (!r) return null;
  if (isAdminRole(r)) return PROFILES.admin;
  if (roleMatchesMaterialStage(r, "qs")) return PROFILES.qs;
  if (roleMatchesMaterialStage(r, "stores")) return PROFILES.stores;
  if (roleMatchesMaterialStage(r, "procurement_followup")) return PROFILES.procurement;
  // Leave desks before other matches so "HR Manager" / "Department Head" are not swallowed.
  if (roleMatchesLeaveStage(r, "hr")) return PROFILES.hr;
  if (roleMatchesLeaveStage(r, "hod")) return PROFILES.hod;
  if (roleMatchesPaymentStage(r, "ceo")) return PROFILES.ceo;
  if (roleMatchesPaymentStage(r, "gm")) return PROFILES.gm;
  if (roleMatchesPaymentStage(r, "accounts")) return PROFILES.accounts;
  if (roleMatchesPaymentStage(r, "pm")) return PROFILES.pm;
  if (roleMatchesPaymentStage(r, "finance")) return PROFILES.finance;
  return null;
}

export function currentApprovalDesk(): ApprovalDeskProfile | null {
  if (typeof window === "undefined") return null;
  return approvalDeskForRole(getCurrentSessionUser()?.role || "");
}

export function canAccessApprovalDesk(role?: string): boolean {
  const r =
    role ??
    (typeof window !== "undefined" ? getCurrentSessionUser()?.role || "" : "");
  return approvalDeskForRole(r) !== null;
}

const ACTIONABLE: Array<
  Exclude<PaymentChainStage, "done" | "rejected" | "unknown" | "requestor">
> = ["pm", "accounts", "gm", "ceo", "finance"];

/** Module for each standard chained approval entity (includes material). */
export const DESK_ENTITY_MODULES: Record<string, string> = {
  "payment-requests": "projects",
  "oral-payment-requests": "requests",
  "general-requests": "requests",
  "fuel-requests": "fleet",
  "trip-requests": "fleet",
  "maintenance-requests": "fleet",
  "equipment-and-vehicle-requests": "projects",
  "document-requests": "projects",
  "leave-requests": "payroll",
  "payroll-runs": "payroll",
  requisitions: "projects",
};

const DESK_ENTITIES = new Set([...REQUISITION_CHAIN_ENTITIES, "requisitions"]);

function materialStageForRecord(record: ManagerRecord | Record<string, string | undefined>) {
  const path = pathFromRecord(record);
  const status = String(record.status || "");
  return path === "procurement"
    ? materialProcurementStage(status)
    : materialStoresStage(status);
}

function materialRowIsAwaiting(record: ManagerRecord): boolean {
  const stage = materialStageForRecord(record);
  return ![
    "requestor",
    "done",
    "rejected",
    "unknown",
  ].includes(stage);
}

function materialDeskOwns(
  profile: ApprovalDeskProfile,
  record: ManagerRecord,
): boolean {
  const path = pathFromRecord(record);
  const stage = materialStageForRecord(record);
  if (profile.kind === "admin") return materialRowIsAwaiting(record);
  if (profile.kind === "qs") return path === "stores" && stage === "qs";
  if (profile.kind === "stores") return path === "stores" && stage === "stores";
  if (profile.kind === "procurement") {
    return path === "procurement" && stage === "procurement_followup";
  }
  if (profile.kind === "pm") return path === "stores" && stage === "pm";
  // Finance department: Finance desk + Accounts desk share procurement finance steps.
  if (profile.kind === "finance" || profile.kind === "accounts") {
    return (
      path === "procurement" &&
      (stage === "finance_review" || stage === "finance_pay")
    );
  }
  if (profile.kind === "gm") return path === "procurement" && stage === "gm";
  if (profile.kind === "ceo") return path === "procurement" && stage === "ceo";
  return false;
}

/** Full Postgres-backed record for a desk queue row (oral, general, project payment, etc.). */
export function getApprovalDeskRecord(
  entityKey: string | undefined,
  id: string,
): ManagerRecord | null {
  if (typeof window === "undefined" || !id) return null;
  const entity = entityKey || "payment-requests";
  const moduleSlug = DESK_ENTITY_MODULES[entity];
  if (!moduleSlug) return null;
  return loadRecords(moduleSlug, entity).find((row) => row.id === id) || null;
}

export function deskRequestTypeLabel(entityKey: string | undefined): string {
  const entity = entityKey || "payment-requests";
  if (entity === "oral-payment-requests") return "Oral payment request";
  if (entity === "general-requests") return "General request";
  if (entity === "leave-requests") return "Leave request";
  if (entity === "payroll-runs") return "Payroll run";
  if (entity === "payment-requests") return "Payment request";
  if (entity === "requisitions") return "Material request";
  return entity
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sourceLabelFor(entityKey: string): string {
  return entityKey
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function chainStageForEntity(entityKey: string, status: string) {
  if (entityKey === "leave-requests") return leaveChainStage(status);
  // Pass entityKey so oral/general/fleet map Submitted → accounts (no PM).
  return requisitionChainStage(status, entityKey);
}

function waitingOnForEntity(entityKey: string, status: string) {
  if (entityKey === "leave-requests") return leaveChainWaitingOn(status);
  return requisitionChainWaitingOn(status, entityKey);
}

function rowIsAwaiting(entityKey: string, status: string): boolean {
  if (entityKey === "leave-requests") {
    const stage = leaveChainStage(status);
    return stage === "hod" || stage === "hr";
  }
  return ACTIONABLE.includes(
    chainStageForEntity(entityKey, status) as (typeof ACTIONABLE)[number],
  );
}

/**
 * All chained request types for the approval desk (payments, leave, material).
 */
export function listAllApprovalDeskRequests(): PaymentRequestMonitorRow[] {
  if (typeof window === "undefined") return [];
  const today = new Date().toISOString().slice(0, 10);
  const out: PaymentRequestMonitorRow[] = [];

  for (const entity of DESK_ENTITIES) {
    const moduleSlug = DESK_ENTITY_MODULES[entity];
    if (!moduleSlug) continue;
    const rows = loadRecords(moduleSlug, entity);
    for (const record of rows) {
      const reference =
        String(record.reference || record.name || record.code || "").trim() || String(record.id || "").slice(0, 10);
      const dueDate = String(record.dueDate || record.neededBy || record.endDate || "").trim();
      const status = String(record.status || "Draft").trim();
      const awaiting =
        entity === "requisitions"
          ? materialRowIsAwaiting(record)
          : rowIsAwaiting(entity, status);
      const overdue = Boolean(dueDate) && dueDate < today && awaiting;
      const waitingOn =
        entity === "requisitions"
          ? (() => {
              const path = pathFromRecord(record);
              const stage = materialStageForRecord(record);
              if (path === "stores") {
                if (stage === "qs") return "Quantity Surveyor";
                if (stage === "pm") return "Project Manager";
                if (stage === "stores") return "Stores Manager";
              }
              if (stage === "finance_review" || stage === "finance_pay") return "Finance";
              if (stage === "gm") return "General Manager";
              if (stage === "ceo") return "CEO";
              if (stage === "procurement_followup") return "Procurement";
              return waitingOnForEntity(entity, status);
            })()
          : waitingOnForEntity(entity, status);
      out.push({
        id: record.id,
        reference,
        date: record.date || record.issueDate || record.startDate || "",
        dueDate,
        department: record.department || "",
        project: record.project || "",
        payTo: record.payTo || "",
        payee:
          record.payee ||
          record.contractor ||
          record.party ||
          record.requestedBy ||
          record.employee ||
          record.driver ||
          "",
        contractor: record.contractor || "",
        amount: parseAmount(record.amount || record.total || record.estimatedCost || "0"),
        currency: record.currency || "UGX",
        status,
        description:
          record.description ||
          record.subject ||
          record.notes ||
          record.purpose ||
          record.reason ||
          "",
        href: hrefForRecordDetail(moduleSlug, entity, record.id),
        overdue,
        awaiting,
        waitingOn,
        sourceLabel: sourceLabelFor(entity),
        sourceRef: reference,
        sourceHref: hrefForRecordDetail(moduleSlug, entity, record.id),
        entityKey: entity,
      });
    }
  }

  return out.sort((a, b) => {
    if (a.awaiting !== b.awaiting) return a.awaiting ? -1 : 1;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return (b.date || "").localeCompare(a.date || "") || a.reference.localeCompare(b.reference);
  });
}

/** Payments / requests waiting on this desk's stage (admin: still in chain). */
export function filterPaymentsForDesk(
  payments: PaymentRequestMonitorRow[],
  profile: ApprovalDeskProfile,
): PaymentRequestMonitorRow[] {
  return payments.filter((row) => {
    const entity = row.entityKey || "payment-requests";

    if (entity === "requisitions") {
      const record = getApprovalDeskRecord(entity, row.id);
      if (!record) return false;
      return materialDeskOwns(profile, record);
    }

    if (!profile.stage) {
      if (entity === "requisitions") {
        const record = getApprovalDeskRecord(entity, row.id);
        return record ? materialRowIsAwaiting(record) : false;
      }
      return rowIsAwaiting(entity, row.status);
    }

    if (profile.stage === "qs" || profile.stage === "stores" || profile.stage === "procurement") {
      return false;
    }

    if (profile.stage === "hod") {
      return entity === "leave-requests" && leaveChainStage(row.status) === "hod";
    }

    if (profile.stage === "hr") {
      return entity === "leave-requests" && leaveChainStage(row.status) === "hr";
    }

    if (profile.stage === "gm") {
      if (entity === "leave-requests") return false;
      return chainStageForEntity(entity, row.status) === "gm";
    }

    if (entity === "leave-requests") return false;
    const stage = chainStageForEntity(entity, row.status);
    // Accounts Assistant / Accountant share Make payment with Finance after CEO.
    if (profile.stage === "accounts") {
      return stage === "accounts" || stage === "finance";
    }
    return stage === profile.stage;
  });
}

/** True when this row is in the signed-in role's desk queue (admin: any actionable). */
export function deskOwnsRow(
  row: PaymentRequestMonitorRow,
  profile: ApprovalDeskProfile | null | undefined,
): boolean {
  if (!profile) return false;
  return filterPaymentsForDesk([row], profile).length > 0;
}

export function countDeskPending(
  payments: PaymentRequestMonitorRow[],
  profile: ApprovalDeskProfile,
): number {
  return filterPaymentsForDesk(payments, profile).length;
}

/**
 * Sidebar badge — scan all chained request statuses in memory.
 */
export function countSidebarApprovalsPending(profile: ApprovalDeskProfile): number {
  if (typeof window === "undefined") return 0;
  return filterPaymentsForDesk(listAllApprovalDeskRequests(), profile).length;
}

/** Map Go `/api/approvals/desk` items into the desk table row shape. */
export function monitorRowsFromDeskApiItems(
  items: Array<{
    id?: string;
    entity?: string;
    reference?: string;
    typeLabel?: string;
    status?: string;
    waitingOn?: string;
    date?: string;
    dueDate?: string;
    department?: string;
    project?: string;
    payee?: string;
    amount?: string;
    currency?: string;
    description?: string;
    attention?: string;
  }>,
): PaymentRequestMonitorRow[] {
  const today = new Date().toISOString().slice(0, 10);
  const out: PaymentRequestMonitorRow[] = [];
  for (const item of items) {
    const id = String(item.id || "").trim();
    if (!id) continue;
    const entity = String(item.entity || "payment-requests").trim();
    const moduleSlug = DESK_ENTITY_MODULES[entity] || "projects";
    const reference = String(item.reference || id.slice(0, 10)).trim();
    const status = String(item.status || "Draft").trim();
    const dueDate = String(item.dueDate || "").trim();
    const attentionKind = String(item.attention || "").trim();
    const awaiting = attentionKind
      ? true
      : entity === "requisitions"
        ? (() => {
            const seeded = getApprovalDeskRecord(entity, id);
            return seeded
              ? materialRowIsAwaiting(seeded)
              : !/^(draft|rejected|declined|issued|paid|approved)$/i.test(status);
          })()
        : rowIsAwaiting(entity, status);
    const overdue = Boolean(dueDate) && dueDate < today && awaiting;
    const amountRaw = String(item.amount || "0");
    out.push({
      id,
      reference,
      date: String(item.date || "").trim(),
      dueDate,
      department: String(item.department || "").trim(),
      project: String(item.project || "").trim(),
      payTo: "",
      payee: String(item.payee || "").trim(),
      contractor: "",
      amount: parseAmount(amountRaw),
      currency: String(item.currency || "UGX").trim() || "UGX",
      status,
      description: String(item.description || "").trim(),
      href: hrefForRecordDetail(moduleSlug, entity, id),
      overdue,
      awaiting,
      waitingOn:
        String(item.waitingOn || "").trim() || waitingOnForEntity(entity, status),
      sourceLabel: String(item.typeLabel || "").trim() || sourceLabelFor(entity),
      sourceRef: reference,
      sourceHref: hrefForRecordDetail(moduleSlug, entity, id),
      entityKey: entity,
    });
  }
  return out.sort((a, b) => {
    if (a.awaiting !== b.awaiting) return a.awaiting ? -1 : 1;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return (b.date || "").localeCompare(a.date || "") || a.reference.localeCompare(b.reference);
  });
}

/** True when a records-changed event touches an approval-desk entity. */
export function isApprovalDeskEntityEvent(entity?: string, module?: string): boolean {
  if (!entity) return false;
  const mapped = DESK_ENTITY_MODULES[entity];
  if (!mapped) return false;
  if (module && module !== mapped) return false;
  return true;
}
