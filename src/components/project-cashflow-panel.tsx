"use client";

import { buttonVariants } from "@/components/ui/button";
import { formatMoney } from "@/lib/ledger/money";
import { parseAmount } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadManagerSettings } from "@/lib/manager-settings";
import {
  currentProjectScopeKind,
  filterRecordsForProjectScope,
  scopedProjectNames,
} from "@/lib/project-scope";
import { paymentRequestBucket } from "@/lib/payment-requests-monitor";
import { loadRecords } from "@/lib/records-store";
import { cn } from "@/lib/utils";
import { useRecordsSyncTick } from "@/hooks/use-records-sync-tick";
import Link from "next/link";
import { useMemo } from "react";

type CashflowRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  budget: number;
  expenses: number;
  requisitions: number;
  paid: number;
  awaiting: number;
  certified: number;
  procurement: number;
  spent: number;
  remaining: number;
  href: string;
};

function money(amount: number, currency: string) {
  return formatMoney(amount, { currencyCode: currency });
}

function buildCashflow(currency: string): CashflowRow[] {
  const kind = currentProjectScopeKind();
  let projects = loadRecords("projects", "projects");
  if (kind !== "all") {
    projects = filterRecordsForProjectScope("projects", projects);
  }
  const expenses = loadRecords("projects", "project-expenses");
  const requisitions = loadRecords("projects", "requisitions");
  const payments = loadRecords("projects", "payment-requests");
  const certs = loadRecords("projects", "progress-certificates");
  const procurement = loadRecords("projects", "procurement-list");

  return projects.map((project) => {
    const name = (project.name || "").trim();
    const match = (row: ManagerRecord) =>
      (row.project || "").trim().toLowerCase() === name.toLowerCase();

    const expenseTotal = expenses.filter(match).reduce((s, r) => s + parseAmount(r.amount), 0);
    const reqTotal = requisitions
      .filter(match)
      .reduce((s, r) => s + parseAmount(r.amount), 0);
    const paidTotal = payments
      .filter(match)
      .filter((r) => paymentRequestBucket(r.status || "") === "paid")
      .reduce((s, r) => s + parseAmount(r.amount), 0);
    const awaitingTotal = payments
      .filter(match)
      .filter((r) => {
        const b = paymentRequestBucket(r.status || "");
        return b === "awaiting" || b === "approved";
      })
      .reduce((s, r) => s + parseAmount(r.amount), 0);
    const certifiedTotal = certs
      .filter(match)
      .filter((r) => /^approved$/i.test(r.status || ""))
      .reduce((s, r) => s + parseAmount(r.amount), 0);
    const procurementTotal = procurement
      .filter(match)
      .filter((r) => !/cancelled/i.test(r.status || ""))
      .reduce((s, r) => s + parseAmount(r.amount || String(parseAmount(r.quantity) * parseAmount(r.unitCost))), 0);

    const budget = parseAmount(project.budget);
    const recordedSpent = parseAmount(project.spent);
    const spent = Math.max(recordedSpent, expenseTotal, paidTotal);
    const remaining = budget - spent;

    return {
      id: project.id,
      name: name || project.code || "Untitled",
      code: project.code || "",
      status: project.status || "—",
      budget,
      expenses: expenseTotal,
      requisitions: reqTotal,
      paid: paidTotal,
      awaiting: awaitingTotal,
      certified: certifiedTotal,
      procurement: procurementTotal,
      spent,
      remaining,
      href: `/projects?view=projects&id=${encodeURIComponent(project.id)}`,
    };
  });
}

