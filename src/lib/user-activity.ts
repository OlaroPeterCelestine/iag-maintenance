"use client";

import { apiFetch } from "@/lib/api-auth";
import { isAuthenticated, readAuthSession } from "@/lib/auth";
import { FRONTEND_ONLY } from "@/lib/frontend-only";
import { postToolsAuditEvent } from "@/lib/tools-activity-client";

export type UserActivityAction =
  | "PageView"
  | "Viewed"
  | "Opened"
  | "Searched"
  | "Exported"
  | "Printed"
  | "Tried"
  | "AccessDenied"
  | "Clicked"
  | "Filtered"
  | "Uploaded"
  | "Downloaded";

export type UserActivityInput = {
  action: UserActivityAction;
  module?: string;
  entity?: string;
  recordId?: string;
  recordLabel?: string;
  details?: string;
  path?: string;
  page?: string;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

const DEDUPE_MS = 20_000;
const recent = new Map<string, number>();
const queue: UserActivityInput[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function pageTitleFromPath(pathname: string, search = ""): string {
  const path = pathname.replace(/\/$/, "") || "/";
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const view = params.get("view") || params.get("tab") || "";

  const map: Record<string, string> = {
    "/": "Dashboard",
    "/login": "Login",
    "/settings": "Settings",
    "/users": "Users",
    "/profile": "Profile",
    "/guides": "Guides",
    "/templates": "Templates",
    "/comms": "Comms",
    "/accounting-documents": "Accounting documents",
    "/payment-requests": "Approval desk",
    "/request-emails": "Request emails",
    "/activity-logs": "Activity logs",
    "/crash-analytics": "Crash analytics",
    "/analytics": "App analytics",
    "/lab": "Product development lab",
    "/qa": "Quality Assurance",
    "/sales": "Sales",
    "/purchases": "Purchases",
    "/banking": "Banking",
    "/accounts": "Accounts",
    "/payroll": "Payroll",
    "/projects": "Project manager",
    "/contract-manager": "Contract manager",
    "/fleet": "Fleet",
    "/security": "Security",
    "/production": "Production",
    "/inventory": "Inventory",
    "/pos": "POS",
    "/reports": "Reports",
    "/documents": "Documents",
    "/investments": "Investments",
    "/assets": "Assets",
    "/capital": "Capital",
    "/receipts-payments": "Receipts & payments",
    "/expense-claims": "Expense claims",
    "/requests": "Requests",
    "/general-requests": "General requests",
    "/oral-payment-requests": "Oral payment requests",
  };

  const base = map[path] || path.replace(/^\//, "").replace(/-/g, " ") || "App";
  if (!view) return base;
  const nice = view.replace(/-/g, " ");
  return `${base} · ${nice}`;
}

function moduleFromPath(pathname: string): string {
  const slug = (pathname.replace(/^\//, "").split("/")[0] || "app").trim();
  if (!slug || slug === "") return "app";
  return slug;
}

function shouldSend(key: string): boolean {
  const now = Date.now();
  const last = recent.get(key) || 0;
  if (now - last < DEDUPE_MS) return false;
  recent.set(key, now);
  if (recent.size > 120) {
    const cutoff = now - DEDUPE_MS * 3;
    for (const [k, t] of recent) {
      if (t < cutoff) recent.delete(k);
    }
  }
  return true;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, 400);
}

async function flushQueue() {
  if (flushing || !queue.length) return;
  if (typeof window === "undefined" || !isAuthenticated()) {
    queue.length = 0;
    return;
  }
  flushing = true;
  const batch = queue.splice(0, 12);
  try {
    for (const item of batch) {
      const path =
        item.path ||
        `${window.location.pathname}${window.location.search}` ||
        "/";
      const page = item.page || pageTitleFromPath(window.location.pathname, window.location.search);
      const moduleName = item.module || moduleFromPath(window.location.pathname);
      const entity = item.entity || "navigation";
      const details =
        item.details ||
        (item.action === "PageView"
          ? `Opened ${page} (${path})`
          : `${item.action} on ${page}`);

      const sessionId = readAuthSession()?.sessionId || "";
      if (FRONTEND_ONLY) {
        postToolsAuditEvent({
          action: item.action,
          module: moduleName,
          entity,
          recordId: item.recordId || path.slice(0, 120),
          recordLabel: item.recordLabel || page,
          details: details.slice(0, 1000),
          path,
          page,
          meta: {
            referrer: document.referrer ? document.referrer.slice(0, 300) : "",
            ...(sessionId ? { sessionId } : {}),
            ...(item.meta || {}),
          },
        });
        continue;
      }
      await apiFetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: item.action,
          module: moduleName,
          entity,
          recordId: item.recordId || path.slice(0, 120),
          recordLabel: item.recordLabel || page,
          details: details.slice(0, 1000),
          meta: {
            path,
            page,
            href: window.location.href.slice(0, 500),
            referrer: document.referrer ? document.referrer.slice(0, 300) : "",
            ...(sessionId ? { sessionId } : {}),
            ...(item.meta || {}),
          },
        }),
      }).catch(() => null);
    }
  } finally {
    flushing = false;
    if (queue.length) scheduleFlush();
  }
}

/** Fire-and-forget user activity (page views, opens, searches, exports…). */
export function trackUserActivity(input: UserActivityInput): void {
  if (typeof window === "undefined") return;
  if (!isAuthenticated()) return;

  const path =
    input.path || `${window.location.pathname}${window.location.search}` || "/";
  const dedupeKey = `${input.action}|${path}|${input.details || ""}|${input.recordId || ""}`;
  if (!shouldSend(dedupeKey)) return;

  queue.push(input);
  scheduleFlush();
}

/** Log a page/route visit. Call on each meaningful navigation. */
export function trackPageView(pathname: string, search = ""): void {
  const path = `${pathname}${search || ""}`;
  const page = pageTitleFromPath(pathname, search);
  trackUserActivity({
    action: "PageView",
    module: moduleFromPath(pathname),
    entity: "navigation",
    path,
    page,
    recordLabel: page,
    details: `Opened ${page} (${path})`,
    meta: {
      view: new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("view") || "",
    },
  });
}

export function trackAccessDenied(pathname: string, reason?: string): void {
  trackUserActivity({
    action: "AccessDenied",
    module: moduleFromPath(pathname),
    entity: "navigation",
    path: pathname,
    page: pageTitleFromPath(pathname),
    details: reason || `Access denied to ${pathname}`,
  });
}
