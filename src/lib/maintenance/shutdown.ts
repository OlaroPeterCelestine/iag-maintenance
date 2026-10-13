/**
 * Planning a shutdown: what to put in it, whether there are people and parts
 * for it, and what production it stops. The shutdown itself lives in iag-mes
 * (internal/store/shutdown.go): a window, its machines, a planned stop on
 * each, and the work orders tagged to it.
 *
 * Pure, so the arithmetic and the suggestions are tested without a browser.
 */
import type { ForecastItem } from "@/lib/maintenance/calendar";
import { DEFAULT_JOB_HOURS } from "@/lib/maintenance/calendar";
import { DAY_CAPACITY_HOURS } from "@/lib/maintenance/planner";

type Row = Record<string, unknown>;

export type ShutdownStatus = "planned" | "in_progress" | "completed" | "cancelled";

export type Shutdown = {
  code: string;
  plant_code: string;
  title: string;
  starts_at: string;
  ends_at: string;
  lead: string;
  notes?: string;
  status: ShutdownStatus;
  machines: string[];
  production_agreed?: { by?: string; at?: string; entered_by?: string } | null;
  created_by: string;
  started_at?: string;
  finished_at?: string;
  jobs: number;
  open_jobs: number;
};

export type ShutdownStop = {
  id: string;
  asset_tag: string;
  state: "scheduled" | "open" | "closed" | "cancelled";
  started_at: string;
  ended_at?: string;
  planned_start?: string;
  planned_end?: string;
};

export type ShutdownWorkOrder = {
  num: string;
  title: string;
  asset_tag: string;
  wo_type: string;
  status: string;
  assignee?: string | null;
  attrs?: Row;
};

export type ShutdownDetail = Shutdown & { stops: ShutdownStop[]; work_orders: ShutdownWorkOrder[] };

