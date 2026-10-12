/**
 * What a machine's page says about it, from the app's own record lists. Pure,
 * so the rules (what counts as open, when a warranty is "ending") are tested
 * without a browser.
 */
export type Rec = Record<string, string | undefined>;

const CLOSED = /^(completed|cancelled|canceled|closed|fixed|no work needed|resolved)$/i;

export function isOpen(row: Rec): boolean {
  return !CLOSED.test(String(row.status || "").trim());
}

export function forMachine(rows: Rec[], tag: string): Rec[] {
  const t = tag.trim().toLowerCase();
  return rows.filter((r) => String(r.workCenter || "").trim().toLowerCase() === t);
}

/** Expired, ending within 30 days, or fine — said in words. */
export function warrantyState(until: string | undefined, today: Date = new Date()): "" | "Expired" | "Ending soon" | "In warranty" {
  const d = String(until || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  const end = new Date(`${d}T23:59:59`);
  const days = (end.getTime() - today.getTime()) / 86_400_000;
  if (days < 0) return "Expired";
  if (days <= 30) return "Ending soon";
  return "In warranty";
}

/** Machines whose "Part of machine" is this one. */
export function partsOf(machines: Rec[], tag: string): Rec[] {
  const t = tag.trim().toLowerCase();
  return machines.filter((m) => String(m.parentMachine || "").trim().toLowerCase() === t);
}

/** Newest first, by the row's own date then its update time. */
export function newestFirst(rows: Rec[]): Rec[] {
  return [...rows].sort((a, b) =>
    String(b.date || b.completedOn || b.updatedAt || "").localeCompare(String(a.date || a.completedOn || a.updatedAt || "")),
  );
}

/** Sum of a cost column over this calendar year's machine-cost rows. */
export function yearToDateCost(rows: Rec[], tag: string, year: number): { total: number; complete: boolean } {
  const mine = forMachine(rows, tag).filter((r) => String(r.month || "").startsWith(`${year}-`));
  let total = 0;
  let complete = true;
  for (const r of mine) {
    const v = Number(String(r.totalCost || "").replace(/,/g, ""));
    if (!String(r.totalCost || "").trim() || !Number.isFinite(v)) complete = false;
    else total += v;
  }
  return { total, complete };
}
