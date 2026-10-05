/**
 * Auth session — tab memory + sessionStorage. Durable API auth is the httpOnly
 * cookie `financeiag_at` from Go login (keep signed in). Never store identity in
 * shared Postgres `app_settings` — that key is one blob for the whole business
 * and caused greetings to flip to whoever last wrote keep-signed-in.
 */
import {
  USERS_KEY,
  loadList,
  saveList,
  type UserRow,
} from "@/lib/manager-settings";
import { getAppPref, setAppPref, removeAppPref } from "@/lib/db/app-prefs";
import { getMemorySetting, setMemorySetting, removeMemorySetting, clearMemoryStore } from "@/lib/db/client-store";
import { createLoginSession, endSession } from "@/lib/session-activity";
import { apiFetch, forceClearApiToken, isWithinLoginGrace } from "@/lib/api-auth";
import { FRONTEND_ONLY } from "@/lib/frontend-only";

export const SESSION_KEY = "financeiag-session";
export const KEEP_SIGNED_IN_KEY = "financeiag-keep-signed-in";
/** Set after intentional logout so /login does not auto-restore the old cookie. */
export const JUST_LOGGED_OUT_KEY = "financeiag-just-logged-out";
export const AUTH_CHANGED_EVENT = "financeiag-auth-changed";

/** Tab-scoped "just logged out" flag (memory only — survives soft nav, not full reload). */
let justLoggedOutAt = 0;

export type SampleRole =
  | "Administrator"
  | "Super Admin"
  | "Department Head"
  | "General Manager"
  | "CEO"
  | "Finance"
  | "Accountant"
  | "Project Manager"
  | "Contractor"
  | "Clerk"
  | "Viewer";

function isStrictAdminRole(role: string): boolean {
  const r = (role || "").trim().toLowerCase().replace(/\s+/g, " ");
  return r === "administrator" || r === "super admin" || r === "superadmin";
}

function sampleCrudFlags(role: string): Pick<
  UserRow,
  "canView" | "canCreate" | "canEdit" | "canDelete"
> {
  if (isStrictAdminRole(role)) {
    return { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "Yes" };
  }
  switch (role) {
    case "General Manager":
    case "CEO":
    case "Finance":
    case "Accountant":
    case "Project Manager":
    case "Contractor":
      return { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" };
    case "Department Head":
    case "Clerk":
      return { canView: "Yes", canCreate: "Yes", canEdit: "No", canDelete: "No" };
    default:
      // Deny create/edit/delete unless the role is an explicit known account.
      return { canView: "Yes", canCreate: "No", canEdit: "No", canDelete: "No" };
  }
}

export type AuthSession = {
  /** Unique id for this login session (idle / multi-device tracking). */
  sessionId?: string;
  userId: string;
  email: string;
  /** Display name — kept on the session so CRUD works before users hydrate. */
  name?: string;
  username?: string;
  /** Role + CRUD snapshot from login / auth API (source of truth until users list loads). */
  role?: string;
  canView?: string;
  canCreate?: string;
  canEdit?: string;
  canDelete?: string;
  /** When true, AppShell shows a blocking change-password dialog. */
  mustChangePassword?: boolean;
  /** Session created at (ms). */
  at: number;
  /** Last user activity (ms). */
  lastActiveAt?: number;
};

export type SampleAccount = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: SampleRole;
  password: string;
};

/** Admin bootstrap accounts. Other demo logins were removed. */
/**
 * No accounts ship in this app.
 *
 * Two did — `admin` (Administrator) and `superadmin` (Super Admin) — both on
 * a password committed to this repository and, because `DEMO_PASSWORD` was
 * exported, inlined into the browser bundle by Next. Anyone holding the
 * shipped JS could sign in with full rights.
 */
export const SAMPLE_ACCOUNTS: SampleAccount[] = [];

/** Former demo accounts — deleted from Postgres when auth seed runs. */
export const LEGACY_DEMO_USERNAMES = [
  "depthead",
  "gm",
  "ceo",
  "finance",
  "accountant",
  "pm",
  "contractor",
  "clerk",
  "viewer",
] as const;

export const LEGACY_DEMO_EMAILS = [
  "depthead@iag.local",
  "gm@iag.local",
  "ceo@iag.local",
  "finance@iag.local",
  "accountant@iag.local",
  "pm@iag.local",
  "contractor@iag.local",
  "clerk@iag.local",
  "viewer@iag.local",
] as const;

export const LEGACY_DEMO_IDS = ["2", "4", "5", "6", "7", "8", "9", "10", "11"] as const;

