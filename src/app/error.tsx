"use client";

import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";
import { reportErrorObject } from "@/lib/crash-analytics/client";
import Link from "next/link";
import { useEffect } from "react";

export default function Error({
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
      source: "react-boundary",
      context: {
        digest: error.digest || null,
        boundary: "error.tsx",
        staleBuild: stale || undefined,
      },
    });
    if (stale) recoverFromChunkError();
  }, [error, stale]);

  if (stale) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center dark:bg-slate-950">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          Updating to the latest version…
        </h1>
        <p className="max-w-md text-sm text-slate-500">
          A new build was released while this tab was open. Reloading now.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center dark:bg-slate-950">
      <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
        This page crashed
      </h1>
      <p className="max-w-md text-sm text-slate-500">
        The error was sent to crash analytics. You can try again or go back to the dashboard.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200"
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
}
