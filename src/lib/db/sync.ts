/**
 * Client ↔ Postgres sync for module records, ledger, CoA, and critical settings.
 * Postgres is the source of truth; Redis is the shared server cache on /api/records.
 * Browser memory is only a short-lived working copy for the open tab.
 */

import type { ManagerRecord } from "@/lib/manager-entities";
import { entityDefinitions } from "@/lib/manager-entities";
import type { AccountBalance, AccountType, LedgerAccount, LedgerLine } from "@/lib/ledger/types";
import { MODULE_SLUGS, moduleConfigs, type ModuleSlug } from "@/lib/module-data";
import {
  routeSlugsForStorageBucket,
  storageSlugForEntity,
  storageSlugForRoute,
} from "@/lib/entity-storage";
import {
  getMemoryLedgerAccounts,
  getMemoryLedgerLines,
  getMemoryRecords,
  getMemorySetting,
  hasMemorySetting,
  listMemoryRecordKeys,
  migrateBusinessDataOutOfLocalStorage,
  removeMemorySetting,
  scrubBusinessLocalStorage,
  setMemoryLedgerAccounts,
  setMemoryLedgerLines,
  setMemoryRecords,
  setMemorySetting,
} from "@/lib/db/client-store";
import { FRONTEND_ONLY } from "@/lib/frontend-only";
import { apiFetch, isWithinLoginGrace } from "@/lib/api-auth";
import { setServerAccountBalances } from "@/lib/ledger/balance-cache";
import { formPickerRecordKeys } from "@/lib/form-picker-keys";
import { moduleAccessAllowed } from "@/lib/access-gate";

export const DB_SYNC_READY_EVENT = "financeiag-db-synced";
const HYDRATE_SESSION_KEY = "financeiag-db-hydrated-v1";
export { HYDRATE_SESSION_KEY };

/** True after this tab completed (or skipped) a hydrate pass. */
export function isDbHydratedThisTab(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(HYDRATE_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mark hydrate complete without pulling (e.g. post-wipe skip). */
export function markDbHydratedThisTab(value = true) {
  if (typeof window === "undefined") return;
  try {
    if (value) sessionStorage.setItem(HYDRATE_SESSION_KEY, "1");
    else sessionStorage.removeItem(HYDRATE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Settings / list keys dual-written to AppSetting. */
export const SYNCED_SETTING_KEYS = [
  "financeiag-manager-settings",
  "financeiag-enabled-tabs",
  "financeiag-enabled-tabs-v3",
  "financeiag-tax-codes",
  "financeiag-foreign-currencies",
  "financeiag-exchange-rates",
  "financeiag-divisions",
  "financeiag-divisions-seeded-v2",
  "financeiag-supplier-categories",
  "financeiag-custom-fields",
  "financeiag-form-defaults",
  "financeiag-footers",
  "financeiag-control-accounts",
  "financeiag-receipt-rules",
  "financeiag-payment-rules",
  "financeiag-payslip-items",
  "financeiag-claim-payers",
  "financeiag-users",
  "financeiag-roles",
  "financeiag-email-settings",
  "financeiag-request-email-contacts",
  "financeiag-email-templates",
  "financeiag-business-logo",
  "financeiag-customer-portals",
  "financeiag-recurring-templates",
  "financeiag-themes",
  "financeiag-employee-departments",
  "financeiag-document-terms",
  "financeiag-bank-statements",
  "financeiag-business-profile",
  "financeiag-business-records",
  "financeiag-document-template",
  "financeiag-document-templates",
  "financeiag-recommended-layouts-v2",
  "financeiag-ceo-desk-widgets-v1",
  "financeiag-theme",
  "financeiag-sidebar-collapsed",
  "financeiag-notifications-seen",
  "financeiag-keep-signed-in",
  "financeiag-sessions",
  "financeiag-idle-timeout-ms",
  "financeiag-fx-daily-fetched",
  "financeiag-keep-blank-slate-v1",
  "financeiag-wipe-all-v1",
  "financeiag-wipe-keep-coa-v1",
  "financeiag-sample-documents-v12",
  "financeiag-sample-documents-v13",
  "financeiag-populate-demo-v2",
  "financeiag-demo-cleared-v1",
  "financeiag-books-reset-balance-check-v1",
  "financeiag-clear-default-bank-seeds-v3",
  "financeiag-clear-imported-statements-v1",
  "financeiag-bank-friendly-names-v1",
  "financeiag-removed-cash-at-hand-001ca-v1",
  "financeiag-coa-iag-v1",
  "financeiag-user-data-wiped-v5",
  "financeiag-field-audit",
  "financeiag-accounting-periods",
  "financeiag-consolidation-entities",
  "financeiag-legal-entities",
  "financeiag-budgets",
  "financeiag-forecasts",
  "financeiag-financial-notes",
  "financeiag-uganda-banks",
  "financeiag-custom-uganda-banks",
  "financeiag-form-options:receipt",
  "financeiag-form-options:payment",
  "financeiag-form-options:journal",
  "financeiag-form-options:transfer",
  "financeiag-form-options:sales-invoices",
  "financeiag-form-options:invoices",
] as const;

let syncEnabled: boolean | null = null;
let syncEnabledCheckedAt = 0;
const SYNC_PROBE_TTL_MS = 8_000;
let hydratePromise: Promise<boolean> | null = null;
/** Full catalog catch-up after interactive boot — must not block navigation. */
let backgroundCatalogHydrate: Promise<void> | null = null;
/** Remaining journal pages after interactive boot — must not block navigation. */
let backgroundJournalHydrate: Promise<void> | null = null;
let lastHydrateHadRemoteData = false;
/** True while the initial/force hydrate is still flooding the network. */
let hydrateBusy = false;

export function isHydrateBusy(): boolean {
  return hydrateBusy;
}

const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const persistRuns = new Map<string, () => Promise<void>>();
const inFlightPersists = new Set<Promise<unknown>>();
/** Serialize writes per key so an older PUT cannot overwrite a newer seed body. */
const persistChains = new Map<string, Promise<unknown>>();
const PERSIST_RETRIES = 5;
/**
 * Durable writes get a longer client timeout than the generic apiFetch
 * default (25s). Railway/Postgres cold paths are documented to take >45s
 * (see api-auth.ts LOGIN_AUTH_GRACE_MS) — aborting a write at 25s does not
 * cancel it server-side, so a write that would have succeeded gets reported
 * as failed and retried, wasting the retry budget on false negatives.
 */
const PERSIST_TIMEOUT_MS = 60_000;
/** Cap concurrent Postgres PUTs — leave headroom so session prefs cannot starve forms. */
const MAX_CONCURRENT_WRITES = 3;
let activeWrites = 0;
const writeWaiters: Array<() => void> = [];
/** Last records persist failure detail for UI (single-flight; overwritten each attempt). */
let lastRecordsPersistError = "";

export function consumeLastRecordsPersistError(): string {
  const msg = lastRecordsPersistError;
  lastRecordsPersistError = "";
  return msg;
}

/** Last ledger-lines persist failure detail (single-flight; overwritten each attempt). */
let lastLedgerPersistError = "";

export function consumeLastLedgerPersistError(): string {
  const msg = lastLedgerPersistError;
  lastLedgerPersistError = "";
  return msg;
}

async function acquireWriteSlot(): Promise<void> {
  if (activeWrites < MAX_CONCURRENT_WRITES) {
    activeWrites += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    writeWaiters.push(() => {
      activeWrites += 1;
      resolve();
    });
  });
}

function releaseWriteSlot() {
  activeWrites = Math.max(0, activeWrites - 1);
  const next = writeWaiters.shift();
  if (next) next();
}

async function withWriteSlot<T>(work: () => Promise<T>): Promise<T> {
  await acquireWriteSlot();
  try {
    return await work();
  } finally {
    releaseWriteSlot();
  }
}

function trackPersist<T>(promise: Promise<T>): Promise<T> {
  inFlightPersists.add(promise);
  void promise.finally(() => {
    inFlightPersists.delete(promise);
  });
  return promise;
}

/** Run work after any prior write for the same key; always track for flush. */
function enqueuePersist<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prev = persistChains.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => withWriteSlot(work));
  persistChains.set(key, next);
  void next.finally(() => {
    if (persistChains.get(key) === next) persistChains.delete(key);
  });
  return trackPersist(next);
}

/** Wait until every tracked Postgres write has settled. */
export async function awaitInFlightPersists(): Promise<void> {
  while (inFlightPersists.size > 0) {
    await Promise.allSettled([...inFlightPersists]);
  }
}

function recordsPersistKey(moduleSlug: string, entityKey: string) {
  return `records:${moduleSlug}:${entityKey}`;
}

/**
 * Soft hold while the UI builds an optimistic create/update payload.
 * Prevents hydrate from wiping the row in the gap before enqueuePersist runs.
 */
const entityMutationHolds = new Map<string, number>();

export function holdEntityMutation(moduleSlug: string, entityKey: string): () => void {
  const key = recordsPersistKey(moduleSlug, entityKey);
  entityMutationHolds.set(key, (entityMutationHolds.get(key) || 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (entityMutationHolds.get(key) || 1) - 1;
    if (next <= 0) entityMutationHolds.delete(key);
    else entityMutationHolds.set(key, next);
  };
}

/** True while a PUT for this entity collection is queued or in flight, or a UI mutation hold is open. */
export function isEntityPersistActive(
  moduleSlug: string,
  entityKey: string,
): boolean {
  const key = recordsPersistKey(moduleSlug, entityKey);
  return persistChains.has(key) || (entityMutationHolds.get(key) || 0) > 0;
}

/** Wait for any in-flight / queued persist for one entity collection. */
export async function awaitEntityPersist(
  moduleSlug: string,
  entityKey: string,
): Promise<void> {
  const key = recordsPersistKey(moduleSlug, entityKey);
  // Wait out UI holds first (create/update building the payload).
  for (let i = 0; i < 200 && (entityMutationHolds.get(key) || 0) > 0; i++) {
    await sleep(25);
  }
  const chain = persistChains.get(key);
  if (chain) await chain.catch(() => undefined);
}

const LEDGER_LINES_PERSIST_KEY = "ledger:lines";

/** True while a ledger lines PUT is queued or in flight. */
export function isLedgerLinesPersistActive(): boolean {
  return persistChains.has(LEDGER_LINES_PERSIST_KEY);
}

/** Wait for any in-flight / queued ledger lines persist. */
export async function awaitLedgerLinesPersist(): Promise<void> {
  const chain = persistChains.get(LEDGER_LINES_PERSIST_KEY);
  if (chain) await chain.catch(() => undefined);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeOk(path: string, timeoutMs: number): Promise<boolean> {
  try {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer =
      typeof window !== "undefined" && controller
        ? window.setTimeout(() => controller.abort(), timeoutMs)
        : null;
    const res = await apiFetch(path, {
      cache: "no-store",
      signal: controller?.signal,
    });
    if (timer) window.clearTimeout(timer);
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean };
    return Boolean(json.ok);
  } catch {
    return false;
  }
}

async function probeDatabase(): Promise<boolean> {
  // One cheap liveness hop. Deep health used to wait on Postgres and stall
  // boot from high-latency networks before any business data arrived.
  return probeOk("/api/sync/ready", 2500);
}

/** Forget cached DB probe so the next call re-checks. */
export function clearDbSyncCache() {
  syncEnabled = null;
  syncEnabledCheckedAt = 0;
}

export async function isDbSyncAvailable(): Promise<boolean> {
  if (FRONTEND_ONLY) return false;
  const now = Date.now();
  // Re-probe periodically — a single failed health check must not block all saves.
  if (syncEnabled !== null && now - syncEnabledCheckedAt < SYNC_PROBE_TTL_MS) {
    return syncEnabled;
  }
  syncEnabled = await probeDatabase();
  syncEnabledCheckedAt = now;
  return syncEnabled;
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * Same result as `stableJson(next) !== stableJson(local)` but skips
 * stringifying either array when the lengths already differ (row added/
 * removed) — a common case on every hydrate/background-poll pass. Falls
 * back to the exact same full-content compare when lengths match, so this
 * never weakens change detection, only skips wasted work for the cheap case.
 */
function arraysDiffer(next: readonly unknown[], local: readonly unknown[]): boolean {
  if (next.length !== local.length) return true;
  return stableJson(next) !== stableJson(local);
}

/** Cheap ledger compare — avoid JSON.stringify of the full journal on every hydrate. */
function ledgerLinesFingerprint(lines: LedgerLine[]): string {
  if (!lines.length) return "0";
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    debit += Number(line.debit) || 0;
    credit += Number(line.credit) || 0;
  }
  const first = lines[0];
  const last = lines[lines.length - 1];
  return `${lines.length}:${first?.id ?? ""}:${last?.id ?? ""}:${debit.toFixed(2)}:${credit.toFixed(2)}`;
}

function notifyLedgerReady() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("financeiag-ledger-changed", {
      detail: { phase: "ledger", silent: true },
    }),
  );
}

function applyRemoteBalanceRows(remote: Array<Partial<AccountBalance>>): boolean {
  const rows: AccountBalance[] = [];
  for (const row of remote) {
    const accountId = String(row.accountId || "").trim();
    const code = String(row.code || "").trim();
    if (!accountId && !code) continue;
    const type = (String(row.type || "Asset") as AccountType) || "Asset";
    rows.push({
      accountId: accountId || code,
      code,
      name: String(row.name || code),
      type,
      group: String(row.group || ""),
      debit: Number(row.debit) || 0,
      credit: Number(row.credit) || 0,
      balance: Number(row.balance) || 0,
    });
  }
  if (!rows.length) return false;
  setServerAccountBalances(rows);
  return true;
}

function writeMemoryRecords(moduleSlug: string, entityKey: string, records: ManagerRecord[]) {
  setMemoryRecords(moduleSlug, entityKey, records);
}

/**
 * Every module/entity the signed-in role may edit — used so empty browsers still
 * discover Postgres data. Modules the role cannot view are skipped so their
 * records never enter browser memory (the API denies them too).
 */
export function enabledTabFilter(tabs: string[] | null | undefined): Set<string> | null {
  // null means "do not narrow". An empty or missing list is a setting that has
  // not loaded, never an instruction to sync nothing -- narrowing on it would
  // turn a slow boot into an empty app, which is the worse failure by far.
  if (!Array.isArray(tabs) || !tabs.length) return null;
  return new Set(tabs.filter(Boolean));
}

async function catalogRecordKeys(): Promise<Array<{ module: string; entity: string }>> {
  let enabled: Set<string> | null = null;
  try {
    const { loadEnabledTabs } = await import("@/lib/manager-settings");
    enabled = enabledTabFilter(loadEnabledTabs() as unknown as string[]);
  } catch {
    /* fall back to the full catalogue rather than syncing nothing */
  }

  const seen = new Set<string>();
  const out: Array<{ module: string; entity: string }> = [];
  for (const slug of MODULE_SLUGS as readonly ModuleSlug[]) {
    const config = moduleConfigs[slug];
    if (!config) continue;
    if (enabled && !enabled.has(slug)) continue;
    if (!moduleAccessAllowed(slug)) continue;
    for (const def of entityDefinitions(slug)) {
      if (!def.key || def.key === "hr-desk" || def.key === "project-desk") continue;
      if (!moduleAccessAllowed(slug, def.key)) continue;
      // Entity-first so a cross-listed page hydrates the bucket that owns it.
      const storage = storageSlugForEntity(slug, def.key);
      const id = `${storage}:${def.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ module: storage, entity: def.key });
    }
  }
  return out;
}

/** Drop remote/memory keys whose module the current role cannot view. */
function filterKeysByAccess(
  keys: Array<{ module: string; entity: string }>,
): Array<{ module: string; entity: string }> {
  if (typeof window === "undefined") return keys;
  return keys.filter(({ module: storage, entity }) => {
    const slugs = routeSlugsForStorageBucket(storage, entity);
    if (!slugs.length) return false;
    // Several routes can share one storage bucket (banking + receipts-payments
    // both store under "banking"), and they are SEPARATE permission pages.
    // Checking only the first match meant a role granted Receipts & Payments
    // but not Banking could save a payment and then never hydrate it back —
    // the row stayed in Postgres but vanished from the UI on refresh.
    return slugs.some((slug) => moduleAccessAllowed(slug, entity));
  });
}

async function pullRemoteRecordKeys(): Promise<Array<{ module: string; entity: string }>> {
  try {
    const res = await apiFetch("/api/records", { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: Array<{ module?: string; entity?: string }>;
    };
    if (!Array.isArray(json.data)) return [];
    return json.data
      .filter((row) => row.module && row.entity)
      .map((row) => ({ module: String(row.module), entity: String(row.entity) }));
  } catch {
    return [];
  }
}

function mergeRecordKeys(
  ...lists: Array<Array<{ module: string; entity: string }>>
): Array<{ module: string; entity: string }> {
  const seen = new Set<string>();
  const out: Array<{ module: string; entity: string }> = [];
  for (const list of lists) {
    for (const row of list) {
      const id = `${row.module}:${row.entity}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(row);
    }
  }
  return out;
}

/** Let the browser paint / handle sidebar clicks between hydrate chunks. */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), { timeout: 48 });
      return;
    }
    window.setTimeout(resolve, 0);
  });
}

