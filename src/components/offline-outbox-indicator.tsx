"use client";

/**
 * Saves kept on this device until the connection returns (offline-outbox.ts),
 * shown where they cannot be missed: how many are waiting, a Send now, and any
 * the server refused, with its reason and a Discard once it has been re-entered.
 */
import { useEffect, useState } from "react";
import { CloudOff, X } from "lucide-react";
import {
  OUTBOX_EVENT,
  discard,
  flushOutbox,
  installOutbox,
  outboxItems,
  type OutboxItem,
} from "@/lib/offline-outbox";

export function OfflineOutboxIndicator() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    installOutbox();
    const sync = () => setItems(outboxItems());
    sync();
    window.addEventListener(OUTBOX_EVENT, sync);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener(OUTBOX_EVENT, sync);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!items.length) return null;
  const waiting = items.filter((i) => !i.error);
  const failed = items.filter((i) => i.error);

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-sm" data-print-hide>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          failed.length
            ? "flex items-center gap-2 rounded-full border border-rose-300 bg-rose-50 px-3 py-1.5 text-[12px] font-medium text-rose-800 shadow dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
            : "flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-900 shadow dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        }
        aria-expanded={open}
      >
        <CloudOff size={14} aria-hidden />
        {waiting.length ? `${waiting.length} waiting to send` : ""}
        {waiting.length && failed.length ? " · " : ""}
        {failed.length ? `${failed.length} refused` : ""}
      </button>
      {open ? (
        <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-[12px] shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <p className="mb-2 text-slate-600 dark:text-slate-300">
            Saved on this device. They are sent, oldest first, when the connection returns.
          </p>
          <ul className="max-h-60 space-y-1.5 overflow-auto">
            {items.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-2">
                <span>
                  <span className="text-slate-900 dark:text-slate-50">{i.label}</span>
                  <span className="block text-slate-500">{new Date(i.queuedAt).toLocaleString("en-GB")}</span>
                  {i.error ? <span className="block text-rose-700 dark:text-rose-300">Refused: {i.error}</span> : null}
                </span>
                {i.error ? (
                  <button
                    type="button"
                    onClick={() => discard(i.id)}
                    className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    aria-label={`Discard ${i.label}`}
                    title="Discard — re-enter it with the reason fixed"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {waiting.length ? (
            <button
              type="button"
              disabled={sending}
              onClick={async () => {
                setSending(true);
                await flushOutbox();
                setSending(false);
              }}
              className="mt-2 w-full rounded-md bg-black py-1.5 font-medium text-white disabled:opacity-40"
            >
              {sending ? "Sending…" : "Send now"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
