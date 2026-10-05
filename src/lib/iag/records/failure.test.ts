import { describe, expect, it } from "vitest";
import { GatewayError } from "@/lib/iag/gateway";
import { recordFailure } from "@/lib/iag/records/failure";
import { InputError } from "@/lib/iag/records/types";

describe("recordFailure", () => {
  it("answers an adapter refusal with its 4xx so the client does not retry it", async () => {
    const res = recordFailure(new InputError("A machine's plant section is set when it is registered."));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      error: "A machine's plant section is set when it is registered.",
    });
    expect(recordFailure(new InputError("Machine M-1 was not found in MES.", 404)).status).toBe(404);
  });

  it("passes a service 4xx through and turns a service 5xx into 502", () => {
    expect(recordFailure(new GatewayError(409, "overlaps Day")).status).toBe(409);
    expect(recordFailure(new GatewayError(500, "boom")).status).toBe(502);
  });

  it("keeps faults at 500", () => {
    expect(recordFailure(new Error("MES returned a section without an id.")).status).toBe(500);
    expect(recordFailure(new TypeError("x is undefined")).status).toBe(500);
    expect(recordFailure("nope").status).toBe(500);
  });
});
