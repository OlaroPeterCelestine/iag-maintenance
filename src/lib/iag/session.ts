/**
 * Login / session bridge between the IAG platform and this app's own session.
 *
 * Two tokens are in play and they do different jobs:
 *
 *   iag_pt / iag_rt  — the platform RS256 access + refresh tokens. httpOnly,
 *                      server-only. Every adapter call to the gateway uses these.
 *   financeiag_at    — this app's existing HS256 session token. The edge proxy
 *                      and ~200 UI call sites already read its `role` claim, so
 *                      we keep issuing it rather than re-plumbing the whole app.
 *
 * The platform is the authority: the app token is only ever minted from
 * verified platform claims, and logout clears all three.
 */
import { NextResponse } from "next/server";
import {
  PLATFORM_REFRESH_COOKIE,
  PLATFORM_TOKEN_COOKIE,
} from "@/lib/iag/config";
import { GatewayError, requestToken, type TokenResponse } from "@/lib/iag/gateway";
import {
  appRoleFromClaims,
  decodePlatformToken,
  usernameFromClaims,
  verifyPlatformToken,
  type PlatformClaims,
} from "@/lib/iag/identity";
import {
  API_TOKEN_COOKIE,
  apiTokenCookieOptions,
  expirySecondsFromString,
  issueApiToken,
  keepSignedInExpiry,
} from "@/lib/server-jwt";

export type AppUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  canView: string;
  canCreate: string;
  canEdit: string;
  canDelete: string;
  status: string;
  hasPassword: boolean;
  mustChangePassword: boolean;
};

/**
 * Mirrors `builtInCrudFlags` in access-control.ts. Duplicated deliberately:
 * importing that module server-side would pull the whole client access graph
 * into the route bundle. Keep the two in step.
 */
function crudFlagsForRole(role: string): Pick<
  AppUser,
  "canView" | "canCreate" | "canEdit" | "canDelete"
> {
  const normalized = role.trim().toLowerCase();
  if (
    normalized === "administrator" ||
    normalized === "super admin" ||
    normalized === "superadmin"
  ) {
    return { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "Yes" };
  }
  switch (role) {
    case "Project Manager":
    case "Accounts Assistant":
    case "Department Head":
    case "HR":
    case "General Manager":
    case "CEO":
    case "Finance":
    case "Accountant":
    case "Quantity Surveyor":
    case "Stores Manager":
    case "Procurement":
    case "Contractor":
      return { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" };
    case "Reviewer":
    case "Approver":
    case "Clerk":
      return { canView: "Yes", canCreate: "Yes", canEdit: "No", canDelete: "No" };
    default:
      return { canView: "Yes", canCreate: "No", canEdit: "No", canDelete: "No" };
  }
}

export function appUserFromClaims(claims: PlatformClaims): AppUser {
  const role = appRoleFromClaims(claims);
  return {
    id: claims.sub,
    name: claims.name || claims.email || usernameFromClaims(claims),
    username: usernameFromClaims(claims),
    email: claims.email,
    role,
    ...crudFlagsForRole(role),
    status: "Active",
    hasPassword: true,
    mustChangePassword: false,
  };
}

export type PlatformSession = {
  tokens: TokenResponse;
  claims: PlatformClaims;
  user: AppUser;
};

/**
 * Password grant against iag-authentication, then verify the returned token
 * against JWKS before trusting a single claim from it.
 */
export async function platformLogin(
  emailOrUsername: string,
  password: string,
): Promise<PlatformSession> {
  const tokens = await requestToken({
    grant_type: "password",
    username: emailOrUsername,
    password,
  });

  const claims =
    (await verifyPlatformToken(tokens.access_token)) ??
    // JWKS unreachable (cold gateway) — the token still came from the token
    // endpoint over TLS, so fall back to decoding it for identity only.
    decodePlatformToken(tokens.access_token);

  if (!claims) {
    throw new GatewayError(502, "Platform issued a token that could not be read");
  }
  return { tokens, claims, user: appUserFromClaims(claims) };
}

function platformCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export type SessionCookie = {
  name: string;
  value: string;
  options: ReturnType<typeof platformCookieOptions>;
};

/**
 * Mint the app session token and the cookie set that goes with it.
 * Returned rather than written so the caller can put the token in the response
 * body (the client keeps a tab copy) and set cookies on the same response.
 */
export async function createAppSession(
  session: PlatformSession,
  keepSignedIn: boolean,
): Promise<{ token: string; expiresAt: string; cookies: SessionCookie[] }> {
  const expiresIn = keepSignedIn ? keepSignedInExpiry() : process.env.JWT_EXPIRY;
  const appMaxAge = expirySecondsFromString(expiresIn);

  const issued = await issueApiToken(
    {
      id: session.user.id,
      email: session.user.email,
      username: session.user.username,
      role: session.user.role,
      name: session.user.name,
    },
    { expiresIn },
  );

  const accessMaxAge =
    session.tokens.expires_in && session.tokens.expires_in > 0
      ? session.tokens.expires_in
      : 3600;

  const cookies: SessionCookie[] = [
    {
      name: API_TOKEN_COOKIE,
      value: issued.token,
      options: apiTokenCookieOptions(appMaxAge),
    },
    {
      name: PLATFORM_TOKEN_COOKIE,
      value: session.tokens.access_token,
      options: platformCookieOptions(accessMaxAge),
    },
  ];
  if (session.tokens.refresh_token) {
    cookies.push({
      name: PLATFORM_REFRESH_COOKIE,
      value: session.tokens.refresh_token,
      // Refresh outlives the access token; bound it to the app session length.
      options: platformCookieOptions(appMaxAge),
    });
  }

  return { token: issued.token, expiresAt: issued.expiresAt, cookies };
}

export function applyCookies(res: NextResponse, cookies: SessionCookie[]) {
  for (const cookie of cookies) {
    res.cookies.set(cookie.name, cookie.value, cookie.options);
  }
}

/** Clear every session cookie this app sets. */
export function clearSessionCookies(res: NextResponse) {
  for (const name of [
    API_TOKEN_COOKIE,
    PLATFORM_TOKEN_COOKIE,
    PLATFORM_REFRESH_COOKIE,
  ]) {
    res.cookies.set(name, "", { ...platformCookieOptions(0), maxAge: 0 });
  }
}

/** Map a GatewayError onto this app's `{ ok, error }` envelope. */
export function gatewayErrorResponse(err: unknown): NextResponse {
  if (err instanceof GatewayError) {
    // 502/503/504 mean "platform unreachable" — the client shows the
    // "Database unavailable" path for 503, which is the right UX here.
    const status = err.status >= 500 ? 503 : err.status;
    return NextResponse.json({ ok: false, error: err.message }, { status });
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}
