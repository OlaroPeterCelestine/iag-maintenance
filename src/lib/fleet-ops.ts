/**
 * Fleet operations — fulfill fuel requests, odometer updates, cost rollups.
 */

import { nextDocumentReference } from "@/lib/document-references";
import { postRecordToLedger } from "@/lib/ledger/api-post";
import { parseAmount, roundMoney } from "@/lib/ledger/types";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecords, saveRecordsAsync } from "@/lib/records-store";
import { readAuthSession } from "@/lib/auth";
import { USERS_KEY, loadList } from "@/lib/manager-settings";
import { rollVehicleServiceAfterMaintenance } from "@/lib/fleet-service-reminders";

function todayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function actorName() {
  const session = readAuthSession();
  if (!session) return "";
  const users = loadList<{ id?: string; email?: string; name?: string }>(USERS_KEY, []);
  const match = session.userId
    ? users.find((u) => u.id === session.userId)
    : undefined;
  return match?.name || session.name || session.username || session.email || "";
}

/** True when the fixed-asset row looks like a fleet unit (ignores status). */
export function looksLikeMotorVehicleAsset(record: ManagerRecord): boolean {
  const registration = (record.registrationNumber || record.registration || "").trim();
  if (registration) return true;
  const blob = [record.group, record.category, record.name, record.code]
    .join(" ")
    .toLowerCase();
  return /motor\s*vehicle|\bvehicles?\b|\bvan\b|\bpickup\b|\btruck\b|\bcar\b|motorcycle|fleet|automobile|bus\b/.test(
    blob,
  );
}

/** Motor vehicles / fleet units on Assets → Fixed Assets (active only). */
export function isMotorVehicleFixedAsset(record: ManagerRecord): boolean {
  if (/inactive|disposed|archived|disabled|sold|scrapped/i.test(record.status || "")) {
    return false;
  }
  return looksLikeMotorVehicleAsset(record);
}

function matchesVehicleKey(record: ManagerRecord, key: string) {
  return (
    (record.name || "").trim().toLowerCase() === key ||
    (record.registration || record.registrationNumber || "").trim().toLowerCase() === key ||
    (record.code || "").trim().toLowerCase() === key ||
    (record.fixedAsset || "").trim().toLowerCase() === key
  );
}

function vehicleIdentityKeys(record: ManagerRecord): string[] {
  return [
    record.code,
    record.fixedAsset,
    record.registration,
    record.registrationNumber,
    record.name,
  ]
    .map((v) => (v || "").trim().toLowerCase())
    .filter(Boolean);
}

