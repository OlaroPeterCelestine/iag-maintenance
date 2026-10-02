"use client";

import {
  silentRefreshEntity,
  silentRefreshLedger,
  silentRefreshSetting,
  startBackgroundSyncLoop,
} from "@/lib/db/background-sync";
import { isEntityPersistActive, knownEntityRevision } from "@/lib/db/sync";
import {
  pushRealtimeFeedItem,
  REALTIME_FEED_EVENT,
  realtimeNotificationsEnabled,
  refreshServerActivityFeed,
} from "@/lib/realtime-notifications";
import { appToastInfo } from "@/lib/app-toast";
import {
  formatApprovalPopupCopy,
  isRequestPopupEntity,
  popupRequestNotification,
} from "@/lib/request-popup-notifications";
import { useEffect, useRef } from "react";

type RealtimeMessage = {
  type?: string;
  module?: string;
  entity?: string;
  key?: string;
  action?: string;
  label?: string;
  actor?: string;
  details?: string;
  transport?: string;
  revision?: string;
};

/**
 * Bell feed always updates. Toast:
 * - request / approval entities → always (visible popup)
 * - everything else → only when the tab is in the background (Gmail-like)
 */
function notifyLive(
  data: RealtimeMessage,
  fallbackTitle: string,
  fallbackDescription: string,
  _dedupeId: string,
  options?: { forceToast?: boolean; osAlways?: boolean },
) {
  if (!realtimeNotificationsEnabled()) return;
  const item = pushRealtimeFeedItem({
    module: data.module || (data.type === "settings.updated" ? "settings" : undefined),
    entity: data.entity || data.key,
    type: data.type,
    action: data.action,
    label: data.label,
    actor: data.actor,
    details: data.details,
    title: data.action ? `${data.action}` : fallbackTitle,
    description: data.details || fallbackDescription,
  });
  if (!item) return;
  window.dispatchEvent(new CustomEvent(REALTIME_FEED_EVENT));

  const requestEntity = isRequestPopupEntity(data.entity || data.key);
  const force = options?.forceToast || requestEntity;
  const hidden =
    typeof document !== "undefined" && document.visibilityState === "hidden";

  if (force) {
    popupRequestNotification({
      title: item.title,
      description: item.description || undefined,
      tone: /reject/i.test(item.title) ? "warning" : "info",
      tag: `rt-${data.type || "live"}-${data.entity || data.key || "x"}`,
      url: data.module && data.entity ? `/?m=${data.module}&e=${data.entity}` : "/",
      osWhenHidden: true,
      osAlways: options?.osAlways,
    });
    return;
  }

  if (hidden) {
    appToastInfo(item.title, item.description || undefined);
  }
}

