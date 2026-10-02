import { parseAmount, roundMoney } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";

export type DiscountType = "percent" | "amount";

export type DocumentLine = {
  item: string;
  description: string;
  account: string;
  /** QuickBooks-style class; falls back to header division when empty. */
  division?: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  discountType: DiscountType;
  imageUrl: string;
  amount: string;
};

export type JournalLine = {
  account: string;
  description: string;
  debit: string;
  credit: string;
  /** QuickBooks-style class; falls back to header division when empty. */
  division?: string;
};

export const DOCUMENT_LINE_ENTITIES = new Set([
  "sales-invoices",
  "purchase-invoices",
  "credit-notes",
  "debit-notes",
  "sales-quotes",
  "purchase-quotes",
  "sales-orders",
  "purchase-orders",
  "invoices",
  "bills",
]);

export const JOURNAL_LINE_ENTITIES = new Set(["journal-entries", "recurring-journal-entries"]);

export function supportsDocumentLines(entityKey: string) {
  return DOCUMENT_LINE_ENTITIES.has(entityKey);
}

export function supportsJournalLines(entityKey: string) {
  return JOURNAL_LINE_ENTITIES.has(entityKey);
}

export function emptyDocumentLine(): DocumentLine {
  return {
    item: "",
    description: "",
    account: "",
    division: "",
    quantity: "1",
    unitPrice: "",
    discount: "",
    discountType: "percent",
    imageUrl: "",
    amount: "",
  };
}

export function emptyJournalLine(): JournalLine {
  return { account: "", description: "", debit: "", credit: "", division: "" };
}

export function parseDocumentLines(raw: string | undefined | null): DocumentLine[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      const quantity = String(r.quantity ?? r.qty ?? "1");
      const unitPrice = String(r.unitPrice ?? r.price ?? "");
      const amount =
        String(r.amount ?? "") ||
        String(roundMoney(parseAmount(quantity) * parseAmount(unitPrice)) || "");
      return {
        item: String(r.item ?? r.inventoryItem ?? ""),
        description: String(r.description ?? r.name ?? ""),
        account: String(r.account ?? ""),
        division: String(r.division ?? r.class ?? r.costCenter ?? ""),
        quantity,
        unitPrice,
        discount: String(r.discount ?? ""),
        discountType: r.discountType === "amount" ? "amount" : "percent",
        imageUrl: String(r.imageUrl ?? r.image ?? ""),
        amount,
      };
    });
  } catch {
    return [];
  }
}

export function parseJournalLines(raw: string | undefined | null): JournalLine[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        account: String(r.account ?? ""),
        description: String(r.description ?? ""),
        debit: String(r.debit ?? ""),
        credit: String(r.credit ?? ""),
        division: String(r.division ?? r.class ?? r.costCenter ?? ""),
      };
    });
  } catch {
    return [];
  }
}

/** Build lines from legacy single-line fields when `lines` is empty. */
export function documentLinesFromRecord(record: Partial<ManagerRecord> | null | undefined): DocumentLine[] {
  const fromJson = parseDocumentLines(record?.lines);
  if (fromJson.length) return fromJson.map(normalizeDocumentLine);
  const amount = record?.amount || record?.total || "";
  const unitPrice = record?.unitPrice || amount;
  const quantity = record?.quantity || (amount ? "1" : "");
  if (!amount && !unitPrice && !record?.description && !record?.item) return [emptyDocumentLine()];
  return [
    normalizeDocumentLine({
      item: record?.item || "",
      description: record?.description || "",
      account: record?.account || "",
      division: record?.division || record?.costCenter || "",
      quantity: quantity || "1",
      unitPrice: unitPrice || "",
      discount: record?.discount || "",
      discountType: "percent",
      imageUrl: record?.imageUrl || "",
      amount: amount || "",
    }),
  ];
}

export function journalLinesFromRecord(record: Partial<ManagerRecord> | null | undefined): JournalLine[] {
  const fromJson = parseJournalLines(record?.lines);
  if (fromJson.length) return fromJson;
  const debitAccount = record?.debitAccount || "";
  const creditAccount = record?.creditAccount || "";
  const debit = record?.debit || record?.amount || "";
  const credit = record?.credit || record?.amount || "";
  const division = record?.division || record?.costCenter || "";
  if (!debitAccount && !creditAccount && !debit && !credit) {
    return [emptyJournalLine(), emptyJournalLine()];
  }
  return [
    { account: debitAccount, description: record?.narration || "", debit, credit: "", division },
    { account: creditAccount, description: "", debit: "", credit, division },
  ];
}

export function normalizeDocumentLine(line: DocumentLine): DocumentLine {
  const qty = parseAmount(line.quantity) || (line.unitPrice || line.amount ? 1 : 0);
  const unit = parseAmount(line.unitPrice);
  const discountValue = parseAmount(line.discount);
  const discountType: DiscountType = line.discountType === "amount" ? "amount" : "percent";
  const gross = roundMoney(qty * unit);
  let afterDiscount = gross;
  if (discountValue > 0) {
    if (discountType === "amount") {
      afterDiscount = roundMoney(Math.max(0, gross - discountValue));
    } else {
      afterDiscount = roundMoney(
        gross * (1 - Math.min(100, Math.max(0, discountValue)) / 100),
      );
    }
  }
  const amount =
    line.amount && !Number.isNaN(parseAmount(line.amount)) && parseAmount(line.amount) > 0
      ? String(parseAmount(line.amount))
      : afterDiscount
        ? String(afterDiscount)
        : line.amount || "";
  return {
    item: line.item || "",
    description: line.description || "",
    account: line.account || "",
    division: line.division || "",
    quantity: line.quantity || (qty ? String(qty) : ""),
    unitPrice: line.unitPrice || "",
    discount: line.discount || "",
    discountType,
    imageUrl: line.imageUrl || "",
    amount,
  };
}

export function documentLinesTotal(lines: DocumentLine[]) {
  return roundMoney(lines.reduce((sum, line) => sum + parseAmount(normalizeDocumentLine(line).amount), 0));
}

export function journalLinesTotals(lines: JournalLine[]) {
  const debit = roundMoney(lines.reduce((sum, line) => sum + parseAmount(line.debit), 0));
  const credit = roundMoney(lines.reduce((sum, line) => sum + parseAmount(line.credit), 0));
  return { debit, credit, balanced: debit === credit && debit > 0 };
}

export function serializeDocumentLines(lines: DocumentLine[]) {
  return JSON.stringify(lines.map(normalizeDocumentLine).filter((l) => parseAmount(l.amount) > 0 || l.description || l.item));
}

export function serializeJournalLines(lines: JournalLine[]) {
  return JSON.stringify(
    lines.filter((l) => l.account || parseAmount(l.debit) > 0 || parseAmount(l.credit) > 0),
  );
}

/** Group document lines by income/expense account (+ optional class) for multi-account posting. */
export function documentLinesByAccount(lines: DocumentLine[], fallbackAccount: string) {
  const map = new Map<string, { account: string; amount: number; division: string }>();
  for (const line of lines.map(normalizeDocumentLine)) {
    const amt = parseAmount(line.amount);
    if (!amt) continue;
    const account = (line.account || fallbackAccount || "Sales").trim() || fallbackAccount || "Sales";
    const division = (line.division || "").trim();
    const key = `${account.toLowerCase()}::${division.toLowerCase()}`;
    const prev = map.get(key);
    if (prev) {
      prev.amount = roundMoney(prev.amount + amt);
    } else {
      map.set(key, { account, amount: amt, division });
    }
  }
  return [...map.values()];
}
