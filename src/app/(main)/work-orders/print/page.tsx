"use client";

/**
 * Print maintenance job sheets, one A4 page per work order.
 *
 * Arrives with ?nums=WO-1,WO-2 (from a work order or the machine page) or
 * ?technician=&date= (a technician's planned day, from the Planner); without
 * either it offers every live job in the factory being viewed, to tick.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Menu, Printer } from "lucide-react";
import { useAppShell } from "@/components/app-shell";
import { FACTORY_PARAM, FactoryScopeSelect } from "@/components/factory-scope-select";
import { JobSheet } from "@/components/job-sheet";
import { useMounted } from "@/hooks/use-mounted";
import { enterUrl, selectForPrint, sheetModel } from "@/lib/maintenance/job-sheet";
import { useRecordLists } from "@/lib/maintenance/use-record-lists";

export default function PrintJobSheetsPage() {
  const { openSidebar } = useAppShell();
  const mounted = useMounted();
  const params = useSearchParams();
  const factory = (params.get(FACTORY_PARAM) || "").trim();
  const nums = (params.get("nums") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const [technician, setTechnician] = useState(params.get("technician") || "");
  const [date, setDate] = useState(params.get("date") || "");
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const { data, loading, errors } = useRecordLists(["work-orders", "work-centers"]);

  const machines = useMemo(
    () => new Map((data["work-centers"] || []).map((m) => [String(m.code || m.id || ""), m])),
    [data],
  );
  const plantOf = useMemo(
    () => new Map(Array.from(machines.entries()).map(([tag, m]) => [tag, String(m.plantCode || "")])),
    [machines],
  );
  const candidates = useMemo(
    () => selectForPrint(data["work-orders"] || [], { nums, technician, date, factory }, plantOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nums is derived from the URL
    [data, technician, date, factory, plantOf, params],
  );
  const chosen = ticked ? candidates.filter((o) => ticked.has(String(o.num))) : candidates;
  const technicians = Array.from(
    new Set((data["work-orders"] || []).map((o) => String(o.assignee || "").trim()).filter(Boolean)),
  ).sort();
  const origin = mounted ? window.location.origin : "";
  const printedOn = mounted ? new Date().toLocaleString("en-GB") : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* A4 portrait, one job per page. */}
      <style>{`@media print { @page { size: A4 portrait; margin: 10mm; } .job-sheet { break-after: page; } .job-sheet:last-child { break-after: auto; } }`}</style>
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
          <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">Print job sheets</h1>
          <p className="truncate text-xs text-slate-500">One A4 page per job. Results come back through each sheet&apos;s QR code.</p>
        </div>
        <FactoryScopeSelect />
        {!nums.length ? (
          <>
            <select
              value={technician}
              onChange={(e) => {
                setTechnician(e.target.value);
                setTicked(null);
              }}
              className="h-8 rounded-md border border-input bg-white px-2 text-[12px] dark:bg-slate-900"
              aria-label="Technician"
            >
              <option value="">Every technician</option>
              {technicians.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setTicked(null);
              }}
              className="h-8 rounded-md border border-input bg-white px-2 text-[12px] dark:bg-slate-900"
              aria-label="Planned for"
            />
          </>
        ) : null}
        <button
          type="button"
          disabled={!chosen.length}
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-[13px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
        >
          <Printer size={14} /> Print {chosen.length || ""}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <p className="text-[13px] text-slate-500">Loading work orders…</p>
        ) : errors["work-orders"] ? (
          <p className="text-[13px] text-rose-700">Could not load work orders: {errors["work-orders"]}</p>
        ) : !candidates.length ? (
          <p className="text-[13px] text-slate-500">No live work orders match.</p>
        ) : (
          <>
            {!nums.length ? (
              <fieldset className="mb-4 rounded-lg border border-slate-200 p-3 text-[13px] dark:border-slate-800" data-print-hide>
                <legend className="px-1 text-[12px] font-medium text-slate-600">Jobs to print</legend>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {candidates.map((o) => {
                    const num = String(o.num);
                    const on = !ticked || ticked.has(num);
                    return (
                      <label key={num} className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            const next = new Set(ticked ?? candidates.map((c) => String(c.num)));
                            if (next.has(num)) next.delete(num);
                            else next.add(num);
                            setTicked(next);
                          }}
                        />
                        <span>
                          <span className="font-medium">{num}</span> — {o.title}
                          <span className="block text-[11px] text-slate-500">
                            {[o.workCenter, o.assignee, o.plannedStart].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
            <div data-print-area>
              {origin
                ? chosen.map((o) => (
                    <JobSheet
                      key={String(o.num)}
                      sheet={sheetModel(o, machines.get(String(o.workCenter || "")))}
                      enterHref={enterUrl(origin, String(o.num))}
                      printedOn={printedOn}
                    />
                  ))
                : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
