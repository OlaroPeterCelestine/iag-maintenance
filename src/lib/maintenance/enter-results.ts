/**
 * Entering a printed job sheet: what to check before saving, and the writes
 * to make, in the order MES needs them. Pure, so the order and the checks are
 * tested without a browser.
 *
 * Order: checklist steps → failure code → job card (labour, work done,
 * readings) → parts booked out of stock → technician's signature, completion
 * and supervisor's check → a follow-up job if the sheet asks for one.
 *
 * A commissioning job has acceptance tests instead of a plain checklist (a
 * reading outside a test's limits is a fail) and a handover signed by the
 * installer, engineering and production instead of technician and supervisor.
 *
 * Each write has a key. The screen remembers which succeeded, and a retry
 * after a refusal skips them — a part booked out of stock is never booked
 * twice because the save stopped later on.
 */

import { formatLimits, withinLimits, type StepLimits } from "@/lib/maintenance/acceptance";

export type StepResult = "" | "Pass" | "Fail" | "N/A";

export type HandoverSigner = { by: string; on: string; company?: string };
export type Handover = { installer: HandoverSigner; engineering: HandoverSigner; production: HandoverSigner };

export type ResultsForm = {
  steps: { result: StepResult; reading: string; note: string }[];
  markedBy: string;
  workDone: string;
  failure: { problem: string; cause: string; remedy: string; note: string };
  labour: { technician: string; date: string; start: string; finish: string; hours: string }[];
  parts: { part: string; qty: string; store: string }[];
  otherParts: string;
  meterReading: string;
  contractorCost: string;
  machineLeft: "" | "Running" | "Stopped" | "Needs follow-up";
  followUp: string;
  technicianSignedBy: string;
  technicianSignedOn: string;
  supervisorCheckedBy: string;
  supervisorCheckedOn: string;
  /** Commissioning only. */
  handover: Handover;
  complete: boolean;
};

export type JobContext = {
  num: string;
  title: string;
  machine: string;
  needsFailureCode: boolean;
  hasJobCard: boolean;
  alreadyCompleted: boolean;
  today: string;
  /** Each step's acceptance limits (null: none). Missing means none at all. */
  limits?: (StepLimits | null)[];
  commissioning?: boolean;
};

export type Write = {
  key: string;
  /** The sheet section a refusal is reported against. */
  section: string;
  method: "POST" | "PATCH";
  path: string;
  body: Record<string, unknown>;
};

const RECORDS = "/api/records/production";

function filledLabour(f: ResultsForm) {
  return f.labour.filter((l) => l.technician.trim() || l.hours.trim() || l.start.trim() || l.finish.trim());
}

function filledParts(f: ResultsForm) {
  return f.parts.filter((p) => p.part.trim() || p.qty.trim());
}

