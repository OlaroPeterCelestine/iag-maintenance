import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-guard";
import { buildSystemHealthReport } from "@/lib/system-health/probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/system-health — full dependency + performance diagnostics.
 *
 * Administrator-only: the payload names every configured service and the exact
 * failure text from each, which is reconnaissance for anyone else. `/api/health`
 * stays the anonymous liveness probe for load balancers.
 *
 * Always answers 200 when the caller is allowed — the body carries the verdict.
 * A 503 here would make the page's own fetch look like the outage.
 */
export async function GET(request: Request) {
  const auth = await requireApiAdmin(request);
  if ("response" in auth) return auth.response;

  const report = await buildSystemHealthReport();
  return NextResponse.json(report, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
