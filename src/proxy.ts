import { NextResponse, type NextRequest } from "next/server";
import { IDENTITY_MANAGED_ELSEWHERE, OWNS_IDENTITY_DIRECTORY } from "@/lib/identity-directory";
import { getRequestIp } from "@/lib/request-ip";
import {
  API_TOKEN_COOKIE,
  isAdministratorRole,
  isApiKeyValid,
  isAuthRequired,
  verifyApiToken,
  type ApiTokenClaims,
} from "@/lib/server-jwt";

/** Paths rewritten to the Go Gin API when GO_API_URL is set (see next.config.ts). */
const GO_PROXY_PREFIXES = [
  "/api/auth",
  "/api/records",
  "/api/ledger",
  "/api/banking",
  "/api/settings",
  "/api/sync",
  "/api/activity",
  "/api/data",
  "/api/kv",
  "/api/contractor-ledgers",
  "/api/fx",
  "/api/request-email-contacts",
  "/api/approvals",
  "/api/push",
  "/api/drafts",
  "/api/cron",
  "/api/analytics",
] as const;

const PUBLIC_PAGE_PREFIXES = ["/login", "/forgot-password", "/guides"] as const;

/**
 * Pages that render Administrator-only payloads. Each one gates itself server
 * side as well — that check is the authority — but denying at the edge means
 * the document is never built for a role that may not read it.
 */
const ADMIN_ONLY_PAGE_PREFIXES = ["/system-health"] as const;

/**
 * Edge route ACL for roles that are restricted to part of the app.
 * The client matrix and the Go API both enforce this too; this stops a denied
 * page from ever being served, so no blocked UI paints before a redirect.
 */
const ROLE_PATH_ALLOWLIST: Array<{
  matches: (role: string) => boolean;
  home: string;
  allow: readonly string[];
}> = [
  {
    matches: (role) => role === "contractor",
    home: "/contractor",
    allow: ["/contractor", "/projects", "/contract-manager", "/profile"],
  },
];

function normalizeRole(role: string | undefined): string {
  return (role || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function pathMatches(pathname: string, allowed: string): boolean {
  return pathname === allowed || pathname.startsWith(`${allowed}/`);
}

/** Returns the redirect target when a role may not open this path. */
function deniedRedirect(pathname: string, role: string | undefined): string | null {
  const normalized = normalizeRole(role);
  const rule = ROLE_PATH_ALLOWLIST.find((entry) => entry.matches(normalized));
  if (!rule) return null;
  if (rule.allow.some((allowed) => pathMatches(pathname, allowed))) return null;
  return pathname === rule.home ? null : rule.home;
}

function isGoProxiedPath(_pathname: string): boolean {
  return false;
}

function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** Public pages a signed-in restricted role must still not browse. */
function isRoleRestrictedPublicPage(pathname: string): boolean {
  return pathname === "/guides" || pathname.startsWith("/guides/");
}

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/offline.html" ||
    pathname.endsWith(".webmanifest") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".map") ||
    pathname.endsWith(".woff") ||
    pathname.endsWith(".woff2")
  );
}

/**
 * Stamp the verified browser IP so Go (behind Vercel→Railway) does not record
 * shared egress as the end-user address. Prefers platform headers already on
 * the inbound request.
 */
function withClientIpHeaders(request: NextRequest, headers = new Headers(request.headers)): Headers {
  const ip = getRequestIp(request);
  if (!ip) return headers;
  headers.set("x-real-ip", ip);
  const forwarded = headers.get("x-forwarded-for")?.trim();
  if (!forwarded) {
    headers.set("x-forwarded-for", ip);
  } else if (!forwarded.split(",")[0]?.trim() || forwarded.split(",")[0]!.trim() !== ip) {
    // Keep original chain after the verified client hop.
    headers.set("x-forwarded-for", `${ip}, ${forwarded}`);
  }
  return headers;
}

/**
 * HTML must never sit on a CDN for a year. Next marks static pages with
 * `s-maxage=31536000`; after a deploy the edge keeps serving that document,
 * which still points at deleted `/_next/static/chunks/*` → ChunkLoadError.
 */
function withHtmlNoStore(response: NextResponse): NextResponse {
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, max-age=0, must-revalidate",
  );
  return response;
}

/** Pick the newer verified JWT when both cookie and Bearer are present. */
async function pickVerifiedToken(
  cookieToken: string,
  bearerToken: string,
): Promise<{ token: string; claims: ApiTokenClaims } | null> {
  const cookieClaims = cookieToken ? await verifyApiToken(cookieToken) : null;
  const bearerClaims = bearerToken ? await verifyApiToken(bearerToken) : null;
  if (cookieClaims && bearerClaims) {
    if ((bearerClaims.iat || 0) > (cookieClaims.iat || 0)) {
      return { token: bearerToken, claims: bearerClaims };
    }
    return { token: cookieToken, claims: cookieClaims };
  }
  if (cookieClaims && cookieToken) return { token: cookieToken, claims: cookieClaims };
  if (bearerClaims && bearerToken) return { token: bearerToken, claims: bearerClaims };
  return null;
}

