/**
 * One PDF covering service health, performance, users, system usage, and crash
 * analytics — for admins.
 */

import { apiFetch } from "@/lib/api-auth";
import { ensureSampleRoleUsers } from "@/lib/auth";
import type { CrashAnalyticsSummary } from "@/lib/crash-analytics/types";
import { safeFilename } from "@/lib/export/download";
import { drawPdfFooter, drawPdfLetterhead } from "@/lib/export/letterhead";
import { formatPdfCell } from "@/lib/export/table-export";
import {
  SERVICE_STATUS_LABEL,
  type ClientPerformance,
  type SystemHealthReport,
} from "@/lib/system-health/types";

type SystemAnalyticsSummary = {
  ok: boolean;
  windowHours: number;
  totals: {
    events: number;
    pageViews: number;
    uniqueUsers: number;
    logins: number;
    mutations: number;
    accessDenied: number;
  };
  topModules: { key: string; count: number }[];
  activeUsers: {
    userId: string;
    userName: string;
    username: string;
    email: string;
    events: number;
    pageViews: number;
    lastSeen: string;
  }[];
};

async function fetchSystemAnalytics(hours: number): Promise<SystemAnalyticsSummary | null> {
  try {
    const res = await apiFetch(`/api/analytics?hours=${hours}`);
    if (!res.ok) return null;
    return (await res.json()) as SystemAnalyticsSummary;
  } catch {
    return null;
  }
}

async function fetchSystemHealth(): Promise<SystemHealthReport | null> {
  try {
    const res = await apiFetch("/api/system-health", { cache: "no-store", timeoutMs: 20_000 });
    if (!res.ok) return null;
    return (await res.json()) as SystemHealthReport;
  } catch {
    return null;
  }
}

