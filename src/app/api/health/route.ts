import { NextResponse } from "next/server";
import { isGoApiConfigured, goApiBaseUrl } from "@/lib/go-api";
import { isRedisConfigured, redisPing } from "@/lib/db/redis";

/**
 * Web-process health.
 * Default (client boot / load balancers): instant liveness — never fan out to
 * Go Redis/Kafka probes (that made every page load wait 1–2s).
 * Pass ?deep=1 for dependency diagnostics.
 */
export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";

  if (!deep) {
    return NextResponse.json({
      ok: true,
      api: "next-web",
    });
  }

  const goConfigured = isGoApiConfigured();
  let goOk: boolean | null = null;
  let goMessage = "";
  if (goConfigured) {
    try {
      const res = await fetch(`${goApiBaseUrl()}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      });
      goOk = res.ok;
      if (!res.ok) goMessage = `status ${res.status}`;
    } catch (err) {
      goOk = false;
      goMessage = err instanceof Error ? err.message : "unreachable";
    }
  }

  let redisOk: boolean | null = null;
  let redisMessage = "";
  if (isRedisConfigured()) {
    const ping = await redisPing();
    redisOk = ping.ok;
    redisMessage = ping.message || "";
  }

  const ok =
    (goConfigured ? goOk === true : process.env.NODE_ENV !== "production") &&
    (redisOk === null || redisOk === true);

  return NextResponse.json(
    {
      ok,
      api: "next-web",
      go: {
        configured: goConfigured,
        url: goConfigured ? goApiBaseUrl() : "",
        ok: goOk,
        message: goMessage,
      },
      redis: {
        configured: isRedisConfigured(),
        ok: redisOk,
        message: redisMessage,
      },
    },
    { status: ok ? 200 : 503 },
  );
}
