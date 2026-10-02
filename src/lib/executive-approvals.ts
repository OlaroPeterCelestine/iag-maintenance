/**
 * CEO / Finance executive desk: whole-business summary, stalled projects,
 * payment requests, and financial documents awaiting approval.
 */
import { REQUIRED_ACCOUNTING_DOCUMENTS } from "@/lib/accounting-documents";
import { logHistory } from "@/lib/history";
import { getLiveSummary } from "@/lib/ledger/live-data";
import { formatMoney } from "@/lib/ledger/money";
import { computeAccountBalances } from "@/lib/ledger/posting";
import { postRecordToLedger } from "@/lib/ledger/api-post";
import { hrefForRecordDetail, hrefForSourceDocument } from "@/lib/module-data";
import { parseAmount } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadManagerSettings } from "@/lib/manager-settings";
import { isPendingApprovalStatus } from "@/lib/pending-approvals";
import {
  listAllPaymentRequests,
  paymentRequestBucket,
  paymentRequestSummary,
  type PaymentRequestMonitorRow,
} from "@/lib/payment-requests-monitor";
import { listAllApprovalDeskRequests } from "@/lib/approval-desk";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";

export type DeskTab =
  | "overview"
  | "mine"
  | "oral"
  | "general"
  | "leave"
  | "payments"
  | "documents"
  | "projects"
  | "red";

export type PendingFinancialDoc = {
  id: string;
  reference: string;
  date: string;
  dueDate: string;
  amount: number;
  currency: string;
  status: string;
  label: string;
  entityKey: string;
  module: string;
  href: string;
  party: string;
  overdue: boolean;
  highValue: boolean;
  daysOpen: number;
};

export type StalledProjectRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  manager: string;
  customer: string;
  endDate: string;
  daysOverdue: number;
  budget: number;
  spent: number;
  openPaymentRequests: number;
  overdueMilestones: number;
  blockedTasks: number;
  reason: string;
  href: string;
};

export type ProjectDeskLine = {
  id: string;
  title: string;
  status: string;
  dueDate: string;
  overdue: boolean;
  href: string;
};

export type ProjectDeskSummary = StalledProjectRow & {
  startDate: string;
  description: string;
  department: string;
  location: string;
  currency: string;
  remaining: number;
  record: ManagerRecord | null;
  milestones: ProjectDeskLine[];
  tasks: ProjectDeskLine[];
  phases: ProjectDeskLine[];
  paymentRequests: PaymentRequestMonitorRow[];
};

export type BusinessSnapshot = {
  businessName: string;
  asOf: string;
  year: number;
  currency: string;
  balanced: boolean;
  cashAndBank: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  netProfit: number;
  totalIncome: number;
  totalExpenses: number;
  accountsReceivable: number;
  accountsPayable: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
  documentCount: number;
  formatted: {
    cashAndBank: string;
    assets: string;
    liabilities: string;
    equity: string;
    netProfit: string;
    income: string;
    expenses: string;
    ar: string;
    ap: string;
    workingCapital: string;
  };
};

