"use client";

/**
 * Which factory you are looking at.
 *
 * Production and maintenance run as single-factory apps for now: every screen
 * is pinned to one plant (default kampala, override with NEXT_PUBLIC_FIXED_PLANT).
 * Multi-factory "All factories" returns later; until then the picker stays
 * hidden and the URL always carries ?factory=.
 *
 * The shop floor, shift and machine filters stay on their own tables: those
 * are properties of what is listed, and they narrow within the factory.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { loadRecords } from "@/lib/records-store";
import type { ManagerRecord } from "@/lib/manager-entities";

/** The URL parameter every screen reads to know which factory is in scope. */
export const FACTORY_PARAM = "factory";

/**
 * Plant code every production / maintenance screen runs under until
 * multi-factory is turned back on. MES seed + jobs already default here.
 */
export const FIXED_FACTORY = (process.env.NEXT_PUBLIC_FIXED_PLANT || "kampala").trim();

/** URL factory, else the fixed plant — never an empty "all factories" scope. */
export function effectiveFactory(searchParams: { get(name: string): string | null }): string {
  return (searchParams.get(FACTORY_PARAM) || FIXED_FACTORY || "").trim();
}

function factoryCode(row: ManagerRecord): string {
  return String(row.code ?? row.id ?? "").trim();
}

export function FactoryScopeSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const refresh = () => setTick((n) => n + 1);
    window.addEventListener("financeiag-records-changed", refresh);
    return () => window.removeEventListener("financeiag-records-changed", refresh);
  }, []);

  const [fetched, setFetched] = useState<ManagerRecord[]>([]);

  const stored = useMemo<ManagerRecord[]>(() => {
    void tick;
    try {
      return loadRecords("production", "plants");
    } catch {
      return [];
    }
  }, [tick]);

  /**
   * The header renders before any screen has hydrated the factory list, and on
   * screens that never read it at all, so this asks for it rather than waiting
   * for another component to happen to need it. The store is preferred once it
   * has them, so the two never disagree.
   */
  useEffect(() => {
    if (stored.length) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/records/production/plants", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { data?: ManagerRecord[] };
        if (!cancelled && Array.isArray(body.data)) setFetched(body.data);
      } catch {
        /* the label simply shows the code */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stored.length]);

  const factories = stored.length ? stored : fetched;
  const pinned = FIXED_FACTORY;
  const current = searchParams.get(FACTORY_PARAM) || "";

  // Keep ?factory= on every route so dashboards, tables and boards never fall
  // through to an unscoped "all plants" aggregation.
  useEffect(() => {
    if (!pinned) return;
    if (current === pinned) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set(FACTORY_PARAM, pinned);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pinned, current, pathname, router, searchParams]);

  const label = useMemo(() => {
    const match = factories.find((f) => factoryCode(f) === pinned);
    return match ? String(match.name || match.code || pinned) : pinned;
  }, [factories, pinned]);

  // Single-factory mode: show where we are standing, not a choice.
  if (pinned) {
    return (
      <p className="text-[12px] text-slate-500" title={`Factory scope: ${pinned}`}>
        Factory <span className="font-medium text-slate-700 dark:text-slate-200">{label}</span>
      </p>
    );
  }

  // Multi-factory path (only if FIXED_FACTORY is cleared).
  if (factories.length < 2) return null;

  const choose = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value === "all") next.delete(FACTORY_PARAM);
    else next.set(FACTORY_PARAM, value);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <label className="flex items-center gap-1.5 text-[12px] text-slate-500">
      Factory
      <select
        value={current || "all"}
        onChange={(event) => choose(event.target.value)}
        aria-label="Factory in scope"
        className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-[12px] text-slate-700 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      >
        <option value="all">All factories</option>
        {factories.map((factory) => (
          <option key={factoryCode(factory)} value={factoryCode(factory)}>
            {String(factory.name || factory.code || factory.id)}
          </option>
        ))}
      </select>
    </label>
  );
}
