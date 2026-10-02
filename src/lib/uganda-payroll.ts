/**
 * Uganda payroll matching the standard sheet:
 *   Daily rate = Basic ÷ 30
 *   Adjusted basic = Daily rate × Days worked
 *   NSSF 5% employee / 10% employer on adjusted basic + arrears
 *   PAYE on adjusted basic + arrears (URA bands; employee NSSF not deductible)
 *   Net = Adjusted basic − NSSF − PAYE − Advances + Arrears
 *
 * PAYE bands follow the Income Tax (Amendment) Act 2026 / Schedule 4,
 * effective 1 July 2026 (FY 2026/27). Earlier pay dates use the prior schedule.
 */

import { parseAmount, roundMoney } from "@/lib/ledger/types";

/** Calendar days used for daily rate (BASIC ÷ 30). */
export const DEFAULT_PAY_DAYS = 30;

export const NSSF_EMPLOYEE_RATE = 0.05;
export const NSSF_EMPLOYER_RATE = 0.1;

/** First day the FY 2026/27 PAYE schedule applies. */
export const URA_PAYE_2026_EFFECTIVE_FROM = "2026-07-01";

export type PayeBand = {
  upTo: number;
  rate: number;
  baseTax: number;
  excessOver: number;
};

/**
 * Resident monthly PAYE — Income Tax (Amendment) Act 2026,
 * in force from 1 July 2026.
 *
 * Monthly: 0–335k nil; 335k–410k @20%; 410k–485k @25%; 485k–10m @30%; above 10m @40%.
 * Annual Schedule 4: nil to 4.02m; then 20% / 180k+25% / 405k+30% / +10% surcharge over 120m.
 */
export const URA_RESIDENT_MONTHLY_BANDS: PayeBand[] = [
  { upTo: 335_000, rate: 0, baseTax: 0, excessOver: 0 },
  { upTo: 410_000, rate: 0.2, baseTax: 0, excessOver: 335_000 },
  { upTo: 485_000, rate: 0.25, baseTax: 15_000, excessOver: 410_000 },
  { upTo: 10_000_000, rate: 0.3, baseTax: 33_750, excessOver: 485_000 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.4, baseTax: 2_888_250, excessOver: 10_000_000 },
];

/** Resident monthly PAYE in force until 30 June 2026. */
export const URA_RESIDENT_MONTHLY_BANDS_PRE_2026_07: PayeBand[] = [
  { upTo: 235_000, rate: 0, baseTax: 0, excessOver: 0 },
  { upTo: 335_000, rate: 0.1, baseTax: 0, excessOver: 235_000 },
  { upTo: 410_000, rate: 0.2, baseTax: 10_000, excessOver: 335_000 },
  { upTo: 10_000_000, rate: 0.3, baseTax: 25_000, excessOver: 410_000 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.4, baseTax: 2_902_000, excessOver: 10_000_000 },
];

export type PayrollInput = {
  /** Contracted monthly basic pay. */
  basicPay: number;
  /** Days the employee actually worked. */
  daysWorked: number;
  /** Divisor for daily rate (always 30 on the sheet). */
  daysInPeriod?: number;
  /** Salary advance recovered this period. */
  advances?: number;
  /** Arrears / back-pay added this period. */
  arrears?: number;
  nonResident?: boolean;
  /** Pay date (YYYY-MM-DD) — selects the URA schedule in force. */
  asOf?: string;
};

export type PayrollResult = {
  basicPay: number;
  daysWorked: number;
  daysInPeriod: number;
  /** BASIC ÷ 30 */
  dailyRate: number;
  /** Daily rate × days worked */
  adjustedBasic: number;
  /** Alias of adjustedBasic (gross for the period before arrears). */
  gross: number;
  paye: number;
  nssfEmployee: number;
  nssfEmployer: number;
  advances: number;
  arrears: number;
  /** NSSF employee + PAYE + advances */
  totalDeductions: number;
  /** Adjusted basic − NSSF − PAYE − Advances + Arrears */
  netPay: number;
  employerCost: number;
  effectiveRate: number;
  /** Which URA schedule was applied. */
  payeSchedule: "2026-07" | "pre-2026-07";
};

function usesPaye2026Schedule(asOf?: string): boolean {
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    // Default to current law when no pay date is supplied.
    return true;
  }
  return asOf >= URA_PAYE_2026_EFFECTIVE_FROM;
}

export function residentPayeBands(asOf?: string): PayeBand[] {
  return usesPaye2026Schedule(asOf)
    ? URA_RESIDENT_MONTHLY_BANDS
    : URA_RESIDENT_MONTHLY_BANDS_PRE_2026_07;
}

/** Non-resident PAYE until 30 June 2026 (progressive Part II schedule). */
export function computePayeNonResidentPre202607(taxableIncome: number): number {
  const ti = Math.max(0, taxableIncome);
  if (ti <= 335_000) return roundMoney(ti * 0.1);
  if (ti <= 410_000) return roundMoney((ti - 335_000) * 0.2 + 33_500);
  if (ti <= 10_000_000) return roundMoney((ti - 410_000) * 0.3 + 48_500);
  return roundMoney((ti - 410_000) * 0.3 + 48_500 + (ti - 10_000_000) * 0.1);
}

/**
 * Non-resident employment income from 1 July 2026:
 * flat 30% final withholding (no tax-free band).
 */
