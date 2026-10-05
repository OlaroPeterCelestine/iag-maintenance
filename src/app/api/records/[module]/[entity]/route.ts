/**
 * /api/records/:module/:entity — the app's generic collection endpoint,
 * served from IAG microservices.
 *
 * The client treats a collection as one document: it GETs the whole list and
 * PUTs the whole list back with an `expectedRevision` for optimistic
 * concurrency. Real services are per-resource REST, so PUT is turned into a
 * diff — create the new, patch the changed, delete the dropped.
 */
import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled, unmappedMode } from "@/lib/iag/config";
import { legacyProxy } from "@/lib/iag/legacy";
import { recordFailure } from "@/lib/iag/records/failure";
import { adapterFor } from "@/lib/iag/records/registry";
import {
  describeActions,
  revisionFor,
  type AdapterContext,
  type AppRecord,
  type RecordAdapter,
} from "@/lib/iag/records/types";
import { resolvePrincipal } from "@/lib/server-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ module: string; entity: string }> };

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
}

/** No IAG owner for this entity — fall back per IAG_UNMAPPED_MODE. */
function unmapped(request: NextRequest) {
  if (unmappedMode() === "empty") {
    return NextResponse.json({ ok: true, data: [], revision: "0:0" });
  }
  return legacyProxy(request);
}

async function context(
  request: NextRequest,
  params: Params["params"],
): Promise<AdapterContext> {
  const { module, entity } = await params;
  return {
    module,
    entity,
    query: request.nextUrl.searchParams,
  };
}

export async function GET(request: NextRequest, { params }: Params) {
  if (!adapterEnabled()) return legacyProxy(request);
  const ctx = await context(request, params);
  const adapter = adapterFor(ctx.module, ctx.entity);
  if (!adapter) return unmapped(request);

  if (!(await resolvePrincipal(request))) return unauthorized();

  try {
    const records = await adapter.list(ctx);
    const revision = revisionFor(records);

    // Cheap 304 — the client sends its last known revision as If-None-Match.
    if (request.headers.get("if-none-match") === revision) {
      return new NextResponse(null, { status: 304 });
    }

    // Tell the client what this collection can actually do.
    //
    // The adapter has always known — `readOnly`, and the absence of a create or
    // remove verb — but nothing carried it to the browser, so New / Edit /
    // Delete were drawn from RBAC alone. A storekeeper holding add_receipt
    // could open a ten-field form on a read-only screen, fill every required
    // field, and only be refused on save. Permission and capability are
    // different questions and the UI needs the answer to both.
    return NextResponse.json(
      {
        ok: true,
        data: records,
        revision,
        capabilities: {
          create: Boolean(adapter.create),
          update: Boolean(adapter.update),
          delete: Boolean(adapter.remove),
          // Verbs beyond CRUD, so a screen offers exactly the ones its own
          // service has rather than a list hard-coded per screen. `run` is
          // stripped — it is a server-side call, not something to hand out.
          actions: describeActions(adapter),
        },
      },
      { headers: { ETag: revision } },
    );
  } catch (err) {
    return recordFailure(err);
  }
}

/** Fields that are bookkeeping, not content — ignored when diffing. */
const META_FIELDS = new Set(["id", "createdAt", "updatedAt"]);

function changed(next: AppRecord, prev: AppRecord): boolean {
  for (const [key, value] of Object.entries(next)) {
    if (META_FIELDS.has(key)) continue;
    if ((prev[key] ?? "") !== (value ?? "")) return true;
  }
  return false;
}

type PutBody = {
  records?: AppRecord[];
  expectedRevision?: string;
  allowEmpty?: boolean;
};

export async function PUT(request: NextRequest, { params }: Params) {
  if (!adapterEnabled()) return legacyProxy(request);
  const ctx = await context(request, params);
  const adapter = adapterFor(ctx.module, ctx.entity);
  if (!adapter) return unmapped(request);

  if (!(await resolvePrincipal(request))) return unauthorized();

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const incoming = Array.isArray(body.records) ? body.records : [];

  try {
    const current = await adapter.list(ctx);
    const currentRevision = revisionFor(current);

    if (body.expectedRevision && body.expectedRevision !== currentRevision) {
      return NextResponse.json(
        {
          ok: false,
          code: "REVISION_CONFLICT",
          error: "Collection changed in another session",
          revision: currentRevision,
          data: current,
        },
        { status: 409 },
      );
    }

    if (!incoming.length && current.length && !body.allowEmpty) {
      return NextResponse.json(
        {
          ok: false,
          error: `Refused to clear ${ctx.module}/${ctx.entity} — upstream still has ${current.length} row(s).`,
          revision: currentRevision,
          data: current,
        },
        { status: 409 },
      );
    }

    const result = await applyDiff(adapter, ctx, current, incoming, {
      allowEmpty: Boolean(body.allowEmpty),
    });

    const after = await adapter.list(ctx);
    return NextResponse.json({
      ok: true,
      data: after,
      revision: revisionFor(after),
      applied: result,
    });
  } catch (err) {
    return recordFailure(err);
  }
}

async function applyDiff(
  adapter: RecordAdapter,
  ctx: AdapterContext,
  current: AppRecord[],
  incoming: AppRecord[],
  options: { allowEmpty: boolean },
): Promise<{ created: number; updated: number; deleted: number; skipped: string[] }> {
  const byId = new Map(current.map((row) => [String(row.id), row]));
  const seen = new Set<string>();
  const skipped: string[] = [];
  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const record of incoming) {
    const id = String(record.id || "");
    const existing = id ? byId.get(id) : undefined;

    if (existing) {
      seen.add(id);
      if (!changed(record, existing)) continue;
      if (!adapter.update) {
        skipped.push(`update:${id}`);
        continue;
      }
      await adapter.update(ctx, id, record);
      updated += 1;
      continue;
    }

    if (!adapter.create) {
      skipped.push(`create:${id || "(new)"}`);
      continue;
    }
    await adapter.create(ctx, record);
    created += 1;
  }

  // Rows the client dropped. Only delete when it can actually be undone by a
  // re-create, i.e. the adapter supports both verbs.
  if (adapter.remove && (incoming.length > 0 || options.allowEmpty)) {
    for (const [id] of byId) {
      if (seen.has(id)) continue;
      await adapter.remove(ctx, id);
      deleted += 1;
    }
  } else {
    for (const [id] of byId) {
      if (!seen.has(id)) skipped.push(`delete:${id}`);
    }
  }

  return { created, updated, deleted, skipped };
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!adapterEnabled()) return legacyProxy(request);
  const ctx = await context(request, params);
  const adapter = adapterFor(ctx.module, ctx.entity);
  if (!adapter) return unmapped(request);

  if (!(await resolvePrincipal(request))) return unauthorized();
  if (!adapter.create) {
    return NextResponse.json(
      { ok: false, error: `${ctx.module}/${ctx.entity} is read-only upstream` },
      { status: 405 },
    );
  }

  try {
    const record = (await request.json()) as AppRecord;
    const created = await adapter.create(ctx, record);
    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (err) {
    return recordFailure(err);
  }
}