export { sampleCrudFlags as sampleCrudFlagsForRole };

function sampleUserRow(account: SampleAccount): UserRow {
  return {
    id: account.id,
    name: account.name,
    username: account.username,
    email: account.email,
    role: account.role,
    ...sampleCrudFlags(account.role),
  };
}

export function sampleUsersAsRows(): UserRow[] {
  return SAMPLE_ACCOUNTS.map(sampleUserRow);
}

/**
 * Load users from the in-memory / Postgres-backed settings store.
 * Does not merge hardcoded sample accounts — deleted users stay gone.
 */
export function ensureSampleRoleUsers(): UserRow[] {
  if (typeof window === "undefined") return [];
  return loadList<UserRow>(USERS_KEY, []);
}

function notifyAuthChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
  window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
}

function profileFields(parsed: Partial<AuthSession>) {
  return {
    name: parsed.name ? String(parsed.name) : undefined,
    username: parsed.username ? String(parsed.username) : undefined,
    role: parsed.role ? String(parsed.role) : undefined,
    canView: parsed.canView ? String(parsed.canView) : undefined,
    canCreate: parsed.canCreate ? String(parsed.canCreate) : undefined,
    canEdit: parsed.canEdit ? String(parsed.canEdit) : undefined,
    canDelete: parsed.canDelete ? String(parsed.canDelete) : undefined,
    mustChangePassword: Boolean(parsed.mustChangePassword),
  };
}

function readTabSessionStorage(): Partial<AuthSession> | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    return parsed?.email ? parsed : null;
  } catch {
    return null;
  }
}

function readMemorySession(): AuthSession | null {
  try {
    const fromMem = getMemorySetting<Partial<AuthSession> | null>(SESSION_KEY, null);
    if (fromMem?.email) return normalizeSession(fromMem);
    // Tab-only backup — never fall back to shared Postgres app prefs.
    const fromTab = readTabSessionStorage();
    return fromTab ? normalizeSession(fromTab) : null;
  } catch {
    return null;
  }
}

