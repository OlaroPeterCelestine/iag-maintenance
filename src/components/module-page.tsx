"use client";

import { FactoryScopeSelect } from "@/components/factory-scope-select";
import { useAppShell } from "@/components/app-shell";
import { SegmentTabList, segmentTabClass } from "@/components/segment-tabs";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  ContentFade,
  KpiStripSkeleton,
  ModulePageSkeleton,
} from "@/components/page-loading";
import { importWithRetry } from "@/lib/chunk-recovery";
import { iconForLabel } from "@/lib/iconsax";
import {
  entityDefinitions,
  type EntityDefinition,
} from "@/lib/manager-entities";
import { descriptionForRecordPage } from "@/lib/page-form-guide";
import {
  type ModuleConfig,
  type ModuleKpi,
  type ModuleSlug,
} from "@/lib/module-data";
import { canAccessModuleTab, defaultHomePath } from "@/lib/access-control";
import { getModuleKpis } from "@/lib/ledger/live-data";
import {
  ArrowLeft2,
  HambergerMenu,
} from "iconsax-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

/** Heavy CRUD / special panels — separate chunk from the module chrome. */
const EntityWorkspace = dynamic(
  () =>
    importWithRetry(() => import("@/components/module-entity-records")).then((m) => ({
      default: m.EntityWorkspace,
    })),
  { ssr: false, loading: () => <ModulePageSkeleton /> },
);

function ModuleKpiStrip({ slug }: { slug: ModuleSlug }) {
  const [kpis, setKpis] = useState<ModuleKpi[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      // Defer off the click/nav path so invoice tables stay interactive.
      timer = setTimeout(() => {
        if (cancelled) return;
        setKpis(getModuleKpis(slug));
        setReady(true);
      }, 0);
    };
    const reloadDebounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(apply, 250);
    };
    queueMicrotask(apply);
    window.addEventListener("financeiag-records-changed", reloadDebounced);
    window.addEventListener("financeiag-ledger-changed", reloadDebounced);
    window.addEventListener("storage", reloadDebounced);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("financeiag-records-changed", reloadDebounced);
      window.removeEventListener("financeiag-ledger-changed", reloadDebounced);
      window.removeEventListener("storage", reloadDebounced);
    };
  }, [slug]);

  if (!ready) {
    return <KpiStripSkeleton />;
  }
  if (!kpis.length) return null;

  return (
    <ContentFade ready className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {kpis.map((kpi) => (
        <div
          key={kpi.title}
          className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4"
        >
          <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
            {kpi.title}
          </p>
          <p className="mt-1.5 text-[20px] font-semibold tracking-tight text-slate-900">
            {kpi.value}
          </p>
          <p
            className={
              kpi.positive
                ? "mt-1 break-words text-[11px] leading-snug text-emerald-600"
                : "mt-1 break-words text-[11px] leading-snug text-amber-600"
            }
          >
            {kpi.delta}
            {kpi.hint ? ` · ${kpi.hint}` : ""}
          </p>
        </div>
      ))}
    </ContentFade>
  );
}

