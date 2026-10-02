import { parseAmount, roundMoney } from "@/lib/ledger/types";
import { logHistory } from "@/lib/history";
import { parseDelimitedText } from "@/lib/data-import";
import { persistSettingToDb } from "@/lib/db/sync";
import {
  getMemoryRecords,
  getMemorySetting,
  setMemoryRecords,
  setMemorySetting,
} from "@/lib/db/client-store";
import { getAppFlag, setAppFlag } from "@/lib/db/app-prefs";
import { apiFetch } from "@/lib/api-auth";
import type { ManagerRecord } from "@/lib/manager-entities";

export type StatementLine = {
  id: string;
  date: string;
  description: string;
  amount: number;
  matchedRecordId?: string;
  matchedKind?: "receipt" | "payment";
};

export type BankStatement = {
  id: string;
  account: string;
  asOf: string;
  closingBalance: number;
  lines: StatementLine[];
  importedAt: string;
};

export type BankStatementImportResult = {
  statement: BankStatement;
  receiptsCreated: number;
  paymentsCreated: number;
};

export const BANK_STATEMENTS_KEY = "financeiag-bank-statements";

export function loadBankStatements(): BankStatement[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = getMemorySetting<BankStatement[] | null>(BANK_STATEMENTS_KEY, null);
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

export function saveBankStatements(statements: BankStatement[]) {
  if (typeof window === "undefined") return;
  setMemorySetting(BANK_STATEMENTS_KEY, statements);
  window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
  void persistSettingToDb(BANK_STATEMENTS_KEY, statements);
}

const CLEAR_IMPORTED_STATEMENTS_KEY = "financeiag-clear-imported-statements-v1";

/**
 * Legacy marker only — does NOT wipe imported bank statements.
 * Auto-clear on boot deleted user imports; remove statements from Banking UI instead.
 */
export function clearImportedBankStatementsOnce(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (getAppFlag(CLEAR_IMPORTED_STATEMENTS_KEY)) return false;
    setAppFlag(CLEAR_IMPORTED_STATEMENTS_KEY, true);
    return false;
  } catch {
    return false;
  }
}

export function deleteBankStatement(statementId: string): boolean {
  const before = loadBankStatements();
  const filtered = before.filter((s) => s.id !== statementId);
  if (filtered.length === before.length) return false;
  saveBankStatements(filtered);
  return true;
}

export function clearAllBankStatements(): void {
  saveBankStatements([]);
}

function isoDate(value: string): string {
  const input = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) return input.slice(0, 10);
  const parts = input.split(/[./-]/);
  if (parts.length === 3) {
    const [a, b, c] = parts;
    if (c?.length === 4) {
      return `${c}-${String(Number(b)).padStart(2, "0")}-${String(Number(a)).padStart(2, "0")}`;
    }
    if (a?.length === 4) {
      return `${a}-${String(Number(b)).padStart(2, "0")}-${String(Number(c)).padStart(2, "0")}`;
    }
  }
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? input.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function normalizedHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

/** True when a header matches any candidate (exact or contains key phrases). */
function headerMatches(header: string, ...candidates: string[]) {
  const h = normalizedHeader(header);
  if (!h) return false;
  for (const candidate of candidates) {
    const c = normalizedHeader(candidate);
    if (!c) continue;
    if (h === c) return true;
    if (h.includes(c) || c.includes(h)) return true;
  }
  return false;
}

function findColumn(headers: string[], ...candidates: string[]) {
  return headers.findIndex((header) => headerMatches(header, ...candidates));
}

/** Canonical CSV columns for bank statement import / template export. */
export const BANK_STATEMENT_TEMPLATE_HEADERS = [
  "Date",
  "Transaction Details",
  "Credit (Money In)",
  "Debit (Money Out)",
] as const;

/**
 * Downloadable CSV template for bank statement import.
 * Columns: Date | Transaction Details | Credit (Money In) | Debit (Money Out)
 */
