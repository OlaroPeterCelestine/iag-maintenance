import {
  OPENING_BALANCES_EQUITY_CODE,
  OPENING_BALANCES_EQUITY_NAME,
  ensureAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { postBalancedEntry, removePostingsForSource } from "@/lib/ledger/posting";
import { recordToBase } from "@/lib/ledger/fx";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";

function isOpeningBalanceEntry(record: ManagerRecord): boolean {
  return /opening/i.test(record.entryType || record.balanceType || "");
}

function assetGrossCost(record: ManagerRecord): number {
  const total = parseAmount(record.totalAcquisitionCost);
  if (total > 0) return total;
  const cost = parseAmount(record.cost || record.amount || record.purchasePrice);
  const extras = parseAmount(record.otherCosts);
  return roundMoney(cost + extras);
}

function ensureFixedAssetLedgerAccount(
  accounts: ReturnType<typeof loadChartOfAccounts>,
  name: string,
  code: string,
) {
  const ensured = ensureAccount(accounts, name, "Asset", "Fixed Asset", code);
  const acct = ensured.account;
  // Keep PPE on the Balance Sheet under Fixed Asset even if an older row was mistyped.
  if (
    acct.type !== "Asset" ||
    !/fixed\s*asset|ppe|property.?plant|non[- ]?current/i.test(acct.group || "")
  ) {
    const repaired = { ...acct, type: "Asset" as const, group: "Fixed Asset" };
    return {
      accounts: ensured.accounts.map((a) => (a.id === acct.id ? repaired : a)),
      account: repaired,
    };
  }
  return ensured;
}

/** Capitalize a fixed asset: purchase (Dr Asset / Cr Bank) or opening carry-in. */
export function postFixedAssetCapitalization(record: ManagerRecord): {
  ok: true;
} | { ok: false; error: string } {
  const cost = assetGrossCost(record);
  if (!cost) {
    removePostingsForSource(record.id);
    return { ok: true };
  }

  const costBase = recordToBase(record, cost);
  if (costBase <= 0) {
    return {
      ok: false,
      error:
        "Could not convert fixed-asset cost to base currency. Add an exchange rate under Settings → Exchange rates, then save again.",
    };
  }
  const opening = isOpeningBalanceEntry(record);
  const accum = roundMoney(
    Math.min(
      costBase,
      Math.max(0, recordToBase(record, parseAmount(record.accumulatedDepreciation))),
    ),
  );
  const net = roundMoney(Math.max(0, costBase - accum));

  let accounts = loadChartOfAccounts();
  // Prefer a real Fixed Asset CoA account — never free-text category/description.
  const asset = ensureFixedAssetLedgerAccount(
    accounts,
    record.assetAccount || record.group || "Furniture and Equipment",
    "1500",
  );
  accounts = asset.accounts;

  const date =
    record.date ||
    record.acquired ||
    record.purchaseDate ||
    new Date().toISOString().slice(0, 10);

  const lines: {
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
  }[] = [
    {
      accountId: asset.account.id,
      accountCode: asset.account.code,
      accountName: asset.account.name,
      debit: costBase,
      credit: 0,
    },
  ];

  if (opening) {
    if (accum > 0) {
      const accumAcc = ensureFixedAssetLedgerAccount(
        accounts,
        record.accumulatedDepreciationAccount || "Accumulated Depreciation",
        "1590",
      );
      accounts = accumAcc.accounts;
      lines.push({
        accountId: accumAcc.account.id,
        accountCode: accumAcc.account.code,
        accountName: accumAcc.account.name,
        debit: 0,
        credit: accum,
      });
    }
    const equity = ensureAccount(
      accounts,
      OPENING_BALANCES_EQUITY_NAME,
      "Equity",
      "Equity",
      OPENING_BALANCES_EQUITY_CODE,
    );
    accounts = equity.accounts;
    if (net > 0) {
      lines.push({
        accountId: equity.account.id,
        accountCode: equity.account.code,
        accountName: equity.account.name,
        debit: 0,
        credit: net,
      });
    }
  } else {
    const contraName = record.paidFrom || record.account || record.bankAccount || "Bank-UGX";
    const contra = ensureAccount(
      accounts,
      contraName,
      /payable|ap/i.test(contraName) ? "Liability" : "Asset",
      /payable|ap/i.test(contraName) ? "Current liabilities" : "Current assets",
      /payable|ap/i.test(contraName) ? "2000" : "1100",
    );
    accounts = contra.accounts;
    lines.push({
      accountId: contra.account.id,
      accountCode: contra.account.code,
      accountName: contra.account.name,
      debit: 0,
      credit: costBase,
    });
  }

  saveChartOfAccounts(accounts);

  const result = postBalancedEntry({
    date,
    narration:
      record.name ||
      record.reference ||
      (opening ? "Fixed asset opening balance" : "Fixed asset capitalization"),
    sourceModule: "assets",
    sourceEntity: "fixed-assets",
    sourceRecordId: record.id,
    division: record.division || record.costCenter || record.class,
    project: record.project || record.job,
    location: record.location,
    lines,
  });
  return result.ok
    ? { ok: true }
    : {
        ok: false,
        error:
          result.error ||
          (opening
            ? "Could not post fixed asset opening balance."
            : "Could not capitalize fixed asset."),
      };
}

/** Straight-line monthly depreciation for one asset. */
export function computeMonthlyDepreciation(asset: ManagerRecord): number {
  const cost = parseAmount(
    asset.totalAcquisitionCost || asset.cost || asset.amount || asset.purchasePrice,
  );
  const salvage = parseAmount(asset.salvageValue || asset.residual);
  const lifeMonths =
    parseAmount(asset.usefulLifeMonths) ||
    Math.max(1, Math.round(parseAmount(asset.usefulLifeYears || "5") * 12));
  const depreciable = Math.max(0, cost - salvage);
  return roundMoney(depreciable / lifeMonths);
}

/**
 * Post depreciation for all active fixed assets for a given month (YYYY-MM).
 * Creates/updates depreciation-entries and ledger postings.
 */
export function runMonthlyDepreciation(month: string): {
  ok: true;
  count: number;
  total: number;
} | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, error: "Month must be YYYY-MM." };
  }
  const asOf = `${month}-28`;
  const assets = loadRecords("assets", "fixed-assets").filter(
    (a) => !/sold|disposed|inactive|draft|void/i.test(a.status || ""),
  );
  const entries = loadRecords("assets", "depreciation-entries");
  let total = 0;
  let count = 0;

  for (const asset of assets) {
    const start = (asset.acquired || asset.date || asset.purchaseDate || "").slice(0, 7);
    if (start && month < start) continue;
    const amount = computeMonthlyDepreciation(asset);
    if (!amount) continue;
    const entryId = `dep-${asset.id}-${month}`;
    const existing = entries.find((e) => e.id === entryId);
    const entry: ManagerRecord = {
      id: entryId,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      date: asOf,
      amount: String(amount),
      reference: `Dep ${month} · ${asset.name || asset.code || asset.id.slice(0, 8)}`,
      asset: asset.name || asset.code || asset.id,
      assetId: asset.id,
      status: "Posted",
      description: `Auto depreciation for ${month}`,
    };
    const idx = entries.findIndex((e) => e.id === entryId);
    if (idx >= 0) entries[idx] = entry;
    else entries.push(entry);

    let accounts = loadChartOfAccounts();
    const expense = ensureAccount(
      accounts,
      asset.depreciationExpenseAccount || "Depreciation",
      "Expense",
      "Expenses",
      "6400",
    );
    accounts = expense.accounts;
    const accum = ensureAccount(
      accounts,
      asset.accumulatedDepreciationAccount || "Accumulated Depreciation",
      "Asset",
      "Fixed Asset",
      "1590",
    );
    accounts = accum.accounts;
    saveChartOfAccounts(accounts);

    const posted = postBalancedEntry({
      date: asOf,
      narration: entry.reference,
      sourceModule: "assets",
      sourceEntity: "depreciation-entries",
      sourceRecordId: entryId,
      lines: [
        {
          accountId: expense.account.id,
          accountCode: expense.account.code,
          accountName: expense.account.name,
          debit: amount,
          credit: 0,
        },
        {
          accountId: accum.account.id,
          accountCode: accum.account.code,
          accountName: accum.account.name,
          debit: 0,
          credit: amount,
        },
      ],
    });
    if (!posted.ok) {
      return { ok: false, error: posted.error || "Depreciation posting failed." };
    }
    total = roundMoney(total + amount);
    count += 1;
  }

  void saveRecords("assets", "depreciation-entries", entries).then((result) => {
    if (!result.ok || result.durable !== "postgres") {
      notifyPersistFailure(
        "assets/depreciation-entries",
        result.error ||
          "Depreciation was posted to the ledger, but the depreciation-entries subledger could not be saved.",
      );
    }
  });
  return { ok: true, count, total };
}

