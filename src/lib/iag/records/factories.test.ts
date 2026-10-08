/**
 * Factories (MES plants) and Shop Floors (MES sections) — the two levels above
 * a machine. Same adapters as the Production app's tabs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_ADAPTERS } from "@/lib/iag/records/registry";
import { InputError, type AdapterContext, type AppRecord } from "@/lib/iag/records/types";

vi.mock("@/lib/iag/gateway", async () => {
  const actual = await vi.importActual<typeof import("@/lib/iag/gateway")>("@/lib/iag/gateway");
  return { ...actual, gatewayFetch: vi.fn(async () => ({ items: [] })) };
});
const { gatewayFetch } = await import("@/lib/iag/gateway");
const mockFetch = vi.mocked(gatewayFetch);

type Call = { service?: string; path?: string; method?: string; body?: Record<string, unknown> };
const ctx: AdapterContext = { module: "production", entity: "x", query: new URLSearchParams() };
const record = (f: Record<string, string>) => ({ id: "", createdAt: "", updatedAt: "", ...f }) as AppRecord;
const writes = () => mockFetch.mock.calls.map((c) => c[0] as Call).filter((c) => c.method && c.method !== "GET");

let routes: Record<string, unknown>;
beforeEach(() => {
  mockFetch.mockClear();
  routes = {};
  mockFetch.mockImplementation((async (req: Call) =>
    req.method && req.method !== "GET" ? { code: "kampala", ...(req.body || {}) } : routes[req.path || ""] ?? { items: [] }) as never);
});

describe("factories", () => {
  const plants = () => RECORD_ADAPTERS["production:plants"];

  it("can be edited, and show where they are", async () => {
    expect(plants().readOnly).toBeFalsy();
    routes["/api/v1/plants"] = {
      items: [{ code: "mbale", name: "Mbale processing", city: "Mbale", district: "Mbale", gps_lat: 1.0821, gps_lng: 34.1753 }],
    };
    const [row] = await plants().list(ctx);
    expect(row).toMatchObject({ id: "mbale", city: "Mbale", latitude: "1.0821", longitude: "34.1753", status: "Active" });
  });

  it("send only what the form changed, so moving the pin keeps the address", async () => {
    await plants().update!(ctx, "mbale", record({ latitude: "1.08", longitude: "34.17" }));
    expect(writes()[0]).toMatchObject({ method: "PATCH", path: "/api/v1/plants/mbale", body: { gps_lat: 1.08, gps_lng: 34.17 } });
    expect(writes()[0].body).not.toHaveProperty("address");
  });

  it("refuse half a coordinate, a coordinate off the globe, and a new code", async () => {
    await expect(plants().update!(ctx, "mbale", record({ latitude: "1.08" }))).rejects.toThrow(InputError);
    await expect(plants().update!(ctx, "mbale", record({ latitude: "91", longitude: "34" }))).rejects.toThrow(/Latitude/);
    await expect(plants().update!(ctx, "mbale", record({ code: "mbale2" }))).rejects.toThrow(/code is fixed/);
    expect(writes()).toHaveLength(0);
  });
});

describe("shop floors", () => {
  const sections = () => RECORD_ADAPTERS["production:sections"];

  it("key on factory and code, because codes repeat across factories", async () => {
    routes["/api/v1/sections"] = {
      items: [
        { plant_code: "kampala", code: "packaging", name: "Packaging" },
        { plant_code: "mbale", code: "packaging", name: "Packaging" },
      ],
    };
    const rows = await sections().list(ctx);
    expect(rows.map((r) => r.id)).toEqual(["kampala/packaging", "mbale/packaging"]);
  });

  it("are created inside the factory chosen, and refused without one", async () => {
    await sections().create!(ctx, record({ plantCode: "mbale", code: "hulling", name: "Hulling", lineType: "Hulling" }));
    expect(writes()[0].path).toBe("/api/v1/plants/mbale/sections");
    await expect(sections().create!(ctx, record({ code: "x" }))).rejects.toThrow(/factory/);
  });
});
