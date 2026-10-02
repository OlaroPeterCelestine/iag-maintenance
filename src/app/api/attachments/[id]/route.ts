/**
 * GET /api/attachments/:id — stream a stored file back.
 *
 * `attachmentHref` links here for every record that carries a stored
 * attachment. Proxied rather than redirected: the file lives behind the
 * platform gateway and needs the caller's bearer, which only the server holds
 * — a redirect would send the browser somewhere it cannot authenticate.
 */
import { NextResponse, type NextRequest } from "next/server";
import { GatewayError, gatewayRaw } from "@/lib/iag/gateway";
import { resolvePrincipal } from "@/lib/server-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  if (!(await resolvePrincipal(request))) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }
  const { id } = await params;

  let res: Response;
  try {
    res = await gatewayRaw({
      service: "dms",
      path: `/v1/attachments/${encodeURIComponent(id)}/download`,
    });
  } catch (err) {
    const status = err instanceof GatewayError ? 502 : 500;
    const message = err instanceof Error ? err.message : "Download failed";
    return NextResponse.json({ ok: false, error: message }, { status });
  }

  if (!res.ok || !res.body) {
    return NextResponse.json(
      { ok: false, error: `That file could not be fetched (${res.status}).` },
      { status: res.status === 404 ? 404 : 502 },
    );
  }

  // Carry the upstream's own content type and filename through, so the browser
  // shows a PDF inline and names a download what the uploader called it.
  const headers = new Headers();
  for (const header of ["content-type", "content-length", "content-disposition"]) {
    const value = res.headers.get(header);
    if (value) headers.set(header, value);
  }
  headers.set("Cache-Control", "private, max-age=300");
  return new NextResponse(res.body, { status: 200, headers });
}
