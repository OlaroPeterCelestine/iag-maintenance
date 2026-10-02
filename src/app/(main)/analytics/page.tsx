"use client";

import { useAppShell } from "@/components/app-shell";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { currentUserCan, currentUserIsAdmin } from "@/lib/access-control";
import { importWithRetry } from "@/lib/chunk-recovery";
import dynamic from "next/dynamic";
import { apiFetch } from "@/lib/api-auth";
import { appToastError } from "@/lib/app-toast";
import {
  analyzeUserPatterns,
  type MlUserPatternInsight,
  type UserPatternsExport,
} from "@/lib/ml-api";
import { Chart21, HambergerMenu, Refresh } from "iconsax-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type AnalyticsSummary = {
  ok: boolean;
  windowHours: number;
  from: string;
  to: string;
  totals: {
    events: number;
    pageViews: number;
    uniqueUsers: number;
    logins: number;
    mutations: number;
    accessDenied: number;
  };
  topPages: { key: string; count: number }[];
  topPaths: { key: string; count: number }[];
  topModules: { key: string; count: number }[];
  topActions: { key: string; count: number }[];
  activeUsers: {
    userId: string;
    userName: string;
    username: string;
    email: string;
    events: number;
    pageViews: number;
    lastSeen: string;
  }[];
  timeline: {
    bucket: string;
    events: number;
    pageViews: number;
    users: number;
  }[];
};

/** Recharts is ~107 KB gzipped — keep it out of this route's first load. */
const chartLoading = () => (
  <div className="flex h-full items-center justify-center text-xs text-slate-400">
    Loading chart…
  </div>
);

const ActivityTimelineChart = dynamic(
  () =>
    importWithRetry(() => import("@/components/analytics-charts")).then((m) => ({
      default: m.ActivityTimelineChart,
    })),
  { ssr: false, loading: chartLoading },
);

const TopModulesChart = dynamic(
  () =>
    importWithRetry(() => import("@/components/analytics-charts")).then((m) => ({
      default: m.TopModulesChart,
    })),
  { ssr: false, loading: chartLoading },
);

