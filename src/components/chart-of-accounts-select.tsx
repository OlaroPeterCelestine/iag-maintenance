"use client";

import { SearchablePicker } from "@/components/searchable-picker";
import { hydrateEntityFromDatabase } from "@/lib/db/sync";
import {
  coaAccountSelectOptions,
  type CoaSelectOption,
} from "@/lib/ledger/chart-of-accounts";
import type { AccountType } from "@/lib/ledger/types";
import { useEffect, useMemo, useState } from "react";

/**
 * Searchable Chart of Accounts picker. Value defaults to account name
 * (ledger resolve key); use valueMode="code" for report filters.
 */
export function ChartOfAccountsSelect({
  value,
  onChange,
  id,
  name,
  required,
  disabled,
  className,
  types,
  bankLike = false,
  valueMode = "name",
  emptyLabel = "Search chart of accounts",
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  types?: AccountType[];
  /** Limit to cash/bank-like asset accounts. */
  bankLike?: boolean;
  valueMode?: "name" | "code";
  emptyLabel?: string;
  compact?: boolean;
}) {
  const filterKey = `${bankLike ? "bank" : ""}|${types?.join(",") || ""}`;

  const [options, setOptions] = useState<CoaSelectOption[]>(() =>
    typeof window === "undefined"
      ? []
      : coaAccountSelectOptions({
          bankLike: bankLike || undefined,
          types: types?.length ? types : undefined,
        }),
  );

  useEffect(() => {
    const refresh = () =>
      setOptions(
        coaAccountSelectOptions({
          bankLike: bankLike || undefined,
          types: types?.length ? types : undefined,
        }),
      );
    refresh();
    window.addEventListener("financeiag-records-changed", refresh);
    window.addEventListener("financeiag-ledger-changed", refresh);
    return () => {
      window.removeEventListener("financeiag-records-changed", refresh);
      window.removeEventListener("financeiag-ledger-changed", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateEntityFromDatabase("accounts", "chart-of-accounts");
      if (cancelled) return;
      setOptions(
        coaAccountSelectOptions({
          bankLike: bankLike || undefined,
          types: types?.length ? types : undefined,
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const pickerOptions = useMemo(() => {
    const base = options.map((opt) => {
      const optionValue = valueMode === "code" ? opt.code || opt.value : opt.value;
      return {
        value: optionValue,
        label: opt.label,
        group: opt.group || opt.type,
        meta: opt.code ? `Code ${opt.code}` : undefined,
        searchText: `${opt.code} ${opt.name || opt.value} ${opt.group || ""} ${opt.type || ""}`,
      };
    });
    if (value && !base.some((o) => o.value === value)) {
      return [{ value, label: value, group: "Current", meta: undefined, searchText: value }, ...base];
    }
    return base;
  }, [options, value, valueMode]);

  return (
    <div className="w-full" id={id}>
      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
      <SearchablePicker
        value={value}
        onChange={onChange}
        options={pickerOptions}
        readOnly={disabled}
        placeholder={emptyLabel}
        searchPlaceholder="Type to search accounts…"
        emptyText="No accounts match"
        className={className || (compact ? "min-w-[160px]" : "w-full")}
      />
      {!options.length && !compact ? (
        <p className="mt-1 text-[11px] text-amber-600">
          {bankLike
            ? "No bank/cash accounts in the Chart of Accounts yet — add them under Accounts → Chart of Accounts."
            : "No accounts yet — add them under Accounts → Chart of Accounts."}
        </p>
      ) : null}
    </div>
  );
}
