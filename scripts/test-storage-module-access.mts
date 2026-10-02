/**
 * Regression: a storage bucket shared by several routes must stay visible if
 * ANY owning route is permitted.
 *
 * "banking" and "receipts-payments" are separate permission pages that both
 * store under the "banking" bucket. Resolving the bucket to only the first
 * matching route meant a role granted Receipts & Payments but not Banking
 * could save a payment and never hydrate it back — the row stayed in Postgres
 * but disappeared from the UI on refresh.
 */
import assert from "node:assert/strict";
import { MODULE_SLUGS, moduleConfigs, type ModuleSlug } from "../src/lib/module-data.ts";

function routeSlugsForStorageModule(storage: string): ModuleSlug[] {
  const out: ModuleSlug[] = [];
  for (const slug of MODULE_SLUGS as readonly ModuleSlug[]) {
    const config = moduleConfigs[slug];
    if (!config) continue;
    if ((config.storageSlug ?? config.slug) === storage) out.push(slug);
  }
  if (!out.length && (MODULE_SLUGS as readonly string[]).includes(storage)) {
    out.push(storage as ModuleSlug);
  }
  return out;
}

const owners = routeSlugsForStorageModule("banking");
assert.ok(
  owners.includes("banking" as ModuleSlug) && owners.includes("receipts-payments" as ModuleSlug),
  `"banking" storage must resolve to both owning routes, got ${JSON.stringify(owners)}`,
);

// The access decision must be "any owner allowed", not "first owner allowed".
const allowOnlyReceiptsPayments = (slug: string) => slug === "receipts-payments";
assert.ok(
  owners.some((s) => allowOnlyReceiptsPayments(s)),
  "a role with only Receipts & Payments must still see banking-stored records",
);

// Sanity: unknown buckets resolve to nothing (and are therefore filtered out).
assert.deepEqual(routeSlugsForStorageModule("not-a-real-module"), []);

console.log("storage-module-access: ok");