/** Clear legacy shared identity blob without wiping the in-tab session. */
function clearSharedSessionBlob() {
  void apiFetch(`/api/settings/${encodeURIComponent(SESSION_KEY)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: null }),
    keepalive: true,
    cache: "no-store",
  }).catch(() => undefined);
}

function normalizeSession(parsed: Partial<AuthSession> & { email?: string }): AuthSession | null {
  if (!parsed.email) return null;
  // Strict: never invent userId from email — that mixed Ritah/Richard/Super Admin.
  const userId = parsed.userId != null ? String(parsed.userId).trim() : "";
  if (!userId) return null;
  const email = String(parsed.email);
  const at = typeof parsed.at === "number" ? parsed.at : Date.now();
  return {
    sessionId: parsed.sessionId ? String(parsed.sessionId) : undefined,
    userId,
    email,
    ...profileFields(parsed),
    at,
    lastActiveAt: typeof parsed.lastActiveAt === "number" ? parsed.lastActiveAt : at,
  };
}

/** Attach role/CRUD from a user row onto the session (forms need this before users hydrate). */
export function withSessionProfile(session: AuthSession, user: UserRow): AuthSession {
  // Never adopt another person's id/name — row must match this session's userId.
  if (user.id && session.userId && user.id !== session.userId) {
    return session;
  }
  // CRUD from the matched row; display name stays on the login session when set.
  return {
    ...session,
    userId: session.userId || user.id,
    name: String(session.name || user.name || session.name || "").trim() || session.name,
    username: String(session.username || user.username || session.username || "").trim() || session.username,
    email: String(session.email || user.email || session.email || "").trim() || session.email,
    role: String(session.role || user.role || session.role || "").trim() || session.role,
    canView: user.canView || "No",
    canCreate: user.canCreate || "No",
    canEdit: user.canEdit || "No",
    canDelete: user.canDelete || "No",
  };
}

export function readAuthSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  return readMemorySession();
}

export function isAuthenticated(): boolean {
  return readAuthSession() != null;
}

export function writeAuthSession(session: AuthSession, keepSignedIn: boolean) {
  if (typeof window === "undefined") return;
  const userId = String(session.userId ?? "").trim();
  const email = String(session.email || "").trim();
  const name = String(session.name || "").trim();
  // Strict: refuse incomplete identity — empty name/id is how wrong greetings stuck.
  if (!userId || !email) return;
  const enforced: AuthSession = {
    ...session,
    userId,
    email,
    name: name || String(session.username || "").trim() || email.split("@")[0] || "User",
    username: String(session.username || "").trim() || email.split("@")[0],
    lastActiveAt: session.lastActiveAt || session.at || Date.now(),
  };
  try {
    setAppPref(KEEP_SIGNED_IN_KEY, keepSignedIn ? "1" : "0");
    setMemorySetting(KEEP_SIGNED_IN_KEY, keepSignedIn ? "1" : "0");
    setMemorySetting(SESSION_KEY, enforced);
    // Tab backup for soft reload; keep-signed-in durability is the JWT cookie.
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(enforced));
      sessionStorage.setItem(KEEP_SIGNED_IN_KEY, keepSignedIn ? "1" : "0");
    } catch {
      /* ignore */
    }
    // Never write identity into shared app_settings — purge any legacy blob.
    clearSharedSessionBlob();
  } catch {
    // ignore
  }
  notifyAuthChanged();
}

export function clearAuthSession(options?: {
  serverLogout?: boolean;
  /** Bypass post-login grace (confirmed 401 / idle expiry). */
  force?: boolean;
  /**
   * Skip AUTH_CHANGED so the shell/sidebar do not re-render as logged-out
   * before a hard navigation (logout / idle / JWT expiry).
   */
  silent?: boolean;
  /** Wipe in-memory business rows so the next login cannot see the previous user. */
  clearMemory?: boolean;
}) {
  if (typeof window === "undefined") return;
  const serverLogout = options?.serverLogout !== false;
  const force = options?.force === true;
  // Soft clears (restore race) must not wipe a just-issued login.
  if (!force && !serverLogout && isWithinLoginGrace()) {
    return;
  }
  try {
    const existing = readAuthSession();
    removeMemorySetting(SESSION_KEY);
    removeMemorySetting(KEEP_SIGNED_IN_KEY);
    try {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(KEEP_SIGNED_IN_KEY);
      sessionStorage.removeItem("financeiag-db-hydrated-v1");
    } catch {
      /* ignore */
    }
    forceClearApiToken();
    removeAppPref(SESSION_KEY);
    if (existing?.sessionId) endSession(existing.sessionId, "logout");
    if (options?.clearMemory) {
      clearMemoryStore();
    }
    // Best-effort push unsubscribe before the session cookie is revoked.
    if (serverLogout) {
      void fetch("/api/push/subscribe", {
        method: "DELETE",
        credentials: "same-origin",
        keepalive: true,
        cache: "no-store",
      }).catch(() => undefined);
      void fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        cache: "no-store",
      });
    }
  } catch {
    // ignore
  }
  if (!options?.silent) {
    notifyAuthChanged();
  }
}

export type LoginResult =
  | { ok: true; user: UserRow; session: AuthSession }
  | { ok: false; error: string };

function finishLogin(
  user: UserRow,
  email: string,
  keepSignedIn: boolean,
  mustChangePassword = false,
  /** Durable auth_sessions.id from the API — used for activity/session audit. */
  serverSessionId?: string,
): LoginResult {
  const session = withSessionProfile(
    createLoginSession({
      userId: user.id,
      email,
      keepSignedIn,
      sessionId: serverSessionId,
    }),
    user,
  );
  // Enforce this login's identity — never keep another account's display name.
  const enforced: AuthSession = {
    ...session,
    userId: user.id,
    email: user.email?.trim() || email,
    name: String(user.name || user.username || "").trim() || email.split("@")[0] || "",
    username: user.username?.trim() || session.username,
    role: user.role?.trim() || session.role,
    mustChangePassword,
  };
  writeAuthSession(enforced, keepSignedIn);
  return { ok: true, user, session: enforced };
}

/**
 * Sign in against Postgres `users` only. No hardcoded / localStorage fallback,
 * and no local accounts in standalone mode either — see the branch below.
 */
export async function loginWithCredentials(
  emailOrUsername: string,
  password: string,
  keepSignedIn: boolean,
): Promise<LoginResult> {
  if (FRONTEND_ONLY) {
    // Standalone mode used to authenticate against accounts compiled into
    // this file, whose password was committed to the repository and shipped
    // in the browser bundle. They are gone, and nothing replaces them: a
    // credential that ships in client-side code is readable by whoever holds
    // the bundle.
    //
    // That leaves standalone mode with no way to authenticate, which is why
    // NEXT_PUBLIC_FRONTEND_ONLY now defaults to false. Reaching this branch
    // means a deployment turned it back on.
    return {
      ok: false,
      error:
        "This build has no local accounts. Set NEXT_PUBLIC_FRONTEND_ONLY=false and " +
        "point IAG_GATEWAY_ORIGIN (or GO_API_URL) at a backend to sign in.",
    };
  }
  const { loginViaDatabase } = await import("@/lib/auth-api");
  const db = await loginViaDatabase(emailOrUsername, password, keepSignedIn);
  if (db.ok) {
    const email = db.user.email?.trim() || `${db.user.username}@iag.local`;
    // Always wipe prior tab memory on login — shared desks (Ritah/Richard/Admin)
    // must never keep the previous person's rows or greeting.
    try {
      clearMemoryStore();
    } catch {
      /* ignore */
    }
    try {
      sessionStorage.removeItem("financeiag-db-hydrated-v1");
    } catch {
      /* ignore */
    }
    // Purge any legacy shared identity blob in Postgres (no-op if already gone).
    clearSharedSessionBlob();
    // Directory starts as this user only; hydrate fills the rest from Postgres.
    const row: UserRow = {
      id: db.user.id,
      name: db.user.name,
      username: db.user.username,
      email: db.user.email,
      role: db.user.role,
      canView: db.user.canView,
      canCreate: db.user.canCreate,
      canEdit: db.user.canEdit,
      canDelete: db.user.canDelete,
    };
    saveList(USERS_KEY, [row], { persist: false });
    justLoggedOutAt = 0;
    try {
      sessionStorage.removeItem(JUST_LOGGED_OUT_KEY);
    } catch {
      /* ignore */
    }
    return finishLogin(
      row,
      email,
      keepSignedIn,
      Boolean(db.user.mustChangePassword),
      db.sessionId,
    );
  }
  if (db.unavailable) {
    return {
      ok: false,
      error: "Database unavailable. Sign-in requires the API — users are not stored in the browser.",
    };
  }
  return { ok: false, error: db.error };
}

export function clearMustChangePasswordFlag() {
  const session = readAuthSession();
  if (!session?.mustChangePassword) return;
  writeAuthSession(
    { ...session, mustChangePassword: false },
    getKeepSignedInPreference(),
  );
}

let sessionLogoutInFlight = false;

/**
 * Full sign-out for logout / idle / JWT expiry.
 * Hard-navigates to login with no `next=` so the user is not bounced back into
 * previous tabs or deep links after the session ends.
 */
export function forceSessionLogout(
  reason: "logout" | "idle" | "auth" | "expired" = "logout",
) {
  if (typeof window === "undefined") return;
  if (sessionLogoutInFlight) return;
  sessionLogoutInFlight = true;
  justLoggedOutAt = Date.now();
  try {
    // Durable flag — survives hard navigation so /login does not cookie-restore
    // the previous user while /api/auth/logout is still in flight.
    sessionStorage.setItem(JUST_LOGGED_OUT_KEY, String(justLoggedOutAt));
  } catch {
    /* ignore */
  }
  if (FRONTEND_ONLY) {
    void import("@/lib/tools-activity-client").then(({ postToolsAuditEvent }) => {
      postToolsAuditEvent({
        action: "Logout",
        module: "auth",
        entity: "session",
        details: `Signed out (${reason})`,
        meta: { reason },
      });
    });
  }
  // Silent clear: avoid AUTH_CHANGED so sidebar/nav do not collapse before unload.
  // Wipe memory so the next login cannot briefly paint the previous person's data.
  clearAuthSession({ serverLogout: true, force: true, silent: true, clearMemory: true });
  // Hard navigation — soft router.replace leaves AppShell mounted and feels stuck.
  window.location.replace(`/login?reason=${encodeURIComponent(reason)}`);
}

/** Instant logout: clear local session, fire-and-forget server revoke, hard-navigate. */
export function logout() {
  forceSessionLogout("logout");
}

/** True when the user just signed out (blocks cookie auto-restore on /login). */
export function consumeJustLoggedOut(): boolean {
  const at = justLoggedOutAt;
  justLoggedOutAt = 0;
  if (at && Date.now() - at < 60_000) return true;
  // Legacy scrub
  try {
    const raw = sessionStorage.getItem(JUST_LOGGED_OUT_KEY);
    sessionStorage.removeItem(JUST_LOGGED_OUT_KEY);
    if (raw) {
      const n = Number(raw);
      return Number.isFinite(n) && Date.now() - n < 60_000;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function getKeepSignedInPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const mem = getMemorySetting<string | null>(KEEP_SIGNED_IN_KEY, null);
    if (mem === "0" || mem === "1") return mem !== "0";
    return getAppPref<string>(KEEP_SIGNED_IN_KEY, "1") !== "0";
  } catch {
    return true;
  }
}
