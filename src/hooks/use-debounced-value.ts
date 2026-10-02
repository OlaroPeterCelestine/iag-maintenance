import { useEffect, useState } from "react";

/** Returns `value`, updated no more than once per `delayMs` — for expensive
 * derived work (e.g. filtering large record sets) driven by a fast-changing
 * input like a search box. */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
