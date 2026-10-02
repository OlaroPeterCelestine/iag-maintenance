/**
 * Oral payment request approval chain — advances/rejects via Go API.
 * Finance Paid uses POST /api/approvals/.../settle (payment + Paid in one TX).
 */
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecordsAsync, notifyPersistFailure } from "@/lib/records-store";
import { getCurrentSessionUser } from "@/lib/session-profile";
import { parseAmount } from "@/lib/ledger/types";
import { postRecordToLedger } from "@/lib/ledger/api-post";
import { notifyRequestParties } from "@/lib/export/notify-request-email";
import { mutateApprovalViaApi, settleApprovalViaApi } from "@/lib/approval-api";
import {
  assertRequisitionChainStatusChange,
  canAdvanceRequisitionStatus,
  canAmendRequisitionStatus,
  canRejectRequisitionStatus,
  requisitionAdvanceActionLabel,
  requisitionChainProgress,
  requisitionChainStage,
  requisitionChainWaitingOn,
  roleMatchesRequisitionStage,
  type RequisitionActionableStage,
  type RequisitionChainStage,
  REQUISITION_CHAIN_STATUSES_NO_PM,
} from "@/lib/requisition-chain";

const MODULE = "requests";
const ENTITY = "oral-payment-requests";

export type OralChainStage = RequisitionChainStage;

export const ORAL_PAYMENT_STATUSES = REQUISITION_CHAIN_STATUSES_NO_PM;

export function oralChainStage(status: string): OralChainStage {
  return requisitionChainStage(status, ENTITY);
}

export function oralChainWaitingOn(status: string): string {
  return requisitionChainWaitingOn(status, ENTITY);
}

export function oralChainProgress(status: string) {
  return requisitionChainProgress(status, ENTITY);
}

export function roleMatchesOralStage(
  role: string,
  stage: RequisitionActionableStage | "reviewer" | "approver",
): boolean {
  if (stage === "reviewer") return roleMatchesRequisitionStage(role, "accounts");
  if (stage === "approver") return roleMatchesRequisitionStage(role, "ceo");
  return roleMatchesRequisitionStage(role, stage);
}

export function canAdvanceOralPaymentRequest(
  status: string,
  role = getCurrentSessionUser()?.role || "",
) {
  return canAdvanceRequisitionStatus(status, role, ENTITY);
}

export function canRejectOralPaymentRequest(
  status: string,
  role = getCurrentSessionUser()?.role || "",
): boolean {
  return canRejectRequisitionStatus(status, role, ENTITY);
}

export function canAmendOralPaymentRequest(
  status: string,
  role = getCurrentSessionUser()?.role || "",
  record?: Record<string, string | undefined | null> | null,
): boolean {
  return canAmendRequisitionStatus(status, role, ENTITY, record, getCurrentSessionUser());
}

function loadOralRequest(id: string): ManagerRecord | null {
  return loadRecords(MODULE, ENTITY).find((row) => row.id === id) || null;
}

export function assertOralPaymentRequestStatusChange(
  previousStatus: string | undefined,
  nextStatus: string,
): string | null {
  return assertRequisitionChainStatusChange(previousStatus, nextStatus, ENTITY);
}

/**
 * Settle oral payment cash via Go only — never invent banking payments in the browser.
 */
