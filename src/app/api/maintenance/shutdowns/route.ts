import type { NextRequest } from "next/server";
import { jsonBody, passThrough } from "@/lib/maintenance/mes-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/maintenance/shutdowns?plant= — iag-mes GET /shutdowns. */
export async function GET(request: NextRequest) {
  const plant = (request.nextUrl.searchParams.get("plant") || "").trim();
  return passThrough(request, { service: "mes", path: "/api/v1/shutdowns", query: plant ? { plant } : undefined });
}

/** POST — plan a shutdown (iag-mes POST /shutdowns). */
export async function POST(request: NextRequest) {
  return passThrough(request, { service: "mes", path: "/api/v1/shutdowns", method: "POST", body: (await jsonBody(request)) ?? {} });
}
