import {
  IMPORT_TEMPLATE_EXAMPLE_TOKEN,
  IMPORT_TEMPLATE_GUIDE_TOKEN,
  IMPORT_TEMPLATE_MARKER_COLUMN,
  isTemplateMarkerRow,
  parseDelimitedText,
} from "@/lib/csv-text";
import { PAGE_ENTITY_CATALOG } from "@/lib/db/page-entity-catalog";
import {
  DOCUMENT_LINE_ENTITIES,
  supportsDocumentLines,
  supportsJournalLines,
} from "@/lib/document-lines";
import type { EntityDefinition, EntityField, ManagerRecord } from "@/lib/manager-entities";
import { materialRequestImportTemplateCsv } from "@/lib/material-request-lines";
import { documentLineImportTemplateCsv } from "@/lib/document-line-import-sheet";
import { journalEntryImportTemplateCsv } from "@/lib/journal-entry-import";

export {
  IMPORT_TEMPLATE_EXAMPLE_TOKEN,
  IMPORT_TEMPLATE_GUIDE_TOKEN,
  IMPORT_TEMPLATE_MARKER_COLUMN,
  isTemplateMarkerRow,
  parseDelimitedText,
} from "@/lib/csv-text";

export type ImportRow = Record<string, string>;

/**
 * Entities that use a dedicated Go line-sheet importer (not header-only CSV).
 * These stay off the generic Settings flat importer but show Import CSV on their list.
 */
export const LINE_SHEET_CSV_ENTITIES = new Set([
  "requisitions",
  ...DOCUMENT_LINE_ENTITIES,
  "journal-entries",
]);

/**
 * Lists that should not offer CSV bulk upload (read-only or specialized importers).
 * Report / computed surfaces are excluded separately via PAGE_ENTITY_CATALOG.
 */
export const NO_CSV_IMPORT_ENTITIES = new Set([
  "history",
  "deleted-records",
  "bank-statements", // dedicated bank statement importer UI
  "pos-terminal",
  "create-payroll",
  "gantt-chart",
  "fleet-cost-report",
]);

/** Soft cap so a huge file does not freeze the browser tab. */
export const BULK_IMPORT_MAX_ROWS = 25_000;


/** View-only / computed report surfaces (no durable entity_records collection). */
const COMPUTED_ENTITY_KEYS = new Set(
  PAGE_ENTITY_CATALOG.filter((row) => !row.table).map((row) => row.entity),
);

/**
 * Whether this list is a durable data page that supports CSV bulk upload.
 * Report panels, history, and specialized importers are excluded.
 */
export function isCsvImportableEntity(entityKey: string): boolean {
  const key = (entityKey || "").trim();
  if (!key) return false;
  if (NO_CSV_IMPORT_ENTITIES.has(key)) return false;
  if (COMPUTED_ENTITY_KEYS.has(key)) return false;
  return true;
}

/**
 * CSV bulk upload on most module list pages.
 * Allowed when the user can create or edit (merge/update existing rows).
 */
export function canBulkImportEntity(
  entityKey: string,
  opts: {
    canCreate: boolean;
    canEdit?: boolean;
    canPost?: boolean;
  },
): boolean {
  if (!isCsvImportableEntity(entityKey)) return false;
  // Create OR edit — do not use `??` here: an explicit canEdit:false would
  // hide Import CSV for create-only roles (sales invoices, journals, etc.).
  return Boolean(opts.canCreate || opts.canEdit);
}

/** @deprecated Prefer canBulkImportEntity — kept for older call sites. */
export const MASTER_IMPORT_ENTITIES = new Set<string>();