/** Dispose of an asset: remove NBV, clear accum dep, recognize gain/loss. */
export function disposeFixedAsset(input: {
  assetId: string;
  proceeds: number;
  date: string;
  bankAccount?: string;
}): { ok: true; gainLoss: number } | { ok: false; error: string } {
  const assets = loadRecords("assets", "fixed-assets");
  const asset = assets.find((a) => a.id === input.assetId);
  if (!asset) return { ok: false, error: "Fixed asset not found." };

  const cost = parseAmount(
    asset.totalAcquisitionCost || asset.cost || asset.amount || asset.purchasePrice,
  );
  const entries = loadRecords("assets", "depreciation-entries").filter(
    (e) => e.assetId === asset.id && !/void|draft/i.test(e.status || ""),
  );
  const accum = roundMoney(entries.reduce((s, e) => s + parseAmount(e.amount), 0));
  const nbv = roundMoney(Math.max(0, cost - accum));
  const proceeds = roundMoney(Math.max(0, input.proceeds));
  const gainLoss = roundMoney(proceeds - nbv);
  const sourceId = `dispose-${asset.id}`;

  let accounts = loadChartOfAccounts();
  const accumAcct = ensureAccount(
    accounts,
    "Accumulated Depreciation",
    "Asset",
    "Fixed Asset",
    "1590",
  );
  accounts = accumAcct.accounts;
  const costAcct = ensureAccount(
    accounts,
    asset.assetAccount || asset.group || "Furniture and Equipment",
    "Asset",
    "Fixed Asset",
    "1500",
  );
  accounts = costAcct.accounts;
  const bank = ensureAccount(
    accounts,
    input.bankAccount || "Bank-UGX",
    "Asset",
    "Cash and cash equivalents",
    "1050",
  );
  accounts = bank.accounts;
  const gl = ensureAccount(accounts, "Other Expenses", "Expense", "Expenses", "7000");
  accounts = gl.accounts;
  saveChartOfAccounts(accounts);

  const lines: {
    accountId: string;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
  }[] = [
    {
      accountId: accumAcct.account.id,
      accountCode: accumAcct.account.code,
      accountName: accumAcct.account.name,
      debit: accum,
      credit: 0,
    },
    {
      accountId: costAcct.account.id,
      accountCode: costAcct.account.code,
      accountName: costAcct.account.name,
      debit: 0,
      credit: cost,
    },
  ];
  if (proceeds > 0) {
    lines.push({
      accountId: bank.account.id,
      accountCode: bank.account.code,
      accountName: bank.account.name,
      debit: proceeds,
      credit: 0,
    });
  }
  if (gainLoss < 0) {
    lines.push({
      accountId: gl.account.id,
      accountCode: gl.account.code,
      accountName: gl.account.name,
      debit: Math.abs(gainLoss),
      credit: 0,
    });
  } else if (gainLoss > 0) {
    lines.push({
      accountId: gl.account.id,
      accountCode: gl.account.code,
      accountName: gl.account.name,
      debit: 0,
      credit: gainLoss,
    });
  }

  const result = postBalancedEntry({
    date: input.date,
    narration: `Disposal · ${asset.name || asset.code}`,
    sourceModule: "assets",
    sourceEntity: "asset-disposals",
    sourceRecordId: sourceId,
    lines,
  });
  if (!result.ok) return result;

  asset.status = "Disposed";
  asset.disposalDate = input.date;
  asset.disposalProceeds = String(proceeds);
  void saveRecords("assets", "fixed-assets", assets).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "assets/fixed-assets",
        saved.error ||
          "Disposal was posted to the ledger, but the fixed asset register could not be updated.",
      );
    }
  });
  return { ok: true, gainLoss };
}
