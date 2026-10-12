/**
 * Maintenance phase 2 on iag-mes (feat/maintenance-phase2):
 *
 *   /fault-reports, /:id/convert, /:id/reject   → fault-reports
 *   /work-orders/:num/checklist                  → checklist-steps
 *   /assets/:tag/meter-readings,
 *   /telemetry/history?metric=running_hours      → meter-readings
 *   /pm-schedules/meter-status                   → hours on preventive schedules
 *   /reliability/failure-causes                  → failure-causes
 *
 * Failure codes, approval and sign-off sit on the work order itself
 * (mes-maintenance.ts). The rules — a step marked fail needs a note, a
 * breakdown needs its failure code, the person who raised a job cannot approve
 * it — are enforced by MES; these adapters pass its refusals through.
 */
import { GatewayError, gatewayFetch, unwrapList, unwrapOne } from "@/lib/iag/gateway";
import {
  InputError,
  attachmentRefs,
  attachmentsJson,
  isoDate,
  omitEmpty,
  pick,
  str,
  type AppRecord,
  type RecordAction,
  type RecordAdapter,
} from "@/lib/iag/records/types";

type Row = Record<string, unknown>;

function withMeta(mapped: Omit<AppRecord, "id"> & { id?: string }, id: string): AppRecord {
  return {
    ...mapped,
    id: mapped.id || id,
    createdAt: mapped.createdAt || "",
    updatedAt: mapped.updatedAt || mapped.createdAt || "",
  } as AppRecord;
}

function attrs(row: Row | null | undefined): Row {
  const a = row ? pick(row, "attrs") : undefined;
  return a && typeof a === "object" && !Array.isArray(a) ? (a as Row) : {};
}

function yes(value: unknown): boolean {
  return /^(yes|true|1|y|stopped)$/i.test(str(value).trim());
}

/** The phase-2 routes 404 on an MES without iag-mes#14. Say that, not "not found". */
export const PHASE2_MISSING =
  "MES has not been updated for fault reports, checklists and meter readings yet (iag-mes#14).";

async function mes<T = unknown>(req: Parameters<typeof gatewayFetch>[0]): Promise<T> {
  try {
    return await gatewayFetch<T>(req);
  } catch (err) {
    if (err instanceof GatewayError && err.status === 404 && /\/(fault-reports|checklist|meter|failure)/.test(req.path)) {
      throw new InputError(PHASE2_MISSING, 503);
    }
    throw err;
  }
}

/* ───────────────────────────── fault reports ───────────────────────────── */

const REPORT_STATUS: Record<string, string> = {
  new: "New",
  ack: "Seen",
  investigating: "Work order raised",
  resolved: "Fixed",
  closed: "Fixed",
  false_positive: "No work needed",
};

const SEVERITY: Record<string, string> = { crit: "Critical", warn: "Warning", info: "Info" };

function severityForService(value: unknown): string | undefined {
  const v = str(value).trim().toLowerCase();
  if (!v) return undefined;
  if (v.startsWith("crit")) return "crit";
  if (v.startsWith("warn")) return "warn";
  if (v.startsWith("info")) return "info";
  throw new InputError("Severity is Critical, Warning or Info.");
}

export function faultReportToRecord(row: Row): Omit<AppRecord, "id"> & { id?: string } {
  const extra = attrs(row);
  return {
    id: str(pick(row, "id")),
    date: isoDate(pick(row, "occurred_at")),
    workCenter: str(extra.asset_tag) || str(pick(row, "source")),
    title: str(extra.title) || str(pick(row, "message")),
    description: str(extra.description),
    machineStopped: extra.machine_stopped === true ? "Yes" : "No",
    severity: SEVERITY[str(pick(row, "severity"))] || str(pick(row, "severity")),
    reportedBy: str(extra.reported_by),
    workOrder: str(extra.work_order),
    triagedBy: str(extra.triaged_by),
    rejectedReason: str(extra.rejected_reason),
    attachments: attachmentsJson(extra.attachments),
    status: REPORT_STATUS[str(pick(row, "status"))] || str(pick(row, "status")),
    createdAt: str(pick(row, "occurred_at")),
    updatedAt: str(pick(row, "resolved_at", "acknowledged_at", "occurred_at")),
  };
}

