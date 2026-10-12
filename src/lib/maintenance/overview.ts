/**
 * The maintenance overview: the figures a maintenance manager is asked for,
 * computed from the app's own record lists. Pure — the API route loads the
 * lists, this decides what they mean — so every definition below is tested.
 *
 * Definitions (all over the last 90 days unless said otherwise):
 *   PM compliance   preventive jobs completed on or before their due date,
 *                   of preventive jobs completed
 *   Planned share   preventive, inspection and overhaul jobs, of all jobs raised
 *                   (breakdown and corrective are reactive)
 *   Backlog age     live jobs by days since raised
 *   MTBF / MTTR     the mean across machines that have a figure
 */
import type { Rec } from "@/lib/maintenance/machine-summary";

export type MaintenanceOverview = {
  generatedAt: string;
  factory: string;
  tiles: {
    openWorkOrders: number;
    machinesStopped: number;
    faultReportsWaiting: number;
    overduePm: number;
    pmCompliancePct: number | null;
    pmCompletedInWindow: number;
    plannedSharePct: number | null;
    mtbfHours: number | null;
    mttrHours: number | null;
    partsLow: number;
    costThisMonth: number | null;
    costThisMonthComplete: boolean;
  };
  weekly: { week: string; planned: number; reactive: number }[];
  backlog: { bucket: string; jobs: number }[];
  causes: { label: string; failures: number }[];
  cost: { month: string; labour: number; parts: number; contractor: number; complete: boolean }[];
};

const PLANNED = /^(preventive|inspection|overhaul)$/i;
const REACTIVE = /^(breakdown|corrective)$/i;
const LIVE = /^(draft|scheduled|open|in progress)$/i;
const DAY = 86_400_000;
export const WINDOW_DAYS = 90;
export const BACKLOG_BUCKETS = ["0–7 days", "8–30 days", "31–90 days", "Over 90 days"] as const;

function num(v: unknown): number | null {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function day(v: unknown): string {
  const s = String(v ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week holding `d` (UTC). */
export function weekStart(d: Date): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7));
  return iso(copy);
}

export function backlogBucket(ageDays: number): (typeof BACKLOG_BUCKETS)[number] {
  if (ageDays <= 7) return BACKLOG_BUCKETS[0];
  if (ageDays <= 30) return BACKLOG_BUCKETS[1];
  if (ageDays <= 90) return BACKLOG_BUCKETS[2];
  return BACKLOG_BUCKETS[3];
}

function mean(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null && x > 0);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

export type OverviewLists = {
  workOrders: Rec[];
  machines: Rec[];
  faultReports: Rec[];
  schedules: Rec[];
  spareParts: Rec[];
  reliability: Rec[];
  failureCauses: Rec[];
  machineCosts: Rec[];
};

