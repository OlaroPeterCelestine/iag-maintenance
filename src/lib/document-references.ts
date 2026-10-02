import { entityKey, type ManagerRecord } from "@/lib/manager-entities";
import {
  FORM_DEFAULTS_KEY,
  defaultFormDefaults,
  loadList,
} from "@/lib/manager-settings";

/**
 * Fallback prefixes when Settings → Form defaults has no row for the form.
 * Covers documents (`reference`) and master data (`code`).
 */
const FALLBACK_PREFIXES: Record<string, string> = {
  // Sales
  "sales-invoices": "INV-",
  invoices: "INV-",
  "sales-orders": "SO-",
  "sales-quotes": "SQ-",
  "credit-notes": "CN-",
  "late-payment-fees": "LPF-",
  "delivery-notes": "DN-",
  "billable-time": "BT-",
  "billable-expenses": "BEXP-",
  "withholding-tax-receipts": "WTR-",
  "recurring-sales-invoices": "RSI-",
  "revenue-contracts": "RC-",
  customers: "CUS-",

  // Purchases
  "purchase-invoices": "BILL-",
  bills: "BILL-",
  "purchase-orders": "PO-",
  "purchase-quotes": "PQ-",
  "debit-notes": "DN-",
  "goods-receipts": "GRN-",
  "recurring-purchase-invoices": "RPI-",
  "withholding-tax": "WHT-",
  suppliers: "SUP-",

  // Banking / cash
  receipts: "REC-",
  payments: "PAY-",
  "inter-account-transfers": "XFR-",
  "bank-statements": "BST-",
  reconciliations: "BR-",
  "bank-and-cash-accounts": "BANK-",
  "bank-accounts": "BANK-",
  "cash-accounts": "CASH-",

  // Inventory
  "inventory-items": "SKU-",
  "inventory-kits": "KIT-",
  "non-inventory-items": "SVC-",
  "inventory-locations": "LOC-",
  "inventory-transfers": "TR-",
  "inventory-write-offs": "WO-",
  "stock-in": "SIN-",
  "inventory-sales": "IS-",
  "green-bean-intakes": "GBI-",
  "production-orders": "PRD-",
  "roast-batches": "RBT-",
  "quality-checks": "QC-",
  "packaging-runs": "PKG-",
  stocktakes: "STK-",
  "landed-costs": "LC-",

  // R&D
  experiments: "EXP-",
  formulations: "FRM-",
  "sensory-panels": "SEN-",
  "spec-sheets": "SPEC-",
  "pilot-batches": "PIL-",
  "cost-models": "COST-",
  "ai-insights": "AI-",

  // Lab
  "lab-requests": "LRQ-",
  "lab-samples": "LSM-",
  "lab-trials": "LTR-",
  "lab-methods": "LM-",
  "instrument-calibrations": "CAL-",
  "lab-results": "LRS-",
  "stability-studies": "STB-",

  // Quality Assurance
  "incoming-inspections": "INC-",
  "in-process-checks": "IPR-",
  "release-decisions": "REL-",
  "non-conformances": "NCR-",
  "capa-actions": "CAPA-",
  "hold-and-release-log": "HLD-",

  // Production
  "production-plans": "PPL-",
  "work-centers": "WC-",
  "bill-of-materials": "BOM-",
  "batch-records": "BREC-",
  "downtime-logs": "DT-",
  "yield-reports": "YLD-",

  // Work systems / benchmark
  "work-systems": "WSYS-",
  "benchmark-studies": "BM-",
  "kpi-definitions": "KPI-",
  "cycle-time-studies": "CTS-",
  "productivity-scores": "PSCORE-",
  "gap-analyses": "GAP-",
  "improvement-actions": "IMP-",

  // Projects / payroll / investments / POS
  projects: "PRJ-",
  "project-managers": "PM-",
  contractors: "CTR-",
  phases: "PH-",
  activities: "ACT-",
  tasks: "TASK-",
  "sub-activities": "SACT-",
  milestones: "MS-",
  risks: "RISK-",
  "procurement-list": "PROC-",
  requirements: "REQM-",
  requisitions: "MREQ-",
  "general-requests": "GREQ-",
  "oral-payment-requests": "ORAL-",
  "payment-requests": "IPC-",
  "progress-certificates": "PCERT-",
  "time-entries": "TE-",
  "project-expenses": "PEXP-",
  "project-billings": "PBILL-",
  "contractor-invoices": "CINV-",
  "project-updates": "PUPD-",
  "equipment-and-vehicle-requests": "EVR-",
  "document-requests": "DREQ-",
  "work-programs": "WPRG-",
  "variations-of-work": "VAR-",
  vehicles: "VEH-",
  drivers: "DRV-",
  "fuel-requests": "FREQ-",
  "fuel-logs": "FUEL-",
  "trip-requests": "TRIP-",
  "maintenance-requests": "MNT-",
  leads: "LEAD-",
  opportunities: "OPP-",
  contacts: "CONT-",
  "follow-ups": "FU-",
  complaints: "CMP-",
  shipments: "SHP-",
  "dispatch-board": "DSP-",
  routes: "RTE-",
  "proof-of-delivery": "POD-",
  carriers: "CAR-",
  "distribution-orders": "DO-",
  "picking-lists": "PICK-",
  "packing-lists": "PACK-",
  "delivery-runs": "RUN-",
  "stock-allocations": "ALLOC-",
  "distribution-returns": "DRET-",
  employees: "EMP-",
  departments: "DEPT-",
  payslips: "PAYSLIP-",
  "recurring-payslips": "RPAY-",
  "statutory-remittances": "SR-",
  "leave-requests": "LV-",
  "payroll-runs": "PRUN-",
  attendance: "ATT-",
  holidays: "HOL-",
  "job-positions": "JOB-",
  onboarding: "ONB-",
  investments: "INVST-",
  registers: "POSR-",
  "cash-sessions": "SESS-",
  "dining-tables": "TBL-",
  "open-tickets": "TAB-",
  "pos-locations": "POSL-",
  "pos-products": "POSP-",
  "pos-services": "POSS-",
  "pos-stock-in": "PSIN-",
  "pos-sales": "POS-",
  "pos-returns": "POSRtn-",
  "daily-closings": "CLOSE-",

  // Assets
  "fixed-assets": "FA-",
  "intangible-assets": "IA-",
  "depreciation-entries": "DEP-",
  "amortization-entries": "AMO-",
  leases: "LEASE-",

  // Capital / expense / journals
  "capital-accounts": "CAP-",
  "capital-subaccounts": "CSUB-",
  "special-accounts": "SPC-",
  "expense-claims": "EXP-",
  "expense-claim-payers": "ECP-",
  "journal-entries": "JE-",
  "recurring-journal-entries": "RJE-",
  "matching-entries": "ME-",
  "accruals-and-prepayments": "ACC-",
};

