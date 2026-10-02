/**
 * Server-side view model for the System health page.
 *
 * Every judgement the page shows is made here: what counts as slow, what
 * counts as broken, which services group together, how a byte count reads.
 * The page component receives finished strings and tone tokens, so a threshold
 * exists in exactly one place and none of it ships to the browser.
 *
 * Server-only — this module reaches into the probe's shapes and must never be
 * imported from a "use client" file. Import types from ./types instead.
 */

import type {
  ClientPerformance,
  ClientPerformanceSample,
  ClientPerformanceView,
  HealthTone,
  ProcessPerformance,
  ServiceCheck,
  ServiceRowView,
  ServiceStatus,
  SystemHealthReport,
  SystemHealthView,
} from "@/lib/system-health/types";
import { SERVICE_STATUS_LABEL } from "@/lib/system-health/types";

const GROUPS: { key: ServiceCheck["group"]; label: string }[] = [
  { key: "core", label: "Core" },
  { key: "data", label: "Data" },
  { key: "messaging", label: "Messaging & realtime" },
  { key: "ai", label: "AI / ML" },
];

/** Endpoints the browser is asked to time — the ones the app leans on hardest. */
const ENDPOINT_TARGETS: { name: string; path: string }[] = [
  { name: "Web liveness", path: "/api/health" },
  { name: "Go API (via proxy)", path: "/api/sync/status" },
  { name: "Usage analytics", path: "/api/analytics?hours=1" },
];

/** Above this the web process is scheduling badly, not merely busy. */
const EVENT_LOOP_LAG_WARN_MS = 50;
/** Round trips: under a third of a second reads as instant, over ~1.2s as stalled. */
const LATENCY_GOOD_MS = 300;
const LATENCY_WARN_MS = 1_200;
/** Bounds on untrusted browser input — a sample is a reading, not a payload budget. */
const MAX_SAMPLE_RESOURCES = 400;
const MAX_TEXT = 300;
const HEAVIEST_CHUNK_ROWS = 12;

/**
 * Server timezone with the zone spelled out. Formatting the timestamp in the
 * browser instead would either mismatch at hydration or force a client-only
 * effect; naming the zone keeps one honest reading for every operator.
 */
const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZoneName: "short",
});

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
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

function fmtKb(value: number): string {
  return value >= 1024 ? `${(value / 1024).toFixed(2)} MB` : `${value.toFixed(1)} KB`;
}

function fmtWhen(iso: string): string {
  if (!iso) return "—";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : TIME_FORMAT.format(at);
}

function statusTone(status: ServiceStatus): HealthTone {
  if (status === "up") return "good";
  if (status === "degraded") return "warn";
  if (status === "down") return "bad";
  return "muted";
}

/** A latency without a verdict beside it is just trivia. */
function latencyTone(ms: number | null): HealthTone {
  if (ms === null || !Number.isFinite(ms)) return "muted";
  if (ms < LATENCY_GOOD_MS) return "good";
  if (ms < LATENCY_WARN_MS) return "warn";
  return "bad";
}

function processRows(perf: ProcessPerformance): { label: string; value: string }[] {
  return [
    { label: "Uptime", value: fmtUptime(perf.uptimeSeconds) },
    { label: "Resident memory", value: `${perf.rssMb} MB` },
    { label: "Heap used", value: `${perf.heapUsedMb} MB of ${perf.heapTotalMb} MB` },
    { label: "Event loop lag", value: fmtMs(perf.eventLoopLagMs) },
    { label: "Node", value: `${perf.nodeVersion} · ${perf.platform}` },
  ];
}

function serviceRow(service: ServiceCheck): ServiceRowView {
  return {
    key: service.key,
    name: service.name,
    required: service.required,
    statusLabel: SERVICE_STATUS_LABEL[service.status],
    statusTone: statusTone(service.status),
    latencyLabel: fmtMs(service.latencyMs),
    latencyTone: latencyTone(service.latencyMs),
    target: service.target || "—",
    detail: service.envVar ? `${service.detail} (${service.envVar})` : service.detail,
  };
}

