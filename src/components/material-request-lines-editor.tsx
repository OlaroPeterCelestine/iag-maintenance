"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  downloadMaterialRequestImportTemplate,
  emptyMaterialRequestLine,
  parseMaterialRequestCsvText,
  type MaterialRequestLine,
} from "@/lib/material-request-lines";
import { Add, DocumentDownload, DocumentUpload, Trash } from "iconsax-react";
import { useRef, useState } from "react";

export function MaterialRequestLinesEditor({
  lines,
  onChange,
  project,
  contractor,
  neededBy,
  onHeaderFromCsv,
  readOnly,
}: {
  lines: MaterialRequestLine[];
  onChange: (lines: MaterialRequestLine[]) => void;
  project?: string;
  contractor?: string;
  neededBy?: string;
  /** When CSV includes project / contractor / date required, apply to the form header. */
  onHeaderFromCsv?: (header: {
    project?: string;
    contractor?: string;
    neededBy?: string;
  }) => void;
  readOnly?: boolean;
}) {
  const rows = lines.length ? lines : [emptyMaterialRequestLine()];
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState("");

  function update(index: number, patch: Partial<MaterialRequestLine>) {
    const next = rows.map((line, i) => (i === index ? { ...line, ...patch } : line));
    onChange(next);
  }

  function addRow() {
    onChange([...rows, emptyMaterialRequestLine()]);
  }

  function removeRow(index: number) {
    if (rows.length <= 1) {
      onChange([emptyMaterialRequestLine()]);
      return;
    }
    onChange(rows.filter((_, i) => i !== index));
  }

  async function importCsvFile(file: File) {
    setImportError("");
    try {
      const text = await file.text();
      const parsed = parseMaterialRequestCsvText(text);
      if (parsed.error || !parsed.lines.length) {
        setImportError(parsed.error || "Could not read material lines from CSV.");
        return;
      }
      onChange(parsed.lines);
      onHeaderFromCsv?.({
        project: parsed.project || undefined,
        contractor: parsed.contractor || undefined,
        neededBy: parsed.neededBy || undefined,
      });
    } catch {
      setImportError("Could not read that CSV file.");
    }
  }

  return (
    <div className="sm:col-span-2 space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[12px] font-medium text-slate-800">Materials</p>
          <p className="text-[11px] text-slate-500">
            Enter lines here, or download the CSV template, fill it, and import.
          </p>
        </div>
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importCsvFile(file);
                event.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => downloadMaterialRequestImportTemplate()}
            >
              <DocumentDownload size={14} color="currentColor" /> CSV template
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => fileRef.current?.click()}
            >
              <DocumentUpload size={14} color="currentColor" /> Import CSV
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={addRow}>
              <Add size={14} color="currentColor" /> Add item
            </Button>
          </div>
        ) : null}
      </div>

      {importError ? (
        <p className="text-[11px] text-amber-700">{importError}</p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[720px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-[10px] tracking-wide text-slate-500 uppercase">
              <th className="w-10 px-2 py-2 font-medium">Item</th>
              <th className="px-2 py-2 font-medium">Material description</th>
              <th className="w-20 px-2 py-2 font-medium">Unit</th>
              <th className="w-20 px-2 py-2 font-medium">Qty</th>
              <th className="px-2 py-2 font-medium">Project</th>
              <th className="px-2 py-2 font-medium">Contractor</th>
              <th className="w-28 px-2 py-2 font-medium">Date required</th>
              <th className="px-2 py-2 font-medium">Remarks</th>
              {!readOnly ? <th className="w-12 px-2 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((line, index) => (
              <tr key={index} className="border-b border-slate-100 last:border-0">
                <td className="px-2 py-1.5 tabular-nums text-slate-500">{index + 1}</td>
                <td className="px-2 py-1.5">
                  <Input
                    value={line.description}
                    readOnly={readOnly}
                    onChange={(e) => update(index, { description: e.target.value })}
                    placeholder="e.g. pvc pipes 4 inch"
                    className="h-8"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={line.unit}
                    readOnly={readOnly}
                    onChange={(e) => update(index, { unit: e.target.value })}
                    placeholder="pcs"
                    className="h-8"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    type="number"
                    step="any"
                    value={line.quantity}
                    readOnly={readOnly}
                    onChange={(e) => update(index, { quantity: e.target.value })}
                    className="h-8 tabular-nums"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                    {project?.trim() || "—"}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                    {contractor?.trim() || "—"}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">
                    {neededBy?.trim() || "—"}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <Input
                    value={line.remarks}
                    readOnly={readOnly}
                    onChange={(e) => update(index, { remarks: e.target.value })}
                    placeholder="Optional"
                    className="h-8"
                  />
                </td>
                {!readOnly ? (
                  <td className="px-2 py-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600"
                      onClick={() => removeRow(index)}
                      aria-label="Remove item"
                    >
                      <Trash size={14} color="currentColor" />
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
