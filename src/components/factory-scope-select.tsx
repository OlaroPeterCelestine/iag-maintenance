"use client";

/**
 * Which factory you are looking at.
 *
 * A factory is not a property of one list the way a status is — it is where
 * you are standing. IAG runs three, and a shop floor, a shift, a machine and a
 * downtime log all belong to one, so choosing it per table meant choosing it
 * again on every tab. It lives in the page header beside the module's tabs,
 * and the choice rides in the URL so it survives navigation between views and
 * can be sent to someone else as a link.
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
        /* the picker simply does not appear */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stored.length]);

  const factories = stored.length ? stored : fetched;

  const current = searchParams.get(FACTORY_PARAM) || "all";

  // One factory is not a choice; showing a picker with a single option asks a
  // question that has no second answer.
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
        value={current}
        onChange={(event) => choose(event.target.value)}
        aria-label="Factory in scope"
        className="h-8 rounded-md border border-slate-200 bg-white px-2.5 text-[12px] text-slate-700 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      >
        <option value="all">All factories</option>
        {factories.map((factory) => (
          <option key={String(factory.code ?? factory.id)} value={String(factory.code ?? factory.id)}>
            {String(factory.name || factory.code || factory.id)}
          </option>
        ))}
      </select>
    </label>
  );
}
