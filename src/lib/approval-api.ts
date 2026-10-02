/**
 * Approval advances/rejects go through the Go API (/api/approvals/…).
 * The API mutates Postgres entity_records; the browser applies the returned record to memory.
 */
import { apiFetch } from "@/lib/api-auth";
import type { ManagerRecord } from "@/lib/manager-entities";
import {
  getMemoryLedgerLines,
  getMemoryRecords,
  setMemoryLedgerLines,
  setMemoryRecords,
} from "@/lib/db/client-store";
import { adoptLedgerLinesRevision } from "@/lib/db/sync";
import { saveRecordsAsync } from "@/lib/records-store";
import { suppressRequestPopups } from "@/lib/request-popup-notifications";
import type { LedgerLine } from "@/lib/ledger/types";

export type ApprovalApiEntity =
  | "payment-requests"
  | "oral-payment-requests"
  | "requisitions"
  | "general-requests"
  | "fuel-requests"
  | "trip-requests"
  | "maintenance-requests"
  | "equipment-and-vehicle-requests"
  | "document-requests"
  | "leave-requests"
  | "payroll-runs";

export const APPROVAL_ENTITY_MODULE: Record<string, string> = {
  "payment-requests": "projects",
  "oral-payment-requests": "requests",
  requisitions: "projects",
  "general-requests": "requests",
  "fuel-requests": "fleet",
  "trip-requests": "fleet",
  "maintenance-requests": "fleet",
  "equipment-and-vehicle-requests": "projects",
  "document-requests": "projects",
  "leave-requests": "payroll",
  "payroll-runs": "payroll",
};

export type ApprovalMutationResult = {
  ok: boolean;
  status?: string;
  previousStatus?: string;
  nextStatus?: string;
  waitingOn?: string;
  label?: string;
  event?: string;
  record?: ManagerRecord;
  error?: string;
};

function asRecord(raw: unknown, fallbackId: string): ManagerRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, unknown>;
  const now = new Date().toISOString();
  const shaped: ManagerRecord = {
    id: String(src.id || fallbackId),
    createdAt: String(src.createdAt || now),
    updatedAt: String(src.updatedAt || now),
  };
  for (const [key, value] of Object.entries(src)) {
    if (key === "id" || key === "createdAt" || key === "updatedAt") continue;
    if (value == null) continue;
    shaped[key] = typeof value === "string" ? value : String(value);
  }
  return shaped;
}

/** Apply API-returned record into browser memory only (API already wrote Postgres). */
export function applyApprovalApiRecord(
  entity: string,
  record: ManagerRecord,
): void {
  if (typeof window === "undefined") return;
  const moduleSlug = APPROVAL_ENTITY_MODULE[entity];
  if (!moduleSlug) return;
  const rows = getMemoryRecords(moduleSlug, entity);
  const index = rows.findIndex((row) => row.id === record.id);
  const next = [...rows];
  if (index >= 0) next[index] = { ...rows[index]!, ...record };
  else next.unshift(record);
  setMemoryRecords(moduleSlug, entity, next);
  window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
}

