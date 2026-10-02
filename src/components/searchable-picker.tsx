"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type SearchableOption = {
  value: string;
  label: string;
  searchText?: string;
  meta?: string;
  group?: string;
};

export function SearchablePicker({
  value,
  options,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  readOnly,
  className,
  matchWidth = true,
  allowClear = true,
  allowCustom = false,
  customLabel = (text) => `Use "${text}"`,
  createActionLabel,
  onCreateAction,
  extraCreateActions,
}: {
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  readOnly?: boolean;
  className?: string;
  matchWidth?: boolean;
  allowClear?: boolean;
  allowCustom?: boolean;
  customLabel?: (text: string) => string;
  /** Shown as a chooseable action in the dropdown (e.g. create warehouse). */
  createActionLabel?: string;
  onCreateAction?: () => void;
  /** Additional footer create actions (e.g. Add contractor alongside Add supplier). */
  extraCreateActions?: { label: string; onClick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const display = selected?.label || value || "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const blob = `${o.searchText || ""} ${o.label} ${o.value} ${o.meta || ""} ${o.group || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [options, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchableOption[]>();
    for (const opt of filtered) {
      const key = opt.group || "";
      const list = map.get(key) || [];
      list.push(opt);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const trimmedQuery = query.trim();
  const showCustom =
    allowCustom &&
    trimmedQuery.length > 0 &&
    !options.some(
      (o) =>
        o.value.toLowerCase() === trimmedQuery.toLowerCase() ||
        o.label.toLowerCase() === trimmedQuery.toLowerCase(),
    );

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  if (readOnly) {
    return (
      <div
        className={cn(
          "flex h-9 min-w-[160px] items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[12px] text-slate-700",
          className,
        )}
      >
        <span className="truncate">{display || placeholder}</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger
        type="button"
        className={cn(
          "flex h-9 w-full min-w-[160px] items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left text-[12px] text-slate-800 outline-none transition hover:border-slate-300 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-900/10",
          !display && "text-slate-400",
          className,
        )}
      >
        <span className="min-w-0 truncate">{display || placeholder}</span>
        <ChevronDown size={14} className="shrink-0 text-slate-400" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn(
          "no-scrollbar w-[min(320px,calc(100vw-2rem))] gap-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-0 shadow-lg ring-1 ring-black/5",
          matchWidth && "min-w-[var(--anchor-width)]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 p-2">
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200/80 focus-within:bg-white focus-within:ring-slate-300">
            <Search size={14} className="shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-5 w-full bg-transparent text-[12px] text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>
        </div>
        <div className="no-scrollbar max-h-56 overflow-y-auto py-1">
          {allowClear && value ? (
            <button
              type="button"
              className="flex w-full items-center px-3 py-2 text-left text-[12px] text-slate-500 hover:bg-slate-50"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Clear selection
            </button>
          ) : null}
          {showCustom ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-[12px] text-slate-800 hover:bg-slate-50"
              onClick={() => {
                onChange(trimmedQuery);
                setOpen(false);
              }}
            >
              <Search size={14} className="shrink-0 text-slate-400" />
              <span className="min-w-0 truncate font-medium">{customLabel(trimmedQuery)}</span>
            </button>
          ) : null}
          {filtered.length === 0 && !showCustom ? (
            <p className="px-3 py-6 text-center text-[12px] text-slate-400">{emptyText}</p>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group || "all"} className="py-1">
                {group ? (
                  <p className="px-3 py-1 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                    {group}
                  </p>
                ) : null}
                {items.map((opt) => {
                  const active = opt.value === value;
                  return (
                    <button
                      key={`${opt.group}-${opt.value}`}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left transition",
                        active ? "bg-slate-900 text-white" : "text-slate-800 hover:bg-slate-50",
                      )}
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium">{opt.label}</span>
                        {opt.meta ? (
                          <span
                            className={cn(
                              "mt-0.5 block truncate text-[10px]",
                              active ? "text-white/70" : "text-slate-400",
                            )}
                          >
                            {opt.meta}
                          </span>
                        ) : null}
                      </span>
                      {active ? <Check size={14} className="shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {createActionLabel && onCreateAction ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left text-[12px] font-medium text-slate-900 hover:bg-slate-50"
              onClick={() => {
                setOpen(false);
                onCreateAction();
              }}
            >
              <Plus size={14} className="shrink-0 text-slate-500" />
              {createActionLabel}
            </button>
          ) : null}
          {(extraCreateActions || []).map((action) => (
            <button
              key={action.label}
              type="button"
              className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-left text-[12px] font-medium text-slate-900 hover:bg-slate-50"
              onClick={() => {
                setOpen(false);
                action.onClick();
              }}
            >
              <Plus size={14} className="shrink-0 text-slate-500" />
              {action.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
