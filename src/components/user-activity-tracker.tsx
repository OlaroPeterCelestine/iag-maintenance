"use client";

import { trackPageView } from "@/lib/user-activity";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function TrackerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const search = searchParams?.toString();
    trackPageView(pathname, search ? `?${search}` : "");
  }, [pathname, searchParams]);

  return null;
}

/** Watches route changes and writes PageView rows to activity logs. */
export function UserActivityTracker() {
  return (
    <Suspense fallback={null}>
      <TrackerInner />
    </Suspense>
  );
}
