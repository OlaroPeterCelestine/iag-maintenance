/**
 * /api/records/:module/:entity/:id/:action — a verb on one record.
 *
 * The app's record contract is create, update and delete, which is everything a
 * generic store can do and much less than a real service does. Warehouse posts
 * receipts and issues, approves counts and authorises slips; none of those is a
 * field on the resource and none could be expressed here.
 *
 * The consequence was not abstract. Receipts and issues are created in `draft`,
 * stock moves only on `POST /:resource/:id/post`, and with no way to call that
 * verb the Stock In and Stock Out screens recorded documents that moved nothing
 * while write-offs and stocktakes moved stock immediately. The app's own stock
 * figures disagreed with each other and nothing surfaced it.
 *
 * Actions are declared by the adapter (see RecordAction) and advertised to the
 * browser on the collection GET, so the UI offers exactly the verbs that exist
 * rather than a hard-coded list per screen.
 */
import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled } from "@/lib/iag/config";
import { legacyProxy } from "@/lib/iag/legacy";
import { recordFailure } from "@/lib/iag/records/failure";
import { adapterFor } from "@/lib/iag/records/registry";
import type { AdapterContext } from "@/lib/iag/records/types";
import { resolvePrincipal } from "@/lib/server-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = {
  params: Promise<{ module: string; entity: string; id: string; action: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  // With the adapter off this path belongs to the legacy API, which has its own
  // sub-verbs on this shape (import-csv and friends).
  if (!adapterEnabled()) return legacyProxy(request);

  const { module, entity, id, action } = await params;
  const adapter = adapterFor(module, entity);
  if (!adapter) return legacyProxy(request);

  if (!(await resolvePrincipal(request))) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const verb = (adapter.actions || []).find((candidate) => candidate.id === action);
  if (!verb) {
    // Not an error the user caused, and not something to proxy: an adapter-owned
    // collection with an unknown verb is a bug in the caller, and saying which
    // verbs exist is more use than a bare 404.
    const known = (adapter.actions || []).map((a) => a.id).join(", ") || "none";
    return NextResponse.json(
      { ok: false, error: `${module}/${entity} has no "${action}" action (available: ${known})` },
      { status: 404 },
    );
  }

  const ctx: AdapterContext = {
    module,
    entity,
    query: request.nextUrl.searchParams,
  };

  try {
    const record = await verb.run(ctx, id);
    return NextResponse.json({ ok: true, data: record });
  } catch (err) {
    return recordFailure(err);
  }
}
