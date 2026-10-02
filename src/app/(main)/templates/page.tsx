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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  REQUIRED_ACCOUNTING_DOCUMENTS,
  type AccountingDocumentDef,
} from "@/lib/accounting-documents";
import {
  buildDocumentModel,
  documentHtml,
  exportDocumentPdf,
  formTypeForEntity,
  printDocument,
} from "@/lib/export/document-pdf";
import { getCompanyLetterhead } from "@/lib/export/letterhead";
import {
  DOCUMENT_TEMPLATES,
  DOCUMENT_TEMPLATE_EVENT,
  applyRecommendedLayouts,
  applyTemplateEverywhere,
  clearTemplateForFormType,
  loadDocumentTerms,
  loadTemplateSelection,
  recommendedTemplateForEntity,
  saveDocumentTerms,
  setDefaultTemplate,
  setTemplateForFormType,
  templateForDocument,
  type DocumentTemplateId,
  type DocumentTerms,
  type TemplateSelection,
} from "@/lib/export/document-templates";
import type { ManagerRecord } from "@/lib/manager-entities";
import {
  loadBusinessLogo,
  saveBusinessLogo,
} from "@/lib/manager-settings";
import { getMemorySetting, setMemorySetting } from "@/lib/db/client-store";
import { persistSettingToDb } from "@/lib/db/sync";
import { loadRecords } from "@/lib/records-store";
import { defaultHomePath } from "@/lib/access-control";
import {
  Check,
  DocumentDownload,
  Eye,
  HambergerMenu,
  Layer,
  Printer,
  Setting2,
  TickCircle,
} from "iconsax-react";
import Link from "next/link";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const BUSINESS_PROFILE_KEY = "financeiag-business-profile";

/** Every accounting document supported by the shared PDF/print renderer. */
const TEMPLATE_DOCUMENTS = REQUIRED_ACCOUNTING_DOCUMENTS.filter(
  (document) => document.printable && document.module !== "reports",
);

const TEMPLATE_DOCUMENT_BY_KEY = new Map(
  TEMPLATE_DOCUMENTS.map((document) => [document.entityKey, document]),
);

const DEFAULT_DOCUMENT_KEY = "sales-quotes";

/** Prefer a real record so previews show the user's own data — never invent sample rows. */
function previewRecord(target: AccountingDocumentDef): ManagerRecord | null {
  const rows = loadRecords(
    target.storageModule || target.module,
    target.entityKey,
  );
  return rows.find((row) => row.lines) ?? rows[0] ?? null;
}

