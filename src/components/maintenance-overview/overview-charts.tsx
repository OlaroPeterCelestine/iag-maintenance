"use client";

/**
 * The maintenance overview's charts. Recharts lives here so the page paints
 * its tiles first and streams these in (next/dynamic).
 *
 * Colours are categorical slots 1–3, validated for colour-vision deficiency on
 * the light (#ffffff) and dark (#0a0a0a) surfaces (the same slots as the
 * Production app's overview). Light green sits below 3:1 against white, so
 * every chart carries a legend or direct labels and a table view.
 */
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { MaintenanceOverview } from "@/lib/maintenance/overview";

const SLOT = [
  { light: "#2a78d6", dark: "#3987e5" },
  { light: "#eb6834", dark: "#d95926" },
  { light: "#1baf7a", dark: "#199e70" },
];

const weeklyConfig = {
  planned: { label: "Planned", theme: SLOT[0] },
  reactive: { label: "Reactive", theme: SLOT[1] },
} satisfies ChartConfig;

const backlogConfig = { jobs: { label: "Live jobs", theme: SLOT[0] } } satisfies ChartConfig;
const causesConfig = { failures: { label: "Failures", theme: SLOT[0] } } satisfies ChartConfig;

const costConfig = {
  labour: { label: "Labour", theme: SLOT[0] },
  parts: { label: "Parts", theme: SLOT[1] },
  contractor: { label: "Contractor", theme: SLOT[2] },
} satisfies ChartConfig;

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function shortMonth(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? ym : d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function compact(v: number): string {
  if (v >= 1_000_000) return `${Math.round(v / 100_000) / 10}M`;
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v));
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-200 px-6 text-center text-[13px] text-slate-500 dark:border-slate-800">
      {text}
    </div>
  );
}

function valueRow(label: string, value: string, color?: string) {
  return (
    <div className="flex w-full items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
        {color ? <span className="h-2 w-2 rounded-full" style={{ background: color }} /> : null}
        {label}
      </span>
      <span className="font-medium tabular-nums text-slate-900 dark:text-slate-50">{value}</span>
    </div>
  );
}

