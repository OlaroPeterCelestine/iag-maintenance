/**
 * Document template registry — paper layouts for every required accounting
 * source document (invoices, quotes, orders, notes, receipts, payslips, etc.).
 *
 * A template controls the printed/PDF layout only; the underlying record data
 * is identical across templates. Each printable entity has a recommended
 * layout so documents open with distinct paper styles by default.
 */

import { getMemorySetting, setMemorySetting } from "@/lib/db/client-store";
import { persistSettingToDb } from "@/lib/db/sync";

export type DocumentTemplateId =
  | "pro-forma"
  | "classic"
  | "modern"
  | "minimal"
  | "delivery"
  | "order"
  | "credit"
  | "receipt"
  | "payment"
  | "payslip"
  | "journal"
  | "goods"
  | "claim"
  | "certificate"
  | "transfer"
  | "recon"
  | "asset"
  | "warehouse";

export type DocumentTemplate = {
  id: DocumentTemplateId;
  name: string;
  description: string;
  /** Accent used for title, header bars, and totals highlight. */
  accent: string;
  bestFor: string;
};

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "pro-forma",
    name: "Pro Forma",
    description:
      "Boxed meta panel, banded description table, terms and bank details beside the totals ladder.",
    accent: "#3f5b8b",
    bestFor: "Pro forma invoices, quotes, price offers",
  },
  {
    id: "classic",
    name: "Classic",
    description:
      "Letterhead across the top with a ruled table and a right-aligned totals block.",
    accent: "#111111",
    bestFor: "Tax invoices, purchase invoices, statements",
  },
  {
    id: "modern",
    name: "Modern",
    description:
      "Filled accent header band, card-style party details, and a bold total badge.",
    accent: "#0f766e",
    bestFor: "Sales invoices, service bills",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Type-only layout with hairline rules and no filled blocks — ink friendly.",
    accent: "#334155",
    bestFor: "Internal notes, matching, provisions",
  },
  {
    id: "delivery",
    name: "Delivery slip",
    description:
      "Quantity-first packing slip with received-by / delivered-by signature lines.",
    accent: "#1d4ed8",
    bestFor: "Delivery notes, dispatch dockets",
  },
  {
    id: "order",
    name: "Order form",
    description:
      "Authorisation strip, ship-to panel, and ordered-items table for commitments.",
    accent: "#7c2d12",
    bestFor: "Sales orders, purchase orders",
  },
  {
    id: "credit",
    name: "Credit / debit memo",
    description:
      "Memo banner with reason line and reversed-amount emphasis for corrections.",
    accent: "#9f1239",
    bestFor: "Credit notes, debit notes, late fees",
  },
  {
    id: "receipt",
    name: "Cash receipt",
    description:
      "Centered voucher with paid stamp area — proof money was received.",
    accent: "#166534",
    bestFor: "Receipts, cash inflows",
  },
  {
    id: "payment",
    name: "Payment advice",
    description:
      "Remittance layout listing what was paid and which invoices were cleared.",
    accent: "#0e7490",
    bestFor: "Payments, remittance advice",
  },
  {
    id: "payslip",
    name: "Payslip",
    description:
      "Two-column earnings and deductions with net-pay highlight.",
    accent: "#1e3a8a",
    bestFor: "Payslips, statutory remittances",
  },
  {
    id: "journal",
    name: "Journal voucher",
    description:
      "Debit / credit ledger columns for manual double-entry vouchers.",
    accent: "#44403c",
    bestFor: "Journal entries, depreciation, amortisation",
  },
  {
    id: "goods",
    name: "Goods receipt",
    description:
      "GRN checklist with inspected / accepted boxes for stock received.",
    accent: "#365314",
    bestFor: "Goods receipts, stock in",
  },
  {
    id: "claim",
    name: "Expense claim",
    description:
      "Claimant header, line expenses, and prepare / approve / pay signature row.",
    accent: "#6b21a8",
    bestFor: "Expense claims, billable expenses",
  },
  {
    id: "certificate",
    name: "Tax certificate",
    description:
      "Formal double-border certificate for withholding tax evidence.",
    accent: "#854d0e",
    bestFor: "Withholding tax receipts and certificates",
  },
  {
    id: "transfer",
    name: "Transfer slip",
    description:
      "From / to account panels for inter-account and inventory moves.",
    accent: "#0369a1",
    bestFor: "Inter-account transfers, inventory transfers",
  },
  {
    id: "recon",
    name: "Bank reconciliation",
    description:
      "Statement-versus-books layout with outstanding items list.",
    accent: "#115e59",
    bestFor: "Bank reconciliations",
  },
  {
    id: "asset",
    name: "Asset register",
    description:
      "Asset card showing cost, location and carrying amount.",
    accent: "#4c1d95",
    bestFor: "Fixed assets, intangibles, leases, capital",
  },
  {
    id: "warehouse",
    name: "Warehouse slip",
    description:
      "Compact stock movement slip for write-offs, stocktakes and production.",
    accent: "#9a3412",
    bestFor: "Write-offs, stocktakes, production, landed costs",
  },
];

