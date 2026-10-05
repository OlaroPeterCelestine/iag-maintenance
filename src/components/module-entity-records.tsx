"use client";

import { DocumentExportActions } from "@/components/document-export-actions";
import { MaterialRequestLinesEditor } from "@/components/material-request-lines-editor";
import { supportsDocumentPdf } from "@/lib/export/supports-document-pdf";
import {
  exportMaterialRequestCsv,
  materialRequestLinesFromRecord,
  materialRequestLinesSummary,
  serializeMaterialRequestLines,
} from "@/lib/material-request-lines";
import { uploadMaterialRequestCsv } from "@/lib/material-request-import";
import { uploadDocumentLineCsv } from "@/lib/document-line-import";
import { uploadJournalEntryCsv } from "@/lib/journal-entry-import";
import { uploadEntityImportRows } from "@/lib/entity-csv-import";
import { DOCUMENT_LINE_ENTITIES } from "@/lib/document-lines";
import { documentLineImportTemplateName } from "@/lib/document-line-import-sheet";
import {
  exportTableCsv,
  exportTableExcel,
  exportTablePdf,
  type TableExport,
} from "@/lib/export/table-export";
import { useAppShell } from "@/components/app-shell";
import { SegmentTabList, segmentTabClass } from "@/components/segment-tabs";
import { FeedbackModals, REQUEST_PAYMENT_METHODS, useFeedbackModals } from "@/components/feedback-modals";
import { entitySupportsApprovalAmount } from "@/lib/approval-amount";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { PaginationBar } from "@/components/pagination-bar";
import { ResponsiveModal } from "@/components/responsive-modal";
import { PartyCreateModal } from "@/components/party-create-modal";
import { ProjectRoleCreateModal } from "@/components/project-role-create-modal";
import { ProjectWbsEditor } from "@/components/project-wbs-editor";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoneyInput } from "@/components/money-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useInFlightGuard } from "@/hooks/use-in-flight-guard";
import { usePagination } from "@/hooks/use-pagination";
import { useUndoStack } from "@/hooks/use-undo-stack";
import { iconForLabel } from "@/lib/iconsax";
import {
  entityDefinitions,
  entityKey,
  formatFieldValue,
  isMoneyInputField,
  type EntityDefinition,
  type ManagerRecord,
} from "@/lib/manager-entities";
import { fieldInputHint } from "@/lib/page-form-guide";
import { hrefForRecordDetail, hrefForSourceDocument, type ModuleConfig, type ModuleSlug } from "@/lib/module-data";
import { useManagerRecords } from "@/lib/use-manager-records";
import { storageSlugForEntity } from "@/lib/entity-storage";
import {
  Add,
  ArrowDown2,
  ArrowLeft2,
  CloseCircle,
  DocumentDownload,
  DocumentText,
  DocumentUpload,
  Edit2,
  Eye,
  Filter,
  HambergerMenu,
  MoneySend,
  People,
  Refresh,
  SearchNormal1,
  TickCircle,
  Trash,
} from "iconsax-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AccountingOperationsDesk,
  BankAccountActivityPanel,
  BankStatementImporter,
  CreatePayrollPanel,
  DocumentLinesEditor,
  FinancialReportPanel,
  FleetReportsPanel,
  FleetServiceRemindersPanel,
  HrDeskPanel,
  JournalLinesEditor,
  MyProjectsPanel,
  PayslipComputePanel,
  PosTerminalPanel,
  ProductDevelopmentSimulationsPanel,
  ProjectCashflowPanel,
  ProjectGanttPanel,
  SalesInvoiceOptionsPanel,
} from "@/components/module-lazy-panels";
import { AttendanceCheckinPanel } from "@/components/attendance-checkin-panel";
import { liveReportKind } from "@/lib/live-report-kind";
import { PAYSLIP_COMPUTE_KEYS } from "@/lib/payslip-compute-keys";
import { cn } from "@/lib/utils";
import {
  completeTripRequest,
  completeMaintenanceRequest,
  fulfillFuelRequest,
  fuelRequestAwaitingFulfillment,
  maintenanceAwaitingCompletion,
  tripAwaitingCompletion,
  updateVehicleOdometer,
  assertOdometerNotDecreasing,
  findFixedAssetByKey,
  fixedAssetSelectOptions,
  fleetVehicleSelectOptions,
  guessVehicleType,
  syncFleetVehicleFromFixedAsset,
  syncFixedAssetFromFleetVehicle,
} from "@/lib/fleet-ops";
import {
  ContentFade,
  KpiStripSkeleton,
  ModulePageSkeleton,
  TableRowsSkeleton,
} from "@/components/page-loading";
import {
  RecordDetailMissing,
  RecordDetailPage,
} from "@/components/record-detail-page";
import {
  currentProjectDirectoryRow,
  currentProjectScopeKind,
  filterRecordsForProjectScope,
  scopedProjectNames,
} from "@/lib/project-scope";
import {
  loadProjectWbsDraft,
  parseWbsDraft,
  syncProjectWbs,
  type ProjectPhaseDraft,
} from "@/lib/project-wbs";
import {
  RecordAttachmentsField,
  RecordAttachmentsView,
} from "@/components/record-attachments-field";
import { syncRecordAttachmentsToLibrary, sanitizeAttachmentsJson } from "@/lib/record-attachments";
import { reconcileBankAccount } from "@/lib/ledger/control-reconciliation";
import {
  coaDisplayDepth,
  coaGroupOptions,
  ensureCoaGroupRecords,
  isCoaGroup,
  sortCoaHierarchy,
} from "@/lib/coa-hierarchy";
import { openInvoiceOptions, refreshAllocatedDocument } from "@/lib/ar-ap";
import {
  documentLinesFromRecord,
  documentLinesTotal,
  journalLinesFromRecord,
  normalizeDocumentLine,
  serializeDocumentLines,
  serializeJournalLines,
  supportsDocumentLines,
  supportsJournalLines,
} from "@/lib/document-lines";
import {
  computeSalesInvoiceTotals,
  defaultSalesInvoiceOptions,
  loadActiveFooters,
  loadFormOptions,
  saveFormOptions,
  supportsSalesInvoiceOptions,
  type FormOptionsState,
} from "@/lib/form-options";
import {
  applyInventoryMovement,
  createInventoryLocation,
  createPosLocation,
  deleteInventoryLocation,
  deletePosLocation,
  inventoryItemSelectOptions,
  inventoryLocationSelectOptions,
  inventoryStockRollforward,
  posLocationSelectOptions,
  posProductSelectOptions,
  transferAwaitingReceipt,
  updateInventoryLocation,
  updatePosLocation,
} from "@/lib/inventory-movement";
import {
  validateAccountingRecord,
  validateAccountDeletion,
} from "@/lib/accounting-controls";
import { syncRecordToLedger, unsyncRecordFromLedger, deleteChartOfAccountsRecords } from "@/lib/ledger/sync-record";
import { postRecordToLedger } from "@/lib/ledger/api-post";
import {
  openingBalanceRows,
  removeSupplierOpeningBalanceInvoices,
  syncSupplierOpeningBalanceInvoices,
} from "@/lib/supplier-opening-balances";
import { SupplierOpeningBalancesFields } from "@/components/supplier-opening-balances-fields";
import { notifyRequestParties, REQUEST_EMAIL_ENTITIES } from "@/lib/export/notify-request-email";
import {
  deleteFormDraft,
  listFormDrafts,
  upsertFormDraft,
  type FormDraft,
} from "@/lib/form-drafts";
import { loadChartOfAccounts, coaAccountSelectOptions, bankAccountSelectOptions, isCoaPickerField, coaPickerFilterForField, isChartOfAccountsBankName, BANK_ACCOUNT_CREATE_HINT, BANK_ACCOUNT_NAME_HINT } from "@/lib/ledger/chart-of-accounts";
import { enrichRecordsWithLiveBalances, getModuleKpis } from "@/lib/ledger/live-data";
import {
  moneyAllocationLabel,
  validateInterAccountTransfer,
} from "@/lib/banking-summary";
import {
  bankAccountsMatch,
  canonicalBankAccountName,
  canonicalPartyName,
  partyFromAppliedDocument,
} from "@/lib/accounting-party-bank";
import { rebuildOpeningBalanceEntry } from "@/lib/ledger/opening-balances";
import { logDeletedRecord, DELETED_RECORD_META_KEYS, humanizeFieldKey } from "@/lib/deleted-records";
import { assertUnlocked, logHistory } from "@/lib/history";
import { logFieldChanges } from "@/lib/field-audit";
import {
  assertMakerChecker,
  assertPageCrud,
  assertPermission,
  canAccessModuleTab,
  currentUserCan,
  currentUserEntityCrud,
} from "@/lib/access-control";
import { isPendingApprovalStatus } from "@/lib/pending-approvals";
import { REQUISITION_CHAIN_ENTITIES, assertRequisitionChainStatusChange, requisitionChainProgress, requisitionChainStepDates } from "@/lib/requisition-chain";
import {
  createRecordAsync,
  deleteRecordsAsync,
  loadRecords,
  saveRecords,
  saveRecordsAsync,
  sortRecordsNewestFirst,
  updateRecordAsync,
} from "@/lib/records-store";
import { setMemoryRecords } from "@/lib/db/client-store";
import { apiFetch } from "@/lib/api-auth";
import {
  awaitInFlightPersists,
  holdEntityMutation,
  hydrateEntityFromDatabase,
  knownEntityCapabilities,
  CAPABILITIES_CHANGED_EVENT,
  type EntityAction,
} from "@/lib/db/sync";
import { hydrateFormPickerSources } from "@/lib/form-picker-hydrate";
import { useRecordsSyncTick } from "@/hooks/use-records-sync-tick";
import {
  defaultTaxCodes,
  loadList,
  loadManagerSettings,
  TAX_CODES_KEY,
  taxCodeSelectOptions,
  currencySelectOptions,
} from "@/lib/manager-settings";
import { FormEvent, Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ModuleKpi } from "@/lib/module-data";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { formatAmountInput, formatMoney, sanitizeAmountInput } from "@/lib/ledger/money";
import { convertBetween, convertToBase, isBaseCurrency, normalizeCurrency } from "@/lib/ledger/fx";
import {
  canBulkImportEntity,
  findImportedMatch,
  importTemplateCsv,
  LINE_SHEET_CSV_ENTITIES,
  normalizeRecordDates,
  normalizeToIsoDate,
  parseEntityImport,
  parseEntityImportDetailed,
  validateImportRow,
} from "@/lib/data-import";
import type { ImportRow, ParsedEntityImport } from "@/lib/data-import";
import {
  PROJECT_WBS_ENTITIES,
  withProjectHierarchyOptions,
} from "@/lib/project-hierarchy";
import {
  canRaisePaymentRequest,
  createPaymentRequestFromSource,
} from "@/lib/payment-requests-monitor";
import {
  advanceOralPaymentRequest,
  amendOralPaymentRequest,
  canAdvanceOralPaymentRequest,
  canAmendOralPaymentRequest,
  canRejectOralPaymentRequest,
  ensureOralPaymentCashSettled,
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
  advanceActionLabel,
  advancePaymentRequest,
  amendPaymentRequest,
  canAdvancePaymentRequest,
  canAmendPaymentRequest,
  canRejectPaymentRequest,
  rejectPaymentRequest,
} from "@/lib/payment-approval-chain";
import {
  advanceGenericRequisition,
  amendGenericRequisition,
  canAdvanceGenericRequisition,
  canAmendGenericRequisition,
  canRejectGenericRequisition,
  genericRequisitionAdvanceLabel,
  rejectGenericRequisition,
} from "@/lib/generic-requisition-chain";
import {
  materialRequestProgress,
  materialRequestStepDates,
  pathFromRecord,
} from "@/lib/material-request-chain";
import {
  leaveChainProgress,
  leaveChainStepDates,
} from "@/lib/leave-request-chain";
import { RequestChainTracker } from "@/components/request-chain-tracker";
import { getCurrentSessionUser } from "@/lib/session-profile";
import {
  canEditRequestChainRecord,
  canRecallRequestToDraft,
  canRedoRejectedRequest,
  canReturnRequestOneStep,
  isRequestChainEntityKey,
  sortRecordsForRequestorAttention,
  type AmendReturnMode,
} from "@/lib/request-amend-flow";
import { RequestOutcomeBanner } from "@/components/request-outcome-banner";
import { DualMoney } from "@/components/dual-money";
import { DivisionSelect } from "@/components/division-select";
import { FACTORY_PARAM } from "@/components/factory-scope-select";
import { SupplierCategorySelect } from "@/components/supplier-category-select";
import { InvoicePaymentDialog } from "@/components/party-ledger-panel";
import { SearchablePicker } from "@/components/searchable-picker";
import { isAutoCodedEntity, nextDocumentReference, nextEntityCode } from "@/lib/document-references";
import { documentOpenBalance, enrichedOpenBalance } from "@/lib/ar-ap";
import { attachmentFieldKeys, buildRecordSearchIndex } from "@/lib/record-search";
import {
  partyOpenDocuments,
  partyPickerSide,
  partySelectOptions,
} from "@/lib/party-ledger";
import {
  addCustomUgandaBank,
  bankCodeForName,
  ugandaBankSelectOptions,
} from "@/lib/uganda-banks";
import {
  addEmployeeDepartment,
  employeeDepartmentSelectOptions,
  ensureDriverRecord,
  fleetDriverSelectOptions,
  registerDepartmentName,
} from "@/lib/employee-departments";

const HIDDEN_WHEN_LINES = new Set(["quantity", "unitPrice", "amount", "debit", "credit", "debitAccount", "creditAccount"]);

/** Fields that should pick from Inventory → Inventory items. */
function isInventoryItemPickerField(key: string, label?: string) {
  if (key === "item" || key === "finishedItem") return true;
  const blob = `${key} ${label || ""}`.toLowerCase();
  return /inventory item|finished item/.test(blob);
}

/** Fields that should pick from Inventory → Locations (stores / warehouses). */
/**
 * Whether a form field draws the store / warehouse location picker. Never on
 * the MES maintenance forms: a machine's "Site / location" is free text MES
 * stores as given, and the picker — the finance app's inventory locations —
 * offered nothing there ("No locations yet") and could not be filled in.
 */
/**
 * Whether a field draws the chart-of-accounts picker. Never on the MES
 * maintenance forms: the heuristic reads "asset category" as a GL asset
 * account, which turned PM Templates' "Machine type" (assetCategory) into an
 * account picker offering "No accounts yet" — it could not be filled in.
 */
function usesCoaPicker(entityKey: string, key: string, label?: string) {
  return !MES_MAINTENANCE_ENTITIES.has(entityKey) && isCoaPickerField(key, label, entityKey);
}

function usesWarehouseLocationPicker(entityKey: string, key: string, label?: string) {
  return !MES_MAINTENANCE_ENTITIES.has(entityKey) && isInventoryLocationPickerField(key, label);
}

function isInventoryLocationPickerField(key: string, label?: string) {
  const normalizedKey = key.toLowerCase();
  const normalizedLabel = (label || "").toLowerCase();
  if (
    normalizedKey === "location" ||
    normalizedKey === "warehouse" ||
    normalizedKey === "store" ||
    normalizedKey === "fromlocation" ||
    normalizedKey === "tolocation"
  ) {
    return true;
  }
  return (
    (normalizedKey === "from" || normalizedKey === "to") &&
    /location|warehouse|store/.test(normalizedLabel)
  );
}

/** POS entities whose location fields pick from POS → Locations (sales places). */
function usesPosLocationPicker(entityKey: string) {
  return (
    entityKey === "registers" ||
    entityKey === "pos-products" ||
    entityKey === "pos-stock-in" ||
    entityKey === "pos-sales" ||
    entityKey === "pos-returns"
  );
}

type PosLocationKind = "store" | "kiosk" | "counter" | "stall" | "branch" | "market" | "other";
type InventoryLocationKind = "warehouse" | "store" | "location";
type LocationKind = PosLocationKind | InventoryLocationKind;

function inventoryStockLevels(record: ManagerRecord) {
  const closing = parseAmount(record.quantity || record.closingStock || "0");
  let movement = 0;
  try {
    const moves = record.inventoryMoves
      ? (JSON.parse(record.inventoryMoves) as Record<string, number>)
      : {};
    movement = Object.values(moves).reduce((sum, value) => sum + parseAmount(value), 0);
  } catch {
    movement = 0;
  }
  const opening =
    record.openingStock !== undefined && record.openingStock !== ""
      ? parseAmount(record.openingStock)
      : closing - movement;
  return { opening, closing };
}

/** Quiet period that ends a burst of ledger events, and the longest it may delay a refresh. */
const LEDGER_BURST_QUIET_MS = 150;
const LEDGER_BURST_MAX_MS = 750;

/** Computed / live columns — never shown on create/edit forms. */
const LIVE_ONLY_FIELDS = new Set([
  "balance",
  "closingBalance",
  "uncategorizedReceipts",
  "uncategorizedPayments",
  "allocation",
  "closingStock",
  "closingValue",
  "amountPaid",
  "balanceDue",
]);

const RECEIVABLE_INVOICE_KEYS = new Set([
  "sales-invoices",
  "invoices",
  "late-payment-fees",
]);
const PAYABLE_INVOICE_KEYS = new Set(["purchase-invoices", "bills"]);

type EditorState =
  | { mode: "create"; record: ManagerRecord | null; draftId?: string }
  | { mode: "edit" | "view"; record: ManagerRecord; draftId?: string }
  | null;

function invoicePaymentSide(entityKey: string): "receivable" | "payable" | null {
  if (RECEIVABLE_INVOICE_KEYS.has(entityKey)) return "receivable";
  if (PAYABLE_INVOICE_KEYS.has(entityKey)) return "payable";
  return null;
}

/**
 * Open balance for a table row. Every entity `invoicePaymentSide` recognises is
 * enriched with amountPaid / balanceDue by `enrichRecordsWithLiveBalances` in
 * one pass, so rows read that result instead of re-scanning every payment
 * per row — see enrichedOpenBalance in @/lib/ar-ap.
 */
const rowOpenBalance = enrichedOpenBalance;

/** Display name used when raising purchase invoices for a contractor. */
function contractorInvoicePartyName(record: ManagerRecord) {
  return (record.company || record.name || "").trim();
}

function contractorSelectOptions(): { value: string; label: string; meta?: string }[] {
  const options: { value: string; label: string; meta?: string }[] = [];
  for (const row of loadRecords("projects", "contractors")) {
    const value = contractorInvoicePartyName(row);
    if (!value) continue;
    options.push({
      value,
      label: value,
      meta: row.code || row.name || undefined,
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

function projectManagerSelectOptions(): { value: string; label: string; meta?: string }[] {
  const options: { value: string; label: string; meta?: string }[] = [];
  for (const row of loadRecords("projects", "project-managers")) {
    const value = (row.name || row.fullName || "").trim();
    if (!value) continue;
    options.push({
      value,
      label: value,
      meta: row.code || row.email || undefined,
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

/** Machines registered under Production → Machines (work-centers store). */
function workCenterSelectOptions(typeFilter?: RegExp, factory?: string): {
  value: string;
  label: string;
  meta?: string;
}[] {
  const options: { value: string; label: string; meta?: string }[] = [];
  for (const row of loadRecords("production", "work-centers")) {
    if (statusMatchesInactive(row)) continue;
    // Viewing one factory, a work order or a downtime log there can only be
    // about one of its machines.
    if (factory && (row.plantCode || "").trim() && (row.plantCode || "").trim() !== factory) continue;
    const type = (row.type || "").trim();
    if (typeFilter && type && !typeFilter.test(type)) continue;
    // The asset tag, not the name: MES joins work orders, downtime and PM
    // schedules to a machine on `asset_tag`, and a name stored there links to
    // nothing.
    const value = (row.code || row.name || "").trim();
    if (!value) continue;
    const name = (row.name || "").trim();
    options.push({
      value,
      label: name && name !== value ? `${name} (${value})` : value,
      meta: [type, [row.plantCode, row.section].filter(Boolean).join(" / ")].filter(Boolean).join(" · ") || undefined,
    });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Pickers over another maintenance collection, keyed by form field.
 *
 * `workOrder` on a job card names an MES work order; `template` on a PM
 * schedule names a PM template. Both were free text, so a typo created a job
 * card against nothing or a schedule the service refused.
 */
const MAINTENANCE_RECORD_PICKERS: Record<
  string,
  {
    /** The forms this picker belongs to; the field key alone is too common. */
    on: string[];
    entity: string;
    placeholder: string;
    empty: string;
    /** Accept a typed value that is not in the list. */
    allowCustom?: boolean;
    /**
     * Another picker on the same form this one narrows by: a shop floor is
     * offered only within the factory already chosen, because section codes
     * are unique per factory and "roasting" at two factories is two floors.
     */
    dependsOn?: string;
    belongsTo?: (row: ManagerRecord) => string;
    dependsOnEmpty?: string;
    option: (row: ManagerRecord) => { value: string; label: string; meta?: string } | null;
  }
> = {
  workOrder: {
    on: ["batch-records"],
    entity: "work-orders",
    placeholder: "Select work order…",
    empty: "No open work orders — raise one under Work Orders first.",
    option: (row) => {
      if (/completed|cancelled/i.test(row.status || "")) return null;
      const value = (row.reference || row.id || "").trim();
      if (!value) return null;
      return {
        value,
        label: `${value} — ${row.title || row.workCenter || ""}`.replace(/ — $/, ""),
        meta: [row.workCenter, row.status].filter(Boolean).join(" · ") || undefined,
      };
    },
  },
  template: {
    on: ["pm-schedules"],
    entity: "pm-templates",
    placeholder: "Select PM template…",
    empty: "No PM templates yet — add one under PM Templates first.",
    option: (row) => {
      const value = (row.code || "").trim();
      if (!value) return null;
      return {
        value,
        label: `${value} — ${row.name || ""}`.replace(/ — $/, ""),
        meta: row.intervalDays ? `every ${row.intervalDays} days` : undefined,
      };
    },
  },
};

/**
 * MES technicians (iag-mes#5). MES stores the assignee as a name, so the
 * picker writes the name, and still takes a typed one — for a contractor, or
 * before the technicians route is deployed and the list is empty.
 */
const technicianPicker = (on: string[]) => ({
  on,
  entity: "technicians",
  placeholder: "Select technician…",
  empty: "No technicians listed in MES — type a name.",
  allowCustom: true,
  option: (row: ManagerRecord) => {
    if (/inactive/i.test(row.status || "")) return null;
    const value = (row.name || "").trim();
    if (!value) return null;
    return { value, label: value, meta: [row.role, row.plant].filter(Boolean).join(" · ") || undefined };
  },
});
MAINTENANCE_RECORD_PICKERS.assignee = technicianPicker(["work-orders"]);
MAINTENANCE_RECORD_PICKERS.technician = technicianPicker(["batch-records"]);
MAINTENANCE_RECORD_PICKERS.supervisor = technicianPicker(["work-centers"]);
MAINTENANCE_RECORD_PICKERS.reportedBy = technicianPicker(["downtime-logs"]);
// MES plants — factories: where a machine stands, which factory a shop floor
// belongs to, and the meter an energy reading came from.
MAINTENANCE_RECORD_PICKERS.plantCode = {
  on: ["energy", "work-centers", "sections"],
  entity: "plants",
  placeholder: "Select factory…",
  empty: "No factories yet — add one under Factories.",
  option: (row: ManagerRecord) => {
    const value = (row.code || "").trim();
    if (!value || /inactive/i.test(row.status || "")) return null;
    return {
      value,
      label: row.name ? `${row.name} (${value})` : value,
      meta: [row.city, row.district].filter(Boolean).join(", ") || row.region || undefined,
    };
  },
};
// MES sections — the shop floor a machine stands on, within its factory.
MAINTENANCE_RECORD_PICKERS.section = {
  on: ["work-centers"],
  entity: "sections",
  placeholder: "Select shop floor…",
  empty: "No shop floors in this factory yet — add one under Shop Floors.",
  dependsOn: "plantCode",
  dependsOnEmpty: "Pick the factory first.",
  belongsTo: (row: ManagerRecord) => (row.plantCode || "").trim(),
  option: (row: ManagerRecord) => {
    const value = (row.code || "").trim();
    if (!value) return null;
    return {
      value,
      label: row.name && row.name !== value ? `${row.name} (${value})` : value,
      meta: row.lineType || undefined,
    };
  },
};

function maintenanceRecordOptions(fieldKey: string, values: Record<string, string> = {}) {
  const picker = MAINTENANCE_RECORD_PICKERS[fieldKey];
  if (!picker) return [];
  const parent = picker.dependsOn ? (values[picker.dependsOn] || "").trim() : "";
  if (picker.dependsOn && !parent) return [];
  const out: { value: string; label: string; meta?: string; searchText: string }[] = [];
  for (const row of loadRecords("production", picker.entity)) {
    if (parent && picker.belongsTo && picker.belongsTo(row) !== parent) continue;
    const opt = picker.option(row);
    if (opt) out.push({ ...opt, searchText: `${opt.label} ${opt.meta || ""}` });
  }
  // Work orders newest first (WO-n); everything else alphabetical.
  return picker.entity === "work-orders"
    ? out.sort((a, b) => b.value.localeCompare(a.value, undefined, { numeric: true }))
    : out.sort((a, b) => a.label.localeCompare(b.label));
}

function statusMatchesInactive(row: ManagerRecord) {
  return /inactive|retired|disposed|void|archived/i.test(row.status || "");
}

/** Party strings that should match invoices entered for this contractor. */
function contractorPartyAliases(record: ManagerRecord): string[] {
  const values = [
    record.company,
    record.name,
    record.code,
    contractorInvoicePartyName(record),
  ]
    .map((v) => (v || "").trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function invoicePartyValue(row: ManagerRecord) {
  return (row.party || row.supplier || "").trim().toLowerCase();
}

function invoiceMatchesContractor(row: ManagerRecord, contractor: ManagerRecord) {
  const docParty = invoicePartyValue(row);
  if (!docParty) return false;
  const aliases = contractorPartyAliases(contractor);
  if (aliases.some((alias) => alias === docParty)) return true;
  // Tolerate "CODE — Name", slight extra text, or contact vs company swaps.
  return aliases.some(
    (alias) =>
      alias.length >= 3 && (docParty.includes(alias) || alias.includes(docParty)),
  );
}

function loadContractorPurchaseInvoices() {
  const primary = loadRecords("purchases", "purchase-invoices");
  const bills = loadRecords("purchases", "bills");
  if (!bills.length) return primary;
  const seen = new Set(primary.map((r) => r.id));
  return [...primary, ...bills.filter((r) => !seen.has(r.id))];
}

const ALL_CONTRACTORS_ID = "__all__";

function ContractorInvoicesSection({
  contractor,
  contractors: contractorsProp,
  selectedId: selectedIdProp,
  partyPrefill,
  onSelectedIdChange,
}: {
  contractor?: ManagerRecord | null;
  /** When set, show a contractor picker (list page workbench). */
  contractors?: ManagerRecord[];
  selectedId?: string;
  /** Deep-link party name from ?party= */
  partyPrefill?: string;
  onSelectedIdChange?: (id: string) => void;
}) {
  const { tick, ready } = useRecordsSyncTick([
    // Contractors first so the picker fills before invoice GETs finish.
    { module: "projects", entity: "contractors" },
    { module: "purchases", entity: "purchase-invoices" },
    { module: "purchases", entity: "bills" },
  ]);
  const [selectedIdLocal, setSelectedIdLocal] = useState(
    () => selectedIdProp || contractor?.id || ALL_CONTRACTORS_ID,
  );
  const [invoiceEditor, setInvoiceEditor] = useState<EditorState>(null);
  const { feedback, close, showSuccess, showWarning } = useFeedbackModals();

  // Always re-read from the store on sync — a one-shot parent prop can be empty before hydrate.
  const pickerRows = useMemo(() => {
    void tick;
    if (contractor) return [];
    const fromStore = loadRecords("projects", "contractors");
    const rows = fromStore.length ? fromStore : contractorsProp || [];
    return rows.filter((row) => contractorInvoicePartyName(row));
  }, [contractor, contractorsProp, tick]);

  const selectedId = selectedIdProp || selectedIdLocal;
  const setSelectedId = onSelectedIdChange ?? setSelectedIdLocal;

  useEffect(() => {
    if (contractor?.id) setSelectedId(contractor.id);
  }, [contractor?.id, setSelectedId]);

  useEffect(() => {
    if (selectedIdProp) setSelectedIdLocal(selectedIdProp);
  }, [selectedIdProp]);

  // Resolve ?party= once after hydrate — do not re-force on every sync tick.
  const partyPrefillAppliedRef = useRef("");
  useEffect(() => {
    const needle = (partyPrefill || "").trim().toLowerCase();
    if (!needle || contractor?.id) return;
    if (partyPrefillAppliedRef.current === needle) return;
    const match = pickerRows.find(
      (row) =>
        contractorInvoicePartyName(row).toLowerCase() === needle ||
        (row.name || "").trim().toLowerCase() === needle ||
        (row.code || "").trim().toLowerCase() === needle,
    );
    if (match?.id) {
      partyPrefillAppliedRef.current = needle;
      setSelectedIdLocal(match.id);
    }
  }, [partyPrefill, pickerRows, contractor?.id]);

  const showAll = !contractor && selectedId === ALL_CONTRACTORS_ID;
  const active =
    contractor ||
    (showAll ? null : pickerRows.find((row) => row.id === selectedId) || null);
  const party = active ? contractorInvoicePartyName(active) : "";

  // Permissions read localStorage — false during SSR. Defer gated controls until
  // after mount so server HTML matches the first client paint (avoids a hydration
  // Runtime Error). Do NOT use useSyncExternalStore with object snapshots —
  // currentUserEntityCrud() returns a new object each call and infinite-loops.
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => {
    setClientReady(true);
  }, []);

  const invoiceCrud = currentUserEntityCrud("purchases", "purchase-invoices");
  const canCreateInvoice = clientReady && invoiceCrud.create;
  const canEditInvoice = clientReady && invoiceCrud.edit;

  const invoiceDefinition = useMemo(() => {
    // Prefer the projects contractor-invoices shape (contractor + project + attachments).
    // Records still persist as purchase invoices so they post through Purchases AP.
    const contractorDef = entityDefinitions("projects").find(
      (d) => d.key === "contractor-invoices",
    );
    if (contractorDef?.fields.length) return contractorDef;
    const purchaseDef = entityDefinitions("purchases").find(
      (d) => d.key === "purchase-invoices",
    );
    if (purchaseDef) {
      const hasAttachments = purchaseDef.fields.some((f) => f.key === "attachments");
      if (hasAttachments) return purchaseDef;
      return {
        ...purchaseDef,
        fields: [
          ...purchaseDef.fields,
          {
            key: "attachments",
            label: "Attachments",
            type: "attachments" as const,
            placeholder: "Invoice PDF / supporting documents",
          },
        ],
      };
    }
    return {
      key: "contractor-invoices",
      label: "Contractor Invoices",
      singular: "Contractor Invoice",
      fields: [],
      columns: [],
    } satisfies EntityDefinition;
  }, []);

  const importInputRef = useRef<HTMLInputElement>(null);
  const allowBulkImport = canBulkImportEntity("contractor-invoices", {
    canCreate: canCreateInvoice,
    canEdit: canEditInvoice,
  });

  const contractorSiblingRecords = useMemo(() => {
    void tick;
    return loadContractorPurchaseInvoices();
  }, [tick]);

  const invoices = useMemo(() => {
    const matched = showAll
      ? contractorSiblingRecords.filter((row) =>
          pickerRows.some((ctr) => invoiceMatchesContractor(row, ctr)),
        )
      : active
        ? contractorSiblingRecords.filter((row) => invoiceMatchesContractor(row, active))
        : [];
    return matched.sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || "")),
    );
  }, [showAll, active, pickerRows, contractorSiblingRecords]);

  function openNewInvoice() {
    if (!canCreateInvoice) {
      showWarning(
        "Permission denied",
        assertPageCrud(invoiceCrud, "create") ||
          "Your role cannot create purchase invoices.",
      );
      return;
    }
    const now = new Date().toISOString();
    const seed: ManagerRecord = {
      id: "",
      createdAt: now,
      updatedAt: now,
      ...(party ? { party, supplier: party } : {}),
      status: "Draft",
      date: now.slice(0, 10),
    };
    setInvoiceEditor({ mode: "create", record: seed });
  }

  async function persistInvoice(
    mode: "create" | "edit",
    values: Record<string, string>,
    existingId?: string,
  ) {
    const invoiceCrud = currentUserEntityCrud("purchases", "purchase-invoices");
    const crudBlock = assertPageCrud(
      invoiceCrud,
      mode === "create" ? "create" : "edit",
    );
    if (crudBlock) {
      showWarning("Permission denied", crudBlock);
      return;
    }
    const resolvedParty = (values.party || values.supplier || party || "").trim();
    if (!resolvedParty) {
      showWarning(
        "Contractor required",
        "Select a contractor on the invoice before saving.",
      );
      return;
    }
    if ("attachments" in values) {
      values.attachments = sanitizeAttachmentsJson(values.attachments);
    }
    const locked = assertUnlocked(values);
    if (locked) {
      showWarning("Period locked", locked);
      return;
    }
    const candidate = {
      ...values,
      party: resolvedParty,
      supplier: values.supplier || resolvedParty,
      id: existingId || "__validate__",
      createdAt: "",
      updatedAt: "",
    } as ManagerRecord;
    const controlError = validateAccountingRecord({
      moduleSlug: "purchases",
      entityKey: "purchase-invoices",
      record: candidate,
    });
    if (controlError) {
      showWarning("Could not save", controlError);
      return;
    }

    const now = new Date().toISOString();
    const current = loadRecords("purchases", "purchase-invoices");
    let record: ManagerRecord;
    let next: ManagerRecord[];

    if (mode === "create") {
      record = {
        ...values,
        party: resolvedParty,
        supplier: values.supplier || resolvedParty,
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
        createdAt: now,
        updatedAt: now,
      };
      next = [record, ...current];
    } else {
      const id = existingId!;
      next = current.map((row) => {
        if (row.id !== id) return row;
        return {
          ...row,
          ...values,
          party: resolvedParty,
          supplier: values.supplier || resolvedParty,
          id,
          updatedAt: now,
        };
      });
      record = next.find((row) => row.id === id)!;
    }

    setMemoryRecords("purchases", "purchase-invoices", next);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
    }

    // Close the form immediately — do not leave it open while Postgres writes.
    setInvoiceEditor(null);

    const persisted = await saveRecordsAsync("purchases", "purchase-invoices", next);
    if (
      !persisted.ok ||
      persisted.durable !== "postgres"
    ) {
      setMemoryRecords("purchases", "purchase-invoices", current);
      window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
      showWarning(
        "Could not save to database",
        persisted.error || "Invoice was not stored. Try again.",
      );
      setInvoiceEditor({
        mode: mode === "create" ? "create" : "edit",
        record:
          mode === "create"
            ? ({
                ...values,
                party: resolvedParty,
                supplier: values.supplier || resolvedParty,
                id: "",
                createdAt: "",
                updatedAt: "",
              } as ManagerRecord)
            : record,
      });
      return;
    }

    if (invoiceDefinition.fields.some((f) => f.type === "attachments")) {
      try {
        await syncRecordAttachmentsToLibrary({
          entityKey: "contractor-invoices",
          record,
        });
      } catch (err) {
        showWarning(
          "Invoice saved, but attachments library failed",
          err instanceof Error ? err.message : "Could not save attachments",
        );
      }
    }

    showSuccess(
      persisted.durable === "postgres" ? "Invoice saved" : "Invoice created",
      mode === "create"
        ? `Purchase invoice ${record.reference || ""} saved for ${record.party || party}.`
        : `Purchase invoice ${record.reference || ""} updated.`,
    );

    const result = await postRecordToLedger("purchases", "purchase-invoices", record);
    if (!result.ok) {
      showWarning(
        "Saved, but ledger posting failed",
        result.error || "Fix the journal setup, then edit and save again to post.",
      );
    }
    await awaitInFlightPersists();
    logHistory({
      action: mode === "create" ? "Created" : "Updated",
      module: "Purchases",
      entity: "purchase-invoices",
      record,
    });
  }

  function downloadImportTemplate() {
    const blob = new Blob([importTemplateCsv(invoiceDefinition)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "contractor-invoices-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importContractorInvoices(files: FileList | File[]) {
    if (!allowBulkImport) {
      showWarning(
        "Import blocked",
        canCreateInvoice
          ? "CSV import is not available on this list."
          : "Your role cannot create purchase invoices. Ask an Administrator.",
      );
      return;
    }
    const list = Array.from(files);
    if (!list.length) return;

    try {
      const now = new Date().toISOString();
      const today = now.slice(0, 10);
      let working = loadRecords("purchases", "purchase-invoices").map((row) => ({
        ...row,
      }));
      const allImported: ManagerRecord[] = [];
      const rowErrors: string[] = [];
      let mode: "merge" | "replace" = "merge";
      const defaultParty = !showAll && party ? party : "";

      for (const file of list) {
        const parsed = parseEntityImport(file.name, await file.text(), invoiceDefinition);
        if (parsed.mode === "replace") mode = "replace";
        if (!parsed.rows.length) {
          rowErrors.push(`${file.name}: no data rows.`);
          continue;
        }

        for (let rowIndex = 0; rowIndex < parsed.rows.length; rowIndex += 1) {
          const item = parsed.rows[rowIndex]!;
          const match =
            parsed.mode === "merge"
              ? findImportedMatch(item, working, "purchase-invoices")
              : undefined;
          let record = normalizeRecordDates(
            {
              ...Object.fromEntries(
                invoiceDefinition.fields
                  .filter((field) => field.type !== "attachments")
                  .map((field) => [
                    field.key,
                    String(item[field.key] ?? match?.[field.key] ?? ""),
                  ]),
              ),
              id: String(match?.id ?? item.id ?? globalThis.crypto.randomUUID()),
              createdAt: String(match?.createdAt ?? item.createdAt ?? now),
              updatedAt: now,
              status: String(item.status || match?.status || "Draft"),
            },
            invoiceDefinition,
          ) as ManagerRecord;

          const resolvedParty = (record.party || record.supplier || defaultParty).trim();
          if (!resolvedParty) {
            rowErrors.push(
              `${file.name} row ${rowIndex + 2}: Contractor / party is required${
                showAll ? " (or pick a contractor before importing)" : ""
              }.`,
            );
            continue;
          }
          record = {
            ...record,
            party: resolvedParty,
            supplier: (record.supplier || resolvedParty).trim(),
          };

          const isoDate = normalizeToIsoDate(record.date || "");
          if (isoDate) {
            record = { ...record, date: isoDate };
          } else if (!(record.date || "").trim()) {
            record = { ...record, date: today };
          } else {
            rowErrors.push(
              `${file.name} row ${rowIndex + 2}: Invoice date “${record.date}” is not valid. Use YYYY-MM-DD or DD/MM/YYYY.`,
            );
            continue;
          }
          if (record.dueDate) {
            const isoDue = normalizeToIsoDate(record.dueDate);
            if (isoDue) record = { ...record, dueDate: isoDue };
          }

          const missing = invoiceDefinition.fields.find(
            (field) =>
              field.type !== "attachments" &&
              field.required &&
              !(record[field.key] || "").trim(),
          );
          if (missing) {
            rowErrors.push(
              `${file.name} row ${rowIndex + 2}: ${missing.label} is required.`,
            );
            continue;
          }

          const locked = assertUnlocked(record);
          if (locked) {
            rowErrors.push(`${file.name} row ${rowIndex + 2}: ${locked}`);
            continue;
          }
          const controlError = validateAccountingRecord({
            moduleSlug: "purchases",
            entityKey: "purchase-invoices",
            record,
            previous: working.find((existing) => existing.id === record.id),
          });
          if (controlError) {
            rowErrors.push(`${file.name} row ${rowIndex + 2}: ${controlError}`);
            continue;
          }

          const existingIndex = working.findIndex((row) => row.id === record.id);
          if (existingIndex >= 0) working[existingIndex] = record;
          else working = [...working, record];
          allImported.push(record);
        }
      }

      if (!allImported.length) {
        showWarning(
          "Nothing imported",
          rowErrors.length
            ? rowErrors.slice(0, 8).join("\n") +
                (rowErrors.length > 8 ? `\n…and ${rowErrors.length - 8} more.` : "")
            : "No usable rows were found.",
        );
        return;
      }

      const previous = loadRecords("purchases", "purchase-invoices");
      const importedById = new Map(allImported.map((record) => [record.id, record]));
      const next =
        mode === "replace"
          ? Array.from(new Map(allImported.map((r) => [r.id, r])).values())
          : [
              ...previous.map((record) => importedById.get(record.id) ?? record),
              ...allImported.filter(
                (record) => !previous.some((existing) => existing.id === record.id),
              ),
            ];

      setMemoryRecords("purchases", "purchase-invoices", next);
      window.dispatchEvent(new CustomEvent("financeiag-records-changed"));

      const persisted = await saveRecordsAsync("purchases", "purchase-invoices", next);
      if (!persisted.ok || persisted.durable !== "postgres") {
        setMemoryRecords("purchases", "purchase-invoices", previous);
        window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
        showWarning(
          "Could not save to database",
          persisted.error || "Import was not stored. Try again.",
        );
        return;
      }

      for (const record of allImported) {
        const result = await postRecordToLedger("purchases", "purchase-invoices", record);
        if (!result.ok) {
          rowErrors.push(
            `${record.reference || record.id}: ledger posting failed — ${result.error || "unknown"}`,
          );
        }
        logHistory({
          action: previous.some((row) => row.id === record.id) ? "Updated" : "Created",
          module: "Purchases",
          entity: "purchase-invoices",
          record,
        });
      }
      await awaitInFlightPersists();

      const errorNote =
        rowErrors.length > 0
          ? ` ${rowErrors.length} row${rowErrors.length === 1 ? "" : "s"} skipped or warned.`
          : "";
      showSuccess(
        "CSV imported",
        `Imported ${allImported.length} contractor invoice${
          allImported.length === 1 ? "" : "s"
        }.${errorNote}`,
      );
    } catch (error) {
      showWarning(
        "Import failed",
        error instanceof Error ? error.message : "Could not upload the CSV.",
      );
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <>
      <FeedbackModals feedback={feedback} onClose={close} />
      <div
        id="contractor-invoices"
        className="rounded-xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-slate-800">Contractor invoices</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Purchase invoices linked to contractors
              {showAll
                ? " · all contractors"
                : party
                  ? ` · ${party}`
                  : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!contractor ? (
              <select
                className="flex h-8 min-w-[220px] rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-800"
                value={showAll ? ALL_CONTRACTORS_ID : active?.id || ALL_CONTRACTORS_ID}
                onChange={(e) => setSelectedId(e.target.value)}
                aria-label="Contractor"
              >
                <option value={ALL_CONTRACTORS_ID}>All contractors</option>
                {pickerRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {contractorInvoicePartyName(row)}
                    {row.code ? ` (${row.code})` : ""}
                  </option>
                ))}
              </select>
            ) : null}
            <>
              <input
                ref={importInputRef}
                type="file"
                multiple
                accept=".csv,.tsv,.txt,.json,text/csv,text/tab-separated-values,application/json"
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files?.length) void importContractorInvoices(files);
                  e.currentTarget.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                title="Bulk upload CSV / TSV / JSON (not Excel .xlsx — save as CSV UTF-8 first)"
                onClick={() => importInputRef.current?.click()}
              >
                <DocumentUpload size={13} color="currentColor" /> Import CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                title="Download a blank CSV template with the correct column headers"
                onClick={downloadImportTemplate}
              >
                <DocumentDownload size={13} color="currentColor" /> CSV template
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                  <DocumentDownload size={13} color="currentColor" /> Export
                  <ArrowDown2 size={12} color="currentColor" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      const columns = ["Reference", "Date", "Party", "Amount", "Status"];
                      exportTableCsv({
                        title: "Contractor invoices",
                        filename: "contractor-invoices",
                        columns,
                        rows: invoices.map((row) => [
                          String(row.reference ?? ""),
                          String(row.date ?? ""),
                          String(row.party ?? ""),
                          String(row.amount ?? ""),
                          String(row.status ?? ""),
                        ]),
                      });
                    }}
                  >
                    <DocumentDownload size={14} color="currentColor" /> CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
            {canCreateInvoice ? (
              <Button
                type="button"
                size="sm"
                className="bg-black hover:bg-zinc-800"
                onClick={openNewInvoice}
                title={
                  showAll || !party
                    ? "Choose the contractor on the invoice form"
                    : undefined
                }
              >
                <Add size={14} color="currentColor" /> New {invoiceDefinition.singular}
              </Button>
            ) : null}
          </div>
        </div>
        {!ready && pickerRows.length === 0 && invoices.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-slate-400">
            Loading contractor invoices…
          </p>
        ) : !contractor && pickerRows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-slate-400">
            Add a contractor first, then create invoices here.
          </p>
        ) : invoices.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] text-slate-400">
            {showAll
              ? "No purchase invoices linked to contractors yet. Click New Contractor Invoice to create one."
              : (
                <>
                  No purchase invoices yet for {party}. Click{" "}
                  <span className="font-medium text-slate-600">
                    New {invoiceDefinition.singular}
                  </span>{" "}
                  here (or create one under Purchases with this party / company / contact name).
                </>
              )}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[12px]">
              <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2 font-medium">Reference</th>
                  {showAll ? <th className="px-4 py-2 font-medium">Party</th> : null}
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {inv.reference || inv.name || "Invoice"}
                    </td>
                    {showAll ? (
                      <td className="px-4 py-2.5 text-slate-600">
                        {inv.party || inv.supplier || "—"}
                      </td>
                    ) : null}
                    <td className="px-4 py-2.5 text-slate-600">{inv.date || "—"}</td>
                    <td className="px-4 py-2.5">{displayStatus(inv.status || "Draft")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-800">
                      {formatMoney(parseAmount(inv.amount || inv.total || "0"))}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => setInvoiceEditor({ mode: "view", record: inv })}
                        >
                          View
                        </Button>
                        {canEditInvoice ? (
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 bg-slate-900 px-2 text-[11px] text-white hover:bg-slate-800"
                            onClick={() => setInvoiceEditor({ mode: "edit", record: inv })}
                          >
                            Edit
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {invoiceEditor ? (
        <RecordEditor
          key={`contractor-invoice-${invoiceEditor.mode}-${invoiceEditor.record?.id ?? "new"}`}
          definition={invoiceDefinition}
          state={invoiceEditor}
          siblingRecords={contractorSiblingRecords}
          moduleSlug="purchases"
          onClose={() => setInvoiceEditor(null)}
          onCreate={(values) => {
            void persistInvoice("create", values);
          }}
          onUpdate={(id, values) => {
            void persistInvoice("edit", values, id);
          }}
          onEdit={
            canEditInvoice
              ? (record) => setInvoiceEditor({ mode: "edit", record })
              : undefined
          }
        />
      ) : null}
    </>
  );
}

function OralPaymentChainProgress({
  status,
  record,
}: {
  status: string;
  record?: Record<string, string | undefined | null> | null;
}) {
  const progress = oralChainProgress(status);
  return (
    <RequestChainTracker
      status={status}
      record={record}
      title="Oral payment chain"
      chainLabel={progress.chainLabel}
      steps={progress.steps}
    />
  );
}

function GenericRequisitionChainProgress({
  status,
  record,
  entityKey,
}: {
  status: string;
  record?: Record<string, string | undefined | null> | null;
  entityKey?: string;
}) {
  if (entityKey === "requisitions") {
    const path = pathFromRecord(record);
    const progress = materialRequestProgress(status, path);
    return (
      <RequestChainTracker
        status={status}
        record={record}
        title="Material request chain"
        chainLabel={progress.chainLabel}
        steps={progress.steps}
        stepDates={materialRequestStepDates(record, path)}
      />
    );
  }
  if (entityKey === "leave-requests") {
    const progress = leaveChainProgress(status);
    return (
      <RequestChainTracker
        status={status}
        record={record}
        title="Leave approval chain"
        chainLabel={progress.chainLabel}
        steps={progress.steps}
        stepDates={leaveChainStepDates(record)}
      />
    );
  }
  if (entityKey === "general-requests" || entityKey === "oral-payment-requests") {
    const progress = requisitionChainProgress(status, entityKey);
    return (
      <RequestChainTracker
        status={status}
        record={record}
        title={entityKey === "oral-payment-requests" ? "Oral payment chain" : "General request chain"}
        chainLabel={progress.chainLabel}
        steps={progress.steps}
        stepDates={requisitionChainStepDates(record)}
      />
    );
  }
  if (entityKey === "payroll-runs") {
    const progress = payrollRunChainProgress(status);
    return (
      <RequestChainTracker
        status={status}
        record={record}
        title="Payroll approval chain"
        chainLabel={progress.chainLabel}
        steps={progress.steps}
        stepDates={requisitionChainStepDates(record)}
      />
    );
  }
  if (
    entityKey === "fuel-requests" ||
    entityKey === "trip-requests" ||
    entityKey === "maintenance-requests"
  ) {
    const progress = requisitionChainProgress(status, entityKey);
    return (
      <RequestChainTracker
        status={status}
        record={record}
        title="Fleet request chain"
        chainLabel={progress.chainLabel}
        steps={progress.steps}
      />
    );
  }
  if (entityKey) {
    const progress = requisitionChainProgress(status, entityKey);
    return (
      <RequestChainTracker
        status={status}
        record={record}
        chainLabel={progress.chainLabel}
        steps={progress.steps}
      />
    );
  }
  return <RequestChainTracker status={status} record={record} />;
}

function GenericRequisitionChainActions({
  entityKey,
  record,
  onAdvance,
  onReject,
  onAmend,
  onConfirmAdvance,
}: {
  entityKey: string;
  record: ManagerRecord;
  onAdvance: (
    id: string,
    options?: {
      comment?: string;
      amount?: string;
      paymentMethod?: string;
      bankAccount?: string;
      forwardTo?: "ceo" | "finance";
    },
  ) => void | Promise<void>;
  onReject: (id: string) => void | Promise<void>;
  onAmend: (id: string, mode: AmendReturnMode) => void | Promise<void>;
  onConfirmAdvance: (
    label: string,
    message: string,
    run: (extras?: {
      comment?: string;
      amount?: string;
      paymentMethod?: string;
      bankAccount?: string;
      forwardTo?: "ceo" | "finance";
    }) => void,
    options?: {
      amountLabel?: string;
      amountValue?: string;
      amountCurrency?: string;
      commentLabel?: string;
      commentPlaceholder?: string;
      paymentMethodLabel?: string;
      paymentMethodValue?: string;
      bankAccountLabel?: string;
      bankAccountValue?: string;
    },
  ) => void;
}) {
  const role = getCurrentSessionUser()?.role || "";
  const gate = canAdvanceGenericRequisition(entityKey, record.status || "", role, record);
  const canReject = canRejectGenericRequisition(
    entityKey,
    record.status || "",
    role,
    record,
  );
  const isPayConfirm = gate.stage === "finance";
  const isGmForward = gate.ok && gate.stage === "gm";
  const canReturn =
    !isPayConfirm && canReturnRequestOneStep(record.status || "", role, entityKey);
  const canRecall =
    !isPayConfirm &&
    canRecallRequestToDraft(
      record.status || "",
      role,
      entityKey,
      record,
      getCurrentSessionUser(),
    );
  if (!gate.ok && !canReject && !canReturn && !canRecall) return null;
  const label = genericRequisitionAdvanceLabel(record.status || "", entityKey, record);
  const showAmount = !isPayConfirm && entitySupportsApprovalAmount(entityKey);
  const amountSeed =
    record.amount || record.estimatedCost || record.total || "";
  const amountConfirmOpts = {
    commentLabel: "Comment",
    commentPlaceholder: "Approval note for parties involved (optional)…",
    amountLabel: showAmount ? "Amount" : undefined,
    amountValue: showAmount ? amountSeed : undefined,
    amountCurrency: record.currency || "UGX",
  } as const;
  return (
    <>
      {canReject ? (
        <Button
          type="button"
          variant="outline"
          className="h-9 border-rose-200 text-rose-700 hover:bg-rose-50"
          onClick={() => onReject(record.id)}
        >
          Reject
        </Button>
      ) : null}
      {canReturn || canRecall ? (
        <Button
          type="button"
          variant="outline"
          className={
            /^(rejected|declined)$/i.test(record.status || "")
              ? "h-9 border-rose-200 bg-rose-700 text-white hover:bg-rose-800"
              : "h-9 border-amber-200 text-amber-800 hover:bg-amber-50"
          }
          onClick={() => onAmend(record.id, "previous")}
        >
          {/^(rejected|declined)$/i.test(record.status || "")
            ? "Redo request"
            : "Return for amendment"}
        </Button>
      ) : null}
      {isGmForward ? (
        <>
          <Button
            type="button"
            className="h-9 bg-amber-600 text-white hover:bg-amber-700"
            onClick={() =>
              onConfirmAdvance(
                "Forward to CEO",
                `Forward ${record.reference || "this request"} to the CEO for approval? Optional comment allowed.`,
                (extras) =>
                  onAdvance(record.id, { ...extras, forwardTo: "ceo" }),
                amountConfirmOpts,
              )
            }
          >
            Forward to CEO
          </Button>
          <Button
            type="button"
            className="h-9 bg-slate-800 text-white hover:bg-slate-700"
            onClick={() =>
              onConfirmAdvance(
                "Forward to Finance",
                `Skip CEO and send ${record.reference || "this request"} straight to Finance for payment? Optional comment allowed.`,
                (extras) =>
                  onAdvance(record.id, { ...extras, forwardTo: "finance" }),
                amountConfirmOpts,
              )
            }
          >
            Forward to Finance
          </Button>
        </>
      ) : gate.ok ? (
        <Button
          type="button"
          className={
            isPayConfirm
              ? "h-9 bg-slate-900 text-white hover:bg-slate-800"
              : "h-9 bg-amber-600 text-white hover:bg-amber-700"
          }
          onClick={() =>
            onConfirmAdvance(
              isPayConfirm ? "Make payment" : label,
              isPayConfirm
                ? `Make payment for ${record.reference || "this request"}? Choose payment method and the bank / cash account to pay from. CEO has approved — this cannot be edited or amended. Status becomes Paid.`
                : `${label} ${record.reference || "this request"}? Next status: ${gate.nextStatus}. Optional comment allowed. If you change the amount, this becomes a return for amendment (not an approval) — add a comment explaining the change.`,
              (extras) =>
                onAdvance(
                  record.id,
                  isPayConfirm
                    ? {
                        comment: extras?.comment,
                        paymentMethod: extras?.paymentMethod,
                        bankAccount: extras?.bankAccount,
                      }
                    : extras,
                ),
              isPayConfirm
                ? {
                    commentLabel: "Payment note (optional)",
                    commentPlaceholder: "Optional note for the payment record…",
                    paymentMethodLabel: "Payment method",
                    paymentMethodValue: record.paymentMethod || "",
                    bankAccountLabel: "Paid from (bank / cash)",
                    bankAccountValue: record.bankAccount || record.paidFrom || "",
                  }
                : amountConfirmOpts,
            )
          }
        >
          {isPayConfirm ? "Make payment" : label}
        </Button>
      ) : null}
    </>
  );
}

function OralPaymentChainActions({
  record,
  onAdvance,
  onReject,
  onAmend,
  onConfirmAdvance,
}: {
  record: ManagerRecord;
  onAdvance: (
    id: string,
    options?: {
      comment?: string;
      amount?: string;
      paymentMethod?: string;
      bankAccount?: string;
      forwardTo?: "ceo" | "finance";
    },
  ) => void | Promise<void>;
  onReject: (id: string) => void | Promise<void>;
  onAmend: (id: string, mode: AmendReturnMode) => void | Promise<void>;
  onConfirmAdvance: (
    label: string,
    message: string,
    run: (extras?: {
      comment?: string;
      amount?: string;
      paymentMethod?: string;
      bankAccount?: string;
      forwardTo?: "ceo" | "finance";
    }) => void,
    options?: {
      amountLabel?: string;
      amountValue?: string;
      amountCurrency?: string;
      commentLabel?: string;
      commentPlaceholder?: string;
      paymentMethodLabel?: string;
      paymentMethodValue?: string;
      bankAccountLabel?: string;
      bankAccountValue?: string;
    },
  ) => void;
}) {
  const role = getCurrentSessionUser()?.role || "";
  const gate = canAdvanceOralPaymentRequest(record.status || "", role);
  const canReject = canRejectOralPaymentRequest(record.status || "", role);
  const isPayConfirm = gate.stage === "finance";
  const isGmForward = gate.ok && gate.stage === "gm";
  const canReturn =
    !isPayConfirm &&
    canReturnRequestOneStep(record.status || "", role, "oral-payment-requests");
  const canRecall =
    !isPayConfirm &&
    canRecallRequestToDraft(
      record.status || "",
      role,
      "oral-payment-requests",
      record,
      getCurrentSessionUser(),
    );
  if (!gate.ok && !canReject && !canReturn && !canRecall) return null;
  const label = oralAdvanceActionLabel(record.status || "");
  const amountSeed = record.amount || "";
  const amountConfirmOpts = {
    commentLabel: "Comment",
    commentPlaceholder: "Approval note for parties involved (optional)…",
    amountLabel: "Amount",
    amountValue: amountSeed,
    amountCurrency: record.currency || "UGX",
  } as const;
  return (
    <>
      {canReject ? (
        <Button
          type="button"
          variant="outline"
          className="h-9 border-rose-200 text-rose-700 hover:bg-rose-50"
          onClick={() => onReject(record.id)}
        >
          Reject
        </Button>
      ) : null}
      {canReturn || canRecall ? (
        <Button
          type="button"
          variant="outline"
          className={
            /^(rejected|declined)$/i.test(record.status || "")
              ? "h-9 border-rose-200 bg-rose-700 text-white hover:bg-rose-800"
              : "h-9 border-amber-200 text-amber-800 hover:bg-amber-50"
          }
          onClick={() => onAmend(record.id, "previous")}
        >
          {/^(rejected|declined)$/i.test(record.status || "")
            ? "Redo request"
            : "Return for amendment"}
        </Button>
      ) : null}
      {isGmForward ? (
        <>
          <Button
            type="button"
            className="h-9 bg-amber-600 text-white hover:bg-amber-700"
            onClick={() =>
              onConfirmAdvance(
                "Forward to CEO",
                `Forward ${record.reference || "this oral payment request"} to the CEO for approval? Optional comment allowed.`,
                (extras) =>
                  onAdvance(record.id, { ...extras, forwardTo: "ceo" }),
                amountConfirmOpts,
              )
            }
          >
            Forward to CEO
          </Button>
          <Button
            type="button"
            className="h-9 bg-slate-800 text-white hover:bg-slate-700"
            onClick={() =>
              onConfirmAdvance(
                "Forward to Finance",
                `Skip CEO and send ${record.reference || "this oral payment request"} straight to Finance for payment? Optional comment allowed.`,
                (extras) =>
                  onAdvance(record.id, { ...extras, forwardTo: "finance" }),
                amountConfirmOpts,
              )
            }
          >
            Forward to Finance
          </Button>
        </>
      ) : gate.ok ? (
        <Button
          type="button"
          className={
            isPayConfirm
              ? "h-9 bg-slate-900 text-white hover:bg-slate-800"
              : "h-9 bg-amber-600 text-white hover:bg-amber-700"
          }
          onClick={() =>
            onConfirmAdvance(
              isPayConfirm ? "Make payment" : label,
              isPayConfirm
                ? `Make payment for ${record.reference || "this oral payment request"}? Choose payment method and the bank / cash account to pay from. CEO has approved — this cannot be edited or amended. Status becomes Paid.`
                : `${label} ${record.reference || "this oral payment request"}? Next status: ${gate.nextStatus}. Adjust the amount if needed and add an optional comment.`,
              (extras) =>
                onAdvance(
                  record.id,
                  isPayConfirm
                    ? {
                        comment: extras?.comment,
                        paymentMethod: extras?.paymentMethod,
                        bankAccount: extras?.bankAccount,
                      }
                    : extras,
                ),
              isPayConfirm
                ? {
                    commentLabel: "Payment note (optional)",
                    commentPlaceholder: "Optional note for the payment record…",
                    paymentMethodLabel: "Payment method",
                    paymentMethodValue: record.paymentMethod || "",
                    bankAccountLabel: "Paid from (bank / cash)",
                    bankAccountValue: record.bankAccount || record.paidFrom || "",
                  }
                : amountConfirmOpts,
            )
          }
        >
          {isPayConfirm ? "Make payment" : label}
        </Button>
      ) : null}
    </>
  );
}

function PayrollRunChainActions({
  record,
  onAdvance,
  onReject,
  onAmend,
  onConfirmAdvance,
}: {
  record: ManagerRecord;
  onAdvance: (
    id: string,
    options?: { comment?: string; amount?: string; forwardTo?: "ceo" | "finance" },
  ) => void | Promise<void>;
  onReject: (id: string) => void | Promise<void>;
  onAmend: (id: string, mode: AmendReturnMode) => void | Promise<void>;
  onConfirmAdvance: (
    label: string,
    message: string,
    run: (extras?: {
      comment?: string;
      amount?: string;
      forwardTo?: "ceo" | "finance";
    }) => void,
    options?: {
      amountLabel?: string;
      amountValue?: string;
      amountCurrency?: string;
      commentLabel?: string;
      commentPlaceholder?: string;
    },
  ) => void;
}) {
  const role = getCurrentSessionUser()?.role || "";
  const gate = canAdvancePayrollRun(record.status || "", role);
  const canReject = canRejectPayrollRun(record.status || "", role);
  const isRelease = gate.stage === "finance";
  const isGmForward = gate.ok && gate.stage === "gm";
  const canReturn =
    !isRelease &&
    canReturnRequestOneStep(record.status || "", role, "payroll-runs");
  const canRecall =
    !isRelease &&
    canRecallRequestToDraft(
      record.status || "",
      role,
      "payroll-runs",
      record,
      getCurrentSessionUser(),
    );
  if (!gate.ok && !canReject && !canReturn && !canRecall) return null;
  const label = payrollRunAdvanceActionLabel(record.status || "");
  const amountConfirmOpts = {
    commentLabel: "Comment",
    commentPlaceholder: "Approval note for parties involved (optional)…",
    amountLabel: "Net pay total",
    amountValue: record.amount || "",
    amountCurrency: record.currency || "UGX",
  } as const;
  return (
    <>
      {canReject ? (
        <Button
          type="button"
          variant="outline"
          className="h-9 border-rose-200 text-rose-700 hover:bg-rose-50"
          onClick={() => onReject(record.id)}
        >
          Reject
        </Button>
      ) : null}
      {canReturn || canRecall ? (
        <Button
          type="button"
          variant="outline"
          className={
            /^(rejected|declined)$/i.test(record.status || "")
              ? "h-9 border-rose-200 bg-rose-700 text-white hover:bg-rose-800"
              : "h-9 border-amber-200 text-amber-800 hover:bg-amber-50"
          }
          onClick={() => onAmend(record.id, "previous")}
        >
          {/^(rejected|declined)$/i.test(record.status || "")
            ? "Redo request"
            : "Return for amendment"}
        </Button>
      ) : null}
      {isGmForward ? (
        <>
          <Button
            type="button"
            className="h-9 bg-amber-600 text-white hover:bg-amber-700"
            onClick={() =>
              onConfirmAdvance(
                "Forward to CEO",
                `Forward payroll ${record.reference || "this run"} to the CEO for approval? Optional comment allowed.`,
                (extras) =>
                  onAdvance(record.id, { ...extras, forwardTo: "ceo" }),
                amountConfirmOpts,
              )
            }
          >
            Forward to CEO
          </Button>
          <Button
            type="button"
            className="h-9 bg-slate-800 text-white hover:bg-slate-700"
            onClick={() =>
              onConfirmAdvance(
                "Forward to Finance",
                `Skip CEO and send payroll ${record.reference || "this run"} straight to Finance for release? Optional comment allowed.`,
                (extras) =>
                  onAdvance(record.id, { ...extras, forwardTo: "finance" }),
                amountConfirmOpts,
              )
            }
          >
            Forward to Finance
          </Button>
        </>
      ) : gate.ok ? (
        <Button
          type="button"
          className={
            isRelease
              ? "h-9 bg-slate-900 text-white hover:bg-slate-800"
              : "h-9 bg-amber-600 text-white hover:bg-amber-700"
          }
          onClick={() =>
            onConfirmAdvance(
              isRelease ? "Release payroll" : label,
              isRelease
                ? `Release payroll ${record.reference || "this run"}? CEO has approved — this creates Unpaid payslips and posts wage accrual to the ledger.`
                : `${label} ${record.reference || "this payroll run"}? Next status: ${gate.nextStatus}. Optional comment allowed.`,
              (extras) => onAdvance(record.id, extras),
              isRelease
                ? {
                    commentLabel: "Release note (optional)",
                    commentPlaceholder: "Optional note for the payroll release…",
                  }
                : amountConfirmOpts,
            )
          }
        >
          {isRelease ? "Release payroll" : label}
        </Button>
      ) : null}
    </>
  );
}

function PaymentRequestChainActions({
  record,
  onAdvance,
  onReject,
  onAmend,
  onConfirmAdvance,
}: {
  record: ManagerRecord;
  onAdvance: (
    id: string,
    options?: {
      comment?: string;
      amount?: string;
      paymentMethod?: string;
      bankAccount?: string;
      forwardTo?: "ceo" | "finance";
    },
  ) => void | Promise<void>;
  onReject: (id: string) => void | Promise<void>;
  onAmend: (id: string, mode: AmendReturnMode) => void | Promise<void>;
  onConfirmAdvance: (
    label: string,
    message: string,
    run: (extras?: {
      comment?: string;
      amount?: string;
      paymentMethod?: string;
      bankAccount?: string;
      forwardTo?: "ceo" | "finance";
    }) => void,
    options?: {
      amountLabel?: string;
      amountValue?: string;
      amountCurrency?: string;
      commentLabel?: string;
      commentPlaceholder?: string;
      paymentMethodLabel?: string;
      paymentMethodValue?: string;
      bankAccountLabel?: string;
      bankAccountValue?: string;
    },
  ) => void;
}) {
  const role = getCurrentSessionUser()?.role || "";
  const gate = canAdvancePaymentRequest(record.status || "", role);
  const canReject = canRejectPaymentRequest(record.status || "", role);
  const isPayConfirm = gate.stage === "finance";
  const isGmForward = gate.ok && gate.stage === "gm";
  const canReturn =
    !isPayConfirm &&
    canReturnRequestOneStep(record.status || "", role, "payment-requests");
  const canRecall =
    !isPayConfirm &&
    canRecallRequestToDraft(
      record.status || "",
      role,
      "payment-requests",
      record,
      getCurrentSessionUser(),
    );
  if (!gate.ok && !canReject && !canReturn && !canRecall) return null;
  const label = advanceActionLabel(record.status || "");
  const amountSeed = record.amount || "";
  const amountConfirmOpts = {
    commentLabel: "Comment",
    commentPlaceholder: "Approval note for parties involved (optional)…",
    amountLabel: "Amount",
    amountValue: amountSeed,
    amountCurrency: record.currency || "UGX",
  } as const;
  return (
    <>
      {canReject ? (
        <Button
          type="button"
          variant="outline"
          className="h-9 border-rose-200 text-rose-700 hover:bg-rose-50"
          onClick={() => onReject(record.id)}
        >
          Reject
        </Button>
      ) : null}
      {canReturn || canRecall ? (
        <Button
          type="button"
          variant="outline"
          className={
            /^(rejected|declined)$/i.test(record.status || "")
              ? "h-9 border-rose-200 bg-rose-700 text-white hover:bg-rose-800"
              : "h-9 border-amber-200 text-amber-800 hover:bg-amber-50"
          }
          onClick={() => onAmend(record.id, "previous")}
        >
          {/^(rejected|declined)$/i.test(record.status || "")
            ? "Redo request"
            : "Return for amendment"}
        </Button>
      ) : null}
      {isGmForward ? (
        <>
          <Button
            type="button"
            className="h-9 bg-amber-600 text-white hover:bg-amber-700"
            onClick={() =>
              onConfirmAdvance(
                "Forward to CEO",
                `Forward ${record.reference || "this payment request"} to the CEO for approval? Optional comment allowed.`,
                (extras) =>
                  onAdvance(record.id, { ...extras, forwardTo: "ceo" }),
                amountConfirmOpts,
              )
            }
          >
            Forward to CEO
          </Button>
          <Button
            type="button"
            className="h-9 bg-slate-800 text-white hover:bg-slate-700"
            onClick={() =>
              onConfirmAdvance(
                "Forward to Finance",
                `Skip CEO and send ${record.reference || "this payment request"} straight to Finance for payment? Optional comment allowed.`,
                (extras) =>
                  onAdvance(record.id, { ...extras, forwardTo: "finance" }),
                amountConfirmOpts,
              )
            }
          >
            Forward to Finance
          </Button>
        </>
      ) : gate.ok ? (
        <Button
          type="button"
          className={
            isPayConfirm
              ? "h-9 bg-slate-900 text-white hover:bg-slate-800"
              : "h-9 bg-amber-600 text-white hover:bg-amber-700"
          }
          onClick={() =>
            onConfirmAdvance(
              isPayConfirm ? "Make payment" : label,
              isPayConfirm
                ? `Make payment for ${record.reference || "this request"}? Choose payment method and the bank / cash account to pay from. CEO has approved — this cannot be edited or amended. Status becomes Paid.`
                : `${label} ${record.reference || "this payment request"}? Next status: ${gate.nextStatus}. Adjust the amount if needed and add an optional comment.`,
              (extras) =>
                onAdvance(
                  record.id,
                  isPayConfirm
                    ? {
                        comment: extras?.comment,
                        paymentMethod: extras?.paymentMethod,
                        bankAccount: extras?.bankAccount,
                      }
                    : extras,
                ),
              isPayConfirm
                ? {
                    commentLabel: "Payment note (optional)",
                    commentPlaceholder: "Optional note for the payment record…",
                    paymentMethodLabel: "Payment method",
                    paymentMethodValue: record.paymentMethod || "",
                    bankAccountLabel: "Paid from (bank / cash)",
                    bankAccountValue: record.bankAccount || record.paidFrom || "",
                  }
                : amountConfirmOpts,
            )
          }
        >
          {isPayConfirm ? "Make payment" : label}
        </Button>
      ) : null}
    </>
  );
}

function displayStatus(value: string) {
  const lower = value.toLowerCase();
  const positive = ["active", "paid", "complete", "approved", "reconciled", "ready"].includes(
    lower,
  );
  const negative = /^(rejected|declined|void|voided|cancelled|canceled)$/i.test(value);
  const amendmentReturn =
    /^(returned for amendment|amendment required|needs amendment)$/i.test(value);
  const amendmentDraft = /^draft$/i.test(value);
  return (
    <Badge
      variant="secondary"
      className={
        positive
          ? "bg-emerald-50 font-normal text-emerald-700"
          : negative
            ? "bg-rose-50 font-normal text-rose-700"
            : amendmentReturn
              ? "bg-amber-50 font-normal text-amber-800"
              : amendmentDraft
                ? "bg-slate-100 font-normal text-slate-700"
                : "bg-amber-50 font-normal text-amber-700"
      }
    >
      {positive && <TickCircle size={11} variant="Bold" color="currentColor" />}
      {value}
    </Badge>
  );
}

function RecordEditor({
  definition,
  state,
  onClose,
  onCreate,
  onUpdate,
  onSaveDraft,
  onEdit,
  onPay,
  onApprove,
  onReceiveTransfer,
  onFulfillFuel,
  onCompleteTrip,
  siblingRecords = [],
  moduleSlug,
}: {
  definition: EntityDefinition;
  state: EditorState;
  onClose: () => void;
  onCreate: (values: Record<string, string>) => void;
  onUpdate: (id: string, values: Record<string, string>) => void;
  onSaveDraft?: (values: Record<string, string>) => void | Promise<void>;
  onEdit?: (record: ManagerRecord) => void;
  onPay?: (record: ManagerRecord) => void;
  onApprove?: (record: ManagerRecord) => void;
  onReceiveTransfer?: (record: ManagerRecord) => void;
  onFulfillFuel?: (record: ManagerRecord) => void;
  onCompleteTrip?: (record: ManagerRecord) => void;
  siblingRecords?: ManagerRecord[];
  moduleSlug?: string;
}) {
  const readOnly = state?.mode === "view";
  if (readOnly && state?.record) {
    const viewed = state.record;
    const side = invoicePaymentSide(definition.key);
    const canPay =
      Boolean(onPay) &&
      Boolean(side) &&
      !/draft|void|voided|cancelled|canceled|paid/i.test(viewed.status || "") &&
      documentOpenBalance(viewed, side!) > 0;
    const canApproveHere =
      Boolean(onApprove) && isPendingApprovalStatus(viewed.status);
    const canReceiveHere =
      Boolean(onReceiveTransfer) &&
      definition.key === "inventory-transfers" &&
      transferAwaitingReceipt(viewed);
    const canFulfillFuel =
      Boolean(onFulfillFuel) &&
      definition.key === "fuel-requests" &&
      fuelRequestAwaitingFulfillment(viewed);
    const canCompleteTrip =
      Boolean(onCompleteTrip) &&
      definition.key === "trip-requests" &&
      tripAwaitingCompletion(viewed);
    return (
      <RecordViewModal
        definition={definition}
        record={viewed}
        onClose={onClose}
        onEdit={onEdit ? () => onEdit(viewed) : undefined}
        onPay={canPay ? () => onPay!(viewed) : undefined}
        onApprove={canApproveHere ? () => onApprove!(viewed) : undefined}
        onReceiveTransfer={canReceiveHere ? () => onReceiveTransfer!(viewed) : undefined}
        onFulfillFuel={canFulfillFuel ? () => onFulfillFuel!(viewed) : undefined}
        onCompleteTrip={canCompleteTrip ? () => onCompleteTrip!(viewed) : undefined}
      />
    );
  }

  return (
    <RecordFormModal
      definition={definition}
      state={state}
      onClose={onClose}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onSaveDraft={onSaveDraft}
      siblingRecords={siblingRecords}
      moduleSlug={moduleSlug}
    />
  );
}

function RecordViewModal({
  definition,
  record,
  onClose,
  onEdit,
  onPay,
  onApprove,
  onReceiveTransfer,
  onFulfillFuel,
  onCompleteTrip,
}: {
  definition: EntityDefinition;
  record: ManagerRecord;
  onClose: () => void;
  onEdit?: () => void;
  onPay?: () => void;
  onApprove?: () => void;
  onReceiveTransfer?: () => void;
  onFulfillFuel?: () => void;
  onCompleteTrip?: () => void;
}) {
  const { feedback, close, showSuccess, showWarning } = useFeedbackModals();
  const title =
    record.name ||
    record.reference ||
    record.code ||
    definition.singular;

  const rows = definition.fields
    .filter((field) => field.key !== "balance" && field.key !== "snapshot")
    .filter((field) => {
      // Hide empty desk-feedback fields on the view panel.
      if (!field.readOnly) return true;
      return Boolean((record[field.key] ?? "").trim());
    })
    .map((field) => {
      const raw = (record[field.key] ?? "").trim();
      let value = formatFieldValue(field, record[field.key] ?? "", record);
      const label = field.label;
      if ((field.key === "currency" || field.key === "currencyCode") && raw) {
        const match = currencySelectOptions().find(
          (o) => o.code === raw.toUpperCase() || o.value === raw.toUpperCase(),
        );
        if (match) value = match.label;
      }
      if (definition.key === "suppliers" && field.key === "openingBalances") {
        const parts = openingBalanceRows(raw)
          .filter((row) => parseAmount(row.amount) > 0)
          .map((row) => `${row.code} ${formatMoney(parseAmount(row.amount))}`);
        value = parts.length ? parts.join(" · ") : "";
      }
      if (
        (definition.key === "inventory-items" || definition.key === "pos-products") &&
        field.key === "openingStock"
      ) {
        const levels = inventoryStockLevels(record);
        value = String(levels.opening);
      }
      if (
        (definition.key === "inventory-items" || definition.key === "pos-products") &&
        field.key === "unitValue"
      ) {
        const unit =
          record.unitValue ||
          record.purchasePrice ||
          record.unitCost ||
          record.averageCost ||
          "";
        value = unit ? formatMoney(parseAmount(unit)) : "";
      }
      if (
        (definition.key === "inventory-items" || definition.key === "pos-products") &&
        field.key === "stockValue"
      ) {
        const levels = inventoryStockLevels(record);
        const unit = parseAmount(
          record.unitValue ||
            record.purchasePrice ||
            record.unitCost ||
            record.averageCost ||
            "0",
        );
        const stock =
          parseAmount(record.stockValue || record.inventoryValue) ||
          roundMoney(levels.opening * unit);
        value = stock ? formatMoney(stock) : formatMoney(0);
      }
      if (
        (definition.key === "inventory-items" || definition.key === "pos-products") &&
        field.key === "closingStock"
      ) {
        value = String(inventoryStockLevels(record).closing);
      }
      if (
        (definition.key === "inventory-items" || definition.key === "pos-products") &&
        field.key === "closingValue"
      ) {
        const levels = inventoryStockLevels(record);
        const unit = parseAmount(
          record.averageCost ||
            record.unitValue ||
            record.purchasePrice ||
            record.unitCost ||
            "0",
        );
        const closing =
          parseAmount(record.inventoryValue) || roundMoney(levels.closing * unit);
        value = formatMoney(closing);
      }
      return {
        key: field.key,
        label,
        value,
        raw:
          (definition.key === "inventory-items" || definition.key === "pos-products") &&
          (field.key === "openingStock" ||
            field.key === "unitValue" ||
            field.key === "stockValue" ||
            field.key === "closingStock" ||
            field.key === "closingValue")
            ? "1"
            : raw,
      };
    })
    .filter((row) => row.raw || ["status", "currency", "type", "kind"].includes(row.key));

  if (definition.key === "deleted-records") {
    const shown = new Set(rows.map((row) => row.key));
    for (const [key, value] of Object.entries(record)) {
      if (DELETED_RECORD_META_KEYS.has(key) || shown.has(key)) continue;
      if (key === "snapshot") continue;
      const raw = String(value ?? "").trim();
      if (!raw) continue;
      if (raw.startsWith("{") || raw.startsWith("[")) continue;
      rows.push({
        key,
        label: humanizeFieldKey(key),
        value: raw,
        raw,
      });
      shown.add(key);
    }
  }

  const showLiveBalance =
    definition.key === "bank-and-cash-accounts" ||
    definition.key === "customers" ||
    definition.key === "suppliers" ||
    definition.key === "chart-of-accounts";
  const liveBalance = showLiveBalance ? record.balance : "";
  const partyCurrency = normalizeCurrency(record.currency || record.currencyCode);
  const balanceBase = parseAmount(liveBalance);
  const showDualBalance =
    Boolean(liveBalance) &&
    (definition.key === "customers" || definition.key === "suppliers") &&
    !isBaseCurrency(partyCurrency) &&
    Boolean(balanceBase);

  return (
    <>
    <FeedbackModals feedback={feedback} onClose={close} />
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <div className="border-b border-slate-100 px-5 py-4">
          <DialogHeader className="gap-1 pr-8">
            <DialogTitle className="text-[16px] font-semibold text-slate-900">
              {title}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-slate-500">
              {definition.singular} details
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[min(60dvh,28rem)] overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {rows.map((row) => (
              <div
                key={row.key}
                className={
                  row.key === "description" ||
                  row.key === "address" ||
                  row.key === "narration" ||
                  row.key === "evidenceNotes" ||
                  row.key === "attachments" ||
                  row.key === "acceptance"
                    ? "sm:col-span-2"
                    : undefined
                }
              >
                <dt className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                  {row.label}
                </dt>
                <dd className="mt-1 text-[13px] font-medium break-words text-slate-800">
                  {row.key === "status" ? (
                    displayStatus(row.raw || "—")
                  ) : row.key === "attachments" ? (
                    <RecordAttachmentsView raw={row.raw} />
                  ) : (
                    row.value || "—"
                  )}
                </dd>
              </div>
            ))}
            {liveBalance !== undefined && liveBalance !== "" && (
              <div className="sm:col-span-2">
                <dt className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                  Current balance
                </dt>
                <dd className="mt-1.5">
                  {showDualBalance ? (
                    <DualMoney
                      amount={balanceBase}
                      currency={partyCurrency}
                      amountIsBase
                    />
                  ) : (
                    <p className="text-[13px] font-semibold tabular-nums text-slate-900">
                      {formatMoney(balanceBase)}
                    </p>
                  )}
                </dd>
              </div>
            )}
          </dl>

          <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            Created {new Date(record.createdAt).toLocaleString()}
            <span className="mx-1.5 text-slate-300">·</span>
            Updated {new Date(record.updatedAt).toLocaleString()}
          </div>
          {isPendingApprovalStatus(record.status) ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              Awaiting approval — this document is not on the ledger or reports until approved.
            </div>
          ) : null}
          {definition.key === "inventory-transfers" && transferAwaitingReceipt(record) ? (
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[12px] text-sky-950">
              In transit — stock left{" "}
              <span className="font-medium">{record.from || "source"}</span> and is waiting to be
              received into{" "}
              <span className="font-medium">{record.to || "destination warehouse"}</span>.
            </div>
          ) : null}
          {definition.key === "inventory-transfers" &&
          /^(received|complete|completed)$/i.test(record.status || "") ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-950">
              Received into{" "}
              <span className="font-medium">{record.to || "destination warehouse"}</span>
              {record.receivedDate ? ` on ${record.receivedDate}` : ""}
              {record.receivedBy ? ` by ${record.receivedBy}` : ""}.
            </div>
          ) : null}
          {definition.key === "contractors" ? (
            <div className="mt-4">
              <ContractorInvoicesSection contractor={record} />
            </div>
          ) : null}
        </div>

        <DialogFooter className="mx-0 mb-0 gap-2 border-t border-slate-100 bg-slate-50/80 p-3 sm:justify-between">
          <DocumentExportActions
            entityKey={definition.key}
            entityLabel={definition.label}
            record={record}
            onInfo={showSuccess}
            onError={showWarning}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="h-9 px-4" onClick={onClose}>
              Close
            </Button>
            {onApprove && (
              <Button
                type="button"
                className="h-9 bg-amber-600 px-4 text-white hover:bg-amber-700"
                onClick={onApprove}
              >
                Approve
              </Button>
            )}
            {onReceiveTransfer && (
              <Button
                type="button"
                className="h-9 bg-sky-700 px-4 text-white hover:bg-sky-800"
                onClick={onReceiveTransfer}
              >
                Receive into warehouse
              </Button>
            )}
            {onFulfillFuel && (
              <Button
                type="button"
                className="h-9 bg-emerald-700 px-4 text-white hover:bg-emerald-800"
                onClick={onFulfillFuel}
              >
                Fulfill → fuel log
              </Button>
            )}
            {onCompleteTrip && (
              <Button
                type="button"
                className="h-9 bg-sky-700 px-4 text-white hover:bg-sky-800"
                onClick={onCompleteTrip}
              >
                Complete trip
              </Button>
            )}
            {onPay && (
              <Button
                type="button"
                className="h-9 bg-emerald-600 px-4 text-white hover:bg-emerald-700"
                onClick={onPay}
              >
                {RECEIVABLE_INVOICE_KEYS.has(definition.key)
                  ? "Receive payment"
                  : "Pay bill"}
              </Button>
            )}
            {onEdit && (
              <Button
                type="button"
                className="h-9 bg-slate-900 px-4 text-white hover:bg-slate-800"
                onClick={onEdit}
              >
                Edit
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

const SAVE_AS_DRAFT_FLAG = "_saveAsDraft";

/** Forms where parking a separate draft (outside entity_records) makes sense. */
/**
 * MES collections save straight to the service and have no draft store — the
 * legacy /api/drafts route 404s here. Offering "Save as draft" also put a
 * "Draft" option at the top of every status select, selected by default; on a
 * job card that moved the work order back to MES's `draft`.
 */
const MES_MAINTENANCE_ENTITIES = new Set([
  "work-centers",
  "work-orders",
  "batch-records",
  "pm-templates",
  "pm-schedules",
  "downtime-logs",
  "spare-parts",
  "reliability",
  "alerts",
  "recommendations",
  "energy",
  "machine-performance",
  "plants",
  "sections",
]);

function supportsSaveAsDraft(entityKey: string) {
  return (
    entityKey !== "reconciliations" &&
    entityKey !== "chart-of-accounts" &&
    !MES_MAINTENANCE_ENTITIES.has(entityKey)
  );
}

function RecordFormModal({
  definition,
  state,
  onClose,
  onCreate,
  onUpdate,
  onSaveDraft,
  siblingRecords = [],
  moduleSlug,
}: {
  definition: EntityDefinition;
  state: EditorState;
  onClose: () => void;
  onCreate: (values: Record<string, string>) => void;
  onUpdate: (id: string, values: Record<string, string>) => void;
  onSaveDraft?: (values: Record<string, string>) => void | Promise<void>;
  siblingRecords?: ManagerRecord[];
  moduleSlug?: string;
}) {
  const { feedback, close: closeFeedback, showWarning, askConfirm } = useFeedbackModals();
  const formRef = useRef<HTMLFormElement>(null);
  const saveAsDraftRef = useRef(false);
  const allowSaveAsDraft = supportsSaveAsDraft(definition.key) && Boolean(onSaveDraft);
  const readOnly = false;
  const useDocLines = supportsDocumentLines(definition.key);
  const useJournalLines = supportsJournalLines(definition.key);
  const isMaterialRequest = definition.key === "requisitions";
  const isContractorScopedCreate =
    definition.key === "requisitions" || definition.key === "payment-requests";
  const isCoa = definition.key === "chart-of-accounts";
  const isLocationEntityForm =
    definition.key === "inventory-locations" || definition.key === "pos-locations";
  const isPosLocationEntity = definition.key === "pos-locations";
  const [docLines, setDocLines] = useState(() => documentLinesFromRecord(state?.record));
  const [journalLines, setJournalLines] = useState(() => journalLinesFromRecord(state?.record));
  const [materialRequestLines, setMaterialRequestLines] = useState(() =>
    isMaterialRequest ? materialRequestLinesFromRecord(state?.record) : [],
  );
  const [neededByValue, setNeededByValue] = useState(() => {
    if (!isMaterialRequest) return "";
    if (state?.record?.neededBy) return state.record.neededBy;
    if (state?.mode === "create") return new Date().toISOString().slice(0, 10);
    return "";
  });
  const [coaKind, setCoaKind] = useState(() => state?.record?.kind || "Account");
  const [entityLocationKind, setEntityLocationKind] = useState<LocationKind>(() => {
    const seed = (state?.record?.kind || state?.record?.type || "").trim() as LocationKind;
    if (seed) return seed;
    return definition.key === "pos-locations" ? "store" : "warehouse";
  });
  const [taxRate, setTaxRate] = useState(() => parseAmount(state?.record?.tax));
  const [taxLabel, setTaxLabel] = useState(() => state?.record?.taxCode || "");
  const [partyValue, setPartyValue] = useState(
    () =>
      state?.record?.party ||
      state?.record?.customer ||
      state?.record?.supplier ||
      state?.record?.payee ||
      "",
  );
  const [partyCreate, setPartyCreate] = useState<{
    side: "receivable" | "payable" | "both";
    addLabel: string;
    initialName?: string;
  } | null>(null);
  const [currencyValue, setCurrencyValue] = useState(() =>
    (
      state?.record?.currency ||
      state?.record?.currencyCode ||
      loadManagerSettings().baseCurrencyCode ||
      "UGX"
    ).toUpperCase(),
  );
  const [divisionValue, setDivisionValue] = useState(
    () => state?.record?.division || state?.record?.costCenter || "",
  );
  const [referenceValue, setReferenceValue] = useState(() => {
    if (state?.mode === "edit") return state.record?.reference || "";
    const hasReference = definition.fields.some((f) => f.key === "reference");
    if (!hasReference) return "";
    return nextDocumentReference(definition.key, siblingRecords, definition.label);
  });
  const [codeValue, setCodeValue] = useState(() => {
    if (state?.mode === "edit") return state.record?.code || "";
    if (!isAutoCodedEntity(definition.key)) return state?.record?.code || "";
    return nextEntityCode(definition.key, siblingRecords, definition.label);
  });
  const [accountPickers, setAccountPickers] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const field of definition.fields) {
      if (
        (definition.key === "employees" || definition.key === "payslips") &&
        (field.key === "bankAccount" || field.key === "bankCode")
      ) {
        continue;
      }
      if (field.key === "department" || field.key === "driver") {
        continue;
      }
      if (!usesCoaPicker(definition.key, field.key, field.label)) continue;
      let seed = state?.record?.[field.key] || "";
      if (
        definition.key === "fuel-logs" &&
        field.key === "bankAccount" &&
        !seed
      ) {
        seed = state?.record?.paidFrom || "";
      }
      init[field.key] = seed;
    }
    return init;
  });
  const [itemPickers, setItemPickers] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const field of definition.fields) {
      if (!isInventoryItemPickerField(field.key, field.label)) continue;
      init[field.key] = state?.record?.[field.key] || "";
    }
    return init;
  });
  const [locationPickers, setLocationPickers] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const field of definition.fields) {
      if (!usesWarehouseLocationPicker(definition.key, field.key, field.label)) continue;
      init[field.key] = state?.record?.[field.key] || "";
    }
    return init;
  });
  const [locationEditor, setLocationEditor] = useState<{
    fieldKey: string;
    mode: "create" | "edit";
    originalName: string;
  } | null>(null);
  const [newLocationKind, setNewLocationKind] = useState<LocationKind>("warehouse");
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationCode, setNewLocationCode] = useState("");
  const [newLocationAddress, setNewLocationAddress] = useState("");
  const [newLocationError, setNewLocationError] = useState("");
  const locationPickerIsPos = usesPosLocationPicker(definition.key);
  const [openingStockValue, setOpeningStockValue] = useState(
    () => state?.record?.openingStock || state?.record?.quantity || "",
  );
  const [itemUnitValue, setItemUnitValue] = useState(
    () =>
      state?.record?.unitValue ||
      state?.record?.purchasePrice ||
      state?.record?.unitCost ||
      state?.record?.averageCost ||
      "",
  );
  const [inventoryQtyValue, setInventoryQtyValue] = useState(
    () => state?.record?.quantity || "",
  );
  const [inventoryUnitCostValue, setInventoryUnitCostValue] = useState(
    () => state?.record?.unitCost || "",
  );
  const [inventoryUnitPriceValue, setInventoryUnitPriceValue] = useState(
    () => state?.record?.unitPrice || "",
  );
  const [employeeBank, setEmployeeBank] = useState(() => state?.record?.bankAccount || "");
  const [employeeBankCode, setEmployeeBankCode] = useState(
    () => state?.record?.bankCode || bankCodeForName(state?.record?.bankAccount || "") || "",
  );
  const [employeeDepartment, setEmployeeDepartment] = useState(
    () => state?.record?.department || "",
  );
  const [supplierCategory, setSupplierCategory] = useState(
    () => state?.record?.category || "",
  );
  const [driverValue, setDriverValue] = useState(() => state?.record?.driver || "");
  const [contractorValue, setContractorValue] = useState(() => {
    if (state?.record?.contractor) return state.record.contractor;
    if (isContractorScopedCreate && state?.mode === "create") {
      const kind = currentProjectScopeKind();
      if (kind === "contractor") {
        const directory = currentProjectDirectoryRow(kind);
        return directory?.company || directory?.name || getCurrentSessionUser()?.name || "";
      }
      return getCurrentSessionUser()?.name || "";
    }
    return "";
  });
  const [managerValue, setManagerValue] = useState(() => state?.record?.manager || "");
  const [projectRoleCreate, setProjectRoleCreate] = useState<{
    kind: "contractor" | "project-manager";
    initialName?: string;
    /** When set from Payee picker, apply the new name to the payee field. */
    applyTo?: "project" | "payee";
  } | null>(null);
  const [projectWbs, setProjectWbs] = useState<ProjectPhaseDraft[]>(() => {
    if (definition.key !== "projects") return [];
    if (state?.record?.wbsDraft) return parseWbsDraft(state.record.wbsDraft);
    if (state?.mode === "edit" && state.record?.name) {
      return loadProjectWbsDraft(state.record.name);
    }
    return [];
  });
  const [vehicleValue, setVehicleValue] = useState(() => state?.record?.vehicle || "");
  const [workCenterValue, setWorkCenterValue] = useState(
    () => state?.record?.workCenter || "",
  );
  const [roasterValue, setRoasterValue] = useState(() => state?.record?.roaster || "");
  const [lineValue, setLineValue] = useState(() => state?.record?.line || "");
  const factoryInScope = (useSearchParams().get(FACTORY_PARAM) || "").trim();
  const [maintenancePickers, setMaintenancePickers] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [key, picker] of Object.entries(MAINTENANCE_RECORD_PICKERS)) {
      if (picker.on.includes(definition.key) && state?.record?.[key]) out[key] = state.record[key];
    }
    // Viewing one factory, a new machine, shop floor or reading starts there.
    if (
      state?.mode === "create" &&
      factoryInScope &&
      !out.plantCode &&
      MAINTENANCE_RECORD_PICKERS.plantCode?.on.includes(definition.key)
    ) {
      out.plantCode = factoryInScope;
    }
    return out;
  });
  const [vehicleNameValue, setVehicleNameValue] = useState(
    () => state?.record?.name || "",
  );
  const [fixedAssetValue, setFixedAssetValue] = useState(
    () => state?.record?.fixedAsset || "",
  );
  const [makeModelValue, setMakeModelValue] = useState(
    () => state?.record?.makeModel || "",
  );
  const [registrationValue, setRegistrationValue] = useState(
    () => state?.record?.registration || "",
  );
  const [vehicleTypeValue, setVehicleTypeValue] = useState(
    () => state?.record?.type || "",
  );
  const [vehicleFieldPrefill, setVehicleFieldPrefill] = useState<Record<string, string>>({});
  const [vehiclePrefillTick, setVehiclePrefillTick] = useState(0);
  const [staffListsTick, setStaffListsTick] = useState(0);
  const [appliedToValue, setAppliedToValue] = useState(() => state?.record?.appliedTo || "");
  const [moneyAmountValue, setMoneyAmountValue] = useState(() => state?.record?.amount || "");
  const isBankRecon = definition.key === "reconciliations";
  const [reconDate, setReconDate] = useState(
    () => state?.record?.date || new Date().toISOString().slice(0, 10),
  );
  const [reconStatementBalance, setReconStatementBalance] = useState(
    () => state?.record?.statementBalance || "",
  );
  const isFixedAsset = definition.key === "fixed-assets";
  const isIntangibleAsset = definition.key === "intangible-assets";
  const [assetCost, setAssetCost] = useState(() => state?.record?.cost || "");
  const [assetOtherCosts, setAssetOtherCosts] = useState(() => state?.record?.otherCosts || "");
  const [assetEntryType, setAssetEntryType] = useState(
    () => state?.record?.entryType || "Purchase",
  );
  const [assetAccumDep, setAssetAccumDep] = useState(
    () =>
      state?.record?.accumulatedDepreciation ||
      state?.record?.accumulatedAmortization ||
      "",
  );
  const assetTotalCost = roundMoney(parseAmount(assetCost) + parseAmount(assetOtherCosts));
  const assetIsOpening = /opening/i.test(assetEntryType);
  const assetBookValue = roundMoney(
    Math.max(0, assetTotalCost - (assetIsOpening ? parseAmount(assetAccumDep) : 0)),
  );

  const isSalesInvoice = supportsSalesInvoiceOptions(definition.key);
  const [invoiceOptions, setInvoiceOptions] = useState<FormOptionsState>(() =>
    isSalesInvoice
      ? loadFormOptions("sales-invoices", defaultSalesInvoiceOptions)
      : defaultSalesInvoiceOptions,
  );
  const [customTitle, setCustomTitle] = useState(() => state?.record?.customTitle ?? "");
  const [earlyPaymentDiscount, setEarlyPaymentDiscount] = useState(
    () => state?.record?.earlyPaymentDiscount ?? "",
  );
  const [latePaymentFees, setLatePaymentFees] = useState(
    () => state?.record?.latePaymentFees ?? "",
  );
  const [deliveryDate, setDeliveryDate] = useState(() => state?.record?.deliveryDate ?? "");
  const [deliveredTo, setDeliveredTo] = useState(() => state?.record?.deliveredTo ?? "");
  const usesProjectHierarchy = PROJECT_WBS_ENTITIES.has(definition.key);
  const [hierarchyProject, setHierarchyProject] = useState(() => {
    if (state?.record?.project) return state.record.project;
    if (isMaterialRequest && state?.mode === "create") {
      const names = scopedProjectNames();
      if (names?.length === 1) return names[0];
    }
    return "";
  });
  const [hierarchyPhase, setHierarchyPhase] = useState(() => state?.record?.phase || "");
  const [hierarchyActivity, setHierarchyActivity] = useState(
    () => state?.record?.activity || "",
  );
  const formFields = useMemo(() => {
    if (!usesProjectHierarchy) return definition.fields;
    return withProjectHierarchyOptions(definition.fields, {
      project: hierarchyProject,
      phase: hierarchyPhase,
    });
  }, [definition.fields, usesProjectHierarchy, hierarchyProject, hierarchyPhase]);

  // Only re-seed controlled pickers when the open editor session changes.
  // Do NOT depend on siblingRecords / definition.fields — background sync and
  // entityDefinitions() churn were wiping Received in / Paid by / Currency mid-edit.
  const editorSessionKey = `${state?.mode ?? ""}:${state?.record?.id ?? "new"}:${definition.key}`;

  useEffect(() => {
    setDocLines(documentLinesFromRecord(state?.record));
    setJournalLines(journalLinesFromRecord(state?.record));
    setMaterialRequestLines(
      definition.key === "requisitions"
        ? materialRequestLinesFromRecord(state?.record)
        : [],
    );
    setNeededByValue(() => {
      if (definition.key !== "requisitions") return "";
      if (state?.record?.neededBy) return state.record.neededBy;
      if (state?.mode === "create") return new Date().toISOString().slice(0, 10);
      return "";
    });
    setCoaKind(state?.record?.kind || "Account");
    {
      const seed = (state?.record?.kind || state?.record?.type || "").trim() as LocationKind;
      setEntityLocationKind(
        seed || (definition.key === "pos-locations" ? "store" : "warehouse"),
      );
    }
    setTaxRate(parseAmount(state?.record?.tax));
    setTaxLabel(state?.record?.taxCode || "");
    setPartyValue(
      state?.record?.party ||
        state?.record?.customer ||
        state?.record?.supplier ||
        state?.record?.payee ||
        "",
    );
    setPartyCreate(null);
    setCurrencyValue(
      (
        state?.record?.currency ||
        state?.record?.currencyCode ||
        loadManagerSettings().baseCurrencyCode ||
        "UGX"
      ).toUpperCase(),
    );
    setDivisionValue(state?.record?.division || state?.record?.costCenter || "");
    setReferenceValue(() => {
      if (state?.mode === "edit") return state?.record?.reference || "";
      const hasReference = definition.fields.some((f) => f.key === "reference");
      if (!hasReference) return "";
      return nextDocumentReference(definition.key, siblingRecords, definition.label);
    });
    setCodeValue(() => {
      if (state?.mode === "edit") return state?.record?.code || "";
      if (!isAutoCodedEntity(definition.key)) return state?.record?.code || "";
      return nextEntityCode(definition.key, siblingRecords, definition.label);
    });
    const nextAccounts: Record<string, string> = {};
    for (const field of definition.fields) {
      if (
        (definition.key === "employees" || definition.key === "payslips") &&
        (field.key === "bankAccount" || field.key === "bankCode")
      ) {
        continue;
      }
      if (field.key === "department" || field.key === "driver") {
        continue;
      }
      if (!usesCoaPicker(definition.key, field.key, field.label)) continue;
      let seed = state?.record?.[field.key] || "";
      // Fuel logs may only have legacy paidFrom — seed the bank picker from it.
      if (
        definition.key === "fuel-logs" &&
        field.key === "bankAccount" &&
        !seed
      ) {
        seed = state?.record?.paidFrom || "";
      }
      // Legacy bank rows may only have name — treat it as the CoA link.
      if (
        definition.key === "bank-and-cash-accounts" &&
        field.key === "glAccount" &&
        !seed
      ) {
        seed = state?.record?.name || state?.record?.account || "";
      }
      nextAccounts[field.key] = seed;
    }
    setAccountPickers(nextAccounts);
    const nextItems: Record<string, string> = {};
    for (const field of definition.fields) {
      if (!isInventoryItemPickerField(field.key, field.label)) continue;
      nextItems[field.key] = state?.record?.[field.key] || "";
    }
    setItemPickers(nextItems);
    const nextLocations: Record<string, string> = {};
    for (const field of definition.fields) {
      if (!usesWarehouseLocationPicker(definition.key, field.key, field.label)) continue;
      nextLocations[field.key] = state?.record?.[field.key] || "";
    }
    setLocationPickers(nextLocations);
    setOpeningStockValue(state?.record?.openingStock || state?.record?.quantity || "");
    setItemUnitValue(
      state?.record?.unitValue ||
        state?.record?.purchasePrice ||
        state?.record?.unitCost ||
        state?.record?.averageCost ||
        "",
    );
    setInventoryQtyValue(state?.record?.quantity || "");
    setInventoryUnitCostValue(state?.record?.unitCost || "");
    setInventoryUnitPriceValue(state?.record?.unitPrice || "");
    setEmployeeBank(state?.record?.bankAccount || "");
    setEmployeeBankCode(
      state?.record?.bankCode || bankCodeForName(state?.record?.bankAccount || "") || "",
    );
    setEmployeeDepartment(state?.record?.department || "");
    setSupplierCategory(state?.record?.category || "");
    setDriverValue(state?.record?.driver || "");
    setContractorValue(() => {
      if (state?.record?.contractor) return state.record.contractor;
      if (
        (definition.key === "requisitions" || definition.key === "payment-requests") &&
        state?.mode === "create"
      ) {
        const kind = currentProjectScopeKind();
        if (kind === "contractor") {
          const directory = currentProjectDirectoryRow(kind);
          return directory?.company || directory?.name || getCurrentSessionUser()?.name || "";
        }
        return getCurrentSessionUser()?.name || "";
      }
      return "";
    });
    setManagerValue(state?.record?.manager || "");
    setProjectRoleCreate(null);
    setProjectWbs(() => {
      if (definition.key !== "projects") return [];
      if (state?.record?.wbsDraft) return parseWbsDraft(state.record.wbsDraft);
      if (state?.mode === "edit" && state.record?.name) {
        return loadProjectWbsDraft(state.record.name);
      }
      return [];
    });
    setVehicleValue(state?.record?.vehicle || "");
    setWorkCenterValue(state?.record?.workCenter || "");
    setRoasterValue(state?.record?.roaster || "");
    setLineValue(state?.record?.line || "");
    setVehicleNameValue(state?.record?.name || "");
    setFixedAssetValue(state?.record?.fixedAsset || "");
    setMakeModelValue(state?.record?.makeModel || "");
    setRegistrationValue(state?.record?.registration || "");
    setVehicleTypeValue(state?.record?.type || "");
    setVehicleFieldPrefill({});
    setVehiclePrefillTick(0);
    setAppliedToValue(state?.record?.appliedTo || "");
    setMoneyAmountValue(state?.record?.amount || "");
    setCustomTitle(state?.record?.customTitle ?? "");
    setEarlyPaymentDiscount(state?.record?.earlyPaymentDiscount ?? "");
    setLatePaymentFees(state?.record?.latePaymentFees ?? "");
    setDeliveryDate(state?.record?.deliveryDate ?? "");
    setDeliveredTo(state?.record?.deliveredTo ?? "");
    setReconDate(state?.record?.date || new Date().toISOString().slice(0, 10));
    setReconStatementBalance(state?.record?.statementBalance || "");
    setAssetCost(state?.record?.cost || "");
    setAssetOtherCosts(state?.record?.otherCosts || "");
    setAssetEntryType(state?.record?.entryType || "Purchase");
    setAssetAccumDep(
      state?.record?.accumulatedDepreciation ||
        state?.record?.accumulatedAmortization ||
        "",
    );
    setHierarchyProject(() => {
      if (state?.record?.project) return state.record.project;
      if (
        (definition.key === "requisitions" || definition.key === "payment-requests") &&
        state?.mode === "create"
      ) {
        const names = scopedProjectNames();
        if (names?.length === 1) return names[0];
      }
      return "";
    });
    setHierarchyPhase(state?.record?.phase || "");
    setHierarchyActivity(state?.record?.activity || "");
    if (supportsSalesInvoiceOptions(definition.key)) {
      setInvoiceOptions(loadFormOptions("sales-invoices", defaultSalesInvoiceOptions));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed by editorSessionKey only
  }, [editorSessionKey]);

  function updateInvoiceOptions(next: FormOptionsState) {
    setInvoiceOptions(next);
    saveFormOptions("sales-invoices", next);
  }

  const liveInvoiceTotals = useMemo(() => {
    if (!isSalesInvoice || !useDocLines) return null;
    return computeSalesInvoiceTotals({
      subtotal: documentLinesTotal(docLines),
      taxRate,
      rounding: invoiceOptions.rounding,
      earlyPaymentDiscountPct: parseAmount(earlyPaymentDiscount),
      latePaymentFees: parseAmount(latePaymentFees),
    });
  }, [
    isSalesInvoice,
    useDocLines,
    docLines,
    taxRate,
    invoiceOptions.rounding,
    earlyPaymentDiscount,
    latePaymentFees,
  ]);

  const bankReconLive = useMemo(() => {
    if (!isBankRecon) return null;
    const account = (accountPickers.account || state?.record?.account || "").trim();
    if (!account) return null;
    const asOf = reconDate || new Date().toISOString().slice(0, 10);
    return reconcileBankAccount({
      account,
      statementBalance: parseAmount(reconStatementBalance),
      asOf,
    });
  }, [
    isBankRecon,
    accountPickers.account,
    state?.record?.account,
    reconDate,
    reconStatementBalance,
  ]);

  const reconStatus = bankReconLive?.balanced ? "Reconciled" : "Not reconciled";

  // Line totals are in document currency; the ledger and this field are in base.
  const liveInvoiceTotalBase = useMemo(
    () =>
      convertToBase(liveInvoiceTotals?.total ?? 0, currencyValue, state?.record?.date),
    [liveInvoiceTotals, currencyValue, state?.record?.date],
  );

  const allocationSide =
    definition.key === "receipts"
      ? "receivable"
      : definition.key === "payments"
        ? "payable"
        : null;
  const [coaTick, setCoaTick] = useState(0);
  useEffect(() => {
    const reload = () => setCoaTick((t) => t + 1);
    window.addEventListener("financeiag-ledger-changed", reload);
    window.addEventListener("financeiag-records-changed", reload);
    window.addEventListener("financeiag-settings-changed", reload);
    return () => {
      window.removeEventListener("financeiag-ledger-changed", reload);
      window.removeEventListener("financeiag-records-changed", reload);
      window.removeEventListener("financeiag-settings-changed", reload);
    };
  }, []);

  // Prefetch payee / open-document / CoA / inventory masters as soon as the form opens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateFormPickerSources(definition.key);
      if (!cancelled) setCoaTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [definition.key]);

  const openDocs = useMemo(() => {
    void coaTick;
    return allocationSide ? openInvoiceOptions(allocationSide) : [];
  }, [allocationSide, state, coaTick]);

  const groupOptions = useMemo(() => {
    if (!isCoa) return [];
    void coaTick;
    const fromSiblings = coaGroupOptions(siblingRecords);
    if (fromSiblings.length) return fromSiblings;
    return coaGroupOptions(loadRecords("accounts", "chart-of-accounts"));
  }, [isCoa, siblingRecords, coaTick]);

  const parentGroupOptions = useMemo(() => {
    if (!isCoa) return [];
    const editingName = (state?.record?.name || "").trim().toLowerCase();
    return groupOptions.filter((g) => g.toLowerCase() !== editingName);
  }, [isCoa, groupOptions, state?.record?.name]);

  const allAccountOptions = useMemo(() => {
    void coaTick;
    return coaAccountSelectOptions();
  }, [coaTick]);

  const bankAccountOptions = useMemo(() => {
    void coaTick;
    return bankAccountSelectOptions();
  }, [coaTick]);

  const taxRateOptions = useMemo(() => {
    void coaTick;
    return taxCodeSelectOptions("rate");
  }, [coaTick]);

  const taxNameOptions = useMemo(() => {
    void coaTick;
    return taxCodeSelectOptions("name");
  }, [coaTick]);

  const currencyOptions = useMemo(() => {
    void coaTick;
    return currencySelectOptions();
  }, [coaTick]);

  const supplierOptions = useMemo(() => {
    void coaTick;
    return partySelectOptions("payable");
  }, [coaTick]);

  const customerOptions = useMemo(() => {
    void coaTick;
    return partySelectOptions("receivable");
  }, [coaTick]);

  const inventoryItemOptions = useMemo(() => {
    void coaTick;
    return inventoryItemSelectOptions();
  }, [coaTick]);

  const posProductOptions = useMemo(() => {
    void coaTick;
    return posProductSelectOptions();
  }, [coaTick]);

  const inventoryLocationOptions = useMemo(() => {
    void coaTick;
    return inventoryLocationSelectOptions();
  }, [coaTick]);

  const posLocationOptions = useMemo(() => {
    void coaTick;
    return posLocationSelectOptions();
  }, [coaTick]);

  const activeLocationOptions = locationPickerIsPos
    ? posLocationOptions
    : inventoryLocationOptions;

  const stockItemOptions =
    definition.key === "pos-stock-in" ? posProductOptions : inventoryItemOptions;

  function applyDocCurrency(nextCurrency: string, asOf?: string) {
    const base = loadManagerSettings().baseCurrencyCode || "UGX";
    const next = (nextCurrency || base).toUpperCase();
    const from = (currencyValue || base).toUpperCase();
    if (next === from) return;
    if (useDocLines) {
      setDocLines((lines) =>
        lines.map((line) => {
          const unit = parseAmount(line.unitPrice);
          const amount = parseAmount(line.amount);
          const discount = parseAmount(line.discount);
          return normalizeDocumentLine({
            ...line,
            unitPrice: unit ? String(convertBetween(unit, from, next, asOf)) : line.unitPrice,
            amount: amount ? String(convertBetween(amount, from, next, asOf)) : line.amount,
            discount:
              line.discountType === "amount" && discount
                ? String(convertBetween(discount, from, next, asOf))
                : line.discount,
          });
        }),
      );
    }
    if (isFixedAsset || isIntangibleAsset) {
      const cost = parseAmount(assetCost);
      const extras = parseAmount(assetOtherCosts);
      const accum = parseAmount(assetAccumDep);
      if (cost) setAssetCost(String(convertBetween(cost, from, next, asOf)));
      if (extras) setAssetOtherCosts(String(convertBetween(extras, from, next, asOf)));
      if (accum) setAssetAccumDep(String(convertBetween(accum, from, next, asOf)));
    }
    setCurrencyValue(next);
  }

  function applyPartySelection(
    name: string,
    options: { value: string; currency: string }[],
    side: "receivable" | "payable" | "both",
    addLabel?: string,
  ) {
    const trimmed = name.trim();
    if (!trimmed) {
      setPartyValue("");
      return;
    }
    const known = options.some(
      (o) => o.value.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (!known) {
      // Always use the full supplier/customer form — never silent name-only create.
      setPartyCreate({
        side,
        addLabel:
          addLabel ||
          (side === "payable" ? "supplier" : side === "receivable" ? "customer" : "payee"),
        initialName: trimmed,
      });
      return;
    }
    setPartyValue(trimmed);
    const match =
      options.find((o) => o.value === trimmed) ||
      partySelectOptions(side === "both" ? "payable" : side).find(
        (o) => o.value.trim().toLowerCase() === trimmed.toLowerCase(),
      );
    if (match?.currency) applyDocCurrency(match.currency);
  }

  const activeFooters = useMemo(() => {
    void coaTick;
    if (!isSalesInvoice || !invoiceOptions.footers) return [];
    return loadActiveFooters("Sales invoices");
  }, [coaTick, isSalesInvoice, invoiceOptions.footers]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || readOnly) return;
    const asDraft = allowSaveAsDraft && saveAsDraftRef.current;
    saveAsDraftRef.current = false;
    const values = Object.fromEntries(
      Array.from(new FormData(event.currentTarget).entries()).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
    // Money inputs may still carry commas from display — persist clean numbers.
    for (const key of Object.keys(values)) {
      if (isMoneyInputField(key) && values[key]) {
        values[key] = sanitizeAmountInput(values[key]);
      }
    }
    // Merge controlled pickers — React state wins over stale FormData.
    for (const [key, val] of Object.entries(accountPickers)) {
      if (val) values[key] = val;
    }
    if (partyValue) {
      if (definition.fields.some((f) => f.key === "party") && !values.party) values.party = partyValue;
      if (definition.fields.some((f) => f.key === "customer") && !values.customer)
        values.customer = partyValue;
      if (definition.fields.some((f) => f.key === "supplier") && !values.supplier)
        values.supplier = partyValue;
      if (definition.fields.some((f) => f.key === "payee") && !values.payee)
        values.payee = partyValue;
    }
    if (employeeBank && !values.bankAccount) values.bankAccount = employeeBank;
    if (employeeDepartment && !values.department) values.department = employeeDepartment;
    if (driverValue && !values.driver) values.driver = driverValue;
    if (contractorValue && !values.contractor) values.contractor = contractorValue;
    if (managerValue && !values.manager) values.manager = managerValue;
    if (vehicleValue && !values.vehicle) values.vehicle = vehicleValue;
    if (workCenterValue && !values.workCenter) values.workCenter = workCenterValue;
    if (roasterValue && !values.roaster) values.roaster = roasterValue;
    if (lineValue && !values.line) values.line = lineValue;
    for (const [key, val] of Object.entries(maintenancePickers)) {
      if (val && !values[key]) values[key] = val;
    }
    if (definition.key === "vehicles") {
      if (vehicleNameValue && !values.name) values.name = vehicleNameValue;
      if (fixedAssetValue && !values.fixedAsset) values.fixedAsset = fixedAssetValue;
      if (makeModelValue && !values.makeModel) values.makeModel = makeModelValue;
      if (registrationValue && !values.registration) values.registration = registrationValue;
      if (vehicleTypeValue && !values.type) values.type = vehicleTypeValue;
      if (codeValue && !values.code) values.code = codeValue;
      for (const [key, val] of Object.entries(vehicleFieldPrefill)) {
        if (val && !(values[key] || "").trim()) values[key] = val;
      }
    }
    // One bank field on the form — keep paidFrom / bankAccount in sync for ledger.
    if (definition.key === "fuel-logs") {
      const bank =
        accountPickers.bankAccount ||
        values.bankAccount ||
        values.paidFrom ||
        "";
      if (bank) {
        values.bankAccount = bank;
        values.paidFrom = bank;
      }
    }
    if (definition.key === "receipts" || definition.key === "payments") {
      const bank =
        accountPickers.account ||
        values.account ||
        accountPickers.bankAccount ||
        values.bankAccount ||
        accountPickers.paidFrom ||
        values.paidFrom ||
        "";
      if (bank) {
        values.account = bank;
        values.bankAccount = bank;
        if (definition.key === "payments") values.paidFrom = bank;
        if (definition.key === "receipts") values.depositTo = bank;
      }
      if (moneyAmountValue.trim()) {
        values.amount = sanitizeAmountInput(moneyAmountValue);
      }
      if (appliedToValue.trim()) {
        values.appliedTo = appliedToValue.trim();
      }
    }
    if (divisionValue) {
      if (definition.fields.some((f) => f.key === "division") && !values.division)
        values.division = divisionValue;
      if (definition.fields.some((f) => f.key === "costCenter") && !values.costCenter)
        values.costCenter = divisionValue;
    }
    for (const [key, val] of Object.entries(itemPickers)) {
      if (val && !values[key]) values[key] = val;
    }
    for (const [key, val] of Object.entries(locationPickers)) {
      if (val && !values[key]) values[key] = val;
    }

    const baseCurrency = (loadManagerSettings().baseCurrencyCode || "UGX").toUpperCase();
    const hasCurrencyField = definition.fields.some(
      (f) => f.key === "currency" || f.key === "currencyCode",
    );
    const hasMoneyField = definition.fields.some((f) => isMoneyInputField(f.key));
    // Persist the currency the user chose with cash amounts (never drop it on save).
    if (hasCurrencyField || hasMoneyField) {
      const code = (
        currencyValue ||
        values.currency ||
        values.currencyCode ||
        baseCurrency
      )
        .trim()
        .toUpperCase();
      values.currency = code;
      values.currencyCode = code;
    }
    if (definition.fields.some((f) => f.key === "reference")) {
      values.reference =
        (values.reference || referenceValue || "").trim() ||
        nextDocumentReference(definition.key, siblingRecords, definition.label);
    }
    if (isAutoCodedEntity(definition.key)) {
      values.code =
        (values.code || codeValue || "").trim() ||
        nextEntityCode(definition.key, siblingRecords, definition.label);
    }
    if (isLocationEntityForm) {
      values.kind = entityLocationKind;
      values.type = entityLocationKind;
      if (definition.key === "inventory-locations") {
        const prefix =
          entityLocationKind === "warehouse"
            ? "WH-"
            : entityLocationKind === "store"
              ? "ST-"
              : "LOC-";
        if (!/^(WH|ST|LOC)-/i.test(values.code || "")) {
          values.code = (values.code || "").replace(/^LOC-/i, prefix);
        }
        if (!(values.code || "").trim()) {
          values.code = nextEntityCode(
            definition.key,
            siblingRecords,
            definition.label,
          ).replace(/^LOC-/i, prefix);
        }
      }
      if (!(values.status || "").trim()) values.status = "Active";
    }
    if (partyValue && (values.party !== undefined || definition.fields.some((f) => f.key === "party"))) {
      values.party = partyValue || values.party || "";
    }
    if (partyValue && definition.fields.some((f) => f.key === "payee")) {
      values.payee = partyValue || values.payee || "";
    }
    if (definition.key === "inventory-items" || definition.key === "pos-products") {
      const unitValue = parseAmount(itemUnitValue || values.unitValue);
      values.unitValue = String(itemUnitValue || values.unitValue || "");
      values.purchasePrice = values.unitValue;
      values.unitCost = values.unitValue;
      values.averageCost = values.unitValue;
      if (state.mode === "edit") {
        const hasMovements = Boolean(
          state.record.inventoryMoves && state.record.inventoryMoves !== "{}",
        ) || Boolean(
          state.record.inventoryTransferMoves &&
            state.record.inventoryTransferMoves !== "{}",
        );
        if (!hasMovements && (openingStockValue !== "" || values.openingStock)) {
          const opening = String(openingStockValue || values.openingStock || "0").trim() || "0";
          values.openingStock = opening;
          values.quantity = opening;
          values.stockValue = String(roundMoney(parseAmount(opening) * unitValue));
          values.inventoryValue = values.stockValue;
          const loc =
            (values.location || locationPickers.location || state.record.location || "Main").trim() ||
            "Main";
          const openingQty = parseAmount(opening);
          values.locationStock = JSON.stringify(openingQty ? { [loc]: openingQty } : {});
        } else {
          // Keep live available stock from movements — form cannot overwrite qty.
          values.quantity = state.record.quantity || "0";
          values.openingStock =
            state.record.openingStock || String(inventoryStockLevels(state.record).opening);
          values.stockValue = String(
            roundMoney(parseAmount(values.openingStock) * unitValue) ||
              parseAmount(state.record.stockValue || state.record.inventoryValue),
          );
          values.inventoryValue = values.stockValue;
          values.locationStock = state.record.locationStock || "";
        }
      } else {
        const opening = String(openingStockValue || values.openingStock || "0").trim() || "0";
        values.openingStock = opening;
        values.quantity = opening;
        values.stockValue = String(roundMoney(parseAmount(opening) * unitValue));
        values.inventoryValue = values.stockValue;
        const loc = (values.location || locationPickers.location || "Main").trim() || "Main";
        const openingQty = parseAmount(opening);
        values.locationStock = JSON.stringify(openingQty ? { [loc]: openingQty } : {});
      }
    }
    if (definition.key === "stock-in" || definition.key === "pos-stock-in") {
      const qty = parseAmount(inventoryQtyValue || values.quantity);
      const unit = parseAmount(inventoryUnitCostValue || values.unitCost);
      values.quantity = String(inventoryQtyValue || values.quantity || "");
      values.unitCost = String(inventoryUnitCostValue || values.unitCost || "");
      values.stockValue = String(roundMoney(qty * unit));
      values.amount = values.stockValue;
      if (itemPickers.item) values.item = itemPickers.item;
      if (locationPickers.location) values.location = locationPickers.location;
    }
    if (definition.key === "inventory-sales") {
      const qty = parseAmount(inventoryQtyValue || values.quantity);
      const unit = parseAmount(inventoryUnitPriceValue || values.unitPrice);
      values.quantity = String(inventoryQtyValue || values.quantity || "");
      values.unitPrice = String(inventoryUnitPriceValue || values.unitPrice || "");
      values.amount = String(roundMoney(qty * unit));
      if (itemPickers.item) values.item = itemPickers.item;
      if (locationPickers.location) values.location = locationPickers.location;
    }
    if (definition.key === "inventory-write-offs") {
      const qty = parseAmount(inventoryQtyValue || values.quantity);
      let unit = parseAmount(inventoryUnitCostValue || values.unitCost);
      values.quantity = String(inventoryQtyValue || values.quantity || "");
      if (!unit && values.item) {
        const item = inventoryItemSelectOptions().find(
          (row) => row.value === values.item || row.name === values.item,
        );
        unit = parseAmount(item?.purchasePrice || "0");
        if (unit && !values.unitCost) values.unitCost = String(unit);
      } else if (inventoryUnitCostValue) {
        values.unitCost = inventoryUnitCostValue;
      }
      if (!parseAmount(values.amount)) {
        values.amount = String(roundMoney(qty * unit));
      }
      if (itemPickers.item) values.item = itemPickers.item;
      if (locationPickers.location) values.location = locationPickers.location;
    }
    if (useDocLines) {
      values.lines = serializeDocumentLines(docLines);
      const computed = computeSalesInvoiceTotals({
        subtotal: documentLinesTotal(docLines),
        taxRate: taxRate || parseAmount(values.tax),
        rounding: isSalesInvoice && invoiceOptions.rounding,
        earlyPaymentDiscountPct: isSalesInvoice ? parseAmount(earlyPaymentDiscount) : 0,
        latePaymentFees: isSalesInvoice ? parseAmount(latePaymentFees) : 0,
      });
      // Prefer live tax state (select) so amount always includes tax.
      const taxPct = taxRate || parseAmount(values.tax);
      values.tax = taxPct ? String(taxPct) : values.tax || "";
      if (taxLabel) values.taxCode = taxLabel;
      values.taxAmount = String(computed.taxAmount);
      values.amount = String(computed.amountDue);
      if (isSalesInvoice) {
        if (invoiceOptions.customTitle) values.customTitle = customTitle;
        if (invoiceOptions.earlyPaymentDiscount) {
          values.earlyPaymentDiscount = earlyPaymentDiscount;
          values.earlyPaymentAmount = String(computed.earlyDiscountAmount);
        }
        if (invoiceOptions.latePaymentFees) {
          values.latePaymentFees = latePaymentFees;
        }
        values.actsAsDeliveryNote = invoiceOptions.actsAsDeliveryNote ? "Yes" : "No";
        if (invoiceOptions.actsAsDeliveryNote) {
          values.deliveryDate = deliveryDate;
          values.deliveredTo = deliveredTo;
        }
        if (invoiceOptions.totalBaseCurrency) {
          values.baseCurrencyTotal = String(
            convertToBase(computed.total, currencyValue, values.date || values.issueDate),
          );
          values.baseCurrencyCode = computed.baseCurrencyCode;
        }
        if (!invoiceOptions.hideBalanceDue) {
          values.balanceDue = values.balanceDue || String(computed.amountDue);
        } else {
          delete values.balanceDue;
        }
        if (invoiceOptions.footers && activeFooters.length) {
          values.footerText = activeFooters.map((f) => `${f.name}: ${f.content}`).join("\n\n");
        }
      }
    }
    if (useJournalLines) {
      values.lines = serializeJournalLines(journalLines);
    }
    if (isMaterialRequest) {
      if (neededByValue) values.neededBy = neededByValue;
      values.lines = serializeMaterialRequestLines(materialRequestLines);
      values.description = materialRequestLinesSummary(materialRequestLines);
      if (!values.fulfillmentPath?.trim()) {
        values.fulfillmentPath = "Stores issue";
      }
      const first = materialRequestLines.find(
        (line) => line.description.trim() || line.quantity.trim(),
      );
      if (first) {
        values.quantity = first.quantity || "";
        values.unit = first.unit || "pcs";
      } else {
        values.quantity = "";
        values.unit = "";
      }
    }
    if (isCoa) {
      values.kind = coaKind;
      if (coaKind === "Group") {
        values.code = values.code || "";
        values.group = "";
        values.openingBalance = "";
        values.balance = "";
      } else {
        values.parentGroup = "";
      }
    }
    if (values.taxCode) {
      const codes = loadList(TAX_CODES_KEY, defaultTaxCodes);
      const match = codes.find(
        (c) => c.name === values.taxCode || c.label === values.taxCode || c.id === values.taxCode,
      );
      if (match) {
        values.tax = String(match.rate ?? "0");
        values.taxAccount = match.account || "";
      }
    } else if (values.tax) {
      const codes = loadList(TAX_CODES_KEY, defaultTaxCodes);
      const match = codes.find((c) => String(c.rate) === String(values.tax));
      if (match) {
        values.taxCode = match.name;
        values.taxAccount = match.account || "";
      }
    }
    if (definition.key === "bank-and-cash-accounts") {
      const gl = (accountPickers.glAccount || values.glAccount || "").trim();
      values.glAccount = gl;
      values.name = (values.name || accountPickers.name || "").trim();
      if (!values.code && gl) {
        const match = coaAccountSelectOptions({ bankLike: true }).find(
          (o) => o.value === gl || o.name === gl,
        );
        if (match?.code) values.code = match.code;
      }
      if (!asDraft) {
        if (!values.name) {
          showWarning("Bank account name required", BANK_ACCOUNT_NAME_HINT);
          return;
        }
        if (isChartOfAccountsBankName(values.name)) {
          showWarning("Use a real bank name", BANK_ACCOUNT_NAME_HINT);
          return;
        }
        if (!values.glAccount) {
          showWarning(
            "Posts to required",
            "Pick which Chart of Accounts account this bank posts to (e.g. Bank-UGX).",
          );
          return;
        }
        if (values.name.trim().toLowerCase() === values.glAccount.trim().toLowerCase()) {
          showWarning("Name must differ from CoA", BANK_ACCOUNT_NAME_HINT);
          return;
        }
      }
    }
    if (definition.key === "reconciliations") {
      values.date = reconDate || values.date || new Date().toISOString().slice(0, 10);
      values.statementBalance = reconStatementBalance || values.statementBalance || "0";
      if (bankReconLive) {
        values.systemBalance = String(bankReconLive.bookBalance);
        values.discrepancy = String(bankReconLive.discrepancy);
        values.status = bankReconLive.balanced ? "Reconciled" : "Not reconciled";
        if (bankReconLive.currency) {
          values.currency = bankReconLive.currency;
          values.currencyCode = bankReconLive.currency;
        }
      } else {
        values.systemBalance = values.systemBalance || "0";
        values.discrepancy = values.discrepancy || "0";
        values.status = "Not reconciled";
      }
    }
    if (definition.key === "departments" && (values.name || "").trim()) {
      registerDepartmentName(values.name);
    }
    if (definition.key === "projects") {
      if (!(values.status || "").trim()) {
        values.status = state.mode === "edit" ? state.record?.status || "Planning" : "Planning";
      }
      if (codeValue && !(values.code || "").trim()) values.code = codeValue;
      values.wbsDraft = JSON.stringify(projectWbs);
    }
    // Receipts / payments — ensure controlled pickers + posting defaults stick.
    if (definition.key === "receipts" || definition.key === "payments") {
      // Always take the controlled Apply-to picker (FormData alone can miss it).
      values.appliedTo = (appliedToValue || values.appliedTo || "").trim();
      if (moneyAmountValue.trim()) {
        values.amount = sanitizeAmountInput(moneyAmountValue);
      }
      const bank =
        accountPickers.account ||
        values.account ||
        accountPickers.bankAccount ||
        values.bankAccount ||
        "";
      if (!bank.trim()) {
        showWarning(
          "Bank account required",
          definition.key === "payments"
            ? "Choose Paid from (Bank & Cash account) before saving."
            : "Choose Received in (Bank & Cash account) before saving.",
        );
        return;
      }
      const canonBank = canonicalBankAccountName(bank);
      values.account = canonBank || bank;
      values.bankAccount = canonBank || bank;
      if (definition.key === "payments") values.paidFrom = values.account;
      if (definition.key === "receipts") values.depositTo = values.account;

      const side = definition.key === "receipts" ? "receivable" : "payable";
      const rawParty = (
        partyValue ||
        values.party ||
        values.customer ||
        values.supplier ||
        values.payee ||
        ""
      ).trim();
      // Stamp supplier/customer from the bill/invoice even when Payee was left blank
      // — otherwise the payment never appears on the party statement.
      const canonParty =
        partyFromAppliedDocument(side, values.appliedTo || "", rawParty) ||
        (rawParty ? canonicalPartyName(side, rawParty) : "") ||
        rawParty;
      if (canonParty) {
        values.party = canonParty;
      }
      if (!(values.amount || "").trim() || parseAmount(values.amount) <= 0) {
        showWarning(
          "Amount required",
          definition.key === "receipts"
            ? "Enter a receipt amount greater than zero."
            : "Enter a payment amount greater than zero.",
        );
        return;
      }
      // Persist a single-doc allocations array so AR/AP refresh stays durable.
      if (values.appliedTo && !values.allocations?.trim()) {
        const amt = sanitizeAmountInput(values.amount || "0");
        if (
          parseAmount(amt) > 0 &&
          !values.appliedTo.includes(";") &&
          !/:\s*[\d.]/.test(values.appliedTo)
        ) {
          values.allocations = JSON.stringify([
            { document: values.appliedTo, amount: parseAmount(amt) },
          ]);
        }
      }
      if (!values.status?.trim()) values.status = "Active";
      if (!values.clearance?.trim()) values.clearance = "Cleared";
      if (accountPickers.postingAccount && !values.postingAccount) {
        values.postingAccount = accountPickers.postingAccount;
      }
    }
    if (definition.key === "inter-account-transfers") {
      const fromRaw =
        accountPickers.from ||
        accountPickers.fromAccount ||
        values.from ||
        values.fromAccount ||
        "";
      const toRaw =
        accountPickers.to ||
        accountPickers.toAccount ||
        values.to ||
        values.toAccount ||
        "";
      if (!fromRaw.trim() || !toRaw.trim()) {
        showWarning(
          "Bank accounts required",
          "Choose both Paid from and Received in (Bank & Cash accounts).",
        );
        return;
      }
      const from = canonicalBankAccountName(fromRaw) || fromRaw.trim();
      const to = canonicalBankAccountName(toRaw) || toRaw.trim();
      values.from = from;
      values.to = to;
      values.fromAccount = from;
      values.toAccount = to;
      if (moneyAmountValue.trim()) {
        values.amount = sanitizeAmountInput(moneyAmountValue);
      }
      if (!(values.amount || "").trim() || parseAmount(values.amount) <= 0) {
        showWarning("Amount required", "Enter a transfer amount greater than zero.");
        return;
      }
      if (!values.status?.trim()) values.status = "Active";
    }
    // Invoice / bill / note — stamp master party onto party + customer/supplier aliases.
    if (
      definition.key === "sales-invoices" ||
      definition.key === "invoices" ||
      definition.key === "credit-notes" ||
      definition.key === "late-payment-fees" ||
      definition.key === "purchase-invoices" ||
      definition.key === "bills" ||
      definition.key === "debit-notes"
    ) {
      const side =
        definition.key === "purchase-invoices" ||
        definition.key === "bills" ||
        definition.key === "debit-notes"
          ? "payable"
          : "receivable";
      const rawParty = (
        partyValue ||
        values.party ||
        values.customer ||
        values.supplier ||
        values.payee ||
        ""
      ).trim();
      const canonParty = rawParty ? canonicalPartyName(side, rawParty) || rawParty : "";
      if (canonParty) {
        values.party = canonParty;
        if (side === "receivable") values.customer = canonParty;
        if (side === "payable") values.supplier = canonParty;
      } else if (definition.fields.some((f) => f.key === "party" && f.required)) {
        showWarning(
          "Party required",
          side === "payable"
            ? "Choose a supplier or contractor before saving."
            : "Choose a customer before saving.",
        );
        return;
      }
    }
    if (definition.key === "fixed-assets" || definition.key === "intangible-assets") {
      const baseCost = parseAmount(assetCost || values.cost);
      const extras = parseAmount(assetOtherCosts || values.otherCosts);
      const total = roundMoney(baseCost + extras);
      values.entryType = assetEntryType || values.entryType || "Purchase";
      values.cost = String(assetCost || values.cost || "");
      if (definition.key === "fixed-assets") {
        values.otherCosts = String(assetOtherCosts || values.otherCosts || "");
        values.totalAcquisitionCost = String(total);
        if (!values.quantity) values.quantity = "1";
      }
      values.amount = String(total);
      const opening = /opening/i.test(values.entryType);
      const accum = roundMoney(
        Math.min(total, Math.max(0, parseAmount(assetAccumDep || values.accumulatedDepreciation || values.accumulatedAmortization))),
      );
      if (definition.key === "fixed-assets") {
        values.accumulatedDepreciation = opening ? String(accum) : "";
      } else {
        values.accumulatedAmortization = opening ? String(accum) : "";
      }
      if (!opening) values.paidFrom = values.paidFrom || "";
      values.bookValue = String(roundMoney(Math.max(0, total - (opening ? accum : 0))));
      const code = (
        currencyValue ||
        values.currency ||
        values.currencyCode ||
        loadManagerSettings().baseCurrencyCode ||
        "UGX"
      )
        .trim()
        .toUpperCase();
      values.currency = code;
      values.currencyCode = code;
    }
    if (definition.key === "vehicles") {
      // Keep fleet code and linked fixed-asset code aligned.
      const assetCode = (values.fixedAsset || values.code || "").trim();
      if (assetCode) {
        if (!(values.code || "").trim()) values.code = assetCode;
        if (!(values.fixedAsset || "").trim()) values.fixedAsset = assetCode;
      }
    }
    // Normalize / fill transaction dates so posting controls and ledger stay in sync.
    {
      const today = new Date().toISOString().slice(0, 10);
      const dateKeys = [
        "date",
        "issueDate",
        "startDate",
        "nextIssueDate",
        "asOf",
        "acquired",
        "purchaseDate",
        "commencementDate",
        "dueDate",
      ] as const;
      for (const key of dateKeys) {
        if (!values[key]) continue;
        const iso = normalizeToIsoDate(values[key]);
        values[key] = iso || values[key].trim().slice(0, 10);
      }
      if (!values.date && (values.acquired || values.purchaseDate || values.commencementDate)) {
        values.date = values.acquired || values.purchaseDate || values.commencementDate;
      }
      const hasTxnDate = dateKeys.some((key) => Boolean(values[key]));
      if (!hasTxnDate) {
        const fieldKeys = new Set(definition.fields.map((field) => field.key));
        if (fieldKeys.has("date")) values.date = today;
        else if (fieldKeys.has("acquired")) {
          values.acquired = today;
          values.date = today;
        } else if (fieldKeys.has("startDate")) values.startDate = today;
        else if (fieldKeys.has("issueDate")) values.issueDate = today;
        else if (fieldKeys.has("asOf")) values.asOf = today;
        else values.date = today;
      }
    }
    if (asDraft) {
      // Park in form_drafts — do not insert into entity_records.
      if (SAVE_AS_DRAFT_FLAG in values) delete values[SAVE_AS_DRAFT_FLAG];
      void onSaveDraft?.(values);
      return;
    }

    // Validate required fields in JS after defaults — never rely on hidden input HTML5 required
    // (browsers fail with “An invalid form control is not focusable”).
    for (const field of visibleFields) {
      if (!field.required) continue;
      if (isCoa && field.key === "code" && coaKind === "Group") continue;
      if (definition.key === "reconciliations" && field.key === "status") continue;
      // Document/journal lines carry amount — header amount may be computed.
      if ((useDocLines || useJournalLines) && (field.key === "amount" || field.key === "lines"))
        continue;
      const raw = (values[field.key] || "").trim();
      if (!raw) {
        showWarning("Required field", `Please fill in “${field.label}” before saving.`);
        return;
      }
    }
    if (isMaterialRequest && !asDraft) {
      const filled = materialRequestLines.filter((line) => line.description.trim());
      if (!filled.length) {
        showWarning(
          "Materials required",
          "Add at least one material description before saving this request.",
        );
        return;
      }
    }
    if (state.mode === "create") onCreate(values);
    else onUpdate(state.record.id, values);
    // Nested pickers (warehouse create, etc.) must not linger after save.
    setLocationEditor(null);
    setPartyCreate(null);
    setProjectRoleCreate(null);
  }

  const visibleFields = formFields.filter((field) => {
    // Multi-currency opening balances use a dedicated control (not plain inputs).
    if (
      definition.key === "suppliers" &&
      (field.key === "openingBalances" || field.key === "openingBalanceDate")
    ) {
      return false;
    }
    // Mirrored onto party on save — keep off the contractor invoice form.
    if (definition.key === "contractor-invoices" && field.key === "supplier") {
      return false;
    }
    // Internal payroll-run payload — filled by Create Payroll / Finance release.
    if (
      definition.key === "payroll-runs" &&
      (field.key === "overridesJson" ||
        field.key === "payslipsCreated" ||
        field.key === "payslipCount" ||
        field.key === "payslipIds")
    ) {
      return false;
    }
    if (definition.key === "payslips" && field.key === "payrollRunId") {
      return false;
    }
    // Live/computed columns stay off create forms — except write-off expense account.
    if (LIVE_ONLY_FIELDS.has(field.key)) {
      if (
        field.key === "allocation" &&
        definition.key === "inventory-write-offs"
      ) {
        // keep visible as CoA expense picker
      } else {
        return false;
      }
    }
    // Duplicate of bankAccount — keep on the record, hide on the form.
    if (
      field.key === "paidFrom" &&
      definition.fields.some((f) => f.key === "bankAccount") &&
      (definition.key === "fuel-logs" || definition.key === "maintenance-requests")
    ) {
      return false;
    }
    // Receipts / payments: one bank field (`account`) + one payee. Alias /
    // JSON allocation / method fields stay on the record but clutter the form.
    if (
      (definition.key === "receipts" || definition.key === "payments") &&
      (field.key === "paidFrom" ||
        field.key === "depositTo" ||
        field.key === "bankAccount" ||
        field.key === "allocations" ||
        field.key === "paymentMethod")
    ) {
      return false;
    }
    // Fulfillment outcomes — not entered on create.
    if (
      definition.key === "fuel-requests" &&
      state?.mode === "create" &&
      (field.key === "fuelLog" || field.key === "fulfilledDate")
    ) {
      return false;
    }
    if (definition.key === "payslips" && PAYSLIP_COMPUTE_KEYS.has(field.key)) return false;
    if ((useDocLines || useJournalLines) && HIDDEN_WHEN_LINES.has(field.key)) return false;
    // Material request lines replace the flat description / qty / unit inputs.
    // Approval / fulfillment fields are filled by the chain, not the create form.
    if (
      isMaterialRequest &&
      (field.key === "description" ||
        field.key === "quantity" ||
        field.key === "unit" ||
        field.key === "fulfillmentPath" ||
        field.key === "approvedDate" ||
        field.key === "approvedBy" ||
        field.key === "fulfilledDate")
    ) {
      return false;
    }
    // Bank accounts: code is optional / auto from CoA; name is the real bank label.
    if (definition.key === "bank-and-cash-accounts" && field.key === "code") {
      return false;
    }
    if (isCoa) {
      if (field.key === "kind") return true;
      if (coaKind === "Group") {
        if (["code", "group", "openingBalance", "balance"].includes(field.key)) return false;
      } else if (field.key === "parentGroup") {
        return false;
      }
    }
    if (isSalesInvoice) {
      if (field.key === "dueDate" && invoiceOptions.hideDueDate) return false;
      if (field.key === "description" && !invoiceOptions.columnDescription && useDocLines) {
        // header description still useful; keep it
      }
    }
    if (isLocationEntityForm) {
      // Match the compact Create warehouse modal — status only when editing.
      if (field.key === "status" && state?.mode === "create") return false;
      if (field.key === "notes") return false;
    }
    if (isFixedAsset || isIntangibleAsset) {
      if (
        field.key === "accumulatedDepreciation" ||
        field.key === "accumulatedAmortization"
      ) {
        return assetIsOpening;
      }
      if (field.key === "paidFrom") return !assetIsOpening;
    }
    return true;
  });

  function resetLocationForm() {
    setLocationEditor(null);
    setNewLocationName("");
    setNewLocationCode("");
    setNewLocationAddress("");
    setNewLocationError("");
  }

  function openCreateLocation(fieldKey: string) {
    setLocationEditor({ fieldKey, mode: "create", originalName: "" });
    setNewLocationKind(locationPickerIsPos ? "store" : "warehouse");
    setNewLocationName("");
    setNewLocationCode("");
    setNewLocationAddress("");
    setNewLocationError("");
  }

  function openEditLocation(fieldKey: string) {
    const current = (locationPickers[fieldKey] || "").trim();
    if (!current) return;
    const match = activeLocationOptions.find(
      (location) =>
        location.value === current ||
        location.code === current ||
        location.label === current,
    );
    if (!match) {
      showWarning(
        locationPickerIsPos ? "POS location not found" : "Location not found",
        "Select a saved location first, then edit or delete it.",
      );
      return;
    }
    setLocationEditor({ fieldKey, mode: "edit", originalName: match.value });
    const kind = (match.kind || (locationPickerIsPos ? "store" : "warehouse")) as LocationKind;
    setNewLocationKind(kind);
    setNewLocationName(match.value);
    setNewLocationCode(match.code || "");
    setNewLocationAddress(match.address || "");
    setNewLocationError("");
  }

  function saveLocation() {
    if (!locationEditor) return;
    try {
      const payload = {
        name: newLocationName,
        code: newLocationCode,
        address: newLocationAddress,
      };
      const saved =
        locationEditor.mode === "edit"
          ? locationPickerIsPos
            ? updatePosLocation(locationEditor.originalName, {
                ...payload,
                kind: newLocationKind as PosLocationKind,
              })
            : updateInventoryLocation(locationEditor.originalName, {
                ...payload,
                kind: newLocationKind as InventoryLocationKind,
              })
          : locationPickerIsPos
            ? createPosLocation({
                ...payload,
                kind: newLocationKind as PosLocationKind,
              })
            : createInventoryLocation({
                ...payload,
                kind: newLocationKind as InventoryLocationKind,
              });
      setLocationPickers((prev) => ({ ...prev, [locationEditor.fieldKey]: saved.value }));
      setCoaTick((t) => t + 1);
      resetLocationForm();
    } catch (error) {
      setNewLocationError(
        error instanceof Error
          ? error.message
          : locationEditor.mode === "edit"
            ? "Could not update the location."
            : "Could not create the location.",
      );
    }
  }

  function confirmDeleteLocation() {
    if (!locationEditor || locationEditor.mode !== "edit") return;
    const editor = locationEditor;
    const label = newLocationName.trim() || editor.originalName;
    const selectedName = newLocationName.trim();
    const selectedCode = newLocationCode.trim();
    // Close nested location modal before confirm so dialogs do not stack.
    resetLocationForm();
    askConfirm({
      title: locationPickerIsPos ? "Delete POS location?" : "Delete warehouse / location?",
      message: `Remove “${label}” from ${
        locationPickerIsPos ? "POS → POS Locations" : "Inventory → Locations"
      }? It will no longer appear in pickers.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        try {
          if (locationPickerIsPos) deletePosLocation(editor.originalName);
          else deleteInventoryLocation(editor.originalName);
          setLocationPickers((prev) => {
            const current = prev[editor.fieldKey] || "";
            if (
              current === editor.originalName ||
              current === selectedName ||
              (selectedCode && current === selectedCode)
            ) {
              return { ...prev, [editor.fieldKey]: "" };
            }
            return prev;
          });
          setCoaTick((t) => t + 1);
        } catch (error) {
          setNewLocationError(
            error instanceof Error ? error.message : "Could not delete the location.",
          );
          setLocationEditor(editor);
        }
      },
      onCancel: () => {
        setLocationEditor(editor);
        setNewLocationName(selectedName || editor.originalName);
        setNewLocationCode(selectedCode);
      },
    });
  }

  return (
    <>
    <FeedbackModals feedback={feedback} onClose={closeFeedback} />
    <Dialog
      open={Boolean(state)}
      onOpenChange={(open, details) => {
        // Nested create modals (supplier/location/contractor) must not dismiss the parent form.
        if (!open && (partyCreate || locationEditor || projectRoleCreate)) return;
        // Portalled pickers (Paid from / Payee) live outside Dialog.Popup — their
        // clicks must not close the New Payment / New Receipt form.
        if (!open && details.reason === "outside-press") {
          const target = details.event?.target;
          if (
            target instanceof Element &&
            target.closest(
              '[data-slot="popover-content"], [data-slot="popover"], [data-base-ui-portal]',
            )
          ) {
            details.cancel();
            return;
          }
        }
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={
          isLocationEntityForm
            ? "no-scrollbar max-h-[90dvh] overflow-x-hidden overflow-y-auto sm:max-w-md"
            : "no-scrollbar max-h-[90dvh] overflow-x-hidden overflow-y-auto sm:max-w-3xl"
        }
      >
        <form ref={formRef} onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {isLocationEntityForm
                ? isPosLocationEntity
                  ? state?.mode === "edit"
                    ? "Edit POS location"
                    : "Create POS location"
                  : state?.mode === "edit"
                    ? "Edit warehouse or location"
                    : "Create warehouse or location"
                : isSalesInvoice && invoiceOptions.customTitle && customTitle.trim()
                  ? customTitle.trim()
                  : `${state?.mode === "create" ? "New" : state?.mode === "edit" ? "Edit" : "View"} ${
                      isCoa ? (coaKind === "Group" ? "group" : "account") : definition.singular
                    }`}
            </DialogTitle>
            <DialogDescription>
              {state?.draftId
                ? "Continuing a saved draft. Save as draft again to update it, or Submit / Create to write into the live database."
                : isLocationEntityForm
                ? isPosLocationEntity
                  ? state?.mode === "edit"
                    ? "Update this sales place. Changes are saved under POS → POS Locations."
                    : "Add a place where sales happen (store, kiosk, stall, counter). It is saved under POS → POS Locations."
                  : state?.mode === "edit"
                    ? "Update type, name, code, or address. Changes are saved under Inventory → Locations."
                    : "Choose the type, save it under Inventory → Locations, and it is selected on this field."
                : readOnly
                  ? "Review the complete record and audit timestamps."
                  : definition.key === "bank-and-cash-accounts"
                    ? "Add a real bank or till (e.g. Equity Current) — not Cash-UGX / Bank-UGX. Those stay on Chart of Accounts; pick one under Posts to."
                    : isCoa && coaKind === "Group"
                      ? "Create a group or nest it under another group with Subgroup of."
                      : useDocLines
                        ? "Add one or more line items. The total posts to the ledger."
                        : useJournalLines
                          ? "Enter journal lines. Debits must equal credits."
                          : "Complete the required fields, then save the record."}
            </DialogDescription>
          </DialogHeader>

          {state?.record && isRequestChainEntityKey(definition.key) ? (
            <div className="mt-3">
              <RequestOutcomeBanner record={state.record} />
            </div>
          ) : null}

          <div
            className={
              isLocationEntityForm
                ? "mt-5 grid grid-cols-1 gap-4"
                : "mt-5 grid gap-4 sm:grid-cols-2"
            }
          >
            {isLocationEntityForm && state?.mode === "create" ? (
              <input type="hidden" name="status" value="Active" />
            ) : null}
            {isSalesInvoice && (
              <SalesInvoiceOptionsPanel
                options={invoiceOptions}
                onChange={updateInvoiceOptions}
                readOnly={readOnly}
              />
            )}
            {isSalesInvoice && invoiceOptions.customTitle && (
              <div className="sm:col-span-2">
                <Label htmlFor="customTitle" className="mb-2 text-[12px] text-slate-700">
                  Custom title
                </Label>
                <Input
                  id="customTitle"
                  name="customTitle"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  readOnly={readOnly}
                  placeholder="e.g. Tax Invoice / Proforma"
                />
              </div>
            )}
            {definition.key === "payslips" && (
              <PayslipComputePanel
                initial={{
                  employee: state?.record?.employee,
                  employeeId: state?.record?.employeeId,
                  bankAccount: state?.record?.bankAccount,
                  bankCode: state?.record?.bankCode,
                  accountNumber: state?.record?.accountNumber,
                  department: state?.record?.department,
                  phone: state?.record?.phone,
                  basicPay: state?.record?.basicPay,
                  daysWorked: state?.record?.daysWorked,
                  advances: state?.record?.advances,
                  arrears: state?.record?.arrears,
                }}
                payDate={state?.record?.date || new Date().toISOString().slice(0, 10)}
                readOnly={readOnly}
              />
            )}
            {visibleFields.map((field) => {
              const todayIso = new Date().toISOString().slice(0, 10);
              const defaultTodayDate =
                state?.mode === "create" &&
                field.type === "date" &&
                ["date", "issueDate", "startDate", "acquired", "asOf", "purchaseDate"].includes(
                  field.key,
                );
              const value =
                field.key === "project" && usesProjectHierarchy
                  ? hierarchyProject || state?.record?.[field.key] || ""
                  : field.key === "phase" && usesProjectHierarchy
                    ? hierarchyPhase || state?.record?.[field.key] || ""
                    : field.key === "activity" && usesProjectHierarchy
                      ? hierarchyActivity || state?.record?.[field.key] || ""
                      : definition.key === "vehicles" && vehicleFieldPrefill[field.key]
                      ? vehicleFieldPrefill[field.key]
                      : state?.record?.[field.key] ?? (defaultTodayDate ? todayIso : "");
              const wide = field.type === "textarea" || field.key === "appliedTo";
              const fieldRemountKey =
                definition.key === "vehicles" && vehicleFieldPrefill[field.key]
                  ? `${field.key}-prefill-${vehiclePrefillTick}`
                  : field.key;
              const fieldLocked = readOnly || Boolean(field.readOnly);
              // Desk feedback (amend / reject) only appears when the record has a value.
              if (
                field.readOnly &&
                !(state?.record?.[field.key] || "").trim() &&
                !(value || "").trim()
              ) {
                return null;
              }

              if (
                usesProjectHierarchy &&
                (field.key === "project" || field.key === "phase" || field.key === "activity")
              ) {
                const options = (field.options || []).filter(
                  (option) => !option.startsWith("("),
                );
                const emptyHint =
                  field.key === "project"
                    ? "No projects yet — create one under Projects first."
                    : field.key === "phase"
                      ? "No phases for this project — create them under Phases."
                      : "No activities for this phase — create them under Activities.";
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={value} />
                    <SearchablePicker
                      value={value}
                      readOnly={readOnly}
                      allowClear={!field.required}
                      options={options.map((option) => ({
                        value: option,
                        label: option,
                        searchText: option,
                      }))}
                      placeholder={`Select ${field.label.toLowerCase()}…`}
                      searchPlaceholder={`Search ${field.label.toLowerCase()}…`}
                      emptyText={emptyHint}
                      className="w-full"
                      onChange={(next) => {
                        if (field.key === "project") {
                          setHierarchyProject(next);
                          setHierarchyPhase("");
                          setHierarchyActivity("");
                        } else if (field.key === "phase") {
                          setHierarchyPhase(next);
                          setHierarchyActivity("");
                        } else if (field.key === "activity") {
                          setHierarchyActivity(next);
                        }
                      }}
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      {field.key === "project"
                        ? options.length
                          ? "Choose from Projects already created."
                          : emptyHint
                        : field.key === "phase"
                          ? "Pick a phase under this project (create more under Phases)."
                          : "Pick an activity under this phase (sub-activities are optional)."}
                    </p>
                  </div>
                );
              }
              if (isLocationEntityForm && field.key === "kind") {
                const kinds = isPosLocationEntity
                  ? ([
                      ["store", "Store"],
                      ["kiosk", "Kiosk"],
                      ["counter", "Counter"],
                      ["stall", "Stall"],
                      ["branch", "Branch"],
                      ["market", "Market"],
                      ["other", "Other"],
                    ] as const)
                  : ([
                      ["warehouse", "Warehouse"],
                      ["store", "Store"],
                      ["location", "Location"],
                    ] as const);
                return (
                  <div key={field.key}>
                    <Label className="mb-1.5 text-[12px]">Type</Label>
                    <input type="hidden" name="kind" value={entityLocationKind} />
                    <input type="hidden" name="type" value={entityLocationKind} />
                    <div
                      className={`grid gap-2 ${
                        isPosLocationEntity ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"
                      }`}
                    >
                      {kinds.map(([option, label]) => (
                        <button
                          key={option}
                          type="button"
                          disabled={readOnly}
                          onClick={() => setEntityLocationKind(option)}
                          className={`rounded-lg border px-2 py-2 text-[12px] font-medium transition ${
                            entityLocationKind === option
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                          } disabled:opacity-60`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }

              if (isLocationEntityForm && field.key === "name") {
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-1.5 text-[12px]">
                      Name <span className="text-orange-500">*</span>
                    </Label>
                    <Input
                      id={field.key}
                      name={field.key}
                      defaultValue={value}
                      required
                      readOnly={readOnly}
                      autoFocus={state?.mode === "create"}
                      placeholder={
                        isPosLocationEntity
                          ? entityLocationKind === "kiosk"
                            ? "e.g. Airport kiosk"
                            : entityLocationKind === "stall"
                              ? "e.g. Nakasero stall 12"
                              : entityLocationKind === "counter"
                                ? "e.g. Bar counter"
                                : "e.g. Ntinda store"
                          : entityLocationKind === "warehouse"
                            ? "e.g. Kampala warehouse"
                            : entityLocationKind === "store"
                              ? "e.g. Ntinda store"
                              : "e.g. Showroom"
                      }
                    />
                  </div>
                );
              }

              if (isLocationEntityForm && field.key === "code") {
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-1.5 text-[12px]">
                      Code
                    </Label>
                    <Input
                      id={field.key}
                      name={field.key}
                      defaultValue={value}
                      readOnly={readOnly}
                      placeholder="Optional — auto-generated if blank"
                    />
                  </div>
                );
              }

              if (isLocationEntityForm && field.key === "address") {
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-1.5 text-[12px]">
                      Address
                    </Label>
                    <Input
                      id={field.key}
                      name={field.key}
                      defaultValue={value}
                      readOnly={readOnly}
                      placeholder="Optional street / site address"
                    />
                  </div>
                );
              }

              if (field.key === "appliedTo" && allocationSide) {
                const current = appliedToValue || value;
                const pickerOptions = openDocs.map((doc) => ({
                  value: doc.reference || doc.id,
                  label: doc.label,
                  meta: doc.reference || undefined,
                  searchText: `${doc.label} ${doc.reference || ""} ${doc.id}`,
                }));
                if (current && !pickerOptions.some((o) => o.value === current)) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    meta: "Current",
                    searchText: current,
                  });
                }
                return (
                  <div key={field.key} className="sm:col-span-2">
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                    </Label>
                    <input type="hidden" name={field.key} value={current} />
                    <SearchablePicker
                      value={current}
                      readOnly={readOnly}
                      options={pickerOptions}
                      placeholder="Search open documents…"
                      searchPlaceholder="Type invoice/bill reference…"
                      emptyText="No open documents"
                      onChange={(next) => {
                        setAppliedToValue(next);
                        const doc = openDocs.find(
                          (row) =>
                            (row.reference || row.id) === next ||
                            row.id === next ||
                            row.reference === next,
                        );
                        if (!doc) return;
                        // Capture the supplier/customer on the bill so statements match.
                        if (doc.party) setPartyValue(doc.party);
                        // Prefill open balance when amount is still empty.
                        if (!moneyAmountValue.trim() && doc.balance > 0) {
                          setMoneyAmountValue(String(doc.balance));
                        }
                      }}
                    />
                  </div>
                );
              }
              if (isCoa && field.key === "kind") {
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      <span className="text-orange-500">*</span>
                    </Label>
                    <select
                      id={field.key}
                      name={field.key}
                      value={coaKind}
                      disabled={readOnly}
                      onChange={(e) => setCoaKind(e.target.value)}
                      className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:bg-slate-50"
                    >
                      <option value="Account">Account</option>
                      <option value="Group">Group</option>
                    </select>
                  </div>
                );
              }
              if (isCoa && (field.key === "group" || field.key === "parentGroup")) {
                const options = field.key === "parentGroup" ? parentGroupOptions : groupOptions;
                return (
                  <div key={field.key} className="sm:col-span-2">
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.key === "parentGroup" ? "Subgroup of" : "Group"}
                      {field.key === "group" && coaKind === "Account" ? (
                        <span className="text-orange-500">*</span>
                      ) : null}
                    </Label>
                    <select
                      id={field.key}
                      name={field.key}
                      defaultValue={value}
                      required={field.key === "group" && coaKind === "Account"}
                      disabled={readOnly}
                      className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:bg-slate-50"
                    >
                      <option value="">
                        {field.key === "parentGroup"
                          ? "Top-level group (not a subgroup)"
                          : "Select group"}
                      </option>
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    {field.key === "parentGroup" && (
                      <p className="mt-1 text-[11px] text-slate-400">
                        Leave blank for a top-level group, or pick a parent to nest this as a subgroup.
                      </p>
                    )}
                  </div>
                );
              }
              if (
                definition.key === "employees" &&
                (field.key === "bankAccount" || field.key === "bankCode")
              ) {
                void staffListsTick;
                if (field.key === "bankCode") {
                  return (
                    <div key={field.key}>
                      <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                        {field.label}
                      </Label>
                      <Input
                        id={field.key}
                        name="bankCode"
                        value={employeeBankCode}
                        readOnly={readOnly}
                        onChange={(e) => setEmployeeBankCode(e.target.value)}
                        placeholder="Auto-filled from bank"
                      />
                      <p className="mt-1 text-[10px] text-slate-400">
                        Fills from the bank list; edit if your bank uses a different code.
                      </p>
                    </div>
                  );
                }
                const current = employeeBank;
                const options = ugandaBankSelectOptions();
                const pickerOptions: {
                  value: string;
                  label: string;
                  group?: string;
                  meta?: string;
                  searchText: string;
                }[] = options.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  group: "group" in opt && typeof opt.group === "string" ? opt.group : undefined,
                  meta: "code" in opt && opt.code ? String(opt.code) : undefined,
                  searchText: `${opt.label} ${"code" in opt ? opt.code || "" : ""}`,
                }));
                if (current && !pickerOptions.some((o) => o.value === current)) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    group: "Your banks",
                    meta: employeeBankCode || undefined,
                    searchText: `${current} ${employeeBankCode}`,
                  });
                }
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={current} />
                    <SearchablePicker
                      value={current}
                      readOnly={readOnly}
                      allowCustom
                      customLabel={(text) => `Add bank “${text}”`}
                      options={pickerOptions}
                      placeholder="Select bank"
                      searchPlaceholder="Search bank or code…"
                      emptyText="No banks match"
                      onChange={(next) => {
                        setEmployeeBank(next);
                        const code = bankCodeForName(next);
                        setEmployeeBankCode(code);
                        addCustomUgandaBank(next);
                        setStaffListsTick((n) => n + 1);
                      }}
                      className="w-full"
                    />
                    <p className="mt-1 text-[10px] text-slate-400">
                      Uganda banks with bank codes — type to add your own.
                    </p>
                  </div>
                );
              }
              if (field.key === "department") {
                void staffListsTick;
                const current = employeeDepartment;
                const options = employeeDepartmentSelectOptions();
                const pickerOptions: {
                  value: string;
                  label: string;
                  searchText: string;
                }[] = options.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  searchText: opt.label,
                }));
                if (current && !pickerOptions.some((o) => o.value === current)) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    searchText: current,
                  });
                }
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={current} />
                    <SearchablePicker
                      value={current}
                      readOnly={readOnly}
                      allowCustom
                      customLabel={(text) => `Add department “${text}”`}
                      options={pickerOptions}
                      placeholder="Select department"
                      searchPlaceholder="Search or type a department…"
                      emptyText="No departments match"
                      onChange={(next) => {
                        setEmployeeDepartment(next);
                        addEmployeeDepartment(next);
                        setStaffListsTick((n) => n + 1);
                      }}
                      className="w-full"
                    />
                    <p className="mt-1 text-[10px] text-slate-400">
                      From HR → Departments — type to create a new one.
                    </p>
                  </div>
                );
              }
              if (
                field.key === "category" &&
                (definition.key === "suppliers" || /supplier/i.test(field.label || ""))
              ) {
                const usedCategories = siblingRecords
                  .map((row) => (row.category || "").trim())
                  .filter(Boolean);
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <SupplierCategorySelect
                      id={field.key}
                      name={field.key}
                      value={supplierCategory}
                      onChange={setSupplierCategory}
                      required={field.required}
                      disabled={readOnly}
                      extraNames={usedCategories}
                    />
                  </div>
                );
              }
              if (field.key === "vehicle" && definition.key !== "vehicles") {
                void staffListsTick;
                const current = vehicleValue || value;
                const options = fleetVehicleSelectOptions();
                const pickerOptions: {
                  value: string;
                  label: string;
                  meta?: string;
                  searchText: string;
                }[] = options.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  meta: opt.meta,
                  searchText: `${opt.label} ${opt.meta || ""}`,
                }));
                if (current && !pickerOptions.some((o) => o.value === current)) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    searchText: current,
                  });
                }
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={current} />
                    <SearchablePicker
                      value={current}
                      readOnly={readOnly}
                      allowCustom
                      customLabel={(text) => `Use vehicle “${text}”`}
                      options={pickerOptions}
                      placeholder="Select vehicle"
                      searchPlaceholder="Search asset register or fleet…"
                      emptyText="No vehicles match"
                      onChange={(next) => {
                        setVehicleValue(next);
                        setStaffListsTick((n) => n + 1);
                      }}
                      className="w-full"
                    />
                    {!options.length ? (
                      <p className="mt-1 text-[11px] text-amber-600">
                        No motor vehicles yet — add them under Assets → Fixed Assets (registration
                        or Motor vehicles group), or Fleet → Vehicles.
                      </p>
                    ) : (
                      <p className="mt-1 text-[10px] text-slate-400">
                        From Assets → Fixed Assets (motor vehicles), plus Fleet → Vehicles.
                      </p>
                    )}
                  </div>
                );
              }
              if (MAINTENANCE_RECORD_PICKERS[field.key]?.on.includes(definition.key)) {
                void staffListsTick;
                const picker = MAINTENANCE_RECORD_PICKERS[field.key]!;
                const current =
                  field.key in maintenancePickers ? maintenancePickers[field.key] : value;
                const parentValue = picker.dependsOn
                  ? (picker.dependsOn in maintenancePickers
                      ? maintenancePickers[picker.dependsOn]
                      : state?.record?.[picker.dependsOn] || "")
                  : "";
                const pickerOptions = maintenanceRecordOptions(field.key, {
                  ...(picker.dependsOn ? { [picker.dependsOn]: parentValue } : {}),
                });
                if (current && !pickerOptions.some((o) => o.value === current)) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    meta: "Current",
                    searchText: current,
                  });
                }
                // A job card belongs to its work order for good; MES has no
                // way to move one, so the picker locks once the card exists.
                const locked = readOnly || (state?.mode === "edit" && field.key === "workOrder");
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={current} />
                    <SearchablePicker
                      value={current}
                      readOnly={locked}
                      allowClear={!field.required}
                      allowCustom={picker.allowCustom}
                      customLabel={picker.allowCustom ? (text) => `Use “${text}”` : undefined}
                      options={pickerOptions}
                      placeholder={picker.placeholder}
                      searchPlaceholder={picker.placeholder}
                      emptyText={picker.dependsOn && !parentValue ? picker.dependsOnEmpty || picker.empty : picker.empty}
                      onChange={(next) => {
                        setMaintenancePickers((prev) => {
                          const out = { ...prev, [field.key]: next };
                          // A new factory empties the shop floor chosen in the old one.
                          for (const [key, child] of Object.entries(MAINTENANCE_RECORD_PICKERS)) {
                            if (child.dependsOn === field.key && child.on.includes(definition.key)) {
                              const kept = (out[key] ?? state?.record?.[key] ?? "").trim();
                              const stillThere = maintenanceRecordOptions(key, { [field.key]: next }).some(
                                (o) => o.value === kept,
                              );
                              if (!stillThere) out[key] = "";
                            }
                          }
                          return out;
                        });
                        setStaffListsTick((n) => n + 1);
                      }}
                      className="w-full"
                    />
                  </div>
                );
              }
              if (
                field.key === "workCenter" ||
                field.key === "roaster" ||
                field.key === "line"
              ) {
                void staffListsTick;
                const current =
                  field.key === "roaster"
                    ? roasterValue || value
                    : field.key === "line"
                      ? lineValue || value
                      : workCenterValue || value;
                const typeFilter =
                  field.key === "roaster"
                    ? /roaster/i
                    : field.key === "line"
                      ? /packag/i
                      : undefined;
                const options = workCenterSelectOptions(typeFilter, factoryInScope);
                // Fall back to all machines when the typed filter has none yet.
                const effective = options.length
                  ? options
                  : workCenterSelectOptions(undefined, factoryInScope);
                const pickerOptions = effective.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  meta: opt.meta,
                  searchText: `${opt.label} ${opt.meta || ""}`,
                }));
                if (current && !pickerOptions.some((o) => o.value === current)) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    meta: "Current",
                    searchText: current,
                  });
                }
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={current} />
                    <SearchablePicker
                      value={current}
                      readOnly={readOnly}
                      allowClear={!field.required}
                      allowCustom
                      customLabel={(text) => `Use machine “${text}”`}
                      options={pickerOptions}
                      placeholder="Select machine…"
                      searchPlaceholder="Search machines / work centers…"
                      emptyText="No machines yet — register them under Maintenance → Machines."
                      onChange={(next) => {
                        if (field.key === "roaster") setRoasterValue(next);
                        else if (field.key === "line") setLineValue(next);
                        else setWorkCenterValue(next);
                        setStaffListsTick((n) => n + 1);
                      }}
                      className="w-full"
                    />
                    {!effective.length ? (
                      <p className="mt-1 text-[11px] text-amber-600">
                        No machines yet — register them under Maintenance → Machines first.
                      </p>
                    ) : (
                      <p className="mt-1 text-[10px] text-slate-400">
                        From Maintenance → Machines. Saves the machine&apos;s asset code.
                      </p>
                    )}
                  </div>
                );
              }
              if (field.key === "contractor") {
                void staffListsTick;
                const current = contractorValue || value;
                const options = contractorSelectOptions();
                const pickerOptions = options.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  meta: opt.meta,
                  searchText: `${opt.label} ${opt.meta || ""}`,
                }));
                if (current && !pickerOptions.some((o) => o.value === current)) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    meta: "Current",
                    searchText: current,
                  });
                }
                const onProjectsForm = definition.key === "projects";
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={current} />
                    <div className="flex items-center gap-2">
                      <SearchablePicker
                        value={current}
                        readOnly={readOnly}
                        allowClear={!field.required}
                        options={pickerOptions}
                        placeholder="Select contractor…"
                        searchPlaceholder="Search contractors…"
                        emptyText={
                          onProjectsForm
                            ? "No contractors yet — use + to add one."
                            : "No contractors yet — add them under Contract Manager → Contractors."
                        }
                        createActionLabel={
                          readOnly || !onProjectsForm ? undefined : "Add new contractor…"
                        }
                        onCreateAction={
                          readOnly || !onProjectsForm
                            ? undefined
                            : () => setProjectRoleCreate({ kind: "contractor", initialName: "" })
                        }
                        onChange={(next) => setContractorValue(next)}
                        className="min-w-0 flex-1"
                      />
                      {onProjectsForm && !readOnly ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 w-9 shrink-0 rounded-lg border-slate-200 p-0 text-slate-600 hover:bg-slate-50"
                          title="Add new contractor"
                          aria-label="Add new contractor"
                          onClick={() =>
                            setProjectRoleCreate({ kind: "contractor", initialName: "" })
                          }
                        >
                          <Add size={15} color="currentColor" />
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {onProjectsForm
                        ? "From Contract Manager → Contractors, or use + to add."
                        : "From Contract Manager → Contractors."}
                    </p>
                  </div>
                );
              }
              if (field.key === "manager") {
                void staffListsTick;
                const current = managerValue || value;
                const options = projectManagerSelectOptions();
                const pickerOptions = options.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  meta: opt.meta,
                  searchText: `${opt.label} ${opt.meta || ""}`,
                }));
                if (current && !pickerOptions.some((o) => o.value === current)) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    meta: "Current",
                    searchText: current,
                  });
                }
                const onProjectsForm = definition.key === "projects";
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={current} />
                    <div className="flex items-center gap-2">
                      <SearchablePicker
                        value={current}
                        readOnly={readOnly}
                        allowClear={!field.required}
                        options={pickerOptions}
                        placeholder="Select project manager…"
                        searchPlaceholder="Search project managers…"
                        emptyText={
                          onProjectsForm
                            ? "No project managers yet — use + to add one."
                            : "No project managers yet — add them under Project Manager → Project managers."
                        }
                        createActionLabel={
                          readOnly || !onProjectsForm
                            ? undefined
                            : "Add new project manager…"
                        }
                        onCreateAction={
                          readOnly || !onProjectsForm
                            ? undefined
                            : () =>
                                setProjectRoleCreate({
                                  kind: "project-manager",
                                  initialName: "",
                                })
                        }
                        onChange={(next) => setManagerValue(next)}
                        className="min-w-0 flex-1"
                      />
                      {onProjectsForm && !readOnly ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 w-9 shrink-0 rounded-lg border-slate-200 p-0 text-slate-600 hover:bg-slate-50"
                          title="Add new project manager"
                          aria-label="Add new project manager"
                          onClick={() =>
                            setProjectRoleCreate({
                              kind: "project-manager",
                              initialName: "",
                            })
                          }
                        >
                          <Add size={15} color="currentColor" />
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {onProjectsForm
                        ? "From Project Manager → Project managers, or use + to add."
                        : "From Project Manager → Project managers."}
                    </p>
                  </div>
                );
              }
              if (field.key === "driver") {
                void staffListsTick;
                const current = driverValue;
                const options = fleetDriverSelectOptions();
                const pickerOptions: {
                  value: string;
                  label: string;
                  searchText: string;
                }[] = options.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  searchText: opt.label,
                }));
                if (current && !pickerOptions.some((o) => o.value === current)) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    searchText: current,
                  });
                }
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={current} />
                    <SearchablePicker
                      value={current}
                      readOnly={readOnly}
                      allowCustom
                      customLabel={(text) => `Add driver “${text}”`}
                      options={pickerOptions}
                      placeholder="Select driver"
                      searchPlaceholder="Search or type a driver…"
                      emptyText="No drivers match"
                      onChange={(next) => {
                        setDriverValue(next);
                        ensureDriverRecord(next);
                        setStaffListsTick((n) => n + 1);
                      }}
                      className="w-full"
                    />
                    <p className="mt-1 text-[10px] text-slate-400">
                      From Fleet → Drivers — type to create a new driver.
                    </p>
                  </div>
                );
              }
              if (field.key === "name" && definition.key === "vehicles") {
                void staffListsTick;
                const current = vehicleNameValue || value;
                const options = fixedAssetSelectOptions();
                const pickerOptions: {
                  value: string;
                  label: string;
                  meta?: string;
                  searchText: string;
                }[] = options.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  meta: opt.meta,
                  searchText: `${opt.label} ${opt.meta || ""}`,
                }));
                // Keep free-text / existing names selectable even if not on the register.
                if (current && !pickerOptions.some((o) => o.value === current)) {
                  const linked = fixedAssetValue.trim();
                  if (!linked || !pickerOptions.some((o) => o.value === linked)) {
                    pickerOptions.unshift({
                      value: current,
                      label: current,
                      searchText: current,
                    });
                  }
                }
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={vehicleNameValue || current} />
                    <SearchablePicker
                      value={
                        fixedAssetValue &&
                        pickerOptions.some((o) => o.value === fixedAssetValue)
                          ? fixedAssetValue
                          : current
                      }
                      readOnly={readOnly}
                      allowCustom
                      customLabel={(text) => `Use vehicle “${text}”`}
                      options={pickerOptions}
                      placeholder="Select from fixed assets"
                      searchPlaceholder="Search Assets → Fixed Assets…"
                      emptyText="No fixed assets match"
                      onChange={(next) => {
                        const asset = findFixedAssetByKey(next);
                        if (asset) {
                          const code = (asset.code || "").trim();
                          const name = (asset.name || "").trim() || next;
                          const registration = (
                            asset.registrationNumber ||
                            asset.registration ||
                            ""
                          ).trim();
                          // Fixed assets often store the model in `name` / `serialModel`.
                          const makeModel =
                            (asset.serialModel || "").trim() ||
                            (asset.makeModel || "").trim() ||
                            name;
                          const location = (asset.location || "").trim();
                          const acquired = (asset.acquired || "").trim();
                          const typeGuess = guessVehicleType(asset);
                          setVehicleNameValue(name);
                          setFixedAssetValue(code || name);
                          if (code) setCodeValue(code);
                          setMakeModelValue(makeModel);
                          setRegistrationValue(registration);
                          if (typeGuess) setVehicleTypeValue(typeGuess);
                          setVehicleFieldPrefill({
                            ...(code ? { code } : {}),
                            ...(registration ? { registration } : {}),
                            ...(makeModel ? { makeModel } : {}),
                            ...(location ? { location } : {}),
                            ...(acquired ? { acquired } : {}),
                            ...(typeGuess ? { type: typeGuess } : {}),
                          });
                          setVehiclePrefillTick((n) => n + 1);
                        } else {
                          setVehicleNameValue(next);
                          setFixedAssetValue((prev) => prev || next);
                        }
                        setStaffListsTick((n) => n + 1);
                      }}
                      className="w-full"
                    />
                    {!options.length ? (
                      <p className="mt-1 text-[11px] text-amber-600">
                        No fixed assets yet — add them under Assets → Fixed Assets first.
                      </p>
                    ) : (
                      <p className="mt-1 text-[10px] text-slate-400">
                        From Assets → Fixed Assets — fills code, plate, and make/model.
                      </p>
                    )}
                  </div>
                );
              }
              if (field.key === "fixedAsset" && definition.key === "vehicles") {
                // Linked via Vehicle name picker above — keep a hidden field for saves.
                return (
                  <input
                    key={field.key}
                    type="hidden"
                    name={field.key}
                    value={fixedAssetValue}
                  />
                );
              }
              if (field.key === "makeModel" && definition.key === "vehicles") {
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <Input
                      id={field.key}
                      name={field.key}
                      value={makeModelValue}
                      onChange={(e) => setMakeModelValue(e.target.value)}
                      required={field.required}
                      readOnly={readOnly}
                      placeholder="Filled from fixed asset"
                    />
                  </div>
                );
              }
              if (field.key === "registration" && definition.key === "vehicles") {
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <Input
                      id={field.key}
                      name={field.key}
                      value={registrationValue}
                      onChange={(e) => setRegistrationValue(e.target.value)}
                      required={field.required}
                      readOnly={readOnly}
                      placeholder="Filled from fixed asset"
                    />
                  </div>
                );
              }
              if (field.key === "type" && definition.key === "vehicles") {
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <select
                      id={field.key}
                      name={field.key}
                      value={vehicleTypeValue}
                      onChange={(e) => setVehicleTypeValue(e.target.value)}
                      required={field.required}
                      disabled={readOnly}
                      className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:bg-slate-50"
                    >
                      <option value="">Select type</option>
                      {(field.options || []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }
              if (
                field.key === "division" ||
                field.key === "costCenter" ||
                /^class\s*\/\s*division$/i.test(field.label || "")
              ) {
                return (
                  <div key={field.key} className="sm:col-span-2">
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={divisionValue} />
                    <DivisionSelect
                      value={divisionValue}
                      onChange={setDivisionValue}
                      disabled={readOnly}
                      emptyLabel="Select class (e.g. Coffee, Cosmetics…)"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Tag this transaction by business line — manage list under Settings → Divisions
                      (Classes).
                    </p>
                  </div>
                );
              }
              if (
                !isCoa &&
                usesCoaPicker(definition.key, field.key, field.label) &&
                !(
                  (definition.key === "employees" || definition.key === "payslips") &&
                  field.key === "bankAccount"
                )
              ) {
                const filter = coaPickerFilterForField(
                  field.key,
                  field.label,
                  definition.key,
                );
                const useBankList = Boolean(filter?.fromBankList);
                const bankOpts = bankAccountOptions;
                // When Bank & Cash Accounts is empty, fall back to CoA bank/cash so
                // receipts / fuel / payments still work for every user.
                const coaBankFallback =
                  useBankList && !bankOpts.length
                    ? coaAccountSelectOptions({ bankLike: true })
                    : [];
                const usingCoaBankFallback = useBankList && !bankOpts.length;
                const options = useBankList
                  ? bankOpts.length
                    ? bankOpts
                    : coaBankFallback
                  : filter?.bankLike || filter?.fixedAssetLike || filter?.types?.length
                    ? coaAccountSelectOptions({
                        bankLike: filter?.bankLike,
                        fixedAssetLike: filter?.fixedAssetLike,
                        types: filter?.types,
                      })
                    : allAccountOptions;
                const current = accountPickers[field.key] ?? value;
                const pickerOptions = options.map((opt) => ({
                  value: opt.value,
                  label: useBankList && !usingCoaBankFallback ? opt.name || opt.value : opt.label,
                  group:
                    useBankList && !usingCoaBankFallback
                      ? undefined
                      : opt.group || opt.type,
                  meta:
                    useBankList && !usingCoaBankFallback
                      ? opt.accountNumber || undefined
                      : opt.code
                        ? `Code ${opt.code}`
                        : undefined,
                  searchText:
                    useBankList && !usingCoaBankFallback
                      ? `${opt.name || opt.value} ${opt.accountNumber || ""}`
                      : `${opt.code} ${opt.name || opt.value} ${opt.group || ""} ${opt.type || ""}`,
                }));
                if (current && !options.some((o) => o.value === current)) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    group: useBankList && !usingCoaBankFallback ? undefined : "Current",
                    meta: undefined,
                    searchText: current,
                  });
                }
                return (
                  <div key={field.key} className="sm:col-span-2">
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input
                      type="hidden"
                      name={field.key}
                      value={current}
                    />
                    <SearchablePicker
                      value={current}
                      onChange={(next) => {
                        setAccountPickers((prev) => {
                          const patch: Record<string, string> = { ...prev, [field.key]: next };
                          // Creating a bank account: CoA pick fills currency (and suggests type).
                          if (
                            definition.key === "bank-and-cash-accounts" &&
                            field.key === "glAccount"
                          ) {
                            const match = options.find((o) => o.value === next);
                            if (match?.code) patch.code = match.code;
                          }
                          return patch;
                        });
                        if (
                          definition.key === "bank-and-cash-accounts" &&
                          field.key === "glAccount"
                        ) {
                          const match = options.find((o) => o.value === next);
                          // Only suggest currency from CoA when the user has not chosen one yet.
                          if (match?.currency && !currencyValue) {
                            setCurrencyValue(match.currency);
                          }
                        }
                        // Receipts / payments must match the bank account's currency
                        // or accounting controls block the save.
                        if (
                          (definition.key === "receipts" || definition.key === "payments") &&
                          (field.key === "account" ||
                            field.key === "bankAccount" ||
                            field.key === "paidFrom")
                        ) {
                          const match = options.find((o) => o.value === next);
                          if (match?.currency) {
                            setCurrencyValue(String(match.currency).toUpperCase());
                          }
                        }
                      }}
                      options={pickerOptions}
                      readOnly={readOnly}
                      placeholder={
                        useBankList
                          ? usingCoaBankFallback
                            ? "Select bank / cash account"
                            : "Select bank account"
                          : filter?.fixedAssetLike
                            ? "Search fixed asset accounts"
                            : filter?.bankLike
                              ? "Search bank / cash in Chart of Accounts"
                              : "Search chart of accounts"
                      }
                      searchPlaceholder={
                        useBankList
                          ? "Search bank accounts…"
                          : "Type to search accounts…"
                      }
                      emptyText={
                        useBankList ? "No bank accounts match" : "No accounts match"
                      }
                      className="w-full"
                    />
                    {!options.length && (
                      <p className="mt-1 text-[11px] text-amber-600">
                        {useBankList
                          ? BANK_ACCOUNT_CREATE_HINT
                          : filter?.fixedAssetLike
                            ? "No fixed asset accounts in the Chart of Accounts yet — add them under Accounts → Chart of Accounts (e.g. Motor Vehicles, Furniture and Equipment)."
                            : filter?.bankLike
                            ? "No bank/cash accounts in the Chart of Accounts yet — add them under Accounts → Chart of Accounts first."
                            : "No accounts yet — add them under Accounts → Chart of Accounts."}
                      </p>
                    )}
                    {useBankList && options.length && !usingCoaBankFallback ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        From Banking → Bank & Cash Accounts (each one is linked to Chart of Accounts).
                      </p>
                    ) : null}
                    {usingCoaBankFallback && options.length ? (
                      <p className="mt-1 text-[11px] text-amber-700">
                        Showing Chart of Accounts bank/cash accounts. For named tills (e.g. Equity
                        Current), add them under Banking → Bank & Cash Accounts.
                      </p>
                    ) : null}
                    {definition.key === "bank-and-cash-accounts" && field.key === "glAccount" ? (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Ledger account only (Cash-UGX, Bank-UGX, …). The bank account name above is
                        what you use on receipts and payments — not these CoA names.
                      </p>
                    ) : null}
                  </div>
                );
              }
              if (isInventoryItemPickerField(field.key, field.label)) {
                const current = itemPickers[field.key] ?? value;
                const usePosProducts = definition.key === "pos-stock-in";
                const itemOptions = usePosProducts ? stockItemOptions : inventoryItemOptions;
                const pickerOptions = itemOptions.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  meta:
                    opt.quantity || opt.quantity === 0
                      ? `On hand ${opt.quantity}`
                      : opt.code || undefined,
                  searchText: `${opt.code} ${opt.name} ${opt.value}`,
                }));
                if (
                  current &&
                  !itemOptions.some(
                    (o) =>
                      o.value === current ||
                      o.name === current ||
                      o.code === current ||
                      o.label === current,
                  )
                ) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    meta: "Current",
                    searchText: current,
                  });
                }
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={current} />
                    <SearchablePicker
                      value={current}
                      onChange={(next) => {
                        setItemPickers((prev) => ({ ...prev, [field.key]: next }));
                        if (
                          definition.key === "stock-in" ||
                          definition.key === "pos-stock-in" ||
                          definition.key === "inventory-write-offs"
                        ) {
                          const match = itemOptions.find(
                            (opt) =>
                              opt.value === next || opt.name === next || opt.code === next,
                          );
                          if (match?.purchasePrice && !inventoryUnitCostValue) {
                            setInventoryUnitCostValue(match.purchasePrice);
                          }
                        }
                        if (definition.key === "inventory-sales") {
                          const match = itemOptions.find(
                            (opt) =>
                              opt.value === next || opt.name === next || opt.code === next,
                          );
                          if (match?.salesPrice && !inventoryUnitPriceValue) {
                            setInventoryUnitPriceValue(match.salesPrice);
                          }
                        }
                      }}
                      options={pickerOptions}
                      readOnly={readOnly}
                      placeholder={
                        usePosProducts ? "Select POS product" : "Select inventory item"
                      }
                      searchPlaceholder={
                        usePosProducts
                          ? "Search POS products…"
                          : "Search inventory items…"
                      }
                      emptyText={
                        usePosProducts
                          ? "No POS products match"
                          : "No inventory items match"
                      }
                      className="w-full"
                    />
                    {!itemOptions.length && (
                      <p className="mt-1 text-[11px] text-amber-600">
                        {usePosProducts
                          ? "No POS products yet — add them under POS → POS Products."
                          : "No inventory items yet — add them under Inventory → Inventory items."}
                      </p>
                    )}
                  </div>
                );
              }
              if (usesWarehouseLocationPicker(definition.key, field.key, field.label)) {
                const current = locationPickers[field.key] ?? value;
                const pickerOptions = activeLocationOptions.map((location) => ({
                  value: location.value,
                  label: location.label,
                  meta:
                    [location.kind ? location.kind : null, location.address || location.code || null]
                      .filter(Boolean)
                      .join(" · ") || undefined,
                  searchText: `${location.code} ${location.value} ${location.address} ${location.kind || ""}`,
                  group: locationPickerIsPos
                    ? location.kind === "kiosk"
                      ? "Kiosks"
                      : location.kind === "counter"
                        ? "Counters"
                        : location.kind === "stall"
                          ? "Stalls"
                          : location.kind === "branch"
                            ? "Branches"
                            : location.kind === "market"
                              ? "Markets"
                              : "Stores & places"
                    : location.kind === "warehouse"
                      ? "Warehouses"
                      : location.kind === "store"
                        ? "Stores"
                        : "Locations",
                }));
                if (
                  current &&
                  !activeLocationOptions.some(
                    (location) =>
                      location.value === current ||
                      location.code === current ||
                      location.label === current,
                  )
                ) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    meta: "Current",
                    searchText: current,
                    group: locationPickerIsPos ? "Stores & places" : "Locations",
                  });
                }
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={current} />
                    <div className="flex items-center gap-1.5">
                      <SearchablePicker
                        value={current}
                        onChange={(next) =>
                          setLocationPickers((prev) => ({ ...prev, [field.key]: next }))
                        }
                        options={pickerOptions}
                        readOnly={readOnly}
                        placeholder={
                          locationPickerIsPos
                            ? "Select POS sales place"
                            : "Select store or warehouse"
                        }
                        searchPlaceholder={
                          locationPickerIsPos
                            ? "Search POS locations…"
                            : "Search configured locations…"
                        }
                        emptyText={
                          locationPickerIsPos
                            ? "No POS locations match"
                            : "No configured locations match"
                        }
                        className="w-full"
                        createActionLabel={
                          readOnly
                            ? undefined
                            : locationPickerIsPos
                              ? "Create POS location…"
                              : "Create warehouse or location…"
                        }
                        onCreateAction={
                          readOnly ? undefined : () => openCreateLocation(field.key)
                        }
                      />
                      {!readOnly && current ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 w-9 shrink-0 rounded-lg border-slate-200 p-0 text-slate-600 hover:bg-slate-50"
                          title={locationPickerIsPos ? "Edit POS location" : "Edit warehouse or location"}
                          aria-label={
                            locationPickerIsPos ? "Edit POS location" : "Edit warehouse or location"
                          }
                          onClick={() => openEditLocation(field.key)}
                        >
                          <Edit2 size={15} variant="Linear" color="currentColor" />
                        </Button>
                      ) : null}
                      {!readOnly && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 w-9 shrink-0 rounded-lg border-slate-200 p-0 text-slate-600 hover:bg-slate-50"
                          title={
                            locationPickerIsPos
                              ? "Create POS location"
                              : "Create warehouse or location"
                          }
                          aria-label={
                            locationPickerIsPos
                              ? "Create POS location"
                              : "Create warehouse or location"
                          }
                          onClick={() => openCreateLocation(field.key)}
                        >
                          <Add size={15} color="currentColor" />
                        </Button>
                      )}
                    </div>
                    {!activeLocationOptions.length && (
                      <p className="mt-1 text-[11px] text-amber-600">
                        {locationPickerIsPos
                          ? "No POS locations yet — add them under POS → POS Locations, or create one here."
                          : "No locations yet — choose “Create warehouse or location…” in the list."}
                      </p>
                    )}
                  </div>
                );
              }
              if (field.key === "tax" || field.key === "taxCode") {
                const byRate = field.key === "tax";
                const options = byRate ? taxRateOptions : taxNameOptions;
                const current = byRate
                  ? taxRate
                    ? String(taxRate)
                    : ""
                  : taxLabel || state?.record?.taxCode || value;
                const pickerOptions = options.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  meta: byRate ? `${opt.name}` : `${opt.rate}%`,
                  searchText: `${opt.name} ${opt.rate} ${opt.value}`,
                }));
                if (
                  current &&
                  !options.some((o) => o.value === current || o.rate === current || o.name === current)
                ) {
                  pickerOptions.unshift({
                    value: current,
                    label: byRate ? `${current}%` : current,
                    meta: "Current",
                    searchText: current,
                  });
                }
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {byRate ? "Tax" : field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <input type="hidden" name={field.key} value={current} />
                    <SearchablePicker
                      value={current}
                      readOnly={readOnly}
                      options={pickerOptions}
                      placeholder="Search tax codes…"
                      searchPlaceholder="Type to search tax…"
                      emptyText="No tax codes match"
                      onChange={(selected) => {
                        if (byRate) {
                          const match = taxRateOptions.find((o) => o.value === selected);
                          setTaxRate(parseAmount(selected));
                          setTaxLabel(match?.name || "");
                        } else {
                          const match = taxNameOptions.find((o) => o.value === selected);
                          setTaxLabel(selected);
                          setTaxRate(parseAmount(match?.rate));
                        }
                      }}
                    />
                    {!options.length && (
                      <p className="mt-1 text-[11px] text-amber-600">
                        No tax codes yet — add them under Settings → Tax codes.
                      </p>
                    )}
                    {byRate && taxRate > 0 && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        {taxRate}% will be added to the line-item subtotal.
                      </p>
                    )}
                  </div>
                );
              }
              if (field.key === "currency" || field.key === "currencyCode") {
                const current = (currencyValue || value || "").toUpperCase();
                const selected = currencyOptions.find(
                  (o) => o.value === current || o.code === current,
                );
                const pickerOptions = currencyOptions.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                  meta: opt.isBase
                    ? "Base currency"
                    : opt.rate
                      ? `Rate ${opt.rate}`
                      : undefined,
                  searchText: `${opt.code} ${opt.name} ${opt.symbol} ${opt.rate}`,
                }));
                if (
                  current &&
                  !currencyOptions.some(
                    (o) => o.value === current || o.code === current || o.name.toUpperCase() === current,
                  )
                ) {
                  pickerOptions.unshift({
                    value: current,
                    label: current,
                    meta: "Current",
                    searchText: current,
                  });
                }
                return (
                  <Fragment key={field.key}>
                    <div>
                      <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                        {field.label}
                        {field.required && <span className="text-orange-500">*</span>}
                      </Label>
                      <input type="hidden" name={field.key} value={current} />
                      <SearchablePicker
                        value={current}
                        readOnly={readOnly}
                        options={pickerOptions}
                        placeholder="Search currencies…"
                        searchPlaceholder="Type currency code or name…"
                        emptyText="No currencies match"
                        onChange={(next) => applyDocCurrency(next)}
                      />
                      {!currencyOptions.length ? (
                        <p className="mt-1 text-[11px] text-amber-600">
                          No currencies yet — add them under Settings → Currencies.
                        </p>
                      ) : selected && !selected.isBase && selected.rate ? (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Latest rate: 1 {selected.code} = {selected.rate}{" "}
                          {loadManagerSettings().baseCurrencyCode}
                          {" · "}
                          amounts convert automatically when currency changes
                        </p>
                      ) : selected?.isBase ? (
                        <p className="mt-1 text-[11px] text-slate-500">
                          System base currency — ledger posts in this currency.
                        </p>
                      ) : selected && !selected.rate ? (
                        <p className="mt-1 text-[11px] text-amber-600">
                          No exchange rate yet — add one under Settings → Exchange rates.
                        </p>
                      ) : null}
                    </div>
                    {definition.key === "suppliers" && field.key === "currency" ? (
                      <SupplierOpeningBalancesFields
                        defaultBalances={state?.record?.openingBalances || ""}
                        defaultDate={state?.record?.openingBalanceDate || ""}
                        readOnly={readOnly}
                      />
                    ) : null}
                  </Fragment>
                );
              }
              {
                const side = partyPickerSide(field.key, field.label);
                if (side) {
                  const options =
                    side === "both"
                      ? (() => {
                          const seen = new Set<string>();
                          const merged: typeof customerOptions = [];
                          for (const opt of [...supplierOptions, ...customerOptions]) {
                            const key = `${opt.group || ""}:${opt.value.toLowerCase()}`;
                            if (seen.has(key)) continue;
                            seen.add(key);
                            merged.push(opt);
                          }
                          return merged;
                        })()
                      : side === "payable"
                        ? supplierOptions
                        : customerOptions;
                  const partyCurrent = partyValue || value;
                  const emptyHint =
                    side === "payable"
                      ? "No suppliers or contractors yet — add them under Purchases → Suppliers / Contract Manager → Contractors, or use +."
                      : side === "receivable"
                        ? "No customers yet — type a name below to add a customer."
                        : "No customers, suppliers, or contractors yet — type a name below to add one.";
                  const prompt =
                    side === "payable"
                      ? "Search suppliers or contractors…"
                      : side === "receivable"
                        ? "Search customers…"
                        : "Search party…";
                  const addLabel =
                    side === "payable"
                      ? "supplier"
                      : side === "receivable"
                        ? "customer"
                        : "payee";
                  const selectedParty = options.find((o) => o.value === partyCurrent);
                  const contractorCount = options.filter((o) => o.group === "Contractors").length;
                  const supplierCount = options.filter((o) => o.group === "Suppliers").length;
                  const pickerOptions = options.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                    group: opt.group,
                    meta: [opt.kind, opt.currency || opt.code].filter(Boolean).join(" · ") || undefined,
                    searchText: `${opt.code} ${opt.value} ${opt.currency} ${opt.kind || ""} ${opt.group || ""}`,
                  }));
                  if (partyCurrent && !options.some((o) => o.value === partyCurrent)) {
                    pickerOptions.unshift({
                      value: partyCurrent,
                      label: partyCurrent,
                      group: undefined,
                      meta: "Current",
                      searchText: partyCurrent,
                    });
                  }
                  const openPayeeContractorCreate = () =>
                    setProjectRoleCreate({
                      kind: "contractor",
                      initialName: "",
                      applyTo: "payee",
                    });
                  return (
                    <div key={field.key} className="sm:col-span-2">
                      <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                        {field.label}
                        {field.required && <span className="text-orange-500">*</span>}
                      </Label>
                      <input type="hidden" name={field.key} value={partyCurrent} />
                      <div className="flex items-center gap-2">
                        <SearchablePicker
                          value={partyCurrent}
                          readOnly={readOnly}
                          allowCustom
                          allowClear={!field.required}
                          customLabel={(text) => `Add ${addLabel} “${text}”`}
                          options={pickerOptions}
                          placeholder={prompt}
                          searchPlaceholder={
                            side === "payable"
                              ? "Search suppliers or contractors…"
                              : `Search or type a new ${addLabel}…`
                          }
                          emptyText="No matches"
                          className="min-w-0 flex-1"
                          createActionLabel={
                            readOnly
                              ? undefined
                              : side === "payable"
                                ? "Add new supplier…"
                                : `Add new ${addLabel}…`
                          }
                          onCreateAction={
                            readOnly
                              ? undefined
                              : () => {
                                  setPartyCreate({ side, addLabel, initialName: "" });
                                }
                          }
                          extraCreateActions={
                            readOnly || side !== "payable"
                              ? undefined
                              : [
                                  {
                                    label: "Add new contractor…",
                                    onClick: openPayeeContractorCreate,
                                  },
                                ]
                          }
                          onChange={(next) => applyPartySelection(next, options, side, addLabel)}
                        />
                        {!readOnly && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9 w-9 shrink-0 rounded-lg border-slate-200 p-0 text-slate-600 hover:bg-slate-50"
                            title={
                              side === "payable"
                                ? "Add new supplier"
                                : `Add new ${addLabel}`
                            }
                            aria-label={
                              side === "payable"
                                ? "Add new supplier"
                                : `Add new ${addLabel}`
                            }
                            onClick={() => {
                              setPartyCreate({ side, addLabel, initialName: "" });
                            }}
                          >
                            <Add size={15} color="currentColor" />
                          </Button>
                        )}
                      </div>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {field.required
                          ? side === "payable"
                            ? "Required — Contractors and Suppliers appear as separate groups. Open the list or use Add contractor / Add supplier."
                            : side === "receivable"
                              ? "Required — from Sales → Customers, or use + to add a customer."
                              : "Required — choose a party or use + to add one."
                          : side === "payable"
                            ? "Optional — Contractors and Suppliers appear as separate groups. Open the list or use Add contractor / Add supplier."
                            : side === "receivable"
                              ? "Optional — from Sales → Customers, or use + to add a customer."
                              : "Optional — leave blank or use + to add a payee."}
                      </p>
                      {!options.length && (
                        <p className="mt-1 text-[11px] text-amber-600">{emptyHint}</p>
                      )}
                      {side === "payable" && options.length > 0 && contractorCount === 0 ? (
                        <p className="mt-1 text-[11px] text-amber-600">
                          {supplierCount
                            ? "Suppliers loaded, but no contractors yet — add one under Contract Manager → Contractors or choose “Add new contractor…”."
                            : "No contractors yet — add one under Contract Manager → Contractors or choose “Add new contractor…”."}
                        </p>
                      ) : null}
                      {selectedParty?.currency ? (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Currency set to {selectedParty.currency} from this{" "}
                          {selectedParty.kind === "Contractor"
                            ? "contractor"
                            : side === "payable"
                              ? "supplier"
                              : side === "receivable"
                                ? "customer"
                                : "party"}
                          . Amounts convert using exchange rates; ledger posts in base currency.
                        </p>
                      ) : null}
                    </div>
                  );
                }
              }
              if (field.key === "reference") {
                return (
                  <div key={field.key} className={wide ? "sm:col-span-2" : undefined}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <Input
                      id={field.key}
                      name={field.key}
                      value={referenceValue}
                      onChange={(e) => setReferenceValue(e.target.value)}
                      required={field.required}
                      readOnly={readOnly}
                    />
                    {state?.mode === "create" ? (
                      <p className="mt-1 text-[11px] text-slate-400">
                        Auto-generated — edit if you need a custom reference.
                      </p>
                    ) : null}
                  </div>
                );
              }
              if (field.key === "code" && isAutoCodedEntity(definition.key)) {
                const current =
                  definition.key === "vehicles"
                    ? codeValue || vehicleFieldPrefill.code || value || ""
                    : codeValue;
                return (
                  <div
                    key={
                      definition.key === "vehicles"
                        ? `code-vehicle-${vehiclePrefillTick}`
                        : field.key
                    }
                    className={wide ? "sm:col-span-2" : undefined}
                  >
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      <span className="text-orange-500">*</span>
                    </Label>
                    <Input
                      id={field.key}
                      name={field.key}
                      value={current}
                      onChange={(e) => {
                        const next = e.target.value;
                        setCodeValue(next);
                        if (definition.key === "vehicles") {
                          setVehicleFieldPrefill((prev) => ({ ...prev, code: next }));
                        }
                      }}
                      required
                      readOnly={readOnly}
                    />
                    {state?.mode === "create" ? (
                      <p className="mt-1 text-[11px] text-slate-400">
                        {definition.key === "vehicles" && vehicleFieldPrefill.code
                          ? "Filled from the linked fixed asset — edit if needed."
                          : "Auto-generated — edit if you need a custom code."}
                      </p>
                    ) : null}
                  </div>
                );
              }
              if (
                (definition.key === "inventory-items" || definition.key === "pos-products") &&
                (field.key === "openingStock" ||
                  field.key === "unitValue" ||
                  field.key === "stockValue")
              ) {
                const isCreate = state?.mode === "create";
                const hasMovements =
                  Boolean(
                    state?.record?.inventoryMoves && state.record.inventoryMoves !== "{}",
                  ) ||
                  Boolean(
                    state?.record?.inventoryTransferMoves &&
                      state.record.inventoryTransferMoves !== "{}",
                  );
                const canEditOpening = isCreate || !hasMovements;
                const lockedOpening =
                  state?.record?.openingStock ||
                  String(inventoryStockLevels(state?.record || ({} as ManagerRecord)).opening);
                const qty = parseAmount(canEditOpening ? openingStockValue : lockedOpening);
                const unit = parseAmount(itemUnitValue);
                const computedStockValue = roundMoney(qty * unit);

                if (field.key === "stockValue") {
                  return (
                    <div key={field.key}>
                      <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                        {field.label}
                      </Label>
                      <input type="hidden" name={field.key} value={String(computedStockValue)} />
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[15px] font-semibold tabular-nums text-slate-900">
                          {formatMoney(computedStockValue)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Unit value × opening qty
                        </p>
                      </div>
                    </div>
                  );
                }

                if (field.key === "unitValue") {
                  return (
                    <div key={field.key}>
                      <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                        {field.label}
                        <span className="text-orange-500">*</span>
                      </Label>
                      <MoneyInput
                        id={field.key}
                        name={field.key}
                        min="0"
                        value={itemUnitValue}
                        onChange={setItemUnitValue}
                        required
                        readOnly={readOnly}
                        placeholder="e.g. 50,000"
                      />
                    </div>
                  );
                }

                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {canEditOpening ? <span className="text-orange-500">*</span> : null}
                    </Label>
                    {canEditOpening ? (
                      <Input
                        id={field.key}
                        name={field.key}
                        type="number"
                        step="any"
                        min="0"
                        value={openingStockValue}
                        onChange={(e) => setOpeningStockValue(e.target.value)}
                        required
                        readOnly={readOnly}
                        placeholder="e.g. 100"
                      />
                    ) : (
                      <>
                        <input type="hidden" name={field.key} value={lockedOpening} />
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <p className="text-[15px] font-semibold tabular-nums text-slate-900">
                            {lockedOpening}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Opening qty is locked after stock movements are posted.
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                );
              }
              if (
                (definition.key === "stock-in" ||
                  definition.key === "pos-stock-in" ||
                  definition.key === "inventory-sales" ||
                  definition.key === "inventory-write-offs") &&
                (field.key === "quantity" ||
                  field.key === "unitCost" ||
                  field.key === "unitPrice" ||
                  field.key === "stockValue" ||
                  (field.key === "amount" &&
                    (definition.key === "stock-in" ||
                      definition.key === "pos-stock-in" ||
                      definition.key === "inventory-sales")))
              ) {
                const isQty = field.key === "quantity";
                const isUnitCost = field.key === "unitCost";
                const isUnitPrice = field.key === "unitPrice";
                const isComputed =
                  field.key === "stockValue" ||
                  (field.key === "amount" &&
                    (definition.key === "stock-in" ||
                      definition.key === "pos-stock-in" ||
                      definition.key === "inventory-sales"));
                const qty = parseAmount(inventoryQtyValue);
                const unitCost = parseAmount(inventoryUnitCostValue);
                const unitPrice = parseAmount(inventoryUnitPriceValue);
                const computed =
                  definition.key === "inventory-sales"
                    ? roundMoney(qty * unitPrice)
                    : roundMoney(qty * unitCost);
                const displayValue = isQty
                  ? inventoryQtyValue
                  : isUnitCost
                    ? inventoryUnitCostValue
                    : isUnitPrice
                      ? inventoryUnitPriceValue
                      : String(computed || value || "");
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    {isQty || isComputed ? (
                      <Input
                        id={field.key}
                        name={field.key}
                        type={isComputed ? "text" : "number"}
                        step={isComputed ? undefined : "any"}
                        value={
                          isComputed
                            ? formatAmountInput(displayValue)
                            : displayValue
                        }
                        onChange={(e) => {
                          if (isQty) setInventoryQtyValue(e.target.value);
                        }}
                        required={field.required && !isComputed}
                        readOnly={readOnly || isComputed}
                        className={isComputed ? "bg-slate-50" : undefined}
                      />
                    ) : (
                      <MoneyInput
                        id={field.key}
                        name={field.key}
                        value={displayValue}
                        onChange={(raw) => {
                          if (isUnitCost) setInventoryUnitCostValue(raw);
                          else if (isUnitPrice) setInventoryUnitPriceValue(raw);
                        }}
                        required={field.required}
                        readOnly={readOnly}
                      />
                    )}
                    {isComputed ? (
                      <p className="mt-1 text-[11px] text-slate-400">
                        {definition.key === "inventory-sales"
                          ? "Qty × unit price"
                          : "Qty × unit cost"}
                      </p>
                    ) : null}
                  </div>
                );
              }
              if (
                (definition.key === "inventory-transfers" ||
                  definition.key === "stock-in" ||
                  definition.key === "pos-stock-in" ||
                  definition.key === "inventory-sales" ||
                  definition.key === "inventory-write-offs") &&
                field.key === "status"
              ) {
                const hint =
                  definition.key === "inventory-transfers"
                    ? "Draft / Pending = no stock move. In transit = leaves the from warehouse into Goods in transit. Received (or Complete) = arrives at the receive-into warehouse / location."
                    : definition.key === "stock-in" || definition.key === "pos-stock-in"
                      ? "Complete posts stock into the location and increases on hand (Dr Inventory / Cr Goods received not invoiced). Draft does nothing."
                      : definition.key === "inventory-sales"
                        ? "Complete reduces stock and posts sales + COGS to P&L (and inventory / AR on the balance sheet). Draft does nothing."
                        : "Complete reduces stock and posts the write-off expense (damage, loss, theft, or other). Attach photos or reports as supporting documents. Draft does nothing.";
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <select
                      id={field.key}
                      name={field.key}
                      defaultValue={
                        value ||
                        (definition.key === "inventory-transfers" ? "In transit" : "Complete")
                      }
                      required={field.required}
                      disabled={readOnly}
                      className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:bg-slate-50"
                    >
                      {(field.options || []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
                  </div>
                );
              }
              if (
                invoicePaymentSide(definition.key) &&
                field.key === "status"
              ) {
                const isReceivable = RECEIVABLE_INVOICE_KEYS.has(definition.key);
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <select
                      id={field.key}
                      name={field.key}
                      defaultValue={value || "Active"}
                      required={field.required}
                      disabled={readOnly}
                      className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:bg-slate-50"
                    >
                      {(field.options || []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Active posts to the ledger and can be paid. Draft{" "}
                      {isReceivable ? "invoices" : "bills"} stay off the{" "}
                      {isReceivable ? "customer" : "supplier"} ledger until activated.
                    </p>
                  </div>
                );
              }
              if (isFixedAsset && (field.key === "cost" || field.key === "otherCosts" || field.key === "totalAcquisitionCost")) {
                const moneyCode = (
                  currencyValue ||
                  loadManagerSettings().baseCurrencyCode ||
                  "UGX"
                ).toUpperCase();
                if (field.key === "totalAcquisitionCost") {
                  return (
                    <div key={field.key}>
                      <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                        {field.label} ({moneyCode})
                      </Label>
                      <input type="hidden" name={field.key} value={String(assetTotalCost)} />
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="text-[15px] font-semibold tabular-nums text-slate-900">
                          {assetTotalCost.toLocaleString()} {moneyCode}
                        </p>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {assetIsOpening
                          ? `Gross acquisition cost in ${moneyCode}. Opening carry-in posts cost, accumulated depreciation, and opening balances equity.`
                          : `Acquisition cost + other costs in ${moneyCode}. This total is capitalized to the ledger (converted to base when needed).`}
                      </p>
                    </div>
                  );
                }
                const controlled = field.key === "cost" ? assetCost : assetOtherCosts;
                const setControlled = field.key === "cost" ? setAssetCost : setAssetOtherCosts;
                const label =
                  field.key === "cost"
                    ? `Acquisition cost (${moneyCode})`
                    : `${field.label} (${moneyCode})`;
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <MoneyInput
                      id={field.key}
                      name={field.key}
                      value={controlled}
                      onChange={setControlled}
                      required={field.required}
                      readOnly={readOnly}
                    />
                  </div>
                );
              }
              if (
                isIntangibleAsset &&
                field.key === "cost"
              ) {
                const moneyCode = (
                  currencyValue ||
                  loadManagerSettings().baseCurrencyCode ||
                  "UGX"
                ).toUpperCase();
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      Acquisition cost ({moneyCode})
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <MoneyInput
                      id={field.key}
                      name={field.key}
                      value={assetCost}
                      onChange={setAssetCost}
                      required={field.required}
                      readOnly={readOnly}
                    />
                  </div>
                );
              }
              if (
                (isFixedAsset || isIntangibleAsset) &&
                field.key === "entryType"
              ) {
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <select
                      id={field.key}
                      name={field.key}
                      value={assetEntryType}
                      onChange={(e) => setAssetEntryType(e.target.value)}
                      required={field.required}
                      disabled={readOnly}
                      className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:bg-slate-50"
                    >
                      {(field.options || ["Purchase", "Opening balance"]).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {assetIsOpening
                        ? "Migrate from a prior system: enter gross cost and opening accumulated depreciation/amortization."
                        : "New purchase: capitalizes against the bank, cash, or payable you select."}
                    </p>
                  </div>
                );
              }
              if (
                (isFixedAsset && field.key === "accumulatedDepreciation") ||
                (isIntangibleAsset && field.key === "accumulatedAmortization")
              ) {
                const moneyCode = (
                  currencyValue ||
                  loadManagerSettings().baseCurrencyCode ||
                  "UGX"
                ).toUpperCase();
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label} ({moneyCode})
                    </Label>
                    <MoneyInput
                      id={field.key}
                      name={field.key}
                      value={assetAccumDep}
                      onChange={setAssetAccumDep}
                      readOnly={readOnly}
                      placeholder="0"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      Cannot exceed total acquisition cost. Book value becomes cost minus this amount.
                    </p>
                  </div>
                );
              }
              if ((isFixedAsset || isIntangibleAsset) && field.key === "bookValue") {
                const moneyCode = (
                  currencyValue ||
                  loadManagerSettings().baseCurrencyCode ||
                  "UGX"
                ).toUpperCase();
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label} ({moneyCode})
                    </Label>
                    <input type="hidden" name={field.key} value={String(assetBookValue)} />
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[15px] font-semibold tabular-nums text-slate-900">
                        {assetBookValue.toLocaleString()} {moneyCode}
                      </p>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {assetIsOpening
                        ? "Net carrying amount after opening accumulated depreciation/amortization."
                        : "Equals total acquisition cost for a new purchase."}
                    </p>
                  </div>
                );
              }
              if (isBankRecon && field.key === "date") {
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <Input
                      id={field.key}
                      name={field.key}
                      type="date"
                      value={reconDate}
                      onChange={(e) => setReconDate(e.target.value)}
                      required={field.required}
                      readOnly={readOnly}
                    />
                  </div>
                );
              }
              if (isMaterialRequest && field.key === "neededBy") {
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <Input
                      id={field.key}
                      name={field.key}
                      type="date"
                      value={neededByValue}
                      onChange={(e) => setNeededByValue(e.target.value)}
                      required={field.required}
                      readOnly={readOnly}
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      Fills the Date required column on every material row in the CSV.
                    </p>
                  </div>
                );
              }
              if (isBankRecon && field.key === "statementBalance") {
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                      {field.required && <span className="text-orange-500">*</span>}
                    </Label>
                    <MoneyInput
                      id={field.key}
                      name={field.key}
                      value={reconStatementBalance}
                      onChange={setReconStatementBalance}
                      required={field.required}
                      readOnly={readOnly}
                      placeholder="From bank statement"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      Closing balance printed on the bank statement
                      {bankReconLive?.currency
                        ? ` (enter in ${bankReconLive.currency} — no conversion)`
                        : ""}
                      .
                    </p>
                  </div>
                );
              }
              if (isBankRecon && field.key === "systemBalance") {
                const system = bankReconLive?.bookBalance ?? 0;
                const moneyOpts = bankReconLive?.currency
                  ? { currencyCode: bankReconLive.currency }
                  : undefined;
                const unclearedNet = bankReconLive
                  ? roundMoney(
                      bankReconLive.unclearedReceipts +
                        bankReconLive.unclearedTransfersIn -
                        bankReconLive.unclearedPayments -
                        bankReconLive.unclearedTransfersOut,
                    )
                  : 0;
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                    </Label>
                    {/* Raw value for save; display formatted book balance. */}
                    <input type="hidden" name={field.key} value={String(system)} />
                    <Input
                      id={field.key}
                      type="text"
                      value={formatMoney(system, moneyOpts)}
                      readOnly
                      className="bg-slate-50 font-semibold tabular-nums text-slate-900"
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      Book balance in the system
                      {bankReconLive?.currency ? ` · ${bankReconLive.currency}` : ""}
                      {bankReconLive && unclearedNet !== 0
                        ? `. Uncleared items net ${formatMoney(unclearedNet, moneyOpts)} (statement target ${formatMoney(bankReconLive.adjustedBook, moneyOpts)})`
                        : ""}
                      .
                    </p>
                  </div>
                );
              }
              if (isBankRecon && field.key === "discrepancy") {
                const disc = bankReconLive?.discrepancy ?? 0;
                const balanced = Boolean(bankReconLive?.balanced);
                const moneyOpts = bankReconLive?.currency
                  ? { currencyCode: bankReconLive.currency }
                  : undefined;
                return (
                  <div key={field.key} className="sm:col-span-2">
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                    </Label>
                    <input type="hidden" name={field.key} value={String(disc)} />
                    <Input
                      id={field.key}
                      type="text"
                      value={formatMoney(disc, moneyOpts)}
                      readOnly
                      className={
                        balanced
                          ? "bg-emerald-50 font-semibold tabular-nums text-emerald-800"
                          : "bg-amber-50 font-semibold tabular-nums text-amber-900"
                      }
                    />
                    <div
                      className={`mt-2 rounded-lg border px-3 py-2 text-[12px] ${
                        balanced
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-amber-200 bg-amber-50 text-amber-900"
                      }`}
                    >
                      {bankReconLive ? (
                        balanced ? (
                          <p>
                            Balanced — statement closing{" "}
                            {formatMoney(bankReconLive.statementBalance, moneyOpts)} matches
                            system book {formatMoney(bankReconLive.bookBalance, moneyOpts)}.
                          </p>
                        ) : (
                          <p>
                            Discrepancy {formatMoney(disc, moneyOpts)} — statement closing{" "}
                            {formatMoney(bankReconLive.statementBalance, moneyOpts)} vs system
                            book {formatMoney(bankReconLive.bookBalance, moneyOpts)}.
                          </p>
                        )
                      ) : (
                        <p>Select a bank account and enter the statement closing balance to compare.</p>
                      )}
                    </div>
                  </div>
                );
              }
              if (isBankRecon && field.key === "status") {
                const balanced = Boolean(bankReconLive?.balanced);
                return (
                  <div key={field.key}>
                    <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                      {field.label}
                    </Label>
                    <input type="hidden" name={field.key} value={reconStatus} />
                    <Input
                      id={field.key}
                      value={reconStatus}
                      readOnly
                      className={
                        balanced
                          ? "bg-emerald-50 font-medium text-emerald-800"
                          : "bg-slate-50 text-slate-700"
                      }
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      Set by the system — Reconciled when discrepancy is zero.
                    </p>
                  </div>
                );
              }
              return (
                <div key={fieldRemountKey} className={wide || field.type === "attachments" ? "sm:col-span-2" : undefined}>
                  {field.type === "attachments" ? (
                    <RecordAttachmentsField
                      id={field.key}
                      name={field.key}
                      label={field.label}
                      required={field.required}
                      readOnly={readOnly}
                      defaultValue={value}
                      moduleSlug={moduleSlug}
                      entityKey={definition.key}
                      recordId={state?.record?.id}
                      hint={
                        definition.key === "inventory-write-offs"
                          ? "Attach photos of damage, police/insurance reports, QC notes, or other evidence. Files are also filed under Documents → Attachments."
                          : undefined
                      }
                    />
                  ) : (
                    <>
                  <Label htmlFor={field.key} className="mb-2 text-[12px] text-slate-700">
                    {field.label}
                    {field.required && <span className="text-orange-500">*</span>}
                  </Label>
                  {field.type === "textarea" ? (
                    <Textarea
                      id={field.key}
                      name={field.key}
                      defaultValue={value}
                      required={field.required}
                      readOnly={fieldLocked}
                      placeholder={field.placeholder}
                      className={cn(
                        "min-h-24",
                        field.key === "amendmentReason" &&
                          "border-amber-200 bg-amber-50/60 text-amber-950",
                        field.key === "rejectionReason" &&
                          "border-rose-200 bg-rose-50/60 text-rose-950",
                        fieldLocked &&
                          field.key !== "amendmentReason" &&
                          field.key !== "rejectionReason" &&
                          "bg-slate-50",
                      )}
                    />
                  ) : field.type === "select" ? (
                    <select
                      id={field.key}
                      name={field.key}
                      defaultValue={
                        value ||
                        (field.key === "status"
                          ? // MES tabs list their statuses in the order to
                            // default to — a work order is raised Open, not Draft.
                            (MES_MAINTENANCE_ENTITIES.has(definition.key)
                              ? field.options?.[0]
                              : undefined) ||
                            (REQUEST_EMAIL_ENTITIES.has(definition.key)
                              ? field.options?.find((o) => /^submitted$/i.test(o))
                              : undefined) ||
                            field.options?.find((o) => /^active$/i.test(o)) ||
                            field.options?.find((o) => /^draft$/i.test(o)) ||
                            field.options?.[0] ||
                            ""
                          : field.key === "clearance"
                            ? field.options?.find((o) => /^cleared$/i.test(o)) ||
                              field.options?.[0] ||
                              ""
                            : field.key === "fulfillmentPath" && isMaterialRequest
                              ? field.options?.[0] || "Stores issue"
                              : "")
                      }
                      required={field.required}
                      disabled={fieldLocked}
                      className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20 disabled:bg-slate-50"
                    >
                      {!(
                        field.key === "status" &&
                        (value ||
                          field.options?.some((o) => /^(active|draft)$/i.test(o)) ||
                          field.options?.[0])
                      ) &&
                      !(
                        field.key === "clearance" &&
                        (value ||
                          field.options?.some((o) => /^cleared$/i.test(o)) ||
                          field.options?.[0])
                      ) &&
                      !(
                        field.key === "fulfillmentPath" &&
                        isMaterialRequest &&
                        (value || field.options?.[0])
                      ) ? (
                        <option value="">Select {field.label.toLowerCase()}</option>
                      ) : null}
                      {(field.key === "status" &&
                      (allowSaveAsDraft || REQUEST_EMAIL_ENTITIES.has(definition.key))
                        ? Array.from(
                            new Set([
                              ...(allowSaveAsDraft ? ["Draft"] : []),
                              ...(field.options || []),
                              ...(value && !(field.options || []).includes(value)
                                ? [value]
                                : []),
                            ]),
                          )
                        : field.options
                      )?.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "number" && isMoneyInputField(field.key) ? (
                    <MoneyInput
                      id={field.key}
                      name={field.key}
                      {...((definition.key === "receipts" || definition.key === "payments") &&
                      field.key === "amount"
                        ? {
                            value: moneyAmountValue,
                            onChange: setMoneyAmountValue,
                          }
                        : { defaultValue: value })}
                      required={
                        field.required && !(isCoa && field.key === "code" && coaKind === "Group")
                      }
                      readOnly={fieldLocked}
                      placeholder={field.placeholder}
                    />
                  ) : (
                    <Input
                      id={field.key}
                      name={field.key}
                      type={field.type ?? "text"}
                      step={field.type === "number" ? "any" : undefined}
                      defaultValue={value}
                      required={field.required && !(isCoa && field.key === "code" && coaKind === "Group")}
                      readOnly={fieldLocked}
                      placeholder={field.placeholder}
                      className={fieldLocked ? "bg-slate-50" : undefined}
                    />
                  )}
                  <p className="mt-1 text-[11px] leading-snug text-slate-400">{fieldInputHint(field)}</p>
                    </>
                  )}
                </div>
              );
            })}
            {definition.key === "projects" ? (
              <ProjectWbsEditor
                phases={projectWbs}
                onChange={setProjectWbs}
                readOnly={readOnly}
              />
            ) : null}
            {isMaterialRequest ? (
              <MaterialRequestLinesEditor
                lines={materialRequestLines}
                onChange={setMaterialRequestLines}
                project={hierarchyProject}
                contractor={contractorValue}
                neededBy={neededByValue}
                onHeaderFromCsv={(header) => {
                  if (header.project) setHierarchyProject(header.project);
                  if (header.contractor) setContractorValue(header.contractor);
                  if (header.neededBy) setNeededByValue(header.neededBy);
                }}
                readOnly={readOnly}
              />
            ) : null}
            {useDocLines && (
              <>
                <DocumentLinesEditor
                  lines={docLines}
                  onChange={setDocLines}
                  readOnly={readOnly}
                  formOptions={isSalesInvoice ? invoiceOptions : undefined}
                  taxRate={taxRate}
                  taxLabel={taxLabel}
                  currencyCode={currencyValue}
                  priceKind={
                    /purchase|bill|debit-note|goods/i.test(definition.key) ? "purchase" : "sales"
                  }
                  earlyPaymentDiscountPct={
                    isSalesInvoice && invoiceOptions.earlyPaymentDiscount
                      ? parseAmount(earlyPaymentDiscount)
                      : 0
                  }
                  latePaymentFees={
                    isSalesInvoice && invoiceOptions.latePaymentFees
                      ? parseAmount(latePaymentFees)
                      : 0
                  }
                />
                {taxLabel ? <input type="hidden" name="taxCode" value={taxLabel} /> : null}
              </>
            )}
            {isSalesInvoice && invoiceOptions.earlyPaymentDiscount && (
              <div>
                <Label htmlFor="earlyPaymentDiscount" className="mb-2 text-[12px] text-slate-700">
                  Early payment discount %
                </Label>
                <Input
                  id="earlyPaymentDiscount"
                  name="earlyPaymentDiscount"
                  type="number"
                  step="any"
                  value={earlyPaymentDiscount}
                  onChange={(e) => setEarlyPaymentDiscount(e.target.value)}
                  readOnly={readOnly}
                  placeholder="e.g. 2"
                />
                {liveInvoiceTotals && parseAmount(earlyPaymentDiscount) > 0 ? (
                  <p className="mt-1 text-[11px] text-emerald-700">
                    If paid early:{" "}
                    {formatMoney(liveInvoiceTotals.amountIfPaidEarly, {
                      currencyCode: currencyValue,
                    })}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-400">
                    Stored as payment terms — does not change the invoice total.
                  </p>
                )}
              </div>
            )}
            {isSalesInvoice && invoiceOptions.latePaymentFees && (
              <div>
                <Label htmlFor="latePaymentFees" className="mb-2 text-[12px] text-slate-700">
                  Late payment fees
                </Label>
                <MoneyInput
                  id="latePaymentFees"
                  name="latePaymentFees"
                  value={latePaymentFees}
                  onChange={setLatePaymentFees}
                  readOnly={readOnly}
                  placeholder="Amount if overdue"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Shown on the invoice as overdue terms — not added to the balance due.
                </p>
              </div>
            )}
            {isSalesInvoice && invoiceOptions.rounding && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600 sm:col-span-2">
                Rounding is on — invoice total rounds to whole currency units
                {liveInvoiceTotals
                  ? ` (${formatMoney(liveInvoiceTotals.total, { currencyCode: currencyValue })})`
                  : ""}
                .
              </div>
            )}
            {isSalesInvoice && invoiceOptions.totalBaseCurrency && (
              <div>
                <Label className="mb-2 text-[12px] text-slate-700">
                  Total in base currency
                  {liveInvoiceTotals ? ` (${liveInvoiceTotals.baseCurrencyCode})` : ""}
                </Label>
                <p className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm tabular-nums text-slate-800">
                  {formatMoney(liveInvoiceTotalBase, {
                    currencyCode: liveInvoiceTotals?.baseCurrencyCode,
                  })}
                </p>
                <input
                  type="hidden"
                  name="baseCurrencyTotal"
                  value={String(liveInvoiceTotalBase)}
                />
              </div>
            )}
            {isSalesInvoice && !invoiceOptions.hideBalanceDue && (
              <div>
                <Label htmlFor="balanceDue" className="mb-2 text-[12px] text-slate-700">
                  Balance due
                </Label>
                <p className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm tabular-nums text-slate-800">
                  {formatMoney(
                    liveInvoiceTotals?.amountDue ?? parseAmount(state?.record?.balanceDue),
                    { currencyCode: currencyValue },
                  )}
                </p>
                <input
                  type="hidden"
                  id="balanceDue"
                  name="balanceDue"
                  value={String(
                    liveInvoiceTotals?.amountDue ??
                      state?.record?.balanceDue ??
                      state?.record?.amount ??
                      "",
                  )}
                />
              </div>
            )}
            {isSalesInvoice && invoiceOptions.actsAsDeliveryNote && (
              <div className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-3 sm:col-span-2">
                <p className="text-[12px] font-medium text-emerald-800">
                  Also acts as delivery note
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="deliveryDate" className="mb-1.5 text-[12px] text-slate-700">
                      Delivery date
                    </Label>
                    <Input
                      id="deliveryDate"
                      name="deliveryDate"
                      type="date"
                      value={deliveryDate}
                      onChange={(e) => setDeliveryDate(e.target.value)}
                      readOnly={readOnly}
                    />
                  </div>
                  <div>
                    <Label htmlFor="deliveredTo" className="mb-1.5 text-[12px] text-slate-700">
                      Delivered to
                    </Label>
                    <Input
                      id="deliveredTo"
                      name="deliveredTo"
                      value={deliveredTo}
                      onChange={(e) => setDeliveredTo(e.target.value)}
                      readOnly={readOnly}
                      placeholder="Recipient / site"
                    />
                  </div>
                </div>
                <input type="hidden" name="actsAsDeliveryNote" value="Yes" />
              </div>
            )}
            {isSalesInvoice && invoiceOptions.footers && (
              <div className="space-y-2 sm:col-span-2">
                <p className="text-[12px] font-medium text-slate-700">Footers</p>
                {activeFooters.length === 0 ? (
                  <p className="text-[11px] text-amber-600">
                    No active footers — add them under Settings → Footers.
                  </p>
                ) : (
                  activeFooters.map((footer) => (
                    <div
                      key={footer.id}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700"
                    >
                      <p className="font-medium text-slate-800">{footer.name}</p>
                      <p className="mt-1 whitespace-pre-wrap text-slate-600">{footer.content}</p>
                    </div>
                  ))
                )}
              </div>
            )}
            {useJournalLines && (
              <JournalLinesEditor
                lines={journalLines}
                onChange={setJournalLines}
                readOnly={readOnly}
              />
            )}
          </div>

          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" className="h-9 px-4" onClick={onClose}>
              Cancel
            </Button>
            {allowSaveAsDraft && !readOnly ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 px-4"
                onClick={() => {
                  saveAsDraftRef.current = true;
                  formRef.current?.requestSubmit();
                }}
              >
                Save as draft
              </Button>
            ) : null}
            <Button type="submit" className="h-9 bg-black px-4 hover:bg-zinc-800">
              {isLocationEntityForm
                ? state?.mode === "edit"
                  ? "Save changes"
                  : isPosLocationEntity
                    ? "Add POS location"
                    : entityLocationKind === "warehouse"
                      ? "Add warehouse"
                      : entityLocationKind === "store"
                        ? "Add store"
                        : "Add location"
                : state?.mode === "create"
                  ? REQUEST_EMAIL_ENTITIES.has(definition.key)
                    ? "Submit"
                    : "Create record"
                  : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <PartyCreateModal
      open={Boolean(partyCreate)}
      side={partyCreate?.side || null}
      addLabel={partyCreate?.addLabel || "party"}
      initialName={partyCreate?.initialName || ""}
      onClose={() => setPartyCreate(null)}
      onCreated={(name, record) => {
        setPartyValue(name);
        setCoaTick((t) => t + 1);
        const currency = (record.currency || record.currencyCode || "").trim();
        if (currency) applyDocCurrency(currency);
      }}
    />

    <ProjectRoleCreateModal
      open={Boolean(projectRoleCreate)}
      kind={projectRoleCreate?.kind || null}
      initialName={projectRoleCreate?.initialName || ""}
      onClose={() => setProjectRoleCreate(null)}
      onCreated={(name) => {
        if (projectRoleCreate?.applyTo === "payee") {
          setPartyValue(name);
          setCoaTick((t) => t + 1);
        } else if (projectRoleCreate?.kind === "project-manager") {
          setManagerValue(name);
        } else {
          setContractorValue(name);
        }
        setStaffListsTick((n) => n + 1);
        setCoaTick((t) => t + 1);
      }}
    />

    <ResponsiveModal
      open={Boolean(locationEditor)}
      onOpenChange={(open) => {
        if (!open) resetLocationForm();
      }}
      title={
        locationPickerIsPos
          ? locationEditor?.mode === "edit"
            ? "Edit POS location"
            : "Create POS location"
          : locationEditor?.mode === "edit"
            ? "Edit warehouse or location"
            : "Create warehouse or location"
      }
      description={
        locationPickerIsPos
          ? locationEditor?.mode === "edit"
            ? "Update this sales place. Changes are saved under POS → POS Locations."
            : "Add a place where sales happen (store, kiosk, stall, counter). It is saved under POS → POS Locations."
          : locationEditor?.mode === "edit"
            ? "Update type, name, code, or address. Changes are saved under Inventory → Locations."
            : "Choose the type, save it under Inventory → Locations, and it is selected on this field."
      }
      className="sm:max-w-md"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {locationEditor?.mode === "edit" ? (
            <Button
              type="button"
              variant="outline"
              className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
              onClick={confirmDeleteLocation}
            >
              <Trash size={14} color="currentColor" /> Delete
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={resetLocationForm}>
              Cancel
            </Button>
            <Button type="button" className="bg-black hover:bg-zinc-800" onClick={saveLocation}>
              {locationEditor?.mode === "edit"
                ? "Save changes"
                : locationPickerIsPos
                  ? "Add POS location"
                  : newLocationKind === "warehouse"
                    ? "Add warehouse"
                    : newLocationKind === "store"
                      ? "Add store"
                      : "Add location"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 py-2" onClick={(e) => e.stopPropagation()}>
        <div>
          <Label className="mb-1.5 text-[12px]">Type</Label>
          <div className={`grid gap-2 ${locationPickerIsPos ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
            {(locationPickerIsPos
              ? ([
                  ["store", "Store"],
                  ["kiosk", "Kiosk"],
                  ["counter", "Counter"],
                  ["stall", "Stall"],
                  ["branch", "Branch"],
                  ["market", "Market"],
                  ["other", "Other"],
                ] as const)
              : ([
                  ["warehouse", "Warehouse"],
                  ["store", "Store"],
                  ["location", "Location"],
                ] as const)
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setNewLocationKind(value)}
                className={`rounded-lg border px-2 py-2 text-[12px] font-medium transition ${
                  newLocationKind === value
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="new-location-name" className="mb-1.5 text-[12px]">
            Name <span className="text-orange-500">*</span>
          </Label>
          <Input
            id="new-location-name"
            value={newLocationName}
            onChange={(e) => setNewLocationName(e.target.value)}
            placeholder={
              locationPickerIsPos
                ? newLocationKind === "kiosk"
                  ? "e.g. Airport kiosk"
                  : newLocationKind === "stall"
                    ? "e.g. Nakasero stall 12"
                    : newLocationKind === "counter"
                      ? "e.g. Bar counter"
                      : "e.g. Ntinda store"
                : newLocationKind === "warehouse"
                  ? "e.g. Kampala warehouse"
                  : newLocationKind === "store"
                    ? "e.g. Ntinda store"
                    : "e.g. Showroom"
            }
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="new-location-code" className="mb-1.5 text-[12px]">
            Code
          </Label>
          <Input
            id="new-location-code"
            value={newLocationCode}
            onChange={(e) => setNewLocationCode(e.target.value)}
            placeholder="Optional — auto-generated if blank"
          />
        </div>
        <div>
          <Label htmlFor="new-location-address" className="mb-1.5 text-[12px]">
            Address
          </Label>
          <Input
            id="new-location-address"
            value={newLocationAddress}
            onChange={(e) => setNewLocationAddress(e.target.value)}
            placeholder="Optional street / site address"
          />
        </div>
        {newLocationError ? (
          <p className="text-[12px] text-rose-600">{newLocationError}</p>
        ) : null}
      </div>
    </ResponsiveModal>
    </>
  );
}

export function EntityWorkspace({
  config,
  definition,
}: {
  config: ModuleConfig;
  definition: EntityDefinition;
}) {
  const searchParams = useSearchParams();
  const accountFilter = searchParams.get("account") || "";
  const activityAccount = searchParams.get("activity") || "";
  const reportKind = liveReportKind(definition.key);

  if (
    definition.key === "bank-and-cash-accounts" &&
    activityAccount.trim()
  ) {
    const focus = searchParams.get("focus");
    return (
      <BankAccountActivityPanel
        accountName={activityAccount}
        focus={focus === "payments" || focus === "receipts" ? focus : ""}
      />
    );
  }
  if (definition.key === "bank-statements") {
    return <BankStatementImporter initialAccount={accountFilter} />;
  }
  if (definition.key === "accounting-operations") {
    return <AccountingOperationsDesk />;
  }
  if (definition.key === "pos-terminal") {
    return <PosTerminalPanel />;
  }
  if (definition.key === "fleet-cost-report") {
    return <FleetReportsPanel />;
  }
  if (definition.key === "service-reminders") {
    return <FleetServiceRemindersPanel />;
  }
  if (definition.key === "product-simulations") {
    return <ProductDevelopmentSimulationsPanel />;
  }
  if (definition.key === "contractor-invoices") {
    const partyPrefill = (searchParams.get("party") || "").trim();
    return <ContractorInvoicesSection partyPrefill={partyPrefill} />;
  }
  if (definition.key === "hr-desk") {
    return <HrDeskPanel />;
  }
  if (definition.key === "attendance") {
    return (
      <div className="space-y-4">
        <AttendanceCheckinPanel />
        <EntityRecordsWorkspace config={config} definition={definition} />
      </div>
    );
  }
  if (definition.key === "gantt-chart") {
    return <ProjectGanttPanel />;
  }
  if (definition.key === "project-cashflow") {
    return <ProjectCashflowPanel />;
  }
  if (definition.key === "my-projects") {
    return <MyProjectsPanel />;
  }
  if (definition.key === "create-payroll") {
    if (!currentUserCan("payroll")) {
      return (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-[14px] font-medium text-slate-800">Payroll access required</p>
          <p className="mt-1 text-[13px] text-slate-500">
            Your role cannot run payroll. Ask an Administrator or Accountant.
          </p>
        </div>
      );
    }
    return <CreatePayrollPanel />;
  }
  if (reportKind) {
    return <FinancialReportPanel key={reportKind} kind={reportKind} />;
  }
  return <EntityRecordsWorkspace config={config} definition={definition} />;
}

function EntityRecordsWorkspace({
  config,
  definition,
}: {
  config: ModuleConfig;
  definition: EntityDefinition;
}) {
  const router = useRouter();
  const {
    records,
    ready,
    create,
    update,
    replaceAll,
    replaceAllAsync,
  } = useManagerRecords(config, definition);
  const { feedback, close, showSuccess, showWarning, askConfirm } = useFeedbackModals();
  const { pushUndo, undo, canUndo, nextLabel } = useUndoStack();
  const searchParams = useSearchParams();
  const detailId = (searchParams.get("id") || "").trim();
  const listHref = `/${config.slug}?view=${definition.key}`;
  const openDetail = (record: ManagerRecord) => {
    router.push(hrefForRecordDetail(config.slug, definition.key, record.id));
  };
  const [query, setQuery] = useState("");
  // The input stays instant; the (potentially large) filter below only
  // re-runs a beat after typing stops, instead of on every keystroke.
  const debouncedQuery = useDebouncedValue(query, 200);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [accessTick, setAccessTick] = useState(0);
  useEffect(() => {
    const bump = () => setAccessTick((t) => t + 1);
    window.addEventListener("financeiag-auth-changed", bump);
    window.addEventListener("financeiag-settings-changed", bump);
    window.addEventListener("financeiag-db-synced", bump);
    // What the upstream will accept arrives with the first list read, after
    // this screen has already painted. Without a listener, New stayed on offer
    // on a collection with no create path — and the service's own verbs stayed
    // hidden — until some unrelated change forced a re-render.
    window.addEventListener(CAPABILITIES_CHANGED_EVENT, bump);
    return () => {
      window.removeEventListener("financeiag-auth-changed", bump);
      window.removeEventListener("financeiag-settings-changed", bump);
      window.removeEventListener("financeiag-db-synced", bump);
      window.removeEventListener(CAPABILITIES_CHANGED_EVENT, bump);
    };
  }, []);
  /** Which record/verb pair is in flight, so its menu item can say so. */
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [allocationFilter, setAllocationFilter] = useState<string>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<EditorState>(null);
  const [payTarget, setPayTarget] = useState<ManagerRecord | null>(null);

  /** Drop list filters in state and in the URL (deep-links like allocation=uncategorized). */
  const clearListFilters = (options?: { keepAccount?: boolean }) => {
    setQuery("");
    setStatusFilter("all");
    setScopeFilter({});
    setKindFilter("all");
    setAllocationFilter("all");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("allocation");
    params.delete("edit");
    params.delete("mode");
    params.delete("open");
    params.delete("q");
    if (!options?.keepAccount) params.delete("account");
    const qs = params.toString();
    router.replace(qs ? `/${config.slug}?${qs}` : `/${config.slug}`);
  };

  /**
   * After creating/editing a receipt or payment, deep-link filters
   * (?allocation=uncategorized&account=…) can hide the new row.
   * Always clear them so the saved document stays visible.
   */
  const revealMoneyRecordIfFiltered = (_record: ManagerRecord) => {
    if (definition.key !== "receipts" && definition.key !== "payments") return;
    const accountParam = (searchParams.get("account") || "").trim();
    const allocationParam = (searchParams.get("allocation") || "").trim();
    if (allocationFilter === "all" && !accountParam && !allocationParam) return;
    setAllocationFilter("all");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("allocation");
    params.delete("account");
    params.delete("edit");
    params.delete("mode");
    params.delete("open");
    const qs = params.toString();
    router.replace(qs ? `/${config.slug}?${qs}` : `/${config.slug}`);
  };
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [formDrafts, setFormDrafts] = useState<FormDraft[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [ledgerTick, setLedgerTick] = useState(0);
  const hydratedRef = useRef(false);
  const openConsumedRef = useRef("");
  const editorDraftIdRef = useRef<string | undefined>(undefined);
  // Block a second click/tap from firing a second create or update while the
  // first is still in flight — the form closes immediately on submit, so this
  // is the only guard against a double-click producing two records. Update is
  // keyed per record id (commitUpdate has several callers, e.g. approve/void
  // actions) so an in-flight update on one row never blocks another.
  const createInFlight = useInFlightGuard();
  const updateInFlight = useInFlightGuard();
  // Entity-first bucket: a list cross-linked onto a second route must read and
  // write the same collection from both, or each page only sees its own rows.
  const storeSlug = storageSlugForEntity(config.slug, definition.key) as ModuleSlug;

  useEffect(() => {
    editorDraftIdRef.current = editor?.draftId;
  }, [editor]);

  async function refreshFormDrafts() {
    if (!supportsSaveAsDraft(definition.key)) {
      setFormDrafts([]);
      return;
    }
    const result = await listFormDrafts({ module: storeSlug, entity: definition.key });
    if (result.ok) setFormDrafts(result.drafts);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!supportsSaveAsDraft(definition.key)) {
        if (!cancelled) setFormDrafts([]);
        return;
      }
      const result = await listFormDrafts({ module: storeSlug, entity: definition.key });
      if (!cancelled && result.ok) setFormDrafts(result.drafts);
    })();
    return () => {
      cancelled = true;
    };
  }, [definition.key, storeSlug, accessTick]);

  function openFormDraft(draft: FormDraft) {
    const data = { ...draft.data };
    delete data.id;
    delete data.createdAt;
    delete data.updatedAt;
    if (draft.sourceRecordId) {
      const existing = records.find((row) => row.id === draft.sourceRecordId);
      if (existing) {
        setEditor({
          mode: "edit",
          record: { ...existing, ...data, id: existing.id } as ManagerRecord,
          draftId: draft.id,
        });
        return;
      }
    }
    setEditor({
      mode: "create",
      record: { ...data, id: "", createdAt: "", updatedAt: "" } as ManagerRecord,
      draftId: draft.id,
    });
  }

  async function handleSaveDraft(values: Record<string, string>) {
    if (SAVE_AS_DRAFT_FLAG in values) delete values[SAVE_AS_DRAFT_FLAG];
    const draftId = editor?.draftId || editorDraftIdRef.current;
    const sourceRecordId =
      editor?.mode === "edit" && editor.record?.id ? editor.record.id : "";
    const result = await upsertFormDraft({
      id: draftId,
      module: storeSlug,
      entity: definition.key,
      sourceRecordId,
      data: values,
    });
    if (!result.ok || !result.draft) {
      showWarning("Could not save draft", result.error || "Try again.");
      return;
    }
    setEditor(null);
    setPayTarget(null);
    await refreshFormDrafts();
    showSuccess(
      "Draft saved",
      "Saved to your drafts — not the live records. Open Drafts to continue, then Submit / Create when ready.",
    );
  }

  async function removeFormDraftById(draftId?: string) {
    if (!draftId) return;
    await deleteFormDraft(draftId);
    if (editorDraftIdRef.current === draftId) editorDraftIdRef.current = undefined;
    await refreshFormDrafts();
  }

  // Deep-links from Bank & Cash Accounts (uncategorized / statements / search).
  useEffect(() => {
    const allocation = (searchParams.get("allocation") || "").toLowerCase();
    const account = (searchParams.get("account") || "").trim();
    const q = (searchParams.get("q") || "").trim();
    if (
      (definition.key === "receipts" || definition.key === "payments") &&
      (allocation === "uncategorized" ||
        allocation === "allocated" ||
        allocation === "posted")
    ) {
      setAllocationFilter(allocation);
    } else {
      setAllocationFilter("all");
    }
    setQuery(q || account);
    setStatusFilter("all");
    setScopeFilter({});
    setKindFilter("all");
  }, [definition.key, config.slug, searchParams]);

  useEffect(() => {
    hydratedRef.current = false;
  }, [definition.key, config.slug]);

  // Bank & Cash closing balance comes from Railway (opening + receipts − payments).
  // Force a fresh records GET (no 304) then stamp /api/banking/bank-balances so
  // Vercel tabs cannot keep a stale USh 10,000,000 memory snapshot.
  useEffect(() => {
    if (!ready || definition.key !== "bank-and-cash-accounts") return;
    let cancelled = false;
    void (async () => {
      await hydrateEntityFromDatabase("banking", "bank-and-cash-accounts", {
        force: true,
      }).catch(() => []);
      const { refreshBankBalancesFromApi } = await import("@/lib/banking-summary");
      const ok = await refreshBankBalancesFromApi();
      if (!ok) {
        await Promise.all([
          hydrateEntityFromDatabase("banking", "receipts").catch(() => []),
          hydrateEntityFromDatabase("banking", "payments").catch(() => []),
        ]);
      }
      if (!cancelled) setLedgerTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, definition.key]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      loadChartOfAccounts();
      // Empty CoA stays empty — never invent DEFAULT_CHART in the browser.
      // Rows come only from API/Postgres hydrate (or user create / import).
      if (!hydratedRef.current && records.length > 0) {
        hydratedRef.current = true;
        // Only CoA needs an open-time ledger rebuild. Other entities post on save;
        // background ensureLedgerSyncedFromRecords covers gaps without freezing nav.
        if (definition.key === "chart-of-accounts") {
          void (async () => {
            for (const record of records) {
              await postRecordToLedger(storeSlug, definition.key, record);
            }
            rebuildOpeningBalanceEntry();
          })();
        }
      }
    });
    // Each ledger tick re-runs the whole live-balance enrichment for this table
    // (for invoices, a full pass over receipts/payments). Journal hydration
    // lands page by page and fires this event per page, so bumping per event
    // repeated that work through the entire boot. Coalesce the burst into one
    // refresh, with a ceiling so a continuous stream still lands promptly.
    let burstTimer: number | null = null;
    let burstStartedAt = 0;
    const onLedger = () => {
      const now = Date.now();
      if (!burstStartedAt) burstStartedAt = now;
      if (burstTimer !== null) window.clearTimeout(burstTimer);
      const wait = Math.min(LEDGER_BURST_QUIET_MS, Math.max(0, burstStartedAt + LEDGER_BURST_MAX_MS - now));
      burstTimer = window.setTimeout(() => {
        burstTimer = null;
        burstStartedAt = 0;
        setLedgerTick((t) => t + 1);
      }, wait);
    };
    window.addEventListener("financeiag-ledger-changed", onLedger);
    return () => {
      cancelled = true;
      if (burstTimer !== null) window.clearTimeout(burstTimer);
      window.removeEventListener("financeiag-ledger-changed", onLedger);
    };
  }, [ready, definition.key, records, replaceAllAsync, storeSlug]);

  const displayRecords = useMemo((): ManagerRecord[] => {
    void ledgerTick;
    const enriched = enrichRecordsWithLiveBalances(definition.key, records);
    if (definition.key === "inventory-items" || definition.key === "pos-products") {
      const rollById =
        definition.key === "inventory-items"
          ? new Map(inventoryStockRollforward().items.map((row) => [row.id, row]))
          : new Map();
      return enriched.map((record) => {
        const levels = inventoryStockLevels(record);
        const roll = rollById.get(record.id);
        const unitValue =
          record.unitValue ||
          record.purchasePrice ||
          record.unitCost ||
          record.averageCost ||
          "";
        const unit = parseAmount(unitValue);
        const openingValue =
          roll?.openingValue ??
          (parseAmount(record.stockValue) || roundMoney(levels.opening * unit));
        const closingValue =
          roll?.closingValue ??
          (parseAmount(record.inventoryValue) || roundMoney(levels.closing * unit));
        return {
          ...record,
          openingStock: String(roll?.openingQty ?? levels.opening),
          closingStock: String(roll?.closingQty ?? levels.closing),
          unitValue: unitValue || String(unit),
          stockValue: String(openingValue),
          closingValue: String(closingValue),
        };
      });
    }
    if (definition.key !== "chart-of-accounts") return enriched;
    return sortCoaHierarchy(ensureCoaGroupRecords(enriched));
  }, [definition.key, ledgerTick, records]);

  // Persist missing Group shells once for legacy flat CoA data
  useEffect(() => {
    if (definition.key !== "chart-of-accounts" || !ready || !records.length) return;
    const next = ensureCoaGroupRecords(records);
    if (next.length !== records.length) void replaceAllAsync(next);
  }, [definition.key, ready, records, replaceAllAsync]);

  /**
   * Where a record sits: which shop floor, which shift, which machine. Nine of
   * this app's entities carry at least one, and most carry only the machine,
   * so a list of every downtime event at every factory could previously only
   * be narrowed by typing into search.
   *
   * The factory is not here: it is where you are standing, not a property of
   * this list, so it lives in the page header and arrives as a URL parameter.
   * These three narrow within it.
   *
   * Options come from the rows themselves rather than a per-entity config, so
   * a filter appears exactly when there is something to filter by, and a new
   * entity carrying one of these fields gets it without being listed here.
   */
  const SCOPE_FILTERS = useMemo(
    () =>
      [
        { field: "section", label: "shop floor", all: "All shop floors" },
        { field: "shiftName", label: "shift", all: "All shifts" },
        { field: "workCenter", label: "machine", all: "All machines" },
      ] as const,
    [],
  );

  /**
   * machine tag -> the factory it stands in, from the machine register this
   * app already loads. Records here name a machine, not a factory.
   */
  const factoryOfMachine = useMemo(() => {
    const out = new Map<string, string>();
    try {
      for (const machine of loadRecords("production", "work-centers")) {
        const tag = String(machine.code ?? machine.id ?? "").trim();
        const plant = String(machine.plantCode ?? "").trim();
        if (tag && plant) out.set(tag, plant);
      }
    } catch {
      /* no register loaded yet — the scope then narrows nothing */
    }
    return out;
  }, [accessTick]);

  const [scopeFilter, setScopeFilter] = useState<Record<string, string>>({});

  const scopeOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const { field } of SCOPE_FILTERS) {
      const set = new Set<string>();
      for (const record of displayRecords) {
        const value = String(record[field] ?? "").trim();
        if (value) set.add(value);
      }
      // One distinct value filters nothing — every row would survive it.
      if (set.size > 1) out[field] = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return out;
  }, [SCOPE_FILTERS, displayRecords]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const record of displayRecords) {
      const status = (record.status || "").trim();
      if (status) set.add(status);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [displayRecords]);

  const kindOptions = useMemo(() => {
    if (definition.key !== "chart-of-accounts") return [] as string[];
    const set = new Set<string>();
    for (const record of displayRecords) {
      const kind = (record.kind || (isCoaGroup(record) ? "Group" : "Account")).trim();
      if (kind) set.add(kind);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [definition.key, displayRecords]);

  /**
   * Searchable text per record, built once per data change. Rebuilding it
   * inside the filter meant every keystroke re-serialized every record.
   */
  const searchIndex = useMemo(
    () => buildRecordSearchIndex(displayRecords, attachmentFieldKeys(definition)),
    [definition, displayRecords],
  );

  const visibleRecords = useMemo(() => {
    const normalized = debouncedQuery.trim().toLowerCase();
    const tokens = normalized ? normalized.split(/\s+/).filter(Boolean) : [];
    const moneyEntity = definition.key === "receipts" || definition.key === "payments";
    const accountParam = (searchParams.get("account") || "").trim().toLowerCase();
    const factoryScope = (searchParams.get(FACTORY_PARAM) || "").trim();
    let result = displayRecords.filter((record) => {
      if (factoryScope) {
        const own = String(record.plantCode ?? "").trim();
        if (record.plantCode !== undefined) {
          if (own !== factoryScope) return false;
        } else if (record.workCenter !== undefined) {
          // Almost nothing in this app carries a factory of its own — a work
          // order, a PM schedule, a downtime event all name a machine, and the
          // machine knows where it stands. Resolving through the register is
          // what makes the scope mean anything here.
          const machine = String(record.workCenter ?? "").trim();
          if (machine && factoryOfMachine.get(machine) !== factoryScope) return false;
        }
      }
      for (const [field, value] of Object.entries(scopeFilter)) {
        if (!value || value === "all") continue;
        if (String(record[field] ?? "").trim() !== value) return false;
      }
      if (statusFilter !== "all") {
        const status = (record.status || "").trim();
        if (status.toLowerCase() !== statusFilter.toLowerCase()) return false;
      }
      if (kindFilter !== "all" && definition.key === "chart-of-accounts") {
        const kind = (record.kind || (isCoaGroup(record) ? "Group" : "Account")).trim();
        if (kind.toLowerCase() !== kindFilter.toLowerCase()) return false;
      }
      if (moneyEntity && allocationFilter !== "all") {
        // Use the live label (appliedTo / postingAccount) — `allocation` is display-only.
        const allocation = moneyAllocationLabel(record).toLowerCase();
        if (allocationFilter === "uncategorized" && !allocation.startsWith("uncategorized")) {
          return false;
        }
        if (allocationFilter === "allocated" && !allocation.startsWith("allocated")) {
          return false;
        }
        if (allocationFilter === "posted" && !allocation.startsWith("posted")) {
          return false;
        }
      }
      // Deep-link from bank account: match aliases / CoA GL names / paidFrom too.
      if (moneyEntity && accountParam) {
        const account = (
          record.account ||
          record.bankAccount ||
          record.paidFrom ||
          record.depositTo ||
          ""
        ).trim();
        if (!bankAccountsMatch(account, accountParam)) return false;
      }
      if (!tokens.length) return true;
      // When account deep-link is active, don't also require the free-text tokens
      // (the account name is already enforced above).
      if (moneyEntity && accountParam) return true;
      const haystack = searchIndex.get(record.id) ?? "";
      return tokens.every((token) => haystack.includes(token));
    });
    if (sort && definition.key !== "chart-of-accounts") {
      result = [...result].sort((a, b) => {
        const comparison = String(a[sort.key] ?? "").localeCompare(String(b[sort.key] ?? ""), undefined, {
          numeric: true,
        });
        return sort.direction === "asc" ? comparison : -comparison;
      });
    } else if (isRequestChainEntityKey(definition.key)) {
      // Default inbox order: needs-attention → priority → approval stage → newest.
      result = sortRecordsForRequestorAttention(result);
    } else if (definition.key !== "chart-of-accounts") {
      // CoA carries its own hierarchy order (sortCoaHierarchy). Every other list
      // needs an explicit order: the API payload has none, so a saved row would
      // otherwise land on a random page of the table and look like it vanished.
      result = sortRecordsNewestFirst(result);
    }
    if (config.slug === "projects") {
      result = filterRecordsForProjectScope(definition.key, result);
    }
    return result;
  }, [
    allocationFilter,
    config.slug,
    definition.key,
    displayRecords,
    kindFilter,
    debouncedQuery,
    searchIndex,
    searchParams,
    sort,
    statusFilter,
  ]);

  // Origin linkage: when arriving with ?open=<ref|id>, land on the source
  // document. Use ?edit=1 (or mode=edit) to open directly for categorization.
  // From Bank & Cash chips (?allocation=uncategorized&edit=1), open the first
  // matching uncategorized receipt/payment for that account.
  // From Contractors (?new=1&party=…), open a blank purchase invoice prefilled.
  useEffect(() => {
    if (!ready) return;
    const open = (searchParams.get("open") || "").trim();
    const wantNew = searchParams.get("new") === "1";
    const partyPrefill = (searchParams.get("party") || "").trim();
    const wantEdit =
      searchParams.get("edit") === "1" ||
      /^(edit|categorize)$/i.test(searchParams.get("mode") || "");
    const allocation = (searchParams.get("allocation") || "").toLowerCase();
    const accountParam = (searchParams.get("account") || "").trim().toLowerCase();
    const moneyEntity = definition.key === "receipts" || definition.key === "payments";

    if (wantNew) {
      const newKey = `new:${definition.key}:${partyPrefill}`;
      if (openConsumedRef.current === newKey) return;
      openConsumedRef.current = newKey;
      const seed = partyPrefill
        ? ({
            id: "",
            createdAt: "",
            updatedAt: "",
            party: partyPrefill,
            supplier: partyPrefill,
          } satisfies ManagerRecord)
        : null;
      setEditor({ mode: "create", record: seed });
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      params.delete("party");
      const qs = params.toString();
      router.replace(`/${config.slug}${qs ? `?${qs}` : `?view=${definition.key}`}`);
      return;
    }

    if (open) {
      if (openConsumedRef.current === open) return;
      const needle = open.toLowerCase();
      const match = displayRecords.find((record) =>
        [record.id, record.reference, record.code, record.name]
          .filter(Boolean)
          .some((candidate) => String(candidate).trim().toLowerCase() === needle),
      );
      if (match) {
        openConsumedRef.current = open;
        if (wantEdit) {
          setEditor({ mode: "edit", record: match });
        } else {
          router.replace(hrefForRecordDetail(config.slug, definition.key, match.id));
        }
      }
      return;
    }

    const autoKey = `uncategorized:${definition.key}:${accountParam}:${allocation}`;
    if (
      wantEdit &&
      moneyEntity &&
      allocation === "uncategorized" &&
      openConsumedRef.current !== autoKey
    ) {
      const first = visibleRecords.find((record) =>
        /^uncategorized/i.test(moneyAllocationLabel(record)),
      );
      if (first) {
        openConsumedRef.current = autoKey;
        setEditor({ mode: "edit", record: first });
      }
    } else if (!wantEdit && !wantNew) {
      openConsumedRef.current = "";
    }
  }, [ready, searchParams, displayRecords, definition.key, visibleRecords, router, config.slug]);

  const {
    page,
    setPage,
    pages,
    pageItems,
    pageSize,
    setPageSize,
    total: pageTotal,
    from: pageFrom,
    to: pageTo,
  } = usePagination(visibleRecords);

  useEffect(() => {
    setPage(1);
  }, [query, definition.key, sort, statusFilter, kindFilter, allocationFilter, setPage]);

  async function restoreRecordsSnapshot(previous: ManagerRecord[]) {
    const current = loadRecords(storeSlug, definition.key);
    const previousIds = new Set(previous.map((record) => record.id));
    for (const record of current) {
      if (!previousIds.has(record.id)) {
        unsyncRecordFromLedger(record.id);
        applyInventoryMovement({
          entityKey: definition.key,
          record,
          previous: record,
          removing: true,
        });
      }
    }
    replaceAll(previous);
    for (const record of previous) {
      await postRecordToLedger(storeSlug, definition.key, record);
      applyInventoryMovement({ entityKey: definition.key, record });
    }
    if (definition.key === "chart-of-accounts") {
      rebuildOpeningBalanceEntry();
    }
  }

  function registerRecordsUndo(label: string, previous: ManagerRecord[]) {
    pushUndo({
      label,
      undo: () => {
        void restoreRecordsSnapshot(previous);
        showSuccess("Undone", `${label} was reversed.`);
      },
    });
  }

  const columns = definition.columns
    .map((key) => definition.fields.find((field) => field.key === key))
    .filter((field): field is NonNullable<typeof field> => Boolean(field));

  function toggleSort(key: string) {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  }

  function fieldValues(record: ManagerRecord): Record<string, string> {
    return Object.fromEntries(definition.fields.map((field) => [field.key, String(record[field.key] ?? "")]));
  }

  function buildListExportSpec(): TableExport {
    const rowsSource = visibleRecords.length ? visibleRecords : records;
    return {
      title: `${config.label} — ${definition.label}`,
      filename: `${config.slug}-${definition.key}`,
      meta: [
        definition.label,
        `${rowsSource.length} record${rowsSource.length === 1 ? "" : "s"}`,
        `Exported ${new Date().toLocaleDateString()}`,
      ],
      columns: columns.map((field) => field.label),
      rows: rowsSource.map((record) =>
        columns.map((field) => formatFieldValue(field, String(record[field.key] ?? ""), record)),
      ),
    };
  }

  async function exportData(format: "pdf" | "excel" | "csv") {
    const spec = buildListExportSpec();
    try {
      if (format === "csv") exportTableCsv(spec);
      else if (format === "excel") await exportTableExcel(spec);
      else await exportTablePdf(spec);
    } catch (error) {
      showWarning(
        "Export failed",
        error instanceof Error ? error.message : `Could not export ${format.toUpperCase()}.`,
      );
    }
  }

  function downloadImportTemplate() {
    const pageCrudNow = currentUserEntityCrud(config.slug, definition.key);
    if (
      !canBulkImportEntity(definition.key, {
        canCreate: pageCrudNow.create,
        canEdit: pageCrudNow.edit,
      })
    ) {
      showWarning(
        "No CSV template",
        "This list is a live report or special screen — download templates from a data table instead (Customers, Invoices, Receipts, …).",
      );
      return;
    }
    const blob = new Blob([importTemplateCsv(definition)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      definition.key === "requisitions"
        ? "material-request-import-template.csv"
        : definition.key === "journal-entries"
          ? "journal-entry-import-template.csv"
          : DOCUMENT_LINE_ENTITIES.has(definition.key)
            ? documentLineImportTemplateName(definition.key)
            : `${config.slug}-${definition.key}-import-template.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importData(files: FileList | File[]) {
    const pageCrud = currentUserEntityCrud(config.slug, definition.key);
    const allowImport = canBulkImportEntity(definition.key, {
      canCreate: pageCrud.create,
      canEdit: pageCrud.edit,
    });
    if (!allowImport) {
      showWarning(
        "Import blocked",
        definition.key === "requisitions"
          ? pageCrud.edit || pageCrud.create
            ? "CSV import is not available on this list."
            : "Your role cannot edit Material Requests. Ask an Administrator."
          : LINE_SHEET_CSV_ENTITIES.has(definition.key)
            ? pageCrud.create || pageCrud.edit
              ? "CSV import is not available on this list."
              : `Your role cannot create or edit ${definition.label}. Ask an Administrator.`
            : pageCrud.create || pageCrud.edit
              ? "This list is a live report or special screen — it has no rows to import into. Open a data table (Customers, Invoices, Receipts, …) to use Import CSV."
              : "Your role cannot create records on this page. Ask an Administrator.",
      );
      return;
    }
    const list = Array.from(files);
    if (!list.length) return;

    // Material Requests: line-item CSV goes through the Go API importer.
    if (definition.key === "requisitions") {
      try {
        let importedTotal = 0;
        const allErrors: string[] = [];
        for (const file of list) {
          if (/\.json$/i.test(file.name)) {
            allErrors.push(`${file.name}: use CSV for material requests (line-item sheet).`);
            continue;
          }
          const result = await uploadMaterialRequestCsv(file);
          if (!result.ok) {
            allErrors.push(
              `${file.name}: ${result.error || "Import failed"}`,
              ...result.errors.slice(0, 5),
            );
            continue;
          }
          importedTotal += result.imported;
          allErrors.push(...result.errors);
          for (const record of result.records || []) {
            const status =
              !record.status || /^draft$/i.test(record.status)
                ? "Submitted"
                : record.status;
            notifyRequestParties({
              entityKey: "requisitions",
              record: { ...record, status },
              event: "created",
            });
          }
        }
        if (!importedTotal) {
          showWarning(
            "Nothing imported",
            allErrors.length
              ? allErrors.slice(0, 8).join("\n")
              : "No usable material request rows were found.",
          );
          return;
        }
        // Pull the updated collection so the list reflects the API write.
        await hydrateEntityFromDatabase(storeSlug, definition.key);
        window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
        const errorNote =
          allErrors.length > 0
            ? ` ${allErrors.length} warning${allErrors.length === 1 ? "" : "s"}.`
            : "";
        showSuccess(
          "CSV imported",
          `Imported ${importedTotal} material request${importedTotal === 1 ? "" : "s"} via API.${errorNote}`,
        );
      } catch (error) {
        showWarning(
          "Import failed",
          error instanceof Error ? error.message : "Could not upload the CSV.",
        );
      }
      return;
    }

    // Document line-sheets: invoices, bills, quotes, orders, credit/debit notes.
    if (DOCUMENT_LINE_ENTITIES.has(definition.key)) {
      try {
        let importedTotal = 0;
        const allErrors: string[] = [];
        for (const file of list) {
          if (/\.json$/i.test(file.name)) {
            allErrors.push(`${file.name}: use CSV for ${definition.label.toLowerCase()} (line-item sheet).`);
            continue;
          }
          const result = await uploadDocumentLineCsv(definition.key, file);
          if (!result.ok) {
            allErrors.push(
              `${file.name}: ${result.error || "Import failed"}`,
              ...result.errors.slice(0, 5),
            );
            continue;
          }
          importedTotal += result.imported;
          allErrors.push(...result.errors);
        }
        if (!importedTotal) {
          showWarning(
            "Nothing imported",
            allErrors.length
              ? allErrors.slice(0, 8).join("\n")
              : `No usable ${definition.label.toLowerCase()} rows were found.`,
          );
          return;
        }
        await hydrateEntityFromDatabase(storeSlug, definition.key);
        window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
        const errorNote =
          allErrors.length > 0
            ? ` ${allErrors.length} warning${allErrors.length === 1 ? "" : "s"}.`
            : "";
        showSuccess(
          "CSV imported",
          `Imported ${importedTotal} ${definition.label.toLowerCase()} via API.${errorNote}`,
        );
      } catch (error) {
        showWarning(
          "Import failed",
          error instanceof Error ? error.message : "Could not upload the CSV.",
        );
      }
      return;
    }

    // Journal Entries: Account / Debit / Credit line-sheet via Go API.
    if (definition.key === "journal-entries") {
      try {
        let importedTotal = 0;
        const allErrors: string[] = [];
        for (const file of list) {
          if (/\.json$/i.test(file.name)) {
            allErrors.push(`${file.name}: use CSV for journal entries (line-item sheet).`);
            continue;
          }
          const result = await uploadJournalEntryCsv(file);
          if (!result.ok) {
            allErrors.push(
              `${file.name}: ${result.error || "Import failed"}`,
              ...result.errors.slice(0, 5),
            );
            continue;
          }
          importedTotal += result.imported;
          allErrors.push(...result.errors);
        }
        if (!importedTotal) {
          showWarning(
            "Nothing imported",
            allErrors.length
              ? allErrors.slice(0, 8).join("\n")
              : "No usable journal entry rows were found.",
          );
          return;
        }
        await hydrateEntityFromDatabase(storeSlug, definition.key);
        window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
        const errorNote =
          allErrors.length > 0
            ? ` ${allErrors.length} warning${allErrors.length === 1 ? "" : "s"}.`
            : "";
        showSuccess(
          "CSV imported",
          `Imported ${importedTotal} journal entr${importedTotal === 1 ? "y" : "ies"} via API.${errorNote}`,
        );
      } catch (error) {
        showWarning(
          "Import failed",
          error instanceof Error ? error.message : "Could not upload the CSV.",
        );
      }
      return;
    }

    // All other lists: map headers against THIS entity's field definition here in
    // the browser (the Go importer has no field labels, so "Customer" on an
    // invoice sheet would land in `name`), then POST mapped rows for the merge +
    // persist + ledger post.
    try {
      let importedTotal = 0;
      const allErrors: string[] = [];
      for (const file of list) {
        let parsed: ParsedEntityImport;
        try {
          parsed = parseEntityImportDetailed(file.name, await file.text(), definition);
        } catch (error) {
          allErrors.push(
            `${file.name}: ${error instanceof Error ? error.message : "could not read the file"}`,
          );
          continue;
        }
        if (!parsed.rows.length) {
          allErrors.push(`${file.name}: no data rows.`);
          continue;
        }
        if (parsed.unmappedHeaders.length) {
          allErrors.push(
            `${file.name}: ignored unknown column${parsed.unmappedHeaders.length === 1 ? "" : "s"} ${parsed.unmappedHeaders
              .slice(0, 6)
              .map((header) => `“${header}”`)
              .join(", ")}.`,
          );
        }

        const rows: ImportRow[] = [];
        parsed.rows.forEach((row, index) => {
          const problem =
            parsed.mode === "merge" ? validateImportRow(row, definition) : null;
          if (problem) {
            allErrors.push(`${file.name} line ${parsed.lines[index] ?? index + 2}: ${problem}`);
            return;
          }
          rows.push(row);
        });
        if (!rows.length) continue;

        const result = await uploadEntityImportRows(storeSlug, definition.key, rows);
        if (!result.ok) {
          allErrors.push(
            `${file.name}: ${result.error || "Import failed"}`,
            ...result.errors.slice(0, 5),
          );
          continue;
        }
        importedTotal += result.imported;
        allErrors.push(...result.errors);
      }
      if (!importedTotal) {
        showWarning(
          "Nothing imported",
          allErrors.length
            ? allErrors.slice(0, 8).join("\n") +
                (allErrors.length > 8 ? `\n…and ${allErrors.length - 8} more.` : "")
            : "No usable rows were found.",
        );
        return;
      }
      await hydrateEntityFromDatabase(storeSlug, definition.key);
      window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
      if (definition.key === "chart-of-accounts") {
        const { rebuildOpeningBalanceEntry } = await import("@/lib/ledger/opening-balances");
        rebuildOpeningBalanceEntry();
      }
      const errorNote = allErrors.length
        ? `\n${allErrors.length} row${allErrors.length === 1 ? "" : "s"} skipped:\n${allErrors
            .slice(0, 5)
            .join("\n")}${allErrors.length > 5 ? `\n…and ${allErrors.length - 5} more.` : ""}`
        : "";
      showSuccess(
        "CSV imported",
        `Imported ${importedTotal} ${definition.label.toLowerCase()}.${errorNote}`,
      );
    } catch (error) {
      showWarning(
        "Import failed",
        error instanceof Error
          ? error.message
          : "Choose valid CSV, TSV, or JSON files.",
      );
    }
  }

  async function commitCreate(values: Record<string, string>, draftIdToClear?: string) {
    // Hold hydrate off this collection until the durable PUT is queued.
    const releaseHold = holdEntityMutation(storeSlug, definition.key);
    try {
    // Snapshot before create() — never re-read memory for the PUT payload.
    // A concurrent hydrate can wipe the optimistic row between create() and save.
    const baseline = loadRecords(storeSlug, definition.key);
    const previous = baseline.map((record) => ({ ...record }));
    const reopenCreate = () =>
      setEditor({
        mode: "create",
        record: { ...values, id: "", createdAt: "", updatedAt: "" } as ManagerRecord,
        draftId: draftIdToClear,
      });
    if (
      (definition.key === "fuel-logs" || definition.key === "maintenance-requests") &&
      values.vehicle &&
      values.odometer
    ) {
      try {
        assertOdometerNotDecreasing(values.vehicle, parseAmount(values.odometer));
      } catch (err) {
        showWarning(
          "Odometer check",
          err instanceof Error ? err.message : "Invalid odometer",
        );
        reopenCreate();
        return;
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const wbsDraftRaw = values.wbsDraft;
    if ("wbsDraft" in values) delete values.wbsDraft;
    if (SAVE_AS_DRAFT_FLAG in values) delete values[SAVE_AS_DRAFT_FLAG];
    const record = create(
      REQUEST_EMAIL_ENTITIES.has(definition.key) &&
        (!values.status ||
          /^(draft|returned for amendment|amendment required|needs amendment)$/i.test(
            values.status,
          ))
        ? { ...values, status: "Submitted", submittedAt: values.submittedAt || today }
        : values,
    );
    // Form already closed when confirm opened — keep closed during the durable write.
    setEditor(null);
    setPayTarget(null);
    // Explicit list including `record` — do not trust loadRecords() here (hydrate race).
    const next = [record, ...baseline.filter((row) => row.id !== record.id)];
    // One row over the wire, not the whole collection.
    const persisted = await createRecordAsync(storeSlug, definition.key, record);
    // Persist finished (or failed) — hydrate may run again; durable truth is in Postgres.
    releaseHold();
    if (
      !persisted.ok ||
      persisted.durable !== "postgres"
    ) {
      // A failed persist is not proof the row is absent: a PUT that timed out or
      // lost a revision race can still have committed. Ask Postgres before
      // touching it — deleting a row that did land is how a saved receipt
      // vanishes for good.
      const remote = await hydrateEntityFromDatabase(storeSlug, definition.key);
      if (!remote.some((row) => row.id === record.id)) {
        // Never reached the database — drop the optimistic row locally only.
        // A removeIds PUT here would delete a late-landing write.
        setMemoryRecords(storeSlug, definition.key, previous);
        window.dispatchEvent(
          new CustomEvent("financeiag-records-changed", {
            detail: { module: storeSlug, entity: definition.key },
          }),
        );
        showWarning(
          "Could not save to database",
          persisted.error || "Changes were not stored. Try again.",
        );
        if (wbsDraftRaw) values.wbsDraft = wbsDraftRaw;
        reopenCreate();
        return;
      }
      // It did land — carry on with the normal post-save work (ledger, drafts).
      showWarning(
        "Saved, but confirmation was slow",
        `${definition.singular} is stored in the database — the save just could not be confirmed on the first try.`,
        { toast: true },
      );
    }
    // Ensure the new id survived conflict retries / hydrate races.
    if (!loadRecords(storeSlug, definition.key).some((row) => row.id === record.id)) {
      setMemoryRecords(storeSlug, definition.key, next);
      window.dispatchEvent(
        new CustomEvent("financeiag-records-changed", {
          detail: { module: storeSlug, entity: definition.key },
        }),
      );
    }
    await removeFormDraftById(draftIdToClear);
    if (definition.key === "projects") {
      const wbsResult = await syncProjectWbs({
        projectName: record.name || values.name || "",
        draft: parseWbsDraft(wbsDraftRaw),
      });
      if (!wbsResult.ok) {
        showWarning(
          "Project saved, but phases failed",
          wbsResult.error || "Could not save phases and activities.",
          { toast: true },
        );
      }
    }
    registerRecordsUndo(`Create ${definition.singular}`, previous);
    revealMoneyRecordIfFiltered(record);
    window.setTimeout(() => {
      const allocationNote =
        (definition.key === "receipts" || definition.key === "payments") &&
        !/^uncategorized/i.test(moneyAllocationLabel(record))
          ? ` Showing under ${moneyAllocationLabel(record)} (All allocations).`
          : "";
      showSuccess(
        "Saved successfully",
        `${definition.singular} was inserted and saved to the database.${allocationNote}`,
        {
          // Form is already closed, so the success modal opens cleanly on the list.
          undoLabel: "Undo create",
          onUndo: () => {
            void restoreRecordsSnapshot(previous);
            showSuccess("Undone", "Create was reversed.");
          },
        },
      );
    }, 80);
    // Server builds GL for ported entities (payments/receipts/…). Never invent lines here.
    // The item write already posted the journal for money documents and told us
    // so — re-posting would be a wasted round trip on the interactive path.
    const result = persisted.ledgerPosted
      ? ({ ok: true } as const)
      : await postRecordToLedger(storeSlug, definition.key, record);
    if (!result.ok) {
      // Record is already durable — keep success modal; warn via toast.
      showWarning(
        "Saved, but ledger posting failed",
        result.error || "Fix the journal setup, then edit and save again to post.",
        { toast: true },
      );
    }
    if (definition.key === "suppliers") {
      const opening = await syncSupplierOpeningBalanceInvoices(record);
      if (!opening.ok) {
        showWarning(
          "Supplier saved, but opening balances failed",
          opening.error || "Could not post opening balance invoices.",
          { toast: true },
        );
      }
    }
    applyInventoryMovement({ entityKey: definition.key, record });
    if (
      (definition.key === "fuel-logs" || definition.key === "maintenance-requests") &&
      record.vehicle &&
      record.odometer
    ) {
      await updateVehicleOdometer(record.vehicle, parseAmount(record.odometer));
    }
    if (definition.key === "fixed-assets") {
      await syncFleetVehicleFromFixedAsset(record);
    }
    if (definition.key === "vehicles") {
      if (values.fixedAsset || values.code) {
        await syncFixedAssetFromFleetVehicle(record);
      }
    }
    if (values.appliedTo) refreshAllocatedDocument(values.appliedTo);
    // Flush ledger + related entity writes so updates are durable in Postgres.
    await awaitInFlightPersists();
    if (definition.fields.some((f) => f.type === "attachments")) {
      try {
        await syncRecordAttachmentsToLibrary({ entityKey: definition.key, record });
      } catch (err) {
        showWarning(
          "Attachments not saved",
          err instanceof Error ? err.message : "Could not save attachments",
          { toast: true },
        );
      }
    }
    logHistory({
      action: "Created",
      module: config.label,
      entity: definition.key,
      record,
    });
    if (REQUEST_EMAIL_ENTITIES.has(definition.key)) {
      notifyRequestParties({
        entityKey: definition.key,
        record,
        event: "created",
      });
    }
    } finally {
      releaseHold();
    }
  }

  function handleCreate(values: Record<string, string>) {
    if (createInFlight.isInFlight()) return;
    const createBlock = assertPageCrud(
      currentUserEntityCrud(config.slug, definition.key),
      "create",
    );
    if (createBlock) {
      showWarning("Permission denied", createBlock);
      return;
    }
    if (definition.key === "reconciliations") {
      const reconBlock = assertPermission("bank-recon");
      if (reconBlock) {
        showWarning("Permission denied", reconBlock);
        return;
      }
    }
    if (SAVE_AS_DRAFT_FLAG in values) delete values[SAVE_AS_DRAFT_FLAG];
    if ("attachments" in values) {
      values.attachments = sanitizeAttachmentsJson(values.attachments);
    }
    const locked = assertUnlocked(values);
    if (locked) {
      showWarning("Period locked", locked);
      return;
    }
    if (definition.key === "inter-account-transfers") {
      const transferError = validateInterAccountTransfer(values);
      if (transferError) {
        showWarning("Could not save", transferError);
        return;
      }
    }
    const candidate = {
      ...values,
      id: "__validate_create__",
      createdAt: "",
      updatedAt: "",
    } as ManagerRecord;
    const controlError = validateAccountingRecord({
      moduleSlug: storeSlug,
      entityKey: definition.key,
      record: candidate,
    });
    if (controlError) {
      showWarning("Could not save", controlError);
      return;
    }
    if (supportsJournalLines(definition.key)) {
      const probe = {
        ...values,
        id: "validate-only",
        createdAt: "",
        updatedAt: "",
      } as ManagerRecord;
      const check = syncRecordToLedger(storeSlug, definition.key, probe);
      unsyncRecordFromLedger("validate-only");
      if (!check.ok) {
        showWarning("Could not save", check.error);
        return;
      }
    }
    // Close the form as soon as validation passes — don't leave it open during save.
    const draftIdToClear = editor?.draftId || editorDraftIdRef.current;
    setEditor(null);
    setPayTarget(null);
    createInFlight.start();
    void commitCreate(values, draftIdToClear).finally(() => {
      createInFlight.finish();
    });
  }

  async function commitUpdate(
    id: string,
    values: Record<string, string>,
    existing: ManagerRecord,
    draftIdToClear?: string,
  ) {
    if (updateInFlight.isInFlight(id)) return;
    updateInFlight.start(id);
    const releaseHold = holdEntityMutation(storeSlug, definition.key);
    try {
    // Snapshot before update() — never re-read memory for the PUT payload.
    const baseline = loadRecords(storeSlug, definition.key);
    const previous = baseline.map((record) => ({ ...record }));
    const reopenEdit = () =>
      setEditor({
        mode: "edit",
        record: { ...existing, ...values, id } as ManagerRecord,
        draftId: draftIdToClear,
      });
    if (
      (definition.key === "fuel-logs" || definition.key === "maintenance-requests") &&
      (values.vehicle || existing.vehicle) &&
      values.odometer
    ) {
      try {
        assertOdometerNotDecreasing(
          values.vehicle || existing.vehicle || "",
          parseAmount(values.odometer),
        );
      } catch (err) {
        showWarning(
          "Odometer check",
          err instanceof Error ? err.message : "Invalid odometer",
        );
        reopenEdit();
        return;
      }
    }
    // Validate approval / void rules before writing so we never need a DB rollback.
    const preview = { ...existing, ...values, id } as ManagerRecord;
    if (
      REQUEST_EMAIL_ENTITIES.has(definition.key) ||
      REQUISITION_CHAIN_ENTITIES.has(definition.key) ||
      definition.key === "requisitions"
    ) {
      const chainErr = assertRequisitionChainStatusChange(
        existing.status,
        preview.status || existing.status || "",
        definition.key,
      );
      if (chainErr) {
        showWarning("Status locked", chainErr);
        reopenEdit();
        return;
      }
    }
    // Resubmit after amendment: stamp submittedAt (amend clears it when returning to requestor).
    if (
      REQUEST_EMAIL_ENTITIES.has(definition.key) &&
      /^(returned for amendment|amendment required|needs amendment)$/i.test(
        (existing.status || "").trim(),
      ) &&
      /^(submitted|pending|awaiting approval)$/i.test(
        (values.status || existing.status || "").trim(),
      )
    ) {
      const today = new Date().toISOString().slice(0, 10);
      values.submittedAt = values.submittedAt || today;
    }
    if (/^approved$/i.test(preview.status || "")) {
      const sod = assertMakerChecker(existing?.createdBy || existing?.user);
      if (sod) {
        showWarning("Approval blocked", sod);
        reopenEdit();
        return;
      }
    }
    if (/void|voided/i.test(preview.status || "")) {
      const voidPerm = assertPermission("void");
      if (voidPerm) {
        showWarning("Void blocked", voidPerm);
        reopenEdit();
        return;
      }
    }
    const wbsDraftRaw = values.wbsDraft;
    if ("wbsDraft" in values) delete values.wbsDraft;
    if (SAVE_AS_DRAFT_FLAG in values) delete values[SAVE_AS_DRAFT_FLAG];
    // Keep the requestor's first figure when the amount is revised after amend/approval.
    if (REQUEST_EMAIL_ENTITIES.has(definition.key) && entitySupportsApprovalAmount(definition.key)) {
      const moneyKey =
        "estimatedCost" in values && String(values.estimatedCost || "").trim()
          ? "estimatedCost"
          : "total" in values && String(values.total || "").trim()
            ? "total"
            : "amount";
      const nextMoney = String(values[moneyKey] ?? existing[moneyKey] ?? "").trim();
      const prevMoney = String(existing[moneyKey] || existing.amount || "").trim();
      if (
        nextMoney &&
        prevMoney &&
        nextMoney.replace(/,/g, "") !== prevMoney.replace(/,/g, "") &&
        !String(existing.originalAmount || values.originalAmount || "").trim()
      ) {
        values.originalAmount = prevMoney;
      }
    }
    const updatedRecord = update(id, values) as ManagerRecord | null;
    if (!updatedRecord) {
      reopenEdit();
      return;
    }
    // Form already closed when confirm opened — keep closed during the durable write.
    setEditor(null);
    setPayTarget(null);
    // Only the changed fields go over the wire; the API merges onto the stored row.
    const persisted = await updateRecordAsync(storeSlug, definition.key, id, values);
    releaseHold();
    if (
      !persisted.ok ||
      persisted.durable !== "postgres"
    ) {
      update(id, existing);
      showWarning(
        "Could not save to database",
        persisted.error || "Changes were not stored. Try again.",
      );
      if (wbsDraftRaw) values.wbsDraft = wbsDraftRaw;
      reopenEdit();
      return;
    }
    // Keep subledgers / bank activity continuous when master names change.
    try {
      const { rewriteBankAccountIdentity, rewritePartyIdentity } = await import(
        "@/lib/accounting-party-bank"
      );
      if (definition.key === "bank-and-cash-accounts") {
        const fromName = (existing.name || existing.account || "").trim();
        const toName = (updatedRecord.name || updatedRecord.account || "").trim();
        if (fromName && toName && fromName.toLowerCase() !== toName.toLowerCase()) {
          await rewriteBankAccountIdentity({ fromName, toName });
        }
      }
      if (
        definition.key === "customers" ||
        definition.key === "customers-receivable" ||
        definition.key === "suppliers" ||
        definition.key === "suppliers-payable"
      ) {
        const side =
          definition.key === "customers" || definition.key === "customers-receivable"
            ? "receivable"
            : "payable";
        const fromName = (existing.name || existing.company || existing.party || "").trim();
        const toName = (
          updatedRecord.name ||
          updatedRecord.company ||
          updatedRecord.party ||
          ""
        ).trim();
        if (fromName && toName && fromName.toLowerCase() !== toName.toLowerCase()) {
          await rewritePartyIdentity({ side, fromName, toName });
        }
      }
    } catch {
      /* best-effort continuity */
    }
    await removeFormDraftById(draftIdToClear);
    if (definition.key === "projects") {
      const wbsResult = await syncProjectWbs({
        projectName: updatedRecord.name || values.name || existing.name || "",
        previousProjectName: existing.name || "",
        draft: parseWbsDraft(wbsDraftRaw),
      });
      if (!wbsResult.ok) {
        showWarning(
          "Project saved, but phases failed",
          wbsResult.error || "Could not save phases and activities.",
          { toast: true },
        );
      }
    }
    registerRecordsUndo(`Update ${definition.singular}`, previous);
    revealMoneyRecordIfFiltered(updatedRecord);
    window.setTimeout(() => {
      const allocationNote =
        (definition.key === "receipts" || definition.key === "payments") &&
        !/^uncategorized/i.test(moneyAllocationLabel(updatedRecord))
          ? ` Now listed as ${moneyAllocationLabel(updatedRecord)} — switched to All allocations so it stays visible.`
          : "";
      showSuccess(
        "Saved successfully",
        `${definition.singular} changes were saved.${allocationNote}`,
        {
          // Form is already closed, so the success modal opens cleanly on the list.
          undoLabel: "Undo changes",
          onUndo: () => {
            void restoreRecordsSnapshot(previous);
            showSuccess("Undone", "Update was reversed.");
          },
        },
      );
    }, 80);
    logFieldChanges({
      module: storeSlug,
      entity: definition.key,
      recordId: id,
      previous: existing,
      next: updatedRecord,
    });
    // Money documents were already re-posted by the item write (see commitCreate).
    const result = persisted.ledgerPosted
      ? ({ ok: true } as const)
      : await postRecordToLedger(storeSlug, definition.key, updatedRecord);
    if (!result.ok) {
      // Changes are already in Postgres — keep success modal; warn via toast.
      showWarning(
        "Saved, but ledger posting failed",
        result.error || "Fix the journal setup, then edit and save again to post.",
        { toast: true },
      );
    }
    if (definition.key === "suppliers") {
      const opening = await syncSupplierOpeningBalanceInvoices(updatedRecord);
      if (!opening.ok) {
        showWarning(
          "Supplier saved, but opening balances failed",
          opening.error || "Could not post opening balance invoices.",
          { toast: true },
        );
      }
    }
    applyInventoryMovement({
      entityKey: definition.key,
      record: updatedRecord,
      previous: existing,
    });
    if (
      (definition.key === "fuel-logs" || definition.key === "maintenance-requests") &&
      updatedRecord.vehicle &&
      updatedRecord.odometer
    ) {
      await updateVehicleOdometer(updatedRecord.vehicle, parseAmount(updatedRecord.odometer));
    }
    if (definition.key === "fixed-assets") {
      await syncFleetVehicleFromFixedAsset(updatedRecord);
    }
    if (definition.key === "vehicles") {
      if (updatedRecord.fixedAsset || updatedRecord.code) {
        await syncFixedAssetFromFleetVehicle(updatedRecord);
      }
    }
    const priorApplied = existing.appliedTo || "";
    const nextApplied = updatedRecord.appliedTo || "";
    if (priorApplied) refreshAllocatedDocument(priorApplied);
    if (nextApplied) refreshAllocatedDocument(nextApplied);
    // Flush ledger + related entity writes so updates are durable in Postgres.
    await awaitInFlightPersists();
    if (definition.fields.some((f) => f.type === "attachments")) {
      try {
        await syncRecordAttachmentsToLibrary({
          entityKey: definition.key,
          record: updatedRecord,
        });
      } catch (err) {
        showWarning(
          "Attachments not saved",
          err instanceof Error ? err.message : "Could not save attachments",
          { toast: true },
        );
      }
    }
    logHistory({
      action: "Updated",
      module: config.label,
      entity: definition.key,
      record: updatedRecord,
    });
    if (REQUEST_EMAIL_ENTITIES.has(definition.key)) {
      const statusChanged =
        (existing.status || "") !== (updatedRecord.status || "");
      const notesChanged =
        (existing.notes || "").trim() !== (updatedRecord.notes || "").trim();
      if (statusChanged) {
        const nextStatus = updatedRecord.status || "";
        const event =
          /^(rejected|declined)$/i.test(nextStatus)
            ? "rejected"
            : /^(paid|complete|completed|settled|fulfilled|issued|follow-up complete)$/i.test(
                  nextStatus,
                )
              ? "paid"
              : /^(submitted|pending|awaiting approval)$/i.test(nextStatus)
                ? "submitted"
                : "advanced";
        notifyRequestParties({
          entityKey: definition.key,
          record: updatedRecord,
          event,
          previousStatus: existing.status,
          comment:
            event === "rejected"
              ? (updatedRecord.rejectionReason || updatedRecord.notes || "").trim()
              : undefined,
        });
      } else if (notesChanged && (updatedRecord.notes || "").trim()) {
        notifyRequestParties({
          entityKey: definition.key,
          record: updatedRecord,
          event: "commented",
          comment: (updatedRecord.notes || "").trim(),
        });
      }
    }
    } finally {
      releaseHold();
      updateInFlight.finish(id);
    }
  }

  function toggleCoaInactive(record: ManagerRecord) {
    const nowInactive = /^(inactive|obsolete|archived|disabled|hidden)$/i.test(
      (record.status || "").trim(),
    );
    void commitUpdate(record.id, { status: nowInactive ? "Active" : "Inactive" }, record);
  }

  function handleUpdate(id: string, values: Record<string, string>) {
    const existing = records.find((r) => r.id === id);
    if (!existing) return;

    if (SAVE_AS_DRAFT_FLAG in values) delete values[SAVE_AS_DRAFT_FLAG];

    if ("attachments" in values) {
      values.attachments = sanitizeAttachmentsJson(values.attachments);
    }

    const changedKeys = Object.keys(values).filter(
      (key) => (values[key] || "") !== (existing[key] || ""),
    );
    const onlyStatus = changedKeys.length === 1 && changedKeys[0] === "status";
    const approving = onlyStatus && /^approved$/i.test(values.status || "");
    const voiding = onlyStatus && /void|voided/i.test(values.status || "");
    const pageCrud = currentUserEntityCrud(config.slug, definition.key);

    if (definition.key === "reconciliations") {
      const reconBlock = assertPermission("bank-recon");
      if (reconBlock) {
        showWarning("Permission denied", reconBlock);
        return;
      }
    }

    if (!pageCrud.edit) {
      if (approving && currentUserCan("approve")) {
        // Approvers may change status to Approved only.
      } else if (voiding && currentUserCan("void")) {
        // Void-capable roles may change status to Void only.
      } else {
        showWarning(
          "Permission denied",
          assertPageCrud(pageCrud, "edit") ||
            "Your role cannot edit this record. Approve-only users may only set status to Approved.",
        );
        return;
      }
    }

    if (
      isRequestChainEntityKey(definition.key) &&
      !canEditRequestChainRecord(
        definition.key,
        existing.status || "",
        getCurrentSessionUser()?.role || "",
        existing,
        getCurrentSessionUser(),
      )
    ) {
      showWarning(
        "Edit locked",
        "Only the requestor (or an administrator) can edit this while it is Draft or Returned for Amendment. Use Approve, Reject, or Return for amendment on the desk for in-flight requests.",
      );
      return;
    }

    if (approving) {
      const sod = assertMakerChecker(existing.createdBy || existing.user);
      if (sod) {
        showWarning("Approval blocked", sod);
        return;
      }
      const approveBlock = assertPermission("approve");
      if (approveBlock) {
        showWarning("Permission denied", approveBlock);
        return;
      }
    }
    if (voiding) {
      const voidBlock = assertPermission("void");
      if (voidBlock) {
        showWarning("Permission denied", voidBlock);
        return;
      }
    }

    const locked =
      assertUnlocked(values) ||
      assertUnlocked(existing);
    if (locked) {
      showWarning("Period locked", locked);
      return;
    }
    if (definition.key === "inter-account-transfers") {
      const transferError = validateInterAccountTransfer({ ...existing, ...values });
      if (transferError) {
        showWarning("Could not save", transferError);
        return;
      }
    }
    const candidate = { ...existing, ...values, id } as ManagerRecord;
    const controlError = validateAccountingRecord({
      moduleSlug: storeSlug,
      entityKey: definition.key,
      record: candidate,
      previous: existing,
    });
    if (controlError) {
      showWarning("Could not save", controlError);
      return;
    }
    if (supportsJournalLines(definition.key)) {
      const check = syncRecordToLedger(storeSlug, definition.key, {
        ...existing,
        ...values,
        id: "validate-only",
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      });
      unsyncRecordFromLedger("validate-only");
      if (!check.ok) {
        showWarning("Could not save", check.error);
        return;
      }
    }
    // Close the form as soon as validation passes — don't leave it open during save.
    const draftIdToClear = editor?.draftId || editorDraftIdRef.current;
    setEditor(null);
    setPayTarget(null);
    void commitUpdate(id, values, existing, draftIdToClear);
  }

  async function performDelete(ids: string[]) {
    const previous = records.map((record) => ({ ...record }));
    const toDelete = ids
      .map((id) => records.find((r) => r.id === id))
      .filter(Boolean) as ManagerRecord[];
    // Persist to Postgres first — never strip ledger/inventory until the delete is durable.
    // One DELETE per row instead of re-uploading everything that survives.
    const persisted = await deleteRecordsAsync(storeSlug, definition.key, ids);
    if (!persisted.ok || persisted.durable !== "postgres") {
      showWarning(
        "Could not delete from database",
        persisted.error || "Delete was not stored. Try again.",
      );
      return;
    }

    for (const existing of toDelete) {
      unsyncRecordFromLedger(existing.id);
      if (definition.key === "suppliers") {
        await removeSupplierOpeningBalanceInvoices(existing);
      }
      applyInventoryMovement({
        entityKey: definition.key,
        record: existing,
        previous: existing,
        removing: true,
      });
      if (existing.appliedTo) refreshAllocatedDocument(existing.appliedTo);
      logHistory({
        action: "Deleted",
        module: config.label,
        entity: definition.key,
        record: existing,
      });
      logDeletedRecord({
        module: config.label,
        entity: definition.key,
        record: existing,
      });
    }
    if (definition.key === "chart-of-accounts") {
      deleteChartOfAccountsRecords(toDelete);
    }
    await awaitInFlightPersists();
    setSelected([]);
    registerRecordsUndo(`Delete ${definition.label}`, previous);
    showSuccess(
      "Deleted successfully",
      `${ids.length} record${ids.length === 1 ? "" : "s"} removed from the database.`,
      {
        undoLabel: "Undo delete",
        onUndo: () => {
          void restoreRecordsSnapshot(previous);
          showSuccess("Undone", "Delete was reversed.");
        },
      },
    );
  }

  function deleteRecords(ids: string[]) {
    if (!ids.length) return;
    const deleteBlock = assertPageCrud(
      currentUserEntityCrud(config.slug, definition.key),
      "delete",
    );
    if (deleteBlock) {
      showWarning("Permission denied", deleteBlock);
      return;
    }
    for (const id of ids) {
      const existing = records.find((r) => r.id === id);
      if (existing) {
        const locked = assertUnlocked(existing);
        if (locked) {
          showWarning("Period locked", locked);
          return;
        }
        if (definition.key === "chart-of-accounts") {
          const accountError = validateAccountDeletion(existing);
          if (accountError) {
            showWarning("Account in use", accountError);
            return;
          }
        }
      }
    }
    askConfirm({
      title: "Delete records?",
      message: `Permanently delete ${ids.length} selected record${ids.length === 1 ? "" : "s"} from the database? You can undo this afterward if needed.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        void performDelete(ids);
      },
    });
  }

  /**
   * Run a verb the owning service exposes on one record.
   *
   * The verbs come from the collection read, not from a list in this file, so a
   * screen offers exactly what its own service has. On this tab that is the
   * difference between a roast batch that can be finished and one that cannot:
   * a run's stage moves through `/advance` and `/complete` and a downtime event
   * closes through `/:id/end`, none of which is a field on the record, so with
   * no way to call them the app could start a roast and never end one.
   *
   * The service is the authority on permission — these codenames are platform
   * permissions and the browser has no way to evaluate them — so a refusal is
   * shown as the service worded it rather than guessed at beforehand.
   */
  async function runUpstreamAction(record: ManagerRecord, action: EntityAction) {
    const key = `${record.id}:${action.id}`;
    if (runningAction) return;
    setRunningAction(key);
    try {
      const res = await apiFetch(
        `/api/records/${encodeURIComponent(storeSlug)}/${encodeURIComponent(
          definition.key,
        )}/${encodeURIComponent(record.id)}/${encodeURIComponent(action.id)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.ok) {
        showWarning(
          `Could not ${action.label.toLowerCase()} this ${definition.singular.toLowerCase()}`,
          body?.error || `The service refused the request (${res.status}).`,
        );
        return;
      }
      // Re-read rather than patch in place: completing a run changes the run
      // AND the order status derived from it, and only the service knows both.
      await hydrateEntityFromDatabase(storeSlug, definition.key);
      logHistory({
        action: action.doneLabel,
        module: config.label,
        entity: definition.key,
        record,
      });
      showSuccess(
        action.doneLabel,
        `“${record.reference || record.name || definition.singular}” was ${action.doneLabel.toLowerCase()}.`,
        { autoCloseMs: 2500 },
      );
    } catch (err) {
      showWarning(
        `Could not ${action.label.toLowerCase()} this ${definition.singular.toLowerCase()}`,
        err instanceof Error ? err.message : "The request did not complete.",
      );
    } finally {
      setRunningAction(null);
    }
  }

  /** Verbs offered on one row: those this record's status is eligible for. */
  function actionsForRecord(record: ManagerRecord): EntityAction[] {
    const available = knownEntityCapabilities(storeSlug, definition.key)?.actions;
    if (!available?.length) return [];
    const status = (record.status || "").trim().toLowerCase();
    return available.filter(
      (action) =>
        !action.whenStatus?.length ||
        action.whenStatus.some((allowed) => allowed.toLowerCase() === status),
    );
  }

  const allSelected =
    pageItems.length > 0 && pageItems.every((record) => selected.includes(record.id));

  const historyReadOnly =
    definition.key === "history" || definition.key === "deleted-records";
  void accessTick;
  // Tab → module → workspace CRUD (Users page matrix keys like fleet/fuel-logs).
  const pageCrud = currentUserEntityCrud(config.slug, definition.key);
  // What the upstream will accept, which is a different question from what this
  // user is allowed to do. Production orders, plans and roast batches have no
  // update verb and nothing here can be deleted; drawing the buttons from RBAC
  // alone offered all three and refused them on save. Null means the backend
  // did not say — the legacy API never does — and unknown means allowed, so
  // this can only ever subtract a control the server would have rejected.
  const upstream = knownEntityCapabilities(storeSlug, definition.key);
  const canBankRecon =
    definition.key !== "reconciliations" || currentUserCan("bank-recon");
  const canMutate =
    !historyReadOnly && pageCrud.create && canBankRecon && (upstream?.create ?? true);
  const canDelete =
    !historyReadOnly && pageCrud.delete && (upstream?.delete ?? true);
  // Edit is independent of create — Clerk can create without edit; editors need edit only.
  const canApprove = !historyReadOnly && currentUserCan("approve") && pageCrud.edit;
  const sessionUser = getCurrentSessionUser();
  const canEditRecord = (record: ManagerRecord) => {
    if (historyReadOnly) return false;
    if (!canBankRecon) return false;
    // A completed run is corrected by another run, never by editing history —
    // these services expose no PATCH for them at all.
    if (upstream && !upstream.update) return false;
    if (isRequestChainEntityKey(definition.key)) {
      return canEditRequestChainRecord(
        definition.key,
        record.status || "",
        sessionUser?.role || "",
        record,
        sessionUser,
      );
    }
    return pageCrud.edit || canApprove;
  };
  const canEdit = ((!historyReadOnly && pageCrud.edit) || canApprove) && canBankRecon;
  const canPayroll =
    !historyReadOnly && pageCrud.create && pageCrud.edit;

  function confirmRedoRejectedRequest(record: ManagerRecord) {
    const session = getCurrentSessionUser();
    if (
      !canRedoRejectedRequest(
        record.status || "",
        session?.role || "",
        record,
        session,
      )
    ) {
      showWarning(
        "Cannot redo",
        "Only the requestor or an administrator can redo a rejected request.",
      );
      return;
    }
    const reason = (record.rejectionReason || "").trim();
    askConfirm({
      title: "Redo rejected request?",
      message: `Return ${record.reference || "this request"} for amendment so you can correct it and resubmit.${
        reason ? ` Rejection reason: “${reason}”.` : ""
      } The reason stays visible while you edit.`,
      confirmLabel: "Redo request",
      danger: false,
      commentLabel: "Note (optional)",
      commentPlaceholder: "What you are fixing before resubmitting…",
      onConfirm: (comment) => {
        void (async () => {
          const note =
            (comment || "").trim() ||
            "Reopening rejected request to correct and resubmit.";
          const opts = { comment: note, returnMode: "previous" as const };
          let result: { ok: boolean; error?: string; record?: ManagerRecord };
          if (definition.key === "payment-requests") {
            result = await amendPaymentRequest(record.id, opts);
          } else if (definition.key === "oral-payment-requests") {
            result = await amendOralPaymentRequest(record.id, opts);
          } else if (definition.key === "payroll-runs") {
            result = await amendPayrollRun(record.id, opts);
          } else {
            result = await amendGenericRequisition(definition.key, record.id, opts);
          }
          if (!result.ok) {
            showWarning("Cannot redo", result.error || "Redo failed.");
            return;
          }
          showSuccess(
            "Ready to redo",
            `${record.reference || "Request"} is back with you for amendment. Edit it, then resubmit.`,
          );
          setEditor({
            mode: "edit",
            record:
              result.record || {
                ...record,
                status: "Returned for Amendment",
              },
          });
        })();
      },
    });
  }
  const canImport =
    !historyReadOnly &&
    canBulkImportEntity(definition.key, {
      canCreate: pageCrud.create,
      canEdit: pageCrud.edit,
    });
  // Show Import CSV + CSV template on every list toolbar (same cluster as Export),
  // including report views — click warns when the list can't store imports.
  const showCsvToolbar = !historyReadOnly;

  const detailRecord = detailId
    ? displayRecords.find((record) => record.id === detailId) ||
      records.find((record) => record.id === detailId) ||
      null
    : null;
  const detailSide = detailRecord ? invoicePaymentSide(definition.key) : null;
  const canPayDetail =
    Boolean(detailRecord) &&
    Boolean(detailSide) &&
    canMutate &&
    !/draft|void|voided|cancelled|canceled|paid/i.test(detailRecord!.status || "") &&
    // detailRecord comes from displayRecords, so it is already enriched —
    // recomputing here re-scanned every payment on each render of the table.
    rowOpenBalance(detailRecord!) > 0;
  const canRequestPaymentDetail =
    Boolean(detailRecord) &&
    canMutate &&
    canRaisePaymentRequest(definition.key) &&
    !/draft|void|voided|cancelled|canceled|paid/i.test(detailRecord!.status || "");

  async function raisePaymentRequest(record: ManagerRecord) {
    const result = await createPaymentRequestFromSource({
      moduleSlug: storeSlug,
      entityKey: definition.key,
      record,
    });
    if (!result.ok) {
      showWarning("Payment request blocked", result.error);
      return;
    }
    if (result.existing) {
      showSuccess(
        "Already requested",
        `${result.request.reference} is already in the approval queue for this document.`,
      );
      router.push(
        `/projects?view=payment-requests&open=${encodeURIComponent(result.request.id)}`,
      );
      return;
    }
    showSuccess(
      "Submitted for approval",
      `${result.request.reference} sent to Accounts Assistant → GM → CEO → Finance.`,
    );
    router.push(
      `/projects?view=payment-requests&open=${encodeURIComponent(result.request.id)}`,
    );
  }

  return (
    <>
      <FeedbackModals feedback={feedback} onClose={close} />
      {detailId ? (
        !ready ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 space-y-2">
              <div className="h-4 w-32 animate-shimmer rounded bg-slate-100" />
              <div className="h-7 w-56 animate-shimmer rounded bg-slate-100" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-20 animate-shimmer rounded bg-slate-100" />
                  <div className="h-4 w-36 animate-shimmer rounded bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
        ) : !detailRecord ? (
          <RecordDetailMissing definition={definition} backHref={listHref} />
        ) : (
          <RecordDetailPage
            definition={definition}
            record={detailRecord}
            backHref={listHref}
            onEdit={
              canEditRecord(detailRecord)
                ? () => setEditor({ mode: "edit", record: detailRecord })
                : undefined
            }
            onPay={
              canPayDetail
                ? () => {
                    setEditor(null);
                    setPayTarget(detailRecord);
                  }
                : undefined
            }
            extraContent={
              definition.key === "contractors" ? (
                <ContractorInvoicesSection contractor={detailRecord} />
              ) : definition.key === "oral-payment-requests" ? (
                <div className="space-y-4">
                  <RequestOutcomeBanner
                    record={detailRecord}
                    onRedo={() => confirmRedoRejectedRequest(detailRecord)}
                  />
                  <OralPaymentChainProgress
                    status={detailRecord.status || ""}
                    record={detailRecord}
                  />
                </div>
              ) : definition.key === "payroll-runs" ? (
                <div className="space-y-4">
                  <RequestOutcomeBanner
                    record={detailRecord}
                    onRedo={() => confirmRedoRejectedRequest(detailRecord)}
                  />
                  <GenericRequisitionChainProgress
                    status={detailRecord.status || ""}
                    record={detailRecord}
                    entityKey={definition.key}
                  />
                </div>
              ) : definition.key === "requisitions" ? (
                <div className="space-y-4">
                  <RequestOutcomeBanner
                    record={detailRecord}
                    onRedo={() => confirmRedoRejectedRequest(detailRecord)}
                  />
                  <MaterialRequestLinesEditor
                    lines={materialRequestLinesFromRecord(detailRecord)}
                    onChange={() => {}}
                    project={detailRecord.project}
                    contractor={detailRecord.contractor}
                    neededBy={detailRecord.neededBy || detailRecord.date}
                    readOnly
                  />
                  <GenericRequisitionChainProgress
                    status={detailRecord.status || ""}
                    record={detailRecord}
                    entityKey={definition.key}
                  />
                </div>
              ) : definition.key === "general-requests" ||
                definition.key === "payment-requests" ||
                definition.key === "fuel-requests" ||
                definition.key === "trip-requests" ||
                definition.key === "maintenance-requests" ||
                definition.key === "equipment-and-vehicle-requests" ||
                definition.key === "document-requests" ||
                definition.key === "leave-requests" ? (
                <div className="space-y-4">
                  <RequestOutcomeBanner
                    record={detailRecord}
                    onRedo={() => confirmRedoRejectedRequest(detailRecord)}
                  />
                  <GenericRequisitionChainProgress
                    status={detailRecord.status || ""}
                    record={detailRecord}
                    entityKey={definition.key}
                  />
                </div>
              ) : null
            }
            extraActions={
              definition.key === "payment-requests" ? (
                <PaymentRequestChainActions
                  record={detailRecord}
                  onAdvance={async (id, options) => {
                    const result = await advancePaymentRequest(id, options);
                    if (!result.ok) {
                      showWarning("Could not advance", result.error || "Action failed.");
                      return;
                    }
                    if (result.amended) {
                      showSuccess(
                        "Returned for amendment",
                        `${detailRecord.reference || "Request"} sent back to ${
                          result.record?.amendedReturnTo || result.nextStatus || "previous user"
                        }.`,
                      );
                      return;
                    }
                    showSuccess(
                      result.nextStatus === "Paid" ? "Paid" : "Advanced",
                      `${detailRecord.reference || "Request"} → ${result.nextStatus}${
                        result.paymentId ? " (banking payment created)" : ""
                      }.`,
                    );
                  }}
                  onReject={(id) => {
                    askConfirm({
                      title: "Reject payment request?",
                      message: `Reject ${detailRecord.reference || "this request"}? This stops the approval chain and emails the parties involved.`,
                      confirmLabel: "Reject",
                      danger: true,
                      commentLabel: "Reason",
                      commentPlaceholder: "Reason for rejection (sent to requestor and executives)…",
                      commentRequired: true,
                      amountLabel: "Amount",
                      amountValue: detailRecord.amount || "",
                      amountCurrency: detailRecord.currency || "UGX",
                      onConfirm: (comment, extras) => {
                        void (async () => {
                          const result = await rejectPaymentRequest(id, {
                            comment,
                            amount: extras?.amount,
                          });
                          if (!result.ok) {
                            showWarning("Could not reject", result.error || "Reject failed.");
                            return;
                          }
                          showSuccess("Rejected", `${detailRecord.reference || "Request"} rejected.`);
                        })();
                      },
                    });
                  }}
                  onAmend={(id, mode) => {
                    const original =
                      (detailRecord.originalAmount || detailRecord.amount || "").trim() || "—";
                    askConfirm({
                      title: "Return for amendment?",
                      message: `Send ${detailRecord.reference || "this request"} one step back for amendment. Add a comment explaining what to change. Original amount: ${detailRecord.currency || "UGX"} ${original}.`,
                      confirmLabel: "Return for amendment",
                      danger: false,
                      commentLabel: "What should change",
                      commentPlaceholder: "Tell them what to change…",
                      commentRequired: true,
                      amountLabel: "Amended amount",
                      amountValue: detailRecord.amount || "",
                      amountCurrency: detailRecord.currency || "UGX",
                      onConfirm: (comment, extras) => {
                        void (async () => {
                          const result = await amendPaymentRequest(id, {
                            comment,
                            amount: extras?.amount,
                            returnMode: "previous",
                          });
                          if (!result.ok) {
                            showWarning("Could not amend", result.error || "Amend failed.");
                            return;
                          }
                          const next =
                            result.record?.amendedReturnTo ||
                            result.record?.status ||
                            "the previous step";
                          showSuccess(
                            "Returned for amendment",
                            `${detailRecord.reference || "Request"} sent back to ${next}.`,
                          );
                        })();
                      },
                    });
                  }}
                  onConfirmAdvance={(label, message, run, options) => {
                    askConfirm({
                      title: `${label}?`,
                      message,
                      confirmLabel: label,
                      danger: false,
                      commentLabel: options?.commentLabel,
                      commentPlaceholder: options?.commentPlaceholder,
                      amountLabel: options?.amountLabel,
                      amountValue: options?.amountValue,
                      amountCurrency: options?.amountCurrency,
                      paymentMethodLabel: options?.paymentMethodLabel,
                      paymentMethodOptions: options?.paymentMethodLabel
                        ? REQUEST_PAYMENT_METHODS
                        : undefined,
                      paymentMethodValue: options?.paymentMethodValue,
                      paymentMethodRequired: Boolean(options?.paymentMethodLabel),
                      bankAccountLabel: options?.bankAccountLabel,
                      bankAccountValue: options?.bankAccountValue,
                      bankAccountRequired: Boolean(options?.bankAccountLabel),
                      onConfirm: (comment, extras) => {
                        void run({
                          comment,
                          amount: extras?.amount,
                          paymentMethod: extras?.paymentMethod,
                          bankAccount: extras?.bankAccount,
                        });
                      },
                    });
                  }}
                />
              ) : definition.key === "oral-payment-requests" ? (
                <>
                <OralPaymentChainActions
                  record={detailRecord}
                  onAdvance={async (id, options) => {
                    const result = await advanceOralPaymentRequest(id, options);
                    if (!result.ok) {
                      showWarning("Could not advance", result.error || "Action failed.");
                      return;
                    }
                    if (result.amended) {
                      showSuccess(
                        "Returned for amendment",
                        `${detailRecord.reference || "Request"} sent back to ${
                          result.record?.amendedReturnTo || result.nextStatus || "previous user"
                        }.`,
                      );
                      return;
                    }
                    showSuccess(
                      result.nextStatus === "Paid" ? "Paid" : "Advanced",
                      `${detailRecord.reference || "Request"} → ${result.nextStatus}.`,
                    );
                  }}
                  onReject={(id) => {
                    askConfirm({
                      title: "Reject oral payment request?",
                      message: `Reject ${detailRecord.reference || "this request"}? This stops the approval chain and emails the parties involved.`,
                      confirmLabel: "Reject",
                      danger: true,
                      commentLabel: "Reason",
                      commentPlaceholder: "Reason for rejection (sent to requestor and executives)…",
                      commentRequired: true,
                      amountLabel: "Amount",
                      amountValue: detailRecord.amount || "",
                      amountCurrency: detailRecord.currency || "UGX",
                      onConfirm: (comment, extras) => {
                        void (async () => {
                          const result = await rejectOralPaymentRequest(id, {
                            comment,
                            amount: extras?.amount,
                          });
                          if (!result.ok) {
                            showWarning("Could not reject", result.error || "Reject failed.");
                            return;
                          }
                          showSuccess("Rejected", `${detailRecord.reference || "Request"} rejected.`);
                        })();
                      },
                    });
                  }}
                  onAmend={(id, mode) => {
                    const original =
                      (detailRecord.originalAmount || detailRecord.amount || "").trim() || "—";
                    askConfirm({
                      title: "Return for amendment?",
                      message: `Send ${detailRecord.reference || "this request"} one step back for amendment. Add a comment. Original amount: ${detailRecord.currency || "UGX"} ${original}.`,
                      confirmLabel: "Return for amendment",
                      danger: false,
                      commentLabel: "What should change",
                      commentPlaceholder: "Tell them what to change…",
                      commentRequired: true,
                      amountLabel: "Amended amount",
                      amountValue: detailRecord.amount || "",
                      amountCurrency: detailRecord.currency || "UGX",
                      onConfirm: (comment, extras) => {
                        void (async () => {
                          const result = await amendOralPaymentRequest(id, {
                            comment,
                            amount: extras?.amount,
                            returnMode: "previous",
                          });
                          if (!result.ok) {
                            showWarning("Could not amend", result.error || "Amend failed.");
                            return;
                          }
                          const next =
                            result.record?.amendedReturnTo ||
                            result.record?.status ||
                            "the previous step";
                          showSuccess(
                            "Returned for amendment",
                            `${detailRecord.reference || "Request"} sent back to ${next}.`,
                          );
                        })();
                      },
                    });
                  }}
                  onConfirmAdvance={(label, message, run, options) => {
                    askConfirm({
                      title: `${label}?`,
                      message,
                      confirmLabel: label,
                      danger: false,
                      commentLabel: options?.commentLabel,
                      commentPlaceholder: options?.commentPlaceholder,
                      amountLabel: options?.amountLabel,
                      amountValue: options?.amountValue,
                      amountCurrency: options?.amountCurrency,
                      paymentMethodLabel: options?.paymentMethodLabel,
                      paymentMethodOptions: options?.paymentMethodLabel
                        ? REQUEST_PAYMENT_METHODS
                        : undefined,
                      paymentMethodValue: options?.paymentMethodValue,
                      paymentMethodRequired: Boolean(options?.paymentMethodLabel),
                      bankAccountLabel: options?.bankAccountLabel,
                      bankAccountValue: options?.bankAccountValue,
                      bankAccountRequired: Boolean(options?.bankAccountLabel),
                      onConfirm: (comment, extras) => {
                        void run({
                          comment,
                          amount: extras?.amount,
                          paymentMethod: extras?.paymentMethod,
                          bankAccount: extras?.bankAccount,
                        });
                      },
                    });
                  }}
                />
                {/^paid$/i.test(detailRecord.status || "") &&
                !(detailRecord.paymentRecordId || "").trim() ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 border-amber-200 text-amber-900 hover:bg-amber-50"
                    onClick={() => {
                      void (async () => {
                        const settled = await ensureOralPaymentCashSettled(detailRecord.id);
                        if (!settled.ok) {
                          showWarning("Could not post payment", settled.error);
                          return;
                        }
                        showSuccess(
                          "Banking payment posted",
                          `${detailRecord.reference || "Request"} linked to a banking payment.`,
                        );
                      })();
                    }}
                  >
                    Post banking payment
                  </Button>
                ) : null}
                </>
              ) : definition.key === "payroll-runs" ? (
                <PayrollRunChainActions
                  record={detailRecord}
                  onAdvance={async (id, options) => {
                    const result = await advancePayrollRun(id, options);
                    if (!result.ok) {
                      showWarning("Could not advance", result.error || "Action failed.");
                      return;
                    }
                    if (result.amended) {
                      showSuccess(
                        "Returned for amendment",
                        `${detailRecord.reference || "Payroll run"} sent back to ${
                          result.record?.amendedReturnTo || result.nextStatus || "previous user"
                        }.`,
                      );
                      return;
                    }
                    showSuccess(
                      result.nextStatus === "Paid" ? "Payroll released" : "Advanced",
                      result.nextStatus === "Paid"
                        ? `${detailRecord.reference || "Payroll run"} released${
                            result.createdCount
                              ? ` — ${result.createdCount} payslip(s) created`
                              : ""
                          }.`
                        : `${detailRecord.reference || "Payroll run"} → ${result.nextStatus}.`,
                    );
                  }}
                  onReject={(id) => {
                    askConfirm({
                      title: "Reject payroll run?",
                      message: `Reject ${detailRecord.reference || "this payroll run"}? This stops the approval chain.`,
                      confirmLabel: "Reject",
                      danger: true,
                      commentLabel: "Reason",
                      commentPlaceholder: "Reason for rejection…",
                      commentRequired: true,
                      amountLabel: "Net pay total",
                      amountValue: detailRecord.amount || "",
                      amountCurrency: detailRecord.currency || "UGX",
                      onConfirm: (comment, extras) => {
                        void (async () => {
                          const result = await rejectPayrollRun(id, {
                            comment,
                            amount: extras?.amount,
                          });
                          if (!result.ok) {
                            showWarning("Could not reject", result.error || "Reject failed.");
                            return;
                          }
                          showSuccess(
                            "Rejected",
                            `${detailRecord.reference || "Payroll run"} rejected.`,
                          );
                        })();
                      },
                    });
                  }}
                  onAmend={(id) => {
                    askConfirm({
                      title: "Return for amendment?",
                      message: `Send ${detailRecord.reference || "this payroll run"} one step back for amendment.`,
                      confirmLabel: "Return for amendment",
                      danger: false,
                      commentLabel: "What should change",
                      commentPlaceholder: "Tell them what to change…",
                      commentRequired: true,
                      amountLabel: "Net pay total",
                      amountValue: detailRecord.amount || "",
                      amountCurrency: detailRecord.currency || "UGX",
                      onConfirm: (comment, extras) => {
                        void (async () => {
                          const result = await amendPayrollRun(id, {
                            comment,
                            amount: extras?.amount,
                            returnMode: "previous",
                          });
                          if (!result.ok) {
                            showWarning("Could not amend", result.error || "Amend failed.");
                            return;
                          }
                          const next =
                            result.record?.amendedReturnTo ||
                            result.record?.status ||
                            "the previous step";
                          showSuccess(
                            "Returned for amendment",
                            `${detailRecord.reference || "Payroll run"} sent back to ${next}.`,
                          );
                        })();
                      },
                    });
                  }}
                  onConfirmAdvance={(label, message, run, options) => {
                    askConfirm({
                      title: `${label}?`,
                      message,
                      confirmLabel: label,
                      danger: false,
                      commentLabel: options?.commentLabel,
                      commentPlaceholder: options?.commentPlaceholder,
                      amountLabel: options?.amountLabel,
                      amountValue: options?.amountValue,
                      amountCurrency: options?.amountCurrency,
                      onConfirm: (comment, extras) => {
                        void run({
                          comment,
                          amount: extras?.amount,
                        });
                      },
                    });
                  }}
                />
              ) : definition.key === "requisitions" ||
                definition.key === "general-requests" ||
                definition.key === "fuel-requests" ||
                definition.key === "trip-requests" ||
                definition.key === "maintenance-requests" ||
                definition.key === "equipment-and-vehicle-requests" ||
                definition.key === "document-requests" ||
                definition.key === "leave-requests" ? (
                <GenericRequisitionChainActions
                  entityKey={definition.key}
                  record={detailRecord}
                  onAdvance={async (id, options) => {
                    const result = await advanceGenericRequisition(definition.key, id, options);
                    if (!result.ok) {
                      showWarning("Could not advance", result.error || "Action failed.");
                      return;
                    }
                    if (result.amended) {
                      showSuccess(
                        "Returned for amendment",
                        `${detailRecord.reference || "Request"} sent back to ${
                          result.record?.amendedReturnTo || result.nextStatus || "previous user"
                        }.`,
                      );
                      return;
                    }
                    showSuccess(
                      /^(Paid|Issued|Follow-up Complete)$/i.test(result.nextStatus || "")
                        ? result.nextStatus || "Done"
                        : "Advanced",
                      `${detailRecord.reference || "Request"} → ${result.nextStatus}.`,
                    );
                  }}
                  onReject={(id) => {
                    const showAmount = entitySupportsApprovalAmount(definition.key);
                    askConfirm({
                      title: "Reject request?",
                      message: `Reject ${detailRecord.reference || "this request"}? This stops the approval chain and emails the parties involved.`,
                      confirmLabel: "Reject",
                      danger: true,
                      commentLabel: "Reason",
                      commentPlaceholder: "Reason for rejection (sent to requestor and executives)…",
                      commentRequired: true,
                      amountLabel: showAmount ? "Amount" : undefined,
                      amountValue: showAmount
                        ? detailRecord.amount ||
                          detailRecord.estimatedCost ||
                          detailRecord.total ||
                          ""
                        : undefined,
                      amountCurrency: detailRecord.currency || "UGX",
                      onConfirm: (comment, extras) => {
                        void (async () => {
                          const result = await rejectGenericRequisition(definition.key, id, {
                            comment,
                            amount: extras?.amount,
                          });
                          if (!result.ok) {
                            showWarning("Could not reject", result.error || "Reject failed.");
                            return;
                          }
                          showSuccess("Rejected", `${detailRecord.reference || "Request"} rejected.`);
                        })();
                      },
                    });
                  }}
                  onAmend={(id, mode) => {
                    const showAmount = entitySupportsApprovalAmount(definition.key);
                    const amountSeed =
                      detailRecord.amount ||
                      detailRecord.estimatedCost ||
                      detailRecord.total ||
                      "";
                    const original =
                      (detailRecord.originalAmount || amountSeed || "").trim() || "—";
                    askConfirm({
                      title: "Return for amendment?",
                      message: `Send ${detailRecord.reference || "this request"} one step back for amendment. Add a comment${
                        showAmount
                          ? ` (original ${detailRecord.currency || "UGX"} ${original})`
                          : ""
                      }.`,
                      confirmLabel: "Return for amendment",
                      danger: false,
                      commentLabel: "What should change",
                      commentPlaceholder: "Tell them what to change…",
                      commentRequired: true,
                      amountLabel: showAmount ? "Amended amount" : undefined,
                      amountValue: showAmount ? amountSeed : undefined,
                      amountCurrency: detailRecord.currency || "UGX",
                      onConfirm: (comment, extras) => {
                        void (async () => {
                          const result = await amendGenericRequisition(definition.key, id, {
                            comment,
                            amount: extras?.amount,
                            returnMode: "previous",
                          });
                          if (!result.ok) {
                            showWarning("Could not amend", result.error || "Amend failed.");
                            return;
                          }
                          const next =
                            result.record?.amendedReturnTo ||
                            result.record?.status ||
                            "the previous step";
                          showSuccess(
                            "Returned for amendment",
                            `${detailRecord.reference || "Request"} sent back to ${next}.`,
                          );
                        })();
                      },
                    });
                  }}
                  onConfirmAdvance={(label, message, run, options) => {
                    askConfirm({
                      title: `${label}?`,
                      message,
                      confirmLabel: label,
                      danger: false,
                      commentLabel: options?.commentLabel,
                      commentPlaceholder: options?.commentPlaceholder,
                      amountLabel: options?.amountLabel,
                      amountValue: options?.amountValue,
                      amountCurrency: options?.amountCurrency,
                      paymentMethodLabel: options?.paymentMethodLabel,
                      paymentMethodOptions: options?.paymentMethodLabel
                        ? REQUEST_PAYMENT_METHODS
                        : undefined,
                      paymentMethodValue: options?.paymentMethodValue,
                      paymentMethodRequired: Boolean(options?.paymentMethodLabel),
                      bankAccountLabel: options?.bankAccountLabel,
                      bankAccountValue: options?.bankAccountValue,
                      bankAccountRequired: Boolean(options?.bankAccountLabel),
                      onConfirm: (comment, extras) => {
                        void run({
                          comment,
                          amount: extras?.amount,
                          paymentMethod: extras?.paymentMethod,
                          bankAccount: extras?.bankAccount,
                        });
                      },
                    });
                  }}
                />
              ) : undefined
            }
            onRequestPayment={
              canRequestPaymentDetail
                ? () => {
                    askConfirm({
                      title: "Request payment from Finance?",
                      message: `Create a payment request for “${
                        detailRecord.reference || detailRecord.name || definition.singular
                      }” so Finance can approve and pay. Project and purchase documents feed the Payment requests monitor.`,
                      confirmLabel: "Request payment",
                      onConfirm: () => raisePaymentRequest(detailRecord),
                    });
                  }
                : undefined
            }
            payLabel={
              detailSide === "receivable"
                ? "Receive payment"
                : detailSide === "payable"
                  ? "Pay bill"
                  : "Pay"
            }
            onApprove={
              canApprove &&
              !REQUISITION_CHAIN_ENTITIES.has(definition.key) &&
              definition.key !== "requisitions" &&
              isPendingApprovalStatus(detailRecord.status)
                ? () => {
                    const sod = assertMakerChecker(
                      detailRecord.createdBy || detailRecord.user,
                    );
                    if (sod) {
                      showWarning("Approval blocked", sod);
                      return;
                    }
                    askConfirm({
                      title: "Approve document?",
                      message: `Set “${
                        detailRecord.reference || detailRecord.name || definition.singular
                      }” to Approved so it posts to the ledger and appears on reports.`,
                      confirmLabel: "Approve",
                      danger: false,
                      onConfirm: () => {
                        void commitUpdate(
                          detailRecord.id,
                          { status: "Approved" },
                          detailRecord,
                        );
                      },
                    });
                  }
                : undefined
            }
            onReceiveTransfer={
              canMutate &&
              definition.key === "inventory-transfers" &&
              transferAwaitingReceipt(detailRecord)
                ? () => {
                    const dest = (detailRecord.to || "").trim();
                    if (!dest) {
                      showWarning(
                        "Receive location required",
                        "Set “Receive into warehouse / location” before receiving this transfer.",
                      );
                      return;
                    }
                    askConfirm({
                      title: "Receive into warehouse?",
                      message: `Confirm receipt of ${detailRecord.quantity || "stock"} ${
                        detailRecord.item || "items"
                      } into “${dest}”?`,
                      confirmLabel: "Receive",
                      danger: false,
                      onConfirm: () => {
                        void commitUpdate(
                          detailRecord.id,
                          {
                            status: "Received",
                            receivedDate:
                              detailRecord.receivedDate ||
                              new Date().toISOString().slice(0, 10),
                            receivedBy: detailRecord.receivedBy || "",
                          },
                          detailRecord,
                        );
                      },
                    });
                  }
                : undefined
            }
            onFulfillFuel={
              canMutate &&
              definition.key === "fuel-requests" &&
              fuelRequestAwaitingFulfillment(detailRecord)
                ? () => {
                    askConfirm({
                      title: "Fulfill fuel request?",
                      message: "Create a posted fuel log and update the vehicle odometer.",
                      confirmLabel: "Fulfill",
                      danger: false,
                      onConfirm: () => {
                        void (async () => {
                          try {
                            const { log } = await fulfillFuelRequest({
                              requestId: detailRecord.id,
                            });
                            showSuccess("Fulfilled", `Fuel log ${log.reference || ""} created.`);
                          } catch (error) {
                            showWarning(
                              "Could not fulfill",
                              error instanceof Error ? error.message : "Fulfill failed.",
                            );
                          }
                        })();
                      },
                    });
                  }
                : undefined
            }
            onCompleteTrip={
              canMutate &&
              definition.key === "trip-requests" &&
              tripAwaitingCompletion(detailRecord)
                ? () => {
                    askConfirm({
                      title: "Complete trip?",
                      message: "Mark this trip complete and post related costs if configured.",
                      confirmLabel: "Complete",
                      danger: false,
                      onConfirm: () => {
                        void (async () => {
                          try {
                            await completeTripRequest({ requestId: detailRecord.id });
                            showSuccess("Completed", "Trip marked complete.");
                          } catch (error) {
                            showWarning(
                              "Could not complete",
                              error instanceof Error ? error.message : "Complete failed.",
                            );
                          }
                        })();
                      },
                    });
                  }
                : undefined
            }
            onCompleteMaintenance={
              canMutate &&
              definition.key === "maintenance-requests" &&
              maintenanceAwaitingCompletion(detailRecord)
                ? () => {
                    askConfirm({
                      title: "Complete maintenance?",
                      message: "Mark this maintenance request complete after Finance approval.",
                      confirmLabel: "Complete",
                      danger: false,
                      onConfirm: () => {
                        void (async () => {
                          try {
                            await completeMaintenanceRequest({
                              requestId: detailRecord.id,
                            });
                            showSuccess("Completed", "Maintenance marked complete.");
                          } catch (error) {
                            showWarning(
                              "Could not complete",
                              error instanceof Error ? error.message : "Complete failed.",
                            );
                          }
                        })();
                      },
                    });
                  }
                : undefined
            }
          />
        )
      ) : (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 shrink">
            <h2 className="text-[14px] font-semibold text-slate-800">{definition.label}</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {definition.key === "employees"
                ? "Full HR profile — personal ID, TIN/NSSF, bank, medical & life insurance, next of kin, contract docs"
                : definition.key === "contractors"
                  ? "Contractor directory — use the Contractor Invoices tab for bills"
                  : `Browse, search and manage ${definition.label.toLowerCase()} · ledger-linked`}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 lg:ml-4">
            <div className="relative">
              <SearchNormal1 size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400" color="currentColor" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${definition.label.toLowerCase()}`}
                className="h-8 w-[210px] pl-8 text-[12px]"
              />
            </div>
            {statusOptions.length > 0 && (
              <div className="relative">
                <Filter
                  size={12}
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
                  color="currentColor"
                />
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="h-8 appearance-none rounded-md border border-input bg-white py-0 pr-7 pl-7 text-[12px] text-slate-700 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  aria-label="Filter by status"
                >
                  <option value="all">All statuses</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {SCOPE_FILTERS.filter(({ field }) => scopeOptions[field]?.length).map(
              ({ field, label, all }) => (
                <select
                  key={field}
                  value={scopeFilter[field] ?? "all"}
                  onChange={(event) =>
                    setScopeFilter((prev) => ({ ...prev, [field]: event.target.value }))
                  }
                  className="h-8 rounded-md border border-input bg-white px-2.5 text-[12px] text-slate-700 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                  aria-label={`Filter by ${label}`}
                >
                  <option value="all">{all}</option>
                  {scopeOptions[field].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              ),
            )}
            {kindOptions.length > 0 && (
              <select
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value)}
                className="h-8 rounded-md border border-input bg-white px-2.5 text-[12px] text-slate-700 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                aria-label="Filter by kind"
              >
                <option value="all">All kinds</option>
                {kindOptions.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            )}
            {(definition.key === "receipts" || definition.key === "payments") && (
              <select
                value={allocationFilter}
                onChange={(event) => {
                  const next = event.target.value;
                  setAllocationFilter(next);
                  const params = new URLSearchParams(searchParams.toString());
                  if (next === "all") params.delete("allocation");
                  else params.set("allocation", next);
                  params.delete("edit");
                  params.delete("mode");
                  params.delete("open");
                  const qs = params.toString();
                  router.replace(qs ? `/${config.slug}?${qs}` : `/${config.slug}`);
                }}
                className="h-8 rounded-md border border-input bg-white px-2.5 text-[12px] text-slate-700 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                aria-label="Filter by allocation"
              >
                <option value="all">All allocations</option>
                <option value="uncategorized">Uncategorized</option>
                <option value="allocated">Allocated to invoice/bill</option>
                <option value="posted">Posted to account</option>
              </select>
            )}
            {(statusFilter !== "all" ||
              kindFilter !== "all" ||
              allocationFilter !== "all" ||
              query.trim()) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-[11px] text-slate-500"
                onClick={() => clearListFilters()}
              >
                Clear
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".csv,.tsv,.txt,.json,text/csv,text/tab-separated-values,application/json"
              className="hidden"
              onChange={(event) => {
                const files = event.target.files;
                if (files?.length) void importData(files);
                event.currentTarget.value = "";
              }}
            />
            {canUndo && (
              <Button
                variant="outline"
                size="sm"
                onClick={undo}
                title={nextLabel}
              >
                <Refresh size={13} color="currentColor" /> Undo
              </Button>
            )}
            {showCsvToolbar && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                title="Bulk upload CSV / TSV / JSON files for this list"
              >
                <DocumentUpload size={13} color="currentColor" /> Import CSV
              </Button>
            )}
            {showCsvToolbar && (
              <Button
                variant="outline"
                size="sm"
                onClick={downloadImportTemplate}
                title="Download a blank CSV template for this list"
              >
                <DocumentDownload size={13} color="currentColor" /> CSV template
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                <DocumentDownload size={13} color="currentColor" /> Export
                <ArrowDown2 size={12} color="currentColor" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void exportData("pdf")}>
                  <DocumentText size={14} color="currentColor" /> PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportData("excel")}>
                  <DocumentDownload size={14} color="currentColor" /> Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportData("csv")}>
                  <DocumentDownload size={14} color="currentColor" /> CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {selected.length > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const first = records.find((r) => r.id === selected[0]);
                    if (first) openDetail(first);
                  }}
                >
                  <Eye size={13} color="currentColor" /> View
                </Button>
                {definition.key === "requisitions" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      try {
                        for (const id of selected) {
                          const record = records.find((r) => r.id === id);
                          if (record) exportMaterialRequestCsv(record);
                        }
                        showSuccess(
                          "CSVs downloaded",
                          `${selected.length} material request CSV${selected.length === 1 ? "" : "s"} saved.`,
                        );
                      } catch (error) {
                        showWarning(
                          "CSV export failed",
                          error instanceof Error
                            ? error.message
                            : "Could not generate one or more CSVs.",
                        );
                      }
                    }}
                  >
                    <DocumentDownload size={13} color="currentColor" /> CSV ({selected.length})
                  </Button>
                )}
                {supportsDocumentPdf(definition.key) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void (async () => {
                        try {
                          const [{ exportDocumentPdf }, { exportPayslipPdf }] = await Promise.all([
                            import("@/lib/export/document-pdf"),
                            import("@/lib/export/statement-payslip"),
                          ]);
                          for (const id of selected) {
                            const record = records.find((r) => r.id === id);
                            if (!record) continue;
                            if (definition.key === "payslips") {
                              await exportPayslipPdf({
                                reference: record.reference,
                                employee: record.employee || record.party || record.name,
                                date: record.date,
                                basicPay: record.basicPay,
                                daysWorked: record.daysWorked,
                                adjustedBasic: record.adjustedBasic,
                                nssf: record.nssfEmployee || record.nssf,
                                paye: record.paye,
                                advances: record.advances,
                                arrears: record.arrears,
                                netPay: record.netPay || record.amount,
                                bankAccount: record.bankAccount,
                                accountNumber: record.accountNumber,
                                department: record.department,
                              });
                            } else {
                              await exportDocumentPdf(
                                definition.key,
                                definition.label,
                                record,
                              );
                            }
                          }
                          showSuccess(
                            "PDFs downloaded",
                            `${selected.length} document PDF${selected.length === 1 ? "" : "s"} saved.`,
                          );
                        } catch (error) {
                          showWarning(
                            "PDF export failed",
                            error instanceof Error
                              ? error.message
                              : "Could not generate one or more PDFs.",
                          );
                        }
                      })();
                    }}
                  >
                    <DocumentText size={13} color="currentColor" /> PDF ({selected.length})
                  </Button>
                )}
                {!historyReadOnly && canDelete && (
                  <Button variant="outline" size="sm" onClick={() => deleteRecords(selected)}>
                    <Trash size={13} color="currentColor" /> Delete ({selected.length})
                  </Button>
                )}
              </>
            )}
            {canPayroll &&
              (definition.key === "employees" || definition.key === "payslips") && (
                <Link
                  href="/payroll?view=create-payroll"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <People size={13} color="currentColor" /> Create payroll
                </Link>
              )}
            {canMutate && supportsSaveAsDraft(definition.key) && formDrafts.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                  Drafts ({formDrafts.length})
                  <ArrowDown2 size={12} color="currentColor" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-64">
                  {formDrafts.map((draft) => (
                    <DropdownMenuItem
                      key={draft.id}
                      className="flex flex-col items-start gap-0.5 py-2"
                      onClick={() => openFormDraft(draft)}
                    >
                      <span className="text-[12px] font-medium text-slate-800">
                        {draft.title || "Untitled draft"}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {draft.updatedAt
                          ? new Date(draft.updatedAt).toLocaleString()
                          : "Saved draft"}
                        {draft.sourceRecordId ? " · edit in progress" : " · new record"}
                      </span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-rose-600"
                    onClick={() => {
                      askConfirm({
                        title: "Delete all drafts?",
                        message: `Remove ${formDrafts.length} saved draft${formDrafts.length === 1 ? "" : "s"} for ${definition.label}? Live records are not affected.`,
                        confirmLabel: "Delete drafts",
                        danger: true,
                        onConfirm: () => {
                          void (async () => {
                            await Promise.all(formDrafts.map((d) => deleteFormDraft(d.id)));
                            await refreshFormDrafts();
                            showSuccess("Drafts cleared", "Saved drafts were removed.");
                          })();
                        },
                      });
                    }}
                  >
                    Clear all drafts
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canMutate && (
              <Button size="sm" className="bg-black hover:bg-zinc-800" onClick={() => setEditor({ mode: "create", record: null })}>
                <Add size={14} color="currentColor" />{" "}
                {definition.key === "chart-of-accounts" ? "New account / group" : `New ${definition.singular}`}
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] tracking-wide text-slate-400 uppercase">
                <th className="w-10 px-3 py-2.5">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={() =>
                      setSelected(
                        allSelected
                          ? selected.filter((id) => !pageItems.some((record) => record.id === id))
                          : Array.from(new Set([...selected, ...pageItems.map((record) => record.id)])),
                      )
                    }
                    aria-label="Select all records on this page"
                  />
                </th>
                {columns.map((field) => (
                  <th key={field.key} className="px-3 py-2.5 font-medium">
                    <button type="button" className="inline-flex items-center gap-1 hover:text-slate-700" onClick={() => toggleSort(field.key)}>
                      {field.label}
                      <ArrowDown2
                        size={11}
                        variant="Linear"
                        className={sort?.key === field.key && sort.direction === "asc" ? "rotate-180" : ""}
                        color="currentColor"
                      />
                    </button>
                  </th>
                ))}
                <th className="w-24 px-3 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!ready ? (
                <TableRowsSkeleton columns={columns.length} rows={7} />
              ) : visibleRecords.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 2} className="px-4 py-14 text-center">
                    <div className="mx-auto max-w-sm">
                      <DocumentText size={28} className="mx-auto text-slate-300" color="currentColor" />
                      <p className="mt-3 text-[13px] font-medium text-slate-700">
                        {query ||
                        statusFilter !== "all" ||
                        kindFilter !== "all" ||
                        allocationFilter !== "all"
                          ? "No matching records"
                          : `No ${definition.label.toLowerCase()} yet`}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {query ||
                        statusFilter !== "all" ||
                        kindFilter !== "all" ||
                        allocationFilter !== "all"
                          ? "Try clearing filters or searching a different term."
                          : `Create your first ${definition.singular.toLowerCase()} to get started.`}
                      </p>
                      {!query &&
                        statusFilter === "all" &&
                        kindFilter === "all" &&
                        allocationFilter === "all" &&
                        (canMutate || showCsvToolbar) && (
                        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                          {canMutate ? (
                          <Button
                            type="button"
                            size="sm"
                            className="bg-black hover:bg-zinc-800"
                            onClick={() => setEditor({ mode: "create", record: null })}
                          >
                            <Add size={14} color="currentColor" /> Create the first record
                          </Button>
                          ) : null}
                          {showCsvToolbar ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => fileRef.current?.click()}
                            >
                              <DocumentUpload size={14} color="currentColor" /> Import CSV
                            </Button>
                          ) : null}
                        </div>
                      )}
                      {(query ||
                        statusFilter !== "all" ||
                        kindFilter !== "all" ||
                        allocationFilter !== "all") && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-4"
                          onClick={() => clearListFilters()}
                        >
                          Clear filters
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                pageItems.map((record) => (
                  <tr
                    key={record.id}
                    className={`h-11 border-b border-slate-50 last:border-0 hover:bg-slate-50/70 data-[selected=true]:bg-slate-50/80${
                      definition.key === "chart-of-accounts" &&
                      /^(inactive|obsolete|archived|disabled|hidden)$/i.test(record.status || "")
                        ? " opacity-50"
                        : ""
                    }`}
                    data-selected={selected.includes(record.id) || undefined}
                  >
                    <td className="px-3">
                      <Checkbox
                        checked={selected.includes(record.id)}
                        onCheckedChange={() =>
                          setSelected((current) =>
                            current.includes(record.id)
                              ? current.filter((id) => id !== record.id)
                              : [...current, record.id],
                          )
                        }
                        aria-label={`Select ${record.id}`}
                      />
                    </td>
                    {columns.map((field, index) => {
                      const value = record[field.key] ?? "";
                      const isCoa = definition.key === "chart-of-accounts";
                      const depth = isCoa ? coaDisplayDepth(displayRecords, record) : 0;
                      const groupRow = isCoa && isCoaGroup(record);
                      if (field.key === "name" && isCoa) {
                        return (
                          <td
                            key={field.key}
                            className={
                              groupRow
                                ? "px-3 font-semibold text-slate-900"
                                : "px-3 font-medium text-slate-800"
                            }
                          >
                            <span style={{ paddingLeft: `${depth * 14}px` }} className="inline-flex items-center gap-2">
                              {groupRow && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                  Group
                                </span>
                              )}
                              {formatFieldValue(field, value, record)}
                              {groupRow && record.parentGroup ? (
                                <span className="text-[11px] font-normal text-slate-400">
                                  ⊂ {record.parentGroup}
                                </span>
                              ) : null}
                            </span>
                          </td>
                        );
                      }
                      if (field.key === "kind" && isCoa) {
                        return (
                          <td key={field.key} className="px-3 text-slate-600">
                            {isCoaGroup(record) ? "Group" : "Account"}
                          </td>
                        );
                      }
                      if (field.key === "parentGroup" && isCoa && !isCoaGroup(record)) {
                        return (
                          <td key={field.key} className="px-3 text-slate-600">
                            —
                          </td>
                        );
                      }
                      if (field.key === "allocation") {
                        const uncategorized = /^uncategorized$/i.test(value.trim());
                        const applied = (record.appliedTo || "").trim();
                        const firstApplied = applied.split(/[;,]/)[0]?.split(":")[0]?.trim() || applied;
                        const canLinkApplied =
                          !uncategorized &&
                          firstApplied &&
                          (definition.key === "receipts" || definition.key === "payments");
                        if (canLinkApplied) {
                          const isReceipt = definition.key === "receipts";
                          return (
                            <td key={field.key} className="px-3">
                              <Link
                                href={hrefForSourceDocument(
                                  isReceipt ? "sales" : "purchases",
                                  isReceipt ? "sales-invoices" : "purchase-invoices",
                                  firstApplied,
                                )}
                                className="text-sky-700 underline-offset-2 hover:underline"
                                title={`Open ${isReceipt ? "invoice" : "bill"} ${firstApplied}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {value}
                              </Link>
                            </td>
                          );
                        }
                        if (uncategorized && canEdit) {
                          return (
                            <td key={field.key} className="px-3">
                              <button
                                type="button"
                                className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 underline-offset-2 hover:bg-amber-100 hover:underline"
                                title="Categorize — assign posting account"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditor({ mode: "edit", record });
                                }}
                              >
                                Categorize
                              </button>
                            </td>
                          );
                        }
                        return (
                          <td key={field.key} className="px-3">
                            <span className="text-slate-600">{value || "—"}</span>
                          </td>
                        );
                      }
                      if (definition.key === "bank-and-cash-accounts") {
                        const accountName = (record.name || record.account || "").trim();
                        const accountQ = encodeURIComponent(accountName);
                        if (field.key === "balance" || field.key === "closingBalance") {
                          return (
                            <td key={field.key} className="px-3 text-right">
                              <Link
                                href={`/banking?view=bank-and-cash-accounts&activity=${accountQ}`}
                                className="tabular-nums font-medium text-slate-800 underline-offset-2 hover:text-sky-700 hover:underline"
                                title={`View all transactions for ${accountName}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {formatFieldValue(field, value, record)}
                              </Link>
                            </td>
                          );
                        }
                        if (
                          field.key === "uncategorizedPayments" ||
                          field.key === "uncategorizedReceipts"
                        ) {
                          const empty = !value || value === "—";
                          if (empty) {
                            return (
                              <td key={field.key} className="px-3 text-slate-400">
                                —
                              </td>
                            );
                          }
                          const side =
                            field.key === "uncategorizedPayments" ? "payments" : "receipts";
                          const categorizeHref = `/receipts-payments?view=${side}&account=${accountQ}&allocation=uncategorized&edit=1`;
                          return (
                            <td key={field.key} className="px-3 text-right">
                              <Link
                                href={categorizeHref}
                                className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 underline-offset-2 hover:bg-amber-100 hover:underline"
                                title={`Click to categorize uncategorized ${side} for ${accountName}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {value}
                              </Link>
                            </td>
                          );
                        }
                      }
                      if (
                        field.key === "balance" &&
                        value &&
                        (definition.key === "customers" ||
                          definition.key === "suppliers" ||
                          definition.key === "bank-and-cash-accounts") &&
                        (record.currency || record.currencyCode)
                      ) {
                        const partyCur = normalizeCurrency(record.currency || record.currencyCode);
                        const baseAmt = parseAmount(value);
                        if (!isBaseCurrency(partyCur) && baseAmt) {
                          return (
                            <td key={field.key} className="px-3">
                              <DualMoney
                                amount={baseAmt}
                                currency={partyCur}
                                amountIsBase
                                compact
                                align="right"
                              />
                            </td>
                          );
                        }
                      }
                      if (
                        (field.key === "openingBalance" || field.key === "closingBalance") &&
                        value &&
                        definition.key === "bank-and-cash-accounts" &&
                        (record.currency || record.currencyCode)
                      ) {
                        const bankCur = normalizeCurrency(record.currency || record.currencyCode);
                        if (!isBaseCurrency(bankCur)) {
                          return (
                            <td key={field.key} className="px-3">
                              <DualMoney
                                amount={parseAmount(value)}
                                currency={bankCur}
                                amountIsBase={field.key === "closingBalance"}
                                compact
                                align="right"
                              />
                            </td>
                          );
                        }
                      }
                      if (
                        (field.key === "amount" || field.key === "total") &&
                        value &&
                        (record.currency || record.currencyCode)
                      ) {
                        return (
                          <td
                            key={field.key}
                            className={index === 0 ? "px-3 font-medium text-slate-800" : "px-3"}
                          >
                            <DualMoney
                              amount={parseAmount(value)}
                              currency={record.currency || record.currencyCode}
                              asOf={record.date || record.issueDate}
                              compact
                              align="right"
                            />
                          </td>
                        );
                      }
                      return (
                        <td key={field.key} className={index === 0 ? "px-3 font-medium text-slate-800" : "px-3 text-slate-600"}>
                          {field.key === "status" && value ? (
                            definition.key === "chart-of-accounts" ? (
                              <span
                                className={
                                  /^(inactive|obsolete|archived|disabled|hidden)$/i.test(value)
                                    ? "rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500"
                                    : "rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700"
                                }
                              >
                                {/^(inactive|obsolete|archived|disabled|hidden)$/i.test(value)
                                  ? "Disabled"
                                  : "Active"}
                              </span>
                            ) : (
                              displayStatus(value)
                            )
                          ) : field.key === "name" ||
                            field.key === "reference" ||
                            (index === 0 && field.key !== "status") ? (
                            <button
                              type="button"
                              className="text-left font-medium text-slate-900 hover:text-sky-700 hover:underline"
                              onClick={() => openDetail(record)}
                            >
                              {formatFieldValue(field, value, record) || "—"}
                            </button>
                          ) : (
                            formatFieldValue(field, value, record)
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1 px-2 text-[11px] text-slate-600"
                              aria-label="Row actions"
                            />
                          }
                        >
                          Actions
                          <ArrowDown2 size={11} color="currentColor" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuItem onClick={() => openDetail(record)}>
                            <Eye size={14} variant="Linear" color="currentColor" />
                            View
                          </DropdownMenuItem>
                          {definition.key === "bank-and-cash-accounts" ? (
                            <DropdownMenuItem
                              onClick={() => {
                                const accountName = (record.name || record.account || "").trim();
                                if (!accountName) return;
                                router.push(
                                  `/banking?view=bank-and-cash-accounts&activity=${encodeURIComponent(accountName)}`,
                                );
                              }}
                            >
                              <DocumentText size={14} variant="Linear" color="currentColor" />
                              Generate bank ledger
                            </DropdownMenuItem>
                          ) : null}
                          {definition.key === "contractors" ? (
                            <DropdownMenuItem
                              onClick={() => {
                                const party = contractorInvoicePartyName(record);
                                const href = party
                                  ? `/projects?view=contractor-invoices&party=${encodeURIComponent(party)}`
                                  : "/projects?view=contractor-invoices";
                                router.push(href);
                              }}
                            >
                              <DocumentText size={14} variant="Linear" color="currentColor" />
                              Invoices
                            </DropdownMenuItem>
                          ) : null}
                          {/*
                            Verbs the owning service exposes on this record.
                            Placed above Edit because on this tab the verb is
                            usually the point — a run's stage moves through
                            /advance and /complete and a downtime event closes
                            through /:id/end, none of which is a field on the
                            record, so a roast that is never completed is a
                            roast the app can start and not finish.
                          */}
                          {!historyReadOnly &&
                            canMutate &&
                            actionsForRecord(record).map((action) => {
                              const busy = runningAction === `${record.id}:${action.id}`;
                              return (
                                <DropdownMenuItem
                                  key={action.id}
                                  disabled={Boolean(runningAction)}
                                  // Base UI's MenuItem fires `onClick`. `onSelect`
                                  // is accepted — it is a DOM event on the div
                                  // underneath — and never fires, which would
                                  // make these menu items do nothing at all.
                                  onClick={() => {
                                    askConfirm({
                                      title: `${action.label} this ${definition.singular.toLowerCase()}?`,
                                      message: `“${
                                        record.reference || record.name || definition.singular
                                      }” will be sent to the service. This commits the record and cannot be undone from here.`,
                                      confirmLabel: action.label,
                                      onConfirm: () => {
                                        void runUpstreamAction(record, action);
                                      },
                                    });
                                  }}
                                >
                                  <TickCircle size={14} variant="Linear" color="currentColor" />
                                  {busy ? `${action.label}…` : action.label}
                                </DropdownMenuItem>
                              );
                            })}
                          {!historyReadOnly && (canEdit || canDelete || canMutate) && (
                            <>
                              {canEditRecord(record) && (
                              <DropdownMenuItem
                                onClick={() => setEditor({ mode: "edit", record })}
                              >
                                <Edit2 size={14} variant="Linear" color="currentColor" />
                                Edit
                              </DropdownMenuItem>
                              )}
                              {canMutate && definition.key === "chart-of-accounts" &&
                                !isCoaGroup(record) && (
                                  <DropdownMenuItem
                                    onClick={() => toggleCoaInactive(record)}
                                  >
                                    {/^(inactive|obsolete|archived|disabled|hidden)$/i.test(
                                      record.status || "",
                                    ) ? (
                                      <>
                                        <TickCircle
                                          size={14}
                                          variant="Linear"
                                          color="currentColor"
                                        />
                                        Activate (enable in use)
                                      </>
                                    ) : (
                                      <>
                                        <CloseCircle
                                          size={14}
                                          variant="Linear"
                                          color="currentColor"
                                        />
                                        Disable (not in use)
                                      </>
                                    )}
                                  </DropdownMenuItem>
                                )}
                              {canMutate && (() => {
                                const side = invoicePaymentSide(definition.key);
                                if (!side) return null;
                                if (/draft|void|voided|cancelled|canceled|paid/i.test(record.status || "")) {
                                  return null;
                                }
                                if (rowOpenBalance(record) <= 0) return null;
                                const isReceivable = side === "receivable";
                                return (
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setEditor(null);
                                      setPayTarget(record);
                                    }}
                                  >
                                    <TickCircle
                                      size={14}
                                      variant="Linear"
                                      color="currentColor"
                                    />
                                    {isReceivable ? "Receive payment" : "Pay bill"}
                                  </DropdownMenuItem>
                                );
                              })()}
                              {canMutate &&
                                canRaisePaymentRequest(definition.key) &&
                                !/draft|void|voided|cancelled|canceled|paid/i.test(
                                  record.status || "",
                                ) && (
                                  <DropdownMenuItem
                                    onClick={() => {
                                      askConfirm({
                                        title: "Request payment from Finance?",
                                        message: `Send “${
                                          record.reference || record.name || definition.singular
                                        }” to the Finance payment-request queue for approval.`,
                                        confirmLabel: "Request payment",
                                        onConfirm: () => raisePaymentRequest(record),
                                      });
                                    }}
                                  >
                                    <MoneySend
                                      size={14}
                                      variant="Linear"
                                      color="currentColor"
                                    />
                                    Request payment (Finance)
                                  </DropdownMenuItem>
                                )}
                              {canDelete && (
                                <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => deleteRecords([record.id])}
                              >
                                <Trash size={14} variant="Linear" color="currentColor" />
                                Delete
                              </DropdownMenuItem>
                                </>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar
          page={page}
          pages={pages}
          total={pageTotal}
          from={pageFrom}
          to={pageTo}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
      )}

      <RecordEditor
        key={`${definition.key}-${editor?.mode ?? "closed"}-${editor?.record?.id ?? "new"}-${editor?.draftId ?? ""}`}
        definition={definition}
        state={editor}
        moduleSlug={storeSlug}
        onClose={() => setEditor(null)}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onSaveDraft={handleSaveDraft}
        onEdit={
          canEdit
            ? (record) => {
                if (!canEditRecord(record)) {
                  showWarning(
                    "Edit locked",
                    "Only the requestor (or an administrator) can edit this while it is Draft or Returned for Amendment.",
                  );
                  return;
                }
                setEditor({ mode: "edit", record });
              }
            : undefined
        }
        onPay={
          canMutate
            ? (record) => {
                setEditor(null);
                setPayTarget(record);
              }
            : undefined
        }
        onApprove={
          canApprove &&
          !REQUISITION_CHAIN_ENTITIES.has(definition.key) &&
          definition.key !== "requisitions"
            ? (record) => {
                const sod = assertMakerChecker(record.createdBy || record.user);
                if (sod) {
                  showWarning("Approval blocked", sod);
                  return;
                }
                setEditor(null);
                askConfirm({
                  title: "Approve document?",
                  message: `Set “${
                    record.reference || record.name || definition.singular
                  }” to Approved so it posts to the ledger and appears on reports.`,
                  confirmLabel: "Approve",
                  danger: false,
                  onConfirm: () => {
                    void commitUpdate(record.id, { status: "Approved" }, record);
                  },
                  onCancel: () => setEditor({ mode: "view", record }),
                });
              }
            : undefined
        }
        onReceiveTransfer={
          canMutate && definition.key === "inventory-transfers"
            ? (record) => {
                const dest = (record.to || "").trim();
                if (!dest) {
                  showWarning(
                    "Receive location required",
                    "Set “Receive into warehouse / location” before receiving this transfer.",
                  );
                  return;
                }
                setEditor(null);
                askConfirm({
                  title: "Receive into warehouse?",
                  message: `Confirm receipt of ${record.quantity || "stock"} ${
                    record.item || "items"
                  } into “${dest}”? Stock will leave Goods in transit and land at that location.`,
                  confirmLabel: "Receive",
                  danger: false,
                  onConfirm: () => {
                    void commitUpdate(
                      record.id,
                      {
                        status: "Received",
                        receivedDate:
                          record.receivedDate || new Date().toISOString().slice(0, 10),
                        receivedBy: record.receivedBy || "",
                      },
                      record,
                    );
                  },
                  onCancel: () => setEditor({ mode: "view", record }),
                });
              }
            : undefined
        }
        onFulfillFuel={
          canMutate && definition.key === "fuel-requests"
            ? (record) => {
                setEditor(null);
                askConfirm({
                  title: "Fulfill fuel request?",
                  message: `Create a posted fuel log for ${record.litres || "?"} L / ${
                    record.amount || "?"
                  } on “${record.vehicle || "vehicle"}” and mark this request Fulfilled.`,
                  confirmLabel: "Fulfill",
                  danger: false,
                  onConfirm: () => {
                    void (async () => {
                      try {
                        const { log } = await fulfillFuelRequest({ requestId: record.id });
                        showSuccess(
                          "Fuel request fulfilled",
                          `${log.reference} posted to Fuel Expense.`,
                        );
                        window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
                      } catch (err) {
                        setEditor({ mode: "view", record });
                        showWarning(
                          "Cannot fulfill",
                          err instanceof Error ? err.message : "Unknown error",
                        );
                      }
                    })();
                  },
                  onCancel: () => setEditor({ mode: "view", record }),
                });
              }
            : undefined
        }
        onCompleteTrip={
          canMutate && definition.key === "trip-requests"
            ? (record) => {
                setEditor(null);
                askConfirm({
                  title: "Complete trip?",
                  message: `Mark “${record.reference || "trip"}” completed${
                    record.odometerEnd
                      ? ` and update vehicle odometer to ${record.odometerEnd} km`
                      : ""
                  }.`,
                  confirmLabel: "Complete",
                  danger: false,
                  onConfirm: () => {
                    void (async () => {
                      try {
                        await completeTripRequest({ requestId: record.id });
                        showSuccess(
                          "Trip completed",
                          record.reference || definition.singular,
                        );
                        window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
                      } catch (err) {
                        setEditor({ mode: "view", record });
                        showWarning(
                          "Cannot complete trip",
                          err instanceof Error ? err.message : "Unknown error",
                        );
                      }
                    })();
                  },
                  onCancel: () => setEditor({ mode: "view", record }),
                });
              }
            : undefined
        }
        siblingRecords={records}
      />

      {payTarget &&
        (() => {
          const side = invoicePaymentSide(definition.key);
          if (!side) return null;
          const party =
            payTarget.party ||
            payTarget.customer ||
            payTarget.supplier ||
            "";
          if (!party.trim()) {
            return null;
          }
          const docs = partyOpenDocuments(side, party);
          const focus = docs.find((doc) => doc.id === payTarget.id) ?? null;
          if (!focus && docs.length === 0) {
            return (
              <Dialog open onOpenChange={(next) => !next && setPayTarget(null)}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>No open balance</DialogTitle>
                    <DialogDescription>
                      {payTarget.reference || "This document"} has no payable
                      balance. Set status to Active (not Draft) if you just
                      entered it.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setPayTarget(null)}>
                      Close
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            );
          }
          return (
            <InvoicePaymentDialog
              side={side}
              party={party}
              docs={docs}
              focus={focus}
              onClose={() => setPayTarget(null)}
              onDone={(message) => {
                setPayTarget(null);
                setLedgerTick((t) => t + 1);
                showSuccess(
                  side === "receivable" ? "Payment received" : "Payment made",
                  message,
                );
              }}
              onError={(message) => showWarning("Could not record payment", message)}
            />
          );
        })()}

    </>
  );
}

