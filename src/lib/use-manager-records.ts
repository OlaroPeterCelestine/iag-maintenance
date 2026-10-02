"use client";

import {
  DB_SYNC_READY_EVENT,
  hydrateEntityFromDatabase,
  isDbHydratedThisTab,
} from "@/lib/db/sync";
import { setMemoryRecords } from "@/lib/db/client-store";
import { type EntityDefinition, type ManagerRecord } from "@/lib/manager-entities";
import { type ModuleConfig } from "@/lib/module-data";
import { storageSlugForEntity } from "@/lib/entity-storage";
import {
  loadRecords,
  saveRecordsAsync,
  type SaveRecordsOptions,
  type SaveRecordsResult,
} from "@/lib/records-store";
import { getCurrentSessionUser } from "@/lib/session-profile";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

function recordsSlug(config: ModuleConfig, entity: string) {
  // Entity-first: a list shown on two routes must resolve one bucket, or each
  // route only ever sees the rows it created.
  return storageSlugForEntity(config.slug, entity);
}

function tabHydrateWarm(): boolean {
  if (typeof window === "undefined") return false;
  return isDbHydratedThisTab();
}

/**
 * Entity keys whose GET already returned in this tab. A warm tab alone is not
 * proof a collection is empty — without this, a first visit to an entity the
 * shell never pulled paints "no records" before the rows arrive.
 */
const settledEntities = new Set<string>();

function entitySettled(slug: string, entity: string) {
  return settledEntities.has(`${slug}:${entity}`);
}

/**
 * Keep open tables painted while background sync runs.
 * Only the entity key identity remounts loading state — never on prop object churn.
 */
export function useManagerRecords(config: ModuleConfig, definition: EntityDefinition) {
  const entity = definition.key;
  const slug = recordsSlug(config, entity);
  const [records, setRecords] = useState<ManagerRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const activeKey = useRef(`${slug}:${entity}`);

  useLayoutEffect(() => {
    const key = `${slug}:${entity}`;
    const keyChanged = activeKey.current !== key;
    activeKey.current = key;
    let cancelled = false;

    const markReady = () => {
      settledEntities.add(key);
      setReady(true);
    };

    // Paint tab memory immediately — never flash an empty table when rows exist.
    const cached = loadRecords(slug, entity);
    if (keyChanged) {
      setRecords(cached);
      setReady(Boolean(cached.length) || entitySettled(slug, entity) || tabHydrateWarm());
    } else if (cached.length) {
      setRecords(cached);
    }

    const reload = (event?: Event) => {
      if (cancelled) return;
      const detail = (event as CustomEvent | undefined)?.detail as
        | { module?: string; entity?: string; silent?: boolean }
        | undefined;
      if (
        detail?.module &&
        detail?.entity &&
        (detail.module !== slug || detail.entity !== entity)
      ) {
        return;
      }
      // Only paint memory after this entity has been settled from the API.
      if (!entitySettled(slug, entity) && !tabHydrateWarm()) return;
      setRecords(loadRecords(slug, entity));
      markReady();
    };
    const onSynced = () => {
      if (cancelled) return;
      if (!entitySettled(slug, entity) && !tabHydrateWarm()) return;
      setRecords(loadRecords(slug, entity));
      markReady();
    };
    window.addEventListener("financeiag-records-changed", reload);
    window.addEventListener("financeiag-db-synced", onSynced);
    window.addEventListener(DB_SYNC_READY_EVENT, onSynced);

    void (async () => {
      try {
        const remote = await hydrateEntityFromDatabase(slug, entity);
        if (cancelled) return;
        setRecords(remote);
        markReady();
      } catch {
        if (!cancelled) {
          const fallback = loadRecords(slug, entity);
          setRecords(fallback);
          markReady();
        }
      }
    })();

    const timer = window.setTimeout(() => {
      if (!cancelled && !entitySettled(slug, entity)) {
        // Timeout: show memory, never invent an empty "no data" state.
        setRecords(loadRecords(slug, entity));
        markReady();
      }
    }, 12_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("financeiag-records-changed", reload);
      window.removeEventListener("financeiag-db-synced", onSynced);
      window.removeEventListener(DB_SYNC_READY_EVENT, onSynced);
    };
  }, [slug, entity]);

  const persistAsync = useCallback(
    async (
      next: ManagerRecord[],
      options?: SaveRecordsOptions,
    ): Promise<SaveRecordsResult> => {
      setRecords(next);
      setSaving(true);
      try {
        return await saveRecordsAsync(slug, entity, next, options);
      } finally {
        setSaving(false);
      }
    },
    [slug, entity],
  );

  const create = useCallback(
    (values: Record<string, string>) => {
      const now = new Date().toISOString();
      const user = getCurrentSessionUser();
      const createdBy =
        (values.createdBy || "").trim() || user.username || user.id || "";
      const createdByUserId =
        (values.createdByUserId || "").trim() || user.id || "";
      const record: ManagerRecord = {
        ...values,
        ...(createdBy ? { createdBy } : {}),
        ...(createdByUserId ? { createdByUserId } : {}),
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        createdAt: now,
        updatedAt: now,
      };
      const next = [record, ...loadRecords(slug, entity)];
      setMemoryRecords(slug, entity, next);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("financeiag-records-changed", {
            detail: { module: slug, entity },
          }),
        );
      }
      setRecords(next);
      return record;
    },
    [slug, entity],
  );

  const update = useCallback(
    (id: string, values: Record<string, string>) => {
      let updated: ManagerRecord | null = null;
      const next = loadRecords(slug, entity).map((record) => {
        if (record.id !== id) return record;
        updated = { ...record, ...values, id, updatedAt: new Date().toISOString() };
        return updated;
      });
      setMemoryRecords(slug, entity, next);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("financeiag-records-changed", {
            detail: { module: slug, entity },
          }),
        );
      }
      setRecords(next);
      return updated;
    },
    [slug, entity],
  );

  const removeAsync = useCallback(
    (ids: string[]) => {
      const next = loadRecords(slug, entity).filter((record) => !ids.includes(record.id));
      // Server clears via removeIds (intentionalClear). Do not send allowEmpty —
      // that flag is reserved for admin wipes without removeIds.
      return persistAsync(next, { removeIds: ids });
    },
    [persistAsync, slug, entity],
  );

  const remove = useCallback(
    (ids: string[]) => {
      void removeAsync(ids);
    },
    [removeAsync],
  );

  const replaceAllAsync = useCallback(
    (next: ManagerRecord[], options?: SaveRecordsOptions) => persistAsync(next, options),
    [persistAsync],
  );

  const replaceAll = useCallback(
    (next: ManagerRecord[]) => {
      void replaceAllAsync(next);
    },
    [replaceAllAsync],
  );

  return {
    records,
    ready,
    saving,
    create,
    update,
    remove,
    removeAsync,
    replaceAll,
    replaceAllAsync,
    persistAsync,
  };
}
