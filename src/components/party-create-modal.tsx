"use client";

import { ResponsiveModal } from "@/components/responsive-modal";
import { SearchablePicker } from "@/components/searchable-picker";
import { SupplierCategorySelect } from "@/components/supplier-category-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { nextEntityCode } from "@/lib/document-references";
import { inventoryLocationSelectOptions } from "@/lib/inventory-movement";
import type { ManagerRecord } from "@/lib/manager-entities";
import {
  currencySelectOptions,
  ensureSupplierCategory,
  loadManagerSettings,
} from "@/lib/manager-settings";
import {
  ensurePartyRecordAsync,
  type PartySide,
} from "@/lib/party-ledger";
import { syncSupplierOpeningBalanceInvoices } from "@/lib/supplier-opening-balances";
import { SupplierOpeningBalancesFields } from "@/components/supplier-opening-balances-fields";
import { loadRecords } from "@/lib/records-store";
import { FormEvent, useMemo, useState } from "react";

export type PartyCreateSide = PartySide | "both";

type PartyCreateValues = {
  name: string;
  code: string;
  category: string;
  contacts: string;
  location: string;
  email: string;
  phone: string;
  address: string;
  currency: string;
  creditLimit: string;
  openingBalanceDate: string;
  openingBalances: string;
  status: string;
  notes: string;
};

function emptyValues(side: PartyCreateSide, initialName = ""): PartyCreateValues {
  const target: PartySide = side === "receivable" ? "receivable" : "payable";
  const entity = target === "receivable" ? "customers" : "suppliers";
  const moduleSlug = target === "receivable" ? "sales" : "purchases";
  const existing = typeof window === "undefined" ? [] : loadRecords(moduleSlug, entity);
  const base = loadManagerSettings().baseCurrencyCode || "UGX";
  const name = initialName.trim();
  return {
    name,
    code: nextEntityCode(
      entity,
      existing,
      target === "receivable" ? "Customer" : "Supplier",
    ),
    category: "",
    contacts: name,
    location: "",
    email: "",
    phone: "",
    address: "",
    currency: base.toUpperCase(),
    creditLimit: "",
    openingBalanceDate: "",
    openingBalances: "",
    status: "Active",
    notes: "",
  };
}

