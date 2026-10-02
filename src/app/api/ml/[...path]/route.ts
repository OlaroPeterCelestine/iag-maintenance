import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mlBase() {
  return (process.env.ML_API_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
}

async function proxy(req: NextRequest, pathParts: string[]) {
  // Analytics / ML is admin-only in the product UI — never let any signed-in
  // role reach every upstream ML endpoint through this open proxy.
  const auth = await requireApiAdmin(req);
  if ("response" in auth) return auth.response;

  const base = mlBase();
  const suffix = pathParts.map(encodeURIComponent).join("/");
  const url = new URL(req.url);
  const target = `${base}/${suffix}${url.search}`;

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  // Server-owned key only — never forward a caller-supplied x-api-key.
  const apiKey = (process.env.ML_API_KEY || process.env.API_KEY || "").trim();
  if (apiKey) headers.set("x-api-key", apiKey);

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    const upstream = await fetch(target, init);
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "ML service unreachable",
        detail: err instanceof Error ? err.message : String(err),
        hint: "Start with `npm run ml:dev` or set ML_API_URL.",
      },
      { status: 502 },
    );
  }
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { path = [] } = await ctx.params;
  return proxy(req, path);
}
