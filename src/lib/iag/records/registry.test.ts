/**
 * Guards against the failure mode that makes a bad mapping invisible.
 *
 * Adapter keys must be `storageModule:entity` from PAGE_ENTITY_CATALOG.
 */
import { describe, expect, it } from "vitest";
import { PAGE_ENTITY_CATALOG } from "@/lib/db/page-entity-catalog";
import { MODULE_SLUGS } from "@/lib/module-data";
import { CORE_TABS, DEFAULT_ENABLED_TABS } from "@/lib/manager-settings";
import { entityDefinitions } from "@/lib/manager-entities";
import { RECORD_ADAPTERS } from "@/lib/iag/records/registry";
import { APP_MODULES, SHARED_MODULES } from "@/lib/iag/rbac";

const routableKeys = new Set(
  PAGE_ENTITY_CATALOG.map((meta) => `${meta.storageModule}:${meta.entity}`),
);

const uiModuleKeys = new Map(
  PAGE_ENTITY_CATALOG.map((meta) => [
    `${meta.module}:${meta.entity}`,
    `${meta.storageModule}:${meta.entity}`,
  ]),
);

describe("record adapter registry", () => {
  it("has at least one mapping", () => {
    expect(Object.keys(RECORD_ADAPTERS).length).toBeGreaterThan(0);
  });

  it("keys every adapter on storageModule:entity, not module:entity", () => {
    const wrong: string[] = [];
    for (const key of Object.keys(RECORD_ADAPTERS)) {
      if (routableKeys.has(key)) continue;
      const corrected = uiModuleKeys.get(key);
      wrong.push(
        corrected
          ? `${key} — this is the UI module; the records API routes it as ${corrected}`
          : `${key} — no entity in PAGE_ENTITY_CATALOG has this storageModule:entity`,
      );
    }
    expect(wrong, `Adapter keys that can never match a request:\n  ${wrong.join("\n  ")}`).toEqual([]);
  });

  it("gives every adapter a service and an upstream resource path", () => {
    for (const [key, adapter] of Object.entries(RECORD_ADAPTERS)) {
      expect(adapter.service, `${key} has no service`).toBeTruthy();
      expect(adapter.resource, `${key} has no resource path`).toBeTruthy();
      expect(typeof adapter.list, `${key} cannot list`).toBe("function");
    }
  });

  it("grants every core tab through the platform RBAC bridge", () => {
    const granted = new Set<string>([...APP_MODULES, ...SHARED_MODULES]);
    const ungranted = CORE_TABS.filter((slug) => !granted.has(slug));
    expect(
      ungranted,
      `Core tabs with no RBAC grant — these open blank for non-admins:\n  ${ungranted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("only grants modules this app actually enables", () => {
    const enabled = new Set<string>([...CORE_TABS, ...DEFAULT_ENABLED_TABS]);
    const stray = [...APP_MODULES, ...SHARED_MODULES].filter((slug) => !enabled.has(slug));
    expect(stray, `Granted but not enabled: ${stray.join(", ")}`).toEqual([]);
  });

  it("grants only real module slugs", () => {
    const valid = new Set<string>(MODULE_SLUGS);
    for (const slug of [...APP_MODULES, ...SHARED_MODULES]) {
      expect(valid.has(slug), `${slug} is not a ModuleSlug`).toBe(true);
    }
  });

  it("marks an adapter read-only only when it truly has no write path", () => {
    for (const [key, adapter] of Object.entries(RECORD_ADAPTERS)) {
      const writable = Boolean(adapter.create || adapter.update || adapter.remove);
      if (adapter.readOnly) {
        expect(writable, `${key} is flagged read-only but exposes a write verb`).toBe(false);
      }
    }
  });

  it("creates work centres and can end downtime", () => {
    expect(Boolean(RECORD_ADAPTERS["production:work-centers"]?.create)).toBe(true);
    const end = RECORD_ADAPTERS["production:downtime-logs"]?.actions?.find(
      (action) => action.id === "end",
    );
    expect(end, "downtime-logs has no End action — open events would never close").toBeTruthy();
    expect(end?.permission).toBe("mes.add_downtime");
  });
});

/**
 * Every maintenance tab is MES. Before, Work Orders, Preventive Schedules and
 * Spare Parts wrote coffee production orders, production-calendar blocks and
 * production BOMs on iag-production.
 */
describe("maintenance ownership", () => {
  it("keeps every maintenance tab on iag-mes", () => {
    const expected: Record<string, string> = {
      "production:work-centers": "/api/v1/assets",
      "production:work-orders": "/api/v1/work-orders",
      "production:batch-records": "/api/v1/work-orders",
      "production:pm-templates": "/api/v1/pm-templates",
      "production:pm-schedules": "/api/v1/pm-schedules",
      "production:downtime-logs": "/api/v1/downtime-events",
    };
    for (const [key, resource] of Object.entries(expected)) {
      expect(RECORD_ADAPTERS[key]?.service, key).toBe("mes");
      expect(RECORD_ADAPTERS[key]?.resource, key).toBe(resource);
    }
  });

  it("maps every tab the Maintenance nav shows", () => {
    const tabs = entityDefinitions("production").map((d) => `production:${d.key}`);
    const unmapped = tabs.filter((key) => !RECORD_ADAPTERS[key]);
    expect(unmapped, `Tabs with no adapter fall through to the Go API: ${unmapped.join(", ")}`).toEqual([]);
  });

  it("leaves nothing pointed at iag-production's orders, plans or BOMs", () => {
    for (const key of [
      "production:production-orders",
      "production:production-plans",
      "production:bill-of-materials",
    ]) {
      expect(RECORD_ADAPTERS[key], key).toBeUndefined();
    }
  });

  it("declares only the verbs the service has", () => {
    // GET + POST on PM templates and schedules; no PATCH, no DELETE yet.
    for (const key of ["production:pm-templates", "production:pm-schedules"]) {
      expect(RECORD_ADAPTERS[key].update, key).toBeFalsy();
      expect(RECORD_ADAPTERS[key].remove, key).toBeFalsy();
    }
    // MES has no DELETE anywhere.
    for (const key of ["production:work-orders", "production:batch-records", "production:work-centers"]) {
      expect(RECORD_ADAPTERS[key].remove, key).toBeFalsy();
    }
    // A run's stage moves through /advance and /complete, not a flat PATCH.
    expect(RECORD_ADAPTERS["production:roast-batches"].update).toBeFalsy();
    expect(RECORD_ADAPTERS["production:yield-reports"].readOnly).toBe(true);
  });
});
