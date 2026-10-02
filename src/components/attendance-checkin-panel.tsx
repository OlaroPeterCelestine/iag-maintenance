"use client";

import { Button } from "@/components/ui/button";
import { loadRecords, saveRecords } from "@/lib/records-store";
import { getCurrentSessionUser } from "@/lib/session-profile";
import {
  openStreetMapEmbedUrl,
  verifyAgainstZones,
  zoneFromRecord,
  type GeofenceZone,
} from "@/lib/geofence";
import { ShieldTick, Warning2 } from "iconsax-react";
import { Loader2, MapPin } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type LocState = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

function loadZones(): GeofenceZone[] {
  const sites = loadRecords("payroll", "sites")
    .map((r) => zoneFromRecord(r, "site"))
    .filter((z): z is GeofenceZone => Boolean(z));
  const blocks = loadRecords("payroll", "blocks")
    .map((r) => zoneFromRecord(r, "block"))
    .filter((z): z is GeofenceZone => Boolean(z));
  // Prefer tighter block fences when both exist.
  return [...blocks, ...sites];
}

function nowClock(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AttendanceCheckinPanel() {
  const [loc, setLoc] = useState<LocState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [wifiBssid, setWifiBssid] = useState("");
  const [tick, setTick] = useState(0);

  const zones = useMemo(() => loadZones(), [tick]);
  const session = getCurrentSessionUser();
  const employeeLabel =
    session?.name?.trim() ||
    session?.username?.trim() ||
    session?.email?.trim() ||
    "Current user";

  const refreshLocation = useCallback(() => {
    setError("");
    setMessage("");
    if (!navigator.geolocation) {
      setError("This browser does not support geolocation.");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 0,
        });
        setBusy(false);
        setTick((t) => t + 1);
      },
      (err) => {
        setBusy(false);
        setError(err.message || "Could not read GPS location.");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
    );
  }, []);

  useEffect(() => {
    refreshLocation();
    const onChange = () => setTick((t) => t + 1);
    window.addEventListener("financeiag-records-changed", onChange);
    window.addEventListener("financeiag-db-synced", onChange);
    return () => {
      window.removeEventListener("financeiag-records-changed", onChange);
      window.removeEventListener("financeiag-db-synced", onChange);
    };
  }, [refreshLocation]);

  const check = useMemo(() => {
    if (!loc) return null;
    return verifyAgainstZones(
      { latitude: loc.latitude, longitude: loc.longitude },
      zones,
      { accuracyMeters: loc.accuracy, wifiBssid },
    );
  }, [loc, zones, wifiBssid]);

  async function recordPunch(kind: "in" | "out") {
    if (!loc || !check) {
      setError("Capture GPS location first.");
      return;
    }
    if (check.status === "Outside") {
      setError("You are outside every configured geofence. Move on site or ask HR to adjust the site radius.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const rows = loadRecords("payroll", "attendance");
      const today = todayISO();
      const clock = nowClock();
      const zoneName = check.zone?.name || "";
      const siteName =
        check.zone?.kind === "site" ? zoneName : check.zone?.siteName || zoneName;
      const blockName = check.zone?.kind === "block" ? zoneName : "";

      if (kind === "in") {
        const open = rows.find(
          (r) =>
            (r.employee || "").trim() === employeeLabel &&
            (r.date || "") === today &&
            (r.clockIn || "") &&
            !(r.clockOut || "").trim(),
        );
        if (open) {
          setError("You already have an open check-in today. Check out first.");
          setBusy(false);
          return;
        }
        const record = {
          id: crypto.randomUUID(),
          reference: `ATT-${today.replace(/-/g, "")}-${clock.replace(":", "")}`,
          date: today,
          employee: employeeLabel,
          department: "",
          site: siteName,
          block: blockName,
          clockIn: clock,
          clockOut: "",
          hours: "",
          latitude: String(loc.latitude),
          longitude: String(loc.longitude),
          accuracyMeters: String(Math.round(loc.accuracy)),
          wifiBssid: wifiBssid.trim(),
          verification: check.status,
          verificationNote: check.note,
          status: check.status === "Verified" ? "Present" : "Present",
          notes: check.wifiMatched ? "Wi‑Fi BSSID matched" : "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const result = await saveRecords("payroll", "attendance", [record, ...rows]);
        if (!result.ok) {
          setError(result.error || "Could not save check-in.");
          setBusy(false);
          return;
        }
        setMessage(`Checked in at ${clock} · ${check.status} · ${check.note}`);
      } else {
        const open = rows.find(
          (r) =>
            (r.employee || "").trim() === employeeLabel &&
            (r.date || "") === today &&
            (r.clockIn || "") &&
            !(r.clockOut || "").trim(),
        );
        if (!open) {
          setError("No open check-in found for today.");
          setBusy(false);
          return;
        }
        const next = rows.map((r) => {
          if (r.id !== open.id) return r;
          const [hIn, mIn] = (r.clockIn || "0:0").split(":").map(Number);
          const [hOut, mOut] = clock.split(":").map(Number);
          const hours = Math.max(0, (hOut * 60 + mOut - (hIn * 60 + mIn)) / 60);
          return {
            ...r,
            clockOut: clock,
            hours: hours.toFixed(2),
            latitude: String(loc.latitude),
            longitude: String(loc.longitude),
            accuracyMeters: String(Math.round(loc.accuracy)),
            wifiBssid: wifiBssid.trim() || r.wifiBssid || "",
            verification: check.status,
            verificationNote: `${r.verificationNote || ""}${r.verificationNote ? " | " : ""}Checkout: ${check.note}`.trim(),
            site: r.site || siteName,
            block: r.block || blockName,
            updatedAt: new Date().toISOString(),
          };
        });
        const result = await saveRecords("payroll", "attendance", next);
        if (!result.ok) {
          setError(result.error || "Could not save check-out.");
          setBusy(false);
          return;
        }
        setMessage(`Checked out at ${clock} · ${check.status}`);
      }
      setTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  }

  const mapUrl = loc
    ? openStreetMapEmbedUrl({ latitude: loc.latitude, longitude: loc.longitude })
    : zones[0]
      ? openStreetMapEmbedUrl({
          latitude: zones[0].latitude,
          longitude: zones[0].longitude,
        })
      : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="relative min-h-[220px] bg-slate-100">
          {mapUrl ? (
            <iframe
              title="Check-in map"
              src={mapUrl}
              className="absolute inset-0 h-full w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-slate-500">
              Add a site with coordinates to show the map.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-orange-600 uppercase">
              Geofence attendance
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
              Check in / out
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
              GPS is verified against{" "}
              <Link href="/payroll?view=sites" className="font-medium text-orange-600 hover:underline">
                Sites
              </Link>{" "}
              and{" "}
              <Link href="/payroll?view=blocks" className="font-medium text-orange-600 hover:underline">
                Blocks
              </Link>
              . Outside the radius is blocked; near-miss is flagged.
            </p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3.5 py-3 text-[13px] text-slate-700">
            <div className="flex items-start gap-2">
              <MapPin size={18} className="mt-0.5 shrink-0 text-orange-500" />
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-slate-900">{employeeLabel}</p>
                {loc ? (
                  <p className="truncate text-slate-500">
                    {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)} · ±
                    {Math.round(loc.accuracy)} m · {zones.length} zone
                    {zones.length === 1 ? "" : "s"}
                  </p>
                ) : (
                  <p className="text-slate-500">Waiting for GPS…</p>
                )}
                {check ? (
                  <p
                    className={
                      check.status === "Verified"
                        ? "flex items-center gap-1.5 text-emerald-700"
                        : check.status === "Flagged"
                          ? "flex items-center gap-1.5 text-amber-700"
                          : "flex items-center gap-1.5 text-rose-700"
                    }
                  >
                    {check.status === "Verified" ? (
                      <ShieldTick size={16} />
                    ) : (
                      <Warning2 size={16} />
                    )}
                    {check.note}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <label className="block text-[12px] font-medium text-slate-600">
            Wi‑Fi BSSID (optional)
            <input
              value={wifiBssid}
              onChange={(e) => setWifiBssid(e.target.value)}
              placeholder="aa:bb:cc:dd:ee:ff"
              className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10"
            />
          </label>

          {error ? (
            <p className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
              {message}
            </p>
          ) : null}

          <div className="mt-auto flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={busy}
              onClick={refreshLocation}
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : null}
              Refresh GPS
            </Button>
            <Button
              type="button"
              className="rounded-xl bg-orange-500 text-white hover:bg-orange-600"
              disabled={busy || !loc}
              onClick={() => void recordPunch("in")}
            >
              Check in
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={busy || !loc}
              onClick={() => void recordPunch("out")}
            >
              Check out
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
