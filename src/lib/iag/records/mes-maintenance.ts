/**
 * The maintenance tabs, all on iag-mes (`/api/v1/mes` + service `/api/v1`).
 *
 *   GET/POST/PATCH /work-orders, /:num/start, /:num/complete → work-orders
 *   PATCH /work-orders/:num (attrs.job_card)                 → batch-records (Job Cards)
 *   GET/POST /pm-templates                                   → pm-templates
 *   GET/POST /pm-schedules                                   → pm-schedules
 *   GET/POST /downtime-events, POST /:id/end                 → downtime-logs
 *   GET/POST /assets, PATCH /assets/:tag                     → work-centers (Machines)
 *
 * Before this file, Work Orders wrote coffee production orders to
 * iag-production (machine name in `product`, hours in `qty_kg`), Preventive
 * Schedules wrote week-long blocks onto the production calendar, and Spare
 * Parts wrote production BOMs. MES has the real CMMS — work orders, PM
 * templates, PM schedules that advance when their work order completes — and
 * nothing here was using it.
 *
 * A job card is the record of the work done against one work order: the same
 * MES row, with what the technician booked kept under `attrs.job_card`. MES has
 * no job-card table, so one work order carries one job card.
 */
import { gatewayFetch, unwrapList, unwrapOne } from "@/lib/iag/gateway";
import { resourceAdapter } from "@/lib/iag/records/resource";
import {
  attachmentRefs,
  attachmentsJson,
  isoDate,
  omitEmpty,
  pick,
  rfc3339,
  str,
  type AppRecord,
  type RecordAction,
  type RecordAdapter,
} from "@/lib/iag/records/types";

type Row = Record<string, unknown>;

/** Largest page MES accepts; its own default is 50. */
const MES_LIST_LIMIT = 200;

/**
 * MES sites run on Kampala time. Uganda keeps no daylight saving, so the
 * offset is fixed. Used to turn the form's date + time into an instant.
 */
const PLANT_TIME_ZONE = "Africa/Kampala";
const PLANT_UTC_OFFSET = "+03:00";

/* ───────────────────────────── helpers ───────────────────────────── */

export function attrs(row: Row): Row {
  const bag = row.attrs;
  return bag && typeof bag === "object" && !Array.isArray(bag) ? (bag as Row) : {};
}

