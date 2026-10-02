"use client";

import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

/** No viewport on the server; render the desktop layout and let hydration correct it. */
function getServerSnapshot() {
  return false;
}

/**
 * Viewport width is external mutable state, so read it through
 * useSyncExternalStore rather than mirroring it into React state from an
 * effect. The old spelling started as `undefined`, reported desktop on the
 * first client render, then re-rendered — a layout flip on every mobile load.
 */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
