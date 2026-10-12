/**
 * What maintenance costs: parts booked out against work orders, the labour
 * rates jobs are costed at, and the cost of each job and each machine.
 *
 *   warehouse  POST /issues/for-department        → parts-used (create)
 *              GET  /consumption/work-orders       → parts-used, job/machine costs
 *              GET  /items, /items/:id/balances    → which bin to take a part from
 *   iag-mes    GET  /work-orders, /assets, /technicians
 *              GET/PATCH /plants (attrs.labour_rates) → labour-rates
 *
 * A job's cost is labour + parts + contractor:
 *   labour      hours on the job card × the factory's rate for the technician's
 *               role (or its "*" rate for anyone else)
 *   parts       what the warehouse booked out against the work order, at the
 *               cost it moved at (estimated from the average where it moved
 *               unpriced)
 *   contractor  typed on the job card
 *
 * The warehouse is the record of parts: a part is "used" when stock moved, so
 * there is no second copy on the work order to drift from it.
 */
import { GatewayError, gatewayFetch, unwrapList, unwrapOne } from "@/lib/iag/gateway";
import { jobCardOf } from "@/lib/iag/records/mes-maintenance";
import {
  InputError,
  isoDate,
  omitEmpty,
  pick,
  str,
  type AppRecord,
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

function num(value: unknown): number {
  const n = Number(str(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** A figure for a list cell: whole units, grouped. Blank when unknown. */
export function amount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  return Math.round(value).toLocaleString("en-US");
}

function hoursText(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/* ───────────────────────────── shared reads ───────────────────────────── */

/** MES lists at most 200; costs cover the newest 200 work orders. */
const MES_LIST_LIMIT = 200;
const ANYONE = "*";
const ANYONE_LABEL = "Everyone else";

async function listWorkOrders(): Promise<Row[]> {
  return unwrapList<Row>(
    await gatewayFetch({ service: "mes", path: "/api/v1/work-orders", query: { limit: MES_LIST_LIMIT } }),
  );
}

async function listAssets(): Promise<Row[]> {
  return unwrapList<Row>(await gatewayFetch({ service: "mes", path: "/api/v1/assets" }));
}

async function listPlants(): Promise<Row[]> {
  return unwrapList<Row>(await gatewayFetch({ service: "mes", path: "/api/v1/plants" }));
}

async function listTechnicians(): Promise<Row[]> {
  try {
    return unwrapList<Row>(await gatewayFetch({ service: "mes", path: "/api/v1/technicians" }));
  } catch (err) {
    if (err instanceof GatewayError && err.status === 404) return [];
    throw err;
  }
}

/** Thrown when the warehouse predates GET /consumption/work-orders. */
export const CONSUMPTION_MISSING =
  "The warehouse cannot report parts by work order yet (iag-warehouse#1 is not deployed).";

/**
 * What posted issues consumed, per work order. `null` when the warehouse has
 * no such route yet, so a cost report can say "parts unknown" instead of
 * showing a parts cost of zero.
 */
async function listConsumption(refs?: string[]): Promise<Row[] | null> {
  try {
    return unwrapList<Row>(
      await gatewayFetch({
        service: "warehouse",
        path: "/api/v1/consumption/work-orders",
        query: refs?.length ? { work_order_ref: refs.join(","), limit: 5000 } : { limit: 5000 },
      }),
    );
  } catch (err) {
    if (err instanceof GatewayError && err.status === 404) return null;
    throw err;
  }
}

/* ───────────────────────────── parts used ───────────────────────────── */

function consumptionToRecord(
  row: Row,
  machineOf: Map<string, string>,
  plantOf: Map<string, string>,
): Omit<AppRecord, "id"> & { id?: string } {
  const issue = str(pick(row, "issue_id"));
  const sku = str(pick(row, "sku"));
  const bin = str(pick(row, "bin_code"));
  const wo = str(pick(row, "work_order_ref"));
  const machine = machineOf.get(wo) || "";
  const estimated = pick(row, "estimated") === true;
  return {
    id: `${issue}/${sku}/${bin}`,
    reference: wo,
    workOrder: wo,
    workCenter: machine,
    plantCode: plantOf.get(machine) || "",
    date: isoDate(pick(row, "posted_at")),
    part: sku,
    partName: str(pick(row, "name")),
    qty: String(num(pick(row, "qty"))),
    unit: str(pick(row, "uom")),
    store: bin,
    unitCost: amount(num(pick(row, "unit_cost"))),
    totalCost: amount(num(pick(row, "total_cost"))),
    currency: str(pick(row, "currency")),
    // Shown in the status column: whether the figure is what the stock moved
    // at, or the average cost standing in for an unpriced movement.
    status: estimated ? "Estimated" : "Booked",
    createdAt: str(pick(row, "posted_at")),
    updatedAt: str(pick(row, "posted_at")),
  };
}

/**
 * The bin to take a part from: the one with the most free stock that covers
 * the quantity. A technician knows the part, not the warehouse's bin codes,
 * and the facility default bin (receiving) is rarely where spares sit.
 */
async function sparePart(sku: string): Promise<Row> {
  const items = unwrapList<Row>(
    await gatewayFetch({ service: "warehouse", path: "/api/v1/items", query: { material_class: "spare_part" } }),
  );
  const item = items.find((row) => str(pick(row, "sku")).toLowerCase() === sku.toLowerCase());
  if (!item) throw new InputError(`No spare part "${sku}" in the warehouse.`);
  return item;
}

async function binFor(item: Row, qty: number): Promise<string> {
  const sku = str(pick(item, "sku"));
  const uom = str(pick(item, "uom")) || "ea";
  const balances = unwrapList<Row>(
    await gatewayFetch({
      service: "warehouse",
      path: `/api/v1/items/${encodeURIComponent(str(pick(item, "id")))}/balances`,
    }),
  ).filter((row) => !str(pick(row, "status")) || str(pick(row, "status")) === "available");
  const free = (row: Row) =>
    pick(row, "available") !== undefined
      ? num(pick(row, "available"))
      : num(pick(row, "qty")) - num(pick(row, "reserved"));
  const enough = balances
    .filter((row) => free(row) >= qty)
    .sort((a, b) => free(b) - free(a));
  if (enough.length) return str(pick(enough[0], "bin_code"));
  const where = balances
    .filter((row) => free(row) > 0)
    .map((row) => `${str(pick(row, "bin_code"))} (${free(row)})`);
  throw new InputError(
    where.length
      ? `No single store holds ${qty} ${uom} of ${sku}. Free stock: ${where.join(", ")}. Book a smaller quantity from one store, or move stock first.`
      : `${sku} is out of stock. Receive it in the Inventory app before booking it to a job.`,
  );
}

export const partsUsed: RecordAdapter = {
  service: "warehouse",
  resource: "/api/v1/consumption/work-orders",

  async list() {
    const [rows, workOrders, assets] = await Promise.all([
      listConsumption(),
      listWorkOrders().catch(() => [] as Row[]),
      listAssets().catch(() => [] as Row[]),
    ]);
    if (rows === null) throw new InputError(CONSUMPTION_MISSING, 503);
    const machineOf = new Map(workOrders.map((wo) => [str(pick(wo, "num")), str(pick(wo, "asset_tag"))]));
    const plantOf = new Map(assets.map((a) => [str(pick(a, "tag")), str(pick(a, "plant_code"))]));
    return rows.map((row) => {
      const mapped = consumptionToRecord(row, machineOf, plantOf);
      return withMeta(mapped, str(mapped.id));
    });
  },

  /**
   * Book parts out of stock against a work order. The warehouse posts the
   * issue in the same call, so stock drops now; there is no draft to forget.
   * Parts cannot be edited or deleted here — a mistake is put right by
   * returning the part to stock in the Inventory app, which the ledger shows.
   */
  async create(_ctx, record) {
    const wo = str(record.workOrder).trim();
    const sku = str(record.part).trim();
    const qty = num(record.qty);
    if (!wo) throw new InputError("Pick the work order the parts were used on.");
    if (!sku) throw new InputError("Pick the spare part.");
    if (!(qty > 0)) throw new InputError("Quantity must be more than zero.");

    const order = unwrapOne<Row>(
      await gatewayFetch({ service: "mes", path: `/api/v1/work-orders/${encodeURIComponent(wo)}` }),
    );
    if (!order) throw new InputError(`Work order ${wo} was not found in MES.`, 404);
    if (str(pick(order, "status")) === "cancelled") {
      throw new InputError(`Work order ${wo} is cancelled; parts cannot be booked to it.`);
    }
    const machine = str(pick(order, "asset_tag"));
    let plant = "";
    if (machine) {
      const asset = unwrapOne<Row>(
        await gatewayFetch({ service: "mes", path: `/api/v1/assets/${encodeURIComponent(machine)}` }).catch(
          () => null,
        ),
      );
      plant = str(asset && pick(asset, "plant_code"));
    }

    // Booked in the part's own unit: the warehouse converts any other unit,
    // and refuses one the item does not declare.
    const item = await sparePart(sku);
    const uom = str(pick(item, "uom")) || "ea";
    const bin = str(record.store).trim() || (await binFor(item, qty));

    const issue = unwrapOne<Row>(
      await gatewayFetch({
        service: "warehouse",
        path: "/api/v1/issues/for-department",
        method: "POST",
        body: omitEmpty({
          department: "maintenance",
          work_order_ref: wo,
          // Who paid for it: the machine, inside its factory. The warehouse
          // needs a reason for every issue and this is the most specific one.
          cost_center: ["MAINT", plant, machine].filter(Boolean).join("/"),
          requested_by: str(record.technician).trim() || undefined,
          notes: str(record.notes).trim() || undefined,
          lines: [{ item_sku: str(pick(item, "sku")), qty, uom, bin_code: bin }],
        }),
      }),
    );
    const issueId = str(issue && pick(issue, "id"));

    // Read back through the ledger so the row carries the cost it moved at.
    const consumed = (await listConsumption([wo]).catch(() => null)) || [];
    const machineOf = new Map([[wo, machine]]);
    const plantOf = new Map([[machine, plant]]);
    const mine = consumed.find((row) => str(pick(row, "issue_id")) === issueId);
    if (mine) {
      const mapped = consumptionToRecord(mine, machineOf, plantOf);
      return withMeta(mapped, str(mapped.id));
    }
    return withMeta(
      {
        id: `${issueId}/${sku}/${bin}`,
        reference: wo,
        workOrder: wo,
        workCenter: machine,
        plantCode: plant,
        date: isoDate(new Date().toISOString()),
        part: sku,
        qty: String(qty),
        unit: uom,
        store: bin,
        status: "Booked",
      },
      `${issueId}/${sku}/${bin}`,
    );
  },
};

/* ───────────────────────────── labour rates ───────────────────────────── */

function rateRows(plant: Row): AppRecord[] {
  const code = str(pick(plant, "code"));
  const extra = attrs(plant);
  const rates = extra.labour_rates;
  const currency = str(extra.labour_currency) || "UGX";
  if (!rates || typeof rates !== "object") return [];
  return Object.entries(rates as Row).map(([role, rate]) =>
    withMeta(
      {
        id: `${code}/${role}`,
        plantCode: code,
        role: role === ANYONE ? ANYONE_LABEL : role,
        hourlyRate: String(num(rate)),
        currency,
      },
      `${code}/${role}`,
    ),
  );
}

function roleKey(value: unknown): string {
  const role = str(value).trim();
  return !role || role.toLowerCase() === ANYONE_LABEL.toLowerCase() ? ANYONE : role;
}

async function writeRate(plant: string, role: string, rate: number | null, currency?: string): Promise<Row> {
  const row = unwrapOne<Row>(
    await gatewayFetch({
      service: "mes",
      path: `/api/v1/plants/${encodeURIComponent(plant)}`,
      method: "PATCH",
      body: omitEmpty({ labour_rates: { [role]: rate }, labour_currency: currency }),
    }),
  );
  if (!row) throw new InputError(`Factory ${plant} was not found in MES.`, 404);
  // An MES without iag-mes#13 ignores labour_rates and answers 200; check the
  // stored value rather than report a rate nobody will cost with.
  const stored = (attrs(row).labour_rates || {}) as Row;
  const landed = rate === null ? !(role in stored) : num(stored[role]) === rate;
  if (!landed) {
    throw new InputError(
      "MES did not store the rate: this MES cannot hold labour rates yet (iag-mes#13).",
      409,
    );
  }
  return row;
}

export const labourRates: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/plants (attrs.labour_rates)",

  async list() {
    return (await listPlants()).flatMap(rateRows);
  },

  async create(_ctx, record) {
    const plant = str(record.plantCode).trim();
    const role = roleKey(record.role);
    const rate = num(record.hourlyRate);
    if (!plant) throw new InputError("Pick the factory this rate applies at.");
    if (str(record.hourlyRate).trim() === "" || rate < 0) {
      throw new InputError("Give an hourly rate of zero or more.");
    }
    const currency = str(record.currency).trim().toUpperCase() || undefined;
    const row = await writeRate(plant, role, rate, currency);
    return rateRows(row).find((r) => r.id === `${plant}/${role}`) || null;
  },

  async update(_ctx, id, record) {
    const [plant, ...rest] = id.split("/");
    const role = rest.join("/");
    if (record.plantCode !== undefined && str(record.plantCode).trim() !== plant) {
      throw new InputError("A rate's factory is fixed — add a rate at the other factory instead.");
    }
    if (record.role !== undefined && roleKey(record.role) !== role) {
      throw new InputError("A rate's role is fixed — add a rate for the other role instead.");
    }
    const rate = record.hourlyRate !== undefined ? num(record.hourlyRate) : undefined;
    if (rate !== undefined && rate < 0) throw new InputError("Give an hourly rate of zero or more.");
    const currency = record.currency !== undefined ? str(record.currency).trim().toUpperCase() : undefined;
    const current = rateRows((await listPlants()).find((p) => str(pick(p, "code")) === plant) || {}).find(
      (r) => r.id === id,
    );
    if (!current) throw new InputError(`No labour rate ${id}.`, 404);
    const row = await writeRate(plant, role, rate ?? num(current.hourlyRate), currency || undefined);
    return rateRows(row).find((r) => r.id === id) || null;
  },

  async remove(_ctx, id) {
    const [plant, ...rest] = id.split("/");
    await writeRate(plant, rest.join("/"), null);
  },
};

/* ─────────────────────────────── job costs ─────────────────────────────── */

type JobCost = {
  num: string;
  title: string;
  machine: string;
  plant: string;
  status: string;
  date: string;
  month: string;
  technician: string;
  hours: number;
  labour?: number;
  parts?: number;
  contractor: number;
  currency: string;
  notes: string[];
};

/**
 * Cost every work order MES lists (the newest 200). Cancelled orders cost
 * nothing and are left out.
 */
export async function costJobs(): Promise<{ jobs: JobCost[]; machineNames: Map<string, string>; sections: Map<string, string> }> {
  const [orders, assets, plants, techs] = await Promise.all([
    listWorkOrders(),
    listAssets().catch(() => [] as Row[]),
    listPlants().catch(() => [] as Row[]),
    listTechnicians().catch(() => [] as Row[]),
  ]);
  const live = orders.filter((wo) => str(pick(wo, "status")) !== "cancelled");
  const consumption = await listConsumption(live.map((wo) => str(pick(wo, "num"))));

  const plantOf = new Map(assets.map((a) => [str(pick(a, "tag")), str(pick(a, "plant_code"))]));
  const machineNames = new Map(assets.map((a) => [str(pick(a, "tag")), str(pick(a, "name"))]));
  const sections = new Map(assets.map((a) => [str(pick(a, "tag")), str(pick(a, "section_code"))]));
  const roleOf = new Map(techs.map((t) => [str(pick(t, "name")).trim().toLowerCase(), str(pick(t, "role"))]));
  const ratesAt = new Map(
    plants.map((p) => {
      const extra = attrs(p);
      return [
        str(pick(p, "code")),
        {
          rates: (extra.labour_rates && typeof extra.labour_rates === "object" ? extra.labour_rates : {}) as Row,
          currency: str(extra.labour_currency) || "UGX",
        },
      ];
    }),
  );
  const partsOf = new Map<string, { total: number; estimated: boolean; currency: string }>();
  for (const row of consumption || []) {
    const wo = str(pick(row, "work_order_ref"));
    const prev = partsOf.get(wo) || { total: 0, estimated: false, currency: "" };
    partsOf.set(wo, {
      total: prev.total + num(pick(row, "total_cost")),
      estimated: prev.estimated || pick(row, "estimated") === true,
      currency: prev.currency || str(pick(row, "currency")),
    });
  }

  const jobs = live.map((wo): JobCost => {
    const num_ = str(pick(wo, "num"));
    const machine = str(pick(wo, "asset_tag"));
    const plant = plantOf.get(machine) || "";
    const card = (jobCardOf(wo) || {}) as Row;
    const hours = num(card.hours);
    const technician = str(card.technician) || str(pick(wo, "assignee"));
    const role = roleOf.get(technician.trim().toLowerCase()) || "";
    const at = ratesAt.get(plant);
    const notes: string[] = [];

    let labour: number | undefined;
    if (hours > 0) {
      const rate = at && role && role in at.rates ? num(at.rates[role]) : at && ANYONE in at.rates ? num(at.rates[ANYONE]) : undefined;
      if (rate === undefined) {
        notes.push(`No labour rate for ${role || technician || "this technician"} at ${plant || "this factory"}`);
      } else {
        labour = hours * rate;
      }
    } else {
      labour = 0;
    }

    let parts: number | undefined;
    if (consumption === null) {
      notes.push("Parts cost unknown — warehouse not updated");
    } else {
      const p = partsOf.get(num_);
      parts = p?.total || 0;
      if (p?.estimated) notes.push("Parts cost estimated from average cost");
      if (p?.currency && at && p.currency !== at.currency) {
        notes.push(`Parts in ${p.currency}, labour in ${at.currency}`);
      }
    }

    const contractor = num(card.contractorCost);
    const date = isoDate(pick(wo, "completed_at")) || isoDate(pick(wo, "created_at"));
    return {
      num: num_,
      title: str(pick(wo, "title")),
      machine,
      plant,
      status: str(pick(wo, "status")),
      date,
      month: date.slice(0, 7),
      technician,
      hours,
      labour,
      parts,
      contractor,
      currency: at?.currency || "UGX",
      notes,
    };
  });
  return { jobs, machineNames, sections };
}

function total(job: Pick<JobCost, "labour" | "parts" | "contractor">): number | undefined {
  if (job.labour === undefined || job.parts === undefined) return undefined;
  return job.labour + job.parts + job.contractor;
}

function titleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export const jobCosts: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/work-orders + warehouse /consumption/work-orders",
  readOnly: true,
  async list() {
    const { jobs } = await costJobs();
    return jobs.map((job) =>
      withMeta(
        {
          id: job.num,
          reference: job.num,
          workOrder: job.num,
          title: job.title,
          workCenter: job.machine,
          plantCode: job.plant,
          date: job.date,
          month: job.month,
          technician: job.technician,
          hours: hoursText(job.hours),
          labourCost: amount(job.labour),
          partsCost: amount(job.parts),
          contractorCost: amount(job.contractor),
          totalCost: amount(total(job)),
          currency: job.currency,
          status: titleCase(job.status) || "Open",
          notes: job.notes.join("; "),
        },
        job.num,
      ),
    );
  },
};

/** Cost per machine per month — where the money goes, and when. */
export const machineCosts: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/work-orders + warehouse /consumption/work-orders",
  readOnly: true,
  async list() {
    const { jobs, machineNames, sections } = await costJobs();
    const groups = new Map<string, JobCost[]>();
    for (const job of jobs) {
      if (!job.machine) continue;
      const key = `${job.machine}/${job.month}`;
      groups.set(key, [...(groups.get(key) || []), job]);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => b.split("/")[1].localeCompare(a.split("/")[1]) || a.localeCompare(b))
      .map(([key, list]) => {
        const first = list[0];
        const sum = (pickNum: (j: JobCost) => number | undefined) =>
          list.some((j) => pickNum(j) === undefined)
            ? undefined
            : list.reduce((acc, j) => acc + (pickNum(j) || 0), 0);
        const labour = sum((j) => j.labour);
        const parts = sum((j) => j.parts);
        const contractor = list.reduce((acc, j) => acc + j.contractor, 0);
        const notes = Array.from(new Set(list.flatMap((j) => j.notes)));
        return withMeta(
          {
            id: key,
            workCenter: first.machine,
            machineName: machineNames.get(first.machine) || "",
            plantCode: first.plant,
            section: sections.get(first.machine) || "",
            month: first.month,
            jobs: String(list.length),
            hours: hoursText(list.reduce((acc, j) => acc + j.hours, 0)),
            labourCost: amount(labour),
            partsCost: amount(parts),
            contractorCost: amount(contractor),
            totalCost: amount(labour === undefined || parts === undefined ? undefined : labour + parts + contractor),
            currency: first.currency,
            status: notes.length ? "Incomplete" : "Complete",
            notes: notes.join("; "),
          },
          key,
        );
      });
  },
};
