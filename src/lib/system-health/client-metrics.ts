"use client";

/**
 * Raw browser readings for the System health page.
 *
 * Server probes say whether a dependency answers; they say nothing about what
 * the person in front of the app actually waits for. Only the tab can read
 * Navigation Timing, resource weights, and a round trip that includes the
 * proxy hop — so the tab takes the readings and nothing else. No filtering,
 * no thresholds, no unit conversion: `describeClientPerformanceAction` turns
 * this sample into rows on the server, which is where every other verdict on
 * this page is already made.
 */

import { apiFetch } from "@/lib/api-auth";
import type { ClientPerformanceSample } from "@/lib/system-health/types";

/** Bounds the sample POST; a page pulling more entries than this is already the finding. */
const MAX_RESOURCES = 400;
const ENDPOINT_TIMEOUT_MS = 8_000;

function navigationEntry(): PerformanceNavigationTiming | null {
  try {
    const entries = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return entries[0] || null;
  } catch {
    return null;
  }
}

function resourceEntries(): ClientPerformanceSample["resources"] {
  try {
    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return entries.slice(0, MAX_RESOURCES).map((entry) => ({
      url: entry.name,
      initiatorType: entry.initiatorType,
      transferBytes: entry.transferSize || 0,
      decodedBytes: entry.decodedBodySize || 0,
      durationMs: entry.duration,
    }));
  } catch {
    return [];
  }
}

function largestContentfulPaint(): number | null {
  try {
    const entries = performance.getEntriesByType("largest-contentful-paint");
    const last = entries[entries.length - 1];
    return last ? last.startTime : null;
  } catch {
    return null;
  }
}

/** Times the paths the server asked for — the stopwatch, not the verdict. */
async function timeEndpoints(
  targets: { path: string }[],
): Promise<ClientPerformanceSample["endpoints"]> {
  return Promise.all(
    targets.map(async ({ path }) => {
      const started = performance.now();
      try {
        const res = await apiFetch(path, { cache: "no-store", timeoutMs: ENDPOINT_TIMEOUT_MS });
        return {
          path,
          ok: res.ok,
          status: res.status,
          statusText: res.statusText || "",
          latencyMs: performance.now() - started,
          error: "",
        };
      } catch (err) {
        return {
          path,
          ok: false,
          status: 0,
          statusText: "",
          latencyMs: performance.now() - started,
          error: err instanceof Error ? err.message : "Request failed",
        };
      }
    }),
  );
}

export async function collectClientSample(
  endpointTargets: { path: string }[],
): Promise<ClientPerformanceSample> {
  const nav = navigationEntry();
  return {
    ttfbMs: nav ? nav.responseStart - nav.requestStart : null,
    domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null,
    loadMs: nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : null,
    lcpMs: largestContentfulPaint(),
    resources: resourceEntries(),
    endpoints: await timeEndpoints(endpointTargets),
  };
}
