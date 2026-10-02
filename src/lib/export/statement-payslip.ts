import { downloadBlob, safeFilename } from "@/lib/export/download";
import {
  drawPdfFooter,
  drawPdfLetterhead,
  getCompanyLetterhead,
} from "@/lib/export/letterhead";
import { exportTablePdf, formatPdfCell } from "@/lib/export/table-export";
import type { PartyStatement } from "@/lib/ar-ap";
import { statementHasContent } from "@/lib/ar-ap";
import { formatMoney } from "@/lib/ledger/money";
import { statementPeriodLabel } from "@/lib/statement-period";

export function statementExportMeta(statement: PartyStatement): string[] {
  return [
    statement.from
      ? `Period ${statement.from} – ${statement.asOf}`
      : `As of ${statement.asOf}`,
    `Opening: ${formatMoney(statement.opening)}`,
    `Closing balance: ${formatMoney(statement.closing)}`,
  ];
}

export function statementExportRows(statement: PartyStatement): (string | number)[][] {
  const rows: (string | number)[][] = [];
  if (statement.from) {
    rows.push(["", "", "Opening balance", "", "", statement.opening]);
  }
  for (const line of statement.lines) {
    rows.push([
      line.date || "",
      line.reference || "",
      line.description || "",
      line.debit ? line.debit : "",
      line.credit ? line.credit : "",
      line.balance,
    ]);
  }
  rows.push(["", "", "Closing balance", "", "", statement.closing]);
  return rows;
}

function statementFilename(statement: PartyStatement): string {
  const span = statement.from ? `${statement.from}-${statement.asOf}` : statement.asOf;
  return `statement-${safeFilename(statement.party)}-${span}`;
}

export async function exportStatementPdf(statement: PartyStatement) {
  await exportTablePdf({
    title: `Statement — ${statement.party}`,
    filename: statementFilename(statement),
    meta: statementExportMeta(statement),
    columns: ["Date", "Reference", "Description", "Debit", "Credit", "Balance"],
    rows: statementExportRows(statement),
  });
}

async function loadAutoTable() {
  const mod = (await import("jspdf-autotable")) as {
    default?: (doc: unknown, opts: unknown) => void;
    autoTable?: (doc: unknown, opts: unknown) => void;
  };
  const autoTable = mod.default || mod.autoTable;
  if (typeof autoTable !== "function") {
    throw new Error("PDF table library failed to load.");
  }
  return autoTable;
}

/** One PDF with a statement page per party for the selected period. */
export async function exportPartyPeriodLedgersPdf(opts: {
  title: string;
  filename: string;
  periodLabel: string;
  statements: PartyStatement[];
}) {
  const withContent = opts.statements.filter((statement) => statementHasContent(statement));
  if (!withContent.length) return;
  if (withContent.length === 1) {
    await exportStatementPdf(withContent[0]!);
    return;
  }

  const [{ jsPDF }, autoTable] = await Promise.all([import("jspdf"), loadAutoTable()]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const columns = ["Date", "Reference", "Description", "Debit", "Credit", "Balance"];

  for (let index = 0; index < withContent.length; index += 1) {
    const statement = withContent[index]!;
    if (index > 0) doc.addPage();
    let y = drawPdfLetterhead(doc, {
      title: `${opts.title} — ${statement.party}`,
      subtitle: opts.periodLabel || statementPeriodLabel(statement.from, statement.asOf),
    });
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    for (const line of statementExportMeta(statement).slice(1)) {
      doc.text(line, 14, y);
      y += 4;
    }
    doc.setTextColor(15, 23, 42);
    autoTable(doc, {
      startY: y + 1,
      head: [columns],
      body: statementExportRows(statement).map((row) => row.map((cell) => formatPdfCell(cell))),
      theme: "grid",
      styles: { fontSize: 7, cellPadding: 1.4, overflow: "linebreak" },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
    });
    drawPdfFooter(doc);
  }

  downloadBlob(doc.output("blob"), `${safeFilename(opts.filename)}.pdf`);
}

export async function exportPayslipPdf(record: {
  reference?: string;
  employee?: string;
  date?: string;
  basicPay?: string | number;
  daysWorked?: string | number;
  adjustedBasic?: string | number;
  nssf?: string | number;
  paye?: string | number;
  advances?: string | number;
  arrears?: string | number;
  netPay?: string | number;
  bankAccount?: string;
  accountNumber?: string;
  department?: string;
}) {
  const company = getCompanyLetterhead();
  const [{ jsPDF }] = await Promise.all([import("jspdf")]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const money = (n: string | number | undefined) =>
    `${company.currency} ${Number(n || 0).toLocaleString("en-US", {
      maximumFractionDigits: 6,
    })}`;

  let y = drawPdfLetterhead(doc, {
    title: "Payslip",
    subtitle: record.date ? `Pay date ${record.date}` : undefined,
  });

  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Employee: ${record.employee || "—"}`, 14, y);
  y += 6;
  doc.text(`Reference: ${record.reference || "—"}`, 14, y);
  y += 6;
  if (record.department) {
    doc.text(`Department: ${record.department}`, 14, y);
    y += 6;
  }
  if (record.bankAccount) {
    doc.text(`Bank: ${record.bankAccount} · ${record.accountNumber || ""}`, 14, y);
    y += 6;
  }

  const rows: [string, string][] = [
    ["Basic pay", money(record.basicPay)],
    ["Days worked", String(record.daysWorked ?? "—")],
    ["Adjusted basic", money(record.adjustedBasic)],
    ["NSSF (employee)", money(record.nssf)],
    ["PAYE", money(record.paye)],
    ["Advances", money(record.advances)],
    ["Arrears", money(record.arrears)],
    ["Net pay", money(record.netPay)],
  ];

  y += 4;
  for (const [label, value] of rows) {
    doc.setDrawColor(226, 232, 240);
    doc.line(14, y + 2, 196, y + 2);
    doc.text(label, 14, y);
    doc.text(value, 196, y, { align: "right" });
    y += 8;
  }

  drawPdfFooter(doc);
  const blob = doc.output("blob");
  downloadBlob(
    blob,
    `${safeFilename(`payslip-${record.employee || record.reference || "export"}`)}.pdf`,
  );
  return blob;
}
