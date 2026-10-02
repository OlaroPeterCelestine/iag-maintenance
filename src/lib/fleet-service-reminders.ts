import { loadRecords, saveRecordsAsync } from "@/lib/records-store";
import { parseAmount } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { nextDocumentReference } from "@/lib/document-references";

export type FleetReminderKind =
  | "service-date"
  | "service-km"
  | "insurance"
  | "registration"
  | "licence";

export type FleetReminderSeverity = "overdue" | "due-soon" | "upcoming";

export type FleetReminder = {
  id: string;
  kind: FleetReminderKind;
  severity: FleetReminderSeverity;
  subject: string;
  detail: string;
  vehicle?: string;
  vehicleId?: string;
  driver?: string;
  driverId?: string;
  dueDate?: string;
  dueKm?: number;
  odometer?: number;
  daysLeft?: number;
  kmLeft?: number;
};

const DAY_MS = 86_400_000;
const SOON_DAYS = 30;
const UPCOMING_DAYS = 60;
const KM_SOON = 500;
const KM_UPCOMING = 1500;

function daysUntil(isoDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const ms = Date.parse(`${isoDate}T00:00:00`) - Date.now();
  return Math.ceil(ms / DAY_MS);
}

function severityFromDays(days: number): FleetReminderSeverity {
  if (days < 0) return "overdue";
  if (days <= SOON_DAYS) return "due-soon";
  return "upcoming";
}

function severityFromKm(kmLeft: number): FleetReminderSeverity {
  if (kmLeft < 0) return "overdue";
  if (kmLeft <= KM_SOON) return "due-soon";
  return "upcoming";
}

function vehicleLabel(v: ManagerRecord) {
  return (v.name || v.registration || v.code || "Vehicle").trim();
}

/** Build due / overdue reminders for service, insurance, registration, and licences. */
export function buildFleetServiceReminders(): FleetReminder[] {
  const reminders: FleetReminder[] = [];
  const vehicles = loadRecords("fleet", "vehicles").filter(
    (v) => !/inactive|disposed|void/i.test(v.status || ""),
  );
  const drivers = loadRecords("fleet", "drivers").filter(
    (d) => !/inactive|suspended|void/i.test(d.status || ""),
  );

  for (const v of vehicles) {
    const label = vehicleLabel(v);
    const odo = parseAmount(v.odometer || "0");
    const nextKm = parseAmount(v.nextServiceKm || "0");
    const serviceDate = (v.nextServiceDate || "").trim();
    const insurance = (v.insuranceExpiry || "").trim();
    const registration = (v.registrationExpiry || "").trim();

    if (serviceDate) {
      const days = daysUntil(serviceDate);
      if (days !== null && days <= UPCOMING_DAYS) {
        reminders.push({
          id: `${v.id}:service-date`,
          kind: "service-date",
          severity: severityFromDays(days),
          subject: label,
          detail:
            days < 0
              ? `Service overdue by ${Math.abs(days)} day(s)`
              : `Service due in ${days} day(s)`,
          vehicle: label,
          vehicleId: v.id,
          dueDate: serviceDate,
          daysLeft: days,
          odometer: odo || undefined,
        });
      }
    }

    if (nextKm > 0 && odo > 0) {
      const kmLeft = Math.round(nextKm - odo);
      if (kmLeft <= KM_UPCOMING) {
        reminders.push({
          id: `${v.id}:service-km`,
          kind: "service-km",
          severity: severityFromKm(kmLeft),
          subject: label,
          detail:
            kmLeft < 0
              ? `Service overdue by ${Math.abs(kmLeft)} km`
              : `Service due in ${kmLeft} km`,
          vehicle: label,
          vehicleId: v.id,
          dueKm: nextKm,
          kmLeft,
          odometer: odo,
        });
      }
    }

    if (insurance) {
      const days = daysUntil(insurance);
      if (days !== null && days <= UPCOMING_DAYS) {
        reminders.push({
          id: `${v.id}:insurance`,
          kind: "insurance",
          severity: severityFromDays(days),
          subject: label,
          detail:
            days < 0
              ? `Insurance expired ${Math.abs(days)} day(s) ago`
              : `Insurance expires in ${days} day(s)`,
          vehicle: label,
          vehicleId: v.id,
          dueDate: insurance,
          daysLeft: days,
        });
      }
    }

    if (registration) {
      const days = daysUntil(registration);
      if (days !== null && days <= UPCOMING_DAYS) {
        reminders.push({
          id: `${v.id}:registration`,
          kind: "registration",
          severity: severityFromDays(days),
          subject: label,
          detail:
            days < 0
              ? `Registration expired ${Math.abs(days)} day(s) ago`
              : `Registration expires in ${days} day(s)`,
          vehicle: label,
          vehicleId: v.id,
          dueDate: registration,
          daysLeft: days,
        });
      }
    }
  }

  for (const d of drivers) {
    const licence = (d.licenseExpiry || "").trim();
    if (!licence) continue;
    const days = daysUntil(licence);
    if (days === null || days > UPCOMING_DAYS) continue;
    const name = (d.name || d.code || "Driver").trim();
    reminders.push({
      id: `${d.id}:licence`,
      kind: "licence",
      severity: severityFromDays(days),
      subject: name,
      detail:
        days < 0
          ? `Licence expired ${Math.abs(days)} day(s) ago`
          : `Licence expires in ${days} day(s)`,
      driver: name,
      driverId: d.id,
      vehicle: (d.vehicle || "").trim() || undefined,
      dueDate: licence,
      daysLeft: days,
    });
  }

  const rank = { overdue: 0, "due-soon": 1, upcoming: 2 };
  return reminders.sort((a, b) => {
    const s = rank[a.severity] - rank[b.severity];
    if (s !== 0) return s;
    return (a.daysLeft ?? a.kmLeft ?? 0) - (b.daysLeft ?? b.kmLeft ?? 0);
  });
}

