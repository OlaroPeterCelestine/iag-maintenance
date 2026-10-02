import { NextResponse } from "next/server";
import { TOOL_SLUG } from "@/lib/tool-identity";

function goBase(): string {
  return (
    process.env.GO_API_URL?.trim() ||
    "https://api-production-b0c8d.up.railway.app"
  ).replace(/\/$/, "");
}

function apiKey(): string {
  return (
    process.env.API_KEY?.trim() ||
    process.env.TOOLS_ACTIVITY_KEY?.trim() ||
    ""
  );
}

/**
 * Shared activity for this standalone tool. Browser never sees API_KEY.
 * GET lists every user on this tool; POST writes page views, CRUD, field diffs.
 */
export async function GET(request: Request) {
  const key = apiKey();
  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "API_KEY is not set on this Vercel project. Add the same key as the Go API so Activity logs can show every user.",
      },
      { status: 503 },
    );
  }

  const incoming = new URL(request.url);
  const params = new URLSearchParams(incoming.search);
  params.set("tool", TOOL_SLUG);
  if (!params.get("limit")) params.set("limit", "1000");

  try {
    const res = await fetch(`${goBase()}/api/activity/tools?${params}`, {
      cache: "no-store",
      headers: { "X-API-Key": key },
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Could not reach activity API",
      },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const key = apiKey();
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "API_KEY is not set; activity was not stored." },
      { status: 503 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const meta =
    body.meta && typeof body.meta === "object"
      ? { ...(body.meta as Record<string, unknown>), tool: TOOL_SLUG }
      : { tool: TOOL_SLUG };

  try {
    const res = await fetch(`${goBase()}/api/activity/tools`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": key,
      },
      body: JSON.stringify({ ...body, meta }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({}));
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Could not reach activity API",
      },
      { status: 502 },
    );
  }
}
