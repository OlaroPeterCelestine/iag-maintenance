"use client";

import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";
import { reportErrorObject } from "@/lib/crash-analytics/client";
import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const stale = isChunkLoadError(error);

  useEffect(() => {
    reportErrorObject(error, {
      severity: stale ? "warning" : "fatal",
      source: "global-error",
      context: {
        digest: error.digest || null,
        boundary: "global-error.tsx",
        staleBuild: stale || undefined,
      },
    });
    if (stale) recoverFromChunkError();
  }, [error, stale]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
          color: "#f8fafc",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>
            {stale ? "Updating to the latest version…" : "Application error"}
          </h1>
          <p style={{ fontSize: 14, opacity: 0.75, marginBottom: 20 }}>
            {stale
              ? "A new build was released while this tab was open. Reloading now."
              : "A fatal crash was reported. Reload to continue."}
          </p>
          {!stale ? (
            <button
              type="button"
              onClick={() => unstable_retry()}
              style={{
                background: "#f97316",
                color: "#fff",
                border: 0,
                borderRadius: 8,
                padding: "10px 16px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          ) : null}
        </div>
      </body>
    </html>
  );
}