/** Fields included in CSV templates / header matching (skip uploads + desk feedback). */
export function csvImportableFields(definition: EntityDefinition): EntityField[] {
  // `lines` is only unimportable where it holds structured document/journal JSON
  // (invoices, bills, credit notes, journals) — those need the line editor.
  // Elsewhere (picking lists, packing lists) `lines` is a plain textarea column
  // and must stay importable, or CSV upload silently drops it — and on Picking
  // Lists, where it is required, every row would fail validation.
  const structuredLines =
    supportsDocumentLines(definition.key) || supportsJournalLines(definition.key);
  return definition.fields.filter(
    (field) =>
      !field.readOnly &&
      field.type !== "attachments" &&
      field.key !== "attachments" &&
      !(field.key === "lines" && structuredLines),
  );
}

const COMMON_ALIASES: Record<string, string[]> = {
  name: [
    "name",
    "name of supplier",
    "customer",
    "customer name",
    "supplier",
    "supplier name",
    "item",
    "item name",
    "account name",
    "account",
    "contact",
    "contact name",
    "full name",
    "company",
    "company name",
  ],
  code: [
    "code",
    "customer code",
    "supplier code",
    "sku",
    "item code",
    "account code",
    "number",
    "reference",
  ],
  email: ["email", "email address", "email addresses", "e-mail", "contact email", "email adreses", "email adresses"],
  address: ["address", "billing address", "postal address", "street"],
  currency: ["currency", "currency code", "base currency"],
  creditLimit: ["credit limit", "creditlimit", "limit"],
  contacts: ["contacts", "contact", "phone", "telephone", "mobile", "tel"],
  category: [
    "category",
    "supplier category",
    "type",
    "classification",
    "request category",
  ],
  location: ["location", "city", "town", "warehouse", "inventory location", "division"],
  balance: ["balance", "current balance", "closing balance"],
  status: ["status", "active", "obsolete"],
  unit: ["unit", "unit of measure", "uom", "unit name"],
  purchasePrice: [
    "purchase price",
    "purchaseprice",
    "cost",
    "unit cost",
    "average cost",
    "buy price",
  ],
  salesPrice: [
    "sales price",
    "selling price",
    "sale price",
    "price",
    "sell price",
    "default sales unit price",
  ],
  quantity: [
    "quantity",
    "qty",
    "opening quantity",
    "stock on hand",
    "qty owned",
    "quantity owned",
    "qty on hand",
    "starting balance quantity",
  ],
  reorderLevel: ["reorder level", "reorder point", "minimum stock", "reorder quantity"],
  kind: ["kind", "account kind", "row type"],
  type: ["type", "account type"],
  group: ["group", "account group", "category", "parent"],
  parentGroup: ["parent group", "parentgroup", "subgroup of"],
  openingBalance: [
    "opening balance",
    "openingbalance",
    "starting balance",
    "opening balance amount",
  ],
  taxId: ["business identifier", "tax id", "tin", "vat number", "tax number"],
  reference: [
    "reference",
    "ref",
    "doc no",
    "document number",
    "number",
    "invoice no",
    "bill no",
    "invoice number",
    "invoice #",
    "invoice",
    "bill number",
  ],
  date: [
    "date",
    "issue date",
    "transaction date",
    "doc date",
    "posted date",
    "invoice date",
    "billing date",
    "document date",
    "issued",
    "issued date",
  ],
  dueDate: ["due date", "duedate", "payment due", "due", "due on", "maturity date"],
  neededBy: ["needed by", "date required", "required date", "neededby"],
  amount: [
    "amount",
    "total",
    "total amount",
    "gross",
    "net",
    "value",
    "invoice amount",
    "invoice total",
    "bill amount",
    "contract amount",
  ],
  amountPaid: [
    "amount paid",
    "amountpaid",
    "paid",
    "paid amount",
    "payment",
    "payments",
    "already paid",
  ],
  balanceDue: [
    "balance due",
    "balancedue",
    "outstanding",
    "amount due",
    "remaining",
    "balance",
  ],
  tax: ["tax", "tax %", "tax percent", "tax rate", "vat", "vat %", "vat percent", "wht"],
  division: [
    "division",
    "class",
    "class division",
    "class / division",
    "cost centre",
    "cost center",
    "costcentre",
    "department class",
  ],
  // `party` is the counterparty column on transaction sheets — labelled
  // "Customer" on sales documents and "Supplier" on purchase documents.
  party: [
    "party",
    "payee",
    "paid to",
    "received from",
    "contractor",
    "contractor name",
    "supplier",
    "supplier name",
    "vendor",
    "customer",
    "customer name",
    "client",
    "buyer",
    "bill to",
    "sold to",
  ],
  customer: ["customer", "customer name", "client", "buyer"],
  supplier: [
    "supplier",
    "supplier name",
    "supplier alias",
    "vendor",
    "creditor",
    "company",
  ],
  project: ["project", "project name", "job", "job name", "works", "site"],
  phase: ["phase", "phase name", "stage"],
  activity: ["activity", "activity name", "task", "task name"],
  contractor: ["contractor", "contractor name", "initiator", "requested by", "initiator / requested by"],
  department: ["department", "dept", "cost centre", "cost center"],
  payTo: ["pay to", "payto", "payment type", "pay type"],
  payee: ["payee", "beneficiary", "paid to"],
  description: [
    "description",
    "narration",
    "memo",
    "notes",
    "details",
    "particulars",
    "material description",
    "materials / items",
    "materials items",
    "invoice description",
  ],
  employee: ["employee", "staff", "worker", "employee name"],
  subject: ["subject", "title", "request subject"],
  purpose: ["purpose", "purpose / oral brief", "oral brief", "brief"],
  priority: ["priority", "urgency"],
  requestedBy: ["requested by", "requestor", "requester", "requestedby"],
  leaveType: ["leave type", "leavetype", "type of leave", "leave"],
  startDate: ["start date", "startdate", "from date", "leave start"],
  endDate: ["end date", "enddate", "to date", "leave end"],
  days: ["days", "number of days", "leave days"],
  reason: ["reason", "leave reason", "justification"],
  claimant: ["claimant", "claimant / customer", "employee", "claimant name"],
};

