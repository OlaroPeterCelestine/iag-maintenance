import { describe, expect, it } from "vitest";
import {
  extractAccountCode,
  findAccount,
  ledgerAccountsFromChartRecords,
  normalizeAccountType,
} from "@/lib/ledger/chart-of-accounts";
import {
  lineMatchesAccount,
  profitAndLossFromBooks,
  resolveLineAccount,
  buildAccountLookup,
} from "@/lib/ledger/posting";
import type { LedgerAccount, LedgerLine } from "@/lib/ledger/types";

function account(partial: Partial<LedgerAccount> & Pick<LedgerAccount, "id" | "code" | "name" | "type">): LedgerAccount {
  return {
    group: partial.group || partial.type,
    openingBalance: 0,
    currency: "UGX",
    inactive: false,
    ...partial,
  };
}

function line(
  partial: Partial<LedgerLine> & Pick<LedgerLine, "accountId" | "accountCode" | "accountName" | "debit" | "credit">,
): LedgerLine {
  return {
    id: `line-${partial.accountId}-${partial.debit}-${partial.credit}`,
    date: "2026-03-15",
    narration: "Coffee sale",
    sourceModule: "sales",
    sourceEntity: "sales-invoices",
    sourceRecordId: "inv-1",
    createdAt: "2026-03-15T10:00:00.000Z",
    ...partial,
  };
}

describe("normalizeAccountType", () => {
  it("maps Revenue / income aliases onto Income", () => {
    expect(normalizeAccountType("Revenue")).toBe("Income");
    expect(normalizeAccountType("income")).toBe("Income");
    expect(normalizeAccountType("SALES")).toBe("Income");
  });

  it("treats 4xxx accounts defaulted to Asset as Income", () => {
    expect(normalizeAccountType("Asset", "4000", "sale of coffee")).toBe("Income");
    expect(normalizeAccountType("", "4000", "Coffee Sales")).toBe("Income");
    expect(normalizeAccountType("Asset", "", "sale of coffee")).toBe("Income");
    expect(normalizeAccountType("Asset", "", "4000 — sale of coffee")).toBe("Income");
  });

  it("keeps real 1xxx assets as Asset", () => {
    expect(normalizeAccountType("Asset", "1001", "Cash-UGX")).toBe("Asset");
  });
});

describe("findAccount / extractAccountCode", () => {
  const coffee = account({
    id: "acct-4000",
    code: "4000",
    name: "Coffee Sales",
    type: "Income",
  });

  it("reads a leading code from picker labels", () => {
    expect(extractAccountCode("4000 — sale of coffee")).toBe("4000");
    expect(extractAccountCode("4000-sale of coffee")).toBe("4000");
  });

  it("resolves sale of coffee and 4000 labels to Coffee Sales", () => {
    expect(findAccount([coffee], "sale of coffee")?.id).toBe("acct-4000");
    expect(findAccount([coffee], "4000 — sale of coffee")?.id).toBe("acct-4000");
    expect(findAccount([coffee], "4000")?.id).toBe("acct-4000");
  });

  it("keeps a CoA row actually named sale of coffee", () => {
    const posted = account({
      id: "coa-sale-of-coffee",
      code: "4000",
      name: "sale of coffee",
      type: "Income",
    });
    expect(findAccount([posted], "sale of coffee")?.id).toBe("coa-sale-of-coffee");
    expect(findAccount([posted], "4000 — sale of coffee")?.id).toBe("coa-sale-of-coffee");
  });
});

describe("ledgerAccountsFromChartRecords", () => {
  it("does not classify 4000 sale of coffee as an Asset", () => {
    const accounts = ledgerAccountsFromChartRecords([
      {
        id: "coa-uuid-4000",
        kind: "Account",
        code: "4000",
        name: "sale of coffee",
        type: "Asset",
        group: "Asset",
        status: "Active",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const coffee = accounts.find((a) => a.code === "4000");
    expect(coffee?.type).toBe("Income");
  });
});

describe("profitAndLossFromBooks — 4000 coffee sales", () => {
  const coffee = account({
    id: "coa-uuid-4000",
    code: "4000",
    name: "sale of coffee",
    type: "Income",
    group: "Income",
  });
  const cash = account({
    id: "acct-1001",
    code: "1001",
    name: "Cash-UGX",
    type: "Asset",
  });

  it("includes credits posted with a stale account id when code is 4000", () => {
    const pl = profitAndLossFromBooks(
      [coffee, cash],
      [
        line({
          accountId: "acct-4000",
          accountCode: "4000",
          accountName: "sale of coffee",
          debit: 0,
          credit: 250000,
        }),
        line({
          accountId: "acct-1001",
          accountCode: "1001",
          accountName: "Cash-UGX",
          debit: 250000,
          credit: 0,
        }),
      ],
      "2026-01-01",
      "2026-12-31",
    );
    expect(pl.income).toHaveLength(1);
    expect(pl.income[0]?.code).toBe("4000");
    expect(pl.income[0]?.name).toBe("sale of coffee");
    expect(pl.totalIncome).toBe(250000);
    expect(pl.netProfit).toBe(250000);
  });

  it("includes 4000 even when the CoA row was saved as Asset", () => {
    const mistyped = account({
      id: "coa-uuid-4000",
      code: "4000",
      name: "sale of coffee",
      type: "Asset",
      group: "Asset",
    });
    const pl = profitAndLossFromBooks(
      [mistyped, cash],
      [
        line({
          accountId: "coa-uuid-4000",
          accountCode: "4000",
          accountName: "sale of coffee",
          debit: 0,
          credit: 180000,
        }),
      ],
      "2026-01-01",
      "2026-12-31",
    );
    expect(pl.totalIncome).toBe(180000);
    expect(pl.income[0]?.type).toBe("Income");
  });

  it("still shows 4xxx sales when the CoA row is missing", () => {
    const pl = profitAndLossFromBooks(
      [cash],
      [
        line({
          accountId: "gone",
          accountCode: "4000",
          accountName: "sale of coffee",
          debit: 0,
          credit: 90000,
        }),
      ],
      "2026-01-01",
      "2026-12-31",
    );
    expect(pl.totalIncome).toBe(90000);
    expect(pl.income[0]?.code).toBe("4000");
  });
});

describe("line matching", () => {
  const coffee = account({
    id: "coa-uuid-4000",
    code: "4000",
    name: "sale of coffee",
    type: "Income",
  });

  it("matches by code when ids differ", () => {
    expect(
      lineMatchesAccount(
        { accountId: "acct-4000", accountCode: "4000", accountName: "Coffee Sales" },
        coffee,
      ),
    ).toBe(true);
    const resolved = resolveLineAccount(buildAccountLookup([coffee]), {
      accountId: "acct-4000",
      accountCode: "4000",
      accountName: "sale of coffee",
    });
    expect(resolved?.id).toBe("coa-uuid-4000");
  });
});
