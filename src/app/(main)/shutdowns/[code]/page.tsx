"use client";

/**
 * One shutdown: its window and machines, the jobs done in it, whether there
 * are people and parts for them, and the production it stops — then starting
 * and finishing it, which starts and ends the planned stops in iag-mes.
 * Planning arithmetic: src/lib/maintenance/shutdown.ts.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Menu, Printer } from "lucide-react";
import { useAppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-auth";
import type { Forecast } from "@/lib/maintenance/calendar";
import { todayIso } from "@/lib/maintenance/planner";
import {
  formatWindow,
  jobHours,
  labour,
  localPlantTime,
  partsReadiness,
  plannedParts,
  plantTime,
  productionConflicts,
  STATUS_LABEL,
  STATUS_TONE,
  suggestions,
  type ScheduleBlock,
  type ShutdownDetail,
} from "@/lib/maintenance/shutdown";
import { useRecordLists } from "@/lib/maintenance/use-record-lists";
import { cn } from "@/lib/utils";

const input =
  "h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900";
const button = "rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] disabled:opacity-40 dark:border-slate-700";

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950", className)}>
      <h2 className="mb-2 text-[13px] font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
      {children}
    </section>
  );
}

type Load<T> = { key: string; data: T | null; error: string };

function useJson<T>(url: string | null, refresh: number): Load<T> & { loading: boolean } {
  const key = url ? `${url}|${refresh}` : "";
  const [state, setState] = useState<Load<T>>({ key: "", data: null, error: "" });
  useEffect(() => {
    if (!url) return;
    let live = true;
    apiFetch(url)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { data?: T; error?: string } | null;
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (live) setState({ key, data: (body?.data ?? null) as T | null, error: "" });
      })
      .catch((err) => live && setState((prev) => ({ key, data: prev.data, error: err instanceof Error ? err.message : "error" })));
    return () => {
      live = false;
    };
  }, [url, key]);
  return { ...state, loading: Boolean(url) && state.key !== key };
}

export default function ShutdownPage() {
  const { openSidebar } = useAppShell();
  const code = decodeURIComponent(String(useParams<{ code: string }>()?.code || ""));
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [agreeBy, setAgreeBy] = useState("");
  const [agreeOn, setAgreeOn] = useState(todayIso());

  const detail = useJson<ShutdownDetail>(`/api/maintenance/shutdowns/${encodeURIComponent(code)}`, refresh);
  const sd = detail.data;
  const forecastUrl = sd
    ? `/api/maintenance/forecast?${new URLSearchParams({
        from: todayIso(),
        to: new Date(Date.parse(sd.ends_at) + 60 * 86_400_000).toISOString().slice(0, 10),
        plant: sd.plant_code,
      })}`
    : null;
  const forecast = useJson<Forecast>(forecastUrl, refresh);
  const scheduleUrl = sd ? `/api/maintenance/production-schedule?${new URLSearchParams({ from: sd.starts_at, to: sd.ends_at })}` : null;
  const schedule = useJson<{ items?: ScheduleBlock[] }>(scheduleUrl, 0);
  const { data } = useRecordLists(["work-orders", "technicians", "spare-parts", "work-centers"], refresh);

  const technicians = useMemo(
    () =>
      (data.technicians || [])
        .filter((t) => !/inactive/i.test(String(t.status || "")))
        .filter((t) => !sd || !t.plant || String(t.plant) === sd.plant_code).length,
    [data, sd],
  );
  const names = useMemo(() => new Map((data["work-centers"] || []).map((m) => [String(m.code), String(m.name || "")])), [data]);
  const work = sd ? labour(sd, technicians) : null;
  const parts = sd ? partsReadiness(sd.work_orders, data["spare-parts"] || []) : [];
  const conflicts = sd ? productionConflicts(schedule.data?.items || [], sd.machines, sd.starts_at, sd.ends_at) : [];
  const ideas = sd ? suggestions(sd, forecast.data?.items || [], data["work-orders"] || []) : [];
  const open = sd ? sd.status === "planned" || sd.status === "in_progress" : false;

  async function act(label: string, path: string, init: RequestInit, done: string) {
    setBusy(label);
    setMessage(null);
    try {
      const res = await apiFetch(path, { headers: { "Content-Type": "application/json" }, ...init });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setMessage({ tone: "ok", text: done });
      setRefresh((n) => n + 1);
      return true;
    } catch (err) {
      setMessage({ tone: "error", text: `${label}: ${err instanceof Error ? err.message : "not done"}` });
      return false;
    } finally {
      setBusy("");
    }
  }

  const base = `/api/maintenance/shutdowns/${encodeURIComponent(code)}`;
  const jobs = (body: Record<string, unknown>, done: string) =>
    act("Jobs", `${base}/jobs`, { method: "POST", body: JSON.stringify(body) }, done);

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
          <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
            {sd?.title || code}{" "}
            {sd ? <span className={cn("ml-1 rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[sd.status])}>{STATUS_LABEL[sd.status]}</span> : null}
          </h1>
          <p className="truncate text-xs text-slate-500">
            {sd ? `${code} · ${sd.plant_code} · ${formatWindow(sd.starts_at, sd.ends_at)} (plant time) · lead ${sd.lead || "not named"}` : "Shutdown"}
          </p>
        </div>
        <Link href={`/shutdowns/${encodeURIComponent(code)}/print`} className={cn(button, "inline-flex items-center gap-1.5")}>
          <Printer size={14} /> Print pack
        </Link>
        {sd?.status === "planned" ? (
          <>
            <button type="button" className={button} onClick={() => setEditing((v) => !v)}>
              {editing ? "Close" : "Change"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              className={button}
              onClick={() =>
                window.confirm(`Cancel ${code}? Its planned stops are dropped and its jobs taken out of it.`) &&
                void act("Cancel", `${base}/cancel`, { method: "POST" }, "Shutdown cancelled.")
              }
            >
              Cancel shutdown
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              className="rounded-lg bg-black px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
              onClick={() =>
                window.confirm(`Start ${code} now? ${sd.machines.length} machine(s) will be marked down.`) &&
                void act("Start", `${base}/start`, { method: "POST" }, "Shutdown started — the machines are down.")
              }
            >
              Start shutdown
            </button>
          </>
        ) : null}
        {sd?.status === "in_progress" ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            className="rounded-lg bg-black px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
            onClick={() =>
              window.confirm(
                sd.open_jobs ? `${sd.open_jobs} job(s) are still open; they stay open after the shutdown. Finish ${code}?` : `Finish ${code}?`,
              ) && void act("Finish", `${base}/finish`, { method: "POST" }, "Shutdown finished — the stops are ended.")
            }
          >
            Finish shutdown
          </button>
        ) : null}
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

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {detail.loading && !sd ? (
          <p className="text-[13px] text-slate-500">Loading {code}…</p>
        ) : !sd ? (
          <p className="text-[13px] text-rose-700">
            Could not load {code}: {detail.error || "not found"}. <Link className="underline" href="/shutdowns">All shutdowns</Link>
          </p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {editing && sd.status === "planned" ? (
              <EditCard
                sd={sd}
                busy={Boolean(busy)}
                onSave={async (patch) => {
                  if (await act("Change", base, { method: "PATCH", body: JSON.stringify(patch) }, "Shutdown changed; the planned stops follow.")) setEditing(false);
                }}
              />
            ) : null}

            <Card title="Production in the window">
              {schedule.error ? (
                <p className="text-[13px] text-amber-800 dark:text-amber-300">Production&apos;s schedule could not be read ({schedule.error}) — check with the planner.</p>
              ) : conflicts.length ? (
                <ul className="text-[13px]">
                  {conflicts.map((b, i) => (
                    <li key={i} className="border-t border-slate-100 py-1 first:border-0 dark:border-slate-800">
                      <span className="font-medium text-rose-700">{b.asset_tag}</span> — {b.label || b.po_num || b.block_type} ·{" "}
                      {formatWindow(b.starts_at, b.ends_at)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-slate-500">{schedule.loading ? "Reading production's schedule…" : "Nothing planned on these machines in the window."}</p>
              )}
              <div className="mt-3 border-t border-slate-100 pt-2 text-[13px] dark:border-slate-800">
                {sd.production_agreed?.by ? (
                  <p>
                    Production agreed: <span className="font-medium">{sd.production_agreed.by}</span>
                    {sd.production_agreed.at ? `, ${String(sd.production_agreed.at).slice(0, 10)}` : ""}
                  </p>
                ) : sd.status === "planned" ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-[12px] text-slate-600 dark:text-slate-300">
                      Production agreed — name
                      <input className={input} value={agreeBy} onChange={(e) => setAgreeBy(e.target.value)} />
                    </label>
                    <label className="text-[12px] text-slate-600 dark:text-slate-300">
                      Date
                      <input className={input} type="date" value={agreeOn} onChange={(e) => setAgreeOn(e.target.value)} />
                    </label>
                    <button
                      type="button"
                      disabled={Boolean(busy) || !agreeBy.trim()}
                      className={button}
                      onClick={() =>
                        void act(
                          "Agreement",
                          `${base}/agree`,
                          { method: "POST", body: JSON.stringify({ signed_by: agreeBy.trim(), signed_on: agreeOn }) },
                          "Production's agreement recorded.",
                        )
                      }
                    >
                      Record
                    </button>
                  </div>
                ) : (
                  <p className="text-slate-500">Production&apos;s agreement was not recorded.</p>
                )}
              </div>
            </Card>

            <Card title={`Machines (${sd.machines.length})`}>
              <table className="w-full text-[13px]">
                <tbody>
                  {sd.machines.map((m) => {
                    const stop = sd.stops.filter((s) => s.asset_tag === m).at(-1);
                    return (
                      <tr key={m} className="border-t border-slate-100 first:border-0 dark:border-slate-800">
                        <td className="py-1">
                          <Link className="font-medium hover:underline" href={`/machines/${encodeURIComponent(m)}`}>
                            {names.get(m) || m}
                          </Link>{" "}
                          <span className="text-slate-500">{m}</span>
                        </td>
                        <td className="py-1 text-right text-slate-600">
                          {stop ? ({ scheduled: "stop planned", open: "stopped now", closed: "stop ended", cancelled: "stop cancelled" } as const)[stop.state] : "no stop"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            <Card title={`Jobs (${sd.jobs}${sd.open_jobs ? `, ${sd.open_jobs} open` : ""})`} className="xl:col-span-2">
              {sd.work_orders.length === 0 ? (
                <p className="text-[13px] text-slate-500">No jobs yet — add them from the suggestions below, or put a work order&apos;s machine in the shutdown first.</p>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-1">Job</th>
                      <th className="py-1">Machine</th>
                      <th className="py-1">Who</th>
                      <th className="py-1 text-right">Hours</th>
                      <th className="py-1">Parts</th>
                      <th className="py-1">Status</th>
                      <th className="py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {sd.work_orders.map((w) => {
                      const h = jobHours(w);
                      const live = w.status !== "completed" && w.status !== "cancelled";
                      return (
                        <tr key={w.num} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="py-1">
                            <Link className="font-medium hover:underline" href={`/work-orders/${encodeURIComponent(w.num)}/enter`}>
                              {w.num}
                            </Link>{" "}
                            {w.title}
                            {(w.attrs || {}).contractor ? <span className="text-slate-500"> · {String((w.attrs || {}).contractor)}</span> : null}
                          </td>
                          <td className="py-1">{w.asset_tag}</td>
                          <td className="py-1">{w.assignee || "—"}</td>
                          <td className="py-1 text-right">{h.estimated ? h.hours : `${h.hours}?`}</td>
                          <td className="py-1 text-[12px] text-slate-600">
                            {plannedParts(w).map((p) => `${p.qty} × ${p.sku}`).join(", ") || String((w.attrs || {}).partsRequired || "") || "—"}
                          </td>
                          <td className="py-1">{w.status.replace("_", " ")}</td>
                          <td className="py-1 text-right">
                            {live && open ? (
                              <button type="button" disabled={Boolean(busy)} className="text-[12px] text-sky-700 underline disabled:opacity-40 dark:text-sky-400" onClick={() => void jobs({ remove: [w.num] }, `${w.num} taken out.`)}>
                                Take out
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>

            {work ? (
              <Card title="People">
                <p className={cn("text-[13px]", work.short ? "font-semibold text-rose-700" : "")}>
                  {work.needed} person-hours of open work against {work.available} available
                  {work.short ? " — not enough people for the window" : ""}.
                </p>
                <p className="mt-1 text-[12px] text-slate-500">
                  {technicians} technician{technicians === 1 ? "" : "s"} × 8 h a day over the window.
                  {work.unestimated ? ` ${work.unestimated} job${work.unestimated === 1 ? " has" : "s have"} no estimate and count as 2 h.` : ""}
                </p>
              </Card>
            ) : null}

            <Card title="Parts">
              {parts.length === 0 ? (
                <p className="text-[13px] text-slate-500">No planned parts on these jobs. Preventive jobs get them from their template&apos;s &ldquo;Parts per job&rdquo;.</p>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <tbody>
                    {parts.map((p) => (
                      <tr key={p.sku} className="border-t border-slate-100 first:border-0 dark:border-slate-800">
                        <td className="py-1">
                          <span className="font-medium">{p.sku}</span> <span className="text-slate-500">{p.name || (p.known ? "" : "not in the catalogue")}</span>
                        </td>
                        <td className="py-1 text-right">
                          {p.needed} needed · {p.onHand} in stock
                        </td>
                        <td className={cn("py-1 text-right", p.short ? "font-semibold text-rose-700" : "text-emerald-700")}>{p.short ? `${p.short} short` : "ready"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {parts.some((p) => p.short) ? (
                <p className="mt-2 text-[12px]">
                  <Link className="underline" href={`/parts-forecast?factory=${encodeURIComponent(sd.plant_code)}`}>
                    Order from the parts forecast
                  </Link>
                </p>
              ) : null}
            </Card>

            {open ? (
              <Card title={`Could go in (${ideas.length})`} className="xl:col-span-2">
                {forecast.error ? <p className="mb-2 text-[12px] text-amber-800">The preventive forecast could not be read ({forecast.error}).</p> : null}
                {ideas.length === 0 ? (
                  <p className="text-[13px] text-slate-500">Nothing else is due on these machines in the 60 days after the shutdown, and no open job waits on them.</p>
                ) : (
                  <ul className="text-[13px]">
                    {ideas.map((s) => (
                      <li key={s.kind === "schedule" ? s.scheduleId : s.num} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-1 first:border-0 dark:border-slate-800">
                        <span>
                          <span className="font-medium">{s.machine}</span> — {s.kind === "work-order" ? `${s.num} ${s.title}` : s.title}
                          <span className="text-slate-500">
                            {s.due ? ` · due ${s.due}` : ""}
                            {s.kind === "schedule" ? (s.overdue ? " · overdue" : " · preventive, brought forward") : ""}
                          </span>
                        </span>
                        <button
                          type="button"
                          disabled={Boolean(busy)}
                          className="text-[12px] text-sky-700 underline disabled:opacity-40 dark:text-sky-400"
                          onClick={() =>
                            void (s.kind === "schedule"
                              ? jobs({ schedules: [s.scheduleId] }, `${s.title} on ${s.machine} brought into the shutdown.`)
                              : jobs({ add: [s.num] }, `${s.num} added.`))
                          }
                        >
                          Add
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ) : null}

            {sd.notes ? (
              <Card title="Notes" className="xl:col-span-2">
                <p className="whitespace-pre-wrap text-[13px]">{sd.notes}</p>
              </Card>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function EditCard({
  sd,
  busy,
  onSave,
}: {
  sd: ShutdownDetail;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState(sd.title);
  const [starts, setStarts] = useState(localPlantTime(sd.starts_at));
  const [ends, setEnds] = useState(localPlantTime(sd.ends_at));
  const [lead, setLead] = useState(sd.lead);
  const [notes, setNotes] = useState(sd.notes || "");
  const [machines, setMachines] = useState(sd.machines.join(", "));
  return (
    <Card title="Change the shutdown" className="xl:col-span-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-[12px] text-slate-600 sm:col-span-2 dark:text-slate-300">
          Title
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="text-[12px] text-slate-600 dark:text-slate-300">
          Machines stop at
          <input className={input} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
        </label>
        <label className="text-[12px] text-slate-600 dark:text-slate-300">
          Back in production at
          <input className={input} type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
        </label>
        <label className="text-[12px] text-slate-600 dark:text-slate-300">
          Led by
          <input className={input} value={lead} onChange={(e) => setLead(e.target.value)} />
        </label>
        <label className="text-[12px] text-slate-600 sm:col-span-2 lg:col-span-3 dark:text-slate-300">
          Machines (asset codes, comma-separated — a machine taken off has its stop cancelled and its jobs taken out)
          <input className={input} value={machines} onChange={(e) => setMachines(e.target.value)} />
        </label>
        <label className="text-[12px] text-slate-600 sm:col-span-2 lg:col-span-4 dark:text-slate-300">
          Notes
          <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <button
        type="button"
        disabled={busy}
        className="mt-3 rounded-lg bg-black px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40"
        onClick={() =>
          void onSave({
            title: title.trim(),
            starts_at: plantTime(starts),
            ends_at: plantTime(ends),
            lead: lead.trim(),
            notes: notes.trim(),
            machines: machines
              .split(/[,\s]+/)
              .map((m) => m.trim())
              .filter(Boolean),
          })
        }
      >
        Save changes
      </button>
    </Card>
  );
}
