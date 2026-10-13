"use client";

/**
 * The parts forecast: what the preventive plan will take from the stores,
 * part by part, against what is there — and the day to order by so a part
 * arrives before the job that needs it (src/lib/maintenance/parts-forecast.ts).
 *
 * A shortfall can be sent to procurement from here. The request is keyed by
 * part and shortfall date, so sending it twice does not order twice.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Menu } from "lucide-react";
import { useAppShell } from "@/components/app-shell";
import { FACTORY_PARAM, FactoryScopeSelect } from "@/components/factory-scope-select";
import { apiFetch } from "@/lib/api-auth";
import type { Forecast } from "@/lib/maintenance/calendar";
import {
  DEFAULT_LEAD_DAYS,
  partsForecast,
  requestRef,
  STATUS_LABEL,
  type PartForecastRow,
  type PartStatus,
} from "@/lib/maintenance/parts-forecast";
import { todayIso } from "@/lib/maintenance/planner";
import { useRecordLists } from "@/lib/maintenance/use-record-lists";
import { cn } from "@/lib/utils";

const HORIZONS = [3, 6, 12] as const;

const TONE: Record<PartStatus, string> = {
  late: "bg-rose-600 text-white",
  "order-now": "bg-amber-500 text-black",
  "unknown-part": "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  "order-later": "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100",
  covered: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};

function monthsAhead(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function RequestButton({
  row,
  department,
  onDone,
}: {
  row: PartForecastRow;
  department: string;
  onDone: (text: string, tone: "ok" | "error") => void;
}) {
  const [qty, setQty] = useState(String(row.shortfall || 1));
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      const res = await apiFetch("/api/records/production/purchase-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          part: row.sku,
          partName: row.name,
          qty,
          unit: row.unit,
          department,
          urgent: row.status === "late" ? "yes" : "",
          ref: requestRef(row),
          reason: `Preventive maintenance needs ${row.needed} over the plan; free stock covers jobs until ${row.shortfallOn}. Order by ${row.orderBy} (lead time ${row.leadDays} days).`,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      onDone(`${qty} × ${row.sku} sent to procurement (${requestRef(row)}).`, "ok");
    } catch (err) {
      onDone(`${row.sku} not requested: ${err instanceof Error ? err.message : "error"}`, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        inputMode="decimal"
        aria-label={`Quantity of ${row.sku} to request`}
        className="h-7 w-16 rounded border border-slate-300 bg-white px-1 text-[12px] dark:border-slate-700 dark:bg-slate-900"
      />
      <button
        type="button"
        disabled={busy || !department || !(Number(qty) > 0)}
        title={department ? undefined : "Pick the department whose budget pays first"}
        onClick={() => void send()}
        className="h-7 rounded bg-black px-2 text-[12px] font-medium text-white disabled:opacity-40"
      >
        Request
      </button>
    </span>
  );
}

export default function PartsForecastPage() {
  const { openSidebar } = useAppShell();
  const factory = (useSearchParams().get(FACTORY_PARAM) || "").trim();
  const today = todayIso();
  const [months, setMonths] = useState<(typeof HORIZONS)[number]>(6);
  const [department, setDepartment] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const to = monthsAhead(today, months);
  const requestKey = `${today}|${to}|${factory}`;
  const [answer, setAnswer] = useState<{ key: string; forecast: Forecast | null; error: string }>({ key: "", forecast: null, error: "" });
  const loading = answer.key !== requestKey;
  const { data, errors } = useRecordLists(["spare-parts", "budget-departments"], 0);

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ from: today, to, ...(factory ? { plant: factory } : {}) });
    apiFetch(`/api/maintenance/forecast?${q}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { data?: Forecast; error?: string } | null;
        if (!res.ok || !body?.data) throw new Error(body?.error || `HTTP ${res.status}`);
        if (live) setAnswer({ key: requestKey, forecast: body.data, error: "" });
      })
      .catch((err) => {
        if (live) setAnswer({ key: requestKey, forecast: null, error: err instanceof Error ? err.message : "The forecast could not be read." });
      });
    return () => {
      live = false;
    };
  }, [today, to, factory, requestKey]);

  const rows = useMemo(
    () => partsForecast(answer.forecast?.items || [], data["spare-parts"] || [], today),
    [answer.forecast, data, today],
  );
  const departments = (data["budget-departments"] || []).map((d) => String(d.name || "")).filter(Boolean);
  const jobsWithoutParts = useMemo(() => {
    const items = answer.forecast?.items || [];
    return new Set(items.filter((i) => !(i.parts || []).length).map((i) => i.template_code)).size;
  }, [answer.forecast]);
  const counts = useMemo(() => {
    const c: Partial<Record<PartStatus, number>> = {};
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

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
          <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">Parts forecast</h1>
          <p className="truncate text-xs text-slate-500">
            Parts the preventive plan needs to {to}, against stock less the reorder level
          </p>
        </div>
        <FactoryScopeSelect />
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value) as (typeof HORIZONS)[number])}
          aria-label="How far ahead"
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900"
        >
          {HORIZONS.map((m) => (
            <option key={m} value={m}>
              Next {m} months
            </option>
          ))}
        </select>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          aria-label="Department whose budget pays"
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="">Budget: pick a department…</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
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
        {loading ? (
          <p className="text-[13px] text-slate-500">Working out the parts…</p>
        ) : answer.error ? (
          <p className="text-[13px] text-rose-700">Could not load the forecast: {answer.error}</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-[12px]">
              {(Object.keys(STATUS_LABEL) as PartStatus[]).map((s) =>
                counts[s] ? (
                  <span key={s} className={cn("rounded-full px-2.5 py-0.5 font-medium", TONE[s])}>
                    {STATUS_LABEL[s]}: {counts[s]}
                  </span>
                ) : null,
              )}
              {errors["spare-parts"] ? <span className="text-rose-700">Stock could not be read: {errors["spare-parts"]}</span> : null}
            </div>
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-[13px] text-slate-500 dark:border-slate-700">
                No preventive job in the next {months} months lists its parts. Add them to the{" "}
                <Link className="underline" href="/production?view=pm-templates">
                  PM templates
                </Link>{" "}
                under &ldquo;Parts per job&rdquo;.
              </p>
            ) : (
              <table className="w-full min-w-[900px] text-left text-[13px]">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-2">Part</th>
                    <th className="px-3 py-2 text-right">On hand</th>
                    <th className="px-3 py-2 text-right">Kept back</th>
                    <th className="px-3 py-2 text-right">Needed</th>
                    <th className="px-3 py-2">Short from</th>
                    <th className="px-3 py-2">Order by</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Fragment key={r.sku}>
                      <tr className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => setOpen(open === r.sku ? null : r.sku)} className="text-left">
                            <span className="font-medium">{r.sku}</span> <span className="text-slate-500">{r.name}</span>
                            <span className="block text-[11px] text-slate-500">
                              {r.jobs} job{r.jobs === 1 ? "" : "s"} on {r.machines} machine{r.machines === 1 ? "" : "s"} — {open === r.sku ? "hide" : "show"}
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">{r.onHand}</td>
                        <td className="px-3 py-2 text-right">{r.reorderLevel}</td>
                        <td className="px-3 py-2 text-right">
                          {r.needed} {r.unit}
                        </td>
                        <td className="px-3 py-2">{r.shortfallOn ? `${r.shortfallOn} (${r.shortfall} short)` : "—"}</td>
                        <td className="px-3 py-2">
                          {r.orderBy || "—"}
                          {r.orderBy ? (
                            <span className="block text-[11px] text-slate-500">
                              {r.leadDays} days lead{r.leadKnown ? "" : " (assumed)"}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[r.status])}>{STATUS_LABEL[r.status]}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {r.shortfallOn && r.status !== "unknown-part" ? (
                            <RequestButton row={r} department={department} onDone={(text, tone) => setMessage({ text, tone })} />
                          ) : null}
                        </td>
                      </tr>
                      {open === r.sku ? (
                        <tr className="bg-slate-50/60 dark:bg-slate-900/40">
                          <td colSpan={8} className="px-3 py-2 text-[12px] text-slate-600 dark:text-slate-300">
                            {r.needs.map((n, i) => (
                              <span key={i} className="mr-3 inline-block">
                                {n.date}: {n.qty} for {n.machine} ({n.job})
                              </span>
                            ))}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-[12px] text-slate-500">
              Free stock is on hand less the reorder level, which is kept for breakdowns. A part with no lead time recorded is assumed to take{" "}
              {DEFAULT_LEAD_DAYS} days — set it under{" "}
              <Link className="underline" href="/production?view=spare-parts">
                Spare parts
              </Link>
              .{jobsWithoutParts ? ` ${jobsWithoutParts} template${jobsWithoutParts === 1 ? " has" : "s have"} jobs in this period with no parts listed.` : ""}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
