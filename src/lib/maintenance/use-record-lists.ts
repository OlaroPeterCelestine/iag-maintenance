"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-auth";
import type { Rec } from "@/lib/maintenance/machine-summary";

/**
 * Load several of the app's record lists (/api/records/production/<entity>)
 * for a page that is not one of the list screens. Each list fails on its own:
 * a page about one machine is still worth showing when, say, costs are down.
 */
export function useRecordLists(entities: string[], refreshKey = 0) {
  const key = entities.join(",");
  const [state, setState] = useState<{
    data: Record<string, Rec[]>;
    errors: Record<string, string>;
    loading: boolean;
  }>({ data: {}, errors: {}, loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        key.split(",").filter(Boolean).map(async (entity) => {
          try {
            const res = await apiFetch(`/api/records/production/${entity}`, { cache: "no-store" });
            const body = (await res.json().catch(() => null)) as { data?: Rec[]; error?: string } | null;
            if (!res.ok) return [entity, null, body?.error || `HTTP ${res.status}`] as const;
            return [entity, Array.isArray(body?.data) ? body!.data! : [], ""] as const;
          } catch (err) {
            return [entity, null, err instanceof Error ? err.message : "Could not load"] as const;
          }
        }),
      );
      if (cancelled) return;
      const data: Record<string, Rec[]> = {};
      const errors: Record<string, string> = {};
      for (const [entity, rows, error] of results) {
        if (rows) data[entity] = rows as Rec[];
        if (error) errors[entity] = error;
      }
      setState({ data, errors, loading: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, refreshKey]);

  return state;
}
