import type { AccountBalance } from "@/lib/ledger/types";

/** Server-side balance aggregates used until ledger lines finish hydrating. */
let serverBalanceCache: {
  asOf: string;
  division: string;
  rows: AccountBalance[];
  at: number;
} | null = null;

export function setServerAccountBalances(
  rows: AccountBalance[],
  options?: { asOf?: string | null; division?: string | null },
) {
  serverBalanceCache = {
    asOf: (options?.asOf || "").trim(),
    division: (options?.division || "").trim(),
    rows: rows.slice(),
    at: Date.now(),
  };
}

export function clearServerAccountBalances() {
  serverBalanceCache = null;
}

export function getServerBalanceCache(
  asOf?: string | null,
  division?: string,
): AccountBalance[] | null {
  if (!serverBalanceCache?.rows.length) return null;
  const wantAsOf = (asOf || "").trim();
  const wantDiv = (division || "").trim();
  if (serverBalanceCache.division !== wantDiv) return null;
  if (serverBalanceCache.asOf && wantAsOf && serverBalanceCache.asOf !== wantAsOf) {
    return null;
  }
  return serverBalanceCache.rows;
}