function fmtWhen(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function fmtKb(value: number): string {
  return value >= 1024 ? `${(value / 1024).toFixed(2)} MB` : `${value.toFixed(1)} KB`;
}

function fmtUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * Builds and downloads the system report PDF: service health, performance,
 * users + permissions, system usage (from /api/analytics), and crash analytics
 * (from /api/crash).
 *
 * Pass already-loaded `crash` / `health` payloads (e.g. from the page that
 * triggered the download) to avoid a second fetch; health is otherwise pulled
 * fresh so a report generated from anywhere still says what was working.
 * `clientPerformance` can only be measured in the tab that loaded the app, so
 * it is included only when the caller supplies it.
 */
export async function downloadSystemReport(options?: {
  hours?: number;
  crash?: CrashAnalyticsSummary | null;
  health?: SystemHealthReport | null;
  clientPerformance?: ClientPerformance | null;
}): Promise<void> {
  const hours = options?.hours ?? 168;
  const [{ jsPDF }, { default: autoTable }, analytics, health] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    fetchSystemAnalytics(hours),
    options?.health ? Promise.resolve(options.health) : fetchSystemHealth(),
  ]);
  const crash = options?.crash ?? null;
  const clientPerf = options?.clientPerformance ?? null;
  const users = ensureSampleRoleUsers();

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const marginX = 14;
  const pageHeight = doc.internal.pageSize.getHeight();

  let y = drawPdfLetterhead(doc, {
    title: "System Report",
    subtitle:
      `Last ${hours}h · generated ${new Date().toLocaleString()}` +
      (health ? ` · ${health.ok ? "Operational" : "Attention needed"}` : ""),
  });

  function ensureSpace(next: number) {
    if (y + next > pageHeight - 16) {
      drawPdfFooter(doc);
      doc.addPage();
      y = drawPdfLetterhead(doc, { title: "System Report" });
    }
  }

  function sectionTitle(text: string) {
    ensureSpace(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(text, marginX, y);
    y += 5;
  }

  function afterTable() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalY = (doc as any).lastAutoTable?.finalY as number | undefined;
    y = (finalY ?? y) + 8;
  }

  function emptyNote(text: string) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(text, marginX, y);
    y += 8;
    doc.setTextColor(15, 23, 42);
  }

  // --- Service health ---
  // First section deliberately: "what is broken right now" is the question a
  // system report is opened to answer.
  sectionTitle("Service health");
  if (health) {
    const verdict = health.ok ? "Operational" : "Attention needed";
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `${verdict} — ${health.summary.up} working, ${health.summary.degraded} degraded, ` +
        `${health.summary.down} not working, ${health.summary.notConfigured} not configured ` +
        `(checked ${fmtWhen(health.generatedAt)})`,
      marginX,
      y,
      { maxWidth: 182 },
    );
    y += 7;
    doc.setTextColor(15, 23, 42);

    autoTable(doc, {
      startY: y,
      head: [["Service", "Status", "Latency", "Host", "Detail"]],
      body: health.services.map((s) => [
        s.required ? `${s.name} (required)` : s.name,
        SERVICE_STATUS_LABEL[s.status],
        fmtMs(s.latencyMs),
        s.target || "—",
        s.detail || "—",
      ]),
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.3, overflow: "linebreak" },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      columnStyles: { 4: { cellWidth: 62 } },
      // Red for down, amber for degraded — the table has to be readable at a glance.
      didParseCell: (data) => {
        if (data.section !== "body" || data.column.index !== 1) return;
        const label = String(data.cell.raw || "");
        if (label === SERVICE_STATUS_LABEL.down) {
          data.cell.styles.textColor = [190, 18, 60];
          data.cell.styles.fontStyle = "bold";
        } else if (label === SERVICE_STATUS_LABEL.degraded) {
          data.cell.styles.textColor = [180, 83, 9];
        } else if (label === SERVICE_STATUS_LABEL.up) {
          data.cell.styles.textColor = [4, 120, 87];
        }
      },
      margin: { left: marginX, right: marginX },
    });
    afterTable();
  } else {
    emptyNote("Could not read system health (/api/system-health).");
  }

  // --- Performance ---
  sectionTitle("Performance");
  if (health) {
    const rows: [string, string][] = [
      ["Environment", `${health.process.environment} · build ${health.process.release}`],
      ["Web process uptime", fmtUptime(health.process.uptimeSeconds)],
      ["Resident memory", `${health.process.rssMb} MB`],
      ["Heap used", `${health.process.heapUsedMb} MB of ${health.process.heapTotalMb} MB`],
      ["Event loop lag", fmtMs(health.process.eventLoopLagMs)],
      ["Health probe wall time", fmtMs(health.probeMs)],
      ["Node runtime", `${health.process.nodeVersion} · ${health.process.platform}`],
    ];
    if (clientPerf) {
      rows.push(
        ["Browser — time to first byte", fmtMs(clientPerf.ttfbMs)],
        ["Browser — DOM content loaded", fmtMs(clientPerf.domContentLoadedMs)],
        ["Browser — page load", fmtMs(clientPerf.loadMs)],
        ["Browser — largest contentful paint", fmtMs(clientPerf.lcpMs)],
        [
          "Build assets on this page",
          `${clientPerf.chunkCount} files · ${fmtKb(clientPerf.chunkDecodedKb)} decoded · ` +
            `${fmtKb(clientPerf.chunkTransferKb)} transferred`,
        ],
      );
    }
    autoTable(doc, {
      startY: y,
      head: [["Metric", "Value"]],
      body: rows,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 1.6, overflow: "linebreak" },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      margin: { left: marginX, right: marginX },
      tableWidth: 150,
    });
    afterTable();
  } else {
    emptyNote("Performance metrics unavailable — the health probe did not answer.");
  }

  if (clientPerf?.endpoints.length) {
    sectionTitle("Endpoint response times (measured in-browser)");
    autoTable(doc, {
      startY: y,
      head: [["Endpoint", "Path", "Result", "Round trip"]],
      body: clientPerf.endpoints.map((e) => [e.name, e.path, e.detail, fmtMs(e.latencyMs)]),
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 1.3 },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      margin: { left: marginX, right: marginX },
    });
    afterTable();
  }

  if (clientPerf?.heaviestChunks.length) {
    sectionTitle("Heaviest build chunks");
    autoTable(doc, {
      startY: y,
      head: [["Chunk", "Decoded", "Transferred", "Load time"]],
      body: clientPerf.heaviestChunks.map((c) => [
        c.name,
        fmtKb(c.decodedKb),
        c.transferKb > 0 ? fmtKb(c.transferKb) : "cached",
        fmtMs(c.durationMs),
      ]),
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.3, overflow: "linebreak" },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      margin: { left: marginX, right: marginX },
    });
    afterTable();
  }

  // --- Users & permissions ---
  sectionTitle(`Users (${users.length})`);
  if (users.length) {
    autoTable(doc, {
      startY: y,
      head: [["Name", "Username", "Email", "Role", "View", "Create", "Edit", "Delete"]],
      body: users.map((u) => [
        u.name || "—",
        u.username || "—",
        u.email || "—",
        u.role || "—",
        u.canView || "—",
        u.canCreate || "—",
        u.canEdit || "—",
        u.canDelete || "—",
      ]),
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.3, overflow: "linebreak" },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      margin: { left: marginX, right: marginX },
    });
    afterTable();
  } else {
    emptyNote("No users found.");
  }

  // --- System usage ---
  sectionTitle(`System usage — last ${analytics?.windowHours ?? hours}h`);
  if (analytics) {
    autoTable(doc, {
      startY: y,
      head: [["Metric", "Value"]],
      body: [
        ["Total events", formatPdfCell(analytics.totals.events)],
        ["Page views", formatPdfCell(analytics.totals.pageViews)],
        ["Unique users", formatPdfCell(analytics.totals.uniqueUsers)],
        ["Logins", formatPdfCell(analytics.totals.logins)],
        ["Mutations (create/update/delete)", formatPdfCell(analytics.totals.mutations)],
        ["Access denied", formatPdfCell(analytics.totals.accessDenied)],
      ],
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 1.6 },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      margin: { left: marginX, right: marginX },
      tableWidth: 110,
    });
    afterTable();

    if (analytics.topModules.length) {
      sectionTitle("Most active modules");
      autoTable(doc, {
        startY: y,
        head: [["Module", "Events"]],
        body: analytics.topModules.map((m) => [m.key, formatPdfCell(m.count)]),
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 1.3 },
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
        margin: { left: marginX, right: marginX },
        tableWidth: 110,
      });
      afterTable();
    }

    if (analytics.activeUsers.length) {
      sectionTitle("Most active users");
      autoTable(doc, {
        startY: y,
        head: [["User", "Events", "Page views", "Last seen"]],
        body: analytics.activeUsers.slice(0, 20).map((u) => [
          u.userName || u.username || u.email || u.userId || "Unknown",
          formatPdfCell(u.events),
          formatPdfCell(u.pageViews),
          fmtWhen(u.lastSeen),
        ]),
        theme: "grid",
        styles: { fontSize: 7.5, cellPadding: 1.3 },
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
        margin: { left: marginX, right: marginX },
      });
      afterTable();
    }
  } else {
    emptyNote("Could not load system usage analytics.");
  }

  // --- Crash analytics ---
  sectionTitle(`Crash analytics — last ${crash?.windowHours ?? hours}h`);
  if (crash) {
    autoTable(doc, {
      startY: y,
      head: [["Metric", "Value"]],
      body: [
        ["Total events", formatPdfCell(crash.totalEvents)],
        ["Unique issues", formatPdfCell(crash.uniqueIssues)],
        ["Fatal", formatPdfCell(crash.fatalCount)],
        ["Errors", formatPdfCell(crash.errorCount)],
        ["Warnings", formatPdfCell(crash.warningCount)],
        ["Affected users", formatPdfCell(crash.affectedUsers)],
        ["Affected IPs", formatPdfCell(crash.affectedIps)],
      ],
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 1.6 },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
      margin: { left: marginX, right: marginX },
      tableWidth: 110,
    });
    afterTable();

    if (crash.topIssues.length) {
      sectionTitle("Top issues");
      autoTable(doc, {
        startY: y,
        head: [["Issue", "Severity", "Count", "Last seen", "Routes"]],
        body: crash.topIssues.slice(0, 25).map((issue) => [
          issue.title,
          issue.severity,
          formatPdfCell(issue.count),
          fmtWhen(issue.lastSeen),
          issue.routes.slice(0, 2).join(", ") || "—",
        ]),
        theme: "grid",
        styles: { fontSize: 7, cellPadding: 1.3, overflow: "linebreak" },
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
        margin: { left: marginX, right: marginX },
      });
      afterTable();
    }
  } else {
    emptyNote("Could not load crash analytics.");
  }

  drawPdfFooter(doc);
  doc.save(`${safeFilename("system-report")}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
