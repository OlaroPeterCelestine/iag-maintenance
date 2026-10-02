import { parseAmount, roundMoney } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadManagerSettings } from "@/lib/manager-settings";

export type CostLayer = { qty: number; unitCost: number; date: string; sourceId: string; batch?: string };

/**
 * What a consumption actually took, layer by layer. Editing an outflow has to
 * put the previous issue back before re-consuming, and that is impossible
 * unless the layers it consumed were recorded — deleting them outright is why
 * an edited FIFO/LIFO sale used to over-consume stock permanently.
 */
export type ConsumeResult = { cogs: number; item: ManagerRecord; consumed: CostLayer[] };

/** Merge restored layers back into a layer list, oldest first. */
export function mergeLayers(existing: CostLayer[], restored: CostLayer[]): CostLayer[] {
  if (!restored.length) return existing;
  return [...existing, ...restored]
    .filter((l) => l.qty > 0)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

export function parseCostLayers(item: ManagerRecord): CostLayer[] {
  try {
    const raw = item.costLayers ? (JSON.parse(item.costLayers) as CostLayer[]) : [];
    return Array.isArray(raw) ? raw.filter((l) => l.qty > 0) : [];
  } catch {
    return [];
  }
}

export function serializeCostLayers(layers: CostLayer[]) {
  return JSON.stringify(layers.filter((l) => l.qty > 0));
}

/** Add a purchase layer (FIFO/LIFO/specific) or fold into average cost. */
export function addPurchaseLayer(
  item: ManagerRecord,
  qty: number,
  unitCost: number,
  date: string,
  sourceId: string,
  batch?: string,
) {
  if (qty <= 0) return item;
  const method = loadManagerSettings().inventoryCosting || "average";
  if (method === "fifo" || method === "lifo" || method === "specific") {
    const layers = parseCostLayers(item);
    layers.push({
      qty: roundMoney(qty),
      unitCost: roundMoney(unitCost, 4),
      date,
      sourceId,
      ...(batch ? { batch } : {}),
    });
    item.costLayers = serializeCostLayers(layers);
    const totalQty = roundMoney(layers.reduce((s, l) => s + l.qty, 0));
    const totalValue = roundMoney(layers.reduce((s, l) => s + l.qty * l.unitCost, 0));
    item.quantity = String(totalQty);
    item.inventoryValue = String(totalValue);
    if (totalQty > 0) item.averageCost = String(roundMoney(totalValue / totalQty, 4));
    return item;
  }
  // average path handled by inventory-movement
  return item;
}

/** Consume qty under FIFO; returns COGS value and updated layers. */
export function consumeFifo(item: ManagerRecord, qtyOut: number): ConsumeResult {
  let remaining = Math.abs(qtyOut);
  const layers = parseCostLayers(item);
  let cogs = 0;
  const next: CostLayer[] = [];
  const consumed: CostLayer[] = [];
  for (const layer of layers) {
    if (remaining <= 0) {
      next.push(layer);
      continue;
    }
    const take = Math.min(layer.qty, remaining);
    cogs = roundMoney(cogs + take * layer.unitCost);
    consumed.push({ ...layer, qty: take });
    const left = roundMoney(layer.qty - take);
    remaining = roundMoney(remaining - take);
    if (left > 0) next.push({ ...layer, qty: left });
  }
  if (remaining > 0) {
    const unit = parseAmount(item.averageCost || item.unitCost || item.cost || item.purchasePrice);
    cogs = roundMoney(cogs + remaining * unit);
  }
  item.costLayers = serializeCostLayers(next);
  const totalQty = roundMoney(next.reduce((s, l) => s + l.qty, 0));
  const totalValue = roundMoney(next.reduce((s, l) => s + l.qty * l.unitCost, 0));
  item.quantity = String(totalQty);
  item.inventoryValue = String(totalValue);
  if (totalQty > 0) item.averageCost = String(roundMoney(totalValue / totalQty, 4));
  return { cogs, item, consumed };
}

/** Consume under LIFO (last in, first out). */
export function consumeLifo(item: ManagerRecord, qtyOut: number): ConsumeResult {
  let remaining = Math.abs(qtyOut);
  const layers = [...parseCostLayers(item)].reverse();
  let cogs = 0;
  const kept: CostLayer[] = [];
  const consumed: CostLayer[] = [];
  for (const layer of layers) {
    if (remaining <= 0) {
      kept.push(layer);
      continue;
    }
    const take = Math.min(layer.qty, remaining);
    cogs = roundMoney(cogs + take * layer.unitCost);
    consumed.push({ ...layer, qty: take });
    const left = roundMoney(layer.qty - take);
    remaining = roundMoney(remaining - take);
    if (left > 0) kept.push({ ...layer, qty: left });
  }
  if (remaining > 0) {
    const unit = parseAmount(item.averageCost || item.unitCost || item.cost);
    cogs = roundMoney(cogs + remaining * unit);
  }
  const next = kept.reverse();
  item.costLayers = serializeCostLayers(next);
  const totalQty = roundMoney(next.reduce((s, l) => s + l.qty, 0));
  const totalValue = roundMoney(next.reduce((s, l) => s + l.qty * l.unitCost, 0));
  item.quantity = String(totalQty);
  item.inventoryValue = String(totalValue);
  if (totalQty > 0) item.averageCost = String(roundMoney(totalValue / totalQty, 4));
  return { cogs, item, consumed };
}

/** Specific identification — consume a named batch/serial layer. */
export function consumeSpecificId(
  item: ManagerRecord,
  qtyOut: number,
  batchOrSerial: string,
): ConsumeResult {
  const key = batchOrSerial.trim().toLowerCase();
  const layers = parseCostLayers(item);
  let cogs = 0;
  let remaining = Math.abs(qtyOut);
  const next: CostLayer[] = [];
  const consumed: CostLayer[] = [];
  for (const layer of layers) {
    const layerKey = `${layer.batch || layer.sourceId}`.toLowerCase();
    if (remaining > 0 && layerKey === key) {
      const take = Math.min(layer.qty, remaining);
      cogs = roundMoney(cogs + take * layer.unitCost);
      consumed.push({ ...layer, qty: take });
      const left = roundMoney(layer.qty - take);
      remaining = roundMoney(remaining - take);
      if (left > 0) next.push({ ...layer, qty: left });
    } else {
      next.push(layer);
    }
  }
  // Named batch could not cover the issue — value the shortfall like FIFO/LIFO
  // do. Without this the unmatched quantity leaves stock at zero cost.
  if (remaining > 0) {
    const unit = parseAmount(item.averageCost || item.unitCost || item.cost || item.purchasePrice);
    cogs = roundMoney(cogs + remaining * unit);
  }
  item.costLayers = serializeCostLayers(next);
  // Keep quantity / value / average cost in step with the layers, exactly as
  // consumeFifo and consumeLifo do — omitting this left the item master
  // showing pre-consumption stock and valuation after every specific-id issue.
  const totalQty = roundMoney(next.reduce((s, l) => s + l.qty, 0));
  const totalValue = roundMoney(next.reduce((s, l) => s + l.qty * l.unitCost, 0));
  item.quantity = String(totalQty);
  item.inventoryValue = String(totalValue);
  if (totalQty > 0) item.averageCost = String(roundMoney(totalValue / totalQty, 4));
  return { cogs, item, consumed };
}

export function inventoryCostingMethod() {
  return loadManagerSettings().inventoryCosting || "average";
}

/** Consume inventory under the configured costing method. */
export function consumeInventoryCost(
  item: ManagerRecord,
  qtyOut: number,
  batchOrSerial?: string,
): ConsumeResult {
  const method = inventoryCostingMethod();
  if (method === "fifo") return consumeFifo(item, qtyOut);
  if (method === "lifo") return consumeLifo(item, qtyOut);
  if (method === "specific" && batchOrSerial) {
    return consumeSpecificId(item, qtyOut, batchOrSerial);
  }
  // Specific without a batch falls back to FIFO layers when present, else average.
  if (method === "specific" && parseCostLayers(item).length) {
    return consumeFifo(item, qtyOut);
  }
  const unit = Math.max(
    0,
    parseAmount(item.averageCost || item.unitCost || item.cost || item.purchasePrice),
  );
  // Average costing carries no layers, so there is nothing to attribute.
  return { cogs: roundMoney(Math.abs(qtyOut) * unit), item, consumed: [] };
}

/** Peek COGS for a qty without mutating stored layers (for GL posting). */
export function peekInventoryCogs(
  item: ManagerRecord,
  qtyOut: number,
  batchOrSerial?: string,
): number {
  const clone: ManagerRecord = {
    ...item,
    costLayers: item.costLayers,
  };
  return consumeInventoryCost(clone, qtyOut, batchOrSerial).cogs;
}
