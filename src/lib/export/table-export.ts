import { downloadBlob, safeFilename } from "@/lib/export/download";
import {
  companyMetaLines,
  drawPdfFooter,
  drawPdfLetterhead,
} from "@/lib/export/letterhead";

function safeSpreadsheetText(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnLetter(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function sheetCell(value: string | number, row: number, column: number, style = 0) {
  const ref = `${columnLetter(column)}${row}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(
    safeSpreadsheetText(String(value)),
  )}</t></is></c>`;
}

export type TableExport = {
  title: string;
  filename?: string;
  columns: string[];
  rows: (string | number)[][];
  meta?: string[];
};

function withCompanyMeta(spec: TableExport): string[] {
  return companyMetaLines([spec.title, ...(spec.meta ?? [])]);
}

/** Thousand separators on PDF cells; keep Excel/CSV numeric for formulas. */
export function formatPdfCell(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  // Already-formatted or non-numeric text (labels, dates, account codes).
  if (/[^0-9.eE+\-\s,]/.test(trimmed) || trimmed.includes(",")) return trimmed;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || trimmed === "") return trimmed;
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function exportTableCsv(spec: TableExport) {
  const escape = (value: string | number) => {
    const text = typeof value === "string" ? safeSpreadsheetText(value) : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [
    ...withCompanyMeta(spec).map((line) => escape(line)),
    "",
    spec.columns.map(escape).join(","),
    ...spec.rows.map((row) => row.map(escape).join(",")),
  ];
  downloadBlob(
    new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" }),
    `${safeFilename(spec.filename || spec.title)}.csv`,
  );
}

export async function exportTableExcel(spec: TableExport) {
  const { strToU8, zipSync } = await import("fflate");
  const headerMeta = withCompanyMeta(spec);
  const data: (string | number)[][] = [
    ...headerMeta.map((line) => [line]),
    [],
    spec.columns,
    ...spec.rows,
  ];
  const headerRowIndex = headerMeta.length + 2;
  const lastRow = data.length;
  const colCount = Math.max(1, spec.columns.length);
  const rowsXml = data
    .map((row, rowIndex) => {
      const style = rowIndex + 1 === headerRowIndex ? 1 : 0;
      return `<row r="${rowIndex + 1}">${row
        .map((value, columnIndex) => sheetCell(value, rowIndex + 1, columnIndex, style))
        .join("")}</row>`;
    })
    .join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRowIndex}" topLeftCell="A${headerRowIndex + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetData>${rowsXml}</sheetData>
  <autoFilter ref="A${headerRowIndex}:${columnLetter(colCount - 1)}${lastRow}"/>
</worksheet>`;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(spec.title.slice(0, 31) || "Report")}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`),
  };

  const zipped = zipSync(files, { level: 6 });
  downloadBlob(
    new Blob([new Uint8Array(zipped).buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `${safeFilename(spec.filename || spec.title)}.xlsx`,
  );
}

export async function exportTablePdf(spec: TableExport) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const landscape = spec.columns.length > 6;
  const doc = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
  });
  const startY = drawPdfLetterhead(doc, {
    title: spec.title,
    subtitle: (spec.meta ?? []).slice(0, 2).join(" · ") || undefined,
  });
  let y = startY;
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  for (const line of (spec.meta ?? []).slice(2)) {
    doc.text(line, 14, y);
    y += 4;
  }
  doc.setTextColor(15, 23, 42);
  autoTable(doc, {
    startY: y + 1,
    head: [spec.columns],
    body: spec.rows.map((row) => row.map((cell) => formatPdfCell(cell))),
    theme: "grid",
    styles: { fontSize: 7, cellPadding: 1.4, overflow: "linebreak" },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
  });
  drawPdfFooter(doc);
  doc.save(`${safeFilename(spec.filename || spec.title)}.pdf`);
}
