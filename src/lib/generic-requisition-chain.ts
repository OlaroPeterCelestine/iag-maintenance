/**
 * General + material request advances go through the Go approval API.
 * Local chain helpers remain for UI gating / status-lock on form edits.
 */
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecordsAsync, notifyPersistFailure } from "@/lib/records-store";
import { getCurrentSessionUser } from "@/lib/session-profile";
import { notifyRequestParties } from "@/lib/export/notify-request-email";
import { mutateApprovalViaApi, settleApprovalViaApi } from "@/lib/approval-api";
import { postRecordToLedger } from "@/lib/ledger/api-post";
import { parseAmount } from "@/lib/ledger/types";
import {
  assertRequisitionChainStatusChange,
  canAdvanceRequisitionStatus,
  canAmendRequisitionStatus,
  canRejectRequisitionStatus,
  isApprovalRequestOwner,
  isAdminRole,
  requisitionAdvanceActionLabel,
  requisitionChainStage,
  requisitionChainWaitingOn,
} from "@/lib/requisition-chain";
import {
  assertMaterialRequestStatusChange,
  canAdvanceMaterialRequest,
  canRejectMaterialRequest,
  isMaterialStatusRejectableInFlight,
  materialAdvanceActionLabel,
  materialRequestWaitingOn,
  pathFromRecord,
} from "@/lib/material-request-chain";
import {
  assertLeaveRequestStatusChange,
  canAdvanceLeaveRequest,
  canRejectLeaveRequest,
  isLeaveStatusRejectableInFlight,
  leaveAdvanceActionLabel,
  leaveChainWaitingOn,
} from "@/lib/leave-request-chain";

const STORES: Record<string, { module: string; entity: string }> = {
  requisitions: { module: "projects", entity: "requisitions" },
  "general-requests": { module: "requests", entity: "general-requests" },
  "fuel-requests": { module: "fleet", entity: "fuel-requests" },
  "trip-requests": { module: "fleet", entity: "trip-requests" },
  "maintenance-requests": { module: "fleet", entity: "maintenance-requests" },
  "equipment-and-vehicle-requests": {
    module: "projects",
    entity: "equipment-and-vehicle-requests",
  },
  "document-requests": { module: "projects", entity: "document-requests" },
  "leave-requests": { module: "payroll", entity: "leave-requests" },
};

function isMaterialEntity(entityKey: string) {
  return entityKey === "requisitions";
}

function isLeaveEntity(entityKey: string) {
  return entityKey === "leave-requests";
}

export function assertGenericRequisitionStatusChange(
  entityKey: string,
  previousStatus: string | undefined,
  nextStatus: string,
  record?: Record<string, string | undefined | null> | null,
): string | null {
  if (!STORES[entityKey]) return null;
  if (isMaterialEntity(entityKey)) {
    return assertMaterialRequestStatusChange(
      previousStatus,
      nextStatus,
      pathFromRecord(record),
    );
  }
  if (isLeaveEntity(entityKey)) {
    return assertLeaveRequestStatusChange(previousStatus, nextStatus);
  }
  return assertRequisitionChainStatusChange(previousStatus, nextStatus, entityKey);
}

export function canAdvanceGenericRequisition(
  entityKey: string,
  status: string,
  role = getCurrentSessionUser()?.role || "",
  record?: Record<string, string | undefined | null> | null,
) {
  if (!STORES[entityKey]) {
    return { ok: false as const, stage: "unknown" as const, reason: "Not a chained requisition." };
  }
  if (isMaterialEntity(entityKey)) {
    return canAdvanceMaterialRequest(status, role, pathFromRecord(record));
  }
  if (isLeaveEntity(entityKey)) {
    return canAdvanceLeaveRequest(status, role);
  }
  return canAdvanceRequisitionStatus(status, role, entityKey);
}

export function canRejectGenericRequisition(
  entityKey: string,
  status: string,
  role = getCurrentSessionUser()?.role || "",
  record?: Record<string, string | undefined | null> | null,
): boolean {
  if (!STORES[entityKey]) return false;
  if (isMaterialEntity(entityKey)) {
    return canRejectMaterialRequest(status, role, pathFromRecord(record));
  }
  if (isLeaveEntity(entityKey)) {
    return canRejectLeaveRequest(status, role);
  }
  return canRejectRequisitionStatus(status, role, entityKey);
}

