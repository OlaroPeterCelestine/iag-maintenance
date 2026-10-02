"use client";

import { useAppShell } from "@/components/app-shell";
import { FeedbackModals, useFeedbackModals } from "@/components/feedback-modals";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ACCOUNTING_DOCUMENT_GROUPS,
  accountingDocsByGroup,
  REQUIRED_ACCOUNTING_DOCUMENTS,
  type AccountingDocGroup,
  type AccountingDocumentDef,
} from "@/lib/accounting-documents";
import {
  buildDocumentModel,
  documentHtml,
  exportDocumentPdf,
  printDocument,
  supportsDocumentPdf,
} from "@/lib/export/document-pdf";
import {
  COMPANY_LETTERHEAD_CSS,
  companyLetterheadHtml,
} from "@/lib/export/letterhead";
import { exportPayslipPdf } from "@/lib/export/statement-payslip";
import { exportMaterialRequestCsv } from "@/lib/material-request-lines";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords } from "@/lib/records-store";
import { defaultHomePath } from "@/lib/access-control";
import { cn } from "@/lib/utils";
import {
  DocumentDownload,
  DocumentText,
  Eye,
  HambergerMenu,
  Printer,
  Refresh,
  TickCircle,
} from "iconsax-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";

type GroupFilter = "all" | AccountingDocGroup;

type DocPreview = {
  doc: AccountingDocumentDef;
  record: ManagerRecord;
  html: string;
};

function sampleFor(doc: AccountingDocumentDef): ManagerRecord | null {
  const moduleSlug = doc.storageModule || doc.module;
  if (doc.module === "reports") return null;
  const rows = loadRecords(moduleSlug, doc.entityKey);
  return rows.find((row) => String(row.id).startsWith("sample-")) ?? rows[0] ?? null;
}

