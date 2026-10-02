import { apiFetch } from "@/lib/api-auth";
import { parseDelimitedText } from "@/lib/csv-text";
import { knownEntityRevision } from "@/lib/db/sync";
import {
  DOCUMENT_LINE_IMPORT_MODULE,
  downloadDocumentLineImportTemplate,
  documentLineImportTemplateCsv,
  isDocumentLineImportEntity,
} from "@/lib/document-line-import-sheet";
import type { ManagerRecord } from "@/lib/manager-entities";

export {
  downloadDocumentLineImportTemplate,
  documentLineImportTemplateCsv,
  isDocumentLineImportEntity,
};

/** Escape one CSV cell (RFC-4180) for re-serializing TSV/semicolon sheets as comma CSV. */
function csvEscapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function normalizeDocumentLineUploadFile(file: File): Promise<File> {
  const name = file.name || "document.csv";
  if (/\.json$/i.test(name)) return file;
  const text = await file.text();
  if (!text.trim()) return file;
  const rows = parseDelimitedText(text);
  if (rows.length < 2) return file;
  const sample = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
  const tabHeavy = sample.filter((line) => (line.match(/\t/g) || []).length >= 2).length;
  const semiHeavy = sample.filter((line) => (line.match(/;/g) || []).length >= 2).length;
  if (tabHeavy === 0 && semiHeavy === 0 && !/\.tsv$/i.test(name)) {
    return file;
  }
  const csv = rows.map((row) => row.map(csvEscapeCell).join(",")).join("\n") + "\n";
  const base = name.replace(/\.(tsv|txt|csv)$/i, "") || "document";
  return new File([csv], `${base}.csv`, { type: "text/csv" });
}

export type DocumentLineImportResult = {
  ok: boolean;
  imported: number;
  skipped: number;
  errors: string[];
  revision?: string;
  records: ManagerRecord[];
  error?: string;
  code?: string;
};

async function postDocumentLineCsv(
  moduleSlug: string,
  entityKey: string,
  file: File,
  expectedRevision?: string,
): Promise<{
  res: Response;
  json: (Partial<DocumentLineImportResult> & { error?: string; message?: string; code?: string }) | null;
}> {
  const params = new URLSearchParams();
  if (expectedRevision) params.set("expectedRevision", expectedRevision);
  const qs = params.toString() ? `?${params}` : "";

  const body = new FormData();
  body.append("file", file, file.name || `${entityKey}.csv`);

  const res = await apiFetch(`/api/records/${moduleSlug}/${entityKey}/import-csv${qs}`, {
    method: "POST",
    body,
  });
  const json = (await res.json().catch(() => null)) as
    | (Partial<DocumentLineImportResult> & { error?: string; message?: string; code?: string })
    | null;
  return { res, json };
}

/**
 * Upload a document line-item CSV (invoices, bills, quotes, orders, credit/debit notes).
 * One CSV row = one line; rows sharing Reference (or party+date) group into one document.
 */
export async function uploadDocumentLineCsv(
  entityKey: string,
  file: File,
  opts?: { expectedRevision?: string; moduleSlug?: string },
): Promise<DocumentLineImportResult> {
  if (!isDocumentLineImportEntity(entityKey)) {
    return {
      ok: false,
      imported: 0,
      skipped: 0,
      errors: [],
      records: [],
      error: `Line-sheet CSV is not supported for ${entityKey}`,
    };
  }
  const moduleSlug =
    DOCUMENT_LINE_IMPORT_MODULE[entityKey] ||
    opts?.moduleSlug ||
    "sales";
  let expected =
    opts?.expectedRevision ?? knownEntityRevision(moduleSlug, entityKey) ?? undefined;

  const upload = await normalizeDocumentLineUploadFile(file);
  let { res, json } = await postDocumentLineCsv(moduleSlug, entityKey, upload, expected);

  if (
    res.status === 409 &&
    (json?.code === "REVISION_CONFLICT" || /changed since last load/i.test(String(json?.error || "")))
  ) {
    const serverRev = typeof json?.revision === "string" ? json.revision.trim() : "";
    if (serverRev && serverRev !== expected) {
      expected = serverRev;
      ({ res, json } = await postDocumentLineCsv(moduleSlug, entityKey, upload, expected));
    }
  }

  if (!res.ok || !json?.ok) {
    return {
      ok: false,
      imported: 0,
      skipped: 0,
      errors: Array.isArray(json?.errors) ? json!.errors.map(String) : [],
      records: [],
      revision: typeof json?.revision === "string" ? json.revision : undefined,
      code: typeof json?.code === "string" ? json.code : undefined,
      error:
        (json && (json.error || json.message)) ||
        `Import failed (${res.status})`,
    };
  }

  return {
    ok: true,
    imported: Number(json.imported || 0),
    skipped: Number(json.skipped || 0),
    errors: Array.isArray(json.errors) ? json.errors.map(String) : [],
    revision: json.revision,
    records: Array.isArray(json.records) ? (json.records as ManagerRecord[]) : [],
  };
}

/** @deprecated Prefer uploadDocumentLineCsv */
export async function uploadSalesInvoiceCsv(
  file: File,
  opts?: {
    expectedRevision?: string;
    entityKey?: "sales-invoices" | "invoices";
  },
): Promise<DocumentLineImportResult> {
  return uploadDocumentLineCsv(opts?.entityKey ?? "sales-invoices", file, {
    expectedRevision: opts?.expectedRevision,
    moduleSlug: "sales",
  });
}
