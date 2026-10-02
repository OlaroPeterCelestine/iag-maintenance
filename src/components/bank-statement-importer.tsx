"use client";

import { FeedbackModals, useFeedbackModals } from "@/components/feedback-modals";
import { BankAccountSelect, defaultBankAccountName } from "@/components/bank-account-select";
import { PaginationBar } from "@/components/pagination-bar";
import { ResponsiveModal } from "@/components/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePagination } from "@/hooks/use-pagination";
import {
  autoMatchStatement,
  clearAllBankStatements,
  deleteBankStatement,
  downloadBankStatementTemplate,
  importBankStatement,
  loadBankStatements,
  saveBankStatements,
  type BankStatement,
} from "@/lib/ledger/bank-statements";
import { Download, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function ImportBankStatementDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const [account, setAccount] = useState(defaultBankAccountName);
  const [fileName, setFileName] = useState("");
  const [contents, setContents] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setAccount(defaultBankAccountName());
    setFileName("");
    setContents("");
    setMessage("");
    setError("");
  }, [open]);

  async function handleImport() {
    try {
      if (!account.trim()) {
        setError("Select a bank account first.");
        return;
      }
      if (!contents.trim()) {
        setError("Choose a statement file first.");
        return;
      }
      const result = await importBankStatement({
        account,
        csv: contents,
        fileName,
      });
      const { statement, receiptsCreated, paymentsCreated } = result;
      const parts = [`Imported ${statement.lines.length} line${statement.lines.length === 1 ? "" : "s"}`];
      if (receiptsCreated || paymentsCreated) {
        parts.push(
          `created ${receiptsCreated} receipt${receiptsCreated === 1 ? "" : "s"} and ${paymentsCreated} payment${paymentsCreated === 1 ? "" : "s"} on ${account}`,
        );
      }
      onImported(`${parts.join(" — ")}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Statement import failed.");
    }
  }

  const footer = (
    <>
      <Button type="button" variant="outline" onClick={onClose}>
        Cancel
      </Button>
      <Button
        type="button"
        className="bg-black hover:bg-zinc-800"
        disabled={!contents || !account}
        onClick={handleImport}
      >
        Import statement
      </Button>
    </>
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Import bank statement"
      description="Select the bank account and your CSV file. Credits become receipts and debits become payments."
      className="sm:max-w-lg"
      footer={footer}
    >
      <div className="space-y-3 py-1">
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-500">Bank account</Label>
          <BankAccountSelect value={account} onChange={setAccount} />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-slate-500">Statement file</Label>
          <Input
            type="file"
            accept=".csv,.tsv,.txt,.qif,.ofx,text/csv,text/tab-separated-values"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then((text) => {
                setContents(text);
                setFileName(file.name);
                setMessage(`${file.name} is ready to import.`);
                setError("");
              });
            }}
          />
          <p className="text-[10px] text-slate-400">
            Columns: Date · Transaction Details · Credit (Money In) · Debit (Money Out)
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-[11px]"
          onClick={() => downloadBankStatementTemplate()}
        >
          <Download className="size-3.5" />
          Download template
        </Button>
      </div>
      {message && !error ? (
        <p className="text-[12px] text-slate-600">{message}</p>
      ) : null}
      {error ? <p className="text-[12px] text-rose-600">{error}</p> : null}
    </ResponsiveModal>
  );
}

export function BankStatementImporter({
  initialAccount = "",
}: {
  initialAccount?: string;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [statements, setStatements] = useState<BankStatement[]>(loadBankStatements);
  const [accountFilter, setAccountFilter] = useState(initialAccount);
  const { feedback, close, askConfirm, showSuccess } = useFeedbackModals();

  useEffect(() => {
    setAccountFilter(initialAccount);
  }, [initialAccount]);

  const filtered = useMemo(() => {
    const key = accountFilter.trim().toLowerCase();
    if (!key) return statements;
    return statements.filter((s) => s.account.trim().toLowerCase() === key);
  }, [statements, accountFilter]);

  const { page, setPage, pages, pageItems, pageSize, setPageSize, total, from, to } =
    usePagination(filtered);

  useEffect(() => {
    setPage(1);
  }, [filtered.length, accountFilter, setPage]);

  return (
    <div className="space-y-4">
      <FeedbackModals feedback={feedback} onClose={close} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Bank statements</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {accountFilter
              ? `Showing statements for ${accountFilter}.`
              : "Import CSV to create receipts and payments on the bank account."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {accountFilter ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setAccountFilter("")}
            >
              Clear account filter
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => downloadBankStatementTemplate()}
          >
            <Download className="size-3.5" />
            Download template
          </Button>
          <Button
            type="button"
            className="bg-black hover:bg-zinc-800"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="size-4" />
            Import bank statement
          </Button>
        </div>
      </div>

      {message ? (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-700">
          {message}
        </p>
      ) : null}

      <ImportBankStatementDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(text) => {
          setStatements(loadBankStatements());
          setMessage(text);
          showSuccess("Statement imported", text);
        }}
      />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h3 className="text-[13px] font-semibold text-slate-800">Imported statements</h3>
          {statements.length ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              onClick={() =>
                askConfirm({
                  title: "Delete all imported statements?",
                  message:
                    "This removes the imported statement list only. Receipts and payments already created from imports stay in the books.",
                  confirmLabel: "Delete all",
                  danger: true,
                  onConfirm: () => {
                    clearAllBankStatements();
                    setStatements([]);
                    setMessage("All imported statements were deleted.");
                    showSuccess("Deleted", "Imported statements list is empty.");
                  },
                })
              }
            >
              Delete all
            </Button>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2">Account</th>
                <th className="px-3 py-2">As of</th>
                <th className="px-3 py-2 text-right">Closing balance</th>
                <th className="px-3 py-2 text-right">Transactions</th>
                <th className="px-3 py-2 text-right">Matched</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((statement) => {
                const matched = statement.lines.filter((line) => line.matchedRecordId).length;
                return (
                  <tr key={statement.id} className="border-b border-slate-50">
                    <td className="px-4 py-3 font-medium">{statement.account}</td>
                    <td className="px-3 py-3">{statement.asOf}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {statement.closingBalance.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right">{statement.lines.length}</td>
                    <td className="px-3 py-3 text-right">
                      {matched}/{statement.lines.length}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            askConfirm({
                              title: "Auto-match statement?",
                              message: `Match transactions for ${statement.account} as of ${statement.asOf} against receipts and payments?`,
                              confirmLabel: "Auto-match",
                              danger: false,
                              onConfirm: async () => {
                                const previous = loadBankStatements();
                                const result = await autoMatchStatement(statement.id);
                                setStatements(loadBankStatements());
                                setMessage(`Auto-matched ${result.matched} transactions.`);
                                showSuccess(
                                  "Auto-match complete",
                                  `Matched ${result.matched} transaction${result.matched === 1 ? "" : "s"}.`,
                                  {
                                    undoLabel: "Undo match",
                                    onUndo: () => {
                                      saveBankStatements(previous);
                                      setStatements(previous);
                                      showSuccess("Undone", "Auto-match was reversed.");
                                    },
                                  },
                                );
                              },
                            })
                          }
                        >
                          Auto-match
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={() =>
                            askConfirm({
                              title: "Delete this statement?",
                              message: `Remove the import for ${statement.account} as of ${statement.asOf}? Receipts and payments already created stay in the books.`,
                              confirmLabel: "Delete",
                              danger: true,
                              onConfirm: () => {
                                deleteBankStatement(statement.id);
                                setStatements(loadBankStatements());
                                setMessage("Imported statement deleted.");
                                showSuccess("Deleted", "Statement removed from the import list.");
                              },
                            })
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No bank statements imported yet.
                  </td>
                </tr>
              )}
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
    </div>
  );
}
