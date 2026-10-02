import {
  IMPORT_TEMPLATE_EXAMPLE_TOKEN,
  IMPORT_TEMPLATE_GUIDE_TOKEN,
  isTemplateMarkerRow,
  parseDelimitedText,
} from "@/lib/csv-text";
import { safeFilename } from "@/lib/export/download";
import { exportTableCsv } from "@/lib/export/table-export";
import type { ManagerRecord } from "@/lib/manager-entities";

export type MaterialRequestLine = {
  description: string;
  unit: string;
  quantity: string;
  remarks: string;
};

export const MATERIAL_REQUEST_CSV_HEADERS = [
  "Item",
  "Material Description",
  "Unit",
  "Qty",
  "Project",
  "Contractor",
  "Date Required",
  "Remarks/Status",
] as const;

function canonicalMaterialHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ");
}

function materialCsvColumnKey(header: string): string {
  switch (canonicalMaterialHeader(header)) {
    case "item":
    case "item no":
    case "item number":
    case "#":
      return "item";
    case "material description":
    case "material":
    case "description":
    case "materials items":
    case "materials / items":
      return "description";
    case "unit":
    case "uom":
    case "unit of measure":
      return "unit";
    case "qty":
    case "quantity":
      return "quantity";
    case "project":
    case "project name":
      return "project";
    case "contractor":
    case "initiator":
    case "requested by":
      return "contractor";
    case "date required":
    case "needed by":
    case "required date":
    case "neededby":
      return "neededBy";
    case "remarks":
    case "remarks status":
    case "remarks/status":
    case "status remarks":
    case "notes":
      return "remarks";
    default:
      return "";
  }
}

/** Blank template matching the Material Request line sheet / API importer. */
export function materialRequestImportTemplateCsv(): string {
  const today = new Date();
  const dmy = `${today.getDate()}/${today.getMonth() + 1}/${today.getFullYear()}`;
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const line = (cells: string[]) => cells.map(escape).join(",");
  // The Item cell carries the marker token so the sample rows are skipped on
  // upload — users routinely leave them in place.
  return [
    line([...MATERIAL_REQUEST_CSV_HEADERS]),
    line([
      IMPORT_TEMPLATE_EXAMPLE_TOKEN,
      "pvc pipes 4 inch",
      "pcs",
      "8",
      "Nyabihoko",
      "SATE builders",
      dmy,
      "",
    ]),
    line([
      IMPORT_TEMPLATE_GUIDE_TOKEN,
      "Required — one row per material",
      "Unit of measure (defaults to pcs)",
      "Number only",
      "Project name — rows sharing project/contractor/date group into one request",
      "Initiator / requested by",
      "Date required as DD/MM/YYYY or YYYY-MM-DD",
      "Optional remarks",
    ]),
    "",
  ].join("\n");
}

export type MaterialRequestCsvParseResult = {
  lines: MaterialRequestLine[];
  project: string;
  contractor: string;
  neededBy: string;
  error?: string;
};

/** Parse a Material Request CSV into form line items (and optional header fields). */
export function parseMaterialRequestCsvText(text: string): MaterialRequestCsvParseResult {
  // Drop the template's example / guide rows so an untouched template imports nothing.
  const allRows = parseDelimitedText(text);
  const rows = allRows.filter((cells) => !isTemplateMarkerRow(cells));
  if (rows.length < 2) {
    return {
      lines: [],
      project: "",
      contractor: "",
      neededBy: "",
      error:
        rows.length < allRows.length
          ? "This is the blank template — add your material lines below the header row, then upload it again."
          : "CSV needs a header row and at least one material line.",
    };
  }
  const header = rows[0] || [];
  const keys = header.map(materialCsvColumnKey);
  if (!keys.includes("description") && !keys.includes("quantity")) {
    return {
      lines: [],
      project: "",
      contractor: "",
      neededBy: "",
      error:
        "Unrecognized CSV columns. Download the Material Request CSV template and try again.",
    };
  }

  const lines: MaterialRequestLine[] = [];
  let project = "";
  let contractor = "";
  let neededBy = "";

  for (const row of rows.slice(1)) {
    const get = (key: string) => {
      const idx = keys.indexOf(key);
      return idx >= 0 ? String(row[idx] ?? "").trim() : "";
    };
    const description = get("description");
    const quantity = get("quantity");
    const unit = get("unit") || "pcs";
    const remarks = get("remarks");
    if (!description && !quantity) continue;
    if (!project) project = get("project");
    if (!contractor) contractor = get("contractor");
    if (!neededBy) neededBy = get("neededBy");
    lines.push({
      description,
      unit,
      quantity,
      remarks,
    });
  }

  if (!lines.length) {
    return {
      lines: [],
      project,
      contractor,
      neededBy,
      error: "No material lines found in the CSV.",
    };
  }
  return { lines, project, contractor, neededBy };
}

