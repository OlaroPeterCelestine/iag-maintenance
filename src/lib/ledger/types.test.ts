import { describe, expect, it } from "vitest";
import { normalBalanceSign, parseAmount, roundMoney, signedBalance } from "@/lib/ledger/types";

describe("parseAmount", () => {
  it("passes finite numbers through unchanged", () => {
    expect(parseAmount(1234.5)).toBe(1234.5);
  });

  it("treats non-finite numbers as 0", () => {
    expect(parseAmount(NaN)).toBe(0);
    expect(parseAmount(Infinity)).toBe(0);
  });

  it("strips currency formatting from strings", () => {
    expect(parseAmount("UGX 1,200,000")).toBe(1200000);
    expect(parseAmount("$1,234.56")).toBe(1234.56);
  });

  it("returns 0 for empty/undefined/null/garbage input", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount("not a number")).toBe(0);
  });

  it("preserves a negative sign", () => {
    expect(parseAmount("-1,500.00")).toBe(-1500);
  });
});

describe("roundMoney", () => {
  it("rounds to whole currency units by default", () => {
    expect(roundMoney(1200.4)).toBe(1200);
    expect(roundMoney(1200.5)).toBe(1201);
  });

  it("fixes the classic 0.1 + 0.2 float-drift case", () => {
    expect(roundMoney(0.1 + 0.2, 1)).toBe(0.3);
  });

  it("clamps decimals to the 0-6 range", () => {
    expect(roundMoney(1.23456789, 20)).toBe(1.234568); // clamps to 6
    expect(roundMoney(1.9, -3)).toBe(2); // clamps to 0
  });
});

describe("signedBalance / normalBalanceSign", () => {
  it("Asset and Expense are debit-normal (positive = more debit)", () => {
    expect(normalBalanceSign("Asset")).toBe(1);
    expect(normalBalanceSign("Expense")).toBe(1);
    expect(signedBalance("Asset", 500, 200)).toBe(300);
    expect(signedBalance("Expense", 500, 200)).toBe(300);
  });

  it("Liability, Equity, and Income are credit-normal (positive = more credit)", () => {
    expect(normalBalanceSign("Liability")).toBe(-1);
    expect(normalBalanceSign("Equity")).toBe(-1);
    expect(normalBalanceSign("Income")).toBe(-1);
    expect(signedBalance("Liability", 200, 500)).toBe(300);
    expect(signedBalance("Equity", 200, 500)).toBe(300);
    expect(signedBalance("Income", 200, 500)).toBe(300);
  });

  it("a balanced debit/credit pair nets to zero regardless of type", () => {
    // Liability's -raw turns 0 into -0 here — mathematically equal to 0
    // (toBeCloseTo, unlike toBe, doesn't use Object.is so -0 passes).
    expect(signedBalance("Asset", 400, 400)).toBeCloseTo(0);
    expect(signedBalance("Liability", 400, 400)).toBeCloseTo(0);
  });
});
