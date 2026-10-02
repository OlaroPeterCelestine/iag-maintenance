/**
 * Every `/api/auth/*` endpoint the client calls must be answered by something
 * that knows about platform accounts.
 *
 * This is the failure this file exists to prevent, and it is invisible from the
 * outside: `goApiRewrites()` proxies `/api/auth/:path*` to the shared Go API,
 * which has its own user table and has never heard of an iag-authentication
 * account. An endpoint with no filesystem route therefore does not 404 — it
 * reaches a real server that answers 401 for a credential that is perfectly
 * valid, or, if a same-named Go account happens to exist, acts on the wrong
 * one. Sign-in works, so the app looks connected, and only the password and
 * directory screens are quietly talking to a different identity store.
 *
 * A route added to `auth-api.ts` without a handler is caught here rather than
 * by a user who cannot change their password.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const API_AUTH_DIR = join(process.cwd(), "src", "app", "api", "auth");

/** Endpoints this app serves itself, from the filesystem. */
function servedLocally(): Set<string> {
  return new Set(
    readdirSync(API_AUTH_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
}

/** Endpoints the browser actually calls, read from the client helper. */
function calledByClient(): Set<string> {
  const source = readFileSync(
    join(process.cwd(), "src", "lib", "auth-api.ts"),
    "utf8",
  );
  const found = new Set<string>();
  for (const match of source.matchAll(/["'`]\/api\/auth\/([a-z0-9-]+)["'`]/g)) {
    found.add(match[1]);
  }
  return found;
}

/**
 * Endpoints deliberately left on the legacy Go API, each with the reason.
 *
 * These are not oversights, and the list is short on purpose: anything here is
 * a screen that does not work for a platform account, so it should either be
 * wired or removed rather than parked.
 */
const LEGACY_BY_DESIGN: Record<string, string> = {
  // iag-authentication resets by emailed link + token; this app's UI is a
  // six-digit OTP machine. /api/auth/forgot-password now calls the platform and
  // tells the page to stop at "check your email", so these two steps are only
  // ever reached in legacy mode. Wiring them means agreeing on one reset UX
  // first — a product decision, not a mapping.
  "verify-reset-otp": "platform resets by emailed link, not a typed code",
  "reset-password": "platform resets by emailed link, not a typed code",
  // iag-authentication exposes no self-service profile edit: the only name
  // change is PATCH /v1/admin/users/:id, which is admin-only. Routing a user's
  // own rename through an admin endpoint would hand every caller admin scope.
  profile: "no self-service profile endpoint on iag-authentication",
  // Seeding demo accounts is a legacy-only concept; the platform provisions
  // accounts in its own admin.
  seed: "platform accounts are provisioned in the platform's admin",
};

describe("auth surface", () => {
  it("serves every auth endpoint the client calls, or names why not", () => {
    const local = servedLocally();
    const unserved = [...calledByClient()]
      .filter((endpoint) => !local.has(endpoint))
      .filter((endpoint) => !(endpoint in LEGACY_BY_DESIGN))
      .sort();

    expect(
      unserved,
      `These /api/auth/* calls fall through to the Go API, which does not know platform accounts: ${unserved.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps sign-in, identity and the role matrix on the platform", () => {
    // The three that must never regress to the legacy proxy: without them a
    // platform user cannot sign in, cannot be identified, and lands on an
    // empty workspace.
    const local = servedLocally();
    for (const endpoint of ["login", "logout", "me", "roles"]) {
      expect(local.has(endpoint), `/api/auth/${endpoint} has no handler`).toBe(true);
    }
  });

  it("does not park an endpoint as legacy that is in fact served", () => {
    // A stale exemption hides a regression: if the route exists, the reason for
    // exempting it no longer applies and the note should go.
    const local = servedLocally();
    const stale = Object.keys(LEGACY_BY_DESIGN).filter((e) => local.has(e));
    expect(
      stale,
      `Exempted but actually served — drop the exemption: ${stale.join(", ")}`,
    ).toEqual([]);
  });
});
