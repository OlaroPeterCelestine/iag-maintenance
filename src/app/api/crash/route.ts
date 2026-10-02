import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-guard";
import { normalizeCrashInput } from "@/lib/crash-analytics/fingerprint";
import { historicalCrashSeed48h } from "@/lib/crash-analytics/seed-48h";
import { ingestCrashEvent, queryCrashAnalytics } from "@/lib/crash-analytics/store";
import type { CrashEventInput } from "@/lib/crash-analytics/types";
import { getRequestIp } from "@/lib/request-ip";
import { resolvePrincipal } from "@/lib/server-jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-IP ingest throttle — the route is intentionally public, so this is the write gate. */
const CRASH_WINDOW_MS = 60_000;
const CRASH_MAX_PER_WINDOW = 30;
const crashBuckets = new Map<string, { count: number; resetAt: number }>();

function crashIngestAllowed(ip: string): boolean {
  const key = ip || "unknown";
  const now = Date.now();
  const bucket = crashBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    crashBuckets.set(key, { count: 1, resetAt: now + CRASH_WINDOW_MS });
    return true;
  }
  if (bucket.count >= CRASH_MAX_PER_WINDOW) return false;
  bucket.count += 1;
  return true;
}

/** Public ingest — crashes often happen when the session is already broken. */
export async function POST(request: Request) {
  const ip = getRequestIp(request);
  if (!crashIngestAllowed(ip)) {
    return NextResponse.json(
      { ok: false, error: "Too many crash reports from this address. Try again shortly." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const items: CrashEventInput[] = Array.isArray(body)
    ? (body as CrashEventInput[])
    : body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events)
      ? ((body as { events: CrashEventInput[] }).events)
      : [body as CrashEventInput];

  if (!items.length || items.length > 20) {
    return NextResponse.json(
      { ok: false, error: "Send 1–20 crash events per request" },
      { status: 400 },
    );
  }

  const accepted: string[] = [];
  let storage: "redis" | "memory" = "memory";
  // Optional — never fail ingest if the cookie/JWT is already dead.
  const principal = await resolvePrincipal(request).catch(() => null);
  const trustedUser =
    principal && principal.mode === "jwt"
      ? {
          userId: principal.uid || undefined,
          username: principal.username || principal.email || undefined,
          role: principal.role || undefined,
        }
      : null;

  for (const item of items) {
    const normalized = normalizeCrashInput(item);
    if (!normalized) continue;
    if (!normalized.userAgent) {
      normalized.userAgent = request.headers.get("user-agent") || undefined;
    }
    // Never trust a client-supplied address.
    normalized.ip = ip || undefined;
    // Prefer JWT claims over sessionStorage so identity cannot be forged.
    if (trustedUser) {
      normalized.userId = trustedUser.userId;
      normalized.username = trustedUser.username;
      normalized.role = trustedUser.role;
    }
    const result = await ingestCrashEvent(normalized);
    accepted.push(result.event.id);
    storage = result.storage;
  }

  if (!accepted.length) {
    return NextResponse.json({ ok: false, error: "No valid crash events" }, { status: 400 });
  }

  return NextResponse.json(
    { ok: true, accepted: accepted.length, ids: accepted, storage },
    { status: 202 },
  );
}

/**
 * Admin analytics query.
 * ?hours=48 (default) &limit=200 &seed=1 to bootstrap historical 48h incidents.
 * Filters: &q= &user= &ip= &severity= &source= &route=
 */
export async function GET(request: Request) {
  const auth = await requireApiAdmin(request);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const hours = Number(url.searchParams.get("hours") || "48");
  const limit = Number(url.searchParams.get("limit") || "200");
  const seed = url.searchParams.get("seed") === "1";
  const param = (key: string) => url.searchParams.get(key)?.trim() || undefined;

  if (seed) {
    for (const item of historicalCrashSeed48h()) {
      const normalized = normalizeCrashInput(item);
      if (!normalized) continue;
      await ingestCrashEvent(normalized);
    }
  }

  const summary = await queryCrashAnalytics({
    hours: Number.isFinite(hours) ? hours : 48,
    limit: Number.isFinite(limit) ? limit : 200,
    q: param("q"),
    user: param("user"),
    ip: param("ip"),
    severity: param("severity"),
    source: param("source"),
    route: param("route"),
  });

  return NextResponse.json(summary);
}
