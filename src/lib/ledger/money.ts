import {
  loadManagerSettings,
  loadList,
  FX_KEY,
  defaultForeignCurrencies,
} from "@/lib/manager-settings";
import { convertToBase, isBaseCurrency, normalizeCurrency } from "@/lib/ledger/fx";

export type MoneyFormatOptions = {
  currencyCode?: string;
  compact?: boolean;
  /** When set, append " · USh …" for foreign amounts. */
  asOf?: string;
  showBase?: boolean;
};

export function currencyDisplay(currencyCode?: string) {
  const settings = loadManagerSettings();
  const baseCode = (settings.baseCurrencyCode || "UGX").toUpperCase();
  const code = (currencyCode || baseCode).toUpperCase();
  if (!code || code === baseCode) {
    return {
      code: baseCode,
      symbol: settings.baseCurrencySymbol || baseCode || "USh",
      decimals: settings.baseCurrencyDecimals ?? 0,
      isBase: true,
    };
  }
  const fx = loadList(FX_KEY, defaultForeignCurrencies).find(
    (row) => (row.code || "").toUpperCase() === code,
  );
  return {
    code,
    symbol: fx?.symbol || code,
    decimals: Number.parseInt(fx?.decimals || "2", 10) || 2,
    isBase: false,
  };
}

/** Format amounts in base currency, or in a document currency when provided. */
export function formatMoney(
  amount: number,
  compactOrOptions: boolean | MoneyFormatOptions = false,
): string {
  const options: MoneyFormatOptions =
    typeof compactOrOptions === "boolean"
      ? { compact: compactOrOptions }
      : compactOrOptions || {};
  const { symbol, decimals } = currencyDisplay(options.currencyCode);
  const abs = Math.abs(amount);
  if (options.compact && abs >= 1_000_000_000) {
    const billions = abs / 1_000_000_000;
    const body = billions.toLocaleString("en-US", {
      maximumFractionDigits: billions >= 10 ? 1 : 2,
    });
    return `${amount < 0 ? "-" : ""}${symbol} ${body}B`;
  }
  if (options.compact && abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    const body = millions.toLocaleString("en-US", {
      maximumFractionDigits: millions >= 10 ? 1 : 2,
    });
    return `${amount < 0 ? "-" : ""}${symbol} ${body}M`;
  }
  if (options.compact && abs >= 10_000) {
    const thousands = abs / 1_000;
    const body = thousands.toLocaleString("en-US", { maximumFractionDigits: 1 });
    return `${amount < 0 ? "-" : ""}${symbol} ${body}K`;
  }
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const primary = `${amount < 0 ? "-" : ""}${symbol} ${body}`;
  if (options.showBase && !isBaseCurrency(options.currencyCode) && amount) {
    const base = convertToBase(amount, options.currencyCode, options.asOf);
    return `${primary} → ${formatMoney(base)}`;
  }
  return primary;
}

/**
 * Transaction display: original currency first, then auto-converted base.
 * e.g. "$ 1,000.00 → USh 3,700,000"
 */
export function formatMoneyDual(
  amount: number,
  currencyCode?: string | null,
  asOf?: string,
): string {
  const code = normalizeCurrency(currencyCode);
  const primary = formatMoney(amount, { currencyCode: code });
  if (isBaseCurrency(code) || !amount) return primary;
  const base = convertToBase(amount, code, asOf);
  return `${primary} → ${formatMoney(base)}`;
}

export type DualMoneyParts = {
  primary: string;
  base: string | null;
  currencyCode: string;
  isForeign: boolean;
};

/** Structured dual amount for rich UI (two-line cells). */
export function dualMoneyParts(
  amount: number,
  currencyCode?: string | null,
  asOf?: string,
): DualMoneyParts {
  const code = normalizeCurrency(currencyCode);
  const foreign = !isBaseCurrency(code) && Boolean(amount);
  return {
    primary: formatMoney(amount, { currencyCode: code }),
    base: foreign ? formatMoney(convertToBase(amount, code, asOf)) : null,
    currencyCode: code,
    isForeign: foreign,
  };
}

export function signedMoney(amount: number, direction: "in" | "out" | "neutral" = "neutral") {
  if (direction === "in") return `+${formatMoney(Math.abs(amount))}`;
  if (direction === "out") return `-${formatMoney(Math.abs(amount))}`;
  return formatMoney(amount);
}

/** Strip grouping commas / currency junk; keep digits, one dot, optional leading minus. */
export function sanitizeAmountInput(value: string | number | null | undefined): string {
  if (value == null) return "";
  let s = String(value).replace(/,/g, "").replace(/[^0-9.-]/g, "");
  if (!s) return "";
  const negative = s.startsWith("-");
  s = s.replace(/-/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot >= 0) {
    s = `${s.slice(0, firstDot + 1)}${s.slice(firstDot + 1).replace(/\./g, "")}`;
  }
  return negative ? `-${s}` : s;
}

/**
 * Thousands-separator display for cash inputs (e.g. 1000000 → 1,000,000).
 * Preserves incomplete edits like "1." or "-".
 */
export function formatAmountInput(value: string | number | null | undefined): string {
  const raw = sanitizeAmountInput(value);
  if (!raw) return "";
  if (raw === "-" || raw === "." || raw === "-.") return raw;

  const negative = raw.startsWith("-");
  const body = negative ? raw.slice(1) : raw;
  const endsWithDot = body.endsWith(".");
  const [intPart = "", decPart] = body.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let out = grouped;
  if (decPart !== undefined) out = `${grouped}.${decPart}`;
  else if (endsWithDot) out = `${grouped}.`;
  return negative ? `-${out}` : out;
}
