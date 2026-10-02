"use client";

import { Button } from "@/components/ui/button";
import { PAGE_SIZE, PAGE_SIZE_OPTIONS, visiblePageNumbers } from "@/lib/pagination";
import { ArrowLeft2, ArrowRight2 } from "iconsax-react";

export function PaginationBar({
  page,
  pages,
  total,
  from,
  to,
  pageSize = PAGE_SIZE,
  onPageChange,
  onPageSizeChange,
  className,
}: {
  page: number;
  pages: number;
  total: number;
  from: number;
  to: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  className?: string;
}) {
  if (total <= 0) return null;

  const pageButtons = visiblePageNumbers(page, pages);
  const showNav = pages > 1;

  return (
    <div
      className={
        className ??
        "flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span>
          Showing {from}–{to} of {total}
        </span>
        {onPageSizeChange ? (
          <label className="inline-flex items-center gap-1.5 text-slate-400">
            <span className="sr-only">Rows per page</span>
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="h-7 rounded-md border border-input bg-white px-1.5 text-[11px] text-slate-600 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
              {!PAGE_SIZE_OPTIONS.includes(pageSize as (typeof PAGE_SIZE_OPTIONS)[number]) ? (
                <option value={pageSize}>{pageSize} / page</option>
              ) : null}
            </select>
          </label>
        ) : (
          <span className="text-slate-400">· {pageSize} per page</span>
        )}
      </div>

      {showNav ? (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            <ArrowLeft2 size={13} color="currentColor" />
            Prev
          </Button>

          {pageButtons.map((item, index) =>
            item === "ellipsis" ? (
              <span
                key={`ellipsis-${index}`}
                className="px-1 text-slate-400"
                aria-hidden
              >
                …
              </span>
            ) : (
              <Button
                key={item}
                type="button"
                variant={item === page ? "default" : "outline"}
                size="sm"
                className={
                  item === page
                    ? "h-7 min-w-7 bg-black px-2 text-white hover:bg-zinc-800"
                    : "h-7 min-w-7 px-2"
                }
                aria-label={`Page ${item}`}
                aria-current={item === page ? "page" : undefined}
                onClick={() => onPageChange(item)}
              >
                {item}
              </Button>
            ),
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            Next
            <ArrowRight2 size={13} color="currentColor" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
