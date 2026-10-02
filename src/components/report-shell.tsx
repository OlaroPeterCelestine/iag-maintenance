"use client";

import { PrintLetterhead } from "@/components/print-letterhead";
import { ReportExportMenu } from "@/components/report-export-menu";
import { Button } from "@/components/ui/button";
import type { TableExport } from "@/lib/export/table-export";
import { DocumentText, Printer, Refresh } from "iconsax-react";
import Link from "next/link";
import {
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const reportTableClass = "w-full min-w-[640px] text-left text-[12px]";
export const reportTheadClass =
  "border-b border-slate-100 bg-slate-50/70 text-[10px] tracking-wide text-slate-400 uppercase";
export const reportThClass = "px-3 py-2.5 font-medium";
export const reportThRightClass = "px-3 py-2.5 text-right font-medium";
export const reportTrClass =
  "border-b border-slate-50 transition hover:bg-slate-50/60 data-[selected=true]:bg-slate-50/80";
export const reportTdClass = "px-3 py-3 align-top text-slate-700";
export const reportTdRightClass =
  "px-3 py-3 align-top text-right tabular-nums text-slate-700";

export { printCurrentReport } from "@/components/report-export-menu";

/** Standalone Print control when a full export toolbar is not used. */
export function ReportPrintButton({
  label = "Print",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => {
        if (typeof window !== "undefined") window.print();
      }}
    >
      <Printer size={13} color="currentColor" />
      {label}
    </Button>
  );
}

/**
 * Full on-page report document: letterhead, title, filters, body, and one
 * Print / PDF / Excel / CSV toolbar.
 */
export function ReportShell({
  title,
  description,
  actions,
  stats,
  controls,
  children,
  footer,
  exportSpec,
}: {
  title: string;
  description?: string;
  /** Extra actions after the export toolbar (Refresh, etc.). */
  actions?: ReactNode;
  stats?: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** When set, enables PDF / Excel / CSV beside Print. */
  exportSpec?: TableExport | null;
}) {
  return (
    <div className="space-y-4" data-print-area>
      <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/40 px-5 py-4">
          <PrintLetterhead alwaysVisible />
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-slate-400 uppercase">
                Financial report
              </p>
              <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-slate-900">
                {title}
              </h2>
              {description ? (
                <p className="mt-1 text-[12px] text-slate-500">{description}</p>
              ) : null}
              <p className="mt-1 text-[10px] text-slate-400 print:block">
                Prepared {new Date().toLocaleString()} · From posted ledger log
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2" data-print-hide>
              <ReportExportMenu
                spec={exportSpec}
                extra={actions}
              />
            </div>
          </div>
        </div>
        {stats ? (
          <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats}
          </div>
        ) : null}
        {controls ? (
          <div
            className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:flex-wrap sm:items-end"
            data-print-hide
          >
            {controls}
          </div>
        ) : null}
        <div className="p-4 sm:p-5">{children}</div>
        {footer ? (
          <div className="border-t border-slate-100 px-4 py-3 sm:px-5">{footer}</div>
        ) : null}
      </article>
    </div>
  );
}

export function ReportStat({
  label,
  value,
  hint,
  accent,
  danger,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  danger?: boolean;
  /** When set, the figure opens the source breakdown page. */
  href?: string;
}) {
  const valueClass = `mt-1 text-[18px] font-semibold tabular-nums ${
    danger
      ? "text-rose-600"
      : accent
        ? "text-emerald-700"
        : href
          ? "text-sky-700"
          : "text-slate-900"
  }`;
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <p className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">{label}</p>
      {href ? (
        <Link
          href={href}
          className={`${valueClass} block hover:underline`}
          title="Open source breakdown"
        >
          {value}
        </Link>
      ) : (
        <p className={valueClass}>{value}</p>
      )}
      {hint ? <p className="mt-0.5 text-[10px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function ReportEmpty({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-3 py-14 text-center">
      <div className="mx-auto max-w-sm">
        <DocumentText size={28} className="mx-auto text-slate-300" color="currentColor" />
        <p className="mt-3 text-[13px] font-medium text-slate-700">{title}</p>
        <p className="mt-1 text-[11px] text-slate-400">{message}</p>
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}

export function ReportRefreshButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <Refresh size={13} color="currentColor" /> Refresh
    </Button>
  );
}

export function ReportSubheading({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-[12px] font-semibold text-slate-700">{children}</h3>;
}

export function ReportTableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto sm:-mx-5">{children}</div>;
}

export const reportThCheckClass = "w-10 px-3 py-2.5";
export const reportTdCheckClass = "px-3 py-3 align-middle";

export function useRowSelection(ids: string[]) {
  const [selected, setSelected] = useState<string[]>([]);
  const idsKey = ids.join("\0");
  const idSet = useMemo(
    () => new Set(idsKey ? idsKey.split("\0") : []),
    [idsKey],
  );
  const validSelected = useMemo(
    () => selected.filter((id) => idSet.has(id)),
    [selected, idSet],
  );

  const allSelected = ids.length > 0 && ids.every((id) => validSelected.includes(id));
  const someSelected = validSelected.length > 0;

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleAll() {
    setSelected(allSelected ? [] : [...ids]);
  }

  function togglePage(pageIds: string[]) {
    const pageAllSelected =
      pageIds.length > 0 && pageIds.every((id) => validSelected.includes(id));
    setSelected((prev) =>
      pageAllSelected
        ? prev.filter((id) => !pageIds.includes(id))
        : Array.from(new Set([...prev, ...pageIds])),
    );
  }

  function clear() {
    setSelected([]);
  }

  return {
    selected: validSelected,
    allSelected,
    someSelected,
    toggle,
    toggleAll,
    togglePage,
    clear,
    isSelected: (id: string) => validSelected.includes(id),
  };
}
