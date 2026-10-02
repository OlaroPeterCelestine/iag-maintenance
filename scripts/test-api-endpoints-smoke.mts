/**
 * Smoke every route the Go API registers.
 *
 * Two failure modes this catches that unit tests cannot:
 *   - a route the UI calls is not registered at all (Gin's bare 404), so the
 *     feature behind it silently does nothing
 *   - a handler panics or 500s on a well-formed request
 *
 * Read routes are called for real and must return 2xx. Write routes are called
 * with a payload that exercises the handler without changing anything the user
 * would miss. Genuinely destructive routes (purge, user/role delete, outbound
 * mail, push, session teardown) are probed with a deliberately invalid body:
 * that proves the route is wired and validates input, without firing the
 * action. Anything that would end our own session runs last.
 *
 * Keep the route list in step with backend/internal/httpapi/server.go.
 *
 * Run against a THROWAWAY API:
 *   API_URL=http://127.0.0.1:8099 npx tsx scripts/test-api-endpoints-smoke.mts
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const API = (process.env.API_URL || "http://127.0.0.1:8099").replace(/\/$/, "");

if (/railway|vercel|https:/i.test(API) && !process.env.ALLOW_REMOTE_WRITE) {
  console.error(
    `Refusing to smoke ${API}. This test writes records — point API_URL at a local throwaway API,\n` +
      `or set ALLOW_REMOTE_WRITE=1 if you really mean it.`,
  );
  process.exit(1);
}

type Expect =
  /** Must succeed outright. */
  | "ok"
  /** Route must exist and answer; a validation/permission 4xx is a pass. */
  | "handled";

type Route = {
  method: string;
  path: string;
  body?: unknown;
  expect: Expect;
  note?: string;
  /** Runs after everything else — may invalidate our session. */
  last?: boolean;
  /**
   * Backing service this route needs. When it is not configured the handler
   * answers 5xx by design; that is reported as SKIPPED, never as a pass — the
   * route stays unproven until you run against an environment that has it.
   */
  dependency?: "redis" | "smtp";
  /** Server-to-server only: a user Bearer token is correctly refused with 401. */
  serviceKeyOnly?: boolean;
};

/** Does this 5xx say the route's backing service is simply not configured? */
function isDependencyUnavailable(route: Route, status: number, detail: string) {
  if (!route.dependency || status < 500) return false;
  if (route.dependency === "redis") return /redis not configured/i.test(detail);
  if (route.dependency === "smtp") {
    return /smtp|mail|dial tcp|connection refused|no recipients|timeout/i.test(detail);
  }
  return false;
}

let token = "";

async function signIn() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrUsername: process.env.RT_USER || "roundtrip@test.local",
      password: process.env.RT_PASSWORD || "LocalTest123!",
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: { token?: string };
    error?: string;
  } | null;
  if (!res.ok || !body?.data?.token) {
    throw new Error(`login failed (${res.status}): ${body?.error || "no token"}`);
  }
  token = body.data.token;
}

