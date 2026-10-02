/** Tiny helper — keep out of financial-report-panel so ModulePage does not pull ~3k LOC. */

export type LiveReportKind =
  | "trial-balance"
  | "balance-sheet"
  | "profit-and-loss"
  | "cash-flow"
  | "tax-summary"
  | "inventory-value-summary"
  | "ledgers"
  | "aged-receivables"
  | "aged-payables"
  | "customer-statements"
  | "supplier-statements"
  | "contractor-ledgers"
  | "statement-of-changes-in-equity"
  | "control-account-reconciliation"
  | "bank-reconciliation"
  | "integrity-tests"
  | "profit-and-loss-by-class"
  | "division-exception-report"
  | "cash-flow-indirect"
  | "other-comprehensive-income"
  | "budget-vs-actual"
  | "forecast-p-l"
  | "management-analysis"
  | "notes-to-financial-statements"
  | "field-audit-log";

export function liveReportKind(entityKey: string): LiveReportKind | null {
  if (entityKey === "trial-balance") return "trial-balance";
  if (entityKey === "balance-sheet") return "balance-sheet";
  if (entityKey === "profit-and-loss") return "profit-and-loss";
  if (entityKey === "profit-and-loss-by-class") return "profit-and-loss-by-class";
  if (entityKey === "division-exception-report") return "division-exception-report";
  if (entityKey === "cash-flow") return "cash-flow";
  if (entityKey === "tax-summary") return "tax-summary";
  if (entityKey === "inventory-value-summary") return "inventory-value-summary";
  if (entityKey === "ledgers") return "ledgers";
  if (entityKey === "aged-receivables") return "aged-receivables";
  if (entityKey === "aged-payables") return "aged-payables";
  if (entityKey === "customer-statements" || entityKey === "customer-ledgers") {
    return "customer-statements";
  }
  if (entityKey === "supplier-statements" || entityKey === "supplier-ledgers") {
    return "supplier-statements";
  }
  if (entityKey === "contractor-ledgers" || entityKey === "contractor-statements") {
    return "contractor-ledgers";
  }
  if (entityKey === "statement-of-changes-in-equity") return "statement-of-changes-in-equity";
  if (entityKey === "control-account-reconciliation") return "control-account-reconciliation";
  if (entityKey === "bank-reconciliation") return "bank-reconciliation";
  if (entityKey === "integrity-tests") return "integrity-tests";
  if (entityKey === "cash-flow-indirect") return "cash-flow-indirect";
  if (entityKey === "other-comprehensive-income") return "other-comprehensive-income";
  if (entityKey === "budget-vs-actual") return "budget-vs-actual";
  if (entityKey === "forecast-p-l") return "forecast-p-l";
  if (entityKey === "management-analysis") return "management-analysis";
  if (entityKey === "notes-to-financial-statements") return "notes-to-financial-statements";
  if (entityKey === "field-audit-log") return "field-audit-log";
  return null;
}

export function isLiveFinancialView(entityKey: string) {
  return liveReportKind(entityKey) !== null;
}
