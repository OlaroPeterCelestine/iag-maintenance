/**
 * Energy and machine KPIs on the maintenance desk — the same adapters as the
 * Production app's tabs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_ADAPTERS } from "@/lib/iag/records/registry";
import { TARIFF_BANDS, plantDate } from "@/lib/iag/records/energy-kpis";
import type { AdapterContext, AppRecord } from "@/lib/iag/records/types";

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
    req.method && req.method !== "GET" ? { status: "ok" } : routes[req.path || ""] ?? { items: [] }) as never);
});

describe("energy", () => {
  it("records a reading with an explicit Kampala time, in the band vocabulary", async () => {
    await RECORD_ADAPTERS["production:energy"].create!(ctx, record({ plantCode: "kampala", workCenter: "CMP1", kwh: "12", tariffBand: "Off Peak", date: "2026-10-04", time: "6:30" }));
    const post = writes()[0];
    expect(post).toMatchObject({ service: "mes", path: "/api/v1/energy/readings" });
    expect(TARIFF_BANDS).toContain(post.body!.tariff_band);
    expect(post.body!.recorded_at).toBe("2026-10-04T06:30:00+03:00");
  });

  it("shows kWh per kg per plant", async () => {
    routes["/api/v1/plants"] = { items: [{ code: "mbale", name: "Mbale processing" }] };
    routes["/api/v1/energy/summary"] = { kwh_by_band: { peak: 50, standard: 50, off_peak: 0, total: 100 } };
    routes["/api/v1/measures"] = { items: [{ values: { product_kg: 400 } }] };
    const [row] = await RECORD_ADAPTERS["production:energy"].list(ctx);
    expect(row).toMatchObject({ plant: "Mbale processing", kwhPerKg: "0.25", peakShare: "50%" });
  });
});

describe("machine performance", () => {
  it("reads production's machine KPIs on the plant's date, read-only", async () => {
    routes["/api/v1/kpis/machines"] = {
      definitions: { MACH_AVAILABILITY: { name: "Availability", unit: "%" } },
      items: [{ kpi_code: "MACH_AVAILABILITY", scope_key: "H1", period_start: "2026-10-01T21:00:00Z", value: 92.04, target: 90, status: "ok" }],
    };
    const [row] = await RECORD_ADAPTERS["production:machine-performance"].list(ctx);
    expect(row).toMatchObject({ date: "2026-10-02", scope: "H1", kpi: "Availability", value: "92%", status: "Ok" });
    expect(RECORD_ADAPTERS["production:machine-performance"].readOnly).toBe(true);
    expect(plantDate("2026-10-01T21:00:00Z")).toBe("2026-10-02");
  });
});