function titleCaseLabel(label: string) {
  const trimmed = label.trim();
  if (!trimmed) return "Party";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Full New Supplier / New Customer form used from document party pickers
 * (same fields as Purchases → Suppliers / Sales → Customers create).
 */
export function PartyCreateModal({
  open,
  side,
  addLabel,
  initialName = "",
  onClose,
  onCreated,
}: {
  open: boolean;
  side: PartyCreateSide | null;
  addLabel: string;
  /** Prefill when opened from “Add supplier …” typed search. */
  initialName?: string;
  onClose: () => void;
  onCreated: (name: string, record: ManagerRecord) => void;
}) {
  const resolvedSide: PartyCreateSide = side || "payable";
  const isSupplier = resolvedSide !== "receivable";
  const niceLabel = titleCaseLabel(addLabel || (isSupplier ? "supplier" : "customer"));
  const [values, setValues] = useState<PartyCreateValues>(() =>
    emptyValues(resolvedSide, initialName),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Clear the form when the modal opens or switches subject. Done during
  // render so the first paint of a reopened modal never shows the previous
  // entry's values.
  const resetKey = `${open ? "1" : "0"}|${side || ""}|${initialName || ""}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    if (open && side) {
      setValues(emptyValues(side, initialName));
      setError("");
      setSaving(false);
    }
  }

  const currencyOptions = useMemo(() => {
    if (!open) return [];
    return currencySelectOptions();
  }, [open]);

  const locationOptions = useMemo(() => {
    if (!open) return [];
    return inventoryLocationSelectOptions().map((location) => ({
      value: location.value,
      label: location.label,
      meta:
        [location.kind ? location.kind : null, location.address || location.code || null]
          .filter(Boolean)
          .join(" · ") || undefined,
      searchText: `${location.code} ${location.value} ${location.address} ${location.kind || ""}`,
      group:
        location.kind === "warehouse"
          ? "Warehouses"
          : location.kind === "store"
            ? "Stores"
            : "Locations",
    }));
  }, [open]);

  const baseCurrency = (loadManagerSettings().baseCurrencyCode || "UGX").toUpperCase();

  function patch(partial: Partial<PartyCreateValues>) {
    setValues((prev) => ({ ...prev, ...partial }));
    if (error) setError("");
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!side || saving) return;
    const name = values.name.trim();
    if (!name) {
      setError(`${niceLabel} name is required.`);
      return;
    }
    if (!values.code.trim()) {
      setError("Code is required.");
      return;
    }
    if (!values.status.trim()) {
      setError("Status is required.");
      return;
    }

    const category = values.category.trim();
    if (isSupplier && category) {
      ensureSupplierCategory(category);
    }

    setSaving(true);
    try {
      const currency = values.currency.trim().toUpperCase() || baseCurrency;
      const record = await ensurePartyRecordAsync(name, side, {
        code: values.code.trim(),
        category,
        contacts: values.contacts.trim() || name,
        location: values.location.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        address: values.address.trim(),
        currency,
        currencyCode: currency,
        creditLimit: values.creditLimit.trim(),
        openingBalanceDate: values.openingBalanceDate.trim(),
        openingBalances: values.openingBalances.trim(),
        status: values.status.trim() || "Active",
        notes: values.notes.trim(),
        balance: "0",
      });
      if (!record) {
        setError(
          `${niceLabel} was not stored in the database. Check your connection and try again.`,
        );
        return;
      }
      if (isSupplier && (values.openingBalances.trim() || values.openingBalanceDate.trim())) {
        const opening = await syncSupplierOpeningBalanceInvoices({
          ...record,
          openingBalances: values.openingBalances.trim(),
          openingBalanceDate: values.openingBalanceDate.trim(),
        });
        if (!opening.ok) {
          setError(opening.error || "Supplier saved, but opening balances failed to post.");
          onCreated(record.name || name, record);
          return;
        }
      }
      onCreated(record.name || name, record);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not save ${niceLabel.toLowerCase()}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
      title={`New ${niceLabel}`}
      description="Complete the required fields, then save the record."
      className="no-scrollbar z-[60] max-h-[90dvh] overflow-x-hidden overflow-y-auto sm:max-w-3xl"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="h-9 px-4"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="party-create-form"
            className="h-9 bg-black px-4 hover:bg-zinc-800"
            disabled={saving}
          >
            {saving ? "Saving…" : `Create ${niceLabel}`}
          </Button>
        </>
      }
    >
      <form
        id="party-create-form"
        className="mt-1 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => void submit(e)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div>
          <Label htmlFor="party-create-name" className="mb-2 text-[12px] text-slate-700">
            {isSupplier ? "Name of supplier" : "Customer name"}{" "}
            <span className="text-orange-500">*</span>
          </Label>
          <Input
            id="party-create-name"
            value={values.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder={
              isSupplier ? "e.g. Total Energies — Ntinda" : "e.g. Acme Trading Ltd"
            }
            autoFocus
            required
          />
        </div>

        <div>
          <Label htmlFor="party-create-code" className="mb-2 text-[12px] text-slate-700">
            Code <span className="text-orange-500">*</span>
          </Label>
          <Input
            id="party-create-code"
            value={values.code}
            onChange={(e) => patch({ code: e.target.value })}
            required
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Auto-generated — edit if you need a custom code.
          </p>
        </div>

        {isSupplier ? (
          <div>
            <Label className="mb-2 text-[12px] text-slate-700">Category</Label>
            <SupplierCategorySelect
              id="party-create-category"
              value={values.category}
              onChange={(next) => patch({ category: next })}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Pick a category or type a new one. Manage the list under Settings → Supplier
              categories.
            </p>
          </div>
        ) : null}

        <div>
          <Label htmlFor="party-create-contacts" className="mb-2 text-[12px] text-slate-700">
            Contacts
          </Label>
          <Input
            id="party-create-contacts"
            value={values.contacts}
            onChange={(e) => patch({ contacts: e.target.value })}
            placeholder="Primary contact person"
          />
        </div>

        {isSupplier ? (
          <div>
            <Label className="mb-2 text-[12px] text-slate-700">Location</Label>
            <SearchablePicker
              value={values.location}
              onChange={(next) => patch({ location: next })}
              options={locationOptions}
              allowCustom
              allowClear
              customLabel={(text) => `Use location “${text}”`}
              placeholder="Select store or warehouse"
              searchPlaceholder="Search configured locations…"
              emptyText="No configured locations match"
              className="w-full"
            />
            {!locationOptions.length ? (
              <p className="mt-1 text-[11px] text-amber-600">
                No locations yet — add them under Inventory → Locations, or type a location
                name.
              </p>
            ) : null}
          </div>
        ) : null}

        <div>
          <Label htmlFor="party-create-email" className="mb-2 text-[12px] text-slate-700">
            Email addresses
          </Label>
          <Input
            id="party-create-email"
            type="email"
            value={values.email}
            onChange={(e) => patch({ email: e.target.value })}
            placeholder="billing@example.com"
          />
        </div>

        <div>
          <Label htmlFor="party-create-phone" className="mb-2 text-[12px] text-slate-700">
            Phone
          </Label>
          <Input
            id="party-create-phone"
            value={values.phone}
            onChange={(e) => patch({ phone: e.target.value })}
            placeholder="+256…"
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="party-create-address" className="mb-2 text-[12px] text-slate-700">
            Address
          </Label>
          <Textarea
            id="party-create-address"
            value={values.address}
            onChange={(e) => patch({ address: e.target.value })}
            rows={3}
            className="min-h-[72px]"
          />
        </div>

        <div>
          <Label htmlFor="party-create-currency" className="mb-2 text-[12px] text-slate-700">
            Currency
          </Label>
          <select
            id="party-create-currency"
            value={values.currency || baseCurrency}
            onChange={(e) => patch({ currency: e.target.value.toUpperCase() })}
            className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
          >
            {(currencyOptions.length
              ? currencyOptions
              : [
                  {
                    code: baseCurrency,
                    label: `${baseCurrency} — Base (base)`,
                  },
                ]
            ).map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
          {(values.currency || baseCurrency) === baseCurrency ? (
            <p className="mt-1 text-[11px] text-slate-400">
              System base currency — ledger posts in this currency.
            </p>
          ) : null}
        </div>

        {isSupplier ? (
          <SupplierOpeningBalancesFields
            defaultBalances={values.openingBalances}
            defaultDate={values.openingBalanceDate}
            includeHiddenInputs={false}
            onChange={(next) =>
              patch({
                openingBalances: next.openingBalances,
                openingBalanceDate: next.openingBalanceDate,
              })
            }
          />
        ) : null}

        <div>
          <Label htmlFor="party-create-credit" className="mb-2 text-[12px] text-slate-700">
            Credit limit
          </Label>
          <Input
            id="party-create-credit"
            type="number"
            step="any"
            min="0"
            value={values.creditLimit}
            onChange={(e) => patch({ creditLimit: e.target.value })}
          />
        </div>

        <div>
          <Label htmlFor="party-create-status" className="mb-2 text-[12px] text-slate-700">
            Status <span className="text-orange-500">*</span>
          </Label>
          <select
            id="party-create-status"
            value={values.status}
            onChange={(e) => patch({ status: e.target.value })}
            required
            className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="party-create-notes" className="mb-2 text-[12px] text-slate-700">
            Notes
          </Label>
          <Textarea
            id="party-create-notes"
            value={values.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            rows={2}
            className="min-h-[56px]"
          />
        </div>

        {error ? (
          <p className="sm:col-span-2 text-[12px] text-rose-600">{error}</p>
        ) : null}
      </form>
    </ResponsiveModal>
  );
}
