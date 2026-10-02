/**
 * CSV bulk upload: template round-trip, header mapping, value coercion, and
 * per-row validation.
 *
 * Covers the defects fixed alongside this script:
 *   1. the downloaded template's example row imported itself as a real record
 *      whenever the user forgot to delete it;
 *   2. header mapping ran on the Go side without the entity's field list, so
 *      "Customer" on an invoice sheet landed in `name` and the customer column
 *      stayed empty;
 *   3. spreadsheet money ("UGX 1,200,000", "(2,500.50)") was stored verbatim;
 *   4. invalid dates / select values / missing required fields were persisted
 *      instead of reported.
 *
 * Run: npx tsx scripts/test-csv-bulk-import.mts
 */
import assert from "node:assert/strict";
import {
  csvImportableFields,
  fieldForHeader,
  importTemplateCsv,
  LINE_SHEET_CSV_ENTITIES,
  normalizeImportNumber,
  parseEntityCsvDetailed,
  parseEntityImportDetailed,
  validateImportRow,
  isCsvImportableEntity,
  canBulkImportEntity,
} from "../src/lib/data-import.ts";
import { parseDelimitedText, isTemplateMarkerRow } from "../src/lib/csv-text.ts";
import { DOCUMENT_LINE_ENTITIES } from "../src/lib/document-lines.ts";
import { documentLineImportTemplateCsv, DOCUMENT_LINE_IMPORT_MODULE } from "../src/lib/document-line-import-sheet.ts";
import { journalEntryImportTemplateCsv } from "../src/lib/journal-entry-import.ts";
import { entityDefinitions } from "../src/lib/manager-entities.ts";
import type { EntityDefinition } from "../src/lib/manager-entities.ts";
import { MODULE_SLUGS } from "../src/lib/module-data.ts";

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

const salesInvoices: EntityDefinition = {
  // Not a real DOCUMENT_LINE key — keeps these tests on the generic header CSV path.
  key: "demo-invoices",
  label: "Sales Invoices",
  singular: "Sales Invoice",
  columns: ["reference", "date", "customer", "amount", "status"],
  fields: [
    { key: "reference", label: "Reference", required: true },
    { key: "date", label: "Date", type: "date", required: true },
    { key: "customer", label: "Customer", required: true },
    { key: "amount", label: "Amount", type: "number", required: true },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["Draft", "Submitted", "Paid"],
    },
    { key: "notes", label: "Notes", type: "textarea" },
  ],
};

console.log("\nTemplate round-trip");

check("every template header maps back to its own field", () => {
  const definitions = MODULE_SLUGS.flatMap((slug) => entityDefinitions(slug)).filter((entity) =>
    isCsvImportableEntity(entity.key),
  );
  assert.ok(definitions.length > 50, "expected the module catalog to be loaded");
  const broken: string[] = [];
  for (const definition of definitions) {
    // Line-sheet entities use dedicated templates (checked in the section below).
    if (LINE_SHEET_CSV_ENTITIES.has(definition.key)) continue;
    const headers = parseDelimitedText(importTemplateCsv(definition))[0] ?? [];
    const fields = csvImportableFields(definition);
    // Column 0 is the marker column; the rest align with the importable fields.
    assert.equal(
      headers.length,
      fields.length + 1,
      `${definition.key}: template has ${headers.length} columns for ${fields.length} fields`,
    );
    fields.forEach((field, index) => {
      const header = headers[index + 1] ?? "";
      if (fieldForHeader(header, definition) !== field.key) {
        broken.push(`${definition.key}: header “${header}” does not map back to ${field.key}`);
      }
    });
  }
  assert.deepEqual(broken, [], broken.join("\n"));
});

check("uploading the untouched template imports nothing", () => {
  assert.throws(
    () => parseEntityCsvDetailed(importTemplateCsv(salesInvoices), salesInvoices),
    /blank template/i,
  );
});

check("template still parses once real rows are added", () => {
  const template = importTemplateCsv(salesInvoices);
  const withData = `${template}"",INV-1,2026-03-04,Acme Ltd,250000,Draft\n`;
  const parsed = parseEntityCsvDetailed(withData, salesInvoices);
  assert.equal(parsed.rows.length, 1, "example + guide rows must not import");
  assert.deepEqual(parsed.rows[0], {
    reference: "INV-1",
    date: "2026-03-04",
    customer: "Acme Ltd",
    amount: "250000",
    status: "Draft",
    notes: "",
  });
});

check("the marker column is not reported as an unknown column", () => {
  const csv =
    "#,Reference,Date,Customer,Amount,Status\n" + ",INV-1,2026-03-04,Acme Ltd,250000,Draft\n";
  const parsed = parseEntityCsvDetailed(csv, salesInvoices);
  assert.deepEqual(parsed.unmappedHeaders, []);
});

console.log("\nHeader mapping");

