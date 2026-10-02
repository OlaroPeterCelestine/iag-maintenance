import { isDateLocked } from "@/lib/history";
import {
  loadLedgerLines,
  postBalancedEntry,
  removePostingsForSource,
} from "@/lib/ledger/posting";
import { roundMoney } from "@/lib/ledger/types";
import { logHistory } from "@/lib/history";

/**
 * Reverse a source document's postings with a dated reversing journal
 * (audit-preserving void) instead of deleting history.
 */
export function reverseSourceEntry(input: {
  sourceRecordId: string;
  reverseDate: string;
  narration?: string;
}): { ok: true; reverseId: string } | { ok: false; error: string } {
  if (isDateLocked(input.reverseDate)) {
    return {
      ok: false,
      error: "Reversal date is locked. Enable Allow backdating or unlock in Settings → Lock Date.",
    };
  }
  const original = loadLedgerLines().filter((l) => l.sourceRecordId === input.sourceRecordId);
  if (!original.length) return { ok: false, error: "No ledger lines found to reverse." };

  const reverseId = `rev-${input.sourceRecordId}`;
  removePostingsForSource(reverseId);

  const lines = original.map((l) => ({
    accountId: l.accountId,
    accountCode: l.accountCode,
    accountName: l.accountName,
    debit: roundMoney(l.credit),
    credit: roundMoney(l.debit),
  }));

  const result = postBalancedEntry({
    date: input.reverseDate,
    narration: input.narration || `Reversal of ${original[0]?.narration || input.sourceRecordId}`,
    sourceModule: original[0]?.sourceModule || "accounts",
    sourceEntity: "reversals",
    sourceRecordId: reverseId,
    lines,
  });
  if (!result.ok) return result;

  logHistory({
    action: "Reversed",
    module: original[0]?.sourceModule || "Accounts",
    entity: original[0]?.sourceEntity || "reversals",
    record: { id: input.sourceRecordId, reference: reverseId },
    details: `Reversing journal ${reverseId} dated ${input.reverseDate}`,
  });
  return { ok: true, reverseId };
}
