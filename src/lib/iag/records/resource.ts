/**
 * Factory for the common adapter shape: one REST collection on one service,
 * mapped field-by-field onto the flat record the UI renders.
 *
 * Anything unusual (multi-call joins, non-REST verbs) writes its own adapter
 * object instead — this is a convenience, not a requirement.
 */
import { gatewayFetch, unwrapList, unwrapOne } from "@/lib/iag/gateway";
import type { ServiceKey } from "@/lib/iag/config";
import {
  pick,
  str,
  type AdapterContext,
  type AppRecord,
  type RecordAction,
  type RecordAdapter,
} from "@/lib/iag/records/types";

export type ResourceSpec = {
  service: ServiceKey;
  /** Collection path below the service prefix, e.g. "/v1/customers". */
  path: string;
  /** Map an upstream row onto the flat UI record. */
  toRecord: (row: Record<string, unknown>) => Omit<AppRecord, "id"> & { id?: string };
  /** Map a UI record back to an upstream payload. Omit for read-only. */
  fromRecord?: (record: AppRecord) => Record<string, unknown>;
  /**
   * Fields added on create only, merged over `fromRecord`'s output.
   *
   * For values that must be set when a record is born and must never be resent
   * afterwards. `tracking_mode` on an inventory item is the case here: the
   * service defaults it, so it is create-only by nature, and sending it on
   * every update would overwrite a deliberate move to lot or serial tracking
   * with whatever the form last rendered. Runs on POST, never on PATCH.
   */
  createDefaults?: (record: AppRecord) => Record<string, unknown>;
  /** Upstream id field when it is not `id`. */
  idField?: string;
  /**
   * Extra query sent on list calls (e.g. page size).
   *
   * A function when the value depends on when the call is made. Schedule
   * blocks are why: the service answers a window and defaults it to
   * `now-1d … now+14d`, so a plan booked three weeks out saved successfully
   * and was simply absent from the list that was supposed to show it.
   */
  listQuery?:
    | Record<string, string | number>
    | (() => Record<string, string | number>);
  /** Path for single-item verbs when it differs from `${path}/${id}`. */
  itemPath?: (id: string) => string;
  /**
   * Collection path for POST, when creating happens somewhere other than where
   * listing happens. Rare, and always a sign of a service that grew a second
   * verb on a sub-path — production orders list at the collection and are
   * created at `/production-orders/schedule`.
   */
  createPath?: string;
  /** Upstream supports PATCH rather than PUT for updates. */
  updateMethod?: "PATCH" | "PUT";
  /** Upstream has no delete endpoint. */
  noDelete?: boolean;
  /** Upstream has no collection POST — the record cannot be created here. */
  noCreate?: boolean;
  /** Upstream has no update verb for this resource. */
  noUpdate?: boolean;
  /**
   * Second pass over a mapped collection, for columns that live on a different
   * endpoint from the resource itself.
   *
   * Stock on hand is the case this exists for: `models.Item` is a catalogue
   * record and the quantity belongs to the balances, so the item list used to
   * render its quantity columns blank. Doing it per row would be a call per
   * item; this runs once for the whole list, so the adapter can join two
   * collections without the UI knowing there were two.
   *
   * Best-effort by contract: a failure here leaves the un-enriched records
   * standing, because the catalogue is still a correct answer to the question
   * the screen asked.
   */
  augment?: (records: AppRecord[], ctx: AdapterContext) => Promise<AppRecord[]>;
  /**
   * A second call after a successful create or update, for what a service
   * exposes as its own route rather than as a field on the resource.
   *
   * Two cases drove this. An item's lifecycle is set through
   * `PATCH /items/:id/status` under its own permission, so the status select on
   * the form had no effect at all; and an item created with an opening quantity
   * has to post an opening receipt, because a catalogue record cannot itself
   * hold stock. Both are follow-ups to a write that has already succeeded, and
   * neither can be expressed as a field in `fromRecord`.
   *
   * Returning a record replaces what the write returned. Returning nothing (or
   * throwing — see runAfterWrite) leaves the saved record standing.
   */
  afterWrite?: (args: {
    ctx: AdapterContext;
    mode: "create" | "update";
    /** The flat record the form submitted. */
    record: AppRecord;
    /** The raw upstream row the write returned — this is where the id is. */
    row: Record<string, unknown>;
    /**
     * The normalised record the write is about to return, or null when the
     * response could not be unwrapped — the write still happened, so the
     * follow-up still runs.
     */
    saved: AppRecord | null;
  }) => Promise<AppRecord | null>;
  /**
   * Let a failed `afterWrite` fail the whole write.
   *
   * Off by default, which is right for a follow-up that is genuinely optional —
   * losing it leaves a saved record that is merely less complete than intended.
   *
   * It is wrong for a follow-up the record's correctness depends on. An item
   * created with an opening quantity posts an opening receipt; if that receipt
   * fails — a mistyped warehouse code, a caller without `warehouse.post_receipt`
   * — the item exists holding no stock while the form reports success. The
   * comment on `postOpeningStock` has always claimed that failure "is raised
   * rather than swallowed"; it was not, because this function caught it. This
   * flag is what makes the claim true.
   *
   * The write itself is not rolled back — it cannot be, the service has already
   * committed it. The error tells the user the follow-up did not happen, which
   * is the part they can still act on.
   */
  afterWriteRequired?: boolean;
  /** Per-record verbs beyond CRUD. Passed through to the adapter unchanged. */
  actions?: RecordAction[];
};

