"use client";

import { useSyncExternalStore } from "react";

/** Nothing to subscribe to — mounted-ness changes once, at hydration. */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * True once the component has hydrated in the browser, false during SSR.
 *
 * Panels that read the browser-only client store have to skip that read on the
 * server or the markup will not match on hydration. The usual spelling of that
 * is `useState(false)` plus an effect that sets it to true, which costs an
 * extra render on every such panel and makes render depend on an effect having
 * run. `useSyncExternalStore` states the same thing directly: the server
 * snapshot is false, the client snapshot is true, and React picks the right one
 * without a state write.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
