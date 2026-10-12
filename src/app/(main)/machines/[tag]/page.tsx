"use client";

/**
 * One machine, on one page — what a QR label on the machine opens.
 *
 * Someone standing at the machine wants three things: is anything already
 * being done about it, how do I report what I see, and what has happened to
 * it before. So the page leads with the actions and the open work, then the
 * nameplate, then the history. It is laid out for a phone first.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { Menu } from "lucide-react";
import { useAppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";
import {
  forMachine,
  isOpen,
  newestFirst,
  partsOf,
  warrantyState,
  yearToDateCost,
  type Rec,
} from "@/lib/maintenance/machine-summary";
import { useRecordLists } from "@/lib/maintenance/use-record-lists";

const ENTITIES = [
  "work-centers",
  "work-orders",
  "fault-reports",
  "pm-schedules",
  "downtime-logs",
  "machine-costs",
];

function Section({ title, children, empty }: { title: string; children?: React.ReactNode; empty?: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <h2 className="border-b border-slate-100 px-4 py-2.5 text-[13px] font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-50">
        {title}
      </h2>
      <div className="px-4 py-3 text-[13px] text-slate-700 dark:text-slate-300">
        {children || <p className="text-slate-500">{empty || "Nothing yet."}</p>}
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-800 dark:text-slate-100">{value}</dd>
    </div>
  );
}

function ListLines({ rows, render }: { rows: Rec[]; render: (r: Rec) => React.ReactNode }) {
  return <ul className="divide-y divide-slate-100 dark:divide-slate-800">{rows.map((r) => <li key={r.id} className="py-2">{render(r)}</li>)}</ul>;
}

export default function MachinePage() {
  const { openSidebar } = useAppShell();
  const params = useParams<{ tag: string }>();
  const tag = decodeURIComponent(String(params?.tag || ""));
  const { data, errors, loading } = useRecordLists(ENTITIES);

  const machine = (data["work-centers"] || []).find(
    (m) => String(m.code || m.id || "").toLowerCase() === tag.toLowerCase(),
  );
  const orders = newestFirst(forMachine(data["work-orders"] || [], tag));
  const openOrders = orders.filter(isOpen);
  const doneOrders = orders.filter((o) => !isOpen(o)).slice(0, 10);
  const reports = newestFirst(forMachine(data["fault-reports"] || [], tag));
  const openReports = reports.filter((r) => /^(new|seen)$/i.test(String(r.status || "")));
  const schedules = forMachine(data["pm-schedules"] || [], tag);
  const downtime = newestFirst(forMachine(data["downtime-logs"] || [], tag)).slice(0, 8);
  const parts = partsOf(data["work-centers"] || [], tag);
  const year = new Date().getFullYear();
  const cost = yearToDateCost(data["machine-costs"] || [], tag, year);
  const warranty = warrantyState(machine?.warrantyUntil);
  const q = encodeURIComponent(tag);
  const stopped = /down|maintenance/i.test(String(machine?.status || ""));

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
            {machine?.name || tag}
            <span className="ml-2 font-normal text-slate-500">{tag}</span>
          </h1>
          <p className="truncate text-xs text-slate-500">
            {[machine?.plantCode, machine?.section, machine?.location].filter(Boolean).join(" · ") || "Machine"}
          </p>
        </div>
        {machine?.status ? (
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[12px] font-medium",
              stopped
                ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
            )}
          >
            {stopped ? "⚠ " : ""}
            {machine.status}
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <p className="text-[13px] text-slate-500">Loading {tag}…</p>
        ) : !machine ? (
          <p className="text-[13px] text-slate-600">
            No machine {tag} in the register{errors["work-centers"] ? ` (${errors["work-centers"]})` : ""}.{" "}
            <Link className="text-sky-700 underline" href="/production?view=work-centers">
              Machines
            </Link>
          </p>
        ) : (
          <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
            <div className="flex flex-wrap gap-2 lg:col-span-2">
              <Link
                href={`/production?view=fault-reports&new=1&machine=${q}`}
                className="rounded-lg bg-black px-3.5 py-2 text-[13px] font-medium text-white hover:bg-zinc-800"
              >
                Report a fault
              </Link>
              <Link
                href={`/production?view=meter-readings&new=1&machine=${q}`}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Record running hours
              </Link>
              <Link
                href={`/production?view=work-orders&new=1&machine=${q}`}
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Raise a work order
              </Link>
            </div>

            <Section title={`Open work (${openOrders.length + openReports.length})`} empty="Nothing open on this machine.">
              {openOrders.length + openReports.length ? (
                <ListLines
                  rows={[...openReports, ...openOrders]}
                  render={(r) => (
                    <div className="flex justify-between gap-3">
                      <span>
                        <span className="font-medium text-slate-900 dark:text-slate-50">{r.num || r.title}</span>
                        {r.num ? <span className="text-slate-500"> — {r.title}</span> : <span className="text-slate-500"> (fault report)</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-slate-500">
                        {r.status}
                        {r.num ? (
                          <>
                            <Link className="text-sky-700 underline dark:text-sky-400" href={`/work-orders/print?nums=${encodeURIComponent(String(r.num))}`}>
                              Print
                            </Link>
                            <Link className="text-sky-700 underline dark:text-sky-400" href={`/work-orders/${encodeURIComponent(String(r.num))}/enter`}>
                              Enter results
                            </Link>
                          </>
                        ) : null}
                      </span>
                    </div>
                  )}
                />
              ) : null}
            </Section>

            <Section title="About this machine">
              <dl>
                <Row label="Type" value={machine.type} />
                <Row label="Criticality" value={machine.criticality} />
                <Row label="Manufacturer" value={machine.manufacturer} />
                <Row label="Model" value={machine.model} />
                <Row label="Serial number" value={machine.serialNumber} />
                <Row label="Installed on" value={machine.installedOn} />
                <Row
                  label="Warranty until"
                  value={machine.warrantyUntil ? `${machine.warrantyUntil}${warranty ? ` — ${warranty}` : ""}` : undefined}
                />
                <Row label="Part of" value={machine.parentMachine} />
                <Row label="Its parts" value={parts.map((p) => p.code || p.name).join(", ")} />
                <Row label="Responsible technician" value={machine.supervisor} />
                <Row
                  label={`Maintenance cost ${year}`}
                  value={
                    errors["machine-costs"]
                      ? undefined
                      : `${Math.round(cost.total).toLocaleString("en-US")}${cost.complete ? "" : " (incomplete — see Machine Costs)"}`
                  }
                />
              </dl>
            </Section>

            <Section title="Preventive maintenance" empty="No PM schedule on this machine.">
              {schedules.length ? (
                <ListLines
                  rows={schedules}
                  render={(s) => (
                    <div className="flex justify-between gap-3">
                      <span>{s.templateName || s.template}</span>
                      <span className="shrink-0 text-slate-500">
                        due {s.nextDue || "—"}
                        {s.hoursUsed ? ` · ${s.hoursUsed}` : ""} · {s.status}
                      </span>
                    </div>
                  )}
                />
              ) : null}
            </Section>

            <Section title="Recent downtime" empty="No downtime recorded.">
              {downtime.length ? (
                <ListLines
                  rows={downtime}
                  render={(d) => (
                    <div className="flex justify-between gap-3">
                      <span>{d.reason || d.category}</span>
                      <span className="shrink-0 text-slate-500">
                        {d.date} {d.minutes ? `· ${d.minutes} min` : ""} · {d.status}
                      </span>
                    </div>
                  )}
                />
              ) : null}
            </Section>

            <div className="lg:col-span-2">
              <Section title="History" empty="No completed work yet.">
                {doneOrders.length ? (
                  <ListLines
                    rows={doneOrders}
                    render={(o) => (
                      <div className="flex flex-wrap justify-between gap-x-3">
                        <span>
                          <span className="font-medium text-slate-900 dark:text-slate-50">{o.num}</span>
                          <span className="text-slate-500"> — {o.title}</span>
                        </span>
                        <span className="text-slate-500">
                          {o.completedOn || o.date}
                          {o.failureProblem ? ` · ${o.failureProblem} / ${o.failureCause}` : ""}
                        </span>
                      </div>
                    )}
                  />
                ) : null}
              </Section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
