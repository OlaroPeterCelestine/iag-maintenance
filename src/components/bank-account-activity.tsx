"use client";

import { ReportExportMenu } from "@/components/report-export-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildBankLedger,
  type BankActivityKind,
} from "@/lib/banking-summary";
import { buildBankLedgerExport } from "@/lib/export/bank-ledger";
import { formatMoney } from "@/lib/ledger/money";
import { useMounted } from "@/hooks/use-mounted";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function kindLabel(kind: BankActivityKind) {
  switch (kind) {
    case "opening":
      return "Opening";
    case "receipt":
      return "Receipt";
    case "payment":
      return "Payment";
    case "transfer-in":
      return "Transfer in";
    case "transfer-out":
      return "Transfer out";
  }
}

function kindTone(kind: BankActivityKind) {
  switch (kind) {
    case "receipt":
    case "transfer-in":
    case "opening":
      return "bg-emerald-50 text-emerald-700";
    case "payment":
    case "transfer-out":
      return "bg-rose-50 text-rose-700";
  }
}

export function BankAccountActivityPanel({
  accountName,
  focus,
}: {
  accountName: string;
  /** Show only uncategorized receipts or payments when set. */
  focus?: "receipts" | "payments" | "";
}) {
  const ready = useMounted();
  const [tick, setTick] = useState(0);
  const [onlyUncategorized, setOnlyUncategorized] = useState(Boolean(focus));
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Reset the filter when the caller points this panel at a different account
  // or focus. Adjusting during render is React's documented answer to
  // "state derived from props"; an effect made the panel paint once with the
  // previous account's filter before correcting itself.
  const focusKey = `${focus || ""}|${accountName || ""}`;
  const [lastFocusKey, setLastFocusKey] = useState(focusKey);
  if (focusKey !== lastFocusKey) {
    setLastFocusKey(focusKey);
    setOnlyUncategorized(Boolean(focus));
    setFromDate("");
    setToDate("");
  }

  // Client store is browser-only — wait until mount to avoid SSR hydration mismatch.
  useEffect(() => {
    let cancelled = false;
    const reload = () => setTick((n) => n + 1);
    window.addEventListener("financeiag-records-changed", reload);
    void (async () => {
      try {
        const { hydrateEntityFromDatabase } = await import("@/lib/db/sync");
        await Promise.all([
          hydrateEntityFromDatabase("banking", "bank-and-cash-accounts"),
          hydrateEntityFromDatabase("banking", "payments"),
          hydrateEntityFromDatabase("banking", "receipts"),
          hydrateEntityFromDatabase("banking", "inter-account-transfers"),
        ]);
        if (cancelled) return;
        const { repairOrphanPartyAndBankLinks } = await import(
          "@/lib/accounting-party-bank"
        );
        const fixed = await repairOrphanPartyAndBankLinks({ force: true });
        if (!cancelled && (fixed.parties || fixed.banks)) reload();
        else if (!cancelled) reload();
      } catch {
        if (!cancelled) reload();
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("financeiag-records-changed", reload);
    };
  }, [accountName]);

  const activity = useMemo(() => {
    if (!ready) return null;
    void tick;
    return buildBankLedger(accountName, { from: fromDate, to: toDate });
  }, [accountName, ready, tick, fromDate, toDate]);

  const exportSpec = useMemo(() => {
    if (!activity) return null;
    return buildBankLedgerExport({
      activity,
      from: fromDate || undefined,
      to: toDate || undefined,
    });
  }, [activity, fromDate, toDate]);

  const visibleLines = useMemo(() => {
    if (!activity) return [];
    if (!onlyUncategorized) return activity.lines;
    return activity.lines.filter((line) => {
      if (line.kind === "opening") return false;
      if (focus === "receipts" && line.kind !== "receipt") return false;
      if (focus === "payments" && line.kind !== "payment") return false;
      return /^uncategorized/i.test(line.allocation);
    });
  }, [activity, focus, onlyUncategorized]);

  if (!ready) {
    return (
      <div
        className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
        aria-busy
        aria-label="Loading account activity"
      >
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16 bg-slate-100" />
              <Skeleton className="h-6 w-28 bg-slate-100" />
            </div>
          ))}
        </div>
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              <Skeleton className="h-3.5 w-40 bg-slate-100" />
              <Skeleton className="h-3.5 w-20 bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-[13px] text-slate-500">No bank account selected.</p>
        <Link
          href="/banking?view=bank-and-cash-accounts"
          className="mt-4 inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-[12px] text-slate-700 hover:bg-slate-50"
        >
          Back to Bank &amp; Cash Accounts
        </Link>
      </div>
    );
  }

  const currency = activity.currency || undefined;
  const money = (n: number) => formatMoney(n, { currencyCode: currency });
  const accountsHref = "/banking?view=bank-and-cash-accounts";
  const activityBase = `${accountsHref}&activity=${encodeURIComponent(activity.account)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1">
            <span className="block text-[10px] font-medium tracking-wide text-slate-400 uppercase">
              From
            </span>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-8 w-[140px] text-[12px]"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] font-medium tracking-wide text-slate-400 uppercase">
              To
            </span>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-8 w-[140px] text-[12px]"
            />
          </label>
          {fromDate || toDate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                setFromDate("");
                setToDate("");
              }}
            >
              Clear dates
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {exportSpec ? <ReportExportMenu spec={exportSpec} /> : null}
          {focus || onlyUncategorized ? (
            <Link
              href={activityBase}
              className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-[12px] text-slate-700 hover:bg-slate-50"
            >
              Show all transactions
            </Link>
          ) : null}
          {activity.uncategorizedCount > 0 && !onlyUncategorized ? (
            <>
              <Link
                href={`/receipts-payments?view=receipts&account=${encodeURIComponent(activity.account)}&allocation=uncategorized&edit=1`}
                className="inline-flex h-8 items-center rounded-md border border-amber-200 bg-amber-50 px-3 text-[12px] font-medium text-amber-900 hover:bg-amber-100"
              >
                Categorize receipts
              </Link>
              <Link
                href={`/receipts-payments?view=payments&account=${encodeURIComponent(activity.account)}&allocation=uncategorized&edit=1`}
                className="inline-flex h-8 items-center rounded-md border border-amber-200 bg-amber-50 px-3 text-[12px] font-medium text-amber-900 hover:bg-amber-100"
              >
                Categorize payments
              </Link>
            </>
          ) : null}
          {activity.uncategorizedCount > 0 && onlyUncategorized ? (
            <Link
              href={
                focus === "payments"
                  ? `/receipts-payments?view=payments&account=${encodeURIComponent(activity.account)}&allocation=uncategorized&edit=1`
                  : `/receipts-payments?view=receipts&account=${encodeURIComponent(activity.account)}&allocation=uncategorized&edit=1`
              }
              className="inline-flex h-8 items-center rounded-md border border-amber-200 bg-amber-50 px-3 text-[12px] font-medium text-amber-900 hover:bg-amber-100"
            >
              Categorize these
            </Link>
          ) : null}
          <Link
            href={`/receipts-payments?view=receipts&account=${encodeURIComponent(activity.account)}`}
            className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-[12px] text-slate-700 hover:bg-slate-50"
          >
            Receipts
          </Link>
          <Link
            href={`/receipts-payments?view=payments&account=${encodeURIComponent(activity.account)}`}
            className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-[12px] text-slate-700 hover:bg-slate-50"
          >
            Payments
          </Link>
          <Link
            href={`/banking?view=inter-account-transfers`}
            className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-[12px] text-slate-700 hover:bg-slate-50"
          >
            Transfers
          </Link>
          <Link
            href={`/banking?view=bank-statements&account=${encodeURIComponent(activity.account)}`}
            className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-[12px] text-slate-700 hover:bg-slate-50"
          >
            Statements
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Closing balance" value={money(activity.closingBalance)} />
        <Kpi
          label="Movements"
          value={String(activity.lines.filter((l) => l.kind !== "opening").length)}
          hint={`${activity.receiptCount} in · ${activity.paymentCount} out · ${activity.transferCount} xfer`}
        />
        <Kpi label="Opening balance" value={money(activity.openingBalance)} />
        <Kpi
          label="Uncategorized"
          value={String(activity.uncategorizedCount)}
          hint={activity.uncategorizedCount ? "Need allocation" : "All allocated"}
          warn={activity.uncategorizedCount > 0}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h3 className="text-[13px] font-semibold text-slate-800">
              Bank ledger — {activity.account}
            </h3>
            <p className="text-[11px] text-slate-400">
              Receipts, payments, and inter-account transfers with running balance.
              {fromDate || toDate
                ? ` Period ${fromDate || "…"} → ${toDate || "…"}.`
                : " All dates."}
            </p>
          </div>
          {exportSpec ? <ReportExportMenu spec={exportSpec} /> : null}
        </div>
        {visibleLines.length === 0 ? (
          <p className="px-4 py-14 text-center text-[12px] text-slate-400">
            {onlyUncategorized
              ? "No uncategorized transactions on this account."
              : "No receipts, payments, or transfers posted to this account yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-[12px]">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] tracking-wide text-slate-400 uppercase">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Reference</th>
                  <th className="px-3 py-2 font-medium">Party / contra</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Allocation</th>
                  <th className="px-3 py-2 text-right font-medium">Money in</th>
                  <th className="px-3 py-2 text-right font-medium">Money out</th>
                  <th className="px-4 py-2 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {visibleLines.map((line) => (
                  <tr key={line.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2.5 text-slate-500">{line.date || "—"}</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${kindTone(line.kind)}`}
                      >
                        {kindLabel(line.kind)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-700">
                      {line.href ? (
                        <Link
                          href={line.href}
                          className="inline-flex items-center gap-1 hover:text-sky-700 hover:underline"
                        >
                          {line.reference}
                          <ExternalLink size={11} className="text-slate-300" />
                        </Link>
                      ) : (
                        line.reference
                      )}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-2.5 text-slate-700">
                      {line.party}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 text-slate-500">
                      {line.description}
                    </td>
                    <td className="px-3 py-2.5">
                      {/^uncategorized/i.test(line.allocation) && line.href ? (
                        <Link
                          href={line.href}
                          className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 hover:underline"
                          title="Categorize — assign posting account"
                        >
                          Categorize
                        </Link>
                      ) : (
                        <span
                          className={
                            /^uncategorized/i.test(line.allocation)
                              ? "rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"
                              : "text-slate-500"
                          }
                        >
                          {line.allocation}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">
                      {line.moneyIn ? money(line.moneyIn) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-rose-700">
                      {line.moneyOut ? money(line.moneyOut) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                      {money(line.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">{label}</p>
      <p
        className={`mt-1 text-[16px] font-semibold tabular-nums ${
          warn ? "text-amber-700" : "text-slate-900"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}
