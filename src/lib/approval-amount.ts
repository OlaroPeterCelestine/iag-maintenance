/**
 * Helpers for revising request amounts during approval / rejection.
 */
import { parseAmount } from "@/lib/ledger/types";

/** Leave has no money figure to revise on the desk. */
export function entitySupportsApprovalAmount(entityKey: string): boolean {
  return entityKey !== "leave-requests";
}

/** Which money field the chain should update for this record. */
export function approvalAmountFieldKey(
  record?: Record<string, string | undefined | null> | null,
): "amount" | "estimatedCost" | "total" {
  if (!record) return "amount";
  const estimated = String(record.estimatedCost || "").trim();
  const total = String(record.total || "").trim();
  const amount = String(record.amount || "").trim();
  if (estimated && !amount) return "estimatedCost";
  if (total && !amount && !estimated) return "total";
  return "amount";
}

export function currentApprovalAmount(
  record?: Record<string, string | undefined | null> | null,
): number {
  if (!record) return 0;
  const key = approvalAmountFieldKey(record);
  return parseAmount(String(record[key] || "0"));
}

export function formatRevisedAmountLabel(
  record: Record<string, string | undefined | null> | null | undefined,
  currency = "UGX",
): { current: string; original?: string; revised: boolean } | null {
  if (!record) return null;
  const key = approvalAmountFieldKey(record);
  const current = parseAmount(String(record[key] || "0"));
  const originalRaw = String(record.originalAmount || "").trim();
  const original = originalRaw ? parseAmount(originalRaw) : 0;
  const fmt = (n: number) =>
    `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (originalRaw && original !== current) {
    return {
      current: fmt(current),
      original: fmt(original),
      revised: true,
    };
  }
  if (current > 0 || originalRaw) {
    return { current: fmt(current), revised: false };
  }
  return null;
}
