/**
 * The platform access token lives for minutes; the app session for days. The
 * gateway's /oauth/token budget is shared platform-wide, so a stale cookie
 * must cost one refresh grant per session, not one per gateway call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
  }),
}));

function jwt(exp: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64({ sub: "u1", exp })}.sig`;
}

const calls: { url: string; body: string }[] = [];
let tokenGrants = 0;
const rotate = true;

beforeEach(() => {
  vi.resetModules();
  jar.clear();
  calls.length = 0;
  tokenGrants = 0;
  process.env.IAG_GATEWAY_ORIGIN = "https://gw.test";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ url, body });
      if (url.endsWith("/oauth/token")) {
        tokenGrants += 1;
        const params = new URLSearchParams(body);
        if (!["rt-1", "rt-2"].includes(params.get("refresh_token") || "")) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "content-type": "application/json" } });
        }
        return new Response(
          JSON.stringify({ access_token: jwt(Math.floor(Date.now() / 1000) + 900), refresh_token: rotate ? "rt-2" : "rt-1", expires_in: 900 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const auth = (init?.headers as Record<string, string>)?.Authorization || "";
      const token = auth.replace("Bearer ", "");
      const live = token && token.split(".")[1] && JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp * 1000 > Date.now();
      if (!live) return new Response(JSON.stringify({ error: "expired" }), { status: 401, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ data: [{ id: "row" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("platform token refresh", () => {
  it("refreshes once for a burst of calls carrying an expired token, then reuses it", async () => {
    jar.set("iag_pt", jwt(Math.floor(Date.now() / 1000) - 60));
    jar.set("iag_rt", "rt-1");
    const { gatewayFetch } = await import("@/lib/iag/gateway");

    const results = await Promise.all(
      Array.from({ length: 20 }, () => gatewayFetch({ service: "dms", path: "/api/v1/outlets" })),
    );
    expect(results).toHaveLength(20);
    expect(tokenGrants).toBe(1);
    // The rotated refresh token and the live access token were written back.
    expect(jar.get("iag_rt")).toBe("rt-2");
    expect(jar.get("iag_pt")).not.toBe(jwt(Math.floor(Date.now() / 1000) - 60));

    // A later call on the same instance neither 401s nor refreshes.
    await gatewayFetch({ service: "dms", path: "/api/v1/beats" });
    expect(tokenGrants).toBe(1);
    const upstream = calls.filter((c) => !c.url.endsWith("/oauth/token"));
    expect(upstream.filter((c) => c.url.endsWith("/beats"))).toHaveLength(1);
  });

  it("refreshes up front when the cookie token is visibly expired, sparing the 401 round-trip", async () => {
    jar.set("iag_pt", jwt(Math.floor(Date.now() / 1000) - 60));
    jar.set("iag_rt", "rt-1");
    const { gatewayFetch } = await import("@/lib/iag/gateway");
    await gatewayFetch({ service: "dms", path: "/api/v1/outlets" });
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["token", "outlets"]);
  });

  it("does not hammer the token endpoint after a failed refresh", async () => {
    jar.set("iag_pt", jwt(Math.floor(Date.now() / 1000) - 60));
    jar.set("iag_rt", "rt-revoked");
    const { gatewayFetch } = await import("@/lib/iag/gateway");
    for (let i = 0; i < 5; i += 1) {
      await expect(gatewayFetch({ service: "dms", path: "/api/v1/outlets" })).rejects.toMatchObject({ status: 401 });
    }
    expect(tokenGrants).toBe(1);
  });
});