export function downloadMaterialRequestImportTemplate() {
  const blob = new Blob([materialRequestImportTemplateCsv()], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "material-request-import-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function emptyMaterialRequestLine(): MaterialRequestLine {
  return { description: "", unit: "pcs", quantity: "", remarks: "" };
}

export function parseMaterialRequestLines(raw: string | undefined | null): MaterialRequestLine[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        description: String(r.description ?? r.material ?? r.item ?? r.name ?? "").trim(),
        unit: String(r.unit ?? "pcs").trim() || "pcs",
        quantity: String(r.quantity ?? r.qty ?? "").trim(),
        remarks: String(r.remarks ?? r.status ?? r.notes ?? "").trim(),
      };
    });
  } catch {
    return [];
  }
}

/** Seed lines from legacy single-description material requests. */
export function materialRequestLinesFromRecord(record?: ManagerRecord | null): MaterialRequestLine[] {
  const raw = record?.lines;
  // Present `lines` JSON (including "[]") wins — do not resurrect from description.
  if (raw != null && String(raw).trim() !== "") {
    const fromJson = parseMaterialRequestLines(raw);
    return fromJson.length ? fromJson : [emptyMaterialRequestLine()];
  }
  const description = (record?.description || "").trim();
  if (!description) return [emptyMaterialRequestLine()];
  const chunks = description
    .split(/\n|;/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!chunks.length) return [emptyMaterialRequestLine()];
  return chunks.map((line) => ({
    description: line,
    unit: (record?.unit || "pcs").trim() || "pcs",
    quantity: (record?.quantity || "").trim(),
    remarks: "",
  }));
}

export function serializeMaterialRequestLines(lines: MaterialRequestLine[]): string {
  const cleaned = lines
    .map((line) => ({
      description: line.description.trim(),
      unit: (line.unit || "pcs").trim() || "pcs",
      quantity: line.quantity.trim(),
      remarks: line.remarks.trim(),
    }))
    .filter((line) => line.description || line.quantity || line.remarks);
  return JSON.stringify(cleaned.length ? cleaned : []);
}

export function materialRequestLinesSummary(lines: MaterialRequestLine[]): string {
  return lines
    .map((line) => {
      const qty = line.quantity.trim();
      const unit = (line.unit || "").trim();
      const desc = line.description.trim();
      if (!desc) return "";
      if (qty && unit) return `${qty} ${unit} ${desc}`;
      if (qty) return `${qty} × ${desc}`;
      return desc;
    })
    .filter(Boolean)
    .join("\n");
}

/** Prefer d/m/yyyy in CSV to match site material-request sheets. */
function formatMaterialRequestDate(value: string) {
  const iso = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${Number(match[3])}/${Number(match[2])}/${match[1]}`;
}

export function materialRequestCsvRows(
  record: ManagerRecord,
  lines?: MaterialRequestLine[],
): { columns: string[]; rows: (string | number)[][] } {
  const project = (record.project || "").trim();
  const contractor = (record.contractor || "").trim();
  const neededBy = formatMaterialRequestDate((record.neededBy || record.date || "").trim());
  const resolved = (lines?.length ? lines : materialRequestLinesFromRecord(record)).filter(
    (line) => line.description.trim() || line.quantity.trim(),
  );
  const columns = [
    "Item",
    "Material Description",
    "Unit",
    "Qty",
    "Project",
    "Contractor",
    "Date Required",
    "Remarks/Status",
  ];
  const rows = (resolved.length ? resolved : [emptyMaterialRequestLine()]).map((line, index) => [
    index + 1,
    line.description,
    line.unit || "pcs",
    line.quantity,
    project,
    contractor,
    neededBy,
    line.remarks,
  ]);
  return { columns, rows };
}

export function exportMaterialRequestCsv(record: ManagerRecord) {
  const { columns, rows } = materialRequestCsvRows(record);
  const ref = (record.reference || record.id || "material-request").trim();
  exportTableCsv({
    title: "Material Request",
    filename: safeFilename(`material-request-${ref}`),
    columns,
    rows,
    meta: [
      record.reference ? `Reference: ${record.reference}` : "",
      record.date ? `Request date: ${record.date}` : "",
      record.status ? `Status: ${record.status}` : "",
    ].filter(Boolean),
  });
}
