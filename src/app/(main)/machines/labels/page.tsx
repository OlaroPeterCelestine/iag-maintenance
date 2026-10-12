"use client";

/**
 * QR labels for machines, to print and stick on them. Each label opens the
 * machine's page (/machines/<tag>), where someone at the machine can see what
 * is open on it and report a fault with the machine already filled in.
 *
 * Narrowed by the factory in the header and a shop floor here, so a sheet can
 * be printed for one floor at a time.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Menu, Printer } from "lucide-react";
import { useAppShell } from "@/components/app-shell";
import { FACTORY_PARAM, FactoryScopeSelect } from "@/components/factory-scope-select";
import { useMounted } from "@/hooks/use-mounted";
import { machineUrl, qrSvg } from "@/lib/maintenance/qr";
import { useRecordLists } from "@/lib/maintenance/use-record-lists";

export default function MachineLabelsPage() {
  const { openSidebar } = useAppShell();
  const mounted = useMounted();
  const factory = (useSearchParams().get(FACTORY_PARAM) || "").trim();
  const [floor, setFloor] = useState("all");
  const { data, loading, errors } = useRecordLists(["work-centers"]);

  const machines = useMemo(
    () =>
      (data["work-centers"] || [])
        .filter((m) => !/retired/i.test(String(m.status || "")))
        .filter((m) => !factory || String(m.plantCode || "") === factory)
        .sort((a, b) =>
          `${a.plantCode}/${a.section}/${a.name}`.localeCompare(`${b.plantCode}/${b.section}/${b.name}`),
        ),
    [data, factory],
  );
  const floors = Array.from(new Set(machines.map((m) => String(m.section || "")).filter(Boolean))).sort();
  const shown = floor === "all" ? machines : machines.filter((m) => String(m.section || "") === floor);
  const origin = mounted ? window.location.origin : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800" data-print-hide>
        <button
          type="button"
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={openSidebar}
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">Machine QR labels</h1>
          <p className="truncate text-xs text-slate-500">Print, cut out and stick one on each machine.</p>
        </div>
        <FactoryScopeSelect />
        {floors.length > 1 ? (
          <select
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            className="h-8 rounded-md border border-input bg-white px-2.5 text-[12px] text-slate-700 dark:bg-slate-900 dark:text-slate-200"
            aria-label="Shop floor"
          >
            <option value="all">All shop floors</option>
            {floors.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!shown.length}
          className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-[13px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
        >
          <Printer size={14} /> Print {shown.length || ""}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <p className="text-[13px] text-slate-500">Loading machines…</p>
        ) : errors["work-centers"] ? (
          <p className="text-[13px] text-rose-700">Could not load machines: {errors["work-centers"]}</p>
        ) : !shown.length ? (
          <p className="text-[13px] text-slate-500">No machines here.</p>
        ) : (
          <div data-print-area className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
            {shown.map((m) => {
              const tag = String(m.code || m.id || "");
              return (
                <div
                  key={tag}
                  className="flex break-inside-avoid flex-col items-center rounded-lg border border-slate-300 bg-white p-3 text-center text-black"
                >
                  {origin ? (
                    <div
                      className="h-32 w-32"
                      aria-label={`QR code for ${tag}`}
                      role="img"
                      // Our own SVG, encoding this app's URL for the machine.
                      dangerouslySetInnerHTML={{ __html: qrSvg(machineUrl(origin, tag)) }}
                    />
                  ) : null}
                  <p className="mt-2 text-[13px] font-semibold leading-tight">{m.name || tag}</p>
                  <p className="font-mono text-[12px]">{tag}</p>
                  <p className="text-[11px] text-slate-600">{[m.plantCode, m.section].filter(Boolean).join(" / ")}</p>
                  <p className="mt-1 text-[10px] text-slate-500">Scan to report a fault</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