function fleetVehicleFromAsset(asset: ManagerRecord, existing?: ManagerRecord): ManagerRecord {
  const now = new Date().toISOString();
  const code = (asset.code || existing?.code || "").trim();
  const name = (existing?.name || asset.name || code || "").trim();
  const registration = (
    existing?.registration ||
    asset.registrationNumber ||
    asset.registration ||
    ""
  ).trim();
  const makeModel = (
    existing?.makeModel ||
    asset.serialModel ||
    ""
  ).trim();
  return {
    ...(existing || {}),
    id: existing?.id || newId(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    name,
    code: code || existing?.code || "",
    registration: registration || existing?.registration || "",
    type: existing?.type || "Other",
    makeModel,
    fixedAsset: code || existing?.fixedAsset || "",
    department: existing?.department || "",
    location: existing?.location || asset.location || "",
    odometer: existing?.odometer || "0",
    acquired: existing?.acquired || asset.acquired || "",
    status: existing?.status || asset.status || "Active",
    notes: existing?.notes || "",
  };
}

/**
 * Keep Fleet → Vehicles in sync with a motor vehicle on the asset register.
 * Preserves odometer / insurance / driver on an existing fleet row.
 */
export async function syncFleetVehicleFromFixedAsset(
  asset: ManagerRecord,
): Promise<ManagerRecord | null> {
  if (!looksLikeMotorVehicleAsset(asset)) return null;
  if (/disposed|sold|scrapped/i.test(asset.status || "")) return null;

  const code = (asset.code || "").trim().toLowerCase();
  const name = (asset.name || "").trim().toLowerCase();
  const plate = (asset.registrationNumber || asset.registration || "").trim().toLowerCase();
  const vehicles = loadRecords("fleet", "vehicles");
  const idx = vehicles.findIndex((v) => {
    const keys = vehicleIdentityKeys(v);
    return (
      (code && keys.includes(code)) ||
      (plate && keys.includes(plate)) ||
      (name && keys.includes(name))
    );
  });

  const existing = idx >= 0 ? vehicles[idx] : undefined;
  const next = fleetVehicleFromAsset(asset, existing);
  // Never blank a filled odometer / ops field from the register.
  if (existing) {
    next.odometer = existing.odometer || next.odometer;
    next.driver = existing.driver || "";
    next.insuranceExpiry = existing.insuranceExpiry || "";
    next.insuranceProvider = existing.insuranceProvider || "";
    next.insurancePolicy = existing.insurancePolicy || "";
    next.registrationExpiry = existing.registrationExpiry || "";
    next.nextServiceKm = existing.nextServiceKm || "";
    next.nextServiceDate = existing.nextServiceDate || "";
    next.attachments = existing.attachments || "";
    if (existing.type && existing.type !== "Other") next.type = existing.type;
  }

  if (idx >= 0) {
    const prev = vehicles[idx];
    if (
      prev.name === next.name &&
      prev.code === next.code &&
      prev.registration === next.registration &&
      prev.fixedAsset === next.fixedAsset &&
      prev.makeModel === next.makeModel &&
      prev.location === next.location
    ) {
      return prev;
    }
    const updated = [...vehicles];
    updated[idx] = next;
    const persisted = await saveRecordsAsync("fleet", "vehicles", updated);
    if (!persisted.ok || persisted.durable !== "postgres") return null;
    return next;
  }

  const persisted = await saveRecordsAsync("fleet", "vehicles", [next, ...vehicles]);
  if (!persisted.ok || persisted.durable !== "postgres") return null;
  return next;
}

/**
 * Mirror plate / name onto the linked fixed asset so register and fleet stay aligned.
 * Does not create new assets (capitalization stays in Assets).
 */
export async function syncFixedAssetFromFleetVehicle(
  vehicle: ManagerRecord,
): Promise<ManagerRecord | null> {
  const link = (vehicle.fixedAsset || vehicle.code || "").trim();
  if (!link) return null;
  const key = link.toLowerCase();
  const assets = loadRecords("assets", "fixed-assets");
  const idx = assets.findIndex((a) => matchesVehicleKey(a, key));
  if (idx < 0) return null;

  const asset = assets[idx];
  const registration = (vehicle.registration || "").trim();
  const name = (vehicle.name || "").trim();
  const next: ManagerRecord = {
    ...asset,
    updatedAt: new Date().toISOString(),
  };
  let changed = false;
  if (registration && (asset.registrationNumber || "").trim() !== registration) {
    next.registrationNumber = registration;
    changed = true;
  }
  if (name && !(asset.name || "").trim()) {
    next.name = name;
    changed = true;
  }
  if ((vehicle.makeModel || "").trim() && !(asset.serialModel || "").trim()) {
    next.serialModel = vehicle.makeModel;
    changed = true;
  }
  if ((vehicle.location || "").trim() && !(asset.location || "").trim()) {
    next.location = vehicle.location;
    changed = true;
  }
  if (!changed) return asset;

  const updated = [...assets];
  updated[idx] = next;
  const persisted = await saveRecordsAsync("assets", "fixed-assets", updated);
  if (!persisted.ok || persisted.durable !== "postgres") return null;
  return next;
}

/** Resolve fleet row for a picker key; create from asset register when needed. */
export function ensureFleetVehicleForKey(vehicleKey: string): ManagerRecord | undefined {
  const key = vehicleKey.trim().toLowerCase();
  if (!key) return undefined;
  const vehicles = loadRecords("fleet", "vehicles");
  const found = vehicles.find((v) => matchesVehicleKey(v, key));
  if (found) return found;

  const asset = loadRecords("assets", "fixed-assets")
    .filter(isMotorVehicleFixedAsset)
    .find((v) => matchesVehicleKey(v, key));
  if (!asset) return undefined;
  const next = fleetVehicleFromAsset(asset);
  // Memory + durable write; surface failure if Postgres rejects.
  void saveRecordsAsync("fleet", "vehicles", [next, ...vehicles]).then((result) => {
    if (!result.ok || result.durable !== "postgres") {
      window.dispatchEvent(
        new CustomEvent("financeiag-persist-failed", {
          detail: {
            kind: "records",
            key: "fleet/vehicles",
            error: result.error || "Could not save fleet vehicle in Postgres",
          },
        }),
      );
    }
  });
  return next;
}

export function findVehicleByName(name: string): ManagerRecord | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  const fleet = loadRecords("fleet", "vehicles").find((v) => matchesVehicleKey(v, key));
  if (fleet) return fleet;
  return loadRecords("assets", "fixed-assets")
    .filter(isMotorVehicleFixedAsset)
    .find((v) => matchesVehicleKey(v, key));
}

