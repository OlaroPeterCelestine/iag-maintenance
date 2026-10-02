import {
  ensureAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { postBalancedEntry } from "@/lib/ledger/posting";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";

/** IAS 19 — Accrue unused leave / employee benefits. */
export function accrueLeaveLiability(input: {
  employeeId: string;
  days: number;
  dailyRate: number;
  date: string;
  sourceRecordId?: string;
  narration?: string;
}): { ok: true; amount: number } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.days) * Math.max(0, input.dailyRate));
  if (!amount) return { ok: true, amount: 0 };
  let accounts = loadChartOfAccounts();
  const expense = ensureAccount(accounts, "Wages & salaries", "Expense", "Operating expenses", "5300");
  accounts = expense.accounts;
  const liability = ensureAccount(accounts, "Leave pay accrual", "Liability", "Current liabilities", "2220");
  accounts = liability.accounts;
  saveChartOfAccounts(accounts);
  const result = postBalancedEntry({
    date: input.date,
    narration: input.narration || `Leave accrual · ${input.employeeId}`,
    sourceModule: "payroll",
    sourceEntity: "leave-accruals",
    sourceRecordId: input.sourceRecordId || `leave-${input.employeeId}-${input.date}`,
    lines: [
      {
        accountId: expense.account.id,
        accountCode: expense.account.code,
        accountName: expense.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: liability.account.id,
        accountCode: liability.account.code,
        accountName: liability.account.name,
        debit: 0,
        credit: amount,
      },
    ],
  });
  return result.ok ? { ok: true, amount } : result;
}

/**
 * When paid leave is taken, release the leave accrual so wages are not double-counted
 * if payroll still runs for the period (Dr Leave pay accrual · Cr Wages expense).
 */
export function releaseLeaveLiability(input: {
  employeeId: string;
  days: number;
  dailyRate: number;
  date: string;
  sourceRecordId: string;
  narration?: string;
}): { ok: true; amount: number } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.days) * Math.max(0, input.dailyRate));
  if (!amount) return { ok: true, amount: 0 };
  let accounts = loadChartOfAccounts();
  const liability = ensureAccount(accounts, "Leave pay accrual", "Liability", "Current liabilities", "2220");
  accounts = liability.accounts;
  const expense = ensureAccount(accounts, "Wages & salaries", "Expense", "Operating expenses", "5300");
  accounts = expense.accounts;
  saveChartOfAccounts(accounts);
  const result = postBalancedEntry({
    date: input.date,
    narration: input.narration || `Leave taken · ${input.employeeId}`,
    sourceModule: "payroll",
    sourceEntity: "leave-requests",
    sourceRecordId: input.sourceRecordId,
    lines: [
      {
        accountId: liability.account.id,
        accountCode: liability.account.code,
        accountName: liability.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: expense.account.id,
        accountCode: expense.account.code,
        accountName: expense.account.name,
        debit: 0,
        credit: amount,
      },
    ],
  });
  return result.ok ? { ok: true, amount } : result;
}

/** Remit PAYE / NSSF / tax payable to authorities. */
export function postStatutoryRemittance(input: {
  kind: "PAYE" | "NSSF" | "Tax";
  amount: number;
  date: string;
  bankAccount?: string;
  sourceRecordId?: string;
  narration?: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.amount));
  if (!amount) return { ok: false, error: "Amount required." };
  const accountName =
    input.kind === "PAYE" ? "PAYE payable" : input.kind === "NSSF" ? "NSSF payable" : "Tax payable";
  const code = input.kind === "PAYE" ? "2052" : input.kind === "NSSF" ? "2053" : "2100";
  let accounts = loadChartOfAccounts();
  const liability = ensureAccount(accounts, accountName, "Liability", "Current liabilities", code);
  accounts = liability.accounts;
  const bank = ensureAccount(
    accounts,
    input.bankAccount || "Cash at bank",
    "Asset",
    "Current assets",
    "1100",
  );
  accounts = bank.accounts;
  saveChartOfAccounts(accounts);
  return postBalancedEntry({
    date: input.date,
    narration: input.narration || `${input.kind} remittance`,
    sourceModule: "payroll",
    sourceEntity: "statutory-remittances",
    sourceRecordId: input.sourceRecordId || `remit-${input.kind}-${input.date}`,
    lines: [
      {
        accountId: liability.account.id,
        accountCode: liability.account.code,
        accountName: liability.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: bank.account.id,
        accountCode: bank.account.code,
        accountName: bank.account.name,
        debit: 0,
        credit: amount,
      },
    ],
  }).ok
    ? { ok: true }
    : { ok: false, error: "Could not post remittance." };
}

export function remittanceKindFromRecord(kind: string): "PAYE" | "NSSF" | "Tax" {
  if (/paye/i.test(kind)) return "PAYE";
  if (/nssf/i.test(kind)) return "NSSF";
  return "Tax";
}

/** True when leave type is paid time off that should release leave accrual. */
export function isPaidLeaveType(leaveType: string): boolean {
  return /annual|sick|maternity|paternity|compassionate|study|public/i.test(leaveType || "");
}

/** Accrue leave for all employees with leaveDays × dailyRate fields. */
export function runLeaveAccruals(asOf: string) {
  const employees = loadRecords("payroll", "employees");
  let total = 0;
  let count = 0;
  for (const emp of employees) {
    const days = parseAmount(emp.leaveDays || emp.accruedLeave);
    const rate =
      parseAmount(emp.dailyRate || emp.rate) ||
      (parseAmount(emp.basicPay) > 0 ? roundMoney(parseAmount(emp.basicPay) / 30) : 0);
    if (!days || !rate) continue;
    const result = accrueLeaveLiability({
      employeeId: emp.id,
      days,
      dailyRate: rate,
      date: asOf,
      sourceRecordId: `leave-accrual-${emp.id}-${asOf.slice(0, 7)}`,
    });
    if (result.ok && result.amount) {
      total = roundMoney(total + result.amount);
      count += 1;
      emp.leaveAccruedValue = String(result.amount);
    }
  }
  void saveRecords("payroll", "employees", employees).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "payroll/employees",
        saved.error ||
          "Leave accrual was posted to the ledger, but employee leave balances could not be updated.",
      );
    }
  });
  return { ok: true as const, count, total };
}