/** Create a draft maintenance request from a service reminder. */
export async function createMaintenanceFromReminder(
  reminder: FleetReminder,
): Promise<ManagerRecord | null> {
  if (!reminder.vehicle && !reminder.vehicleId) return null;
  const existing = loadRecords("fleet", "maintenance-requests");
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const vehicle =
    reminder.vehicle ||
    loadRecords("fleet", "vehicles").find((v) => v.id === reminder.vehicleId)?.name ||
    "";
  const row: ManagerRecord = {
    id: globalThis.crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    reference: nextDocumentReference("maintenance-requests", existing, "Maintenance Requests"),
    date: today,
    vehicle,
    requestedBy: "Fleet reminders",
    priority: reminder.severity === "overdue" ? "Urgent" : "High",
    description: `${reminder.detail}. Auto-created from Service Reminders.`,
    neededBy: reminder.dueDate || today,
    status: "Draft",
  };
  const persisted = await saveRecordsAsync("fleet", "maintenance-requests", [row, ...existing]);
  if (!persisted.ok) return null;
  return row;
}

/** After maintenance completes, roll next service date (+3 months) and km (+5000) when set. */
export async function rollVehicleServiceAfterMaintenance(
  vehicleKey: string,
  odometerAtService?: number,
): Promise<void> {
  const key = vehicleKey.trim().toLowerCase();
  if (!key) return;
  const vehicles = loadRecords("fleet", "vehicles");
  const idx = vehicles.findIndex(
    (v) =>
      (v.name || "").trim().toLowerCase() === key ||
      (v.registration || "").trim().toLowerCase() === key ||
      (v.code || "").trim().toLowerCase() === key ||
      v.id === vehicleKey,
  );
  if (idx < 0) return;
  const v = vehicles[idx];
  const now = new Date();
  const nextDate = new Date(now);
  nextDate.setMonth(nextDate.getMonth() + 3);
  const nextDateIso = nextDate.toISOString().slice(0, 10);
  const odo =
    odometerAtService && odometerAtService > 0
      ? odometerAtService
      : parseAmount(v.odometer || "0");
  const nextKm = odo > 0 ? String(Math.round(odo + 5000)) : v.nextServiceKm || "";
  const updated: ManagerRecord = {
    ...v,
    nextServiceDate: nextDateIso,
    nextServiceKm: nextKm,
    odometer: odo > 0 ? String(odo) : v.odometer || "",
    updatedAt: now.toISOString(),
  };
  const next = [...vehicles];
  next[idx] = updated;
  await saveRecordsAsync("fleet", "vehicles", next);
}
