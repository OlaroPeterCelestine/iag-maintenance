/**
 * One-off sample account ledger PDF for visual review.
 * Run: npx tsx scripts/generate-sample-ledger-pdf.mts
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const outDir = join(process.cwd(), "tmp");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, "sample-account-ledger.pdf");

const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
const pageW = doc.internal.pageSize.getWidth();

doc.setFillColor(15, 23, 42);
doc.rect(0, 0, pageW, 28, "F");
doc.setTextColor(255, 255, 255);
doc.setFontSize(14);
doc.setFont("helvetica", "bold");
doc.text("Inspire Africa Group", 14, 12);
doc.setFontSize(9);
doc.setFont("helvetica", "normal");
doc.text("Plot 54 Mwafu Road, Ntinda, Kampala, Uganda", 14, 18);
doc.text("UGX · Sample ledger PDF", 14, 23);

doc.setTextColor(15, 23, 42);
doc.setFontSize(13);
doc.setFont("helvetica", "bold");
doc.text("Account ledger — 1200 Accounts Receivable-UGX", 14, 40);

doc.setFontSize(9);
doc.setFont("helvetica", "normal");
doc.setTextColor(71, 85, 105);
doc.text(
  "As of 2026-08-06 · Type: Asset · 8 lines · Closing balance: USh 4,850,000",
  14,
  47,
);

const rows = [
  ["2026-07-02", "Opening balance", "Journal: JE-001", "2,000,000", "", "2,000,000"],
  ["2026-07-05", "Invoice INV-1042 — Acme Traders", "Sales invoices: INV-1042", "1,800,000", "", "3,800,000"],
  ["2026-07-08", "Invoice INV-1048 — Nile Coffee", "Sales invoices: INV-1048", "950,000", "", "4,750,000"],
  ["2026-07-12", "Receipt REC-221 — Acme Traders", "Receipts: REC-221", "", "1,200,000", "3,550,000"],
  ["2026-07-18", "Invoice INV-1055 — Green Farms", "Sales invoices: INV-1055", "2,100,000", "", "5,650,000"],
  ["2026-07-22", "Credit note CN-019 — Nile Coffee", "Credit notes: CN-019", "", "300,000", "5,350,000"],
  ["2026-07-28", "Receipt REC-238 — Green Farms", "Receipts: REC-238", "", "800,000", "4,550,000"],
  ["2026-08-01", "Invoice INV-1061 — Acme Traders", "Sales invoices: INV-1061", "300,000", "", "4,850,000"],
  ["", "Closing balance", "", "", "", "4,850,000"],
];

autoTable(doc, {
  startY: 52,
  head: [["Date", "Narration", "Origin", "Debit", "Credit", "Balance"]],
  body: rows,
  theme: "grid",
  styles: {
    fontSize: 7.5,
    cellPadding: 1.6,
    overflow: "linebreak",
    textColor: [15, 23, 42],
  },
  headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
  columnStyles: {
    0: { cellWidth: 22 },
    3: { halign: "right" },
    4: { halign: "right" },
    5: { halign: "right", fontStyle: "bold" },
  },
  didParseCell: (data) => {
    if (data.section === "body" && data.row.index === rows.length - 1) {
      data.cell.styles.fontStyle = "bold";
      data.cell.styles.fillColor = [248, 250, 252];
    }
  },
});

const pageCount = doc.getNumberOfPages();
for (let i = 1; i <= pageCount; i++) {
  doc.setPage(i);
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Page ${i} of ${pageCount} · Generated ${new Date().toISOString().slice(0, 10)} · Sample only`,
    14,
    doc.internal.pageSize.getHeight() - 8,
  );
}

writeFileSync(out, Buffer.from(doc.output("arraybuffer")));
console.log(`Wrote ${out}`);