export function canAmendGenericRequisition(
  entityKey: string,
  status: string,
  role = getCurrentSessionUser()?.role || "",
  record?: Record<string, string | undefined | null> | null,
): boolean {
  const user = getCurrentSessionUser();
  if (isMaterialEntity(entityKey)) {
    const path = pathFromRecord(record);
    if (canRejectMaterialRequest(status, role, path)) return true;
    if (!isMaterialStatusRejectableInFlight(status, path)) return false;
    if (isAdminRole(role)) return true;
    return isApprovalRequestOwner(record, user);
  }
  if (isLeaveEntity(entityKey)) {
    if (canRejectLeaveRequest(status, role)) return true;
    if (!isLeaveStatusRejectableInFlight(status)) return false;
    if (isAdminRole(role)) return true;
    return isApprovalRequestOwner(record, user);
  }
  return canAmendRequisitionStatus(status, role, entityKey, record, user);
}

export async function advanceGenericRequisition(
  entityKey: string,
  id: string,
  options?: {
    comment?: string;
    amount?: string;
    paymentMethod?: string;
    bankAccount?: string;
    forwardTo?: "ceo" | "finance";
  },
): Promise<{
  ok: boolean;
  error?: string;
  record?: ManagerRecord;
  nextStatus?: string;
  amended?: boolean;
}> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const store = STORES[entityKey];
  if (!store) return { ok: false, error: "Unsupported requisition type." };

  const existing = loadRecords(store.module, store.entity).find((row) => row.id === id);
  if (!existing) return { ok: false, error: "Request not found." };

  const role = getCurrentSessionUser()?.role || "";
  const gate = canAdvanceGenericRequisition(entityKey, existing.status || "", role, existing);
  if (!gate.ok) {
    return { ok: false, error: gate.reason || "Cannot advance this request." };
  }

  const comment = (options?.comment || "").trim();
  const amount = (options?.amount || "").trim();
  const paymentMethod = (options?.paymentMethod || "").trim();
  const bankAccount = (options?.bankAccount || "").trim();
  const forwardTo = options?.forwardTo;
  const isFinancePay =
    !isMaterialEntity(entityKey) &&
    !isLeaveEntity(entityKey) &&
    requisitionChainStage(existing.status || "", entityKey) === "finance";
  if (isFinancePay) {
    if (!paymentMethod) {
      return { ok: false, error: "Select a payment method before making payment." };
    }
    if (!bankAccount) {
      return { ok: false, error: "Select the bank / cash account to pay from." };
    }
  }

  // General requests: atomic Go settle (payment + Paid) — same orphan race as IPC/oral.
  if (isFinancePay && entityKey === "general-requests") {
    const amountChanging =
      Boolean(amount) &&
      String(parseAmount(amount)) !==
        String(parseAmount(existing.amount || existing.total || "0"));
    if (amountChanging && !comment) {
      return {
        ok: false,
        error: "Add a comment when changing the amount at payment.",
      };
    }
    const settled = await settleApprovalViaApi(entityKey, id, {
      paymentMethod,
      bankAccount,
      comment: comment || undefined,
      amount: amount || undefined,
    });
    if (!settled.ok || !settled.record) {
      return {
        ok: false,
        error: settled.error || "Settle API rejected this payment.",
      };
    }
    if (settled.payment && !settled.ledgerPosted) {
      const repaired = await postRecordToLedger("banking", "payments", settled.payment);
      if (!repaired.ok) {
        notifyPersistFailure(
          "banking/payments",
          repaired.error ||
            `${entityKey} request ${id} was marked Paid but the ledger repair posting failed.`,
        );
      }
    }
    notifyRequestParties({
      entityKey,
      record: settled.record,
      event: "paid",
      previousStatus: existing.status,
      comment: comment || undefined,
    });
    return { ok: true, record: settled.record, nextStatus: settled.nextStatus };
  }

  const api = await mutateApprovalViaApi(entityKey, id, "advance", {
    comment: comment || undefined,
    amount: amount || undefined,
    forwardTo,
  });
  if (!api.ok || !api.record) {
    return { ok: false, error: api.error || "Approval API rejected this advance." };
  }

  if (api.event === "amended") {
    notifyRequestParties({
      entityKey,
      record: api.record,
      event: "amended",
      previousStatus: existing.status,
      comment: comment || undefined,
    });
    return {
      ok: true,
      record: api.record,
      nextStatus: api.nextStatus,
      amended: true,
    };
  }

  let record = api.record;
  if (paymentMethod || bankAccount) {
    record = {
      ...record,
      ...(paymentMethod ? { paymentMethod } : {}),
      ...(bankAccount ? { bankAccount, paidFrom: bankAccount } : {}),
    };
    const rows = loadRecords(store.module, store.entity);
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) {
      const next = [...rows];
      next[index] = record;
      const saved = await saveRecordsAsync(store.module, store.entity, next);
      if (!saved.ok) {
        return {
          ok: false,
          error: saved.error || "Could not save payment details to the database.",
          record,
          nextStatus: api.nextStatus,
        };
      }
    }
  }

  notifyRequestParties({
    entityKey,
    record,
    event:
      api.event === "paid" ||
      /^(Paid|Issued|Follow-up Complete|Approved)$/i.test(api.nextStatus || "")
        ? "paid"
        : "advanced",
    previousStatus: existing.status,
    comment: comment || undefined,
  });

  return { ok: true, record, nextStatus: api.nextStatus };
}