const DATE_FIELD_KEYS = new Set([
  "date",
  "dueDate",
  "issueDate",
  "startDate",
  "endDate",
  "nextIssueDate",
  "asOf",
  "acquired",
  "purchaseDate",
  "commencementDate",
  "neededBy",
  "hireDate",
  "completedDate",
  "receivedDate",
]);

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoFromParts(year: number, month: number, day: number): string | null {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const fullYear = year < 100 ? (year >= 70 ? 1900 + year : 2000 + year) : year;
  const candidate = `${fullYear}-${pad2(month)}-${pad2(day)}`;
  const parsed = Date.parse(`${candidate}T00:00:00`);
  if (Number.isNaN(parsed)) return null;
  const check = new Date(parsed);
  if (
    check.getFullYear() !== fullYear ||
    check.getMonth() + 1 !== month ||
    check.getDate() !== day
  ) {
    return null;
  }
  return candidate;
}

/**
 * Convert common spreadsheet / CSV date values to YYYY-MM-DD.
 * Uganda-first: when DD/MM vs MM/DD is ambiguous, prefer day-month-year.
 */
export function normalizeToIsoDate(raw: string): string {
  const cleaned = String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!cleaned) return "";

  // Already ISO (optionally with time).
  const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3])) || "";
  }

  // Excel serial day count (e.g. 45321).
  if (/^\d{4,5}(?:\.0+)?$/.test(cleaned)) {
    const serial = Math.floor(Number(cleaned));
    if (serial > 20000 && serial < 80000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const ms = excelEpoch + serial * 24 * 60 * 60 * 1000;
      const d = new Date(ms);
      return isoFromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) || "";
    }
  }

  // 15-Jan-2026 / 15 Jan 2026 / Jan 15, 2026
  const named = cleaned.match(
    /^(\d{1,2})[\/\-\s]+([A-Za-z]{3,9})[\/\-\s,]+(\d{2,4})$|^([A-Za-z]{3,9})[\/\-\s,]+(\d{1,2})[\/\-\s,]+(\d{2,4})$/,
  );
  if (named) {
    if (named[1] && named[2] && named[3]) {
      const month = MONTH_NAMES[named[2].toLowerCase()];
      if (month) return isoFromParts(Number(named[3]), month, Number(named[1])) || "";
    }
    if (named[4] && named[5] && named[6]) {
      const month = MONTH_NAMES[named[4].toLowerCase()];
      if (month) return isoFromParts(Number(named[6]), month, Number(named[5])) || "";
    }
  }

  // Numeric separators: 15/01/2026, 01-15-2026, 2026/01/15, 15.01.2026
  const parts = cleaned.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})(?:\s+.*)?$/);
  if (parts) {
    const a = Number(parts[1]);
    const b = Number(parts[2]);
    const c = Number(parts[3]);
    if (String(parts[1]).length === 4) {
      return isoFromParts(a, b, c) || "";
    }
    if (String(parts[3]).length === 4 || String(parts[3]).length === 2) {
      // Prefer DD/MM/YYYY (Uganda). If first > 12 it must be day; if second > 12 it must be month-first.
      if (a > 12 && b <= 12) return isoFromParts(c, b, a) || "";
      if (b > 12 && a <= 12) return isoFromParts(c, a, b) || "";
      return isoFromParts(c, b, a) || "";
    }
  }

  // Last resort: Date.parse for locale strings.
  const fallback = Date.parse(cleaned);
  if (!Number.isNaN(fallback)) {
    const d = new Date(fallback);
    if (!Number.isNaN(d.getTime())) {
      return isoFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate()) || "";
    }
  }
  return "";
}

