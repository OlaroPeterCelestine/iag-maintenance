/**
 * Maintenance phase 2 in the app: fault reports, checklist steps, meter
 * readings, failure causes, and the failure code / approval / sign-off on a
 * work order. MES enforces the rules; these pin what the app sends it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_ADAPTERS } from "@/lib/iag/records/registry";
import { InputError, type AdapterContext, type AppRecord } from "@/lib/iag/records/types";

vi.mock("@/lib/iag/gateway", async () => {
  const actual = await vi.importActual<typeof import("@/lib/iag/gateway")>("@/lib/iag/gateway");
  return { ...actual, gatewayFetch: vi.fn(async () => ({ items: [] })) };
});
const gateway = await import("@/lib/iag/gateway");
const mockFetch = vi.mocked(gateway.gatewayFetch);

type Row = Record<string, unknown>;
type Call = { service?: string; path?: string; method?: string; body?: Row; query?: Row };
const ctx: AdapterContext = { module: "production", entity: "x", query: new URLSearchParams() };
const record = (f: Record<string, string>) => ({ id: "", createdAt: "", updatedAt: "", ...f }) as AppRecord;
const calls = () => mockFetch.mock.calls.map((c) => c[0] as Call);
const writes = () => calls().filter((c) => c.method && c.method !== "GET");

let routes: Record<string, unknown>;
let missing: Set<string>;

const WO_PM: Row = {
  num: "WO-5", title: "Monthly PM", asset_tag: "H1", wo_type: "preventive", status: "in_progress",
  attrs: {
    checklist: ["Grease bearings", { step: "Check belt" }, "Measure vibration"],
    checklist_results: [{ index: 0, result: "pass", by: "Tech C", at: "2026-10-12T08:00:00Z" }],
    signoff: { technician: { by: "Tech C" } },
  },
};

beforeEach(() => {
  mockFetch.mockClear();
  missing = new Set();
  routes = {
    "/api/v1/fault-reports": {
      items: [{
        id: "fr-1", severity: "crit", source: "H1", message: "Huller seized", status: "investigating",
        occurred_at: "2026-10-12T07:00:00Z",
        attrs: { kind: "fault_report", asset_tag: "H1", title: "Huller seized", machine_stopped: true, reported_by: "Operator A", work_order: "WO-9" },
      }],
    },
    "/api/v1/work-orders": { items: [WO_PM, { num: "WO-6", status: "cancelled", attrs: { checklist: ["x"] } }] },
    "/api/v1/work-orders/WO-5": WO_PM,
    "/api/v1/work-orders/WO-7": {
      num: "WO-7", asset_tag: "H1", wo_type: "breakdown", status: "in_progress",
      attrs: { failure: { problem: "Bearing failure", cause: "Normal wear", remedy: "Replaced part" } },
    },
    "/api/v1/work-orders/WO-8": { num: "WO-8", asset_tag: "H1", status: "in_progress", attrs: { job_card: { meterReading: "1200" } } },
  };
  mockFetch.mockImplementation((async (req: Call) => {
    if (missing.has(req.path || "")) throw new gateway.GatewayError(404, "404 page not found");
    if (req.method && req.method !== "GET") {
      if (req.path?.endsWith("/convert")) return { work_order: { num: "WO-10" }, report: { id: "fr-1", status: "investigating", attrs: { work_order: "WO-10" } } };
      if (req.path?.endsWith("/checklist")) {
        return { ...WO_PM, attrs: { ...(WO_PM.attrs as Row), checklist_results: [...((WO_PM.attrs as Row).checklist_results as Row[]), { index: 1, ...(req.body!.results as Row[])[0] }] } };
      }
      return { id: "x", num: "WO-5", recorded_at: "2026-10-12T09:00:00Z", value: req.body?.value, ...(req.body || {}) };
    }
    return routes[req.path || ""] ?? { items: [] };
  }) as never);
});

describe("fault reports", () => {
  const adapter = () => RECORD_ADAPTERS["production:fault-reports"];

  it("report a stopped machine as stopped, without asking maintenance's questions", async () => {
    await adapter().create!(ctx, record({ workCenter: "H1", title: "Grinding noise", machineStopped: "Yes", severity: "Warning", description: "Since 6am" }));
    expect(writes()[0]).toMatchObject({
      path: "/api/v1/fault-reports",
      body: { asset_tag: "H1", title: "Grinding noise", machine_stopped: true, severity: "warn", description: "Since 6am" },
    });
  });

  it("read back in the floor's words", async () => {
    const [row] = await adapter().list(ctx);
    expect(row).toMatchObject({ workCenter: "H1", machineStopped: "Yes", severity: "Critical", status: "Work order raised", workOrder: "WO-9", reportedBy: "Operator A" });
  });

  it("are triaged in the edit form: make the work order with its priority, or reject with a reason", async () => {
    await adapter().update!(ctx, "fr-1", record({ decision: "Make work order", priority: "Critical", assignee: "Okello" }));
    expect(writes()[0]).toMatchObject({ path: "/api/v1/fault-reports/fr-1/convert", body: { priority: "critical", assignee: "Okello" } });
    await expect(adapter().update!(ctx, "fr-1", record({ decision: "No work needed" }))).rejects.toThrow(/why no work/);
    await adapter().update!(ctx, "fr-1", record({ decision: "No work needed", rejectedReason: "Normal start-up noise" }));
    expect(writes().at(-1)).toMatchObject({ path: "/api/v1/fault-reports/fr-1/reject", body: { reason: "Normal start-up noise" } });
    await expect(adapter().update!(ctx, "fr-1", record({ title: "rewritten" }))).rejects.toThrow(/choose a decision/);
  });

  it("say MES is not updated, rather than an empty list", async () => {
    missing.add("/api/v1/fault-reports");
    await expect(adapter().list(ctx)).rejects.toThrow(/iag-mes#14/);
  });
});

describe("checklist steps", () => {
  const adapter = () => RECORD_ADAPTERS["production:checklist-steps"];

  it("list every step of every live work order, marked or still to do", async () => {
    const rows = await adapter().list(ctx);
    expect(rows.map((r) => [r.id, r.step, r.result, r.status])).toEqual([
      ["WO-5#0", "Grease bearings", "Pass", "Pass"],
      ["WO-5#1", "Check belt", "", "To do"],
      ["WO-5#2", "Measure vibration", "", "To do"],
    ]);
  });

  it("mark one step, with its reading", async () => {
    const saved = await adapter().update!(ctx, "WO-5#1", record({ result: "N/A", reading: "2.5", note: "" }));
    expect(writes()[0]).toMatchObject({ path: "/api/v1/work-orders/WO-5/checklist", body: { results: [{ index: 1, result: "na", reading: 2.5 }] } });
    expect(saved).toMatchObject({ id: "WO-5#1", result: "N/A" });
    await expect(adapter().update!(ctx, "WO-5#1", record({ result: "Maybe" }))).rejects.toThrow(InputError);
  });
});

describe("meter readings", () => {
  it("record running hours on the day read, and say when the meter was replaced", async () => {
    await RECORD_ADAPTERS["production:meter-readings"].create!(ctx, record({ workCenter: "H1", hours: "1250", date: "2026-10-12", meterReplaced: "Yes" }));
    expect(writes()[0]).toMatchObject({
      path: "/api/v1/assets/H1/meter-readings",
      body: { value: 1250, recorded_at: "2026-10-12T12:00:00+03:00", reset: true },
    });
  });
});

describe("work orders", () => {
  const adapter = () => RECORD_ADAPTERS["production:work-orders"];

  it("write the failure code before the completion that needs it", async () => {
    await adapter().update!(ctx, "WO-5", record({ failureProblem: "Leak", failureCause: "Normal wear", failureRemedy: "Repaired", status: "Completed" }));
    const paths = writes().map((w) => w.path);
    expect(paths.indexOf("/api/v1/work-orders/WO-5/failure")).toBeLessThan(paths.indexOf("/api/v1/work-orders/WO-5/complete"));
  });

  it("not rewrite an unchanged failure code, nor send half of one", async () => {
    await adapter().update!(ctx, "WO-7", record({ failureProblem: "Bearing failure", failureCause: "Normal wear", failureRemedy: "Replaced part", title: "x" }));
    expect(writes().some((w) => w.path?.endsWith("/failure"))).toBe(false);
    await expect(adapter().update!(ctx, "WO-5", record({ failureProblem: "Leak" }))).rejects.toThrow(/all three/);
  });

  it("approve or reject from the edit form, a rejection with its reason", async () => {
    await expect(adapter().update!(ctx, "WO-5", record({ approvalDecision: "Reject" }))).rejects.toThrow(/Say why/);
    await adapter().update!(ctx, "WO-5", record({ approvalDecision: "Reject", approvalNote: "Repair, don't rebuild" }));
    expect(writes()[0]).toMatchObject({ path: "/api/v1/work-orders/WO-5/reject", body: { reason: "Repair, don't rebuild" } });
  });

  it("show the checklist progress and who signed", async () => {
    const [row] = await adapter().list(ctx);
    expect(row).toMatchObject({ checklistProgress: "1 / 3", signedBy: "Tech C" });
  });
});

describe("job cards", () => {
  it("send the meter reading to the machine's running hours only when it changed", async () => {
    await RECORD_ADAPTERS["production:batch-records"].update!(ctx, "WO-8", record({ meterReading: "1200", hours: "2" }));
    expect(writes().some((w) => w.path?.endsWith("/meter-readings"))).toBe(false);
    mockFetch.mockClear();
    await RECORD_ADAPTERS["production:batch-records"].update!(ctx, "WO-8", record({ meterReading: "1260", date: "2026-10-12" }));
    const paths = writes().map((w) => w.path);
    // The reading goes first: one MES refuses should stop the save.
    expect(paths[0]).toBe("/api/v1/assets/H1/meter-readings");
  });
});

describe("failure causes", () => {
  it("rank causes and mark the ones making up the first 80% of failures", async () => {
    routes["/api/v1/reliability/failure-causes"] = {
      items: [
        { problem: "Bearing failure", cause: "Lack of lubrication", count: 6, machines: 3 },
        { problem: "Belt or chain failure", cause: "Normal wear", count: 3, machines: 2 },
        { problem: "Leak", cause: "Normal wear", count: 1, machines: 1 },
      ],
    };
    const rows = await RECORD_ADAPTERS["production:failure-causes"].list(ctx);
    expect(rows.map((r) => [r.rank, r.share, r.status])).toEqual([
      ["1", "60%", "Top 80%"],
      ["2", "30%", "Top 80%"],
      ["3", "10%", "Long tail"],
    ]);
  });
});

describe("factories", () => {
  it("say so when MES did not store the approval threshold", async () => {
    mockFetch.mockImplementation((async (req: Call) =>
      req.method === "PATCH" ? { code: "mbale", attrs: {} } : { items: [] }) as never);
    await expect(
      RECORD_ADAPTERS["production:plants"].update!(ctx, "mbale", record({ approvalThreshold: "500000" })),
    ).rejects.toThrow(/approval threshold/);
  });
});
