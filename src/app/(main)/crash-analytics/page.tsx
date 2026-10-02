"use client";

import { useAppShell } from "@/components/app-shell";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { PaginationBar } from "@/components/pagination-bar";
import { SegmentTabList, segmentTabClass } from "@/components/segment-tabs";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePagination } from "@/hooks/use-pagination";
import { currentUserCan, currentUserIsAdmin } from "@/lib/access-control";
import { apiFetch } from "@/lib/api-auth";
import { appToastError, appToastInfo } from "@/lib/app-toast";
import type {
  CrashActorRow,
  CrashAnalyticsSummary,
  CrashEvent,
  CrashIssue,
} from "@/lib/crash-analytics/types";
import { downloadSystemReport } from "@/lib/export/system-report";
import { Danger, DocumentDownload, Global, HambergerMenu, Profile2User, Refresh } from "iconsax-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type TabKey = "issues" | "users" | "ips" | "events";

const TABS: { key: TabKey; label: string }[] = [
  { key: "issues", label: "Issues" },
  { key: "users", label: "By user" },
  { key: "ips", label: "By IP" },
  { key: "events", label: "Events" },
];

const SEVERITIES = ["fatal", "error", "warning"];
const SOURCES = [
  "window.onerror",
  "unhandledrejection",
  "react-boundary",
  "global-error",
  "manual",
  "import",
  "proxy",
];

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