export const DEFAULT_DOCUMENT_TEMPLATE: DocumentTemplateId = "pro-forma";

/**
 * Recommended layout per accounting document entity so each source document
 * prints with a distinct paper style out of the box (ICA / Accountdemy style
 * source-document set: invoices, receipts, POs, delivery notes, journals,
 * payslips, WHT certificates, etc.).
 */
export const RECOMMENDED_TEMPLATE_BY_ENTITY: Record<string, DocumentTemplateId> = {
  // Sales cycle
  "sales-quotes": "pro-forma",
  "sales-orders": "order",
  "delivery-notes": "delivery",
  "sales-invoices": "classic",
  "credit-notes": "credit",
  "late-payment-fees": "payment",
  "billable-time": "modern",
  "billable-expenses": "claim",
  "revenue-contracts": "certificate",

  // Purchase cycle
  "purchase-quotes": "minimal",
  "purchase-orders": "order",
  "goods-receipts": "goods",
  "purchase-invoices": "classic",
  "debit-notes": "credit",

  // Cash & bank
  receipts: "receipt",
  payments: "payment",
  "inter-account-transfers": "transfer",
  reconciliations: "recon",

  // Payroll & claims
  payslips: "payslip",
  "statutory-remittances": "certificate",
  "expense-claims": "claim",

  // Inventory
  "stock-in": "goods",
  "inventory-transfers": "transfer",
  "inventory-write-offs": "warehouse",
  "inventory-sales": "modern",
  "production-orders": "warehouse",
  stocktakes: "warehouse",
  "landed-costs": "warehouse",

  // Fixed assets & capital
  "fixed-assets": "asset",
  "depreciation-entries": "journal",
  "intangible-assets": "asset",
  "amortization-entries": "journal",
  leases: "asset",
  "capital-accounts": "asset",
  "share-based-payments": "journal",

  // Books & journals
  "journal-entries": "journal",
  "matching-entries": "minimal",
  provisions: "minimal",

  // Tax & compliance
  "withholding-tax-receipts": "certificate",
  "withholding-tax": "certificate",
};

/** Optional accent overrides so shared skeletons still feel distinct. */
export const RECOMMENDED_ACCENT_BY_ENTITY: Record<string, string> = {
  "sales-quotes": "#3f5b8b",
  "sales-orders": "#9a3412",
  "delivery-notes": "#1d4ed8",
  "sales-invoices": "#0f172a",
  "credit-notes": "#9f1239",
  "late-payment-fees": "#b45309",
  "billable-time": "#0f766e",
  "billable-expenses": "#6b21a8",
  "revenue-contracts": "#713f12",
  "purchase-quotes": "#475569",
  "purchase-orders": "#7c2d12",
  "goods-receipts": "#365314",
  "purchase-invoices": "#1c1917",
  "debit-notes": "#be123c",
  receipts: "#166534",
  payments: "#0e7490",
  "inter-account-transfers": "#0369a1",
  reconciliations: "#115e59",
  payslips: "#1e3a8a",
  "statutory-remittances": "#312e81",
  "expense-claims": "#7e22ce",
  "stock-in": "#3f6212",
  "inventory-transfers": "#0284c7",
  "inventory-write-offs": "#9a3412",
  "inventory-sales": "#0d9488",
  "production-orders": "#c2410c",
  stocktakes: "#a16207",
  "landed-costs": "#b45309",
  "fixed-assets": "#4c1d95",
  "depreciation-entries": "#57534e",
  "intangible-assets": "#5b21b6",
  "amortization-entries": "#44403c",
  leases: "#6d28d9",
  "capital-accounts": "#3730a3",
  "share-based-payments": "#78716c",
  "journal-entries": "#292524",
  "matching-entries": "#334155",
  provisions: "#475569",
  "withholding-tax-receipts": "#854d0e",
  "withholding-tax": "#a16207",
};

