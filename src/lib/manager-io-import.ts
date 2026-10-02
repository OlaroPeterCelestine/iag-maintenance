import {
  isCsvImportableEntity,
  parseDelimitedText,
  parseEntityCsv,
  scoreHeaders,
  type ImportRow,
} from "@/lib/data-import";
import { DOCUMENT_LINE_ENTITIES } from "@/lib/document-lines";
import { rebuildOpeningBalanceEntry } from "@/lib/ledger/opening-balances";
import { uploadEntityImportRows } from "@/lib/entity-csv-import";
import {
  entityDefinitions,
  type EntityDefinition,
} from "@/lib/manager-entities";
import { loadManagerSettings } from "@/lib/manager-settings";
import { MODULE_SLUGS, type ModuleSlug } from "@/lib/module-data";

/** A place inside FinanceIAG that a CSV / JSON export can be loaded into. */
export type ManagerTarget = {
  module: ModuleSlug;
  entityKey: string;
  label: string;
  /** Words that, when present in a file name, strongly hint at this target. */
  fileHints: string[];
  /** Backup / JSON keys that map onto this target. */
  jsonKeys: string[];
};

/** Stronger file-name / JSON hints for common lists. */
const HINT_OVERRIDES: Record<string, { fileHints: string[]; jsonKeys: string[] }> = {
  customers: {
    fileHints: ["customer", "client", "debtor"],
    jsonKeys: ["customers", "customer"],
  },
  suppliers: {
    fileHints: ["supplier", "vendor", "creditor"],
    jsonKeys: ["suppliers", "supplier"],
  },
  "inventory-items": {
    fileHints: ["inventory", "item", "product", "stock"],
    jsonKeys: ["inventoryItems", "inventory-items", "items", "inventory"],
  },
  "chart-of-accounts": {
    fileHints: ["chart", "account", "coa", "ledger"],
    jsonKeys: ["chartOfAccounts", "chart-of-accounts", "accounts", "generalLedgerAccounts"],
  },
  employees: {
    fileHints: ["employee", "staff", "payroll"],
    jsonKeys: ["employees", "employee"],
  },
  "bank-and-cash-accounts": {
    fileHints: ["bank", "cash account"],
    jsonKeys: ["bankAccounts", "bank-accounts", "cashAccounts"],
  },
  "payment-requests": {
    fileHints: ["payment request", "payment-request", "preq"],
    jsonKeys: ["paymentRequests", "payment-requests"],
  },
  "oral-payment-requests": {
    fileHints: ["oral payment", "oral request", "oral-payment", "oral"],
    jsonKeys: ["oralPaymentRequests", "oral-payment-requests"],
  },
  "sales-invoices": {
    fileHints: ["sales invoice", "invoice"],
    jsonKeys: ["salesInvoices", "sales-invoices", "invoices"],
  },
  "purchase-invoices": {
    fileHints: [
      "purchase invoice",
      "bill",
      "purchase bill",
      "contractor invoice",
      "contractor-invoice",
      "cinv",
    ],
    jsonKeys: [
      "purchaseInvoices",
      "purchase-invoices",
      "bills",
      "contractorInvoices",
      "contractor-invoices",
    ],
  },
};

function defaultHints(entityKey: string, label: string): { fileHints: string[]; jsonKeys: string[] } {
  const override = HINT_OVERRIDES[entityKey];
  if (override) return override;
  const words = entityKey.split("-").filter(Boolean);
  const camel = words
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
  return {
    fileHints: [entityKey.replace(/-/g, " "), label.toLowerCase(), words[0] || entityKey],
    jsonKeys: [entityKey, camel, `${camel}s`],
  };
}

