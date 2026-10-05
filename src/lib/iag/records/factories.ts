/**
 * The two levels above a machine: factories (MES plants) and the shop floors
 * (MES sections) inside them. Ported from iag-production
 * src/lib/iag/records/shifts.ts so both apps edit the same register the same
 * way.
 */
import { gatewayFetch, unwrapList, unwrapOne } from "@/lib/iag/gateway";
import {
  InputError,
  omitEmpty,
  pick,
  str,
  type AppRecord,
  type RecordAdapter,
} from "@/lib/iag/records/types";

type Row = Record<string, unknown>;

function withMeta(mapped: Omit<AppRecord, "id"> & { id?: string }, id: string): AppRecord {
  return {
    ...mapped,
    id: mapped.id || id,
    createdAt: mapped.createdAt || "",
    updatedAt: mapped.updatedAt || mapped.createdAt || "",
  } as AppRecord;
}

/**
 * Factories — MES `/plants`. "Plant" is the stored code; a factory is what it
 * is called.
 *
 * IAG runs more than one, and until iag-mes 014 the register held a free-text
 * region and a timezone: enough to stamp a timestamp and not much else. It
 * could not address a delivery, place a factory on a map beside the farms that
 * supply it, or say which of three sites a vehicle is nearest. There was also
 * no edit path at all — POST /plants is a plain insert on a unique code — so
 * the three factories that already existed could never have been corrected.
 *
 * Coordinates are a pair or neither: the service refuses half of one, because
 * a lone latitude reads as a point on the prime meridian rather than as
 * missing data. The form asks for them together for the same reason.
 */
function plantToRecord(row: Row) {
  return {
    id: str(pick(row, "code")),
    code: str(pick(row, "code")),
    name: str(pick(row, "name")),
    region: str(pick(row, "region")),
    timezone: str(pick(row, "timezone")),
    address: str(pick(row, "address")),
    city: str(pick(row, "city")),
    district: str(pick(row, "district")),
    country: str(pick(row, "country")),
    latitude: str(pick(row, "gps_lat")),
    longitude: str(pick(row, "gps_lng")),
    status: str(pick(row, "status")) === "inactive" ? "Inactive" : "Active",
    createdAt: str(pick(row, "created_at")),
    updatedAt: str(pick(row, "updated_at")),
  };
}

/** A coordinate the service will accept, or undefined. Never a half pair. */
function gpsPair(record: AppRecord): { gps_lat?: number; gps_lng?: number } {
  const lat = Number(str(record.latitude).trim());
  const lng = Number(str(record.longitude).trim());
  const hasLat = str(record.latitude).trim() !== "" && Number.isFinite(lat);
  const hasLng = str(record.longitude).trim() !== "" && Number.isFinite(lng);
  if (!hasLat && !hasLng) return {};
  if (hasLat !== hasLng) {
    throw new InputError("A factory needs both a latitude and a longitude, or neither.");
  }
  if (lat < -90 || lat > 90) throw new InputError("Latitude must be between -90 and 90.");
  if (lng < -180 || lng > 180) throw new InputError("Longitude must be between -180 and 180.");
  return { gps_lat: lat, gps_lng: lng };
}

function plantBody(record: AppRecord): Record<string, unknown> {
  return {
    name: str(record.name).trim(),
    region: str(record.region).trim(),
    timezone: str(record.timezone).trim(),
    address: str(record.address).trim(),
    city: str(record.city).trim(),
    district: str(record.district).trim(),
    country: str(record.country).trim(),
    status: /inactive/i.test(str(record.status)) ? "inactive" : "active",
    ...gpsPair(record),
  };
}

