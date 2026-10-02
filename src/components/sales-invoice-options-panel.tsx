"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  SALES_INVOICE_FORM_OPTIONS,
  type FormOptionsState,
  type FormOptionKey,
} from "@/lib/form-options";
import { Settings2 } from "lucide-react";
import { useState } from "react";

export function SalesInvoiceOptionsPanel({
  options,
  onChange,
  readOnly,
}: {
  options: FormOptionsState;
  onChange: (next: FormOptionsState) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(true);

  function toggle(key: FormOptionKey, next: boolean) {
    if (readOnly) return;
    onChange({ ...options, [key]: next });
  }

  return (
    <div className="sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-slate-700">Invoice options</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-[11px]"
          onClick={() => setOpen((v) => !v)}
        >
          <Settings2 size={12} />
          {open ? "Hide options" : "Form options"}
        </Button>
      </div>
      {open && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {SALES_INVOICE_FORM_OPTIONS.map((opt) => {
              const checked = Boolean(options[opt.key]);
              return (
                <button
                  key={opt.key}
                  type="button"
                  disabled={readOnly}
                  onClick={() => toggle(opt.key as FormOptionKey, !checked)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[12px] text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Checkbox
                    checked={checked}
                    tabIndex={-1}
                    className="pointer-events-none"
                    aria-hidden
                  />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-slate-400">
            Choices are saved for all sales invoices (like Manager form options).
          </p>
        </div>
      )}
    </div>
  );
}
