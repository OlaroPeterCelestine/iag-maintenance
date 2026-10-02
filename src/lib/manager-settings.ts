import { MODULE_SLUGS, type ModuleSlug, NAV_MODULES } from "@/lib/module-data";
import { getMemorySetting, setMemorySetting, hasMemorySetting } from "@/lib/db/client-store";
import { persistSettingToDb } from "@/lib/db/sync";
import { apiFetch } from "@/lib/api-auth";
import { REQUEST_CHAIN_EMAIL_TEMPLATES } from "@/lib/export/request-chain-email-defaults";

export const ENABLED_TABS_KEY = "iag-maintenance-enabled-tabs-v1";
export const MANAGER_SETTINGS_KEY = "financeiag-manager-settings";

/** Always-on tabs in Manager (cannot be disabled) */
export const CORE_TABS: ModuleSlug[] = ["production"];

/** Maintenance app: machines, work orders, schedules, parts, downtime, job cards. */
export const DEFAULT_ENABLED_TABS: ModuleSlug[] = ["production", "documents"];

export type ManagerSettings = {
  businessName: string;
  address: string;
  country: string;
  baseCurrencyCode: string;
  baseCurrencyName: string;
  baseCurrencySymbol: string;
  baseCurrencyDecimals: number;
  dateFormat: string;
  timeFormat: string;
  firstDayOfWeek: string;
  numberFormat: string;
  accountingBasis: "accrual" | "cash";
  lockDate: string | null;
  lockEnabled: boolean;
  /**
   * When true, historical / past transaction dates are allowed for entry, import,
   * and posting — lock date and soft-closed periods do not block. Turn off after
   * finishing a historical data load so period lock applies again.
   */
  allowBackdating: boolean;
  /** Inventory costing method for COGS. */
  inventoryCosting: "average" | "fifo" | "lifo" | "specific";
  /** Fiscal year end month-day, e.g. 12-31 */
  fiscalYearEnd: string;
  /** Require Approved/Active before posting (approval workflow). */
  requireApprovalToPost: boolean;
  /** Materiality threshold in base currency */
  materialityThreshold: number;
  /** Corporate tax rate % for IAS 12 */
  corporateTaxRate: number;
};

export const defaultManagerSettings: ManagerSettings = {
  businessName: "Inspire Africa Group",
  address: "Plot 54 Mwafu Road, Ntinda, Kampala, Uganda",
  country: "Uganda",
  baseCurrencyCode: "UGX",
  baseCurrencyName: "Ugandan Shilling",
  baseCurrencySymbol: "USh",
  baseCurrencyDecimals: 0,
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  firstDayOfWeek: "Monday",
  numberFormat: "1,234.56",
  accountingBasis: "accrual",
  lockDate: null,
  lockEnabled: false,
  allowBackdating: true,
  inventoryCosting: "average",
  fiscalYearEnd: "12-31",
  requireApprovalToPost: false,
  materialityThreshold: 0,
  corporateTaxRate: 30,
};

export function loadEnabledTabs(): ModuleSlug[] {
  if (typeof window === "undefined") return DEFAULT_ENABLED_TABS;
  try {
    const stored = getMemorySetting<ModuleSlug[] | null>(ENABLED_TABS_KEY, null);
    if (!stored || !Array.isArray(stored) || !stored.length) return DEFAULT_ENABLED_TABS;
    const migrated: ModuleSlug[] = [];
    for (const s of stored) {
      if (s === "requests") {
        migrated.push("general-requests", "oral-payment-requests");
        continue;
      }
      if ((MODULE_SLUGS as readonly string[]).includes(s)) {
        migrated.push(s as ModuleSlug);
      }
    }
    // Contract Manager was split out of Project Manager — enable it when Projects is on.
    if (migrated.includes("projects") && !migrated.includes("contract-manager")) {
      migrated.push("contract-manager");
    }
    const withCore = Array.from(new Set([...migrated, ...CORE_TABS]));
    return withCore.length ? withCore : DEFAULT_ENABLED_TABS;
  } catch {
    return DEFAULT_ENABLED_TABS;
  }
}

export function saveEnabledTabs(tabs: ModuleSlug[]): Promise<boolean> {
  const withCore = Array.from(new Set([...tabs, ...CORE_TABS]));
  setMemorySetting(ENABLED_TABS_KEY, withCore);
  window.dispatchEvent(new Event("financeiag-tabs-changed"));
  return persistSettingToDb(ENABLED_TABS_KEY, withCore);
}

export function loadManagerSettings(): ManagerSettings {
  if (typeof window === "undefined") return defaultManagerSettings;
  try {
    const stored = getMemorySetting<Partial<ManagerSettings> | null>(
      MANAGER_SETTINGS_KEY,
      null,
    );
    if (!stored) return defaultManagerSettings;
    const merged = { ...defaultManagerSettings, ...stored };
    if (
      stored.baseCurrencyCode === "KES" &&
      stored.baseCurrencyName === "Kenyan Shilling" &&
      (stored.baseCurrencySymbol === "KSh" || !stored.baseCurrencySymbol)
    ) {
      merged.baseCurrencyCode = defaultManagerSettings.baseCurrencyCode;
      merged.baseCurrencyName = defaultManagerSettings.baseCurrencyName;
      merged.baseCurrencySymbol = defaultManagerSettings.baseCurrencySymbol;
      merged.baseCurrencyDecimals = defaultManagerSettings.baseCurrencyDecimals;
      saveManagerSettings(merged);
    }
    return merged;
  } catch {
    return defaultManagerSettings;
  }
}