async function convertReport(id: string, record?: AppRecord): Promise<AppRecord | null> {
  const payload = await mes<Row>({
    service: "mes",
    path: `/api/v1/fault-reports/${encodeURIComponent(id)}/convert`,
    method: "POST",
    body: omitEmpty({
      title: record?.woTitle,
      priority: str(record?.priority).trim().toLowerCase() || undefined,
      assignee: str(record?.assignee).trim() || undefined,
    }),
  });
  const report = (payload && (payload as Row).report) as Row | undefined;
  return report ? withMeta(faultReportToRecord(report), id) : null;
}

const faultReportActions: RecordAction[] = [
  {
    id: "convert",
    label: "Make work order",
    doneLabel: "Work order raised",
    permission: "mes.add_work_order",
    whenStatus: ["New", "Seen"],
    run: (_ctx, id) => convertReport(id),
  },
];

export const faultReports: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/fault-reports",
  actions: faultReportActions,

  async list() {
    const rows = unwrapList<Row>(await mes({ service: "mes", path: "/api/v1/fault-reports", query: { limit: 500 } }));
    return rows.map((row) => withMeta(faultReportToRecord(row), str(pick(row, "id"))));
  },

  async create(_ctx, record) {
    const tag = str(record.workCenter).trim();
    const title = str(record.title).trim();
    if (!tag) throw new InputError("Pick the machine.");
    if (!title) throw new InputError("Say what is wrong.");
    const row = unwrapOne<Row>(
      await mes({
        service: "mes",
        path: "/api/v1/fault-reports",
        method: "POST",
        body: omitEmpty({
          asset_tag: tag,
          title,
          description: str(record.description).trim() || undefined,
          machine_stopped: yes(record.machineStopped),
          severity: severityForService(record.severity),
          // Photos go to the document service first; MES keeps the references.
          attachments: attachmentRefs(record.attachments),
        }),
      }),
    );
    return row ? withMeta(faultReportToRecord(row), str(pick(row, "id"))) : null;
  },

  /**
   * Triage through the edit form, because a rejection needs its reason:
   * Decision "Make work order" converts (with the priority and assignee given),
   * "No work needed" rejects with the reason.
   */
  async update(_ctx, id, record) {
    const decision = str(record.decision).trim().toLowerCase();
    if (!decision) {
      throw new InputError("A report is not edited — choose a decision: Make work order, or No work needed with a reason.");
    }
    if (decision.startsWith("make")) return convertReport(id, record);
    if (decision.startsWith("no work")) {
      const reason = str(record.rejectedReason).trim();
      if (!reason) throw new InputError("Say why no work is needed.");
      const row = unwrapOne<Row>(
        await mes({
          service: "mes",
          path: `/api/v1/fault-reports/${encodeURIComponent(id)}/reject`,
          method: "POST",
          body: { reason },
        }),
      );
      return row ? withMeta(faultReportToRecord(row), id) : null;
    }
    throw new InputError("Decision is Make work order or No work needed.");
  },
};

/* ───────────────────────────── checklist steps ───────────────────────────── */

const RESULT_LABEL: Record<string, string> = { pass: "Pass", fail: "Fail", na: "N/A" };

function resultForService(value: unknown): string {
  const v = str(value).trim().toLowerCase().replace("/", "");
  if (v === "pass" || v === "fail" || v === "na") return v;
  throw new InputError("Mark the step Pass, Fail or N/A.");
}

/** The steps a work order's checklist holds — strings or {step|text|title}. */
export function stepsOf(row: Row): string[] {
  const raw = attrs(row).checklist;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim()) out.push(item.trim());
    } else if (item && typeof item === "object") {
      const o = item as Row;
      const text = ["step", "text", "title", "name"].map((k) => str(o[k]).trim()).find(Boolean);
      if (text) out.push(text);
    }
  }
  return out;
}

