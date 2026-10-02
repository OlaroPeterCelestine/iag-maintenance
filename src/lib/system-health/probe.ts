/**
 * Server-side dependency probes behind /api/system-health.
 *
 * Every probe is bounded and they all run in parallel, so one dead service
 * cannot make the page hang on the sum of every timeout. Nothing here throws:
 * a probe that blows up becomes a `down` row with the error text, because a
 * health endpoint that 500s tells an operator strictly less than one that
 * reports which dependency is broken.
 */

import { APP_VERSION } from "@/lib/app-version";
import { deployTopologyDetail } from "@/lib/deploy-topology";
import { isKafkaConfigured } from "@/lib/db/kafka";
import { isRedisConfigured, redisPing } from "@/lib/db/redis";
import { goApiBaseUrl, isGoApiConfigured } from "@/lib/go-api";
import type {
  ProcessPerformance,
  ServiceCheck,
  ServiceStatus,
  SystemHealthReport,
} from "@/lib/system-health/types";

const PROBE_TIMEOUT_MS = 5_000;

/**
 * Host only. REDIS_URL and SMTP creds live in these strings, and this payload
 * reaches a browser — never return the raw value.
 */
function safeHost(raw: string): string {
  const value = (raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value.includes("://") ? value : `http://${value}`);
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    // Not a URL (e.g. a bare Kafka broker list) — keep the first host, drop creds.
    const first = value.split(",")[0]?.trim() || "";
    return first.includes("@") ? first.slice(first.lastIndexOf("@") + 1) : first;
  }
}

function elapsedSince(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}

type GoHealthDeep = {
  ok?: boolean;
  database?: string;
  databaseMessage?: string;
  redis?: { configured?: boolean; ok?: boolean; latencyMs?: number; message?: string };
  kafka?: { configured?: boolean; ok?: boolean; message?: string };
};

/**
 * One request to the Go API's deep health gives us the API, Postgres, and the
 * API-side Redis/Kafka verdicts. Probing them separately from Next would be
 * both slower and wrong — Next has no Postgres connection of its own.
 */