export function bankStatementTemplateCsv(): string {
  const sampleRows = [
    ["2026-07-01", "Customer payment — INV-0001", "1500000", ""],
    ["2026-07-02", "Supplier payment — BILL-0001", "", "450000"],
    ["2026-07-03", "Bank charges", "", "15000"],
  ];
  const lines = [
    BANK_STATEMENT_TEMPLATE_HEADERS.join(","),
    ...sampleRows.map((row) =>
      row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","),
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export function downloadBankStatementTemplate() {
  if (typeof window === "undefined") return;
  const blob = new Blob([bankStatementTemplateCsv()], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bank-statement-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/** Parse CSV/TSV bank exports with amount or separate debit/credit columns. */
export function parseStatementCsv(csv: string): Omit<StatementLine, "id">[] {
  const rows = parseDelimitedText(csv);
  if (rows.length < 2) return [];

  // Skip title / blank rows above the real header (common in bank exports).
  let headerIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
    const headers = (rows[i] || []).map(normalizedHeader);
    let score = 0;
    if (findColumn(headers, "date", "transaction date", "value date", "posted date") >= 0) {
      score += 2;
    }
    if (
      findColumn(headers, "amount", "transaction amount") >= 0 ||
      findColumn(headers, "credit", "money in", "deposit") >= 0 ||
      findColumn(headers, "debit", "money out", "withdrawal") >= 0
    ) {
      score += 2;
    }
    if (findColumn(headers, "description", "details", "narration", "memo", "transaction details") >= 0) {
      score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      headerIndex = i;
    }
  }

  const headers = rows[headerIndex]!.map(normalizedHeader);

  const dateIndex = findColumn(
    headers,
    "date",
    "transaction date",
    "value date",
    "posted date",
  );
  const descriptionIndex = findColumn(
    headers,
    "transaction details",
    "description",
    "details",
    "narration",
    "memo",
    "particulars",
  );
  const amountIndex = findColumn(headers, "amount", "transaction amount");
  // Prefer explicit Credit (Money In) / Debit (Money Out) columns.
  const creditIndex = findColumn(
    headers,
    "credit (money in)",
    "money in",
    "credit",
    "deposit",
    "paid in",
  );
  const debitIndex = findColumn(
    headers,
    "debit (money out)",
    "money out",
    "debit",
    "withdrawal",
    "paid out",
  );

  if (dateIndex < 0 || (amountIndex < 0 && debitIndex < 0 && creditIndex < 0)) {
    throw new Error(
      "Bank CSV needs Date plus Credit (Money In) and/or Debit (Money Out) — or a single Amount column. Download the template for the expected format.",
    );
  }

  const out: Omit<StatementLine, "id">[] = [];
  for (const cells of rows.slice(headerIndex + 1)) {
    const date = (cells[dateIndex] || "").trim();
    if (!date) continue;
    const description =
      (descriptionIndex >= 0 ? cells[descriptionIndex] : "")?.trim() || "Bank transaction";

    let amount = 0;
    if (amountIndex >= 0 && debitIndex < 0 && creditIndex < 0) {
      amount = parseAmount(cells[amountIndex]);
    } else {
      const credit = parseAmount(creditIndex >= 0 ? cells[creditIndex] : "");
      const debit = parseAmount(debitIndex >= 0 ? cells[debitIndex] : "");
      // Money in = positive (receipt); money out = negative (payment).
      amount = roundMoney(credit - debit);
    }
    if (!amount) continue;
    out.push({
      date: isoDate(date),
      description,
      amount,
    });
  }
  return out;
}

function parseQif(text: string): Omit<StatementLine, "id">[] {
  return text
    .split(/^\^$/m)
    .map((entry) => {
      const values = Object.fromEntries(
        entry
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => [line[0], line.slice(1).trim()]),
      );
      return {
        date: isoDate(values.D || ""),
        description: values.P || values.M || "Bank transaction",
        amount: parseAmount(values.T),
      };
    })
    .filter((line) => line.date && line.amount);
}

function parseOfx(text: string): Omit<StatementLine, "id">[] {
  const entries = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  const field = (entry: string, name: string) => {
    const match = entry.match(new RegExp(`<${name}>([^<\\r\\n]+)`, "i"));
    return match?.[1]?.trim() || "";
  };
  return entries
    .map((entry) => ({
      date: isoDate(field(entry, "DTPOSTED").slice(0, 8).replace(
        /^(\d{4})(\d{2})(\d{2})$/,
        "$1-$2-$3",
      )),
      description:
        field(entry, "NAME") || field(entry, "MEMO") || "Bank transaction",
      amount: parseAmount(field(entry, "TRNAMT")),
    }))
    .filter((line) => line.date && line.amount);
}

export function parseBankStatementText(
  text: string,
  fileName = "",
): Omit<StatementLine, "id">[] {
  if (/\.qif$/i.test(fileName) || /^!Type:/m.test(text)) return parseQif(text);
  if (/\.ofx$/i.test(fileName) || /<OFX>/i.test(text)) return parseOfx(text);
  return parseStatementCsv(text);
}

function asManagerRecord(row: Record<string, unknown> | ManagerRecord): ManagerRecord {
  const id = String(row.id || "");
  const out: ManagerRecord = {
    id,
    createdAt: String(row.createdAt || ""),
    updatedAt: String(row.updatedAt || ""),
  };
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    out[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  out.id = id || out.id;
  return out;
}

function mergeMoneyIntoMemory(entity: "receipts" | "payments", rows: ManagerRecord[]) {
  if (!rows.length) return;
  const current = getMemoryRecords("banking", entity);
  const byId = new Map(current.map((r) => [r.id, r]));
  for (const row of rows) {
    if (!row.id) continue;
    byId.set(row.id, { ...(byId.get(row.id) || { id: row.id, createdAt: "", updatedAt: "" }), ...row });
  }
  setMemoryRecords("banking", entity, Array.from(byId.values()));
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("financeiag-records-changed", {
        detail: { module: "banking", entity },
      }),
    );
  }
}

/**
 * Import a bank statement via Go — parse, match/create receipts & payments, GL, and settings.
 * Browser only uploads the file and hydrates memory from the API response.
 */
export async function importBankStatement(input: {
  account: string;
  /** Optional — defaults to the latest date in the file, or today. */
  asOf?: string;
  /** Optional — defaults to 0 (balance comes from posted receipts/payments). */
  closingBalance?: number;
  csv: string;
  fileName?: string;
  /** When true (default), create uncategorized receipts/payments on the bank account. */
  createTransactions?: boolean;
}): Promise<BankStatementImportResult> {
  if (typeof window === "undefined") {
    throw new Error("Bank statement import is only available in the browser.");
  }
  const account = (input.account || "").trim();
  if (!account) throw new Error("Select a bank account first.");
  if (!(input.csv || "").trim()) throw new Error("Choose a statement file first.");

  const form = new FormData();
  const name = input.fileName || "bank-statement.csv";
  form.append("file", new Blob([input.csv], { type: "text/csv" }), name);
  form.append("account", account);
  if ((input.asOf || "").trim()) form.append("asOf", String(input.asOf).trim());
  if (input.closingBalance != null && Number.isFinite(input.closingBalance)) {
    form.append("closingBalance", String(input.closingBalance));
  }
  form.append(
    "createTransactions",
    input.createTransactions === false ? "false" : "true",
  );

  const res = await apiFetch("/api/banking/bank-statements/import", {
    method: "POST",
    body: form,
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    statement?: BankStatement;
    receiptsCreated?: number;
    paymentsCreated?: number;
    receipts?: Record<string, unknown>[];
    payments?: Record<string, unknown>[];
  } | null;
  if (!res.ok || !json?.ok || !json.statement) {
    throw new Error(json?.error || `Bank statement import failed (HTTP ${res.status})`);
  }

  const statement = json.statement;
  const receipts = (json.receipts || []).map(asManagerRecord);
  const payments = (json.payments || []).map(asManagerRecord);
  mergeMoneyIntoMemory("receipts", receipts);
  mergeMoneyIntoMemory("payments", payments);
  saveBankStatements([statement, ...loadBankStatements().filter((s) => s.id !== statement.id)]);

  const receiptsCreated = Number(json.receiptsCreated || 0);
  const paymentsCreated = Number(json.paymentsCreated || 0);
  logHistory({
    action: "Imported",
    module: "Banking",
    entity: "bank-statements",
    record: { reference: statement.id, name: account },
    details: `Imported ${statement.lines.length} statement lines for ${account}; created ${receiptsCreated} receipts and ${paymentsCreated} payments`,
  });
  return { statement, receiptsCreated, paymentsCreated };
}

/** @deprecated Server creates money rows during import — do not invent in the browser. */
export async function createBankTransactionsFromStatement(_statement: BankStatement): Promise<{
  lines: StatementLine[];
  receiptsCreated: number;
  paymentsCreated: number;
}> {
  throw new Error(
    "Bank statement transactions are created only by POST /api/banking/bank-statements/import",
  );
}

/** Auto-match statement lines via Go (clearance only — no Draft→Active). */
export async function autoMatchStatement(statementId: string): Promise<{ matched: number }> {
  if (typeof window === "undefined") return { matched: 0 };
  const id = (statementId || "").trim();
  if (!id) return { matched: 0 };

  const res = await apiFetch(`/api/banking/bank-statements/${encodeURIComponent(id)}/auto-match`, {
    method: "POST",
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    matched?: number;
    statement?: BankStatement;
    receipts?: Record<string, unknown>[];
    payments?: Record<string, unknown>[];
  } | null;
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `Auto-match failed (HTTP ${res.status})`);
  }

  if (json.statement) {
    const statements = loadBankStatements();
    const idx = statements.findIndex((s) => s.id === id);
    if (idx >= 0) {
      const next = [...statements];
      next[idx] = json.statement;
      saveBankStatements(next);
    }
  }
  mergeMoneyIntoMemory("receipts", (json.receipts || []).map(asManagerRecord));
  mergeMoneyIntoMemory("payments", (json.payments || []).map(asManagerRecord));
  // Auto-match may only return the statement — refresh money collections from API.
  if (!(json.receipts || []).length && !(json.payments || []).length && Number(json.matched || 0) > 0) {
    const { hydrateEntityFromDatabase } = await import("@/lib/db/sync");
    await Promise.all([
      hydrateEntityFromDatabase("banking", "receipts"),
      hydrateEntityFromDatabase("banking", "payments"),
    ]);
  }
  return { matched: Number(json.matched || 0) };
}

/** Manual match remains local UI glue — prefer auto-match API for durable clearance. */
export async function manualMatchLine(
  statementId: string,
  lineId: string,
  recordId: string,
  kind: "receipt" | "payment",
): Promise<boolean> {
  const statements = loadBankStatements();
  const statement = statements.find((s) => s.id === statementId);
  if (!statement) return false;
  const line = statement.lines.find((l) => l.id === lineId);
  if (!line || line.matchedRecordId) return false;
  line.matchedRecordId = recordId;
  line.matchedKind = kind;
  saveBankStatements(statements);
  return true;
}
