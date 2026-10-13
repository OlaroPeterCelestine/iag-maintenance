/**
 * The parts forecast: what the preventive plan will take out of the stores,
 * part by part, and when each part has to be ordered so it is there in time.
 *
 * Every projected job in iag-mes's forecast carries its template's parts.
 * For each part the needs are added up in date order against the stock that
 * can be planned with: what is on hand less the reorder level, which is kept
 * back for breakdowns. The first job that free stock no longer covers is the
 * shortfall; ordering has to start one lead time before it (14 days when the
 * part has none recorded).
 *
 * Pure, so the arithmetic is tested without a browser.
 */
import type { ForecastItem } from "@/lib/maintenance/calendar";

export const DEFAULT_LEAD_DAYS = 14;
/** An order due within this many days is "order now". */
export const ORDER_SOON_DAYS = 14;

export type SparePart = {
  code?: unknown;
  name?: unknown;
  unit?: unknown;
  onHand?: unknown;
  reorderLevel?: unknown;
  leadTimeDays?: unknown;
  status?: unknown;
};

export type PartNeed = { date: string; qty: number; machine: string; job: string };

export type PartStatus = "late" | "order-now" | "order-later" | "covered" | "unknown-part";

export type PartForecastRow = {
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  reorderLevel: number;
  /** On hand less the reorder level, never below zero. */
  free: number;
  needed: number;
  jobs: number;
  machines: number;
  /** The first job free stock does not cover. */
  shortfallOn: string;
  shortfall: number;
  leadDays: number;
  leadKnown: boolean;
  orderBy: string;
  status: PartStatus;
  needs: PartNeed[];
};

function num(v: unknown): number {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const STATUS_ORDER: Record<PartStatus, number> = { late: 0, "order-now": 1, "unknown-part": 2, "order-later": 3, covered: 4 };

export function partsForecast(items: ForecastItem[], parts: SparePart[], today: string): PartForecastRow[] {
  const catalogue = new Map(parts.map((p) => [String(p.code ?? "").trim().toUpperCase(), p]));
  const needs = new Map<string, { sku: string; list: PartNeed[] }>();
  for (const item of items) {
    for (const part of item.parts || []) {
      const sku = String(part.sku || "").trim();
      const qty = num(part.qty);
      if (!sku || qty <= 0) continue;
      const key = sku.toUpperCase();
      const entry = needs.get(key) || { sku, list: [] };
      entry.list.push({ date: item.due_on, qty, machine: item.asset_tag, job: item.work_order || item.template_name });
      needs.set(key, entry);
    }
  }
  const rows: PartForecastRow[] = [];
  for (const [key, { sku, list }] of needs) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const part = catalogue.get(key);
    const onHand = num(part?.onHand);
    const reorderLevel = Math.max(0, num(part?.reorderLevel));
    const free = Math.max(0, onHand - reorderLevel);
    const needed = list.reduce((n, x) => n + x.qty, 0);
    let running = 0;
    let shortfallOn = "";
    for (const need of list) {
      running += need.qty;
      if (running > free) {
        shortfallOn = need.date;
        break;
      }
    }
    const leadRaw = String(part?.leadTimeDays ?? "").trim();
    const leadKnown = leadRaw !== "" && Number.isFinite(Number(leadRaw));
    const leadDays = leadKnown ? Math.max(0, Number(leadRaw)) : DEFAULT_LEAD_DAYS;
    const orderBy = shortfallOn ? addDays(shortfallOn, -leadDays) : "";
    let status: PartStatus;
    if (!part) status = "unknown-part";
    else if (!shortfallOn) status = "covered";
    else if (orderBy < today) status = "late";
    else if (orderBy <= addDays(today, ORDER_SOON_DAYS)) status = "order-now";
    else status = "order-later";
    rows.push({
      sku: part ? String(part.code) : sku,
      name: String(part?.name ?? ""),
      unit: String(part?.unit ?? ""),
      onHand,
      reorderLevel,
      free,
      needed,
      jobs: list.length,
      machines: new Set(list.map((n) => n.machine)).size,
      shortfallOn,
      shortfall: Math.max(0, Math.ceil(needed - free)),
      leadDays,
      leadKnown,
      orderBy,
      status,
      needs: list,
    });
  }
  return rows.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.orderBy || "9999").localeCompare(b.orderBy || "9999") ||
      a.sku.localeCompare(b.sku),
  );
}

/** Procurement's idempotency key: one request per part per shortfall. */
export function requestRef(row: Pick<PartForecastRow, "sku" | "shortfallOn">): string {
  return `PF-${row.sku}-${row.shortfallOn.replace(/-/g, "")}`;
}

export const STATUS_LABEL: Record<PartStatus, string> = {
  late: "Order now — already late",
  "order-now": "Order now",
  "order-later": "Order later",
  covered: "Covered by stock",
  "unknown-part": "Not in the stores catalogue",
};
