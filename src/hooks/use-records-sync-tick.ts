"use client";

import { getMemoryRecords } from "@/lib/db/client-store";
import { hydrateEntityFromDatabase } from "@/lib/db/sync";
import { useMounted } from "@/hooks/use-mounted";
import { useEffect, useState } from "react";

type HydrateTarget = { module: string; entity: string };

/**
 * Bump a tick whenever records change or Postgres hydrate finishes.
 * Optionally pull specific entities so special panels are not stuck on empty memory.
 *
 * After hydration, paints from tab memory immediately; each target is pulled in
 * the background and ticks after every entity. Store reads wait for mount so
 * SSR HTML matches the first client paint.
 */
export function useRecordsSyncTick(hydrate?: HydrateTarget[]) {
  const mounted = useMounted();
  const [tick, setTick] = useState(0);
  // Always true: this hook paints from memory immediately and fills in as
  // hydrate returns. Kept in the return shape for callers that destructure it.
  const ready = true;
  const hydrateKey = (hydrate || []).map((h) => `${h.module}/${h.entity}`).join(",");
  /** Set once the first pull for a key finishes, so the shimmer can stop. */
  const [settledKey, setSettledKey] = useState("");

  /**
   * First pull is still running and memory had nothing to paint — show shimmer,
   * not "empty". Derived rather than stored: memory and `tick` already drive a
   * re-render, so mirroring them into state only added a render and a chance
   * for the flag to disagree with what the store actually holds.
   */
  const hasMemory =
    mounted &&
    (!hydrateKey ||
      hydrateKey.split(",").some((key) => {
        const [module, entity] = key.split("/");
        void tick;
        return getMemoryRecords(module, entity).length > 0;
      }));
  const hydrating = Boolean(hydrateKey) && !hasMemory && settledKey !== hydrateKey;

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("financeiag-records-changed", bump);
    window.addEventListener("financeiag-db-synced", bump);
    return () => {
      window.removeEventListener("financeiag-records-changed", bump);
      window.removeEventListener("financeiag-db-synced", bump);
    };
  }, []);

  useEffect(() => {
    if (!hydrateKey) return;
    let cancelled = false;
    const targets = hydrateKey.split(",").map((key) => {
      const [module, entity] = key.split("/");
      return { module, entity };
    });


    void (async () => {
      try {
        for (const { module, entity } of targets) {
          await hydrateEntityFromDatabase(module, entity);
          if (cancelled) return;
          setTick((t) => t + 1);
        }
      } finally {
        if (!cancelled) {
          setSettledKey(hydrateKey);
          setTick((t) => t + 1);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateKey]);

  return { tick, ready, hydrating, bump: () => setTick((t) => t + 1) };
}
