/**
 * What maintenance costs: parts booked out against work orders, labour rates,
 * and the cost of each job and each machine.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_ADAPTERS } from "@/lib/iag/records/registry";
import { stockLevel } from "@/lib/iag/records/maintenance-extras";
import { InputError, type AdapterContext, type AppRecord } from "@/lib/iag/records/types";

vi.mock("@/lib/iag/gateway", async () => {
  const actual = await vi.importActual<typeof import("@/lib/iag/gateway")>("@/lib/iag/gateway");
  return { ...actual, gatewayFetch: vi.fn(async () => ({ items: [] })) };
});
const gateway = await import("@/lib/iag/gateway");
const mockFetch = vi.mocked(gateway.gatewayFetch);

type Call = { service?: string; path?: string; method?: string; body?: Record<string, unknown>; query?: Record<string, unknown> };
const ctx: AdapterContext = { module: "production", entity: "x", query: new URLSearchParams() };
const record = (f: Record<string, string>) => ({ id: "", createdAt: "", updatedAt: "", ...f }) as AppRecord;
const calls = () => mockFetch.mock.calls.map((c) => c[0] as Call);
const writes = () => calls().filter((c) => c.method && c.method !== "GET");

let routes: Record<string, unknown>;
/** Paths that answer 404, as a service without the route would. */
let missing: Set<string>;
let onWrite: (req: Call) => unknown;

beforeEach(() => {
  mockFetch.mockClear();
  missing = new Set();
  onWrite = (req) => ({ id: "iss-1", ...(req.body || {}) });
  routes = {
    "/api/v1/work-orders": {
      items: [
        {
          num: "WO-1", title: "Huller bearing", asset_tag: "H1", status: "completed",
          created_at: "2026-10-03T08:00:00Z", completed_at: "2026-10-04T15:00:00Z",
          attrs: { job_card: { technician: "Okello", hours: "4", contractorCost: "50000" } },
        },
        {
          num: "WO-2", title: "Belt", asset_tag: "H1", status: "in_progress", assignee: "Achan",
          created_at: "2026-10-05T08:00:00Z", attrs: { job_card: { hours: "2" } },
        },
        { num: "WO-3", title: "Cancelled", asset_tag: "H1", status: "cancelled", created_at: "2026-10-05T08:00:00Z", attrs: {} },
        {
          num: "WO-4", title: "Pump seal", asset_tag: "P1", status: "open",
          created_at: "2026-09-20T08:00:00Z", attrs: { job_card: { technician: "Visitor", hours: "1" } },
        },
      ],
    },
    "/api/v1/work-orders/WO-1": { num: "WO-1", asset_tag: "H1", status: "completed" },
    "/api/v1/work-orders/WO-3": { num: "WO-3", asset_tag: "H1", status: "cancelled" },
    "/api/v1/assets": {
      items: [
        { tag: "H1", name: "Huller 1", plant_code: "mbale", section_code: "hulling" },
        { tag: "P1", name: "Pump 1", plant_code: "kampala", section_code: "utilities" },
      ],
    },
    "/api/v1/assets/H1": { tag: "H1", plant_code: "mbale" },
    "/api/v1/plants": {
      items: [
        { code: "mbale", attrs: { labour_rates: { Fitter: 10000, "*": 8000 }, labour_currency: "UGX" } },
        { code: "kampala", attrs: {} },
      ],
    },
    "/api/v1/technicians": {
      items: [
        { name: "Okello", role: "Fitter" },
        { name: "Achan", role: "Electrician" },
      ],
    },
    "/api/v1/consumption/work-orders": {
      items: [
        { work_order_ref: "WO-1", issue_id: "iss-0", sku: "BRG-6205", name: "Bearing", uom: "ea", bin_code: "A1", qty: 2, unit_cost: 15000, total_cost: 30000, currency: "UGX", posted_at: "2026-10-04T10:00:00Z", estimated: false },
        { work_order_ref: "WO-2", issue_id: "iss-9", sku: "BLT-1", name: "Belt", uom: "ea", bin_code: "A2", qty: 1, unit_cost: 7000, total_cost: 7000, currency: "UGX", posted_at: "2026-10-05T10:00:00Z", estimated: true },
      ],
    },
    "/api/v1/items": { items: [{ id: "item-1", sku: "BRG-6205", uom: "ea", material_class: "spare_part" }] },
    "/api/v1/items/item-1/balances": {
      items: [
        { bin_code: "A1", qty: 3, reserved: 0, available: 3, status: "available" },
        { bin_code: "B7", qty: 9, reserved: 1, available: 8, status: "available" },
        { bin_code: "Q1", qty: 50, available: 50, status: "quarantine" },
      ],
    },
  };
  mockFetch.mockImplementation((async (req: Call) => {
    if (missing.has(req.path || "")) throw new gateway.GatewayError(404, "not found");
    if (req.method && req.method !== "GET") return onWrite(req);
    return routes[req.path || ""] ?? { items: [] };
  }) as never);
});

