/**
 * Route-handler auth helpers (after proxy, or for admin-only checks).
 */
import { NextResponse } from "next/server";
import {
  allowAuthSeed,
  isAdministratorRole,
  isAuthRequired,
  resolvePrincipal,
  type AuthPrincipal,
} from "@/lib/server-jwt";

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ ok: false, error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

export async function requireApiAuth(
  request: Request,
): Promise<{ principal: AuthPrincipal } | { response: NextResponse }> {
  if (!isAuthRequired()) {
    // Dev without auth: treat as admin for local tooling. Fail CLOSED in
    // production — isAuthRequired() returns false when JWT_SECRET is unset,
    // and the Go API refuses to boot in that state but Next has no such
    // check. Without this guard a missing secret on the web host turned every
    // anonymous request into an Administrator on the routes Next serves
    // itself (/api/email/send, /api/sms/send, /api/crash).
    if (process.env.NODE_ENV === "production") {
      return {
        response: unauthorized(
          "Server auth is not configured — set JWT_SECRET before serving requests.",
        ),
      };
    }
    return {
      principal: {
        mode: "api_key",
        uid: "dev",
        email: "",
        username: "dev",
        role: "Administrator",
      },
    };
  }
  const principal = await resolvePrincipal(request);
  if (!principal) return { response: unauthorized("Sign in required") };
  return { principal };
}

export async function requireApiAdmin(
  request: Request,
): Promise<{ principal: AuthPrincipal } | { response: NextResponse }> {
  const auth = await requireApiAuth(request);
  if ("response" in auth) return auth;
  if (auth.principal.mode === "api_key") return auth;
  if (!isAdministratorRole(auth.principal.role)) {
    return { response: forbidden("Administrator role required") };
  }
  return auth;
}

/**
 * Roles that must never send outbound messages from the company identity.
 * Read-only and externally-scoped roles have no business reason to, and the
 * Go API already blocks them on its own /api/email and /api/sms routes via
 * requireCrud("edit") + requireNotAllowlistRestricted(). These two routes are
 * served by Next rather than proxied, so without this check a Viewer or
 * Contractor account could send mail/SMS from the company's authenticated
 * SMTP identity — a phishing primitive the Go route explicitly denies.
 *
 * Role permissions live in Postgres and Next has no DB access here, so this
 * matches on role name. It is deliberately conservative: the authoritative
 * gate remains the Go route, and these should be proxied to it when their
 * request contracts are reconciled.
 */
const OUTBOUND_SEND_DENIED_ROLES = [
  "viewer",
  "view only",
  "read only",
  "readonly",
  "contractor",
  "guest",
  "auditor",
];

/** Auth + permission to send outbound email/SMS as the organisation. */
export async function requireApiSend(
  request: Request,
): Promise<{ principal: AuthPrincipal } | { response: NextResponse }> {
  const auth = await requireApiAuth(request);
  if ("response" in auth) return auth;
  // Service-to-service callers are already key-gated.
  if (auth.principal.mode === "api_key") return auth;
  if (isAdministratorRole(auth.principal.role)) return auth;
  const role = (auth.principal.role || "").trim().toLowerCase();
  if (!role || OUTBOUND_SEND_DENIED_ROLES.some((denied) => role.includes(denied))) {
    return { response: forbidden("Your role cannot send messages") };
  }
  return auth;
}

/** Seed endpoint: disabled in production unless ALLOW_AUTH_SEED; always admin when auth on. */
export async function requireAuthSeed(
  request: Request,
): Promise<{ principal: AuthPrincipal } | { response: NextResponse }> {
  if (!allowAuthSeed()) {
    return {
      response: NextResponse.json(
        { ok: false, error: "Auth seed disabled. Set ALLOW_AUTH_SEED=true to enable." },
        { status: 403 },
      ),
    };
  }
  return requireApiAdmin(request);
}
