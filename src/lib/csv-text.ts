/**
 * Downloaded templates ship an example row and a column guide row. Both carry a
 * marker token in their leading column so re-uploading the untouched template
 * never imports the sample data — users routinely forget to delete those rows.
 */
export const IMPORT_TEMPLATE_MARKER_COLUMN = "#";
export const IMPORT_TEMPLATE_EXAMPLE_TOKEN = "EXAMPLE - delete this row";
export const IMPORT_TEMPLATE_GUIDE_TOKEN = "GUIDE - delete this row";

const TEMPLATE_MARKER_PREFIXES = ["example delete this row", "guide delete this row"];

/** True when a parsed row is one of a template's own example / guide rows. */
export function isTemplateMarkerRow(cells: string[]): boolean {
  return cells.some((cell) => {
    const canon = String(cell ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (!canon) return false;
    return TEMPLATE_MARKER_PREFIXES.some((prefix) => canon.startsWith(prefix));
  });
}

function detectDelimiter(text: string): string {
  // Sample the first few non-empty lines — title rows often have no separators.
  const sample = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const delimiter of candidates) {
    let score = 0;
    let consistent = true;
    let expected = -1;
    for (const line of sample) {
      // Ignore commas/semicolons inside quotes for a rough count.
      let count = 1;
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i]!;
        if (ch === '"') {
          quoted = !quoted;
          continue;
        }
        if (!quoted && ch === delimiter) count += 1;
      }
      if (count <= 1) continue;
      if (expected < 0) expected = count;
      else if (count !== expected) consistent = false;
      score += count;
    }
    if (consistent) score *= 2;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

/** RFC-4180-style parser supporting quoted commas, newlines, CSV, TSV and semicolons. */
export function parseDelimitedText(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const next = text[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(value.trim());
      value = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += char;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
