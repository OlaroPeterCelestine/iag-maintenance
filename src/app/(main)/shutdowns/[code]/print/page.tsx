"use client";

/**
 * A shutdown's pack, for the morning it starts: a summary page — the window,
 * the machines, every job with who does it and what it needs, the parts and
 * the people — then the job sheet for each open job, one A4 page each, with
 * its QR code for entering results.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Menu, Printer } from "lucide-react";
import { useAppShell } from "@/components/app-shell";
import { JobSheet } from "@/components/job-sheet";
import { useMounted } from "@/hooks/use-mounted";
import { apiFetch } from "@/lib/api-auth";
import { enterUrl, sheetModel } from "@/lib/maintenance/job-sheet";
import { formatWindow, jobHours, labour, partsReadiness, plannedParts, STATUS_LABEL, type ShutdownDetail } from "@/lib/maintenance/shutdown";
import { useRecordLists } from "@/lib/maintenance/use-record-lists";

const cell = "border border-black px-1 py-0.5 text-left align-top";

export default function ShutdownPackPage() {
  const { openSidebar } = useAppShell();
  const mounted = useMounted();
  const code = decodeURIComponent(String(useParams<{ code: string }>()?.code || ""));
  const [answer, setAnswer] = useState<{ sd: ShutdownDetail | null; error: string; done: boolean }>({ sd: null, error: "", done: false });
  const { data, loading } = useRecordLists(["work-orders", "work-centers", "technicians", "spare-parts"]);

  useEffect(() => {
    let live = true;
    apiFetch(`/api/maintenance/shutdowns/${encodeURIComponent(code)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { data?: ShutdownDetail; error?: string } | null;
        if (!res.ok || !body?.data) throw new Error(body?.error || `HTTP ${res.status}`);
        if (live) setAnswer({ sd: body.data, error: "", done: true });
      })
      .catch((err) => live && setAnswer({ sd: null, error: err instanceof Error ? err.message : "error", done: true }));
    return () => {
      live = false;
    };
  }, [code]);

  const sd = answer.sd;
  const machines = useMemo(() => new Map((data["work-centers"] || []).map((m) => [String(m.code || ""), m])), [data]);
  const orders = useMemo(() => new Map((data["work-orders"] || []).map((o) => [String(o.num || o.id), o])), [data]);
  const liveJobs = (sd?.work_orders || []).filter((w) => w.status !== "completed" && w.status !== "cancelled");
  const technicians = (data.technicians || []).filter((t) => !/inactive/i.test(String(t.status || "")) && (!sd || !t.plant || String(t.plant) === sd.plant_code)).length;
  const work = sd ? labour(sd, technicians) : null;
  const parts = sd ? partsReadiness(sd.work_orders, data["spare-parts"] || []) : [];
  const origin = mounted ? window.location.origin : "";
  const printedOn = mounted ? new Date().toLocaleString("en-GB") : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <style>{`@media print { @page { size: A4 portrait; margin: 10mm; } .job-sheet, .pack-summary { break-after: page; } .job-sheet:last-child { break-after: auto; } }`}</style>
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
          <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">Shutdown pack — {code}</h1>
          <p className="truncate text-xs text-slate-500">A summary page, then one job sheet for each open job</p>
        </div>
        <button
          type="button"
          disabled={!sd || loading}
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
        >
          <Printer size={14} /> Print
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4 dark:bg-slate-900 print:bg-white">
        {!answer.done || loading ? (
          <p className="text-[13px] text-slate-500">Building the pack…</p>
        ) : !sd ? (
          <p className="text-[13px] text-rose-700">Could not load {code}: {answer.error}</p>
        ) : (
          <div data-print-area>
            <article className="pack-summary mx-auto mb-6 w-full max-w-[190mm] bg-white p-2 text-[10px] text-black print:mb-0">
              <header className="border-2 border-black p-2">
                <p className="text-[9px] font-bold uppercase tracking-widest">Shutdown pack</p>
                <p className="text-xl font-bold leading-tight">{sd.title}</p>
                <p className="text-[11px]">
                  {sd.code} · {sd.plant_code} · {STATUS_LABEL[sd.status]}
                </p>
                <p className="mt-1 text-[11px]">
                  <span className="font-bold">Machines stopped:</span> {formatWindow(sd.starts_at, sd.ends_at)} (plant time)
                </p>
                <p className="text-[11px]">
                  <span className="font-bold">Led by:</span> {sd.lead || "—"} · <span className="font-bold">Production agreed:</span>{" "}
                  {sd.production_agreed?.by ? `${sd.production_agreed.by}, ${String(sd.production_agreed.at || "").slice(0, 10)}` : "not recorded"}
                </p>
                {sd.notes ? <p className="mt-1 italic">{sd.notes}</p> : null}
              </header>

              <h2 className="mt-2 font-bold uppercase">Machines ({sd.machines.length})</h2>
              <p>
                {sd.machines
                  .map((m) => {
                    const mc = machines.get(m);
                    return mc?.name ? `${mc.name} (${m})` : m;
                  })
                  .join(" · ")}
              </p>

              <h2 className="mt-2 font-bold uppercase">Jobs ({liveJobs.length} open)</h2>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {["Job", "Machine", "What", "Who", "Hours", "Parts", "Done ✓"].map((h) => (
                      <th key={h} className={`${cell} font-bold`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {liveJobs.map((w) => {
                    const h = jobHours(w);
                    return (
                      <tr key={w.num}>
                        <td className={cell}>{w.num}</td>
                        <td className={cell}>{w.asset_tag}</td>
                        <td className={cell}>
                          {w.title}
                          {(w.attrs || {}).contractor ? ` (${String((w.attrs || {}).contractor)})` : ""}
                        </td>
                        <td className={cell}>{w.assignee || ""}</td>
                        <td className={cell}>{h.estimated ? h.hours : ""}</td>
                        <td className={cell}>{plannedParts(w).map((p) => `${p.qty}×${p.sku}`).join(", ") || String((w.attrs || {}).partsRequired || "")}</td>
                        <td className={`${cell} w-12`} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {work ? (
                <p className="mt-2">
                  <span className="font-bold">People:</span> {work.needed} person-hours of work, {work.available} available ({technicians} technicians × 8 h ×{" "}
                  days in the window){work.short ? " — NOT ENOUGH" : ""}.
                </p>
              ) : null}
              {parts.length ? (
                <>
                  <h2 className="mt-2 font-bold uppercase">Parts to draw from the stores</h2>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        {["Part", "Needed", "In stock", "Short", "Drawn ✓"].map((h) => (
                          <th key={h} className={`${cell} font-bold`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parts.map((p) => (
                        <tr key={p.sku}>
                          <td className={cell}>
                            {p.sku} {p.name}
                          </td>
                          <td className={cell}>{p.needed}</td>
                          <td className={cell}>{p.onHand}</td>
                          <td className={cell}>{p.short || ""}</td>
                          <td className={`${cell} w-12`} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
              <p className="mt-3 text-[8px] text-neutral-600">Printed {printedOn}</p>
            </article>

            {liveJobs.map((w) => {
              const rec = orders.get(w.num);
              if (!rec) return null;
              return (
                <JobSheet
                  key={w.num}
                  sheet={sheetModel(rec, machines.get(String(rec.workCenter || "")))}
                  enterHref={enterUrl(origin, w.num)}
                  printedOn={printedOn}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
