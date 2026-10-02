import { useRef } from "react";

const SINGLETON_KEY = "__singleton__";

/**
 * Tracks in-flight async operations by key so a second click/tap while the
 * first is still in flight is a no-op instead of firing a duplicate request
 * (e.g. a double-click producing two created records, or two saves racing
 * on the same row). One instance covers both a single always-same-key
 * operation (create) and a per-row-id operation (update/delete), since
 * callers choose the key — pass no key for the singleton case.
 */
export function useInFlightGuard() {
  const inFlightRef = useRef<Set<string>>(new Set());

  function isInFlight(key: string = SINGLETON_KEY): boolean {
    return inFlightRef.current.has(key);
  }

  function start(key: string = SINGLETON_KEY): void {
    inFlightRef.current.add(key);
  }

  function finish(key: string = SINGLETON_KEY): void {
    inFlightRef.current.delete(key);
  }

  return { isInFlight, start, finish };
}