export function isDateImportField(key: string, definition?: EntityDefinition): boolean {
  if (DATE_FIELD_KEYS.has(key)) return true;
  if (!definition) return false;
  return definition.fields.some((field) => field.key === key && field.type === "date");
}

function canonicalHeader(value: string) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/^\uFFFE/, "")
    .trim()
    // InvoiceDate / AmountPaid → Invoice Date / Amount Paid
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    // Tax% / Class/division / Supplier (alias) → comparable tokens
    .replace(/%/g, " percent ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the payload looks like an Excel workbook (or other binary) rather than CSV/JSON text. */
function looksLikeBinaryImport(text: string, fileName = ""): boolean {
  if (/\.(xlsx|xls|xlsm|xlsb)$/i.test(fileName)) return true;
  if (text.startsWith("PK\u0003\u0004") || text.startsWith("PK\x03\x04")) return true;
  // OLE Compound Document signature used by legacy .xls
  if (text.charCodeAt(0) === 0xd0 && text.charCodeAt(1) === 0xcf) return true;
  const sample = text.slice(0, 512);
  let nonText = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    if (code === 0 || (code < 9 && code !== 0) || (code > 14 && code < 32 && code !== 27)) {
      nonText += 1;
    }
  }
  return sample.length > 40 && nonText / sample.length > 0.2;
}

/**
 * Pick the first row among the opening lines that maps onto the entity definition.
 * Skips title / blank / summary rows that often sit above real CSV headers.
 */
function findHeaderRowIndex(rows: string[][], definition: EntityDefinition): number {
  const limit = Math.min(rows.length, 20);
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < limit; i += 1) {
    const score = scoreHeaders(rows[i] || [], definition);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestScore > 0 ? bestIdx : 0;
}