/** Overall verdict, in the words an operator needs first. */
function headline(report: SystemHealthReport): string {
  if (report.summary.down > 0) {
    const n = report.summary.down;
    return `${n} service${n === 1 ? "" : "s"} not working`;
  }
  if (report.summary.degraded > 0) return `${report.summary.degraded} degraded`;
  return "All checked services are working";
}

export function buildSystemHealthView(report: SystemHealthReport): SystemHealthView {
  const groups = GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    services: report.services.filter((s) => s.group === group.key).map(serviceRow),
  })).filter((group) => group.services.length > 0);

  const attention = report.services
    .filter((s) => s.status === "down" || s.status === "degraded")
    .map((s) => ({
      key: s.key,
      name: s.name,
      statusLabel: SERVICE_STATUS_LABEL[s.status],
      statusTone: statusTone(s.status),
      detail: s.envVar ? `${s.detail} (${s.envVar})` : s.detail,
    }));

  return {
    ok: report.ok,
    statusLabel: report.ok ? "Operational" : "Attention needed",
    statusTone: report.ok ? "good" : "bad",
    headline: headline(report),
    checkedAtLabel: fmtWhen(report.generatedAt),
    environmentLabel: `${report.process.environment} · build ${report.process.release}`,
    cards: [
      { label: "Working", value: String(report.summary.up), tone: "good" },
      { label: "Degraded", value: String(report.summary.degraded), tone: "warn" },
      { label: "Not working", value: String(report.summary.down), tone: "bad" },
      { label: "Not configured", value: String(report.summary.notConfigured), tone: "muted" },
      { label: "Probe time", value: fmtMs(report.probeMs), tone: "neutral" },
      {
        label: "Event loop lag",
        value: fmtMs(report.process.eventLoopLagMs),
        tone: report.process.eventLoopLagMs > EVENT_LOOP_LAG_WARN_MS ? "bad" : "neutral",
      },
    ],
    attention,
    groups,
    process: processRows(report.process),
    endpointTargets: ENDPOINT_TARGETS,
  };
}

const KB = 1024;

function kb(bytes: number): number {
  return Math.round((bytes / KB) * 10) / 10;
}

