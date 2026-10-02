"use client";

/**
 * A tab left open across a deploy still holds the previous build id, so the
 * next lazy import asks for a chunk filename that no longer exists and Next
 * throws ChunkLoadError. Nothing is wrong with the code — the fix is to pull
 * fresh HTML — so detect it and reload, with a counter so a genuinely broken
 * build can't put the tab in a reload loop.
 */

const STATE_KEY = "financeiag-chunk-recovery";
const WINDOW_MS = 60_000;
const MAX_RELOADS = 2;

const CHUNK_PATTERNS = [
  /loading chunk \S+ failed/i,
  /failed to load chunk/i,
  /loading css chunk/i,
  /error loading dynamically imported module/i,
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /'text\/html' is not a valid javascript mime type/i,
];

type RecoveryState = { count: number; at: number };

let reloading = false;

function readState(): RecoveryState {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return { count: 0, at: 0 };
    const parsed = JSON.parse(raw) as Partial<RecoveryState>;
    return { count: Number(parsed.count) || 0, at: Number(parsed.at) || 0 };
  } catch {
    return { count: 0, at: 0 };
  }
}

function writeState(state: RecoveryState): boolean {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * A `<script>` / `<link>` that 404s fires a plain load error on the element,
 * not a ChunkLoadError — it never reaches window.onerror as an ErrorEvent with
 * a message, so the patterns above cannot see it. That is exactly the shape a
 * dead build asset takes, which made it the one stale-chunk failure the app
 * did not self-heal from. Returns the offending path, or "".
 */
function deadBuildAssetPath(target: EventTarget | null): string {
  const src =
    target instanceof HTMLScriptElement
      ? target.src
      : target instanceof HTMLLinkElement
        ? target.href
        : "";
  if (!src) return "";
  try {
    const url = new URL(src, window.location.href);
    if (url.origin !== window.location.origin) return "";
    return url.pathname.startsWith("/_next/static/") ? url.pathname : "";
  } catch {
    return "";
  }
}

/**
 * Watches for build assets that fail to load and recovers the tab.
 * Resource errors do not bubble, so this must listen in the capture phase.
 */
export function installChunkAssetWatcher(): () => void {
  if (typeof window === "undefined") return () => {};
  const onAssetError = (event: Event) => {
    if (!deadBuildAssetPath(event.target)) return;
    recoverFromChunkError();
  };
  window.addEventListener("error", onAssetError, true);
  return () => window.removeEventListener("error", onAssetError, true);
}

/**
 * Retries a lazy import before giving up on it. A chunk request that fails on a
 * flaky connection is indistinguishable from one that failed because the build
 * moved, and a full reload throws away whatever the user had typed — so try
 * again first and only let the error escape to the boundary if it persists.
 */
export async function importWithRetry<T>(
  loader: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await loader();
    } catch (error) {
      lastError = error;
      // A genuine module error (bad export, thrown at import time) must surface
      // immediately — retrying it just delays the real message.
      if (!isChunkLoadError(error)) throw error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = error instanceof Error ? error.name : "";
  if (name === "ChunkLoadError") return true;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return false;
  return CHUNK_PATTERNS.some((re) => re.test(message));
}

/** Clears the reload counter once the app has stayed up on a fresh build. */
export function markChunkRecoverySettled(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* ignore */
  }
  // Drop the cache-bust query added by recoverFromChunkError.
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("_chunk")) {
      url.searchParams.delete("_chunk");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  } catch {
    /* ignore */
  }
}

/** Drop SW-held app shells so a reload cannot revive HTML that points at dead chunks. */
async function clearStaleClientCaches(): Promise<void> {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* ignore */
  }
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs.map(async (reg) => {
          try {
            await reg.update();
          } catch {
            /* ignore */
          }
        }),
      );
    }
  } catch {
    /* ignore */
  }
}

/**
 * Reloads the tab to pick up the current build. Returns false when the budget
 * is spent, so callers fall back to showing their error UI.
 */
export function recoverFromChunkError(): boolean {
  if (typeof window === "undefined") return false;

  if (reloading) return true;

  const now = Date.now();
  const prev = readState();
  const count = now - prev.at > WINDOW_MS ? 0 : prev.count;
  if (count >= MAX_RELOADS) return false;
  // Without persistence the counter resets on every load, so a build that is
  // actually broken would reload forever. Show the error UI instead.
  if (!writeState({ count: count + 1, at: now })) return false;
  reloading = true;

  // Clear caches, then hard-navigate (replace, not soft reload) so bfcache /
  // SW offline shells cannot resurrect the stale document.
  void clearStaleClientCaches().finally(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("_chunk", String(now));
    window.location.replace(url.toString());
  });
  return true;
}