check("Customer maps to customer on an invoice sheet, not name", () => {
  // The Go importer had no field list and matched "customer" as an alias of
  // `name`, silently leaving the customer column blank on every imported row.
  assert.equal(fieldForHeader("Customer", salesInvoices), "customer");
  assert.equal(fieldForHeader("Customer name", salesInvoices), "customer");
});

check("aliases still resolve for headers that are not exact labels", () => {
  const csv =
    "Invoice No,Invoice Date,Client,Invoice Total,Status\n" +
    "INV-9,04/03/2026,Beta Ltd,90000,Paid\n";
  const parsed = parseEntityCsvDetailed(csv, salesInvoices);
  assert.deepEqual(parsed.rows[0], {
    reference: "INV-9",
    date: "2026-03-04",
    customer: "Beta Ltd",
    amount: "90000",
    status: "Paid",
  });
});

check("a duplicated header does not blank the first column's value", () => {
  const csv = "Reference,Date,Customer,Amount,Status,Reference\nINV-2,2026-03-04,Acme,1,Draft,\n";
  const parsed = parseEntityCsvDetailed(csv, salesInvoices);
  assert.equal(parsed.rows[0]!.reference, "INV-2");
});

check("unknown columns are reported rather than silently written", () => {
  const csv = "Reference,Date,Customer,Amount,Sales rep\nINV-3,2026-03-04,Acme,1,Jane\n";
  const parsed = parseEntityCsvDetailed(csv, salesInvoices);
  assert.deepEqual(parsed.unmappedHeaders, ["Sales rep"]);
  assert.equal(parsed.rows[0]!.salesRep, undefined);
});

check("a title banner above the header row is skipped", () => {
  const csv =
    "ACME LTD — SALES LISTING,,,,\n" +
    "Reference,Date,Customer,Amount,Status\n" +
    "INV-4,2026-03-04,Acme,1000,Draft\n";
  const parsed = parseEntityCsvDetailed(csv, salesInvoices);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]!.reference, "INV-4");
  assert.equal(parsed.lines[0], 3, "row line numbers must point at the source file");
});

console.log("\nValue coercion");

check("spreadsheet money becomes a plain number", () => {
  assert.equal(normalizeImportNumber("UGX 1,200,000"), "1200000");
  assert.equal(normalizeImportNumber("1.200.000,50"), "1200000.50");
  assert.equal(normalizeImportNumber("(2,500.50)"), "-2500.50");
  assert.equal(normalizeImportNumber("12%"), "12");
  assert.equal(normalizeImportNumber("  450 "), "450");
});

check("non-numeric text is left alone for validation to catch", () => {
  assert.equal(normalizeImportNumber("about ten"), "about ten");
  assert.equal(normalizeImportNumber(""), "");
});

check("number fields are coerced through the parser", () => {
  const csv = 'Reference,Date,Customer,Amount,Status\nINV-5,2026-03-04,Acme,"UGX 1,200,000",Draft\n';
  const parsed = parseEntityCsvDetailed(csv, salesInvoices);
  assert.equal(parsed.rows[0]!.amount, "1200000");
});

check("select values are matched case-insensitively", () => {
  const csv = "Reference,Date,Customer,Amount,Status\nINV-6,2026-03-04,Acme,1,paid\n";
  const parsed = parseEntityCsvDetailed(csv, salesInvoices);
  assert.equal(parsed.rows[0]!.status, "Paid");
});

check("status is not forced to Active when the entity has its own options", () => {
  const csv = "Reference,Date,Customer,Amount,Status\nINV-7,2026-03-04,Acme,1,submitted\n";
  const parsed = parseEntityCsvDetailed(csv, salesInvoices);
  assert.equal(parsed.rows[0]!.status, "Submitted");
});

check("Uganda-first dates normalize to ISO", () => {
  const csv = "Reference,Date,Customer,Amount,Status\nINV-8,15/01/2026,Acme,1,Draft\n";
  const parsed = parseEntityCsvDetailed(csv, salesInvoices);
  assert.equal(parsed.rows[0]!.date, "2026-01-15");
});

console.log("\nRow validation");

check("missing required fields are rejected", () => {
  const row = { reference: "INV-1", date: "2026-03-04", customer: "", amount: "10" };
  assert.match(String(validateImportRow(row, salesInvoices)), /Customer is required/);
});

check("a bad date is rejected with the accepted formats", () => {
  const row = { reference: "INV-1", date: "next tuesday", customer: "Acme", amount: "10" };
  assert.match(String(validateImportRow(row, salesInvoices)), /not a valid date/);
});

check("a value outside the option list is rejected", () => {
  const row = {
    reference: "INV-1",
    date: "2026-03-04",
    customer: "Acme",
    amount: "10",
    status: "Cancelled",
  };
  assert.match(String(validateImportRow(row, salesInvoices)), /Draft, Submitted, Paid/);
});

