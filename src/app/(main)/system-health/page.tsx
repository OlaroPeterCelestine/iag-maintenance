import { redirect } from "next/navigation";
import { isPageAdmin } from "@/lib/page-guard";
import { buildSystemHealthReport } from "@/lib/system-health/probe";
import { buildSystemHealthView } from "@/lib/system-health/view";
import { SystemHealthScreen } from "./system-health-screen";

/**
 * System health — Administrator only.
 *
 * A Server Component on purpose. The gate is the verified session cookie, so a
 * denied role never receives the payload: it names every configured service and
 * the exact failure text from each, which is reconnaissance in the wrong hands.
 * A client-side role check could only hide markup that had already been sent.
 *
 * The first report is probed during this render rather than fetched after
 * hydration, so the page paints its verdict instead of an empty table.
 */
export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
  if (!(await isPageAdmin())) redirect("/");

  const report = await buildSystemHealthReport();
  return <SystemHealthScreen initialView={buildSystemHealthView(report)} initialReport={report} />;
}