export function ProjectCashflowPanel() {
  const { tick } = useRecordsSyncTick([
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "project-expenses" },
    { module: "projects", entity: "requisitions" },
    { module: "projects", entity: "payment-requests" },
    { module: "projects", entity: "progress-certificates" },
    { module: "projects", entity: "procurement-list" },
  ]);
  const currency = loadManagerSettings().baseCurrencyCode || "UGX";

  const rows = useMemo(() => {
    void tick;
    return buildCashflow(currency);
  }, [tick, currency]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          budget: acc.budget + row.budget,
          spent: acc.spent + row.spent,
          paid: acc.paid + row.paid,
          awaiting: acc.awaiting + row.awaiting,
          expenses: acc.expenses + row.expenses,
          procurement: acc.procurement + row.procurement,
        }),
        { budget: 0, spent: 0, paid: 0, awaiting: 0, expenses: 0, procurement: 0 },
      ),
    [rows],
  );

  const scope = currentProjectScopeKind();

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-[16px] font-semibold text-slate-900">Project cashflow</h2>
        <p className="mt-1 text-[13px] text-slate-500">
          Budget vs money spent, project expenses, procurement commitments, and payment requests
          {scope === "all" ? "" : " for your projects"}.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Budget", value: money(totals.budget, currency) },
            { label: "Spent", value: money(totals.spent, currency) },
            { label: "Paid requests", value: money(totals.paid, currency) },
            { label: "In approval", value: money(totals.awaiting, currency) },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-slate-200/90 bg-slate-50/80 px-3.5 py-3"
            >
              <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                {card.label}
              </p>
              <p className="mt-1 text-[18px] font-semibold tabular-nums text-slate-900">
                {card.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-[13px]">
            <thead className="bg-slate-50 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">Project</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Budget</th>
                <th className="px-4 py-2.5 text-right">Expenses</th>
                <th className="px-4 py-2.5 text-right">Procurement</th>
                <th className="px-4 py-2.5 text-right">Paid</th>
                <th className="px-4 py-2.5 text-right">Awaiting</th>
                <th className="px-4 py-2.5 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    No projects to show
                    {scope !== "all"
                      ? ". Link your login username on a Project Manager or Contractor record."
                      : ". Create a project first."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <Link
                        href={row.href}
                        className="font-medium text-slate-900 underline-offset-2 hover:underline"
                      >
                        {row.name}
                      </Link>
                      {row.code ? (
                        <p className="text-[11px] text-slate-400">{row.code}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.status}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(row.budget, currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(row.expenses, currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(row.procurement, currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                      {money(row.paid, currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-amber-700">
                      {money(row.awaiting, currency)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right font-medium tabular-nums",
                        row.remaining < 0 ? "text-rose-700" : "text-slate-900",
                      )}
                    >
                      {money(row.remaining, currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function MyProjectsPanel() {
  const { tick } = useRecordsSyncTick([{ module: "projects", entity: "projects" }]);

  const kind = currentProjectScopeKind();
  const projects = useMemo(() => {
    void tick;
    const all = loadRecords("projects", "projects");
    return filterRecordsForProjectScope("projects", all);
  }, [tick]);
  const names = scopedProjectNames();

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-[16px] font-semibold text-slate-900">My projects</h2>
        <p className="mt-1 text-[13px] text-slate-500">
          {kind === "all"
            ? "All projects in the workspace."
            : kind === "project-manager"
              ? "All projects (Project Manager)."
              : "All projects (Contractor)."}
        </p>
        {kind !== "all" && (!names || names.length === 0) ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            No projects on the server yet. Ask an Administrator to create projects under Projects →
            New Project.
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <Link
            key={project.id}
            href={`/projects?view=projects&id=${encodeURIComponent(project.id)}`}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-auto flex-col items-start gap-1 rounded-xl border-slate-200 bg-white p-4 text-left shadow-sm hover:bg-slate-50",
            )}
          >
            <span className="text-[14px] font-semibold text-slate-900">
              {project.name || project.code || "Project"}
            </span>
            <span className="text-[12px] text-slate-500">
              {project.status || "—"}
              {project.endDate ? ` · ends ${project.endDate}` : ""}
            </span>
            <span className="text-[12px] tabular-nums text-slate-600">
              Budget {project.budget || "0"} · Spent {project.spent || "0"}
            </span>
          </Link>
        ))}
        {projects.length === 0 ? (
          <p className="col-span-full rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-[13px] text-slate-500">
            No projects in your scope yet.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { href: "/projects?view=tasks", label: "Tasks" },
          { href: "/projects?view=milestones", label: "Milestones" },
          { href: "/projects?view=risks", label: "Risks" },
          { href: "/projects?view=procurement-list", label: "Procurement" },
          { href: "/projects?view=project-cashflow", label: "Cashflow" },
          { href: "/projects?view=payment-requests", label: "Payment requests" },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-lg")}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
