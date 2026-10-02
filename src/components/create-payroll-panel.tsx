"use client";

import { FeedbackModals, useFeedbackModals } from "@/components/feedback-modals";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  activeEmployees,
  type PayrollOverride,
} from "@/lib/batch-payroll";
import { daysWorkedFromAttendance, payPeriodBounds } from "@/lib/hr-ops";
import { logHistory } from "@/lib/history";
import { formatMoney } from "@/lib/ledger/money";
import { parseAmount } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { nextDocumentReference } from "@/lib/document-references";
import { loadRecords, saveRecords } from "@/lib/records-store";
import { DEFAULT_PAY_DAYS, computeUgandaPayslip } from "@/lib/uganda-payroll";
import {
  exportPayrollCsv,
  exportPayrollExcel,
  exportPayrollPdf,
  type PayrollExportRow,
} from "@/lib/payroll-export";
import { DocumentDownload, People, Refresh } from "iconsax-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";
import { assertPermission } from "@/lib/access-control";
import { getCurrentSessionUser } from "@/lib/session-profile";
import { PAYROLL_RUN_ENTITY } from "@/lib/payroll-run-chain";
import { notifyRequestParties } from "@/lib/export/notify-request-email";

function todayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

type RowState = {
  include: boolean;
  daysWorked: string;
  /** True once the user edits days — sync must not refill from attendance. */
  daysManual?: boolean;
  advances: string;
  arrears: string;
};

