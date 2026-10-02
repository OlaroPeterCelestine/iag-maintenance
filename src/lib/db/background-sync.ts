/**
 * Gmail-style silent background refresh.
 * Pulls fresh rows into memory and notifies open views only when data changed.
 * Never reloads the page and never clears UI into loading skeletons.
 */

import { getMemoryRecords } from "@/lib/db/client-store";
import { entityKey, type ManagerRecord } from "@/lib/manager-entities";
import { NAV_MODULES, type ModuleSlug } from "@/lib/module-data";
import { storageSlugForEntity, storageSlugForRoute } from "@/lib/entity-storage";
import {
  hydrateEntityFromDatabase,
  hydrateLedgerFromDatabase,
  hydrateSettingFromDatabase,
  isHydrateBusy,
} from "@/lib/db/sync";

export const BACKGROUND_SYNC_EVENT = "financeiag-background-sync";

type SyncReason =
  | "realtime"
  | "focus"
  | "online"
  | "reconnect"
  | "interval"
  | "manual";

let syncing = false;
let queued: (() => Promise<void>) | null = null;
let loopStarted = false;
let intervalId: ReturnType<typeof setInterval> | undefined;
let lastModuleSyncAt = 0;
let lastLedgerSyncAt = 0;

function fingerprint(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Same as comparing two fingerprints, but skips stringifying either record
 * array when the lengths already differ — the common case (nothing changed,
 * or a row was added/removed) on a background poll tick. */
function recordsDiffer(before: ManagerRecord[], after: ManagerRecord[]): boolean {
  if (before.length !== after.length) return true;
  return fingerprint(after) !== fingerprint(before);
}

function emitUi(kind: string, detail?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(kind, {
      detail: { silent: true, background: true, ...(detail || {}) },
    }),
  );
}

