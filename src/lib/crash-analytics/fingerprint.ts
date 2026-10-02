import type { CrashEventInput } from "./types";

/** Collapse volatile tokens so the same bug groups together. */
export function crashFingerprint(input: {
  message: string;
  name?: string;
  stack?: string;
  source?: string;
}): string {
  const name = (input.name || "Error").trim();
  const message = normalizeMessage(input.message || "Unknown error");
  const frames = topFrames(input.stack || "", 3);
  const raw = [input.source || "unknown", name, message, ...frames].join("|");
  return hash(raw);
}

export function crashTitle(input: {
  message: string;
  name?: string;
}): string {
  const name = (input.name || "Error").trim();
  const message = (input.message || "Unknown error").trim().slice(0, 160);
  if (!message) return name;
  if (message.startsWith(name)) return message;
  return `${name}: ${message}`;
}

function normalizeMessage(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.Z+-]+\b/g, "<ts>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<ptr>")
    .replace(/:\d+:\d+/g, ":<loc>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240)
    .toLowerCase();
}

function topFrames(stack: string, limit: number): string[] {
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(Error|AggregateError|TypeError|ReferenceError)\b/.test(line))
    .map((line) =>
      line
        .replace(/https?:\/\/[^)\s]+/g, "<url>")
        .replace(/:\d+:\d+/g, ":<loc>")
        .replace(/\d+/g, "<n>")
        .slice(0, 160),
    )
    .slice(0, limit);
}

function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `c${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export function normalizeCrashInput(body: CrashEventInput): CrashEventInput | null {
  const message = String(body.message || "").trim();
  if (!message) return null;
  return {
    message: message.slice(0, 2000),
    name: String(body.name || "Error").trim().slice(0, 120) || "Error",
    stack: String(body.stack || "").trim().slice(0, 12_000) || undefined,
    severity: body.severity === "fatal" || body.severity === "warning" ? body.severity : "error",
    source: body.source || "manual",
    url: String(body.url || "").trim().slice(0, 1000) || undefined,
    route: String(body.route || "").trim().slice(0, 300) || undefined,
    userAgent: String(body.userAgent || "").trim().slice(0, 500) || undefined,
    release: String(body.release || "").trim().slice(0, 80) || undefined,
    userId: String(body.userId || "").trim().slice(0, 120) || undefined,
    username: String(body.username || "").trim().slice(0, 120) || undefined,
    role: String(body.role || "").trim().slice(0, 80) || undefined,
    ip: String(body.ip || "").trim().slice(0, 128) || undefined,
    componentStack: String(body.componentStack || "").trim().slice(0, 8000) || undefined,
    context: sanitizeContext(body.context),
    occurredAt: String(body.occurredAt || "").trim() || undefined,
  };
}

function sanitizeContext(
  context: CrashEventInput["context"],
): Record<string, string | number | boolean | null> | undefined {
  if (!context || typeof context !== "object") return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context).slice(0, 24)) {
    const k = key.trim().slice(0, 64);
    if (!k) continue;
    if (value == null || typeof value === "boolean" || typeof value === "number") {
      out[k] = value as string | number | boolean | null;
    } else {
      out[k] = String(value).slice(0, 500);
    }
  }
  return Object.keys(out).length ? out : undefined;
}