async function settleOralPaymentCash(
  request: ManagerRecord,
): Promise<{ ok: true; paymentId: string } | { ok: false; error: string }> {
  const amount = parseAmount(request.amount);
  if (amount <= 0) {
    return { ok: false, error: "Amount must be greater than zero before marking paid." };
  }

  const existingId = (request.paymentRecordId || "").trim();
  if (existingId) {
    const existing = loadRecords("banking", "payments").find((row) => row.id === existingId);
    if (existing) {
      const sync = await postRecordToLedger("banking", "payments", existing);
      if (!sync.ok) {
        return { ok: false, error: sync.error || "Could not post linked payment to the ledger." };
      }
      return { ok: true, paymentId: existing.id };
    }
  }

  const bankAccount = (request.bankAccount || request.paidFrom || "").trim();
  const paymentMethod = (request.paymentMethod || "").trim();
  if (!bankAccount || !paymentMethod) {
    return {
      ok: false,
      error:
        "Use Finance → Settle (Paid) with bank account and payment method. Cash settlement runs only on the Go API.",
    };
  }

  const settled = await settleApprovalViaApi(ENTITY, request.id, {
    paymentMethod,
    bankAccount,
    amount: String(amount),
  });
  if (!settled.ok) {
    return { ok: false, error: settled.error || "Settle API failed." };
  }
  const paymentId = (settled.paymentId || settled.record?.paymentRecordId || "").trim();
  if (!paymentId) {
    return {
      ok: false,
      error: "Settle API succeeded but did not return a banking payment id.",
    };
  }
  return { ok: true, paymentId };
}

/** If Paid but missing a banking payment (e.g. FE settle failed after API Paid), create/link it. */
export async function ensureOralPaymentCashSettled(
  id: string,
): Promise<
  { ok: true; paymentId: string; record: ManagerRecord } | { ok: false; error: string }
> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const existing = loadOralRequest(id);
  if (!existing) return { ok: false, error: "Oral payment request not found." };
  if (!/^paid$/i.test(existing.status || "")) {
    return { ok: false, error: "Request must be Paid before posting the banking payment." };
  }
  const settled = await settleOralPaymentCash(existing);
  if (!settled.ok) return settled;
  const record = { ...existing, paymentRecordId: settled.paymentId };
  const rows = loadRecords(MODULE, ENTITY);
  const index = rows.findIndex((row) => row.id === id);
  if (index >= 0) {
    const next = [...rows];
    next[index] = record;
    const linked = await saveRecordsAsync(MODULE, ENTITY, next);
    if (!linked.ok) {
      return {
        ok: false,
        error: linked.error || "Payment created but request link failed to save.",
      };
    }
  }
  return { ok: true, paymentId: settled.paymentId, record };
}

