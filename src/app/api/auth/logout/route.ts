/**
 * POST /api/auth/logout — drop the app session and the platform tokens.
 *
 * iag-authentication has no server-side session revoke on the gateway's public
 * surface, so logout is cookie clearing plus letting the short-lived access
 * token expire. The refresh token is cleared, which is what actually ends the
 * ability to keep minting new access tokens.
 */
import { NextResponse, type NextRequest } from "next/server";
import { PLATFORM_REFRESH_COOKIE, adapterEnabled } from "@/lib/iag/config";
import { forgetPlatformTokens } from "@/lib/iag/gateway";
import { legacyProxy } from "@/lib/iag/legacy";
import { clearSessionCookies } from "@/lib/iag/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: NextRequest) {
  if (!adapterEnabled()) return legacyProxy(request);
  forgetPlatformTokens(request.cookies.get(PLATFORM_REFRESH_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res);
  return res;
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}