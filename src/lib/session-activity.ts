/**
 * Login sessions + inactivity timeout.
 * Creates a session record on login; ends it on logout or idle expiry.
 * Persisted in memory + Postgres (not localStorage).
 */

import {
  KEEP_SIGNED_IN_KEY,
  SESSION_KEY,
  getKeepSignedInPreference,
  readAuthSession,
  type AuthSession,
} from "@/lib/auth";
import { forceClearApiToken, isWithinLoginGrace } from "@/lib/api-auth";
import { getAppPref, setAppPref, removeAppPref } from "@/lib/db/app-prefs";
import { setMemorySetting, removeMemorySetting } from "@/lib/db/client-store";

export const SESSIONS_KEY = "financeiag-sessions";
export const IDLE_TIMEOUT_KEY = "financeiag-idle-timeout-ms";
/** Default: 8 hours of no pointer/keyboard/focus activity (business desk). */
export const DEFAULT_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
/** Absolute session lifetime cap (keep-signed-in) — aligned with JWT_EXPIRY_KEEP (30d). */
export const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Session-only (tab) lifetime cap — aligned with JWT_EXPIRY (12h). */
export const MAX_TAB_SESSION_AGE_MS = 12 * 60 * 60 * 1000;
/** Minimum idle timeout unless tests set window.__FINACEIAG_IDLE_MS__. */
const MIN_IDLE_TIMEOUT_MS = 60 * 60 * 1000;

let lastSessionDbWriteAt = 0;
const SESSION_DB_WRITE_EVERY_MS = 60_000;

export const SESSION_WARNING_EVENT = "financeiag-session-warning";
export const SESSION_EXPIRED_EVENT = "financeiag-session-expired";

export type SessionRecord = {
  id: string;
  userId: string;
  email: string;
  createdAt: number;
  lastActiveAt: number;
  keepSignedIn: boolean;
  userAgent: string;
  endedAt?: number;
  endReason?: "logout" | "idle" | "expired" | "replaced";
};

function newSessionId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

export function getIdleTimeoutMs(): number {
  if (typeof window === "undefined") return DEFAULT_IDLE_TIMEOUT_MS;
  try {
    const override = (window as Window & { __FINACEIAG_IDLE_MS__?: number }).__FINACEIAG_IDLE_MS__;
    if (typeof override === "number" && override > 0) return override;
    const raw = getAppPref<string | number | null>(IDLE_TIMEOUT_KEY, null);
    const n = raw != null ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= MIN_IDLE_TIMEOUT_MS) return n;
  } catch {
    /* ignore */
  }
  return DEFAULT_IDLE_TIMEOUT_MS;
}

export function setIdleTimeoutMs(ms: number) {
  if (typeof window === "undefined") return;
  setAppPref(IDLE_TIMEOUT_KEY, String(Math.max(1000, Math.round(ms))));
}

function loadSessions(): SessionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = getAppPref<SessionRecord[] | null>(SESSIONS_KEY, null);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Memory-only session list update (mousemove must not hit Postgres). */
function saveSessionsMemory(sessions: SessionRecord[]) {
  setMemorySetting(SESSIONS_KEY, sessions.slice(-40));
}

/** Durable session list write (login / logout / end). */
function saveSessions(sessions: SessionRecord[]) {
  setAppPref(SESSIONS_KEY, sessions.slice(-40));
}

function wipeAuthKeys() {
  // Login grace: never half-wipe. Clearing session keys while keeping the JWT
  // left users in a shell with no session → idle redirect while still authed.
  if (typeof window !== "undefined" && isWithinLoginGrace()) {
    return;
  }
  try {
    removeAppPref(SESSION_KEY);
    removeMemorySetting(SESSION_KEY);
    try {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(KEEP_SIGNED_IN_KEY);
    } catch {
      /* ignore */
    }
    // Idle / expiry must drop the JWT + cookie — otherwise login-page restore
    // immediately signs the user back in.
    forceClearApiToken();
    void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    /* ignore */
  }
  // No AUTH_CHANGED / records-changed — callers hard-navigate via forceSessionLogout.
}

export function listSessions(): SessionRecord[] {
  return loadSessions().sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

export function listActiveSessions(): SessionRecord[] {
  return listSessions().filter((s) => !s.endedAt);
}

/** Create a session row and return the auth payload to persist. */
export function createLoginSession(input: {
  userId: string;
  email: string;
  keepSignedIn: boolean;
  /** Prefer the API auth_sessions.id when login returns one. */
  sessionId?: string;
}): AuthSession {
  const now = Date.now();
  const id = (input.sessionId || "").trim() || newSessionId();
  const record: SessionRecord = {
    id,
    userId: input.userId,
    email: input.email,
    createdAt: now,
    lastActiveAt: now,
    keepSignedIn: input.keepSignedIn,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 180) : "unknown",
  };

  const sessions = loadSessions().map((s) =>
    s.userId === input.userId && !s.endedAt
      ? { ...s, endedAt: now, endReason: "replaced" as const }
      : s,
  );
  sessions.push(record);
  saveSessions(sessions);

  return {
    sessionId: id,
    userId: input.userId,
    email: input.email,
    at: now,
    lastActiveAt: now,
  };
}

