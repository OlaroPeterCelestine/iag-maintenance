"use client";

import dynamic from "next/dynamic";

import { AppSidebar } from "@/components/app-sidebar";
const ForceChangePasswordDialog = dynamic(
  () =>
    import("@/components/change-password-dialog").then(
      (m) => m.ForceChangePasswordDialog,
    ),
  { ssr: false },
);
const GlobalSearch = dynamic(
  () => import("@/components/global-search").then((m) => m.GlobalSearch),
  { ssr: false },
);
import {
  BootSplash,
  LoginPageSkeleton,
  ModulePageSkeleton,
  ShellLoadingSkeleton,
} from "@/components/page-loading";
const PersistFailureToaster = dynamic(
  () => import("@/components/persist-failure-toaster").then((m) => m.PersistFailureToaster),
  { ssr: false },
);
const RealtimeListener = dynamic(
  () => import("@/components/realtime-listener").then((m) => m.RealtimeListener),
  { ssr: false },
);
const PwaRegister = dynamic(
  () => import("@/components/pwa-register").then((m) => m.PwaRegister),
  { ssr: false },
);
const UserActivityTracker = dynamic(
  () => import("@/components/user-activity-tracker").then((m) => m.UserActivityTracker),
  { ssr: false },
);
import {
  clearDemoDataOnce,
  removeCashAtHandAccountOnce,
} from "@/lib/clear-demo-data";
import {
  bindPersistFlushOnUnload,
  DB_SYNC_READY_EVENT,
  flushPendingPersists,
  hydrateFromDatabase,
  hydrateLedgerFromDatabase,
  isDbHydratedThisTab,
  lastHydrateLoadedRemoteData,
  markDbHydratedThisTab,
  restoreAuthSessionFromDatabase,
} from "@/lib/db/sync";
import { scrubBusinessLocalStorage, getMemoryLedgerAccounts } from "@/lib/db/client-store";
import { consumeSkipHydrateOnce } from "@/lib/reset-data";
import { FRONTEND_ONLY } from "@/lib/frontend-only";
import {
  clearDefaultSeededBankAccountsOnce,
  migrateMirroredBankAccountNamesOnce,
} from "@/lib/ledger/chart-of-accounts";
import { clearImportedBankStatementsOnce } from "@/lib/ledger/bank-statements";
import { ensureRecommendedLayouts } from "@/lib/export/document-templates";
import { AUTH_CHANGED_EVENT, forceSessionLogout, isAuthenticated, readAuthSession } from "@/lib/auth";
import { isWithinLoginGrace } from "@/lib/api-auth";
import { canAccessPath, defaultHomePath, loadRoles } from "@/lib/access-control";
import { fetchDailyExchangeRatesOnce } from "@/lib/fx-daily";
import {
  enforceSessionValidity,
  SESSION_EXPIRED_EVENT,
  startSessionActivityMonitor,
  touchSessionActivity,
} from "@/lib/session-activity";
import { type ModuleSlug, MODULE_SLUGS } from "@/lib/module-data";
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { appToastError, appToastInfo } from "@/lib/app-toast";
import { trackAccessDenied } from "@/lib/user-activity";

type SidebarActive =
  | "dashboard"
  | "settings"
  | "guides"
  | "qna"
  | "release-notes"
  | "templates"
  | "comms"
  | "accounting-documents"
  | "payment-requests"
  | "profile"
  | "users"
  | "request-emails"
  | "activity-logs"
  | "crash-analytics"
  | "system-health"
  | "analytics"
  | ModuleSlug;

type ShellContextValue = {
  openSidebar: () => void;
  openSearch: () => void;
};

const ShellContext = createContext<ShellContextValue>({
  openSidebar: () => {},
  openSearch: () => {},
});

export function useAppShell() {
  return useContext(ShellContext);
}