/** The figures behind a chart, for anyone who cannot or would rather not read the colours. */
export function TableToggle({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[12px] text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
        aria-expanded={open}
      >
        {open ? "Hide table" : "Show as table"}
      </button>
      {open ? (
        <table className="mt-2 w-full text-left text-[12px]">
          <thead className="text-slate-500">
            <tr>
              {head.map((h, i) => (
                <th key={h} className={i ? "py-1 text-right font-medium" : "py-1 font-medium"}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums text-slate-800 dark:text-slate-100">
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                {r.map((c, j) => (
                  <td key={j} className={j ? "py-1 text-right" : "py-1"}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

export function WeeklyJobsChart({ weekly }: { weekly: MaintenanceOverview["weekly"] }) {
  if (!weekly.some((w) => w.planned + w.reactive)) return <Empty text="No work orders raised in the last twelve weeks." />;
  const data = weekly.map((w) => ({ ...w, label: shortDate(w.week) }));
  return (
    <>
      <ChartContainer config={weeklyConfig} className="h-[240px] w-full">
        <BarChart data={data} margin={{ left: 4, right: 16, top: 8, bottom: 0 }} barGap={2} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={12} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={32} fontSize={11} allowDecimals={false} />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, p) => `Week of ${p?.[0]?.payload?.label ?? ""}`}
                formatter={(value, name, item) =>
                  valueRow(String(weeklyConfig[name as keyof typeof weeklyConfig]?.label ?? name), `${value} jobs`, item.color)
                }
              />
            }
          />
          <Bar dataKey="planned" fill="var(--color-planned)" maxBarSize={18} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="reactive" fill="var(--color-reactive)" maxBarSize={18} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <ChartLegend content={<ChartLegendContent />} />
        </BarChart>
      </ChartContainer>
      <TableToggle head={["Week of", "Planned", "Reactive"]} rows={weekly.map((w) => [w.week, w.planned, w.reactive])} />
    </>
  );
}

export function BacklogChart({ backlog }: { backlog: MaintenanceOverview["backlog"] }) {
  if (!backlog.some((b) => b.jobs)) return <Empty text="No live work orders." />;
  return (
    <>
      <ChartContainer config={backlogConfig} className="h-[240px] w-full">
        <BarChart data={backlog} margin={{ left: 4, right: 16, top: 20, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="bucket" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={32} fontSize={11} allowDecimals={false} />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={<ChartTooltipContent labelKey="bucket" formatter={(value) => valueRow("Live jobs", String(value))} />}
          />
          <Bar dataKey="jobs" fill="var(--color-jobs)" maxBarSize={48} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            <LabelList dataKey="jobs" position="top" fontSize={11} className="fill-slate-600 dark:fill-slate-300" />
          </Bar>
        </BarChart>
      </ChartContainer>
      <TableToggle head={["Age", "Live jobs"]} rows={backlog.map((b) => [b.bucket, b.jobs])} />
    </>
  );
}

export function CausesChart({ causes }: { causes: MaintenanceOverview["causes"] }) {
  if (!causes.length) {
    return <Empty text="No failure codes yet. They appear as breakdown and corrective jobs are closed with a problem, cause and remedy." />;
  }
  return (
    <>
      <ChartContainer config={causesConfig} className="h-[260px] w-full">
        <BarChart data={causes} layout="vertical" margin={{ left: 4, right: 28, top: 4, bottom: 0 }} accessibilityLayer>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} />
          <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={170} fontSize={11} />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={<ChartTooltipContent labelKey="label" formatter={(value) => valueRow("Failures", String(value))} />}
          />
          <Bar dataKey="failures" fill="var(--color-failures)" maxBarSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList dataKey="failures" position="right" fontSize={11} className="fill-slate-600 dark:fill-slate-300" />
          </Bar>
        </BarChart>
      </ChartContainer>
      <TableToggle head={["Problem — cause", "Failures"]} rows={causes.map((c) => [c.label, c.failures])} />
    </>
  );
}

export function CostChart({ cost, currency }: { cost: MaintenanceOverview["cost"]; currency: string }) {
  if (!cost.some((c) => c.labour + c.parts + c.contractor)) {
    return <Empty text="No costed work in the last six months. Costs appear once labour rates are set and parts are booked to work orders." />;
  }
  const data = cost.map((c) => ({ ...c, label: shortMonth(c.month) }));
  return (
    <>
      <ChartContainer config={costConfig} className="h-[240px] w-full">
        <BarChart data={data} margin={{ left: 4, right: 16, top: 8, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis tickLine={false} axisLine={false} width={44} fontSize={11} tickFormatter={compact} />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, p) => {
                  const row = p?.[0]?.payload as (typeof data)[number] | undefined;
                  return row ? `${row.label}${row.complete ? "" : " — incomplete (see Machine Costs)"}` : "";
                }}
                formatter={(value, name, item) =>
                  valueRow(
                    String(costConfig[name as keyof typeof costConfig]?.label ?? name),
                    `${Math.round(Number(value)).toLocaleString("en-GB")} ${currency}`,
                    item.color,
                  )
                }
              />
            }
          />
          {/* Stacked, with a 2px surface gap between segments; only the top one is rounded. */}
          <Bar dataKey="labour" stackId="c" fill="var(--color-labour)" stroke="var(--card)" strokeWidth={2} maxBarSize={36} isAnimationActive={false} />
          <Bar dataKey="parts" stackId="c" fill="var(--color-parts)" stroke="var(--card)" strokeWidth={2} maxBarSize={36} isAnimationActive={false} />
          <Bar dataKey="contractor" stackId="c" fill="var(--color-contractor)" stroke="var(--card)" strokeWidth={2} maxBarSize={36} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <ChartLegend content={<ChartLegendContent />} />
        </BarChart>
      </ChartContainer>
      <TableToggle
        head={["Month", "Labour", "Parts", "Contractor", "Total"]}
        rows={cost.map((c) => [
          `${c.month}${c.complete ? "" : " *"}`,
          Math.round(c.labour).toLocaleString("en-GB"),
          Math.round(c.parts).toLocaleString("en-GB"),
          Math.round(c.contractor).toLocaleString("en-GB"),
          Math.round(c.labour + c.parts + c.contractor).toLocaleString("en-GB"),
        ])}
      />
    </>
  );
}
