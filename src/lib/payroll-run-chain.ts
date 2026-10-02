/**
 * Payroll run approval chain (no Project Manager):
 *   Requestor → Accounts Assistant → GM → CEO → Finance → Paid
 *
 * Create Payroll submits a run. Payslips + ledger accrual are created only when
 * Finance releases the run (status → Paid) after CEO approval.
 */
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";
import { getCurrentSessionUser } from "@/lib/session-profile";
import { notifyRequestParties } from "@/lib/export/notify-request-email";
import { mutateApprovalViaApi } from "@/lib/approval-api";
import {
  createPayrollForActiveEmployees,
  type PayrollOverride,
} from "@/lib/batch-payroll";
import { unsyncRecordFromLedger } from "@/lib/ledger/sync-record";
import { postRecordToLedger } from "@/lib/ledger/api-post";
import { parseAmount } from "@/lib/ledger/types";
import {
  assertRequisitionChainStatusChange,
  canAdvanceRequisitionStatus,
  canAmendRequisitionStatus,
  canRejectRequisitionStatus,
  requisitionAdvanceActionLabel,
  requisitionChainProgress,
  requisitionChainStage,
  requisitionChainWaitingOn,
  type RequisitionChainStage,
  REQUISITION_CHAIN_STATUSES_NO_PM,
} from "@/lib/requisition-chain";

const MODULE = "payroll";
export const PAYROLL_RUN_ENTITY = "payroll-runs";

export type PayrollRunChainStage = RequisitionChainStage;

export const PAYROLL_RUN_STATUSES = REQUISITION_CHAIN_STATUSES_NO_PM;

export function payrollRunChainStage(status: string): PayrollRunChainStage {
  return requisitionChainStage(status, PAYROLL_RUN_ENTITY);
}

export function payrollRunChainWaitingOn(status: string): string {
  return requisitionChainWaitingOn(status, PAYROLL_RUN_ENTITY);
}

export function payrollRunChainProgress(status: string) {
  return requisitionChainProgress(status, PAYROLL_RUN_ENTITY);
}

export function payrollRunAdvanceActionLabel(status: string): string {
  const stage = payrollRunChainStage(status);
  if (stage === "finance") return "Release payroll";
  return requisitionAdvanceActionLabel(status, PAYROLL_RUN_ENTITY);
}

export function canAdvancePayrollRun(
  status: string,
  role = getCurrentSessionUser()?.role || "",
) {
  return canAdvanceRequisitionStatus(status, role, PAYROLL_RUN_ENTITY);
}

export function canRejectPayrollRun(
  status: string,
  role = getCurrentSessionUser()?.role || "",
): boolean {
  return canRejectRequisitionStatus(status, role, PAYROLL_RUN_ENTITY);
}

export function canAmendPayrollRun(
  status: string,
  role = getCurrentSessionUser()?.role || "",
  record?: Record<string, string | undefined | null> | null,
): boolean {
  return canAmendRequisitionStatus(
    status,
    role,
    PAYROLL_RUN_ENTITY,
    record,
    getCurrentSessionUser(),
  );
}

export function assertPayrollRunStatusChange(
  previousStatus: string | undefined,
  nextStatus: string,
): string | null {
  return assertRequisitionChainStatusChange(
    previousStatus,
    nextStatus,
    PAYROLL_RUN_ENTITY,
  );
}

function loadPayrollRun(id: string): ManagerRecord | null {
  return loadRecords(MODULE, PAYROLL_RUN_ENTITY).find((row) => row.id === id) || null;
}

function parseOverrides(raw: string | undefined): Record<string, PayrollOverride> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, PayrollOverride>;
  } catch {
    return {};
  }
}

/**
 * After CEO → Finance marks Paid: materialize Unpaid payslips and post accrual.
 */
export async function settlePayrollRunPayslips(
  run: ManagerRecord,
): Promise<
  | { ok: true; createdCount: number; record: ManagerRecord }
  | { ok: false; error: string; record?: ManagerRecord }
