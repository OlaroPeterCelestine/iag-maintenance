/**
 * HR helpers — leave balances, attendance rollups, onboarding status.
 */

import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";
import { parseAmount, roundMoney } from "@/lib/ledger/types";

/** Employment statuses stored on the employee record (not localStorage). */
export const EMPLOYEE_STATUSES = ["Active", "Inactive", "Suspended", "Left"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/** True when the employee is Active and eligible for payroll / HR headcount. */
export function isActiveEmployeeStatus(status: unknown): boolean {
  const value = String(status ?? "").trim();
  if (!value) return true; // legacy rows without status stay eligible
  // Only Active is included; Inactive / Suspended / Left (and legacy exits) are out.
  if (/^active$/i.test(value)) return true;
  if (/inactive|suspended|^left$|terminated|void|archived|resigned|exited/i.test(value)) {
    return false;
  }
  // Unknown legacy values (Draft, Pending, …) — treat as not active for payroll.
  return false;
}

export function activeHrEmployees(): ManagerRecord[] {
  return loadRecords("payroll", "employees").filter((e) => {
    if (!String(e.name ?? "").trim()) return false;
    return isActiveEmployeeStatus(e.status);
  });
}

export function findEmployeeByNameOrCode(value: string): ManagerRecord | null {
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return (
    loadRecords("payroll", "employees").find(
      (e) =>
        (e.name || "").trim().toLowerCase() === key ||
        (e.code || "").trim().toLowerCase() === key,
    ) || null
  );
}

export function pendingLeaveRequests(): ManagerRecord[] {
  return loadRecords("payroll", "leave-requests").filter((r) =>
    /pending|submitted|awaiting|hr approved/i.test(r.status || ""),
  );
}

export function approvedLeaveDays(
  employeeName: string,
  year?: string,
  leaveTypeFilter?: RegExp,
): number {
  const y = year || String(new Date().getFullYear());
  return loadRecords("payroll", "leave-requests")
    .filter(
      (r) =>
        r.employee === employeeName &&
        /^(paid|approved)$/i.test(r.status || "") &&
        (r.startDate || r.date || "").startsWith(y) &&
        (!leaveTypeFilter || leaveTypeFilter.test(r.leaveType || "")),
    )
    .reduce((sum, r) => sum + parseAmount(r.days), 0);
}

/** Recompute annual leave balance = entitlement − approved annual days (YTD). */
export function recomputeEmployeeLeaveBalance(employeeName: string) {
  const employees = loadRecords("payroll", "employees");
  const idx = employees.findIndex(
    (e) =>
      e.name === employeeName ||
      e.code === employeeName ||
      (e.name || "").toLowerCase() === employeeName.toLowerCase(),
  );
  if (idx < 0) return;
  const emp = employees[idx];
  const year = String(new Date().getFullYear());
  const entitlement = parseAmount(emp.leaveDays || emp.annualLeaveEntitlement) || 21;
  if (!parseAmount(emp.leaveDays || emp.annualLeaveEntitlement)) {
    emp.leaveDays = String(entitlement);
  }
  const used = approvedLeaveDays(emp.name || employeeName, year, /annual/i);
  emp.leaveBalance = String(roundMoney(Math.max(0, entitlement - used)));
  emp.updatedAt = new Date().toISOString();
  employees[idx] = emp;
  void saveRecords("payroll", "employees", employees).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "payroll/employees",
        saved.error || `Could not save the recomputed leave balance for ${employeeName}.`,
      );
    }
  });
}

export function employeeDailyRate(emp: ManagerRecord): number {
  return (
    parseAmount(emp.dailyRate || emp.rate) ||
    (parseAmount(emp.basicPay) > 0 ? roundMoney(parseAmount(emp.basicPay) / 30) : 0)
  );
}

export function attendanceForDate(date: string): ManagerRecord[] {
  return loadRecords("payroll", "attendance").filter((r) => r.date === date);
}

/**
 * Count payable days from attendance in [from, to] inclusive.
 * Present / remote = 1, half-day = 0.5, leave/holiday/absent = 0.
 * Returns null when no attendance rows exist for that employee in the period
 * (caller should fall back to default pay days).
 */
export function daysWorkedFromAttendance(
  employee: ManagerRecord,
  from: string,
  to: string,
): number | null {
  const names = [employee.name, employee.code].filter(Boolean).map((s) => s!.trim().toLowerCase());
  const rows = loadRecords("payroll", "attendance").filter((r) => {
    const d = r.date || "";
    if (d < from || d > to) return false;
    const who = (r.employee || "").trim().toLowerCase();
    return names.includes(who);
  });
  if (!rows.length) return null;
  let days = 0;
  for (const row of rows) {
    const status = row.status || "";
    if (/half/i.test(status)) days += 0.5;
    else if (/present|remote|on.?site/i.test(status)) days += 1;
    else if (parseAmount(row.hours) > 0) days += Math.min(1, parseAmount(row.hours) / 8);
  }
  return roundMoney(days);
}

/** Calendar month containing payDate → [from, to]. */
export function payPeriodBounds(payDate: string): { from: string; to: string } {
  const d = payDate.slice(0, 10);
  const y = d.slice(0, 4);
  const m = d.slice(5, 7);
  const last = new Date(Number(y), Number(m), 0).getDate();
  return {
    from: `${y}-${m}-01`,
    to: `${y}-${m}-${String(last).padStart(2, "0")}`,
  };
}

export function openPositions(): ManagerRecord[] {
  return loadRecords("payroll", "job-positions").filter((r) =>
    /open|hiring|active/i.test(r.status || ""),
  );
}

export function onboardingInProgress(): ManagerRecord[] {
  return loadRecords("payroll", "onboarding").filter(
    (r) => !/complete|cancelled|canceled|done/i.test(r.status || ""),
  );
}

export function hrSummary() {
  const employees = activeHrEmployees();
  const leave = pendingLeaveRequests();
  const positions = openPositions();
  const onboarding = onboardingInProgress();
  const today = new Date().toISOString().slice(0, 10);
  const todayAttendance = attendanceForDate(today);
  const present = todayAttendance.filter((a) =>
    /present|on.?site|remote/i.test(a.status || ""),
  ).length;
  return {
    headcount: employees.length,
    pendingLeave: leave.length,
    openPositions: positions.length,
    onboarding: onboarding.length,
    presentToday: present,
    attendanceLogged: todayAttendance.length,
  };
}