export function documentTemplateById(id: string | undefined | null): DocumentTemplate {
  return (
    DOCUMENT_TEMPLATES.find((template) => template.id === id) ??
    DOCUMENT_TEMPLATES[0]
  );
}

export function recommendedTemplateForEntity(entityKey: string): DocumentTemplateId {
  return RECOMMENDED_TEMPLATE_BY_ENTITY[entityKey] ?? DEFAULT_DOCUMENT_TEMPLATE;
}

export function recommendedAccentForEntity(entityKey: string): string | undefined {
  return RECOMMENDED_ACCENT_BY_ENTITY[entityKey];
}

/* ------------------------------------------------------------------ *
 * Template selection (per form type / entity)
 * ------------------------------------------------------------------ */

export const DOCUMENT_TEMPLATE_KEY = "financeiag-document-templates";
export const DOCUMENT_TEMPLATE_EVENT = "financeiag-document-templates-changed";
/** Bump when recommended layouts change so existing installs pick up new defaults. */
export const RECOMMENDED_LAYOUTS_KEY = "financeiag-recommended-layouts-v2";

export type TemplateSelection = {
  /** Applied when a form type has no explicit choice. */
  default: DocumentTemplateId;
  byFormType: Record<string, DocumentTemplateId>;
};

const emptySelection: TemplateSelection = {
  default: DEFAULT_DOCUMENT_TEMPLATE,
  byFormType: {},
};

export function loadTemplateSelection(): TemplateSelection {
  if (typeof window === "undefined") return emptySelection;
  try {
    const parsed = getMemorySetting<Partial<TemplateSelection> | null>(
      DOCUMENT_TEMPLATE_KEY,
      null,
    );
    if (!parsed) return emptySelection;
    return {
      default: documentTemplateById(parsed.default).id,
      byFormType: Object.fromEntries(
        Object.entries(parsed.byFormType ?? {}).map(([key, value]) => [
          key,
          documentTemplateById(value).id,
        ]),
      ),
    };
  } catch {
    return emptySelection;
  }
}

function saveTemplateSelection(selection: TemplateSelection) {
  setMemorySetting(DOCUMENT_TEMPLATE_KEY, selection);
  window.dispatchEvent(new CustomEvent(DOCUMENT_TEMPLATE_EVENT));
  void persistSettingToDb(DOCUMENT_TEMPLATE_KEY, selection);
}

export function templateForFormType(formType: string): DocumentTemplateId {
  const selection = loadTemplateSelection();
  return documentTemplateById(selection.byFormType[formType] ?? selection.default).id;
}

/**
 * Resolve a template for one accounting document. Entity-specific choices
 * take priority, then the broader form type, then the recommended layout
 * for that entity, then the global default.
 */
export function templateForDocument(
  entityKey: string,
  formType: string,
): DocumentTemplateId {
  const selection = loadTemplateSelection();
  return documentTemplateById(
    selection.byFormType[entityKey] ??
      selection.byFormType[formType] ??
      RECOMMENDED_TEMPLATE_BY_ENTITY[entityKey] ??
      selection.default,
  ).id;
}

export function setTemplateForFormType(formType: string, id: DocumentTemplateId) {
  const selection = loadTemplateSelection();
  saveTemplateSelection({
    ...selection,
    byFormType: { ...selection.byFormType, [formType]: id },
  });
}

/** Drop the override so the form type follows the recommended / default template again. */
export function clearTemplateForFormType(formType: string) {
  const selection = loadTemplateSelection();
  const byFormType = { ...selection.byFormType };
  delete byFormType[formType];
  saveTemplateSelection({ ...selection, byFormType });
}

