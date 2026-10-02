/**
 * POS terminal operations — retail + restaurant, all sellables, inventory-aware checkout.
 */

import { nextDocumentReference } from "@/lib/document-references";
import { applyInventoryMovement } from "@/lib/inventory-movement";
import { postRecordToLedger } from "@/lib/ledger/api-post";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecords, saveRecordsAsync } from "@/lib/records-store";
import { awaitInFlightPersists, awaitLedgerLinesPersist } from "@/lib/db/sync";
import { removePostingsForSource } from "@/lib/ledger/posting";
import { readAuthSession } from "@/lib/auth";
import {
  USERS_KEY,
  loadList,
  TAX_CODES_KEY,
  defaultTaxCodes,
  type TaxCodeRow,
} from "@/lib/manager-settings";

export type PosLineKind = "inventory" | "service" | "open";
export type PosServiceType = "Walk-in" | "Dine-in" | "Takeaway" | "Delivery";
export type PosCatalogFilter = "all" | "stock" | "services";

/** Default VAT rate from Settings → Tax codes (first VAT-like code, else 18). */
export function defaultPosVatRate(): number {
  try {
    const codes = loadList(TAX_CODES_KEY, defaultTaxCodes) as TaxCodeRow[];
    const vat = codes.find((c) => /vat/i.test(c.name || c.label || ""));
    const rate = parseAmount(vat?.rate || codes[0]?.rate || "18");
    return rate > 0 ? rate : 0;
  } catch {
    return 18;
  }
}

/** Split tax-inclusive amount into net + VAT. */
export function splitInclusiveVat(gross: number, ratePercent: number) {
  if (!ratePercent || ratePercent <= 0 || gross <= 0) {
    return { net: roundMoney(gross), tax: 0 };
  }
  const net = roundMoney(gross / (1 + ratePercent / 100));
  const tax = roundMoney(gross - net);
  return { net, tax };
}

export type PosSellable = {
  id: string;
  name: string;
  code: string;
  kind: PosLineKind;
  unitPrice: number;
  location: string;
  quantityOnHand: number | null;
  salesAccount: string;
  tracksStock: boolean;
  category: string;
};

export type PosCartLine = {
  key: string;
  itemId: string;
  itemName: string;
  kind: PosLineKind;
  location: string;
  unitPrice: number;
  quantity: number;
  salesAccount: string;
  tracksStock: boolean;
  modifiers: string;
  note: string;
};

export type PosCheckoutInput = {
  register: ManagerRecord;
  session: ManagerRecord;
  lines: PosCartLine[];
  tender: "Cash" | "Card" | "Mobile money" | "Other";
  customer?: string;
  amountTendered?: number;
  date?: string;
  serviceType?: PosServiceType;
  tableName?: string;
  tipAmount?: number;
  tipPercent?: number;
  openTicketId?: string;
  /** Tax-inclusive VAT %. 0 = no VAT. Default from Settings tax codes. */
  taxRate?: number;
  applyVat?: boolean;
};

export type PosCheckoutResult = {
  sales: ManagerRecord[];
  ticketTotal: number;
  tipAmount: number;
  change: number;
  ticketRef: string;
};

function todayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function cashierName() {
  const session = readAuthSession();
  if (!session) return "Cashier";
  try {
    const users = loadList<{ id?: string; email?: string; name?: string }>(USERS_KEY, []);
    const match = session.userId
      ? users.find((u) => u.id === session.userId)
      : undefined;
    if (match?.name) return match.name;
    if (session.name?.trim()) return session.name.trim();
  } catch {
    /* ignore */
  }
  return session.email.split("@")[0] || "Cashier";
}

export function activeRegisters(): ManagerRecord[] {
  return loadRecords("pos", "registers").filter(
    (r) => r.name?.trim() && !/inactive|void|archived/i.test(r.status || ""),
  );
}

export function openSessionsForRegister(registerName: string): ManagerRecord[] {
  return loadRecords("pos", "cash-sessions").filter(
    (s) =>
      s.register === registerName &&
      /^open$/i.test((s.status || "").trim()),
  );
}

export function ensureDefaultPosLocations(): ManagerRecord[] {
  // Do not invent POS locations in the browser — API/Postgres only.
  return loadRecords("pos", "pos-locations");
}

