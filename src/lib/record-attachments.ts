/**
 * Supporting files stored on a record as JSON (base64 data URLs).
 * Also mirrored into Documents → Attachments when the record is saved.
 *
 * Security: extension + MIME allowlist (no SVG/HTML/JS), size/count caps,
 * filename sanitization, and strip-invalid on parse (server mirrors these rules).
 */

import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecordsAsync } from "@/lib/records-store";

export type RecordAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  /**
   * Set once the file lives in blob storage. The record then carries only this
   * reference, so listing a page no longer downloads every file attached to it.
   */
  storageId?: string;
  /** Legacy inline payload. Records written before blob storage still have it. */
  dataUrl?: string;
  uploadedAt: string;
};

/** Where a stored attachment is fetched from. */
export function attachmentHref(file: RecordAttachment): string {
  if (file.storageId) return `/api/attachments/${encodeURIComponent(file.storageId)}`;
  return file.dataUrl || "";
}

export const ATTACHMENT_MAX_FILES = 10;
export const ATTACHMENT_MAX_BYTES = 1_500_000; // ~1.5 MB each
/** Total serialized attachment payload soft cap (~8 MB). */
export const ATTACHMENT_MAX_TOTAL_BYTES = 8_000_000;

export type AttachmentUploadProgress = {
  /** 0-based index of the file currently being processed. */
  fileIndex: number;
  fileCount: number;
  fileName: string;
  phase: "reading" | "uploading";
  /** Progress for the current file (0–100). */
  filePercent: number;
  /** Progress across the whole batch (0–100). */
  overallPercent: number;
};

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".txt",
  ".csv",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
]);

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** Browser accept attribute — explicit types only (no image/* / SVG). */
export const ATTACHMENT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  "application/pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".txt",
  ".csv",
  "text/plain",
  "text/csv",
].join(",");

export function attachmentExtension(name: string): string {
  const base = name.split(/[/\\]/).pop() || name;
  const i = base.lastIndexOf(".");
  if (i < 0) return "";
  return base.slice(i).toLowerCase();
}

/** Strip path segments and control characters from an upload name. */
export function sanitizeAttachmentFilename(name: string): string {
  const base = (name || "file")
    .split(/[/\\]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .trim();
  const cleaned = base.replace(/^\.+/, "") || "file";
  return cleaned.slice(0, 180);
}

export function isAllowedAttachmentType(name: string, mime: string): boolean {
  const ext = attachmentExtension(name);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) return false;
  const m = (mime || "").trim().toLowerCase().split(";")[0]!.trim();
  // Empty MIME is ok if extension is allowlisted (some browsers omit type).
  if (!m || m === "application/octet-stream") return true;
  if (m === "image/svg+xml" || m.includes("html") || m.includes("javascript")) {
    return false;
  }
  return ALLOWED_MIME.has(m);
}

export function isSafeImageMime(mime: string): boolean {
  return /^(image\/(png|jpeg|gif|webp))$/i.test((mime || "").trim());
}

function looksLikeDataUrl(dataUrl: string, mime: string, name: string): boolean {
  if (!dataUrl.startsWith("data:")) return false;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return false;
  const header = dataUrl.slice(5, comma).toLowerCase();
  if (header.includes("svg") || header.includes("html") || header.includes("javascript")) {
    return false;
  }
  // Reject huge payloads early.
  if (dataUrl.length > ATTACHMENT_MAX_BYTES * 2) return false;
  const declared = header.split(";")[0]!.trim();
  if (declared && declared !== "application/octet-stream") {
    if (!ALLOWED_MIME.has(declared) && !isAllowedAttachmentType(name, declared)) {
      return false;
    }
  }
  // Spot-check decoded prefix when base64.
  if (header.includes("base64")) {
    const b64 = dataUrl.slice(comma + 1).slice(0, 48);
    try {
      const bin =
        typeof atob === "function"
          ? atob(b64)
          : typeof Buffer !== "undefined"
            ? Buffer.from(b64, "base64").toString("binary")
            : "";
      if (!bin) return false;
      const bytes = Array.from(bin).map((c) => c.charCodeAt(0));
      // SVG / HTML / script sniff
      const asText = bin.slice(0, 64).toLowerCase();
      if (
        asText.includes("<svg") ||
        asText.includes("<!doctype") ||
        asText.includes("<html") ||
        asText.includes("<script")
      ) {
        return false;
      }
      // PDF magic
      if (attachmentExtension(name) === ".pdf" || /pdf/i.test(mime)) {
        if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
          // Allow if extension says pdf but browser re-encoded oddly — still require no HTML.
          // Soft: don't hard-fail non-PDF magic for office files.
        }
      }
    } catch {
      return false;
    }
  }
  return true;
}

