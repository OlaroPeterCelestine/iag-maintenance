"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  Sparkles,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  analyzeTrial,
  askRdQuestion,
  costOutlook,
  mlHealth,
  predictRoastLoss,
  recommendNextTest,
  scoreQcRisk,
  simulateProductDevelopment,
  type MlProductDevSimulation,
} from "@/lib/ml-api";
import { cn } from "@/lib/utils";

type TabId = "full" | "trial" | "roast" | "qc" | "cost" | "next" | "ask";

const TABS: { id: TabId; label: string }[] = [
  { id: "full", label: "Full stage-gate" },
  { id: "trial", label: "Trial" },
  { id: "roast", label: "Roast loss" },
  { id: "qc", label: "QC risk" },
  { id: "cost", label: "Cost" },
  { id: "next", label: "Next test" },
  { id: "ask", label: "Ask AI" },
];

const DEFAULTS = {
  product: "House Blend 250g",
  hypothesis: "Slightly darker roast improves body without raising roast loss above 16%",
  variable: "End temperature +3°C",
  control_score: "82",
  trial_score: "84.5",
  yield_percent: "97",
  unit_cost: "9200",
  target_cost: "9500",
  defects: "none",
  input_weight_kg: "12",
  charge_temperature_c: "198",
  end_temperature_c: "214",
  roast_time_min: "11.5",
  moisture_percent: "11.2",
  process: "washed",
  material_cost: "85000",
  labour_cost: "12000",
  energy_cost: "3500",
  packaging_cost: "9000",
  waste_percent: "3",
  target_price: "18000",
  planned_units: "40",
  min_cupping: "80",
  moisture_max: "12.5",
  roast_loss_max: "18",
  roast_loss_percent: "15.8",
  target_margin_percent: "20",
  question: "When is a coffee trial ready for a pilot batch?",
};

function num(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 border-slate-200 bg-white text-[13px] shadow-none"
      />
    </label>
  );
}

