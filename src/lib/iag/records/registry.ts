/**
 * module/entity → IAG service mapping for the Maintenance app.
 *
 * The maintenance tabs are all iag-mes; see `mes-maintenance.ts` for the
 * mapping and why each tab sits where it does:
 *
 *   work-centers (Machines), work-orders, batch-records (Job Cards),
 *   pm-templates, pm-schedules, downtime-logs, reliability, alerts,
 *   recommendations, technicians (picker only)
 *
 * The iag-production adapters below (roasting, packaging, yield) came over with
 * the Production app this one was cloned from. No maintenance tab shows them;
 * they stay mapped so a stray link reads the right service rather than falling
 * through to the Go API.
 *
 * Spare Parts, the technician picker and the read-only reliability, alerts
 * and recommendations screens are in `maintenance-extras.ts`. Spare parts are
 * warehouse items (`material_class = spare_part`); they used to be written as
 * iag-production BOMs, the table production recipes share.
 */
import type { ServiceKey } from "@/lib/iag/config";
import { gatewayFetch, unwrapList, unwrapOne } from "@/lib/iag/gateway";
import { resourceAdapter } from "@/lib/iag/records/resource";
import {
  assets,
  attrs,
  attrsOrOmit,
  downtimeEvents,
  jobCards,
  pmSchedules,
  pmTemplates,
  snakeCase,
  titleCase,
  workOrders,
} from "@/lib/iag/records/mes-maintenance";
import {
  alerts,
  recommendations,
  reliability,
  spareParts,
  technicians,
} from "@/lib/iag/records/maintenance-extras";
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

export const RECORD_ADAPTERS: Record<string, RecordAdapter> = {
  "documents:attachments": attachments,
  // iag-mes — the maintenance tabs
  "production:work-centers": assets,
  "production:work-orders": workOrders,
  "production:batch-records": jobCards,
  "production:pm-templates": pmTemplates,
  "production:pm-schedules": pmSchedules,
  "production:downtime-logs": downtimeEvents,
  "production:reliability": reliability,
  "production:alerts": alerts,
  "production:recommendations": recommendations,
  // Picker only, no tab: who a work order can be assigned to.
  "production:technicians": technicians,
  // warehouse — spare parts are warehouse items (material_class spare_part)
  "production:spare-parts": spareParts,
  // iag-production — carried over from the Production app, no tab here
  "production:roast-batches": roastBatches,
  "production:packaging-runs": packagingRuns,
  "production:yield-reports": yieldReports,
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
