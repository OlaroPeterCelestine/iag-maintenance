/**
 * Operational bank ledger → Print / PDF / Excel / CSV.
 * Built from Bank & Cash activity (receipts, payments, transfers), not the shared CoA.
 */
import type { BankAccountActivity, BankActivityKind } from "@/lib/banking-summary";
import { safeFilename } from "@/lib/export/download";
import { exportTablePdf, type TableExport } from "@/lib/export/table-export";
import { formatMoney } from "@/lib/ledger/money";

function kindLabel(kind: BankActivityKind) {
  switch (kind) {
    case "opening":
      return "Opening";
    case "receipt":
      return "Receipt";
    case "payment":
      return "Payment";
    case "transfer-in":
      return "Transfer in";
    case "transfer-out":
      return "Transfer out";
  }
}

export function buildBankLedgerExport(input: {
  activity: BankAccountActivity;
  from?: string;
  to?: string;
}): TableExport {
  const { activity, from, to } = input;
  const currency = activity.currency || undefined;
  const money = (n: number) => (n ? formatMoney(n, { currencyCode: currency }) : "");
  const rows: (string | number)[][] = activity.lines.map((line) => [
    line.date || "",
    kindLabel(line.kind),
    line.reference || "",
    line.party || "",
    line.description || "",
    line.allocation || "",
    money(line.moneyIn),
    money(line.moneyOut),
    formatMoney(line.balance, { currencyCode: currency }),
  ]);

  const period =
    from || to
      ? `Period ${from || "…"} → ${to || "…"}`
      : "All dates";

  return {
    title: `Bank ledger — ${activity.account}`,
    filename: `bank-ledger-${safeFilename(activity.account)}`,
    meta: [
      period,
      activity.currency ? `Currency: ${activity.currency}` : "",
      `${activity.receiptCount} receipt(s) · ${activity.paymentCount} payment(s) · ${activity.transferCount} transfer(s)`,
      `Opening: ${formatMoney(activity.openingBalance, { currencyCode: currency })}`,
      `Closing: ${formatMoney(activity.closingBalance, { currencyCode: currency })}`,
    ].filter(Boolean),
    columns: [
      "Date",
      "Type",
      "Reference",
      "Party / contra",
      "Description",
      "Allocation",
      "Money in",
      "Money out",
      "Balance",
    ],
    rows: [
      ...rows,
      [
        "",
        "",
        "",
        "",
        "Closing balance",
        "",
        "",
        "",
        formatMoney(activity.closingBalance, { currencyCode: currency }),
      ],
    ],
  };
}

export async function exportBankLedgerPdf(input: {
  activity: BankAccountActivity;
  from?: string;
  to?: string;
}): Promise<void> {
  await exportTablePdf(buildBankLedgerExport(input));
}
