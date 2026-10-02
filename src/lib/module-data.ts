export type ModuleKpi = {
  title: string;
  value: string;
  delta: string;
  positive: boolean;
  hint?: string;
};

export type ModuleColumn = {
  key: string;
  label: string;
};

export type ModuleRow = Record<string, string> & {
  id: string;
  initials?: string;
};

export type ModuleConfig = {
  slug: string;
  label: string;
  description: string;
  kpis: ModuleKpi[];
  columns: ModuleColumn[];
  rows: ModuleRow[];
  tableTitle: string;
  /**
   * Records bucket the module reads and writes. Defaults to `slug`; set it when a
   * module is presented separately but shares ledger postings with another module.
   */
  storageSlug?: ModuleSlug;
};

/** Sidebar + route slugs aligned to Manager functional tabs */
export const MODULE_SLUGS = [
  "banking",
  "receipts-payments",
  "expense-claims",
  /** Legacy combined route — kept for storageSlug + redirects; not in NAV. */
  "requests",
  "general-requests",
  "oral-payment-requests",
  "sales",
  "purchases",
  "inventory",
  "projects",
  /** Contractor tools for managing contracts under a Project Manager. */
  "contract-manager",
  "fleet",
  "security",
  "crm",
  "logistics",
  "distribution",
  "rnd",
  "lab",
  "qa",
  "production",
  "benchmark",
  "pos",
  "payroll",
  "investments",
  "assets",
  "capital",
  "accounts",
  "documents",
  "reports",
] as const;

export type ModuleSlug = (typeof MODULE_SLUGS)[number];

/** Entities stored under banking but shown in the Receipts & Payments module. */
export const RECEIPTS_PAYMENTS_STORAGE_ENTITIES = new Set([
  "receipts",
  "payments",
  "receipt-rules",
  "payment-rules",
]);

/** Contractor contract tools (stored under projects, shown in Contract Manager). */
export const CONTRACT_MANAGER_STORAGE_ENTITIES = new Set([
  "contractors",
  "contractor-invoices",
  "contractor-ledgers",
]);

/** Oral + general request entities share the `requests` records bucket. */
export const REQUESTS_STORAGE_ENTITIES = new Set([
  "general-requests",
  "oral-payment-requests",
]);

/**
 * Map a records bucket (storage module + entity) to the UI route.
 * Receipts/payments share the banking store but live under /receipts-payments.
 * Oral and general requests each have their own page (same storage).
 */
export function hrefForStoredEntity(storageModule: string, entity: string): string {
  if (storageModule === "banking" && RECEIPTS_PAYMENTS_STORAGE_ENTITIES.has(entity)) {
    return `/receipts-payments?view=${entity}`;
  }
  if (storageModule === "projects" && CONTRACT_MANAGER_STORAGE_ENTITIES.has(entity)) {
    return `/contract-manager?view=${entity}`;
  }
  if (
    (storageModule === "requests" ||
      storageModule === "general-requests" ||
      storageModule === "oral-payment-requests") &&
    REQUESTS_STORAGE_ENTITIES.has(entity)
  ) {
    return `/${entity}?view=${entity}`;
  }
  return `/${storageModule}?view=${entity}`;
}

/** Full-page detail URL for any module record. */
export function hrefForRecordDetail(
  routeModule: string,
  entity: string,
  recordId: string,
): string {
  const storageForHref =
    routeModule === "receipts-payments"
      ? "banking"
      : routeModule === "contract-manager"
        ? "projects"
        : routeModule === "general-requests" || routeModule === "oral-payment-requests"
          ? "requests"
          : routeModule;
  const base = hrefForStoredEntity(storageForHref, entity);
  // Prefer the route module the user is browsing.
  const listHref =
    routeModule === "receipts-payments"
      ? `/receipts-payments?view=${entity}`
      : routeModule === "contract-manager"
        ? `/contract-manager?view=${entity}`
        : routeModule === "general-requests" || routeModule === "oral-payment-requests"
          ? `/${routeModule}?view=${entity}`
          : base.startsWith(`/${routeModule}`)
            ? base
            : `/${routeModule}?view=${entity}`;
  const sep = listHref.includes("?") ? "&" : "?";
  return `${listHref}${sep}id=${encodeURIComponent(recordId)}`;
}