/** Every importable list across all modules (for CSV bulk upload). */
export function managerTargets(): ManagerTarget[] {
  const out: ManagerTarget[] = [];
  const seen = new Set<string>();
  for (const moduleSlug of MODULE_SLUGS) {
    for (const def of entityDefinitions(moduleSlug)) {
      if (!isCsvImportableEntity(def.key)) continue;
      // Contractor invoices UI stores as purchase invoices — import via that list.
      if (def.key === "contractor-invoices") continue;
      // Line-sheet entities need their list-page Import CSV (Go builds `lines` JSON).
      // Flat Settings import would drop structured lines.
      if (def.key === "requisitions") continue;
      if (DOCUMENT_LINE_ENTITIES.has(def.key)) continue;
      if (def.key === "journal-entries") continue;
      if (seen.has(def.key)) continue;
      seen.add(def.key);
      const hints = defaultHints(def.key, def.label);
      out.push({
        module: moduleSlug,
        entityKey: def.key,
        label: def.label,
        fileHints: hints.fileHints,
        jsonKeys: hints.jsonKeys,
      });
    }
  }
  return out;
}

export type ManagerTargetId = string;

function allTargets(): ManagerTarget[] {
  return managerTargets();
}

function definitionFor(target: ManagerTarget): EntityDefinition | undefined {
  return entityDefinitions(target.module).find((def) => def.key === target.entityKey);
}

function fileHint(fileName: string): ManagerTarget | undefined {
  const lower = fileName.toLowerCase();
  return allTargets().find((target) => target.fileHints.some((hint) => lower.includes(hint)));
}

/**
 * Work out which FinanceIAG table a Manager.io CSV/TSV export belongs to by
 * scoring its header row against every target, using the file name to break ties.
 */
export function detectTarget(fileName: string, text: string): ManagerTarget | undefined {
  let rows: string[][] = [];
  try {
    rows = parseDelimitedText(text);
  } catch {
    rows = [];
  }
  const hinted = fileHint(fileName);
  if (!rows.length) return hinted;

  // Score the best header-like row in the opening block (skip title / blank rows).
  const scored = allTargets()
    .map((target) => {
      const definition = definitionFor(target);
      if (!definition) return { target, score: 0 };
      let best = 0;
      for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
        best = Math.max(best, scoreHeaders(rows[i] || [], definition));
      }
      return { target, score: best };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score === 0) return hinted;

  // Customers and Suppliers share almost identical columns — let the file name decide.
  const tied = scored.filter((entry) => entry.score === best.score);
  if (tied.length > 1 && hinted && tied.some((entry) => entry.target === hinted)) {
    return hinted;
  }
  return best.target;
}

export type ImportOutcome = {
  target: ManagerTarget;
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
};

function defaultsFor(entityKey: string): Record<string, string> {
  const baseCurrency = loadManagerSettings().baseCurrencyCode;
  return {
    status: "Active",
    kind: entityKey === "chart-of-accounts" ? "Account" : "",
    currency:
      entityKey === "customers" || entityKey === "suppliers" || entityKey === "bank-and-cash-accounts"
        ? baseCurrency
        : "",
  };
}

/** Map rows to entity fields, then merge/persist/post on the Go API. */
export async function applyRowsToTarget(
  target: ManagerTarget,
  rows: ImportRow[],
): Promise<ImportOutcome> {
  const definition = definitionFor(target);
  const outcome: ImportOutcome = {
    target,
    created: 0,
    updated: 0,
    skipped: 0,
    warnings: [],
  };
  if (!definition) {
    outcome.warnings.push(`Could not resolve the ${target.label} table.`);
    return outcome;
  }

  const defaults = defaultsFor(target.entityKey);
  const fieldKeys = definition.fields.map((field) => field.key);
  const payload: ImportRow[] = [];

  for (const row of rows) {
    if (!Object.values(row).some(Boolean)) {
      outcome.skipped += 1;
      continue;
    }
    const mapped: ImportRow = Object.fromEntries(
      fieldKeys.map((key) => [key, String(row[key] ?? defaults[key] ?? "")]),
    );
    if (row.id) mapped.id = String(row.id);
    if (row.reference) mapped.reference = String(row.reference);
    if (row.code) mapped.code = String(row.code);

    const missing = definition.fields.find(
      (field) => field.required && !(mapped[field.key] || "").trim(),
    );
    if (missing) {
      outcome.skipped += 1;
      outcome.warnings.push(
        `Skipped a ${definition.singular}: “${missing.label}” is required.`,
      );
      continue;
    }
    payload.push(mapped);
  }

  if (!payload.length) {
    return outcome;
  }

  const result = await uploadEntityImportRows(target.module, target.entityKey, payload);
  if (!result.ok) {
    outcome.warnings.push(result.error || "Import API failed.");
    outcome.warnings.push(...result.errors.slice(0, 8));
    return outcome;
  }

  outcome.created = result.imported;
  outcome.skipped += result.skipped;
  outcome.warnings.push(...result.errors);
  if (target.entityKey === "chart-of-accounts") rebuildOpeningBalanceEntry();

  return outcome;
}

