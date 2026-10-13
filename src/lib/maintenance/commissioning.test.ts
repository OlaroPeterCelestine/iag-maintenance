/**
 * Commissioning on paper and on screen: acceptance tests with limits, and a
 * handover signed by the installer, engineering and production. iag-mes
 * enforces the same rules (installation.go); these catch them before a save
 * half-lands.
 */
import { describe, expect, it } from "vitest";
import { checkResults, emptyForm, planWrites, type JobContext, type ResultsForm } from "@/lib/maintenance/enter-results";
import { sheetModel } from "@/lib/maintenance/job-sheet";

const LIMITS = [null, { min: 10, max: 14, unit: "A" }, { max: 70, unit: "°C" }];

const job = (over: Partial<JobContext> = {}): JobContext => ({
  num: "WO-40",
  title: "Commission Huller 3",
  machine: "H3",
  needsFailureCode: false,
  hasJobCard: false,
  alreadyCompleted: false,
  today: "2026-10-13",
  limits: LIMITS,
  commissioning: true,
  ...over,
});

function passed(): ResultsForm {
  const f = emptyForm(3, "2026-10-13");
  f.steps = [
    { result: "Pass", reading: "", note: "" },
    { result: "Pass", reading: "12.4", note: "" },
    { result: "Pass", reading: "58", note: "" },
  ];
  f.handover = {
    installer: { by: "Odongo", on: "2026-10-12", company: "Agro Engineering" },
    engineering: { by: "Mukasa", on: "2026-10-13" },
    production: { by: "Achan", on: "2026-10-13" },
  };
  return f;
}

describe("a commissioning sheet", () => {
  it("prints tests with their limits and a three-party handover", () => {
    const sheet = sheetModel({
      num: "WO-40",
      woType: "Commissioning",
      workCenter: "H3",
      contractor: "Agro Engineering",
      checklist: "Guards fitted\nMotor current at full load [10–14 A]\nBearing temperature [max 70 °C]",
    });
    expect(sheet.commissioning).toBe(true);
    expect(sheet.steps).toEqual(["Guards fitted", "Motor current at full load", "Bearing temperature"]);
    expect(sheet.limits).toEqual(LIMITS);
    expect(sheet.contractor).toBe("Agro Engineering");
    expect(sheet.needsFailureCode).toBe(false);
  });

  it("accepts passed tests and a signed handover, and writes the handover before completion", () => {
    const f = passed();
    expect(checkResults(f, job())).toEqual([]);
    const writes = planWrites(f, job());
    expect(writes.map((w) => w.section)).toEqual(["Checklist step 1", "Checklist step 2", "Checklist step 3", "Sign-off"]);
    expect(writes[3].body).toEqual({
      installerSignedBy: "Odongo",
      installerSignedOn: "2026-10-12",
      installerCompany: "Agro Engineering",
      engineeringSignedBy: "Mukasa",
      engineeringSignedOn: "2026-10-13",
      productionSignedBy: "Achan",
      productionSignedOn: "2026-10-13",
      status: "Completed",
    });
    // No technician or supervisor: the handover stands in for both.
    expect(writes[3].body).not.toHaveProperty("technicianSignedBy");
  });

  it("refuses a pass the measurement contradicts, and a pass with no measurement", () => {
    const f = passed();
    f.steps[1].reading = "16";
    f.steps[2].reading = "";
    expect(checkResults(f, job())).toEqual([
      "Test 2 read 16, outside 10–14 A — mark it Fail.",
      "Test 3 passes on a measurement — enter what was measured (max 70 °C).",
    ]);
  });

  it("keeps acceptance off until every test has passed, and completion off while one has failed", () => {
    const f = passed();
    f.steps[1] = { result: "Fail", reading: "16", note: "Belt too tight" };
    expect(checkResults(f, job())).toEqual([
      "Handover: engineering and production accept the machine only when every test has passed — leave their names off for now.",
      "1 test failed — leave the job open, fix the machine and re-test.",
    ]);
    f.handover.engineering.by = "";
    f.handover.production.by = "";
    f.complete = false;
    expect(checkResults(f, job())).toEqual([]);
    // The installer's signature can go in now.
    expect(planWrites(f, job()).at(-1)?.body).toEqual({ installerSignedBy: "Odongo", installerSignedOn: "2026-10-12", installerCompany: "Agro Engineering" });
  });

  it("needs three different people, all three, and tests to run", () => {
    const f = passed();
    f.handover.production.by = "mukasa";
    expect(checkResults(f, job())).toContain("Handover: installer, engineering and production are three different people.");
    f.handover.production.by = "";
    expect(checkResults(f, job())).toContain("To complete commissioning, the handover needs production.");
    const none = emptyForm(0, "2026-10-13");
    none.handover = passed().handover;
    expect(checkResults(none, job({ limits: [] }))[0]).toMatch(/no acceptance tests/);
  });

  it("checks a reading against limits on an ordinary job too, but needs none", () => {
    const f = emptyForm(1, "2026-10-13");
    f.steps = [{ result: "Pass", reading: "", note: "" }];
    f.complete = false;
    const pm = job({ commissioning: false, limits: [{ max: 70, unit: "°C" }] });
    expect(checkResults(f, pm)).toEqual([]);
    f.steps[0].reading = "75";
    expect(checkResults(f, pm)).toEqual(["Checklist step 1 read 75, outside max 70 °C — mark it Fail."]);
  });
});
