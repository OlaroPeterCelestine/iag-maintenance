/**
 * GET /api/auth/me — current principal.
 *
 * Identity comes from this app's own session token (issued at login from
 * verified platform claims). When the platform access token is still present we
 * re-read `/v1/users/me` so a group change on the platform shows up without a
 * re-login; if that call fails we fall back to the token claims rather than
 * 401-ing a valid session.
 */
import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled } from "@/lib/iag/config";
import { gatewayFetch, unwrapOne } from "@/lib/iag/gateway";
import { legacyProxy } from "@/lib/iag/legacy";
import { appRoleFromClaims, type PlatformClaims } from "@/lib/iag/identity";
import { resolvePrincipal } from "@/lib/server-jwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PlatformMe = {
  id?: string;
  email?: string;
  name?: string;
  fullName?: string;
  full_name?: string;
  groups?: string[];
  permissions?: string[];
  is_superuser?: boolean;
  isSuperuser?: boolean;
  is_staff?: boolean;
  isStaff?: boolean;
  mustChangePassword?: boolean;
  must_change_password?: boolean;
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

  let name = principal.name || "";
  let role = principal.role;
  let mustChangePassword = false;

  try {
    const me = unwrapOne<PlatformMe>(
      await gatewayFetch({ service: "authentication", path: "/v1/users/me" }),
    );
    if (me) {
      name = me.name || me.fullName || me.full_name || name;
      mustChangePassword = Boolean(
        me.mustChangePassword ?? me.must_change_password,
      );
      // Re-derive the role from live platform RBAC.
      const claims: PlatformClaims = {
        sub: me.id || principal.uid,
        email: me.email || principal.email,
        name,
        groups: Array.isArray(me.groups) ? me.groups : [],
        permissions: Array.isArray(me.permissions) ? me.permissions : [],
        isSuperuser: Boolean(me.is_superuser ?? me.isSuperuser),
        isStaff: Boolean(me.is_staff ?? me.isStaff),
        audiences: [],
      };
      if (claims.groups.length || claims.permissions.length || claims.isSuperuser) {
        role = appRoleFromClaims(claims);
      }
    }
  } catch {
    // Platform unreachable / access token expired — the app session is still
    // valid, so serve the claims we already verified.
  }

  return NextResponse.json({
    ok: true,
    data: {
      uid: principal.uid,
      email: principal.email,
      username: principal.username,
      name,
      role,
      mustChangePassword,
      passwordChangeForced: false,
    },
  });
}