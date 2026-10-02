import {
  type AccountType,
  type LedgerAccount,
} from "@/lib/ledger/types";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store"
import { getAppFlag, setAppFlag } from "@/lib/db/app-prefs";
import type { ManagerRecord } from "@/lib/manager-entities";
import {
  getMemoryLedgerAccounts,
  setMemoryLedgerAccounts,
} from "@/lib/db/client-store";
import { persistLedgerAccountsToDb } from "@/lib/db/sync";

export const OPENING_BALANCES_EQUITY_CODE = "3999";
export const OPENING_BALANCES_EQUITY_NAME = "Opening balances equity";

/** One-shot install of the IAG Chart of Accounts (replaces any prior chart). */
export const COA_IAG_INSTALL_KEY = "financeiag-coa-iag-v1";

function id(code: string) {
  return `acct-${code}`;
}

function a(
  code: string,
  name: string,
  type: AccountType,
  group: string,
  currency = "UGX",
  opening = 0,
  isControl = false,
): LedgerAccount {
  return {
    id: id(code),
    code,
    name,
    type,
    group,
    currency,
    openingBalance: opening,
    isControl,
    inactive: false,
  };
}

export function withOpeningBalancesEquity(accounts: LedgerAccount[]): LedgerAccount[] {
  const normalized = accounts.map((acct) => {
    if (
      acct.code === OPENING_BALANCES_EQUITY_CODE ||
      acct.name.trim().toLowerCase() === OPENING_BALANCES_EQUITY_NAME.toLowerCase()
    ) {
      // Never let this plug sit under Assets — that zeros the balance sheet
      // (Bank debit cancelled by equity credit shown as a negative asset).
      return {
        ...acct,
        code: OPENING_BALANCES_EQUITY_CODE,
        name: OPENING_BALANCES_EQUITY_NAME,
        type: "Equity" as const,
        group: "Equity",
        openingBalance: 0,
        inactive: false,
      };
    }
    return acct;
  });
  if (normalized.some((acct) => acct.code === OPENING_BALANCES_EQUITY_CODE)) {
    return normalized;
  }
  return [
    ...normalized,
    {
      id: id(OPENING_BALANCES_EQUITY_CODE),
      code: OPENING_BALANCES_EQUITY_CODE,
      name: OPENING_BALANCES_EQUITY_NAME,
      type: "Equity",
      group: "Equity",
      currency: "UGX",
      openingBalance: 0,
      inactive: false,
    },
  ];
}

/**
 * Main Chart of Accounts for IAG (Uganda) — cash, AR/AP multi-currency,
 * inventory, fixed assets, payroll liabilities, coffee/cosmetics/restaurant P&L.
 */
