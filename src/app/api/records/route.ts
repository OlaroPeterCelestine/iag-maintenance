/**
 * GET /api/records — which module/entity collections exist.
 *
 * `pullRemoteRecordKeys()` uses this to discover data the browser has never
 * seen. We return every adapter-backed key, unioned with whatever the legacy
 * API still holds, so a half-migrated workspace shows both.
 */
import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled, legacyApiOrigin, unmappedMode } from "@/lib/iag/config";
import { legacyProxy } from "@/lib/iag/legacy";
import { mappedKeys } from "@/lib/iag/records/registry";
import { resolvePrincipal } from "@/lib/server-jwt";
import { gatewayTimeoutMs } from "@/lib/iag/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Key = { module: string; entity: string };

/** Ask the legacy API for its keys — best effort, never fatal. */
async function legacyKeys(request: NextRequest): Promise<Key[]> {
  const origin = legacyApiOrigin();
  if (!origin || unmappedMode() === "empty") return [];
  try {
    const headers = new Headers();
    const auth = request.headers.get("authorization");
    const cookie = request.headers.get("cookie");
    if (auth) headers.set("authorization", auth);
    if (cookie) headers.set("cookie", cookie);

    const res = await fetch(`${origin}/api/records`, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(Math.min(8_000, gatewayTimeoutMs())),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<Partial<Key>> };
    return (json.data || [])
      .filter((row): row is Key => Boolean(row.module && row.entity))
      .map((row) => ({ module: String(row.module), entity: String(row.entity) }));
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  if (!adapterEnabled()) return legacyProxy(request);
  if (!(await resolvePrincipal(request))) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const seen = new Set<string>();
  const data: Key[] = [];

  for (const key of mappedKeys()) {
    const [module, entity] = key.split(":");
    if (!module || !entity || seen.has(key)) continue;
    seen.add(key);
    data.push({ module, entity });
  }

  for (const row of await legacyKeys(request)) {
    const key = `${row.module}:${row.entity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    data.push(row);
  }

  return NextResponse.json({ ok: true, data });
}