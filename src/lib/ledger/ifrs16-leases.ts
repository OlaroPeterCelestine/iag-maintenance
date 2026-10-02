import {
  ensureAccount,
  loadChartOfAccounts,
  saveChartOfAccounts,
} from "@/lib/ledger/chart-of-accounts";
import { postBalancedEntry } from "@/lib/ledger/posting";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";

/**
 * IFRS 16 — Leases.
 * Initial recognition: Dr ROU asset / Cr Lease liability.
 * Subsequent: depreciation of ROU + interest on liability + payment.
 */
export function capitalizeLease(lease: ManagerRecord): { ok: true } | { ok: false; error: string } {
  const pv = parseAmount(lease.presentValue || lease.liability || lease.amount);
  if (!pv) return { ok: false, error: "Lease present value is required." };
  let accounts = loadChartOfAccounts();
  const rou = ensureAccount(accounts, "Right-of-use assets", "Asset", "Non-current assets", "1540");
  accounts = rou.accounts;
  const liability = ensureAccount(accounts, "Lease liabilities", "Liability", "Non-current liabilities", "2600");
  accounts = liability.accounts;
  saveChartOfAccounts(accounts);
  const date = lease.date || lease.commencementDate || new Date().toISOString().slice(0, 10);
  return postBalancedEntry({
    date,
    narration: `IFRS 16 capitalize · ${lease.name || lease.reference || lease.id.slice(0, 8)}`,
    sourceModule: "assets",
    sourceEntity: "leases",
    sourceRecordId: `lease-cap-${lease.id}`,
    lines: [
      {
        accountId: rou.account.id,
        accountCode: rou.account.code,
        accountName: rou.account.name,
        debit: pv,
        credit: 0,
      },
      {
        accountId: liability.account.id,
        accountCode: liability.account.code,
        accountName: liability.account.name,
        debit: 0,
        credit: pv,
      },
    ],
  }).ok
    ? { ok: true }
    : { ok: false, error: "Could not capitalize lease." };
}

export function postLeasePayment(input: {
  leaseId: string;
  date: string;
  payment: number;
  interest: number;
  bankAccount?: string;
}): { ok: true } | { ok: false; error: string } {
  const payment = roundMoney(Math.max(0, input.payment));
  const interest = roundMoney(Math.max(0, input.interest));
  const principal = roundMoney(Math.max(0, payment - interest));
  if (!payment) return { ok: false, error: "Payment amount required." };
  let accounts = loadChartOfAccounts();
  const liability = ensureAccount(accounts, "Lease liabilities", "Liability", "Non-current liabilities", "2600");
  accounts = liability.accounts;
  const interestExp = ensureAccount(accounts, "Lease interest expense", "Expense", "Finance costs", "5900");
  accounts = interestExp.accounts;
  const bank = ensureAccount(
    accounts,
    input.bankAccount || "Cash at bank",
    "Asset",
    "Current assets",
    "1100",
  );
  accounts = bank.accounts;
  saveChartOfAccounts(accounts);
  const lines = [
    {
      accountId: liability.account.id,
      accountCode: liability.account.code,
      accountName: liability.account.name,
      debit: principal,
      credit: 0,
    },
    {
      accountId: bank.account.id,
      accountCode: bank.account.code,
      accountName: bank.account.name,
      debit: 0,
      credit: payment,
    },
  ];
  if (interest > 0) {
    lines.unshift({
      accountId: interestExp.account.id,
      accountCode: interestExp.account.code,
      accountName: interestExp.account.name,
      debit: interest,
      credit: 0,
    });
  }
  return postBalancedEntry({
    date: input.date,
    narration: `Lease payment · ${input.leaseId}`,
    sourceModule: "assets",
    sourceEntity: "lease-payments",
    sourceRecordId: `lease-pay-${input.leaseId}-${input.date}`,
    lines,
  }).ok
    ? { ok: true }
    : { ok: false, error: "Could not post lease payment." };
}

export function depreciateRouAsset(lease: ManagerRecord, month: string) {
  const cost = parseAmount(lease.presentValue || lease.amount);
  const months = Math.max(1, parseAmount(lease.termMonths || "12"));
  const amount = roundMoney(cost / months);
  if (!amount) return { ok: true as const, amount: 0 };
  let accounts = loadChartOfAccounts();
  const exp = ensureAccount(accounts, "Depreciation — ROU assets", "Expense", "Operating expenses", "5510");
  accounts = exp.accounts;
  const accum = ensureAccount(
    accounts,
    "Accumulated depreciation — ROU",
    "Asset",
    "Non-current assets",
    "1545",
  );
  accounts = accum.accounts;
  saveChartOfAccounts(accounts);
  const asOf = `${month}-28`;
  return postBalancedEntry({
    date: asOf,
    narration: `ROU depreciation · ${lease.name || lease.id.slice(0, 8)}`,
    sourceModule: "assets",
    sourceEntity: "rou-depreciation",
    sourceRecordId: `rou-dep-${lease.id}-${month}`,
    lines: [
      {
        accountId: exp.account.id,
        accountCode: exp.account.code,
        accountName: exp.account.name,
        debit: amount,
        credit: 0,
      },
      {
        accountId: accum.account.id,
        accountCode: accum.account.code,
        accountName: accum.account.name,
        debit: 0,
        credit: amount,
      },
    ],
  }).ok
    ? { ok: true as const, amount }
    : { ok: false as const, error: "ROU depreciation failed." };
}

export function runMonthlyLeaseAccounting(month: string) {
  const leases = loadRecords("assets", "leases").filter(
    (l) => !/inactive|terminated|draft/i.test(l.status || ""),
  );
  let count = 0;
  for (const lease of leases) {
    capitalizeLease(lease);
    depreciateRouAsset(lease, month);
    const payment = parseAmount(lease.monthlyPayment);
    const rate = parseAmount(lease.interestRate) / 100 / 12;
    const liability = parseAmount(lease.presentValue || lease.amount);
    const interest = roundMoney(liability * rate);
    if (payment > 0) {
      postLeasePayment({
        leaseId: lease.id,
        date: `${month}-28`,
        payment,
        interest,
        bankAccount: lease.bankAccount,
      });
      const remaining = roundMoney(Math.max(0, liability - (payment - interest)));
      lease.presentValue = String(remaining);
      count += 1;
    }
  }
  void saveRecords(
    "assets",
    "leases",
    loadRecords("assets", "leases").map((l) => {
      const updated = leases.find((x) => x.id === l.id);
      return updated || l;
    }),
  ).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "assets/leases",
        saved.error ||
          "Lease accounting was posted to the ledger, but lease balances could not be updated.",
      );
    }
  });
  return { ok: true as const, count };
}
