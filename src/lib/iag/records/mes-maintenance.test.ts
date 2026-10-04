/**
 * What the maintenance adapters put on the wire, pinned per verb.
 *
 * Every case here is a save that failed, or wrote somewhere it should not,
 * before the tabs moved onto MES:
 *
 *   - Job cards sent `priority: "normal"`, outside the column's CHECK, so MES
 *     refused every one with a 400.
 *   - Downtime sent the date input's bare `2026-10-02` as `started_at`, which a
 *     Go `time.Time` will not bind, so every downtime was a 400.
 *   - An unmatched plant section silently filed a machine under the first
 *     section MES returned.
 *   - PATCH /assets/:tag replaces `attrs` whole, so editing a machine's notes
 *     wiped its responsible technician.
 *
 * Vocabularies are copied from the MES migrations and named, so a change on
 * either side has to change this file too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RECORD_ADAPTERS } from "@/lib/iag/records/registry";
import { plantInstant, priorityForService } from "@/lib/iag/records/mes-maintenance";
import type { AdapterContext, AppRecord } from "@/lib/iag/records/types";

vi.mock("@/lib/iag/gateway", async () => {
  const actual = await vi.importActual<typeof import("@/lib/iag/gateway")>(
    "@/lib/iag/gateway",
  );
  return { ...actual, gatewayFetch: vi.fn(async () => ({ items: [] })) };
});

const { gatewayFetch } = await import("@/lib/iag/gateway");
const mockFetch = vi.mocked(gatewayFetch);

type Call = { path?: string; method?: string; body?: Record<string, unknown>; query?: unknown };

const ctx: AdapterContext = {
  module: "production",
  entity: "test",
  query: new URLSearchParams(),
};

/** mes_work_orders, 002_schema.sql + 005_cmms_gaps.sql */
const WORK_ORDER_STATUSES = ["draft", "scheduled", "open", "in_progress", "completed", "cancelled"];
const WORK_ORDER_PRIORITIES = ["critical", "high", "medium", "low"];
/** mes_assets, 002_schema.sql + 012 (retired) */
const ASSET_STATUSES = ["running", "idle", "down", "pm", "maint", "retired"];
const ASSET_CRITICALITIES = ["A", "B", "C", "D"];

function record(fields: Record<string, string>): AppRecord {
  return { id: "", createdAt: "", updatedAt: "", ...fields } as AppRecord;
}

function calls(): Call[] {
  return mockFetch.mock.calls.map((c) => c[0] as Call);
}

function writes(): Call[] {
  return calls().filter((c) => c.method && c.method !== "GET");
}

/** What MES answers, by path. Anything unlisted answers an empty list. */
let routes: Record<string, unknown> = {};

beforeEach(() => {
  mockFetch.mockClear();
  routes = {
    "/api/v1/sections": {
      items: [
        { id: "sec-1", code: "MILL", name: "Dry mill" },
        { id: "sec-2", code: "ROAST", name: "Roastery" },
      ],
    },
    "/api/v1/pm-templates": {
      items: [{ id: "tpl-1", code: "PM-GREASE", name: "Grease bearings", interval_days: 30 }],
    },
    "/api/v1/work-orders/WO-7": {
      num: "WO-7",
      title: "Huller bearing",
      asset_tag: "HUL-1",
      status: "in_progress",
      assignee: "Okello",
      attrs: { job_card: { date: "2026-10-01", hours: "3", workDone: "Replaced bearing" } },
    },
    "/api/v1/work-orders/WO-8": {
      num: "WO-8",
      title: "Compressor service",
      asset_tag: "CMP-1",
      status: "open",
      attrs: {},
    },
    "/api/v1/assets/HUL-1": {
      tag: "HUL-1",
      name: "Huller 1",
      attrs: { supervisor: "Okello", notes: "old note" },
    },
  };
  mockFetch.mockImplementation((async (req: Call) => {
    if (req.method === "POST" && req.path?.endsWith("/complete")) {
      return { num: req.path.split("/")[4], status: "completed", asset_tag: "HUL-1" };
    }
    if (req.method && req.method !== "GET") return { ...(req.body || {}), num: "WO-9", tag: "T" };
    return routes[req.path || ""] ?? { items: [] };
  }) as never);
});

/* ──────────────────────────── work orders ──────────────────────────── */

