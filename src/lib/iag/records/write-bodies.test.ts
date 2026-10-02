/**
 * What each adapter actually sends, pinned per verb.
 *
 * `registry.test.ts` asserts the shape of the mapping: that a key can be
 * routed, that a service and a resource are named, that read-only means no
 * write path. Every defect this file guards against passed all of that and
 * still failed at the column.
 *
 * Three kinds, all of which shipped:
 *
 *   Vocabulary. Every status select on this tab had its own wording and none
 *   matched the CHECK constraint behind it — "Complete" against a column that
 *   allows `completed`, "Active" against `running|idle|down|pm|maint`. A
 *   refused value arrives as a 500 carrying the raw Postgres error, which the
 *   persist layer retries three times before reporting a generic failure, so
 *   the shape of the bug was "saving is broken" rather than "that status does
 *   not exist".
 *
 *   Create and patch are different bodies. `updateRecordAsync` sends only the
 *   fields the form changed, so an adapter that builds a full body from a
 *   partial record sends zeros and empty bags for everything the user did not
 *   touch. These services take pointers and replace whole `attrs` bags, so
 *   those defaults are applied: a status-only edit of a packaging run used to
 *   zero the pack count and clear the run's attached paperwork.
 *
 *   Units. `pack_size_kg` is kilograms and the form asked for grams.
 *
 * So each case below drives a real adapter through `gatewayFetch` and asserts
 * on the body that reached the wire, for the create path and the patch path
 * separately. The service vocabularies are copied from the migrations and
 * named, so a future change to either side has to change this file too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_ADAPTERS } from "@/lib/iag/records/registry";
import type { AdapterContext, AppRecord } from "@/lib/iag/records/types";

vi.mock("@/lib/iag/gateway", async () => {
  const actual = await vi.importActual<typeof import("@/lib/iag/gateway")>(
    "@/lib/iag/gateway",
  );
  return {
    ...actual,
    gatewayFetch: vi.fn(async () => ({ items: [] })),
  };
});

const { gatewayFetch } = await import("@/lib/iag/gateway");
const mockFetch = vi.mocked(gatewayFetch);

const ctx: AdapterContext = {
  module: "production",
  entity: "test",
  query: new URLSearchParams(),
};

/** Column vocabularies, copied from the migrations that define them. */
const SERVICE_STATUSES = {
  // prod_production_runs, 001_schema.sql + 008_run_lifecycle.sql
  productionRun: [
    "running",
    "awaiting_decision",
    "awaiting_flag",
    "flagged",
    "on_hold",
    "completed",
    "cancelled",
  ],
  // prod_packaging_runs, 006_packaging_runs.sql
  packagingRun: [
    "scheduled",
    "packing",
    "line_clearance",
    "complete",
    "quality_hold",
    "rejected",
  ],
} as const;

/** prod_production_runs.process, 001_schema.sql */
const PROCESS_CODES = ["wet", "dry", "wetmill", "drying", "drymill", "roast", "p1", "p2"];

function record(fields: Record<string, string>): AppRecord {
  return { id: "", createdAt: "", updatedAt: "", ...fields } as AppRecord;
}

/** The body the adapter put on the wire for its most recent call. */
function lastBody(): Record<string, unknown> {
  const call = mockFetch.mock.calls.at(-1);
  expect(call, "the adapter made no gateway call").toBeTruthy();
  return (call![0].body || {}) as Record<string, unknown>;
}

async function bodyForCreate(key: string, fields: Record<string, string>) {
  const adapter = RECORD_ADAPTERS[key];
  expect(adapter?.create, `${key} has no create verb`).toBeTruthy();
  await adapter.create!(ctx, record(fields));
  return lastBody();
}

async function bodyForPatch(key: string, fields: Record<string, string>) {
  const adapter = RECORD_ADAPTERS[key];
  expect(adapter?.update, `${key} has no update verb`).toBeTruthy();
  await adapter.update!(ctx, "ID-1", record(fields));
  return lastBody();
}

