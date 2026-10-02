"use client";

import { DocumentExportActions } from "@/components/document-export-actions";
import { DualMoney } from "@/components/dual-money";
import { RecordAttachmentsView } from "@/components/record-attachments-field";
import { Button } from "@/components/ui/button";
import { FeedbackModals, useFeedbackModals } from "@/components/feedback-modals";
import {
  formatFieldValue,
  type EntityDefinition,
  type ManagerRecord,
} from "@/lib/manager-entities";
import {
  DELETED_RECORD_META_KEYS,
  humanizeFieldKey,
} from "@/lib/deleted-records";
import { formatMoney } from "@/lib/ledger/money";
import { isBaseCurrency, normalizeCurrency } from "@/lib/ledger/fx";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { currencySelectOptions } from "@/lib/manager-settings";
import {
  ArrowLeft2,
  Edit2,
  TickCircle,
} from "iconsax-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

function displayStatus(value: string) {
  const v = (value || "—").trim();
  const tone = /active|paid|approved|complete|posted|reconciled|received|fulfilled/i.test(v)
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : /draft|pending|submitted|in transit/i.test(v)
    ? "bg-amber-50 text-amber-800 ring-amber-200"
      : /void|inactive|cancelled|canceled|rejected|deleted/i.test(v)
        ? "bg-rose-50 text-rose-700 ring-rose-200"
        : "bg-slate-100 text-slate-700 ring-slate-200";
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone}`}>
      {v}
    </span>
  );
}

function inventoryStockLevels(record: ManagerRecord) {
  const closing = parseAmount(record.quantity || record.closingStock || "0");
  const opening = parseAmount(record.openingStock || "0");
  return { opening, closing };
}

function ageFromDateOfBirth(value: string): number | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const today = new Date();
  let age = today.getFullYear() - year;
  const birthdayPending =
    today.getMonth() + 1 < month ||
    (today.getMonth() + 1 === month && today.getDate() < day);
  if (birthdayPending) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

const EMPLOYEE_DETAIL_SECTIONS = [
  {
    label: "Personal information",
    keys: new Set([
      "name",
      "code",
      "gender",
      "dateOfBirth",
      "age",
      "nationality",
      "biodata",
      "nationalId",
      "tin",
      "nssfNumber",
    ]),
  },
  {
    label: "Contact & next of kin",
    keys: new Set([
      "phone",
      "email",
      "address",
      "city",
      "emergencyContact",
      "emergencyPhone",
      "nextOfKin",
      "nextOfKinRelation",
    ]),
  },
  {
    label: "Employment",
    keys: new Set([
      "department",
      "jobTitle",
      "manager",
      "workLocation",
      "hireDate",
      "probationEnd",
      "contractEnd",
      "contractType",
      "terminationDate",
      "status",
    ]),
  },
  {
    label: "Pay, bank & leave",
    keys: new Set([
      "bankAccount",
      "bankCode",
      "accountNumber",
      "basicPay",
      "housingAllowance",
      "transportAllowance",
      "otherAllowances",
      "leaveBalance",
      "currency",
      "residentStatus",
      "balance",
    ]),
  },
  {
    label: "Insurance",
    keys: new Set([
      "medicalInsurer",
      "medicalPolicy",
      "medicalExpiry",
      "lifeInsurer",
      "lifePolicy",
      "lifeExpiry",
      "insuranceNotes",
    ]),
  },
  {
    label: "Documents & HR notes",
    keys: new Set(["attachments", "notes"]),
  },
] as const;

function employeeDetailSection(key: string) {
  return (
    EMPLOYEE_DETAIL_SECTIONS.findIndex((section) => section.keys.has(key)) + 1
  );
}

function buildDetailRows(definition: EntityDefinition, record: ManagerRecord) {
  const alwaysShowEmpty =
    definition.key === "fixed-assets" ||
    definition.key === "intangible-assets";
  const rows = definition.fields
    .filter((field) => {
      if (field.key === "balance" || field.key === "snapshot") return false;
      // Material request lines render in a dedicated table below.
      if (
        definition.key === "requisitions" &&
        (field.key === "description" || field.key === "quantity" || field.key === "unit")
      ) {
        return false;
      }
      return true;
    })
    .map((field) => {
      const raw = (record[field.key] ?? "").trim();
      let value = formatFieldValue(field, record[field.key] ?? "", record);
      if ((field.key === "currency" || field.key === "currencyCode") && raw) {
        const match = currencySelectOptions().find(
          (o) => o.code === raw.toUpperCase() || o.value === raw.toUpperCase(),
        );
        if (match) value = match.label;
      }
      if (definition.key === "fixed-assets" && field.key === "bookValue" && !raw) {
        const cost = parseAmount(
          record.totalAcquisitionCost || record.cost || record.amount || "0",
        );
        const accum = parseAmount(record.accumulatedDepreciation || "0");
        const book = roundMoney(Math.max(0, cost - accum));
        if (book || cost) {
          value = formatMoney(book);
          return {
            key: field.key,
            label: field.label,
            value,
            raw: String(book),
            wide: false,
          };
        }
      }
      if (definition.key === "inventory-items" && field.key === "openingStock") {
        value = String(inventoryStockLevels(record).opening);
      }
      if (definition.key === "inventory-items" && field.key === "unitValue") {
        const unit =
          record.unitValue ||
          record.purchasePrice ||
          record.unitCost ||
          record.averageCost ||
          "";
        value = unit ? formatMoney(parseAmount(unit)) : "";
      }
      if (definition.key === "inventory-items" && field.key === "stockValue") {
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
      if (definition.key === "inventory-items" && field.key === "closingStock") {
        value = String(inventoryStockLevels(record).closing);
      }
      if (definition.key === "inventory-items" && field.key === "closingValue") {
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
        label: field.label,
        value,
        raw:
          definition.key === "inventory-items" &&
          (field.key === "openingStock" ||
            field.key === "unitValue" ||
            field.key === "stockValue" ||
            field.key === "closingStock" ||
            field.key === "closingValue")
            ? "1"
            : raw,
        wide:
          field.key === "description" ||
          field.key === "address" ||
          field.key === "narration" ||
          field.key === "notes" ||
          field.key === "evidenceNotes" ||
          field.key === "attachments" ||
          field.key === "acceptance" ||
          field.key === "category" ||
          field.type === "textarea",
      };
    })
    .filter(
      (row) =>
        alwaysShowEmpty ||
        row.raw ||
        ["status", "currency", "type", "kind"].includes(row.key),
    );

  if (definition.key === "employees") {
    const age = ageFromDateOfBirth(record.dateOfBirth || "");
    if (age !== null) {
      const birthDateIndex = rows.findIndex((row) => row.key === "dateOfBirth");
      rows.splice(birthDateIndex >= 0 ? birthDateIndex + 1 : 0, 0, {
        key: "age",
        label: "Age",
        value: `${age} years`,
        raw: String(age),
        wide: false,
      });
    }
  }

  // Deleted Records store source fields as normal columns — append any extras.
  if (definition.key === "deleted-records") {
    const shown = new Set(rows.map((row) => row.key));
    for (const [key, value] of Object.entries(record)) {
      if (DELETED_RECORD_META_KEYS.has(key) || shown.has(key)) continue;
      if (key === "snapshot") continue;
      const raw = String(value ?? "").trim();
      if (!raw) continue;
      // Skip nested JSON leftovers from older rows.
      if (raw.startsWith("{") || raw.startsWith("[")) continue;
      rows.push({
        key,
        label: humanizeFieldKey(key),
        value: raw,
        raw,
        wide: raw.length > 80 || /description|notes|address|narration/i.test(key),
      });
      shown.add(key);
    }
  }

  return rows;
}

export function RecordDetailPage({
  definition,
  record,
  backHref,
  onEdit,
  onPay,
  onApprove,
  onReceiveTransfer,
  onFulfillFuel,
  onCompleteTrip,
  onCompleteMaintenance,
  onRequestPayment,
  payLabel,
  extraActions,
  extraContent,
}: {
  definition: EntityDefinition;
  record: ManagerRecord;
  backHref: string;
  onEdit?: () => void;
  onPay?: () => void;
  onApprove?: () => void;
  onReceiveTransfer?: () => void;
  onFulfillFuel?: () => void;
  onCompleteTrip?: () => void;
  onCompleteMaintenance?: () => void;
  onRequestPayment?: () => void;
  payLabel?: string;
  extraActions?: ReactNode;
  /** Extra sections below the record details (e.g. contractor invoices). */
  extraContent?: ReactNode;
}) {
  const { feedback, close, showSuccess, showWarning } = useFeedbackModals();
  const title =
    record.name ||
    record.reference ||
    record.code ||
    definition.singular;
  const rows = buildDetailRows(definition, record);
  const displayRows =
    definition.key === "employees"
      ? [...rows].sort(
          (left, right) =>
            employeeDetailSection(left.key) - employeeDetailSection(right.key),
        )
      : rows;
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
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <FeedbackModals feedback={feedback} onClose={close} />
      <Link
        href={backHref}
        className="sticky top-14 z-10 inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-[13px] font-medium text-white shadow-sm transition hover:bg-slate-800 sm:top-0"
      >
        <ArrowLeft2 size={16} color="currentColor" />
        Back to {definition.label}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">{title}</h2>
            {record.status ? displayStatus(record.status) : null}
          </div>
          <p className="text-[13px] text-slate-500">
            {definition.singular} detail · ID {record.id.slice(0, 8)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DocumentExportActions
            entityKey={definition.key}
            entityLabel={definition.label}
            record={record}
            onInfo={showSuccess}
            onError={showWarning}
          />
          {extraActions}
          {onApprove ? (
            <Button
              type="button"
              className="h-9 bg-amber-600 text-white hover:bg-amber-700"
              onClick={onApprove}
            >
              <TickCircle size={14} color="currentColor" />
              Approve
            </Button>
          ) : null}
          {onReceiveTransfer ? (
            <Button
              type="button"
              className="h-9 bg-sky-700 text-white hover:bg-sky-800"
              onClick={onReceiveTransfer}
            >
              Receive into warehouse
            </Button>
          ) : null}
          {onFulfillFuel ? (
            <Button
              type="button"
              className="h-9 bg-emerald-700 text-white hover:bg-emerald-800"
              onClick={onFulfillFuel}
            >
              Fulfill → fuel log
            </Button>
          ) : null}
          {onCompleteTrip ? (
            <Button
              type="button"
              className="h-9 bg-sky-700 text-white hover:bg-sky-800"
              onClick={onCompleteTrip}
            >
              Complete trip
            </Button>
          ) : null}
          {onCompleteMaintenance ? (
            <Button
              type="button"
              className="h-9 bg-sky-700 text-white hover:bg-sky-800"
              onClick={onCompleteMaintenance}
            >
              Complete maintenance
            </Button>
          ) : null}
          {onRequestPayment ? (
            <Button
              type="button"
              variant="outline"
              className="h-9 border-amber-200 text-amber-800 hover:bg-amber-50"
              onClick={onRequestPayment}
            >
              <TickCircle size={14} color="currentColor" />
              Request payment (Finance)
            </Button>
          ) : null}
          {onPay ? (
            <Button
              type="button"
              className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={onPay}
            >
              {payLabel || "Pay"}
            </Button>
          ) : null}
          {onEdit ? (
            <Button
              type="button"
              className="h-9 bg-black text-white hover:bg-zinc-800"
              onClick={onEdit}
            >
              <Edit2 size={14} color="currentColor" />
              Edit
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-400 uppercase">
            {definition.key === "employees" ? "Employee profile" : "Record details"}
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 px-5 py-5 sm:grid-cols-2 lg:grid-cols-3">
          {displayRows.map((row, index) => {
            const sectionIndex =
              definition.key === "employees"
                ? employeeDetailSection(row.key)
                : 0;
            const previousSectionIndex =
              definition.key === "employees" && index > 0
                ? employeeDetailSection(displayRows[index - 1].key)
                : 0;
            return (
              <Fragment key={row.key}>
                {sectionIndex > 0 && sectionIndex !== previousSectionIndex ? (
                  <div className="border-b border-slate-100 pb-2 sm:col-span-2 lg:col-span-3">
                    <dt className="text-[12px] font-semibold text-slate-700">
                      {EMPLOYEE_DETAIL_SECTIONS[sectionIndex - 1].label}
                    </dt>
                  </div>
                ) : null}
                <div className={row.wide ? "sm:col-span-2 lg:col-span-3" : undefined}>
                  <dt className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                    {row.label}
                  </dt>
                  <dd className="mt-1.5 text-[14px] font-medium break-words text-slate-800">
                    {row.key === "status" ? (
                      displayStatus(row.raw || "—")
                    ) : row.key === "attachments" ? (
                      <RecordAttachmentsView raw={row.raw} />
                    ) : row.key === "email" && row.raw ? (
                      <a href={`mailto:${row.raw}`} className="text-sky-700 hover:underline">
                        {row.value}
                      </a>
                    ) : (
                      row.value || "—"
                    )}
                  </dd>
                </div>
              </Fragment>
            );
          })}
          {liveBalance !== undefined && liveBalance !== "" ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                Current balance
              </dt>
              <dd className="mt-1.5">
                {showDualBalance ? (
                  <DualMoney amount={balanceBase} currency={partyCurrency} amountIsBase />
                ) : (
                  <p className="text-[18px] font-semibold tabular-nums text-slate-900">
                    {formatMoney(balanceBase)}
                  </p>
                )}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 bg-slate-50/80 px-5 py-3 text-[11px] text-slate-500">
          <span>Created {new Date(record.createdAt).toLocaleString()}</span>
          <span className="text-slate-300">·</span>
          <span>Updated {new Date(record.updatedAt).toLocaleString()}</span>
        </div>
      </div>

      {extraContent}
    </div>
  );
}

export function RecordDetailMissing({
  definition,
  backHref,
}: {
  definition: EntityDefinition;
  backHref: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
      <p className="text-[14px] font-medium text-slate-800">Record not found</p>
      <p className="mt-1 text-[13px] text-slate-500">
        This {definition.singular.toLowerCase()} may have been deleted or is not on this device yet.
      </p>
      <Link
        href={backHref}
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-[13px] font-medium text-white shadow-sm hover:bg-slate-800"
      >
        <ArrowLeft2 size={16} color="currentColor" />
        Back to {definition.label}
      </Link>
    </div>
  );
}
