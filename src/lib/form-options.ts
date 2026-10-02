import {
  loadList,
  loadManagerSettings,
  FOOTERS_KEY,
  defaultFooters,
  type FooterRow,
} from "@/lib/manager-settings";
import { roundMoney } from "@/lib/ledger/types";
import { getMemorySetting, setMemorySetting } from "@/lib/db/client-store";
import { persistSettingToDb } from "@/lib/db/sync";

export const FORM_OPTIONS_KEY = "financeiag-form-options";

export type FormOptionKey =
  | "columnLineNumber"
  | "columnDescription"
  | "columnDiscount"
  | "rounding"
  | "earlyPaymentDiscount"
  | "latePaymentFees"
  | "totalBaseCurrency"
  | "customTitle"
  | "hideDueDate"
  | "hideBalanceDue"
  | "showItemImages"
  | "actsAsDeliveryNote"
  | "footers";

export type FormOptionDef = {
  key: FormOptionKey;
  label: string;
};

/** Manager-style sales invoice form options. */
export const SALES_INVOICE_FORM_OPTIONS: FormOptionDef[] = [
  { key: "columnLineNumber", label: "Column — Line number" },
  { key: "columnDescription", label: "Column — Description" },
  { key: "columnDiscount", label: "Column — Discount" },
  { key: "rounding", label: "Rounding" },
  { key: "earlyPaymentDiscount", label: "Early payment discount" },
  { key: "latePaymentFees", label: "Late payment fees" },
  { key: "totalBaseCurrency", label: "Total amount in base currency" },
  { key: "customTitle", label: "Custom title" },
  { key: "hideDueDate", label: "Hide — Due date" },
  { key: "hideBalanceDue", label: "Hide — Balance due" },
  { key: "showItemImages", label: "Show item images" },
  { key: "actsAsDeliveryNote", label: "Also acts as delivery note" },
  { key: "footers", label: "Footers" },
];

export type FormOptionsState = Record<FormOptionKey, boolean>;

export const defaultSalesInvoiceOptions: FormOptionsState = {
  columnLineNumber: false,
  columnDescription: true,
  columnDiscount: false,
  rounding: false,
  earlyPaymentDiscount: false,
  latePaymentFees: false,
  totalBaseCurrency: false,
  customTitle: false,
  hideDueDate: false,
  hideBalanceDue: false,
  showItemImages: false,
  actsAsDeliveryNote: false,
  footers: false,
};

export function formOptionsStorageKey(formType: string) {
  return `${FORM_OPTIONS_KEY}:${formType}`;
}

export function loadFormOptions(formType: string, fallback: FormOptionsState): FormOptionsState {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = getMemorySetting<Partial<FormOptionsState> | null>(
      formOptionsStorageKey(formType),
      null,
    );
    if (!stored) return { ...fallback };
    return { ...fallback, ...stored };
  } catch {
    return { ...fallback };
  }
}

export function saveFormOptions(formType: string, options: FormOptionsState) {
  if (typeof window === "undefined") return;
  const key = formOptionsStorageKey(formType);
  setMemorySetting(key, options);
  window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
  void persistSettingToDb(key, options);
}

export function loadActiveFooters(formType = "Sales invoices"): FooterRow[] {
  return loadList(FOOTERS_KEY, defaultFooters).filter(
    (f) =>
      /yes|true|1|active/i.test(f.active || "Yes") &&
      (!f.formType || f.formType === formType || f.formType.toLowerCase().includes("sales")),
  );
}

export function supportsSalesInvoiceOptions(entityKey: string) {
  return entityKey === "sales-invoices" || entityKey === "invoices";
}

export type SalesInvoiceTotals = {
  subtotal: number;
  taxAmount: number;
  total: number;
  earlyDiscountAmount: number;
  amountIfPaidEarly: number;
  lateFees: number;
  amountDue: number;
  decimals: number;
  baseCurrencyCode: string;
  baseCurrencySymbol: string;
};

/** Live invoice math for form options (tax, rounding, early/late terms). */
export function computeSalesInvoiceTotals(input: {
  subtotal: number;
  taxRate?: number;
  rounding?: boolean;
  earlyPaymentDiscountPct?: number;
  latePaymentFees?: number;
}): SalesInvoiceTotals {
  const settings = loadManagerSettings();
  const decimals = input.rounding ? 0 : Math.max(0, settings.baseCurrencyDecimals ?? 0);
  const subtotal = roundMoney(Math.max(0, input.subtotal), decimals);
  const taxRate = Math.max(0, input.taxRate || 0);
  const taxAmount = roundMoney(subtotal * (taxRate / 100), decimals);
  let total = roundMoney(subtotal + taxAmount, decimals);
  if (input.rounding) total = Math.round(total);

  const earlyPct = Math.min(100, Math.max(0, input.earlyPaymentDiscountPct || 0));
  const earlyDiscountAmount = earlyPct
    ? roundMoney(total * (earlyPct / 100), decimals)
    : 0;
  const amountIfPaidEarly = roundMoney(total - earlyDiscountAmount, decimals);
  const lateFees = roundMoney(Math.max(0, input.latePaymentFees || 0), decimals);

  return {
    subtotal,
    taxAmount,
    total,
    earlyDiscountAmount,
    amountIfPaidEarly,
    lateFees,
    amountDue: total,
    decimals,
    baseCurrencyCode: settings.baseCurrencyCode || "UGX",
    baseCurrencySymbol: settings.baseCurrencySymbol || settings.baseCurrencyCode || "USh",
  };
}
