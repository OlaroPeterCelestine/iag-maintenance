import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type DashboardWidgetProps = {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  headerClassName?: string;
};

export function DashboardWidget({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  headerClassName,
}: DashboardWidgetProps) {
  return (
    <section
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-16px_rgba(15,23,42,0.18)]",
        className,
      )}
    >
      <header
        className={cn(
          "flex h-10 shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3",
          headerClassName,
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {icon ? <span className="shrink-0 text-slate-400">{icon}</span> : null}
          <h3 className="truncate text-[12px] font-medium text-slate-600">{title}</h3>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}
