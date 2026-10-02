"use client";

import { useAppShell } from "@/components/app-shell";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { PaginationBar } from "@/components/pagination-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePagination } from "@/hooks/use-pagination";
import { currentUserIsAdmin } from "@/lib/access-control";
import { FRONTEND_ONLY } from "@/lib/frontend-only";
import {
  fetchAdminActivity,
  fetchAdminSessions,
  type ActivityRow,
  type SessionRow,
} from "@/lib/activity-api";
import { fetchDbUsers, type DbUser } from "@/lib/auth-api";
import { HambergerMenu, Profile2User, Refresh, SearchNormal1, Task, Timer1 } from "iconsax-react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { appToastError } from "@/lib/app-toast";

type Tab = "users" | "sessions" | "events";

type UserSummary = {
  key: string;
  userId: string;
  name: string;
  username: string;
  email: string;
  role: string;
  status: string;
  sessionCount: number;
  activeCount: number;
  totalSeconds: number;
  lastSignedIn: string;
  lastIp: string;
  inDirectory: boolean;
};

function formatWhen(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type PersonRef = {
  userId?: string;
  userName?: string;
  name?: string;
  username?: string;
  email?: string;
};

type ResolvedPerson = {
  name: string;
  username: string;
  email: string;
  userId: string;
};

function looksLikeEmail(value: string): boolean {
  return value.includes("@");
}

/** Prefer a human name over email-as-name / raw ids. */
function pickDisplayName(candidates: Array<string | undefined>, username: string, email: string): string {
  for (const raw of candidates) {
    const v = (raw || "").trim();
    if (!v) continue;
    if (looksLikeEmail(v) && (username || email)) continue;
    return v;
  }
  if (username) return username;
  if (email) return email;
  return "Unknown user";
}

function resolvePerson(
  row: PersonRef,
  directoryById: Map<string, DbUser>,
  directoryByLogin: Map<string, DbUser>,
): ResolvedPerson {
  const userId = (row.userId || "").trim();
  const email = (row.email || "").trim();
  const usernameRaw = (row.username || "").trim();

  // When userId is known, never resolve by email/username — that mixes people up.
  if (userId) {
    const fromDir = directoryById.get(userId);
    const username = (fromDir?.username || usernameRaw || "").trim();
    const resolvedEmail = (fromDir?.email || email || "").trim();
    const name = pickDisplayName(
      [row.userName, row.name, fromDir?.name, username, resolvedEmail],
      username,
      resolvedEmail,
    );
    return {
      name,
      username,
      email: resolvedEmail,
      userId,
    };
  }

  const fromDir =
    (usernameRaw && directoryByLogin.get(usernameRaw.toLowerCase())) ||
    (email && directoryByLogin.get(email.toLowerCase())) ||
    undefined;

  const username = (fromDir?.username || usernameRaw || "").trim();
  const resolvedEmail = (fromDir?.email || email || "").trim();
  const name = pickDisplayName(
    [row.userName, row.name, fromDir?.name, username, resolvedEmail],
    username,
    resolvedEmail,
  );
  return {
    name,
    username,
    email: resolvedEmail,
    userId: fromDir?.id || "",
  };
}

function PersonCell({
  person,
  badge,
}: {
  person: ResolvedPerson;
  badge?: ReactNode;
}) {
  const email =
    person.email &&
    person.email.toLowerCase() !== person.username.toLowerCase() &&
    person.email.toLowerCase() !== person.name.toLowerCase()
      ? person.email
      : "";
  return (
    <div className="min-w-0 max-w-[16rem]">
      <div className="truncate font-medium text-slate-900 dark:text-slate-50" title={person.name}>
        {person.name}
      </div>
      {person.username ? (
        <div className="truncate font-mono text-[11px] text-slate-600 dark:text-slate-300" title={`@${person.username}`}>
          @{person.username}
        </div>
      ) : null}
      {email ? (
        <div className="truncate text-[11px] text-slate-400" title={email}>
          {email}
        </div>
      ) : null}
      {badge}
    </div>
  );
}

function DurationBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[12px] font-semibold whitespace-nowrap text-orange-800 dark:border-orange-900/50 dark:bg-orange-950/40 dark:text-orange-200">
      <Timer1 size={12} color="currentColor" />
      {label}
    </span>
  );
}

