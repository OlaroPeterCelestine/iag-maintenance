import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  mondayOf,
  personHours,
  shiftMonths,
  weeksBetween,
  weeklyCapacity,
  yearFrom,
  type ForecastItem,
} from "@/lib/maintenance/calendar";

const item = (over: Partial<ForecastItem>): ForecastItem => ({
  schedule_id: "s1",
  template_id: "t1",
  template_code: "PM-M",
  template_name: "Monthly",
  asset_tag: "H1",
  asset_name: "Huller 1",
  plant_code: "mbale",
  section_code: "MILL",
  due_on: "2026-01-07",
  basis: "days",
  estimated: false,
  overdue: false,
  occurrence: 0,
  fixed_dates: true,
  ...over,
});

describe("the annual calendar", () => {
  it("lays weeks Monday to Sunday, each in the month of its Thursday", () => {
    expect(mondayOf("2026-01-01")).toBe("2025-12-29");
    expect(mondayOf("2026-01-05")).toBe("2026-01-05");
    const weeks = weeksBetween("2026-01-01", "2026-12-31");
    expect(weeks).toHaveLength(53);
    expect(weeks[0]).toEqual({ start: "2025-12-29", end: "2026-01-04", month: "Jan 2026", label: "29" });
    expect(weeks.at(-1)?.start).toBe("2026-12-28");
  });

  it("puts each job in its machine's row and week, and adds up the load in person-hours", () => {
    const cal = buildCalendar({
      from: "2026-01-01",
      to: "2026-03-31",
      items: [
        item({ due_on: "2026-01-07", estimated_hours: 3, crew_size: 2 }),
        item({ due_on: "2026-01-08", asset_tag: "A2", asset_name: "Aspirator", template_code: "PM-W" }),
        item({ due_on: "2026-02-06", occurrence: 1 }),
        item({ due_on: "2025-12-20", overdue: true, asset_tag: "R1", plant_code: "kampala", section_code: "ROAST" }),
        item({ due_on: "2026-06-01" }),
      ],
    });
    expect(cal.rows.map((r) => r.tag)).toEqual(["R1", "A2", "H1"]);
    const h1 = cal.rows.find((r) => r.tag === "H1")!;
    expect([...h1.cells.keys()]).toEqual(["2026-01-05", "2026-02-02"]);
    // 3 h × 2 people, plus an unestimated job at the default 2 h.
    expect(cal.load.get("2026-01-05")).toEqual({ hours: 8, jobs: 2, unestimated: 1, overdue: 0 });
    // The overdue job from before the range sits in the first week.
    expect(cal.rows[0].cells.get("2025-12-29")?.[0].overdue).toBe(true);
    // The week of 30 March has its Thursday in April.
    expect(cal.months.map((m) => m.month)).toEqual(["Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026"]);
    expect(cal.months.reduce((n, m) => n + m.weeks, 0)).toBe(cal.weeks.length);
  });

  it("narrows to one shop floor", () => {
    const cal = buildCalendar(
      { from: "2026-01-01", to: "2026-01-31", items: [item({}), item({ asset_tag: "R1", section_code: "ROAST" })] },
      { section: "ROAST" },
    );
    expect(cal.rows.map((r) => r.tag)).toEqual(["R1"]);
  });

  it("counts hours and capacity", () => {
    expect(personHours(item({ estimated_hours: 1.5 }))).toEqual({ hours: 1.5, estimated: true });
    expect(personHours(item({ crew_size: 3 }))).toEqual({ hours: 6, estimated: false });
    expect(weeklyCapacity(3)).toBe(120);
  });

  it("starts a year on the first of the month", () => {
    expect(yearFrom("2026-10-13")).toEqual({ from: "2026-10-01", to: "2027-09-30" });
    expect(shiftMonths("2026-10-13", 3)).toBe("2027-01-01");
    expect(shiftMonths("2026-01-31", -1)).toBe("2025-12-01");
  });
});
