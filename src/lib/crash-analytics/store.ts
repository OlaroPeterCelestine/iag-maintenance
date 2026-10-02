import { randomUUID } from "node:crypto";
import { getRedis, redisKey } from "@/lib/db/redis";
import { crashFingerprint, crashTitle } from "./fingerprint";
import type {
  CrashActorRow,
  CrashAnalyticsSummary,
  CrashEvent,
  CrashEventInput,
  CrashIssue,
  CrashQuery,
} from "./types";

const INDEX_KEY = "crash:index";
const EVENT_PREFIX = "crash:event:";
const RETENTION_SECONDS = 60 * 60 * 24 * 14; // 14 days
const MAX_EVENTS_PER_QUERY = 500;

type MemoryStore = {
  events: Map<string, CrashEvent>;
  scores: { id: string; at: number }[];
};

const globalStore = globalThis as unknown as {
  __iagCrashStore?: MemoryStore;
};

function memory(): MemoryStore {
  if (!globalStore.__iagCrashStore) {
    globalStore.__iagCrashStore = { events: new Map(), scores: [] };
  }
  return globalStore.__iagCrashStore;
}

async function ensureRedis() {
  const client = getRedis();
  if (!client) return null;
  try {
    if (client.status === "wait" || client.status === "end") {
      await client.connect();
    }
    return client;
  } catch {
    return null;
  }
}

export async function ingestCrashEvent(
  input: CrashEventInput,
): Promise<{ event: CrashEvent; storage: "redis" | "memory" }> {
  const now = new Date();
  const occurred = input.occurredAt ? new Date(input.occurredAt) : now;
  const occurredAt = Number.isNaN(occurred.getTime()) ? now.toISOString() : occurred.toISOString();
  const fingerprint = crashFingerprint(input);
  const event: CrashEvent = {
    ...input,
    id: randomUUID(),
    fingerprint,
    title: crashTitle(input),
    severity: input.severity || "error",
    source: input.source || "manual",
    occurredAt,
    receivedAt: now.toISOString(),
  };

  const client = await ensureRedis();
  if (client) {
    try {
      const score = Date.parse(event.occurredAt) || Date.now();
      const rk = redisKey(`${EVENT_PREFIX}${event.id}`);
      const index = redisKey(INDEX_KEY);
      const pipe = client.pipeline();
      pipe.set(rk, JSON.stringify(event), "EX", RETENTION_SECONDS);
      pipe.zadd(index, score, event.id);
      pipe.zremrangebyscore(index, 0, Date.now() - RETENTION_SECONDS * 1000);
      await pipe.exec();
      return { event, storage: "redis" };
    } catch (error) {
      console.error("[crash] redis ingest failed", error);
      if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
        throw error instanceof Error
          ? error
          : new Error("Crash analytics Redis ingest failed");
      }
    }
  }

  if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
    throw new Error("Crash analytics Redis unavailable in production");
  }

  const store = memory();
  store.events.set(event.id, event);
  store.scores.push({ id: event.id, at: Date.parse(event.occurredAt) || Date.now() });
  store.scores.sort((a, b) => a.at - b.at);
  const cutoff = Date.now() - RETENTION_SECONDS * 1000;
  while (store.scores.length && store.scores[0]!.at < cutoff) {
    const old = store.scores.shift()!;
    store.events.delete(old.id);
  }
  if (store.scores.length > 5000) {
    const drop = store.scores.splice(0, store.scores.length - 5000);
    for (const row of drop) store.events.delete(row.id);
  }
  return { event, storage: "memory" };
}

