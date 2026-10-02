"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  forecastSeries,
  loadForecasts,
  managementAnalysis,
  saveForecasts,
  type ManagementMetric,
} from "@/lib/ledger/reporting-advanced";
import {
  ReportRefreshButton,
  ReportShell,
  ReportStat,
} from "@/components/report-shell";
import { useMemo, useState } from "react";

function money(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function formatMetric(metric: ManagementMetric) {
  if (metric.format === "percent") return `${metric.value}%`;
  if (metric.format === "ratio") return metric.value.toFixed(2);
  if (metric.format === "days") return `${metric.value}d`;
  return money(metric.value);
}

export function ManagementAnalysisPanel({ tick = 0 }: { tick?: number }) {
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [horizon, setHorizon] = useState("6");
  const [revGrowth, setRevGrowth] = useState(() => {
    const row = loadForecasts().find((a) => /revenue|sales|income/i.test(a.name));
    return row?.growthPercent || "5";
  });
  const [expGrowth, setExpGrowth] = useState(() => {
    const row = loadForecasts().find((a) => /expense|cost/i.test(a.name));
    return row?.growthPercent || "3";
  });
  const [localTick, setLocalTick] = useState(0);

  const analysis = useMemo(() => {
    void tick;
    void localTick;
    return managementAnalysis(from, to);
  }, [from, to, tick, localTick]);

  const forecast = useMemo(() => {
    void tick;
    void localTick;
    return forecastSeries(from, to, Math.max(1, Number(horizon) || 6), {
      revenueGrowth: Number(revGrowth) || 0,
      expenseGrowth: Number(expGrowth) || 0,
    });
  }, [from, to, horizon, revGrowth, expGrowth, tick, localTick]);

  const maxBar = Math.max(
    1,
    ...forecast.months.map((m) => Math.max(m.income, m.expenses, Math.abs(m.netProfit))),
  );

  return (
    <div className="space-y-4">
      <ReportShell
        title="Management analysis"
        description="KPIs, narrative and forward-looking forecast for the selected period"
        exportSpec={{
          title: "Management analysis",
          filename: `management-analysis-${from}-${to}`,
          meta: [`Period ${from} → ${to}`],
          columns: ["Metric", "Current", "Prior", "Variance", "Insight"],
          rows: analysis.metrics.map((metric) => [
            metric.label,
            formatMetric(metric),
            metric.prior === null
              ? ""
              : metric.format === "percent"
                ? `${metric.prior}%`
                : metric.format === "ratio"
                  ? metric.prior.toFixed(2)
                  : money(metric.prior),
            metric.variance === null ? "" : metric.variance,
            metric.insight,
          ]),
        }}
        actions={<ReportRefreshButton onClick={() => setLocalTick((t) => t + 1)} />}
        controls={
          <>
            <div>
              <Label className="mb-1 text-[11px] text-slate-500">From</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 w-[150px]"
              />
            </div>
            <div>
              <Label className="mb-1 text-[11px] text-slate-500">To</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 w-[150px]"
              />
            </div>
          </>
        }
        stats={
          <>
            {analysis.metrics.slice(0, 4).map((metric) => (
              <ReportStat
                key={metric.key}
                label={metric.label}
                value={formatMetric(metric)}
                hint={
                  metric.prior !== null && metric.variance !== null
                    ? `${metric.variance >= 0 ? "+" : ""}${
                        metric.format === "percent" || metric.format === "ratio"
                          ? metric.variance
                          : money(metric.variance)
                      } vs prior month`
                    : undefined
                }
                accent={metric.variance !== null && metric.variance >= 0}
                danger={metric.variance !== null && metric.variance < 0}
              />
            ))}
          </>
        }
      >
        <p className="mb-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-[12px] leading-relaxed text-slate-700">
          {analysis.narrative}
        </p>

        {analysis.metrics.length > 4 ? (
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {analysis.metrics.slice(4, 8).map((metric) => (
              <div key={metric.key} className="rounded-lg border border-slate-100 px-3 py-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">{metric.label}</p>
                <p className="mt-1 text-[15px] font-semibold tabular-nums text-slate-900">
                  {formatMetric(metric)}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <h3 className="mb-2 text-[12px] font-semibold text-slate-700">Highlights</h3>
            <ul className="space-y-1.5 text-[12px] text-slate-600">
              {(analysis.highlights.length ? analysis.highlights : ["No highlights for this period."]).map(
                (item) => (
                <li key={item} className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-[12px] font-semibold text-slate-700">Risks</h3>
            <ul className="space-y-1.5 text-[12px] text-slate-600">
              {(analysis.risks.length ? analysis.risks : ["No material risks flagged for this period."]).map(
                (item) => (
                  <li key={item} className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                    {item}
                  </li>
                ),
              )}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-[12px] font-semibold text-slate-700">Opportunities</h3>
            <ul className="space-y-1.5 text-[12px] text-slate-600">
              {(analysis.opportunities.length
                ? analysis.opportunities
                : ["Keep monitoring pipeline and cost drivers."]
              ).map((item) => (
                <li key={item} className="rounded-lg bg-sky-50 px-3 py-2 text-sky-900">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-2 py-2">Metric</th>
                <th className="px-2 py-2 text-right">Current</th>
                <th className="px-2 py-2 text-right">Prior month</th>
                <th className="px-2 py-2 text-right">Δ</th>
                <th className="px-2 py-2">Insight</th>
              </tr>
            </thead>
            <tbody>
              {analysis.metrics.map((metric) => (
                <tr key={metric.key} className="border-b border-slate-50">
                  <td className="px-2 py-2 font-medium text-slate-800">{metric.label}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatMetric(metric)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">
                    {metric.prior === null
                      ? "—"
                      : metric.format === "percent"
                        ? `${metric.prior}%`
                        : metric.format === "ratio"
                          ? metric.prior.toFixed(2)
                          : money(metric.prior)}
                  </td>
                  <td
                    className={`px-2 py-2 text-right tabular-nums ${
                      (metric.variance ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {metric.variance === null
                      ? "—"
                      : `${metric.variance >= 0 ? "+" : ""}${
                          metric.format === "percent" || metric.format === "ratio"
                            ? metric.variance
                            : money(metric.variance)
                        }`}
                  </td>
                  <td className="px-2 py-2 text-slate-500">{metric.insight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 text-[12px] sm:grid-cols-4">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">vs prior year revenue</p>
            <p className="font-semibold tabular-nums">
              {money(analysis.pl.totalIncome)} → {money(analysis.plYoy.totalIncome)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">vs prior year profit</p>
            <p className="font-semibold tabular-nums">
              {money(analysis.pl.netProfit)} → {money(analysis.plYoy.netProfit)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Open AR</p>
            <p className="font-semibold tabular-nums">{money(analysis.arTotal)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Open AP</p>
            <p className="font-semibold tabular-nums">{money(analysis.apTotal)}</p>
          </div>
        </div>
      </ReportShell>

      <ReportShell
        title="Forecast & outlook"
        description="Project revenue and expenses using annual growth assumptions"
        exportSpec={{
          title: "Forecast outlook",
          filename: `forecast-outlook-${from}-${to}`,
          columns: ["Month", "Income", "Expenses", "Net profit"],
          rows: forecast.months.map((m) => [
            m.label,
            m.income,
            m.expenses,
            m.netProfit,
          ]),
        }}
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <Label className="mb-1 text-[11px] text-slate-500">Revenue growth % / yr</Label>
            <Input
              value={revGrowth}
              onChange={(e) => setRevGrowth(e.target.value)}
              className="h-8 w-[120px]"
            />
          </div>
          <div>
            <Label className="mb-1 text-[11px] text-slate-500">Expense growth % / yr</Label>
            <Input
              value={expGrowth}
              onChange={(e) => setExpGrowth(e.target.value)}
              className="h-8 w-[120px]"
            />
          </div>
          <div>
            <Label className="mb-1 text-[11px] text-slate-500">Forecast months</Label>
            <Input
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
              className="h-8 w-[100px]"
            />
          </div>
          <Button
            type="button"
            size="sm"
            className="h-8 bg-black hover:bg-zinc-800"
            onClick={() => {
              saveForecasts([
                { id: "1", name: "Revenue growth", growthPercent: revGrowth || "0" },
                { id: "2", name: "Expense growth", growthPercent: expGrowth || "0" },
              ]);
              setLocalTick((t) => t + 1);
            }}
          >
            Save assumptions
          </Button>
        </div>

        <p className="mb-3 text-[12px] text-slate-500">
          Actual months in range, then {horizon} projected months at +{forecast.revenueGrowth}% /
          +{forecast.expenseGrowth}% annualised growth.
        </p>

        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-100 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Actual net profit</p>
            <p className="text-[14px] font-semibold tabular-nums">{money(forecast.actualNetProfit)}</p>
          </div>
          <div className="rounded-lg border border-slate-100 px-3 py-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">Forecast net profit</p>
            <p className="text-[14px] font-semibold tabular-nums">{money(forecast.forecastNetProfit)}</p>
          </div>
          <div className="rounded-lg bg-slate-900 px-3 py-3 text-white">
            <p className="text-[10px] uppercase tracking-wide text-slate-300">Outlook total</p>
            <p className="text-[14px] font-semibold tabular-nums">
              {money(forecast.actualNetProfit + forecast.forecastNetProfit)}
            </p>
          </div>
        </div>

        <div className="mb-4 flex h-28 items-end gap-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          {forecast.months.map((month) => (
            <div key={month.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div
                className={`w-full max-w-[28px] rounded-t ${
                  month.isProjected ? "bg-orange-400/80" : "bg-slate-700"
                }`}
                style={{ height: `${Math.max(4, Math.round((month.income / maxBar) * 100))}%` }}
                title={`${month.label}: income ${money(month.income)}`}
              />
              <span className="truncate text-[9px] text-slate-400">{month.label.split(" ")[0]}</span>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-2 py-2">Month</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2 text-right">Income</th>
                <th className="px-2 py-2 text-right">Expenses</th>
                <th className="px-2 py-2 text-right">Net profit</th>
              </tr>
            </thead>
            <tbody>
              {forecast.months.map((month) => (
                <tr
                  key={month.key}
                  className={`border-b border-slate-50 ${month.isProjected ? "bg-orange-50/40" : ""}`}
                >
                  <td className="px-2 py-2 font-medium">{month.label}</td>
                  <td className="px-2 py-2 text-slate-500">
                    {month.isProjected ? "Forecast" : "Actual"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(month.income)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(month.expenses)}</td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums">
                    {money(month.netProfit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportShell>
    </div>
  );
}