export type ExecutiveDeskSnapshot = {
  currency: string;
  materiality: number;
  business: BusinessSnapshot;
  payments: PaymentRequestMonitorRow[];
  paymentSummary: ReturnType<typeof paymentRequestSummary>;
  documents: PendingFinancialDoc[];
  stalledProjects: StalledProjectRow[];
  redItems: Array<
    | { kind: "payment"; row: PaymentRequestMonitorRow }
    | { kind: "document"; row: PendingFinancialDoc }
    | { kind: "project"; row: StalledProjectRow }
  >;
  totals: {
    awaitingPayments: number;
    awaitingPaymentAmount: number;
    overduePayments: number;
    overduePaymentAmount: number;
    pendingDocuments: number;
    pendingDocumentAmount: number;
    stalledProjects: number;
    redCount: number;
    redAmount: number;
    approvedReadyToPay: number;
    approvedReadyAmount: number;
    highValueCount: number;
  };
  healthLine: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function cashAndBankTotal(asOf: string): number {
  return computeAccountBalances(asOf)
    .filter(
      (row) =>
        row.type === "Asset" &&
        /cash|bank|1000|1050|1100/i.test(`${row.code} ${row.name}`),
    )
    .reduce((sum, row) => sum + row.balance, 0);
}

export function buildBusinessSnapshot(): BusinessSnapshot {
  const live = getLiveSummary();
  const cash = cashAndBankTotal(live.asOf);
  const workingCapital = live.totalAssets - live.totalLiabilities;
  return {
    businessName: live.businessName,
    asOf: live.asOf,
    year: live.year,
    currency: live.currency,
    balanced: live.balanced,
    cashAndBank: cash,
    totalAssets: live.totalAssets,
    totalLiabilities: live.totalLiabilities,
    totalEquity: live.totalEquity,
    netProfit: live.netProfit,
    totalIncome: live.totalIncome,
    totalExpenses: live.totalExpenses,
    accountsReceivable: live.accountsReceivable,
    accountsPayable: live.accountsPayable,
    paidCount: live.paidCount,
    pendingCount: live.pendingCount,
    overdueCount: live.overdueCount,
    documentCount: live.documentCount,
    formatted: {
      cashAndBank: formatMoney(cash, true),
      assets: live.formatted.assets,
      liabilities: live.formatted.liabilities,
      equity: live.formatted.equity,
      netProfit: live.formatted.netProfit,
      income: live.formatted.income,
      expenses: live.formatted.expenses,
      ar: live.formatted.ar,
      ap: live.formatted.ap,
      workingCapital: formatMoney(workingCapital, true),
    },
  };
}

function projectStillOpen(status: string): boolean {
  return /^(planning|active|on hold|in progress|running|open)$/i.test((status || "").trim());
}

/** Projects past end date, on hold, or blocked by overdue milestones / tasks. */
export function listStalledProjects(): StalledProjectRow[] {
  if (typeof window === "undefined") return [];
  const today = todayIso();
  const projects = loadRecords("projects", "projects");
  const milestones = loadRecords("projects", "milestones");
  const tasks = loadRecords("projects", "tasks");
  const paymentRequests = listAllPaymentRequests();

  const out: StalledProjectRow[] = [];
  for (const project of projects) {
    const status = (project.status || "").trim();
    if (/^(completed|cancelled|canceled)$/i.test(status)) continue;

    const name = project.name || project.reference || project.code || project.id.slice(0, 8);
    const endDate = (project.endDate || project.dueDate || "").trim();
    const daysOverdue = endDate && endDate < today ? daysBetween(endDate, today) : 0;
    const overdueMilestones = milestones.filter((m) => {
      const projectMatch =
        (m.project || "").trim().toLowerCase() === name.toLowerCase() ||
        (m.project || "").trim() === project.code;
      if (!projectMatch) return false;
      if (/^(completed|done|approved|cancelled|canceled)$/i.test(m.status || "")) return false;
      const due = (m.dueDate || m.endDate || "").trim();
      return Boolean(due && due < today);
    }).length;
    const blockedTasks = tasks.filter((t) => {
      const projectMatch =
        (t.project || "").trim().toLowerCase() === name.toLowerCase() ||
        (t.project || "").trim() === project.code;
      if (!projectMatch) return false;
      return (
        /^blocked$/i.test(t.status || "") ||
        (projectStillOpen(t.status || "Todo") &&
          Boolean((t.dueDate || "").trim() && (t.dueDate || "") < today))
      );
    }).length;
    const openPaymentRequests = paymentRequests.filter(
      (p) =>
        p.awaiting &&
        (p.project || "").trim().toLowerCase() === name.toLowerCase(),
    ).length;

    const onHold = /^on hold$/i.test(status);
    const pastEnd = daysOverdue > 0 && projectStillOpen(status);
    if (!pastEnd && !onHold && overdueMilestones === 0 && blockedTasks === 0) continue;

    const reasons: string[] = [];
    if (pastEnd) reasons.push(`${daysOverdue}d past end date`);
    if (onHold) reasons.push("On hold");
    if (overdueMilestones) reasons.push(`${overdueMilestones} overdue milestone${overdueMilestones === 1 ? "" : "s"}`);
    if (blockedTasks) reasons.push(`${blockedTasks} blocked/overdue task${blockedTasks === 1 ? "" : "s"}`);
    if (openPaymentRequests) reasons.push(`${openPaymentRequests} open payment request${openPaymentRequests === 1 ? "" : "s"}`);

    out.push({
      id: project.id,
      name,
      code: project.code || "",
      status: status || "Active",
      manager: project.manager || "",
      customer: project.customer || "",
      endDate,
      daysOverdue,
      budget: parseAmount(project.budget || "0"),
      spent: parseAmount(project.spent || project.cost || "0"),
      openPaymentRequests,
      overdueMilestones,
      blockedTasks,
      reason: reasons.join(" · "),
      href: hrefForRecordDetail("projects", "projects", project.id),
    });
  }

  return out.sort(
    (a, b) =>
      b.daysOverdue - a.daysOverdue ||
      b.overdueMilestones - a.overdueMilestones ||
      a.name.localeCompare(b.name),
  );
}

function matchesProject(row: ManagerRecord, project: ManagerRecord, name: string): boolean {
  const ref = (row.project || "").trim();
  if (!ref) return false;
  return (
    ref.toLowerCase() === name.toLowerCase() ||
    ref === project.code ||
    ref === project.id ||
    ref === project.reference
  );
}

function toProjectLine(
  row: ManagerRecord,
  entityKey: string,
  today: string,
): ProjectDeskLine {
  const dueDate = (row.dueDate || row.endDate || "").trim();
  const status = (row.status || "").trim() || "Open";
  const done = /^(completed|done|approved|cancelled|canceled)$/i.test(status);
  return {
    id: row.id,
    title: row.name || row.reference || row.title || row.id.slice(0, 8),
    status,
    dueDate,
    overdue: !done && Boolean(dueDate && dueDate < today),
    href: hrefForRecordDetail("projects", entityKey, row.id),
  };
}

/** Full on-desk summary for a project (CEO review without leaving the page). */
export function getProjectDeskSummary(projectId: string): ProjectDeskSummary | null {
  if (typeof window === "undefined" || !projectId) return null;
  const today = todayIso();
  const projects = loadRecords("projects", "projects");
  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;

  const name = project.name || project.reference || project.code || project.id.slice(0, 8);
  const endDate = (project.endDate || project.dueDate || "").trim();
  const daysOverdue = endDate && endDate < today ? daysBetween(endDate, today) : 0;
  const milestones = loadRecords("projects", "milestones")
    .filter((m) => matchesProject(m, project, name))
    .map((m) => toProjectLine(m, "milestones", today))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.title.localeCompare(b.title));
  const tasks = loadRecords("projects", "tasks")
    .filter((t) => matchesProject(t, project, name))
    .map((t) => toProjectLine(t, "tasks", today))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.title.localeCompare(b.title));
  const phases = loadRecords("projects", "phases")
    .filter((p) => matchesProject(p, project, name))
    .map((p) => toProjectLine(p, "phases", today));
  const paymentRequests = listAllPaymentRequests().filter(
    (p) => (p.project || "").trim().toLowerCase() === name.toLowerCase(),
  );
  const overdueMilestones = milestones.filter((m) => m.overdue).length;
  const blockedTasks = tasks.filter(
    (t) => t.overdue || /^blocked$/i.test(t.status),
  ).length;
  const openPaymentRequests = paymentRequests.filter((p) => p.awaiting).length;
  const onHold = /^on hold$/i.test(project.status || "");
  const pastEnd = daysOverdue > 0 && projectStillOpen(project.status || "Active");
  const reasons: string[] = [];
  if (pastEnd) reasons.push(`${daysOverdue}d past end date`);
  if (onHold) reasons.push("On hold");
  if (overdueMilestones) {
    reasons.push(`${overdueMilestones} overdue milestone${overdueMilestones === 1 ? "" : "s"}`);
  }
  if (blockedTasks) {
    reasons.push(`${blockedTasks} blocked/overdue task${blockedTasks === 1 ? "" : "s"}`);
  }
  if (openPaymentRequests) {
    reasons.push(
      `${openPaymentRequests} open payment request${openPaymentRequests === 1 ? "" : "s"}`,
    );
  }

  const budget = parseAmount(project.budget || "0");
  const spent = parseAmount(project.spent || project.cost || "0");

  return {
    id: project.id,
    name,
    code: project.code || "",
    status: (project.status || "Active").trim(),
    manager: project.manager || "",
    customer: project.customer || "",
    endDate,
    daysOverdue,
    budget,
    spent,
    openPaymentRequests,
    overdueMilestones,
    blockedTasks,
    reason: reasons.join(" · ") || "Project summary",
    href: hrefForRecordDetail("projects", "projects", project.id),
    startDate: (project.startDate || "").trim(),
    description: project.description || project.notes || "",
    department: project.department || "",
    location: project.location || project.site || "",
    currency: project.currency || loadManagerSettings().baseCurrencyCode || "UGX",
    remaining: budget - spent,
    record: project,
    milestones,
    tasks,
    phases,
    paymentRequests,
  };
}

