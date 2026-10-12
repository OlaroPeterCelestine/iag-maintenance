import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled } from "@/lib/iag/config";
import { RECORD_ADAPTERS } from "@/lib/iag/records/registry";
import type { AdapterContext } from "@/lib/iag/records/types";
import { buildMaintenanceOverview, type OverviewLists } from "@/lib/maintenance/overview";
import type { Rec } from "@/lib/maintenance/machine-summary";
import { resolvePrincipal } from "@/lib/server-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Which adapter feeds which list, and what the gap means if it fails. */
const SOURCES: [keyof OverviewLists, string, string][] = [
  ["workOrders", "work-orders", "work orders"],
  ["machines", "work-centers", "machines"],
  ["faultReports", "fault-reports", "fault reports"],
  ["schedules", "pm-schedules", "PM schedules"],
  ["spareParts", "spare-parts", "spare parts"],
  ["reliability", "reliability", "reliability (MTBF/MTTR)"],
  ["failureCauses", "failure-causes", "failure causes"],
  ["machineCosts", "machine-costs", "costs"],
];

/**
 * GET /api/dashboard/maintenance?plant=<factory> — the maintenance overview
 * (src/lib/maintenance/overview.ts), from the same adapters as the list
 * screens. A source that fails is named in `gaps` and counted as empty, so one
 * service being down does not blank the page — and does not pass for zero.
 */
export async function GET(request: NextRequest) {
  if (!adapterEnabled()) {
    return NextResponse.json({ ok: false, error: "The platform adapter is off in this deployment." }, { status: 503 });
  }
  if (!(await resolvePrincipal(request))) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const plant = (request.nextUrl.searchParams.get("plant") || "").trim();
  const query = new URLSearchParams(plant ? { factory: plant } : {});
  const gaps: string[] = [];
  const lists = {} as OverviewLists;
  await Promise.all(
    SOURCES.map(async ([key, entity, label]) => {
      const adapter = RECORD_ADAPTERS[`production:${entity}`];
      const ctx: AdapterContext = { module: "production", entity, query };
      try {
        lists[key] = adapter ? ((await adapter.list(ctx)) as unknown as Rec[]) : [];
        if (!adapter) gaps.push(label);
      } catch (err) {
        lists[key] = [];
        gaps.push(`${label} (${err instanceof Error ? err.message : "unavailable"})`);
      }
    }),
  );
  const data = buildMaintenanceOverview(lists, { factory: plant });
  return NextResponse.json({ ok: true, data, gaps }, { headers: { "Cache-Control": "no-store" } });
}
