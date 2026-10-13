/**
 * Printed maintenance job sheets, and the results that come back on them.
 *
 * The sheet and the entry screen are built from the same model, in the same
 * order, so a clerk reading down the paper types down the screen. Sections
 * print only when they apply: the failure code on breakdown and corrective
 * work (MES requires it there and nowhere else), the checklist when the job
 * has one.
 */
import { parseStep, type StepLimits } from "@/lib/maintenance/acceptance";
import type { Rec } from "@/lib/maintenance/machine-summary";

export const FAILURE_CODED = /^(breakdown|corrective)$/i;
/** A commissioning job: acceptance tests and a three-party handover. */
export const COMMISSIONING = /^commissioning$/i;
const LIVE = /^(draft|scheduled|open|in progress)$/i;

export type SheetModel = {
  num: string;
  title: string;
  type: string;
  priority: string;
  machineLine: string;
  machineTag: string;
  assignee: string;
  planned: string;
  due: string;
  raised: string;
  reportedBy: string;
  description: string;
  partsPlanned: string;
  estimatedHours: string;
  steps: string[];
  /** Each step's acceptance limits, by index (null: none). */
  limits: (StepLimits | null)[];
  commissioning: boolean;
  contractor: string;
  projectRef: string;
  needsFailureCode: boolean;
  notApproved: boolean;
  status: string;
};

/** The checklist as stored on the work order: one step per line. */
export function stepsFrom(text: string | undefined): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}

export function sheetModel(wo: Rec, machine?: Rec): SheetModel {
  const tag = String(wo.workCenter || "");
  const where = [machine?.plantCode, machine?.section, machine?.location].filter(Boolean).join(" / ");
  return {
    num: String(wo.num || wo.id || ""),
    title: String(wo.title || ""),
    type: String(wo.woType || ""),
    priority: String(wo.priority || ""),
    machineLine: `${machine?.name ? `${machine.name} (${tag})` : tag}${where ? ` · ${where}` : ""}`,
    machineTag: tag,
    assignee: String(wo.assignee || ""),
    planned: String(wo.plannedStart || ""),
    due: String(wo.dueDate || ""),
    raised: String(wo.date || ""),
    reportedBy: String(wo.reportedBy || ""),
    description: String(wo.description || ""),
    partsPlanned: String(wo.partsRequired || ""),
    estimatedHours: String(wo.estimatedHours || ""),
    steps: stepsFrom(wo.checklist).map((line) => parseStep(line).text),
    limits: stepsFrom(wo.checklist).map((line) => parseStep(line).limits),
    commissioning: COMMISSIONING.test(String(wo.woType || "")),
    contractor: String(wo.contractor || ""),
    projectRef: String(wo.projectRef || ""),
    needsFailureCode: FAILURE_CODED.test(String(wo.woType || "")),
    notApproved: /^(waiting|rejected)$/i.test(String(wo.approval || "")),
    status: String(wo.status || ""),
  };
}

/**
 * Which work orders to print: the numbers asked for, or a technician's
 * planned day (from the Planner), or everything live — never finished work.
 */
export function selectForPrint(
  orders: Rec[],
  q: { nums?: string[]; technician?: string; date?: string; factory?: string },
  plantOf: Map<string, string> = new Map(),
): Rec[] {
  const wanted = new Set((q.nums || []).map((n) => n.trim().toUpperCase()).filter(Boolean));
  return orders
    .filter((o) => (wanted.size ? wanted.has(String(o.num || "").toUpperCase()) : LIVE.test(String(o.status || "Open"))))
    .filter((o) => !q.technician || String(o.assignee || "").trim().toLowerCase() === q.technician.trim().toLowerCase())
    .filter((o) => !q.date || String(o.plannedStart || "").slice(0, 10) === q.date)
    .filter((o) => !q.factory || plantOf.get(String(o.workCenter || "")) === q.factory)
    .sort((a, b) => String(a.num || "").localeCompare(String(b.num || ""), undefined, { numeric: true }));
}

export function enterUrl(origin: string, num: string): string {
  return `${origin.replace(/\/$/, "")}/work-orders/${encodeURIComponent(num)}/enter`;
}