function storageSlugForPathModule(seg: string): string | null {
  if (!(MODULE_SLUGS as readonly string[]).includes(seg)) return null;
  return storageSlugForRoute(seg);
}

/**
 * Entities needed for the open route so first paint is useful.
 * Approval-desk badge entities are loaded right after unlock (see
 * `badgeRecordKeys`) so they cannot stall interactive boot.
 *
 * Reports compute from ledger lines only — do not pull every report-view
 * "entity". Source documents are only prioritized when the journal is empty.
 */
function priorityRecordKeys(
  all: Array<{ module: string; entity: string }>,
): Array<{ module: string; entity: string }> {
  if (typeof window === "undefined") return all.slice(0, 12);
  const seg = window.location.pathname.replace(/^\//, "").split("/")[0] || "";
  const want = new Set<string>();

  const storage = storageSlugForPathModule(seg);
  if (storage && storage !== "reports") {
    for (const row of all) {
      if (row.module === storage) want.add(`${row.module}:${row.entity}`);
    }
    // Lists this route cross-links but does not own (Inventory → Production
    // Orders) live in another bucket; first paint still needs them.
    for (const def of entityDefinitions(seg as ModuleSlug)) {
      if (!def.key) continue;
      const owner = storageSlugForEntity(seg, def.key);
      if (owner !== storage) want.add(`${owner}:${def.key}`);
    }
  }

  for (const row of all) {
    if (
      row.module === "projects" &&
      (row.entity === "projects" ||
        row.entity === "milestones" ||
        row.entity === "tasks" ||
        row.entity === "contractors")
    ) {
      want.add(`${row.module}:${row.entity}`);
    }
  }

  // Contractor invoices workbench needs purchase invoices early.
  if (typeof window !== "undefined") {
    const view = new URLSearchParams(window.location.search).get("view") || "";
    if (view === "contractor-invoices" || seg === "projects") {
      for (const row of all) {
        if (
          row.module === "purchases" &&
          (row.entity === "purchase-invoices" || row.entity === "bills")
        ) {
          want.add(`${row.module}:${row.entity}`);
        }
        if (row.module === "projects" && row.entity === "contractors") {
          want.add(`${row.module}:${row.entity}`);
        }
      }
    }
    // Prefetch SearchablePicker sources for the open ?view= entity.
    if (view) {
      for (const row of formPickerRecordKeys(view)) {
        want.add(`${row.module}:${row.entity}`);
      }
    }
  }

  // Banking payment/receipt forms need payees + open bills/invoices on first paint.
  if (seg === "banking" || storage === "banking") {
    for (const row of all) {
      if (
        (row.module === "purchases" &&
          (row.entity === "suppliers" ||
            row.entity === "purchase-invoices" ||
            row.entity === "bills")) ||
        (row.module === "projects" && row.entity === "contractors") ||
        (row.module === "sales" &&
          (row.entity === "customers" ||
            row.entity === "sales-invoices" ||
            row.entity === "invoices" ||
            row.entity === "late-payment-fees")) ||
        (row.module === "banking" && row.entity === "bank-and-cash-accounts")
      ) {
        want.add(`${row.module}:${row.entity}`);
      }
    }
  }

  // Purchases / sales forms need party masters early for payee pickers.
  if (seg === "purchases" || storage === "purchases") {
    for (const row of all) {
      if (
        (row.module === "purchases" && row.entity === "suppliers") ||
        (row.module === "projects" && row.entity === "contractors")
      ) {
        want.add(`${row.module}:${row.entity}`);
      }
    }
  }
  if (seg === "sales" || storage === "sales") {
    for (const row of all) {
      if (row.module === "sales" && row.entity === "customers") {
        want.add(`${row.module}:${row.entity}`);
      }
    }
  }

  // Fleet forms pick vehicles from Assets → Fixed Assets.
  if (seg === "fleet" || storage === "fleet") {
    for (const row of all) {
      if (row.module === "assets" && row.entity === "fixed-assets") {
        want.add(`${row.module}:${row.entity}`);
      }
      if (
        row.module === "fleet" &&
        (row.entity === "vehicles" || row.entity === "drivers")
      ) {
        want.add(`${row.module}:${row.entity}`);
      }
    }
  }

  const ledgerEmpty = getMemoryLedgerLines().length === 0;
  if (ledgerEmpty && (seg === "reports" || seg === "accounts")) {
    for (const row of all) {
      if (
        (row.module === "banking" &&
          (row.entity === "receipts" ||
            row.entity === "payments" ||
            row.entity === "bank-and-cash-accounts" ||
            row.entity === "inter-account-transfers")) ||
        (row.module === "sales" &&
          (row.entity === "sales-invoices" ||
            row.entity === "credit-notes" ||
            row.entity === "invoices")) ||
        (row.module === "purchases" &&
          (row.entity === "purchase-invoices" ||
            row.entity === "bills" ||
            row.entity === "debit-notes")) ||
        (row.module === "accounts" &&
          (row.entity === "journal-entries" || row.entity === "chart-of-accounts"))
      ) {
        want.add(`${row.module}:${row.entity}`);
      }
    }
  }

  if (want.size === 0) {
    if (seg === "reports") {
      return all.filter(
        (row) => row.module === "accounts" && row.entity === "chart-of-accounts",
      );
    }
    return all.slice(0, 12);
  }

  const priority: Array<{ module: string; entity: string }> = [];
  const seen = new Set<string>();
  for (const row of all) {
    const id = `${row.module}:${row.entity}`;
    if (!want.has(id) || seen.has(id)) continue;
    seen.add(id);
    priority.push(row);
  }
  return priority;
}

/**
 * Approval desk + requestor attention — load immediately after interactive unlock
 * so the sidebar badge fills in without blocking first paint.
 * Keep in sync with DESK_ENTITY_MODULES in approval-desk.ts.
 */
function badgeRecordKeys(): Array<{ module: string; entity: string }> {
  return [
    { module: "projects", entity: "payment-requests" },
    { module: "requests", entity: "oral-payment-requests" },
    { module: "requests", entity: "general-requests" },
    { module: "fleet", entity: "fuel-requests" },
    { module: "fleet", entity: "trip-requests" },
    { module: "fleet", entity: "maintenance-requests" },
    { module: "projects", entity: "equipment-and-vehicle-requests" },
    { module: "projects", entity: "document-requests" },
    { module: "payroll", entity: "leave-requests" },
    { module: "payroll", entity: "payroll-runs" },
  ];
}

function notifyHydrateUi(detail?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("financeiag-records-changed", {
      detail: { silent: true, ...(detail || {}) },
    }),
  );
  window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
  window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
  window.dispatchEvent(new CustomEvent(DB_SYNC_READY_EVENT));
}

/** Optimistic concurrency tokens from GET/PUT /api/records/:module/:entity */
const entityRevisions = new Map<string, string>();

/**
 * What the upstream will actually accept for a collection, as reported by
 * `GET /api/records/:module/:entity`.
 *
 * This is capability, not permission, and the two are different questions. A
 * screen can be perfectly permitted and still have no write path: a production
 * run's stage moves through `/advance` and `/complete` and not through a flat
 * PATCH, a production order has no update verb at all, a yield report is
 * arithmetic over runs. The records API has always computed and returned this
 * and nothing read it, so New / Edit / Delete were drawn from RBAC alone — a
 * shift lead could open a fifteen-field form on a collection that cannot be
 * updated and only learn that on save.
 *
 * Absent means unknown, and unknown means "allow" — the legacy backend sends no
 * capabilities and everything there is writable, so a missing answer must not
 * silently disable buttons that work.
 */
export type EntityCapabilities = {
  create: boolean;
  update: boolean;
  delete: boolean;
  /**
   * Verbs beyond create/update/delete that the owning service exposes — start
   * a roast, complete a run, end a downtime event. Absent for the legacy
   * backend, which has none, so absent means "this collection has no extra
   * verbs" rather than "unknown".
   */
  actions?: EntityAction[];
};

/** One such verb, as the browser sees it. Mirrors RecordAction minus `run`. */
export type EntityAction = {
  id: string;
  label: string;
  doneLabel: string;
  permission?: string;
  /** Statuses the verb applies to; absent means any status. */
  whenStatus?: string[];
};

/** The event a screen listens for to re-read what a collection now allows. */
export const CAPABILITIES_CHANGED_EVENT = "financeiag-capabilities-changed";

const entityCapabilities = new Map<string, EntityCapabilities>();

function rememberEntityCapabilities(
  moduleSlug: string,
  entityKey: string,
  capabilities: EntityCapabilities,
) {
  const key = entityRevisionKey(moduleSlug, entityKey);
  const previous = entityCapabilities.get(key);
  entityCapabilities.set(key, capabilities);
  // Only announce a real change. This fires on every list read, and a screen
  // that re-renders on each of them would flicker for no reason.
  if (typeof window !== "undefined" && !sameCapabilities(previous, capabilities)) {
    window.dispatchEvent(new CustomEvent(CAPABILITIES_CHANGED_EVENT));
  }
}

