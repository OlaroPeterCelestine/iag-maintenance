"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PaginationBar } from "@/components/pagination-bar";
import { ReportExportMenu } from "@/components/report-export-menu";
import {
  reportTdCheckClass,
  reportThCheckClass,
  useRowSelection,
} from "@/components/report-shell";
import { usePagination } from "@/hooks/use-pagination";
import { loadFieldAudit, type FieldAuditEntry } from "@/lib/field-audit";
import {
  ArrowRight2,
  DocumentText,
  People,
  Refresh,
  SearchNormal1,
  Setting2,
} from "iconsax-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMounted } from "@/hooks/use-mounted";

function humanizeField(field: string) {
  return field
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeEntity(entity: string) {
  return entity
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function relativeWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return "";
}

function truncate(value: string, max = 48) {
  const text = value.trim();
  if (!text) return "—";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function ValueChip({
  value,
  tone,
}: {
  value: string;
  tone: "from" | "to" | "neutral";
}) {
  const styles =
    tone === "from"
      ? "border-rose-100 bg-rose-50 text-rose-700"
      : tone === "to"
        ? "border-emerald-100 bg-emerald-50 text-emerald-800"
        : "border-slate-100 bg-slate-50 text-slate-600";
  return (
    <span
      className={`inline-flex max-w-[220px] truncate rounded-md border px-2 py-0.5 text-[11px] tabular-nums ${styles}`}
      title={value || "—"}
    >
      {truncate(value || "—", 36)}
    </span>
  );
}

export function FieldAuditPanel() {
  const [tick, setTick] = useState(0);
  const ready = useMounted();
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");

  useEffect(() => {
    const reload = () => setTick((n) => n + 1);
    window.addEventListener("financeiag-records-changed", reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener("financeiag-records-changed", reload);
      window.removeEventListener("storage", reload);
    };
  }, []);

  const audit = useMemo(() => {
    void tick;
    if (!ready) return [] as FieldAuditEntry[];
    return loadFieldAudit(2000);
  }, [ready, tick]);

  const modules = useMemo(() => uniqueSorted(audit.map((r) => r.module)), [audit]);
  const entities = useMemo(() => uniqueSorted(audit.map((r) => r.entity)), [audit]);
  const users = useMemo(() => uniqueSorted(audit.map((r) => r.user)), [audit]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return audit.filter((row) => {
      if (moduleFilter !== "all" && row.module !== moduleFilter) return false;
      if (entityFilter !== "all" && row.entity !== entityFilter) return false;
      if (userFilter !== "all" && row.user !== userFilter) return false;
      if (!q) return true;
      const blob = [
        row.user,
        row.module,
        row.entity,
        row.field,
        row.from,
        row.to,
        row.recordId,
        humanizeField(row.field),
        humanizeEntity(row.entity),
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [audit, query, moduleFilter, entityFilter, userFilter]);

  const {
    page,
    setPage,
    pages,
    pageItems: pageRows,
    pageSize,
    setPageSize,
    total,
    from,
    to,
  } = usePagination(filtered, 25);
  const filteredIds = useMemo(() => filtered.map((row) => row.id), [filtered]);
  const pageIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const selection = useRowSelection(filteredIds);
  const pageAllSelected =
    pageIds.length > 0 && pageIds.every((id) => selection.isSelected(id));

  useEffect(() => {
    setPage(1);
  }, [query, moduleFilter, entityFilter, userFilter, setPage]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayCount = audit.filter((r) => r.timestamp.startsWith(todayKey)).length;
  const uniqueRecords = new Set(audit.map((r) => `${r.entity}:${r.recordId}`)).size;

  function clearFilters() {
    setQuery("");
    setModuleFilter("all");
    setEntityFilter("all");
    setUserFilter("all");
  }

  const hasFilters =
    query.trim() ||
    moduleFilter !== "all" ||
    entityFilter !== "all" ||
    userFilter !== "all";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[14px] font-semibold text-slate-800">Field Audit Log</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Immutable trail of every field change across modules
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ReportExportMenu
              spec={{
                title: "Field audit log",
                filename: "field-audit-log",
                columns: ["When", "User", "Module", "Entity", "Record", "Field", "From", "To"],
                rows: filtered.map((row) => [
                  row.timestamp,
                  row.user,
                  row.module,
                  row.entity,
                  row.recordId,
                  row.field,
                  row.from,
                  row.to,
                ]),
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTick((n) => n + 1)}
            >
              <Refresh size={13} color="currentColor" /> Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            icon={<DocumentText size={16} color="currentColor" />}
            label="Changes logged"
            value={String(audit.length)}
          />
          <Stat
            icon={<People size={16} color="currentColor" />}
            label="Users"
            value={String(users.length)}
          />
          <Stat
            icon={<Setting2 size={16} color="currentColor" />}
            label="Records touched"
            value={String(uniqueRecords)}
          />
          <Stat
            icon={<Refresh size={16} color="currentColor" />}
            label="Today"
            value={String(todayCount)}
            accent
          />
        </div>

        <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-[220px] flex-1">
            <SearchNormal1
              size={13}
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
              color="currentColor"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search user, field, value, record…"
              className="h-8 pl-8 text-[12px]"
            />
          </div>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-white px-2.5 text-[12px] text-slate-700 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            aria-label="Filter by module"
          >
            <option value="all">All modules</option>
            {modules.map((mod) => (
              <option key={mod} value={mod}>
                {mod}
              </option>
            ))}
          </select>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-white px-2.5 text-[12px] text-slate-700 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            aria-label="Filter by entity"
          >
            <option value="all">All entities</option>
            {entities.map((entity) => (
              <option key={entity} value={entity}>
                {humanizeEntity(entity)}
              </option>
            ))}
          </select>
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-white px-2.5 text-[12px] text-slate-700 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            aria-label="Filter by user"
          >
            <option value="all">All users</option>
            {users.map((user) => (
              <option key={user} value={user}>
                {user}
              </option>
            ))}
          </select>
          {hasFilters && (
            <Button type="button" variant="ghost" size="sm" className="h-8 text-[11px]" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] tracking-wide text-slate-400 uppercase">
                <th className={reportThCheckClass}>
                  <Checkbox
                    checked={pageAllSelected}
                    onCheckedChange={() => selection.togglePage(pageIds)}
                    aria-label="Select all rows on this page"
                  />
                </th>
                <th className="px-3 py-2.5 font-medium">When</th>
                <th className="px-3 py-2.5 font-medium">User</th>
                <th className="px-3 py-2.5 font-medium">Record</th>
                <th className="px-3 py-2.5 font-medium">Field</th>
                <th className="px-3 py-2.5 font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => {
                const relative = relativeWhen(row.timestamp);
                const isSelected = selection.isSelected(row.id);
                return (
                  <tr
                    key={row.id}
                    data-selected={isSelected || undefined}
                    className="border-b border-slate-50 transition hover:bg-slate-50/60 data-[selected=true]:bg-slate-50/80"
                  >
                    <td className={reportTdCheckClass}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => selection.toggle(row.id)}
                        aria-label={`Select audit entry ${row.id}`}
                      />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <p className="font-medium text-slate-700">{formatWhen(row.timestamp)}</p>
                      {relative ? (
                        <p className="mt-0.5 text-[10px] text-slate-400">{relative}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                          {(row.user || "?").slice(0, 1).toUpperCase()}
                        </span>
                        <span className="font-medium text-slate-800">{row.user || "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <p className="font-medium text-slate-800">{humanizeEntity(row.entity)}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {row.module}
                        {row.recordId ? ` · ${row.recordId.slice(0, 8)}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <span className="inline-flex rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700">
                        {humanizeField(row.field)}
                      </span>
                      <p className="mt-1 font-mono text-[10px] text-slate-400">{row.field}</p>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ValueChip value={row.from} tone="from" />
                        <ArrowRight2 size={12} color="currentColor" className="text-slate-300" />
                        <ValueChip value={row.to} tone="to" />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!pageRows.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-14 text-center">
                    <div className="mx-auto max-w-sm">
                      <DocumentText size={28} className="mx-auto text-slate-300" color="currentColor" />
                      <p className="mt-3 text-[13px] font-medium text-slate-700">
                        {audit.length ? "No matching changes" : "No field changes logged yet"}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {audit.length
                          ? "Try clearing filters or searching a different term."
                          : "Edit any record and the before/after values will appear here."}
                      </p>
                      {hasFilters ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-4"
                          onClick={clearFilters}
                        >
                          Clear filters
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <PaginationBar
            page={page}
            pages={pages}
            total={total}
            from={from}
            to={to}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500"
          />
        )}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <p className="text-[10px] font-medium tracking-wide uppercase">{label}</p>
      </div>
      <p
        className={`mt-1 text-[18px] font-semibold tabular-nums ${
          accent ? "text-emerald-700" : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