export async function mutateApprovalViaApi(
  entity: ApprovalApiEntity | string,
  id: string,
  action: "advance" | "reject" | "amend",
  options?: {
    comment?: string;
    amount?: string;
    returnMode?: "previous";
    /** GM only: forward to "ceo" (default) or "finance" (skip CEO). */
    forwardTo?: "ceo" | "finance";
  },
): Promise<ApprovalMutationResult> {
  if (typeof window === "undefined" || !id) {
    return { ok: false, error: "Unavailable." };
  }
  try {
    const comment = (options?.comment || "").trim();
    const amount = (options?.amount || "").trim();
    const body: Record<string, string> = {};
    if (comment) body.comment = comment;
    if (amount) body.amount = amount;
    if (options?.returnMode) body.returnMode = options.returnMode;
    if (options?.forwardTo) body.forwardTo = options.forwardTo;
    const res = await apiFetch(
      `/api/approvals/${encodeURIComponent(entity)}/${encodeURIComponent(id)}/${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      data?: Record<string, unknown>;
    };
    if (!res.ok || !json.ok || !json.data) {
      return {
        ok: false,
        error: json.error || `Approval API error (HTTP ${res.status})`,
      };
    }
    const data = json.data;
    const record = asRecord(data.record, id);
    if (record) applyApprovalApiRecord(entity, record);
    // Actor's UI toast is enough; skip the realtime approval.* echo popup.
    suppressRequestPopups(3200);
    const status = String(data.status || record?.status || "");
    return {
      ok: true,
      status,
      previousStatus: String(data.previousStatus || ""),
      nextStatus: status,
      waitingOn: String(data.waitingOn || ""),
      label: String(data.label || ""),
      event: String(data.event || action),
      record,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Approval API unavailable",
    };
  }
}

export type ApprovalSettleResult = ApprovalMutationResult & {
  paymentId?: string;
  payment?: ManagerRecord;
  paymentCreated?: boolean;
  ledgerPosted?: boolean;
};

/**
 * Atomic Finance Paid: Go creates/links banking payment + marks Paid in one TX.
 * Prefer this over create-payment-locally then advance (orphan race).
 */
export async function settleApprovalViaApi(
  entity: ApprovalApiEntity | string,
  id: string,
  options: {
    paymentMethod: string;
    bankAccount: string;
    comment?: string;
    amount?: string;
  },
): Promise<ApprovalSettleResult> {
  if (typeof window === "undefined" || !id) {
    return { ok: false, error: "Unavailable." };
  }
  try {
    const body: Record<string, string> = {
      paymentMethod: options.paymentMethod.trim(),
      bankAccount: options.bankAccount.trim(),
    };
    const comment = (options.comment || "").trim();
    const amount = (options.amount || "").trim();
    if (comment) body.comment = comment;
    if (amount) body.amount = amount;

    const res = await apiFetch(
      `/api/approvals/${encodeURIComponent(entity)}/${encodeURIComponent(id)}/settle`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      data?: Record<string, unknown>;
    };
    if (!res.ok || !json.ok || !json.data) {
      return {
        ok: false,
        error: json.error || `Settle API error (HTTP ${res.status})`,
      };
    }
    const data = json.data;
    const record = asRecord(data.record, id);
    if (record) applyApprovalApiRecord(entity, record);
    const payment = asRecord(data.payment, String(data.paymentId || ""));
    if (payment) {
      const rows = getMemoryRecords("banking", "payments");
      const index = rows.findIndex((row) => row.id === payment.id);
      const next = [...rows];
      if (index >= 0) next[index] = { ...rows[index]!, ...payment };
      else next.unshift(payment);
      // Merge-persist so a concurrent hydrate cannot wipe the settled payment
      // (memory-only writes were disappearing from bank activity / receipts-payments).
      const persisted = await saveRecordsAsync("banking", "payments", next, {
        mode: "merge",
      });
      if (!persisted.ok) {
        setMemoryRecords("banking", "payments", next);
        window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
      }
    }
    const ledgerPosted = data.ledgerPosted === true;
    const rawLines = Array.isArray(data.ledgerLines) ? data.ledgerLines : [];
    if (ledgerPosted && rawLines.length && payment?.id) {
      const paymentId = payment.id;
      const mapped: LedgerLine[] = rawLines
        .filter(
          (row): row is Record<string, unknown> =>
            Boolean(row) && typeof row === "object",
        )
        .map((row) => ({
          id: String(row.id || crypto.randomUUID()),
          accountId: String(row.accountId || ""),
          accountCode: String(row.accountCode || ""),
          accountName: String(row.accountName || ""),
          debit: Number(row.debit || 0),
          credit: Number(row.credit || 0),
          date: String(row.date || new Date().toISOString().slice(0, 10)),
          narration: String(row.narration || ""),
          sourceModule: String(row.sourceModule || "banking"),
          sourceEntity: String(row.sourceEntity || "payments"),
          sourceRecordId: String(row.sourceRecordId || paymentId),
          ...(row.division ? { division: String(row.division) } : {}),
          ...(row.project ? { project: String(row.project) } : {}),
          createdAt: String(row.createdAt || new Date().toISOString()),
        }));
      const keep = getMemoryLedgerLines().filter(
        (line) => line.sourceRecordId !== paymentId,
      );
      setMemoryLedgerLines([...keep, ...mapped]);
      window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
    }
    if (typeof data.ledgerRevision === "string" && data.ledgerRevision) {
      adoptLedgerLinesRevision(data.ledgerRevision);
    }
    suppressRequestPopups(3200);
    const status = String(data.status || record?.status || "");
    return {
      ok: true,
      status,
      previousStatus: String(data.previousStatus || ""),
      nextStatus: status,
      waitingOn: String(data.waitingOn || ""),
      label: String(data.label || ""),
      event: String(data.event || "paid"),
      record,
      paymentId: String(data.paymentId || payment?.id || ""),
      payment,
      paymentCreated: Boolean(data.paymentCreated),
      ledgerPosted,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Settle API unavailable",
    };
  }
}

/** @deprecated Prefer mutateApprovalViaApi — kept for any remaining fire-and-forget callers. */
export function syncApprovalToApi(
  entity: ApprovalApiEntity | string,
  id: string,
  action: "advance" | "reject" | "amend",
): void {
  void mutateApprovalViaApi(entity, id, action);
}

export async function fetchApprovalProgress(
  entity: string,
  id: string,
): Promise<{
  ok: boolean;
  status?: string;
  waitingOn?: string;
  canAdvance?: boolean;
  canReject?: boolean;
  actionLabel?: string;
  label?: string;
  fulfillmentPath?: string;
  onYourDesk?: boolean;
  typeLabel?: string;
  record?: ManagerRecord;
  error?: string;
}> {
  try {
    const res = await apiFetch(
      `/api/approvals/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      data?: Record<string, unknown>;
    };
    if (!res.ok || !json.ok || !json.data) {
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }
    const data = json.data;
    return {
      ok: true,
      status: String(data.status || ""),
      waitingOn: String(data.waitingOn || ""),
      canAdvance: Boolean(data.canAdvance),
      canReject: Boolean(data.canReject),
      actionLabel: String(data.actionLabel || "Approve"),
      label: String(data.label || ""),
      fulfillmentPath: String(data.fulfillmentPath || ""),
      onYourDesk: Boolean(data.onYourDesk),
      typeLabel: String(data.typeLabel || ""),
      record: asRecord(data.record, id),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unavailable" };
  }
}

export type ApprovalDeskApiItem = {
  id?: string;
  entity?: string;
  module?: string;
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
  record?: Record<string, unknown> | ManagerRecord;
};

/**
 * Write desk API records into browser memory without firing records-changed
 * (avoids refresh loops when the desk page seeds from Postgres).
 */
export function seedApprovalDeskRecordsQuiet(items: ApprovalDeskApiItem[]): void {
  if (typeof window === "undefined") return;
  for (const item of items) {
    const entity = String(item.entity || "").trim();
    const id = String(item.id || "").trim();
    if (!entity || !id) continue;
    const moduleSlug =
      APPROVAL_ENTITY_MODULE[entity] || String(item.module || "").trim();
    if (!moduleSlug) continue;
    const record = asRecord(item.record, id);
    if (!record) continue;
    const rows = getMemoryRecords(moduleSlug, entity);
    const index = rows.findIndex((row) => row.id === record.id);
    const next = [...rows];
    if (index >= 0) next[index] = { ...rows[index]!, ...record };
    else next.unshift(record);
    setMemoryRecords(moduleSlug, entity, next);
  }
}

/** Role-scoped approval desk queue from Go (oral, general, payment, leave, etc.). */
export async function fetchApprovalDesk(): Promise<{
  ok: boolean;
  desk?: Record<string, unknown> | null;
  role?: string;
  count?: number;
  items?: ApprovalDeskApiItem[];
  attention?: ApprovalDeskApiItem[];
  attentionCount?: number;
  error?: string;
}> {
  try {
    const res = await apiFetch("/api/approvals/desk");
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      data?: {
        desk?: Record<string, unknown> | null;
        role?: string;
        count?: number;
        items?: ApprovalDeskApiItem[];
        attention?: ApprovalDeskApiItem[];
        attentionCount?: number;
      };
    };
    if (!res.ok || !json.ok || !json.data) {
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }
    const items = json.data.items || [];
    const attention = json.data.attention || [];
    seedApprovalDeskRecordsQuiet([...items, ...attention]);
    return {
      ok: true,
      desk: json.data.desk,
      role: json.data.role,
      count: json.data.count ?? 0,
      items,
      attention,
      attentionCount: json.data.attentionCount ?? attention.length,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unavailable" };
  }
}