function sameCapabilities(
  a: EntityCapabilities | undefined,
  b: EntityCapabilities,
): boolean {
  if (!a) return false;
  return (
    a.create === b.create &&
    a.update === b.update &&
    a.delete === b.delete &&
    (a.actions || []).map((x) => x.id).join(",") ===
      (b.actions || []).map((x) => x.id).join(",")
  );
}

/** Null when the upstream has not said — callers treat that as "allowed". */
export function knownEntityCapabilities(
  moduleSlug: string,
  entityKey: string,
): EntityCapabilities | null {
  return entityCapabilities.get(entityRevisionKey(moduleSlug, entityKey)) ?? null;
}

/** Optimistic concurrency token from GET/PUT /api/ledger/lines */
let ledgerLinesRevision: string | null = null;

function entityRevisionKey(moduleSlug: string, entityKey: string) {
  return `${moduleSlug}:${entityKey}`;
}

function revisionParts(rev: string): { count: number; maxMs: number } | null {
  const parts = rev.split(":");
  if (parts.length !== 2) return null;
  const count = Number(parts[0]);
  const maxMs = Number(parts[1]);
  if (!Number.isFinite(count) || !Number.isFinite(maxMs)) return null;
  return { count, maxMs };
}

/** True when `a` is strictly newer than `b` (by updated_at ms, then count). */
function isRevisionNewer(a: string, b: string): boolean {
  const pa = revisionParts(a);
  const pb = revisionParts(b);
  if (!pa) return false;
  if (!pb) return true;
  if (pa.maxMs !== pb.maxMs) return pa.maxMs > pb.maxMs;
  return pa.count > pb.count;
}

function rememberLedgerLinesRevision(revision: string | undefined | null) {
  if (!revision) return;
  if (ledgerLinesRevision && isRevisionNewer(ledgerLinesRevision, revision)) return;
  ledgerLinesRevision = revision;
}

/** Adopt a ledger revision from settle / source upsert responses. */
export function adoptLedgerLinesRevision(revision: string | undefined | null) {
  rememberLedgerLinesRevision(revision);
}

export function currentLedgerLinesRevision(): string | null {
  return ledgerLinesRevision;
}

function rememberEntityRevision(
  moduleSlug: string,
  entityKey: string,
  revision: string | undefined | null,
) {
  if (!revision) return;
  const key = entityRevisionKey(moduleSlug, entityKey);
  const prev = entityRevisions.get(key);
  // Never adopt an older revision from a stale GET after a successful PUT.
  if (prev && isRevisionNewer(prev, revision)) return;
  entityRevisions.set(key, revision);
}

export function knownEntityRevision(
  moduleSlug: string,
  entityKey: string,
): string | null {
  return entityRevisions.get(entityRevisionKey(moduleSlug, entityKey)) ?? null;
}

/**
 * Drop the cached revision for a collection.
 * An item-level write (POST/PATCH/DELETE on one row) moves the collection
 * revision without telling us the new value, so the one we hold is stale: the
 * next collection PUT would 409 and the next GET would get a false 304.
 */
function forgetEntityRevision(moduleSlug: string, entityKey: string) {
  entityRevisions.delete(entityRevisionKey(moduleSlug, entityKey));
}

export type ItemWriteResult =
  | { ok: true; record: ManagerRecord | null; ledgerPosted?: boolean; ledgerError?: string }
  | { ok: false; error: string; code?: string };

type ItemWriteBody = {
  ok?: boolean;
  error?: string | { message?: string };
  code?: string;
  data?: ManagerRecord;
  ledgerPosted?: boolean;
  ledgerError?: string;
};

function itemWriteError(status: number, body: ItemWriteBody | null): string {
  const raw = body?.error;
  const detail =
    typeof raw === "string" ? raw : raw && typeof raw === "object" ? raw.message || "" : "";
  return detail || `Save failed (HTTP ${status})`;
}

function recordsPath(moduleSlug: string, entityKey: string, id?: string) {
  const base = `/api/records/${encodeURIComponent(moduleSlug)}/${encodeURIComponent(entityKey)}`;
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}

/**
 * One row in, one row out — the item endpoints instead of a whole-collection PUT.
 *
 * The collection PUT sends every row on every keystroke-sized change, so a save
 * costs O(collection). At real data volumes that is megabytes per save and a
 * full table rewrite server-side. These go through the same persist queue as
 * the collection writes so `awaitEntityPersist` still blocks hydrate — without
 * that, a concurrent refresh drops the row that was just written.
 */
async function itemWrite(
  moduleSlug: string,
  entityKey: string,
  request: { method: "POST" | "PATCH" | "DELETE"; id?: string; payload?: unknown },
  applyToMemory: (current: ManagerRecord[], saved: ManagerRecord | null) => ManagerRecord[],
): Promise<ItemWriteResult> {
  // One key per logical create, reused across every retry of THIS attempt —
  // that's what lets the server tell "the network dropped the response but
  // the write landed, so a retry arrived" apart from "the user clicked
  // Save twice" (the latter is a separate itemWrite() call with its own key,
  // caught client-side by the in-flight guards in module-entity-records.tsx).
  const idempotencyKey = request.method === "POST" ? crypto.randomUUID() : undefined;
  return enqueuePersist(recordsPersistKey(moduleSlug, entityKey), async () => {
    lastRecordsPersistError = "";
    let lastError = "";
    for (let attempt = 0; attempt < PERSIST_RETRIES; attempt++) {
      try {
        const res = await apiFetch(recordsPath(moduleSlug, entityKey, request.id), {
          method: request.method,
          headers: {
            "Content-Type": "application/json",
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          },
          timeoutMs: PERSIST_TIMEOUT_MS,
          ...(request.payload === undefined
            ? {}
            : { body: JSON.stringify(request.payload) }),
        });
        const body = (await res.json().catch(() => null)) as ItemWriteBody | null;
        if (!res.ok) {
          const message = itemWriteError(res.status, body);
          // Validation, permission and chain refusals are verdicts, not blips —
          // retrying only delays the message the user needs to see.
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            lastRecordsPersistError = message;
            return { ok: false, error: message, code: body?.code };
          }
          throw new Error(message);
        }
        const saved = (body?.data as ManagerRecord | undefined) ?? null;
        // A 2xx with no echoed row is not proof of a durable write — only the
        // API's own echo (after its transaction commits) confirms the row
        // actually landed in Postgres. DELETE has nothing to echo; POST/PATCH
        // do, so a missing echo there is treated as a retryable failure
        // instead of trusting the client's own optimistic payload as "saved".
        if (request.method !== "DELETE" && !saved) {
          throw new Error("Save did not return a stored record — the write may not be durable.");
        }
        forgetEntityRevision(moduleSlug, entityKey);
        setMemoryRecords(
          moduleSlug,
          entityKey,
          applyToMemory(getMemoryRecords(moduleSlug, entityKey), saved),
        );
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("financeiag-records-changed", {
              detail: { module: moduleSlug, entity: entityKey },
            }),
          );
        }
        return {
          ok: true,
          record: saved,
          ledgerPosted: body?.ledgerPosted === true,
          ledgerError: body?.ledgerError || "",
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        clearDbSyncCache();
        if (/\(401\)/.test(lastError) || /Sign in required/i.test(lastError)) break;
        if (attempt < PERSIST_RETRIES - 1) {
          await sleep(400 * (attempt + 1) * (attempt + 1));
        }
      }
    }
    lastRecordsPersistError = lastError || "Could not save to the database.";
    notifyPersistFailed({
      kind: "records",
      key: `${moduleSlug}/${entityKey}`,
      error: lastRecordsPersistError,
    });
    return { ok: false, error: lastRecordsPersistError };
  });
}

/** POST one new row. The server assigns nothing the client did not send but its own stamps. */
export async function createRecordInDb(
  moduleSlug: string,
  entityKey: string,
  record: ManagerRecord,
): Promise<ItemWriteResult> {
  if (FRONTEND_ONLY) {
    const current = getMemoryRecords(moduleSlug, entityKey);
    const next = [record, ...current.filter((row) => row.id !== record.id)];
    setMemoryRecords(moduleSlug, entityKey, next);
    return { ok: true, record };
  }
  return itemWrite(
    moduleSlug,
    entityKey,
    { method: "POST", payload: record },
    (current, saved) => {
      // itemWrite guarantees `saved` is non-null here — a POST only reaches
      // applyToMemory after the server echoed the stored row.
      const row = saved as ManagerRecord;
      return [row, ...current.filter((existing) => existing.id !== row.id)];
    },
  );
}

/** PATCH only the changed fields — the server merges onto the stored row. */
export async function patchRecordInDb(
  moduleSlug: string,
  entityKey: string,
  id: string,
  patch: Record<string, string>,
): Promise<ItemWriteResult> {
  if (FRONTEND_ONLY) {
    const current = getMemoryRecords(moduleSlug, entityKey);
    const next = current.map((row) =>
      row.id === id
        ? ({ ...row, ...patch, id, updatedAt: new Date().toISOString() } as ManagerRecord)
        : row,
    );
    const saved = next.find((row) => row.id === id) || ({ id, ...patch } as ManagerRecord);
    setMemoryRecords(moduleSlug, entityKey, next);
    return { ok: true, record: saved };
  }
  return itemWrite(
    moduleSlug,
    entityKey,
    { method: "PATCH", id, payload: patch },
    // itemWrite guarantees `saved` is non-null here — same as createRecordInDb.
    (current, saved) => current.map((row) => (row.id === id ? (saved as ManagerRecord) : row)),
  );
}

/** DELETE one row. */
export async function deleteRecordInDb(
  moduleSlug: string,
  entityKey: string,
  id: string,
): Promise<ItemWriteResult> {
  if (FRONTEND_ONLY) {
    const current = getMemoryRecords(moduleSlug, entityKey);
    setMemoryRecords(
      moduleSlug,
      entityKey,
      current.filter((row) => row.id !== id),
    );
    return { ok: true, record: null };
  }
  return itemWrite(
    moduleSlug,
    entityKey,
    { method: "DELETE", id },
    (current) => current.filter((row) => row.id !== id),
  );
}

