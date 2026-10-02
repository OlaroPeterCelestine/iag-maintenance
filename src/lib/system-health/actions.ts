"use server";

/**
 * Server Actions behind the System health page.
 *
 * The page renders its first report during the server render; these cover what
 * happens afterwards — the Run checks button, auto-refresh, and reading the
 * browser's raw performance sample. Both re-check Administrator on every call:
 * a Server Action is a public POST endpoint, and the page's own gate says
 * nothing about who is invoking these later.
 */

import { isPageAdmin } from "@/lib/page-guard";
import { buildSystemHealthReport } from "@/lib/system-health/probe";
import type {
  ClientPerformanceActionResult,
  ClientPerformanceSample,
  SystemHealthActionResult,
} from "@/lib/system-health/types";
import { buildSystemHealthView, describeClientSample } from "@/lib/system-health/view";

const DENIED = "Administrator role required" as const;

/** Re-probe every dependency and return the finished view. */
export async function refreshSystemHealthAction(): Promise<SystemHealthActionResult> {
  if (!(await isPageAdmin())) return { ok: false, error: DENIED };
  const report = await buildSystemHealthReport();
  return { ok: true, view: buildSystemHealthView(report), report };
}

/**
 * Read one browser sample. The tab can only time itself, so it sends raw
 * numbers; the interpretation — what is a build asset, what is slow, how a
 * byte count reads — happens here.
 */
export async function describeClientPerformanceAction(
  sample: ClientPerformanceSample,
): Promise<ClientPerformanceActionResult> {
  if (!(await isPageAdmin())) return { ok: false, error: DENIED };
  const { view, performance } = describeClientSample(sample);
  return { ok: true, view, performance };
}
