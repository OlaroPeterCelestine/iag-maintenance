"use client";

import { appToastError, appToastWarning } from "@/lib/app-toast";
import { useEffect, useRef } from "react";

type PersistFailedDetail = {
  kind?: string;
  key?: string;
  error?: string;
};

function isAuthFailure(message: string): boolean {
  return (
    /\(401\)/.test(message) ||
    /Unauthorized/i.test(message) ||
    /Sign in required/i.test(message) ||
    /Sign in and send Authorization/i.test(message)
  );
}

/**
 * Surfaces silent Postgres save/hydrate failures so users know data is not
 * durable yet (especially on bad internet). Business data is never in localStorage.
 */
export function PersistFailureToaster() {
  const lastRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });

  useEffect(() => {
    function onFailed(event: Event) {
      const detail = (event as CustomEvent<PersistFailedDetail>).detail;
      const message =
        (detail?.error || "").trim() ||
        "Could not reach the database. Your change may only be in this tab until you retry online.";
      const kind = (detail?.kind || "").toLowerCase();
      const dedupeKey = `${kind}|${detail?.key || ""}|${message}`;
      const now = Date.now();
      // Collapse Strict Mode / remount duplicates within 8s.
      if (
        lastRef.current.key === dedupeKey &&
        now - lastRef.current.at < 8_000
      ) {
        return;
      }
      lastRef.current = { key: dedupeKey, at: now };

      if (kind === "hydrate") {
        // Boot unreachable / per-list refresh misses are noisy and often wrong
        // (Strict Mode, auth races, optional legacy host). Soft-fail silently —
        // user-triggered saves still surface real durability errors.
        if (
          /unreachable|Go API is online|Could not load this list from the database|Showing last tab data/i.test(
            message,
          )
        ) {
          return;
        }
        appToastWarning("Data not fully loaded", message);
        return;
      }
      // Auth is handled by apiFetch → sign-out; don't show the raw Go 401 string.
      if (isAuthFailure(message)) {
        appToastError(
          "Session expired",
          "Sign in again to save changes to the database.",
        );
        return;
      }
      // Optional legacy ERP / missing GO_API_* / unmapped passthrough — not a
      // failed platform save. IAG services use the signed-in session via the
      // gateway; these messages only mean prefs/unmapped collections could not
      // sync to an old Go host.
      if (
        kind === "settings-unavailable" ||
        /GO_API_KEY|API_KEY or GO_API_KEY|does not accept an IAG platform session|optional legacy ERP|GO_API_URL|no backend in this deployment|IAG_UNMAPPED_MODE/i.test(
          message,
        )
      ) {
        return;
      }
      appToastError("Not saved to database", message);
    }
    window.addEventListener("financeiag-persist-failed", onFailed);
    return () => window.removeEventListener("financeiag-persist-failed", onFailed);
  }, []);

  return null;
}
