/**
 * Create payslips for every active employee from the payroll employee database.
 */

import { nextDocumentReference } from "@/lib/document-references";
import type { ManagerRecord } from "@/lib/manager-entities";
import { isActiveEmployeeStatus } from "@/lib/hr-ops";
import { loadRecords, saveRecords } from "@/lib/records-store";
import { parseAmount } from "@/lib/ledger/types";
import {
  DEFAULT_PAY_DAYS,
  computeUgandaPayslip,
} from "@/lib/uganda-payroll";
import { bankCodeForName } from "@/lib/uganda-banks";

/** Per-employee adjustments keyed by employee record id. */
export type PayrollOverride = {
  daysWorked?: number;
  advances?: number;
  arrears?: number;
  include?: boolean;
};

export type BatchPayrollOptions = {
  payDate: string;
  daysWorked: number;
  /** Skip employees who already have a payslip on this pay date. */
  skipExistingSameDate?: boolean;
  overrides?: Record<string, PayrollOverride>;
  /** Link slips to an approved payroll-runs request. */
  payrollRunId?: string;
};

export type BatchPayrollResult = {
  created: ManagerRecord[];
  skipped: { employee: string; reason: string }[];
  previousPayslips: ManagerRecord[];
};

export function activeEmployees(): ManagerRecord[] {
  return loadRecords("payroll", "employees").filter((e) => {
    if (!e.name?.trim()) return false;
    return isActiveEmployeeStatus(e.status);
  });
}

function employeeKey(emp: ManagerRecord) {
  return (emp.code || emp.name || "").trim().toLowerCase();
}

function payslipEmployeeKey(slip: ManagerRecord) {
  return (slip.employeeId || slip.employee || "").trim().toLowerCase();
}

export function buildPayslipFromEmployee(
  emp: ManagerRecord,
  options: BatchPayrollOptions,
  existingPayslips: ManagerRecord[],
): ManagerRecord {
  const basicPay = parseAmount(emp.basicPay);
  const override = options.overrides?.[emp.id];
  const result = computeUgandaPayslip({
    basicPay,
    daysWorked: override?.daysWorked ?? options.daysWorked,
    daysInPeriod: DEFAULT_PAY_DAYS,
    advances: override?.advances ?? 0,
    arrears: override?.arrears ?? 0,
    nonResident: /non-?resident/i.test(emp.residentStatus || ""),
    asOf: options.payDate,
  });
  const now = new Date().toISOString();
  const reference = nextDocumentReference("payslips", existingPayslips);
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    reference,
    date: options.payDate,
    employee: emp.name || "",
    employeeId: emp.code || "",
    bankAccount: emp.bankAccount || "",
    bankCode: emp.bankCode || bankCodeForName(emp.bankAccount || "") || "",
    accountNumber: emp.accountNumber || "",
    department: emp.department || "",
    phone: emp.phone || "",
    basicPay: String(result.basicPay),
    daysInPeriod: String(result.daysInPeriod),
    daysWorked: String(result.daysWorked),
    dailyRate: String(result.dailyRate),
    adjustedBasic: String(result.adjustedBasic),
    earnings: String(result.adjustedBasic),
    paye: String(result.paye),
    nssfEmployee: String(result.nssfEmployee),
    nssfEmployer: String(result.nssfEmployer),
    advances: String(result.advances),
    arrears: String(result.arrears),
    deductions: String(result.totalDeductions),
    contributions: String(result.nssfEmployer),
    netPay: String(result.netPay),
    amount: String(result.adjustedBasic + result.arrears),
    currency: emp.currency || "UGX",
    status: "Unpaid",
    ...(options.payrollRunId ? { payrollRunId: options.payrollRunId } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Generate and save payslips for all active employees with basic pay.
 * Returns created slips; caller should sync each to the ledger.
 */
export async function createPayrollForActiveEmployees(
  options: BatchPayrollOptions,
): Promise<BatchPayrollResult> {
  const employees = activeEmployees();
  const previousPayslips = loadRecords("payroll", "payslips").map((r) => ({ ...r }));
  const existing = [...previousPayslips];
  const created: ManagerRecord[] = [];
  const skipped: { employee: string; reason: string }[] = [];
  const skipExisting = options.skipExistingSameDate !== false;
  const daysWorked = Math.max(0, options.daysWorked);

  for (const emp of employees) {
    const label = emp.name || emp.code || "Employee";
    if (options.overrides?.[emp.id]?.include === false) {
      skipped.push({ employee: label, reason: "Excluded from this run" });
      continue;
    }
    if (!parseAmount(emp.basicPay)) {
      skipped.push({ employee: label, reason: "No basic pay" });
      continue;
    }
    if (skipExisting) {
      const key = employeeKey(emp);
      const already = existing.some(
        (slip) =>
          slip.date === options.payDate &&
          (payslipEmployeeKey(slip) === key ||
            (slip.employee || "").trim().toLowerCase() === (emp.name || "").trim().toLowerCase()),
      );
      if (already) {
        skipped.push({ employee: label, reason: "Payslip already exists for this date" });
        continue;
      }
    }
    const slip = buildPayslipFromEmployee(emp, { ...options, daysWorked }, [
      ...existing,
      ...created,
    ]);
    created.push(slip);
  }

  if (created.length) {
    const saved = await saveRecords("payroll", "payslips", [...created, ...previousPayslips]);
    if (!saved.ok || saved.durable !== "postgres") {
      throw new Error(
        saved.error || "Could not save the new payslips to the database.",
      );
    }
  }

  return { created, skipped, previousPayslips };
}
