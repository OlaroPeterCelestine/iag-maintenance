import { loadManagerSettings, saveManagerSettings } from "@/lib/manager-settings";
import { isDateLocked } from "@/lib/history";
import { logHistory } from "@/lib/history";
import { getMemorySetting, setMemorySetting } from "@/lib/db/client-store";
import { persistSettingToDb } from "@/lib/db/sync";

export type PeriodStatus = "open" | "soft-closed" | "hard-closed";

export type AccountingPeriod = {
  id: string;
  name: string;
  from: string;
  to: string;
  status: PeriodStatus;
};

export const PERIODS_KEY = "financeiag-accounting-periods";

export function loadPeriods(): AccountingPeriod[] {
  if (typeof window === "undefined") return defaultPeriods();
  try {
    const stored = getMemorySetting<AccountingPeriod[] | null>(PERIODS_KEY, null);
    if (!stored || !Array.isArray(stored) || !stored.length) {
      const seeded = defaultPeriods();
      savePeriods(seeded);
      return seeded;
    }
    return stored;
  } catch {
    return defaultPeriods();
  }
}

export function savePeriods(periods: AccountingPeriod[]) {
  if (typeof window === "undefined") return;
  setMemorySetting(PERIODS_KEY, periods);
  window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
  void persistSettingToDb(PERIODS_KEY, periods);
}

function defaultPeriods(): AccountingPeriod[] {
  const year = new Date().getFullYear();
  return periodsForYear(year, "open");
}

function periodsForYear(year: number, status: PeriodStatus = "open"): AccountingPeriod[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = String(i + 1).padStart(2, "0");
    const lastDay = new Date(year, i + 1, 0).getDate();
    return {
      id: `${year}-${month}`,
      name: `${year}-${month}`,
      from: `${year}-${month}-01`,
      to: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
      status,
    };
  });
}

/**
 * Ensure monthly periods exist for the transaction year so historical dates
 * (prior years from migrated user data) can post without a missing-period gap.
 */
export function ensurePeriodsCoverDate(date: string): AccountingPeriod[] {
  const iso = (date || "").slice(0, 10);
  const year = Number(iso.slice(0, 4));
  if (!Number.isFinite(year) || year < 1990 || year > 2100) {
    return loadPeriods();
  }
  const existing = loadPeriods();
  const hasYear = existing.some((p) => p.id.startsWith(`${year}-`));
  if (hasYear) return existing;
  const merged = [...existing, ...periodsForYear(year, "open")].sort((a, b) =>
    a.from.localeCompare(b.from),
  );
  savePeriods(merged);
  return merged;
}

export function periodForDate(date: string): AccountingPeriod | null {
  const periods = ensurePeriodsCoverDate(date);
  return periods.find((p) => date >= p.from && date <= p.to) ?? null;
}

export function assertPeriodOpen(date: string): string | null {
  if (isDateLocked(date)) {
    return "Date is on or before the lock date.";
  }
  let allowBackdating = true;
  try {
    allowBackdating = loadManagerSettings().allowBackdating !== false;
  } catch {
    allowBackdating = true;
  }
  const period = periodForDate(date);
  if (!period) return null;
  if (period.status === "hard-closed") {
    // A hard close is deliberate and must not be waived by the convenience
    // "Allow backdating" flag (which defaults to ON) — that made every
    // hard-closed period silently postable and left signed-off comparatives
    // rewritable. Reopening the period is the only way in, and that is an
    // explicit, visible action.
    return `Period ${period.name} is hard-closed. Reopen it before posting.`;
  }
  if (period.status === "soft-closed") {
    if (allowBackdating) return null;
    return `Period ${period.name} is soft-closed. Only Administrators can post adjusting entries.`;
  }
  return null;
}

export function setPeriodStatus(id: string, status: PeriodStatus) {
  const periods = loadPeriods().map((p) => (p.id === id ? { ...p, status } : p));
  savePeriods(periods);
  if (status === "hard-closed") {
    const closed = periods.find((p) => p.id === id);
    if (closed) {
      const settings = loadManagerSettings();
      saveManagerSettings({
        ...settings,
        lockEnabled: true,
        lockDate: closed.to,
      });
    }
  }
  logHistory({
    action: `Period ${status}`,
    module: "Accounts",
    entity: "accounting-periods",
    record: { reference: id, name: id },
    details: `Period ${id} set to ${status}`,
  });
}
