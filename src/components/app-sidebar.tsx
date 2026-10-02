"use client";

import { Brand } from "@/components/brand";
import { GlobalSearchTrigger } from "@/components/global-search";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getAppFlag, setAppFlag } from "@/lib/db/app-prefs";
import { DB_SYNC_READY_EVENT, isHydrateBusy } from "@/lib/db/sync";
import { moduleIcons, iconForNav } from "@/lib/iconsax";
import { DEFAULT_ENABLED_TABS, loadEnabledTabs } from "@/lib/manager-settings";
import { type ModuleSlug, NAV_MODULES } from "@/lib/module-data";
import { entityKey } from "@/lib/manager-entities";
import { cn } from "@/lib/utils";
import {
  ArrowRight2,
  Book1,
  CloseSquare,
  DocumentText,
  Element3,
  Layer,
  MessageText1,
  MoneySend,
  Setting2,
  SidebarLeft,
  SidebarRight,
  Logout,
  Profile2User,
  Sms,
  Task,
  Danger,
  Chart21,
  MessageQuestion,
  Activity,
  Note1,
} from "iconsax-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AUTH_CHANGED_EVENT, logout } from "@/lib/auth";
import {
  canAccessModule,
  canAccessPath,
  canAccessSpecialNav,
  isContractorRole,
} from "@/lib/access-control";
import {
  countSidebarApprovalsPending,
  currentApprovalDesk,
  DESK_ENTITY_MODULES,
} from "@/lib/approval-desk";
import { fetchApprovalDesk } from "@/lib/approval-api";
import {
  getCurrentSessionUser,
  type SessionUser,
} from "@/lib/session-profile";

const SIDEBAR_COLLAPSED_KEY = "financeiag-sidebar-collapsed";

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

function clearStuckModality() {
  if (typeof document === "undefined") return;
  document.querySelectorAll("[inert], [data-base-ui-inert]").forEach((node) => {
    if (node.closest('[data-slot="dialog-content"][data-open]')) return;
    if (node.closest('[data-slot="alert-dialog-content"][data-open]')) return;
    if (node.hasAttribute("inert")) node.removeAttribute("inert");
    if (node.hasAttribute("data-base-ui-inert")) node.removeAttribute("data-base-ui-inert");
  });
}

