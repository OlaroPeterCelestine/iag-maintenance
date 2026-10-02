/**
 * Record tables must not search through attachment payloads.
 *
 * Attachments are stored on the record as JSON base64 data URLs (~8 MB cap per
 * record). The table filter used to match against
 * `Object.values(record).join(" ")`, so every keystroke lower-cased and
 * concatenated every payload on the page — which is what froze Purchases →
 * Purchase invoices ("Page Unresponsive") once invoices had scans attached.
 *
 * Guards that the payloads stay out of the index, that ordinary fields are
 * still searchable, and that filtering a loaded page stays fast.
 *
 * Usage: npx tsx scripts/test-record-search-index.mts
 */

import {
  attachmentFieldKeys,
  buildRecordSearchIndex,
  recordSearchText,
} from "../src/lib/record-search.ts";
import type { EntityDefinition, ManagerRecord } from "../src/lib/manager-entities.ts";

const ROWS = 90;
/** ~1.5 MB of base64 per record — one scanned invoice, well under the 8 MB cap. */
const ATTACHMENT_CHARS = 1_500_000;
/** Index build budget for a full page of records carrying attachments. */
const MAX_INDEX_MS = 250;
/** A keystroke may not cost more than this across the whole page. */
const MAX_FILTER_MS = 25;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const definition = {
  key: "purchase-invoices",
  label: "Purchase Invoices",
  singular: "Purchase Invoice",
  columns: ["reference", "date", "party", "amount", "status"],
  fields: [
    { key: "reference", label: "Reference", type: "text" },
    { key: "party", label: "Supplier", type: "text" },
    { key: "amount", label: "Total amount", type: "number" },
    { key: "notes", label: "Notes", type: "textarea" },
    { key: "attachments", label: "Attachments", type: "attachments" },
  ],
} as unknown as EntityDefinition;

const base64 = "JVBERi0xLjQKJeLjz9M".repeat(Math.ceil(ATTACHMENT_CHARS / 19)).slice(0, ATTACHMENT_CHARS);

function makeRows(): ManagerRecord[] {
  const rows: ManagerRecord[] = [];
  for (let i = 0; i < ROWS; i += 1) {
    rows.push({
      id: `inv-${i}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      reference: `PINV-${1000 + i}`,
      party: i % 2 === 0 ? "Kampala Hardware Ltd" : "Nakato Trading",
      amount: String(100_000 + i),
      notes: "Delivered to the Jinja site store",
      status: "Active",
      attachments: JSON.stringify([
        {
          id: `att-${i}`,
          name: `invoice-${i}.pdf`,
          mime: "application/pdf",
          size: ATTACHMENT_CHARS,
          dataUrl: `data:application/pdf;base64,${base64}`,
          uploadedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    });
  }
  return rows;
}

const rows = makeRows();
const payloadMb = (rows.length * ATTACHMENT_CHARS) / 1024 / 1024;
console.log(
  `Record search index (${ROWS} rows, ${payloadMb.toFixed(0)} MB of attachment payload)`,
);

const skipKeys = attachmentFieldKeys(definition);
check("attachment fields are identified by type", skipKeys.has("attachments"), [...skipKeys].join(","));

const indexStart = performance.now();
const index = buildRecordSearchIndex(rows, skipKeys);
const indexMs = performance.now() - indexStart;

check("every row is indexed", index.size === rows.length, `${index.size} entries`);
check(
  "index build stays within budget",
  indexMs < MAX_INDEX_MS,
  `${indexMs.toFixed(1)}ms (budget ${MAX_INDEX_MS}ms)`,
);

const indexedChars = [...index.values()].reduce((sum, text) => sum + text.length, 0);
check(
  "payloads are not in the index",
  indexedChars < ROWS * 1_000,
  `${indexedChars} chars indexed vs ${(ROWS * ATTACHMENT_CHARS).toLocaleString()} of payload`,
);
check(
  "no indexed row contains base64 payload",
  ![...index.values()].some((text) => text.includes("jvberi")),
  "",
);

// Ordinary fields must still match, or this "fix" would just break search.
const filterStart = performance.now();
const hits = rows.filter((row) => (index.get(row.id) ?? "").includes("nakato"));
const filterMs = performance.now() - filterStart;
check("supplier name is still searchable", hits.length === ROWS / 2, `${hits.length} matches`);
check(
  "reference is still searchable",
  rows.filter((row) => (index.get(row.id) ?? "").includes("pinv-1005")).length === 1,
);
check(
  "long notes are still searchable",
  rows.filter((row) => (index.get(row.id) ?? "").includes("jinja")).length === ROWS,
);
check(
  "a keystroke filters the page within budget",
  filterMs < MAX_FILTER_MS,
  `${filterMs.toFixed(2)}ms (budget ${MAX_FILTER_MS}ms)`,
);

// The old behaviour, for the record: what one keystroke used to cost.
const oldStart = performance.now();
for (const row of rows) {
  const haystack = Object.values(row)
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  haystack.includes("nakato");
}
const oldMs = performance.now() - oldStart;
check(
  "old per-keystroke rebuild is measurably worse (the regression this guards)",
  oldMs > filterMs * 10,
  `old ${oldMs.toFixed(0)}ms vs indexed ${filterMs.toFixed(2)}ms ` +
    `(${(oldMs / Math.max(filterMs, 0.001)).toFixed(0)}× slower)`,
);

// A record whose blob sits under an untyped key must still be excluded.
const legacy: ManagerRecord = {
  id: "legacy-1",
  createdAt: "",
  updatedAt: "",
  reference: "PINV-9999",
  scan: `data:application/pdf;base64,${base64}`,
};
const legacyText = recordSearchText(legacy);
check(
  "an untyped data-URL field is excluded too",
  legacyText.includes("pinv-9999") && !legacyText.includes("jvberi"),
  `${legacyText.length} chars`,
);

console.log("");
if (failures) {
  console.error(`${failures} record search check(s) failed.`);
  process.exit(1);
}
console.log("All record search index checks passed.");
