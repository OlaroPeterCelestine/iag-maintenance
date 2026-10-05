/**
 * Energy and machine KPIs on the maintenance desk — features iag-mes and
 * iag-production already serve. Same adapters as the Production app's
 * Energy and Machine Performance tabs (iag-production
 * src/lib/iag/records/performance.ts), so both apps read the same figures.
 *
 *   iag-mes         /energy/summary, /energy/readings → energy
 *   iag-production  /kpis/machines                    → machine-performance
 *                   /measures                         → output for kWh per kg
 */
import { gatewayFetch, unwrapList } from "@/lib/iag/gateway";
import {
  isoDate,
  omitEmpty,
  pick,
  str,
  type AppRecord,
  type RecordAdapter,
  InputError,
} from "@/lib/iag/records/types";

type Row = Record<string, unknown>;

const PLANT_TIME_ZONE = "Africa/Kampala";

function withMeta(mapped: Omit<AppRecord, "id"> & { id?: string }, id: string): AppRecord {
  return {
    ...mapped,
    id: mapped.id || id,
    createdAt: mapped.createdAt || "",
    updatedAt: mapped.updatedAt || mapped.createdAt || "",
  } as AppRecord;
}

function titleCase(value: string): string {
  return value
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function snake(value: unknown): string {
  return str(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function num(value: unknown): number | undefined {
  const raw = str(value).trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new InputError(`"${raw}" is not a number.`);
  return n;
}

/** The plant-local calendar date of an instant (period starts are UTC). */
export function plantDate(value: unknown): string {
  const ms = Date.parse(str(value));
  if (!Number.isFinite(ms)) return isoDate(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PLANT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function oneOf(value: unknown, set: string[], label: string): string | undefined {
  const v = snake(value);
  if (!v) return undefined;
  if (!set.includes(v)) throw new InputError(`${label} must be one of: ${set.map(titleCase).join(", ")}.`);
  return v;
}

/* ────────────────────────────── KPIs ─────────────────────────────── */

/** Days of KPI history the performance screens read. */
const KPI_WINDOW_DAYS = 31;

type KpiDefinition = { name?: string; unit?: string; category?: string; direction?: string };

function formatValue(value: unknown, unit: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return unit === "%" ? `${rounded}%` : unit ? `${rounded} ${unit}` : String(rounded);
}

function kpiToRecord(
  row: Row,
  defs: Record<string, KpiDefinition>,
  scopeLabel: (key: string) => string,
): Omit<AppRecord, "id"> & { id?: string } {
  const code = str(pick(row, "kpi_code"));
  const def = defs[code] || {};
  const unit = str(def.unit);
  const key = str(pick(row, "scope_key"));
  const status = str(pick(row, "status"));
  return {
    id: [code, key, str(pick(row, "period_start"))].join("|"),
    date: plantDate(pick(row, "period_start")),
    scope: scopeLabel(key) || key,
    scopeKey: key,
    kpiCode: code,
    kpi: str(def.name) || code,
    category: titleCase(str(def.category)),
    value: formatValue(pick(row, "value"), unit),
    target: row.target != null ? formatValue(row.target, unit) : "",
    status: status === "none" || !status ? "No target" : titleCase(status),
    grain: titleCase(str(pick(row, "grain"))),
    createdAt: str(pick(row, "computed_at")),
    updatedAt: str(pick(row, "computed_at")),
  };
}

async function listKpis(path: string, scopeLabel: (key: string) => string): Promise<AppRecord[]> {
  const payload = (await gatewayFetch({
    service: "production",
    path,
    query: { from: daysAgo(KPI_WINDOW_DAYS), to: daysAgo(-1), limit: 2000 },
  })) as Row;
  const defs = (payload?.definitions && typeof payload.definitions === "object" ? payload.definitions : {}) as Record<string, KpiDefinition>;
  return unwrapList<Row>(payload).map((row) => {
    const mapped = kpiToRecord(row, defs, scopeLabel);
    return withMeta(mapped, str(mapped.id));
  });
}

/**
 * OEE, availability, performance, quality, utilization, downtime and the
 * other machine KPIs, per machine per day — computed by iag-production's
 * rollup. Read-only: correct the runs and time log, not the figure.
 */
export const machinePerformance: RecordAdapter = {
  service: "production",
  resource: "/api/v1/kpis/machines",
  readOnly: true,
  list: () => listKpis("/api/v1/kpis/machines", (k) => k),
};

/* ───────────────────────────── energy ────────────────────────────── */

/** mes_energy_readings.tariff_band CHECK (004). */
export const TARIFF_BANDS = ["off_peak", "standard", "peak"];

/** Days the energy screen sums over. */
const ENERGY_WINDOW_DAYS = 30;

function kg(value: number): string {
  return value ? String(Math.round(value * 10) / 10) : "0";
}

/**
 * Energy per plant over the last 30 days, by tariff band, beside the plant's
 * output from production's measures — so kWh per kg (energy efficiency) and
 * the peak-tariff share show on one row. "Record a reading" adds a meter
 * reading to MES.
 *
 * MES keeps readings but serves only per-plant sums, so individual readings
 * are not listed; the row a new reading lands in updates instead.
 */
export const energy: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/energy/summary",

  async list() {
    const plants = unwrapList<Row>(await gatewayFetch({ service: "mes", path: "/api/v1/plants" }));
    const since = new Date(Date.now() - ENERGY_WINDOW_DAYS * 86_400_000).toISOString();
    return Promise.all(
      plants.map(async (plant) => {
        const code = str(pick(plant, "code"));
        const summary = (await gatewayFetch({ service: "mes", path: "/api/v1/energy/summary", query: { plant: code, since } })) as Row;
        const bands = (summary?.kwh_by_band || {}) as Record<string, number>;
        const total = Number(bands.total) || 0;
        // Output is best-effort: energy is still a correct answer without it.
        let outputKg = 0;
        try {
          const measures = unwrapList<Row>(
            await gatewayFetch({
              service: "production",
              path: "/api/v1/measures",
              query: { scope: "plant", plant: code, from: daysAgo(ENERGY_WINDOW_DAYS), to: daysAgo(-1) },
            }),
          );
          for (const m of measures) {
            const values = (m.values || {}) as Record<string, number>;
            outputKg += Number(values.product_kg) || 0;
          }
        } catch {
          outputKg = 0;
        }
        return withMeta(
          {
            id: code,
            plantCode: code,
            plant: str(pick(plant, "name")) || code,
            period: `Last ${ENERGY_WINDOW_DAYS} days`,
            kwhTotal: kg(total),
            kwhPeak: kg(Number(bands.peak) || 0),
            kwhStandard: kg(Number(bands.standard) || 0),
            kwhOffPeak: kg(Number(bands.off_peak) || 0),
            peakShare: total > 0 ? `${Math.round(((Number(bands.peak) || 0) / total) * 1000) / 10}%` : "",
            outputKg: kg(outputKg),
            kwhPerKg: total > 0 && outputKg > 0 ? String(Math.round((total / outputKg) * 1000) / 1000) : "",
            status: total > 0 ? "Metered" : "No readings",
            createdAt: "",
            updatedAt: since.slice(0, 10),
          },
          code,
        );
      }),
    );
  },

  /** Record one meter reading. `recorded_at` is always sent: MES stores an omitted one as year 1. */
  async create(_ctx, record) {
    const plant = str(record.plantCode).trim();
    const kwh = num(record.kwh);
    if (!plant) throw new InputError("Pick the plant the meter is at.");
    if (kwh === undefined || kwh <= 0) throw new InputError("kWh must be a positive number.");
    const band = oneOf(record.tariffBand || "standard", TARIFF_BANDS, "Tariff band") || "standard";
    const day = str(record.date).trim() || plantDate(new Date().toISOString());
    const time = /^\d{1,2}:\d{2}$/.test(str(record.time).trim()) ? str(record.time).trim().padStart(5, "0") : "12:00";
    await gatewayFetch({
      service: "mes",
      path: "/api/v1/energy/readings",
      method: "POST",
      body: omitEmpty({
        plant_code: plant,
        asset_tag: str(record.workCenter).trim() || undefined,
        kwh,
        tariff_band: band,
        recorded_at: `${day}T${time}:00+03:00`,
      }),
    });
    const rows = await energy.list({ module: "production", entity: "energy", query: new URLSearchParams() });
    return rows.find((r) => r.id === plant) || null;
  },
};
