/**
 * Accounting identity helpers — keep subledgers and bank activity aligned.
 *
 * Principles:
 * - Supplier/customer payments stamp the master party name (control account AP/AR).
 * - Cash movements stamp the operational Bank & Cash account name (not the CoA GL).
 * - Statement / activity matching must tolerate aliases, codes, and renames.
 */

import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecordsAsync } from "@/lib/records-store";

function norm(value: string | undefined | null) {
  return (value || "").trim().toLowerCase();
}

function partyLabel(record: ManagerRecord) {
  return (
    record.party ||
    record.customer ||
    record.supplier ||
    record.payee ||
    record.name ||
    record.company ||
    ""
  ).trim();
}

function masterRows(side: "receivable" | "payable") {
  if (side === "receivable") {
    return [
      ...loadRecords("sales", "customers"),
      ...loadRecords("sales", "customers-receivable"),
    ];
  }
  return [
    ...loadRecords("purchases", "suppliers"),
    ...loadRecords("purchases", "suppliers-payable"),
  ];
}

function masterName(row: ManagerRecord) {
  return (row.name || row.company || row.party || row.account || "").trim();
}

function masterCode(row: ManagerRecord) {
  return (row.code || row.accountCode || "").trim();
}

/** True when two party labels refer to the same customer/supplier (accounting identity). */
export function partiesMatch(a: string | undefined, b: string | undefined): boolean {
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // Avoid tiny false positives ("ab" in "abc ltd").
  if (left.length >= 3 && right.length >= 3) {
    if (left.includes(right) || right.includes(left)) return true;
  }
  return false;
}

/** Resolve a free-text payee/party to the customer/supplier master name. */
export function canonicalPartyName(
  side: "receivable" | "payable",
  raw: string,
): string {
  const input = raw.trim();
  if (!input) return "";
  const rows = masterRows(side);
  const key = norm(input);
  const exact =
    rows.find((row) => norm(masterName(row)) === key) ||
    rows.find((row) => norm(masterCode(row)) === key);
  if (exact) return masterName(exact) || input;

  const fuzzy = rows.find((row) => {
    const name = masterName(row);
    const code = masterCode(row);
    return partiesMatch(name, input) || (code && partiesMatch(code, input));
  });
  if (fuzzy) return masterName(fuzzy) || input;
  return input;
}

/** Resolve party from an applied bill/invoice when payee text is weak. */
export function partyFromAppliedDocument(
  side: "receivable" | "payable",
  appliedTo: string,
  fallback: string,
): string {
  const applied = appliedTo.trim();
  if (!applied) return canonicalPartyName(side, fallback);
  const docs =
    side === "receivable"
      ? [
          ...loadRecords("sales", "sales-invoices"),
          ...loadRecords("sales", "invoices"),
        ]
      : [
          ...loadRecords("purchases", "purchase-invoices"),
          ...loadRecords("purchases", "bills"),
        ];
  const key = applied.toLowerCase();
  const doc = docs.find((row) => {
    const ref = (row.reference || "").trim().toLowerCase();
    return row.id === applied || (ref && (ref === key || key.includes(ref)));
  });
  if (doc) {
    const fromDoc = partyLabel(doc);
    if (fromDoc) return canonicalPartyName(side, fromDoc);
  }
  return canonicalPartyName(side, fallback);
}

function bankRows() {
  return loadRecords("banking", "bank-and-cash-accounts");
}

function bankName(row: ManagerRecord) {
  return (row.name || row.account || "").trim();
}

/** Resolve picker / legacy text to the Bank & Cash master name. */
export function canonicalBankAccountName(raw: string): string {
  const input = raw.trim();
  if (!input) return "";
  const rows = bankRows();
  const key = norm(input);
  const byName = rows.find((row) => norm(bankName(row)) === key);
  if (byName) return bankName(byName) || input;

  const byCode = rows.filter((row) => norm(row.code) === key);
  if (byCode.length === 1) return bankName(byCode[0]) || input;

  // Only map a CoA GL label → bank when exactly one bank posts to that GL.
  const glMatches = rows.filter((row) => norm(row.glAccount) === key && bankName(row));
  if (glMatches.length === 1) return bankName(glMatches[0]) || input;

  // Fuzzy name match — but never via shared CoA code/GL labels.
  const fuzzy = rows.find((row) => {
    const name = bankName(row);
    return name && partiesMatch(name, input);
  });
  if (fuzzy) return bankName(fuzzy) || input;
  return input;
}

/** Match cash movement account fields to a Bank & Cash row (name, code, or alias). */
export function bankAccountsMatch(
  candidate: string | undefined,
  accountName: string,
): boolean {
  const left = (candidate || "").trim();
  const right = accountName.trim();
  if (!left || !right) return false;
  if (norm(left) === norm(right)) return true;

  const rows = bankRows();
  const rightRow = rows.find((row) => norm(bankName(row)) === norm(right));
  if (rightRow) {
    if (norm(bankName(rightRow)) === norm(left)) return true;
    // Code / GL are only identity when unique — many banks share Bank-UGX / 1050.
    const code = norm(rightRow.code);
    if (code && code === norm(left)) {
      const sharing = rows.filter((row) => norm(row.code) === code);
      if (sharing.length === 1) return true;
    }
    const gl = norm(rightRow.glAccount);
    if (gl && gl === norm(left)) {
      const sharing = rows.filter((row) => norm(row.glAccount) === gl);
      if (sharing.length === 1) return true;
    }
  }

  const leftCanon = canonicalBankAccountName(left);
  const rightCanon = canonicalBankAccountName(right);
  // Reject when canonicalization left both sides on the raw shared CoA label.
  if (!leftCanon || !rightCanon || norm(leftCanon) !== norm(rightCanon)) return false;
  if (rows.some((row) => norm(row.glAccount) === norm(leftCanon))) {
    const sharing = rows.filter((row) => norm(row.glAccount) === norm(leftCanon));
    if (sharing.length > 1) return false;
  }
  return true;
}