function activeFromPath(pathname: string): SidebarActive {
  if (pathname === "/" || pathname === "") return "dashboard";
  if (pathname === "/contractor" || pathname.startsWith("/contractor/")) return "dashboard";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/guides")) return "guides";
  if (pathname.startsWith("/qna")) return "qna";
  if (pathname.startsWith("/release-notes")) return "release-notes";
  if (pathname.startsWith("/templates")) return "templates";
  if (pathname.startsWith("/comms")) return "comms";
  if (pathname.startsWith("/accounting-documents")) return "accounting-documents";
  if (pathname.startsWith("/payment-requests")) return "payment-requests";
  if (pathname.startsWith("/profile")) return "profile";
  if (pathname.startsWith("/users")) return "users";
  if (pathname.startsWith("/request-emails")) return "request-emails";
  if (pathname.startsWith("/activity-logs")) return "activity-logs";
  if (pathname.startsWith("/crash-analytics")) return "crash-analytics";
  if (pathname.startsWith("/system-health")) return "system-health";
  if (pathname.startsWith("/analytics")) return "analytics";
  const slug = pathname.replace(/^\//, "").split("/")[0];
  if ((MODULE_SLUGS as readonly string[]).includes(slug)) return slug as ModuleSlug;
  return "dashboard";
}

const PUBLIC_MAIN_PATHS = ["/guides"];

function isPublicMainPath(pathname: string): boolean {
  return PUBLIC_MAIN_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** Cached tab session / login grace — enough to paint real nav before network restore. */
function canMountShellOptimistically(pathname: string): boolean {
  if (typeof window === "undefined") return false;
  return (
    isPublicMainPath(pathname) || isAuthenticated() || isWithinLoginGrace()
  );
}

/** Right after password login — never flash LoginPageSkeleton / boot shimmer. */
function isPostLoginUnlock(): boolean {
  if (typeof window === "undefined") return false;
  return isWithinLoginGrace() || isAuthenticated();
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  // First client paint: if we already have a session / login grace, mount the
  // real shell immediately — do not show LoginPageSkeleton for one frame.
  const [allowed, setAllowed] = useState(() => canMountShellOptimistically(pathname));
  const [shellMounted, setShellMounted] = useState(() =>
    canMountShellOptimistically(pathname),
  );
  /**
   * UI unlocked after first hydrate — except right after login, where grace
   * skips the shimmer so the dashboard paints immediately while hydrate runs.
   */
  const [bootReady, setBootReady] = useState(() => isPostLoginUnlock());
  /** Bumps when identity changes so hydrate re-runs even if `allowed` stays true. */
  const [bootEpoch, setBootEpoch] = useState(0);
  const optimisticBooted = useRef(canMountShellOptimistically(pathname));
  // Who the shell last booted for — a same-user session refresh must not reboot.
  const bootedUserId = useRef<string | null>(null);
  const active = useMemo(() => activeFromPath(pathname), [pathname]);

  // Close mobile drawer only — desktop sticky sidebar must not re-layout on every route.
  useEffect(() => {
    setSidebarOpen((open) => (open ? false : open));
  }, [pathname]);

  // Paint real sidebar once — do NOT re-run loadRoles / setState on every click.
  useLayoutEffect(() => {
    if (optimisticBooted.current) return;
    if (!canMountShellOptimistically(pathname)) {
      if (!isPublicMainPath(pathname)) {
        window.location.replace(
          `/login?next=${encodeURIComponent(pathname || "/")}`,
        );
      }
      return;
    }
    optimisticBooted.current = true;
    try {
      loadRoles();
    } catch {
      /* keep session CRUD until roles hydrate */
    }
    setAllowed(true);
    setShellMounted(true);
  }, [pathname]);

  // Restore session once per tab — not on every sidebar click.
  useEffect(() => {
    let cancelled = false;
    async function restoreOnce() {
      try {
        // Cap wait so a hung /api/auth/me cannot leave a blank/skeleton forever.
        await Promise.race([
          restoreAuthSessionFromDatabase(),
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, 12_000);
          }),
        ]);
      } catch {
        /* offline / first run */
      }
      if (cancelled) return;
      try {
        loadRoles();
      } catch {
        /* keep session CRUD until roles hydrate */
      }
      setAuthReady(true);
    }
    void restoreOnce();
    return () => {
      cancelled = true;
    };
  }, []);

  // When identity changes in-tab (AUTH_CHANGED), reset boot so the new user
  // gets a fresh hydrate instead of the previous person's rows. The session
  // restore rewrites the same user's session (and fires the event) a few
  // seconds after load; rebooting then swapped the page for the skeleton and
  // remounted it, closing any form the user had already opened.
  useEffect(() => {
    bootedUserId.current = readAuthSession()?.userId ?? null;
    const onAuth = () => {
      const session = readAuthSession();
      if (!session?.userId) {
        bootedUserId.current = null;
        setBootReady(false);
        setAllowed(false);
        return;
      }
      const userId = String(session.userId);
      if (bootedUserId.current !== userId) {
        bootedUserId.current = userId;
        setBootReady(false);
      }
      try {
        loadRoles();
      } catch {
        /* keep session CRUD until roles hydrate */
      }
      setAllowed(true);
      setShellMounted(true);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuth);
  }, []);

  // Path access is local after session restore — no network on route change.
  useEffect(() => {
    if (!authReady) return;
    const publicPath = isPublicMainPath(pathname);
    const signedIn = isAuthenticated();
    if (!publicPath && !signedIn) {
      if (isWithinLoginGrace()) {
        setAllowed(true);
        setShellMounted(true);
        return;
      }
      // Hard navigate — soft replace leaves empty sidebar mounted through the transition.
      window.location.replace(
        `/login?next=${encodeURIComponent(pathname || "/")}`,
      );
      return;
    }
    // Signed-in users always respect the role ACL — including on otherwise-public
    // pages like /guides (guests may browse; restricted roles must not).
    if (signedIn && !canAccessPath(pathname)) {
      // Keep the denied page unmounted — rendering it would run its data hooks
      // before the redirect lands.
      setAllowed(false);
      setShellMounted(true);
      trackAccessDenied(pathname, "Role cannot open this page");
      appToastError("Access denied", "Your role cannot open that page.");
      router.replace(defaultHomePath());
      return;
    }
    setAllowed((prev) => (prev ? prev : true));
    setShellMounted((prev) => (prev ? prev : true));
  }, [authReady, pathname, router]);

  // Session idle monitor — once while allowed. Do NOT recreate on every route.
  // On expiry: hard logout to /login (no next=) so we do not bounce into old tabs.
  useEffect(() => {
    if (!allowed) return;
    if (!enforceSessionValidity()) {
      forceSessionLogout("idle");
      return;
    }
    touchSessionActivity();
    const stop = startSessionActivityMonitor({
      warningMsBeforeIdle: 60_000,
      onWarning: (msLeft) => {
        appToastInfo(
          "Session expiring soon",
          `About ${Math.ceil(msLeft / 1000)}s of inactivity left. Move the mouse or press a key to stay signed in.`,
          8000,
        );
      },
      onExpired: () => {
        // No toast — hard logout navigates immediately; toast would flash then vanish.
        forceSessionLogout("idle");
      },
    });
    const onExpired = () => {
      forceSessionLogout("idle");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      stop();
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    };
  }, [allowed]);

  // Light touch on navigation so idle timer resets without restarting the monitor.
  useEffect(() => {
    if (!allowed) return;
    touchSessionActivity();
  }, [allowed, pathname]);

  useEffect(() => {
    if (!allowed) return;
    bindPersistFlushOnUnload();
    let cancelled = false;
    const BOOT_RELOAD_KEY = "financeiag-boot-reload-v1";

    // Unlock as soon as hydrate reaches interactive (bootstrap + settings).
    const onHydrateReady = (event: Event) => {
      const phase = (event as CustomEvent<{ phase?: string }>).detail?.phase;
      if (
        phase === "interactive" ||
        phase === "paint-cache" ||
        phase === "badge" ||
        phase === "catalog"
      ) {
        if (!cancelled) setBootReady(true);
      }
    };
    window.addEventListener(DB_SYNC_READY_EVENT, onHydrateReady);

    async function boot() {
      if (!FRONTEND_ONLY) {
        scrubBusinessLocalStorage();
      }

      const skipHydrate = consumeSkipHydrateOnce();
      // Force only after login / identity change — warm refreshes soft-hydrate.
      const forceHydrate = isWithinLoginGrace() || bootEpoch > 0;

      try {
        // Paint IndexedDB snapshot before network so refresh feels instant.
        if (!skipHydrate && !forceHydrate) {
          try {
            const { restorePaintCache } = await import("@/lib/db/paint-cache");
            const { readAuthSession } = await import("@/lib/auth");
            const painted = await restorePaintCache(readAuthSession()?.userId);
            if (painted && !cancelled) setBootReady(true);
          } catch {
            /* ignore */
          }
        }

        // Cap hydrate so a hung API cannot leave the shimmer forever.
        await Promise.race([
          (async () => {
            if (!skipHydrate) {
              try {
                await hydrateFromDatabase({ force: forceHydrate });
              } catch {
                /* keep paint cache / memory */
              }
            } else {
              markDbHydratedThisTab(true);
            }
          })(),
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, forceHydrate ? 8_000 : 4_000);
          }),
        ]);
        if (cancelled) return;
        // Soft second pass only after interactive unlock — never inside the 8s race.
        // Do not force-hydrate (that clears the hydrated flag + flushes again).
        if (
          !skipHydrate &&
          isDbHydratedThisTab() &&
          lastHydrateLoadedRemoteData() &&
          getMemoryLedgerAccounts().length === 0
        ) {
          void hydrateLedgerFromDatabase().catch(() => undefined);
        }
        void fetchDailyExchangeRatesOnce();

        clearDemoDataOnce();
        removeCashAtHandAccountOnce();
        // Never invent CoA / banks / divisions in the browser — API/Postgres only.
        const banksRenamed = migrateMirroredBankAccountNamesOnce();
        const banksCleared = clearDefaultSeededBankAccountsOnce();
        const statementsCleared = clearImportedBankStatementsOnce();
        ensureRecommendedLayouts();

        const needsSoftRefresh = banksRenamed || banksCleared || statementsCleared;

        if (needsSoftRefresh) {
          window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
          window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
        }
        try {
          sessionStorage.removeItem(BOOT_RELOAD_KEY);
        } catch {
          /* ignore */
        }
      } finally {
        if (!cancelled) {
          bootedUserId.current = readAuthSession()?.userId ?? bootedUserId.current;
          setBootReady(true);
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
      window.removeEventListener(DB_SYNC_READY_EVENT, onHydrateReady);
    };
  }, [allowed, bootEpoch]);


  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const onSearchOpenChange = useCallback((next: boolean) => setSearchOpen(next), []);

  const value = useMemo(
    () => ({
      openSidebar,
      openSearch,
    }),
    [openSidebar, openSearch],
  );

  // First paint / session restore / guest redirect — never dashboard chrome
  // for a visitor who is still being sent to sign-in. After password login
  // (grace / session) never show LoginPageSkeleton — go straight to chrome.
  if (!shellMounted && !isPostLoginUnlock()) {
    if (isPublicMainPath(pathname)) {
      return <BootSplash />;
    }
    return <LoginPageSkeleton />;
  }

  // Hold real routes until hydrate unlocks. Sidebar + page unlock together —
  // never paint real nav alone over a content-only shimmer.
  // Right after login, bootReady starts true so chrome + page paint as one.
  const showContentShimmer =
    (allowed && !bootReady) || (!allowed && !authReady);
  const contentUnlocked = !showContentShimmer;

  // Full-shell gate: sidebar skeleton + page skeleton until unlock, then both
  // real chrome and route content mount in the same soft paint.
  if (!contentUnlocked) {
    return (
      <ShellContext.Provider value={value}>
        <ShellLoadingSkeleton />
      </ShellContext.Provider>
    );
  }

  return (
    <ShellContext.Provider value={value}>
      <div className="flex h-dvh w-full overflow-hidden bg-white motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500">
        <AppSidebar
          open={sidebarOpen}
          onClose={closeSidebar}
          active={active}
          onOpenSearch={openSearch}
        />
        <div className="no-scrollbar flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden bg-[#fbfbfc] [scrollbar-gutter:stable]">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col animate-in fade-in duration-500 fill-mode-both">
              <Suspense fallback={<ModulePageSkeleton />}>{children}</Suspense>
            </div>
          </div>
        </div>
      </div>
      {searchOpen ? (
        <GlobalSearch open={searchOpen} onOpenChange={onSearchOpenChange} />
      ) : null}
      <ForceChangePasswordDialog />
      <PersistFailureToaster />
      <RealtimeListener />
      <UserActivityTracker />
      <PwaRegister />
    </ShellContext.Provider>
  );
}
