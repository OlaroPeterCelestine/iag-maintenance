/**
 * Bank & Cash rollforward math had several bug-fix commits this week
 * (781f3044, 51a71d8e, f9de45ff — stale balances, cross-account merging,
 * transfers missing from the total) with zero test coverage guarding any of
 * it. This locks down the two entry points that compute a bank's balance:
 *
 *   1. `bankAccountActivity` — the running-balance ledger (opening, then each
 *      receipt/payment/transfer in date order, each line carrying the balance
 *      after it). Backs the Bank & Cash activity view and the ledger export.
 *   2. `operationalBankBalance` — the same rollforward collapsed to a single
 *      closing number. Used everywhere a quick balance is needed instead of
 *      the full line-by-line ledger.
 *
 * Both must agree on the closing balance, and both must: include transfers
 * in/out, exclude void/draft records, and never bleed one bank account's
 * activity into another's.
 *
 * Usage: npx tsx scripts/test-bank-ledger-rollforward.mts
 */

import { setMemoryRecords } from "../src/lib/db/client-store.ts";
import {
  bankAccountActivity,
  operationalBankBalance,
} from "../src/lib/banking-summary.ts";
import type { ManagerRecord } from "../src/lib/manager-entities.ts";

if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as { window?: unknown }).window = globalThis;
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function stamp(): Pick<ManagerRecord, "createdAt" | "updatedAt"> {
  return { createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" };
}

const BANK_UGX = "Operations Bank-UGX";
const BANK_USD = "Reserve Bank-USD";

setMemoryRecords("banking", "bank-and-cash-accounts", [
  {
    id: "acct-ugx",
    ...stamp(),
    name: BANK_UGX,
    code: "1050",
    openingBalance: "1000000",
    openingBalanceDate: "2026-08-01",
  } as ManagerRecord,
  {
    id: "acct-usd",
    ...stamp(),
    name: BANK_USD,
    code: "1060",
    openingBalance: "0",
  } as ManagerRecord,
]);

setMemoryRecords("banking", "receipts", [
  {
    id: "rcpt-1",
    ...stamp(),
    date: "2026-08-03",
    account: BANK_UGX,
    amount: "500000",
    status: "Complete",
    reference: "RCPT-1",
  } as ManagerRecord,
  {
    id: "rcpt-void",
    ...stamp(),
    date: "2026-08-03",
    account: BANK_UGX,
    amount: "999999999",
    status: "Void",
    reference: "RCPT-VOID",
  } as ManagerRecord,
  {
    id: "rcpt-other-bank",
    ...stamp(),
    date: "2026-08-03",
    account: BANK_USD,
    amount: "250",
    status: "Complete",
    reference: "RCPT-USD",
  } as ManagerRecord,
]);

setMemoryRecords("banking", "payments", [
  {
    id: "pay-1",
    ...stamp(),
    date: "2026-08-04",
    account: BANK_UGX,
    amount: "200000",
    status: "Complete",
    reference: "PAY-1",
  } as ManagerRecord,
]);

setMemoryRecords("banking", "inter-account-transfers", [
  {
    id: "xfer-1",
    ...stamp(),
    date: "2026-08-05",
    from: BANK_UGX,
    to: BANK_USD,
    amount: "100000",
    status: "Complete",
    reference: "XFER-1",
  } as ManagerRecord,
]);

// Expected UGX rollforward: 1,000,000 opening + 500,000 receipt (the void
// receipt must be excluded) − 200,000 payment − 100,000 transfer out
// = 1,200,000.
const EXPECTED_UGX_CLOSING = 1_200_000;

const activity = bankAccountActivity(BANK_UGX);
check("bankAccountActivity returns activity for the account", Boolean(activity));
if (activity) {
  check(
    "closing balance matches the rollforward",
    activity.closingBalance === EXPECTED_UGX_CLOSING,
    `got ${activity.closingBalance}`,
  );
  check(
    "void receipt excluded from both count and balance",
    activity.receiptCount === 1,
    `receiptCount=${activity.receiptCount}`,
  );
  check("payment counted", activity.paymentCount === 1);
  check("transfer counted", activity.transferCount === 1);
  check(
    "lines sorted by date with opening first",
    activity.lines[0]?.kind === "opening" &&
      activity.lines.every((l, i) => i === 0 || (activity.lines[i - 1].date || "") <= (l.date || "")),
  );
  check(
    "every line's running balance is opening + cumulative in − out up to that line",
    activity.lines.every((line, i) => {
      const cumulative = activity.lines
        .slice(0, i + 1)
        .reduce((sum, l) => sum + l.moneyIn - l.moneyOut, 0);
      return Math.abs(cumulative - line.balance) < 0.01;
    }),
  );
  check(
    "no line from the USD account leaked into the UGX ledger",
    activity.lines.every((l) => l.reference !== "RCPT-USD"),
  );
}

check(
  "operationalBankBalance agrees with bankAccountActivity's closing balance",
  operationalBankBalance(BANK_UGX) === EXPECTED_UGX_CLOSING,
  `got ${operationalBankBalance(BANK_UGX)}`,
);

// USD account: its own 250 receipt plus the 100,000 transfer in — the UGX
// side's void/other noise must not bleed across.
const usdActivity = bankAccountActivity(BANK_USD);
check(
  "transfer-in lands on the receiving account",
  usdActivity?.closingBalance === 100_250,
  `got ${usdActivity?.closingBalance}`,
);
check(
  "USD account's own receipt is counted once, not merged with UGX",
  usdActivity?.receiptCount === 1,
);

check(
  "unknown account name returns no activity rather than throwing",
  bankAccountActivity("Does Not Exist") === null ||
    bankAccountActivity("Does Not Exist")?.lines.length === 0,
);

console.log(
  failures
    ? `\nBank ledger rollforward: ${failures} check(s) FAILED.`
    : "\nAll bank ledger rollforward checks passed.",
);
process.exit(failures ? 1 : 0);