export async function rejectGenericRequisition(
  entityKey: string,
  id: string,
  options?: { comment?: string; amount?: string },
): Promise<{ ok: boolean; error?: string; record?: ManagerRecord }> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const store = STORES[entityKey];
  if (!store) return { ok: false, error: "Unsupported requisition type." };

  const existing = loadRecords(store.module, store.entity).find((row) => row.id === id);
  if (!existing) return { ok: false, error: "Request not found." };

  const role = getCurrentSessionUser()?.role || "";
  if (!canRejectGenericRequisition(entityKey, existing.status || "", role, existing)) {
    const waiting = isMaterialEntity(entityKey)
      ? materialRequestWaitingOn(existing.status || "", pathFromRecord(existing))
      : isLeaveEntity(entityKey)
        ? leaveChainWaitingOn(existing.status || "")
        : requisitionChainWaitingOn(existing.status || "", entityKey);
    return {
      ok: false,
      error: `Waiting on ${waiting}. Your role cannot reject this step.`,
    };
  }

  const comment = (options?.comment || "").trim();
  if (!comment) {
    return {
      ok: false,
      error: "A reason is required when rejecting a request so the requestor knows what went wrong.",
    };
  }
  const amount = (options?.amount || "").trim();
  const api = await mutateApprovalViaApi(entityKey, id, "reject", {
    comment,
    amount: amount || undefined,
  });
  if (!api.ok || !api.record) {
    return { ok: false, error: api.error || "Approval API rejected this reject." };
  }

  notifyRequestParties({
    entityKey,
    record: api.record,
    event: "rejected",
    previousStatus: existing.status,
    comment,
  });

  return { ok: true, record: api.record };
}

export async function amendGenericRequisition(
  entityKey: string,
  id: string,
  options?: { comment?: string; amount?: string; returnMode?: "previous" },
): Promise<{ ok: boolean; error?: string; record?: ManagerRecord }> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const store = STORES[entityKey];
  if (!store) return { ok: false, error: "Unsupported requisition type." };

  const existing = loadRecords(store.module, store.entity).find((row) => row.id === id);
  if (!existing) return { ok: false, error: "Request not found." };

  const role = getCurrentSessionUser()?.role || "";
  if (!canAmendGenericRequisition(entityKey, existing.status || "", role, existing)) {
    const waiting = isMaterialEntity(entityKey)
      ? materialRequestWaitingOn(existing.status || "", pathFromRecord(existing))
      : isLeaveEntity(entityKey)
        ? leaveChainWaitingOn(existing.status || "")
        : requisitionChainWaitingOn(existing.status || "", entityKey);
    return {
      ok: false,
      error: `Waiting on ${waiting}. Your role cannot amend this step.`,
    };
  }

  const comment = (options?.comment || "").trim();
  if (!comment) {
    return {
      ok: false,
      error: "A comment is required when amending a request so the previous user knows what to change.",
    };
  }

  const amount = (options?.amount || "").trim();
  const api = await mutateApprovalViaApi(entityKey, id, "amend", {
    comment,
    amount: amount || undefined,
    returnMode: options?.returnMode,
  });
  if (!api.ok || !api.record) {
    return { ok: false, error: api.error || "Approval API rejected this amend." };
  }

  notifyRequestParties({
    entityKey,
    record: api.record,
    event: "amended",
    previousStatus: existing.status,
    comment,
  });

  return { ok: true, record: api.record };
}

export function genericRequisitionAdvanceLabel(
  status: string,
  entityKey?: string,
  record?: Record<string, string | undefined | null> | null,
): string {
  if (entityKey && isMaterialEntity(entityKey)) {
    return materialAdvanceActionLabel(status, pathFromRecord(record));
  }
  if (entityKey && isLeaveEntity(entityKey)) {
    return leaveAdvanceActionLabel(status);
  }
  return requisitionAdvanceActionLabel(status, entityKey);
}
