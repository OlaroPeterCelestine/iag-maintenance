import { describe, expect, it } from "vitest";
import { machineUrl, qrSvg } from "@/lib/maintenance/qr";
import { forMachine, isOpen, partsOf, warrantyState, yearToDateCost } from "@/lib/maintenance/machine-summary";
import { cellLoad, layoutBoard, shiftWeek, weekOf } from "@/lib/maintenance/planner";

describe("QR labels", () => {
  it("point at the machine's page and draw an SVG", () => {
    expect(machineUrl("https://iag-maintenance.vercel.app/", "H 1")).toBe("https://iag-maintenance.vercel.app/machines/H%201");
    const svg = qrSvg("https://iag-maintenance.vercel.app/machines/H1");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
  });
});

describe("machine page", () => {
  it("counts open work in the floor's terms", () => {
    expect(isOpen({ status: "In Progress" })).toBe(true);
    expect(isOpen({ status: "Completed" })).toBe(false);
    expect(isOpen({ status: "No work needed" })).toBe(false);
    expect(forMachine([{ workCenter: "h1" }, { workCenter: "P1" }], "H1")).toHaveLength(1);
  });

  it("says when a warranty has ended or is about to", () => {
    const today = new Date("2026-10-12T10:00:00");
    expect(warrantyState("2026-10-01", today)).toBe("Expired");
    expect(warrantyState("2026-10-30", today)).toBe("Ending soon");
    expect(warrantyState("2027-06-30", today)).toBe("In warranty");
    expect(warrantyState("soon", today)).toBe("");
  });

  it("lists the machines that are part of this one", () => {
    expect(partsOf([{ code: "M1", parentMachine: "H1" }, { code: "M2" }], "h1").map((m) => m.code)).toEqual(["M1"]);
  });

  it("adds up this year's cost and says when a month is incomplete", () => {
    const rows = [
      { workCenter: "H1", month: "2026-09", totalCost: "120,000" },
      { workCenter: "H1", month: "2026-10", totalCost: "" },
      { workCenter: "H1", month: "2025-12", totalCost: "999" },
    ];
    expect(yearToDateCost(rows, "H1", 2026)).toEqual({ total: 120000, complete: false });
  });
});

describe("planner", () => {
  it("knows the week, Monday first, across a month end", () => {
    expect(weekOf("2026-10-01")).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
    expect(weekOf("2026-10-04")[0]).toBe("2026-09-28"); // Sunday belongs to the week before
    expect(shiftWeek("2026-10-01", 1)).toBe("2026-10-08");
  });

  it("puts planned jobs in their cell and the rest in the backlog", () => {
    const days = weekOf("2026-10-12");
    const board = layoutBoard(
      [
        { id: "1", num: "WO-1", status: "Open", assignee: "Okello", plannedStart: "2026-10-13" },
        { id: "2", num: "WO-2", status: "Open", plannedStart: "2026-10-14" },
        { id: "3", num: "WO-3", status: "Open" },
        { id: "4", num: "WO-4", status: "In Progress", plannedStart: "2026-10-01" }, // overdue planning
        { id: "5", num: "WO-5", status: "Completed", plannedStart: "2026-10-13" },
        { id: "6", num: "WO-6", status: "Open", plannedStart: "2026-11-02" }, // a later week
      ],
      ["Achan"],
      days,
    );
    expect(board.cells.get("Okello|2026-10-13")?.map((o) => o.num)).toEqual(["WO-1"]);
    expect(board.cells.get("|2026-10-14")?.map((o) => o.num)).toEqual(["WO-2"]);
    expect(board.backlog.map((o) => o.num)).toEqual(["WO-4", "WO-3"]);
    // Rows: everyone listed or holding a job, then Unassigned.
    expect(board.technicians).toEqual(["Achan", "Okello", ""]);
  });

  it("marks a day over a shift as overbooked, counting unestimated jobs", () => {
    expect(cellLoad([{ estimatedHours: "6" }, { estimatedHours: "" }])).toEqual({ hours: 8, unestimated: 1, over: false });
    expect(cellLoad([{ estimatedHours: "6" }, { estimatedHours: "3" }]).over).toBe(true);
  });
});
