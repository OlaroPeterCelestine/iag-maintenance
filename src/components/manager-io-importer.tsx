"use client";

import { FeedbackModals, useFeedbackModals } from "@/components/feedback-modals";
import { Button } from "@/components/ui/button";
import {
  importManagerFile,
  managerTargets,
  type ImportOutcome,
  type ManagerTarget,
} from "@/lib/manager-io-import";
import { FileUp, Upload } from "lucide-react";
import { useRef, useState } from "react";

const AUTO = "auto";

export function ManagerIoImporter({ embedded = false }: { embedded?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { feedback, close, showSuccess, showWarning } = useFeedbackModals();
  const [targetKey, setTargetKey] = useState<string>(AUTO);
  const [results, setResults] = useState<ImportOutcome[]>([]);
  const targets = managerTargets();

  function forcedTarget(): ManagerTarget | undefined {
    return targetKey === AUTO
      ? undefined
      : targets.find((target) => target.entityKey === targetKey);
  }

  async function handleFiles(files: FileList) {
    const outcomes: ImportOutcome[] = [];
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        outcomes.push(...(await importManagerFile(file.name, text, forcedTarget())));
      } catch (error) {
        failures.push(
          `${file.name}: ${error instanceof Error ? error.message : "could not be read."}`,
        );
      }
    }
    setResults(outcomes);
    if (fileRef.current) fileRef.current.value = "";

    const created = outcomes.reduce((sum, o) => sum + o.created, 0);
    const updated = outcomes.reduce((sum, o) => sum + o.updated, 0);

    if (!outcomes.length) {
      showWarning(
        "Nothing imported",
        failures.length ? failures.join("\n") : "No usable rows were found.",
      );
      return;
    }
    showSuccess(
      "Saved successfully",
      `Added ${created} and updated ${updated} record${
        created + updated === 1 ? "" : "s"
      } across ${outcomes.length} table${outcomes.length === 1 ? "" : "s"}.${
        failures.length ? `\n\nSkipped files:\n${failures.join("\n")}` : ""
      }`,
    );
  }

  return (
    <>
      <FeedbackModals feedback={feedback} onClose={close} />
      <div className="space-y-5">
        {!embedded && (
          <div>
            <h3 className="text-[14px] font-semibold text-slate-900">
              Bulk upload files
            </h3>
            <p className="mt-1 text-[12px] text-slate-500">
              Select multiple CSV, TSV, or JSON exports at once. Columns are matched
              automatically and records are merged into the matching tables. Invalid rows are
              skipped with a warning — valid rows still import. Material Requests, invoices,
              bills, quotes, orders, notes, and Journal Entries use their list-page Import CSV
              (line-item sheet), not this Settings upload.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
          <p className="mb-2 text-[12px] font-medium text-slate-700">Import into</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={targetKey === AUTO ? "default" : "outline"}
              className={targetKey === AUTO ? "bg-orange-500 hover:bg-orange-600" : ""}
              onClick={() => setTargetKey(AUTO)}
            >
              Auto-detect
            </Button>
            {targets.map((target) => (
              <Button
                key={target.entityKey}
                type="button"
                size="sm"
                variant={targetKey === target.entityKey ? "default" : "outline"}
                className={
                  targetKey === target.entityKey ? "bg-orange-500 hover:bg-orange-600" : ""
                }
                onClick={() => setTargetKey(target.entityKey)}
              >
                {target.label}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            {targetKey === AUTO
              ? "Each file is routed by its column headers and file name."
              : `All chosen files are imported as ${
                  targets.find((t) => t.entityKey === targetKey)?.label
                }.`}
          </p>

          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".csv,.tsv,.txt,.json,text/csv,text/plain,application/json"
            className="hidden"
            onChange={(event) => {
              const files = event.target.files;
              if (files && files.length) void handleFiles(files);
            }}
          />
          <Button
            type="button"
            className="mt-4 bg-black hover:bg-zinc-800"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} className="mr-1.5" />
            Choose files (bulk)
          </Button>
        </div>

        {results.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-3 flex items-center gap-1.5 text-[12px] font-medium text-slate-700">
              <FileUp size={14} /> Import results
            </p>
            <div className="space-y-3">
              {results.map((outcome, index) => (
                <div
                  key={`${outcome.target.entityKey}-${index}`}
                  className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
                >
                  <p className="text-[12px] font-medium text-slate-800">
                    {outcome.target.label}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {outcome.created} added · {outcome.updated} updated · {outcome.skipped}{" "}
                    skipped
                  </p>
                  {outcome.warnings.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-amber-700">
                      {outcome.warnings.slice(0, 5).map((warning, wIndex) => (
                        <li key={wIndex}>{warning}</li>
                      ))}
                      {outcome.warnings.length > 5 && (
                        <li>+{outcome.warnings.length - 5} more…</li>
                      )}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-sky-100 bg-sky-50/80 px-3 py-2 text-[11px] text-sky-900">
          Tip: in FinaceManagerIAG open a tab, click the column header menu → Export, and save as
          CSV. Matching records (by code, email or name) are updated in place instead of
          duplicated.
        </div>
      </div>
    </>
  );
}
