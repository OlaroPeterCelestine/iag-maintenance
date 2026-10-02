/**
 * module/entity → IAG service mapping for the Production app.
 *
 * Two services own this tab:
 *
 *   iag-mes (`/api/v1/mes` + service `/api/v1`)
 *     GET/POST /work-orders, PATCH /work-orders/:num      → batch-records
 *     GET/POST /downtime-events, POST /:id/end            → downtime-logs
 *     GET/POST /assets, PATCH /assets/:tag                → work-centers
 *
 *   iag-production (`/api/v1/production` + service `/api/v1`)
 *     GET/POST /production-orders                         → production-orders
 *     GET/POST /production-runs, /:id/advance, /:id/complete → roast-batches
 *     GET/POST/PATCH /packaging-runs/:businessId          → packaging-runs
 *     GET/POST /schedule-blocks                           → production-plans
 *     GET /production-runs (derived, read-only)           → yield-reports
 *
 * The iag-production adapters are the ones iag-inventory ships for the same
 * screens (its Inventory tab renders roasting and packaging too), ported here
 * so the two apps read and write the same rows. Before this, production
 * orders and batch records both pointed at MES work orders — one upstream
 * collection shown as two screens — and roasting, packaging, plans and yield
 * fell through to the Go API.
 *
 * Both services are snake_case. Bill of materials reads iag-production's
 * `/boms` (migration 007), the same table the Inventory app's kits use.
 */
import type { ServiceKey } from "@/lib/iag/config";
import { gatewayFetch, unwrapList, unwrapOne } from "@/lib/iag/gateway";
import { resourceAdapter } from "@/lib/iag/records/resource";
import {
  parseComponents,
  serialiseComponents,
  type BomLineInput,
} from "@/lib/iag/records/bom-lines";
import {
  attachmentRefs,
  attachmentsJson,
  isoDate,
  money,
  omitEmpty,
  pick,
  rfc3339,
  str,
  type AppRecord,
  type RecordAction,
  type RecordAdapter,
} from "@/lib/iag/records/types";

type Row = Record<string, unknown>;

/**
 * Page size asked of every collection.
 *
 * Each of these services caps its own list — 50 rows on MES work orders and
 * downtime, 50 on production runs — and none of the adapters asked for more,
 * so a screen showing "all" batch records was showing the most recent fifty
 * with nothing to say so. 200 is the largest any of them accepts.
 *
 * The MES handlers still pass a literal 50 and ignore this; the matching
 * service change makes them read it. Sending it early is harmless — an
 * unknown query parameter is dropped — and the day the service lands, the
 * screens widen without a frontend deploy.
 */
const LIST_LIMIT = 200;

/**
 * Window asked of the schedule, in days either side of today.
 *
 * `ListScheduleBlocks` defaults to `now-1d … now+14d`. A production plan is
 * booked by the week and routinely sits further out than a fortnight, so the
 * default silently hid rows that had saved perfectly well.
 */
const SCHEDULE_WINDOW_DAYS = 180;

function scheduleWindow(): Record<string, string> {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  return {
    from: new Date(now - SCHEDULE_WINDOW_DAYS * day).toISOString(),
    to: new Date(now + SCHEDULE_WINDOW_DAYS * day).toISOString(),
  };
}

function attrs(row: Row): Row {
  const bag = row.attrs;
  return bag && typeof bag === "object" && !Array.isArray(bag) ? (bag as Row) : {};
}

/**
 * An `attrs` bag to send, or `undefined` when there is nothing in it to send.
 *
 * This exists because of how the app updates a record. `updateRecordAsync`
 * sends only the fields the form changed, and every service here replaces the
 * whole bag when one arrives (`if in.Attrs != nil { cur.Attrs = in.Attrs }`).
 * An adapter that built `attrs` unconditionally therefore sent
 * `{attachments: []}` on a status-only edit and cleared the record's stored
 * paperwork — on packaging runs, which is where a recall starts.
 *
 * Returning `undefined` makes `omitEmpty` drop the key, so an edit that says
 * nothing about attachments leaves the stored ones alone. Same contract as
 * `attachmentRefs`, which has always worked this way for the same reason.
 */
function attrsOrOmit(bag: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bag)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

