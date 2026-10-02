/**
 * In-memory + pref-backed feed of live sync events for the bell menu / toasts.
 * Also caches server ActivityLog rows for Documents → History merge.
 */

import { getAppPref } from "@/lib/db/app-prefs";
import { getMemorySetting, setMemorySetting } from "@/lib/db/client-store";
import type { AppNotification } from "@/lib/notifications";
import { fetchAdminActivity } from "@/lib/activity-api";
import type { HistoryEntry } from "@/lib/history";

const FEED_KEY = "financeiag-realtime-feed";
const SERVER_ACTIVITY_KEY = "financeiag-server-activity-cache";
export const REALTIME_FEED_EVENT = "financeiag-realtime-feed-changed";
export const SERVER_ACTIVITY_EVENT = "financeiag-server-activity-changed";

/** Avoid hammering /api/activity on every realtime tick. */
const ACTIVITY_REFRESH_MIN_MS = 60_000;
let lastActivityRefreshAt = 0;
let activityRefreshInFlight: Promise<void> | null = null;

export type RealtimeFeedItem = {
  id: string;
  title: string;
  description: string;
  href?: string;
  date: string;
  module?: string;
  entity?: string;
};

function humanize(key: string): string {
  return key
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function realtimeNotificationsEnabled(): boolean {
  if (typeof window === "undefined") {
    return process.env.REALTIME_NOTIFICATIONS !== "false";
  }
  const flag = process.env.NEXT_PUBLIC_REALTIME_NOTIFICATIONS;
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function loadRealtimeFeed(): RealtimeFeedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = getMemorySetting<RealtimeFeedItem[] | null>(FEED_KEY, null);
    if (Array.isArray(parsed)) return parsed;
    // One-time read of any legacy pref without re-persisting.
    const legacy = getAppPref<RealtimeFeedItem[] | null>(FEED_KEY, null);
    return Array.isArray(legacy) ? legacy : [];
  } catch {
    return [];
  }
}

export function pushRealtimeFeedItem(input: {
  module?: string;
  entity?: string;
  type?: string;
  action?: string;
  label?: string;
  actor?: string;
  details?: string;
  title?: string;
  description?: string;
}): RealtimeFeedItem | null {
  if (typeof window === "undefined") return null;
  if (!realtimeNotificationsEnabled()) return null;

  const moduleLabel = input.module ? humanize(input.module) : "Workspace";
  const entityLabel = input.entity ? humanize(input.entity) : "records";
  const now = new Date().toISOString();
  const title =
    input.title ||
    (input.action ? String(input.action) : null) ||
    "Live update";
  const description =
    input.description ||
    input.details ||
    (input.label
      ? `${moduleLabel} · ${input.label}`
      : `${moduleLabel} · ${entityLabel} changed`);
  const item: RealtimeFeedItem = {
    id: `rt-${now}-${input.module || "x"}-${input.entity || "y"}`,
    title,
    description: input.actor ? `${description} · ${input.actor}` : description,
    href: input.module ? `/${input.module}` : undefined,
    date: now,
    module: input.module,
    entity: input.entity,
  };

  const next = [item, ...loadRealtimeFeed().filter((x) => x.id !== item.id)].slice(0, 40);
  // Memory-only — persisting the bell feed caused settings.updated → refresh loops.
  setMemorySetting(FEED_KEY, next);
  window.dispatchEvent(new CustomEvent(REALTIME_FEED_EVENT));
  return item;
}

export function realtimeFeedAsNotifications(): AppNotification[] {
  return loadRealtimeFeed().map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    href: item.href,
    date: item.date,
    kind: "activity" as const,
    tone: "bg-violet-500",
  }));
}

export function loadServerActivityCache(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = getMemorySetting<HistoryEntry[] | null>(SERVER_ACTIVITY_KEY, null);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setServerActivityCache(entries: HistoryEntry[]) {
  // Memory-only cache — never PUT to /api/settings (triggers rate-limit storms).
  setMemorySetting(SERVER_ACTIVITY_KEY, entries.slice(0, 500));
  // Do not broadcast financeiag-records-changed — that remounts/shimmers every open table.
  window.dispatchEvent(new CustomEvent(SERVER_ACTIVITY_EVENT));
}

/** Pull server ActivityLog into local cache for History + bell. */
export async function refreshServerActivityFeed(): Promise<void> {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastActivityRefreshAt < ACTIVITY_REFRESH_MIN_MS) return;
  if (activityRefreshInFlight) return activityRefreshInFlight;

  lastActivityRefreshAt = now;
  activityRefreshInFlight = (async () => {
    try {
      // Gin scopes non-admins to their own rows; admins get the workspace trail.
      const rows = await fetchAdminActivity({ limit: 300 });
      const entries: HistoryEntry[] = rows.map((row) => {
        const at = row.at || new Date().toISOString();
        return {
          id: row.id,
          createdAt: at,
          updatedAt: at,
          timestamp: at.slice(0, 16).replace("T", " "),
          user: row.userName || row.username || row.email || "System",
          userId: row.userId || "",
          username: row.username || "",
          email: row.email || "",
          action: row.action,
          module: row.module,
          entity: row.entity,
          recordLabel: row.recordLabel,
          details: row.details,
          status: "Logged",
        };
      });
      setServerActivityCache(entries);
    } catch {
      /* offline / unauthorized / rate-limited */
      lastActivityRefreshAt = Date.now() + ACTIVITY_REFRESH_MIN_MS;
    } finally {
      activityRefreshInFlight = null;
    }
  })();
  return activityRefreshInFlight;
}
