import { describe, expect, it } from "vitest";
import { backlogBucket, buildMaintenanceOverview, weekStart, type OverviewLists } from "@/lib/maintenance/overview";
import { plannedLevel, pmLevel } from "@/components/maintenance-overview/maintenance-overview";

const now = new Date("2026-10-13T09:00:00Z");

function lists(over: Partial<OverviewLists> = {}): OverviewLists {
  return {
    workOrders: [],
    machines: [
      { code: "H1", plantCode: "mbale", status: "Down" },
      { code: "P1", plantCode: "kampala", status: "Running" },
    ],
    faultReports: [],
    schedules: [],
    spareParts: [],
    reliability: [],
    failureCauses: [],
    machineCosts: [],
    ...over,
  };
}

describe("maintenance overview", () => {
  it("counts PM on time against PM completed in the last 90 days", () => {
    const o = buildMaintenanceOverview(
      lists({
        workOrders: [
          { woType: "Preventive", status: "Completed", completedOn: "2026-10-01", dueDate: "2026-10-02", workCenter: "H1" },
          { woType: "Preventive", status: "Completed", completedOn: "2026-10-05", dueDate: "2026-10-01", workCenter: "H1" }, // late
          { woType: "Preventive", status: "Completed", completedOn: "2026-05-01", dueDate: "2026-05-02", workCenter: "H1" }, // outside
          { woType: "Breakdown", status: "Completed", completedOn: "2026-10-02", workCenter: "H1" },
        ],
      }),
      { now },
    );
    expect(o.tiles.pmCompliancePct).toBe(50);
    expect(o.tiles.pmCompletedInWindow).toBe(2);
  });

  it("splits work raised into planned and reactive, by share and by week", () => {
    const o = buildMaintenanceOverview(
      lists({
        workOrders: [
          { woType: "Preventive", status: "Open", date: "2026-10-12", workCenter: "H1" },
          { woType: "Inspection", status: "Open", date: "2026-10-12", workCenter: "H1" },
          { woType: "Overhaul", status: "Open", date: "2026-10-06", workCenter: "H1" },
          { woType: "Breakdown", status: "Open", date: "2026-10-13", workCenter: "P1" },
        ],
      }),
      { now },
    );
    expect(o.tiles.plannedSharePct).toBe(75);
    expect(o.weekly).toHaveLength(12);
    expect(o.weekly.at(-1)).toEqual({ week: "2026-10-12", planned: 2, reactive: 1 });
    expect(o.weekly.at(-2)).toEqual({ week: "2026-10-05", planned: 1, reactive: 0 });
  });

  it("ages the live backlog and leaves finished work out", () => {
    const o = buildMaintenanceOverview(
      lists({
        workOrders: [
          { status: "Open", date: "2026-10-10", workCenter: "H1" },
          { status: "In Progress", date: "2026-09-20", workCenter: "H1" },
          { status: "Scheduled", date: "2026-06-01", workCenter: "H1" },
          { status: "Completed", date: "2026-06-01", workCenter: "H1" },
        ],
      }),
      { now },
    );
    expect(o.backlog.map((b) => b.jobs)).toEqual([1, 1, 0, 1]);
    expect(o.tiles.openWorkOrders).toBe(3);
  });

  it("narrows everything to one factory through each job's machine", () => {
    const o = buildMaintenanceOverview(
      lists({
        workOrders: [
          { status: "Open", date: "2026-10-10", workCenter: "H1" },
          { status: "Open", date: "2026-10-10", workCenter: "P1" },
          { status: "Open", date: "2026-10-10" }, // no machine: cannot be placed
        ],
        faultReports: [{ status: "New", workCenter: "P1" }],
      }),
      { now, factory: "mbale" },
    );
    expect(o.tiles.openWorkOrders).toBe(1);
    expect(o.tiles.machinesStopped).toBe(1);
    expect(o.tiles.faultReportsWaiting).toBe(0);
  });

  it("totals six months of cost and says when this month has gaps", () => {
    const o = buildMaintenanceOverview(
      lists({
        machineCosts: [
          { month: "2026-10", plantCode: "mbale", labourCost: "40,000", partsCost: "30,000", contractorCost: "50,000", totalCost: "120,000" },
          { month: "2026-10", plantCode: "mbale", labourCost: "", partsCost: "7,000", contractorCost: "0", totalCost: "" },
          { month: "2026-08", plantCode: "mbale", labourCost: "10,000", partsCost: "0", contractorCost: "0", totalCost: "10,000" },
        ],
      }),
      { now },
    );
    expect(o.cost.map((c) => c.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(o.tiles.costThisMonth).toBe(127000);
    expect(o.tiles.costThisMonthComplete).toBe(false);
    expect(o.cost[3]).toMatchObject({ labour: 10000, complete: true });
  });

  it("says nothing rather than zero when there is nothing to measure", () => {
    const o = buildMaintenanceOverview(lists(), { now });
    expect(o.tiles.pmCompliancePct).toBeNull();
    expect(o.tiles.plannedSharePct).toBeNull();
    expect(o.tiles.costThisMonth).toBeNull();
    expect(o.tiles.mtbfHours).toBeNull();
  });

  it("averages MTBF and MTTR over machines that have one", () => {
    const o = buildMaintenanceOverview(
      lists({ reliability: [{ workCenter: "H1", mtbfHours: "100", mttrHours: "2" }, { workCenter: "P1", mtbfHours: "", mttrHours: "4" }] }),
      { now },
    );
    expect(o.tiles.mtbfHours).toBe(100);
    expect(o.tiles.mttrHours).toBe(3);
  });

  it("buckets ages and weeks at their edges", () => {
    expect([0, 7, 8, 30, 31, 90, 91].map(backlogBucket)).toEqual([
      "0–7 days", "0–7 days", "8–30 days", "8–30 days", "31–90 days", "31–90 days", "Over 90 days",
    ]);
    expect(weekStart(new Date("2026-10-18T23:00:00Z"))).toBe("2026-10-12"); // Sunday
  });
});

describe("targets", () => {
  it("grade PM on time and planned share", () => {
    expect([95, 80, 60].map(pmLevel)).toEqual(["good", "warning", "critical"]);
    expect([75, 55, 40].map(plannedLevel)).toEqual(["good", "warning", "critical"]);
  });
});
