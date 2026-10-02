/**
 * Shapes shared by the /api/system-health probe, the System health page, and
 * the System Report PDF. Kept in their own module so neither the PDF builder
 * nor the page pulls server-only probe/view code into the browser bundle —
 * the client ships these types and nothing else from this feature.
 */

export type ServiceStatus = "up" | "degraded" | "down" | "not-configured";

export type ServiceCheck = {
  key: string;
  name: string;
  /** Grouping for the UI: what this dependency is for. */
  group: "core" | "data" | "messaging" | "ai";
  status: ServiceStatus;
  /** Round-trip of the probe itself; null when nothing was called. */
  latencyMs: number | null;
  /** Human-readable reason — error text when down, config hint when unset. */
  detail: string;
  /** Host only; credentials and paths are never returned. */
  target: string;
  /** When true a `down` status makes the whole system unhealthy. */
  required: boolean;
  /** Env var to set when the service is not configured. */
  envVar?: string;
};

export type ProcessPerformance = {
  nodeVersion: string;
  platform: string;
  uptimeSeconds: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  /** Timer drift under load — the cheapest honest signal that the web process is saturated. */
  eventLoopLagMs: number;
  environment: string;
  release: string;
};

export type SystemHealthReport = {
  ok: boolean;
  generatedAt: string;
  /** Wall time spent running every probe (they run in parallel). */
  probeMs: number;
  services: ServiceCheck[];
  process: ProcessPerformance;
  summary: {
    total: number;
    up: number;
    degraded: number;
    down: number;
    notConfigured: number;
  };
};

/** Browser-side timings — only the System health page fills these in. */
export type ClientPerformance = {
  /** Navigation Timing v2, in ms. */
  ttfbMs: number | null;
  domContentLoadedMs: number | null;
  loadMs: number | null;
  /** Largest contentful paint when the browser reports one. */
  lcpMs: number | null;
  /** JS/CSS chunks pulled for the current page. */
  chunkCount: number;
  chunkTransferKb: number;
  chunkDecodedKb: number;
  /** Heaviest chunks first — this is what bundle bloat looks like at runtime. */
  heaviestChunks: { name: string; transferKb: number; decodedKb: number; durationMs: number }[];
  /** Live latency of the endpoints the app actually calls. */
  endpoints: { name: string; path: string; ok: boolean; latencyMs: number; detail: string }[];
};

/**
 * Raw browser readings. The tab holds the stopwatch — nothing here is a
 * verdict, a label, or a unit conversion. `describeClientSample` on the server
 * turns this into the rows that get rendered, so no threshold ever lives in
 * client code where it could drift from the probe's own thresholds.
 */
export type ClientPerformanceSample = {
  ttfbMs: number | null;
  domContentLoadedMs: number | null;
  loadMs: number | null;
  lcpMs: number | null;
  /** Every resource entry the tab recorded; the server picks out build assets. */
  resources: {
    url: string;
    initiatorType: string;
    transferBytes: number;
    decodedBytes: number;
    durationMs: number;
  }[];
  /** Round trips the tab timed against the paths the server asked it to time. */
  endpoints: {
    path: string;
    ok: boolean;
    status: number;
    statusText: string;
    latencyMs: number;
    error: string;
  }[];
};

/**
 * Semantic colour verdict. The server decides *whether* a number is good; the
 * page decides what "good" looks like. Sending Tailwind classes over the wire
 * instead would put styling in the payload and hide it from Tailwind's scanner.
 */
export type HealthTone = "good" | "warn" | "bad" | "muted" | "neutral";

export type ServiceRowView = {
  key: string;
  name: string;
  required: boolean;
  statusLabel: string;
  statusTone: HealthTone;
  latencyLabel: string;
  latencyTone: HealthTone;
  target: string;
  detail: string;
};

export type LabelledValue = { label: string; value: string };

/** Everything the System health page renders — computed entirely on the server. */
export type SystemHealthView = {
  ok: boolean;
  statusLabel: string;
  statusTone: HealthTone;
  headline: string;
  /** Formatted in the server's timezone, so no clock formatting runs at hydration. */
  checkedAtLabel: string;
  environmentLabel: string;
  cards: { label: string; value: string; tone: HealthTone }[];
  attention: {
    key: string;
    name: string;
    statusLabel: string;
    statusTone: HealthTone;
    detail: string;
  }[];
  groups: { key: string; label: string; services: ServiceRowView[] }[];
  process: LabelledValue[];
  /** Paths the browser is asked to time for the endpoint table. */
  endpointTargets: { name: string; path: string }[];
};

/** Server-rendered view of one browser sample. */
export type ClientPerformanceView = {
  session: LabelledValue[];
  endpoints: {
    name: string;
    path: string;
    ok: boolean;
    detail: string;
    latencyLabel: string;
    latencyTone: HealthTone;
  }[];
  chunks: {
    name: string;
    decodedLabel: string;
    transferLabel: string;
    durationLabel: string;
  }[];
};

/**
 * Server Action results. Actions return a failure rather than throwing:
 * production masks thrown Server Action errors behind a generic digest, and
 * "Administrator role required" is exactly the sentence the operator needs.
 */
export type SystemHealthActionResult =
  | { ok: true; view: SystemHealthView; report: SystemHealthReport }
  | { ok: false; error: string };

export type ClientPerformanceActionResult =
  | { ok: true; view: ClientPerformanceView; performance: ClientPerformance }
  | { ok: false; error: string };

export const SERVICE_STATUS_LABEL: Record<ServiceStatus, string> = {
  up: "Working",
  degraded: "Degraded",
  down: "Not working",
  "not-configured": "Not configured",
};