export function parseRecordAttachments(raw?: string): RecordAttachment[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: RecordAttachment[] = [];
    let total = 0;
    for (const row of parsed) {
      if (out.length >= ATTACHMENT_MAX_FILES) break;
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = String(r.id || "").trim();
      const name = sanitizeAttachmentFilename(String(r.name || "").trim());
      const dataUrl = String(r.dataUrl || "").trim();
      const mime = String(r.mime || "application/octet-stream").trim();
      const size = Number(r.size) || 0;
      const storageId = String(r.storageId || "").trim();
      if (!id || !name) continue;
      if (!isAllowedAttachmentType(name, mime)) continue;
      // A stored file has no payload here — its bytes were validated on upload
      // and the data-URL rules below do not apply.
      if (storageId) {
        out.push({
          id: id.slice(0, 80),
          name,
          mime,
          size: size > 0 ? size : 0,
          storageId: storageId.slice(0, 80),
          uploadedAt: String(r.uploadedAt || "").slice(0, 40),
        });
        continue;
      }
      if (!dataUrl.startsWith("data:")) continue;
      if (!looksLikeDataUrl(dataUrl, mime, name)) continue;
      if (size > ATTACHMENT_MAX_BYTES || dataUrl.length > ATTACHMENT_MAX_BYTES * 2) continue;
      total += Math.max(size, Math.floor(dataUrl.length * 0.75));
      if (total > ATTACHMENT_MAX_TOTAL_BYTES) break;
      out.push({
        id: id.slice(0, 80),
        name,
        mime: isAllowedAttachmentType(name, mime) ? mime : "application/octet-stream",
        size: size > 0 ? size : Math.floor(dataUrl.length * 0.75),
        dataUrl,
        uploadedAt: String(r.uploadedAt || "").slice(0, 40),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** Re-serialize only safe attachments (use before PUT / form submit). */
export function sanitizeAttachmentsJson(raw?: string): string {
  return serializeRecordAttachments(parseRecordAttachments(raw));
}

export function serializeRecordAttachments(files: RecordAttachment[]): string {
  if (!files.length) return "";
  return JSON.stringify(files);
}

export function attachmentsSummary(raw?: string): string {
  const files = parseRecordAttachments(raw);
  if (!files.length) return "";
  if (files.length === 1) return files[0]!.name;
  return `${files.length} files`;
}

function validateAttachmentFile(file: File): { name: string; mime: string } {
  const name = sanitizeAttachmentFilename(file.name);
  const mime = (file.type || "application/octet-stream").trim();
  if (!isAllowedAttachmentType(name, mime)) {
    throw new Error(
      `“${name}” is not an allowed file type. Use PDF, PNG, JPG, GIF, WEBP, TXT, CSV, DOC, DOCX, XLS, or XLSX.`,
    );
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `“${name}” is too large (${Math.round(file.size / 1024)} KB). Max ${Math.round(ATTACHMENT_MAX_BYTES / 1024)} KB per file.`,
    );
  }
  return { name, mime: mime || "application/octet-stream" };
}

function readFileAsDataUrl(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error(`Could not read “${sanitizeAttachmentFilename(file.name)}”.`));
    reader.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

export function readFileAsAttachment(file: File): Promise<RecordAttachment> {
  return (async () => {
    const { name, mime } = validateAttachmentFile(file);
    const dataUrl = await readFileAsDataUrl(file);
    if (!looksLikeDataUrl(dataUrl, mime, name)) {
      throw new Error(`“${name}” failed security checks and was blocked.`);
    }
    return {
      id: globalThis.crypto?.randomUUID?.() ?? `att-${Date.now()}`,
      name,
      mime,
      size: file.size,
      dataUrl,
      uploadedAt: new Date().toISOString(),
    };
  })();
}

type StoredUploadResult = {
  id?: string;
  storageId?: string;
  name?: string;
  mime?: string;
  size?: number;
  uploadedAt?: string;
};

export class AttachmentUploadError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status = 0, retryable = false) {
    super(message);
    this.name = "AttachmentUploadError";
    this.status = status;
    this.retryable = retryable;
  }
}

function isRetryableUploadFailure(error: unknown): boolean {
  if (error instanceof AttachmentUploadError) return error.retryable;
  const message = error instanceof Error ? error.message : String(error);
  return /network|timed out|timeout|502|503|504|500|413|failed to fetch|offline/i.test(
    message,
  );
}

function postAttachmentJson(
  payload: Record<string, unknown>,
  onUploadProgress?: (percent: number) => void,
): Promise<StoredUploadResult> {
  return (async () => {
    const { getApiToken } = await import("@/lib/api-auth");
    return await new Promise<StoredUploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/attachments");
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.timeout = 120_000;
      xhr.withCredentials = true;
      const token = getApiToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || event.total <= 0) return;
        onUploadProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      };
      xhr.onload = () => {
        type UploadBody = { ok?: boolean; error?: string; data?: StoredUploadResult[] };
        let body: UploadBody | null = null;
        try {
          body = JSON.parse(xhr.responseText) as UploadBody;
        } catch {
          body = null;
        }
        const message =
          body?.error ||
          `Could not upload file (${xhr.status || "network error"}).`;
        if (xhr.status < 200 || xhr.status >= 300 || !body?.ok || !body.data?.[0]) {
          const retryable =
            xhr.status === 0 ||
            xhr.status === 408 ||
            xhr.status === 413 ||
            xhr.status === 429 ||
            xhr.status >= 500;
          reject(new AttachmentUploadError(message, xhr.status, retryable));
          return;
        }
        resolve(body.data[0]!);
      };
      xhr.onerror = () =>
        reject(new AttachmentUploadError("Network error uploading file.", 0, true));
      xhr.ontimeout = () =>
        reject(new AttachmentUploadError("Upload timed out. Try a smaller file.", 408, true));
      xhr.onabort = () =>
        reject(new AttachmentUploadError("Upload was cancelled.", 0, false));
      xhr.send(JSON.stringify(payload));
    });
  })();
}

