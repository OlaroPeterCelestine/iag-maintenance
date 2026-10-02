"use client";

import { SearchablePicker } from "@/components/searchable-picker";
import { hydrateEntityFromDatabase } from "@/lib/db/sync";
import {
  BANK_ACCOUNT_CREATE_HINT,
  bankAccountSelectOptions,
} from "@/lib/ledger/chart-of-accounts";
import { useEffect, useMemo, useState } from "react";

/**
 * Searchable picker of company banks under Banking → Bank & Cash Accounts.
 * Those records are created by picking a Chart of Accounts bank/cash account.
 */
export function BankAccountSelect({
  value,
  onChange,
  id,
  name,
  required,
  disabled,
  className,
  emptyLabel = "Select bank account",
  showHint = true,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  emptyLabel?: string;
  showHint?: boolean;
}) {
  const [options, setOptions] = useState(() =>
    typeof window === "undefined" ? [] : bankAccountSelectOptions(),
  );

  useEffect(() => {
    const refresh = () => setOptions(bankAccountSelectOptions());
    refresh();
    window.addEventListener("financeiag-records-changed", refresh);
    window.addEventListener("financeiag-ledger-changed", refresh);
    return () => {
      window.removeEventListener("financeiag-records-changed", refresh);
      window.removeEventListener("financeiag-ledger-changed", refresh);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateEntityFromDatabase("banking", "bank-and-cash-accounts");
      await hydrateEntityFromDatabase("accounts", "chart-of-accounts");
      if (!cancelled) setOptions(bankAccountSelectOptions());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pickerOptions = useMemo(() => {
    const base = options.map((opt) => ({
      value: opt.value,
      label: opt.label || opt.name || opt.value,
      meta: opt.accountNumber || opt.currency || undefined,
      group: opt.group,
      searchText: `${opt.name || opt.value} ${opt.code || ""} ${opt.accountNumber || ""} ${opt.currency || ""}`,
    }));
    if (value && !options.some((o) => o.value === value)) {
      return [{ value, label: value, searchText: value }, ...base];
    }
    return base;
  }, [options, value]);

  return (
    <div className="w-full" id={id}>
      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}
      <SearchablePicker
        value={value}
        onChange={onChange}
        options={pickerOptions}
        readOnly={disabled}
        placeholder={emptyLabel}
        searchPlaceholder="Search bank accounts…"
        emptyText="No bank accounts match"
        className={className || "min-w-[180px]"}
      />
      {showHint && !options.length ? (
        <p className="mt-1 text-[11px] text-amber-600">{BANK_ACCOUNT_CREATE_HINT}</p>
      ) : null}
    </div>
  );
}

/** First available bank name, or empty string when none exist. */
export function defaultBankAccountName(): string {
  if (typeof window === "undefined") return "";
  return bankAccountSelectOptions()[0]?.value ?? "";
}