/**
 * Master-data entities whose `code` field is auto-numbered on create.
 * Chart of accounts is excluded — those codes are structural, not sequential.
 */
const AUTO_CODE_ENTITIES = new Set([
  "customers",
  "suppliers",
  "employees",
  "departments",
  "drivers",
  "vehicles",
  "fixed-assets",
  "intangible-assets",
  "inventory-items",
  "inventory-kits",
  "non-inventory-items",
  "inventory-locations",
  "pos-products",
  "pos-services",
  "pos-locations",
  "projects",
  "project-managers",
  "contractors",
  "phases",
  "activities",
  "tasks",
  "sub-activities",
  "milestones",
  "leads",
  "opportunities",
  "contacts",
  "routes",
  "carriers",
  "investments",
  "capital-accounts",
  "capital-subaccounts",
  "special-accounts",
  "bank-and-cash-accounts",
  "bank-accounts",
  "cash-accounts",
  "leases",
]);

export function isAutoCodedEntity(entityKeyValue: string): boolean {
  return AUTO_CODE_ENTITIES.has(entityKeyValue);
}

/** @deprecated Prefer isAutoCodedEntity */
export function isAutoCodedParty(entityKeyValue: string): boolean {
  return isAutoCodedEntity(entityKeyValue);
}

export function referencePrefixFor(entityKeyValue: string, entityLabel?: string): string {
  const defaults = loadList(FORM_DEFAULTS_KEY, defaultFormDefaults);
  const match = defaults.find((row) => {
    const typeKey = entityKey(row.formType || "");
    return (
      typeKey === entityKeyValue ||
      (entityLabel && row.formType.trim().toLowerCase() === entityLabel.trim().toLowerCase())
    );
  });
  const fromSettings = (match?.referencePrefix || "").trim();
  if (fromSettings) return fromSettings.endsWith("-") ? fromSettings : `${fromSettings}-`;
  return FALLBACK_PREFIXES[entityKeyValue] || "DOC-";
}

function sequenceFromValue(value: string, prefix: string): number {
  const raw = (value || "").trim();
  if (!raw) return 0;
  if (prefix && raw.toUpperCase().startsWith(prefix.toUpperCase())) {
    const tail = raw.slice(prefix.length).replace(/[^\d]/g, "");
    return Number.parseInt(tail, 10) || 0;
  }
  const digits = raw.match(/(\d+)\s*$/);
  return digits ? Number.parseInt(digits[1]!, 10) || 0 : 0;
}

function nextSequential(
  entityKeyValue: string,
  existing: ManagerRecord[],
  field: "reference" | "code",
  entityLabel?: string,
): string {
  const prefix = referencePrefixFor(entityKeyValue, entityLabel);
  let max = 0;
  for (const record of existing) {
    const seq = sequenceFromValue(record[field] || "", prefix);
    if (seq > max) max = seq;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** Next reference for a document entity, e.g. INV-0007. */
export function nextDocumentReference(
  entityKeyValue: string,
  existing: ManagerRecord[],
  entityLabel?: string,
): string {
  return nextSequential(entityKeyValue, existing, "reference", entityLabel);
}

/** Next code for master data, e.g. SUP-0003 / SKU-0012 / FA-0001. */
export function nextEntityCode(
  entityKeyValue: string,
  existing: ManagerRecord[],
  entityLabel?: string,
): string {
  return nextSequential(entityKeyValue, existing, "code", entityLabel);
}

/** @deprecated Prefer nextEntityCode */
export function nextPartyCode(
  entityKeyValue: string,
  existing: ManagerRecord[],
  entityLabel?: string,
): string {
  return nextEntityCode(entityKeyValue, existing, entityLabel);
}
