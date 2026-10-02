"use client";

import { SegmentTabList, segmentTabBadgeClass, segmentTabClass } from "@/components/segment-tabs";
import { PaginationBar } from "@/components/pagination-bar";
import { useAppShell } from "@/components/app-shell";
import { FeedbackModals, REQUEST_PAYMENT_METHODS, useFeedbackModals } from "@/components/feedback-modals";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  approvalDeskForRole,
  deskOwnsRow,
  deskRequestTypeLabel,
  filterPaymentsForDesk,
  getApprovalDeskRecord,
  isApprovalDeskEntityEvent,
  monitorRowsFromDeskApiItems,
  type ApprovalDeskProfile,
} from "@/lib/approval-desk";
import { fetchApprovalDesk } from "@/lib/approval-api";
import {
  entitySupportsApprovalAmount,
  formatRevisedAmountLabel,
} from "@/lib/approval-amount";
import {
  assertMakerChecker,
  assertPermission,
  currentUserCan,
} from "@/lib/access-control";
import { RequestChainTracker } from "@/components/request-chain-tracker";
import {
  advanceActionLabel,
  advancePaymentRequest,
  amendPaymentRequest,
  canAdvancePaymentRequest,
  canAmendPaymentRequest,
  canRejectPaymentRequest,
  paymentChainProgress,
  rejectPaymentRequest,
} from "@/lib/payment-approval-chain";
import {
  advanceGenericRequisition,
  amendGenericRequisition,
  canAdvanceGenericRequisition,
  canAmendGenericRequisition,
  canRejectGenericRequisition,
  rejectGenericRequisition,
} from "@/lib/generic-requisition-chain";
import {
  advanceOralPaymentRequest,
  amendOralPaymentRequest,
  canAdvanceOralPaymentRequest,
  canAmendOralPaymentRequest,
  canRejectOralPaymentRequest,
  oralAdvanceActionLabel,
  oralChainProgress,
  rejectOralPaymentRequest,
} from "@/lib/oral-payment-approval-chain";
import {
  advancePayrollRun,
  amendPayrollRun,
  canAdvancePayrollRun,
  canAmendPayrollRun,
  canRejectPayrollRun,
  payrollRunAdvanceActionLabel,
  payrollRunChainProgress,
  rejectPayrollRun,
} from "@/lib/payroll-run-chain";
import {
  isAdminRole,
  isApprovalRequestOwner,
  requisitionAdvanceActionLabel,
  requisitionChainLabel,
  requisitionChainProgress,
  requisitionIncludesPm,
} from "@/lib/requisition-chain";
import { canRedoRejectedRequest } from "@/lib/request-amend-flow";
import {
  leaveChainProgress,
} from "@/lib/leave-request-chain";
import {
  approveFinancialDocument,
  buildExecutiveDesk,
  getFinancialDocument,
  getProjectDeskSummary,
  type DeskTab,
  type PendingFinancialDoc,
  type ProjectDeskSummary,
  type StalledProjectRow,
} from "@/lib/executive-approvals";
import {
  ACTION_WIDGET_IDS,
  BUSINESS_WIDGET_IDS,
  DEFAULT_CEO_DESK_WIDGETS,
  loadCeoDeskWidgets,
  saveCeoDeskWidgets,
  type ActionWidgetId,
  type BusinessWidgetId,
  type CeoDeskWidgetLayout,
} from "@/lib/ceo-desk-widgets";
import { formatMoney } from "@/lib/ledger/money";
import type { ManagerRecord } from "@/lib/manager-entities";
import {
  departmentsFromPaymentRequests,
  filterPaymentRequests,
  type PaymentRequestBucket,
  type PaymentRequestMonitorRow,
} from "@/lib/payment-requests-monitor";
import { getCurrentSessionUser } from "@/lib/session-profile";
import { DB_SYNC_READY_EVENT } from "@/lib/db/sync";
import { clampPage, PAGE_SIZE, paginateItems, totalPages } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import {
  Add,
  ArrowLeft2,
  ArrowRight2,
  Calendar,
  ChartSquare,
  CloseCircle,
  Danger,
  DocumentText,
  Edit2,
  ExportSquare,
  Folder2,
  HambergerMenu,
  Microphone2,
  MoneySend,
  SearchNormal1,
  Setting2,
  TickCircle,
} from "iconsax-react";
import type { Icon } from "iconsax-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";

function money(amount: number, currency = "UGX") {
  return formatMoney(amount, { currencyCode: currency });
}

