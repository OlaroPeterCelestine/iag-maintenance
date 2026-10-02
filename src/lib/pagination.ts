export const PAGE_SIZE = 10;

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export function paginateItems<T>(items: T[], page: number, pageSize = PAGE_SIZE): T[] {
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function totalPages(itemCount: number, pageSize = PAGE_SIZE): number {
  if (itemCount <= 0) return 1;
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

export function clampPage(page: number, itemCount: number, pageSize = PAGE_SIZE): number {
  return Math.min(Math.max(1, page), totalPages(itemCount, pageSize));
}

/** Compact page list with ellipses, e.g. [1, '…', 4, 5, 6, '…', 20]. */
export function visiblePageNumbers(
  page: number,
  pages: number,
  siblingCount = 1,
): Array<number | "ellipsis"> {
  if (pages <= 1) return [1];
  if (pages <= 7) {
    return Array.from({ length: pages }, (_, i) => i + 1);
  }

  const current = Math.min(Math.max(1, page), pages);
  const set = new Set<number>();
  set.add(1);
  set.add(pages);
  for (let i = current - siblingCount; i <= current + siblingCount; i += 1) {
    if (i >= 1 && i <= pages) set.add(i);
  }
  // Keep a bit more context near the ends.
  if (current <= 3) {
    set.add(2);
    set.add(3);
    set.add(4);
  }
  if (current >= pages - 2) {
    set.add(pages - 1);
    set.add(pages - 2);
    set.add(pages - 3);
  }

  const sorted = [...set].sort((a, b) => a - b);
  const out: Array<number | "ellipsis"> = [];
  let prev = 0;
  for (const n of sorted) {
    if (prev && n - prev > 1) out.push("ellipsis");
    out.push(n);
    prev = n;
  }
  return out;
}
