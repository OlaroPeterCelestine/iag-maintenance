"use client";

import { useMounted } from "@/hooks/use-mounted";
import { useRecordsSyncTick } from "@/hooks/use-records-sync-tick";
import { filterRecordsForProjectScope } from "@/lib/project-scope";
import { loadRecords } from "@/lib/records-store";
import { getCurrentSessionUser } from "@/lib/session-profile";
import {
  ArrowRight,
  Building2,
  ClipboardList,
  FileCheck2,
  FolderKanban,
  HardHat,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

const portalCards = [
  {
    title: "Assigned projects",
    description: "Review the projects linked to your contractor account.",
    href: "/projects?view=projects",
    icon: FolderKanban,
    tone: "bg-orange-50 text-orange-600",
  },
  {
    title: "Payment requests",
    description: "Create and follow up project payment requests (IPC).",
    href: "/projects?view=payment-requests&new=1",
    icon: ClipboardList,
    tone: "bg-blue-50 text-blue-600",
  },
  {
    title: "Material requests",
    description: "Raise material requests for your assigned projects.",
    href: "/projects?view=requisitions&new=1",
    icon: ClipboardList,
    tone: "bg-violet-50 text-violet-600",
  },
  {
    title: "Progress certificates",
    description: "View certificates for work completed on your projects.",
    href: "/projects?view=progress-certificates",
    icon: FileCheck2,
    tone: "bg-emerald-50 text-emerald-600",
  },
] as const;

export default function ContractorPortalPage() {
  const hydrated = useMounted();
  const user = hydrated ? getCurrentSessionUser() : { id: "", name: "", username: "", email: "", role: "", initials: "—" };
  const { tick, hydrating } = useRecordsSyncTick([
    { module: "projects", entity: "contractors" },
    { module: "projects", entity: "projects" },
    { module: "projects", entity: "payment-requests" },
    { module: "projects", entity: "requisitions" },
    { module: "projects", entity: "progress-certificates" },
  ]);

  const summary = useMemo(() => {
    if (!hydrated) return { projects: 0, requests: 0, certificates: 0 };
    void tick;
    return {
      projects: filterRecordsForProjectScope(
        "projects",
        loadRecords("projects", "projects"),
      ).length,
      requests: filterRecordsForProjectScope(
        "payment-requests",
        loadRecords("projects", "payment-requests"),
      ).length,
      certificates: filterRecordsForProjectScope(
        "progress-certificates",
        loadRecords("projects", "progress-certificates"),
      ).length,
    };
  }, [tick, hydrated]);

  const displayName = user.name || user.username || "Contractor";
  const company = user.name || user.email;
  const stats = [
    { label: "Assigned projects", value: summary.projects, icon: Building2 },
    { label: "Payment requests", value: summary.requests, icon: ClipboardList },
    {
      label: "Progress certificates",
      value: summary.certificates,
      icon: FileCheck2,
    },
  ];

  return (
    <div className="min-h-full bg-[#f7f8fa]">
      <header className="border-b border-slate-200/80 bg-white px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-orange-400">
              <HardHat size={21} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">Contractor portal</p>
              <p className="truncate text-xs text-slate-500">{company}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/projects?view=payment-requests&new=1"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-orange-500 px-3.5 text-sm font-semibold text-white transition hover:bg-orange-600"
            >
              <ClipboardList size={16} />
              <span className="hidden sm:inline">New payment request</span>
            </Link>
            <Link
              href="/profile"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <UserRound size={16} />
              <span className="hidden sm:inline">My profile</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
        <section className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white sm:px-9 sm:py-10">
          <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-orange-500/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 size-64 rounded-full bg-blue-500/10 blur-3xl" />
          <div className="relative max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.2em] text-orange-400 uppercase">
              Welcome back
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              {displayName}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-7 text-slate-300">
              Access the projects, requests, and progress records assigned to your contractor
              account.
            </p>
            <Link
              href="/projects?view=projects"
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white transition hover:bg-orange-600"
            >
              Open my projects <ArrowRight size={16} />
            </Link>
          </div>
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">{label}</p>
                <Icon size={18} className="text-slate-400" />
              </div>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                {hydrating ? "—" : value}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-8">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Your workspace</h2>
            <p className="mt-1 text-sm text-slate-500">
              Only records linked to your contractor account are shown.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {portalCards.map(({ title, description, href, icon: Icon, tone }) => (
              <Link
                key={title}
                href={href}
                className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-200/50"
              >
                <span className={`inline-flex size-11 items-center justify-center rounded-xl ${tone}`}>
                  <Icon size={21} />
                </span>
                <h3 className="mt-5 font-semibold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-orange-600">
                  Open <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
