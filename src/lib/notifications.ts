import {
  getLiveActivity,
  getLiveDocuments,
  loadEntityRecords,
} from "@/lib/ledger/live-data";
import { formatMoney } from "@/lib/ledger/money";
import { parseAmount } from "@/lib/ledger/types";
import { getAppPref, setAppPref } from "@/lib/db/app-prefs";
import { realtimeFeedAsNotifications } from "@/lib/realtime-notifications";
import { canAccessPath } from "@/lib/access-control";

export type NotificationKind =
  | "overdue-receivable"
  | "overdue-payable"
  | "low-stock"
  | "activity";

export type AppNotification = {
  id: string;
  title: string;
  description: string;
  href?: string;
  /** ISO date used for sorting + relative time. */
  date: string;
  kind: NotificationKind;
  /** Tailwind classes for the leading dot. */
  tone: string;
};

const SEEN_KEY = "financeiag-notifications-seen";
export const NOTIFICATIONS_SEEN_EVENT = "financeiag-notifications-seen-changed";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isSettled(status: string): boolean {
  return /paid|complete|cleared|void|voided|cancel/i.test(status);
}

function buildOverdue(): AppNotification[] {
  const now = today();
  const docs = getLiveDocuments();
  const out: AppNotification[] = [];
  for (const doc of docs) {
    if (isSettled(doc.status)) continue;
    const overdueByStatus = /overdue/i.test(doc.status);
    const overdueByDate = Boolean(doc.due) && doc.due < now;
    if (!overdueByStatus && !overdueByDate) continue;
    const receivable = doc.category === "Sales";
    out.push({
      id: `overdue-${doc.category}-${doc.id}`,
      title: receivable ? "Invoice overdue" : "Bill overdue",
      description: `${doc.reference} · ${doc.party} · ${formatMoney(doc.amount)}${
        doc.due ? ` · due ${doc.due}` : ""
      }`,
      href: doc.href,
      date: doc.due || doc.date || now,
      kind: receivable ? "overdue-receivable" : "overdue-payable",
      tone: receivable ? "bg-rose-500" : "bg-amber-500",
    });
  }
  return out;
}

function buildLowStock(): AppNotification[] {
  const items = loadEntityRecords("inventory", "inventory-items");
  const out: AppNotification[] = [];
  for (const item of items) {
    const reorder = parseAmount(item.reorderLevel);
    if (reorder <= 0) continue;
    const onHand = parseAmount(item.quantity || item.balance);
    if (onHand > reorder) continue;
    out.push({
      id: `low-stock-${item.id}`,
      title: "Low stock",
      description: `${item.name || item.code || "Item"} — ${onHand} on hand (reorder at ${reorder})`,
      href: "/inventory?view=inventory-items",
      date: today(),
      kind: "low-stock",
      tone: "bg-orange-500",
    });
  }
  return out;
}

function buildActivity(): AppNotification[] {
  return getLiveActivity(6).map((activity) => ({
    id: `activity-${activity.id}`,
    title: activity.title,
    description: `${activity.copy} · ${activity.amount}`,
    href: activity.href,
    date: activity.date || today(),
    kind: "activity" as const,
    tone:
      activity.positive === true
        ? "bg-emerald-500"
        : activity.positive === false
          ? "bg-rose-500"
          : "bg-sky-500",
  }));
}

/** Build the current notification feed, newest first. */
export function buildNotifications(): AppNotification[] {
  if (typeof window === "undefined") return [];
  const all = [
    ...realtimeFeedAsNotifications(),
    ...buildOverdue(),
    ...buildLowStock(),
    ...buildActivity(),
  ];
  const seen = new Set<string>();
  const unique = all.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    // Notifications summarise records, so drop any pointing at a denied page.
    if (n.href && !canAccessPath(n.href)) return false;
    return true;
  });
  return unique.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
}

export function loadSeenIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = getAppPref<string[] | null>(SEEN_KEY, null);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function unreadCount(notifications: AppNotification[]): number {
  const seen = loadSeenIds();
  return notifications.filter((n) => !seen.has(n.id)).length;
}

/** Mark the given notifications as read (merged with previously seen, capped). */
export function markAllSeen(notifications: AppNotification[]) {
  if (typeof window === "undefined") return;
  const seen = loadSeenIds();
  for (const n of notifications) seen.add(n.id);
  const capped = Array.from(seen).slice(-300);
  setAppPref(SEEN_KEY, capped);
  window.dispatchEvent(new CustomEvent(NOTIFICATIONS_SEEN_EVENT));
}

export function relativeTime(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const day = 86_400_000;
  if (diff < 0) return "upcoming";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < day) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return iso.slice(0, 10);
}
