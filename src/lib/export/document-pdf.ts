import {
  documentLinesFromRecord,
  documentLinesTotal,
  supportsDocumentLines,
} from "@/lib/document-lines";
import { downloadBlob, hexToRgb, safeFilename } from "@/lib/export/download";
import { drawPdfFooter, drawPdfLetterhead, getCompanyLetterhead } from "@/lib/export/letterhead";
import {
  documentTemplateById,
  loadDocumentTerms,
  recommendedAccentForEntity,
  templateForDocument,
  type DocumentTemplateId,
  type DocumentTerms,
} from "@/lib/export/document-templates";
import {
  DOCUMENT_PDF_ENTITIES,
  supportsDocumentPdf,
} from "@/lib/export/supports-document-pdf";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords } from "@/lib/records-store";
import {
  FOOTERS_KEY,
  THEMES_KEY,
  defaultFooters,
  defaultThemes,
  loadList,
  loadManagerSettings,
  type FooterRow,
  type ThemeRow,
} from "@/lib/manager-settings";

export { DOCUMENT_PDF_ENTITIES, supportsDocumentPdf };

const ENTITY_FORM_TYPE: Record<string, string> = {
  "sales-invoices": "Sales invoices",
  "purchase-invoices": "Purchase invoices",
  "sales-quotes": "Sales quotes",
  "purchase-quotes": "Purchase quotes",
  "sales-orders": "Sales orders",
  "purchase-orders": "Purchase orders",
  "credit-notes": "Credit notes",
  "debit-notes": "Debit notes",
  "delivery-notes": "Delivery notes",
  "late-payment-fees": "Sales invoices",
  "billable-time": "Sales invoices",
  "billable-expenses": "Sales invoices",
  "revenue-contracts": "Sales invoices",
  "goods-receipts": "Goods receipts",
  receipts: "Receipts",
  payments: "Payments",
  "inter-account-transfers": "Receipts",
  reconciliations: "Receipts",
  payslips: "Payslips",
  "statutory-remittances": "Payslips",
  "expense-claims": "Expense claims",
  "inventory-transfers": "Purchase orders",
  "inventory-write-offs": "Purchase invoices",
  "stock-in": "Goods receipts",
  "inventory-sales": "Sales invoices",
  "production-orders": "Purchase orders",
  stocktakes: "Purchase invoices",
  "landed-costs": "Purchase invoices",
  "fixed-assets": "Purchase invoices",
  "depreciation-entries": "Journal entries",
  "intangible-assets": "Purchase invoices",
  "amortization-entries": "Journal entries",
  leases: "Purchase invoices",
  "capital-accounts": "Journal entries",
  "share-based-payments": "Journal entries",
  "journal-entries": "Journal entries",
  "matching-entries": "Journal entries",
  provisions: "Journal entries",
  "withholding-tax-receipts": "Sales invoices",
  "withholding-tax": "Purchase invoices",
  "fuel-requests": "Expense claims",
  "fuel-logs": "Expense claims",
  "trip-requests": "Expense claims",
  "maintenance-requests": "Expense claims",
  "payment-requests": "Expense claims",
  "oral-payment-requests": "Expense claims",
  "pos-sales": "Sales invoices",
  "pos-returns": "Credit notes",
  "daily-closings": "Receipts",
  requisitions: "Expense claims",
  "general-requests": "Expense claims",
  "procurement-list": "Purchase orders",
};

/** Headline printed on the document for each entity. */
const ENTITY_DOCUMENT_TITLE: Record<string, string> = {
  "sales-invoices": "INVOICE",
  "purchase-invoices": "PURCHASE INVOICE",
  "sales-quotes": "PRO FORMA INVOICE",
  "purchase-quotes": "REQUEST FOR QUOTATION",
  "sales-orders": "SALES ORDER",
  "purchase-orders": "PURCHASE ORDER",
  "credit-notes": "CREDIT NOTE",
  "debit-notes": "DEBIT NOTE",
  "delivery-notes": "DELIVERY NOTE",
  "late-payment-fees": "LATE PAYMENT FEE",
  "billable-time": "BILLABLE TIME",
  "billable-expenses": "BILLABLE EXPENSE",
  "revenue-contracts": "REVENUE CONTRACT",
  "goods-receipts": "GOODS RECEIPT NOTE",
  receipts: "RECEIPT",
  payments: "PAYMENT ADVICE",
  "inter-account-transfers": "INTER-ACCOUNT TRANSFER",
  reconciliations: "BANK RECONCILIATION",
  payslips: "PAYSLIP",
  "statutory-remittances": "STATUTORY REMITTANCE",
  "expense-claims": "EXPENSE CLAIM",
  "inventory-transfers": "INVENTORY TRANSFER",
  "inventory-write-offs": "INVENTORY WRITE-OFF",
  "stock-in": "STOCK IN",
  "inventory-sales": "INVENTORY SALE",
  "production-orders": "PRODUCTION ORDER",
  stocktakes: "STOCKTAKE",
  "landed-costs": "LANDED COST",
  "fixed-assets": "FIXED ASSET",
  "depreciation-entries": "DEPRECIATION ENTRY",
  "intangible-assets": "INTANGIBLE ASSET",
  "amortization-entries": "AMORTISATION ENTRY",
  leases: "LEASE",
  "capital-accounts": "CAPITAL ACCOUNT",
  "share-based-payments": "SHARE-BASED PAYMENT",
  "journal-entries": "JOURNAL ENTRY",
  "matching-entries": "MATCHING ENTRY",
  provisions: "PROVISION",
  "withholding-tax-receipts": "WITHHOLDING TAX RECEIPT",
  "withholding-tax": "WITHHOLDING TAX",
  "fuel-requests": "FUEL REQUEST",
  "fuel-logs": "FUEL LOG",
  "trip-requests": "TRIP REQUEST",
  "maintenance-requests": "MAINTENANCE REQUEST",
  "payment-requests": "PAYMENT REQUEST",
  "oral-payment-requests": "ORAL PAYMENT REQUEST",
  "pos-sales": "POS SALE",
  "pos-returns": "POS RETURN",
  "daily-closings": "DAILY CLOSING",
  requisitions: "REQUISITION",
  "general-requests": "GENERAL REQUEST",
  "procurement-list": "PROCUREMENT LIST",
};

/** Reference caption used in the meta panel. */
const ENTITY_REFERENCE_LABEL: Record<string, string> = {
  "sales-invoices": "INVOICE NO #",
  "purchase-invoices": "INVOICE NO #",
  "sales-quotes": "INVOICE NO #",
  "purchase-quotes": "RFQ NO #",
  "sales-orders": "ORDER NO #",
  "purchase-orders": "ORDER NO #",
  "credit-notes": "CREDIT NOTE #",
  "debit-notes": "DEBIT NOTE #",
  "delivery-notes": "DELIVERY NO #",
  "late-payment-fees": "FEE NO #",
  "billable-time": "TIME NO #",
  "billable-expenses": "EXPENSE NO #",
  "revenue-contracts": "CONTRACT NO #",
  "goods-receipts": "GRN NO #",
  receipts: "RECEIPT NO #",
  payments: "PAYMENT NO #",
  "inter-account-transfers": "TRANSFER NO #",
  reconciliations: "RECON NO #",
  payslips: "PAYSLIP NO #",
  "statutory-remittances": "REMITTANCE NO #",
  "expense-claims": "CLAIM NO #",
  "inventory-transfers": "TRANSFER NO #",
  "inventory-write-offs": "WRITE-OFF NO #",
  "stock-in": "STOCK IN NO #",
  "inventory-sales": "SALE NO #",
  "production-orders": "PROD NO #",
  stocktakes: "STOCKTAKE NO #",
  "landed-costs": "LANDED COST #",
  "fixed-assets": "ASSET NO #",
  "depreciation-entries": "DEP NO #",
  "intangible-assets": "ASSET NO #",
  "amortization-entries": "AMO NO #",
  leases: "LEASE NO #",
  "capital-accounts": "CAPITAL NO #",
  "share-based-payments": "SBP NO #",
  "journal-entries": "ENTRY NO #",
  "matching-entries": "MATCH NO #",
  provisions: "PROVISION NO #",
  "withholding-tax-receipts": "WHT NO #",
  "withholding-tax": "WHT NO #",
  "fuel-requests": "REQUEST NO #",
  "fuel-logs": "LOG NO #",
  "trip-requests": "TRIP NO #",
  "maintenance-requests": "MNT NO #",
  "payment-requests": "REQUEST NO #",
  "oral-payment-requests": "ORAL REQ NO #",
  "pos-sales": "TICKET NO #",
  "pos-returns": "RETURN NO #",
  "daily-closings": "CLOSE NO #",
  requisitions: "REQUISITION NO #",
  "general-requests": "REQUEST NO #",
  "procurement-list": "PROCUREMENT NO #",
};

export function formTypeForEntity(entityKey: string, entityLabel?: string) {
  return ENTITY_FORM_TYPE[entityKey] || entityLabel || "Sales invoices";
}

function partyOf(record: ManagerRecord) {
  return (
    record.customer ||
    record.supplier ||
    record.party ||
    record.employee ||
    record.claimant ||
    record.driver ||
    record.requestedBy ||
    record.vehicle ||
    record.name ||
    ""
  );
}

function themeFor(formType: string): ThemeRow {
  const themes = loadList(THEMES_KEY, defaultThemes);
  return themes.find((t) => t.formType === formType) || themes[0] || defaultThemes[0];
}

function footersFor(formType: string): FooterRow[] {
  return loadList(FOOTERS_KEY, defaultFooters).filter(
    (f) => f.formType === formType && f.active !== "No",
  );
}

