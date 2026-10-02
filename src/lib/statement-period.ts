/** Inclusive calendar bounds and named presets for party ledger statements. */

export function isoDate(value: Date | string = new Date()): string {
  if (typeof value === "string") return value.slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function monthEnd(year: number, month: number): string {
  const last = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export type StatementPeriodPreset = {
  id: string;
  label: string;
  /** Empty `from` means the statement runs from the first movement through `to`. */
  from: string;
  to: string;
};

/** Clock-relative presets. `today` is the default To date when a preset is applied. */
export function builtInStatementPeriods(today = isoDate()): StatementPeriodPreset[] {
  const asOf = isoDate(today);
  const d = new Date(`${asOf}T12:00:00`);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  const quarterStart = (quarter - 1) * 3 + 1;
  const lastMonth = new Date(year, month - 2, 1);
  const lastMonthYear = lastMonth.getFullYear();
  const lastMonthNum = lastMonth.getMonth() + 1;
  const lastQuarter = quarter === 1 ? 4 : quarter - 1;
  const lastQuarterYear = quarter === 1 ? year - 1 : year;
  const lastQuarterStart = (lastQuarter - 1) * 3 + 1;

  return [
    { id: "all", label: "All time", from: "", to: asOf },
    { id: "this-month", label: "This month", from: monthStart(year, month), to: asOf },
    {
      id: "last-month",
      label: "Last month",
      from: monthStart(lastMonthYear, lastMonthNum),
      to: monthEnd(lastMonthYear, lastMonthNum),
    },
    {
      id: "this-quarter",
      label: "This quarter",
      from: monthStart(year, quarterStart),
      to: asOf,
    },
    {
      id: "last-quarter",
      label: "Last quarter",
      from: monthStart(lastQuarterYear, lastQuarterStart),
      to: monthEnd(lastQuarterYear, lastQuarterStart + 2),
    },
    { id: "ytd", label: "Year to date", from: `${year}-01-01`, to: asOf },
    {
      id: "last-year",
      label: "Last year",
      from: `${year - 1}-01-01`,
      to: `${year - 1}-12-31`,
    },
  ];
}

export function matchStatementPeriod(
  from: string,
  to: string,
  presets: StatementPeriodPreset[],
): string {
  const start = (from || "").slice(0, 10);
  const end = (to || "").slice(0, 10);
  if (!start) return "all";
  const hit = presets.find((preset) => preset.id !== "all" && preset.from === start && preset.to === end);
  return hit?.id ?? "custom";
}

export function statementPeriodLabel(from: string | undefined, to: string): string {
  if (from) return `${from} – ${to}`;
  return `As of ${to}`;
}
