"use client";

import { formatMoney } from "@/lib/ledger/money";
import {
  baseCurrencyCode,
  convertBetween,
  convertToBase,
  isBaseCurrency,
  normalizeCurrency,
} from "@/lib/ledger/fx";
import { cn } from "@/lib/utils";

type DualMoneyProps = {
  /** Amount in `currency` (document / party currency). */
  amount: number;
  currency?: string | null;
  asOf?: string;
  /**
   * When true, `amount` is already in base currency and will be reverse-converted
   * for the foreign line (used for AR/AP live balances).
   */
  amountIsBase?: boolean;
  className?: string;
  /** Compact for table cells. */
  compact?: boolean;
  align?: "left" | "right";
};

/**
 * Always shows both sides when foreign:
 *   USD · $ 1,000.00
 *   UGX · USh 3,700,000
 */
export function DualMoney({
  amount,
  currency,
  asOf,
  amountIsBase = false,
  className,
  compact = false,
  align = "left",
}: DualMoneyProps) {
  const code = normalizeCurrency(currency);
  const base = baseCurrencyCode();
  const foreign = !isBaseCurrency(code) && Boolean(amount);

  let foreignAmount = amount;
  let baseAmount = amount;
  if (foreign) {
    if (amountIsBase) {
      baseAmount = amount;
      foreignAmount = convertBetween(amount, base, code, asOf);
    } else {
      foreignAmount = amount;
      baseAmount = convertToBase(amount, code, asOf);
    }
  }

  if (!foreign) {
    return (
      <span
        className={cn(
          "tabular-nums text-slate-800",
          align === "right" && "block text-right",
          className,
        )}
      >
        {formatMoney(baseAmount)}
      </span>
    );
  }

  if (compact) {
    return (
      <div
        className={cn(
          "leading-tight",
          align === "right" && "text-right",
          className,
        )}
      >
        <div className="tabular-nums text-slate-800">
          <span className="mr-1 text-[10px] font-semibold tracking-wide text-slate-500">
            {code}
          </span>
          {formatMoney(foreignAmount, { currencyCode: code })}
        </div>
        <div className="mt-0.5 tabular-nums text-[11px] text-slate-500">
          <span className="mr-1 font-semibold tracking-wide text-slate-400">{base}</span>
          {formatMoney(baseAmount)}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-slate-200 bg-slate-50/80",
        className,
      )}
    >
      <div className="grid grid-cols-2 divide-x divide-slate-200">
        <div className="px-3 py-2.5">
          <p className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
            {code}
          </p>
          <p className="mt-0.5 text-[14px] font-semibold tabular-nums text-slate-900">
            {formatMoney(foreignAmount, { currencyCode: code })}
          </p>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
            {base} · base
          </p>
          <p className="mt-0.5 text-[14px] font-semibold tabular-nums text-slate-900">
            {formatMoney(baseAmount)}
          </p>
        </div>
      </div>
    </div>
  );
}