function countFor(doc: AccountingDocumentDef): number {
  if (doc.module === "reports") return 0;
  return loadRecords(doc.storageModule || doc.module, doc.entityKey).length;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Simple sheet when the fancy PDF layout isn't available for this entity. */
function recordSheetHtml(doc: AccountingDocumentDef, record: ManagerRecord) {
  const skip = new Set(["id", "createdAt", "updatedAt", "lines", "status"]);
  const rows = Object.entries(record)
    .filter(([key, value]) => !skip.has(key) && value != null && String(value).trim() !== "")
    .map(
      ([key, value]) =>
        `<tr><th style="text-align:left;padding:6px 10px;color:#64748b;font-weight:500;width:34%">${escapeHtml(key)}</th><td style="padding:6px 10px;color:#0f172a">${escapeHtml(String(value))}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:32px;background:#fff;color:#0f172a}
  h1{font-size:20px;margin:0 0 4px} .meta{color:#64748b;font-size:12px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  tr{border-bottom:1px solid #e2e8f0}
  ${COMPANY_LETTERHEAD_CSS}
</style></head>
<body>
  ${companyLetterheadHtml({ title: doc.label, subtitle: doc.purpose })}
  <table>${rows || "<tr><td>No fields on this sample.</td></tr>"}</table>
</body></html>`;
}

function previewHtmlFor(doc: AccountingDocumentDef, record: ManagerRecord) {
  if (supportsDocumentPdf(doc.entityKey)) {
    try {
      const model = buildDocumentModel(doc.entityKey, doc.label, record);
      return documentHtml(model);
    } catch {
      return recordSheetHtml(doc, record);
    }
  }
  return recordSheetHtml(doc, record);
}

function DocumentRow({
  doc,
  busy,
  hydrated,
  onOpen,
  onExport,
}: {
  doc: AccountingDocumentDef;
  busy: string | null;
  /** False until after mount so SSR and the first client paint stay in sync. */
  hydrated: boolean;
  onOpen: (doc: AccountingDocumentDef) => void;
  onExport: (doc: AccountingDocumentDef, kind: "pdf" | "print") => void;
}) {
  const count = hydrated ? countFor(doc) : 0;
  const isReport = doc.module === "reports";
  const hasSample = isReport || count > 0;

  return (
    <li className="flex flex-col gap-2 border-b border-slate-100 px-3 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-medium text-slate-900">{doc.label}</p>
          {!hydrated ? (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-400">
              …
            </span>
          ) : hasSample ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">
              <TickCircle size={10} variant="Bold" color="currentColor" />
              {isReport ? "Report" : `${count} on file`}
            </span>
          ) : (
            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
              Empty
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{doc.purpose}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        <Button type="button" size="sm" variant="outline" onClick={() => onOpen(doc)}>
          <Eye size={13} color="currentColor" /> Open
        </Button>
        {doc.printable && !isReport && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null || !hasSample}
              onClick={() => onExport(doc, "pdf")}
            >
              <DocumentDownload size={13} color="currentColor" />
              {doc.entityKey === "requisitions"
                ? busy === `${doc.id}-pdf`
                  ? "CSV…"
                  : "CSV"
                : busy === `${doc.id}-pdf`
                  ? "PDF…"
                  : "PDF"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy !== null || !hasSample}
              onClick={() => onExport(doc, "print")}
            >
              <Printer size={13} color="currentColor" /> Print
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export default function AccountingDocumentsPage() {
  const router = useRouter();
  const { openSidebar } = useAppShell();
  const { feedback, close, showSuccess, showWarning } = useFeedbackModals();
  const hydrated = useMounted();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [preview, setPreview] = useState<DocPreview | null>(null);

  useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    window.addEventListener("financeiag-records-changed", onChange);
    return () => window.removeEventListener("financeiag-records-changed", onChange);
  }, []);

  const groups = accountingDocsByGroup();
  void tick;

  const readyCount = hydrated
    ? REQUIRED_ACCOUNTING_DOCUMENTS.filter((doc) => {
        if (doc.module === "reports") return true;
        return countFor(doc) > 0;
      }).length
    : 0;

  const visibleGroups = useMemo(() => {
    if (groupFilter === "all") return groups;
    return groups.filter(({ group }) => group === groupFilter);
  }, [groupFilter, groups]);

  function openDocument(doc: AccountingDocumentDef) {
    if (doc.module === "reports") {
      router.push(doc.href);
      return;
    }
    const record = sampleFor(doc);
    if (!record) {
      showWarning(
        "No document yet",
        `Create a ${doc.label.toLowerCase()} in ${doc.module} first.`,
      );
      return;
    }
    setPreview({
      doc,
      record,
      html: previewHtmlFor(doc, record),
    });
  }

  async function runExport(doc: AccountingDocumentDef, kind: "pdf" | "print", recordOverride?: ManagerRecord) {
    if (doc.module === "reports") {
      router.push(doc.href);
      return;
    }
    const record = recordOverride ?? sampleFor(doc);
    if (!record) {
      showWarning(
        "No document yet",
        `Create a ${doc.label.toLowerCase()} in ${doc.module} first.`,
      );
      return;
    }
    setBusy(`${doc.id}-${kind}`);
    try {
      if (kind === "print") {
        if (supportsDocumentPdf(doc.entityKey)) {
          printDocument(doc.entityKey, doc.label, record);
        } else {
          const html = recordSheetHtml(doc, record);
          const frame = document.createElement("iframe");
          frame.style.position = "fixed";
          frame.style.right = "0";
          frame.style.bottom = "0";
          frame.style.width = "0";
          frame.style.height = "0";
          frame.style.border = "0";
          document.body.appendChild(frame);
          const win = frame.contentWindow;
          if (!win) throw new Error("Print frame unavailable");
          win.document.open();
          win.document.write(html);
          win.document.close();
          win.focus();
          win.print();
          setTimeout(() => frame.remove(), 1000);
        }
        return;
      }
      if (doc.entityKey === "requisitions") {
        exportMaterialRequestCsv(record);
        showSuccess("CSV downloaded", `${doc.label} CSV saved to your downloads.`);
        return;
      }
      if (doc.entityKey === "payslips") {
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
      } else if (supportsDocumentPdf(doc.entityKey)) {
        await exportDocumentPdf(doc.entityKey, doc.label, record);
      } else {
        showWarning("PDF not available", `${doc.label} opens in its module for now.`);
        router.push(doc.href);
        return;
      }
      showSuccess("PDF downloaded", `${doc.label} saved to your downloads.`);
    } catch (error) {
      showWarning(
        "Export failed",
        error instanceof Error ? error.message : "Could not generate the document.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <FeedbackModals feedback={feedback} onClose={close} />

      <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-3 sm:px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={openSidebar}
            aria-label="Open navigation"
          >
            <HambergerMenu size={18} variant="Linear" color="currentColor" />
          </Button>
          <div className="flex items-center gap-2 text-[13px] text-slate-400">
            <DocumentText size={14} variant="Linear" color="currentColor" />
            <Link href={defaultHomePath()} className="hover:text-slate-700">
              Overview
            </Link>
            <span>/</span>
            <span className="font-medium text-slate-700">Accounting documents</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <NotificationsMenu />
          <ThemeToggle />
          <Link
            href="/templates"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Templates
          </Link>
          <PageMoreMenu />
        </div>
      </header>

      <main className="w-full px-3 py-5 sm:px-4 lg:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Required accounting documents
            </h1>
            <p className="mt-1 text-[13px] text-slate-500">
              Full pack of {REQUIRED_ACCOUNTING_DOCUMENTS.length} source documents and control
              reports — sales, purchases, cash, payroll, inventory, assets, journals and tax.
              Each printable document uses its own paper layout (invoice, delivery slip, receipt
              voucher, payslip, journal, and more). Open any row to preview.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              {hydrated
                ? `${readyCount}/${REQUIRED_ACCOUNTING_DOCUMENTS.length} ready`
                : `…/${REQUIRED_ACCOUNTING_DOCUMENTS.length} ready`}
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => setTick((n) => n + 1)}>
              <Refresh size={13} color="currentColor" /> Refresh
            </Button>
          </div>
        </div>

        <div className="sticky top-0 z-10 -mx-3 mb-4 border-b border-slate-200 bg-[#fbfbfc]/90 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4 lg:-mx-6 lg:px-6">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setGroupFilter("all")}
              className={cn(
                "shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
                groupFilter === "all"
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
              )}
            >
              All ({REQUIRED_ACCOUNTING_DOCUMENTS.length})
            </button>
            {ACCOUNTING_DOCUMENT_GROUPS.map((group) => {
              const count = groups.find((g) => g.group === group)?.items.length ?? 0;
              return (
                <button
                  key={group}
                  type="button"
                  onClick={() => setGroupFilter(group)}
                  className={cn(
                    "shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
                    groupFilter === group
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
                  )}
                >
                  {group} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {groupFilter === "all" ? (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {visibleGroups.map(({ group, items }) => (
              <section
                key={group}
                id={group.toLowerCase().replace(/\s+/g, "-")}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-3 py-2">
                  <h2 className="text-[13px] font-semibold text-slate-800">{group}</h2>
                  <span className="text-[11px] text-slate-400">{items.length}</span>
                </div>
                <ul>
                  {items.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      busy={busy}
                      hydrated={hydrated}
                      onOpen={openDocument}
                      onExport={(d, kind) => void runExport(d, kind)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {visibleGroups.map(({ group, items }) => (
              <section key={group}>
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
                  <h2 className="text-[13px] font-semibold text-slate-800">{group}</h2>
                  <span className="text-[11px] text-slate-400">{items.length} documents</span>
                </div>
                <ul>
                  {items.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      busy={busy}
                      hydrated={hydrated}
                      onOpen={openDocument}
                      onExport={(d, kind) => void runExport(d, kind)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="flex h-[92dvh] w-[min(960px,calc(100%-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
          <DialogHeader className="shrink-0 border-b border-slate-100 px-4 py-3">
            <DialogTitle>{preview?.doc.label || "Document preview"}</DialogTitle>
            <DialogDescription>
              {preview
                ? `Sample ${preview.doc.label.toLowerCase()} — print or download without leaving the pack.`
                : "Document preview"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-slate-200/80 p-3 sm:p-5">
            {preview ? (
              <iframe
                title={`${preview.doc.label} preview`}
                srcDoc={preview.html}
                sandbox=""
                className="mx-auto block h-[1123px] w-full max-w-[794px] border-0 bg-white shadow-md"
              />
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
            <Button type="button" variant="outline" onClick={() => setPreview(null)}>
              Close
            </Button>
            {preview ? (
              <>
                <Link
                  href={preview.doc.href}
                  className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Edit in module
                </Link>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void runExport(preview.doc, "pdf", preview.record)}
                >
                  <DocumentDownload size={13} color="currentColor" />
                  {busy === `${preview.doc.id}-pdf` ? "PDF…" : "Download PDF"}
                </Button>
                <Button
                  type="button"
                  className="bg-slate-900 hover:bg-slate-800"
                  disabled={busy !== null}
                  onClick={() => void runExport(preview.doc, "print", preview.record)}
                >
                  <Printer size={13} color="currentColor" /> Print
                </Button>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