function resultsOf(row: Row): Map<number, Row> {
  const raw = attrs(row).checklist_results;
  const out = new Map<number, Row>();
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (r && typeof r === "object" && typeof (r as Row).index === "number") out.set((r as Row).index as number, r as Row);
    }
  }
  return out;
}

const STATUS_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled",
  draft: "Draft", scheduled: "Scheduled",
};

export function checklistStepRows(row: Row): AppRecord[] {
  const num = str(pick(row, "num"));
  const results = resultsOf(row);
  return stepsOf(row).map((step, i) => {
    const r = results.get(i);
    return withMeta(
      {
        id: `${num}#${i}`,
        workOrder: num,
        workCenter: str(pick(row, "asset_tag")),
        stepNo: String(i + 1),
        step,
        result: r ? RESULT_LABEL[str(r.result)] || str(r.result) : "",
        reading: r && r.reading !== undefined ? str(r.reading) : "",
        note: str(r?.note),
        markedBy: str(r?.by),
        markedAt: isoDate(r?.at),
        woStatus: STATUS_LABEL[str(pick(row, "status"))] || str(pick(row, "status")),
        // The list's status column: what is left to do on this step.
        status: r ? (RESULT_LABEL[str(r.result)] || "Marked") : "To do",
      },
      `${num}#${i}`,
    );
  });
}

export const checklistSteps: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/work-orders/:num/checklist",

  async list() {
    const orders = unwrapList<Row>(
      await gatewayFetch({ service: "mes", path: "/api/v1/work-orders", query: { limit: 200 } }),
    );
    return orders
      .filter((wo) => str(pick(wo, "status")) !== "cancelled" && str(pick(wo, "wo_type")).toLowerCase() !== "production")
      .flatMap(checklistStepRows);
  },

  /** Mark one step: result, and a reading or note. A fail needs the note. */
  async update(_ctx, id, record) {
    const [num, idx] = id.split("#");
    const index = Number(idx);
    if (!num || !Number.isInteger(index)) throw new InputError(`Not a checklist step: ${id}`, 404);
    const result = resultForService(record.result);
    const readingRaw = str(record.reading).trim();
    const reading = readingRaw === "" ? undefined : Number(readingRaw);
    if (reading !== undefined && !Number.isFinite(reading)) throw new InputError("A reading is a number.");
    const row = unwrapOne<Row>(
      await mes({
        service: "mes",
        path: `/api/v1/work-orders/${encodeURIComponent(num)}/checklist`,
        method: "POST",
        body: {
          results: [
            omitEmpty({
              index,
              result,
              reading,
              note: str(record.note).trim() || undefined,
              // Who ticked it on the paper sheet, when someone else enters it (iag-mes#16).
              by: str(record.markedBy).trim() || undefined,
            }),
          ],
        },
      }),
    );
    return row ? checklistStepRows(row).find((r) => r.id === id) || null : null;
  },
};

/* ───────────────────────────── meter readings ───────────────────────────── */

