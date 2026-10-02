/**
 * Spare parts, PM edits, the technician list and the reporting screens —
 * what each puts on the wire, and what each makes of what comes back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayError } from "@/lib/iag/gateway";
import { RECORD_ADAPTERS } from "@/lib/iag/records/registry";
import type { AdapterContext, AppRecord } from "@/lib/iag/records/types";

vi.mock("@/lib/iag/gateway", async () => {
  const actual = await vi.importActual<typeof import("@/lib/iag/gateway")>(
    "@/lib/iag/gateway",
  );
  return { ...actual, gatewayFetch: vi.fn(async () => ({ items: [] })) };
});

const { gatewayFetch } = await import("@/lib/iag/gateway");
const mockFetch = vi.mocked(gatewayFetch);

type Call = {
  service?: string;
  path?: string;
  method?: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
};

const ctx: AdapterContext = { module: "production", entity: "test", query: new URLSearchParams() };

function record(fields: Record<string, string>): AppRecord {
  return { id: "", createdAt: "", updatedAt: "", ...fields } as AppRecord;
}

function writes(): Call[] {
  return mockFetch.mock.calls.map((c) => c[0] as Call).filter((c) => c.method && c.method !== "GET");
}

/** wh_items.status CHECK, warehouse migration 026. */
const ITEM_STATUSES = ["draft", "active", "restricted", "obsolete", "blocked"];

let routes: Record<string, unknown>;

beforeEach(() => {
  mockFetch.mockClear();
  routes = {
    "/api/v1/items/item-1": {
      id: "item-1",
      sku: "SP-BRG-6205",
      name: "Bearing 6205",
      material_class: "spare_part",
      uom: "ea",
      min_qty: 4,
      status: "active",
      attrs: { manufacturer: "SKF", storeLocation: "Bin A3" },
    },
    "/api/v1/items/raw-1": { id: "raw-1", sku: "GB-1", material_class: "raw_material", attrs: {} },
    "/api/v1/stock/summary": { items: [{ sku: "SP-BRG-6205", qty: 12, available: 10 }] },
    "/api/v1/spare-compat": { items: [] },
    "/api/v1/pm-templates": { items: [{ id: "tpl-1", code: "PM-GREASE", name: "Grease", interval_days: 30 }] },
  };
  mockFetch.mockImplementation((async (req: Call) => {
    if (req.method === "POST" && req.path === "/api/v1/items") {
      return { id: "item-new", status: "active", ...(req.body || {}) };
    }
    if (req.method === "PATCH" && req.path?.startsWith("/api/v1/pm-schedules/")) {
      return { id: "sch-1", template_id: "tpl-1", asset_tag: "HUL-1", next_due_at: req.body?.next_due_at, status: "scheduled" };
    }
    if (req.method && req.method !== "GET") return { ...(req.body || {}) };
    if (req.path === "/api/v1/spare-compat" && req.query?.item_id === "item-1") {
      return { items: [{ id: "c-1", item_id: "item-1", asset_type: "Huller" }, { id: "c-2", item_id: "item-1", asset_type: "Pump" }] };
    }
    if (req.path === "/api/v1/items/item-new") {
      return { id: "item-new", sku: "SP-NEW", name: "New part", material_class: "spare_part", status: "active", attrs: {} };
    }
    return routes[req.path || ""] ?? { items: [] };
  }) as never);
});

/* ─────────────────────────── spare parts ─────────────────────────── */

