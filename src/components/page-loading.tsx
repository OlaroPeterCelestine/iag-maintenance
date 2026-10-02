"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Soft fade/slide-in once content is ready (login-style). */
export function ContentFade({
  ready = true,
  className,
  children,
}: {
  ready?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "transition-opacity duration-150 ease-out",
        ready ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function KpiStripSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4"
        >
          <Skeleton className="h-3 w-16 bg-slate-100" />
          <Skeleton className="mt-2.5 h-6 w-24 bg-slate-100" />
          <Skeleton className="mt-2 h-3 w-28 bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function TableRowsSkeleton({
  columns = 5,
  rows = 7,
}: {
  columns?: number;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, row) => (
        <tr key={row} className="border-t border-slate-100">
          <td className="w-10 px-3 py-3">
            <Skeleton className="h-4 w-4 rounded bg-slate-100" />
          </td>
          {Array.from({ length: columns }).map((_, col) => (
            <td key={col} className="px-3 py-3">
              <Skeleton
                className={cn(
                  "h-3.5 bg-slate-100",
                  col === 0 ? "w-32" : col === columns - 1 ? "w-16" : "w-20",
                )}
              />
            </td>
          ))}
          <td className="w-24 px-3 py-3">
            <Skeleton className="ml-auto h-7 w-14 rounded-md bg-slate-100" />
          </td>
        </tr>
      ))}
    </>
  );
}

/** Full module chrome while searchParams / first paint settles. */
export function ModulePageSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-[#fbfbfc]/90 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-lg bg-slate-200/80 sm:hidden" />
            <Skeleton className="h-5 w-36 bg-slate-200/80" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="hidden h-8 w-48 rounded-lg bg-slate-200/80 sm:block" />
            <Skeleton className="h-8 w-8 rounded-lg bg-slate-200/80" />
            <Skeleton className="h-8 w-8 rounded-lg bg-slate-200/80" />
          </div>
        </div>
      </header>
      <main className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-7 w-48 bg-slate-200/80" />
            <Skeleton className="h-3.5 w-72 max-w-full bg-slate-100" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28 rounded-lg bg-slate-200/80" />
            <Skeleton className="h-9 w-24 rounded-lg bg-slate-200/80" />
          </div>
        </div>
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-lg bg-slate-100" />
          ))}
        </div>
        <KpiStripSkeleton />
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <Skeleton className="h-4 w-40 bg-slate-100" />
          </div>
          <div className="space-y-3 px-4 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-4 rounded bg-slate-100" />
                <Skeleton className="h-3.5 flex-1 bg-slate-100" />
                <Skeleton className="h-3.5 w-16 bg-slate-100" />
                <Skeleton className="h-3.5 w-20 bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Auth / layout gate — sidebar + content pulse so the shell never feels blank. */
export function ShellLoadingSkeleton() {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-white" aria-busy aria-label="Loading">
      <aside className="hidden w-[232px] shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
        <div className="border-b border-slate-100 px-4 py-4">
          <Skeleton className="h-8 w-28 bg-slate-100" />
        </div>
        <div className="space-y-2 p-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton
              key={i}
              className={cn("h-9 rounded-lg bg-slate-100", i === 0 ? "w-full" : "w-[92%]")}
            />
          ))}
        </div>
      </aside>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[#fbfbfc]">
        <ModulePageSkeleton />
      </div>
    </div>
  );
}

/** Branded first paint so public routes never render an empty white body. */
export function BootSplash({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="flex h-dvh w-full flex-col items-center justify-center bg-[#f4f6f8]"
      aria-busy
      aria-label={label}
    >
      {/* First-paint splash — skip next/image so the logo is not gated on the optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/iag-logo.png"
        alt=""
        className="h-14 w-auto max-w-[220px] object-contain"
      />
      <div className="mt-8 h-1.5 w-44 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-orange-500" />
      </div>
      <p className="mt-3 text-[13px] text-slate-500">{label}…</p>
    </div>
  );
}

/** Sign-in chrome while useSearchParams() suspends — not a blank page. */
export function LoginPageSkeleton() {
  return (
    <div className="relative h-dvh overflow-hidden bg-[#f4f6f8]" aria-busy aria-label="Loading sign in">
      <div className="relative grid h-full lg:grid-cols-[1fr_1.05fr]">
        <aside className="hidden min-h-0 flex-col px-10 py-10 lg:flex xl:px-14 xl:py-12">
          <Skeleton className="h-[72px] w-[240px] bg-slate-200/80" />
          <div className="mt-10 space-y-3">
            <Skeleton className="h-3 w-40 bg-orange-100" />
            <Skeleton className="h-8 w-72 max-w-full bg-slate-200/80" />
            <Skeleton className="h-4 w-64 max-w-full bg-slate-100" />
          </div>
        </aside>
        <main className="flex items-center justify-center px-5 py-8 sm:px-8">
          <div className="w-full max-w-[440px] rounded-2xl border border-white/80 bg-white/90 p-6 shadow-sm sm:p-8">
            <Skeleton className="mx-auto mb-6 h-[52px] w-[176px] lg:hidden" />
            <Skeleton className="h-7 w-28 bg-slate-200/80" />
            <Skeleton className="mt-3 h-4 w-64 max-w-full bg-slate-100" />
            <Skeleton className="mt-6 h-11 w-full rounded-xl bg-slate-100" />
            <Skeleton className="mt-4 h-11 w-full rounded-xl bg-slate-100" />
            <Skeleton className="mt-6 h-11 w-full rounded-xl bg-orange-200/70" />
          </div>
        </main>
      </div>
    </div>
  );
}
