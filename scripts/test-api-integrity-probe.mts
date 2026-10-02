/**
 * Behavioural probe for the Go API — the checks a smoke test does not make.
 *
 * Smoke proves a route answers. This proves it answers *correctly* under the
 * conditions that actually lose data or money: a read-only role pushing writes,
 * two tabs saving at once, a cached collection going stale, an approval chain
 * being skipped, a locked period being written into.
 *
 * Needs an admin and a read-only user (see the header of
 * test-form-post-round-trip.mts for the local seed).
 *
 * Run against a THROWAWAY API:
 *   API_URL=http://127.0.0.1:8099 npx tsx scripts/test-api-integrity-probe.mts
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const API = (process.env.API_URL || "http://127.0.0.1:8099").replace(/\/$/, "");

if (/railway|vercel|https:/i.test(API) && !process.env.ALLOW_REMOTE_WRITE) {
  console.error(`Refusing to probe ${API}. Point API_URL at a local throwaway API.`);
  process.exit(1);
}

type Row = Record<string, string>;

const findings: Array<{ severity: "BUG" | "SUSPECT"; title: string; detail: string }> = [];
let checks = 0;
let passes = 0;

function report(severity: "BUG" | "SUSPECT", title: string, detail: string) {
  findings.push({ severity, title, detail });
  console.log(`${severity === "BUG" ? "BUG " : "??? "} ${title}`);
  console.log(`      ${detail}`);
}

function pass(title: string) {
  passes += 1;
  console.log(`  ok  ${title}`);
}

async function expect(title: string, run: () => Promise<string | null>) {
  checks += 1;
  try {
    const problem = await run();
    if (problem) report("BUG", title, problem);
    else pass(title);
  } catch (error) {
    report("SUSPECT", title, `probe threw: ${error instanceof Error ? error.message : error}`);
  }
}

async function login(identifier: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrUsername: identifier, password }),
  });
  const body = (await res.json().catch(() => null)) as { data?: { token?: string } } | null;
  if (!res.ok || !body?.data?.token) throw new Error(`login failed for ${identifier} (${res.status})`);
  return body.data.token;
}

let adminToken = "";
let viewerToken = "";

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const { token = adminToken, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(rest.headers || {}),
    },
  });
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, text, headers: res.headers };
}

async function getCollection(module: string, entity: string, token = adminToken) {
  const res = await call(`/api/records/${module}/${entity}`, { token });
  return {
    status: res.status,
    rows: (res.body?.data as Row[]) || [],
    revision: String(res.body?.revision || ""),
    etag: res.headers.get("etag") || "",
    source: String(res.body?.source || ""),
  };
}

async function putCollection(
  module: string,
  entity: string,
  records: Row[],
  extra?: { expectedRevision?: string; removeIds?: string[]; allowEmpty?: boolean; token?: string },
) {
  return call(`/api/records/${module}/${entity}`, {
    method: "PUT",
    token: extra?.token,
    body: JSON.stringify({
      records,
      ...(extra?.expectedRevision ? { expectedRevision: extra.expectedRevision } : {}),
      ...(extra?.removeIds?.length ? { removeIds: extra.removeIds } : {}),
      ...(extra?.allowEmpty ? { allowEmpty: true } : {}),
    }),
  });
}

const now = () => new Date().toISOString();
function payment(id: string, extra: Row = {}): Row {
  return {
    id,
    reference: id.toUpperCase(),
    date: "2026-08-06",
    party: "Probe payee",
    account: "Probe Bank",
    amount: "500",
    status: "Paid",
    createdAt: now(),
    updatedAt: now(),
    ...extra,
  };
}

const cleanupIds: string[] = [];

async function seed(count: number): Promise<void> {
  const before = await getCollection("banking", "payments");
  const rows = Array.from({ length: count }, (_, i) => payment(`probe-seed-${i}`));
  rows.forEach((r) => cleanupIds.push(r.id));
  await putCollection("banking", "payments", [...before.rows, ...rows], {
    expectedRevision: before.revision,
  });
}

async function main() {
  adminToken = await login(
    process.env.RT_USER || "roundtrip@test.local",
    process.env.RT_PASSWORD || "LocalTest123!",
  );
  try {
    viewerToken = await login(
      process.env.RT_VIEWER || "viewer@test.local",
      process.env.RT_VIEWER_PASSWORD || "ViewerTest123!",
    );
  } catch {
    console.log("(no read-only user seeded — permission probes will be skipped)\n");
  }

  console.log(`API integrity probe against ${API}\n`);
  await seed(12);

  // ── Permissions ───────────────────────────────────────────────────────────
  console.log("Permissions");
  if (viewerToken) {
    await expect("a read-only role cannot write a collection", async () => {
      const before = await getCollection("banking", "payments", viewerToken);
      const res = await putCollection(
        "banking",
        "payments",
        [...before.rows, payment("probe-viewer-write")],
        { expectedRevision: before.revision, token: viewerToken },
      );
      if (res.status === 200) {
        cleanupIds.push("probe-viewer-write");
        return `viewer PUT succeeded (${res.status}) — read-only role can write records`;
      }
      return null;
    });

    await expect("a read-only role cannot create via the item endpoint", async () => {
      const res = await call("/api/records/banking/payments", {
        method: "POST",
        token: viewerToken,
        body: JSON.stringify(payment("probe-viewer-item")),
      });
      if (res.status < 300) {
        cleanupIds.push("probe-viewer-item");
        return `viewer POST succeeded (${res.status})`;
      }
      return null;
    });

    await expect("a read-only role cannot delete", async () => {
      const res = await call("/api/records/banking/payments/probe-seed-0", {
        method: "DELETE",
        token: viewerToken,
      });
      if (res.status < 300) return `viewer DELETE succeeded (${res.status})`;
      return null;
    });

    await expect("a non-admin cannot reach admin-only routes", async () => {
      const admin = ["/api/analytics", "/api/auth/users", "/api/auth/roles", "/api/cron/status"];
      const leaked: string[] = [];
      for (const path of admin) {
        const res = await call(path, { token: viewerToken });
        if (res.status < 300) leaked.push(`${path} → ${res.status}`);
      }
      return leaked.length ? `non-admin reached: ${leaked.join(", ")}` : null;
    });

    await expect("a non-admin cannot wipe a collection with allowEmpty", async () => {
      const before = await getCollection("banking", "payments", viewerToken);
      const res = await putCollection("banking", "payments", [], {
        expectedRevision: before.revision,
        allowEmpty: true,
        token: viewerToken,
      });
      if (res.status === 200) return "viewer wiped the collection with allowEmpty";
      return null;
    });
  }

  await expect("an admin cannot blind-replace without a revision", async () => {
    const res = await putCollection("banking", "payments", [payment("probe-blind")]);
    if (res.status === 200) {
      cleanupIds.push("probe-blind");
      return "a PUT with no expectedRevision replaced a non-empty collection";
    }
    return null;
  });

  await expect("a truncated replace of a large collection is refused", async () => {
    // mode:"replace" is explicit caller intent (restore / reset), so it is meant
    // to shrink a collection. The backstop only catches a client that lost rows
    // locally and pushed the remainder — and it only arms at 20+ existing rows.
    // Seed past that floor, or this asserts nothing.
    const start = await getCollection("banking", "payments");
    if (start.rows.length < 24) {
      const filler = Array.from({ length: 24 - start.rows.length }, (_, i) =>
        payment(`probe-bulk-${i}`),
      );
      filler.forEach((r) => cleanupIds.push(r.id));
      await putCollection("banking", "payments", [...start.rows, ...filler], {
        expectedRevision: start.revision,
      });
    }
    const before = await getCollection("banking", "payments");
    const res = await call("/api/records/banking/payments", {
      method: "PUT",
      body: JSON.stringify({
        records: [before.rows[0]],
        mode: "replace",
        expectedRevision: before.revision,
      }),
    });
    if (res.status === 200) {
      const after = await getCollection("banking", "payments");
      return `replace with 1 row wiped ${before.rows.length - after.rows.length} of ${before.rows.length} rows`;
    }
    return null;
  });

  // ── Approval chain ────────────────────────────────────────────────────────
  console.log("\nApproval chain");
  await expect("a new request cannot be created already approved", async () => {
    const before = await getCollection("projects", "payment-requests");
    const rogue: Row = {
      id: "probe-chain-bypass",
      reference: "PR-BYPASS",
      date: "2026-08-06",
      amount: "1000000",
      status: "Paid",
      createdAt: now(),
      updatedAt: now(),
    };
    const res = await putCollection("projects", "payment-requests", [...before.rows, rogue], {
      expectedRevision: before.revision,
    });
    if (res.status === 200) {
      cleanupIds.push("probe-chain-bypass");
      return "a payment request was created already marked Paid — the approval chain is skippable";
    }
    return null;
  });

  await expect("the item endpoint enforces the same chain guard", async () => {
    const res = await call("/api/records/projects/payment-requests", {
      method: "POST",
      body: JSON.stringify({
        id: "probe-chain-bypass-item",
        reference: "PR-BYPASS-2",
        amount: "1000000",
        status: "CEO Approved",
      }),
    });
    if (res.status < 300) return "item POST created a request already at CEO Approved";
    return null;
  });

  // ── Concurrency ───────────────────────────────────────────────────────────
  console.log("\nConcurrency");
  await expect("parallel saves from many tabs never drop a row", async () => {
    const before = await getCollection("banking", "payments");
    const ids = Array.from({ length: 6 }, (_, i) => `probe-race-${i}`);
    ids.forEach((id) => cleanupIds.push(id));
    // Every tab saves against the same revision it loaded — the losers must
    // conflict, and a retry with the fresh revision must then land.
    await Promise.all(
      ids.map(async (id) => {
        for (let attempt = 0; attempt < 8; attempt++) {
          const current = await getCollection("banking", "payments");
          const res = await putCollection(
            "banking",
            "payments",
            [payment(id), ...current.rows],
            { expectedRevision: current.revision },
          );
          if (res.status === 200) return;
          if (res.status !== 409) return;
          await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
        }
      }),
    );
    const after = await getCollection("banking", "payments");
    const missing = ids.filter((id) => !after.rows.some((row) => row.id === id));
    const originals = before.rows.filter((row) => !after.rows.some((r) => r.id === row.id));
    if (missing.length) return `rows lost to the race: ${missing.join(", ")}`;
    if (originals.length) {
      return `pre-existing rows destroyed by concurrent saves: ${originals
        .map((r) => r.id)
        .join(", ")}`;
    }
    return null;
  });

  // ── Cache coherence ───────────────────────────────────────────────────────
  console.log("\nCache coherence");
  await expect("a saved row is never missing from the very next read", async () => {
    for (let i = 0; i < 12; i++) {
      const id = `probe-cache-${i}`;
      cleanupIds.push(id);
      const before = await getCollection("banking", "payments");
      const res = await putCollection("banking", "payments", [payment(id), ...before.rows], {
        expectedRevision: before.revision,
      });
      if (res.status !== 200) return `save ${i} failed with ${res.status}`;
      const after = await getCollection("banking", "payments");
      if (!after.rows.some((row) => row.id === id)) {
        return `row ${id} missing from the read straight after a successful save (source=${after.source})`;
      }
    }
    return null;
  });

  await expect("a read during a write never caches a pre-write snapshot", async () => {
    // Fire reads concurrently with a write, then assert the settled read is fresh.
    for (let i = 0; i < 6; i++) {
      const id = `probe-cacherace-${i}`;
      cleanupIds.push(id);
      const before = await getCollection("banking", "payments");
      const write = putCollection("banking", "payments", [payment(id), ...before.rows], {
        expectedRevision: before.revision,
      });
      const reads = Array.from({ length: 4 }, () => getCollection("banking", "payments"));
      const [res] = await Promise.all([write, ...reads]);
      if (res.status !== 200) continue;
      const settled = await getCollection("banking", "payments");
      if (!settled.rows.some((row) => row.id === id)) {
        return `row ${id} absent after concurrent reads (source=${settled.source}) — a stale snapshot was cached`;
      }
    }
    return null;
  });

  await expect("the ETag changes when the collection changes", async () => {
    const before = await getCollection("banking", "payments");
    const id = "probe-etag";
    cleanupIds.push(id);
    await putCollection("banking", "payments", [payment(id), ...before.rows], {
      expectedRevision: before.revision,
    });
    const after = await getCollection("banking", "payments");
    if (after.etag && before.etag && after.etag === before.etag) {
      return `ETag ${after.etag} unchanged after adding a row — clients caching on it will not see the write`;
    }
    return null;
  });

  await expect("If-None-Match returns 304 only when nothing changed", async () => {
    const current = await getCollection("banking", "payments");
    const unchanged = await call("/api/records/banking/payments", {
      headers: { "If-None-Match": current.revision },
    });
    if (unchanged.status !== 304) {
      return `expected 304 for an unchanged collection, got ${unchanged.status}`;
    }
    const id = "probe-inm";
    cleanupIds.push(id);
    await putCollection("banking", "payments", [payment(id), ...current.rows], {
      expectedRevision: current.revision,
    });
    const changed = await call("/api/records/banking/payments", {
      headers: { "If-None-Match": current.revision },
    });
    if (changed.status === 304) {
      return "304 returned after the collection changed — the client would never see the new row";
    }
    return null;
  });

  // ── Deletes ───────────────────────────────────────────────────────────────
  console.log("\nDeletes");
  await expect("removeIds deletes only the listed rows", async () => {
    const before = await getCollection("banking", "payments");
    const victim = before.rows.find((row) => row.id === "probe-seed-1");
    if (!victim) return null;
    const res = await putCollection(
      "banking",
      "payments",
      before.rows.filter((row) => row.id !== victim.id),
      { expectedRevision: before.revision, removeIds: [victim.id] },
    );
    if (res.status !== 200) return `delete failed with ${res.status}`;
    const after = await getCollection("banking", "payments");
    if (after.rows.some((row) => row.id === victim.id)) return "the row survived the delete";
    if (after.rows.length !== before.rows.length - 1) {
      return `collection went from ${before.rows.length} to ${after.rows.length} rows — expected one fewer`;
    }
    return null;
  });

  await expect("deleting an id that is not there is harmless", async () => {
    const before = await getCollection("banking", "payments");
    const res = await putCollection("banking", "payments", before.rows, {
      expectedRevision: before.revision,
      removeIds: ["no-such-row-at-all"],
    });
    if (res.status !== 200) return `unexpected ${res.status}`;
    const after = await getCollection("banking", "payments");
    if (after.rows.length !== before.rows.length) {
      return `row count changed from ${before.rows.length} to ${after.rows.length}`;
    }
    return null;
  });

  // ── Money integrity ───────────────────────────────────────────────────────
  console.log("\nMoney integrity");
  await expect("a ledger post is idempotent", async () => {
    const id = "probe-ledger";
    cleanupIds.push(id);
    const before = await getCollection("banking", "payments");
    await putCollection("banking", "payments", [payment(id), ...before.rows], {
      expectedRevision: before.revision,
    });
    const linesFor = async () => {
      const res = await call("/api/ledger/lines");
      const lines = (res.body?.data as Array<Record<string, string>>) || [];
      return lines.filter((line) => line.sourceRecordId === id);
    };
    await call("/api/ledger/post", {
      method: "POST",
      body: JSON.stringify({ module: "banking", entity: "payments", recordId: id }),
    });
    const first = await linesFor();
    await call("/api/ledger/post", {
      method: "POST",
      body: JSON.stringify({ module: "banking", entity: "payments", recordId: id }),
    });
    const second = await linesFor();
    if (first.length && second.length !== first.length) {
      return `posting twice changed the journal from ${first.length} to ${second.length} lines — duplicated GL`;
    }
    return null;
  });

  await expect("journal lines for a document balance", async () => {
    // /api/ledger/lines pages at 500. Reading one page splits documents across
    // the boundary and every straddled entry looks half-posted — follow
    // nextOffset or this reports balanced books as broken.
    const lines: Array<Record<string, string>> = [];
    let offset = 0;
    for (let page = 0; page < 200; page++) {
      const res = await call(`/api/ledger/lines?offset=${offset}`);
      const batch = (res.body?.data as Array<Record<string, string>>) || [];
      lines.push(...batch);
      if (res.body?.hasMore !== true || !batch.length) break;
      offset = Number(res.body?.nextOffset ?? offset + batch.length);
    }
    const bySource = new Map<string, { debit: number; credit: number }>();
    for (const line of lines) {
      const key = String(line.sourceRecordId || "");
      if (!key) continue;
      const acc = bySource.get(key) || { debit: 0, credit: 0 };
      acc.debit += Number(line.debit || 0);
      acc.credit += Number(line.credit || 0);
      bySource.set(key, acc);
    }
    const unbalanced = [...bySource.entries()]
      .filter(([, v]) => Math.abs(v.debit - v.credit) > 0.005)
      .map(([k, v]) => `${k} (Dr ${v.debit} vs Cr ${v.credit})`);
    if (unbalanced.length) {
      return `documents whose journal does not balance: ${unbalanced.slice(0, 5).join(", ")}`;
    }
    return null;
  });

  await expect("a negative payment amount is rejected", async () => {
    const before = await getCollection("banking", "payments");
    const res = await putCollection(
      "banking",
      "payments",
      [payment("probe-negative", { amount: "-5000" }), ...before.rows],
      { expectedRevision: before.revision },
    );
    if (res.status === 200) {
      cleanupIds.push("probe-negative");
      return "a payment of -5000 was accepted";
    }
    return null;
  });

  // ── Catalog / input handling ──────────────────────────────────────────────
  console.log("\nInput handling");
  await expect("an unknown entity is refused", async () => {
    const res = await call("/api/records/banking/totally-made-up", { method: "GET" });
    if (res.status < 300) return `GET on an unknown entity returned ${res.status}`;
    return null;
  });

  await expect("an unknown module is not silently stored", async () => {
    const res = await call("/api/records/not-a-module/payments", {
      method: "PUT",
      body: JSON.stringify({ records: [payment("probe-badmodule")] }),
    });
    if (res.status === 200) {
      return "records were stored under a module slug that does not exist — they are unreachable from any page";
    }
    return null;
  });

  await expect("an oversized field is refused, not stored", async () => {
    const before = await getCollection("banking", "payments");
    const huge = payment("probe-huge", { note: "x".repeat(13 << 20) });
    const res = await putCollection("banking", "payments", [huge, ...before.rows], {
      expectedRevision: before.revision,
    });
    if (res.status === 200) {
      cleanupIds.push("probe-huge");
      return "a 13 MB field was accepted";
    }
    return null;
  });
}

async function cleanup() {
  const before = await getCollection("banking", "payments");
  const ids = [...new Set(cleanupIds)];
  await putCollection(
    "banking",
    "payments",
    before.rows.filter((row) => !ids.includes(row.id)),
    { expectedRevision: before.revision, removeIds: ids },
  );
}

try {
  await main();
} finally {
  try {
    await cleanup();
  } catch {
    /* best effort */
  }
}

console.log(`\n===== SUMMARY =====`);
console.log(`checks=${checks} passed=${passes} findings=${findings.length}`);
if (findings.length) {
  console.log(`\nFindings:`);
  for (const f of findings) console.log(` [${f.severity}] ${f.title}\n        ${f.detail}`);
  process.exit(1);
}
console.log("\nNo integrity problems found.");