export default function TemplatesPage() {
  const { openSidebar } = useAppShell();
  const { feedback, close, showSuccess, showWarning } = useFeedbackModals();
  const [ready, setReady] = useState(false);
  const [selection, setSelection] = useState<TemplateSelection | null>(null);
  const [terms, setTerms] = useState<DocumentTerms | null>(null);
  const [documentKey, setDocumentKey] =
    useState<string>(DEFAULT_DOCUMENT_KEY);
  const [busy, setBusy] = useState<string | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [logoFileName, setLogoFileName] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [fullPreview, setFullPreview] = useState<{
    title: string;
    html: string;
    templateId: DocumentTemplateId;
  } | null>(null);

  const refresh = useCallback(() => {
    setSelection(loadTemplateSelection());
    setTerms(loadDocumentTerms());
    const company = getCompanyLetterhead();
    const storedLogo = loadBusinessLogo();
    setLogoDataUrl(company.logoDataUrl);
    setLogoFileName(storedLogo.fileName);
    setReady(true);
  }, []);

  useEffect(() => {
    queueMicrotask(refresh);
    window.addEventListener(DOCUMENT_TEMPLATE_EVENT, refresh);
    window.addEventListener("financeiag-records-changed", refresh);
    window.addEventListener("financeiag-settings-changed", refresh);
    return () => {
      window.removeEventListener(DOCUMENT_TEMPLATE_EVENT, refresh);
      window.removeEventListener("financeiag-records-changed", refresh);
      window.removeEventListener("financeiag-settings-changed", refresh);
    };
  }, [refresh]);

  const target =
    TEMPLATE_DOCUMENT_BY_KEY.get(documentKey) ??
    TEMPLATE_DOCUMENT_BY_KEY.get(DEFAULT_DOCUMENT_KEY) ??
    TEMPLATE_DOCUMENTS[0];
  const broadFormType = formTypeForEntity(target.entityKey, target.label);

  const previews = useMemo(() => {
    if (!ready || !selection || !terms) return [];
    const record = previewRecord(target);
    if (!record) {
      return DOCUMENT_TEMPLATES.map((template) => ({
        template,
        html: "",
        error: `No ${target.label.toLowerCase()} in the database yet — create one to preview layouts.`,
      }));
    }
    return DOCUMENT_TEMPLATES.map((template) => {
      try {
        const model = buildDocumentModel(target.entityKey, target.label, record, {
          templateId: template.id,
        });
        return { template, html: documentHtml(model), error: "" };
      } catch (error) {
        return {
          template,
          html: "",
          error: error instanceof Error ? error.message : "Preview failed",
        };
      }
    });
    // Re-render previews whenever stored settings change.
  }, [ready, selection, terms, target]);

  const activeForForm = selection
    ? templateForDocument(target.entityKey, broadFormType)
    : recommendedTemplateForEntity(target.entityKey);

  function applyEverywhere(id: DocumentTemplateId) {
    applyTemplateEverywhere(id);
    refresh();
    showSuccess(
      "Template applied",
      `Every document now prints with the ${DOCUMENT_TEMPLATES.find((t) => t.id === id)?.name} layout.`,
    );
  }

  function applyRecommended() {
    applyRecommendedLayouts();
    refresh();
    showSuccess(
      "Recommended layouts applied",
      "Each accounting document now uses its distinct source-document layout.",
    );
  }

  function applyToThisForm(id: DocumentTemplateId) {
    setTemplateForFormType(target.entityKey, id);
    refresh();
  }

  function makeDefault(id: DocumentTemplateId) {
    setDefaultTemplate(id);
    refresh();
  }

  async function downloadSample(id: DocumentTemplateId) {
    const record = previewRecord(target);
    if (!record) {
      showWarning(
        "No document to preview",
        `Create a ${target.label.toLowerCase()} first — samples use real database rows only.`,
      );
      return;
    }
    setBusy(id);
    try {
      await exportDocumentPdf(target.entityKey, target.label, record, {
        templateId: id,
      });
      showSuccess("Sample downloaded", `${target.label} sample PDF saved to your downloads.`);
    } catch (error) {
      showWarning(
        "Could not build the PDF",
        error instanceof Error ? error.message : "PDF generation failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  function openFullPreview(title: string, html: string, templateId: DocumentTemplateId) {
    if (!html) {
      showWarning("Preview unavailable", "This template could not be rendered.");
      return;
    }
    setFullPreview({ title, html, templateId });
  }

  function printFullPreview() {
    if (!fullPreview) return;
    const record = previewRecord(target);
    if (!record) {
      showWarning(
        "No document to print",
        `Create a ${target.label.toLowerCase()} first — previews use real database rows only.`,
      );
      return;
    }
    try {
      printDocument(target.entityKey, target.label, record, {
        templateId: fullPreview.templateId,
      });
    } catch (error) {
      showWarning(
        "Print failed",
        error instanceof Error ? error.message : "Could not open the print dialog.",
      );
    }
  }

  function saveTerms(next: DocumentTerms) {
    setTerms(next);
    saveDocumentTerms(next);
  }

  function persistLogo(dataUrl: string | null, fileName: string) {
    saveBusinessLogo({ dataUrl, fileName });
    try {
      const profile =
        getMemorySetting<Record<string, unknown> | null>(BUSINESS_PROFILE_KEY, null) ?? {};
      const next = { ...profile, logoPreview: dataUrl };
      setMemorySetting(BUSINESS_PROFILE_KEY, next);
      void persistSettingToDb(BUSINESS_PROFILE_KEY, next);
    } catch {
      // The dedicated logo store still works if the profile is malformed.
    }
    window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
    window.dispatchEvent(new CustomEvent(DOCUMENT_TEMPLATE_EVENT));
    refresh();
  }

  function uploadLogo(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      showWarning("Unsupported logo", "Upload a PNG or JPG image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showWarning("Logo too large", "Choose an image smaller than 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      persistLogo(reader.result, file.name);
      showSuccess(
        "Logo updated",
        "The logo now appears on every document template, PDF, and printout.",
      );
    };
    reader.onerror = () =>
      showWarning("Upload failed", "The logo file could not be read.");
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    persistLogo(null, "");
    if (logoInputRef.current) logoInputRef.current.value = "";
    showSuccess("Logo removed", "Documents will now print without a logo.");
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
            <Layer size={14} variant="Linear" color="currentColor" />
            <Link href={defaultHomePath()} className="hover:text-slate-700">
              Overview
            </Link>
            <span>/</span>
            <span className="font-medium text-slate-700">Document templates</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <NotificationsMenu />
          <ThemeToggle />
          <Link
            href="/settings?section=footers"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Setting2 size={14} variant="Linear" color="currentColor" />
            Footers
          </Link>
          <PageMoreMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-3 py-5 sm:px-5">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Document templates
            </h1>
            <p className="mt-1 text-[13px] text-slate-500">
              Preview every paper layout with your own data, then pick the one each document type
              should print and email with.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="formType" className="text-[11px] text-slate-500">
                Preview as
              </Label>
              <select
                id="formType"
                value={documentKey}
                onChange={(event) => setDocumentKey(event.target.value)}
                className="mt-1 h-9 w-72 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800"
              >
                {Array.from(
                  new Set(TEMPLATE_DOCUMENTS.map((document) => document.group)),
                ).map((group) => (
                  <optgroup key={group} label={group}>
                    {TEMPLATE_DOCUMENTS.filter(
                      (document) => document.group === group,
                    ).map((document) => (
                      <option
                        key={document.entityKey}
                        value={document.entityKey}
                      >
                        {document.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {previews.map(({ template, html, error }) => {
            const isActive = activeForForm === template.id;
            const isDefault = selection?.default === template.id;
            return (
              <section
                key={template.id}
                className={`flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm ${
                  isActive ? "border-orange-400 ring-1 ring-orange-200" : "border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900">
                      {template.name}
                      {isActive && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-1.5 py-0.5 text-[9px] font-medium text-orange-600">
                          <TickCircle size={10} variant="Bold" color="currentColor" /> In use
                        </span>
                      )}
                      {isDefault && !isActive && (
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                          Default
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">{template.bestFor}</p>
                  </div>
                  <span
                    className="mt-0.5 size-3.5 shrink-0 rounded-full ring-1 ring-black/10"
                    style={{ background: template.accent }}
                  />
                </div>

                <div className="relative h-[330px] overflow-hidden bg-slate-100">
                  {error ? (
                    <p className="p-4 text-[12px] text-rose-600">{error}</p>
                  ) : (
                    <iframe
                      title={`${template.name} preview`}
                      srcDoc={html}
                      sandbox=""
                      tabIndex={-1}
                      className="pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white"
                      style={{ width: 794, height: 1123, transform: "scale(0.42)" }}
                    />
                  )}
                </div>

                <div className="border-t border-slate-100 p-3">
                  <p className="mb-2.5 text-[11px] leading-relaxed text-slate-500">
                    {template.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={isActive ? "outline" : "default"}
                      className={isActive ? "" : "bg-slate-900 hover:bg-slate-800"}
                      onClick={() => applyToThisForm(template.id)}
                      disabled={isActive}
                    >
                      <Check size={13} color="currentColor" />
                      {isActive
                        ? "Selected"
                        : `Use for ${target.label.toLowerCase()}`}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openFullPreview(template.name, html, template.id)}
                      disabled={!html}
                    >
                      <Eye size={13} color="currentColor" /> Full size
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void downloadSample(template.id)}
                      disabled={busy !== null}
                    >
                      <DocumentDownload size={13} color="currentColor" />
                      {busy === template.id ? "PDF…" : "Sample PDF"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => makeDefault(template.id)}
                      disabled={isDefault}
                    >
                      Set default
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => applyEverywhere(template.id)}
                    >
                      <Printer size={13} color="currentColor" /> Use everywhere
                    </Button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
                  {logoDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoDataUrl}
                      alt="Business logo"
                      className="size-full object-contain p-2"
                    />
                  ) : (
                    <ImageIcon className="size-8 text-slate-300" />
                  )}
                </div>
                <div>
                  <h2 className="text-[14px] font-semibold text-slate-900">
                    Business logo
                  </h2>
                  <p className="mt-1 max-w-lg text-[12px] text-slate-500">
                    This logo appears on all {TEMPLATE_DOCUMENTS.length} accounting
                    document templates, PDFs, printouts, and email attachments.
                    Use a transparent PNG for the cleanest result.
                  </p>
                  {logoFileName ? (
                    <p className="mt-1 text-[11px] text-slate-400">
                      Current file: {logoFileName}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(event) => uploadLogo(event.target.files?.[0])}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => logoInputRef.current?.click()}
                >
                  <Upload className="size-4" />
                  {logoDataUrl ? "Replace logo" : "Upload logo"}
                </Button>
                {logoDataUrl ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="text-rose-600 hover:text-rose-700"
                    onClick={removeLogo}
                  >
                    <Trash2 className="size-4" />
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-semibold text-slate-900">
                  Template per document type
                </h2>
                <p className="mt-1 text-[12px] text-slate-500">
                  Each required accounting document has a distinct recommended layout
                  (invoice, delivery slip, receipt voucher, journal, payslip, and more).
                  Leave on <span className="font-medium">Recommended</span> to keep them
                  different, or override any row.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={applyRecommended}>
                <TickCircle size={14} color="currentColor" />
                Apply recommended layouts
              </Button>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Document type</th>
                    <th className="px-3 py-2 text-left font-medium">Template</th>
                  </tr>
                </thead>
                <tbody>
                  {TEMPLATE_DOCUMENTS.map((document) => {
                    const assigned =
                      selection?.byFormType[document.entityKey] ?? "";
                    const recommended = recommendedTemplateForEntity(document.entityKey);
                    const recommendedName =
                      DOCUMENT_TEMPLATES.find((t) => t.id === recommended)?.name ??
                      recommended;
                    return (
                      <tr
                        key={document.entityKey}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-1.5 text-slate-700">
                          <span className="block">{document.label}</span>
                          <span className="block text-[10px] text-slate-400">
                            {document.group} · {recommendedName}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            value={assigned}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (value) {
                                setTemplateForFormType(
                                  document.entityKey,
                                  value as DocumentTemplateId,
                                );
                              } else {
                                clearTemplateForFormType(document.entityKey);
                              }
                              refresh();
                            }}
                            className="h-7 w-44 rounded-md border border-slate-200 bg-white px-2 text-[12px]"
                          >
                            <option value="">
                              Recommended ({recommendedName})
                            </option>
                            {DOCUMENT_TEMPLATES.map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-[14px] font-semibold text-slate-900">
              Terms, bank details &amp; footer
            </h2>
            <p className="mt-1 mb-3 text-[12px] text-slate-500">
              Printed in the Terms and Conditions block. Saved on this device only — nothing is sent
              anywhere.
            </p>
            {terms && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="terms" className="text-[11px] text-slate-500">
                    Numbered terms (one per line)
                  </Label>
                  <Textarea
                    id="terms"
                    rows={3}
                    value={terms.terms.join("\n")}
                    onChange={(event) =>
                      saveTerms({
                        ...terms,
                        terms: event.target.value.split("\n").map((line) => line.trimStart()),
                      })
                    }
                    className="mt-1 text-[12px]"
                  />
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {(
                    [
                      ["accountName", "Account name"],
                      ["accountNumber", "IBAN / account number"],
                      ["bankName", "Beneficiary bank name"],
                      ["swiftCode", "Bank SWIFT code"],
                      ["bankAddress", "Beneficiary address"],
                      ["currency", "Currency"],
                      ["contactPhone", "Questions — phone"],
                      ["contactEmail", "Questions — email"],
                      ["closingNote", "Closing note"],
                    ] as [keyof DocumentTerms, string][]
                  ).map(([key, label]) => (
                    <div key={String(key)}>
                      <Label htmlFor={String(key)} className="text-[11px] text-slate-500">
                        {label}
                      </Label>
                      <Input
                        id={String(key)}
                        value={String(terms[key] ?? "")}
                        onChange={(event) => saveTerms({ ...terms, [key]: event.target.value })}
                        className="mt-1 h-8 text-[12px]"
                      />
                    </div>
                  ))}
                  <div>
                    <Label htmlFor="validityDays" className="text-[11px] text-slate-500">
                      Valid for (days)
                    </Label>
                    <Input
                      id="validityDays"
                      type="number"
                      min={0}
                      value={terms.validityDays}
                      onChange={(event) =>
                        saveTerms({ ...terms, validityDays: Number(event.target.value) || 0 })
                      }
                      className="mt-1 h-8 text-[12px]"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-slate-400">
                  Logo, business name and address come from{" "}
                  <Link
                    href="/settings?section=business"
                    className="font-medium text-slate-600 underline"
                  >
                    Settings → Business
                  </Link>
                  .
                </p>
              </div>
            )}
          </section>
        </div>
      </main>

      <Dialog
        open={Boolean(fullPreview)}
        onOpenChange={(open) => {
          if (!open) setFullPreview(null);
        }}
      >
        <DialogContent className="flex h-[92dvh] w-[min(960px,calc(100%-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
          <DialogHeader className="shrink-0 border-b border-slate-100 px-4 py-3">
            <DialogTitle>{fullPreview?.title || "Document preview"}</DialogTitle>
            <DialogDescription>
              Full-size preview of {target.label.toLowerCase()} — no pop-up
              needed.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-slate-200/80 p-3 sm:p-5">
            {fullPreview ? (
              <iframe
                title={`${fullPreview.title} full preview`}
                srcDoc={fullPreview.html}
                sandbox=""
                className="mx-auto block h-[1123px] w-full max-w-[794px] border-0 bg-white shadow-md"
              />
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
            <Button type="button" variant="outline" onClick={() => setFullPreview(null)}>
              Close
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!fullPreview) return;
                void downloadSample(fullPreview.templateId);
              }}
              disabled={busy !== null}
            >
              <DocumentDownload size={13} color="currentColor" />
              {busy === fullPreview?.templateId ? "PDF…" : "Download PDF"}
            </Button>
            <Button type="button" className="bg-slate-900 hover:bg-slate-800" onClick={printFullPreview}>
              <Printer size={13} color="currentColor" /> Print
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
