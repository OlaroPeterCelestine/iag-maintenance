/**
 * Uganda banks for employee salary payment details (name + bank code).
 * Users can also add their own bank names (persisted locally).
 */

import { loadList, saveList } from "@/lib/manager-settings";

export const UGANDA_BANKS_KEY = "financeiag-uganda-banks";
export const CUSTOM_UGANDA_BANKS_KEY = "financeiag-custom-uganda-banks";

export type UgandaBank = {
  name: string;
  /** 6-digit bank / clearing code */
  code: string;
};

/** Banks and codes from the payroll bank list. */
export const DEFAULT_UGANDA_BANKS: UgandaBank[] = [
  { name: "Bank of Africa", code: "130447" },
  { name: "Bank of Baroda", code: "020147" },
  { name: "Bank of India", code: "340147" },
  { name: "Barclays Bank", code: "011547" },
  { name: "BOU", code: "990147" },
  { name: "Cairo International Bank", code: "180147" },
  { name: "Centenary Bank", code: "163047" },
  { name: "Commercial Bank of Africa", code: "360147" },
  { name: "DFCU", code: "050147" },
  { name: "DTB", code: "190147" },
  { name: "Eco Bank", code: "290147" },
  { name: "Equity Bank", code: "300147" },
  { name: "Exim Bank", code: "320147" },
  { name: "Finance Trust Bank", code: "370147" },
  { name: "GT Bank", code: "270147" },
  { name: "Housing Finance Bank", code: "230147" },
  { name: "KCB", code: "253047" },
  { name: "NC Bank", code: "350147" },
  { name: "Orient Bank", code: "110147" },
  { name: "Post Bank", code: "560147" },
  { name: "Stanbic Bank", code: "040147" },
  { name: "Stanchart Bank", code: "080147" },
  { name: "Tropical Bank", code: "060147" },
  { name: "UBA", code: "260147" },
  { name: "Opportunity Bank", code: "380147" },
];

export type NamedBankRow = { id: string; name: string; code?: string };

export function findUgandaBank(nameOrCode: string): UgandaBank | undefined {
  const q = nameOrCode.trim().toLowerCase();
  if (!q) return undefined;
  return (
    DEFAULT_UGANDA_BANKS.find(
      (b) => b.name.toLowerCase() === q || b.code === q,
    ) ||
    loadCustomUgandaBankRows().find(
      (b) => b.name.toLowerCase() === q || (b.code || "") === q,
    )
  );
}

export function bankCodeForName(name: string): string {
  return findUgandaBank(name)?.code || "";
}

export function loadCustomUgandaBankRows(): UgandaBank[] {
  return loadList<NamedBankRow>(CUSTOM_UGANDA_BANKS_KEY, [])
    .map((r) => ({
      name: (r.name || "").trim(),
      code: (r.code || "").trim(),
    }))
    .filter((r) => r.name);
}

/** @deprecated Prefer loadCustomUgandaBankRows */
export function loadCustomUgandaBanks(): string[] {
  return loadCustomUgandaBankRows().map((r) => r.name);
}

export function addCustomUgandaBank(name: string, code = "") {
  const trimmed = name.trim();
  if (!trimmed) return;
  const existing = loadList<NamedBankRow>(CUSTOM_UGANDA_BANKS_KEY, []);
  const known =
    DEFAULT_UGANDA_BANKS.some((b) => b.name.toLowerCase() === trimmed.toLowerCase()) ||
    existing.some((r) => (r.name || "").toLowerCase() === trimmed.toLowerCase());
  if (known) return;
  saveList(CUSTOM_UGANDA_BANKS_KEY, [
    ...existing,
    {
      id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
      name: trimmed,
      code: code.trim(),
    },
  ]);
  window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
}

export type UgandaBankOption = {
  value: string;
  label: string;
  code: string;
  group?: string;
  meta?: string;
};

/** Default Uganda banks + any custom banks the user added. */
export function ugandaBankSelectOptions(): UgandaBankOption[] {
  const custom = loadCustomUgandaBankRows();
  const defaults = DEFAULT_UGANDA_BANKS.map((b) => ({
    value: b.name,
    label: b.name,
    code: b.code,
    meta: b.code,
    group: "Uganda banks",
  }));
  const customs = custom
    .filter(
      (c) => !DEFAULT_UGANDA_BANKS.some((b) => b.name.toLowerCase() === c.name.toLowerCase()),
    )
    .map((b) => ({
      value: b.name,
      label: b.name,
      code: b.code,
      meta: b.code || undefined,
      group: "Your banks",
    }));
  return [...defaults, ...customs].sort((a, b) => a.label.localeCompare(b.label));
}

/** Ensure storage seed exists (optional; defaults are in-code). */
export function ensureUgandaBanksSeeded() {
  if (typeof window === "undefined") return;
  const stored = loadList<NamedBankRow>(UGANDA_BANKS_KEY, []);
  if (stored.length === 0) {
    saveList(
      UGANDA_BANKS_KEY,
      DEFAULT_UGANDA_BANKS.map((b, i) => ({
        id: String(i + 1),
        name: b.name,
        code: b.code,
      })),
    );
  }
}
