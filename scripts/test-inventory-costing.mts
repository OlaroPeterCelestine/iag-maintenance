/**
 * Inventory cost-layer behaviour under FIFO/LIFO/specific.
 *
 * Covers the three defects fixed alongside this script:
 *   1. an edited outflow used to consume the full new quantity again on top of
 *      the original issue, because consumed layers were deleted with no record
 *      of where they came from;
 *   2. deleting an outflow never returned the consumed stock to the layers;
 *   3. specific-id consumption left quantity / value / average cost untouched.
 *
 * Run: npx tsx scripts/test-inventory-costing.mts
 */
import assert from "node:assert/strict";
import {
  consumeFifo,
  consumeLifo,
  consumeSpecificId,
  mergeLayers,
  parseCostLayers,
  serializeCostLayers,
  type CostLayer,
} from "../src/lib/ledger/inventory-costing.ts";
import type { ManagerRecord } from "../src/lib/manager-entities.ts";

function itemWithLayers(layers: CostLayer[]): ManagerRecord {
  const qty = layers.reduce((s, l) => s + l.qty, 0);
  const value = layers.reduce((s, l) => s + l.qty * l.unitCost, 0);
  return {
    id: "item-1",
    name: "Coffee beans",
    costLayers: JSON.stringify(layers),
    quantity: String(qty),
    inventoryValue: String(value),
    averageCost: qty > 0 ? String(value / qty) : "0",
  } as ManagerRecord;
}

/** Two layers: 10 @ 1,000 (older) then 10 @ 2,000 (newer). */
function twoLayers(): CostLayer[] {
  return [
    { qty: 10, unitCost: 1000, date: "2026-01-01", sourceId: "po-1" },
    { qty: 10, unitCost: 2000, date: "2026-02-01", sourceId: "po-2" },
  ];
}

// —— FIFO takes the oldest layer first ————————————————————————————————
{
  const item = itemWithLayers(twoLayers());
  const { cogs, consumed } = consumeFifo(item, 5);
  assert.equal(cogs, 5000, "FIFO consumes 5 @ 1,000");
  assert.equal(consumed.length, 1, "one layer touched");
  assert.equal(consumed[0].unitCost, 1000, "oldest layer valued");
  assert.equal(parseAmountOf(item.quantity), 15, "quantity drops to 15");
  assert.equal(parseAmountOf(item.inventoryValue), 25000, "value 5*1000 + 10*2000");
}

// —— LIFO takes the newest layer first ————————————————————————————————
{
  const item = itemWithLayers(twoLayers());
  const { cogs } = consumeLifo(item, 5);
  assert.equal(cogs, 10000, "LIFO consumes 5 @ 2,000");
  assert.equal(parseAmountOf(item.inventoryValue), 20000, "value 10*1000 + 5*2000");
}

// —— FIFO spanning two layers ——————————————————————————————————————
{
  const item = itemWithLayers(twoLayers());
  const { cogs, consumed } = consumeFifo(item, 15);
  assert.equal(cogs, 20000, "10 @ 1,000 + 5 @ 2,000");
  assert.equal(consumed.length, 2, "both layers attributed");
  assert.equal(parseAmountOf(item.quantity), 5, "5 left");
}

// —— DEFECT 3: specific-id now updates quantity / value / average ————————
{
  const layers: CostLayer[] = [
    { qty: 10, unitCost: 1000, date: "2026-01-01", sourceId: "po-1", batch: "B1" },
    { qty: 10, unitCost: 2000, date: "2026-02-01", sourceId: "po-2", batch: "B2" },
  ];
  const item = itemWithLayers(layers);
  const { cogs } = consumeSpecificId(item, 4, "B2");
  assert.equal(cogs, 8000, "named batch B2 valued at 2,000");
  assert.equal(parseAmountOf(item.quantity), 16, "quantity must fall to 16");
  assert.equal(
    parseAmountOf(item.inventoryValue),
    10 * 1000 + 6 * 2000,
    "valuation must follow the layers",
  );
}

// —— specific-id with an unmatched batch values the shortfall —————————
{
  const item = itemWithLayers(twoLayers());
  item.averageCost = "1500";
  const { cogs } = consumeSpecificId(item, 4, "NOPE");
  assert.equal(cogs, 6000, "unmatched batch falls back to average cost, not zero");
}

// —— DEFECT 1: re-consuming an edited outflow ————————————————————————
{
  // Original issue of 5 under FIFO.
  const item = itemWithLayers(twoLayers());
  const first = consumeFifo(item, 5);
  assert.equal(parseAmountOf(item.quantity), 15);

  // Edit 5 -> 8. Restore what the first issue took, then consume 8.
  item.costLayers = serializeCostLayers(
    mergeLayers(parseCostLayers(item), first.consumed),
  );
  assert.equal(
    parseCostLayers(item).reduce((s, l) => s + l.qty, 0),
    20,
    "restoring puts the pool back to its pre-issue quantity",
  );

  const second = consumeFifo(item, 8);
  assert.equal(second.cogs, 8000, "8 @ 1,000 from the oldest layer");
  assert.equal(
    parseAmountOf(item.quantity),
    12,
    "20 less the edited quantity of 8 — not 20 - 5 - 8 = 7",
  );
}

// —— DEFECT 2: deleting an outflow returns the stock ——————————————————
{
  const item = itemWithLayers(twoLayers());
  const issue = consumeFifo(item, 12);
  assert.equal(parseAmountOf(item.quantity), 8);

  // Delete the document: drop its purchase layers, hand back what it consumed.
  const layers = parseCostLayers(item).filter((l) => l.sourceId !== "sale-1");
  item.costLayers = serializeCostLayers(mergeLayers(layers, issue.consumed));
  assert.equal(
    parseCostLayers(item).reduce((s, l) => s + l.qty, 0),
    20,
    "all 20 units are back in the pool",
  );
  // And the restored pool still values correctly under FIFO.
  const recheck = consumeFifo(itemWithLayers(parseCostLayers(item)), 10);
  assert.equal(recheck.cogs, 10000, "the oldest 10 are still at 1,000");
}

// —— mergeLayers orders oldest-first regardless of restore order ——————
{
  const merged = mergeLayers(
    [{ qty: 5, unitCost: 3000, date: "2026-03-01", sourceId: "po-3" }],
    [{ qty: 5, unitCost: 1000, date: "2026-01-01", sourceId: "po-1" }],
  );
  assert.equal(merged[0].date, "2026-01-01", "restored older layer sorts first");
  assert.equal(merged.length, 2);
}

function parseAmountOf(value: string | undefined): number {
  return Number(value ?? 0);
}

console.log("inventory-costing: ok");