beforeEach(() => {
  mockFetch.mockClear();
  // Creating a work centre resolves `section_id` from `GET /sections` first —
  // MES requires it and a flat record has no field for it — so that one read
  // has to answer with something or the create never reaches the wire.
  mockFetch.mockImplementation((async (req: { path?: string }) =>
    req?.path === "/api/v1/sections"
      ? { items: [{ id: "sec-1", code: "ROASTERY", name: "Roastery" }] }
      : { items: [] }) as never);
});

/* ───────────────────────── status vocabularies ───────────────────────── */

describe("statuses reach the column in the vocabulary it accepts", () => {
  it("packaging runs, on create and on patch alike", async () => {
    const options = [
      "Scheduled",
      "Packing",
      "Line clearance",
      "Complete",
      "Quality hold",
      "Rejected",
    ];
    for (const option of options) {
      const created = await bodyForCreate("production:packaging-runs", {
        reference: "PK-1",
        status: option,
      });
      expect(SERVICE_STATUSES.packagingRun, `create ${option}`).toContain(created.status);

      const patched = await bodyForPatch("production:packaging-runs", { status: option });
      expect(SERVICE_STATUSES.packagingRun, `patch ${option}`).toContain(patched.status);
    }
  });

  it("round-trips a work centre status without drifting", async () => {
    // "maint" reads as "Maintenance" and must write back as "maint" — neither
    // titleCase nor snakeCase round-trips that pair, which is why the adapter
    // spells the mapping out.
    const body = await bodyForPatch("production:work-centers", { status: "Maintenance" });
    expect(body.status).toBe("maint");
  });
});

/* ─────────────────────────── constrained enums ───────────────────────── */

describe("roast batches", () => {
  it("sends a process code whatever the operator named the recipe", async () => {
    // `process` is a CHECK-constrained stage kind and the form field beside it
    // says "Roast profile / recipe", so a recipe name used to reach the column
    // and be refused. This screen is roasting, so the code is fixed.
    for (const recipe of ["Ethiopian medium", "House blend v3", "", "Roast"]) {
      const body = await bodyForCreate("production:roast-batches", {
        greenLot: "LOT-1",
        recipe,
      });
      expect(PROCESS_CODES, `recipe ${recipe || "(blank)"}`).toContain(body.process);
      expect(body.process).toBe("roast");
    }
  });

  it("keeps the recipe the operator named, rather than discarding it", async () => {
    const body = await bodyForCreate("production:roast-batches", {
      greenLot: "LOT-1",
      recipe: "Ethiopian medium",
    });
    const attrs = body.attrs as { recipe?: string };
    expect(attrs?.recipe).toBe("Ethiopian medium");
  });

  it("sends the reference the operator typed", async () => {
    // Required on the form, and the service generates one when it is absent —
    // so discarding it meant the number the operator wrote on the sheet and
    // the number the app showed were different.
    const body = await bodyForCreate("production:roast-batches", {
      reference: "RUN-0042",
      greenLot: "LOT-1",
      recipe: "Ethiopian medium",
    });
    expect(body.business_id).toBe("RUN-0042");
  });

  it("links the run to its order, or nothing derives the order's status", async () => {
    const body = await bodyForCreate("production:roast-batches", {
      greenLot: "LOT-1",
      recipe: "Roast",
      productionOrder: "PO-7",
    });
    expect(body.po_num).toBe("PO-7");
  });

  it("does not write status — the service owns a run's lifecycle", async () => {
    const body = await bodyForCreate("production:roast-batches", {
      greenLot: "LOT-1",
      recipe: "Roast",
      status: "Running",
    });
    expect(body.status).toBeUndefined();
  });
});

/* ──────────────────────── partial patch safety ───────────────────────── */