export function fieldForHeader(header: string, definition: EntityDefinition): string | null {
  const normalized = canonicalHeader(header);
  if (!normalized) return null;
  const fields = csvImportableFields(definition);
  const exact = fields.find(
    (field) =>
      canonicalHeader(field.key) === normalized ||
      canonicalHeader(field.label) === normalized,
  );
  if (exact) return exact.key;
  for (const field of fields) {
    const aliases = COMMON_ALIASES[field.key] || [];
    if (aliases.some((alias) => canonicalHeader(alias) === normalized)) return field.key;
  }
  // Loose contains match for longer labels (e.g. "Supplier (alias for party)" → supplier)
  for (const field of fields) {
    const labelCanon = canonicalHeader(field.label);
    if (
      labelCanon.length >= 4 &&
      (normalized === labelCanon ||
        normalized.startsWith(`${labelCanon} `) ||
        labelCanon.startsWith(`${normalized} `))
    ) {
      return field.key;
    }
  }
  return null;
}

/** How many of a file's headers map onto an entity definition (used for auto-detect). */
export function scoreHeaders(headers: string[], definition: EntityDefinition): number {
  const mapped = headers.filter((header) => fieldForHeader(header, definition));
  return mapped.length;
}

/**
 * Spreadsheet money → plain number string.
 * "UGX 1,200,000" → "1200000", "(2,500.50)" → "-2500.5", "12%" → "12".
 * Anything that is not confidently numeric is returned untouched so validation
 * can report it instead of silently writing a wrong figure.
 */
