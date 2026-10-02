"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchablePicker } from "@/components/searchable-picker";
import { hydrateEntityFromDatabase } from "@/lib/db/sync";
import { formatMoney } from "@/lib/ledger/money";
import { parseAmount } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords } from "@/lib/records-store";
import { isActiveEmployeeStatus } from "@/lib/hr-ops";
import {
  DEFAULT_PAY_DAYS,
  URA_PAYE_2026_EFFECTIVE_FROM,
  computeUgandaPayslip,
} from "@/lib/uganda-payroll";
import { useEffect, useMemo, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";

export type PayslipComputeValues = {
  employee: string;
  employeeId: string;
  bankAccount: string;
  bankCode: string;
  accountNumber: string;
  department: string;
  phone: string;
  basicPay: string;
  daysInPeriod: string;
  daysWorked: string;
  dailyRate: string;
  adjustedBasic: string;
  earnings: string;
  paye: string;
  nssfEmployee: string;
  nssfEmployer: string;
  advances: string;
  arrears: string;
  deductions: string;
  contributions: string;
  netPay: string;
};

function employeesList(): ManagerRecord[] {
  if (typeof window === "undefined") return [];
  return loadRecords("payroll", "employees").filter((e) =>
    isActiveEmployeeStatus(e.status),
  );
}

export function PayslipComputePanel({
  initial,
  readOnly,
  payDate,
}: {
  initial?: Partial<PayslipComputeValues> | null;
  readOnly?: boolean;
  onChange?: (values: PayslipComputeValues) => void;
  /** Payslip date — selects URA PAYE schedule (FY 2026/27 from 1 Jul 2026). */
  payDate?: string;
}) {
  const ready = useMounted();
  const [employee, setEmployee] = useState(initial?.employee || "");
  const [employeeId, setEmployeeId] = useState(initial?.employeeId || "");
  const [bankAccount, setBankAccount] = useState(initial?.bankAccount || "");
  const [bankCode, setBankCode] = useState(initial?.bankCode || "");
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber || "");
  const [department, setDepartment] = useState(initial?.department || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [basicPay, setBasicPay] = useState(initial?.basicPay || "");
  const [daysWorked, setDaysWorked] = useState(
    initial?.daysWorked || String(DEFAULT_PAY_DAYS),
  );
  const [advances, setAdvances] = useState(initial?.advances || "0");
  const [arrears, setArrears] = useState(initial?.arrears || "0");
  const [nonResident, setNonResident] = useState(false);
  const [payDateLocal, setPayDateLocal] = useState(
    () => payDate || new Date().toISOString().slice(0, 10),
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const reload = () => setTick((n) => n + 1);
    window.addEventListener("financeiag-records-changed", reload);
    return () => window.removeEventListener("financeiag-records-changed", reload);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateEntityFromDatabase("payroll", "employees");
      await hydrateEntityFromDatabase("payroll", "departments");
      if (!cancelled) setTick((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (payDate) setPayDateLocal(payDate);
  }, [payDate]);

  // Seed from record values only — never from a new `initial` object identity.
  // Parent often passes inline `{ … }` each render; that was wiping fields on sync.
  const initialSeedKey = [
    initial?.employee,
    initial?.employeeId,
    initial?.bankAccount,
    initial?.bankCode,
    initial?.accountNumber,
    initial?.department,
    initial?.phone,
    initial?.basicPay,
    initial?.daysWorked,
    initial?.advances,
    initial?.arrears,
  ].join("\0");

  useEffect(() => {
    setEmployee(initial?.employee || "");
    setEmployeeId(initial?.employeeId || "");
    setBankAccount(initial?.bankAccount || "");
    setBankCode(initial?.bankCode || "");
    setAccountNumber(initial?.accountNumber || "");
    setDepartment(initial?.department || "");
    setPhone(initial?.phone || "");
    setBasicPay(initial?.basicPay || "");
    setDaysWorked(initial?.daysWorked || String(DEFAULT_PAY_DAYS));
    setAdvances(initial?.advances || "0");
    setArrears(initial?.arrears || "0");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by initialSeedKey
  }, [initialSeedKey]);

  const staff = useMemo(() => {
    void tick;
    if (!ready) return [];
    return employeesList();
  }, [ready, tick]);

  const pickerOptions = useMemo(
    () =>
      staff.map((e) => ({
        value: e.name || "",
        label: e.code ? `${e.code} — ${e.name}` : e.name || "",
        meta: e.department || (e.basicPay ? formatMoney(parseAmount(e.basicPay)) : undefined),
        searchText: `${e.code} ${e.name} ${e.phone} ${e.bankAccount} ${e.department} ${e.accountNumber}`,
      })),
    [staff],
  );

  const result = useMemo(
    () =>
      computeUgandaPayslip({
        basicPay: parseAmount(basicPay),
        daysWorked: parseAmount(daysWorked) || 0,
        daysInPeriod: DEFAULT_PAY_DAYS,
        advances: parseAmount(advances),
        arrears: parseAmount(arrears),
        nonResident,
        asOf: payDateLocal,
      }),
    [basicPay, daysWorked, advances, arrears, nonResident, payDateLocal],
  );

  function pickEmployee(name: string) {
    setEmployee(name);
    const match = staff.find((e) => (e.name || "") === name);
    if (!match) return;
    setEmployeeId(match.code || "");
    setBankAccount(match.bankAccount || "");
    setBankCode(match.bankCode || "");
    setAccountNumber(match.accountNumber || "");
    setDepartment(match.department || "");
    setPhone(match.phone || "");
    if (match.basicPay) setBasicPay(match.basicPay);
    setNonResident(/non-?resident/i.test(match.residentStatus || ""));
  }

  const money = (n: number) => formatMoney(n);

  return (
    <div className="space-y-4 sm:col-span-2">
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <p className="text-[12px] font-semibold text-slate-800">Payroll sheet compute</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Daily rate = Basic ÷ 30 · Adjusted basic = Daily rate × Days worked · Net = Adjusted
          basic − NSSF − PAYE − Advances + Arrears. PAYE uses URA FY 2026/27 bands
          {payDateLocal && payDateLocal < URA_PAYE_2026_EFFECTIVE_FROM
            ? " (pre–1 Jul 2026 schedule for this pay date)"
            : " from 1 Jul 2026"}
          .
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Pay date (URA schedule)</Label>
            <Input
              type="date"
              value={payDateLocal}
              readOnly={readOnly}
              onChange={(e) => setPayDateLocal(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1.5 text-[12px] text-slate-700">
              Name <span className="text-orange-500">*</span>
            </Label>
            <input type="hidden" name="employee" value={employee} />
            <SearchablePicker
              value={employee}
              readOnly={readOnly}
              options={pickerOptions}
              placeholder="Select employee"
              searchPlaceholder="Search name or ID…"
              emptyText="No employees — add them under Payroll → Employees"
              onChange={pickEmployee}
            />
          </div>

          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">ID</Label>
            <Input
              name="employeeId"
              value={employeeId}
              readOnly={readOnly}
              onChange={(e) => setEmployeeId(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Department</Label>
            <Input
              name="department"
              value={department}
              readOnly={readOnly}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Phone number</Label>
            <Input
              name="phone"
              value={phone}
              readOnly={readOnly}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Bank</Label>
            <Input
              name="bankAccount"
              value={bankAccount}
              readOnly={readOnly}
              onChange={(e) => setBankAccount(e.target.value)}
              placeholder="Bank name"
            />
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Bank code</Label>
            <Input
              name="bankCode"
              value={bankCode}
              readOnly={readOnly}
              onChange={(e) => setBankCode(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Account number</Label>
            <Input
              name="accountNumber"
              value={accountNumber}
              readOnly={readOnly}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
          </div>

          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">
              Basic pay <span className="text-orange-500">*</span>
            </Label>
            <Input
              name="basicPay"
              type="number"
              step="any"
              value={basicPay}
              readOnly={readOnly}
              onChange={(e) => setBasicPay(e.target.value)}
              required
            />
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Tax status</Label>
            <select
              className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm"
              value={nonResident ? "Non-resident" : "Resident"}
              disabled={readOnly}
              onChange={(e) => setNonResident(e.target.value === "Non-resident")}
            >
              <option value="Resident">Resident (URA bands)</option>
              <option value="Non-resident">Non-resident</option>
            </select>
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Daily rate</Label>
            <Input value={money(result.dailyRate)} readOnly tabIndex={-1} />
            <p className="mt-1 text-[10px] text-slate-400">Basic ÷ 30</p>
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">
              Days worked <span className="text-orange-500">*</span>
            </Label>
            <Input
              name="daysWorked"
              type="number"
              step="0.5"
              min="0"
              value={daysWorked}
              readOnly={readOnly}
              onChange={(e) => setDaysWorked(e.target.value)}
              required
            />
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Advances</Label>
            <Input
              name="advances"
              type="number"
              step="any"
              min="0"
              value={advances}
              readOnly={readOnly}
              onChange={(e) => setAdvances(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Arrears</Label>
            <Input
              name="arrears"
              type="number"
              step="any"
              min="0"
              value={arrears}
              readOnly={readOnly}
              onChange={(e) => setArrears(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Summary label="Daily rate" value={money(result.dailyRate)} />
        <Summary label="Adjusted basic" value={money(result.adjustedBasic)} strong />
        <Summary label="NSSF (5%)" value={money(result.nssfEmployee)} />
        <Summary
          label={
            result.payeSchedule === "2026-07" ? "PAYE (URA from Jul 2026)" : "PAYE (URA pre-Jul 2026)"
          }
          value={money(result.paye)}
        />
        <Summary label="Advances" value={money(result.advances)} />
        <Summary label="Arrears" value={money(result.arrears)} />
        <Summary label="NSSF employer 10%" value={money(result.nssfEmployer)} />
        <Summary label="Net pay" value={money(result.netPay)} strong accent />
      </div>

      <input type="hidden" name="daysInPeriod" value={String(DEFAULT_PAY_DAYS)} />
      <input type="hidden" name="dailyRate" value={String(result.dailyRate)} />
      <input type="hidden" name="adjustedBasic" value={String(result.adjustedBasic)} />
      <input type="hidden" name="earnings" value={String(result.adjustedBasic)} />
      <input type="hidden" name="paye" value={String(result.paye)} />
      <input type="hidden" name="nssfEmployee" value={String(result.nssfEmployee)} />
      <input type="hidden" name="nssfEmployer" value={String(result.nssfEmployer)} />
      <input type="hidden" name="deductions" value={String(result.totalDeductions)} />
      <input type="hidden" name="contributions" value={String(result.nssfEmployer)} />
      <input type="hidden" name="netPay" value={String(result.netPay)} />
      <input type="hidden" name="amount" value={String(result.adjustedBasic + result.arrears)} />
    </div>
  );
}

function Summary({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">{label}</p>
      <p
        className={`mt-0.5 tabular-nums ${
          accent
            ? "text-[16px] font-semibold text-emerald-700"
            : strong
              ? "text-[15px] font-semibold text-slate-900"
              : "text-[13px] font-medium text-slate-800"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** Field keys rendered by PayslipComputePanel — hide the generic inputs. */
export { PAYSLIP_COMPUTE_KEYS } from "@/lib/payslip-compute-keys";