const workOrders = resourceAdapter({
  service: "mes",
  path: "/api/v1/work-orders",
  listQuery: { limit: LIST_LIMIT },
  idField: "num",
  noDelete: true,
  itemPath: (id) => `/api/v1/work-orders/${encodeURIComponent(id)}`,
  toRecord: (row: Row) => {
    const extra = attrs(row);
    return {
      id: str(pick(row, "num")),
      reference: str(pick(row, "num")),
      date: isoDate(pick(row, "created_at", "due_at")),
      finishedItem: str(pick(row, "title")),
      recipe: str(extra.recipe),
      workCenter: str(pick(row, "asset_tag")),
      quantity: str(extra.quantity),
      unit: str(extra.unit),
      materials: str(extra.materials),
      location: str(pick(row, "asset_tag")),
      // The batch-record form collects a production run's actual figures, and
      // a CMMS work order has no column for any of them. They ride in `attrs`,
      // which the service stores and returns verbatim — before this they were
      // collected on a required field and dropped on the floor.
      productionOrder: str(extra.productionOrder),
      bom: str(extra.bom),
      operator: str(pick(row, "assignee")),
      inputQuantity: str(extra.inputQuantity),
      outputQuantity: str(extra.outputQuantity),
      yieldPercent: str(extra.yieldPercent),
      steps: str(extra.steps),
      attachments: attachmentsJson(pick(extra, "attachments")),
      // lower_snake upstream; the form's select is Title Case.
      status: titleCase(str(pick(row, "status"))) || "Open",
      notes: str(pick(row, "wo_type")),
      createdAt: str(pick(row, "created_at")),
      updatedAt: str(pick(row, "updated_at")),
    };
  },
  fromRecord: (record) =>
    omitEmpty({
      num: record.reference,
      title: record.finishedItem || record.reference,
      asset_tag: record.workCenter || record.location,
      wo_type: record.notes || "production",
      // mes_work_orders CHECKs status against a lower_snake set, so the form's
      // Title Case has to be folded. Sent raw, every option this form offers
      // was refused by the column.
      status: snakeCase(record.status),
      assignee: record.operator || undefined,
      attrs: omitEmpty({
        recipe: record.recipe,
        quantity: record.quantity,
        unit: record.unit,
        materials: record.materials,
        productionOrder: record.productionOrder,
        bom: record.bom,
        inputQuantity: record.inputQuantity,
        outputQuantity: record.outputQuantity,
        yieldPercent: record.yieldPercent,
        steps: record.steps,
        attachments: attachmentRefs(record.attachments),
      }),
    }),
  createDefaults: (record) =>
    omitEmpty({
      priority: "normal",
      status: snakeCase(record.status) || "open",
    }),
});

function downtimeToRecord(row: Row) {
  return {
    id: str(pick(row, "id")),
    reference: str(pick(row, "id")),
    date: isoDate(pick(row, "started_at", "created_at")),
    workCenter: str(pick(row, "asset_tag")),
    reason: str(pick(row, "reason")),
    minutes: minutesBetween(pick(row, "started_at"), pick(row, "ended_at")),
    reportedBy: str(pick(row, "operator_ref")),
    category: str(pick(row, "category")),
    status: pick(row, "ended_at") ? "Closed" : "Open",
    notes: str(pick(row, "reason")),
    createdAt: str(pick(row, "created_at")),
    // `mes_downtime_events` has no `updated_at`, and the collection revision is
    // `count:max(updatedAt)`. Reporting `created_at` here meant closing an
    // event changed neither the count nor the maximum, the ETag matched, and
    // the client's 304 branch kept serving the event as still Open.
    updatedAt: str(pick(row, "ended_at", "created_at")),
  };
}

const downtimeEvents = resourceAdapter({
  service: "mes",
  path: "/api/v1/downtime-events",
  listQuery: { limit: LIST_LIMIT },
  idField: "id",
  noUpdate: true,
  noDelete: true,
  toRecord: downtimeToRecord,
  fromRecord: (record) =>
    omitEmpty({
      asset_tag: record.workCenter,
      category: record.category || "unplanned",
      reason: record.reason || record.notes,
      operator_ref: record.reportedBy,
      started_at: record.date || undefined,
    }),
  // There is no PATCH on a downtime event. Closing it is POST /:id/end.
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
        if (!row) return null;
        const mapped = downtimeToRecord(row);
        return {
          ...mapped,
          id: str(pick(row, "id")) || id,
          createdAt: mapped.createdAt || "",
          updatedAt: mapped.updatedAt || mapped.createdAt || "",
        };
      },
    },
  ],
});

/**
 * mes_assets CHECKs status against `running | idle | down | pm | maint`, and
 * neither `titleCase` nor `snakeCase` round-trips that set: "maint" reads as
 * "Maint" and "pm" as "Pm". So the pair is spelled out rather than derived —
 * the form says what an engineer says, the column gets what it accepts.
 *
 * This is why creating a work centre always failed: "Active" was the form's
 * default option and is not a status this column has ever allowed.
 */
