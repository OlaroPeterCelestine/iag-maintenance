/**
 * Store-and-fetch round trip for every list page.
 *
 * Records live in Postgres `entity_records` keyed by (module, entity). The Go
 * API stores whatever `:module` the client sends — it never normalizes the slug
 * against its catalog — so the UI is solely responsible for writing and reading
 * one entity through ONE bucket. When two routes disagree, a form saves happily
 * and the row is invisible on reload: the classic "it saved but it vanished".
 *
 * These checks lock that contract down for the whole nav, plus the related
 * hazards: an entity whose bucket drifts from the generated catalog, a route
 * whose bucket is not a real module, and page-access resolution that hides a
 * shared bucket from a role that owns only one of its routes.
 *
 * Run: npx tsx scripts/test-records-round-trip.mts
 */
import assert from "node:assert/strict";
import {
  MODULE_SLUGS,
  moduleConfigs,
  NAV_MODULES,
  type ModuleSlug,
} from "../src/lib/module-data.ts";
import { entityKey } from "../src/lib/manager-entities.ts";
import { PAGE_ENTITY_CATALOG } from "../src/lib/db/page-entity-catalog.ts";
import {
  routeSlugsForStorageBucket,
  storageSlugForEntity,
} from "../src/lib/entity-storage.ts";
import { sortRecordsNewestFirst } from "../src/lib/records-store.ts";

