/**
 * JWT access token for Go API (Authorization: Bearer …).
 * Tab memory only — durable auth is the httpOnly cookie `financeiag_at`
 * set by the Go login handler. Nothing lands in localStorage / sessionStorage.
 */
import { getMemorySetting } from "@/lib/db/client-store";
import { FRONTEND_ONLY } from "@/lib/frontend-only";

/** Legacy key names — scrubbed on boot; never written again. */
const TOKEN_KEY = "financeiag-api-token";
const TOKEN_EXPIRES_KEY = "financeiag-api-token-expires";
const LOGIN_GRACE_UNTIL_KEY = "financeiag-login-grace-until";

let memoryToken: string | null = null;
let memoryTokenExpiresAt: string | null = null;
let handlingUnauthorized = false;
let probeAuthCache: { ok: boolean; at: number } | null = null;
const PROBE_AUTH_TTL_MS = 60_000;
/** Wall clock when setApiToken last ran — suppresses hydrate 401 bounce right after login. */
let lastLoginTokenAt = 0;
/**
 * Cover full AppShell hydrate (many parallel /api calls) after login.
 * Remote Postgres over Railway proxies can take >45s on cold paths.
 */
const LOGIN_AUTH_GRACE_MS = 120_000;
/**
 * Bumped on every setApiToken / forceClear so an in-flight probe started before
 * login cannot overwrite the post-login cache with a stale 401.
 */
let authEpoch = 0;

function scrubLegacyTokenStorage() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRES_KEY);
    sessionStorage.removeItem(LOGIN_GRACE_UNTIL_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRES_KEY);
  } catch {
    /* private mode */
  }
}

function readGraceUntil(): number {
  if (typeof window === "undefined") return 0;
  if (lastLoginTokenAt) return lastLoginTokenAt + LOGIN_AUTH_GRACE_MS;
  return 0;
}

export function setApiToken(token: string, expiresAt?: string) {
  if (typeof window === "undefined") return;
  // Treat a freshly issued login token as authenticated immediately so an
  // in-flight login-page probe cannot cache "false" and wipe the session.
  authEpoch += 1;
  lastLoginTokenAt = Date.now();
  probeAuthCache = { ok: true, at: lastLoginTokenAt };
  handlingUnauthorized = false;
  memoryToken = token;
  memoryTokenExpiresAt = expiresAt || null;
  scrubLegacyTokenStorage();
}

export function clearApiToken() {
  if (typeof window === "undefined") return;
  // Never drop a just-issued token during the post-login grace window.
  // Soft restore / flaky 401 paths must wait; intentional logout uses clearAuthSession
  // after grace ends, or forceClearApiToken().
  if (isWithinLoginGrace()) return;
  forceClearApiToken();
}

/**
 * Drop a stale tab Bearer while keeping login grace + cookie session.
 * Used when the httpOnly cookie alone authenticates successfully.
 */
export function clearStaleBearerToken() {
  if (typeof window === "undefined") return;
  memoryToken = null;
  memoryTokenExpiresAt = null;
  scrubLegacyTokenStorage();
}

/** Unconditional token wipe (logout / confirmed unauthorized). */
export function forceClearApiToken() {
  if (typeof window === "undefined") return;
  authEpoch += 1;
  probeAuthCache = null;
  lastLoginTokenAt = 0;
  memoryToken = null;
  memoryTokenExpiresAt = null;
  scrubLegacyTokenStorage();
}

export function getApiToken(): string | null {
  if (typeof window === "undefined") return null;
  return memoryToken;
}

/** True for a short window after login — hydrate/restore must not wipe the session. */
export function isWithinLoginGrace(): boolean {
  return readGraceUntil() > Date.now();
}

/** Headers for authenticated /api calls (Bearer JWT). */
export function authHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {
    ...(extra as Record<string, string> | undefined),
  };
  const token = getApiToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

type MeStatus = "ok" | "unauthorized" | "unknown";

type ProbeOptions = {
  /** Allow probing while handleApiUnauthorized is confirming loss. */
  allowDuringUnauthorized?: boolean;
};

/**
 * Hit /api/auth/me with Bearer, then cookie-only on 401.
 * Also reports whether cookie alone rescued a stale Bearer (so callers can drop it).
 */
async function fetchAuthMeStatus(token: string | null): Promise<{
  status: MeStatus;
  cookieRescued: boolean;
}> {
  try {
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let res = await fetch("/api/auth/me", {
      credentials: "same-origin",
      cache: "no-store",
      headers,
    });
    let cookieRescued = false;
    if (res.status === 401 && token) {
      res = await fetch("/api/auth/me", {
        credentials: "same-origin",
        cache: "no-store",
      });
      cookieRescued = res.ok;
    }
    if (res.ok) return { status: "ok", cookieRescued };
    if (res.status === 401) return { status: "unauthorized", cookieRescued: false };
    return { status: "unknown", cookieRescued: false };
  } catch {
    return { status: "unknown", cookieRescued: false };
  }
}

