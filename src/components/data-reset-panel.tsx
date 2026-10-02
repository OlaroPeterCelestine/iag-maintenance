"use client";

import { FeedbackModals, useFeedbackModals } from "@/components/feedback-modals";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { downloadBusinessBackup } from "@/lib/business-backup";
import {
  cleanTransactionsSystem,
  resetEntireSystem,
} from "@/lib/reset-data";
import { Download, Eraser, Trash2 } from "lucide-react";
import { useState } from "react";

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
      title: "Delete operational records?",
      message:
        "This removes day-to-day records from this browser and the database. Master lists and settings are kept. This cannot be undone — back up first.",
      confirmLabel: "Delete records",
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


  function runResetBusiness() {
    askConfirm({
      title: "Reset this workspace?",
      message:
        "This permanently deletes ALL data in this browser and on the server database for this workspace. Your login is kept. There is no undo. Back up first if you might need this data.",
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
              }. Reloading a blank workspace…`,
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
    <>
      <FeedbackModals feedback={feedback} onClose={close} />
      <div className="space-y-5">
        {!embedded && (
          <div>
            <h3 className="text-[14px] font-semibold text-slate-900">Clean / reset data</h3>
            <p className="mt-1 text-[12px] text-slate-500">
              Remove test entries from this browser and the database, then start from a clean workspace.
            </p>
          </div>
        )}


        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
          <p className="mb-1 text-[12px] font-medium text-slate-700">Back up first</p>
          <p className="mb-3 text-[12px] text-slate-500">
            Clean-up is permanent. Download a full copy so you can restore later if needed.
          </p>
          <Button variant="outline" size="sm" onClick={backupFirst} disabled={Boolean(busy)}>
            <Download size={14} className="mr-1.5" />
            Backup workspace
          </Button>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
          <p className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-amber-900">
            <Eraser size={14} /> Delete operational records
          </p>
          <p className="mb-3 text-[12px] text-amber-800">
            Clears day-to-day records in this browser and the database. Master lists and
            settings stay. This cannot be undone — back up first.
          </p>
          <label className="mb-3 flex items-center gap-2 text-[12px] text-amber-900">
            <Checkbox
              checked={clearHistory}
              onCheckedChange={(value) => setClearHistory(value === true)}
              disabled={Boolean(busy)}
            />
            Also clear history &amp; audit log
          </label>
          <Button
            size="sm"
            className="bg-amber-600 text-white hover:bg-amber-700"
            onClick={runCleanTransactions}
            disabled={Boolean(busy)}
          >
            <Eraser size={14} className="mr-1.5" />
            {busy === "transactions" ? "Clearing…" : "Delete records"}
          </Button>
        </div>


        <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
          <p className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-rose-900">
            <Trash2 size={14} /> Reset entire system
          </p>
          <p className="mb-3 text-[12px] text-rose-800">
            Deletes everything for this workspace in the browser and on the server database — including master data, settings and samples — and reloads a blank workspace. Login is kept. No undo.
          </p>
          <Button
            size="sm"
            className="bg-rose-600 text-white hover:bg-rose-700"
            onClick={runResetBusiness}
            disabled={Boolean(busy)}
          >
            <Trash2 size={14} className="mr-1.5" />
            {busy === "all" ? "Deleting…" : "Reset everything"}
          </Button>
        </div>
      </div>
    </>
  );
}
