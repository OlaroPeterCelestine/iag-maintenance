/**
 * The suppression runs as a raw <head> string, so a typo in it would fail
 * silently in the browser. Exercise the script and the matcher together.
 */
import assert from "node:assert/strict";

import {
  RESIZE_OBSERVER_NOISE_SCRIPT,
  isResizeObserverNoise,
} from "../src/lib/resize-observer-noise.ts";

const BENIGN = "ResizeObserver loop completed with undelivered notifications.";
const LEGACY = "ResizeObserver loop limit exceeded";
const REAL = "Cannot read properties of undefined (reading 'map')";

assert.equal(isResizeObserverNoise(BENIGN), true, "current Chrome/Firefox wording matches");
assert.equal(isResizeObserverNoise(LEGACY), true, "older wording matches");
assert.equal(isResizeObserverNoise(new Error(BENIGN)), true, "Error objects match");
assert.equal(isResizeObserverNoise(REAL), false, "real errors are still reported");
assert.equal(isResizeObserverNoise(undefined), false, "missing message is not noise");

type Listener = (event: Record<string, unknown>) => void;

function runScript() {
  const listeners: Array<{ listener: Listener; capture: boolean }> = [];
  const win = {
    addEventListener(type: string, listener: Listener, capture?: boolean) {
      if (type === "error") listeners.push({ listener, capture: capture === true });
    },
  } as Record<string, unknown>;

  new Function("window", RESIZE_OBSERVER_NOISE_SCRIPT)(win);
  return { win, listeners };
}

const { win, listeners } = runScript();
assert.equal(listeners.length, 1, "one error listener is installed");
assert.equal(listeners[0].capture, true, "listener runs in the capture phase");

function dispatch(message: string) {
  const calls = { stopImmediatePropagation: 0, preventDefault: 0 };
  listeners[0].listener({
    message,
    stopImmediatePropagation: () => (calls.stopImmediatePropagation += 1),
    preventDefault: () => (calls.preventDefault += 1),
  });
  return calls;
}

const swallowed = dispatch(BENIGN);
assert.equal(swallowed.stopImmediatePropagation, 1, "noise never reaches other handlers");
assert.equal(swallowed.preventDefault, 1, "noise is not logged by the browser");

const passedThrough = dispatch(REAL);
assert.equal(passedThrough.stopImmediatePropagation, 0, "real errors still propagate");
assert.equal(passedThrough.preventDefault, 0, "real errors are not suppressed");

// Re-running the head script (Next re-injects on soft navigation) must not stack listeners.
new Function("window", RESIZE_OBSERVER_NOISE_SCRIPT)(win);
assert.equal(listeners.length, 1, "script is idempotent");

console.log("resize-observer-noise: ok");