check("a non-numeric amount is rejected", () => {
  const row = { reference: "INV-1", date: "2026-03-04", customer: "Acme", amount: "about ten" };
  assert.match(String(validateImportRow(row, salesInvoices)), /is not a number/);
});

check("a blank status is allowed — the app defaults it", () => {
  const row = { reference: "INV-1", date: "2026-03-04", customer: "Acme", amount: "10" };
  assert.equal(validateImportRow({ ...row, status: "" }, salesInvoices), null);
});

check("a good row passes", () => {
  const row = {
    reference: "INV-1",
    date: "2026-03-04",
    customer: "Acme",
    amount: "250000",
    status: "Draft",
  };
  assert.equal(validateImportRow(row, salesInvoices), null);
});

console.log("\nFile handling");

check("an Excel workbook gets an actionable message", () => {
  assert.throws(
    () => parseEntityImportDetailed("ledger.xlsx", "PKbinary", salesInvoices),
    /Excel workbook/,
  );
});

check("JSON array imports keep their keys", () => {
  const parsed = parseEntityImportDetailed(
    "rows.json",
    JSON.stringify([{ reference: "INV-1", amount: 500 }]),
    salesInvoices,
  );
  assert.equal(parsed.mode, "replace");
  assert.deepEqual(parsed.rows[0], { reference: "INV-1", amount: "500" });
});

check("a file with no recognizable columns explains what to use", () => {
  assert.throws(
    () => parseEntityCsvDetailed("alpha,beta,gamma\n1,2,3\n", salesInvoices),
    /No recognized columns/,
  );
});

console.log("\nLine-sheet documents + journals");

check("every document line entity is importable on its list page", () => {
  for (const key of DOCUMENT_LINE_ENTITIES) {
    assert.ok(LINE_SHEET_CSV_ENTITIES.has(key), `${key} missing from LINE_SHEET_CSV_ENTITIES`);
    assert.equal(
      canBulkImportEntity(key, { canCreate: false, canEdit: true }),
      true,
      `${key} should allow Import CSV with edit`,
    );
    assert.ok(DOCUMENT_LINE_IMPORT_MODULE[key], `${key} needs a canonical API module`);
  }
  assert.equal(
    canBulkImportEntity("journal-entries", { canCreate: false, canEdit: true }),
    true,
    "journal-entries should allow Import CSV with edit",
  );
});

check("document templates expose party + line columns", () => {
  for (const key of ["sales-invoices", "purchase-invoices", "sales-quotes", "purchase-orders"]) {
    const def = MODULE_SLUGS.flatMap((slug) => entityDefinitions(slug)).find((d) => d.key === key);
    assert.ok(def, `${key} definition missing`);
    const csv = importTemplateCsv(def!);
    const headers = (parseDelimitedText(csv)[0] ?? []).map((h) => h.toLowerCase());
    assert.ok(headers.some((h) => h.includes("customer") || h.includes("supplier")), `${key} party column`);
    assert.ok(headers.some((h) => h.includes("description")), `${key} description`);
    assert.ok(headers.some((h) => h.includes("qty") || h.includes("quantity")), `${key} qty`);
    assert.ok(headers.some((h) => h.includes("unit price") || h.includes("price")), `${key} unit price`);
  }
});

check("untouched document template has only marker rows after the header", () => {
  const csv = documentLineImportTemplateCsv("sales-invoices");
  const rows = parseDelimitedText(csv);
  assert.ok(rows.length >= 2);
  const dataRows = rows.slice(1).filter((cells) => cells.some(Boolean));
  assert.ok(dataRows.length >= 1);
  assert.ok(
    dataRows.every((cells) => isTemplateMarkerRow(cells)),
    "every sample row must carry EXAMPLE/GUIDE so upload imports nothing",
  );
});

check("untouched journal template has only marker rows after the header", () => {
  const csv = journalEntryImportTemplateCsv();
  const rows = parseDelimitedText(csv);
  const dataRows = rows.slice(1).filter((cells) => cells.some(Boolean));
  assert.ok(dataRows.length >= 2, "need debit + credit sample rows");
  assert.ok(
    dataRows.every((cells) => isTemplateMarkerRow(cells)),
    "both journal sample lines must be EXAMPLE/GUIDE-marked",
  );
});

check("journal template includes Debit and Credit", () => {
  const def = entityDefinitions("accounts").find((d) => d.key === "journal-entries");
  assert.ok(def);
  const headers = (parseDelimitedText(importTemplateCsv(def!))[0] ?? []).join("|");
  assert.match(headers, /Debit/i);
  assert.match(headers, /Credit/i);
  assert.match(headers, /Account/i);
});

if (failures.length) {
  console.error(`\n${failures.length} CSV bulk import check(s) failed:`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("\nAll CSV bulk import checks passed.");
