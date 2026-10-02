/**
 * Live write/read round trip against a running Go API.
 *
 * The "I saved it and it disappeared" reports all come down to one question the
 * unit tests cannot answer: does a form submit actually land in Postgres, and
 * does the very next read hand it back — in a position the user can find?
 *
 * This drives the same endpoints the browser uses (PUT/GET
 * /api/records/:module/:entity) for payments first, then every other form
 * entity, and checks:
 *   - the row is durable (survives a fresh GET)
 *   - it is not on a random page (the collection comes back newest-first)
 *   - a second save does not reshuffle the collection
 *   - concurrent saves from two tabs never drop a row
 *
 * Point it at a THROWAWAY database — it writes and then deletes its own rows.
 *
 * Run: API_URL=http://127.0.0.1:8099 JWT_SECRET=… npx tsx scripts/test-form-post-round-trip.mts
 */
import assert from "node:assert/strict";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const API = (process.env.API_URL || "http://127.0.0.1:8099").replace(/\/$/, "");

if (/railway|vercel|https:/i.test(API) && !process.env.ALLOW_REMOTE_WRITE) {
  console.error(
    `Refusing to write to ${API}. This test creates and deletes records — point API_URL at a local\n` +
      `throwaway API, or set ALLOW_REMOTE_WRITE=1 if you really mean it.`,
  );
  process.exit(1);
}

const failures: string[] = [];
async function check(name: string, run: () => Promise<void> | void) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.log(`FAIL  ${name}`);
    console.log(`      ${message}`);
  }
}

type Row = Record<string, string>;

let token = "";

/**
 * Sign in the way the browser does. A hand-minted JWT is not enough: the API
 * only accepts a jti that matches a live row in auth_sessions.
 */
async function signIn() {
  const identifier = process.env.RT_USER || "roundtrip@test.local";
  const password = process.env.RT_PASSWORD || "LocalTest123!";
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrUsername: identifier, password }),
  });
  const body = (await res.json().catch(() => null)) as {
    data?: { token?: string };
    error?: string;
  } | null;
  if (!res.ok || !body?.data?.token) {
    throw new Error(
      `login failed (${res.status}): ${body?.error || "no token"}. Seed a local admin first — ` +
        `see the header of this file.`,
    );
  }
  token = body.data.token;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
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

async function getRecords(module: string, entity: string) {
  const res = await api(`/api/records/${module}/${entity}`);
  assert.equal(res.status, 200, `GET ${module}/${entity} → ${res.status}: ${res.text.slice(0, 200)}`);
  return {
    rows: (res.body?.data as Row[]) || [],
    revision: String(res.body?.revision || ""),
  };
}

/** Mirrors the browser: send the full collection plus the new row, with the revision we hold. */
async function putRecords(
  module: string,
  entity: string,
  records: Row[],
  extra?: { expectedRevision?: string; removeIds?: string[] },
) {
  return api(`/api/records/${module}/${entity}`, {
    method: "PUT",
    body: JSON.stringify({
      records,
      ...(extra?.expectedRevision ? { expectedRevision: extra.expectedRevision } : {}),
      ...(extra?.removeIds?.length ? { removeIds: extra.removeIds } : {}),
    }),
  });
}

const stamp = (isoMinutesAgo: number) =>
  new Date(Date.UTC(2026, 7, 6, 12, 0, 0) - isoMinutesAgo * 60_000).toISOString();

function payment(index: number, minutesAgo: number): Row {
  return {
    id: `rt-payment-${index}`,
    reference: `PV-RT-${String(index).padStart(3, "0")}`,
    date: "2026-08-06",
    party: `Test payee ${index}`,
    account: "Test Bank",
    amount: String(1000 + index),
    status: "Paid",
    createdAt: stamp(minutesAgo),
    updatedAt: stamp(minutesAgo),
  };
}

const createdKeys: Array<{ module: string; entity: string; ids: string[] }> = [];

async function cleanup() {
  for (const { module, entity, ids } of createdKeys) {
    const { rows, revision } = await getRecords(module, entity);
    const keep = rows.filter((row) => !ids.includes(row.id));
    await putRecords(module, entity, keep, { expectedRevision: revision, removeIds: ids });
  }
}

