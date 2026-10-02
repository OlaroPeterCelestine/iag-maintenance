"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  attachmentHref,
  ATTACHMENT_MAX_FILES,
  attachFilesWithFallback,
  isSafeImageMime,
  parseRecordAttachments,
  serializeRecordAttachments,
  type AttachmentUploadProgress,
  type RecordAttachment,
} from "@/lib/record-attachments";
import { cn } from "@/lib/utils";
import { DocumentText, Gallery, Trash } from "iconsax-react";
import { Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";

function isImage(mime: string) {
  return isSafeImageMime(mime);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RecordAttachmentsField({
  id,
  name = "attachments",
  label,
  required,
  readOnly,
  defaultValue,
  hint,
  moduleSlug,
  entityKey,
  recordId,
}: {
  id: string;
  name?: string;
  label: string;
  required?: boolean;
  readOnly?: boolean;
  defaultValue?: string;
  hint?: string;
  /** Optional owner context so uploads land in blob storage immediately. */
  moduleSlug?: string;
  entityKey?: string;
  recordId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingOwnerId = useId().replace(/:/g, "");
  const [files, setFiles] = useState<RecordAttachment[]>(() =>
    parseRecordAttachments(defaultValue),
  );
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<AttachmentUploadProgress | null>(null);

  async function onPick(list: FileList | null) {
    if (!list?.length || readOnly || uploading) return;
    setError("");
    const room = ATTACHMENT_MAX_FILES - files.length;
    if (room <= 0) {
      setError(`You can attach up to ${ATTACHMENT_MAX_FILES} files.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    const picked = Array.from(list).slice(0, room);
    const truncated = list.length > room;

    setUploading(true);
    setProgress({
      fileIndex: 0,
      fileCount: picked.length,
      fileName: picked[0]?.name || "",
      phase: "reading",
      filePercent: 0,
      overallPercent: 0,
    });

    try {
      const { attached, errors } = await attachFilesWithFallback(picked, {
        module: moduleSlug,
        entity: entityKey,
        recordId: recordId || `pending-${pendingOwnerId}`,
        onProgress: setProgress,
      });
      if (attached.length) {
        setFiles((prev) => [...prev, ...attached].slice(0, ATTACHMENT_MAX_FILES));
      }
      if (errors.length) {
        setError(errors.join(" "));
      } else if (truncated) {
        setError(
          `Only ${room} more file${room === 1 ? "" : "s"} can be added (max ${ATTACHMENT_MAX_FILES}).`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not attach file.");
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeAt(fileId: string) {
    if (uploading) return;
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    setError("");
  }

  const slotsLeft = ATTACHMENT_MAX_FILES - files.length;
  const progressLabel = progress
    ? progress.phase === "reading"
      ? `Reading ${progress.fileName}…`
      : `Uploading ${progress.fileName}…`
    : "Uploading…";

  return (
    <div className="sm:col-span-2">
      <Label htmlFor={id} className="mb-2 text-[12px] text-slate-700">
        {label}
        {required ? <span className="text-orange-500">*</span> : null}
      </Label>
      <input type="hidden" name={name} value={serializeRecordAttachments(files)} />
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3">
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || files.length >= ATTACHMENT_MAX_FILES}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  Uploading…
                </>
              ) : (
                "Attach documents"
              )}
            </Button>
            <p className="text-[11px] text-slate-500">
              Select multiple · PDF, photos (PNG/JPG/WEBP), or office files · up to{" "}
              {ATTACHMENT_MAX_FILES} · {Math.round(ATTACHMENT_MAX_BYTES / 1024)} KB each ·
              SVG/HTML blocked
              {slotsLeft < ATTACHMENT_MAX_FILES
                ? ` · ${slotsLeft} slot${slotsLeft === 1 ? "" : "s"} left`
                : ""}
            </p>
            <input
              ref={inputRef}
              id={id}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              disabled={uploading}
              className="hidden"
              onChange={(e) => void onPick(e.target.files)}
            />
          </div>
        ) : null}
        {hint ? <p className="mt-2 text-[11px] text-slate-500">{hint}</p> : null}
        {error ? <p className="mt-2 text-[12px] text-rose-600">{error}</p> : null}

        {uploading && progress ? (
          <div
            className="mt-3 rounded-lg border border-orange-200 bg-orange-50/80 px-3 py-2.5"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="flex items-center justify-between gap-3 text-[12px]">
              <span className="flex min-w-0 items-center gap-2 font-medium text-orange-900">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                <span className="truncate">{progressLabel}</span>
              </span>
              <span className="shrink-0 tabular-nums text-orange-800">
                {progress.fileIndex + 1}/{progress.fileCount} · {progress.overallPercent}%
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-orange-100">
              <div
                className="h-full rounded-full bg-orange-500 transition-[width] duration-150 ease-out"
                style={{ width: `${Math.max(2, progress.overallPercent)}%` }}
              />
            </div>
          </div>
        ) : null}

        {files.length === 0 && !uploading ? (
          <p className="mt-3 text-[12px] text-slate-500">
            {readOnly
              ? "No documents attached."
              : "No documents yet — attach one or more supporting files if needed."}
          </p>
        ) : files.length > 0 ? (
          <ul className={cn("space-y-2", uploading || hint || error ? "mt-3" : "mt-3")}>
            {files.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                {isImage(file.mime) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={attachmentHref(file)}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500">
                    {/\.pdf$/i.test(file.name) ? (
                      <DocumentText size={18} color="currentColor" />
                    ) : (
                      <Gallery size={18} color="currentColor" />
                    )}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <a
                    href={attachmentHref(file)}
                    download={file.name}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-[13px] font-medium text-sky-700 hover:underline"
                  >
                    {file.name}
                  </a>
                  <p className="text-[11px] text-slate-500">
                    {formatSize(file.size)}
                    {file.storageId ? " · stored" : ""}
                    {file.uploadedAt
                      ? ` · ${new Date(file.uploadedAt).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 text-rose-600"
                    onClick={() => removeAt(file.id)}
                    disabled={uploading}
                    title="Remove"
                  >
                    <Trash size={14} color="currentColor" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/** Read-only attachment gallery for the view modal. */
export function RecordAttachmentsView({ raw }: { raw?: string }) {
  const files = parseRecordAttachments(raw);
  if (!files.length) {
    return <span className="text-slate-400">No documents attached</span>;
  }
  return (
    <ul className="mt-1 space-y-2">
      {files.map((file) => (
        <li key={file.id} className="flex items-center gap-3">
          {isImage(file.mime) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachmentHref(file)}
              alt=""
              className="h-12 w-12 rounded object-cover ring-1 ring-slate-200"
            />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded bg-slate-100 text-slate-500 ring-1 ring-slate-200">
              <DocumentText size={18} color="currentColor" />
            </span>
          )}
          <div className="min-w-0">
            <a
              href={attachmentHref(file)}
              download={file.name}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-[13px] font-medium text-sky-700 hover:underline"
            >
              {file.name}
            </a>
            <p className="text-[11px] text-slate-500">{formatSize(file.size)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
