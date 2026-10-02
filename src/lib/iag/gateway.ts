/**
 * Server-side HTTP client for the IAG API gateway.
 *
 * Every call carries the caller's platform bearer (Bearer + `aud` trust model —
 * the gateway checks the audience, the service re-checks it). On 401 we refresh
 * once with the stored refresh token and retry, because Railway services expire
 * tokens well inside a long-lived app session.
 */
import { cookies } from "next/headers";
import { expirySecondsFromString, keepSignedInExpiry } from "@/lib/server-jwt";
import {
  PLATFORM_REFRESH_COOKIE,
  PLATFORM_TOKEN_COOKIE,
  SERVICE_PREFIX,
  gatewayOrigin,
  gatewayTimeoutMs,
  oauthClient,
  type ServiceKey,
} from "@/lib/iag/config";

export class GatewayError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.body = body;
  }
}

export type GatewayRequest = {
  service: ServiceKey;
  /** Path below the service prefix, e.g. "/v1/invoices". */
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Explicit bearer; defaults to the platform token cookie. */
  token?: string | null;
  /** Skip the refresh-and-retry dance (used by the refresh call itself). */
  noRefresh?: boolean;
  signal?: AbortSignal;
};

function buildUrl(req: GatewayRequest): string {
  const origin = gatewayOrigin();
  if (!origin) {
    throw new GatewayError(
      503,
      "IAG_GATEWAY_ORIGIN is not configured — cannot reach the platform gateway",
    );
  }
  const prefix = SERVICE_PREFIX[req.service]().replace(/\/+$/, "");
  const path = req.path.startsWith("/") ? req.path : `/${req.path}`;
  const url = new URL(`${origin}${prefix}${path}`);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Refreshed tokens, keyed by the refresh token that produced them.
 *
 * The platform access token lives for minutes; the app session for days. Once
 * the access token in `iag_pt` has expired, every gateway call would 401,
 * refresh, and retry — one refresh grant per call, ~20 per page load, and
 * with a rotating refresh token every grant after the first fails. The
 * gateway's /oauth/token budget is shared across the platform's clients, so
 * one user with a stale cookie could exhaust logins for everyone.
 *
 * So a refresh is done once per refresh token per process (single-flight
 * while in flight, cached until the new access token is near expiry), the
 * result is written back to the cookies where the runtime allows it, and a
 * failed refresh is not retried for a cool-down.
 */
type Refreshed = { access: string; refresh: string; expiresAt: number };
const refreshed = new Map<string, Refreshed>();
const refreshInFlight = new Map<string, Promise<TokenResponse | null>>();
const refreshFailedAt = new Map<string, number>();
const REFRESH_FAIL_COOLDOWN_MS = 30_000;
const REFRESH_SKEW_MS = 30_000;
const REFRESH_CACHE_MAX = 500;

function tokenExpiryMs(token: string): number {
  const part = token.split(".")[1];
  if (!part) return 0;
  try {
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function tokenLooksLive(token: string): boolean {
  const exp = tokenExpiryMs(token);
  return exp === 0 || exp - REFRESH_SKEW_MS > Date.now();
}

function remember(oldRefresh: string, tokens: TokenResponse) {
  if (refreshed.size >= REFRESH_CACHE_MAX) {
    const oldest = refreshed.keys().next().value;
    if (oldest !== undefined) refreshed.delete(oldest);
  }
  const entry: Refreshed = {
    access: tokens.access_token,
    refresh: tokens.refresh_token || oldRefresh,
    expiresAt:
      tokenExpiryMs(tokens.access_token) ||
      Date.now() + (tokens.expires_in && tokens.expires_in > 0 ? tokens.expires_in : 3600) * 1000,
  };
  // Keyed by the token the cookie still carries AND by the rotated one, so a
  // request arriving with either finds the same live access token.
  refreshed.set(oldRefresh, entry);
  if (entry.refresh !== oldRefresh) refreshed.set(entry.refresh, entry);
}

/** Best effort: only a route handler may set cookies, and only before it streams. */
async function persistRefreshed(entry: Refreshed) {
  try {
    const jar = await cookies();
    const maxAge = Math.max(60, Math.floor((entry.expiresAt - Date.now()) / 1000));
    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
    };
    jar.set(PLATFORM_TOKEN_COOKIE, entry.access, { ...options, maxAge });
    // A rotated refresh token replaces the cookie; it is bounded to the app
    // session length the way login bounds it (see createAppSession).
    if (jar.get(PLATFORM_REFRESH_COOKIE)?.value !== entry.refresh) {
      jar.set(PLATFORM_REFRESH_COOKIE, entry.refresh, {
        ...options,
        maxAge: expirySecondsFromString(keepSignedInExpiry()),
      });
    }
  } catch {
    // Server component, streamed response, or middleware — the in-memory
    // cache still serves this instance until the next route handler persists.
  }
}

async function readRefreshToken(): Promise<string | null> {
  try {
    const jar = await cookies();
    return jar.get(PLATFORM_REFRESH_COOKIE)?.value || null;
  } catch {
    return null;
  }
}

async function readPlatformToken(): Promise<string | null> {
  let cookieToken: string | null = null;
  try {
    const jar = await cookies();
    cookieToken = jar.get(PLATFORM_TOKEN_COOKIE)?.value || null;
  } catch {
    cookieToken = null;
  }
  // A refresh already done for this session on this instance wins over a
  // cookie that still carries the expired token.
  const refresh = await readRefreshToken();
  const cached = refresh ? refreshed.get(refresh) : undefined;
  if (cached && cached.expiresAt - REFRESH_SKEW_MS > Date.now()) return cached.access;
  if (cookieToken && tokenLooksLive(cookieToken)) return cookieToken;
  // Cookie token is expired and nothing cached: refresh up front rather than
  // paying a 401 round-trip first.
  if (refresh) {
    const fresh = await refreshPlatformToken();
    if (fresh?.access_token) return fresh.access_token;
  }
  return cookieToken;
}

/**
 * Reduce a string | {message|error|code|detail} | anything to a readable line.
 * Recurses one level because services wrap as `{error: {code, message}}` — a
 * non-recursive version stringifies the whole envelope into the message.
 */
function flattenError(value: unknown, depth = 0): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const rec = value as Record<string, unknown>;
  for (const key of ["message", "error_description", "detail", "error", "code"]) {
    const inner = rec[key];
    if (typeof inner === "string" && inner.trim()) return inner.trim();
    if (inner && typeof inner === "object" && depth < 2) {
      const nested = flattenError(inner, depth + 1);
      if (nested) return nested;
    }
  }
  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return "";
  }
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
};