export function posSalesPlaces(): ManagerRecord[] {
  return loadRecords("pos", "pos-locations").filter(
    (l) => l.name?.trim() && !/inactive|void|archived/i.test(l.status || ""),
  );
}

export function ensureDefaultRegister(): ManagerRecord | null {
  // Do not invent registers in the browser — use whatever the API hydrated.
  const existing = activeRegisters();
  if (existing[0]) return existing[0];
  return null;
}

export function ensureDefaultDiningTables(): ManagerRecord[] {
  // Do not invent dining tables in the browser — API/Postgres only.
  return loadRecords("pos", "dining-tables");
}

export function diningTables(): ManagerRecord[] {
  return loadRecords("pos", "dining-tables").filter(
    (t) => t.name?.trim() && !/inactive|void|archived/i.test(t.status || ""),
  );
}

export async function setTableStatus(
  tableName: string,
  status: "Available" | "Occupied" | "Reserved",
): Promise<void> {
  const tables = loadRecords("pos", "dining-tables");
  const next = tables.map((t) =>
    t.name === tableName
      ? { ...t, status, updatedAt: new Date().toISOString() }
      : t,
  );
  const saved = await saveRecordsAsync("pos", "dining-tables", next);
  if (!saved.ok) {
    throw new Error(saved.error || "Could not update table status in the database.");
  }
}

