"use client";

import { ModulePageSkeleton } from "@/components/page-loading";
import { importWithRetry } from "@/lib/chunk-recovery";
import type { ModuleConfig } from "@/lib/module-data";
import dynamic from "next/dynamic";

/**
 * Lazy-load the 7.5k-line ModulePage so sidebar clicks paint the shell instantly
 * instead of parsing/evaluating the full module workspace on every route change.
 */
const ModulePage = dynamic(
  () =>
    importWithRetry(() => import("@/components/module-page")).then((m) => ({
      default: m.ModulePage,
    })),
  {
    ssr: false,
    loading: () => <ModulePageSkeleton />,
  },
);

export function ModulePageClient({ config }: { config: ModuleConfig }) {
  return <ModulePage config={config} />;
}
