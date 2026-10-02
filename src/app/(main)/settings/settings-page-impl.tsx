"use client";

import { useAppShell } from "@/components/app-shell";
import { BankAccountSelect } from "@/components/bank-account-select";
import {
  BusinessProfileForm,
  type BusinessForm,
} from "@/components/business-profile-form";
import { BusinessBackupPanel } from "@/components/business-backup-panel";
import { ChartOfAccountsSelect } from "@/components/chart-of-accounts-select";
import { ManagerIoImporter } from "@/components/manager-io-importer";
import { DataResetPanel } from "@/components/data-reset-panel";
import { ModulePageSkeleton } from "@/components/page-loading";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle, ThemeModeChooser } from "@/components/theme-toggle";
import { FeedbackModals, useFeedbackModals } from "@/components/feedback-modals";
import { PaginationBar } from "@/components/pagination-bar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { usePagination } from "@/hooks/use-pagination";
import { useUndoStack } from "@/hooks/use-undo-stack";
import { isCoaPickerField, coaPickerFilterForField } from "@/lib/ledger/chart-of-accounts";
import { fetchAndApplyDailyExchangeRates } from "@/lib/fx-daily";
import { sendTestEmail } from "@/lib/export/email-document";
import {
  CORE_TABS,
  CLAIM_PAYERS_KEY,
  CONTROL_ACCOUNTS_KEY,
  CUSTOM_FIELDS_KEY,
  CUSTOMER_PORTALS_KEY,
  DEFAULT_ENABLED_TABS,
  DIVISIONS_KEY,
  SUPPLIER_CATEGORIES_KEY,
  EMAIL_TEMPLATES_KEY,
  EXCHANGE_RATES_KEY,
  FORM_DEFAULTS_KEY,
  FORM_TYPES,
  FOOTERS_KEY,
  FX_KEY,
  PAYMENT_RULES_KEY,
  PAYSLIP_ITEMS_KEY,
  RECEIPT_RULES_KEY,
  RECURRING_TEMPLATES_KEY,
  REQUEST_EMAIL_CONTACTS_KEY,
  SETTINGS_SECTION_ALIASES,
  SETTINGS_SECTIONS,
  TAX_CODES_KEY,
  THEMES_KEY,
  USERS_KEY,
  defaultClaimPayers,
  defaultControlAccounts,
  defaultCustomerPortals,
  defaultDivisions,
  defaultSupplierCategories,
  defaultEmailSettings,
  defaultExchangeRates,
  defaultForeignCurrencies,
  defaultFormDefaults,
  defaultFooters,
  defaultManagerSettings,
  defaultPaymentRules,
  defaultPayslipItems,
  defaultReceiptRules,
  defaultRecurringTemplates,
  defaultRequestEmailContacts,
  defaultTaxCodes,
  defaultThemes,
  loadEmailSettings,
  loadEmailTemplates,
  loadEnabledTabs,
  loadList,
  loadManagerSettings,
  saveBusinessLogo,
  saveEmailSettings,
  saveEnabledTabs,
  saveList,
  saveManagerSettings,
  saveRequestEmailContacts,
  fetchRequestEmailContacts,
  tabLabel,
  type BankRuleRow,
  type ClaimPayerRow,
  type ControlAccountRow,
  type CustomFieldRow,
  type CustomerPortalRow,
  type DivisionRow,
  type SupplierCategoryRow,
  type EmailSettings,
  type RequestEmailContact,
  type EmailTemplateRow,
  type ExchangeRateRow,
  type FooterRow,
  type ForeignCurrencyRow,
  type FormDefaultRow,
  type ManagerSettings,
  type PayslipItemRow,
  type RecurringTemplateRow,
  type TaxCodeRow,
  type ThemeRow,
  type UserRow,
} from "@/lib/manager-settings";
import { assertPermission, currentUserCan, currentUserIsAdmin } from "@/lib/access-control";
import { cleanTransactionsSystem } from "@/lib/reset-data";
import { resetBooksNow } from "@/lib/clear-demo-data";
import { type ModuleSlug } from "@/lib/module-data";
import { cn } from "@/lib/utils";
import { iconForLabel } from "@/lib/iconsax";
import { Add, ArrowLeft2, HambergerMenu, Setting2, Trash } from "iconsax-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { appToastError } from "@/lib/app-toast";
import {
  IDENTITY_MANAGED_ELSEWHERE,
  OWNS_IDENTITY_DIRECTORY,
  identityUsersHref,
} from "@/lib/identity-directory";

