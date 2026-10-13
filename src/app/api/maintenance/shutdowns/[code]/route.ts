import type { NextRequest } from "next/server";
import { jsonBody, passThrough } from "@/lib/maintenance/mes-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ code: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { code } = await params;
  return passThrough(request, { service: "mes", path: `/api/v1/shutdowns/${encodeURIComponent(code)}` });
}

/** PATCH — change a planned shutdown: window, lead, notes, machines. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { code } = await params;
  return passThrough(request, {
    service: "mes",
    path: `/api/v1/shutdowns/${encodeURIComponent(code)}`,
    method: "PATCH",
    body: (await jsonBody(request)) ?? {},
  });
}
