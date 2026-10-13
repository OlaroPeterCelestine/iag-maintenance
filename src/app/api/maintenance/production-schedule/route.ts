import { NextResponse, type NextRequest } from "next/server";
import { passThrough } from "@/lib/maintenance/mes-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/maintenance/production-schedule?from=&to= — what iag-production has
 * planned on the machines (schedule blocks), read-only, so a shutdown can show
 * the production it would stop. Needs production.view_schedule; without it
 * the screen says the schedule could not be read rather than showing none.
 */
export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from") || "";
  const to = request.nextUrl.searchParams.get("to") || "";
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json({ ok: false, error: "from and to are times (RFC 3339)" }, { status: 400 });
  }
  return passThrough(request, {
    service: "production",
    path: "/api/v1/schedule-blocks",
    query: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
  });
}
