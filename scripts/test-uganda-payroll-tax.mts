/** Guards Uganda payroll tax rules that are easy to regress silently. */
import assert from "node:assert/strict";
import { computeUgandaPayslip } from "../src/lib/uganda-payroll.ts";

const roundish = (n: number) => Math.round(n);

const base = { basicPay: 1_200_000, daysInPeriod: 30, daysWorked: 30, advances: 0, asOf: "2026-08-01" };

// Arrears are taxable employment income — PAYE must rise when arrears are paid.
const noArrears = computeUgandaPayslip({ ...base, arrears: 0 });
const withArrears = computeUgandaPayslip({ ...base, arrears: 500_000 });
assert.ok(
  withArrears.paye > noArrears.paye,
  `arrears must be taxed: paye ${withArrears.paye} should exceed ${noArrears.paye}`,
);

// Arrears are contributory for NSSF too (total gross cash emoluments).
assert.equal(withArrears.nssfEmployee, roundish(1_700_000 * 0.05), "NSSF employee = 5% of basic + arrears");
assert.equal(withArrears.nssfEmployer, roundish(1_700_000 * 0.1), "NSSF employer = 10% of basic + arrears");
assert.ok(withArrears.nssfEmployee > noArrears.nssfEmployee, "arrears must raise employee NSSF");
assert.ok(withArrears.nssfEmployer > noArrears.nssfEmployer, "arrears must raise employer NSSF");

// Statutory rates: 5% employee / 10% employer on adjusted basic.
// 1,200,000 / 30 days = 40,000/day exactly, so adjusted basic is the full 1,200,000
// (avoids the whole-shilling proration artifact that a non-divisible basic creates).
assert.equal(noArrears.adjustedBasic, 1_200_000, "adjusted basic should prorate exactly");
assert.equal(noArrears.nssfEmployee, 60_000, "NSSF employee = 5% of 1,200,000");
assert.equal(noArrears.nssfEmployer, 120_000, "NSSF employer = 10% of 1,200,000");

// Arrears still reach the employee: net includes them.
assert.ok(withArrears.netPay > noArrears.netPay, "arrears must increase net pay");

// Date-driven band selection still resolves both schedules.
assert.equal(computeUgandaPayslip({ ...base, arrears: 0, asOf: "2026-08-01" }).payeSchedule, "2026-07");
assert.equal(computeUgandaPayslip({ ...base, arrears: 0, asOf: "2025-08-01" }).payeSchedule, "pre-2026-07");

// PARITY FIXTURES — keep this table identical (same inputs, same expected
// outputs) to the "PARITY FIXTURES" block in backend/internal/httpapi/payroll_test.go
// (TestPayeParityFixtures). PAYE/NSSF logic is duplicated between this file's
// computeUgandaPayslip and the Go computeUgandaPayslip with no shared source
// of truth — this fixture table is the only thing that would catch the two
// drifting apart. If you change either implementation, recompute this table
// and update both files together.
const parityFixtures: Array<{
  name: string;
  basicPay: number;
  daysWorked: number;
  daysInPeriod: number;
  advances: number;
  arrears: number;
  nonResident: boolean;
  asOf: string;
  wantAdjustedBasic: number;
  wantNssfEmployee: number;
  wantNssfEmployer: number;
  wantPaye: number;
  wantNetPay: number;
}> = [
  // A: full month, well into the 40% band — daily-rate rounding drift
  // (2,000,000/30 rounds up) means adjustedBasic is not exactly basicPay.
  {
    name: "A",
    basicPay: 2_000_000,
    daysWorked: 30,
    daysInPeriod: 30,
    advances: 0,
    arrears: 0,
    nonResident: false,
    asOf: "2026-07-01",
    wantAdjustedBasic: 2_000_010,
    wantNssfEmployee: 100_001,
    wantNssfEmployer: 200_001,
    wantPaye: 488_253,
    wantNetPay: 1_411_756,
  },
  // B: below the 30% band.
  {
    name: "B",
    basicPay: 600_000,
    daysWorked: 30,
    daysInPeriod: 30,
    advances: 0,
    arrears: 0,
    nonResident: false,
    asOf: "2026-07-01",
    wantAdjustedBasic: 600_000,
    wantNssfEmployee: 30_000,
    wantNssfEmployer: 60_000,
    wantPaye: 68_250,
    wantNetPay: 501_750,
  },
  // C: part-month proration (20 of 30 days).
  {
    name: "C",
    basicPay: 1_000_000,
    daysWorked: 20,
    daysInPeriod: 30,
    advances: 0,
    arrears: 0,
    nonResident: false,
    asOf: "2026-07-01",
    wantAdjustedBasic: 666_660,
    wantNssfEmployee: 33_333,
    wantNssfEmployer: 66_666,
    wantPaye: 88_248,
    wantNetPay: 545_079,
  },
  // D: arrears are taxable AND NSSF-contributory (NSSF on adjustedBasic+arrears).
  {
    name: "D",
    basicPay: 1_000_000,
    daysWorked: 30,
    daysInPeriod: 30,
    advances: 0,
    arrears: 300_000,
    nonResident: false,
    asOf: "2026-07-01",
    wantAdjustedBasic: 999_990,
    wantNssfEmployee: 65_000,
    wantNssfEmployer: 129_999,
    wantPaye: 278_247,
    wantNetPay: 956_743,
  },
  // E: non-resident — flat 30%, no tax-free band, same basis as F.
  {
    name: "E",
    basicPay: 1_000_000,
    daysWorked: 30,
    daysInPeriod: 30,
    advances: 0,
    arrears: 0,
    nonResident: true,
    asOf: "2026-07-01",
    wantAdjustedBasic: 999_990,
    wantNssfEmployee: 50_000,
    wantNssfEmployer: 99_999,
    wantPaye: 299_997,
    wantNetPay: 649_993,
  },
  // F: same as E but resident and pre-2026-07 schedule (progressive, 10% floor).
  {
    name: "F",
    basicPay: 1_000_000,
    daysWorked: 30,
    daysInPeriod: 30,
    advances: 0,
    arrears: 0,
    nonResident: false,
    asOf: "2026-06-30",
    wantAdjustedBasic: 999_990,
    wantNssfEmployee: 50_000,
    wantNssfEmployer: 99_999,
    wantPaye: 201_997,
    wantNetPay: 747_993,
  },
];

for (const f of parityFixtures) {
  const got = computeUgandaPayslip({
    basicPay: f.basicPay,
    daysWorked: f.daysWorked,
    daysInPeriod: f.daysInPeriod,
    advances: f.advances,
    arrears: f.arrears,
    nonResident: f.nonResident,
    asOf: f.asOf,
  });
  assert.equal(got.adjustedBasic, f.wantAdjustedBasic, `[parity ${f.name}] adjustedBasic`);
  assert.equal(got.nssfEmployee, f.wantNssfEmployee, `[parity ${f.name}] nssfEmployee`);
  assert.equal(got.nssfEmployer, f.wantNssfEmployer, `[parity ${f.name}] nssfEmployer`);
  assert.equal(got.paye, f.wantPaye, `[parity ${f.name}] paye`);
  assert.equal(got.netPay, f.wantNetPay, `[parity ${f.name}] netPay`);
}

console.log("uganda-payroll-tax: ok");