export function buildMaintenanceOverview(
  lists: OverviewLists,
  opts: { factory?: string; now?: Date } = {},
): MaintenanceOverview {
  const now = opts.now ?? new Date();
  const factory = (opts.factory || "").trim();
  const plantOf = new Map(lists.machines.map((m) => [String(m.code || m.id || ""), String(m.plantCode || "")]));
  // A row naming no machine cannot be placed in a factory, so with a factory
  // chosen it is left out rather than counted everywhere.
  const scoped = (rows: Rec[]) =>
    factory ? rows.filter((r) => plantOf.get(String(r.workCenter || r.scope || "")) === factory) : rows;

  const machines = factory ? lists.machines.filter((m) => String(m.plantCode || "") === factory) : lists.machines;
  const orders = scoped(lists.workOrders);
  const windowStart = iso(new Date(now.getTime() - WINDOW_DAYS * DAY));

  const live = orders.filter((o) => LIVE.test(String(o.status || "Open")));

  // PM compliance: completed preventive jobs in the window, on time or not.
  const pmDone = orders.filter(
    (o) => /^preventive$/i.test(String(o.woType || "")) && /^completed$/i.test(String(o.status || "")) && day(o.completedOn) >= windowStart,
  );
  const onTime = pmDone.filter((o) => !day(o.dueDate) || day(o.completedOn) <= day(o.dueDate));
  const pmCompliancePct = pmDone.length ? Math.round((onTime.length / pmDone.length) * 100) : null;

  const raised = orders.filter((o) => day(o.date) >= windowStart);
  const planned = raised.filter((o) => PLANNED.test(String(o.woType || ""))).length;
  const reactive = raised.filter((o) => REACTIVE.test(String(o.woType || ""))).length;
  const plannedSharePct = planned + reactive ? Math.round((planned / (planned + reactive)) * 100) : null;

  // Twelve weeks of jobs raised, planned against reactive.
  const weeks: string[] = [];
  for (let i = 11; i >= 0; i--) weeks.push(weekStart(new Date(now.getTime() - i * 7 * DAY)));
  const weekly = weeks.map((week) => ({ week, planned: 0, reactive: 0 }));
  const byWeek = new Map(weekly.map((w) => [w.week, w]));
  for (const o of orders) {
    const d = day(o.date);
    if (!d) continue;
    const w = byWeek.get(weekStart(new Date(`${d}T00:00:00Z`)));
    if (!w) continue;
    if (PLANNED.test(String(o.woType || ""))) w.planned++;
    else if (REACTIVE.test(String(o.woType || ""))) w.reactive++;
  }

  const backlogCounts = new Map<string, number>(BACKLOG_BUCKETS.map((b) => [b, 0]));
  for (const o of live) {
    const d = day(o.date);
    if (!d) continue;
    const age = Math.max(0, Math.floor((now.getTime() - new Date(`${d}T00:00:00Z`).getTime()) / DAY));
    const b = backlogBucket(age);
    backlogCounts.set(b, (backlogCounts.get(b) || 0) + 1);
  }

  const reliability = scoped(lists.reliability);
  const costs = factory ? lists.machineCosts.filter((r) => String(r.plantCode || "") === factory) : lists.machineCosts;
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(iso(d).slice(0, 7));
  }
  const cost = months.map((month) => {
    const rows = costs.filter((r) => String(r.month || "") === month);
    return {
      month,
      labour: rows.reduce((a, r) => a + (num(r.labourCost) || 0), 0),
      parts: rows.reduce((a, r) => a + (num(r.partsCost) || 0), 0),
      contractor: rows.reduce((a, r) => a + (num(r.contractorCost) || 0), 0),
      complete: rows.every((r) => num(r.totalCost) !== null),
    };
  });
  const thisMonth = cost[cost.length - 1];
  const thisMonthRows = costs.filter((r) => String(r.month || "") === thisMonth.month);

  const reports = scoped(lists.faultReports);

  return {
    generatedAt: now.toISOString(),
    factory,
    tiles: {
      openWorkOrders: live.length,
      machinesStopped: machines.filter((m) => /down|maintenance/i.test(String(m.status || ""))).length,
      faultReportsWaiting: reports.filter((r) => /^(new|seen)$/i.test(String(r.status || ""))).length,
      overduePm: scoped(lists.schedules).filter((s) => /overdue/i.test(String(s.status || ""))).length,
      pmCompliancePct,
      pmCompletedInWindow: pmDone.length,
      plannedSharePct,
      mtbfHours: mean(reliability.map((r) => num(r.mtbfHours))),
      mttrHours: mean(reliability.map((r) => num(r.mttrHours))),
      partsLow: lists.spareParts.filter((p) => /^(low|out)$/i.test(String(p.stockLevel || ""))).length,
      costThisMonth: thisMonthRows.length ? thisMonth.labour + thisMonth.parts + thisMonth.contractor : null,
      costThisMonthComplete: thisMonth.complete,
    },
    weekly,
    backlog: BACKLOG_BUCKETS.map((bucket) => ({ bucket, jobs: backlogCounts.get(bucket) || 0 })),
    causes: lists.failureCauses
      .slice(0, 8)
      .map((c) => ({ label: `${c.problem} — ${c.cause}`, failures: num(c.failures) || 0 })),
    cost,
  };
}
