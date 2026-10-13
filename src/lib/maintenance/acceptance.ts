/**
 * Acceptance limits on a checklist step — what a commissioning test is
 * measured against.
 *
 * In a checklist textarea a step carries its limits in square brackets at the
 * end of the line, the way an engineer writes them:
 *
 *   Motor current at full load [10–14 A]
 *   Bearing temperature after 1 h [max 70 °C]
 *   Output at rated speed [min 1200 kg/h]
 *
 * iag-mes stores the step as {step, min, max, unit} and refuses a pass whose
 * reading is outside them; the printed sheet shows the limits beside the test
 * and the Enter results screen checks the reading before it is sent.
 */

export type StepLimits = { min?: number; max?: number; unit?: string };
export type ParsedStep = { text: string; limits: StepLimits | null };

const NUM = "(-?\\d+(?:\\.\\d+)?)";
const RANGE = new RegExp(`^${NUM}\\s*(?:–|—|-|to)\\s*${NUM}\\s*(.*)$`, "i");
const AT_MOST = new RegExp(`^(?:≤|<=|<|max(?:imum)?|at most|up to)\\s*${NUM}\\s*(.*)$`, "i");
const AT_LEAST = new RegExp(`^(?:≥|>=|>|min(?:imum)?|at least)\\s*${NUM}\\s*(.*)$`, "i");

function limitsOf(inside: string): StepLimits | null {
  const s = inside.trim();
  let m = RANGE.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return { min: Math.min(a, b), max: Math.max(a, b), unit: m[3].trim() || undefined };
  }
  m = AT_MOST.exec(s);
  if (m) return { max: Number(m[1]), unit: m[2].trim() || undefined };
  m = AT_LEAST.exec(s);
  if (m) return { min: Number(m[1]), unit: m[2].trim() || undefined };
  return null;
}

/** A checklist line, split into the test and its limits (if any). */
export function parseStep(line: string): ParsedStep {
  const text = String(line || "").trim();
  const m = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(text);
  if (!m || !m[1].trim()) return { text, limits: null };
  const limits = limitsOf(m[2]);
  return limits ? { text: m[1].trim(), limits } : { text, limits: null };
}

/** The limits as an engineer reads them: "10–14 A", "max 70 °C". */
export function formatLimits(l: StepLimits | null | undefined): string {
  if (!l) return "";
  const unit = l.unit ? ` ${l.unit}` : "";
  if (l.min !== undefined && l.max !== undefined) return `${l.min}–${l.max}${unit}`;
  if (l.max !== undefined) return `max ${l.max}${unit}`;
  if (l.min !== undefined) return `min ${l.min}${unit}`;
  return "";
}

/** A step back as a checklist line. */
export function formatStep(text: string, limits: StepLimits | null | undefined): string {
  const l = formatLimits(limits);
  return l ? `${text} [${l}]` : text;
}

/** Whether a reading is within the limits. No limits: always. */
export function withinLimits(reading: number, l: StepLimits | null | undefined): boolean {
  if (!l) return true;
  return (l.min === undefined || reading >= l.min) && (l.max === undefined || reading <= l.max);
}

/** The step as iag-mes stores it: a string, or {step, min, max, unit}. */
export function stepForService(line: string): string | Record<string, unknown> {
  const { text, limits } = parseStep(line);
  if (!limits) return text;
  const out: Record<string, unknown> = { step: text };
  if (limits.min !== undefined) out.min = limits.min;
  if (limits.max !== undefined) out.max = limits.max;
  if (limits.unit) out.unit = limits.unit;
  return out;
}

/** A stored step back as a checklist line. */
export function stepFromService(item: unknown): string {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  const o = item as Record<string, unknown>;
  const text = String(o.step ?? o.task ?? o.label ?? o.name ?? o.item ?? o.title ?? o.text ?? "").trim();
  if (!text) return "";
  const num = (v: unknown) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const limits: StepLimits = { min: num(o.min), max: num(o.max), unit: o.unit ? String(o.unit) : undefined };
  return limits.min === undefined && limits.max === undefined ? text : formatStep(text, limits);
}
