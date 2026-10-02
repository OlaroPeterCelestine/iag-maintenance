/**
 * Save cost must not grow with the size of the collection.
 *
 * Every save used to PUT the entire collection: one new payment re-uploaded
 * every payment ever entered, and the API deleted and re-inserted the whole
 * table to store it. At a few hundred rows that is a slow save; at the volumes
 * this system is being pointed at it is megabytes per keystroke-sized edit and
 * a table rewrite per user action. This measures the write path the UI actually
 * uses and fails if cost tracks collection size.
 *
 * Run against a THROWAWAY API:
 *   API_URL=http://127.0.0.1:8099 npx tsx scripts/test-single-record-writes.mts
 */
import assert from "node:assert/strict";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const API = (process.env.API_URL || "http://127.0.0.1:8099").replace(/\/$/, "");
if (/railway|vercel|https:/i.test(API) && !process.env.ALLOW_REMOTE_WRITE) {
  console.error(`Refusing to write to ${API}. Point API_URL at a local throwaway API.`);
  process.exit(1);
}

type Row = Record<string, string>;

const failures: string[] = [];
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

let token = "";
let bytesSent = 0;

async function signIn() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrUsername: process.env.RT_USER || "roundtrip@test.local",
      password: process.env.RT_PASSWORD || "LocalTest123!",
    }),
  });
  const body = (await res.json()) as { data?: { token?: string } };
  if (!body.data?.token) throw new Error(`login failed (${res.status})`);
  token = body.data.token;
}

