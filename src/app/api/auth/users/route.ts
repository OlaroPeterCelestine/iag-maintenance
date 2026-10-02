/**
 * GET /api/auth/users — the user directory the app shows in Settings, and the
 * list the sync bootstrap loads to put names against record authors.
 *
 * Without this handler the request falls through `goApiRewrites()` to the
 * shared Go API, which has its own user table and rejects a platform session.
 * The call 401s on every boot, the directory silently collapses to the one
 * person signed in, and every "created by" reads as an unknown id.
 *
 * iag-authentication owns the accounts, so it answers:
 *   GET /v1/admin/users  →  { items: UserSummary[], total }
 *
 * That endpoint is admin-only (`RequireDjangoAdmin`). A non-admin gets a 403,
 * which is correct — a clerk has no business enumerating the staff list — so
 * this falls back to the caller's own record rather than surfacing an error on
 * a screen they can still legitimately use.
 *
 * No writes. Accounts are created and deactivated in the platform's own admin,
 * and an app that could fork that would put the two out of step.
 */
import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled } from "@/lib/iag/config";
import { gatewayFetch, unwrapList, unwrapOne } from "@/lib/iag/gateway";
import { legacyProxy } from "@/lib/iag/legacy";
import { claimsFromPayload, type PlatformClaims } from "@/lib/iag/identity";
import { appUserFromClaims } from "@/lib/iag/session";
import { resolvePrincipal } from "@/lib/server-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** iag-authentication's domain.UserSummary. */
type UserSummary = {
  id?: string;
  email?: string;
  fullName?: string;
  full_name?: string;
  isActive?: boolean;
  is_active?: boolean;
  isSuperuser?: boolean;
  is_superuser?: boolean;
  isStaff?: boolean;
  is_staff?: boolean;
  groups?: string[];
  roles?: string[];
};

function usernameFor(email: string, id: string): string {
  if (email.includes("@")) return email.split("@")[0];
  return email || id;
}

/**
 * Map a platform account onto the app's user row.
 *
 * The role and CRUD flags come from the same `appUserFromClaims` the login
 * route uses, so a person's role reads identically whether the app learnt it
 * from their own session or from this list.
 */
function toAppUser(row: UserSummary) {
  const id = String(row.id || "");
  const email = String(row.email || "");
  const claims: PlatformClaims = claimsFromPayload({
    sub: id || email,
    email,
    name: row.fullName || row.full_name || "",
    groups: row.groups || [],
    // A summary carries group and role names, not codenames. That is enough
    // for the role mapping; per-permission gating always reads the caller's own
    // token, never another user's row.
    permissions: row.roles || [],
    is_superuser: row.isSuperuser ?? row.is_superuser ?? false,
    is_staff: row.isStaff ?? row.is_staff ?? false,
  }) as PlatformClaims;

  const user = appUserFromClaims(claims);
  const active = row.isActive ?? row.is_active ?? true;
  return {
    ...user,
    id: id || user.id,
    username: usernameFor(email, id),
    status: active ? "Active" : "Inactive",
  };
}

export async function GET(request: NextRequest) {
  if (!adapterEnabled()) return legacyProxy(request);

  const principal = await resolvePrincipal(request);
  if (!principal) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }

  try {
    const payload = await gatewayFetch({
      service: "authentication",
      path: "/v1/admin/users",
      query: { limit: 500 },
    });
    return NextResponse.json({
      ok: true,
      data: unwrapList<UserSummary>(payload).map(toAppUser),
    });
  } catch {
    // Every failure lands here on purpose. 403 is the expected answer for a
    // non-admin and 404 for a deployment whose auth service predates the admin
    // group; an outage is a different problem but has the same remedy, because
    // the fallback below fails too and returns an empty list either way.
  }

  try {
    const me = unwrapOne<UserSummary>(
      await gatewayFetch({ service: "authentication", path: "/v1/users/me" }),
    );
    return NextResponse.json({ ok: true, data: me ? [toAppUser(me)] : [] });
  } catch {
    return NextResponse.json({ ok: true, data: [] });
  }
}