/* ─────────────────────────────── parts used ─────────────────────────────── */

describe("parts used", () => {
  const adapter = () => RECORD_ADAPTERS["production:parts-used"];

  it("book a part out of the store with the most free stock, costed to the machine", async () => {
    await adapter().create!(ctx, record({ workOrder: "WO-1", part: "brg-6205", qty: "5", technician: "Okello" }));
    const post = writes()[0];
    expect(post).toMatchObject({ service: "warehouse", path: "/api/v1/issues/for-department" });
    expect(post.body).toMatchObject({
      department: "maintenance",
      work_order_ref: "WO-1",
      cost_center: "MAINT/mbale/H1",
      requested_by: "Okello",
      // Quarantined stock is not free stock; B7 has 8 available.
      lines: [{ item_sku: "BRG-6205", qty: 5, uom: "ea", bin_code: "B7" }],
    });
  });

  it("say where the stock is when no single store holds enough", async () => {
    await expect(adapter().create!(ctx, record({ workOrder: "WO-1", part: "BRG-6205", qty: "10" }))).rejects.toThrow(
      /No single store holds 10 ea of BRG-6205\. Free stock: A1 \(3\), B7 \(8\)/,
    );
    expect(writes()).toHaveLength(0);
  });

  it("say a part is out of stock rather than posting an issue the warehouse refuses", async () => {
    routes["/api/v1/items/item-1/balances"] = { items: [] };
    await expect(adapter().create!(ctx, record({ workOrder: "WO-1", part: "BRG-6205", qty: "1" }))).rejects.toThrow(/out of stock/);
  });

  it("refuse a cancelled work order, a zero quantity, and an unknown part", async () => {
    await expect(adapter().create!(ctx, record({ workOrder: "WO-3", part: "BRG-6205", qty: "1" }))).rejects.toThrow(/cancelled/);
    await expect(adapter().create!(ctx, record({ workOrder: "WO-1", part: "BRG-6205", qty: "0" }))).rejects.toThrow(InputError);
    await expect(adapter().create!(ctx, record({ workOrder: "WO-1", part: "NOPE", qty: "1" }))).rejects.toThrow(/No spare part "NOPE"/);
    expect(writes()).toHaveLength(0);
  });

  it("take the store named instead of choosing one", async () => {
    await adapter().create!(ctx, record({ workOrder: "WO-1", part: "BRG-6205", qty: "1", store: "A1" }));
    expect((writes()[0].body!.lines as Row[])[0]).toMatchObject({ bin_code: "A1", uom: "ea" });
  });

  it("list what the warehouse booked out, with the machine and factory it went to", async () => {
    const rows = await adapter().list(ctx);
    expect(rows[0]).toMatchObject({ workOrder: "WO-1", workCenter: "H1", plantCode: "mbale", part: "BRG-6205", qty: "2", totalCost: "30,000", status: "Booked" });
    expect(rows[1]).toMatchObject({ workOrder: "WO-2", status: "Estimated" });
  });

  it("say the warehouse is not updated, instead of an empty list", async () => {
    missing.add("/api/v1/consumption/work-orders");
    await expect(adapter().list(ctx)).rejects.toThrow(/iag-warehouse#1/);
  });

  it("cannot be edited or deleted — a mistake is a return to stock", () => {
    expect(adapter().update).toBeUndefined();
    expect(adapter().remove).toBeUndefined();
  });
});

type Row = Record<string, unknown>;

/* ───────────────────────────── labour rates ───────────────────────────── */

describe("labour rates", () => {
  const adapter = () => RECORD_ADAPTERS["production:labour-rates"];

  it("list each factory's rates, with the catch-all named", async () => {
    const rows = await adapter().list(ctx);
    expect(rows.map((r) => [r.id, r.role, r.hourlyRate])).toEqual([
      ["mbale/Fitter", "Fitter", "10000"],
      ["mbale/*", "Everyone else", "8000"],
    ]);
  });

  it("set one role's rate without touching the others", async () => {
    onWrite = () => ({ code: "mbale", attrs: { labour_rates: { Fitter: 10000, "*": 8000, Electrician: 12000 } } });
    await adapter().create!(ctx, record({ plantCode: "mbale", role: "Electrician", hourlyRate: "12000", currency: "ugx" }));
    expect(writes()[0]).toMatchObject({
      method: "PATCH",
      path: "/api/v1/plants/mbale",
      body: { labour_rates: { Electrician: 12000 }, labour_currency: "UGX" },
    });
  });

  it("say so when MES ignored the rate (no iag-mes#13), instead of reporting it saved", async () => {
    onWrite = () => ({ code: "mbale", attrs: {} });
    await expect(
      adapter().create!(ctx, record({ plantCode: "mbale", role: "Everyone else", hourlyRate: "9000" })),
    ).rejects.toThrow(/iag-mes#13/);
  });

  it("remove a rate by sending null for its role", async () => {
    onWrite = () => ({ code: "mbale", attrs: { labour_rates: { Fitter: 10000 } } });
    await adapter().remove!(ctx, "mbale/*");
    expect(writes()[0].body).toEqual({ labour_rates: { "*": null } });
  });

  it("keep a rate's factory and role fixed", async () => {
    await expect(adapter().update!(ctx, "mbale/Fitter", record({ role: "Electrician" }))).rejects.toThrow(/role is fixed/);
    await expect(adapter().update!(ctx, "mbale/Fitter", record({ plantCode: "kampala" }))).rejects.toThrow(/factory is fixed/);
  });
});

/* ─────────────────────────────── job costs ─────────────────────────────── */

describe("job costs", () => {
  it("cost labour at the technician's role rate, falling back to the factory's catch-all", async () => {
    const rows = await RECORD_ADAPTERS["production:job-costs"].list(ctx);
    const byWo = Object.fromEntries(rows.map((r) => [r.workOrder, r]));
    // Okello is a Fitter: 4 h × 10,000 + 30,000 parts + 50,000 contractor.
    expect(byWo["WO-1"]).toMatchObject({ labourCost: "40,000", partsCost: "30,000", contractorCost: "50,000", totalCost: "120,000", plantCode: "mbale", notes: "" });
    // Achan is an Electrician with no rate at Mbale: the "*" rate, 8,000.
    expect(byWo["WO-2"]).toMatchObject({ labourCost: "16,000", partsCost: "7,000", totalCost: "23,000" });
    expect(byWo["WO-2"].notes).toMatch(/estimated/);
    // Cancelled work costs nothing and is left out.
    expect(byWo["WO-3"]).toBeUndefined();
  });

  it("cost each technician on a shared job at their own role's rate", async () => {
    (routes["/api/v1/work-orders"] as { items: Row[] }).items.push({
      num: "WO-9", title: "Gearbox", asset_tag: "H1", status: "completed", created_at: "2026-10-06T08:00:00Z",
      attrs: { job_card: { labour: [{ technician: "Okello", hours: 3 }, { technician: "Achan", hours: 2 }] } },
    });
    const rows = await RECORD_ADAPTERS["production:job-costs"].list(ctx);
    // Okello is a Fitter (10,000/h); Achan an Electrician with no rate at Mbale, so the "*" 8,000/h.
    expect(rows.find((r) => r.workOrder === "WO-9")).toMatchObject({ hours: "5", labourCost: "46,000" });
  });

  it("leave the total blank and say why when a factory has no rate", async () => {
    const rows = await RECORD_ADAPTERS["production:job-costs"].list(ctx);
    const wo4 = rows.find((r) => r.workOrder === "WO-4")!;
    expect(wo4.labourCost).toBe("");
    expect(wo4.totalCost).toBe("");
    expect(wo4.notes).toMatch(/No labour rate for Visitor at kampala/);
  });

  it("say parts are unknown, not zero, when the warehouse is not updated", async () => {
    missing.add("/api/v1/consumption/work-orders");
    const rows = await RECORD_ADAPTERS["production:job-costs"].list(ctx);
    const wo1 = rows.find((r) => r.workOrder === "WO-1")!;
    expect(wo1.partsCost).toBe("");
    expect(wo1.totalCost).toBe("");
    expect(wo1.notes).toMatch(/Parts cost unknown/);
  });

  it("ask the warehouse only about the work orders being costed", async () => {
    await RECORD_ADAPTERS["production:job-costs"].list(ctx);
    const read = calls().find((c) => c.path === "/api/v1/consumption/work-orders")!;
    expect(read.query!.work_order_ref).toBe("WO-1,WO-2,WO-4");
  });
});

describe("machine costs", () => {
  it("add up each machine's jobs per month", async () => {
    const rows = await RECORD_ADAPTERS["production:machine-costs"].list(ctx);
    const h1 = rows.find((r) => r.id === "H1/2026-10")!;
    expect(h1).toMatchObject({ machineName: "Huller 1", plantCode: "mbale", section: "hulling", jobs: "2", hours: "6", labourCost: "56,000", partsCost: "37,000", contractorCost: "50,000", totalCost: "143,000" });
    // A machine-month with an uncosted job says the figure is incomplete.
    expect(rows.find((r) => r.id === "P1/2026-09")).toMatchObject({ status: "Incomplete", totalCost: "" });
  });
});

/* ───────────────────────────── stock level ───────────────────────────── */

describe("stock level", () => {
  it("is Out at zero, Low at or under the reorder level, otherwise OK", () => {
    expect(stockLevel(0, 5)).toBe("Out");
    expect(stockLevel(5, 5)).toBe("Low");
    expect(stockLevel(6, 5)).toBe("OK");
    expect(stockLevel(1, 0)).toBe("OK");
  });
});