describe("spare parts", () => {
  it("are created as warehouse items of class spare_part, with numeric quantities", async () => {
    await RECORD_ADAPTERS["production:spare-parts"].create!(
      ctx,
      record({ name: "New part", code: "SP-NEW", unit: "pcs", reorderLevel: "4", maxQty: "20", manufacturer: "SKF", status: "Active" }),
    );
    const post = writes().find((c) => c.path === "/api/v1/items")!;
    expect(post.service).toBe("warehouse");
    expect(post.body).toMatchObject({
      sku: "SP-NEW",
      material_class: "spare_part",
      tracking_mode: "bulk",
      uom: "pcs",
      min_qty: 4,
      max_qty: 20,
      attrs: { manufacturer: "SKF" },
    });
    // Status already active: no second call to the status route.
    expect(writes().some((c) => c.path?.endsWith("/status"))).toBe(false);
  });

  it("links the machine types a new part fits", async () => {
    await RECORD_ADAPTERS["production:spare-parts"].create!(
      ctx,
      record({ name: "New part", code: "SP-NEW", fitsMachineTypes: "Huller, Pump; Huller" }),
    );
    const compat = writes().filter((c) => c.path === "/api/v1/spare-compat");
    expect(compat.map((c) => c.body)).toEqual([
      { item_id: "item-new", asset_type: "Huller" },
      { item_id: "item-new", asset_type: "Pump" },
    ]);
  });

  it("sends a status the column accepts, through the status route, for every option", async () => {
    for (const status of ["Draft", "Restricted", "Obsolete", "Blocked"]) {
      mockFetch.mockClear();
      await RECORD_ADAPTERS["production:spare-parts"].update!(ctx, "item-1", record({ status }));
      const call = writes().find((c) => c.path === "/api/v1/items/item-1/status")!;
      expect(call.method).toBe("PATCH");
      expect(ITEM_STATUSES).toContain(call.body!.status);
      // Status is never written on the item itself; PATCH /items refuses it.
      expect(writes().some((c) => c.path === "/api/v1/items/item-1")).toBe(false);
    }
  });

  it("keeps the rest of the attrs bag when one descriptive field changes", async () => {
    // PATCH /items/:id replaces attrs whole.
    await RECORD_ADAPTERS["production:spare-parts"].update!(ctx, "item-1", record({ partNumber: "6205-2RS" }));
    const patch = writes().find((c) => c.path === "/api/v1/items/item-1")!;
    expect(patch.body!.attrs).toEqual({ manufacturer: "SKF", storeLocation: "Bin A3", partNumber: "6205-2RS" });
  });

  it("makes the machine types exactly what the form lists", async () => {
    await RECORD_ADAPTERS["production:spare-parts"].update!(
      ctx,
      "item-1",
      record({ fitsMachineTypes: "Huller, Compressor" }),
    );
    const sent = writes().map((c) => `${c.method} ${c.path} ${c.body ? JSON.stringify(c.body) : ""}`.trim());
    expect(sent).toContain("DELETE /api/v1/spare-compat/c-2");
    expect(sent).toContain('POST /api/v1/spare-compat {"item_id":"item-1","asset_type":"Compressor"}');
    expect(sent.some((c) => c.includes('"Huller"'))).toBe(false);
  });

  it("refuses to edit an item that is not a spare part", async () => {
    await expect(
      RECORD_ADAPTERS["production:spare-parts"].update!(ctx, "raw-1", record({ name: "x" })),
    ).rejects.toThrow(/not a spare part/);
    expect(writes()).toHaveLength(0);
  });

  it("lists only spare parts, with stock on hand joined by SKU", async () => {
    routes["/api/v1/items"] = {
      items: [routes["/api/v1/items/item-1"], routes["/api/v1/items/raw-1"]],
    };
    const rows = await RECORD_ADAPTERS["production:spare-parts"].list(ctx);
    const listCall = mockFetch.mock.calls.map((c) => c[0] as Call).find((c) => c.path === "/api/v1/items")!;
    expect(listCall.query).toEqual({ material_class: "spare_part" });
    expect(rows.map((r) => r.code)).toEqual(["SP-BRG-6205"]);
    expect(rows[0].onHand).toBe("12");
    expect(rows[0].available).toBe("10");
  });
});

/* ──────────────────────────── PM edits ───────────────────────────── */

