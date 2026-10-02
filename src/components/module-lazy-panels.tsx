"use client";

import { ModulePageSkeleton } from "@/components/page-loading";
import { importWithRetry } from "@/lib/chunk-recovery";
import type { LiveReportKind } from "@/lib/live-report-kind";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

const panelLoading = () => <ModulePageSkeleton />;

function lazyNamed<P = Record<string, unknown>>(
  loader: () => Promise<Record<string, unknown>>,
  exportName: string,
) {
  return dynamic(
    async () => {
      // Every lazy panel in the app funnels through here, so one retry wrapper
      // covers all of them: a chunk that fails on a flaky connection is retried
      // instead of dropping the user into the crash boundary.
      const mod = await importWithRetry(loader);
      const Comp = mod[exportName] as ComponentType<P>;
      return { default: Comp };
    },
    { ssr: false, loading: panelLoading },
  );
}

export const FinancialReportPanel = lazyNamed<{ kind: LiveReportKind }>(
  () => import("@/components/financial-report-panel"),
  "FinancialReportPanel",
);

export const AccountingOperationsDesk = lazyNamed(
  () => import("@/components/accounting-operations-desk"),
  "AccountingOperationsDesk",
);

export const BankAccountActivityPanel = lazyNamed<{
  accountName: string;
  focus?: string;
}>(() => import("@/components/bank-account-activity"), "BankAccountActivityPanel");

export const BankStatementImporter = lazyNamed<{ initialAccount?: string }>(
  () => import("@/components/bank-statement-importer"),
  "BankStatementImporter",
);

export const PayslipComputePanel = lazyNamed(
  () => import("@/components/payslip-compute"),
  "PayslipComputePanel",
);

export const CreatePayrollPanel = lazyNamed(
  () => import("@/components/create-payroll-panel"),
  "CreatePayrollPanel",
);

export const PosTerminalPanel = lazyNamed(
  () => import("@/components/pos-terminal-panel"),
  "PosTerminalPanel",
);

export const FleetReportsPanel = lazyNamed(
  () => import("@/components/fleet-reports-panel"),
  "FleetReportsPanel",
);

export const FleetServiceRemindersPanel = lazyNamed(
  () => import("@/components/fleet-service-reminders-panel"),
  "FleetServiceRemindersPanel",
);

export const ProductDevelopmentSimulationsPanel = lazyNamed(
  () => import("@/components/product-development-simulations-panel"),
  "ProductDevelopmentSimulationsPanel",
);

export const HrDeskPanel = lazyNamed(
  () => import("@/components/hr-desk-panel"),
  "HrDeskPanel",
);

export const ProjectGanttPanel = lazyNamed(
  () => import("@/components/project-gantt-panel"),
  "ProjectGanttPanel",
);

export const ProjectCashflowPanel = lazyNamed(
  () => import("@/components/project-cashflow-panel"),
  "ProjectCashflowPanel",
);

export const MyProjectsPanel = lazyNamed(
  () => import("@/components/project-cashflow-panel"),
  "MyProjectsPanel",
);

export const SalesInvoiceOptionsPanel = lazyNamed(
  () => import("@/components/sales-invoice-options-panel"),
  "SalesInvoiceOptionsPanel",
);

export const DocumentLinesEditor = lazyNamed(
  () => import("@/components/line-items-editor"),
  "DocumentLinesEditor",
);

export const JournalLinesEditor = lazyNamed(
  () => import("@/components/line-items-editor"),
  "JournalLinesEditor",
);
