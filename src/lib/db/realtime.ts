/**
 * Realtime fan-out for multi-tab / multi-instance sync.
 * Kafka (optional) for external consumers; Redis pub/sub + in-process bus
 * power browser SSE at /api/realtime.
 */

import { EventEmitter } from "node:events";
import type Redis from "ioredis";
import { getRedis, isRedisConfigured, redisKey } from "@/lib/db/redis";
import { isKafkaConfigured, publishKafkaRealtime } from "@/lib/db/kafka";

export const REALTIME_REDIS_CHANNEL = "realtime";

export type RealtimeEventType =
  | "records.updated"
  | "ledger.updated"
  | "settings.updated"
  | "auth.updated"
  | "activity.logged"
  | "ping";

export type RealtimeEvent = {
  type: RealtimeEventType;
  module?: string;
  entity?: string;
  revision?: string;
  key?: string;
  action?: string;
  label?: string;
  actor?: string;
  details?: string;
  at: string;
};

type RealtimeBus = EventEmitter & {
  listenerCount(event: "message"): number;
};

const globalForRealtime = globalThis as unknown as {
  financeiagRealtimeBus?: RealtimeBus;
};

function getBus(): RealtimeBus {
  if (!globalForRealtime.financeiagRealtimeBus) {
    globalForRealtime.financeiagRealtimeBus = new EventEmitter() as RealtimeBus;
    globalForRealtime.financeiagRealtimeBus.setMaxListeners(100);
  }
  return globalForRealtime.financeiagRealtimeBus;
}

export function isRealtimeConfigured(): boolean {
  return isRedisConfigured() || isKafkaConfigured();
}

/** Publish to in-process listeners, Redis (browser SSE), and Kafka when set. */
export async function publishRealtime(
  event: Omit<RealtimeEvent, "at"> & { at?: string },
): Promise<void> {
  const payload: RealtimeEvent = {
    ...event,
    at: event.at ?? new Date().toISOString(),
  };

  getBus().emit("message", payload);

  const client = getRedis();
  if (client) {
    try {
      const status = client.status;
      if (status === "wait" || status === "end") {
        await client.connect();
      }
      await client.publish(redisKey(REALTIME_REDIS_CHANNEL), JSON.stringify(payload));
    } catch (error) {
      console.error(
        "[realtime] redis publish failed",
        error instanceof Error ? error.message : error,
      );
    }
  }

  void publishKafkaRealtime(payload).catch((error) => {
    console.error(
      "[realtime] kafka publish failed",
      error instanceof Error ? error.message : error,
    );
  });
}

export function subscribeLocalRealtime(
  handler: (event: RealtimeEvent) => void,
): () => void {
  const bus = getBus();
  bus.on("message", handler);
  return () => bus.off("message", handler);
}

/** Dedicated Redis subscriber for SSE (cannot share command connection). */
export async function createRealtimeRedisSubscriber(
  handler: (event: RealtimeEvent) => void,
): Promise<{ close: () => Promise<void> } | null> {
  const base = getRedis();
  if (!base) return null;

  let sub: Redis | null = null;
  try {
    if (base.status === "wait" || base.status === "end") {
      await base.connect();
    }
    sub = base.duplicate();
    sub.on("error", (err) => {
      console.error("[realtime] redis subscriber", err.message);
    });
    if (sub.status === "wait" || sub.status === "end") {
      await sub.connect();
    }
    await sub.subscribe(redisKey(REALTIME_REDIS_CHANNEL));
    sub.on("message", (_channel, raw) => {
      try {
        handler(JSON.parse(raw) as RealtimeEvent);
      } catch {
        /* ignore malformed */
      }
    });
  } catch (error) {
    console.error(
      "[realtime] redis subscribe failed",
      error instanceof Error ? error.message : error,
    );
    try {
      await sub?.quit();
    } catch {
      /* ignore */
    }
    return null;
  }

  return {
    async close() {
      try {
        await sub?.unsubscribe(redisKey(REALTIME_REDIS_CHANNEL));
        await sub?.quit();
      } catch {
        /* ignore */
      }
    },
  };
}