> {
  if ((run.payslipsCreated || "").trim() === "true") {
    return { ok: true, createdCount: 0, record: run };
  }

  const payDate = (run.date || run.payDate || "").trim();
  if (!payDate) {
    return { ok: false, error: "Pay date is missing on this payroll run." };
  }

  const defaultDays = parseAmount(run.defaultDays) || 30;
  const overrides = parseOverrides(run.overridesJson);

  let created: ManagerRecord[];
  let skipped: { employee: string; reason: string }[];
  let previousPayslips: ManagerRecord[];
  try {
    ({ created, skipped, previousPayslips } = await createPayrollForActiveEmployees({
      payDate,
      daysWorked: defaultDays,
      skipExistingSameDate: true,
      overrides,
      payrollRunId: run.id,
    }));
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not create payslips for this run.",
      record: run,
    };
  }

  if (!created.length) {
    return {
      ok: false,
      error: skipped.length
        ? skipped
            .slice(0, 4)
            .map((s) => `${s.employee}: ${s.reason}`)
            .join(" · ")
        : "No payslips could be created for this run.",
      record: run,
    };
  }

  const synced: string[] = [];
  const failed: string[] = [];
  for (const slip of created) {
    const result = await postRecordToLedger("payroll", "payslips", slip);
    if (result.ok) synced.push(slip.id);
    else {
      failed.push(slip.employee || slip.reference);
      unsyncRecordFromLedger(slip.id);
    }
  }

  if (failed.length) {
    const kept = created.filter((s) => synced.includes(s.id));
    const keptSaved = await saveRecords("payroll", "payslips", [...kept, ...previousPayslips]);
    for (const slip of created) {
      if (!synced.includes(slip.id)) unsyncRecordFromLedger(slip.id);
    }
    if (!keptSaved.ok || keptSaved.durable !== "postgres") {
      notifyPersistFailure(
        "payroll/payslips",
        keptSaved.error || "Could not save posted payslips after a partial failure.",
      );
    }
    return {
      ok: false,
      error: `${kept.length} payslip(s) created · ${failed.length} failed to post: ${failed
        .slice(0, 3)
        .join(", ")}`,
      record: run,
    };
  }

  const now = new Date().toISOString();
  const record: ManagerRecord = {
    ...run,
    payslipsCreated: "true",
    payslipCount: String(created.length),
    payslipIds: created.map((s) => s.id).join(","),
    updatedAt: now,
  };
  const rows = loadRecords(MODULE, PAYROLL_RUN_ENTITY);
  const index = rows.findIndex((row) => row.id === run.id);
  if (index >= 0) {
    const next = [...rows];
    next[index] = record;
    const runSaved = await saveRecords(MODULE, PAYROLL_RUN_ENTITY, next);
    if (!runSaved.ok || runSaved.durable !== "postgres") {
      notifyPersistFailure(
        `${MODULE}/${PAYROLL_RUN_ENTITY}`,
        runSaved.error ||
          "Payslips were created and posted, but the payroll run could not be marked settled. Retrying may create duplicate payslips.",
      );
      return {
        ok: false,
        error:
          runSaved.error ||
          "Payslips were posted but the payroll run status failed to save. Do not retry — check the payroll run before advancing again.",
        record: run,
      };
    }
  }

  return { ok: true, createdCount: created.length, record };
}