export const DEFAULT_CHART: LedgerAccount[] = withOpeningBalancesEquity([
  // —— Cash and cash equivalents ——
  a("1001", "Cash-UGX", "Asset", "Cash and cash equivalents", "UGX"),
  a("1002", "Cash-USD", "Asset", "Cash and cash equivalents", "USD"),
  a("1003", "Petty Cash-UGX", "Asset", "Cash and cash equivalents", "UGX"),
  a("1050", "Bank-UGX", "Asset", "Cash and cash equivalents", "UGX", 0, true),
  a("1051", "Bank-USD", "Asset", "Cash and cash equivalents", "USD", 0, true),
  a("1052", "Bank-EUR", "Asset", "Cash and cash equivalents", "EUR", 0, true),
  // —— Accounts receivable ——
  a("1200", "Accounts Receivable-UGX", "Asset", "Accounts Receivable", "UGX", 0, true),
  a("1201", "Accounts Receivable-USD", "Asset", "Accounts Receivable", "USD", 0, true),
  a("1202", "Accounts Receivable-EUR", "Asset", "Accounts Receivable", "EUR", 0, true),
  // —— Other current assets ——
  a("1250", "Inventory Asset", "Asset", "Other Current Asset", "UGX", 0, true),
  a("1251", "Raw Material Inventory", "Asset", "Other Current Asset", "UGX"),
  a("1252", "Work-in-Progress Inventory", "Asset", "Other Current Asset", "UGX"),
  a("1253", "Finished Products Inventory", "Asset", "Other Current Asset", "UGX"),
  a("1300", "Staff Loans & Advances", "Asset", "Other Current Asset", "UGX"),
  a("1350", "Prepaid Expenses", "Asset", "Other Current Asset", "UGX"),
  a("1351", "Prepaid Rent", "Asset", "Other Current Asset", "UGX"),
  a("1352", "Prepaid Water bills", "Asset", "Other Current Asset", "UGX"),
  a("1400", "Tax Claimable Accounts", "Asset", "Other Current Asset", "UGX"),
  a("1401", "VAT Withheld Claimable", "Asset", "Other Current Asset", "UGX"),
  a("1402", "WHT Claimable", "Asset", "Other Current Asset", "UGX"),
  a("1450", "Other Current Assets", "Asset", "Other Current Asset", "UGX"),
  // —— Fixed assets ——
  a("1500", "Furniture and Equipment", "Asset", "Fixed Asset", "UGX", 0, true),
  a("1510", "Machinery and Equipment", "Asset", "Fixed Asset", "UGX"),
  a("1520", "Motor Vehicles", "Asset", "Fixed Asset", "UGX"),
  a("1530", "Computers & accessories", "Asset", "Fixed Asset", "UGX"),
  a("1540", "Land & Building", "Asset", "Fixed Asset", "UGX"),
  a("1550", "Intangible Assets", "Asset", "Fixed Asset", "UGX"),
  a("1590", "Accumulated Depreciation", "Asset", "Fixed Asset", "UGX"),
  // —— Accounts payable ——
  a("2000", "Accounts Payable-UGX", "Liability", "Accounts Payable", "UGX", 0, true),
  a("2001", "Accounts Payable-USD", "Liability", "Accounts Payable", "USD", 0, true),
  a("2002", "Accounts Payable-EUR", "Liability", "Accounts Payable", "EUR", 0, true),
  // —— Other current liabilities ——
  a("2050", "Payroll Liabilities", "Liability", "Other Current Liability", "UGX", 0, true),
  a("2051", "Net Salaries Payable", "Liability", "Other Current Liability", "UGX"),
  a("2052", "PAYE Payable", "Liability", "Other Current Liability", "UGX"),
  a("2053", "NSSF Payable", "Liability", "Other Current Liability", "UGX"),
  a("2100", "Duties & Taxes Payable", "Liability", "Other Current Liability", "UGX"),
  a("2101", "VAT Account", "Liability", "Other Current Liability", "UGX"),
  a("2102", "Income Tax Account", "Liability", "Other Current Liability", "UGX"),
  a("2200", "Short Term Loans", "Liability", "Other Current Liability", "UGX"),
  a("2300", "Rent Payable", "Liability", "Other Current Liability", "UGX"),
  a("2400", "Suspense", "Liability", "Other Current Liability", "UGX"),
  a("2410", "Accrued Liabilities", "Liability", "Other Current Liability", "UGX"),
  a("2420", "Deferred Revenue", "Liability", "Other Current Liability", "UGX"),
  // —— Long term liabilities ——
  a("2500", "Long Term Loans", "Liability", "Long Term Liability", "UGX"),
  a("2550", "Other Long Term Liabilities", "Liability", "Long Term Liability", "UGX"),
  a("2600", "Shareholders Account", "Liability", "Long Term Liability", "UGX"),
  // —— Equity ——
  a("3000", "Share Capital", "Equity", "Equity", "UGX"),
  a("3100", "Capital & Reserves", "Equity", "Equity", "UGX"),
  a("3200", "Grants & Donations", "Equity", "Equity", "UGX"),
  a("3300", "Retained Earnings", "Equity", "Equity", "UGX"),
  a("3400", "Drawings", "Equity", "Equity", "UGX"),
  // —— Income ——
  a("4000", "Coffee Sales", "Income", "Income", "UGX"),
  a("4100", "Coffee Machines and Equipments", "Income", "Income", "UGX"),
  a("4200", "Cosmetics", "Income", "Income", "UGX"),
  a("4300", "Restaurant Sales", "Income", "Income", "UGX"),
  a("4400", "Tips Received", "Income", "Income", "UGX"),
  a("4500", "POS Sales", "Income", "Income", "UGX"),
  // —— Cost of goods sold ——
  a("5000", "Coffee Products COS", "Expense", "Cost Of Goods Sold", "UGX"),
  a("5001", "Cosmetics COS", "Expense", "Cost Of Goods Sold", "UGX"),
  a("5002", "Restaurant COS", "Expense", "Cost Of Goods Sold", "UGX"),
  a("5003", "Machinery and Equipment COS", "Expense", "Cost Of Goods Sold", "UGX"),
  // —— Expenses ——
  a("6000", "Project Expenses", "Expense", "Expenses", "UGX"),
  a("6001", "Salaries and Employee Wages", "Expense", "Expenses", "UGX"),
  a("6002", "Staff Training & Development", "Expense", "Expenses", "UGX"),
  a("6003", "Meals and Entertainment", "Expense", "Expenses", "UGX"),
  a("6004", "Insurance Expenses", "Expense", "Expenses", "UGX"),
  a("6005", "Office Expenses", "Expense", "Expenses", "UGX"),
  a("6006", "Utilities", "Expense", "Expenses", "UGX"),
  a("6007", "Printing and Stationery", "Expense", "Expenses", "UGX"),
  a("6008", "Internet & Communication Expenses", "Expense", "Expenses", "UGX"),
  a("6009", "Penalties", "Expense", "Expenses", "UGX"),
  a("6010", "Bad Debt", "Expense", "Expenses", "UGX"),
  a("6100", "Marketing and Promotional Expenses", "Expense", "Expenses", "UGX"),
  a("6101", "Advertisement", "Expense", "Expenses", "UGX"),
  a("6102", "Bidding", "Expense", "Expenses", "UGX"),
  a("6103", "Business Travel & Facilitation", "Expense", "Expenses", "UGX"),
  a("6200", "Operating Expenses", "Expense", "Expenses", "UGX"),
  a("6201", "Rent Expense", "Expense", "Expenses", "UGX"),
  a("6202", "Building Maintenance", "Expense", "Expenses", "UGX"),
  a("6203", "Transport & Courier", "Expense", "Expenses", "UGX"),
  a("6204", "Fuel Expense", "Expense", "Expenses", "UGX"),
  a("6205", "Motor Vehicle Expense", "Expense", "Expenses", "UGX"),
  a("6206", "Licenses & Subscriptions", "Expense", "Expenses", "UGX"),
  a("6207", "Cash Over/Short", "Expense", "Expenses", "UGX"),
  a("6300", "Professional Expenses", "Expense", "Expenses", "UGX"),
  a("6301", "Consultancy Fees", "Expense", "Expenses", "UGX"),
  a("6302", "Legal Fees", "Expense", "Expenses", "UGX"),
  a("6303", "Accounting Fees", "Expense", "Expenses", "UGX"),
  a("6304", "Other Professional Fees", "Expense", "Expenses", "UGX"),
  a("6400", "Financial Expenses", "Expense", "Expenses", "UGX"),
  a("6401", "Bank Fees and Charges", "Expense", "Expenses", "UGX"),
  a("6402", "Mobile Money Charges", "Expense", "Expenses", "UGX"),
  a("6403", "Interest Expense", "Expense", "Expenses", "UGX"),
  a("6500", "Depreciation", "Expense", "Expenses", "UGX"),
  a("6501", "Deprn on Furniture", "Expense", "Expenses", "UGX"),
  a("6502", "Deprn on Equipment", "Expense", "Expenses", "UGX"),
  a("6503", "Deprn on Motor Vehicle", "Expense", "Expenses", "UGX"),
  a("6504", "Deprn on Computers & Accessories", "Expense", "Expenses", "UGX"),
  a("6505", "Deprn on Buildings", "Expense", "Expenses", "UGX"),
  a("7000", "Other Expenses", "Expense", "Expenses", "UGX"),
  a("8000", "Exchange Gain or Loss", "Expense", "Other Expense", "UGX"),
]);