async function probeGoStack(): Promise<ServiceCheck[]> {
  const target = safeHost(goApiBaseUrl());
  const configured = isGoApiConfigured();

  if (!configured && process.env.NODE_ENV === "production") {
    return [
      {
        key: "go-api",
        name: "Go API",
        group: "core",
        status: "not-configured",
        latencyMs: null,
        detail: "GO_API_URL is unset — every /api/* route is unrouted.",
        target: "",
        required: true,
        envVar: "GO_API_URL",
      },
    ];
  }

  const started = performance.now();
  let body: GoHealthDeep | null = null;
  let apiStatus: ServiceStatus = "down";
  let apiDetail = "";
  let latencyMs: number | null = null;

  try {
    const res = await fetch(`${goApiBaseUrl()}/api/health/deep`, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    latencyMs = elapsedSince(started);
    body = (await res.json().catch(() => null)) as GoHealthDeep | null;
    if (res.ok) {
      apiStatus = "up";
      apiDetail = `HTTP ${res.status} in ${latencyMs}ms`;
    } else {
      // 503 still carries a diagnostic body — the API answered, a dependency failed.
      apiStatus = body ? "degraded" : "down";
      apiDetail = `HTTP ${res.status}${body?.databaseMessage ? ` — ${body.databaseMessage}` : ""}`;
    }
  } catch (err) {
    latencyMs = elapsedSince(started);
    apiDetail = err instanceof Error ? err.message : "unreachable";
    if (!configured) {
      apiDetail = `${apiDetail} — GO_API_URL is unset, tried ${goApiBaseUrl()}`;
    }
  }

  const checks: ServiceCheck[] = [
    {
      key: "go-api",
      name: "Go API",
      group: "core",
      status: apiStatus,
      latencyMs,
      detail: apiDetail,
      target,
      required: true,
      envVar: "GO_API_URL",
    },
  ];

  // Postgres is reachable only through the Go API, so an unreachable API means
  // "unknown", not "down" — reporting a healthy database as broken would send
  // an operator to the wrong service.
  if (body) {
    const dbOk = body.database === "connected";
    checks.push({
      key: "postgres",
      name: "Postgres",
      group: "data",
      status: dbOk ? "up" : "down",
      latencyMs: null,
      detail: dbOk ? "Connected (via Go API)" : body.databaseMessage || "Ping failed",
      target: "",
      required: true,
      envVar: "DATABASE_URL",
    });

    const apiRedis = body.redis;
    if (apiRedis) {
      checks.push({
        key: "redis-api",
        name: "Redis (Go API)",
        group: "data",
        status: !apiRedis.configured ? "not-configured" : apiRedis.ok ? "up" : "down",
        latencyMs: typeof apiRedis.latencyMs === "number" ? apiRedis.latencyMs : null,
        detail: apiRedis.configured
          ? apiRedis.message || (apiRedis.ok ? "PONG" : "Ping failed")
          : "Optional cache — the API falls back to Postgres.",
        target: "",
        required: false,
        envVar: "REDIS_URL",
      });
    }

    const apiKafka = body.kafka;
    if (apiKafka) {
      checks.push({
        key: "kafka-api",
        name: "Kafka / Redpanda (Go API)",
        group: "messaging",
        status: !apiKafka.configured ? "not-configured" : apiKafka.ok ? "up" : "down",
        latencyMs: null,
        detail: apiKafka.configured
          ? apiKafka.message || (apiKafka.ok ? "Brokers reachable" : "Broker check failed")
          : "Optional — realtime falls back to Redis pub/sub.",
        target: "",
        required: false,
        envVar: "KAFKA_BROKERS",
      });
    }
  } else {
    checks.push({
      key: "postgres",
      name: "Postgres",
      group: "data",
      status: "down",
      latencyMs: null,
      detail: "Unknown — the Go API did not answer, so the database was not reached.",
      target: "",
      required: true,
      envVar: "DATABASE_URL",
    });
  }

  return checks;
}

async function probeWebRedis(): Promise<ServiceCheck> {
  if (!isRedisConfigured()) {
    return {
      key: "redis-web",
      name: "Redis (web process)",
      group: "data",
      status: "not-configured",
      latencyMs: null,
      detail: "Optional — realtime SSE/WS fan-out runs in-process without it.",
      target: "",
      required: false,
      envVar: "REDIS_URL",
    };
  }
  const ping = await redisPing();
  return {
    key: "redis-web",
    name: "Redis (web process)",
    group: "data",
    status: ping.ok ? "up" : "down",
    latencyMs: typeof ping.latencyMs === "number" ? ping.latencyMs : null,
    detail: ping.message || (ping.ok ? "PONG" : "Ping failed"),
    target: safeHost(process.env.REDIS_URL || ""),
    required: false,
    envVar: "REDIS_URL",
  };
}

async function probeMlService(): Promise<ServiceCheck> {
  const base = (process.env.ML_API_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
  const configured = Boolean(process.env.ML_API_URL?.trim());
  const started = performance.now();
  try {
    const res = await fetch(`${base}/health`, {
      cache: "no-store",
      headers: process.env.ML_API_KEY ? { "x-api-key": process.env.ML_API_KEY } : undefined,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = elapsedSince(started);
    return {
      key: "ml-service",
      name: "ML service",
      group: "ai",
      status: res.ok ? "up" : "degraded",
      latencyMs,
      detail: res.ok ? `HTTP ${res.status} in ${latencyMs}ms` : `HTTP ${res.status}`,
      target: safeHost(base),
      required: false,
      envVar: "ML_API_URL",
    };
  } catch (err) {
    return {
      key: "ml-service",
      name: "ML service",
      group: "ai",
      status: configured ? "down" : "not-configured",
      latencyMs: elapsedSince(started),
      detail: configured
        ? err instanceof Error
          ? err.message
          : "unreachable"
        : "ML_API_URL is unset — AI panels fall back to their non-ML paths.",
      target: safeHost(base),
      required: false,
      envVar: "ML_API_URL",
    };
  }
}

/**
 * SMTP is checked by configuration only. A real SMTP handshake on every page
 * refresh would burn provider connection quota and, on Gmail, trip abuse
 * throttling — the Send test in Settings is the deliberate live check.
 */
function checkSmtp(): ServiceCheck {
  const host = (process.env.SMTP_HOST || "").trim();
  const fromEmail = (process.env.SMTP_FROM_EMAIL || "").trim();
  const username = (process.env.SMTP_USERNAME || "").trim();
  const password = process.env.SMTP_PASSWORD || "";
  const missing = [
    !host && "SMTP_HOST",
    !fromEmail && "SMTP_FROM_EMAIL",
    !username && "SMTP_USERNAME",
    !password && "SMTP_PASSWORD",
  ].filter(Boolean) as string[];

  if (!host && !fromEmail) {
    return {
      key: "smtp",
      name: "Email (SMTP)",
      group: "messaging",
      status: "not-configured",
      latencyMs: null,
      detail: "No server SMTP — outbound mail falls back to Settings → Email.",
      target: "",
      required: false,
      envVar: "SMTP_HOST",
    };
  }

  return {
    key: "smtp",
    name: "Email (SMTP)",
    group: "messaging",
    status: missing.length ? "degraded" : "up",
    latencyMs: null,
    detail: missing.length
      ? `Configured but incomplete — missing ${missing.join(", ")}.`
      : `Configured — sending as ${fromEmail}`,
    target: safeHost(host),
    required: false,
    envVar: "SMTP_HOST",
  };
}

function checkSms(): ServiceCheck {
  const username = (process.env.EGO_SMS_USERNAME || "").trim();
  const password = (process.env.EGO_SMS_PASSWORD || "").trim();
  const sender = (process.env.EGO_SMS_SENDER || "").trim();
  const enabledRaw = (process.env.EGO_SMS_ENABLED || "").trim().toLowerCase();
  const enabled = !enabledRaw || !["false", "0", "no", "off"].includes(enabledRaw);
  const apiUrl = (process.env.EGO_SMS_API_URL || "").trim();
  const endpoint = apiUrl || "https://www.egosms.co/api/v1/json/";

  if (!enabled) {
    return {
      key: "sms",
      name: "SMS (EgoSMS)",
      group: "messaging",
      status: "not-configured",
      latencyMs: null,
      detail: "Disabled via EGO_SMS_ENABLED=false — /api/sms/send returns 503.",
      target: safeHost(endpoint),
      required: false,
      envVar: "EGO_SMS_ENABLED",
    };
  }

  if (!username && !password) {
    return {
      key: "sms",
      name: "SMS (EgoSMS)",
      group: "messaging",
      status: "not-configured",
      latencyMs: null,
      detail: "No server credentials — SMS falls back to Settings → SMS.",
      target: "",
      required: false,
      envVar: "EGO_SMS_USERNAME",
    };
  }
  const missing = [
    !username && "EGO_SMS_USERNAME",
    !password && "EGO_SMS_PASSWORD",
    !sender && "EGO_SMS_SENDER",
  ].filter(Boolean) as string[];
  return {
    key: "sms",
    name: "SMS (EgoSMS)",
    group: "messaging",
    status: missing.length ? "degraded" : "up",
    latencyMs: null,
    detail: missing.length
      ? `Configured but incomplete — missing ${missing.join(", ")}.`
      : `Configured — sender ${sender} via ${/\/plain\/?$/.test(endpoint) ? "plain" : "json"} API`,
    target: safeHost(endpoint),
    required: false,
    envVar: "EGO_SMS_USERNAME",
  };
}

function checkRealtime(): ServiceCheck {
  const redis = isRedisConfigured();
  const kafka = isKafkaConfigured();
  return {
    key: "realtime",
    name: "Realtime (SSE / WebSocket)",
    group: "messaging",
    status: "up",
    latencyMs: null,
    detail: redis
      ? `Multi-instance fan-out via Redis${kafka ? " + Kafka" : ""}. ${deployTopologyDetail()}`
      : `In-process only — events do not cross web instances without REDIS_URL. ${deployTopologyDetail()}`,
    target: "",
    required: false,
  };
}

function checkAuthConfig(): ServiceCheck {
  const secret = (process.env.JWT_SECRET || "").trim();
  if (secret) {
    return {
      key: "auth",
      name: "Session auth (JWT)",
      group: "core",
      status: "up",
      latencyMs: null,
      detail: "JWT_SECRET is set — API routes verify sessions.",
      target: "",
      required: true,
      envVar: "JWT_SECRET",
    };
  }
  const production = process.env.NODE_ENV === "production";
  return {
    key: "auth",
    name: "Session auth (JWT)",
    group: "core",
    status: production ? "down" : "not-configured",
    latencyMs: null,
    detail: production
      ? "JWT_SECRET is unset — Next-served API routes reject every request."
      : "Dev without JWT_SECRET — local requests are treated as Administrator.",
    target: "",
    required: production,
    envVar: "JWT_SECRET",
  };
}

/**
 * Timer drift over a short window. Node has no synchronous "how busy am I"
 * reading, and this is the one number that separates "the API is slow" from
 * "this web process is pegged and everything looks slow".
 */
async function measureEventLoopLag(samples = 3, intervalMs = 20): Promise<number> {
  let worst = 0;
  for (let i = 0; i < samples; i += 1) {
    const started = performance.now();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    worst = Math.max(worst, performance.now() - started - intervalMs);
  }
  return Math.max(0, Math.round(worst * 100) / 100);
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function releaseTag(): string {
  return (
    APP_VERSION ||
    process.env.RAILWAY_GIT_COMMIT_SHA?.trim().slice(0, 8) ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 8) ||
    "dev"
  );
}

export async function buildSystemHealthReport(): Promise<SystemHealthReport> {
  const started = performance.now();

  const [goChecks, webRedis, ml, lagMs] = await Promise.all([
    probeGoStack(),
    probeWebRedis(),
    probeMlService(),
    measureEventLoopLag(),
  ]);

  const services: ServiceCheck[] = [
    {
      key: "web",
      name: "Web app (Next.js)",
      group: "core",
      status: "up",
      latencyMs: null,
      detail: "Serving this request.",
      target: "",
      required: true,
    },
    checkAuthConfig(),
    ...goChecks,
    webRedis,
    checkRealtime(),
    ml,
    checkSmtp(),
    checkSms(),
  ];

  const memory = process.memoryUsage();
  const perf: ProcessPerformance = {
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    uptimeSeconds: Math.round(process.uptime()),
    rssMb: mb(memory.rss),
    heapUsedMb: mb(memory.heapUsed),
    heapTotalMb: mb(memory.heapTotal),
    eventLoopLagMs: lagMs,
    environment: process.env.NODE_ENV || "development",
    release: releaseTag(),
  };

  const summary = {
    total: services.length,
    up: services.filter((s) => s.status === "up").length,
    degraded: services.filter((s) => s.status === "degraded").length,
    down: services.filter((s) => s.status === "down").length,
    notConfigured: services.filter((s) => s.status === "not-configured").length,
  };

  return {
    // Only a *required* service being down makes the whole system unhealthy —
    // an unset ML service must not flip a load balancer to unhealthy.
    ok: !services.some((s) => s.required && s.status === "down"),
    generatedAt: new Date().toISOString(),
    probeMs: elapsedSince(started),
    services,
    process: perf,
    summary,
  };
}
