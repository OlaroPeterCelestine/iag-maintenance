"use client";

import { Button } from "@/components/ui/button";
import {
  buildNotifications,
  loadSeenIds,
  markAllSeen,
  NOTIFICATIONS_SEEN_EVENT,
  relativeTime,
  type AppNotification,
} from "@/lib/notifications";
import { SERVER_ACTIVITY_EVENT } from "@/lib/realtime-notifications";
import { runPushSelfTest } from "@/lib/pwa";
import { appToastError, appToastSuccess, appToastWarning } from "@/lib/app-toast";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Package,
  Receipt,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

function iconFor(kind: AppNotification["kind"]) {
  if (kind === "low-stock") return Package;
  if (kind === "activity") return Receipt;
  return AlertTriangle;
}

function iconTone(kind: AppNotification["kind"]) {
  if (kind === "overdue-receivable") return "bg-rose-50 text-rose-500";
  if (kind === "overdue-payable") return "bg-amber-50 text-amber-600";
  if (kind === "low-stock") return "bg-orange-50 text-orange-500";
  return "bg-sky-50 text-sky-600";
}

export function NotificationsMenu() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [pushTesting, setPushTesting] = useState(false);

  const refresh = useCallback(() => {
    try {
      setItems(buildNotifications());
      setSeen(loadSeenIds());
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onData = () => refresh();
    window.addEventListener("financeiag-records-changed", onData);
    window.addEventListener("financeiag-ledger-changed", onData);
    window.addEventListener(NOTIFICATIONS_SEEN_EVENT, onData);
    window.addEventListener("financeiag-realtime-feed-changed", onData);
    window.addEventListener(SERVER_ACTIVITY_EVENT, onData);
    return () => {
      window.removeEventListener("financeiag-records-changed", onData);
      window.removeEventListener("financeiag-ledger-changed", onData);
      window.removeEventListener(NOTIFICATIONS_SEEN_EVENT, onData);
      window.removeEventListener("financeiag-realtime-feed-changed", onData);
      window.removeEventListener(SERVER_ACTIVITY_EVENT, onData);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    refresh();
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, refresh]);

  const unread = items.filter((n) => !seen.has(n.id)).length;

  function handleMarkAll() {
    markAllSeen(items);
    setSeen(loadSeenIds());
  }

  function handleOpen(notification: AppNotification) {
    markAllSeen([notification]);
    setSeen(loadSeenIds());
    if (notification.href) {
      setOpen(false);
      router.push(notification.href);
    }
  }

  async function handlePushTest() {
    if (pushTesting) return;
    setPushTesting(true);
    try {
      const result = await runPushSelfTest();
      if (result.ok) {
        appToastSuccess(
          "Push test sent",
          "You should see a local banner, then a server push. On iPhone, lock the screen — the second one should still appear.",
          6500,
        );
      } else {
        appToastWarning("Push test failed", result.error || result.steps.join(" · "), 7000);
      }
    } catch (e) {
      appToastError(
        "Push test failed",
        e instanceof Error ? e.message : "Unexpected error",
      );
    } finally {
      setPushTesting(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Notifications"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="relative inline-flex">
          <Bell size={16} />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      </Button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-1.5 w-[300px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold text-slate-900">Notifications</p>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-600">
                {items.length}
              </span>
            </div>
            {items.length > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-700"
                title="Mark all read"
              >
                <CheckCheck size={12} />
              </button>
            )}
          </div>

          <div className="max-h-[320px] overflow-y-auto p-1.5">
            {items.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <Bell size={18} className="mx-auto mb-1.5 text-slate-300" />
                <p className="text-[11px] text-slate-400">You&apos;re all caught up.</p>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {items.map((notification) => {
                  const isUnread = !seen.has(notification.id);
                  const Icon = iconFor(notification.kind);
                  return (
                    <li key={notification.id}>
                      <button
                        type="button"
                        onClick={() => handleOpen(notification)}
                        className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition ${
                          isUnread ? "bg-slate-50/80" : "hover:bg-slate-50"
                        }`}
                      >
                        <span
                          className={`mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${iconTone(
                            notification.kind,
                          )}`}
                        >
                          <Icon size={14} strokeWidth={2} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-[12px] ${
                              isUnread
                                ? "font-semibold text-slate-900"
                                : "font-medium text-slate-700"
                            }`}
                          >
                            {notification.title}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                            {notification.description}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-slate-400">
                            {relativeTime(notification.date)}
                            {notification.href ? " · Open" : ""}
                          </span>
                        </span>
                        {isUnread && (
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-orange-500" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-slate-100 px-3 py-2">
            <button
              type="button"
              disabled={pushTesting}
              onClick={() => void handlePushTest()}
              className="text-[11px] font-medium text-sky-600 hover:text-sky-700 disabled:opacity-50"
            >
              {pushTesting ? "Testing push…" : "Test phone notification"}
            </button>
            {unread > 0 ? (
              <button
                type="button"
                onClick={handleMarkAll}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-700"
              >
                Mark all as read
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[11px] font-medium text-slate-400 hover:text-slate-600"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
