"use client";

import { FeedbackModals, useFeedbackModals } from "@/components/feedback-modals";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  downloadBusinessBackup,
  importBusinessBackupFile,
  parseBusinessBackup,
  summarizeBackup,
  type BusinessBackupOptions,
  type RestoreMode,
} from "@/lib/business-backup";
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";

export function BusinessBackupPanel({ embedded: _embedded = false }: { embedded?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { feedback, close, showSuccess, showWarning, askConfirm } = useFeedbackModals();
  const [options, setOptions] = useState<BusinessBackupOptions>({
    excludeHistory: false,
    excludeEmails: false,
    excludeAttachments: false,
    excludeFieldAudit: false,
  });
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("replace");
  const [pendingName, setPendingName] = useState<string | null>(null);

  function runBackup() {
    try {
      const backup = downloadBusinessBackup(options);
      showSuccess(
        "Backup saved",
        `${backup.businessName} was downloaded to your computer as a .financeiag file.`,
      );
    } catch (error) {
      showWarning(
        "Backup failed",
        error instanceof Error ? error.message : "Could not create the backup file.",
      );
    }
  }

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      const backup = parseBusinessBackup(text);
      const summary = summarizeBackup(backup);
      setPendingName(file.name);
      askConfirm({
        title:
          restoreMode === "replace"
            ? "Replace current workspace?"
            : "Merge backup into this workspace?",
        message:
          restoreMode === "replace"
            ? `Import “${summary.businessName}” (${summary.keyCount} data stores, ${summary.recordStores} record tables${summary.hasLedger ? ", ledger included" : ""}). This purges this workspace, then restores from the file.`
            : `Merge “${summary.businessName}” into the current workspace. Matching keys are overwritten; other local data is kept.`,
        confirmLabel: restoreMode === "replace" ? "Import workspace" : "Merge backup",
        danger: restoreMode === "replace",
        onConfirm: () => {
          void importBusinessBackupFile(file, restoreMode)
            .then(({ result }) => {
              showSuccess(
                "Workspace imported",
                `${result.businessName} restored (${result.keys} keys). Reloading…`,
              );
              window.setTimeout(() => window.location.reload(), 900);
            })
            .catch((error: unknown) => {
              showWarning(
                "Import failed",
                error instanceof Error ? error.message : "Could not import the backup.",
              );
            });
        },
      });
    } catch (error) {
      showWarning(
        "Import failed",
        error instanceof Error ? error.message : "Choose a valid .financeiag backup file.",
      );
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <FeedbackModals feedback={feedback} onClose={close} />
      <div className="space-y-5">
        <div>
          <h3 className="text-[14px] font-semibold text-slate-900">
            Backup & restore workspace
          </h3>
          <p className="mt-1 text-[12px] text-slate-500">
            Download a local copy of this workspace, then restore it from that file on this or another machine.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
          <p className="mb-3 text-[12px] font-medium text-slate-700">Backup options</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["excludeHistory", "Exclude history & deleted records"],
                ["excludeEmails", "Exclude email settings"],
                ["excludeAttachments", "Exclude attachments"],
                ["excludeFieldAudit", "Exclude field audit log"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-[12px] text-slate-700"
              >
                <Checkbox
                  checked={Boolean(options[key])}
                  onCheckedChange={(value) =>
                    setOptions((current) => ({ ...current, [key]: value === true }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <Button className="mt-4 bg-black hover:bg-zinc-800" onClick={runBackup}>
            <Download size={14} className="mr-1.5" />
            Backup workspace
          </Button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-1 text-[12px] font-medium text-slate-700">Import workspace</p>
          <p className="mb-3 text-[12px] text-slate-500">
            Upload a <span className="font-mono">.financeiag</span> backup file created here. Replace wipes the current workspace first.
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            {(
              [
                ["replace", "Replace current workspace"],
                ["merge", "Merge into current"],
              ] as const
            ).map(([mode, label]) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                variant={restoreMode === mode ? "default" : "outline"}
                className={
                  restoreMode === mode ? "bg-orange-500 hover:bg-orange-600" : ""
                }
                onClick={() => setRestoreMode(mode)}
              >
                {label}
              </Button>
            ))}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".financeiag,.json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImport(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} className="mr-1.5" />
            Import workspace
          </Button>
          {pendingName && (
            <p className="mt-2 text-[11px] text-slate-400">Selected: {pendingName}</p>
          )}
        </div>

        <div className="rounded-lg border border-amber-100 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-900">
          Store backups off this computer. Opening a backup created in a newer app version
          may not load in older builds. After import, the page reloads so this workspace picks up the restored data.
        </div>

      </div>
    </>
  );
}

/** Compact Backup / Import actions for toolbars (uses shared confirm flow via parent feedback optional). */
export function BusinessBackupActions() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { feedback, close, showSuccess, showWarning, askConfirm } = useFeedbackModals();

  return (
    <>
      <FeedbackModals feedback={feedback} onClose={close} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => {
            try {
              const backup = downloadBusinessBackup();
              showSuccess("Backup saved", `${backup.businessName} downloaded.`);
            } catch (error) {
              showWarning(
                "Backup failed",
                error instanceof Error ? error.message : "Backup failed.",
              );
            }
          }}
        >
          <Download size={14} className="mr-1.5" />
          Backup
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".financeiag,.json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void (async () => {
              try {
                const text = await file.text();
                const backup = parseBusinessBackup(text);
                askConfirm({
                  title: "Replace current workspace?",
                  message: `Import “${backup.businessName}” and replace the workspace open in this browser?`,
                  confirmLabel: "Import workspace",
                  danger: true,
                  onConfirm: () => {
                    void importBusinessBackupFile(file, "replace").then(({ result }) => {
                      showSuccess(
                        "Workspace imported",
                        `${result.businessName} restored. Reloading…`,
                      );
                      window.setTimeout(() => window.location.reload(), 900);
                    });
                  },
                });
              } catch (error) {
                showWarning(
                  "Import failed",
                  error instanceof Error ? error.message : "Invalid backup file.",
                );
              } finally {
                event.currentTarget.value = "";
              }
            })();
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={14} className="mr-1.5" />
          Import workspace
        </Button>
        <Label className="sr-only">Workspace backup actions</Label>
      </div>
    </>
  );
}