export function saveManagerSettings(settings: ManagerSettings): Promise<boolean> {
  setMemorySetting(MANAGER_SETTINGS_KEY, settings);
  window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
  window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
  return persistSettingToDb(MANAGER_SETTINGS_KEY, settings);
}

export const TAX_CODES_KEY = "financeiag-tax-codes";
export const FX_KEY = "financeiag-foreign-currencies";
export const CUSTOM_FIELDS_KEY = "financeiag-custom-fields";
export const DIVISIONS_KEY = "financeiag-divisions";
export const SUPPLIER_CATEGORIES_KEY = "financeiag-supplier-categories";
export const USERS_KEY = "financeiag-users";
export const ROLES_KEY = "financeiag-roles";

export type RoleRow = {
  id: string;
  name: string;
  description: string;
  canView: string;
  canCreate: string;
  canEdit: string;
  canDelete: string;
  /** Built-in roles cannot be deleted. */
  system: boolean;
  /**
   * Optional per-page CRUD overrides (module slug or special nav key).
   * When a page is omitted, workspace CRUD + default module visibility apply.
   */
  pagePermissions?: Record<
    string,
    {
      canView: string;
      canCreate: string;
      canEdit: string;
      canDelete: string;
    }
  >;
};
export const FORM_DEFAULTS_KEY = "financeiag-form-defaults";
export const FOOTERS_KEY = "financeiag-footers";
export const EMAIL_SETTINGS_KEY = "financeiag-email-settings";
export const REQUEST_EMAIL_CONTACTS_KEY = "financeiag-request-email-contacts";
export const BUSINESS_LOGO_KEY = "financeiag-business-logo";
export const EXCHANGE_RATES_KEY = "financeiag-exchange-rates";
export const EMAIL_TEMPLATES_KEY = "financeiag-email-templates";
export const THEMES_KEY = "financeiag-themes";
export const PAYSLIP_ITEMS_KEY = "financeiag-payslip-items";
export const CLAIM_PAYERS_KEY = "financeiag-claim-payers";
export const RECEIPT_RULES_KEY = "financeiag-receipt-rules";
export const PAYMENT_RULES_KEY = "financeiag-payment-rules";
export const CONTROL_ACCOUNTS_KEY = "financeiag-control-accounts";
export const CUSTOMER_PORTALS_KEY = "financeiag-customer-portals";
export const RECURRING_TEMPLATES_KEY = "financeiag-recurring-templates";

export const FORM_TYPES = [
  "Sales quotes",
  "Sales orders",
  "Sales invoices",
  "Credit notes",
  "Delivery notes",
  "Purchase quotes",
  "Purchase orders",
  "Purchase invoices",
  "Debit notes",
  "Goods receipts",
  "Receipts",
  "Payments",
  "Payslips",
  "Expense claims",
  "Journal entries",
  "General requests",
  "Oral payment requests",
  "Payment requests",
  "Requisitions",
  "Leave requests",
] as const;

export type FormType = (typeof FORM_TYPES)[number];

export type TaxCodeRow = {
  id: string;
  name: string;
  label: string;
  rate: string;
  account: string;
};

export type ForeignCurrencyRow = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  decimals: string;
};

export type CustomFieldRow = {
  id: string;
  name: string;
  type: string;
  placement: string;
};

export type DivisionRow = { id: string; name: string };

/** QuickBooks-style classes for tagging transactions by business line. */
export const defaultDivisions: DivisionRow[] = [
  { id: "1", name: "Head Office" },
  { id: "2", name: "Coffee" },
  { id: "3", name: "Cosmetics" },
  { id: "4", name: "Restaurant" },
  { id: "5", name: "Fleet" },
];

/** Disabled — divisions come from Postgres only (API hydrate / Settings UI). */
export function ensureDefaultDivisions(): boolean {
  return false;
}

export function divisionSelectOptions(): { value: string; label: string }[] {
  return loadList(DIVISIONS_KEY, defaultDivisions)
    .map((row) => (row.name || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }));
}

export type SupplierCategoryRow = { id: string; name: string };

export const defaultSupplierCategories: SupplierCategoryRow[] = [
  { id: "sc-1", name: "Hardware" },
  { id: "sc-2", name: "ELECTRICALS" },
  { id: "sc-3", name: "Services" },
  { id: "sc-4", name: "Office supplies" },
  { id: "sc-5", name: "Fuel & lubricants" },
  { id: "sc-6", name: "Construction" },
];

