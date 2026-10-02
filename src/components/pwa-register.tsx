"use client";

import {
  bootstrapPwaAndPush,
  diagnosePush,
  enablePushNotifications,
  isIosDevice,
  PUSH_STATUS_EVENT,
  readPushReadyFlag,
  refreshPushSubscriptionQuietly,
  webPushSupported,
} from "@/lib/pwa";
import { isAuthenticated } from "@/lib/auth";
import { appToastSuccess, appToastWarning } from "@/lib/app-toast";
import { Bell, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const DISMISS_ENABLE_KEY = "financeiag-push-enable-dismissed";

/** Tab-scoped banner dismissals — memory only. */
const dismissedBanners = new Set<string>();

/**
 * Registers the service worker and drives approval-alert opt-in.
 * Native / Chrome "Install app" prompts are suppressed.
 */
export function PwaRegister() {
  const [banner, setBanner] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshBanner = useCallback(async () => {
    if (typeof window === "undefined" || !isAuthenticated()) {
      setBanner(false);
      return;
    }
    if (!webPushSupported() && !isIosDevice()) {
      setBanner(false);
      return;
    }

    const dismissedEnable = dismissedBanners.has(DISMISS_ENABLE_KEY);
    const diag = await diagnosePush();

    if (diag.ios && !diag.standalone) {
      setBanner(false);
      return;
    }

    const needsEnable =
      diag.permission !== "granted" || !diag.subscribed || !readPushReadyFlag();
    setBanner(Boolean(needsEnable && !dismissedEnable));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isAuthenticated()) {
      bootstrapPwaAndPush();
    } else {
      void import("@/lib/pwa").then((m) => m.registerServiceWorker());
    }
    void refreshBanner();

    const onAuth = () => {
      if (isAuthenticated()) bootstrapPwaAndPush();
      void refreshBanner();
    };
    const onPushStatus = () => void refreshBanner();
    const onVisible = () => {
      if (document.visibilityState === "visible" && isAuthenticated()) {
        void refreshPushSubscriptionQuietly();
        void refreshBanner();
      }
    };

    window.addEventListener("financeiag-auth-changed", onAuth);
    window.addEventListener(PUSH_STATUS_EVENT, onPushStatus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    const onBip = (e: Event) => {
      e.preventDefault();
    };
    window.addEventListener("beforeinstallprompt", onBip);

    return () => {
      window.removeEventListener("financeiag-auth-changed", onAuth);
      window.removeEventListener(PUSH_STATUS_EVENT, onPushStatus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("beforeinstallprompt", onBip);
    };
  }, [refreshBanner]);

  async function handleEnablePush() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await enablePushNotifications();
      if (result.ok) {
        appToastSuccess(
          "Approval alerts on",
          "You’ll get a phone banner when a request needs your approval — even if the app is closed.",
          6500,
        );
        setBanner(false);
      } else {
        appToastWarning("Could not enable alerts", result.reason || "Try again", 7000);
        void refreshBanner();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!banner) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:inset-x-auto sm:left-4 sm:right-auto lg:left-[calc(248px+1rem)]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
          <Bell size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-slate-900">
            Turn on approval notifications
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
            Get a lock-screen banner when a payment or request is waiting on you —
            even with the app closed.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleEnablePush()}
            className="mt-3 inline-flex items-center justify-center rounded-lg bg-slate-900 px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {busy ? "Enabling…" : "Enable alerts"}
          </button>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            dismissedBanners.add(DISMISS_ENABLE_KEY);
            setBanner(false);
          }}
          className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