function finite(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function nullableMs(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function text(value: unknown): string {
  return String(value ?? "").slice(0, MAX_TEXT);
}

/** Short chunk label — `/_next/static/chunks/app/(main)/page-6f2a.js` reads as `app/(main)/page`. */
function chunkLabel(rawUrl: string): string {
  const path = (() => {
    try {
      return new URL(rawUrl, "http://asset.internal/").pathname;
    } catch {
      return rawUrl;
    }
  })();
  const file = path.split("/").pop() || path;
  const trimmed = file.replace(/\.(js|css)$/i, "").replace(/[-.][0-9a-f]{6,}$/i, "");
  if (path.includes("/chunks/app/")) {
    const after = path.split("/chunks/app/")[1] || "";
    const dir = after.slice(0, after.lastIndexOf("/"));
    return dir ? `app/${dir}/${trimmed}` : `app/${trimmed}`;
  }
  return trimmed || file;
}

/**
 * Only same-origin build assets count as page weight. `transferSize` is 0 on a
 * cached hit, so decoded size is carried alongside it — otherwise a warm reload
 * would claim the page ships no JavaScript at all.
 */
function buildAssets(sample: ClientPerformanceSample) {
  const resources = Array.isArray(sample.resources) ? sample.resources : [];
  return resources
    .slice(0, MAX_SAMPLE_RESOURCES)
    .filter((entry) => {
      const type = String(entry?.initiatorType || "");
      if (type !== "script" && type !== "link") return false;
      return String(entry?.url || "").includes("/_next/static/");
    })
    .map((entry) => ({
      url: text(entry.url),
      transferBytes: Math.max(0, finite(entry.transferBytes)),
      decodedBytes: Math.max(0, finite(entry.decodedBytes)),
      durationMs: Math.max(0, finite(entry.durationMs)),
    }));
}

/**
 * Turns one raw browser sample into both the rendered rows and the
 * `ClientPerformance` payload the System Report PDF embeds. The tab measured
 * these numbers; every reading of them happens here.
 */
export function describeClientSample(sample: ClientPerformanceSample): {
  view: ClientPerformanceView;
  performance: ClientPerformance;
} {
  const assets = buildAssets(sample);
  const transferBytes = assets.reduce((sum, a) => sum + a.transferBytes, 0);
  const decodedBytes = assets.reduce((sum, a) => sum + a.decodedBytes, 0);

  const heaviestChunks = [...assets]
    .sort((a, b) => b.decodedBytes - a.decodedBytes)
    .slice(0, HEAVIEST_CHUNK_ROWS)
    .map((asset) => ({
      name: chunkLabel(asset.url),
      transferKb: kb(asset.transferBytes),
      decodedKb: kb(asset.decodedBytes),
      durationMs: Math.round(asset.durationMs),
    }));

  const measured = Array.isArray(sample.endpoints) ? sample.endpoints : [];
  const endpoints = ENDPOINT_TARGETS.map((target) => {
    const hit = measured.find((row) => text(row?.path) === target.path);
    const ok = Boolean(hit?.ok);
    const latencyMs = hit ? Math.max(0, Math.round(finite(hit.latencyMs))) : 0;
    const detail = (() => {
      if (!hit) return "Not measured";
      if (hit.error) return text(hit.error);
      const status = Math.round(finite(hit.status));
      if (!status) return "Request failed";
      return ok ? `HTTP ${status}` : `HTTP ${status} ${text(hit.statusText)}`.trim();
    })();
    return { name: target.name, path: target.path, ok, latencyMs, detail };
  }).filter((row) => measured.some((m) => text(m?.path) === row.path));

  const performance: ClientPerformance = {
    ttfbMs: nullableMs(sample.ttfbMs),
    domContentLoadedMs: nullableMs(sample.domContentLoadedMs),
    loadMs: nullableMs(sample.loadMs),
    lcpMs: nullableMs(sample.lcpMs),
    chunkCount: assets.length,
    chunkTransferKb: kb(transferBytes),
    chunkDecodedKb: kb(decodedBytes),
    heaviestChunks,
    endpoints,
  };

  const view: ClientPerformanceView = {
    session: [
      { label: "Time to first byte", value: fmtMs(performance.ttfbMs) },
      { label: "DOM content loaded", value: fmtMs(performance.domContentLoadedMs) },
      { label: "Page load", value: fmtMs(performance.loadMs) },
      { label: "Largest contentful paint", value: fmtMs(performance.lcpMs) },
      {
        label: "Build assets",
        value:
          `${performance.chunkCount} file${performance.chunkCount === 1 ? "" : "s"} · ` +
          `${fmtKb(performance.chunkDecodedKb)} decoded`,
      },
      { label: "Transferred over network", value: fmtKb(performance.chunkTransferKb) },
    ],
    endpoints: endpoints.map((row) => ({
      name: row.name,
      path: row.path,
      ok: row.ok,
      detail: row.detail,
      latencyLabel: fmtMs(row.latencyMs),
      latencyTone: latencyTone(row.latencyMs),
    })),
    chunks: heaviestChunks.map((chunk) => ({
      name: chunk.name,
      decodedLabel: fmtKb(chunk.decodedKb),
      // A cached chunk transfers nothing; "0.0 KB" would read as a free asset.
      transferLabel: chunk.transferKb > 0 ? fmtKb(chunk.transferKb) : "cached",
      durationLabel: fmtMs(chunk.durationMs),
    })),
  };

  return { view, performance };
}