describe("work orders", () => {
  it("are MES work orders, not iag-production orders", () => {
    expect(RECORD_ADAPTERS["production:work-orders"].service).toBe("mes");
    expect(RECORD_ADAPTERS["production:work-orders"].resource).toBe("/api/v1/work-orders");
    expect(RECORD_ADAPTERS["production:production-orders"]).toBeUndefined();
  });

  it("send a priority and status the columns accept, for every option the form offers", async () => {
    const adapter = RECORD_ADAPTERS["production:work-orders"];
    for (const priority of ["Medium", "High", "Critical", "Low"]) {
      for (const status of ["Open", "Draft", "Scheduled", "In Progress", "Cancelled"]) {
        mockFetch.mockClear();
        await adapter.create!(
          ctx,
          record({ title: "x", workCenter: "HUL-1", woType: "Breakdown", priority, status }),
        );
        const body = writes()[0].body!;
        expect(WORK_ORDER_PRIORITIES, priority).toContain(body.priority);
        expect(WORK_ORDER_STATUSES, status).toContain(body.status);
      }
    }
  });

  it("never sends the priority that refused every job card", () => {
    expect(priorityForService("normal")).toBe("medium");
    expect(priorityForService("")).toBeUndefined();
    expect(priorityForService("In Progress")).toBe("medium");
  });

  it("refuses a work order with no machine before it reaches MES", async () => {
    await expect(
      RECORD_ADAPTERS["production:work-orders"].create!(ctx, record({ title: "x" })),
    ).rejects.toThrow(/machine/i);
    expect(writes()).toHaveLength(0);
  });

  it("always lets MES number a work order, even if the form carried a reference", async () => {
    // The form layer fills any `reference` field with DOC-0001 at submit; MES's
    // own sequence is WO-2281 onwards.
    await RECORD_ADAPTERS["production:work-orders"].create!(
      ctx,
      record({ title: "x", workCenter: "HUL-1", reference: "DOC-0001" }),
    );
    expect(writes()[0].body).not.toHaveProperty("num");
  });

  it("sends due dates as RFC3339 — CreateWorkOrder binds without coercion", async () => {
    await RECORD_ADAPTERS["production:work-orders"].create!(
      ctx,
      record({ title: "x", workCenter: "HUL-1", dueDate: "2026-10-09" }),
    );
    expect(writes()[0].body!.due_at).toBe("2026-10-09T00:00:00Z");
  });

  it("completes through POST /complete, which advances the PM schedule; a PATCH would not", async () => {
    await RECORD_ADAPTERS["production:work-orders"].update!(
      ctx,
      "WO-8",
      record({ status: "Completed", assignee: "Akello" }),
    );
    const sent = writes();
    expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual([
      "PATCH /api/v1/work-orders/WO-8",
      "POST /api/v1/work-orders/WO-8/complete",
    ]);
    expect(sent[0].body).not.toHaveProperty("status");
    expect(sent[0].body!.assignee).toBe("Akello");
  });

  it("does not PATCH at all when completing is the only change", async () => {
    await RECORD_ADAPTERS["production:work-orders"].update!(
      ctx,
      "WO-8",
      record({ status: "Completed" }),
    );
    expect(writes().map((c) => c.method)).toEqual(["POST"]);
  });

  it("offers Start and Complete on the row menu, gated on the MES permissions", () => {
    const actions = RECORD_ADAPTERS["production:work-orders"].actions || [];
    expect(actions.map((a) => [a.id, a.permission])).toEqual([
      ["start", "mes.change_work_order"],
      ["complete", "mes.complete_work_order"],
    ]);
  });
});

/* ───────────────────────────── job cards ───────────────────────────── */

