"use client";

/**
 * Presentation for the System health page.
 *
 * Deliberately dumb: it renders strings and tone tokens the server already
 * decided on, times the endpoints the server asked it to time, and owns
 * nothing but interaction state. No threshold, no formatting rule, and no
 * access check lives here — see @/lib/system-health/view.ts.
 */

import { useAppShell } from "@/components/app-shell";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { appToastError } from "@/lib/app-toast";
import {
  describeClientPerformanceAction,
  refreshSystemHealthAction,
} from "@/lib/system-health/actions";
import { collectClientSample } from "@/lib/system-health/client-metrics";
import type {
  ClientPerformance,
  ClientPerformanceView,
  HealthTone,
  SystemHealthReport,
  SystemHealthView,
} from "@/lib/system-health/types";
import { Activity, DocumentDownload, HambergerMenu, Refresh } from "iconsax-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const CARD_CLASS =
  "min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4";
const SECTION_CLASS = "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm";
const THEAD_CLASS =
  "border-b border-slate-100 bg-slate-50/70 text-[10px] tracking-wide text-slate-400 uppercase";
const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-white px-2 text-[13px] text-slate-700 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20";

/** Refresh cadence for the live view. 0 = manual only. */
const AUTO_REFRESH_OPTIONS = [
  { value: "0", label: "Manual refresh" },
  { value: "15", label: "Every 15s" },
  { value: "30", label: "Every 30s" },
  { value: "60", label: "Every 60s" },
];

const PILL_CLASS: Record<HealthTone, string> = {
  good: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  warn: "bg-amber-50 text-amber-800 ring-1 ring-amber-100",
  bad: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
  muted: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  neutral: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

const DOT_CLASS: Record<HealthTone, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
  muted: "bg-slate-300",
  neutral: "bg-slate-300",
};

const TEXT_CLASS: Record<HealthTone, string> = {
  good: "text-emerald-600",
  warn: "text-amber-600",
  bad: "text-rose-600",
  muted: "text-slate-500",
  neutral: "text-slate-900",
};

