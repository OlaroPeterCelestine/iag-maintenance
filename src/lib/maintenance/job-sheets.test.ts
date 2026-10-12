import { describe, expect, it } from "vitest";
import { checkResults, emptyForm, planWrites, type JobContext, type ResultsForm } from "@/lib/maintenance/enter-results";
import { enterUrl, selectForPrint, sheetModel, stepsFrom } from "@/lib/maintenance/job-sheet";

const job = (over: Partial<JobContext> = {}): JobContext => ({
  num: "WO-7", title: "Huller bearing", machine: "H1", needsFailureCode: true,
  hasJobCard: false, alreadyCompleted: false, today: "2026-10-13", ...over,
});

function filled(): ResultsForm {
  const f = emptyForm(2, "2026-10-13");
  f.steps = [{ result: "Pass", reading: "", note: "" }, { result: "Fail", reading: "4.1", note: "Belt glazed" }];
  f.failure = { problem: "Bearing failure", cause: "Lack of lubrication", remedy: "Replaced part", note: "" };
  f.labour = [
    { technician: "Okello", date: "2026-10-13", start: "08:00", finish: "11:30", hours: "" },
    { technician: "Achan", date: "2026-10-13", start: "", finish: "", hours: "2" },
  ];
  f.parts = [{ part: "BRG-6205", qty: "2", store: "" }, { part: "", qty: "", store: "" }];
  f.workDone = "Replaced both bearings";
  f.meterReading = "1260";
  f.machineLeft = "Running";
  f.technicianSignedBy = "Okello";
  f.technicianSignedOn = "2026-10-13";
  return f;
}

describe("entering a job sheet", () => {
  it("accepts a complete sheet and writes it in the order MES needs", () => {
    const f = filled();
    expect(checkResults(f, job())).toEqual([]);
    const writes = planWrites(f, job());
    expect(writes.map((w) => w.section)).toEqual([
      "Checklist step 1", "Checklist step 2", "What failed", "Labour, work done and readings", "Parts line 1", "Sign-off",
    ]);
    // Steps are marked by the first technician on the sheet, not the clerk.
    expect(writes[1]).toMatchObject({ path: "/api/records/production/checklist-steps/WO-7%231", body: { result: "Fail", reading: "4.1", markedBy: "Okello" } });
    expect(writes[0].path).toBe("/api/records/production/checklist-steps/WO-7%230");
    const card = writes[3];
    expect(card).toMatchObject({ method: "POST", path: "/api/records/production/batch-records", body: { workOrder: "WO-7", technician: "Okello", meterReading: "1260", machineLeft: "Running" } });
    expect(JSON.parse(String(card.body.labour))).toHaveLength(2);
    expect(writes[5].body).toEqual({ technicianSignedBy: "Okello", technicianSignedOn: "2026-10-13", status: "Completed" });
  });

  it("edits the job card when there is one, instead of creating a second", () => {
    const w = planWrites(filled(), job({ hasJobCard: true })).find((x) => x.section.startsWith("Labour"))!;
    expect(w).toMatchObject({ method: "PATCH", path: "/api/records/production/batch-records/WO-7" });
  });

  it("names what is missing in the sheet's terms before saving anything", () => {
    const f = filled();
    f.steps[1].note = "";
    f.failure.cause = "";
    f.steps[0].result = "";
    f.technicianSignedBy = "";
    f.labour[1].technician = "";
    f.parts[0].qty = "0";
    const issues = checkResults(f, job());
    expect(issues).toEqual(expect.arrayContaining([
      "Checklist step 2 failed — write what was found in its note.",
      "What failed: tick a problem, a cause and a fix — all three.",
      "Labour line 2: who did the work?",
      "Parts line 1: a quantity of one or more.",
      "To complete the job, mark every checklist step (1 left).",
      "To complete the job, enter the technician's name from the sign-off box.",
    ]));
  });

  it("does not complete a job whose machine was left stopped, and refuses self-checking", () => {
    const f = filled();
    f.machineLeft = "Stopped";
    expect(checkResults(f, job())).toContain("The machine was left stopped — leave the job open rather than complete it.");
    const g = filled();
    g.supervisorCheckedBy = "okello";
    expect(checkResults(g, job())).toContain("The technician who did the work cannot also check it.");
  });

  it("raises a follow-up job when the sheet asks for one", () => {
    const f = filled();
    f.machineLeft = "Needs follow-up";
    f.followUp = "Order a new belt";
    const last = planWrites(f, job()).at(-1)!;
    expect(last).toMatchObject({ section: "Follow-up", method: "POST", path: "/api/records/production/work-orders", body: { workCenter: "H1", woType: "Corrective", description: "Order a new belt (from WO-7)" } });
  });

  it("on a completed job, only adds the supervisor's check", () => {
    const f = filled();
    f.supervisorCheckedBy = "Achan";
    const writes = planWrites(f, job({ alreadyCompleted: true }));
    expect(writes.some((w) => w.section.startsWith("Checklist"))).toBe(false);
    expect(writes.find((w) => w.section === "Sign-off")!.body).toEqual({ supervisorCheckedBy: "Achan", supervisorCheckedOn: "2026-10-13" });
  });

  it("gives every write a stable key, so a retry skips what already saved", () => {
    const a = planWrites(filled(), job()).map((w) => w.key);
    const b = planWrites(filled(), job()).map((w) => w.key);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe("printing job sheets", () => {
  const orders = [
    { num: "WO-10", status: "Open", assignee: "Okello", plannedStart: "2026-10-14", workCenter: "H1" },
    { num: "WO-2", status: "In Progress", assignee: "okello", plannedStart: "2026-10-14", workCenter: "P1" },
    { num: "WO-3", status: "Completed", assignee: "Okello", plannedStart: "2026-10-14", workCenter: "H1" },
    { num: "WO-4", status: "Open", assignee: "Achan", plannedStart: "2026-10-14", workCenter: "H1" },
  ];
  it("print a technician's live jobs for a day, in number order", () => {
    expect(selectForPrint(orders, { technician: "Okello", date: "2026-10-14" }).map((o) => o.num)).toEqual(["WO-2", "WO-10"]);
    expect(selectForPrint(orders, { nums: ["wo-3"] }).map((o) => o.num)).toEqual(["WO-3"]);
    expect(selectForPrint(orders, { factory: "mbale" }, new Map([["H1", "mbale"], ["P1", "kampala"]])).map((o) => o.num)).toEqual(["WO-4", "WO-10"]);
  });

  it("print the failure-code section only where MES needs it, and flag unapproved work", () => {
    expect(sheetModel({ woType: "Breakdown" }).needsFailureCode).toBe(true);
    expect(sheetModel({ woType: "Preventive" }).needsFailureCode).toBe(false);
    expect(sheetModel({ approval: "Waiting" }).notApproved).toBe(true);
    expect(sheetModel({ workCenter: "H1" }, { name: "Huller 1", plantCode: "mbale", section: "hulling" }).machineLine).toBe("Huller 1 (H1) · mbale / hulling");
  });

  it("read the checklist one step per line, numbered or not", () => {
    expect(stepsFrom("1. Grease bearings\n2) Check belt\n\n Measure vibration ")).toEqual(["Grease bearings", "Check belt", "Measure vibration"]);
    expect(enterUrl("https://x.app/", "WO-7")).toBe("https://x.app/work-orders/WO-7/enter");
  });
});
