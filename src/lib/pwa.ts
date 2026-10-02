/**
 * PWA service worker registration + Web Push subscription against the Go API.
 * iOS Safari only delivers background push for Home Screen (standalone) apps.
 */
import { apiFetch } from "@/lib/api-auth";
import { getAppFlag, setAppFlag } from "@/lib/db/app-prefs";

const PUSH_READY_KEY = "financeiag-push-ready";
export const PUSH_STATUS_EVENT = "financeiag-push-status-changed";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function isIosDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iOS || iPadOs;
}

/** True when launched from Home Screen (required for iOS Web Push). */
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia?.("(display-mode: standalone)")?.matches;
  const navStandalone = Boolean(
    (navigator as Navigator & { standalone?: boolean }).standalone,
  );
  return Boolean(media || navStandalone);
}

export function webPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Subscription state lives in memory + Postgres — never on the device. */
export function readPushReadyFlag(): boolean {
  if (typeof window === "undefined") return false;
  return getAppFlag(PUSH_READY_KEY);
}

function setPushReadyFlag(ready: boolean): void {
  if (typeof window === "undefined") return;
  setAppFlag(PUSH_READY_KEY, ready);
  window.dispatchEvent(new CustomEvent(PUSH_STATUS_EVENT));
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

export async function enablePushNotifications(): Promise<{
  ok: boolean;
  reason?: string;
}> {
  if (typeof window === "undefined") return { ok: false, reason: "Unavailable" };
  if (!webPushSupported()) {
    return { ok: false, reason: "Push not supported in this browser" };
  }
  if (!window.isSecureContext) {
    return { ok: false, reason: "HTTPS required for notifications" };
  }
  if (isIosDevice() && !isStandalonePwa()) {
    return {
      ok: false,
      reason:
        "On iPhone, open Share → Add to Home Screen, then launch IAG Finance from the home icon and enable alerts.",
    };
  }

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: "Service worker unavailable" };

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    return {
      ok: false,
      reason: isIosDevice()
        ? "Notifications blocked. Settings → Notifications → IAG Finance → Allow Notifications."
        : "Notification permission denied",
    };
  }

  const vapidRes = await apiFetch("/api/push/vapid-public", { cache: "no-store" });
  const vapidJson = (await vapidRes.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: { enabled?: boolean; publicKey?: string };
  };
  const publicKey = vapidJson.data?.publicKey || "";
  if (!vapidJson.ok || !vapidJson.data?.enabled || !publicKey) {
    return { ok: false, reason: "Push not configured on API" };
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  const json = sub.toJSON();
  const res = await apiFetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: {
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      },
    }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    setPushReadyFlag(false);
    return { ok: false, reason: err.error || `Subscribe failed (${res.status})` };
  }
  setPushReadyFlag(true);
  return { ok: true };
}

/**
 * Quiet re-subscribe when already granted — keeps iOS/APNs endpoint fresh
 * without popping a permission dialog.
 */
export async function refreshPushSubscriptionQuietly(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!webPushSupported()) return;
  if (isIosDevice() && !isStandalonePwa()) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    await enablePushNotifications();
  } catch {
    /* ignore */
  }
}

/** Best-effort: register SW; only auto-prompt on desktop (iOS needs a tap). */
export function bootstrapPwaAndPush(): void {
  if (typeof window === "undefined") return;
  void (async () => {
    await registerServiceWorker();
    if (isIosDevice() && !isStandalonePwa()) return;
    // Desktop / already-installed PWA: refresh if permission already granted.
    if (Notification.permission === "granted") {
      await refreshPushSubscriptionQuietly();
      return;
    }
    // Auto-prompt only when not iOS (iOS requires a user gesture).
    if (!isIosDevice() && Notification.permission === "default") {
      window.setTimeout(() => {
        void enablePushNotifications();
      }, 2500);
    }
  })();
}

export type PushDiag = {
  secure: boolean;
  permission: NotificationPermission | "unsupported";
  swReady: boolean;
  subscribed: boolean;
  vapidEnabled: boolean;
  ios: boolean;
  standalone: boolean;
};

/** Snapshot of what the browser needs for OS popups to appear. */
export async function diagnosePush(): Promise<PushDiag> {
  if (typeof window === "undefined") {
    return {
      secure: false,
      permission: "unsupported",
      swReady: false,
      subscribed: false,
      vapidEnabled: false,
      ios: false,
      standalone: false,
    };
  }
  const secure = window.isSecureContext;
  const permission =
    !("Notification" in window) ? "unsupported" : Notification.permission;
  let swReady = false;
  let subscribed = false;
  try {
    const reg = await registerServiceWorker();
    swReady = Boolean(reg?.active || reg?.waiting || reg?.installing);
    subscribed = Boolean(await reg?.pushManager.getSubscription());
  } catch {
    /* ignore */
  }
  let vapidEnabled = false;
  try {
    const vapidRes = await apiFetch("/api/push/vapid-public", { cache: "no-store" });
    const vapidJson = (await vapidRes.json().catch(() => ({}))) as {
      data?: { enabled?: boolean };
    };
    vapidEnabled = Boolean(vapidJson.data?.enabled);
  } catch {
    /* ignore */
  }
  return {
    secure,
    permission,
    swReady,
    subscribed,
    vapidEnabled,
    ios: isIosDevice(),
    standalone: isStandalonePwa(),
  };
}

/**
 * 1) Local OS notification (proves permission)
 * 2) Re-subscribe + server Web Push (proves APNs/FCM → service worker path)
 */
export async function runPushSelfTest(): Promise<{
  ok: boolean;
  steps: string[];
  error?: string;
}> {
  const steps: string[] = [];
  if (typeof window === "undefined") {
    return { ok: false, steps, error: "Unavailable" };
  }
  if (!("Notification" in window)) {
    return { ok: false, steps, error: "This browser does not support notifications" };
  }
  if (isIosDevice() && !isStandalonePwa()) {
    return {
      ok: false,
      steps,
      error:
        "iPhone: Share → Add to Home Screen, open the home icon, then run this test again.",
    };
  }

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
    steps.push(`Permission prompt → ${permission}`);
  } else {
    steps.push(`Permission already ${permission}`);
  }
  if (permission !== "granted") {
    return {
      ok: false,
      steps,
      error: isIosDevice()
        ? "Notifications blocked. Settings → Notifications → IAG Finance → Allow."
        : "Notifications are blocked. Chrome → Site settings → Notifications → Allow.",
    };
  }

  try {
    new Notification("IAG Finance · local test", {
      body: "Local popup works. Next: server push (works with the app closed).",
      icon: "/icon-192.png",
      tag: "local-push-test",
    });
    steps.push("Local Notification shown");
  } catch (e) {
    return {
      ok: false,
      steps,
      error: e instanceof Error ? e.message : "Local Notification failed",
    };
  }

  const sub = await enablePushNotifications();
  if (!sub.ok) {
    return { ok: false, steps: [...steps, `Subscribe failed: ${sub.reason}`], error: sub.reason };
  }
  steps.push("Push subscription saved");

  const res = await apiFetch("/api/push/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    data?: { targeted?: number; message?: string };
  };
  if (!res.ok || !json.ok) {
    return {
      ok: false,
      steps: [...steps, json.error || `Server test failed (${res.status})`],
      error: json.error || `Server test failed (${res.status})`,
    };
  }
  steps.push(
    json.data?.message ||
      `Server push sent to ${json.data?.targeted ?? 0} device(s)`,
  );
  return { ok: true, steps };
}