/** Options for supplier Category picker (Settings list + any in-use names). */
export function supplierCategorySelectOptions(
  extraNames: string[] = [],
): { value: string; label: string }[] {
  const fromSettings = loadList(SUPPLIER_CATEGORIES_KEY, defaultSupplierCategories).map(
    (row) => (row.name || "").trim(),
  );
  const names = new Set<string>();
  for (const name of [...fromSettings, ...extraNames]) {
    const trimmed = name.trim();
    if (trimmed) names.add(trimmed);
  }
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }));
}

/** Persist a newly typed supplier category so it appears next time. */
export function ensureSupplierCategory(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || typeof window === "undefined") return false;
  const existing = loadList(SUPPLIER_CATEGORIES_KEY, defaultSupplierCategories);
  if (existing.some((row) => (row.name || "").trim().toLowerCase() === trimmed.toLowerCase())) {
    return false;
  }
  saveList(SUPPLIER_CATEGORIES_KEY, [
    ...existing,
    { id: crypto.randomUUID(), name: trimmed },
  ]);
  return true;
}

export type UserRow = {
  id: string;
  name: string;
  username: string;
  /** Optional work email used for login. */
  email?: string;
  role: string;
  canView: string;
  canCreate: string;
  canEdit: string;
  canDelete: string;
};

export type FormDefaultRow = {
  id: string;
  formType: string;
  theme: string;
  paymentTerms: string;
  dueDays: string;
  notes: string;
  referencePrefix: string;
};

export type FooterRow = {
  id: string;
  name: string;
  formType: string;
  content: string;
  active: string;
};

export type EmailSettings = {
  host: string;
  port: string;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  useTls: boolean;
  replyTo: string;
};

/** EgoSMS API credentials for Comms → SMS (env vars override when set). */
/** Manual contacts for request approval-chain emails (CEO, GM, Finance, …). */
export type RequestEmailContact = {
  id: string;
  role: string;
  name: string;
  email: string;
  active: string;
};

export const REQUEST_EMAIL_ROLE_OPTIONS = [
  "Requestor",
  "Quantity Surveyor",
  "Project Manager",
  "Accounts Assistant",
  "Accountant",
  "HR",
  "General Manager",
  "CEO",
  "Finance",
  "Stores Manager",
  "Procurement",
  "Contractor",
  "Department Head",
  "Reviewer",
  "Approver",
  "Other",
] as const;

export type BusinessLogo = {
  dataUrl: string | null;
  fileName: string;
};

export type ExchangeRateRow = {
  id: string;
  currency: string;
  date: string;
  rate: string;
};

export type EmailTemplateRow = {
  id: string;
  name: string;
  formType: string;
  subject: string;
  body: string;
};

export type ThemeRow = {
  id: string;
  name: string;
  formType: string;
  primaryColor: string;
  font: string;
  layout: string;
};

export type PayslipItemRow = {
  id: string;
  name: string;
  kind: string;
  expenseAccount: string;
  liabilityAccount: string;
  defaultRate: string;
};

export type ClaimPayerRow = {
  id: string;
  name: string;
  payerType: string;
  openingBalance: string;
};

export type BankRuleRow = {
  id: string;
  name: string;
  bankAccount: string;
  descriptionContains: string;
  party: string;
  postingAccount: string;
  taxCode: string;
};

export type ControlAccountRow = {
  id: string;
  name: string;
  code: string;
  category: string;
  group: string;
};

export type CustomerPortalRow = {
  id: string;
  customer: string;
  quotes: string;
  orders: string;
  invoices: string;
  creditNotes: string;
};

export type RecurringTemplateRow = {
  id: string;
  name: string;
  kind: string;
  party: string;
  interval: string;
  nextIssueDate: string;
  amount: string;
};

export const defaultTaxCodes: TaxCodeRow[] = [
  { id: "1", name: "VAT 18%", label: "VAT", rate: "18", account: "VAT Account" },
  { id: "2", name: "Exempt", label: "EXE", rate: "0", account: "VAT Account" },
];

export const defaultForeignCurrencies: ForeignCurrencyRow[] = [
  { id: "1", code: "USD", name: "US Dollar", symbol: "$", decimals: "2" },
  { id: "2", code: "EUR", name: "Euro", symbol: "€", decimals: "2" },
  { id: "3", code: "KES", name: "Kenyan Shilling", symbol: "KSh", decimals: "2" },
];

const PAGE_DENY = {
  canView: "No",
  canCreate: "No",
  canEdit: "No",
  canDelete: "No",
} as const;

const PAGE_PROJECTS = {
  canView: "Yes",
  canCreate: "Yes",
  canEdit: "Yes",
  canDelete: "No",
} as const;

const PAGE_PROFILE = {
  canView: "Yes",
  canCreate: "No",
  canEdit: "Yes",
  canDelete: "No",
} as const;

/**
 * Turns a role's page matrix into an allowlist: these flags apply to every page
 * the matrix does not name, so a module added later is denied rather than
 * inherited from workspace CRUD. Roles without it keep override-map behaviour.
 */
export const PAGE_WILDCARD_KEY = "*";