function formatWhen(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function who(u: AnalyticsSummary["activeUsers"][number]): string {
  return u.userName || u.username || u.email || u.userId || "Unknown";
}

export default function AnalyticsPage() {
  const { openSidebar } = useAppShell();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState(48);
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternInsight, setPatternInsight] = useState<MlUserPatternInsight | null>(null);
  const [patternError, setPatternError] = useState<string | null>(null);

  const load = useCallback(async (windowHours: number) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/analytics?hours=${windowHours}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Failed (${res.status})`);
      }
      const json = (await res.json()) as AnalyticsSummary;
      setData(json);
    } catch (err) {
      appToastError("Could not load analytics", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPatterns = useCallback(async (windowHours: number) => {
    setPatternsLoading(true);
    setPatternError(null);
    try {
      const res = await apiFetch(`/api/analytics/user-patterns?hours=${windowHours}&limit=50`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Feature export failed (${res.status})`);
      }
      const features = (await res.json()) as UserPatternsExport;
      try {
        const insight = await analyzeUserPatterns(features);
        setPatternInsight(insight);
      } catch (mlErr) {
        // Still show raw export counts if ML is offline.
        setPatternInsight(null);
        setPatternError(
          mlErr instanceof Error
            ? `Features loaded from API, but ML study failed: ${mlErr.message}`
            : "Features loaded from API, but ML study failed",
        );
      }
    } catch (err) {
      setPatternInsight(null);
      setPatternError(err instanceof Error ? err.message : "Could not load user patterns");
    } finally {
      setPatternsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      if (!currentUserIsAdmin() || !currentUserCan("edit-settings")) {
        appToastError("Access denied", "Only Administrators can view app analytics.");
        router.replace("/");
        return;
      }
      setReady(true);
      void load(hours);
      void loadPatterns(hours);
    });
  }, [router, load, loadPatterns, hours]);

  const timeline = useMemo(
    () =>
      (data?.timeline || []).map((row) => ({
        ...row,
        label: formatWhen(row.bucket),
      })),
    [data],
  );

  const modules = useMemo(
    () =>
      (data?.topModules || []).map((row) => ({
        name: row.key,
        count: row.count,
      })),
    [data],
  );

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Checking access…
      </div>
    );
  }

  const totals = data?.totals;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <button
          type="button"
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={openSidebar}
          aria-label="Open menu"
        >
          <HambergerMenu size={20} color="currentColor" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Chart21 size={18} color="currentColor" className="text-orange-500" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
              App analytics
            </h1>
            <p className="truncate text-xs text-slate-500">
              Usage + AI study of login time and what people did · last{" "}
              {data?.windowHours ?? hours}h
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-1 sm:flex">
          {[24, 48, 168, 720].map((h) => (
            <Button
              key={h}
              type="button"
              size="sm"
              variant={hours === h ? "default" : "outline"}
              disabled={loading}
              onClick={() => setHours(h)}
            >
              {h === 168 ? "7d" : h === 720 ? "30d" : `${h}h`}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || patternsLoading}
          onClick={() => {
            void load(hours);
            void loadPatterns(hours);
          }}
        >
          <Refresh size={14} color="currentColor" className="mr-1" />
          Refresh
        </Button>
        <NotificationsMenu />
        <ThemeToggle />
        <PageMoreMenu />
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          <Link href="/activity-logs" className="rounded-md border border-slate-200 px-2 py-1 hover:bg-white">
            Activity logs
          </Link>
          <Link href="/crash-analytics" className="rounded-md border border-slate-200 px-2 py-1 hover:bg-white">
            Crash analytics
          </Link>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                AI user patterns
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Backend exports login duration + activity; ML labels personas and anomalies for study
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={patternsLoading}
              onClick={() => void loadPatterns(hours)}
            >
              {patternsLoading ? "Studying…" : "Re-run study"}
            </Button>
          </div>

          {patternError ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {patternError}
            </p>
          ) : null}

          {patternInsight ? (
            <div className="mt-4 space-y-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: "Users studied", value: patternInsight.summary.usersStudied },
                  { label: "Org avg session", value: patternInsight.summary.orgAvgSession },
                  { label: "Anomalies", value: patternInsight.summary.anomalyCount },
                  {
                    label: "Model",
                    value: patternInsight.model || "heuristic-user-patterns-v1",
                  },
                ].map((card) => (
                  <div
                    key={card.label}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="text-[11px] uppercase tracking-wide text-slate-500">{card.label}</div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {String(card.value)}
                    </div>
                  </div>
                ))}
              </div>

              {patternInsight.notes?.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                  {patternInsight.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Behaviour clusters
                  </h3>
                  <div className="mt-2 space-y-2">
                    {(patternInsight.clusters || []).length === 0 ? (
                      <p className="text-sm text-slate-500">No clusters yet.</p>
                    ) : (
                      patternInsight.clusters.map((c) => (
                        <div
                          key={c.id}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-800 dark:text-slate-100">{c.label}</span>
                            <span className="tabular-nums text-slate-500">{c.size}</span>
                          </div>
                          {c.users?.length ? (
                            <div className="mt-1 truncate text-[11px] text-slate-400">
                              {c.users.join(" · ")}
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Top engaged users
                  </h3>
                  <div className="mt-2 overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="pb-2 font-medium">User</th>
                          <th className="pb-2 font-medium">Persona</th>
                          <th className="pb-2 font-medium">Session</th>
                          <th className="pb-2 font-medium">Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(patternInsight.topUsers || []).slice(0, 8).map((u) => (
                          <tr key={`${u.userId}-${u.name}`} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="py-2">
                              <div className="font-medium text-slate-800 dark:text-slate-100">{u.name}</div>
                              <div className="text-[11px] text-slate-400">
                                {[u.topModule, u.topPath].filter(Boolean).join(" · ") || "—"}
                              </div>
                            </td>
                            <td className="py-2 text-xs text-slate-600">{u.persona}</td>
                            <td className="py-2 text-xs tabular-nums text-slate-600">{u.avgSession}</td>
                            <td className="py-2 tabular-nums text-slate-600">{u.engagementScore}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {(patternInsight.anomalies || []).length > 0 ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Anomalies
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {patternInsight.anomalies.slice(0, 8).map((a) => (
                      <li
                        key={`${a.userId}-${a.type}-${a.detail}`}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
                      >
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-medium text-slate-800 dark:text-slate-100">{a.name}</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-600 dark:bg-slate-800">
                            {a.severity} · {a.type}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{a.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : !patternsLoading && !patternError ? (
            <p className="mt-3 text-sm text-slate-500">No pattern study yet — refresh after users sign in.</p>
          ) : patternsLoading ? (
            <p className="mt-3 text-sm text-slate-500">Loading features and asking ML…</p>
          ) : null}
        </section>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {[
            { label: "Active users", value: totals?.uniqueUsers },
            { label: "Page views", value: totals?.pageViews },
            { label: "All events", value: totals?.events },
            { label: "Logins", value: totals?.logins },
            { label: "Data changes", value: totals?.mutations },
            { label: "Access denied", value: totals?.accessDenied },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950"
            >
              <div className="text-[11px] uppercase tracking-wide text-slate-500">{card.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                {loading && !data ? "…" : (card.value ?? 0).toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Activity over time</h2>
            <p className="mt-0.5 text-xs text-slate-500">Page views, events, and unique users</p>
            <div className="mt-3 h-64">
              {timeline.length ? (
                <ActivityTimelineChart data={timeline} />
              ) : (
                <EmptyChart loading={loading} />
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Top modules</h2>
            <p className="mt-0.5 text-xs text-slate-500">Where people spend time and make changes</p>
            <div className="mt-3 h-64">
              {modules.length ? (
                <TopModulesChart data={modules} />
              ) : (
                <EmptyChart loading={loading} />
              )}
            </div>
          </section>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <RankTable title="Top pages" rows={data?.topPages || []} emptyHint="Browse the app to collect page views." />
          <RankTable title="Top paths" rows={data?.topPaths || []} emptyHint="Paths appear after users navigate." mono />
          <RankTable title="Top actions" rows={data?.topActions || []} emptyHint="No actions in this window yet." />
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Most active users</h2>
            <div className="mt-3 overflow-auto">
              {(data?.activeUsers || []).length === 0 ? (
                <p className="text-sm text-slate-500">
                  {loading ? "Loading…" : "No user activity in this window yet."}
                </p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="pb-2 font-medium">User</th>
                      <th className="pb-2 font-medium">Events</th>
                      <th className="pb-2 font-medium">Pages</th>
                      <th className="pb-2 font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.activeUsers || []).map((u) => (
                      <tr key={u.userId} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-2">
                          <div className="font-medium text-slate-800 dark:text-slate-100">{who(u)}</div>
                          <div className="text-[11px] text-slate-400">
                            {[u.username, u.email].filter(Boolean).join(" · ") || u.userId}
                          </div>
                        </td>
                        <td className="py-2 tabular-nums">{u.events}</td>
                        <td className="py-2 tabular-nums">{u.pageViews}</td>
                        <td className="py-2 text-xs text-slate-500">{formatWhen(u.lastSeen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function RankTable({
  title,
  rows,
  emptyHint,
  mono,
}: {
  title: string;
  rows: { key: string; count: number }[];
  emptyHint: string;
  mono?: boolean;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
      <div className="mt-3 space-y-2">
        {!rows.length ? (
          <p className="text-sm text-slate-500">{emptyHint}</p>
        ) : (
          rows.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3 text-sm">
              <span
                className={`min-w-0 truncate text-slate-700 dark:text-slate-200 ${mono ? "font-mono text-[11px]" : ""}`}
                title={row.key}
              >
                {row.key}
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">{row.count}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function EmptyChart({ loading }: { loading: boolean }) {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 text-sm text-slate-500 dark:border-slate-700">
      {loading ? "Loading…" : "No data in this window yet — use the app and refresh."}
    </div>
  );
}