describe("a patch says only what the form changed", () => {
  it("does not zero a packaging run's counts when only the status moved", async () => {
    const body = await bodyForPatch("production:packaging-runs", { status: "Complete" });
    // UpdatePackagingRunInput takes pointers, so a zero that arrives is
    // applied. Absent is the only safe way to say "unchanged".
    expect(body).not.toHaveProperty("pack_size_kg");
    expect(body).not.toHaveProperty("planned_qty");
    expect(body).not.toHaveProperty("qty");
  });

  it("does not clear a packaging run's attachments when only the status moved", async () => {
    const body = await bodyForPatch("production:packaging-runs", { status: "Complete" });
    // `if in.Attrs != nil { cur.Attrs = in.Attrs }` — an empty bag is a wipe,
    // on the record a recall is traced through.
    expect(body).not.toHaveProperty("attrs");
  });

  it("does not overwrite an assigned lot code it cannot reconstruct", async () => {
    const body = await bodyForPatch("production:packaging-runs", { status: "Complete" });
    expect(body).not.toHaveProperty("lot_code");
  });

  it("still sends the values a full edit supplies", async () => {
    const body = await bodyForPatch("production:packaging-runs", {
      packSize: "0.25",
      plannedQuantity: "400",
      quantity: "396",
      lotCode: "L-2026-001",
    });
    expect(body.pack_size_kg).toBe(0.25);
    expect(body.planned_qty).toBe(400);
    expect(body.qty).toBe(396);
    expect(body.lot_code).toBe("L-2026-001");
  });
});

/* ───────────────────────────────── units ─────────────────────────────── */

describe("pack size is kilograms, as the column and the form both now say", () => {
  it("passes the figure through unscaled", async () => {
    // The service computes output_kg = qty * pack_size_kg. A 250 g bag is
    // 0.25 here; it was typed as 250 against a form labelled grams, which made
    // every packaging run's output a thousand times too large.
    const body = await bodyForCreate("production:packaging-runs", {
      reference: "PK-1",
      packSize: "0.25",
      quantity: "400",
    });
    expect(body.pack_size_kg).toBe(0.25);
  });
});

/* ──────────────────────────── attachments ────────────────────────────── */

describe("attachments", () => {
  it("never sends bytes upstream, only references", async () => {
    const inline = JSON.stringify([
      { id: "a", name: "cert.pdf", mime: "application/pdf", dataUrl: "data:application/pdf;base64,AAAA" },
    ]);
    const body = await bodyForCreate("production:packaging-runs", {
      reference: "PK-1",
      attachments: inline,
    });
    // No storageId means the bytes were never uploaded, so there is nothing to
    // reference and the key is omitted rather than a data URL stored in JSONB.
    expect(JSON.stringify(body)).not.toContain("data:");
    expect(body).not.toHaveProperty("attrs");
  });

  it("sends a stored reference when there is one", async () => {
    const stored = JSON.stringify([
      {
        id: "a",
        storageId: "s-1",
        name: "cert.pdf",
        mime: "application/pdf",
        size: 10,
        uploadedAt: "2026-09-23T00:00:00Z",
      },
    ]);
    const body = await bodyForCreate("production:packaging-runs", {
      reference: "PK-1",
      attachments: stored,
    });
    const attrs = body.attrs as { attachments?: Array<{ storageId?: string }> };
    expect(attrs?.attachments?.[0]?.storageId).toBe("s-1");
  });
});

/* ────────────────────────────── list reads ───────────────────────────── */

describe("list reads ask for what the screen claims to show", () => {
  it("raises the page size past each service's default of 50", async () => {
    for (const key of [
      "production:work-orders",
      "production:batch-records",
      "production:downtime-logs",
      "production:roast-batches",
    ]) {
      mockFetch.mockClear();
      await RECORD_ADAPTERS[key].list(ctx);
      const query = mockFetch.mock.calls.at(-1)![0].query as Record<string, unknown>;
      expect(Number(query?.limit), `${key} page size`).toBeGreaterThan(50);
    }
  });
});
