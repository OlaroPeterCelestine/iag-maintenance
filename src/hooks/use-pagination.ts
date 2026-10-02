"use client";

import { clampPage, PAGE_SIZE, paginateItems, totalPages } from "@/lib/pagination";
import { useCallback, useMemo, useState } from "react";

export function usePagination<T>(items: T[], initialPageSize = PAGE_SIZE) {
  const initial =
    Number.isFinite(initialPageSize) && initialPageSize > 0
      ? Math.floor(initialPageSize)
      : PAGE_SIZE;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initial);

  const pages = totalPages(items.length, pageSize);
  // Clamp on read rather than writing the correction back. Callers only ever
  // see `safePage`, so storing it again bought nothing and cost a second render
  // every time a filter shrank the list under the current page.
  const safePage = clampPage(page, items.length, pageSize);

  const setPageSize = useCallback((next: number) => {
    const size = Number.isFinite(next) && next > 0 ? Math.floor(next) : PAGE_SIZE;
    setPageSizeState(size);
    setPage(1);
  }, []);

  const pageItems = useMemo(
    () => paginateItems(items, safePage, pageSize),
    [items, safePage, pageSize],
  );

  return {
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    pages,
    pageItems,
    total: items.length,
    from: items.length === 0 ? 0 : (safePage - 1) * pageSize + 1,
    to: Math.min(safePage * pageSize, items.length),
  };
}