export async function queryCrashAnalytics(
  options?: CrashQuery,
): Promise<CrashAnalyticsSummary> {
  const hours = Math.min(Math.max(options?.hours ?? 48, 1), 24 * 14);
  const limit = Math.min(Math.max(options?.limit ?? 200, 1), MAX_EVENTS_PER_QUERY);
  const to = new Date();
  const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
  const fromMs = from.getTime();
  const toMs = to.getTime();

  let events: CrashEvent[] = [];
  let storage: "redis" | "memory" = "memory";

  const client = await ensureRedis();
  if (client) {
    try {
      const index = redisKey(INDEX_KEY);
      const ids = await client.zrangebyscore(index, fromMs, toMs);
      const recent = ids.slice(-MAX_EVENTS_PER_QUERY);
      if (recent.length) {
        const keys = recent.map((id) => redisKey(`${EVENT_PREFIX}${id}`));
        const raws = await client.mget(...keys);
        for (const raw of raws) {
          if (!raw) continue;
          try {
            events.push(JSON.parse(raw) as CrashEvent);
          } catch {
            /* skip */
          }
        }
      }
      storage = "redis";
    } catch (error) {
      console.error("[crash] redis query failed", error);
    }
  }

  if (!events.length || storage === "memory") {
    const store = memory();
    events = store.scores
      .filter((row) => row.at >= fromMs && row.at <= toMs)
      .slice(-MAX_EVENTS_PER_QUERY)
      .map((row) => store.events.get(row.id))
      .filter((row): row is CrashEvent => Boolean(row));
    if (!client) storage = "memory";
  }

  events.sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  );

  const matched = events.filter((event) => matchesQuery(event, options)).slice(0, limit);

  return summarize(matched, hours, from, to, storage);
}

export function eventUserKey(event: CrashEvent): string {
  return (event.userId || event.username || "").trim() || "(anonymous)";
}

export function eventUserLabel(event: CrashEvent): string {
  return (event.username || event.userId || "").trim() || "(anonymous)";
}

export function eventIpKey(event: CrashEvent): string {
  return (event.ip || "").trim() || "(unknown)";
}

function matchesQuery(event: CrashEvent, query?: CrashQuery): boolean {
  if (!query) return true;

  const has = (value: string | undefined, needle?: string) =>
    !needle || (value || "").toLowerCase().includes(needle.toLowerCase());

  if (query.severity && event.severity !== query.severity) return false;
  if (query.source && event.source !== query.source) return false;
  if (query.ip && !has(event.ip, query.ip)) return false;
  if (query.route) {
    const route = event.route || routeFromUrl(event.url);
    if (!has(route, query.route)) return false;
  }
  if (query.user) {
    const who = [event.username, event.userId, event.role].filter(Boolean).join(" ");
    if (!has(who, query.user)) return false;
  }
  if (query.q) {
    const haystack = [
      event.title,
      event.message,
      event.name,
      event.route,
      event.url,
      event.username,
      event.userId,
      event.ip,
      event.fingerprint,
    ]
      .filter(Boolean)
      .join(" ");
    if (!has(haystack, query.q)) return false;
  }
  return true;
}

/** Roll events up by a key (user or IP) into the shared actor row shape. */
function groupActors(
  events: CrashEvent[],
  keyOf: (event: CrashEvent) => string,
  labelOf: (event: CrashEvent) => string,
  secondaryOf: (event: CrashEvent) => string,
  relatedOf: (event: CrashEvent) => string,
): CrashActorRow[] {
  const rows = new Map<string, CrashActorRow & { fingerprints: Set<string> }>();

  for (const event of events) {
    const key = keyOf(event);
    const route = event.route || routeFromUrl(event.url) || "";
    const related = relatedOf(event);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        label: labelOf(event),
        secondary: secondaryOf(event),
        count: 0,
        fatalCount: 0,
        errorCount: 0,
        warningCount: 0,
        issues: 0,
        firstSeen: event.occurredAt,
        lastSeen: event.occurredAt,
        lastTitle: event.title,
        routes: [],
        related: [],
        fingerprints: new Set<string>(),
      };
      rows.set(key, row);
    }

    row.count += 1;
    if (event.severity === "fatal") row.fatalCount += 1;
    else if (event.severity === "warning") row.warningCount += 1;
    else row.errorCount += 1;
    row.fingerprints.add(event.fingerprint);
    if (Date.parse(event.occurredAt) < Date.parse(row.firstSeen)) {
      row.firstSeen = event.occurredAt;
    }
    if (Date.parse(event.occurredAt) >= Date.parse(row.lastSeen)) {
      row.lastSeen = event.occurredAt;
      row.lastTitle = event.title;
      const secondary = secondaryOf(event);
      if (secondary) row.secondary = secondary;
    }
    if (route && !row.routes.includes(route) && row.routes.length < 10) {
      row.routes.push(route);
    }
    if (related && !row.related.includes(related) && row.related.length < 10) {
      row.related.push(related);
    }
  }

  return [...rows.values()]
    .map(({ fingerprints, ...row }) => ({ ...row, issues: fingerprints.size }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return Date.parse(b.lastSeen) - Date.parse(a.lastSeen);
    });
}