const ASSET_STATUS_TO_SERVICE: Record<string, string> = {
  idle: "idle",
  running: "running",
  down: "down",
  pm: "pm",
  maintenance: "maint",
  maint: "maint",
};

const ASSET_STATUS_TO_APP: Record<string, string> = {
  idle: "Idle",
  running: "Running",
  down: "Down",
  pm: "PM",
  maint: "Maintenance",
};

function assetStatusForService(value: string): string {
  return ASSET_STATUS_TO_SERVICE[snakeCase(value)] || "";
}

function assetStatusForApp(value: string): string {
  return ASSET_STATUS_TO_APP[value.trim().toLowerCase()] || titleCase(value);
}

function assetToRecord(row: Row) {
  return {
    id: str(pick(row, "tag")),
    reference: str(pick(row, "tag")),
    name: str(pick(row, "name")),
    code: str(pick(row, "tag")),
    type: str(pick(row, "category")),
    location: str(pick(row, "location", "plant_code", "section_code")),
    status: assetStatusForApp(str(pick(row, "status"))) || "Idle",
    // Typed columns on mes_assets since the capacity migration; the form
    // collected both and the adapter kept neither.
    capacityPerHour: str(pick(row, "capacity")),
    supervisor: str(pick(attrs(row), "supervisor")),
    notes: str(pick(attrs(row), "notes")),
    createdAt: str(pick(row, "created_at")),
    updatedAt: str(pick(row, "updated_at")),
  };
}

function assetTag(record: AppRecord): string {
  const raw = (record.code || record.reference || record.name || "").trim();
  const tag = raw.replace(/\s+/g, "-").slice(0, 64);
  return tag || `WC-${Date.now()}`;
}

async function resolveSectionId(record: AppRecord): Promise<string> {
  const payload = await gatewayFetch({
    service: "mes",
    path: "/api/v1/sections",
  });
  const sections = unwrapList<Row>(payload);
  if (!sections.length) {
    throw new Error(
      "Create a plant section in MES before adding a work centre — POST /assets needs section_id.",
    );
  }
  const loc = str(record.location).trim().toLowerCase();
  const match =
    sections.find((row) => str(pick(row, "id")) === str(record.location).trim()) ||
    sections.find((row) => str(pick(row, "code")).toLowerCase() === loc) ||
    sections.find((row) => str(pick(row, "name")).toLowerCase() === loc) ||
    sections[0];
  const id = str(pick(match, "id"));
  if (!id) {
    throw new Error("MES returned a section without an id.");
  }
  return id;
}

const assetsBase = resourceAdapter({
  service: "mes",
  path: "/api/v1/assets",
  idField: "tag",
  noCreate: true,
  noDelete: true,
  itemPath: (id) => `/api/v1/assets/${encodeURIComponent(id)}`,
  toRecord: assetToRecord,
  fromRecord: (record) =>
    omitEmpty({
      name: record.name,
      status: assetStatusForService(record.status),
      location: record.location,
      capacity: Number(record.capacityPerHour) || undefined,
      attrs: attrsOrOmit({ supervisor: record.supervisor, notes: record.notes }),
    }),
});

const assets: RecordAdapter = {
  ...assetsBase,
  readOnly: false,
  async create(_ctx, record) {
    const sectionId = await resolveSectionId(record);
    const payload = await gatewayFetch({
      service: "mes",
      path: "/api/v1/assets",
      method: "POST",
      body: omitEmpty({
        section_id: sectionId,
        tag: assetTag(record),
        name: record.name || record.code || record.reference,
        category: record.type || "machine",
        status: assetStatusForService(record.status) || "idle",
        location: record.location,
        capacity: Number(record.capacityPerHour) || undefined,
        attrs: attrsOrOmit({ supervisor: record.supervisor, notes: record.notes }),
      }),
    });
    const row = unwrapOne<Row>(payload);
    if (!row) return null;
    const mapped = assetToRecord(row);
    return {
      ...mapped,
      id: str(pick(row, "tag")) || mapped.id || assetTag(record),
      createdAt: mapped.createdAt || "",
      updatedAt: mapped.updatedAt || mapped.createdAt || "",
    };
  },
};

const attachments = resourceAdapter({
  service: "finance",
  path: "/v1/attachments",
  toRecord: (row: Row) => ({
    name: str(pick(row, "fileName", "file_name", "name", "filename")),
    linkedTo: str(pick(row, "recordRef", "record_ref", "documentRef", "linkedTo")),
    fileUrl: str(pick(row, "url", "fileUrl", "downloadUrl")),
    date: isoDate(pick(row, "createdAt", "created_at", "uploadedAt")),
    status: str(pick(row, "status")) || "Stored",
    createdAt: "",
    updatedAt: "",
  }),
});

