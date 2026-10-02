"use client";

import { useAppShell } from "@/components/app-shell";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { SegmentTabList, segmentTabClass } from "@/components/segment-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { appToastError, appToastSuccess } from "@/lib/app-toast";
import { canAccessSpecialNav } from "@/lib/access-control";
import {
  authorName,
  calendarCells,
  emptyCommDraft,
  hydrateCommMessages,
  isValidEmail,
  isValidPhone,
  loadCommMessages,
  saveCommMessages,
  sendCommEmail,
  sendCommSms,
  splitRecipients,
  type CommChannel,
  type CommMessage,
  type CommStatus,
} from "@/lib/comms";
import { cn } from "@/lib/utils";
import {
  ArrowLeft2,
  ArrowRight2,
  Calendar as CalendarIcon,
  HambergerMenu,
  MessageText1,
  Sms,
  Trash,
} from "iconsax-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Tab = "calendar" | "inbox" | "email" | "sms";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function statusTone(status: CommStatus) {
  switch (status) {
    case "sent":
      return "bg-emerald-50 text-emerald-700";
    case "failed":
      return "bg-rose-50 text-rose-700";
    case "scheduled":
    case "queued":
      return "bg-amber-50 text-amber-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function channelLabel(channel: CommChannel) {
  if (channel === "email") return "Email";
  if (channel === "sms") return "SMS";
  return "Internal";
}