export const STATUS_LABEL: Record<ShutdownStatus, string> = {
  planned: "Planned",
  in_progress: "Running",
  completed: "Finished",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<ShutdownStatus, string> = {
  planned: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  in_progress: "bg-amber-500 text-black",
  completed: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  cancelled: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const LIVE = (status: string) => status !== "completed" && status !== "cancelled";

/** The window in days, part days counting whole — the days people are needed. */
export function windowDays(startsAt: string, endsAt: string): number {
  const ms = Date.parse(endsAt) - Date.parse(startsAt);
  return ms > 0 ? Math.max(1, Math.ceil(ms / 86_400_000)) : 0;
}

export function jobHours(wo: ShutdownWorkOrder): { hours: number; estimated: boolean } {
  const h = Number(String((wo.attrs || {}).estimatedHours ?? "").replace(/,/g, ""));
  return h > 0 ? { hours: h, estimated: true } : { hours: DEFAULT_JOB_HOURS, estimated: false };
}

/**
 * Person-hours the open jobs need against what the technicians can give over
 * the window (a shift a day each).
 */
export function labour(sd: Pick<ShutdownDetail, "starts_at" | "ends_at" | "work_orders">, technicians: number) {
  let needed = 0;
  let unestimated = 0;
  for (const wo of sd.work_orders) {
    if (!LIVE(wo.status)) continue;
    const { hours, estimated } = jobHours(wo);
    needed += hours;
    if (!estimated) unestimated++;
  }
  const available = Math.max(0, technicians) * DAY_CAPACITY_HOURS * windowDays(sd.starts_at, sd.ends_at);
  return { needed, available, unestimated, short: needed > available };
}

/** Parts a job plans to use: its template's list, as MES copied it. */
export function plannedParts(wo: ShutdownWorkOrder): { sku: string; qty: number }[] {
  const raw = (wo.attrs || {}).parts_planned;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => (p && typeof p === "object" ? (p as Row) : {}))
    .map((p) => ({ sku: String(p.sku ?? "").trim(), qty: Number(p.qty) }))
    .filter((p) => p.sku && p.qty > 0);
}

export type PartReadiness = { sku: string; name: string; needed: number; onHand: number; short: number; known: boolean };

/**
 * Whether the stores hold what the open jobs plan to use. All of it counts:
 * a shutdown is the time to use the stock, reorder level or not.
 */
export function partsReadiness(
  jobs: ShutdownWorkOrder[],
  spareParts: { code?: unknown; name?: unknown; onHand?: unknown }[],
): PartReadiness[] {
  const need = new Map<string, { sku: string; qty: number }>();
  for (const wo of jobs) {
    if (!LIVE(wo.status)) continue;
    for (const p of plannedParts(wo)) {
      const key = p.sku.toUpperCase();
      const prev = need.get(key);
      need.set(key, { sku: prev?.sku || p.sku, qty: (prev?.qty || 0) + p.qty });
    }
  }
  const catalogue = new Map(spareParts.map((s) => [String(s.code ?? "").toUpperCase(), s]));
  return [...need.entries()]
    .map(([key, n]) => {
      const part = catalogue.get(key);
      const onHand = Number(String(part?.onHand ?? "").replace(/,/g, "")) || 0;
      return { sku: n.sku, name: String(part?.name ?? ""), needed: n.qty, onHand, short: Math.max(0, n.qty - onHand), known: Boolean(part) };
    })
    .sort((a, b) => b.short - a.short || a.sku.localeCompare(b.sku));
}

export type ScheduleBlock = { asset_tag?: string; label?: string; block_type?: string; starts_at: string; ends_at: string; po_num?: string };

/** Production planned on the shutdown's machines inside its window. */
export function productionConflicts(blocks: ScheduleBlock[], machines: string[], startsAt: string, endsAt: string): ScheduleBlock[] {
  const s = Date.parse(startsAt);
  const e = Date.parse(endsAt);
  const set = new Set(machines.map((m) => m.toUpperCase()));
  return blocks
    .filter((b) => set.has(String(b.asset_tag || "").toUpperCase()))
    .filter((b) => b.block_type !== "maintenance")
    .filter((b) => Date.parse(b.starts_at) < e && s < Date.parse(b.ends_at))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export type Suggestion =
  | { kind: "schedule"; scheduleId: string; machine: string; title: string; due: string; overdue: boolean }
  | { kind: "work-order"; num: string; machine: string; title: string; due: string; status: string };

/**
 * What could go into the shutdown: each machine's next preventive job due
 * before the window or within `aheadDays` after it (brought forward), and
 * open jobs on its machines that are in no shutdown yet.
 */
export function suggestions(
  sd: Pick<ShutdownDetail, "code" | "machines" | "starts_at" | "ends_at" | "work_orders">,
  forecast: ForecastItem[],
  openOrders: { num?: unknown; workCenter?: unknown; title?: unknown; dueDate?: unknown; status?: unknown; shutdown?: unknown }[],
  aheadDays = 60,
): Suggestion[] {
  const machines = new Set(sd.machines);
  const inIt = new Set(sd.work_orders.map((w) => w.num));
  const horizon = new Date(Date.parse(sd.ends_at) + aheadDays * 86_400_000).toISOString().slice(0, 10);
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const item of forecast) {
    if (item.occurrence !== 0 || !machines.has(item.asset_tag) || item.due_on > horizon) continue;
    if (item.work_order) {
      if (inIt.has(item.work_order)) continue;
      seen.add(item.work_order);
      out.push({ kind: "work-order", num: item.work_order, machine: item.asset_tag, title: item.template_name, due: item.due_on, status: "Open" });
    } else {
      out.push({ kind: "schedule", scheduleId: item.schedule_id, machine: item.asset_tag, title: item.template_name, due: item.due_on, overdue: item.overdue });
    }
  }
  for (const o of openOrders) {
    const num = String(o.num ?? "");
    if (!num || inIt.has(num) || seen.has(num)) continue;
    if (!machines.has(String(o.workCenter ?? "")) || String(o.shutdown ?? "")) continue;
    if (!/^(draft|scheduled|open|in progress)$/i.test(String(o.status ?? ""))) continue;
    out.push({ kind: "work-order", num, machine: String(o.workCenter), title: String(o.title ?? ""), due: String(o.dueDate ?? ""), status: String(o.status ?? "") });
  }
  return out.sort((a, b) => a.machine.localeCompare(b.machine) || (a.due || "9999").localeCompare(b.due || "9999"));
}

/** A datetime-local value (no zone) as the plant's time, East Africa (+03:00). */
export function plantTime(local: string): string {
  const v = local.trim();
  if (!v) return "";
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(v) ? new Date(v).toISOString() : new Date(`${v.length === 16 ? `${v}:00` : v}+03:00`).toISOString();
}

/** An instant as a datetime-local value in plant time. */
export function localPlantTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + 3 * 3_600_000).toISOString().slice(0, 16);
}

export function formatWindow(startsAt: string, endsAt: string): string {
  const s = localPlantTime(startsAt).replace("T", " ");
  const e = localPlantTime(endsAt).replace("T", " ");
  return s.slice(0, 10) === e.slice(0, 10) ? `${s} – ${e.slice(11)}` : `${s} – ${e}`;
}
