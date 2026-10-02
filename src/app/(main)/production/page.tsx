"use client";

import { ModulePageClient as ModulePage } from "@/components/module-page-client";
import { moduleConfigs } from "@/lib/module-data";

export default function Page() {
  return <ModulePage config={moduleConfigs.production} />;
}