/** POST /oauth/token — shared by password grant and refresh grant. */
export async function requestToken(
  form: Record<string, string>,
): Promise<TokenResponse> {
  const origin = gatewayOrigin();
  if (!origin) {
    throw new GatewayError(503, "IAG_GATEWAY_ORIGIN is not configured");
  }
  const client = oauthClient();
  const params = new URLSearchParams(form);
  if (client.id && !params.has("client_id")) params.set("client_id", client.id);
  if (client.secret && !params.has("client_secret")) {
    params.set("client_secret", client.secret);
  }

  const url = `${origin}${SERVICE_PREFIX.authentication()}/oauth/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(gatewayTimeoutMs()),
  });
  const json = (await res.json().catch(() => null)) as
    | (TokenResponse & { error?: unknown; error_description?: unknown; message?: unknown })
    | null;
  if (!res.ok || !json?.access_token) {
    // The auth service returns `error` as a string on OAuth failures but as an
    // object ({code, message}) on gateway/middleware rejections — flatten both
    // rather than stringifying an object into "[object Object]".
    const detail =
      flattenError(json?.error_description) ||
      flattenError(json?.error) ||
      flattenError(json?.message) ||
      `token request failed (${res.status})`;
    throw new GatewayError(res.status === 0 ? 502 : res.status, detail, json);
  }
  return json;
}

/**
 * Exchange the stored refresh token for a fresh access token — once per
 * refresh token per process. Concurrent callers share the in-flight grant; a
 * cached, still-live result is returned without a network call; a failure is
 * not retried for REFRESH_FAIL_COOLDOWN_MS.
 */
export async function refreshPlatformToken(): Promise<TokenResponse | null> {
  const refresh = await readRefreshToken();
  if (!refresh) return null;

  const cached = refreshed.get(refresh);
  if (cached && cached.expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return { access_token: cached.access, refresh_token: cached.refresh, token_type: "Bearer" };
  }
  const failedAt = refreshFailedAt.get(refresh) || 0;
  if (Date.now() - failedAt < REFRESH_FAIL_COOLDOWN_MS) return null;

  const inFlight = refreshInFlight.get(refresh);
  if (inFlight) return inFlight;

  const run = (async (): Promise<TokenResponse | null> => {
    try {
      const tokens = await requestToken({ grant_type: "refresh_token", refresh_token: refresh });
      remember(refresh, tokens);
      refreshFailedAt.delete(refresh);
      await persistRefreshed(refreshed.get(refresh)!);
      return tokens;
    } catch {
      refreshFailedAt.set(refresh, Date.now());
      return null;
    } finally {
      refreshInFlight.delete(refresh);
    }
  })();
  refreshInFlight.set(refresh, run);
  return run;
}

/** Forget any refreshed tokens for a session — logout. */
export function forgetPlatformTokens(refreshToken: string | null | undefined): void {
  if (!refreshToken) return;
  const entry = refreshed.get(refreshToken);
  refreshed.delete(refreshToken);
  if (entry) refreshed.delete(entry.refresh);
  refreshFailedAt.delete(refreshToken);
}

async function parseBody(res: Response): Promise<unknown> {
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    return res.json().catch(() => null);
  }
  const text = await res.text().catch(() => "");
  return text || null;
}

function errorMessage(status: number, body: unknown): string {
  const flattened = flattenError(body);
  if (flattened) return flattened.slice(0, 300);
  return `upstream returned ${status}`;
}

/**
 * Call a platform service. Returns the parsed body on 2xx, throws GatewayError
 * otherwise so route handlers can map status codes onto this app's envelope.
 */
export async function gatewayFetch<T = unknown>(req: GatewayRequest): Promise<T> {
  const url = buildUrl(req);
  const token = req.token !== undefined ? req.token : await readPlatformToken();

  const run = async (bearer: string | null): Promise<Response> => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    if (req.body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(url, {
      method: req.method || "GET",
      headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      cache: "no-store",
      signal: req.signal ?? AbortSignal.timeout(gatewayTimeoutMs()),
    });
  };

  let res: Response;
  try {
    res = await run(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GatewayError(504, `gateway unreachable: ${message}`);
  }

  // One refresh-and-retry on 401 — long sessions outlive the access token.
  if (res.status === 401 && !req.noRefresh) {
    const refreshed = await refreshPlatformToken();
    if (refreshed?.access_token) {
      try {
        res = await run(refreshed.access_token);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new GatewayError(504, `gateway unreachable: ${message}`);
      }
    }
  }

  const body = await parseBody(res);
  if (!res.ok) {
    throw new GatewayError(res.status, errorMessage(res.status, body), body);
  }
  return body as T;
}

/**
 * Call a platform service with a body this module must not touch, and hand back
 * the raw Response.
 *
 * `gatewayFetch` JSON-encodes everything and parses everything, which is right
 * for the record adapters and wrong for the two cases that move bytes: a
 * multipart upload, and a download that has to stream through carrying its own
 * content type. This shares the bearer and the refresh dance so those two do
 * not grow a second copy of it.
 *
 * The caller owns the response — read it, stream it, check `res.ok`. It does
 * not throw on a non-2xx, because for a download the upstream's own error body
 * is usually the thing worth forwarding.
 */
export async function gatewayRaw(
  req: Omit<GatewayRequest, "body"> & {
    body?: BodyInit;
    headers?: Record<string, string>;
  },
): Promise<Response> {
  const url = buildUrl(req as GatewayRequest);
  const token = req.token !== undefined ? req.token : await readPlatformToken();

  const run = async (bearer: string | null): Promise<Response> => {
    const headers: Record<string, string> = { ...(req.headers || {}) };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    return fetch(url, {
      method: req.method || "GET",
      headers,
      body: req.body,
      cache: "no-store",
      signal: req.signal ?? AbortSignal.timeout(gatewayTimeoutMs()),
    });
  };

  let res: Response;
  try {
    res = await run(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GatewayError(504, `gateway unreachable: ${message}`);
  }

  // Only bodiless requests are retried: replaying an upload would mean
  // re-reading a body that has already been consumed, and a half-sent file is
  // worse than a reported failure.
  if (res.status === 401 && !req.noRefresh && req.body === undefined) {
    const refreshed = await refreshPlatformToken();
    if (refreshed?.access_token) {
      res = await run(refreshed.access_token);
    }
  }
  return res;
}

/**
 * Platform responses are inconsistent: some services return a bare array, some
 * `{ data: [...] }`, some `{ items: [...] }` with pagination. Normalise to an array.
 */
export function unwrapList<T = Record<string, unknown>>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object") return [];
  const rec = payload as Record<string, unknown>;
  for (const key of ["data", "items", "results", "records", "rows"]) {
    const value = rec[key];
    if (Array.isArray(value)) return value as T[];
    // Nested envelope: { data: { items: [...] } }
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      for (const inner of ["items", "data", "results", "records", "rows"]) {
        if (Array.isArray(nested[inner])) return nested[inner] as T[];
      }
    }
  }
  return [];
}

/** Same idea for single-object responses. */
export function unwrapOne<T = Record<string, unknown>>(payload: unknown): T | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  if (Array.isArray(rec)) return (rec[0] as T) ?? null;
  const data = rec.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data as T;
  return rec as T;
}