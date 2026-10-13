"use client";

/**
 * The annual maintenance calendar: every preventive job the next twelve
 * months hold, machines down the side and weeks across, with the week's load
 * against what the technicians can do. From iag-mes's forecast
 * (src/lib/maintenance/calendar.ts); nothing here is stored.
 *
 * A job's next date can be moved here (it is the schedule's next due date);
 * the ones after it follow from it. Printed, it is the year's plan on A3.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Menu, Printer } from "lucide-react";
import { useAppShell } from "@/components/app-shell";
import { FACTORY_PARAM, FactoryScopeSelect } from "@/components/factory-scope-select";
import { apiFetch } from "@/lib/api-auth";
import {
  buildCalendar,
  personHours,
  shiftMonths,
  weeklyCapacity,
  yearFrom,
  type Forecast,
  type ForecastItem,
} from "@/lib/maintenance/calendar";
import { todayIso } from "@/lib/maintenance/planner";
import { useRecordLists } from "@/lib/maintenance/use-record-lists";
import { cn } from "@/lib/utils";

type Picked = { tag: string; week: string };

function MoveJob({ item, onMoved }: { item: ForecastItem; onMoved: (text: string, tone: "ok" | "error") => void }) {
  const [day, setDay] = useState(item.due_on);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/records/production/pm-schedules/${encodeURIComponent(item.schedule_id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextDue: day }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      onMoved(`${item.template_name} on ${item.asset_tag} moved to ${day}; the jobs after it follow.`, "ok");
    } catch (err) {
      onMoved(`Not moved: ${err instanceof Error ? err.message : "error"}`, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="date"
        value={day}
        onChange={(e) => setDay(e.target.value)}
        aria-label={`New date for ${item.template_name} on ${item.asset_tag}`}
        className="h-7 rounded border border-slate-300 bg-white px-1 text-[12px] dark:border-slate-700 dark:bg-slate-900"
      />
      <button
        type="button"
        disabled={busy || !day || day === item.due_on}
        onClick={() => void save()}
        className="h-7 rounded bg-black px-2 text-[12px] font-medium text-white disabled:opacity-40"
      >
        Move
      </button>
    </span>
  );
}

export default function MaintenanceCalendarPage() {
  const { openSidebar } = useAppShell();
  const factory = (useSearchParams().get(FACTORY_PARAM) || "").trim();
  const [start, setStart] = useState(() => yearFrom(todayIso()).from);
  const range = useMemo(() => yearFrom(start), [start]);
  const [section, setSection] = useState("");
  const [refresh, setRefresh] = useState(0);
  // What was last read, and for which request: loading is "the answer on
  // screen is for another request", so no state is set as an effect starts.
  const [answer, setAnswer] = useState<{ key: string; forecast: Forecast | null; error: string }>({ key: "", forecast: null, error: "" });
  const requestKey = `${range.from}|${range.to}|${factory}|${refresh}`;
  const loading = answer.key !== requestKey;
  const forecast = answer.forecast;
  const error = loading ? "" : answer.error;
  const [picked, setPicked] = useState<Picked | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const { data } = useRecordLists(["technicians"], 0);

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ from: range.from, to: range.to, ...(factory ? { plant: factory } : {}) });
    apiFetch(`/api/maintenance/forecast?${q}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { ok?: boolean; data?: Forecast; error?: string } | null;
        if (!res.ok || !body?.data) throw new Error(body?.error || `HTTP ${res.status}`);
        if (live) setAnswer({ key: requestKey, forecast: body.data, error: "" });
      })
      .catch((err) => {
        if (live) {
          setAnswer((prev) => ({
            key: requestKey,
            forecast: prev.forecast,
            error: err instanceof Error ? err.message : "The forecast could not be read.",
          }));
        }
      });
    return () => {
      live = false;
    };
  }, [range.from, range.to, factory, requestKey]);

  const calendar = useMemo(
    () => buildCalendar(forecast || { from: range.from, to: range.to, items: [] }, { section }),
    [forecast, range, section],
  );
  const sections = useMemo(
    () => [...new Set((forecast?.items || []).map((i) => i.section_code).filter(Boolean))].sort(),
    [forecast],
  );
  const technicians = useMemo(
    () =>
      (data.technicians || [])
        .filter((t) => !/inactive/i.test(String(t.status || "")))
        .filter((t) => !factory || !t.plant || String(t.plant) === factory).length,
    [data, factory],
  );
  const capacity = weeklyCapacity(technicians);
  const thisWeek = calendar.weeks.find((w) => w.start <= todayIso() && todayIso() <= w.end)?.start;
  const pickedJobs = picked ? calendar.rows.find((r) => r.tag === picked.tag)?.cells.get(picked.week) || [] : [];
  const totals = useMemo(() => {
    let jobs = 0;
    let hours = 0;
    for (const l of calendar.load.values()) {
      jobs += l.jobs;
      hours += l.hours;
    }
    return { jobs, hours };
  }, [calendar]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <style>{`@media print { @page { size: A3 landscape; margin: 8mm; } }`}</style>
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800" data-print-hide>
        <button
          type="button"
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={openSidebar}
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">Maintenance calendar</h1>
          <p className="truncate text-xs text-slate-500">
            {range.from} to {range.to} · every preventive job, by machine and week
          </p>
        </div>
        <FactoryScopeSelect />
        <select
          value={section}
          onChange={(e) => setSection(e.target.value)}
          aria-label="Shop floor"
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="">All shop floors</option>
          {sections.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="A month earlier" onClick={() => setStart(shiftMonths(start, -1))} className="rounded-md border border-slate-200 p-1.5 dark:border-slate-700">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => setStart(yearFrom(todayIso()).from)} className="rounded-md border border-slate-200 px-2.5 py-1 text-[12px] dark:border-slate-700">
            From this month
          </button>
          <button type="button" aria-label="A month later" onClick={() => setStart(shiftMonths(start, 1))} className="rounded-md border border-slate-200 p-1.5 dark:border-slate-700">
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] dark:border-slate-700"
        >
          <Printer size={14} /> Print (A3)
        </button>
      </header>

      {message ? (
        <p
          role="status"
          data-print-hide
          className={cn(
            "border-b px-4 py-2 text-[13px]",
            message.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200",
          )}
        >
          {message.text}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading && !forecast ? (
          <p className="text-[13px] text-slate-500">Loading the forecast…</p>
        ) : error && !forecast ? (
          <p className="text-[13px] text-rose-700">Could not load the forecast: {error}</p>
        ) : (
          <div data-print-area className="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100 print:bg-white print:text-black">
            {error ? (
              <p data-print-hide className="mb-2 text-[12px] text-rose-700">
                Could not refresh the forecast ({error}); showing the last one read.
              </p>
            ) : null}
            <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
              <h2 className="text-[14px] font-semibold">
                Preventive maintenance plan {range.from.slice(0, 7)} – {range.to.slice(0, 7)}
                {factory ? ` · ${factory}` : ""}
                {section ? ` · ${section}` : ""}
              </h2>
              <span className="text-slate-500">
                {totals.jobs} jobs · {Math.round(totals.hours)} person-hours ·{" "}
                {technicians ? `${technicians} technician${technicians === 1 ? "" : "s"}, ${capacity} h a week` : "no technicians listed"}
              </span>
              <span className="flex items-center gap-3 text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-sky-600" /> due by date
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-sky-700 bg-sky-100" /> estimated from running hours
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-rose-600" /> overdue
                </span>
              </span>
            </div>

            {calendar.rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-[13px] text-slate-500 dark:border-slate-700">
                No preventive jobs fall in this year{factory ? ` at ${factory}` : ""}. Add PM templates and schedule them on machines under{" "}
                <Link className="underline" href="/production?view=pm-schedules">
                  Schedules
                </Link>
                .
              </p>
            ) : (
              <table className="border-separate border-spacing-0 text-[11px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white dark:bg-slate-950" />
                    {calendar.months.map((m) => (
                      <th key={m.month} colSpan={m.weeks} className="border-l border-slate-300 px-1 text-left font-semibold dark:border-slate-700">
                        {m.month}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    <th className="sticky left-0 z-10 min-w-44 bg-white pr-2 text-left font-medium text-slate-500 dark:bg-slate-950">Machine</th>
                    {calendar.weeks.map((w) => (
                      <th
                        key={w.start}
                        title={`Week of ${w.start}`}
                        className={cn("w-6 min-w-6 text-center font-normal", w.start === thisWeek ? "text-sky-700 dark:text-sky-400" : "text-slate-500")}
                      >
                        {w.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calendar.rows.map((row) => (
                    <tr key={row.tag}>
                      <th className="sticky left-0 z-10 bg-white py-0.5 pr-2 text-left font-normal dark:bg-slate-950">
                        <Link href={`/machines/${encodeURIComponent(row.tag)}`} className="font-medium hover:underline">
                          {row.name || row.tag}
                        </Link>{" "}
                        <span className="text-slate-500">
                          {row.tag}
                          {row.section ? ` · ${row.section}` : ""}
                        </span>
                      </th>
                      {calendar.weeks.map((w) => {
                        const jobs = row.cells.get(w.start) || [];
                        const overdue = jobs.some((j) => j.overdue);
                        const estimated = jobs.length > 0 && jobs.every((j) => j.estimated);
                        const isPicked = picked?.tag === row.tag && picked.week === w.start;
                        return (
                          <td key={w.start} className={cn("h-6 border-l border-t border-slate-100 p-0 text-center dark:border-slate-800", w.start === thisWeek && "bg-sky-50/60 dark:bg-sky-950/30")}>
                            {jobs.length ? (
                              <button
                                type="button"
                                onClick={() => setPicked(isPicked ? null : { tag: row.tag, week: w.start })}
                                title={jobs.map((j) => `${j.template_name} — ${j.due_on}${j.estimated ? " (estimated)" : ""}${j.overdue ? " (overdue)" : ""}`).join("\n")}
                                aria-label={`${row.tag}, week of ${w.start}: ${jobs.length} job${jobs.length === 1 ? "" : "s"}`}
                                className={cn(
                                  "mx-auto flex h-5 w-5 items-center justify-center rounded-sm text-[10px] font-semibold",
                                  overdue
                                    ? "bg-rose-600 text-white"
                                    : estimated
                                      ? "border border-dashed border-sky-700 bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100"
                                      : "bg-sky-600 text-white",
                                  isPicked && "ring-2 ring-black ring-offset-1 dark:ring-white",
                                )}
                              >
                                {jobs.length}
                              </button>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th className="sticky left-0 z-10 bg-white pr-2 pt-1 text-left font-medium text-slate-600 dark:bg-slate-950">
                      Person-hours / {capacity || "?"} h
                    </th>
                    {calendar.weeks.map((w) => {
                      const l = calendar.load.get(w.start)!;
                      const over = capacity > 0 && l.hours > capacity;
                      return (
                        <td
                          key={w.start}
                          title={`${l.jobs} job${l.jobs === 1 ? "" : "s"}, ${l.hours} person-hours${l.unestimated ? `, ${l.unestimated} without an estimate (counted at 2 h)` : ""}${over ? " — over capacity" : ""}`}
                          className={cn("border-l border-t border-slate-300 pt-1 text-center text-[10px] dark:border-slate-700", over ? "font-bold text-rose-700 dark:text-rose-400" : "text-slate-600")}
                        >
                          {l.jobs ? Math.round(l.hours) : ""}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            )}

            {forecast?.gaps.length ? (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-semibold">Not on the calendar by running hours ({forecast.gaps.length})</p>
                <ul>
                  {forecast.gaps.map((g) => (
                    <li key={g.schedule_id}>
                      {g.asset_tag} · {g.template_code}: {g.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        {picked && pickedJobs.length ? (
          <section data-print-hide className="mt-4 max-w-3xl rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <h2 className="mb-2 text-[13px] font-semibold">
              {picked.tag} · week of {picked.week}
            </h2>
            <ul className="grid gap-2 text-[13px]">
              {pickedJobs.map((j) => {
                const { hours, estimated } = personHours(j);
                return (
                  <li key={`${j.schedule_id}-${j.occurrence}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 first:border-0 first:pt-0 dark:border-slate-800">
                    <span>
                      <span className="font-medium">{j.template_name}</span> ({j.template_code}) — due {j.due_on}
                      {j.overdue ? <span className="ml-1 font-semibold text-rose-700">overdue</span> : null}
                      {j.estimated ? <span className="ml-1 text-slate-500">estimated from running hours</span> : null}
                      <span className="block text-[12px] text-slate-500">
                        {estimated ? `${hours} person-hours` : `no estimate (counted at ${hours} h)`} ·{" "}
                        {j.fixed_dates ? "fixed dates" : "dates count from when the last job was done"}
                        {j.work_order ? (
                          <>
                            {" · "}
                            <Link className="underline" href={`/work-orders/print?nums=${encodeURIComponent(j.work_order)}`}>
                              {j.work_order}
                            </Link>{" "}
                            raised
                          </>
                        ) : null}
                      </span>
                    </span>
                    {j.occurrence === 0 ? (
                      <MoveJob
                        item={j}
                        onMoved={(text, tone) => {
                          setMessage({ text, tone });
                          if (tone === "ok") {
                            setPicked(null);
                            setRefresh((n) => n + 1);
                          }
                        }}
                      />
                    ) : (
                      <span className="text-[12px] text-slate-500">Follows the job before it — move that one.</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