/** Abort signal that fires after ms, when the runtime supports it. */
function timeoutSignal(ms?: number): AbortSignal | undefined {
  if (!ms || ms <= 0) return undefined;
  try {
    return AbortSignal.timeout(ms);
  } catch {
    return undefined;
  }
}

/**
 * Prove the browser can call a data route (Go via rewrite when configured).
 * `timeoutMs` keeps a cold/hung API from holding the caller open indefinitely.
 */
export async function probeDataAccess(
  token: string | null,
  options?: { timeoutMs?: number },
): Promise<{
  status: MeStatus;
  cookieRescued: boolean;
}> {
  try {
    const headers = new Headers();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let res = await fetch("/api/sync/status", {
      credentials: "same-origin",
      cache: "no-store",
      headers,
      signal: timeoutSignal(options?.timeoutMs),
    });
    let cookieRescued = false;
    if (res.status === 401 && token) {
      res = await fetch("/api/sync/status", {
        credentials: "same-origin",
        cache: "no-store",
        signal: timeoutSignal(options?.timeoutMs),
      });
      cookieRescued = res.ok;
    }
    if (res.ok) return { status: "ok", cookieRescued };
    if (res.status === 401) return { status: "unauthorized", cookieRescued: false };
    return { status: "unknown", cookieRescued: false };
  } catch {
    return { status: "unknown", cookieRescued: false };
  }
}

/**
 * After login: confirm data routes accept the new JWT/cookie.
 *
 * `budgetMs` caps the whole check so a cold API cannot hold the sign-in button.
 * A false result is not proof of failure — `setApiToken` already opened the
 * login grace window, so callers may proceed and let the shell hydrate.
 */
