/**
 * Employee departments — HR Departments records + quick-add list.
 * Both sources are Postgres-backed (payroll/departments entity rows and the
 * financeiag-employee-departments AppSetting) — no hardcoded names are ever
 * injected, so a fresh business sees an empty picker until it adds its own.
 */

import { loadList, saveList } from "@/lib/manager-settings";
import { loadRecords, saveRecords, notifyPersistFailure } from "@/lib/records-store";
import type { ManagerRecord } from "@/lib/manager-entities";

export const EMPLOYEE_DEPARTMENTS_KEY = "financeiag-employee-departments";

export type DepartmentRow = { id: string; name: string };

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

/** Active department names from HR → Departments entity. */
export function departmentRecordNames(): string[] {
  if (typeof window === "undefined") return [];
  return loadRecords("payroll", "departments")
    .filter((d) => d.name?.trim() && !/inactive|void|archived/i.test(d.status || ""))
    .map((d) => (d.name || "").trim());
}

export function loadEmployeeDepartments(): string[] {
  const stored = loadList<DepartmentRow>(EMPLOYEE_DEPARTMENTS_KEY, []);
  const fromSettings = stored.map((r) => (r.name || "").trim()).filter(Boolean);
  const fromRecords = departmentRecordNames();
  const merged = new Set([...fromSettings, ...fromRecords]);
  return [...merged].sort((a, b) => a.localeCompare(b));
}

/** Ensure a department exists as an HR record (and in the quick-add list). */
export function ensureDepartmentRecord(name: string): ManagerRecord | null {
  const trimmed = name.trim();
  if (!trimmed || typeof window === "undefined") return null;
  const existing = loadRecords("payroll", "departments");
  const match = existing.find(
    (d) => (d.name || "").trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (match) return match;
  const now = new Date().toISOString();
  const record: ManagerRecord = {
    id: newId(),
    name: trimmed,
    code: "",
    manager: "",
    costCenter: "",
    status: "Active",
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
  void saveRecords("payroll", "departments", [record, ...existing]).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "payroll/departments",
        saved.error || `Could not save the new department "${trimmed}".`,
      );
    }
  });
  return record;
}

/** Quick-add list only — use when the Departments entity form already saves the record. */
export function registerDepartmentName(name: string) {
  const trimmed = name.trim();
  if (!trimmed || typeof window === "undefined") return;
  const existing = loadList<DepartmentRow>(EMPLOYEE_DEPARTMENTS_KEY, []);
  if (
    existing.some((d) => (d.name || "").trim().toLowerCase() === trimmed.toLowerCase())
  ) {
    return;
  }
  saveList(EMPLOYEE_DEPARTMENTS_KEY, [
    ...existing,
    { id: newId(), name: trimmed },
  ]);
}

export function addEmployeeDepartment(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  registerDepartmentName(trimmed);
  ensureDepartmentRecord(trimmed);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
  }
}

export function employeeDepartmentSelectOptions(): {
  value: string;
  label: string;
}[] {
  return loadEmployeeDepartments().map((name) => ({ value: name, label: name }));
}

/** Driver names from Fleet → Drivers (active). */
export function fleetDriverSelectOptions(): { value: string; label: string }[] {
  if (typeof window === "undefined") return [];
  return loadRecords("fleet", "drivers")
    .filter((d) => d.name?.trim() && !/inactive|suspended|void/i.test(d.status || ""))
    .map((d) => ({
      value: (d.name || "").trim(),
      label: (d.name || "").trim(),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Ensure a driver exists under Fleet → Drivers (from pickers). */
export function ensureDriverRecord(name: string): ManagerRecord | null {
  const trimmed = name.trim();
  if (!trimmed || typeof window === "undefined") return null;
  const existing = loadRecords("fleet", "drivers");
  const match = existing.find(
    (d) => (d.name || "").trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (match) return match;
  const now = new Date().toISOString();
  const record: ManagerRecord = {
    id: newId(),
    name: trimmed,
    code: "",
    phone: "",
    licenseNumber: "",
    licenseClass: "B",
    status: "Active",
    notes: "",
    createdAt: now,
    updatedAt: now,
  };
  void saveRecords("fleet", "drivers", [record, ...existing]).then((saved) => {
    if (!saved.ok || saved.durable !== "postgres") {
      notifyPersistFailure(
        "fleet/drivers",
        saved.error || `Could not save the new driver "${trimmed}".`,
      );
    }
  });
  window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
  return record;
}
