"use client";

import { SearchablePicker } from "@/components/searchable-picker";
import { hydrateSettingFromDatabase } from "@/lib/db/sync";
import { DIVISIONS_KEY, divisionSelectOptions } from "@/lib/manager-settings";
import { useEffect, useState } from "react";

/**
 * QuickBooks-style Class / Division picker (Settings → Divisions).
 */
export function DivisionSelect({
  value,
  onChange,
  id,
  name,
  required,
  disabled,
  className,
  emptyLabel = "Select class / division",
  compact,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  emptyLabel?: string;
  /** Narrower control for line-item tables. */
  compact?: boolean;
}) {
  const [options, setOptions] = useState(() =>
    typeof window === "undefined" ? [] : divisionSelectOptions(),
  );

  useEffect(() => {
    const refresh = () => setOptions(divisionSelectOptions());
    refresh();
    window.addEventListener("financeiag-settings-changed", refresh);
    return () => window.removeEventListener("financeiag-settings-changed", refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateSettingFromDatabase(DIVISIONS_KEY);
      if (!cancelled) setOptions(divisionSelectOptions());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        onChange={onChange}
        options={pickerOptions}
        readOnly={disabled}
        placeholder={emptyLabel}
        searchPlaceholder="Search classes…"
        emptyText="No divisions yet — add them under Settings → Divisions (Classes)."
        allowClear
        className={compact ? "min-w-[120px]" : "w-full"}
      />
    </div>
  );
}