describe("job cards", () => {
  it("are written onto the work order, never as a new one", async () => {
    await RECORD_ADAPTERS["production:batch-records"].create!(
      ctx,
      record({ workOrder: "WO-8", date: "2026-10-02", technician: "Akello", hours: "2" }),
    );
    const sent = writes();
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("PATCH");
    expect(sent[0].path).toBe("/api/v1/work-orders/WO-8");
    expect(sent[0].body).not.toHaveProperty("priority");
    const card = (sent[0].body!.attrs as { job_card: Record<string, unknown> }).job_card;
    expect(card).toMatchObject({ date: "2026-10-02", technician: "Akello", hours: "2" });
    // Unassigned work order: the card's technician takes it.
    expect(sent[0].body!.assignee).toBe("Akello");
  });

  it("keeps the rest of the card when an edit changes one figure", async () => {
    // MES merges attrs one key deep, so job_card is replaced whole on PATCH.
    await RECORD_ADAPTERS["production:batch-records"].update!(
      ctx,
      "WO-7",
      record({ hours: "4" }),
    );
    const card = (writes()[0].body!.attrs as { job_card: Record<string, unknown> }).job_card;
    expect(card).toEqual({ date: "2026-10-01", hours: "4", workDone: "Replaced bearing" });
    expect(writes()[0].body).not.toHaveProperty("assignee");
  });

  it("refuses a second card on a work order that already has one", async () => {
    await expect(
      RECORD_ADAPTERS["production:batch-records"].create!(
        ctx,
        record({ workOrder: "WO-7", technician: "x" }),
      ),
    ).rejects.toThrow(/already has a job card/);
    expect(writes()).toHaveLength(0);
  });

  it("closes the work order through /complete when the card says Completed", async () => {
    await RECORD_ADAPTERS["production:batch-records"].update!(
      ctx,
      "WO-7",
      record({ status: "Completed" }),
    );
    const sent = writes();
    expect(sent.at(-1)!.path).toBe("/api/v1/work-orders/WO-7/complete");
    expect(sent[0].body).not.toHaveProperty("status");
  });

  it("lists only work orders that carry a card", async () => {
    routes["/api/v1/work-orders"] = {
      items: [routes["/api/v1/work-orders/WO-7"], routes["/api/v1/work-orders/WO-8"]],
    };
    const rows = await RECORD_ADAPTERS["production:batch-records"].list(ctx);
    expect(rows.map((r) => r.workOrder)).toEqual(["WO-7"]);
    expect(rows[0].technician).toBe("Okello");
  });
});

/* ─────────────────────────── preventive maintenance ───────────────────────── */

describe("PM templates and schedules", () => {
  it("send interval_days as a number — CreatePMTemplate binds without coercion", async () => {
    await RECORD_ADAPTERS["production:pm-templates"].create!(
      ctx,
      record({ code: "PM-OIL", name: "Oil change", intervalDays: "90", checklist: "Drain\n- Refill\n\n3. Log hours" }),
    );
    const body = writes()[0].body!;
    expect(body.interval_days).toBe(90);
    expect(body.checklist).toEqual(["Drain", "Refill", "Log hours"]);
  });

  it("put a template on a machine by the template's code", async () => {
    await RECORD_ADAPTERS["production:pm-schedules"].create!(
      ctx,
      record({ template: "pm-grease", workCenter: "HUL-1", nextDue: "2026-11-01" }),
    );
    const body = writes()[0].body!;
    expect(body).toEqual({
      template_id: "tpl-1",
      asset_tag: "HUL-1",
      next_due_at: "2026-11-01T06:00:00+03:00",
    });
  });

  it("refuse an unknown template with the ones that exist", async () => {
    await expect(
      RECORD_ADAPTERS["production:pm-schedules"].create!(
        ctx,
        record({ template: "PM-NOPE", workCenter: "HUL-1" }),
      ),
    ).rejects.toThrow(/PM-GREASE/);
    expect(writes()).toHaveLength(0);
  });

  it("no longer write blocks onto the production calendar", () => {
    expect(RECORD_ADAPTERS["production:pm-schedules"].service).toBe("mes");
    expect(RECORD_ADAPTERS["production:production-plans"]).toBeUndefined();
  });
});

/* ───────────────────────────── downtime ───────────────────────────── */

describe("downtime", () => {
  it("sends started_at as RFC3339 on the plant's clock, not a bare date", async () => {
    await RECORD_ADAPTERS["production:downtime-logs"].create!(
      ctx,
      record({
        date: "2026-10-02",
        startTime: "8:30",
        workCenter: "HUL-1",
        reason: "Belt snapped",
        category: "Breakdown",
        reportedBy: "Okello",
        kgLost: "120",
      }),
    );
    const body = writes()[0].body!;
    expect(body.started_at).toBe("2026-10-02T08:30:00+03:00");
    expect(Number.isFinite(Date.parse(String(body.started_at)))).toBe(true);
    expect(body.kg_lost).toBe(120);
  });

  it("sends a stop that is already over with its end, and an ongoing one without", async () => {
    const base = {
      date: "2026-10-02",
      startTime: "08:30",
      workCenter: "HUL-1",
      reason: "Belt snapped",
      category: "Breakdown",
      reportedBy: "Okello",
    };
    await RECORD_ADAPTERS["production:downtime-logs"].create!(ctx, record({ ...base, minutes: "45" }));
    expect(writes()[0].body!.ended_at).toBe("2026-10-02T06:15:00.000Z");

    mockFetch.mockClear();
    await RECORD_ADAPTERS["production:downtime-logs"].create!(ctx, record(base));
    expect(writes()[0].body).not.toHaveProperty("ended_at");
  });

  it("formats the instant the way a Go time.Time binds it", () => {
    const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;
    expect(plantInstant("2026-10-02", "")).toMatch(rfc3339);
    expect(plantInstant("2026-10-02", "23:59")).toMatch(rfc3339);
    expect(plantInstant("", "08:00")).toBeUndefined();
  });

  it("reads an event back on the plant's date and time", async () => {
    routes["/api/v1/downtime-events"] = {
      items: [
        {
          id: "d-1",
          asset_tag: "HUL-1",
          category: "Breakdown",
          started_at: "2026-10-01T22:30:00Z",
          ended_at: "2026-10-01T23:15:00Z",
        },
      ],
    };
    const [row] = await RECORD_ADAPTERS["production:downtime-logs"].list(ctx);
    // 22:30 UTC is 01:30 the next day in Kampala.
    expect(row.date).toBe("2026-10-02");
    expect(row.startTime).toBe("01:30");
    expect(row.minutes).toBe("45");
    expect(row.status).toBe("Closed");
  });
});

