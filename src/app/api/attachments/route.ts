/**
 * POST /api/attachments — store a file and hand back a reference.
 *
 * This endpoint did not exist. `record-attachments.ts` has always posted here,
 * `attachmentHref` has always linked to `/api/attachments/:id`, and neither a
 * route handler nor a rewrite was ever registered — `goApiRewrites` in
 * next.config names `settings`, `kv`, `drafts` and the rest, and never
 * `attachments`. So every attachments field on this tab was a control that
 * could not complete: production orders, roast batches, batch records,
 * packaging runs and bills of materials. A 404 is not retryable, so the user
 * got a hard upload error with nowhere to go.
 *
 * Ported from iag-inventory, which serves the same contract against the same
 * document service.
 *
 * It is served from iag-dms rather than the legacy Go API because iag-dms is
 * where object storage lives on this platform, and because in platform mode the
 * legacy API answers 401 to everything anyway.
 *
 * Contract, unchanged from what the client already sends and expects:
 *   in   { module?, entity?, recordId?, files: [{ name, mime, dataUrl }] }
 *   out  { ok: true, data: [{ storageId, name, mime, size, uploadedAt }] }
 *
 * The bytes arrive as a base64 data URL because the browser reads the file to
 * validate it (extension and MIME allowlist, size caps) before sending. They
 * are decoded here and forwarded to DMS as the multipart upload it expects, so
 * the file never sits in a database column.
 */
import { NextResponse, type NextRequest } from "next/server";
import { GatewayError, gatewayRaw } from "@/lib/iag/gateway";
import { resolvePrincipal } from "@/lib/server-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Mirrors ATTACHMENT_MAX_BYTES in src/lib/record-attachments.ts. */
const MAX_BYTES = 1_500_000;

type IncomingFile = { name?: string; mime?: string; dataUrl?: string };
type Body = {
  module?: string;
  entity?: string;
  recordId?: string;
  files?: IncomingFile[];
};

/** Decode a `data:<mime>;base64,<payload>` URL, or return null if it is not one. */
function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } | null {
  // `[\s\S]` rather than the `s` flag — the build targets an older ES level.
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const [, mime, isBase64, payload] = match;
  try {
    const bytes = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { mime, bytes };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!(await resolvePrincipal(request))) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const files = Array.isArray(body.files) ? body.files : [];
  if (!files.length) {
    return NextResponse.json({ ok: false, error: "No file was sent." }, { status: 400 });
  }

  const stored: Array<Record<string, unknown>> = [];
  try {
    for (const file of files) {
      const name = (file.name || "attachment").trim();
      const decoded = decodeDataUrl(file.dataUrl || "");
      if (!decoded) {
        return NextResponse.json(
          { ok: false, error: `“${name}” could not be read — the upload was not a data URL.` },
          { status: 400 },
        );
      }
      if (decoded.bytes.byteLength > MAX_BYTES) {
        return NextResponse.json(
          { ok: false, error: `“${name}” is larger than the 1.5 MB limit.` },
          { status: 413 },
        );
      }

      const form = new FormData();
      form.set(
        "file",
        new Blob([new Uint8Array(decoded.bytes)], { type: file.mime || decoded.mime }),
        name,
      );
      // ownerType/ownerId let DMS list a record's attachments later. The record
      // may not have an id yet — a file attached while composing a new record —
      // and that is fine: the reference is stored on the record either way.
      form.set("ownerType", [body.module, body.entity].filter(Boolean).join(":") || "production");
      form.set("ownerId", body.recordId || "");

      // Content-Type is left unset on purpose: fetch derives the multipart
      // boundary from the FormData, and naming it by hand produces a boundary
      // that does not match the body.
      const res = await gatewayRaw({
        service: "dms",
        path: "/v1/attachments",
        method: "POST",
        body: form,
      });
      const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        const detail =
          (payload && typeof payload.error === "string" && payload.error) ||
          `Document service refused the upload (${res.status}).`;
        return NextResponse.json({ ok: false, error: detail }, { status: res.status });
      }

      const row = (payload?.data as Record<string, unknown>) || payload || {};
      const id = String(row.id ?? row.ID ?? "");
      stored.push({
        id,
        storageId: id,
        name: String(row.filename ?? name),
        mime: String(row.contentType ?? row.content_type ?? file.mime ?? decoded.mime),
        size: Number(row.size ?? decoded.bytes.byteLength),
        uploadedAt: String(row.uploadedAt ?? row.created_at ?? new Date().toISOString()),
      });
    }
  } catch (err) {
    if (err instanceof GatewayError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, data: stored });
}
