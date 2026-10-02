"use client";

import { PartyLedgerPanel } from "@/components/party-ledger-panel";

/** Contractor ledgers — same AP logic and UI as supplier ledgers. */
export function ContractorLedgerPanel() {
  return <PartyLedgerPanel side="payable" payableSource="contractors" />;
}