export function computePayeNonResident202607(taxableIncome: number): number {
  return roundMoney(Math.max(0, taxableIncome) * 0.3);
}

export function computePayeNonResident(taxableIncome: number, asOf?: string): number {
  return usesPaye2026Schedule(asOf)
    ? computePayeNonResident202607(taxableIncome)
    : computePayeNonResidentPre202607(taxableIncome);
}

export function computePayeResidentPre202607(taxableIncome: number): number {
  const ti = Math.max(0, taxableIncome);
  if (ti <= 235_000) return 0;
  if (ti <= 335_000) return roundMoney((ti - 235_000) * 0.1);
  if (ti <= 410_000) return roundMoney((ti - 335_000) * 0.2 + 10_000);
  if (ti <= 10_000_000) return roundMoney((ti - 410_000) * 0.3 + 25_000);
  return roundMoney(2_902_000 + (ti - 10_000_000) * 0.4);
}

/** Resident PAYE from 1 July 2026 (FY 2026/27 Schedule 4). */
export function computePayeResident202607(taxableIncome: number): number {
  const ti = Math.max(0, taxableIncome);
  if (ti <= 335_000) return 0;
  if (ti <= 410_000) return roundMoney((ti - 335_000) * 0.2);
  if (ti <= 485_000) return roundMoney(15_000 + (ti - 410_000) * 0.25);
  if (ti <= 10_000_000) return roundMoney(33_750 + (ti - 485_000) * 0.3);
  // Tax at 10m (2,888,250) + 40% on the excess (30% band + 10% surcharge).
  return roundMoney(2_888_250 + (ti - 10_000_000) * 0.4);
}

export function computePayeResident(taxableIncome: number, asOf?: string): number {
  return usesPaye2026Schedule(asOf)
    ? computePayeResident202607(taxableIncome)
    : computePayeResidentPre202607(taxableIncome);
}

export function computePaye(
  taxableIncome: number,
  nonResident = false,
  asOf?: string,
): number {
  return nonResident
    ? computePayeNonResident(taxableIncome, asOf)
    : computePayeResident(taxableIncome, asOf);
}

/**
 * Sheet formula:
 *   Daily rate = Basic ÷ 30
 *   Adjusted basic = Daily rate × Days worked
 *   Taxable gross = Adjusted basic + Arrears
 *     Arrears / back-pay are part of total gross cash emoluments, so they are
 *     both taxable for PAYE and contributory for NSSF. (Older sheet practice
 *     paid arrears straight to net untaxed — that understated both.)
 *   Net = Adjusted basic − NSSF − PAYE − Advances + Arrears
 */
export function computeUgandaPayslip(input: PayrollInput): PayrollResult {
  const basicPay = Math.max(0, input.basicPay);
  const daysInPeriod = Math.max(1, input.daysInPeriod || DEFAULT_PAY_DAYS);
  const daysWorked = Math.max(0, input.daysWorked);
  const advances = Math.max(0, input.advances || 0);
  const arrears = Math.max(0, input.arrears || 0);
  const asOf = input.asOf;

  const dailyRate = roundMoney(basicPay / daysInPeriod);
  const adjustedBasic = roundMoney(dailyRate * daysWorked);
  const gross = adjustedBasic;

  // Arrears / back-pay are part of total gross cash emoluments: taxable for
  // PAYE and contributory for NSSF. Paying them out untaxed (the old
  // behaviour) understated both PAYE and NSSF on every back-pay run.
  const taxableGross = roundMoney(gross + arrears);
  const nssfEmployee = roundMoney(taxableGross * NSSF_EMPLOYEE_RATE);
  const nssfEmployer = roundMoney(taxableGross * NSSF_EMPLOYER_RATE);
  const paye = computePaye(taxableGross, input.nonResident, asOf);
  const totalDeductions = roundMoney(paye + nssfEmployee + advances);
  const netPay = roundMoney(Math.max(0, gross - paye - nssfEmployee - advances + arrears));

  return {
    basicPay,
    daysWorked,
    daysInPeriod,
    dailyRate,
    adjustedBasic,
    gross,
    paye,
    nssfEmployee,
    nssfEmployer,
    advances,
    arrears,
    totalDeductions,
    netPay,
    employerCost: roundMoney(gross + nssfEmployer + arrears),
    // Rate against total gross cash emoluments (incl. arrears), which is
    // what PAYE and NSSF are now charged on.
    effectiveRate: taxableGross > 0 ? (paye + nssfEmployee) / taxableGross : 0,
    payeSchedule: usesPaye2026Schedule(asOf) ? "2026-07" : "pre-2026-07",
  };
}

export function computeUgandaPayslipFromStrings(input: {
  basicPay?: string;
  daysWorked?: string;
  daysInPeriod?: string;
  advances?: string;
  arrears?: string;
  nonResident?: boolean;
  asOf?: string;
}): PayrollResult {
  return computeUgandaPayslip({
    basicPay: parseAmount(input.basicPay),
    daysWorked: parseAmount(input.daysWorked) || DEFAULT_PAY_DAYS,
    daysInPeriod: parseAmount(input.daysInPeriod) || DEFAULT_PAY_DAYS,
    advances: parseAmount(input.advances),
    arrears: parseAmount(input.arrears),
    nonResident: input.nonResident,
    asOf: input.asOf,
  });
}
