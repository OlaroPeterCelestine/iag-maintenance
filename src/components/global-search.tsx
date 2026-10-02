"use client";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { buildSearchIndex, filterSearchHits, type SearchHit } from "@/lib/global-search";
import { DEFAULT_ENABLED_TABS, loadEnabledTabs } from "@/lib/manager-settings";
import { type ModuleSlug } from "@/lib/module-data";
import { DocumentText, Element3, Folder2, SearchNormal1 } from "iconsax-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

function HitIcon({ group }: { group: SearchHit["group"] }) {
  if (group === "Pages") return <Element3 size={15} variant="Linear" color="currentColor" />;
  if (group === "Records") return <DocumentText size={15} variant="Linear" color="currentColor" />;
  return <Folder2 size={15} variant="Linear" color="currentColor" />;
}

export function GlobalSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [enabledTabs, setEnabledTabs] = useState<ModuleSlug[]>(DEFAULT_ENABLED_TABS);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    setEnabledTabs(loadEnabledTabs());
    setTick((t) => t + 1);
  }, [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  /**
   * The index walks every record in every loaded bucket and runs an access
   * check per hit. Rebuilding it inside the query memo did that on every
   * keystroke; it only changes when the data or the tab allowlist changes.
   */
  const index = useMemo(() => {
    void tick;
    return buildSearchIndex(enabledTabs);
  }, [enabledTabs, tick]);

  const hits = useMemo(() => filterSearchHits(index, query), [index, query]);

  const groups = useMemo(() => {
    const order: SearchHit["group"][] = ["Pages", "Modules", "Records"];
    return order
      .map((group) => ({ group, items: hits.filter((h) => h.group === group) }))
      .filter((g) => g.items.length > 0);
  }, [hits]);

  const select = useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search pages, modules, and records"
      className="max-w-lg"
    >
      <Command shouldFilter={false} className="rounded-xl">
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search anything…" />
        <CommandList className="max-h-[min(420px,55vh)]">
          <CommandEmpty>No matches. Try a module name, invoice reference, or customer.</CommandEmpty>
          {groups.map(({ group, items }) => (
            <CommandGroup key={group} heading={group}>
              {items.map((hit) => (
                <CommandItem
                  key={hit.id}
                  value={hit.id}
                  onSelect={() => select(hit.href)}
                  className="gap-2.5"
                >
                  <span className="text-slate-400">
                    <HitIcon group={hit.group} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-slate-800">{hit.title}</span>
                    {hit.subtitle ? (
                      <span className="block truncate text-[11px] text-slate-400">{hit.subtitle}</span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {!query.trim() ? (
            <div className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
              Tip: type to find invoices, customers, banks, and any module. Press Esc to close.
            </div>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export function GlobalSearchTrigger({
  collapsed = false,
  onOpen,
}: {
  collapsed?: boolean;
  onOpen: () => void;
}) {
  const [modKey, setModKey] = useState("⌘");

  useEffect(() => {
    const isApple = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
    setModKey(isApple ? "⌘" : "Ctrl");
  }, []);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="mb-4 flex size-9 items-center justify-center self-center rounded-lg border border-slate-200 bg-white text-slate-400 shadow-sm hover:text-slate-700"
        aria-label="Search anything"
        title={`Search (${modKey}+K)`}
      >
        <SearchNormal1 size={15} variant="Linear" color="currentColor" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-4 flex h-9 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left text-[13px] text-slate-400 shadow-sm transition-colors hover:border-slate-300 hover:text-slate-600"
      aria-label="Search anything"
    >
      <SearchNormal1 size={14} variant="Linear" color="currentColor" />
      <span className="flex-1">Search anything</span>
      <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">
        {modKey} K
      </kbd>
    </button>
  );
}
