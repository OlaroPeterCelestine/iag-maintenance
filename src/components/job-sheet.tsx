"use client";

/**
 * One printed maintenance job sheet (A4 portrait). What the system knows is
 * printed at the top; everything below is boxes for the technician, in the
 * order the "Enter results" screen asks for them. The QR code opens that
 * screen for this job.
 */
import { FAILURE_CAUSES, FAILURE_PROBLEMS, FAILURE_REMEDIES } from "@/lib/iag/records/failure-catalog";
import type { SheetModel } from "@/lib/maintenance/job-sheet";
import { qrSvg } from "@/lib/maintenance/qr";

const box = "inline-block h-3 w-3 shrink-0 border border-black align-middle";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-2 break-inside-avoid border border-black">
      <h3 className="border-b border-black bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide print:bg-neutral-100">
        {title}
      </h3>
      <div className="px-2 py-1">{children}</div>
    </section>
  );
}

function Lines({ n }: { n: number }) {
  return (
    <div>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-5 border-b border-neutral-400" />
      ))}
    </div>
  );
}

function Ticks({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mb-1">
      <p className="text-[9px] font-bold uppercase">{label} — tick one</p>
      <div className="grid grid-cols-3 gap-x-2 gap-y-0.5">
        {items.map((it) => (
          <span key={it} className="flex items-center gap-1 text-[9px]">
            <span className={box} />
            {it === "Other" ? "Other: ____________" : it}
          </span>
        ))}
      </div>
    </div>
  );
}

function Grid({ head, rows, widths }: { head: string[]; rows: number; widths: string[] }) {
  return (
    <table className="w-full border-collapse text-[9px]">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} className="border border-black px-1 py-0.5 text-left font-bold" style={{ width: widths[i] }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            {head.map((h) => (
              <td key={h} className="h-5 border border-black" />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function JobSheet({ sheet, enterHref, printedOn }: { sheet: SheetModel; enterHref: string; printedOn: string }) {
  return (
    <article className="job-sheet mx-auto mb-6 w-full max-w-[190mm] bg-white p-1 text-black print:mb-0">
      <header className="flex gap-3 border-2 border-black p-2">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-widest">Maintenance job sheet</p>
          <p className="text-xl font-bold leading-tight">{sheet.num}</p>
          <p className="text-[13px] font-semibold leading-tight">{sheet.title}</p>
          <p className="mt-0.5 text-[10px]">
            {[sheet.type, sheet.priority && `${sheet.priority} priority`].filter(Boolean).join(" · ")}
          </p>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 text-[10px]">
            <div className="col-span-2">
              <dt className="inline font-bold">Machine: </dt>
              <dd className="inline">{sheet.machineLine}</dd>
            </div>
            <div>
              <dt className="inline font-bold">Assigned: </dt>
              <dd className="inline">{sheet.assignee || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-bold">Planned: </dt>
              <dd className="inline">{sheet.planned || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-bold">Due: </dt>
              <dd className="inline">{sheet.due || "—"}</dd>
            </div>
            <div>
              <dt className="inline font-bold">Raised: </dt>
              <dd className="inline">
                {sheet.raised || "—"}
                {sheet.reportedBy ? ` by ${sheet.reportedBy}` : ""}
              </dd>
            </div>
            {sheet.estimatedHours ? (
              <div>
                <dt className="inline font-bold">Estimate: </dt>
                <dd className="inline">{sheet.estimatedHours} h</dd>
              </div>
            ) : null}
            {sheet.partsPlanned ? (
              <div className="col-span-2">
                <dt className="inline font-bold">Parts planned: </dt>
                <dd className="inline">{sheet.partsPlanned}</dd>
              </div>
            ) : null}
          </dl>
          {sheet.description ? <p className="mt-1 text-[10px] italic">{sheet.description}</p> : null}
          {sheet.notApproved ? (
            <p className="mt-1 border border-black px-1 text-[10px] font-bold">NOT APPROVED — do not start this work.</p>
          ) : null}
        </div>
        <div className="flex w-24 shrink-0 flex-col items-center">
          <div className="h-24 w-24" role="img" aria-label={`QR code to enter results for ${sheet.num}`} dangerouslySetInnerHTML={{ __html: qrSvg(enterHref, { cellSize: 3, margin: 1 }) }} />
          <p className="mt-0.5 text-center text-[8px] leading-tight">Scan to enter results</p>
        </div>
      </header>

      {sheet.steps.length ? (
        <Section title="Checklist — tick one per step; a fail needs a note">
          <table className="w-full border-collapse text-[9px]">
            <thead>
              <tr>
                {["#", "Step", "Pass", "Fail", "N/A", "Reading", "Note"].map((h) => (
                  <th key={h} className="border border-black px-1 py-0.5 text-left font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.steps.map((step, i) => (
                <tr key={i}>
                  <td className="w-5 border border-black px-1">{i + 1}</td>
                  <td className="border border-black px-1">{step}</td>
                  {[0, 1, 2].map((k) => (
                    <td key={k} className="w-7 border border-black text-center">
                      <span className={box} />
                    </td>
                  ))}
                  <td className="w-16 border border-black" />
                  <td className="w-28 border border-black" />
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <Section title="Work done">
        <Lines n={4} />
      </Section>

      {sheet.needsFailureCode ? (
        <Section title="What failed — needed to close a breakdown or corrective job">
          <Ticks label="Problem" items={FAILURE_PROBLEMS} />
          <Ticks label="Cause" items={FAILURE_CAUSES} />
          <Ticks label="Fix" items={FAILURE_REMEDIES} />
        </Section>
      ) : null}

      <Section title="Parts used — from the stores">
        <Grid head={["Part code", "Description", "Qty", "Taken from (bin)"]} rows={4} widths={["22%", "48%", "10%", "20%"]} />
      </Section>

      <Section title="Labour — one line per technician per day">
        <Grid head={["Technician", "Date", "Start", "Finish", "Hours"]} rows={3} widths={["40%", "18%", "14%", "14%", "14%"]} />
      </Section>

      <Section title="Readings and how the machine was left">
        <div className="grid grid-cols-2 gap-x-3 text-[10px]">
          <p>Running-hours meter at finish: ______________ h</p>
          <p>Contractor cost: ______________</p>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-3 text-[10px]">
          <span className="font-bold">Machine left:</span>
          {["Running", "Stopped", "Needs follow-up"].map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={box} />
              {s}
            </span>
          ))}
        </p>
        <p className="mt-1 text-[10px]">Follow-up needed: ________________________________________________</p>
      </Section>

      <Section title="Sign-off">
        <div className="grid grid-cols-2 gap-x-4 text-[10px]">
          <div>
            <p className="font-bold">Technician (did the work)</p>
            <p className="mt-2">Name ____________________________</p>
            <p className="mt-2">Signature __________________ Date ________</p>
          </div>
          <div>
            <p className="font-bold">Supervisor (checked the work)</p>
            <p className="mt-2">Name ____________________________</p>
            <p className="mt-2">Signature __________________ Date ________</p>
          </div>
        </div>
      </Section>

      <p className="mt-1 text-[8px] text-neutral-600">
        Enter results: {enterHref} · Printed {printedOn}
      </p>
    </article>
  );
}