describe("PM edits", () => {
  it("patch a template by id, with the interval as a number and the checklist as lines", async () => {
    await RECORD_ADAPTERS["production:pm-templates"].update!(
      ctx,
      "tpl-1",
      record({ intervalDays: "45", checklist: "Grease\nCheck belt" }),
    );
    const call = writes()[0];
    expect(call.path).toBe("/api/v1/pm-templates/tpl-1");
    expect(call.body).toEqual({ interval_days: 45, checklist: ["Grease", "Check belt"] });
  });

  it("send an emptied checklist as [] rather than dropping the edit", async () => {
    await RECORD_ADAPTERS["production:pm-templates"].update!(ctx, "tpl-1", record({ checklist: "" }));
    expect(writes()[0].body).toEqual({ checklist: [] });
  });

  it("refuse to change a template's code", async () => {
    await expect(
      RECORD_ADAPTERS["production:pm-templates"].update!(ctx, "tpl-1", record({ code: "PM-NEW" })),
    ).rejects.toThrow(/code is fixed/);
  });

  it("reschedule by next_due_at, as RFC3339 on the plant's clock", async () => {
    const saved = await RECORD_ADAPTERS["production:pm-schedules"].update!(
      ctx,
      "sch-1",
      record({ nextDue: "2026-12-01" }),
    );
    const call = writes()[0];
    expect(call.path).toBe("/api/v1/pm-schedules/sch-1");
    expect(call.body).toEqual({ next_due_at: "2026-12-01T06:00:00+03:00" });
    expect(saved?.template).toBe("PM-GREASE");
  });

  it("refuse to move a schedule to another template or machine", async () => {
    await expect(
      RECORD_ADAPTERS["production:pm-schedules"].update!(ctx, "sch-1", record({ workCenter: "CMP1" })),
    ).rejects.toThrow(/fixed/);
  });
});

/* ─────────────────────────── technicians ─────────────────────────── */

describe("technicians", () => {
  it("read as an empty list while MES has no /technicians route yet", async () => {
    mockFetch.mockImplementationOnce((async () => {
      throw new GatewayError(404, "route not found");
    }) as never);
    await expect(RECORD_ADAPTERS["production:technicians"].list(ctx)).resolves.toEqual([]);
  });

  it("still surface any other failure", async () => {
    mockFetch.mockImplementationOnce((async () => {
      throw new GatewayError(500, "boom");
    }) as never);
    await expect(RECORD_ADAPTERS["production:technicians"].list(ctx)).rejects.toThrow(/boom/);
  });
});

/* ──────────────────────────── reporting ──────────────────────────── */

describe("reporting screens", () => {
  it("read reliability per machine, rounded", async () => {
    routes["/api/v1/reliability/summary"] = {
      since: "2026-07-04T09:52:01.731Z",
      assets: [{ asset_tag: "CMP1", mtbf_hours: 2160.000003, mttr_hours: 0.33333, availability_pct: 99.95, failure_count: 2, status: "strong" }],
    };
    const [row] = await RECORD_ADAPTERS["production:reliability"].list(ctx);
    expect(row).toMatchObject({
      workCenter: "CMP1",
      mtbfHours: "2160",
      mttrHours: "0.33",
      availability: "100",
      failures: "2",
      status: "Strong",
      since: "2026-07-04",
    });
  });

  it("offer acknowledge and resolve on alerts, gated on mes.ack_alert", async () => {
    const actions = RECORD_ADAPTERS["production:alerts"].actions || [];
    expect(actions.map((a) => [a.id, a.permission, a.whenStatus])).toEqual([
      ["ack", "mes.ack_alert", ["New"]],
      ["resolve", "mes.ack_alert", ["New", "Ack", "Investigating"]],
    ]);
    routes["/api/v1/alerts"] = { items: [{ id: "a-1", severity: "warn", source: "H1", message: "PM overdue", status: "new", occurred_at: "2026-10-02T06:00:00Z" }] };
    const [row] = await RECORD_ADAPTERS["production:alerts"].list(ctx);
    expect(row).toMatchObject({ severity: "Warning", workCenter: "H1", status: "New" });
  });

  it("read a recommendation back after accepting it, since the verb returns only a status", async () => {
    routes["/api/v1/ai/recommendations"] = {
      items: [{ id: "r-1", title: "Grease H1", status: "accepted", confidence: 0.82, created_at: "2026-10-02T06:00:00Z" }],
    };
    const accept = RECORD_ADAPTERS["production:recommendations"].actions!.find((a) => a.id === "accept")!;
    const saved = await accept.run(ctx, "r-1");
    expect(writes()[0].path).toBe("/api/v1/ai/recommendations/r-1/accept");
    expect(saved).toMatchObject({ id: "r-1", status: "Accepted", confidence: "82" });
  });
});
