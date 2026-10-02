"use client";

import { DualMoney } from "@/components/dual-money";
import { BankAccountSelect, defaultBankAccountName } from "@/components/bank-account-select";
import { FeedbackModals, useFeedbackModals } from "@/components/feedback-modals";
import { PaginationBar } from "@/components/pagination-bar";
import { PrintLetterhead } from "@/components/print-letterhead";
import {
  reportTdCheckClass,
  reportThCheckClass,
  useRowSelection,
} from "@/components/report-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePagination } from "@/hooks/use-pagination";
import { formatMoney } from "@/lib/ledger/money";
import { baseCurrencyCode } from "@/lib/ledger/fx";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { hrefForSourceDocument } from "@/lib/module-data";
import Link from "next/link";
import {
  autoAllocate,
  downloadStatementCsv,
  listParties,
  partyOpenDocuments,
  partyStatement,
  recordPartyPayment,
  type Allocation,
  type OpenDocument,
  type PartyRow,
  type PartySide,
  type PayablePartySource,
} from "@/lib/party-ledger";
import { statementHasContent } from "@/lib/ar-ap";
import { exportTableExcel } from "@/lib/export/table-export";
import {
  exportPartyPeriodLedgersPdf,
  exportStatementPdf,
  statementExportMeta,
  statementExportRows,
} from "@/lib/export/statement-payslip";
import { hydratePartyLedgerSources } from "@/lib/form-picker-hydrate";
import {
  builtInStatementPeriods,
  matchStatementPeriod,
  statementPeriodLabel,
  type StatementPeriodPreset,
} from "@/lib/statement-period";
import { Download, FileDown, RefreshCw, Search, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function PartyLedgerPanel({
  side,
  payableSource = "suppliers",
}: {
  side: PartySide;
  /** Payable ledgers only — contractors reuse supplier AP logic with a different master. */
  payableSource?: PayablePartySource;
}) {
  const isCustomer = side === "receivable";
  const isContractor = side === "payable" && payableSource === "contractors";
  const partyLabel = isCustomer ? "customer" : isContractor ? "contractor" : "supplier";
  const partyLabelPlural = isCustomer
    ? "customers"
    : isContractor
      ? "contractors"
      : "suppliers";
  const { feedback, close, showSuccess, showWarning } = useFeedbackModals();

  const [asOf, setAsOf] = useState(today);
  const [from, setFrom] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [tab, setTab] = useState<"open" | "statement">("open");
  const [tick, setTick] = useState(0);
  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<OpenDocument | null>(null);
  const [exporting, setExporting] = useState(false);
  const [calendarPeriods, setCalendarPeriods] = useState<StatementPeriodPreset[]>([]);

  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
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
      await hydratePartyLedgerSources(side);
      try {
        const { repairOrphanPartyAndBankLinks } = await import(
          "@/lib/accounting-party-bank"
        );
        const fixed = await repairOrphanPartyAndBankLinks({ force: true });
        if (!cancelled && (fixed.parties || fixed.banks)) {
          setTick((t) => t + 1);
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) setTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [side]);

  useEffect(() => {
    let cancelled = false;
    void import("@/lib/ledger/period-calendar").then(({ ensurePeriodsCoverDate, loadPeriods }) => {
      if (cancelled) return;
      ensurePeriodsCoverDate(asOf);
      const next = loadPeriods()
        .slice()
        .sort((a, b) => b.from.localeCompare(a.from))
        .slice(0, 18)
        .map((period) => ({
          id: `period:${period.id}`,
          label: period.name,
          from: period.from,
          to: period.to,
        }));
      setCalendarPeriods(next);
    });
    return () => {
      cancelled = true;
    };
  }, [asOf, tick]);

  const periodPresets = useMemo(() => {
    return [...builtInStatementPeriods(today()), ...calendarPeriods];
  }, [calendarPeriods]);

  const periodId = matchStatementPeriod(from, asOf, periodPresets);

  function applyPeriod(id: string) {
    if (id === "custom") return;
    const preset = periodPresets.find((item) => item.id === id);
    if (!preset) return;
    setFrom(preset.from);
    setAsOf(preset.to);
  }

  function setFromDate(value: string) {
    const next = value.slice(0, 10);
    setFrom(next);
    if (next && next > asOf) setAsOf(next);
  }

  function setToDate(value: string) {
    const next = value.slice(0, 10) || today();
    setAsOf(next);
    if (from && from > next) setFrom(next);
  }

  const parties = useMemo(() => {
    void tick;
    return listParties(
      side,
      asOf,
      side === "payable" ? { payableSource } : undefined,
    );
  }, [side, payableSource, asOf, tick]);

  const visibleParties = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q),
    );
  }, [parties, query]);

  // Fall back to the first party rather than syncing selection in an effect.
  const active =
    selected && parties.some((p) => p.name === selected) ? selected : (parties[0]?.name ?? "");

  const openDocs = useMemo(() => {
    void tick;
    return active ? partyOpenDocuments(side, active, asOf) : [];
  }, [side, active, asOf, tick]);

  const statement = useMemo(() => {
    void tick;
    return active ? partyStatement(side, active, asOf, from || undefined) : null;
  }, [side, active, asOf, from, tick]);

  const canExportStatement = statementHasContent(statement);
  const periodCaption = statementPeriodLabel(from || undefined, asOf);

  const current = parties.find((p) => p.name === active) ?? null;
  const totals = useMemo(() => {
    const balance = roundMoney(parties.reduce((s, p) => s + p.balance, 0));
    const overdue = roundMoney(parties.reduce((s, p) => s + p.overdue, 0));
    return { balance, overdue };
  }, [parties]);

  function openPayment(doc: OpenDocument | null) {
    if (!active) return;
    setPayTarget(doc);
    setPayOpen(true);
  }

  async function downloadSelectedPdf() {
    if (!statement || !canExportStatement) return;
    setExporting(true);
    try {
      await exportStatementPdf(statement);
    } finally {
      setExporting(false);
    }
  }

  async function downloadAllPdfs() {
    setExporting(true);
    try {
      const statements = parties
        .map((party) => partyStatement(side, party.name, asOf, from || undefined))
        .filter((row): row is NonNullable<typeof row> => statementHasContent(row));
      if (!statements.length) {
        showWarning(
          "No ledger activity",
          `Nothing to export for this period across ${partyLabelPlural}.`,
        );
        return;
      }
      await exportPartyPeriodLedgersPdf({
        title: isCustomer
          ? "Customer ledger"
          : isContractor
            ? "Contractor ledger"
            : "Supplier ledger",
        filename: `${partyLabelPlural}-ledgers-${from || "asof"}-${asOf}`,
        periodLabel: periodCaption,
        statements,
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <FeedbackModals feedback={feedback} onClose={close} />

      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-[14px] font-semibold text-slate-800">
                {isCustomer
                  ? "Customer ledgers & statements"
                  : isContractor
                    ? "Contractor ledgers & statements"
                    : "Supplier ledgers & statements"}
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {isCustomer
                  ? "Track what each customer owes, receive payments on due invoices, and issue statements."
                  : isContractor
                    ? "Track what you owe each contractor, pay due invoices, and reconcile statements."
                    : "Track what you owe each supplier, pay due bills, and reconcile statements."}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label className="mb-1 text-[11px] text-slate-500">Period</Label>
                <select
                  value={periodId}
                  onChange={(e) => applyPeriod(e.target.value)}
                  className="h-8 w-[170px] rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-800"
                  aria-label="Statement period"
                >
                  {periodPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                  {periodId === "custom" && <option value="custom">Custom</option>}
                </select>
              </div>
              <div>
                <Label className="mb-1 text-[11px] text-slate-500">From</Label>
                <Input
                  type="date"
                  value={from}
                  max={asOf}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-8 w-[150px]"
                />
              </div>
              <div>
                <Label className="mb-1 text-[11px] text-slate-500">To</Label>
                <Input
                  type="date"
                  value={asOf}
                  min={from || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-8 w-[150px]"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => setTick((t) => t + 1)}
              >
                <RefreshCw size={13} /> Refresh
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={!canExportStatement || exporting}
                onClick={() => void downloadSelectedPdf()}
              >
                <FileDown size={13} /> Download PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                disabled={!parties.length || exporting}
                onClick={() => void downloadAllPdfs()}
              >
                <FileDown size={13} /> PDF all
              </Button>
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Kpi
                label={
                  isCustomer
                    ? "Total receivable"
                    : "Total payable"
                }
                value={formatMoney(totals.balance)}
              />
              <Kpi label="Overdue" value={formatMoney(totals.overdue)} tone="danger" />
              <Kpi
                label={
                  isCustomer
                    ? "Customers with balance"
                    : isContractor
                      ? "Contractors with balance"
                      : "Suppliers with balance"
                }
                value={String(parties.filter((p) => p.balance > 0).length)}
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Statements cover {periodCaption}. Open bills and aging are as of {asOf}.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-3">
              <div className="relative">
                <Search
                  size={13}
                  className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    isCustomer
                      ? "Search customers…"
                      : isContractor
                        ? "Search contractors…"
                        : "Search suppliers…"
                  }
                  className="h-8 pl-8 text-[12px]"
                />
              </div>
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              {visibleParties.length === 0 ? (
                <p className="px-4 py-10 text-center text-[12px] text-slate-400">
                  No {partyLabelPlural} yet.
                </p>
              ) : (
                visibleParties.map((party) => (
                  <PartyRowButton
                    key={party.key}
                    party={party}
                    active={party.name === active}
                    onSelect={() => setSelected(party.name)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm" data-print-area>
            {!current ? (
              <p className="px-4 py-16 text-center text-[12px] text-slate-400">
                Select a {partyLabel} to view their ledger.
              </p>
            ) : (
              <>
                <div className="px-4 pt-4">
                  <PrintLetterhead />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                  <div>
                    <h3 className="text-[14px] font-semibold text-slate-900">{current.name}</h3>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Period {periodCaption}
                      {" · "}
                      Balance{" "}
                      <span className="font-semibold tabular-nums text-slate-800">
                        {formatMoney(current.balance)}
                      </span>
                      {current.overdue > 0 && (
                        <>
                          {" · "}
                          <span className="font-semibold tabular-nums text-rose-600">
                            {formatMoney(current.overdue)} overdue
                          </span>
                        </>
                      )}
                      {" · "}
                      {current.openCount} open{" "}
                      {isCustomer ? "invoice" : "bill"}
                      {current.openCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2" data-print-hide>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                      disabled={!openDocs.length}
                      onClick={() => openPayment(null)}
                    >
                      <Wallet size={13} />
                      {isCustomer ? "Receive payment" : "Make payment"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={!canExportStatement}
                      onClick={() => statement && downloadStatementCsv(statement)}
                    >
                      <Download size={13} /> CSV
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={!canExportStatement}
                      onClick={() =>
                        statement &&
                        void exportTableExcel({
                          title: `Statement — ${statement.party}`,
                          filename: `statement-${statement.party}-${from || "asof"}-${statement.asOf}`,
                          meta: statementExportMeta(statement),
                          columns: [
                            "Date",
                            "Reference",
                            "Description",
                            "Debit",
                            "Credit",
                            "Balance",
                          ],
                          rows: statementExportRows(statement),
                        })
                      }
                    >
                      <Download size={13} /> Excel
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={!canExportStatement || exporting}
                      onClick={() => void downloadSelectedPdf()}
                    >
                      <FileDown size={13} /> PDF
                    </Button>
                  </div>
                </div>

                <div className="flex gap-1 border-b border-slate-100 px-3 pt-2" data-print-hide>
                  {(
                    [
                      ["open", isCustomer ? "Open invoices" : "Open bills"],
                      ["statement", "Statement"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={`rounded-t-md px-3 py-1.5 text-[12px] transition ${
                        tab === id
                          ? "bg-slate-100 font-medium text-slate-900"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {tab === "open" ? (
                  <OpenDocsTable
                    docs={openDocs}
                    isCustomer={isCustomer}
                    onPay={(doc) => openPayment(doc)}
                  />
                ) : (
                  <StatementTable statement={statement} />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {payOpen && (
        <InvoicePaymentDialog
          side={side}
          party={active}
          docs={openDocs}
          focus={payTarget}
          onClose={() => {
            setPayOpen(false);
            setPayTarget(null);
          }}
          onDone={(message) => {
            setPayOpen(false);
            setPayTarget(null);
            setTick((t) => t + 1);
            showSuccess(isCustomer ? "Payment received" : "Payment made", message);
          }}
          onError={(message) => showWarning("Could not record payment", message)}
        />
      )}
    </>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`text-[15px] font-semibold tabular-nums ${
          tone === "danger" ? "text-rose-600" : "text-slate-800"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PartyRowButton({
  party,
  active,
  onSelect,
}: {
  party: PartyRow;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-2 border-b border-slate-50 px-3 py-2.5 text-left transition last:border-0 ${
        active ? "bg-orange-50/70" : "hover:bg-slate-50"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-slate-800">
          {party.name}
        </span>
        <span className="block truncate text-[11px] text-slate-400">
          {party.openCount > 0
            ? `${party.openCount} open · due ${party.oldestDueDate || "—"}`
            : party.onFile
              ? "No open documents"
              : "Not in master list"}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[12px] font-semibold tabular-nums text-slate-800">
          {formatMoney(party.balance)}
        </span>
        {party.overdue > 0 && (
          <span className="block text-[10px] font-medium text-rose-600">
            {formatMoney(party.overdue)} late
          </span>
        )}
      </span>
    </button>
  );
}

function OpenDocsTable({
  docs,
  isCustomer,
  onPay,
}: {
  docs: OpenDocument[];
  isCustomer: boolean;
  onPay: (doc: OpenDocument) => void;
}) {
  const {
    page,
    setPage,
    pages,
    pageItems,
    pageSize,
    setPageSize,
    total,
    from,
    to,
  } = usePagination(docs);
  const ids = useMemo(() => docs.map((doc) => doc.id), [docs]);
  const selection = useRowSelection(ids);

  if (!docs.length) {
    return (
      <p className="px-4 py-14 text-center text-[12px] text-slate-400">
        Nothing outstanding — every {isCustomer ? "invoice" : "bill"} is settled.
      </p>
    );
  }
  return (
    <div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-[12px]">
        <thead>
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            <th className={reportThCheckClass}>
              <Checkbox
                checked={selection.allSelected}
                onCheckedChange={selection.toggleAll}
                aria-label="Select all documents"
              />
            </th>
            <th className="px-3 py-2 font-medium">Reference</th>
            <th className="px-3 py-2 font-medium">Issued</th>
            <th className="px-3 py-2 font-medium">Due</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 text-right font-medium">Paid</th>
            <th className="px-3 py-2 text-right font-medium">Balance</th>
            <th className="px-3 py-2 text-right font-medium" data-print-hide>
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {pageItems.map((doc) => {
            const isSelected = selection.isSelected(doc.id);
            return (
              <tr
                key={doc.id}
                data-selected={isSelected || undefined}
                className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 data-[selected=true]:bg-slate-50/80"
              >
                <td className={reportTdCheckClass}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => selection.toggle(doc.id)}
                    aria-label={`Select ${doc.reference}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={hrefForSourceDocument(
                      isCustomer ? "sales" : "purchases",
                      isCustomer ? "sales-invoices" : "purchase-invoices",
                      doc.reference || doc.id,
                    )}
                    className="font-mono text-sky-700 hover:underline"
                    title="Open source document"
                  >
                    {doc.reference}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-500">{doc.date || "—"}</td>
                <td className="px-3 py-2">
                  <span className={doc.daysPastDue > 0 ? "font-medium text-rose-600" : "text-slate-500"}>
                    {doc.dueDate || "—"}
                    {doc.daysPastDue > 0 ? ` (${doc.daysPastDue}d late)` : ""}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <DualMoney
                    amount={
                      doc.documentCurrency !== baseCurrencyCode()
                        ? doc.documentTotal
                        : doc.total
                    }
                    currency={doc.documentCurrency}
                    amountIsBase={doc.documentCurrency === baseCurrencyCode()}
                    compact
                    align="right"
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  {formatMoney(doc.paid)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {formatMoney(doc.balance)}
                </td>
                <td className="px-3 py-2 text-right" data-print-hide>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => onPay(doc)}
                  >
                    {isCustomer ? "Receive" : "Pay"}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <PaginationBar
      page={page}
      pages={pages}
      total={total}
      from={from}
      to={to}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
    />
    </div>
  );
}

function StatementTable({
  statement,
}: {
  statement: ReturnType<typeof partyStatement>;
}) {
  const lines = statement?.lines ?? [];
  const showOpening =
    Boolean(statement?.from) && (lines.length > 0 || (statement?.opening ?? 0) !== 0);
  const ids = useMemo(
    () => lines.map((line, index) => `${line.date}-${line.reference}-${index}`),
    [lines],
  );
  const selection = useRowSelection(ids);

  if (!statement || (!lines.length && !showOpening)) {
    return (
      <p className="px-4 py-14 text-center text-[12px] text-slate-400">
        {statement?.from
          ? "No movements in this period."
          : "No movements yet for this party."}
      </p>
    );
  }
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
              <th className={reportThCheckClass}>
                <Checkbox
                  checked={selection.allSelected}
                  onCheckedChange={selection.toggleAll}
                  aria-label="Select all statement lines"
                />
              </th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Debit</th>
              <th className="px-3 py-2 text-right font-medium">Credit</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {showOpening && (
              <tr className="border-b border-slate-50 bg-slate-50/70">
                <td className={reportTdCheckClass} />
                <td className="px-3 py-2 text-slate-500">{statement.from}</td>
                <td className="px-3 py-2 text-slate-400">—</td>
                <td className="px-3 py-2 font-medium text-slate-700">Opening balance</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-400">—</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-400">—</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {formatMoney(statement.opening)}
                </td>
              </tr>
            )}
            {lines.map((line, index) => {
              const id = `${line.date}-${line.reference}-${index}`;
              const isSelected = selection.isSelected(id);
              return (
                <tr
                  key={id}
                  data-selected={isSelected || undefined}
                  className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 data-[selected=true]:bg-slate-50/80"
                >
                  <td className={reportTdCheckClass}>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => selection.toggle(id)}
                      aria-label={`Select statement line ${index + 1}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-500">{line.date || "—"}</td>
                  <td className="px-3 py-2 font-mono text-slate-500">{line.reference || "—"}</td>
                  <td className="px-3 py-2 text-slate-800">{line.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {line.debit ? formatMoney(line.debit) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {line.credit ? formatMoney(line.credit) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatMoney(line.balance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2.5">
        <span className="text-[12px] text-slate-500">
          Closing balance {statement.from ? `${statement.from} – ${statement.asOf}` : `as of ${statement.asOf}`}
        </span>
        <span className="text-[13px] font-semibold tabular-nums text-slate-900">
          {formatMoney(statement.closing)}
        </span>
      </div>
    </>
  );
}

/** Shared receive/pay dialog — used by Customer Ledgers and invoice list actions. */
export function InvoicePaymentDialog({
  side,
  party,
  docs,
  focus,
  onClose,
  onDone,
  onError,
}: {
  side: PartySide;
  party: string;
  docs: OpenDocument[];
  focus: OpenDocument | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const isCustomer = side === "receivable";

  const scoped = useMemo(() => (focus ? docs.filter((d) => d.id === focus.id) : docs), [docs, focus]);
  const maxAmount = useMemo(
    () => roundMoney(scoped.reduce((s, d) => s + d.balance, 0)),
    [scoped],
  );

  const [date, setDate] = useState(today);
  const [bank, setBank] = useState(() => defaultBankAccountName());
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(() =>
    String(roundMoney((focus ? [focus] : docs).reduce((s, d) => s + d.balance, 0)) || ""),
  );

  const allocations: Allocation[] = useMemo(
    () => autoAllocate(scoped, parseAmount(amount)),
    [scoped, amount],
  );
  const allocated = roundMoney(allocations.reduce((s, a) => s + a.amount, 0));
  const unapplied = roundMoney(Math.max(0, parseAmount(amount) - allocated));

  async function submit() {
    const result = await recordPartyPayment({
      side,
      party,
      date,
      bankAccount: bank,
      reference,
      allocations,
    });
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onDone(
      `${formatMoney(result.total)} ${isCustomer ? "received from" : "paid to"} ${party} across ${
        allocations.length
      } document${allocations.length === 1 ? "" : "s"}.`,
    );
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isCustomer ? "Receive payment" : "Make payment"}</DialogTitle>
          <DialogDescription>
            {focus
              ? `Allocated to ${focus.reference} for ${party}.`
              : `Allocated oldest-first across open ${isCustomer ? "invoices" : "bills"} for ${party}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">
              {isCustomer ? "Received in" : "Paid from"}
            </Label>
            <BankAccountSelect
              value={bank}
              onChange={setBank}
              emptyLabel="Search bank account…"
            />
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Amount</Label>
            <Input
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={String(maxAmount)}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Outstanding {formatMoney(maxAmount)}
            </p>
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] text-slate-700">Reference</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Auto-generated if blank"
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
          <p className="mb-1.5 text-[11px] font-medium text-slate-600">Allocation</p>
          {allocations.length === 0 ? (
            <p className="text-[11px] text-slate-400">Enter an amount to allocate.</p>
          ) : (
            <ul className="space-y-1">
              {allocations.map((allocation) => (
                <li
                  key={allocation.documentId}
                  className="flex items-center justify-between text-[11px] text-slate-600"
                >
                  <span className="font-mono">{allocation.reference}</span>
                  <span className="tabular-nums">{formatMoney(allocation.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {unapplied > 0 && (
            <p className="mt-1.5 text-[11px] text-amber-700">
              {formatMoney(unapplied)} exceeds the outstanding balance and will not be applied.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={!allocations.length || !bank}
            onClick={submit}
          >
            {isCustomer ? "Receive" : "Pay"} {formatMoney(allocated)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
