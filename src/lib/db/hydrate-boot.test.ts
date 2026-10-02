/**
 * The two decisions that make the boot waterfall long.
 *
 * Hydration's cost is not the record pulls — those are tiered, chunked six at a
 * time, and ETagged. It is the serial run-up before the first business record
 * is asked for: eight round trips and, until this, 1.4 seconds of hard-coded
 * sleeps. Two of those costs came from treating a fact about the deployment as
 * a transient.
 *
 * Both are pure functions here rather than assertions about `hydrateFromDatabase`,
 * because the failure mode is a wrong verdict, not a wrong sequence — and a
 * verdict can be tested exhaustively in a millisecond.
 */
import { describe, expect, it } from "vitest";

import { bootstrapRetryable, enabledTabFilter } from "@/lib/db/sync";

describe("bootstrap retry policy", () => {
  it("does not retry an endpoint that is not deployed", () => {
    /*
      `/api/sync/bootstrap` has no filesystem route — it is one of the prefixes
      `goApiRewrites()` forwards, so with GO_API_URL unset nothing answers it.
      The old code retried every failure after a 400ms sleep, so that
      configuration paid 800ms and two doomed requests on every boot, before one
      business record was requested. A 404 will not become a 200 in 400ms.
    */
    expect(bootstrapRetryable(404)).toBe(false);
    expect(bootstrapRetryable(405)).toBe(false);
  });

  it("still retries the case the retry was written for", () => {
    // Right after login the cookie and Bearer can lag by a beat. That does
    // clear, and it is why the sleep exists at all.
    expect(bootstrapRetryable(401)).toBe(true);
  });

  it("retries a service that may just be cold", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(bootstrapRetryable(status), `${status} should retry`).toBe(true);
    }
  });

  it("does not retry a refusal that will be refused again", () => {
    // 403 is an answer about this caller, not about timing. Retrying it burns
    // the sleep and gets the same 403.
    expect(bootstrapRetryable(403)).toBe(false);
    expect(bootstrapRetryable(400)).toBe(false);
    expect(bootstrapRetryable(409)).toBe(false);
  });
});

describe("catalogue narrowing", () => {
  it("narrows to the tabs somebody enabled", () => {
    /*
      The degraded path — no bootstrap and a failed key index — falls back to
      the local catalogue. This app ships the whole finance-era one: 216
      entities across 24 modules, while the adapter maps 30. A deployment
      showing payroll and documents has 31 entities and was asking for all 216,
      185 of them for screens the operator cannot open.
    */
    const filter = enabledTabFilter(["payroll", "documents"]);
    expect(filter).not.toBeNull();
    expect(filter!.has("payroll")).toBe(true);
    expect(filter!.has("sales")).toBe(false);
  });

  it("does not narrow when the setting has not loaded", () => {
    // The important half. An empty list means the setting is not there yet,
    // never "sync nothing" — narrowing on it would turn a slow boot into an
    // empty app, which is the worse failure by a distance.
    expect(enabledTabFilter([])).toBeNull();
    expect(enabledTabFilter(null)).toBeNull();
    expect(enabledTabFilter(undefined)).toBeNull();
    expect(enabledTabFilter("payroll" as unknown as string[])).toBeNull();
  });

  it("drops empty entries rather than matching on them", () => {
    const filter = enabledTabFilter(["payroll", ""]);
    expect(filter!.has("")).toBe(false);
    expect(filter!.size).toBe(1);
  });
});
