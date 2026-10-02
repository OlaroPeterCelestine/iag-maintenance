"use client";

import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ManagerRecord } from "@/lib/manager-entities";
import { filterRecordsForProjectScope } from "@/lib/project-scope";
import { loadRecords } from "@/lib/records-store";
import { cn } from "@/lib/utils";
import { useRecordsSyncTick } from "@/hooks/use-records-sync-tick";
import Link from "next/link";
import { useMemo, useState } from "react";

type GanttKind = "project" | "phase" | "task" | "milestone";

type GanttBar = {
  id: string;
  label: string;
  project: string;
  kind: GanttKind;
  start: string;
  end: string;
  status: string;
  href: string;
  detail?: string;
  /** Stored progress % when set on the record. */
  progressPercent: number | null;
  /** Elapsed share of the bar’s start→end window (0–100). */
  timelinePercent: number;
  /** Fill used on the bar: stored progress, else timeline. */
  displayPercent: number;
};

const DAY_MS = 86_400_000;

function parseDay(value?: string): number | null {
  const v = (value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00`);
  return Number.isNaN(t) ? null : t;
}

function formatDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number) {
  const t = parseDay(iso);
  if (t === null) return iso;
  return formatDay(t + days * DAY_MS);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseProgressPercent(raw?: string): number | null {
  const v = (raw || "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return clampPercent(n);
}

/** How far “today” sits between start and end (schedule progress). */
function timelinePercent(startIso: string, endIso: string, nowMs = Date.now()): number {
  const start = parseDay(startIso);
  const end = parseDay(endIso);
  if (start === null || end === null) return 0;
  if (end <= start) return nowMs >= start ? 100 : 0;
  if (nowMs <= start) return 0;
  if (nowMs >= end) return 100;
  return clampPercent(((nowMs - start) / (end - start)) * 100);
}

function resolveDisplayPercent(
  status: string,
  progress: number | null,
  timeline: number,
): number {
  const s = (status || "").toLowerCase();
  if (/cancel|reject/i.test(s)) return progress ?? 0;
  if (/done|complete|approved/i.test(s)) return 100;
  if (progress !== null) return progress;
  return timeline;
}

function statusTone(kind: GanttKind, status: string) {
  const s = (status || "").toLowerCase();
  if (/cancel|reject|block/i.test(s)) return "bg-rose-400/90";
  if (/done|complete|approved/i.test(s)) return "bg-emerald-500/90";
  if (/progress|active|submitted/i.test(s)) return "bg-sky-500/90";
  if (kind === "milestone") return "bg-amber-500";
  if (kind === "project" || kind === "phase") return "bg-slate-700/90";
  return "bg-orange-500/90";
}

function statusTrackTone(kind: GanttKind, status: string) {
  const s = (status || "").toLowerCase();
  if (/cancel|reject|block/i.test(s)) return "bg-rose-200";
  if (/done|complete|approved/i.test(s)) return "bg-emerald-200";
  if (/progress|active|submitted/i.test(s)) return "bg-sky-200";
  if (kind === "milestone") return "bg-amber-200";
  if (kind === "project" || kind === "phase") return "bg-slate-200";
  return "bg-orange-200";
}

function projectKey(name?: string) {
  return (name || "").trim().toLowerCase();
}

function buildBars(
  projects: ManagerRecord[],
  phases: ManagerRecord[],
  activities: ManagerRecord[],
  milestones: ManagerRecord[],
): GanttBar[] {
  const out: GanttBar[] = [];
  const knownProjects = new Set(
    projects.map((p) => projectKey(p.name || p.code)).filter(Boolean),
  );
  const hasProjects = knownProjects.size > 0;

  const pushBar = (bar: Omit<GanttBar, "timelinePercent" | "displayPercent" | "progressPercent"> & {
    progressPercent?: number | null;
  }) => {
    const timeline = timelinePercent(bar.start, bar.end);
    const progress = bar.progressPercent ?? null;
    out.push({
      ...bar,
      progressPercent: progress,
      timelinePercent: timeline,
      displayPercent: resolveDisplayPercent(bar.status, progress, timeline),
    });
  };

  // Project-level schedule from New Project start/due.
  for (const project of projects) {
    const start = project.startDate || "";
    const end = project.endDate || project.dueDate || project.startDate || "";
    if (!parseDay(start) || !parseDay(end)) continue;
    const name = project.name || project.code || "Project";
    pushBar({
      id: `project-${project.id}`,
      label: name,
      project: name,
      kind: "project",
      start,
      end: end < start ? start : end,
      status: project.status || "Planned",
      href: `/projects?view=projects&open=${encodeURIComponent(name)}`,
      detail: project.contractor || project.manager || "Project",
      progressPercent: parseProgressPercent(project.progressPercent),
    });
  }

  for (const phase of phases) {
    const projectName = phase.project || "Unassigned";
    if (hasProjects && !knownProjects.has(projectKey(projectName))) continue;
    const start = phase.startDate || "";
    const end = phase.endDate || phase.startDate || "";
    if (!parseDay(start) || !parseDay(end)) continue;
    pushBar({
      id: phase.id,
      label: phase.name || phase.code || "Phase",
      project: projectName,
      kind: "phase",
      start,
      end: end < start ? start : end,
      status: phase.status || "Planned",
      href: `/projects?view=phases&open=${encodeURIComponent(phase.name || phase.id)}`,
      detail: phase.code,
      progressPercent: parseProgressPercent(phase.progressPercent),
    });
  }

  for (const task of activities) {
    const projectName = task.project || "Unassigned";
    if (hasProjects && !knownProjects.has(projectKey(projectName))) continue;
    const due = task.dueDate || "";
    const start = task.startDate || (due ? addDays(due, -7) : "");
    const end = due || task.startDate || "";
    if (!parseDay(start) || !parseDay(end)) continue;
    pushBar({
      id: task.id,
      label: task.name || task.code || "Activity",
      project: projectName,
      kind: "task",
      start,
      end: end < start ? start : end,
      status: task.status || "Todo",
      href: `/projects?view=activities&open=${encodeURIComponent(task.name || task.id)}`,
      detail: [task.phase, task.assignee].filter(Boolean).join(" · "),
      progressPercent: parseProgressPercent(task.progressPercent),
    });
  }

  for (const ms of milestones) {
    const projectName = ms.project || "Unassigned";
    if (hasProjects && !knownProjects.has(projectKey(projectName))) continue;
    const due = ms.dueDate || ms.completedDate || "";
    if (!parseDay(due)) continue;
    pushBar({
      id: ms.id,
      label: ms.name || "Milestone",
      project: projectName,
      kind: "milestone",
      start: due,
      end: due,
      status: ms.status || "Planned",
      href: `/projects?view=milestones&open=${encodeURIComponent(ms.name || ms.id)}`,
      detail: ms.phase,
      progressPercent: parseProgressPercent(ms.progressPercent),
    });
  }

  return out.sort((a, b) => {
    const byProject = a.project.localeCompare(b.project);
    if (byProject) return byProject;
    const order = { project: 0, phase: 1, task: 2, milestone: 3 };
    const kindOrder = order[a.kind] - order[b.kind];
    if (kindOrder) return kindOrder;
    return a.start.localeCompare(b.start) || a.label.localeCompare(b.label);
  });
}

function monthTicks(rangeStart: number, rangeEnd: number) {
  const ticks: { left: number; label: string }[] = [];
  const span = Math.max(rangeEnd - rangeStart, DAY_MS);
  const d = new Date(rangeStart);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() < rangeStart) d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= rangeEnd) {
    const left = ((d.getTime() - rangeStart) / span) * 100;
    ticks.push({
      left,
      label: d.toLocaleString(undefined, { month: "short", year: "2-digit" }),
    });
    d.setMonth(d.getMonth() + 1);
  }
  return ticks;
}

function kindLabel(kind: GanttKind) {
  if (kind === "project") return "project";
  if (kind === "phase") return "phase";
  if (kind === "milestone") return "milestone";
  return "activity";
}

export function ProjectGanttPanel() {
  const { tick, ready } = useRecordsSyncTick([
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "phases" },
    { module: "projects", entity: "activities" },
    { module: "projects", entity: "tasks" },
    { module: "projects", entity: "milestones" },
  ]);
  const [projectFilter, setProjectFilter] = useState("all");
  // Pin the clock at mount. Reading Date.now() during render made every render
  // non-deterministic for a marker that only needs to be right to the day, and
  // an empty chart's fallback window shifted on each paint.
  const [nowMs] = useState(() => Date.now());

  const data = useMemo(() => {
    void tick;
    if (!ready) {
      return {
        projects: [] as ManagerRecord[],
        phases: [] as ManagerRecord[],
        activities: [] as ManagerRecord[],
        milestones: [] as ManagerRecord[],
      };
    }
    const activities = filterRecordsForProjectScope(
      "activities",
      loadRecords("projects", "activities"),
    );
    const legacyTasks = filterRecordsForProjectScope(
      "tasks",
      loadRecords("projects", "tasks"),
    );
    return {
      projects: filterRecordsForProjectScope(
        "projects",
        loadRecords("projects", "projects"),
      ),
      phases: filterRecordsForProjectScope(
        "phases",
        loadRecords("projects", "phases"),
      ),
      activities: activities.length ? activities : legacyTasks,
      milestones: filterRecordsForProjectScope(
        "milestones",
        loadRecords("projects", "milestones"),
      ),
    };
  }, [ready, tick]);

  const allBars = useMemo(
    () => buildBars(data.projects, data.phases, data.activities, data.milestones),
    [data],
  );

  const projectNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of data.projects) if (p.name) names.add(p.name);
    for (const b of allBars) if (b.project) names.add(b.project);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [data.projects, allBars]);

  const bars = useMemo(
    () =>
      projectFilter === "all"
        ? allBars
        : allBars.filter((b) => b.project === projectFilter),
    [allBars, projectFilter],
  );

  const range = useMemo(() => {
    if (!bars.length) {
      return { start: nowMs - 30 * DAY_MS, end: nowMs + 60 * DAY_MS };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const bar of bars) {
      const s = parseDay(bar.start);
      const e = parseDay(bar.end);
      if (s !== null) min = Math.min(min, s);
      if (e !== null) max = Math.max(max, e);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { start: nowMs - 30 * DAY_MS, end: nowMs + 60 * DAY_MS };
    }
    const pad = Math.max(7 * DAY_MS, (max - min) * 0.05);
    return { start: min - pad, end: max + pad };
  }, [bars, nowMs]);

  const span = Math.max(range.end - range.start, DAY_MS);
  const today = nowMs;
  const todayLeft =
    today >= range.start && today <= range.end
      ? ((today - range.start) / span) * 100
      : null;
  const ticks = monthTicks(range.start, range.end);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-[linear-gradient(135deg,#fff7ed_0%,#ffffff_48%,#f8fafc_100%)] px-5 py-5 sm:px-6">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-orange-600 uppercase">
            Schedule
          </p>
          <h2 className="mt-1.5 text-[20px] font-semibold tracking-tight text-slate-900 sm:text-[22px]">
            Project Gantt chart
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-slate-600">
            Linked to New Projects and their phases, activities, and milestones. Progress fill
            uses the record’s progress % when set; otherwise it follows the timeline from start
            to due.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <Label className="mb-1 text-[11px] text-slate-500">Project</Label>
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="h-9 min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800"
              >
                <option value="all">All projects</option>
                {projectNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <Link
              href="/projects?view=projects"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-9")}
            >
              New Project
            </Link>
            <Link
              href="/projects?view=project-updates"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-9")}
            >
              Project Updates
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-6 rounded-sm bg-slate-700/90" /> Project / phase
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-6 rounded-sm bg-orange-500/90" /> Activity
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rotate-45 bg-amber-500" /> Milestone
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-px bg-rose-500" /> Today
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-6 overflow-hidden rounded-sm bg-slate-200">
                <span className="block h-full w-1/2 bg-slate-700/90" />
              </span>{" "}
              Progress fill
            </span>
          </div>
        </div>

        {!bars.length ? (
          <div className="px-5 py-12 text-center sm:px-6">
            <p className="text-[14px] font-medium text-slate-800">No dated schedule yet</p>
            <p className="mt-1 text-[13px] text-slate-500">
              Create a New Project with start and due dates. Phases and activities only appear
              when they belong to that project and have dates.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link
                href="/projects?view=projects"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-9 bg-slate-900 text-white hover:bg-slate-800",
                )}
              >
                Open New Project
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[260px_1fr] border-b border-slate-100 bg-slate-50/80 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                <div className="px-4 py-2">Item</div>
                <div className="relative h-9 overflow-hidden px-2">
                  {ticks.map((tickItem) => (
                    <span
                      key={`${tickItem.label}-${tickItem.left}`}
                      className="absolute top-2 -translate-x-1/2 whitespace-nowrap"
                      style={{ left: `${tickItem.left}%` }}
                    >
                      {tickItem.label}
                    </span>
                  ))}
                </div>
              </div>

              {bars.map((bar) => {
                const start = parseDay(bar.start)!;
                const end = parseDay(bar.end)!;
                const left = ((start - range.start) / span) * 100;
                const width = Math.max(
                  ((end - start) / span) * 100,
                  bar.kind === "milestone" ? 0 : 1.2,
                );
                const fillPct = bar.displayPercent;
                const source =
                  bar.progressPercent !== null
                    ? `progress ${bar.progressPercent}%`
                    : `timeline ${bar.timelinePercent}%`;
                return (
                  <div
                    key={`${bar.kind}-${bar.id}`}
                    className="grid grid-cols-[260px_1fr] border-b border-slate-100 last:border-b-0"
                  >
                    <div className="px-4 py-2.5">
                      <div className="flex items-baseline gap-2">
                        <Link
                          href={bar.href}
                          className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900 hover:underline"
                        >
                          {bar.label}
                        </Link>
                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-700">
                          {fillPct}%
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-slate-500">
                        {kindLabel(bar.kind)} · {bar.project}
                        {bar.detail ? ` · ${bar.detail}` : ""} · {source}
                      </p>
                    </div>
                    <div
                      className="relative h-12"
                      style={{
                        backgroundImage:
                          "linear-gradient(90deg, transparent 0, transparent calc(100% - 1px), #e2e8f0 calc(100% - 1px))",
                        backgroundSize: "12.5% 100%",
                      }}
                    >
                      {todayLeft !== null ? (
                        <div
                          className="pointer-events-none absolute inset-y-0 z-10 w-px bg-rose-500"
                          style={{ left: `${todayLeft}%` }}
                        />
                      ) : null}
                      {bar.kind === "milestone" ? (
                        <Link
                          href={bar.href}
                          title={`${bar.label} · ${bar.start} · ${bar.status} · ${fillPct}%`}
                          className={cn(
                            "absolute top-1/2 z-[5] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 shadow-sm ring-1 ring-white",
                            statusTone(bar.kind, bar.status),
                          )}
                          style={{ left: `${left}%` }}
                        />
                      ) : (
                        <Link
                          href={bar.href}
                          title={`${bar.label} · ${bar.start} → ${bar.end} · ${bar.status} · ${source}`}
                          className={cn(
                            "absolute top-1/2 z-[5] h-6 -translate-y-1/2 overflow-hidden rounded-md shadow-sm ring-1 ring-white/40",
                            statusTrackTone(bar.kind, bar.status),
                          )}
                          style={{ left: `${left}%`, width: `${width}%`, minWidth: 28 }}
                        >
                          <span
                            className={cn(
                              "absolute inset-y-0 left-0",
                              statusTone(bar.kind, bar.status),
                            )}
                            style={{ width: `${fillPct}%` }}
                          />
                          <span className="relative z-[1] block truncate px-2 text-[10px] font-medium leading-6 text-white mix-blend-difference">
                            {fillPct}% · {bar.status}
                          </span>
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