export function CommsPanel() {
  const { openSidebar } = useAppShell();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("calendar");
  const [messages, setMessages] = useState<CommMessage[]>([]);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [busy, setBusy] = useState(false);
  const [emailForm, setEmailForm] = useState(() => emptyCommDraft("email"));
  const [smsForm, setSmsForm] = useState(() => emptyCommDraft("sms"));
  const [internalForm, setInternalForm] = useState(() => emptyCommDraft("internal"));

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!canAccessSpecialNav("comms")) {
        appToastError("Access denied", "Your role cannot open Comms.");
        router.replace("/");
        return;
      }
      void hydrateCommMessages().then((rows) => {
        if (cancelled) return;
        setMessages(rows);
        setReady(true);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const cells = useMemo(
    () => calendarCells(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, CommMessage[]>();
    for (const msg of messages) {
      const list = map.get(msg.date) || [];
      list.push(msg);
      map.set(msg.date, list);
    }
    return map;
  }, [messages]);

  const selectedMessages = useMemo(
    () => byDate.get(selectedDate) || [],
    [byDate, selectedDate],
  );

  async function persist(next: CommMessage[]) {
    setMessages(next);
    const ok = await saveCommMessages(next);
    if (!ok) {
      appToastError("Could not save", "Check the API connection and try again.");
      const refreshed = loadCommMessages();
      setMessages(refreshed);
      return false;
    }
    return true;
  }

  async function postInternal() {
    const subject = internalForm.subject.trim();
    const body = internalForm.body.trim();
    if (!subject && !body) {
      appToastError("Empty message", "Add a subject or body.");
      return;
    }
    const now = new Date().toISOString();
    const row: CommMessage = {
      id: crypto.randomUUID(),
      channel: "internal",
      status: "sent",
      subject: subject || "General note",
      body,
      to: internalForm.to.trim() || "All staff",
      date: internalForm.date || selectedDate,
      time: internalForm.time || "",
      createdBy: authorName(),
      createdAt: now,
      updatedAt: now,
      sentAt: now,
      error: "",
    };
    setBusy(true);
    try {
      const ok = await persist([row, ...messages]);
      if (!ok) return;
      setInternalForm(emptyCommDraft("internal"));
      setSelectedDate(row.date);
      setTab("inbox");
      appToastSuccess("Posted to Comms", "General communication is on the feed and calendar.");
    } finally {
      setBusy(false);
    }
  }

  async function sendEmail() {
    const to = splitRecipients(emailForm.to);
    const subject = emailForm.subject.trim();
    const body = emailForm.body.trim();
    if (!to.length) {
      appToastError("Recipients required", "Add at least one email address.");
      return;
    }
    const bad = to.find((addr) => !isValidEmail(addr));
    if (bad) {
      appToastError("Invalid email", bad);
      return;
    }
    if (!subject) {
      appToastError("Subject required", "Add an email subject.");
      return;
    }
    if (!body) {
      appToastError("Body required", "Add the email body.");
      return;
    }

    const scheduleOnly =
      Boolean(emailForm.date) &&
      emailForm.date > new Date().toISOString().slice(0, 10);

    setBusy(true);
    const now = new Date().toISOString();
    const base: CommMessage = {
      id: crypto.randomUUID(),
      channel: "email",
      status: scheduleOnly ? "scheduled" : "queued",
      subject,
      body,
      to: to.join(", "),
      date: emailForm.date || selectedDate,
      time: emailForm.time || "",
      createdBy: authorName(),
      createdAt: now,
      updatedAt: now,
      sentAt: "",
      error: "",
    };

    try {
      if (scheduleOnly) {
        const ok = await persist([base, ...messages]);
        if (!ok) return;
        setEmailForm(emptyCommDraft("email"));
        setSelectedDate(base.date);
        setTab("calendar");
        appToastSuccess("Email scheduled", `Will appear on ${base.date}. Send manually when due.`);
        return;
      }

      const result = await sendCommEmail({ to, subject, body });
      const saved: CommMessage = result.ok
        ? { ...base, status: "sent", sentAt: now, error: "" }
        : { ...base, status: "failed", error: result.error || "Send failed" };
      const ok = await persist([saved, ...messages]);
      if (!ok) return;
      if (result.ok) {
        setEmailForm(emptyCommDraft("email"));
        setSelectedDate(saved.date);
        setTab("inbox");
        appToastSuccess("Email sent", `Delivered to ${to.length} recipient${to.length === 1 ? "" : "s"}.`);
      } else {
        appToastError("Email failed", result.error || "Could not send.");
        setTab("inbox");
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendSms() {
    const to = splitRecipients(smsForm.to);
    const body = smsForm.body.trim();
    if (!to.length) {
      appToastError("Recipients required", "Add at least one phone number.");
      return;
    }
    const bad = to.find((phone) => !isValidPhone(phone));
    if (bad) {
      appToastError("Invalid phone", `${bad} — use international format e.g. +2567…`);
      return;
    }
    if (!body) {
      appToastError("Body required", "Add the SMS text.");
      return;
    }

    const scheduleOnly =
      Boolean(smsForm.date) &&
      smsForm.date > new Date().toISOString().slice(0, 10);

    setBusy(true);
    const now = new Date().toISOString();
    const base: CommMessage = {
      id: crypto.randomUUID(),
      channel: "sms",
      status: scheduleOnly ? "scheduled" : "queued",
      subject: "SMS",
      body,
      to: to.join(", "),
      date: smsForm.date || selectedDate,
      time: smsForm.time || "",
      createdBy: authorName(),
      createdAt: now,
      updatedAt: now,
      sentAt: "",
      error: "",
    };

    try {
      if (scheduleOnly) {
        const ok = await persist([base, ...messages]);
        if (!ok) return;
        setSmsForm(emptyCommDraft("sms"));
        setSelectedDate(base.date);
        setTab("calendar");
        appToastSuccess("SMS scheduled", `Queued for ${base.date}.`);
        return;
      }

      const result = await sendCommSms({ to, body });
      const saved: CommMessage = result.ok
        ? { ...base, status: "sent", sentAt: now, error: "" }
        : { ...base, status: "failed", error: result.error || "Send failed" };
      const ok = await persist([saved, ...messages]);
      if (!ok) return;
      if (result.ok) {
        setSmsForm(emptyCommDraft("sms"));
        setSelectedDate(saved.date);
        setTab("inbox");
        appToastSuccess("SMS sent", `Delivered via ${result.via || "provider"}.`);
      } else {
        appToastError("SMS failed", result.error || "Could not send.");
        setTab("inbox");
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeMessage(id: string) {
    const ok = await persist(messages.filter((row) => row.id !== id));
    if (ok) appToastSuccess("Removed from Comms");
  }

  function shiftMonth(delta: number) {
    setCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-[13px] text-slate-500">
        Loading Comms…
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            onClick={openSidebar}
            className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Open menu"
          >
            <HambergerMenu size={18} color="currentColor" />
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Communications
            </p>
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
              Comms
            </h1>
            <p className="mt-1 max-w-xl text-[13px] text-slate-500">
              Calendar of company messages, general notices, email, and SMS —
              all in one place.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <NotificationsMenu />
          <PageMoreMenu />
          <Link
            href="/request-emails"
            className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
          >
            Request emails
          </Link>
          <Link
            href="/settings?section=email"
            className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
          >
            Email settings
          </Link>
        </div>
      </header>

      <SegmentTabList>
        {(
          [
            ["calendar", "Calendar", CalendarIcon],
            ["inbox", "General", MessageText1],
            ["email", "Email", Sms],
            ["sms", "SMS", Sms],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            className={segmentTabClass(tab === id)}
            onClick={() => setTab(id)}
          >
            <Icon size={14} color="currentColor" />
            {label}
          </button>
        ))}
      </SegmentTabList>

      {tab === "calendar" ? (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-slate-900">
                {MONTHS[cursor.month]} {cursor.year}
              </h2>
              <div className="flex gap-1">
                <Button type="button" variant="outline" size="sm" onClick={() => shiftMonth(-1)}>
                  <ArrowLeft2 size={14} color="currentColor" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const now = new Date();
                    setCursor({ year: now.getFullYear(), month: now.getMonth() });
                    setSelectedDate(now.toISOString().slice(0, 10));
                  }}
                >
                  Today
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => shiftMonth(1)}>
                  <ArrowRight2 size={14} color="currentColor" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-400">
              {WEEKDAYS.map((day) => (
                <div key={day} className="py-1">
                  {day}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((cell, index) => {
                if (!cell.date) {
                  return <div key={`pad-${index}`} className="min-h-[72px] rounded-lg bg-slate-50/60" />;
                }
                const dayMessages = byDate.get(cell.date) || [];
                const active = cell.date === selectedDate;
                const isToday = cell.date === new Date().toISOString().slice(0, 10);
                return (
                  <button
                    key={cell.date}
                    type="button"
                    onClick={() => setSelectedDate(cell.date!)}
                    className={cn(
                      "flex min-h-[72px] flex-col items-start rounded-lg border p-1.5 text-left transition",
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-100 bg-white hover:border-slate-300",
                      isToday && !active && "ring-1 ring-orange-400",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[12px] font-semibold tabular-nums",
                        active ? "text-white" : "text-slate-700",
                      )}
                    >
                      {cell.day}
                    </span>
                    <div className="mt-1 flex w-full flex-col gap-0.5">
                      {dayMessages.slice(0, 2).map((msg) => (
                        <span
                          key={msg.id}
                          className={cn(
                            "truncate rounded px-1 text-[9px] font-medium",
                            active
                              ? "bg-white/15 text-white"
                              : msg.channel === "email"
                                ? "bg-sky-50 text-sky-700"
                                : msg.channel === "sms"
                                  ? "bg-violet-50 text-violet-700"
                                  : "bg-slate-100 text-slate-600",
                          )}
                        >
                          {msg.subject || channelLabel(msg.channel)}
                        </span>
                      ))}
                      {dayMessages.length > 2 ? (
                        <span
                          className={cn(
                            "text-[9px]",
                            active ? "text-white/70" : "text-slate-400",
                          )}
                        >
                          +{dayMessages.length - 2} more
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-[15px] font-semibold text-slate-900">
              {selectedDate}
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {selectedMessages.length
                ? `${selectedMessages.length} communication${selectedMessages.length === 1 ? "" : "s"}`
                : "No communications on this day"}
            </p>
            <div className="mt-3 space-y-2">
              {selectedMessages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-[12px] text-slate-400">
                  Pick a day or post from General / Email / SMS.
                </div>
              ) : (
                selectedMessages.map((msg) => (
                  <MessageCard key={msg.id} message={msg} onRemove={removeMessage} />
                ))
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setInternalForm({ ...emptyCommDraft("internal"), date: selectedDate });
                  setTab("inbox");
                }}
              >
                Post notice
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setEmailForm({ ...emptyCommDraft("email"), date: selectedDate });
                  setTab("email");
                }}
              >
                Schedule email
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setSmsForm({ ...emptyCommDraft("sms"), date: selectedDate });
                  setTab("sms");
                }}
              >
                Schedule SMS
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "inbox" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-[15px] font-semibold text-slate-900">Post general notice</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Internal communication visible on the calendar and feed — not emailed unless you use the Email tab.
            </p>
            <div className="mt-3 space-y-3">
              <div>
                <Label className="mb-1 text-[11px] text-slate-500">Subject</Label>
                <Input
                  value={internalForm.subject}
                  onChange={(e) => setInternalForm({ ...internalForm, subject: e.target.value })}
                  placeholder="e.g. Friday site briefing"
                />
              </div>
              <div>
                <Label className="mb-1 text-[11px] text-slate-500">Audience (optional)</Label>
                <Input
                  value={internalForm.to}
                  onChange={(e) => setInternalForm({ ...internalForm, to: e.target.value })}
                  placeholder="All staff, Project managers, Finance…"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="mb-1 text-[11px] text-slate-500">Date</Label>
                  <Input
                    type="date"
                    value={internalForm.date}
                    onChange={(e) => setInternalForm({ ...internalForm, date: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="mb-1 text-[11px] text-slate-500">Time</Label>
                  <Input
                    type="time"
                    value={internalForm.time}
                    onChange={(e) => setInternalForm({ ...internalForm, time: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label className="mb-1 text-[11px] text-slate-500">Message</Label>
                <Textarea
                  value={internalForm.body}
                  onChange={(e) => setInternalForm({ ...internalForm, body: e.target.value })}
                  placeholder="Write the notice…"
                  rows={5}
                />
              </div>
              <Button type="button" disabled={busy} onClick={() => void postInternal()}>
                Post to Comms
              </Button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-[15px] font-semibold text-slate-900">All communications</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {messages.length} item{messages.length === 1 ? "" : "s"} · notices, emails, and SMS
            </p>
            <div className="mt-3 max-h-[560px] space-y-2 overflow-y-auto pr-1">
              {messages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-[12px] text-slate-400">
                  Nothing yet. Post a notice or send email / SMS.
                </div>
              ) : (
                messages.map((msg) => (
                  <MessageCard key={msg.id} message={msg} onRemove={removeMessage} />
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "email" ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-[15px] font-semibold text-slate-900">Send email</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Uses the same SMTP / Resend path as document mail. Future dates are saved as scheduled on the calendar.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="mb-1 text-[11px] text-slate-500">To</Label>
              <Input
                value={emailForm.to}
                onChange={(e) => setEmailForm({ ...emailForm, to: e.target.value })}
                placeholder="name@company.com, other@company.com"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1 text-[11px] text-slate-500">Subject</Label>
              <Input
                value={emailForm.subject}
                onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })}
                placeholder="Subject line"
              />
            </div>
            <div>
              <Label className="mb-1 text-[11px] text-slate-500">Calendar date</Label>
              <Input
                type="date"
                value={emailForm.date}
                onChange={(e) => setEmailForm({ ...emailForm, date: e.target.value })}
              />
            </div>
            <div>
              <Label className="mb-1 text-[11px] text-slate-500">Time</Label>
              <Input
                type="time"
                value={emailForm.time}
                onChange={(e) => setEmailForm({ ...emailForm, time: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1 text-[11px] text-slate-500">Body</Label>
              <Textarea
                value={emailForm.body}
                onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })}
                rows={8}
                placeholder="Write the email…"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void sendEmail()}>
              {emailForm.date > new Date().toISOString().slice(0, 10)
                ? "Schedule on calendar"
                : "Send email"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setEmailForm(emptyCommDraft("email"))}
            >
              Clear
            </Button>
          </div>
        </section>
      ) : null}

      {tab === "sms" ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-[15px] font-semibold text-slate-900">Send SMS</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Requires EgoSMS — set `EGO_SMS_USERNAME`, `EGO_SMS_PASSWORD`, and
            `EGO_SMS_SENDER` in the server environment (see Settings → SMS for status).
            Future dates are saved as scheduled.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="mb-1 text-[11px] text-slate-500">To (phone)</Label>
              <Input
                value={smsForm.to}
                onChange={(e) => setSmsForm({ ...smsForm, to: e.target.value })}
                placeholder="+256700000000, +256711111111"
              />
            </div>
            <div>
              <Label className="mb-1 text-[11px] text-slate-500">Calendar date</Label>
              <Input
                type="date"
                value={smsForm.date}
                onChange={(e) => setSmsForm({ ...smsForm, date: e.target.value })}
              />
            </div>
            <div>
              <Label className="mb-1 text-[11px] text-slate-500">Time</Label>
              <Input
                type="time"
                value={smsForm.time}
                onChange={(e) => setSmsForm({ ...smsForm, time: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="mb-1 text-[11px] text-slate-500">
                Message ({smsForm.body.length}/1600)
              </Label>
              <Textarea
                value={smsForm.body}
                onChange={(e) => setSmsForm({ ...smsForm, body: e.target.value.slice(0, 1600) })}
                rows={6}
                placeholder="SMS text…"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void sendSms()}>
              {smsForm.date > new Date().toISOString().slice(0, 10)
                ? "Schedule on calendar"
                : "Send SMS"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setSmsForm(emptyCommDraft("sms"))}
            >
              Clear
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function MessageCard({
  message,
  onRemove,
}: {
  message: CommMessage;
  onRemove: (id: string) => void;
}) {
  return (
    <article className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-semibold text-slate-800">
              {message.subject || channelLabel(message.channel)}
            </span>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", statusTone(message.status))}>
              {message.status}
            </span>
            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              {channelLabel(message.channel)}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {message.date}
            {message.time ? ` · ${message.time}` : ""}
            {message.createdBy ? ` · ${message.createdBy}` : ""}
            {message.to ? ` · ${message.to}` : ""}
          </p>
          {message.body ? (
            <p className="mt-1 whitespace-pre-wrap text-[12px] text-slate-700">{message.body}</p>
          ) : null}
          {message.error ? (
            <p className="mt-1 text-[11px] text-rose-600">{message.error}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-rose-600"
          title="Remove"
          onClick={() => onRemove(message.id)}
        >
          <Trash size={14} color="currentColor" />
        </button>
      </div>
    </article>
  );
}
