"use client";

import { Button } from "@/components/ui/button";
import { BankAccountSelect, defaultBankAccountName } from "@/components/bank-account-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadPeriods, setPeriodStatus, type PeriodStatus } from "@/lib/ledger/period-calendar";
import { importBankStatement, autoMatchStatement, loadBankStatements } from "@/lib/ledger/bank-statements";
import { awaitLedgerPostingDurable } from "@/lib/ledger/posting";
import { postBadDebtProvision, postInventoryNrvImpairment } from "@/lib/ledger/provisions";
import { revalueForeignBalance } from "@/lib/ledger/fx";
import { disposeFixedAsset, runMonthlyDepreciation } from "@/lib/ledger/fixed-assets";
import { closeFiscalYear } from "@/lib/ledger/year-end-close";
import { raiseProvision } from "@/lib/ledger/ias37-provisions";
import { postDeferredTax, currentTaxProvision } from "@/lib/ledger/ias12-deferred-tax";
import { runMonthlyLeaseAccounting } from "@/lib/ledger/ifrs16-leases";
import { markInvestmentToMarket } from "@/lib/ledger/ifrs9-fair-value";
import { runLeaveAccruals, postStatutoryRemittance } from "@/lib/ledger/ias19-benefits";
import { postLandedCost, postStocktakeVariance } from "@/lib/ledger/inventory-advanced";
import { postIntercompanyElimination, applyHyperinflationFactor, capitalizeBorrowingCost } from "@/lib/ledger/consolidation";
import { postShareBasedPayment, postWithholdingTax } from "@/lib/ledger/tax-and-equity-extras";
import { loadManagerSettings } from "@/lib/manager-settings";
import { loadRecords } from "@/lib/records-store";
import { useEffect, useState } from "react";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-slate-500">{label}</Label>
      {children}
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-[13px] font-semibold text-slate-800">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function AccountingOperationsDesk() {
  const [message, setMessage] = useState("");
  const [periods, setPeriods] = useState(loadPeriods());
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("0");
  const [account, setAccount] = useState(defaultBankAccountName);
  const [csv, setCsv] = useState("date,description,amount\n2026-07-01,Deposit,100000\n2026-07-02,Payment,-25000");
  const [statementFileName, setStatementFileName] = useState("");
  const [itemId, setItemId] = useState("");
  const [investmentId, setInvestmentId] = useState("");
  const [assetId, setAssetId] = useState("");

  useEffect(() => {
    const items = loadRecords("inventory", "inventory-items");
    if (items[0]) setItemId(items[0].id);
    const inv = loadRecords("investments", "investments");
    if (inv[0]) setInvestmentId(inv[0].id);
    const assets = loadRecords("assets", "fixed-assets");
    if (assets[0]) setAssetId(assets[0].id);
  }, []);

  const notify = (text: string) => setMessage(text);

  /**
   * Report a posting only after it is durable.
   *
   * These helpers return `{ ok: true }` as soon as the entry validates and
   * balances — the journal write to Postgres is still in flight at that point.
   * Announcing success straight away told the user an entry had posted when it
   * might never have reached the database.
   */
  const notifyPosted = async <T extends { ok: true }>(
    result: T | { ok: false; error: string },
    successText: (posted: T) => string,
  ) => {
    if (!result.ok) {
      notify(result.error || "Posting failed.");
      return;
    }
    const durable = await awaitLedgerPostingDurable();
    notify(
      durable.ok
        ? successText(result)
        : durable.error || "Entry balanced but did not reach the database — retry.",
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="text-[15px] font-semibold text-slate-900">Accounting operations desk</h2>
        <p className="text-[12px] text-slate-500">
          Run period closes, IFRS adjustments, bank import, provisions, tax, leases, and inventory
          controls from one place.
        </p>
        {message && (
          <p className="mt-2 rounded-lg bg-white px-3 py-2 text-[12px] text-slate-700">{message}</p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Period calendar">
          <div className="max-h-56 space-y-1 overflow-y-auto text-[12px]">
            {periods.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 border-b border-slate-50 py-1">
                <span>
                  {p.name} · <span className="text-slate-500">{p.status}</span>
                </span>
                <div className="flex gap-1">
                  {(["open", "soft-closed", "hard-closed"] as PeriodStatus[]).map((status) => (
                    <Button
                      key={status}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => {
                        setPeriodStatus(p.id, status);
                        setPeriods(loadPeriods());
                        notify(`${p.name} → ${status}`);
                      }}
                    >
                      {status}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button
            type="button"
            className="bg-black hover:bg-zinc-800"
            onClick={() => {
              const result = closeFiscalYear(asOf);
              void notifyPosted(result, (result) => `Year closed · net ${result.netProfit}`);
            }}
          >
            Year-end close (as of date)
          </Button>
        </Card>

        <Card title="Bank statement import & match">
          <Field label="Bank account">
            <BankAccountSelect value={account} onChange={setAccount} />
          </Field>
          <Field label="Closing balance">
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Statement file (CSV, TSV, QIF, or OFX)">
            <Input
              type="file"
              accept=".csv,.tsv,.txt,.qif,.ofx,text/csv,text/tab-separated-values"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void file.text().then((text) => {
                  setCsv(text);
                  setStatementFileName(file.name);
                  notify(`Loaded ${file.name}. Review it, then import.`);
                });
              }}
            />
          </Field>
          <Field label="Statement data preview">
            <textarea
              className="min-h-24 w-full rounded-md border border-slate-200 px-2 py-1.5 text-[12px]"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={async () => {
                try {
                  const result = await importBankStatement({
                    account,
                    asOf,
                    closingBalance: Number(amount) || 0,
                    csv,
                    fileName: statementFileName,
                  });
                  const { statement: st, receiptsCreated, paymentsCreated } = result;
                  notify(
                    st.lines.length
                      ? `Imported ${st.lines.length} lines → ${receiptsCreated} receipts, ${paymentsCreated} payments on ${account}`
                      : "No statement transactions were found.",
                  );
                } catch (err) {
                  notify(
                    err instanceof Error ? err.message : "Could not import bank statement.",
                  );
                }
              }}
            >
              Import statement
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const latest = loadBankStatements()[0];
                if (!latest) return notify("Import a statement first.");
                const { matched } = await autoMatchStatement(latest.id);
                notify(`Auto-matched ${matched} lines`);
              }}
            >
              Auto-match
            </Button>
          </div>
        </Card>

        <Card title="Provisions · bad debt · NRV (IAS 37 / conservatism)">
          <Field label="As of / amount">
            <div className="flex gap-2">
              <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = postBadDebtProvision({
                  amount: Number(amount) || 0,
                  date: asOf,
                  sourceRecordId: `bad-debt-${asOf}`,
                });
                void notifyPosted(r, (r) => "Bad debt provision posted");
              }}
            >
              Bad debt
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = raiseProvision({
                  name: "Warranty",
                  amount: Number(amount) || 0,
                  date: asOf,
                  sourceRecordId: `prov-${asOf}`,
                  kind: "warranty",
                });
                void notifyPosted(r, (r) => "IAS 37 provision raised");
              }}
            >
              IAS 37 provision
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!itemId) return notify("No inventory item");
                const r = postInventoryNrvImpairment({
                  itemId,
                  nrvPerUnit: Number(amount) || 0,
                  date: asOf,
                  sourceRecordId: `nrv-${itemId}-${asOf}`,
                });
                void notifyPosted(r, (r) => `NRV write-down ${r.writeDown}`);
              }}
            >
              Inventory NRV
            </Button>
          </div>
        </Card>

        <Card title="Tax · deferred tax · WHT (IAS 12)">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const rate = loadManagerSettings().corporateTaxRate || 30;
                const r = currentTaxProvision({
                  date: asOf,
                  taxableProfit: Number(amount) || 0,
                  taxRatePercent: rate,
                });
                void notifyPosted(r, (r) => `Current tax ${r.tax}`);
              }}
            >
              Current tax
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const rate = loadManagerSettings().corporateTaxRate || 30;
                const r = postDeferredTax({
                  date: asOf,
                  temporaryDifference: Number(amount) || 0,
                  taxRatePercent: rate,
                });
                void notifyPosted(r, (r) => `Deferred tax ${r.deferredTax}`);
              }}
            >
              Deferred tax
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = postWithholdingTax({
                  date: asOf,
                  grossAmount: Number(amount) || 0,
                  ratePercent: 6,
                  sourceRecordId: `wht-${asOf}`,
                });
                void notifyPosted(r, (r) => `WHT ${r.wht}`);
              }}
            >
              WHT 6%
            </Button>
          </div>
        </Card>

        <Card title="FX revaluation · fair value · leases · assets">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = revalueForeignBalance({
                  accountName: account,
                  foreignAmount: Number(amount) || 0,
                  currencyCode: "USD",
                  asOf,
                  sourceRecordId: `fx-${account}-${asOf}`,
                });
                void notifyPosted(r, (r) => `FX G/L ${r.gainLoss}`);
              }}
            >
              FX revalue
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!investmentId) return notify("No investment");
                const r = markInvestmentToMarket({
                  investmentId,
                  fairValue: Number(amount) || 0,
                  date: asOf,
                  through: "pnl",
                });
                void notifyPosted(r, (r) => `FV G/L ${r.gainLoss}`);
              }}
            >
              IFRS 9 FVTPL
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const month = asOf.slice(0, 7);
                const r = runMonthlyLeaseAccounting(month);
                notify(`Leases processed: ${r.count}`);
              }}
            >
              IFRS 16 month
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = runMonthlyDepreciation(asOf.slice(0, 7));
                void notifyPosted(r, (r) => `Depreciation ${r.count} / ${r.total}`);
              }}
            >
              Depreciation
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!assetId) return notify("No fixed asset");
                const r = disposeFixedAsset({
                  assetId,
                  proceeds: Number(amount) || 0,
                  date: asOf,
                });
                void notifyPosted(r, (r) => `Disposed · G/L ${r.gainLoss}`);
              }}
            >
              Dispose asset
            </Button>
          </div>
        </Card>

        <Card title="Payroll remittances · leave · share-based">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = postStatutoryRemittance({
                  kind: "PAYE",
                  amount: Number(amount) || 0,
                  date: asOf,
                });
                void notifyPosted(r, (r) => "PAYE remitted");
              }}
            >
              Remit PAYE
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = postStatutoryRemittance({
                  kind: "NSSF",
                  amount: Number(amount) || 0,
                  date: asOf,
                });
                void notifyPosted(r, (r) => "NSSF remitted");
              }}
            >
              Remit NSSF
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = runLeaveAccruals(asOf);
                notify(`Leave accruals ${r.count} · ${r.total}`);
              }}
            >
              Leave accruals
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = postShareBasedPayment({
                  date: asOf,
                  amount: Number(amount) || 0,
                  sourceRecordId: `sbp-${asOf}`,
                });
                void notifyPosted(r, (r) => "IFRS 2 posted");
              }}
            >
              IFRS 2 SBP
            </Button>
          </div>
        </Card>

        <Card title="Inventory · landed cost · stocktake">
          <Field label="Item id">
            <Input value={itemId} onChange={(e) => setItemId(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = postLandedCost({
                  itemId,
                  amount: Number(amount) || 0,
                  date: asOf,
                });
                void notifyPosted(r, (r) => "Landed cost posted");
              }}
            >
              Landed cost
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = postStocktakeVariance({
                  itemId,
                  countedQty: Number(amount) || 0,
                  date: asOf,
                });
                notify(
                  r.ok
                    ? `Stocktake Δ qty ${r.varianceQty} · value ${r.varianceValue}`
                    : r.error,
                );
              }}
            >
              Stocktake (qty=amount)
            </Button>
          </div>
        </Card>

        <Card title="Consolidation · borrowing costs · hyperinflation">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = postIntercompanyElimination({
                  date: asOf,
                  amount: Number(amount) || 0,
                });
                void notifyPosted(r, (r) => "Intercompany eliminated");
              }}
            >
              IC elimination
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = capitalizeBorrowingCost({
                  assetAccount: "Fixed assets, at cost",
                  amount: Number(amount) || 0,
                  date: asOf,
                  sourceRecordId: `ias23-${asOf}`,
                });
                void notifyPosted(r, (r) => "IAS 23 capitalized");
              }}
            >
              IAS 23 borrow
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const r = applyHyperinflationFactor({
                  date: asOf,
                  factor: Number(amount) || 1.1,
                  sourceRecordId: `ias29-${asOf}`,
                });
                void notifyPosted(r, (r) => `IAS 29 adj ${r.adjustment}`);
              }}
            >
              IAS 29 (factor=amount)
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
