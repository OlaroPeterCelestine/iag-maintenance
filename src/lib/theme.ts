import { getAppPref, setAppPref, discardLegacyLocalStorageValue } from "@/lib/db/app-prefs";

export type ThemeMode = "light" | "dark" | "system";

export const THEME_KEY = "financeiag-theme";
export const THEME_CHANGED_EVENT = "financeiag-theme-changed";
const THEME_COOKIE = "financeiag-theme";

function writeThemeCookie(mode: ThemeMode) {
  try {
    document.cookie = `${THEME_COOKIE}=${encodeURIComponent(mode)};path=/;max-age=31536000;SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

function readThemeCookie(): ThemeMode | null {
  if (typeof document === "undefined") return null;
  try {
    const match = document.cookie.match(/(?:^|;\s*)financeiag-theme=([^;]+)/);
    const value = match?.[1] ? decodeURIComponent(match[1]) : "";
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    /* ignore */
  }
  return null;
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function loadThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const fromPref = getAppPref<string | null>(THEME_KEY, null);
  if (fromPref === "light" || fromPref === "dark" || fromPref === "system") return fromPref;
  const cookie = readThemeCookie();
  if (cookie) {
    setAppPref(THEME_KEY, cookie);
    return cookie;
  }
  // Discard any leftover LS theme — do not import it into Postgres.
  discardLegacyLocalStorageValue(THEME_KEY);
  return "light";
}

/** Whether the given mode should render dark right now. */
export function resolveDark(mode: ThemeMode): boolean {
  return mode === "dark" || (mode === "system" && systemPrefersDark());
}

/** Toggle the `dark` class on <html> to match the mode. */
export function applyThemeMode(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const dark = resolveDark(mode);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function saveThemeMode(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  setAppPref(THEME_KEY, mode);
  writeThemeCookie(mode);
  applyThemeMode(mode);
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: mode }));
}

/** Inline script — cookie first (no localStorage), then light default. */
export const THEME_INIT_SCRIPT = `(function(){try{var m='light';var c=document.cookie.match(/(?:^|;\\s*)financeiag-theme=([^;]*)/);if(c&&c[1]){try{m=decodeURIComponent(c[1]);}catch(e){}}if(m!=='light'&&m!=='dark'&&m!=='system')m='light';var d=m==='dark'||(m==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
