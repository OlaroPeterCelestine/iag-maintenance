/**
 * The parts a preventive job uses, as a template's "Parts per job" box: one
 * part per line, the way a fitter writes it.
 *
 *   BRG-6205 × 2      BRG-6205 x 2      2 × BRG-6205      BRG-6205 2      BRG-6205
 *
 * iag-mes stores them as attrs.parts [{sku, qty}] (planned_parts.go) and adds
 * them to every projected job; the parts forecast totals them against stock.
 */
import { InputError } from "@/lib/iag/records/types";

export type PlannedPart = { sku: string; qty: number };

const QTY = "(\\d+(?:\\.\\d+)?)";
const TIMES = "\\s*[×xX*]\\s*";
const SKU_THEN_QTY = new RegExp(`^(\\S+?)(?:${TIMES}|\\s+)${QTY}$`);
const QTY_THEN_SKU = new RegExp(`^${QTY}${TIMES}(\\S+)$`);

export function parsePartLine(line: string): PlannedPart | null {
  const text = line.replace(/^\s*[-*•]\s*/, "").trim();
  if (!text) return null;
  let m = QTY_THEN_SKU.exec(text);
  if (m) return { sku: m[2], qty: Number(m[1]) };
  m = SKU_THEN_QTY.exec(text);
  if (m) return { sku: m[1], qty: Number(m[2]) };
  if (/^\S+$/.test(text)) return { sku: text, qty: 1 };
  throw new InputError(`"${text}" is not a part line — write the part code and how many, e.g. BRG-6205 × 2.`);
}

/** The box's lines as parts; the same part twice is added up. */
export function parsePartsText(text: unknown): PlannedPart[] {
  const out = new Map<string, PlannedPart>();
  for (const line of String(text ?? "").split(/\r?\n|;/)) {
    const p = parsePartLine(line);
    if (!p) continue;
    if (!(p.qty > 0)) throw new InputError(`${p.sku}: a quantity above 0.`);
    const key = p.sku.toUpperCase();
    const prev = out.get(key);
    out.set(key, prev ? { sku: prev.sku, qty: prev.qty + p.qty } : p);
  }
  return [...out.values()];
}

/** Stored parts back as the box's lines. */
export function formatParts(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const sku = String(o.sku ?? "").trim();
      const qty = Number(o.qty);
      return sku && qty > 0 ? `${sku} × ${qty}` : "";
    })
    .filter(Boolean)
    .join("\n");
}
