import { NextResponse, type NextRequest } from "next/server";
import { jsonBody, passThrough } from "@/lib/maintenance/mes-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ code: string; action: string }> };

/** What a shutdown can be asked to do (iag-mes internal/store/shutdown.go). */
const ACTIONS = new Set(["jobs", "agree", "start", "finish", "cancel"]);

export async function POST(request: NextRequest, { params }: Params) {
  const { code, action } = await params;
  if (!ACTIONS.has(action)) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  return passThrough(request, {
    service: "mes",
    path: `/api/v1/shutdowns/${encodeURIComponent(code)}/${action}`,
    method: "POST",
    body: await jsonBody(request),
  });
}