export function normalizeImportNumber(raw: string): string {
  const original = String(raw ?? "").trim();
  if (!original) return "";
  let text = original;
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  text = text
    .replace(/^\(|\)$/g, "")
    .replace(/^-/, "")
    // Currency codes / symbols / percent signs / spaces around the figure.
    .replace(/[A-Za-z$€£¥₦%]/g, "")
    .replace(/\s| /g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
    text = text.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
    // European grouping: 1.200.000,50
    text = text.replace(/\./g, "").replace(",", ".");
  } else {
    text = text.replace(/,/g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return original;
  return negative ? `-${text}` : text;
}

function fieldByKey(key: string, definition?: EntityDefinition): EntityField | undefined {
  return definition?.fields.find((field) => field.key === key);
}

/** Match a CSV value against a select field's options, ignoring case and punctuation. */
function coerceSelectValue(value: string, options?: string[]): string {
  if (!options?.length || !value) return value;
  const canon = canonicalHeader(value);
  return options.find((option) => canonicalHeader(option) === canon) ?? value;
}

function normalizeValue(key: string, value: string, definition?: EntityDefinition): string {
  const cleaned = value.trim();
  if (isDateImportField(key, definition)) {
    return normalizeToIsoDate(cleaned) || cleaned;
  }
  const field = fieldByKey(key, definition);
  if (field?.type === "number") return normalizeImportNumber(cleaned);
  if (field?.type === "select" && key !== "status") {
    return coerceSelectValue(cleaned, field.options);
  }
  if (key === "status") {
    // Only fall back to Active/Inactive when the entity has no status option list
    // (Draft / Submitted / Approved lists must keep their own wording).
    const options = field?.options;
    const matched = coerceSelectValue(cleaned, options);
    if (options?.length && matched !== cleaned) return matched;
    if (!options?.some((option) => canonicalHeader(option) === canonicalHeader(cleaned))) {
      if (/^(yes|true|1|active)$/i.test(cleaned)) return "Active";
      if (/^(no|false|0|inactive)$/i.test(cleaned)) return "Inactive";
    }
  }
  if (key === "type") {
    const types: Record<string, string> = {
      asset: "Asset",
      assets: "Asset",
      liability: "Liability",
      liabilities: "Liability",
      equity: "Equity",
      capital: "Equity",
      income: "Income",
      revenue: "Income",
      expense: "Expense",
      expenses: "Expense",
    };
    return types[cleaned.toLowerCase()] || cleaned;
  }
  if (key === "kind" && !cleaned) return "Account";
  return cleaned;
}

/** Parsed import with enough detail to report per-row problems back to the user. */
export type ParsedEntityImport = {
  rows: ImportRow[];
  /** 1-based line in the source file for rows[i] — used in error messages. */
  lines: number[];
  mode: "merge" | "replace";
  /** Field keys the file actually supplies. */
  mappedFields: string[];
  /** Headers that matched no field on this entity (values are ignored). */
  unmappedHeaders: string[];
};

export function parseEntityCsvDetailed(
  text: string,
  definition: EntityDefinition,
): ParsedEntityImport {
  const allRows = parseDelimitedText(text);
  // Drop the template's own example / guide rows before anything else, so header
  // detection cannot latch onto them and the samples never import.
  const rows: string[][] = [];
  const sourceLines: number[] = [];
  allRows.forEach((cells, index) => {
    if (isTemplateMarkerRow(cells)) return;
    rows.push(cells);
    sourceLines.push(index + 1);
  });
  if (rows.length < 2) {
    throw new Error(
      rows.length < allRows.length
        ? "This is the blank template — add your rows below the header row, then upload it again."
        : "The file needs a header row and at least one data row.",
    );
  }

  const headerIndex = findHeaderRowIndex(rows, definition);
  const headers = rows[headerIndex]!;
  // First column to claim a field wins — a duplicated header must not blank the
  // value the earlier column already supplied.
  const claimed = new Set<string>();
  const unmappedHeaders: string[] = [];
  const mapping = headers.map((header) => {
    const field = fieldForHeader(header, definition);
    if (!field) {
      // The template's leading marker column is expected to map to nothing.
      if (header.trim() && header.trim() !== IMPORT_TEMPLATE_MARKER_COLUMN) {
        unmappedHeaders.push(header.trim());
      }
      return null;
    }
    if (claimed.has(field)) return null;
    claimed.add(field);
    return field;
  });
  if (!mapping.some(Boolean)) {
    const found = headers.filter(Boolean).slice(0, 8).join(", ") || "(none)";
    throw new Error(
      `No recognized columns. Found: ${found}. Use headers such as: ${csvImportableFields(definition)
        .map((field) => field.label)
        .slice(0, 12)
        .join(", ")}.`,
    );
  }

  const dataRows = rows.slice(headerIndex + 1);
  if (dataRows.length > BULK_IMPORT_MAX_ROWS) {
    throw new Error(
      `This file has ${dataRows.length.toLocaleString()} rows. Split it into files of ${BULK_IMPORT_MAX_ROWS.toLocaleString()} rows or fewer.`,
    );
  }

  const parsedRows: ImportRow[] = [];
  const lines: number[] = [];
  dataRows.forEach((cells, index) => {
    const row: ImportRow = {};
    mapping.forEach((field, column) => {
      if (field) row[field] = normalizeValue(field, cells[column] || "", definition);
    });
    if (!Object.values(row).some(Boolean)) return;
    parsedRows.push(row);
    lines.push(sourceLines[headerIndex + 1 + index] ?? headerIndex + index + 2);
  });

  return {
    rows: parsedRows,
    lines,
    mode: "merge",
    mappedFields: Array.from(claimed),
    unmappedHeaders,
  };
}

export function parseEntityCsv(text: string, definition: EntityDefinition): ImportRow[] {
  return parseEntityCsvDetailed(text, definition).rows;
}

export function parseEntityImportDetailed(
  fileName: string,
  text: string,
  definition: EntityDefinition,
): ParsedEntityImport {
  if (looksLikeBinaryImport(text, fileName)) {
    throw new Error(
      "This looks like an Excel workbook (.xlsx/.xls). Save or export it as CSV (File → Save As → CSV UTF-8), then upload the .csv file.",
    );
  }
  if (/\.json$/i.test(fileName) || text.trim().startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new Error("Invalid JSON — could not parse the import file.");
    }
    if (!Array.isArray(parsed)) throw new Error("JSON imports must contain an array.");
    const rows = parsed.map((item) => {
      if (!item || typeof item !== "object") return {};
      return Object.fromEntries(
        Object.entries(item).map(([key, value]) => [
          key,
          value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value),
        ]),
      );
    });
    return {
      rows,
      lines: rows.map((_, index) => index + 1),
      mode: "replace",
      mappedFields: Array.from(new Set(rows.flatMap((row) => Object.keys(row)))),
      unmappedHeaders: [],
    };
  }
  return parseEntityCsvDetailed(text, definition);
}