export const meterReadings: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/assets/:tag/meter-readings",

  async list() {
    const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const rows = unwrapList<Row>(
      await gatewayFetch({
        service: "mes",
        path: "/api/v1/telemetry/history",
        query: { metric: "running_hours", since },
      }),
    );
    return rows.map((row) => {
      const tag = str(pick(row, "asset_tag"));
      const at = str(pick(row, "recorded_at"));
      const id = `${tag}@${at}`;
      return withMeta(
        { id, workCenter: tag, date: isoDate(at), recordedAt: at, hours: str(pick(row, "value")), createdAt: at, updatedAt: at },
        id,
      );
    });
  },

  /**
   * A reading lower than the last is refused by MES as a typo unless
   * "Meter replaced" is ticked.
   */
  async create(_ctx, record) {
    const tag = str(record.workCenter).trim();
    const hours = Number(str(record.hours).trim());
    if (!tag) throw new InputError("Pick the machine.");
    if (!Number.isFinite(hours) || hours < 0) throw new InputError("Running hours is a number, zero or more.");
    const date = str(record.date).trim();
    const row = unwrapOne<Row>(
      await mes({
        service: "mes",
        path: `/api/v1/assets/${encodeURIComponent(tag)}/meter-readings`,
        method: "POST",
        body: omitEmpty({
          value: hours,
          // A date alone is read at noon in Kampala, so it lands on that day.
          recorded_at: date ? (/T/.test(date) ? date : `${date}T12:00:00+03:00`) : undefined,
          reset: yes(record.meterReplaced) || undefined,
        }),
      }),
    );
    if (!row) return null;
    const at = str(pick(row, "recorded_at"));
    return withMeta({ workCenter: tag, date: isoDate(at), recordedAt: at, hours: str(pick(row, "value")) }, `${tag}@${at}`);
  },
};

/** Hours used against a schedule's running-hours interval, by schedule id. */
export async function meterStatusBySchedule(): Promise<Map<string, Row>> {
  try {
    const rows = unwrapList<Row>(await gatewayFetch({ service: "mes", path: "/api/v1/pm-schedules/meter-status" }));
    return new Map(rows.map((row) => [str(pick(row, "schedule_id")), row]));
  } catch {
    // Older MES: schedules show without hours, as before.
    return new Map();
  }
}

const METER_STATE: Record<string, string> = {
  no_reading: "No reading yet",
  ok: "OK",
  due_soon: "Due soon",
  due: "Due",
};

export function meterFields(status: Row | undefined): { hoursUsed: string; meterState: string } {
  if (!status) return { hoursUsed: "", meterState: "" };
  const interval = Number(pick(status, "interval_hours"));
  const used = pick(status, "used_hours");
  return {
    hoursUsed: used === undefined || used === null ? `— / ${interval} h` : `${Math.round(Number(used))} / ${interval} h`,
    meterState: METER_STATE[str(pick(status, "state"))] || str(pick(status, "state")),
  };
}

/* ───────────────────────────── failure causes ───────────────────────────── */

export const failureCauses: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/reliability/failure-causes",
  readOnly: true,
  async list(ctx) {
    const plant = ctx.query?.get("factory") || "";
    const rows = unwrapList<Row>(
      await mes({
        service: "mes",
        path: "/api/v1/reliability/failure-causes",
        query: omitEmpty({ days: 365, plant: plant || undefined }) as Record<string, string | number>,
      }),
    );
    const total = rows.reduce((acc, row) => acc + Number(pick(row, "count") || 0), 0);
    let running = 0;
    return rows.map((row, i) => {
      const count = Number(pick(row, "count") || 0);
      running += count;
      const id = `${str(pick(row, "problem"))}/${str(pick(row, "cause"))}`;
      return withMeta(
        {
          id,
          rank: String(i + 1),
          problem: str(pick(row, "problem")),
          cause: str(pick(row, "cause")),
          failures: String(count),
          machines: str(pick(row, "machines")),
          share: total ? `${Math.round((count / total) * 100)}%` : "",
          // Pareto: the causes that together make up the first 80 % of
          // failures are where effort pays.
          status: total && running - count < 0.8 * total ? "Top 80%" : "Long tail",
        },
        id,
      );
    });
  },
};

/* ─────────────────────────── on the work order ─────────────────────────── */

export function failureFields(row: Row) {
  const f = attrs(row).failure as Row | undefined;
  return {
    failureProblem: str(f?.problem),
    failureCause: str(f?.cause),
    failureRemedy: str(f?.remedy),
    failureNote: str(f?.note),
  };
}

const APPROVAL_LABEL: Record<string, string> = { pending: "Waiting", approved: "Approved", rejected: "Rejected" };