/**
 * Guard HTML pages (cookie JWT) and /api/* (Bearer / cookie / API key).
 * When GO_API_URL is set, Go-proxied routes are forwarded; Gin enforces authz.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // —— Page routes: require httpOnly auth cookie when AUTH_REQUIRED ——
  if (!pathname.startsWith("/api/") && !isStaticAsset(pathname)) {
    if (pathname === "/contractor/login") {
      return withHtmlNoStore(NextResponse.redirect(new URL("/login", request.url)));
    }
    if (!isAuthRequired()) {
      return withHtmlNoStore(NextResponse.next());
    }
    const cookieToken = request.cookies.get(API_TOKEN_COOKIE)?.value || "";
    const claims = cookieToken ? await verifyApiToken(cookieToken) : null;

    if (isPublicPage(pathname)) {
      // Signed-in restricted roles stay bound by their allowlist on public pages.
      if (claims && isRoleRestrictedPublicPage(pathname)) {
        const redirect = deniedRedirect(pathname, claims.role);
        if (redirect) {
          return withHtmlNoStore(NextResponse.redirect(new URL(redirect, request.url)));
        }
      }
      return withHtmlNoStore(NextResponse.next());
    }

    if (!claims) {
      const login = new URL("/login", request.url);
      const nextPath = pathname + (request.nextUrl.search || "");
      if (nextPath.startsWith("/") && !nextPath.startsWith("//")) {
        login.searchParams.set("next", nextPath);
      }
      return withHtmlNoStore(NextResponse.redirect(login));
    }
    if (
      (pathname === "/contractor" || pathname.startsWith("/contractor/")) &&
      normalizeRole(claims.role) !== "contractor"
    ) {
      return withHtmlNoStore(NextResponse.redirect(new URL("/", request.url)));
    }
    if (
      ADMIN_ONLY_PAGE_PREFIXES.some((prefix) => pathMatches(pathname, prefix)) &&
      !isAdministratorRole(claims.role)
    ) {
      return withHtmlNoStore(NextResponse.redirect(new URL("/", request.url)));
    }
    const redirect = deniedRedirect(pathname, claims.role);
    if (redirect) {
      return withHtmlNoStore(NextResponse.redirect(new URL(redirect, request.url)));
    }
    return withHtmlNoStore(NextResponse.next());
  }

  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Users and roles are written only in IAG Admin. GET still hydrates the
  // local directory from the shared Go / platform store.
  if (!OWNS_IDENTITY_DIRECTORY) {
    const method = request.method.toUpperCase();
    const identityPath =
      pathname === "/api/auth/users" ||
      pathname.startsWith("/api/auth/users/") ||
      pathname === "/api/auth/roles" ||
      pathname.startsWith("/api/auth/roles/") ||
      pathname === "/api/auth/seed";
    if (
      identityPath &&
      method !== "GET" &&
      method !== "HEAD" &&
      method !== "OPTIONS"
    ) {
      return NextResponse.json(
        { ok: false, error: IDENTITY_MANAGED_ELSEWHERE },
        { status: 403 },
      );
    }
  }

  if (
    pathname === "/api/health" ||
    pathname === "/api/sync/ready" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/me" ||
    pathname === "/api/auth/forgot-password" ||
    pathname === "/api/auth/verify-reset-otp" ||
    pathname === "/api/auth/reset-password" ||
    // Crash ingest must work even when the session/token is already broken.
    (pathname === "/api/crash" && request.method === "POST")
  ) {
    // Login/logout/activity proxies need the real client IP, not Vercel egress.
    if (isGoProxiedPath(pathname)) {
      return NextResponse.next({ request: { headers: withClientIpHeaders(request) } });
    }
    return NextResponse.next();
  }
  if (!isAuthRequired()) {
    if (isGoProxiedPath(pathname)) {
      return NextResponse.next({ request: { headers: withClientIpHeaders(request) } });
    }
    return NextResponse.next();
  }

  const apiKey = request.headers.get("x-api-key");
  if (isApiKeyValid(apiKey)) {
    const headers = withClientIpHeaders(request);
    headers.set("x-auth-mode", "api_key");
    headers.set("x-user-role", "Service");
    headers.set("x-user-id", "api-key");
    return NextResponse.next({ request: { headers } });
  }

  const bearer = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(bearer.trim());
  const bearerToken = match?.[1]?.trim() || "";
  const cookieToken = request.cookies.get(API_TOKEN_COOKIE)?.value || "";

  const picked = await pickVerifiedToken(cookieToken, bearerToken);
  const verifiedToken = picked?.token || "";
  const claims = picked?.claims || null;

  // Go-proxied routes: never 401 in Next — forward best token and let Gin decide.
  if (isGoProxiedPath(pathname)) {
    const headers = withClientIpHeaders(request);
    const forward = verifiedToken || cookieToken || bearerToken;
    if (forward) {
      headers.set("Authorization", `Bearer ${forward}`);
    }
    if (claims) {
      headers.set("x-auth-mode", "jwt");
      headers.set("x-user-id", claims.uid);
      headers.set("x-user-email", claims.email);
      headers.set("x-user-username", claims.username);
      headers.set("x-user-role", claims.role);
    }
    return NextResponse.next({ request: { headers } });
  }

  // Next-only routes (realtime, etc.): require a verified JWT.
  if (!claims || !verifiedToken) {
    return NextResponse.json(
      {
        ok: false,
        error: bearerToken || cookieToken ? "Invalid or expired token" : "Sign in required",
      },
      { status: 401 },
    );
  }
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${verifiedToken}`);
  headers.set("x-auth-mode", "jwt");
  headers.set("x-user-id", claims.uid);
  headers.set("x-user-email", claims.email);
  headers.set("x-user-username", claims.username);
  headers.set("x-user-role", claims.role);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|sw\\.js|offline\\.html|manifest\\.webmanifest|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js|map|woff2?|webmanifest)$).*)",
  ],
};
