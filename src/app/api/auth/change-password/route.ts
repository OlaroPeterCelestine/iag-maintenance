/**
 * POST /api/auth/change-password — change your own password.
 *
 * Without this handler the request falls through `goApiRewrites()` to the
 * shared Go API, which has its own user table and has never heard of a platform
 * account: the caller gets a 401 on a password that is perfectly valid, or —
 * worse, if a same-named Go account exists — changes the wrong one.
 *
 * iag-authentication owns the credential, so it does the change:
 *   POST /v1/users/me/password  { currentPassword, newPassword }
 *
 * The body the client already sends matches that contract exactly, so nothing
 * on the UI side changes.
 */
import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled } from "@/lib/iag/config";
import { GatewayError, gatewayFetch } from "@/lib/iag/gateway";
import { legacyProxy } from "@/lib/iag/legacy";
import { gatewayErrorResponse } from "@/lib/iag/session";
import { requireApiAuth } from "@/lib/api-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!adapterEnabled()) return legacyProxy(request);

  // The platform bearer in the cookie is what actually authorises the change;
  // this check keeps an unauthenticated caller from spending a gateway round
  // trip, and keeps the failure shape the same as every other guarded route.
  const auth = await requireApiAuth(request);
  if ("response" in auth) return auth.response;

  let payload: { currentPassword?: string; newPassword?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const currentPassword = payload.currentPassword || "";
  const newPassword = payload.newPassword || "";
  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { ok: false, error: "Current and new password are required" },
      { status: 400 },
    );
  }

  try {
    await gatewayFetch({
      service: "authentication",
      path: "/v1/users/me/password",
      method: "POST",
      body: { currentPassword, newPassword },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // 401 here means "your current password is wrong", not "your session
    // expired" — passing it through as 401 would log the user out mid-dialog.
    if (err instanceof GatewayError && err.status === 401) {
      return NextResponse.json(
        { ok: false, error: "Current password is incorrect." },
        { status: 400 },
      );
    }
    return gatewayErrorResponse(err);
  }
}