/** An `attrs` bag to send, or `undefined` when there is nothing in it. */
export function attrsOrOmit(bag: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bag)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Service enums are lower_snake; the app's columns read as prose. */
export function titleCase(value: string): string {
  if (!value) return "";
  return value
    .split(/[\s_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function snakeCase(value: string | undefined | null): string {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function numberOrUndefined(value: unknown): number | undefined {
  const raw = str(value).trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** `YYYY-MM-DD` and `HH:MM` of an instant, on the plant's clock. */
function plantDateTime(value: unknown): { date: string; time: string } {
  const ms = Date.parse(str(value));
  if (!Number.isFinite(ms)) return { date: isoDate(value), time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PLANT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/**
 * The form's date and time as RFC3339 on the plant's clock.
 *
 * MES binds `started_at` into a Go `time.Time`, which accepts RFC3339 and
 * nothing else — the bare `2026-10-02` the date input produces was a 400 on
 * every downtime the form tried to log.
 */
export function plantInstant(date: string | undefined, time: string | undefined): string | undefined {
  const day = str(date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return rfc3339(day);
  const clock = str(time).trim();
  const hm = /^(\d{1,2}):(\d{2})$/.exec(clock);
  const hhmm = hm ? `${hm[1].padStart(2, "0")}:${hm[2]}` : "00:00";
  return `${day}T${hhmm}:00${PLANT_UTC_OFFSET}`;
}

/**
 * `ended_at` for a stop logged after it is over: the start plus the minutes
 * lost. iag-mes#3 accepts it on create; before that deploys MES ignores the
 * key and the event stays open until End downtime, as it always has.
 */
function endedAfter(startedAt: string | undefined, minutes: unknown): string | undefined {
  const mins = numberOrUndefined(minutes);
  if (!startedAt || mins === undefined || mins <= 0) return undefined;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return undefined;
  return new Date(start + mins * 60_000).toISOString();
}

function minutesBetween(start: unknown, end: unknown): string {
  const startMs = Date.parse(str(start));
  const endMs = Date.parse(str(end));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return "";
  }
  return String(Math.round((endMs - startMs) / 60_000));
}

function withMeta(
  mapped: Omit<AppRecord, "id"> & { id?: string },
  id: string,
): AppRecord {
  return {
    ...mapped,
    id: mapped.id || id,
    createdAt: mapped.createdAt || "",
    updatedAt: mapped.updatedAt || mapped.createdAt || "",
  } as AppRecord;
}

/* ─────────────────────────── work orders ─────────────────────────── */

/** mes_work_orders.priority CHECK, 002_schema.sql. */
const WORK_ORDER_PRIORITIES = ["critical", "high", "medium", "low"] as const;

/**
 * The priority the column accepts.
 *
 * The job-card adapter used to send `"normal"` on every create, which is not in
 * the set, so MES refused every job card with a 400. Anything unrecognised now
 * falls to the column's own default rather than being refused.
 */
export function priorityForService(value: string | undefined): string | undefined {
  const v = snakeCase(value);
  if (!v) return undefined;
  if ((WORK_ORDER_PRIORITIES as readonly string[]).includes(v)) return v;
  if (v === "urgent") return "high";
  return "medium";
}

/**
 * `completed` is not written as a status. Completing goes through
 * `POST /:num/complete`, which stamps `completed_at` and advances the PM
 * schedule the work order came from; a PATCH to `completed` does neither.
 */
function isCompleted(status: string | undefined): boolean {
  return snakeCase(status) === "completed";
}

function checklistText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const obj = item as Row;
        return str(pick(obj, "task", "label", "name", "step", "item", "title"));
      }
      return str(item);
    })
    .filter(Boolean)
    .join("\n");
}

function checklistLines(value: string | undefined): string[] {
  return str(value)
    .split(/\r?\n|;/)
    .map((line) => line.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter(Boolean);
}

export function workOrderToRecord(row: Row): Omit<AppRecord, "id"> & { id?: string } {
  const extra = attrs(row);
  return {
    id: str(pick(row, "num")),
    reference: str(pick(row, "num")),
    num: str(pick(row, "num")),
    date: isoDate(pick(row, "created_at")),
    title: str(pick(row, "title")),
    workCenter: str(pick(row, "asset_tag")),
    woType: titleCase(str(pick(row, "wo_type"))),
    priority: titleCase(str(pick(row, "priority"))),
    dueDate: isoDate(pick(row, "due_at")),
    assignee: str(pick(row, "assignee")),
    status: titleCase(str(pick(row, "status"))) || "Open",
    completedOn: isoDate(pick(row, "completed_at")),
    estimatedHours: str(extra.estimatedHours),
    partsRequired: str(extra.partsRequired),
    estimatedCost: str(extra.estimatedCost),
    description: str(extra.description),
    pmTemplate: str(extra.pm_template),
    checklist: checklistText(extra.checklist),
    attachments: attachmentsJson(pick(extra, "attachments")),
    createdAt: str(pick(row, "created_at")),
    updatedAt: str(pick(row, "updated_at")),
  };
}

/** The editable part of a work order, as a WorkOrderPatch. Partial-safe. */
function workOrderPatchBody(record: AppRecord): Record<string, unknown> {
  return omitEmpty({
    title: record.title,
    priority: priorityForService(record.priority),
    status: isCompleted(record.status) ? undefined : snakeCase(record.status) || undefined,
    assignee: record.assignee,
    due_at: rfc3339(record.dueDate),
    // MES merges attrs key by key on PATCH, so a partial bag is safe here.
    attrs: attrsOrOmit({
      estimatedHours: record.estimatedHours,
      partsRequired: record.partsRequired,
      estimatedCost: record.estimatedCost,
      description: record.description,
      attachments: attachmentRefs(record.attachments),
    }),
  });
}

async function completeWorkOrder(num: string): Promise<Row | null> {
  const payload = await gatewayFetch({
    service: "mes",
    path: `/api/v1/work-orders/${encodeURIComponent(num)}/complete`,
    method: "POST",
  });
  return unwrapOne<Row>(payload);
}

async function patchWorkOrder(num: string, body: Record<string, unknown>): Promise<Row | null> {
  const payload = await gatewayFetch({
    service: "mes",
    path: `/api/v1/work-orders/${encodeURIComponent(num)}`,
    method: "PATCH",
    body,
  });
  return unwrapOne<Row>(payload);
}

async function getWorkOrder(num: string): Promise<Row | null> {
  const payload = await gatewayFetch({
    service: "mes",
    path: `/api/v1/work-orders/${encodeURIComponent(num)}`,
  });
  return unwrapOne<Row>(payload);
}

const WORK_ORDER_LIVE = ["Draft", "Scheduled", "Open", "In Progress"];

const workOrderActions: RecordAction[] = [
  {
    id: "start",
    label: "Start work",
    doneLabel: "Started",
    permission: "mes.change_work_order",
    whenStatus: ["Draft", "Scheduled", "Open"],
    async run(_ctx, id) {
      const payload = await gatewayFetch({
        service: "mes",
        path: `/api/v1/work-orders/${encodeURIComponent(id)}/start`,
        method: "POST",
      });
      const row = unwrapOne<Row>(payload);
      return row ? withMeta(workOrderToRecord(row), id) : null;
    },
  },
  {
    id: "complete",
    label: "Complete work order",
    doneLabel: "Completed",
    permission: "mes.complete_work_order",
    whenStatus: WORK_ORDER_LIVE,
    async run(_ctx, id) {
      const row = await completeWorkOrder(id);
      return row ? withMeta(workOrderToRecord(row), id) : null;
    },
  },
];

export const workOrders: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/work-orders",
  actions: workOrderActions,

  async list() {
    const payload = await gatewayFetch({
      service: "mes",
      path: "/api/v1/work-orders",
      query: { limit: MES_LIST_LIMIT },
    });
    return unwrapList<Row>(payload).map((row) =>
      withMeta(workOrderToRecord(row), str(pick(row, "num"))),
    );
  },

  async create(_ctx, record) {
    const assetTag = str(record.workCenter).trim();
    if (!assetTag) {
      throw new Error("Pick the machine this work order is for.");
    }
    const woType = snakeCase(record.woType) || "corrective";
    const payload = await gatewayFetch({
      service: "mes",
      path: "/api/v1/work-orders",
      method: "POST",
      body: omitEmpty({
        // No `num`: MES numbers it (WO-n, continuing its own sequence).
        title: str(record.title).trim() || `${titleCase(woType)} — ${assetTag}`,
        asset_tag: assetTag,
        wo_type: woType,
        priority: priorityForService(record.priority) || "medium",
        status: isCompleted(record.status) ? "open" : snakeCase(record.status) || "open",
        assignee: record.assignee,
        due_at: rfc3339(record.dueDate),
        attrs: attrsOrOmit({
          estimatedHours: record.estimatedHours,
          partsRequired: record.partsRequired,
          estimatedCost: record.estimatedCost,
          description: record.description,
          attachments: attachmentRefs(record.attachments),
        }),
      }),
    });
    let row = unwrapOne<Row>(payload);
    const num = str(row && pick(row, "num"));
    if (row && num && isCompleted(record.status)) {
      row = (await completeWorkOrder(num)) || row;
    }
    return row ? withMeta(workOrderToRecord(row), num) : null;
  },

  async update(_ctx, id, record) {
    let row: Row | null = null;
    const body = workOrderPatchBody(record);
    if (Object.keys(body).length) row = await patchWorkOrder(id, body);
    if (isCompleted(record.status)) row = (await completeWorkOrder(id)) || row;
    return row ? withMeta(workOrderToRecord(row), id) : null;
  },
};

/* ──────────────────────────── job cards ──────────────────────────── */

type JobCard = {
  date?: string;
  technician?: string;
  hours?: string;
  meterReading?: string;
  partsUsed?: string;
  completion?: string;
  workDone?: string;
  attachments?: unknown;
};

function jobCardOf(row: Row): JobCard | null {
  const extra = attrs(row);
  const card = extra.job_card;
  if (card && typeof card === "object" && !Array.isArray(card)) return card as JobCard;
  // Cards written by the earlier adapter, which created a work order per card
  // and kept the figures loose in attrs under the production form's names.
  if (str(pick(row, "wo_type")) === "production") {
    return {
      technician: str(pick(row, "assignee")),
      hours: str(extra.inputQuantity),
      meterReading: str(extra.outputQuantity),
      partsUsed: str(extra.bom),
      completion: str(extra.yieldPercent),
      workDone: str(extra.steps),
      attachments: extra.attachments,
    };
  }
  return null;
}

export function jobCardToRecord(row: Row): Omit<AppRecord, "id"> & { id?: string } {
  const card = jobCardOf(row) || {};
  const num = str(pick(row, "num"));
  return {
    id: num,
    reference: num,
    workOrder: num,
    date: str(card.date) || isoDate(pick(row, "updated_at", "created_at")),
    workCenter: str(pick(row, "asset_tag")),
    title: str(pick(row, "title")),
    technician: str(card.technician) || str(pick(row, "assignee")),
    hours: str(card.hours),
    meterReading: str(card.meterReading),
    partsUsed: str(card.partsUsed),
    completion: str(card.completion),
    workDone: str(card.workDone),
    status: titleCase(str(pick(row, "status"))) || "Open",
    attachments: attachmentsJson(card.attachments),
    createdAt: str(pick(row, "created_at")),
    updatedAt: str(pick(row, "updated_at")),
  };
}

const JOB_CARD_FIELDS = [
  "date",
  "technician",
  "hours",
  "meterReading",
  "partsUsed",
  "completion",
  "workDone",
] as const;

/**
 * Write a job card onto its work order.
 *
 * MES merges `attrs` one key deep, so `job_card` is replaced whole. The form
 * sends only what changed on an edit, so the stored card is read first and the
 * change laid over it — otherwise editing the hours would blank the rest.
 */
async function writeJobCard(
  num: string,
  record: AppRecord,
  mode: "create" | "update",
): Promise<AppRecord | null> {
  const current = await getWorkOrder(num);
  if (!current) throw new Error(`Work order ${num} was not found in MES.`);
  const existing = attrs(current).job_card;
  if (mode === "create" && existing && typeof existing === "object") {
    throw new Error(`Work order ${num} already has a job card — open it and edit it instead.`);
  }
  const merged: Record<string, unknown> = {
    ...(existing && typeof existing === "object" ? (existing as Row) : {}),
  };
  for (const key of JOB_CARD_FIELDS) {
    const value = record[key];
    if (value !== undefined) merged[key] = value;
  }
  const refs = attachmentRefs(record.attachments);
  if (refs !== undefined) merged.attachments = refs;

  const body: Record<string, unknown> = { attrs: { job_card: merged } };
  // Booking a technician on the card assigns the work order to them when it
  // has nobody yet.
  if (record.technician && !str(pick(current, "assignee"))) body.assignee = record.technician;
  const status = snakeCase(record.status);
  if (status && status !== "completed") body.status = status;

  let row = await patchWorkOrder(num, body);
  if (status === "completed") row = (await completeWorkOrder(num)) || row;
  return row ? withMeta(jobCardToRecord(row), num) : null;
}

export const jobCards: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/work-orders",

  async list() {
    const payload = await gatewayFetch({
      service: "mes",
      path: "/api/v1/work-orders",
      query: { limit: MES_LIST_LIMIT },
    });
    return unwrapList<Row>(payload)
      .filter((row) => jobCardOf(row) !== null)
      .map((row) => withMeta(jobCardToRecord(row), str(pick(row, "num"))));
  },

  async create(_ctx, record) {
    const num = str(record.workOrder || record.reference).trim();
    if (!num) throw new Error("Pick the work order this job card is for.");
    return writeJobCard(num, record, "create");
  },

  async update(_ctx, id, record) {
    return writeJobCard(id, record, "update");
  },
};

/* ─────────────────────────── PM templates ────────────────────────── */

/**
 * A template is the service itself — what to check and how often. MES has
 * GET and POST on this collection and nothing else, so a template is created
 * and read, not edited.
 */
export function pmTemplateToRecord(row: Row): Omit<AppRecord, "id"> & { id?: string } {
  const extra = attrs(row);
  return {
    id: str(pick(row, "id")),
    reference: str(pick(row, "code")),
    code: str(pick(row, "code")),
    name: str(pick(row, "name")),
    assetCategory: str(pick(row, "asset_category")),
    intervalDays: str(pick(row, "interval_days")),
    checklist: checklistText(pick(row, "checklist")),
    notes: str(extra.notes),
    createdAt: "",
    updatedAt: "",
  };
}

const pmTemplatesBase = resourceAdapter({
  service: "mes",
  path: "/api/v1/pm-templates",
  toRecord: pmTemplateToRecord,
  fromRecord: (record) =>
    omitEmpty({
      code: str(record.code).trim(),
      name: record.name,
      asset_category: record.assetCategory,
      // ShouldBindJSON, no coercion: a string here is a 400.
      interval_days: numberOrUndefined(record.intervalDays),
      checklist: checklistLines(record.checklist),
      attrs: attrsOrOmit({ notes: record.notes }),
    }),
  noUpdate: true,
  noDelete: true,
});

/**
 * PATCH /pm-templates/:id (iag-mes#5). The code is the template's business key
 * and stays fixed; schedules point at the row by id, so an edit to the
 * interval or the checklist carries to every machine the template is on.
 */
export const pmTemplates: RecordAdapter = {
  ...pmTemplatesBase,
  readOnly: false,
  async update(_ctx, id, record) {
    if (record.code !== undefined) {
      throw new Error("A template's code is fixed. Create a new template for a new code.");
    }
    const payload = await gatewayFetch({
      service: "mes",
      path: `/api/v1/pm-templates/${encodeURIComponent(id)}`,
      method: "PATCH",
      body: omitEmpty({
        name: record.name,
        asset_category: record.assetCategory,
        interval_days: numberOrUndefined(record.intervalDays),
        // An emptied checklist is a real edit, so it is sent as [] rather than
        // dropped; omitEmpty keeps arrays.
        checklist: record.checklist !== undefined ? checklistLines(record.checklist) : undefined,
        // MES merges attrs key by key.
        attrs: record.notes !== undefined ? { notes: record.notes } : undefined,
      }),
    });
    const row = unwrapOne<Row>(payload);
    return row ? withMeta(pmTemplateToRecord(row), id) : null;
  },
};

/* ─────────────────────────── PM schedules ────────────────────────── */

async function listTemplates(): Promise<Row[]> {
  const payload = await gatewayFetch({ service: "mes", path: "/api/v1/pm-templates" });
  return unwrapList<Row>(payload);
}

function scheduleToRecord(
  row: Row,
  templates: Map<string, Row>,
): Omit<AppRecord, "id"> & { id?: string } {
  const template = templates.get(str(pick(row, "template_id"))) || {};
  const code = str(pick(template, "code"));
  const asset = str(pick(row, "asset_tag"));
  return {
    id: str(pick(row, "id")),
    reference: [code, asset].filter(Boolean).join(" · "),
    template: code || str(pick(row, "template_id")),
    templateName: str(pick(template, "name")),
    intervalDays: str(pick(template, "interval_days")),
    workCenter: asset,
    nextDue: isoDate(pick(row, "next_due_at")),
    lastDone: isoDate(pick(row, "last_done_at")),
    status: titleCase(str(pick(row, "status"))) || "Scheduled",
    createdAt: "",
    // No timestamps on the row; these two are what moves when it changes, and
    // the collection revision is built from updatedAt.
    updatedAt: str(pick(row, "last_done_at", "next_due_at")),
  };
}

function resolveTemplate(templates: Row[], value: string): Row | undefined {
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  return (
    templates.find((t) => str(pick(t, "id")).toLowerCase() === v) ||
    templates.find((t) => str(pick(t, "code")).toLowerCase() === v) ||
    templates.find((t) => str(pick(t, "name")).toLowerCase() === v)
  );
}

/**
 * A schedule puts a template on one machine. MES's hourly preventive job marks
 * it overdue and raises a work order when it falls due, and completing that
 * work order moves `next_due_at` on by the template's interval.
 */
export const pmSchedules: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/pm-schedules",

  async list() {
    const [templates, payload] = await Promise.all([
      listTemplates(),
      gatewayFetch({ service: "mes", path: "/api/v1/pm-schedules" }),
    ]);
    const byId = new Map(templates.map((t) => [str(pick(t, "id")), t]));
    return unwrapList<Row>(payload).map((row) =>
      withMeta(scheduleToRecord(row, byId), str(pick(row, "id"))),
    );
  },

  async create(_ctx, record) {
    const assetTag = str(record.workCenter).trim();
    if (!assetTag) throw new Error("Pick the machine this schedule is for.");
    const templates = await listTemplates();
    const template = resolveTemplate(templates, str(record.template));
    if (!template) {
      const known = templates.map((t) => str(pick(t, "code"))).filter(Boolean);
      throw new Error(
        known.length
          ? `No PM template "${record.template}". Known templates: ${known.join(", ")}.`
          : "Create a PM template first — a schedule puts a template on a machine.",
      );
    }
    const payload = await gatewayFetch({
      service: "mes",
      path: "/api/v1/pm-schedules",
      method: "POST",
      body: omitEmpty({
        template_id: str(pick(template, "id")),
        asset_tag: assetTag,
        // Blank means due now; MES defaults it.
        next_due_at: plantInstant(record.nextDue, "06:00"),
      }),
    });
    const row = unwrapOne<Row>(payload);
    if (!row) return null;
    const byId = new Map([[str(pick(template, "id")), template]]);
    return withMeta(scheduleToRecord(row, byId), str(pick(row, "id")));
  },

  /**
   * PATCH /pm-schedules/:id (iag-mes#5) moves the next due date; MES sets the
   * status from it. The template and the machine are the schedule's identity
   * — a different pair is a different schedule.
   */
  async update(_ctx, id, record) {
    if (record.template !== undefined || record.workCenter !== undefined) {
      throw new Error(
        "A schedule's template and machine are fixed. Add a new schedule for a different pair.",
      );
    }
    const nextDue = plantInstant(record.nextDue, "06:00");
    if (!nextDue) throw new Error("Give the schedule a next due date.");
    const [templates, payload] = await Promise.all([
      listTemplates(),
      gatewayFetch({
        service: "mes",
        path: `/api/v1/pm-schedules/${encodeURIComponent(id)}`,
        method: "PATCH",
        body: { next_due_at: nextDue },
      }),
    ]);
    const row = unwrapOne<Row>(payload);
    if (!row) return null;
    const byId = new Map(templates.map((t) => [str(pick(t, "id")), t]));
    return withMeta(scheduleToRecord(row, byId), id);
  },
};

/* ──────────────────────────── downtime ───────────────────────────── */

function downtimeToRecord(row: Row): Omit<AppRecord, "id"> & { id?: string } {
  const started = plantDateTime(pick(row, "started_at", "created_at"));
  const ended = pick(row, "ended_at");
  return {
    id: str(pick(row, "id")),
    reference: str(pick(row, "id")),
    date: started.date,
    startTime: started.time,
    workCenter: str(pick(row, "asset_tag")),
    reason: str(pick(row, "reason")),
    minutes: minutesBetween(pick(row, "started_at"), ended),
    kgLost: str(pick(row, "kg_lost")),
    reportedBy: str(pick(row, "operator_ref")),
    category: str(pick(row, "category")),
    status: ended ? "Closed" : "Open",
    notes: str(attrs(row).notes),
    createdAt: str(pick(row, "created_at")),
    // `mes_downtime_events` has no `updated_at`, and the collection revision is
    // `count:max(updatedAt)`. Reporting `created_at` here meant closing an
    // event changed neither the count nor the maximum, the ETag matched, and
    // the client's 304 branch kept serving the event as still Open.
    updatedAt: str(pick(row, "ended_at", "created_at")),
  };
}

export const downtimeEvents = resourceAdapter({
  service: "mes",
  path: "/api/v1/downtime-events",
  listQuery: { limit: MES_LIST_LIMIT },
  idField: "id",
  noUpdate: true,
  noDelete: true,
  toRecord: downtimeToRecord,
  fromRecord: (record) =>
    omitEmpty({
      asset_tag: record.workCenter,
      category: record.category || "unplanned",
      reason: record.reason,
      operator_ref: record.reportedBy,
      started_at: plantInstant(record.date, record.startTime),
      ended_at: endedAfter(plantInstant(record.date, record.startTime), record.minutes),
      kg_lost: numberOrUndefined(record.kgLost),
      attrs: attrsOrOmit({ notes: record.notes }),
    }),
  // There is no PATCH on a downtime event, and the create ignores `ended_at`.
  // Closing one is POST /:id/end, which stamps the end as now.
  actions: [
    {
      id: "end",
      label: "End downtime",
      doneLabel: "Closed",
      permission: "mes.add_downtime",
      whenStatus: ["Open", "open"],
      async run(_ctx, id) {
        const payload = await gatewayFetch({
          service: "mes",
          path: `/api/v1/downtime-events/${encodeURIComponent(id)}/end`,
          method: "POST",
        });
        const row = unwrapOne<Row>(payload);
        return row ? withMeta(downtimeToRecord(row), id) : null;
      },
    },
  ],
});

/* ───────────────────────────── machines ──────────────────────────── */

/**
 * mes_assets CHECKs status against `running | idle | down | pm | maint |
 * retired`, and neither case transform round-trips that set: "maint" reads as
 * "Maint" and "pm" as "Pm". So the pair is spelled out.
 */
const ASSET_STATUS_TO_SERVICE: Record<string, string> = {
  idle: "idle",
  running: "running",
  down: "down",
  pm: "pm",
  maintenance: "maint",
  maint: "maint",
  retired: "retired",
};

const ASSET_STATUS_TO_APP: Record<string, string> = {
  idle: "Idle",
  running: "Running",
  down: "Down",
  pm: "PM",
  maint: "Maintenance",
  retired: "Retired",
};

export function assetStatusForService(value: string | undefined): string {
  return ASSET_STATUS_TO_SERVICE[snakeCase(value)] || "";
}

function assetStatusForApp(value: string): string {
  return ASSET_STATUS_TO_APP[value.trim().toLowerCase()] || titleCase(value);
}

/** mes_assets.criticality CHECK: A (critical) … D. */
function criticalityForService(value: string | undefined): string | undefined {
  const letter = str(value).trim().charAt(0).toUpperCase();
  return ["A", "B", "C", "D"].includes(letter) ? letter : undefined;
}

const CRITICALITY_TO_APP: Record<string, string> = {
  A: "A — critical",
  B: "B — high",
  C: "C — medium",
  D: "D — low",
};

function assetToRecord(row: Row): Omit<AppRecord, "id"> & { id?: string } {
  const extra = attrs(row);
  return {
    id: str(pick(row, "tag")),
    reference: str(pick(row, "tag")),
    name: str(pick(row, "name")),
    code: str(pick(row, "tag")),
    type: str(pick(row, "category")),
    section: str(pick(row, "section_code")),
    location: str(pick(row, "location", "plant_code", "section_code")),
    criticality: CRITICALITY_TO_APP[str(pick(row, "criticality"))] || "",
    status: assetStatusForApp(str(pick(row, "status"))) || "Idle",
    capacityPerHour: str(pick(row, "capacity")),
    purchasedOn: isoDate(pick(row, "purchased_on")),
    supervisor: str(pick(extra, "supervisor")),
    notes: str(pick(extra, "notes")),
    createdAt: str(pick(row, "created_at")),
    updatedAt: str(pick(row, "updated_at")),
  };
}

function assetTag(record: AppRecord): string {
  const raw = (record.code || record.reference || record.name || "").trim();
  return raw.replace(/\s+/g, "-").slice(0, 64);
}

/**
 * The section a new machine is filed under. POST /assets requires one.
 *
 * This used to fall back to the first section MES returned whenever the typed
 * site matched none, so a typo filed the machine in whichever plant sorted
 * first. Now an unmatched section is refused with the list of real ones; the
 * only fallback is a plant with exactly one section, where there is no choice.
 */
export async function resolveSectionId(record: AppRecord): Promise<string> {
  const payload = await gatewayFetch({ service: "mes", path: "/api/v1/sections" });
  const sections = unwrapList<Row>(payload);
  if (!sections.length) {
    throw new Error("Create a plant section in MES before registering a machine.");
  }
  const wanted = str(record.section || record.location).trim().toLowerCase();
  const match = wanted
    ? sections.find((row) => str(pick(row, "id")).toLowerCase() === wanted) ||
      sections.find((row) => str(pick(row, "code")).toLowerCase() === wanted) ||
      sections.find((row) => str(pick(row, "name")).toLowerCase() === wanted)
    : sections.length === 1
      ? sections[0]
      : undefined;
  if (!match) {
    const known = sections
      .map((row) => [str(pick(row, "code")), str(pick(row, "name"))].filter(Boolean).join(" — "))
      .join("; ");
    throw new Error(
      wanted
        ? `No plant section "${record.section || record.location}". Sections: ${known}.`
        : `Say which plant section the machine is in. Sections: ${known}.`,
    );
  }
  const id = str(pick(match, "id"));
  if (!id) throw new Error("MES returned a section without an id.");
  return id;
}

async function getAsset(tag: string): Promise<Row | null> {
  const payload = await gatewayFetch({
    service: "mes",
    path: `/api/v1/assets/${encodeURIComponent(tag)}`,
  });
  return unwrapOne<Row>(payload);
}

export const assets: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/assets",

  async list() {
    const payload = await gatewayFetch({ service: "mes", path: "/api/v1/assets" });
    return unwrapList<Row>(payload).map((row) =>
      withMeta(assetToRecord(row), str(pick(row, "tag"))),
    );
  },

  async create(_ctx, record) {
    const tag = assetTag(record);
    if (!tag) throw new Error("Give the machine an asset code.");
    const sectionId = await resolveSectionId(record);
    const payload = await gatewayFetch({
      service: "mes",
      path: "/api/v1/assets",
      method: "POST",
      body: omitEmpty({
        section_id: sectionId,
        tag,
        name: record.name || record.code,
        category: record.type || "machine",
        criticality: criticalityForService(record.criticality),
        status: assetStatusForService(record.status) || "idle",
        location: record.location,
        capacity: numberOrUndefined(record.capacityPerHour),
        purchased_on: rfc3339(record.purchasedOn),
        attrs: attrsOrOmit({ supervisor: record.supervisor, notes: record.notes }),
      }),
    });
    const row = unwrapOne<Row>(payload);
    return row ? withMeta(assetToRecord(row), tag) : null;
  },

  /**
   * PATCH /assets/:tag replaces `attrs` whole, and the form sends only what
   * changed — so editing the notes used to wipe the responsible technician.
   * The stored bag is read first and the change laid over it.
   */
  async update(_ctx, id, record) {
    if (record.criticality !== undefined) {
      throw new Error(
        "Criticality is set when a machine is registered; MES has no edit for it yet.",
      );
    }
    if (record.section !== undefined) {
      throw new Error("A machine's plant section is set when it is registered.");
    }
    let mergedAttrs: Record<string, unknown> | undefined;
    if (record.supervisor !== undefined || record.notes !== undefined) {
      const current = await getAsset(id);
      mergedAttrs = { ...(current ? attrs(current) : {}) };
      if (record.supervisor !== undefined) mergedAttrs.supervisor = record.supervisor;
      if (record.notes !== undefined) mergedAttrs.notes = record.notes;
    }
    const payload = await gatewayFetch({
      service: "mes",
      path: `/api/v1/assets/${encodeURIComponent(id)}`,
      method: "PATCH",
      body: omitEmpty({
        name: record.name,
        status: assetStatusForService(record.status) || undefined,
        location: record.location,
        capacity: numberOrUndefined(record.capacityPerHour),
        purchased_on: rfc3339(record.purchasedOn),
        attrs: mergedAttrs,
      }),
    });
    const row = unwrapOne<Row>(payload);
    return row ? withMeta(assetToRecord(row), id) : null;
  },
};

