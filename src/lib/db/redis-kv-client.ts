/**
 * Client helpers for Redis-backed KV (server /api/kv) — use instead of localStorage
 * for durable prefs when online.
 */

import { apiFetch } from "@/lib/api-auth";

export async function redisKvGet<T = unknown>(key: string): Promise<T | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await apiFetch(`/api/kv/${encodeURIComponent(key)}`, { cache: "no-store" });
    if (res.status === 503) return null;
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T | null };
    return (json.data ?? null) as T | null;
  } catch {
    return null;
  }
}

export async function redisKvSet(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const res = await apiFetch(`/api/kv/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, ttlSeconds }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function redisKvRemove(key: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const res = await apiFetch(`/api/kv/${encodeURIComponent(key)}`, {
      method: "DELETE",
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}
