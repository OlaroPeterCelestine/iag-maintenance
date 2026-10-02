"use client";

import { useAppShell } from "@/components/app-shell";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  REQUEST_EMAIL_ROLE_OPTIONS,
  defaultRequestEmailContacts,
  fetchRequestEmailContacts,
  saveRequestEmailContacts,
  type RequestEmailContact,
} from "@/lib/manager-settings";
import { currentUserCan, currentUserIsAdmin } from "@/lib/access-control";
import { Add, HambergerMenu, Sms, Trash } from "iconsax-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { appToastError, appToastSuccess } from "@/lib/app-toast";

function emptyContact(role = "Other"): RequestEmailContact {
  return {
    id: crypto.randomUUID(),
    role,
    name: "",
    email: "",
    active: "Yes",
  };
}

function isValidEmail(value: string) {
  return !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function RequestEmailsPage() {
  const { openSidebar } = useAppShell();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<RequestEmailContact[]>([]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!currentUserIsAdmin() || !currentUserCan("edit-settings")) {
        appToastError("Access denied", "Your role cannot edit request email contacts.");
        router.replace("/");
        return;
      }
      void (async () => {
        const stored = await fetchRequestEmailContacts();
        if (cancelled) return;
        const have = new Set(stored.map((row) => row.role));
        const missing = defaultRequestEmailContacts.filter((row) => !have.has(row.role));
        setRows([...stored, ...missing.map((row) => ({ ...row, id: crypto.randomUUID() }))]);
        setReady(true);
      })();
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const filledCount = useMemo(
    () => rows.filter((row) => row.email.trim() && row.active !== "No").length,
    [rows],
  );

  function persist(next: RequestEmailContact[]) {
    setRows(next);
    void saveRequestEmailContacts(next);
  }

  function updateRow(id: string, patch: Partial<RequestEmailContact>) {
    persist(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow() {
    persist([...rows, emptyContact()]);
    appToastSuccess("Contact row added");
  }

  function removeRow(id: string) {
    persist(rows.filter((row) => row.id !== id));
    appToastSuccess("Contact removed");
  }

  function saveAll() {
    const invalid = rows.find((row) => row.email.trim() && !isValidEmail(row.email));
    if (invalid) {
      appToastError("Invalid email", `Check the email for ${invalid.name || invalid.role}.`);
      return;
    }
    void saveRequestEmailContacts(rows).then((ok) => {
      if (!ok) {
        appToastError("Could not save contacts", "Check the API connection and try again.");
        return;
      }
      appToastSuccess(
        "Request emails saved",
        `${filledCount} active contact${filledCount === 1 ? "" : "s"} will get request notifications.`,
      );
    });
  }

  if (!ready) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-[13px] text-slate-500">
        Loading request email contacts…
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-0.5 lg:hidden"
            onClick={() => openSidebar()}
            aria-label="Open menu"
          >
            <HambergerMenu size={18} variant="Linear" color="currentColor" />
          </Button>
          <div>
            <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
              Access
            </p>
            <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-slate-900">
              <Sms size={22} variant="Linear" color="currentColor" />
              Request email contacts
            </h1>
            <p className="mt-1 max-w-2xl text-[13px] text-slate-600">
              Every requisition step emails from Vercel (submit, each approval, reject,
              amend, paid). Alerts go to Request email contacts <em>and</em> every active
              user in Users &amp; roles whose role is on that step (e.g. all Accounts
              Assistants, Finance users, PMs). CEO and GM are always included; the
              requestor too.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ThemeToggle />
          <NotificationsMenu />
          <PageMoreMenu />
          <Link
            href="/settings?section=email"
            className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
          >
            SMTP settings
          </Link>
          <Button type="button" onClick={saveAll}>
            Save contacts
          </Button>
        </div>
      </header>

      <div className="rounded-xl border border-sky-100 bg-sky-50/70 px-4 py-3 text-[13px] text-slate-700">
        <strong className="font-semibold text-slate-900">{filledCount}</strong> active
        email{filledCount === 1 ? "" : "s"} configured. Leave a row blank until you know
        the address — empty rows are skipped. Alerts go out through Vercel SMTP at{" "}
        <strong className="font-medium text-slate-900">every approval step</strong> for each
        requisition type. Use{" "}
        <Link href="/settings?section=email" className="font-medium text-sky-700 hover:underline">
          Settings → Email
        </Link>{" "}
        for the mailbox that sends the messages.
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-[14px] font-semibold text-slate-900">Chain of command</h2>
            <p className="text-[12px] text-slate-500">
              One or more people per role. Add extra contractors or managers as needed.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Add size={14} variant="Linear" color="currentColor" />
            Add person
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] tracking-wide text-slate-500 uppercase">
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Email</th>
                <th className="px-3 py-2.5 font-medium">Active</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 align-middle">
                  <td className="px-4 py-2">
                    <select
                      className="h-9 w-full min-w-[150px] rounded-md border border-slate-200 bg-white px-2 text-[13px]"
                      value={row.role}
                      onChange={(e) => updateRow(row.id, { role: e.target.value })}
                    >
                      {REQUEST_EMAIL_ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                      {!REQUEST_EMAIL_ROLE_OPTIONS.includes(
                        row.role as (typeof REQUEST_EMAIL_ROLE_OPTIONS)[number],
                      ) ? (
                        <option value={row.role}>{row.role}</option>
                      ) : null}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.name}
                      placeholder="Person name"
                      onChange={(e) => updateRow(row.id, { name: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="email"
                      value={row.email}
                      placeholder="name@company.com"
                      className={
                        row.email.trim() && !isValidEmail(row.email)
                          ? "border-rose-300"
                          : undefined
                      }
                      onChange={(e) => updateRow(row.id, { email: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px]"
                      value={row.active}
                      onChange={(e) => updateRow(row.id, { active: e.target.value })}
                    >
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-slate-500 hover:text-rose-600"
                      onClick={() => removeRow(row.id)}
                      aria-label={`Remove ${row.name || row.role}`}
                    >
                      <Trash size={16} variant="Linear" color="currentColor" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <p className="text-[12px] text-slate-500">
            Tip: for contractors on a specific job, put their name so it can match the
            request&apos;s contractor / payee field.
          </p>
          <Button type="button" onClick={saveAll}>
            Save contacts
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] text-slate-600">
        <Label className="text-[12px] font-semibold text-slate-800">How it works</Label>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Every alert goes to CEO, General Manager, the person requesting, and
            <strong> every role on that request&apos;s approval line</strong> (PM / Accounts
            Assistant / Accountant / HR / Finance / QS / Stores / Procurement as applicable),
            plus whoever the chain is waiting on now.
          </li>
          <li>
            On paid, Finance is included as well. Named contractors stay in the loop when present
            on the record. Set each role&apos;s real inbox under Request emails / Users.
          </li>
        </ul>
      </div>
    </div>
  );
}