async function applyRealtimeMessage(
  data: RealtimeMessage,
  lastKey: { current: string },
  lastAt: { current: number },
) {
  if (!data.type || data.type === "ping") return;

  if (data.type === "records.updated" && data.module && data.entity) {
    const key = `${data.module}:${data.entity}`;
    const now = Date.now();
    if (key === lastKey.current && now - lastAt.current < 400) return;
    lastKey.current = key;
    lastAt.current = now;
    // Own PUT echo / in-flight write — memory already has the rows; skip laggy GET.
    if (isEntityPersistActive(data.module, data.entity)) return;
    if (
      data.revision &&
      knownEntityRevision(data.module, data.entity) === data.revision
    ) {
      return;
    }
    // Pull fresh rows into memory and repaint open views — no page reload.
    await silentRefreshEntity(data.module, data.entity, "realtime");
    notifyLive(
      data,
      "Live update",
      `${data.module} · ${data.entity} changed`,
      `rt-${key}`,
    );
    void refreshServerActivityFeed();
    return;
  }

  if (data.type === "ledger.updated") {
    await silentRefreshLedger("realtime");
    notifyLive(
      data,
      "Live update",
      data.details || "Ledger balances changed",
      "rt-ledger",
    );
    void refreshServerActivityFeed();
    return;
  }

  if (data.type === "settings.updated") {
    const key = data.key || "";
    // Login identity is never shared — ignore realtime echoes of the banned key.
    if (key === "financeiag-session") return;
    if (key) await silentRefreshSetting(key, "realtime");
    else window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
    const quiet =
      /^(financeiag-notifications-seen|financeiag-realtime-feed|financeiag-server-activity-cache|financeiag-session|financeiag-sessions|financeiag-keep-signed-in|financeiag-sidebar-collapsed|financeiag-theme)$/.test(
        key,
      );
    if (!quiet) {
      notifyLive(
        data,
        "Settings updated",
        data.details || `Setting ${key || "prefs"} changed`,
        `rt-settings-${key || "x"}`,
      );
      // Quiet prefs (session / activity cache / theme) must not refetch activity —
      // that used to PUT the cache again and create a 429 storm.
      void refreshServerActivityFeed();
    }
    return;
  }

  if (data.type === "auth.updated") {
    window.dispatchEvent(new CustomEvent("financeiag-auth-changed"));
    notifyLive(
      data,
      data.action || "Users & roles",
      data.details || `${data.entity || "auth"} changed`,
      `rt-auth-${data.entity || "x"}-${data.label || "y"}`,
    );
    void refreshServerActivityFeed();
    return;
  }

  if (data.type === "activity.logged") {
    notifyLive(
      data,
      data.action || "Activity",
      data.details || `${data.label || "Record"} · ${data.module || "workspace"}`,
      `rt-activity-${data.module || "x"}-${data.entity || "y"}-${data.label || "z"}`,
    );
    void refreshServerActivityFeed();
    return;
  }

  if (data.type?.startsWith("approval.")) {
    if (data.module && data.entity) {
      await silentRefreshEntity(data.module, data.entity, "realtime");
    }
    const copy = formatApprovalPopupCopy(data);
    notifyLive(
      data,
      copy.title,
      copy.description,
      `rt-approval-${data.entity || "x"}-${data.label || "y"}`,
      { forceToast: true },
    );
    void refreshServerActivityFeed();
  }
}

/**
 * WebSocket (preferred) + SSE fallback, with Gmail-style silent background sync:
 * open tables/lists update in place; the browser never does a full page refresh.
 */
export function RealtimeListener() {
  const lastKey = useRef("");
  const lastAt = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let closed = false;
    let ws: WebSocket | null = null;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let useSse = false;
    let sseAttempt = 0;
    // Custom server.ts (ws /api/ws) is not used on Vercel — skip failed upgrades.
    const wsSupported =
      !/\.vercel\.app$/i.test(window.location.hostname) &&
      process.env.NEXT_PUBLIC_DISABLE_WS !== "1";

    const stopBackground = startBackgroundSyncLoop();
    void refreshServerActivityFeed();

    const onMessage = (data: RealtimeMessage) => {
      void applyRealtimeMessage(data, lastKey, lastAt);
    };

    const sseBackoffMs = () => Math.min(30_000, 2_000 * 2 ** Math.min(sseAttempt, 4));

    const connectSse = () => {
      if (closed) return;
      useSse = true;
      es?.close();
      es = new EventSource("/api/realtime");
      es.onmessage = (msg) => {
        sseAttempt = 0;
        try {
          onMessage(JSON.parse(msg.data) as RealtimeMessage);
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        sseAttempt += 1;
        retryTimer = setTimeout(connectSse, sseBackoffMs());
      };
    };

    const connectWs = () => {
      if (closed) return;
      if (!wsSupported) {
        connectSse();
        return;
      }
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws?.close();
      try {
        // Auth via httpOnly cookie on the upgrade request — never put JWT in the query string.
        const wsUrl = `${proto}//${window.location.host}/api/ws`;
        ws = new WebSocket(wsUrl);
      } catch {
        connectSse();
        return;
      }

      ws.onopen = () => {
        pingTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 20_000);
      };

      ws.onmessage = (msg) => {
        try {
          onMessage(JSON.parse(String(msg.data)) as RealtimeMessage);
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        /* onclose handles fallback */
      };

      ws.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = undefined;
        ws = null;
        if (closed) return;
        // On platforms without a WS upgrade handler, stay on SSE (do not flapping-retry WS).
        if (!useSse) {
          connectSse();
          return;
        }
        sseAttempt += 1;
        retryTimer = setTimeout(connectSse, sseBackoffMs());
      };
    };

    if (wsSupported) connectWs();
    else connectSse();

    return () => {
      closed = true;
      stopBackground();
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      ws?.close();
      es?.close();
    };
  }, []);

  return null;
}
