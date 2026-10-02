/**
 * The console lock and storage guard ship as stringified <head> scripts, so the
 * compiler cannot check them. Run them against a fake window to prove they
 * silence the console, buffer errors and reject browser writes.
 *
 * Run: npx tsx scripts/test-browser-lockdown.mts
 */
import assert from "node:assert/strict";
import vm from "node:vm";
import { browserStorageGuardScript } from "../src/lib/browser-storage-guard.ts";
import { CONSOLE_LOCK_SCRIPT, CONSOLE_SINK_GLOBAL } from "../src/lib/console-lock.ts";

type SinkEntry = { level: string; message: string; stack?: string; at: number };

/** Minimal Storage stand-in — enough for the guard's own API surface. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

function makeWindow(seed: {
  local?: Record<string, string>;
  session?: Record<string, string>;
}) {
  const printed: string[] = [];
  const win: Record<string, unknown> = {
    localStorage: fakeStorage(seed.local),
    sessionStorage: fakeStorage(seed.session),
    console: {
      log: (...a: unknown[]) => printed.push(`log:${a.join(" ")}`),
      warn: (...a: unknown[]) => printed.push(`warn:${a.join(" ")}`),
      error: (...a: unknown[]) => printed.push(`error:${a.join(" ")}`),
      info: (...a: unknown[]) => printed.push(`info:${a.join(" ")}`),
      debug: (...a: unknown[]) => printed.push(`debug:${a.join(" ")}`),
      trace: (...a: unknown[]) => printed.push(`trace:${a.join(" ")}`),
      table: (...a: unknown[]) => printed.push(`table:${a.join(" ")}`),
    },
  };
  win.window = win;
  return { win, printed };
}

function run(win: Record<string, unknown>, source: string) {
  vm.runInNewContext(source, win);
}

// ---------------------------------------------------------------- console lock

{
  const { win, printed } = makeWindow({});
  run(win, CONSOLE_LOCK_SCRIPT);

  const c = (win.window as { console: Record<string, (...a: unknown[]) => void> })
    .console;
  c.log("ledger balance", { secret: 1 });
  c.info("info");
  c.debug("debug");
  c.table([{ a: 1 }]);
  c.trace("trace");
  assert.equal(printed.length, 0, "console output must never reach the browser");

  c.error("boom", new Error("kaboom"), { payload: "sensitive" });
  c.warn("careful");
  assert.equal(printed.length, 0, "error/warn are buffered, not printed");

  const sink = (win as Record<string, unknown>)[CONSOLE_SINK_GLOBAL] as SinkEntry[];
  assert.equal(sink.length, 2, "error + warn are buffered for /api/crash");
  assert.equal(sink[0].level, "error");
  assert.match(sink[0].message, /boom Error: kaboom/);
  assert.match(sink[0].stack ?? "", /kaboom/, "Error stack is kept for triage");
  assert.doesNotMatch(
    sink[0].message,
    /sensitive/,
    "object arguments must collapse to a type tag, never their contents",
  );
  assert.equal(sink[1].level, "warn");

  // Reassignment must be swallowed, not honoured and not thrown.
  c.log = () => printed.push("restored");
  c.log("after");
  assert.equal(printed.length, 0, "console methods cannot be restored");
}

{
  const { win } = makeWindow({});
  run(win, CONSOLE_LOCK_SCRIPT);
  const c = (win.window as { console: { error: (...a: unknown[]) => void } }).console;
  for (let i = 0; i < 200; i += 1) c.error(`err ${i}`);
  const sink = (win as Record<string, unknown>)[CONSOLE_SINK_GLOBAL] as SinkEntry[];
  assert.ok(sink.length <= 50, `sink is capped, got ${sink.length}`);
}

// --------------------------------------------------------------- storage guard

{
  const { win } = makeWindow({
    local: { "financeiag-users": "[…]", "some-vendor-key": "x" },
    session: {
      "financeiag-session": "{}",
      "financeiag-ledger:lines": "[…]",
      "vendor-scroll": "1",
    },
  });
  run(win, browserStorageGuardScript(false));

  const w = win.window as {
    localStorage: Storage;
    sessionStorage: Storage;
  };

  assert.equal(w.localStorage.length, 0, "localStorage is wiped on boot");
  assert.equal(
    w.localStorage.getItem("financeiag-users"),
    null,
    "pre-existing localStorage data is gone",
  );
  w.localStorage.setItem("financeiag-invoices", "[…]");
  assert.equal(
    w.localStorage.getItem("financeiag-invoices"),
    null,
    "localStorage writes are dropped",
  );

  assert.equal(
    w.sessionStorage.getItem("financeiag-ledger:lines"),
    null,
    "non-allowlisted app keys are purged from sessionStorage",
  );
  assert.equal(
    w.sessionStorage.getItem("financeiag-session"),
    "{}",
    "allowlisted auth bridge survives",
  );
  assert.equal(
    w.sessionStorage.getItem("vendor-scroll"),
    "1",
    "framework/vendor keys are left alone",
  );

  w.sessionStorage.setItem("financeiag-records:invoices", "[…]");
  assert.equal(
    w.sessionStorage.getItem("financeiag-records:invoices"),
    null,
    "business data cannot be written to sessionStorage",
  );

  w.sessionStorage.setItem("financeiag-api-token", "jwt");
  assert.equal(
    w.sessionStorage.getItem("financeiag-api-token"),
    null,
    "JWT tokens stay memory-only — not writable to sessionStorage",
  );
}

{
  // Dev keeps non-app keys usable (Next dev overlay) but still rejects app writes.
  const { win, printed } = makeWindow({
    local: { "financeiag-users": "[…]", "__nextjs-dev-tools": "{}" },
  });
  run(win, browserStorageGuardScript(true));
  const ls = (win.window as { localStorage: Storage }).localStorage;

  assert.equal(
    ls.getItem("financeiag-users"),
    null,
    "app keys are purged from localStorage in dev too",
  );
  assert.equal(
    ls.getItem("__nextjs-dev-tools"),
    "{}",
    "framework tooling keys survive in dev",
  );

  ls.setItem("financeiag-x", "1");
  assert.equal(ls.getItem("financeiag-x"), null, "dev still blocks app writes");
  assert.equal(printed.length, 1, "dev build warns about the blocked write");
  assert.match(printed[0], /storage-guard/);

  ls.setItem("__nextjs-dev-tools", '{"x":1}');
  assert.equal(ls.getItem("__nextjs-dev-tools"), '{"x":1}', "dev tooling can write");
}

console.log("browser-lockdown: ok");
