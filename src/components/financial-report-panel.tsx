"use client";

import { BankAccountSelect, defaultBankAccountName } from "@/components/bank-account-select";
import { ChartOfAccountsSelect } from "@/components/chart-of-accounts-select";
import { KpiStripSkeleton } from "@/components/page-loading";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentUserCan } from "@/lib/access-control";
import { buildAgedReport, type AgingBucket } from "@/lib/ar-ap";
import { useLedger } from "@/lib/ledger/use-ledger";
import {
  fetchBalanceSheetFromApi,
  fetchProfitAndLossByClassFromApi,
  fetchProfitAndLossFromApi,
  fetchTrialBalanceFromApi,
  type ProfitAndLossByClassReport,
} from "@/lib/ledger/api-post";
import { inventoryStockRollforward } from "@/lib/inventory-movement";
import { loadManagerSettings, divisionSelectOptions } from "@/lib/manager-settings";
import { statementOfChangesInEquity } from "@/lib/ledger/year-end-close";
import {
  latestStatementBalanceForAccount,
  reconcileBankAccount,
  reconcileControlAccounts,
} from "@/lib/ledger/control-reconciliation";
import { runAccountingIntegrityTests } from "@/lib/ledger/integrity-tests";
import { formatMoney } from "@/lib/ledger/money";
import { buildAccountLedgerExport } from "@/lib/export/ledger-pdf";
import type { TableExport } from "@/lib/export/table-export";
import {
  type CompareMode,
  comparativeBalanceSheetFromReports,
  comparativeCashFlow,
  comparativeProfitAndLossFromReports,
  compareModeLabel,
  resolveCompareAsOf,
  resolveComparePeriod,
  type ComparativeRow,
} from "@/lib/ledger/comparative";
import {
  budgetVsActual,
  cashFlowIndirect,
  forecastProfitAndLoss,
  forecastSeries,
  loadFinancialNotes,
} from "@/lib/ledger/reporting-advanced";
import { otherComprehensiveIncome } from "@/lib/ledger/ifrs9-fair-value";
import {
  isLiveFinancialView,
  liveReportKind,
  type LiveReportKind,
} from "@/lib/live-report-kind";
import { loadChartOfAccounts } from "@/lib/ledger/chart-of-accounts";

export type { LiveReportKind };
export { isLiveFinancialView, liveReportKind };
import {
  defaultProfitAndLossFrom,
  earliestLedgerActivityDate,
  ledgerForAccount,
} from "@/lib/ledger/posting";
import type { AccountBalance, AccountType } from "@/lib/ledger/types";
import { ManagementAnalysisPanel } from "@/components/management-analysis-panel";
import { PartyLedgerPanel } from "@/components/party-ledger-panel";
import { ContractorLedgerPanel } from "@/components/contractor-ledger-panel";
import { FieldAuditPanel } from "@/components/field-audit-panel";
import { ReportExportMenu } from "@/components/report-export-menu";
import {
  ReportEmpty,
  ReportRefreshButton,
  ReportShell,
  ReportStat,
  ReportSubheading,
  ReportTableWrap,
  reportTableClass,
  reportTdCheckClass,
  reportTdClass,
  reportTdRightClass,
  reportThCheckClass,
  reportThClass,
  reportThRightClass,
  reportTheadClass,
  reportTrClass,
  useRowSelection,
} from "@/components/report-shell";
import { Checkbox } from "@/components/ui/checkbox";
import type { LedgerLine } from "@/lib/ledger/types";
import {
  hrefForSourceDocument,
  originLinkForLedgerLine,
} from "@/lib/module-data";
import { listPendingApprovalDocuments } from "@/lib/pending-approvals";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