/**
 * Deep-link into a module list filtered to a document reference or id.
 * The `open` query param additionally auto-opens that record's detail view,
 * so origin links land straight on the original document (e.g. the sale).
 */
export function hrefForSourceDocument(
  storageModule: string,
  entity: string,
  query?: string,
): string {
  const base = hrefForStoredEntity(storageModule, entity);
  const q = (query || "").trim();
  if (!q) return base;
  const sep = base.includes("?") ? "&" : "?";
  const encoded = encodeURIComponent(q);
  // Prefer dedicated detail page when the value looks like a record id.
  if (/^[0-9a-f-]{8,}$/i.test(q) || q.length >= 20) {
    return `${base}${sep}id=${encoded}`;
  }
  return `${base}${sep}q=${encoded}&open=${encoded}`;
}

/** Human label for an entity key shown on report origin links. */
export function labelForEntityKey(entityKey: string): string {
  return entityKey
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Clickable origin for a ledger posting. Returns null for synthetic / system journals
 * that are not stored as ordinary documents.
 */
export function originLinkForLedgerLine(line: {
  sourceModule?: string;
  sourceEntity?: string;
  sourceRecordId?: string;
  narration?: string;
}): { href: string; label: string; entityLabel: string } | null {
  const moduleSlug = (line.sourceModule || "").trim();
  const entity = (line.sourceEntity || "").trim();
  const recordId = (line.sourceRecordId || "").trim();
  if (!moduleSlug || !entity) return null;
  if (
    /^(year-end|fx-|fv-|ifrs15-|dispose-|rev-|opening-)/i.test(recordId) ||
    /^(opening-balances|fair-value|year-end)/i.test(entity)
  ) {
    return null;
  }
  const narration = (line.narration || "").trim();
  const label = narration || recordId.slice(0, 12) || labelForEntityKey(entity);
  return {
    href: hrefForSourceDocument(moduleSlug, entity, narration || recordId),
    label,
    entityLabel: labelForEntityKey(entity),
  };
}

/** Route slug for enabled-tab checks when reading from a storage bucket. */
export function routeSlugForStoredEntity(storageModule: string, entity: string): ModuleSlug | string {
  if (storageModule === "banking" && RECEIPTS_PAYMENTS_STORAGE_ENTITIES.has(entity)) {
    return "receipts-payments";
  }
  if (storageModule === "projects" && CONTRACT_MANAGER_STORAGE_ENTITIES.has(entity)) {
    return "contract-manager";
  }
  if (storageModule === "requests" && entity === "general-requests") {
    return "general-requests";
  }
  if (storageModule === "requests" && entity === "oral-payment-requests") {
    return "oral-payment-requests";
  }
  return storageModule;
}

function cols(...labels: [string, string][]): ModuleColumn[] {
  return labels.map(([key, label]) => ({ key, label }));
}

/** Static module metadata only — no demo figures or seed rows. KPIs are computed live. */
export const moduleConfigs: Record<ModuleSlug, ModuleConfig> = {
  banking: {
    slug: "banking",
    label: "Banking",
    description:
      "Create real bank accounts (e.g. Stanbic Current) linked to Chart of Accounts (e.g. Bank-UGX), then use them on receipts, payments, statements, and reconciliations.",
    tableTitle: "Bank & Cash Accounts",
    kpis: [],
    columns: cols(
      ["name", "Account"],
      ["bank", "Institution"],
      ["type", "Type"],
      ["balance", "Balance"],
      ["status", "Status"],
    ),
    rows: [],
  },
  "receipts-payments": {
    slug: "receipts-payments",
    // Receipts and payments post against bank & cash accounts, so they stay in the
    // banking records bucket even though they have their own module.
    storageSlug: "banking",
    label: "Receipts & Payments",
    description:
      "Money in and money out — receipts, payments, and the rules that categorise them automatically.",
    tableTitle: "Receipts",
    kpis: [],
    columns: cols(
      ["reference", "Reference"],
      ["date", "Date"],
      ["party", "Party"],
      ["amount", "Amount"],
      ["status", "Status"],
    ),
    rows: [],
  },
  "expense-claims": {
    slug: "expense-claims",
    label: "Expense Claims",
    description:
      "Expense claim payers and claims paid with personal funds or allowance rates.",
    tableTitle: "Expense Claims",
    kpis: [],
    columns: cols(
      ["name", "Claim"],
      ["employee", "Claimant"],
      ["amount", "Amount"],
      ["category", "Category"],
      ["status", "Status"],
    ),
    rows: [],
  },
  requests: {
    slug: "requests",
    label: "Requests",
    description:
      "Legacy combined requests route — use General Requests or Oral Payment Requests.",
    tableTitle: "Requests",
    kpis: [],
    columns: cols(
      ["reference", "Reference"],
      ["requestedBy", "Requested by"],
      ["category", "Category"],
      ["subject", "Subject"],
      ["status", "Status"],
    ),
    rows: [],
  },
  "general-requests": {
    slug: "general-requests",
    label: "General Requests",
    description:
      "General (non-project) requests — Requestor → Accounts Assistant → GM → CEO → Finance.",
    tableTitle: "General Requests",
    storageSlug: "requests",
    kpis: [],
    columns: cols(
      ["reference", "Reference"],
      ["requestedBy", "Requested by"],
      ["department", "Department"],
      ["category", "Category"],
      ["subject", "Subject"],
      ["status", "Status"],
    ),
    rows: [],
  },
  "oral-payment-requests": {
    slug: "oral-payment-requests",
    label: "Oral Payment Requests",
    description:
      "Oral payment requisitions — Requestor → Accounts Assistant → GM → CEO → Finance. Separate from project payment requests.",
    tableTitle: "Oral Payment Requests",
    storageSlug: "requests",
    kpis: [],
    columns: cols(
      ["reference", "Reference"],
      ["requestedBy", "Requested by"],
      ["department", "Department"],
      ["payee", "Payee"],
      ["amount", "Amount"],
      ["status", "Status"],
    ),
    rows: [],
  },
  sales: {
    slug: "sales",
    label: "Sales",
    description:
      "Customers, quotes, orders, invoices, credit notes, delivery notes, billable time & expenses, withholding tax, portals, and recurring invoices.",
    tableTitle: "Sales Invoices",
    kpis: [],
    columns: cols(
      ["name", "Document"],
      ["client", "Customer"],
      ["amount", "Amount"],
      ["status", "Status"],
      ["due", "Due date"],
    ),
    rows: [],
  },
  purchases: {
    slug: "purchases",
    label: "Purchases",
    description:
      "Suppliers, quotes, orders, invoices, debit notes, goods receipts, and recurring purchase invoices.",
    tableTitle: "Purchase Invoices",
    kpis: [],
    columns: cols(
      ["name", "Document"],
      ["vendor", "Supplier"],
      ["amount", "Amount"],
      ["status", "Status"],
      ["due", "Due date"],
    ),
    rows: [],
  },
  inventory: {
    slug: "inventory",
    label: "Inventory",
    description:
      "Inventory and coffee production from green-bean intake through roasting, quality release, packaging, stock, and accounting.",
    tableTitle: "Inventory",
    kpis: [],
    columns: cols(
      ["name", "Item"],
      ["sku", "SKU"],
      ["warehouse", "Location"],
      ["qty", "Qty"],
      ["status", "Status"],
    ),
    rows: [],
  },
  projects: {
    slug: "projects",
    label: "Project Manager",
    description:
      "New projects, updates, Gantt schedule, project managers, and all project requests (material, payment/IPC, equipment & vehicle, document), plus work programs and variations.",
    tableTitle: "New Project",
    kpis: [],
    columns: cols(
      ["name", "Project"],
      ["contractor", "Contractor"],
      ["budget", "Contract value"],
      ["manager", "Project manager"],
      ["siteEngineer", "Site engineer"],
      ["status", "Status"],
    ),
    rows: [],
  },
  "contract-manager": {
    slug: "contract-manager",
    // Contractor master data and ledgers stay in the projects records bucket.
    storageSlug: "projects",
    label: "Contract Manager",
    description:
      "For contractors managing contracts under a Project Manager — directory, invoices, and ledgers.",
    tableTitle: "Contractors",
    kpis: [],
    columns: cols(
      ["name", "Contact"],
      ["company", "Company"],
      ["trade", "Trade"],
      ["type", "Type"],
      ["status", "Status"],
    ),
    rows: [],
  },
  fleet: {
    slug: "fleet",
    label: "Fleet",
    description:
      "Vehicles, drivers, fuel, trips, maintenance, service reminders, and fleet cost reporting with ledger posting.",
    tableTitle: "Vehicles",
    kpis: [],
    columns: cols(
      ["name", "Vehicle"],
      ["registration", "Plate"],
      ["driver", "Driver"],
      ["status", "Status"],
    ),
    rows: [],
  },
  security: {
    slug: "security",
    label: "Security",
    description:
      "Gate passes, visitor passes, and security incidents at the site.",
    tableTitle: "Gate Passes",
    kpis: [],
    columns: cols(
      ["reference", "Pass"],
      ["date", "Date"],
      ["person", "Person / vehicle"],
      ["purpose", "Purpose"],
      ["status", "Status"],
    ),
    rows: [],
  },
  crm: {
    slug: "crm",
    label: "CRM",
    description:
      "Leads, opportunities, contacts, follow-up activities, and customer complaints — linked to Sales customers.",
    tableTitle: "Leads",
    kpis: [],
    columns: cols(
      ["name", "Lead"],
      ["company", "Company"],
      ["stage", "Stage"],
      ["owner", "Owner"],
      ["status", "Status"],
    ),
    rows: [],
  },
  logistics: {
    slug: "logistics",
    label: "Logistics",
    description:
      "Shipments, dispatch, routes, carriers, and proof of delivery — linked to Fleet vehicles and drivers.",
    tableTitle: "Shipments",
    kpis: [],
    columns: cols(
      ["reference", "Shipment"],
      ["customer", "Customer"],
      ["vehicle", "Vehicle"],
      ["status", "Status"],
    ),
    rows: [],
  },
  distribution: {
    slug: "distribution",
    label: "Distribution",
    description:
      "Order fulfillment from warehouse to customer — allocation, pick, pack, delivery runs, and returns.",
    tableTitle: "Distribution Orders",
    kpis: [],
    columns: cols(
      ["reference", "Order"],
      ["customer", "Customer"],
      ["warehouse", "Warehouse"],
      ["status", "Status"],
    ),
    rows: [],
  },
  rnd: {
    slug: "rnd",
    label: "R&D",
    description:
      "Research and development — experiments, formulations, sensory panels, specs, pilots, costing, and AI-assisted results.",
    tableTitle: "Experiments",
    kpis: [],
    columns: cols(
      ["reference", "Experiment"],
      ["product", "Product"],
      ["hypothesis", "Hypothesis"],
      ["result", "Result"],
      ["status", "Status"],
    ),
    rows: [],
  },
  lab: {
    slug: "lab",
    label: "Lab",
    description:
      "Laboratory operations — samples, trials, methods, calibrations, results, stability studies, and ML product-development simulations.",
    tableTitle: "Lab Trials",
    kpis: [],
    columns: cols(
      ["reference", "Trial"],
      ["product", "Product"],
      ["method", "Method"],
      ["result", "Result"],
      ["status", "Status"],
    ),
    rows: [],
  },
  qa: {
    slug: "qa",
    label: "Quality Assurance",
    description:
      "Incoming inspection, in-process checks, quality holds, release decisions, non-conformances, and CAPA for coffee and product production.",
    tableTitle: "Quality Checks",
    kpis: [],
    columns: cols(
      ["reference", "Check"],
      ["batch", "Batch"],
      ["result", "Result"],
      ["status", "Disposition"],
    ),
    rows: [],
  },
  production: {
    slug: "production",
    label: "Maintenance",
    description:
      "Machinery maintenance — the machine register, work orders, preventive schedules, spare parts, downtime, and job cards.",
    tableTitle: "Machines",
    kpis: [],
    columns: cols(
      ["name", "Machine"],
      ["code", "Asset code"],
      ["location", "Site"],
      ["status", "Status"],
    ),
    rows: [],
  },
  benchmark: {
    slug: "benchmark",
    label: "Work Systems",
    description:
      "Benchmark work systems — define systems, run studies, track KPIs, cycle time, productivity, gaps, and improvement actions.",
    tableTitle: "Benchmark Studies",
    kpis: [],
    columns: cols(
      ["reference", "Study"],
      ["workSystem", "Work system"],
      ["score", "Score"],
      ["status", "Status"],
    ),
    rows: [],
  },
  pos: {
    slug: "pos",
    label: "POS",
    description:
      "Point-of-sale terminal — walk-in sales, register sessions, and daily cash reconciliation.",
    tableTitle: "POS Terminal",
    kpis: [],
    columns: cols(
      ["reference", "Sale"],
      ["date", "Date"],
      ["register", "Register"],
      ["amount", "Amount"],
      ["status", "Status"],
    ),
    rows: [],
  },
  payroll: {
    slug: "payroll",
    label: "HR & Payroll",
    description:
      "Employee records, attendance, leave, and payroll runs.",
    tableTitle: "Employees",
    kpis: [],
    columns: cols(
      ["name", "Employee"],
      ["dept", "Department"],
      ["role", "Role"],
      ["pay", "Net pay"],
      ["status", "Status"],
    ),
    rows: [],
  },
  investments: {
    slug: "investments",
    label: "Investments",
    description:
      "Marketable securities — shares, bonds, mutual funds — book values and quantities.",
    tableTitle: "Investments",
    kpis: [],
    columns: cols(
      ["name", "Security"],
      ["type", "Type"],
      ["qty", "Qty"],
      ["book", "Book value"],
      ["status", "Status"],
    ),
    rows: [],
  },
  assets: {
    slug: "assets",
    label: "Fixed Assets",
    description:
      "Capitalized tangible & intangible assets, depreciation, and amortization entries.",
    tableTitle: "Fixed Assets",
    kpis: [],
    columns: cols(
      ["name", "Asset"],
      ["category", "Asset category"],
      ["cost", "Cost"],
      ["book", "Book value"],
      ["status", "Status"],
    ),
    rows: [],
  },
  capital: {
    slug: "capital",
    label: "Capital Accounts",
    description:
      "Partners, owners, directors, and capital subaccounts for drawings and contributions.",
    tableTitle: "Capital Accounts",
    kpis: [],
    columns: cols(
      ["name", "Member"],
      ["role", "Role"],
      ["capital", "Capital"],
      ["drawings", "Drawings"],
      ["status", "Status"],
    ),
    rows: [],
  },
  accounts: {
    slug: "accounts",
    label: "Accounts",
    description:
      "Chart of accounts, control accounts, special accounts, journals, recurring journals, and trial balance.",
    tableTitle: "Chart of Accounts",
    kpis: [],
    columns: cols(
      ["name", "Account"],
      ["code", "Code"],
      ["type", "Type"],
      ["balance", "Balance"],
      ["status", "Status"],
    ),
    rows: [],
  },
  documents: {
    slug: "documents",
    label: "Documents",
    description:
      "Folders, attachments, History, and Deleted Records — audit trail of create, update, delete, and who did it.",
    tableTitle: "Folders & Attachments",
    kpis: [],
    columns: cols(
      ["name", "Name"],
      ["folder", "Folder"],
      ["linked", "Linked to"],
      ["when", "Uploaded"],
      ["status", "Status"],
    ),
    rows: [],
  },
  reports: {
    slug: "reports",
    label: "Reports",
    description:
      "Balance Sheet, P&L, Trial Balance, aged AR/AP, statements, tax and inventory value summaries.",
    tableTitle: "Saved Reports",
    kpis: [],
    columns: cols(
      ["name", "Report"],
      ["type", "Type"],
      ["period", "Period"],
      ["owner", "Owner"],
      ["status", "Status"],
    ),
    rows: [],
  },
};

/** Nav structure mirroring Manager tab groups */
export const NAV_MODULES: {
  slug: ModuleSlug;
  label: string;
  href: string;
  items: string[];
}[] = [
  {
    slug: "banking",
    label: "Banking",
    href: "/banking",
    items: [
      "Bank & Cash Accounts",
      "Inter Account Transfers",
      "Bank Statements",
      "Reconciliations",
    ],
  },
  {
    slug: "receipts-payments",
    label: "Receipts & Payments",
    href: "/receipts-payments",
    items: ["Receipts", "Payments", "Receipt Rules", "Payment Rules"],
  },
  {
    slug: "expense-claims",
    label: "Expense Claims",
    href: "/expense-claims",
    items: ["Expense Claim Payers", "Expense Claims"],
  },
  {
    slug: "general-requests",
    label: "General Requests",
    href: "/general-requests",
    items: ["General Requests"],
  },
  {
    slug: "oral-payment-requests",
    label: "Oral Payment Requests",
    href: "/oral-payment-requests",
    items: ["Oral Payment Requests"],
  },
  {
    slug: "sales",
    label: "Sales",
    href: "/sales",
    items: [
      "Customers",
      "Customer Ledgers",
      "Sales Quotes",
      "Sales Orders",
      "Sales Invoices",
      "Credit Notes",
      "Late Payment Fees",
      "Delivery Notes",
      "Billable Time",
      "Billable Expenses",
      "Withholding Tax Receipts",
      "Customer Portals",
      "Recurring Sales Invoices",
      "Revenue Contracts",
    ],
  },
  {
    slug: "purchases",
    label: "Purchases",
    href: "/purchases",
    items: [
      "Suppliers",
      "Supplier Ledgers",
      "Purchase Quotes",
      "Purchase Orders",
      "Purchase Invoices",
      "Debit Notes",
      "Goods Receipts",
      "Recurring Purchase Invoices",
      "Withholding Tax",
    ],
  },
  {
    slug: "inventory",
    label: "Inventory",
    href: "/inventory",
    items: [
      "Inventory Items",
      "Non-inventory Items",
      "Inventory Kits",
      "Stock In",
      "Inventory Transfers",
      "Warehouses & Locations",
      "Inventory Write-offs",
      "Inventory Sales",
      "Green Bean Intakes",
      "Production Orders",
      "Roast Batches",
      "Quality Checks",
      "Packaging Runs",
      "Stocktakes",
      "Landed Costs",
    ],
  },
  {
    slug: "projects",
    label: "Project Manager",
    href: "/projects",
    items: [
      "New Project",
      "Project Updates",
      "Gantt Chart",
      "Project Managers",
      "Material Requests",
      "Payment Requests (IPC)",
      "Equipment & Vehicle Requests",
      "Document Requests",
      "Work Programs",
      "Variations of Work",
    ],
  },
  {
    slug: "contract-manager",
    label: "Contract Manager",
    href: "/contract-manager",
    items: ["Contractors", "Contractor Invoices", "Contractor Ledgers"],
  },
  {
    slug: "fleet",
    label: "Fleet",
    href: "/fleet",
    items: [
      "Vehicles",
      "Drivers",
      "Fuel Requests",
      "Fuel Logs",
      "Trip Requests",
      "Maintenance Requests",
      "Service Reminders",
      "Fleet Cost Report",
    ],
  },
  {
    slug: "security",
    label: "Security",
    href: "/security",
    items: ["Gate Passes", "Visitor Passes", "Security Incidents"],
  },
  {
    slug: "crm",
    label: "CRM",
    href: "/crm",
    items: [
      "Leads",
      "Opportunities",
      "Contacts",
      "Follow-ups",
      "Complaints",
    ],
  },
  {
    slug: "logistics",
    label: "Logistics",
    href: "/logistics",
    items: [
      "Shipments",
      "Dispatch Board",
      "Routes",
      "Proof of Delivery",
      "Carriers",
    ],
  },
  {
    slug: "distribution",
    label: "Distribution",
    href: "/distribution",
    items: [
      "Distribution Orders",
      "Picking Lists",
      "Packing Lists",
      "Delivery Runs",
      "Stock Allocations",
      "Distribution Returns",
    ],
  },
  {
    slug: "rnd",
    label: "R&D",
    href: "/rnd",
    items: [
      "Experiments",
      "Formulations",
      "Sensory Panels",
      "Spec Sheets",
      "Pilot Batches",
      "Cost Models",
      "AI Insights",
    ],
  },
  {
    slug: "lab",
    label: "Lab",
    href: "/lab",
    items: [
      "Product Simulations",
      "Lab Requests",
      "Lab Samples",
      "Lab Trials",
      "Lab Methods",
      "Instrument Calibrations",
      "Lab Results",
      "Stability Studies",
    ],
  },
  {
    slug: "qa",
    label: "Quality Assurance",
    href: "/qa",
    items: [
      "Quality Checks",
      "Incoming Inspections",
      "In-process Checks",
      "Release Decisions",
      "Non-conformances",
      "CAPA Actions",
      "Hold & Release Log",
    ],
  },
  {
    slug: "production",
    label: "Maintenance",
    href: "/production",
    items: [
      "Machines",
      "Work Orders",
      "Preventive Schedules",
      "Spare Parts",
      "Downtime",
      "Job Cards",
    ],
  },
  {
    slug: "benchmark",
    label: "Work Systems",
    href: "/benchmark",
    items: [
      "Work Systems",
      "Benchmark Studies",
      "KPI Definitions",
      "Cycle Time Studies",
      "Productivity Scores",
      "Gap Analyses",
      "Improvement Actions",
    ],
  },
  {
    slug: "pos",
    label: "POS",
    href: "/pos",
    items: [
      "POS Terminal",
      "POS Locations",
      "POS Products",
      "POS Services",
      "POS Stock In",
      "Registers",
      "Cash Sessions",
      "Dining Tables",
      "Open Tickets",
      "POS Sales",
      "POS Returns",
      "Daily Closings",
    ],
  },
  {
    slug: "payroll",
    label: "HR & Payroll",
    href: "/payroll",
    items: [
      "Employees",
      "Departments",
      "Sites",
      "Blocks",
      "Attendance",
      "Leave Requests",
      "Holidays",
      "Job Positions",
      "Onboarding",
      "Create Payroll",
      "Payroll Runs",
      "Payslip Items",
      "Payslips",
      "Recurring Payslips",
      "Statutory Remittances",
    ],
  },
  {
    slug: "investments",
    label: "Investments",
    href: "/investments",
    items: ["Investments"],
  },
  {
    slug: "assets",
    label: "Fixed Assets",
    href: "/assets",
    items: [
      "Fixed Assets",
      "Depreciation Entries",
      "Intangible Assets",
      "Amortization Entries",
      "Leases",
    ],
  },
  {
    slug: "capital",
    label: "Capital Accounts",
    href: "/capital",
    items: ["Capital Accounts", "Capital Subaccounts", "Share-based Payments"],
  },
  {
    slug: "accounts",
    label: "Accounts",
    href: "/accounts",
    items: [
      "Chart of Accounts",
      "Control Accounts",
      "Special Accounts",
      "Journal Entries",
      "Recurring Journal Entries",
      "Matching Entries",
      "Provisions",
      "Ledgers",
      "Trial Balance",
    ],
  },
  {
    slug: "documents",
    label: "Documents",
    href: "/documents",
    items: ["Folders", "Attachments", "History", "Deleted Records"],
  },
  {
    slug: "reports",
    label: "Reports",
    href: "/reports?view=balance-sheet",
    items: [
      "Balance Sheet",
      "Profit & Loss",
      "Accounting Operations",
      "Management Analysis",
      "Profit & Loss by Class",
      "Division Exception Report",
      "Cash Flow",
      "Cash Flow Indirect",
      "Trial Balance",
      "Ledgers",
      "Statement of Changes in Equity",
      "Other Comprehensive Income",
      "Budget vs Actual",
      "Forecast P&L",
      "Notes to Financial Statements",
      "Control Account Reconciliation",
      "Bank Reconciliation",
      "Integrity Tests",
      "Field Audit Log",
      "Aged Receivables",
      "Aged Payables",
      "Customer Statements",
      "Supplier Statements",
      "Tax Summary",
      "Inventory Value Summary",
    ],
  },
];
