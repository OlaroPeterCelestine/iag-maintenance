"use client";

/**
 * Shutdowns: planned stoppages of some of a factory's machines, for the
 * maintenance that needs them stopped. Planning one puts a planned stop on
 * each machine in iag-mes, which production sees before it happens; the
 * shutdown's own page fills it with jobs and runs it.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Menu } from "lucide-react";
import { useAppShell } from "@/components/app-shell";
import { FACTORY_PARAM, FactoryScopeSelect } from "@/components/factory-scope-select";
import { apiFetch } from "@/lib/api-auth";
import { formatWindow, plantTime, STATUS_LABEL, STATUS_TONE, type Shutdown, type ShutdownDetail } from "@/lib/maintenance/shutdown";
import { useRecordLists } from "@/lib/maintenance/use-record-lists";
import { cn } from "@/lib/utils";

const input =
  "h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900";

function PlanForm({ factory, onPlanned }: { factory: string; onPlanned: (code: string) => void }) {
  const { data } = useRecordLists(["work-centers", "technicians"], 0);
  const machines = useMemo(
    () =>
      (data["work-centers"] || [])
        .filter((m) => String(m.plantCode || "") === factory && !/retired/i.test(String(m.status || "")))
        .sort((a, b) => String(a.section || "").localeCompare(String(b.section || "")) || String(a.code).localeCompare(String(b.code))),
    [data, factory],
  );
  const [title, setTitle] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [lead, setLead] = useState("");
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function plan() {
    setError("");
    if (!title.trim() || !starts || !ends || !picked.size) {
      setError("A shutdown needs a title, a start, an end and at least one machine.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch("/api/maintenance/shutdowns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plant: factory,
          title: title.trim(),
          starts_at: plantTime(starts),
          ends_at: plantTime(ends),
          lead: lead.trim(),
          notes: notes.trim(),
          machines: [...picked],
        }),
      });
      const body = (await res.json().catch(() => null)) as { data?: ShutdownDetail; error?: string } | null;
      if (!res.ok || !body?.data) throw new Error(body?.error || `HTTP ${res.status}`);
      onPlanned(body.data.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not planned.");
    } finally {
      setBusy(false);
    }
  }

  const bySection = new Map<string, typeof machines>();
  for (const m of machines) bySection.set(String(m.section || "—"), [...(bySection.get(String(m.section || "—")) || []), m]);

  return (
    <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <h2 className="mb-3 text-[13px] font-semibold">Plan a shutdown at {factory}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-[12px] text-slate-600 sm:col-span-2 dark:text-slate-300">
          Title
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Annual dry mill shutdown" />
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
          <input className={input} list="shutdown-leads" value={lead} onChange={(e) => setLead(e.target.value)} />
        </label>
        <label className="text-[12px] text-slate-600 sm:col-span-2 lg:col-span-3 dark:text-slate-300">
          Notes
          <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Scope, contractors, safety — anything everyone should know" />
        </label>
      </div>
      <fieldset className="mt-3">
        <legend className="mb-1 text-[12px] text-slate-600 dark:text-slate-300">
          Machines to stop ({picked.size} picked){" "}
          <button type="button" className="ml-2 text-sky-700 underline dark:text-sky-400" onClick={() => setPicked(new Set(machines.map((m) => String(m.code))))}>
            whole factory
          </button>
          <button type="button" className="ml-2 text-sky-700 underline dark:text-sky-400" onClick={() => setPicked(new Set())}>
            none
          </button>
        </legend>
        {machines.length === 0 ? (
          <p className="text-[12px] text-slate-500">No machines registered at {factory}.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...bySection.entries()].map(([section, list]) => (
              <div key={section} className="rounded-lg border border-slate-100 p-2 dark:border-slate-800">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{section}</p>
                {list.map((m) => {
                  const code = String(m.code);
                  return (
                    <label key={code} className="flex items-center gap-2 text-[13px]">
                      <input
                        type="checkbox"
                        checked={picked.has(code)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(code);
                          else next.delete(code);
                          setPicked(next);
                        }}
                      />
                      {m.name || code} <span className="text-slate-500">{code}</span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </fieldset>
      {error ? <p role="alert" className="mt-2 text-[13px] text-rose-700">{error}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void plan()}
        className="mt-3 rounded-lg bg-black px-4 py-2 text-[13px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
      >
        {busy ? "Planning…" : "Plan the shutdown"}
      </button>
      <datalist id="shutdown-leads">
        {(data.technicians || []).map((t) => (
          <option key={String(t.id)} value={String(t.name || "")} />
        ))}
      </datalist>
    </section>
  );
}

export default function ShutdownsPage() {
  const { openSidebar } = useAppShell();
  const router = useRouter();
  const factory = (useSearchParams().get(FACTORY_PARAM) || "").trim();
  const [planning, setPlanning] = useState(false);
  const [answer, setAnswer] = useState<{ key: string; items: Shutdown[]; error: string }>({ key: "", items: [], error: "" });
  const loading = answer.key !== factory;

  useEffect(() => {
    let live = true;
    apiFetch(`/api/maintenance/shutdowns${factory ? `?plant=${encodeURIComponent(factory)}` : ""}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { data?: { items?: Shutdown[] }; error?: string } | null;
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (live) setAnswer({ key: factory, items: body?.data?.items || [], error: "" });
      })
      .catch((err) => live && setAnswer({ key: factory, items: [], error: err instanceof Error ? err.message : "error" }));
    return () => {
      live = false;
    };
  }, [factory]);

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
          <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">Shutdowns</h1>
          <p className="truncate text-xs text-slate-500">Planned stoppages, and the maintenance done while the machines are stopped</p>
        </div>
        <FactoryScopeSelect />
        <button
          type="button"
          onClick={() => setPlanning((v) => !v)}
          disabled={!factory}
          title={factory ? undefined : "Pick the factory first"}
          className="rounded-lg bg-black px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
        >
          {planning ? "Close" : "Plan a shutdown"}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!factory ? <p className="mb-3 text-[12px] text-slate-500">Pick a factory to plan a shutdown there.</p> : null}
        {planning && factory ? <PlanForm factory={factory} onPlanned={(code) => router.push(`/shutdowns/${encodeURIComponent(code)}`)} /> : null}
        {loading ? (
          <p className="text-[13px] text-slate-500">Loading shutdowns…</p>
        ) : answer.error ? (
          <p className="text-[13px] text-rose-700">Could not load shutdowns: {answer.error}</p>
        ) : answer.items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-[13px] text-slate-500 dark:border-slate-700">
            No shutdowns {factory ? `at ${factory} ` : ""}yet.
          </p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2">Shutdown</th>
                <th className="px-3 py-2">Window (plant time)</th>
                <th className="px-3 py-2">Machines</th>
                <th className="px-3 py-2">Jobs</th>
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {answer.items.map((s) => (
                <tr key={s.code} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2">
                    <Link className="font-medium hover:underline" href={`/shutdowns/${encodeURIComponent(s.code)}`}>
                      {s.title}
                    </Link>
                    <span className="block text-[11px] text-slate-500">
                      {s.code} · {s.plant_code}
                    </span>
                  </td>
                  <td className="px-3 py-2">{formatWindow(s.starts_at, s.ends_at)}</td>
                  <td className="px-3 py-2">{s.machines.length}</td>
                  <td className="px-3 py-2">
                    {s.jobs}
                    {s.open_jobs ? <span className="text-slate-500"> ({s.open_jobs} open)</span> : null}
                  </td>
                  <td className="px-3 py-2">{s.lead || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[s.status])}>{STATUS_LABEL[s.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
