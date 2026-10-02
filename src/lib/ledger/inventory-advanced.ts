import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";
import {
  ensureAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { postBalancedEntry } from "@/lib/ledger/posting";

/** Allocate landed costs (freight, duty) into inventory value. */
export function postLandedCost(input: {
  itemId: string;
  amount: number;
  date: string;
  description?: string;
  bankOrApAccount?: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.amount));
  if (!amount) return { ok: false, error: "Landed cost amount required." };
  const items = loadRecords("inventory", "inventory-items");
  const item = items.find((r) => r.id === input.itemId);
  if (!item) return { ok: false, error: "Item not found." };
  let accounts = loadChartOfAccounts();
  const inv = ensureAccount(accounts, "Inventory Asset", "Asset", "Other Current Asset", "1250");
  accounts = inv.accounts;
  const contra = ensureAccount(
    accounts,
    input.bankOrApAccount || "Accounts payable",
    /payable/i.test(input.bankOrApAccount || "payable") ? "Liability" : "Asset",
    /payable/i.test(input.bankOrApAccount || "payable") ? "Current liabilities" : "Current assets",
    /payable/i.test(input.bankOrApAccount || "payable") ? "2000" : "1100",
  );
  accounts = contra.accounts;
  saveChartOfAccounts(accounts);
  const result = postBalancedEntry({
    date: input.date,
    narration: input.description || `Landed cost · ${item.name || item.code}`,
    sourceModule: "inventory",
    sourceEntity: "landed-costs",
    sourceRecordId: `landed-${input.itemId}-${input.date}`,
    lines: [
      {
        accountId: inv.account.id,
        accountCode: inv.account.code,
        accountName: inv.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: contra.account.id,
        accountCode: contra.account.code,
        accountName: contra.account.name,
        debit: 0,
        credit: amount,
      },
    ],
  });
  if (!result.ok) return result;
  const qty = parseAmount(item.quantity);
  const value = roundMoney(parseAmount(item.inventoryValue) + amount);
  item.inventoryValue = String(value);
  if (qty > 0) item.averageCost = String(roundMoney(value / qty, 4));
  void saveRecords("inventory", "inventory-items", items).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "inventory/inventory-items",
        saved.error ||
          "Landed cost was posted to the ledger, but the inventory item could not be updated.",
      );
    }
  });
  return { ok: true };
}

/** Physical stocktake — write variance to P&L. */
export function postStocktakeVariance(input: {
  itemId: string;
  countedQty: number;
  date: string;
}): { ok: true; varianceQty: number; varianceValue: number } | { ok: false; error: string } {
  const items = loadRecords("inventory", "inventory-items");
  const item = items.find((r) => r.id === input.itemId);
  if (!item) return { ok: false, error: "Item not found." };
  const bookQty = parseAmount(item.quantity);
  const varianceQty = roundMoney(input.countedQty - bookQty);
  if (!varianceQty) return { ok: true, varianceQty: 0, varianceValue: 0 };
  const unit = parseAmount(item.averageCost || item.unitCost || item.cost);
  const varianceValue = roundMoney(Math.abs(varianceQty) * unit);
  let accounts = loadChartOfAccounts();
  const inv = ensureAccount(accounts, "Inventory Asset", "Asset", "Other Current Asset", "1250");
  accounts = inv.accounts;
  if (varianceQty < 0) {
    const exp = ensureAccount(accounts, "Inventory write-downs", "Expense", "Cost of sales", "5010");
    accounts = exp.accounts;
    saveChartOfAccounts(accounts);
    const result = postBalancedEntry({
      date: input.date,
      narration: `Stocktake shortage · ${item.name || item.code}`,
      sourceModule: "inventory",
      sourceEntity: "stocktakes",
      sourceRecordId: `stocktake-${item.id}-${input.date}`,
      lines: [
        {
          accountId: exp.account.id,
          accountCode: exp.account.code,
          accountName: exp.account.name,
          debit: varianceValue,
          credit: 0,
        },
        {
          accountId: inv.account.id,
          accountCode: inv.account.code,
          accountName: inv.account.name,
          debit: 0,
          credit: varianceValue,
        },
      ],
    });
    if (!result.ok) return result;
  } else {
    const income = ensureAccount(accounts, "Other income", "Income", "Non-operating income", "4100");
    accounts = income.accounts;
    saveChartOfAccounts(accounts);
    const result = postBalancedEntry({
      date: input.date,
      narration: `Stocktake overage · ${item.name || item.code}`,
      sourceModule: "inventory",
      sourceEntity: "stocktakes",
      sourceRecordId: `stocktake-${item.id}-${input.date}`,
      lines: [
        {
          accountId: inv.account.id,
          accountCode: inv.account.code,
          accountName: inv.account.name,
          debit: varianceValue,
          credit: 0,
        },
        {
          accountId: income.account.id,
          accountCode: income.account.code,
          accountName: income.account.name,
          debit: 0,
          credit: varianceValue,
        },
      ],
    });
    if (!result.ok) return result;
  }
  item.quantity = String(input.countedQty);
  item.inventoryValue = String(roundMoney(input.countedQty * unit));
  void saveRecords("inventory", "inventory-items", items).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "inventory/inventory-items",
        saved.error ||
          "Stocktake variance was posted to the ledger, but the inventory item could not be updated.",
      );
    }
  });
  return { ok: true, varianceQty, varianceValue };
}

/** Consignment stock — off-balance memo qty. */
export function setConsignmentQty(itemId: string, qty: number) {
  const items = loadRecords("inventory", "inventory-items");
  const item = items.find((r) => r.id === itemId);
  if (!item) return;
  item.consignmentQty = String(Math.max(0, qty));
  void saveRecords("inventory", "inventory-items", items).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "inventory/inventory-items",
        saved.error || "Could not save the consignment quantity update.",
      );
    }
  });
}