/**
 * Legacy / generic names used by posting helpers → current CoA names.
 * Keeps double-entry working without recreating the old chart.
 */
export const ACCOUNT_NAME_ALIASES: Record<string, string> = {
  "cash on hand": "Cash-UGX",
  "cash at bank": "Bank-UGX",
  cash: "Cash-UGX",
  bank: "Bank-UGX",
  "accounts receivable": "Accounts Receivable-UGX",
  "accounts payable": "Accounts Payable-UGX",
  "inventory on hand": "Inventory Asset",
  "work in progress": "Work-in-Progress Inventory",
  "tax receivable": "Tax Claimable Accounts",
  "prepaid expenses": "Prepaid Expenses",
  "staff advances": "Staff Loans & Advances",
  "supplier advances": "Other Current Assets",
  "fixed assets, at cost": "Furniture and Equipment",
  "fixed assets, accumulated depreciation": "Accumulated Depreciation",
  "accumulated depreciation": "Accumulated Depreciation",
  "intangible assets": "Intangible Assets",
  "intangible assets, accumulated amortization": "Accumulated Depreciation",
  "accumulated amortization": "Accumulated Depreciation",
  "tax payable": "VAT Account",
  "paye payable": "PAYE Payable",
  "nssf payable": "NSSF Payable",
  "employee clearing": "Payroll Liabilities",
  "wages payable": "Net Salaries Payable",
  "wages & salaries": "Salaries and Employee Wages",
  "salaries & wages": "Salaries and Employee Wages",
  sales: "Coffee Sales",
  "sale of coffee": "Coffee Sales",
  "sales of coffee": "Coffee Sales",
  "coffee sale": "Coffee Sales",
  "coffee sales": "Coffee Sales",
  "operating expenses": "Operating Expenses",
  "cost of goods sold": "Coffee Products COS",
  depreciation: "Depreciation",
  "retained earnings": "Retained Earnings",
  "owner's equity": "Share Capital",
  "owners equity": "Share Capital",
  "foreign exchange gains (losses)": "Exchange Gain or Loss",
  "bank charges": "Bank Fees and Charges",
  rent: "Rent Expense",
  "bad debt expense": "Bad Debt",
  "inventory write-downs": "Other Expenses",
  "tips received": "Tips Received",
  tips: "Tips Received",
  "cash over/short": "Cash Over/Short",
  "cash over short": "Cash Over/Short",
  "till variance": "Cash Over/Short",
  "fuel expense": "Fuel Expense",
  "motor vehicle expense": "Motor Vehicle Expense",
  "pos sales": "POS Sales",
  "restaurant sales": "Restaurant Sales",
  "gain (loss) on asset disposal": "Other Expenses",
  "customer advances": "Other Long Term Liabilities",
  investments: "Other Current Assets",
  "accrued receivables": "Other Current Assets",
  "accrued liabilities": "Accrued Liabilities",
  "deferred revenue": "Deferred Revenue",
};

function canonicalAccountName(query: string): string {
  const q = query.trim().toLowerCase();
  return ACCOUNT_NAME_ALIASES[q] || query.trim();
}

const ACCOUNT_TYPE_ALIASES: Record<string, AccountType> = {
  asset: "Asset",
  assets: "Asset",
  liability: "Liability",
  liabilities: "Liability",
  equity: "Equity",
  capital: "Equity",
  income: "Income",
  revenue: "Income",
  sales: "Income",
  turnover: "Income",
  expense: "Expense",
  expenses: "Expense",
  expenditure: "Expense",
  cogs: "Expense",
  "cost of goods sold": "Expense",
  "cost of sales": "Expense",
};

/** Leading 3–6 digit code from a picker value such as `4000 — sale of coffee`. */
export function extractAccountCode(query: string): string | undefined {
  const trimmed = query.trim();
  const leading = trimmed.match(/^(\d{3,6})(?:\b|[.\s—–-])/);
  if (leading?.[1]) return leading[1];
  return trimmed.match(/(\d{3,6})/)?.[1];
}

/** Standard IAG numbering: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income, 5–9xxx expenses. */
export function accountTypeFromCode(code: string | undefined): AccountType | undefined {
  const digit = (code || "").trim()[0];
  if (digit === "1") return "Asset";
  if (digit === "2") return "Liability";
  if (digit === "3") return "Equity";
  if (digit === "4") return "Income";
  if (digit >= "5" && digit <= "9") return "Expense";
  return undefined;
}

/**
 * Coerce a stored CoA type onto the five ledger types.
 * 4xxx accounts defaulted to Asset (the form's first option) or imported as
 * "Revenue" would otherwise be excluded from Profit & Loss.
 */
