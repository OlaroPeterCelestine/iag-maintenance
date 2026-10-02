/**
 * Searchable text for a record row.
 *
 * Entity tables used to match against `Object.values(record).join(" ")`. That
 * swept in the attachments field, which holds base64 data URLs capped at ~8 MB
 * per record — so filtering lower-cased and concatenated megabytes per row on
 * every keystroke, and invoice pages with scanned documents attached went
 * "Page Unresponsive". Nobody types base64 into a search box, so the payloads
 * are excluded and the remaining text is indexed once per data change.
 */

import type { EntityDefinition, ManagerRecord } from "@/lib/manager-entities";

/**
 * A value this long is a serialized payload, not something a person searches
 * for. Attachment fields are already excluded by type; this is the backstop for
 * legacy rows carrying a blob under an untyped key.
 */
export const MAX_SEARCHABLE_VALUE_CHARS = 20_000;

/** Field keys holding attachment payloads rather than searchable text. */
export function attachmentFieldKeys(definition: EntityDefinition): Set<string> {
  const keys = new Set<string>();
  for (const field of definition.fields) {
    if (field.type === "attachments") keys.add(field.key);
  }
  return keys;
}

/** Lower-cased text a record can be matched against, payloads omitted. */
export function recordSearchText(
  record: ManagerRecord,
  skipKeys: Set<string> = new Set(),
): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(record)) {
    if (skipKeys.has(key)) continue;
    const value = String(raw ?? "");
    if (!value) continue;
    if (value.length > MAX_SEARCHABLE_VALUE_CHARS) continue;
    if (value.startsWith("data:")) continue;
    parts.push(value.toLowerCase());
  }
  return parts.join(" ");
}

/**
 * Record id → searchable text. Build this once per data change and reuse it
 * across keystrokes; rebuilding inside the filter is what made typing quadratic.
 */
export function buildRecordSearchIndex(
  records: ManagerRecord[],
  skipKeys: Set<string> = new Set(),
): Map<string, string> {
  const index = new Map<string, string>();
  for (const record of records) {
    index.set(record.id, recordSearchText(record, skipKeys));
  }
  return index;
}