/* ───────────────────────────── machines ───────────────────────────── */

describe("machines", () => {
  it("send a status and criticality the columns accept, for every option", async () => {
    const adapter = RECORD_ADAPTERS["production:work-centers"];
    for (const status of ["Idle", "Running", "Down", "PM", "Maintenance", "Retired"]) {
      for (const criticality of ["A — critical", "B — high", "C — medium", "D — low"]) {
        mockFetch.mockClear();
        await adapter.create!(
          ctx,
          record({ name: "Huller", code: "HUL-2", section: "MILL", status, criticality }),
        );
        const body = writes()[0].body!;
        expect(ASSET_STATUSES, status).toContain(body.status);
        expect(ASSET_CRITICALITIES, criticality).toContain(body.criticality);
      }
    }
  });

  it("file a machine under the section named, not the first one MES returns", async () => {
    await RECORD_ADAPTERS["production:work-centers"].create!(
      ctx,
      record({ name: "Roaster", code: "RST-1", section: "Roastery", status: "Idle" }),
    );
    expect(writes()[0].body!.section_id).toBe("sec-2");
  });

  it("refuse an unknown section with the sections that exist", async () => {
    await expect(
      RECORD_ADAPTERS["production:work-centers"].create!(
        ctx,
        record({ name: "Roaster", code: "RST-1", section: "Wet mill", status: "Idle" }),
      ),
    ).rejects.toThrow(/MILL — Dry mill; ROAST — Roastery/);
    expect(writes()).toHaveLength(0);
  });

  it("keep the responsible technician when only the notes are edited", async () => {
    await RECORD_ADAPTERS["production:work-centers"].update!(
      ctx,
      "HUL-1",
      record({ notes: "new note" }),
    );
    expect(writes()[0].body!.attrs).toEqual({ supervisor: "Okello", notes: "new note" });
  });

  it("do not touch attrs at all when the edit is only a status", async () => {
    await RECORD_ADAPTERS["production:work-centers"].update!(
      ctx,
      "HUL-1",
      record({ status: "Retired" }),
    );
    expect(writes()[0].body).toEqual({ status: "retired" });
  });

  it("accept an edit that sends back the stored criticality and section unchanged", async () => {
    // The edit form sends every field; refusing any criticality blocked every
    // edit of every machine (found by the live CRUD run).
    routes["/api/v1/assets/HUL-1"] = { tag: "HUL-1", criticality: "C", section_code: "hulling", attrs: { supervisor: "Okello" } };
    await RECORD_ADAPTERS["production:work-centers"].update!(
      ctx,
      "HUL-1",
      record({ criticality: "C — medium", section: "hulling", notes: "new note" }),
    );
    expect(writes()[0].body!.attrs).toEqual({ supervisor: "Okello", notes: "new note" });
  });

  it("say plainly that criticality cannot be edited, instead of dropping it", async () => {
    await expect(
      RECORD_ADAPTERS["production:work-centers"].update!(
        ctx,
        "HUL-1",
        record({ criticality: "A — critical" }),
      ),
    ).rejects.toThrow(/Criticality/);
  });
});

/* ───────────────────────────── spare parts ───────────────────────────── */

describe("spare parts", () => {
  it("no longer write production BOMs", () => {
    expect(RECORD_ADAPTERS["production:bill-of-materials"]).toBeUndefined();
  });
});
