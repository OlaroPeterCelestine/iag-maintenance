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
        // Boot "API unreachable" was noisy and often wrong (Strict Mode double
        // hydrate, auth races). Soft-fail silently — save paths still surface
        // real durability errors.
        if (/unreachable|Go API is online/i.test(message)) {
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
      appToastError("Not saved to database", message);
    }
    window.addEventListener("financeiag-persist-failed", onFailed);
    return () => window.removeEventListener("financeiag-persist-failed", onFailed);
  }, []);

  return null;
}
