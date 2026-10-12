import { describe, expect, it } from "vitest";
import { planTokenCookies, readTokenCookie, TOKEN_COOKIE_CHUNK } from "@/lib/iag/token-cookie";

describe("platform token cookies", () => {
  it("keeps a short token in the base cookie and drops leftover chunks", () => {
    const plan = planTokenCookies("iag_pt", "abc.def");
    expect(plan.set).toEqual([{ name: "iag_pt", value: "abc.def" }]);
    expect(plan.clear).toContain("iag_pt.0");
    expect(plan.clear).not.toContain("iag_pt");
  });

  it("splits a token the browser would otherwise refuse", () => {
    const value = "x".repeat(TOKEN_COOKIE_CHUNK + 50);
    const plan = planTokenCookies("iag_pt", value);
    expect(plan.set.map((part) => part.name)).toEqual(["iag_pt.0", "iag_pt.1"]);
    expect(plan.set.map((part) => part.value).join("")).toBe(value);
    expect(plan.clear).toContain("iag_pt");
    expect(plan.set.every((part) => part.value.length <= TOKEN_COOKIE_CHUNK)).toBe(true);

    const stored = new Map(plan.set.map((part) => [part.name, part.value]));
    expect(readTokenCookie((name) => stored.get(name), "iag_pt")).toBe(value);
  });

  it("prefers a single cookie over chunks", () => {
    expect(readTokenCookie((name) => (name === "iag_pt" ? "whole" : "chunk"), "iag_pt")).toBe("whole");
  });
});
