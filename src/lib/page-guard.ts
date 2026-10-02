/**
 * Auth helpers for Server Components and Server Actions.
 *
 * `api-guard.ts` gates route handlers, which always have a `Request` in hand.
 * Server Components and Actions do not, so the principal is resolved from
 * `next/headers` instead. The rules are the same ones `requireApiAuth` applies,
 * deliberately: a page that renders for a role the API would refuse is a page
 * that paints data it cannot refresh.
 */
import { headers } from "next/headers";
import {
  isAdministratorRole,
  isAuthRequired,
  resolvePrincipal,
  type AuthPrincipal,
} from "@/lib/server-jwt";

/**
 * `resolvePrincipal` reads a `Request`; only these three headers carry
 * credentials, so a minimal request is built rather than forwarding the whole
 * inbound header set into a second Request object.
 */
async function credentialRequest(): Promise<Request> {
  const incoming = await headers();
  const carried = new Headers();
  for (const name of ["cookie", "authorization", "x-api-key"]) {
    const value = incoming.get(name);
    if (value) carried.set(name, value);
  }
  return new Request("http://page.internal/", { headers: carried });
}

/** Signed-in principal for the current render, or null when unauthenticated. */
export async function pagePrincipal(): Promise<AuthPrincipal | null> {
  if (!isAuthRequired()) {
    // Mirrors requireApiAuth: dev without JWT_SECRET runs as Administrator, but
    // production fails closed — an unset secret must never open an admin page.
    if (process.env.NODE_ENV === "production") return null;
    return { mode: "api_key", uid: "dev", email: "", username: "dev", role: "Administrator" };
  }
  return resolvePrincipal(await credentialRequest());
}

/** True when the current request may open an Administrator-only page. */
export async function isPageAdmin(): Promise<boolean> {
  const principal = await pagePrincipal();
  if (!principal) return false;
  if (principal.mode === "api_key") return true;
  return isAdministratorRole(principal.role);
}
