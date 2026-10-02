import { downloadBlob } from "@/lib/export/download";
import { companyMetaLines } from "@/lib/export/letterhead";
import { formatPdfCell } from "@/lib/export/table-export";

export type PayrollExportRow = {
  name: string;
  employeeId: string;
  department: string;
  bank: string;
  bankCode: string;
  accountNumber: string;
  phone: string;
  basicPay: number;
  dailyRate: number;
  daysWorked: number;
  adjustedBasic: number;
  nssf: number;
  paye: number;
  advances: number;
  arrears: number;
  netPay: number;
};

const HEADERS = [
  "Name",
  "ID",
  "Department",
  "Bank",
  "Bank code",
  "Account number",
  "Phone number",
  "Basic pay",
  "Daily rate",
  "Days worked",
  "Adjusted basic",
  "NSSF",
  "PAYE",
  "Advances",
  "Arrears",
  "Net pay",
] as const;

function rowValues(row: PayrollExportRow): (string | number)[] {
  return [
    row.name,
    row.employeeId,
    row.department,
    row.bank,
    row.bankCode,
    row.accountNumber,
    row.phone,
    row.basicPay,
    row.dailyRate,
    row.daysWorked,
    row.adjustedBasic,
    row.nssf,
    row.paye,
    row.advances,
    row.arrears,
    row.netPay,
  ];
}

function totals(rows: PayrollExportRow[]): (string | number)[] {
  const sum = (field: keyof PayrollExportRow) =>
    rows.reduce((total, row) => total + Number(row[field] || 0), 0);
  return [
    "TOTAL",
    "",
    "",
    "",
    "",
    "",
    "",
    sum("basicPay"),
    "",
    "",
    sum("adjustedBasic"),
    sum("nssf"),
    sum("paye"),
    sum("advances"),
    sum("arrears"),
    sum("netPay"),
  ];
}

function filename(payDate: string, extension: string) {
  return `payroll-${payDate || "export"}.${extension}`;
}

function safeSpreadsheetText(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number) {
  const text = typeof value === "string" ? safeSpreadsheetText(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function exportPayrollCsv(rows: PayrollExportRow[], payDate: string) {
  const lines = [
    ...companyMetaLines([`Final payroll · Pay date: ${payDate}`]).map(csvCell),
    "",
    HEADERS.map(csvCell).join(","),
    ...rows.map((row) => rowValues(row).map(csvCell).join(",")),
    totals(rows).map(csvCell).join(","),
  ];
  downloadBlob(
    new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" }),
    filename(payDate, "csv"),
  );
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

/**
 * Creates a standards-compliant XLSX workbook without accepting spreadsheet
 * input files. This avoids the vulnerable SheetJS parser dependency.
 */
export async function exportPayrollExcel(rows: PayrollExportRow[], payDate: string) {
  const { strToU8, zipSync } = await import("fflate");
  const headerMeta = companyMetaLines([`Final payroll · Pay date: ${payDate}`]);
  const data: (string | number)[][] = [
    ...headerMeta.map((line) => [line]),
    [],
    HEADERS as unknown as (string | number)[],
    ...rows.map(rowValues),
    totals(rows),
  ];
  const headerRowIndex = headerMeta.length + 2;
  const lastRow = data.length;
  const rowsXml = data
    .map((row, rowIndex) => {
      const style =
        rowIndex + 1 === headerRowIndex ? 1 : rowIndex === lastRow - 1 ? 2 : 0;
      return `<row r="${rowIndex + 1}">${row
        .map((value, columnIndex) => sheetCell(value, rowIndex + 1, columnIndex, style))
        .join("")}</row>`;
    })
    .join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRowIndex}" topLeftCell="A${headerRowIndex + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="4" width="20" customWidth="1"/><col min="5" max="7" width="16" customWidth="1"/>
    <col min="8" max="16" width="15" customWidth="1"/>
  </cols>
  <sheetData>${rowsXml}</sheetData>
  <autoFilter ref="A${headerRowIndex}:P${lastRow}"/>
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
  <sheets><sheet name="Payroll" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
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
  <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment horizontal="right"/></xf></cellXfs>
</styleSheet>`),
  };

  const zipped = zipSync(files, { level: 6 });
  const bytes = new Uint8Array(zipped);
  downloadBlob(
    new Blob([bytes.buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename(payDate, "xlsx"),
  );
}

export async function exportPayrollPdf(rows: PayrollExportRow[], payDate: string) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const { drawPdfFooter, drawPdfLetterhead, getCompanyLetterhead } = await import(
    "@/lib/export/letterhead"
  );
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const company = getCompanyLetterhead();
  const startY = drawPdfLetterhead(doc, {
    title: "Final payroll",
    subtitle: `Pay date: ${payDate} · ${company.currency}`,
  });

  autoTable(doc, {
    startY,
    head: [[...HEADERS]],
    body: [...rows.map(rowValues), totals(rows)].map((row) =>
      row.map((cell) => formatPdfCell(cell)),
    ),
    theme: "grid",
    styles: { fontSize: 6.5, cellPadding: 1.5, overflow: "linebreak" },
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index === rows.length) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [241, 245, 249];
      }
    },
  });
  drawPdfFooter(doc);
  doc.save(filename(payDate, "pdf"));
}
