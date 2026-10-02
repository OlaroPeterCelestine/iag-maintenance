/**
 * A misconfigured expiry must not take sign-in down.
 *
 * `JWT_EXPIRY` and `JWT_EXPIRY_KEEP` are passed to jose's `setExpirationTime`,
 * which accepts a specific grammar and throws `Invalid time period format` on
 * anything else. `parseExpiry` used to trim the value and return it unchanged,
 * with a comment asserting jose would accept it.
 *
 * The failure that produces is the confusing kind. A wrong password is rejected
 * before a token is ever minted, so it gets a clean 401 — while a *correct*
 * password reaches `issueApiToken` and throws, so it gets a 500. "Login is
 * broken for some people" and "login is broken when you tick the box" are the
 * same bug, and neither points at an environment variable.
 *
 * So these cases are about the values a deployment actually gets wrong: a bare
 * number of seconds, a value someone pasted with its quotes, a unit jose does
 * not know. Each must degrade to the default and log which variable to fix.
 */
import { afterEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import {
  expirySecondsFromString,
  isValidExpiry,
  keepSignedInExpiry,
} from "@/lib/server-jwt";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

/** What jose itself does with the value, so the grammar is not guesswork. */
async function joseAccepts(value: string): Promise<boolean> {
  try {
    await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(value)
      .sign(new TextEncoder().encode("secret-long-enough-for-hs256-aaaaaaaa"));
    return true;
  } catch {
    return false;
  }
}

describe("the expiry grammar matches jose's", () => {
  const good = ["12h", "30d", "720m", "1 hour", "2 days", "90s", "1y"];
  const bad = ["43200", '"12h"', "12 hours ish", "h12", "", "soon", "12x"];

  it("accepts what jose accepts", async () => {
    for (const v of good) {
      expect(await joseAccepts(v), `jose should accept ${v}`).toBe(true);
      expect(isValidExpiry(v), `isValidExpiry should accept ${v}`).toBe(true);
    }
  });

  it("rejects what jose rejects", async () => {
    for (const v of bad) {
      expect(await joseAccepts(v), `jose should reject ${JSON.stringify(v)}`).toBe(false);
      expect(isValidExpiry(v), `isValidExpiry should reject ${JSON.stringify(v)}`).toBe(false);
    }
  });
});

describe("a bad JWT_EXPIRY_KEEP does not break the checkbox", () => {
  it("falls back to 30d rather than handing jose a bare number", async () => {
    // The shape that broke it: seconds, which reads like a duration and is not
    // one. Sign-in with the box unticked worked, so the report was "it only
    // fails for some people".
    process.env.JWT_EXPIRY_KEEP = "2592000";
    const value = keepSignedInExpiry();
    expect(value).toBe("30d");
    expect(await joseAccepts(value)).toBe(true);
  });

  it("strips quotes someone pasted from a dashboard", async () => {
    process.env.JWT_EXPIRY_KEEP = '"30d"';
    expect(keepSignedInExpiry()).toBe("30d");
  });

  it("passes a valid value through untouched", () => {
    process.env.JWT_EXPIRY_KEEP = "14d";
    expect(keepSignedInExpiry()).toBe("14d");
  });

  it("defaults when unset", () => {
    delete process.env.JWT_EXPIRY_KEEP;
    expect(keepSignedInExpiry()).toBe("30d");
  });
});

describe("cookie Max-Age survives a bad expiry", () => {
  it("does not return NaN for an unparseable value", () => {
    // A NaN Max-Age makes the cookie a session cookie, so the user is signed
    // out on browser close with nothing explaining why.
    const seconds = expirySecondsFromString("not-a-duration");
    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeGreaterThan(0);
  });

  it("converts the units it supports", () => {
    expect(expirySecondsFromString("90s")).toBe(90);
    expect(expirySecondsFromString("30m")).toBe(1800);
    expect(expirySecondsFromString("12h")).toBe(43200);
    expect(expirySecondsFromString("30d")).toBe(2592000);
  });
});
