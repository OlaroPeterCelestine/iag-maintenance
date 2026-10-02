/**
 * Which Postgres `entity_records` bucket a list page reads and writes.
 *
 * The Go API stores rows under whatever `:module` the client sends — it never
 * normalizes the slug against its catalog. So if two routes show the same list
 * and resolve different buckets, each route only ever sees the rows it created:
 * the form saves, the toast says saved, and the row is missing on the other
 * page and after a reload. Bucket choice therefore has to be a property of the
 * ENTITY, not of the route the user happened to open it from.
 */

import {
  MODULE_SLUGS,
  moduleConfigs,
  NAV_MODULES,
  type ModuleSlug,
} from "@/lib/module-data";
import { entityKey } from "@/lib/manager-entities";

/**
 * Lists that appear on more than one route, and the single bucket that owns
 * them. Without an entry here each route falls back to its own storage slug and
 * the collection splits in two.
 *
 * Adding a list to a second nav module? Add it here too — the round-trip test
 * (scripts/test-records-round-trip.mts) fails otherwise.
 */
export const CANONICAL_ENTITY_STORAGE: Readonly<Record<string, ModuleSlug>> = {
  // Inventory cross-lists the shop-floor pages; Production owns the records.
  "production-orders": "production",
  "roast-batches": "production",
  "packaging-runs": "production",
  // Inventory cross-lists quality checks; QA owns them.
  "quality-checks": "qa",
  // Computed views listed under both Accounts and Reports. They store nothing,
  // but pinning the bucket keeps hydrate from chasing two empty collections.
  ledgers: "accounts",
  "trial-balance": "accounts",
};

/** The bucket a route uses for one entity. */
export function storageSlugForEntity(routeSlug: string, entity: string): string {
  const canonical = CANONICAL_ENTITY_STORAGE[entity];
  if (canonical) return canonical;
  const config = moduleConfigs[routeSlug as ModuleSlug];
  return config?.storageSlug ?? routeSlug;
}

/** The bucket a route uses when no entity is in hand (whole-module sweeps). */
export function storageSlugForRoute(routeSlug: string): string {
  const config = moduleConfigs[routeSlug as ModuleSlug];
  return config?.storageSlug ?? routeSlug;
}

let navEntityIndex: Map<string, ModuleSlug[]> | null = null;

/** Routes whose nav lists this entity (cached — NAV_MODULES is static). */
function routesListingEntity(entity: string): ModuleSlug[] {
  if (!navEntityIndex) {
    navEntityIndex = new Map();
    for (const nav of NAV_MODULES) {
      for (const label of nav.items ?? []) {
        const key = entityKey(label);
        const list = navEntityIndex.get(key);
        if (list) {
          if (!list.includes(nav.slug)) list.push(nav.slug);
        } else {
          navEntityIndex.set(key, [nav.slug]);
        }
      }
    }
  }
  return navEntityIndex.get(entity) ?? [];
}

/**
 * Every route that reads/writes `bucket` — the reverse of the functions above.
 *
 * Pass `entity` whenever it is known. Routes are separate permission pages, so
 * an access check that stops at the first owning route hides a shared bucket
 * from a role granted only one of its routes: the row stays in Postgres and
 * disappears from the UI on refresh.
 */
export function routeSlugsForStorageBucket(
  bucket: string,
  entity?: string,
): ModuleSlug[] {
  const out: ModuleSlug[] = [];
  for (const slug of MODULE_SLUGS as readonly ModuleSlug[]) {
    if (!moduleConfigs[slug]) continue;
    if (storageSlugForRoute(slug) === bucket) out.push(slug);
  }
  if (entity && CANONICAL_ENTITY_STORAGE[entity] === bucket) {
    // A cross-listed entity is owned by one bucket but reachable from every
    // route that shows it — all of them must pass the access check.
    for (const slug of routesListingEntity(entity)) {
      if (!out.includes(slug)) out.push(slug);
    }
  }
  if (!out.length && (MODULE_SLUGS as readonly string[]).includes(bucket)) {
    out.push(bucket as ModuleSlug);
  }
  return out;
}
