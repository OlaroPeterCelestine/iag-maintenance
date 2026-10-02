/**
 * Redis client — fast shared server-side store (Railway Redis).
 * Write-through cache for AppSettings + EntityRecord collections,
 * and KV store replacing browser localStorage for durable prefs.
 */

import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
  redisDisabled: boolean | undefined;
};

export function isRedisConfigured(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

function createRedisClient(): Redis | null {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 2_500,
    // Fail fast to Postgres when Railway Redis is slow/unreachable.
    commandTimeout: 1_500,
    retryStrategy(times) {
      if (times > 2) return null;
      return Math.min(times * 150, 500);
    },
  });
  client.on("error", (err) => {
    console.error("[redis]", err.message);
  });
  return client;
}

export function getRedis(): Redis | null {
  if (globalForRedis.redisDisabled) return null;
  if (!isRedisConfigured()) return null;
  if (!globalForRedis.redis) {
    globalForRedis.redis = createRedisClient() ?? undefined;
    if (!globalForRedis.redis) {
      globalForRedis.redisDisabled = true;
      return null;
    }
  }
  return globalForRedis.redis;
}

async function ensureConnected(client: Redis): Promise<boolean> {
  try {
    if (client.status === "wait" || client.status === "end") {
      await client.connect();
    }
    return true;
  } catch (error) {
    console.error("[redis] connect failed", error instanceof Error ? error.message : error);
    return false;
  }
}

const KEY_PREFIX = "financeiag:";

export function redisKey(key: string): string {
  return key.startsWith(KEY_PREFIX) ? key : `${KEY_PREFIX}${key}`;
}

export async function redisPing(): Promise<{
  ok: boolean;
  latencyMs?: number;
  message?: string;
}> {
  const client = getRedis();
  if (!client) return { ok: false, message: "REDIS_URL not set" };
  const started = Date.now();
  try {
    if (!(await ensureConnected(client))) {
      return { ok: false, message: "connect failed" };
    }
    const pong = await client.ping();
    return {
      ok: pong === "PONG",
      latencyMs: Date.now() - started,
      message: pong,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: error instanceof Error ? error.message : "ping failed",
    };
  }
}

export async function redisGetJson<T = unknown>(key: string): Promise<T | null | undefined> {
  const client = getRedis();
  if (!client) return undefined;
  try {
    if (!(await ensureConnected(client))) return undefined;
    const raw = await client.get(redisKey(key));
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function redisSetJson(
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;
  try {
    if (!(await ensureConnected(client))) return false;
    const payload = JSON.stringify(value);
    const rk = redisKey(key);
    if (ttlSeconds && ttlSeconds > 0) {
      await client.set(rk, payload, "EX", ttlSeconds);
    } else {
      await client.set(rk, payload);
    }
    return true;
  } catch {
    return false;
  }
}

export async function redisDel(key: string): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;
  try {
    if (!(await ensureConnected(client))) return false;
    await client.del(redisKey(key));
    return true;
  } catch {
    return false;
  }
}

export async function redisGetManyJson(
  keys: string[],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (!keys.length) return out;
  const client = getRedis();
  if (!client) return out;
  try {
    if (!(await ensureConnected(client))) return out;
    const redisKeys = keys.map(redisKey);
    const values = await client.mget(...redisKeys);
    for (let i = 0; i < keys.length; i += 1) {
      const raw = values[i];
      if (raw == null) continue;
      try {
        out[keys[i]!] = JSON.parse(raw) as unknown;
      } catch {
        out[keys[i]!] = raw;
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

/** Setting keys are namespaced so they don't collide with generic KV. */
export function settingRedisKey(key: string) {
  return `setting:${key}`;
}

export function kvRedisKey(key: string) {
  return `kv:${key}`;
}

/** Entity collections — write-through cache in front of Postgres EntityRecord. */
export function recordRedisKey(moduleSlug: string, entity: string) {
  return `records:${moduleSlug}:${entity}`;
}

/** Delete all keys matching a logical pattern (after KEY_PREFIX). Returns deleted count. */
export async function redisDelByPattern(logicalPattern: string): Promise<number> {
  const client = getRedis();
  if (!client) return 0;
  try {
    if (!(await ensureConnected(client))) return 0;
    const match = redisKey(logicalPattern);
    let cursor = "0";
    let deleted = 0;
    do {
      const [next, keys] = await client.scan(cursor, "MATCH", match, "COUNT", 200);
      cursor = next;
      if (keys.length) {
        deleted += await client.del(...keys);
      }
    } while (cursor !== "0");
    return deleted;
  } catch {
    return 0;
  }
}
