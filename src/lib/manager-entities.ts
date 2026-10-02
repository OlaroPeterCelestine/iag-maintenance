import { formatMoney, formatMoneyDual } from "@/lib/ledger/money";
import {
  baseCurrencyCode,
  convertBetween,
  isBaseCurrency,
  normalizeCurrency,
} from "@/lib/ledger/fx";
import { parseAmount } from "@/lib/ledger/types";
import { type ModuleSlug, NAV_MODULES } from "@/lib/module-data";

/** Form create/edit: only Draft→Submitted is writable via record save; desk advances the rest.
 *  Returned for Amendment is injected into the select when that is the current status. */
const FORM_SUBMIT_STATUS_OPTIONS = ["Draft", "Submitted"];
const FUEL_STATUS_OPTIONS = [...FORM_SUBMIT_STATUS_OPTIONS, "Fulfilled"];
const TRIP_MAINT_STATUS_OPTIONS = [...FORM_SUBMIT_STATUS_OPTIONS, "Completed"];
const EQUIPMENT_STATUS_OPTIONS = [...FORM_SUBMIT_STATUS_OPTIONS, "Issued", "Returned"];
const DOCUMENT_STATUS_OPTIONS = [...FORM_SUBMIT_STATUS_OPTIONS, "Provided"];

export type EntityField = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "email" | "textarea" | "select" | "attachments";
  required?: boolean;
  options?: string[];
  placeholder?: string;
  /** Shown when present (e.g. amendment / rejection feedback); not editable by requestors. */
  readOnly?: boolean;
};

/** Feedback from the approval desk — visible on the form when an approver amended or rejected. */
const REQUEST_CHAIN_FEEDBACK_FIELDS: EntityField[] = [
  {
    key: "amendmentReason",
    label: "Amendment comment",
    type: "textarea",
    readOnly: true,
    placeholder: "What the approver asked you to change before resubmitting.",
  },
  {
    key: "originalAmount",
    label: "Original amount (requestor)",
    type: "number",
    readOnly: true,
    placeholder: "Figure before amendment or revision.",
  },
  {
    key: "amountRevisionNote",
    label: "Amount revision note",
    type: "textarea",
    readOnly: true,
    placeholder: "Why the amount was revised.",
  },
  {
    key: "amendedBy",
    label: "Amended by",
    type: "text",
    readOnly: true,
  },
  {
    key: "amendedAt",
    label: "Amended on",
    type: "text",
    readOnly: true,
  },
  {
    key: "rejectionReason",
    label: "Rejection reason",
    type: "textarea",
    readOnly: true,
    placeholder: "Why this request was rejected.",
  },
  {
    key: "amendedReturnTo",
    label: "Returned to",
    type: "text",
    readOnly: true,
  },
  {
    key: "rejectedBy",
    label: "Rejected by",
    type: "text",
    readOnly: true,
  },
  {
    key: "rejectedAt",
    label: "Rejected on",
    type: "text",
    readOnly: true,
  },
];

function withRequestFeedbackFields(fields: EntityField[]): EntityField[] {
  const keys = new Set(fields.map((f) => f.key));
  const extras = REQUEST_CHAIN_FEEDBACK_FIELDS.filter((f) => !keys.has(f.key));
  return extras.length ? [...fields, ...extras] : fields;
}

export type ManagerRecord = Record<string, string> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

/** Cash / currency fields that should use comma grouping in form inputs. */
export const MONEY_INPUT_FIELD_KEYS = new Set([
  "amount",
  "total",
  "balance",
  "balanceDue",
  "amountPaid",
  "openingBalance",
  "debit",
  "credit",
  "creditLimit",
  "unitPrice",
  "unitCost",
  "unitValue",
  "cost",
  "otherCosts",
  "totalAcquisitionCost",
  "bookValue",
  "accumulatedDepreciation",
  "accumulatedAmortization",
  "purchasePrice",
  "salesPrice",
  "stockValue",
  "closingValue",
  "inventoryValue",
  "averageCost",
  "nonInventoryCost",
  "estimatedCost",
  "actualCost",
  "paymentAmount",
  "budget",
  "income",
  "spent",
  "amountImpact",
  "openingFloat",
  "expectedCash",
  "countedCash",
  "variance",
  "salesTotal",
  "returnsTotal",
  "netTotal",
  "cashTotal",
  "cardTotal",
  "mobileTotal",
  "statementBalance",
  "systemBalance",
  "discrepancy",
  "basicPay",
  "netPay",
  "earnings",
  "dailyRate",
  "adjustedBasic",
  "paye",
  "nssfEmployee",
  "nssfEmployer",
  "advances",
  "arrears",
  "deductions",
  "contributions",
  "latePaymentFees",
  "earlyPaymentAmount",
]);

export function isMoneyInputField(key: string) {
  return MONEY_INPUT_FIELD_KEYS.has(key);
}

export type EntityDefinition = {
  key: string;
  label: string;
  singular: string;
  fields: EntityField[];
  columns: string[];
};

