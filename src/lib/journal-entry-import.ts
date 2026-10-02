import { apiFetch } from "@/lib/api-auth";
import {
  IMPORT_TEMPLATE_EXAMPLE_TOKEN,
  IMPORT_TEMPLATE_GUIDE_TOKEN,
  parseDelimitedText,
} from "@/lib/csv-text";
import { knownEntityRevision } from "@/lib/db/sync";
import type { ManagerRecord } from "@/lib/manager-entities";

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvEscapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function journalEntryImportTemplateCsv(): string {
  const today = new Date();
  const dmy = `${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`;
  const headers = [
    "#",
    "Reference",
    "Date",
    "Division",
    "Narration",
    "Account",
    "Description",
    "Debit",
    "Credit",
    "Status",
  ];
  const line = (cells: string[]) => cells.map(csvEscape).join(",");
  return [
    line(headers),
    line([
      IMPORT_TEMPLATE_EXAMPLE_TOKEN,
      "JE-0001",
      dmy,
      "",
      "Office rent accrual",
      "Rent expense",
      "August rent",
      "1500000",
      "",
      "Active",
    ]),
    line([
      IMPORT_TEMPLATE_EXAMPLE_TOKEN,
      "JE-0001",
      dmy,
      "",
      "Office rent accrual",
      "Accrued expenses",
      "August rent",
      "",
      "1500000",
      "Active",
    ]),
    line([
      IMPORT_TEMPLATE_GUIDE_TOKEN,
      "Optional — rows sharing a reference become one entry",
      "DD/MM/YYYY or YYYY-MM-DD",
      "Optional class / cost centre",
      "Optional header narration",
      "Required — GL account",
      "Optional line memo",
      "Number (leave blank on credit lines)",
      "Number (leave blank on debit lines)",
      "Active or Draft",
    ]),
    "",
  ].join("\n");
}

export function downloadJournalEntryImportTemplate() {
  const blob = new Blob([journalEntryImportTemplateCsv()], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "journal-entry-import-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

async function normalizeJournalUploadFile(file: File): Promise<File> {
  const name = file.name || "journal-entry.csv";
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
  const base = name.replace(/\.(tsv|txt|csv)$/i, "") || "journal-entry";
  return new File([csv], `${base}.csv`, { type: "text/csv" });
}

export type JournalEntryImportResult = {
  ok: boolean;
  imported: number;
  skipped: number;
  errors: string[];
  revision?: string;
  records: ManagerRecord[];
  error?: string;
  code?: string;
};

async function postJournalEntryCsv(
  file: File,
  expectedRevision?: string,
): Promise<{
  res: Response;
  json: (Partial<JournalEntryImportResult> & { error?: string; message?: string; code?: string }) | null;
}> {
  const params = new URLSearchParams();
  if (expectedRevision) params.set("expectedRevision", expectedRevision);
  const qs = params.toString() ? `?${params}` : "";

  const body = new FormData();
  body.append("file", file, file.name || "journal-entry.csv");

  const res = await apiFetch(`/api/records/accounts/journal-entries/import-csv${qs}`, {
    method: "POST",
    body,
  });
  const json = (await res.json().catch(() => null)) as
    | (Partial<JournalEntryImportResult> & { error?: string; message?: string; code?: string })
    | null;
  return { res, json };
}

/** Upload a journal entry line-sheet CSV (Account / Debit / Credit rows). */
export async function uploadJournalEntryCsv(
  file: File,
  opts?: { expectedRevision?: string },
): Promise<JournalEntryImportResult> {
  let expected =
    opts?.expectedRevision ?? knownEntityRevision("accounts", "journal-entries") ?? undefined;

  const upload = await normalizeJournalUploadFile(file);
  let { res, json } = await postJournalEntryCsv(upload, expected);

  if (
    res.status === 409 &&
    (json?.code === "REVISION_CONFLICT" || /changed since last load/i.test(String(json?.error || "")))
  ) {
    const serverRev = typeof json?.revision === "string" ? json.revision.trim() : "";
    if (serverRev && serverRev !== expected) {
      expected = serverRev;
      ({ res, json } = await postJournalEntryCsv(upload, expected));
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
