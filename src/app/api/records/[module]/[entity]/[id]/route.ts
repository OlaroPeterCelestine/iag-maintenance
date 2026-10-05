/** /api/records/:module/:entity/:id — single-record verbs. */
import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled, unmappedMode } from "@/lib/iag/config";
import { legacyProxy } from "@/lib/iag/legacy";
import { recordFailure } from "@/lib/iag/records/failure";
import { adapterFor } from "@/lib/iag/records/registry";
import type { AdapterContext, AppRecord } from "@/lib/iag/records/types";
import { resolvePrincipal } from "@/lib/server-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = {
  params: Promise<{ module: string; entity: string; id: string }>;
};

async function resolve(request: NextRequest, params: Params["params"]) {
  const { module, entity, id } = await params;
  const ctx: AdapterContext = {
    module,
    entity,
    query: request.nextUrl.searchParams,
  };
  return { ctx, id, adapter: adapterFor(module, entity) };
}

function unmapped(request: NextRequest) {
  if (unmappedMode() === "empty") {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  return legacyProxy(request);
}

export async function GET(request: NextRequest, { params }: Params) {
  if (!adapterEnabled()) return legacyProxy(request);
  const { ctx, id, adapter } = await resolve(request, params);
  if (!adapter) return unmapped(request);
  if (!(await resolvePrincipal(request))) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  try {
    // No per-item upstream contract in the adapter interface — the collection
    // is small enough in every mapped case to filter here.
    const records = await adapter.list(ctx);
    const found = records.find((row) => String(row.id) === id);
    if (!found) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data: found });
  } catch (err) {
    return recordFailure(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  if (!adapterEnabled()) return legacyProxy(request);
  const { ctx, id, adapter } = await resolve(request, params);
  if (!adapter) return unmapped(request);
  if (!(await resolvePrincipal(request))) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  if (!adapter.update) {
    return NextResponse.json(
      { ok: false, error: `${ctx.module}/${ctx.entity} is read-only upstream` },
      { status: 405 },
    );
  }

  try {
    const patch = (await request.json()) as AppRecord;
    const updated = await adapter.update(ctx, id, patch);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    return recordFailure(err);
  }
}

/**
 * Sub-verbs on a collection item — the Go API exposes
 * `POST /api/records/:module/:entity/import-csv`, which lands here with
 * id="import-csv". Nothing in the adapter contract models bulk import, so this
 * always goes to the legacy API.
 */
export async function POST(request: NextRequest) {
  return legacyProxy(request);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  if (!adapterEnabled()) return legacyProxy(request);
  const { ctx, id, adapter } = await resolve(request, params);
  if (!adapter) return unmapped(request);
  if (!(await resolvePrincipal(request))) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  if (!adapter.remove) {
    return NextResponse.json(
      { ok: false, error: `${ctx.module}/${ctx.entity} cannot be deleted upstream` },
      { status: 405 },
    );
  }

  try {
    await adapter.remove(ctx, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return recordFailure(err);
  }
}