/**
 * Ledger translation: this app's flat journal ↔ iag-finance's double-entry API.
 *
 * The app models the journal as a flat list of `LedgerLine` (one row per
 * debit/credit leg) plus a chart of accounts. iag-finance models it as
 * `/v1/ledger/entries`, each entry holding balanced lines. Flattening is
 * lossless enough for reporting; the reverse (PUT) is not, so writes go through
 * entry creation rather than line replacement.
 */
import { gatewayFetch, unwrapList } from "@/lib/iag/gateway";
import type {
  AccountBalance,
  AccountType,
  LedgerAccount,
  LedgerLine,
} from "@/lib/ledger/types";

type Row = Record<string, unknown>;

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

/** Finance uses ASSET/LIABILITY/…; the app uses Title case. */
export function accountType(value: unknown): AccountType {
  const raw = text(value).trim().toLowerCase();
  if (raw.startsWith("liab")) return "Liability";
  if (raw.startsWith("eq")) return "Equity";
  if (raw.startsWith("inc") || raw.startsWith("rev")) return "Income";
  if (raw.startsWith("exp") || raw.startsWith("cost")) return "Expense";
  return "Asset";
}

export function toLedgerAccount(row: Row): LedgerAccount {
  const code = text(row.code ?? row.accountCode);
  return {
    id: text(row.id ?? row.uuid ?? code) || code,
    code,
    name: text(row.name ?? row.accountName ?? code),
    type: accountType(row.type ?? row.accountType ?? row.category),
    group: text(row.group ?? row.parentCode ?? row.category ?? ""),
    openingBalance: num(row.openingBalance ?? row.opening_balance),
    currency: text(row.currency) || undefined,
    isControl: row.isControl === true || row.is_control === true,
    inactive:
      row.inactive === true ||
      row.active === false ||
      text(row.status).toLowerCase() === "inactive",
  };
}

export async function fetchLedgerAccounts(): Promise<LedgerAccount[]> {
  const payload = await gatewayFetch({
    service: "finance",
    path: "/v1/chart-of-accounts",
  });
  return unwrapList<Row>(payload).map(toLedgerAccount);
}

/** Lines nested on an entry, under any of the usual key names. */
function entryLines(entry: Row): Row[] {
  for (const key of ["lines", "entries", "items", "postings", "details"]) {
    const value = entry[key];
    if (Array.isArray(value)) return value as Row[];
  }
  return [];
}

export function flattenEntry(entry: Row): LedgerLine[] {
  const entryId = text(entry.id ?? entry.uuid ?? entry.reference);
  const date = text(entry.date ?? entry.postingDate ?? entry.entryDate).slice(0, 10);
  const narration = text(entry.description ?? entry.narration ?? entry.memo);
  const createdAt = text(entry.createdAt ?? entry.created_at) || date;

  return entryLines(entry).map((line, index) => {
    const accountCode = text(line.accountCode ?? line.account_code ?? line.account);
    return {
      id: text(line.id) || `${entryId}:${index}`,
      accountId: text(line.accountId ?? line.account_id) || accountCode,
      accountCode,
      accountName: text(line.accountName ?? line.account_name),
      debit: num(line.debit),
      credit: num(line.credit),
      date,
      narration: text(line.description ?? line.narration) || narration,
      // Provenance: everything here came from the finance service.
      sourceModule: text(line.sourceModule ?? entry.sourceModule) || "finance",
      sourceEntity:
        text(line.sourceEntity ?? entry.sourceEntity ?? entry.documentType) ||
        "ledger-entry",
      sourceRecordId: text(line.sourceRecordId ?? entry.documentRef) || entryId,
      createdAt,
      division: text(line.costCenter ?? line.division) || undefined,
      project: text(line.project ?? line.projectId) || undefined,
      entityId: text(line.entityId ?? entry.entityId) || undefined,
      location: text(line.location) || undefined,
    };
  });
}

export async function fetchLedgerLines(options: {
  limit: number;
  offset: number;
}): Promise<{ lines: LedgerLine[]; hasMore: boolean; nextOffset: number }> {
  const payload = await gatewayFetch({
    service: "finance",
    path: "/v1/ledger/entries",
    query: { limit: options.limit, offset: options.offset },
  });
  const entries = unwrapList<Row>(payload);
  const lines = entries.flatMap(flattenEntry);

  // Paging is by entry, not line — report the entry cursor back.
  const hasMore = entries.length >= options.limit;
  return {
    lines,
    hasMore,
    nextOffset: options.offset + entries.length,
  };
}

export function toAccountBalance(row: Row): AccountBalance {
  const code = text(row.code ?? row.accountCode);
  const debit = num(row.debit ?? row.totalDebit);
  const credit = num(row.credit ?? row.totalCredit);
  return {
    accountId: text(row.accountId ?? row.account_id ?? row.id) || code,
    code,
    name: text(row.name ?? row.accountName ?? code),
    type: accountType(row.type ?? row.accountType),
    group: text(row.group ?? row.category ?? ""),
    debit,
    credit,
    balance: num(row.balance ?? debit - credit),
  };
}

export async function fetchTrialBalance(): Promise<AccountBalance[]> {
  const payload = await gatewayFetch({
    service: "finance",
    path: "/v1/reports/trial-balance",
  });
  return unwrapList<Row>(payload).map(toAccountBalance);
}

/**
 * Group flat lines back into balanced entries for POST /v1/ledger/entries.
 * Lines are keyed by (date, narration, sourceRecordId) — the app writes all
 * legs of one posting with the same triple.
 */
export function groupLinesIntoEntries(lines: LedgerLine[]): Array<{
  date: string;
  description: string;
  documentRef: string;
  lines: Array<{
    accountCode: string;
    debit: number;
    credit: number;
    description: string;
  }>;
}> {
  const groups = new Map<string, LedgerLine[]>();
  for (const line of lines) {
    const key = `${line.date}|${line.sourceRecordId}|${line.narration}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(line);
    else groups.set(key, [line]);
  }

  return [...groups.values()].map((bucket) => ({
    date: bucket[0].date,
    description: bucket[0].narration,
    documentRef: bucket[0].sourceRecordId,
    lines: bucket.map((line) => ({
      accountCode: line.accountCode,
      debit: line.debit,
      credit: line.credit,
      description: line.narration,
    })),
  }));
}