/**
 * End-to-end gap audit: routes ↔ RBAC page keys ↔ storageSlug ↔ forms.
 * Run: npx tsx scripts/audit-rbac-forms-gaps.mts
 */
import fs from "node:fs";
import {
  MODULE_SLUGS,
  NAV_MODULES,
  moduleConfigs,
} from "../src/lib/module-data.ts";
import {
  ADMIN_ONLY_SPECIAL_NAV,
  PERMISSION_PAGES,
  ALL_PERMISSIONS,
  ROLE_PERMS,
  SPECIAL_APP_ROUTES,
  SPECIAL_NAV_KEYS,
  isOpenRequestPageKey,
} from "../src/lib/access-control.ts";
import { entityDefinitions, entityKey } from "../src/lib/manager-entities.ts";
import { FORM_TYPES } from "../src/lib/manager-settings.ts";
import { REQUIRED_ACCOUNTING_DOCUMENTS } from "../src/lib/accounting-documents.ts";

type Sev = "critical" | "high" | "medium" | "low";
const issues: Array<{ severity: Sev; area: string; issue: string }> = [];

/** SpecialNavKey + non-module portals (e.g. /contractor). Dashboard is `/`, not a folder. */
const special = new Set<string>([...SPECIAL_NAV_KEYS, ...SPECIAL_APP_ROUTES]);