async function pushRecords(
  moduleSlug: string,
  entityKey: string,
  records: ManagerRecord[],
  options?: {
    allowEmpty?: boolean;
    mode?: "merge" | "replace";
    removeIds?: string[];
  },
): Promise<ManagerRecord[]> {
  const expectedRevision =
    entityRevisions.get(entityRevisionKey(moduleSlug, entityKey)) ?? null;
  // Omit mode unless the caller set it — the Go API chooses merge vs replace.
  const res = await apiFetch(
    `/api/records/${encodeURIComponent(moduleSlug)}/${encodeURIComponent(entityKey)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      timeoutMs: PERSIST_TIMEOUT_MS,
      body: JSON.stringify({
        records,
        ...(options?.mode ? { mode: options.mode } : {}),
        ...(expectedRevision ? { expectedRevision } : {}),
        ...(options?.allowEmpty ? { allowEmpty: true } : {}),
        ...(options?.removeIds?.length ? { removeIds: options.removeIds } : {}),
      }),
    },
  );
  type PushBody = {
    error?: string;
    code?: string;
    revision?: string;
    data?: ManagerRecord[];
  };
  let json: PushBody | null = null;
  try {
    json = (await res.json()) as PushBody;
  } catch {
    json = null;
  }
  if (res.status === 409) {
    rememberEntityRevision(moduleSlug, entityKey, json?.revision);
    const err = new Error(
      `Conflict saving ${moduleSlug}/${entityKey}: collection changed in another session`,
    ) as Error & { code?: string; remote?: ManagerRecord[] };
    err.code = "REVISION_CONFLICT";
    err.remote = Array.isArray(json?.data) ? json.data : undefined;
    throw err;
  }
  if (!res.ok) {
    const detail = json?.error ? `: ${json.error}` : "";
    throw new Error(`Failed to save ${moduleSlug}/${entityKey} (${res.status})${detail}`);
  }
  rememberEntityRevision(moduleSlug, entityKey, json?.revision);
  // A successful save always echoes the stored collection (handleRecordsPut
  // writes `data` after the transaction commits). A 2xx without it means the
  // body was truncated, rewritten by a proxy, or never came from the API — we
  // have no proof the write landed, so it must not count as durable. Treating
  // it as success is how a payment reported "saved" and was gone on refresh.
  if (!json || !Array.isArray(json.data)) {
    throw new Error(
      `Save of ${moduleSlug}/${entityKey} was not confirmed by the API (${res.status}) — the response carried no saved records`,
    );
  }
  return json.data;
}

/**
 * Options for durable record writes.
 * The Go API owns merge / wipe / removeIds / default mode. The client only sends intent
 * and adopts the `data` returned by a successful PUT.
 */
export type PersistRecordsOptions = {
  /** Drop these ids even if they still exist remotely (server applies). */
  removeIds?: string[];
  /**
   * Optional override. When omitted, the API defaults to merge (or replace for
   * documents/history and documents/deleted-records).
   */
  mode?: "merge" | "replace";
  /** Allow writing an empty collection (admin wipe / system reset only). */
  allowEmpty?: boolean;
};

function normalizeServerRecords(rows: ManagerRecord[]): ManagerRecord[] {
  return rows.map((row) => {
    const next: Record<string, string> = {
      id: String(row.id || ""),
      createdAt: String(row.createdAt || new Date().toISOString()),
      updatedAt: String(row.updatedAt || new Date().toISOString()),
    };
    for (const [k, v] of Object.entries(row)) {
      if (v == null || k in next) continue;
      next[k] = typeof v === "string" ? v : String(v);
    }
    return next as ManagerRecord;
  });
}

async function pullRecords(
  moduleSlug: string,
  entityKey: string,
  options?: { force?: boolean },
): Promise<ManagerRecord[] | null> {
  const url = `/api/records/${encodeURIComponent(moduleSlug)}/${encodeURIComponent(entityKey)}`;
  const knownRev = entityRevisions.get(entityRevisionKey(moduleSlug, entityKey));
  const headers: HeadersInit = {};
  // Bank & Cash closing balances are derived on each GET (not part of the
  // collection revision). A 304 would keep stale tab memory with wrong
  // closing figures even after the API formula was fixed.
  const liveEnriched =
    moduleSlug === "banking" && entityKey === "bank-and-cash-accounts";
  if (knownRev && !options?.force && !liveEnriched) {
    headers["If-None-Match"] = knownRev;
  }

  let res = await apiFetch(url, { cache: "no-store", headers });
  // One retry — common right after login while cookie/Bearer settle.
  if (!res.ok && res.status !== 304 && (res.status === 401 || res.status >= 500)) {
    await new Promise((r) => setTimeout(r, 400));
    res = await apiFetch(url, {
      cache: "no-store",
      headers: options?.force || liveEnriched ? {} : headers,
    });
  }
  if (res.status === 304) {
    // Unchanged — keep memory, skip JSON parse/write.
    return getMemoryRecords(moduleSlug, entityKey);
  }
  if (!res.ok) return null;
  const json = (await res.json()) as {
    data?: ManagerRecord[];
    revision?: string;
    capabilities?: EntityCapabilities;
  };
  // Recorded before the staleness check below: what a collection can do does
  // not go stale the way its rows do, and a screen that has just learned a
  // verb exists should not have to wait for the next read to be told again.
  if (json.capabilities) {
    rememberEntityCapabilities(moduleSlug, entityKey, json.capabilities);
  }
  // Stale in-flight GET: a PUT finished while this request was open and already
  // advanced the revision. Never return the older payload — callers would wipe
  // the just-saved row from memory (payment shows, then vanishes).
  const knownAfter = entityRevisions.get(entityRevisionKey(moduleSlug, entityKey));
  if (
    json.revision &&
    knownAfter &&
    isRevisionNewer(knownAfter, json.revision)
  ) {
    return getMemoryRecords(moduleSlug, entityKey);
  }
  rememberEntityRevision(moduleSlug, entityKey, json.revision);
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * Apply a successful records GET into tab memory.
 * Postgres is the source of truth — a successful empty payload clears the tab.
 * A failed GET (null) keeps local rows for UI only until the next successful load.
 * Never replace memory with a payload that is older than the revision we already know.
 */
function commitRemoteRecordsToMemory(
  moduleSlug: string,
  entityKey: string,
  remote: ManagerRecord[],
  remoteRevision?: string | null,
): ManagerRecord[] {
  const known = knownEntityRevision(moduleSlug, entityKey);
  if (remoteRevision && known && isRevisionNewer(known, remoteRevision)) {
    return getMemoryRecords(moduleSlug, entityKey);
  }
  writeMemoryRecords(moduleSlug, entityKey, remote);
  return remote;
}

/**
 * Apply a successful ledger GET. Empty journal from Postgres wins.
 */
function commitRemoteLedgerLinesToMemory(remote: LedgerLine[]): LedgerLine[] {
  setMemoryLedgerLines(remote);
  return remote;
}

/**
 * Pull one entity from Postgres into memory immediately.
 * Used by list pages on refresh — API/Postgres is the only source of truth.
 * A failed GET keeps local rows for display only. Successful GET (including [])
 * always replaces memory.
 * Waits for any in-flight save for this entity so a stale GET cannot overwrite
 * rows that are still being persisted.
 */
export async function hydrateEntityFromDatabase(
  moduleSlug: string,
  entityKey: string,
  options?: { force?: boolean },
): Promise<ManagerRecord[]> {
  if (typeof window === "undefined") return [];
  try {
    await awaitEntityPersist(moduleSlug, entityKey);
    const local = getMemoryRecords(moduleSlug, entityKey);
    const knownBefore = knownEntityRevision(moduleSlug, entityKey);
    const remote = await pullRecords(moduleSlug, entityKey, options);
    // Save started or finished during the GET — keep post-persist memory.
    if (isEntityPersistActive(moduleSlug, entityKey)) {
      await awaitEntityPersist(moduleSlug, entityKey);
      return getMemoryRecords(moduleSlug, entityKey);
    }
    const knownAfter = knownEntityRevision(moduleSlug, entityKey);
    if (
      knownBefore &&
      knownAfter &&
      isRevisionNewer(knownAfter, knownBefore) &&
      // Revision advanced while GET was in flight (successful PUT). Trust memory.
      getMemoryRecords(moduleSlug, entityKey).length > 0
    ) {
      // pullRecords should already have discarded a stale body; this is a belt check.
      if (
        Array.isArray(remote) &&
        remote.length < getMemoryRecords(moduleSlug, entityKey).length
      ) {
        return getMemoryRecords(moduleSlug, entityKey);
      }
    }
    // Network / auth failure — keep whatever is already in the tab.
    if (remote === null) {
      if (local.length) {
        notifyPersistFailed({
          kind: "hydrate",
          key: `${moduleSlug}/${entityKey}`,
          error:
            "Could not load this list from the database. Showing last tab data until refresh succeeds.",
        });
      }
      return local;
    }
    return commitRemoteRecordsToMemory(moduleSlug, entityKey, remote, knownAfter);
  } catch {
    return getMemoryRecords(moduleSlug, entityKey);
  }
}

type LedgerLinesPageResume = {
  lines: LedgerLine[];
  nextOffset: number;
  hasMore: boolean;
};

type LedgerLinesPullResult = {
  lines: LedgerLine[];
  nextOffset: number;
  hasMore: boolean;
};

/**
 * Finish remaining journal pages after interactive boot unlocked.
 * Progressive memory updates; never clobber an in-flight ledger save.
 */
function scheduleBackgroundJournalHydrate(resume: LedgerLinesPageResume) {
  if (!resume.hasMore) return;
  const previous = backgroundJournalHydrate;
  backgroundJournalHydrate = (async () => {
    await previous?.catch(() => undefined);
    try {
      await awaitLedgerLinesPersist();
      if (isLedgerLinesPersistActive()) {
        await awaitLedgerLinesPersist();
        return;
      }
      const pulled = await pullLedgerLinesPaged({
        progressive: true,
        resume,
      });
      if (isLedgerLinesPersistActive()) {
        await awaitLedgerLinesPersist();
        return;
      }
      if (pulled) {
        commitRemoteLedgerLinesToMemory(pulled.lines);
        if (pulled.lines.length) lastHydrateHadRemoteData = true;
        notifyLedgerReady();
        notifyHydrateUi({ phase: "journal" });
      }
    } catch {
      /* keep page-1 journal */
    }
  })();
  void backgroundJournalHydrate;
}

/**
 * Pull ledger lines in pages so first paint is not blocked on a multi-MB dump.
 * Progressive: writes memory + notifies after each page when `progressive` is true.
 */
async function pullLedgerLinesPaged(options?: {
  pageSize?: number;
  progressive?: boolean;
  /** Resume after bootstrap already delivered the first page. */
  resume?: LedgerLinesPageResume;
  /** Stop after this many newly fetched pages (resume seed does not count). */
  maxPages?: number;
}): Promise<LedgerLinesPullResult | null> {
  const pageSize = options?.pageSize ?? 4000;
  const progressive = options?.progressive ?? true;
  const maxPages = options?.maxPages;
  const all: LedgerLine[] = options?.resume ? [...options.resume.lines] : [];
  let offset = options?.resume?.nextOffset ?? 0;
  let pages = 0;
  let hasMore = options?.resume ? options.resume.hasMore : true;

  if (progressive && all.length) {
    setMemoryLedgerLines(all.slice());
    notifyLedgerReady();
  }

  if (options?.resume && !options.resume.hasMore) {
    return { lines: all, nextOffset: offset, hasMore: false };
  }

  for (;;) {
    const res = await apiFetch(
      `/api/ledger/lines?limit=${pageSize}&offset=${offset}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      if (pages === 0 && all.length === 0) return null;
      break;
    }
    const json = (await res.json()) as {
      data?: LedgerLine[];
      hasMore?: boolean;
      nextOffset?: number;
      revision?: string;
    };
    if (json.revision) rememberLedgerLinesRevision(json.revision);
    const chunk = Array.isArray(json.data) ? json.data : [];
    all.push(...chunk);
    pages += 1;
    hasMore = Boolean(json.hasMore) && chunk.length > 0;
    offset =
      typeof json.nextOffset === "number"
        ? json.nextOffset
        : offset + chunk.length;

    if (progressive && all.length) {
      setMemoryLedgerLines(all.slice());
      notifyLedgerReady();
    }

    if (!hasMore) break;
    if (typeof maxPages === "number" && pages >= maxPages) break;
    // Safety valve for pathological loops.
    if (pages > 500) break;
  }

  return { lines: all, nextOffset: offset, hasMore };
}

/** Silent pull of chart of accounts + ledger lines (no full-app hydrate). */
export async function hydrateLedgerFromDatabase(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!(await isDbSyncAvailable())) return false;
  let changed = false;
  try {
    await awaitLedgerLinesPersist();
    // Balances are a small SQL aggregate — paint reports before the full journal lands.
    // First journal page only; remainder continues in background (same as boot hydrate).
    const linesPromise = pullLedgerLinesPaged({ progressive: true, maxPages: 1 });
    const [acctRes, balRes] = await Promise.all([
      apiFetch("/api/ledger/accounts", { cache: "no-store" }),
      apiFetch("/api/ledger/balances", { cache: "no-store" }),
    ]);
    if (acctRes.ok) {
      const json = (await acctRes.json()) as { data?: LedgerAccount[] };
      const remote = Array.isArray(json.data) ? json.data : [];
      const cleaned = remote.filter(
        (acct) => !/^imported$/i.test((acct.group || "").trim()),
      );
      const local = getMemoryLedgerAccounts();
      if (arraysDiffer(cleaned, local)) {
        setMemoryLedgerAccounts(cleaned);
        changed = true;
      }
      if (cleaned.length && cleaned.length < remote.length) {
        await persistLedgerAccountsToDb(cleaned);
      }
    }
    if (balRes.ok) {
      const json = (await balRes.json()) as { data?: Array<Partial<AccountBalance>> };
      if (applyRemoteBalanceRows(Array.isArray(json.data) ? json.data : [])) {
        changed = true;
        notifyLedgerReady();
      }
    }
    const remote = await linesPromise;
    if (isLedgerLinesPersistActive()) {
      await awaitLedgerLinesPersist();
      return changed;
    }
    if (remote) {
      const local = getMemoryLedgerLines();
      // Successful API payload wins — including an empty journal.
      if (ledgerLinesFingerprint(remote.lines) !== ledgerLinesFingerprint(local)) {
        setMemoryLedgerLines(remote.lines);
        changed = true;
      }
      if (remote.hasMore) {
        scheduleBackgroundJournalHydrate({
          lines: remote.lines,
          nextOffset: remote.nextOffset,
          hasMore: true,
        });
      }
    }
    if (changed) notifyLedgerReady();
  } catch {
    /* ignore */
  }
  return changed;
}

/** Silent pull of one AppSetting key into memory. */
export async function hydrateSettingFromDatabase(key: string): Promise<boolean> {
  if (typeof window === "undefined" || !key) return false;
  // Auth identity is JWT/tab-scoped — never adopt shared financeiag-session.
  if (key === "financeiag-session") return false;
  try {
    const settingPersist = persistChains.get(`setting:${key}`);
    if (settingPersist) await settingPersist.catch(() => undefined);
    const remote = await pullSetting(key);
    if (remote === undefined || remote === null) return false;
    if (persistChains.has(`setting:${key}`)) {
      await persistChains.get(`setting:${key}`)?.catch(() => undefined);
      return false;
    }
    const local = hasMemorySetting(key) ? getMemorySetting<unknown>(key, null) : undefined;
    // Successful API payload wins (including empty lists). Never push browser
    // leftovers back into Postgres from hydrate.
    if (stableJson(remote) === stableJson(local)) return false;
    setMemorySetting(key, remote);
    return true;
  } catch {
    return false;
  }
}

