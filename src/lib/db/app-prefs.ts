/**
 * App preferences & one-shot flags — in-memory cache + Postgres only.
 * Never import localStorage into the database — only scrub leftover keys.
 */

import {
  getMemorySetting,
  removeMemorySetting,
  setMemorySetting,
} from "@/lib/db/client-store";
import { persistSettingToDb } from "@/lib/db/sync";
import { apiFetch } from "@/lib/api-auth";

/** Delete a leftover localStorage key. Does not return or persist its value. */
export function discardLegacyLocalStorageValue(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** @deprecated Use discardLegacyLocalStorageValue — never feed LS into Postgres. */
export function liftLegacyLocalStorageValue(key: string): string | null {
  discardLegacyLocalStorageValue(key);
  return null;
}

export function getAppPref<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  // Drop any leftover LS key; do not import it into memory or Postgres.
  discardLegacyLocalStorageValue(key);
  return getMemorySetting<T>(key, fallback);
}

export function setAppPref(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  // Strict: login identity is tab/JWT only — never mirror into shared Postgres.
  if (key === "financeiag-session") {
    if (value == null) {
      removeMemorySetting(key);
      // Purge legacy shared blob only — never write a non-null identity.
      void persistSettingToDb(key, null);
    } else {
      // Tab memory only. Do not call persistSettingToDb with a profile payload.
      setMemorySetting(key, value);
    }
    discardLegacyLocalStorageValue(key);
    return;
  }
  setMemorySetting(key, value);
  void persistSettingToDb(key, value);
  discardLegacyLocalStorageValue(key);
}

export function removeAppPref(key: string) {
  if (typeof window === "undefined") return;
  removeMemorySetting(key);
  void persistSettingToDb(key, null);
  discardLegacyLocalStorageValue(key);
}

/** Boolean one-shot / feature flags stored as "1" in memory + Postgres. */
export function getAppFlag(key: string): boolean {
  if (typeof window === "undefined") return false;
  discardLegacyLocalStorageValue(key);
  const memory = getMemorySetting<string | null>(key, null);
  return memory === "1" || memory === "true";
}

export function setAppFlag(key: string, on = true) {
  if (typeof window === "undefined") return;
  if (on) {
    setAppPref(key, "1");
  } else {
    removeAppPref(key);
  }
}

/** Write a one-shot flag to Postgres immediately (no debounce) after a purge. */
export async function persistFlagImmediate(key: string, on = true): Promise<void> {
  if (typeof window === "undefined") return;
  setAppFlag(key, on);
  try {
    await apiFetch(`/api/settings/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: on ? "1" : null }),
      keepalive: true,
      cache: "no-store",
    });
  } catch {
    /* API unreachable — flag stays in memory until retry */
  }
}
