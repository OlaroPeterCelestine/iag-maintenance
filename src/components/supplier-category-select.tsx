"use client";

import { SearchablePicker } from "@/components/searchable-picker";
import { hydrateSettingFromDatabase } from "@/lib/db/sync";
import {
  ensureSupplierCategory,
  SUPPLIER_CATEGORIES_KEY,
  supplierCategorySelectOptions,
} from "@/lib/manager-settings";
import { useEffect, useState } from "react";

/**
 * Supplier Category picker — pick an existing category or type a new one to add it.
 */
export function SupplierCategorySelect({
  value,
  onChange,
  id,
  name,
  required,
  disabled,
  className,
  extraNames = [],
  emptyLabel = "Select or type a category",
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** Categories already used on other supplier records. */
  extraNames?: string[];
  emptyLabel?: string;
}) {
  const [options, setOptions] = useState(() =>
    typeof window === "undefined" ? [] : supplierCategorySelectOptions(extraNames),
  );

  useEffect(() => {
    const refresh = () => setOptions(supplierCategorySelectOptions(extraNames));
    refresh();
    window.addEventListener("financeiag-settings-changed", refresh);
    window.addEventListener("financeiag-records-changed", refresh);
    return () => {
      window.removeEventListener("financeiag-settings-changed", refresh);
      window.removeEventListener("financeiag-records-changed", refresh);
    };
  }, [extraNames.join("\0")]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateSettingFromDatabase(SUPPLIER_CATEGORIES_KEY);
      if (!cancelled) setOptions(supplierCategorySelectOptions(extraNames));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraNames.join("\0")]);

  const pickerOptions = options.map((opt) => ({
    value: opt.value,
    label: opt.label,
    searchText: opt.label,
  }));
  if (value && !options.some((o) => o.value === value)) {
    pickerOptions.unshift({
      value,
      label: value,
      searchText: value,
    });
  }

  return (
    <div className={className}>
      {name ? <input type="hidden" id={id} name={name} value={value} required={required} /> : null}
      <SearchablePicker
        value={value}
        onChange={(next) => {
          if (next) ensureSupplierCategory(next);
          onChange(next);
        }}
        options={pickerOptions}
        readOnly={disabled}
        placeholder={emptyLabel}
        searchPlaceholder="Search or type a new category…"
        emptyText="No categories yet — type a name to create one."
        allowClear
        allowCustom
        customLabel={(text) => `Add category "${text}"`}
        className="w-full"
      />
      <p className="mt-1 text-[11px] text-slate-500">
        Pick a category or type a new one. Manage the list under Settings → Supplier categories.
      </p>
    </div>
  );
}
