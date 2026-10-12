"use client";

/**
 * The scheduling board: technicians down the side, the week across the top,
 * and every live work order either on a day or waiting in the backlog.
 *
 * Planning is putting a job in a cell — drag it, or use its Move menu, which
 * also works on a phone and from the keyboard. A day whose jobs add up to more
 * than a shift is marked overbooked; a job with no estimate counts as two
 * hours, and says so, rather than taking no room.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { useAppShell } from "@/components/app-shell";
import { FACTORY_PARAM, FactoryScopeSelect } from "@/components/factory-scope-select";
import { apiFetch } from "@/lib/api-auth";
import type { Rec } from "@/lib/maintenance/machine-summary";
import {
  DAY_CAPACITY_HOURS,
  UNASSIGNED,
  cellKey,
  cellLoad,
  hoursOf,
  layoutBoard,
  shiftWeek,
  todayIso,
  weekOf,
} from "@/lib/maintenance/planner";
import { useRecordLists } from "@/lib/maintenance/use-record-lists";
import { cn } from "@/lib/utils";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function JobCard({
  order,
  technicians,
  days,
  onMove,
  busy,
}: {
  order: Rec;
  technicians: string[];
  days: string[];
  onMove: (order: Rec, technician: string | null, day: string) => void;
  busy: boolean;
}) {
  const { hours, estimated } = hoursOf(order);
  const [tech, setTech] = useState(String(order.assignee || ""));
  const [day, setDay] = useState(String(order.plannedStart || "").slice(0, 10));
  const critical = /critical|high/i.test(String(order.priority || ""));
  return (
    <div
      draggable={!busy}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(order.num || order.id))}
      className={cn(
        "mb-1.5 cursor-grab rounded-md border bg-white px-2 py-1.5 text-[12px] shadow-sm dark:bg-slate-900",
        critical ? "border-l-4 border-l-rose-500 border-slate-200 dark:border-slate-700" : "border-slate-200 dark:border-slate-700",
        busy && "opacity-50",
      )}
    >
      <div className="flex justify-between gap-2">
        <span className="font-semibold text-slate-900 dark:text-slate-50">{order.num}</span>
        <span className="text-slate-500">{estimated ? `${hours} h` : `${hours} h?`}</span>
      </div>
      <p className="line-clamp-2 text-slate-700 dark:text-slate-300">{order.title}</p>
      <p className="text-slate-500">
        {order.workCenter}
        {order.priority ? ` · ${order.priority}` : ""}
      </p>
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-sky-700 dark:text-sky-400">Move…</summary>
        <div className="mt-1 grid gap-1">
          <select
            value={tech}
            onChange={(e) => setTech(e.target.value)}
            className="h-7 rounded border border-slate-300 bg-white px-1 text-[12px] dark:bg-slate-900"
            aria-label={`Technician for ${order.num}`}
          >
            {technicians.map((t) => (
              <option key={t || "none"} value={t}>
                {t || "Unassigned"}
              </option>
            ))}
          </select>
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="h-7 rounded border border-slate-300 bg-white px-1 text-[12px] dark:bg-slate-900"
            aria-label={`Day for ${order.num}`}
          >
            <option value="">Not planned (backlog)</option>
            {days.map((d, i) => (
              <option key={d} value={d}>
                {DAY_NAMES[i]} {d.slice(5)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => onMove(order, tech, day)}
            className="h-7 rounded bg-black text-[12px] font-medium text-white disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </details>
    </div>
  );
}

export default function PlannerPage() {
  const { openSidebar } = useAppShell();
  const factory = (useSearchParams().get(FACTORY_PARAM) || "").trim();
  const [anchor, setAnchor] = useState(() => todayIso());
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const { data, loading, errors } = useRecordLists(["work-orders", "technicians", "work-centers"], refresh);
  const days = useMemo(() => weekOf(anchor), [anchor]);

  const orders = useMemo(() => {
    const all = data["work-orders"] || [];
    if (!factory) return all;
    const plantOf = new Map((data["work-centers"] || []).map((m) => [String(m.code || ""), String(m.plantCode || "")]));
    return all.filter((o) => plantOf.get(String(o.workCenter || "")) === factory);
  }, [data, factory]);

  const knownTechs = useMemo(
    () =>
      (data.technicians || [])
        .filter((t) => !/inactive/i.test(String(t.status || "")))
        .filter((t) => !factory || !t.plant || String(t.plant) === factory)
        .map((t) => String(t.name || "")),
    [data, factory],
  );
  const board = useMemo(() => layoutBoard(orders, knownTechs, days), [orders, knownTechs, days]);

  /** technician null keeps whoever has the job (a drop back into the backlog). */
  async function move(order: Rec, technician: string | null, day: string) {
    const num = String(order.num || order.id);
    setBusy(num);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/records/production/work-orders/${encodeURIComponent(num)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(technician === null ? { plannedStart: day } : { assignee: technician, plannedStart: day }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setMessage({
        tone: "ok",
        text: day ? `${num} planned for ${technician || order.assignee || "nobody yet"} on ${day}.` : `${num} back in the backlog.`,
      });
      setRefresh((n) => n + 1);
    } catch (err) {
      setMessage({ tone: "error", text: `${num} was not moved: ${err instanceof Error ? err.message : "error"}` });
    } finally {
      setBusy(null);
    }
  }

  function onDrop(e: React.DragEvent, technician: string | null, day: string) {
    e.preventDefault();
    const num = e.dataTransfer.getData("text/plain");
    const order = orders.find((o) => String(o.num || o.id) === num);
    if (order) void move(order, technician, day);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <button
          type="button"
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={openSidebar}
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">Maintenance planner</h1>
          <p className="truncate text-xs text-slate-500">
            Week of {days[0]} · a day holds {DAY_CAPACITY_HOURS} h of planned work per technician
          </p>
        </div>
        <FactoryScopeSelect />
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous week" onClick={() => setAnchor(shiftWeek(anchor, -1))} className="rounded-md border border-slate-200 p-1.5 dark:border-slate-700">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => setAnchor(todayIso())} className="rounded-md border border-slate-200 px-2.5 py-1 text-[12px] dark:border-slate-700">
            This week
          </button>
          <button type="button" aria-label="Next week" onClick={() => setAnchor(shiftWeek(anchor, 1))} className="rounded-md border border-slate-200 p-1.5 dark:border-slate-700">
            <ChevronRight size={16} />
          </button>
        </div>
      </header>

      {message ? (
        <p
          role="status"
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

      <div className="flex min-h-0 flex-1 gap-3 overflow-auto p-4">
        {loading ? (
          <p className="text-[13px] text-slate-500">Loading work orders…</p>
        ) : errors["work-orders"] ? (
          <p className="text-[13px] text-rose-700">Could not load work orders: {errors["work-orders"]}</p>
        ) : (
          <>
            <aside
              className="w-56 shrink-0 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, null, "")}
              aria-label="Backlog"
            >
              <h2 className="mb-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
                Backlog ({board.backlog.length})
              </h2>
              {board.backlog.length ? (
                board.backlog.map((o) => (
                  <JobCard key={o.id} order={o} technicians={board.technicians} days={days} onMove={move} busy={busy === o.num} />
                ))
              ) : (
                <p className="px-1 text-[12px] text-slate-500">Everything live is planned.</p>
              )}
            </aside>

            <table className="min-w-[900px] flex-1 border-separate border-spacing-1 text-left">
              <thead>
                <tr>
                  <th className="w-36 text-[12px] font-medium text-slate-500">Technician</th>
                  {days.map((d, i) => (
                    <th
                      key={d}
                      className={cn(
                        "text-[12px] font-medium",
                        d === todayIso() ? "text-sky-700 dark:text-sky-400" : "text-slate-500",
                      )}
                    >
                      {DAY_NAMES[i]} <span className="font-normal">{d.slice(5)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board.technicians.map((tech) => (
                  <tr key={tech || "unassigned"}>
                    <th className="align-top text-[13px] font-medium text-slate-800 dark:text-slate-100">
                      {tech || <span className="text-slate-500">Unassigned</span>}
                    </th>
                    {days.map((day) => {
                      const jobs = board.cells.get(cellKey(tech || UNASSIGNED, day)) || [];
                      const load = cellLoad(jobs);
                      return (
                        <td
                          key={day}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => onDrop(e, tech, day)}
                          className={cn(
                            "min-h-20 w-36 rounded-lg border p-1.5 align-top",
                            load.over
                              ? "border-rose-300 bg-rose-50/60 dark:border-rose-800 dark:bg-rose-950/40"
                              : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950",
                          )}
                        >
                          {jobs.length ? (
                            <p className={cn("mb-1 flex justify-between gap-1 text-[11px]", load.over ? "font-semibold text-rose-700 dark:text-rose-300" : "text-slate-500")}>
                              <span>
                                {load.over ? "⚠ Overbooked · " : ""}
                                {load.hours} / {DAY_CAPACITY_HOURS} h
                                {load.unestimated ? ` · ${load.unestimated} unestimated` : ""}
                              </span>
                              {/* This technician's sheets for the day, one page each. */}
                              <Link
                                href={`/work-orders/print?nums=${encodeURIComponent(jobs.map((o) => String(o.num)).join(","))}`}
                                className="font-normal text-sky-700 underline dark:text-sky-400"
                                title={`Print ${jobs.length} job sheet${jobs.length === 1 ? "" : "s"}`}
                              >
                                Print
                              </Link>
                            </p>
                          ) : null}
                          {jobs.map((o) => (
                            <JobCard key={o.id} order={o} technicians={board.technicians} days={days} onMove={move} busy={busy === o.num} />
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      <p className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-800">
        Jobs come from <Link className="underline" href="/production?view=work-orders">Work Orders</Link>. A job with no
        estimate counts as 2 h — add Estimated hours to plan it properly.
      </p>
    </div>
  );
}
