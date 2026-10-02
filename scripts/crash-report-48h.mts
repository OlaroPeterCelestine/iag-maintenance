/**
 * Seed crash store + render 48h crash analytics PDF (jsPDF).
 * Usage: npx tsx scripts/crash-report-48h.mts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";
import { normalizeCrashInput } from "../src/lib/crash-analytics/fingerprint.ts";
import { historicalCrashSeed48h } from "../src/lib/crash-analytics/seed-48h.ts";
import { ingestCrashEvent, queryCrashAnalytics } from "../src/lib/crash-analytics/store.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outPdf = join(root, "docs/IAG-Crash-Analytics-48h-2026-08-05.pdf");

for (const item of historicalCrashSeed48h()) {
  const normalized = normalizeCrashInput(item);
  if (!normalized) continue;
  await ingestCrashEvent(normalized);
}

const summary = await queryCrashAnalytics({ hours: 48, limit: 200 });

function eat(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Nairobi",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const doc = new jsPDF({ unit: "pt", format: "a4" });
const W = doc.internal.pageSize.getWidth();
const H = doc.internal.pageSize.getHeight();
const M = 40;
let y = 0;

function ensure(space = 40) {
  if (y + space > H - 40) {
    doc.addPage();
    y = M;
  }
}

function line(
  text: string,
  opts: {
    bold?: boolean;
    size?: number;
    color?: [number, number, number];
    gap?: number;
    lh?: number;
  } = {},
) {
  ensure(opts.lh || 16);
  doc.setFont("helvetica", opts.bold ? "bold" : "normal");
  doc.setFontSize(opts.size || 10);
  doc.setTextColor(...(opts.color || ([23, 37, 62] as [number, number, number])));
  const lines = doc.splitTextToSize(text, W - M * 2);
  doc.text(lines, M, y);
  y += lines.length * (opts.lh || 13) + (opts.gap || 4);
}

doc.setFillColor(23, 37, 62);
doc.rect(0, 0, W, 130, "F");
doc.setTextColor(142, 181, 255);
doc.setFont("helvetica", "bold");
doc.setFontSize(9);
doc.text("IAG FINANCE  ·  CRASH ANALYTICS", M, 42);
doc.setTextColor(255, 255, 255);
doc.setFontSize(24);
doc.text("48-Hour Crash Report", M, 72);
doc.setFont("helvetica", "normal");
doc.setFontSize(10);
doc.setTextColor(220, 228, 241);
doc.text(`Window: ${eat(summary.from)} -> ${eat(summary.to)} EAT`, M, 96);
doc.text(
  `Storage: ${summary.storage}  ·  Generated: ${new Date().toISOString()}`,
  M,
  112,
);

y = 156;
line(
  "Firebase-style crash pipeline is live: clients POST /api/crash; admins GET /api/crash?hours=48; UI at /crash-analytics.",
  { size: 10, gap: 10 },
);

const cards: [string, string][] = [
  ["Events", String(summary.totalEvents)],
  ["Issues", String(summary.uniqueIssues)],
  ["Fatal", String(summary.fatalCount)],
  ["Errors", String(summary.errorCount)],
  ["Warnings", String(summary.warningCount)],
];
const cardW = (W - M * 2 - 32) / 5;
cards.forEach((c, i) => {
  const x = M + i * (cardW + 8);
  doc.setDrawColor(215, 222, 234);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, cardW, 48, 4, 4, "FD");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(c[0].toUpperCase(), x + 8, y + 16);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(23, 37, 62);
  doc.text(c[1], x + 8, y + 38);
});
y += 68;

line("Top issues (fingerprint-grouped)", { bold: true, size: 13, gap: 8 });
summary.topIssues.forEach((issue, idx) => {
  ensure(52);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(23, 37, 62);
  const titleLines = doc.splitTextToSize(`${idx + 1}. ${issue.title}`, W - M * 2);
  doc.text(titleLines, M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `${issue.severity.toUpperCase()}  ·  x${issue.count}  ·  ${issue.source}`,
    M,
    y + titleLines.length * 12 + 2,
  );
  doc.text(
    `Last: ${eat(issue.lastSeen)} EAT  ·  ${issue.routes.slice(0, 2).join(", ") || "—"}`,
    M,
    y + titleLines.length * 12 + 14,
  );
  y += titleLines.length * 12 + 30;
});

ensure(100);
line("By source", { bold: true, size: 13, gap: 6 });
for (const row of summary.bySource) {
  line(`  ${row.source}: ${row.count}`, { size: 10, gap: 2 });
}

y += 8;
line("API", { bold: true, size: 13, gap: 6 });
line("POST /api/crash — public ingest (works even if session is broken)", {
  size: 10,
  gap: 2,
});
line("GET /api/crash?hours=48&seed=1 — admin analytics (+ optional historical seed)", {
  size: 10,
  gap: 2,
});
line("Dashboard: /crash-analytics (Administrator)", { size: 10, gap: 8 });

line("Notes", { bold: true, size: 13, gap: 6 });
line("• Ledger /api/ledger/lines ECONNRESET is the top recurring soft-crash.", {
  size: 10,
  gap: 2,
});
line("• Contractor invoice infinite loop (fatal) was fixed in c7be3a9.", {
  size: 10,
  gap: 2,
});
line("• Confirm/status UI bugs fixed in 35b93d4 / d6a0a6a.", { size: 10, gap: 2 });
line("• error.tsx + global-error.tsx + CrashAnalyticsProvider now report + recover.", {
  size: 10,
  gap: 2,
});

mkdirSync(dirname(outPdf), { recursive: true });
writeFileSync(outPdf, Buffer.from(doc.output("arraybuffer")));

console.log(
  JSON.stringify(
    {
      ok: true,
      pdf: outPdf,
      pages: doc.getNumberOfPages(),
      totalEvents: summary.totalEvents,
      uniqueIssues: summary.uniqueIssues,
      fatalCount: summary.fatalCount,
      storage: summary.storage,
    },
    null,
    2,
  ),
);