export async function advancePayrollRun(
  id: string,
  options?: { comment?: string; amount?: string; forwardTo?: "ceo" | "finance" },
): Promise<{
  ok: boolean;
  error?: string;
  record?: ManagerRecord;
  nextStatus?: string;
  amended?: boolean;
  createdCount?: number;
}> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const existing = loadPayrollRun(id);
  if (!existing) return { ok: false, error: "Payroll run not found." };

  const user = getCurrentSessionUser();
  const gate = canAdvancePayrollRun(existing.status || "", user?.role || "");
  if (!gate.ok || !gate.nextStatus) {
    return { ok: false, error: gate.reason || "Cannot advance this payroll run." };
  }

  const comment = (options?.comment || "").trim();
  const amount = (options?.amount || "").trim();
  const forwardTo = options?.forwardTo;

  const api = await mutateApprovalViaApi(PAYROLL_RUN_ENTITY, id, "advance", {
    comment: comment || undefined,
    amount: amount || undefined,
    forwardTo,
  });
  if (!api.ok || !api.record) {
    return { ok: false, error: api.error || "Approval API rejected this advance." };
  }

  if (api.event === "amended") {
    notifyRequestParties({
      entityKey: PAYROLL_RUN_ENTITY,
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
  let createdCount = 0;
  if (gate.stage === "finance" || /^paid$/i.test(api.nextStatus || "")) {
    const settled = await settlePayrollRunPayslips(record);
    if (!settled.ok) {
      return {
        ok: false,
        error: settled.error,
        record: settled.record || record,
        nextStatus: api.nextStatus,
      };
    }
    record = settled.record;
    createdCount = settled.createdCount;
  }

  notifyRequestParties({
    entityKey: PAYROLL_RUN_ENTITY,
    record,
    event: /^paid$/i.test(api.nextStatus || "") ? "paid" : "advanced",
    previousStatus: existing.status,
    comment: comment || undefined,
  });

  return { ok: true, record, nextStatus: api.nextStatus, createdCount };
}

export async function rejectPayrollRun(
  id: string,
  options?: { comment?: string; amount?: string },
): Promise<{ ok: boolean; error?: string; record?: ManagerRecord }> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const existing = loadPayrollRun(id);
  if (!existing) return { ok: false, error: "Payroll run not found." };

  const role = getCurrentSessionUser()?.role || "";
  if (!canRejectPayrollRun(existing.status || "", role)) {
    return {
      ok: false,
      error: `Waiting on ${payrollRunChainWaitingOn(existing.status || "")}. Your role cannot reject this step.`,
    };
  }

  const comment = (options?.comment || "").trim();
  if (!comment) {
    return {
      ok: false,
      error: "A reason is required when rejecting a payroll run.",
    };
  }

  const api = await mutateApprovalViaApi(PAYROLL_RUN_ENTITY, id, "reject", {
    comment,
    amount: (options?.amount || "").trim() || undefined,
  });
  if (!api.ok || !api.record) {
    return { ok: false, error: api.error || "Approval API rejected this reject." };
  }

  notifyRequestParties({
    entityKey: PAYROLL_RUN_ENTITY,
    record: api.record,
    event: "rejected",
    previousStatus: existing.status,
    comment,
  });

  return { ok: true, record: api.record };
}

export async function amendPayrollRun(
  id: string,
  options?: { comment?: string; amount?: string; returnMode?: "previous" },
): Promise<{ ok: boolean; error?: string; record?: ManagerRecord }> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const existing = loadPayrollRun(id);
  if (!existing) return { ok: false, error: "Payroll run not found." };

  const role = getCurrentSessionUser()?.role || "";
  if (!canAmendPayrollRun(existing.status || "", role, existing)) {
    return {
      ok: false,
      error: `Waiting on ${payrollRunChainWaitingOn(existing.status || "")}. Your role cannot amend this step.`,
    };
  }

  const comment = (options?.comment || "").trim();
  if (!comment) {
    return {
      ok: false,
      error: "A comment is required when amending a payroll run.",
    };
  }

  const api = await mutateApprovalViaApi(PAYROLL_RUN_ENTITY, id, "amend", {
    comment,
    amount: (options?.amount || "").trim() || undefined,
    returnMode: options?.returnMode,
  });
  if (!api.ok || !api.record) {
    return { ok: false, error: api.error || "Approval API rejected this amend." };
  }

  notifyRequestParties({
    entityKey: PAYROLL_RUN_ENTITY,
    record: api.record,
    event: "amended",
    previousStatus: existing.status,
    comment,
  });

  return { ok: true, record: api.record };
}