/**
 * Flush leftover scheduled writes, then wait for every in-flight persist.
 * Callers (sample load, demo, boot) must await this before reload.
 */
export async function flushPendingPersists(): Promise<void> {
  const pending = [...persistRuns.entries()];
  for (const [key, timer] of persistTimers) {
    clearTimeout(timer);
    persistTimers.delete(key);
  }
  persistRuns.clear();
  await Promise.all(
    pending.map(async ([, run]) => {
      try {
        await run();
      } catch {
        /* ignore */
      }
    }),
  );
  await awaitInFlightPersists();
}

let unloadFlushBound = false;

/** Flush pending Postgres writes when the tab is backgrounded or closed. */
export function bindPersistFlushOnUnload() {
  if (typeof window === "undefined" || unloadFlushBound) return;
  const flush = () => {
    void (async () => {
      await awaitInFlightPersists();
      await flushPendingPersists();
    })();
  };
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
  unloadFlushBound = true;
}

function cancelScheduledPersist(key: string) {
  const existing = persistTimers.get(key);
  if (existing) clearTimeout(existing);
  persistTimers.delete(key);
  persistRuns.delete(key);
}

function notifyPersistFailed(detail: {
  kind: string;
  key: string;
  error: string;
}) {
  if (typeof window === "undefined") return;
  // Ephemeral prefs — retries are enough; don't spam the UI.
  if (
    detail.kind === "setting" &&
    /financeiag-(session|sessions|keep-signed-in|notifications-seen|realtime-feed|sidebar-collapsed|theme|idle-timeout)/i.test(
      detail.key,
    )
  ) {
    return;
  }
  // Audit history 401s while sign-out is in flight — avoid stacking toasts.
  if (
    detail.key === "documents/history" &&
    (/\(401\)/.test(detail.error) ||
      /Unauthorized|Sign in required/i.test(detail.error))
  ) {
    return;
  }
  window.dispatchEvent(new CustomEvent("financeiag-persist-failed", { detail }));
}

/**
 * Write records to Postgres immediately (no debounce).
 * Memory is a short-lived working cache only. Durability and merge/wipe policy
 * live on the Go API (`mode`, `removeIds`, `allowEmpty`, revision).
 */
export async function persistRecordsToDb(
  moduleSlug: string,
  entityKey: string,
  records: ManagerRecord[],
  options?: PersistRecordsOptions,
): Promise<boolean> {
  if (FRONTEND_ONLY) {
    setMemoryRecords(moduleSlug, entityKey, records);
    return true;
  }
  const key = `records:${moduleSlug}:${entityKey}`;
  cancelScheduledPersist(key);

  return enqueuePersist(recordsPersistKey(moduleSlug, entityKey), async () => {
    lastRecordsPersistError = "";
    if (!(await isDbSyncAvailable())) {
      clearDbSyncCache();
    }

    const removeIds = (options?.removeIds || []).map((id) => String(id)).filter(Boolean);
    const allowEmpty = options?.allowEmpty === true;
    const mode = options?.mode;

    // Warm revision before first PUT so we do not 409 against a non-empty DB.
    if (!knownEntityRevision(moduleSlug, entityKey)) {
      try {
        await pullRecords(moduleSlug, entityKey);
      } catch {
        /* push may still succeed or return a clean conflict */
      }
    }

    let lastError = "";
    for (let attempt = 0; attempt < PERSIST_RETRIES; attempt++) {
      try {
        const saved = await pushRecords(moduleSlug, entityKey, records, {
          ...(mode ? { mode } : {}),
          allowEmpty,
          removeIds,
        });
        // The echo is the stored collection, so adopt it verbatim — re-adding
        // rows the server did not return used to keep an unsaved record on
        // screen until the next reload, which is exactly what "it saved, then
        // vanished on refresh" looks like.
        const normalized = normalizeServerRecords(saved);
        setMemoryRecords(moduleSlug, entityKey, normalized);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
        }
        // Rows we sent that the server did not store are a failed save, not a
        // display glitch. Deliberate deletions are excluded.
        const savedIds = new Set(normalized.map((row) => row.id));
        const dropped = new Set(removeIds);
        const missing = records.filter(
          (row) => row.id && !savedIds.has(row.id) && !dropped.has(row.id),
        );
        if (missing.length) {
          throw new Error(
            `The API did not store ${missing.length} row(s) of ${moduleSlug}/${entityKey} — the save was rejected after it was accepted`,
          );
        }
        return true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        clearDbSyncCache();
        const conflict =
          err instanceof Error &&
          (err as Error & { code?: string; remote?: ManagerRecord[] }).code ===
            "REVISION_CONFLICT";
        if (conflict) {
          // Keep the intended payload for retry. Only fall back to server rows
          // after retries are exhausted — do not clobber in-flight edits mid-retry.
          if (attempt < PERSIST_RETRIES - 1) {
            await sleep(150 * (attempt + 1));
            continue;
          }
          const conflictRemote = (err as Error & { remote?: ManagerRecord[] }).remote;
          if (Array.isArray(conflictRemote)) {
            setMemoryRecords(
              moduleSlug,
              entityKey,
              normalizeServerRecords(conflictRemote),
            );
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
            }
          }
          break;
        }
        if (/\(401\)/.test(lastError) || /Sign in required/i.test(lastError)) {
          break;
        }
        if (attempt < PERSIST_RETRIES - 1) {
          await sleep(400 * (attempt + 1) * (attempt + 1));
        }
      }
    }
    notifyPersistFailed({
      kind: "records",
      key: `${moduleSlug}/${entityKey}`,
      error: lastError,
    });
    lastRecordsPersistError = lastError || "Could not save changes";
    return false;
  });
}

/** Require Postgres — never fall back to browser storage. */
export async function persistRecordsToDbOrThrow(
  moduleSlug: string,
  entityKey: string,
  records: ManagerRecord[],
  options?: PersistRecordsOptions,
): Promise<void> {
  const ok = await persistRecordsToDb(moduleSlug, entityKey, records, options);
  if (ok) return;
  throw new Error(`Failed to save ${moduleSlug}/${entityKey}`);
}

export async function persistLedgerLinesToDb(
  lines: LedgerLine[],
  options?: {
    allowEmpty?: boolean;
    mode?: "sourceUpsert" | "replace";
    sourceRecordId?: string;
  },
): Promise<boolean> {
  if (FRONTEND_ONLY) {
    if (options?.mode === "sourceUpsert") {
      const sid = String(options.sourceRecordId || "").trim();
      const rest = sid
        ? getMemoryLedgerLines().filter((line) => line.sourceRecordId !== sid)
        : getMemoryLedgerLines();
      setMemoryLedgerLines([...rest, ...lines]);
    } else {
      setMemoryLedgerLines(lines);
    }
    return true;
  }
  const key = LEDGER_LINES_PERSIST_KEY;
  cancelScheduledPersist(key);

  return enqueuePersist(key, async () => {
    if (!(await isDbSyncAvailable())) clearDbSyncCache();

    const sourceUpsert = options?.mode === "sourceUpsert";
    const sourceRecordId = String(options?.sourceRecordId || "").trim();

    // Source upsert: send only that source's lines (or [] to clear). Never full-journal replace.
    if (sourceUpsert) {
      const sid =
        sourceRecordId ||
        [...new Set(lines.map((l) => l.sourceRecordId).filter(Boolean))][0] ||
        "";
      if (!sid) {
        lastLedgerPersistError = "sourceUpsert requires sourceRecordId";
        notifyPersistFailed({
          kind: "ledger-lines",
          key,
          error: lastLedgerPersistError,
        });
        return false;
      }
      const sourceLines = getMemoryLedgerLines().filter(
        (l) => l.sourceRecordId === sid,
      );
      let lastError = "";
      for (let attempt = 0; attempt < PERSIST_RETRIES; attempt++) {
        try {
          const res = await apiFetch("/api/ledger/lines", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            timeoutMs: PERSIST_TIMEOUT_MS,
            body: JSON.stringify({
              mode: "sourceUpsert",
              sourceRecordId: sid,
              lines: sourceLines,
            }),
          });
          const body = (await res.json().catch(() => null)) as
            | { error?: string | { message?: string }; revision?: string }
            | null;
          if (!res.ok) {
            const detail =
              typeof body?.error === "string"
                ? body.error
                : body?.error && typeof body.error === "object"
                  ? body.error.message || ""
                  : "";
            throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
          }
          // The API always returns a revision on a genuine commit (handleLedgerLinesPut
          // writes it after tx.Commit succeeds) — a missing one means the response body
          // failed to parse, which is not proof the write landed. Retry rather than
          // silently dropping the revision token (that would defeat future optimistic
          // concurrency checks on this journal).
          if (!body?.revision) {
            throw new Error("Save did not return a revision — the write may not be durable.");
          }
          rememberLedgerLinesRevision(body.revision);
          return true;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          clearDbSyncCache();
          if (attempt < PERSIST_RETRIES - 1) await sleep(200 * (attempt + 1));
        }
      }
      lastLedgerPersistError = lastError || "Could not save journal lines";
      notifyPersistFailed({ kind: "ledger-lines", key, error: lastError });
      return false;
    }

    // Full-journal replace (admin wipe / restore / intentional resync).
    const payload = getMemoryLedgerLines();
    const toWrite = payload.length ? payload : lines;

    let lastError = "";
    let expectedRevision = ledgerLinesRevision;
    // Warm revision before first PUT so a non-empty journal cannot be replaced blind.
    if (!expectedRevision) {
      try {
        const warm = await apiFetch("/api/ledger/lines?limit=1&offset=0", {
          cache: "no-store",
        });
        if (warm.ok) {
          const json = (await warm.json()) as { revision?: string };
          rememberLedgerLinesRevision(json.revision ?? null);
          expectedRevision = ledgerLinesRevision;
        }
      } catch {
        /* push may still succeed on empty journal or return REVISION_REQUIRED */
      }
    }
    for (let attempt = 0; attempt < PERSIST_RETRIES; attempt++) {
      try {
        // Always re-read memory before each attempt — never retry a stale snapshot.
        const latest = getMemoryLedgerLines();
        const attemptWrite = latest.length ? latest : toWrite;
        const res = await apiFetch("/api/ledger/lines", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          timeoutMs: PERSIST_TIMEOUT_MS,
          body: JSON.stringify({
            lines: attemptWrite,
            ...(expectedRevision ? { expectedRevision } : {}),
            ...(options?.allowEmpty ? { allowEmpty: true } : {}),
          }),
        });
        const body = (await res.json().catch(() => null)) as
          | {
              error?: string | { message?: string };
              code?: string;
              revision?: string;
              data?: LedgerLine[];
            }
          | null;
        if (
          res.status === 409 ||
          body?.code === "REVISION_CONFLICT" ||
          body?.code === "REVISION_REQUIRED"
        ) {
          rememberLedgerLinesRevision(body?.revision ?? null);
          const remote = Array.isArray(body?.data) ? body!.data! : null;
          if (remote) {
            // Remote base + overlay every local source (keeps concurrent tab posts).
            const local = getMemoryLedgerLines();
            const bySource = new Map<string, LedgerLine[]>();
            for (const line of remote) {
              const sid = line.sourceRecordId || "";
              const bucket = bySource.get(sid) || [];
              bucket.push(line);
              bySource.set(sid, bucket);
            }
            const overlay = new Map<string, LedgerLine[]>();
            for (const line of local) {
              const sid = line.sourceRecordId || "";
              if (!sid) continue;
              const bucket = overlay.get(sid) || [];
              bucket.push(line);
              overlay.set(sid, bucket);
            }
            for (const [sid, srcLines] of overlay) {
              bySource.set(sid, srcLines);
            }
            setMemoryLedgerLines([...bySource.values()].flat());
            notifyLedgerReady();
          }
          expectedRevision = body?.revision ?? ledgerLinesRevision;
          if (attempt < PERSIST_RETRIES - 1 && expectedRevision) {
            await sleep(150 * (attempt + 1));
            continue;
          }
          throw new Error(
            typeof body?.error === "string"
              ? body.error
              : "Ledger revision conflict",
          );
        }
        if (!res.ok) {
          const detail =
            typeof body?.error === "string"
              ? body.error
              : body?.error && typeof body.error === "object"
                ? body.error.message || ""
                : "";
          throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
        }
        rememberLedgerLinesRevision(body?.revision ?? null);
        return true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        clearDbSyncCache();
        if (attempt < PERSIST_RETRIES - 1) await sleep(200 * (attempt + 1));
      }
    }
    lastLedgerPersistError = lastError || "Could not save journal lines";
    notifyPersistFailed({
      kind: "ledger-lines",
      key,
      error: lastError,
    });
    return false;
  });
}