function severityClass(severity: string): string {
  if (severity === "fatal") return "bg-rose-50 text-rose-700 ring-1 ring-rose-100";
  if (severity === "warning") return "bg-amber-50 text-amber-800 ring-1 ring-amber-100";
  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function listLabel(values: string[], max = 2): string {
  if (!values.length) return "—";
  const shown = values.slice(0, max).join(", ");
  return values.length > max ? `${shown} +${values.length - max}` : shown;
}

const CARD_CLASS =
  "min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4";
const SECTION_CLASS = "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm";
const THEAD_CLASS =
  "border-b border-slate-100 bg-slate-50/70 text-[10px] tracking-wide text-slate-400 uppercase";
const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-white px-2 text-[13px] text-slate-700 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20";

export default function CrashAnalyticsPage() {
  const { openSidebar } = useAppShell();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CrashAnalyticsSummary | null>(null);
  const [tab, setTab] = useState<TabKey>("issues");
  const [reportBusy, setReportBusy] = useState(false);

  const [hours, setHours] = useState("48");
  const [q, setQ] = useState("");
  const [user, setUser] = useState("");
  const [ip, setIp] = useState("");
  const [severity, setSeverity] = useState("");
  const [source, setSource] = useState("");
  const [draftQ, setDraftQ] = useState("");
  const [draftUser, setDraftUser] = useState("");
  const [draftIp, setDraftIp] = useState("");
  const [draftSeverity, setDraftSeverity] = useState("");
  const [draftSource, setDraftSource] = useState("");

  const load = useCallback(
    async (seed = false) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ hours, limit: "500" });
        if (seed) params.set("seed", "1");
        if (q.trim()) params.set("q", q.trim());
        if (user.trim()) params.set("user", user.trim());
        if (ip.trim()) params.set("ip", ip.trim());
        if (severity) params.set("severity", severity);
        if (source) params.set("source", source);
        const res = await apiFetch(`/api/crash?${params.toString()}`);
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `Failed (${res.status})`);
        }
        const json = (await res.json()) as CrashAnalyticsSummary;
        setData(json);
        if (seed) appToastInfo("Seeded", "Historical 48h incidents loaded into the store.");
      } catch (err) {
        appToastError("Could not load crashes", err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [hours, q, user, ip, severity, source],
  );

  useEffect(() => {
    queueMicrotask(() => {
      if (!currentUserIsAdmin() || !currentUserCan("edit-settings")) {
        appToastError("Access denied", "Only Administrators can view crash analytics.");
        router.replace("/");
        return;
      }
      setReady(true);
      void load(false);
    });
  }, [router, load]);

  const issues: CrashIssue[] = data?.topIssues || [];
  const userRows: CrashActorRow[] = data?.byUser || [];
  const ipRows: CrashActorRow[] = data?.byIp || [];
  const events: CrashEvent[] = data?.events || [];

  const issuesPager = usePagination(issues, 25);
  const usersPager = usePagination(userRows, 25);
  const ipsPager = usePagination(ipRows, 25);
  const eventsPager = usePagination(events, 25);

  async function downloadReport() {
    setReportBusy(true);
    try {
      await downloadSystemReport({ hours: Number(hours) || 48, crash: data });
    } catch (err) {
      appToastError(
        "Could not build report",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setReportBusy(false);
    }
  }

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setQ(draftQ);
    setUser(draftUser);
    setIp(draftIp);
    setSeverity(draftSeverity);
    setSource(draftSource);
  }

  function clearFilters() {
    setDraftQ("");
    setDraftUser("");
    setDraftIp("");
    setDraftSeverity("");
    setDraftSource("");
    setQ("");
    setUser("");
    setIp("");
    setSeverity("");
    setSource("");
  }

  function drillIntoUser(key: string) {
    const value = key === "(anonymous)" ? "" : key;
    setDraftUser(value);
    setUser(value);
    setTab("events");
  }

  function drillIntoIp(key: string) {
    const value = key === "(unknown)" ? "" : key;
    setDraftIp(value);
    setIp(value);
    setTab("events");
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Checking access…
      </div>
    );
  }

  const cards = [
    { label: "Events", value: data?.totalEvents ?? "—" },
    { label: "Issues", value: data?.uniqueIssues ?? "—" },
    { label: "Fatal", value: data?.fatalCount ?? "—" },
    { label: "Errors", value: data?.errorCount ?? "—" },
    { label: "Users", value: data?.affectedUsers ?? "—" },
    { label: "IPs", value: data?.affectedIps ?? "—" },
  ];

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
            <span className="font-medium text-slate-700">Crash analytics</span>
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
          <div>
            <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-slate-900">
              <Danger size={22} variant="Linear" color="currentColor" />
              Crash analytics
            </h1>
            <p className="mt-1 text-[13px] text-slate-500">
              Crashes grouped by issue, user, and IP address for the last {data?.windowHours ?? hours}h
              · storage {data?.storage ?? "—"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className={SELECT_CLASS}
              aria-label="Time window"
            >
              <option value="6">Last 6h</option>
              <option value="24">Last 24h</option>
              <option value="48">Last 48h</option>
              <option value="168">Last 7d</option>
              <option value="336">Last 14d</option>
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void load(true)}
            >
              Seed 48h
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void load(false)}
            >
              <Refresh size={14} color="currentColor" className="mr-1" />
              Refresh
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {cards.map((card) => (
            <div key={card.label} className={CARD_CLASS}>
              <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                {card.label}
              </p>
              <p className="mt-1.5 text-[20px] font-semibold tracking-tight text-slate-900">
                {card.value}
              </p>
            </div>
          ))}
        </div>

        <form
          onSubmit={applyFilters}
          className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
        >
          <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
            Search
            <Input
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              placeholder="Message, route, fingerprint…"
              className="h-9"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
            User
            <Input
              value={draftUser}
              onChange={(e) => setDraftUser(e.target.value)}
              placeholder="Username, id, role"
              className="h-9"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
            IP address
            <Input
              value={draftIp}
              onChange={(e) => setDraftIp(e.target.value)}
              placeholder="e.g. 41.90."
              className="h-9"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
            Severity
            <select
              value={draftSeverity}
              onChange={(e) => setDraftSeverity(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">All</option>
              {SEVERITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
            Source
            <select
              value={draftSource}
              onChange={(e) => setDraftSource(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">All</option>
              {SOURCES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
            <Button type="submit" size="sm" disabled={loading}>
              Apply filters
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={clearFilters} disabled={loading}>
              Clear
            </Button>
            <span className="ml-auto text-[12px] text-slate-500">
              {loading
                ? "Loading…"
                : `${events.length} event${events.length === 1 ? "" : "s"} · ${userRows.length} user${userRows.length === 1 ? "" : "s"} · ${ipRows.length} IP${ipRows.length === 1 ? "" : "s"}`}
            </span>
          </div>
        </form>

        <SegmentTabList className="flex-wrap">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={segmentTabClass(tab === item.key, { stretch: false })}
            >
              {item.label}
            </button>
          ))}
        </SegmentTabList>

        {tab === "issues" ? (
          <section className={SECTION_CLASS}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-[12px]">
                <thead className={THEAD_CLASS}>
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Issue</th>
                    <th className="px-3 py-2.5 font-medium">Severity</th>
                    <th className="px-3 py-2.5 font-medium">Count</th>
                    <th className="px-3 py-2.5 font-medium">Users</th>
                    <th className="px-3 py-2.5 font-medium">IPs</th>
                    <th className="px-3 py-2.5 font-medium">Source</th>
                    <th className="px-3 py-2.5 font-medium">Last seen</th>
                    <th className="px-3 py-2.5 font-medium">Routes</th>
                  </tr>
                </thead>
                <tbody>
                  {issuesPager.pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                        {loading ? "Loading crashes…" : "No crash events match these filters."}
                      </td>
                    </tr>
                  ) : (
                    issuesPager.pageItems.map((issue) => (
                      <tr
                        key={issue.fingerprint}
                        className="border-b border-slate-100 align-top hover:bg-slate-50/80"
                      >
                        <td className="max-w-[320px] px-3 py-2.5">
                          <div className="font-medium text-slate-900">{issue.title}</div>
                          <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                            {issue.fingerprint}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${severityClass(issue.severity)}`}
                          >
                            {issue.severity}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-700">{issue.count}</td>
                        <td className="max-w-[160px] px-3 py-2.5 text-slate-600">
                          {listLabel(issue.users)}
                        </td>
                        <td className="max-w-[160px] px-3 py-2.5 font-mono text-[11px] text-slate-600">
                          {listLabel(issue.ips)}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{issue.source}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                          {formatWhen(issue.lastSeen)}
                        </td>
                        <td className="max-w-[200px] px-3 py-2.5 text-slate-500">
                          {issue.routes.slice(0, 3).join(", ") || "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={issuesPager.page}
              pages={issuesPager.pages}
              total={issuesPager.total}
              pageSize={issuesPager.pageSize}
              from={issuesPager.from}
              to={issuesPager.to}
              onPageChange={issuesPager.setPage}
              onPageSizeChange={issuesPager.setPageSize}
            />
          </section>
        ) : null}

        {tab === "users" ? (
          <section className={SECTION_CLASS}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <Profile2User size={16} variant="Linear" color="currentColor" className="text-slate-400" />
              <div>
                <h2 className="text-[14px] font-semibold text-slate-900">Crashes per user</h2>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  Signed-in identity attached to the crash report. Unauthenticated or pre-login
                  crashes group under “(anonymous)”.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-[12px]">
                <thead className={THEAD_CLASS}>
                  <tr>
                    <th className="px-3 py-2.5 font-medium">User</th>
                    <th className="px-3 py-2.5 font-medium">Events</th>
                    <th className="px-3 py-2.5 font-medium">Fatal</th>
                    <th className="px-3 py-2.5 font-medium">Errors</th>
                    <th className="px-3 py-2.5 font-medium">Issues</th>
                    <th className="px-3 py-2.5 font-medium">IPs</th>
                    <th className="px-3 py-2.5 font-medium">Last crash</th>
                    <th className="px-3 py-2.5 font-medium">Latest</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {usersPager.pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-10 text-center text-slate-500">
                        {loading ? "Loading users…" : "No users match these filters."}
                      </td>
                    </tr>
                  ) : (
                    usersPager.pageItems.map((row) => (
                      <tr key={row.key} className="border-b border-slate-100 align-top hover:bg-slate-50/80">
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-slate-900">{row.label}</div>
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            {row.secondary || "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-700">{row.count}</td>
                        <td className="px-3 py-2.5 tabular-nums text-rose-600">{row.fatalCount}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-700">{row.errorCount}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-700">{row.issues}</td>
                        <td className="max-w-[180px] px-3 py-2.5 font-mono text-[11px] text-slate-600">
                          {listLabel(row.related)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                          {formatWhen(row.lastSeen)}
                        </td>
                        <td className="max-w-[260px] px-3 py-2.5 text-slate-500">
                          <div className="truncate" title={row.lastTitle}>
                            {row.lastTitle}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => drillIntoUser(row.key)}
                          >
                            Events
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={usersPager.page}
              pages={usersPager.pages}
              total={usersPager.total}
              pageSize={usersPager.pageSize}
              from={usersPager.from}
              to={usersPager.to}
              onPageChange={usersPager.setPage}
              onPageSizeChange={usersPager.setPageSize}
            />
          </section>
        ) : null}

        {tab === "ips" ? (
          <section className={SECTION_CLASS}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <Global size={16} variant="Linear" color="currentColor" className="text-slate-400" />
              <div>
                <h2 className="text-[14px] font-semibold text-slate-900">Crashes per IP address</h2>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  Address is taken from the proxy headers when the report reaches the server, so
                  older events recorded before this show “(unknown)”.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-[12px]">
                <thead className={THEAD_CLASS}>
                  <tr>
                    <th className="px-3 py-2.5 font-medium">IP</th>
                    <th className="px-3 py-2.5 font-medium">Events</th>
                    <th className="px-3 py-2.5 font-medium">Fatal</th>
                    <th className="px-3 py-2.5 font-medium">Errors</th>
                    <th className="px-3 py-2.5 font-medium">Issues</th>
                    <th className="px-3 py-2.5 font-medium">Users</th>
                    <th className="px-3 py-2.5 font-medium">Last crash</th>
                    <th className="px-3 py-2.5 font-medium">Latest</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {ipsPager.pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-10 text-center text-slate-500">
                        {loading ? "Loading addresses…" : "No addresses match these filters."}
                      </td>
                    </tr>
                  ) : (
                    ipsPager.pageItems.map((row) => (
                      <tr key={row.key} className="border-b border-slate-100 align-top hover:bg-slate-50/80">
                        <td className="px-3 py-2.5">
                          <div className="font-mono text-[12px] font-medium text-slate-900">
                            {row.label}
                          </div>
                          <div className="mt-0.5 max-w-[220px] truncate text-[10px] text-slate-400" title={row.secondary}>
                            {row.secondary || "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-700">{row.count}</td>
                        <td className="px-3 py-2.5 tabular-nums text-rose-600">{row.fatalCount}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-700">{row.errorCount}</td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-700">{row.issues}</td>
                        <td className="max-w-[180px] px-3 py-2.5 text-slate-600">
                          {listLabel(row.related)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                          {formatWhen(row.lastSeen)}
                        </td>
                        <td className="max-w-[260px] px-3 py-2.5 text-slate-500">
                          <div className="truncate" title={row.lastTitle}>
                            {row.lastTitle}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => drillIntoIp(row.key)}
                          >
                            Events
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={ipsPager.page}
              pages={ipsPager.pages}
              total={ipsPager.total}
              pageSize={ipsPager.pageSize}
              from={ipsPager.from}
              to={ipsPager.to}
              onPageChange={ipsPager.setPage}
              onPageSizeChange={ipsPager.setPageSize}
            />
          </section>
        ) : null}

        {tab === "events" ? (
          <section className={SECTION_CLASS}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-[12px]">
                <thead className={THEAD_CLASS}>
                  <tr>
                    <th className="px-3 py-2.5 font-medium">When</th>
                    <th className="px-3 py-2.5 font-medium">User</th>
                    <th className="px-3 py-2.5 font-medium">IP</th>
                    <th className="px-3 py-2.5 font-medium">Severity</th>
                    <th className="px-3 py-2.5 font-medium">Crash</th>
                    <th className="px-3 py-2.5 font-medium">Route</th>
                    <th className="px-3 py-2.5 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {eventsPager.pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                        {loading ? "Loading events…" : "No crash events match these filters."}
                      </td>
                    </tr>
                  ) : (
                    eventsPager.pageItems.map((event) => (
                      <tr key={event.id} className="border-b border-slate-100 align-top hover:bg-slate-50/80">
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                          {formatWhen(event.occurredAt)}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-slate-800">
                            {event.username || event.userId || "(anonymous)"}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-400">{event.role || "—"}</div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-600">
                          {event.ip || "(unknown)"}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${severityClass(event.severity)}`}
                          >
                            {event.severity}
                          </span>
                        </td>
                        <td className="max-w-[320px] px-3 py-2.5">
                          <div className="truncate font-medium text-slate-900" title={event.title}>
                            {event.title}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                            {event.fingerprint}
                          </div>
                        </td>
                        <td className="max-w-[220px] px-3 py-2.5">
                          <div className="truncate font-mono text-[11px] text-slate-600" title={event.route || event.url}>
                            {event.route || event.url || "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{event.source}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={eventsPager.page}
              pages={eventsPager.pages}
              total={eventsPager.total}
              pageSize={eventsPager.pageSize}
              from={eventsPager.from}
              to={eventsPager.to}
              onPageChange={eventsPager.setPage}
              onPageSizeChange={eventsPager.setPageSize}
            />
          </section>
        ) : null}
      </main>
    </>
  );
}
