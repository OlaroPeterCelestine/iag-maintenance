/**
 * The annual maintenance calendar: every preventive job the year holds,
 * machines down the side and weeks across, from iag-mes's forecast
 * (GET /maintenance/forecast — internal/store/forecast.go).
 *
 * Pure, so the grid and the load are tested without a browser. The load is in
 * person-hours: a job's hours times its crew. A job with no estimate counts as
 * the Planner's default and is reported as unestimated, rather than taking no
 * room. Capacity is the technicians on the list times a working week.
 */
import { DAY_CAPACITY_HOURS } from "@/lib/maintenance/planner";

/** As iag-mes returns a forecast item. */
export type ForecastItem = {
  schedule_id: string;
  template_id: string;
  template_code: string;
  template_name: string;
  asset_tag: string;
  asset_name: string;
  plant_code: string;
  section_code: string;
  due_on: string;
  basis: "days" | "hours";
  estimated: boolean;
  overdue: boolean;
  occurrence: number;
  work_order?: string;
  estimated_hours?: number | null;
  crew_size?: number | null;
  fixed_dates: boolean;
  /** Parts the job uses, from its template. */
  parts?: { sku: string; qty: number }[];
};

export type ForecastGap = { schedule_id: string; asset_tag: string; template_code: string; reason: string };
export type Forecast = { from: string; to: string; items: ForecastItem[]; gaps: ForecastGap[] };

/** Hours a job with no estimate is counted at — the Planner's default. */
export const DEFAULT_JOB_HOURS = 2;
export const WORK_DAYS_PER_WEEK = 5;

export type Week = { start: string; end: string; month: string; label: string };
export type CalendarRow = {
  tag: string;
  name: string;
  plant: string;
  section: string;
  /** Jobs by week start. */
  cells: Map<string, ForecastItem[]>;
  jobs: number;
};
export type WeekLoad = { hours: number; jobs: number; unestimated: number; overdue: number };
export type Calendar = { weeks: Week[]; rows: CalendarRow[]; load: Map<string, WeekLoad>; months: { month: string; weeks: number }[] };

function parse(d: string): Date {
  return new Date(`${d.slice(0, 10)}T00:00:00Z`);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before a date. */
export function mondayOf(day: string): string {
  const d = parse(day);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return iso(d);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monday-to-Sunday weeks covering [from, to]. A week belongs to the month its Thursday is in. */
export function weeksBetween(from: string, to: string): Week[] {
  const out: Week[] = [];
  const end = parse(to);
  for (let d = parse(mondayOf(from)); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
    const start = iso(d);
    const sunday = new Date(d);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const thursday = new Date(d);
    thursday.setUTCDate(thursday.getUTCDate() + 3);
    out.push({
      start,
      end: iso(sunday),
      month: `${MONTHS[thursday.getUTCMonth()]} ${thursday.getUTCFullYear()}`,
      label: String(d.getUTCDate()),
    });
  }
  return out;
}

/** A job's person-hours, and whether that is an estimate from the template or the default. */
export function personHours(item: ForecastItem): { hours: number; estimated: boolean } {
  const h = Number(item.estimated_hours) > 0 ? Number(item.estimated_hours) : 0;
  const crew = Number(item.crew_size) > 0 ? Number(item.crew_size) : 1;
  return h ? { hours: h * crew, estimated: true } : { hours: DEFAULT_JOB_HOURS * crew, estimated: false };
}

export function weeklyCapacity(technicians: number): number {
  return Math.max(0, technicians) * DAY_CAPACITY_HOURS * WORK_DAYS_PER_WEEK;
}

export function buildCalendar(
  forecast: Pick<Forecast, "from" | "to" | "items">,
  filter: { section?: string } = {},
): Calendar {
  const weeks = weeksBetween(forecast.from, forecast.to);
  const known = new Set(weeks.map((w) => w.start));
  const rows = new Map<string, CalendarRow>();
  const load = new Map<string, WeekLoad>(weeks.map((w) => [w.start, { hours: 0, jobs: 0, unestimated: 0, overdue: 0 }]));
  for (const item of forecast.items) {
    if (filter.section && item.section_code !== filter.section) continue;
    // An overdue job before the range sits in the first week, so it is seen.
    let week = mondayOf(item.due_on);
    if (!known.has(week)) {
      if (item.overdue && weeks.length) week = weeks[0].start;
      else continue;
    }
    let row = rows.get(item.asset_tag);
    if (!row) {
      row = { tag: item.asset_tag, name: item.asset_name, plant: item.plant_code, section: item.section_code, cells: new Map(), jobs: 0 };
      rows.set(item.asset_tag, row);
    }
    row.cells.set(week, [...(row.cells.get(week) || []), item]);
    row.jobs++;
    const l = load.get(week)!;
    const { hours, estimated } = personHours(item);
    l.hours += hours;
    l.jobs++;
    if (!estimated) l.unestimated++;
    if (item.overdue) l.overdue++;
  }
  const months: { month: string; weeks: number }[] = [];
  for (const w of weeks) {
    const last = months[months.length - 1];
    if (last && last.month === w.month) last.weeks++;
    else months.push({ month: w.month, weeks: 1 });
  }
  const sorted = [...rows.values()].sort(
    (a, b) => a.plant.localeCompare(b.plant) || a.section.localeCompare(b.section) || a.tag.localeCompare(b.tag, undefined, { numeric: true }),
  );
  return { weeks, rows: sorted, load, months };
}

/** The first day of the month a date is in, and the same day a year on less one. */
export function yearFrom(day: string): { from: string; to: string } {
  const d = parse(day);
  const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const to = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), 0));
  return { from: iso(from), to: iso(to) };
}

export function shiftMonths(day: string, months: number): string {
  const d = parse(day);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)));
}
