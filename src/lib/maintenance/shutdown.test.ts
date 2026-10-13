import { describe, expect, it } from "vitest";
import type { ForecastItem } from "@/lib/maintenance/calendar";
import {
  formatWindow,
  labour,
  localPlantTime,
  partsReadiness,
  plantTime,
  productionConflicts,
  suggestions,
  windowDays,
  type ShutdownWorkOrder,
} from "@/lib/maintenance/shutdown";

const wo = (num: string, over: Partial<ShutdownWorkOrder> = {}): ShutdownWorkOrder => ({
  num, title: "Job", asset_tag: "H1", wo_type: "preventive", status: "open", attrs: {}, ...over,
});

const SD = {
  code: "SD-MBALE-20261101",
  machines: ["H1", "H2"],
  starts_at: "2026-11-01T03:00:00Z",
  ends_at: "2026-11-03T15:00:00Z",
};

const fc = (over: Partial<ForecastItem>): ForecastItem => ({
  schedule_id: "s1", template_id: "t", template_code: "PM", template_name: "Quarterly", asset_tag: "H1", asset_name: "",
  plant_code: "mbale", section_code: "MILL", due_on: "2026-11-20", basis: "days", estimated: false, overdue: false,
  occurrence: 0, fixed_dates: true, ...over,
});

describe("planning a shutdown", () => {
  it("counts the window in whole days and the labour it needs against what there is", () => {
    expect(windowDays(SD.starts_at, SD.ends_at)).toBe(3);
    const l = labour(
      { ...SD, work_orders: [wo("WO-1", { attrs: { estimatedHours: "10" } }), wo("WO-2"), wo("WO-3", { status: "completed", attrs: { estimatedHours: "50" } })] },
      1,
    );
    // 10 h + an unestimated job at 2 h; one technician × 8 h × 3 days.
    expect(l).toEqual({ needed: 12, available: 24, unestimated: 1, short: false });
    expect(labour({ ...SD, work_orders: [wo("WO-1", { attrs: { estimatedHours: "30" } })] }, 1).short).toBe(true);
  });

  it("checks the planned parts against the stores, all of the stock counting", () => {
    const rows = partsReadiness(
      [
        wo("WO-1", { attrs: { parts_planned: [{ sku: "BRG-6205", qty: 2 }, { sku: "BELT-A", qty: 1 }] } }),
        wo("WO-2", { attrs: { parts_planned: [{ sku: "brg-6205", qty: 2 }] } }),
        wo("WO-3", { status: "cancelled", attrs: { parts_planned: [{ sku: "BELT-A", qty: 9 }] } }),
      ],
      [{ code: "BRG-6205", name: "Bearing", onHand: "3" }],
    );
    // Most short first; equally short, by code.
    expect(rows).toEqual([
      { sku: "BELT-A", name: "", needed: 1, onHand: 0, short: 1, known: false },
      { sku: "BRG-6205", name: "Bearing", needed: 4, onHand: 3, short: 1, known: true },
    ]);
  });

  it("finds production planned on its machines inside the window", () => {
    const hits = productionConflicts(
      [
        { asset_tag: "H1", label: "PO-12", block_type: "production", starts_at: "2026-11-02T06:00:00Z", ends_at: "2026-11-02T14:00:00Z" },
        { asset_tag: "H1", label: "after", block_type: "production", starts_at: "2026-11-04T06:00:00Z", ends_at: "2026-11-04T14:00:00Z" },
        { asset_tag: "R9", label: "other machine", block_type: "production", starts_at: "2026-11-02T06:00:00Z", ends_at: "2026-11-02T14:00:00Z" },
        { asset_tag: "H2", label: "itself", block_type: "maintenance", starts_at: "2026-11-02T06:00:00Z", ends_at: "2026-11-02T14:00:00Z" },
      ],
      SD.machines,
      SD.starts_at,
      SD.ends_at,
    );
    expect(hits.map((h) => h.label)).toEqual(["PO-12"]);
  });

  it("suggests each machine's next preventive job and its open backlog, not what is already in", () => {
    const got = suggestions(
      { ...SD, work_orders: [wo("WO-9")] },
      [
        fc({ schedule_id: "s1", due_on: "2026-12-10" }),
        fc({ schedule_id: "s2", asset_tag: "H2", work_order: "WO-7", due_on: "2026-10-30" }),
        fc({ schedule_id: "s3", occurrence: 1, due_on: "2026-11-10" }),
        fc({ schedule_id: "s4", due_on: "2027-03-01" }),
        fc({ schedule_id: "s5", asset_tag: "R9" }),
      ],
      [
        { num: "WO-7", workCenter: "H2", status: "Open" },
        { num: "WO-8", workCenter: "H1", title: "Fix guard", status: "Open", dueDate: "2026-10-25" },
        { num: "WO-9", workCenter: "H1", status: "Open" },
        { num: "WO-10", workCenter: "H1", status: "Completed" },
        { num: "WO-11", workCenter: "H1", status: "Open", shutdown: "SD-OTHER" },
      ],
    );
    expect(got).toEqual([
      { kind: "work-order", num: "WO-8", machine: "H1", title: "Fix guard", due: "2026-10-25", status: "Open" },
      { kind: "schedule", scheduleId: "s1", machine: "H1", title: "Quarterly", due: "2026-12-10", overdue: false },
      { kind: "work-order", num: "WO-7", machine: "H2", title: "Quarterly", due: "2026-10-30", status: "Open" },
    ]);
  });

  it("reads and writes window times in plant time", () => {
    expect(plantTime("2026-11-01T06:00")).toBe("2026-11-01T03:00:00.000Z");
    expect(localPlantTime("2026-11-01T03:00:00Z")).toBe("2026-11-01T06:00");
    expect(formatWindow(SD.starts_at, SD.ends_at)).toBe("2026-11-01 06:00 – 2026-11-03 18:00");
    expect(formatWindow("2026-11-01T03:00:00Z", "2026-11-01T11:00:00Z")).toBe("2026-11-01 06:00 – 14:00");
  });
});