/** What the sheet still needs, in the sheet's own words. Empty means save. */
export function checkResults(f: ResultsForm, job: JobContext): string[] {
  const issues: string[] = [];
  const word = job.commissioning ? "Test" : "Checklist step";
  f.steps.forEach((s, i) => {
    if (s.result === "Fail" && !s.note.trim()) issues.push(`${word} ${i + 1} failed — write what was found in its note.`);
    const reading = s.reading.trim();
    if (reading && !Number.isFinite(Number(reading))) {
      issues.push(`${word} ${i + 1}: the reading is a number.`);
      return;
    }
    const limits = job.limits?.[i] || null;
    if (!limits || s.result !== "Pass") return;
    if (!reading) {
      if (job.commissioning) issues.push(`Test ${i + 1} passes on a measurement — enter what was measured (${formatLimits(limits)}).`);
    } else if (!withinLimits(Number(reading), limits)) {
      issues.push(`${word} ${i + 1} read ${reading}, outside ${formatLimits(limits)} — mark it Fail.`);
    }
  });
  const fc = [f.failure.problem, f.failure.cause, f.failure.remedy].filter((v) => v.trim()).length;
  if (fc > 0 && fc < 3) issues.push("What failed: tick a problem, a cause and a fix — all three.");
  if ([f.failure.problem, f.failure.cause, f.failure.remedy].includes("Other") && !f.failure.note.trim()) {
    issues.push("What failed: \"Other\" needs a few words saying what it was.");
  }
  filledLabour(f).forEach((l, i) => {
    if (!l.technician.trim()) issues.push(`Labour line ${i + 1}: who did the work?`);
    if (!l.hours.trim() && !(l.start.trim() && l.finish.trim())) issues.push(`Labour line ${i + 1}: hours, or a start and finish.`);
  });
  filledParts(f).forEach((p, i) => {
    if (!p.part.trim()) issues.push(`Parts line ${i + 1}: which part?`);
    if (!(Number(p.qty) > 0)) issues.push(`Parts line ${i + 1}: a quantity of one or more.`);
  });
  if (f.meterReading.trim() && !(Number(f.meterReading) >= 0)) issues.push("The meter reading is a number of hours.");
  if (f.machineLeft === "Needs follow-up" && !f.followUp.trim()) issues.push("Machine needs follow-up — say what.");
  if (job.commissioning) issues.push(...checkHandover(f, job));
  if (f.complete && !job.alreadyCompleted) {
    const open = f.steps.filter((s) => !s.result).length;
    if (open) issues.push(`To complete the job, mark every ${job.commissioning ? "test" : "checklist step"} (${open} left).`);
    if (!job.commissioning && f.steps.length && !f.technicianSignedBy.trim()) {
      issues.push("To complete the job, enter the technician's name from the sign-off box.");
    }
    if (job.needsFailureCode && fc < 3) issues.push("To complete a breakdown or corrective job, fill in what failed.");
    if (f.machineLeft === "Stopped") issues.push("The machine was left stopped — leave the job open rather than complete it.");
  }
  if (f.supervisorCheckedBy.trim() && !f.complete && !job.alreadyCompleted) {
    issues.push("A supervisor checks completed work — complete the job to record the check.");
  }
  if (
    f.supervisorCheckedBy.trim() &&
    f.technicianSignedBy.trim() &&
    f.supervisorCheckedBy.trim().toLowerCase() === f.technicianSignedBy.trim().toLowerCase()
  ) {
    issues.push("The technician who did the work cannot also check it.");
  }
  return issues;
}

const PARTIES = [
  ["installer", "the installer"],
  ["engineering", "engineering"],
  ["production", "production"],
] as const;

/** The handover: three different people, and acceptance only of passed tests. */
function checkHandover(f: ResultsForm, job: JobContext): string[] {
  const issues: string[] = [];
  const names = PARTIES.map(([p]) => f.handover[p].by.trim().toLowerCase()).filter(Boolean);
  if (new Set(names).size < names.length) issues.push("Handover: installer, engineering and production are three different people.");
  const accepting = f.handover.engineering.by.trim() || f.handover.production.by.trim();
  const failed = f.steps.filter((s) => s.result === "Fail").length;
  const open = f.steps.filter((s) => !s.result).length;
  if (accepting && !job.alreadyCompleted && (failed || open)) {
    issues.push("Handover: engineering and production accept the machine only when every test has passed — leave their names off for now.");
  }
  if (f.complete && !job.alreadyCompleted) {
    if (!f.steps.length) issues.push("This commissioning job has no acceptance tests — add them to the job (Work Orders → checklist) before completing it.");
    if (failed) issues.push(`${failed} test${failed === 1 ? "" : "s"} failed — leave the job open, fix the machine and re-test.`);
    const missing = PARTIES.filter(([p]) => !f.handover[p].by.trim()).map(([, label]) => label);
    if (missing.length) issues.push(`To complete commissioning, the handover needs ${missing.join(", ")}.`);
  }
  return issues;
}

