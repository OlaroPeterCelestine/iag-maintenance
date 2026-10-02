"use client";

import { readAuthSession } from "@/lib/auth";
import {
  installChunkAssetWatcher,
  isChunkLoadError,
  markChunkRecoverySettled,
  recoverFromChunkError,
} from "@/lib/chunk-recovery";
import { drainConsoleSink } from "@/lib/console-lock";
import { isResizeObserverNoise } from "@/lib/resize-observer-noise";
import { APP_VERSION } from "@/lib/app-version";
import type { CrashEventInput, CrashSeverity, CrashSource } from "./types";

const ENDPOINT = "/api/crash";
const DEDUPE_MS = 8_000;
/** How often buffered console output is shipped to the crash store. */
const CONSOLE_FLUSH_MS = 10_000;
const recent = new Map<string, number>();
let wired = false;
let settleTimer: number | null = null;
let consoleTimer: number | null = null;

/**
 * `next dev` rebuilds chunks constantly, so every recompile would file a crash
 * and bury real user issues. Recovery still runs — only the report is dropped.
 */
function skipStaleBuildReport(): boolean {
  return process.env.NODE_ENV !== "production";
}

function releaseTag(): string | undefined {
  return APP_VERSION;
}

function sessionBits(): Pick<CrashEventInput, "userId" | "username" | "role"> {
  try {
    const session = readAuthSession();
    if (!session) return {};
    return {
      userId: session.userId,
      username: session.username,
      role: session.role,
    };
  } catch {
    return {};
  }
}

function shouldSend(fingerprintKey: string): boolean {
  const now = Date.now();
  const last = recent.get(fingerprintKey) || 0;
  if (now - last < DEDUPE_MS) return false;
  recent.set(fingerprintKey, now);
  if (recent.size > 80) {
    const cutoff = now - DEDUPE_MS * 4;
    for (const [k, t] of recent) {
      if (t < cutoff) recent.delete(k);
    }
  }
  return true;
}

export function reportCrash(
  input: CrashEventInput & { severity?: CrashSeverity; source?: CrashSource },
): void {
  if (typeof window === "undefined") return;
  const message = String(input.message || "").trim();
  if (!message) return;

  const dedupeKey = `${input.source || "manual"}|${input.name || ""}|${message.slice(0, 120)}|${(input.route || "").slice(0, 80)}`;
  if (!shouldSend(dedupeKey)) return;

  const session = sessionBits();
  const payload: CrashEventInput = {
    ...input,
    ...session,
    message: message.slice(0, 2000),
    name: input.name || "Error",
    severity: input.severity || "error",
    source: input.source || "manual",
    url: input.url || window.location.href,
    route: input.route || `${window.location.pathname}${window.location.search}`,
    userAgent: input.userAgent || navigator.userAgent,
    release: input.release || releaseTag(),
    occurredAt: input.occurredAt || new Date().toISOString(),
  };

  const body = JSON.stringify(payload);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return;
    }
  } catch {
    /* fall through */
  }

  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {
    /* never throw from crash reporter */
  });
}

export function reportErrorObject(
  error: unknown,
  extras?: Partial<CrashEventInput> & { severity?: CrashSeverity; source?: CrashSource },
): void {
  const err = error instanceof Error ? error : new Error(String(error || "Unknown error"));
  reportCrash({
    message: err.message || "Unknown error",
    name: err.name || "Error",
    stack: err.stack,
    severity: extras?.severity || "error",
    source: extras?.source || "manual",
    ...extras,
  });
}

/**
 * Ship anything the locked console swallowed. Without this the production
 * console lock would simply lose errors instead of relocating them to the DB.
 */
export function flushConsoleSink(): void {
  for (const entry of drainConsoleSink()) {
    if (isResizeObserverNoise(entry.message)) continue;
    reportCrash({
      message: entry.message,
      name: entry.level === "warn" ? "ConsoleWarning" : "ConsoleError",
      stack: entry.stack,
      severity: entry.level === "warn" ? "warning" : "error",
      source: "console",
      occurredAt: new Date(entry.at).toISOString(),
    });
  }
}

/** Install once: window.onerror + unhandledrejection + console sink flush. */
export function installCrashAnalytics(): () => void {
  if (typeof window === "undefined" || wired) return () => {};
  wired = true;

  const onError = (event: ErrorEvent) => {
    if (isResizeObserverNoise(event.message) || isResizeObserverNoise(event.error)) return;
    const stale = isChunkLoadError(event.error) || isChunkLoadError(event.message);
    if (!(stale && skipStaleBuildReport())) {
      reportCrash({
        message: event.message || "window.onerror",
        name: event.error instanceof Error ? event.error.name : "Error",
        stack: event.error instanceof Error ? event.error.stack : undefined,
        severity: stale ? "warning" : "fatal",
        source: "window.onerror",
        context: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          staleBuild: stale || undefined,
        },
      });
    }
    if (stale) recoverFromChunkError();
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const err =
      reason instanceof Error
        ? reason
        : new Error(typeof reason === "string" ? reason : "Unhandled promise rejection");
    const stale = isChunkLoadError(err);
    if (!(stale && skipStaleBuildReport())) {
      reportCrash({
        message: err.message,
        name: err.name || "UnhandledRejection",
        stack: err.stack,
        severity: stale ? "warning" : "error",
        source: "unhandledrejection",
        context: { staleBuild: stale || undefined },
      });
    }
    if (stale) recoverFromChunkError();
  };

  const onHide = () => {
    if (document.visibilityState === "hidden") flushConsoleSink();
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  document.addEventListener("visibilitychange", onHide);
  // Capture-phase watcher for <script>/<link> assets that 404 after a deploy —
  // those never surface as an ErrorEvent the handler above can read.
  const removeAssetWatcher = installChunkAssetWatcher();
  settleTimer = window.setTimeout(markChunkRecoverySettled, 20_000);
  flushConsoleSink();
  consoleTimer = window.setInterval(flushConsoleSink, CONSOLE_FLUSH_MS);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    document.removeEventListener("visibilitychange", onHide);
    removeAssetWatcher();
    if (settleTimer !== null) window.clearTimeout(settleTimer);
    settleTimer = null;
    if (consoleTimer !== null) window.clearInterval(consoleTimer);
    consoleTimer = null;
    wired = false;
  };
}