export function CreatePayrollPanel() {
  const { feedback, close, showSuccess, showWarning, askConfirm } = useFeedbackModals();
  const ready = useMounted();
  const [tick, setTick] = useState(0);
  const [payDate, setPayDate] = useState(todayIsoDate);
  const [defaultDays, setDefaultDays] = useState(String(DEFAULT_PAY_DAYS));
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  useEffect(() => {
    const reload = () => setTick((n) => n + 1);
    window.addEventListener("financeiag-records-changed", reload);
    return () => window.removeEventListener("financeiag-records-changed", reload);
  }, []);

  const employees = useMemo<ManagerRecord[]>(() => {
    void tick;
    if (!ready) return [];
    return activeEmployees();
  }, [ready, tick]);

  useEffect(() => {
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      const { from, to } = payPeriodBounds(payDate);
      for (const emp of employees) {
        const fromAttendance = daysWorkedFromAttendance(emp, from, to);
        const existing = prev[emp.id];
        next[emp.id] = {
          include: existing?.include ?? parseAmount(emp.basicPay) > 0,
          // Keep manual edits (including cleared ""); otherwise refresh from attendance.
          daysWorked: existing?.daysManual
            ? existing.daysWorked
            : fromAttendance != null
              ? String(fromAttendance)
              : "",
          daysManual: existing?.daysManual,
          advances: existing?.advances ?? "",
          arrears: existing?.arrears ?? "",
        };
      }
      return next;
    });
  }, [employees, payDate]);

  function rowFor(emp: ManagerRecord): RowState {
    return (
      rows[emp.id] ?? {
        include: parseAmount(emp.basicPay) > 0,
        daysWorked: "",
        advances: "",
        arrears: "",
      }
    );
  }

  function setRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] ?? { include: true, daysWorked: "", advances: "", arrears: "" }),
        ...patch,
        ...(patch.daysWorked !== undefined ? { daysManual: true } : {}),
      },
    }));
  }

  const fallbackDays = parseAmount(defaultDays) || DEFAULT_PAY_DAYS;

  const computed = useMemo(
    () =>
      employees.map((emp) => {
        const row = rowFor(emp);
        const result = computeUgandaPayslip({
          basicPay: parseAmount(emp.basicPay),
          daysWorked: row.daysWorked === "" ? fallbackDays : parseAmount(row.daysWorked),
          daysInPeriod: DEFAULT_PAY_DAYS,
          advances: parseAmount(row.advances),
          arrears: parseAmount(row.arrears),
          nonResident: /non-?resident/i.test(emp.residentStatus || ""),
          asOf: payDate,
        });
        return { emp, row, result };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, rows, fallbackDays, payDate],
  );

  const included = computed.filter(
    (c) => c.row.include && parseAmount(c.emp.basicPay) > 0,
  );
  const totals = included.reduce(
    (acc, c) => ({
      gross: acc.gross + c.result.adjustedBasic,
      paye: acc.paye + c.result.paye,
      nssf: acc.nssf + c.result.nssfEmployee,
      nssfEmployer: acc.nssfEmployer + c.result.nssfEmployer,
      net: acc.net + c.result.netPay,
    }),
    { gross: 0, paye: 0, nssf: 0, nssfEmployer: 0, net: 0 },
  );

  const exportRows: PayrollExportRow[] = included.map(({ emp, result }) => ({
    name: emp.name || "",
    employeeId: emp.code || "",
    department: emp.department || "",
    bank: emp.bankAccount || "",
    bankCode: emp.bankCode || "",
    accountNumber: emp.accountNumber || "",
    phone: emp.phone || "",
    basicPay: result.basicPay,
    dailyRate: result.dailyRate,
    daysWorked: result.daysWorked,
    adjustedBasic: result.adjustedBasic,
    nssf: result.nssfEmployee,
    paye: result.paye,
    advances: result.advances,
    arrears: result.arrears,
    netPay: result.netPay,
  }));

  async function exportFile(kind: "excel" | "pdf" | "csv") {
    if (!exportRows.length) {
      showWarning("Nothing to export", "Select at least one employee first.");
      return;
    }
    try {
      if (kind === "csv") {
        exportPayrollCsv(exportRows, payDate);
        return;
      }
      setExporting(kind);
      if (kind === "excel") await exportPayrollExcel(exportRows, payDate);
      else await exportPayrollPdf(exportRows, payDate);
    } catch {
      showWarning("Export failed", `Could not create the ${kind.toUpperCase()} payroll file.`);
    } finally {
      setExporting(null);
    }
  }

  function run() {
    const payrollBlock = assertPermission("payroll");
    if (payrollBlock) {
      showWarning("Permission denied", payrollBlock);
      return;
    }
    if (!included.length) {
      showWarning(
        "Nothing to run",
        "Select at least one active employee with basic pay.",
      );
      return;
    }
    askConfirm({
      title: "Submit payroll for approval?",
      message: `Submit ${included.length} employee${
        included.length === 1 ? "" : "s"
      } dated ${payDate} (net ${formatMoney(totals.net)}) for Accounts → GM → CEO → Finance approval? Payslips are created only after CEO approval and Finance release.`,
      confirmLabel: "Submit for approval",
      danger: false,
      onConfirm: commit,
    });
  }

  function commit() {
    void (async () => {
      const overrides: Record<string, PayrollOverride> = {};
      for (const { emp, row } of computed) {
        overrides[emp.id] = {
          include: row.include,
          daysWorked: row.daysWorked === "" ? fallbackDays : parseAmount(row.daysWorked),
          advances: parseAmount(row.advances),
          arrears: parseAmount(row.arrears),
        };
      }

      const existingRuns = loadRecords("payroll", PAYROLL_RUN_ENTITY);
      const already = existingRuns.some(
        (run) =>
          run.date === payDate &&
          !/^(rejected|cancelled|canceled)$/i.test(run.status || "") &&
          (run.payslipsCreated || "").trim() !== "true",
      );
      if (already) {
        showWarning(
          "Payroll already submitted",
          `A payroll run for ${payDate} is already in the approval chain. Open Payroll Runs or the approval desk.`,
        );
        return;
      }

      const user = getCurrentSessionUser();
      const now = new Date().toISOString();
      const reference = nextDocumentReference(PAYROLL_RUN_ENTITY, existingRuns);
      const run: ManagerRecord = {
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
        createdAt: now,
        updatedAt: now,
        reference,
        date: payDate,
        payDate,
        requestedBy: user?.name || user?.username || "",
        createdBy: user?.name || user?.username || "",
        createdByUserId: user?.id || "",
        department: "Payroll",
        employeeCount: String(included.length),
        defaultDays: String(fallbackDays),
        grossTotal: String(totals.gross),
        payeTotal: String(totals.paye),
        nssfTotal: String(totals.nssf + totals.nssfEmployer),
        amount: String(totals.net),
        currency: "UGX",
        purpose: `Payroll run for ${included.length} employees dated ${payDate}`,
        status: "Submitted",
        submittedAt: now,
        overridesJson: JSON.stringify(overrides),
        payslipsCreated: "",
        payslipCount: "",
        payslipIds: "",
      };

      const persisted = await saveRecords("payroll", PAYROLL_RUN_ENTITY, [
        run,
        ...existingRuns,
      ]);
      if (!persisted.ok) {
        showWarning(
          "Could not submit payroll",
          persisted.error || "Payroll run was not stored. Try again.",
        );
        return;
      }

      logHistory({
        action: "Created",
        module: "Payroll",
        entity: PAYROLL_RUN_ENTITY,
        record: run,
        details: `Submitted payroll run ${reference} for CEO approval chain`,
      });

      notifyRequestParties({
        entityKey: PAYROLL_RUN_ENTITY,
        record: run,
        event: "submitted",
      });

      showSuccess(
        "Payroll submitted",
        `${reference} submitted for Accounts Assistant → GM → CEO → Finance. Payslips appear after Finance releases the run.`,
      );
    })();
  }

  function resetRows() {
    setRows((prev) => {
      const next: Record<string, RowState> = {};
      for (const id of Object.keys(prev)) {
        next[id] = {
          ...prev[id],
          daysWorked: "",
          advances: "",
          arrears: "",
          daysManual: false,
        };
      }
      return next;
    });
  }

  return (
    <>
      <FeedbackModals feedback={feedback} onClose={close} />
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="mb-1.5 text-[12px] text-slate-700">Pay date</Label>
              <Input
                type="date"
                className="w-44"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-1.5 text-[12px] text-slate-700">Default days worked</Label>
              <Input
                type="number"
                min="0"
                step="0.5"
                className="w-40"
                value={defaultDays}
                onChange={(e) => setDefaultDays(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" onClick={resetRows}>
              <Refresh size={13} color="currentColor" /> Reset adjustments
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!included.length || Boolean(exporting)}
                onClick={() => void exportFile("excel")}
              >
                <DocumentDownload size={13} color="currentColor" />
                {exporting === "excel" ? "Exporting…" : "Excel"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!included.length || Boolean(exporting)}
                onClick={() => void exportFile("pdf")}
              >
                <DocumentDownload size={13} color="currentColor" />
                {exporting === "pdf" ? "Exporting…" : "PDF"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!included.length || Boolean(exporting)}
                onClick={() => void exportFile("csv")}
              >
                <DocumentDownload size={13} color="currentColor" /> CSV
              </Button>
              <Button
                size="sm"
                className="bg-black hover:bg-zinc-800"
                onClick={run}
                disabled={!included.length}
              >
                <People size={14} color="currentColor" /> Submit for approval ({included.length})
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Submits a payroll run for Accounts Assistant → GM → CEO → Finance. Payslips and
            ledger accrual are created only after Finance releases the run. Daily rate = Basic ÷
            30 · Adjusted basic = daily rate × days worked · Net = adjusted basic − NSSF − PAYE −
            advances + arrears.
          </p>
        </div>

        <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Employees" value={String(included.length)} />
          <Stat label="Gross" value={formatMoney(totals.gross)} />
          <Stat label="PAYE" value={formatMoney(totals.paye)} />
          <Stat label="NSSF (5% + 10%)" value={formatMoney(totals.nssf + totals.nssfEmployer)} />
          <Stat label="Net pay" value={formatMoney(totals.net)} accent />
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1000px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] text-slate-400">
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2 font-normal">Name</th>
                <th className="px-3 py-2 font-normal">ID</th>
                <th className="px-3 py-2 font-normal">Department</th>
                <th className="px-3 py-2 font-normal">Bank</th>
                <th className="px-3 py-2 font-normal">Basic pay</th>
                <th className="px-3 py-2 font-normal">Days</th>
                <th className="px-3 py-2 font-normal">Advances</th>
                <th className="px-3 py-2 font-normal">Arrears</th>
                <th className="px-3 py-2 font-normal">NSSF</th>
                <th className="px-3 py-2 font-normal">PAYE</th>
                <th className="px-3 py-2 font-normal">Net pay</th>
              </tr>
            </thead>
            <tbody>
              {computed.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-10 text-center text-slate-400">
                    No active employees yet.{" "}
                    <Link href="/payroll?view=employees" className="text-slate-700 underline">
                      Add employees
                    </Link>{" "}
                    to run payroll.
                  </td>
                </tr>
              )}
              {computed.map(({ emp, row, result }) => {
                const noPay = parseAmount(emp.basicPay) <= 0;
                return (
                  <tr
                    key={emp.id}
                    className={`border-b border-slate-50 last:border-0 ${
                      row.include && !noPay ? "" : "opacity-50"
                    }`}
                  >
                    <td className="px-3 py-2">
                      <Checkbox
                        checked={row.include && !noPay}
                        disabled={noPay}
                        onCheckedChange={() => setRow(emp.id, { include: !row.include })}
                        aria-label={`Include ${emp.name}`}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">{emp.name}</td>
                    <td className="px-3 py-2 text-slate-500">{emp.code || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{emp.department || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {emp.bankAccount || "—"}
                      {emp.bankCode || emp.accountNumber ? (
                        <span className="block text-[10px] text-slate-400">
                          {[emp.bankCode, emp.accountNumber].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {noPay ? (
                        <span className="text-amber-600">No basic pay</span>
                      ) : (
                        formatMoney(parseAmount(emp.basicPay))
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.5"
                        className="h-8 w-20"
                        placeholder={String(fallbackDays)}
                        value={row.daysWorked}
                        onChange={(e) => setRow(emp.id, { daysWorked: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        className="h-8 w-24"
                        placeholder="0"
                        value={row.advances}
                        onChange={(e) => setRow(emp.id, { advances: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        className="h-8 w-24"
                        placeholder="0"
                        value={row.arrears}
                        onChange={(e) => setRow(emp.id, { arrears: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">
                      {formatMoney(result.nssfEmployee)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">
                      {formatMoney(result.paye)}
                    </td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-emerald-700">
                      {formatMoney(result.netPay)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">{label}</p>
      <p
        className={`mt-0.5 tabular-nums ${
          accent
            ? "text-[16px] font-semibold text-emerald-700"
            : "text-[15px] font-semibold text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
