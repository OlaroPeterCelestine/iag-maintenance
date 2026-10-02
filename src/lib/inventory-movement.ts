import { documentLinesFromRecord } from "@/lib/document-lines";
import { nextEntityCode } from "@/lib/document-references";
import { recordToBase } from "@/lib/ledger/fx";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";
import {
  addPurchaseLayer,
  consumeFifo,
  consumeLifo,
  consumeInventoryCost,
  inventoryCostingMethod,
  mergeLayers,
  parseCostLayers,
  serializeCostLayers,
  type CostLayer,
} from "@/lib/ledger/inventory-costing";

/**
 * Layers a given source document consumed, keyed by source id, parsed from
 * the item's inventoryConsumedLayers field. Editing an outflow restores these
 * before re-consuming the new quantity; without them an edit consumed the
 * full new quantity again on top of the original issue.
 */
function parseConsumedLayers(item: ManagerRecord): Record<string, CostLayer[]> {
  try {
    const raw = item.inventoryConsumedLayers
      ? (JSON.parse(item.inventoryConsumedLayers) as Record<string, CostLayer[]>)
      : {};
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** Entities that move inventory quantity when saved. */
export const QTY_OUT_ENTITIES = new Set([
  "sales-invoices",
  "credit-notes", // credit note to customer returns stock IN — handled separately
  "inventory-write-offs",
  "inventory-sales",
  "pos-sales",
]);

export const QTY_IN_ENTITIES = new Set([
  "purchase-invoices",
  "debit-notes",
  "goods-receipts",
  "stock-in",
  "pos-stock-in",
  "pos-returns",
]);

/** Which item master stock moves for a given document entity. */
export function itemStoreForEntity(entityKey: string): {
  module: string;
  entity: string;
} {
  if (
    entityKey === "pos-sales" ||
    entityKey === "pos-returns" ||
    entityKey === "pos-stock-in"
  ) {
    return { module: "pos", entity: "pos-products" };
  }
  return { module: "inventory", entity: "inventory-items" };
}

export type InventoryDelta = { itemKey: string; qty: number };

function itemLookupKey(name: string) {
  return name.trim().toLowerCase();
}

function linesToDeltas(record: ManagerRecord, sign: 1 | -1): InventoryDelta[] {
  const lines = documentLinesFromRecord(record);
  const map = new Map<string, number>();
  for (const line of lines) {
    const item = (line.item || record.item || "").trim();
    if (!item) continue;
    const qty = parseAmount(line.quantity) || (parseAmount(line.amount) ? 1 : 0);
    if (!qty) continue;
    const key = itemLookupKey(item);
    map.set(key, roundMoney((map.get(key) || 0) + sign * qty));
  }
  // Legacy single-item docs
  if (!map.size && record.item) {
    const qty = parseAmount(record.quantity) || (parseAmount(record.amount) ? 1 : 0);
    if (qty) map.set(itemLookupKey(record.item), sign * qty);
  }
  return [...map.entries()].map(([itemKey, qty]) => ({ itemKey, qty }));
}

function lineValuesByItem(record: ManagerRecord) {
  const values = new Map<string, number>();
  for (const line of documentLinesFromRecord(record)) {
    const item = (line.item || record.item || "").trim();
    if (!item) continue;
    const key = itemLookupKey(item);
    // Inventory is carried at base-currency cost, so foreign purchase lines
    // must be translated before they change the stock valuation.
    const value = Math.max(0, recordToBase(record, parseAmount(line.amount)));
    values.set(key, roundMoney((values.get(key) || 0) + value));
  }
  if (!values.size && record.item) {
    const key = itemLookupKey(record.item);
    const qty = parseAmount(record.quantity);
    const unit = parseAmount(record.unitCost || record.cost || record.purchasePrice);
    const value = Math.max(
      0,
      recordToBase(
        record,
        parseAmount(record.stockValue || record.amount) || roundMoney(qty * unit),
      ),
    );
    if (value) values.set(key, value);
  }
  return values;
}

export function inventoryDeltasForRecord(entityKey: string, record: ManagerRecord): InventoryDelta[] {
  if (/^(draft|void|voided|cancelled|canceled|inactive)$/i.test((record.status || "").trim())) {
    return [];
  }
  // Location transfers move stock between warehouses — handled separately.
  if (entityKey === "inventory-transfers") return [];
  if (entityKey === "credit-notes") {
    // Customer credit note: goods returned → qty in
    return linesToDeltas(record, 1);
  }
  if (entityKey === "debit-notes") {
    // Supplier debit note: goods returned to supplier → qty out
    return linesToDeltas(record, -1);
  }
  if (QTY_OUT_ENTITIES.has(entityKey)) return linesToDeltas(record, -1);
  if (QTY_IN_ENTITIES.has(entityKey)) return linesToDeltas(record, 1);
  if (entityKey === "inventory-write-offs" || entityKey === "inventory-sales") {
    return linesToDeltas(record, -1);
  }
  if (entityKey === "stock-in" || entityKey === "goods-receipts") {
    return linesToDeltas(record, 1);
  }
  return [];
}

function findInventoryItem(
  items: ManagerRecord[],
  itemKey: string,
): ManagerRecord | undefined {
  return items.find(
    (r) =>
      itemLookupKey(r.name || r.item || r.code || "") === itemKey ||
      itemLookupKey(r.id) === itemKey,
  );
}

type LocationTransferMove = {
  from: string;
  to: string;
  qty: number;
  /** dispatched = left source (in transit); received = arrived at destination */
  stage?: "dispatched" | "received";
};

/** Holding location while a transfer is in transit between warehouses. */
export const GOODS_IN_TRANSIT_LOCATION = "Goods in transit";

export type InventoryTransferStage = "none" | "dispatched" | "received";

/** Draft/pending = nothing; In transit = left source; Received/Complete = arrived at destination. */
export function inventoryTransferStage(status?: string): InventoryTransferStage {
  const s = (status || "").trim();
  if (!s || /^(draft|void|voided|cancelled|canceled|inactive|pending)$/i.test(s)) {
    return "none";
  }
  if (/^(in transit|dispatched|shipped|sent)$/i.test(s)) return "dispatched";
  if (/^(received|complete|completed)$/i.test(s)) return "received";
  return "none";
}

export function transferAwaitingReceipt(record: ManagerRecord) {
  return inventoryTransferStage(record.status) === "dispatched";
}

function parseLocationStock(item: ManagerRecord): Record<string, number> {
  try {
    if (item.locationStock) {
      const parsed = JSON.parse(item.locationStock) as Record<string, number>;
      if (parsed && typeof parsed === "object") {
        const next: Record<string, number> = {};
        for (const [key, value] of Object.entries(parsed)) {
          const loc = key.trim();
          if (!loc) continue;
          next[loc] = roundMoney(parseAmount(value));
        }
        return next;
      }
    }
  } catch {
    // Fall through to quantity bootstrap.
  }
  const qty = parseAmount(item.quantity);
  const loc = (item.location || "Main").trim() || "Main";
  return qty ? { [loc]: qty } : {};
}

function saveLocationStock(item: ManagerRecord, stock: Record<string, number>) {
  const cleaned: Record<string, number> = {};
  for (const [key, value] of Object.entries(stock)) {
    const loc = key.trim();
    const qty = roundMoney(value);
    if (!loc || Math.abs(qty) < 0.0001) continue;
    cleaned[loc] = qty;
  }
  item.locationStock = JSON.stringify(cleaned);
  const total = Object.values(cleaned).reduce((sum, qty) => sum + qty, 0);
  item.quantity = String(roundMoney(total));
}

/** Update location buckets after company quantity was already changed. */
function syncLocationDelta(
  item: ManagerRecord,
  location: string,
  delta: number,
) {
  let stock: Record<string, number> = {};
  try {
    stock = item.locationStock
      ? (JSON.parse(item.locationStock) as Record<string, number>)
      : {};
  } catch {
    stock = {};
  }
  const loc = location.trim() || "Main";
  if (!Object.keys(stock).length) {
    const qty = parseAmount(item.quantity);
    item.locationStock = JSON.stringify(qty ? { [loc]: roundMoney(qty) } : {});
    return;
  }
  stock = adjustLocationQty(stock, loc, delta);
  const cleaned: Record<string, number> = {};
  for (const [key, value] of Object.entries(stock)) {
    const name = key.trim();
    const qty = roundMoney(value);
    if (!name || Math.abs(qty) < 0.0001) continue;
    cleaned[name] = qty;
  }
  item.locationStock = JSON.stringify(cleaned);
}

function adjustLocationQty(
  stock: Record<string, number>,
  location: string,
  delta: number,
): Record<string, number> {
  const loc = location.trim() || "Main";
  const next = { ...stock };
  next[loc] = roundMoney((next[loc] || 0) + delta);
  if (Math.abs(next[loc]) < 0.0001) delete next[loc];
  return next;
}

function parseTransferMoves(item: ManagerRecord): Record<string, LocationTransferMove> {
  try {
    return item.inventoryTransferMoves
      ? (JSON.parse(item.inventoryTransferMoves) as Record<string, LocationTransferMove>)
      : {};
  } catch {
    return {};
  }
}

function transferIsPosted(record: ManagerRecord) {
  return inventoryTransferStage(record.status) !== "none";
}

/**
 * Move quantity between warehouses with an optional in-transit step.
 * - In transit / Dispatched: leave `from`, sit in Goods in transit
 * - Received / Complete: leave `from`, arrive at `to` (destination warehouse)
 * Company total quantity stays the same.
 */
function applyInventoryTransferMovement(opts: {
  record: ManagerRecord;
  previous?: ManagerRecord | null;
  removing?: boolean;
}) {
  const { record, previous, removing } = opts;
  const itemName = (record.item || "").trim();
  if (!itemName && !(previous?.item || "").trim()) return;

  const items = loadRecords("inventory", "inventory-items");
  const item =
    findInventoryItem(items, itemLookupKey(itemName || previous?.item || "")) ||
    findInventoryItem(items, itemLookupKey(previous?.item || ""));
  if (!item) return;

  const sourceId = record.id;
  const transferMoves = parseTransferMoves(item);
  let stock = parseLocationStock(item);
  let changed = false;

  const reverseMove = (move: LocationTransferMove | undefined) => {
    if (!move?.qty) return;
    const stage = move.stage === "dispatched" ? "dispatched" : "received";
    stock = adjustLocationQty(stock, move.from, move.qty);
    if (stage === "dispatched") {
      stock = adjustLocationQty(stock, GOODS_IN_TRANSIT_LOCATION, -move.qty);
    } else {
      stock = adjustLocationQty(stock, move.to, -move.qty);
    }
    changed = true;
  };

  const prior = transferMoves[sourceId];
  if (prior) {
    reverseMove(prior);
    delete transferMoves[sourceId];
    changed = true;
  }

  // If the prior document pointed at a different item, reverse there too.
  if (previous?.item && itemLookupKey(previous.item) !== itemLookupKey(item.name || item.item || "")) {
    const priorItem = findInventoryItem(items, itemLookupKey(previous.item));
    if (priorItem) {
      const priorMoves = parseTransferMoves(priorItem);
      const priorMove = priorMoves[sourceId];
      if (priorMove) {
        let priorStock = parseLocationStock(priorItem);
        const stage = priorMove.stage === "dispatched" ? "dispatched" : "received";
        priorStock = adjustLocationQty(priorStock, priorMove.from, priorMove.qty);
        if (stage === "dispatched") {
          priorStock = adjustLocationQty(priorStock, GOODS_IN_TRANSIT_LOCATION, -priorMove.qty);
        } else {
          priorStock = adjustLocationQty(priorStock, priorMove.to, -priorMove.qty);
        }
        delete priorMoves[sourceId];
        saveLocationStock(priorItem, priorStock);
        priorItem.inventoryTransferMoves = JSON.stringify(priorMoves);
        changed = true;
      }
    }
  }

  if (!removing && transferIsPosted(record)) {
    const qty = parseAmount(record.quantity);
    const from = (record.from || "").trim();
    const to = (record.to || "").trim();
    const stage = inventoryTransferStage(record.status);
    if (qty > 0 && from && to && from.toLowerCase() !== to.toLowerCase() && stage !== "none") {
      stock = adjustLocationQty(stock, from, -qty);
      if (stage === "dispatched") {
        stock = adjustLocationQty(stock, GOODS_IN_TRANSIT_LOCATION, qty);
      } else {
        stock = adjustLocationQty(stock, to, qty);
        item.location = to;
      }
      transferMoves[sourceId] = { from, to, qty, stage };
      changed = true;
    }
  }

  if (changed) {
    saveLocationStock(item, stock);
    item.inventoryTransferMoves = JSON.stringify(transferMoves);
    void saveRecords("inventory", "inventory-items", items).then((saved) => {
      if (!saved.ok || saved.durable !== "postgres") {
        notifyPersistFailure(
          "inventory/inventory-items",
          saved.error || "Could not save an inventory transfer movement.",
        );
      }
    });
  }
}

/**
 * Apply quantity movements for a document. Tracks prior deltas per source record
 * in `inventoryMoves` JSON on each inventory item so edits/deletes are reversible.
 */
export function applyInventoryMovement(opts: {
  entityKey: string;
  record: ManagerRecord;
  previous?: ManagerRecord | null;
  removing?: boolean;
}) {
  const { entityKey, record, previous, removing } = opts;

  if (entityKey === "inventory-transfers") {
    applyInventoryTransferMovement({ record, previous, removing });
    return;
  }

  const newDeltas = removing ? [] : inventoryDeltasForRecord(entityKey, record);
  const oldDeltas = previous ? inventoryDeltasForRecord(entityKey, previous) : [];

  // Net change by item: -old + new
  const net = new Map<string, number>();
  for (const d of oldDeltas) net.set(d.itemKey, roundMoney((net.get(d.itemKey) || 0) - d.qty));
  for (const d of newDeltas) net.set(d.itemKey, roundMoney((net.get(d.itemKey) || 0) + d.qty));

  if (![...net.values()].some((v) => v !== 0) && !oldDeltas.length && !newDeltas.length) {
    return;
  }

  const itemStore = itemStoreForEntity(entityKey);
  const items = loadRecords(itemStore.module, itemStore.entity);
  let changed = false;
  const sourceId = record.id;
  const lineValues = lineValuesByItem(record);

  for (const [itemKey, delta] of net) {
    if (!delta && !oldDeltas.some((d) => d.itemKey === itemKey)) continue;
    const item = findInventoryItem(items, itemKey);
    if (!item) continue;

    let moves: Record<string, number> = {};
    let valueMoves: Record<string, number> = {};
    try {
      moves = item.inventoryMoves ? (JSON.parse(item.inventoryMoves) as Record<string, number>) : {};
    } catch {
      moves = {};
    }
    try {
      valueMoves = item.inventoryValueMoves
        ? (JSON.parse(item.inventoryValueMoves) as Record<string, number>)
        : {};
    } catch {
      valueMoves = {};
    }

    const priorMove = moves[sourceId] || 0;
    const nextMove = removing
      ? 0
      : roundMoney(newDeltas.find((d) => d.itemKey === itemKey)?.qty || 0);
    const currentQty = parseAmount(item.quantity);
    const currentAverageCost = Math.max(
      0,
      parseAmount(item.averageCost || item.unitCost || item.cost || item.purchasePrice),
    );
    const currentValue =
      item.inventoryValue !== undefined && item.inventoryValue !== ""
        ? parseAmount(item.inventoryValue)
        : roundMoney(currentQty * currentAverageCost);
    const priorValueMove = valueMoves[sourceId] || 0;
    const documentValue = lineValues.get(itemKey) || 0;
    const fifoOn =
      inventoryCostingMethod() === "fifo" ||
      inventoryCostingMethod() === "lifo" ||
      inventoryCostingMethod() === "specific";
    const isPurchaseIn =
      entityKey === "purchase-invoices" ||
      entityKey === "goods-receipts" ||
      entityKey === "stock-in" ||
      entityKey === "pos-stock-in" ||
      (entityKey === "debit-notes" && nextMove > 0);

    if (fifoOn && !removing) {
      // Rebuild this source's layer contribution from scratch on each save.
      const layersWithout = parseCostLayers(item).filter((l) => l.sourceId !== sourceId);
      item.costLayers = JSON.stringify(layersWithout);

      if (isPurchaseIn && nextMove > 0) {
        const unit = roundMoney(documentValue / nextMove, 4);
        addPurchaseLayer(
          item,
          nextMove,
          unit,
          record.date || record.issueDate || new Date().toISOString().slice(0, 10),
          sourceId,
        );
        moves[sourceId] = nextMove;
        valueMoves[sourceId] = roundMoney(documentValue);
        item.inventoryMoves = JSON.stringify(moves);
        item.inventoryValueMoves = JSON.stringify(valueMoves);
        syncLocationDelta(
          item,
          record.location || item.location || "Main",
          nextMove - priorMove,
        );
        changed = true;
        continue;
      }

      if (nextMove < 0) {
        // Put back whatever this same document consumed last time before
        // re-consuming, mirroring how the purchase branch above rebuilds this
        // source's layers from scratch. Legacy rows saved before consumption
        // was attributed have no entry here and simply restore nothing.
        const consumedBySource = parseConsumedLayers(item);
        const priorConsumed = consumedBySource[sourceId] || [];
        if (priorConsumed.length) {
          item.costLayers = serializeCostLayers(
            mergeLayers(parseCostLayers(item), priorConsumed),
          );
        }
        const { cogs, consumed } =
          inventoryCostingMethod() === "lifo"
            ? consumeLifo(item, Math.abs(nextMove))
            : inventoryCostingMethod() === "specific"
              ? consumeInventoryCost(item, Math.abs(nextMove), record.batch || record.serial)
              : consumeFifo(item, Math.abs(nextMove));
        consumedBySource[sourceId] = consumed;
        item.inventoryConsumedLayers = JSON.stringify(consumedBySource);
        moves[sourceId] = nextMove;
        valueMoves[sourceId] = -cogs;
        item.inventoryMoves = JSON.stringify(moves);
        item.inventoryValueMoves = JSON.stringify(valueMoves);
        syncLocationDelta(
          item,
          record.location || item.location || "Main",
          nextMove - priorMove,
        );
        changed = true;
        continue;
      }
    }

    const nextValueMove = removing
      ? 0
      : isPurchaseIn ||
          entityKey === "purchase-invoices" ||
          entityKey === "goods-receipts" ||
          entityKey === "stock-in" ||
          entityKey === "pos-stock-in" ||
          entityKey === "debit-notes"
        ? roundMoney(Math.sign(nextMove) * documentValue)
        : roundMoney(nextMove * currentAverageCost);

    const adjustment = roundMoney(nextMove - priorMove);
    if (!adjustment && nextMove === priorMove && nextValueMove === priorValueMove) {
      continue;
    }

    const qty = roundMoney(currentQty + adjustment);
    const inventoryValue = roundMoney(Math.max(0, currentValue - priorValueMove + nextValueMove));
    item.quantity = String(qty);
    item.inventoryValue = String(inventoryValue);
    if (qty > 0) item.averageCost = String(roundMoney(inventoryValue / qty, 4));
    syncLocationDelta(item, record.location || item.location || "Main", adjustment);
    if (removing || nextMove === 0) {
      delete moves[sourceId];
      delete valueMoves[sourceId];
      if (fifoOn) {
        // Drop layers this source contributed as a purchase…
        let layers = parseCostLayers(item).filter((l) => l.sourceId !== sourceId);
        // …and hand back whatever it consumed as an issue, so deleting a sale
        // returns that stock to the layer pool instead of losing it.
        const consumedBySource = parseConsumedLayers(item);
        const priorConsumed = consumedBySource[sourceId] || [];
        if (priorConsumed.length) {
          layers = mergeLayers(layers, priorConsumed);
          delete consumedBySource[sourceId];
          item.inventoryConsumedLayers = JSON.stringify(consumedBySource);
        }
        item.costLayers = serializeCostLayers(layers);
      }
    } else {
      moves[sourceId] = nextMove;
      valueMoves[sourceId] = nextValueMove;
    }
    item.inventoryMoves = JSON.stringify(moves);
    item.inventoryValueMoves = JSON.stringify(valueMoves);
    changed = true;
  }

  // Also clear moves for items that were on old doc but not in net (item renamed)
  if (previous) {
    for (const d of oldDeltas) {
      if (net.has(d.itemKey)) continue;
      const item = findInventoryItem(items, d.itemKey);
      if (!item) continue;
      let moves: Record<string, number> = {};
      let valueMoves: Record<string, number> = {};
      try {
        moves = item.inventoryMoves ? (JSON.parse(item.inventoryMoves) as Record<string, number>) : {};
      } catch {
        moves = {};
      }
      try {
        valueMoves = item.inventoryValueMoves
          ? (JSON.parse(item.inventoryValueMoves) as Record<string, number>)
          : {};
      } catch {
        valueMoves = {};
      }
      const priorMove = moves[sourceId] || 0;
      if (!priorMove) continue;
      const priorValueMove = valueMoves[sourceId] || 0;
      const quantity = roundMoney(parseAmount(item.quantity) - priorMove);
      const inventoryValue = roundMoney(
        Math.max(0, parseAmount(item.inventoryValue) - priorValueMove),
      );
      item.quantity = String(quantity);
      item.inventoryValue = String(inventoryValue);
      if (quantity > 0) item.averageCost = String(roundMoney(inventoryValue / quantity, 4));
      delete moves[sourceId];
      delete valueMoves[sourceId];
      item.inventoryMoves = JSON.stringify(moves);
      item.inventoryValueMoves = JSON.stringify(valueMoves);
      changed = true;
    }
  }

  if (changed) {
    void saveRecords(itemStore.module, itemStore.entity, items).then((saved) => {
      if (!saved.ok || saved.durable !== "postgres") {
        notifyPersistFailure(
          `${itemStore.module}/${itemStore.entity}`,
          saved.error ||
            "A stock movement was applied in this tab but could not be saved to the database.",
        );
      }
    });
  }
}

export function inventoryOnHandSummary() {
  const items = loadRecords("inventory", "inventory-items");
  return items.map((item) => ({
    id: item.id,
    code: item.code || item.sku || "",
    name: item.name || item.item || item.code || "Item",
    quantity: parseAmount(item.quantity),
    unitCost: parseAmount(item.averageCost || item.unitCost || item.cost || item.purchasePrice),
    value:
      item.inventoryValue !== undefined && item.inventoryValue !== ""
        ? parseAmount(item.inventoryValue)
        : roundMoney(
            parseAmount(item.quantity) *
              parseAmount(item.averageCost || item.unitCost || item.cost || item.purchasePrice),
          ),
  }));
}

type InventoryMoveKind = "stock-in" | "write-off" | "sold" | "other";

/** Map document ids → how they affect the stock rollforward. */
function inventorySourceKindLookup(): Map<string, InventoryMoveKind> {
  const map = new Map<string, InventoryMoveKind>();
  const buckets: { module: string; entity: string; kind: InventoryMoveKind }[] = [
    { module: "inventory", entity: "stock-in", kind: "stock-in" },
    { module: "purchases", entity: "goods-receipts", kind: "stock-in" },
    { module: "purchases", entity: "purchase-invoices", kind: "stock-in" },
    { module: "sales", entity: "credit-notes", kind: "stock-in" },
    { module: "inventory", entity: "inventory-write-offs", kind: "write-off" },
    { module: "purchases", entity: "debit-notes", kind: "write-off" },
    { module: "inventory", entity: "inventory-sales", kind: "sold" },
    { module: "sales", entity: "sales-invoices", kind: "sold" },
  ];
  for (const bucket of buckets) {
    for (const row of loadRecords(bucket.module, bucket.entity)) {
      map.set(row.id, bucket.kind);
    }
  }
  return map;
}

function parseMoveMap(raw: string | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

export type InventoryItemRollforward = {
  id: string;
  code: string;
  name: string;
  openingQty: number;
  stockInQty: number;
  writeOffQty: number;
  soldQty: number;
  closingQty: number;
  openingValue: number;
  stockInValue: number;
  writeOffValue: number;
  soldValue: number;
  /** opening + stock-in − write-offs − sold */
  stockValue: number;
  closingValue: number;
};

export type InventoryStockRollforward = {
  items: InventoryItemRollforward[];
  totalInventoryQty: number;
  openingQty: number;
  stockInQty: number;
  writeOffQty: number;
  soldQty: number;
  closingQty: number;
  openingValue: number;
  stockInValue: number;
  writeOffValue: number;
  soldValue: number;
  /** opening + stock-in − write-offs − sold */
  stockValue: number;
  closingValue: number;
};

/**
 * Stock rollforward: opening + stock-in − write-offs − sold = closing.
 * Quantities and cost values come from each item's opening fields and movement audit maps.
 */
export function inventoryStockRollforward(): InventoryStockRollforward {
  const kinds = inventorySourceKindLookup();
  const items = loadRecords("inventory", "inventory-items").map((item) => {
    const moves = parseMoveMap(item.inventoryMoves);
    const valueMoves = parseMoveMap(item.inventoryValueMoves);
    const closingQty = parseAmount(item.quantity || item.closingStock);
    const movementQty = Object.values(moves).reduce((sum, value) => sum + parseAmount(value), 0);
    const openingQty =
      item.openingStock !== undefined && String(item.openingStock).trim() !== ""
        ? parseAmount(item.openingStock)
        : roundMoney(closingQty - movementQty);

    const unit =
      parseAmount(item.unitValue) ||
      parseAmount(item.averageCost || item.unitCost || item.cost || item.purchasePrice);
    const closingValue =
      item.inventoryValue !== undefined && String(item.inventoryValue).trim() !== ""
        ? parseAmount(item.inventoryValue)
        : roundMoney(closingQty * unit);
    const movementValue = Object.values(valueMoves).reduce(
      (sum, value) => sum + parseAmount(value),
      0,
    );
    const openingValue = roundMoney(
      item.openingStock !== undefined && String(item.openingStock).trim() !== ""
        ? Math.max(0, openingQty * unit)
        : Math.max(0, closingValue - movementValue),
    );

    let stockInQty = 0;
    let writeOffQty = 0;
    let soldQty = 0;
    let stockInValue = 0;
    let writeOffValue = 0;
    let soldValue = 0;

    const sourceIds = new Set([...Object.keys(moves), ...Object.keys(valueMoves)]);
    for (const sourceId of sourceIds) {
      const qty = parseAmount(moves[sourceId] || 0);
      const value = parseAmount(valueMoves[sourceId] || 0);
      const kind = kinds.get(sourceId);
      if (kind === "stock-in" || (!kind && qty >= 0)) {
        stockInQty = roundMoney(stockInQty + Math.max(0, qty));
        stockInValue = roundMoney(stockInValue + Math.max(0, value));
      } else if (kind === "sold") {
        soldQty = roundMoney(soldQty + Math.max(0, -qty));
        soldValue = roundMoney(soldValue + Math.max(0, -value));
      } else {
        // Write-offs and any other outflow (e.g. supplier debit notes).
        writeOffQty = roundMoney(writeOffQty + Math.max(0, -qty));
        writeOffValue = roundMoney(writeOffValue + Math.max(0, -value));
      }
    }

    const stockValue = roundMoney(
      openingValue + stockInValue - writeOffValue - soldValue,
    );

    return {
      id: item.id,
      code: item.code || item.sku || "",
      name: item.name || item.item || item.code || "Item",
      openingQty,
      stockInQty,
      writeOffQty,
      soldQty,
      closingQty,
      openingValue,
      stockInValue,
      writeOffValue,
      soldValue,
      stockValue,
      closingValue,
    };
  });

  const sum = (pick: (row: InventoryItemRollforward) => number) =>
    roundMoney(items.reduce((total, row) => total + pick(row), 0));

  return {
    items,
    totalInventoryQty: sum((row) => row.closingQty),
    openingQty: sum((row) => row.openingQty),
    stockInQty: sum((row) => row.stockInQty),
    writeOffQty: sum((row) => row.writeOffQty),
    soldQty: sum((row) => row.soldQty),
    closingQty: sum((row) => row.closingQty),
    openingValue: sum((row) => row.openingValue),
    stockInValue: sum((row) => row.stockInValue),
    writeOffValue: sum((row) => row.writeOffValue),
    soldValue: sum((row) => row.soldValue),
    stockValue: sum((row) => row.stockValue),
    closingValue: sum((row) => row.closingValue),
  };
}

/** Stock by store/warehouse for an inventory item. */
export function inventoryLocationQuantities(item: ManagerRecord): Record<string, number> {
  return parseLocationStock(item);
}

export type InventorySelectOption = {
  value: string;
  label: string;
  code: string;
  name: string;
  salesPrice: string;
  purchasePrice: string;
  description: string;
  salesAccount: string;
  purchaseAccount: string;
  quantity: number;
  imageUrl: string;
  /** Inventory stock item vs non-inventory service / charge. */
  kind: "inventory" | "service";
};

function mapItemRecord(
  item: ManagerRecord,
  kind: "inventory" | "service",
): InventorySelectOption | null {
  const name = (item.name || item.item || "").trim();
  const code = (item.code || item.sku || "").trim();
  const value = name || code;
  if (!value) return null;
  return {
    value,
    code,
    name: name || code,
    label: code ? `${code} — ${name || "Item"}` : name || "Item",
    salesPrice: item.salesPrice || item.unitPrice || "",
    purchasePrice: item.purchasePrice || item.unitCost || item.cost || "",
    description: item.description || name || "",
    salesAccount: item.salesAccount || item.account || "",
    purchaseAccount: item.purchaseAccount || item.account || "",
    quantity: kind === "inventory" ? parseAmount(item.quantity) : 0,
    imageUrl: item.imageUrl || item.image || "",
    kind,
  };
}

/** Inventory items for document line pickers. */
export function inventoryItemSelectOptions(): InventorySelectOption[] {
  return loadRecords("inventory", "inventory-items")
    .filter((r) => !/inactive|obsolete/i.test(r.status || ""))
    .map((item) => mapItemRecord(item, "inventory"))
    .filter((o): o is InventorySelectOption => Boolean(o))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** POS-only products (separate from Inventory → Inventory items). */
export function posProductSelectOptions(): InventorySelectOption[] {
  return loadRecords("pos", "pos-products")
    .filter((r) => !/inactive|obsolete|discontinued/i.test(r.status || ""))
    .map((item) => mapItemRecord(item, "inventory"))
    .filter((o): o is InventorySelectOption => Boolean(o))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Non-inventory items (services / charges) for document line pickers. */
export function nonInventoryItemSelectOptions(): InventorySelectOption[] {
  return loadRecords("inventory", "non-inventory-items")
    .filter((r) => !/inactive|obsolete/i.test(r.status || ""))
    .map((item) => mapItemRecord(item, "service"))
    .filter((o): o is InventorySelectOption => Boolean(o))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Inventory + services for invoice / bill line pickers. */
export function documentItemSelectOptions(): InventorySelectOption[] {
  return [...inventoryItemSelectOptions(), ...nonInventoryItemSelectOptions()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "inventory" ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export type NewInventoryItemInput = {
  name: string;
  code?: string;
  salesPrice?: string;
  purchasePrice?: string;
  quantity?: string;
  salesAccount?: string;
  purchaseAccount?: string;
  description?: string;
  kind?: "inventory" | "service";
};

/** Create an inventory or service item from a document line picker. */
export function createInventoryItem(input: NewInventoryItemInput): InventorySelectOption {
  const name = input.name.trim();
  if (!name) throw new Error("Item name is required.");
  const kind = input.kind === "service" ? "service" : "inventory";
  const now = new Date().toISOString();
  const entity = kind === "service" ? "non-inventory-items" : "inventory-items";
  const existing = loadRecords("inventory", entity);
  const code =
    (input.code || "").trim() ||
    nextEntityCode(entity, existing, kind === "service" ? "Non-inventory Items" : "Inventory Items");
  const record: ManagerRecord = {
    id: globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}`,
    name,
    code,
    salesPrice: input.salesPrice || "",
    purchasePrice: input.purchasePrice || "",
    quantity: kind === "inventory" ? input.quantity || "0" : "",
    salesAccount: input.salesAccount || "",
    purchaseAccount: input.purchaseAccount || "",
    description: input.description || name,
    unit: "",
    location: "",
    reorderLevel: "",
    status: "Active",
    createdAt: now,
    updatedAt: now,
  };
  void saveRecords("inventory", entity, [record, ...existing]).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        `inventory/${entity}`,
        saved.error || `Could not save the new item "${name}".`,
      );
    }
  });
  return {
    value: name,
    code,
    name,
    label: code ? `${code} — ${name}` : name,
    salesPrice: record.salesPrice,
    purchasePrice: record.purchasePrice,
    description: record.description,
    salesAccount: record.salesAccount,
    purchaseAccount: record.purchaseAccount,
    quantity: kind === "inventory" ? parseAmount(record.quantity) : 0,
    imageUrl: "",
    kind,
  };
}

export type InventoryLocationOption = {
  value: string;
  label: string;
  code: string;
  address: string;
  kind?: string;
};

/** Active stores / warehouses for location pickers. */
export function inventoryLocationSelectOptions(): InventoryLocationOption[] {
  return loadRecords("inventory", "inventory-locations")
    .filter((location) => !/inactive|obsolete|archived/i.test(location.status || ""))
    .map((location): InventoryLocationOption | null => {
      const name = (location.name || location.location || location.code || "").trim();
      const code = (location.code || "").trim();
      const kind = (location.kind || location.type || "location").trim();
      if (!name) return null;
      return {
        value: name,
        label: code ? `${code} — ${name}` : name,
        code,
        address: location.address || location.description || "",
        kind,
      };
    })
    .filter((location): location is InventoryLocationOption => location != null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export type NewInventoryLocationInput = {
  name: string;
  code?: string;
  address?: string;
  kind?: "warehouse" | "store" | "location";
};

/** Create a store / warehouse from a location picker. */
export function createInventoryLocation(
  input: NewInventoryLocationInput,
): InventoryLocationOption {
  const name = input.name.trim();
  if (!name) throw new Error("Location name is required.");
  const kind = input.kind || "warehouse";
  const existing = loadRecords("inventory", "inventory-locations");
  const duplicate = existing.find(
    (row) => (row.name || row.location || "").trim().toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) {
    const code = (duplicate.code || "").trim();
    return {
      value: name,
      code,
      label: code ? `${code} — ${name}` : name,
      address: duplicate.address || duplicate.description || "",
      kind: duplicate.kind || duplicate.type || kind,
    };
  }
  const now = new Date().toISOString();
  const prefix =
    kind === "warehouse" ? "WH-" : kind === "store" ? "ST-" : "LOC-";
  const code =
    (input.code || "").trim() ||
    nextEntityCode("inventory-locations", existing, "Inventory Locations").replace(
      /^LOC-/i,
      prefix,
    );
  const record: ManagerRecord = {
    id: globalThis.crypto?.randomUUID?.() ?? `location-${Date.now()}`,
    name,
    code,
    kind,
    type: kind,
    address: (input.address || "").trim(),
    status: "Active",
    createdAt: now,
    updatedAt: now,
  };
  void saveRecords("inventory", "inventory-locations", [record, ...existing]).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "inventory/inventory-locations",
        saved.error || `Could not save the new location "${name}".`,
      );
    }
  });
  return {
    value: name,
    code,
    label: code ? `${code} — ${name}` : name,
    address: record.address,
    kind,
  };
}

/** Active POS sales places (stores, kiosks, stalls, counters). */
export function posLocationSelectOptions(): InventoryLocationOption[] {
  return loadRecords("pos", "pos-locations")
    .filter((location) => !/inactive|obsolete|archived/i.test(location.status || ""))
    .map((location): InventoryLocationOption | null => {
      const name = (location.name || location.location || location.code || "").trim();
      const code = (location.code || "").trim();
      const kind = (location.kind || location.type || "store").trim();
      if (!name) return null;
      return {
        value: name,
        label: code ? `${code} — ${name}` : name,
        code,
        address: location.address || location.description || "",
        kind,
      };
    })
    .filter((location): location is InventoryLocationOption => location != null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export type NewPosLocationInput = {
  name: string;
  code?: string;
  address?: string;
  kind?: "store" | "kiosk" | "counter" | "stall" | "branch" | "market" | "other";
};

/** Create a POS sales place from a location picker. */
export function createPosLocation(input: NewPosLocationInput): InventoryLocationOption {
  const name = input.name.trim();
  if (!name) throw new Error("Location name is required.");
  const kind = input.kind || "store";
  const existing = loadRecords("pos", "pos-locations");
  const duplicate = existing.find(
    (row) => (row.name || row.location || "").trim().toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) {
    const code = (duplicate.code || "").trim();
    return {
      value: name,
      code,
      label: code ? `${code} — ${name}` : name,
      address: duplicate.address || duplicate.description || "",
      kind: duplicate.kind || duplicate.type || kind,
    };
  }
  const now = new Date().toISOString();
  const prefixMap: Record<string, string> = {
    store: "POS-",
    kiosk: "KSK-",
    counter: "CTR-",
    stall: "STL-",
    branch: "BR-",
    market: "MKT-",
    other: "PLC-",
  };
  const prefix = prefixMap[kind] || "POS-";
  const code =
    (input.code || "").trim() ||
    nextEntityCode("pos-locations", existing, "POS Locations").replace(/^LOC-/i, prefix);
  const record: ManagerRecord = {
    id: globalThis.crypto?.randomUUID?.() ?? `pos-location-${Date.now()}`,
    name,
    code,
    kind,
    type: kind,
    address: (input.address || "").trim(),
    status: "Active",
    createdAt: now,
    updatedAt: now,
  };
  void saveRecords("pos", "pos-locations", [record, ...existing]).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "pos/pos-locations",
        saved.error || `Could not save the new POS location "${name}".`,
      );
    }
  });
  return {
    value: name,
    code,
    label: code ? `${code} — ${name}` : name,
    address: record.address,
    kind,
  };
}

function findLocationRecord(
  module: "inventory" | "pos",
  entity: "inventory-locations" | "pos-locations",
  nameOrCode: string,
): ManagerRecord | null {
  const key = nameOrCode.trim().toLowerCase();
  if (!key) return null;
  return (
    loadRecords(module, entity).find((row) => {
      const name = (row.name || row.location || "").trim().toLowerCase();
      const code = (row.code || "").trim().toLowerCase();
      return name === key || code === key;
    }) || null
  );
}

function toLocationOption(record: ManagerRecord, fallbackKind: string): InventoryLocationOption {
  const name = (record.name || record.location || "").trim();
  const code = (record.code || "").trim();
  return {
    value: name,
    code,
    label: code ? `${code} — ${name}` : name,
    address: record.address || record.description || "",
    kind: record.kind || record.type || fallbackKind,
  };
}

/** Update an existing Inventory → Locations row (matched by previous name/code). */
export function updateInventoryLocation(
  previousName: string,
  input: NewInventoryLocationInput,
): InventoryLocationOption {
  const name = input.name.trim();
  if (!name) throw new Error("Location name is required.");
  const existing = loadRecords("inventory", "inventory-locations");
  const current = findLocationRecord("inventory", "inventory-locations", previousName);
  if (!current) throw new Error("Location not found.");
  const clash = existing.find(
    (row) =>
      row.id !== current.id &&
      (row.name || row.location || "").trim().toLowerCase() === name.toLowerCase(),
  );
  if (clash) throw new Error("Another location already uses that name.");
  const kind = input.kind || (current.kind as NewInventoryLocationInput["kind"]) || "warehouse";
  const code = (input.code || "").trim() || (current.code || "").trim();
  const next: ManagerRecord = {
    ...current,
    name,
    code,
    kind,
    type: kind,
    address: (input.address || "").trim(),
    updatedAt: new Date().toISOString(),
  };
  void saveRecords(
    "inventory",
    "inventory-locations",
    existing.map((row) => (row.id === current.id ? next : row)),
  ).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "inventory/inventory-locations",
        saved.error || `Could not save changes to location "${name}".`,
      );
    }
  });
  return toLocationOption(next, kind);
}

/** Soft-delete (Inactive) an inventory location. */
export function deleteInventoryLocation(nameOrCode: string): void {
  const existing = loadRecords("inventory", "inventory-locations");
  const current = findLocationRecord("inventory", "inventory-locations", nameOrCode);
  if (!current) throw new Error("Location not found.");
  void saveRecords(
    "inventory",
    "inventory-locations",
    existing.map((row) =>
      row.id === current.id
        ? { ...row, status: "Inactive", updatedAt: new Date().toISOString() }
        : row,
    ),
  ).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "inventory/inventory-locations",
        saved.error || `Could not delete location "${nameOrCode}".`,
      );
    }
  });
}

/** Update an existing POS → POS Locations row. */
export function updatePosLocation(
  previousName: string,
  input: NewPosLocationInput,
): InventoryLocationOption {
  const name = input.name.trim();
  if (!name) throw new Error("Location name is required.");
  const existing = loadRecords("pos", "pos-locations");
  const current = findLocationRecord("pos", "pos-locations", previousName);
  if (!current) throw new Error("POS location not found.");
  const clash = existing.find(
    (row) =>
      row.id !== current.id &&
      (row.name || row.location || "").trim().toLowerCase() === name.toLowerCase(),
  );
  if (clash) throw new Error("Another POS location already uses that name.");
  const kind = input.kind || (current.kind as NewPosLocationInput["kind"]) || "store";
  const code = (input.code || "").trim() || (current.code || "").trim();
  const next: ManagerRecord = {
    ...current,
    name,
    code,
    kind,
    type: kind,
    address: (input.address || "").trim(),
    updatedAt: new Date().toISOString(),
  };
  void saveRecords(
    "pos",
    "pos-locations",
    existing.map((row) => (row.id === current.id ? next : row)),
  ).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "pos/pos-locations",
        saved.error || `Could not save changes to POS location "${name}".`,
      );
    }
  });
  return toLocationOption(next, kind);
}

/** Soft-delete (Inactive) a POS location. */
export function deletePosLocation(nameOrCode: string): void {
  const existing = loadRecords("pos", "pos-locations");
  const current = findLocationRecord("pos", "pos-locations", nameOrCode);
  if (!current) throw new Error("POS location not found.");
  void saveRecords(
    "pos",
    "pos-locations",
    existing.map((row) =>
      row.id === current.id
        ? { ...row, status: "Inactive", updatedAt: new Date().toISOString() }
        : row,
    ),
  ).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "pos/pos-locations",
        saved.error || `Could not delete POS location "${nameOrCode}".`,
      );
    }
  });
}
