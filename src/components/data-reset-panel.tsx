"use client";

import { FeedbackModals, useFeedbackModals } from "@/components/feedback-modals";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { downloadBusinessBackup } from "@/lib/business-backup";
import {
  cleanTransactionsSystem,
  resetEntireSystem,
  resetKeepingChartOfAccountsSystem,
} from "@/lib/reset-data";
import { Download, Eraser, Trash2 } from "lucide-react";
import { useState } from "react";

/**
 * Settings → Reset data. Backup first, then clear transactions or wipe the books.
 * Demo-seed load lives only on finance; satellites keep the destructive tools.
 */
export function DataResetPanel({ embedded = false }: { embedded?: boolean }) {
  const { feedback, close, showSuccess, showWarning, askConfirm } = useFeedbackModals();
  const [clearHistory, setClearHistory] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  function backupFirst() {
    try {
      const backup = downloadBusinessBackup();
      showSuccess("Backup saved", `${backup.businessName} downloaded before any clean-up.`);
    } catch (error) {
      showWarning(
        "Backup failed",
        error instanceof Error ? error.message : "Could not create the backup.",
      );
    }
  }

  function runCleanTransactions() {
    askConfirm({
      title: "Delete all transactions?",
      message:
        "This removes every invoice, bill, receipt, payment, journal and ledger posting from this browser and the database, and resets inventory movements. Your chart of accounts, customers, suppliers, items, employees and bank accounts are kept. This cannot be undone — back up first.",
      confirmLabel: "Delete transactions",
      danger: true,
      onConfirm: () => {
        void (async () => {
          setBusy("transactions");
          try {
            const result = await cleanTransactionsSystem({ clearHistory });
            showSuccess(
              "Transactions cleared",
              `Emptied ${result.clearedStores} transaction table${
                result.clearedStores === 1 ? "" : "s"
              }${result.remotePurged ? " (database purged)" : " (local only — database unreachable)"}. Reloading…`,
            );
            window.setTimeout(() => window.location.reload(), 900);
          } catch (error) {
            showWarning(
              "Clean-up failed",
              error instanceof Error ? error.message : "Could not clear transactions.",
            );
          } finally {
            setBusy(null);
          }
        })();
      },
    });
  }

  function runResetKeepCoa() {
    askConfirm({
      title: "Reset everything except Chart of Accounts?",
      message:
        "This deletes banks, customers, suppliers, transactions, statements, samples and history in this browser and the database. Your Chart of Accounts is kept. There is no undo — back up first.",
      confirmLabel: "Reset, keep CoA",
      danger: true,
      onConfirm: () => {
        void (async () => {
          setBusy("keep-coa");
          try {
            const result = await resetKeepingChartOfAccountsSystem();
            showSuccess(
              "Reset complete",
              `Cleared ${result.keysRemoved} stores${
                result.remotePurged ? " and purged the database" : " (database unreachable)"
              }. Chart of Accounts kept. Reloading…`,
            );
            window.setTimeout(() => window.location.reload(), 900);
          } catch (error) {
            showWarning(
              "Reset failed",
              error instanceof Error ? error.message : "Could not reset the business.",
            );
          } finally {
            setBusy(null);
          }
        })();
      },
    });
  }

  function runResetBusiness() {
    askConfirm({
      title: "Reset the entire system?",
      message:
        "This permanently deletes ALL business data in this browser and on the server database — chart of accounts, customers, suppliers, items, transactions, banks, settings and samples. Your login is kept. There is no undo. Back up first if you might need this data.",
      confirmLabel: "Delete everything",
      danger: true,
      onConfirm: () => {
        void (async () => {
          setBusy("all");
          try {
            const result = await resetEntireSystem();
            showSuccess(
              "System reset",
              `Removed ${result.keysRemoved} local stores${
                result.remotePurged
                  ? " and purged the database"
                  : " (database unreachable — local wipe only)"
              }. Reloading…`,
            );
            window.setTimeout(() => window.location.reload(), 900);
          } catch (error) {
            showWarning(
              "Reset failed",
              error instanceof Error ? error.message : "Could not reset the system.",
            );
          } finally {
            setBusy(null);
          }
        })();
      },
    });
  }

  return (
    <div className={embedded ? "space-y-4" : "space-y-4 rounded-xl border border-slate-200 bg-white p-4"}>
      {!embedded ? (
        <div>
          <h3 className="text-[14px] font-semibold text-slate-900">Reset data</h3>
          <p className="mt-1 text-[12px] text-slate-500">
            Download a backup first. Destructive actions reload this app when they finish.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={backupFirst}>
          <Download size={14} className="mr-1.5" /> Download backup
        </Button>
      </div>

      <label className="flex items-center gap-2 text-[12px] text-slate-600">
        <Checkbox
          checked={clearHistory}
          onCheckedChange={(v) => setClearHistory(v === true)}
          disabled={Boolean(busy)}
        />
        Also clear activity history when cleaning transactions
      </label>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={Boolean(busy)}
          onClick={runCleanTransactions}
        >
          <Eraser size={14} className="mr-1.5" />
          {busy === "transactions" ? "Clearing…" : "Delete transactions"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={Boolean(busy)}
          onClick={runResetKeepCoa}
        >
          <Trash2 size={14} className="mr-1.5" />
          {busy === "keep-coa" ? "Resetting…" : "Reset, keep CoA"}
        </Button>
        <Button type="button" variant="destructive" size="sm" disabled={Boolean(busy)} onClick={runResetBusiness}>
          <Trash2 size={14} className="mr-1.5" />
          {busy === "all" ? "Deleting…" : "Reset entire system"}
        </Button>
      </div>

      <FeedbackModals feedback={feedback} onClose={close} />
    </div>
  );
}
