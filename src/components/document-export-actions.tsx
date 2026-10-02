"use client";

import { Button } from "@/components/ui/button";
import {
  exportDocumentPdf,
  printDocument,
  supportsDocumentPdf,
} from "@/lib/export/document-pdf";
import { emailDocument } from "@/lib/export/email-document";
import {
  COMPANY_LETTERHEAD_CSS,
  companyLetterheadHtml,
} from "@/lib/export/letterhead";
import { exportPayslipPdf } from "@/lib/export/statement-payslip";
import { exportMaterialRequestCsv, materialRequestCsvRows } from "@/lib/material-request-lines";
import type { ManagerRecord } from "@/lib/manager-entities";
import { DocumentDownload, Printer, Sms } from "iconsax-react";
import { useState } from "react";

function printMaterialRequestCsvSheet(record: ManagerRecord) {
  const { columns, rows } = materialRequestCsvRows(record);
  const title = `Material Request ${record.reference || record.id.slice(0, 8)}`;
  const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell ?? ""))}</td>`).join("")}</tr>`,
    )
    .join("");
  const html = `<!doctype html><html><head><title>${escapeHtml(title)}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;padding:24px;color:#0f172a}
  h1{font-size:18px;margin:0 0 12px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
  th{background:#f1f5f9}
  ${COMPANY_LETTERHEAD_CSS}
</style></head><body>
  ${companyLetterheadHtml({ title })}
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) throw new Error("Pop-up blocked — allow pop-ups to print.");
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function DocumentExportActions({
  entityKey,
  entityLabel,
  record,
  partyRecords,
  onInfo,
  onError,
  size = "sm",
}: {
  entityKey: string;
  entityLabel: string;
  record: ManagerRecord;
  partyRecords?: ManagerRecord[];
  onInfo?: (title: string, message: string) => void;
  onError?: (title: string, message: string) => void;
  size?: "sm" | "default";
}) {
  const [busy, setBusy] = useState<"pdf" | "csv" | "email" | "print" | null>(null);
  const isMaterialRequest = entityKey === "requisitions";

  if (!supportsDocumentPdf(entityKey) && entityKey !== "payslips" && !isMaterialRequest) {
    return null;
  }

  async function run(kind: "pdf" | "csv" | "email" | "print") {
    setBusy(kind);
    try {
      if (isMaterialRequest) {
        if (kind === "print") {
          printMaterialRequestCsvSheet(record);
          return;
        }
        exportMaterialRequestCsv(record);
        onInfo?.(
          "CSV downloaded",
          `${entityLabel} CSV saved to your downloads.`,
        );
        return;
      }
      if (kind === "print") {
        printDocument(entityKey, entityLabel, record);
        return;
      }
      if (kind === "pdf") {
        if (entityKey === "payslips") {
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
          await exportDocumentPdf(entityKey, entityLabel, record);
        }
        onInfo?.("PDF downloaded", `${entityLabel} PDF saved to your downloads.`);
        return;
      }
      const result = await emailDocument(entityKey, entityLabel, record, {
        partyRecords,
      });
      onInfo?.(
        "Email draft opened",
        result.to
          ? `PDF downloaded. A mail draft was opened for ${result.to} — attach the PDF before sending.`
          : "PDF downloaded. A mail draft was opened — add the recipient and attach the PDF before sending.",
      );
    } catch (error) {
      onError?.(
        "Export failed",
        error instanceof Error ? error.message : "Could not generate the document.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (isMaterialRequest) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={busy !== null}
          onClick={() => void run("csv")}
        >
          <DocumentDownload size={13} color="currentColor" />
          {busy === "csv" ? "CSV…" : "CSV"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={busy !== null}
          onClick={() => void run("print")}
        >
          <Printer size={13} color="currentColor" />
          Print
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={busy !== null}
        onClick={() => void run("pdf")}
      >
        <DocumentDownload size={13} color="currentColor" />
        {busy === "pdf" ? "PDF…" : "PDF"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={busy !== null}
        onClick={() => void run("print")}
      >
        <Printer size={13} color="currentColor" />
        Print
      </Button>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={busy !== null}
        onClick={() => void run("email")}
      >
        <Sms size={13} color="currentColor" />
        {busy === "email" ? "Email…" : "Email"}
      </Button>
    </div>
  );
}
