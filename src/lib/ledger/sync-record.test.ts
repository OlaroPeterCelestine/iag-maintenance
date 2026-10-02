import { describe, expect, it } from "vitest";
import { alignRowsToTotal } from "@/lib/ledger/sync-record";

describe("alignRowsToTotal", () => {
  it("leaves rows untouched when already balanced", () => {
    const rows = [
      { account: "Sales", amount: 600 },
      { account: "Sales-2", amount: 600 },
    ];
    const result = alignRowsToTotal(rows, 1200);
    expect(result).toBe(rows);
    expect(result[0]!.amount).toBe(600);
    expect(result[1]!.amount).toBe(600);
  });

  it("does not nudge row 0 when the sum is only off by float epsilon", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE754 — this is exactly the drift pattern that
    // used to slip past the old `if (!difference)` strict-zero check.
    const rows = [
      { account: "A", amount: 0.1 },
      { account: "B", amount: 0.2 },
    ];
    const result = alignRowsToTotal(rows, 0.3);
    // Whole-currency-unit convention (roundMoney default): 0.1/0.2 round to 0,
    // target rounds to 0 too, so the rounded difference is 0 — early-return,
    // row 0 must come back byte-for-byte unmutated rather than absorbing the
    // 5.5e-17 epsilon the old strict `!difference` check let through.
    expect(result).toBe(rows);
    expect(result[0]!.amount).toBe(0.1);
  });

  it("adds the real shortfall to row 0 when rows undershoot the target", () => {
    const rows = [
      { account: "Sales", amount: 400 },
      { account: "Sales-2", amount: 350 },
    ];
    const result = alignRowsToTotal(rows, 1000);
    expect(result[0]!.amount).toBe(650);
    expect(result[1]!.amount).toBe(350);
    expect(result[0]!.amount + result[1]!.amount).toBe(1000);
  });

  it("returns rows unchanged for an empty list", () => {
    const rows: { account: string; amount: number }[] = [];
    expect(alignRowsToTotal(rows, 500)).toBe(rows);
  });
});