function summarize(
  events: CrashEvent[],
  hours: number,
  from: Date,
  to: Date,
  storage: "redis" | "memory",
): CrashAnalyticsSummary {
  const issues = new Map<string, CrashIssue>();
  const bySource = new Map<string, number>();
  const byRoute = new Map<string, number>();
  const timeline = new Map<string, number>();
  const users = new Set<string>();
  const ips = new Set<string>();

  for (const event of events) {
    bySource.set(event.source, (bySource.get(event.source) || 0) + 1);
    const route = event.route || routeFromUrl(event.url) || "(unknown)";
    byRoute.set(route, (byRoute.get(route) || 0) + 1);
    const hour = event.occurredAt.slice(0, 13) + ":00:00.000Z";
    timeline.set(hour, (timeline.get(hour) || 0) + 1);
    const who = event.username || event.userId;
    if (who) users.add(who);
    const ip = (event.ip || "").trim();
    if (ip) ips.add(ip);

    const existing = issues.get(event.fingerprint);
    if (!existing) {
      issues.set(event.fingerprint, {
        fingerprint: event.fingerprint,
        title: event.title,
        severity: event.severity,
        source: event.source,
        count: 1,
        firstSeen: event.occurredAt,
        lastSeen: event.occurredAt,
        sample: event,
        routes: route !== "(unknown)" ? [route] : [],
        users: who ? [who] : [],
        ips: ip ? [ip] : [],
      });
    } else {
      existing.count += 1;
      if (Date.parse(event.occurredAt) < Date.parse(existing.firstSeen)) {
        existing.firstSeen = event.occurredAt;
      }
      if (Date.parse(event.occurredAt) > Date.parse(existing.lastSeen)) {
        existing.lastSeen = event.occurredAt;
        existing.sample = event;
      }
      if (route !== "(unknown)" && !existing.routes.includes(route)) {
        existing.routes.push(route);
      }
      if (who && !existing.users.includes(who)) existing.users.push(who);
      if (ip && !existing.ips.includes(ip)) existing.ips.push(ip);
      if (event.severity === "fatal") existing.severity = "fatal";
    }
  }

  const topIssues = [...issues.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return Date.parse(b.lastSeen) - Date.parse(a.lastSeen);
  });

  return {
    ok: true,
    windowHours: hours,
    from: from.toISOString(),
    to: to.toISOString(),
    totalEvents: events.length,
    uniqueIssues: topIssues.length,
    fatalCount: events.filter((e) => e.severity === "fatal").length,
    errorCount: events.filter((e) => e.severity === "error").length,
    warningCount: events.filter((e) => e.severity === "warning").length,
    affectedUsers: users.size,
    affectedIps: ips.size,
    topIssues: topIssues.slice(0, 200),
    byUser: groupActors(
      events,
      eventUserKey,
      eventUserLabel,
      (event) => [event.role, event.userId].filter(Boolean).join(" · "),
      (event) => (event.ip || "").trim(),
    ),
    byIp: groupActors(
      events,
      eventIpKey,
      eventIpKey,
      (event) => (event.userAgent || "").trim(),
      eventUserLabel,
    ),
    timeline: [...timeline.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hour, count]) => ({ hour, count })),
    bySource: [...bySource.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count })),
    byRoute: [...byRoute.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([route, count]) => ({ route, count })),
    events,
    storage,
  };
}

function routeFromUrl(url?: string): string {
  if (!url) return "";
  try {
    const u = new URL(url, "http://local");
    return u.pathname + (u.search || "");
  } catch {
    return url.slice(0, 300);
  }
}
