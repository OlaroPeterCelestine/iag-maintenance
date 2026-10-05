import { NextResponse } from "next/server";
import { GatewayError } from "@/lib/iag/gateway";
import { InputError } from "@/lib/iag/records/types";

/**
 * Map an adapter failure to the records API response. A refusal of the
 * request (InputError) keeps its 4xx so the client shows it at once instead
 * of retrying a 5xx; anything else an adapter throws is a fault and stays 500.
 */
export function recordFailure(err: unknown) {
  if (err instanceof GatewayError) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: err.status >= 500 ? 502 : err.status },
    );
  }
  if (err instanceof InputError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Unexpected error";
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}
