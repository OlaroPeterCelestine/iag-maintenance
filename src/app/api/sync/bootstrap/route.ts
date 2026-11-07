/**
 * GET /api/sync/bootstrap — one-round-trip boot payload for adapter deploys.
 *
 * Without this route the client hit a rewrite / absent Go host, remembered
 * bootstrap as missing, then degraded into legacy ledger/settings pulls that
 * looked like "database down" on a healthy platform service.
 *
 * Adapter answer: mapped record keys + hasData. Ledger/settings hydrate
 * per-collection or soft-fail.
 */
import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled } from "@/lib/iag/config";
import { GatewayError, gatewayFetch, unwrapList } from "@/lib/iag/gateway";
import { legacyProxy } from "@/lib/iag/legacy";
import { mappedKeys } from "@/lib/iag/records/registry";
import { resolvePrincipal } from "@/lib/server-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!adapterEnabled()) return legacyProxy(request);

  if (!(await resolvePrincipal(request))) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }

  const recordKeys = mappedKeys()
    .map((key) => {
      const [module, entity] = key.split(":");
      return module && entity ? { module, entity } : null;
    })
    .filter((row): row is { module: string; entity: string } => Boolean(row));

  let hasData = false;
  try {
    const rows = unwrapList(
      await gatewayFetch({
        service: "production",
        path: "/api/v1/work-orders",
        query: { limit: 1 },
      }),
    );
    hasData = rows.length > 0;
  } catch (err) {
    if (err instanceof GatewayError && err.status === 401) {
      return NextResponse.json(
        { ok: false, error: "Platform session expired" },
        { status: 401 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    hasData: hasData || recordKeys.length > 0,
    recordKeys,
    settings: {},
    accounts: [],
    balances: [],
    lines: { data: [], hasMore: false, nextOffset: 0 },
  });
}
