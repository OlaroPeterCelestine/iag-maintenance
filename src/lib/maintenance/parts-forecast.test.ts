import { describe, expect, it } from "vitest";
import type { ForecastItem } from "@/lib/maintenance/calendar";
import { partsForecast, requestRef } from "@/lib/maintenance/parts-forecast";
import { formatParts, parsePartsText } from "@/lib/maintenance/planned-parts";

const job = (due_on: string, parts: { sku: string; qty: number }[], over: Partial<ForecastItem> = {}): ForecastItem => ({
  schedule_id: "s1",
  template_id: "t1",
  template_code: "PM-B",
  template_name: "Bearings",
  asset_tag: "H1",
  asset_name: "Huller 1",
  plant_code: "mbale",
  section_code: "MILL",
  due_on,
  basis: "days",
  estimated: false,
  overdue: false,
  occurrence: 0,
  fixed_dates: true,
  parts,
  ...over,
});

const TODAY = "2026-10-13";

describe("the parts forecast", () => {
  it("finds the first job free stock does not cover and works back a lead time", () => {
    const rows = partsForecast(
      [
        job("2026-11-01", [{ sku: "BRG-6205", qty: 2 }]),
        job("2026-12-01", [{ sku: "BRG-6205", qty: 2 }], { asset_tag: "H2" }),
        job("2027-01-01", [{ sku: "brg-6205", qty: 2 }]),
      ],
      [{ code: "BRG-6205", name: "Bearing 6205", unit: "ea", onHand: "6", reorderLevel: "2", leadTimeDays: "21" }],
      TODAY,
    );
    expect(rows).toHaveLength(1);
    // 4 free (6 on hand, 2 kept back): November and December are covered,
    // January is not; ordered 21 days before.
    expect(rows[0]).toMatchObject({
      sku: "BRG-6205",
      free: 4,
      needed: 6,
      jobs: 3,
      machines: 2,
      shortfallOn: "2027-01-01",
      shortfall: 2,
      leadDays: 21,
      leadKnown: true,
      orderBy: "2026-12-11",
      status: "order-later",
    });
    expect(requestRef(rows[0])).toBe("PF-BRG-6205-20270101");
  });

  it("says order now, late, covered and unknown, most urgent first", () => {
    const rows = partsForecast(
      [
        job("2026-10-20", [{ sku: "LATE", qty: 1 }]),
        job("2026-11-05", [{ sku: "SOON", qty: 1 }]),
        job("2026-11-05", [{ sku: "PLENTY", qty: 1 }]),
        job("2026-11-05", [{ sku: "NOPE", qty: 1 }]),
      ],
      [
        { code: "LATE", onHand: 0 },
        { code: "SOON", onHand: 0, leadTimeDays: "" },
        { code: "PLENTY", onHand: 10, reorderLevel: 2 },
      ],
      TODAY,
    );
    expect(rows.map((r) => [r.sku, r.status])).toEqual([
      ["LATE", "late"],
      ["SOON", "order-now"],
      ["NOPE", "unknown-part"],
      ["PLENTY", "covered"],
    ]);
    // No lead time recorded: 14 days assumed, and said so.
    expect(rows[1]).toMatchObject({ leadDays: 14, leadKnown: false, orderBy: "2026-10-22" });
  });

  it("does not let stock below the reorder level count as free", () => {
    const [row] = partsForecast([job("2027-03-01", [{ sku: "B", qty: 1 }])], [{ code: "B", onHand: 1, reorderLevel: 3 }], TODAY);
    expect(row).toMatchObject({ free: 0, shortfall: 1, shortfallOn: "2027-03-01" });
  });
});

describe("parts per job on a template", () => {
  it("reads the ways a fitter writes a part line, and adds up repeats", () => {
    expect(parsePartsText("BRG-6205 × 2\n2 x BELT-A\nGREASE-1 0.5\nSEAL-9\n- brg-6205 x 1")).toEqual([
      { sku: "BRG-6205", qty: 3 },
      { sku: "BELT-A", qty: 2 },
      { sku: "GREASE-1", qty: 0.5 },
      { sku: "SEAL-9", qty: 1 },
    ]);
    expect(formatParts([{ sku: "BRG-6205", qty: 3 }, { sku: "", qty: 1 }])).toBe("BRG-6205 × 3");
    expect(() => parsePartsText("two bearings please")).toThrow(/not a part line/);
    expect(() => parsePartsText("X × 0")).toThrow(/above 0/);
  });
});