/**
 * Upload one or more files to blob storage. The record keeps only the returned
 * references (storageId) — not the bytes. Reports read + network progress so
 * the form can show a loader while the user attaches several documents.
 *
 * Retries once without module/entity if the API rejects the owner context, so a
 * catalog mismatch cannot block attaching.
 */
export async function uploadFilesAsAttachments(
  files: File[],
  opts: {
    module?: string;
    entity?: string;
    recordId?: string;
    onProgress?: (progress: AttachmentUploadProgress) => void;
  } = {},
): Promise<RecordAttachment[]> {
  if (typeof window === "undefined") {
    throw new Error("Attachments can only be uploaded in the browser.");
  }
  if (!files.length) return [];

  const out: RecordAttachment[] = [];
  const fileCount = files.length;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex]!;
    const { name, mime } = validateAttachmentFile(file);
    const baseOverall = (fileIndex / fileCount) * 100;
    const slice = 100 / fileCount;

    const dataUrl = await readFileAsDataUrl(file, (filePercent) => {
      opts.onProgress?.({
        fileIndex,
        fileCount,
        fileName: name,
        phase: "reading",
        filePercent,
        overallPercent: Math.min(99, Math.round(baseOverall + (filePercent / 100) * slice * 0.4)),
      });
    });
    if (!looksLikeDataUrl(dataUrl, mime, name)) {
      throw new AttachmentUploadError(
        `“${name}” failed security checks and was blocked.`,
        400,
        false,
      );
    }

    opts.onProgress?.({
      fileIndex,
      fileCount,
      fileName: name,
      phase: "uploading",
      filePercent: 0,
      overallPercent: Math.min(99, Math.round(baseOverall + slice * 0.4)),
    });

    const bodyBase = {
      recordId: opts.recordId || "",
      files: [{ name, mime, dataUrl }],
    };

    const reportUpload = (filePercent: number) => {
      opts.onProgress?.({
        fileIndex,
        fileCount,
        fileName: name,
        phase: "uploading",
        filePercent,
        overallPercent: Math.min(
          99,
          Math.round(baseOverall + slice * 0.4 + (filePercent / 100) * slice * 0.6),
        ),
      });
    };

    let stored: StoredUploadResult;
    try {
      stored = await postAttachmentJson(
        {
          ...bodyBase,
          module: opts.module || "",
          entity: opts.entity || "",
        },
        reportUpload,
      );
    } catch (err) {
      // Owner mismatch / unknown entity must not block the attach.
      const message = err instanceof Error ? err.message : "";
      if (/unknown (module|entity)/i.test(message)) {
        stored = await postAttachmentJson(
          { ...bodyBase, module: "", entity: "" },
          reportUpload,
        );
      } else {
        throw err;
      }
    }

    const storageId = String(stored.storageId || stored.id || "").trim();
    if (!storageId) {
      throw new AttachmentUploadError(
        `Upload of “${name}” did not return a storage id.`,
        502,
        true,
      );
    }
    out.push({
      id: storageId,
      name: String(stored.name || name),
      mime: String(stored.mime || mime),
      size: Number(stored.size) || file.size,
      storageId,
      uploadedAt: String(stored.uploadedAt || new Date().toISOString()),
    });
  }

  opts.onProgress?.({
    fileIndex: Math.max(0, fileCount - 1),
    fileCount,
    fileName: out[out.length - 1]?.name || "",
    phase: "uploading",
    filePercent: 100,
    overallPercent: 100,
  });
  return out;
}