const pagesDir = "src/app/(main)";
const routeDirs = fs
  .readdirSync(pagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const moduleSet = new Set(MODULE_SLUGS as readonly string[]);

for (const r of routeDirs) {
  if (special.has(r)) continue;
  if (!moduleSet.has(r)) {
    issues.push({
      severity: "high",
      area: "routes",
      issue: `Route /${r} exists but not in MODULE_SLUGS and not SpecialNav`,
    });
  }
}

/** Known FE route → API storage remaps (Go page_acl must alias these). */
const EXPECTED_STORAGE: Record<string, string> = {
  "receipts-payments": "banking",
  "general-requests": "requests",
  "oral-payment-requests": "requests",
};

const pageAclSrc = fs.readFileSync("backend/internal/httpapi/page_acl.go", "utf8");
if (!pageAclSrc.includes("pagePermissionLookupKeys")) {
  issues.push({
    severity: "critical",
    area: "rbac-storage",
    issue: "Go page_acl.go missing pagePermissionLookupKeys (route↔storage alias)",
  });
}
for (const [route, storage] of Object.entries(EXPECTED_STORAGE)) {
  const mod = moduleConfigs[route as keyof typeof moduleConfigs];
  if (!mod?.storageSlug || mod.storageSlug !== storage) {
    issues.push({
      severity: "critical",
      area: "rbac-storage",
      issue: `moduleConfigs.${route}.storageSlug expected "${storage}"`,
    });
  }
  if (!pageAclSrc.includes(`"${route}"`) || !pageAclSrc.includes(`"${storage}"`)) {
    issues.push({
      severity: "critical",
      area: "rbac-storage",
      issue: `Go page_acl aliases should mention both "${route}" and "${storage}"`,
    });
  }
}

if (PERMISSION_PAGES.some((p) => p.key === "requests")) {
  issues.push({
    severity: "medium",
    area: "rbac-nav",
    issue: `PERMISSION_PAGES still lists legacy module "requests"`,
  });
}

for (const key of ["settings", "users", "request-emails", "activity-logs"] as const) {
  if (PERMISSION_PAGES.some((p) => p.key === key)) {
    issues.push({
      severity: "medium",
      area: "rbac-admin",
      issue: `PERMISSION_PAGES still lists admin-only "${key}" (should not be matrix-grantable)`,
    });
  }
  if (!ADMIN_ONLY_SPECIAL_NAV.has(key)) {
    issues.push({
      severity: "high",
      area: "rbac-admin",
      issue: `ADMIN_ONLY_SPECIAL_NAV missing "${key}"`,
    });
  }
}

if (!isOpenRequestPageKey("general-requests/general-requests")) {
  issues.push({
    severity: "high",
    area: "rbac-requests",
    issue: `isOpenRequestPageKey("general-requests/general-requests") should be true`,
  });
}

const feSrc = [
  fs.readFileSync("src/components/module-entity-records.tsx", "utf8"),
  fs.readFileSync("src/components/financial-report-panel.tsx", "utf8"),
].join("\n");
if (!feSrc.includes('currentUserCan("bank-recon")') && !feSrc.includes('assertPermission("bank-recon")')) {
  issues.push({
    severity: "high",
    area: "rbac-perm",
    issue: `Permission "bank-recon" still unused in UI`,
  });
}

const requestFormHints = [
  "general request",
  "oral payment",
  "payment request",
  "requisition",
  "leave",
];
for (const hint of requestFormHints) {
  const hit = FORM_TYPES.some((t) => t.toLowerCase().includes(hint));
  if (!hit) {
    issues.push({
      severity: "medium",
      area: "forms",
      issue: `FORM_TYPES (footers/defaults) has no entry matching "${hint}"`,
    });
  }
}

{
  const oralDefs = entityDefinitions("oral-payment-requests");
  const oral = oralDefs.find((d) => d.key === "oral-payment-requests");
  const payee = oral?.fields.find((f) => f.key === "payee");
  if (payee && !payee.required) {
    issues.push({
      severity: "high",
      area: "forms",
      issue: `Oral payment "payee" is optional; should be required`,
    });
  }
  if (!oral) {
    issues.push({
      severity: "critical",
      area: "forms",
      issue: `entityDefinitions(oral-payment-requests) missing oral-payment-requests entity`,
    });
  }
}

for (const doc of REQUIRED_ACCOUNTING_DOCUMENTS) {
  const mod = doc.module;
  const storage =
    moduleConfigs[mod as keyof typeof moduleConfigs]?.storageSlug;
  if (storage && storage !== mod && !doc.storageModule) {
    issues.push({
      severity: "high",
      area: "forms-docs",
      issue: `accounting-documents "${doc.id}" module=${mod} missing storageModule="${storage}"`,
    });
  }
}

for (const mod of NAV_MODULES) {
  const defs = entityDefinitions(mod.slug);
  const expected = mod.items.map(entityKey);
  const got = new Set(defs.map((d) => d.key));
  for (const ek of expected) {
    if (!got.has(ek)) {
      issues.push({
        severity: "high",
        area: "forms",
        issue: `Module ${mod.slug}: NAV key "${ek}" missing from entityDefinitions`,
      });
    }
  }
}

const reqDefs = entityDefinitions("requests");
if (!reqDefs.length) {
  issues.push({
    severity: "medium",
    area: "forms",
    issue: `entityDefinitions("requests") empty`,
  });
}

const docs = fs.readFileSync("docs/accounting-next-api.md", "utf8");
if (/\| Requests \| `\/requests` \|/.test(docs)) {
  issues.push({
    severity: "low",
    area: "docs",
    issue: `docs still list Requests hub as /requests only`,
  });
}

const guides = fs.readFileSync("src/lib/guides-data.ts", "utf8");
if (guides.includes("Settings → User Permissions")) {
  issues.push({
    severity: "low",
    area: "docs",
    issue: `guides-data still says "Settings → User Permissions"`,
  });
}

console.log("Roles with ROLE_PERMS:", Object.keys(ROLE_PERMS).length);
console.log("ALL_PERMISSIONS:", ALL_PERMISSIONS.length);
console.log("PERMISSION_PAGES:", PERMISSION_PAGES.length);
console.log("FORM_TYPES count:", FORM_TYPES.length);
console.log("Routes:", routeDirs.join(", "));
console.log(`\n=== ISSUES (${issues.length}) ===`);
if (!issues.length) {
  console.log("\nAll gap / RBAC / forms checks passed.");
}
for (const sev of ["critical", "high", "medium", "low"] as const) {
  const subset = issues.filter((i) => i.severity === sev);
  if (!subset.length) continue;
  console.log(`\n## ${sev.toUpperCase()} (${subset.length})`);
  for (const i of subset) {
    console.log(`[${i.area}] ${i.issue}`);
  }
}

const blocking = issues.filter((i) => i.severity === "critical" || i.severity === "high").length;
process.exit(blocking > 0 ? 1 : 0);