export function endSession(sessionId: string | undefined, reason: SessionRecord["endReason"]) {
  if (!sessionId || typeof window === "undefined") return;
  const now = Date.now();
  const sessions = loadSessions().map((s) =>
    s.id === sessionId && !s.endedAt ? { ...s, endedAt: now, endReason: reason } : s,
  );
  saveSessions(sessions);
}

export function touchSessionActivity(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const session = readAuthSession();
  if (!session) return null;
  const now = Date.now();
  const next: AuthSession = { ...session, lastActiveAt: now };
  try {
    const keep = getKeepSignedInPreference();
    // Identity stays tab-local (memory + sessionStorage). Never write
    // financeiag-session to shared Postgres — that overwrote other users' greetings.
    setMemorySetting(SESSION_KEY, next);
    setMemorySetting(KEEP_SIGNED_IN_KEY, keep ? "1" : "0");
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      sessionStorage.setItem(KEEP_SIGNED_IN_KEY, keep ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (session.sessionId) {
      const sessions = loadSessions().map((s) =>
        s.id === session.sessionId && !s.endedAt ? { ...s, lastActiveAt: now } : s,
      );
      saveSessionsMemory(sessions);
    }
    if (now - lastSessionDbWriteAt >= SESSION_DB_WRITE_EVERY_MS) {
      lastSessionDbWriteAt = now;
      const sessions = loadSessions();
      if (sessions.length) setAppPref(SESSIONS_KEY, sessions.slice(-40));
    }
  } catch {
    /* ignore */
  }
  return next;
}

export function sessionIsExpired(
  session: AuthSession | null,
  now = Date.now(),
): { expired: boolean; reason?: "idle" | "expired" } {
  if (!session) return { expired: true, reason: "expired" };
  const idleMs = getIdleTimeoutMs();
  const last = session.lastActiveAt || session.at || 0;
  if (now - last > idleMs) return { expired: true, reason: "idle" };

  const keep = typeof window !== "undefined" ? getKeepSignedInPreference() : true;
  const maxAge = keep ? MAX_SESSION_AGE_MS : MAX_TAB_SESSION_AGE_MS;
  if (now - (session.at || 0) > maxAge) return { expired: true, reason: "expired" };
  return { expired: false };
}

/** Validate current session; clear + emit if idle/expired. */
export function enforceSessionValidity(): boolean {
  const session = readAuthSession();
  if (!session) return false;
  const check = sessionIsExpired(session);
  if (!check.expired) return true;
  endSession(session.sessionId, check.reason);
  wipeAuthKeys();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { reason: check.reason } }),
    );
  }
  return false;
}

/**
 * Watch pointer/keyboard/visibility and expire idle sessions.
 * Returns a cleanup function.
 */
export function startSessionActivityMonitor(options?: {
  warningMsBeforeIdle?: number;
  onWarning?: (msLeft: number) => void;
  onExpired?: (reason: "idle" | "expired") => void;
}): () => void {
  if (typeof window === "undefined") return () => undefined;

  let lastTouch = Date.now();
  let warned = false;
  let touchDebounce: number | null = null;
  const warningLead = options?.warningMsBeforeIdle ?? 60_000;

  const touch = () => {
    lastTouch = Date.now();
    warned = false;
    // Debounce — mousemove must not call touchSessionActivity on every pixel.
    if (touchDebounce) return;
    touchDebounce = window.setTimeout(() => {
      touchDebounce = null;
      touchSessionActivity();
    }, 2_000);
  };

  const events: Array<keyof WindowEventMap> = [
    "mousemove",
    "mousedown",
    "keydown",
    "scroll",
    "touchstart",
    "click",
  ];
  for (const ev of events) {
    window.addEventListener(ev, touch, { passive: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") touch();
  });

  touch();

  const timer = window.setInterval(() => {
    const session = readAuthSession();
    if (!session) return;
    const idleMs = getIdleTimeoutMs();
    const idleFor = Date.now() - (session.lastActiveAt || lastTouch);
    if (!warned && idleFor >= idleMs - warningLead && idleFor < idleMs) {
      warned = true;
      const left = Math.max(0, idleMs - idleFor);
      options?.onWarning?.(left);
      window.dispatchEvent(new CustomEvent(SESSION_WARNING_EVENT, { detail: { msLeft: left } }));
    }
    const check = sessionIsExpired(session);
    if (check.expired) {
      endSession(session.sessionId, check.reason);
      wipeAuthKeys();
      options?.onExpired?.(check.reason || "idle");
      window.dispatchEvent(
        new CustomEvent(SESSION_EXPIRED_EVENT, {
          detail: { reason: check.reason },
        }),
      );
    }
  }, 1000);

  return () => {
    window.clearInterval(timer);
    if (touchDebounce) window.clearTimeout(touchDebounce);
    for (const ev of events) {
      window.removeEventListener(ev, touch);
    }
  };
}
