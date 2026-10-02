/**
 * Generic entity CSV/JSON import via Go POST /api/records/:module/:entity/import-csv.
 * Material Requests stay on material-request-import.ts (line-item sheet).
 */

import { apiFetch } from "@/lib/api-auth";
import { knownEntityRevision, hydrateEntityFromDatabase } from "@/lib/db/sync";
import type { ImportRow } from "@/lib/data-import";
import type { ManagerRecord } from "@/lib/manager-entities";

export type EntityImportResult = {
  ok: boolean;
  imported: number;
  skipped: number;
  errors: string[];
  revision?: string;
  records: ManagerRecord[];
  error?: string;
  code?: string;
};

type ApiBody = Partial<EntityImportResult> & {
  error?: string;
  message?: string;
  code?: string;
};

async function parseImportResponse(res: Response): Promise<{ res: Response; json: ApiBody | null }> {
  const json = (await res.json().catch(() => null)) as ApiBody | null;
  return { res, json };
}

function toResult(res: Response, json: ApiBody | null): EntityImportResult {
  if (!res.ok || !json?.ok) {
    return {
      ok: false,
      imported: 0,
      skipped: 0,
      errors: Array.isArray(json?.errors) ? json.errors.map(String) : [],
      records: [],
      error: String(json?.error || json?.message || `Import failed (HTTP ${res.status})`),
      code: json?.code,
      revision: json?.revision,
    };
  }
  return {
    ok: true,
    imported: Number(json.imported || 0),
    skipped: Number(json.skipped || 0),
    errors: Array.isArray(json.errors) ? json.errors.map(String) : [],
    revision: json.revision,
    records: Array.isArray(json.records) ? (json.records as ManagerRecord[]) : [],
  };
}

/**
 * Upload a raw CSV/TSV file; Go parses, merges by identity, persists, and posts
 * money docs.
 *
 * The list pages no longer use this — they map headers against the entity's own
 * field definition first (Go has no field labels, so "Customer" on an invoice
 * sheet would land in `name`) and send mapped rows via uploadEntityImportRows.
 * Kept for API clients and scripts that only have a file.
 */
export async function uploadEntityCsv(
  moduleSlug: string,
  entityKey: string,
  file: File,
  opts?: { expectedRevision?: string },
): Promise<EntityImportResult> {
  let expected =
    opts?.expectedRevision ?? knownEntityRevision(moduleSlug, entityKey) ?? undefined;

  const post = async (revision?: string) => {
    const params = new URLSearchParams();
    if (revision) params.set("expectedRevision", revision);
    const qs = params.toString() ? `?${params}` : "";
    const body = new FormData();
    body.append("file", file, file.name || `${entityKey}.csv`);
    return parseImportResponse(
      await apiFetch(`/api/records/${moduleSlug}/${entityKey}/import-csv${qs}`, {
        method: "POST",
        body,
      }),
    );
  };

  let { res, json } = await post(expected);
  if (
    res.status === 409 &&
    (json?.code === "REVISION_CONFLICT" || /changed since last load/i.test(String(json?.error || "")))
  ) {
    expected = json?.revision || undefined;
    if (expected) ({ res, json } = await post(expected));
  }

  const result = toResult(res, json);
  if (result.ok) {
    await hydrateEntityFromDatabase(moduleSlug, entityKey).catch(() => undefined);
  }
  return result;
}

/**
 * Send already-mapped rows (Manager.io / Settings importer). Go merges + persists + posts.
 */
export async function uploadEntityImportRows(
  moduleSlug: string,
  entityKey: string,
  rows: ImportRow[],
  opts?: { expectedRevision?: string },
): Promise<EntityImportResult> {
  let expected =
    opts?.expectedRevision ?? knownEntityRevision(moduleSlug, entityKey) ?? undefined;

  const post = async (revision?: string) =>
    parseImportResponse(
      await apiFetch(`/api/records/${moduleSlug}/${entityKey}/import-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows,
          ...(revision ? { expectedRevision: revision } : {}),
        }),
      }),
    );

  let { res, json } = await post(expected);
  if (
    res.status === 409 &&
    (json?.code === "REVISION_CONFLICT" || /changed since last load/i.test(String(json?.error || "")))
  ) {
    expected = json?.revision || undefined;
    if (expected) ({ res, json } = await post(expected));
  }

  const result = toResult(res, json);
  if (result.ok) {
    await hydrateEntityFromDatabase(moduleSlug, entityKey).catch(() => undefined);
  }
  return result;
}
