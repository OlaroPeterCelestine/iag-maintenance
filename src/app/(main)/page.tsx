"use client";

import { useSearchParams } from "next/navigation";
import { useAppShell } from "@/components/app-shell";
import { FACTORY_PARAM, FactoryScopeSelect } from "@/components/factory-scope-select";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { AUTH_CHANGED_EVENT } from "@/lib/auth";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords } from "@/lib/records-store";
import { getCurrentSessionUser } from "@/lib/session-profile";
import { cn } from "@/lib/utils";
import { Wrench } from "lucide-react";
import { Menu } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMounted } from "@/hooks/use-mounted";

function greeting(ready = true) {
  if (!ready) return "Hello";
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function isOpen(row: ManagerRecord): boolean {
  return !/closed|complete|completed|cancelled|canceled/i.test(String(row.status || "Open"));
}

export default function MaintenanceDashboardPage() {
  const { openSidebar } = useAppShell();
  const hydrated = useMounted();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const refresh = () => setTick((n) => n + 1);
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    window.addEventListener("financeiag-records-changed", refresh);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
      window.removeEventListener("financeiag-records-changed", refresh);
    };
  }, []);

  const sessionUser = useMemo(() => {
    if (!hydrated) return null;
    void tick;
    try {
      return getCurrentSessionUser();
    } catch {
      return null;
    }
  }, [tick, hydrated]);

  // The factory the header picker put in the URL. Absent means every factory,
  // which is what these figures summed before there was a picker.
  const searchParams = useSearchParams();
  const factory = (searchParams.get(FACTORY_PARAM) || "").trim();

  const machines = useMemo(() => {
    if (!hydrated) return [];
    void tick;
    try {
      const all = loadRecords("production", "work-centers");
      return factory ? all.filter((m) => String(m.plantCode ?? "").trim() === factory) : all;
    } catch {
      return [];
    }
  }, [tick, hydrated, factory]);

  /**
   * machine tag -> factory, so the rest can be narrowed.
   *
   * A work order, a PM schedule and a downtime event all name a machine rather
   * than a factory; the machine knows where it stands. Built from the full
   * register, not the narrowed one, so the lookup still answers for machines
   * outside the scope.
   */
  const factoryOfMachine = useMemo(() => {
    const out = new Map<string, string>();
    if (!hydrated) return out;
    void tick;
    try {
      for (const m of loadRecords("production", "work-centers")) {
        const tag = String(m.code ?? m.id ?? "").trim();
        const plant = String(m.plantCode ?? "").trim();
        if (tag && plant) out.set(tag, plant);
      }
    } catch {
      /* no register yet */
    }
    return out;
  }, [tick, hydrated]);

  /** Load a collection, narrowed to the factory through each row's machine. */
  const loadScoped = useCallback(
    (entity: string) => {
      if (!hydrated) return [] as ManagerRecord[];
      void tick;
      try {
        const all = loadRecords("production", entity);
        if (!factory) return all;
        return all.filter((r) => {
          const machine = String(r.workCenter ?? "").trim();
          // A row naming no machine cannot be placed, so it is left out rather
          // than counted at every factory.
          return machine ? factoryOfMachine.get(machine) === factory : false;
        });
      } catch {
        return [] as ManagerRecord[];
      }
    },
    [tick, hydrated, factory, factoryOfMachine],
  );

  const orders = useMemo(() => loadScoped("work-orders"), [loadScoped]);
  const schedules = useMemo(() => loadScoped("pm-schedules"), [loadScoped]);
  const parts = useMemo(() => loadScoped("spare-parts"), [loadScoped]);
  const downtime = useMemo(() => loadScoped("downtime-logs"), [loadScoped]);

  const openOrders = orders.filter(isOpen);
  const stopped = machines.filter((row) => /down|maintenance/i.test(String(row.status || "")));
  const openDowntime = downtime.filter(isOpen);
  const overduePm = schedules.filter((row) => /overdue/i.test(String(row.status || "")));
  const lowParts = parts.filter((row) => {
    const reorder = Number(row.reorderLevel);
    return reorder > 0 && row.onHand !== "" && Number(row.onHand) < reorder;
  });
  const recent = [...orders]
    .sort((a, b) => String(b.date || b.updatedAt || "").localeCompare(String(a.date || a.updatedAt || "")))
    .slice(0, 8);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <button
          type="button"
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          onClick={openSidebar}
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
            {greeting(hydrated)}
            {sessionUser?.name ? `, ${sessionUser.name.split(" ")[0]}` : ""}
          </h1>
          <p className="truncate text-xs text-slate-500">Maintenance — machines, work orders, and downtime</p>
        </div>
        {/* Which factory this overview is about. */}
        <FactoryScopeSelect />
        <NotificationsMenu />
        <ThemeToggle />
        <PageMoreMenu />
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Link
            href="/production?view=work-orders"
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-300 dark:border-slate-800 dark:bg-slate-950"
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Open work orders</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{openOrders.length}</p>
          </Link>
          <Link
            href="/production?view=work-centers"
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-300 dark:border-slate-800 dark:bg-slate-950"
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Machines stopped</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{stopped.length}</p>
          </Link>
          <Link
            href="/production?view=downtime-logs"
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-300 dark:border-slate-800 dark:bg-slate-950"
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Open downtime</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{openDowntime.length}</p>
          </Link>
          <Link
            href="/production?view=pm-schedules"
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-300 dark:border-slate-800 dark:bg-slate-950"
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Overdue PM</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{overduePm.length}</p>
          </Link>
          <Link
            href="/production?view=spare-parts"
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-300 dark:border-slate-800 dark:bg-slate-950"
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Parts below reorder</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{lowParts.length}</p>
          </Link>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { href: "/production?view=work-centers", label: "Machines" },
            { href: "/production?view=work-orders", label: "Work orders" },
            { href: "/production?view=batch-records", label: "Job cards" },
            { href: "/production?view=pm-schedules", label: "Schedules" },
            { href: "/production?view=pm-templates", label: "PM templates" },
            { href: "/production?view=spare-parts", label: "Spare parts" },
            { href: "/production?view=downtime-logs", label: "Downtime" },
            { href: "/production?view=reliability", label: "Reliability" },
            { href: "/production?view=alerts", label: "Alerts" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <Wrench size={14} />
              {item.label}
            </Link>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-50">
            Recent work orders
          </div>
          <table className="w-full text-left text-[13px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Work order</th>
                <th className="px-4 py-2">Priority</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No work orders yet. Open Maintenance → Work Orders to raise the first one.
                  </td>
                </tr>
              ) : (
                recent.map((row) => (
                  <tr key={row.id} className="border-t border-slate-50 dark:border-slate-800">
                    <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">
                      {row.reference || String(row.id || "").slice(0, 8)}
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                      {row.title || row.workCenter || "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{row.priority || "—"}</td>
                    <td className={cn("px-4 py-2", isOpen(row) ? "text-orange-700" : "text-slate-500")}>
                      {row.status || "Open"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
