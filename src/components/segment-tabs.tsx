import { cn } from "@/lib/utils";

/** Shared module/desk tab row — no track background (original style). */
export function SegmentTabList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1 overflow-x-auto", className)}>
      {children}
    </div>
  );
}

export function segmentTabClass(
  active: boolean,
  options?: { urgent?: boolean; stretch?: boolean },
) {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium whitespace-nowrap transition sm:text-[13px]",
    options?.stretch !== false && "flex-1 shrink-0",
    active
      ? "bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900"
      : options?.urgent
        ? "text-rose-700 hover:bg-rose-50"
        : "text-slate-900 hover:bg-slate-100 hover:text-black dark:text-slate-200 dark:hover:bg-white/10 dark:hover:text-white",
  );
}

export function segmentTabBadgeClass(active: boolean, urgent?: boolean) {
  return cn(
    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
    active
      ? "bg-white/20 text-white dark:bg-slate-900/10 dark:text-slate-800"
      : urgent
        ? "bg-rose-100 text-rose-700"
        : "bg-slate-200/80 text-slate-600",
  );
}
