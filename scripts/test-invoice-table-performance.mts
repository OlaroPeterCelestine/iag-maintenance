/**
 * Invoice tables must not rescan every payment for every row.
 *
 * Purchases → Purchase invoices froze the tab ("Page Unresponsive") because the
 * row renderer called `documentOpenBalance` per row, and that helper rebuilds
 * the whole paid map — every receipt, payment and WHT record, re-parsing every
 * allocation — to answer for a single document. On an 89-row page against a few
 * thousand payments that is hundreds of thousands of allocation parses per
 * render pass.
 *
 * This guards both halves of the fix:
 *   1. `enrichedOpenBalance` returns exactly what `documentOpenBalance` does.
 *   2. Reading it for every row stays flat as the payment ledger grows.
 *
 * Usage: npx tsx scripts/test-invoice-table-performance.mts
 */

import { setMemoryRecords } from "../src/lib/db/client-store.ts";
import {
  documentOpenBalance,
  enrichDocumentsWithPaidBalances,
  enrichedOpenBalance,
} from "../src/lib/ar-ap.ts";
import type { ManagerRecord } from "../src/lib/manager-entities.ts";

// `loadRecords` short-circuits to [] outside a browser, so the in-memory store
// needs a window for this test to exercise anything at all.
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as { window?: unknown }).window = globalThis;
}

const INVOICES = 120;
const PAYMENTS = 4_000;
/** Row reads must stay within this multiple of a single enrichment pass. */
const MAX_ROW_READ_RATIO = 0.5;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function makeInvoices(): ManagerRecord[] {
  const rows: ManagerRecord[] = [];
  for (let i = 0; i < INVOICES; i += 1) {
    rows.push({
      id: `inv-${i}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      reference: `PINV-${1000 + i}`,
      party: `Supplier ${i % 20}`,
      date: "2026-01-05",
      amount: String(100_000 + i * 137),
      status: "Active",
    });
  }
  return rows;
}

/** Half the payments allocate to an invoice; the rest are noise, as in real data. */
function makePayments(): ManagerRecord[] {
  const rows: ManagerRecord[] = [];
  for (let i = 0; i < PAYMENTS; i += 1) {
    const target = i % INVOICES;
    const allocates = i % 2 === 0;
    rows.push({
      id: `pay-${i}`,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      date: "2026-01-10",
      amount: "500",
      status: "Active",
      ...(allocates
        ? {
            allocations: JSON.stringify([
              { document: `PINV-${1000 + target}`, amount: 500 },
            ]),
          }
        : { appliedTo: "" }),
    });
  }
  return rows;
}

const invoices = makeInvoices();
setMemoryRecords("purchases", "purchase-invoices", invoices);
setMemoryRecords("banking", "payments", makePayments());
setMemoryRecords("purchases", "withholding-tax", []);

console.log(`Invoice table performance (${INVOICES} invoices, ${PAYMENTS} payments)`);

// --- 1. same answer -----------------------------------------------------------
const enrichStart = performance.now();
const enriched = enrichDocumentsWithPaidBalances(invoices, "payable");
const enrichMs = performance.now() - enrichStart;

let mismatches = 0;
for (const row of enriched) {
  const viaEnriched = enrichedOpenBalance(row);
  const viaFullScan = documentOpenBalance(row, "payable");
  if (Math.abs(viaEnriched - viaFullScan) > 0.005) mismatches += 1;
}
check(
  "enrichedOpenBalance agrees with documentOpenBalance for every row",
  mismatches === 0,
  mismatches ? `${mismatches} row(s) differ` : `${enriched.length} rows`,
);

// A row that was actually paid must not read as fully open, or the guard this
// protects ("hide Pay bill when nothing is due") would be meaningless.
const paidSomething = enriched.filter((r) => Number(r.amountPaid) > 0);
check(
  "allocated payments reduce the open balance",
  paidSomething.length > 0 && paidSomething.every((r) => enrichedOpenBalance(r) < Number(r.amount)),
  `${paidSomething.length} row(s) carry a payment`,
);

// --- 2. stays flat ------------------------------------------------------------
const rowReadStart = performance.now();
let openRows = 0;
for (const row of enriched) {
  if (enrichedOpenBalance(row) > 0) openRows += 1;
}
const rowReadMs = performance.now() - rowReadStart;

const oldStart = performance.now();
for (const row of enriched) documentOpenBalance(row, "payable");
const oldMs = performance.now() - oldStart;

check(
  "reading every row costs less than one enrichment pass",
  rowReadMs < enrichMs * MAX_ROW_READ_RATIO || rowReadMs < 1,
  `rows ${rowReadMs.toFixed(2)}ms vs enrich ${enrichMs.toFixed(2)}ms`,
);
check(
  "per-row rescan is measurably worse (the regression this guards)",
  oldMs > rowReadMs * 10,
  `per-row rescan ${oldMs.toFixed(1)}ms vs enriched read ${rowReadMs.toFixed(2)}ms ` +
    `(${(oldMs / Math.max(rowReadMs, 0.001)).toFixed(0)}× slower)`,
);
check("open rows counted", openRows > 0, `${openRows} of ${enriched.length} still owe money`);

console.log("");
if (failures) {
  console.error(`${failures} invoice table performance check(s) failed.`);
  process.exit(1);
}
console.log("All invoice table performance checks passed.");
