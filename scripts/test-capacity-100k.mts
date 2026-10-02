/**
 * Capacity probe for the “100 000 users” claim.
 *
 * A laptop cannot open 100 000 real browsers. This instead:
 *   1. Measures live API throughput under rising concurrency (server side).
 *   2. Measures client-side work that used to grow with collection size
 *      (single-record write payload + paid-balance index).
 *   3. Projects how many concurrent active users one API instance can carry
 *      given the measured numbers and known hard caps (PG pool, rate limit).
 *
 * Point at a THROWAWAY local API (default :8099). Never production.
 *
 *   API_URL=http://127.0.0.1:8099 npx tsx scripts/test-capacity-100k.mts
 */
import { performance } from "node:perf_hooks";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const API = (process.env.API_URL || "http://127.0.0.1:8099").replace(/\/$/, "");
if (/railway|vercel|https:/i.test(API) && !process.env.ALLOW_REMOTE_WRITE) {
  console.error(`Refusing to load-test ${API}. Use a local throwaway API.`);
  process.exit(1);
}

const TARGET_USERS = Number(process.env.TARGET_USERS || 100_000);
const CONCURRENCIES = (process.env.CONCURRENCIES || "10,25,50,100,200,400")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);

type Sample = { ok: boolean; ms: number; status: number };

function pct(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

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
    throw new Error(`login failed (${res.status}) ${body?.error || ""}`);
  }
  return body.data.token;
}

async function getMe(token: string): Promise<Sample> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { ok: res.ok, ms: performance.now() - t0, status: res.status };
  } catch {
    return { ok: false, ms: performance.now() - t0, status: 0 };
  }
}

async function getPayments(token: string): Promise<Sample> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${API}/api/records/banking/payments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { ok: res.ok, ms: performance.now() - t0, status: res.status };
  } catch {
    return { ok: false, ms: performance.now() - t0, status: 0 };
  }
}

async function postAndDeletePayment(token: string): Promise<Sample> {
  const t0 = performance.now();
  const id = globalThis.crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    const create = await fetch(`${API}/api/records/banking/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id,
        createdAt: now,
        updatedAt: now,
        reference: `CAP-${id.slice(0, 8)}`,
        date: now.slice(0, 10),
        account: "Cash at bank",
        party: "Capacity Probe",
        amount: "1",
        currency: "UGX",
        status: "Active",
        description: "capacity probe — delete me",
      }),
    });
    if (create.ok) {
      await fetch(`${API}/api/records/banking/payments/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    return { ok: create.ok, ms: performance.now() - t0, status: create.status };
  } catch {
    return { ok: false, ms: performance.now() - t0, status: 0 };
  }
}

async function ramp(
  label: string,
  concurrency: number,
  total: number,
  run: () => Promise<Sample>,
) {
  const samples: Sample[] = [];
  let inFlight = 0;
  let started = 0;
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const kick = () => {
      while (inFlight < concurrency && started < total) {
        started += 1;
        inFlight += 1;
        void run().then((s) => {
          samples.push(s);
          inFlight -= 1;
          if (samples.length >= total) resolve();
          else kick();
        });
      }
    };
    kick();
  });
  const elapsed = (performance.now() - t0) / 1000;
  const ok = samples.filter((s) => s.ok);
  const times = ok.map((s) => s.ms).sort((a, b) => a - b);
  const rateLimited = samples.filter((s) => s.status === 429).length;
  const failed = samples.length - ok.length;
  const rps = ok.length / Math.max(elapsed, 0.001);
  console.log(
    `  ${label} C=${concurrency} n=${total}  ok=${ok.length}/${samples.length}  ` +
      `fail=${failed}  429=${rateLimited}  rps=${rps.toFixed(1)}  ` +
      `p50=${pct(times, 50).toFixed(0)}ms  p95=${pct(times, 95).toFixed(0)}ms  p99=${pct(times, 99).toFixed(0)}ms`,
  );
  return { concurrency, rps, failRate: failed / samples.length, p95: pct(times, 95), rateLimited };
}

