/**
 * Generate Go domain models + TS catalog + incremental SQL from FE entityDefinitions.
 * Go / entity_records is the runtime source of truth — no Prisma.
 *
 * Run: npx tsx scripts/generate-domain-models.ts
 *
 * Writes:
 *   backend/internal/models/entities_gen.go
 *   src/lib/db/page-entity-catalog.ts
 *   backend/migrations/046_sync_page_entity_models.sql  (idempotent CREATE IF NOT EXISTS)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { entityDefinitions, type EntityField } from "../src/lib/manager-entities";
import { MODULE_SLUGS, moduleConfigs, type ModuleSlug } from "../src/lib/module-data";
import { storageSlugForEntity } from "../src/lib/entity-storage";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

/** Report / desk views — Go structs only (no physical page_* table). */
const VIEW_ONLY = new Set([
  "reports",
  "accounting-operations",
  "management-analysis",
  "balance-sheet",
  "profit-and-loss",
  "profit-and-loss-by-class",
  "division-exception-report",
  "cash-flow",
  "cash-flow-indirect",
  "trial-balance",
  "ledgers",
  "statement-of-changes-in-equity",
  "other-comprehensive-income",
  "budget-vs-actual",
  "forecast-pandl",
  "notes-to-financial-statements",
  "control-account-reconciliation",
  "bank-reconciliation",
  "integrity-tests",
  "field-audit-log",
  "aged-receivables",
  "aged-payables",
  "customer-statements",
  "supplier-statements",
  "customer-ledgers",
  "supplier-ledgers",
  "contractor-ledgers",
  "contractor-statements",
  "tax-summary",
  "inventory-value-summary",
  "gantt-chart",
  "fleet-cost-report",
  "pos-terminal",
  "create-payroll",
  "hr-desk",
  "product-simulations",
  "service-reminders",
]);

type CatalogEntry = {
  module: string;
  storageModule: string;
  entity: string;
  label: string;
  fields: EntityField[];
  table: boolean;
};

/**
 * Storage-only entity keys used by WBS / legacy aliases / cashflow desks but not
 * always listed as NAV pages. Included in the Go catalog so the API accepts them.
 */