export async function openCashSession(input: {
  register: ManagerRecord;
  openingFloat: number;
  cashier?: string;
  date?: string;
}): Promise<ManagerRecord> {
  const sessions = loadRecords("pos", "cash-sessions");
  const open = openSessionsForRegister(input.register.name);
  if (open.length) {
    throw new Error(`Register “${input.register.name}” already has an open session.`);
  }
  const now = new Date().toISOString();
  const date = input.date || todayIsoDate();
  const record: ManagerRecord = {
    id: newId(),
    reference: nextDocumentReference("cash-sessions", sessions),
    date,
    register: input.register.name,
    cashier: input.cashier || cashierName(),
    openingFloat: String(roundMoney(input.openingFloat)),
    expectedCash: String(roundMoney(input.openingFloat)),
    countedCash: "",
    variance: "",
    status: "Open",
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
  const saved = await saveRecordsAsync("pos", "cash-sessions", [record, ...sessions]);
  if (!saved.ok) {
    throw new Error(saved.error || "Could not open cash session in the database.");
  }
  return record;
}

export async function closeCashSession(input: {
  sessionId: string;
  countedCash: number;
  notes?: string;
  registerAccount?: string;
}): Promise<ManagerRecord> {
  const sessions = loadRecords("pos", "cash-sessions");
  const idx = sessions.findIndex((s) => s.id === input.sessionId);
  if (idx < 0) throw new Error("Cash session not found.");
  const session = sessions[idx];
  if (!/^open$/i.test(session.status || "")) {
    throw new Error("Only open sessions can be closed.");
  }
  const sales = loadRecords("pos", "pos-sales").filter(
    (s) =>
      s.session === session.reference &&
      !/void|cancelled|draft/i.test(s.status || ""),
  );
  const cashSales = sales
    .filter((s) => /cash/i.test(s.tender || ""))
    .reduce((sum, s) => sum + parseAmount(s.amount), 0);
  const opening = parseAmount(session.openingFloat);
  const expected = roundMoney(opening + cashSales);
  const variance = roundMoney(input.countedCash - expected);
  const updated: ManagerRecord = {
    ...session,
    expectedCash: String(expected),
    countedCash: String(roundMoney(input.countedCash)),
    variance: String(variance),
    status: "Closed",
    notes: input.notes ?? session.notes ?? "",
    updatedAt: new Date().toISOString(),
  };
  const next = [...sessions];
  next[idx] = updated;
  const saved = await saveRecordsAsync("pos", "cash-sessions", next);
  if (!saved.ok) {
    throw new Error(saved.error || "Could not close cash session in the database.");
  }
  // Post till over/short when variance is non-zero.
  await postRecordToLedger("pos", "cash-sessions", {
    ...updated,
    registerAccount: input.registerAccount || session.account || "",
    account: input.registerAccount || session.account || "",
  });
  return updated;
}

export function itemUnitPrice(item: ManagerRecord): number {
  return (
    parseAmount(item.salesPrice) ||
    parseAmount(item.unitPrice) ||
    parseAmount(item.sellingPrice) ||
    parseAmount(item.price) ||
    parseAmount(item.averageCost) ||
    parseAmount(item.purchasePrice) ||
    0
  );
}

/** All sellable products from POS inventory (separate from Inventory module). */
export function sellableCatalog(): PosSellable[] {
  const stock = loadRecords("pos", "pos-products")
    .filter((item) => item.name?.trim() && !/inactive|discontinued|void/i.test(item.status || ""))
    .map((item): PosSellable => ({
      id: item.id,
      name: item.name,
      code: item.code || item.sku || "",
      kind: "inventory",
      unitPrice: itemUnitPrice(item),
      location: item.location || item.warehouse || "",
      quantityOnHand: parseAmount(item.quantity || item.closingStock || "0"),
      salesAccount: item.salesAccount || "",
      tracksStock: true,
      category: item.category || item.group || "Stock",
    }));

  const services = loadRecords("pos", "pos-services")
    .filter((item) => item.name?.trim() && !/inactive|discontinued|void/i.test(item.status || ""))
    .map((item): PosSellable => ({
      id: item.id,
      name: item.name,
      code: item.code || "",
      kind: "service",
      unitPrice: itemUnitPrice(item),
      location: "",
      quantityOnHand: null,
      salesAccount: item.salesAccount || "",
      tracksStock: false,
      category: item.category || "Service",
    }));

  return [...stock, ...services].sort((a, b) => a.name.localeCompare(b.name));
}

/** @deprecated use sellableCatalog — kept for callers expecting inventory-only. */
export function sellableInventoryItems(): ManagerRecord[] {
  return loadRecords("pos", "pos-products").filter((item) => {
    if (!item.name?.trim()) return false;
    if (/inactive|discontinued|void/i.test(item.status || "")) return false;
    return true;
  });
}

export function cartLineFromSellable(item: PosSellable, register?: ManagerRecord | null): PosCartLine {
  return {
    key: `${item.kind}:${item.id}`,
    itemId: item.id,
    itemName: item.name,
    kind: item.kind,
    location: item.location || register?.location || "",
    unitPrice: item.unitPrice,
    quantity: 1,
    salesAccount: item.salesAccount || register?.defaultSalesAccount || "Coffee Sales",
    tracksStock: item.tracksStock,
    modifiers: "",
    note: "",
  };
}

export function openCustomLine(input: {
  name: string;
  unitPrice: number;
  salesAccount?: string;
  register?: ManagerRecord | null;
}): PosCartLine {
  const name = input.name.trim() || "Custom sale";
  return {
    key: `open:${newId()}`,
    itemId: "",
    itemName: name,
    kind: "open",
    location: input.register?.location || "",
    unitPrice: roundMoney(input.unitPrice),
    quantity: 1,
    salesAccount: input.salesAccount || input.register?.defaultSalesAccount || "Coffee Sales",
    tracksStock: false,
    modifiers: "",
    note: "",
  };
}

export function openTickets(): ManagerRecord[] {
  return loadRecords("pos", "open-tickets").filter(
    (t) => !/void|cancelled|closed|paid/i.test(t.status || ""),
  );
}

export async function parkOpenTicket(input: {
  register: ManagerRecord;
  session: ManagerRecord;
  lines: PosCartLine[];
  customer?: string;
  serviceType?: PosServiceType;
  tableName?: string;
  tipPercent?: number;
  existingId?: string;
}): Promise<ManagerRecord> {
  if (!input.lines.length) throw new Error("Nothing to park — cart is empty.");
  const tickets = loadRecords("pos", "open-tickets");
  const now = new Date().toISOString();
  const subtotal = roundMoney(
    input.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
  );
  const tipPercent = input.tipPercent || 0;
  const tipAmount = roundMoney(subtotal * (tipPercent / 100));
  const payload = {
    lines: input.lines,
    tipPercent,
    tipAmount,
  };
  const existingIdx = input.existingId
    ? tickets.findIndex((t) => t.id === input.existingId)
    : -1;
  const base =
    existingIdx >= 0
      ? tickets[existingIdx]
      : {
          id: newId(),
          reference: nextDocumentReference("open-tickets", tickets),
          createdAt: now,
        };

  const record: ManagerRecord = {
    ...base,
    date: todayIsoDate(),
    register: input.register.name,
    session: input.session.reference,
    customer: input.customer || "Guest",
    serviceType: input.serviceType || "Walk-in",
    table: input.tableName || "",
    lineCount: String(input.lines.length),
    subtotal: String(subtotal),
    tipPercent: String(tipPercent),
    tipAmount: String(tipAmount),
    amount: String(roundMoney(subtotal + tipAmount)),
    cartJson: JSON.stringify(payload),
    status: "Open",
    updatedAt: now,
  };

  if (input.tableName) await setTableStatus(input.tableName, "Occupied");

  if (existingIdx >= 0) {
    const next = [...tickets];
    next[existingIdx] = record;
    const saved = await saveRecordsAsync("pos", "open-tickets", next);
    if (!saved.ok) {
      throw new Error(saved.error || "Could not park ticket in the database.");
    }
  } else {
    const saved = await saveRecordsAsync("pos", "open-tickets", [record, ...tickets]);
    if (!saved.ok) {
      throw new Error(saved.error || "Could not park ticket in the database.");
    }
  }
  return record;
}

export function loadOpenTicketCart(ticket: ManagerRecord): {
  lines: PosCartLine[];
  tipPercent: number;
  tipAmount: number;
} {
  try {
    const parsed = JSON.parse(String(ticket.cartJson || "{}")) as {
      lines?: PosCartLine[];
      tipPercent?: number;
      tipAmount?: number;
    };
    return {
      lines: Array.isArray(parsed.lines) ? parsed.lines : [],
      tipPercent: Number(parsed.tipPercent) || parseAmount(ticket.tipPercent) || 0,
      tipAmount: Number(parsed.tipAmount) || parseAmount(ticket.tipAmount) || 0,
    };
  } catch {
    return { lines: [], tipPercent: 0, tipAmount: 0 };
  }
}

export async function voidOpenTicket(ticketId: string): Promise<void> {
  const tickets = loadRecords("pos", "open-tickets");
  const ticket = tickets.find((t) => t.id === ticketId);
  if (!ticket) return;
  if (ticket.table) await setTableStatus(ticket.table, "Available");
  const saved = await saveRecordsAsync(
    "pos",
    "open-tickets",
    tickets.map((t) =>
      t.id === ticketId
        ? { ...t, status: "Void", updatedAt: new Date().toISOString() }
        : t,
    ),
  );
  if (!saved.ok) {
    throw new Error(saved.error || "Could not void ticket in the database.");
  }
}

function assertStockAvailable(lines: PosCartLine[]) {
  const catalog = new Map(sellableCatalog().map((i) => [i.id, i]));
  for (const line of lines) {
    if (!line.tracksStock || line.kind !== "inventory") continue;
    const item = catalog.get(line.itemId);
    if (!item || item.quantityOnHand === null) continue;
    if (line.quantity > item.quantityOnHand + 0.0001) {
      throw new Error(
        `Not enough stock for “${line.itemName}” (on hand ${item.quantityOnHand}, need ${line.quantity}).`,
      );
    }
  }
}

export async function checkoutPosCart(input: PosCheckoutInput): Promise<PosCheckoutResult> {
  if (!input.lines.length) throw new Error("Cart is empty.");
  if (!/^open$/i.test(input.session.status || "")) {
    throw new Error("Open a cash session before selling.");
  }
  assertStockAvailable(input.lines);

  const date = input.date || todayIsoDate();
  const now = new Date().toISOString();
  let sales = loadRecords("pos", "pos-sales");
  const ticketRef = nextDocumentReference("pos-sales", sales);
  const created: ManagerRecord[] = [];
  let ticketTotal = 0;
  const serviceType = input.serviceType || "Walk-in";
  const vatRate =
    input.applyVat === false
      ? 0
      : input.taxRate !== undefined
        ? Math.max(0, input.taxRate)
        : defaultPosVatRate();

  input.lines.forEach((line, index) => {
    if (line.quantity <= 0) return;
    const amount = roundMoney(line.quantity * line.unitPrice);
    ticketTotal = roundMoney(ticketTotal + amount);
    const reference =
      index === 0 ? ticketRef : `${ticketRef}-${String(index + 1).padStart(2, "0")}`;
    const descParts = [
      `Ticket ${ticketRef}`,
      serviceType !== "Walk-in" ? serviceType : "",
      input.tableName ? `Table ${input.tableName}` : "",
      line.modifiers ? `Mods: ${line.modifiers}` : "",
      line.note || "",
    ].filter(Boolean);
    const { tax } = splitInclusiveVat(amount, vatRate);
    const record: ManagerRecord = {
      id: newId(),
      reference,
      date,
      register: input.register.name,
      session: input.session.reference,
      item: line.itemName,
      itemId: line.itemId,
      lineKind: line.kind,
      tracksStock: line.tracksStock ? "Yes" : "No",
      location: line.location || input.register.location || "",
      quantity: String(line.quantity),
      unitPrice: String(roundMoney(line.unitPrice)),
      amount: String(amount),
      taxRate: vatRate ? String(vatRate) : "",
      taxAmount: tax ? String(tax) : "0",
      taxAccount: tax ? "VAT Account" : "",
      tax: vatRate ? `VAT ${vatRate}%` : "",
      account: input.register.account || "Cash-UGX",
      salesAccount:
        line.salesAccount || input.register.defaultSalesAccount || "Coffee Sales",
      tender: input.tender,
      customer: input.customer || "Walk-in",
      serviceType,
      table: input.tableName || "",
      modifiers: line.modifiers || "",
      division: "",
      description: descParts.join(" · "),
      ticket: ticketRef,
      status: "Complete",
      createdAt: now,
      updatedAt: now,
    };
    created.push(record);
    sales = [record, ...sales];
  });

  const tipAmount = roundMoney(
    input.tipAmount ??
      (input.tipPercent ? ticketTotal * (input.tipPercent / 100) : 0),
  );
  if (tipAmount > 0) {
    const tipRecord: ManagerRecord = {
      id: newId(),
      reference: `${ticketRef}-TIP`,
      date,
      register: input.register.name,
      session: input.session.reference,
      item: "Tip / gratuity",
      itemId: "",
      lineKind: "open",
      tracksStock: "No",
      location: "",
      quantity: "1",
      unitPrice: String(tipAmount),
      amount: String(tipAmount),
      account: input.register.account || "Cash-UGX",
      salesAccount: "Tips Received",
      tender: input.tender,
      customer: input.customer || "Walk-in",
      serviceType,
      table: input.tableName || "",
      modifiers: "",
      division: "",
      description: `Tip on ticket ${ticketRef}`,
      ticket: ticketRef,
      status: "Complete",
      createdAt: now,
      updatedAt: now,
    };
    created.push(tipRecord);
    sales = [tipRecord, ...sales];
  }

  if (!created.length) throw new Error("No valid lines to sell.");
  const salesPersisted = await saveRecords("pos", "pos-sales", sales);
  if (!salesPersisted.ok || (salesPersisted.durable !== "postgres")) {
    throw new Error(salesPersisted.error || "Could not save POS sales");
  }

  const grandTotal = roundMoney(ticketTotal + tipAmount);
  const saleIds = created.map((r) => r.id);
  const salesBefore = sales.filter((row) => !saleIds.includes(row.id));

  try {
    for (const record of created) {
      const posted = await postRecordToLedger("pos", "pos-sales", record);
      if (!posted.ok) {
        throw new Error(posted.error || "Could not post sale to the ledger");
      }
      if (record.lineKind === "inventory") {
        applyInventoryMovement({ entityKey: "pos-sales", record });
      }
    }
    await awaitLedgerLinesPersist();

    if (/cash/i.test(input.tender)) {
      const sessions = loadRecords("pos", "cash-sessions");
      const idx = sessions.findIndex((s) => s.id === input.session.id);
      if (idx >= 0) {
        const session = sessions[idx];
        const expected = roundMoney(
          parseAmount(session.expectedCash || session.openingFloat) + grandTotal,
        );
        sessions[idx] = {
          ...session,
          expectedCash: String(expected),
          updatedAt: new Date().toISOString(),
        };
        const sessionSaved = await saveRecords("pos", "cash-sessions", sessions);
        if (!sessionSaved.ok || sessionSaved.durable !== "postgres") {
          throw new Error(sessionSaved.error || "Could not update cash session");
        }
      }
    }

    if (input.openTicketId) {
      const tickets = loadRecords("pos", "open-tickets");
      const ticket = tickets.find((t) => t.id === input.openTicketId);
      if (ticket?.table) await setTableStatus(ticket.table, "Available");
      const ticketSaved = await saveRecords(
        "pos",
        "open-tickets",
        tickets.map((t) =>
          t.id === input.openTicketId
            ? {
                ...t,
                status: "Paid",
                ticket: ticketRef,
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
      );
      if (!ticketSaved.ok || ticketSaved.durable !== "postgres") {
        throw new Error(ticketSaved.error || "Could not update open ticket");
      }
    } else if (input.tableName) {
      await setTableStatus(input.tableName, "Available");
    }

    await awaitInFlightPersists();
  } catch (err) {
    // Fail closed: reverse ledger + inventory, then drop the sales rows.
    for (const record of created) {
      try {
        if (record.lineKind === "inventory") {
          applyInventoryMovement({
            entityKey: "pos-sales",
            record,
            removing: true,
          });
        }
        removePostingsForSource(record.id);
      } catch {
        /* continue rollback */
      }
    }
    try {
      await saveRecordsAsync("pos", "pos-sales", salesBefore, {
        removeIds: saleIds,
      });
    } catch {
      /* best-effort */
    }
    await awaitInFlightPersists().catch(() => undefined);
    throw err instanceof Error
      ? err
      : new Error("POS checkout failed and was rolled back");
  }

  const tendered = input.amountTendered ?? grandTotal;
  const change = /cash/i.test(input.tender)
    ? roundMoney(Math.max(0, tendered - grandTotal))
    : 0;

  return {
    sales: created,
    ticketTotal: grandTotal,
    tipAmount,
    change,
    ticketRef,
  };
}

export async function buildDailyClosing(input: {
  registerName: string;
  date?: string;
  depositTo?: string;
  bankDeposit?: number;
}): Promise<ManagerRecord> {
  const date = input.date || todayIsoDate();
  const sales = loadRecords("pos", "pos-sales").filter(
    (s) =>
      s.register === input.registerName &&
      s.date === date &&
      !/void|cancelled|draft/i.test(s.status || ""),
  );
  const returns = loadRecords("pos", "pos-returns").filter(
    (s) =>
      s.register === input.registerName &&
      s.date === date &&
      !/void|cancelled|draft/i.test(s.status || ""),
  );
  const salesTotal = roundMoney(sales.reduce((n, s) => n + parseAmount(s.amount), 0));
  const returnsTotal = roundMoney(returns.reduce((n, s) => n + parseAmount(s.amount), 0));
  const byTender = (tender: RegExp) =>
    roundMoney(
      sales
        .filter((s) => tender.test(s.tender || ""))
        .reduce((n, s) => n + parseAmount(s.amount), 0),
    );
  const cashTotal = byTender(/cash/i);
  const register = loadRecords("pos", "registers").find(
    (r) => (r.name || "").trim() === input.registerName.trim(),
  );
  const depositTo = input.depositTo || "Bank-UGX";
  const bankDeposit =
    input.bankDeposit !== undefined ? roundMoney(input.bankDeposit) : cashTotal;
  const closings = loadRecords("pos", "daily-closings");
  const now = new Date().toISOString();
  const record: ManagerRecord = {
    id: newId(),
    reference: nextDocumentReference("daily-closings", closings),
    date,
    register: input.registerName,
    salesTotal: String(salesTotal),
    returnsTotal: String(returnsTotal),
    netTotal: String(roundMoney(salesTotal - returnsTotal)),
    cashTotal: String(cashTotal),
    cardTotal: String(byTender(/card/i)),
    mobileTotal: String(byTender(/mobile/i)),
    bankDeposit: String(bankDeposit),
    depositTo,
    registerAccount: register?.account || "Cash-UGX",
    status: "Posted",
    notes: `Auto-built from ${sales.length} sale(s) and ${returns.length} return(s). Cash deposit ${bankDeposit} → ${depositTo}.`,
    createdAt: now,
    updatedAt: now,
  };
  const persisted = await saveRecords("pos", "daily-closings", [record, ...closings]);
  if (!persisted.ok || (persisted.durable !== "postgres")) {
    throw new Error(persisted.error || "Could not save daily closing");
  }
  if (bankDeposit > 0) {
    await postRecordToLedger("pos", "daily-closings", record);
    await awaitInFlightPersists();
  }
  return record;
}