async function call(route: Route) {
  const init: RequestInit = {
    method: route.method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (route.body !== undefined) init.body = JSON.stringify(route.body);
  const res = await fetch(`${API}${route.path}`, init);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

/**
 * Gin answers an unregistered path with a 404 that is not JSON. A handler
 * returning 404 for a missing row answers with a JSON error body — that is a
 * live route, not a missing one.
 */
function isUnregistered(status: number, json: unknown, text: string) {
  if (status === 404 && json === null) return true;
  if (status === 404 && /404 page not found/i.test(text)) return true;
  return status === 405;
}

const SAMPLE_ENTITY = { module: "banking", entity: "payments" };
const probeId = "smoke-probe-record";

const routes: Route[] = [
  // ── Public ────────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/health", expect: "ok" },
  { method: "GET", path: "/api/health/deep", expect: "ok" },
  { method: "GET", path: "/api/sync/ready", expect: "ok" },
  {
    method: "POST",
    path: "/api/auth/login",
    body: { emailOrUsername: "", password: "" },
    expect: "handled",
    note: "empty credentials must be rejected, not crash",
  },
  {
    method: "POST",
    path: "/api/auth/forgot-password/issue",
    body: {},
    expect: "handled",
    serviceKeyOnly: true,
    note: "server-to-server: must refuse a user token with 401",
  },
  { method: "POST", path: "/api/auth/forgot-password", body: {}, expect: "handled" },
  { method: "POST", path: "/api/auth/verify-reset-otp", body: {}, expect: "handled" },
  { method: "POST", path: "/api/auth/reset-password", body: {}, expect: "handled" },

  // ── Session ───────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/auth/me", expect: "ok" },
  { method: "GET", path: "/api/auth/sessions", expect: "ok" },
  {
    method: "POST",
    path: "/api/auth/change-password",
    body: {},
    expect: "handled",
    note: "probe only — password unchanged",
  },
  { method: "PATCH", path: "/api/auth/profile", body: { name: "Round Trip" }, expect: "ok" },
  { method: "GET", path: "/api/auth/seed", expect: "handled", note: "403 when seeding is off" },
  { method: "POST", path: "/api/auth/seed", expect: "handled" },

  // ── Activity ──────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/activity", expect: "ok" },
  {
    method: "POST",
    path: "/api/activity",
    body: { action: "Viewed", module: "banking", entity: "payments", recordLabel: "smoke" },
    expect: "handled",
    note: "action allowlist may reject",
  },

  // ── Sync ──────────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/sync/status", expect: "ok" },
  { method: "GET", path: "/api/sync/bootstrap", expect: "ok" },

  // ── Records: collection + item REST ───────────────────────────────────────
  { method: "GET", path: "/api/records", expect: "ok" },
  {
    method: "GET",
    path: `/api/records/${SAMPLE_ENTITY.module}/${SAMPLE_ENTITY.entity}`,
    expect: "ok",
  },
  {
    method: "POST",
    path: `/api/records/${SAMPLE_ENTITY.module}/${SAMPLE_ENTITY.entity}`,
    body: {
      id: probeId,
      reference: "SMOKE-1",
      date: "2026-08-06",
      party: "Smoke payee",
      account: "Smoke Bank",
      amount: "10",
      status: "Paid",
    },
    expect: "ok",
  },
  {
    method: "GET",
    path: `/api/records/${SAMPLE_ENTITY.module}/${SAMPLE_ENTITY.entity}/${probeId}`,
    expect: "ok",
  },
  {
    method: "PATCH",
    path: `/api/records/${SAMPLE_ENTITY.module}/${SAMPLE_ENTITY.entity}/${probeId}`,
    body: { party: "Smoke payee edited" },
    expect: "ok",
  },
  {
    method: "PUT",
    path: `/api/records/${SAMPLE_ENTITY.module}/${SAMPLE_ENTITY.entity}`,
    body: { records: [], expectedRevision: "bogus" },
    expect: "handled",
    note: "stale revision must conflict, not wipe",
  },
  {
    method: "POST",
    path: `/api/records/${SAMPLE_ENTITY.module}/${SAMPLE_ENTITY.entity}/import-csv`,
    body: {},
    expect: "handled",
  },
  {
    method: "DELETE",
    path: `/api/records/${SAMPLE_ENTITY.module}/${SAMPLE_ENTITY.entity}/${probeId}`,
    expect: "ok",
    note: "removes this test's own probe row",
  },
  {
    method: "GET",
    path: "/api/records/banking/not-a-real-entity",
    expect: "handled",
    note: "unknown entity must be refused by the catalog",
  },

  // ── Drafts ────────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/drafts", expect: "ok" },
  {
    method: "PUT",
    path: "/api/drafts",
    body: {
      id: "smoke-draft",
      module: "banking",
      entity: "payments",
      data: { reference: "SMOKE-DRAFT" },
    },
    expect: "ok",
  },
  { method: "GET", path: "/api/drafts/smoke-draft", expect: "ok" },
  { method: "DELETE", path: "/api/drafts/smoke-draft", expect: "ok" },

  // ── Settings ──────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/settings", expect: "ok" },
  { method: "GET", path: "/api/settings/financeiag-smoke", expect: "handled" },
  {
    method: "PUT",
    path: "/api/settings/financeiag-smoke",
    body: { value: { probe: true } },
    expect: "ok",
  },

  // ── Ledger ────────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/ledger/accounts", expect: "ok" },
  { method: "GET", path: "/api/ledger/balances", expect: "ok" },
  { method: "GET", path: "/api/ledger/lines", expect: "ok" },
  {
    method: "PUT",
    path: "/api/ledger/accounts",
    body: { accounts: [] },
    expect: "handled",
    note: "empty replace must be refused",
  },
  {
    method: "PUT",
    path: "/api/ledger/lines",
    body: { mode: "sourceUpsert", sourceRecordId: "", lines: [] },
    expect: "handled",
  },
  { method: "POST", path: "/api/ledger/post", body: {}, expect: "handled" },
  { method: "POST", path: "/api/ledger/journal", body: {}, expect: "handled" },
  { method: "GET", path: "/api/ledger/reports/trial-balance", expect: "ok" },
  { method: "GET", path: "/api/ledger/reports/balance-sheet", expect: "ok" },
  { method: "GET", path: "/api/ledger/reports/profit-and-loss", expect: "ok" },

  // ── Ops / admin ───────────────────────────────────────────────────────────
  {
    method: "POST",
    path: "/api/data/purge",
    body: {},
    expect: "handled",
    note: "probe only — no confirmation token, so nothing is purged",
  },
  { method: "GET", path: "/api/cron/status", expect: "ok" },
  { method: "POST", path: "/api/cron/run", body: {}, expect: "handled", note: "probe only" },
  { method: "GET", path: "/api/analytics", expect: "ok" },
  { method: "GET", path: "/api/analytics/user-patterns", expect: "ok" },

  // ── KV ────────────────────────────────────────────────────────────────────
  { method: "PUT", path: "/api/kv/smoke-key", body: { value: "probe" }, expect: "ok", dependency: "redis" },
  { method: "GET", path: "/api/kv/smoke-key", expect: "ok", dependency: "redis" },
  { method: "DELETE", path: "/api/kv/smoke-key", expect: "ok", dependency: "redis" },

  // ── Users & roles ─────────────────────────────────────────────────────────
  { method: "GET", path: "/api/auth/users", expect: "ok" },
  { method: "POST", path: "/api/auth/users", body: {}, expect: "handled", note: "probe only" },
  {
    method: "PUT",
    path: "/api/auth/users/no-such-user",
    body: {},
    expect: "handled",
    note: "probe only",
  },
  {
    method: "DELETE",
    path: "/api/auth/users/no-such-user",
    expect: "handled",
    note: "probe only — id does not exist",
  },
  { method: "GET", path: "/api/auth/roles", expect: "ok" },
  { method: "POST", path: "/api/auth/roles", body: {}, expect: "handled", note: "probe only" },
  {
    method: "PUT",
    path: "/api/auth/roles/no-such-role",
    body: {},
    expect: "handled",
    note: "probe only",
  },
  {
    method: "DELETE",
    path: "/api/auth/roles/no-such-role",
    expect: "handled",
    note: "probe only — id does not exist",
  },

  // ── Contractor ledgers ────────────────────────────────────────────────────
  { method: "GET", path: "/api/contractor-ledgers", expect: "ok" },
  { method: "POST", path: "/api/contractor-ledgers", body: {}, expect: "handled" },
  { method: "PUT", path: "/api/contractor-ledgers", body: {}, expect: "handled" },
  { method: "POST", path: "/api/contractor-ledgers/generate", body: {}, expect: "handled" },
  { method: "GET", path: "/api/contractor-ledgers/no-such-id", expect: "handled" },
  { method: "PATCH", path: "/api/contractor-ledgers/no-such-id", body: {}, expect: "handled" },
  { method: "DELETE", path: "/api/contractor-ledgers/no-such-id", expect: "handled" },

  // ── FX ────────────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/fx/daily", expect: "ok" },

  // ── Mail (probe only — never actually sends) ──────────────────────────────
  { method: "POST", path: "/api/email/send", body: {}, expect: "handled", dependency: "smtp", note: "probe only — no recipients" },
  { method: "POST", path: "/api/email/test", body: {}, expect: "handled", dependency: "smtp", note: "probe only — no recipients" },
  { method: "POST", path: "/api/v1/email/send", body: {}, expect: "handled", dependency: "smtp", note: "probe only — no recipients" },
  { method: "POST", path: "/api/v1/email/test", body: {}, expect: "handled", dependency: "smtp", note: "probe only — no recipients" },
  { method: "GET", path: "/api/request-email-contacts", expect: "ok" },
  { method: "PUT", path: "/api/request-email-contacts", body: { contacts: [] }, expect: "handled" },

  // ── Push (probe only) ─────────────────────────────────────────────────────
  { method: "GET", path: "/api/push/vapid-public", expect: "handled", note: "404 when no VAPID key" },
  { method: "POST", path: "/api/push/subscribe", body: {}, expect: "handled" },
  { method: "DELETE", path: "/api/push/subscribe", body: {}, expect: "handled" },
  { method: "POST", path: "/api/push/unsubscribe", body: {}, expect: "handled" },
  { method: "POST", path: "/api/push/device", body: {}, expect: "handled" },
  { method: "DELETE", path: "/api/push/device", body: {}, expect: "handled" },
  { method: "POST", path: "/api/push/device/unregister", body: {}, expect: "handled" },
  { method: "POST", path: "/api/push/test", body: {}, expect: "handled", note: "probe only" },

  // ── Banking imports ───────────────────────────────────────────────────────
  { method: "POST", path: "/api/banking/bank-statements/import", body: {}, expect: "handled" },
  {
    method: "POST",
    path: "/api/banking/bank-statements/no-such-id/auto-match",
    body: {},
    expect: "handled",
  },

  // ── Approvals ─────────────────────────────────────────────────────────────
  { method: "GET", path: "/api/approvals/chain", expect: "ok" },
  { method: "GET", path: "/api/approvals/desk", expect: "ok" },
  { method: "GET", path: "/api/approvals/payment-requests/no-such-id", expect: "handled" },
  {
    method: "POST",
    path: "/api/approvals/payment-requests/no-such-id/advance",
    body: {},
    expect: "handled",
  },
  {
    method: "POST",
    path: "/api/approvals/payment-requests/no-such-id/settle",
    body: {},
    expect: "handled",
  },
  {
    method: "POST",
    path: "/api/approvals/payment-requests/no-such-id/reject",
    body: {},
    expect: "handled",
  },
  {
    method: "POST",
    path: "/api/approvals/payment-requests/no-such-id/amend",
    body: {},
    expect: "handled",
  },

  // ── Session teardown (must run last) ──────────────────────────────────────
  {
    method: "DELETE",
    path: "/api/auth/sessions",
    body: {},
    expect: "handled",
    note: "probe only — no session id",
    last: true,
  },
  { method: "POST", path: "/api/auth/logout", expect: "handled", last: true },
];

async function main() {
  await signIn();
  console.log(`API endpoint smoke against ${API}`);
  console.log(`${routes.length} routes\n`);

  const missing: string[] = [];
  const broken: string[] = [];
  const unexpected: string[] = [];
  const skipped: string[] = [];
  let passed = 0;

  const ordered = [...routes.filter((r) => !r.last), ...routes.filter((r) => r.last)];

  for (const route of ordered) {
    const label = `${route.method} ${route.path}`;
    let result: Awaited<ReturnType<typeof call>>;
    try {
      result = await call(route);
    } catch (error) {
      broken.push(`${label} — request failed: ${error instanceof Error ? error.message : error}`);
      console.log(`FAIL  ${label} :: request failed`);
      continue;
    }
    const { status, json, text } = result;
    // Handlers return either `error: "text"` or `error: { message: "text" }`.
    const rawError =
      json && typeof json === "object" && "error" in json
        ? (json as { error: unknown }).error
        : null;
    const detail =
      (typeof rawError === "string"
        ? rawError
        : rawError && typeof rawError === "object" && "message" in rawError
          ? String((rawError as { message: unknown }).message)
          : "") || text.slice(0, 90);

    if (isUnregistered(status, json, text)) {
      missing.push(`${label} — not registered (${status})`);
      console.log(`FAIL  ${label} :: route not registered (${status})`);
      continue;
    }
    if (isDependencyUnavailable(route, status, detail)) {
      skipped.push(`${label} — needs ${route.dependency}: ${detail}`);
      console.log(`SKIP  ${label} :: ${route.dependency} not available here`);
      continue;
    }
    if (status >= 500) {
      broken.push(`${label} — ${status}: ${detail}`);
      console.log(`FAIL  ${label} :: ${status} ${detail}`);
      continue;
    }
    if (status === 401 && route.serviceKeyOnly) {
      passed += 1;
      console.log(`  ok  ${label} :: 401 (correctly refuses a user token)`);
      continue;
    }
    if (status === 401) {
      unexpected.push(`${label} — 401 while signed in as Administrator`);
      console.log(`FAIL  ${label} :: 401 while signed in`);
      continue;
    }
    if (route.expect === "ok" && status >= 300) {
      unexpected.push(`${label} — expected success, got ${status}: ${detail}`);
      console.log(`FAIL  ${label} :: expected 2xx, got ${status} ${detail}`);
      continue;
    }
    passed += 1;
    const suffix = route.note ? `  (${route.note})` : "";
    console.log(`  ok  ${label} :: ${status}${suffix}`);
  }

  const failed = routes.length - passed - skipped.length;
  console.log(`\n===== SUMMARY =====`);
  console.log(
    `total=${routes.length} ok=${passed} skipped=${skipped.length} fail=${failed}`,
  );
  if (skipped.length) {
    console.log(`\n${skipped.length} route(s) unproven — backing service not configured here:`);
    for (const line of skipped) console.log(`  · ${line}`);
  }

  const problems = [
    ...missing.map((m) => `not registered: ${m}`),
    ...broken.map((m) => `server error:   ${m}`),
    ...unexpected.map((m) => `unexpected:     ${m}`),
  ];
  if (problems.length) {
    console.error(`\n${problems.length} endpoint problem(s):`);
    for (const problem of problems) console.error(` - ${problem}`);
    process.exit(1);
  }
  console.log("\nEvery API endpoint is registered and answers without a server error.");
}

await main();
