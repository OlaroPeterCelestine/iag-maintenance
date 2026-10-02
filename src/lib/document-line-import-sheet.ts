import {
  IMPORT_TEMPLATE_EXAMPLE_TOKEN,
  IMPORT_TEMPLATE_GUIDE_TOKEN,
} from "@/lib/csv-text";
import { DOCUMENT_LINE_ENTITIES } from "@/lib/document-lines";

/** Module slug for each document line-sheet entity. */
export const DOCUMENT_LINE_IMPORT_MODULE: Record<string, string> = {
  "sales-invoices": "sales",
  invoices: "sales",
  "sales-quotes": "sales",
  "sales-orders": "sales",
  "credit-notes": "sales",
  "purchase-invoices": "purchases",
  bills: "purchases",
  "purchase-quotes": "purchases",
  "purchase-orders": "purchases",
  "debit-notes": "purchases",
};

const SUPPLIER_PARTY = new Set([
  "purchase-invoices",
  "bills",
  "purchase-quotes",
  "purchase-orders",
  "debit-notes",
]);

export function isDocumentLineImportEntity(entityKey: string): boolean {
  return DOCUMENT_LINE_ENTITIES.has(entityKey);
}

export function documentLinePartyLabel(entityKey: string): "Customer" | "Supplier" {
  return SUPPLIER_PARTY.has(entityKey) ? "Supplier" : "Customer";
}

export function documentLineImportTemplateName(entityKey: string): string {
  return `${entityKey}-import-template.csv`;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Blank line-sheet template for invoices, bills, quotes, orders, and notes. */
export function documentLineImportTemplateCsv(entityKey: string): string {
  const party = documentLinePartyLabel(entityKey);
  const today = new Date();
  const dmy = `${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`;
  const sampleParty = party === "Supplier" ? "BuildCo Ltd" : "Acme Ltd";
  const sampleAccount = party === "Supplier" ? "Cost of sales" : "Sales";
  const headers = [
    "#",
    "Reference",
    "Issue Date",
    "Due Date",
    party,
    "Currency",
    "Class / division",
    "Tax",
    "Invoice Description",
    "Item",
    "Description",
    "Account",
    "Qty",
    "Unit Price",
    "Discount",
    "Discount Type",
    "Amount",
    "Status",
  ];
  const line = (cells: string[]) => cells.map(csvEscape).join(",");
  return [
    line(headers),
    line([
      IMPORT_TEMPLATE_EXAMPLE_TOKEN,
      "",
      dmy,
      "",
      sampleParty,
      "UGX",
      "",
      "VAT 18%",
      "Sample document",
      "SKU-1",
      "Sample line",
      sampleAccount,
      "2",
      "500000",
      "",
      "percent",
      "",
      "Active",
    ]),
    line([
      IMPORT_TEMPLATE_GUIDE_TOKEN,
      "Optional — rows sharing a reference become one document",
      "DD/MM/YYYY or YYYY-MM-DD",
      "Optional",
      `Required — ${party.toLowerCase()} name`,
      "Defaults to UGX",
      "Optional class / cost centre",
      "e.g. VAT 18% or leave blank",
      "Optional header memo",
      "Optional item / SKU",
      "Required — one row per line",
      "GL account (defaults on post)",
      "Number (defaults to 1)",
      "Number only — no currency symbol",
      "Optional",
      "percent or amount",
      "Optional — computed from qty × price when blank",
      "Active or Draft",
    ]),
    "",
  ].join("\n");
}

/** @deprecated Prefer documentLineImportTemplateCsv */
export function salesInvoiceImportTemplateCsv(): string {
  return documentLineImportTemplateCsv("sales-invoices");
}

export function downloadDocumentLineImportTemplate(entityKey: string) {
  const blob = new Blob([documentLineImportTemplateCsv(entityKey)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = documentLineImportTemplateName(entityKey);
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadSalesInvoiceImportTemplate() {
  downloadDocumentLineImportTemplate("sales-invoices");
}