export const plants: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/plants",
  async list() {
    const rows = unwrapList<Row>(await gatewayFetch({ service: "mes", path: "/api/v1/plants" }));
    return rows.map((row) => withMeta(plantToRecord(row), str(pick(row, "code"))));
  },

  async create(_ctx, record) {
    const code = str(record.code).trim();
    if (!code) throw new InputError("A factory needs a short code, such as kampala.");
    if (!str(record.name).trim()) throw new InputError("A factory needs a name.");
    const row = unwrapOne<Row>(
      await gatewayFetch({
        service: "mes",
        path: "/api/v1/plants",
        method: "POST",
        body: omitEmpty({ code, ...plantBody(record) }),
      }),
    );
    return row ? withMeta(plantToRecord(row), str(pick(row, "code")) || code) : null;
  },

  /**
   * PATCH takes a partial and leaves anything absent alone, so moving a pin on
   * the map does not blank the address. Only what the form changed is sent.
   */
  async update(_ctx, id, record) {
    if (record.code !== undefined && str(record.code).trim() !== id) {
      throw new InputError("A factory's code is fixed — it is how every machine, shift and KPI refers to it.");
    }
    const has = (k: string) => record[k] !== undefined;
    const body: Record<string, unknown> = {};
    for (const [field, column] of [
      ["name", "name"], ["region", "region"], ["timezone", "timezone"],
      ["address", "address"], ["city", "city"], ["district", "district"], ["country", "country"],
    ] as const) {
      if (has(field)) body[column] = str(record[field]).trim();
    }
    if (has("status")) body.status = /inactive/i.test(str(record.status)) ? "inactive" : "active";
    if (has("latitude") || has("longitude")) Object.assign(body, gpsPair(record));
    const row = unwrapOne<Row>(
      await gatewayFetch({
        service: "mes",
        path: `/api/v1/plants/${encodeURIComponent(id)}`,
        method: "PATCH",
        body,
      }),
    );
    return row ? withMeta(plantToRecord(row), str(pick(row, "code")) || id) : null;
  },
};

/**
 * Shop floors — MES `/sections`, the lines a factory's machines stand on.
 *
 * Every asset belongs to one (`section_id` is NOT NULL), and iag-production
 * rolls KPIs up by it, so this is the level between one machine and the whole
 * factory: wet processing, hulling, roasting, packaging, utilities.
 *
 * Codes are unique per factory, not globally, so the row id joins the two —
 * "wet" at Mbarara and "wet" at Kampala are different floors.
 */
export const sections: RecordAdapter = {
  service: "mes",
  resource: "/api/v1/sections",
  async list() {
    const rows = unwrapList<Row>(await gatewayFetch({ service: "mes", path: "/api/v1/sections" }));
    return rows.map((row) => {
      const plant = str(pick(row, "plant_code", "plant"));
      const code = str(pick(row, "code"));
      return withMeta(
        {
          id: `${plant}/${code}`,
          plantCode: plant,
          code,
          name: str(pick(row, "name")),
          lineType: str(pick(row, "line_type")),
          createdAt: str(pick(row, "created_at")),
          updatedAt: str(pick(row, "updated_at", "created_at")),
        },
        `${plant}/${code}`,
      );
    });
  },

  async create(_ctx, record) {
    const plant = str(record.plantCode).trim();
    const code = str(record.code).trim();
    if (!plant) throw new InputError("Pick the factory this shop floor is in.");
    if (!code) throw new InputError("A shop floor needs a short code, such as wet.");
    const row = unwrapOne<Row>(
      await gatewayFetch({
        service: "mes",
        path: `/api/v1/plants/${encodeURIComponent(plant)}/sections`,
        method: "POST",
        body: omitEmpty({
          code,
          name: str(record.name).trim() || code,
          line_type: str(record.lineType).trim() || "general",
        }),
      }),
    );
    if (!row) return null;
    const id = `${plant}/${str(pick(row, "code")) || code}`;
    return withMeta(
      {
        id,
        plantCode: plant,
        code: str(pick(row, "code")) || code,
        name: str(pick(row, "name")),
        lineType: str(pick(row, "line_type")),
        createdAt: str(pick(row, "created_at")),
        updatedAt: str(pick(row, "created_at")),
      },
      id,
    );
  },
};
