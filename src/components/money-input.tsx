"use client";

import { Input } from "@/components/ui/input";
import { formatAmountInput, sanitizeAmountInput } from "@/lib/ledger/money";
import { useEffect, useState } from "react";

type MoneyInputProps = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  /** Receives the raw numeric string (no commas), e.g. "1000000" or "12.5". */
  onChange?: (raw: string) => void;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  min?: string | number;
};

/**
 * Cash input with thousands separators (1,000,000).
 * Submits a clean numeric string via a hidden field when `name` is set.
 */
export function MoneyInput({
  id,
  name,
  value,
  defaultValue,
  onChange,
  required,
  readOnly,
  disabled,
  placeholder,
  className,
  min,
}: MoneyInputProps) {
  const controlled = value !== undefined;
  const [display, setDisplay] = useState(() =>
    formatAmountInput(controlled ? value : defaultValue),
  );
  const [raw, setRaw] = useState(() =>
    sanitizeAmountInput(controlled ? value : defaultValue),
  );

  useEffect(() => {
    if (!controlled) return;
    const nextRaw = sanitizeAmountInput(value);
    setRaw(nextRaw);
    setDisplay(formatAmountInput(nextRaw));
  }, [controlled, value]);

  function apply(nextDisplay: string) {
    const nextRaw = sanitizeAmountInput(nextDisplay);
    const formatted = formatAmountInput(nextDisplay);
    setRaw(nextRaw);
    setDisplay(formatted);
    onChange?.(nextRaw);
  }

  return (
    <>
      {name ? <input type="hidden" name={name} value={raw} /> : null}
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={display}
        onChange={(e) => apply(e.target.value)}
        onBlur={() => setDisplay(formatAmountInput(raw))}
        required={required}
        readOnly={readOnly}
        disabled={disabled}
        placeholder={placeholder}
        className={className}
        min={min}
      />
    </>
  );
}