export function planWrites(f: ResultsForm, job: JobContext): Write[] {
  const writes: Write[] = [];
  const wo = encodeURIComponent(job.num);
  const firstTech = filledLabour(f)[0]?.technician.trim() || f.technicianSignedBy.trim();
  const markedBy = f.markedBy.trim() || firstTech;

  if (!job.alreadyCompleted) {
    f.steps.forEach((s, i) => {
      if (!s.result) return;
      writes.push({
        key: `step:${i}:${s.result}:${s.reading}:${s.note}`,
        section: `Checklist step ${i + 1}`,
        method: "PATCH",
        path: `${RECORDS}/checklist-steps/${encodeURIComponent(`${job.num}#${i}`)}`,
        body: { result: s.result, reading: s.reading.trim(), note: s.note.trim(), markedBy },
      });
    });
  }

  if (job.needsFailureCode && f.failure.problem && f.failure.cause && f.failure.remedy) {
    writes.push({
      key: `failure:${f.failure.problem}:${f.failure.cause}:${f.failure.remedy}:${f.failure.note}`,
      section: "What failed",
      method: "PATCH",
      path: `${RECORDS}/work-orders/${wo}`,
      body: {
        failureProblem: f.failure.problem,
        failureCause: f.failure.cause,
        failureRemedy: f.failure.remedy,
        failureNote: f.failure.note.trim(),
      },
    });
  }

  const labour = filledLabour(f).map((l) => ({
    technician: l.technician.trim(),
    date: l.date.trim() || job.today,
    start: l.start.trim(),
    finish: l.finish.trim(),
    hours: l.hours.trim(),
  }));
  const card: Record<string, unknown> = {
    workOrder: job.num,
    date: labour[0]?.date || job.today,
    technician: firstTech,
    labour: JSON.stringify(labour),
    workDone: f.workDone.trim(),
    partsUsed: f.otherParts.trim(),
    meterReading: f.meterReading.trim(),
    contractorCost: f.contractorCost.trim(),
    machineLeft: f.machineLeft,
    followUp: f.followUp.trim(),
  };
  const anyCard = labour.length || f.workDone.trim() || f.meterReading.trim() || f.contractorCost.trim() || f.machineLeft;
  if (anyCard) {
    writes.push({
      key: `card:${JSON.stringify(card)}`,
      section: "Labour, work done and readings",
      method: job.hasJobCard ? "PATCH" : "POST",
      path: job.hasJobCard ? `${RECORDS}/batch-records/${wo}` : `${RECORDS}/batch-records`,
      body: card,
    });
  }

  filledParts(f).forEach((p, i) => {
    writes.push({
      key: `part:${i}:${p.part.trim()}:${p.qty.trim()}:${p.store.trim()}`,
      section: `Parts line ${i + 1}`,
      method: "POST",
      path: `${RECORDS}/parts-used`,
      body: { workOrder: job.num, part: p.part.trim(), qty: p.qty.trim(), store: p.store.trim(), technician: firstTech },
    });
  });

  const close: Record<string, unknown> = {};
  if (job.commissioning && !job.alreadyCompleted) {
    for (const [p] of PARTIES) {
      const signer = f.handover[p];
      if (!signer.by.trim()) continue;
      close[`${p}SignedBy`] = signer.by.trim();
      close[`${p}SignedOn`] = signer.on.trim();
      if (p === "installer" && signer.company?.trim()) close.installerCompany = signer.company.trim();
    }
  }
  if (!job.commissioning && !job.alreadyCompleted && f.technicianSignedBy.trim()) {
    close.technicianSignedBy = f.technicianSignedBy.trim();
    close.technicianSignedOn = f.technicianSignedOn.trim();
  }
  if (!job.alreadyCompleted && f.complete) close.status = "Completed";
  if (!job.commissioning && f.supervisorCheckedBy.trim()) {
    close.supervisorCheckedBy = f.supervisorCheckedBy.trim();
    close.supervisorCheckedOn = f.supervisorCheckedOn.trim();
  }
  if (Object.keys(close).length) {
    writes.push({
      key: `close:${JSON.stringify(close)}`,
      section: "Sign-off",
      method: "PATCH",
      path: `${RECORDS}/work-orders/${wo}`,
      body: close,
    });
  }

  if (f.machineLeft === "Needs follow-up" && f.followUp.trim()) {
    writes.push({
      key: `followup:${f.followUp.trim()}`,
      section: "Follow-up",
      method: "POST",
      path: `${RECORDS}/work-orders`,
      body: {
        title: `Follow-up: ${job.title}`.slice(0, 200),
        workCenter: job.machine,
        woType: "Corrective",
        priority: "Medium",
        status: "Open",
        description: `${f.followUp.trim()} (from ${job.num})`,
      },
    });
  }
  return writes;
}

export function emptyForm(stepCount: number, today: string): ResultsForm {
  return {
    steps: Array.from({ length: stepCount }, () => ({ result: "" as StepResult, reading: "", note: "" })),
    markedBy: "",
    workDone: "",
    failure: { problem: "", cause: "", remedy: "", note: "" },
    labour: [{ technician: "", date: today, start: "", finish: "", hours: "" }],
    parts: [{ part: "", qty: "", store: "" }],
    otherParts: "",
    meterReading: "",
    contractorCost: "",
    machineLeft: "",
    followUp: "",
    technicianSignedBy: "",
    technicianSignedOn: today,
    supervisorCheckedBy: "",
    supervisorCheckedOn: today,
    handover: {
      installer: { by: "", on: today, company: "" },
      engineering: { by: "", on: today },
      production: { by: "", on: today },
    },
    complete: true,
  };
}