function statusClass(status: string, overdue: boolean, highValue = false) {
  if (overdue) return "bg-rose-50 text-rose-700 ring-rose-200";
  if (highValue) return "bg-orange-50 text-orange-800 ring-orange-200";
  if (/paid|complete|settled/i.test(status)) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (/approved/i.test(status)) return "bg-sky-50 text-sky-700 ring-sky-200";
  if (/reject|void|cancel/i.test(status)) return "bg-slate-100 text-slate-600 ring-slate-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

function deskCanAdvance(row: PaymentRequestMonitorRow, role?: string) {
  const entity = row.entityKey || "payment-requests";
  if (entity === "payment-requests") return canAdvancePaymentRequest(row.status, role);
  if (entity === "oral-payment-requests") return canAdvanceOralPaymentRequest(row.status, role);
  if (entity === "payroll-runs") return canAdvancePayrollRun(row.status, role);
  return canAdvanceGenericRequisition(entity, row.status, role);
}

function deskCanReject(row: PaymentRequestMonitorRow, role?: string) {
  const entity = row.entityKey || "payment-requests";
  if (entity === "payment-requests") return canRejectPaymentRequest(row.status, role);
  if (entity === "oral-payment-requests") return canRejectOralPaymentRequest(row.status, role);
  if (entity === "payroll-runs") return canRejectPayrollRun(row.status, role);
  return canRejectGenericRequisition(entity, row.status, role);
}

/** Role-matched desk amend, or requestor/admin amend of an in-flight request. */
function deskCanAmend(row: PaymentRequestMonitorRow, role?: string) {
  const entity = row.entityKey || "payment-requests";
  const record = getApprovalDeskRecord(entity, row.id);
  if (entity === "payment-requests") return canAmendPaymentRequest(row.status, role, record);
  if (entity === "oral-payment-requests") {
    return canAmendOralPaymentRequest(row.status, role, record);
  }
  if (entity === "payroll-runs") {
    return canAmendPayrollRun(row.status, role, record);
  }
  return canAmendGenericRequisition(entity, row.status, role, record);
}

function deskMayActAmend(
  row: PaymentRequestMonitorRow,
  profile: ApprovalDeskProfile | null | undefined,
  role?: string,
) {
  if (!deskCanAmend(row, role)) return false;
  if (deskOwnsRow(row, profile)) return true;
  const entity = row.entityKey || "payment-requests";
  const record = getApprovalDeskRecord(entity, row.id);
  const user = getCurrentSessionUser();
  return isAdminRole(role || "") || isApprovalRequestOwner(record, user);
}

function deskAdvanceLabel(row: PaymentRequestMonitorRow) {
  const entity = row.entityKey || "payment-requests";
  if (entity === "payment-requests") return advanceActionLabel(row.status);
  if (entity === "oral-payment-requests") return oralAdvanceActionLabel(row.status);
  if (entity === "payroll-runs") return payrollRunAdvanceActionLabel(row.status);
  return requisitionAdvanceActionLabel(row.status, entity);
}

function deskChainProgress(entityKey: string | undefined, status: string) {
  const entity = entityKey || "payment-requests";
  if (entity === "leave-requests") return leaveChainProgress(status);
  if (entity === "oral-payment-requests") return oralChainProgress(status);
  if (entity === "payroll-runs") return payrollRunChainProgress(status);
  if (entity === "payment-requests") return paymentChainProgress(status);
  return requisitionChainProgress(status, entity);
}

const CHAIN_AUDIT_FIELDS = [
  { key: "requestedBy", label: "Requested by" },
  { key: "createdBy", label: "Created by" },
  { key: "approvedByPm", label: "Project Manager" },
  { key: "approvedByAccounts", label: "Accounts Assistant" },
  { key: "approvedByGm", label: "General Manager" },
  { key: "approvedByCeo", label: "CEO" },
  { key: "paidBy", label: "Paid by" },
  { key: "originalAmount", label: "Original amount" },
  { key: "amountRevisedBy", label: "Amount revised by" },
  { key: "amountRevisedAt", label: "Amount revised at" },
  { key: "amountRevisionNote", label: "Amount revision note" },
  { key: "approvalComment", label: "Approval comment" },
  { key: "amendmentReason", label: "Amendment comment" },
  { key: "rejectionReason", label: "Rejection reason" },
  { key: "notes", label: "Notes" },
] as const;

const CHAIN_AUDIT_FIELDS_NO_PM = CHAIN_AUDIT_FIELDS.filter(
  (field) => field.key !== "approvedByPm",
);

function deskDetailFields(
  row: PaymentRequestMonitorRow,
  record: ManagerRecord | null,
): { label: string; value: string; wide?: boolean }[] {
  const entity = row.entityKey || "payment-requests";
  const base: { label: string; value: string; wide?: boolean }[] = [
    { label: "Type", value: deskRequestTypeLabel(entity) },
    { label: "Payee", value: row.payee || "—" },
    { label: "Department", value: row.department || "—" },
    { label: "Waiting on", value: row.waitingOn },
    { label: "Date", value: row.date || "—" },
    { label: "Due / needed by", value: row.dueDate || "—" },
  ];

  if (entity === "oral-payment-requests") {
    return [
      ...base,
      ...fieldRows(record, [
        { key: "purpose", label: "Purpose / oral brief" },
        { key: "priority", label: "Priority" },
        { key: "bankAccount", label: "Pay from (bank / cash)" },
        ...CHAIN_AUDIT_FIELDS_NO_PM,
      ]).map((f) => ({
        ...f,
        wide:
          f.label === "Purpose / oral brief" ||
          f.label === "Notes" ||
          f.label === "Rejection reason" ||
          f.label === "Amendment comment" ||
          f.label === "Approval comment" ||
          f.label === "Amount revision note",
      })),
    ];
  }

  if (entity === "general-requests") {
    return [
      { label: "Type", value: deskRequestTypeLabel(entity) },
      { label: "Department", value: row.department || "—" },
      { label: "Waiting on", value: row.waitingOn },
      { label: "Date", value: row.date || "—" },
      { label: "Needed by", value: row.dueDate || "—" },
      ...fieldRows(record, [
        { key: "category", label: "Category" },
        { key: "subject", label: "Subject" },
        { key: "description", label: "What do you need?" },
        { key: "priority", label: "Priority" },
        ...CHAIN_AUDIT_FIELDS_NO_PM,
      ]).map((f) => ({
        ...f,
        wide:
          f.label === "What do you need?" ||
          f.label === "Notes" ||
          f.label === "Rejection reason" ||
          f.label === "Amendment comment" ||
          f.label === "Approval comment" ||
          f.label === "Amount revision note",
      })),
    ];
  }

  const auditFields = requisitionIncludesPm(entity)
    ? ([
        { key: "createdBy", label: "Requested by" },
        { key: "approvedByPm", label: "Project Manager" },
        { key: "approvedByAccounts", label: "Accounts Assistant" },
        { key: "approvedByGm", label: "General Manager" },
        { key: "approvedByCeo", label: "CEO" },
        { key: "paidBy", label: "Paid by" },
        { key: "originalAmount", label: "Original amount" },
        { key: "amountRevisedBy", label: "Amount revised by" },
        { key: "amountRevisedAt", label: "Amount revised at" },
        { key: "amountRevisionNote", label: "Amount revision note" },
        { key: "approvalComment", label: "Approval comment" },
        { key: "notes", label: "Notes" },
        { key: "bankAccount", label: "Bank account" },
        { key: "paymentMethod", label: "Payment method" },
        { key: "amendmentReason", label: "Amendment comment" },
        { key: "rejectionReason", label: "Rejection reason" },
      ] as const)
    : ([
        { key: "createdBy", label: "Requested by" },
        { key: "approvedByAccounts", label: "Accounts Assistant" },
        { key: "approvedByGm", label: "General Manager" },
        { key: "approvedByCeo", label: "CEO" },
        { key: "paidBy", label: "Paid by" },
        { key: "originalAmount", label: "Original amount" },
        { key: "amountRevisedBy", label: "Amount revised by" },
        { key: "amountRevisedAt", label: "Amount revised at" },
        { key: "amountRevisionNote", label: "Amount revision note" },
        { key: "approvalComment", label: "Approval comment" },
        { key: "notes", label: "Notes" },
        { key: "bankAccount", label: "Bank account" },
        { key: "paymentMethod", label: "Payment method" },
        { key: "amendmentReason", label: "Amendment comment" },
        { key: "rejectionReason", label: "Rejection reason" },
      ] as const);

  return [
    ...base,
    { label: "Project", value: row.project || "—" },
    { label: "Pay to", value: row.payTo || "—" },
    {
      label: "Source",
      value: row.sourceRef
        ? `${row.sourceLabel || "Document"} · ${row.sourceRef}`
        : "—",
    },
    { label: "Description", value: row.description || "—", wide: true },
    ...fieldRows(record, [...auditFields]).map((f) => ({
      ...f,
      wide:
        f.label === "Notes" ||
        f.label === "Rejection reason" ||
        f.label === "Approval comment" ||
        f.label === "Amount revision note",
    })),
  ];
}

const PAYMENT_BUCKETS: { id: PaymentRequestBucket; label: string }[] = [
  { id: "awaiting", label: "In approval" },
  { id: "overdue", label: "Overdue" },
  { id: "approved", label: "Ready to pay" },
  { id: "paid", label: "Paid" },
  { id: "all", label: "All" },
  { id: "rejected", label: "Rejected" },
];

type Selection =
  | { kind: "payment"; id: string }
  | { kind: "document"; module: string; entityKey: string; id: string }
  | { kind: "project"; id: string };

function docKey(row: PendingFinancialDoc) {
  return `${row.module}:${row.entityKey}:${row.id}`;
}

function fieldRows(record: ManagerRecord | null, keys: { key: string; label: string }[]) {
  if (!record) return [];
  return keys
    .map(({ key, label }) => {
      const raw = (record[key] || "").trim();
      return raw ? { label, value: raw } : null;
    })
    .filter(Boolean) as { label: string; value: string }[];
}

export default function ExecutiveApprovalsPage() {
  const { openSidebar } = useAppShell();
  const { feedback, close, showSuccess, showWarning, askConfirm } = useFeedbackModals();
  const hydrated = useMounted();
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState<DeskTab>("overview");
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<PaymentRequestBucket>("awaiting");
  const [department, setDepartment] = useState("all");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [widgetLayout, setWidgetLayout] = useState<CeoDeskWidgetLayout>(DEFAULT_CEO_DESK_WIDGETS);
  const [editingWidgets, setEditingWidgets] = useState(false);
  const [deskProfile, setDeskProfile] = useState<ApprovalDeskProfile | null>(null);
  /** Role-scoped queue from Go `/api/approvals/desk` (preferred over incomplete browser memory). */
  const [apiQueuePayments, setApiQueuePayments] = useState<PaymentRequestMonitorRow[] | null>(
    null,
  );
  /** Own rejected / amendment items (requestor attention), including roles with no desk. */
  const [apiAttentionPayments, setApiAttentionPayments] = useState<PaymentRequestMonitorRow[]>(
    [],
  );

  const refreshDeskFromApi = useCallback(async () => {
    const result = await fetchApprovalDesk();
    if (!result.ok) {
      setApiQueuePayments(null);
      setApiAttentionPayments([]);
      return;
    }
    setApiQueuePayments(monitorRowsFromDeskApiItems(result.items || []));
    setApiAttentionPayments(monitorRowsFromDeskApiItems(result.attention || []));
  }, []);

  useEffect(() => {
    setWidgetLayout(loadCeoDeskWidgets());
    const profile = approvalDeskForRole(getCurrentSessionUser()?.role || "");
    setDeskProfile(profile);
    if (!profile) {
      // Requestors / no-desk roles: land on rejected & amendment attention.
      setTab("mine");
      setBucket("all");
    } else if (!profile.showExecutiveTabs) {
      setTab("payments");
      if (profile.stage === "finance") setBucket("approved");
      else setBucket("awaiting");
    }
    const onChange = (event: Event) => {
      setTick((n) => n + 1);
      const detail = (event as CustomEvent | undefined)?.detail as
        | { module?: string; entity?: string }
        | undefined;
      if (
        !detail?.entity ||
        isApprovalDeskEntityEvent(detail.entity, detail.module)
      ) {
        void refreshDeskFromApi();
      }
    };
    const onSyncReady = () => {
      void refreshDeskFromApi();
    };
    void refreshDeskFromApi();
    window.addEventListener("financeiag-records-changed", onChange);
    window.addEventListener(DB_SYNC_READY_EVENT, onSyncReady);
    return () => {
      window.removeEventListener("financeiag-records-changed", onChange);
      window.removeEventListener(DB_SYNC_READY_EVENT, onSyncReady);
    };
  }, [refreshDeskFromApi]);

  function persistWidgets(next: CeoDeskWidgetLayout) {
    setWidgetLayout(next);
    saveCeoDeskWidgets(next);
  }

  function removeBusinessWidget(id: BusinessWidgetId) {
    persistWidgets({
      ...widgetLayout,
      business: widgetLayout.business.filter((item) => item !== id),
    });
  }

  function addBusinessWidget(id: BusinessWidgetId) {
    if (widgetLayout.business.includes(id)) return;
    persistWidgets({
      ...widgetLayout,
      business: [...widgetLayout.business, id],
    });
  }

  function removeActionWidget(id: ActionWidgetId) {
    persistWidgets({
      ...widgetLayout,
      action: widgetLayout.action.filter((item) => item !== id),
    });
  }

  function addActionWidget(id: ActionWidgetId) {
    if (widgetLayout.action.includes(id)) return;
    persistWidgets({
      ...widgetLayout,
      action: [...widgetLayout.action, id],
    });
  }

  function resetWidgets() {
    persistWidgets(DEFAULT_CEO_DESK_WIDGETS);
  }

  const desk = useMemo(() => {
    void tick;
    if (!hydrated) return null;
    return buildExecutiveDesk();
  }, [hydrated, tick]);

  const myQueuePayments = useMemo(() => {
    // Go desk API is already role-scoped (Accounts / GM / CEO / Finance / HR / material / admin).
    if (apiQueuePayments) return apiQueuePayments;
    if (!desk || !deskProfile) return [] as PaymentRequestMonitorRow[];
    return filterPaymentsForDesk(desk.payments, deskProfile);
  }, [apiQueuePayments, desk, deskProfile]);

  const attentionRows = apiAttentionPayments;

  const queueSource = useMemo(() => {
    // Prefer Go desk API for every role (including admin). Memory is fallback only.
    // Roles without a desk still see their own rejected / amendment attention list.
    if (!deskProfile) return apiAttentionPayments;
    if (apiQueuePayments) {
      const seen = new Set(apiQueuePayments.map((r) => `${r.entityKey}:${r.id}`));
      const extra = apiAttentionPayments.filter(
        (r) => !seen.has(`${r.entityKey}:${r.id}`),
      );
      return [...apiQueuePayments, ...extra];
    }
    if (!desk) return apiAttentionPayments;
    const base = deskProfile.kind === "admin" ? desk.payments : myQueuePayments;
    return base;
  }, [apiAttentionPayments, apiQueuePayments, desk, deskProfile, myQueuePayments]);

  const oralQueue = useMemo(
    () =>
      queueSource.filter(
        (row) => (row.entityKey || "payment-requests") === "oral-payment-requests",
      ),
    [queueSource],
  );

  const generalQueue = useMemo(
    () =>
      queueSource.filter(
        (row) => (row.entityKey || "") === "general-requests",
      ),
    [queueSource],
  );

  const leaveQueue = useMemo(
    () =>
      queueSource.filter((row) => (row.entityKey || "") === "leave-requests"),
    [queueSource],
  );

  const otherPaymentsQueue = useMemo(
    () =>
      queueSource.filter((row) => {
        const key = row.entityKey || "payment-requests";
        return (
          key !== "oral-payment-requests" &&
          key !== "general-requests" &&
          key !== "leave-requests"
        );
      }),
    [queueSource],
  );

  const paymentRows = useMemo(() => {
    if (!desk && !apiQueuePayments && apiAttentionPayments.length === 0) {
      return [] as PaymentRequestMonitorRow[];
    }
    const source =
      tab === "mine"
        ? apiAttentionPayments
        : tab === "oral"
          ? oralQueue
          : tab === "general"
            ? generalQueue
            : tab === "leave"
              ? leaveQueue
              : otherPaymentsQueue;
    return filterPaymentRequests(source, {
      bucket: deskProfile?.kind === "admin" ? bucket : "all",
      department: department === "all" ? "" : department,
      query,
    });
  }, [
    desk,
    apiQueuePayments,
    apiAttentionPayments,
    deskProfile,
    tab,
    oralQueue,
    generalQueue,
    leaveQueue,
    otherPaymentsQueue,
    bucket,
    department,
    query,
  ]);

  const departments = useMemo(
    () =>
      departmentsFromPaymentRequests(
        deskProfile?.kind === "admin" ? desk?.payments || [] : myQueuePayments,
      ),
    [desk, deskProfile, myQueuePayments],
  );

  const documentRows = useMemo(() => {
    if (!desk) return [] as PendingFinancialDoc[];
    const q = query.trim().toLowerCase();
    return desk.documents.filter((row) => {
      if (!q) return true;
      return [row.reference, row.label, row.party, row.status, row.module]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [desk, query]);

  const projectRows = useMemo(() => {
    if (!desk) return [] as StalledProjectRow[];
    const q = query.trim().toLowerCase();
    if (!q) return desk.stalledProjects;
    return desk.stalledProjects.filter((row) =>
      [row.name, row.code, row.status, row.manager, row.customer, row.reason]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [desk, query]);

  const redFiltered = useMemo(() => {
    if (!desk) return [] as ReturnType<typeof buildExecutiveDesk>["redItems"];
    const scoped = deskProfile?.stage
      ? desk.redItems.filter((item) => {
          if (item.kind === "payment") return deskOwnsRow(item.row, deskProfile);
          // Docs / stalled projects stay on executive desks only.
          return Boolean(deskProfile.showExecutiveTabs);
        })
      : desk.redItems;
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((item) => {
      if (item.kind === "payment") {
        const row = item.row;
        return [row.reference, row.payee, row.department, row.sourceRef, row.status]
          .join(" ")
          .toLowerCase()
          .includes(q);
      }
      if (item.kind === "project") {
        const row = item.row;
        return [row.name, row.code, row.status, row.manager, row.reason]
          .join(" ")
          .toLowerCase()
          .includes(q);
      }
      const row = item.row;
      return [row.reference, row.label, row.party, row.status]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [desk, deskProfile, query]);

  const selectedPayment = useMemo(() => {
    if (selection?.kind !== "payment") return null;
    const id = selection.id;
    return (
      queueSource.find((p) => p.id === id) ||
      apiAttentionPayments.find((p) => p.id === id) ||
      myQueuePayments.find((p) => p.id === id) ||
      desk?.payments.find((p) => p.id === id) ||
      null
    );
  }, [apiAttentionPayments, desk, myQueuePayments, queueSource, selection]);

  const selectedDocument = useMemo(() => {
    if (!desk || selection?.kind !== "document") return null;
    const fromQueue = desk.documents.find(
      (d) =>
        d.module === selection.module &&
        d.entityKey === selection.entityKey &&
        d.id === selection.id,
    );
    if (fromQueue) return fromQueue;
    const fromRed = desk.redItems.find(
      (item): item is { kind: "document"; row: PendingFinancialDoc } =>
        item.kind === "document" &&
        item.row.module === selection.module &&
        item.row.entityKey === selection.entityKey &&
        item.row.id === selection.id,
    );
    return fromRed?.row || null;
  }, [desk, selection]);

  const selectedPaymentRecord = useMemo(() => {
    void tick;
    if (!selectedPayment) return null;
    return getApprovalDeskRecord(selectedPayment.entityKey, selectedPayment.id);
  }, [selectedPayment, tick]);

  const selectedDocumentRecord = useMemo(() => {
    void tick;
    if (!selectedDocument) return null;
    return getFinancialDocument(selectedDocument);
  }, [selectedDocument, tick]);

  const selectedProject = useMemo(() => {
    if (!desk || selection?.kind !== "project") return null;
    return (
      desk.stalledProjects.find((p) => p.id === selection.id) ||
      desk.redItems.find(
        (item): item is { kind: "project"; row: StalledProjectRow } =>
          item.kind === "project" && item.row.id === selection.id,
      )?.row ||
      null
    );
  }, [desk, selection]);

  const selectedProjectSummary = useMemo(() => {
    void tick;
    if (selection?.kind !== "project") return null;
    return getProjectDeskSummary(selection.id);
  }, [selection, tick]);

  const canApprove = currentUserCan("approve");
  const sessionUser = getCurrentSessionUser();
  const sessionRole = sessionUser?.role || "";
  const sessionDisplayName = sessionUser?.name || sessionUser?.username || "";
  const sessionUserId = sessionUser?.id || "";
  const totals = desk?.totals;
  const business = desk?.business;
  const myQueueCount = myQueuePayments.length;
  const awaitingCount =
    deskProfile?.kind === "admin"
      ? (totals?.awaitingPayments ?? 0)
      : myQueueCount;
  const docsCount = totals?.pendingDocuments ?? 0;
  const stalledCount = totals?.stalledProjects ?? 0;
  const redCount =
    deskProfile?.kind === "admin" || !deskProfile?.stage
      ? (totals?.redCount ?? 0)
      : redFiltered.length;
  const allClear = Boolean(
    hydrated &&
      desk &&
      (deskProfile && !deskProfile.showExecutiveTabs
        ? myQueueCount === 0
        : awaitingCount + docsCount + stalledCount === 0 && redCount === 0),
  );
  const showingDetail = Boolean(
    selection && (selectedPayment || selectedDocument || selectedProject || selectedProjectSummary),
  );
  const showBusinessWidgets = Boolean(deskProfile?.showBusinessWidgets);
  const showExecutiveTabs = Boolean(deskProfile?.showExecutiveTabs);
  const showDocuments = Boolean(deskProfile?.showDocuments);
  const deskTitle = deskProfile?.title || (apiAttentionPayments.length ? "Your requests" : "Approval desk");
  const deskEyebrow = deskProfile?.eyebrow || (apiAttentionPayments.length ? "Attention" : "Approvals");
  const deskSubtitle =
    deskProfile?.subtitle ||
    (apiAttentionPayments.length
      ? "Rejected or returned requests that need you to amend and resubmit."
      : "Items waiting for your sign-off in the payment approval chain.");

  const oralAwaiting = deskProfile
    ? oralQueue.filter((r) => r.awaiting).length
    : oralQueue.length;
  const generalAwaiting = deskProfile
    ? generalQueue.filter((r) => r.awaiting).length
    : generalQueue.length;
  const leaveAwaiting = deskProfile
    ? leaveQueue.filter((r) => r.awaiting).length
    : leaveQueue.length;
  const otherAwaiting = deskProfile
    ? otherPaymentsQueue.filter((r) => r.awaiting).length
    : otherPaymentsQueue.length;

  const tabs: {
    id: DeskTab;
    label: string;
    count: number;
    urgent?: boolean;
    icon: Icon;
  }[] = (
    [
      { id: "overview" as const, label: "Overview", count: 0, icon: ChartSquare },
      {
        id: "mine" as const,
        label: "My requests",
        count: apiAttentionPayments.length,
        icon: DocumentText,
        urgent: apiAttentionPayments.length > 0,
      },
      {
        id: "oral" as const,
        label: "Oral requests",
        count: oralAwaiting,
        icon: Microphone2,
      },
      {
        id: "general" as const,
        label: "General requests",
        count: generalAwaiting,
        icon: DocumentText,
      },
      {
        id: "leave" as const,
        label: "Leave requests",
        count: leaveAwaiting,
        icon: Calendar,
      },
      {
        id: "payments" as const,
        label: "Project & other",
        count: otherAwaiting,
        icon: MoneySend,
      },
      { id: "documents" as const, label: "Documents", count: docsCount, icon: DocumentText },
      {
        id: "projects" as const,
        label: "Projects",
        count: stalledCount,
        urgent: stalledCount > 0,
        icon: Folder2,
      },
      { id: "red" as const, label: "Urgent", count: redCount, urgent: true, icon: Danger },
    ] as const
  ).filter((item) => {
    if (item.id === "mine") {
      return !deskProfile || apiAttentionPayments.length > 0;
    }
    if (
      item.id === "payments" ||
      item.id === "oral" ||
      item.id === "general" ||
      item.id === "leave"
    ) {
      return Boolean(deskProfile);
    }
    if (item.id === "documents") return showDocuments;
    if (item.id === "overview" || item.id === "projects" || item.id === "red") {
      return showExecutiveTabs;
    }
    return true;
  });

  const listCount =
    tab === "payments" ||
    tab === "mine" ||
    tab === "oral" ||
    tab === "general" ||
    tab === "leave"
      ? paymentRows.length
      : tab === "documents"
        ? documentRows.length
        : tab === "projects"
          ? projectRows.length
          : tab === "red"
            ? redFiltered.length
            : 0;

  const safePage = clampPage(page, listCount, pageSize);
  const pages = totalPages(listCount, pageSize);
  const pageFrom = listCount === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageTo = Math.min(safePage * pageSize, listCount);

  const pagedPaymentRows = useMemo(
    () => paginateItems(paymentRows, safePage, pageSize),
    [paymentRows, safePage, pageSize],
  );
  const pagedDocumentRows = useMemo(
    () => paginateItems(documentRows, safePage, pageSize),
    [documentRows, safePage, pageSize],
  );
  const pagedProjectRows = useMemo(
    () => paginateItems(projectRows, safePage, pageSize),
    [projectRows, safePage, pageSize],
  );
  const pagedRedItems = useMemo(
    () => paginateItems(redFiltered, safePage, pageSize),
    [redFiltered, safePage, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [tab, bucket, department, query, pageSize]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  function switchTab(next: DeskTab) {
    setTab(next);
    setSelection(null);
    setPage(1);
  }

  async function applyPaymentAdvance(
    row: PaymentRequestMonitorRow,
    options?: {
      comment?: string;
      amount?: string;
      paymentMethod?: string;
      bankAccount?: string;
      forwardTo?: "ceo" | "finance";
    },
  ) {
    if (!deskOwnsRow(row, deskProfile)) {
      showWarning(
        "Not on your desk",
        "Only the role waiting on this step can approve it from their desk.",
      );
      return;
    }
    const entity = row.entityKey || "payment-requests";
    const opts = {
      comment: options?.comment,
      amount: options?.amount,
      paymentMethod: options?.paymentMethod,
      bankAccount: options?.bankAccount,
      forwardTo: options?.forwardTo,
    };
    let result: {
      ok: boolean;
      error?: string;
      nextStatus?: string;
      paymentId?: string;
      amended?: boolean;
    };
    if (entity === "payment-requests") {
      result = await advancePaymentRequest(row.id, opts);
    } else if (entity === "oral-payment-requests") {
      result = await advanceOralPaymentRequest(row.id, opts);
    } else if (entity === "payroll-runs") {
      result = await advancePayrollRun(row.id, {
        comment: opts.comment,
        amount: opts.amount,
        forwardTo: opts.forwardTo,
      });
    } else {
      result = await advanceGenericRequisition(entity, row.id, opts);
    }
    if (!result.ok) {
      showWarning("Cannot advance", result.error || "Try again.");
      return;
    }
    // Refresh queue + leave detail so status / waiting-on reflect the new stage.
    await refreshDeskFromApi();
    setSelection(null);
    if (result.amended) {
      const returnedTo =
        getApprovalDeskRecord(entity, row.id)?.amendedReturnTo ||
        result.nextStatus ||
        "previous user";
      showSuccess(
        "Returned for amendment",
        `${row.reference} sent back to ${returnedTo} with the revised amount.`,
      );
      return;
    }
    if (/^paid$/i.test(result.nextStatus || "")) {
      setBucket("paid");
      showSuccess(
        entity === "payroll-runs" ? "Payroll released" : "Marked paid",
        entity === "payroll-runs"
          ? `${row.reference} released — payslips created and posted to the ledger.`
          : `${row.reference} marked paid${
              result.paymentId
                ? " — banking payment created. Showing Paid list (also under Receipts & Payments → Payments)."
                : "."
            }`,
      );
      return;
    }
    showSuccess(
      "Updated",
      `${row.reference} → ${result.nextStatus || "next stage"}.`,
    );
  }

  async function applyPaymentReject(
    row: PaymentRequestMonitorRow,
    options?: { comment?: string; amount?: string },
  ) {
    if (!deskOwnsRow(row, deskProfile)) {
      showWarning(
        "Not on your desk",
        "Only the role waiting on this step can reject it from their desk.",
      );
      return;
    }
    const entity = row.entityKey || "payment-requests";
    const opts = {
      comment: options?.comment,
      amount: options?.amount,
    };
    let result: { ok: boolean; error?: string };
    if (entity === "payment-requests") {
      result = await rejectPaymentRequest(row.id, opts);
    } else if (entity === "oral-payment-requests") {
      result = await rejectOralPaymentRequest(row.id, opts);
    } else if (entity === "payroll-runs") {
      result = await rejectPayrollRun(row.id, opts);
    } else {
      result = await rejectGenericRequisition(entity, row.id, opts);
    }
    if (!result.ok) {
      showWarning("Cannot reject", result.error || "Try again.");
      return;
    }
    await refreshDeskFromApi();
    setSelection(null);
    showSuccess("Rejected", `${row.reference} rejected.`);
  }

  function confirmPaymentAdvance(
    row: PaymentRequestMonitorRow,
    forwardTo?: "ceo" | "finance",
  ) {
    const gate = deskCanAdvance(row);
    const label = deskAdvanceLabel(row);
    const isPay = gate.stage === "finance";
    const isGm = gate.stage === "gm";
    const entity = row.entityKey || "payment-requests";
    const isPayrollRelease = entity === "payroll-runs" && isPay;
    const postsLedger =
      entity === "payment-requests" || entity === "oral-payment-requests";
    const record = getApprovalDeskRecord(entity, row.id);
    const showAmount = !isPay && entitySupportsApprovalAmount(entity);
    const amountSeed =
      record?.amount ||
      record?.estimatedCost ||
      record?.total ||
      (row.amount > 0 ? String(row.amount) : "");
    const gmToFinance = isGm && forwardTo === "finance";
    const gmToCeo = isGm && (forwardTo === "ceo" || !forwardTo);
    askConfirm({
      title: isPayrollRelease
        ? "Release payroll?"
        : isPay
          ? "Make payment?"
          : gmToFinance
            ? "Forward to Finance?"
            : gmToCeo && isGm
              ? "Forward to CEO?"
              : "Approve request?",
      message: isPayrollRelease
        ? `Release payroll ${row.reference}${
            row.amount > 0 ? ` (net ${money(row.amount, row.currency)})` : ""
          }? CEO has approved — this creates Unpaid payslips and posts wage accrual to the ledger.`
        : isPay
          ? `Make payment for ${row.reference}${
              row.amount > 0 ? ` (${money(row.amount, row.currency)})` : ""
            }${row.payee ? ` · ${row.payee}` : ""}. Choose how you are paying and which bank / cash account to use. CEO has already approved — this cannot be edited or amended.${
              postsLedger
                ? " This creates a banking payment and posts it to the ledger."
                : ""
            }`
          : gmToFinance
            ? `Skip CEO and send ${row.reference} straight to Finance for payment${
                row.amount > 0 ? ` (${money(row.amount, row.currency)})` : ""
              }${row.payee ? ` · ${row.payee}` : ""}.`
            : gmToCeo && isGm
              ? `Forward ${row.reference} to the CEO for approval${
                  row.amount > 0 ? ` (${money(row.amount, row.currency)})` : ""
                }${row.payee ? ` · ${row.payee}` : ""}.`
              : `Approve ${row.reference} as ${row.waitingOn}${
                  row.amount > 0 ? ` for ${money(row.amount, row.currency)}` : ""
                }${
                  row.payee ? ` · ${row.payee}` : ""
                }. Next step follows the chain: ${requisitionChainLabel(row.entityKey)}. Changing the amount (with a comment) sends it back to the previous user.`,
      confirmLabel: isPayrollRelease
        ? "Release payroll"
        : isPay
          ? "Make payment"
          : gmToFinance
            ? "Forward to Finance"
            : gmToCeo && isGm
              ? "Forward to CEO"
              : label,
      danger: false,
      commentLabel: isPay
        ? isPayrollRelease
          ? "Release note (optional)"
          : "Payment note (optional)"
        : "Comment",
      commentPlaceholder: isPay
        ? isPayrollRelease
          ? "Optional note for the payroll release…"
          : "Optional note for the payment record…"
        : "Optional approval note — required if you change the amount (sent back to previous user)…",
      amountLabel: showAmount ? "Amount" : undefined,
      amountValue: showAmount ? amountSeed : undefined,
      amountCurrency: showAmount ? row.currency || "UGX" : undefined,
      paymentMethodLabel: isPay && !isPayrollRelease ? "Payment method" : undefined,
      paymentMethodOptions: isPay && !isPayrollRelease ? REQUEST_PAYMENT_METHODS : undefined,
      paymentMethodValue:
        isPay && !isPayrollRelease ? record?.paymentMethod || "" : undefined,
      paymentMethodRequired: isPay && !isPayrollRelease,
      bankAccountLabel:
        isPay && !isPayrollRelease ? "Paid from (bank / cash)" : undefined,
      bankAccountValue:
        isPay && !isPayrollRelease
          ? record?.bankAccount || record?.paidFrom || ""
          : undefined,
      bankAccountRequired: isPay && !isPayrollRelease,
      onConfirm: (comment, extras) => {
        void applyPaymentAdvance(row, {
          comment,
          amount: isPay ? undefined : extras?.amount,
          paymentMethod: isPay && !isPayrollRelease ? extras?.paymentMethod : undefined,
          bankAccount: isPay && !isPayrollRelease ? extras?.bankAccount : undefined,
          forwardTo: isGm ? forwardTo || "ceo" : undefined,
        });
      },
    });
  }

  function confirmPaymentReject(row: PaymentRequestMonitorRow) {
    const entity = row.entityKey || "payment-requests";
    const record = getApprovalDeskRecord(entity, row.id);
    const showAmount = entitySupportsApprovalAmount(entity);
    const amountSeed =
      record?.amount ||
      record?.estimatedCost ||
      record?.total ||
      (row.amount > 0 ? String(row.amount) : "");
    askConfirm({
      title: "Reject request?",
      message: `Reject ${row.reference}? This stops the approval chain and emails the parties involved. Add a reason and adjust the amount if figures were revised before rejection.`,
      confirmLabel: "Reject",
      danger: true,
      commentLabel: "Reason",
      commentPlaceholder: "Reason for rejection (sent to requestor and executives)…",
      commentRequired: true,
      amountLabel: showAmount ? "Amount" : undefined,
      amountValue: showAmount ? amountSeed : undefined,
      amountCurrency: row.currency || "UGX",
      onConfirm: (comment, extras) => {
        void applyPaymentReject(row, {
          comment,
          amount: extras?.amount,
        });
      },
    });
  }

  async function applyPaymentAmend(
    row: PaymentRequestMonitorRow,
    options?: {
      comment?: string;
      amount?: string;
      returnMode?: "previous" | "draft";
    },
  ) {
    if (!deskMayActAmend(row, deskProfile, sessionRole)) {
      showWarning(
        "Cannot amend",
        "Only the desk role waiting on this step, an administrator, or the requestor can amend it.",
      );
      return;
    }
    const isRedo = /^(rejected|declined)$/i.test(row.status || "");
    const note =
      (options?.comment || "").trim() ||
      (isRedo ? "Reopening rejected request to correct and resubmit." : "");
    if (!note) {
      showWarning(
        "Comment required",
        "Add a comment so the requestor knows what to change.",
      );
      return;
    }
    const entity = row.entityKey || "payment-requests";
    const amount = (options?.amount || "").trim();
    const returnMode = "previous" as const;
    let result: { ok: boolean; error?: string; record?: ManagerRecord };
    if (entity === "payment-requests") {
      result = await amendPaymentRequest(row.id, {
        comment: note,
        amount: amount || undefined,
        returnMode,
      });
    } else if (entity === "oral-payment-requests") {
      result = await amendOralPaymentRequest(row.id, {
        comment: note,
        amount: amount || undefined,
        returnMode,
      });
    } else if (entity === "payroll-runs") {
      result = await amendPayrollRun(row.id, {
        comment: note,
        amount: amount || undefined,
        returnMode,
      });
    } else {
      result = await amendGenericRequisition(entity, row.id, {
        comment: note,
        amount: amount || undefined,
        returnMode,
      });
    }
    if (!result.ok) {
      showWarning(isRedo ? "Cannot redo" : "Cannot amend", result.error || "Try again.");
      return;
    }
    await refreshDeskFromApi();
    setSelection(null);
    const next = result.record?.status
      ? ` → ${result.record.status}`
      : "";
    showSuccess(
      isRedo ? "Returned for amendment" : "Returned for amendment",
      isRedo
        ? `${row.reference} returned for amendment. Edit it, then resubmit.${
            (result.record?.rejectionReason || "").trim()
              ? " The rejection reason stays on the record."
              : ""
          }`
        : `${row.reference} sent back for amendment${next}.`,
    );
  }

  function confirmPaymentRedo(row: PaymentRequestMonitorRow) {
    const entity = row.entityKey || "payment-requests";
    const record = getApprovalDeskRecord(entity, row.id);
    if (!canRedoRejectedRequest(row.status, sessionRole, record, getCurrentSessionUser())) {
      showWarning("Cannot amend", "Only the requestor or an administrator can reopen a rejected request.");
      return;
    }
    const reason = (record?.rejectionReason || "").trim();
    askConfirm({
      title: "Return rejected request for amendment?",
      message: `Send ${row.reference} back to you as Returned for Amendment so you can correct it and resubmit.${
        reason ? ` Rejection reason: “${reason}”.` : ""
      } The reason stays visible while you edit.`,
      confirmLabel: "Return for amendment",
      danger: false,
      commentLabel: "Note (optional)",
      commentPlaceholder: "What you are fixing before resubmitting…",
      onConfirm: (comment) => {
        void applyPaymentAmend(row, {
          comment:
            (comment || "").trim() ||
            "Reopening rejected request to correct and resubmit.",
          returnMode: "previous",
        });
      },
    });
  }

  function confirmPaymentAmend(row: PaymentRequestMonitorRow) {
    if (/^(rejected|declined)$/i.test(row.status || "")) {
      confirmPaymentRedo(row);
      return;
    }
    const entity = row.entityKey || "payment-requests";
    const record = getApprovalDeskRecord(entity, row.id);
    const showAmount = entitySupportsApprovalAmount(entity);
    const amountSeed =
      record?.amount ||
      record?.estimatedCost ||
      record?.total ||
      (row.amount > 0 ? String(row.amount) : "");
    const original = (record?.originalAmount || "").trim() || amountSeed;
    askConfirm({
      title: "Return for amendment?",
      message: `Send ${row.reference} one step back for amendment. Add a comment${
        showAmount
          ? ` and adjust the figure against the original (${row.currency || "UGX"} ${original || "—"}) if needed`
          : ""
      }.`,
      confirmLabel: "Return for amendment",
      danger: false,
      commentLabel: "What should change",
      commentPlaceholder: "Tell them what to change…",
      commentRequired: true,
      amountLabel: showAmount ? "Amended amount" : undefined,
      amountValue: showAmount ? amountSeed : undefined,
      amountCurrency: row.currency || "UGX",
      onConfirm: (comment, extras) => {
        void applyPaymentAmend(row, {
          comment,
          amount: extras?.amount,
          returnMode: "previous",
        });
      },
    });
  }

  function handleApproveDocument(row: PendingFinancialDoc) {
    const block = assertPermission("approve");
    if (block) {
      showWarning("Permission denied", block);
      return;
    }
    askConfirm({
      title: "Approve document?",
      message: `Set “${row.reference}” (${row.label}) to Approved so it posts to the ledger and appears on reports${
        row.amount > 0 ? ` · ${money(row.amount, row.currency)}` : ""
      }.`,
      confirmLabel: "Approve",
      danger: false,
      onConfirm: async () => {
        const existing = getFinancialDocument(row);
        if (!existing) {
          showWarning("Not found", "That document is no longer available.");
          return;
        }
        const maker = assertMakerChecker(existing.createdBy || existing.user);
        if (maker) {
          showWarning("Approval blocked", maker);
          return;
        }
        const result = await approveFinancialDocument(row);
        if (!result.ok) {
          showWarning("Could not approve", result.error || "Try tracing the document instead.");
          return;
        }
        showSuccess("Approved", `${row.reference} is approved and posted.`);
        setSelection(null);
      },
    });
  }

  const businessWidgetCatalog: Record<
    BusinessWidgetId,
    {
      label: string;
      value: string;
      hint: string;
      tone: string;
      icon: Icon;
      onClick?: () => void;
    }
  > = {
    "cash-bank": {
      label: "Cash & bank",
      value: business?.formatted.cashAndBank ?? "—",
      hint: "Liquidity",
      tone: "text-slate-900",
      icon: MoneySend,
    },
    "net-profit": {
      label: "Net profit YTD",
      value: business?.formatted.netProfit ?? "—",
      hint: business ? `Income ${business.formatted.income}` : "P&L",
      tone: (business?.netProfit ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700",
      icon: ChartSquare,
    },
    receivable: {
      label: "Receivable",
      value: business?.formatted.ar ?? "—",
      hint: business ? `${business.overdueCount} overdue docs` : "AR",
      tone: "text-slate-800",
      icon: DocumentText,
    },
    payable: {
      label: "Payable",
      value: business?.formatted.ap ?? "—",
      hint: business ? `${business.pendingCount} open docs` : "AP",
      tone: "text-slate-800",
      icon: DocumentText,
    },
    assets: {
      label: "Assets",
      value: business?.formatted.assets ?? "—",
      hint: "Balance sheet",
      tone: "text-slate-800",
      icon: ChartSquare,
    },
    liabilities: {
      label: "Liabilities",
      value: business?.formatted.liabilities ?? "—",
      hint: `Equity ${business?.formatted.equity ?? "—"}`,
      tone: "text-slate-800",
      icon: ChartSquare,
    },
    "working-capital": {
      label: "Working capital",
      value: business?.formatted.workingCapital ?? "—",
      hint: "Assets − liabilities",
      tone: "text-slate-800",
      icon: MoneySend,
    },
    "stalled-projects": {
      label: "Stalled projects",
      value: String(stalledCount),
      hint: stalledCount ? "Past end / blocked" : "On track",
      tone: stalledCount > 0 ? "text-rose-700" : "text-emerald-700",
      icon: Folder2,
      onClick: () => switchTab("projects"),
    },
  };

  const actionWidgetCatalog: Record<
    ActionWidgetId,
    {
      label: string;
      value: string;
      hint: string;
      tone: string;
      accent: string;
      icon: Icon;
      active: boolean;
      onClick: () => void;
    }
  > = {
    "in-approval": {
      label: "In approval",
      value: String(totals?.awaitingPayments ?? 0),
      hint: money(totals?.awaitingPaymentAmount ?? 0, desk?.currency),
      tone: "text-amber-700",
      accent: "bg-amber-50 text-amber-700",
      icon: MoneySend,
      active: (tab === "payments" || tab === "mine" || tab === "oral" || tab === "general" || tab === "leave") && bucket === "awaiting",
      onClick: () => {
        switchTab("payments");
        setBucket("awaiting");
      },
    },
    "overdue-urgent": {
      label: "Overdue / urgent",
      value: String(redCount),
      hint: money(totals?.redAmount ?? 0, desk?.currency),
      tone: "text-rose-700",
      accent: "bg-rose-50 text-rose-700",
      icon: Danger,
      active: tab === "red",
      onClick: () => switchTab("red"),
    },
    documents: {
      label: "Documents",
      value: String(totals?.pendingDocuments ?? 0),
      hint: money(totals?.pendingDocumentAmount ?? 0, desk?.currency),
      tone: "text-slate-800",
      accent: "bg-slate-100 text-slate-600",
      icon: DocumentText,
      active: tab === "documents",
      onClick: () => switchTab("documents"),
    },
    "ready-finance": {
      label: "Ready for Finance",
      value: String(totals?.approvedReadyToPay ?? 0),
      hint: money(totals?.approvedReadyAmount ?? 0, desk?.currency),
      tone: "text-emerald-700",
      accent: "bg-emerald-50 text-emerald-700",
      icon: TickCircle,
      active: (tab === "payments" || tab === "mine" || tab === "oral" || tab === "general" || tab === "leave") && bucket === "approved",
      onClick: () => {
        switchTab("payments");
        setBucket("approved");
      },
    },
  };

  const hiddenBusinessWidgets = BUSINESS_WIDGET_IDS.filter(
    (id) => !widgetLayout.business.includes(id),
  );
  const hiddenActionWidgets = ACTION_WIDGET_IDS.filter(
    (id) => !widgetLayout.action.includes(id),
  );

  return (
    <div className="min-h-dvh bg-[#f6f7f9]">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/90 backdrop-blur-md">
        <div className="flex h-14 w-full items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"
            onClick={openSidebar}
            aria-label="Open menu"
          >
            <HambergerMenu size={18} color="currentColor" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium tracking-[0.08em] text-slate-400 uppercase">
              {deskEyebrow}
            </p>
            <h1 className="truncate text-[15px] font-semibold text-slate-900">{deskTitle}</h1>
          </div>
          {hydrated && (awaitingCount > 0 || redCount > 0 || stalledCount > 0) ? (
            <span
              className={cn(
                "hidden rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset sm:inline-flex",
                redCount > 0 || stalledCount > 0
                  ? "bg-rose-50 text-rose-700 ring-rose-200"
                  : "bg-amber-50 text-amber-800 ring-amber-200",
              )}
            >
              {redCount > 0
                ? `${redCount} urgent`
                : stalledCount > 0
                  ? `${stalledCount} stalled`
                  : `${awaitingCount} awaiting`}
            </span>
          ) : hydrated && allClear ? (
            <span className="hidden rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 ring-inset sm:inline-flex">
              All clear
            </span>
          ) : null}
          <div className="flex items-center gap-1">
            <NotificationsMenu />
          <ThemeToggle />
            <PageMoreMenu />
          </div>
        </div>
      </header>

      <main className="w-full space-y-5 px-4 py-5 sm:px-6 sm:py-7">
        {!showingDetail ? (
          <div className="space-y-4">
            <section className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:p-6">
              <div className="min-w-0 space-y-1.5">
                <h2 className="text-[20px] font-semibold tracking-tight text-slate-900">
                  {showBusinessWidgets
                    ? business?.businessName || "Business summary"
                    : deskTitle}
                </h2>
                <p className="max-w-2xl text-[13px] leading-relaxed text-slate-500">
                  {hydrated
                    ? showBusinessWidgets && desk
                      ? desk.healthLine
                      : deskSubtitle
                    : deskSubtitle}
                </p>
                {showBusinessWidgets && business ? (
                  <p className="text-[12px] text-slate-400">
                    As of {business.asOf} · FY {business.year}
                    {business.balanced ? " · Books balanced" : " · Trial balance needs attention"}
                  </p>
                ) : hydrated && deskProfile ? (
                  <p className="text-[12px] text-slate-400">
                    Signed in as {sessionDisplayName || "—"}
                    {sessionUserId ? ` · ID ${sessionUserId}` : ""}
                    {sessionRole ? ` · ${sessionRole}` : ""}
                    {" · "}
                    {myQueueCount} waiting on you
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {showBusinessWidgets ? (
                  <Link href="/reports">
                    <Button size="sm" variant="outline" className="h-9 rounded-lg">
                      Full reports
                    </Button>
                  </Link>
                ) : null}
                <Link href="/projects">
                  <Button size="sm" variant="outline" className="h-9 rounded-lg">
                    Projects
                  </Button>
                </Link>
                <Link href="/projects?view=payment-requests">
                  <Button size="sm" className="h-9 rounded-lg bg-slate-900 hover:bg-slate-800">
                    <Add size={14} color="currentColor" className="mr-1.5" />
                    New request
                  </Button>
                </Link>
              </div>
            </section>

            {showBusinessWidgets ? (
              <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold tracking-[0.1em] text-slate-400 uppercase">
                Dashboard widgets
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {editingWidgets ? (
                  <button
                    type="button"
                    onClick={resetWidgets}
                    className="text-[12px] font-medium text-slate-500 hover:text-slate-800"
                  >
                    Reset defaults
                  </button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg px-2.5 text-[12px]"
                  onClick={() => setEditingWidgets((v) => !v)}
                >
                  <Setting2 size={13} color="currentColor" className="mr-1.5" />
                  {editingWidgets ? "Done" : "Edit widgets"}
                </Button>
              </div>
            </div>

            <div>
              <p className="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-slate-400 uppercase">
                Business widgets
              </p>
              {widgetLayout.business.length === 0 && !editingWidgets ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-[13px] text-slate-500">
                  No business widgets showing.{" "}
                  <button
                    type="button"
                    className="font-medium text-slate-800 underline-offset-2 hover:underline"
                    onClick={() => setEditingWidgets(true)}
                  >
                    Add some
                  </button>
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {widgetLayout.business.map((id) => {
                    const card = businessWidgetCatalog[id];
                    if (!card) return null;
                    const Icon = card.icon;
                    const clickable = Boolean(card.onClick) && !editingWidgets;
                    const Comp = clickable ? "button" : "div";
                    return (
                      <Comp
                        key={id}
                        type={clickable ? "button" : undefined}
                        onClick={clickable ? card.onClick : undefined}
                        className={cn(
                          "relative min-w-0 rounded-xl border border-slate-200/90 bg-white px-3.5 py-3.5 text-left shadow-sm sm:px-4",
                          clickable && "transition hover:border-slate-300 hover:bg-slate-50/80",
                          editingWidgets && "ring-1 ring-slate-200",
                        )}
                      >
                        {editingWidgets ? (
                          <button
                            type="button"
                            aria-label={`Remove ${card.label}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeBusinessWidget(id);
                            }}
                            className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-rose-50 hover:text-rose-700"
                          >
                            <CloseCircle size={14} color="currentColor" variant="Bold" />
                          </button>
                        ) : null}
                        <div className="flex items-start justify-between gap-2 pr-6">
                          <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                            {card.label}
                          </p>
                          {!editingWidgets ? (
                            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
                              <Icon size={14} color="currentColor" variant="Linear" />
                            </span>
                          ) : null}
                        </div>
                        <p
                          className={cn(
                            "mt-2 text-[20px] font-semibold tabular-nums tracking-tight",
                            card.tone,
                          )}
                        >
                          {hydrated ? card.value : "—"}
                        </p>
                        <p className="mt-1 truncate text-[11px] text-slate-500">{card.hint}</p>
                      </Comp>
                    );
                  })}
                </div>
              )}
              {editingWidgets && hiddenBusinessWidgets.length > 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3">
                  <p className="mb-2 text-[11px] font-medium text-slate-500">Add business widget</p>
                  <div className="flex flex-wrap gap-2">
                    {hiddenBusinessWidgets.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => addBusinessWidget(id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        <Add size={12} color="currentColor" />
                        {businessWidgetCatalog[id].label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <p className="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-slate-400 uppercase">
                Action widgets
              </p>
              {widgetLayout.action.length === 0 && !editingWidgets ? (
                <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-[13px] text-slate-500">
                  No action widgets showing.{" "}
                  <button
                    type="button"
                    className="font-medium text-slate-800 underline-offset-2 hover:underline"
                    onClick={() => setEditingWidgets(true)}
                  >
                    Add some
                  </button>
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {widgetLayout.action.map((id) => {
                    const card = actionWidgetCatalog[id];
                    if (!card) return null;
                    const Icon = card.icon;
                    const Comp = editingWidgets ? "div" : "button";
                    return (
                      <Comp
                        key={id}
                        type={editingWidgets ? undefined : "button"}
                        onClick={editingWidgets ? undefined : card.onClick}
                        className={cn(
                          "relative min-w-0 rounded-xl border bg-white px-3.5 py-3.5 text-left shadow-sm transition sm:px-4",
                          !editingWidgets && card.active
                            ? "border-slate-900 ring-1 ring-slate-900/10"
                            : "border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/80",
                          editingWidgets && "ring-1 ring-slate-200",
                        )}
                      >
                        {editingWidgets ? (
                          <button
                            type="button"
                            aria-label={`Remove ${card.label}`}
                            onClick={() => removeActionWidget(id)}
                            className="absolute top-2 right-2 inline-flex size-6 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-rose-50 hover:text-rose-700"
                          >
                            <CloseCircle size={14} color="currentColor" variant="Bold" />
                          </button>
                        ) : null}
                        <div className="flex items-start justify-between gap-2 pr-6">
                          <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                            {card.label}
                          </p>
                          {!editingWidgets ? (
                            <span
                              className={cn(
                                "inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
                                card.accent,
                              )}
                            >
                              <Icon size={14} color="currentColor" variant="Bold" />
                            </span>
                          ) : null}
                        </div>
                        <p
                          className={cn(
                            "mt-2 text-[22px] font-semibold tabular-nums tracking-tight",
                            card.tone,
                          )}
                        >
                          {hydrated ? card.value : "—"}
                        </p>
                        <p className="mt-1 truncate text-[11px] text-slate-500">{card.hint}</p>
                      </Comp>
                    );
                  })}
                </div>
              )}
              {editingWidgets && hiddenActionWidgets.length > 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3">
                  <p className="mb-2 text-[11px] font-medium text-slate-500">Add action widget</p>
                  <div className="flex flex-wrap gap-2">
                    {hiddenActionWidgets.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => addActionWidget(id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        <Add size={12} color="currentColor" />
                        {actionWidgetCatalog[id].label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
                <button
                  type="button"
                  onClick={() => switchTab("oral")}
                  className={cn(
                    "min-w-0 rounded-xl border bg-white px-3.5 py-3.5 text-left shadow-sm transition sm:px-4",
                    tab === "oral"
                      ? "border-slate-900 ring-1 ring-slate-900/10"
                      : "border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/80",
                  )}
                >
                  <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                    Oral queue
                  </p>
                  <p className="mt-2 text-[22px] font-semibold tabular-nums tracking-tight text-amber-700">
                    {hydrated ? oralQueue.length : "—"}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-slate-500">
                    Oral payment requests
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => switchTab("general")}
                  className={cn(
                    "min-w-0 rounded-xl border bg-white px-3.5 py-3.5 text-left shadow-sm transition sm:px-4",
                    tab === "general"
                      ? "border-slate-900 ring-1 ring-slate-900/10"
                      : "border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/80",
                  )}
                >
                  <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                    General queue
                  </p>
                  <p className="mt-2 text-[22px] font-semibold tabular-nums tracking-tight text-violet-700">
                    {hydrated ? generalQueue.length : "—"}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-slate-500">
                    General requests
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => switchTab("leave")}
                  className={cn(
                    "min-w-0 rounded-xl border bg-white px-3.5 py-3.5 text-left shadow-sm transition sm:px-4",
                    tab === "leave"
                      ? "border-slate-900 ring-1 ring-slate-900/10"
                      : "border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/80",
                  )}
                >
                  <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                    Leave queue
                  </p>
                  <p className="mt-2 text-[22px] font-semibold tabular-nums tracking-tight text-sky-700">
                    {hydrated ? leaveQueue.length : "—"}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-slate-500">
                    Leave requests
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => switchTab("payments")}
                  className={cn(
                    "min-w-0 rounded-xl border bg-white px-3.5 py-3.5 text-left shadow-sm transition sm:px-4",
                    tab === "payments"
                      ? "border-slate-900 ring-1 ring-slate-900/10"
                      : "border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/80",
                  )}
                >
                  <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                    Project & other
                  </p>
                  <p className="mt-2 text-[22px] font-semibold tabular-nums tracking-tight text-slate-800">
                    {hydrated ? otherPaymentsQueue.length : "—"}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-slate-500">
                    {money(
                      otherPaymentsQueue.reduce((s, r) => s + r.amount, 0),
                      desk?.currency,
                    )}
                  </p>
                </button>
                <div className="min-w-0 rounded-xl border border-slate-200/90 bg-white px-3.5 py-3.5 shadow-sm sm:px-4">
                  <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                    Signed in
                  </p>
                  <p className="mt-2 truncate text-[18px] font-semibold tracking-tight text-slate-900">
                    {sessionDisplayName || "—"}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-slate-500">
                    {sessionUserId ? `ID ${sessionUserId}` : "Your user id"}
                  </p>
                </div>
                <div className="col-span-2 min-w-0 rounded-xl border border-slate-200/90 bg-white px-3.5 py-3.5 shadow-sm sm:col-span-1 sm:px-4">
                  <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                    Role
                  </p>
                  <p className="mt-2 text-[18px] font-semibold tracking-tight text-slate-900">
                    {sessionRole || "—"}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-slate-500">
                    Desk:{" "}
                    {deskProfile?.stage === "hr"
                      ? "HR"
                      : deskProfile?.stage === "pm"
                        ? "Project Manager"
                        : deskProfile?.stage === "accounts"
                          ? "Accounts"
                          : deskProfile?.stage === "gm"
                            ? "General Manager"
                            : deskProfile?.stage === "finance"
                              ? "Finance (pay)"
                              : deskProfile?.stage === "ceo"
                                ? "CEO"
                                : deskProfile?.stage === "qs"
                                  ? "Quantity Surveyor"
                                  : deskProfile?.stage === "stores"
                                    ? "Stores"
                                    : deskProfile?.stage === "procurement"
                                      ? "Procurement"
                                      : "—"}
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {!canApprove && hydrated && !showingDetail ? (
          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-[13px] text-amber-900">
            You can review this queue. Approvals follow the request type chain (project payments include PM; oral and general go Requestor → Accounts Assistant → GM → CEO → Finance → Paid).
            Sign in with the role that matches the current step.
          </div>
        ) : null}

        {showExecutiveTabs && redCount > 0 && !showingDetail ? (
          <button
            type="button"
            onClick={() => switchTab("red")}
            className="flex w-full items-center gap-3 rounded-2xl border border-rose-200/80 bg-gradient-to-r from-rose-50 to-white px-4 py-3.5 text-left shadow-sm transition hover:border-rose-300 hover:from-rose-50 hover:to-rose-50/40"
          >
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
              <Danger size={18} color="currentColor" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-rose-900">
                {redCount} item{redCount === 1 ? "" : "s"} need attention
              </p>
              <p className="mt-0.5 text-[12px] text-rose-800/75">
                Overdue, high-value, or stalled projects ·{" "}
                {money(totals?.redAmount ?? 0, desk?.currency)}
              </p>
            </div>
            <span className="hidden items-center gap-1 text-[12px] font-medium text-rose-700 sm:inline-flex">
              Review now
              <ArrowRight2 size={14} color="currentColor" />
            </span>
          </button>
        ) : null}

        {showingDetail && selectedPayment ? (
          <ApprovalDetail
            kind="payment"
            title={selectedPayment.reference}
            status={
              selectedPaymentRecord?.status || selectedPayment.status
            }
            overdue={selectedPayment.overdue}
            amount={(() => {
              const revised = formatRevisedAmountLabel(
                selectedPaymentRecord,
                selectedPayment.currency,
              );
              if (revised?.revised && revised.original) {
                return `${revised.current} (was ${revised.original})`;
              }
              return money(selectedPayment.amount, selectedPayment.currency);
            })()}
            subtitle={`${deskRequestTypeLabel(selectedPayment.entityKey)} · waiting on ${
              selectedPaymentRecord
                ? deskChainProgress(
                    selectedPayment.entityKey,
                    selectedPaymentRecord.status || selectedPayment.status,
                  ).waitingOn
                : selectedPayment.waitingOn
            }`}
            onBack={() => setSelection(null)}
            backLabel={`Back to ${deskTitle}`}
            depthHref={selectedPayment.href}
            depthLabel="Open full detail"
            chain={deskChainProgress(
              selectedPayment.entityKey,
              selectedPaymentRecord?.status || selectedPayment.status,
            )}
            chainRecord={selectedPaymentRecord}
            traceHref={
              selectedPayment.sourceHref &&
              selectedPayment.sourceHref !== selectedPayment.href
                ? selectedPayment.sourceHref
                : undefined
            }
            traceLabel={
              selectedPayment.sourceRef
                ? `Source · ${selectedPayment.sourceRef}`
                : "Source document"
            }
            fields={deskDetailFields(selectedPayment, selectedPaymentRecord)}
            actions={
              <>
                {selectedPaymentRecord &&
                canRedoRejectedRequest(
                  selectedPayment.status,
                  sessionRole,
                  selectedPaymentRecord,
                  sessionUser,
                ) ? (
                  <Button
                    type="button"
                    className="h-9 rounded-lg bg-rose-700 text-white hover:bg-rose-800"
                    onClick={() => confirmPaymentRedo(selectedPayment)}
                  >
                    <Edit2 size={14} color="currentColor" />
                    Redo request
                  </Button>
                ) : null}
                {deskOwnsRow(selectedPayment, deskProfile) &&
                deskCanReject(selectedPayment, sessionRole) ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg text-rose-700 hover:bg-rose-50"
                    onClick={() => confirmPaymentReject(selectedPayment)}
                  >
                    <CloseCircle size={14} color="currentColor" />
                    Reject
                  </Button>
                ) : null}
                {deskMayActAmend(selectedPayment, deskProfile, sessionRole) &&
                !/^(rejected|declined)$/i.test(selectedPayment.status || "") ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-lg text-amber-800 hover:bg-amber-50"
                    onClick={() => confirmPaymentAmend(selectedPayment)}
                  >
                    <Edit2 size={14} color="currentColor" />
                    Return for amendment
                  </Button>
                ) : null}
                {deskOwnsRow(selectedPayment, deskProfile) &&
                deskCanAdvance(selectedPayment, sessionRole).ok ? (
                  deskCanAdvance(selectedPayment, sessionRole).stage === "gm" ? (
                    <>
                      <Button
                        type="button"
                        className="h-9 rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                        onClick={() => confirmPaymentAdvance(selectedPayment, "ceo")}
                      >
                        <TickCircle size={14} color="currentColor" />
                        Forward to CEO
                      </Button>
                      <Button
                        type="button"
                        className="h-9 rounded-lg bg-slate-800 text-white hover:bg-slate-700"
                        onClick={() => confirmPaymentAdvance(selectedPayment, "finance")}
                      >
                        <TickCircle size={14} color="currentColor" />
                        Forward to Finance
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      className={cn(
                        "h-9 rounded-lg text-white",
                        deskChainProgress(selectedPayment.entityKey, selectedPayment.status).stage ===
                        "finance"
                          ? "bg-slate-900 hover:bg-slate-800"
                          : "bg-emerald-600 hover:bg-emerald-700",
                      )}
                      onClick={() => confirmPaymentAdvance(selectedPayment)}
                    >
                      <TickCircle size={14} color="currentColor" />
                      {deskAdvanceLabel(selectedPayment)}
                    </Button>
                  )
                ) : null}
              </>
            }
          />
        ) : showingDetail && selectedDocument ? (
          <ApprovalDetail
            kind="document"
            title={selectedDocument.reference}
            status={selectedDocument.status}
            overdue={selectedDocument.overdue}
            highValue={selectedDocument.highValue}
            amount={money(selectedDocument.amount, selectedDocument.currency)}
            subtitle={`${selectedDocument.label} · summary on this desk`}
            onBack={() => setSelection(null)}
            backLabel={`Back to ${deskTitle}`}
            depthHref={selectedDocument.href}
            depthLabel="Open full detail"
            fields={[
              { label: "Type", value: selectedDocument.label },
              { label: "Party", value: selectedDocument.party || "—" },
              { label: "Module", value: selectedDocument.module },
              { label: "Date", value: selectedDocument.date || "—" },
              { label: "Due date", value: selectedDocument.dueDate || "—" },
              {
                label: "Days open",
                value: selectedDocument.daysOpen > 0 ? `${selectedDocument.daysOpen}d` : "—",
              },
              ...fieldRows(selectedDocumentRecord, [
                { key: "description", label: "Description" },
                { key: "notes", label: "Notes" },
                { key: "project", label: "Project" },
                { key: "department", label: "Department" },
                { key: "createdBy", label: "Created by" },
                { key: "account", label: "Account" },
              ]).map((f) => ({
                ...f,
                wide: f.label === "Description" || f.label === "Notes",
              })),
            ]}
            actions={
              canApprove ? (
                <Button
                  type="button"
                  className="h-9 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => handleApproveDocument(selectedDocument)}
                >
                  <TickCircle size={14} color="currentColor" />
                  Approve
                </Button>
              ) : null
            }
          />
        ) : showingDetail && (selectedProjectSummary || selectedProject) ? (
          <ProjectDetail
            summary={
              selectedProjectSummary ||
              ({
                ...(selectedProject as StalledProjectRow),
                startDate: "",
                description: "",
                department: "",
                location: "",
                currency: desk?.currency || "UGX",
                remaining:
                  (selectedProject?.budget || 0) - (selectedProject?.spent || 0),
                record: null,
                milestones: [],
                tasks: [],
                phases: [],
                paymentRequests: [],
              } satisfies ProjectDeskSummary)
            }
            onBack={() => setSelection(null)}
            backLabel={`Back to ${deskTitle}`}
            onSelectPayment={(row) => setSelection({ kind: "payment", id: row.id })}
          />
        ) : (
          <>
            <SegmentTabList>
              {tabs.map((item) => {
                const isActive = tab === item.id;
                const TabIcon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => switchTab(item.id)}
                    className={segmentTabClass(isActive, {
                      stretch: false,
                      urgent: Boolean(item.urgent && item.count > 0),
                    })}
                  >
                    <TabIcon
                      size={14}
                      variant={isActive ? "Bold" : "Linear"}
                      color="currentColor"
                    />
                    {item.label}
                    {item.count > 0 ? (
                      <span className={segmentTabBadgeClass(isActive, item.urgent)}>
                        {item.count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </SegmentTabList>

            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <div className="space-y-3 border-b border-slate-100 p-4 sm:p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {tab === "payments" || tab === "mine" || tab === "oral" || tab === "general" || tab === "leave" ? (
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                      {attentionRows.length > 0 ? (
                        <div className="mb-1 w-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
                          <span className="font-semibold">
                            {attentionRows.length} of your request
                            {attentionRows.length === 1 ? "" : "s"} need
                            {attentionRows.length === 1 ? "s" : ""} attention
                          </span>
                          <span className="text-rose-800/80">
                            {" "}
                            (rejected or returned for amendment). Open a row to read the
                            reason.
                          </span>
                        </div>
                      ) : null}
                      {deskProfile?.kind === "admin" ? (
                        <>
                          {PAYMENT_BUCKETS.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setBucket(item.id)}
                              className={cn(
                                "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                                bucket === item.id
                                  ? "bg-slate-900 text-white"
                                  : "bg-slate-50 text-slate-600 hover:bg-slate-100",
                              )}
                            >
                              {item.label}
                            </button>
                          ))}
                          <select
                            className="ml-0 h-8 rounded-lg border border-slate-200 bg-white px-2 text-[12px] text-slate-700 sm:ml-1"
                            value={department}
                            onChange={(e) => setDepartment(e.target.value)}
                            aria-label="Filter by department"
                          >
                            <option value="all">All departments</option>
                            {departments.map((dept) => (
                              <option key={dept} value={dept}>
                                {dept}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <p className="min-w-0 flex-1 text-[12px] text-slate-500">
                          {tab === "mine"
                            ? "Your rejected or returned requests — open a row to redo"
                            : tab === "oral"
                              ? "Oral payment requests waiting on your step"
                              : tab === "general"
                                ? "General requests waiting on your step"
                                : tab === "leave"
                                  ? "Leave requests waiting on your step"
                                  : "Project and other requests waiting on your step"}
                          {deskProfile?.stage === "finance"
                            ? " (ready to pay)"
                            : ""}
                          .
                        </p>
                      )}
                    </div>
                  ) : tab === "overview" ? (
                    <p className="min-w-0 flex-1 text-[12px] text-slate-500">
                      General report of the business — jump into payments, documents, or stalled
                      projects below.
                    </p>
                  ) : tab === "projects" ? (
                    <p className="min-w-0 flex-1 text-[12px] text-slate-500">
                      Projects past end date, on hold, or blocked by overdue milestones and tasks.
                    </p>
                  ) : (
                    <p className="min-w-0 flex-1 text-[12px] text-slate-500">
                      Tap a row to review on this page. Trace only if you need the source.
                    </p>
                  )}
                  {tab !== "overview" ? (
                    <div className="relative w-full sm:w-56">
                      <SearchNormal1
                        size={14}
                        color="#94a3b8"
                        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
                      />
                      <Input
                        className="h-9 rounded-lg border-slate-200 bg-slate-50/50 pl-8 text-[13px]"
                        placeholder="Search reference, party…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              {!hydrated || !desk ? (
                <div className="space-y-3 p-4 sm:p-5">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-[88px] animate-pulse rounded-xl bg-slate-100/80" />
                  ))}
                </div>
              ) : tab === "overview" ? (
                <OverviewPanel
                  desk={desk}
                  onOpenPayments={() => {
                    switchTab("payments");
                    setBucket("awaiting");
                  }}
                  onOpenDocuments={() => switchTab("documents")}
                  onOpenProjects={() => switchTab("projects")}
                  onOpenRed={() => switchTab("red")}
                  onSelectProject={(row) => setSelection({ kind: "project", id: row.id })}
                />
              ) : tab === "payments" || tab === "mine" || tab === "oral" || tab === "general" || tab === "leave" ? (
                <PaymentsList
                  rows={pagedPaymentRows}
                  sessionRole={sessionRole}
                  deskProfile={deskProfile}
                  onSelect={(row) => setSelection({ kind: "payment", id: row.id })}
                  onAdvance={confirmPaymentAdvance}
                  onReject={confirmPaymentReject}
                  onAmend={confirmPaymentAmend}
                  onRedo={confirmPaymentRedo}
                  emptyAll={
                    tab === "mine"
                      ? apiAttentionPayments.length === 0
                      : tab === "oral"
                        ? oralQueue.length === 0
                        : tab === "general"
                          ? generalQueue.length === 0
                          : tab === "leave"
                            ? leaveQueue.length === 0
                            : otherPaymentsQueue.length === 0
                  }
                />
              ) : tab === "documents" ? (
                <DocumentsList
                  rows={pagedDocumentRows}
                  canApprove={canApprove}
                  onSelect={(row) =>
                    setSelection({
                      kind: "document",
                      module: row.module,
                      entityKey: row.entityKey,
                      id: row.id,
                    })
                  }
                  onApprove={handleApproveDocument}
                  emptyAll={desk.documents.length === 0}
                />
              ) : tab === "projects" ? (
                <ProjectsList
                  rows={pagedProjectRows}
                  emptyAll={desk.stalledProjects.length === 0}
                  onSelect={(row) => setSelection({ kind: "project", id: row.id })}
                />
              ) : (
                <RedList
                  items={pagedRedItems}
                  canApprove={canApprove}
                  sessionRole={sessionRole}
                  onSelectPayment={(row) => setSelection({ kind: "payment", id: row.id })}
                  onSelectDocument={(row) =>
                    setSelection({
                      kind: "document",
                      module: row.module,
                      entityKey: row.entityKey,
                      id: row.id,
                    })
                  }
                  onSelectProject={(row) => setSelection({ kind: "project", id: row.id })}
                  onAdvancePayment={confirmPaymentAdvance}
                  onApproveDocument={handleApproveDocument}
                />
              )}

              {hydrated && desk && listCount > 0 && tab !== "overview" ? (
                <PaginationBar
                  page={safePage}
                  pages={pages}
                  total={listCount}
                  from={pageFrom}
                  to={pageTo}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-500 sm:px-5"
                />
              ) : null}
            </section>
          </>
        )}
      </main>

      <FeedbackModals feedback={feedback} onClose={close} />
    </div>
  );
}

function StatusPill({
  status,
  overdue,
  highValue,
}: {
  status: string;
  overdue?: boolean;
  highValue?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        statusClass(status, Boolean(overdue), highValue),
      )}
    >
      {overdue ? "Overdue · " : highValue ? "High value · " : ""}
      {status}
    </span>
  );
}

function ApprovalDetail({
  title,
  status,
  overdue,
  highValue,
  amount,
  subtitle,
  fields,
  actions,
  onBack,
  backLabel = "Back to desk",
  traceHref,
  traceLabel,
  depthHref,
  depthLabel,
  chain,
  chainRecord,
}: {
  kind: "payment" | "document";
  title: string;
  status: string;
  overdue?: boolean;
  highValue?: boolean;
  amount: string;
  subtitle: string;
  fields: { label: string; value: string; wide?: boolean }[];
  actions?: React.ReactNode;
  onBack: () => void;
  backLabel?: string;
  traceHref?: string;
  traceLabel?: string;
  depthHref?: string;
  depthLabel?: string;
  chain?: {
    stage: string;
    waitingOn: string;
    chainLabel?: string;
    steps: { id: string; label: string; done: boolean; current: boolean }[];
  };
  chainRecord?: Record<string, string | undefined | null> | null;
}) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-[13px] font-medium text-white shadow-sm transition hover:bg-slate-800"
      >
        <ArrowLeft2 size={16} color="currentColor" />
        {backLabel}
      </button>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">{title}</h2>
              <StatusPill status={status} overdue={overdue} highValue={highValue} />
            </div>
            <p className="text-[13px] text-slate-500">{subtitle}</p>
            <p className="text-[20px] font-semibold tabular-nums tracking-tight text-slate-900">
              {amount}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {depthHref ? (
              <Link href={depthHref}>
                <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5 rounded-lg">
                  <ExportSquare size={14} color="currentColor" />
                  {depthLabel || "Open full detail"}
                </Button>
              </Link>
            ) : null}
            {traceHref ? (
              <Link href={traceHref}>
                <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5 rounded-lg">
                  <ExportSquare size={14} color="currentColor" />
                  {traceLabel || "Source"}
                </Button>
              </Link>
            ) : null}
            {actions}
          </div>
        </div>

        {chain ? (
          <div className="border-b border-slate-100 px-5 py-4">
            <RequestChainTracker
              status={status}
              record={chainRecord}
              chainLabel={chain.chainLabel}
              steps={chain.steps}
              className="border-0 shadow-none p-0"
            />
          </div>
        ) : null}

        <div className="border-b border-slate-100 px-5 py-3">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
            Summary
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 px-5 py-5 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((field) => (
            <div
              key={`${field.label}-${field.value}`}
              className={field.wide ? "sm:col-span-2 lg:col-span-3" : undefined}
            >
              <dt className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                {field.label}
              </dt>
              <dd className="mt-1.5 text-[14px] font-medium break-words text-slate-800">
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function ProjectDetail({
  summary,
  onBack,
  backLabel = "Back to desk",
  onSelectPayment,
}: {
  summary: ProjectDeskSummary;
  onBack: () => void;
  backLabel?: string;
  onSelectPayment: (row: PaymentRequestMonitorRow) => void;
}) {
  const overdueMilestones = summary.milestones.filter((m) => m.overdue);
  const problemTasks = summary.tasks.filter(
    (t) => t.overdue || /^blocked$/i.test(t.status),
  );
  const openPayments = summary.paymentRequests.filter(
    (p) => p.awaiting || /^approved$/i.test(p.status),
  );

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-[13px] font-medium text-white shadow-sm transition hover:bg-slate-800"
      >
        <ArrowLeft2 size={16} color="currentColor" />
        {backLabel}
      </button>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
                {summary.name}
              </h2>
              <StatusPill status={summary.status} overdue={summary.daysOverdue > 0} />
            </div>
            <p className="text-[13px] text-slate-500">
              Project summary on this desk
              {summary.code ? ` · ${summary.code}` : ""}
            </p>
            <p className="text-[14px] font-medium text-rose-700">{summary.reason}</p>
          </div>
          <Link href={summary.href}>
            <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5 rounded-lg">
              <ExportSquare size={14} color="currentColor" />
              Open full detail
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-2 border-b border-slate-100 lg:grid-cols-4">
          {[
            { label: "Budget", value: money(summary.budget, summary.currency) },
            { label: "Spent", value: money(summary.spent, summary.currency) },
            { label: "Remaining", value: money(summary.remaining, summary.currency) },
            {
              label: "Schedule",
              value:
                summary.daysOverdue > 0
                  ? `${summary.daysOverdue}d past end`
                  : summary.endDate || "—",
            },
          ].map((card, i) => (
            <div
              key={card.label}
              className={cn("px-4 py-4 sm:px-5", i > 0 && "border-l border-slate-100")}
            >
              <p className="text-[11px] font-medium text-slate-400">{card.label}</p>
              <p className="mt-1 text-[16px] font-semibold tabular-nums text-slate-900">
                {card.value}
              </p>
            </div>
          ))}
        </div>

        <div className="border-b border-slate-100 px-5 py-3">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
            Project facts
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 px-5 py-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { label: "Manager", value: summary.manager || "—" },
            { label: "Customer", value: summary.customer || "—" },
            { label: "Department", value: summary.department || "—" },
            { label: "Location", value: summary.location || "—" },
            { label: "Start", value: summary.startDate || "—" },
            { label: "End", value: summary.endDate || "—" },
            { label: "Description", value: summary.description || "—", wide: true },
          ].map((field) => (
            <div
              key={field.label}
              className={field.wide ? "sm:col-span-2 lg:col-span-3" : undefined}
            >
              <dt className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                {field.label}
              </dt>
              <dd className="mt-1.5 text-[14px] font-medium break-words text-slate-800">
                {field.value}
              </dd>
            </div>
          ))}
        </dl>

        <ProjectLinesSection
          title={`Milestones (${summary.milestones.length})`}
          empty="No milestones linked to this project."
          lines={overdueMilestones.length ? overdueMilestones : summary.milestones.slice(0, 8)}
          hint={
            overdueMilestones.length
              ? "Showing overdue milestones first"
              : summary.milestones.length > 8
                ? "Showing first 8 — open full detail for all"
                : undefined
          }
        />
        <ProjectLinesSection
          title={`Tasks (${summary.tasks.length})`}
          empty="No tasks linked to this project."
          lines={problemTasks.length ? problemTasks : summary.tasks.slice(0, 8)}
          hint={
            problemTasks.length
              ? "Showing blocked / overdue tasks first"
              : summary.tasks.length > 8
                ? "Showing first 8 — open full detail for all"
                : undefined
          }
        />
        {summary.phases.length ? (
          <ProjectLinesSection
            title={`Phases (${summary.phases.length})`}
            empty=""
            lines={summary.phases}
          />
        ) : null}

        <div className="border-t border-slate-100 px-5 py-3">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
            Payment requests ({summary.paymentRequests.length})
          </p>
        </div>
        {summary.paymentRequests.length === 0 ? (
          <p className="px-5 py-4 text-[13px] text-slate-500">No payment requests on this project.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(openPayments.length ? openPayments : summary.paymentRequests.slice(0, 6)).map(
              (row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <button
                    type="button"
                    onClick={() => onSelectPayment(row)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-[13px] font-semibold text-slate-900 hover:underline">
                      {row.reference}
                    </p>
                    <p className="truncate text-[12px] text-slate-500">
                      {row.payee || "—"} · {row.status}
                    </p>
                  </button>
                  <p className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-900">
                    {money(row.amount, row.currency)}
                  </p>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function ProjectLinesSection({
  title,
  empty,
  lines,
  hint,
}: {
  title: string;
  empty: string;
  lines: {
    id: string;
    title: string;
    status: string;
    dueDate: string;
    overdue: boolean;
    href: string;
  }[];
  hint?: string;
}) {
  return (
    <>
      <div className="border-t border-slate-100 px-5 py-3">
        <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
          {title}
        </p>
        {hint ? <p className="mt-1 text-[12px] text-slate-400">{hint}</p> : null}
      </div>
      {lines.length === 0 ? (
        empty ? (
          <p className="px-5 py-4 text-[13px] text-slate-500">{empty}</p>
        ) : null
      ) : (
        <ul className="divide-y divide-slate-100">
          {lines.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-slate-900">{line.title}</p>
                <p className="text-[12px] text-slate-500">
                  {line.status}
                  {line.dueDate ? ` · Due ${line.dueDate}` : ""}
                </p>
              </div>
              {line.overdue ? (
                <span className="shrink-0 text-[11px] font-semibold text-rose-700">Overdue</span>
              ) : (
                <Link
                  href={line.href}
                  className="shrink-0 text-[12px] font-medium text-slate-500 hover:text-slate-800"
                >
                  Full
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function OverviewPanel({
  desk,
  onOpenPayments,
  onOpenDocuments,
  onOpenProjects,
  onOpenRed,
  onSelectProject,
}: {
  desk: NonNullable<ReturnType<typeof buildExecutiveDesk>>;
  onOpenPayments: () => void;
  onOpenDocuments: () => void;
  onOpenProjects: () => void;
  onOpenRed: () => void;
  onSelectProject: (row: StalledProjectRow) => void;
}) {
  const b = desk.business;
  const topStalled = desk.stalledProjects.slice(0, 5);
  return (
    <div className="space-y-5 p-4 sm:p-5">
      <div>
        <p className="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-slate-400 uppercase">
          Snapshot widgets
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Income YTD",
              value: b.formatted.income,
              hint: `Expenses ${b.formatted.expenses}`,
            },
            {
              label: "Documents on file",
              value: String(b.documentCount),
              hint: `${b.paidCount} paid · ${b.pendingCount} open`,
            },
            {
              label: "Books",
              value: b.balanced ? "Balanced" : "Review needed",
              hint: `Equity ${b.formatted.equity}`,
            },
            {
              label: "Action queue",
              value: String(
                desk.totals.awaitingPayments +
                  desk.totals.pendingDocuments +
                  desk.totals.stalledProjects,
              ),
              hint: "Payments + docs + stalled",
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-slate-200/90 bg-white px-3.5 py-3.5 shadow-sm sm:px-4"
            >
              <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                {card.label}
              </p>
              <p className="mt-2 text-[18px] font-semibold tabular-nums tracking-tight text-slate-900">
                {card.value}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{card.hint}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2.5 text-[11px] font-semibold tracking-[0.1em] text-slate-400 uppercase">
          Queue widgets
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Payment approvals",
              count: desk.totals.awaitingPayments,
              amount: money(desk.totals.awaitingPaymentAmount, desk.currency),
              onClick: onOpenPayments,
            },
            {
              label: "Documents to approve",
              count: desk.totals.pendingDocuments,
              amount: money(desk.totals.pendingDocumentAmount, desk.currency),
              onClick: onOpenDocuments,
            },
            {
              label: "Stalled / delayed projects",
              count: desk.totals.stalledProjects,
              amount: desk.totals.stalledProjects
                ? "Past end date or blocked"
                : "None flagged",
              onClick: onOpenProjects,
            },
            {
              label: "In the red",
              count: desk.totals.redCount,
              amount: money(desk.totals.redAmount, desk.currency),
              onClick: onOpenRed,
            },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className="rounded-xl border border-slate-200/90 bg-white px-3.5 py-3.5 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50/80 sm:px-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                  {item.label}
                </p>
                <ArrowRight2 size={14} color="#94a3b8" />
              </div>
              <p className="mt-2 text-[22px] font-semibold tabular-nums text-slate-900">
                {item.count}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{item.amount}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-slate-900">Stalling & delayed projects</h3>
          <button
            type="button"
            onClick={onOpenProjects}
            className="text-[12px] font-medium text-slate-500 hover:text-slate-800"
          >
            View all
          </button>
        </div>
        {topStalled.length === 0 ? (
          <p className="rounded-xl bg-emerald-50/80 px-4 py-3 text-[13px] text-emerald-800">
            No stalled or delayed projects right now.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
            {topStalled.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onSelectProject(row)}
                  className="flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-slate-50/80 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-slate-900">{row.name}</p>
                    <p className="truncate text-[12px] text-slate-500">{row.reason}</p>
                  </div>
                  <span className="shrink-0 text-[12px] font-medium text-rose-700">
                    {row.daysOverdue > 0 ? `${row.daysOverdue}d late` : row.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PaymentsList({
  rows,
  sessionRole,
  deskProfile,
  onSelect,
  onAdvance,
  onReject,
  onAmend,
  onRedo,
  emptyAll,
}: {
  rows: PaymentRequestMonitorRow[];
  sessionRole: string;
  deskProfile: ApprovalDeskProfile | null | undefined;
  onSelect: (row: PaymentRequestMonitorRow) => void;
  onAdvance: (row: PaymentRequestMonitorRow, forwardTo?: "ceo" | "finance") => void;
  onReject: (row: PaymentRequestMonitorRow) => void;
  onAmend: (row: PaymentRequestMonitorRow) => void;
  onRedo?: (row: PaymentRequestMonitorRow) => void;
  emptyAll: boolean;
}) {
  if (!rows.length) {
    return (
      <EmptyState
        icon={<MoneySend size={28} color="#94a3b8" />}
        title={emptyAll ? "No payment requests yet" : "Nothing in this filter"}
        body={
          emptyAll
            ? "Raise requests from purchase invoices, bills, or project documents with Request payment (Finance)."
            : "Try another filter or clear the search."
        }
        href="/projects?view=payment-requests"
        linkLabel="Open Projects list"
      />
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((row) => {
        const record = getApprovalDeskRecord(row.entityKey, row.id);
        const owns = deskOwnsRow(row, deskProfile);
        const canAdvance = owns && deskCanAdvance(row, sessionRole).ok;
        const canReject = owns && deskCanReject(row, sessionRole);
        const rejected = /^(rejected|declined)$/i.test(row.status || "");
        const canRedo =
          Boolean(onRedo) &&
          canRedoRejectedRequest(row.status, sessionRole, record, getCurrentSessionUser());
        const canAmend =
          !rejected && deskMayActAmend(row, deskProfile, sessionRole);
        const advanceLabel = deskAdvanceLabel(row);
        const isPay = deskChainProgress(row.entityKey, row.status).stage === "finance";
        const typeLabel = deskRequestTypeLabel(row.entityKey);
        const rejectionReason = (record?.rejectionReason || "").trim();
        const amendmentReason = (record?.amendmentReason || "").trim();
        return (
          <li
            key={`${row.entityKey || "payment-requests"}:${row.id}`}
            className={cn(
              "flex flex-col gap-3 px-4 py-4 transition hover:bg-slate-50/70 sm:flex-row sm:items-center sm:px-5",
              row.overdue && "bg-rose-50/30",
              rejected && "bg-rose-50/50",
              !rejected && amendmentReason && "bg-amber-50/40",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(row)}
              className="min-w-0 flex-1 space-y-1.5 text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-slate-900 hover:underline">
                  {row.reference}
                </span>
                <StatusPill status={row.status} overdue={row.overdue} />
              </div>
              <p className="truncate text-[13px] text-slate-700">
                {row.payee || row.description || typeLabel}
                {row.department ? (
                  <span className="text-slate-400"> · {row.department}</span>
                ) : null}
              </p>
              {rejectionReason ? (
                <p className="line-clamp-2 text-[12px] text-rose-800">
                  <span className="font-medium">Rejected: </span>
                  {rejectionReason}
                </p>
              ) : null}
              {!rejectionReason && amendmentReason ? (
                <p className="line-clamp-2 text-[12px] text-amber-900">
                  <span className="font-medium">Amend: </span>
                  {amendmentReason}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-slate-400">
                <span>{typeLabel}</span>
                <span>Waiting on {row.waitingOn}</span>
                {row.date ? <span>{row.date}</span> : null}
                {row.dueDate ? (
                  <span className={row.overdue ? "font-medium text-rose-600" : undefined}>
                    Due {row.dueDate}
                  </span>
                ) : null}
                {row.sourceRef &&
                row.sourceHref &&
                row.sourceHref !== row.href ? (
                  <span>From {row.sourceRef}</span>
                ) : null}
                {row.project ? <span>{row.project}</span> : null}
              </div>
            </button>

            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
              <p className="text-right text-[16px] font-semibold tabular-nums tracking-tight text-slate-900">
                {money(row.amount, row.currency)}
              </p>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {canRedo ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-lg bg-rose-700 px-2.5 text-white hover:bg-rose-800"
                    onClick={() => onRedo?.(row)}
                  >
                    Redo
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg px-2.5"
                  onClick={() => onSelect(row)}
                >
                  Review
                </Button>
                {canReject ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-lg px-2 text-rose-600 hover:bg-rose-50"
                    title="Reject"
                    onClick={() => onReject(row)}
                  >
                    <CloseCircle size={15} color="currentColor" />
                  </Button>
                ) : null}
                {canAmend ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-lg px-2 text-amber-700 hover:bg-amber-50"
                    title="Amend"
                    onClick={() => onAmend(row)}
                  >
                    <Edit2 size={15} color="currentColor" />
                  </Button>
                ) : null}
                {canAdvance ? (
                  deskCanAdvance(row, sessionRole).stage === "gm" ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1 rounded-lg bg-amber-600 px-2 text-white hover:bg-amber-700"
                        onClick={() => onAdvance(row, "ceo")}
                      >
                        → CEO
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1 rounded-lg bg-slate-800 px-2 text-white hover:bg-slate-700"
                        onClick={() => onAdvance(row, "finance")}
                      >
                        → Finance
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      className={cn(
                        "h-8 gap-1 rounded-lg px-3 text-white",
                        isPay
                          ? "bg-slate-900 hover:bg-slate-800"
                          : "bg-emerald-600 hover:bg-emerald-700",
                      )}
                      onClick={() => onAdvance(row)}
                    >
                      <TickCircle size={14} color="currentColor" />
                      {advanceLabel}
                    </Button>
                  )
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ProjectsList({
  rows,
  emptyAll,
  onSelect,
}: {
  rows: StalledProjectRow[];
  emptyAll: boolean;
  onSelect: (row: StalledProjectRow) => void;
}) {
  if (!rows.length) {
    return (
      <EmptyState
        icon={<Folder2 size={28} color="#94a3b8" />}
        title={emptyAll ? "No stalled projects" : "No matches"}
        body={
          emptyAll
            ? "Projects past their end date, on hold, or blocked by overdue milestones will show here."
            : "Try another search."
        }
        href="/projects"
        linkLabel="Open Projects"
      />
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((row) => (
        <li
          key={row.id}
          className={cn(
            "flex flex-col gap-3 px-4 py-4 transition hover:bg-slate-50/70 sm:flex-row sm:items-center sm:px-5",
            row.daysOverdue > 0 && "bg-rose-50/30",
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(row)}
            className="min-w-0 flex-1 space-y-1.5 text-left"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-slate-900 hover:underline">
                {row.name}
              </span>
              <StatusPill status={row.status} overdue={row.daysOverdue > 0} />
            </div>
            <p className="text-[13px] text-slate-700">{row.reason}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-slate-400">
              {row.code ? <span>{row.code}</span> : null}
              {row.manager ? <span>PM {row.manager}</span> : null}
              {row.customer ? <span>{row.customer}</span> : null}
              {row.endDate ? (
                <span className={row.daysOverdue > 0 ? "font-medium text-rose-600" : undefined}>
                  End {row.endDate}
                </span>
              ) : null}
              {row.openPaymentRequests > 0 ? (
                <span>{row.openPaymentRequests} open payment req.</span>
              ) : null}
            </div>
          </button>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            <p className="text-right text-[13px] tabular-nums text-slate-600">
              Budget {money(row.budget)}
              {row.spent > 0 ? ` · Spent ${money(row.spent)}` : ""}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-lg"
              onClick={() => onSelect(row)}
            >
              Review
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DocumentsList({
  rows,
  canApprove,
  onSelect,
  onApprove,
  emptyAll,
}: {
  rows: PendingFinancialDoc[];
  canApprove: boolean;
  onSelect: (row: PendingFinancialDoc) => void;
  onApprove: (row: PendingFinancialDoc) => void;
  emptyAll: boolean;
}) {
  if (!rows.length) {
    return (
      <EmptyState
        icon={<DocumentText size={28} color="#94a3b8" />}
        title={emptyAll ? "No documents waiting" : "No matches"}
        body={
          emptyAll
            ? "Invoices, bills, journals and other paperwork awaiting approval will show here."
            : "Try another search."
        }
      />
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((row) => (
        <li
          key={docKey(row)}
          className={cn(
            "flex flex-col gap-3 px-4 py-4 transition hover:bg-slate-50/70 sm:flex-row sm:items-center sm:px-5",
            row.overdue && "bg-rose-50/30",
            row.highValue && !row.overdue && "bg-orange-50/20",
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(row)}
            className="min-w-0 flex-1 space-y-1.5 text-left"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-slate-900 hover:underline">
                {row.reference}
              </span>
              <StatusPill status={row.status} overdue={row.overdue} highValue={row.highValue} />
            </div>
            <p className="text-[13px] text-slate-700">
              {row.label}
              {row.party ? <span className="text-slate-400"> · {row.party}</span> : null}
            </p>
            <div className="flex flex-wrap gap-x-3 text-[12px] text-slate-400">
              <span className="capitalize">{row.module}</span>
              {row.date ? <span>{row.date}</span> : null}
              {row.dueDate ? (
                <span className={row.overdue ? "font-medium text-rose-600" : undefined}>
                  Due {row.dueDate}
                </span>
              ) : row.daysOpen > 0 ? (
                <span>{row.daysOpen}d open</span>
              ) : null}
            </div>
          </button>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
            <p className="text-right text-[16px] font-semibold tabular-nums tracking-tight text-slate-900">
              {money(row.amount, row.currency)}
            </p>
            <div className="flex justify-end gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                onClick={() => onSelect(row)}
              >
                Review
              </Button>
              {canApprove ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1 rounded-lg bg-emerald-600 px-3 text-white hover:bg-emerald-700"
                  onClick={() => onApprove(row)}
                >
                  <TickCircle size={14} color="currentColor" />
                  Approve
                </Button>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RedList({
  items,
  canApprove,
  sessionRole,
  onSelectPayment,
  onSelectDocument,
  onSelectProject,
  onAdvancePayment,
  onApproveDocument,
}: {
  items: ReturnType<typeof buildExecutiveDesk>["redItems"];
  canApprove: boolean;
  sessionRole: string;
  onSelectPayment: (row: PaymentRequestMonitorRow) => void;
  onSelectDocument: (row: PendingFinancialDoc) => void;
  onSelectProject: (row: StalledProjectRow) => void;
  onAdvancePayment: (row: PaymentRequestMonitorRow, forwardTo?: "ceo" | "finance") => void;
  onApproveDocument: (row: PendingFinancialDoc) => void;
}) {
  if (!items.length) {
    return (
      <EmptyState
        icon={<Danger size={28} color="#94a3b8" />}
        title="Nothing urgent"
        body="Overdue payments, high-value items, and stalled projects appear here first."
      />
    );
  }

  return (
    <ul className="divide-y divide-rose-50">
      {items.map((item) => {
        if (item.kind === "payment") {
          const row = item.row;
          const why = row.overdue ? "Overdue payment" : "High-value payment";
          return (
            <li
              key={`pay-${row.id}`}
              className="flex flex-col gap-3 bg-rose-50/20 px-4 py-4 transition hover:bg-rose-50/50 sm:flex-row sm:items-center sm:px-5"
            >
              <button
                type="button"
                onClick={() => onSelectPayment(row)}
                className="min-w-0 flex-1 space-y-1.5 text-left"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                    {why}
                  </span>
                  <StatusPill status={row.status} overdue={row.overdue} highValue />
                </div>
                <span className="block text-[14px] font-semibold text-slate-900 hover:underline">
                  {row.reference}
                </span>
                <p className="text-[13px] text-slate-700">
                  {row.payee || "—"}
                  {row.department ? (
                    <span className="text-slate-400"> · {row.department}</span>
                  ) : null}
                </p>
              </button>
              <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                <p className="text-right text-[16px] font-semibold tabular-nums text-rose-900">
                  {money(row.amount, row.currency)}
                </p>
                <div className="flex justify-end gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg"
                    onClick={() => onSelectPayment(row)}
                  >
                    Review
                  </Button>
                  {deskCanAdvance(row, sessionRole).ok ? (
                    deskCanAdvance(row, sessionRole).stage === "gm" ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                          onClick={() => onAdvancePayment(row, "ceo")}
                        >
                          → CEO
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 rounded-lg bg-slate-800 text-white hover:bg-slate-700"
                          onClick={() => onAdvancePayment(row, "finance")}
                        >
                          → Finance
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={() => onAdvancePayment(row)}
                      >
                        {deskAdvanceLabel(row)}
                      </Button>
                    )
                  ) : null}
                </div>
              </div>
            </li>
          );
        }

        if (item.kind === "project") {
          const row = item.row;
          return (
            <li
              key={`proj-${row.id}`}
              className="flex flex-col gap-3 bg-rose-50/20 px-4 py-4 transition hover:bg-rose-50/50 sm:flex-row sm:items-center sm:px-5"
            >
              <button
                type="button"
                onClick={() => onSelectProject(row)}
                className="min-w-0 flex-1 space-y-1.5 text-left"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                    Stalled project
                  </span>
                  <StatusPill status={row.status} overdue={row.daysOverdue > 0} />
                </div>
                <span className="block text-[14px] font-semibold text-slate-900 hover:underline">
                  {row.name}
                </span>
                <p className="text-[13px] text-slate-700">{row.reason}</p>
              </button>
              <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                <p className="text-right text-[13px] font-medium text-rose-800">
                  {row.daysOverdue > 0 ? `${row.daysOverdue}d past end` : row.status}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg"
                  onClick={() => onSelectProject(row)}
                >
                  Review
                </Button>
              </div>
            </li>
          );
        }

        const row = item.row;
        const why = row.overdue ? "Overdue document" : "High-value document";
        return (
          <li
            key={`doc-${docKey(row)}`}
            className="flex flex-col gap-3 bg-rose-50/20 px-4 py-4 transition hover:bg-rose-50/50 sm:flex-row sm:items-center sm:px-5"
          >
            <button
              type="button"
              onClick={() => onSelectDocument(row)}
              className="min-w-0 flex-1 space-y-1.5 text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                  {why}
                </span>
                <StatusPill status={row.status} overdue={row.overdue} highValue={row.highValue} />
              </div>
              <span className="block text-[14px] font-semibold text-slate-900 hover:underline">
                {row.reference}
              </span>
              <p className="text-[13px] text-slate-700">
                {row.label}
                {row.party ? <span className="text-slate-400"> · {row.party}</span> : null}
              </p>
            </button>
            <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
              <p className="text-right text-[16px] font-semibold tabular-nums text-rose-900">
                {money(row.amount, row.currency)}
              </p>
              <div className="flex justify-end gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg"
                  onClick={() => onSelectDocument(row)}
                >
                  Review
                </Button>
                {canApprove ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() => onApproveDocument(row)}
                  >
                    Approve
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyState({
  icon,
  title,
  body,
  href,
  linkLabel,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-14 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-100">
        {icon}
      </span>
      <p className="text-[14px] font-semibold text-slate-800">{title}</p>
      <p className="max-w-sm text-[13px] leading-relaxed text-slate-500">{body}</p>
      {href && linkLabel ? (
        <Link href={href} className="mt-2">
          <Button size="sm" variant="outline" className="rounded-lg">
            {linkLabel}
          </Button>
        </Link>
      ) : null}
    </div>
  );
}
