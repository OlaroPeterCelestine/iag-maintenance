"use client";

import { getMemorySetting, setMemorySetting, removeMemorySetting } from "@/lib/db/client-store";
import { persistSettingToDb } from "@/lib/db/sync";
import {
  BUSINESS_PROFILE_KEY,
  BusinessForm,
  BusinessProfileForm,
  emptyBusinessForm,
} from "@/components/business-profile-form";
import { FeedbackModals, useFeedbackModals } from "@/components/feedback-modals";
import { PaginationBar } from "@/components/pagination-bar";
import {
  reportTdCheckClass,
  reportThCheckClass,
  useRowSelection,
} from "@/components/report-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePagination } from "@/hooks/use-pagination";
import { useUndoStack } from "@/hooks/use-undo-stack";
import { loadBusinessLogo, loadManagerSettings } from "@/lib/manager-settings";
import { BusinessBackupActions } from "@/components/business-backup-panel";
import { cn } from "@/lib/utils";
import { Eye, Pencil, Plus, Search, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export const BUSINESS_RECORDS_KEY = "financeiag-business-records";

export type BusinessRecord = BusinessForm & {
  id: string;
  updatedAt: string;
};

function recordFromSettings(): BusinessRecord | null {
  try {
    const settings = loadManagerSettings();
    const logo = loadBusinessLogo();
    const profile = getMemorySetting<BusinessForm | null>(BUSINESS_PROFILE_KEY, null);
    if (profile?.businessName?.trim()) {
      return {
        id: crypto.randomUUID(),
        ...emptyBusinessForm,
        ...profile,
        updatedAt: new Date().toISOString(),
      };
    }
    if (!settings.businessName?.trim()) return null;
    const parts = settings.address.split(",").map((p) => p.trim()).filter(Boolean);
    return {
      id: crypto.randomUUID(),
      ...emptyBusinessForm,
      businessName: settings.businessName,
      addressLine1: parts[0] || "",
      city: parts.length > 2 ? parts[parts.length - 3] || "" : parts[1] || "",
      country: settings.country || parts[parts.length - 1] || "",
      logoPreview: logo.dataUrl,
      logoName: logo.fileName,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function loadRecords(): BusinessRecord[] {
  try {
    const parsed = getMemorySetting<BusinessRecord[] | null>(BUSINESS_RECORDS_KEY, null);
    if (parsed && Array.isArray(parsed)) {
      const cleaned = parsed.filter((r) => r.id !== "rec-iag");
      if (cleaned.length !== parsed.length) {
        if (cleaned.length === 0) {
          const fromSettings = recordFromSettings();
          if (fromSettings) {
            persistRecords([fromSettings]);
            return [fromSettings];
          }
        }
        persistRecords(cleaned);
      }
      return cleaned;
    }
    const fromSettings = recordFromSettings();
    if (fromSettings) {
      persistRecords([fromSettings]);
      return [fromSettings];
    }
  } catch {
    // ignore
  }
  return [];
}

function persistRecords(records: BusinessRecord[]) {
  setMemorySetting(BUSINESS_RECORDS_KEY, records);
  void persistSettingToDb(BUSINESS_RECORDS_KEY, records);
  const primary = records[0];
  if (primary) {
    const { id: _id, updatedAt: _updatedAt, ...profile } = primary;
    const payload = { ...profile, completedAt: new Date().toISOString() };
    setMemorySetting(BUSINESS_PROFILE_KEY, payload);
    void persistSettingToDb(BUSINESS_PROFILE_KEY, payload);
  } else {
    removeMemorySetting(BUSINESS_PROFILE_KEY);
  }
}

type Mode = "create" | "edit" | "view" | null;

export function BusinessProfilesPanel({ embedded = false }: { embedded?: boolean }) {
  const [records, setRecords] = useState<BusinessRecord[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Stashed form when confirm is cancelled so create/edit can reopen with the same values. */
  const [draftForm, setDraftForm] = useState<BusinessForm | null>(null);
  const { feedback, close, showSuccess, askConfirm } = useFeedbackModals();
  const { pushUndo, undo, canUndo, nextLabel } = useUndoStack();

  useEffect(() => {
    setRecords(loadRecords());
  }, []);

  const active = records.find((r) => r.id === activeId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((r) =>
      [r.businessName, r.legalName, r.email, r.city, r.country, r.taxId, r.industry]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [records, query]);

  const { page, setPage, pages, pageItems, pageSize, setPageSize, total, from, to } =
    usePagination(filtered);
  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const pageIds = useMemo(() => pageItems.map((r) => r.id), [pageItems]);
  const selection = useRowSelection(filteredIds);
  const pageAllSelected =
    pageIds.length > 0 && pageIds.every((id) => selection.isSelected(id));

  useEffect(() => {
    setPage(1);
  }, [query, setPage]);

  function replaceAll(next: BusinessRecord[]) {
    setRecords(next);
    persistRecords(next);
  }

  function openCreate() {
    setDraftForm(null);
    setActiveId(null);
    setMode("create");
  }

  function openEdit(id: string) {
    setDraftForm(null);
    setActiveId(id);
    setMode("edit");
  }

  function openView(id: string) {
    setDraftForm(null);
    setActiveId(id);
    setMode("view");
  }

  function saveRecord(form: BusinessForm) {
    const editing = mode === "edit" && activeId;
    const editId = activeId;
    const label = form.businessName || "business";
    // Close the form first so it does not stack under confirm / success.
    setMode(null);
    setActiveId(null);
    askConfirm({
      title: editing ? "Confirm update?" : "Confirm create?",
      message: editing
        ? `Save changes to “${label}”? This updates the company profile used on documents.`
        : `Create business profile “${label}”?`,
      confirmLabel: editing ? "Save changes" : "Create",
      danger: false,
      onConfirm: () => {
        const previous = records.map((r) => ({ ...r }));
        let next: BusinessRecord[];
        if (editing && editId) {
          next = records.map((r) =>
            r.id === editId ? { ...r, ...form, updatedAt: new Date().toISOString() } : r,
          );
        } else {
          next = [
            {
              id: crypto.randomUUID(),
              ...form,
              updatedAt: new Date().toISOString(),
            },
            ...records,
          ];
        }
        replaceAll(next);
        setDraftForm(null);
        pushUndo({
          label: editing ? "Update business" : "Create business",
          undo: () => {
            replaceAll(previous);
            showSuccess("Undone", "Business change was reversed.");
          },
        });
        showSuccess(
          editing ? "Business updated" : "Business created",
          editing
            ? "Company details were saved successfully."
            : "A new business profile was added.",
          {
            undoLabel: "Undo",
            onUndo: () => {
              replaceAll(previous);
              showSuccess("Undone", "Business change was reversed.");
            },
          },
        );
      },
      onCancel: () => {
        setDraftForm(form);
        setActiveId(editId);
        setMode(editing ? "edit" : "create");
      },
    });
  }

  function deleteRecord(id: string) {
    const name = records.find((r) => r.id === id)?.businessName || "this business";
    askConfirm({
      title: "Delete business?",
      message: `Remove ${name}? You can undo afterward.`,
      confirmLabel: "Delete",
      danger: true,
      onConfirm: () => {
        const previous = records.map((r) => ({ ...r }));
        const next = records.filter((r) => r.id !== id);
        replaceAll(next);
        pushUndo({
          label: "Delete business",
          undo: () => {
            replaceAll(previous);
            showSuccess("Undone", "Business delete was reversed.");
          },
        });
        if (activeId === id) {
          setActiveId(null);
          setMode(null);
        }
        showSuccess("Business deleted", "The profile was removed.", {
          undoLabel: "Undo",
          onUndo: () => {
            replaceAll(previous);
            showSuccess("Undone", "Business delete was reversed.");
          },
        });
      },
    });
  }

  return (
    <>
      <FeedbackModals feedback={feedback} onClose={close} />
        <div className={cn("flex w-full flex-1 flex-col gap-4", !embedded && "p-4 sm:p-5")}>
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-[18px] font-semibold tracking-tight text-slate-900">
                Business profiles
              </h2>
              <p className="mt-1 text-[13px] text-slate-500">
                Create, view, update, and delete company records used on invoices and reports.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <BusinessBackupActions />
              {canUndo && (
                <Button type="button" variant="outline" className="h-9" onClick={undo} title={nextLabel}>
                  <Undo2 size={15} /> Undo
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="h-9"
                onClick={() => {
                  window.location.href = "/settings?section=backup-restore";
                }}
              >
                Backup options
              </Button>
              <Button className="h-9 bg-black hover:bg-zinc-800" onClick={openCreate}>
                <Plus size={15} /> Add business
              </Button>
            </div>
          </div>

          <div className="flex w-full flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="relative w-full sm:max-w-md">
              <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, tax ID, city…"
                className="h-9 border-slate-200 bg-white pl-9 text-[13px] shadow-none"
              />
            </div>
            <p className="text-[12px] text-slate-500">
              {filtered.length} of {records.length} record{records.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] tracking-wide text-slate-500 uppercase">
                    <th className={reportThCheckClass}>
                      <Checkbox
                        checked={pageAllSelected}
                        onCheckedChange={() => selection.togglePage(pageIds)}
                        aria-label="Select all businesses on this page"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Business</th>
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 font-medium">Location</th>
                    <th className="px-4 py-3 font-medium">Industry</th>
                    <th className="px-4 py-3 font-medium">Tax ID</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center text-slate-500">
                        No businesses yet. Click <span className="font-medium text-slate-800">Add business</span> to
                        create one.
                      </td>
                    </tr>
                  ) : (
                    pageItems.map((record) => {
                      const isSelected = selection.isSelected(record.id);
                      return (
                      <tr
                        key={record.id}
                        data-selected={isSelected || undefined}
                        className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70 data-[selected=true]:bg-slate-50/80"
                      >
                        <td className={reportTdCheckClass}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => selection.toggle(record.id)}
                            aria-label={`Select ${record.businessName || "business"}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {record.logoPreview ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={record.logoPreview}
                                alt=""
                                className="size-9 rounded-lg object-cover ring-1 ring-slate-200"
                              />
                            ) : (
                              <span className="flex size-9 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-semibold text-slate-600">
                                {record.businessName.slice(0, 2).toUpperCase() || "—"}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">{record.businessName || "Untitled"}</p>
                              <p className="truncate text-[12px] text-slate-400">{record.legalName || "—"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-slate-700">{record.email || "—"}</p>
                          <p className="text-[12px] text-slate-400">{record.phone || "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {[record.city, record.country].filter(Boolean).join(", ") || "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{record.industry || "—"}</td>
                        <td className="px-4 py-3 font-mono text-[12px] text-slate-600">{record.taxId || "—"}</td>
                        <td className="px-4 py-3 text-[12px] text-slate-500">
                          {new Date(record.updatedAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="View"
                              onClick={() => openView(record.id)}
                            >
                              <Eye size={15} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Edit"
                              onClick={() => openEdit(record.id)}
                            >
                              <Pencil size={15} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-rose-600 hover:text-rose-700"
                              aria-label="Delete"
                              onClick={() => deleteRecord(record.id)}
                            >
                              <Trash2 size={15} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={page}
              pages={pages}
              total={total}
              from={from}
              to={to}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        </div>

      {/* Create / Edit */}
      <Dialog
        open={mode === "create" || mode === "edit"}
        onOpenChange={(open) => {
          if (!open) {
            setMode(null);
            setActiveId(null);
          }
        }}
      >
        <DialogContent className="no-scrollbar max-h-[92dvh] w-[min(960px,calc(100vw-1.5rem))] overflow-y-auto sm:max-w-[960px]">
          <DialogHeader>
            <DialogTitle>{mode === "edit" ? "Update business" : "Create business"}</DialogTitle>
            <DialogDescription>
              {mode === "edit"
                ? "Edit company details used across invoices and documents."
                : "Add a new company profile for system documents."}
            </DialogDescription>
          </DialogHeader>
          <BusinessProfileForm
            key={mode === "edit" ? activeId ?? "edit" : draftForm ? "draft-create" : "create"}
            initialValues={
              draftForm
                ? draftForm
                : mode === "edit" && active
                  ? active
                  : emptyBusinessForm
            }
            persist={false}
            finishLabel={mode === "edit" ? "Update business" : "Create business"}
            onComplete={saveRecord}
          />
        </DialogContent>
      </Dialog>

      {/* Read / View */}
      <Dialog
        open={mode === "view"}
        onOpenChange={(open) => {
          if (!open) {
            setMode(null);
            setActiveId(null);
          }
        }}
      >
        <DialogContent className="w-[min(640px,calc(100vw-1.5rem))] sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{active?.businessName || "Business details"}</DialogTitle>
            <DialogDescription>Read-only view of the selected company profile.</DialogDescription>
          </DialogHeader>
          {active && (
            <div className="space-y-4 text-[13px]">
              <div className="flex items-center gap-3">
                {active.logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={active.logoPreview}
                    alt=""
                    className="size-14 rounded-xl object-cover ring-1 ring-slate-200"
                  />
                ) : (
                  <span className="flex size-14 items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-600">
                    {active.businessName.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div>
                  <p className="text-base font-semibold text-slate-900">{active.businessName}</p>
                  <p className="text-slate-500">{active.legalName}</p>
                </div>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Email", active.email],
                  ["Phone", active.phone],
                  ["Website", active.website],
                  ["Industry", active.industry],
                  ["Tax ID", active.taxId],
                  ["Registration", active.registrationNumber],
                  [
                    "Address",
                    [active.addressLine1, active.city, active.state, active.postalCode, active.country]
                      .filter(Boolean)
                      .join(", "),
                  ],
                  ["Description", active.description],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className={cn(
                      "rounded-lg border border-slate-100 bg-slate-50/80 p-3",
                      label === "Address" || label === "Description" ? "sm:col-span-2" : "",
                    )}
                  >
                    <dt className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{label}</dt>
                    <dd className="mt-1 text-slate-800">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (active) openEdit(active.id);
                  }}
                >
                  <Pencil size={14} /> Edit
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