function coerceRows(value: unknown): ImportRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) =>
      Object.fromEntries(
        Object.entries(item).map(([key, val]) => [
          key,
          val == null ? "" : typeof val === "object" ? JSON.stringify(val) : String(val),
        ]),
      ),
    );
}

/**
 * Best-effort parse of a Manager.io JSON backup / export. Manager exposes its
 * data either as a single array (one table) or as an object keyed by table name.
 */
export async function importManagerJson(
  fileName: string,
  text: string,
): Promise<ImportOutcome[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Invalid JSON — could not parse the Manager.io export.");
  }
  const outcomes: ImportOutcome[] = [];

  if (Array.isArray(parsed)) {
    const target = fileHint(fileName);
    if (!target) {
      throw new Error(
        "This JSON is a single list. Rename the file to include customer, supplier, item, account or employee so it can be routed.",
      );
    }
    outcomes.push(await applyRowsToTarget(target, coerceRows(parsed)));
    return outcomes;
  }

  if (parsed && typeof parsed === "object") {
    const container = parsed as Record<string, unknown>;
    for (const target of allTargets()) {
      const key = target.jsonKeys.find((candidate) => Array.isArray(container[candidate]));
      if (!key) continue;
      const rows = coerceRows(container[key]);
      if (rows.length) outcomes.push(await applyRowsToTarget(target, rows));
    }
  }

  if (!outcomes.length) {
    throw new Error(
      "No recognizable FinaceManagerIAG tables were found in this JSON file.",
    );
  }
  return outcomes;
}

/** Import one Manager.io export file (CSV/TSV/JSON) and auto-populate FinanceIAG. */
export async function importManagerFile(
  fileName: string,
  text: string,
  forcedTarget?: ManagerTarget,
): Promise<ImportOutcome[]> {
  const isJson = /\.json$/i.test(fileName) || text.trim().startsWith("{") || text.trim().startsWith("[");
  if (isJson && !forcedTarget) return importManagerJson(fileName, text);

  const target = forcedTarget ?? detectTarget(fileName, text);
  if (!target) {
    throw new Error(
      `Could not tell what “${fileName}” contains. Pick a table to import it into.`,
    );
  }
  if (target.entityKey === "requisitions") {
    throw new Error(
      "Material Requests need the line-item CSV importer. Open Projects → Material Requests → Import CSV (or download that page’s CSV template).",
    );
  }
  if (
    target.entityKey === "journal-entries" ||
    [
      "sales-invoices",
      "invoices",
      "purchase-invoices",
      "bills",
      "credit-notes",
      "debit-notes",
      "sales-quotes",
      "purchase-quotes",
      "sales-orders",
      "purchase-orders",
    ].includes(target.entityKey)
  ) {
    throw new Error(
      `${target.label} need the line-item CSV importer. Open that list page → Import CSV (or download that page’s CSV template).`,
    );
  }
  const definition = definitionFor(target);
  if (!definition) throw new Error(`Unknown target: ${target.label}.`);

  const rows = isJson
    ? (() => {
        try {
          return coerceRows(JSON.parse(text));
        } catch {
          throw new Error("Invalid JSON — could not parse the Manager.io export.");
        }
      })()
    : parseEntityCsv(text, definition);
  return [await applyRowsToTarget(target, rows)];
}
