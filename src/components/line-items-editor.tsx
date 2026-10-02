"use client";

import { ChartOfAccountsSelect } from "@/components/chart-of-accounts-select";
import { DivisionSelect } from "@/components/division-select";
import { DualMoney } from "@/components/dual-money";
import { MoneyInput } from "@/components/money-input";
import { ResponsiveModal } from "@/components/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchablePicker } from "@/components/searchable-picker";
import {
  type DocumentLine,
  type JournalLine,
  documentLinesTotal,
  emptyDocumentLine,
  emptyJournalLine,
  journalLinesTotals,
  normalizeDocumentLine,
} from "@/lib/document-lines";
import type { FormOptionsState } from "@/lib/form-options";
import { computeSalesInvoiceTotals } from "@/lib/form-options";
import {
  createInventoryItem,
  documentItemSelectOptions,
  type InventorySelectOption,
} from "@/lib/inventory-movement";
import { loadManagerSettings } from "@/lib/manager-settings";
import { convertBetween } from "@/lib/ledger/fx";
import { formatMoney } from "@/lib/ledger/money";
import { parseAmount } from "@/lib/ledger/types";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function money(n: number, currencyCode?: string) {
  return formatMoney(n, { currencyCode });
}

function AccountSelect({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <ChartOfAccountsSelect
      value={value}
      onChange={onChange}
      disabled={readOnly}
      emptyLabel="Select account"
      compact
      className="min-w-[180px]"
    />
  );
}

