/**
 * Simple in-memory sliding-window rate limiter (mirrors Go loginRateLimit).
 * Good enough for single-instance / serverless warm instances.
 */

type Bucket = { windowStart: number; count: number };

const buckets = new Map<string, Bucket>();

function limitPerMinute(): number {
  const raw = Number(process.env.RATE_LIMIT_PER_MIN || "600");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 600;
}

/** Login attempts: ~1/3 of general limit, minimum 10 / minute (same as Go). */
export function loginRateLimitPerMinute(): number {
  return Math.max(10, Math.floor(limitPerMinute() / 3));
}

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSec: number;
};

export function checkRateLimit(
  key: string,
  limit = limitPerMinute(),
  windowMs = 60_000,
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { ok: true, limit, remaining: Math.max(0, limit - 1), retryAfterSec: 0 };
  }
  bucket.count += 1;
  const ok = bucket.count <= limit;
  const retryAfterSec = ok
    ? 0
    : Math.max(1, Math.ceil((windowMs - (now - bucket.windowStart)) / 1000));
  return {
    ok,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSec,
  };
}

/** Periodically drop old buckets (best-effort). */
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart > 5 * 60_000) buckets.delete(key);
    }
  }, 60_000).unref?.();
}
