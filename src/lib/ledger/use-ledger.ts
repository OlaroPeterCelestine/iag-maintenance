"use client";

import { useCallback, useEffect, useState } from "react";
import { DB_SYNC_READY_EVENT, hydrateLedgerFromDatabase } from "@/lib/db/sync";
import { loadChartOfAccounts } from "@/lib/ledger/chart-of-accounts";
import {
  fetchBalanceSheetFromApi,
  fetchProfitAndLossByClassFromApi,
  fetchProfitAndLossFromApi,
  fetchTrialBalanceFromApi,
} from "@/lib/ledger/api-post";
import {
  balanceSheet,
  cashFlowStatement,
  divisionExceptionLines,
  ledgerForAccount,
  loadLedgerLines,
  profitAndLoss,
  profitAndLossByDivision,
  taxSummary,
  trialBalance,
} from "@/lib/ledger/posting";
import type { LedgerAccount, LedgerLine } from "@/lib/ledger/types";

/**
 * Live ledger for financial reports.
 * Numbers come only from the posted journal log hydrated from Postgres —
 * never from browser-invented seeds or a full client-side repost.
 */
export function useLedger() {
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [lines, setLines] = useState<LedgerLine[]>([]);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setAccounts(loadChartOfAccounts());
    setLines(loadLedgerLines());
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      // Always pull the journal log from the API before marking reports ready.
      try {
        await hydrateLedgerFromDatabase();
      } catch {
        /* keep whatever memory already has */
      }
      if (cancelled) return;
      refresh();
      setReady(true);
    }

    void boot();

    const onChange = () => refresh();
    const onSynced = () => {
      void hydrateLedgerFromDatabase().then(() => {
        if (!cancelled) refresh();
      });
    };
    window.addEventListener("financeiag-ledger-changed", onChange);
    window.addEventListener("storage", onChange);
    window.addEventListener(DB_SYNC_READY_EVENT, onSynced);
    return () => {
      cancelled = true;
      window.removeEventListener("financeiag-ledger-changed", onChange);
      window.removeEventListener("storage", onChange);
      window.removeEventListener(DB_SYNC_READY_EVENT, onSynced);
    };
  }, [refresh]);

  return {
    ready,
    /** Posted journal lines currently in memory (from API hydrate). */
    fromLog: lines.length > 0,
    accounts,
    lines,
    tick,
    refresh,
    trialBalance: (asOf?: string | null) => trialBalance(asOf),
    balanceSheet: (asOf?: string | null, division?: string | null) =>
      balanceSheet(asOf, division ? { division } : undefined),
    profitAndLoss: (from?: string | null, to?: string | null, division?: string | null) =>
      profitAndLoss(from, to, division ? { division } : undefined),
    /** Server TB — GET /api/ledger/reports/trial-balance */
    trialBalanceApi: (asOf?: string, division?: string) =>
      fetchTrialBalanceFromApi(asOf, division),
    /** Server BS — GET /api/ledger/reports/balance-sheet */
    balanceSheetApi: (asOf?: string, division?: string) =>
      fetchBalanceSheetFromApi(asOf, division),
    /** Server P&L — GET /api/ledger/reports/profit-and-loss */
    profitAndLossApi: (from?: string, to?: string, division?: string) =>
      fetchProfitAndLossFromApi(from, to, division),
    profitAndLossByClassApi: (from?: string, to?: string) =>
      fetchProfitAndLossByClassFromApi(from, to),
    profitAndLossByDivision: (from?: string | null, to?: string | null) =>
      profitAndLossByDivision(from, to),
    divisionExceptionLines: (from?: string | null, to?: string | null) =>
      divisionExceptionLines(from, to),
    cashFlowStatement: (from?: string | null, to?: string | null) =>
      cashFlowStatement(from, to),
    taxSummary: (from?: string | null, to?: string | null) => taxSummary(from, to),
    ledgerForAccount: (id: string, asOf?: string | null) => ledgerForAccount(id, asOf),
  };
}