/** Active fixed assets for Fleet → Vehicles “Linked fixed asset”. */
export function fixedAssetSelectOptions(): {
  value: string;
  label: string;
  meta?: string;
}[] {
  const rows: { value: string; label: string; meta?: string }[] = [];
  const seen = new Set<string>();
  for (const asset of loadRecords("assets", "fixed-assets")) {
    if (/inactive|disposed|archived|disabled|sold|scrapped/i.test(asset.status || "")) {
      continue;
    }
    const name = (asset.name || "").trim();
    const code = (asset.code || "").trim();
    const registration = (asset.registrationNumber || asset.registration || "").trim();
    const value = code || name;
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const labelParts = [name || value];
    if (code && code !== name) labelParts.push(code);
    if (registration && registration !== name && registration !== code) {
      labelParts.push(registration);
    }
    const meta = looksLikeMotorVehicleAsset(asset)
      ? "Motor vehicle"
      : (asset.group || asset.category || "").trim() || undefined;
    rows.push({ value, label: labelParts.join(" · "), meta });
  }
  return rows.sort((a, b) => {
    const aVeh = a.meta === "Motor vehicle" ? 0 : 1;
    const bVeh = b.meta === "Motor vehicle" ? 0 : 1;
    if (aVeh !== bVeh) return aVeh - bVeh;
    return a.label.localeCompare(b.label);
  });
}

export function findFixedAssetByKey(key: string): ManagerRecord | undefined {
  const k = key.trim().toLowerCase();
  if (!k) return undefined;
  return loadRecords("assets", "fixed-assets").find((asset) => {
    const code = (asset.code || "").trim().toLowerCase();
    const name = (asset.name || "").trim().toLowerCase();
    const registration = (asset.registrationNumber || asset.registration || "")
      .trim()
      .toLowerCase();
    return code === k || name === k || registration === k;
  });
}

/** Best-effort Type option from fixed-asset name / category / group. */
export function guessVehicleType(asset: ManagerRecord): string {
  const blob = [asset.name, asset.category, asset.group, asset.serialModel, asset.makeModel]
    .join(" ")
    .toLowerCase();
  if (/motor\s*cycle|\bike\b|boda/.test(blob)) return "Motorcycle";
  if (/\bpick[\s-]?up\b|\bdouble\s*cab\b/.test(blob)) return "Pickup";
  if (/\btruck\b|\blorry\b|\bcanter\b|\btipper\b|\bbox\s*body\b/.test(blob)) return "Truck";
  if (/\bvan\b|\bhiace\b|\bminibus\b/.test(blob)) return "Van";
  if (/\bcar\b|\bsedan\b|\bsuv\b|\bsalon\b/.test(blob)) return "Car";
  return "";
}