export function approvalFields(row: Row) {
  const a = attrs(row).approval as Row | undefined;
  const signoff = (attrs(row).signoff || {}) as Row;
  const tech = signoff.technician as Row | undefined;
  const sup = signoff.supervisor as Row | undefined;
  const steps = stepsOf(row).length;
  const marked = resultsOf(row).size;
  return {
    approval: APPROVAL_LABEL[str(a?.state)] || "",
    approvalBy: str(a?.decided_by),
    approvalNote: str(a?.reason),
    checklistProgress: steps ? `${marked} / ${steps}` : "",
    signedBy: str(tech?.by),
    checkedBy: str(sup?.by),
  };
}

/** Write what changed of the failure code, before a completion needs it. */
export async function writeFailure(num: string, record: AppRecord, current: Row | null): Promise<void> {
  const touched = ["failureProblem", "failureCause", "failureRemedy", "failureNote"].some((k) => record[k] !== undefined);
  if (!touched) return;
  const now = current ? failureFields(current) : { failureProblem: "", failureCause: "", failureRemedy: "", failureNote: "" };
  const next = {
    problem: str(record.failureProblem ?? now.failureProblem).trim(),
    cause: str(record.failureCause ?? now.failureCause).trim(),
    remedy: str(record.failureRemedy ?? now.failureRemedy).trim(),
    note: str(record.failureNote ?? now.failureNote).trim(),
  };
  const unchanged =
    next.problem === now.failureProblem && next.cause === now.failureCause &&
    next.remedy === now.failureRemedy && next.note === now.failureNote;
  if (unchanged) return;
  if (!next.problem && !next.cause && !next.remedy) return;
  if (!next.problem || !next.cause || !next.remedy) {
    throw new InputError("A failure code is all three: problem, cause and remedy.");
  }
  await mes({
    service: "mes",
    path: `/api/v1/work-orders/${encodeURIComponent(num)}/failure`,
    method: "POST",
    body: omitEmpty(next),
  });
}

/** Approve or reject from the edit form, where a rejection's reason is typed. */
export async function writeApproval(num: string, record: AppRecord): Promise<void> {
  const decision = str(record.approvalDecision).trim().toLowerCase();
  if (!decision) return;
  if (decision !== "approve" && decision !== "reject") {
    throw new InputError("Approval decision is Approve or Reject.");
  }
  const reason = str(record.approvalNote).trim();
  if (decision === "reject" && !reason) throw new InputError("Say why the work is not approved.");
  await mes({
    service: "mes",
    path: `/api/v1/work-orders/${encodeURIComponent(num)}/${decision}`,
    method: "POST",
    body: omitEmpty({ reason: reason || undefined }),
  });
}

/**
 * Sign off as the person signed in, or — entering a paper sheet — as the
 * person whose signature is on it, with the date they wrote (iag-mes#16).
 */
export async function signOff(
  num: string,
  role: "technician" | "supervisor",
  paper?: { signedBy?: string; signedOn?: string },
): Promise<Row | null> {
  const signedBy = str(paper?.signedBy).trim();
  return unwrapOne<Row>(
    await mes({
      service: "mes",
      path: `/api/v1/work-orders/${encodeURIComponent(num)}/signoff/${role}`,
      method: "POST",
      body: signedBy ? omitEmpty({ signed_by: signedBy, signed_on: str(paper?.signedOn).trim() || undefined }) : undefined,
    }),
  );
}

/** A job card's meter reading also goes to the machine's running hours. */
export async function recordJobCardMeter(tag: string, value: unknown, date: unknown): Promise<void> {
  const raw = str(value).trim();
  if (!tag || raw === "") return;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) throw new InputError("The meter reading is a number of hours.");
  const day = str(date).trim();
  await mes({
    service: "mes",
    path: `/api/v1/assets/${encodeURIComponent(tag)}/meter-readings`,
    method: "POST",
    body: omitEmpty({ value: hours, recorded_at: day && !/T/.test(day) ? `${day}T12:00:00+03:00` : day || undefined }),
  });
}