/**
 * Any `POST /:resource/:id/:verb` route, as a row action.
 *
 * `postAction` above is this with warehouse's posting verb filled in. The
 * general form exists because posting is not the only verb a service keeps off
 * its resource: a production run advances and completes through its own routes,
 * and a flat record has no field that can express either.
 *
 * `idField` matters for services that address a record by business key rather
 * than by UUID — the id the app holds is whatever that resource's `idField`
 * produced, and the verb has to be called with the same one.
 */
function verbAction(args: {
  service: ServiceKey;
  resource: string;
  verb: string;
  id: string;
  label: string;
  doneLabel: string;
  permission: string;
  whenStatus?: string[];
  /** Response field carrying the record id; defaults to `id`. */
  idField?: string;
  /**
   * Body posted with the verb. `/advance` writes `to_stage` with no COALESCE
   * guard, so the empty default would blank the run — callers that use that
   * route must send the next stage here.
   */
  body?: Record<string, unknown>;
  toRecord: (row: Row) => Omit<AppRecord, "id"> & { id?: string };
}): RecordAction {
  const { service, resource, verb, toRecord, idField = "id", body = {}, ...rest } = args;
  return {
    id: rest.id,
    label: rest.label,
    doneLabel: rest.doneLabel,
    permission: rest.permission,
    whenStatus: rest.whenStatus,
    async run(_ctx, id) {
      const payload = await gatewayFetch({
        service,
        path: `${resource}/${encodeURIComponent(id)}/${verb}`,
        method: "POST",
        body,
      });
      const row = unwrapOne<Row>(payload);
      if (!row) return null;
      const mapped = toRecord(row);
      return {
        ...mapped,
        id: str(pick(row, idField)) || id,
        createdAt: mapped.createdAt || "",
        updatedAt: mapped.updatedAt || "",
      } as AppRecord;
    },
  };
}