function activeModuleSlug(): ModuleSlug | null {
  if (typeof window === "undefined") return null;
  const seg = window.location.pathname.replace(/^\//, "").split("/")[0] || "";
  if (!seg || seg === "login" || seg === "profile" || seg === "users") return null;
  const hit = NAV_MODULES.find((m) => m.slug === seg);
  return hit?.slug ?? null;
}

/** Postgres records bucket for the open route (e.g. receipts-payments → banking). */
function activeStorageSlug(): string | null {
  const slug = activeModuleSlug();
  if (!slug) return null;
  return storageSlugForRoute(slug);
}

function entityKeysForModule(slug: ModuleSlug): string[] {
  const nav = NAV_MODULES.find((m) => m.slug === slug);
  return (nav?.items ?? []).map((label) => entityKey(label));
}

async function runExclusive(task: () => Promise<void>) {
  if (syncing) {
    queued = task;
    return;
  }
  syncing = true;
  try {
    await task();
  } finally {
    syncing = false;
    if (queued) {
      const next = queued;
      queued = null;
      void runExclusive(next);
    }
  }
}

/** Refresh one entity collection and repaint open tables only if rows changed. */
export async function silentRefreshEntity(
  moduleSlug: string,
  entity: string,
  reason: SyncReason = "realtime",
): Promise<void> {
  if (isHydrateBusy()) return;
  await runExclusive(async () => {
    const before = getMemoryRecords(moduleSlug, entity);
    const remote = await hydrateEntityFromDatabase(moduleSlug, entity);
    const changed = recordsDiffer(before, remote);
    if (!changed && reason !== "realtime") return;
    // Realtime may carry metadata even when payload matches; still nudge the open view once.
    emitUi("financeiag-records-changed", { module: moduleSlug, entity, reason });
  });
}

/** Refresh CoA + journal lines without a full page reload. */
export async function silentRefreshLedger(
  reason: SyncReason = "realtime",
): Promise<void> {
  if (isHydrateBusy()) return;
  const now = Date.now();
  if (reason !== "realtime" && now - lastLedgerSyncAt < 8_000) return;
  await runExclusive(async () => {
    const changed = await hydrateLedgerFromDatabase();
    lastLedgerSyncAt = Date.now();
    if (!changed && reason !== "realtime") return;
    emitUi("financeiag-ledger-changed", { reason });
  });
}

export async function silentRefreshSetting(
  key: string,
  reason: SyncReason = "realtime",
): Promise<void> {
  // Shared identity blob must never overwrite the signed-in tab.
  if (key === "financeiag-session") return;
  if (isHydrateBusy()) return;
  await runExclusive(async () => {
    const changed = await hydrateSettingFromDatabase(key);
    if (!changed && reason !== "realtime") return;
    emitUi("financeiag-settings-changed", { key, reason });
  });
}

/**
 * Soft-sync the module currently on screen. Skips UI events when nothing changed
 * so lists do not flash or remount.
 */
export async function silentRefreshActiveView(
  reason: SyncReason = "focus",
): Promise<void> {
  if (isHydrateBusy()) return;
  const navSlug = activeModuleSlug();
  const storageSlug = activeStorageSlug();
  const now = Date.now();
  // Avoid hammering on every window focus / click. Realtime push (WebSocket/SSE)
  // is the primary update path — this poll is only a catch-up safety net for
  // missed events, so it can afford to be infrequent.
  const minGap =
    reason === "interval" ? 120_000 : reason === "focus" ? 60_000 : 8_000;
  if (reason !== "realtime" && now - lastModuleSyncAt < minGap) {
    return;
  }

  await runExclusive(async () => {
    lastModuleSyncAt = Date.now();
    let recordsChanged = false;
    let ledgerChanged = false;

    // Reports are ledger-computed views — skip ~25 useless entity GETs.
    // Use storageSlug so receipts-payments refreshes banking/* keys.
    if (navSlug && storageSlug && navSlug !== "reports") {
      const entities = entityKeysForModule(navSlug);
      await Promise.all(
        entities.map(async (entity) => {
          // Entity-first: a cross-listed page (Inventory → Production Orders)
          // is owned by another bucket and must refresh from there.
          const bucket = storageSlugForEntity(navSlug, entity);
          const before = getMemoryRecords(bucket, entity);
          const remote = await hydrateEntityFromDatabase(bucket, entity);
          if (recordsDiffer(before, remote)) recordsChanged = true;
        }),
      );
    }

    const wantsLedger =
      !navSlug ||
      navSlug === "banking" ||
      navSlug === "accounts" ||
      navSlug === "reports" ||
      navSlug === "receipts-payments" ||
      navSlug === "sales" ||
      navSlug === "purchases";
    if (wantsLedger) {
      ledgerChanged = await hydrateLedgerFromDatabase();
      lastLedgerSyncAt = Date.now();
    }

    if (recordsChanged) {
      emitUi("financeiag-records-changed", {
        module: storageSlug ?? navSlug,
        reason,
      });
    }
    if (ledgerChanged) {
      emitUi("financeiag-ledger-changed", { reason });
    }
  });
}

/**
 * Background sync loop: catch up when returning to the tab / coming online,
 * plus a slow poll. Push/WebSocket remains the primary path.
 */
export function startBackgroundSyncLoop(): () => void {
  if (typeof window === "undefined") return () => {};
  if (loopStarted) return () => {};
  loopStarted = true;

  const onVisible = () => {
    if (document.visibilityState === "visible") {
      void silentRefreshActiveView("focus");
    }
  };
  const onOnline = () => void silentRefreshActiveView("online");

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);

  // Realtime push covers live updates; this tick only catches whatever it
  // missed (dropped socket, tab woken from sleep), so it can run less often.
  intervalId = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    void silentRefreshActiveView("interval");
  }, 180_000);

  return () => {
    loopStarted = false;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    if (intervalId) clearInterval(intervalId);
    intervalId = undefined;
  };
}