/**
 * Contractors manage contracts under a Project Manager: Project Manager work,
 * Contract Manager (directory / invoices / ledgers), and their own profile.
 * Every other module / app surface is explicitly denied so global CRUD
 * cannot reopen Banking, Requests, Reports, etc.
 */
export function contractorDefaultPagePermissions(): NonNullable<
  RoleRow["pagePermissions"]
> {
  const pages: NonNullable<RoleRow["pagePermissions"]> = {
    [PAGE_WILDCARD_KEY]: { ...PAGE_DENY },
    projects: { ...PAGE_PROJECTS },
    "contract-manager": { ...PAGE_PROJECTS },
    profile: { ...PAGE_PROFILE },
  };
  for (const slug of MODULE_SLUGS) {
    if (slug === "projects" || slug === "contract-manager") continue;
    pages[slug] = { ...PAGE_DENY };
  }
  for (const key of [
    "dashboard",
    "guides",
    "qna",
    "templates",
    "comms",
    "accounting-documents",
    "payment-requests",
  ] as const) {
    pages[key] = { ...PAGE_DENY };
  }
  return pages;
}

export const defaultRoles: RoleRow[] = [
  {
    id: "role-admin",
    name: "Administrator",
    description: "Full CRUD — view, create, edit, and delete across the workspace.",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "Yes",
    system: true,
  },
  {
    id: "role-super-admin",
    name: "Super Admin",
    description:
      "Full system access — Overview, every module, settings, users, and admin surfaces (same as Administrator).",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "Yes",
    system: true,
  },
  {
    id: "role-qs",
    name: "Quantity Surveyor",
    description:
      "Reviews material requests after initiator submit (before Project Manager → Stores).",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "No",
    system: true,
    // contract-manager is an explicit-grant module — keep the access QS had
    // before Contract Manager was split out of Project Manager.
    pagePermissions: {
      "contract-manager": { canView: "Yes", canCreate: "No", canEdit: "No", canDelete: "No" },
    },
  },
  {
    id: "role-pm",
    name: "Project Manager",
    description:
      "PM desk — QS-approved material requests on the stores path; payment requests skip this desk (Accounts → GM → CEO). Also assigned projects.",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "No",
    system: true,
    pagePermissions: {
      "contract-manager": { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" },
    },
  },
  {
    id: "role-accounts-assistant",
    name: "Accounts Assistant",
    description:
      "Accounts desk — first approver on submitted payments / oral / general / fleet / payroll before General Manager.",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "No",
    system: true,
    // assets/capital join the fleet/investments grant this role already
    // carries in production — same finance cluster, kept together.
    pagePermissions: {
      assets: { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" },
      capital: { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" },
    },
  },
  {
    id: "role-dept-head",
    name: "Department Head",
    description:
      "HOD desk — first approver on leave requests (Requestor → HOD → HR → Approved).",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "No",
    system: true,
  },
  {
    id: "role-gm",
    name: "General Manager",
    description:
      "Approves after Accounts Assistant on payments; reviews low-stock material procurement path.",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "No",
    system: true,
  },
  {
    id: "role-ceo",
    name: "CEO",
    description: "Final executive approval before Finance pays.",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "No",
    system: true,
  },
  {
    id: "role-finance",
    name: "Finance",
    description:
      "Marks CEO-approved payment requests as paid; reviews and pays low-stock material procurement.",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "No",
    system: true,
  },
  {
    id: "role-stores",
    name: "Stores Manager",
    description:
      "Issues materials when stock is available (final step on stores material-request path).",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "No",
    system: true,
    // logistics/distribution/fleet are supply-chain modules within this role's scope.
    pagePermissions: {
      logistics: { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" },
      distribution: { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" },
      fleet: { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" },
    },
  },
  {
    id: "role-hr",
    name: "HR",
    description:
      "Final approver on leave requests after HOD (Requestor → HOD → HR → Approved).",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "No",
    system: true,
  },
  {
    id: "role-procurement",
    name: "Procurement",
    description:
      "Initiates low/no-stock material path and completes follow-up after Finance payment.",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "No",
    system: true,
    pagePermissions: {
      logistics: { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" },
      distribution: { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" },
      fleet: { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" },
    },
  },
  {
    id: "role-accountant",
    name: "Accountant",
    description:
      "Accounts desk — same queue as Accounts Assistant (submitted payments / oral / general / fleet / payroll before GM). No Banking module.",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "No",
    system: true,
    pagePermissions: {
      assets: { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" },
      capital: { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" },
      "receipts-payments": { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" },
      banking: { canView: "No", canCreate: "No", canEdit: "No", canDelete: "No" },
      "reports/bank-reconciliation": { canView: "No", canCreate: "No", canEdit: "No", canDelete: "No" },
    },
  },
  {
    id: "role-contractor",
    name: "Contractor",
    description:
      "Projects + Contract Manager only — assigned projects, progress certificates, requisitions, and tasks. No other modules.",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "No",
    system: true,
    pagePermissions: contractorDefaultPagePermissions(),
  },
  {
    id: "role-clerk",
    name: "Clerk",
    description: "View and create day-to-day documents. Cannot edit or delete.",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "No",
    canDelete: "No",
    system: true,
  },
  {
    id: "role-reviewer",
    name: "Reviewer",
    description:
      "Legacy notify-only role — no approval desk. Prefer Accounts Assistant for oral/general reviews.",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "No",
    canDelete: "No",
    system: true,
  },
  {
    id: "role-approver",
    name: "Approver",
    description:
      "Legacy notify-only role — no approval desk. Prefer GM / CEO / Finance for chain approvals.",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "No",
    canDelete: "No",
    system: true,
  },
  {
    id: "role-viewer",
    name: "Viewer",
    description: "View only — reports and inquiry. No create, edit, or delete.",
    canView: "Yes",
    canCreate: "No",
    canEdit: "No",
    canDelete: "No",
    system: true,
  },
];

/**
 * Empty on purpose.
 *
 * This held an invented administrator and was the fallback whenever the real
 * directory could not be read, so it reached the Users screen and the
 * recipient list for request emails — where an invented address is
 * indistinguishable from a real one until something is sent to it. When the
 * directory cannot be read the honest answer is nobody.
 */
export const defaultUsers: UserRow[] = [];

export const defaultFormDefaults: FormDefaultRow[] = [
  {
    id: "1",
    formType: "Sales invoices",
    theme: "Classic",
    paymentTerms: "Net 30",
    dueDays: "30",
    notes: "Thank you for your business.",
    referencePrefix: "INV-",
  },
  {
    id: "2",
    formType: "Purchase invoices",
    theme: "Classic",
    paymentTerms: "Net 30",
    dueDays: "30",
    notes: "",
    referencePrefix: "BILL-",
  },
  {
    id: "3",
    formType: "Purchase orders",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "PO-",
  },
  {
    id: "4",
    formType: "Sales orders",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "SO-",
  },
  {
    id: "5",
    formType: "Receipts",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "REC-",
  },
  {
    id: "6",
    formType: "Payments",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "PAY-",
  },
  {
    id: "7",
    formType: "Customers",
    theme: "Classic",
    paymentTerms: "Net 30",
    dueDays: "30",
    notes: "",
    referencePrefix: "CUS-",
  },
  {
    id: "8",
    formType: "Suppliers",
    theme: "Classic",
    paymentTerms: "Net 30",
    dueDays: "30",
    notes: "",
    referencePrefix: "SUP-",
  },
  {
    id: "9",
    formType: "Employees",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "EMP-",
  },
  {
    id: "10",
    formType: "Inventory Items",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "SKU-",
  },
  {
    id: "11",
    formType: "Non-inventory Items",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "SVC-",
  },
  {
    id: "12",
    formType: "Inventory Kits",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "KIT-",
  },
  {
    id: "13",
    formType: "Inventory Locations",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "LOC-",
  },
  {
    id: "14",
    formType: "Fixed Assets",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "FA-",
  },
  {
    id: "15",
    formType: "Intangible Assets",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "IA-",
  },
  {
    id: "16",
    formType: "Projects",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "PRJ-",
  },
  {
    id: "17",
    formType: "Investments",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "INVST-",
  },
  {
    id: "18",
    formType: "Bank & Cash Accounts",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "BANK-",
  },
  {
    id: "19",
    formType: "Capital Accounts",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "CAP-",
  },
  {
    id: "20",
    formType: "Journal Entries",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "JE-",
  },
  {
    id: "21",
    formType: "Credit Notes",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "CN-",
  },
  {
    id: "22",
    formType: "Debit Notes",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "DN-",
  },
  {
    id: "23",
    formType: "Inter Account Transfers",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "XFR-",
  },
  {
    id: "24",
    formType: "Expense Claims",
    theme: "Classic",
    paymentTerms: "",
    dueDays: "",
    notes: "",
    referencePrefix: "EXP-",
  },
];

export const defaultFooters: FooterRow[] = [
  {
    id: "1",
    name: "Bank details",
    formType: "Sales invoices",
    content: "Pay to IAG · Account 0123456789 · Stanbic Bank Uganda · SWIFT SBICUGKX",
    active: "Yes",
  },
  {
    id: "2",
    name: "Payment terms",
    formType: "Sales invoices",
    content: "Payment is due within the stated terms. Late fees may apply.",
    active: "Yes",
  },
];

export const defaultEmailSettings: EmailSettings = {
  host: "smtp.gmail.com",
  port: "587",
  username: "support@inspireafricagroup.com",
  password: "",
  fromName: "Inspire Africa Group",
  fromEmail: "support@inspireafricagroup.com",
  useTls: true,
  replyTo: "support@inspireafricagroup.com",
};

export const defaultRequestEmailContacts: RequestEmailContact[] = [
  {
    id: "1",
    role: "Requestor",
    name: "Requestor desk",
    email: "olaropetercelestine@gmail.com",
    active: "Yes",
  },
  {
    id: "2",
    role: "Quantity Surveyor",
    name: "Quantity Surveyor",
    email: "olaropetercelestine@gmail.com",
    active: "Yes",
  },
  {
    id: "3",
    role: "Project Manager",
    name: "Project Manager",
    email: "olaropetercelestine@gmail.com",
    active: "Yes",
  },
  {
    id: "4",
    role: "Accounts Assistant",
    name: "Accounts Assistant",
    email: "olaropetercelestine@gmail.com",
    active: "Yes",
  },
  {
    id: "14",
    role: "Accountant",
    name: "Accountant",
    email: "olaropetercelestine@gmail.com",
    active: "Yes",
  },
  {
    id: "13",
    role: "HR",
    name: "HR",
    email: "olaropetercelestine@gmail.com",
    active: "Yes",
  },
  {
    id: "5",
    role: "General Manager",
    name: "General Manager",
    email: "olaropetercelestine@gmail.com",
    active: "Yes",
  },
  {
    id: "6",
    role: "CEO",
    name: "CEO",
    email: "olaropetercelestine@gmail.com",
    active: "Yes",
  },
  {
    id: "7",
    role: "Finance",
    name: "Finance",
    email: "olaropetercelestine@gmail.com",
    active: "Yes",
  },
  {
    id: "11",
    role: "Stores Manager",
    name: "Stores Manager",
    email: "olaropetercelestine@gmail.com",
    active: "Yes",
  },
  {
    id: "12",
    role: "Procurement",
    name: "Procurement",
    email: "olaropetercelestine@gmail.com",
    active: "Yes",
  },
  {
    id: "8",
    role: "Contractor",
    name: "",
    email: "",
    active: "Yes",
  },
];

/** Fallback when no party/contact emails resolve — keeps alerts from silently dropping. */
export const DEFAULT_REQUEST_ALERT_EMAIL = "olaropetercelestine@gmail.com";

export const defaultBusinessLogo: BusinessLogo = {
  dataUrl: null,
  fileName: "",
};

export const defaultExchangeRates: ExchangeRateRow[] = [
  { id: "1", currency: "USD", date: "2026-07-01", rate: "3700" },
  { id: "2", currency: "EUR", date: "2026-07-01", rate: "4000" },
];

export const defaultEmailTemplates: EmailTemplateRow[] = [
  {
    id: "1",
    name: "Invoice email",
    formType: "Sales invoices",
    subject: "Invoice {{reference}} from {{business}}",
    body: "Dear {{party}},\n\nPlease find attached invoice {{reference}} for {{amount}}.\n\nThank you.",
  },
  ...REQUEST_CHAIN_EMAIL_TEMPLATES,
];

/** Ensure request-chain templates appear even when older invoice-only lists are saved. */
export function loadEmailTemplates(): EmailTemplateRow[] {
  const stored = loadList(EMAIL_TEMPLATES_KEY, defaultEmailTemplates);
  const byId = new Map(stored.map((row) => [row.id, row]));
  for (const row of REQUEST_CHAIN_EMAIL_TEMPLATES) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  if (!byId.has("1")) {
    byId.set("1", defaultEmailTemplates[0]);
  }
  return [...byId.values()];
}
export const defaultThemes: ThemeRow[] = [
  {
    id: "1",
    name: "Classic",
    formType: "Sales invoices",
    primaryColor: "#111111",
    font: "Helvetica",
    layout: "Standard",
  },
  {
    id: "2",
    name: "Modern",
    formType: "Sales invoices",
    primaryColor: "#0f766e",
    font: "Helvetica",
    layout: "Compact",
  },
];

export const defaultPayslipItems: PayslipItemRow[] = [
  {
    id: "1",
    name: "Basic salary",
    kind: "Earnings",
    expenseAccount: "Salaries and Employee Wages",
    liabilityAccount: "Net Salaries Payable",
    defaultRate: "",
  },
  {
    id: "2",
    name: "PAYE",
    kind: "Deduction",
    expenseAccount: "",
    liabilityAccount: "PAYE Payable",
    defaultRate: "",
  },
  {
    id: "3",
    name: "NSSF employer",
    kind: "Contribution",
    expenseAccount: "Salaries and Employee Wages",
    liabilityAccount: "NSSF Payable",
    defaultRate: "10",
  },
];

export const defaultClaimPayers: ClaimPayerRow[] = [
  { id: "1", name: "Petty cash float", payerType: "Expense Claim Payer", openingBalance: "0" },
];

export const defaultReceiptRules: BankRuleRow[] = [];
export const defaultPaymentRules: BankRuleRow[] = [];

export const defaultControlAccounts: ControlAccountRow[] = [
  { id: "1", name: "Accounts Receivable-UGX", code: "1200", category: "Customers", group: "Assets" },
  { id: "2", name: "Accounts Payable-UGX", code: "2000", category: "Suppliers", group: "Liabilities" },
  { id: "3", name: "Inventory Asset", code: "1250", category: "Inventory items", group: "Assets" },
];

export const defaultCustomerPortals: CustomerPortalRow[] = [];

export const defaultRecurringTemplates: RecurringTemplateRow[] = [];

/**
 * Read a settings list from tab memory (hydrated from Postgres).
 * Never invents hardcoded defaults in the browser — if the API has not
 * provided this key yet, returns []. SSR still uses `fallback` for markup.
 */
export function loadList<T>(key: string, fallback: T[]): T[] {
  if (typeof window === "undefined") return fallback;
  try {
    if (!hasMemorySetting(key)) return [];
    const stored = getMemorySetting<T[]>(key, []);
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

/** Memory + durable Postgres write for settings lists (tax codes, users mirror, etc.). */
export function saveList<T>(key: string, rows: T[]): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  setMemorySetting(key, rows);
  window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
  return persistSettingToDb(key, rows);
}

/** Load / save request email contacts via dedicated API (falls back to settings list). */
export function mergeRequestEmailContactDefaults(
  stored: RequestEmailContact[],
): RequestEmailContact[] {
  const byRole = new Map(
    stored.map((row) => [(row.role || "").trim().toLowerCase(), row] as const),
  );
  const merged = stored.map((row) => {
    const fallback = defaultRequestEmailContacts.find(
      (d) => d.role.toLowerCase() === (row.role || "").trim().toLowerCase(),
    );
    if (fallback?.email && !String(row.email || "").trim()) {
      return { ...row, email: fallback.email, name: row.name || fallback.name };
    }
    return row;
  });
  for (const row of defaultRequestEmailContacts) {
    const key = row.role.toLowerCase();
    if (!byRole.has(key)) {
      merged.push({ ...row });
    }
  }
  return merged;
}

export async function fetchRequestEmailContacts(): Promise<RequestEmailContact[]> {
  try {
    const res = await apiFetch("/api/request-email-contacts", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: RequestEmailContact[] };
    const rows = Array.isArray(json.data) ? json.data : [];
    const merged = mergeRequestEmailContactDefaults(
      rows.length ? rows : defaultRequestEmailContacts,
    );
    setMemorySetting(REQUEST_EMAIL_CONTACTS_KEY, merged);
    return merged;
  } catch {
    const local = loadList(REQUEST_EMAIL_CONTACTS_KEY, defaultRequestEmailContacts);
    return mergeRequestEmailContactDefaults(local);
  }
}

export async function saveRequestEmailContacts(
  contacts: RequestEmailContact[],
): Promise<boolean> {
  setMemorySetting(REQUEST_EMAIL_CONTACTS_KEY, contacts);
  window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
  try {
    const res = await apiFetch("/api/request-email-contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch {
    return persistSettingToDb(REQUEST_EMAIL_CONTACTS_KEY, contacts);
  }
}

export type TaxCodeOption = { value: string; label: string; name: string; rate: string };

/** Tax codes for form dropdowns (Settings → Tax codes). */
export function taxCodeSelectOptions(mode: "rate" | "name" = "rate"): TaxCodeOption[] {
  return loadList(TAX_CODES_KEY, defaultTaxCodes).map((row) => {
    const rate = String(row.rate ?? "0");
    const name = row.name || row.label || "Tax";
    return {
      name,
      rate,
      value: mode === "rate" ? rate : name,
      label: `${name} — ${rate}%`,
    };
  });
}

export type CurrencyOption = {
  value: string;
  label: string;
  code: string;
  name: string;
  symbol: string;
  rate: string;
  isBase: boolean;
};

/**
 * Latest exchange rate for a currency code (empty for base).
 * Prefers the newest rate on or before `asOf`; if none, uses the newest
 * available rate for that currency so one Settings rate covers all dates.
 */
export function latestExchangeRate(currencyCode: string, asOf?: string): string {
  const settings = loadManagerSettings();
  const code = (currencyCode || "").toUpperCase();
  if (!code || code === settings.baseCurrencyCode.toUpperCase()) return "1";
  const all = loadList(EXCHANGE_RATES_KEY, defaultExchangeRates)
    .filter((r) => (r.currency || "").toUpperCase() === code && parseFloat(String(r.rate || "0")) > 0)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (!all.length) return "";
  if (!asOf) return String(all[0].rate);
  const onOrBefore = all.find((r) => !r.date || r.date <= asOf);
  if (onOrBefore?.rate) return String(onOrBefore.rate);
  // Document date is before every rate row — reuse the earliest (or only) rate.
  return String(all[all.length - 1].rate || all[0].rate);
}

/**
 * Currencies for form dropdowns: base currency + Settings → Foreign currencies,
 * with the latest exchange rate shown when one exists.
 */
export function currencySelectOptions(): CurrencyOption[] {
  const settings = loadManagerSettings();
  const baseCode = (settings.baseCurrencyCode || "UGX").toUpperCase();
  const options: CurrencyOption[] = [
    {
      value: baseCode,
      code: baseCode,
      name: settings.baseCurrencyName || baseCode,
      symbol: settings.baseCurrencySymbol || baseCode,
      rate: "1",
      isBase: true,
      label: `${baseCode} — ${settings.baseCurrencyName || "Base"} (base)`,
    },
  ];

  // Always offer common foreign currencies so USD/EUR choices stick even before
  // the user customizes Settings → Currencies.
  const defaults = defaultForeignCurrencies;
  const configured = loadList(FX_KEY, defaultForeignCurrencies);
  const seen = new Set<string>([baseCode]);
  for (const row of [...configured, ...defaults]) {
    const code = (row.code || "").trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const rate = latestExchangeRate(code);
    const name = row.name || code;
    const symbol = row.symbol || code;
    options.push({
      value: code,
      code,
      name,
      symbol,
      rate,
      isBase: false,
      label: rate
        ? `${code} — ${name} · rate ${rate}`
        : `${code} — ${name}`,
    });
  }

  // Also surface any currency that only exists on the rates list (no FX master yet).
  for (const row of loadList(EXCHANGE_RATES_KEY, defaultExchangeRates)) {
    const code = (row.currency || "").trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const rate = latestExchangeRate(code);
    options.push({
      value: code,
      code,
      name: code,
      symbol: code,
      rate,
      isBase: false,
      label: rate ? `${code} · rate ${rate}` : code,
    });
  }

  return options;
}

export function loadEmailSettings(): EmailSettings {
  if (typeof window === "undefined") return defaultEmailSettings;
  try {
    const stored = getMemorySetting<Partial<EmailSettings> | null>(EMAIL_SETTINGS_KEY, null);
    if (!stored) return defaultEmailSettings;
    return { ...defaultEmailSettings, ...stored };
  } catch {
    return defaultEmailSettings;
  }
}

export function saveEmailSettings(settings: EmailSettings): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  setMemorySetting(EMAIL_SETTINGS_KEY, settings);
  return persistSettingToDb(EMAIL_SETTINGS_KEY, settings);
}

export function loadBusinessLogo(): BusinessLogo {
  if (typeof window === "undefined") return defaultBusinessLogo;
  try {
    const stored = getMemorySetting<Partial<BusinessLogo> | null>(BUSINESS_LOGO_KEY, null);
    if (!stored) return defaultBusinessLogo;
    return { ...defaultBusinessLogo, ...stored };
  } catch {
    return defaultBusinessLogo;
  }
}

export function saveBusinessLogo(logo: BusinessLogo): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  setMemorySetting(BUSINESS_LOGO_KEY, logo);
  return persistSettingToDb(BUSINESS_LOGO_KEY, logo);
}

export type SettingsSection = {
  id: string;
  title: string;
  description: string;
  group: string;
};

/** Settings categories for this workspace. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "business",
    title: "Business Details",
    description: "Name, logo, contact, and address shown on forms from this workspace.",
    group: "Business",
  },
  {
    id: "customize",
    title: "Customize",
    description: "Enable only the tabs this workspace uses.",
    group: "Business",
  },
  {
    id: "backup-restore",
    title: "Backup & Restore",
    description: "Download a local copy of this workspace and restore it from a backup file.",
    group: "Business",
  },
  {
    id: "reset-data",
    title: "Clean / Reset Data",
    description: "Delete test records or wipe this workspace back to a blank slate.",
    group: "Business",
  },
  {
    id: "currencies",
    title: "Base Currency",
    description: "Primary currency for this workspace (e.g. UGX).",
    group: "Localization",
  },
  {
    id: "date-number",
    title: "Date & Number Format",
    description: "Date order, time format, first day of week, and number grouping.",
    group: "Localization",
  },
  {
    id: "appearance",
    title: "Appearance",
    description: "Switch between light, dark, and system colour themes.",
    group: "Localization",
  },
  {
    id: "custom-fields",
    title: "Custom Fields",
    description: "Extra fields on forms and records in this workspace.",
    group: "Forms",
  },
  {
    id: "divisions",
    title: "Divisions",
    description: "Business units to tag on records in this workspace.",
    group: "Structure",
  },
  {
    id: "users",
    title: "Users",
    description: "Who can sign in to this workspace. Accounts are managed in IAG Admin.",
    group: "Access",
  },
  {
    id: "email",
    title: "Email Settings",
    description: "SMTP relay for sending documents and notifications from this tool.",
    group: "Access",
  },
  {
    id: "sms",
    title: "SMS Settings",
    description: "EgoSMS sender used for notifications from this tool.",
    group: "Access",
  },
  {
    id: "request-emails",
    title: "Request Email Contacts",
    description: "Who is notified when requests in this workspace need attention.",
    group: "Access",
  },
];

/** Old section ids → current */
export const SETTINGS_SECTION_ALIASES: Record<string, string> = {
  "business-details": "business",
  "business-profiles": "business",
  "business-logo": "business",
  "backup": "backup-restore",
  "restore": "backup-restore",
  "import-business": "backup-restore",
  "manager-io": "import-manager-io",
  "import-manager": "import-manager-io",
  "manager": "import-manager-io",
  "clean": "reset-data",
  "reset": "reset-data",
  "clear-data": "reset-data",
  "theme": "appearance",
  "dark-mode": "appearance",
  "base-currency": "currencies",
  "foreign-currencies": "currencies",
};

export const DEFAULT_SETTINGS_SECTION = "business";

export function tabLabel(slug: ModuleSlug) {
  return NAV_MODULES.find((m) => m.slug === slug)?.label ?? slug;
}