function buildHealthLine(input: {
  business: BusinessSnapshot;
  stalled: number;
  awaitingPayments: number;
  pendingDocs: number;
  redCount: number;
}): string {
  const parts: string[] = [];
  parts.push(
    input.business.balanced ? "Books balanced" : "Books need attention",
  );
  parts.push(`Cash ${input.business.formatted.cashAndBank}`);
  parts.push(`AR ${input.business.formatted.ar} · AP ${input.business.formatted.ap}`);
  if (input.stalled) parts.push(`${input.stalled} stalled project${input.stalled === 1 ? "" : "s"}`);
  if (input.awaitingPayments) {
    parts.push(
      `${input.awaitingPayments} payment${input.awaitingPayments === 1 ? "" : "s"} in approval chain`,
    );
  }
  if (input.pendingDocs) {
    parts.push(`${input.pendingDocs} document${input.pendingDocs === 1 ? "" : "s"} to approve`);
  }
  if (input.redCount) parts.push(`${input.redCount} in the red`);
  return parts.join(" · ");
}

/** All financial source documents still waiting for approval (across modules). */
export function listPendingFinancialDocuments(): PendingFinancialDoc[] {
  if (typeof window === "undefined") return [];
  const today = todayIso();
  const materiality = loadManagerSettings().materialityThreshold || 0;
  const out: PendingFinancialDoc[] = [];
  const seen = new Set<string>();

  for (const doc of REQUIRED_ACCOUNTING_DOCUMENTS) {
    if (doc.module === "reports") continue;
    // Payment requests have their own queue on the desk.
    if (doc.entityKey === "payment-requests") continue;
    const moduleSlug = doc.storageModule || doc.module;
    const rows = loadRecords(moduleSlug, doc.entityKey);
    for (const record of rows) {
      if (!isPendingApprovalStatus(record.status)) continue;
      const key = `${moduleSlug}:${doc.entityKey}:${record.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const reference =
        String(record.reference || record.name || record.code || "").trim() || String(record.id || "").slice(0, 10);
      const dueDate = (record.dueDate || "").trim();
      const amount = parseAmount(
        record.amount || record.total || record.netPay || record.balance || "0",
      );
      const date = record.date || record.issueDate || "";
      const overdue = Boolean(dueDate) && dueDate < today;
      out.push({
        id: record.id,
        reference,
        date,
        dueDate,
        amount,
        currency: record.currency || "UGX",
        status: String(record.status || "Pending").trim(),
        label: doc.label,
        entityKey: doc.entityKey,
        module: moduleSlug,
        href: hrefForSourceDocument(moduleSlug, doc.entityKey, record.id || reference),
        party:
          record.supplier ||
          record.customer ||
          record.party ||
          record.employee ||
          record.contractor ||
          "",
        overdue,
        highValue: materiality > 0 ? amount >= materiality : amount >= 5_000_000,
        daysOpen: daysBetween(date, today),
      });
    }
  }

  return out.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.highValue !== b.highValue) return a.highValue ? -1 : 1;
    return (b.date || "").localeCompare(a.date || "") || a.reference.localeCompare(b.reference);
  });
}

/** Load a pending financial document record (for maker-checker checks). */
export function getFinancialDocument(doc: PendingFinancialDoc): ManagerRecord | null {
  if (typeof window === "undefined") return null;
  return loadRecords(doc.module, doc.entityKey).find((r) => r.id === doc.id) || null;
}

/** Approve a pending financial document from the CEO desk (posts to ledger). */
export async function approveFinancialDocument(doc: PendingFinancialDoc): Promise<{
  ok: boolean;
  error?: string;
  record?: ManagerRecord;
}> {
  if (typeof window === "undefined") return { ok: false, error: "Unavailable." };
  const rows = loadRecords(doc.module, doc.entityKey);
  const index = rows.findIndex((r) => r.id === doc.id);
  if (index < 0) return { ok: false, error: "Document is no longer available." };
  const existing = rows[index]!;
  if (!isPendingApprovalStatus(existing.status)) {
    return { ok: false, error: "Document is no longer awaiting approval." };
  }
  const updated: ManagerRecord = {
    ...existing,
    status: "Approved",
    updatedAt: new Date().toISOString(),
  };
  const next = [...rows];
  next[index] = updated;
  const saved = await saveRecords(doc.module, doc.entityKey, next);
  if (!saved.ok || saved.durable !== "postgres") {
    return {
      ok: false,
      error: saved.error || "Could not save the approval.",
    };
  }
  const result = await postRecordToLedger(doc.module, doc.entityKey, updated);
  if (!result.ok) {
    next[index] = existing;
    const rolledBack = await saveRecords(doc.module, doc.entityKey, next);
    if (!rolledBack.ok || rolledBack.durable !== "postgres") {
      notifyPersistFailure(
        `${doc.module}/${doc.entityKey}`,
        rolledBack.error ||
          `${doc.id} is marked Approved but was not posted to the ledger, and the rollback also failed. Check this document.`,
      );
    }
    return { ok: false, error: result.error || "Could not post to the ledger." };
  }
  logHistory({
    action: "Updated",
    module: doc.module,
    entity: doc.entityKey,
    record: updated,
  });
  return { ok: true, record: updated };
}

/** Full CEO desk snapshot for the Approvals page. */
export function buildExecutiveDesk(): ExecutiveDeskSnapshot {
  const currency = loadManagerSettings().baseCurrencyCode || "UGX";
  const materiality = loadManagerSettings().materialityThreshold || 5_000_000;
  const business = buildBusinessSnapshot();
  const payments = listAllApprovalDeskRequests();
  const paymentSummary = paymentRequestSummary(payments);
  const documents = listPendingFinancialDocuments();
  const stalledProjects = listStalledProjects();

  const approved = payments.filter(
    (p) => paymentRequestBucket(p.status) === "approved",
  );
  const overduePayments = payments.filter((p) => p.overdue);
  const highValuePayments = payments.filter(
    (p) => p.awaiting && p.amount >= materiality,
  );
  const highValueDocs = documents.filter((d) => d.highValue);
  const overdueDocs = documents.filter((d) => d.overdue);

  const redItems: ExecutiveDeskSnapshot["redItems"] = [
    ...overduePayments.map((row) => ({ kind: "payment" as const, row })),
    ...highValuePayments
      .filter((p) => !p.overdue)
      .map((row) => ({ kind: "payment" as const, row })),
    ...overdueDocs.map((row) => ({ kind: "document" as const, row })),
    ...highValueDocs
      .filter((d) => !d.overdue)
      .map((row) => ({ kind: "document" as const, row })),
    ...stalledProjects.map((row) => ({ kind: "project" as const, row })),
  ];

  const redAmount =
    overduePayments.reduce((s, r) => s + r.amount, 0) +
    highValuePayments.filter((p) => !p.overdue).reduce((s, r) => s + r.amount, 0) +
    overdueDocs.reduce((s, r) => s + r.amount, 0) +
    highValueDocs.filter((d) => !d.overdue).reduce((s, r) => s + r.amount, 0);

  const totals = {
    awaitingPayments: paymentSummary.awaiting,
    awaitingPaymentAmount: paymentSummary.totalAwaiting,
    overduePayments: paymentSummary.overdue,
    overduePaymentAmount: overduePayments.reduce((s, r) => s + r.amount, 0),
    pendingDocuments: documents.length,
    pendingDocumentAmount: documents.reduce((s, r) => s + r.amount, 0),
    stalledProjects: stalledProjects.length,
    redCount: redItems.length,
    redAmount,
    approvedReadyToPay: approved.length,
    approvedReadyAmount: approved.reduce((s, r) => s + r.amount, 0),
    highValueCount: highValuePayments.length + highValueDocs.length,
  };

  return {
    currency,
    materiality,
    business,
    payments,
    paymentSummary,
    documents,
    stalledProjects,
    redItems,
    totals,
    healthLine: buildHealthLine({
      business,
      stalled: stalledProjects.length,
      awaitingPayments: totals.awaitingPayments,
      pendingDocs: totals.pendingDocuments,
      redCount: totals.redCount,
    }),
  };
}
