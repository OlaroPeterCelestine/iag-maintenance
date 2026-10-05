"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { ForceChangePasswordDialog } from "@/components/change-password-dialog";
import { GlobalSearch } from "@/components/global-search";
import {
  BootSplash,
  LoginPageSkeleton,
  ModulePageSkeleton,
} from "@/components/page-loading";
import { PersistFailureToaster } from "@/components/persist-failure-toaster";
import { RealtimeListener } from "@/components/realtime-listener";
import { PwaRegister } from "@/components/pwa-register";
import { UserActivityTracker } from "@/components/user-activity-tracker";
import {
  clearDemoDataOnce,
  removeCashAtHandAccountOnce,
} from "@/lib/clear-demo-data";
import {
  bindPersistFlushOnUnload,
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [shellMounted, setShellMounted] = useState(false);
  /** First Postgres hydrate finished — keep shimmer until then so refresh never flashes empty tables. */
  const [bootReady, setBootReady] = useState(false);
  const optimisticBooted = useRef(false);
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
    if (!allowed || bootReady) return;
    bindPersistFlushOnUnload();
    let cancelled = false;
    const BOOT_RELOAD_KEY = "financeiag-boot-reload-v1";

    async function boot() {
      if (!FRONTEND_ONLY) {
        scrubBusinessLocalStorage();
      }

      const skipHydrate = consumeSkipHydrateOnce();

      try {
        // Cap hydrate so a hung API cannot leave the shimmer forever.
        await Promise.race([
          (async () => {
            if (!skipHydrate) {
              try {
                await hydrateFromDatabase({ force: true });
              } catch {
                /* keep local cache */
              }
            } else {
              markDbHydratedThisTab(true);
            }
          })(),
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, 8_000);
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
    };
  }, [allowed, bootReady]);

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
  // for a visitor who is still being sent to sign-in.
  if (!shellMounted) {
    if (isPublicMainPath(pathname)) {
      return <BootSplash />;
    }
    return <LoginPageSkeleton />;
  }

  // Shimmer while auth restore or first DB hydrate is still running — never blank white.
  const showContentShimmer =
    (allowed && !bootReady) || (!allowed && !authReady);

  return (
    <ShellContext.Provider value={value}>
      <div className="flex h-dvh w-full overflow-hidden bg-white">
        <Suspense fallback={null}>
          <AppSidebar
            open={sidebarOpen}
            onClose={closeSidebar}
            active={active}
            onOpenSearch={openSearch}
          />
        </Suspense>
        <div className="no-scrollbar flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden bg-[#fbfbfc]">
          <div className="flex min-h-0 flex-1 flex-col">
            {showContentShimmer ? (
              <ModulePageSkeleton />
            ) : (
              <Suspense fallback={<ModulePageSkeleton />}>{children}</Suspense>
            )}
          </div>
        </div>
      </div>
      <GlobalSearch open={searchOpen} onOpenChange={onSearchOpenChange} />
      <ForceChangePasswordDialog />
      <PersistFailureToaster />
      <RealtimeListener />
      <UserActivityTracker />
      <PwaRegister />
    </ShellContext.Provider>
  );
}