async function api(path: string, init: RequestInit = {}) {
  if (typeof init.body === "string") bytesSent += Buffer.byteLength(init.body);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

const M = "banking";
const E = "payments";

async function collection() {
  const res = await api(`/api/records/${M}/${E}`);
  return {
    rows: (res.body?.data as Row[]) || [],
    revision: String(res.body?.revision || ""),
  };
}

function payment(id: string, extra: Row = {}): Row {
  return {
    id,
    reference: id.toUpperCase(),
    date: "2026-08-06",
    party: "Scale payee",
    account: "Scale Bank",
    amount: "1500",
    status: "Paid",
    // Realistic row weight: real payments carry notes, allocations, addresses.
    notes: "x".repeat(400),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

/** Bytes the client must upload to add ONE row to a collection of `size`. */
async function costOfOneSave(size: number): Promise<number> {
  const current = await collection();
  const need = size - current.rows.length;
  if (need > 0) {
    const filler = Array.from({ length: need }, (_, i) => payment(`scale-fill-${size}-${i}`));
    const res = await api(`/api/records/${M}/${E}`, {
      method: "PUT",
      body: JSON.stringify({
        records: [...current.rows, ...filler],
        expectedRevision: current.revision,
      }),
    });
    assert.equal(res.status, 200, `seeding to ${size} failed: ${res.status} ${res.text.slice(0, 150)}`);
  }
  const before = bytesSent;
  const res = await api(`/api/records/${M}/${E}`, {
    method: "POST",
    body: JSON.stringify(payment(`scale-probe-${size}`)),
  });
  assert.ok(res.status < 300, `item create failed: ${res.status} ${res.text.slice(0, 150)}`);
  return bytesSent - before;
}

/**
 * A money document can only post if its bank and contra accounts exist. A blank
 * test database has no chart of accounts, so seed the two the payment builder
 * resolves — otherwise the ledger assertion below tests the fixture, not the code.
 */
async function ensureChartOfAccounts() {
  const existing = await api("/api/ledger/accounts");
  const accounts = (existing.body?.data as Array<Record<string, unknown>>) || [];
  const have = new Set(accounts.map((a) => String(a.name || "").toLowerCase()));
  if (have.has("scale bank") && have.has("operating expenses")) return;
  const res = await api("/api/ledger/accounts", {
    method: "PUT",
    body: JSON.stringify({
      accounts: [
        ...accounts,
        { id: "acct-scale-bank", code: "1001", name: "Scale Bank", type: "Asset", group: "Bank" },
        {
          id: "acct-scale-opex",
          code: "5001",
          name: "Operating expenses",
          type: "Expense",
          group: "Operating expenses",
        },
      ],
    }),
  });
  if (res.status >= 300) {
    throw new Error(`could not seed the chart of accounts: ${res.status} ${res.text.slice(0, 150)}`);
  }
}

async function main() {
  await signIn();
  console.log(`Single-record write cost against ${API}\n`);
  await ensureChartOfAccounts();

  let smallCost = 0;
  let largeCost = 0;

  await check("adding a row to a small collection is cheap", async () => {
    smallCost = await costOfOneSave(10);
    assert.ok(smallCost > 0, "measured nothing");
  });

  await check("adding a row to a large collection costs the same", async () => {
    largeCost = await costOfOneSave(400);
    const ratio = largeCost / Math.max(1, smallCost);
    console.log(
      `      10 rows: ${smallCost} B   400 rows: ${largeCost} B   ratio ${ratio.toFixed(2)}×`,
    );
    assert.ok(
      ratio < 1.5,
      `save cost grew ${ratio.toFixed(1)}× between a 10-row and a 400-row collection — ` +
        `the write is still proportional to the collection`,
    );
  });

  await check("the whole-collection PUT would have been far more expensive", async () => {
    const current = await collection();
    const collectionPayload = Buffer.byteLength(
      JSON.stringify({ records: [payment("scale-compare"), ...current.rows] }),
    );
    const ratio = collectionPayload / Math.max(1, largeCost);
    console.log(
      `      collection PUT: ${collectionPayload} B vs item POST: ${largeCost} B  (${ratio.toFixed(0)}× more)`,
    );
    assert.ok(
      ratio > 10,
      `expected the collection write to be far larger; got ${ratio.toFixed(1)}×`,
    );
  });

  await check("an item create is durable and readable", async () => {
    const id = "scale-durable";
    const res = await api(`/api/records/${M}/${E}`, {
      method: "POST",
      body: JSON.stringify(payment(id, { party: "Durable payee" })),
    });
    assert.ok(res.status < 300, `create failed ${res.status}`);
    const read = await api(`/api/records/${M}/${E}/${id}`);
    assert.equal(read.status, 200, "row not readable after create");
    const row = read.body?.data as Row;
    assert.equal(row.party, "Durable payee");
    const list = await collection();
    assert.ok(list.rows.some((r) => r.id === id), "row missing from the collection read");
    assert.equal(list.rows[0]?.id, id, "newly created row is not first in the collection");
  });

  await check("a patch changes only the fields sent", async () => {
    const id = "scale-durable";
    const before = await api(`/api/records/${M}/${E}/${id}`);
    const beforeRow = before.body?.data as Row;
    const res = await api(`/api/records/${M}/${E}/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ party: "Renamed payee" }),
    });
    assert.equal(res.status, 200, `patch failed ${res.status}`);
    const after = await api(`/api/records/${M}/${E}/${id}`);
    const afterRow = after.body?.data as Row;
    assert.equal(afterRow.party, "Renamed payee", "patch did not apply");
    assert.equal(afterRow.amount, beforeRow.amount, "patch changed an untouched field");
    assert.equal(afterRow.reference, beforeRow.reference, "patch dropped an untouched field");
    assert.equal(afterRow.createdAt, beforeRow.createdAt, "patch rewrote createdAt");
  });

  await check("a patch posts the journal without a second round trip", async () => {
    const res = await api(`/api/records/${M}/${E}/scale-durable`, {
      method: "PATCH",
      body: JSON.stringify({ amount: "2750" }),
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.body?.ledgerPosted,
      true,
      "the money write did not report a ledger post — the client would have to post separately",
    );
    const lines = await api("/api/ledger/lines");
    const mine = ((lines.body?.data as Row[]) || []).filter(
      (l) => l.sourceRecordId === "scale-durable",
    );
    const debit = mine.reduce((sum, l) => sum + Number(l.debit || 0), 0);
    assert.equal(debit, 2750, `journal did not follow the edit — debit total ${debit}`);
  });

  await check("a delete removes exactly one row", async () => {
    const before = await collection();
    const res = await api(`/api/records/${M}/${E}/scale-durable`, { method: "DELETE" });
    assert.equal(res.status, 200, `delete failed ${res.status}`);
    const after = await collection();
    assert.equal(after.rows.length, before.rows.length - 1, "delete removed the wrong number of rows");
    assert.ok(!after.rows.some((r) => r.id === "scale-durable"), "row survived the delete");
  });

  // Clean up everything this test wrote.
  const current = await collection();
  const mine = current.rows.filter((r) => r.id.startsWith("scale-")).map((r) => r.id);
  if (mine.length) {
    await api(`/api/records/${M}/${E}`, {
      method: "PUT",
      body: JSON.stringify({
        records: current.rows.filter((r) => !mine.includes(r.id)),
        expectedRevision: current.revision,
        removeIds: mine,
        allowEmpty: current.rows.length === mine.length,
      }),
    });
  }
}

await main();

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("\nSingle-record writes hold: save cost is flat as the collection grows.");