export async function advanceOralPaymentRequest(
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
  paymentId?: string;
  amended?: boolean;
}> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const existing = loadOralRequest(id);
  if (!existing) return { ok: false, error: "Oral payment request not found." };

  const user = getCurrentSessionUser();
  const gate = canAdvanceOralPaymentRequest(existing.status || "", user?.role || "");
  if (!gate.ok || !gate.nextStatus) {
    return { ok: false, error: gate.reason || "Cannot advance this oral request." };
  }

  const comment = (options?.comment || "").trim();
  const amount = (options?.amount || "").trim();
  const paymentMethod = (options?.paymentMethod || "").trim();
  const bankAccount = (options?.bankAccount || "").trim();
  const forwardTo = options?.forwardTo;
  const amountChanging =
    Boolean(amount) &&
    String(parseAmount(amount)) !== String(parseAmount(existing.amount || "0"));

  // Finance Paid: Go creates/links banking payment + marks Paid atomically.
  // Amount changes are allowed at settle when a comment is provided.
  if (gate.stage === "finance") {
    const checkAmount = amount
      ? parseAmount(amount)
      : parseAmount(existing.amount);
    if (checkAmount <= 0) {
      return { ok: false, error: "Amount must be greater than zero before marking paid." };
    }
    if (!paymentMethod) {
      return { ok: false, error: "Select a payment method before making payment." };
    }
    if (!bankAccount) {
      return { ok: false, error: "Select the bank / cash account to pay from." };
    }
    if (amountChanging && !comment) {
      return {
        ok: false,
        error: "Add a comment when changing the amount at payment.",
      };
    }

    const settled = await settleApprovalViaApi(ENTITY, id, {
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
            `Oral payment request ${id} was marked Paid but the ledger repair posting failed.`,
        );
      }
    }
    notifyRequestParties({
      entityKey: ENTITY,
      record: settled.record,
      event: "paid",
      previousStatus: existing.status,
      comment: comment || undefined,
    });
    return {
      ok: true,
      record: settled.record,
      nextStatus: settled.nextStatus,
      paymentId: settled.paymentId,
    };
  }

  const api = await mutateApprovalViaApi(ENTITY, id, "advance", {
    comment: comment || undefined,
    amount: amount || undefined,
    forwardTo,
  });
  if (!api.ok || !api.record) {
    return {
      ok: false,
      error: api.error || "Approval API rejected this advance.",
    };
  }

  if (api.event === "amended") {
    notifyRequestParties({
      entityKey: ENTITY,
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

  let record = {
    ...api.record,
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(bankAccount ? { bankAccount, paidFrom: bankAccount } : {}),
  } as ManagerRecord;
  let paymentId: string | undefined;

  // Safety net if Paid arrived without a prior settle.
  if (/^paid$/i.test(api.nextStatus || "")) {
    const cash = await settleOralPaymentCash(record);
    if (!cash.ok) {
      return { ok: false, error: cash.error, record, nextStatus: api.nextStatus };
    }
    paymentId = cash.paymentId;
    record = { ...record, paymentRecordId: paymentId, paymentId };
    const rows = loadRecords(MODULE, ENTITY);
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) {
      const next = [...rows];
      next[index] = record;
      const linked = await saveRecordsAsync(MODULE, ENTITY, next);
      if (!linked.ok) {
        return {
          ok: false,
          error: linked.error || "Payment created but request link failed to save.",
          record,
          nextStatus: api.nextStatus,
          paymentId,
        };
      }
    }
  }

  notifyRequestParties({
    entityKey: ENTITY,
    record,
    event: /^paid$/i.test(api.nextStatus || "") ? "paid" : "advanced",
    previousStatus: existing.status,
    comment: comment || undefined,
  });

  return { ok: true, record, nextStatus: api.nextStatus, paymentId };
}

export async function rejectOralPaymentRequest(
  id: string,
  options?: { comment?: string; amount?: string },
): Promise<{
  ok: boolean;
  error?: string;
  record?: ManagerRecord;
}> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const existing = loadOralRequest(id);
  if (!existing) return { ok: false, error: "Oral payment request not found." };

  const user = getCurrentSessionUser();
  if (!canRejectOralPaymentRequest(existing.status || "", user?.role || "")) {
    return {
      ok: false,
      error: `Waiting on ${oralChainWaitingOn(existing.status || "")}. Your role cannot reject this step.`,
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
  const api = await mutateApprovalViaApi(ENTITY, id, "reject", {
    comment,
    amount: amount || undefined,
  });
  if (!api.ok || !api.record) {
    return { ok: false, error: api.error || "Approval API rejected this reject." };
  }

  notifyRequestParties({
    entityKey: ENTITY,
    record: api.record,
    event: "rejected",
    previousStatus: existing.status,
    comment,
  });

  return { ok: true, record: api.record };
}

export async function amendOralPaymentRequest(
  id: string,
  options?: { comment?: string; amount?: string; returnMode?: "previous" },
): Promise<{
  ok: boolean;
  error?: string;
  record?: ManagerRecord;
}> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const existing = loadOralRequest(id);
  if (!existing) return { ok: false, error: "Oral payment request not found." };

  const user = getCurrentSessionUser();
  if (!canAmendOralPaymentRequest(existing.status || "", user?.role || "", existing)) {
    return {
      ok: false,
      error: `Waiting on ${oralChainWaitingOn(existing.status || "")}. Your role cannot amend this step.`,
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
  const api = await mutateApprovalViaApi(ENTITY, id, "amend", {
    comment,
    amount: amount || undefined,
    returnMode: options?.returnMode,
  });
  if (!api.ok || !api.record) {
    return { ok: false, error: api.error || "Approval API rejected this amend." };
  }

  notifyRequestParties({
    entityKey: ENTITY,
    record: api.record,
    event: "amended",
    previousStatus: existing.status,
    comment,
  });

  return { ok: true, record: api.record };
}

export function oralAdvanceActionLabel(status: string): string {
  return requisitionAdvanceActionLabel(status, ENTITY);
}
