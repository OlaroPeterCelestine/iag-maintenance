/**
 * In-app toast + OS popup notifications for request / approval activity.
 * Safe to call from browser only; no-ops on the server.
 */
import { appToastInfo, appToastSuccess, appToastWarning } from "@/lib/app-toast";

/** Entities that should always surface a visible popup on create/advance. */
export const REQUEST_POPUP_ENTITIES = new Set([
  "payment-requests",
  "oral-payment-requests",
  "general-requests",
  "requisitions",
  "fuel-requests",
  "trip-requests",
  "maintenance-requests",
  "equipment-and-vehicle-requests",
  "document-requests",
  "leave-requests",
]);

export type RequestPopupTone = "info" | "success" | "warning";

/** Suppress echo toasts after the local actor already showed feedback. */
let suppressPopupsUntil = 0;

export function suppressRequestPopups(ms = 3200): void {
  suppressPopupsUntil = Math.max(suppressPopupsUntil, Date.now() + ms);
}

export function requestPopupsSuppressed(): boolean {
  return Date.now() < suppressPopupsUntil;
}

export type RequestPopupInput = {
  title: string;
  description?: string;
  tone?: RequestPopupTone;
  /** Prefer longer visible toasts for time-sensitive approvals. */
  timeoutMs?: number;
  /** Dedup / replace tag for OS notifications. */
  tag?: string;
  /** Deep-link when the OS notification is clicked. */
  url?: string;
  /**
   * When true, also show a browser/OS Notification if permission is granted
   * and the document is hidden (or permission was already granted for push).
   * Default true.
   */
  osWhenHidden?: boolean;
  /** Force OS notification even while the tab is focused. */
  osAlways?: boolean;
};

export function isRequestPopupEntity(entityKey: string | undefined | null): boolean {
  return Boolean(entityKey && REQUEST_POPUP_ENTITIES.has(entityKey));
}

export function requestPopupTitleForEvent(
  event: "created" | "submitted" | "advanced" | "rejected" | "amended" | "paid" | "commented" | string,
): string {
  switch (event) {
    case "created":
      return "Request created";
    case "submitted":
      return "Request submitted";
    case "advanced":
      return "Request advanced";
    case "rejected":
      return "Request rejected";
    case "amended":
      return "Request returned for amendment";
    case "paid":
      return "Request completed";
    case "commented":
      return "Request comment";
    default:
      return "Request update";
  }
}

function showOsNotification(input: RequestPopupInput) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const body = (input.description || "").trim();
  const tag = input.tag || "iag-request";
  try {
    // Prefer SW so click routing matches Web Push.
    void navigator.serviceWorker?.ready
      .then((reg) =>
        reg.showNotification(input.title, {
          body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag,
          data: { url: input.url || "/" },
        } as NotificationOptions),
      )
      .catch(() => {
        new Notification(input.title, { body, tag, icon: "/icon-192.png" });
      });
  } catch {
    try {
      new Notification(input.title, { body, tag, icon: "/icon-192.png" });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Always pops an in-app toast; optionally adds an OS notification.
 */
export function popupRequestNotification(input: RequestPopupInput): void {
  if (typeof window === "undefined") return;
  if (requestPopupsSuppressed()) return;

  const tone = input.tone || "info";
  const timeout = input.timeoutMs ?? (tone === "warning" ? 5500 : 5000);
  const description = input.description || undefined;

  if (tone === "success") appToastSuccess(input.title, description, timeout);
  else if (tone === "warning") appToastWarning(input.title, description, timeout);
  else appToastInfo(input.title, description, timeout);

  const hidden =
    typeof document !== "undefined" && document.visibilityState === "hidden";
  const wantOs =
    input.osAlways === true || ((input.osWhenHidden ?? true) && hidden);
  if (wantOs) showOsNotification(input);
}

/** Build a short human line for approval realtime payloads. */
export function formatApprovalPopupCopy(data: {
  action?: string;
  label?: string;
  entity?: string;
  details?: string;
}): { title: string; description: string } {
  const title = (data.action || "Approval update").trim() || "Approval update";
  const description =
    (data.details || "").trim() ||
    `${data.label || data.entity || "Request"} updated`;
  return { title, description };
}