function normalise(
  spec: ResourceSpec,
  row: Record<string, unknown>,
): AppRecord {
  const mapped = spec.toRecord(row);
  const id =
    mapped.id ||
    str(pick(row, spec.idField || "id", "id", "uuid", "code", "reference"));
  const createdAt = mapped.createdAt || str(pick(row, "createdAt", "created_at"));
  const updatedAt =
    mapped.updatedAt ||
    str(pick(row, "updatedAt", "updated_at", "modifiedAt")) ||
    createdAt;

  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapped)) {
    record[key] = typeof value === "string" ? value : str(value);
  }
  return { ...record, id, createdAt, updatedAt } as AppRecord;
}

/**
 * Run `afterWrite`, and — unless the spec asks otherwise — never let it take the
 * write down with it.
 *
 * The record is already saved by the time this runs. An optional follow-up that
 * fails — a status route the caller is not permitted to use — must not turn a
 * successful create into an error the user reads as "nothing was saved", because
 * something was. It is logged and the saved record is returned.
 *
 * `afterWriteRequired` inverts that for follow-ups the record's correctness
 * depends on; see the flag's own note for why silence is the worse failure there.
 */
async function runAfterWrite(
  spec: ResourceSpec,
  ctx: AdapterContext,
  mode: "create" | "update",
  record: AppRecord,
  row: Record<string, unknown>,
  saved: AppRecord | null,
): Promise<AppRecord | null> {
  if (!spec.afterWrite) return null;
  try {
    return await spec.afterWrite({ ctx, mode, record, row, saved });
  } catch (err) {
    console.error("[iag/records] afterWrite failed", spec.path, mode, err);
    if (spec.afterWriteRequired) throw err;
    return null;
  }
}

export function resourceAdapter(spec: ResourceSpec): RecordAdapter {
  const itemPath = spec.itemPath || ((id: string) => `${spec.path}/${encodeURIComponent(id)}`);

  const adapter: RecordAdapter = {
    service: spec.service,
    resource: spec.path,
    readOnly: !spec.fromRecord || Boolean(spec.noCreate && spec.noUpdate),

    async list(ctx: AdapterContext): Promise<AppRecord[]> {
      const base =
        typeof spec.listQuery === "function" ? spec.listQuery() : spec.listQuery;
      const query: Record<string, string | number> = { ...(base || {}) };
      // Forward the UI's filters *and* its paging. These used to be dropped, so
      // every read returned whatever the service's own default was and a screen
      // asking for page two silently got page one again.
      for (const [key, value] of ctx.query.entries()) {
        query[key] = value;
      }
      const payload = await gatewayFetch({
        service: spec.service,
        path: spec.path,
        query,
      });
      const records = unwrapList<Record<string, unknown>>(payload).map((row) =>
        normalise(spec, row),
      );
      if (!spec.augment) return records;
      try {
        return await spec.augment(records, ctx);
      } catch (err) {
        // The list is still correct without the extra columns; losing it
        // entirely because a secondary endpoint blipped would not be.
        console.error("[iag/records] augment failed", spec.path, err);
        return records;
      }
    },
  };

  if (spec.actions?.length) adapter.actions = spec.actions;

  if (spec.fromRecord) {
    if (!spec.noCreate) adapter.create = async (ctx, record) => {
      const payload = await gatewayFetch({
        service: spec.service,
        path: spec.createPath || spec.path,
        method: "POST",
        body: { ...spec.fromRecord!(record), ...(spec.createDefaults?.(record) || {}) },
      });
      const row = unwrapOne<Record<string, unknown>>(payload);
      // `afterWrite` runs even when the response could not be unwrapped. The
      // write happened either way, and not every follow-up needs the created
      // row: an opening receipt is raised against the item's SKU, which came
      // from the form. The ones that do need an id guard for it themselves.
      const created = row ? normalise(spec, row) : null;
      const after = await runAfterWrite(spec, ctx, "create", record, row || {}, created);
      return after ?? created;
    };

    if (!spec.noUpdate) adapter.update = async (ctx, id, record) => {
      const payload = await gatewayFetch({
        service: spec.service,
        path: itemPath(id),
        method: spec.updateMethod || "PATCH",
        body: spec.fromRecord!(record),
      });
      const row = unwrapOne<Record<string, unknown>>(payload);
      const updated = row ? normalise(spec, row) : null;
      const after = await runAfterWrite(spec, ctx, "update", record, row || {}, updated);
      return after ?? updated;
    };

    if (!spec.noDelete) {
      adapter.remove = async (_ctx, id) => {
        await gatewayFetch({
          service: spec.service,
          path: itemPath(id),
          method: "DELETE",
        });
      };
    }
  }

  return adapter;
}