/** Address + identifier for the billed party, looked up from master data. */
function partyDetails(entityKey: string, name: string) {
  if (!name) return { addressLines: [] as string[], code: "" };
  const buckets: [string, string][] = /purchase|debit|goods/.test(entityKey)
    ? [["purchases", "suppliers"]]
    : [
        ["sales", "customers"],
        ["purchases", "suppliers"],
        ["payroll", "employees"],
      ];
  for (const [moduleSlug, entity] of buckets) {
    const match = loadRecords(moduleSlug, entity).find(
      (row) => (row.name || "").trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (match) {
      const lines = [match.address, match.billingAddress, match.city, match.country]
        .map((line) => (line || "").trim())
        .filter(Boolean);
      return { addressLines: Array.from(new Set(lines)), code: match.code || "" };
    }
  }
  return { addressLines: [], code: "" };
}

/** Unit of measure per item code/name, taken from inventory master data. */
function unitLookup(): Map<string, string> {
  const map = new Map<string, string>();
  for (const entity of ["inventory-items", "non-inventory-items"]) {
    for (const row of loadRecords("inventory", entity)) {
      const unit = (row.unit || "").trim();
      if (!unit) continue;
      if (row.code) map.set(row.code.trim().toLowerCase(), unit);
      if (row.name) map.set(row.name.trim().toLowerCase(), unit);
    }
  }
  return map;
}

function currencyDecimals(currency: string) {
  const settings = loadManagerSettings();
  if (currency && currency !== settings.baseCurrencyCode) return 2;
  return settings.baseCurrencyDecimals ?? 0;
}

function addDays(iso: string, days: number) {
  if (!iso) return "";
  const parsed = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export type DocumentRenderModel = {
  title: string;
  formType: string;
  entityKey: string;
  reference: string;
  referenceLabel: string;
  date: string;
  dueDate: string;
  validUntil: string;
  party: string;
  partyLabel: string;
  partyAddressLines: string[];
  customerId: string;
  description: string;
  status: string;
  currency: string;
  currencySymbol: string;
  decimals: number;
  taxRate: number;
  taxLabel: string;
  tax: number;
  subtotal: number;
  taxable: number;
  other: string;
  total: number;
  footerText: string;
  theme: ThemeRow;
  templateId: DocumentTemplateId;
  accent: string;
  terms: DocumentTerms;
  businessName: string;
  legalName: string;
  businessAddressLines: string[];
  businessEmail: string;
  businessPhone: string;
  businessWebsite: string;
  taxId: string;
  registrationNumber: string;
  logoDataUrl: string;
  lines: {
    item: string;
    description: string;
    qty: number;
    unitLabel: string;
    unitCost: number;
    amount: number;
  }[];
  extras: { label: string; value: string }[];
};

export function buildDocumentModel(
  entityKey: string,
  entityLabel: string,
  record: ManagerRecord,
  options?: { templateId?: DocumentTemplateId },
): DocumentRenderModel {
  const formType = formTypeForEntity(entityKey, entityLabel);
  const settings = loadManagerSettings();
  const company = getCompanyLetterhead();
  const terms = loadDocumentTerms();
  const templateId =
    options?.templateId ?? templateForDocument(entityKey, formType);
  const template = documentTemplateById(templateId);
  const theme = themeFor(formType);

  const linesRaw = documentLinesFromRecord(record);
  const units = unitLookup();
  const lines = linesRaw.map((line) => ({
    item: line.item,
    description: line.description || line.item,
    qty: parseAmount(line.quantity) || 1,
    unitLabel:
      units.get((line.item || "").trim().toLowerCase()) ||
      units.get((line.description || "").trim().toLowerCase()) ||
      "Pcs",
    unitCost: parseAmount(line.unitPrice),
    amount:
      parseAmount(line.amount) ||
      roundMoney(parseAmount(line.quantity) * parseAmount(line.unitPrice)),
  }));

  // `tax` may hold a code ("VAT 18%") or a plain amount; taxAmount always wins.
  const taxRaw = (record.tax || "").trim();
  const percentMatch = /(\d+(?:\.\d+)?)\s*%/.exec(taxRaw);
  const taxRate = percentMatch ? Number(percentMatch[1]) : parseAmount(record.taxRate);
  const storedTaxAmount =
    record.taxAmount !== undefined && String(record.taxAmount).trim() !== ""
      ? parseAmount(record.taxAmount)
      : null;

  const lineSubtotal = lines.length ? documentLinesTotal(linesRaw) : 0;
  const recordAmount = parseAmount(record.amount);

  let subtotal: number;
  let tax: number;
  if (lines.length) {
    subtotal = lineSubtotal;
    tax = storedTaxAmount ?? (taxRate ? roundMoney((subtotal * taxRate) / 100) : 0);
  } else {
    tax = storedTaxAmount ?? (percentMatch ? 0 : parseAmount(taxRaw));
    if (percentMatch && taxRate) {
      subtotal = roundMoney(recordAmount / (1 + taxRate / 100));
      tax = roundMoney(recordAmount - subtotal);
    } else {
      subtotal = roundMoney(Math.max(0, recordAmount - tax));
    }
  }
  const total = recordAmount || roundMoney(subtotal + tax);

  const party = partyOf(record);
  const details = partyDetails(entityKey, party);
  const currency = record.currency || company.currency || settings.baseCurrencyCode || "UGX";

  const footerBits = [
    record.footerText || "",
    ...footersFor(formType).map((f) => `${f.name}\n${f.content}`),
  ].filter(Boolean);

  const extras: { label: string; value: string }[] = [];
  if (record.bankAccount) extras.push({ label: "Bank", value: record.bankAccount });
  if (record.accountNumber) extras.push({ label: "Account", value: record.accountNumber });
  if (record.basicPay)
    extras.push({ label: "Basic pay", value: formatAmount(parseAmount(record.basicPay), 0) });
  if (record.netPay)
    extras.push({ label: "Net pay", value: formatAmount(parseAmount(record.netPay), 0) });
  if (record.paye) extras.push({ label: "PAYE", value: formatAmount(parseAmount(record.paye), 0) });
  if (record.nssfEmployee || record.nssf)
    extras.push({
      label: "NSSF",
      value: formatAmount(parseAmount(record.nssfEmployee || record.nssf), 0),
    });

  return {
    title:
      record.customTitle ||
      ENTITY_DOCUMENT_TITLE[entityKey] ||
      entityLabel.replace(/s$/, "").toUpperCase(),
    formType,
    entityKey,
    reference: record.reference || record.code || record.id.slice(0, 8).toUpperCase(),
    referenceLabel: ENTITY_REFERENCE_LABEL[entityKey] || "DOCUMENT NO #",
    date: record.date || record.issueDate || "",
    dueDate: record.dueDate || "",
    validUntil:
      record.validUntil ||
      record.dueDate ||
      addDays(record.date || record.issueDate || "", terms.validityDays),
    party,
    partyLabel: /purchase|debit|goods/.test(entityKey) ? "SUPPLIER" : "CUSTOMER",
    partyAddressLines: details.addressLines,
    customerId: record.customerId || details.code,
    description: record.description || record.narration || "",
    status: record.status || "",
    currency,
    currencySymbol:
      currency === settings.baseCurrencyCode ? settings.baseCurrencySymbol || currency : currency,
    decimals: currencyDecimals(currency),
    taxRate,
    taxLabel: taxRaw || (taxRate ? `${taxRate}%` : ""),
    tax,
    subtotal,
    taxable: subtotal,
    other: record.otherCharges || "",
    total,
    footerText: footerBits.join("\n\n"),
    theme,
    templateId: template.id,
    accent:
      theme.primaryColor ||
      recommendedAccentForEntity(entityKey) ||
      template.accent,
    terms,
    businessName: company.businessName,
    legalName: company.legalName,
    businessAddressLines: company.addressLines,
    businessEmail: company.email,
    businessPhone: company.phone,
    businessWebsite: company.website,
    taxId: company.taxId,
    registrationNumber: company.registrationNumber,
    logoDataUrl: company.logoDataUrl,
    lines,
    extras,
  };
}

/* ------------------------------------------------------------------ *
 * Formatting helpers
 * ------------------------------------------------------------------ */

function formatAmount(value: number, decimals: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value || 0);
}

function amountOf(model: DocumentRenderModel, value: number) {
  return formatAmount(value, model.decimals);
}

function totalOf(model: DocumentRenderModel, value: number) {
  return `${model.currencySymbol}${formatAmount(value, model.decimals)}`;
}

function moneyWithCode(model: DocumentRenderModel, value: number) {
  return `${model.currency} ${formatAmount(value, model.decimals)}`;
}

function contactPhone(model: DocumentRenderModel) {
  return model.terms.contactPhone || model.businessPhone;
}

function contactEmail(model: DocumentRenderModel) {
  return model.terms.contactEmail || model.businessEmail;
}

function bankRows(model: DocumentRenderModel): [string, string][] {
  const t = model.terms;
  return (
    [
      ["Account Name", t.accountName],
      ["IBAN/Account Number", t.accountNumber],
      ["Beneficiary Bank Name", t.bankName],
      ["Bank Swift Code", t.swiftCode],
      ["Beneficiary Address", t.bankAddress],
      ["Currency", t.currency || model.currency],
    ] as [string, string][]
  ).filter(([, value]) => Boolean(value));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ *
 * HTML rendering (print + preview)
 * ------------------------------------------------------------------ */

function htmlShell(
  model: DocumentRenderModel,
  css: string,
  body: string,
  options?: { letterhead?: boolean },
) {
  const showLetterhead = options?.letterhead !== false;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(model.title)} ${escapeHtml(
    model.reference,
  )}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:${escapeHtml(
    model.theme.font || "Helvetica",
  )},Arial,Helvetica,sans-serif;color:#111827;margin:0;padding:14mm;font-size:11px;background:#fff}
  .num{text-align:right;white-space:nowrap}
  @page{size:A4;margin:0}
  .doc-lh{display:flex;align-items:flex-start;gap:14px;margin:0 0 16px;padding-bottom:12px;border-bottom:1px solid #e2e8f0}
  .doc-lh-logo{max-height:64px;max-width:160px;object-fit:contain;flex:0 0 auto}
  .doc-lh-text{min-width:0;flex:1}
  .doc-lh-name{font-size:16px;font-weight:800;color:#0f172a;line-height:1.25}
  .doc-lh-details{margin-top:4px;color:#475569;font-size:10px;line-height:1.5}
  .doc-lh-details div{margin:0}
  ${css}
</style></head><body>${showLetterhead ? documentLetterheadHtml(model) : ""}${body}</body></html>`;
}

function companyDetailLines(model: DocumentRenderModel): string[] {
  return [
    model.legalName && model.legalName !== model.businessName ? model.legalName : "",
    ...model.businessAddressLines,
    model.businessPhone ? `Phone: ${model.businessPhone}` : "",
    model.businessEmail ? `Email: ${model.businessEmail}` : "",
    model.businessWebsite ? `Website: ${model.businessWebsite}` : "",
    model.taxId ? `Tax ID: ${model.taxId}` : "",
    model.registrationNumber ? `Reg. No: ${model.registrationNumber}` : "",
  ].filter(Boolean);
}

function companyBlockHtml(model: DocumentRenderModel) {
  return companyDetailLines(model)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("");
}

/** Logo + company name + full contact block for printed documents. */
function documentLetterheadHtml(model: DocumentRenderModel) {
  const logo = model.logoDataUrl
    ? `<img class="doc-lh-logo" src="${model.logoDataUrl}" alt=""/>`
    : "";
  return `<header class="doc-lh">${logo}<div class="doc-lh-text"><div class="doc-lh-name">${escapeHtml(
    model.businessName,
  )}</div><div class="doc-lh-details">${companyBlockHtml(model)}</div></div></header>`;
}

function itemRowsHtml(model: DocumentRenderModel, minRows: number) {
  const rows = model.lines.length
    ? model.lines.map(
        (line) => `<tr>
      <td>${escapeHtml(line.description || line.item || "—")}</td>
      <td class="num">${amountOf(model, line.qty)}</td>
      <td style="text-align:center">${escapeHtml(line.unitLabel)}</td>
      <td class="num">${amountOf(model, line.unitCost)}</td>
      <td class="num">${amountOf(model, line.amount)}</td>
    </tr>`,
      )
    : [
        `<tr><td>${escapeHtml(
          model.description || model.title,
        )}</td><td class="num">1</td><td style="text-align:center">—</td><td class="num">${amountOf(
          model,
          model.subtotal,
        )}</td><td class="num">${amountOf(model, model.subtotal)}</td></tr>`,
      ];
  const filler = Math.max(0, minRows - rows.length);
  for (let i = 0; i < filler; i += 1) {
    rows.push('<tr class="filler"><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>');
  }
  return rows.join("");
}

function proFormaHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const terms = model.terms.terms.filter(Boolean);
  const banks = bankRows(model);
  const meta: [string, string][] = [
    ["DATE", model.date || "—"],
    [model.referenceLabel, model.reference],
    ["CUSTOMER ID", model.customerId || "—"],
    ["VALID UNTIL", model.validUntil || "—"],
  ];

  const css = `
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
  .logo{max-height:74px;max-width:190px;object-fit:contain}
  .doc-title{font-size:20px;font-weight:800;letter-spacing:.06em;color:${accent};text-align:right;margin-top:14px}
  .info{display:flex;justify-content:space-between;gap:20px;margin-top:10px}
  .addr div{line-height:1.55}
  .meta{border-collapse:collapse}
  .meta td{padding:2px 0}
  .meta .lbl{text-align:right;padding-right:8px;font-weight:600;letter-spacing:.02em}
  .meta .val{border:1px solid #94a3b8;padding:3px 10px;text-align:center;min-width:96px;font-weight:600}
  .bar{background:${accent};color:#fff;font-weight:700;letter-spacing:.03em;padding:4px 8px;display:inline-block;min-width:250px}
  .party{margin-top:22px}
  .party-body{padding:6px 2px;line-height:1.6}
  table.items{width:100%;border-collapse:collapse;margin-top:20px;border:1px solid #cbd5e1}
  table.items th{background:${accent};color:#fff;padding:5px 7px;font-size:11px;text-align:left;letter-spacing:.02em}
  table.items th.num,table.items td.num{text-align:right}
  table.items td{padding:4px 7px;border-top:1px solid #e2e8f0;border-left:1px solid #e2e8f0}
  table.items td:first-child{border-left:none}
  table.items tr:nth-child(even) td{background:#eef1f6}
  .bottom{display:flex;gap:16px;margin-top:14px;align-items:flex-start}
  .terms{flex:1 1 58%}
  .terms ol{margin:6px 0 8px;padding-left:20px;line-height:1.6}
  .bank{border-collapse:collapse;width:100%;font-weight:700}
  .bank td{padding:2px 0;vertical-align:top}
  .bank td:first-child{width:44%;padding-right:8px}
  .terms-box{border:1px solid #cbd5e1;border-top:none;padding:8px}
  .totals{flex:0 0 38%}
  .totals table{width:100%;border-collapse:collapse}
  .totals td{padding:3px 0}
  .totals td.num{text-align:right;border-bottom:1px solid #94a3b8;min-width:96px}
  .totals td.boxed{border:1px solid #94a3b8;text-align:right;padding:3px 6px}
  .totals tr.grand td{font-weight:800;font-size:12.5px;border-top:2px solid #0f172a;padding-top:5px}
  .totals tr.grand td.num{background:#dbe3f1;border-bottom:none}
  .foot{margin-top:26px;text-align:center;line-height:1.7}
  .foot a{color:#1d4ed8}
  .foot .thanks{font-weight:800;font-style:italic;font-size:12.5px;margin-top:2px}
  `;

  const body = `
  <div class="top">
    <div>
      ${model.logoDataUrl ? `<img class="logo" src="${model.logoDataUrl}" alt=""/>` : ""}
      <div style="font-size:17px;font-weight:800;margin-top:${model.logoDataUrl ? "6" : "0"}px">${escapeHtml(model.businessName)}</div>
    </div>
    <div class="doc-title">${escapeHtml(model.title)}</div>
  </div>
  <div class="info">
    <div class="addr">${companyBlockHtml(model)}</div>
    <table class="meta"><tbody>
      ${meta
        .map(
          ([label, value]) =>
            `<tr><td class="lbl">${escapeHtml(label)}</td><td class="val">${escapeHtml(
              value,
            )}</td></tr>`,
        )
        .join("")}
    </tbody></table>
  </div>

  <div class="party">
    <div class="bar">${escapeHtml(model.partyLabel)}</div>
    <div class="party-body">
      <div>${escapeHtml(model.party || "—")}</div>
      ${model.partyAddressLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
    </div>
  </div>

  <table class="items">
    <thead><tr>
      <th>DESCRIPTION</th><th class="num">QNTY</th>
      <th style="text-align:center">UNIT</th><th class="num">UNIT COST</th><th class="num">AMOUNT</th>
    </tr></thead>
    <tbody>${itemRowsHtml(model, 7)}</tbody>
  </table>

  <div class="bottom">
    <div class="terms">
      <div class="bar" style="min-width:100%">TERMS AND CONDITIONS</div>
      <div class="terms-box">
        ${terms.length ? `<ol>${terms.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>` : ""}
        ${
          banks.length
            ? `<table class="bank"><tbody>${banks
                .map(
                  ([label, value]) =>
                    `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`,
                )
                .join("")}</tbody></table>`
            : `<div style="color:#64748b;font-size:10px">Add bank details in Settings → Document templates.</div>`
        }
      </div>
    </div>
    <div class="totals">
      <table><tbody>
        <tr><td>Subtotal</td><td class="num">${amountOf(model, model.subtotal)}</td></tr>
        <tr><td>Taxable</td><td class="num">${amountOf(model, model.taxable)}</td></tr>
        <tr><td>Tax rate</td><td class="boxed">${
          model.taxRate ? `${model.taxRate}%` : escapeHtml(model.taxLabel || "—")
        }</td></tr>
        <tr><td>Tax due</td><td class="num">${amountOf(model, model.tax)}</td></tr>
        <tr><td style="padding-top:8px">Other</td><td class="boxed">${
          escapeHtml(model.other) || "-"
        }</td></tr>
        <tr class="grand"><td>TOTAL</td><td class="num">${totalOf(model, model.total)}</td></tr>
      </tbody></table>
    </div>
  </div>

  <div class="foot">
    ${
      contactPhone(model)
        ? `<div>If you have any questions about this ${escapeHtml(
            model.title.toLowerCase(),
          )}, please contact ${escapeHtml(contactPhone(model))}</div>`
        : ""
    }
    ${contactEmail(model) ? `<div><a href="mailto:${escapeHtml(contactEmail(model))}">${escapeHtml(contactEmail(model))}</a></div>` : ""}
    ${model.terms.closingNote ? `<div class="thanks">${escapeHtml(model.terms.closingNote)}</div>` : ""}
  </div>`;

  return htmlShell(model, css, body, { letterhead: false });
}

function classicHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .brand{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid ${accent};padding-bottom:14px}
  .logo{max-height:60px;max-width:170px;object-fit:contain}
  h1{margin:6px 0 0;font-size:20px;color:${accent}}
  .meta{color:#64748b;line-height:1.6}
  table.items{width:100%;border-collapse:collapse;margin-top:18px}
  table.items th{background:${accent};color:#fff;text-align:left;padding:7px;font-size:10.5px}
  table.items td{border-bottom:1px solid #e2e8f0;padding:7px;vertical-align:top}
  .totals{margin-top:14px;margin-left:auto;width:250px}
  .totals div{display:flex;justify-content:space-between;padding:3px 0}
  .totals .grand{font-weight:700;font-size:13px;border-top:1px solid #cbd5e1;margin-top:5px;padding-top:7px}
  .footer{margin-top:24px;white-space:pre-wrap;color:#475569;font-size:10px}
  `;
  const body = `
  <div class="brand">
    <div>
      ${model.logoDataUrl ? `<img class="logo" src="${model.logoDataUrl}" alt=""/>` : ""}
      <h1>${escapeHtml(model.businessName)}</h1>
      <div class="meta">${companyBlockHtml(model)}</div>
    </div>
    <div style="text-align:right">
      <h1>${escapeHtml(model.title)}</h1>
      <div class="meta">
        <div>${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}</div>
        <div>Date ${escapeHtml(model.date || "—")}</div>
        ${model.dueDate ? `<div>Due ${escapeHtml(model.dueDate)}</div>` : ""}
      </div>
    </div>
  </div>
  <p><strong>${escapeHtml(model.partyLabel)}:</strong> ${escapeHtml(model.party || "—")}${model.partyAddressLines
    .map((line) => `<br/><span class="meta">${escapeHtml(line)}</span>`)
    .join("")}</p>
  ${model.description ? `<p>${escapeHtml(model.description)}</p>` : ""}
  <table class="items">
    <thead><tr><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit cost</th><th class="num">Amount</th></tr></thead>
    <tbody>${itemRowsHtml(model, 0)}</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${moneyWithCode(model, model.subtotal)}</span></div>
    <div><span>Tax${model.taxRate ? ` (${model.taxRate}%)` : ""}</span><span>${moneyWithCode(model, model.tax)}</span></div>
    <div class="grand"><span>Total</span><span>${moneyWithCode(model, model.total)}</span></div>
  </div>
  ${
    model.extras.length
      ? `<div style="margin-top:14px">${model.extras
          .map((e) => `<div><strong>${escapeHtml(e.label)}:</strong> ${escapeHtml(e.value)}</div>`)
          .join("")}</div>`
      : ""
  }
  ${model.footerText ? `<div class="footer">${escapeHtml(model.footerText)}</div>` : ""}`;
  return htmlShell(model, css, body, { letterhead: false });
}

function modernHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .band{background:${accent};color:#fff;padding:16px 18px;border-radius:10px;display:flex;justify-content:space-between;align-items:center;gap:20px}
  .band h1{margin:0;font-size:19px;letter-spacing:.05em}
  .logo{max-height:52px;max-width:150px;object-fit:contain;background:#fff;border-radius:6px;padding:4px}
  .cards{display:flex;gap:12px;margin-top:14px}
  .card{flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;line-height:1.6}
  .card .k{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#64748b}
  table.items{width:100%;border-collapse:separate;border-spacing:0 4px;margin-top:14px}
  table.items th{text-align:left;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;padding:0 8px 4px}
  table.items td{background:#f8fafc;padding:8px;border-top:1px solid #eef2f7;border-bottom:1px solid #eef2f7}
  table.items td:first-child{border-left:1px solid #eef2f7;border-radius:8px 0 0 8px}
  table.items td:last-child{border-right:1px solid #eef2f7;border-radius:0 8px 8px 0}
  .wrap{display:flex;justify-content:flex-end;margin-top:12px}
  .sum{width:270px}
  .sum div{display:flex;justify-content:space-between;padding:4px 0}
  .badge{margin-top:6px;background:${accent};color:#fff;border-radius:8px;padding:9px 12px;font-weight:700;display:flex;justify-content:space-between}
  .footer{margin-top:22px;white-space:pre-wrap;color:#475569;font-size:10px}
  `;
  const body = `
  <div class="band">
    <div>
      <h1>${escapeHtml(model.title)}</h1>
      <div style="opacity:.85;margin-top:4px">${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}</div>
    </div>
    <div style="text-align:right">
      ${model.logoDataUrl ? `<img class="logo" src="${model.logoDataUrl}" alt=""/>` : ""}
      <div style="font-weight:700;margin-top:${model.logoDataUrl ? "6" : "0"}px">${escapeHtml(model.businessName)}</div>
    </div>
  </div>
  <div class="cards">
    <div class="card"><div class="k">From</div><div><strong>${escapeHtml(model.businessName)}</strong></div>${companyBlockHtml(model)}</div>
    <div class="card"><div class="k">${escapeHtml(model.partyLabel)}</div><div><strong>${escapeHtml(model.party || "—")}</strong></div>${model.partyAddressLines
      .map((line) => `<div>${escapeHtml(line)}</div>`)
      .join("")}</div>
    <div class="card"><div class="k">Details</div><div>Date ${escapeHtml(model.date || "—")}</div>${
      model.validUntil ? `<div>Valid until ${escapeHtml(model.validUntil)}</div>` : ""
    }${model.status ? `<div>Status ${escapeHtml(model.status)}</div>` : ""}</div>
  </div>
  <table class="items">
    <thead><tr><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit cost</th><th class="num">Amount</th></tr></thead>
    <tbody>${itemRowsHtml(model, 0)}</tbody>
  </table>
  <div class="wrap"><div class="sum">
    <div><span>Subtotal</span><span>${moneyWithCode(model, model.subtotal)}</span></div>
    <div><span>Tax${model.taxRate ? ` (${model.taxRate}%)` : ""}</span><span>${moneyWithCode(model, model.tax)}</span></div>
    <div class="badge"><span>Total</span><span>${totalOf(model, model.total)}</span></div>
  </div></div>
  ${model.footerText ? `<div class="footer">${escapeHtml(model.footerText)}</div>` : ""}`;
  return htmlShell(model, css, body, { letterhead: false });
}

function minimalHtml(model: DocumentRenderModel) {
  const css = `
  h1{margin:0;font-size:17px;letter-spacing:.12em;font-weight:600}
  .rule{border-top:1px solid #0f172a;margin:10px 0}
  .thin{border-top:1px solid #e2e8f0;margin:8px 0}
  .row{display:flex;justify-content:space-between;gap:18px;line-height:1.7}
  table.items{width:100%;border-collapse:collapse;margin-top:12px}
  table.items th{text-align:left;font-weight:600;padding:5px 0;border-bottom:1px solid #0f172a;font-size:10px;letter-spacing:.06em;text-transform:uppercase}
  table.items td{padding:5px 0;border-bottom:1px solid #f1f5f9}
  .totals{margin-top:12px;margin-left:auto;width:230px}
  .totals div{display:flex;justify-content:space-between;padding:3px 0}
  .totals .grand{font-weight:700;border-top:1px solid #0f172a;margin-top:4px;padding-top:6px}
  .footer{margin-top:20px;white-space:pre-wrap;color:#475569;font-size:10px}
  `;
  const body = `
  <div class="row">
    <div><h1>${escapeHtml(model.title)}</h1></div>
    <div style="text-align:right">
      <div>${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}</div>
      <div>${escapeHtml(model.date || "—")}</div>
    </div>
  </div>
  <div class="rule"></div>
  <div class="row">
    <div></div>
    <div style="text-align:right"><strong>${escapeHtml(model.partyLabel)}</strong><div>${escapeHtml(
      model.party || "—",
    )}</div>${model.partyAddressLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
  </div>
  <table class="items">
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Amount</th></tr></thead>
    <tbody>${
      model.lines.length
        ? model.lines
            .map(
              (line) =>
                `<tr><td>${escapeHtml(line.description || line.item || "—")}</td><td class="num">${amountOf(
                  model,
                  line.qty,
                )}</td><td class="num">${amountOf(model, line.unitCost)}</td><td class="num">${amountOf(
                  model,
                  line.amount,
                )}</td></tr>`,
            )
            .join("")
        : `<tr><td>${escapeHtml(model.description || "—")}</td><td class="num">1</td><td class="num">${amountOf(
            model,
            model.subtotal,
          )}</td><td class="num">${amountOf(model, model.subtotal)}</td></tr>`
    }</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${moneyWithCode(model, model.subtotal)}</span></div>
    <div><span>Tax${model.taxRate ? ` (${model.taxRate}%)` : ""}</span><span>${moneyWithCode(model, model.tax)}</span></div>
    <div class="grand"><span>Total</span><span>${moneyWithCode(model, model.total)}</span></div>
  </div>
  ${model.footerText ? `<div class="footer">${escapeHtml(model.footerText)}</div>` : ""}`;
  return htmlShell(model, css, body);
}

function signatureRowHtml(labels: string[]) {
  return `<div class="sigs">${labels
    .map(
      (label) =>
        `<div class="sig"><div class="line"></div><div class="lbl">${escapeHtml(label)}</div></div>`,
    )
    .join("")}</div>`;
}

function simpleItemsHtml(model: DocumentRenderModel, includeMoney: boolean) {
  if (!model.lines.length) {
    return `<tr><td>${escapeHtml(model.description || model.title)}</td><td class="num">1</td>${
      includeMoney
        ? `<td class="num">${amountOf(model, model.subtotal)}</td><td class="num">${amountOf(model, model.subtotal)}</td>`
        : `<td></td>`
    }</tr>`;
  }
  return model.lines
    .map((line) => {
      if (includeMoney) {
        return `<tr><td>${escapeHtml(line.description || line.item || "—")}</td><td class="num">${amountOf(
          model,
          line.qty,
        )}</td><td class="num">${amountOf(model, line.unitCost)}</td><td class="num">${amountOf(
          model,
          line.amount,
        )}</td></tr>`;
      }
      return `<tr><td>${escapeHtml(line.description || line.item || "—")}</td><td class="num">${amountOf(
        model,
        line.qty,
      )}</td><td>${escapeHtml(line.unitLabel)}</td></tr>`;
    })
    .join("");
}

function deliveryHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:4px solid ${accent};padding-bottom:12px}
  .logo{max-height:56px;max-width:150px;object-fit:contain}
  h1{margin:0;font-size:22px;letter-spacing:.14em;color:${accent}}
  .meta{margin-top:4px;color:#64748b;line-height:1.55}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}
  .box{border:1px dashed ${accent};padding:10px 12px;border-radius:4px;line-height:1.55;min-height:72px}
  .box .k{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:${accent};font-weight:700;margin-bottom:4px}
  table.items{width:100%;border-collapse:collapse;margin-top:18px}
  table.items th{background:${accent};color:#fff;padding:8px;text-align:left;font-size:10px;letter-spacing:.06em}
  table.items td{padding:8px;border-bottom:1px solid #e2e8f0}
  .note{margin-top:12px;color:#64748b;font-size:10px}
  .sigs{display:flex;gap:24px;margin-top:36px}
  .sig{flex:1}.sig .line{border-bottom:1px solid #0f172a;height:28px}.sig .lbl{margin-top:6px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
  `;
  const body = `
  <div class="head">
    <div>${model.logoDataUrl ? `<img class="logo" src="${model.logoDataUrl}" alt=""/>` : `<strong>${escapeHtml(model.businessName)}</strong>`}
      <div class="meta">${companyBlockHtml(model)}</div>
    </div>
    <div style="text-align:right"><h1>${escapeHtml(model.title)}</h1>
      <div class="meta">${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}<br/>Date ${escapeHtml(model.date || "—")}</div>
    </div>
  </div>
  <div class="grid">
    <div class="box"><div class="k">Deliver to</div><strong>${escapeHtml(model.party || "—")}</strong>${model.partyAddressLines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>
    <div class="box"><div class="k">Dispatch notes</div>${escapeHtml(model.description || "Handle with care. Check quantities on receipt.")}</div>
  </div>
  <table class="items"><thead><tr><th>Item / description</th><th class="num">Qty</th><th>Unit</th></tr></thead>
  <tbody>${
    model.lines.length
      ? model.lines
          .map(
            (line) =>
              `<tr><td>${escapeHtml(line.description || line.item || "—")}</td><td class="num">${amountOf(model, line.qty)}</td><td>${escapeHtml(line.unitLabel)}</td></tr>`,
          )
          .join("")
      : `<tr><td>${escapeHtml(model.description || "—")}</td><td class="num">1</td><td>—</td></tr>`
  }</tbody></table>
  <p class="note">This delivery note is not a tax invoice. Quantities confirmed below.</p>
  ${signatureRowHtml(["Delivered by", "Received by", "Date / stamp"])}`;
  return htmlShell(model, css, body, { letterhead: false });
}

function orderHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .auth{background:${accent};color:#fff;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;letter-spacing:.04em;font-weight:700}
  .top{display:flex;justify-content:space-between;gap:20px;margin-top:14px}
  .logo{max-height:52px;max-width:140px;object-fit:contain}
  h1{margin:0;font-size:20px;color:${accent}}
  .panel{border:1px solid #d6d3d1;padding:10px;flex:1;line-height:1.55}
  .panel .k{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#78716c;margin-bottom:4px}
  .panels{display:flex;gap:12px;margin-top:14px}
  table.items{width:100%;border-collapse:collapse;margin-top:16px}
  table.items th{border-bottom:2px solid ${accent};text-align:left;padding:7px 6px;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
  table.items td{padding:7px 6px;border-bottom:1px solid #e7e5e4}
  .totals{margin-left:auto;width:240px;margin-top:12px}
  .totals div{display:flex;justify-content:space-between;padding:3px 0}
  .totals .grand{font-weight:700;border-top:2px solid ${accent};margin-top:4px;padding-top:6px}
  .sigs{display:flex;gap:24px;margin-top:28px}
  .sig{flex:1}.sig .line{border-bottom:1px solid #0f172a;height:26px}.sig .lbl{margin-top:6px;font-size:10px;color:#78716c;text-transform:uppercase;letter-spacing:.06em}
  `;
  const body = `
  <div class="auth"><span>AUTHORISED ORDER</span><span>${escapeHtml(model.status || "Draft")}</span></div>
  <div class="top">
    <div>${model.logoDataUrl ? `<img class="logo" src="${model.logoDataUrl}" alt=""/>` : ""}<h1>${escapeHtml(model.businessName)}</h1><div style="color:#78716c;line-height:1.5">${companyBlockHtml(model)}</div></div>
    <div style="text-align:right"><h1>${escapeHtml(model.title)}</h1>
      <div>${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}</div>
      <div>Date ${escapeHtml(model.date || "—")}</div>
      ${model.validUntil ? `<div>Required by ${escapeHtml(model.validUntil)}</div>` : ""}
    </div>
  </div>
  <div class="panels">
    <div class="panel"><div class="k">${escapeHtml(model.partyLabel)}</div><strong>${escapeHtml(model.party || "—")}</strong>${model.partyAddressLines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>
    <div class="panel"><div class="k">Order notes</div>${escapeHtml(model.description || "Supply against this authorised order only.")}</div>
  </div>
  <table class="items"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Amount</th></tr></thead>
  <tbody>${simpleItemsHtml(model, true)}</tbody></table>
  <div class="totals">
    <div><span>Subtotal</span><span>${moneyWithCode(model, model.subtotal)}</span></div>
    <div><span>Tax</span><span>${moneyWithCode(model, model.tax)}</span></div>
    <div class="grand"><span>Order total</span><span>${moneyWithCode(model, model.total)}</span></div>
  </div>
  ${signatureRowHtml(["Prepared by", "Approved by", "Supplier acknowledgement"])}`;
  return htmlShell(model, css, body, { letterhead: false });
}

function creditHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .banner{background:${accent};color:#fff;padding:14px 16px;display:flex;justify-content:space-between;align-items:center}
  .banner h1{margin:0;font-size:20px;letter-spacing:.08em}
  .reason{margin-top:14px;border-left:4px solid ${accent};padding:8px 12px;background:#fff1f2;line-height:1.55}
  .meta{display:flex;justify-content:space-between;gap:16px;margin-top:14px;line-height:1.6}
  table.items{width:100%;border-collapse:collapse;margin-top:16px}
  table.items th{background:#fff1f2;color:${accent};text-align:left;padding:7px;border-bottom:2px solid ${accent}}
  table.items td{padding:7px;border-bottom:1px solid #fecdd3}
  .credit-total{margin-top:16px;text-align:right;font-size:18px;font-weight:800;color:${accent}}
  .footer{margin-top:20px;color:#64748b;font-size:10px;white-space:pre-wrap}
  `;
  const body = `
  <div class="banner">
    <div><h1>${escapeHtml(model.title)}</h1></div>
    <div style="text-align:right">${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}<br/>Date ${escapeHtml(model.date || "—")}</div>
  </div>
  <div class="meta">
    <div><strong>${escapeHtml(model.partyLabel)}:</strong> ${escapeHtml(model.party || "—")}${model.partyAddressLines.map((l) => `<br/>${escapeHtml(l)}`).join("")}</div>
    <div style="text-align:right">${model.customerId ? `ID ${escapeHtml(model.customerId)}<br/>` : ""}${model.status ? `Status ${escapeHtml(model.status)}` : ""}</div>
  </div>
  <div class="reason"><strong>Reason / narration</strong><div>${escapeHtml(model.description || "Adjustment to previous billing.")}</div></div>
  <table class="items"><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
  <tbody>${
    model.lines.length
      ? model.lines
          .map(
            (line) =>
              `<tr><td>${escapeHtml(line.description || line.item || "—")}</td><td class="num">${amountOf(model, line.qty)}</td><td class="num">${amountOf(model, line.unitCost)}</td><td class="num">${amountOf(model, line.amount)}</td></tr>`,
          )
          .join("")
      : `<tr><td>${escapeHtml(model.description || "—")}</td><td class="num">1</td><td class="num">${amountOf(model, model.subtotal)}</td><td class="num">${amountOf(model, model.subtotal)}</td></tr>`
  }</tbody></table>
  <div class="credit-total">Credit / adjustment ${totalOf(model, model.total)}</div>
  ${model.footerText ? `<div class="footer">${escapeHtml(model.footerText)}</div>` : ""}`;
  return htmlShell(model, css, body);
}

function receiptHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .voucher{max-width:520px;margin:0 auto;border:2px solid ${accent};padding:22px 24px;text-align:center;position:relative}
  .stamp{position:absolute;top:18px;right:18px;border:3px solid ${accent};color:${accent};font-weight:800;letter-spacing:.12em;padding:6px 10px;transform:rotate(-12deg);opacity:.85;font-size:13px}
  h1{margin:8px 0 4px;font-size:22px;letter-spacing:.16em;color:${accent}}
  .amt{font-size:28px;font-weight:800;margin:18px 0 8px;color:#14532d}
  .meta{line-height:1.7;color:#334155;margin-top:12px;text-align:left}
  .rule{border-top:1px dashed #86efac;margin:16px 0}
  .sigs{display:flex;gap:20px;margin-top:22px;text-align:left}
  .sig{flex:1}.sig .line{border-bottom:1px solid #0f172a;height:24px}.sig .lbl{margin-top:6px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
  `;
  const body = `
  <div class="voucher">
    <div class="stamp">PAID</div>
    <h1>${escapeHtml(model.title)}</h1>
    <div>${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}</div>
    <div class="amt">${totalOf(model, model.total)}</div>
    <div>Received with thanks from</div>
    <div style="font-size:15px;font-weight:700;margin-top:4px">${escapeHtml(model.party || "—")}</div>
    <div class="rule"></div>
    <div class="meta">
      <div><strong>Date:</strong> ${escapeHtml(model.date || "—")}</div>
      <div><strong>Being:</strong> ${escapeHtml(model.description || model.title)}</div>
      ${model.extras.map((e) => `<div><strong>${escapeHtml(e.label)}:</strong> ${escapeHtml(e.value)}</div>`).join("")}
    </div>
    ${signatureRowHtml(["Cashier", "Payer"])}
  </div>`;
  return htmlShell(model, css, body);
}

function paymentHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .top{display:flex;justify-content:space-between;border-bottom:2px solid ${accent};padding-bottom:12px}
  h1{margin:0;font-size:20px;color:${accent};letter-spacing:.06em}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
  .card{background:#ecfeff;border:1px solid #a5f3fc;padding:10px 12px;line-height:1.55}
  .card .k{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:${accent};font-weight:700}
  table.items{width:100%;border-collapse:collapse;margin-top:16px}
  table.items th{background:${accent};color:#fff;text-align:left;padding:7px;font-size:10px}
  table.items td{padding:7px;border-bottom:1px solid #e2e8f0}
  .pay{margin-top:14px;background:${accent};color:#fff;padding:12px 14px;display:flex;justify-content:space-between;font-weight:700;font-size:14px}
  `;
  const body = `
  <div class="top">
    <div></div>
    <div style="text-align:right"><h1>${escapeHtml(model.title)}</h1><div>${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}</div><div>Date ${escapeHtml(model.date || "—")}</div></div>
  </div>
  <div class="cols">
    <div class="card"><div class="k">Pay to</div><strong>${escapeHtml(model.party || "—")}</strong>${model.partyAddressLines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>
    <div class="card"><div class="k">Payment details</div>${escapeHtml(model.description || "Settlement of account")}${model.extras.map((e) => `<div>${escapeHtml(e.label)}: ${escapeHtml(e.value)}</div>`).join("")}</div>
  </div>
  <table class="items"><thead><tr><th>Description / invoice ref</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead>
  <tbody>${
    model.lines.length
      ? model.lines
          .map(
            (line) =>
              `<tr><td>${escapeHtml(line.description || line.item || "—")}</td><td class="num">${amountOf(model, line.qty)}</td><td class="num">${amountOf(model, line.amount)}</td></tr>`,
          )
          .join("")
      : `<tr><td>${escapeHtml(model.description || "—")}</td><td class="num">1</td><td class="num">${amountOf(model, model.total)}</td></tr>`
  }</tbody></table>
  <div class="pay"><span>Amount paid</span><span>${totalOf(model, model.total)}</span></div>`;
  return htmlShell(model, css, body);
}

function payslipHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .head{background:${accent};color:#fff;padding:14px 16px;display:flex;justify-content:space-between}
  h1{margin:0;font-size:18px;letter-spacing:.1em}
  .emp{margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .box{border:1px solid #c7d2fe;padding:10px;line-height:1.55}
  .box .k{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:${accent};font-weight:700}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:6px;background:#eef2ff;color:${accent};font-size:10px;text-transform:uppercase}
  td{padding:6px;border-bottom:1px solid #e2e8f0}
  .net{margin-top:16px;background:${accent};color:#fff;padding:12px 14px;display:flex;justify-content:space-between;font-size:15px;font-weight:700}
  `;
  const earnings = model.extras.filter((e) => /basic|earn|gross|allow/i.test(e.label));
  const deductions = model.extras.filter((e) => /paye|nssf|deduct|tax|loan/i.test(e.label));
  const other = model.extras.filter((e) => !earnings.includes(e) && !deductions.includes(e));
  const body = `
  <div class="head"><div><h1>${escapeHtml(model.title)}</h1></div>
    <div style="text-align:right">${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}<br/>${escapeHtml(model.date || "—")}</div></div>
  <div class="emp">
    <div class="box"><div class="k">Employee</div><strong>${escapeHtml(model.party || "—")}</strong>${model.partyAddressLines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>
    <div class="box"><div class="k">Pay period</div><div>${escapeHtml(model.description || model.date || "—")}</div>${other.map((e) => `<div>${escapeHtml(e.label)}: ${escapeHtml(e.value)}</div>`).join("")}</div>
  </div>
  <div class="cols">
    <table><thead><tr><th>Earnings</th><th class="num">Amount</th></tr></thead><tbody>
      ${(earnings.length ? earnings : [{ label: "Gross / basic", value: amountOf(model, model.subtotal) }]).map((e) => `<tr><td>${escapeHtml(e.label)}</td><td class="num">${escapeHtml(e.value)}</td></tr>`).join("")}
    </tbody></table>
    <table><thead><tr><th>Deductions</th><th class="num">Amount</th></tr></thead><tbody>
      ${(deductions.length ? deductions : [{ label: "Tax / statutory", value: amountOf(model, model.tax) }]).map((e) => `<tr><td>${escapeHtml(e.label)}</td><td class="num">${escapeHtml(e.value)}</td></tr>`).join("")}
    </tbody></table>
  </div>
  <div class="net"><span>Net pay</span><span>${totalOf(model, model.total)}</span></div>`;
  return htmlShell(model, css, body);
}

function journalHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .top{display:flex;justify-content:space-between;border-bottom:1px solid ${accent};padding-bottom:10px}
  h1{margin:0;font-size:18px;letter-spacing:.12em}
  .narr{margin-top:12px;padding:8px 10px;background:#f5f5f4;border:1px solid #d6d3d1;line-height:1.55}
  table.jv{width:100%;border-collapse:collapse;margin-top:14px}
  table.jv th{border-bottom:2px solid ${accent};text-align:left;padding:7px 6px;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
  table.jv td{padding:7px 6px;border-bottom:1px solid #e7e5e4}
  .bal{margin-top:10px;text-align:right;font-weight:700}
  .sigs{display:flex;gap:24px;margin-top:30px}
  .sig{flex:1}.sig .line{border-bottom:1px solid #0f172a;height:24px}.sig .lbl{margin-top:6px;font-size:10px;color:#78716c;text-transform:uppercase;letter-spacing:.06em}
  `;
  const rows = model.lines.length
    ? model.lines.map((line, i) => {
        const debit = i % 2 === 0 ? amountOf(model, line.amount) : "";
        const credit = i % 2 === 1 ? amountOf(model, line.amount) : "";
        return `<tr><td>${escapeHtml(line.description || line.item || "—")}</td><td class="num">${debit}</td><td class="num">${credit}</td></tr>`;
      })
    : [
        `<tr><td>${escapeHtml(model.description || model.title)} (Dr)</td><td class="num">${amountOf(model, model.total)}</td><td class="num"></td></tr>`,
        `<tr><td>Balancing credit</td><td class="num"></td><td class="num">${amountOf(model, model.total)}</td></tr>`,
      ];
  const body = `
  <div class="top">
    <div></div>
    <div style="text-align:right"><h1>${escapeHtml(model.title)}</h1><div>${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}</div><div>${escapeHtml(model.date || "—")}</div></div>
  </div>
  <div class="narr"><strong>Narration:</strong> ${escapeHtml(model.description || "Manual journal voucher")}</div>
  <table class="jv"><thead><tr><th>Account / description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
  <tbody>${rows.join("")}</tbody></table>
  <div class="bal">Totals balance · ${moneyWithCode(model, model.total)}</div>
  ${signatureRowHtml(["Prepared", "Reviewed", "Posted"])}`;
  return htmlShell(model, css, body);
}

function goodsHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid ${accent};padding-bottom:10px}
  h1{margin:0;font-size:20px;color:${accent};letter-spacing:.08em}
  .checks{display:flex;gap:18px;margin-top:12px;font-size:11px}
  .checks span{display:inline-flex;align-items:center;gap:6px}
  .checks i{display:inline-block;width:14px;height:14px;border:1.5px solid ${accent}}
  table.items{width:100%;border-collapse:collapse;margin-top:14px}
  table.items th{background:${accent};color:#fff;padding:7px;text-align:left;font-size:10px}
  table.items td{padding:7px;border:1px solid #d9f99d}
  .sigs{display:flex;gap:24px;margin-top:28px}
  .sig{flex:1}.sig .line{border-bottom:1px solid #0f172a;height:24px}.sig .lbl{margin-top:6px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
  `;
  const body = `
  <div class="head">
    <div></div>
    <div style="text-align:right"><h1>${escapeHtml(model.title)}</h1><div>${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}</div><div>Date ${escapeHtml(model.date || "—")}</div></div>
  </div>
  <p><strong>Supplier / source:</strong> ${escapeHtml(model.party || "—")}</p>
  <div class="checks"><span><i></i> Inspected</span><span><i></i> Accepted</span><span><i></i> Partial delivery</span></div>
  <table class="items"><thead><tr><th>Item</th><th class="num">Ordered / expected</th><th class="num">Received</th><th>Unit</th></tr></thead>
  <tbody>${
    model.lines.length
      ? model.lines
          .map(
            (line) =>
              `<tr><td>${escapeHtml(line.description || line.item || "—")}</td><td class="num">${amountOf(model, line.qty)}</td><td class="num">${amountOf(model, line.qty)}</td><td>${escapeHtml(line.unitLabel)}</td></tr>`,
          )
          .join("")
      : `<tr><td>${escapeHtml(model.description || "—")}</td><td class="num">1</td><td class="num">1</td><td>—</td></tr>`
  }</tbody></table>
  ${signatureRowHtml(["Received by", "Stores", "Accounts"])}`;
  return htmlShell(model, css, body);
}

function claimHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .banner{border:2px solid ${accent};padding:12px 14px;display:flex;justify-content:space-between}
  h1{margin:0;font-size:18px;color:${accent};letter-spacing:.08em}
  .who{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .who div{background:#faf5ff;border:1px solid #e9d5ff;padding:8px 10px;line-height:1.5}
  table.items{width:100%;border-collapse:collapse;margin-top:14px}
  table.items th{background:${accent};color:#fff;padding:7px;text-align:left;font-size:10px}
  table.items td{padding:7px;border-bottom:1px solid #e9d5ff}
  .tot{margin-top:12px;text-align:right;font-size:14px;font-weight:700;color:${accent}}
  .sigs{display:flex;gap:20px;margin-top:28px}
  .sig{flex:1}.sig .line{border-bottom:1px solid #0f172a;height:24px}.sig .lbl{margin-top:6px;font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
  `;
  const body = `
  <div class="banner"><div><h1>${escapeHtml(model.title)}</h1></div>
    <div style="text-align:right">${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}<br/>${escapeHtml(model.date || "—")}</div></div>
  <div class="who">
    <div><strong>Claimant</strong><div>${escapeHtml(model.party || "—")}</div></div>
    <div><strong>Purpose</strong><div>${escapeHtml(model.description || "Staff reimbursement")}</div></div>
  </div>
  <table class="items"><thead><tr><th>Expense description</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead>
  <tbody>${
    model.lines.length
      ? model.lines
          .map(
            (line) =>
              `<tr><td>${escapeHtml(line.description || line.item || "—")}</td><td class="num">${amountOf(model, line.qty)}</td><td class="num">${amountOf(model, line.amount)}</td></tr>`,
          )
          .join("")
      : `<tr><td>${escapeHtml(model.description || "—")}</td><td class="num">1</td><td class="num">${amountOf(model, model.total)}</td></tr>`
  }</tbody></table>
  <div class="tot">Claim total ${totalOf(model, model.total)}</div>
  ${signatureRowHtml(["Claimant", "Approved", "Paid"])}`;
  return htmlShell(model, css, body);
}

function certificateHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .frame{border:3px double ${accent};padding:28px 26px;text-align:center}
  .inner{border:1px solid ${accent};padding:22px 20px}
  h1{margin:8px 0 4px;font-size:20px;letter-spacing:.18em;color:${accent}}
  .sub{color:#78716c;letter-spacing:.08em;text-transform:uppercase;font-size:10px}
  .amt{font-size:24px;font-weight:800;margin:18px 0;color:#713f12}
  .body{text-align:left;line-height:1.7;margin-top:12px}
  .sigs{display:flex;gap:28px;margin-top:28px;text-align:left}
  .sig{flex:1}.sig .line{border-bottom:1px solid #0f172a;height:26px}.sig .lbl{margin-top:6px;font-size:10px;color:#78716c;text-transform:uppercase;letter-spacing:.06em}
  `;
  const body = `
  <div class="frame"><div class="inner">
    <h1>${escapeHtml(model.title)}</h1>
    <div>${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)} · ${escapeHtml(model.date || "—")}</div>
    <div class="amt">${totalOf(model, model.total)}</div>
    <div class="body">
      This certifies that tax / contractual amounts relating to
      <strong>${escapeHtml(model.party || "—")}</strong>
      ${model.description ? ` for <em>${escapeHtml(model.description)}</em>` : ""}
      have been recorded as shown above.
      ${model.taxRate ? `<div style="margin-top:8px">Tax rate applied: ${model.taxRate}%</div>` : ""}
      ${model.tax ? `<div>Tax amount: ${moneyWithCode(model, model.tax)}</div>` : ""}
    </div>
    ${signatureRowHtml(["Authorised signatory", "Official stamp"])}
  </div></div>`;
  return htmlShell(model, css, body);
}

function transferHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .head{display:flex;justify-content:space-between;padding-bottom:10px;border-bottom:2px solid ${accent}}
  h1{margin:0;font-size:18px;color:${accent};letter-spacing:.08em}
  .flow{display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:stretch;margin-top:18px}
  .panel{border:1px solid #bae6fd;background:#f0f9ff;padding:12px;line-height:1.55;min-height:90px}
  .panel .k{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:${accent};font-weight:700}
  .arrow{display:flex;align-items:center;font-size:28px;color:${accent};font-weight:700}
  .amt{margin-top:16px;text-align:center;font-size:20px;font-weight:800;color:${accent}}
  table.items{width:100%;border-collapse:collapse;margin-top:14px}
  table.items th{text-align:left;padding:6px;border-bottom:2px solid ${accent};font-size:10px;text-transform:uppercase}
  table.items td{padding:6px;border-bottom:1px solid #e0f2fe}
  `;
  const fromLabel = model.extras.find((e) => /from|source|bank/i.test(e.label))?.value || model.businessName;
  const toLabel = model.party || model.extras.find((e) => /to|dest/i.test(e.label))?.value || "Destination";
  const body = `
  <div class="head">
    <div></div>
    <div style="text-align:right"><h1>${escapeHtml(model.title)}</h1><div>${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}</div><div>${escapeHtml(model.date || "—")}</div></div>
  </div>
  <div class="flow">
    <div class="panel"><div class="k">From</div><strong>${escapeHtml(fromLabel)}</strong></div>
    <div class="arrow">→</div>
    <div class="panel"><div class="k">To</div><strong>${escapeHtml(toLabel)}</strong>${model.partyAddressLines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>
  </div>
  <div class="amt">${totalOf(model, model.total)}</div>
  <p style="text-align:center;color:#64748b">${escapeHtml(model.description || "Internal transfer")}</p>
  ${
    model.lines.length
      ? `<table class="items"><thead><tr><th>Detail</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead><tbody>${model.lines
          .map(
            (line) =>
              `<tr><td>${escapeHtml(line.description || line.item || "—")}</td><td class="num">${amountOf(model, line.qty)}</td><td class="num">${amountOf(model, line.amount)}</td></tr>`,
          )
          .join("")}</tbody></table>`
      : ""
  }`;
  return htmlShell(model, css, body);
}

function reconHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .head{display:flex;justify-content:space-between;border-bottom:2px solid ${accent};padding-bottom:10px}
  h1{margin:0;font-size:18px;color:${accent}}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
  .col{border:1px solid #99f6e4;padding:10px}
  .col h2{margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${accent}}
  .row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dotted #ccfbf1}
  .ok{margin-top:16px;padding:10px 12px;background:#ccfbf1;border:1px solid ${accent};font-weight:700;text-align:center;color:#115e59}
  `;
  const body = `
  <div class="head">
    <div></div>
    <div style="text-align:right"><h1>${escapeHtml(model.title)}</h1><div>${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}</div><div>${escapeHtml(model.date || "—")}</div></div>
  </div>
  <p><strong>Account:</strong> ${escapeHtml(model.party || model.description || "Bank account")}</p>
  <div class="cols">
    <div class="col"><h2>Bank statement</h2>
      <div class="row"><span>Statement balance</span><span>${moneyWithCode(model, model.total)}</span></div>
      <div class="row"><span>Outstanding deposits</span><span>—</span></div>
      <div class="row"><span>Outstanding cheques</span><span>—</span></div>
    </div>
    <div class="col"><h2>Books</h2>
      <div class="row"><span>Ledger balance</span><span>${moneyWithCode(model, model.subtotal || model.total)}</span></div>
      <div class="row"><span>Unpresented items</span><span>${moneyWithCode(model, model.tax)}</span></div>
      <div class="row"><span>Adjusted balance</span><span>${moneyWithCode(model, model.total)}</span></div>
    </div>
  </div>
  <div class="ok">Reconciled · differences explained above</div>
  ${model.description ? `<p style="margin-top:12px;color:#64748b">${escapeHtml(model.description)}</p>` : ""}`;
  return htmlShell(model, css, body);
}

function assetHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .card{border:1px solid #ddd6fe;border-radius:12px;overflow:hidden}
  .card-h{background:${accent};color:#fff;padding:14px 16px;display:flex;justify-content:space-between}
  h1{margin:0;font-size:18px;letter-spacing:.06em}
  .body{padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .field{background:#f5f3ff;border-radius:8px;padding:10px;line-height:1.5}
  .field .k{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:${accent};font-weight:700}
  .value{grid-column:1/-1;background:${accent};color:#fff;border-radius:8px;padding:12px 14px;display:flex;justify-content:space-between;font-weight:700;font-size:14px}
  `;
  const body = `
  <div class="card">
    <div class="card-h"><div><h1>${escapeHtml(model.title)}</h1></div>
      <div style="text-align:right">${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}<br/>${escapeHtml(model.date || "—")}</div></div>
    <div class="body">
      <div class="field"><div class="k">Asset / party</div><strong>${escapeHtml(model.party || model.description || "—")}</strong></div>
      <div class="field"><div class="k">Status</div>${escapeHtml(model.status || "Active")}</div>
      <div class="field"><div class="k">Description</div>${escapeHtml(model.description || "—")}</div>
      <div class="field"><div class="k">Tax / charge</div>${moneyWithCode(model, model.tax)}</div>
      ${model.extras.map((e) => `<div class="field"><div class="k">${escapeHtml(e.label)}</div>${escapeHtml(e.value)}</div>`).join("")}
      <div class="value"><span>Carrying / recorded amount</span><span>${totalOf(model, model.total)}</span></div>
    </div>
  </div>`;
  return htmlShell(model, css, body);
}

function warehouseHtml(model: DocumentRenderModel) {
  const accent = model.accent;
  const css = `
  .slip{border:1px solid ${accent};padding:14px}
  .top{display:flex;justify-content:space-between;align-items:center;background:${accent};color:#fff;margin:-14px -14px 14px;padding:10px 14px}
  h1{margin:0;font-size:16px;letter-spacing:.1em}
  table.items{width:100%;border-collapse:collapse}
  table.items th{text-align:left;padding:6px;border-bottom:2px solid ${accent};font-size:10px;text-transform:uppercase}
  table.items td{padding:6px;border-bottom:1px solid #fed7aa}
  .foot{display:flex;justify-content:space-between;margin-top:16px;font-size:11px;color:#9a3412}
  .sigs{display:flex;gap:20px;margin-top:22px}
  .sig{flex:1}.sig .line{border-bottom:1px solid #0f172a;height:22px}.sig .lbl{margin-top:6px;font-size:10px;color:#78716c;text-transform:uppercase;letter-spacing:.06em}
  `;
  const body = `
  <div class="slip">
    <div class="top"><h1>${escapeHtml(model.title)}</h1><div>${escapeHtml(model.referenceLabel)} ${escapeHtml(model.reference)}</div></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:10px;line-height:1.5">
      <div></div>
      <div style="text-align:right">Date ${escapeHtml(model.date || "—")}<br/>${escapeHtml(model.party || model.description || "")}</div>
    </div>
    <table class="items"><thead><tr><th>SKU / description</th><th class="num">Qty</th><th>Unit</th><th class="num">Value</th></tr></thead>
    <tbody>${
      model.lines.length
        ? model.lines
            .map(
              (line) =>
                `<tr><td>${escapeHtml(line.description || line.item || "—")}</td><td class="num">${amountOf(model, line.qty)}</td><td>${escapeHtml(line.unitLabel)}</td><td class="num">${amountOf(model, line.amount)}</td></tr>`,
            )
            .join("")
        : `<tr><td>${escapeHtml(model.description || "—")}</td><td class="num">1</td><td>—</td><td class="num">${amountOf(model, model.total)}</td></tr>`
    }</tbody></table>
    <div class="foot"><span>${escapeHtml(model.description || "Warehouse movement")}</span><span>Total ${totalOf(model, model.total)}</span></div>
    ${signatureRowHtml(["Storekeeper", "Supervisor"])}
  </div>`;
  return htmlShell(model, css, body);
}

export function documentHtml(model: DocumentRenderModel) {
  switch (model.templateId) {
    case "classic":
      return classicHtml(model);
    case "modern":
      return modernHtml(model);
    case "minimal":
      return minimalHtml(model);
    case "delivery":
      return deliveryHtml(model);
    case "order":
      return orderHtml(model);
    case "credit":
      return creditHtml(model);
    case "receipt":
      return receiptHtml(model);
    case "payment":
      return paymentHtml(model);
    case "payslip":
      return payslipHtml(model);
    case "journal":
      return journalHtml(model);
    case "goods":
      return goodsHtml(model);
    case "claim":
      return claimHtml(model);
    case "certificate":
      return certificateHtml(model);
    case "transfer":
      return transferHtml(model);
    case "recon":
      return reconHtml(model);
    case "asset":
      return assetHtml(model);
    case "warehouse":
      return warehouseHtml(model);
    case "pro-forma":
    default:
      return proFormaHtml(model);
  }
}

export function printDocument(
  entityKey: string,
  entityLabel: string,
  record: ManagerRecord,
  options?: { templateId?: DocumentTemplateId },
) {
  const model = buildDocumentModel(entityKey, entityLabel, record, options);
  const html = documentHtml(model);

  // Prefer a same-page iframe so browsers that block pop-ups still print.
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Print document");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDocument = iframe.contentDocument || frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    throw new Error("Could not prepare the print view in this browser.");
  }

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 500);
  };

  const triggerPrint = () => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } finally {
      cleanup();
    }
  };

  // Wait a tick for images/styles to settle before printing.
  window.setTimeout(triggerPrint, 350);
}

/* ------------------------------------------------------------------ *
 * PDF rendering
 * ------------------------------------------------------------------ */

type Pdf = import("jspdf").jsPDF;

const MARGIN = 14;
const RIGHT = 196;
const CONTENT = RIGHT - MARGIN;

function addLogo(doc: Pdf, model: DocumentRenderModel, x: number, y: number, w: number, h: number) {
  if (!model.logoDataUrl) return false;
  try {
    const format = /image\/jpe?g/i.test(model.logoDataUrl) ? "JPEG" : "PNG";
    doc.addImage(model.logoDataUrl, format, x, y, w, h);
    return true;
  } catch {
    return false;
  }
}

function drawProFormaPdf(doc: Pdf, model: DocumentRenderModel) {
  const accent = hexToRgb(model.accent);
  const hasLogo = addLogo(doc, model, MARGIN, 12, 32, 20);
  const nameX = hasLogo ? MARGIN + 36 : MARGIN;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(model.businessName, nameX, hasLogo ? 18 : 22);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text(model.title, RIGHT, 26, { align: "right" });

  // Company address block
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(31, 41, 55);
  let y = hasLogo ? 36 : 40;
  const companyLines = companyDetailLines(model);
  for (const line of companyLines) {
    doc.text(line, MARGIN, y);
    y += 4.4;
  }

  // Boxed meta panel
  const meta: [string, string][] = [
    ["DATE", model.date || "—"],
    [model.referenceLabel, model.reference],
    ["CUSTOMER ID", model.customerId || "—"],
    ["VALID UNTIL", model.validUntil || "—"],
  ];
  const boxW = 32;
  const boxX = RIGHT - boxW;
  let metaY = 38;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  for (const [label, value] of meta) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(31, 41, 55);
    doc.text(label, boxX - 3, metaY + 4, { align: "right" });
    doc.rect(boxX, metaY, boxW, 6);
    doc.setFont("helvetica", "bold");
    doc.text(String(value), boxX + boxW / 2, metaY + 4.2, { align: "center" });
    metaY += 7.5;
  }

  // Party bar
  y = Math.max(y, metaY) + 6;
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(MARGIN, y, 88, 6.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(model.partyLabel, MARGIN + 2.5, y + 4.6);
  y += 11;
  doc.setTextColor(31, 41, 55);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(model.party || "—", MARGIN, y);
  y += 4.4;
  for (const line of model.partyAddressLines.slice(0, 3)) {
    doc.text(line, MARGIN, y);
    y += 4.4;
  }

  // Items table
  y += 5;
  const cols = [
    { w: 90, align: "left" as const },
    { w: 16, align: "right" as const },
    { w: 14, align: "center" as const },
    { w: 28, align: "right" as const },
    { w: 34, align: "right" as const },
  ];
  const headers = ["DESCRIPTION", "QNTY", "UNIT", "UNIT COST", "AMOUNT"];
  const rowH = 6.4;
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(MARGIN, y, CONTENT, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  let cx = MARGIN;
  headers.forEach((header, i) => {
    const col = cols[i];
    const tx = col.align === "right" ? cx + col.w - 2.5 : col.align === "center" ? cx + col.w / 2 : cx + 2.5;
    doc.text(header, tx, y + 4.8, { align: col.align === "left" ? "left" : col.align });
    cx += col.w;
  });
  y += 7;

  const dataRows: string[][] = model.lines.length
    ? model.lines.map((line) => [
        line.description || line.item || "—",
        amountOf(model, line.qty),
        line.unitLabel,
        amountOf(model, line.unitCost),
        amountOf(model, line.amount),
      ])
    : [
        [
          model.description || model.title,
          "1",
          "—",
          amountOf(model, model.subtotal),
          amountOf(model, model.subtotal),
        ],
      ];
  const minRows = 7;
  const totalRows = Math.max(minRows, dataRows.length);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  for (let r = 0; r < totalRows; r += 1) {
    if (r % 2 === 1) {
      doc.setFillColor(238, 241, 246);
      doc.rect(MARGIN, y, CONTENT, rowH, "F");
    }
    const row = dataRows[r];
    if (row) {
      doc.setTextColor(31, 41, 55);
      let rx = MARGIN;
      row.forEach((cell, i) => {
        const col = cols[i];
        const tx =
          col.align === "right" ? rx + col.w - 2.5 : col.align === "center" ? rx + col.w / 2 : rx + 2.5;
        const text =
          col.align === "left" ? doc.splitTextToSize(cell, col.w - 5)[0] ?? cell : cell;
        doc.text(String(text), tx, y + 4.4, {
          align: col.align === "left" ? "left" : col.align,
        });
        rx += col.w;
      });
    }
    y += rowH;
  }
  const tableTop = y - totalRows * rowH - 7;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, tableTop, CONTENT, totalRows * rowH + 7);
  let dividerX = MARGIN;
  for (const col of cols.slice(0, -1)) {
    dividerX += col.w;
    doc.line(dividerX, tableTop, dividerX, y);
  }

  // Terms + totals
  const sectionY = y + 6;
  const leftW = 104;
  doc.setFillColor(accent[0], accent[1], accent[2]);
  doc.rect(MARGIN, sectionY, leftW, 6, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("TERMS AND CONDITIONS", MARGIN + 2.5, sectionY + 4.3);

  let ty = sectionY + 10.5;
  doc.setTextColor(31, 41, 55);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  model.terms.terms.filter(Boolean).forEach((line, i) => {
    doc.text(`${i + 1}. ${line}`, MARGIN + 2.5, ty);
    ty += 4.4;
  });
  const banks = bankRows(model);
  if (banks.length) {
    ty += 1;
    doc.setFont("helvetica", "bold");
    for (const [label, value] of banks) {
      doc.text(label, MARGIN + 2.5, ty);
      doc.text(String(value), MARGIN + 48, ty);
      ty += 4.4;
    }
    doc.setFont("helvetica", "normal");
  }
  doc.setDrawColor(203, 213, 225);
  doc.rect(MARGIN, sectionY + 6, leftW, Math.max(ty - sectionY - 8, 10));

  // Totals ladder
  const totX = RIGHT;
  const labelX = 126;
  let sy = sectionY + 2;
  doc.setFontSize(9);
  const ladder: [string, string, boolean][] = [
    ["Subtotal", amountOf(model, model.subtotal), false],
    ["Taxable", amountOf(model, model.taxable), false],
    ["Tax rate", model.taxRate ? `${model.taxRate}%` : model.taxLabel || "—", true],
    ["Tax due", amountOf(model, model.tax), false],
    ["Other", model.other || "-", true],
  ];
  doc.setDrawColor(148, 163, 184);
  for (const [label, value, boxed] of ladder) {
    doc.setTextColor(31, 41, 55);
    doc.setFont("helvetica", "normal");
    doc.text(label, labelX, sy + 4);
    if (boxed) {
      doc.rect(totX - 34, sy, 34, 6);
      doc.text(String(value), totX - 2, sy + 4.2, { align: "right" });
    } else {
      doc.text(String(value), totX - 2, sy + 4.2, { align: "right" });
      doc.line(totX - 34, sy + 5.6, totX, sy + 5.6);
    }
    sy += 7.4;
  }
  sy += 1.5;
  doc.setFillColor(219, 227, 241);
  doc.rect(totX - 34, sy, 34, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text("TOTAL", labelX, sy + 5);
  doc.text(totalOf(model, model.total), totX - 2, sy + 5, { align: "right" });
  doc.setLineWidth(0.5);
  doc.setDrawColor(15, 23, 42);
  doc.line(labelX, sy - 1, totX, sy - 1);

  // Centered footer note
  const footY = Math.max(sy + 18, ty + 12);
  const center = (MARGIN + RIGHT) / 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(31, 41, 55);
  let fy = Math.min(footY, 262);
  if (contactPhone(model)) {
    doc.text(
      `If you have any questions about this ${model.title.toLowerCase()}, please contact ${contactPhone(model)}`,
      center,
      fy,
      { align: "center" },
    );
    fy += 4.6;
  }
  if (contactEmail(model)) {
    doc.setTextColor(29, 78, 216);
    doc.text(contactEmail(model), center, fy, { align: "center" });
    fy += 5;
  }
  if (model.terms.closingNote) {
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bolditalic");
    doc.setFontSize(10.5);
    doc.text(model.terms.closingNote, center, fy, { align: "center" });
  }
}

async function drawTabularPdf(doc: Pdf, model: DocumentRenderModel) {
  const { default: autoTable } = await import("jspdf-autotable");
  const accent = hexToRgb(model.accent);
  const modern = (
    [
      "modern",
      "receipt",
      "payment",
      "payslip",
      "transfer",
      "asset",
      "credit",
    ] as DocumentTemplateId[]
  ).includes(model.templateId);
  const minimal = (
    [
      "minimal",
      "journal",
      "delivery",
      "goods",
      "warehouse",
      "recon",
      "certificate",
      "claim",
      "order",
    ] as DocumentTemplateId[]
  ).includes(model.templateId);
  let y = 16;

  if (modern) {
    y = drawPdfLetterhead(doc, {
      title: model.title,
      subtitle: `${model.referenceLabel} ${model.reference}`,
      marginX: MARGIN,
      startY: 14,
      pageWidth: RIGHT + MARGIN,
    });
  } else {
    const hasLogo = addLogo(doc, model, MARGIN, 12, 28, 16);
    const textX = hasLogo ? MARGIN + 32 : MARGIN;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(minimal ? 12 : 14);
    doc.setTextColor(minimal ? 15 : accent[0], minimal ? 23 : accent[1], minimal ? 42 : accent[2]);
    doc.text(model.businessName, textX, 20);
    doc.setFontSize(minimal ? 14 : 16);
    doc.text(model.title, RIGHT, 20, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(80);
    let mY = 26;
    for (const line of companyDetailLines(model)) {
      doc.text(line, textX, mY);
      mY += 3.6;
    }
    doc.text(`${model.referenceLabel} ${model.reference}`, RIGHT, 26, { align: "right" });
    doc.text(`Date: ${model.date || "—"}`, RIGHT, 30.5, { align: "right" });
    if (model.dueDate) doc.text(`Due: ${model.dueDate}`, RIGHT, 35, { align: "right" });
    y = Math.max(mY, 38) + 3;
    doc.setDrawColor(accent[0], accent[1], accent[2]);
    doc.setLineWidth(minimal ? 0.3 : 0.6);
    doc.line(MARGIN, y, RIGHT, y);
    y += 7;
  }

  doc.setTextColor(20);
  doc.setFontSize(10);
  doc.text(`${model.partyLabel}: ${model.party || "—"}`, MARGIN, y);
  y += 5;
  doc.setFontSize(8.5);
  doc.setTextColor(90);
  for (const line of model.partyAddressLines.slice(0, 3)) {
    doc.text(line, MARGIN, y);
    y += 4;
  }
  doc.setTextColor(20);
  if (model.description) {
    y += 1;
    const wrapped = doc.splitTextToSize(model.description, CONTENT);
    doc.setFontSize(9);
    doc.text(wrapped, MARGIN, y);
    y += wrapped.length * 4 + 2;
  }

  const body = model.lines.length
    ? model.lines.map((line, i) => [
        String(i + 1),
        line.description || line.item || "—",
        amountOf(model, line.qty),
        line.unitLabel,
        amountOf(model, line.unitCost),
        amountOf(model, line.amount),
      ])
    : [["1", model.description || "—", "1", "—", "", amountOf(model, model.subtotal)]];

  autoTable(doc, {
    startY: y + 2,
    head: [["#", "Description", "Qty", "Unit", "Unit cost", "Amount"]],
    body,
    theme: minimal ? "plain" : "grid",
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: minimal
      ? { textColor: 20, fontStyle: "bold", lineWidth: { bottom: 0.3 } }
      : { fillColor: accent, textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 9 },
      2: { halign: "right", cellWidth: 14 },
      3: { cellWidth: 14 },
      4: { halign: "right", cellWidth: 28 },
      5: { halign: "right", cellWidth: 32 },
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = ((doc as any).lastAutoTable?.finalY as number | undefined) ?? y + 20;
  let ty = finalY + 8;
  doc.setFontSize(9.5);
  doc.text(`Subtotal: ${moneyWithCode(model, model.subtotal)}`, RIGHT, ty, { align: "right" });
  ty += 5;
  doc.text(
    `Tax${model.taxRate ? ` (${model.taxRate}%)` : ""}: ${moneyWithCode(model, model.tax)}`,
    RIGHT,
    ty,
    { align: "right" },
  );
  ty += 7;
  if (modern) {
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.roundedRect(RIGHT - 70, ty - 5.5, 70, 9, 1.5, 1.5, "F");
    doc.setTextColor(255, 255, 255);
  }
  doc.setFontSize(11.5);
  doc.setFont("helvetica", "bold");
  doc.text(`Total: ${totalOf(model, model.total)}`, RIGHT - (modern ? 3 : 0), ty, {
    align: "right",
  });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(20);

  ty += 10;
  doc.setFontSize(9);
  for (const extra of model.extras) {
    doc.text(`${extra.label}: ${extra.value}`, MARGIN, ty);
    ty += 4;
  }
  if (model.footerText) {
    ty += 3;
    doc.setTextColor(90);
    doc.setFontSize(8.5);
    doc.text(doc.splitTextToSize(model.footerText, CONTENT), MARGIN, ty);
  }
  drawPdfFooter(doc);
}

/** Render the document to a PDF blob without downloading it. */
export async function buildDocumentPdfBlob(
  entityKey: string,
  entityLabel: string,
  record: ManagerRecord,
  options?: { templateId?: DocumentTemplateId },
): Promise<{ blob: Blob; model: DocumentRenderModel }> {
  const model = buildDocumentModel(entityKey, entityLabel, record, options);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  if (model.templateId === "pro-forma") {
    drawProFormaPdf(doc, model);
  } else {
    await drawTabularPdf(doc, model);
  }
  return { blob: doc.output("blob"), model };
}

export async function exportDocumentPdf(
  entityKey: string,
  entityLabel: string,
  record: ManagerRecord,
  options?: { templateId?: DocumentTemplateId },
): Promise<Blob> {
  const { blob, model } = await buildDocumentPdfBlob(entityKey, entityLabel, record, options);
  downloadBlob(blob, `${safeFilename(`${model.title}-${model.reference}`)}.pdf`);
  return blob;
}
