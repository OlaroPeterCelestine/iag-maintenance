/**
 * Custom Node server: Next.js + WebSocket realtime at /api/ws.
 * SSE at /api/realtime remains as a fallback for clients that cannot upgrade.
 */

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { createServer } from "node:http";
import next from "next";
import { WebSocketServer, type WebSocket } from "ws";
import {
  createRealtimeRedisSubscriber,
  subscribeLocalRealtime,
  type RealtimeEvent,
} from "./src/lib/db/realtime";
import { API_TOKEN_COOKIE, isAuthRequired, verifyApiToken } from "./src/lib/server-jwt";

const dev = process.env.NODE_ENV !== "production";
// Always bind all interfaces — Railway sets HOSTNAME to the container id.
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3140);

type SocketClient = WebSocket & { isAlive?: boolean };

function parseRequestUrl(raw: string | undefined) {
  const href = raw && raw.length ? raw : "/";
  const u = new URL(href, "http://127.0.0.1");
  const query: Record<string, string> = {};
  u.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return {
    pathname: u.pathname,
    query,
    search: u.search,
    href: `${u.pathname}${u.search}`,
    path: `${u.pathname}${u.search}`,
  };
}

function cookieValue(header: string | undefined, name: string): string {
  if (!header) return "";
  const parts = header.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("=") || "");
  }
  return "";
}

async function allowUpgrade(req: import("node:http").IncomingMessage): Promise<boolean> {
  if (!isAuthRequired()) return true;
  const auth = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  const bearer = match?.[1]?.trim() || "";
  const cookie = cookieValue(req.headers.cookie, API_TOKEN_COOKIE);
  // Prefer cookie (refreshed on login) over a possibly stale tab Bearer.
  // Never accept JWT from the query string (leaks to logs/proxies).
  const candidates = [cookie, bearer].filter(Boolean);
  for (const token of candidates) {
    if (await verifyApiToken(token)) return true;
  }
  return false;
}

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  // Required in custom servers — otherwise /_next/webpack-hmr is destroyed and
  // the client never finishes hydrating (forms look interactive but never submit).
  const handleUpgrade = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<SocketClient>();

  function broadcast(event: RealtimeEvent) {
    const raw = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        try {
          client.send(raw);
        } catch {
          /* drop broken socket */
        }
      }
    }
  }

  subscribeLocalRealtime(broadcast);
  void createRealtimeRedisSubscriber(broadcast).then((sub) => {
    if (sub) console.log("[ws] redis realtime subscriber ready");
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parseRequestUrl(req.url);
    if (pathname === "/api/ws") {
      void (async () => {
        try {
          if (!(await allowUpgrade(req))) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        } catch {
          socket.destroy();
        }
      })();
      return;
    }
    void handleUpgrade(req, socket, head);
  });

  wss.on("connection", (ws: SocketClient) => {
    ws.isAlive = true;
    clients.add(ws);
    ws.send(
      JSON.stringify({
        type: "ping",
        at: new Date().toISOString(),
        transport: "websocket",
      }),
    );
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string };
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "ping", at: new Date().toISOString() }));
        }
      } catch {
        /* ignore */
      }
    });
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.isAlive === false) {
        clients.delete(client);
        client.terminate();
        continue;
      }
      client.isAlive = false;
      try {
        client.ping();
      } catch {
        clients.delete(client);
      }
    }
  }, 25_000);
  heartbeat.unref?.();

  server.listen(port, hostname, () => {
    console.log(
      `[server] ready on http://${hostname}:${port} (ws /api/ws, sse /api/realtime)`,
    );
  });
}

main().catch((err) => {
  console.error("[server] failed to start", err);
  process.exit(1);
});