/** Service enums are lower_snake; the app's columns read as prose. */
function titleCase(value: string): string {
  if (!value) return "";
  return value
    .split(/[\s_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The app's status selects are Title Case; the service's are lower_snake.
 *
 * Tolerates an absent value, like `titleCase` above. A flat record legitimately
 * omits optional columns, and throwing on one would take down a whole save for
 * a field the service does not require.
 */
function snakeCase(value: string | undefined | null): string {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

/* ──────────────── roast batches (iag-production) ──────────────── */

/**
 * Named rather than inline because the stage verbs below return the same row
 * shape and have to map it the same way. An action that mapped a run by hand
 * would drift from the list mapping the first time either changed.
 */
function roastBatchToRecord(row: Row): Omit<AppRecord, "id"> & { id?: string } {
  {
    const extra = attrs(row);
    const kgIn = Number(pick(row, "kg_in")) || 0;
    const kgOut = Number(pick(row, "kg_out")) || 0;
    return {
      reference: str(pick(row, "business_id", "id")),
      date: isoDate(pick(row, "started_at", "created_at")),
      // `po_num` is the typed column; the attrs key is what orders written
      // before the link existed carry, so both are read.
      productionOrder: str(pick(row, "po_num")) || str(pick(extra, "productionOrder")),
      greenLot: str(pick(row, "batch_business_id")),
      // `process` is the stage kind (a CHECK enum — a roast batch is `roast`);
      // the recipe the operator names lives in the run's attrs. Older runs
      // that wrote the recipe into `process` still read back.
      recipe: str(pick(extra, "recipe")) || str(pick(row, "process")),
      roaster: str(pick(row, "asset_tag")),
      inputWeight: money(kgIn),
      outputWeight: money(kgOut),
      roastLoss:
        kgIn > 0 ? String(Math.round(((kgIn - kgOut) / kgIn) * 10_000) / 100) : "",
      // The roast profile. No typed column upstream — a production run is a
      // generic staged run, not a roast curve — so these live in the run's
      // `attrs` bag rather than being collected and discarded. If they are ever
      // charted rather than only read back, they have earned real columns.
      chargeTemperature: str(pick(extra, "chargeTemperature")),
      endTemperature: str(pick(extra, "endTemperature")),
      roastTime: str(pick(extra, "roastTime")),
      operator: str(pick(row, "operator_ref")),
      status: titleCase(str(pick(row, "status", "stage"))) || "Running",
      profileNotes: str(pick(extra, "profileNotes")) || str(pick(row, "grade_prelim")),
      attachments: attachmentsJson(pick(extra, "attachments")),
      createdAt: "",
      updatedAt: "",
    };
  }
}

const roastBatches = resourceAdapter({
  service: "production",
  path: "/api/v1/production-runs",
  listQuery: { limit: LIST_LIMIT },
  // Not `business_id`, tempting as that is — every verb below parses `:id` with
  // `uuid.Parse` and 400s on anything else, so the id the app carries has to be
  // the UUID even though `reference` shows the business key.
  toRecord: roastBatchToRecord,
  fromRecord: (record) =>
    omitEmpty({
      // The number the operator typed; the service generates one otherwise.
      // Required on the form and previously discarded.
      business_id: record.reference,
      batch_business_id: record.greenLot,
      // The form's "Roast profile / recipe" used to be sent here, and the
      // column is `CHECK (process IN ('wet','dry','wetmill','drying',
      // 'drymill','roast','p1','p2'))` — every roast batch was refused with a
      // constraint violation. This screen is roasting; the recipe the operator
      // names keeps its own place in `attrs`, which is what iag-inventory does
      // for the same screen against the same table.
      process: "roast",
      asset_tag: record.roaster,
      operator_ref: record.operator,
      // The order this run works off. Without it `syncOrderStatusTx` has no
      // order to derive from, so every production order this app created sat
      // at Queued for good however many runs were completed against it.
      po_num: record.productionOrder,
      kg_in: Number(record.inputWeight) || undefined,
      // Accepted at creation since the service was tagged: a roast logged from
      // the operator's sheet after the shift knows both weights already.
      kg_out: Number(record.outputWeight) || undefined,
      attrs: attrsOrOmit({
        recipe: record.recipe,
        chargeTemperature: record.chargeTemperature,
        endTemperature: record.endTemperature,
        roastTime: record.roastTime,
        profileNotes: record.profileNotes,
        attachments: attachmentRefs(record.attachments),
      }),
    }),
  /**
   * A run's stage is not a column, so it cannot be written from a flat record —
   * that part of the old comment was right, and `noUpdate` stays.
   *
   * What was wrong was stopping there. iag-production moves a run with
   * `POST /production-runs/:id/advance` and closes it with `/complete`, and with
   * neither declared here a roast batch created from this app sat at its opening
   * stage for good: the screen could start a roast and never finish one.
   *
   * `/advance` needs `to_stage` and `stage_idx`. Its UPDATE sets those two
   * columns with no COALESCE guard — so posting an empty body would blank the
   * run's stage. "Start roast" is that verb with a real body. `route-output`
   * and `ccp-readings` still need a destination / a reading, so they stay off.
   *
   * `complete` is safe empty: every optional column is written through
   * `COALESCE(NULLIF(...))`, so an empty body sets status and `completed_at` and
   * preserves the rest, which is exactly what the button claims to do.
   */
  actions: [
    verbAction({
      service: "production",
      resource: "/api/v1/production-runs",
      verb: "advance",
      id: "start-roast",
      label: "Start roast",
      doneLabel: "Roasting",
      permission: "production.change_run",
      whenStatus: ["open", "Open", "scheduled", "Scheduled"],
      body: { to_stage: "roasting", stage_idx: 1 },
      toRecord: roastBatchToRecord,
    }),
    verbAction({
      service: "production",
      resource: "/api/v1/production-runs",
      verb: "complete",
      id: "complete",
      label: "Complete run",
      doneLabel: "Completed",
      permission: "production.change_run",
      // A completed run does not complete again. The service's statuses are
      // lower_snake and the app renders `status` as it arrives, so both
      // spellings are listed rather than assuming which side normalises.
      whenStatus: [
        "open",
        "Open",
        "running",
        "Running",
        "in_progress",
        "In Progress",
        "scheduled",
        "Scheduled",
        "roasting",
        "Roasting",
      ],
      toRecord: roastBatchToRecord,
    }),
  ],
  noUpdate: true,
  noDelete: true,
});

/* ───────────── packaging runs (iag-production) ───────────────── */

/**
 * App columns: reference, date, roastBatch, finishedItem, packSize,
 * plannedQuantity, quantity, packagingMaterial, lotCode, bestBefore, line,
 * operator, status, notes, attachments.
 *
 * There was no packaging resource on the platform, so this screen was unwired.
 * `prod_packaging_runs` (migration 006) is that resource. It is a table of its
 * own rather than a production run with a different label because a packaging
 * run yields a *count of packs* where a production run yields kilos, and it is
 * the first point where a unit acquires a lot code and a best-before — the two
 * fields a recall is run from.
 *
 * Writable, including update: unlike a stock movement, a packaging run is
 * edited while it runs. The pack count is not known when it is scheduled and
 * the lot code is often assigned at the line.
 */
const packagingRuns = resourceAdapter({
  service: "production",
  path: "/api/v1/packaging-runs",
  idField: "business_id",
  itemPath: (id) => `/api/v1/packaging-runs/${encodeURIComponent(id)}`,
  toRecord: (row: Row) => ({
    reference: str(pick(row, "business_id")),
    date: isoDate(pick(row, "run_date")),
    roastBatch: str(pick(row, "batch_business_id")),
    finishedItem: str(pick(row, "finished_item")),
    packSize: money(pick(row, "pack_size_kg")),
    plannedQuantity: money(pick(row, "planned_qty")),
    quantity: money(pick(row, "qty")),
    packagingMaterial: str(pick(row, "packaging_material")),
    lotCode: str(pick(row, "lot_code")),
    bestBefore: isoDate(pick(row, "best_before")),
    line: str(pick(row, "line_code")),
    operator: str(pick(row, "operator_ref")),
    status: titleCase(str(pick(row, "status"))) || "Scheduled",
    notes: str(pick(row, "notes")),
    attachments: attachmentsJson(pick(attrs(row), "attachments")),
    createdAt: "",
    updatedAt: "",
  }),
  fromRecord: (record) =>
    omitEmpty({
      business_id: record.reference,
      run_date: rfc3339(record.date),
      batch_business_id: record.roastBatch,
      finished_item: record.finishedItem,
      // `|| undefined`, never `|| 0`. UpdatePackagingRunInput takes pointers,
      // so a zero that reaches it is applied: an edit that changed only the
      // status used to send three zeros and wipe the pack count, the planned
      // count and the run's output kilos with them.
      pack_size_kg: Number(record.packSize) || undefined,
      planned_qty: Number(record.plannedQuantity) || undefined,
      qty: Number(record.quantity) || undefined,
      packaging_material: record.packagingMaterial,
      // Derived only when the form actually supplied a batch and a date — a
      // partial edit knows neither and must not overwrite the assigned code.
      lot_code:
        record.lotCode ||
        (record.roastBatch && record.date ? `${record.roastBatch}-${record.date}` : undefined),
      best_before: rfc3339(record.bestBefore),
      line_code: record.line,
      operator_ref: record.operator,
      status: snakeCase(record.status),
      notes: record.notes,
      // A packaging run has no typed column for its paperwork, and the run is
      // where a recall starts — the lot code and best-before live here — so
      // losing the certificate attached to it is the worst version of this bug.
      // Omitted when there is nothing to send, or a status edit clears it.
      attrs: attrsOrOmit({ attachments: attachmentRefs(record.attachments) }),
    }),
  updateMethod: "PATCH",
  // History, once packed, is corrected by another run rather than deleted.
  noDelete: true,
});

/* ──────────────── production orders (iag-production) ───────────── */

/**
 * App columns: reference, date, finishedItem, recipe, workCenter, quantity,
 * unit, materials, materialCost, nonInventoryCost, finishedValue, location,
 * division, status, notes, attachments.
 *
 * This screen was unmapped because the service had `POST /production-orders`
 * and `GET /production-orders/schedule` but no plain collection GET, so there
 * was nothing for a REST client to list. The collection GET now exists (same
 * handler as the schedule route, which is where the list has always lived).
 *
 * A production order here is a schedule entry, not a cost object, so the recipe
 * and the costing columns have no typed field upstream. They are not dropped:
 * `prod_production_orders` carries an `attrs` bag that create and update both
 * accept, and they round-trip through it — the same mechanism the item columns
 * use. Two of them, `recipe` and `materials`, are marked required on the form,
 * so discarding them meant making a user fill fields that went nowhere.
 *
 * **`division` is no longer written to `customer`.** It used to be, which put
 * two different concepts in one column: a division is an internal reporting
 * segment and a customer is who the order is for, and the app has no customer
 * field at all. It now rides in `attrs` and still reads back from `customer`
 * so orders written before this change keep showing what they showed.
 */
const productionOrders = resourceAdapter({
  service: "production",
  path: "/api/v1/production-orders",
  toRecord: (row: Row) => {
    const extra = attrs(row);
    return {
      reference: str(pick(row, "po_num", "id")),
      // The service stamps created_at; `date` in attrs is the order date the
      // planner entered, which can be earlier.
      date: isoDate(pick(extra, "date")) || isoDate(pick(row, "created_at")),
      dueDate: isoDate(pick(row, "due_at")),
      finishedItem: str(pick(row, "product")),
      recipe: str(pick(extra, "recipe")),
      workCenter: str(pick(row, "asset_tag")),
      quantity: money(pick(row, "qty_kg")),
      unit: str(pick(extra, "unit")) || "kg",
      materials: str(pick(extra, "materials")),
      materialCost: str(pick(extra, "materialCost")),
      nonInventoryCost: str(pick(extra, "nonInventoryCost")),
      finishedValue: str(pick(extra, "finishedValue")),
      location: str(pick(extra, "location")),
      division: str(pick(extra, "division")) || str(pick(row, "customer")),
      greenLot: str(pick(row, "origin_lot")),
      status: titleCase(str(pick(row, "status"))) || "Queued",
      notes: str(pick(extra, "notes")),
      attachments: attachmentsJson(pick(extra, "attachments")),
      createdAt: "",
      updatedAt: "",
    };
  },
  fromRecord: (record) =>
    omitEmpty({
      po_num: record.reference,
      product: record.finishedItem,
      qty_kg: Number(record.quantity) || 0,
      origin_lot: record.greenLot,
      asset_tag: record.workCenter,
      status: snakeCase(record.status),
      attrs: attrsOrOmit({
        date: record.date,
        recipe: record.recipe,
        unit: record.unit,
        materials: record.materials,
        materialCost: record.materialCost,
        nonInventoryCost: record.nonInventoryCost,
        finishedValue: record.finishedValue,
        location: record.location,
        division: record.division,
        notes: record.notes,
        attachments: attachmentRefs(record.attachments),
      }),
    }),
  // Create goes to the schedule sub-path. The collection POST is a legacy
  // event-publishing verb that persists nothing — posting a new order there
  // would emit mill-stage events and store no order.
  createPath: "/api/v1/production-orders/schedule",
  noUpdate: true,
  noDelete: true,
});


/* ─────────────── bill of materials (iag-production) ──────────── */

/**
 * App columns: name, code, finishedItem, version, components, batchSize,
 * unit, status, notes, attachments. Upstream is `/boms` (migration 007) —
 * a header keyed on `business_id` (the code) plus real lines, which the
 * form's one `components` field is parsed into and serialised from
 * (records/bom-lines.ts). The same table is the Inventory app's kit.
 *
 * Status is the service's lower-case set; the form's Title Case is folded.
 * Attachments ride in `attrs`, as every other iag-production adapter does.
 */
const billOfMaterials = resourceAdapter({
  service: "production",
  path: "/api/v1/boms",
  idField: "business_id",
  itemPath: (id) => `/api/v1/boms/${encodeURIComponent(id)}`,
  toRecord: (row: Row) => ({
    name: str(pick(row, "name")),
    code: str(pick(row, "business_id")),
    finishedItem: str(pick(row, "finished_item")),
    version: str(pick(row, "version")),
    components: serialiseComponents(pick(row, "lines") as BomLineInput[] | undefined),
    batchSize: money(pick(row, "batch_size")),
    unit: str(pick(row, "unit")),
    status: titleCase(str(pick(row, "status"))) || "Draft",
    notes: str(pick(row, "notes")),
    attachments: attachmentsJson(pick(attrs(row), "attachments")),
    createdAt: "",
    updatedAt: "",
  }),
  fromRecord: (record) =>
    omitEmpty({
      business_id: record.code,
      name: record.name,
      finished_item: record.finishedItem,
      version: record.version,
      batch_size: Number(record.batchSize) || undefined,
      unit: record.unit,
      status: snakeCase(record.status),
      notes: record.notes,
      lines: record.components ? parseComponents(record.components) : undefined,
      attrs: attrsOrOmit({ attachments: attachmentRefs(record.attachments) }),
    }),
  updateMethod: "PATCH",
});

/* ─────────────── production plans (iag-production) ───────────── */

/**
 * App columns: reference, date, weekOf, product, plannedQuantity, workCenter,
 * owner, status, notes.
 *
 * A plan is a schedule block on a work centre: `asset_tag`, `starts_at` and
 * `ends_at` are the service's required fields, and the rest of what the
 * planner types rides in the block's `attrs` bag, which the service stores and
 * returns verbatim. A block spans the planned week — `weekOf` to seven days
 * later — so the service's calendar shows it where the planner put it.
 *
 * The service has GET and POST on this collection and nothing else, so a plan
 * is created and read, not edited: `noUpdate` / `noDelete` are the router.
 */
function planToRecord(row: Row): Omit<AppRecord, "id"> & { id?: string } {
  const extra = attrs(row);
  return {
    id: str(pick(row, "id")),
    reference: str(pick(extra, "reference")) || str(pick(row, "label")),
    date: isoDate(pick(extra, "date")) || isoDate(pick(row, "created_at")),
    weekOf: isoDate(pick(row, "starts_at")),
    product: str(pick(extra, "product")) || str(pick(row, "label")),
    plannedQuantity: str(pick(extra, "plannedQuantity")),
    workCenter: str(pick(row, "asset_tag")),
    owner: str(pick(extra, "owner")),
    status: str(pick(extra, "status")) || "Planned",
    notes: str(pick(extra, "notes")),
    createdAt: str(pick(row, "created_at")),
    updatedAt: str(pick(row, "created_at")),
  };
}

function weekEnd(weekOf: string): string | undefined {
  const start = Date.parse(weekOf);
  if (!Number.isFinite(start)) return undefined;
  return new Date(start + 7 * 24 * 60 * 60 * 1000).toISOString();
}

const productionPlans = resourceAdapter({
  service: "production",
  path: "/api/v1/schedule-blocks",
  listQuery: scheduleWindow,
  toRecord: planToRecord,
  fromRecord: (record) =>
    omitEmpty({
      asset_tag: record.workCenter,
      block_type: "plan",
      label: record.product || record.reference,
      starts_at: rfc3339(record.weekOf || record.date),
      ends_at: weekEnd(record.weekOf || record.date),
      attrs: attrsOrOmit({
        reference: record.reference,
        date: record.date,
        product: record.product,
        plannedQuantity: record.plannedQuantity,
        owner: record.owner,
        status: record.status,
        notes: record.notes,
      }),
    }),
  noUpdate: true,
  noDelete: true,
});

/* ─────────────── yield reports (derived from runs) ────────────── */

/**
 * App columns: reference, date, batch, product, plannedQuantity, actualQuantity,
 * yieldPercent, wasteQuantity, owner, status, notes.
 *
 * A yield report is arithmetic over a production run — kilos in, kilos out —
 * not a record anyone types. Derived from `/production-runs` and read-only:
 * the run is the thing to correct if a figure is wrong.
 */
const yieldReports: RecordAdapter = {
  service: "production",
  resource: "/api/v1/production-runs",
  readOnly: true,
  async list() {
    const payload = await gatewayFetch({
      service: "production",
      path: "/api/v1/production-runs",
      query: { limit: LIST_LIMIT },
    });
    return unwrapList<Row>(payload).map((row) => {
      const kgIn = Number(pick(row, "kg_in")) || 0;
      const kgOut = Number(pick(row, "kg_out")) || 0;
      return {
        id: str(pick(row, "id")),
        reference: str(pick(row, "business_id", "id")),
        date: isoDate(pick(row, "completed_at", "started_at", "created_at")),
        batch: str(pick(row, "batch_business_id")),
        product: str(pick(row, "process")),
        plannedQuantity: money(kgIn),
        actualQuantity: money(kgOut),
        yieldPercent: kgIn > 0 ? String(Math.round((kgOut / kgIn) * 10_000) / 100) : "",
        wasteQuantity: kgIn > 0 ? money(Math.max(0, kgIn - kgOut)) : "",
        owner: str(pick(row, "operator_ref")),
        status: titleCase(str(pick(row, "status", "stage"))) || "Running",
        notes: str(pick(row, "grade_prelim")),
        // Real timestamps, because the collection revision is
        // `count:max(updatedAt)` and this adapter builds its own records
        // rather than going through `normalise`. Reporting "" pinned every
        // revision at `count:0`, so correcting a run's kilos changed nothing
        // the ETag could see and the client 304'd on stale yield figures for
        // as long as the row count held.
        createdAt: str(pick(row, "created_at")),
        updatedAt: str(pick(row, "updated_at", "completed_at", "created_at")),
      } as AppRecord;
    });
  },
};

function minutesBetween(start: unknown, end: unknown): string {
  const startMs = Date.parse(str(start));
  const endMs = Date.parse(str(end));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return "";
  }
  return String(Math.round((endMs - startMs) / 60_000));
}

export const RECORD_ADAPTERS: Record<string, RecordAdapter> = {
  "documents:attachments": attachments,
  // iag-mes
  "production:batch-records": workOrders,
  "production:downtime-logs": downtimeEvents,
  "production:work-centers": assets,
  // iag-production
  "production:production-orders": productionOrders,
  "production:roast-batches": roastBatches,
  "production:packaging-runs": packagingRuns,
  "production:production-plans": productionPlans,
  "production:yield-reports": yieldReports,
  "production:bill-of-materials": billOfMaterials,
};

export function adapterFor(
  module: string,
  entity: string,
): RecordAdapter | null {
  return RECORD_ADAPTERS[`${module}:${entity}`] ?? null;
}

export function mappedKeys(): string[] {
  return Object.keys(RECORD_ADAPTERS).sort();
}
