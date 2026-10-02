import { describe, expect, it } from "vitest";
import { parseComponents, serialiseComponents } from "@/lib/iag/records/bom-lines";

describe("BOM components text ↔ lines", () => {
  it("parses the shapes the kit parser accepts, plus a trailing unit", () => {
    expect(parseComponents("Green AA x 118 kg; Kraft 500g × 200 pcs, Label")).toEqual([
      { component_item: "Green AA", qty: 118, unit: "kg" },
      { component_item: "Kraft 500g", qty: 200, unit: "pcs" },
      { component_item: "Label", qty: 1 },
    ]);
    expect(parseComponents("")).toEqual([]);
    expect(parseComponents("Nothing x 0")).toEqual([]);
  });

  it("round-trips through serialise", () => {
    const text = "Green AA x 118 kg; Kraft 500g x 200 pcs; Label x 1";
    expect(serialiseComponents(parseComponents(text))).toBe(text);
  });
});
