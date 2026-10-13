/**
 * The shared part of the maintenance API routes that pass a request through
 * to a platform service: the adapter switch, the sign-in check, and the
 * refusal mapping the records API uses (recordFailure), so a 409 from MES
 * reaches the screen with its reason.
 */
import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled } from "@/lib/iag/config";
import { gatewayFetch, type GatewayRequest } from "@/lib/iag/gateway";
import { recordFailure } from "@/lib/iag/records/failure";
import { resolvePrincipal } from "@/lib/server-jwt";

export async function passThrough(request: NextRequest, req: GatewayRequest): Promise<NextResponse> {
  if (!adapterEnabled()) {
    return NextResponse.json({ ok: false, error: "The platform adapter is off in this deployment." }, { status: 503 });
  }
  if (!(await resolvePrincipal(request))) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  try {
    const data = await gatewayFetch(req);
    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return recordFailure(err);
  }
}

/** The request's JSON body, or undefined when it has none. */
export async function jsonBody(request: NextRequest): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
