"use client";

import { MoneyInput } from "@/components/money-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  openingBalanceRows,
  serializeOpeningBalances,
  type OpeningBalanceMap,
} from "@/lib/supplier-opening-balances";
import { useEffect, useMemo, useState } from "react";

type Props = {
  /** Stored JSON string from the supplier record. */
  defaultBalances?: string;
  defaultDate?: string;
  readOnly?: boolean;
  /** When set, also write hidden inputs for FormData-based saves. */
  includeHiddenInputs?: boolean;
  onChange?: (next: { openingBalances: string; openingBalanceDate: string }) => void;
};

/**
 * Opening balance amount per allowed currency (base + Settings foreign currencies).
 */
export function SupplierOpeningBalancesFields({
  defaultBalances = "",
  defaultDate = "",
  readOnly = false,
  includeHiddenInputs = true,
  onChange,
}: Props) {
  const initialRows = useMemo(() => openingBalanceRows(defaultBalances), [defaultBalances]);
  const [amounts, setAmounts] = useState<OpeningBalanceMap>(() => {
    const map: OpeningBalanceMap = {};
    for (const row of initialRows) {
      if (row.amount) map[row.code] = row.amount;
    }
    return map;
  });
  const [date, setDate] = useState(defaultDate || "");

  useEffect(() => {
    const map: OpeningBalanceMap = {};
    for (const row of openingBalanceRows(defaultBalances)) {
      if (row.amount) map[row.code] = row.amount;
    }
    setAmounts(map);
    setDate(defaultDate || "");
  }, [defaultBalances, defaultDate]);

  const serialized = serializeOpeningBalances(amounts);
  const rows = useMemo(() => openingBalanceRows(serialized), [serialized]);

  function emit(nextAmounts: OpeningBalanceMap, nextDate: string) {
    onChange?.({
      openingBalances: serializeOpeningBalances(nextAmounts),
      openingBalanceDate: nextDate,
    });
  }

  function patchAmount(code: string, raw: string) {
    setAmounts((prev) => {
      const next = { ...prev };
      if (!raw.trim()) delete next[code];
      else next[code] = raw;
      emit(next, date);
      return next;
    });
  }

  return (
    <div className="sm:col-span-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      {includeHiddenInputs ? (
        <>
          <input type="hidden" name="openingBalances" value={serialized} />
          <input type="hidden" name="openingBalanceDate" value={date} />
        </>
      ) : null}

      <div>
        <Label htmlFor="supplier-opening-balance-date" className="mb-2 text-[12px] text-slate-700">
          Opening balance date
        </Label>
        <Input
          id="supplier-opening-balance-date"
          type="date"
          value={date}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(e) => {
            const next = e.target.value;
            setDate(next);
            emit(amounts, next);
          }}
          className="max-w-xs bg-white"
        />
        <p className="mt-1 text-[11px] text-slate-400">
          Amounts owed to this supplier before books start — one field per allowed currency.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.code}>
            <Label
              htmlFor={`supplier-ob-${row.code}`}
              className="mb-2 text-[12px] text-slate-700"
            >
              Opening balance ({row.code})
            </Label>
            <MoneyInput
              id={`supplier-ob-${row.code}`}
              value={amounts[row.code] || ""}
              readOnly={readOnly}
              disabled={readOnly}
              placeholder="0"
              min={0}
              onChange={(raw) => patchAmount(row.code, raw)}
              className="bg-white"
            />
            <p className="mt-1 truncate text-[11px] text-slate-400" title={row.label}>
              {row.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