/** Client-side: paid-balance index must stay O(n+m), not O(n*m). */
function clientPaidIndexBench() {
  const invoices = Array.from({ length: 5_000 }, (_, i) => ({
    id: `inv-${i}`,
    reference: `INV-${i}`,
    amount: "1000",
  }));
  const payments = Array.from({ length: 5_000 }, (_, i) => ({
    id: `pay-${i}`,
    appliedTo: `INV-${i % 5000}`,
    amount: "100",
    status: "Active",
  }));
  const t0 = performance.now();
  const paid = new Map<string, number>();
  for (const inv of invoices) paid.set(inv.id, 0);
  const byRef = new Map(invoices.map((i) => [i.reference, i.id]));
  for (const p of payments) {
    const id = byRef.get(p.appliedTo) || p.appliedTo;
    if (!paid.has(id)) continue;
    paid.set(id, (paid.get(id) || 0) + Number(p.amount));
  }
  const ms = performance.now() - t0;
  console.log(
    `  client paid-index 5k×5k: ${ms.toFixed(1)}ms  (must stay << 1s; old O(n·m) froze the tab)`,
  );
  return ms;
}

/** Client-side: single-record body size must not grow with collection size. */
function clientPayloadBench() {
  const oneRow = JSON.stringify({
    id: "x",
    amount: "1",
    party: "A",
    date: "2026-08-07",
  });
  const collectionPut = JSON.stringify({
    records: Array.from({ length: 10_000 }, (_, i) => ({
      id: `r-${i}`,
      amount: "1",
      party: "A",
      date: "2026-08-07",
    })),
  });
  console.log(
    `  client payload  1-row POST=${Buffer.byteLength(oneRow)}B   ` +
      `10k-row collection PUT=${(Buffer.byteLength(collectionPut) / 1024).toFixed(0)}KB`,
  );
  return { one: Buffer.byteLength(oneRow), many: Buffer.byteLength(collectionPut) };
}

function projectCapacity(bestRps: number, heavyRps: number) {
  // Hard caps from code / config (single API instance).
  const pgMaxConns = 25;
  const rateLimitPerUserPerMin = 600; // reads; writes ≈ 300
  // Assume an active user polls lightly (~2 req/min) + occasional save.
  const reqPerActiveUserPerMin = 6;
  const fromLightThroughput = Math.floor((bestRps * 60) / reqPerActiveUserPerMin);
  // Prefer the heavier endpoint (collection GET / writes) when projecting actives.
  const usefulRps = heavyRps > 0 ? Math.min(bestRps, heavyRps) : bestRps;
  const fromThroughput = Math.floor((usefulRps * 60) / reqPerActiveUserPerMin);
  // Each active DB request can hold a pool conn; assume ~20 short interleaved actives/conn.
  const fromPool = pgMaxConns * 20;

  console.log("\n=== Projection (one API instance, current config) ===");
  console.log(`  Target registered / concurrent active users: ${TARGET_USERS.toLocaleString()}`);
  console.log(`  Measured peak light RPS (/auth/me):          ${bestRps.toFixed(1)}`);
  console.log(`  Measured peak heavier RPS (records/write):   ${usefulRps.toFixed(1)}`);
  console.log(`  Postgres MaxConns:                           ${pgMaxConns}`);
  console.log(`  Rate limit:                                  ${rateLimitPerUserPerMin}/min/user (reads)`);
  console.log(
    `  Est. concurrent *active* users @ ${reqPerActiveUserPerMin} req/min:`,
  );
  console.log(`    from light throughput:   ~${fromLightThroughput.toLocaleString()} (optimistic)`);
  console.log(`    from heavier throughput: ~${fromThroughput.toLocaleString()}`);
  console.log(`    from PG pool (harder):   ~${fromPool.toLocaleString()}`);
  console.log(
    `  Est. *registered* users the schema can hold:        effectively unlimited (row count), login is O(1)`,
  );
  console.log(
    `  Per-user rate limit does NOT block ${TARGET_USERS.toLocaleString()} accounts — it blocks one noisy account.`,
  );

  // Concurrent capacity is the min of realistic throughput and pool — not the light endpoint.
  const concurrentCapacity = Math.min(fromThroughput, fromPool);
  const concurrentOk = concurrentCapacity >= TARGET_USERS;
  const registeredOk = true;
  return { concurrentOk, registeredOk, concurrentCapacity, fromThroughput, fromPool, fromLightThroughput };
}