async function main() {
  await signIn();

  const health = await api("/api/health");
  assert.equal(health.status, 200, `API not reachable at ${API}`);
  console.log(`Live form round trip against ${API}\n`);

  console.log("Payments (banking/payments)");

  // Seed a collection big enough that one page of ten cannot hold it — the
  // condition under which a mis-ordered row reads as deleted.
  const seeded = Array.from({ length: 24 }, (_, i) => payment(i, 100 - i));
  createdKeys.push({
    module: "banking",
    entity: "payments",
    ids: [...seeded.map((row) => row.id), "rt-payment-new", "rt-payment-tab-b"],
  });

  const start = await getRecords("banking", "payments");
  const seedPut = await putRecords("banking", "payments", [...start.rows, ...seeded], {
    expectedRevision: start.revision,
  });
  assert.equal(seedPut.status, 200, `seed PUT → ${seedPut.status}: ${seedPut.text.slice(0, 300)}`);

  await check("a submitted payment is in the database on the next read", async () => {
    const before = await getRecords("banking", "payments");
    const fresh: Row = {
      ...payment(999, 0),
      id: "rt-payment-new",
      reference: "PV-RT-NEW",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const saved = await putRecords("banking", "payments", [fresh, ...before.rows], {
      expectedRevision: before.revision,
    });
    assert.equal(saved.status, 200, `PUT → ${saved.status}: ${saved.text.slice(0, 300)}`);

    const after = await getRecords("banking", "payments");
    const landed = after.rows.find((row) => row.id === "rt-payment-new");
    assert.ok(landed, "the payment is not in the collection the API serves back");
    assert.equal(landed!.reference, "PV-RT-NEW", "the payment came back with the wrong data");
    assert.equal(landed!.amount, "1999", "amount did not survive the round trip");
  });

  await check("the saved payment is on the first page, not a random one", async () => {
    const { rows } = await getRecords("banking", "payments");
    const position = rows.findIndex((row) => row.id === "rt-payment-new");
    assert.ok(position >= 0, "payment missing entirely");
    assert.ok(
      position < 10,
      `payment came back at position ${position + 1} of ${rows.length} — page ${
        Math.floor(position / 10) + 1
      } of a ten-row table, so the user cannot see it`,
    );
    assert.equal(position, 0, `newest payment should head the list, got position ${position + 1}`);
  });

  await check("the echoed payload matches what the next GET returns", async () => {
    // If these disagree the table repaints in one order and reloads in another.
    const before = await getRecords("banking", "payments");
    const touched = before.rows.map((row) =>
      row.id === "rt-payment-new" ? { ...row, party: "Touched payee" } : row,
    );
    const res = await putRecords("banking", "payments", touched, {
      expectedRevision: before.revision,
    });
    assert.equal(res.status, 200, `PUT → ${res.status}`);
    const echoed = ((res.body?.data as Row[]) || []).map((row) => row.id);
    const reread = (await getRecords("banking", "payments")).rows.map((row) => row.id);
    assert.deepEqual(echoed, reread, "PUT echo and GET disagree on the order of the collection");
  });

  await check("saving again does not reshuffle the collection", async () => {
    const first = (await getRecords("banking", "payments")).rows.map((row) => row.id);
    for (let i = 0; i < 3; i++) {
      const current = await getRecords("banking", "payments");
      const res = await putRecords(
        "banking",
        "payments",
        current.rows.map((row) =>
          row.id === "rt-payment-new" ? { ...row, note: `pass ${i}` } : row,
        ),
        { expectedRevision: current.revision },
      );
      assert.equal(res.status, 200, `PUT ${i} → ${res.status}`);
    }
    const after = (await getRecords("banking", "payments")).rows.map((row) => row.id);
    assert.deepEqual(after, first, "the collection order changed between saves");
  });

  await check("a second tab saving does not drop the first tab's payment", async () => {
    const shared = await getRecords("banking", "payments");
    const tabB: Row = {
      ...payment(1000, 0),
      id: "rt-payment-tab-b",
      reference: "PV-RT-TAB-B",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Tab B saves against the revision both tabs loaded.
    const bRes = await putRecords("banking", "payments", [tabB, ...shared.rows], {
      expectedRevision: shared.revision,
    });
    assert.equal(bRes.status, 200, `tab B PUT → ${bRes.status}`);

    // Tab A now saves with the stale revision it still holds — the API must
    // reject it rather than overwrite tab B's row away.
    const aRes = await putRecords(
      "banking",
      "payments",
      shared.rows.map((row) =>
        row.id === "rt-payment-new" ? { ...row, party: "Tab A edit" } : row,
      ),
      { expectedRevision: shared.revision },
    );
    assert.equal(aRes.status, 409, `stale save should conflict, got ${aRes.status}`);

    const after = await getRecords("banking", "payments");
    assert.ok(
      after.rows.some((row) => row.id === "rt-payment-tab-b"),
      "tab B's payment was lost",
    );
    assert.ok(
      after.rows.some((row) => row.id === "rt-payment-new"),
      "the earlier payment was lost",
    );
  });

  await check("deleting a payment removes exactly that row", async () => {
    const before = await getRecords("banking", "payments");
    const res = await putRecords(
      "banking",
      "payments",
      before.rows.filter((row) => row.id !== "rt-payment-tab-b"),
      { expectedRevision: before.revision, removeIds: ["rt-payment-tab-b"] },
    );
    assert.equal(res.status, 200, `delete PUT → ${res.status}: ${res.text.slice(0, 200)}`);
    const after = await getRecords("banking", "payments");
    assert.ok(!after.rows.some((row) => row.id === "rt-payment-tab-b"), "delete did not take");
    assert.equal(
      after.rows.length,
      before.rows.length - 1,
      "delete removed more than the one row",
    );
  });

  console.log("\nEvery other form entity");

  const { PAGE_ENTITY_CATALOG } = await import("../src/lib/db/page-entity-catalog.ts");
  const durable = PAGE_ENTITY_CATALOG.filter((row) => row.table);
  // Chained requests reject a status they did not approve, and money documents
  // are covered above — this sweep is about the plain "does it store" contract.
  const sweep = durable.filter(
    (row) => !(row.storageModule === "banking" && row.entity === "payments"),
  );

  /**
   * Seeds for validators that check more than presence (POS line arithmetic,
   * unique employee ids). Everything else is filled in adaptively below.
   */
  const REQUIRED_FIELDS: Record<string, Row> = {
    employees: { code: "RT-EMP-001" },
    "pos-sales": { quantity: "1", unitPrice: "100", lineTotal: "100", total: "100" },
  };

  /**
   * Validators report one missing field per attempt, so a fixed seed list goes
   * stale the moment anyone adds a rule. Read the field out of the error and
   * fill it instead — the sweep then keeps proving storage, not guessing schema.
   */
  const MISSING_FIELD = /^(?:(.+?) is required for|.*?\brequires? (.+?)\b)/i;
  function fieldFromError(detail: string): string {
    const match = detail.match(MISSING_FIELD);
    const raw = (match?.[1] || match?.[2] || "").trim();
    // Validators name the field key ("fromLocation") or its label ("Employee ID").
    if (!raw || /\s/.test(raw)) return "";
    return raw;
  }
  function valueForField(field: string): string {
    if (/qty|quantity|packages|count|number$/i.test(field)) return "1";
    if (/amount|total|price|cost|value|rate/i.test(field)) return "100";
    if (/date$/i.test(field)) return "2026-08-06";
    if (/email/i.test(field)) return "round-trip@test.local";
    if (/status/i.test(field)) return "Active";
    if (/stage/i.test(field)) return "New";
    return `RT ${field}`;
  }

  const lost: string[] = [];
  const rejected: string[] = [];
  // A 400 that names a missing field is the API doing its job — this sweep
  // sends one generic probe row, not a filled-in form. Only unexpected refusals
  // (5xx, auth, revision handling) count as failures.
  const validated: string[] = [];
  for (const row of sweep) {
    const module = row.storageModule;
    const entity = row.entity;
    const id = `rt-sweep-${entity}`;
    const probe: Row = {
      id,
      name: `Round trip ${entity}`,
      reference: `RT-${entity}`,
      date: "2026-08-06",
      amount: "100",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(REQUIRED_FIELDS[entity] || {}),
    };
    try {
      // Fill required fields as the validator names them, up to a bound so a
      // rule this loop cannot satisfy surfaces instead of spinning.
      let res = await (async () => {
        for (let attempt = 0; attempt < 12; attempt++) {
          const before = await getRecords(module, entity);
          const sent = await putRecords(module, entity, [probe, ...before.rows], {
            expectedRevision: before.revision,
          });
          if (sent.status !== 400) return sent;
          const detail = String(sent.body?.error || "");
          const field = fieldFromError(detail);
          if (!field || probe[field] !== undefined) return sent;
          probe[field] = valueForField(field);
        }
        return await putRecords(module, entity, [probe], {});
      })();
      if (res.status !== 200) {
        const detail = String(res.body?.error || res.text.slice(0, 120));
        if (res.status === 400) validated.push(`${module}/${entity}: ${detail}`);
        else rejected.push(`${module}/${entity}: PUT ${res.status} ${detail}`);
        continue;
      }
      createdKeys.push({ module, entity, ids: [id] });
      const after = await getRecords(module, entity);
      const landedAt = after.rows.findIndex((r) => r.id === id);
      if (landedAt < 0) {
        lost.push(`${module}/${entity}: saved, but absent from the next read`);
      } else if (landedAt >= 10) {
        lost.push(
          `${module}/${entity}: saved, but came back at position ${landedAt + 1} — off page one`,
        );
      }
    } catch (error) {
      rejected.push(`${module}/${entity}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const stored = sweep.length - validated.length - rejected.length;
  await check(`every durable form stores and reads back (${stored} entities)`, () => {
    assert.deepEqual(lost, [], `forms whose data does not come back:\n${lost.join("\n")}`);
  });

  await check("no form is refused for a reason other than field validation", () => {
    assert.deepEqual(rejected, [], `forms the API refused:\n${rejected.join("\n")}`);
  });

  if (validated.length) {
    console.log(
      `\n  ${validated.length} entities require fields this generic probe does not send ` +
        `(the API rejecting them is correct):`,
    );
    for (const line of validated) console.log(`    · ${line}`);
  }
}

try {
  await main();
} finally {
  try {
    await cleanup();
  } catch (error) {
    console.log(`  (cleanup incomplete: ${error instanceof Error ? error.message : error})`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} round-trip check(s) failed:`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("\nAll live form round-trip checks passed.");