/**
 * When a supplier/customer is renamed, rewrite money + document party fields
 * so the subledger statement stays continuous (IAS 1 / faithful representation).
 */
export async function rewritePartyIdentity(input: {
  side: "receivable" | "payable";
  fromName: string;
  toName: string;
}): Promise<number> {
  const from = input.fromName.trim();
  const to = input.toName.trim();
  if (!from || !to || norm(from) === norm(to)) return 0;

  const moneyMod = input.side === "receivable" ? "receipts" : "payments";
  const docEntities =
    input.side === "receivable"
      ? [
          ["sales", "sales-invoices"],
          ["sales", "invoices"],
          ["sales", "credit-notes"],
        ]
      : [
          ["purchases", "purchase-invoices"],
          ["purchases", "bills"],
          ["purchases", "debit-notes"],
        ];

  let changed = 0;
  const rewriteCollection = async (module: string, entity: string) => {
    const rows = loadRecords(module, entity);
    let dirty = false;
    const next = rows.map((row) => {
      const party = partyLabel(row);
      if (!partiesMatch(party, from)) return row;
      dirty = true;
      changed += 1;
      return {
        ...row,
        party: to,
        ...(row.customer != null ? { customer: to } : {}),
        ...(row.supplier != null ? { supplier: to } : {}),
        ...(row.payee != null ? { payee: to } : {}),
        updatedAt: new Date().toISOString(),
      };
    });
    if (dirty) {
      await saveRecordsAsync(module, entity, next);
    }
  };

  await rewriteCollection("banking", moneyMod);
  for (const [module, entity] of docEntities) {
    await rewriteCollection(module, entity);
  }
  return changed;
}

/**
 * When a Bank & Cash account is renamed, rewrite cash movements so operational
 * bank activity stays continuous.
 */
export async function rewriteBankAccountIdentity(input: {
  fromName: string;
  toName: string;
}): Promise<number> {
  const from = input.fromName.trim();
  const to = input.toName.trim();
  if (!from || !to || norm(from) === norm(to)) return 0;

  let changed = 0;
  const rewriteMoney = async (entity: string, fields: string[]) => {
    const rows = loadRecords("banking", entity);
    let dirty = false;
    const next = rows.map((row) => {
      let touched = false;
      const patch: ManagerRecord = { ...row };
      for (const field of fields) {
        const value = (row[field] || "").trim();
        if (value && bankAccountsMatch(value, from)) {
          patch[field] = to;
          touched = true;
        }
      }
      if (!touched) return row;
      dirty = true;
      changed += 1;
      patch.updatedAt = new Date().toISOString();
      return patch;
    });
    if (dirty) await saveRecordsAsync("banking", entity, next);
  };

  await rewriteMoney("receipts", ["account", "bankAccount", "depositTo"]);
  await rewriteMoney("payments", ["account", "bankAccount", "paidFrom"]);
  await rewriteMoney("inter-account-transfers", [
    "from",
    "to",
    "fromAccount",
    "toAccount",
  ]);
  return changed;
}

const REPAIR_FLAG = "financeiag-party-bank-repair-v1";

/**
 * One-shot repair: stamp master party + bank names onto money rows that only
 * fuzzy-match. Restores supplier statements and Stanbic activity after renames.
 * Runs at most once per browser session unless `force` is set.
 */
export async function repairOrphanPartyAndBankLinks(options?: {
  force?: boolean;
}): Promise<{
  parties: number;
  banks: number;
}> {
  if (typeof window !== "undefined" && !options?.force) {
    try {
      if (sessionStorage.getItem(REPAIR_FLAG) === "1") {
        return { parties: 0, banks: 0 };
      }
      sessionStorage.setItem(REPAIR_FLAG, "1");
    } catch {
      /* private mode */
    }
  }

  let parties = 0;
  let banks = 0;

  const fixMoney = async (
    entity: "receipts" | "payments",
    side: "receivable" | "payable",
  ) => {
    const rows = loadRecords("banking", entity);
    let dirty = false;
    const next = rows.map((row) => {
      let touched = false;
      const patch: ManagerRecord = { ...row };
      const rawParty = partyLabel(row);
      if (rawParty) {
        const canonParty = partyFromAppliedDocument(
          side,
          row.appliedTo || "",
          rawParty,
        );
        if (canonParty && canonParty !== rawParty) {
          patch.party = canonParty;
          touched = true;
          parties += 1;
        }
      }
      const rawBank = (
        row.account ||
        row.bankAccount ||
        row.paidFrom ||
        row.depositTo ||
        ""
      ).trim();
      if (rawBank) {
        const canonBank = canonicalBankAccountName(rawBank);
        if (canonBank && canonBank !== rawBank) {
          patch.account = canonBank;
          if (patch.bankAccount != null || row.bankAccount) patch.bankAccount = canonBank;
          if (patch.paidFrom != null || row.paidFrom) patch.paidFrom = canonBank;
          if (patch.depositTo != null || row.depositTo) patch.depositTo = canonBank;
          touched = true;
          banks += 1;
        }
      }
      if (!touched) return row;
      dirty = true;
      patch.updatedAt = new Date().toISOString();
      return patch;
    });
    if (dirty) await saveRecordsAsync("banking", entity, next);
  };

  await fixMoney("receipts", "receivable");
  await fixMoney("payments", "payable");
  return { parties, banks };
}