export function parseEntityImport(
  fileName: string,
  text: string,
  definition: EntityDefinition,
): { rows: ImportRow[]; mode: "merge" | "replace" } {
  const parsed = parseEntityImportDetailed(fileName, text, definition);
  return { rows: parsed.rows, mode: parsed.mode };
}

/**
 * Fields the app fills in itself when a row leaves them blank, so a CSV that
 * omits them is fine even though the form marks them required.
 */
const IMPORT_DEFAULTED_FIELDS = new Set(["status", "currency"]);

/**
 * Field-level check before a row is sent to the API — mirrors the form rules so
 * bulk upload cannot create records the UI would have rejected.
 * Returns a user-facing message, or null when the row is good.
 */
export function validateImportRow(
  row: ImportRow,
  definition: EntityDefinition,
): string | null {
  for (const field of csvImportableFields(definition)) {
    const value = (row[field.key] ?? "").trim();
    if (!value) {
      if (field.required && !IMPORT_DEFAULTED_FIELDS.has(field.key)) {
        return `${field.label} is required.`;
      }
      continue;
    }
    if (field.type === "number" && !Number.isFinite(Number(value))) {
      return `${field.label} “${value}” is not a number.`;
    }
    if (isDateImportField(field.key, definition) && !normalizeToIsoDate(value)) {
      return `${field.label} “${value}” is not a valid date. Use YYYY-MM-DD or DD/MM/YYYY.`;
    }
    if (field.type === "select" && field.options?.length) {
      const allowed = field.options.some(
        (option) => canonicalHeader(option) === canonicalHeader(value),
      );
      if (!allowed) {
        return `${field.label} “${value}” is not allowed. Use one of: ${field.options.join(", ")}.`;
      }
    }
  }
  return null;
}

function identityFields(entityKey: string): string[] {
  if (entityKey === "chart-of-accounts") return ["code", "name"];
  if (entityKey === "inventory-items") return ["code", "name"];
  if (entityKey === "customers" || entityKey === "suppliers") {
    return ["code", "email", "name"];
  }
  return ["id", "reference", "code", "name"];
}

