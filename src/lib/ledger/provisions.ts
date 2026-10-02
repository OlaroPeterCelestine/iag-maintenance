import {
  ensureAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { postBalancedEntry, removePostingsForSource } from "@/lib/ledger/posting";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";
import { inventoryOnHandSummary } from "@/lib/inventory-movement";

/**
 * Conservatism: raise allowance for doubtful accounts against AR.
 * Dr Bad debt expense / Cr Allowance for doubtful accounts.
 */
export function postBadDebtProvision(input: {
  amount: number;
  date: string;
  sourceRecordId: string;
  description?: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = roundMoney(Math.max(0, input.amount));
  if (!amount) return { ok: false, error: "Provision amount is required." };
  let accounts = loadChartOfAccounts();
  const expense = ensureAccount(accounts, "Bad debt expense", "Expense", "Operating expenses", "5700");
  accounts = expense.accounts;
  const allowance = ensureAccount(
    accounts,
    "Allowance for doubtful accounts",
    "Asset",
    "Current assets",
    "1205",
  );
  accounts = allowance.accounts;
  saveChartOfAccounts(accounts);

  return postBalancedEntry({
    date: input.date,
    narration: input.description || "Bad debt provision",
    sourceModule: "accounts",
    sourceEntity: "bad-debt-provision",
    sourceRecordId: input.sourceRecordId,
    lines: [
      {
        accountId: expense.account.id,
        accountCode: expense.account.code,
        accountName: expense.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: allowance.account.id,
        accountCode: allowance.account.code,
        accountName: allowance.account.name,
        debit: 0,
        credit: amount,
      },
    ],
  }).ok
    ? { ok: true }
    : { ok: false, error: "Could not post bad debt provision." };
}

/**
 * Write inventory down to net realizable value when NRV < carrying amount.
 * Dr Inventory write-downs / Cr Inventory Asset.
 */
export function postInventoryNrvImpairment(input: {
  itemId: string;
  nrvPerUnit: number;
  date: string;
  sourceRecordId: string;
}): { ok: true; writeDown: number } | { ok: false; error: string } {
  const items = loadRecords("inventory", "inventory-items");
  const item = items.find((r) => r.id === input.itemId);
  if (!item) return { ok: false, error: "Inventory item not found." };
  const qty = parseAmount(item.quantity);
  const carrying =
    item.inventoryValue !== undefined && item.inventoryValue !== ""
      ? parseAmount(item.inventoryValue)
      : roundMoney(qty * parseAmount(item.averageCost || item.unitCost || item.cost || item.purchasePrice));
  const nrvTotal = roundMoney(Math.max(0, qty) * Math.max(0, input.nrvPerUnit));
  const writeDown = roundMoney(Math.max(0, carrying - nrvTotal));
  if (!writeDown) {
    removePostingsForSource(input.sourceRecordId);
    return { ok: true, writeDown: 0 };
  }

  let accounts = loadChartOfAccounts();
  const expense = ensureAccount(
    accounts,
    "Inventory write-downs",
    "Expense",
    "Cost of sales",
    "5010",
  );
  accounts = expense.accounts;
  const inventory = ensureAccount(accounts, "Inventory Asset", "Asset", "Other Current Asset", "1250");
  accounts = inventory.accounts;
  saveChartOfAccounts(accounts);

  const result = postBalancedEntry({
    date: input.date,
    narration: `NRV impairment · ${item.name || item.code}`,
    sourceModule: "inventory",
    sourceEntity: "inventory-nrv",
    sourceRecordId: input.sourceRecordId,
    lines: [
      {
        accountId: expense.account.id,
        accountCode: expense.account.code,
        accountName: expense.account.name,
        debit: writeDown,
        credit: 0,
      },
      {
        accountId: inventory.account.id,
        accountCode: inventory.account.code,
        accountName: inventory.account.name,
        debit: 0,
        credit: writeDown,
      },
    ],
  });
  if (!result.ok) return { ok: false, error: result.error };

  item.inventoryValue = String(nrvTotal);
  if (qty > 0) item.averageCost = String(roundMoney(nrvTotal / qty, 4));
  item.nrv = String(input.nrvPerUnit);
  void saveRecords("inventory", "inventory-items", items).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "inventory/inventory-items",
        saved.error ||
          "NRV impairment was posted to the ledger, but the inventory item could not be updated.",
      );
    }
  });
  return { ok: true, writeDown };
}

export function inventoryCarryingVsNrvSummary() {
  return inventoryOnHandSummary().map((item) => {
    const record = loadRecords("inventory", "inventory-items").find((r) => r.id === item.id);
    const nrv = parseAmount(record?.nrv);
    const nrvTotal = nrv > 0 ? roundMoney(item.quantity * nrv) : null;
    return {
      ...item,
      nrvPerUnit: nrv || null,
      nrvTotal,
      impaired: nrvTotal !== null && nrvTotal < item.value,
    };
  });
}
