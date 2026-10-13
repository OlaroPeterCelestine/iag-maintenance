import { describe, expect, it } from "vitest";
import { formatStep, parseStep, stepForService, stepFromService, withinLimits } from "@/lib/maintenance/acceptance";

describe("acceptance limits on a checklist line", () => {
  it("reads a range, a maximum and a minimum", () => {
    expect(parseStep("Motor current at full load [10–14 A]")).toEqual({
      text: "Motor current at full load",
      limits: { min: 10, max: 14, unit: "A" },
    });
    expect(parseStep("Bearing temperature [max 70 °C]")).toEqual({ text: "Bearing temperature", limits: { max: 70, unit: "°C" } });
    expect(parseStep("Output [≥ 1200 kg/h]")).toEqual({ text: "Output", limits: { min: 1200, unit: "kg/h" } });
    expect(parseStep("Vibration [0.5 to 2.8 mm/s]").limits).toEqual({ min: 0.5, max: 2.8, unit: "mm/s" });
    expect(parseStep("Belt tension [14-10]").limits).toEqual({ min: 10, max: 14, unit: undefined });
  });

  it("leaves a line without limits alone, brackets included", () => {
    expect(parseStep("Guards fitted")).toEqual({ text: "Guards fitted", limits: null });
    expect(parseStep("Check fixings [see manual]")).toEqual({ text: "Check fixings [see manual]", limits: null });
    expect(parseStep("[10–14 A]")).toEqual({ text: "[10–14 A]", limits: null });
  });

  it("round-trips through the service's shape", () => {
    for (const line of ["Guards fitted", "Motor current [10–14 A]", "Bearing temperature [max 70 °C]", "Output [min 1200 kg/h]"]) {
      expect(stepFromService(stepForService(line))).toBe(line);
    }
    expect(stepForService("Motor current [10–14 A]")).toEqual({ step: "Motor current", min: 10, max: 14, unit: "A" });
    expect(stepFromService({ step: "Runs", min: "1", max: null })).toBe("Runs [min 1]");
    expect(stepFromService({ task: "Old-style step" })).toBe("Old-style step");
  });

  it("checks a reading", () => {
    const l = parseStep("x [10–14 A]").limits;
    expect(withinLimits(10, l)).toBe(true);
    expect(withinLimits(14.01, l)).toBe(false);
    expect(withinLimits(99, null)).toBe(true);
    expect(formatStep("x", { max: 3 })).toBe("x [max 3]");
  });
});
