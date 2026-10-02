import { apiFetch } from "@/lib/api-auth";

export type FormDraft = {
  id: string;
  module: string;
  entity: string;
  sourceRecordId: string;
  title: string;
  data: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

type DraftApiRow = {
  id: string;
  module: string;
  entity: string;
  sourceRecordId?: string;
  title?: string;
  data?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
};

function asStringMap(data: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data || typeof data !== "object") return out;
  for (const [key, value] of Object.entries(data)) {
    if (key === "_saveAsDraft") continue;
    if (value == null) {
      out[key] = "";
      continue;
    }
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

function normalizeDraft(row: DraftApiRow): FormDraft {
  return {
    id: row.id,
    module: row.module,
    entity: row.entity,
    sourceRecordId: row.sourceRecordId || "",
    title: row.title || "Untitled draft",
    data: asStringMap(row.data || {}),
    createdAt: row.createdAt || "",
    updatedAt: row.updatedAt || "",
  };
}

async function readDraftResponse(res: Response): Promise<{ ok: boolean; data?: FormDraft; error?: string }> {
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: DraftApiRow; error?: string }
    | null;
  if (!res.ok || !json?.ok || !json.data) {
    return { ok: false, error: json?.error || `Request failed (${res.status})` };
  }
  return { ok: true, data: normalizeDraft(json.data) };
}

export async function listFormDrafts(input: {
  module: string;
  entity: string;
}): Promise<{ ok: boolean; drafts: FormDraft[]; error?: string }> {
  const params = new URLSearchParams({
    module: input.module,
    entity: input.entity,
  });
  const res = await apiFetch(`/api/drafts?${params.toString()}`);
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; data?: DraftApiRow[]; error?: string }
    | null;
  if (!res.ok || !json?.ok || !Array.isArray(json.data)) {
    return { ok: false, drafts: [], error: json?.error || `Could not load drafts (${res.status})` };
  }
  return { ok: true, drafts: json.data.map(normalizeDraft) };
}

export async function upsertFormDraft(input: {
  id?: string;
  module: string;
  entity: string;
  sourceRecordId?: string;
  title?: string;
  data: Record<string, string>;
}): Promise<{ ok: boolean; draft?: FormDraft; error?: string }> {
  const payload = { ...input.data };
  delete payload._saveAsDraft;
  const res = await apiFetch("/api/drafts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: input.id || "",
      module: input.module,
      entity: input.entity,
      sourceRecordId: input.sourceRecordId || "",
      title: input.title || "",
      data: payload,
    }),
  });
  const result = await readDraftResponse(res);
  if (!result.ok || !result.data) {
    return { ok: false, error: result.error || "Could not save draft" };
  }
  return { ok: true, draft: result.data };
}

export async function deleteFormDraft(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch(`/api/drafts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; error?: string }
    | null;
  if (!res.ok || !json?.ok) {
    return { ok: false, error: json?.error || `Could not delete draft (${res.status})` };
  }
  return { ok: true };
}

export function draftLabel(draft: FormDraft) {
  const title = (draft.title || "").trim() || "Untitled draft";
  const when = draft.updatedAt ? new Date(draft.updatedAt) : null;
  if (!when || Number.isNaN(when.getTime())) return title;
  return `${title} · ${when.toLocaleString()}`;
}
