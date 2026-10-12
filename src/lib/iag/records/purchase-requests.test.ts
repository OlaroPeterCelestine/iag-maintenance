import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_ADAPTERS } from "@/lib/iag/records/registry";
import type { AdapterContext, AppRecord } from "@/lib/iag/records/types";

vi.mock("@/lib/iag/gateway", async () => {
  const actual = await vi.importActual<typeof import("@/lib/iag/gateway")>("@/lib/iag/gateway");
  return { ...actual, gatewayFetch: vi.fn(async () => ({ items: [] })) };
});
const gateway = await import("@/lib/iag/gateway");
const mockFetch = vi.mocked(gateway.gatewayFetch);
type Call = { service?: string; path?: string; method?: string; body?: Record<string, unknown> };
const ctx: AdapterContext = { module: "production", entity: "x", query: new URLSearchParams() };
const record = (f: Record<string, string>) => ({ id: "", createdAt: "", updatedAt: "", ...f }) as AppRecord;

beforeEach(() => mockFetch.mockReset());

describe("purchase requests", () => {
  const adapter = () => RECORD_ADAPTERS["production:purchase-requests"];

  it("list only what maintenance asked procurement for, with procurement's status", async () => {
    mockFetch.mockResolvedValueOnce([
      { id: "r1", docNo: "PR-2026-1", title: "Spare part: Bearing", dept: "Maintenance", status: "Approved", originSystem: "maintenance", originRef: "SP-BRG-20261013", total: 450000, currency: "UGX" },
      { id: "r2", title: "Fuel", originSystem: "fleet", originRef: "F-1" },
    ] as never);
    const rows = await adapter().list(ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "SP-BRG-20261013", docNo: "PR-2026-1", department: "Maintenance", status: "Approved", total: "450000" });
  });

  it("send the request through MES, which publishes it to procurement", async () => {
    mockFetch.mockResolvedValueOnce({ ref: "SP-BRG-20261013" } as never);
    const saved = await adapter().create!(ctx, record({ part: "BRG", qty: "10", department: "Maintenance", estimatedCost: "450,000", urgent: "Yes" }));
    const call = mockFetch.mock.calls[0][0] as Call;
    expect(call).toMatchObject({ service: "mes", path: "/api/v1/purchase-requests", method: "POST" });
    expect(call.body).toMatchObject({ sku: "BRG", qty: 10, department: "Maintenance", estimated_cost: 450000, urgent: true, currency: "UGX" });
    expect(saved).toMatchObject({ reference: "SP-BRG-20261013", status: "Sent to procurement" });
  });

  it("refuse a request with no part, quantity or department, and say when MES is not updated", async () => {
    await expect(adapter().create!(ctx, record({ qty: "1", department: "M" }))).rejects.toThrow(/spare part/);
    await expect(adapter().create!(ctx, record({ part: "B", qty: "0", department: "M" }))).rejects.toThrow(/Quantity/);
    await expect(adapter().create!(ctx, record({ part: "B", qty: "1" }))).rejects.toThrow(/department/);
    mockFetch.mockRejectedValueOnce(new gateway.GatewayError(404, "404 page not found"));
    await expect(adapter().create!(ctx, record({ part: "B", qty: "1", department: "M" }))).rejects.toThrow(/iag-mes#15/);
  });
});

describe("budget departments", () => {
  it("offer each department with a budget once", async () => {
    mockFetch.mockResolvedValueOnce([
      { code: "B1", dept: "Maintenance", remaining: 5 },
      { code: "B2", dept: "maintenance", remaining: 1 },
      { code: "B3", dept: "Production" },
      { code: "B4", dept: "" },
    ] as never);
    const rows = await RECORD_ADAPTERS["production:budget-departments"].list(ctx);
    expect(rows.map((r) => r.name)).toEqual(["Maintenance", "Production"]);
  });
});