export function setDefaultTemplate(id: DocumentTemplateId) {
  const selection = loadTemplateSelection();
  saveTemplateSelection({ ...selection, default: id });
}

/** Use one template everywhere and drop per-form overrides. */
export function applyTemplateEverywhere(id: DocumentTemplateId) {
  saveTemplateSelection({ default: id, byFormType: {} });
}

/**
 * Apply the recommended distinct layout for every accounting document entity.
 * Safe to call repeatedly; versioned so upgrades refresh defaults once.
 */
export function ensureRecommendedLayouts(force = false) {
  if (typeof window === "undefined") return;
  try {
    // Discard leftover LS flags — never import into Postgres.
    try {
      localStorage.removeItem(RECOMMENDED_LAYOUTS_KEY);
      localStorage.removeItem("financeiag-recommended-layouts-v1");
    } catch {
      /* ignore */
    }

    if (!force && getMemorySetting<string | null>(RECOMMENDED_LAYOUTS_KEY, null) === "1") return;
    const selection = loadTemplateSelection();
    saveTemplateSelection({
      ...selection,
      byFormType: {
        ...RECOMMENDED_TEMPLATE_BY_ENTITY,
        ...selection.byFormType,
      },
    });
    setMemorySetting(RECOMMENDED_LAYOUTS_KEY, "1");
    void persistSettingToDb(RECOMMENDED_LAYOUTS_KEY, "1");
  } catch {
    // ignore storage failures
  }
}

/** Reset entity overrides to the researched recommended set. */
export function applyRecommendedLayouts() {
  if (typeof window === "undefined") return;
  const selection = loadTemplateSelection();
  saveTemplateSelection({
    ...selection,
    byFormType: { ...RECOMMENDED_TEMPLATE_BY_ENTITY },
  });
  setMemorySetting(RECOMMENDED_LAYOUTS_KEY, "1");
  void persistSettingToDb(RECOMMENDED_LAYOUTS_KEY, "1");
}

/* ------------------------------------------------------------------ *
 * Terms, bank details and footer shown on documents
 * ------------------------------------------------------------------ */

export const DOCUMENT_TERMS_KEY = "financeiag-document-terms";

export type DocumentTerms = {
  terms: string[];
  accountName: string;
  accountNumber: string;
  bankName: string;
  swiftCode: string;
  bankAddress: string;
  currency: string;
  contactPhone: string;
  contactEmail: string;
  closingNote: string;
  /** Days added to the issue date when a document has no explicit validity. */
  validityDays: number;
};

export const defaultDocumentTerms: DocumentTerms = {
  terms: [
    "Total payment due in 5 days",
    "Please include the invoice number on your check",
  ],
  accountName: "Inspire Africa Establishments Ltd Juzza",
  accountNumber: "1044202152290",
  bankName: "Equity Bank",
  swiftCode: "EQBLUGKA",
  bankAddress: "Plot 54 Ntinda",
  currency: "UGX",
  contactPhone: "+256773402637",
  contactEmail: "support@inspireafricagroup.com",
  closingNote: "Thank You For Your Business!",
  validityDays: 5,
};

export function loadDocumentTerms(): DocumentTerms {
  if (typeof window === "undefined") return defaultDocumentTerms;
  try {
    const parsed = getMemorySetting<Partial<DocumentTerms> | null>(DOCUMENT_TERMS_KEY, null);
    if (!parsed) return defaultDocumentTerms;
    return {
      ...defaultDocumentTerms,
      ...parsed,
      terms: Array.isArray(parsed.terms) ? parsed.terms : defaultDocumentTerms.terms,
    };
  } catch {
    return defaultDocumentTerms;
  }
}

export function saveDocumentTerms(terms: DocumentTerms) {
  if (typeof window === "undefined") return;
  setMemorySetting(DOCUMENT_TERMS_KEY, terms);
  window.dispatchEvent(new CustomEvent(DOCUMENT_TEMPLATE_EVENT));
  void persistSettingToDb(DOCUMENT_TERMS_KEY, terms);
}
