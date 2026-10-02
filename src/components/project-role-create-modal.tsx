"use client";

import { ResponsiveModal } from "@/components/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { nextEntityCode } from "@/lib/document-references";
import type { ManagerRecord } from "@/lib/manager-entities";
import { loadRecords, saveRecordsAsync } from "@/lib/records-store";
import { FormEvent, useState } from "react";

export type ProjectRoleKind = "contractor" | "project-manager";

type FormValues = {
  name: string;
  company: string;
  code: string;
  type: string;
  phone: string;
  email: string;
  title: string;
  notes: string;
};

function emptyValues(kind: ProjectRoleKind, initialName = ""): FormValues {
  const entity = kind === "contractor" ? "contractors" : "project-managers";
  const existing = typeof window === "undefined" ? [] : loadRecords("projects", entity);
  const seed = initialName.trim();
  return {
    name: kind === "contractor" ? "" : seed,
    company: kind === "contractor" ? seed : "",
    code: nextEntityCode(
      entity,
      existing,
      kind === "contractor" ? "Contractors" : "Project managers",
    ),
    type: "Construction",
    phone: "",
    email: "",
    title: "",
    notes: "",
  };
}

/**
 * Compact create modal for Contractors / Project managers from the New Project form.
 */
export function ProjectRoleCreateModal({
  open,
  kind,
  initialName = "",
  onClose,
  onCreated,
}: {
  open: boolean;
  kind: ProjectRoleKind | null;
  initialName?: string;
  onClose: () => void;
  onCreated: (displayName: string, record: ManagerRecord) => void;
}) {
  const resolved: ProjectRoleKind = kind || "contractor";
  const isContractor = resolved === "contractor";
  const [values, setValues] = useState<FormValues>(() =>
    emptyValues(resolved, initialName),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Same reset-on-open rule as the party modal: during render, so a reopened
  // form never flashes the previous entry.
  const resetKey = `${open ? "1" : "0"}|${kind || ""}|${initialName || ""}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    if (open && kind) {
      setValues(emptyValues(kind, initialName));
      setError("");
      setSaving(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!kind) return;

    const name = values.name.trim();
    const company = values.company.trim();
    const display = isContractor ? company || name : name;
    if (!display) {
      setError(
        isContractor
          ? "Company or contact name is required."
          : "Full name is required.",
      );
      return;
    }
    if (!values.phone.trim()) {
      setError("Telephone is required.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const entity = isContractor ? "contractors" : "project-managers";
      const existing = loadRecords("projects", entity);
      const now = new Date().toISOString();
      const record: ManagerRecord = {
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        createdAt: now,
        updatedAt: now,
        name: isContractor ? name || company : name,
        company: isContractor ? company || name : "",
        code:
          values.code.trim() ||
          nextEntityCode(
            entity,
            existing,
            isContractor ? "Contractors" : "Project managers",
          ),
        type: isContractor ? values.type || "Construction" : "",
        title: isContractor ? "" : values.title.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
        status: "Active",
        notes: values.notes.trim(),
      };
      const persisted = await saveRecordsAsync("projects", entity, [record, ...existing]);
      if (!persisted.ok || persisted.durable !== "postgres") {
        throw new Error(persisted.error || "Could not save to the database.");
      }
      onCreated(display, record);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create record.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={isContractor ? "Add contractor" : "Add project manager"}
      description={
        isContractor
          ? "Saved under Contract Manager → Contractors and selected on this project."
          : "Saved under Project Manager → Project managers and selected on this project."
      }
      className="sm:max-w-md"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="project-role-create-form"
            className="bg-black hover:bg-zinc-800"
            disabled={saving}
          >
            {saving ? "Saving…" : isContractor ? "Add contractor" : "Add project manager"}
          </Button>
        </div>
      }
    >
      <form id="project-role-create-form" className="space-y-3" onSubmit={submit}>
        {isContractor ? (
          <>
            <div>
              <Label htmlFor="role-company" className="mb-1.5 text-[12px]">
                Company <span className="text-orange-500">*</span>
              </Label>
              <Input
                id="role-company"
                value={values.company}
                onChange={(e) => setValues((v) => ({ ...v, company: e.target.value }))}
                placeholder="Company name"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="role-contact" className="mb-1.5 text-[12px]">
                Contact name
              </Label>
              <Input
                id="role-contact"
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                placeholder="Primary contact"
              />
            </div>
            <div>
              <Label htmlFor="role-type" className="mb-1.5 text-[12px]">
                Type
              </Label>
              <select
                id="role-type"
                value={values.type}
                onChange={(e) => setValues((v) => ({ ...v, type: e.target.value }))}
                className="h-9 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/20"
              >
                {["Construction", "Technology", "Service", "Other"].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="role-name" className="mb-1.5 text-[12px]">
                Full name <span className="text-orange-500">*</span>
              </Label>
              <Input
                id="role-name"
                value={values.name}
                onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
                placeholder="Project manager name"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="role-title" className="mb-1.5 text-[12px]">
                Title
              </Label>
              <Input
                id="role-title"
                value={values.title}
                onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
                placeholder="e.g. Site manager"
              />
            </div>
          </>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="role-phone" className="mb-1.5 text-[12px]">
              Telephone <span className="text-orange-500">*</span>
            </Label>
            <Input
              id="role-phone"
              value={values.phone}
              onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
              placeholder="Phone number"
            />
          </div>
          <div>
            <Label htmlFor="role-email" className="mb-1.5 text-[12px]">
              Email
            </Label>
            <Input
              id="role-email"
              type="email"
              value={values.email}
              onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
              placeholder="email@example.com"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="role-notes" className="mb-1.5 text-[12px]">
            Notes
          </Label>
          <Textarea
            id="role-notes"
            value={values.notes}
            onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
            rows={2}
            placeholder="Optional notes"
          />
        </div>
        {error ? <p className="text-[12px] text-rose-600">{error}</p> : null}
      </form>
    </ResponsiveModal>
  );
}
