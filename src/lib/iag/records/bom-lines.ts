/**
 * The BOM / kit form keeps its components as one text field — "Green AA x 2;
 * Kraft 500g" — and iag-production stores real lines. These two functions
 * are the whole translation, and the same file ships in iag-inventory so a
 * kit typed there and a BOM typed here serialise identically.
 *
 * Accepted shapes, matching the Inventory app's kit parser: "Item x 2",
 * "Item × 2", "Item * 2", "Item" (qty 1). Separators ; , or newline. A unit
 * may follow the quantity: "Green AA x 118 kg". Scrap is not typed here.
 */
export type BomLineInput = {
  component_item: string;
  qty: number;
  unit?: string;
  scrap_pct?: number;
};

export function parseComponents(text: string | undefined): BomLineInput[] {
  const raw = (text || "").trim();
  if (!raw) return [];
  const out: BomLineInput[] = [];
  for (const part of raw.split(/[;,\n]+/)) {
    const piece = part.trim();
    if (!piece) continue;
    const match = piece.match(/^(.*?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)?\s*$/i);
    const item = (match ? match[1] : piece).trim();
    const qty = match ? Number(match[2]) : 1;
    if (!item || !Number.isFinite(qty) || qty <= 0) continue;
    const unit = match?.[3]?.trim();
    out.push(unit ? { component_item: item, qty, unit } : { component_item: item, qty });
  }
  return out;
}

export function serialiseComponents(
  lines: ReadonlyArray<{ component_item?: unknown; qty?: unknown; unit?: unknown }> | undefined,
): string {
  if (!Array.isArray(lines)) return "";
  return lines
    .map((line) => {
      const item = String(line.component_item ?? "").trim();
      if (!item) return "";
      const qty = Number(line.qty);
      const unit = String(line.unit ?? "").trim();
      const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
      return `${item} x ${q}${unit ? ` ${unit}` : ""}`;
    })
    .filter(Boolean)
    .join("; ");
}
