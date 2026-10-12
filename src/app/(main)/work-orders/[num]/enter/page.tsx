"use client";

/**
 * Enter results from a printed job sheet — the page its QR code opens.
 *
 * Laid out in the sheet's order so a clerk reads down the paper and types
 * down the screen. One Save writes everything in the order MES needs
 * (src/lib/maintenance/enter-results.ts) and stops at the first refusal,
 * naming the section of the sheet; what was already saved stays saved, and
 * the next Save carries on from there.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Menu, Plus, Printer } from "lucide-react";
import { useAppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api-auth";
import { FAILURE_CAUSES, FAILURE_PROBLEMS, FAILURE_REMEDIES } from "@/lib/iag/records/failure-catalog";
import {
  checkResults,
  emptyForm,
  planWrites,
  type ResultsForm,
  type StepResult,
} from "@/lib/maintenance/enter-results";
import { FAILURE_CODED, stepsFrom } from "@/lib/maintenance/job-sheet";
import { todayIso } from "@/lib/maintenance/planner";
import { useRecordLists } from "@/lib/maintenance/use-record-lists";
import { cn } from "@/lib/utils";

const input =
  "h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900";

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <h2 className="mb-3 text-[13px] font-semibold text-slate-900 dark:text-slate-50">
        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[11px] text-white dark:bg-slate-100 dark:text-slate-900">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block text-[12px] text-slate-600 dark:text-slate-300", className)}>
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export default function EnterResultsPage() {
  const { openSidebar } = useAppShell();
  const num = decodeURIComponent(String(useParams<{ num: string }>()?.num || ""));
  const [refresh, setRefresh] = useState(0);
  const { data, loading, errors } = useRecordLists(
    ["work-orders", "checklist-steps", "batch-records", "parts-used", "spare-parts", "technicians"],
    refresh,
  );
  const wo = (data["work-orders"] || []).find((o) => String(o.num || o.id) === num);
  const card = (data["batch-records"] || []).find((c) => String(c.workOrder || c.id) === num);
  const marks = (data["checklist-steps"] || []).filter((s) => String(s.workOrder) === num);
  const booked = (data["parts-used"] || []).filter((p) => String(p.workOrder) === num);
  const steps = useMemo(() => stepsFrom(wo?.checklist), [wo?.checklist]);
  const today = todayIso();

  const [form, setForm] = useState<ResultsForm | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // Start from what is already recorded, once the job has loaded.
  useEffect(() => {
    if (!wo || form) return;
    const f = emptyForm(steps.length, today);
    marks.forEach((m) => {
      const i = Number(m.stepNo) - 1;
      if (f.steps[i]) f.steps[i] = { result: (m.result || "") as StepResult, reading: m.reading || "", note: m.note || "" };
    });
    f.failure = { problem: wo.failureProblem || "", cause: wo.failureCause || "", remedy: wo.failureRemedy || "", note: wo.failureNote || "" };
    if (card) {
      f.workDone = card.workDone || "";
      f.meterReading = card.meterReading || "";
      f.contractorCost = card.contractorCost || "";
      f.otherParts = card.partsUsed || "";
      f.machineLeft = (card.machineLeft || "") as ResultsForm["machineLeft"];
      f.followUp = card.followUp || "";
      try {
        const lines = JSON.parse(card.labour || "[]") as Record<string, unknown>[];
        if (lines.length) {
          f.labour = lines.map((l) => ({
            technician: String(l.technician || ""),
            date: String(l.date || today),
            start: String(l.start || ""),
            finish: String(l.finish || ""),
            hours: String(l.hours || ""),
          }));
        } else if (card.technician) {
          f.labour = [{ technician: card.technician, date: card.date || today, start: "", finish: "", hours: card.hours || "" }];
        }
      } catch {
        /* an older card without lines */
      }
    } else if (wo.assignee) {
      f.labour[0].technician = wo.assignee;
    }
    f.technicianSignedBy = wo.signedBy || "";
    f.supervisorCheckedBy = wo.checkedBy || "";
    f.complete = !/^completed$/i.test(String(wo.status || ""));
    setForm(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeded once per load
  }, [wo, card, steps.length]);

  const job = useMemo(
    () =>
      wo
        ? {
            num,
            title: String(wo.title || ""),
            machine: String(wo.workCenter || ""),
            needsFailureCode: FAILURE_CODED.test(String(wo.woType || "")),
            hasJobCard: Boolean(card),
            alreadyCompleted: /^completed$/i.test(String(wo.status || "")),
            today,
          }
        : null,
    [wo, card, num, today],
  );

  const set = (patch: Partial<ResultsForm>) => setForm((f) => (f ? { ...f, ...patch } : f));

  async function save() {
    if (!form || !job) return;
    const found = checkResults(form, job);
    setIssues(found);
    setResult(null);
    if (found.length) return;
    setSaving(true);
    const writes = planWrites(form, job);
    const nowDone = new Set(done);
    for (const w of writes) {
      if (nowDone.has(w.key)) continue;
      try {
        const res = await apiFetch(w.path, {
          method: w.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(w.body),
        });
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        nowDone.add(w.key);
        setDone(new Set(nowDone));
      } catch (err) {
        setSaving(false);
        setResult({
          tone: "error",
          text: `${w.section}: ${err instanceof Error ? err.message : "not saved"}. Everything before it is saved — correct this and Save again.`,
        });
        return;
      }
    }
    setSaving(false);
    setResult({ tone: "ok", text: `${num} saved${form.complete && !job.alreadyCompleted ? " and completed" : ""}.` });
    setRefresh((n) => n + 1);
  }

  const parts = data["spare-parts"] || [];
  const techs = (data.technicians || []).map((t) => String(t.name || "")).filter(Boolean);

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
            Enter results — {num}
            {wo?.title ? <span className="font-normal text-slate-500"> · {wo.title}</span> : null}
          </h1>
          <p className="truncate text-xs text-slate-500">
            {[wo?.workCenter, wo?.woType, wo?.status].filter(Boolean).join(" · ") || "Maintenance job sheet"}
          </p>
        </div>
        <Link
          href={`/work-orders/print?nums=${encodeURIComponent(num)}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] dark:border-slate-700"
        >
          <Printer size={14} /> Print sheet
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loading ? (
          <p className="text-[13px] text-slate-500">Loading {num}…</p>
        ) : !wo || !form || !job ? (
          <p className="text-[13px] text-slate-600">
            No maintenance work order {num}
            {errors["work-orders"] ? ` (${errors["work-orders"]})` : ""}.
          </p>
        ) : (
          <div className="mx-auto grid max-w-4xl gap-4">
            {steps.length ? (
              <Section n={1} title="Checklist">
                <Field label="Steps ticked by (name on the sheet — leave blank if it was the first technician)" className="mb-3 max-w-sm">
                  <input className={input} list="technician-names" value={form.markedBy} onChange={(e) => set({ markedBy: e.target.value })} />
                </Field>
                <div className="grid gap-2">
                  {steps.map((step, i) => {
                    const s = form.steps[i];
                    return (
                      <div key={i} className="grid items-center gap-2 rounded-lg border border-slate-100 p-2 sm:grid-cols-[1fr_auto_90px_1fr] dark:border-slate-800">
                        <span className="text-[13px] text-slate-800 dark:text-slate-100">
                          {i + 1}. {step}
                        </span>
                        <div className="flex gap-1" role="radiogroup" aria-label={`Step ${i + 1} result`}>
                          {(["Pass", "Fail", "N/A"] as StepResult[]).map((r) => (
                            <button
                              key={r}
                              type="button"
                              role="radio"
                              aria-checked={s.result === r}
                              disabled={job.alreadyCompleted}
                              onClick={() => {
                                const next = [...form.steps];
                                next[i] = { ...s, result: s.result === r ? "" : r };
                                set({ steps: next });
                              }}
                              className={cn(
                                "rounded-md border px-2 py-1 text-[12px]",
                                s.result === r
                                  ? r === "Fail"
                                    ? "border-rose-600 bg-rose-600 text-white"
                                    : "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                                  : "border-slate-300 dark:border-slate-700",
                              )}
                            >
                              {r}
                            </button>
                          ))}
                        </div>
                        <input
                          className={input}
                          placeholder="Reading"
                          inputMode="decimal"
                          value={s.reading}
                          onChange={(e) => {
                            const next = [...form.steps];
                            next[i] = { ...s, reading: e.target.value };
                            set({ steps: next });
                          }}
                        />
                        <input
                          className={input}
                          placeholder={s.result === "Fail" ? "What was found (needed)" : "Note"}
                          value={s.note}
                          onChange={(e) => {
                            const next = [...form.steps];
                            next[i] = { ...s, note: e.target.value };
                            set({ steps: next });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </Section>
            ) : null}

            <Section n={2} title="Work done">
              <textarea className={cn(input, "h-24 py-1")} value={form.workDone} onChange={(e) => set({ workDone: e.target.value })} />
            </Section>

            {job.needsFailureCode ? (
              <Section n={3} title="What failed">
                <div className="grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["problem", "Problem", FAILURE_PROBLEMS],
                      ["cause", "Cause", FAILURE_CAUSES],
                      ["remedy", "Fix", FAILURE_REMEDIES],
                    ] as const
                  ).map(([key, label, options]) => (
                    <Field key={key} label={label}>
                      <select
                        className={input}
                        value={form.failure[key]}
                        onChange={(e) => set({ failure: { ...form.failure, [key]: e.target.value } })}
                      >
                        <option value="">—</option>
                        {options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                </div>
                <Field label="What it was, if Other" className="mt-2">
                  <input className={input} value={form.failure.note} onChange={(e) => set({ failure: { ...form.failure, note: e.target.value } })} />
                </Field>
              </Section>
            ) : null}

            <Section n={4} title="Parts used — booked out of stock on save">
              {booked.length ? (
                <p className="mb-2 text-[12px] text-slate-500">
                  Already booked to {num}: {booked.map((b) => `${b.qty} × ${b.part}`).join(", ")}
                </p>
              ) : null}
              <div className="grid gap-2">
                {form.parts.map((p, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_90px_140px]">
                    <input
                      className={input}
                      list="spare-part-codes"
                      placeholder="Part code"
                      value={p.part}
                      onChange={(e) => {
                        const next = [...form.parts];
                        next[i] = { ...p, part: e.target.value };
                        set({ parts: next });
                      }}
                    />
                    <input
                      className={input}
                      placeholder="Qty"
                      inputMode="decimal"
                      value={p.qty}
                      onChange={(e) => {
                        const next = [...form.parts];
                        next[i] = { ...p, qty: e.target.value };
                        set({ parts: next });
                      }}
                    />
                    <input
                      className={input}
                      placeholder="Bin (optional)"
                      value={p.store}
                      onChange={(e) => {
                        const next = [...form.parts];
                        next[i] = { ...p, store: e.target.value };
                        set({ parts: next });
                      }}
                    />
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => set({ parts: [...form.parts, { part: "", qty: "", store: "" }] })} className="mt-2 inline-flex items-center gap-1 text-[12px] text-sky-700 dark:text-sky-400">
                <Plus size={13} /> Another part
              </button>
              <Field label="Other parts or materials not from the stores" className="mt-2">
                <input className={input} value={form.otherParts} onChange={(e) => set({ otherParts: e.target.value })} />
              </Field>
            </Section>

            <Section n={5} title="Labour">
              <div className="grid gap-2">
                {form.labour.map((l, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[1fr_140px_90px_90px_80px]">
                    {(
                      [
                        ["technician", "Technician", "text"],
                        ["date", "Date", "date"],
                        ["start", "Start", "time"],
                        ["finish", "Finish", "time"],
                        ["hours", "Hours", "text"],
                      ] as const
                    ).map(([key, ph, type]) => (
                      <input
                        key={key}
                        className={input}
                        type={type}
                        placeholder={ph}
                        aria-label={`Labour line ${i + 1} ${ph}`}
                        list={key === "technician" ? "technician-names" : undefined}
                        value={l[key]}
                        onChange={(e) => {
                          const next = [...form.labour];
                          next[i] = { ...l, [key]: e.target.value };
                          set({ labour: next });
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => set({ labour: [...form.labour, { technician: "", date: today, start: "", finish: "", hours: "" }] })}
                className="mt-2 inline-flex items-center gap-1 text-[12px] text-sky-700 dark:text-sky-400"
              >
                <Plus size={13} /> Another technician or day
              </button>
            </Section>

            <Section n={6} title="Readings and how the machine was left">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Running-hours meter at finish (h)">
                  <input className={input} inputMode="decimal" value={form.meterReading} onChange={(e) => set({ meterReading: e.target.value })} />
                </Field>
                <Field label="Contractor cost">
                  <input className={input} inputMode="decimal" value={form.contractorCost} onChange={(e) => set({ contractorCost: e.target.value })} />
                </Field>
                <Field label="Machine left">
                  <select
                    className={input}
                    value={form.machineLeft}
                    onChange={(e) => {
                      const v = e.target.value as ResultsForm["machineLeft"];
                      set({ machineLeft: v, complete: v === "Stopped" ? false : form.complete });
                    }}
                  >
                    <option value="">—</option>
                    <option>Running</option>
                    <option>Stopped</option>
                    <option>Needs follow-up</option>
                  </select>
                </Field>
              </div>
              {form.machineLeft === "Needs follow-up" ? (
                <Field label="Follow-up needed — a new corrective job is raised for it" className="mt-2">
                  <input className={input} value={form.followUp} onChange={(e) => set({ followUp: e.target.value })} />
                </Field>
              ) : null}
            </Section>

            <Section n={7} title="Sign-off — names and dates as written on the sheet">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid grid-cols-[1fr_150px] gap-2">
                  <Field label="Technician (did the work)">
                    <input className={input} list="technician-names" disabled={job.alreadyCompleted} value={form.technicianSignedBy} onChange={(e) => set({ technicianSignedBy: e.target.value })} />
                  </Field>
                  <Field label="Date">
                    <input className={input} type="date" disabled={job.alreadyCompleted} value={form.technicianSignedOn} onChange={(e) => set({ technicianSignedOn: e.target.value })} />
                  </Field>
                </div>
                <div className="grid grid-cols-[1fr_150px] gap-2">
                  <Field label="Supervisor (checked the work)">
                    <input className={input} value={form.supervisorCheckedBy} onChange={(e) => set({ supervisorCheckedBy: e.target.value })} />
                  </Field>
                  <Field label="Date">
                    <input className={input} type="date" value={form.supervisorCheckedOn} onChange={(e) => set({ supervisorCheckedOn: e.target.value })} />
                  </Field>
                </div>
              </div>
              {!job.alreadyCompleted ? (
                <label className="mt-3 flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={form.complete} onChange={(e) => set({ complete: e.target.checked })} />
                  Complete the work order
                </label>
              ) : (
                <p className="mt-3 text-[12px] text-slate-500">This job is already completed; only the supervisor&apos;s check can still be added.</p>
              )}
            </Section>

            {issues.length ? (
              <ul role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                {issues.map((t) => (
                  <li key={t}>• {t}</li>
                ))}
              </ul>
            ) : null}
            {result ? (
              <p
                role="status"
                className={cn(
                  "rounded-lg border px-4 py-2 text-[13px]",
                  result.tone === "ok"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                    : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200",
                )}
              >
                {result.text}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pb-6">
              <Link href="/production?view=work-orders" className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] dark:border-slate-700">
                Back to work orders
              </Link>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-lg bg-black px-4 py-2 text-[13px] font-medium text-white hover:bg-zinc-800 disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save results"}
              </button>
            </div>
          </div>
        )}
      </div>
      <datalist id="technician-names">
        {techs.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="spare-part-codes">
        {parts.map((p) => (
          <option key={String(p.code)} value={String(p.code)}>
            {p.name}
          </option>
        ))}
      </datalist>
    </div>
  );
}
