import {
  VERCEL_SSE_CLOSE_AFTER_MS,
  isVercelRuntime,
} from "@/lib/deploy-topology";
import {
  createRealtimeRedisSubscriber,
  subscribeLocalRealtime,
  type RealtimeEvent,
} from "@/lib/db/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "fra1";
/** Pro/Team cap is 300s. Must be a numeric literal for Next segment config. */
export const maxDuration = 300;

/**
 * Server-Sent Events stream for live record / ledger / settings updates.
 * Backed by Redis pub/sub when REDIS_URL is set; otherwise same-process bus only.
 */
export async function GET() {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closer: ReturnType<typeof setTimeout> | undefined;
  let unsubLocal: (() => void) | undefined;
  let redisSub: { close: () => Promise<void> } | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RealtimeEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const shutdown = () => {
        if (closed) return;
        send({ type: "ping", at: new Date().toISOString() });
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (closer) clearTimeout(closer);
        unsubLocal?.();
        void redisSub?.close();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      send({ type: "ping", at: new Date().toISOString() });

      unsubLocal = subscribeLocalRealtime(send);
      redisSub = await createRealtimeRedisSubscriber(send);

      heartbeat = setInterval(() => {
        send({ type: "ping", at: new Date().toISOString() });
      }, 25_000);

      if (typeof heartbeat.unref === "function") heartbeat.unref();

      // Vercel kills the invocation at maxDuration; close first so EventSource reconnects cleanly.
      if (isVercelRuntime()) {
        closer = setTimeout(shutdown, VERCEL_SSE_CLOSE_AFTER_MS);
        if (typeof closer.unref === "function") closer.unref();
      }
    },
    async cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (closer) clearTimeout(closer);
      unsubLocal?.();
      await redisSub?.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
