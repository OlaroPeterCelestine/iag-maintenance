/**
 * The scheduling board's arithmetic: which week, which cell a job sits in, and
 * whether a technician's day is overbooked. Pure, so it is tested without a
 * browser.
 */
import type { Rec } from "@/lib/maintenance/machine-summary";

/** Hours a technician has for planned work in a day. One shift, less breaks. */
export const DAY_CAPACITY_HOURS = 8;
/** What a job with no estimate is counted as, so it still takes room. */
export const UNESTIMATED_HOURS = 2;
export const UNASSIGNED = "";

const LIVE = /^(draft|scheduled|open|in progress)$/i;

export function isLive(order: Rec): boolean {
  return LIVE.test(String(order.status || "Open").trim());
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday to Sunday of the week holding `anchor` (YYYY-MM-DD, local). */
export function weekOf(anchor: string): string[] {
  const [y, m, d] = anchor.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const offset = (date.getDay() + 6) % 7; // Monday = 0
  date.setDate(date.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(date);
    day.setDate(date.getDate() + i);
    return iso(day);
  });
}

export function shiftWeek(anchor: string, weeks: number): string {
  const [y, m, d] = anchor.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, (d || 1) + weeks * 7);
  return iso(date);
}

export function todayIso(now: Date = new Date()): string {
  return iso(now);
}

export function hoursOf(order: Rec): { hours: number; estimated: boolean } {
  const v = Number(String(order.estimatedHours || "").replace(/,/g, ""));
  return Number.isFinite(v) && v > 0 ? { hours: v, estimated: true } : { hours: UNESTIMATED_HOURS, estimated: false };
}

export function cellKey(technician: string, day: string): string {
  return `${technician}|${day}`;
}

export type Board = {
  cells: Map<string, Rec[]>;
  /** Live jobs not planned inside this week: no day yet, or planned earlier and still open. */
  backlog: Rec[];
  technicians: string[];
};

/**
 * Lay live jobs out on a week. A job planned before the week and still open
 * is carried in the backlog as overdue planning rather than hidden.
 */
export function layoutBoard(orders: Rec[], knownTechnicians: string[], days: string[]): Board {
  const cells = new Map<string, Rec[]>();
  const backlog: Rec[] = [];
  const names = new Set(knownTechnicians.map((t) => t.trim()).filter(Boolean));
  const first = days[0];
  const last = days[days.length - 1];
  for (const order of orders) {
    if (!isLive(order)) continue;
    const day = String(order.plannedStart || "").slice(0, 10);
    const tech = String(order.assignee || "").trim();
    if (!day || day < first) {
      backlog.push(order);
      continue;
    }
    if (day > last) continue; // a later week
    if (tech) names.add(tech);
    const key = cellKey(tech || UNASSIGNED, day);
    cells.set(key, [...(cells.get(key) || []), order]);
  }
  backlog.sort((a, b) =>
    String(a.plannedStart || a.dueDate || "9999").localeCompare(String(b.plannedStart || b.dueDate || "9999")),
  );
  return { cells, backlog, technicians: [...Array.from(names).sort((a, b) => a.localeCompare(b)), UNASSIGNED] };
}

export function cellLoad(orders: Rec[]): { hours: number; unestimated: number; over: boolean } {
  let hours = 0;
  let unestimated = 0;
  for (const o of orders) {
    const h = hoursOf(o);
    hours += h.hours;
    if (!h.estimated) unestimated++;
  }
  return { hours, unestimated, over: hours > DAY_CAPACITY_HOURS };
}