const failures: string[] = [];
function check(name: string, run: () => void) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`FAIL  ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Every (route, entity) pair the nav can open, with the bucket the UI resolves. */
type NavPair = { route: ModuleSlug; entity: string; label: string; bucket: string };

const navPairs: NavPair[] = [];
for (const nav of NAV_MODULES) {
  for (const label of nav.items ?? []) {
    const entity = entityKey(label);
    navPairs.push({
      route: nav.slug,
      entity,
      label,
      bucket: storageSlugForEntity(nav.slug, entity),
    });
  }
}

console.log(`\nBucket contract (${navPairs.length} nav entries)`);

check("every route resolves to a real storage bucket", () => {
  const bad = navPairs
    .filter((pair) => !(MODULE_SLUGS as readonly string[]).includes(pair.bucket))
    .map((pair) => `${pair.route} → “${pair.bucket}”`);
  assert.deepEqual(bad, [], `unknown storage buckets:\n${bad.join("\n")}`);
});

check("one entity is never split across two storage buckets", () => {
  // The whole failure mode in one assertion: if Sales writes `payments` to
  // "banking" and Receipts & Payments reads it from "receipts-payments", the
  // row is durable in Postgres and invisible in the UI.
  const buckets = new Map<string, Map<string, string[]>>();
  for (const pair of navPairs) {
    if (!buckets.has(pair.entity)) buckets.set(pair.entity, new Map());
    const byBucket = buckets.get(pair.entity)!;
    if (!byBucket.has(pair.bucket)) byBucket.set(pair.bucket, []);
    byBucket.get(pair.bucket)!.push(pair.route);
  }
  const split = [...buckets.entries()]
    .filter(([, byBucket]) => byBucket.size > 1)
    .map(
      ([entity, byBucket]) =>
        `${entity}: ${[...byBucket.entries()]
          .map(([bucket, routes]) => `${bucket} (via ${routes.join(", ")})`)
          .join(" vs ")}`,
    );
  assert.deepEqual(split, [], `entities stored under more than one bucket:\n${split.join("\n")}`);
});

check("nav buckets match the generated domain catalog", () => {
  const catalogBucket = new Map(
    PAGE_ENTITY_CATALOG.map((row) => [row.entity, row.storageModule]),
  );
  const drift = navPairs
    .filter((pair) => {
      const expected = catalogBucket.get(pair.entity);
      return expected !== undefined && expected !== pair.bucket;
    })
    .map(
      (pair) =>
        `${pair.entity} (route ${pair.route}): UI writes “${pair.bucket}”, catalog says “${catalogBucket.get(pair.entity)}”`,
    );
  assert.deepEqual(drift, [], `catalog drift — regenerate models or fix storageSlug:\n${drift.join("\n")}`);
});

check("every nav entry exists in the domain catalog", () => {
  const known = new Set(PAGE_ENTITY_CATALOG.map((row) => row.entity));
  const missing = [
    ...new Set(navPairs.filter((pair) => !known.has(pair.entity)).map((pair) => pair.entity)),
  ];
  assert.deepEqual(
    missing,
    [],
    `nav pages with no catalog row (Go will reject writes as unknown entity):\n${missing.join("\n")}`,
  );
});

console.log("\nShared-bucket visibility");

/**
 * Mirrors access-control: a bucket owned by several routes stays visible when
 * ANY owning route is permitted. Resolving to only the first match is what hid
 * banking rows from a Receipts & Payments-only role.
 */
check("every route that uses a bucket is reachable from that bucket", () => {
  // Access filtering runs backwards, bucket → routes. Any route that reads a
  // bucket must appear in that reverse lookup, or the role check drops the
  // collection and rows saved from that page vanish on refresh.
  const missing: string[] = [];
  for (const pair of navPairs) {
    const owners = routeSlugsForStorageBucket(pair.bucket, pair.entity);
    if (!owners.includes(pair.route)) {
      missing.push(
        `${pair.entity}: route “${pair.route}” reads bucket “${pair.bucket}” but the reverse lookup returns ${owners.join(", ") || "(none)"}`,
      );
    }
  }
  assert.deepEqual(missing, [], missing.join("\n"));
});

check("a cross-listed page is reachable from both of its routes", () => {
  // Inventory shows Production Orders but Production owns the bucket. A role
  // granted only Inventory must still resolve it.
  const owners = routeSlugsForStorageBucket("production", "production-orders");
  assert.ok(
    owners.includes("production" as ModuleSlug) && owners.includes("inventory" as ModuleSlug),
    `production-orders must resolve to both routes, got ${owners.join(", ")}`,
  );
});

check("a role granted only Receipts & Payments still sees the banking bucket", () => {
  const owners = routeSlugsForStorageBucket("banking", "payments");
  assert.ok(
    owners.includes("banking" as ModuleSlug) &&
      owners.includes("receipts-payments" as ModuleSlug),
    `"banking" must resolve to both owning routes, got ${owners.join(", ")}`,
  );
});

check("unknown buckets resolve to nothing", () => {
  assert.deepEqual(routeSlugsForStorageBucket("not-a-real-module"), []);
});

console.log("\nCatalog integrity");

check("no two catalog rows claim the same entity key", () => {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const row of PAGE_ENTITY_CATALOG) {
    const prev = seen.get(row.entity);
    if (prev && prev !== row.storageModule) {
      dupes.push(`${row.entity}: ${prev} vs ${row.storageModule}`);
    }
    seen.set(row.entity, row.storageModule);
  }
  assert.deepEqual(dupes, [], `entity keys mapped to two buckets:\n${dupes.join("\n")}`);
});

check("durable pages declare a table; view-only pages do not", () => {
  // A page with no table is a computed report — writing to it would produce
  // rows nothing ever reads back.
  const durable = PAGE_ENTITY_CATALOG.filter((row) => row.table);
  const computed = PAGE_ENTITY_CATALOG.filter((row) => !row.table);
  assert.ok(durable.length > 100, `expected most pages to be durable, got ${durable.length}`);
  assert.ok(computed.length > 0, "expected some computed report pages");
  const badTable = durable
    .filter((row) => !/^page_[a-z0-9_]+$/.test(row.table!))
    .map((row) => `${row.entity} → ${row.table}`);
  assert.deepEqual(badTable, [], `malformed table names:\n${badTable.join("\n")}`);
});

console.log("\nList order");

check("a just-saved row sorts to the top, not to a random page", () => {
  // Collection PUTs rewrite every row with one timestamp and echo the merged
  // set in Go map order, which the runtime randomizes. Tables page at ten rows,
  // so without an explicit sort the new record lands anywhere and reads as lost.
  const older = Array.from({ length: 24 }, (_, i) => ({
    id: `old-${i}`,
    createdAt: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T08:00:00.000Z`,
    updatedAt: `2026-07-${String((i % 28) + 1).padStart(2, "0")}T08:00:00.000Z`,
  }));
  const fresh = {
    id: "new-receipt",
    createdAt: "2026-08-06T18:30:00.000Z",
    updatedAt: "2026-08-06T18:30:00.000Z",
  };
  const shuffled = [...older.slice(0, 9), fresh, ...older.slice(9)];
  const sorted = sortRecordsNewestFirst(shuffled);
  assert.equal(sorted[0].id, "new-receipt", "newest record must head the first page");
  assert.equal(sorted.length, shuffled.length, "sorting must not drop rows");
});

check("equal timestamps keep one stable order", () => {
  const tied = ["c", "a", "b"].map((id) => ({
    id,
    createdAt: "2026-08-06T18:30:00.000Z",
    updatedAt: "2026-08-06T18:30:00.000Z",
  }));
  const first = sortRecordsNewestFirst(tied).map((row) => row.id);
  const again = sortRecordsNewestFirst([...tied].reverse()).map((row) => row.id);
  assert.deepEqual(first, ["a", "b", "c"]);
  assert.deepEqual(again, first, "tied rows must not shuffle between renders");
});

check("rows with no timestamp sort last instead of hiding the new one", () => {
  const rows = [
    { id: "legacy", createdAt: "", updatedAt: "" },
    { id: "fresh", createdAt: "2026-08-06T18:30:00.000Z", updatedAt: "2026-08-06T18:30:00.000Z" },
  ];
  assert.deepEqual(
    sortRecordsNewestFirst(rows).map((row) => row.id),
    ["fresh", "legacy"],
  );
});

if (failures.length) {
  console.error(`\n${failures.length} records round-trip check(s) failed:`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("\nAll records round-trip checks passed.");