export async function persistLedgerAccountsToDb(
  accounts: LedgerAccount[],
): Promise<boolean> {
  if (FRONTEND_ONLY) {
    setMemoryLedgerAccounts(accounts);
    return true;
  }
  const key = "ledger:accounts";
  cancelScheduledPersist(key);

  return enqueuePersist(key, async () => {
    if (!(await isDbSyncAvailable())) clearDbSyncCache();

    let lastError = "";
    for (let attempt = 0; attempt < PERSIST_RETRIES; attempt++) {
      try {
        const res = await apiFetch("/api/ledger/accounts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          timeoutMs: PERSIST_TIMEOUT_MS,
          body: JSON.stringify({ accounts }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string | { message?: string } }
            | null;
          const detail =
            typeof body?.error === "string"
              ? body.error
              : body?.error && typeof body.error === "object"
                ? body.error.message || ""
                : "";
          throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
        }
        return true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        clearDbSyncCache();
        if (attempt < PERSIST_RETRIES - 1) await sleep(200 * (attempt + 1));
      }
    }
    notifyPersistFailed({
      kind: "ledger-accounts",
      key,
      error: lastError,
    });
    return false;
  });
}

const settingRevisions = new Map<string, string>();

function rememberSettingRevision(key: string, revision: string | undefined | null) {
  if (!revision) return;
  settingRevisions.set(key, revision);
}

// A 401 on a settings write means this browser cannot write settings at all
// (no Go credential server-side, or the session is gone) - not that this one
// key is special. persistSettingToDb already declines to retry a 401, but
// each remaining key still paid its own round trip, and the writes are
// serialised through enqueuePersist. Measured on iag-crm's landing page: 13
// settings PUTs, every one a 401, 41s of wall clock - the largest single
// bucket in the boot, and larger than the whole 20s hydrate budget.
//
// Worse, each write calls isDbSyncAvailable(), which on failure clears the
// probe cache, so the next write re-probes /api/sync/{ready,status} and
// /api/health all over again. The failing writes were driving a probe storm.
//
// One 401 stands the rest down for a cooldown. Nothing is lost: the value is
// already in memory and a later write retries after it expires.
let settingsWriteBlockedUntil = 0;
const SETTINGS_WRITE_BLOCK_MS = 30_000;

export async function persistSettingToDb(
  key: string,
  value: unknown,
): Promise<boolean> {
  if (FRONTEND_ONLY) return true;
  // Strict ban: shared financeiag-session overwrote greetings across users.
  // Only null/clear is allowed (legacy purge).
  if (key === "financeiag-session" && value != null) {
    return false;
  }
  const persistKey = `setting:${key}`;
  cancelScheduledPersist(persistKey);

  return enqueuePersist(persistKey, async () => {
    // Skip the round trip entirely while settings writes are known-rejected.
    if (Date.now() < settingsWriteBlockedUntil) return false;
    if (!(await isDbSyncAvailable())) clearDbSyncCache();

    let lastError = "";
    let expectedRevision = settingRevisions.get(key);
    for (let attempt = 0; attempt < PERSIST_RETRIES; attempt++) {
      try {
        const res = await apiFetch(`/api/settings/${encodeURIComponent(key)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          timeoutMs: PERSIST_TIMEOUT_MS,
          body: JSON.stringify({
            value,
            ...(expectedRevision ? { expectedRevision } : {}),
          }),
        });
        if (res.status === 401) {
          // Auth is gone — do not retry (avoids console 401 storms), and
          // stand down the other keys too: they will get the same answer.
          settingsWriteBlockedUntil = Date.now() + SETTINGS_WRITE_BLOCK_MS;
          return false;
        }
        if (res.status === 403) {
          // Administrator-only key (users, roles, email, backups, …).
          // The value is already in memory. Retrying is the 403 storm, and
          // toasting it lands on whatever page happened to be open.
          return false;
        }
        if (res.status === 429) {
          // Tight retries amplify rate-limit storms; wait and give up after one backoff.
          const retryAfter = Number(res.headers.get("Retry-After") || "0");
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(60_000, retryAfter * 1000)
            : 5_000 * (attempt + 1);
          lastError = "HTTP 429: Too many requests";
          clearDbSyncCache();
          if (attempt < PERSIST_RETRIES - 1) await sleep(waitMs);
          else break;
          continue;
        }
        const body = (await res.json().catch(() => null)) as
          | {
              error?: string | { message?: string };
              code?: string;
              revision?: string;
              data?: unknown;
            }
          | null;
        if (res.status === 409 || body?.code === "REVISION_CONFLICT") {
          rememberSettingRevision(key, body?.revision ?? null);
          if (body && "data" in body) {
            setMemorySetting(key, body.data);
          }
          expectedRevision = body?.revision ?? settingRevisions.get(key);
          if (attempt < PERSIST_RETRIES - 1 && expectedRevision) {
            await sleep(150 * (attempt + 1));
            continue;
          }
          throw new Error(
            typeof body?.error === "string"
              ? body.error
              : "Setting revision conflict",
          );
        }
        if (!res.ok) {
          const detail =
            typeof body?.error === "string"
              ? body.error
              : body?.error && typeof body.error === "object"
                ? body.error.message || ""
                : "";
          throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
        }
        rememberSettingRevision(key, body?.revision ?? null);
        return true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        clearDbSyncCache();
        if (attempt < PERSIST_RETRIES - 1) await sleep(200 * (attempt + 1));
      }
    }
    notifyPersistFailed({
      kind: "setting",
      key,
      error: lastError,
    });
    return false;
  });
}

async function pullSettingResult(
  key: string,
): Promise<{ reachable: boolean; value: unknown }> {
  try {
    const res = await apiFetch(`/api/settings/${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!res.ok) return { reachable: false, value: undefined };
    const json = (await res.json()) as { data?: unknown; revision?: string };
    if (json.revision) rememberSettingRevision(key, json.revision);
    return { reachable: true, value: json.data };
  } catch {
    return { reachable: false, value: undefined };
  }
}

async function pullSetting(key: string): Promise<unknown | null | undefined> {
  return (await pullSettingResult(key)).value;
}

/**
 * Restore keep-signed-in session into memory + sessionStorage before the auth
 * gate runs. Identity always comes from the JWT (/api/auth/me) — never from the
 * shared Postgres `financeiag-session` blob (that key is overwritten by whoever
 * last kept signed in, which caused another user's name to appear on refresh).
 *
 * Requires a valid API JWT (Bearer or httpOnly cookie). A client-only session
 * without API auth is cleared so /api calls do not 401 in a loop.
 */
export async function restoreAuthSessionFromDatabase(
  signal?: AbortSignal,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (FRONTEND_ONLY) {
    return Boolean(sessionStorage.getItem("financeiag-session"));
  }
  const aborted = () => Boolean(signal?.aborted);
  try {
    const { probeApiAuth, getApiToken, isWithinLoginGrace } = await import("@/lib/api-auth");
    let apiOk = await probeApiAuth();
    if (aborted()) return false;

    // Already have a live tab session — leave lastActiveAt alone so idle
    // enforcement can still expire stale sessions on navigation/reload.
    const existing = sessionStorage.getItem("financeiag-session");
    if (existing) {
      if (!apiOk) {
        // Login may have finished while the first probe was in flight — re-check
        // once when a Bearer token is present before wiping the tab session.
        // Also re-check cookie-only keep-signed-in (no tab token yet).
        apiOk = await probeApiAuth();
      }
      if (aborted()) return false;
      if (!apiOk) {
        // Fresh login grace: never wipe — hydrate may still be catching up.
        if (isWithinLoginGrace()) {
          return true;
        }
        // Soft-fail: only clear after the same double-401 confirmation used by
        // apiFetch — a single flaky probe must not look like a data wipe.
        const { confirmAuthLost } = await import("@/lib/api-auth");
        const lost = await confirmAuthLost();
        if (!lost) {
          return true;
        }
        if (aborted()) return false;
        const latestRaw = sessionStorage.getItem("financeiag-session");
        const token = getApiToken();
        if (latestRaw && token) {
          let ageMs = Number.POSITIVE_INFINITY;
          try {
            const parsed = JSON.parse(latestRaw) as {
              lastActiveAt?: number;
              at?: number;
            };
            ageMs = Date.now() - (parsed.lastActiveAt || parsed.at || 0);
          } catch {
            /* ignore */
          }
          if (isWithinLoginGrace() || ageMs < 120_000) {
            return true;
          }
        }
        const { clearAuthSession } = await import("@/lib/auth");
        // Local-only — never hit /api/auth/logout here (that revokes a new JWT).
        // Silent: avoid AUTH_CHANGED collapsing the sidebar before hard redirect.
        clearAuthSession({ serverLogout: false, silent: true });
        return false;
      }
      if (aborted()) return false;
      // Strict: JWT /auth/me always wins over any tab blob. Do not load the
      // sessionStorage identity into memory first — that kept User A visible
      // when /me failed or returned User B.
      const reconciled = await applySessionFromAuthMe();
      if (aborted()) return false;
      if (!reconciled) {
        const { clearAuthSession } = await import("@/lib/auth");
        clearAuthSession({ serverLogout: false, silent: true });
        return false;
      }
      return true;
    }

    if (!apiOk) return false;
    if (aborted()) return false;

    // Cookie/Bearer is the keep-signed-in source of truth. Rebuild the tab
    // profile from /api/auth/me — do not adopt another user's shared session.
    const applied = await applySessionFromAuthMe();
    if (aborted()) return false;
    return applied;
  } catch {
    return false;
  }
}

/** Build / repair the tab session from the authenticated JWT user. */
async function applySessionFromAuthMe(): Promise<boolean> {
  try {
    const { fetchAuthMe, fetchDbUsers } = await import("@/lib/auth-api");
    const { USERS_KEY, saveList } = await import("@/lib/manager-settings");
    const {
      readAuthSession,
      writeAuthSession,
      withSessionProfile,
      getKeepSignedInPreference,
    } = await import("@/lib/auth");
    const { findSessionUserRow } = await import("@/lib/session-profile");
    type AuthSession = import("@/lib/auth").AuthSession;

    const me = await fetchAuthMe();
    if (!me.uid || !me.email) return false;

    let users: Awaited<ReturnType<typeof fetchDbUsers>> = [];
    try {
      users = await fetchDbUsers();
      if (users.length) saveList(USERS_KEY, users, { persist: false });
    } catch {
      /* directory optional for basic identity */
    }

    try {
      const { fetchDbRoles } = await import("@/lib/auth-api");
      const { saveRoles } = await import("@/lib/access-control");
      const roles = await fetchDbRoles();
      if (roles.length) saveRoles(roles, { persist: false });
    } catch {
      /* roles optional — page matrix falls back to local defaults */
    }

    const row = findSessionUserRow(users, {
      userId: me.uid,
      email: me.email,
      username: me.username,
    });

    const existing = readAuthSession();
    // Only reuse tab session fields when the user id matches — never email.
    // Shared desks / reused emails must not keep another person's name.
    const existingMatches = Boolean(existing && existing.userId === me.uid);

    const keep = getKeepSignedInPreference();
    const displayName =
      me.name?.trim() ||
      row?.name?.trim() ||
      me.username?.trim() ||
      me.email.split("@")[0] ||
      "";
    const base: AuthSession = {
      sessionId: existingMatches ? existing?.sessionId : undefined,
      userId: me.uid,
      email: me.email,
      name: displayName || undefined,
      username: me.username?.trim() || row?.username?.trim() || undefined,
      role: me.role?.trim() || row?.role?.trim() || undefined,
      // CRUD only from this user's row / previous same-id session — never another account.
      canView: row?.canView || (existingMatches ? existing?.canView : undefined),
      canCreate: row?.canCreate || (existingMatches ? existing?.canCreate : undefined),
      canEdit: row?.canEdit || (existingMatches ? existing?.canEdit : undefined),
      canDelete: row?.canDelete || (existingMatches ? existing?.canDelete : undefined),
      mustChangePassword: Boolean(me.mustChangePassword),
      at: existingMatches && existing?.at ? existing.at : Date.now(),
      lastActiveAt: Date.now(),
    };
    const next = row ? withSessionProfile(base, row) : base;
    // /auth/me + matched row always win — never keep a stale name from another login.
    next.userId = me.uid;
    next.email = me.email;
    if (displayName) next.name = displayName;
    if (me.username?.trim()) next.username = me.username.trim();
    else if (row?.username?.trim()) next.username = row.username.trim();
    if (me.role?.trim()) next.role = me.role.trim();
    else if (row?.role?.trim()) next.role = row.role.trim();
    writeAuthSession(next, keep);
    return true;
  } catch {
    return false;
  }
}

/** Pull Postgres users into memory and stamp role/CRUD onto the active session. */
async function enrichSessionProfileFromAuthApi(): Promise<void> {
  try {
    await applySessionFromAuthMe();
  } catch {
    /* offline / first run */
  }
}

async function pullAllSettings(): Promise<Record<string, unknown> | null> {
  try {
    const res = await apiFetch("/api/settings", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Record<string, unknown> };
    return json.data && typeof json.data === "object" ? json.data : {};
  } catch {
    return null;
  }
}

export async function checkDatabaseHasData(): Promise<boolean> {
  try {
    const res = await apiFetch("/api/sync/status", { cache: "no-store" });
    if (!res.ok) return false;
    const json = (await res.json()) as { hasData?: boolean };
    return Boolean(json.hasData);
  } catch {
    return false;
  }
}

type SyncBootstrap = {
  ok?: boolean;
  hasData?: boolean;
  accounts?: LedgerAccount[];
  balances?: Array<Partial<AccountBalance>>;
  settings?: Record<string, unknown>;
  recordKeys?: Array<{ module?: string; entity?: string }>;
  lines?: {
    data?: LedgerLine[];
    hasMore?: boolean;
    nextOffset?: number;
    revision?: string;
  };
};

/** One round-trip boot payload from Go — replaces status+accounts+balances+settings+keys+page1. */
const BOOTSTRAP_ABSENT_KEY = "financeiag-bootstrap-absent";

function bootstrapKnownAbsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(BOOTSTRAP_ABSENT_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberBootstrapAbsent() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(BOOTSTRAP_ABSENT_KEY, "1");
  } catch {
    /* a private window just pays the one 404 again */
  }
}

export function bootstrapRetryable(status: number): boolean {
  if (status === 404 || status === 405) return false;
  return status === 401 || status >= 500;
}

async function pullSyncBootstrap(): Promise<{
  data: SyncBootstrap | null;
  retryable: boolean;
}> {
  if (bootstrapKnownAbsent()) return { data: null, retryable: false };
  try {
    const res = await apiFetch("/api/sync/bootstrap", { cache: "no-store" });
    if (res.ok) return { data: (await res.json()) as SyncBootstrap, retryable: false };
    if (res.status === 404 || res.status === 405) {
      rememberBootstrapAbsent();
      return { data: null, retryable: false };
    }
    return { data: null, retryable: bootstrapRetryable(res.status) };
  } catch {
    return { data: null, retryable: true };
  }
}

export function lastHydrateLoadedRemoteData(): boolean {
  return lastHydrateHadRemoteData;
}

async function hydrateSettings(
  preloaded?: Record<string, unknown> | null,
): Promise<boolean> {
  let changed = false;
  const allRemote =
    preloaded && typeof preloaded === "object"
      ? { ...preloaded }
      : await pullAllSettings();
  // Strict: strip banned identity key before any merge into memory.
  if (allRemote && Object.prototype.hasOwnProperty.call(allRemote, "financeiag-session")) {
    delete allRemote["financeiag-session"];
    try {
      await apiFetch(`/api/settings/${encodeURIComponent("financeiag-session")}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        timeoutMs: PERSIST_TIMEOUT_MS,
        body: JSON.stringify({ value: null }),
      });
    } catch {
      /* ignore */
    }
  }
  // When bulk /api/settings succeeded, never N+1 each key (that made refresh hang for minutes).
  const keys = new Set<string>(
    allRemote
      ? Object.keys(allRemote)
      : [...SYNCED_SETTING_KEYS],
  );
  if (allRemote) {
    for (const key of SYNCED_SETTING_KEYS) keys.add(key);
  }

  // ...and when it FAILED, do not N+1 either. That path was still fanning
  // out one serial GET per synced key. With no settings backend answering,
  // every one of them fails, and on a deployment that proxies to a remote
  // Go API each is a full round trip. Measured on the sibling fleet app:
  // 127 requests and ~50s of wall clock on the post-login landing page - on
  // its own more than the 20s hydrate budget, so boot showed "Database is
  // slow to respond" before it ever reached the record pulls.
  //
  // Probe a single key instead of assuming. One failure answers the same
  // question all of them were being used to answer, and it stays correct
  // for a backend serving /api/settings/:key without serving the collection.
  const perKeyPull = new Map<string, unknown>();
  if (!allRemote) {
    const probeKey = [...keys][0];
    if (probeKey !== undefined) {
      const probe = await pullSettingResult(probeKey);
      if (!probe.reachable) {
        // No settings backend answering. The other keys cannot do better.
        // Note this turns on `reachable`, not on the value: an unset key is
        // a healthy answer and must not stand down the whole hydrate.
        return changed;
      }
      perKeyPull.set(probeKey, probe.value);
      // The rest in bounded parallel - serial round trips were the cost.
      const rest = [...keys].filter((k) => k !== probeKey);
      const CONCURRENCY = 8;
      for (let i = 0; i < rest.length; i += CONCURRENCY) {
        const chunk = rest.slice(i, i + CONCURRENCY);
        const values = await Promise.all(chunk.map((k) => pullSetting(k)));
        chunk.forEach((k, idx) => perKeyPull.set(k, values[idx]));
      }
    }
  }

  for (const key of keys) {
    try {
      const remote = allRemote
        ? Object.prototype.hasOwnProperty.call(allRemote, key)
          ? allRemote[key]
          : undefined
        : perKeyPull.get(key);
      if (remote === undefined) continue;
      const hasLocal = hasMemorySetting(key);
      const local = hasLocal ? getMemorySetting<unknown>(key, null) : undefined;
      const remoteJson = stableJson(remote);
      // Auth identity is JWT/tab-scoped. Never adopt, re-publish, or "heal" a
      // shared financeiag-session — that blob flipped Ritah/Richard/Admin names.
      if (key === "financeiag-session") {
        try {
          await apiFetch(`/api/settings/${encodeURIComponent(key)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            timeoutMs: PERSIST_TIMEOUT_MS,
            body: JSON.stringify({ value: null }),
          });
        } catch {
          /* ignore */
        }
        continue;
      }
      // Never push tab leftovers into Postgres when the remote key is missing/null.
      // Remote null means the setting was cleared — clear local too (except
      // sessions/users which have explicit catch-up logic below).
      if (remote === null) {
        if (
          key !== "financeiag-sessions" &&
          key !== "financeiag-users" &&
          hasLocal &&
          local != null
        ) {
          removeMemorySetting(key);
          changed = true;
        }
        continue;
      }
      if (!hasLocal) {
        setMemorySetting(key, remote);
        changed = true;
        continue;
      }
      if (remoteJson === stableJson(local)) continue;
      // Keep in-tab session list if it has rows Postgres has not caught up with yet
      // (login just wrote memory; force hydrate can otherwise wipe the new row).
      //
      // Scoped to the post-login grace window on purpose. Outside it, Postgres
      // wins: an old tab must never re-publish its stale list and resurrect a
      // session that was logged out (or revoked) on another device.
      if (
        isWithinLoginGrace() &&
        key === "financeiag-sessions" &&
        Array.isArray(local) &&
        local.length
      ) {
        const remoteList = Array.isArray(remote) ? remote : [];
        const localIds = new Set(
          (local as { id?: string }[]).map((s) => s.id).filter(Boolean) as string[],
        );
        const remoteMissingLocal = [...localIds].some(
          (id) => !remoteList.some((s: { id?: string }) => s.id === id),
        );
        if (remoteMissingLocal || localIds.size >= remoteList.length) {
          try {
            await apiFetch(`/api/settings/${encodeURIComponent(key)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              timeoutMs: PERSIST_TIMEOUT_MS,
              body: JSON.stringify({ value: local }),
            });
          } catch {
            /* ignore */
          }
          continue;
        }
      }
      // Keep in-tab users list if login just wrote the signed-in user and
      // Postgres settings have not caught up yet (avoids empty-role lockout).
      //
      // Scoped to the post-login grace window on purpose. Outside it, Postgres
      // wins: a long-open tab must never re-publish its stale user list and
      // silently restore a permission an admin revoked elsewhere.
      if (
        isWithinLoginGrace() &&
        key === "financeiag-users" &&
        Array.isArray(local) &&
        local.length
      ) {
        const remoteList = Array.isArray(remote) ? remote : [];
        const localHasCreate = (local as { canCreate?: string }[]).some(
          (u) => String(u.canCreate || "").toLowerCase() === "yes",
        );
        const remoteHasCreate = remoteList.some(
          (u: { canCreate?: string }) =>
            String(u.canCreate || "").toLowerCase() === "yes",
        );
        if (localHasCreate && !remoteHasCreate) {
          try {
            await apiFetch(`/api/settings/${encodeURIComponent(key)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              timeoutMs: PERSIST_TIMEOUT_MS,
              body: JSON.stringify({ value: local }),
            });
          } catch {
            /* ignore */
          }
          continue;
        }
      }
      if (stableJson(local) !== remoteJson) {
        setMemorySetting(key, remote);
        changed = true;
      }
    } catch {
      /* continue */
    }
  }
  return changed;
}

/**
 * Load business data from Postgres into memory.
 * Interactive boot pulls ledger, settings, and the open route first, then finishes
 * the rest of the catalog in the background so sidebar navigation stays clickable.
 * Pass `{ force: true }` after login to flush pending writes and re-pull (keeps memory).
 */
const API_DOWN_TOAST_KEY = "financeiag-api-down-toast-v1";

function shouldToastApiUnreachable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // One toast per tab — React Strict Mode / remounts used to stack duplicates.
    if (sessionStorage.getItem(API_DOWN_TOAST_KEY) === "1") return false;
    sessionStorage.setItem(API_DOWN_TOAST_KEY, "1");
    return true;
  } catch {
    return true;
  }
}

