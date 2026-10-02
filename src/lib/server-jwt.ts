/**
 * Server-side JWT (HS256) — mirrors backend/internal/httpapi/security.go claims.
 * Used by login issue + proxy / route guards.
 */
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const JWT_ISSUER = "finaceiag-api";
/** HttpOnly cookie so keep-signed-in / new tabs still authenticate /api. */
export const API_TOKEN_COOKIE = "financeiag_at";

export type ApiTokenClaims = {
  uid: string;
  email: string;
  username: string;
  /** Display name (full_name) — never use role labels here. */
  name?: string;
  role: string;
  /** JWT ID — matches auth_sessions.jti when issued with a session. */
  jti?: string;
  /** Issued-at (unix seconds) — used to pick newer of Bearer vs cookie. */
  iat?: number;
};

export type AuthPrincipal = ApiTokenClaims & {
  mode: "jwt" | "api_key";
};

function jwtSecretBytes(): Uint8Array | null {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

import { FRONTEND_ONLY } from "@/lib/frontend-only";

export function isAuthRequired(): boolean {
  if (FRONTEND_ONLY) return false;
  const flag = (process.env.AUTH_REQUIRED || "").trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  const hasSecret = Boolean(process.env.JWT_SECRET?.trim());
  // Never require auth without a secret — proxy cannot verify tokens.
  if (!hasSecret) return false;
  if (flag === "true" || flag === "1" || flag === "on") return true;
  // Default: require auth in production whenever JWT_SECRET is set.
  if (process.env.NODE_ENV === "production") return true;
  return true;
}

export function allowAuthSeed(): boolean {
  const flag = (process.env.ALLOW_AUTH_SEED || "").trim().toLowerCase();
  if (flag === "false" || flag === "0" || flag === "off") return false;
  if (flag === "true" || flag === "1" || flag === "on") return true;
  // Dev default on; production default off.
  return process.env.NODE_ENV !== "production";
}

/**
 * The grammar jose's setExpirationTime accepts — copied from its own
 * jwt_claims_set.js so a value is refused here, with a message naming the
 * variable, rather than there with "Invalid time period format" and a 500 on
 * every successful sign-in.
 *
 * That 500 is what "users can't log in" turns out to be: a bad credential gets
 * a clean 401, a good one reaches issueApiToken and throws. Bare seconds
 * ("43200"), a quoted value ('"12h"') and a bare number all fail it.
 */
const EXPIRY_GRAMMAR =
  /^(\+|-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;

const DEFAULT_EXPIRY = "12h";

/** True when jose will accept this as a time period. */
export function isValidExpiry(value: string): boolean {
  return EXPIRY_GRAMMAR.test(value);
}

const warnedExpiry = new Set<string>();
function warnBadExpiry(variable: string, raw: string, fallback: string) {
  const key = `${variable}=${raw}`;
  if (warnedExpiry.has(key)) return;
  warnedExpiry.add(key);
  console.error(
    `[server-jwt] ${variable}=${JSON.stringify(raw)} is not a time period jose accepts ` +
      `(e.g. "12h", "30d", "720m"); using ${fallback}. Every sign-in would ` +
      `otherwise fail with "Invalid time period format".`,
  );
}

/**
 * An expiry jose will accept, or the fallback.
 *
 * A misconfigured environment variable must degrade, not take sign-in down.
 * Quotes are stripped first because pasting `"12h"` into a dashboard field is
 * the common way this goes wrong and the intent is unambiguous. Anything else
 * unparseable falls back and says so on the server log, once per bad value,
 * naming the variable to fix.
 */
function parseExpiry(
  raw: string | undefined,
  variable = "JWT_EXPIRY",
  fallback = DEFAULT_EXPIRY,
): string {
  let v = (raw || "").trim();
  if (/^["'].*["']$/.test(v)) v = v.slice(1, -1).trim();
  if (!v) return fallback;
  if (isValidExpiry(v)) return v;
  warnBadExpiry(variable, raw || "", fallback);
  return fallback;
}

/** Cookie Max-Age in seconds from an expiry string (e.g. 12h → 43200). */
export function expirySecondsFromString(raw: string | undefined): number {
  const v = parseExpiry(raw || process.env.JWT_EXPIRY);
  const m = /^(\d+)\s*([smhd])$/i.exec(v);
  if (!m) return 12 * 3600;
  const n = Number(m[1]);
  switch (m[2].toLowerCase()) {
    case "s":
      return n;
    case "m":
      return n * 60;
    case "h":
      return n * 3600;
    case "d":
      return n * 86400;
    default:
      return 12 * 3600;
  }
}

export function jwtExpirySeconds(): number {
  return expirySecondsFromString(process.env.JWT_EXPIRY);
}

/** Longer-lived JWT when the user checks “keep signed in”. */
export function keepSignedInExpiry(): string {
  // Same validation as the short expiry. A "keep me signed in" that 500s is the
  // checkbox that breaks login for exactly the people who tick it.
  return parseExpiry(process.env.JWT_EXPIRY_KEEP, "JWT_EXPIRY_KEEP", "30d");
}

export function apiTokenCookieOptions(maxAge = jwtExpirySeconds()) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function issueApiToken(
  user: {
    id: string;
    email: string;
    username: string;
    role: string;
    name?: string;
  },
  options?: { expiresIn?: string; jti?: string },
): Promise<{ token: string; expiresAt: string; jti: string }> {
  const key = jwtSecretBytes();
  if (!key) {
    throw new Error("JWT_SECRET is not configured");
  }
  const expiresIn = parseExpiry(options?.expiresIn || process.env.JWT_EXPIRY);
  const now = Math.floor(Date.now() / 1000);
  const jti = options?.jti || crypto.randomUUID();
  const token = await new SignJWT({
    uid: user.id,
    email: user.email,
    username: user.username,
    name: user.name || undefined,
    role: user.role,
  } satisfies ApiTokenClaims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(JWT_ISSUER)
    .setIssuedAt(now)
    .setJti(jti)
    .setExpirationTime(expiresIn)
    .sign(key);

  const verified = await jwtVerify(token, key, { issuer: JWT_ISSUER });
  const exp = verified.payload.exp;
  const expiresAt = new Date((exp || now) * 1000).toISOString();
  return { token, expiresAt, jti };
}

export async function verifyApiToken(raw: string): Promise<ApiTokenClaims | null> {
  const key = jwtSecretBytes();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(raw, key, {
      issuer: JWT_ISSUER,
      algorithms: ["HS256"],
    });
    return claimsFromPayload(payload);
  } catch {
    return null;
  }
}

function claimsFromPayload(payload: JWTPayload): ApiTokenClaims | null {
  const uid = String(payload.uid || payload.sub || "");
  const email = String(payload.email || "");
  const username = String(payload.username || "");
  const role = String(payload.role || "");
  const jti = payload.jti ? String(payload.jti) : undefined;
  const iat = typeof payload.iat === "number" ? payload.iat : undefined;
  if (!uid) return null;
  return { uid, email, username, role, jti, iat };
}

export function isApiKeyValid(headerValue: string | null): boolean {
  const expected = process.env.API_KEY?.trim();
  if (!expected || !headerValue) return false;
  // Constant-time-ish compare for equal-length strings.
  if (expected.length !== headerValue.length) return false;
  let ok = 0;
  for (let i = 0; i < expected.length; i += 1) {
    ok |= expected.charCodeAt(i) ^ headerValue.charCodeAt(i);
  }
  return ok === 0;
}

export function isAdministratorRole(role: string | null | undefined): boolean {
  const r = String(role || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return r === "administrator" || r === "super admin" || r === "superadmin";
}

export function bearerFromAuthorization(header: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec((header || "").trim());
  return match?.[1]?.trim() || null;
}

export function tokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (name !== API_TOKEN_COOKIE) continue;
    const value = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/** Resolve principal from Authorization Bearer, auth cookie, or X-API-Key. */
export async function resolvePrincipal(request: Request): Promise<AuthPrincipal | null> {
  const apiKey = request.headers.get("x-api-key");
  if (isApiKeyValid(apiKey)) {
    return {
      mode: "api_key",
      uid: "api-key",
      email: "",
      username: "api-key",
      role: "Administrator",
    };
  }
  const bearer = bearerFromAuthorization(request.headers.get("authorization"));
  const cookie = tokenFromCookieHeader(request.headers.get("cookie"));
  const bearerClaims = bearer ? await verifyApiToken(bearer) : null;
  const cookieClaims = cookie ? await verifyApiToken(cookie) : null;
  let claims = cookieClaims || bearerClaims;
  if (cookieClaims && bearerClaims) {
    claims =
      (bearerClaims.iat || 0) > (cookieClaims.iat || 0) ? bearerClaims : cookieClaims;
  }
  if (!claims) return null;

  // Session revoke checks live on the Go API (/api/auth/*). Next only verifies JWT.
  return { mode: "jwt", ...claims };
}