export function SystemHealthScreen({
  initialView,
  initialReport,
}: {
  initialView: SystemHealthView;
  initialReport: SystemHealthReport;
}) {
  const { openSidebar } = useAppShell();
  const [view, setView] = useState(initialView);
  const [report, setReport] = useState(initialReport);
  const [client, setClient] = useState<ClientPerformanceView | null>(null);
  const [clientPerf, setClientPerf] = useState<ClientPerformance | null>(null);
  const [autoRefresh, setAutoRefresh] = useState("0");
  const [loading, setLoading] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [lastError, setLastError] = useState("");
  /** Silent auto-refreshes must not raise a toast storm when a service is down. */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Time this tab's own session and hand the raw numbers back for reading. */
  const sampleSession = useCallback(async (targets: SystemHealthView["endpointTargets"]) => {
    const sample = await collectClientSample(targets);
    const result = await describeClientPerformanceAction(sample);
    if (!mounted.current || !result.ok) return;
    setClient(result.view);
    setClientPerf(result.performance);
  }, []);

  const refresh = useCallback(
    async (quiet: boolean) => {
      if (!quiet) setLoading(true);
      try {
        const result = await refreshSystemHealthAction();
        if (!mounted.current) return;
        if (!result.ok) throw new Error(result.error);
        setView(result.view);
        setReport(result.report);
        setLastError("");
        await sampleSession(result.view.endpointTargets);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (!mounted.current) return;
        setLastError(message);
        if (!quiet) appToastError("Could not read system health", message);
      } finally {
        if (mounted.current && !quiet) setLoading(false);
      }
    },
    [sampleSession],
  );

  // The first report arrived with the HTML; only the browser readings are missing.
  useEffect(() => {
    void sampleSession(initialView.endpointTargets);
  }, [sampleSession, initialView.endpointTargets]);

  useEffect(() => {
    const seconds = Number(autoRefresh) || 0;
    if (seconds <= 0) return;
    const timer = window.setInterval(() => void refresh(true), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refresh]);

  async function downloadReport() {
    setReportBusy(true);
    try {
      const { downloadSystemReport } = await import("@/lib/export/system-report");
      await downloadSystemReport({ hours: 168, health: report, clientPerformance: clientPerf });
    } catch (err) {
      appToastError("Could not build report", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setReportBusy(false);
    }
  }

  return (
    <>
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-3 sm:px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={openSidebar}
            aria-label="Open navigation"
          >
            <HambergerMenu size={18} variant="Linear" color="currentColor" />
          </Button>
          <nav className="flex items-center gap-2 text-[13px] text-slate-400">
            <Link href="/" className="hover:text-slate-700">
              Overview
            </Link>
            <span>/</span>
            <span className="font-medium text-slate-700">System health</span>
          </nav>
        </div>
        <div className="flex items-center gap-0.5">
          <NotificationsMenu />
          <ThemeToggle />
          <PageMoreMenu />
        </div>
      </header>

      <main className="flex w-full flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-slate-900">
              <Activity size={22} variant="Linear" color="currentColor" />
              System health
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-500">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL_CLASS[view.statusTone]}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[view.statusTone]}`} />
                {view.statusLabel}
              </span>
              <span>{view.headline}</span>
              <span>· checked {view.checkedAtLabel}</span>
              <span>· {view.environmentLabel}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.value)}
              className={SELECT_CLASS}
              aria-label="Auto refresh"
            >
              {AUTO_REFRESH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void refresh(false)}
            >
              <Refresh size={14} color="currentColor" className="mr-1" />
              {loading ? "Checking…" : "Run checks"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={reportBusy}
              onClick={() => void downloadReport()}
            >
              <DocumentDownload size={14} color="currentColor" className="mr-1" />
              {reportBusy ? "Building…" : "System report"}
            </Button>
          </div>
        </div>

        {lastError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            Health check failed: {lastError}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {view.cards.map((card) => (
            <div key={card.label} className={CARD_CLASS}>
              <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                {card.label}
              </p>
              <p className={`mt-1.5 text-[20px] font-semibold tracking-tight ${TEXT_CLASS[card.tone]}`}>
                {card.value}
              </p>
            </div>
          ))}
        </div>

        {view.attention.length ? (
          <div className={SECTION_CLASS}>
            <div className="border-b border-slate-100 px-3 py-2.5 sm:px-4">
              <h2 className="text-[13px] font-semibold text-slate-900">Needs attention</h2>
              <p className="text-[12px] text-slate-500">What is not working right now, and why.</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {view.attention.map((service) => (
                <li key={service.key} className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2.5 sm:px-4">
                  <span
                    className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium ${PILL_CLASS[service.statusTone]}`}
                  >
                    {service.statusLabel}
                  </span>
                  <span className="text-[13px] font-medium text-slate-800">{service.name}</span>
                  <span className="min-w-0 flex-1 text-[12px] break-words text-slate-500">
                    {service.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className={SECTION_CLASS}>
          <div className="border-b border-slate-100 px-3 py-2.5 sm:px-4">
            <h2 className="text-[13px] font-semibold text-slate-900">Services</h2>
            <p className="text-[12px] text-slate-500">
              Every dependency the app talks to, probed live from the web process.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className={THEAD_CLASS}>
                <tr>
                  <th className="px-3 py-2 font-medium sm:px-4">Service</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Latency</th>
                  <th className="px-3 py-2 font-medium">Host</th>
                  <th className="px-3 py-2 font-medium sm:px-4">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {view.groups.flatMap((group) => [
                  <tr key={`group-${group.key}`} className="bg-slate-50/40">
                    <td
                      colSpan={5}
                      className="px-3 py-1.5 text-[10px] font-medium tracking-wide text-slate-400 uppercase sm:px-4"
                    >
                      {group.label}
                    </td>
                  </tr>,
                  ...group.services.map((service) => (
                    <tr key={service.key} className="align-top">
                      <td className="px-3 py-2.5 sm:px-4">
                        <span className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[service.statusTone]}`}
                          />
                          <span className="font-medium text-slate-800">{service.name}</span>
                          {service.required ? (
                            <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">
                              required
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium ${PILL_CLASS[service.statusTone]}`}
                        >
                          {service.statusLabel}
                        </span>
                      </td>
                      <td className={`px-3 py-2.5 tabular-nums ${TEXT_CLASS[service.latencyTone]}`}>
                        {service.latencyLabel}
                      </td>
                      <td className="px-3 py-2.5 text-slate-500">{service.target}</td>
                      <td className="max-w-[320px] px-3 py-2.5 text-[12px] break-words text-slate-500 sm:px-4">
                        {service.detail}
                      </td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className={SECTION_CLASS}>
            <div className="border-b border-slate-100 px-3 py-2.5 sm:px-4">
              <h2 className="text-[13px] font-semibold text-slate-900">Web process</h2>
              <p className="text-[12px] text-slate-500">
                Memory and scheduling health of the Node server rendering this app.
              </p>
            </div>
            <table className="w-full text-left text-[13px]">
              <tbody className="divide-y divide-slate-100">
                {view.process.map((row) => (
                  <tr key={row.label}>
                    <td className="px-3 py-2 text-slate-500 sm:px-4">{row.label}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-800 sm:px-4">
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={SECTION_CLASS}>
            <div className="border-b border-slate-100 px-3 py-2.5 sm:px-4">
              <h2 className="text-[13px] font-semibold text-slate-900">This session</h2>
              <p className="text-[12px] text-slate-500">
                What loading this page actually cost in your browser.
              </p>
            </div>
            <table className="w-full text-left text-[13px]">
              <tbody className="divide-y divide-slate-100">
                {(client?.session || []).map((row) => (
                  <tr key={row.label}>
                    <td className="px-3 py-2 text-slate-500 sm:px-4">{row.label}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-800 sm:px-4">
                      {row.value}
                    </td>
                  </tr>
                ))}
                {!client ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-slate-400">Measuring this tab…</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className={SECTION_CLASS}>
          <div className="border-b border-slate-100 px-3 py-2.5 sm:px-4">
            <h2 className="text-[13px] font-semibold text-slate-900">Endpoint response times</h2>
            <p className="text-[12px] text-slate-500">
              Measured from this browser, so proxy and network cost are included.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead className={THEAD_CLASS}>
                <tr>
                  <th className="px-3 py-2 font-medium sm:px-4">Endpoint</th>
                  <th className="px-3 py-2 font-medium">Path</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium sm:px-4">Round trip</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(client?.endpoints || []).map((row) => (
                  <tr key={row.path}>
                    <td className="px-3 py-2.5 font-medium text-slate-800 sm:px-4">{row.name}</td>
                    <td className="px-3 py-2.5 text-slate-500">{row.path}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium ${
                          row.ok ? PILL_CLASS.good : PILL_CLASS.bad
                        }`}
                      >
                        {row.detail}
                      </span>
                    </td>
                    <td className={`px-3 py-2.5 tabular-nums sm:px-4 ${TEXT_CLASS[row.latencyTone]}`}>
                      {row.latencyLabel}
                    </td>
                  </tr>
                ))}
                {!client?.endpoints?.length ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      No measurements yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className={SECTION_CLASS}>
          <div className="border-b border-slate-100 px-3 py-2.5 sm:px-4">
            <h2 className="text-[13px] font-semibold text-slate-900">Heaviest build chunks</h2>
            <p className="text-[12px] text-slate-500">
              JavaScript and CSS this page pulled, largest first — where slow first loads come
              from.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className={THEAD_CLASS}>
                <tr>
                  <th className="px-3 py-2 font-medium sm:px-4">Chunk</th>
                  <th className="px-3 py-2 font-medium">Decoded</th>
                  <th className="px-3 py-2 font-medium">Transferred</th>
                  <th className="px-3 py-2 font-medium sm:px-4">Load time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(client?.chunks || []).map((chunk) => (
                  <tr key={chunk.name}>
                    <td className="max-w-[280px] truncate px-3 py-2 font-medium text-slate-800 sm:px-4">
                      {chunk.name}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">{chunk.decodedLabel}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{chunk.transferLabel}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500 sm:px-4">
                      {chunk.durationLabel}
                    </td>
                  </tr>
                ))}
                {!client?.chunks?.length ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      No build assets recorded for this navigation.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
