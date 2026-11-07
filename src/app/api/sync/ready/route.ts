/**
 * GET /api/sync/ready — cheap liveness for the write gate.
 *
 * `isDbSyncAvailable()` in src/lib/db/sync.ts calls this before every persist.
 * It must stay fast and must not require auth (the proxy allowlists it), so it
 * only asks the gateway whether the production service is up.
 */
import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled, gatewayOrigin } from "@/lib/iag/config";
import { legacyProxy } from "@/lib/iag/legacy";
import { SERVICE_PREFIX } from "@/lib/iag/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Short-lived cache — this endpoint is polled on every save. */
let cached: { ok: boolean; at: number } | null = null;
const TTL_MS = 5_000;

export async function GET(request: NextRequest) {
  if (!adapterEnabled()) return legacyProxy(request);

  const origin = gatewayOrigin();
  if (!origin) {
    return NextResponse.json(
      { ok: false, error: "IAG_GATEWAY_ORIGIN is not configured" },
      { status: 503 },
    );
  }

  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(
      { ok: cached.ok },
      { status: cached.ok ? 200 : 503 },
    );
  }

  let ok = false;
  try {
    const res = await fetch(`${origin}${SERVICE_PREFIX.production()}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  cached = { ok, at: Date.now() };

  return NextResponse.json({ ok }, { status: ok ? 200 : 503 });
}
