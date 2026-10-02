"use client";

import { readAuthSession } from "@/lib/auth";
import { FRONTEND_ONLY } from "@/lib/frontend-only";
import { getCurrentSessionUser } from "@/lib/session-profile";
import { TOOL_SLUG } from "@/lib/tool-identity";

export type ToolsAuditInput = {
  action: string;
  module?: string;
  entity?: string;
  recordId?: string;
  recordLabel?: string;
  details?: string;
  path?: string;
  page?: string;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

/** POST one shared audit event (all users) via the Next proxy. */
export function postToolsAuditEvent(input: ToolsAuditInput): void {
  if (!FRONTEND_ONLY || typeof window === "undefined") return;

  const user = getCurrentSessionUser();
  const session = readAuthSession();
  const path =
    input.path ||
    `${window.location.pathname}${window.location.search}` ||
    "/";
  const payload = {
    action: input.action,
    module: input.module || "",
    entity: input.entity || "",
    recordId: input.recordId || "",
    recordLabel: input.recordLabel || "",
    details: (input.details || "").slice(0, 1000),
    userId: user.id,
    userName: user.name,
    username: user.username,
    email: user.email,
    meta: {
      tool: TOOL_SLUG,
      path,
      page: input.page || "",
      href: window.location.href.slice(0, 500),
      ...(session?.sessionId ? { sessionId: session.sessionId } : {}),
      ...(input.meta || {}),
    },
  };

  void fetch("/api/tools-activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => null);
}