export function findImportedMatch(
  row: ImportRow,
  existing: ManagerRecord[],
  entityKey: string,
): ManagerRecord | undefined {
  for (const field of identityFields(entityKey)) {
    const value = (row[field] || "").trim().toLowerCase();
    if (!value) continue;
    const match = existing.find(
      (record) => (record[field] || "").trim().toLowerCase() === value,
    );
    if (match) return match;
  }
  return undefined;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Header text for a template column. Prefers punctuation-light wording, then
 * verifies it maps back to the same field — a template that cannot re-import
 * itself is worse than none, so an unverifiable label falls back to the key.
 */
function templateHeader(field: EntityField, definition: EntityDefinition): string {
  const preferred =
    field.key === "division"
      ? "Division"
      : field.key === "tax"
        ? "Tax percent"
        : field.key === "supplier" && /alias/i.test(field.label)
          ? "Supplier"
          : field.key === "amountPaid"
            ? "Amount paid"
            : field.key === "balanceDue"
              ? "Balance due"
              : field.label;
  for (const candidate of [preferred, field.label, field.key]) {
    if (candidate && fieldForHeader(candidate, definition) === field.key) return candidate;
  }
  return field.key;
}

function templateExampleValue(
  field: EntityField,
  definition: EntityDefinition,
  today: string,
): string {
  if (field.type === "date" || DATE_FIELD_KEYS.has(field.key)) return today;
  if (field.key === "status") {
    // Documents start as drafts; master lists (no date column) start active.
    const isDocument = definition.fields.some(
      (other) => other.type === "date" || DATE_FIELD_KEYS.has(other.key),
    );
    for (const preferred of isDocument ? ["Draft", "Submitted"] : ["Active"]) {
      if (field.options?.includes(preferred)) return preferred;
    }
    if (field.options?.length) return field.options[0]!;
    return "Active";
  }
  if (field.type === "select" && field.options?.[0]) return field.options[0];
  if (field.type === "email") return "name@example.com";
  if (field.key === "currency") return "UGX";
  if (field.key === "reference") return "REF-0001";
  if (field.key === "code") return "CODE-001";
  if (field.key === "name") return "Sample name";
  if (field.key === "party" || field.key === "customer" || field.key === "supplier") {
    return "Sample party";
  }
  if (field.key === "project") return "Sample project";
  if (field.key === "amount" || field.key === "total") return "100000";
  if (field.key === "quantity") return "1";
  if (field.key === "description" || field.key === "purpose" || field.key === "subject") {
    return "Example row — replace with your data";
  }
  if (field.key === "priority") return "Medium";
  if (field.key === "leaveType") return "Annual";
  if (field.type === "number") return "0";
  // Anything else the list insists on: show the shape rather than a blank cell.
  if (field.required) return `Sample ${field.label.toLowerCase()}`;
  return "";
}

/** One-line "how to fill this column" note shown in the template's guide row. */
function templateGuideValue(field: EntityField): string {
  const parts: string[] = [
    field.required && !IMPORT_DEFAULTED_FIELDS.has(field.key) ? "Required" : "Optional",
  ];
  if (field.type === "select" && field.options?.length) {
    const shown = field.options.slice(0, 8).join(", ");
    parts.push(`one of: ${shown}${field.options.length > 8 ? ", …" : ""}`);
  } else if (field.type === "date" || DATE_FIELD_KEYS.has(field.key)) {
    parts.push("date as YYYY-MM-DD or DD/MM/YYYY");
  } else if (field.type === "number") {
    parts.push("number only — no thousands separators or currency symbol");
  } else if (field.type === "email") {
    parts.push("email address");
  } else if (field.placeholder) {
    parts.push(field.placeholder);
  }
  return parts.join(" — ");
}

/**
 * Blank upload sheet for a list: header row, one filled example, and a guide row
 * describing each column. Both sample rows carry the marker token in the leading
 * "#" column so uploading the template untouched imports nothing.
 */
export function importTemplateCsv(definition: EntityDefinition): string {
  // Line-sheet entities use dedicated templates matching their Go importers.
  if (definition.key === "requisitions") {
    return materialRequestImportTemplateCsv();
  }
  if (DOCUMENT_LINE_ENTITIES.has(definition.key)) {
    return documentLineImportTemplateCsv(definition.key);
  }
  if (definition.key === "journal-entries") {
    return journalEntryImportTemplateCsv();
  }
  const fields = csvImportableFields(definition);
  const today = new Date().toISOString().slice(0, 10);
  const line = (cells: string[]) => cells.map(csvEscape).join(",");
  return [
    line([IMPORT_TEMPLATE_MARKER_COLUMN, ...fields.map((field) => templateHeader(field, definition))]),
    line([
      IMPORT_TEMPLATE_EXAMPLE_TOKEN,
      ...fields.map((field) => templateExampleValue(field, definition, today)),
    ]),
    line([IMPORT_TEMPLATE_GUIDE_TOKEN, ...fields.map(templateGuideValue)]),
    "",
  ].join("\n");
}

/** Normalize date fields on an imported / form record to YYYY-MM-DD. */
export function normalizeRecordDates(
  record: Record<string, string>,
  definition?: EntityDefinition,
): Record<string, string> {
  const next = { ...record };
  for (const [key, value] of Object.entries(next)) {
    if (!isDateImportField(key, definition)) continue;
    const iso = normalizeToIsoDate(value || "");
    if (iso) next[key] = iso;
  }
  return next;
}
