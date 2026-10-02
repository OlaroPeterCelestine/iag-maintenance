"use client";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hrSummary } from "@/lib/hr-ops";
import {
  Briefcase,
  Building4,
  Calendar,
  People,
  Profile2User,
  TickCircle,
  Timer1,
} from "iconsax-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";

const QUICK_LINKS = [
  { href: "/payroll?view=employees", label: "Employees", icon: People },
  { href: "/payroll?view=departments", label: "Departments", icon: Building4 },
  { href: "/payroll?view=leave-requests", label: "Leave requests", icon: Calendar },
  { href: "/payroll?view=attendance", label: "Attendance", icon: Timer1 },
  { href: "/payroll?view=job-positions", label: "Job positions", icon: Briefcase },
  { href: "/payroll?view=onboarding", label: "Onboarding", icon: Profile2User },
  { href: "/payroll?view=create-payroll", label: "Run payroll", icon: TickCircle },
] as const;

export function HrDeskPanel() {
  const ready = useMounted();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const reload = () => setTick((n) => n + 1);
    window.addEventListener("financeiag-records-changed", reload);
    return () => window.removeEventListener("financeiag-records-changed", reload);
  }, []);

  const summary = useMemo(() => {
    void tick;
    if (!ready) {
      return {
        headcount: 0,
        pendingLeave: 0,
        openPositions: 0,
        onboarding: 0,
        presentToday: 0,
        attendanceLogged: 0,
      };
    }
    return hrSummary();
  }, [ready, tick]);

  const cards = [
    {
      label: "Headcount",
      value: String(summary.headcount),
      hint: "Active employees",
      href: "/payroll?view=employees",
    },
    {
      label: "Present today",
      value: String(summary.presentToday),
      hint: `${summary.attendanceLogged} attendance rows`,
      href: "/payroll?view=attendance",
    },
    {
      label: "Leave pending",
      value: String(summary.pendingLeave),
      hint: "Awaiting approval",
      href: "/payroll?view=leave-requests",
    },
    {
      label: "Open roles",
      value: String(summary.openPositions),
      hint: `${summary.onboarding} onboarding`,
      href: "/payroll?view=job-positions",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_45%,#f8fafc_100%)] px-5 py-5 sm:px-6">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-sky-700 uppercase">
            People operations
          </p>
          <h2 className="mt-1.5 text-[20px] font-semibold tracking-tight text-slate-900 sm:text-[22px]">
            HR Desk
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-slate-600">
            Manage departments, employees, attendance, leave, hiring, and onboarding — then run
            Uganda payroll from the same workspace.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/payroll?view=create-payroll"
              className={cn(buttonVariants({ size: "lg" }), "h-9 bg-slate-900 text-white hover:bg-slate-800")}
            >
              Create payroll
            </Link>
            <Link
              href="/payroll?view=departments"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-9")}
            >
              Departments
            </Link>
            <Link
              href="/payroll?view=leave-requests"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-9")}
            >
              Review leave
            </Link>
          </div>
        </div>

        <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <Link
              key={card.label}
              href={card.href}
              className="border-t border-slate-100 px-5 py-4 transition hover:bg-slate-50 sm:border-l sm:first:border-l-0"
            >
              <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                {card.label}
              </p>
              <p className="mt-1 text-[24px] font-semibold tracking-tight text-slate-900">
                {card.value}
              </p>
              <p className="mt-0.5 text-[12px] text-slate-500">{card.hint}</p>
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h3 className="text-[13px] font-semibold text-slate-900">HR modules</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          Record keeping for the full people lifecycle. Payroll compute stays under Create Payroll
          and Payslips.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-3 transition hover:border-slate-300 hover:bg-white"
              >
                <span className="flex size-8 items-center justify-center rounded-md bg-slate-900 text-white">
                  <Icon size={15} variant="Bold" color="currentColor" />
                </span>
                <span className="text-[13px] font-medium text-slate-800">{link.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h3 className="text-[13px] font-semibold text-slate-900">Typical workflow</h3>
          <ol className="mt-3 space-y-2 text-[12px] text-slate-600">
            <li>1. Hire — open a job position, then start onboarding for the new hire.</li>
            <li>2. Maintain — open each employee to keep ID/TIN/NSSF, bank, contract, medical & life insurance, next of kin, and leave balance current.</li>
            <li>3. Time — log daily attendance (feeds Create Payroll days) and approve leave (releases leave accrual in the GL).</li>
            <li>4. Pay — run Create Payroll (Uganda PAYE / NSSF); payslips post wages expense and PAYE/NSSF payable.</li>
            <li>5. Settle wages — Banking → Payments against the payslip clears Wages payable.</li>
            <li>6. Remit — set Statutory Remittances to Paid/Filed to clear PAYE/NSSF payable from the bank.</li>
          </ol>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <h3 className="text-[13px] font-semibold text-slate-900">Included HR records</h3>
          <ul className="mt-3 space-y-2 text-[12px] text-slate-600">
            <li>
              <span className="font-medium text-slate-800">Employees</span> — full HR profile:
              personal ID, tax/NSSF, bank pay details, medical & life insurance, next of kin,
              and contract documents.
            </li>
            <li>
              <span className="font-medium text-slate-800">Leave requests</span> — Requestor → HOD →
              HR → Approved. Paid leave releases Leave pay accrual and updates annual leave balance.
            </li>
            <li>
              <span className="font-medium text-slate-800">Attendance</span> — present / remote /
              half-day rows drive days worked on Create Payroll for that month.
            </li>
            <li>
              <span className="font-medium text-slate-800">Statutory remittances</span> — Paid /
              Filed posts Dr PAYE or NSSF payable · Cr bank.
            </li>
            <li>
              <span className="font-medium text-slate-800">Job positions & onboarding</span> —
              hiring pipeline only (no GL until payroll runs).
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