function money(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

/** Account ledger drill-down (Reports → Ledgers). */
function accountLedgerHref(codeOrName: string) {
  const query = codeOrName.trim();
  if (!query) return "/reports?view=ledgers";
  return `/reports?view=ledgers&account=${encodeURIComponent(query)}`;
}

function trialBalanceHref() {
  return "/reports?view=trial-balance";
}

function profitAndLossHref() {
  return "/reports?view=profit-and-loss";
}

type ProfitAndLossApiPayload = {
  from?: string;
  to?: string;
  income?: { code: string; name: string; balance: number }[];
  expenses?: { code: string; name: string; balance: number }[];
  totalIncome?: number;
  totalExpenses?: number;
  netProfit?: number;
};

type ServerTrialBalance = Extract<
  Awaited<ReturnType<typeof fetchTrialBalanceFromApi>>,
  { ok: true }
>["data"];
type ServerBalanceSheet = Extract<
  Awaited<ReturnType<typeof fetchBalanceSheetFromApi>>,
  { ok: true }
>["data"];

function MoneyLink({
  href,
  children,
  title = "Open source breakdown",
  className = "",
}: {
  href: string | null | undefined;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  if (!href) return <>{children}</>;
  return (
    <Link
      href={href}
      className={`block w-full text-sky-700 hover:underline ${className}`.trim()}
      title={title}
    >
      {children}
    </Link>
  );
}

function TotalLine({
  label,
  amount,
  href,
}: {
  label: string;
  amount: number;
  href?: string | null;
}) {
  return (
    <p className="mt-3 border-t border-slate-200 pt-2 text-right text-[12px] font-semibold text-slate-900">
      {label}{" "}
      {href ? (
        <Link href={href} className="text-sky-700 hover:underline" title="Open source breakdown">
          {money(amount)}
        </Link>
      ) : (
        money(amount)
      )}
    </p>
  );
}

type StatementLine = {
  code: string;
  name: string;
  balance: number;
  href?: string | null;
};

type StatementGroup = {
  group: string;
  total: number;
  accounts: StatementLine[];
};

/** Group API P&L rows as returned — do not rematch the local CoA by id/type. */
function groupApiStatementRows(
  balances: Array<{
    code?: string;
    name?: string;
    type?: string;
    group?: string;
    balance?: number;
  }>,
): StatementGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, StatementLine[]>();
  for (const row of balances) {
    const balance = Number(row.balance) || 0;
    if (!balance) continue;
    const type = (row.type || "").trim() || "Income";
    let group = (row.group || type).trim() || type;
    if (/^imported$/i.test(group) || /^asset$/i.test(group)) {
      group = type;
    }
    if (!buckets.has(group)) {
      buckets.set(group, []);
      order.push(group);
    }
    const code = (row.code || "").trim();
    const name = (row.name || "").trim() || code || "Untitled account";
    buckets.get(group)!.push({
      code,
      name,
      balance,
      href: accountLedgerHref(code || name),
    });
  }
  return order.map((group) => {
    const accountsInGroup = buckets.get(group) || [];
    const total = accountsInGroup.reduce((sum, line) => sum + line.balance, 0);
    return { group, accounts: accountsInGroup, total };
  });
}

/** Group CoA accounts under their chart group (Manager-style categories). */
function groupAccountsByCategory(
  type: AccountType,
  balances: AccountBalance[],
  opts?: { includeZeros?: boolean },
): StatementGroup[] {
  const includeZeros = opts?.includeZeros !== false;
  const balanceById = new Map(balances.map((row) => [row.accountId, row]));
  const accounts = loadChartOfAccounts().filter(
    (a) => !a.inactive && a.type === type,
  );

  const order: string[] = [];
  const buckets = new Map<string, StatementLine[]>();

  for (const account of accounts) {
    const live = balanceById.get(account.id);
    const balance = live?.balance ?? 0;
    if (!includeZeros && !balance) continue;
    const group = (account.group || type).trim() || type;
    if (/^imported$/i.test(group)) continue;
    if (!buckets.has(group)) {
      buckets.set(group, []);
      order.push(group);
    }
    buckets.get(group)!.push({
      code: account.code,
      name: account.name,
      balance,
      href: accountLedgerHref(account.code || account.name),
    });
  }

  // Any live balance whose CoA row was missing still appears.
  for (const row of balances) {
    if (row.type !== type) continue;
    if (!includeZeros && !row.balance) continue;
    const group = (row.group || type).trim() || type;
    if (/^imported$/i.test(group)) continue;
    const list = buckets.get(group) || [];
    if (!buckets.has(group)) {
      buckets.set(group, list);
      order.push(group);
    }
    if (!list.some((line) => line.code === row.code && line.name === row.name)) {
      list.push({
        code: row.code,
        name: row.name,
        balance: row.balance,
        href: accountLedgerHref(row.code || row.name),
      });
    }
  }

  return order
    .map((group) => {
      const accountsInGroup = buckets.get(group) || [];
      const total = accountsInGroup.reduce((sum, line) => sum + line.balance, 0);
      return { group, accounts: accountsInGroup, total };
    })
    .filter((section) => section.accounts.length > 0);
}

function formatStatementAmount(amount: number) {
  if (!amount) return "—";
  return money(amount);
}

/** Manager-style category card: section header + group labels + expandable account detail. */
function CategoryStatementCard({
  title,
  total,
  groups,
  extraLines,
  emptyMessage = "No accounts in this section.",
  totalHref,
  asOf,
}: {
  title: string;
  total: number;
  groups: StatementGroup[];
  extraLines?: StatementLine[];
  emptyMessage?: string;
  totalHref?: string | null;
  /** When set, expanded rows show ledger lines as-of this date. */
  asOf?: string | null;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const hasBody = groups.length > 0 || (extraLines && extraLines.length > 0);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-[#f7f3eb] px-4 py-3">
        <h3 className="text-[14px] font-semibold text-slate-900">{title}</h3>
        {totalHref ? (
          <Link
            href={totalHref}
            className="text-[14px] font-semibold tabular-nums text-sky-700 hover:underline"
            title="Open source breakdown"
          >
            {money(total)}
          </Link>
        ) : (
          <span className="text-[14px] font-semibold tabular-nums text-slate-900">
            {money(total)}
          </span>
        )}
      </div>
      <div className="px-4 py-3">
        {!hasBody ? (
          title.toLowerCase().includes("net profit") ? (
            <p className="py-2 text-[12px] text-slate-500">
              Income − expenses for the period ending on this balance sheet date.
            </p>
          ) : (
            <p className="py-4 text-center text-[12px] text-slate-400">{emptyMessage}</p>
          )
        ) : (
          <div className="space-y-4">
            {groups.map((section) => (
              <div key={section.group}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <p className="text-[10px] font-semibold tracking-[0.08em] text-slate-500 uppercase">
                    {section.group}
                  </p>
                  <span className="text-[11px] font-semibold tabular-nums text-slate-500">
                    {formatStatementAmount(section.total)}
                  </span>
                </div>
                <ul className="space-y-1">
                  {section.accounts.map((line) => {
                    const rowKey = `${section.group}:${line.code}:${line.name}`;
                    const open = expandedKey === rowKey;
                    const detailQuery = line.code || line.name;
                    return (
                      <li key={rowKey} className="rounded-md">
                        <div className="flex items-baseline justify-between gap-3 pl-3 text-[12px]">
                          <button
                            type="button"
                            className="min-w-0 flex flex-1 items-baseline gap-2 text-left text-sky-800 hover:underline"
                            title={open ? "Hide detail" : "Show ledger detail"}
                            onClick={() =>
                              setExpandedKey(open ? null : rowKey)
                            }
                          >
                            <span
                              className="shrink-0 text-[10px] text-slate-400"
                              aria-hidden
                            >
                              {open ? "▾" : "▸"}
                            </span>
                            {line.code ? (
                              <span className="shrink-0 font-mono text-[10px] text-slate-400">
                                {line.code}
                              </span>
                            ) : null}
                            <span className="min-w-0 truncate font-medium">
                              {line.name}
                            </span>
                          </button>
                          {line.href && line.balance ? (
                            <Link
                              href={line.href}
                              className="shrink-0 tabular-nums text-sky-700 hover:underline"
                              title="Open full account ledger"
                            >
                              {formatStatementAmount(line.balance)}
                            </Link>
                          ) : (
                            <span className="shrink-0 tabular-nums text-slate-600">
                              {formatStatementAmount(line.balance)}
                            </span>
                          )}
                        </div>
                        {open ? (
                          <AccountInlineDetail
                            query={detailQuery}
                            asOf={asOf}
                            fullHref={line.href || accountLedgerHref(detailQuery)}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {extraLines?.map((line) => (
              <div
                key={`extra-${line.name}`}
                className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2 text-[12px]"
              >
                {line.href ? (
                  <Link href={line.href} className="text-sky-800 hover:underline">
                    {line.name}
                  </Link>
                ) : (
                  <span className="font-medium text-slate-800">{line.name}</span>
                )}
                <span className="tabular-nums text-slate-700">
                  {formatStatementAmount(line.balance)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Expandable in-depth ledger lines under a balance-sheet / P&L account. */
function AccountInlineDetail({
  query,
  asOf,
  fullHref,
}: {
  query: string;
  asOf?: string | null;
  fullHref: string;
}) {
  const detail = useMemo(
    () => ledgerForAccount(query, asOf),
    [query, asOf],
  );
  const lines = detail.lines;
  const recent = lines.slice(-12);
  const prior = lines.slice(0, Math.max(0, lines.length - recent.length));
  // Accumulate the running balance before rendering. Advancing it inside the
  // map mutated a variable mid-render, so a re-run of the map compounded the
  // totals — a balance column that drifted the more the panel repainted.
  const openingBalance = prior.reduce(
    (sum, line) => sum + line.debit - line.credit,
    0,
  );
  const recentRows: { line: (typeof recent)[number]; running: number }[] = [];
  let runningTotal = openingBalance;
  for (const line of recent) {
    runningTotal += line.debit - line.credit;
    recentRows.push({ line, running: runningTotal });
  }

  return (
    <div className="mt-1.5 mb-2 ml-3 overflow-hidden rounded-lg border border-slate-100 bg-slate-50/80">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
        <p className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
          {detail.account
            ? `${detail.account.type} · ${lines.length} posting${lines.length === 1 ? "" : "s"}`
            : "No matching account"}
        </p>
        <Link
          href={fullHref}
          className="text-[10px] font-semibold text-sky-700 hover:underline"
        >
          Full ledger →
        </Link>
      </div>
      {!lines.length ? (
        <p className="px-3 py-3 text-[11px] text-slate-400">
          No postings for this account yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[11px]">
            <thead>
              <tr className="text-[9px] tracking-wide text-slate-400 uppercase">
                <th className="px-3 py-1.5 font-medium">Date</th>
                <th className="px-2 py-1.5 font-medium">Narration</th>
                <th className="px-2 py-1.5 font-medium">Origin</th>
                <th className="px-2 py-1.5 text-right font-medium">Debit</th>
                <th className="px-2 py-1.5 text-right font-medium">Credit</th>
                <th className="px-3 py-1.5 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {lines.length > recent.length ? (
                <tr className="border-t border-slate-100 text-slate-400">
                  <td colSpan={6} className="px-3 py-1.5">
                    Showing last {recent.length} of {lines.length} —{" "}
                    <Link href={fullHref} className="text-sky-700 hover:underline">
                      view all
                    </Link>
                  </td>
                </tr>
              ) : null}
              {recentRows.map(({ line, running }) => {
                const origin = originLinkForLedgerLine(line);
                return (
                  <tr
                    key={line.id}
                    className="border-t border-slate-100/80 text-slate-700"
                  >
                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">
                      {line.date}
                    </td>
                    <td className="max-w-[180px] truncate px-2 py-1.5">
                      {line.narration || "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      {origin ? (
                        <OriginLink
                          href={origin.href}
                          label={origin.label}
                          entityLabel={origin.entityLabel}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {line.debit ? money(line.debit) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {line.credit ? money(line.credit) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                      {money(running)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExportBar({ spec }: { spec: TableExport }) {
  return (
    <div className="mb-3 flex justify-end" data-print-hide>
      <ReportExportMenu spec={spec} />
    </div>
  );
}

function Section({
  title,
  description,
  actions,
  stats,
  controls,
  children,
  footer,
  exportSpec,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  stats?: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  exportSpec?: TableExport | null;
}) {
  return (
    <ReportShell
      title={title}
      description={description}
      exportSpec={exportSpec}
      actions={actions}
      stats={stats}
      controls={controls}
      footer={footer}
    >
      {children}
    </ReportShell>
  );
}

function OriginLink({
  href,
  label,
  entityLabel,
}: {
  href: string;
  label: string;
  entityLabel?: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex max-w-full flex-col gap-0.5 text-left text-sky-700 hover:underline"
      title="Open source document"
    >
      <span className="truncate font-mono text-[12px] font-medium">{label}</span>
      {entityLabel ? (
        <span className="truncate text-[10px] text-slate-400">{entityLabel}</span>
      ) : null}
    </Link>
  );
}

function RowsTable({
  rows,
  showBalance = false,
  compact = false,
  linkAccounts = false,
}: {
  rows: { code: string; name: string; debit: number; credit: number; balance?: number }[];
  showBalance?: boolean;
  /** Slimmer columns for side-by-side balance sheet panels. */
  compact?: boolean;
  /** Link account rows to the Account Ledger so users can see posting origins. */
  linkAccounts?: boolean;
}) {
  const ids = useMemo(
    () => rows.map((row) => `${row.code}::${row.name}`),
    [rows],
  );
  const selection = useRowSelection(ids);

  if (!rows.length) {
    return (
      <ReportEmpty
        title="No ledger activity yet"
        message="Post journal entries, receipts, payments, or invoices to populate this report."
      />
    );
  }

  const columns = compact
    ? ["Code", "Account", "Balance"]
    : showBalance
      ? ["Code", "Account", "Debit", "Credit", "Balance"]
      : ["Code", "Account", "Debit", "Credit"];

  function ledgerHref(row: { code: string; name: string }) {
    const query = (row.code || row.name || "").trim();
    if (!linkAccounts || !query) return null;
    // Synthetic P&L rollup — open the profit & loss statement instead of a ledger.
    if (!row.code && /earnings to date/i.test(row.name)) {
      return profitAndLossHref();
    }
    return accountLedgerHref(query);
  }

  function accountCell(row: { code: string; name: string }) {
    const href = ledgerHref(row);
    if (!href) {
      return (
        <td className={`${reportTdClass} break-words font-medium text-slate-800`}>
          {row.name}
        </td>
      );
    }
    return (
      <td className={`${reportTdClass} break-words font-medium`}>
        <MoneyLink href={href}>{row.name}</MoneyLink>
      </td>
    );
  }

  function amountCell(
    row: { code: string; name: string },
    amount: number,
    opts?: { emphasize?: boolean; emptyDash?: boolean },
  ) {
    const href = ledgerHref(row);
    const text =
      opts?.emptyDash && !amount ? "—" : money(amount);
    const className = `${reportTdRightClass} ${
      opts?.emphasize ? "font-medium" : ""
    }`.trim();
    if (!href || (opts?.emptyDash && !amount)) {
      return <td className={className}>{text}</td>;
    }
    return (
      <td className={className}>
        <MoneyLink href={href}>{text}</MoneyLink>
      </td>
    );
  }

  return (
    <div className={compact ? "overflow-x-auto" : undefined}>
      {compact ? (
        <>
          <ExportBar
            spec={{
              title: "Account balances",
              filename: "account-balances",
              columns,
              rows: rows.map((row) => [row.code, row.name, row.balance ?? 0]),
            }}
          />
          <table className="w-full min-w-[320px] text-left text-[12px]">
            <thead>
              <tr className={reportTheadClass}>
                <th className={reportThCheckClass}>
                  <Checkbox
                    checked={selection.allSelected}
                    onCheckedChange={selection.toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
                <th className={`${reportThClass} w-16`}>Code</th>
                <th className={reportThClass}>Account</th>
                <th className={`${reportThRightClass} w-28`}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = `${row.code}::${row.name}`;
                const isSelected = selection.isSelected(id);
                return (
                  <tr
                    key={id}
                    data-selected={isSelected || undefined}
                    className={reportTrClass}
                  >
                    <td className={reportTdCheckClass}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => selection.toggle(id)}
                        aria-label={`Select ${row.name}`}
                      />
                    </td>
                    <td className={`${reportTdClass} font-mono text-slate-500`}>
                      {row.code || "—"}
                    </td>
                    {accountCell(row)}
                    {amountCell(row, row.balance ?? 0, { emphasize: true })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        <ReportTableWrap>
          <ExportBar
            spec={{
              title: showBalance ? "Account balances" : "Trial balance rows",
              filename: showBalance ? "account-balances" : "trial-balance-rows",
              columns,
              rows: rows.map((row) =>
                showBalance
                  ? [row.code, row.name, row.debit, row.credit, row.balance ?? 0]
                  : [row.code, row.name, row.debit, row.credit],
              ),
            }}
          />
          <table className={reportTableClass}>
            <thead>
              <tr className={reportTheadClass}>
                <th className={reportThCheckClass}>
                  <Checkbox
                    checked={selection.allSelected}
                    onCheckedChange={selection.toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
                <th className={reportThClass}>Code</th>
                <th className={reportThClass}>Account</th>
                <th className={reportThRightClass}>Debit</th>
                <th className={reportThRightClass}>Credit</th>
                {showBalance && <th className={reportThRightClass}>Balance</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = `${row.code}::${row.name}`;
                const isSelected = selection.isSelected(id);
                return (
                  <tr
                    key={id}
                    data-selected={isSelected || undefined}
                    className={reportTrClass}
                  >
                    <td className={reportTdCheckClass}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => selection.toggle(id)}
                        aria-label={`Select ${row.name}`}
                      />
                    </td>
                    <td className={`${reportTdClass} font-mono text-slate-500`}>
                      {row.code || "—"}
                    </td>
                    {accountCell(row)}
                    {amountCell(row, row.debit, { emptyDash: true })}
                    {amountCell(row, row.credit, { emptyDash: true })}
                    {showBalance && amountCell(row, row.balance ?? 0, { emphasize: true })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ReportTableWrap>
      )}
    </div>
  );
}

function ComparativeTable({ rows }: { rows: ComparativeRow[] }) {
  const ids = useMemo(
    () => rows.map((row) => `${row.code}::${row.name}`),
    [rows],
  );
  const selection = useRowSelection(ids);

  function ledgerHref(row: { code: string; name: string }) {
    const query = (row.code || row.name || "").trim();
    if (!query) return null;
    if (!row.code && /earnings to date/i.test(row.name)) {
      return profitAndLossHref();
    }
    return accountLedgerHref(query);
  }

  function linkedAmount(row: ComparativeRow, amount: number, className: string) {
    const href = ledgerHref(row);
    if (!href) return <td className={className}>{money(amount)}</td>;
    return (
      <td className={className}>
        <MoneyLink href={href}>{money(amount)}</MoneyLink>
      </td>
    );
  }

  if (!rows.length) {
    return (
      <ReportEmpty
        title="No comparative activity"
        message="There is nothing to compare in this section for the selected periods."
      />
    );
  }
  return (
    <ReportTableWrap>
      <ExportBar
        spec={{
          title: "Comparative report",
          filename: "comparative-report",
          columns: ["Code", "Account", "Current", "Prior", "Variance", "Δ %"],
          rows: rows.map((row) => [
            row.code,
            row.name,
            row.current,
            row.prior,
            row.variance,
            row.variancePercent === null ? "" : row.variancePercent,
          ]),
        }}
      />
      <table className={reportTableClass}>
        <thead>
          <tr className={reportTheadClass}>
            <th className={reportThCheckClass}>
              <Checkbox
                checked={selection.allSelected}
                onCheckedChange={selection.toggleAll}
                aria-label="Select all rows"
              />
            </th>
            <th className={reportThClass}>Code</th>
            <th className={reportThClass}>Account</th>
            <th className={reportThRightClass}>Current</th>
            <th className={reportThRightClass}>Prior</th>
            <th className={reportThRightClass}>Variance</th>
            <th className={reportThRightClass}>Δ %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = `${row.code}::${row.name}`;
            const isSelected = selection.isSelected(id);
            const href = ledgerHref(row);
            return (
              <tr
                key={id}
                data-selected={isSelected || undefined}
                className={reportTrClass}
              >
                <td className={reportTdCheckClass}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => selection.toggle(id)}
                    aria-label={`Select ${row.name}`}
                  />
                </td>
                <td className={`${reportTdClass} font-mono text-slate-500`}>{row.code || "—"}</td>
                <td className={`${reportTdClass} font-medium`}>
                  {href ? (
                    <MoneyLink href={href}>{row.name}</MoneyLink>
                  ) : (
                    row.name
                  )}
                </td>
                {linkedAmount(row, row.current, reportTdRightClass)}
                {linkedAmount(row, row.prior, `${reportTdRightClass} text-slate-500`)}
                <td
                  className={`${reportTdRightClass} ${
                    row.variance >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {row.variance >= 0 ? "+" : ""}
                  {money(row.variance)}
                </td>
                <td className={`${reportTdRightClass} text-slate-500`}>
                  {row.variancePercent === null ? "—" : `${row.variancePercent}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ReportTableWrap>
  );
}

function InventoryRowsTable({
  inventory,
}: {
  inventory: {
    id: string;
    code: string;
    name: string;
    openingQty: number;
    stockInQty: number;
    writeOffQty: number;
    soldQty: number;
    closingQty: number;
    openingValue: number;
    stockInValue: number;
    writeOffValue: number;
    soldValue: number;
    stockValue: number;
    closingValue: number;
  }[];
}) {
  const ids = useMemo(() => inventory.map((item) => item.id), [inventory]);
  const selection = useRowSelection(ids);

  return (
    <ReportTableWrap>
      <ExportBar
        spec={{
          title: "Inventory value",
          filename: "inventory-value",
          columns: [
            "Code",
            "Item",
            "Opening qty",
            "Stock in",
            "Write-offs",
            "Sold",
            "Closing qty",
            "Opening value",
            "Stock value",
            "Closing value",
          ],
          rows: inventory.map((item) => [
            item.code,
            item.name,
            item.openingQty,
            item.stockInQty,
            item.writeOffQty,
            item.soldQty,
            item.closingQty,
            item.openingValue,
            item.stockValue,
            item.closingValue,
          ]),
        }}
      />
      <table className={reportTableClass}>
        <thead>
          <tr className={reportTheadClass}>
            <th className={reportThCheckClass}>
              <Checkbox
                checked={selection.allSelected}
                onCheckedChange={selection.toggleAll}
                aria-label="Select all inventory rows"
              />
            </th>
            <th className={reportThClass}>Code</th>
            <th className={reportThClass}>Item</th>
            <th className={reportThRightClass}>Opening</th>
            <th className={reportThRightClass}>Stock in</th>
            <th className={reportThRightClass}>Write-offs</th>
            <th className={reportThRightClass}>Sold</th>
            <th className={reportThRightClass}>Closing qty</th>
            <th className={reportThRightClass}>Opening value</th>
            <th className={reportThRightClass}>Stock value</th>
            <th className={reportThRightClass}>Closing value</th>
          </tr>
        </thead>
        <tbody>
          {inventory.map((item) => {
            const isSelected = selection.isSelected(item.id);
            return (
              <tr
                key={item.id}
                data-selected={isSelected || undefined}
                className={reportTrClass}
              >
                <td className={reportTdCheckClass}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => selection.toggle(item.id)}
                    aria-label={`Select ${item.name}`}
                  />
                </td>
                <td className={`${reportTdClass} font-mono text-slate-500`}>
                  {item.code || "—"}
                </td>
                <td className={`${reportTdClass} font-medium`}>
                  <Link
                    href={hrefForSourceDocument(
                      "inventory",
                      "inventory-items",
                      item.code || item.name,
                    )}
                    className="text-sky-700 hover:underline"
                    title="Open inventory item"
                  >
                    {item.name}
                  </Link>
                </td>
                <td className={reportTdRightClass}>{item.openingQty}</td>
                <td className={reportTdRightClass}>{item.stockInQty}</td>
                <td className={reportTdRightClass}>{item.writeOffQty}</td>
                <td className={reportTdRightClass}>{item.soldQty}</td>
                <td className={`${reportTdRightClass} font-semibold`}>{item.closingQty}</td>
                <td className={reportTdRightClass}>{money(item.openingValue)}</td>
                <td className={reportTdRightClass}>{money(item.stockValue)}</td>
                <td className={`${reportTdRightClass} font-semibold`}>{money(item.closingValue)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ReportTableWrap>
  );
}

function EquityChangesTable({
  rows,
}: {
  rows: { code: string; name: string; opening: number; movement: number; closing: number }[];
}) {
  const ids = useMemo(() => rows.map((row) => row.code), [rows]);
  const selection = useRowSelection(ids);

  return (
    <div className="overflow-x-auto">
      <ExportBar
        spec={{
          title: "Statement of changes in equity",
          filename: "equity-changes",
          columns: ["Code", "Account", "Opening", "Movement", "Closing"],
          rows: rows.map((row) => [row.code, row.name, row.opening, row.movement, row.closing]),
        }}
      />
      <table className="w-full min-w-[560px] text-left text-[12px]">
        <thead>
          <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
            <th className={reportThCheckClass}>
              <Checkbox
                checked={selection.allSelected}
                onCheckedChange={selection.toggleAll}
                aria-label="Select all equity rows"
              />
            </th>
            <th className="px-2 py-2 font-medium">Code</th>
            <th className="px-2 py-2 font-medium">Account</th>
            <th className="px-2 py-2 text-right font-medium">Opening</th>
            <th className="px-2 py-2 text-right font-medium">Movement</th>
            <th className="px-2 py-2 text-right font-medium">Closing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = selection.isSelected(row.code);
            return (
              <tr
                key={row.code}
                data-selected={isSelected || undefined}
                className="border-b border-slate-50 hover:bg-slate-50/60 data-[selected=true]:bg-slate-50/80"
              >
                <td className={reportTdCheckClass}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => selection.toggle(row.code)}
                    aria-label={`Select ${row.name}`}
                  />
                </td>
                <td className="px-2 py-2 font-mono text-slate-500">{row.code}</td>
                <td className="px-2 py-2">{row.name}</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(row.opening)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(row.movement)}</td>
                <td className="px-2 py-2 text-right font-medium tabular-nums">{money(row.closing)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BankPendingTable({
  rows,
}: {
  rows: { id: string; kind: string; reference: string; date: string; amount: number }[];
}) {
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const selection = useRowSelection(ids);

  function hrefForPending(row: { kind: string; reference: string; id: string }) {
    const kind = row.kind.toLowerCase();
    if (kind.includes("receipt")) {
      return hrefForSourceDocument("banking", "receipts", row.reference || row.id);
    }
    if (kind.includes("payment")) {
      return hrefForSourceDocument("banking", "payments", row.reference || row.id);
    }
    if (kind.includes("transfer")) {
      return hrefForSourceDocument(
        "banking",
        "inter-account-transfers",
        row.reference || row.id,
      );
    }
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <ExportBar
        spec={{
          title: "Bank pending items",
          filename: "bank-pending",
          columns: ["Kind", "Reference", "Date", "Amount"],
          rows: rows.map((row) => [row.kind, row.reference, row.date, row.amount]),
        }}
      />
      <table className="w-full min-w-[480px] text-left text-[12px]">
        <thead>
          <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
            <th className={reportThCheckClass}>
              <Checkbox
                checked={selection.allSelected}
                onCheckedChange={selection.toggleAll}
                aria-label="Select all pending items"
                disabled={!rows.length}
              />
            </th>
            <th className="px-2 py-2">Kind</th>
            <th className="px-2 py-2">Reference</th>
            <th className="px-2 py-2">Date</th>
            <th className="px-2 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = selection.isSelected(row.id);
            const href = hrefForPending(row);
            return (
              <tr
                key={row.id}
                data-selected={isSelected || undefined}
                className="border-b border-slate-50 hover:bg-slate-50/60 data-[selected=true]:bg-slate-50/80"
              >
                <td className={reportTdCheckClass}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => selection.toggle(row.id)}
                    aria-label={`Select ${row.reference}`}
                  />
                </td>
                <td className="px-2 py-2">{row.kind}</td>
                <td className="px-2 py-2">
                  {href ? (
                    <Link href={href} className="text-sky-700 hover:underline">
                      {row.reference}
                    </Link>
                  ) : (
                    row.reference
                  )}
                </td>
                <td className="px-2 py-2">{row.date || "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {href ? (
                    <Link
                      href={href}
                      className="text-sky-700 hover:underline"
                      title="Open source document"
                    >
                      {money(row.amount)}
                    </Link>
                  ) : (
                    money(row.amount)
                  )}
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={5} className="px-2 py-4 text-center text-slate-400">
                No uncleared items
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PendingApprovalPanel({
  accountHint,
}: {
  accountHint?: string;
}) {
  const [tick, setTick] = useState(0);
  const pending = useMemo(() => {
    void tick;
    return listPendingApprovalDocuments(accountHint);
  }, [accountHint, tick]);
  const allPending = useMemo(() => {
    void tick;
    return listPendingApprovalDocuments();
  }, [tick]);

  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
    window.addEventListener("financeiag-records-changed", refresh);
    return () => window.removeEventListener("financeiag-records-changed", refresh);
  }, []);

  const rows = pending.length ? pending : allPending.slice(0, 12);
  const scoped = Boolean(accountHint && pending.length);

  return (
    <div className="mt-6 rounded-xl border border-amber-200/80 bg-amber-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold text-amber-950">
            Pending approval
          </h3>
          <p className="mt-0.5 text-[11px] text-amber-900/70">
            {scoped
              ? "Draft / pending documents that touch this account — they stay off the report until approved."
              : allPending.length
                ? "Documents awaiting approval are excluded from report figures until a reviewer approves them."
                : "No documents are waiting for approval."}
          </p>
        </div>
        <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
          {allPending.length} pending
        </span>
      </div>
      {!rows.length ? null : (
        <div className="overflow-x-auto rounded-lg border border-amber-100 bg-white">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-amber-50 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.module}:${row.entityKey}:${row.id}`} className="border-b border-slate-50">
                  <td className="px-3 py-2.5 text-slate-600">{row.label}</td>
                  <td className="px-3 py-2.5">
                    <Link
                      href={row.href}
                      className="font-medium text-sky-700 hover:underline"
                      title="Open for approval"
                    >
                      {row.reference}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{row.date || "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <Link
                      href={row.href}
                      className="text-sky-700 hover:underline"
                      title="Open for approval"
                    >
                      {money(row.amount)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BudgetRowsTable({
  rows,
}: {
  rows: { code: string; name: string; budget: number; actual: number; variance: number }[];
}) {
  const ids = useMemo(() => rows.map((row) => row.code), [rows]);
  const selection = useRowSelection(ids);

  return (
    <div className="overflow-x-auto">
      <ExportBar
        spec={{
          title: "Budget vs actual",
          filename: "budget-vs-actual",
          columns: ["Account", "Budget", "Actual", "Variance"],
          rows: rows.map((row) => [`${row.code} ${row.name}`, row.budget, row.actual, row.variance]),
        }}
      />
      <table className="w-full min-w-[560px] text-left text-[12px]">
        <thead>
          <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
            <th className={reportThCheckClass}>
              <Checkbox
                checked={selection.allSelected}
                onCheckedChange={selection.toggleAll}
                aria-label="Select all budget rows"
                disabled={!rows.length}
              />
            </th>
            <th className="px-2 py-2">Account</th>
            <th className="px-2 py-2 text-right">Budget</th>
            <th className="px-2 py-2 text-right">Actual</th>
            <th className="px-2 py-2 text-right">Variance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = selection.isSelected(row.code);
            return (
              <tr
                key={row.code}
                data-selected={isSelected || undefined}
                className="border-b border-slate-50 hover:bg-slate-50/60 data-[selected=true]:bg-slate-50/80"
              >
                <td className={reportTdCheckClass}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => selection.toggle(row.code)}
                    aria-label={`Select ${row.name}`}
                  />
                </td>
                <td className="px-2 py-2">
                  <MoneyLink href={accountLedgerHref(row.code || row.name)}>
                    {row.code} {row.name}
                  </MoneyLink>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  <MoneyLink href={accountLedgerHref(row.code || row.name)}>
                    {money(row.budget)}
                  </MoneyLink>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  <MoneyLink href={accountLedgerHref(row.code || row.name)}>
                    {money(row.actual)}
                  </MoneyLink>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  <MoneyLink href={accountLedgerHref(row.code || row.name)}>
                    {money(row.variance)}
                  </MoneyLink>
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={5} className="px-2 py-4 text-center text-slate-400">
                No budget lines yet. Add budgets under Settings when available.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AccountLedgerLinesTable({
  lines,
}: {
  lines: LedgerLine[];
}) {
  const ids = useMemo(() => lines.map((line) => line.id), [lines]);
  const selection = useRowSelection(ids);
  let running = 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-[12px]">
        <thead>
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            <th className={reportThCheckClass}>
              <Checkbox
                checked={selection.allSelected}
                onCheckedChange={selection.toggleAll}
                aria-label="Select all ledger lines"
                disabled={!lines.length}
              />
            </th>
            <th className="px-2 py-2 font-medium">Date</th>
            <th className="px-2 py-2 font-medium">Narration</th>
            <th className="px-2 py-2 font-medium">Origin</th>
            <th className="px-2 py-2 text-right font-medium">Debit</th>
            <th className="px-2 py-2 text-right font-medium">Credit</th>
            <th className="px-2 py-2 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-2 py-8 text-center text-slate-400">
                No postings for this account yet.
              </td>
            </tr>
          ) : (
            lines.map((line) => {
              running += line.debit - line.credit;
              const isSelected = selection.isSelected(line.id);
              const origin = originLinkForLedgerLine(line);
              return (
                <tr
                  key={line.id}
                  data-selected={isSelected || undefined}
                  className="border-b border-slate-50 hover:bg-slate-50/60 data-[selected=true]:bg-slate-50/80"
                >
                  <td className={reportTdCheckClass}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => selection.toggle(line.id)}
                      aria-label={`Select ${line.narration}`}
                    />
                  </td>
                  <td className="px-2 py-2 text-slate-500">{line.date}</td>
                  <td className="px-2 py-2 text-slate-800">{line.narration}</td>
                  <td className="px-2 py-2">
                    {origin ? (
                      <OriginLink
                        href={origin.href}
                        label={origin.label}
                        entityLabel={origin.entityLabel}
                      />
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {line.debit ? (
                      origin ? (
                        <Link
                          href={origin.href}
                          className="text-sky-700 hover:underline"
                          title="Open source document"
                        >
                          {money(line.debit)}
                        </Link>
                      ) : (
                        money(line.debit)
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {line.credit ? (
                      origin ? (
                        <Link
                          href={origin.href}
                          className="text-sky-700 hover:underline"
                          title="Open source document"
                        >
                          {money(line.credit)}
                        </Link>
                      ) : (
                        money(line.credit)
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium">{money(running)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function CompareModeButtons({
  mode,
  onChange,
}: {
  mode: CompareMode;
  onChange: (mode: CompareMode) => void;
}) {
  const options: { id: CompareMode; label: string }[] = [
    { id: "off", label: "Off" },
    { id: "prior-month", label: "Prior month" },
    { id: "prior-year", label: "Prior year" },
    { id: "custom", label: "Custom" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[11px] text-slate-500">Compare</span>
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          variant={mode === option.id ? "default" : "outline"}
          size="sm"
          className={`h-8 ${mode === option.id && option.id !== "off" ? "bg-orange-500 hover:bg-orange-600" : ""}`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

const BUCKETS: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

function BasisBadge() {
  const [basis, setBasis] = useState<"accrual" | "cash">("accrual");
  useEffect(() => {
    const refresh = () => setBasis(loadManagerSettings().accountingBasis);
    refresh();
    window.addEventListener("financeiag-settings-changed", refresh);
    return () => window.removeEventListener("financeiag-settings-changed", refresh);
  }, []);
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
      {basis} basis
    </span>
  );
}

function AgedPanel({ side }: { side: "receivable" | "payable" }) {
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [tick, setTick] = useState(0);
  const report = useMemo(() => {
    void tick;
    return buildAgedReport(side, asOf);
  }, [side, asOf, tick]);
  const ids = useMemo(() => report.rows.map((row) => row.id), [report.rows]);
  const selection = useRowSelection(ids);

  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
    window.addEventListener("financeiag-records-changed", refresh);
    return () => window.removeEventListener("financeiag-records-changed", refresh);
  }, []);

  const title = side === "receivable" ? "Aged Receivables" : "Aged Payables";

  return (
    <Section
      title={title}
      description={`Open ${side === "receivable" ? "customer invoices" : "supplier bills"} aged by days overdue`}
      actions={<ReportRefreshButton onClick={() => setTick((t) => t + 1)} />}
      exportSpec={{
        title,
        filename: side === "receivable" ? "aged-receivables" : "aged-payables",
        columns: ["Party", "Reference", "Due", "Total", "Paid", "Balance", "Bucket"],
        rows: report.rows.map((row) => [
          row.party,
          row.reference,
          row.dueDate,
          row.total,
          row.paid,
          row.balance,
          row.bucket,
        ]),
      }}
      stats={
        <>
          {BUCKETS.map((b) => (
            <ReportStat
              key={b}
              label={b === "current" ? "Current" : `${b} days`}
              value={money(report.totals[b])}
            />
          ))}
          <ReportStat label="Total outstanding" value={money(report.totals.balance)} accent />
        </>
      }
      controls={
        <div>
          <Label className="mb-1 text-[11px] text-slate-500">As of</Label>
          <Input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            className="h-8 w-[150px]"
          />
        </div>
      }
    >
      {!report.rows.length ? (
        <ReportEmpty
          title={`No open ${side === "receivable" ? "invoices" : "bills"}`}
          message={`Create documents and allocate receipts/payments to see ${side} aging.`}
        />
      ) : (
        <ReportTableWrap>
          <table className={`${reportTableClass} min-w-[720px]`}>
            <thead>
              <tr className={reportTheadClass}>
                <th className={reportThCheckClass}>
                  <Checkbox
                    checked={selection.allSelected}
                    onCheckedChange={selection.toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
                <th className={reportThClass}>Party</th>
                <th className={reportThClass}>Reference</th>
                <th className={reportThClass}>Due</th>
                <th className={reportThRightClass}>Total</th>
                <th className={reportThRightClass}>Paid</th>
                <th className={reportThRightClass}>Balance</th>
                <th className={reportThClass}>Bucket</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const isSelected = selection.isSelected(row.id);
                return (
                  <tr
                    key={row.id}
                    data-selected={isSelected || undefined}
                    className={reportTrClass}
                  >
                    <td className={reportTdCheckClass}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => selection.toggle(row.id)}
                        aria-label={`Select ${row.reference}`}
                      />
                    </td>
                    <td className={`${reportTdClass} font-medium text-slate-800`}>{row.party}</td>
                    <td className={reportTdClass}>
                      <OriginLink
                        href={hrefForSourceDocument(
                          side === "receivable" ? "sales" : "purchases",
                          side === "receivable" ? "sales-invoices" : "purchase-invoices",
                          row.reference || row.id,
                        )}
                        label={row.reference}
                        entityLabel={
                          side === "receivable" ? "Sales invoice" : "Purchase invoice"
                        }
                      />
                    </td>
                    <td className={`${reportTdClass} text-slate-500`}>{row.dueDate}</td>
                    {(() => {
                      const invoiceHref = hrefForSourceDocument(
                        side === "receivable" ? "sales" : "purchases",
                        side === "receivable" ? "sales-invoices" : "purchase-invoices",
                        row.reference || row.id,
                      );
                      const amountCell = (amount: number, emphasize?: boolean) => (
                        <td
                          className={`${reportTdRightClass} ${emphasize ? "font-semibold" : ""}`}
                        >
                          <Link
                            href={invoiceHref}
                            className="text-sky-700 hover:underline"
                            title="Open invoice detail"
                          >
                            {money(amount)}
                          </Link>
                        </td>
                      );
                      return (
                        <>
                          {amountCell(row.total)}
                          {amountCell(row.paid)}
                          {amountCell(row.balance, true)}
                        </>
                      );
                    })()}
                    <td className={reportTdClass}>
                      <span className="inline-flex rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
                        {row.bucket}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ReportTableWrap>
      )}
    </Section>
  );
}

export function FinancialReportPanel({ kind }: { kind: LiveReportKind }) {
  const ledger = useLedger();
  const searchParams = useSearchParams();
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  /** Widen From once when books start before the default calendar YTD. */
  const [periodAutoAdjusted, setPeriodAutoAdjusted] = useState(false);
  const [compareMode, setCompareMode] = useState<CompareMode>("off");
  const [compareFrom, setCompareFrom] = useState(() => `${new Date().getFullYear() - 1}-01-01`);
  const [compareTo, setCompareTo] = useState(() => `${new Date().getFullYear() - 1}-12-31`);
  const [compareAsOf, setCompareAsOf] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [accountQuery, setAccountQuery] = useState(
    () => searchParams.get("account") || "1100",
  );
  const [bankAccount, setBankAccount] = useState(defaultBankAccountName);
  const [statementBalance, setStatementBalance] = useState("0");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [reportNonce, setReportNonce] = useState(0);
  const [tb, setTb] = useState<ServerTrialBalance | null>(null);
  const [bs, setBs] = useState<ServerBalanceSheet | null>(null);
  const [bsCompare, setBsCompare] = useState<ReturnType<
    typeof comparativeBalanceSheetFromReports
  > | null>(null);
  const [pl, setPl] = useState<ReturnType<typeof ledger.profitAndLoss> | null>(null);
  const [plCompare, setPlCompare] = useState<ReturnType<
    typeof comparativeProfitAndLossFromReports
  > | null>(null);
  const [plByClass, setPlByClass] = useState<ProfitAndLossByClassReport | null>(null);
  const [serverReportLoading, setServerReportLoading] = useState(false);

  useEffect(() => {
    const account = (searchParams.get("account") || "").trim();
    if (account) setAccountQuery(account);
  }, [searchParams]);

  useEffect(() => {
    const fromStatement = latestStatementBalanceForAccount(bankAccount);
    if (fromStatement !== null) {
      setStatementBalance(String(fromStatement));
    }
  }, [bankAccount]);

  useEffect(() => {
    if (periodAutoAdjusted) return;
    const periodKinds = new Set([
      "profit-and-loss",
      "profit-and-loss-by-class",
      "division-exception-report",
      "cash-flow",
      "tax-summary",
      "statement-of-changes-in-equity",
      "cash-flow-indirect",
      "other-comprehensive-income",
      "budget-vs-actual",
      "forecast-p-l",
      "management-analysis",
    ]);
    if (!periodKinds.has(kind)) return;
    void ledger.tick;
    const suggested = defaultProfitAndLossFrom(to);
    if (suggested < from) {
      setFrom(suggested);
      setPeriodAutoAdjusted(true);
    } else if (earliestLedgerActivityDate()) {
      setPeriodAutoAdjusted(true);
    }
  }, [kind, from, to, ledger.tick, periodAutoAdjusted]);

  const classOptions = useMemo(() => {
    void ledger.tick;
    return divisionSelectOptions();
  }, [ledger.tick]);

  const supportsCompare =
    kind === "profit-and-loss" || kind === "balance-sheet" || kind === "cash-flow";

  const resolvedComparePeriod = useMemo(
    () => resolveComparePeriod(from, to, compareMode, compareFrom, compareTo),
    [from, to, compareMode, compareFrom, compareTo],
  );
  const resolvedCompareAsOf = useMemo(
    () => resolveCompareAsOf(asOf, compareMode, compareAsOf),
    [asOf, compareMode, compareAsOf],
  );

  const isServerStatement =
    kind === "trial-balance" ||
    kind === "balance-sheet" ||
    kind === "profit-and-loss" ||
    kind === "profit-and-loss-by-class";

  useEffect(() => {
    if (!isServerStatement) {
      setTb(null);
      setBs(null);
      setBsCompare(null);
      setPl(null);
      setPlCompare(null);
      setPlByClass(null);
      setServerReportLoading(false);
      return;
    }
    let cancelled = false;
    setServerReportLoading(true);
    const division = divisionFilter || undefined;
    const load = async () => {
      if (kind === "trial-balance") {
        const result = await fetchTrialBalanceFromApi(asOf, division);
        if (cancelled) return;
        setTb(result.ok ? result.data : null);
        setBs(null);
        setPl(null);
        setPlByClass(null);
      } else if (kind === "balance-sheet") {
        const current = await fetchBalanceSheetFromApi(asOf, division);
        if (cancelled) return;
        setBs(current.ok ? current.data : null);
        setTb(null);
        setPl(null);
        setPlByClass(null);
        if (resolvedCompareAsOf) {
          const prior = await fetchBalanceSheetFromApi(resolvedCompareAsOf, division);
          if (cancelled) return;
          if (current.ok && prior.ok) {
            setBsCompare(comparativeBalanceSheetFromReports(current.data, prior.data));
          } else {
            setBsCompare(null);
          }
        } else {
          setBsCompare(null);
        }
      } else if (kind === "profit-and-loss") {
        const current = await fetchProfitAndLossFromApi(from, to, division);
        if (cancelled) return;
        if (current.ok) {
          const earliest = current.data.earliestDate;
          if (!periodAutoAdjusted && earliest && earliest < from) {
            setFrom(`${earliest.slice(0, 4)}-01-01`);
            setPeriodAutoAdjusted(true);
          }
          setPl(current.data);
        } else {
          setPl(null);
        }
        setTb(null);
        setBs(null);
        setPlByClass(null);
        if (resolvedComparePeriod) {
          const prior = await fetchProfitAndLossFromApi(
            resolvedComparePeriod.from,
            resolvedComparePeriod.to,
            division,
          );
          if (cancelled) return;
          if (current.ok && prior.ok) {
            const cur = current.data as ProfitAndLossApiPayload;
            const prv = prior.data as ProfitAndLossApiPayload;
            setPlCompare(
              comparativeProfitAndLossFromReports(
                {
                  from: cur.from || from,
                  to: cur.to || to,
                  income: cur.income || [],
                  expenses: cur.expenses || [],
                  totalIncome: cur.totalIncome ?? 0,
                  totalExpenses: cur.totalExpenses ?? 0,
                  netProfit: cur.netProfit ?? 0,
                },
                {
                  from: prv.from || resolvedComparePeriod.from,
                  to: prv.to || resolvedComparePeriod.to,
                  income: prv.income || [],
                  expenses: prv.expenses || [],
                  totalIncome: prv.totalIncome ?? 0,
                  totalExpenses: prv.totalExpenses ?? 0,
                  netProfit: prv.netProfit ?? 0,
                },
              ),
            );
          } else {
            setPlCompare(null);
          }
        } else {
          setPlCompare(null);
        }
      } else if (kind === "profit-and-loss-by-class") {
        const result = await fetchProfitAndLossByClassFromApi(from, to);
        if (cancelled) return;
        setPlByClass(result.ok ? result.data : null);
        setTb(null);
        setBs(null);
        setPl(null);
      }
      if (!cancelled) setServerReportLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    kind,
    isServerStatement,
    asOf,
    from,
    to,
    divisionFilter,
    resolvedComparePeriod,
    resolvedCompareAsOf,
    reportNonce,
    periodAutoAdjusted,
  ]);
  const divisionExceptions = useMemo(() => {
    if (kind !== "division-exception-report") return null;
    void ledger.tick;
    return ledger.divisionExceptionLines(from, to);
  }, [kind, ledger, from, to, ledger.tick]);
  const cashCompare = useMemo(() => {
    void ledger.tick;
    if (kind !== "cash-flow" || !resolvedComparePeriod) return null;
    return comparativeCashFlow(from, to, resolvedComparePeriod.from, resolvedComparePeriod.to);
  }, [ledger.tick, kind, from, to, resolvedComparePeriod]);
  const cashFlow = useMemo(() => {
    if (kind !== "cash-flow") return null;
    return ledger.cashFlowStatement(from, to);
  }, [kind, ledger, from, to, ledger.tick]);
  const tax = useMemo(() => {
    if (kind !== "tax-summary") return null;
    return ledger.taxSummary(from, to);
  }, [kind, ledger, from, to, ledger.tick]);
  const equityChanges = useMemo(() => {
    if (kind !== "statement-of-changes-in-equity") return null;
    void ledger.tick;
    return statementOfChangesInEquity(from, to);
  }, [kind, ledger.tick, from, to]);
  const controls = useMemo(() => {
    if (kind !== "control-account-reconciliation") return null;
    void ledger.tick;
    return reconcileControlAccounts(asOf);
  }, [kind, ledger.tick, asOf]);
  const integrity = useMemo(() => {
    if (kind !== "integrity-tests") return null;
    void ledger.tick;
    return runAccountingIntegrityTests(asOf);
  }, [kind, ledger.tick, asOf]);
  const bankRec = useMemo(() => {
    if (kind !== "bank-reconciliation") return null;
    void ledger.tick;
    return reconcileBankAccount({
      account: bankAccount,
      statementBalance: Number(statementBalance) || 0,
      asOf,
    });
  }, [kind, ledger.tick, bankAccount, statementBalance, asOf]);
  const inventory = useMemo(() => {
    if (kind !== "inventory-value-summary") return null;
    void ledger.tick;
    return inventoryStockRollforward();
  }, [kind, ledger.tick]);
  const accountLedger = useMemo(() => {
    if (kind !== "ledgers") return null;
    return ledger.ledgerForAccount(accountQuery, asOf);
  }, [kind, ledger, accountQuery, asOf, ledger.tick]);

  if (kind === "aged-receivables") return <AgedPanel side="receivable" />;
  if (kind === "aged-payables") return <AgedPanel side="payable" />;
  if (kind === "customer-statements") return <PartyLedgerPanel side="receivable" />;
  if (kind === "supplier-statements") return <PartyLedgerPanel side="payable" />;
  if (kind === "contractor-ledgers") return <ContractorLedgerPanel />;
  if (kind === "management-analysis") return <ManagementAnalysisPanel tick={ledger.tick} />;

  if (
    (isServerStatement && serverReportLoading && !tb && !bs && !pl && !plByClass) ||
    (!isServerStatement && !ledger.ready)
  ) {
    return (
      <Section title="Preparing report" description="Loading posted ledger log from the database…">
        <div className="space-y-4 p-1" aria-busy aria-label="Loading report">
          <KpiStripSkeleton count={3} />
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <Skeleton className="h-3.5 w-40 bg-slate-100" />
                <Skeleton className="h-3.5 w-24 bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      </Section>
    );
  }

  const periodControls = (
    <>
      {kind === "profit-and-loss" ||
      kind === "profit-and-loss-by-class" ||
      kind === "division-exception-report" ||
      kind === "cash-flow" ||
      kind === "tax-summary" ||
      kind === "statement-of-changes-in-equity" ||
      kind === "cash-flow-indirect" ||
      kind === "other-comprehensive-income" ||
      kind === "budget-vs-actual" ||
      kind === "forecast-p-l" ? (
        <>
          <div>
            <Label className="mb-1 text-[11px] text-slate-500">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[150px]" />
          </div>
          <div>
            <Label className="mb-1 text-[11px] text-slate-500">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[150px]" />
          </div>
        </>
      ) : (
        <div>
          <Label className="mb-1 text-[11px] text-slate-500">As of</Label>
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-8 w-[150px]" />
        </div>
      )}
      {(kind === "profit-and-loss" || kind === "balance-sheet") && (
        <div>
          <Label className="mb-1 text-[11px] text-slate-500">Class</Label>
          <select
            value={divisionFilter}
            onChange={(e) => setDivisionFilter(e.target.value)}
            className="h-8 min-w-[160px] rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700"
          >
            <option value="">All classes</option>
            <option value="__unassigned__">Unassigned</option>
            {classOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {supportsCompare && (
        <CompareModeButtons mode={compareMode} onChange={setCompareMode} />
      )}
      {supportsCompare && compareMode === "custom" && kind !== "balance-sheet" && (
        <>
          <div>
            <Label className="mb-1 text-[11px] text-slate-500">Compare from</Label>
            <Input
              type="date"
              value={compareFrom}
              onChange={(e) => setCompareFrom(e.target.value)}
              className="h-8 w-[150px]"
            />
          </div>
          <div>
            <Label className="mb-1 text-[11px] text-slate-500">Compare to</Label>
            <Input
              type="date"
              value={compareTo}
              onChange={(e) => setCompareTo(e.target.value)}
              className="h-8 w-[150px]"
            />
          </div>
        </>
      )}
      {supportsCompare && compareMode === "custom" && kind === "balance-sheet" && (
        <div>
          <Label className="mb-1 text-[11px] text-slate-500">Compare as of</Label>
          <Input
            type="date"
            value={compareAsOf}
            onChange={(e) => setCompareAsOf(e.target.value)}
            className="h-8 w-[150px]"
          />
        </div>
      )}
      {kind === "ledgers" && (
        <div className="min-w-[240px]">
          <Label className="mb-1 text-[11px] text-slate-500">Account</Label>
          <ChartOfAccountsSelect
            value={accountQuery}
            onChange={setAccountQuery}
            valueMode="code"
            emptyLabel="Search chart of accounts"
            compact
            className="h-8 w-[260px]"
          />
        </div>
      )}
      {kind === "bank-reconciliation" && (
        <>
          <div>
            <Label className="mb-1 text-[11px] text-slate-500">Bank account</Label>
            <BankAccountSelect value={bankAccount} onChange={setBankAccount} />
          </div>
          <div>
            <Label className="mb-1 text-[11px] text-slate-500">Statement balance</Label>
            <Input
              value={statementBalance}
              onChange={(e) => setStatementBalance(e.target.value)}
              className="h-8 w-[140px]"
            />
          </div>
        </>
      )}
      <BasisBadge />
    </>
  );

  const refreshAction = (
    <ReportRefreshButton
      onClick={() => {
        ledger.refresh();
        setReportNonce((n) => n + 1);
      }}
    />
  );

  if (kind === "trial-balance") {
    if (!tb) return null;
    return (
      <Section
        title="Trial Balance"
        description={`Debits and credits by account as of ${tb.asOf}. Click any money amount to open the account ledger — source documents and pending approvals.`}
        actions={refreshAction}
        controls={periodControls}
        stats={
          <>
            <ReportStat label="Total debit" value={money(tb.totalDebit)} />
            <ReportStat label="Total credit" value={money(tb.totalCredit)} />
            <ReportStat label="Accounts" value={String(tb.rows.length)} />
            <ReportStat
              label="Status"
              value={tb.balanced ? "Balanced" : "Out of balance"}
              accent={tb.balanced}
              danger={!tb.balanced}
              hint={
                tb.balanced
                  ? "Debits = Credits"
                  : `Difference ${money(Math.abs(tb.difference))}`
              }
            />
          </>
        }
        footer={
          tb.rows.length > 0 ? (
            <div className="flex justify-end gap-6 text-[12px] font-semibold text-slate-800">
              <span>Total Debit {money(tb.totalDebit)}</span>
              <span>Total Credit {money(tb.totalCredit)}</span>
            </div>
          ) : null
        }
      >
        <RowsTable rows={tb.rows} linkAccounts />
      </Section>
    );
  }

  if (kind === "balance-sheet") {
    if (!bs) return null;
    return (
      <Section
        title="Balance Sheet"
        description={
          divisionFilter
            ? `Filtered to class “${divisionFilter === "__unassigned__" ? "Unassigned" : divisionFilter}”. Assets, liabilities and equity at a point in time.`
            : "Assets, liabilities and equity at a point in time. Click money to see how each figure is made and any pending approvals."
        }
        actions={refreshAction}
        controls={periodControls}
        stats={
          <>
            <ReportStat
              label="Assets"
              value={money(bs.totalAssets)}
              href={trialBalanceHref()}
              hint={
                bsCompare
                  ? `Prior ${money(bsCompare.totals.assets.prior)} · Δ ${money(bsCompare.totals.assets.variance)}`
                  : undefined
              }
            />
            <ReportStat
              label="Liabilities + Equity"
              value={money(bs.financing)}
              href={trialBalanceHref()}
            />
            <ReportStat
              label="Net profit to date"
              value={money(bs.netProfit)}
              href={profitAndLossHref()}
              accent={bs.netProfit >= 0}
              danger={bs.netProfit < 0}
            />
            <ReportStat
              label="Status"
              value={bs.balanced ? "Balanced" : "Out of balance"}
              accent={bs.balanced}
              danger={!bs.balanced}
              hint={
                bs.balanced
                  ? "Assets = Liabilities + Equity"
                  : !bs.integrity.ok
                    ? bs.integrity.issues[0] || "Ledger integrity failed"
                    : `Equation difference ${money(Math.abs(bs.difference))}`
              }
            />
            {divisionFilter ? (
              <p className="col-span-full text-[11px] text-slate-500">
                Class filter changes the rows shown; balance status is checked on the full books.
              </p>
            ) : null}
          </>
        }
      >
        {bsCompare ? (
          <div className="space-y-6">
            <div>
              <h3 className="mb-2 text-[12px] font-semibold text-slate-700">Assets</h3>
              <ComparativeTable rows={bsCompare.assets} />
              <p className="mt-2 text-right text-[12px] font-semibold">
                Total assets{" "}
                <Link href={trialBalanceHref()} className="text-sky-700 hover:underline">
                  {money(bsCompare.totals.assets.current)}
                </Link>{" "}
                · Prior {money(bsCompare.totals.assets.prior)} · Δ{" "}
                {money(bsCompare.totals.assets.variance)}
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-[12px] font-semibold text-slate-700">Liabilities</h3>
              <ComparativeTable rows={bsCompare.liabilities} />
              <p className="mt-2 text-right text-[12px] font-semibold">
                Total liabilities{" "}
                <Link href={trialBalanceHref()} className="text-sky-700 hover:underline">
                  {money(bsCompare.totals.liabilities.current)}
                </Link>{" "}
                · Prior {money(bsCompare.totals.liabilities.prior)} · Δ{" "}
                {money(bsCompare.totals.liabilities.variance)}
              </p>
            </div>
            <div>
              <h3 className="mb-2 text-[12px] font-semibold text-slate-700">Equity</h3>
              <ComparativeTable
                rows={[
                  ...bsCompare.equity,
                  {
                    code: "",
                    name: "Earnings to date (Income − Expenses)",
                    current: bsCompare.totals.netProfit.current,
                    prior: bsCompare.totals.netProfit.prior,
                    variance: bsCompare.totals.netProfit.variance,
                    variancePercent: bsCompare.totals.netProfit.prior
                      ? Math.round(
                          (bsCompare.totals.netProfit.variance /
                            Math.abs(bsCompare.totals.netProfit.prior)) *
                            1000,
                        ) / 10
                      : null,
                  },
                ]}
              />
              <p className="mt-2 text-right text-[12px] font-semibold">
                Total equity{" "}
                <Link href={profitAndLossHref()} className="text-sky-700 hover:underline">
                  {money(bsCompare.totals.equity.current)}
                </Link>{" "}
                · Prior {money(bsCompare.totals.equity.prior)} · Δ{" "}
                {money(bsCompare.totals.equity.variance)}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
              <div className="space-y-3">
                <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                  Assets
                </p>
                <CategoryStatementCard
                  title="Assets"
                  total={bs.totalAssets}
                  totalHref={trialBalanceHref()}
                  asOf={asOf}
                  groups={groupAccountsByCategory("Asset", bs.assets, {
                    includeZeros: false,
                  })}
                  emptyMessage="No asset balances yet. Fixed assets appear here after Active register items with cost are posted to the ledger (Assets → Fixed Assets — Status Active, then re-save)."
                />
              </div>
              <div className="space-y-3">
                <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                  Liabilities &amp; Equity
                </p>
                <CategoryStatementCard
                  title="Liabilities"
                  total={bs.totalLiabilities}
                  totalHref={trialBalanceHref()}
                  asOf={asOf}
                  groups={groupAccountsByCategory("Liability", bs.liabilities, {
                    includeZeros: false,
                  })}
                  emptyMessage="No liability balances yet."
                />
                <CategoryStatementCard
                  title="Equity"
                  total={bs.totalEquity}
                  totalHref={profitAndLossHref()}
                  asOf={asOf}
                  groups={groupAccountsByCategory("Equity", bs.equity, {
                    includeZeros: false,
                  })}
                  extraLines={[
                    {
                      code: "",
                      name: "Retained earnings (earnings to date)",
                      balance: bs.netProfit,
                      href: profitAndLossHref(),
                    },
                  ]}
                />
              </div>
            </div>
            <div
              className={`flex flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                bs.balanced
                  ? "border-emerald-200 bg-emerald-50/70"
                  : "border-rose-200 bg-rose-50/70"
              }`}
            >
              <p
                className={`text-[12px] font-medium ${
                  bs.balanced ? "text-emerald-800" : "text-rose-800"
                }`}
              >
                {bs.balanced
                  ? "Balanced — Assets equal Liabilities + Equity"
                  : `Out of balance by ${money(Math.abs(bs.difference))}`}
              </p>
              <div className="flex flex-wrap items-center gap-4 text-[13px] font-semibold tabular-nums text-slate-900">
                <span>
                  Assets{" "}
                  <Link href={trialBalanceHref()} className="text-sky-700 hover:underline">
                    {money(bs.totalAssets)}
                  </Link>
                </span>
                <span className="text-slate-400">=</span>
                <span>
                  Liabilities + Equity{" "}
                  <Link href={trialBalanceHref()} className="text-sky-700 hover:underline">
                    {money(bs.financing)}
                  </Link>
                </span>
              </div>
            </div>
          </div>
        )}
      </Section>
    );
  }

  if (kind === "profit-and-loss") {
    if (!pl) return null;
    return (
      <Section
        title="Profit & Loss Statement"
        description={
          divisionFilter
            ? `Filtered to class “${divisionFilter === "__unassigned__" ? "Unassigned" : divisionFilter}”.`
            : "Income and expenses for the selected period. Click money to open the ledger breakdown and pending approvals."
        }
        actions={refreshAction}
        controls={periodControls}
        stats={
          <>
            <ReportStat
              label="Income"
              value={money(plCompare ? plCompare.totals.income.current : pl.totalIncome)}
              href={profitAndLossHref()}
            />
            <ReportStat
              label="Expenses"
              value={money(plCompare ? plCompare.totals.expenses.current : pl.totalExpenses)}
              href={profitAndLossHref()}
            />
            <ReportStat
              label="Net profit (loss)"
              value={money(plCompare ? plCompare.totals.netProfit.current : pl.netProfit)}
              href={profitAndLossHref()}
              accent={(plCompare ? plCompare.totals.netProfit.current : pl.netProfit) >= 0}
              danger={(plCompare ? plCompare.totals.netProfit.current : pl.netProfit) < 0}
            />
            <ReportStat
              label="Period"
              value={`${pl.from || "…"} → ${pl.to}`}
              hint={
                plCompare
                  ? `Compare ${plCompare.prior.from} → ${plCompare.prior.to}`
                  : pl.income.length === 0 && pl.expenses.length === 0
                    ? "Empty for this From–To. Bank openings hit the balance sheet only — P&L needs Active income/expense postings in range."
                    : undefined
              }
            />
          </>
        }
      >
        {pl.income.length === 0 && pl.expenses.length === 0 && !plCompare ? (
          <ReportEmpty
            title="No P&L activity in this period"
            message={`From ${pl.from || "…"} to ${pl.to} has no Income or Expense ledger lines. Widen From/To to cover your document dates (demo books are often in 2025), or post Active invoices/bills/receipts. Opening bank balances do not appear on Profit & Loss.`}
          />
        ) : plCompare ? (
          <>
            <ReportSubheading>Income</ReportSubheading>
            <ComparativeTable rows={plCompare.income} />
            <p className="mt-2 mb-4 text-right text-[12px] font-semibold">
              Total income{" "}
              <Link href={trialBalanceHref()} className="text-sky-700 hover:underline">
                {money(plCompare.totals.income.current)}
              </Link>{" "}
              · Prior {money(plCompare.totals.income.prior)} · Δ{" "}
              {money(plCompare.totals.income.variance)}
            </p>
            <ReportSubheading>Expenses</ReportSubheading>
            <ComparativeTable rows={plCompare.expenses} />
            <p className="mt-2 text-right text-[12px] font-semibold">
              Total expenses{" "}
              <Link href={trialBalanceHref()} className="text-sky-700 hover:underline">
                {money(plCompare.totals.expenses.current)}
              </Link>{" "}
              · Prior {money(plCompare.totals.expenses.prior)} · Δ{" "}
              {money(plCompare.totals.expenses.variance)}
            </p>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CategoryStatementCard
              title="Income"
              total={pl.totalIncome}
              totalHref={profitAndLossHref()}
              asOf={to}
              groups={groupApiStatementRows(pl.income)}
              emptyMessage="No income in this period."
            />
            <CategoryStatementCard
              title="Expenses"
              total={pl.totalExpenses}
              totalHref={profitAndLossHref()}
              asOf={to}
              groups={groupApiStatementRows(pl.expenses)}
              emptyMessage="No expenses in this period."
            />
            <div className="lg:col-span-2">
              <CategoryStatementCard
                title="Net profit (loss)"
                total={pl.netProfit}
                totalHref={profitAndLossHref()}
                groups={[]}
              />
            </div>
          </div>
        )}
      </Section>
    );
  }

  if (kind === "cash-flow") {
    if (!cashFlow) return null;
    const rows = [
      ["Operating activities", cashFlow.operating],
      ["Investing activities", cashFlow.investing],
      ["Financing activities", cashFlow.financing],
    ] as const;
    return (
      <Section
        title="Cash Flow Statement"
        description="Cash movements by operating, investing and financing activities"
        actions={refreshAction}
        controls={periodControls}
        stats={
          <>
            <ReportStat label="Operating" value={money(cashFlow.operating)} href={trialBalanceHref()} />
            <ReportStat label="Investing" value={money(cashFlow.investing)} href={trialBalanceHref()} />
            <ReportStat label="Financing" value={money(cashFlow.financing)} href={trialBalanceHref()} />
            <ReportStat
              label="Net change in cash"
              value={money(cashFlow.netChange)}
              href={trialBalanceHref()}
              accent={cashFlow.netChange >= 0}
              danger={cashFlow.netChange < 0}
            />
          </>
        }
      >
        {cashCompare ? (
          <>
            <div className="mb-3 text-[11px] text-slate-500">
              Compare {cashCompare.prior.from} → {cashCompare.prior.to} ({compareModeLabel(compareMode)})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="px-2 py-2">Section</th>
                    <th className="px-2 py-2 text-right">Current</th>
                    <th className="px-2 py-2 text-right">Prior</th>
                    <th className="px-2 py-2 text-right">Variance</th>
                    <th className="px-2 py-2 text-right">Δ %</th>
                  </tr>
                </thead>
                <tbody>
                  {cashCompare.sections.map((section) => (
                    <tr key={section.label} className="border-b border-slate-50">
                      <td className="px-2 py-3 font-medium text-slate-800">{section.label}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{money(section.current)}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-slate-500">
                        {money(section.prior)}
                      </td>
                      <td
                        className={`px-2 py-3 text-right tabular-nums ${
                          section.variance >= 0 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {section.variance >= 0 ? "+" : ""}
                        {money(section.variance)}
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums text-slate-500">
                        {section.variancePercent === null ? "—" : `${section.variancePercent}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              {rows.map(([label, amount]) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-3 text-[12px]"
                >
                  <span className="font-medium text-slate-700">{label}</span>
                  <span className="tabular-nums text-slate-900">{money(amount)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-900 px-3 py-3 text-[13px] font-semibold text-white">
              <span>Net change in cash</span>
              <span className="tabular-nums">{money(cashFlow.netChange)}</span>
            </div>
          </>
        )}
      </Section>
    );
  }

  if (kind === "statement-of-changes-in-equity") {
    if (!equityChanges) return null;
    return (
      <Section
        title="Statement of Changes in Equity"
        description="Movements in equity accounts over the period"
        actions={refreshAction}
        controls={periodControls}
      >
        <EquityChangesTable rows={equityChanges.rows} />
        <p className="mt-3 text-[12px] text-slate-500">
          Earnings not yet closed: {money(equityChanges.earningsNotYetClosed)}
        </p>
        <div className="mt-2 text-right text-[13px] font-semibold">
          Total equity {money(equityChanges.totalClosing)}
        </div>
      </Section>
    );
  }

  if (kind === "control-account-reconciliation") {
    if (!controls) return null;
    const allBalanced = controls.every((row) => row.balanced);
    return (
      <Section
        title="Control Account Reconciliation"
        description={`Control accounts versus subsidiary ledgers as of ${asOf}`}
        actions={refreshAction}
        controls={periodControls}
        stats={
          <>
            <ReportStat
              label="Controls checked"
              value={String(controls.length)}
            />
            <ReportStat
              label="Status"
              value={allBalanced ? "All balanced" : "Differences"}
              accent={allBalanced}
              danger={!allBalanced}
            />
            <ReportStat
              label="Total difference"
              value={money(controls.reduce((s, r) => s + Math.abs(r.difference), 0))}
              danger={!allBalanced}
            />
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-2 py-2">Control</th>
                <th className="px-2 py-2">GL account</th>
                <th className="px-2 py-2 text-right">Ledger balance</th>
                <th className="px-2 py-2 text-right">Subledger balance</th>
                <th className="px-2 py-2 text-right">Difference</th>
                <th className="px-2 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {controls.map((row) => (
                <tr key={row.control} className="border-b border-slate-50">
                  <td className="px-2 py-2.5 font-medium text-slate-800">{row.control}</td>
                  <td className="px-2 py-2.5 text-slate-500">
                    <MoneyLink href={accountLedgerHref(row.ledgerAccount)}>
                      {row.ledgerAccount}
                    </MoneyLink>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-medium">
                    <MoneyLink href={accountLedgerHref(row.ledgerAccount)}>
                      {money(row.ledgerBalance)}
                    </MoneyLink>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-medium">
                    {money(row.subledgerBalance)}
                  </td>
                  <td
                    className={`px-2 py-2.5 text-right tabular-nums font-medium ${
                      row.balanced ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    <MoneyLink href={accountLedgerHref(row.ledgerAccount)}>
                      {money(row.difference)}
                    </MoneyLink>
                  </td>
                  <td
                    className={`px-2 py-2.5 text-right font-medium ${
                      row.balanced ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {row.balanced ? "Balanced" : "Out"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    );
  }

  if (kind === "bank-reconciliation") {
    if (!currentUserCan("bank-recon")) {
      return (
        <Section
          title="Bank Reconciliation"
          description="Your role cannot run bank reconciliations. Ask an Administrator."
          actions={refreshAction}
          controls={periodControls}
        >
          <p className="text-[13px] text-slate-500">
            The bank-recon permission is required to view and post reconciliations.
          </p>
        </Section>
      );
    }
    if (!bankRec) return null;
    const bankMoney = (n: number) =>
      formatMoney(n, bankRec.currency ? { currencyCode: bankRec.currency } : undefined);
    return (
      <Section
        title="Bank Reconciliation"
        description={`${bankRec.account} → GL ${bankRec.glAccount}${
          bankRec.currency ? ` · ${bankRec.currency}` : ""
        } as of ${asOf}`}
        actions={refreshAction}
        controls={periodControls}
        stats={
          <>
            <ReportStat label="Book balance" value={bankMoney(bankRec.bookBalance)} />
            <ReportStat label="Statement balance" value={bankMoney(bankRec.statementBalance)} />
            <ReportStat label="Adjusted book" value={bankMoney(bankRec.adjustedBook)} />
            <ReportStat
              label={bankRec.balanced ? "Balanced" : "Discrepancy"}
              value={bankMoney(bankRec.discrepancy)}
              accent={bankRec.balanced}
              danger={!bankRec.balanced}
            />
          </>
        }
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Book balance (GL)", bankRec.bookBalance, accountLedgerHref(bankRec.glAccount || bankRec.account)],
            ["Uncleared receipts", bankRec.unclearedReceipts, null],
            ["Uncleared payments", bankRec.unclearedPayments, null],
            ["Uncleared transfers in", bankRec.unclearedTransfersIn, null],
            ["Uncleared transfers out", bankRec.unclearedTransfersOut, null],
            ["Adjusted book", bankRec.adjustedBook, accountLedgerHref(bankRec.glAccount || bankRec.account)],
            ["Statement balance", bankRec.statementBalance, null],
            ["Difference", bankRec.discrepancy, accountLedgerHref(bankRec.glAccount || bankRec.account)],
          ].map(([label, value, href]) => (
            <div key={String(label)} className="rounded-lg border border-slate-100 p-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
              <p className="mt-1 text-[14px] font-semibold tabular-nums">
                {href ? (
                  <MoneyLink href={String(href)}>{bankMoney(value as number)}</MoneyLink>
                ) : (
                  bankMoney(value as number)
                )}
              </p>
            </div>
          ))}
        </div>
        <p className={`mb-3 text-[12px] font-medium ${bankRec.balanced ? "text-emerald-600" : "text-rose-600"}`}>
          {bankRec.balanced
            ? `Balanced — statement ${bankMoney(bankRec.statementBalance)} matches system book ${bankMoney(bankRec.bookBalance)}.`
            : `Out of balance by ${bankMoney(bankRec.discrepancy)} (statement ${bankMoney(bankRec.statementBalance)} vs system book ${bankMoney(bankRec.bookBalance)}).`}
        </p>
        <BankPendingTable rows={bankRec.pending} />
      </Section>
    );
  }

  if (kind === "profit-and-loss-by-class") {
    if (!plByClass) return null;
    return (
      <Section
        title="Profit & Loss by Class"
        description="Income and expenses split across business classes (QuickBooks-style Class tracking)."
        actions={refreshAction}
        controls={periodControls}
        stats={
          <>
            <ReportStat label="Income" value={money(plByClass.totalIncome)} />
            <ReportStat label="Expenses" value={money(plByClass.totalExpenses)} />
            <ReportStat
              label="Net profit (loss)"
              value={money(plByClass.netProfit)}
              accent={plByClass.netProfit >= 0}
              danger={plByClass.netProfit < 0}
            />
            <ReportStat label="Classes" value={String(plByClass.columns.length || 0)} />
          </>
        }
      >
        {!plByClass.columns.length ? (
          <ReportEmpty title="No class activity" message="No class-tagged activity in this period. Assign Class / division on transactions." />
        ) : (
          <div className="space-y-6 overflow-x-auto">
            {(
              [
                ["Income", plByClass.income],
                ["Expenses", plByClass.expenses],
              ] as const
            ).map(([heading, rows]) => (
              <div key={heading}>
                <ReportSubheading>{heading}</ReportSubheading>
                <ReportTableWrap>
                  <table className={reportTableClass}>
                    <thead className={reportTheadClass}>
                      <tr>
                        <th className={reportThClass}>Account</th>
                        {plByClass.columns.map((col) => (
                          <th key={col} className={reportThRightClass}>
                            {col}
                          </th>
                        ))}
                        <th className={reportThRightClass}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.accountId} className={reportTrClass}>
                          <td className={reportTdClass}>
                            <MoneyLink href={accountLedgerHref(row.code || row.name)}>
                              <span className="font-mono text-[11px] text-slate-400">{row.code}</span>{" "}
                              {row.name}
                            </MoneyLink>
                          </td>
                          {plByClass.columns.map((col) => (
                            <td key={col} className={reportTdRightClass}>
                              <MoneyLink href={accountLedgerHref(row.code || row.name)}>
                                {money(row.byClass[col] || 0)}
                              </MoneyLink>
                            </td>
                          ))}
                          <td className={reportTdRightClass}>
                            <MoneyLink href={accountLedgerHref(row.code || row.name)}>
                              {money(row.total)}
                            </MoneyLink>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ReportTableWrap>
              </div>
            ))}
            <div>
              <ReportSubheading>Net by class</ReportSubheading>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {plByClass.columns.map((col) => {
                  const totals = plByClass.classTotals[col];
                  return (
                    <div key={col} className="rounded-lg border border-slate-100 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">{col}</p>
                      <p
                        className={`mt-1 text-[14px] font-semibold tabular-nums ${
                          (totals?.net || 0) >= 0 ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {money(totals?.net || 0)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Section>
    );
  }

  if (kind === "division-exception-report") {
    if (!divisionExceptions) return null;
    return (
      <Section
        title="Division Exception Report"
        description="Income and expense ledger lines missing a Class / division — assign a class on the source document."
        actions={refreshAction}
        controls={periodControls}
        stats={
          <ReportStat
            label="Missing class"
            value={String(divisionExceptions.length)}
            danger={divisionExceptions.length > 0}
            accent={divisionExceptions.length === 0}
          />
        }
      >
        {!divisionExceptions.length ? (
          <ReportEmpty title="All tagged" message="All P&L lines in this period have a class." />
        ) : (
          <ReportTableWrap>
            <table className={reportTableClass}>
              <thead className={reportTheadClass}>
                <tr>
                  <th className={reportThClass}>Date</th>
                  <th className={reportThClass}>Account</th>
                  <th className={reportThClass}>Narration</th>
                  <th className={reportThRightClass}>Debit</th>
                  <th className={reportThRightClass}>Credit</th>
                  <th className={reportThClass}>Source</th>
                </tr>
              </thead>
              <tbody>
                {divisionExceptions.map((row) => {
                  const origin = originLinkForLedgerLine({
                    sourceModule: row.sourceModule,
                    sourceEntity: row.sourceEntity,
                    sourceRecordId: row.sourceRecordId,
                    narration: row.narration,
                  });
                  return (
                    <tr key={row.id} className={reportTrClass}>
                      <td className={reportTdClass}>{row.date}</td>
                      <td className={reportTdClass}>{row.account}</td>
                      <td className={reportTdClass}>{row.narration || "—"}</td>
                      <td className={reportTdRightClass}>{money(row.debit)}</td>
                      <td className={reportTdRightClass}>{money(row.credit)}</td>
                      <td className={reportTdClass}>
                        {origin ? (
                          <Link href={origin.href} className="text-sky-700 hover:underline">
                            {origin.label}
                          </Link>
                        ) : (
                          row.sourceEntity
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ReportTableWrap>
        )}
      </Section>
    );
  }

  if (kind === "integrity-tests") {
    if (!integrity) return null;
    const failed = integrity.filter((t) => !t.ok).length;
    return (
      <Section
        title="Accounting Integrity Tests"
        description={`Automated checks for ledger consistency as of ${asOf}`}
        actions={refreshAction}
        controls={periodControls}
        stats={
          <>
            <ReportStat label="Checks" value={String(integrity.length)} />
            <ReportStat
              label="Passed"
              value={String(integrity.length - failed)}
              accent={failed === 0}
            />
            <ReportStat
              label="Failed"
              value={String(failed)}
              danger={failed > 0}
              accent={failed === 0}
            />
          </>
        }
      >
        <div className="space-y-2">
          {integrity.map((test) => (
            <div
              key={test.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 px-3 py-3 text-[12px]"
            >
              <div>
                <p className="font-medium text-slate-800">{test.name}</p>
                <p className="text-[11px] text-slate-500">{test.detail}</p>
              </div>
              <span className={test.ok ? "font-medium text-emerald-600" : "font-medium text-rose-600"}>
                {test.ok ? "Pass" : "Fail"}
              </span>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  if (kind === "cash-flow-indirect") {
    const cf = cashFlowIndirect(from, to);
    return (
      <Section
        title="Cash Flow (Indirect Method)"
        description="Net profit adjusted to operating cash flow"
        actions={refreshAction}
        controls={periodControls}
      >
        <div className="space-y-2 text-[12px]">
          {[
            ["Net profit", cf.netProfit],
            ["Add: Depreciation", cf.depreciation],
            ["Δ Accounts receivable", -cf.deltaAR],
            ["Δ Inventory", -cf.deltaInventory],
            ["Δ Accounts payable", cf.deltaAP],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between border-b border-slate-50 py-2">
              <span>{label}</span>
              <span className="tabular-nums font-medium">{money(value as number)}</span>
            </div>
          ))}
          <div className="flex justify-between rounded-lg bg-slate-900 px-3 py-3 font-semibold text-white">
            <span>Cash from operations</span>
            <span className="tabular-nums">{money(cf.operating)}</span>
          </div>
        </div>
      </Section>
    );
  }

  if (kind === "other-comprehensive-income") {
    const oci = otherComprehensiveIncome(from, to);
    return (
      <Section
        title="Other Comprehensive Income"
        description="Gains and losses outside profit or loss"
        actions={refreshAction}
        controls={periodControls}
      >
        <div className="space-y-2">
          {oci.rows.map((row) => (
            <div key={row.code} className="flex justify-between border-b border-slate-50 py-2 text-[12px]">
              <span>
                {row.code} · {row.name}
              </span>
              <span className="tabular-nums font-medium">{money(row.amount)}</span>
            </div>
          ))}
          {!oci.rows.length && <p className="text-[12px] text-slate-400">No OCI movements in period.</p>}
        </div>
        <div className="mt-3 text-right text-[13px] font-semibold">Total OCI {money(oci.totalOci)}</div>
      </Section>
    );
  }

  if (kind === "budget-vs-actual") {
    const bva = budgetVsActual(from, to);
    return (
      <Section
        title="Budget vs Actual"
        description="Budgeted amounts compared with actuals"
        actions={refreshAction}
        controls={periodControls}
      >
        <BudgetRowsTable rows={bva.rows} />
      </Section>
    );
  }

  if (kind === "forecast-p-l") {
    const fc = forecastProfitAndLoss(from, to);
    const series = forecastSeries(from, to, 6);
    const maxBar = Math.max(1, ...series.months.map((m) => m.income));
    return (
      <Section
        title="Forecast Profit & Loss"
        description="Projected income and expenses"
        actions={refreshAction}
        controls={periodControls}
      >
        <div className="mb-4 space-y-2 text-[12px]">
          <p className="text-slate-500">
            Growth assumptions: revenue +{fc.revenueGrowth}% · expenses +{fc.expenseGrowth}% (edit in
            Management Analysis)
          </p>
          <div className="flex justify-between border-b py-2">
            <span>Base net profit</span>
            <span className="tabular-nums">{money(fc.baseNetProfit)}</span>
          </div>
          <div className="flex justify-between border-b py-2">
            <span>Forecast income</span>
            <span className="tabular-nums">{money(fc.forecastIncome)}</span>
          </div>
          <div className="flex justify-between border-b py-2">
            <span>Forecast expenses</span>
            <span className="tabular-nums">{money(fc.forecastExpenses)}</span>
          </div>
          <div className="flex justify-between rounded-lg bg-slate-900 px-3 py-3 font-semibold text-white">
            <span>Forecast net profit</span>
            <span className="tabular-nums">{money(fc.forecastNetProfit)}</span>
          </div>
        </div>
        <div className="mb-3 flex h-24 items-end gap-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          {series.months.map((month) => (
            <div key={month.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div
                className={`w-full max-w-[24px] rounded-t ${
                  month.isProjected ? "bg-orange-400/80" : "bg-slate-700"
                }`}
                style={{ height: `${Math.max(4, Math.round((month.income / maxBar) * 100))}%` }}
              />
              <span className="truncate text-[9px] text-slate-400">{month.label.split(" ")[0]}</span>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-2 py-2">Month</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2 text-right">Income</th>
                <th className="px-2 py-2 text-right">Expenses</th>
                <th className="px-2 py-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {series.months.map((month) => (
                <tr
                  key={month.key}
                  className={`border-b border-slate-50 ${month.isProjected ? "bg-orange-50/40" : ""}`}
                >
                  <td className="px-2 py-2">{month.label}</td>
                  <td className="px-2 py-2 text-slate-500">
                    {month.isProjected ? "Forecast" : "Actual"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(month.income)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(month.expenses)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium">
                    {money(month.netProfit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    );
  }

  if (kind === "notes-to-financial-statements") {
    const notes = loadFinancialNotes();
    return (
      <Section
      title="Notes to the Financial Statements"
      description="Disclosure notes supporting the statements"
      actions={refreshAction}
    >
        <div className="space-y-4">
          {notes.map((note) => (
            <div key={note.id} className="rounded-lg border border-slate-100 px-3 py-3">
              <p className="text-[12px] font-semibold text-slate-800">
                Note {note.number} — {note.title}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[12px] text-slate-600">{note.body}</p>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  if (kind === "field-audit-log") {
    return <FieldAuditPanel />;
  }

  if (kind === "tax-summary") {
    if (!tax) return null;
    return (
      <Section
        title="Tax Summary"
        description="Output tax, input tax and net position"
        actions={refreshAction}
        controls={periodControls}
        stats={
          <>
            <ReportStat label="Output tax" value={money(tax.outputTax)} />
            <ReportStat label="Input tax" value={money(tax.inputTax)} />
            <ReportStat
              label={tax.netTaxPayable >= 0 ? "Net payable" : "Net recoverable"}
              value={money(Math.abs(tax.netTaxPayable))}
              accent={tax.netTaxPayable < 0}
              danger={tax.netTaxPayable > 0}
            />
            <ReportStat label="Period" value={`${from} → ${to}`} />
          </>
        }
      >
        <ReportEmpty
          title="Tax position summarised above"
          message="Output tax is collected on sales; input tax is reclaimable on purchases. The net figure is what you owe or can recover."
        />
      </Section>
    );
  }

  if (kind === "inventory-value-summary") {
    if (!inventory) return null;
    const roll = inventory;
    return (
      <Section
        title="Inventory Value Summary"
        description="Opening + stock in − write-offs − sold = closing inventory"
        actions={refreshAction}
        stats={
          <>
            <ReportStat label="Total inventory" value={String(roll.items.length)} />
            <ReportStat label="Opening value" value={money(roll.openingValue)} />
            <ReportStat
              label="Stock value"
              value={money(roll.stockValue)}
              accent
            />
            <ReportStat label="Closing inventory" value={money(roll.closingValue)} accent />
          </>
        }
      >
        <div className="mb-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-[12px] text-slate-600 sm:grid-cols-4">
          <div>
            <p className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">
              Units on hand
            </p>
            <p className="mt-0.5 font-semibold text-slate-800">{roll.closingQty} units</p>
          </div>
          <div>
            <p className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">
              Stock in
            </p>
            <p className="mt-0.5 font-semibold text-slate-800">
              {roll.stockInQty} · {money(roll.stockInValue)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">
              Write-offs
            </p>
            <p className="mt-0.5 font-semibold text-slate-800">
              {roll.writeOffQty} · {money(roll.writeOffValue)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium tracking-wide text-slate-400 uppercase">Sold</p>
            <p className="mt-0.5 font-semibold text-slate-800">
              {roll.soldQty} · {money(roll.soldValue)}
            </p>
          </div>
        </div>
        {!roll.items.length ? (
          <ReportEmpty
            title="No inventory items"
            message="Add inventory items and purchase stock to see on-hand values here."
          />
        ) : (
          <InventoryRowsTable inventory={roll.items} />
        )}
      </Section>
    );
  }

  // ledgers
  if (!accountLedger) return null;
  const lines = accountLedger.lines;
  const accountHint =
    accountLedger.account?.code ||
    accountLedger.account?.name ||
    accountQuery;
  const ledgerExport: TableExport | null = accountLedger.account
    ? buildAccountLedgerExport({
        account: accountLedger.account,
        lines,
        asOf,
        originLabel: (line) => {
          const origin = originLinkForLedgerLine(line);
          return origin ? `${origin.entityLabel}: ${origin.label}` : "";
        },
      })
    : null;
  return (
    <Section
        title="Account Ledger"
        description="How this report figure is made — click any amount or Origin to open the source document. Use PDF to download this ledger. Pending approvals stay off the books until approved."
        actions={refreshAction}
        controls={periodControls}
        exportSpec={ledgerExport}
      >
      {!accountLedger.account ? (
        <ReportEmpty
          title={`No account matched “${accountQuery}”`}
          message="Use a code or name from the Chart of Accounts."
        />
      ) : (
        <>
          <p className="mb-3 text-[12px] text-slate-600">
            <span className="font-mono text-slate-500">{accountLedger.account.code}</span>{" "}
            {accountLedger.account.name} · {accountLedger.account.type}
          </p>
          <AccountLedgerLinesTable lines={lines} />
          <PendingApprovalPanel accountHint={accountHint} />
        </>
      )}
    </Section>
  );
}
