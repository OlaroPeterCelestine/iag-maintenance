"use client";

/**
 * The maintenance overview: the figures a maintenance manager is asked for,
 * then the four charts that explain them. Built server-side from the same
 * adapters as the list screens (/api/dashboard/maintenance).
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api-auth";
import type { MaintenanceOverview as Overview } from "@/lib/maintenance/overview";
import { cn } from "@/lib/utils";

const Charts = {
  Weekly: dynamic(() => import("./overview-charts").then((m) => m.WeeklyJobsChart), { ssr: false }),
  Backlog: dynamic(() => import("./overview-charts").then((m) => m.BacklogChart), { ssr: false }),
  Causes: dynamic(() => import("./overview-charts").then((m) => m.CausesChart), { ssr: false }),
  Cost: dynamic(() => import("./overview-charts").then((m) => m.CostChart), { ssr: false }),
};

type Level = "good" | "warning" | "critical";

/**
 * Targets. PM compliance: 90 % on time is the usual bar. Planned share: world
 * class runs 80 %+ planned; under half planned means the floor is firefighting.
 */
export function pmLevel(pct: number): Level {
  return pct >= 90 ? "good" : pct >= 70 ? "warning" : "critical";
}
export function plannedLevel(pct: number): Level {
  return pct >= 70 ? "good" : pct >= 50 ? "warning" : "critical";
}

const LEVEL = {
  good: { icon: CheckCircle2, label: "On target", cls: "text-[#0ca30c]" },
  warning: { icon: AlertTriangle, label: "Below target", cls: "text-[#b07c00] dark:text-[#fab219]" },
  critical: { icon: XCircle, label: "Well below target", cls: "text-[#d03b3b]" },
} as const;

function Tile({
  label,
  value,
  hint,
  href,
  level,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  level?: Level;
}) {
  const body = (
    <>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
      {level ? (
        <p className={cn("mt-0.5 flex items-center gap-1 text-[11px] font-medium", LEVEL[level].cls)}>
          {(() => {
            const Icon = LEVEL[level].icon;
            return <Icon size={12} aria-hidden />;
          })()}
          {LEVEL[level].label}
        </p>
      ) : null}
      {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
    </>
  );
  const cls =
    "rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-sky-300")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <h2 className="text-[13px] font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
      {sub ? <p className="mb-2 text-[11px] text-slate-500">{sub}</p> : null}
      {children}
    </section>
  );
}

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const hours = (v: number | null) => (v === null ? "—" : `${v} h`);

export function MaintenanceOverview({ factory }: { factory: string }) {
  const [state, setState] = useState<{ data?: Overview; gaps: string[]; error?: string; loading: boolean }>({
    gaps: [],
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/dashboard/maintenance${factory ? `?plant=${encodeURIComponent(factory)}` : ""}`, {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => null)) as { data?: Overview; gaps?: string[]; error?: string } | null;
        if (cancelled) return;
        if (!res.ok || !body?.data) {
          setState({ gaps: [], error: body?.error || `HTTP ${res.status}`, loading: false });
          return;
        }
        setState({ data: body.data, gaps: body.gaps || [], loading: false });
      } catch (err) {
        if (!cancelled) setState({ gaps: [], error: err instanceof Error ? err.message : "Could not load", loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [factory]);

  if (state.loading) return <p className="mb-4 text-[13px] text-slate-500">Loading the overview…</p>;
  if (state.error || !state.data) {
    return <p className="mb-4 text-[13px] text-rose-700">The overview could not be built: {state.error}</p>;
  }
  const { tiles, weekly, backlog, causes, cost } = state.data;

  return (
    <div className="mb-4 grid gap-4">
      {state.gaps.length ? (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Not counted, because they did not load: {state.gaps.join("; ")}.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Tile label="Open work orders" value={String(tiles.openWorkOrders)} href="/production?view=work-orders" />
        <Tile label="Machines stopped" value={String(tiles.machinesStopped)} href="/production?view=work-centers" />
        <Tile label="Fault reports waiting" value={String(tiles.faultReportsWaiting)} href="/production?view=fault-reports" />
        <Tile label="Overdue PM" value={String(tiles.overduePm)} href="/production?view=pm-schedules" />
        <Tile
          label="PM on time (90 days)"
          value={pct(tiles.pmCompliancePct)}
          level={tiles.pmCompliancePct === null ? undefined : pmLevel(tiles.pmCompliancePct)}
          hint={tiles.pmCompliancePct === null ? "No PM completed yet" : `${tiles.pmCompletedInWindow} completed · target 90%`}
        />
        <Tile
          label="Planned work (90 days)"
          value={pct(tiles.plannedSharePct)}
          level={tiles.plannedSharePct === null ? undefined : plannedLevel(tiles.plannedSharePct)}
          hint="Preventive, inspection, overhaul · target 70%"
        />
        <Tile label="MTBF" value={hours(tiles.mtbfHours)} hint="Mean time between failures" href="/production?view=reliability" />
        <Tile label="MTTR" value={hours(tiles.mttrHours)} hint="Mean time to repair" href="/production?view=reliability" />
        <Tile label="Spare parts low or out" value={String(tiles.partsLow)} href="/production?view=spare-parts" />
        <Tile
          label="Cost this month"
          value={tiles.costThisMonth === null ? "—" : Math.round(tiles.costThisMonth).toLocaleString("en-GB")}
          hint={tiles.costThisMonth === null ? "No costed work yet" : tiles.costThisMonthComplete ? "UGX" : "UGX · incomplete"}
          href="/production?view=machine-costs"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Work raised per week" sub="Planned (preventive, inspection, overhaul) against reactive (breakdown, corrective), last 12 weeks">
          <Charts.Weekly weekly={weekly} />
        </Panel>
        <Panel title="Backlog by age" sub="Live work orders, by days since raised">
          <Charts.Backlog backlog={backlog} />
        </Panel>
        <Panel title="Top failure causes" sub="Completed breakdown and corrective work, last 12 months">
          <Charts.Causes causes={causes} />
        </Panel>
        <Panel title="Maintenance cost by month" sub="Labour, parts and contractor, last 6 months">
          <Charts.Cost cost={cost} currency="UGX" />
        </Panel>
      </div>
    </div>
  );
}