export function entityKey(label: string) {
  const lower = label.toLowerCase();
  // Keep stable storage key when renaming the Locations tab.
  if (lower.includes("warehouse") && lower.includes("location")) {
    return "inventory-locations";
  }
  if (lower.includes("pos") && lower.includes("location")) {
    return "pos-locations";
  }
  // "New Project" tab keeps the projects store.
  if (lower === "new project" || lower === "new-project") {
    return "projects";
  }
  // Material Requests tab replaces Requisitions — same store.
  if (lower.includes("material request")) {
    return "requisitions";
  }
  // Machines tab keeps work-centers storage key.
  if (lower === "machines" || lower === "machine") {
    return "work-centers";
  }
  // Maintenance tabs. Work orders, PM templates and PM schedules are MES
  // collections with their own keys; Job Cards keep the batch-records key and
  // are the work-done record of an MES work order.
  if (lower === "work orders" || lower === "work-orders") {
    return "work-orders";
  }
  if (lower === "preventive schedules" || lower === "preventive-schedules") {
    return "pm-schedules";
  }
  if (lower === "pm templates" || lower === "pm-templates") {
    return "pm-templates";
  }
  if (lower === "downtime" || lower === "downtime-logs") {
    return "downtime-logs";
  }
  if (lower === "job cards" || lower === "job-cards") {
    return "batch-records";
  }
  // Payment Requests (IPC) keeps payment-requests storage key (not oral).
  if (lower.includes("payment request") && !lower.includes("oral")) {
    return "payment-requests";
  }
  return lower
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const text = (key: string, label: string, required = false): EntityField => ({
  key,
  label,
  required,
});
const number = (key: string, label: string, required = false): EntityField => ({
  key,
  label,
  type: "number",
  required,
});
const date = (key: string, label: string, required = false): EntityField => ({
  key,
  label,
  type: "date",
  required,
});
const select = (key: string, label: string, options: string[], required = false): EntityField => ({
  key,
  label,
  type: "select",
  options,
  required,
});

const status = select("status", "Status", ["Draft", "Active", "Pending", "Approved", "Paid", "Complete", "Inactive"], true);
const partyFields = (party: "Customer" | "Supplier" | "Employee"): EntityField[] => [
  text("name", `${party} name`, true),
  text("code", "Code", true),
  { key: "email", label: "Email", type: "email" },
  { key: "address", label: "Address", type: "textarea" },
  text("currency", "Currency", true),
  number("creditLimit", "Credit limit"),
  number("balance", "Balance"),
  status,
];
/** Supplier master — matches purchase register + party picker create fields. */
const supplierFields = (): EntityField[] => [
  text("name", "Name of supplier", true),
  text("code", "Code"),
  text("category", "Category"),
  text("contacts", "Contacts"),
  text("location", "Location"),
  { key: "email", label: "Email addresses", type: "email" },
  text("phone", "Phone"),
  { key: "address", label: "Address", type: "textarea" },
  text("currency", "Currency"),
  // Multi-currency opening balances are edited via SupplierOpeningBalancesFields
  // (JSON map in openingBalances + openingBalanceDate).
  date("openingBalanceDate", "Opening balance date"),
  text("openingBalances", "Opening balances"),
  number("creditLimit", "Credit limit"),
  number("balance", "Balance"),
  select("status", "Status", ["Active", "Inactive"], true),
  { key: "notes", label: "Notes", type: "textarea" },
];
const documentFields = (party: "Customer" | "Supplier"): EntityField[] => [
  text("reference", "Reference", true),
  date("date", "Issue date", true),
  date("dueDate", "Due date"),
  text("party", party, true),
  text("currency", "Currency", true),
  text("division", "Class / division"),
  { key: "description", label: "Description", type: "textarea" },
  text("tax", "Tax"),
  number("amount", "Total amount"),
  // Live columns — filled from receipts/payments, not entered on create.
  number("amountPaid", "Paid"),
  number("balanceDue", "Balance due"),
  status,
  {
    key: "attachments",
    label: "Attachments",
    type: "attachments",
    placeholder: "Invoice PDF / supporting documents",
  },
];
const moneyFields = (direction: "Receipt" | "Payment"): EntityField[] => [
  text("reference", "Reference", true),
  date("date", "Date", true),
  text("account", direction === "Receipt" ? "Received in" : "Paid from", true),
  text("party", direction === "Receipt" ? "Paid by" : "Payee"),
  text("currency", "Currency", true),
  // Amount sits high so it is not missed below Description on the create form.
  number("amount", "Amount", true),
  text("division", "Class / division"),
  text(
    "appliedTo",
    direction === "Receipt" ? "Apply to invoice" : "Apply to bill",
  ),
  { key: "description", label: "Description", type: "textarea" },
  text("postingAccount", "Posting account"),
  // Aliases / allocation JSON — stamped on save; hidden on the create form.
  text(
    direction === "Receipt" ? "depositTo" : "paidFrom",
    direction === "Receipt" ? "Deposit to (bank)" : "Paid from (bank)",
  ),
  text("bankAccount", "Bank / cash account"),
  { key: "allocations", label: "Allocations (JSON)", type: "textarea" },
  text("paymentMethod", "Payment method"),
  // Live column — Uncategorized vs allocated/posted.
  text("allocation", "Allocation"),
  select("clearance", "Clearance", ["Cleared", "Pending"], true),
  // Active posts to the ledger; Draft stays off the books until activated.
  select("status", "Status", ["Active", "Draft", "Void"], true),
];
const assetFields: EntityField[] = [
  text("name", "Asset name", true),
  text("code", "Code", true),
  text("category", "Asset category", true),
  date("acquired", "Acquisition date", true),
  text("currency", "Currency", true),
  select("entryType", "Entry type", ["Purchase", "Opening balance"], true),
  number("cost", "Acquisition cost", true),
  number("accumulatedAmortization", "Accumulated amortization (opening)"),
  text("paidFrom", "Paid from (bank / cash / AP)"),
  number("rate", "Annual rate %"),
  number("bookValue", "Book value"),
  status,
];

/** Fixed asset register — matches physical asset register columns. */
const fixedAssetFields: EntityField[] = [
  text("code", "Code", true),
  text("name", "Asset name", true),
  number("quantity", "Quantity", true),
  text("registrationNumber", "Reg. number"),
  text("serialModel", "Serial no. / model"),
  { key: "category", label: "Category / description", type: "textarea", required: true },
  text("group", "Group", true),
  text("location", "Location"),
  select(
    "physicalCondition",
    "Physical condition",
    ["New", "Good", "Fair", "Poor", "Damaged"],
    true,
  ),
  date("acquired", "Acquisition date", true),
  text("currency", "Currency", true),
  select(
    "entryType",
    "Entry type",
    ["Purchase", "Opening balance"],
    true,
  ),
  number("cost", "Acquisition cost", true),
  number(
    "otherCosts",
    "Other costs (tax, transport, clearing, demurrage, import duty, etc.)",
  ),
  number("totalAcquisitionCost", "Total acquisition cost"),
  number("accumulatedDepreciation", "Accumulated depreciation (opening)"),
  text("paidFrom", "Paid from (bank / cash / AP)"),
  select(
    "depreciationMethod",
    "Depreciation method",
    ["Straight line", "Reducing balance", "Units of production", "None"],
    true,
  ),
  number("rate", "Annual rate %"),
  number("usefulLifeYears", "Useful life (years)"),
  number("bookValue", "Book value"),
  // Active posts cost to the Balance Sheet (Fixed Asset); Draft stays off the books.
  select("status", "Status", ["Active", "Draft", "Inactive"], true),
];

/**
 * The maintenance tabs, all on iag-mes (see src/lib/iag/records/mes-maintenance.ts).
 *
 * Every select here is the vocabulary the MES column accepts, folded by the
 * adapter. `workCenter` is always the machine's asset tag — the picker writes
 * the tag, because MES joins work orders, downtime and PM schedules on it.
 */
function maintenanceFields(value: string): EntityField[] | null {
  if (value === "machines" || value === "machine") {
    return [
      text("name", "Machine", true),
      text("code", "Asset code", true),
      select(
        "type",
        "Type",
        ["Crusher", "Mill", "Generator", "Pump", "Conveyor", "Compressor", "Packaging line", "Other"],
        true,
      ),
      {
        key: "section",
        label: "Plant section (code)",
        placeholder: "The MES section code — set when the machine is registered",
      },
      text("location", "Site / location"),
      // mes_assets.criticality CHECK (A–D). Set on registration only.
      select("criticality", "Criticality", ["A — critical", "B — high", "C — medium", "D — low"]),
      // mes_assets.status CHECK. "Retired" takes a machine out of the pickers.
      select("status", "Status", ["Idle", "Running", "Down", "PM", "Maintenance", "Retired"], true),
      number("capacityPerHour", "Rated output per hour"),
      date("purchasedOn", "Purchased on"),
      text("supervisor", "Responsible technician"),
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "work orders" || value === "work-orders") {
    return [
      // Not `reference`: a form with a reference field gets a client-side
      // number at submit (DOC-0001), which would override MES's own WO-n.
      { key: "num", label: "Work order", readOnly: true, placeholder: "MES numbers it on save." },
      {
        key: "title",
        label: "Title",
        required: true,
        placeholder: "What is wrong, e.g. Huller bearing running hot.",
      },
      text("workCenter", "Machine", true),
      select("woType", "Type", ["Breakdown", "Corrective", "Preventive", "Inspection", "Overhaul"], true),
      // mes_work_orders.priority CHECK.
      select("priority", "Priority", ["Medium", "High", "Critical", "Low"], true),
      date("dueDate", "Due"),
      text("assignee", "Assigned technician"),
      // mes_work_orders.status CHECK. Completed goes through POST /complete,
      // which stamps completed_at and advances the PM schedule behind it.
      select("status", "Status", ["Open", "Draft", "Scheduled", "In Progress", "Completed", "Cancelled"], true),
      number("estimatedHours", "Estimated hours"),
      text("partsRequired", "Parts required"),
      number("estimatedCost", "Estimated cost"),
      { key: "pmTemplate", label: "From PM template", readOnly: true },
      { key: "checklist", label: "Checklist", type: "textarea", readOnly: true },
      { key: "description", label: "Fault and the work required", type: "textarea" },
      { key: "attachments", label: "Photos and manuals", type: "attachments" },
    ];
  }
  if (value === "job cards" || value === "job-cards") {
    return [
      text("workOrder", "Work order", true),
      date("date", "Work date", true),
      { key: "workCenter", label: "Machine", readOnly: true },
      text("technician", "Technician", true),
      number("hours", "Hours booked", true),
      number("meterReading", "Meter / hour-meter reading"),
      text("partsUsed", "Parts used"),
      number("completion", "Completion %"),
      // Moves the work order. Completed runs POST /complete on it.
      select("status", "Work order status", ["In Progress", "Completed", "Open"], true),
      { key: "workDone", label: "Work done", type: "textarea" },
      { key: "attachments", label: "Photos and signed job card", type: "attachments" },
    ];
  }
  if (value === "pm templates" || value === "pm-templates") {
    return [
      text("code", "Template code", true),
      text("name", "Service", true),
      text("assetCategory", "Machine type"),
      number("intervalDays", "Every (days)", true),
      {
        key: "checklist",
        label: "Checklist — one step per line",
        type: "textarea",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "preventive schedules" || value === "preventive-schedules") {
    return [
      text("template", "PM template", true),
      text("workCenter", "Machine", true),
      date("nextDue", "First due"),
      { key: "templateName", label: "Service", readOnly: true },
      { key: "intervalDays", label: "Every (days)", readOnly: true },
      { key: "lastDone", label: "Last done", readOnly: true },
      { key: "status", label: "Status", readOnly: true },
    ];
  }
  if (value === "downtime" || value === "downtime-logs") {
    return [
      date("date", "Date", true),
      { key: "startTime", label: "Start time (HH:MM)", required: true, placeholder: "08:30" },
      text("workCenter", "Machine", true),
      text("reason", "Fault", true),
      select(
        "category",
        "Category",
        ["Breakdown", "Changeover", "No material", "No labour", "Quality stop", "Other"],
        true,
      ),
      text("reportedBy", "Reported by", true),
      number("kgLost", "Output lost (kg)"),
      // Only for a stop that is already over: sent as `ended_at`
      // (iag-mes#3). Leave blank for a machine still down, and close it with
      // End downtime on the row menu.
      {
        key: "minutes",
        label: "Minutes lost (if already over)",
        type: "number",
        placeholder: "Blank while the machine is still down",
      },
      { key: "status", label: "Status", readOnly: true },
      { key: "notes", label: "Details and recovery", type: "textarea" },
    ];
  }
  return null;
}

/** List columns for the maintenance tabs. */
const MAINTENANCE_COLUMNS: Record<string, string[]> = {
  "work-centers": ["name", "code", "type", "section", "criticality", "status"],
  "work-orders": ["num", "title", "workCenter", "priority", "dueDate", "status"],
  "batch-records": ["workOrder", "date", "workCenter", "technician", "hours", "status"],
  "pm-templates": ["code", "name", "assetCategory", "intervalDays"],
  "pm-schedules": ["template", "workCenter", "nextDue", "lastDone", "status"],
  "downtime-logs": ["date", "startTime", "workCenter", "reason", "minutes", "status"],
};

function fieldsFor(label: string): EntityField[] {
  const value = label.toLowerCase();
  const maintenance = maintenanceFields(value);
  if (maintenance) return maintenance;
  if (value === "customers") return partyFields("Customer");
  if (value === "suppliers") return supplierFields();
  if (value === "departments") {
    return [
      text("name", "Department name", true),
      text("code", "Code"),
      text("manager", "Head of department"),
      text("costCenter", "Cost centre / class"),
      text("location", "Location"),
      number("headcount", "Planned headcount"),
      select("status", "Status", ["Active", "Inactive"], true),
      {
        key: "attachments",
        label: "Documents",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "employees") {
    return [
      text("name", "Employee name", true),
      text("code", "Employee ID", true),
      select("gender", "Sex / gender", ["Female", "Male", "Other", "Prefer not to say"]),
      date("dateOfBirth", "Date of birth"),
      text("nationality", "Nationality"),
      {
        key: "biodata",
        label: "Biodata / personal profile",
        type: "textarea",
        placeholder: "Brief personal background and other relevant biodata.",
      },
      text("nationalId", "National ID / NIN"),
      text("tin", "TIN (URA)"),
      text("nssfNumber", "NSSF number"),
      text("phone", "Phone", true),
      { key: "email", label: "Email", type: "email" },
      { key: "address", label: "Home address", type: "textarea" },
      text("city", "City / district"),
      text("emergencyContact", "Emergency contact name"),
      text("emergencyPhone", "Emergency contact phone"),
      text("nextOfKin", "Next of kin"),
      text("nextOfKinRelation", "Next of kin relationship"),
      text("department", "Department", true),
      text("jobTitle", "Job title"),
      text("manager", "Reports to"),
      text("workLocation", "Work location / branch"),
      date("hireDate", "Hire date"),
      date("probationEnd", "Probation end date"),
      date("contractEnd", "Contract end date"),
      select(
        "contractType",
        "Contract type",
        ["Permanent", "Contract", "Probation", "Intern", "Casual"],
        false,
      ),
      text("bankAccount", "Bank", true),
      text("bankCode", "Bank code"),
      text("accountNumber", "Account number", true),
      number("basicPay", "Basic pay (monthly)", true),
      number("housingAllowance", "Housing allowance"),
      number("transportAllowance", "Transport allowance"),
      number("otherAllowances", "Other allowances"),
      number("leaveBalance", "Leave balance (days)"),
      text("currency", "Currency", true),
      select("residentStatus", "Tax status", ["Resident", "Non-resident"], true),
      text("medicalInsurer", "Medical insurance provider"),
      text("medicalPolicy", "Medical policy number"),
      date("medicalExpiry", "Medical insurance expiry"),
      text("lifeInsurer", "Life / group life insurer"),
      text("lifePolicy", "Life policy number"),
      date("lifeExpiry", "Life insurance expiry"),
      text("insuranceNotes", "Insurance notes"),
      date("terminationDate", "Termination / exit date"),
      {
        key: "attachments",
        label: "Documents (contract, ID, insurance)",
        type: "attachments",
      },
      { key: "notes", label: "HR notes", type: "textarea" },
      number("balance", "Balance"),
      select(
        "status",
        "Employment status",
        ["Active", "Inactive", "Suspended", "Left"],
        true,
      ),
    ];
  }
  if (value === "hr desk" || value === "hr-desk") {
    return [];
  }
  if (value.includes("leave request")) {
    return withRequestFeedbackFields([
      text("reference", "Reference", true),
      text("employee", "Employee", true),
      select(
        "leaveType",
        "Leave type",
        ["Annual", "Sick", "Unpaid", "Maternity", "Paternity", "Compassionate", "Study"],
        true,
      ),
      date("startDate", "Start date", true),
      date("endDate", "End date", true),
      number("days", "Days", true),
      { key: "reason", label: "Reason", type: "textarea" },
      text("approver", "Approver"),
      select(
        "status",
        "Status",
        FORM_SUBMIT_STATUS_OPTIONS,
        true,
      ),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
        placeholder: "Medical certificate or supporting documents",
      },
    ]);
  }
  if (value === "attendance") {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("employee", "Employee", true),
      text("department", "Department"),
      text("site", "Site"),
      text("block", "Block"),
      text("clockIn", "Clock in"),
      text("clockOut", "Clock out"),
      number("hours", "Hours"),
      text("latitude", "Latitude"),
      text("longitude", "Longitude"),
      text("accuracyMeters", "GPS accuracy (m)"),
      text("wifiBssid", "Wi‑Fi BSSID"),
      select(
        "verification",
        "Geofence",
        ["Verified", "Flagged", "Outside", "Manual", "Skipped"],
        false,
      ),
      { key: "verificationNote", label: "Verification note", type: "textarea" },
      select(
        "status",
        "Status",
        ["Present", "Remote", "Half-day", "Absent", "Leave", "Holiday"],
        true,
      ),
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "sites") {
    return [
      text("name", "Site name", true),
      text("code", "Code"),
      text("address", "Address"),
      text("latitude", "Latitude", true),
      text("longitude", "Longitude", true),
      number("radiusMeters", "Geofence radius (m)", true),
      {
        key: "wifiBssids",
        label: "Approved Wi‑Fi BSSIDs",
        type: "textarea",
        placeholder: "One MAC per line or comma-separated (optional)",
      },
      select("status", "Status", ["Active", "Inactive"], true),
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "blocks") {
    return [
      text("name", "Block name", true),
      text("code", "Code"),
      text("site", "Site", true),
      text("latitude", "Latitude", true),
      text("longitude", "Longitude", true),
      number("radiusMeters", "Geofence radius (m)", true),
      {
        key: "wifiBssids",
        label: "Approved Wi‑Fi BSSIDs",
        type: "textarea",
        placeholder: "Optional — inherits site list if blank at check-in",
      },
      select("status", "Status", ["Active", "Inactive"], true),
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "holidays") {
    return [
      text("name", "Holiday name", true),
      date("date", "Date", true),
      select("kind", "Kind", ["Public", "Company", "Religious"], true),
      select("status", "Status", ["Active", "Inactive"], true),
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value.includes("job position")) {
    return [
      text("title", "Position title", true),
      text("code", "Code"),
      text("department", "Department", true),
      select(
        "employmentType",
        "Employment type",
        ["Permanent", "Contract", "Intern", "Casual"],
        true,
      ),
      number("headcount", "Openings", true),
      number("salaryMin", "Salary min"),
      number("salaryMax", "Salary max"),
      date("postedDate", "Posted date"),
      select(
        "status",
        "Status",
        ["Open", "Interviewing", "Offer", "Filled", "On hold", "Cancelled"],
        true,
      ),
      { key: "description", label: "Description", type: "textarea" },
    ];
  }
  if (value === "onboarding") {
    return [
      text("reference", "Reference", true),
      text("employee", "Employee / candidate", true),
      text("position", "Position"),
      text("department", "Department"),
      date("startDate", "Start date", true),
      text("buddy", "Buddy / mentor"),
      select(
        "checklist",
        "Checklist stage",
        [
          "Offer accepted",
          "Documents",
          "IT setup",
          "Orientation",
          "Probation review",
          "Complete",
        ],
        true,
      ),
      select(
        "status",
        "Status",
        ["In progress", "Complete", "Cancelled"],
        true,
      ),
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value.includes("statutory remittance")) {
    return [
      text("reference", "Reference", true),
      date("date", "Remittance date", true),
      select("kind", "Kind", ["PAYE", "NSSF employee", "NSSF employer", "Other"], true),
      text("period", "Period (YYYY-MM)", true),
      number("amount", "Amount", true),
      text("paidFrom", "Paid from", true),
      text("receiptNumber", "URA / NSSF receipt"),
      select("status", "Status", ["Draft", "Filed", "Paid", "Void"], true),
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value.includes("receipt rule") || value.includes("payment rule")) {
    return [
      text("name", "Rule name", true),
      text("bankAccount", "If bank account is"),
      text("descriptionContains", "And description contains", true),
      text("party", value.includes("receipt") ? "Paid by" : "Payee"),
      text("postingAccount", "Posting account", true),
      text("taxCode", "Tax code"),
      status,
    ];
  }
  if (value === "receipts") return moneyFields("Receipt");
  if (value === "payments") return moneyFields("Payment");
  if (value.includes("recurring")) {
    return [
      text("name", "Template name", true),
      text("party", "Customer / Supplier / Employee"),
      date("nextIssueDate", "Next issue date", true),
      select("interval", "Interval", ["Weekly", "Monthly", "Quarterly", "Yearly"], true),
      number("amount", "Amount", true),
      text("account", "Account"),
      { key: "description", label: "Description", type: "textarea" },
      select("until", "Active until", ["Until further notice", "Custom date"], true),
      date("endDate", "End date"),
      status,
    ];
  }
  if (value.includes("customer portal")) {
    return [
      text("customer", "Customer", true),
      select("quotes", "Sales quotes", ["Yes", "No"], true),
      select("orders", "Sales orders", ["Yes", "No"], true),
      select("invoices", "Sales invoices", ["Yes", "No"], true),
      select("creditNotes", "Credit notes", ["Yes", "No"], true),
      select("deliveryNotes", "Delivery notes", ["Yes", "No"], true),
      text("portalUrl", "Portal link"),
      status,
    ];
  }
  if (value.includes("payslip item")) {
    return [
      text("name", "Item name", true),
      select("kind", "Type", ["Earnings", "Deduction", "Contribution"], true),
      text("expenseAccount", "Expense account"),
      text("liabilityAccount", "Liability / asset account"),
      number("defaultRate", "Default rate / amount"),
      status,
    ];
  }
  if (value.includes("expense claim payer")) {
    return [
      text("name", "Payer name", true),
      select("payerType", "Type", ["Expense Claim Payer", "Employee", "Capital Member"], true),
      number("openingBalance", "Opening balance"),
      number("balance", "Amount to pay"),
      status,
    ];
  }
  if (value.includes("control account")) {
    return [
      text("name", "Control account name", true),
      text("code", "Code"),
      select(
        "category",
        "Subsidiary type",
        [
          "Bank accounts",
          "Cash accounts",
          "Customers",
          "Suppliers",
          "Inventory items",
          "Employees",
          "Fixed assets",
          "Intangible assets",
          "Capital accounts",
          "Special accounts",
        ],
        true,
      ),
      select("group", "Balance sheet group", ["Assets", "Liabilities", "Equity"], true),
      select("cashFlow", "Cash flow category", ["Operating activities", "Investing activities", "Financing activities"]),
      status,
    ];
  }
  if (value === "history") {
    return [
      date("timestamp", "Timestamp", true),
      text("user", "User", true),
      text("email", "Account email"),
      text("username", "Username"),
      text("userId", "User ID"),
      text("action", "Action", true),
      text("module", "Module"),
      text("entity", "Entity"),
      text("recordLabel", "Record"),
      { key: "details", label: "Details", type: "textarea" },
      status,
    ];
  }
  if (value === "deleted records" || value.includes("deleted record")) {
    return [
      date("timestamp", "Deleted at", true),
      text("deletedBy", "Deleted by", true),
      text("deletedByEmail", "Account email", true),
      text("deletedByUsername", "Username"),
      text("deletedByUserId", "User ID"),
      text("deletedByRole", "Role"),
      text("module", "Module", true),
      text("entity", "Entity", true),
      text("recordLabel", "Record", true),
      text("recordId", "Original record ID"),
      text("name", "Name"),
      text("reference", "Reference"),
      text("code", "Code"),
      date("date", "Date"),
      text("party", "Party"),
      text("account", "Account"),
      text("amount", "Amount"),
      text("currency", "Currency"),
      text("type", "Type"),
      text("originalStatus", "Original status"),
      { key: "description", label: "Description", type: "textarea" },
      { key: "details", label: "Details", type: "textarea" },
      select("status", "Status", ["Deleted"], true),
    ];
  }
  if (value.includes("aged receivable") || value.includes("aged payable") || value.includes("customer statement") || value.includes("supplier statement") || value.includes("tax summary") || value.includes("inventory value")) {
    return [
      text("name", "Report name", true),
      date("from", "From"),
      date("to", "To"),
      date("asOf", "As of"),
      select("basis", "Accounting basis", ["Accrual", "Cash"]),
      status,
    ];
  }
  if (value === "experiments") {
    return [
      text("reference", "Experiment ID", true),
      date("date", "Start date", true),
      text("product", "Product / SKU under test", true),
      text("hypothesis", "Hypothesis", true),
      text("variable", "Changed variable", true),
      text("control", "Control recipe / batch"),
      text("method", "Method / protocol"),
      number("batchSize", "Batch size"),
      text("owner", "Owner", true),
      select(
        "result",
        "Result",
        ["Pending", "Pass", "Fail", "Inconclusive", "Needs retest"],
        true,
      ),
      select(
        "status",
        "Status",
        ["Draft", "Running", "Analyzing", "Complete", "Cancelled"],
        true,
      ),
      { key: "observations", label: "Observations and measurements", type: "textarea" },
      { key: "conclusion", label: "Conclusion / next step", type: "textarea" },
      { key: "attachments", label: "Lab sheets and evidence", type: "attachments" },
    ];
  }
  if (value === "formulations") {
    return [
      text("name", "Formulation name", true),
      text("code", "Recipe code", true),
      text("product", "Target product", true),
      text("version", "Version", true),
      text("ingredients", "Ingredients / bill of materials", true),
      number("targetYield", "Target yield %"),
      number("roastTemp", "Roast / process temperature"),
      number("processTime", "Process time (minutes)"),
      text("owner", "Owner"),
      select(
        "status",
        "Status",
        ["Draft", "In trial", "Approved", "Superseded", "Rejected"],
        true,
      ),
      { key: "procedure", label: "Procedure", type: "textarea" },
      { key: "notes", label: "Notes", type: "textarea" },
      { key: "attachments", label: "Recipe documents", type: "attachments" },
    ];
  }
  if (value.includes("sensory panel")) {
    return [
      text("reference", "Panel reference", true),
      date("date", "Panel date", true),
      text("product", "Product / batch", true),
      text("panelists", "Panelists"),
      number("aroma", "Aroma score"),
      number("flavor", "Flavor score"),
      number("body", "Body score"),
      number("acidity", "Acidity score"),
      number("aftertaste", "Aftertaste score"),
      number("overall", "Overall / cupping score", true),
      text("defects", "Defects noted"),
      select(
        "result",
        "Panel result",
        ["Pending", "Preferred", "Acceptable", "Reject"],
        true,
      ),
      select("status", "Status", ["Draft", "Complete", "Void"], true),
      { key: "notes", label: "Sensory notes", type: "textarea" },
    ];
  }
  if (value.includes("spec sheet")) {
    return [
      text("name", "Specification name", true),
      text("code", "Spec code", true),
      text("product", "Product", true),
      text("version", "Version", true),
      number("moistureMin", "Moisture min %"),
      number("moistureMax", "Moisture max %"),
      number("cuppingMin", "Minimum cupping score"),
      number("roastLossMax", "Max roast loss %"),
      text("packSize", "Pack size"),
      text("shelfLife", "Shelf life"),
      text("labelRequirements", "Label requirements"),
      select("status", "Status", ["Draft", "Approved", "Superseded"], true),
      { key: "acceptanceCriteria", label: "Acceptance criteria", type: "textarea" },
      { key: "attachments", label: "Approved spec documents", type: "attachments" },
    ];
  }
  if (value.includes("pilot batch")) {
    return [
      text("reference", "Pilot batch", true),
      date("date", "Pilot date", true),
      text("formulation", "Formulation", true),
      text("experiment", "Linked experiment"),
      number("plannedQuantity", "Planned quantity", true),
      number("actualQuantity", "Actual quantity"),
      number("yield", "Yield %"),
      number("unitCost", "Unit cost"),
      text("equipment", "Equipment used"),
      text("operator", "Operator"),
      select(
        "result",
        "Scale-up result",
        ["Pending", "Ready to scale", "Needs revision", "Failed"],
        true,
      ),
      select(
        "status",
        "Status",
        ["Scheduled", "Running", "Quality hold", "Complete", "Cancelled"],
        true,
      ),
      { key: "notes", label: "Pilot observations", type: "textarea" },
      { key: "attachments", label: "Pilot evidence", type: "attachments" },
    ];
  }
  if (value.includes("cost model")) {
    return [
      text("name", "Cost model name", true),
      text("code", "Model code", true),
      text("product", "Product", true),
      number("materialCost", "Material cost", true),
      number("labourCost", "Labour cost"),
      number("energyCost", "Energy / overhead"),
      number("packagingCost", "Packaging cost"),
      number("wasteCost", "Waste / loss cost"),
      number("totalCost", "Total unit cost"),
      number("targetPrice", "Target selling price"),
      number("marginPercent", "Margin %"),
      select("status", "Status", ["Draft", "Active", "Archived"], true),
      { key: "assumptions", label: "Assumptions", type: "textarea" },
    ];
  }
  if (value.includes("ai insight")) {
    return [
      text("reference", "Insight reference", true),
      date("date", "Generated date", true),
      text("source", "Source record (experiment / batch / panel)"),
      select(
        "kind",
        "Insight type",
        ["Trial analysis", "Next-test recommendation", "Roast prediction", "QC risk", "Cost outlook"],
        true,
      ),
      text("summary", "Summary", true),
      number("confidence", "Confidence %"),
      select("status", "Status", ["New", "Reviewed", "Applied", "Dismissed"], true),
      { key: "details", label: "Model details / rationale", type: "textarea" },
      { key: "recommendedActions", label: "Recommended actions", type: "textarea" },
    ];
  }
  if (value.includes("lab request")) {
    return [
      text("reference", "Lab request", true),
      date("date", "Request date", true),
      text("product", "Product / sample focus", true),
      text("requestedBy", "Requested by", true),
      select(
        "priority",
        "Priority",
        ["Low", "Normal", "High", "Urgent"],
        true,
      ),
      text("objective", "Test objective", true),
      date("neededBy", "Needed by"),
      text("method", "Preferred method"),
      select(
        "status",
        "Status",
        ["Draft", "Submitted", "In lab", "Reported", "Cancelled"],
        true,
      ),
      { key: "notes", label: "Request notes", type: "textarea" },
      { key: "attachments", label: "Brief and references", type: "attachments" },
    ];
  }
  if (value.includes("lab sample")) {
    return [
      text("reference", "Sample ID", true),
      date("date", "Received date", true),
      text("source", "Source batch / lot", true),
      text("product", "Product", true),
      text("location", "Storage location"),
      number("quantity", "Sample quantity"),
      text("unit", "Unit"),
      text("condition", "Condition on receipt"),
      select(
        "status",
        "Status",
        ["Quarantine", "Ready", "In test", "Retained", "Disposed"],
        true,
      ),
      { key: "notes", label: "Handling notes", type: "textarea" },
      { key: "attachments", label: "Chain-of-custody documents", type: "attachments" },
    ];
  }
  if (value.includes("lab trial")) {
    return [
      text("reference", "Trial ID", true),
      date("date", "Trial date", true),
      text("product", "Product under test", true),
      text("hypothesis", "Hypothesis", true),
      text("variable", "Changed variable", true),
      text("control", "Control sample / recipe"),
      text("method", "Lab method", true),
      text("operator", "Analyst", true),
      number("controlScore", "Control score"),
      number("trialScore", "Trial score"),
      number("yieldPercent", "Yield %"),
      select(
        "result",
        "Result",
        ["Pending", "Pass", "Fail", "Inconclusive", "Needs retest"],
        true,
      ),
      select(
        "status",
        "Status",
        ["Draft", "Running", "Analyzing", "Complete", "Cancelled"],
        true,
      ),
      { key: "observations", label: "Observations", type: "textarea" },
      { key: "conclusion", label: "Conclusion / next step", type: "textarea" },
      { key: "attachments", label: "Raw data and worksheets", type: "attachments" },
    ];
  }
  if (value.includes("lab method")) {
    return [
      text("name", "Method name", true),
      text("code", "Method code", true),
      text("version", "Version", true),
      text("scope", "Scope / products"),
      text("equipment", "Required equipment"),
      select(
        "status",
        "Status",
        ["Draft", "Validated", "Approved", "Superseded"],
        true,
      ),
      { key: "procedure", label: "Procedure", type: "textarea" },
      { key: "acceptanceCriteria", label: "Acceptance criteria", type: "textarea" },
      { key: "attachments", label: "SOP documents", type: "attachments" },
    ];
  }
  if (value.includes("instrument calibration")) {
    return [
      text("reference", "Calibration ID", true),
      date("date", "Calibration date", true),
      text("instrument", "Instrument", true),
      text("serial", "Serial / asset ID"),
      text("standard", "Calibration standard"),
      text("performedBy", "Performed by", true),
      date("nextDue", "Next due date", true),
      select("result", "Result", ["Pass", "Adjust", "Fail"], true),
      select("status", "Status", ["Current", "Due", "Overdue", "Out of service"], true),
      { key: "notes", label: "Calibration notes", type: "textarea" },
      { key: "attachments", label: "Certificates", type: "attachments" },
    ];
  }
  if (value.includes("lab result")) {
    return [
      text("reference", "Result ID", true),
      date("date", "Reported date", true),
      text("sample", "Sample ID", true),
      text("trial", "Linked trial"),
      text("method", "Method used", true),
      text("parameter", "Parameter", true),
      text("value", "Result value", true),
      text("unit", "Unit"),
      text("specLimit", "Spec / limit"),
      text("analyst", "Analyst", true),
      select("result", "Pass/fail", ["Pending", "Pass", "Fail", "Inconclusive"], true),
      select("status", "Status", ["Draft", "Reported", "Approved", "Void"], true),
      { key: "notes", label: "Interpretation", type: "textarea" },
      { key: "attachments", label: "Result sheets", type: "attachments" },
    ];
  }
  if (value.includes("stability stud")) {
    return [
      text("reference", "Study ID", true),
      date("date", "Start date", true),
      text("product", "Product / lot", true),
      text("condition", "Storage condition", true),
      number("durationDays", "Duration (days)", true),
      date("pullDate", "Next pull date"),
      text("tests", "Tests scheduled"),
      text("owner", "Owner", true),
      select(
        "status",
        "Status",
        ["Planned", "Running", "On hold", "Complete", "Cancelled"],
        true,
      ),
      { key: "notes", label: "Study notes", type: "textarea" },
      { key: "attachments", label: "Protocol and data", type: "attachments" },
    ];
  }
  if (
    value.includes("production plan")
  ) {
    return [
      text("reference", "Schedule", true),
      date("date", "Created", true),
      date("weekOf", "Next due", true),
      text("product", "Service task", true),
      number("plannedQuantity", "Interval (days or hours)", true),
      text("workCenter", "Machine", true),
      text("owner", "Technician", true),
      select(
        "status",
        "Status",
        ["Draft", "Published", "In progress", "Complete", "Cancelled"],
        true,
      ),
      { key: "notes", label: "What the service includes", type: "textarea" },
    ];
  }
  if (
    value.includes("work center") ||
    value === "work-centers"
  ) {
    return [
      text("name", "Machine", true),
      text("code", "Asset code", true),
      select(
        "type",
        "Type",
        ["Crusher", "Mill", "Generator", "Pump", "Conveyor", "Compressor", "Packaging line", "Other"],
        true,
      ),
      text("location", "Site / plant"),
      number("capacityPerHour", "Rated output per hour"),
      text("supervisor", "Responsible technician"),
      // mes_assets CHECK. "Active" is not in it, and it was the default
      // option, so every machine this form created was refused.
      select("status", "Status", ["Idle", "Running", "Down", "PM", "Maintenance"], true),
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (
    value.includes("bill of materials") ||
    value === "boms" ||
    value === "bom"
  ) {
    return [
      text("name", "Part or kit", true),
      text("code", "Part code", true),
      text("finishedItem", "Fits machine", true),
      text("version", "Revision", true),
      text("components", "Parts and quantities — “Bearing 6205 x 2; Oil filter x 1”", true),
      number("batchSize", "Quantity on hand"),
      text("unit", "Unit"),
      select("status", "Status", ["Draft", "Approved", "Superseded"], true),
      { key: "notes", label: "Where it is stored, and what it fits", type: "textarea" },
      { key: "attachments", label: "Part sheets", type: "attachments" },
    ];
  }
  if (value.includes("batch record")) {
    return [
      text("reference", "Job card", true),
      date("date", "Work date", true),
      text("productionOrder", "Work order", true),
      text("bom", "Parts used", true),
      // `asset_tag` is NOT NULL on mes_work_orders — an optional field here
      // meant a blank one reached the INSERT and 500'd.
      text("workCenter", "Machine", true),
      text("operator", "Technician", true),
      number("inputQuantity", "Hours booked", true),
      number("outputQuantity", "Meter reading"),
      number("yieldPercent", "Completion %"),
      select(
        "status",
        "Status",
        // mes_work_orders CHECK (migration 005). The previous set differed
        // from it in case as well as vocabulary, so every option was refused.
        ["Draft", "Scheduled", "Open", "In Progress", "Completed", "Cancelled"],
        true,
      ),
      { key: "steps", label: "Work done", type: "textarea" },
      { key: "attachments", label: "Photos and signed job card", type: "attachments" },
    ];
  }
  if (value.includes("downtime log")) {
    return [
      text("reference", "Downtime reference", true),
      date("date", "Date", true),
      text("workCenter", "Machine", true),
      text("reason", "Fault", true),
      number("minutes", "Minutes lost", true),
      text("reportedBy", "Reported by", true),
      select(
        "category",
        "Category",
        ["Breakdown", "Changeover", "No material", "No labour", "Quality stop", "Other"],
        true,
      ),
      select("status", "Status", ["Open", "Resolved", "Reviewed"], true),
      { key: "notes", label: "Details and recovery", type: "textarea" },
    ];
  }
  if (value.includes("yield report")) {
    return [
      text("reference", "Yield report", true),
      date("date", "Report date", true),
      text("batch", "Batch / order", true),
      text("product", "Product", true),
      number("plannedQuantity", "Planned qty", true),
      number("actualQuantity", "Actual qty", true),
      number("yieldPercent", "Yield %", true),
      number("wasteQuantity", "Waste qty"),
      text("owner", "Owner"),
      select("status", "Status", ["Draft", "Reviewed", "Closed"], true),
      { key: "notes", label: "Variance explanation", type: "textarea" },
    ];
  }
  if (value === "work systems" || value === "work-systems") {
    return [
      text("name", "Work system name", true),
      text("code", "Code", true),
      text("owner", "System owner", true),
      text("area", "Area / department", true),
      select(
        "maturity",
        "Maturity",
        ["Ad hoc", "Defined", "Managed", "Optimized"],
        true,
      ),
      select("status", "Status", ["Active", "Pilot", "Retired"], true),
      { key: "description", label: "System description", type: "textarea" },
      { key: "criticalSteps", label: "Critical steps", type: "textarea" },
      { key: "attachments", label: "Process maps", type: "attachments" },
    ];
  }
  if (value.includes("benchmark stud")) {
    return [
      text("reference", "Study reference", true),
      date("date", "Study date", true),
      text("workSystem", "Work system", true),
      text("benchmarkSource", "Benchmark source (internal / peer / target)", true),
      number("baselineScore", "Baseline score"),
      number("benchmarkScore", "Benchmark score", true),
      number("gap", "Gap"),
      text("owner", "Owner", true),
      select(
        "status",
        "Status",
        ["Planned", "Collecting data", "Analyzed", "Actions open", "Closed"],
        true,
      ),
      { key: "findings", label: "Findings", type: "textarea" },
      { key: "attachments", label: "Study evidence", type: "attachments" },
    ];
  }
  if (value.includes("kpi definition")) {
    return [
      text("name", "KPI name", true),
      text("code", "KPI code", true),
      text("workSystem", "Work system", true),
      text("unit", "Unit", true),
      number("target", "Target", true),
      text("formula", "Formula / calculation"),
      text("owner", "Owner", true),
      select("frequency", "Frequency", ["Daily", "Weekly", "Monthly", "Quarterly"], true),
      select("status", "Status", ["Active", "Draft", "Retired"], true),
      { key: "notes", label: "Definition notes", type: "textarea" },
    ];
  }
  if (value.includes("cycle time stud")) {
    return [
      text("reference", "Study reference", true),
      date("date", "Study date", true),
      text("workSystem", "Work system", true),
      text("step", "Step measured", true),
      number("samples", "Sample count", true),
      number("avgMinutes", "Average minutes", true),
      number("bestMinutes", "Best minutes"),
      number("worstMinutes", "Worst minutes"),
      text("observedBy", "Observed by", true),
      select("status", "Status", ["Draft", "Validated", "Archived"], true),
      { key: "notes", label: "Observations", type: "textarea" },
    ];
  }
  if (value.includes("productivity score")) {
    return [
      text("reference", "Score reference", true),
      date("date", "Score date", true),
      text("workSystem", "Work system", true),
      text("period", "Period (e.g. 2026-W32)", true),
      number("output", "Output units", true),
      number("labourHours", "Labour hours", true),
      number("score", "Productivity score", true),
      number("target", "Target score"),
      text("owner", "Owner"),
      select("status", "Status", ["Draft", "Published", "Reviewed"], true),
      { key: "notes", label: "Commentary", type: "textarea" },
    ];
  }
  if (value.includes("gap analys")) {
    return [
      text("reference", "Gap analysis", true),
      date("date", "Date", true),
      text("workSystem", "Work system", true),
      text("benchmarkStudy", "Linked benchmark study"),
      text("gap", "Gap statement", true),
      select("impact", "Impact", ["Low", "Medium", "High", "Critical"], true),
      text("owner", "Owner", true),
      select("status", "Status", ["Open", "In action", "Closed"], true),
      { key: "rootCause", label: "Root cause", type: "textarea" },
      { key: "recommendation", label: "Recommendation", type: "textarea" },
    ];
  }
  if (value.includes("improvement action")) {
    return [
      text("reference", "Action reference", true),
      date("date", "Opened date", true),
      text("workSystem", "Work system", true),
      text("gap", "Linked gap / study"),
      text("action", "Improvement action", true),
      text("owner", "Owner", true),
      date("dueDate", "Due date", true),
      select(
        "status",
        "Status",
        ["Planned", "In progress", "Blocked", "Done", "Verified"],
        true,
      ),
      { key: "evidence", label: "Evidence of completion", type: "textarea" },
      { key: "attachments", label: "Supporting files", type: "attachments" },
    ];
  }
  if (value.includes("green bean intake")) {
    return [
      text("reference", "Intake / lot reference", true),
      date("date", "Received date", true),
      text("supplier", "Supplier", true),
      text("origin", "Origin / farm", true),
      text("variety", "Variety"),
      text("process", "Process (washed, natural, honey)"),
      text("harvest", "Harvest / crop year"),
      number("bags", "Number of bags"),
      number("quantity", "Net weight (kg)", true),
      number("moisture", "Moisture %"),
      number("sampleScore", "Arrival cupping score"),
      text("grade", "Grade"),
      text("location", "Green-bean warehouse", true),
      text("certificate", "Supplier certificate / traceability ID"),
      select(
        "status",
        "Release status",
        ["Quarantine", "Sampling", "Accepted", "Rejected", "Consumed"],
        true,
      ),
      { key: "notes", label: "Intake and defect notes", type: "textarea" },
      { key: "attachments", label: "Certificates and intake documents", type: "attachments" },
    ];
  }
  if (
    value === "production orders" ||
    value === "production-orders"
  ) {
    return [
      text("reference", "Work order", true),
      date("date", "Opened", true),
      text("finishedItem", "Machine", true),
      select("recipe", "Job type", ["Preventive", "Breakdown", "Inspection", "Overhaul"], true),
      text("workCenter", "Asset code", true),
      number("quantity", "Estimated hours", true),
      text("unit", "Hour unit"),
      text("materials", "Parts required", true),
      number("materialCost", "Parts cost"),
      number("nonInventoryCost", "Labour cost"),
      number("finishedValue", "Total estimated cost"),
      text("location", "Site"),
      text("division", "Workshop"),
      select(
        "status",
        "Status",
        // iag-production's own set (prod_production_orders CHECK). Anything
        // else is refused by the column, and "Complete" — one letter off
        // "completed" — was the default way to hit that. Running and Completed
        // are normally derived from the order's runs (DeriveOrderStatus); they
        // stay selectable so a planner can close an order worked off-system.
        ["Queued", "Scheduled", "Running", "Completed", "Cancelled"],
        true,
      ),
      { key: "notes", label: "Fault and the work required", type: "textarea" },
      { key: "attachments", label: "Photos and manuals", type: "attachments" },
    ];
  }
  if (value.includes("roast batch")) {
    return [
      text("reference", "Roast batch", true),
      date("date", "Roast date", true),
      text("productionOrder", "Production order"),
      text("greenLot", "Green-bean lot", true),
      text("recipe", "Roast profile / recipe", true),
      text("roaster", "Roaster / machine", true),
      number("inputWeight", "Green input (kg)", true),
      number("outputWeight", "Roasted output (kg)", true),
      number("roastLoss", "Roast loss %"),
      number("chargeTemperature", "Charge temperature °C"),
      number("endTemperature", "End temperature °C"),
      number("roastTime", "Roast time (minutes)"),
      text("operator", "Roast operator", true),
      select(
        "status",
        "Status",
        // A run's status is the service's to set: it opens `running` and moves
        // through Start roast / Complete run. Shown so the column reads, not
        // written — see the roast-batch adapter's `fromRecord`.
        ["Running", "Awaiting Decision", "Awaiting Flag", "Flagged", "On Hold", "Completed", "Cancelled"],
        false,
      ),
      { key: "profileNotes", label: "Profile events and roast notes", type: "textarea" },
      { key: "attachments", label: "Roast curve and batch documents", type: "attachments" },
    ];
  }
  if (value.includes("quality check")) {
    return [
      text("reference", "QC reference", true),
      date("date", "Check date", true),
      text("batch", "Roast / production batch", true),
      text("sample", "Sample ID"),
      number("cuppingScore", "Cupping score"),
      number("moisture", "Moisture %"),
      text("roastColor", "Roast colour"),
      text("grind", "Grind / particle result"),
      text("defects", "Defects found"),
      text("checkedBy", "Checked by", true),
      text("approvedBy", "Released by"),
      select(
        "result",
        "Result",
        ["Pending", "Pass", "Conditional pass", "Fail"],
        true,
      ),
      select(
        "status",
        "Disposition",
        ["Quality hold", "Released to packaging", "Rework", "Rejected"],
        true,
      ),
      { key: "notes", label: "Sensory and corrective-action notes", type: "textarea" },
      { key: "attachments", label: "Lab sheets and evidence", type: "attachments" },
    ];
  }
  if (value.includes("incoming inspection")) {
    return [
      text("reference", "Inspection reference", true),
      date("date", "Inspection date", true),
      text("sourceLot", "Supplier / green lot", true),
      text("item", "Material / SKU", true),
      number("sampleSize", "Sample size"),
      number("moisture", "Moisture %"),
      number("defectCount", "Defect count"),
      text("inspector", "Inspector", true),
      select("result", "Result", ["Pending", "Accept", "Quarantine", "Reject"], true),
      select("status", "Status", ["Open", "Hold", "Released", "Rejected"], true),
      { key: "notes", label: "Findings and disposition notes", type: "textarea" },
      { key: "attachments", label: "Photos and certificates", type: "attachments" },
    ];
  }
  if (value.includes("in-process check") || value.includes("in process check")) {
    return [
      text("reference", "IPC reference", true),
      date("date", "Check date", true),
      text("stage", "Process stage", true),
      text("batch", "Batch / order", true),
      text("parameter", "Parameter checked", true),
      text("target", "Target / tolerance"),
      text("actual", "Actual reading", true),
      text("checkedBy", "Checked by", true),
      select("result", "Result", ["Pending", "In control", "Out of control"], true),
      select("status", "Status", ["Open", "Corrected", "Escalated", "Closed"], true),
      { key: "notes", label: "Deviation and action notes", type: "textarea" },
    ];
  }
  if (value.includes("release decision")) {
    return [
      text("reference", "Release reference", true),
      date("date", "Decision date", true),
      text("batch", "Batch / lot", true),
      text("product", "Product / SKU", true),
      text("checks", "Linked QC / inspection refs"),
      text("decidedBy", "Released / held by", true),
      select(
        "decision",
        "Decision",
        ["Released", "Conditional release", "Hold", "Reject", "Rework"],
        true,
      ),
      select("status", "Status", ["Draft", "Approved", "Superseded"], true),
      { key: "notes", label: "Decision rationale", type: "textarea" },
      { key: "attachments", label: "Signed release evidence", type: "attachments" },
    ];
  }
  if (value.includes("non-conformance") || value.includes("non conformance")) {
    return [
      text("reference", "NCR reference", true),
      date("date", "Raised date", true),
      text("source", "Source batch / check", true),
      text("title", "Non-conformance title", true),
      select(
        "severity",
        "Severity",
        ["Minor", "Major", "Critical"],
        true,
      ),
      text("owner", "Owner", true),
      select(
        "status",
        "Status",
        ["Open", "Under investigation", "Corrective action", "Closed", "Void"],
        true,
      ),
      { key: "description", label: "What happened", type: "textarea" },
      { key: "rootCause", label: "Root cause", type: "textarea" },
      { key: "attachments", label: "Evidence", type: "attachments" },
    ];
  }
  if (value.includes("capa action") || value === "capa" || value.includes("capa ")) {
    return [
      text("reference", "CAPA reference", true),
      date("date", "Opened date", true),
      text("ncr", "Linked NCR", true),
      text("action", "Corrective / preventive action", true),
      text("owner", "Owner", true),
      date("dueDate", "Due date", true),
      select(
        "kind",
        "Type",
        ["Corrective", "Preventive", "Both"],
        true,
      ),
      select(
        "status",
        "Status",
        ["Planned", "In progress", "Verified", "Closed", "Overdue"],
        true,
      ),
      { key: "effectiveness", label: "Effectiveness check", type: "textarea" },
      { key: "attachments", label: "Evidence of completion", type: "attachments" },
    ];
  }
  if (value.includes("hold & release") || value.includes("hold and release")) {
    return [
      text("reference", "Hold reference", true),
      date("date", "Event date", true),
      text("batch", "Batch / lot", true),
      select("event", "Event", ["Placed on hold", "Released", "Rejected", "Reworked"], true),
      text("reason", "Reason", true),
      text("by", "Recorded by", true),
      text("location", "Hold location"),
      select("status", "Status", ["Active hold", "Cleared", "Scrapped"], true),
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value.includes("packaging run")) {
    return [
      text("reference", "Packaging run", true),
      date("date", "Pack date", true),
      text("roastBatch", "Released roast batch", true),
      text("finishedItem", "Finished product / SKU", true),
      // `pack_size_kg`, and the service multiplies it by the pack count to get
      // output kilos — a pack size in grams made every packaging run 1000x.
      number("packSize", "Pack size (kg)", true),
      number("plannedQuantity", "Planned packs", true),
      number("quantity", "Packed quantity", true),
      text("packagingMaterial", "Bag, valve and label lot"),
      text("lotCode", "Finished lot code", true),
      date("bestBefore", "Best-before date", true),
      text("line", "Packaging line / machine", true),
      text("operator", "Line lead"),
      select(
        "status",
        "Status",
        ["Scheduled", "Packing", "Line clearance", "Complete", "Quality hold", "Rejected"],
        true,
      ),
      { key: "notes", label: "Line checks, waste and reconciliation", type: "textarea" },
      { key: "attachments", label: "Packaging and release records", type: "attachments" },
    ];
  }
  if (value === "stocktakes" || value === "stocktake") {
    return [
      text("reference", "Stocktake reference", true),
      date("date", "Count date", true),
      text("location", "Warehouse / location", true),
      text("item", "Item / coffee lot", true),
      number("systemQuantity", "System quantity", true),
      number("countedQuantity", "Counted quantity", true),
      number("variance", "Variance"),
      number("unitCost", "Unit cost"),
      number("amount", "Variance value"),
      text("countedBy", "Counted by"),
      text("approvedBy", "Approved by"),
      select("status", "Status", ["Draft", "Counted", "Approved", "Posted", "Void"], true),
      { key: "notes", label: "Count and variance notes", type: "textarea" },
    ];
  }
  if (value.includes("landed cost")) {
    return [
      text("reference", "Landed-cost reference", true),
      date("date", "Date", true),
      text("item", "Green-bean item / lot", true),
      text("purchase", "Purchase order / goods receipt"),
      number("freight", "Freight"),
      number("duty", "Duty and taxes"),
      number("clearing", "Clearing and handling"),
      number("otherCost", "Other costs"),
      number("amount", "Total landed cost", true),
      text("allocationMethod", "Allocation method"),
      text("division", "Class / division"),
      select("status", "Status", ["Draft", "Approved", "Posted", "Void"], true),
      { key: "notes", label: "Cost allocation notes", type: "textarea" },
      { key: "attachments", label: "Freight and customs documents", type: "attachments" },
    ];
  }
  // Contractor invoices have their own shape (project, contractor party) — keep above
  // the generic invoice matcher which also matches the word "invoice".
  if (value === "contractor invoices" || value === "contractor-invoices") {
    return [
      text("reference", "Reference", true),
      date("date", "Invoice date", true),
      date("dueDate", "Due date"),
      text("party", "Contractor", true),
      text("supplier", "Supplier (alias)"),
      text("project", "Project", true),
      text("currency", "Currency"),
      text("division", "Class / division"),
      { key: "description", label: "Description", type: "textarea" },
      number("tax", "Tax %"),
      number("amount", "Amount", true),
      number("amountPaid", "Amount paid"),
      number("balanceDue", "Balance due"),
      select(
        "status",
        "Status",
        ["Draft", "Submitted", "Approved", "Paid", "Void", "Cancelled"],
        true,
      ),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
        placeholder: "Invoice PDF / supporting documents",
      },
    ];
  }
  if (
    value.includes("invoice") ||
    value.includes("quote") ||
    value.includes("order") ||
    value.includes("note") ||
    value.includes("late payment")
  ) {
    return documentFields(
      value.includes("purchase") || value.includes("debit") || value.includes("goods")
        ? "Supplier"
        : "Customer",
    );
  }
  if (value.includes("bank") && value.includes("account")) {
    return [
      text("name", "Bank account name", true),
      text("glAccount", "Posts to (Chart of Accounts)", true),
      select("type", "Type", ["Bank", "Cash", "Credit card", "Online payment"], true),
      text("institution", "Bank / institution"),
      text("accountNumber", "Account / wallet number"),
      text("currency", "Currency", true),
      number("openingBalance", "Opening balance"),
      text("division", "Class / division"),
      text("code", "Code"),
      // Live columns — filled by enrichment, not entered on create.
      number("balance", "Closing balance"),
      text("uncategorizedReceipts", "Uncategorized receipts"),
      text("uncategorizedPayments", "Uncategorized payments"),
      status,
    ];
  }
  if (value.includes("inventory kit")) {
    return [
      text("name", "Kit name", true),
      text("code", "Kit code", true),
      date("date", "Date", true),
      text("components", "Component items", true),
      number("salesPrice", "Sales price", true),
      text("taxCode", "Tax code"),
      status,
    ];
  }
  if (value.includes("non-inventory")) {
    return [
      text("name", "Item name", true),
      text("code", "Code", true),
      text("unit", "Unit"),
      { key: "description", label: "Description", type: "textarea" },
      text("salesAccount", "When sold — account"),
      number("salesPrice", "Sales price"),
      text("purchaseAccount", "When purchased — account"),
      number("purchasePrice", "Purchase price"),
      status,
    ];
  }
  if (value.includes("inventory transfer") || (value.includes("transfer") && value.includes("inventory"))) {
    return [
      text("reference", "Reference", true),
      date("date", "Dispatch date", true),
      text("item", "Inventory item", true),
      number("quantity", "Quantity", true),
      text("from", "From warehouse / location", true),
      text("to", "Receive into warehouse / location", true),
      date("receivedDate", "Received date"),
      text("receivedBy", "Received by"),
      {
        key: "description",
        label: "Description",
        type: "textarea",
      },
      select(
        "status",
        "Status",
        ["Draft", "Pending", "In transit", "Received", "Complete", "Void"],
        true,
      ),
    ];
  }
  if (value === "stock in" || value.includes("stock-in") || value === "stockin") {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("item", "Inventory item", true),
      text("location", "Location", true),
      number("quantity", "Qty", true),
      number("unitCost", "Unit cost", true),
      number("stockValue", "Stock value"),
      text("supplier", "Supplier"),
      text("description", "Notes"),
      select(
        "status",
        "Status",
        ["Complete", "Draft", "Pending", "Approved", "Void"],
        true,
      ),
    ];
  }
  if (value.includes("inventory sale")) {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("party", "Customer", true),
      text("item", "Inventory item", true),
      text("location", "Location"),
      number("quantity", "Qty", true),
      number("unitPrice", "Unit price", true),
      number("amount", "Sales amount"),
      text("division", "Class / division"),
      text("description", "Notes"),
      select(
        "status",
        "Status",
        ["Complete", "Draft", "Pending", "Approved", "Void"],
        true,
      ),
    ];
  }
  if (value.includes("capital subaccount")) {
    return [
      text("name", "Subaccount name", true),
      text("code", "Code", true),
      select("type", "Type", ["Drawings", "Funds contributed", "Share of profit", "Custom"], true),
      text("description", "Description"),
      status,
    ];
  }
  if (value.includes("transfer")) {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("from", "Paid from", true),
      text("to", "Received in", true),
      number("amount", "Amount", true),
      text("division", "Class / division"),
      text("description", "Description"),
      status,
    ];
  }
  if (value.includes("reconciliation")) {
    return [
      text("reference", "Reference", true),
      date("date", "Statement date", true),
      text("account", "Bank account", true),
      number("statementBalance", "Statement closing balance", true),
      number("systemBalance", "System closing balance"),
      number("discrepancy", "Discrepancy"),
      text("status", "Status"),
    ];
  }
  if (value.includes("inventory item")) {
    return [
      text("name", "Item", true),
      text("code", "Code", true),
      text("unit", "Unit"),
      { key: "description", label: "Description", type: "textarea" },
      text("location", "Location", true),
      number("openingStock", "Opening qty", true),
      number("unitValue", "Unit value", true),
      number("stockValue", "Opening value"),
      text("salesAccount", "When sold — account"),
      number("salesPrice", "Sales price"),
      text("purchaseAccount", "When purchased — account"),
      number("reorderLevel", "Reorder level"),
      // Live columns — computed from stock movements, never entered on the form.
      number("closingStock", "Closing qty"),
      number("closingValue", "Closing value"),
      status,
    ];
  }
  if (
    value.includes("inventory location") ||
    (value.includes("warehouse") && value.includes("location"))
  ) {
    return [
      select("kind", "Type", ["warehouse", "store", "location"], true),
      text("name", "Name", true),
      text("code", "Code"),
      text("address", "Address"),
      select("status", "Status", ["Active", "Inactive"], true),
    ];
  }
  if (value.includes("write-off")) {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("item", "Inventory item", true),
      text("location", "Location"),
      number("quantity", "Quantity", true),
      select(
        "reasonType",
        "Reason type",
        ["Damage", "Loss", "Theft", "Other"],
        true,
      ),
      {
        key: "description",
        label: "Reason detail",
        type: "textarea",
        required: true,
      },
      text("allocation", "Expense account", true),
      number("unitCost", "Unit cost"),
      number("amount", "Write-off value"),
      {
        key: "attachments",
        label: "Supporting documents",
        type: "attachments",
      },
      {
        key: "evidenceNotes",
        label: "Evidence notes",
        type: "textarea",
        placeholder: "Police report no., QC reference, witness, photo notes…",
      },
      select(
        "status",
        "Status",
        ["Complete", "Draft", "Pending", "Approved", "Void"],
        true,
      ),
    ];
  }
  if (value.includes("production")) return [text("reference", "Reference", true), date("date", "Date", true), text("finishedItem", "Finished item", true), number("quantity", "Quantity produced", true), text("materials", "Bill of materials", true), number("nonInventoryCost", "Additional cost"), status];
  if (value === "drivers") {
    return [
      text("name", "Driver name", true),
      text("code", "Driver ID"),
      text("employee", "Linked employee"),
      text("phone", "Phone", true),
      { key: "email", label: "Email", type: "email" },
      text("nationalId", "National ID / NIN"),
      text("licenseNumber", "Licence number", true),
      select(
        "licenseClass",
        "Licence class",
        ["B", "B1", "C", "CE", "D", "Motorcycle", "Other"],
        true,
      ),
      date("licenseExpiry", "Licence expiry"),
      date("licenseIssueDate", "Licence issue date"),
      text("vehicle", "Assigned vehicle"),
      text("department", "Department"),
      date("hireDate", "Start date"),
      select("status", "Status", ["Active", "Suspended", "Inactive"], true),
      {
        key: "attachments",
        label: "Documents (licence, ID)",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "vehicles") {
    return [
      text("name", "Vehicle name", true),
      text("code", "Asset / fleet code", true),
      text("registration", "Registration / plate", true),
      select(
        "type",
        "Type",
        ["Van", "Pickup", "Truck", "Car", "Motorcycle", "Other"],
        true,
      ),
      text("makeModel", "Make / model"),
      text("driver", "Assigned driver"),
      text("fixedAsset", "Linked fixed asset"),
      text("department", "Department"),
      text("location", "Home base / location"),
      number("odometer", "Odometer (km)"),
      number("nextServiceKm", "Next service (km)"),
      date("nextServiceDate", "Next service date"),
      date("insuranceExpiry", "Insurance expiry"),
      text("insuranceProvider", "Insurance provider"),
      text("insurancePolicy", "Insurance policy #"),
      date("registrationExpiry", "Registration expiry"),
      date("acquired", "Acquired date"),
      select("status", "Status", ["Active", "In service", "Inactive", "Disposed"], true),
      {
        key: "attachments",
        label: "Documents (logbook, insurance)",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "fuel requests" || value === "fuel-requests") {
    return withRequestFeedbackFields([
      text("reference", "Reference", true),
      date("date", "Request date", true),
      text("vehicle", "Vehicle", true),
      text("driver", "Driver / requester", true),
      text("department", "Department"),
      number("litres", "Litres requested", true),
      number("amount", "Estimated amount", true),
      text("currency", "Currency"),
      text("purpose", "Purpose / trip"),
      date("neededBy", "Needed by"),
      text("station", "Preferred station"),
      text("bankAccount", "Pay from (bank / cash)"),
      text("fuelLog", "Linked fuel log"),
      date("fulfilledDate", "Fulfilled date"),
      select(
        "status",
        "Status",
        FUEL_STATUS_OPTIONS,
        true,
      ),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ]);
  }
  if (value === "fuel logs" || value === "fuel-logs") {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("vehicle", "Vehicle", true),
      text("driver", "Driver"),
      text("fuelRequest", "Linked fuel request"),
      number("litres", "Litres", true),
      number("odometer", "Odometer (km)"),
      number("amount", "Amount", true),
      text("currency", "Currency"),
      text("station", "Fuel station"),
      text("expenseAccount", "Expense account"),
      text("bankAccount", "Paid from (bank / cash)", true),
      // Mirrored from bankAccount on save; hidden on create/edit forms.
      text("paidFrom", "Paid from (alias)"),
      select(
        "status",
        "Status",
        ["Draft", "Submitted", "Approved", "Posted", "Void"],
        true,
      ),
      {
        key: "attachments",
        label: "Receipt / evidence",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "trip requests" || value === "trip-requests") {
    return withRequestFeedbackFields([
      text("reference", "Reference", true),
      date("date", "Request date", true),
      text("vehicle", "Vehicle", true),
      text("driver", "Driver", true),
      text("department", "Department"),
      text("fromLocation", "From", true),
      text("toLocation", "To", true),
      date("departDate", "Depart date", true),
      date("returnDate", "Return date"),
      {
        key: "purpose",
        label: "Purpose",
        type: "textarea",
        required: true,
      },
      number("estimatedKm", "Estimated km"),
      number("odometerStart", "Odometer start (km)"),
      number("odometerEnd", "Odometer end (km)"),
      number("actualKm", "Actual km"),
      date("completedDate", "Completed date"),
      select(
        "status",
        "Status",
        TRIP_MAINT_STATUS_OPTIONS,
        true,
      ),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ]);
  }
  if (value.includes("maintenance request")) {
    return withRequestFeedbackFields([
      text("reference", "Reference", true),
      date("date", "Request date", true),
      text("vehicle", "Vehicle", true),
      text("requestedBy", "Requested by", true),
      select(
        "priority",
        "Priority",
        ["Low", "Medium", "High", "Urgent"],
        true,
      ),
      {
        key: "description",
        label: "Work required",
        type: "textarea",
        required: true,
      },
      date("neededBy", "Needed by"),
      number("estimatedCost", "Estimated cost"),
      number("actualCost", "Actual cost"),
      text("expenseAccount", "Expense account"),
      text("bankAccount", "Paid from (bank / cash)"),
      text("supplier", "Garage / supplier"),
      date("completedDate", "Completed date"),
      number("odometer", "Odometer at service (km)"),
      select(
        "status",
        "Status",
        TRIP_MAINT_STATUS_OPTIONS,
        true,
      ),
      {
        key: "attachments",
        label: "Attachments / invoices",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ]);
  }
  if (value === "fleet cost report" || value === "fleet-cost-report") {
    return [text("name", "Report", true)];
  }
  if (value === "service reminders" || value === "service-reminders") {
    return [];
  }
  if (value === "product simulations" || value === "product-simulations") {
    return [];
  }
  // ——— CRM ———
  // ——— Security ———
  if (value === "gate passes" || value === "gate-passes") {
    return [
      text("reference", "Pass number", true),
      date("date", "Issue date", true),
      select(
        "passType",
        "Pass type",
        ["Staff", "Vehicle", "Goods", "Contractor", "Other"],
        true,
      ),
      text("person", "Person / driver", true),
      text("employee", "Employee"),
      text("vehicle", "Vehicle"),
      text("department", "Department"),
      text("fromLocation", "From"),
      text("toLocation", "To / destination"),
      {
        key: "purpose",
        label: "Purpose",
        type: "textarea",
        required: true,
      },
      date("validFrom", "Valid from", true),
      date("validTo", "Valid to"),
      text("gate", "Gate / checkpoint"),
      text("authorizedBy", "Authorised by"),
      text("timeOut", "Time out"),
      text("timeIn", "Time in"),
      text("items", "Goods / items"),
      select(
        "status",
        "Status",
        ["Draft", "Issued", "Active", "Used", "Expired", "Cancelled"],
        true,
      ),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "visitor passes" || value === "visitor-passes") {
    return [
      text("reference", "Pass number", true),
      date("date", "Visit date", true),
      text("name", "Visitor name", true),
      text("company", "Company / organisation"),
      text("phone", "Phone"),
      text("idNumber", "ID / passport number"),
      text("host", "Host (employee)", true),
      text("department", "Department"),
      {
        key: "purpose",
        label: "Purpose of visit",
        type: "textarea",
        required: true,
      },
      text("expectedArrival", "Expected arrival"),
      text("expectedDeparture", "Expected departure"),
      text("badgeNumber", "Badge / pass ID"),
      text("vehicle", "Vehicle plate"),
      text("timeIn", "Checked in"),
      text("timeOut", "Checked out"),
      select(
        "status",
        "Status",
        ["Expected", "On site", "Checked out", "Denied", "Cancelled"],
        true,
      ),
      {
        key: "attachments",
        label: "ID copy / attachments",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "security incidents" || value === "security-incidents") {
    return [
      text("reference", "Incident number", true),
      date("date", "Date", true),
      text("time", "Time"),
      select(
        "type",
        "Incident type",
        [
          "Theft",
          "Trespass",
          "Assault",
          "Accident",
          "Fire",
          "Medical",
          "Property damage",
          "Suspicious activity",
          "Other",
        ],
        true,
      ),
      select("severity", "Severity", ["Low", "Medium", "High", "Critical"], true),
      text("location", "Location", true),
      text("reportedBy", "Reported by", true),
      text("involved", "People / vehicles involved"),
      {
        key: "description",
        label: "What happened",
        type: "textarea",
        required: true,
      },
      {
        key: "actionTaken",
        label: "Action taken",
        type: "textarea",
      },
      text("policeRef", "Police / case reference"),
      select(
        "status",
        "Status",
        ["Open", "Investigating", "Escalated", "Closed"],
        true,
      ),
      {
        key: "attachments",
        label: "Photos / reports",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "leads") {
    return [
      text("name", "Lead name", true),
      text("code", "Lead ID", true),
      text("company", "Company"),
      text("phone", "Phone"),
      { key: "email", label: "Email", type: "email" },
      text("source", "Source"),
      select(
        "stage",
        "Stage",
        ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"],
        true,
      ),
      text("owner", "Owner"),
      date("nextFollowUp", "Next follow-up"),
      number("estimatedValue", "Estimated value"),
      text("currency", "Currency"),
      text("customer", "Linked customer"),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
      select("status", "Status", ["Open", "Converted", "Closed"], true),
    ];
  }
  if (value === "opportunities") {
    return [
      text("name", "Opportunity", true),
      text("code", "Opportunity ID", true),
      text("customer", "Customer / lead", true),
      select(
        "stage",
        "Pipeline stage",
        ["Prospecting", "Qualification", "Proposal", "Negotiation", "Closed won", "Closed lost"],
        true,
      ),
      number("amount", "Deal value", true),
      text("currency", "Currency"),
      number("probability", "Probability %"),
      date("expectedClose", "Expected close"),
      text("owner", "Owner"),
      text("salesOrder", "Linked sales order"),
      {
        key: "description",
        label: "Description",
        type: "textarea",
      },
      select("status", "Status", ["Open", "Won", "Lost"], true),
    ];
  }
  if (value === "contacts") {
    return [
      text("name", "Contact name", true),
      text("code", "Contact ID"),
      text("customer", "Customer / company", true),
      text("title", "Job title"),
      text("phone", "Phone"),
      { key: "email", label: "Email", type: "email" },
      select("role", "Role", ["Decision maker", "Influencer", "User", "Billing", "Other"], false),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
      select("status", "Status", ["Active", "Inactive"], true),
    ];
  }
  if (value === "follow-ups" || value === "follow ups" || value === "crm activities") {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      select(
        "type",
        "Type",
        ["Call", "Meeting", "Email", "WhatsApp", "Visit", "Task", "Other"],
        true,
      ),
      text("subject", "Subject", true),
      text("relatedTo", "Related to (lead / customer / opportunity)", true),
      text("contact", "Contact"),
      text("owner", "Owner"),
      date("dueDate", "Due date"),
      select(
        "status",
        "Status",
        ["Planned", "Done", "Cancelled"],
        true,
      ),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
    ];
  }
  if (value === "complaints") {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("customer", "Customer", true),
      text("contact", "Contact"),
      select(
        "category",
        "Category",
        ["Product", "Delivery", "Billing", "Service", "Other"],
        true,
      ),
      select("priority", "Priority", ["Low", "Medium", "High", "Urgent"], true),
      {
        key: "description",
        label: "Complaint",
        type: "textarea",
        required: true,
      },
      text("assignedTo", "Assigned to"),
      text("salesOrder", "Related order / invoice"),
      date("resolvedDate", "Resolved date"),
      select(
        "status",
        "Status",
        ["Open", "In progress", "Resolved", "Closed"],
        true,
      ),
      {
        key: "resolution",
        label: "Resolution notes",
        type: "textarea",
      },
    ];
  }
  // ——— Logistics ———
  if (value === "shipments") {
    return [
      text("reference", "Shipment ref", true),
      date("date", "Ship date", true),
      text("customer", "Customer", true),
      text("salesOrder", "Sales order"),
      text("deliveryNote", "Delivery note"),
      text("fromLocation", "From", true),
      text("toLocation", "To / delivery address", true),
      text("vehicle", "Vehicle"),
      text("driver", "Driver"),
      text("carrier", "Carrier / 3PL"),
      text("route", "Route"),
      number("packages", "Packages"),
      number("weightKg", "Weight (kg)"),
      select(
        "status",
        "Status",
        ["Draft", "Scheduled", "In transit", "Delivered", "Failed", "Cancelled"],
        true,
      ),
      date("eta", "ETA"),
      date("deliveredDate", "Delivered date"),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
    ];
  }
  if (value === "dispatch board" || value === "dispatch-board") {
    return [
      text("reference", "Dispatch ref", true),
      date("date", "Dispatch date", true),
      text("shipment", "Shipment", true),
      text("vehicle", "Vehicle", true),
      text("driver", "Driver", true),
      text("route", "Route"),
      date("departAt", "Depart at"),
      date("returnAt", "Return by"),
      select(
        "status",
        "Status",
        ["Planned", "Dispatched", "Completed", "Cancelled"],
        true,
      ),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
    ];
  }
  if (value === "routes") {
    return [
      text("name", "Route name", true),
      text("code", "Code", true),
      text("zone", "Zone / area"),
      text("fromLocation", "Start point"),
      text("toLocation", "End point"),
      number("distanceKm", "Distance (km)"),
      number("estHours", "Est. hours"),
      select("status", "Status", ["Active", "Inactive"], true),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
    ];
  }
  if (value === "proof of delivery" || value === "proof-of-delivery") {
    return [
      text("reference", "POD ref", true),
      date("date", "Delivery date", true),
      text("shipment", "Shipment", true),
      text("customer", "Customer", true),
      text("receivedBy", "Received by", true),
      text("receiverPhone", "Receiver phone"),
      text("driver", "Driver"),
      text("vehicle", "Vehicle"),
      select(
        "condition",
        "Condition",
        ["Good", "Damaged", "Partial", "Refused"],
        true,
      ),
      {
        key: "notes",
        label: "Delivery notes",
        type: "textarea",
      },
      {
        key: "attachments",
        label: "Signature / photos",
        type: "attachments",
      },
      select("status", "Status", ["Draft", "Confirmed", "Disputed"], true),
    ];
  }
  if (value === "carriers") {
    return [
      text("name", "Carrier name", true),
      text("code", "Code", true),
      text("phone", "Phone"),
      { key: "email", label: "Email", type: "email" },
      text("contactPerson", "Contact person"),
      {
        key: "address",
        label: "Address",
        type: "textarea",
      },
      select("type", "Type", ["Own fleet", "3PL", "Courier", "Other"], true),
      select("status", "Status", ["Active", "Inactive"], true),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
    ];
  }
  // ——— Distribution ———
  if (value === "distribution orders" || value === "distribution-orders") {
    return [
      text("reference", "Distribution order", true),
      date("date", "Date", true),
      text("customer", "Customer", true),
      text("salesOrder", "Sales order", true),
      text("warehouse", "Warehouse", true),
      text("deliveryAddress", "Delivery address"),
      date("neededBy", "Needed by"),
      select(
        "fulfillmentStage",
        "Fulfillment stage",
        ["Allocated", "Picking", "Packing", "Ready to ship", "Shipped", "Delivered", "Cancelled"],
        true,
      ),
      text("shipment", "Linked shipment"),
      text("deliveryNote", "Delivery note"),
      select(
        "status",
        "Status",
        ["Draft", "In progress", "Complete", "Cancelled"],
        true,
      ),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
    ];
  }
  if (value === "picking lists" || value === "picking-lists") {
    return [
      text("reference", "Picking list", true),
      date("date", "Date", true),
      text("distributionOrder", "Distribution order", true),
      text("warehouse", "Warehouse", true),
      text("picker", "Picker"),
      {
        key: "lines",
        label: "Items to pick",
        type: "textarea",
        placeholder: "Item · qty · location (one per line)",
        required: true,
      },
      date("pickedDate", "Picked date"),
      select(
        "status",
        "Status",
        ["Draft", "Picking", "Picked", "Short pick", "Cancelled"],
        true,
      ),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
    ];
  }
  if (value === "packing lists" || value === "packing-lists") {
    return [
      text("reference", "Packing list", true),
      date("date", "Date", true),
      text("distributionOrder", "Distribution order", true),
      text("pickingList", "Picking list"),
      text("packer", "Packer"),
      number("packages", "Packages", true),
      text("packaging", "Packaging type"),
      {
        key: "lines",
        label: "Packed items",
        type: "textarea",
        placeholder: "Item · qty · package #",
      },
      select(
        "status",
        "Status",
        ["Draft", "Packing", "Packed", "Cancelled"],
        true,
      ),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
    ];
  }
  if (value === "delivery runs" || value === "delivery-runs") {
    return [
      text("reference", "Run ref", true),
      date("date", "Run date", true),
      text("route", "Route"),
      text("vehicle", "Vehicle", true),
      text("driver", "Driver", true),
      {
        key: "orders",
        label: "Distribution orders / shipments",
        type: "textarea",
        placeholder: "List order or shipment refs included on this run",
        required: true,
      },
      select(
        "status",
        "Status",
        ["Planned", "Loading", "Out for delivery", "Completed", "Cancelled"],
        true,
      ),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
    ];
  }
  if (value === "stock allocations" || value === "stock-allocations") {
    return [
      text("reference", "Allocation ref", true),
      date("date", "Date", true),
      text("salesOrder", "Sales order", true),
      text("distributionOrder", "Distribution order"),
      text("item", "Inventory item", true),
      text("warehouse", "Warehouse", true),
      number("quantity", "Quantity", true),
      select(
        "status",
        "Status",
        ["Reserved", "Released", "Consumed", "Cancelled"],
        true,
      ),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
    ];
  }
  if (value === "distribution returns" || value === "distribution-returns") {
    return [
      text("reference", "Return ref", true),
      date("date", "Return date", true),
      text("customer", "Customer", true),
      text("distributionOrder", "Original distribution order"),
      text("salesOrder", "Sales order"),
      text("warehouse", "Return to warehouse", true),
      {
        key: "reason",
        label: "Reason",
        type: "textarea",
        required: true,
      },
      select(
        "condition",
        "Condition",
        ["Resellable", "Damaged", "Expired", "Other"],
        true,
      ),
      number("quantity", "Quantity"),
      text("item", "Item"),
      select(
        "status",
        "Status",
        ["Requested", "In transit", "Received", "Credited", "Cancelled"],
        true,
      ),
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
      },
    ];
  }
  if (value === "gantt chart" || value === "gantt-chart") {
    return [];
  }
  if (value === "project cashflow" || value === "project-cashflow") {
    return [];
  }
  if (value === "my projects" || value === "my-projects") {
    return [];
  }
  if (value === "risks" || value.includes("project risk")) {
    return [
      text("reference", "Reference", true),
      text("project", "Project", true),
      text("phase", "Phase"),
      text("milestone", "Related milestone"),
      text("title", "Risk title", true),
      select(
        "category",
        "Category",
        ["Schedule", "Cost", "Quality", "Safety", "Legal", "Procurement", "Other"],
        true,
      ),
      select("probability", "Probability", ["Low", "Medium", "High"], true),
      select("impact", "Impact", ["Low", "Medium", "High"], true),
      select("rating", "Overall rating", ["Low", "Medium", "High", "Critical"], true),
      text("owner", "Owner"),
      date("identifiedDate", "Identified on"),
      date("dueDate", "Review by"),
      select(
        "status",
        "Status",
        ["Open", "Mitigating", "Accepted", "Closed"],
        true,
      ),
      { key: "description", label: "Description", type: "textarea", required: true },
      { key: "mitigation", label: "Mitigation plan", type: "textarea" },
    ];
  }
  if (value === "procurement list" || value === "procurement-list" || value.includes("procurement")) {
    return [
      text("reference", "Reference", true),
      text("project", "Project", true),
      text("phase", "Phase"),
      text("milestone", "Needed for milestone"),
      text("item", "Item / material", true),
      text("specification", "Spec / size"),
      number("quantity", "Quantity", true),
      text("unit", "Unit"),
      number("unitCost", "Unit cost"),
      number("amount", "Line total"),
      text("currency", "Currency"),
      text("supplier", "Preferred supplier"),
      date("neededBy", "Needed by", true),
      select(
        "status",
        "Status",
        ["Planned", "Requested", "Ordered", "Received", "Used", "Cancelled"],
        true,
      ),
      text("purchaseOrder", "Purchase order ref"),
      { key: "notes", label: "Notes / when to use", type: "textarea" },
    ];
  }
  if (value === "requirements" || value.includes("project requirement")) {
    return [
      text("reference", "Reference", true),
      text("project", "Project", true),
      text("title", "Requirement", true),
      select(
        "category",
        "Category",
        ["Functional", "Technical", "Compliance", "Commercial", "Operational", "Other"],
        true,
      ),
      select("priority", "Priority", ["Must have", "Should have", "Could have", "Won't have"], true),
      text("requestedBy", "Requested by"),
      date("neededBy", "Needed by"),
      select(
        "status",
        "Status",
        ["Open", "In progress", "Accepted", "Deferred", "Rejected"],
        true,
      ),
      { key: "description", label: "Description", type: "textarea", required: true },
      { key: "acceptance", label: "Acceptance criteria", type: "textarea" },
    ];
  }
  if (value === "project managers" || value === "project-managers" || value.includes("project manager")) {
    return [
      text("name", "Full name", true),
      text("code", "Code"),
      text("username", "Login username"),
      text("title", "Title"),
      text("department", "Department"),
      text("contractor", "Linked contractor"),
      { key: "email", label: "Email", type: "email" },
      text("phone", "Telephone", true),
      select("status", "Status", ["Active", "Inactive"], true),
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "contractors") {
    return [
      text("name", "Contact name", true),
      text("company", "Company", true),
      text("code", "Code"),
      text("username", "Login username"),
      select("type", "Type", ["Construction", "Technology", "Service", "Other"], true),
      { key: "address", label: "Address", type: "textarea" },
      text("phone", "Telephone", true),
      { key: "email", label: "Email", type: "email" },
      {
        key: "paymentDetails",
        label: "Payment details",
        type: "textarea",
        placeholder: "Bank name, account name, account number, mobile money…",
      },
      text("trade", "Trade / specialty"),
      select("status", "Status", ["Active", "Inactive"], true),
      {
        key: "attachments",
        label: "Documents",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "projects" || value === "new project" || value === "new-project") {
    return [
      text("name", "Project name", true),
      text("contractor", "Contractor"),
      text("manager", "Project manager"),
      text("siteEngineer", "Site engineer"),
      select(
        "type",
        "Category of work",
        ["Construction", "Technology", "Service"],
        true,
      ),
      date("startDate", "Start date"),
      date("endDate", "Due date"),
      text("currency", "Currency", true),
      number("budget", "Contract value"),
      number("progressPercent", "Overall progress %"),
      select(
        "status",
        "Status",
        ["Planned", "Active", "On hold", "Completed", "Cancelled"],
        true,
      ),
      {
        key: "description",
        label: "Description",
        type: "textarea",
        placeholder: "Scope, site notes, and other project details.",
      },
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
    ];
  }
  if (
    value === "project updates" ||
    value === "project-updates" ||
    value.includes("project update")
  ) {
    return [
      text("project", "Project", true),
      text("phase", "Phase"),
      text("activity", "Phase activity", true),
      number("progressPercent", "Completion %", true),
      date("date", "Update date", true),
      text("updatedBy", "Updated by"),
      select(
        "status",
        "Status",
        ["Draft", "Posted", "Superseded"],
        true,
      ),
      {
        key: "description",
        label: "Description",
        type: "textarea",
        required: true,
        placeholder: "What changed on this activity?",
      },
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
    ];
  }
  if (value === "phases") {
    return [
      text("name", "Phase name", true),
      text("code", "Code"),
      text("project", "Project", true),
      number("sortOrder", "Order"),
      date("startDate", "Start date"),
      date("endDate", "End date"),
      text("currency", "Currency"),
      number("budget", "Phase budget"),
      number("progressPercent", "Progress %"),
      select(
        "status",
        "Status",
        ["Planned", "In progress", "Completed", "On hold", "Cancelled"],
        true,
      ),
      { key: "description", label: "Description", type: "textarea" },
    ];
  }
  if (value === "activities" || value === "tasks") {
    return [
      text("name", value === "tasks" ? "Task name" : "Activity name", true),
      text("code", "Code"),
      text("project", "Project", true),
      text("phase", "Phase", true),
      text("assignee", "Assignee"),
      text("contractor", "Contractor"),
      date("startDate", "Start date"),
      date("dueDate", "Due date"),
      select("priority", "Priority", ["Low", "Medium", "High", "Urgent"], true),
      number("estimatedHours", "Estimated hours"),
      number("loggedHours", "Logged hours"),
      number("progressPercent", "Progress %"),
      select(
        "status",
        "Status",
        ["Todo", "In progress", "Blocked", "Done", "Cancelled"],
        true,
      ),
      {
        key: "description",
        label: "Description",
        type: "textarea",
        placeholder: "Work under this phase. Add optional sub-activities separately.",
      },
    ];
  }
  if (value === "sub activities" || value === "sub-activities") {
    return [
      text("name", "Sub-activity name", true),
      text("code", "Code"),
      text("project", "Project", true),
      text("phase", "Phase", true),
      text("activity", "Activity", true),
      text("assignee", "Assignee"),
      text("contractor", "Contractor"),
      date("startDate", "Start date"),
      date("dueDate", "Due date"),
      select("priority", "Priority", ["Low", "Medium", "High", "Urgent"], true),
      number("estimatedHours", "Estimated hours"),
      number("loggedHours", "Logged hours"),
      number("progressPercent", "Progress %"),
      select(
        "status",
        "Status",
        ["Todo", "In progress", "Blocked", "Done", "Cancelled"],
        true,
      ),
      {
        key: "description",
        label: "Description",
        type: "textarea",
        placeholder: "Optional breakdown under an activity — add as many as needed.",
      },
    ];
  }
  if (value === "milestones") {
    return [
      text("name", "Milestone", true),
      text("project", "Project", true),
      text("phase", "Phase"),
      text("contractor", "Contractor"),
      date("dueDate", "Due date", true),
      date("completedDate", "Completed date"),
      number("paymentAmount", "Payment on approval"),
      text("currency", "Currency"),
      select(
        "status",
        "Status",
        ["Planned", "In progress", "Submitted", "Approved", "Rejected"],
        true,
      ),
      { key: "evidence", label: "Evidence / notes", type: "textarea" },
    ];
  }
  if (value === "requisitions" || value.includes("material request")) {
    return withRequestFeedbackFields([
      text("reference", "Reference", true),
      date("date", "Request date", true),
      text("project", "Project", true),
      text("phase", "Phase"),
      text("activity", "Activity"),
      text("milestone", "Linked milestone"),
      text("contractor", "Contractor", true),
      // Line items are edited in MaterialRequestLinesEditor (or CSV import).
      // fulfillmentPath / approved* / fulfilledDate are set by the approval chain, not the form.
      { key: "description", label: "Materials / items", type: "textarea" },
      number("quantity", "Quantity"),
      text("unit", "Unit"),
      number("amount", "Estimated amount"),
      text("currency", "Currency"),
      date("neededBy", "Date required", true),
      select(
        "status",
        "Status",
        FORM_SUBMIT_STATUS_OPTIONS,
        true,
      ),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
      {
        key: "notes",
        label: "Notes",
        type: "textarea",
        placeholder: "Optional notes for QS / PM / Stores.",
      },
    ]);
  }
  if (
    value.includes("equipment") &&
    (value.includes("vehicle") || value.includes("request"))
  ) {
    return withRequestFeedbackFields([
      text("reference", "Reference", true),
      date("date", "Request date", true),
      text("project", "Project", true),
      text("phase", "Phase"),
      text("requestedBy", "Requested by", true),
      select(
        "requestType",
        "Request type",
        ["Equipment", "Vehicle", "Equipment & Vehicle"],
        true,
      ),
      {
        key: "description",
        label: "Equipment / vehicle details",
        type: "textarea",
        required: true,
      },
      date("neededBy", "Needed by"),
      date("returnDate", "Expected return"),
      select(
        "status",
        "Status",
        EQUIPMENT_STATUS_OPTIONS,
        true,
      ),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ]);
  }
  if (value.includes("document request")) {
    return withRequestFeedbackFields([
      text("reference", "Reference", true),
      date("date", "Request date", true),
      text("project", "Project", true),
      text("phase", "Phase"),
      text("requestedBy", "Requested by", true),
      select(
        "documentType",
        "Document type",
        [
          "Contract",
          "Drawing",
          "Specification",
          "Report",
          "Certificate",
          "Correspondence",
          "Other",
        ],
        true,
      ),
      {
        key: "description",
        label: "Document description",
        type: "textarea",
        required: true,
      },
      date("neededBy", "Needed by"),
      select(
        "status",
        "Status",
        DOCUMENT_STATUS_OPTIONS,
        true,
      ),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ]);
  }
  if (value.includes("work program")) {
    return [
      text("name", "Program name", true),
      text("project", "Project", true),
      text("phase", "Phase", true),
      text("activity", "Activity"),
      date("scheduledStart", "Scheduled start", true),
      date("scheduledEnd", "Scheduled end", true),
      text("assignedTo", "Assigned to"),
      select(
        "status",
        "Status",
        ["Planned", "Scheduled", "In progress", "Completed", "Deferred", "Cancelled"],
        true,
      ),
      {
        key: "description",
        label: "Schedule notes",
        type: "textarea",
        placeholder: "Pick phases/activities and schedule the work program.",
      },
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
    ];
  }
  if (value.includes("variation")) {
    return [
      text("reference", "Reference", true),
      date("date", "Variation date", true),
      text("project", "Project", true),
      text("phase", "Phase"),
      text("activity", "Original activity"),
      {
        key: "description",
        label: "Variation description",
        type: "textarea",
        required: true,
        placeholder: "Describe the change from the original project activity.",
      },
      number("amountImpact", "Value impact"),
      text("currency", "Currency"),
      number("scheduleDays", "Schedule impact (days)"),
      number("progressPercent", "Revised progress %"),
      select(
        "status",
        "Status",
        ["Draft", "Submitted", "Approved", "Applied", "Rejected", "Cancelled"],
        true,
      ),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (
    value === "general requests" ||
    value === "general-requests" ||
    value === "requests"
  ) {
    return withRequestFeedbackFields([
      text("reference", "Reference", true),
      date("date", "Request date", true),
      text("requestedBy", "Requested by", true),
      text("department", "Department"),
      select(
        "category",
        "Category",
        [
          "Admin",
          "IT",
          "Facilities",
          "Procurement",
          "Travel",
          "Finance",
          "HR",
          "Operations",
          "Other",
        ],
        true,
      ),
      text("subject", "Subject", true),
      {
        key: "description",
        label: "What do you need?",
        type: "textarea",
        required: true,
        placeholder: "Describe the request — supplies, services, approval, support, etc.",
      },
      number("amount", "Estimated amount"),
      text("currency", "Currency"),
      date("neededBy", "Needed by"),
      select("priority", "Priority", ["Low", "Medium", "High", "Urgent"], true),
      text(
        "approver",
        "Additional notify (optional)",
        false,
      ),
      select(
        "status",
        "Status",
        FORM_SUBMIT_STATUS_OPTIONS,
        true,
      ),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ]);
  }
  if (
    value === "oral payment requests" ||
    value === "oral-payment-requests" ||
    value.includes("oral payment")
  ) {
    return withRequestFeedbackFields([
      text("reference", "Reference", true),
      date("date", "Request date", true),
      text("requestedBy", "Requestor", true),
      text("department", "Department"),
      text("payee", "Payee", true),
      number("amount", "Amount", true),
      text("currency", "Currency"),
      text("bankAccount", "Pay from (bank / cash)"),
      {
        key: "purpose",
        label: "Purpose / oral brief",
        type: "textarea",
        required: true,
        placeholder: "Why payment is needed — oral requisition details.",
      },
      date("neededBy", "Needed by"),
      select("priority", "Priority", ["Low", "Medium", "High", "Urgent"], true),
      select(
        "status",
        "Status",
        FORM_SUBMIT_STATUS_OPTIONS,
        true,
      ),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ]);
  }
  if (value.includes("payment request") && !value.includes("oral")) {
    return withRequestFeedbackFields([
      text("reference", "IPC / reference", true),
      date("date", "Request date", true),
      text("project", "Project", true),
      text("phase", "Phase"),
      text("milestone", "Linked milestone"),
      text("department", "Department"),
      text("contractor", "Contractor / requester", true),
      select(
        "payTo",
        "Pay to",
        ["Client", "Project owner", "Accounts", "Main contractor", "Other"],
        true,
      ),
      text("payee", "Payee name"),
      number("amount", "Amount", true),
      text("currency", "Currency"),
      date("dueDate", "Due by"),
      select(
        "status",
        "Status",
        // Status after Submitted is set only via the approval desk chain.
        FORM_SUBMIT_STATUS_OPTIONS,
        true,
      ),
      text("bankAccount", "Pay from (bank / cash)"),
      {
        key: "description",
        label: "Description",
        type: "textarea",
        placeholder: "Interim Payment Certificate (IPC) details…",
      },
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ]);
  }
  if (value.includes("progress certificate")) {
    return [
      text("reference", "Reference", true),
      date("date", "Certificate date", true),
      text("project", "Project", true),
      text("phase", "Phase"),
      text("milestone", "Linked milestone"),
      text("contractor", "Contractor", true),
      number("plannedPercent", "Planned %", true),
      number("actualPercent", "Actual %", true),
      number("projectionPercent", "Projection %"),
      number("amount", "Certified amount"),
      text("currency", "Currency"),
      select(
        "status",
        "Status",
        ["Draft", "Submitted", "Approved", "Rejected"],
        true,
      ),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
        placeholder: "Signed certificate / site evidence",
      },
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value.includes("time entr")) {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("project", "Project", true),
      text("task", "Task"),
      text("employee", "Employee / person", true),
      number("hours", "Hours", true),
      number("rate", "Billable rate"),
      number("amount", "Billable amount"),
      select("billable", "Billable", ["Yes", "No"], true),
      { key: "description", label: "Work description", type: "textarea" },
      status,
    ];
  }
  if (value.includes("project expense")) {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("project", "Project", true),
      text("supplier", "Supplier / payee"),
      { key: "description", label: "Description", type: "textarea", required: true },
      text("expenseAccount", "Expense account", true),
      text("division", "Class / division"),
      number("amount", "Amount", true),
      text("currency", "Currency"),
      status,
    ];
  }
  if (value.includes("project billing")) {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("project", "Project", true),
      text("customer", "Customer", true),
      { key: "description", label: "Description", type: "textarea" },
      text("incomeAccount", "Income account", true),
      text("division", "Class / division"),
      number("amount", "Amount", true),
      text("invoice", "Linked sales invoice"),
      status,
    ];
  }
  if (value === "pos locations" || value === "pos-locations" || value.includes("pos location")) {
    return [
      select(
        "kind",
        "Type",
        ["store", "kiosk", "counter", "stall", "branch", "market", "other"],
        true,
      ),
      text("name", "Name", true),
      text("code", "Code"),
      text("address", "Address"),
      select("status", "Status", ["Active", "Inactive"], true),
    ];
  }
  if (value === "registers") {
    return [
      text("name", "Register name", true),
      text("code", "Code", true),
      text("location", "POS location / place", true),
      text("account", "Received in", true),
      text("defaultSalesAccount", "Default sales account"),
      select("status", "Status", ["Active", "Inactive"], true),
    ];
  }
  if (value.includes("dining table") || value === "dining-tables") {
    return [
      text("name", "Table name", true),
      text("code", "Code"),
      number("seats", "Seats"),
      select("area", "Area", ["Dining", "Bar", "Patio", "Counter", "Private"], true),
      select("status", "Status", ["Available", "Occupied", "Reserved", "Inactive"], true),
    ];
  }
  if (value === "pos products" || value === "pos-products" || value.includes("pos product")) {
    return [
      text("name", "Product name", true),
      text("code", "SKU / code", true),
      text("category", "Category"),
      text("unit", "Unit"),
      { key: "description", label: "Description", type: "textarea" },
      text("location", "POS location / place", true),
      number("openingStock", "Opening qty", true),
      number("unitValue", "Unit cost", true),
      number("stockValue", "Opening value"),
      text("salesAccount", "Sales account"),
      number("salesPrice", "Sales price", true),
      number("reorderLevel", "Reorder level"),
      number("closingStock", "On hand"),
      number("closingValue", "Stock value"),
      select("status", "Status", ["Active", "Inactive", "Discontinued"], true),
    ];
  }
  if (value === "pos services" || value === "pos-services" || value.includes("pos service")) {
    return [
      text("name", "Service name", true),
      text("code", "Code", true),
      text("category", "Category"),
      { key: "description", label: "Description", type: "textarea" },
      text("salesAccount", "Sales account"),
      number("salesPrice", "Sales price", true),
      select("status", "Status", ["Active", "Inactive"], true),
    ];
  }
  if (value === "pos stock in" || value === "pos-stock-in" || value.includes("pos stock")) {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("item", "POS product", true),
      text("location", "POS location", true),
      number("quantity", "Qty", true),
      number("unitCost", "Unit cost", true),
      number("stockValue", "Stock value"),
      text("supplier", "Supplier"),
      text("description", "Notes"),
      select(
        "status",
        "Status",
        ["Complete", "Draft", "Pending", "Approved", "Void"],
        true,
      ),
    ];
  }
  if (value.includes("open ticket") || value === "open-tickets") {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("register", "Register", true),
      text("session", "Cash session"),
      text("table", "Table"),
      select("serviceType", "Service", ["Dine-in", "Takeaway", "Delivery", "Walk-in"], true),
      text("customer", "Guest / customer"),
      number("lineCount", "Lines"),
      number("subtotal", "Subtotal"),
      number("tipAmount", "Tip"),
      number("amount", "Total", true),
      select("status", "Status", ["Open", "Paid", "Void"], true),
    ];
  }
  if (value.includes("cash session")) {
    return [
      text("reference", "Reference", true),
      date("date", "Open date", true),
      text("register", "Register", true),
      text("cashier", "Cashier", true),
      number("openingFloat", "Opening float", true),
      number("expectedCash", "Expected cash"),
      number("countedCash", "Counted cash"),
      number("variance", "Variance"),
      select(
        "status",
        "Status",
        ["Open", "Closed", "Reconciled", "Void"],
        true,
      ),
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "pos sales" || value === "pos-sales") {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("register", "Register", true),
      text("session", "Cash session"),
      text("item", "Item / service", true),
      select("lineKind", "Line type", ["inventory", "service", "open"]),
      text("location", "Location"),
      text("table", "Table"),
      select("serviceType", "Service type", ["Walk-in", "Dine-in", "Takeaway", "Delivery"]),
      text("modifiers", "Modifiers"),
      number("quantity", "Quantity", true),
      number("unitPrice", "Unit price", true),
      number("amount", "Amount (incl. tax)", true),
      number("taxRate", "VAT %"),
      number("taxAmount", "VAT amount"),
      text("taxAccount", "Tax account"),
      text("account", "Received in", true),
      text("salesAccount", "Sales account"),
      select("tender", "Tender", ["Cash", "Card", "Mobile money", "Other"], true),
      text("customer", "Customer"),
      text("ticket", "Ticket / receipt #"),
      text("division", "Class / division"),
      { key: "description", label: "Description", type: "textarea" },
      status,
    ];
  }
  if (value.includes("pos return")) {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("register", "Register", true),
      text("originalSale", "Original sale"),
      text("item", "Inventory item", true),
      text("location", "Location"),
      number("quantity", "Quantity", true),
      number("unitPrice", "Unit price", true),
      number("amount", "Refund amount", true),
      text("account", "Paid from", true),
      text("division", "Class / division"),
      { key: "description", label: "Reason", type: "textarea" },
      status,
    ];
  }
  if (value.includes("daily closing")) {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("register", "Register", true),
      number("salesTotal", "Sales total"),
      number("returnsTotal", "Returns total"),
      number("netTotal", "Net total"),
      number("cashTotal", "Cash total"),
      number("cardTotal", "Card total"),
      number("mobileTotal", "Mobile money total"),
      number("bankDeposit", "Bank deposit (cash)"),
      text("depositTo", "Deposit to bank account"),
      text("registerAccount", "Till / register account"),
      select("status", "Status", ["Draft", "Closed", "Posted"], true),
      { key: "notes", label: "Notes", type: "textarea" },
    ];
  }
  if (value === "payslips") {
    return [
      text("reference", "Reference", true),
      date("date", "Pay date", true),
      text("employee", "Name", true),
      text("employeeId", "ID"),
      text("department", "Department"),
      text("bankAccount", "Bank"),
      text("bankCode", "Bank code"),
      text("accountNumber", "Account number"),
      text("phone", "Phone number"),
      number("basicPay", "Basic pay", true),
      number("dailyRate", "Daily rate (Basic÷30)"),
      number("daysWorked", "Days worked", true),
      number("adjustedBasic", "Adjusted basic"),
      number("nssfEmployee", "NSSF"),
      number("paye", "PAYE"),
      number("advances", "Advances"),
      number("arrears", "Arrears"),
      number("netPay", "Net pay", true),
      number("nssfEmployer", "NSSF employer (10%)"),
      number("earnings", "Earnings"),
      number("deductions", "Total deductions"),
      number("contributions", "Employer contributions"),
      number("daysInPeriod", "Days in period"),
      text("payrollRunId", "Payroll run"),
      status,
    ];
  }
  if (
    value === "payroll runs" ||
    value === "payroll-runs" ||
    value.includes("payroll run")
  ) {
    return withRequestFeedbackFields([
      text("reference", "Reference", true),
      date("date", "Pay date", true),
      text("requestedBy", "Requestor", true),
      text("department", "Department"),
      number("employeeCount", "Employees", true),
      number("defaultDays", "Default days worked"),
      number("grossTotal", "Gross total"),
      number("payeTotal", "PAYE total"),
      number("nssfTotal", "NSSF total"),
      number("amount", "Net pay total", true),
      text("currency", "Currency"),
      {
        key: "purpose",
        label: "Notes",
        type: "textarea",
        placeholder: "Payroll period notes for Accounts / GM / CEO…",
      },
      select("status", "Status", FORM_SUBMIT_STATUS_OPTIONS, true),
      text("overridesJson", "Employee overrides (JSON)"),
      text("payslipsCreated", "Payslips created"),
      text("payslipCount", "Payslip count"),
      text("payslipIds", "Payslip IDs"),
      {
        key: "attachments",
        label: "Attachments",
        type: "attachments",
      },
    ]);
  }
  if (value.includes("fixed asset")) return fixedAssetFields;
  if (value.includes("intangible asset")) return assetFields;
  if (value.includes("depreciation") || value.includes("amortization")) return [text("reference", "Reference", true), date("date", "Date", true), text("asset", "Asset", true), number("amount", "Amount", true), text("description", "Description"), status];
  if (value.includes("capital account") || value.includes("special account")) return [text("name", "Account name", true), text("code", "Code", true), text("owner", "Owner / member"), number("openingBalance", "Opening balance"), number("balance", "Current balance"), status];
  if (value.includes("chart of accounts")) {
    return [
      select("kind", "Kind", ["Account", "Group"], true),
      text("name", "Name", true),
      text("code", "Account code"),
      select("type", "Account type", ["Asset", "Liability", "Equity", "Income", "Expense"], true),
      text("group", "Group"),
      text("parentGroup", "Subgroup of"),
      select("currency", "Currency", ["UGX", "USD", "EUR"], true),
      text("division", "Class / division"),
      number("openingBalance", "Opening balance"),
      number("balance", "Current balance"),
      select("status", "Status", ["Active", "Inactive"], true),
    ];
  }
  if (value.includes("journal")) {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("division", "Class / division"),
      { key: "narration", label: "Narration", type: "textarea", required: true },
      status,
    ];
  }
  if (value.includes("report") || value.includes("balance sheet") || value.includes("profit"))
    return [
      text("name", "Report name", true),
      select(
        "type",
        "Report type",
        [
          "Balance Sheet",
          "Profit & Loss",
          "Trial Balance",
          "Cash Flow",
          "Tax",
          "Aged Receivables",
          "Aged Payables",
          "Custom",
        ],
        true,
      ),
      date("from", "From"),
      date("to", "To"),
      select("basis", "Accounting basis", ["Accrual", "Cash"]),
      status,
    ];
  if (value.includes("ledger") || value.includes("trial balance"))
    return [
      text("account", "Account", true),
      text("code", "Code"),
      number("debit", "Debit"),
      number("credit", "Credit"),
      number("balance", "Balance"),
      date("asOf", "As of date", true),
      status,
    ];
  if (value.includes("folder")) return [text("name", "Folder name", true), text("description", "Description"), text("owner", "Owner"), status];
  if (value.includes("attachment")) return [text("name", "File name", true), text("folder", "Folder"), text("linkedTo", "Linked record"), text("fileUrl", "File URL"), date("date", "Uploaded date"), status];
  if (value.includes("withholding")) {
    return [
      text("reference", "Reference", true),
      date("date", "Date", true),
      text("party", value.includes("receipt") ? "Customer" : "Supplier", true),
      text("invoice", "Linked invoice"),
      number("amount", "WHT amount", true),
      number("rate", "Rate %"),
      text("division", "Class / division"),
      { key: "description", label: "Description", type: "textarea" },
      status,
    ];
  }
  if (value.includes("billable time")) return [date("date", "Date", true), text("customer", "Customer", true), text("description", "Work performed", true), number("hours", "Hours", true), number("rate", "Hourly rate", true), number("amount", "Amount", true), text("division", "Class / division"), status];
  if (value.includes("billable expense") || value.includes("expense claim")) return [text("reference", "Reference", true), date("date", "Date", true), text("claimant", "Claimant / customer", true), text("description", "Description", true), text("account", "Expense account", true), text("division", "Class / division"), number("amount", "Amount", true), { key: "attachments", label: "Attachments", type: "attachments", placeholder: "Receipts and supporting documents" }, status];
  if (value.includes("investment")) {
    return [
      text("name", "Name", true),
      text("code", "Code", true),
      date("date", "Acquisition date", true),
      { key: "description", label: "Description", type: "textarea" },
      number("amount", "Amount", true),
      status,
    ];
  }
  if (value.includes("matching") || value.includes("accrual") || value.includes("prepayment")) {
    return [
      text("name", "Name", true),
      text("code", "Code", true),
      date("date", "Date", true),
      { key: "description", label: "Description", type: "textarea" },
      number("amount", "Amount", true),
      status,
    ];
  }
  return [text("name", "Name", true), text("code", "Code", true), { key: "description", label: "Description", type: "textarea" }, number("amount", "Amount"), status];
}

export function entityDefinitions(module: ModuleSlug): EntityDefinition[] {
  const nav = NAV_MODULES.find((item) => item.slug === module);
  // Legacy combined slug — keep definitions available for any leftover callers.
  const items =
    module === "requests"
      ? ["General Requests", "Oral Payment Requests"]
      : (nav?.items ?? []);
  return items.map((label) => {
    const fields = fieldsFor(label);
    const key = entityKey(label);
    const columns =
      MAINTENANCE_COLUMNS[key] ??
      (key === "chart-of-accounts"
        ? ["kind", "name", "code", "type", "group", "currency", "balance", "status"]
        : key === "bank-and-cash-accounts"
          ? [
              "name",
              "glAccount",
              "institution",
              "type",
              "currency",
              "openingBalance",
              "balance",
              "uncategorizedReceipts",
              "uncategorizedPayments",
            ]
          : key === "inter-account-transfers"
            ? ["reference", "date", "from", "to", "amount", "status"]
            : key === "fixed-assets"
              ? [
                  // List stays scannable — full register lives on the detail page.
                  "code",
                  "name",
                  "group",
                  "location",
                  "acquired",
                  "bookValue",
                  "status",
                ]
            : key === "inventory-items"
              ? [
                  "name",
                  "code",
                  "location",
                  "openingStock",
                  "stockValue",
                  "closingStock",
                  "closingValue",
                  "status",
                ]
              : key === "pos-products"
                ? [
                    "name",
                    "code",
                    "category",
                    "location",
                    "salesPrice",
                    "closingStock",
                    "status",
                  ]
                : key === "pos-services"
                  ? ["name", "code", "category", "salesPrice", "status"]
              : key === "sales-invoices" ||
                  key === "invoices" ||
                  key === "purchase-invoices" ||
                  key === "bills"
                ? [
                    "reference",
                    "date",
                    "dueDate",
                    "party",
                    "amount",
                    "amountPaid",
                    "balanceDue",
                    "division",
                    "status",
                  ]
              : key === "stock-in" || key === "pos-stock-in"
                ? [
                    "reference",
                    "date",
                    "item",
                    "location",
                    "quantity",
                    "unitCost",
                    "stockValue",
                    "status",
                  ]
                : key === "inventory-transfers"
                  ? ["reference", "date", "item", "from", "to", "quantity", "receivedDate", "status"]
                  : key === "inventory-locations" || key === "pos-locations"
                    ? ["kind", "name", "code", "address", "status"]
                    : key === "inventory-write-offs"
                      ? [
                          "reference",
                          "date",
                          "item",
                          "reasonType",
                          "quantity",
                          "amount",
                          "status",
                        ]
                      : key === "inventory-sales"
                        ? [
                            "reference",
                            "date",
                            "party",
                            "item",
                            "quantity",
                            "unitPrice",
                            "amount",
                            "status",
                          ]
            : key === "project-managers"
              ? ["name", "title", "contractor", "email", "phone", "status"]
            : key === "suppliers"
              ? ["name", "category", "contacts", "location", "email", "status"]
            : key === "contractors"
              ? ["name", "company", "phone", "email", "type", "status"]
              : key === "projects"
              ? ["name", "type", "contractor", "manager", "siteEngineer", "progressPercent", "budget", "currency", "startDate", "endDate", "status"]
              : key === "project-updates"
                ? ["date", "project", "activity", "progressPercent", "updatedBy", "status"]
              : key === "phases"
                ? ["name", "project", "sortOrder", "progressPercent", "endDate", "budget", "currency", "status"]
              : key === "activities" || key === "tasks"
                ? ["name", "project", "phase", "progressPercent", "assignee", "dueDate", "status"]
              : key === "sub-activities"
                ? [
                    "name",
                    "project",
                    "phase",
                    "activity",
                    "progressPercent",
                    "assignee",
                    "startDate",
                    "dueDate",
                    "priority",
                    "status",
                  ]
                : key === "milestones"
                  ? ["name", "project", "phase", "dueDate", "paymentAmount", "status"]
                  : key === "risks"
                    ? ["reference", "project", "title", "rating", "owner", "dueDate", "status"]
                  : key === "procurement-list"
                    ? ["reference", "project", "item", "quantity", "neededBy", "amount", "status"]
                  : key === "requirements"
                    ? ["reference", "project", "title", "category", "priority", "neededBy", "status"]
                  : key === "drivers"
                    ? [
                        "name",
                        "phone",
                        "licenseNumber",
                        "licenseClass",
                        "licenseExpiry",
                        "vehicle",
                        "department",
                        "status",
                      ]
                  : key === "departments"
                    ? ["name", "code", "manager", "location", "headcount", "status"]
                  : key === "vehicles"
                    ? ["name", "registration", "type", "driver", "odometer", "insuranceExpiry", "status"]
                    : key === "fuel-requests"
                      ? ["reference", "date", "vehicle", "driver", "litres", "amount", "status"]
                    : key === "fuel-logs"
                      ? [
                          "reference",
                          "date",
                          "vehicle",
                          "driver",
                          "litres",
                          "amount",
                          "expenseAccount",
                          "bankAccount",
                          "status",
                        ]
                      : key === "trip-requests"
                        ? ["reference", "date", "vehicle", "driver", "fromLocation", "toLocation", "departDate", "status"]
                      : key === "maintenance-requests"
                        ? ["reference", "date", "vehicle", "requestedBy", "priority", "neededBy", "status"]
                      : key === "fleet-cost-report"
                        ? ["name"]
                  : key === "gate-passes"
                    ? [
                        "reference",
                        "date",
                        "passType",
                        "person",
                        "validTo",
                        "status",
                      ]
                  : key === "visitor-passes"
                    ? [
                        "reference",
                        "date",
                        "name",
                        "host",
                        "purpose",
                        "status",
                      ]
                  : key === "security-incidents"
                    ? [
                        "reference",
                        "date",
                        "type",
                        "severity",
                        "location",
                        "status",
                      ]
                  : key === "requisitions"
                    ? ["reference", "date", "project", "contractor", "neededBy", "status"]
                  : key === "equipment-and-vehicle-requests"
                    ? ["reference", "date", "project", "requestType", "requestedBy", "neededBy", "status"]
                  : key === "document-requests"
                    ? ["reference", "date", "project", "documentType", "requestedBy", "neededBy", "status"]
                  : key === "work-programs"
                    ? ["name", "project", "phase", "activity", "scheduledStart", "scheduledEnd", "status"]
                  : key === "variations-of-work"
                    ? ["reference", "date", "project", "activity", "amountImpact", "status"]
                    : key === "general-requests"
                      ? [
                          "reference",
                          "date",
                          "requestedBy",
                          "department",
                          "category",
                          "subject",
                          "priority",
                          "amount",
                          "status",
                        ]
                    : key === "oral-payment-requests"
                      ? [
                          "reference",
                          "date",
                          "requestedBy",
                          "department",
                          "payee",
                          "amount",
                          "priority",
                          "status",
                        ]
                    : key === "payment-requests"
                      ? ["reference", "date", "department", "project", "milestone", "payTo", "amount", "status"]
                      : key === "progress-certificates"
                        ? [
                            "reference",
                            "date",
                            "project",
                            "milestone",
                            "contractor",
                            "actualPercent",
                            "amount",
                            "status",
                          ]
                : key === "time-entries"
                  ? ["reference", "date", "project", "employee", "hours", "amount", "status"]
                  : key === "project-expenses"
                    ? ["reference", "date", "project", "supplier", "amount", "status"]
                    : key === "project-billings"
                      ? ["reference", "date", "project", "customer", "amount", "status"]
                      : key === "registers"
                        ? ["name", "code", "location", "account", "status"]
                        : key === "dining-tables"
                          ? ["name", "code", "seats", "area", "status"]
                          : key === "open-tickets"
                            ? [
                                "reference",
                                "date",
                                "register",
                                "table",
                                "serviceType",
                                "amount",
                                "status",
                              ]
                        : key === "cash-sessions"
                          ? ["reference", "date", "register", "cashier", "openingFloat", "status"]
                          : key === "pos-sales"
                            ? [
                                "reference",
                                "date",
                                "register",
                                "item",
                                "lineKind",
                                "quantity",
                                "amount",
                                "tender",
                                "status",
                              ]
                            : key === "pos-returns"
                              ? [
                                  "reference",
                                  "date",
                                  "register",
                                  "item",
                                  "quantity",
                                  "amount",
                                  "status",
                                ]
                              : key === "daily-closings"
                                ? [
                                    "reference",
                                    "date",
                                    "register",
                                    "salesTotal",
                                    "netTotal",
                                    "status",
                                  ]
            : key === "history"
              ? ["timestamp", "user", "email", "action", "module", "entity", "recordLabel"]
              : key === "deleted-records"
                ? [
                    "timestamp",
                    "deletedBy",
                    "deletedByEmail",
                    "module",
                    "entity",
                    "recordLabel",
                    "status",
                  ]
            : key === "receipts" || key === "payments"
              ? [
                  "reference",
                  "date",
                  "account",
                  "party",
                  "amount",
                  "postingAccount",
                  "division",
                  "allocation",
                ]
              : key === "reconciliations"
                ? [
                    "reference",
                    "date",
                    "account",
                    "statementBalance",
                    "systemBalance",
                    "discrepancy",
                    "status",
                  ]
              : key === "employees"
                ? [
                    "name",
                    "code",
                    "department",
                    "jobTitle",
                    "phone",
                    "medicalInsurer",
                    "basicPay",
                    "status",
                  ]
                : key === "leads"
                  ? ["name", "code", "company", "stage", "owner", "nextFollowUp", "status"]
                  : key === "opportunities"
                    ? ["name", "customer", "stage", "amount", "expectedClose", "owner", "status"]
                    : key === "contacts"
                      ? ["name", "customer", "title", "phone", "email", "status"]
                      : key === "follow-ups"
                        ? ["reference", "date", "type", "subject", "relatedTo", "status"]
                        : key === "complaints"
                          ? ["reference", "date", "customer", "category", "priority", "status"]
                          : key === "shipments"
                            ? [
                                "reference",
                                "date",
                                "customer",
                                "fromLocation",
                                "toLocation",
                                "vehicle",
                                "status",
                              ]
                            : key === "dispatch-board"
                              ? ["reference", "date", "shipment", "vehicle", "driver", "status"]
                              : key === "routes"
                                ? ["name", "code", "zone", "distanceKm", "status"]
                                : key === "proof-of-delivery"
                                  ? [
                                      "reference",
                                      "date",
                                      "shipment",
                                      "customer",
                                      "receivedBy",
                                      "condition",
                                      "status",
                                    ]
                                  : key === "carriers"
                                    ? ["name", "code", "phone", "type", "status"]
                                    : key === "distribution-orders"
                                      ? [
                                          "reference",
                                          "date",
                                          "customer",
                                          "salesOrder",
                                          "warehouse",
                                          "fulfillmentStage",
                                          "status",
                                        ]
                                      : key === "picking-lists"
                                        ? [
                                            "reference",
                                            "date",
                                            "distributionOrder",
                                            "warehouse",
                                            "picker",
                                            "status",
                                          ]
                                        : key === "packing-lists"
                                          ? [
                                              "reference",
                                              "date",
                                              "distributionOrder",
                                              "packages",
                                              "packer",
                                              "status",
                                            ]
                                          : key === "delivery-runs"
                                            ? [
                                                "reference",
                                                "date",
                                                "route",
                                                "vehicle",
                                                "driver",
                                                "status",
                                              ]
                                            : key === "stock-allocations"
                                              ? [
                                                  "reference",
                                                  "date",
                                                  "salesOrder",
                                                  "item",
                                                  "warehouse",
                                                  "quantity",
                                                  "status",
                                                ]
                                              : key === "distribution-returns"
                                                ? [
                                                    "reference",
                                                    "date",
                                                    "customer",
                                                    "warehouse",
                                                    "condition",
                                                    "status",
                                                  ]
                : key === "leave-requests"
                  ? ["reference", "employee", "leaveType", "startDate", "days", "status"]
                  : key === "sites"
                    ? ["name", "code", "latitude", "longitude", "radiusMeters", "status"]
                    : key === "blocks"
                      ? ["name", "site", "latitude", "longitude", "radiusMeters", "status"]
                  : key === "payroll-runs"
                    ? ["reference", "date", "employeeCount", "amount", "status"]
                  : key === "attendance"
                    ? ["reference", "date", "employee", "site", "clockIn", "verification", "status"]
                  : key === "job-positions"
                      ? ["title", "department", "employmentType", "headcount", "status"]
                      : key === "onboarding"
                        ? ["reference", "employee", "position", "startDate", "checklist", "status"]
                        : key === "holidays"
                          ? ["name", "date", "kind", "status"]
                : key === "payslips"
                  ? ["employee", "employeeId", "daysWorked", "adjustedBasic", "nssfEmployee", "paye", "netPay"]
                  : fields
                  .filter((field) => !["textarea"].includes(field.type ?? ""))
                  .slice(0, 6)
                  .map((field) => field.key));
    return {
      key,
      label,
      singular: label.replace(/ies$/, "y").replace(/s$/, ""),
      fields,
      columns,
    };
  });
}

export function formatFieldValue(field: EntityField, value: string, record?: ManagerRecord) {
  if (field.type === "attachments") {
    if (!value) return "—";
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.length === 1
          ? String((parsed[0] as { name?: string })?.name || "1 file")
          : `${parsed.length} files`;
      }
    } catch {
      // fall through
    }
    return "—";
  }
  if (!value) return "—";
  if (field.type === "number") {
    const n = parseAmount(value);
    if (!Number.isFinite(n)) return value;
    // Live / control-account balances and live due/paid fields are in base currency.
    // Bank reconciliation balances stay in the bank account currency (USD bank → USD).
    const baseOnlyKeys = new Set([
      "balance",
      "debit",
      "credit",
      "balanceDue",
      "amountPaid",
    ]);
    const bankReconMoneyKeys = new Set([
      "statementBalance",
      "systemBalance",
      "discrepancy",
    ]);
    // Transaction totals: show foreign amount + auto-converted base.
    const dualKeys = new Set(["amount", "total"]);
    // Other money fields stay in the record's own currency (no dual line).
    const moneyKeys = new Set([
      "balance",
      "amount",
      "total",
      "openingBalance",
      "debit",
      "credit",
      "unitPrice",
      "bookValue",
      "cost",
      "otherCosts",
      "totalAcquisitionCost",
      "netPay",
      "earnings",
      "budget",
      "income",
      "spent",
      "cost",
      "hours",
      "rate",
      "estimatedHours",
      "loggedHours",
      "openingFloat",
      "expectedCash",
      "countedCash",
      "variance",
      "salesTotal",
      "returnsTotal",
      "netTotal",
      "cashTotal",
      "cardTotal",
      "mobileTotal",
      "purchasePrice",
      "salesPrice",
      "unitValue",
      "unitCost",
      "stockValue",
      "closingValue",
      "inventoryValue",
      "averageCost",
      "statementBalance",
      "systemBalance",
      "discrepancy",
      "creditLimit",
      "balanceDue",
      "amountPaid",
      "basicPay",
      "dailyRate",
      "adjustedBasic",
      "paye",
      "nssfEmployee",
      "nssfEmployer",
      "advances",
      "arrears",
      "deductions",
      "contributions",
    ]);
    if (moneyKeys.has(field.key)) {
      let currencyCode = record?.currency || record?.currencyCode;
      // Reconciliations store amounts in the bank's currency — resolve from account when missing.
      if (bankReconMoneyKeys.has(field.key)) {
        const accountName = (record?.account || record?.bankAccount || "").trim();
        if (!currencyCode && accountName) {
          if (/\bUSD\b/i.test(accountName)) currencyCode = "USD";
          else if (/\bEUR\b/i.test(accountName)) currencyCode = "EUR";
          else if (/\bGBP\b/i.test(accountName)) currencyCode = "GBP";
        }
        return formatMoney(n, { currencyCode: currencyCode || undefined });
      }
      const asOf = record?.date || record?.issueDate;
      if (baseOnlyKeys.has(field.key)) {
        // Live ledger balances are stored in base; for foreign parties/banks show
        // both the account currency and the base equivalent.
        if (
          currencyCode &&
          !isBaseCurrency(currencyCode) &&
          (field.key === "balance" || field.key === "closingBalance")
        ) {
          const foreign = convertBetween(n, baseCurrencyCode(), normalizeCurrency(currencyCode), asOf);
          return formatMoneyDual(foreign, currencyCode, asOf);
        }
        return formatMoney(n);
      }
      if (dualKeys.has(field.key)) {
        return formatMoneyDual(n, currencyCode, asOf);
      }
      return formatMoney(n, { currencyCode });
    }
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
  }
  return value;
}
