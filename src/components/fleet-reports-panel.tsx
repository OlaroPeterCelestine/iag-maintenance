"use client";

import { useMemo, useState } from "react";
import { ChartSquare, TruckFast } from "iconsax-react";
import { fleetCostByVehicle } from "@/lib/fleet-ops";
import { formatMoney } from "@/lib/ledger/money";
import { useRecordsSyncTick } from "@/hooks/use-records-sync-tick";

export function FleetReportsPanel() {
  const [q, setQ] = useState("");
  const { tick } = useRecordsSyncTick([
    { module: "fleet", entity: "vehicles" },
    { module: "assets", entity: "fixed-assets" },
    { module: "fleet", entity: "fuel-logs" },
    { module: "fleet", entity: "maintenance-requests" },
    { module: "fleet", entity: "trip-requests" },
  ]);
  const rows = useMemo(() => fleetCostByVehicle(), [tick]);
  const filtered = rows.filter(
    (r) =>
      !q.trim() ||
      r.vehicle.toLowerCase().includes(q.trim().toLowerCase()) ||
      r.registration.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const totals = filtered.reduce(
    (acc, r) => ({
      fuel: acc.fuel + r.fuelSpend,
      maint: acc.maint + r.maintenanceSpend,
      litres: acc.litres + r.litres,
    }),
    { fuel: 0, maint: 0, litres: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
              <ChartSquare size={20} variant="Bold" color="currentColor" />
            </div>
            <div>
              <h2 className="text-[16px] font-semibold text-slate-900">Fleet cost report</h2>
              <p className="mt-0.5 text-[13px] text-slate-500">
                Fuel spend, litres, km/L, and maintenance cost by vehicle.
              </p>
            </div>
          </div>
          <input
            className="h-9 w-full max-w-xs rounded-lg border border-slate-200 px-3 text-[13px]"
            placeholder="Filter vehicle…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Fuel spend</p>
            <p className="text-[15px] font-semibold text-slate-900">
              {formatMoney(totals.fuel, true)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Maintenance</p>
            <p className="text-[15px] font-semibold text-slate-900">
              {formatMoney(totals.maint, true)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Litres logged</p>
            <p className="text-[15px] font-semibold text-slate-900">{totals.litres || 0}</p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="border-b border-slate-100 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Vehicle</th>
              <th className="px-4 py-2.5 font-semibold">Plate</th>
              <th className="px-4 py-2.5 font-semibold text-right">Odometer</th>
              <th className="px-4 py-2.5 font-semibold text-right">Litres</th>
              <th className="px-4 py-2.5 font-semibold text-right">km/L</th>
              <th className="px-4 py-2.5 font-semibold text-right">Fuel</th>
              <th className="px-4 py-2.5 font-semibold text-right">Maintenance</th>
              <th className="px-4 py-2.5 font-semibold text-right">Trips</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                    <TruckFast size={28} variant="Bold" color="#94a3b8" />
                    <p>No fleet cost data yet. Add vehicles and post fuel or maintenance.</p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.vehicle} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-slate-900">{row.vehicle}</td>
                  <td className="px-4 py-2.5 text-slate-600">{row.registration || "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {row.odometer ? row.odometer.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {row.litres || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {row.kmPerLitre != null ? row.kmPerLitre : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                    {formatMoney(row.fuelSpend, true)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
                    {formatMoney(row.maintenanceSpend, true)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {row.trips}
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
