import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

/**
 * Proxy all accounting/auth/data APIs to the Go Gin backend.
 * Realtime SSE stays on Next (`/api/realtime` + `/api/ws` via server.ts).
 * Local `/api/health` stays on Next so Railway can healthcheck the web process.
 *
 * `afterFiles` rewrites are matched BEFORE dynamic routes, so a rewrite on
 * `/api/records/:path*` would shadow `src/app/api/records/[module]/[entity]`,
 * and one on `/api/auth/:path*` shadows `src/app/api/auth/login` — the route
 * that performs the platform password grant.
 *
 * When the IAG adapter is on it owns both surfaces, including the fallback to
 * the Go API for anything no IAG service maps (see src/lib/iag/legacy.ts), so
 * those rewrites have to be withheld or the adapter never runs. Proxying them
 * does not add a fallback; it removes the handler that provides one.
 */
function adapterOwnsApiSurface(): boolean {
  const raw = (process.env.IAG_ADAPTER_ENABLED || "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  if (raw === "true" || raw === "1" || raw === "on") return true;
  return Boolean((process.env.IAG_GATEWAY_ORIGIN || "").trim());
}

/**
 * The Go API origin, or "" when there is nothing usable to proxy to.
 *
 * A rewrite `destination` that does not start with a scheme is an *internal*
 * path to Next, not an upstream. So a GO_API_URL of `api.example.com` (no
 * `https://`) does not proxy anywhere — it rewrites `/api/auth/login` onto a
 * path that does not exist, which both shadows this app's own route handler
 * and answers `/_not-found`. The app then has no login endpoint and nothing
 * anywhere says why.
 *
 * Refusing the value is better than emitting that rewrite: with no rewrite the
 * app's own handlers serve, which is the standalone behaviour and is at worst
 * a missing backend rather than a missing login page.
 */
function goApiOrigin(): string {
  const raw = (process.env.GO_API_URL || "").trim().replace(/\/$/, "");
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) {
    console.warn(
      `[next.config] Ignoring GO_API_URL=${JSON.stringify(raw)} — a rewrite ` +
        "destination must be an absolute http(s) URL, and a bare host silently " +
        "removes /api/auth and /api/records from this app.",
    );
    return "";
  }
  return raw;
}

function goApiRewrites() {
  const go = goApiOrigin();
  if (!go) return [] as { source: string; destination: string }[];

  // Surfaces the adapter implements itself. Each of these has a route handler
  // that falls back to the Go API on its own when the adapter is off
  // (src/lib/iag/legacy.ts), so proxying them here does not add the fallback —
  // it removes the handler that provides it.
  const adapterOwned = adapterOwnsApiSurface() ? ["auth", "records"] : [];

  const prefixes = [
    // `auth` was proxied unconditionally. With the adapter on and GO_API_URL
    // also set, that shadowed /api/auth/login — the route that performs the
    // platform password grant — so the app had no way to sign anyone in while
    // every other screen behaved normally. The records rewrite had been
    // withheld for exactly this reason since the adapter landed; auth was
    // missed, and auth is the one that makes the app unusable.
    ...(adapterOwned.includes("auth") ? [] : ["auth"]),
    ...(adapterOwned.includes("records") ? [] : ["records"]),
    "ledger",
    "settings",
    "sync",
    "activity",
    "data",
    "kv",
    "contractor-ledgers",
    "fx",
    "request-email-contacts",
    "approvals",
    "push",
    "drafts",
    "cron",
    "analytics",
  ];

  return prefixes.flatMap((prefix) => [
    { source: `/api/${prefix}`, destination: `${go}/api/${prefix}` },
    { source: `/api/${prefix}/:path*`, destination: `${go}/api/${prefix}/:path*` },
  ]);
}

function packageVersion(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_APP_VERSION || "").trim();
  if (fromEnv) return fromEnv;
  try {
    return String(
      JSON.parse(readFileSync("./package.json", "utf8")).version || "0.0.0",
    );
  } catch {
    return "0.0.0";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: packageVersion(),
  },
  // Hide the Next.js N / Dev Tools badge. Errors still log; they must not
  // cover the ERP for operators.
  devIndicators: false,
  // Dev server binds 0.0.0.0; browsers often open http://127.0.0.1:3000.
  // Without this, Next blocks /_next/* and client hydration can hang on a blank shell.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Skew protection id must be ≤32 chars and unique per Vercel project.
  // Prefer an explicit NEXT_DEPLOYMENT_ID; otherwise derive a short unique token.
  deploymentId: (() => {
    const explicit = (process.env.NEXT_DEPLOYMENT_ID || "").trim();
    if (explicit) return explicit.slice(0, 32);
    const sha = (
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      ""
    ).trim();
    if (!sha) return undefined;
    // 8-char SHA + build time keeps length short and avoids "already exists".
    const stamp = (process.env.VERCEL_DEPLOYMENT_ID || Date.now().toString(36)).slice(0, 12);
    return `${sha.slice(0, 8)}-${stamp}`.slice(0, 32);
  })(),
  compiler: {
    // Strip logging from production output so nothing about a user's data
    // reaches the browser console. `console.error` survives the transform for
    // server-side infra logs; in the browser it is captured by the console lock
    // (src/lib/console-lock.ts) and reported to /api/crash instead of printed.
    removeConsole:
      process.env.NODE_ENV === "production" ? { exclude: ["error"] } : false,
  },
  experimental: {
    optimizePackageImports: ["iconsax-react", "lucide-react"],
  },
  async headers() {
    // Only pin HTML Cache-Control in production. Next warns (and can break HMR)
    // if we override `/_next/static` Cache-Control during `next dev`.
    if (process.env.NODE_ENV !== "production") return [];
    // CSP notes: Next's runtime needs 'unsafe-inline' for its bootstrap and
    // hydration payloads, and the app injects inline <head> scripts (storage
    // guard, console lock, theme). 'unsafe-eval' is deliberately NOT granted.
    // connect-src stays 'self' because the Go API is reached through the
    // same-origin /api rewrite rather than cross-origin.
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // data: covers attachments, which are stored as base64 data URLs.
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "upgrade-insecure-requests",
    ].join("; ");
    return [
      {
        // Belt-and-suspenders vs Next's static `s-maxage=31536000` on HTML.
        // Hashed `/_next/static` assets keep their immutable year-long cache below.
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-cache, no-store, max-age=0, must-revalidate",
          },
          // The Go API sets these on its JSON responses, but HTML documents
          // carried none — which is where CSP and HSTS actually matter, and
          // the only defence-in-depth layer that would contain an XSS in
          // user-controlled record text.
          { key: "Content-Security-Policy", value: csp },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "x-vercel-skip-toolbar", value: "1" },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  async rewrites() {
    // afterFiles: filesystem routes (e.g. /api/auth/forgot-password) win over Go proxy.
    return { afterFiles: goApiRewrites() };
  },
};

export default nextConfig;