function SettingsPageContent() {
  const { openSidebar } = useAppShell();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawSection = searchParams.get("section");
  const resolved = rawSection
    ? (SETTINGS_SECTION_ALIASES[rawSection] ?? rawSection)
    : null;
  const sectionId =
    resolved && SETTINGS_SECTIONS.some((s) => s.id === resolved) ? resolved : null;

  const [settings, setSettings] = useState<ManagerSettings>(defaultManagerSettings);
  const [enabledTabs, setEnabledTabs] = useState<ModuleSlug[]>(DEFAULT_ENABLED_TABS);
  const [ready, setReady] = useState(false);
  const [canEditSettings, setCanEditSettings] = useState(false);
  const { feedback, close, showSuccess, showWarning, askConfirm } = useFeedbackModals();

  const [taxCodes, setTaxCodes] = useState<TaxCodeRow[]>([]);
  const [currencies, setCurrencies] = useState<ForeignCurrencyRow[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldRow[]>([]);
  const [divisions, setDivisions] = useState<DivisionRow[]>([]);
  const [supplierCategories, setSupplierCategories] = useState<SupplierCategoryRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [formDefaults, setFormDefaults] = useState<FormDefaultRow[]>([]);
  const [footers, setFooters] = useState<FooterRow[]>([]);
  const [email, setEmail] = useState<EmailSettings>(defaultEmailSettings);
  /** Read-only mirror of the server's EgoSMS env config — never holds secrets. */
  const [smsConfig, setSmsConfig] = useState<{
    enabled: boolean;
    configured: boolean;
    missing: string[];
    sender: string;
    transport: string;
    endpoint: string;
  } | null>(null);
  const [smsConfigLoading, setSmsConfigLoading] = useState(true);
  const [requestEmailContacts, setRequestEmailContacts] = useState<RequestEmailContact[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateRow[]>([]);
  const [fxFetching, setFxFetching] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplateRow[]>([]);
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [payslipItems, setPayslipItems] = useState<PayslipItemRow[]>([]);
  const [claimPayers, setClaimPayers] = useState<ClaimPayerRow[]>([]);
  const [receiptRules, setReceiptRules] = useState<BankRuleRow[]>([]);
  const [paymentRules, setPaymentRules] = useState<BankRuleRow[]>([]);
  const [controlAccounts, setControlAccounts] = useState<ControlAccountRow[]>([]);
  const [customerPortals, setCustomerPortals] = useState<CustomerPortalRow[]>([]);
  const [recurring, setRecurring] = useState<RecurringTemplateRow[]>([]);

  useEffect(() => {
    if (rawSection && SETTINGS_SECTION_ALIASES[rawSection]) {
      router.replace(`/settings?section=${SETTINGS_SECTION_ALIASES[rawSection]}`);
    }
  }, [rawSection, router]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const allowed = currentUserIsAdmin() && currentUserCan("edit-settings");
      setCanEditSettings(allowed);
      if (!allowed) {
        appToastError("Access denied", "Your role cannot edit workspace settings.");
        router.replace("/");
        return;
      }
      setSettings(loadManagerSettings());
      setEnabledTabs(loadEnabledTabs());
      setTaxCodes(loadList(TAX_CODES_KEY, defaultTaxCodes));
      setCurrencies(loadList(FX_KEY, defaultForeignCurrencies));
      setCustomFields(loadList(CUSTOM_FIELDS_KEY, []));
      setDivisions(loadList(DIVISIONS_KEY, defaultDivisions));
      setSupplierCategories(loadList(SUPPLIER_CATEGORIES_KEY, defaultSupplierCategories));
      setUsers(loadList<UserRow>(USERS_KEY, []));
      // Prefer Go API users when available so Settings matches Users & roles.
      void import("@/lib/auth-api")
        .then(({ fetchDbUsers }) => fetchDbUsers())
        .then((dbUsers) => {
          if (cancelled || !dbUsers.length) return;
          setUsers(
            dbUsers.map((u) => ({
              id: u.id,
              name: u.name,
              username: u.username,
              email: u.email ?? "",
              role: u.role,
              canView: u.canView ?? "Yes",
              canCreate: u.canCreate ?? "No",
              canEdit: u.canEdit ?? "No",
              canDelete: u.canDelete ?? "No",
            })),
          );
        })
        .catch(() => {
          /* keep hydrated DB/memory users */
        });
      setFormDefaults(loadList(FORM_DEFAULTS_KEY, defaultFormDefaults));
      setFooters(loadList(FOOTERS_KEY, defaultFooters));
      setEmail(loadEmailSettings());
      void import("@/lib/api-auth")
        .then(({ apiFetch }) => apiFetch("/api/sms/send"))
        .then((res) => res.json())
        .then((json: { config?: typeof smsConfig }) => {
          if (cancelled) return;
          setSmsConfig(json?.config ?? null);
        })
        .catch(() => {
          /* status stays unknown; the panel says so */
        })
        .finally(() => {
          if (!cancelled) setSmsConfigLoading(false);
        });
      setRequestEmailContacts(
        loadList(REQUEST_EMAIL_CONTACTS_KEY, defaultRequestEmailContacts),
      );
      void fetchRequestEmailContacts()
        .then((rows) => {
          if (!cancelled && rows.length) setRequestEmailContacts(rows);
        })
        .catch(() => {
          /* keep local defaults */
        });
      setExchangeRates(loadList(EXCHANGE_RATES_KEY, defaultExchangeRates));
      setEmailTemplates(loadEmailTemplates());
      setThemes(loadList(THEMES_KEY, defaultThemes));
      setPayslipItems(loadList(PAYSLIP_ITEMS_KEY, defaultPayslipItems));
      setClaimPayers(loadList(CLAIM_PAYERS_KEY, defaultClaimPayers));
      setReceiptRules(loadList(RECEIPT_RULES_KEY, defaultReceiptRules));
      setPaymentRules(loadList(PAYMENT_RULES_KEY, defaultPaymentRules));
      setControlAccounts(loadList(CONTROL_ACCOUNTS_KEY, defaultControlAccounts));
      setCustomerPortals(loadList(CUSTOMER_PORTALS_KEY, defaultCustomerPortals));
      setRecurring(loadList(RECURRING_TEMPLATES_KEY, defaultRecurringTemplates));
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeSection = sectionId
    ? (SETTINGS_SECTIONS.find((s) => s.id === sectionId) ?? null)
    : null;

  const sectionGroups = useMemo(() => {
    const map = new Map<string, typeof SETTINGS_SECTIONS>();
    for (const section of SETTINGS_SECTIONS) {
      const list = map.get(section.group) ?? [];
      list.push(section);
      map.set(section.group, list);
    }
    return Array.from(map.entries());
  }, []);

  function flashSaved(message = "Your settings were saved successfully.") {
    showSuccess("Saved", message);
  }

  function persistSettings(next: ManagerSettings) {
    const blocked = assertPermission("edit-settings");
    if (blocked) {
      showWarning("Permission denied", blocked);
      return;
    }
    const previous = settings;
    const basisChanged = settings.accountingBasis !== next.accountingBasis;
    setSettings(next);
    void (async () => {
      const ok = await saveManagerSettings(next);
      if (!ok) {
        setSettings(previous);
        showWarning(
          "Not saved to database",
          "Settings stayed in this tab only. Check your connection and try again.",
        );
        return;
      }
      if (basisChanged) {
        void import("@/lib/ledger/resync").then(({ resyncLedgerFromRecords }) => {
          resyncLedgerFromRecords();
        });
      }
      flashSaved();
    })();
  }

  function onBusinessSaved(form: BusinessForm) {
    const blocked = assertPermission("edit-settings");
    if (blocked) {
      showWarning("Permission denied", blocked);
      return;
    }
    const address = [
      form.addressLine1,
      form.addressLine2,
      form.city,
      form.state,
      form.postalCode,
      form.country,
    ]
      .filter(Boolean)
      .join(", ");
    const next = {
      ...settings,
      businessName: form.businessName,
      address,
      country: form.country,
    };
    setSettings(next);
    void (async () => {
      const [settingsOk, logoOk] = await Promise.all([
        saveManagerSettings(next),
        saveBusinessLogo({
          dataUrl: form.logoPreview,
          fileName: form.logoName,
        }),
      ]);
      if (!settingsOk || !logoOk) {
        showWarning(
          "Not saved to database",
          "Business details stayed in this tab only. Check your connection and try again.",
        );
        return;
      }
      flashSaved();
    })();
  }

  function toggleTab(slug: ModuleSlug, on: boolean) {
    const blocked = assertPermission("edit-settings");
    if (blocked) {
      showWarning("Permission denied", blocked);
      return;
    }
    if (CORE_TABS.includes(slug) && !on) return;
    const next = on
      ? Array.from(new Set([...enabledTabs, slug]))
      : enabledTabs.filter((t) => t !== slug);
    setEnabledTabs(next);
    saveEnabledTabs(next);
    flashSaved();
  }

  function persistRows<T>(key: string, rows: T[], setter: (rows: T[]) => void) {
    if (key === USERS_KEY && !OWNS_IDENTITY_DIRECTORY) {
      showWarning("Managed in Admin", IDENTITY_MANAGED_ELSEWHERE);
      return;
    }
    const blocked = assertPermission("edit-settings");
    if (blocked) {
      showWarning("Permission denied", blocked);
      return;
    }
    setter(rows);
    saveList(key, rows);
    if (key === USERS_KEY) {
      window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
    }
    flashSaved();
  }

  if (!canEditSettings) {
    return <div className="min-h-dvh bg-[#fbfbfc]" />;
  }

  return (
    <>
      <FeedbackModals feedback={feedback} onClose={close} />
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-3 sm:px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={openSidebar}
            aria-label="Open navigation"
          >
            <HambergerMenu size={18} variant="Linear" color="currentColor" />
          </Button>
          <div className="flex items-center gap-2 text-[13px] text-slate-400">
            <Setting2 size={14} variant="Linear" color="currentColor" />
            <Link href="/" className="hover:text-slate-700">
              Overview
            </Link>
            <span>/</span>
            <span className="font-medium text-slate-700">Settings</span>
            {activeSection ? (
              <>
                <span>/</span>
                <span className="font-medium text-slate-700">{activeSection.title}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <NotificationsMenu />
          <ThemeToggle />
          <PageMoreMenu />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7f7f8]">
        <div className="w-full px-4 py-5 sm:px-6 sm:py-6">
          {!ready ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-slate-400">
              Loading settings…
            </div>
          ) : !activeSection ? (
            <>
              <div className="mb-5">
                <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">Settings</h1>
                <p className="mt-1 max-w-2xl text-[13px] text-slate-500">
                  Machines, work orders, and service schedules for this IAG Maintenance workspace.
                </p>
              </div>

              <div className="space-y-7">
                {sectionGroups.map(([group, sections]) => (
                  <section key={group} className="space-y-2.5">
                    <h2 className="text-[11px] font-semibold tracking-[0.1em] text-slate-400 uppercase">
                      {group}
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                      {sections.map((section) => {
                        const CardIcon = iconForLabel(section.title);
                        return (
                          <Link
                            key={section.id}
                            href={`/settings?section=${section.id}`}
                            className="group flex min-h-[104px] items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-orange-300 hover:bg-orange-50/40"
                          >
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 transition-colors group-hover:border-orange-200 group-hover:bg-orange-500 group-hover:text-white">
                              <CardIcon size={18} variant="Linear" color="currentColor" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[14px] font-semibold text-slate-900">
                                {section.title}
                              </span>
                              <span className="mt-1 block text-[12px] leading-relaxed text-slate-500">
                                {section.description}
                              </span>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="mb-4 space-y-3">
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 hover:text-orange-600"
                >
                  <ArrowLeft2 size={14} variant="Linear" color="currentColor" />
                  All settings
                </Link>
                <div>
                  <h1 className="text-[20px] font-semibold tracking-tight text-slate-900">
                    {activeSection.title}
                  </h1>
                  <p className="mt-1 text-[13px] text-slate-500">{activeSection.description}</p>
                </div>
              </div>

              <div className="space-y-4">
            {sectionId === "business" && (
              <PanelCard>
                <BusinessProfileForm
                  finishLabel="Update"
                  onComplete={onBusinessSaved}
                />
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="mb-2 text-[12px] text-slate-500">
                    Need a local copy of this workspace?
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.push("/settings?section=backup-restore")}
                  >
                    Open Backup & Restore
                  </Button>
                </div>
              </PanelCard>
            )}

            {sectionId === "backup-restore" && (
              <PanelCard>
                <BusinessBackupPanel embedded />
              </PanelCard>
            )}

            {sectionId === "import-manager-io" && (
              <PanelCard>
                <ManagerIoImporter embedded />
              </PanelCard>
            )}

            {sectionId === "reset-data" && (
              <PanelCard>
                <DataResetPanel embedded />
              </PanelCard>
            )}

            {sectionId === "appearance" && (
              <>
                <PanelCard>
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-[14px] font-semibold text-slate-900">Colour theme</h3>
                      <p className="mt-1 text-[12px] text-slate-500">
                        Choose a light or dark appearance, or follow your device setting. This is
                        saved on this browser.
                      </p>
                    </div>
                    <ThemeModeChooser />
                  </div>
                </PanelCard>
              </>
            )}

            {sectionId === "customize" && (
              <PanelCard>
                <p className="text-[13px] text-slate-600">
                  Enable only the tabs this workspace uses. Required tabs stay on. Once a tab has live data, disable carefully.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Array.from(new Set([...CORE_TABS, ...DEFAULT_ENABLED_TABS])).map((slug) => {
                    const checked = enabledTabs.includes(slug);
                    const locked = CORE_TABS.includes(slug);
                    return (
                      <label
                        key={slug}
                        className={cn(
                          "flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-[13px]",
                          locked && "opacity-80",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={locked}
                          onCheckedChange={(v) => toggleTab(slug, v === true)}
                        />
                        <span className="font-medium text-slate-800">{tabLabel(slug)}</span>
                        {locked && (
                          <span className="ml-auto text-[11px] text-slate-400">Required</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </PanelCard>
            )}

            {sectionId === "currencies" && (
              <div className="space-y-4">
                <PanelCard>
                  <p className="text-[13px] font-medium text-slate-800">Base currency</p>
                  <p className="text-[12px] text-slate-500">
                    Primary currency for this workspace. Changing it does not convert historical amounts.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Code">
                      <Input
                        value={settings.baseCurrencyCode}
                        onChange={(e) =>
                          setSettings({ ...settings, baseCurrencyCode: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Name">
                      <Input
                        value={settings.baseCurrencyName}
                        onChange={(e) =>
                          setSettings({ ...settings, baseCurrencyName: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Symbol">
                      <Input
                        value={settings.baseCurrencySymbol}
                        onChange={(e) =>
                          setSettings({ ...settings, baseCurrencySymbol: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Decimal places">
                      <Input
                        type="number"
                        min={0}
                        max={8}
                        value={settings.baseCurrencyDecimals}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            baseCurrencyDecimals: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </Field>
                  </div>
                  <SaveButton onClick={() => persistSettings(settings)} />
                </PanelCard>

                <div>
                  <p className="mb-2 text-[13px] font-medium text-slate-800">Foreign currencies</p>
                  <ListEditor
                rows={currencies}
                columns={["code", "name", "symbol", "decimals"]}
                onReplace={(next) => persistRows(FX_KEY, next, setCurrencies)}
                newRow={() => ({
                      id: crypto.randomUUID(),
                      code: "",
                      name: "",
                      symbol: "",
                      decimals: "2",
                })}
              />
                </div>
              </div>
            )}

            {sectionId === "date-number" && (
              <PanelCard>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Date format">
                    <Input
                      value={settings.dateFormat}
                      onChange={(e) => setSettings({ ...settings, dateFormat: e.target.value })}
                    />
                  </Field>
                  <Field label="Time format">
                    <Input
                      value={settings.timeFormat}
                      onChange={(e) => setSettings({ ...settings, timeFormat: e.target.value })}
                    />
                  </Field>
                  <Field label="First day of week">
                    <Input
                      value={settings.firstDayOfWeek}
                      onChange={(e) =>
                        setSettings({ ...settings, firstDayOfWeek: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Number format">
                    <Input
                      value={settings.numberFormat}
                      onChange={(e) => setSettings({ ...settings, numberFormat: e.target.value })}
                    />
                  </Field>
                  <Field label="Accounting basis">
                    <div className="flex gap-2">
                      {(["accrual", "cash"] as const).map((basis) => (
                        <Button
                          key={basis}
                          type="button"
                          variant={settings.accountingBasis === basis ? "default" : "outline"}
                          className={
                            settings.accountingBasis === basis
                              ? "bg-orange-500 hover:bg-orange-600"
                              : ""
                          }
                          onClick={() => setSettings({ ...settings, accountingBasis: basis })}
                        >
                          {basis === "accrual" ? "Accrual" : "Cash"}
                        </Button>
                      ))}
                    </div>
                  </Field>
                </div>
                <SaveButton onClick={() => persistSettings(settings)} />
              </PanelCard>
            )}

            {sectionId === "accounting-periods" && (
              <PanelCard>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Fiscal year end (MM-DD)">
                    <Input
                      value={settings.fiscalYearEnd}
                      placeholder="12-31"
                      onChange={(e) =>
                        setSettings({ ...settings, fiscalYearEnd: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Inventory costing">
                    <div className="flex flex-wrap gap-2">
                      {(["average", "fifo", "lifo", "specific"] as const).map((method) => (
                        <Button
                          key={method}
                          type="button"
                          variant={settings.inventoryCosting === method ? "default" : "outline"}
                          className={
                            settings.inventoryCosting === method
                              ? "bg-orange-500 hover:bg-orange-600"
                              : ""
                          }
                          onClick={() => setSettings({ ...settings, inventoryCosting: method })}
                        >
                          {method === "average"
                            ? "Average"
                            : method === "fifo"
                              ? "FIFO"
                              : method === "lifo"
                                ? "LIFO"
                                : "Specific ID"}
                        </Button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Corporate tax rate %">
                    <Input
                      type="number"
                      value={settings.corporateTaxRate}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          corporateTaxRate: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </Field>
                  <Field label="Materiality threshold">
                    <Input
                      type="number"
                      value={settings.materialityThreshold}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          materialityThreshold: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3">
                  <div>
                    <p className="text-[13px] font-medium text-slate-800">Require approval to post</p>
                    <p className="text-[12px] text-slate-500">
                      Draft → Approve → Post. Pending/unapproved documents stay off the ledger.
                      Posted docs become immutable while this is on.
                    </p>
                  </div>
                  <Switch
                    checked={settings.requireApprovalToPost}
                    onCheckedChange={(v) =>
                      setSettings({ ...settings, requireApprovalToPost: v })
                    }
                  />
                </div>
                <div className="space-y-2 rounded-lg border border-slate-100 px-3 py-3">
                  <p className="text-[13px] font-medium text-slate-800">Year-end close</p>
                  <p className="text-[12px] text-slate-500">
                    Close income and expense into Retained earnings (3100) for the selected year end.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Fiscal year end date">
                      <Input
                        type="date"
                        id="year-end-close-date"
                        defaultValue={`${new Date().getFullYear()}-${settings.fiscalYearEnd || "12-31"}`}
                      />
                    </Field>
                    <Button
                      type="button"
                      className="bg-black hover:bg-zinc-800"
                      onClick={() => {
                        const el = document.getElementById(
                          "year-end-close-date",
                        ) as HTMLInputElement | null;
                        const date = el?.value;
                        if (!date) {
                          showWarning("Year-end close", "Choose a fiscal year end date.");
                          return;
                        }
                        void import("@/lib/ledger/year-end-close").then(({ closeFiscalYear }) => {
                          const result = closeFiscalYear(date);
                          if (!result.ok) showWarning("Year-end close", result.error);
                          else {
                            showSuccess(
                              "Year closed",
                              `Net profit (loss) ${result.netProfit} moved to Retained earnings.`,
                            );
                            persistSettings(settings);
                          }
                        });
                      }}
                    >
                      Close year
                    </Button>
                  </div>
                </div>
                <div className="space-y-2 rounded-lg border border-slate-100 px-3 py-3">
                  <p className="text-[13px] font-medium text-slate-800">Monthly depreciation</p>
                  <p className="text-[12px] text-slate-500">
                    Post straight-line depreciation for all active fixed assets (historical cost).
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Month">
                      <Input
                        type="month"
                        id="dep-month"
                        defaultValue={new Date().toISOString().slice(0, 7)}
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const el = document.getElementById("dep-month") as HTMLInputElement | null;
                        const month = el?.value;
                        if (!month) return;
                        void import("@/lib/ledger/fixed-assets").then(({ runMonthlyDepreciation }) => {
                          const result = runMonthlyDepreciation(month);
                          if (!result.ok) showWarning("Depreciation", result.error);
                          else
                            showSuccess(
                              "Depreciation posted",
                              `${result.count} assets · total ${result.total}`,
                            );
                        });
                      }}
                    >
                      Run depreciation
                    </Button>
                  </div>
                </div>
                <SaveButton onClick={() => persistSettings(settings)} />
              </PanelCard>
            )}

            {sectionId === "tax-codes" && (
              <ListEditor
                rows={taxCodes}
                columns={["name", "label", "rate", "account"]}
                onReplace={(next) => persistRows(TAX_CODES_KEY, next, setTaxCodes)}
                newRow={() => ({
                      id: crypto.randomUUID(),
                      name: "",
                      label: "",
                      rate: "0",
                      account: "VAT Account",
                })}
              />
            )}

            {sectionId === "custom-fields" && (
              <ListEditor
                rows={customFields}
                columns={["name", "type", "placement"]}
                onReplace={(next) => persistRows(CUSTOM_FIELDS_KEY, next, setCustomFields)}
                newRow={() => ({
                      id: crypto.randomUUID(),
                      name: "",
                      type: "Text",
                      placement: "Sales invoices",
                })}
              />
            )}

            {sectionId === "form-defaults" && (
              <div className="space-y-4">
                <PanelCard>
                  <p className="text-[13px] text-slate-600">
                    Prefill new forms with theme, payment terms, due days, notes, and reference
                    prefixes. Defaults apply to new records only — not clones or Copy to.
                  </p>
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        persistRows(
                          FORM_DEFAULTS_KEY,
                          [
                            ...formDefaults,
                            {
                              id: crypto.randomUUID(),
                              formType: "Sales invoices",
                              theme: "Classic",
                              paymentTerms: "Net 30",
                              dueDays: "30",
                              notes: "",
                              referencePrefix: "",
                            },
                          ],
                          setFormDefaults,
                        )
                      }
                    >
                      <Add size={14} variant="Linear" color="currentColor" /> New form default
                    </Button>
                  </div>
                </PanelCard>
                {formDefaults.length === 0 ? (
                  <PanelCard>
                    <p className="text-center text-[13px] text-slate-500">
                      No form defaults yet. Click New form default.
                    </p>
                  </PanelCard>
                ) : (
                  formDefaults.map((row) => (
                    <PanelCard key={row.id}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[14px] font-semibold text-slate-900">{row.formType}</p>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-rose-600"
                          onClick={() =>
                            persistRows(
                              FORM_DEFAULTS_KEY,
                              formDefaults.filter((r) => r.id !== row.id),
                              setFormDefaults,
                            )
                          }
                        >
                          <Trash size={14} variant="Linear" color="currentColor" />
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Form type">
                          <select
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-[13px]"
                            value={row.formType}
                            onChange={(e) =>
                              persistRows(
                                FORM_DEFAULTS_KEY,
                                formDefaults.map((r) =>
                                  r.id === row.id ? { ...r, formType: e.target.value } : r,
                                ),
                                setFormDefaults,
                              )
                            }
                          >
                            {FORM_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Theme">
                          <Input
                            value={row.theme}
                            onChange={(e) =>
                              persistRows(
                                FORM_DEFAULTS_KEY,
                                formDefaults.map((r) =>
                                  r.id === row.id ? { ...r, theme: e.target.value } : r,
                                ),
                                setFormDefaults,
                              )
                            }
                          />
                        </Field>
                        <Field label="Payment terms">
                          <Input
                            value={row.paymentTerms}
                            onChange={(e) =>
                              persistRows(
                                FORM_DEFAULTS_KEY,
                                formDefaults.map((r) =>
                                  r.id === row.id ? { ...r, paymentTerms: e.target.value } : r,
                                ),
                                setFormDefaults,
                              )
                            }
                          />
                        </Field>
                        <Field label="Due days">
                          <Input
                            type="number"
                            min={0}
                            value={row.dueDays}
                            onChange={(e) =>
                              persistRows(
                                FORM_DEFAULTS_KEY,
                                formDefaults.map((r) =>
                                  r.id === row.id ? { ...r, dueDays: e.target.value } : r,
                                ),
                                setFormDefaults,
                              )
                            }
                          />
                        </Field>
                        <Field label="Reference prefix">
                          <Input
                            value={row.referencePrefix}
                            onChange={(e) =>
                              persistRows(
                                FORM_DEFAULTS_KEY,
                                formDefaults.map((r) =>
                                  r.id === row.id
                                    ? { ...r, referencePrefix: e.target.value }
                                    : r,
                                ),
                                setFormDefaults,
                              )
                            }
                          />
                        </Field>
                      </div>
                      <Field label="Default notes">
                        <Textarea
                          rows={3}
                          value={row.notes}
                          onChange={(e) =>
                            persistRows(
                              FORM_DEFAULTS_KEY,
                              formDefaults.map((r) =>
                                r.id === row.id ? { ...r, notes: e.target.value } : r,
                              ),
                              setFormDefaults,
                            )
                          }
                        />
                      </Field>
                    </PanelCard>
                  ))
                )}
              </div>
            )}

            {sectionId === "footers" && (
              <div className="space-y-4">
                <PanelCard>
                  <p className="text-[13px] text-slate-600">
                    Static footers for terms, bank details, and signatures. Multiple footers can
                    stack on one document type. HTML is allowed.
                  </p>
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        persistRows(
                          FOOTERS_KEY,
                          [
                            ...footers,
                            {
                              id: crypto.randomUUID(),
                              name: "New footer",
                              formType: "Sales invoices",
                              content: "",
                              active: "Yes",
                            },
                          ],
                          setFooters,
                        )
                      }
                    >
                      <Add size={14} variant="Linear" color="currentColor" /> New footer
                    </Button>
                  </div>
                </PanelCard>
                {footers.length === 0 ? (
                  <PanelCard>
                    <p className="text-center text-[13px] text-slate-500">
                      No footers yet. Click New footer.
                    </p>
                  </PanelCard>
                ) : (
                  footers.map((row) => (
                    <PanelCard key={row.id}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[14px] font-semibold text-slate-900">{row.name}</p>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-rose-600"
                          onClick={() =>
                            persistRows(
                              FOOTERS_KEY,
                              footers.filter((r) => r.id !== row.id),
                              setFooters,
                            )
                          }
                        >
                          <Trash size={14} variant="Linear" color="currentColor" />
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Name">
                          <Input
                            value={row.name}
                            onChange={(e) =>
                              persistRows(
                                FOOTERS_KEY,
                                footers.map((r) =>
                                  r.id === row.id ? { ...r, name: e.target.value } : r,
                                ),
                                setFooters,
                              )
                            }
                          />
                        </Field>
                        <Field label="Form type">
                          <select
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-[13px]"
                            value={row.formType}
                            onChange={(e) =>
                              persistRows(
                                FOOTERS_KEY,
                                footers.map((r) =>
                                  r.id === row.id ? { ...r, formType: e.target.value } : r,
                                ),
                                setFooters,
                              )
                            }
                          >
                            {FORM_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Active">
                          <select
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-[13px]"
                            value={row.active}
                            onChange={(e) =>
                              persistRows(
                                FOOTERS_KEY,
                                footers.map((r) =>
                                  r.id === row.id ? { ...r, active: e.target.value } : r,
                                ),
                                setFooters,
                              )
                            }
                          >
                            <option value="Yes">Yes</option>
                            <option value="No">No</option>
                          </select>
                        </Field>
                      </div>
                      <Field label="Content">
                        <Textarea
                          rows={4}
                          value={row.content}
                          onChange={(e) =>
                            persistRows(
                              FOOTERS_KEY,
                              footers.map((r) =>
                                r.id === row.id ? { ...r, content: e.target.value } : r,
                              ),
                              setFooters,
                            )
                          }
                        />
                      </Field>
                    </PanelCard>
                  ))
                )}
              </div>
            )}

            {sectionId === "email" && (
              <PanelCard>
                <p className="text-[13px] text-slate-600">
                  Configure SMTP for document emails. Messages are sent by the Next.js API.
                  Save settings, then use Test email — or Email on a document view to send
                  with the PDF attached.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="SMTP host">
                    <Input
                      placeholder="smtp.example.com"
                      value={email.host}
                      onChange={(e) => setEmail({ ...email, host: e.target.value })}
                    />
                  </Field>
                  <Field label="Port">
                    <Input
                      value={email.port}
                      onChange={(e) => setEmail({ ...email, port: e.target.value })}
                    />
                  </Field>
                  <Field label="Username">
                    <Input
                      value={email.username}
                      onChange={(e) => setEmail({ ...email, username: e.target.value })}
                    />
                  </Field>
                  <Field label="Password">
                    <Input
                      type="password"
                      value={email.password}
                      onChange={(e) => setEmail({ ...email, password: e.target.value })}
                    />
                  </Field>
                  <Field label="From name">
                    <Input
                      value={email.fromName}
                      onChange={(e) => setEmail({ ...email, fromName: e.target.value })}
                    />
                  </Field>
                  <Field label="From email">
                    <Input
                      type="email"
                      placeholder="billing@example.com"
                      value={email.fromEmail}
                      onChange={(e) => setEmail({ ...email, fromEmail: e.target.value })}
                    />
                  </Field>
                  <Field label="Reply-to">
                    <Input
                      type="email"
                      value={email.replyTo}
                      onChange={(e) => setEmail({ ...email, replyTo: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3">
                  <div>
                    <p className="text-[13px] font-medium text-slate-800">Use TLS</p>
                    <p className="text-[12px] text-slate-500">
                      Encrypt the connection (recommended on port 587).
                    </p>
                  </div>
                  <Switch
                    checked={email.useTls}
                    onCheckedChange={(v) => setEmail({ ...email, useTls: v })}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <SaveButton
                    onClick={() => {
                      saveEmailSettings(email);
                      flashSaved();
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      void (async () => {
                        try {
                          saveEmailSettings(email);
                          const to = await sendTestEmail(email.fromEmail, email);
                          showSuccess("Test email sent", `Delivered to ${to}.`);
                        } catch (error) {
                          showWarning(
                            "Test email failed",
                            error instanceof Error ? error.message : "Could not send test email.",
                          );
                        }
                      })();
                    }}
                  >
                    Test email
                  </Button>
                </div>
              </PanelCard>
            )}

            {sectionId === "sms" && (
              <PanelCard>
                <p className="text-[13px] text-slate-600">
                  EgoSMS credentials live on the server only (
                  <code>EGO_SMS_USERNAME</code>, <code>EGO_SMS_PASSWORD</code>,{" "}
                  <code>EGO_SMS_SENDER</code>). They are never sent to or stored in the
                  browser, so they are set in the hosting environment — Vercel → Project →
                  Settings → Environment Variables — not on this page.
                </p>
                <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-[auto_1fr]">
                  <dt className="text-slate-500">Status</dt>
                  <dd className="font-medium">
                    {smsConfigLoading
                      ? "Checking…"
                      : !smsConfig
                        ? "Unknown — could not reach the server."
                        : !smsConfig.enabled
                          ? "Disabled (EGO_SMS_ENABLED=false)"
                          : smsConfig.configured
                            ? "Configured"
                            : `Incomplete — missing ${smsConfig.missing.join(", ")}`}
                  </dd>
                  {smsConfig?.sender ? (
                    <>
                      <dt className="text-slate-500">Sender ID</dt>
                      <dd className="font-medium">{smsConfig.sender}</dd>
                    </>
                  ) : null}
                  {smsConfig ? (
                    <>
                      <dt className="text-slate-500">Gateway</dt>
                      <dd className="font-medium">
                        {smsConfig.endpoint} ({smsConfig.transport} API)
                      </dd>
                    </>
                  ) : null}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={smsConfig ? !smsConfig.enabled || !smsConfig.configured : false}
                    onClick={() => {
                      void (async () => {
                        const to = window.prompt(
                          "Send a test SMS to this phone number (e.g. 07… or +256…):",
                        );
                        if (!to?.trim()) return;
                        try {
                          const { sendCommSms } = await import("@/lib/comms");
                          const result = await sendCommSms({
                            to: [to.trim()],
                            body: "IAG Finance EgoSMS test — configuration OK.",
                          });
                          if (!result.ok) {
                            showWarning("Test SMS failed", result.error || "Could not send.");
                            return;
                          }
                          showSuccess("Test SMS sent", `Delivered via ${result.via || "egosms"}.`);
                        } catch (error) {
                          showWarning(
                            "Test SMS failed",
                            error instanceof Error ? error.message : "Could not send test SMS.",
                          );
                        }
                      })();
                    }}
                  >
                    Test SMS
                  </Button>
                </div>
              </PanelCard>
            )}

            {sectionId === "request-emails" && (
              <div className="space-y-3">
                <PanelCard>
                  <p className="text-[13px] text-slate-600">
                    Add emails for CEO, GM, Finance, project managers, contractors, and
                    other people in the request approval chain. Prefer the dedicated page for
                    a clearer layout.
                  </p>
                  <Link
                    href="/request-emails"
                    className="inline-flex h-9 items-center rounded-md bg-orange-500 px-3 text-[13px] font-medium text-white hover:bg-orange-600"
                  >
                    Open Request email contacts
                  </Link>
                </PanelCard>
                <ListEditor
                  rows={requestEmailContacts}
                  columns={["role", "name", "email", "active"]}
                  onReplace={(next) => {
                    const blocked = assertPermission("edit-settings");
                    if (blocked) {
                      showWarning("Permission denied", blocked);
                      return;
                    }
                    setRequestEmailContacts(next);
                    void saveRequestEmailContacts(next);
                  }}
                  newRow={() => ({
                    id: crypto.randomUUID(),
                    role: "Other",
                    name: "",
                    email: "",
                    active: "Yes",
                  })}
                />
              </div>
            )}

            {sectionId === "divisions" && (
              <div className="space-y-3">
                <p className="text-[13px] text-slate-600">
                  Classes for different business lines (like QuickBooks Class). Pick a class on
                  invoices, receipts, payments, journals, and line items so reports can split Coffee,
                  Cosmetics, Restaurant, and more.
                </p>
                <ListEditor
                  rows={divisions}
                  columns={["name"]}
                  onReplace={(next) => persistRows(DIVISIONS_KEY, next, setDivisions)}
                  newRow={() => ({
                    id: crypto.randomUUID(),
                    name: "",
                  })}
                />
              </div>
            )}

            {sectionId === "supplier-categories" && (
              <div className="space-y-3">
                <p className="text-[13px] text-slate-600">
                  Categories shown on Purchases → Suppliers. You can also type a new category directly
                  on the supplier form — it is saved here automatically.
                </p>
                <ListEditor
                  rows={supplierCategories}
                  columns={["name"]}
                  onReplace={(next) =>
                    persistRows(SUPPLIER_CATEGORIES_KEY, next, setSupplierCategories)
                  }
                  newRow={() => ({
                    id: crypto.randomUUID(),
                    name: "",
                  })}
                />
              </div>
            )}

            {sectionId === "chart-of-accounts" && (
              <PanelCard>
                <p className="text-[13px] text-slate-600">
                  Build groups, ordinary accounts, totals, and control accounts under Accounts.
                  Enable Customers/Suppliers for AR/AP — do not create those control accounts
                  manually.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href="/accounts?view=chart-of-accounts"
                    className="inline-flex h-9 items-center justify-center rounded-md bg-black px-4 text-[13px] font-medium text-white hover:bg-zinc-800"
                  >
                    Open Chart of Accounts
                  </Link>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-rose-200 text-rose-700 hover:bg-rose-50"
                    onClick={() => {
                      askConfirm({
                        title: "Reset books to zero?",
                        message:
                          "Delete all invoices, journals, receipts, payments, and ledger postings from this browser and the database? Masters and Chart of Accounts are kept. Both Balance Sheet and Trial Balance should show clean books after reload.",
                        confirmLabel: "Reset books",
                        danger: true,
                        onConfirm: () => {
                          void (async () => {
                            try {
                              const result = await cleanTransactionsSystem({
                                clearHistory: true,
                              });
                              resetBooksNow();
                              showSuccess(
                                "Books cleared",
                                result.remotePurged
                                  ? "Browser and database purged. Open Balance Sheet or Trial Balance — both should show 0 and balanced."
                                  : "Local books cleared (database unreachable). Open Balance Sheet or Trial Balance to verify.",
                              );
                              window.setTimeout(() => window.location.reload(), 800);
                            } catch (error) {
                              showWarning(
                                "Reset failed",
                                error instanceof Error
                                  ? error.message
                                  : "Could not reset books.",
                              );
                            }
                          })();
                        },
                      });
                    }}
                  >
                    Reset books to zero
                  </Button>
                </div>
              </PanelCard>
            )}

            {sectionId === "users" && (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-slate-900">Users, roles & permissions</p>
                      <p className="mt-1 text-[13px] text-slate-600">
                        {OWNS_IDENTITY_DIRECTORY
                          ? "Create users, create custom roles, and set View / Create / Edit / Delete for every page."
                          : "This app reads the shared directory from IAG Admin. Create users and roles there."}{" "}
                        Sample roles:{" "}
                        <span className="font-medium text-slate-800">
                          Administrator, Project Manager, Contractor, Clerk, Viewer
                        </span>
                        — plus any custom roles added in Admin.
                      </p>
                      <ul className="mt-2 list-inside list-disc space-y-0.5 text-[12px] text-slate-500">
                        <li>
                          <span className="font-medium text-slate-700">Users</span> — add logins and
                          assign a role
                        </li>
                        <li>
                          <span className="font-medium text-slate-700">Roles</span> — workspace CRUD
                          defaults
                        </li>
                        <li>
                          <span className="font-medium text-slate-700">Permissions</span> — per-page
                          matrix for each role
                        </li>
                      </ul>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      {OWNS_IDENTITY_DIRECTORY ? (
                        <>
                          <Button
                            type="button"
                            className="bg-orange-500 text-white hover:bg-orange-600"
                            onClick={() => router.push("/users?tab=users&new=user")}
                          >
                            Create user
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => router.push("/users?tab=roles&new=role")}
                          >
                            Create role
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => router.push("/users?tab=permissions")}
                          >
                            Edit permissions
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            type="button"
                            className="bg-orange-500 text-white hover:bg-orange-600"
                            onClick={() => window.open(identityUsersHref(), "_blank", "noopener,noreferrer")}
                          >
                            Manage in IAG Admin
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => router.push("/users")}
                          >
                            View directory
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <PanelCard>
                  <div>
                    <h2 className="text-[14px] font-semibold text-slate-900">Workspace users</h2>
                    <p className="mt-0.5 text-[12px] text-slate-500">
                      Name, username, email, role, and CRUD flags. Use Users &amp; roles for
                      passwords and per-page permissions.
                    </p>
                  </div>
                  <ListEditor
                    rows={users}
                    readOnly={!OWNS_IDENTITY_DIRECTORY}
                    columns={[
                      "name",
                      "username",
                      "email",
                      "role",
                      "canView",
                      "canCreate",
                      "canEdit",
                      "canDelete",
                    ]}
                    onReplace={(next) => persistRows(USERS_KEY, next, setUsers)}
                    newRow={() => ({
                      id: crypto.randomUUID(),
                      name: "",
                      username: "",
                      email: "",
                      role: "Viewer",
                      canView: "Yes",
                      canCreate: "No",
                      canEdit: "No",
                      canDelete: "No",
                    })}
                  />
                </PanelCard>
              </div>
            )}

            {sectionId === "exchange-rates" && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div>
                    <p className="text-[13px] font-medium text-slate-800">Daily market rates</p>
                    <p className="mt-0.5 text-[12px] text-slate-500">
                      Fetches live rates as units of{" "}
                      {settings.baseCurrencyCode || "UGX"} per 1 foreign unit (e.g. UGX per USD).
                      Auto-updates once per day when you open the app.
                    </p>
                  </div>
                  <Button
                    type="button"
                    disabled={fxFetching}
                    onClick={async () => {
                      setFxFetching(true);
                      try {
                        const result = await fetchAndApplyDailyExchangeRates();
                        if (!result.ok) {
                          showWarning("Could not fetch rates", result.error || "Try again later.");
                          return;
                        }
                        setExchangeRates(loadList(EXCHANGE_RATES_KEY, defaultExchangeRates));
                        showSuccess(
                          "Exchange rates updated",
                          `${result.updated} rate(s) for ${result.date}${
                            result.provider ? ` · ${result.provider}` : ""
                          }`,
                        );
                      } finally {
                        setFxFetching(false);
                      }
                    }}
                  >
                    {fxFetching ? "Fetching…" : "Fetch today’s rates"}
                  </Button>
                </div>
                <ListEditor
                  rows={exchangeRates}
                  columns={["currency", "date", "rate"]}
                  onReplace={(next) => persistRows(EXCHANGE_RATES_KEY, next, setExchangeRates)}
                  newRow={() => ({
                    id: crypto.randomUUID(),
                    currency: "USD",
                    date: new Date().toISOString().slice(0, 10),
                    rate: "",
                  })}
                />
              </div>
            )}

            {sectionId === "themes" && (
              <div className="space-y-4">
                <PanelCard>
                  <p className="text-[13px] text-slate-600">
                    Form themes control how invoices and other documents look when printed. For the
                    app light/dark mode, use{" "}
                    <Link href="/settings?section=appearance" className="font-medium text-orange-600 hover:text-orange-700">
                      Appearance
                    </Link>
                    .
                  </p>
                </PanelCard>
                <ListEditor
                  rows={themes}
                  columns={["name", "formType", "primaryColor", "font", "layout"]}
                  onReplace={(next) => persistRows(THEMES_KEY, next, setThemes)}
                  newRow={() => ({
                        id: crypto.randomUUID(),
                        name: "New theme",
                        formType: "Sales invoices",
                        primaryColor: "#111111",
                        font: "Helvetica",
                        layout: "Standard",
                  })}
                />
              </div>
            )}

            {sectionId === "email-templates" && (
              <ListEditor
                rows={emailTemplates}
                columns={["name", "formType", "subject", "body"]}
                onReplace={(next) => persistRows(EMAIL_TEMPLATES_KEY, next, setEmailTemplates)}
                newRow={() => ({
                      id: crypto.randomUUID(),
                      name: "New template",
                      formType: "Sales invoices",
                      subject: "",
                      body: "",
                })}
              />
            )}

            {sectionId === "control-accounts" && (
              <ListEditor
                rows={controlAccounts}
                columns={["name", "code", "category", "group"]}
                accountColumns={["name"]}
                onReplace={(next) => persistRows(CONTROL_ACCOUNTS_KEY, next, setControlAccounts)}
                newRow={() => ({
                      id: crypto.randomUUID(),
                      name: "",
                      code: "",
                      category: "Customers",
                      group: "Assets",
                })}
              />
            )}

            {sectionId === "payslip-items" && (
              <ListEditor
                rows={payslipItems}
                columns={["name", "kind", "expenseAccount", "liabilityAccount", "defaultRate"]}
                onReplace={(next) => persistRows(PAYSLIP_ITEMS_KEY, next, setPayslipItems)}
                newRow={() => ({
                      id: crypto.randomUUID(),
                      name: "",
                      kind: "Earnings",
                      expenseAccount: "",
                      liabilityAccount: "",
                      defaultRate: "",
                })}
              />
            )}

            {sectionId === "claim-payers" && (
              <ListEditor
                rows={claimPayers}
                columns={["name", "payerType", "openingBalance"]}
                onReplace={(next) => persistRows(CLAIM_PAYERS_KEY, next, setClaimPayers)}
                newRow={() => ({
                      id: crypto.randomUUID(),
                      name: "",
                      payerType: "Expense Claim Payer",
                      openingBalance: "0",
                })}
              />
            )}

            {sectionId === "receipt-rules" && (
              <ListEditor
                rows={receiptRules}
                columns={["name", "bankAccount", "descriptionContains", "party", "postingAccount", "taxCode"]}
                bankColumns={["bankAccount"]}
                onReplace={(next) => persistRows(RECEIPT_RULES_KEY, next, setReceiptRules)}
                newRow={() => ({
                      id: crypto.randomUUID(),
                      name: "",
                      bankAccount: "",
                      descriptionContains: "",
                      party: "",
                      postingAccount: "",
                      taxCode: "",
                })}
              />
            )}

            {sectionId === "payment-rules" && (
              <ListEditor
                rows={paymentRules}
                columns={["name", "bankAccount", "descriptionContains", "party", "postingAccount", "taxCode"]}
                bankColumns={["bankAccount"]}
                onReplace={(next) => persistRows(PAYMENT_RULES_KEY, next, setPaymentRules)}
                newRow={() => ({
                      id: crypto.randomUUID(),
                      name: "",
                      bankAccount: "",
                      descriptionContains: "",
                      party: "",
                      postingAccount: "",
                      taxCode: "",
                })}
              />
            )}

            {sectionId === "recurring" && (
              <ListEditor
                rows={recurring}
                columns={["name", "kind", "party", "interval", "nextIssueDate", "amount"]}
                onReplace={(next) => persistRows(RECURRING_TEMPLATES_KEY, next, setRecurring)}
                newRow={() => ({
                      id: crypto.randomUUID(),
                      name: "",
                      kind: "Sales invoices",
                      party: "",
                      interval: "Monthly",
                      nextIssueDate: new Date().toISOString().slice(0, 10),
                      amount: "",
                })}
              />
            )}

            {sectionId === "customer-portals" && (
              <ListEditor
                rows={customerPortals}
                columns={["customer", "quotes", "orders", "invoices", "creditNotes"]}
                onReplace={(next) => persistRows(CUSTOMER_PORTALS_KEY, next, setCustomerPortals)}
                newRow={() => ({
                      id: crypto.randomUUID(),
                      customer: "",
                      quotes: "Yes",
                      orders: "Yes",
                      invoices: "Yes",
                      creditNotes: "No",
                })}
              />
            )}

            {sectionId === "lock-date" && (
              <PanelCard>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3">
                  <div>
                    <p className="text-[13px] font-medium text-slate-800">Allow backdating</p>
                    <p className="text-[12px] text-slate-500">
                      Enter and post historical dates from older user data. While on, lock date and
                      closed periods do not block past dates. Turn off after the data load is done.
                    </p>
                  </div>
                  <Switch
                    checked={settings.allowBackdating !== false}
                    onCheckedChange={(v) => setSettings({ ...settings, allowBackdating: v })}
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3">
                  <div>
                    <p className="text-[13px] font-medium text-slate-800">Lock accounting periods</p>
                    <p className="text-[12px] text-slate-500">
                      Prevent edits on or before the lock date after period close. Ignored while
                      Allow backdating is on.
                    </p>
                  </div>
                  <Switch
                    checked={settings.lockEnabled}
                    onCheckedChange={(v) => setSettings({ ...settings, lockEnabled: v })}
                  />
                </div>
                <Field label="Lock date">
                  <Input
                    type="date"
                    value={settings.lockDate ?? ""}
                    disabled={!settings.lockEnabled}
                    onChange={(e) =>
                      setSettings({ ...settings, lockDate: e.target.value || null })
                    }
                  />
                </Field>
                <SaveButton onClick={() => persistSettings(settings)} />
              </PanelCard>
            )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<ModulePageSkeleton />}>
      <SettingsPageContent />
    </Suspense>
  );
}

function PanelCard({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4 rounded-md border border-slate-200 bg-white p-4 sm:p-5">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] text-slate-600">{label}</Label>
      {children}
    </div>
  );
}

function SaveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button className="bg-orange-500 text-white hover:bg-orange-600" onClick={onClick}>
      Update
    </Button>
  );
}

function ListEditor<T extends { id: string } & Record<string, string>>({
  rows,
  columns,
  onReplace,
  newRow,
  accountColumns,
  bankColumns,
  readOnly = false,
}: {
  rows: T[];
  columns: string[];
  onReplace: (next: T[]) => void;
  newRow: () => T;
  /** Extra columns that should pick from Chart of Accounts (e.g. control account name). */
  accountColumns?: string[];
  /** Columns that should pick from Bank & Cash Accounts. */
  bankColumns?: string[];
  readOnly?: boolean;
}) {
  const { feedback, close, askConfirm, showSuccess } = useFeedbackModals();
  const { pushUndo, undo, canUndo, nextLabel } = useUndoStack();
  const { page, setPage, pages, pageItems, pageSize, setPageSize, total, from, to } =
    usePagination(rows);
  const coaExtra = new Set(accountColumns || []);
  const bankExtra = new Set(bankColumns || []);

  useEffect(() => {
    setPage(1);
  }, [rows.length, setPage]);

  function applyWithUndo(label: string, next: T[], successTitle: string, successMessage: string) {
    const previous = rows.map((row) => ({ ...row }));
    pushUndo({
      label,
      undo: () => {
        onReplace(previous);
        showSuccess("Undone", `${label} was reversed.`);
      },
    });
    onReplace(next);
    showSuccess(successTitle, successMessage, {
      undoLabel: "Undo",
      onUndo: () => {
        onReplace(previous);
        showSuccess("Undone", `${label} was reversed.`);
      },
    });
  }

  function confirmChange(id: string, key: string, value: string, previousValue: string) {
    if (value === previousValue) return;
    askConfirm({
      title: "Confirm change?",
      message: `Update “${key}” from “${previousValue || "(empty)"}” to “${value || "(empty)"}”?`,
      confirmLabel: "Apply change",
      danger: false,
      onConfirm: () => {
        applyWithUndo(
          `Edit ${key}`,
          rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
          "Change saved",
          `Updated ${key}.`,
        );
      },
    });
  }

  function isBankColumn(column: string) {
    if (bankExtra.has(column)) return true;
    const filter = coaPickerFilterForField(column, column.replace(/([A-Z])/g, " $1").trim());
    return Boolean(filter?.fromBankList);
  }

  function isAccountColumn(column: string) {
    if (coaExtra.has(column)) return true;
    if (bankExtra.has(column) || isBankColumn(column)) return false;
    return isCoaPickerField(column, column.replace(/([A-Z])/g, " $1").trim());
  }

  return (
    <PanelCard>
      <FeedbackModals feedback={feedback} onClose={close} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canUndo && !readOnly && (
          <Button variant="outline" size="sm" onClick={undo} title={nextLabel}>
            Undo
          </Button>
        )}
        {!readOnly ? (
        <Button
          size="sm"
          className="bg-orange-500 text-white hover:bg-orange-600"
          onClick={() =>
            askConfirm({
              title: "Add row?",
              message: "Add a new blank settings row? You can edit its fields afterward.",
              confirmLabel: "Add row",
              danger: false,
              onConfirm: () =>
                applyWithUndo("Add row", [...rows, newRow()], "Row added", "A new settings row was created."),
            })
          }
        >
          <Add size={14} variant="Linear" color="currentColor" /> Add
        </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-100">
        <table className="w-full min-w-[520px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] tracking-wide text-slate-500 uppercase">
              {columns.map((c) => (
                <th key={c} className="px-3 py-2 font-medium capitalize">
                  {c.replace(/([A-Z])/g, " $1").trim()}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-10 text-center text-slate-500">
                  {readOnly ? "No rows yet." : "No rows yet. Click Add."}
                </td>
              </tr>
            ) : (
              pageItems.map((row) => (
                <tr key={row.id} className="border-b border-slate-50 last:border-0">
                  {columns.map((c) => {
                    const current = row[c] ?? "";
                    if (isBankColumn(c)) {
                      return (
                        <td key={c} className="px-2 py-1.5 min-w-[180px]">
                          <BankAccountSelect
                            value={current}
                            emptyLabel="Select bank"
                            className="min-w-[160px]"
                            onChange={(next) => confirmChange(row.id, c, next, current)}
                          />
                        </td>
                      );
                    }
                    if (isAccountColumn(c)) {
                      const filter = coaPickerFilterForField(
                        c,
                        c.replace(/([A-Z])/g, " $1").trim(),
                      );
                      return (
                        <td key={c} className="px-2 py-1.5 min-w-[200px]">
                          <ChartOfAccountsSelect
                            value={current}
                            compact
                            types={filter?.types}
                            bankLike={Boolean(filter?.bankLike)}
                            emptyLabel="Select account"
                            className="min-w-[180px]"
                            onChange={(next) => confirmChange(row.id, c, next, current)}
                          />
                        </td>
                      );
                    }
                    return (
                      <td key={c} className="px-2 py-1.5">
                        <Input
                          className="h-8 border-slate-200 text-[13px] shadow-none"
                          defaultValue={current}
                          key={`${row.id}-${c}-${current}`}
                          disabled={readOnly}
                          onBlur={(e) => {
                            if (readOnly) return;
                            confirmChange(row.id, c, e.target.value, current);
                          }}
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 text-right">
                    {readOnly ? null : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-rose-600"
                      onClick={() =>
                        askConfirm({
                          title: "Delete row?",
                          message: "This removes the row from your settings. You can undo afterward.",
                          confirmLabel: "Delete",
                          danger: true,
                          onConfirm: () =>
                            applyWithUndo(
                              "Delete row",
                              rows.filter((r) => r.id !== row.id),
                              "Row deleted",
                              "Settings row removed.",
                            ),
                        })
                      }
                    >
                      <Trash size={14} variant="Linear" color="currentColor" />
                    </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <PaginationBar
        page={page}
        pages={pages}
        total={total}
        from={from}
        to={to}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </PanelCard>
  );
}