function StatusBadge({ active, children }: { active?: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
          : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      }`}
    >
      {children}
    </span>
  );
}

function tableShell(children: ReactNode, minWidth: string) {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <table className={`w-full ${minWidth} table-fixed text-left text-[13px]`}>{children}</table>
    </div>
  );
}

function Th({
  children,
  className = "",
  width,
}: {
  children: ReactNode;
  className?: string;
  width?: string;
}) {
  return (
    <th
      className={`border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] font-semibold tracking-wide whitespace-nowrap text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 ${className}`}
      style={width ? { width } : undefined}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`border-b border-slate-100 px-3 py-2.5 align-middle dark:border-slate-800 ${className}`}>
      {children}
    </td>
  );
}

function pageLabel(row: ActivityRow): string {
  return row.page || (typeof row.meta?.page === "string" ? row.meta.page : "") || row.recordLabel || "—";
}

function pathLabel(row: ActivityRow): string {
  return row.path || (typeof row.meta?.path === "string" ? row.meta.path : "") || "—";
}

function metaSummary(meta?: Record<string, unknown>): string {
  if (!meta) return "";
  const skip = new Set(["path", "page", "href", "userAgent"]);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (skip.has(k) || v == null || v === "") continue;
    parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    if (parts.length >= 6) break;
  }
  return parts.join(" · ");
}

function endReasonLabel(reason: string | undefined, status: string): string {
  if (status === "active") return "Still signed in";
  const r = (reason || "").trim().toLowerCase();
  if (r === "logout") return "Signed out";
  if (r === "idle") return "Idle timeout";
  if (r === "expired") return "Expired";
  if (r === "revoked" || r === "replaced") return r === "revoked" ? "Revoked" : "Replaced";
  return reason || "Ended";
}

function formatDurationSeconds(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export default function ActivityLogsPage() {
  const { openSidebar } = useAppShell();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>(FRONTEND_ONLY ? "events" : "users");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<DbUser[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sessionActions, setSessionActions] = useState<ActivityRow[]>([]);
  const [sessionActionsLoading, setSessionActionsLoading] = useState(false);
  const [q, setQ] = useState("");
  const [user, setUser] = useState("");
  const [ip, setIp] = useState("");
  const [module, setModule] = useState("");
  const [action, setAction] = useState("");
  const [path, setPath] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [draftQ, setDraftQ] = useState("");
  const [draftUser, setDraftUser] = useState("");
  const [draftIp, setDraftIp] = useState("");
  const [draftModule, setDraftModule] = useState("");
  const [draftAction, setDraftAction] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const [users, list] = await Promise.all([
        fetchDbUsers(),
        fetchAdminActivity({
          limit: 1000,
          q,
          user,
          ip,
          module,
          action,
          path,
          from,
          to,
        }),
      ]);
      setDirectoryUsers(users);
      setRows(list);
    } catch (err) {
      appToastError("Could not load activity", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [q, user, ip, module, action, path, from, to]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const [users, list] = await Promise.all([
        fetchDbUsers(),
        fetchAdminSessions({
          all: true,
          includeRevoked: true,
          limit: 1000,
          user,
        }),
      ]);
      setDirectoryUsers(users);
      setSessions(list);
    } catch (err) {
      appToastError("Could not load sessions", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    try {
      if (FRONTEND_ONLY) {
        const list = await fetchAdminActivity({
          limit: 1000,
          q,
          user,
          ip,
          module,
          action,
          path,
          from,
          to,
        });
        setDirectoryUsers([]);
        setSessions([]);
        setRows(list);
        return;
      }
      const [users, list] = await Promise.all([
        fetchDbUsers(),
        fetchAdminSessions({ all: true, includeRevoked: true, limit: 1000, user }),
      ]);
      setDirectoryUsers(users);
      setSessions(list);
    } catch (err) {
      appToastError(
        "Could not load user activity",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setLoading(false);
    }
  }, [user, q, ip, module, action, path, from, to]);

  const load = useCallback(async () => {
    if (tab === "users") await loadDirectory();
    else if (tab === "sessions") await loadSessions();
    else await loadEvents();
  }, [tab, loadDirectory, loadSessions, loadEvents]);

  useEffect(() => {
    queueMicrotask(() => {
      if (!currentUserIsAdmin()) {
        appToastError("Access denied", "Only Super Admin / Administrators can view activity for all users.");
        router.replace("/");
        return;
      }
      setReady(true);
      void load();
    });
  }, [router, load]);

  const loadSessionActions = useCallback(async (session: SessionRow) => {
    setSessionActionsLoading(true);
    setSessionActions([]);
    try {
      // Prefer server filter on meta.sessionId (set by login + page-view tracking).
      let list = await fetchAdminActivity({
        limit: 500,
        sessionId: session.id,
        user: session.userId || undefined,
        from: session.createdAt || undefined,
        to: session.revokedAt || undefined,
      });
      if (list.length === 0 && session.userId) {
        // Older rows may lack sessionId — fall back to user + time window.
        list = await fetchAdminActivity({
          limit: 500,
          user: session.userId,
          from: session.createdAt || undefined,
          to: session.revokedAt || undefined,
        });
        const start = new Date(session.createdAt).getTime();
        const end = session.revokedAt ? new Date(session.revokedAt).getTime() : Date.now();
        list = list.filter((row) => {
          const at = new Date(row.at).getTime();
          if (Number.isNaN(at) || at < start - 5_000 || at > end + 5_000) return false;
          const metaSid = typeof row.meta?.sessionId === "string" ? row.meta.sessionId : "";
          if (metaSid) return metaSid === session.id;
          return true;
        });
      }
      setSessionActions(list);
    } catch (err) {
      appToastError(
        "Could not load session actions",
        err instanceof Error ? err.message : "Unknown error",
      );
    } finally {
      setSessionActionsLoading(false);
    }
  }, []);

  const directoryById = useMemo(() => {
    const map = new Map<string, DbUser>();
    for (const u of directoryUsers) {
      if (u.id) map.set(u.id, u);
    }
    return map;
  }, [directoryUsers]);

  const directoryByLogin = useMemo(() => {
    const map = new Map<string, DbUser>();
    for (const u of directoryUsers) {
      if (u.username) map.set(u.username.trim().toLowerCase(), u);
      if (u.email) map.set(u.email.trim().toLowerCase(), u);
    }
    return map;
  }, [directoryUsers]);

  const userSummaries = useMemo(() => {
    const byId = new Map<string, UserSummary>();

    const ensure = (key: string, seed: Partial<UserSummary> & Pick<UserSummary, "name">): UserSummary => {
      const existing = byId.get(key);
      if (existing) {
        if (seed.role && !existing.role) existing.role = seed.role;
        if (seed.username && !existing.username) existing.username = seed.username;
        if (seed.email && !existing.email) existing.email = seed.email;
        if (seed.name && (existing.name === "Unknown user" || !existing.name)) existing.name = seed.name;
        if (seed.inDirectory) existing.inDirectory = true;
        if (seed.status) existing.status = seed.status;
        if (seed.userId && !existing.userId) existing.userId = seed.userId;
        return existing;
      }
      const row: UserSummary = {
        key,
        userId: seed.userId || "",
        name: seed.name,
        username: seed.username || "",
        email: seed.email || "",
        role: seed.role || "",
        status: seed.status || "",
        sessionCount: 0,
        activeCount: 0,
        totalSeconds: 0,
        lastSignedIn: "",
        lastIp: "",
        inDirectory: Boolean(seed.inDirectory),
      };
      byId.set(key, row);
      return row;
    };

    for (const u of directoryUsers) {
      const person = resolvePerson(
        { userId: u.id, name: u.name, username: u.username, email: u.email },
        directoryById,
        directoryByLogin,
      );
      const key = u.id || u.email || u.username || person.name;
      if (!key) continue;
      ensure(key, {
        userId: u.id,
        name: person.name,
        username: person.username,
        email: person.email,
        role: u.role || "",
        status: u.status || "",
        inDirectory: true,
      });
    }

    for (const s of sessions) {
      const person = resolvePerson(s, directoryById, directoryByLogin);
      const key = person.userId || s.userId || person.email || person.username || person.name || s.id;
      const row = ensure(key, {
        userId: person.userId || s.userId,
        name: person.name,
        username: person.username,
        email: person.email,
      });
      row.sessionCount += 1;
      if (s.status === "active") row.activeCount += 1;
      row.totalSeconds += Math.max(0, s.durationSeconds || 0);
      if (!row.lastSignedIn || new Date(s.createdAt).getTime() > new Date(row.lastSignedIn).getTime()) {
        row.lastSignedIn = s.createdAt;
        row.lastIp = s.ip || row.lastIp;
      }
    }

    for (const event of rows) {
      const person = resolvePerson(event, directoryById, directoryByLogin);
      const key =
        person.userId || event.userId || person.email || person.username || person.name || event.id;
      const row = ensure(key, {
        userId: person.userId || event.userId,
        name: person.name,
        username: person.username,
        email: person.email,
      });
      if (!row.lastSignedIn || new Date(event.at).getTime() > new Date(row.lastSignedIn).getTime()) {
        row.lastSignedIn = event.at;
        row.lastIp = event.ip || (typeof event.meta?.ip === "string" ? event.meta.ip : "") || row.lastIp;
      }
    }

    const needle = user.trim().toLowerCase();
    let list = [...byId.values()];
    if (needle) {
      list = list.filter((u) => {
        const blob = [u.name, u.username, u.email, u.userId, u.role, u.lastIp].join(" ").toLowerCase();
        return blob.includes(needle);
      });
    }
    list.sort((a, b) => {
      if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
      const at = a.lastSignedIn ? new Date(a.lastSignedIn).getTime() : 0;
      const bt = b.lastSignedIn ? new Date(b.lastSignedIn).getTime() : 0;
      if (bt !== at) return bt - at;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [directoryUsers, sessions, rows, user, directoryById, directoryByLogin]);

  const moduleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.module) set.add(row.module);
    }
    return [...set].sort();
  }, [rows]);

  const actionOptions = useMemo(() => {
    const set = new Set<string>([
      "PageView",
      "AccessDenied",
      "Login",
      "LoginFailed",
      "Logout",
      "Created",
      "Updated",
      "Deleted",
      "Synced",
    ]);
    for (const row of rows) {
      if (row.action) set.add(row.action);
    }
    return [...set].sort();
  }, [rows]);

  const eventPagination = usePagination(rows, 25);
  const sessionPagination = usePagination(sessions, 25);
  const userPagination = usePagination(userSummaries, 25);

  function focusUser(summary: UserSummary, nextTab: "sessions" | "events") {
    // Prefer username so the filter shows a readable login name.
    const needle =
      summary.username ||
      summary.email ||
      summary.userId ||
      summary.name;
    setDraftUser(needle);
    setUser(needle);
    setTab(nextTab);
    setExpanded(null);
  }

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setQ(draftQ);
    setUser(draftUser);
    setIp(draftIp);
    setModule(draftModule);
    setAction(draftAction);
    setPath(draftPath);
    setFrom(draftFrom);
    setTo(draftTo);
  }

  function clearFilters() {
    setDraftQ("");
    setDraftUser("");
    setDraftIp("");
    setDraftModule("");
    setDraftAction("");
    setDraftPath("");
    setDraftFrom("");
    setDraftTo("");
    setQ("");
    setUser("");
    setIp("");
    setModule("");
    setAction("");
    setPath("");
    setFrom("");
    setTo("");
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Checking access…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <button
          type="button"
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={openSidebar}
          aria-label="Open menu"
        >
          <HambergerMenu size={20} color="currentColor" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Task size={18} color="currentColor" className="text-orange-500" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
              Activity logs
            </h1>
            <p className="truncate text-xs text-slate-500">
              {FRONTEND_ONLY
                ? "Everyone using this tool — page views, logins, and field changes (before → after)"
                : "How long each person stayed signed in, and what they did"}
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          <Refresh size={14} color="currentColor" className="mr-1" />
          Refresh
        </Button>
        <NotificationsMenu />
        <ThemeToggle />
        <PageMoreMenu />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={tab === "users" ? "default" : "outline"}
            onClick={() => {
              setTab("users");
              setExpanded(null);
            }}
          >
            <Profile2User size={14} color="currentColor" className="mr-1" />
            By user
          </Button>
          {FRONTEND_ONLY ? null : (
          <Button
            type="button"
            size="sm"
            variant={tab === "sessions" ? "default" : "outline"}
            onClick={() => {
              setTab("sessions");
              setExpanded(null);
            }}
          >
            <Timer1 size={14} color="currentColor" className="mr-1" />
            Login sessions
          </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={tab === "events" ? "default" : "outline"}
            onClick={() => {
              setTab("events");
              setExpanded(null);
            }}
          >
            Event trail
          </Button>
        </div>

        <form
          onSubmit={applyFilters}
          className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-9"
        >
          {tab === "events" ? (
            <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500 sm:col-span-2">
              Search
              <div className="relative">
                <SearchNormal1
                  size={14}
                  variant="Linear"
                  className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
                  color="currentColor"
                />
                <Input
                  value={draftQ}
                  onChange={(e) => setDraftQ(e.target.value)}
                  placeholder="Page, path, user, details…"
                  className="h-9 pl-8"
                />
              </div>
            </label>
          ) : null}
          {tab === "events" ? (
            <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
              IP address
              <Input
                value={draftIp}
                onChange={(e) => setDraftIp(e.target.value)}
                placeholder="e.g. 41.90."
                className="h-9"
              />
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
            User
            <Input
              value={draftUser}
              onChange={(e) => setDraftUser(e.target.value)}
              placeholder="Name, username, email"
              className="h-9"
            />
          </label>
          {tab === "events" ? (
            <>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
                Page / path
                <Input
                  value={draftPath}
                  onChange={(e) => setDraftPath(e.target.value)}
                  placeholder="/payroll?view=…"
                  className="h-9"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
                Module
                <Input
                  list="activity-module-options"
                  value={draftModule}
                  onChange={(e) => setDraftModule(e.target.value)}
                  placeholder="e.g. sales"
                  className="h-9"
                />
                <datalist id="activity-module-options">
                  {moduleOptions.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
                Action
                <Input
                  list="activity-action-options"
                  value={draftAction}
                  onChange={(e) => setDraftAction(e.target.value)}
                  placeholder="PageView, Login…"
                  className="h-9"
                />
                <datalist id="activity-action-options">
                  {actionOptions.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
                From
                <Input
                  type="date"
                  value={draftFrom}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  className="h-9"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">
                To
                <Input
                  type="date"
                  value={draftTo}
                  onChange={(e) => setDraftTo(e.target.value)}
                  className="h-9"
                />
              </label>
            </>
          ) : null}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-9">
            <Button type="submit" size="sm" disabled={loading}>
              Apply filters
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={clearFilters} disabled={loading}>
              Clear
            </Button>
            {tab === "events" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => {
                  setDraftAction("PageView");
                  setAction("PageView");
                }}
              >
                Page views only
              </Button>
            ) : null}
            <span className="ml-auto text-[12px] text-slate-500">
              {loading
                ? "Loading…"
                : tab === "users"
                  ? `${userSummaries.length} user${userSummaries.length === 1 ? "" : "s"}`
                  : tab === "sessions"
                    ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}`
                    : `${rows.length} event${rows.length === 1 ? "" : "s"}`}
            </span>
          </div>
        </form>

        {tab === "users" ? (
          tableShell(
            <>
              <thead className="sticky top-0 z-10">
                <tr>
                  <Th width="22%">Person</Th>
                  <Th width="14%">Role</Th>
                  <Th width="10%">Sessions</Th>
                  <Th width="12%">Time in system</Th>
                  <Th width="16%">Last signed in</Th>
                  <Th width="12%">Last IP</Th>
                  <Th width="14%">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {userPagination.pageItems.length === 0 ? (
                  <tr>
                    <Td colSpan={7} className="py-10 text-center text-slate-500">
                      {loading ? "Loading users…" : "No users match this filter."}
                    </Td>
                  </tr>
                ) : (
                  userPagination.pageItems.map((summary) => (
                    <tr key={summary.key} className="hover:bg-slate-50/80 dark:hover:bg-slate-900/50">
                      <Td>
                        <PersonCell
                          person={{
                            name: summary.name,
                            username: summary.username,
                            email: summary.email,
                            userId: summary.userId,
                          }}
                          badge={
                            summary.activeCount > 0 ? (
                              <div className="mt-1">
                                <StatusBadge active>
                                  {summary.activeCount} active
                                </StatusBadge>
                              </div>
                            ) : null
                          }
                        />
                      </Td>
                      <Td>
                        <div className="truncate text-slate-700 dark:text-slate-300" title={summary.role || undefined}>
                          {summary.role || "—"}
                        </div>
                        {summary.status ? (
                          <div className="text-[10px] text-slate-400 capitalize">{summary.status}</div>
                        ) : null}
                      </Td>
                      <Td className="tabular-nums text-slate-700 dark:text-slate-300">
                        {summary.sessionCount}
                      </Td>
                      <Td>
                        <DurationBadge
                          label={
                            summary.sessionCount
                              ? formatDurationSeconds(summary.totalSeconds)
                              : "—"
                          }
                        />
                      </Td>
                      <Td className="text-slate-600 dark:text-slate-400">
                        <div className="whitespace-nowrap">
                          {summary.lastSignedIn ? formatWhen(summary.lastSignedIn) : "Never"}
                        </div>
                      </Td>
                      <Td className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        <div className="truncate" title={summary.lastIp || undefined}>
                          {summary.lastIp || "—"}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {FRONTEND_ONLY ? (
                            <button
                              type="button"
                              className="text-[12px] font-medium text-orange-600 hover:underline"
                              onClick={() => focusUser(summary, "events")}
                            >
                              What they did
                            </button>
                          ) : (
                            <>
                          <button
                            type="button"
                            className="text-[12px] font-medium text-orange-600 hover:underline"
                            onClick={() => focusUser(summary, "sessions")}
                          >
                            Sessions
                          </button>
                          <button
                            type="button"
                            className="text-[12px] font-medium text-orange-600 hover:underline"
                            onClick={() => focusUser(summary, "events")}
                          >
                            Events
                          </button>
                            </>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </>,
            "min-w-[900px]",
          )
        ) : tab === "sessions" ? (
          tableShell(
            <>
              <thead className="sticky top-0 z-10">
                <tr>
                  <Th width="20%">Person</Th>
                  <Th width="14%">Signed in</Th>
                  <Th width="14%">Signed out</Th>
                  <Th width="12%">Duration</Th>
                  <Th width="12%">Status</Th>
                  <Th width="12%">IP</Th>
                  <Th width="16%">Activity</Th>
                </tr>
              </thead>
              <tbody>
                {sessionPagination.pageItems.length === 0 ? (
                  <tr>
                    <Td colSpan={7} className="py-10 text-center text-slate-500">
                      {loading ? "Loading sessions…" : "No login sessions found."}
                    </Td>
                  </tr>
                ) : (
                  sessionPagination.pageItems.map((session) => {
                    const open = expanded === session.id;
                    const person = resolvePerson(session, directoryById, directoryByLogin);
                    return (
                      <Fragment key={session.id}>
                        <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-900/50">
                          <Td>
                            <PersonCell
                              person={person}
                              badge={
                                session.current ? (
                                  <div className="mt-1">
                                    <StatusBadge active>This device</StatusBadge>
                                  </div>
                                ) : null
                              }
                            />
                          </Td>
                          <Td className="whitespace-nowrap text-slate-600 dark:text-slate-400">
                            {formatWhen(session.createdAt)}
                          </Td>
                          <Td className="whitespace-nowrap text-slate-600 dark:text-slate-400">
                            {session.revokedAt ? formatWhen(session.revokedAt) : "—"}
                          </Td>
                          <Td>
                            <DurationBadge label={session.durationLabel || "—"} />
                            <div className="mt-0.5 text-[10px] text-slate-400">
                              Last active {formatWhen(session.lastActiveAt)}
                            </div>
                          </Td>
                          <Td>
                            <StatusBadge active={session.status === "active"}>
                              {endReasonLabel(session.endReason, session.status)}
                            </StatusBadge>
                          </Td>
                          <Td className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                            <div className="truncate" title={session.ip || undefined}>
                              {session.ip || "—"}
                            </div>
                          </Td>
                          <Td>
                            <button
                              type="button"
                              className="text-[12px] font-medium text-orange-600 hover:underline"
                              onClick={() => {
                                if (open) {
                                  setExpanded(null);
                                  setSessionActions([]);
                                  return;
                                }
                                setExpanded(session.id);
                                void loadSessionActions(session);
                              }}
                            >
                              {open ? "Hide activity" : "Show activity"}
                            </button>
                          </Td>
                        </tr>
                        {open ? (
                          <tr className="bg-slate-50/70 dark:bg-slate-900/40">
                            <Td colSpan={7} className="border-b border-slate-200 py-3 dark:border-slate-800">
                              {sessionActionsLoading ? (
                                <p className="text-[12px] text-slate-500">Loading actions…</p>
                              ) : sessionActions.length === 0 ? (
                                <p className="text-[12px] text-slate-500">
                                  No page views or changes recorded for this login yet.
                                </p>
                              ) : (
                                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
                                  <table className="w-full text-left text-[12px]">
                                    <thead>
                                      <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-semibold tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900">
                                        <th className="px-2.5 py-1.5">When</th>
                                        <th className="px-2.5 py-1.5">Action</th>
                                        <th className="px-2.5 py-1.5">Page</th>
                                        <th className="px-2.5 py-1.5">Path</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {sessionActions.map((row) => (
                                        <tr key={row.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                                          <td className="px-2.5 py-1.5 whitespace-nowrap text-slate-500">
                                            {formatWhen(row.at)}
                                          </td>
                                          <td className="px-2.5 py-1.5 font-medium text-slate-800 dark:text-slate-200">
                                            {row.action}
                                          </td>
                                          <td className="max-w-[12rem] truncate px-2.5 py-1.5 text-slate-600" title={pageLabel(row)}>
                                            {pageLabel(row)}
                                          </td>
                                          <td className="max-w-[16rem] truncate px-2.5 py-1.5 font-mono text-[11px] text-slate-500" title={pathLabel(row)}>
                                            {pathLabel(row)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </Td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </>,
            "min-w-[960px]",
          )
        ) : (
          tableShell(
            <>
              <thead className="sticky top-0 z-10">
                <tr>
                  <Th width="14%">When</Th>
                  <Th width="18%">Person</Th>
                  <Th width="12%">Action</Th>
                  <Th width="18%">Page</Th>
                  <Th width="12%">IP</Th>
                  <Th width="26%">Details</Th>
                </tr>
              </thead>
              <tbody>
                {eventPagination.pageItems.length === 0 ? (
                  <tr>
                    <Td colSpan={6} className="py-10 text-center text-slate-500">
                      {loading ? "Loading activity…" : "No activity matches these filters."}
                    </Td>
                  </tr>
                ) : (
                  eventPagination.pageItems.map((row) => {
                    const open = expanded === row.id;
                    const extra = metaSummary(row.meta);
                    const duration =
                      typeof row.meta?.durationLabel === "string" ? row.meta.durationLabel : "";
                    const person = resolvePerson(row, directoryById, directoryByLogin);
                    const page = pageLabel(row);
                    const path = pathLabel(row);
                    return (
                      <Fragment key={row.id}>
                        <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-900/50">
                          <Td className="whitespace-nowrap text-slate-600 dark:text-slate-400">
                            {formatWhen(row.at)}
                          </Td>
                          <Td>
                            <PersonCell person={person} />
                          </Td>
                          <Td>
                            <StatusBadge>{row.action || "—"}</StatusBadge>
                            {row.action === "Logout" && duration ? (
                              <div className="mt-0.5 text-[10px] font-medium text-orange-700">
                                Session {duration}
                              </div>
                            ) : (
                              <div className="mt-0.5 truncate text-[10px] text-slate-400">
                                {[row.module, row.entity].filter(Boolean).join(" / ") || ""}
                              </div>
                            )}
                          </Td>
                          <Td>
                            <div className="truncate font-medium text-slate-800 dark:text-slate-200" title={page}>
                              {page}
                            </div>
                            {path !== "—" ? (
                              <div className="truncate font-mono text-[11px] text-slate-400" title={path}>
                                {path}
                              </div>
                            ) : null}
                          </Td>
                          <Td className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                            <div className="truncate" title={row.ip || undefined}>
                              {row.ip || (typeof row.meta?.ip === "string" ? row.meta.ip : "") || "—"}
                            </div>
                          </Td>
                          <Td>
                            <button
                              type="button"
                              className="w-full text-left"
                              onClick={() => setExpanded(open ? null : row.id)}
                            >
                              <div
                                className={`text-slate-600 dark:text-slate-300 ${open ? "" : "line-clamp-2"}`}
                                title={row.details || undefined}
                              >
                                {row.details || "—"}
                              </div>
                              <div className="mt-0.5 text-[10px] font-medium text-orange-600">
                                {open ? "Hide detail" : "Show detail"}
                              </div>
                            </button>
                          </Td>
                        </tr>
                        {open && (extra || row.meta?.ip || row.meta?.referrer || row.meta?.from != null || row.meta?.to != null) ? (
                          <tr className="bg-slate-50/70 dark:bg-slate-900/40">
                            <Td colSpan={6} className="text-[11px] text-slate-500">
                              {row.action === "FieldChange" ? (
                                <div className="space-y-1 font-mono text-[12px] text-slate-700 dark:text-slate-200">
                                  <div>
                                    Field{" "}
                                    <span className="font-semibold">{String(row.meta?.field || "—")}</span>
                                  </div>
                                  <div>Before: {String(row.meta?.from ?? "—")}</div>
                                  <div>After: {String(row.meta?.to ?? "—")}</div>
                                </div>
                              ) : extra ? (
                                <div>{extra}</div>
                              ) : null}
                              {row.meta?.ip ? (
                                <div>
                                  IP {String(row.meta.ip)}
                                  {row.meta.referrer ? ` · from ${String(row.meta.referrer)}` : ""}
                                </div>
                              ) : null}
                            </Td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </>,
            "min-w-[920px]",
          )
        )}

        {tab === "users" ? (
          <PaginationBar
            page={userPagination.page}
            pages={userPagination.pages}
            total={userPagination.total}
            pageSize={userPagination.pageSize}
            from={userPagination.from}
            to={userPagination.to}
            onPageChange={userPagination.setPage}
            onPageSizeChange={userPagination.setPageSize}
          />
        ) : tab === "sessions" ? (
          <PaginationBar
            page={sessionPagination.page}
            pages={sessionPagination.pages}
            total={sessionPagination.total}
            pageSize={sessionPagination.pageSize}
            from={sessionPagination.from}
            to={sessionPagination.to}
            onPageChange={sessionPagination.setPage}
            onPageSizeChange={sessionPagination.setPageSize}
          />
        ) : (
          <PaginationBar
            page={eventPagination.page}
            pages={eventPagination.pages}
            total={eventPagination.total}
            pageSize={eventPagination.pageSize}
            from={eventPagination.from}
            to={eventPagination.to}
            onPageChange={eventPagination.setPage}
            onPageSizeChange={eventPagination.setPageSize}
          />
        )}
      </div>
    </div>
  );
}
