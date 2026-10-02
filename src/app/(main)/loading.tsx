import { ModulePageSkeleton } from "@/components/page-loading";

/** Page slot only — the shell is already mounted for in-app navigations. */
export default function Loading() {
  return <ModulePageSkeleton />;
}