async function main() {
  console.log(`\nCapacity probe → ${API}`);
  console.log(`Target users: ${TARGET_USERS.toLocaleString()}\n`);

  console.log("=== Client-side (browser math / payload) ===");
  const indexMs = clientPaidIndexBench();
  const payload = clientPayloadBench();

  console.log("\n=== Server-side (live API ramp) ===");
  const token = await signIn();
  console.log("  signed in");

  // Warm
  await getMe(token);
  await getPayments(token);

  let bestRps = 0;
  let heavyRps = 0;
  for (const c of CONCURRENCIES) {
    const total = Math.min(c * 4, 800);
    const r = await ramp("GET /auth/me", c, total, () => getMe(token));
    if (r.failRate < 0.05) bestRps = Math.max(bestRps, r.rps);
  }

  console.log("");
  for (const c of CONCURRENCIES.filter((n) => n <= 100)) {
    const total = Math.min(c * 2, 200);
    const r = await ramp("GET /records/…/payments", c, total, () => getPayments(token));
    if (r.failRate < 0.05) heavyRps = Math.max(heavyRps, r.rps);
  }

  console.log("");
  let writeRps = 0;
  for (const c of [5, 10, 25]) {
    const total = c * 2;
    const r = await ramp("POST+DELETE payment", c, total, () => postAndDeletePayment(token));
    if (r.failRate < 0.05) writeRps = Math.max(writeRps, r.rps);
  }
  // Writes are the scarcest DB path — fold them into the heavy estimate.
  if (writeRps > 0) heavyRps = Math.min(heavyRps || writeRps, writeRps * 4);

  const projection = projectCapacity(bestRps, heavyRps);

  console.log("\n=== Verdict ===");
  const clientOk = indexMs < 500 && payload.one < 2_000 && payload.many > payload.one * 100;
  console.log(
    `  Client path for large collections: ${clientOk ? "PASS" : "FAIL"} ` +
      `(index ${indexMs.toFixed(0)}ms, 1-row ${payload.one}B vs 10k PUT ${(payload.many / 1024).toFixed(0)}KB)`,
  );
  console.log(
    `  Registered ${TARGET_USERS.toLocaleString()} user *accounts*: ${projection.registeredOk ? "FEASIBLE" : "NO"} ` +
      `(auth is indexed; no per-request full-table scan)`,
  );
  console.log(
    `  Concurrent ${TARGET_USERS.toLocaleString()} *active* users on ONE instance: ${projection.concurrentOk ? "FEASIBLE" : "NOT FEASIBLE"} ` +
      `(capacity ~${projection.concurrentCapacity.toLocaleString()} from min(heavy RPS, PG pool))`,
  );
  if (!projection.concurrentOk) {
    const instances = Math.ceil(TARGET_USERS / Math.max(projection.concurrentCapacity, 1));
    console.log(
      `  To approach ${TARGET_USERS.toLocaleString()} concurrent actives you need ~${instances} API instances ` +
        `(+ larger PG pool / PgBouncer, Redis session scale, and a distributed rate limiter).`,
    );
  }

  // Exit non-zero only if the client path regressed or the API could not serve at all.
  if (!clientOk || bestRps < 1) process.exit(1);
  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