function ModulePageContent({ config }: { config: ModuleConfig }) {
  const { openSidebar } = useAppShell();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [accessTick, setAccessTick] = useState(0);
  useEffect(() => {
    const bump = () => setAccessTick((t) => t + 1);
    window.addEventListener("financeiag-auth-changed", bump);
    window.addEventListener("financeiag-settings-changed", bump);
    return () => {
      window.removeEventListener("financeiag-auth-changed", bump);
      window.removeEventListener("financeiag-settings-changed", bump);
    };
  }, []);
  const definitions = useMemo(() => {
    void accessTick;
    return entityDefinitions(config.slug as ModuleSlug).filter((definition) =>
      canAccessModuleTab(config.slug as ModuleSlug, definition.key),
    );
  }, [config.slug, accessTick]);
  const requested = searchParams.get("view");
  const activityAccount = (searchParams.get("activity") || "").trim();
  const focus = searchParams.get("focus");
  const firstDefinition = definitions[0];
  const requestedDefinition = definitions.find(
    (definition) => definition.key === requested,
  );
  const activeDefinition = requestedDefinition ?? firstDefinition;

  useEffect(() => {
    if (!firstDefinition) return;
    if (requestedDefinition) return;
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("view") === firstDefinition.key) return;
    params.set("view", firstDefinition.key);
    const qs = params.toString();
    router.replace(`/${config.slug}?${qs}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [config.slug, firstDefinition?.key, requested, requestedDefinition?.key, router]);

  const viewingBankActivity =
    config.slug === "banking" &&
    activeDefinition?.key === "bank-and-cash-accounts" &&
    Boolean(activityAccount);

  const accountsHref = "/banking?view=bank-and-cash-accounts";

  const pageTitle = viewingBankActivity
    ? activityAccount
    : (activeDefinition?.label ?? config.label);
  const pageDescription = viewingBankActivity
    ? focus === "payments"
      ? "Uncategorized payments on this account"
      : focus === "receipts"
        ? "Uncategorized receipts on this account"
        : "Transaction history and closing balance for this account"
    : descriptionForRecordPage(config.slug, activeDefinition?.label ?? config.label) ??
      config.description;

  return (
    <>
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-3 sm:px-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={openSidebar} aria-label="Open navigation">
            <HambergerMenu size={18} variant="Linear" color="currentColor" />
          </Button>
          <nav className="flex min-w-0 items-center gap-2 text-[13px] text-slate-400">
            <Link href={defaultHomePath()} className="shrink-0 hover:text-slate-700">
              Overview
            </Link>
            <span className="shrink-0">/</span>
            <Link href={`/${config.slug}`} className="shrink-0 font-medium text-slate-700 hover:text-slate-900">
              {config.label}
            </Link>
            {activeDefinition && (
              <>
                <span className="shrink-0">/</span>
                {viewingBankActivity ? (
                  <Link
                    href={accountsHref}
                    className="shrink-0 text-slate-500 hover:text-slate-800"
                  >
                    {activeDefinition.label}
                  </Link>
                ) : (
                  <span className="truncate text-slate-500">{activeDefinition.label}</span>
                )}
              </>
            )}
            {viewingBankActivity ? (
              <>
                <span className="shrink-0">/</span>
                <span className="truncate font-medium text-slate-700" title={activityAccount}>
                  {activityAccount}
                </span>
              </>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-0.5">
          <NotificationsMenu />
          <ThemeToggle />
          <PageMoreMenu />
        </div>
      </header>

      <main className="flex w-full flex-col gap-4 p-4 sm:p-5">
        <div>
          {viewingBankActivity ? (
            <Link
              href={accountsHref}
              className="mb-3 inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-[13px] font-medium text-white shadow-sm hover:bg-slate-800"
            >
              <ArrowLeft2 size={16} variant="Linear" color="currentColor" />
              Back to Bank &amp; Cash Accounts
            </Link>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">{pageTitle}</h1>
            {/* Which factory you are standing in. Module-wide, not per table. */}
            <FactoryScopeSelect />
          </div>
          {pageDescription ? (
            <p className="mt-1 text-[13px] text-slate-500">{pageDescription}</p>
          ) : null}
        </div>

        {!viewingBankActivity ? <ModuleKpiStrip slug={config.slug as ModuleSlug} /> : null}

        {!viewingBankActivity && definitions.length > 1 && config.slug !== "production" ? (
          <SegmentTabList className="flex-wrap">
            {definitions.map((definition: EntityDefinition) => {
              const TabIcon = iconForLabel(definition.label);
              const isActive = definition.key === activeDefinition?.key;
              return (
                <Link
                  key={definition.key}
                  href={`/${config.slug}?view=${definition.key}`}
                  className={segmentTabClass(isActive, { stretch: false })}
                >
                  <TabIcon size={14} variant={isActive ? "Bold" : "Linear"} color="currentColor" />
                  {definition.label}
                </Link>
              );
            })}
          </SegmentTabList>
        ) : null}

        {activeDefinition && (
          <EntityWorkspace
            key={activeDefinition.key}
            config={config}
            definition={activeDefinition}
          />
        )}
      </main>
    </>
  );
}

export function ModulePage({ config }: { config: ModuleConfig }) {
  return (
    <Suspense fallback={<ModulePageSkeleton />}>
      <ModulePageContent config={config} />
    </Suspense>
  );
}
