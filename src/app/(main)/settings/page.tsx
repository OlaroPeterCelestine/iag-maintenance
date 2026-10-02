"use client";

import { ModulePageSkeleton } from "@/components/page-loading";
import { importWithRetry } from "@/lib/chunk-recovery";
import dynamic from "next/dynamic";

const SettingsPage = dynamic(() => importWithRetry(() => import("./settings-page-impl")), {
  ssr: false,
  loading: () => <ModulePageSkeleton />,
});

export default function Page() {
  return <SettingsPage />;
}