export function normalizeAccountType(
  raw: string | undefined,
  code?: string,
  name?: string,
): AccountType {
  const fromAlias = ACCOUNT_TYPE_ALIASES[(raw || "").trim().toLowerCase()];
  const fromCode = accountTypeFromCode(code);
  const blob = (name || "").trim();
  const fromName = /sales?|income|revenue|turnover/i.test(blob)
    ? ("Income" as const)
    : /expense|cogs|cost of/i.test(blob)
      ? ("Expense" as const)
      : undefined;

  if (fromCode === "Income" || fromCode === "Expense") return fromCode;
  if (fromName === "Income" || fromName === "Expense") return fromName;
  if (fromAlias) return fromAlias;
  if (fromCode) return fromCode;
  return "Asset";
}

export function repairLedgerAccount(account: LedgerAccount): LedgerAccount {
  const type = normalizeAccountType(account.type, account.code, account.name);
  if (type === account.type) return account;
  const group =
    !account.group || account.group === account.type ? type : account.group;
  return { ...account, type, group };
}

let coaNormalizeWriteOnce = false;

export function loadChartOfAccounts(): LedgerAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const cached = getMemoryLedgerAccounts();
    // Empty means empty — never invent DEFAULT_CHART into memory from a read.
    if (!cached.length) return [];
    // Drop legacy Imported ghosts (free-text categories) from the live chart.
    const withoutImported = cached.filter(
      (a) => !/^imported$/i.test((a.group || "").trim()),
    );
    if (withoutImported.length !== cached.length) {
      setMemoryLedgerAccounts(withoutImported);
      void persistLedgerAccountsToDb(withoutImported);
    }
    const list = withoutImported.length ? withoutImported : cached;
    const repaired = list.map(repairLedgerAccount);
    const typesChanged = repaired.some((acct, i) => acct.type !== list[i]?.type);
    const normalized = withOpeningBalancesEquity(repaired);
    const plugBefore = list.find((a) => a.code === OPENING_BALANCES_EQUITY_CODE);
    const plugAfter = normalized.find((a) => a.code === OPENING_BALANCES_EQUITY_CODE);
    const plugNeedsRepair =
      Boolean(plugAfter) &&
      (!plugBefore || plugBefore.type !== "Equity" || plugBefore.group !== "Equity");
    if (typesChanged || plugNeedsRepair) {
      setMemoryLedgerAccounts(normalized);
      // One normalize write per tab — repeating this on every form open floods Railway.
      if (!coaNormalizeWriteOnce) {
        coaNormalizeWriteOnce = true;
        void persistLedgerAccountsToDb(normalized);
      }
    }
    return normalized;
  } catch {
    return [];
  }
}

/** Memory + durable Postgres write for the chart of accounts. */
export function saveChartOfAccounts(accounts: LedgerAccount[]): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  setMemoryLedgerAccounts(accounts);
  window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
  return persistLedgerAccountsToDb(accounts);
}

/** Build postable ledger accounts from Chart of Accounts entity records. */
export function ledgerAccountsFromChartRecords(records: ManagerRecord[]): LedgerAccount[] {
  const byCode = new Map<string, LedgerAccount>();
  for (const record of records) {
    const kind = String(record.kind || "Account").toLowerCase();
    if (kind === "group") continue;
    const name = String(record.name || record.account || "").trim();
    if (!name) continue;
    const code = String(record.code || record.accountCode || "").trim();
    if (!code) continue;
    const rawType = String(record.type || "").trim();
    const type = normalizeAccountType(rawType, code, name);
    const group = String(record.group || type).trim() || type;
    const opening = Number.parseFloat(String(record.openingBalance || "0")) || 0;
    const inactive = /^(inactive|obsolete|archived|disabled|hidden)$/i.test(
      String(record.status || "").trim(),
    );
    const currency = String(record.currency || "UGX").trim().toUpperCase() || "UGX";
    byCode.set(code, {
      id: String(record.id || `acct-${code}`),
      code,
      name,
      type,
      group,
      openingBalance: opening,
      currency,
      inactive,
    });
  }
  return withOpeningBalancesEquity([...byCode.values()]);
}

