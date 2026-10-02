"use client";

import {
  buildPageFormGuide,
  pageFormGuideStats,
  type FormGuide,
  type PageGuide,
} from "@/lib/page-form-guide";
import Link from "next/link";
import { useMemo } from "react";

function matches(query: string, page: PageGuide): PageGuide | null {
  const q = query.trim().toLowerCase();
  if (!q) return page;
  const pageHit = `${page.label} ${page.meaning}`.toLowerCase().includes(q);
  const forms = page.forms.filter((form) => {
    const hay = [form.label, form.meaning, ...form.fields.flatMap((field) => [field.label, field.help, field.kind])]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
  if (pageHit) return page;
  if (forms.length === 0) return null;
  return { ...page, forms };
}

function FieldTable({ form, requiredOnly }: { form: FormGuide; requiredOnly: boolean }) {
  const rows = requiredOnly ? form.fields.filter((field) => field.required) : form.fields;
  if (rows.length === 0) {
    return (
      <p className="px-4 py-3 text-[12px] text-slate-500">
        {requiredOnly
          ? "This form has no required fields."
          : "This page section has no input fields."}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[12px]">
        <thead className="bg-slate-50 text-[10px] font-medium tracking-wide text-slate-500 uppercase">
          <tr>
            <th className="px-4 py-2">Input field</th>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Required</th>
            <th className="px-3 py-2">What to enter</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((field) => (
            <tr key={field.key} className="border-t border-slate-100 align-top">
              <td className="px-4 py-2.5 font-medium text-slate-800">{field.label}</td>
              <td className="px-3 py-2.5 text-slate-500">{field.kind}</td>
              <td className="px-3 py-2.5">
                {field.readOnly ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                    System
                  </span>
                ) : field.required ? (
                  <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                    Required
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                    Optional
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 leading-relaxed text-slate-600">{field.help}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageFormGuide({
  query,
  requiredOnly,
}: {
  query: string;
  requiredOnly: boolean;
}) {
  const pages = useMemo(() => buildPageFormGuide(), []);
  const stats = useMemo(() => pageFormGuideStats(pages), [pages]);
  const visible = useMemo(
    () => pages.map((page) => matches(query, page)).filter((page): page is PageGuide => page != null),
    [pages, query],
  );
  const searching = query.trim().length > 0;

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate-500">
        {stats.pages} pages · {stats.forms} forms · {stats.required} required inputs
      </p>
      {visible.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-[13px] text-slate-500 shadow-sm">
          No pages or forms match that search.
        </div>
      ) : (
        visible.map((page) => (
          <details
            key={`${page.id}-${searching ? "search" : "browse"}`}
            open={searching || undefined}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <summary className="cursor-pointer list-none px-4 py-3 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-[15px] font-semibold text-slate-900">{page.label}</span>
                  <span className="mt-1 block text-[12px] text-slate-400">
                    {page.forms.length === 0
                      ? "No data-entry form"
                      : `${page.forms.length} form${page.forms.length === 1 ? "" : "s"}`}
                  </span>
                </span>
                <Link
                  href={page.href}
                  onClick={(event) => event.stopPropagation()}
                  className="shrink-0 text-[12px] font-medium text-orange-600 hover:text-orange-700"
                >
                  Open page
                </Link>
              </span>
            </summary>
            <div className="border-t border-slate-100 px-4 py-3">
              <p className="text-[13px] leading-relaxed text-slate-600">{page.meaning}</p>
              {page.forms.length === 0 ? (
                <p className="mt-3 text-[12px] text-slate-500">
                  This page does not ask you to fill a record form. The description above is what it is for.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {page.forms.map((form) => (
                    <details
                      key={form.key}
                      open={searching || undefined}
                      className="rounded-lg border border-slate-200"
                    >
                      <summary className="cursor-pointer px-3 py-2.5 text-[13px] font-medium text-slate-800 hover:bg-slate-50">
                        {form.label}
                        <span className="ml-2 text-[11px] font-normal text-slate-400">
                          {form.requiredFields.length === 0
                            ? "No required fields"
                            : `${form.requiredFields.length} required`}
                        </span>
                      </summary>
                      <div className="border-t border-slate-100">
                        <p className="px-3 py-2.5 text-[12px] leading-relaxed text-slate-600">
                          {form.meaning}
                        </p>
                        <FieldTable form={form} requiredOnly={requiredOnly} />
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </details>
        ))
      )}
    </div>
  );
}
