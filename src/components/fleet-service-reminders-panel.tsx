"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { NotificationBing, TickCircle, TruckFast, Warning2 } from "iconsax-react";
import { useRecordsSyncTick } from "@/hooks/use-records-sync-tick";
import {
  buildFleetServiceReminders,
  createMaintenanceFromReminder,
  type FleetReminder,
  type FleetReminderSeverity,
} from "@/lib/fleet-service-reminders";
import { Button } from "@/components/ui/button";
import { TableRowsSkeleton } from "@/components/page-loading";
import { Skeleton } from "@/components/ui/skeleton";

function tone(severity: FleetReminderSeverity) {
  if (severity === "overdue") return "bg-rose-50 text-rose-800 ring-rose-200";
  if (severity === "due-soon") return "bg-amber-50 text-amber-900 ring-amber-200";
  return "bg-sky-50 text-sky-800 ring-sky-200";
}

function kindLabel(kind: FleetReminder["kind"]) {
  switch (kind) {
    case "service-date":
      return "Service (date)";
    case "service-km":
      return "Service (km)";
    case "insurance":
      return "Insurance";
    case "registration":
      return "Registration";
    case "licence":
      return "Driver licence";
  }
}

export function FleetServiceRemindersPanel() {
  const [filter, setFilter] = useState<"all" | FleetReminderSeverity>("all");
  const [q, setQ] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const { tick, hydrating } = useRecordsSyncTick([
    { module: "fleet", entity: "vehicles" },
    { module: "fleet", entity: "drivers" },
    { module: "fleet", entity: "maintenance-requests" },
  ]);

  const reminders = useMemo(() => buildFleetServiceReminders(), [tick]);
  const loading = hydrating && reminders.length === 0;
  const counts = useMemo(() => {
    return reminders.reduce(
      (acc, r) => {
        acc[r.severity] += 1;
        return acc;
      },
      { overdue: 0, "due-soon": 0, upcoming: 0 },
    );
  }, [reminders]);

  const filtered = reminders.filter((r) => {
    if (filter !== "all" && r.severity !== filter) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return (
      r.subject.toLowerCase().includes(needle) ||
      r.detail.toLowerCase().includes(needle) ||
      (r.vehicle || "").toLowerCase().includes(needle) ||
      (r.driver || "").toLowerCase().includes(needle)
    );
  });

  function onCreateMaintenance(reminder: FleetReminder) {
    startTransition(async () => {
      setMessage("");
      const row = await createMaintenanceFromReminder(reminder);
      if (!row) {
        setMessage("Could not create maintenance request.");
        return;
      }
      setMessage(`Created ${row.reference} for ${reminder.subject}.`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <NotificationBing size={20} variant="Bold" color="currentColor" />
            </div>
            <div>
              <h2 className="text-[16px] font-semibold text-slate-900">Service reminders</h2>
              <p className="mt-0.5 text-[13px] text-slate-500">
                Due soon and overdue service, insurance, registration, and driver licences —
                from vehicle and driver records.
              </p>
            </div>
          </div>
          <input
            className="h-9 w-full max-w-xs rounded-lg border border-slate-200 px-3 text-[13px]"
            placeholder="Filter vehicle or driver…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {(
            [
              ["overdue", "Overdue", counts.overdue],
              ["due-soon", "Due soon (≤30d / 500km)", counts["due-soon"]],
              ["upcoming", "Upcoming (≤60d)", counts.upcoming],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter((prev) => (prev === key ? "all" : key))}
              className={`rounded-lg border px-3 py-2 text-left transition ${
                filter === key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-100 bg-slate-50/80 hover:border-slate-200"
              }`}
            >
              <p
                className={`text-[11px] uppercase tracking-wide ${
                  filter === key ? "text-white/70" : "text-slate-500"
                }`}
              >
                {label}
              </p>
              {loading ? (
                <Skeleton className="mt-1 h-[18px] w-10 bg-slate-100" />
              ) : (
                <p className="text-[18px] font-semibold tabular-nums">{count}</p>
              )}
            </button>
          ))}
        </div>
        {message ? (
          <p className="mt-3 flex items-center gap-1.5 text-[13px] text-emerald-700">
            <TickCircle size={16} color="currentColor" />
            {message}{" "}
            <Link
              href="/fleet?view=maintenance-requests"
              className="font-medium underline underline-offset-2"
            >
              Open maintenance
            </Link>
          </p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <thead className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Severity</th>
              <th className="px-4 py-2.5 font-semibold">Type</th>
              <th className="px-4 py-2.5 font-semibold">Subject</th>
              <th className="px-4 py-2.5 font-semibold">Detail</th>
              <th className="px-4 py-2.5 font-semibold">Due</th>
              <th className="px-4 py-2.5 font-semibold text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableRowsSkeleton columns={4} rows={6} />
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                    <TruckFast size={28} variant="Bold" color="#94a3b8" />
                    <p>
                      No reminders in this filter. Set next service date/km, insurance, and
                      registration on Vehicles (and licence expiry on Drivers).
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone(r.severity)}`}
                    >
                      {r.severity === "overdue" ? (
                        <Warning2 size={12} color="currentColor" />
                      ) : null}
                      {r.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{kindLabel(r.kind)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{r.subject}</td>
                  <td className="px-4 py-3 text-slate-600">{r.detail}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">
                    {r.dueDate || (r.dueKm ? `${r.dueKm} km` : "—")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.kind === "service-date" || r.kind === "service-km" ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8"
                        disabled={pending}
                        onClick={() => onCreateMaintenance(r)}
                      >
                        Create maintenance
                      </Button>
                    ) : r.vehicleId ? (
                      <Link
                        href={`/fleet?view=vehicles&id=${encodeURIComponent(r.vehicleId)}`}
                        className="text-[12px] font-medium text-sky-700 hover:underline"
                      >
                        Open vehicle
                      </Link>
                    ) : r.driverId ? (
                      <Link
                        href={`/fleet?view=drivers&id=${encodeURIComponent(r.driverId)}`}
                        className="text-[12px] font-medium text-sky-700 hover:underline"
                      >
                        Open driver
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
