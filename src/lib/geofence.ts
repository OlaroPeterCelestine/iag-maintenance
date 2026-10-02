/**
 * GPS geofence helpers for site/block check-in verification.
 * Distance uses the Haversine formula (metres).
 */

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type GeofenceZone = {
  id: string;
  name: string;
  kind: "site" | "block";
  siteName?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  wifiBssids?: string[];
  status?: string;
};

const EARTH_RADIUS_M = 6_371_000;

export function parseCoord(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function parseWifiBssids(raw: string | null | undefined): string[] {
  return String(raw || "")
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function zoneFromRecord(
  record: Record<string, string | undefined | null>,
  kind: "site" | "block",
): GeofenceZone | null {
  const lat = parseCoord(record.latitude);
  const lng = parseCoord(record.longitude);
  const radius = parseCoord(record.radiusMeters) ?? 100;
  if (lat == null || lng == null) return null;
  const name = String(record.name || record.code || record.id || "Zone").trim();
  return {
    id: String(record.id || name),
    name,
    kind,
    siteName: kind === "block" ? String(record.site || "").trim() || undefined : name,
    latitude: lat,
    longitude: lng,
    radiusMeters: Math.max(10, radius),
    wifiBssids: parseWifiBssids(record.wifiBssids),
    status: String(record.status || "").trim() || undefined,
  };
}

export function isZoneActive(zone: GeofenceZone): boolean {
  const s = (zone.status || "Active").trim();
  return !/^(inactive|disabled|archived|closed)$/i.test(s);
}

export type GeofenceCheckResult = {
  ok: boolean;
  status: "Verified" | "Flagged" | "Outside";
  distanceMeters: number;
  zone: GeofenceZone | null;
  note: string;
  wifiMatched: boolean;
};

export function verifyAgainstZones(
  point: GeoPoint,
  zones: GeofenceZone[],
  opts?: { wifiBssid?: string; accuracyMeters?: number },
): GeofenceCheckResult {
  const active = zones.filter(isZoneActive);
  if (!active.length) {
    return {
      ok: false,
      status: "Outside",
      distanceMeters: Number.POSITIVE_INFINITY,
      zone: null,
      note: "No active sites or blocks with coordinates are configured.",
      wifiMatched: false,
    };
  }

  let best: { zone: GeofenceZone; distance: number } | null = null;
  for (const zone of active) {
    const distance = haversineMeters(point, {
      latitude: zone.latitude,
      longitude: zone.longitude,
    });
    if (!best || distance < best.distance) best = { zone, distance };
  }

  const zone = best!.zone;
  const distanceMeters = Math.round(best!.distance);
  const accuracy = opts?.accuracyMeters ?? 0;
  const effective = Math.max(0, distanceMeters - Math.min(accuracy, 50));
  const wifi = (opts?.wifiBssid || "").trim().toLowerCase();
  const wifiMatched = Boolean(wifi && zone.wifiBssids?.includes(wifi));

  if (effective <= zone.radiusMeters) {
    return {
      ok: true,
      status: "Verified",
      distanceMeters,
      zone,
      note: wifiMatched
        ? `Inside ${zone.name} geofence (${distanceMeters} m) and Wi‑Fi BSSID matched.`
        : `Inside ${zone.name} geofence (${distanceMeters} m of ${zone.radiusMeters} m radius).`,
      wifiMatched,
    };
  }

  if (effective <= zone.radiusMeters * 1.5) {
    return {
      ok: false,
      status: "Flagged",
      distanceMeters,
      zone,
      note: `Near ${zone.name} but outside the ${zone.radiusMeters} m radius (${distanceMeters} m away).`,
      wifiMatched,
    };
  }

  return {
    ok: false,
    status: "Outside",
    distanceMeters,
    zone,
    note: `Outside all geofences. Nearest: ${zone.name} at ${distanceMeters} m (radius ${zone.radiusMeters} m).`,
    wifiMatched,
  };
}

export function openStreetMapEmbedUrl(point: GeoPoint, zoom = 16): string {
  const d = 0.004;
  const left = point.longitude - d;
  const right = point.longitude + d;
  const top = point.latitude + d;
  const bottom = point.latitude - d;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${point.latitude}%2C${point.longitude}`;
}