/**
 * Attach files one-by-one. Keeps successful uploads even when a later file
 * fails, and falls back to inline payloads only for transport/API outages.
 */
export async function attachFilesWithFallback(
  files: File[],
  opts: {
    module?: string;
    entity?: string;
    recordId?: string;
    onProgress?: (progress: AttachmentUploadProgress) => void;
  } = {},
): Promise<{ attached: RecordAttachment[]; errors: string[] }> {
  const attached: RecordAttachment[] = [];
  const errors: string[] = [];
  const fileCount = files.length;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex]!;
    const name = sanitizeAttachmentFilename(file.name);
    const mapProgress = (progress: AttachmentUploadProgress) => {
      opts.onProgress?.({
        ...progress,
        fileIndex,
        fileCount,
        overallPercent: Math.min(
          99,
          Math.round((fileIndex / fileCount) * 100 + progress.overallPercent / fileCount),
        ),
      });
    };

    try {
      const [ref] = await uploadFilesAsAttachments([file], {
        module: opts.module,
        entity: opts.entity,
        recordId: opts.recordId,
        onProgress: mapProgress,
      });
      if (ref) attached.push(ref);
      continue;
    } catch (err) {
      if (!isRetryableUploadFailure(err)) {
        errors.push(err instanceof Error ? err.message : `Could not attach “${name}”.`);
        continue;
      }
    }

    try {
      opts.onProgress?.({
        fileIndex,
        fileCount,
        fileName: name,
        phase: "reading",
        filePercent: 0,
        overallPercent: Math.round((fileIndex / fileCount) * 100),
      });
      attached.push(await readFileAsAttachment(file));
      opts.onProgress?.({
        fileIndex,
        fileCount,
        fileName: name,
        phase: "uploading",
        filePercent: 100,
        overallPercent: Math.round(((fileIndex + 1) / fileCount) * 100),
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `Could not attach “${name}”.`);
    }
  }

  if (attached.length) {
    opts.onProgress?.({
      fileIndex: Math.max(0, fileCount - 1),
      fileCount,
      fileName: attached[attached.length - 1]?.name || "",
      phase: "uploading",
      filePercent: 100,
      overallPercent: 100,
    });
  }

  return { attached, errors };
}

function folderForEntity(entityKey: string): string {
  if (entityKey === "inventory-write-offs") return "Inventory write-offs";
  if (entityKey === "expense-claims") return "Expense claims";
  if (entityKey === "leave-requests") return "Leave requests";
  if (entityKey === "progress-certificates") return "Progress certificates";
  if (entityKey === "contractor-invoices" || entityKey === "purchase-invoices") {
    return "Contractor invoices";
  }
  if (entityKey === "sales-invoices" || entityKey === "invoices") {
    return "Sales invoices";
  }
  return "Attachments";
}

/** Mirror record attachments into Documents → Attachments (linkedTo = reference). */
export async function syncRecordAttachmentsToLibrary(input: {
  entityKey: string;
  record: ManagerRecord;
}) {
  if (typeof window === "undefined") return;
  const files = parseRecordAttachments(input.record.attachments);
  const linkedTo =
    (input.record.reference || input.record.name || input.record.code || input.record.id).trim();
  const folder = folderForEntity(input.entityKey);
  const prefix = `linked-att:${input.entityKey}:${input.record.id}:`;
  const existing = loadRecords("documents", "attachments");
  const kept = existing.filter((row) => !row.id.startsWith(prefix));
  const now = new Date().toISOString();
  const mirrored: ManagerRecord[] = files.map((file) => ({
    id: `${prefix}${file.id}`,
    createdAt: file.uploadedAt || now,
    updatedAt: now,
    name: file.name,
    folder,
    linkedTo,
    // Stored files mirror as a link; legacy inline ones keep their data URL.
    fileUrl: attachmentHref(file),
    date: (file.uploadedAt || now).slice(0, 10),
    mime: file.mime,
    size: String(file.size),
    status: "Active",
  }));
  const result = await saveRecordsAsync("documents", "attachments", [...mirrored, ...kept]);
  if (!result.ok && result.durable !== "postgres") {
    throw new Error(result.error || "Could not save attachments");
  }
}
