/**
 * Verify CSV bulk upload is available on most data pages.
 * Run: npx tsx scripts/audit-csv-import-coverage.mts
 */
import assert from "node:assert/strict";
import {
  canBulkImportEntity,
  isCsvImportableEntity,
  importTemplateCsv,
  LINE_SHEET_CSV_ENTITIES,
} from "../src/lib/data-import.ts";
import { DOCUMENT_LINE_ENTITIES } from "../src/lib/document-lines.ts";
import { entityDefinitions } from "../src/lib/manager-entities.ts";
import { NAV_MODULES } from "../src/lib/module-data.ts";
import { managerTargets } from "../src/lib/manager-io-import.ts";

const mustAllow = [
  "customers",
  "suppliers",
  "employees",
  "chart-of-accounts",
  "general-requests",
  "oral-payment-requests",
  "payment-requests",
  "leave-requests",
  "expense-claims",
  "receipts",
  "payments",
  "fuel-requests",
];

const mustDeny = [
  "history",
  "deleted-records",
  "bank-statements",
  "trial-balance",
  "profit-and-loss",
  "aged-receivables",
  "gantt-chart",
  "pos-terminal",
  "create-payroll",
];

let allowed = 0;
let denied = 0;
for (const mod of NAV_MODULES) {
  for (const def of entityDefinitions(mod.slug)) {
    const ok = canBulkImportEntity(def.key, { canCreate: true, canEdit: true });
    if (ok) allowed++;
    else denied++;
  }
}

for (const key of mustAllow) {
  assert.equal(
    canBulkImportEntity(key, { canCreate: true, canEdit: false }),
    true,
    `${key} should allow CSV with create`,
  );
  assert.equal(
    canBulkImportEntity(key, { canCreate: false, canEdit: true }),
    true,
    `${key} should allow CSV with edit-only`,
  );
}

for (const key of mustDeny) {
  assert.equal(isCsvImportableEntity(key), false, `${key} should not be CSV-importable`);
}

const leave = entityDefinitions("payroll").find((d) => d.key === "leave-requests");
assert.ok(leave);
const tpl = importTemplateCsv(leave!);
assert.ok(!/Attachment/i.test(tpl), "template should omit attachments column");
assert.ok(!/Amendment comment/i.test(tpl), "template should omit read-only feedback");
assert.ok(/Reference/i.test(tpl));

assert.ok(managerTargets().length >= 60, `expected broad Settings importer targets, got ${managerTargets().length}`);
assert.ok(
  !managerTargets().some((t) => t.entityKey === "requisitions"),
  "Material Requests must not use Settings flat CSV — use Projects → Material Requests → Import CSV",
);
assert.ok(
  !managerTargets().some((t) => DOCUMENT_LINE_ENTITIES.has(t.entityKey)),
  "Document line entities must not use Settings flat CSV — use each list’s Import CSV",
);
assert.ok(
  !managerTargets().some((t) => t.entityKey === "journal-entries"),
  "Journal Entries must not use Settings flat CSV — use Accounts → Journal Entries → Import CSV",
);
assert.ok(allowed >= 80, `expected most NAV lists importable, got allowed=${allowed} denied=${denied}`);

// Material Requests stay importable on their own list (Go line-item API).
assert.equal(
  canBulkImportEntity("requisitions", { canCreate: false, canEdit: true }),
  true,
  "requisitions should allow list CSV with edit",
);

for (const key of DOCUMENT_LINE_ENTITIES) {
  assert.ok(LINE_SHEET_CSV_ENTITIES.has(key), `${key} should be a line-sheet CSV entity`);
  assert.equal(
    canBulkImportEntity(key, { canCreate: false, canEdit: true }),
    true,
    `${key} should allow list CSV with edit`,
  );
  assert.equal(isCsvImportableEntity(key), true, `${key} should be CSV-importable`);
}

assert.equal(
  canBulkImportEntity("journal-entries", { canCreate: false, canEdit: true }),
  true,
  "journal-entries should allow list CSV with edit",
);

const invTpl = importTemplateCsv(
  entityDefinitions("sales").find((d) => d.key === "sales-invoices")!,
);
assert.ok(/Customer/i.test(invTpl), "sales invoice template should include Customer");
assert.ok(/Unit Price/i.test(invTpl), "sales invoice template should include Unit Price");

const billTpl = importTemplateCsv(
  entityDefinitions("purchases").find((d) => d.key === "purchase-invoices")!,
);
assert.ok(/Supplier/i.test(billTpl), "purchase invoice template should include Supplier");

const jeTpl = importTemplateCsv(
  entityDefinitions("accounts").find((d) => d.key === "journal-entries")!,
);
assert.ok(/Debit/i.test(jeTpl) && /Credit/i.test(jeTpl), "journal template should include Debit/Credit");

console.log(`csv-import coverage: ok (NAV allowed=${allowed}, denied=${denied}, settings targets=${managerTargets().length})`);
