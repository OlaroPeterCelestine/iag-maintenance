import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled } from "@/lib/iag/config";
import { GatewayError, gatewayFetch } from "@/lib/iag/gateway";
import { resolvePrincipal } from "@/lib/server-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/maintenance/forecast?from=YYYY-MM-DD&to=YYYY-MM-DD&plant=<factory>
 * — every preventive job due over the range, from iag-mes
 * (GET /maintenance/forecast). The calendar lays it out; nothing is stored.
 */
export async function GET(request: NextRequest) {
  if (!adapterEnabled()) {
    return NextResponse.json({ ok: false, error: "The platform adapter is off in this deployment." }, { status: 503 });
  }
  if (!(await resolvePrincipal(request))) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const params = request.nextUrl.searchParams;
  const query: Record<string, string> = {};
  for (const key of ["from", "to"] as const) {
    const v = (params.get(key) || "").trim();
    if (!v) continue;
    if (!DAY.test(v)) return NextResponse.json({ ok: false, error: `${key} is a date (YYYY-MM-DD)` }, { status: 400 });
    query[key] = v;
  }
  const plant = (params.get("plant") || "").trim();
  if (plant) query.plant = plant;
  try {
    const data = await gatewayFetch({ service: "mes", path: "/api/v1/maintenance/forecast", query });
    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof GatewayError ? err.status : 502;
    // A 404 is an iag-mes without the forecast yet (before iag-mes#17 deploys).
    const error =
      status === 404
        ? "The forecast is not available from iag-mes yet."
        : err instanceof Error
          ? err.message
          : "The forecast could not be read.";
    return NextResponse.json({ ok: false, error }, { status: status >= 400 && status < 600 ? status : 502 });
  }
}