const EXTRA_STORAGE_ENTITIES: CatalogEntry[] = [
  {
    module: "projects",
    storageModule: "projects",
    entity: "phases",
    label: "Phases",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "code", label: "Code", type: "text" },
      { key: "project", label: "Project", type: "text" },
      { key: "startDate", label: "Start", type: "date" },
      { key: "dueDate", label: "Due", type: "date" },
      { key: "progressPercent", label: "Progress %", type: "number" },
      { key: "status", label: "Status", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    table: true,
  },
  {
    module: "projects",
    storageModule: "projects",
    entity: "activities",
    label: "Activities",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "code", label: "Code", type: "text" },
      { key: "project", label: "Project", type: "text" },
      { key: "phase", label: "Phase", type: "text" },
      { key: "startDate", label: "Start", type: "date" },
      { key: "dueDate", label: "Due", type: "date" },
      { key: "progressPercent", label: "Progress %", type: "number" },
      { key: "status", label: "Status", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    table: true,
  },
  {
    module: "projects",
    storageModule: "projects",
    entity: "tasks",
    label: "Tasks",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "code", label: "Code", type: "text" },
      { key: "project", label: "Project", type: "text" },
      { key: "phase", label: "Phase", type: "text" },
      { key: "activity", label: "Activity", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    table: true,
  },
  {
    module: "projects",
    storageModule: "projects",
    entity: "milestones",
    label: "Milestones",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "code", label: "Code", type: "text" },
      { key: "project", label: "Project", type: "text" },
      { key: "dueDate", label: "Due", type: "date" },
      { key: "status", label: "Status", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    table: true,
  },
  {
    module: "projects",
    storageModule: "projects",
    entity: "procurement-list",
    label: "Procurement List",
    fields: [
      { key: "reference", label: "Reference", type: "text" },
      { key: "date", label: "Date", type: "date" },
      { key: "project", label: "Project", type: "text" },
      { key: "item", label: "Item", type: "text" },
      { key: "quantity", label: "Qty", type: "number" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "status", label: "Status", type: "text" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    table: true,
  },
  {
    module: "projects",
    storageModule: "projects",
    entity: "progress-certificates",
    label: "Progress Certificates",
    fields: [
      { key: "reference", label: "Reference", type: "text" },
      { key: "date", label: "Date", type: "date" },
      { key: "project", label: "Project", type: "text" },
      { key: "contractor", label: "Contractor", type: "text" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "status", label: "Status", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    table: true,
  },
  {
    module: "projects",
    storageModule: "projects",
    entity: "project-expenses",
    label: "Project Expenses",
    fields: [
      { key: "reference", label: "Reference", type: "text" },
      { key: "date", label: "Date", type: "date" },
      { key: "project", label: "Project", type: "text" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "account", label: "Account", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
    ],
    table: true,
  },
  // Legacy storage aliases still used by some ledgers / party helpers.
  {
    module: "purchases",
    storageModule: "purchases",
    entity: "bills",
    label: "Bills (alias)",
    fields: [
      { key: "reference", label: "Reference", type: "text" },
      { key: "date", label: "Date", type: "date" },
      { key: "party", label: "Party", type: "text" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "status", label: "Status", type: "text" },
    ],
    table: true,
  },
  {
    module: "sales",
    storageModule: "sales",
    entity: "invoices",
    label: "Invoices (alias)",
    fields: [
      { key: "reference", label: "Reference", type: "text" },
      { key: "date", label: "Date", type: "date" },
      { key: "party", label: "Party", type: "text" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "status", label: "Status", type: "text" },
    ],
    table: true,
  },
  {
    module: "sales",
    storageModule: "sales",
    entity: "customers-receivable",
    label: "Customers Receivable (alias)",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "code", label: "Code", type: "text" },
      { key: "status", label: "Status", type: "text" },
    ],
    table: true,
  },
  {
    module: "purchases",
    storageModule: "purchases",
    entity: "suppliers-payable",
    label: "Suppliers Payable (alias)",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "code", label: "Code", type: "text" },
      { key: "status", label: "Status", type: "text" },
    ],
    table: true,
  },
];

function toPascal(key: string): string {
  return key
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

function toGoExported(key: string): string {
  const pascal = toPascal(key);
  if (pascal === "Type") return "TypeValue";
  if (pascal === "Range") return "RangeValue";
  return pascal || "Field";
}

function goType(field: EntityField): string {
  if (field.type === "attachments") return "json.RawMessage";
  return "string";
}

function buildCatalog(): CatalogEntry[] {
  const seen = new Set<string>();
  const out: CatalogEntry[] = [];
  for (const slug of MODULE_SLUGS as readonly ModuleSlug[]) {
    const config = moduleConfigs[slug];
    if (!config) continue;
    for (const def of entityDefinitions(slug)) {
      // Entity-first, so a list cross-linked onto a second route does not emit
      // a second catalog row and split the collection in two.
      const storageModule = storageSlugForEntity(slug, def.key);
      const id = `${storageModule}:${def.key}`;
      if (seen.has(id)) continue;
      // Same entity already claimed by its owning bucket — skip the cross-link.
      if (out.some((row) => row.entity === def.key)) continue;
      seen.add(id);
      out.push({
        module: slug,
        storageModule,
        entity: def.key,
        label: def.label,
        fields: def.fields,
        table: !VIEW_ONLY.has(def.key) && def.fields.length > 0,
      });
    }
  }
  for (const extra of EXTRA_STORAGE_ENTITIES) {
    const id = `${extra.storageModule}:${extra.entity}`;
    if (seen.has(id)) continue;
    // Also skip if the same entity key already appears under another module.
    if (out.some((row) => row.entity === extra.entity)) continue;
    seen.add(id);
    out.push(extra);
  }
  return out.sort((a, b) => a.entity.localeCompare(b.entity));
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function tableName(entity: string): string {
  return `page_${entity.replace(/-/g, "_")}`;
}

function generateGo(catalog: CatalogEntry[]): string {
  const lines: string[] = [
    "// Code generated by scripts/generate-domain-models.ts — DO NOT EDIT.",
    "// Runtime storage is Postgres entity_records (JSONB) via the Go API.",
    "// These structs + Catalog are the typed domain contract (no Prisma).",
    "package models",
    "",
    `import (`,
    `\t"encoding/json"`,
    `\t"time"`,
    `)`,
    "",
    "// EntityKind identifies a UI page entity key.",
    "type EntityKind string",
    "",
    "const (",
  ];

  const byEntity = new Map<string, CatalogEntry>();
  for (const entry of catalog) {
    if (!byEntity.has(entry.entity)) byEntity.set(entry.entity, entry);
  }
  const unique = [...byEntity.values()].sort((a, b) => a.entity.localeCompare(b.entity));

  for (const entry of unique) {
    lines.push(`\t${toPascal(entry.entity)}Kind EntityKind = "${entry.entity}"`);
  }
  lines.push(")");
  lines.push("");
  lines.push("// PageEntity describes one module page in the catalog.");
  lines.push("type PageEntity struct {");
  lines.push("\tModule        string");
  lines.push("\tStorageModule string");
  lines.push("\tEntity        EntityKind");
  lines.push("\tLabel         string");
  lines.push("\tHasTable      bool");
  lines.push("\tTableName     string");
  lines.push("\tColumns       []string");
  lines.push("}");
  lines.push("");
  lines.push("// Catalog lists every UI page entity (typed models + views).");
  lines.push("var Catalog = []PageEntity{");
  for (const entry of catalog) {
    const cols = entry.fields
      .map((f) => f.key)
      .filter((k) => !["id", "createdAt", "updatedAt", "payload"].includes(k));
    const uniqueCols = [...new Set(cols)];
    lines.push(
      `\t{Module: "${entry.module}", StorageModule: "${entry.storageModule}", Entity: ${toPascal(entry.entity)}Kind, Label: ${JSON.stringify(entry.label)}, HasTable: ${entry.table}, TableName: ${entry.table ? JSON.stringify(tableName(entry.entity)) : `""`}, Columns: []string{${uniqueCols.map((c) => JSON.stringify(c)).join(", ")}}},`,
    );
  }
  lines.push("}");
  lines.push("");
  lines.push("// KnownEntity reports whether entity is in the generated catalog.");
  lines.push("func KnownEntity(entity string) bool {");
  lines.push("\tfor _, row := range Catalog {");
  lines.push("\t\tif string(row.Entity) == entity {");
  lines.push("\t\t\treturn true");
  lines.push("\t\t}");
  lines.push("\t}");
  lines.push("\treturn false");
  lines.push("}");
  lines.push("");
  lines.push("// StorageModuleForEntity returns the API storage module for an entity key.");
  lines.push("func StorageModuleForEntity(entity string) (string, bool) {");
  lines.push("\tfor _, row := range Catalog {");
  lines.push("\t\tif string(row.Entity) == entity {");
  lines.push("\t\t\treturn row.StorageModule, true");
  lines.push("\t\t}");
  lines.push("\t}");
  lines.push("\treturn \"\", false");
  lines.push("}");
  lines.push("");
  lines.push("// TableForEntity returns the page_* SQL table for an entity key, if any.");
  lines.push("func TableForEntity(entity string) (string, []string, bool) {");
  lines.push("\tfor _, row := range Catalog {");
  lines.push("\t\tif string(row.Entity) == entity && row.HasTable && row.TableName != \"\" {");
  lines.push("\t\t\treturn row.TableName, row.Columns, true");
  lines.push("\t\t}");
  lines.push("\t}");
  lines.push("\treturn \"\", nil, false");
  lines.push("}");
  lines.push("");
  lines.push("// AllPageTables lists every physical page_* table name.");
  lines.push("func AllPageTables() []string {");
  lines.push("\tout := make([]string, 0, len(Catalog))");
  lines.push("\tseen := map[string]struct{}{}");
  lines.push("\tfor _, row := range Catalog {");
  lines.push("\t\tif !row.HasTable || row.TableName == \"\" { continue }");
  lines.push("\t\tif _, ok := seen[row.TableName]; ok { continue }");
  lines.push("\t\tseen[row.TableName] = struct{}{}");
  lines.push("\t\tout = append(out, row.TableName)");
  lines.push("\t}");
  lines.push("\treturn out");
  lines.push("}");
  lines.push("");

  for (const entry of unique) {
    const name = toPascal(entry.entity);
    lines.push(`// ${name} — ${entry.label} (${entry.storageModule}/${entry.entity}).`);
    if (!entry.table) {
      lines.push(`// View-only: computed from ledger / related records; no dedicated SQL table.`);
    }
    lines.push(`type ${name} struct {`);
    lines.push(`\tID        string    \`json:"id"\``);
    const used = new Set<string>(["id", "createdAt", "updatedAt", "payload"]);
    for (const field of entry.fields) {
      if (used.has(field.key)) continue;
      used.add(field.key);
      const goName = toGoExported(field.key);
      const gt = goType(field);
      lines.push(`\t${goName} ${gt} \`json:"${field.key}"\``);
    }
    if (entry.table) {
      lines.push(`\tPayload   json.RawMessage \`json:"payload,omitempty"\``);
    }
    lines.push(`\tCreatedAt time.Time \`json:"createdAt"\``);
    lines.push(`\tUpdatedAt time.Time \`json:"updatedAt"\``);
    lines.push(`}`);
    lines.push("");
    lines.push(`func (${name[0]!.toLowerCase()} ${name}) EntityKind() EntityKind { return ${name}Kind }`);
    lines.push("");
  }

  return lines.join("\n");
}

function generateSQL(catalog: CatalogEntry[]): string {
  const lines: string[] = [
    "-- AUTO-GENERATED by scripts/generate-domain-models.ts (Go API / entity_records parity).",
    "-- Idempotent sync of typed page_* mirrors. Runtime CRUD uses entity_records JSONB.",
    "-- Applied via Go migrate on API boot — do not rewrite older applied migrations.",
    "",
    "CREATE TABLE IF NOT EXISTS page_entity_registry (",
    "  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,",
    "  storage_module TEXT NOT NULL,",
    "  entity_key TEXT NOT NULL,",
    "  label TEXT NOT NULL DEFAULT '',",
    "  has_table BOOLEAN NOT NULL DEFAULT true,",
    "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),",
    "  UNIQUE (storage_module, entity_key)",
    ");",
    "",
  ];

  for (const entry of catalog.filter((c) => c.table)) {
    const table = tableName(entry.entity);
    lines.push(`-- ${entry.label}`);
    lines.push(`CREATE TABLE IF NOT EXISTS "${table}" (`);
    lines.push(`  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,`);
    const used = new Set<string>(["id", "created_at", "updated_at", "payload"]);
    for (const field of entry.fields) {
      const col = field.key;
      if (used.has(col)) continue;
      used.add(col);
      if (field.type === "attachments") {
        lines.push(`  "${col}" JSONB,`);
      } else {
        lines.push(`  "${col}" TEXT NOT NULL DEFAULT '',`);
      }
    }
    lines.push(`  payload JSONB NOT NULL DEFAULT '{}'::jsonb,`);
    lines.push(`  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),`);
    lines.push(`  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
    lines.push(`);`);
    // Add any new columns to existing tables (idempotent).
    for (const field of entry.fields) {
      const col = field.key;
      if (["id", "created_at", "updated_at", "payload"].includes(col)) continue;
      if (field.type === "attachments") {
        lines.push(
          `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col}" JSONB;`,
        );
      } else {
        lines.push(
          `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col}" TEXT NOT NULL DEFAULT '';`,
        );
      }
    }
    lines.push("");
  }

  lines.push("-- Seed / refresh registry");
  for (const entry of catalog) {
    lines.push(
      `INSERT INTO page_entity_registry (id, storage_module, entity_key, label, has_table) VALUES (gen_random_uuid()::text, ${sqlString(entry.storageModule)}, ${sqlString(entry.entity)}, ${sqlString(entry.label)}, ${entry.table}) ON CONFLICT (storage_module, entity_key) DO UPDATE SET label = EXCLUDED.label, has_table = EXCLUDED.has_table;`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

function generateTS(catalog: CatalogEntry[]): string {
  return [
    "/**",
    " * AUTO-GENERATED by scripts/generate-domain-models.ts — DO NOT EDIT.",
    " * Domain catalog for tooling. Runtime reads/writes Postgres entity_records",
    " * via the Go API (/api/records/:module/:entity). No Prisma.",
    " */",
    "",
    "export type PageEntityMeta = {",
    "  module: string;",
    "  storageModule: string;",
    "  entity: string;",
    "  label: string;",
    "  table: string | null;",
    "  columns: string[];",
    "};",
    "",
    "export const PAGE_ENTITY_CATALOG: PageEntityMeta[] = ",
    JSON.stringify(
      catalog.map((c) => ({
        module: c.module,
        storageModule: c.storageModule,
        entity: c.entity,
        label: c.label,
        table: c.table ? tableName(c.entity) : null,
        columns: [
          ...new Set(
            c.fields
              .map((f) => f.key)
              .filter((k) => !["id", "createdAt", "updatedAt", "payload"].includes(k)),
          ),
        ],
      })),
      null,
      2,
    ),
    ";",
    "",
    "export const PAGE_ENTITY_BY_KEY = Object.fromEntries(",
    "  PAGE_ENTITY_CATALOG.map((row) => [row.entity, row]),",
    ") as Record<string, PageEntityMeta>;",
    "",
    "export function pageTableForEntity(entity: string): PageEntityMeta | null {",
    "  const row = PAGE_ENTITY_BY_KEY[entity];",
    "  return row?.table ? row : null;",
    "}",
    "",
    "export function allPageTables(): string[] {",
    "  const seen = new Set<string>();",
    "  const out: string[] = [];",
    "  for (const row of PAGE_ENTITY_CATALOG) {",
    "    if (!row.table || seen.has(row.table)) continue;",
    "    seen.add(row.table);",
    "    out.push(row.table);",
    "  }",
    "  return out;",
    "}",
    "",
  ].join("\n");
}

function main() {
  const catalog = buildCatalog();
  const goSource = generateGo(catalog);
  const sql = generateSQL(catalog);
  const tsCatalog = generateTS(catalog);

  const goDir = join(root, "backend/internal/models");
  mkdirSync(goDir, { recursive: true });
  writeFileSync(join(goDir, "entities_gen.go"), goSource);

  const migDir = join(root, "backend/migrations");
  mkdirSync(migDir, { recursive: true });
  // Incremental sync migration — never rewrite applied 006_*.
  writeFileSync(join(migDir, "046_sync_page_entity_models.sql"), sql);

  mkdirSync(join(root, "src/lib/db"), { recursive: true });
  writeFileSync(join(root, "src/lib/db/page-entity-catalog.ts"), tsCatalog);

  const tables = catalog.filter((c) => c.table).length;
  const views = catalog.length - tables;
  console.log(
    `Generated ${catalog.length} Go domain models (${tables} page_* tables, ${views} view-only) → entities_gen.go + 046_sync + page-entity-catalog.ts (no Prisma)`,
  );
}

main();