export function ProductDevelopmentSimulationsPanel() {
  const [tab, setTab] = useState<TabId>("full");
  const [form, setForm] = useState(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");
  const [simulation, setSimulation] = useState<MlProductDevSimulation | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; label: string }>({
    ok: false,
    label: "Checking ML…",
  });

  useEffect(() => {
    let cancelled = false;
    void mlHealth()
      .then((res) => {
        if (cancelled) return;
        setHealth({
          ok: Boolean(res.ok),
          label: res.ok
            ? `${res.service} v${res.version} online`
            : "ML health returned not ok",
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setHealth({
          ok: false,
          label:
            err instanceof Error
              ? err.message
              : "ML unreachable — run npm run ml:dev",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function set(key: keyof typeof DEFAULTS, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function run() {
    setBusy(true);
    setError("");
    setOutput("");
    setSimulation(null);
    try {
      if (tab === "full") {
        const result = await simulateProductDevelopment({
          product: form.product,
          hypothesis: form.hypothesis,
          variable: form.variable,
          control_score: num(form.control_score),
          trial_score: num(form.trial_score),
          yield_percent: num(form.yield_percent),
          unit_cost: num(form.unit_cost),
          target_cost: num(form.target_cost),
          defects: form.defects,
          input_weight_kg: num(form.input_weight_kg),
          charge_temperature_c: num(form.charge_temperature_c),
          end_temperature_c: num(form.end_temperature_c),
          roast_time_min: num(form.roast_time_min),
          moisture_percent: num(form.moisture_percent),
          process: form.process,
          material_cost: num(form.material_cost) ?? 0,
          labour_cost: num(form.labour_cost),
          energy_cost: num(form.energy_cost),
          packaging_cost: num(form.packaging_cost),
          waste_percent: num(form.waste_percent),
          target_price: num(form.target_price),
          planned_units: num(form.planned_units),
          min_cupping: num(form.min_cupping),
          moisture_max: num(form.moisture_max),
          roast_loss_max: num(form.roast_loss_max),
          target_margin_percent: num(form.target_margin_percent),
        });
        setSimulation(result);
        setOutput(
          `${result.overall}\n${result.overall_detail}\n\nGates ${result.gates_passed}/${result.gates_total}\n` +
            result.gates.map((g) => `• ${g.stage}: ${g.status} (${g.detail})`).join("\n") +
            `\n\nNext tests:\n` +
            result.next_test.recommended_tests.map((s) => `• ${s}`).join("\n"),
        );
      } else if (tab === "trial") {
        const result = await analyzeTrial({
          product: form.product,
          hypothesis: form.hypothesis,
          variable: form.variable,
          control_score: num(form.control_score),
          trial_score: num(form.trial_score),
          yield_percent: num(form.yield_percent),
          unit_cost: num(form.unit_cost),
          target_cost: num(form.target_cost),
          defects: form.defects,
        });
        setOutput(
          `${result.verdict} (${result.confidence}% confidence)\n` +
            result.signals.map((s) => `• ${s}`).join("\n") +
            "\n\nNext:\n" +
            result.recommended_actions.map((s) => `• ${s}`).join("\n"),
        );
      } else if (tab === "roast") {
        const result = await predictRoastLoss({
          input_weight_kg: num(form.input_weight_kg) ?? 12,
          charge_temperature_c: num(form.charge_temperature_c) ?? 198,
          end_temperature_c: num(form.end_temperature_c) ?? 214,
          roast_time_min: num(form.roast_time_min) ?? 11.5,
          moisture_percent: num(form.moisture_percent),
          process: form.process,
        });
        setOutput(
          `Predicted roast loss ${result.predicted_roast_loss_percent}% → ~${result.predicted_output_kg} kg output\n` +
            `Range ${result.expected_range_percent[0]}–${result.expected_range_percent[1]}%\n\n` +
            result.guidance.map((s) => `• ${s}`).join("\n"),
        );
      } else if (tab === "qc") {
        const result = await scoreQcRisk({
          cupping_score: num(form.trial_score),
          moisture_percent: num(form.moisture_percent),
          roast_loss_percent: num(form.roast_loss_percent),
          defects: form.defects,
          min_cupping: num(form.min_cupping),
          moisture_max: num(form.moisture_max),
          roast_loss_max: num(form.roast_loss_max),
        });
        setOutput(
          `${result.disposition} (risk ${result.risk_score})\n` +
            result.reasons.map((s) => `• ${s}`).join("\n") +
            "\n\nActions:\n" +
            result.recommended_actions.map((s) => `• ${s}`).join("\n"),
        );
      } else if (tab === "cost") {
        const result = await costOutlook({
          material_cost: num(form.material_cost) ?? 0,
          labour_cost: num(form.labour_cost),
          energy_cost: num(form.energy_cost),
          packaging_cost: num(form.packaging_cost),
          waste_percent: num(form.waste_percent),
          target_price: num(form.target_price),
          planned_units: num(form.planned_units),
        });
        setOutput(
          `Total ${result.total_cost} · Unit ${result.unit_cost}` +
            (result.margin_percent != null
              ? ` · Margin ${result.margin_percent}%${result.margin_healthy ? " (healthy)" : ""}`
              : "") +
            "\n\n" +
            result.guidance.map((s) => `• ${s}`).join("\n"),
        );
      } else if (tab === "next") {
        const result = await recommendNextTest({
          product: form.product,
          last_result: "Needs retest",
          last_variable: form.variable,
          cupping_score: num(form.trial_score),
          roast_loss_percent: num(form.roast_loss_percent),
          unit_cost: num(form.unit_cost),
          target_margin_percent: num(form.target_margin_percent),
        });
        setOutput(
          `Priority: ${result.priority}\n${result.suggested_experiment_title}\n\n` +
            result.recommended_tests.map((s) => `• ${s}`).join("\n"),
        );
      } else {
        const result = await askRdQuestion(form.question);
        setOutput(
          `${result.answer}\n\nConfidence ${result.confidence}%` +
            (result.matched_topic ? ` · ${result.matched_topic}` : ""),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white px-3 py-1 text-[11px] font-semibold text-orange-700">
              <FlaskConical size={13} />
              Product development simulations
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">
              Run ML stage-gates before you scale a recipe.
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
              Simulate trial verdicts, roast loss, QC disposition, unit cost, and the next
              controlled test. Save outputs under R&amp;D → AI Insights.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium",
                health.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800",
              )}
            >
              <Sparkles size={12} />
              {health.label}
            </span>
            <Link
              href="/rnd?view=ai-insights"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
            >
              AI Insights <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
              tab === item.id
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(tab === "full" || tab === "trial" || tab === "next") && (
            <>
              <Field label="Product / SKU" value={form.product} onChange={(v) => set("product", v)} />
              <Field label="Hypothesis" value={form.hypothesis} onChange={(v) => set("hypothesis", v)} />
              <Field label="Changed variable" value={form.variable} onChange={(v) => set("variable", v)} />
            </>
          )}
          {(tab === "full" || tab === "trial" || tab === "qc" || tab === "next") && (
            <>
              <Field label="Control score" value={form.control_score} onChange={(v) => set("control_score", v)} type="number" />
              <Field label="Trial / cupping score" value={form.trial_score} onChange={(v) => set("trial_score", v)} type="number" />
              <Field label="Yield %" value={form.yield_percent} onChange={(v) => set("yield_percent", v)} type="number" />
            </>
          )}
          {(tab === "full" || tab === "trial") && (
            <>
              <Field label="Unit cost" value={form.unit_cost} onChange={(v) => set("unit_cost", v)} type="number" />
              <Field label="Target cost" value={form.target_cost} onChange={(v) => set("target_cost", v)} type="number" />
              <Field label="Defects" value={form.defects} onChange={(v) => set("defects", v)} />
            </>
          )}
          {(tab === "full" || tab === "roast" || tab === "qc") && (
            <>
              <Field label="Green input kg" value={form.input_weight_kg} onChange={(v) => set("input_weight_kg", v)} type="number" />
              <Field label="Charge °C" value={form.charge_temperature_c} onChange={(v) => set("charge_temperature_c", v)} type="number" />
              <Field label="End °C" value={form.end_temperature_c} onChange={(v) => set("end_temperature_c", v)} type="number" />
              <Field label="Roast time (min)" value={form.roast_time_min} onChange={(v) => set("roast_time_min", v)} type="number" />
              <Field label="Moisture %" value={form.moisture_percent} onChange={(v) => set("moisture_percent", v)} type="number" />
              <Field label="Process" value={form.process} onChange={(v) => set("process", v)} />
            </>
          )}
          {(tab === "full" || tab === "qc" || tab === "next") && (
            <>
              {tab !== "next" ? (
                <>
                  <Field label="Min cupping" value={form.min_cupping} onChange={(v) => set("min_cupping", v)} type="number" />
                  <Field label="Moisture max %" value={form.moisture_max} onChange={(v) => set("moisture_max", v)} type="number" />
                  <Field label="Roast loss max %" value={form.roast_loss_max} onChange={(v) => set("roast_loss_max", v)} type="number" />
                </>
              ) : null}
              {tab === "qc" || tab === "next" ? (
                <Field
                  label="Roast loss %"
                  value={form.roast_loss_percent}
                  onChange={(v) => set("roast_loss_percent", v)}
                  type="number"
                />
              ) : null}
              {tab === "qc" ? (
                <Field label="Defects" value={form.defects} onChange={(v) => set("defects", v)} />
              ) : null}
            </>
          )}
          {(tab === "full" || tab === "cost" || tab === "next") && (
            <>
              <Field label="Material cost" value={form.material_cost} onChange={(v) => set("material_cost", v)} type="number" />
              <Field label="Labour cost" value={form.labour_cost} onChange={(v) => set("labour_cost", v)} type="number" />
              <Field label="Energy cost" value={form.energy_cost} onChange={(v) => set("energy_cost", v)} type="number" />
              <Field label="Packaging cost" value={form.packaging_cost} onChange={(v) => set("packaging_cost", v)} type="number" />
              <Field label="Waste %" value={form.waste_percent} onChange={(v) => set("waste_percent", v)} type="number" />
              <Field label="Target price / unit" value={form.target_price} onChange={(v) => set("target_price", v)} type="number" />
              <Field label="Planned units" value={form.planned_units} onChange={(v) => set("planned_units", v)} type="number" />
              <Field label="Target margin %" value={form.target_margin_percent} onChange={(v) => set("target_margin_percent", v)} type="number" />
            </>
          )}
          {tab === "ask" && (
            <div className="sm:col-span-2 lg:col-span-3">
              <Field label="Question" value={form.question} onChange={(v) => set("question", v)} />
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy || !health.ok} onClick={() => void run()}>
            {busy ? "Running…" : tab === "full" ? "Run full simulation" : "Run"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setForm(DEFAULTS);
              setOutput("");
              setSimulation(null);
              setError("");
            }}
          >
            Reset sample inputs
          </Button>
          {!health.ok ? (
            <p className="text-[12px] text-rose-600">
              Start the ML service with <code className="rounded bg-rose-50 px-1">npm run ml:dev</code>
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            {error}
          </p>
        ) : null}

        {simulation ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {simulation.gates.map((gate) => (
              <div
                key={gate.stage}
                className={cn(
                  "rounded-lg border px-3 py-2.5",
                  gate.pass
                    ? "border-emerald-200 bg-emerald-50/70"
                    : "border-amber-200 bg-amber-50/70",
                )}
              >
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-900">
                  {gate.pass ? (
                    <CheckCircle2 size={14} className="text-emerald-600" />
                  ) : (
                    <XCircle size={14} className="text-amber-600" />
                  )}
                  {gate.stage}
                </div>
                <p className="mt-1 text-[11px] text-slate-600">{gate.status}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{gate.detail}</p>
              </div>
            ))}
          </div>
        ) : null}

        {output ? (
          <pre className="mt-4 whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700">
            {output}
          </pre>
        ) : null}
      </section>
    </div>
  );
}
