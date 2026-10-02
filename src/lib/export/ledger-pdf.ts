/**
 * Account / party / contractor ledger → PDF (jsPDF + autoTable via exportTablePdf).
 */
import { safeFilename } from "@/lib/export/download";
import { exportTablePdf, type TableExport } from "@/lib/export/table-export";
import { formatMoney } from "@/lib/ledger/money";
import type { LedgerAccount, LedgerLine } from "@/lib/ledger/types";

export type AccountLedgerOriginLabel = (line: LedgerLine) => string;

/** Build a TableExport for one chart-of-accounts ledger (Print / PDF / Excel / CSV). */
export function buildAccountLedgerExport(input: {
  account: Pick<LedgerAccount, "code" | "name" | "type">;
  lines: LedgerLine[];
  asOf: string;
  originLabel?: AccountLedgerOriginLabel;
}): TableExport {
  const { account, lines, asOf, originLabel } = input;
  let running = 0;
  const rows: (string | number)[][] = lines.map((line) => {
    running += line.debit - line.credit;
    return [
      line.date || "",
      line.narration || "",
      originLabel?.(line) || "",
      line.debit || "",
      line.credit || "",
      Math.round(running * 100) / 100,
    ];
  });
  const closing = Math.round(running * 100) / 100;
  const codeName = [account.code, account.name].filter(Boolean).join(" ").trim() || "Account";
  return {
    title: `Account ledger — ${codeName}`,
    filename: `account-ledger-${safeFilename(account.code || account.name || "ledger")}`,
    meta: [
      `As of ${asOf}`,
      account.type ? `Type: ${account.type}` : "",
      `${lines.length} line${lines.length === 1 ? "" : "s"}`,
      `Closing balance: ${formatMoney(closing)}`,
    ].filter(Boolean),
    columns: ["Date", "Narration", "Origin", "Debit", "Credit", "Balance"],
    rows: [...rows, ["", "Closing balance", "", "", "", closing]],
  };
}

export async function exportAccountLedgerPdf(input: {
  account: Pick<LedgerAccount, "code" | "name" | "type">;
  lines: LedgerLine[];
  asOf: string;
  originLabel?: AccountLedgerOriginLabel;
}): Promise<void> {
  await exportTablePdf(buildAccountLedgerExport(input));
}
