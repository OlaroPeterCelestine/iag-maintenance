"use client";

import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";
import { installCrashAnalytics, reportErrorObject } from "@/lib/crash-analytics/client";
import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";

type BoundaryProps = { children: ReactNode };
type BoundaryState = { error: Error | null; recovering: boolean };

class CrashBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, recovering: false };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error, recovering: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const stale = isChunkLoadError(error);
    reportErrorObject(error, {
      severity: stale ? "warning" : "fatal",
      source: "react-boundary",
      componentStack: info.componentStack || undefined,
      context: { staleBuild: stale || undefined },
    });
    if (stale && recoverFromChunkError()) return;
    if (stale) this.setState({ recovering: false });
  }

  render() {
    if (this.state.recovering) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            Updating to the latest version…
          </p>
          <p className="max-w-md text-xs text-slate-500">
            A new build was released while this tab was open. Reloading now.
          </p>
        </div>
      );
    }
    if (this.state.error) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            Something went wrong
          </p>
          <p className="max-w-md text-xs text-slate-500">
            This crash was reported to analytics. Try refreshing the page.
          </p>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            onClick={() => {
              this.setState({ error: null, recovering: false });
              if (typeof window !== "undefined") window.location.reload();
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function CrashListeners() {
  useEffect(() => installCrashAnalytics(), []);
  return null;
}

/** Global JS listeners + React boundary for uncaught UI crashes. */
export function CrashAnalyticsProvider({ children }: { children: ReactNode }) {
  return (
    <CrashBoundary>
      <CrashListeners />
      {children}
    </CrashBoundary>
  );
}
