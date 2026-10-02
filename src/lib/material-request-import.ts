import { apiFetch } from "@/lib/api-auth";
import { parseDelimitedText } from "@/lib/csv-text";
import { knownEntityRevision } from "@/lib/db/sync";
import type { ManagerRecord } from "@/lib/manager-entities";
import {
  downloadMaterialRequestImportTemplate,
  materialRequestImportTemplateCsv,
  parseMaterialRequestCsvText,
} from "@/lib/material-request-lines";

export {
  downloadMaterialRequestImportTemplate,
  materialRequestImportTemplateCsv,
  parseMaterialRequestCsvText,
};

/** Escape one CSV cell (RFC-4180) for re-serializing TSV/semicolon sheets as comma CSV. */
function csvEscapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Normalize tab/semicolon/pipe delimited uploads to comma CSV before the API call.
 * The Go importer also auto-detects delimiters; this keeps older API builds working.
 */
export async function normalizeMaterialRequestUploadFile(file: File): Promise<File> {
  const name = file.name || "material-request.csv";
  if (/\.json$/i.test(name)) return file;
  const text = await file.text();
  if (!text.trim()) return file;
  const rows = parseDelimitedText(text);
  if (rows.length < 2) return file;
  // Already comma-shaped with matching column counts — keep original bytes.
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
  const base = name.replace(/\.(tsv|txt|csv)$/i, "") || "material-request";
  return new File([csv], `${base}.csv`, { type: "text/csv" });
}

export type MaterialRequestImportResult = {
  ok: boolean;
  imported: number;
  skipped: number;
  errors: string[];
  revision?: string;
  records: ManagerRecord[];
  error?: string;
  code?: string;
};

async function postMaterialRequestCsv(
  file: File,
  expectedRevision?: string,
): Promise<{ res: Response; json: (Partial<MaterialRequestImportResult> & { error?: string; message?: string; code?: string }) | null }> {
  const params = new URLSearchParams();
  if (expectedRevision) params.set("expectedRevision", expectedRevision);
  const qs = params.toString() ? `?${params}` : "";

  const body = new FormData();
  body.append("file", file, file.name || "material-request.csv");

  const res = await apiFetch(`/api/records/projects/requisitions/import-csv${qs}`, {
    method: "POST",
    body,
  });
  const json = (await res.json().catch(() => null)) as
    | (Partial<MaterialRequestImportResult> & { error?: string; message?: string; code?: string })
    | null;
  return { res, json };
}

/**
 * Upload a Material Request line-item CSV to the Go API.
 * Accepts the same columns as the CSV export (Item, Material Description, …).
 * Sends the known collection revision and retries once on conflict.
 */
export async function uploadMaterialRequestCsv(
  file: File,
  opts?: { expectedRevision?: string },
): Promise<MaterialRequestImportResult> {
  let expected =
    opts?.expectedRevision ?? knownEntityRevision("projects", "requisitions") ?? undefined;

  const upload = await normalizeMaterialRequestUploadFile(file);
  let { res, json } = await postMaterialRequestCsv(upload, expected);

  // Collection changed since last load — retry once with the server revision.
  if (
    res.status === 409 &&
    (json?.code === "REVISION_CONFLICT" || /changed since last load/i.test(String(json?.error || "")))
  ) {
    const serverRev = typeof json?.revision === "string" ? json.revision.trim() : "";
    if (serverRev && serverRev !== expected) {
      expected = serverRev;
      ({ res, json } = await postMaterialRequestCsv(upload, expected));
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