/** Options for fuel / trip / maintenance vehicle pickers — asset register first. */
export function fleetVehicleSelectOptions(): {
  value: string;
  label: string;
  meta?: string;
}[] {
  const rows: { value: string; label: string; meta?: string }[] = [];
  const seen = new Set<string>();

  function markAliases(record: ManagerRecord) {
    for (const id of vehicleIdentityKeys(record)) seen.add(id);
  }

  function push(value: string, label: string, meta: string | undefined, record: ManagerRecord) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    markAliases(record);
    rows.push({ value, label, meta });
  }

  // Primary: Assets → Fixed Assets. Prefer stable asset code as the stored value.
  for (const asset of loadRecords("assets", "fixed-assets")) {
    if (!isMotorVehicleFixedAsset(asset)) continue;
    const name = (asset.name || "").trim();
    const registration = (asset.registrationNumber || asset.registration || "").trim();
    const code = (asset.code || "").trim();
    const value = code || name || registration;
    if (!value) continue;
    const labelParts = [name || value];
    if (registration && registration !== name) labelParts.push(registration);
    if (code && code !== name && code !== registration) labelParts.push(code);
    push(
      value,
      labelParts.join(" · "),
      registration || code || undefined,
      asset,
    );
  }

  // Fleet → Vehicles not already covered by the register.
  for (const v of loadRecords("fleet", "vehicles")) {
    if (/inactive|disposed|archived|disabled/i.test(v.status || "")) continue;
    const name = (v.name || "").trim();
    const registration = (v.registration || "").trim();
    const code = (v.code || v.fixedAsset || "").trim();
    const value = code || name || registration;
    if (!value) continue;
    if (vehicleIdentityKeys(v).some((id) => seen.has(id))) continue;
    push(
      value,
      registration && name && registration !== name ? `${name} · ${registration}` : value,
      registration && registration !== value ? registration : undefined,
      v,
    );
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** Reject odometer that is lower than the vehicle’s last reading. */
export function assertOdometerNotDecreasing(vehicleName: string, odometer: number) {
  if (!odometer || odometer <= 0) return;
  // Prefer the fleet ops row (has odometer); fall back to register.
  const fleet = ensureFleetVehicleForKey(vehicleName) || findVehicleByName(vehicleName);
  if (!fleet) return;
  const prior = parseAmount(fleet.odometer);
  if (prior > 0 && odometer + 0.0001 < prior) {
    throw new Error(
      `Odometer ${odometer} km is below the vehicle’s last reading (${prior} km).`,
    );
  }
}

export async function updateVehicleOdometer(vehicleName: string, odometer: number) {
  if (!odometer || odometer <= 0) return;
  const vehicle = ensureFleetVehicleForKey(vehicleName);
  if (!vehicle) return;
  const vehicles = loadRecords("fleet", "vehicles");
  const idx = vehicles.findIndex((v) => v.id === vehicle.id);
  if (idx < 0) return;
  const prior = parseAmount(vehicles[idx].odometer);
  if (prior > 0 && odometer < prior) return;
  vehicles[idx] = {
    ...vehicles[idx],
    odometer: String(odometer),
    updatedAt: new Date().toISOString(),
  };
  await saveRecordsAsync("fleet", "vehicles", vehicles);
}

/**
 * Fulfill a fuel request after the approval chain has marked it Paid.
 * Creates a Posted fuel log and sets the request to Fulfilled.
 */
export async function fulfillFuelRequest(input: {
  requestId: string;
  litres?: number;
  amount?: number;
  odometer?: number;
  station?: string;
  date?: string;
}): Promise<{ request: ManagerRecord; log: ManagerRecord }> {
  const requests = loadRecords("fleet", "fuel-requests");
  const idx = requests.findIndex((r) => r.id === input.requestId);
  if (idx < 0) throw new Error("Fuel request not found.");
  const request = requests[idx];
  if (/fulfilled|cancelled|canceled|rejected|void/i.test(request.status || "")) {
    throw new Error(`Request is already ${request.status}.`);
  }
  if (!/^paid$/i.test(request.status || "")) {
    throw new Error(
      `Cannot fulfill until Finance has marked the request Paid (current status: “${request.status || "Draft"}”).`,
    );
  }

  const litres = input.litres ?? parseAmount(request.litres);
  const amount = input.amount ?? parseAmount(request.amount);
  const odometer = input.odometer ?? 0;
  if (odometer > 0) {
    assertOdometerNotDecreasing(request.vehicle || "", odometer);
  }

  const logs = loadRecords("fleet", "fuel-logs");
  const now = new Date().toISOString();
  const date = input.date || todayIsoDate();
  const log: ManagerRecord = {
    id: newId(),
    reference: nextDocumentReference("fuel-logs", logs),
    date,
    vehicle: request.vehicle || "",
    driver: request.driver || "",
    fuelRequest: request.reference || request.id,
    litres: String(litres),
    odometer: odometer ? String(odometer) : "",
    amount: String(amount),
    currency: request.currency || "UGX",
    station: input.station || request.station || "",
    expenseAccount: "Fuel Expense",
    bankAccount: request.bankAccount || "Cash-UGX",
    paidFrom: request.bankAccount || "Cash-UGX",
    department: request.department || "Fleet",
    division: request.division || "Fleet",
    status: "Posted",
    notes: `Fulfilled from ${request.reference || "fuel request"} by ${actorName() || "system"}`,
    attachments: request.attachments || "",
    createdAt: now,
    updatedAt: now,
  };

  const logSaved = await saveRecordsAsync("fleet", "fuel-logs", [log, ...logs]);
  if (!logSaved.ok) {
    throw new Error(logSaved.error || "Could not save fuel log to the database.");
  }
  await postRecordToLedger("fleet", "fuel-logs", log);
  if (odometer > 0) await updateVehicleOdometer(request.vehicle || "", odometer);

  const updatedRequest: ManagerRecord = {
    ...request,
    status: "Fulfilled",
    fulfilledDate: date,
    fuelLog: log.reference,
    litres: String(litres),
    amount: String(amount),
    updatedAt: now,
  };
  const next = [...requests];
  next[idx] = updatedRequest;
  const reqSaved = await saveRecordsAsync("fleet", "fuel-requests", next);
  if (!reqSaved.ok) {
    throw new Error(reqSaved.error || "Fuel log saved but request status failed to update.");
  }

  return { request: updatedRequest, log };
}

export async function completeTripRequest(input: {
  requestId: string;
  actualKm?: number;
  odometerEnd?: number;
}): Promise<ManagerRecord> {
  const trips = loadRecords("fleet", "trip-requests");
  const idx = trips.findIndex((t) => t.id === input.requestId);
  if (idx < 0) throw new Error("Trip request not found.");
  const trip = trips[idx];
  if (/completed|cancelled|canceled|rejected|void/i.test(trip.status || "")) {
    throw new Error(`Trip is already ${trip.status}.`);
  }
  if (!/^paid$/i.test(trip.status || "")) {
    throw new Error(
      `Cannot complete until Finance has marked the trip Paid (current status: “${trip.status || "Draft"}”).`,
    );
  }
  const odometerEnd = input.odometerEnd ?? parseAmount(trip.odometerEnd);
  if (odometerEnd > 0) {
    assertOdometerNotDecreasing(trip.vehicle || "", odometerEnd);
    await updateVehicleOdometer(trip.vehicle || "", odometerEnd);
  }
  const actualKm =
    input.actualKm ??
    (parseAmount(trip.actualKm) ||
      (odometerEnd > 0 && parseAmount(trip.odometerStart)
        ? roundMoney(odometerEnd - parseAmount(trip.odometerStart))
        : parseAmount(trip.estimatedKm)));
  const updated: ManagerRecord = {
    ...trip,
    status: "Completed",
    actualKm: actualKm ? String(actualKm) : trip.actualKm || "",
    odometerEnd: odometerEnd ? String(odometerEnd) : trip.odometerEnd || "",
    completedDate: todayIsoDate(),
    updatedAt: new Date().toISOString(),
  };
  const next = [...trips];
  next[idx] = updated;
  const saved = await saveRecordsAsync("fleet", "trip-requests", next);
  if (!saved.ok) {
    throw new Error(saved.error || "Could not save completed trip to the database.");
  }
  return updated;
}

export type FleetVehicleCostRow = {
  vehicle: string;
  registration: string;
  fuelSpend: number;
  litres: number;
  kmPerLitre: number | null;
  maintenanceSpend: number;
  trips: number;
  odometer: number;
};

/** Cost and efficiency rollup per vehicle for the Fleet Cost Report. */
export function fleetCostByVehicle(): FleetVehicleCostRow[] {
  const vehicles = loadRecords("fleet", "vehicles");
  const register = loadRecords("assets", "fixed-assets").filter(isMotorVehicleFixedAsset);
  const fuelLogs = loadRecords("fleet", "fuel-logs").filter(
    (r) => !/draft|void|voided|cancelled/i.test(r.status || ""),
  );
  const maintenance = loadRecords("fleet", "maintenance-requests").filter(
    (r) => /^(paid|completed|fulfilled)$/i.test(r.status || ""),
  );
  const trips = loadRecords("fleet", "trip-requests").filter(
    (r) => /^(paid|completed|fulfilled)$/i.test(r.status || ""),
  );

  const names = new Set<string>();
  for (const v of vehicles) if (v.name?.trim()) names.add(v.name.trim());
  for (const a of register) if (a.name?.trim()) names.add(a.name.trim());
  for (const f of fuelLogs) if (f.vehicle?.trim()) names.add(f.vehicle.trim());

  return Array.from(names)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const key = name.toLowerCase();
      const found =
        vehicles.find((v) => matchesVehicleKey(v, key)) ||
        register.find((v) => matchesVehicleKey(v, key));
      const registration =
        found?.registration || found?.registrationNumber || "";
      const odometer = parseAmount(found?.odometer);
      const logs = fuelLogs.filter(
        (f) => (f.vehicle || "").trim().toLowerCase() === name.toLowerCase(),
      );
      const fuelSpend = roundMoney(logs.reduce((n, r) => n + parseAmount(r.amount), 0));
      const litres = roundMoney(logs.reduce((n, r) => n + parseAmount(r.litres), 0));
      const odos = logs
        .map((r) => parseAmount(r.odometer))
        .filter((n) => n > 0)
        .sort((a, b) => a - b);
      let kmPerLitre: number | null = null;
      if (odos.length >= 2 && litres > 0) {
        const span = odos[odos.length - 1] - odos[0];
        if (span > 0) kmPerLitre = roundMoney(span / litres);
      }
      const maint = maintenance.filter(
        (m) => (m.vehicle || "").trim().toLowerCase() === name.toLowerCase(),
      );
      const maintenanceSpend = roundMoney(
        maint.reduce(
          (n, r) => n + parseAmount(r.actualCost || r.estimatedCost || r.amount),
          0,
        ),
      );
      const tripCount = trips.filter(
        (t) => (t.vehicle || "").trim().toLowerCase() === name.toLowerCase(),
      ).length;
      return {
        vehicle: name,
        registration,
        fuelSpend,
        litres,
        kmPerLitre,
        maintenanceSpend,
        trips: tripCount,
        odometer,
      };
    });
}