/** Build Manager.io-style CoA records (groups + accounts) from the default chart. */
export function defaultChartRecords(now = new Date().toISOString()): ManagerRecord[] {
  const groupNames = [...new Set(DEFAULT_CHART.map((acct) => acct.group))];
  const groupRecords: ManagerRecord[] = groupNames.map((groupName) => {
    const sample = DEFAULT_CHART.find((acct) => acct.group === groupName)!;
    return {
      id: `group-${groupName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      kind: "Group",
      name: groupName,
      code: "",
      type: sample.type,
      parentGroup: "",
      group: "",
      currency: "",
      openingBalance: "",
      balance: "",
      status: "Active",
      createdAt: now,
      updatedAt: now,
    };
  });
  const accountRecords: ManagerRecord[] = DEFAULT_CHART.map((account) => ({
    id: account.id,
    kind: "Account",
    name: account.name,
    code: account.code,
    type: account.type,
    group: account.group,
    parentGroup: "",
    currency: account.currency || "UGX",
    openingBalance: String(account.openingBalance || ""),
    balance: String(account.openingBalance || "0"),
    status: account.inactive ? "Inactive" : "Active",
    createdAt: now,
    updatedAt: now,
  }));
  return [...groupRecords, ...accountRecords];
}

/**
 * Do not auto-create bank accounts. Users create them under Banking → Bank & Cash
 * Accounts by naming the bank and linking a Chart of Accounts account.
 */
export function ensureDefaultBankAccounts(): boolean {
  return false;
}

const CLEAR_SEEDED_BANKS_KEY = "financeiag-clear-default-bank-seeds-v3";

/** Old friendly aliases that were mirrored from CoA into the bank list. */
const COA_BANK_NAME_ALIASES = new Set([
  "cash on hand",
  "cash on hand (usd)",
  "petty cash",
  "cash at office",
  "cash at bank",
  "main bank (ugx)",
  "main bank (usd)",
  "main bank (eur)",
]);

/** Exact CoA ledger titles that must never appear as Bank & Cash Accounts rows. */
const COA_LEDGER_BANK_NAMES = new Set([
  "cash-ugx",
  "cash-usd",
  "cash-eur",
  "bank-ugx",
  "bank-usd",
  "bank-eur",
  "petty cash-ugx",
  "petty cash-usd",
]);

/**
 * True when `name` is a Chart of Accounts cash/bank ledger account (e.g. Cash-UGX,
 * Bank-UGX) — those are not operational bank accounts and must not be added under
 * Banking → Bank & Cash Accounts.
 *
 * Only exact CoA ledger names / known aliases count. Do NOT match against the full
 * bank-like CoA picker set — that previously caused real bank accounts to be wiped.
 */
export function isChartOfAccountsBankName(name: string): boolean {
  const key = name.trim().toLowerCase();
  if (!key) return false;
  if (COA_BANK_NAME_ALIASES.has(key)) return true;
  if (COA_LEDGER_BANK_NAMES.has(key)) return true;
  return /^(cash|bank|petty cash)([- ]?(ugx|usd|eur))?$/i.test(key);
}

export const BANK_ACCOUNT_NAME_HINT =
  "Use a real bank or till name (e.g. Equity Current or Office till). Cash-UGX and Bank-UGX stay on the Chart of Accounts — pick them under Posts to.";

/**
 * Keep Banking → Bank & Cash Accounts free of CoA ledger names (Cash-UGX, Bank-UGX, …)
 * and old seed ids. Real banks (Equity / Inspire Juzza / etc.) are never removed.
 *
 * Truly one-shot: after the flag is set we never rewrite the bank list again.
 * Running the filter on every boot previously raced with creates and made new
 * banks disappear after insert.
 */
/**
 * Legacy marker only — does NOT delete bank / transfer rows on boot.
 * Seed cleanup used to race with real creates and make banks disappear.
 */
export function clearDefaultSeededBankAccountsOnce(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (getAppFlag(CLEAR_SEEDED_BANKS_KEY)) return false;
    setAppFlag(CLEAR_SEEDED_BANKS_KEY, true);
    return false;
  } catch {
    return false;
  }
}

/** CoA ledger names that were previously mirrored as bank account names. */
const COA_MIRRORED_BANK_NAMES: Record<string, string> = {
  "Cash-UGX": "Cash on hand",
  "Cash-USD": "Cash on hand (USD)",
  "Petty Cash-UGX": "Petty cash",
  "Bank-UGX": "Main bank (UGX)",
  "Bank-USD": "Main bank (USD)",
  "Bank-EUR": "Main bank (EUR)",
};

const BANK_NAME_MIGRATE_KEY = "financeiag-bank-friendly-names-v1";

/**
 * One-time: rename mirrored CoA names (Cash-UGX, Bank-EUR, …) to real bank account
 * names, keep glAccount pointing at the Chart of Accounts, and update references.
 */
export function migrateMirroredBankAccountNamesOnce(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (getAppFlag(BANK_NAME_MIGRATE_KEY)) return false;
    setAppFlag(BANK_NAME_MIGRATE_KEY, true);

    const banks = loadRecords("banking", "bank-and-cash-accounts");
    const renames = new Map<string, string>();
    let changed = false;
    const nextBanks = banks.map((record) => {
      const name = (record.name || record.account || "").trim();
      const friendly = COA_MIRRORED_BANK_NAMES[name];
      if (!friendly) {
        if (!record.glAccount && name) {
          changed = true;
          return { ...record, glAccount: name, updatedAt: new Date().toISOString() };
        }
        return record;
      }
      renames.set(name, friendly);
      changed = true;
      return {
        ...record,
        name: friendly,
        glAccount: record.glAccount || name,
        updatedAt: new Date().toISOString(),
      };
    });
    if (changed) {
      void saveRecords("banking", "bank-and-cash-accounts", nextBanks).then((saved) => {
        if (!saved.ok || saved.durable !== "postgres") {
          notifyPersistFailure(
            "banking/bank-and-cash-accounts",
            saved.error || "Could not save bank account name migration.",
          );
        }
      });
    }

    if (renames.size) {
      const rewrite = (moduleSlug: string, entityKey: string, keys: string[]) => {
        const rows = loadRecords(moduleSlug, entityKey);
        let touched = false;
        const next = rows.map((row) => {
          let copy = row;
          for (const key of keys) {
            const raw = (row[key] || "").trim();
            const mapped = renames.get(raw);
            if (mapped) {
              if (copy === row) copy = { ...row };
              copy[key] = mapped;
              touched = true;
            }
          }
          return copy;
        });
        if (touched) {
          void saveRecords(moduleSlug, entityKey, next).then((saved) => {
            if (!saved.ok || saved.durable !== "postgres") {
              notifyPersistFailure(
                `${moduleSlug}/${entityKey}`,
                saved.error ||
                  `Could not save renamed bank account references in ${moduleSlug}/${entityKey}.`,
              );
            }
          });
        }
      };
      rewrite("banking", "receipts", ["account", "bankAccount"]);
      rewrite("banking", "payments", ["account", "bankAccount"]);
      rewrite("banking", "inter-account-transfers", ["from", "to", "fromAccount", "toAccount"]);
      rewrite("banking", "bank-statements", ["account"]);
      rewrite("banking", "reconciliations", ["account"]);
      rewrite("banking", "receipt-rules", ["bankAccount"]);
      rewrite("banking", "payment-rules", ["bankAccount"]);
      rewrite("pos", "registers", ["account"]);
      rewrite("pos", "pos-sales", ["account", "salesAccount", "taxAccount"]);
      rewrite("pos", "pos-returns", ["account"]);
      rewrite("pos", "cash-sessions", ["account", "registerAccount"]);
      rewrite("pos", "daily-closings", ["depositTo", "registerAccount"]);
      rewrite("fleet", "fuel-logs", ["expenseAccount", "bankAccount", "paidFrom"]);
      rewrite("fleet", "maintenance-requests", ["expenseAccount", "bankAccount"]);
      rewrite("fleet", "fuel-requests", ["bankAccount"]);
      rewrite("payroll", "statutory-remittances", ["paidFrom"]);
    }

    if (changed || renames.size) {
      window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
    }
    return changed || renames.size > 0;
  } catch {
    return false;
  }
}

/**
 * Map a Bank & Cash Accounts picker value to the Chart of Accounts name used
 * for ledger posting. Falls back to the picker value when no bank row exists.
 */
export function resolveCompanyBankGlName(pickerValue: string): string {
  const raw = pickerValue.trim();
  if (!raw || typeof window === "undefined") return raw;
  const key = raw.toLowerCase();
  const rows = loadRecords("banking", "bank-and-cash-accounts");
  for (const record of rows) {
    const name = (record.name || record.account || "").trim();
    const code = (record.code || "").trim();
    const gl = (record.glAccount || "").trim();
    if (
      name.toLowerCase() === key ||
      code.toLowerCase() === key ||
      gl.toLowerCase() === key
    ) {
      return gl || name || raw;
    }
  }
  // Alias tolerance: "Stanbic" → Stanbic Bank → its glAccount.
  for (const record of rows) {
    const name = (record.name || record.account || "").trim();
    const code = (record.code || "").trim();
    const gl = (record.glAccount || "").trim();
    if (!name) continue;
    if (
      (name.length >= 3 && key.length >= 3 &&
        (name.toLowerCase().includes(key) || key.includes(name.toLowerCase()))) ||
      (code.length >= 3 &&
        (code.toLowerCase().includes(key) || key.includes(code.toLowerCase())))
    ) {
      return gl || name || raw;
    }
  }
  return raw;
}

/**
 * Disabled — Chart of Accounts must come from Postgres (API hydrate / import).
 * For an explicit opt-in demo seed use `populateFullAccountingDemo()` instead.
 */
export function installIagChartOfAccountsOnce(): boolean {
  return false;
}

export function findAccount(
  accounts: LedgerAccount[],
  query: string,
): LedgerAccount | undefined {
  const raw = query.trim();
  if (!raw) return undefined;
  const rawLower = raw.toLowerCase();
  const byPostedName = accounts.find(
    (acct) => acct.name.toLowerCase() === rawLower || acct.code.toLowerCase() === rawLower,
  );
  if (byPostedName) return byPostedName;
  const canonical = canonicalAccountName(raw);
  const q = canonical.toLowerCase();
  const extracted = extractAccountCode(raw) || extractAccountCode(canonical);
  if (extracted) {
    const byCode = accounts.find((acct) => acct.code.toLowerCase() === extracted.toLowerCase());
    if (byCode) return byCode;
  }
  const coffeeQuery = /^(sales?|4000)$/i.test(raw) || /sale of coffee|coffee sales/i.test(raw);
  if (coffeeQuery) {
    const coffee =
      accounts.find((acct) => acct.code === "4000") ||
      accounts.find((acct) => /sale of coffee|coffee sales/i.test(acct.name));
    if (coffee) return coffee;
  }
  const exact = accounts.find((acct) => acct.code.toLowerCase() === q || acct.name.toLowerCase() === q);
  if (exact) return exact;
  if (q.length < 6 || q === "sales" || q === "sale") return undefined;
  return accounts.find(
    (acct) =>
      acct.name.toLowerCase().includes(q) ||
      acct.code.toLowerCase().includes(q) ||
      q.includes(acct.name.toLowerCase()),
  );
}

/** Postable ledger accounts for form dropdowns (excludes inactive). */
export function listPostableAccounts(filter?: {
  types?: AccountType[];
  bankLike?: boolean;
  /** Prefer Fixed Asset / PPE ledger accounts (codes 15xx). */
  fixedAssetLike?: boolean;
}): LedgerAccount[] {
  let list = loadChartOfAccounts().filter((acct) => !acct.inactive);
  if (filter?.types?.length) {
    list = list.filter((acct) => filter.types!.includes(acct.type));
  }
  if (filter?.fixedAssetLike) {
    list = list.filter(
      (acct) =>
        acct.type === "Asset" &&
        (/fixed\s*asset|ppe|property.?plant|plant.?equip/i.test(
          `${acct.name} ${acct.group}`,
        ) ||
          /^15\d{2}$/.test(acct.code)),
    );
  }
  if (filter?.bankLike) {
    list = list.filter(
      (acct) =>
        acct.type === "Asset" &&
        (/bank|cash|petty|card|wallet|mobile/i.test(`${acct.name} ${acct.group}`) ||
          acct.code.startsWith("10")),
    );
    if (!list.length) {
      list = loadChartOfAccounts().filter((acct) => !acct.inactive && acct.type === "Asset");
    }
  }
  return [...list].sort(
    (x, y) =>
      x.code.localeCompare(y.code, undefined, { numeric: true }) || x.name.localeCompare(y.name),
  );
}

export type CoaSelectOption = {
  value: string;
  label: string;
  code: string;
  name: string;
  group: string;
  type: AccountType;
  currency?: string;
  accountNumber?: string;
};

/** Options for account pickers — value is the account name (ledger resolve key). */
export function coaAccountSelectOptions(filter?: {
  types?: AccountType[];
  bankLike?: boolean;
  fixedAssetLike?: boolean;
}): CoaSelectOption[] {
  return listPostableAccounts(filter).map((acct) => ({
    value: acct.name,
    code: acct.code,
    name: acct.name,
    group: acct.group || acct.type,
    type: acct.type,
    currency: acct.currency,
    label: acct.currency
      ? `${acct.code} — ${acct.name} (${acct.currency})`
      : `${acct.code} — ${acct.name}`,
  }));
}

/**
 * Bank / cash pickers list only names from Banking → Bank & Cash Accounts.
 * That is the bank list users manage; CoA is not used as a fallback here.
 */
export function bankAccountSelectOptions(): CoaSelectOption[] {
  const entered = new Map<string, CoaSelectOption>();
  if (typeof window !== "undefined") {
    for (const record of loadRecords("banking", "bank-and-cash-accounts")) {
      if (/inactive|obsolete|archived|disabled/i.test(record.status || "")) continue;
      const name = (record.name || record.account || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (entered.has(key)) continue;
      const accountNumber = (record.accountNumber || "").trim();
      const currency = (record.currency || "UGX").trim();
      const gl = (record.glAccount || "").trim();
      const institution = (record.institution || "").trim();
      entered.set(key, {
        value: name,
        code: record.code || "",
        name,
        accountNumber: accountNumber || gl,
        currency,
        group: institution || "Bank & cash",
        type: "Asset",
        label: [name, currency ? `(${currency})` : "", gl ? `→ ${gl}` : ""]
          .filter(Boolean)
          .join(" "),
      });
    }
  }

  return Array.from(entered.values()).sort((x, y) => x.name.localeCompare(y.name));
}

/** Field keys that should pick from Chart of Accounts. */
export const COA_PICKER_FIELD_KEYS = new Set([
  "account",
  "postingAccount",
  "expenseAccount",
  "incomeAccount",
  "debitAccount",
  "creditAccount",
  "salesAccount",
  "defaultSalesAccount",
  "purchaseAccount",
  "allocation",
  "liabilityAccount",
  "fromAccount",
  "toAccount",
  "paidFrom",
  "bankAccount",
  "assetAccount",
  "assetCategory",
  "wipAccount",
  "contraAccount",
  "glAccount",
  "ledgerAccount",
]);

/** Keys that look account-related but are not Chart of Accounts pickers. */
const NOT_COA_PICKER_KEYS = new Set([
  "accountNumber",
  "creditLimit",
  "creditNotes",
  "bankCode",
  "uncategorizedReceipts",
  "uncategorizedPayments",
  "accountName",
]);

/** Entities where `bankAccount` means the employee's personal bank, not company cash. */
const PERSONAL_BANK_ENTITIES = new Set(["employees", "payslips"]);

function isAssetCategoryField(key: string, label?: string) {
  const normalized = (label || "").trim().toLowerCase();
  return (
    key === "assetAccount" ||
    key === "assetCategory" ||
    (key === "category" && normalized === "asset category")
  );
}

export function isCoaPickerField(key: string, label?: string, entityKey?: string) {
  if (NOT_COA_PICKER_KEYS.has(key)) return false;
  // Fixed asset register "Group" = GL asset account from Chart of Accounts.
  if (entityKey === "fixed-assets" && key === "group") return true;
  if (COA_PICKER_FIELD_KEYS.has(key)) return true;
  if (isAssetCategoryField(key, label)) return true;
  const blob = `${key} ${label || ""}`.toLowerCase();
  if (
    /account number|credit limit|credit notes|bank code|uncategorized|control account name|account name|subaccount name/.test(
      blob,
    )
  ) {
    return false;
  }
  return /received in|paid from|posting account|expense account|income account|default account|debit account|credit account|sales account|purchase account|liability(?:\s*\/\s*asset)? account|when sold|when purchased|asset categor|gl account|ledger account|chart of accounts|contra account|wip account/.test(
    blob,
  );
}

/**
 * Company bank / cash fields — pick from Banking → Bank & Cash Accounts
 * (those records are created by linking a Chart of Accounts account).
 */
export function isCompanyBankAccountField(
  key: string,
  label?: string,
  entityKey?: string,
): boolean {
  if (entityKey && PERSONAL_BANK_ENTITIES.has(entityKey) && key === "bankAccount") {
    return false;
  }
  return Boolean(coaPickerFilterForField(key, label, entityKey)?.fromBankList);
}

export const BANK_ACCOUNT_CREATE_HINT =
  "No bank accounts yet — create one under Banking → Bank & Cash Accounts. Name the bank (e.g. Equity Current), then link it to Chart of Accounts (e.g. Bank-UGX).";

export function coaPickerFilterForField(
  key: string,
  label?: string,
  entityKey?: string,
): {
  /** Pick from Banking → Bank & Cash Accounts (operational bank list). */
  fromBankList?: true;
  /** Prefer cash/bank-like CoA asset accounts. */
  bankLike?: true;
  /** Prefer fixed-asset / PPE CoA accounts. */
  fixedAssetLike?: true;
  types?: AccountType[];
} | undefined {
  const blob = `${key} ${label || ""}`.toLowerCase();
  // Fixed asset register "Group" → Fixed Asset accounts on the chart.
  if (entityKey === "fixed-assets" && key === "group") {
    return { types: ["Asset"], fixedAssetLike: true as const };
  }
  // Linking a bank record to the ledger — always Chart of Accounts (bank/cash assets).
  if (
    key === "glAccount" ||
    key === "ledgerAccount" ||
    /chart of accounts account|gl account|ledger account/.test(blob)
  ) {
    return { bankLike: true as const };
  }
  // Employee / payslip "Bank" = personal bank name, not company cash.
  if (entityKey && PERSONAL_BANK_ENTITIES.has(entityKey) && key === "bankAccount") {
    return undefined;
  }
  if (
    key === "paidFrom" ||
    key === "bankAccount" ||
    key === "fromAccount" ||
    key === "toAccount" ||
    /received in|paid from|bank account|from account|to account|if bank account/.test(blob) ||
    ((key === "from" || key === "to") && /paid from|received in/.test(blob))
  ) {
    return { fromBankList: true as const, bankLike: true as const };
  }
  // Bank statements / reconciliations: field key is often just `account`.
  if (
    key === "account" &&
    entityKey &&
    /bank-statement|reconciliation|receipt|payment|register|pos-|cash-session|daily-closing|inter-account/.test(
      entityKey,
    )
  ) {
    return { fromBankList: true as const, bankLike: true as const };
  }
  if (isAssetCategoryField(key, label)) {
    return { types: ["Asset"] };
  }
  if (key === "expenseAccount" || /expense account/.test(blob)) {
    return { types: ["Expense"] };
  }
  if (key === "incomeAccount" || key === "salesAccount" || key === "defaultSalesAccount" || /income account|when sold|sales account/.test(blob)) {
    return { types: ["Income"] };
  }
  if (key === "liabilityAccount" || /liability/.test(blob)) {
    return { types: ["Liability", "Asset"] };
  }
  if (key === "purchaseAccount" || /when purchased/.test(blob)) {
    return { types: ["Expense", "Asset"] };
  }
  return undefined;
}

export function ensureAccount(
  accounts: LedgerAccount[],
  name: string,
  type: AccountType,
  group: string,
  code?: string,
): { accounts: LedgerAccount[]; account: LedgerAccount } {
  const resolvedName = canonicalAccountName(name);
  const normalizedName = resolvedName.trim().toLowerCase();
  const existing =
    findAccount(accounts, resolvedName) ||
    accounts.find((account) => account.name.trim().toLowerCase() === normalizedName);
  if (existing) {
    // Repair mistyped opening-balances plug (often auto-created as Asset/Liability).
    if (
      existing.code === OPENING_BALANCES_EQUITY_CODE ||
      existing.name.trim().toLowerCase() === OPENING_BALANCES_EQUITY_NAME.toLowerCase() ||
      (code === OPENING_BALANCES_EQUITY_CODE && type === "Equity")
    ) {
      if (existing.type !== "Equity" || existing.group !== "Equity") {
        const repaired = {
          ...existing,
          code: OPENING_BALANCES_EQUITY_CODE,
          name: OPENING_BALANCES_EQUITY_NAME,
          type: "Equity" as const,
          group: "Equity",
          openingBalance: 0,
        };
        return {
          accounts: accounts.map((a) => (a.id === existing.id ? repaired : a)),
          account: repaired,
        };
      }
    }
    return { accounts, account: existing };
  }
  const codeAvailable = Boolean(code) && !accounts.some((account) => account.code === code);
  const nextCode = codeAvailable
    ? code!
    : String(
        Math.max(0, ...accounts.map((acct) => Number.parseInt(acct.code, 10) || 0)) + 10,
      ).padStart(4, "0");
  const account: LedgerAccount = {
    id: `acct-${nextCode}-${Date.now()}`,
    code: nextCode,
    name: resolvedName,
    type,
    group,
    currency: "UGX",
    openingBalance: 0,
    inactive: false,
  };
  const next = [...accounts, account];
  saveChartOfAccounts(next);
  return { accounts: next, account };
}

/** Match CoA rows / ledger accounts by id, code, or name (case-insensitive). */
export function matchesChartAccount(
  account: { id?: string; code?: string; name?: string },
  query: { ids?: Set<string>; codes?: Set<string>; names?: Set<string> },
) {
  if (account.id && query.ids?.has(account.id)) return true;
  const code = (account.code || "").trim().toLowerCase();
  if (code && query.codes?.has(code)) return true;
  const name = (account.name || "").trim().toLowerCase();
  if (name && query.names?.has(name)) return true;
  return false;
}

/** Remove matching accounts from the chart store (does not touch ledger lines). */
export function removeChartAccounts(input: {
  ids?: string[];
  codes?: string[];
  names?: string[];
}): { removed: LedgerAccount[]; remaining: LedgerAccount[] } {
  const query = {
    ids: new Set((input.ids || []).filter(Boolean)),
    codes: new Set((input.codes || []).map((c) => c.trim().toLowerCase()).filter(Boolean)),
    names: new Set((input.names || []).map((n) => n.trim().toLowerCase()).filter(Boolean)),
  };
  const accounts = loadChartOfAccounts();
  const removed = accounts.filter((acct) => matchesChartAccount(acct, query));
  const remaining = accounts.filter((acct) => !matchesChartAccount(acct, query));
  if (!removed.length) return { removed, remaining: accounts };
  saveChartOfAccounts(remaining);
  return { removed, remaining };
}
