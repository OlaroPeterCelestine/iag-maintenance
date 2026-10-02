"use client";

import { FeedbackModals, useFeedbackModals } from "@/components/feedback-modals";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/ledger/money";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import {
  activeRegisters,
  buildDailyClosing,
  cartLineFromSellable,
  checkoutPosCart,
  closeCashSession,
  diningTables,
  defaultPosVatRate,
  ensureDefaultRegister,
  loadOpenTicketCart,
  openCashSession,
  openCustomLine,
  openSessionsForRegister,
  openTickets,
  parkOpenTicket,
  posSalesPlaces,
  sellableCatalog,
  splitInclusiveVat,
  voidOpenTicket,
  type PosCartLine,
  type PosCatalogFilter,
  type PosSellable,
  type PosServiceType,
} from "@/lib/pos-ops";
import {
  Add,
  Bag2,
  CloseCircle,
  MoneyRecive,
  Refresh,
  Shop,
  TickCircle,
  Trash,
} from "iconsax-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";

type Tender = "Cash" | "Card" | "Mobile money" | "Other";
type PosMode = "retail" | "restaurant";

function todayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function PosTerminalPanel() {
  const { feedback, close, showSuccess, showWarning, askConfirm } = useFeedbackModals();
  const ready = useMounted();
  const [tick, setTick] = useState(0);
  const [registerId, setRegisterId] = useState("");
  const [salesPlace, setSalesPlace] = useState("");
  const [openingFloat, setOpeningFloat] = useState("50000");
  const [countedCash, setCountedCash] = useState("");
  const [search, setSearch] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<PosCatalogFilter>("all");
  const [mode, setMode] = useState<PosMode>("retail");
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [tender, setTender] = useState<Tender>("Cash");
  const [customer, setCustomer] = useState("Walk-in");
  const [amountTendered, setAmountTendered] = useState("");
  const [serviceType, setServiceType] = useState<PosServiceType>("Walk-in");
  const [tableName, setTableName] = useState("");
  const [tipPercent, setTipPercent] = useState("0");
  const [applyVat, setApplyVat] = useState(true);
  const [modifiersDraft, setModifiersDraft] = useState("");
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [lastTicket, setLastTicket] = useState<{
    ref: string;
    total: number;
    tip: number;
    change: number;
  } | null>(null);

  useEffect(() => {
    ensureDefaultRegister();
    const reload = () => setTick((n) => n + 1);
    window.addEventListener("financeiag-records-changed", reload);
    return () => window.removeEventListener("financeiag-records-changed", reload);
  }, []);

  const registers = useMemo(() => {
    void tick;
    if (!ready) return [];
    return activeRegisters();
  }, [ready, tick]);

  useEffect(() => {
    if (!registerId && registers[0]) setRegisterId(registers[0].id);
  }, [registers, registerId]);

  const register = registers.find((r) => r.id === registerId) ?? registers[0] ?? null;

  const places = useMemo(() => {
    void tick;
    if (!ready) return [];
    return posSalesPlaces();
  }, [ready, tick]);

  // Apply register default only when the register changes — not on every records tick
  // (places/registers are new arrays each tick and were forcing sales place + clearing cart).
  const registerIdKey = register?.id ?? "";
  const registerLocation = (register?.location || "").trim();
  useEffect(() => {
    if (!registerIdKey) return;
    if (registerLocation) {
      setSalesPlace(registerLocation);
      return;
    }
    setSalesPlace((prev) => prev || places[0]?.name || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- places used only as empty fallback
  }, [registerIdKey, registerLocation]);

  useEffect(() => {
    if (salesPlace || !places[0]?.name) return;
    if (registerLocation) return;
    setSalesPlace(places[0].name);
  }, [places, salesPlace, registerLocation]);

  const session = useMemo(() => {
    void tick;
    if (!register) return null;
    return openSessionsForRegister(register.name)[0] ?? null;
  }, [register, tick]);

  const catalog = useMemo(() => {
    void tick;
    if (!ready) return [] as PosSellable[];
    const q = search.trim().toLowerCase();
    const place = salesPlace.trim().toLowerCase();
    return sellableCatalog().filter((item) => {
      if (catalogFilter === "stock" && item.kind !== "inventory") return false;
      if (catalogFilter === "services" && item.kind === "inventory") return false;
      if (place && item.tracksStock) {
        const itemPlace = (item.location || "").trim().toLowerCase();
        // Products without a place show everywhere; assigned products only at that place.
        if (itemPlace && itemPlace !== place) return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [ready, tick, search, catalogFilter, salesPlace]);

  const tables = useMemo(() => {
    void tick;
    if (!ready) return [];
    return diningTables();
  }, [ready, tick]);

  const parked = useMemo(() => {
    void tick;
    if (!ready) return [];
    return openTickets().filter((t) => !register || t.register === register.name);
  }, [ready, tick, register]);

  const subtotal = useMemo(
    () => roundMoney(cart.reduce((n, line) => n + line.quantity * line.unitPrice, 0)),
    [cart],
  );
  const tipPct = parseAmount(tipPercent);
  const tipAmount = roundMoney(subtotal * (tipPct / 100));
  const cartTotal = roundMoney(subtotal + tipAmount);
  const vatRate = applyVat ? defaultPosVatRate() : 0;
  const vatOnSubtotal = splitInclusiveVat(subtotal, vatRate).tax;

  const changeDue = useMemo(() => {
    if (tender !== "Cash") return 0;
    const tendered = parseAmount(amountTendered);
    return tendered > 0 ? roundMoney(Math.max(0, tendered - cartTotal)) : 0;
  }, [amountTendered, cartTotal, tender]);

  function addSellable(item: PosSellable) {
    if (item.tracksStock && item.quantityOnHand !== null && item.quantityOnHand <= 0) {
      showWarning("Out of stock", `“${item.name}” has no quantity on hand.`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.key === `${item.kind}:${item.id}` && !l.modifiers);
      if (existing) {
        return prev.map((l) =>
          l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      const line = cartLineFromSellable(item, register);
      line.location = salesPlace || line.location || register?.location || "";
      if (modifiersDraft.trim()) {
        line.modifiers = modifiersDraft.trim();
        line.key = `${line.key}:${modifiersDraft.trim()}`;
      }
      return [...prev, line];
    });
    setLastTicket(null);
  }

  function addCustomSale() {
    const price = parseAmount(customPrice);
    if (!customName.trim() && price <= 0) {
      showWarning("Custom sale", "Enter a name and price for the open sale.");
      return;
    }
    const line = openCustomLine({
      name: customName || "Custom sale",
      unitPrice: price,
      register,
    });
    line.location = salesPlace || line.location || register?.location || "";
    setCart((prev) => [...prev, line]);
    setCustomName("");
    setCustomPrice("");
    setLastTicket(null);
  }

  function setQty(key: string, quantity: number) {
    setCart((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantity } : l)).filter((l) => l.quantity > 0),
    );
  }

  function setLineModifiers(key: string, modifiers: string) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, modifiers } : l)));
  }

  async function handleOpenSession() {
    if (!register) {
      showWarning("No register", "Create a register under Registers first.");
      return;
    }
    try {
      const opened = await openCashSession({
        register,
        openingFloat: parseAmount(openingFloat),
      });
      showSuccess("Session opened", `${opened.reference} on ${register.name}`);
      setTick((n) => n + 1);
    } catch (err) {
      showWarning("Cannot open session", err instanceof Error ? err.message : "Unknown error");
    }
  }

  async function handleCloseSession() {
    if (!session) return;
    const counted = parseAmount(countedCash);
    askConfirm({
      title: "Close cash session?",
      message: `Count ${formatMoney(counted, true)} against expected cash for ${session.reference}.`,
      confirmLabel: "Close session",
      danger: false,
      onConfirm: () => {
        void (async () => {
          try {
            const closed = await closeCashSession({
              sessionId: session.id,
              countedCash: counted,
              registerAccount: register?.account || "",
            });
            showSuccess(
              "Session closed",
              `Expected ${formatMoney(parseAmount(closed.expectedCash), true)} · Variance ${formatMoney(parseAmount(closed.variance), true)}`,
            );
            setCart([]);
            setCountedCash("");
            setTick((n) => n + 1);
          } catch (err) {
            showWarning(
              "Cannot close session",
              err instanceof Error ? err.message : "Unknown error",
            );
          }
        })();
      },
    });
  }

  async function handlePark() {
    if (!register || !session) {
      showWarning("Session required", "Open a cash session first.");
      return;
    }
    if (!cart.length) {
      showWarning("Empty cart", "Add items before parking a ticket.");
      return;
    }
    try {
      const ticket = await parkOpenTicket({
        register,
        session,
        lines: cart,
        customer,
        serviceType: mode === "restaurant" ? serviceType : "Walk-in",
        tableName: mode === "restaurant" ? tableName : "",
        tipPercent: tipPct,
        existingId: openTicketId || undefined,
      });
      showSuccess("Ticket parked", `${ticket.reference} · ${formatMoney(parseAmount(ticket.amount), true)}`);
      setCart([]);
      setOpenTicketId(null);
      setTableName("");
      setTipPercent("0");
      setTick((n) => n + 1);
    } catch (err) {
      showWarning("Cannot park", err instanceof Error ? err.message : "Unknown error");
    }
  }

  function resumeTicket(ticketId: string) {
    const ticket = parked.find((t) => t.id === ticketId);
    if (!ticket) return;
    const loaded = loadOpenTicketCart(ticket);
    setCart(loaded.lines);
    setTipPercent(String(loaded.tipPercent || 0));
    setCustomer(ticket.customer || "Guest");
    setServiceType((ticket.serviceType as PosServiceType) || "Dine-in");
    setTableName(ticket.table || "");
    setOpenTicketId(ticket.id);
    setMode("restaurant");
    setLastTicket(null);
  }

  function handleCheckout() {
    if (!register || !session) {
      showWarning("Session required", "Open a cash session before ringing sales.");
      return;
    }
    if (!cart.length) {
      showWarning("Empty cart", "Add at least one item.");
      return;
    }
    if (tender === "Cash" && parseAmount(amountTendered) > 0 && parseAmount(amountTendered) < cartTotal) {
      showWarning("Insufficient tender", "Amount tendered is less than the ticket total.");
      return;
    }
    askConfirm({
      title: "Complete sale?",
      message: `${cart.length} line(s) · ${formatMoney(cartTotal, true)} · ${tender}${
        tipAmount ? ` · tip ${formatMoney(tipAmount, true)}` : ""
      }`,
      confirmLabel: "Charge",
      danger: false,
      onConfirm: () => {
        void (async () => {
          try {
            const lines = cart.map((line) => ({
              ...line,
              location: line.location || salesPlace || register.location || "",
            }));
            const result = await checkoutPosCart({
              register,
              session,
              lines,
              tender,
              customer,
              amountTendered: parseAmount(amountTendered) || cartTotal,
              date: todayIsoDate(),
              serviceType: mode === "restaurant" ? serviceType : "Walk-in",
              tableName: mode === "restaurant" ? tableName : "",
              tipAmount,
              tipPercent: tipPct,
              openTicketId: openTicketId || undefined,
              applyVat,
              taxRate: vatRate,
            });
            setLastTicket({
              ref: result.ticketRef,
              total: result.ticketTotal,
              tip: result.tipAmount,
              change: result.change,
            });
            setCart([]);
            setAmountTendered("");
            setOpenTicketId(null);
            setTableName("");
            setTipPercent("0");
            showSuccess(
              "Sale posted",
              `${result.ticketRef} · ${formatMoney(result.ticketTotal, true)}${
                result.change ? ` · Change ${formatMoney(result.change, true)}` : ""
              }`,
            );
            setTick((n) => n + 1);
          } catch (err) {
            showWarning("Checkout failed", err instanceof Error ? err.message : "Unknown error");
          }
        })();
      },
    });
  }

  function handleDailyClosing() {
    if (!register) return;
    askConfirm({
      title: "Build daily closing?",
      message: `Roll up today's sales and returns for ${register.name}.`,
      confirmLabel: "Build closing",
      danger: false,
      onConfirm: () => {
        void (async () => {
          try {
            const closing = await buildDailyClosing({ registerName: register.name });
            showSuccess(
              "Daily closing saved",
              `${closing.reference} · Net ${formatMoney(parseAmount(closing.netTotal), true)}`,
            );
            setTick((n) => n + 1);
          } catch (err) {
            showWarning(
              "Closing failed",
              err instanceof Error ? err.message : "Could not save daily closing",
            );
          }
        })();
      },
    });
  }

  return (
    <>
      <FeedbackModals feedback={feedback} onClose={close} />
      <div className="space-y-4">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[12px] font-medium",
                    mode === "retail" ? "bg-emerald-700 text-white" : "text-slate-600",
                  )}
                  onClick={() => {
                    setMode("retail");
                    setServiceType("Walk-in");
                    setTableName("");
                  }}
                >
                  Retail
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[12px] font-medium",
                    mode === "restaurant" ? "bg-emerald-700 text-white" : "text-slate-600",
                  )}
                  onClick={() => {
                    setMode("restaurant");
                    setServiceType("Dine-in");
                  }}
                >
                  Restaurant
                </button>
              </div>
              <Link
                href="/pos?view=registers"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8")}
              >
                Registers
              </Link>
              <Link
                href="/pos?view=pos-locations"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8")}
              >
                Locations
              </Link>
              <Link
                href="/pos?view=pos-products"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8")}
              >
                POS products
              </Link>
              <Link
                href="/pos?view=pos-stock-in"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8")}
              >
                Receive stock
              </Link>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                onClick={() => setTick((n) => n + 1)}
              >
                <Refresh size={14} variant="Linear" color="currentColor" />
                Refresh
              </Button>
            </div>
          </div>

          <div className="grid gap-4 p-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500">Register</Label>
                  <select
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px]"
                    value={register?.id || ""}
                    onChange={(e) => {
                      setRegisterId(e.target.value);
                      setCart([]);
                      setOpenTicketId(null);
                    }}
                  >
                    {registers.length === 0 ? (
                      <option value="">No registers</option>
                    ) : (
                      registers.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} {r.code ? `(${r.code})` : ""}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500">Sales place</Label>
                  <select
                    className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px]"
                    value={salesPlace}
                    onChange={(e) => {
                      setSalesPlace(e.target.value);
                      setCart([]);
                    }}
                  >
                    {places.length === 0 ? (
                      <option value="">No POS locations</option>
                    ) : (
                      places.map((place) => (
                        <option key={place.id} value={place.name}>
                          {place.name}
                          {place.kind ? ` · ${place.kind}` : ""}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-[11px] text-slate-500">Session</Label>
                  <div className="flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-[13px]">
                    {session ? (
                      <span className="font-medium text-emerald-700">
                        Open · {session.reference} · float{" "}
                        {formatMoney(parseAmount(session.openingFloat), true)}
                      </span>
                    ) : (
                      <span className="text-slate-500">No open session</span>
                    )}
                  </div>
                </div>
              </div>

              {!session ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Opening float</Label>
                    <Input
                      className="h-9 w-36"
                      value={openingFloat}
                      onChange={(e) => setOpeningFloat(e.target.value)}
                      inputMode="decimal"
                    />
                  </div>
                  <Button type="button" className="h-9 gap-1.5" onClick={handleOpenSession}>
                    <Shop size={15} variant="Bold" color="currentColor" />
                    Open session
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Counted cash</Label>
                    <Input
                      className="h-9 w-36"
                      value={countedCash}
                      onChange={(e) => setCountedCash(e.target.value)}
                      inputMode="decimal"
                      placeholder={session.expectedCash || "0"}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    onClick={handleCloseSession}
                  >
                    Close session
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    onClick={handleDailyClosing}
                  >
                    Daily closing
                  </Button>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-100 bg-white p-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-800">
                <MoneyRecive size={15} variant="Bold" color="#059669" />
                Last ticket
              </div>
              {lastTicket ? (
                <div className="mt-2 space-y-1 text-[13px]">
                  <p className="font-mono text-slate-700">{lastTicket.ref}</p>
                  <p className="text-[18px] font-semibold text-slate-900">
                    {formatMoney(lastTicket.total, true)}
                  </p>
                  {lastTicket.tip > 0 ? (
                    <p className="text-slate-500">Tip {formatMoney(lastTicket.tip, true)}</p>
                  ) : null}
                  {lastTicket.change > 0 ? (
                    <p className="text-emerald-700">
                      Change {formatMoney(lastTicket.change, true)}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-[12px] text-slate-500">
                  Complete a sale to show the receipt summary here.
                </p>
              )}
            </div>
          </div>
        </div>

        {mode === "restaurant" ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold text-slate-900">Floor / tables</h3>
                <p className="text-[11px] text-slate-500">
                  Pick a table for dine-in, or leave blank for counter service.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500">Service</Label>
                  <select
                    className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[12px]"
                    value={serviceType}
                    onChange={(e) => setServiceType(e.target.value as PosServiceType)}
                  >
                    <option>Dine-in</option>
                    <option>Takeaway</option>
                    <option>Delivery</option>
                    <option>Walk-in</option>
                  </select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-[11px] text-slate-500">Default modifiers</Label>
                  <Input
                    className="h-8"
                    placeholder="e.g. no onion, extra spice"
                    value={modifiersDraft}
                    onChange={(e) => setModifiersDraft(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6">
              {tables.map((table) => {
                const occupied = /occupied/i.test(table.status || "");
                const selected = tableName === table.name;
                return (
                  <button
                    key={table.id}
                    type="button"
                    disabled={!session}
                    onClick={() => setTableName(selected ? "" : table.name)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-[12px] transition disabled:opacity-50",
                      selected
                        ? "border-emerald-500 bg-emerald-50"
                        : occupied
                          ? "border-amber-200 bg-amber-50/70"
                          : "border-slate-200 bg-slate-50 hover:border-emerald-300",
                    )}
                  >
                    <p className="font-semibold text-slate-900">{table.name}</p>
                    <p className="text-[10px] text-slate-500">
                      {table.seats ? `${table.seats} seats · ` : ""}
                      {table.status || "Available"}
                    </p>
                  </button>
                );
              })}
            </div>
            {parked.length > 0 ? (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  Open tickets
                </p>
                <div className="flex flex-wrap gap-2">
                  {parked.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[12px]"
                    >
                      <button
                        type="button"
                        className="font-medium text-slate-800 hover:text-emerald-700"
                        onClick={() => resumeTicket(ticket.id)}
                      >
                        {ticket.reference}
                        {ticket.table ? ` · ${ticket.table}` : ""} ·{" "}
                        {formatMoney(parseAmount(ticket.amount), true)}
                      </button>
                      <button
                        type="button"
                        className="text-slate-400 hover:text-red-600"
                        aria-label="Void ticket"
                        onClick={() => {
                          void (async () => {
                            try {
                              await voidOpenTicket(ticket.id);
                              if (openTicketId === ticket.id) {
                                setOpenTicketId(null);
                                setCart([]);
                              }
                              setTick((n) => n + 1);
                            } catch (err) {
                              showWarning(
                                "Cannot void ticket",
                                err instanceof Error ? err.message : "Unknown error",
                              );
                            }
                          })();
                        }}
                      >
                        <CloseCircle size={14} variant="Linear" color="currentColor" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-2 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <Bag2 size={16} variant="Linear" color="currentColor" />
                <Input
                  className="h-9"
                  placeholder="Search stock, services, kits…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["all", "All sales"],
                    ["stock", "Inventory"],
                    ["services", "Services"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setCatalogFilter(id)}
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] font-medium",
                      catalogFilter === id
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-2">
                <div className="min-w-[140px] flex-1 space-y-1">
                  <Label className="text-[10px] text-slate-500">Custom / open sale</Label>
                  <Input
                    className="h-8"
                    placeholder="Description"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                  />
                </div>
                <div className="w-28 space-y-1">
                  <Label className="text-[10px] text-slate-500">Price</Label>
                  <Input
                    className="h-8"
                    placeholder="0"
                    value={customPrice}
                    onChange={(e) => setCustomPrice(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8"
                  disabled={!session}
                  onClick={addCustomSale}
                >
                  Add custom
                </Button>
              </div>
            </div>
            <div className="grid max-h-[28rem] gap-2 overflow-y-auto p-3 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.length === 0 ? (
                <div className="col-span-full rounded-lg border border-dashed border-slate-200 p-8 text-center text-[13px] text-slate-500">
                  No sellable items.{" "}
                  <Link
                    href="/pos?view=pos-products"
                    className="font-medium text-slate-800 underline"
                  >
                    Add POS products
                  </Link>{" "}
                  or use a custom sale above.
                </div>
              ) : (
                catalog.map((item) => {
                  const outOfStock =
                    item.tracksStock &&
                    item.quantityOnHand !== null &&
                    item.quantityOnHand <= 0;
                  return (
                    <button
                      key={`${item.kind}:${item.id}`}
                      type="button"
                      onClick={() => addSellable(item)}
                      disabled={!session || outOfStock}
                      className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-[13px] font-semibold text-slate-900">
                          {item.name}
                        </p>
                        <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-slate-500 uppercase">
                          {item.kind === "inventory" ? "Stock" : item.kind === "service" ? "Svc" : "Open"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {item.code || item.category || "—"}
                        {item.tracksStock && item.quantityOnHand !== null
                          ? ` · Qty ${item.quantityOnHand}`
                          : ""}
                      </p>
                      <p className="mt-2 text-[14px] font-semibold text-emerald-700">
                        {formatMoney(item.unitPrice, true)}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h3 className="text-[13px] font-semibold text-slate-900">
                {openTicketId ? "Open ticket" : "Cart"}
                {tableName ? ` · ${tableName}` : ""}
              </h3>
              {cart.length > 0 ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-600"
                  onClick={() => {
                    setCart([]);
                    setOpenTicketId(null);
                  }}
                >
                  <Trash size={13} variant="Linear" color="currentColor" />
                  Clear
                </button>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {cart.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-[12px] text-slate-500">
                  Tap products, services, or add a custom sale.
                </p>
              ) : (
                cart.map((line) => (
                  <div
                    key={line.key}
                    className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium text-slate-900">
                          {line.itemName}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {formatMoney(line.unitPrice, true)} ·{" "}
                          {line.kind === "inventory"
                            ? "Stock"
                            : line.kind === "service"
                              ? "Service"
                              : "Custom"}
                        </p>
                      </div>
                      <p className="shrink-0 text-[13px] font-semibold text-slate-900">
                        {formatMoney(line.quantity * line.unitPrice, true)}
                      </p>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      <button
                        type="button"
                        className="inline-flex size-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700"
                        onClick={() => setQty(line.key, line.quantity - 1)}
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-[12px] font-semibold">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        className="inline-flex size-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700"
                        onClick={() => setQty(line.key, line.quantity + 1)}
                      >
                        <Add size={12} variant="Linear" color="currentColor" />
                      </button>
                      <button
                        type="button"
                        className="ml-1 text-slate-400 hover:text-red-600"
                        onClick={() => setQty(line.key, 0)}
                        aria-label="Remove line"
                      >
                        <CloseCircle size={15} variant="Linear" color="currentColor" />
                      </button>
                    </div>
                    {mode === "restaurant" ? (
                      <Input
                        className="mt-2 h-7 text-[11px]"
                        placeholder="Modifiers / notes"
                        value={line.modifiers}
                        onChange={(e) => setLineModifiers(line.key, e.target.value)}
                      />
                    ) : null}
                  </div>
                ))
              )}
            </div>

            <div className="space-y-3 border-t border-slate-100 p-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500">Customer / guest</Label>
                  <Input
                    className="h-8"
                    value={customer}
                    onChange={(e) => setCustomer(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500">Tender</Label>
                  <select
                    className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[12px]"
                    value={tender}
                    onChange={(e) => setTender(e.target.value as Tender)}
                  >
                    <option>Cash</option>
                    <option>Card</option>
                    <option>Mobile money</option>
                    <option>Other</option>
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-[12px] text-slate-700">
                <input
                  type="checkbox"
                  checked={applyVat}
                  onChange={(e) => setApplyVat(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Prices include VAT ({vatRate || 0}% from Settings → Tax codes)
              </label>
              {mode === "restaurant" ? (
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500">Tip %</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {["0", "5", "10", "12.5", "15"].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        className={cn(
                          "rounded-md border px-2 py-1 text-[11px]",
                          tipPercent === pct
                            ? "border-emerald-500 bg-emerald-50 text-emerald-800"
                            : "border-slate-200 text-slate-600",
                        )}
                        onClick={() => setTipPercent(pct)}
                      >
                        {pct}%
                      </button>
                    ))}
                    <Input
                      className="h-7 w-16"
                      value={tipPercent}
                      onChange={(e) => setTipPercent(e.target.value)}
                      inputMode="decimal"
                    />
                  </div>
                </div>
              ) : null}
              {tender === "Cash" ? (
                <div className="space-y-1">
                  <Label className="text-[11px] text-slate-500">Amount tendered</Label>
                  <Input
                    className="h-8"
                    value={amountTendered}
                    onChange={(e) => setAmountTendered(e.target.value)}
                    inputMode="decimal"
                    placeholder={String(cartTotal || "")}
                  />
                  {changeDue > 0 ? (
                    <p className="text-[12px] font-medium text-emerald-700">
                      Change {formatMoney(changeDue, true)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-1 text-[12px]">
                <div className="flex items-center justify-between text-slate-500">
                  <span>Subtotal (incl. tax)</span>
                  <span className="tabular-nums">{formatMoney(subtotal, true)}</span>
                </div>
                {vatOnSubtotal > 0 ? (
                  <div className="flex items-center justify-between text-slate-500">
                    <span>VAT included ({vatRate}%)</span>
                    <span className="tabular-nums">{formatMoney(vatOnSubtotal, true)}</span>
                  </div>
                ) : null}
                {tipAmount > 0 ? (
                  <div className="flex items-center justify-between text-slate-500">
                    <span>Tip</span>
                    <span className="tabular-nums">{formatMoney(tipAmount, true)}</span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Ticket total</span>
                  <span className="text-[20px] font-semibold tracking-tight text-slate-900">
                    {formatMoney(cartTotal, true)}
                  </span>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {mode === "restaurant" ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10"
                    disabled={!session || cart.length === 0}
                    onClick={handlePark}
                  >
                    Park / hold tab
                  </Button>
                ) : (
                  <div />
                )}
                <Button
                  type="button"
                  className="h-10 w-full gap-1.5 bg-emerald-700 text-white hover:bg-emerald-800 sm:col-span-1"
                  disabled={!session || cart.length === 0}
                  onClick={handleCheckout}
                >
                  <TickCircle size={16} variant="Bold" color="currentColor" />
                  Charge {formatMoney(cartTotal, true)}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
