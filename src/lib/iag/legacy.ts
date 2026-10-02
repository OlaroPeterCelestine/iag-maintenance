/**
 * Passthrough to the legacy Go Gin API.
 *
 * Next filesystem routes always beat `afterFiles` rewrites, so once this app
 * owns e.g. /api/records/[module]/[entity], the rewrite in next.config.ts can
 * no longer reach Go for it. Every adapter route therefore needs an explicit
 * way back — used when IAG_ADAPTER_ENABLED is off, and for the many catalog
 * entities that no IAG service owns.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  adapterEnabled,
  gatewayTimeoutMs,
  legacyApiKey,
  legacyApiOrigin,
  legacyAuthConfigured,
  legacyCredentials,
} from "@/lib/iag/config";

/** Headers that must not be forwarded verbatim to the upstream. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export function legacyConfigured(): boolean {
  return Boolean(legacyApiOrigin());
}

/**
 * Server-held Go session, cached across requests.
 *
 * Re-logging in per request would put a password round-trip in front of every
 * unmapped entity read. The token is refreshed a minute before it lapses, and
 * a failed login is not cached — otherwise one blip would black out the legacy
 * surface until the process restarted.
 */
let legacySession: { token: string; expiresAt: number } | null = null;
let legacyLoginInFlight: Promise<string> | null = null;

async function legacyLogin(): Promise<string> {
  const origin = legacyApiOrigin();
  const creds = legacyCredentials();
  if (!origin || !creds) return "";

  const res = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrUsername: creds.user,
      password: creds.password,
      keepSignedIn: true,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(gatewayTimeoutMs()),
  });

  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    data?: { token?: string; expiresAt?: string };
  } | null;

  if (!res.ok || !json?.ok || !json.data?.token) {
    throw new Error(
      `legacy login failed (${res.status}): ${json?.error || "no token returned"}`,
    );
  }

  const expiresAt = json.data.expiresAt
    ? Date.parse(json.data.expiresAt) - 60_000
    : Date.now() + 30 * 60_000;
  legacySession = { token: json.data.token, expiresAt };
  return json.data.token;
}

async function legacyBearer(): Promise<string> {
  if (legacySession && Date.now() < legacySession.expiresAt) {
    return legacySession.token;
  }
  // Collapse concurrent misses into one login.
  if (!legacyLoginInFlight) {
    legacyLoginInFlight = legacyLogin().finally(() => {
      legacyLoginInFlight = null;
    });
  }
  try {
    return await legacyLoginInFlight;
  } catch (err) {
    legacySession = null;
    console.warn("[iag/legacy]", err instanceof Error ? err.message : err);
    return "";
  }
}

/** Auth headers for the Go API, or null when no Go credential is configured. */
async function legacyAuthHeaders(): Promise<Record<string, string> | null> {
  const key = legacyApiKey();
  if (key) return { "X-API-Key": key };
  if (!legacyCredentials()) return null;
  const token = await legacyBearer();
  return token ? { Authorization: `Bearer ${token}` } : null;
}

/**
 * Forward the current request to the Go API, preserving method, body, query,
 * auth headers and status. `path` defaults to the incoming pathname.
 */
export async function legacyProxy(
  request: NextRequest,
  path?: string,
): Promise<NextResponse> {
  const origin = legacyApiOrigin();
  if (!origin) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No backend configured — set IAG_GATEWAY_ORIGIN for the platform, or GO_API_URL for the legacy API.",
      },
      { status: 503 },
    );
  }

  const target = new URL(
    `${origin}${path || request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  // The caller's credentials are for the platform, not for Go. Swap in the
  // server's own Go credential when one is configured; without it the request
  // goes through as-is and Go answers 401 — turned into an actionable 503 below.
  const legacyAuth = await legacyAuthHeaders();
  if (legacyAuth) {
    headers.delete("authorization");
    headers.delete("cookie");
    headers.delete("x-api-key");
    for (const [key, value] of Object.entries(legacyAuth)) {
      headers.set(key, value);
    }
  }

  const method = request.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD" ? undefined : await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(gatewayTimeoutMs()),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `Legacy API unreachable: ${message}` },
      { status: 504 },
    );
  }

  // A 401 here is a server misconfiguration wearing a user's error message.
  //
  // The Go API keeps its own user table and signs with its own secret, so the
  // caller's platform session means nothing to it. With no Go credential
  // configured the request goes through unauthenticated and Go replies
  // "Unauthorized. Sign in and send Authorization: Bearer <token>" — which the
  // app then shows to somebody who *is* signed in, on a screen they cannot fix
  // by signing in again. It also puts the client's 401 machinery through a
  // confirmation probe on every unmapped read.
  //
  // Answer with what is actually wrong and which variable fixes it. 503 rather
  // than 401 because the missing credential is the server's, not the user's —
  // the same status this file already returns when no backend is configured.
  if (
    (upstream.status === 401 || upstream.status === 403) &&
    adapterEnabled() &&
    !legacyAuthConfigured()
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "The shared Go API rejected this request: it has its own user table " +
          "and does not accept an IAG platform session. Set API_KEY or GO_API_KEY (or " +
          "GO_API_USER and GO_API_PASSWORD) so the server can authenticate to " +
          "it on the caller's behalf. You are signed in — this is a server " +
          "configuration gap, not a session problem.",
      },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "content-encoding") return;
    responseHeaders.set(key, value);
  });

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}