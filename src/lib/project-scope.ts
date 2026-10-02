/**
 * Project scope helpers for UI only.
 *
 * Visibility is enforced by the Go API (`resolveProjectScope` /
 * `filterRecords` on `/api/records/...`). The browser must not re-implement
 * assignment rules — hydrate already receives the caller's allowed rows.
 *
 * What remains here is UX: detect PM/Contractor persona and look up the
 * directory row so create forms can default contractor / manager fields.
 */
import { isAdminRoleName } from "@/lib/access-control";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords } from "@/lib/records-store";
import { getCurrentSessionUser } from "@/lib/session-profile";

export type ProjectScopeKind = "all" | "project-manager" | "contractor";

function norm(value: string | undefined) {
  return (value || "").trim().toLowerCase();
}

/** Persona for form defaults — not a security gate (API owns that). */
export function currentProjectScopeKind(
  role = getCurrentSessionUser()?.role || "",
): ProjectScopeKind {
  const r = (role || "").trim();
  if (isAdminRoleName(r)) return "all";
  if (/project\s*manager|\bpm\b/i.test(r)) return "project-manager";
  if (r.toLowerCase() === "contractor") return "contractor";
  return "all";
}

/** Directory row for the signed-in PM or contractor (matched by username/email). */
export function currentProjectDirectoryRow(
  kind: ProjectScopeKind = currentProjectScopeKind(),
): ManagerRecord | null {
  if (kind === "all" || typeof window === "undefined") return null;
  const user = getCurrentSessionUser();
  const username = norm(user.username);
  const email = norm(user.email);
  const name = norm(user.name);
  const entity = kind === "project-manager" ? "project-managers" : "contractors";
  // Rows in memory are already API-scoped for this caller.
  const rows = loadRecords("projects", entity);
  return (
    rows.find((row) => {
      const u = norm(row.username);
      const e = norm(row.email);
      const n = norm(row.name);
      const company = norm(row.company);
      if (username && (u === username || n === username)) return true;
      if (email && e === email) return true;
      if (name && (n === name || company === name)) return true;
      return false;
    }) || null
  );
}

/**
 * Project names already visible to the caller (from API-scoped memory).
 * `null` means unrestricted persona (admin / other roles).
 */
export function scopedProjectNames(
  kind: ProjectScopeKind = currentProjectScopeKind(),
): string[] | null {
  if (kind === "all") return null;
  const projects = loadRecords("projects", "projects");
  const names = projects
    .map((project) => project.name || project.code || "")
    .filter(Boolean);
  return Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
}

/**
 * No-op: lists already come from the API scoped for the signed-in user.
 * Kept so call sites stay stable without re-filtering in the browser.
 */
export function filterRecordsForProjectScope(
  _entityKey: string,
  records: ManagerRecord[],
): ManagerRecord[] {
  return records;
}
