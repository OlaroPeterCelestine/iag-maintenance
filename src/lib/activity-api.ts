/**
 * Typed clients for Go Gin activity / session audit APIs.
 * Keep query params in sync with backend/internal/httpapi/activity.go + sessions.go.
 *
 * GET /api/activity: admins see everyone; other roles are scoped to their own user_id.
 * GET /api/auth/sessions?all=1: admin-only cross-user login audit.
 */
import { apiFetch } from "@/lib/api-auth";
import { FRONTEND_ONLY } from "@/lib/frontend-only";

export type ActivityRow = {
  id: string;
  at: string;
  action: string;
  module: string;
  entity: string;
  recordId: string;
  recordLabel: string;
  details: string;
  userId: string;
  userName: string;
  username: string;
  email: string;
  ip: string;
  userAgent?: string;
  path?: string;
  page?: string;
  meta?: Record<string, unknown>;
};

export type SessionRow = {
  id: string;
  userId: string;
  userName?: string;
  username?: string;
  email?: string;
  ip: string;
  userAgent?: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  endReason?: string;
  status: string;
  durationSeconds: number;
  durationLabel: string;
  activeSeconds?: number;
  current?: boolean;
};

export type ActivityListFilters = {
  limit?: number;
  q?: string;
  user?: string;
  ip?: string;
  module?: string;
  action?: string;
  path?: string;
  from?: string;
  to?: string;
  /** Matches meta.sessionId written by login / page-view tracking. */
  sessionId?: string;
};

export type SessionListFilters = {
  /** Super Admin / Administrator: all users' sessions. */
  all?: boolean;
  includeRevoked?: boolean;
  limit?: number;
  /** Server-side ILIKE on user id / name / username / email. */
  user?: string;
  userId?: string;
};

async function readJson<T>(res: Response, fallbackError: string): Promise<T> {
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string; ok?: boolean })
    | null;
  if (!res.ok) {
    throw new Error(body?.error || `${fallbackError} (${res.status})`);
  }
  return (body || {}) as T;
}

/** GET /api/activity — full trail for admins; own rows for everyone else. */
export async function fetchAdminActivity(
  filters: ActivityListFilters = {},
): Promise<ActivityRow[]> {
  const params = new URLSearchParams();
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  params.set("limit", String(limit));
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.user?.trim()) params.set("user", filters.user.trim());
  if (filters.ip?.trim()) params.set("ip", filters.ip.trim());
  if (filters.module?.trim()) params.set("module", filters.module.trim());
  if (filters.action?.trim()) params.set("action", filters.action.trim());
  if (filters.path?.trim()) params.set("path", filters.path.trim());
  if (filters.from?.trim()) params.set("from", filters.from.trim());
  if (filters.to?.trim()) params.set("to", filters.to.trim());
  if (filters.sessionId?.trim()) params.set("sessionId", filters.sessionId.trim());

  const path = FRONTEND_ONLY
    ? `/api/tools-activity?${params.toString()}`
    : `/api/activity?${params.toString()}`;
  const res = FRONTEND_ONLY
    ? await fetch(path, { cache: "no-store" })
    : await apiFetch(path);
  const json = await readJson<{ data?: ActivityRow[] }>(res, "Failed to load activity");
  return Array.isArray(json.data) ? json.data : [];
}

/** GET /api/auth/sessions — own sessions, or all=1 for admins. */
export async function fetchAdminSessions(
  filters: SessionListFilters = {},
): Promise<SessionRow[]> {
  const params = new URLSearchParams();
  if (filters.all) params.set("all", "1");
  if (filters.includeRevoked) params.set("includeRevoked", "1");
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  params.set("limit", String(limit));
  if (filters.user?.trim()) params.set("user", filters.user.trim());
  if (filters.userId?.trim()) params.set("userId", filters.userId.trim());

  const res = await apiFetch(`/api/auth/sessions?${params.toString()}`);
  const json = await readJson<{ data?: SessionRow[]; ok?: boolean }>(
    res,
    "Failed to load sessions",
  );
  return Array.isArray(json.data) ? json.data : [];
}
