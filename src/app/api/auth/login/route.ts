/**
 * POST /api/auth/login — sign in against iag-authentication.
 *
 * Response envelope matches what `loginViaDatabase` in src/lib/auth-api.ts
 * already expects, so the login page needs no change:
 *   { ok: true, data: { user, token, expiresAt, sessionId } }
 */
import { NextResponse, type NextRequest } from "next/server";
import { adapterEnabled } from "@/lib/iag/config";
import { legacyProxy } from "@/lib/iag/legacy";
import {
  applyCookies,
  createAppSession,
  gatewayErrorResponse,
  platformLogin,
} from "@/lib/iag/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!adapterEnabled()) return legacyProxy(request);

  let payload: {
    emailOrUsername?: string;
    email?: string;
    username?: string;
    password?: string;
    keepSignedIn?: boolean;
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const identifier = (
    payload.emailOrUsername ||
    payload.email ||
    payload.username ||
    ""
  ).trim();
  const password = payload.password || "";

  if (!identifier || !password) {
    return NextResponse.json(
      { ok: false, error: "Email and password are required" },
      { status: 400 },
    );
  }

  try {
    const session = await platformLogin(identifier, password);
    const issued = await createAppSession(session, payload.keepSignedIn !== false);

    const res = NextResponse.json({
      ok: true,
      data: {
        user: session.user,
        // Client keeps this in tab memory and sends it as Bearer.
        token: issued.token,
        expiresAt: issued.expiresAt,
        sessionId: session.claims.jti,
      },
    });
    applyCookies(res, issued.cookies);
    return res;
  } catch (err) {
    return gatewayErrorResponse(err);
  }
}