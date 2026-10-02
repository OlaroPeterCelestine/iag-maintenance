/**
 * The maintenance screens beyond the CMMS core in `mes-maintenance.ts`.
 *
 *   warehouse  GET/POST/PATCH /items (material_class=spare_part),
 *              PATCH /items/:id/status, /spare-compat, /stock/summary → spare-parts
 *   iag-mes    GET /technicians                                   → technicians (picker)
 *              GET /reliability/summary                           → reliability
 *              GET /alerts, POST /:id/ack, POST /:id/resolve      → alerts
 *              GET /ai/recommendations, POST /:id/accept|dismiss  → recommendations
 *
 * Spare parts live in the warehouse item master — the same register the
 * Inventory app keeps its stock in — marked `material_class = spare_part`,
 * which the warehouse already treats as first-class (its low-stock and
 * compatibility routes). A part is linked to the machine types it fits through
 * `wh_spare_compat`. Stock is never typed here: it moves through warehouse
 * receipts and issues, and this screen reads it.
 */
import { GatewayError, gatewayFetch, unwrapList, unwrapOne } from "@/lib/iag/gateway";
import {
  attrs,
  snakeCase,
  titleCase,
} from "@/lib/iag/records/mes-maintenance";
import {
  isoDate,
  money,
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

function numberOrUndefined(value: unknown): number | undefined {
  const raw = str(value).trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function round(value: unknown, places = 1): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const f = 10 ** places;
  return String(Math.round(n * f) / f);
}

/* ─────────────────────────── spare parts ─────────────────────────── */

/** wh_items.status CHECK (026). Moved only through PATCH /items/:id/status. */
const ITEM_STATUSES = ["draft", "active", "restricted", "obsolete", "blocked"];

function splitTypes(value: unknown): string[] {
  return Array.from(
    new Set(
      str(value)
        .split(/[,;\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  );
}

function sparePartToRecord(
  row: Row,
  stock?: Row,
  types?: string[],
): Omit<AppRecord, "id"> & { id?: string } {
  const extra = attrs(row);
  return {
    id: str(pick(row, "id")),
    name: str(pick(row, "name")),
    code: str(pick(row, "sku")),
    unit: str(pick(row, "uom")),
    partNumber: str(extra.partNumber),
    manufacturer: str(extra.manufacturer),
    fitsMachineTypes: (types || []).join(", "),
    fitsMachines: str(extra.fitsMachines),
    reorderLevel: str(pick(row, "min_qty")),
    maxQty: str(pick(row, "max_qty")),
    onHand: stock ? money(pick(stock, "qty")) : "",
    available: stock ? money(pick(stock, "available")) : "",
    storeLocation: str(extra.storeLocation),
    status: titleCase(str(pick(row, "status"))) || "Active",
    notes: str(extra.notes),
    createdAt: str(pick(row, "created_at")),
    updatedAt: str(pick(row, "updated_at")),
  };
}

/** The part's own descriptive fields, kept in the item's attrs bag. */
const SPARE_ATTR_FIELDS = [
  "partNumber",
  "manufacturer",
  "fitsMachines",
  "storeLocation",
  "notes",
] as const;

async function listCompat(itemId?: string): Promise<Row[]> {
  const payload = await gatewayFetch({
    service: "warehouse",
    path: "/api/v1/spare-compat",
    query: itemId ? { item_id: itemId } : undefined,
  });
  return unwrapList<Row>(payload);
}

/**
 * Make the item's compatible machine types exactly `wanted`: add what is
 * missing, delete what is no longer listed.
 */
async function syncCompat(itemId: string, wanted: string[]): Promise<string[]> {
  const current = await listCompat(itemId);
  const have = new Map(current.map((row) => [str(pick(row, "asset_type")).toLowerCase(), row]));
  const want = new Set(wanted.map((t) => t.toLowerCase()));
  for (const [type, row] of have) {
    if (!want.has(type)) {
      await gatewayFetch({
        service: "warehouse",
        path: `/api/v1/spare-compat/${encodeURIComponent(str(pick(row, "id")))}`,
        method: "DELETE",
      });
    }
  }
  for (const type of wanted) {
    if (!have.has(type.toLowerCase())) {
      await gatewayFetch({
        service: "warehouse",
        path: "/api/v1/spare-compat",
        method: "POST",
        body: { item_id: itemId, asset_type: type },
      });
    }
  }
  return wanted;
}

async function setItemStatus(itemId: string, status: string | undefined, current: string) {
  const wanted = snakeCase(status);
  if (!wanted || wanted === current) return;
  if (!ITEM_STATUSES.includes(wanted)) {
    throw new Error(`Status must be one of: ${ITEM_STATUSES.map(titleCase).join(", ")}.`);
  }
  await gatewayFetch({
    service: "warehouse",
    path: `/api/v1/items/${encodeURIComponent(itemId)}/status`,
    method: "PATCH",
    body: { status: wanted, reason: "Set from the Maintenance app's Spare Parts tab" },
  });
}

async function getItem(itemId: string): Promise<Row | null> {
  return unwrapOne<Row>(
    await gatewayFetch({ service: "warehouse", path: `/api/v1/items/${encodeURIComponent(itemId)}` }),
  );
}

async function stockFor(sku: string): Promise<Row | undefined> {
  try {
    const rows = unwrapList<Row>(
      await gatewayFetch({ service: "warehouse", path: "/api/v1/stock/summary" }),
    );
    return rows.find((row) => str(pick(row, "sku")) === sku);
  } catch {
    // Stock is a second read; the part saved either way.
    return undefined;
  }
}

async function readBack(itemId: string, types?: string[]): Promise<AppRecord | null> {
  const row = await getItem(itemId);
  if (!row) return null;
  const compat = types ?? (await listCompat(itemId)).map((r) => str(pick(r, "asset_type")));
  return withMeta(sparePartToRecord(row, await stockFor(str(pick(row, "sku"))), compat), itemId);
}

export const spareParts: RecordAdapter = {
  service: "warehouse",
  resource: "/api/v1/items",

  async list() {
    const [items, stock, compat] = await Promise.all([
      gatewayFetch({
        service: "warehouse",
        path: "/api/v1/items",
        query: { material_class: "spare_part" },
      }).then((p) => unwrapList<Row>(p)),
      // Both secondary reads are best-effort: the catalogue is still a
      // correct answer without its stock or its machine types.
      gatewayFetch({ service: "warehouse", path: "/api/v1/stock/summary" })
        .then((p) => unwrapList<Row>(p))
        .catch(() => [] as Row[]),
      listCompat().catch(() => [] as Row[]),
    ]);
    const bySku = new Map(stock.map((row) => [str(pick(row, "sku")), row]));
    const typesByItem = new Map<string, string[]>();
    for (const row of compat) {
      const id = str(pick(row, "item_id"));
      typesByItem.set(id, [...(typesByItem.get(id) || []), str(pick(row, "asset_type"))]);
    }
    return items
      // The list filter is exact, but say it here too: this screen must never
      // show — or let anyone edit — a raw material or a finished good.
      .filter((row) => str(pick(row, "material_class")) === "spare_part")
      .map((row) =>
        withMeta(
          sparePartToRecord(
            row,
            bySku.get(str(pick(row, "sku"))),
            typesByItem.get(str(pick(row, "id"))),
          ),
          str(pick(row, "id")),
        ),
      );
  },

  async create(_ctx, record) {
    const sku = str(record.code).trim();
    const name = str(record.name).trim();
    if (!sku || !name) throw new Error("A spare part needs a part code and a name.");
    const created = unwrapOne<Row>(
      await gatewayFetch({
        service: "warehouse",
        path: "/api/v1/items",
        method: "POST",
        body: omitEmpty({
          sku,
          name,
          material_class: "spare_part",
          tracking_mode: "bulk",
          uom: str(record.unit).trim() || "ea",
          min_qty: numberOrUndefined(record.reorderLevel) ?? 0,
          max_qty: numberOrUndefined(record.maxQty),
          attrs: omitEmpty(
            Object.fromEntries(SPARE_ATTR_FIELDS.map((key) => [key, record[key]])),
          ),
        }),
      }),
    );
    const id = str(created && pick(created, "id"));
    if (!id) return null;
    const types = splitTypes(record.fitsMachineTypes);
    if (types.length) await syncCompat(id, types);
    await setItemStatus(id, record.status, str(created && pick(created, "status")) || "active");
    return readBack(id, types);
  },

  /**
   * PATCH /items/:id replaces `attrs` whole and the form sends only what
   * changed, so the stored bag is read first and the change laid over it.
   */
  async update(_ctx, id, record) {
    const current = await getItem(id);
    if (!current) throw new Error("That spare part no longer exists in the warehouse.");
    if (str(pick(current, "material_class")) !== "spare_part") {
      throw new Error("That item is not a spare part; edit it in the Inventory app.");
    }
    const touchesAttrs = SPARE_ATTR_FIELDS.some((key) => record[key] !== undefined);
    const mergedAttrs = touchesAttrs
      ? {
          ...attrs(current),
          ...Object.fromEntries(
            SPARE_ATTR_FIELDS.filter((key) => record[key] !== undefined).map((key) => [
              key,
              record[key],
            ]),
          ),
        }
      : undefined;
    const body = omitEmpty({
      sku: record.code !== undefined ? str(record.code).trim() : undefined,
      name: record.name,
      uom: record.unit,
      min_qty: numberOrUndefined(record.reorderLevel),
      max_qty: numberOrUndefined(record.maxQty),
      attrs: mergedAttrs,
    });
    if (Object.keys(body).length) {
      await gatewayFetch({
        service: "warehouse",
        path: `/api/v1/items/${encodeURIComponent(id)}`,
        method: "PATCH",
        body,
      });
    }
    let types: string[] | undefined;
    if (record.fitsMachineTypes !== undefined) {
      types = await syncCompat(id, splitTypes(record.fitsMachineTypes));
    }
    await setItemStatus(id, record.status, str(pick(current, "status")));
    return readBack(id, types);
  },
};

/* ─────────────────────────── technicians ─────────────────────────── */

/**
 * Who a work order can go to — the picker behind assignee, technician,
 * reported-by and responsible-technician. Read-only.
 *
 * GET /technicians arrives with iag-mes#5. Until that deploys the route 404s,
 * and an empty list is the right answer: every picker that reads this one
 * still takes a typed name.
 */
export const technicians: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/technicians",
  readOnly: true,
  async list() {
    let rows: Row[];
    try {
      rows = unwrapList<Row>(await gatewayFetch({ service: "mes", path: "/api/v1/technicians" }));
    } catch (err) {
      if (err instanceof GatewayError && err.status === 404) return [];
      throw err;
    }
    return rows.map((row) =>
      withMeta(
        {
          id: str(pick(row, "id")),
          name: str(pick(row, "name")),
          role: titleCase(str(pick(row, "role"))),
          plant: str(pick(row, "plant_code")),
          status: row.active === false ? "Inactive" : "Active",
          createdAt: str(pick(row, "created_at")),
          updatedAt: str(pick(row, "created_at")),
        },
        str(pick(row, "id")),
      ),
    );
  },
};

/* ─────────────────────────── reliability ─────────────────────────── */

/** Window asked of the reliability summary, in days. MES defaults to 90. */
const RELIABILITY_DAYS = 90;

/**
 * MTBF, MTTR and availability per machine, from MES's own downtime arithmetic.
 * Read-only: correct the downtime, not the figure.
 */
export const reliability: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/reliability/summary",
  readOnly: true,
  async list() {
    const payload = (await gatewayFetch({
      service: "mes",
      path: "/api/v1/reliability/summary",
      query: { days: RELIABILITY_DAYS },
    })) as Row | null;
    const since = str(payload && pick(payload, "since"));
    const assets = Array.isArray(payload?.assets) ? (payload!.assets as Row[]) : [];
    return assets.map((row) =>
      withMeta(
        {
          id: str(pick(row, "asset_tag")),
          workCenter: str(pick(row, "asset_tag")),
          mtbfHours: round(pick(row, "mtbf_hours")),
          mttrHours: round(pick(row, "mttr_hours"), 2),
          availability: round(pick(row, "availability_pct")),
          failures: str(pick(row, "failure_count")),
          status: titleCase(str(pick(row, "status"))),
          since: isoDate(since),
          // Arithmetic over a window, not a stored row. The window start moves
          // by the nanosecond on every call; its date is stable within a day,
          // so the list revision does not change on every read.
          createdAt: isoDate(since),
          updatedAt: isoDate(since),
        },
        str(pick(row, "asset_tag")),
      ),
    );
  },
};

/* ───────────────────────────── alerts ────────────────────────────── */

function alertToRecord(row: Row): Omit<AppRecord, "id"> & { id?: string } {
  return {
    id: str(pick(row, "id")),
    date: isoDate(pick(row, "occurred_at")),
    severity: { crit: "Critical", warn: "Warning", info: "Info" }[str(pick(row, "severity"))] ||
      titleCase(str(pick(row, "severity"))),
    workCenter: str(pick(row, "source")),
    message: str(pick(row, "message")),
    status: titleCase(str(pick(row, "status"))),
    acknowledgedOn: isoDate(pick(row, "acknowledged_at")),
    resolvedOn: isoDate(pick(row, "resolved_at")),
    createdAt: str(pick(row, "occurred_at")),
    updatedAt: str(pick(row, "resolved_at", "acknowledged_at", "occurred_at")),
  };
}

function alertVerb(verb: "ack" | "resolve", label: string, doneLabel: string, whenStatus: string[]): RecordAction {
  return {
    id: verb,
    label,
    doneLabel,
    permission: "mes.ack_alert",
    whenStatus,
    async run(_ctx, id) {
      const row = unwrapOne<Row>(
        await gatewayFetch({
          service: "mes",
          path: `/api/v1/alerts/${encodeURIComponent(id)}/${verb}`,
          method: "POST",
        }),
      );
      return row ? withMeta(alertToRecord(row), id) : null;
    },
  };
}

/**
 * MES alerts — telemetry rules, and the preventive job's "PM overdue". MES
 * returns the newest 50.
 */
export const alerts: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/alerts",
  readOnly: true,
  actions: [
    alertVerb("ack", "Acknowledge", "Acknowledged", ["New"]),
    alertVerb("resolve", "Resolve", "Resolved", ["New", "Ack", "Investigating"]),
  ],
  async list() {
    const rows = unwrapList<Row>(await gatewayFetch({ service: "mes", path: "/api/v1/alerts" }));
    return rows.map((row) => withMeta(alertToRecord(row), str(pick(row, "id"))));
  },
};

/* ───────────────────────── recommendations ───────────────────────── */

function recommendationToRecord(row: Row): Omit<AppRecord, "id"> & { id?: string } {
  const confidence = Number(pick(row, "confidence"));
  return {
    id: str(pick(row, "id")),
    date: isoDate(pick(row, "created_at")),
    title: str(pick(row, "title")),
    workCenter: str(pick(row, "asset_tag")),
    kind: titleCase(str(pick(row, "kind"))),
    confidence: Number.isFinite(confidence)
      ? String(Math.round((confidence <= 1 ? confidence * 100 : confidence) * 10) / 10)
      : "",
    body: str(pick(row, "body")),
    status: titleCase(str(pick(row, "status"))),
    createdAt: str(pick(row, "created_at")),
    updatedAt: str(pick(row, "created_at")),
  };
}

async function listRecommendations(): Promise<Row[]> {
  return unwrapList<Row>(await gatewayFetch({ service: "mes", path: "/api/v1/ai/recommendations" }));
}

function recommendationVerb(verb: "accept" | "dismiss", label: string, doneLabel: string): RecordAction {
  return {
    id: verb,
    label,
    doneLabel,
    permission: "mes.change_ai",
    whenStatus: ["Open"],
    async run(_ctx, id) {
      await gatewayFetch({
        service: "mes",
        path: `/api/v1/ai/recommendations/${encodeURIComponent(id)}/${verb}`,
        method: "POST",
      });
      // The verb answers `{status}` only; read the row back so the screen
      // shows what MES now holds.
      const row = (await listRecommendations()).find((r) => str(pick(r, "id")) === id);
      return row ? withMeta(recommendationToRecord(row), id) : null;
    },
  };
}

/**
 * Maintenance suggestions from MES's daily AI job. Accepting one records the
 * decision; it does not raise a work order — do that under Work Orders.
 */
export const recommendations: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/ai/recommendations",
  readOnly: true,
  actions: [
    recommendationVerb("accept", "Accept", "Accepted"),
    recommendationVerb("dismiss", "Dismiss", "Dismissed"),
  ],
  async list() {
    return (await listRecommendations()).map((row) =>
      withMeta(recommendationToRecord(row), str(pick(row, "id"))),
    );
  },
};