export async function waitForDataAccess(options?: {
  attempts?: number;
  delayMs?: number;
  budgetMs?: number;
  timeoutMs?: number;
}): Promise<boolean> {
  if (FRONTEND_ONLY) return true;
  if (typeof window === "undefined") return false;
  const attempts = Math.max(1, options?.attempts ?? 8);
  const delayMs = Math.max(50, options?.delayMs ?? 250);
  const budgetMs = Math.max(0, options?.budgetMs ?? 0);
  const timeoutMs = Math.max(0, options?.timeoutMs ?? 0);
  const deadline = budgetMs ? Date.now() + budgetMs : 0;
  for (let i = 0; i < attempts; i += 1) {
    const data = await probeDataAccess(getApiToken(), { timeoutMs });
    if (data.status === "ok") {
      if (data.cookieRescued) clearStaleBearerToken();
      probeAuthCache = { ok: true, at: Date.now() };
      return true;
    }
    if (i < attempts - 1) {
      if (deadline && Date.now() + delayMs >= deadline) return false;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

function sessionIsBrandNew(): boolean {
  try {
    // Prefer in-memory session (no sessionStorage). Fall back to login grace clock.
    if (lastLoginTokenAt && Date.now() - lastLoginTokenAt < 120_000) return true;
    const parsed = getMemorySetting<{ at?: number } | null>("financeiag-session", null);
    if (!parsed?.at) return false;
    const ageMs = Date.now() - parsed.at;
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 120_000;
  } catch {
    return false;
  }
}

/**
 * Confirm the session is actually gone via /api/auth/me + a data route.
 * Returns true only on confirmed 401 — never on network/5xx blips.
 */
export async function confirmAuthLost(): Promise<boolean> {
  if (isWithinLoginGrace() || sessionIsBrandNew()) return false;

  const token = getApiToken();
  const firstMe = await fetchAuthMeStatus(token);
  if (firstMe.status !== "unauthorized" || isWithinLoginGrace()) return false;

  await new Promise((r) => setTimeout(r, 400));
  if (isWithinLoginGrace()) return false;

  const secondMe = await fetchAuthMeStatus(getApiToken());
  if (secondMe.status !== "unauthorized") return false;

  // Require a data route to agree — /me alone used to false-positive during races.
  const data = await probeDataAccess(getApiToken());
  return data.status === "unauthorized";
}

/**
 * On confirmed 401: clear local session once and send the user to login.
 * A single flaky hydrate 401 must not revoke a still-valid JWT/cookie.
 */
async function handleApiUnauthorized() {
  if (typeof window === "undefined" || handlingUnauthorized) return;
  // Fresh login grace: ignore stray 401s from hydrate races right after login.
  if (isWithinLoginGrace() || sessionIsBrandNew()) {
    return;
  }
  handlingUnauthorized = true;
  try {
    const lost = await confirmAuthLost();
    if (!lost) {
      handlingUnauthorized = false;
      return;
    }
    const { forceSessionLogout } = await import("@/lib/auth");
    // Silent clear + hard navigate (handles token wipe + /api/auth/logout).
    forceSessionLogout("auth");
  } catch {
    handlingUnauthorized = false;
  }
}

/** True while a 401 redirect is in progress — callers should stop retrying. */
export function isHandlingUnauthorized(): boolean {
  return handlingUnauthorized;
}

/**
 * Probe whether the browser still has a valid API JWT (Bearer or cookie).
 * Does not trigger the logout redirect — callers decide what to do.
 */
export async function probeApiAuth(options?: ProbeOptions): Promise<boolean> {
  if (FRONTEND_ONLY) return true;
  if (typeof window === "undefined") return false;
  if (handlingUnauthorized && !options?.allowDuringUnauthorized) return false;

  const token = getApiToken();
  const epochAtStart = authEpoch;

  // Positive cache is fine. Negative cache must not stick after a fresh login
  // token appears (login page probes before submit, then AppShell restores).
  if (probeAuthCache && Date.now() - probeAuthCache.at < PROBE_AUTH_TTL_MS) {
    if (probeAuthCache.ok) return true;
    if (!token && !isWithinLoginGrace()) return false;
  }

  // Right after login, trust the token and only soft-check data access.
  if (isWithinLoginGrace() && token) {
    const data = await probeDataAccess(token);
    if (epochAtStart !== authEpoch) {
      return Boolean(getApiToken());
    }
    if (data.status === "ok") {
      if (data.cookieRescued) clearStaleBearerToken();
      probeAuthCache = { ok: true, at: Date.now() };
      return true;
    }
    // During grace, never cache a hard failure — hydrate may still be catching up.
    probeAuthCache = { ok: true, at: Date.now() };
    return true;
  }

  const me = await fetchAuthMeStatus(token);
  if (epochAtStart !== authEpoch) {
    return Boolean(getApiToken()) || me.status === "ok";
  }
  if (me.status === "unauthorized") {
    probeAuthCache = { ok: false, at: Date.now() };
    return false;
  }
  if (me.status === "unknown") {
    return Boolean(token);
  }

  const data = await probeDataAccess(token);
  if (epochAtStart !== authEpoch) {
    return Boolean(getApiToken());
  }
  if (data.status === "ok") {
    if (me.cookieRescued || data.cookieRescued) {
      clearStaleBearerToken();
    }
    probeAuthCache = { ok: true, at: Date.now() };
    return true;
  }
  if (data.status === "unauthorized") {
    probeAuthCache = { ok: false, at: Date.now() };
    return false;
  }
  // Data probe unknown but me ok — allow through (transient).
  probeAuthCache = { ok: true, at: Date.now() };
  return true;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  if (FRONTEND_ONLY) {
    return new Response(JSON.stringify({ ok: true, data: [], rows: [], records: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (handlingUnauthorized) {
    return new Response(JSON.stringify({ ok: false, error: "Sign in required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { timeoutMs: timeoutOpt, ...fetchInit } = init || {};
  // Default 25s so hung TCP cannot freeze the UI forever. Pass timeoutMs: 0 to disable.
  const timeoutMs =
    typeof timeoutOpt === "number" ? timeoutOpt : 25_000;

  const headers = new Headers(fetchInit.headers || {});
  const token = getApiToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const doFetch = (signal?: AbortSignal) =>
    fetch(input, {
      ...fetchInit,
      headers,
      credentials: fetchInit.credentials ?? "same-origin",
      ...(signal ? { signal } : fetchInit.signal ? { signal: fetchInit.signal } : {}),
    });

  const withTimeout = async (): Promise<Response> => {
    if (!timeoutMs || timeoutMs <= 0 || fetchInit.signal) {
      return doFetch(fetchInit.signal ?? undefined);
    }
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        return new Response(
          JSON.stringify({ ok: false, error: "Request timed out" }),
          { status: 504, headers: { "Content-Type": "application/json" } },
        );
      }
      throw err;
    } finally {
      globalThis.clearTimeout(timer);
    }
  };

  let res = await withTimeout();

  if (res.status === 401 && token && headers.has("Authorization")) {
    // Retry once with the httpOnly cookie only — keep Bearer until cookie proves
    // the tab token is stale (avoids wiping a fresh login on a single flaky 401).
    headers.delete("Authorization");
    const cookieRes = await withTimeout();
    if (cookieRes.ok || cookieRes.status !== 401) {
      // Cookie worked — drop stale Bearer even during grace (cookie is enough).
      clearStaleBearerToken();
      res = cookieRes;
    } else {
      // Both failed — do NOT clear yet; confirm via /api/auth/me first.
      res = cookieRes;
    }
  }

  if (res.status === 401) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : "";
    // Never bounce on login/logout/health/me/ready themselves.
    if (
      !/\/api\/auth\/(login|logout|me)\b/.test(url) &&
      !/\/api\/health\b/.test(url) &&
      !/\/api\/sync\/(status|ready)\b/.test(url)
    ) {
      void handleApiUnauthorized();
    }
  }
  return res;
}