function AppSidebarImpl({
  open,
  onClose,
  onOpenSearch,
  active = "dashboard",
}: {
  open: boolean;
  onClose: () => void;
  onOpenSearch: () => void;
  active?: SidebarActive;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [enabledTabs, setEnabledTabs] = useState<ModuleSlug[]>(DEFAULT_ENABLED_TABS);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [navTick, setNavTick] = useState(0);
  const [approvalsPending, setApprovalsPending] = useState(0);
  const [deskNavLabel, setDeskNavLabel] = useState("Approval desk");
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeInventoryView = searchParams.get("view") || "";
  const overviewHref = "/";

  const canEditSettings = useMemo(() => canAccessSpecialNav("settings"), [navTick, sessionUser?.id, sessionUser?.role]);
  const canSeeOverview = useMemo(
    () => canAccessPath(overviewHref),
    // overviewHref depends on role (contractor portal vs dashboard).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionUser/navTick gate access
    [overviewHref, navTick, sessionUser?.id, sessionUser?.role],
  );
  const canSeeGuides = false;
  const canSeeQna = false;
  const canSeeReleaseNotes = false;
  const canSeeTemplates = false;
  const canSeeComms = false;
  const canSeeDocsPack = false;
  const canSeePaymentRequests = false;
  const hasMainNav =
    canSeeOverview ||
    canSeeGuides ||
    canSeeQna ||
    canSeeReleaseNotes ||
    canSeeTemplates ||
    canSeeComms ||
    canSeeDocsPack ||
    canSeePaymentRequests;

  const modules = useMemo(
    () =>
      NAV_MODULES.filter((m) => enabledTabs.includes(m.slug))
        .filter((m) => {
          try {
            return canAccessModule(m.slug);
          } catch {
            return false;
          }
        })
        .map((m) => ({
          ...m,
          icon: moduleIcons[m.slug],
        })),
    // navTick forces refresh after role/auth changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionUser/navTick gate access
    [enabledTabs, navTick, sessionUser?.role, sessionUser?.id],
  );

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let idleHandle: number | undefined;

    const runCount = () => {
      if (isHydrateBusy()) return;
      try {
        const profile = currentApprovalDesk();
        setDeskNavLabel(profile?.navLabel || "My requests");
        void fetchApprovalDesk().then((result) => {
          if (result.ok) {
            // Desk queue count for approvers; requestors use attention (rejected / amendments).
            const deskCount = result.count ?? 0;
            const attentionCount = result.attentionCount ?? (result.attention || []).length;
            setApprovalsPending(profile ? deskCount + attentionCount : attentionCount);
            return;
          }
          if (profile) {
            setApprovalsPending(countSidebarApprovalsPending(profile));
            return;
          }
          setApprovalsPending(0);
        });
      } catch {
        setApprovalsPending(0);
      }
    };

    const scheduleRefresh = () => {
      clearTimeout(debounceTimer);
      if (typeof idleHandle === "number" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
      // Wait for event storms to settle, then count on an idle frame.
      debounceTimer = setTimeout(() => {
        if (isHydrateBusy()) {
          scheduleRefresh();
          return;
        }
        if ("requestIdleCallback" in window) {
          idleHandle = window.requestIdleCallback(() => runCount(), { timeout: 1500 });
        } else {
          runCount();
        }
      }, 800);
    };

    scheduleRefresh();

    const onRecordsChanged = (event: Event) => {
      const detail = (event as CustomEvent | undefined)?.detail as
        | { module?: string; entity?: string }
        | undefined;
      // Ignore unrelated entity churn — full scans used to freeze the sidebar.
      // Refresh for every approval-desk entity (oral/general/leave/fleet/payments).
      if (detail?.module && detail?.entity) {
        const moduleForEntity = DESK_ENTITY_MODULES[detail.entity];
        const relevant = Boolean(
          moduleForEntity && moduleForEntity === detail.module,
        );
        if (!relevant) return;
      }
      scheduleRefresh();
    };

    window.addEventListener("financeiag-records-changed", onRecordsChanged);
    window.addEventListener(DB_SYNC_READY_EVENT, scheduleRefresh);
    window.addEventListener(AUTH_CHANGED_EVENT, scheduleRefresh);
    return () => {
      clearTimeout(debounceTimer);
      if (typeof idleHandle === "number" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
      window.removeEventListener("financeiag-records-changed", onRecordsChanged);
      window.removeEventListener(DB_SYNC_READY_EVENT, scheduleRefresh);
      window.removeEventListener(AUTH_CHANGED_EVENT, scheduleRefresh);
    };
  }, []);

  // Clear stuck inert only when dialogs close — not on every route change (DOM scan is expensive).
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest?.("[data-slot='dialog-content'], [data-slot='alert-dialog-content']")) {
        // Closing via overlay/escape often leaves inert briefly; clear on next tick.
        window.setTimeout(clearStuckModality, 0);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  useEffect(() => {
    function onTabsChanged() {
      setEnabledTabs(loadEnabledTabs());
    }
    function onUserChanged() {
      setSessionUser(getCurrentSessionUser());
      setNavTick((n) => n + 1);
    }
    try {
      setCollapsed(getAppFlag(SIDEBAR_COLLAPSED_KEY));
    } catch {
      /* keep expanded until prefs load */
    }
    try {
      setEnabledTabs(loadEnabledTabs());
    } catch {
      /* keep defaults until prefs load */
    }
    onUserChanged();
    window.addEventListener("financeiag-tabs-changed", onTabsChanged);
    window.addEventListener("storage", onTabsChanged);
    window.addEventListener("storage", onUserChanged);
    window.addEventListener(AUTH_CHANGED_EVENT, onUserChanged);
    return () => {
      window.removeEventListener("financeiag-tabs-changed", onTabsChanged);
      window.removeEventListener("storage", onTabsChanged);
      window.removeEventListener("storage", onUserChanged);
      window.removeEventListener(AUTH_CHANGED_EVENT, onUserChanged);
    };
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      setAppFlag(SIDEBAR_COLLAPSED_KEY, next);
      return next;
    });
  }, []);

  const navClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const prefetchRoute = useCallback(
    (href: string) => {
      try {
        router.prefetch(href);
      } catch {
        /* ignore */
      }
      // Warm the entity workspace chunk before click.
      void import("@/components/module-entity-records");
      void import("@/components/module-page");
    },
    [router],
  );

  const openSearchAndClose = useCallback(() => {
    onOpenSearch();
    onClose();
  }, [onOpenSearch, onClose]);

  const handleLogout = useCallback(() => {
    // logout() hard-navigates to /login immediately.
    logout();
  }, []);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-900/30 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          // z-[60] keeps nav above stuck dialog overlays (z-50) so clicks never feel dead.
          "fixed inset-y-0 left-0 z-[60] flex h-dvh flex-col overflow-hidden border-r border-slate-200/90 bg-[#f7f8f9] py-4 transition-[width,translate] duration-200 ease-out lg:sticky lg:top-0 lg:z-[60] lg:h-dvh lg:shrink-0 lg:translate-x-0",
          collapsed ? "w-[72px] px-2" : "w-[248px] px-3",
          open
            ? "translate-x-0 pointer-events-auto"
            : "-translate-x-full max-lg:pointer-events-none lg:pointer-events-auto lg:translate-x-0",
        )}
      >
        <div
          className={cn(
            "mb-3 flex h-8 items-center",
            collapsed ? "justify-center" : "justify-between px-1",
          )}
        >
          <Brand showWordmark={!collapsed} className={collapsed ? "justify-center" : undefined} />
          {!collapsed && (
            <button
              type="button"
              className="hidden size-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 lg:inline-flex"
              onClick={toggleCollapsed}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <SidebarLeft size={15} variant="Linear" color="currentColor" />
            </button>
          )}
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 lg:hidden"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <CloseSquare size={16} variant="Linear" color="currentColor" />
          </button>
        </div>

        {collapsed && (
          <button
            type="button"
            className="mb-3 hidden size-9 items-center justify-center self-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 lg:inline-flex"
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <SidebarRight size={16} variant="Linear" color="currentColor" />
          </button>
        )}

        <GlobalSearchTrigger
          collapsed={collapsed}
          onOpen={openSearchAndClose}
        />

        <nav className="no-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden">
          {hasMainNav ? (
          <div>
            {!collapsed && (
              <p className="mb-1.5 px-2 text-[10px] font-medium tracking-[0.06em] text-slate-400">
                MAIN NAVIGATION
              </p>
            )}
            <div className={cn("space-y-0.5", collapsed && "flex flex-col items-center")}>
              {canSeeOverview ? (
                <Link
                  href={overviewHref}
                  onClick={navClick}
                  onMouseEnter={() => prefetchRoute(overviewHref)}
                  prefetch
                  title={isContractorRole(sessionUser?.role) ? "Contractor home" : "Production"}
                  className={cn(
                    "relative flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                    collapsed ? "w-9 justify-center px-0" : "w-full px-2.5",
                    active === "dashboard" &&
                      "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                  )}
                >
                  <Element3 size={15} variant="Linear" color="currentColor" />
                  {!collapsed && (
                    <span>{isContractorRole(sessionUser?.role) ? "Home" : "Production"}</span>
                  )}
                </Link>
              ) : null}
              {canSeeGuides ? (
                <Link
                  href="/guides"
                  onClick={navClick}
                  title="Guides"
                  className={cn(
                    "relative flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                    collapsed ? "w-9 justify-center px-0" : "w-full px-2.5",
                    active === "guides" &&
                      "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                  )}
                >
                  <Book1 size={15} variant="Linear" color="currentColor" />
                  {!collapsed && <span>Guides</span>}
                </Link>
              ) : null}
              {canSeeQna ? (
                <Link
                  href="/qna"
                  onClick={navClick}
                  title="Product development questions and answers"
                  className={cn(
                    "relative flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                    collapsed ? "w-9 justify-center px-0" : "w-full px-2.5",
                    active === "qna" &&
                      "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                  )}
                >
                  <MessageQuestion size={15} variant="Linear" color="currentColor" />
                  {!collapsed && <span>Q&amp;A</span>}
                </Link>
              ) : null}
              {canSeeReleaseNotes ? (
                <Link
                  href="/release-notes"
                  onClick={navClick}
                  title="Release notes"
                  className={cn(
                    "relative flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                    collapsed ? "w-9 justify-center px-0" : "w-full px-2.5",
                    active === "release-notes" &&
                      "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                  )}
                >
                  <Note1 size={15} variant="Linear" color="currentColor" />
                  {!collapsed && <span>Release notes</span>}
                </Link>
              ) : null}
              {canSeeTemplates ? (
                <Link
                  href="/templates"
                  onClick={navClick}
                  title="Document templates"
                  className={cn(
                    "relative flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                    collapsed ? "w-9 justify-center px-0" : "w-full px-2.5",
                    active === "templates" &&
                      "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                  )}
                >
                  <Layer size={15} variant="Linear" color="currentColor" />
                  {!collapsed && <span>Templates</span>}
                </Link>
              ) : null}
              {canSeeComms ? (
                <Link
                  href="/comms"
                  onClick={navClick}
                  title="Comms — calendar, email, SMS"
                  className={cn(
                    "relative flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                    collapsed ? "w-9 justify-center px-0" : "w-full px-2.5",
                    active === "comms" &&
                      "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                  )}
                >
                  <MessageText1 size={15} variant="Linear" color="currentColor" />
                  {!collapsed && <span>Comms</span>}
                </Link>
              ) : null}
              {canSeeDocsPack ? (
                <Link
                  href="/accounting-documents"
                  onClick={navClick}
                  title="Accounting documents"
                  className={cn(
                    "relative flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                    collapsed ? "w-9 justify-center px-0" : "w-full px-2.5",
                    active === "accounting-documents" &&
                      "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                  )}
                >
                  <DocumentText size={15} variant="Linear" color="currentColor" />
                  {!collapsed && <span>Documents pack</span>}
                </Link>
              ) : null}
              {canSeePaymentRequests ? (
                <Link
                  href="/payment-requests"
                  onClick={navClick}
                  title={deskNavLabel}
                  className={cn(
                    "relative flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                    collapsed ? "w-9 justify-center px-0" : "w-full px-2.5",
                    active === "payment-requests" &&
                      "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                  )}
                >
                  <MoneySend size={15} variant="Linear" color="currentColor" />
                  {!collapsed && <span className="flex-1">{deskNavLabel}</span>}
                  {approvalsPending > 0 ? (
                    <span
                      className={cn(
                        "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                        collapsed && "absolute -top-0.5 -right-0.5 min-w-4 px-1",
                        active === "payment-requests"
                          ? "bg-white/25 text-white"
                          : "bg-amber-100 text-amber-800",
                      )}
                    >
                      {approvalsPending > 99 ? "99+" : approvalsPending}
                    </span>
                  ) : null}
                </Link>
              ) : null}
            </div>
          </div>
          ) : null}

          {modules.length > 0 ? (
          <div>
            {!collapsed && (
              <p className="mb-1.5 px-2 text-[10px] font-medium tracking-[0.06em] text-slate-400">
                Production
              </p>
            )}
            <div className={cn("space-y-0.5", collapsed && "flex flex-col items-center")}>
              {modules.map((section) => {
                const isActiveModule = active === section.slug;

                return (
                  <div
                    key={section.label}
                    className={cn(collapsed && "flex w-full flex-col items-center")}
                  >
                    {section.slug === "production" ? (
                      <div className={cn("space-y-0.5", collapsed && "flex w-full flex-col items-center")}>
                        {section.items.map((label) => {
                          const key = entityKey(label);
                          const href = `/production?view=${encodeURIComponent(key)}`;
                          const isActiveView = isActiveModule && activeInventoryView === key;
                          const ItemIcon = iconForNav(label);
                          return (
                            <Link
                              key={key}
                              href={href}
                              onClick={navClick}
                              title={label}
                              className={cn(
                                "relative flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] transition-colors",
                                collapsed ? "w-9 justify-center px-0" : "w-full px-2.5",
                                isActiveView
                                  ? "bg-slate-900 font-medium text-white shadow-sm hover:bg-slate-900 hover:text-white"
                                  : "text-slate-500 hover:bg-white hover:text-slate-800",
                              )}
                            >
                              <ItemIcon size={15} variant="Linear" className="shrink-0" color="currentColor" />
                              {!collapsed && <span className="truncate">{label}</span>}
                            </Link>
                          );
                        })}
                      </div>
                    ) : (
                    <Link
                      href={section.href}
                      onClick={navClick}
                      onMouseEnter={() => prefetchRoute(section.href)}
                      title={section.label}
                      className={cn(
                        "relative flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] transition-colors",
                        collapsed ? "w-9 justify-center px-0" : "w-full px-2.5",
                        isActiveModule
                          ? "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white"
                          : "text-slate-500 hover:bg-white hover:text-slate-800",
                      )}
                    >
                      <section.icon size={15} variant="Linear" className="shrink-0" color="currentColor" />
                      {!collapsed && <span className="truncate">{section.label}</span>}
                    </Link>
                    )}

                    {section.slug === "reports" && canEditSettings ? (
                      <>
                        <Link
                          href="/users"
                          onClick={navClick}
                          title="Users & roles"
                          className={cn(
                            "relative mt-0.5 flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                            collapsed ? "mx-auto w-9 justify-center px-0" : "w-full px-2.5",
                            active === "users" &&
                              "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                          )}
                        >
                          <Profile2User size={15} variant="Linear" color="currentColor" />
                          {!collapsed && <span>Users & roles</span>}
                        </Link>
                        <Link
                          href="/request-emails"
                          onClick={navClick}
                          title="Request emails"
                          className={cn(
                            "relative mt-0.5 flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                            collapsed ? "mx-auto w-9 justify-center px-0" : "w-full px-2.5",
                            active === "request-emails" &&
                              "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                          )}
                        >
                          <Sms size={15} variant="Linear" color="currentColor" />
                          {!collapsed && <span>Request emails</span>}
                        </Link>
                        <Link
                          href="/analytics"
                          onClick={navClick}
                          title="App analytics"
                          className={cn(
                            "relative mt-0.5 flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                            collapsed ? "mx-auto w-9 justify-center px-0" : "w-full px-2.5",
                            active === "analytics" &&
                              "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                          )}
                        >
                          <Chart21 size={15} variant="Linear" color="currentColor" />
                          {!collapsed && <span>Analytics</span>}
                        </Link>
                        <Link
                          href="/activity-logs"
                          onClick={navClick}
                          title="Activity logs"
                          className={cn(
                            "relative mt-0.5 flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                            collapsed ? "mx-auto w-9 justify-center px-0" : "w-full px-2.5",
                            active === "activity-logs" &&
                              "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                          )}
                        >
                          <Task size={15} variant="Linear" color="currentColor" />
                          {!collapsed && <span>Activity logs</span>}
                        </Link>
                        <Link
                          href="/crash-analytics"
                          onClick={navClick}
                          title="Crash analytics"
                          className={cn(
                            "relative mt-0.5 flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                            collapsed ? "mx-auto w-9 justify-center px-0" : "w-full px-2.5",
                            active === "crash-analytics" &&
                              "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                          )}
                        >
                          <Danger size={15} variant="Linear" color="currentColor" />
                          {!collapsed && <span>Crash analytics</span>}
                        </Link>
                        <Link
                          href="/system-health"
                          onClick={navClick}
                          title="System health"
                          className={cn(
                            "relative mt-0.5 flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                            collapsed ? "mx-auto w-9 justify-center px-0" : "w-full px-2.5",
                            active === "system-health" &&
                              "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                          )}
                        >
                          <Activity size={15} variant="Linear" color="currentColor" />
                          {!collapsed && <span>System health</span>}
                        </Link>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          ) : null}

          <div className={cn(collapsed && "flex justify-center")}>
            {canEditSettings ? (
              <Link
                href="/settings"
                onClick={navClick}
                title="Settings"
                className={cn(
                  "relative flex h-8 items-center gap-2.5 rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
                  collapsed ? "w-9 justify-center px-0" : "w-full px-2.5",
                  active === "settings" &&
                    "bg-orange-500 font-medium text-white shadow-sm hover:bg-orange-500 hover:text-white",
                )}
              >
                <Setting2 size={15} variant="Linear" color="currentColor" />
                {!collapsed && <span>Settings</span>}
              </Link>
            ) : null}
          </div>
        </nav>

        <div className="mt-3 shrink-0 border-t border-slate-200/80 pt-3">
          {!collapsed && (
            <p className="mb-1.5 px-2 text-[10px] font-medium tracking-[0.06em] text-slate-400">
              ACCOUNT
            </p>
          )}
          <Link
            href="/profile"
            title={`${sessionUser?.name || sessionUser?.username || "Signed in"} — ${sessionUser?.role || "User"}${sessionUser?.id ? ` · ${sessionUser.id}` : ""}`}
            className={cn(
              "flex items-center rounded-xl border border-slate-200 bg-white text-left shadow-sm transition-colors hover:bg-slate-50",
              collapsed ? "mx-auto size-10 justify-center p-0" : "w-full gap-2 p-2",
              active === "profile" && "border-orange-200 bg-orange-50",
            )}
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-teal-50 text-[10px] font-semibold text-teal-700">
                {sessionUser?.initials || "—"}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold text-slate-800">
                    {sessionUser?.name || sessionUser?.username || "Signed in"}
                  </span>
                  <span className="block truncate text-[9px] text-slate-400">
                    {sessionUser?.role || "User"}
                    {sessionUser?.id ? ` · ${sessionUser.id.slice(0, 8)}` : ""}
                  </span>
                </span>
                <ArrowRight2 size={14} variant="Linear" className="text-slate-400" color="currentColor" />
              </>
            )}
          </Link>
          <button
            type="button"
            title="Log out"
            onClick={handleLogout}
            className={cn(
              "mt-1.5 flex items-center rounded-md text-left text-[13px] text-slate-500 transition-colors hover:bg-white hover:text-slate-800",
              collapsed ? "mx-auto size-9 justify-center px-0" : "h-8 w-full gap-2.5 px-2.5",
            )}
          >
            <Logout size={15} variant="Linear" color="currentColor" />
            {!collapsed && <span>Log out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

/** Memoized so parent shell re-renders (children route) don't rebuild the whole nav tree. */
export const AppSidebar = memo(AppSidebarImpl);