export function fuelRequestAwaitingFulfillment(record: ManagerRecord) {
  return /^paid$/i.test(record.status || "");
}

export function tripAwaitingCompletion(record: ManagerRecord) {
  return /^paid$/i.test(record.status || "");
}

export function maintenanceAwaitingCompletion(record: ManagerRecord) {
  return /^paid$/i.test(record.status || "");
}

/** Mark maintenance complete after Finance has marked the request Paid. */
export async function completeMaintenanceRequest(input: {
  requestId: string;
  actualCost?: number;
}): Promise<ManagerRecord> {
  const rows = loadRecords("fleet", "maintenance-requests");
  const idx = rows.findIndex((r) => r.id === input.requestId);
  if (idx < 0) throw new Error("Maintenance request not found.");
  const row = rows[idx];
  if (/completed|cancelled|canceled|rejected|void/i.test(row.status || "")) {
    throw new Error(`Maintenance is already ${row.status}.`);
  }
  if (!/^paid$/i.test(row.status || "")) {
    throw new Error(
      `Cannot complete until Finance has marked the request Paid (current status: “${row.status || "Draft"}”).`,
    );
  }
  const actualCost =
    input.actualCost ?? parseAmount(row.actualCost || row.estimatedCost || row.amount);
  const updated: ManagerRecord = {
    ...row,
    status: "Completed",
    actualCost: actualCost ? String(actualCost) : row.actualCost || "",
    completedDate: todayIsoDate(),
    updatedAt: new Date().toISOString(),
  };
  const next = [...rows];
  next[idx] = updated;
  const saved = await saveRecordsAsync("fleet", "maintenance-requests", next);
  if (!saved.ok) {
    throw new Error(saved.error || "Could not save completed maintenance to the database.");
  }
  const odo = parseAmount(row.odometer || "");
  await rollVehicleServiceAfterMaintenance(row.vehicle || "", odo || undefined);
  return updated;
}
