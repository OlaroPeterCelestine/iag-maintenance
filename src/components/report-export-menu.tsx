"use client";

import { Button } from "@/components/ui/button";
import {
  exportTableCsv,
  exportTableExcel,
  exportTablePdf,
  type TableExport,
} from "@/lib/export/table-export";
import { DocumentDownload, DocumentText, Printer } from "iconsax-react";
import { useState, type ReactNode } from "react";

export function printCurrentReport() {
  if (typeof window !== "undefined") window.print();
}

/**
 * Single report toolbar: Print + PDF + Excel + CSV.
 * Pass this once per report — do not nest another copy inside ReportShell.
 * Exports reflect the posted ledger log already loaded from Postgres.
 */
export function ReportExportMenu({
  spec,
  onError,
  extra,
  /** False while the journal log is still hydrating from the API. */
  logReady = true,
}: {
  spec?: TableExport | null;
  onError?: (message: string) => void;
  extra?: ReactNode;
  logReady?: boolean;
}) {
  const [busy, setBusy] = useState<"pdf" | "excel" | "csv" | null>(null);
  const hasSpec = Boolean(spec && spec.columns.length);
  const canExport = logReady && hasSpec;

  async function run(kind: "pdf" | "excel" | "csv") {
    if (!spec || !logReady) {
      onError?.(
        "Wait for the ledger log to finish loading from the database before exporting.",
      );
      return;
    }
    setBusy(kind);
    try {
      if (kind === "csv") exportTableCsv(spec);
      else if (kind === "excel") await exportTableExcel(spec);
      else await exportTablePdf(spec);
    } catch (error) {
      onError?.(
        error instanceof Error ? error.message : `Could not export ${kind.toUpperCase()}.`,
      );
    } finally {
      setBusy(null);
    }
  }

  function onPrint() {
    if (!logReady) {
      onError?.(
        "Wait for the ledger log to finish loading from the database before printing.",
      );
      return;
    }
    printCurrentReport();
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-print-hide>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!logReady}
        onClick={onPrint}
      >
        <Printer size={13} color="currentColor" />
        Print
      </Button>
      {hasSpec ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canExport || busy !== null}
            onClick={() => void run("pdf")}
          >
            <DocumentText size={13} color="currentColor" />
            {busy === "pdf" ? "PDF…" : "PDF"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canExport || busy !== null}
            onClick={() => void run("excel")}
          >
            <DocumentDownload size={13} color="currentColor" />
            {busy === "excel" ? "Excel…" : "Excel"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canExport || busy !== null}
            onClick={() => void run("csv")}
          >
            <DocumentDownload size={13} color="currentColor" />
            CSV
          </Button>
        </>
      ) : null}
      {extra}
    </div>
  );
}

export function ReportActions({
  onRefresh,
  exportSpec,
  extra,
  logReady = true,
}: {
  onRefresh: () => void;
  exportSpec?: TableExport | null;
  extra?: ReactNode;
  logReady?: boolean;
}) {
  return (
    <ReportExportMenu
      spec={exportSpec}
      logReady={logReady}
      extra={
        <>
          {extra}
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        </>
      }
    />
  );
}
