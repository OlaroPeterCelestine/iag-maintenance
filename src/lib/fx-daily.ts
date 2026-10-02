/**
 * Fetch daily FX rates into Settings → Exchange rates.
 * Rates are stored as units of base currency per 1 unit of foreign (e.g. UGX per 1 USD).
 */

import {
  EXCHANGE_RATES_KEY,
  FX_KEY,
  defaultExchangeRates,
  defaultForeignCurrencies,
  loadList,
  loadManagerSettings,
  saveList,
  type ExchangeRateRow,
} from "@/lib/manager-settings";
import { apiFetch } from "@/lib/api-auth";
import { getAppPref, setAppPref } from "@/lib/db/app-prefs";

const FX_DAILY_FETCH_KEY = "financeiag-fx-daily-fetched";

export type DailyFxFetchResult = {
  ok: boolean;
  date: string;
  provider?: string;
  updated: number;
  quotes: ExchangeRateRow[];
  error?: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function foreignCodes(): string[] {
  const settings = loadManagerSettings();
  const base = (settings.baseCurrencyCode || "UGX").toUpperCase();
  const codes = new Set<string>();
  for (const row of loadList(FX_KEY, defaultForeignCurrencies)) {
    const code = (row.code || "").trim().toUpperCase();
    if (code && code !== base) codes.add(code);
  }
  for (const row of defaultForeignCurrencies) {
    const code = (row.code || "").trim().toUpperCase();
    if (code && code !== base) codes.add(code);
  }
  // Always include common trade currencies for Uganda ops.
  for (const code of ["USD", "EUR", "GBP", "KES"]) {
    if (code !== base) codes.add(code);
  }
  return [...codes];
}

/**
 * Pull today's rates from `/api/fx/daily` and upsert into local exchange-rate list.
 * Keeps older historical rows; replaces same currency+date.
 */
export async function fetchAndApplyDailyExchangeRates(): Promise<DailyFxFetchResult> {
  if (typeof window === "undefined") {
    return { ok: false, date: todayIso(), updated: 0, quotes: [], error: "Client only" };
  }

  const settings = loadManagerSettings();
  const base = (settings.baseCurrencyCode || "UGX").toUpperCase();
  const currencies = foreignCodes();
  const qs = new URLSearchParams({
    base,
    currencies: currencies.join(","),
  });

  try {
    const res = await apiFetch(`/api/fx/daily?${qs.toString()}`, { cache: "no-store" });
    const json = (await res.json()) as {
      ok?: boolean;
      date?: string;
      provider?: string;
      quotes?: Array<{ currency: string; rate: number; date: string }>;
      error?: string;
    };
    if (!res.ok || !json.ok || !Array.isArray(json.quotes)) {
      return {
        ok: false,
        date: todayIso(),
        updated: 0,
        quotes: [],
        error: json.error || "Failed to fetch daily rates",
      };
    }

    const date = json.date || todayIso();
    const existing = loadList(EXCHANGE_RATES_KEY, defaultExchangeRates);
    const next = [...existing];
    let updated = 0;

    for (const quote of json.quotes) {
      const currency = (quote.currency || "").toUpperCase();
      const rate = String(quote.rate);
      if (!currency || !rate || Number(rate) <= 0) continue;
      const quoteDate = quote.date || date;
      const idx = next.findIndex(
        (row) =>
          (row.currency || "").toUpperCase() === currency && (row.date || "") === quoteDate,
      );
      if (idx >= 0) {
        if (next[idx].rate !== rate) {
          next[idx] = { ...next[idx], rate };
          updated += 1;
        }
      } else {
        next.unshift({
          id: crypto.randomUUID(),
          currency,
          date: quoteDate,
          rate,
        });
        updated += 1;
      }
    }

    saveList(EXCHANGE_RATES_KEY, next);
    setAppPref(FX_DAILY_FETCH_KEY, date);
    window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
    window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));

    return {
      ok: true,
      date,
      provider: json.provider,
      updated,
      quotes: next.filter((r) => (r.date || "") === date),
    };
  } catch (error) {
    return {
      ok: false,
      date: todayIso(),
      updated: 0,
      quotes: [],
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

/** Fetch once per calendar day (idempotent). */
export async function fetchDailyExchangeRatesOnce(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const today = todayIso();
    if (getAppPref<string | null>(FX_DAILY_FETCH_KEY, null) === today) return false;
    const result = await fetchAndApplyDailyExchangeRates();
    return result.ok;
  } catch {
    return false;
  }
}