export async function hydrateFromDatabase(
  options?: { force?: boolean },
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  // Join an in-flight boot even when force=true (Strict Mode remount + AppShell
  // both call force). Tearing it down mid-flight double-toasted "API unreachable".
  if (hydratePromise && (hydrateBusy || !options?.force)) {
    return hydratePromise;
  }
  if (options?.force) {
    if (hydratePromise) {
      try {
        await hydratePromise;
      } catch {
        /* restart below */
      }
      hydratePromise = null;
    }
    // Cap flush so a stuck PUT cannot stall interactive unlock / trip the boot toast.
    await Promise.race([
      (async () => {
        await awaitInFlightPersists();
        await flushPendingPersists();
      })(),
      sleep(3_000),
    ]);
    try {
      sessionStorage.removeItem(HYDRATE_SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    hydrateBusy = true;
    lastHydrateHadRemoteData = false;
    const migrated = migrateBusinessDataOutOfLocalStorage();
    scrubBusinessLocalStorage();

    let changed = migrated;
    let remoteHadData = false;

    // Bootstrap is the availability check — extra health probes used to add
    // several seconds of RTT before any data arrived.
    let bootstrap: SyncBootstrap | null = null;
    try {
      const first = await pullSyncBootstrap();
      bootstrap = first.data;
      // Auth races right after login: cookie/Bearer can lag — retry a few times
      // before declaring the Go API dead.
      if (!bootstrap && first.retryable) {
        for (const wait of [400, 800, 1200]) {
          await sleep(wait);
          const again = await pullSyncBootstrap();
          bootstrap = again.data;
          if (bootstrap || !again.retryable) break;
        }
      }
    } catch {
      bootstrap = null;
    }

    if (bootstrap) {
      syncEnabled = true;
      syncEnabledCheckedAt = Date.now();
      try {
        sessionStorage.removeItem(API_DOWN_TOAST_KEY);
      } catch {
        /* ignore */
      }
    } else {
      const available = await isDbSyncAvailable();
      if (!available) {
        // Do NOT mark hydrated — empty/stale memory must not look authoritative.
        notifyHydrateUi({ error: "database-unavailable" });
        // Auth sign-out / login grace: the API is up, credentials are not —
        // do not scare the user with "Go API unreachable".
        const { isHandlingUnauthorized, isWithinLoginGrace } = await import(
          "@/lib/api-auth"
        );
        if (
          typeof window !== "undefined" &&
          !isHandlingUnauthorized() &&
          !isWithinLoginGrace() &&
          shouldToastApiUnreachable()
        ) {
          window.dispatchEvent(
            new CustomEvent("financeiag-persist-failed", {
              detail: {
                kind: "hydrate",
                key: "database",
                error:
                  "Database API unreachable. Forms cannot save until the Go API is online.",
              },
            }),
          );
        }
        hydrateBusy = false;
        return changed;
      }
    }

    try {
      if (bootstrap) {
        if (bootstrap.hasData) remoteHadData = true;

        const remote = Array.isArray(bootstrap.accounts) ? bootstrap.accounts : [];
        const local = getMemoryLedgerAccounts();
        if (remote.length) {
          remoteHadData = true;
          const remoteNormalized = remote
            .filter((acct) => !/^imported$/i.test((acct.group || "").trim()))
            .map((acct) => {
              if (
                acct.code === "3999" ||
                /opening balances equity/i.test(acct.name || "")
              ) {
                return {
                  ...acct,
                  code: "3999",
                  name: "Opening balances equity",
                  type: "Equity" as const,
                  group: "Equity",
                  openingBalance: 0,
                };
              }
              return acct;
            });
          if (arraysDiffer(remoteNormalized, local)) {
            setMemoryLedgerAccounts(remoteNormalized);
            changed = true;
          }
          if (remoteNormalized.length < remote.length) {
            await persistLedgerAccountsToDb(remoteNormalized);
          }
        } else if (local.length) {
          // Successful empty CoA from Postgres — clear tab; do not push browser rows.
          setMemoryLedgerAccounts([]);
          changed = true;
        }

        if (
          applyRemoteBalanceRows(
            Array.isArray(bootstrap.balances) ? bootstrap.balances : [],
          )
        ) {
          remoteHadData = true;
          changed = true;
          notifyLedgerReady();
        }

        const bootLines = Array.isArray(bootstrap.lines?.data)
          ? bootstrap.lines.data
          : [];
        if (bootstrap.lines?.revision) {
          rememberLedgerLinesRevision(bootstrap.lines.revision);
        }
        await awaitLedgerLinesPersist();
        // Interactive unlock uses page-1 only; remaining pages continue in background.
        if (isLedgerLinesPersistActive()) {
          await awaitLedgerLinesPersist();
        } else {
          const localLines = getMemoryLedgerLines();
          const nextLines = commitRemoteLedgerLinesToMemory(bootLines);
          if (
            ledgerLinesFingerprint(nextLines) !==
            ledgerLinesFingerprint(localLines)
          ) {
            changed = true;
          }
          if (nextLines.length) remoteHadData = true;
          const nextOffset =
            typeof bootstrap.lines?.nextOffset === "number"
              ? bootstrap.lines.nextOffset
              : bootLines.length;
          const hasMore = Boolean(bootstrap.lines?.hasMore);
          if (hasMore) {
            scheduleBackgroundJournalHydrate({
              lines: bootLines,
              nextOffset,
              hasMore: true,
            });
          }
        }
      } else {
        // Legacy fallback when bootstrap is unavailable (older API deploy).
        await awaitLedgerLinesPersist();
        // First journal page only — remainder schedules after accounts/balances land.
        const linesPromise = pullLedgerLinesPaged({
          progressive: true,
          maxPages: 1,
        });
        const pullFastBundle = async () => {
          const [statusRes, acctRes, balRes] = await Promise.all([
            apiFetch("/api/sync/status", { cache: "no-store" }).catch(() => null),
            apiFetch("/api/ledger/accounts", { cache: "no-store" }),
            apiFetch("/api/ledger/balances", { cache: "no-store" }),
          ]);
          return { statusRes, acctRes, balRes };
        };
        let { statusRes, acctRes, balRes } = await pullFastBundle();
        if ((statusRes && !statusRes.ok) || !acctRes.ok || !balRes.ok) {
          await new Promise((r) => setTimeout(r, 400));
          ({ statusRes, acctRes, balRes } = await pullFastBundle());
        }
        if (statusRes?.ok) {
          try {
            const status = (await statusRes.json()) as { hasData?: boolean };
            remoteHadData = Boolean(status.hasData);
          } catch {
            /* ignore */
          }
        }
        if (acctRes.ok) {
          const json = (await acctRes.json()) as { data?: LedgerAccount[] };
          const remote = Array.isArray(json.data) ? json.data : [];
          const local = getMemoryLedgerAccounts();
          if (remote.length) {
            remoteHadData = true;
            const remoteNormalized = remote
              .filter((acct) => !/^imported$/i.test((acct.group || "").trim()))
              .map((acct) => {
                if (
                  acct.code === "3999" ||
                  /opening balances equity/i.test(acct.name || "")
                ) {
                  return {
                    ...acct,
                    code: "3999",
                    name: "Opening balances equity",
                    type: "Equity" as const,
                    group: "Equity",
                    openingBalance: 0,
                  };
                }
                return acct;
              });
            if (arraysDiffer(remoteNormalized, local)) {
              setMemoryLedgerAccounts(remoteNormalized);
              changed = true;
            }
            if (remoteNormalized.length < remote.length) {
              await persistLedgerAccountsToDb(remoteNormalized);
            }
          } else if (local.length) {
            setMemoryLedgerAccounts([]);
            changed = true;
          }
        }
        if (balRes.ok) {
          const json = (await balRes.json()) as {
            data?: Array<Partial<AccountBalance>>;
          };
          if (applyRemoteBalanceRows(Array.isArray(json.data) ? json.data : [])) {
            remoteHadData = true;
            changed = true;
            notifyLedgerReady();
          }
        }
        const pulled = await linesPromise;
        if (isLedgerLinesPersistActive()) {
          await awaitLedgerLinesPersist();
        } else if (pulled) {
          const local = getMemoryLedgerLines();
          const nextLines = commitRemoteLedgerLinesToMemory(pulled.lines);
          if (
            ledgerLinesFingerprint(nextLines) !== ledgerLinesFingerprint(local)
          ) {
            changed = true;
          }
          if (nextLines.length) remoteHadData = true;
          if (pulled.hasMore) {
            scheduleBackgroundJournalHydrate({
              lines: pulled.lines,
              nextOffset: pulled.nextOffset,
              hasMore: true,
            });
          }
        }
      }
      if (getMemoryLedgerLines().length || getMemoryLedgerAccounts().length) {
        notifyLedgerReady();
      }
    } catch {
      /* ignore */
    }

    // Settings before entity flood — sidebar tabs/roles need this for navigation.
    try {
      if (await hydrateSettings(bootstrap?.settings ?? null)) changed = true;
    } catch {
      /* ignore */
    }

    const remoteKeys = bootstrap?.recordKeys?.length
      ? bootstrap.recordKeys
          .filter((row) => row.module && row.entity)
          .map((row) => ({
            module: String(row.module),
            entity: String(row.entity),
          }))
      : await pullRemoteRecordKeys();
    const syncKeys = filterKeysByAccess(
      mergeRecordKeys(await catalogRecordKeys(), remoteKeys, listMemoryRecordKeys()),
    );
    // Always warm CoA entity for ledger backfill below.
    const priorityWanted = mergeRecordKeys(priorityRecordKeys(syncKeys), [
      { module: "accounts", entity: "chart-of-accounts" },
    ]);
    const priorityId = new Set(
      priorityWanted.map((row) => `${row.module}:${row.entity}`),
    );
    // Desk/badge entities: front of background catalog (not interactive await).
    const badgeWanted = badgeRecordKeys().filter((row) =>
      syncKeys.some((k) => k.module === row.module && k.entity === row.entity),
    );
    const badgeId = new Set(
      badgeWanted.map((row) => `${row.module}:${row.entity}`),
    );
    const priorityKeys = syncKeys.filter((row) =>
      priorityId.has(`${row.module}:${row.entity}`),
    );
    const badgeKeys = syncKeys.filter(
      (row) =>
        badgeId.has(`${row.module}:${row.entity}`) &&
        !priorityId.has(`${row.module}:${row.entity}`),
    );
    const deferredKeys = [
      ...badgeKeys,
      ...syncKeys.filter(
        (row) =>
          !priorityId.has(`${row.module}:${row.entity}`) &&
          !badgeId.has(`${row.module}:${row.entity}`),
      ),
    ];

    const pullKeys = async (
      keys: Array<{ module: string; entity: string }>,
      opts?: { yieldBetween?: boolean },
    ) => {
      const chunkSize = 6;
      for (let i = 0; i < keys.length; i += chunkSize) {
        if (opts?.yieldBetween && i > 0) await yieldToMain();
        const chunk = keys.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async ({ module: moduleSlug, entity }) => {
            try {
              // Same guard as hydrateEntityFromDatabase — never clobber an in-flight save.
              await awaitEntityPersist(moduleSlug, entity);
              const remote = await pullRecords(moduleSlug, entity);
              if (isEntityPersistActive(moduleSlug, entity)) {
                await awaitEntityPersist(moduleSlug, entity);
                return;
              }
              if (remote === null) return;
              const local = getMemoryRecords(moduleSlug, entity);
              const next = commitRemoteRecordsToMemory(
                moduleSlug,
                entity,
                remote,
              );
              if (arraysDiffer(next, local)) {
                changed = true;
              }
              if (next.length) remoteHadData = true;
            } catch {
              /* continue */
            }
          }),
        );
      }
    };

    // Interactive phase: open route + badge data only (do not load every module page).
    await pullKeys(priorityKeys);

    // If Postgres reported data but priority pulls failed (auth race), retry once.
    if (remoteHadData && priorityKeys.length) {
      const loaded = priorityKeys.some(
        ({ module: moduleSlug, entity }) => getMemoryRecords(moduleSlug, entity).length > 0,
      );
      const ledgerOk =
        getMemoryLedgerAccounts().length > 0 || getMemoryLedgerLines().length > 0;
      if (!loaded && !ledgerOk) {
        await new Promise((r) => setTimeout(r, 600));
        try {
          await hydrateLedgerFromDatabase();
        } catch {
          /* ignore */
        }
        await pullKeys(priorityKeys);
        const stillEmpty =
          !priorityKeys.some(
            ({ module: moduleSlug, entity }) => getMemoryRecords(moduleSlug, entity).length > 0,
          ) &&
          !getMemoryLedgerAccounts().length &&
          !getMemoryLedgerLines().length;
        if (stillEmpty && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("financeiag-persist-failed", {
              detail: {
                kind: "hydrate",
                key: "records",
                error:
                  "Signed in, but business data could not be loaded. Hard-refresh, or sign out and sign in again. Use one host only (localhost or 127.0.0.1).",
              },
            }),
          );
        }
      }
    }

    // —— Backfill ledger Account table from Chart of Accounts entity rows ——
    try {
      const localLedger = getMemoryLedgerAccounts();
      const coaRecords = getMemoryRecords("accounts", "chart-of-accounts");
      if (coaRecords.length) {
        const { ledgerAccountsFromChartRecords } = await import("@/lib/ledger/chart-of-accounts");
        const fromCoa = ledgerAccountsFromChartRecords(coaRecords);
        if (fromCoa.length && (!localLedger.length || localLedger.length < Math.floor(fromCoa.length * 0.5))) {
          setMemoryLedgerAccounts(fromCoa);
          await persistLedgerAccountsToDb(fromCoa);
          changed = true;
        }
      }
      // Empty CoA from API stays empty — never invent DEFAULT_CHART client-side.
    } catch {
      /* ignore */
    }

    scrubBusinessLocalStorage();
    lastHydrateHadRemoteData = remoteHadData;
    sessionStorage.setItem(HYDRATE_SESSION_KEY, "1");
    // Unlock the shell — sidebar must be clickable before the rest of the catalog loads.
    // Empty ledger_lines from API stay empty — reports print from that log only.
    notifyHydrateUi({ phase: "interactive" });
    hydrateBusy = false;

    // Warm ledger revision off the interactive path (bootstrap may already have it).
    if (!ledgerLinesRevision) {
      void (async () => {
        try {
          const warm = await apiFetch("/api/ledger/lines?limit=1&offset=0", {
            cache: "no-store",
          });
          if (warm.ok) {
            const json = (await warm.json()) as { revision?: string };
            rememberLedgerLinesRevision(json.revision ?? "0:0");
          } else {
            rememberLedgerLinesRevision("0:0");
          }
        } catch {
          rememberLedgerLinesRevision("0:0");
        }
      })();
    }

    if (deferredKeys.length) {
      const previous = backgroundCatalogHydrate;
      backgroundCatalogHydrate = (async () => {
        await previous?.catch(() => undefined);
        let deferredChanged = false;
        // Badge/desk first (chunk 6), then the rest of the catalog (chunk 2).
        const badgeCount = badgeKeys.length;
        const pullBackground = async (
          keys: Array<{ module: string; entity: string }>,
          chunkSize: number,
        ) => {
          for (let i = 0; i < keys.length; i += chunkSize) {
            await yieldToMain();
            const chunk = keys.slice(i, i + chunkSize);
            await Promise.all(
              chunk.map(async ({ module: moduleSlug, entity }) => {
                try {
                  await awaitEntityPersist(moduleSlug, entity);
                  const remote = await pullRecords(moduleSlug, entity);
                  if (isEntityPersistActive(moduleSlug, entity)) {
                    await awaitEntityPersist(moduleSlug, entity);
                    return;
                  }
                  if (remote === null) return;
                  const local = getMemoryRecords(moduleSlug, entity);
                  const next = commitRemoteRecordsToMemory(
                    moduleSlug,
                    entity,
                    remote,
                  );
                  if (arraysDiffer(next, local)) {
                    deferredChanged = true;
                    changed = true;
                  }
                  if (next.length) remoteHadData = true;
                } catch {
                  /* continue */
                }
              }),
            );
          }
        };
        if (badgeCount) {
          await pullBackground(deferredKeys.slice(0, badgeCount), 6);
          if (deferredChanged) {
            notifyHydrateUi({ phase: "badge" });
            deferredChanged = false;
          }
        }
        await pullBackground(deferredKeys.slice(badgeCount), 2);
        lastHydrateHadRemoteData = remoteHadData;
        if (deferredChanged) {
          notifyHydrateUi({ phase: "catalog" });
        }
      })();
      // Do not await — keep boot + navigation free.
      void backgroundCatalogHydrate;
    }

    return changed;
  })();
  try {
    return await hydratePromise;
  } finally {
    hydratePromise = null;
    hydrateBusy = false;
  }
}
