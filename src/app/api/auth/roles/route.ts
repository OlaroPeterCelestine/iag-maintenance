/**
 * GET /api/auth/roles — the role matrix the UI gates on.
 *
 * With the adapter off this proxies to the legacy Go API exactly as before.
 * With it on, the row is derived from live platform RBAC so this app's own
 * modules are granted to platform users who hold the matching service
 * permissions.
 *
 * Why this route has to exist: this app's core module sits in
 * `EXPLICIT_GRANT_MODULES` (see access-control.ts), where `canAccessModule`
 * returns false for every non-Administrator unless the role carries a
 * page-matrix grant. Wire the app to the platform without serving roles and
 * users sign in successfully and land on an empty workspace — data plumbing
 * healthy, UI blank.
 *
 * Reads follow `/api/auth/me`: identity from this app's verified session, then
 * a live `/v1/users/me` so a platform group change lands without a re-login,
 * falling back to session claims rather than 401-ing a valid session.
 *
 * No writes. Roles belong to the platform; letting an app edit them would put
 * the two out of step, and the owning service enforces its own permissions
 * regardless of what this returns.
 */
import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled } from "@/lib/iag/config";
import { gatewayFetch, unwrapOne } from "@/lib/iag/gateway";
import { legacyProxy } from "@/lib/iag/legacy";
import type { PlatformClaims } from "@/lib/iag/identity";
import { roleRowsForClaims } from "@/lib/iag/rbac";
import { resolvePrincipal } from "@/lib/server-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PlatformMe = {
  id?: string;
  email?: string;
  name?: string;
  groups?: string[];
  permissions?: string[];
  is_superuser?: boolean;
  isSuperuser?: boolean;
  is_staff?: boolean;
  isStaff?: boolean;
};

export async function GET(request: NextRequest) {
  if (!adapterEnabled()) return legacyProxy(request);

  const principal = await resolvePrincipal(request);
  if (!principal) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }

  // Start from what the verified app session already proves.
  let claims: PlatformClaims = {
    sub: principal.uid,
    email: principal.email,
    name: principal.name || "",
    groups: [],
    permissions: [],
    // An api_key principal is the machine caller and is treated as admin
    // elsewhere in this app; keep that consistent here.
    isSuperuser: principal.mode === "api_key",
    isStaff: true,
    audiences: [],
  };

  try {
    const me = unwrapOne<PlatformMe>(
      await gatewayFetch({ service: "authentication", path: "/v1/users/me" }),
    );
    if (me) {
      claims = {
        ...claims,
        sub: me.id || claims.sub,
        email: me.email || claims.email,
        name: me.name || claims.name,
        groups: Array.isArray(me.groups) ? me.groups : [],
        permissions: Array.isArray(me.permissions) ? me.permissions : [],
        isSuperuser: Boolean(me.is_superuser ?? me.isSuperuser) || claims.isSuperuser,
        isStaff: Boolean(me.is_staff ?? me.isStaff) || claims.isStaff,
      };
    }
  } catch {
    // Platform unreachable or access token expired. The app session is still
    // valid, so fall through with the claims above: the user keeps a
    // read-only workspace rather than being locked out mid-session.
  }

  return NextResponse.json({ ok: true, data: roleRowsForClaims(claims) });
}
