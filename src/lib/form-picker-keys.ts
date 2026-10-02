/**
 * Master lists SearchablePickers need in memory before deferred catalog hydrate.
 * Kept separate from sync.ts / manager-settings so priority boot can import
 * without a circular init (manager-settings → sync → form-picker-keys).
 */

export type FormPickerRecordKey = { module: string; entity: string };

const ALWAYS: FormPickerRecordKey[] = [
  { module: "accounts", entity: "chart-of-accounts" },
  { module: "banking", entity: "bank-and-cash-accounts" },
  { module: "purchases", entity: "suppliers" },
  { module: "projects", entity: "contractors" },
  { module: "sales", entity: "customers" },
];

const BY_ENTITY: Record<string, FormPickerRecordKey[]> = {
  receipts: [
    { module: "sales", entity: "sales-invoices" },
    { module: "sales", entity: "invoices" },
    { module: "sales", entity: "late-payment-fees" },
    { module: "sales", entity: "customers" },
  ],
  payments: [
    { module: "purchases", entity: "purchase-invoices" },
    { module: "purchases", entity: "bills" },
    { module: "purchases", entity: "suppliers" },
    { module: "projects", entity: "contractors" },
  ],
  "purchase-invoices": [
    { module: "purchases", entity: "suppliers" },
    { module: "projects", entity: "contractors" },
    { module: "inventory", entity: "inventory-items" },
    { module: "inventory", entity: "non-inventory-items" },
  ],
  "contractor-invoices": [
    { module: "projects", entity: "contractors" },
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "phases" },
    { module: "projects", entity: "activities" },
    { module: "purchases", entity: "suppliers" },
  ],
  bills: [
    { module: "purchases", entity: "suppliers" },
    { module: "projects", entity: "contractors" },
    { module: "inventory", entity: "inventory-items" },
  ],
  "debit-notes": [
    { module: "purchases", entity: "suppliers" },
    { module: "projects", entity: "contractors" },
    { module: "purchases", entity: "purchase-invoices" },
    { module: "purchases", entity: "bills" },
  ],
  "sales-invoices": [
    { module: "sales", entity: "customers" },
    { module: "inventory", entity: "inventory-items" },
    { module: "inventory", entity: "non-inventory-items" },
  ],
  invoices: [
    { module: "sales", entity: "customers" },
    { module: "inventory", entity: "inventory-items" },
  ],
  "credit-notes": [
    { module: "sales", entity: "customers" },
    { module: "sales", entity: "sales-invoices" },
  ],
  "delivery-notes": [{ module: "sales", entity: "customers" }],
  quotes: [{ module: "sales", entity: "customers" }],
  orders: [{ module: "sales", entity: "customers" }],
  "purchase-orders": [
    { module: "purchases", entity: "suppliers" },
    { module: "projects", entity: "contractors" },
  ],
  "goods-receipts": [
    { module: "purchases", entity: "suppliers" },
    { module: "inventory", entity: "inventory-items" },
    { module: "inventory", entity: "inventory-locations" },
  ],
  payslips: [
    { module: "payroll", entity: "employees" },
    { module: "payroll", entity: "departments" },
  ],
  employees: [{ module: "payroll", entity: "departments" }],
  "fuel-requests": [
    { module: "assets", entity: "fixed-assets" },
    { module: "fleet", entity: "vehicles" },
    { module: "fleet", entity: "drivers" },
  ],
  "fuel-logs": [
    { module: "assets", entity: "fixed-assets" },
    { module: "fleet", entity: "vehicles" },
    { module: "fleet", entity: "drivers" },
  ],
  "trip-requests": [
    { module: "assets", entity: "fixed-assets" },
    { module: "fleet", entity: "vehicles" },
    { module: "fleet", entity: "drivers" },
  ],
  "maintenance-requests": [
    { module: "assets", entity: "fixed-assets" },
    { module: "fleet", entity: "vehicles" },
  ],
  vehicles: [{ module: "assets", entity: "fixed-assets" }],
  "gate-passes": [
    { module: "payroll", entity: "employees" },
    { module: "payroll", entity: "departments" },
    { module: "fleet", entity: "vehicles" },
    { module: "fleet", entity: "drivers" },
  ],
  "visitor-passes": [
    { module: "payroll", entity: "employees" },
    { module: "payroll", entity: "departments" },
  ],
  "security-incidents": [
    { module: "payroll", entity: "employees" },
    { module: "payroll", entity: "departments" },
    { module: "fleet", entity: "vehicles" },
  ],
  "stock-in": [
    { module: "inventory", entity: "inventory-items" },
    { module: "inventory", entity: "inventory-locations" },
  ],
  "stock-out": [
    { module: "inventory", entity: "inventory-items" },
    { module: "inventory", entity: "inventory-locations" },
  ],
  "stock-transfers": [
    { module: "inventory", entity: "inventory-items" },
    { module: "inventory", entity: "inventory-locations" },
  ],
  "inventory-writes": [
    { module: "inventory", entity: "inventory-items" },
    { module: "inventory", entity: "inventory-locations" },
  ],
  "pos-stock-in": [
    { module: "pos", entity: "pos-products" },
    { module: "pos", entity: "pos-locations" },
  ],
  "pos-sales": [
    { module: "pos", entity: "pos-products" },
    { module: "pos", entity: "pos-locations" },
  ],
  "payment-requests": [
    { module: "projects", entity: "contractors" },
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "project-managers" },
    { module: "purchases", entity: "suppliers" },
    { module: "payroll", entity: "employees" },
  ],
  "oral-payment-requests": [
    { module: "projects", entity: "contractors" },
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "project-managers" },
    { module: "purchases", entity: "suppliers" },
    { module: "payroll", entity: "employees" },
  ],
  "general-requests": [
    { module: "projects", entity: "contractors" },
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "project-managers" },
    { module: "purchases", entity: "suppliers" },
    { module: "payroll", entity: "employees" },
  ],
  requisitions: [
    { module: "projects", entity: "contractors" },
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "project-managers" },
    { module: "purchases", entity: "suppliers" },
    { module: "payroll", entity: "employees" },
  ],
  "project-updates": [
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "phases" },
    { module: "projects", entity: "activities" },
    { module: "projects", entity: "project-managers" },
  ],
  "equipment-and-vehicle-requests": [
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "phases" },
    { module: "fleet", entity: "vehicles" },
    { module: "payroll", entity: "employees" },
  ],
  "document-requests": [
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "phases" },
    { module: "payroll", entity: "employees" },
  ],
  "work-programs": [
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "phases" },
    { module: "projects", entity: "activities" },
  ],
  "variations-of-work": [
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "phases" },
    { module: "projects", entity: "activities" },
    { module: "projects", entity: "contractors" },
  ],
  "production-plans": [{ module: "production", entity: "work-centers" }],
  "production-orders": [{ module: "production", entity: "work-centers" }],
  "batch-records": [{ module: "production", entity: "work-centers" }],
  "roast-batches": [{ module: "production", entity: "work-centers" }],
  "packaging-runs": [{ module: "production", entity: "work-centers" }],
  "downtime-logs": [{ module: "production", entity: "work-centers" }],
  "project-managers": [
    { module: "projects", entity: "contractors" },
  ],
  projects: [
    { module: "projects", entity: "contractors" },
    { module: "projects", entity: "project-managers" },
    { module: "projects", entity: "phases" },
    { module: "projects", entity: "activities" },
  ],
  contractors: [],

  "inter-account-transfers": [
    { module: "banking", entity: "bank-and-cash-accounts" },
  ],
  "bank-and-cash-accounts": [
    { module: "accounts", entity: "chart-of-accounts" },
    // Live closing balance = opening + receipts − payments (needs these in memory).
    { module: "banking", entity: "receipts" },
    { module: "banking", entity: "payments" },
  ],
  "journal-entries": [{ module: "accounts", entity: "chart-of-accounts" }],
};

/** AppSetting keys hydrators need — literals avoid importing manager-settings. */
export const FORM_PICKER_SETTINGS_KEYS = [
  "financeiag-divisions",
  "financeiag-tax-codes",
  "financeiag-exchange-rates",
  "financeiag-foreign-currencies",
  "financeiag-supplier-categories",
  "financeiag-request-email-contacts",
] as const;

function uniqueKeys(keys: FormPickerRecordKey[]): FormPickerRecordKey[] {
  const seen = new Set<string>();
  const out: FormPickerRecordKey[] = [];
  for (const row of keys) {
    const id = `${row.module}:${row.entity}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

/** Record collections a form's pickers need in memory. */
export function formPickerRecordKeys(entityKey?: string): FormPickerRecordKey[] {
  const extra = entityKey ? BY_ENTITY[entityKey] || [] : [];
  return uniqueKeys([...ALWAYS, ...extra]);
}