function ItemSelect({
  value,
  onChange,
  onAddNew,
  readOnly,
  options,
}: {
  value: string;
  onChange: (item: InventorySelectOption | null, raw: string) => void;
  onAddNew: () => void;
  readOnly?: boolean;
  options: InventorySelectOption[];
}) {
  const matched = options.find((o) => o.value === value || o.name === value || o.code === value);
  const [typeFilter, setTypeFilter] = useState<"all" | "inventory" | "service">("all");

  const pickerOptions = useMemo(() => {
    const base = options
      .filter((opt) => typeFilter === "all" || opt.kind === typeFilter)
      .map((opt) => ({
        value: opt.value,
        label: opt.label,
        group: opt.kind === "service" ? "Services" : "Inventory",
        meta:
          opt.kind === "service"
            ? "Service / non-inventory"
            : Number.isFinite(opt.quantity)
              ? `Qty on hand ${opt.quantity}`
              : undefined,
        searchText: `${opt.code} ${opt.name} ${opt.description} ${opt.kind}`,
      }));
    if (value && !matched) {
      return [{ value, label: value, group: "Custom" }, ...base];
    }
    return base;
  }, [options, value, matched, typeFilter]);

  return (
    <div className="flex min-w-[220px] items-center gap-1.5">
      {!readOnly && (
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as "all" | "inventory" | "service")}
          title="Item or service"
          className="h-9 shrink-0 rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] font-medium text-slate-600 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10"
        >
          <option value="all">All</option>
          <option value="inventory">Item</option>
          <option value="service">Service</option>
        </select>
      )}
      {typeFilter === "service" ? (
        <Input
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange(null, e.target.value)}
          className="h-9 min-w-[150px] flex-1 rounded-lg border-slate-200"
          placeholder="Type service name"
        />
      ) : (
        <>
          <SearchablePicker
            value={matched?.value || value || ""}
            onChange={(next) => {
              const opt = options.find((o) => o.value === next) || null;
              onChange(opt, next);
            }}
            options={pickerOptions}
            readOnly={readOnly}
            placeholder={typeFilter === "inventory" ? "Select an item" : "Select item or service"}
            searchPlaceholder="Search…"
            emptyText="No items match"
            allowCustom={typeFilter === "all"}
            className="min-w-[150px] flex-1"
          />
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-9 shrink-0 rounded-lg border-slate-200 p-0 text-slate-600 hover:bg-slate-50"
              title="Add inventory item"
              onClick={onAddNew}
            >
              <Plus size={15} />
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function AddInventoryItemDialog({
  open,
  onClose,
  onCreated,
  priceKind,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: InventorySelectOption) => void;
  priceKind: "sales" | "purchase";
}) {
  const [kind, setKind] = useState<"inventory" | "service">("service");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [salesPrice, setSalesPrice] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setKind("service");
    setName("");
    setCode("");
    setSalesPrice("");
    setPurchasePrice("");
    setQuantity("0");
    setError("");
  }, [open]);

  function save() {
    try {
      const created = createInventoryItem({
        name,
        code,
        salesPrice,
        purchasePrice,
        quantity: kind === "inventory" ? quantity : undefined,
        kind,
      });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create item.");
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={kind === "service" ? "New service" : "New inventory item"}
      description={
        kind === "service"
          ? "Saved under Non-inventory Items and selected on this line immediately."
          : "Saved under Inventory Items and selected on this line immediately."
      }
      className="sm:max-w-md"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="bg-black hover:bg-zinc-800" onClick={save}>
            {kind === "service" ? "Add service" : "Add item"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 py-2" onClick={(e) => e.stopPropagation()}>
        <div>
          <Label className="mb-1.5 text-[12px]">Type</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKind("service")}
              className={`rounded-lg border px-3 py-2 text-left text-[12px] transition ${
                kind === "service"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              <span className="block font-medium">Service</span>
              <span className={`mt-0.5 block text-[10px] ${kind === "service" ? "text-white/70" : "text-slate-400"}`}>
                Non-inventory
              </span>
            </button>
            <button
              type="button"
              onClick={() => setKind("inventory")}
              className={`rounded-lg border px-3 py-2 text-left text-[12px] transition ${
                kind === "inventory"
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
              }`}
            >
              <span className="block font-medium">Inventory</span>
              <span className={`mt-0.5 block text-[10px] ${kind === "inventory" ? "text-white/70" : "text-slate-400"}`}>
                Stock item
              </span>
            </button>
          </div>
        </div>
        <div>
          <Label htmlFor="new-item-name" className="mb-1.5 text-[12px]">
            {kind === "service" ? "Service name" : "Item name"} <span className="text-orange-500">*</span>
          </Label>
          <Input
            id="new-item-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "service" ? "e.g. Consulting" : "e.g. Coffee beans 1kg"}
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="new-item-code" className="mb-1.5 text-[12px]">
            {kind === "service" ? "Code" : "SKU / code"}
          </Label>
          <Input
            id="new-item-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="new-item-sales" className="mb-1.5 text-[12px]">
              Sales price
            </Label>
            <Input
              id="new-item-sales"
              type="number"
              step="any"
              value={salesPrice}
              onChange={(e) => setSalesPrice(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="new-item-purchase" className="mb-1.5 text-[12px]">
              Purchase price
            </Label>
            <Input
              id="new-item-purchase"
              type="number"
              step="any"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
            />
          </div>
        </div>
        {kind === "inventory" ? (
          <div>
            <Label htmlFor="new-item-qty" className="mb-1.5 text-[12px]">
              Opening quantity
            </Label>
            <Input
              id="new-item-qty"
              type="number"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
        ) : null}
        {error ? <p className="text-[12px] text-rose-600">{error}</p> : null}
        <p className="text-[11px] text-slate-400">
          This line will use the {priceKind === "purchase" ? "purchase" : "sales"} price.
          {kind === "service" ? " Services do not affect stock quantity." : ""}
        </p>
      </div>
    </ResponsiveModal>
  );
}

export function DocumentLinesEditor({
  lines,
  onChange,
  readOnly,
  formOptions,
  taxRate = 0,
  taxLabel,
  priceKind = "sales",
  earlyPaymentDiscountPct = 0,
  latePaymentFees = 0,
  currencyCode,
}: {
  lines: DocumentLine[];
  onChange: (lines: DocumentLine[]) => void;
  readOnly?: boolean;
  formOptions?: Partial<FormOptionsState>;
  taxRate?: number;
  taxLabel?: string;
  priceKind?: "sales" | "purchase";
  earlyPaymentDiscountPct?: number;
  latePaymentFees?: number;
  /** Document currency — totals and item prices display/convert in this currency. */
  currencyCode?: string;
}) {
  const [itemTick, setItemTick] = useState(0);
  const itemOptions = useMemo(() => {
    void itemTick;
    return documentItemSelectOptions();
  }, [itemTick]);
  const [addForLine, setAddForLine] = useState<number | null>(null);
  const showLineNo = Boolean(formOptions?.columnLineNumber);
  const showDescription = formOptions?.columnDescription !== false;
  const showDiscount = Boolean(formOptions?.columnDiscount);
  const showImages = Boolean(formOptions?.showItemImages);
  const subtotal = documentLinesTotal(lines);
  const totals = computeSalesInvoiceTotals({
    subtotal,
    taxRate,
    rounding: Boolean(formOptions?.rounding),
    earlyPaymentDiscountPct,
    latePaymentFees,
  });
  const baseCode = loadManagerSettings().baseCurrencyCode;
  const docCurrency = (currencyCode || baseCode || "").toUpperCase();
  const showBaseTotal =
    Boolean(docCurrency) && docCurrency !== (baseCode || "").toUpperCase();
  const baseTotal = showBaseTotal
    ? convertBetween(totals.total, docCurrency, baseCode)
    : totals.total;

  useEffect(() => {
    const reload = () => setItemTick((t) => t + 1);
    window.addEventListener("financeiag-records-changed", reload);
    return () => window.removeEventListener("financeiag-records-changed", reload);
  }, []);

  function update(index: number, patch: Partial<DocumentLine>) {
    const next = lines.map((line, i) => {
      if (i !== index) return line;
      const merged = { ...line, ...patch };
      if (
        patch.quantity !== undefined ||
        patch.unitPrice !== undefined ||
        patch.discount !== undefined ||
        patch.discountType !== undefined ||
        patch.item !== undefined
      ) {
        const norm = normalizeDocumentLine({ ...merged, amount: "" });
        return { ...merged, amount: norm.amount };
      }
      return merged;
    });
    onChange(next);
  }

  function pickItem(index: number, opt: InventorySelectOption | null, raw: string) {
    if (!opt) {
      const current = lines[index];
      update(index, {
        item: raw,
        description: current?.description?.trim() ? current.description : raw,
      });
      return;
    }
    const basePrice =
      priceKind === "purchase"
        ? opt.purchasePrice || opt.salesPrice
        : opt.salesPrice || opt.purchasePrice;
    const unitPriceNum = parseAmount(basePrice);
    const unitPrice =
      unitPriceNum > 0
        ? String(convertBetween(unitPriceNum, baseCode, docCurrency))
        : lines[index]?.unitPrice || "";
    const account =
      priceKind === "purchase"
        ? opt.purchaseAccount || lines[index]?.account || ""
        : opt.salesAccount || lines[index]?.account || "";
    update(index, {
      item: opt.value,
      description: opt.description || opt.name,
      unitPrice,
      account: account || lines[index]?.account || "",
      quantity: lines[index]?.quantity || "1",
      ...(showImages && opt.imageUrl ? { imageUrl: opt.imageUrl } : {}),
    });
  }

  function handleCreated(item: InventorySelectOption) {
    setItemTick((t) => t + 1);
    if (addForLine !== null) pickItem(addForLine, item, item.value);
    setAddForLine(null);
  }

  return (
    <div className="min-w-0 space-y-2 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-slate-700">Line items</p>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1 text-[11px]"
            onClick={() => onChange([...lines, emptyDocumentLine()])}
          >
            <Plus size={12} />
            Add line
          </Button>
        )}
      </div>
      <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-slate-200 bg-white shadow-sm [scrollbar-width:thin]">
        <table className="w-max min-w-[980px] border-separate border-spacing-0 text-left text-[12px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/90 text-[10px] uppercase tracking-wide text-slate-400">
              {showLineNo && <th className="sticky left-0 z-[1] bg-slate-50/95 px-3 py-2.5 font-medium">#</th>}
              {showImages && <th className="px-3 py-2.5 font-medium">Image</th>}
              <th className="px-3 py-2.5 font-medium">Item</th>
              {showDescription && <th className="px-3 py-2.5 font-medium">Description</th>}
              <th className="px-3 py-2.5 font-medium">Account</th>
              <th className="px-3 py-2.5 font-medium">Class</th>
              <th className="px-3 py-2.5 font-medium">Qty</th>
              <th className="px-3 py-2.5 font-medium">Unit price</th>
              {showDiscount && <th className="px-3 py-2.5 font-medium">Discount</th>}
              <th className="px-3 py-2.5 font-medium">Amount</th>
              {!readOnly && <th className="w-10 px-2 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                {showLineNo && (
                  <td className="px-3 py-2 text-slate-400 tabular-nums">{index + 1}</td>
                )}
                {showImages && (
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      {line.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={line.imageUrl}
                          alt=""
                          className="h-9 w-9 rounded-lg object-cover ring-1 ring-slate-200"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : null}
                      <Input
                        value={line.imageUrl}
                        readOnly={readOnly}
                        onChange={(e) => update(index, { imageUrl: e.target.value })}
                        className="h-9 w-[120px] rounded-lg border-slate-200"
                        placeholder="Image URL"
                      />
                    </div>
                  </td>
                )}
                <td className="px-2 py-2">
                  <ItemSelect
                    value={line.item}
                    readOnly={readOnly}
                    options={itemOptions}
                    onChange={(opt, raw) => pickItem(index, opt, raw)}
                    onAddNew={() => setAddForLine(index)}
                  />
                </td>
                {showDescription && (
                  <td className="px-2 py-2">
                    <Input
                      value={line.description}
                      readOnly={readOnly}
                      onChange={(e) => update(index, { description: e.target.value })}
                      className="h-9 min-w-[140px] rounded-lg border-slate-200"
                      placeholder="Description"
                    />
                  </td>
                )}
                <td className="px-2 py-2">
                  <AccountSelect
                    value={line.account}
                    readOnly={readOnly}
                    onChange={(account) => update(index, { account })}
                  />
                </td>
                <td className="px-2 py-2">
                  <DivisionSelect
                    value={line.division || ""}
                    disabled={readOnly}
                    compact
                    emptyLabel="Class"
                    className="min-w-[140px]"
                    onChange={(division) => update(index, { division })}
                  />
                </td>
                <td className="px-2 py-2">
                  <Input
                    type="number"
                    step="any"
                    value={line.quantity}
                    readOnly={readOnly}
                    onChange={(e) => update(index, { quantity: e.target.value })}
                    className="h-9 w-[72px] rounded-lg border-slate-200 tabular-nums"
                  />
                </td>
                <td className="px-2 py-2">
                  <MoneyInput
                    value={line.unitPrice}
                    readOnly={readOnly}
                    onChange={(raw) => update(index, { unitPrice: raw })}
                    className="h-9 w-[120px] rounded-lg border-slate-200 tabular-nums"
                  />
                </td>
                {showDiscount && (
                  <td className="px-2 py-2">
                    <div className="flex min-w-[140px] items-center gap-1">
                      <select
                        value={line.discountType === "amount" ? "amount" : "percent"}
                        disabled={readOnly}
                        onChange={(e) =>
                          update(index, {
                            discountType: e.target.value === "amount" ? "amount" : "percent",
                          })
                        }
                        className="h-9 shrink-0 rounded-lg border border-slate-200 bg-white px-1.5 text-[11px] font-medium text-slate-600 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-50"
                        title="Discount type"
                      >
                        <option value="percent">%</option>
                        <option value="amount">Amt</option>
                      </select>
                      {line.discountType === "amount" ? (
                        <MoneyInput
                          value={line.discount}
                          readOnly={readOnly}
                          onChange={(raw) => update(index, { discount: raw })}
                          className="h-9 w-[88px] rounded-lg border-slate-200 tabular-nums"
                          placeholder="0"
                        />
                      ) : (
                        <Input
                          type="number"
                          step="any"
                          value={line.discount}
                          readOnly={readOnly}
                          onChange={(e) => update(index, { discount: e.target.value })}
                          className="h-9 w-[76px] rounded-lg border-slate-200 tabular-nums"
                          placeholder="0"
                        />
                      )}
                    </div>
                  </td>
                )}
                <td className="px-2 py-2">
                  <MoneyInput
                    value={line.amount}
                    readOnly={readOnly}
                    onChange={(raw) => update(index, { amount: raw })}
                    className="h-9 w-[120px] rounded-lg border-slate-200 font-medium tabular-nums"
                  />
                </td>
                {!readOnly && (
                  <td className="px-2 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 rounded-lg p-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      disabled={lines.length <= 1}
                      onClick={() => onChange(lines.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-slate-100 pt-2 text-right text-[12px]">
        <p className="text-slate-600">
          Subtotal{" "}
          <span className="ml-2 tabular-nums font-medium text-slate-800">
            {money(totals.subtotal, docCurrency)}
          </span>
        </p>
        {taxRate > 0 ? (
          <p className="text-slate-600">
            Tax{taxLabel ? ` (${taxLabel})` : ""} {taxRate}%{" "}
            <span className="ml-2 tabular-nums font-medium text-slate-800">
              {money(totals.taxAmount, docCurrency)}
            </span>
          </p>
        ) : (
          <p className="text-[11px] text-slate-400">Select a tax code above to add tax to this total</p>
        )}
        {formOptions?.earlyPaymentDiscount && earlyPaymentDiscountPct > 0 ? (
          <p className="text-slate-600">
            Early payment ({earlyPaymentDiscountPct}%) would pay{" "}
            <span className="ml-2 tabular-nums font-medium text-emerald-700">
              {money(totals.amountIfPaidEarly, docCurrency)}
            </span>
          </p>
        ) : null}
        {formOptions?.latePaymentFees && latePaymentFees > 0 ? (
          <p className="text-slate-600">
            Late fee if overdue{" "}
            <span className="ml-2 tabular-nums font-medium text-amber-700">
              {money(totals.lateFees, docCurrency)}
            </span>
          </p>
        ) : null}
        {showBaseTotal ? (
          <div className="pt-1">
            <DualMoney amount={totals.total} currency={docCurrency} className="ml-auto max-w-sm" />
            {formOptions?.rounding ? (
              <p className="mt-1 text-[11px] text-slate-400">(rounded)</p>
            ) : null}
          </div>
        ) : (
          <p className="text-[13px] font-semibold text-slate-900">
            Total {money(totals.total, docCurrency)}
            {formOptions?.rounding ? (
              <span className="ml-2 text-[11px] font-normal text-slate-400">(rounded)</span>
            ) : null}
          </p>
        )}
        {!showBaseTotal && formOptions?.totalBaseCurrency ? (
          <p className="text-slate-600">
            Total ({baseCode}){" "}
            <span className="ml-2 tabular-nums font-medium text-slate-800">
              {money(baseTotal, baseCode)}
            </span>
          </p>
        ) : null}
      </div>

      <AddInventoryItemDialog
        open={addForLine !== null}
        onClose={() => setAddForLine(null)}
        onCreated={handleCreated}
        priceKind={priceKind}
      />
    </div>
  );
}

export function JournalLinesEditor({
  lines,
  onChange,
  readOnly,
}: {
  lines: JournalLine[];
  onChange: (lines: JournalLine[]) => void;
  readOnly?: boolean;
}) {
  const { debit, credit, balanced } = journalLinesTotals(lines);

  function update(index: number, patch: Partial<JournalLine>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  return (
    <div className="min-w-0 space-y-2 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-slate-700">Journal lines</p>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1 text-[11px]"
            onClick={() => onChange([...lines, emptyJournalLine()])}
          >
            <Plus size={12} />
            Add line
          </Button>
        )}
      </div>
      <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-lg border border-slate-200 [scrollbar-width:thin]">
        <table className="w-max min-w-[720px] border-separate border-spacing-0 text-left text-[12px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
              <th className="px-2 py-2 font-medium">Account</th>
              <th className="px-2 py-2 font-medium">Class</th>
              <th className="px-2 py-2 font-medium">Description</th>
              <th className="px-2 py-2 font-medium">Debit</th>
              <th className="px-2 py-2 font-medium">Credit</th>
              {!readOnly && <th className="w-10 px-1 py-2" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-b border-slate-50">
                <td className="px-1 py-1">
                  <AccountSelect
                    value={line.account}
                    readOnly={readOnly}
                    onChange={(account) => update(index, { account })}
                  />
                </td>
                <td className="px-1 py-1">
                  <DivisionSelect
                    value={line.division || ""}
                    disabled={readOnly}
                    compact
                    emptyLabel="Class"
                    className="min-w-[140px]"
                    onChange={(division) => update(index, { division })}
                  />
                </td>
                <td className="px-1 py-1">
                  <Input
                    value={line.description}
                    readOnly={readOnly}
                    onChange={(e) => update(index, { description: e.target.value })}
                    className="h-8"
                  />
                </td>
                <td className="px-1 py-1">
                  <MoneyInput
                    value={line.debit}
                    readOnly={readOnly}
                    onChange={(raw) =>
                      update(index, {
                        debit: raw,
                        credit: raw ? "" : line.credit,
                      })
                    }
                    className="h-8 w-[120px]"
                  />
                </td>
                <td className="px-1 py-1">
                  <MoneyInput
                    value={line.credit}
                    readOnly={readOnly}
                    onChange={(raw) =>
                      update(index, {
                        credit: raw,
                        debit: raw ? "" : line.debit,
                      })
                    }
                    className="h-8 w-[120px]"
                  />
                </td>
                {!readOnly && (
                  <td className="px-1 py-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600"
                      disabled={lines.length <= 2}
                      onClick={() => onChange(lines.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        className={`text-right text-[12px] font-semibold ${
          balanced ? "text-emerald-600" : "text-rose-600"
        }`}
      >
        Debits {money(debit)} · Credits {money(credit)}
        {balanced ? " · Balanced" : " · Out of balance"}
      </p>
    </div>
  );
}
