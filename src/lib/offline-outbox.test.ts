/**
 * The offline outbox: what is queued, in what order it is sent, and what
 * happens to a save the server refuses. Node has no localStorage or window,
 * so the test supplies small stand-ins.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal("window", { dispatchEvent: () => true, addEventListener: () => {}, setInterval: () => 0 });
vi.stubGlobal("CustomEvent", class { constructor(public type: string) {} });
const nav = { onLine: true };
vi.stubGlobal("navigator", nav);

vi.mock("@/lib/api-auth", () => ({ apiFetch: vi.fn() }));
const { apiFetch } = await import("@/lib/api-auth");
const mockFetch = vi.mocked(apiFetch);
const outbox = await import("@/lib/offline-outbox");

const res = (status: number, body: unknown = {}) =>
  ({ ok: status < 300, status, json: async () => body }) as unknown as Response;

beforeEach(() => {
  store.clear();
  mockFetch.mockReset();
  nav.onLine = true;
});

describe("what can wait", () => {
  it("is the floor's saves, never a delete", () => {
    expect(outbox.canQueueOffline("production", "fault-reports", "POST")).toBe(true);
    expect(outbox.canQueueOffline("production", "batch-records", "PATCH")).toBe(true);
    expect(outbox.canQueueOffline("production", "fault-reports", "DELETE")).toBe(false);
    expect(outbox.canQueueOffline("production", "work-orders", "POST")).toBe(false);
  });

  it("is a save that never reached the server — not a timeout, not a bug", () => {
    expect(outbox.neverReachedServer(new TypeError("Failed to fetch"))).toBe(true);
    expect(outbox.neverReachedServer(new TypeError("Load failed"))).toBe(true);
    expect(outbox.neverReachedServer(new Error("Request timed out after 60000 ms"))).toBe(false);
    expect(outbox.neverReachedServer(new TypeError("Cannot read properties of undefined"))).toBe(false);
    nav.onLine = false;
    expect(outbox.neverReachedServer(new Error("anything"))).toBe(true);
  });
});

describe("sending", () => {
  it("sends oldest first and stops, keeping order, while there is still no way through", async () => {
    outbox.enqueue({ module: "production", entity: "fault-reports", method: "POST", payload: { workCenter: "H1", title: "Noise" } });
    outbox.enqueue({ module: "production", entity: "meter-readings", method: "POST", payload: { workCenter: "H1", hours: "1250" } });
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    let r = await outbox.flushOutbox();
    expect(r).toEqual({ sent: 0, failed: 0, waiting: 2 });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockResolvedValue(res(201));
    r = await outbox.flushOutbox();
    expect(r).toEqual({ sent: 2, failed: 0, waiting: 0 });
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
      "/api/records/production/fault-reports",
      "/api/records/production/fault-reports",
      "/api/records/production/meter-readings",
    ]);
  });

  it("keeps a refused save with its reason and carries on with the rest", async () => {
    outbox.enqueue({ module: "production", entity: "meter-readings", method: "POST", payload: { workCenter: "H1", hours: "900" } });
    outbox.enqueue({ module: "production", entity: "fault-reports", method: "POST", payload: { workCenter: "H1", title: "Leak" } });
    mockFetch.mockResolvedValueOnce(res(400, { error: "900 h is below the last reading" })).mockResolvedValueOnce(res(201));
    const r = await outbox.flushOutbox();
    expect(r).toEqual({ sent: 1, failed: 1, waiting: 0 });
    const [kept] = outbox.outboxItems();
    expect(kept.label).toBe("900 h on H1");
    expect(kept.error).toMatch(/below the last reading/);
    // A refused save is not retried on its own; the person re-enters it.
    await outbox.flushOutbox();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    outbox.discard(kept.id);
    expect(outbox.outboxItems()).toEqual([]);
  });

  it("waits on a server error or an expired session rather than marking it refused", async () => {
    outbox.enqueue({ module: "production", entity: "batch-records", method: "PATCH", recordId: "WO-5", payload: { hours: "2" } });
    mockFetch.mockResolvedValueOnce(res(503));
    expect(await outbox.flushOutbox()).toEqual({ sent: 0, failed: 0, waiting: 1 });
    mockFetch.mockResolvedValueOnce(res(401));
    expect(await outbox.flushOutbox()).toEqual({ sent: 0, failed: 0, waiting: 1 });
    expect(mockFetch.mock.calls[0][0]).toBe("/api/records/production/batch-records/WO-5");
  });

  it("does not try while the device says it is offline", async () => {
    outbox.enqueue({ module: "production", entity: "fault-reports", method: "POST", payload: {} });
    nav.onLine = false;
    await outbox.flushOutbox();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
