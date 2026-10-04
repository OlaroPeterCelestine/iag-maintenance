/**
 * Live CRUD test of the Maintenance app, in a browser, against production.
 *
 * Signs in to the deployed app, drives every maintenance form a technician
 * uses — machines, work orders (Start), job cards (Completed → /complete),
 * PM templates and schedules, downtime (ongoing + End, and already over),
 * spare parts, energy — and checks what iag-mes and the warehouse hold
 * afterwards rather than only what the table shows.
 *
 *   npx tsx scripts/test-maintenance-crud-live.mts [baseUrl]
 *
 * Real writes, under a ZZQA<stamp> prefix so they sort last and read as test
 * data. MES deletes nothing, so the machine, work order, PM template and
 * schedule, downtime and a 0.001 kWh energy reading stay; the spare part is set
 * Obsolete and the machine Retired (Idle where Retired is refused).
 * QA_USER / QA_PASSWORD default to the seeded superadmin; QA_HEADED=1 to watch.
 */
import { chromium, type Page, type Locator } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = (process.argv[2] || "https://iag-maintenance.vercel.app").replace(/\/$/, "");
const GW = (process.env.IAG_GATEWAY_ORIGIN || "https://iag-api-gateway-production.up.railway.app").replace(/\/$/, "");
const USER = process.env.QA_USER || "admin@iag.local";
const PASS = process.env.QA_PASSWORD || "ChangeMe";
const STAMP = "ZZQA" + Date.now().toString(36).toUpperCase().slice(-5);
const OUT = process.env.QA_OUT || `${process.cwd()}/scripts/out/maintenance-crud/`;
mkdirSync(OUT, { recursive: true });

type Result = { name: string; ok: boolean; detail?: string; ms: number };
/** Every non-GET /api/records response the browser received, in order. */
const recordWrites: Array<{ status: number; method: string; url: string; body: string }> = [];
const results: Result[] = [];
const apiErrors: string[] = [];
const pageErrors: string[] = [];
let shot = 0;

async function snap(page: Page, label: string) {
  shot += 1;
  const file = `${OUT}${String(shot).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);
  return file;
}

async function step(page: Page, name: string, fn: () => Promise<string | void>) {
  const t0 = Date.now();
  try {
    const detail = (await fn()) || "";
    results.push({ name, ok: true, detail, ms: Date.now() - t0 });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    const file = await snap(page, `FAIL-${name}`);
    results.push({ name, ok: false, detail: `${detail} [${file.split("/").pop()}]`, ms: Date.now() - t0 });
    console.log(`  FAIL ${name} — ${detail}`);
  }
}

/* ───────────────────────── platform reads ───────────────────────── */

let platformToken = "";
/** The login endpoint rate-limits after a few grants (429 for ~30 s); wait it out. */
async function platformLogin(): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${GW}/api/v1/authentication/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "password", username: USER, password: PASS, client_id: "iag-platform" }),
    });
    const tok = (await res.json().catch(() => ({}))) as { access_token?: string };
    if (tok.access_token) return tok.access_token;
    await new Promise((r) => setTimeout(r, 8_000));
  }
  throw new Error("could not obtain a platform token");
}

async function gw(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  if (!platformToken) platformToken = await platformLogin();
  let res = await fetch(`${GW}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${platformToken}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (res.status === 401) {
    platformToken = await platformLogin();
    res = await fetch(`${GW}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${platformToken}`, "Content-Type": "application/json", ...(init.headers || {}) },
    });
  }
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** What the app's own server answers for a collection — the same thing the table renders. */
async function appList(page: Page, module: string, view: string): Promise<Record<string, string>[]> {
  const res = await page.request.get(`${BASE}/api/records/${module}/${view}`);
  const body = (await res.json()) as { data?: Record<string, string>[] };
  return body.data || [];
}

/* ───────────────────────── form helpers ───────────────────────── */

const dialog = (page: Page) =>
  page.locator('[role="dialog"]').filter({ has: page.locator("form") }).last();

async function dismissToasts(page: Page) {
  // Exact names only: a loose /ok/ matched the "Nyabihoko Stores" row link
  // and navigated into its detail page mid-step.
  const close = page
    .locator('[role="alertdialog"], [role="dialog"]:not(:has(form))')
    .getByRole("button", { name: /^(close|dismiss|got it|ok|okay)$/i });
  for (let i = 0; i < 3 && (await close.count()); i++) {
    await close.first().click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(200);
  }
}

const VIEW: Record<string, { module: string; label: string; singular: RegExp }> = {
  "work-centers": { module: "production", label: "Machines", singular: /^New Machine/i },
  "work-orders": { module: "production", label: "Work Orders", singular: /^New Work Order/i },
  "batch-records": { module: "production", label: "Job Cards", singular: /^New Job Card/i },
  "pm-templates": { module: "production", label: "PM Templates", singular: /^New PM Template/i },
  "pm-schedules": { module: "production", label: "Preventive Schedules", singular: /^New Preventive Schedule/i },
  "spare-parts": { module: "production", label: "Spare Parts", singular: /^New Spare Part/i },
  "downtime-logs": { module: "production", label: "Downtime", singular: /^New Downtime/i },
  energy: { module: "production", label: "Energy", singular: /^New Energy/i },
  reliability: { module: "production", label: "Reliability", singular: /^New Reliability/i },
  alerts: { module: "production", label: "Alerts", singular: /^New Alert/i },
  recommendations: { module: "production", label: "Recommendations", singular: /^New Recommendation/i },
  "machine-performance": { module: "production", label: "Machine Performance", singular: /^New Machine Performance/i },
};

/** The list the harness is on; submit() waits for a write to this entity. */
let currentView = "";

async function gotoList(page: Page, view: string) {
  const meta = VIEW[view];
  currentView = view;
  const tab = "production";
  const arrived = page
    .waitForResponse((r) => r.url().includes(`/api/records/${meta.module}/${view}`) && r.request().method() === "GET", { timeout: 60_000 })
    .catch(() => null);
  await page.goto(`${BASE}/${tab}?view=${view}`, { waitUntil: "domcontentloaded" });
  await page.locator("main h1, h1").first().waitFor({ state: "visible", timeout: 45_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  // Coming from a detail page the app can drop the ?view and land on the
  // desk; the sidebar is how a person gets there anyway.
  const heading = page.locator("main h1, h1").filter({ hasText: meta.label }).first();
  if (!(await heading.isVisible().catch(() => false))) {
    await page
      .locator("nav a, aside a")
      .filter({ hasText: new RegExp(`^\\s*${meta.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) })
      .first()
      .click()
      .catch(() => undefined);
    await heading.waitFor({ state: "visible", timeout: 45_000 }).catch(() => undefined);
  }
  await arrived;
  // The table paints from tab memory once the entity has settled; give the
  // first paint after a navigation a moment rather than judging the skeleton.
  await page.locator("table tbody tr").first().waitFor({ state: "visible", timeout: 12_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  await dismissToasts(page);
}

async function openNew(page: Page, view: string) {
  await gotoList(page, view);
  const btn = page.getByRole("button", { name: VIEW[view].singular }).first();
  await btn.waitFor({ state: "visible", timeout: 30_000 });
  for (let attempt = 0; attempt < 5; attempt++) {
    await btn.click();
    try {
      await dialog(page).waitFor({ state: "visible", timeout: 6_000 });
      // While the app is still booting (settings, sync) the page re-renders
      // and drops an open dialog within a second or two. Only a form that is
      // still open after that is worth filling in.
      await page.waitForTimeout(2_500);
      if (await dialog(page).isVisible().catch(() => false)) return;
    } catch {
      /* not open yet */
    }
    await page.waitForTimeout(1500);
  }
  throw new Error(`the New dialog for ${view} did not open`);
}

function fieldBox(page: Page, key: string): Locator {
  return dialog(page).locator(`label[for="${key}"]`).first().locator("xpath=..");
}

async function fillText(page: Page, key: string, value: string) {
  const d = dialog(page);
  const input = d.locator(`input[name="${key}"]:not([type="hidden"]), textarea[name="${key}"], #${key}`).first();
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await input.fill(value);
}

async function selectNative(page: Page, key: string, text: string) {
  const native = dialog(page).locator(`select[name="${key}"]`).first();
  await native.waitFor({ state: "visible", timeout: 10_000 });
  await native.selectOption({ label: text }).catch(() => native.selectOption(text));
}

/**
 * pickOnce with retries. A picker's list hydrates while the form is open, and
 * the re-render can close the popover between typing and reading its rows;
 * close, reopen and type again rather than call that a missing option.
 */
async function pick(page: Page, key: string, text: string, opts: { custom?: boolean } = {}) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await pickOnce(page, key, text, opts);
    } catch (err) {
      last = err;
      if (process.env.QA_DEBUG) console.log(`    [pick ${key} attempt ${attempt + 1}]`, String(err).split("\n")[0].slice(0, 200));
      // Not Escape: with the popover already gone it would close the form.
      if (await page.locator('[data-slot="popover-content"]').count()) {
        await dialog(page).locator("h2, [data-slot='dialog-title']").first().click({ force: true }).catch(() => undefined);
      }
      await page.waitForTimeout(1500);
    }
  }
  throw last;
}

/** Choose from a SearchablePicker under a label; falls back to its "Add …" row when asked. */
async function pickOnce(page: Page, key: string, text: string, opts: { custom?: boolean } = {}) {
  const d = dialog(page);
  const native = d.locator(`select[name="${key}"]`);
  if (await native.count()) {
    await selectNative(page, key, text);
    return;
  }
  const plain = d.locator(`input[name="${key}"]:not([type="hidden"])`);
  if (await plain.count()) {
    await plain.fill(text);
    return;
  }
  const box = fieldBox(page, key);
  const trigger = box.locator('[data-slot="popover-trigger"]:visible, button[type="button"]:visible').first();
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  await trigger.click();
  const pop = page.locator('[data-slot="popover-content"]').last();
  await pop.waitFor({ state: "visible", timeout: 10_000 });
  const search = pop.locator("input").first();
  if (await search.count()) {
    await search.fill(text);
    await page.waitForTimeout(700);
  }
  let buttons = pop.locator("button");
  // Picker sources hydrate when the form opens; a list that is still empty a
  // moment later is a race, not an answer.
  for (let attempt = 0; attempt < 4 && (await buttons.count()) <= 1; attempt++) {
    await page.waitForTimeout(1500);
    if (await search.count()) await search.fill(text);
    await page.waitForTimeout(500);
    buttons = pop.locator("button");
  }
  const n = await buttons.count();
  if (process.env.QA_DEBUG) console.log("    [pick]", key, "options:", n, JSON.stringify(await buttons.allTextContents()).slice(0, 300), "| popovers:", await page.locator('[data-slot="popover-content"]').count());
  let addRow: Locator | null = null;
  const labels: string[] = [];
  for (let k = 0; k < n; k++) {
    labels.push(((await buttons.nth(k).textContent()) || "").trim());
  }
  // Exact first ("QAED28S — QAED28S Store" over "QAED28SB — …"), then loose.
  const wanted = text.toLowerCase();
  const startsExact = (label: string) => {
    const head = label.toLowerCase().split(/\s+[—-]\s+/)[0].trim();
    return head === wanted || label.toLowerCase() === wanted;
  };
  for (const pass of [startsExact, (label: string) => label.toLowerCase().includes(wanted)]) {
    for (let k = 0; k < n; k++) {
      const label = labels[k];
      if (!label) continue;
      if (/^(add|create|use|new)\b/i.test(label)) {
        addRow = addRow || buttons.nth(k);
        continue;
      }
      if (pass(label)) {
        await buttons.nth(k).click();
        return;
      }
    }
  }
  if (opts.custom) {
    // Prefer the row that quotes the typed text ("Add supplier “X”", "Use
    // machine “X”") over a generic "Add new …" that opens another modal.
    for (let k = 0; k < n; k++) {
      const label = labels[k];
      if (/^(add|create|use|new)\b/i.test(label) && label.includes(text)) {
        await buttons.nth(k).click();
        return;
      }
    }
    if (addRow) {
      await addRow.click();
      return;
    }
  }
  throw new Error(`no option "${text}" for ${key}`);
}

/** Choose the first real option of a picker (a chart-of-accounts picker, say). */
async function pickFirst(page: Page, key: string): Promise<string> {
  const box = fieldBox(page, key);
  const trigger = box.locator('[data-slot="popover-trigger"]:visible, button[type="button"]:visible').first();
  await trigger.waitFor({ state: "visible", timeout: 10_000 });
  await trigger.click();
  const pop = page.locator('[data-slot="popover-content"]').last();
  await pop.waitFor({ state: "visible", timeout: 10_000 });
  const buttons = pop.locator("button");
  const n = await buttons.count();
  for (let k = 0; k < n; k++) {
    const label = ((await buttons.nth(k).textContent()) || "").trim();
    if (!label || /^(add|create|use|new)\b/i.test(label)) continue;
    await buttons.nth(k).click();
    return label;
  }
  throw new Error(`picker ${key} offers no options`);
}

async function selectOptions(page: Page, key: string): Promise<string[]> {
  const select = dialog(page).locator(`select[name="${key}"]`).first();
  await select.waitFor({ state: "visible", timeout: 10_000 });
  return select.locator("option").allTextContents();
}

/** Submit the open form; returns the first error text shown, or "". */
async function submit(page: Page): Promise<string> {
  const d = dialog(page);
  // Captured before the click: a fast write lands during the confirm wait.
  const before = recordWrites.length;
  await d.getByRole("button", { name: /create record|save changes|^add site$|^submit$/i }).first().click();
  // A confirm dialog may follow. Exact names only: /^save/ used to match the
  // form's own "Save as draft" while the create was still in flight, which
  // filed the record as a draft and never posted it.
  const confirm = page
    .locator('[role="alertdialog"], [role="dialog"]:not(:has(form))')
    .getByRole("button", { name: /^(confirm|create|save|yes)$/i })
    .last();
  try {
    await confirm.waitFor({ state: "visible", timeout: 2_000 });
    await confirm.click();
  } catch {
    /* no confirm step */
  }
  // Wait for the form to close, then for the write it should have sent. A
  // form that closes without a request is the failure the table cannot show:
  // the record sits in tab memory and looks saved until the next reload.
  // The document's own write queues behind the client stock engine's
  // whole-collection PUTs (items, replenishment), which can take several
  // seconds each — so wait for a write to *this* entity, generously.
  const mine = () => recordWrites.slice(before).filter((w) => w.url.includes(`/api/records/${VIEW[currentView]?.module}/${currentView}`));
  await d.waitFor({ state: "hidden", timeout: 20_000 }).catch(() => undefined);
  for (let i = 0; i < 90 && !mine().length; i++) await page.waitForTimeout(500);
  await page.waitForTimeout(800);
  if (!(await d.isVisible().catch(() => false)) && !mine().length) {
    return "form closed without sending a write (record kept in tab memory only)";
  }
  const last = mine()[mine().length - 1];
  if (last && last.status >= 400) {
    await page.waitForTimeout(500);
    return `${last.method} ${last.url} → ${last.status} ${last.body}`;
  }
  // A validation refusal is an alertdialog over the still-open form.
  const alert = page
    .locator('[role="alertdialog"]')
    .filter({ hasText: /^Required field|Inventory rule|before saving/i })
    .first();
  if (await alert.isVisible().catch(() => false)) {
    const text = ((await alert.textContent()) || "").replace(/\s+/g, " ").trim();
    await dismissToasts(page);
    return text;
  }
  // Either the dialog closed (saved) or an error banner is showing.
  if (await d.isVisible().catch(() => false)) {
    const banner = d.locator('[role="alert"], .text-rose-600, .bg-rose-50, .text-red-600').first();
    const text = (await banner.textContent().catch(() => "")) || "";
    return text.trim() || "dialog still open with no visible error";
  }
  const warn = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: /could not|refused|failed/i }).first();
  if (await warn.isVisible().catch(() => false)) {
    const text = ((await warn.textContent()) || "").trim();
    await dismissToasts(page);
    // "Saved, but ledger posting failed" is the app's own follow-up (a GL
    // journal on the legacy API) — the record itself was written.
    if (/^saved, but/i.test(text)) {
      console.log(`    note ${text.slice(0, 120)}`);
      return "";
    }
    return text;
  }
  return "";
}

async function rowFor(page: Page, view: string, text: string): Promise<Locator> {
  await gotoList(page, view);
  const search = page.locator('input[placeholder^="Search "]:not([placeholder="Search anything"])').first();
  if (await search.count()) {
    await search.fill(text);
    await page.waitForTimeout(900);
  }
  // A cell that is exactly the text: row text runs cells together with no
  // separator, so "QAED28S" would otherwise match the "QAED28SB" row too.
  const exact = new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
  const row = page
    .locator("table tbody tr")
    .filter({ has: page.locator("td", { hasText: exact }) })
    .first();
  try {
    await row.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    if (await search.count()) {
      await search.fill("");
      await page.waitForTimeout(900);
    }
    await row.waitFor({ state: "visible", timeout: 15_000 });
  }
  return row;
}

async function rowText(page: Page, view: string, text: string): Promise<string> {
  const row = await rowFor(page, view, text);
  return ((await row.textContent()) || "").replace(/\s+/g, " ").trim();
}

async function rowMenu(page: Page, view: string, text: string) {
  const row = await rowFor(page, view, text);
  // A click can land while the table re-renders and the menu toggles shut;
  // only a menu whose items are visible counts as open.
  for (let attempt = 0; attempt < 4; attempt++) {
    await row.getByRole("button", { name: /row actions/i }).first().click();
    await page.waitForTimeout(500);
    if (await page.locator('[role="menuitem"]:visible').count()) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(800);
  }
  throw new Error(`the row menu for ${text} did not open`);
}

async function runRowAction(page: Page, view: string, text: string, action: RegExp): Promise<string> {
  const outcome = await runRowActionOnce(page, view, text, action);
  // The gateway rate-limits bursts; the app relays "retry in N seconds".
  if (/rate limit/i.test(outcome)) {
    await page.waitForTimeout(12_000);
    return runRowActionOnce(page, view, text, action);
  }
  return outcome;
}

async function runRowActionOnce(page: Page, view: string, text: string, action: RegExp): Promise<string> {
  await rowMenu(page, view, text);
  // Visible only: a closed menu's items can linger hidden in the page.
  const item = page.locator('[role="menuitem"]:visible').filter({ hasText: action }).first();
  await item.waitFor({ state: "visible", timeout: 5_000 });
  await item.click();
  const confirm = page
    .locator('[role="alertdialog"], [role="dialog"]:not(:has(form))')
    .getByRole("button", { name: action })
    .last();
  await confirm.waitFor({ state: "visible", timeout: 5_000 });
  const before = recordWrites.length;
  await confirm.click();
  for (let i = 0; i < 30 && recordWrites.length === before; i++) await page.waitForTimeout(500);
  await page.waitForTimeout(1500);
  const warn = page.locator('[role="alertdialog"], [role="dialog"]').filter({ hasText: /could not/i }).first();
  if (await warn.isVisible().catch(() => false)) {
    const t = ((await warn.textContent()) || "").trim();
    await dismissToasts(page);
    return t;
  }
  return "";
}

async function editRow(page: Page, view: string, text: string, edit: () => Promise<void>): Promise<string> {
  await rowMenu(page, view, text);
  await page.locator('[role="menuitem"]:visible').filter({ hasText: /^\s*edit/i }).first().click();
  await dialog(page).waitFor({ state: "visible", timeout: 10_000 });
  await edit();
  return submit(page);
}

async function deleteRow(page: Page, view: string, text: string) {
  await rowMenu(page, view, text);
  await page.locator('[role="menuitem"]:visible').filter({ hasText: /^\s*delete/i }).first().click();
  const confirm = page
    .locator('[role="alertdialog"], [role="dialog"]:not(:has(form))')
    .getByRole("button", { name: /^delete$/i })
    .last();
  await confirm.waitFor({ state: "visible", timeout: 5_000 });
  const before = recordWrites.length;
  await confirm.click();
  for (let i = 0; i < 60 && recordWrites.length === before; i++) await page.waitForTimeout(500);
  await page.waitForTimeout(800);
  if (recordWrites.length === before) throw new Error("delete confirmed but no write was sent");
}

function expectContains(haystack: string, needle: string, what: string) {
  if (!haystack.toLowerCase().includes(needle.toLowerCase())) {
    throw new Error(`${what}: expected "${needle}" in "${haystack.slice(0, 200)}"`);
  }
}



/* ───────────────────────── oracles: what MES and the warehouse hold ───────────────────────── */

const mes = (path: string, init?: RequestInit) => gw(`/api/v1/mes/api/v1${path}`, init);
const wh = (path: string, init?: RequestInit) => gw(`/api/v1/warehouse/api/v1${path}`, init);

async function asset(tag: string) {
  return (await mes(`/assets/${encodeURIComponent(tag)}`)).body as Record<string, any> | null;
}
async function workOrderByTitle(title: string) {
  const { body } = await mes("/work-orders?limit=200");
  return ((body?.items || []) as Record<string, any>[]).find((w) => w.title === title) || null;
}
async function workOrder(num: string) {
  return (await mes(`/work-orders/${encodeURIComponent(num)}`)).body as Record<string, any>;
}
async function templateByCode(code: string) {
  const { body } = await mes("/pm-templates");
  return ((body?.items || []) as Record<string, any>[]).find((t) => t.code === code) || null;
}
async function scheduleFor(tag: string) {
  const { body } = await mes(`/pm-schedules?asset=${encodeURIComponent(tag)}`);
  return ((body?.items || []) as Record<string, any>[])[0] || null;
}
async function downtimeByReason(tag: string, reason: string) {
  const { body } = await mes(`/downtime-events?limit=200`);
  return ((body?.items || []) as Record<string, any>[]).find((d) => d.asset_tag === tag && d.reason === reason) || null;
}
async function itemBySku(sku: string) {
  const { body } = await wh(`/items?sku=${encodeURIComponent(sku)}`);
  return ((body?.items || []) as Record<string, any>[])[0] || null;
}

function plantToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function plantClock(offsetMin = 0): string {
  const d = new Date(Date.now() + offsetMin * 60_000);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kampala", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

function expectEq(actual: unknown, expected: unknown, what: string) {
  if (String(actual) !== String(expected)) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/* ───────────────────────── the run ───────────────────────── */

const V = {
  tag: `${STAMP}-PMP`,
  machine: `${STAMP} test pump`,
  woTitle: `${STAMP} bearing noise`,
  tech: `${STAMP} Tech`,
  pmCode: `${STAMP}-PM`,
  spSku: `${STAMP}-SP`,
  faultOpen: `${STAMP} jam`,
  faultDone: `${STAMP} belt slip`,
};
let woNum = "";

async function main() {
  const browser = await chromium.launch({ headless: process.env.QA_HEADED !== "1" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("response", (res) => {
    const url = res.url();
    if (!url.includes("/api/")) return;
    if (/\/api\/records\//.test(url) && res.request().method() !== "GET") {
      const entry = { status: res.status(), method: res.request().method(), url: url.replace(BASE, ""), body: "" };
      recordWrites.push(entry);
      void res.text().then((body) => {
        entry.body = body.slice(0, 200);
        console.log(`    net ${entry.status} ${entry.method} ${entry.url} ${entry.body.slice(0, 140)}`);
      }).catch(() => undefined);
    }
    if (res.status() < 400) return;
    apiErrors.push(`${res.status()} ${res.request().method()} ${url.replace(BASE, "").slice(0, 140)}`);
  });

  console.log(`\nLive maintenance CRUD run against ${BASE} (gateway ${GW}) as ${USER}, stamp ${STAMP}\n`);

  await step(page, "sign in", async () => {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("login-email").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 3; i++) {
      await page.getByTestId("login-email").fill(USER);
      await page.getByTestId("login-password").fill(PASS);
      await page.getByTestId("login-submit").click();
      const ok = await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 45_000, waitUntil: "commit" }).then(() => true).catch(() => false);
      if (ok) break;
      await page.waitForTimeout(35_000); // login rate limit
    }
    if (page.url().includes("/login")) throw new Error("still on the login page");
    await page.waitForTimeout(3000);
  });

  /* Machines */
  await step(page, "machine: create files it under the named section with criticality and technician", async () => {
    await openNew(page, "work-centers");
    await fillText(page, "name", V.machine);
    await fillText(page, "code", V.tag);
    await selectNative(page, "type", "Pump");
    await fillText(page, "section", "utilities");
    await fillText(page, "location", "QA bench");
    await selectNative(page, "criticality", "C — medium");
    await selectNative(page, "status", "Idle");
    await pick(page, "supervisor", V.tech, { custom: true });
    await fillText(page, "notes", "first note");
    const err = await submit(page);
    if (err) throw new Error(err);
    const a = await asset(V.tag);
    expectEq(a?.section_code, "utilities", "section");
    expectEq(a?.criticality, "C", "criticality");
    expectEq(a?.status, "idle", "status");
    expectEq(a?.attrs?.supervisor, V.tech, "supervisor");
    return `asset ${V.tag} in ${a?.section_code}`;
  });

  await step(page, "machine: editing notes keeps the technician (attrs merged)", async () => {
    const err = await editRow(page, "work-centers", V.tag, async () => {
      await fillText(page, "notes", "second note");
    });
    if (err) throw new Error(err);
    const a = await asset(V.tag);
    expectEq(a?.attrs?.notes, "second note", "notes");
    expectEq(a?.attrs?.supervisor, V.tech, "supervisor survived");
  });

  await step(page, "machine: changing criticality is refused with a reason", async () => {
    const err = await editRow(page, "work-centers", V.tag, async () => {
      await selectNative(page, "criticality", "A — critical");
    });
    await dismissToasts(page);
    await page.keyboard.press("Escape").catch(() => undefined);
    if (!/criticality/i.test(err)) throw new Error(`expected a criticality refusal, got "${err || "saved"}"`);
    expectEq((await asset(V.tag))?.criticality, "C", "criticality unchanged");
    return err.slice(0, 90);
  });

  /* Work orders */
  await step(page, "work order: create on the machine, numbered by MES", async () => {
    await openNew(page, "work-orders");
    await fillText(page, "title", V.woTitle);
    await pick(page, "workCenter", V.tag);
    await selectNative(page, "woType", "Breakdown");
    await selectNative(page, "priority", "High");
    await fillText(page, "dueDate", plantToday(7));
    await pick(page, "assignee", V.tech, { custom: true });
    await selectNative(page, "status", "Open");
    await fillText(page, "estimatedHours", "2");
    await fillText(page, "description", "QA: bearing noise on the pump");
    const err = await submit(page);
    if (err) throw new Error(err);
    const wo = await workOrderByTitle(V.woTitle);
    if (!wo) throw new Error("work order not found in MES");
    woNum = wo.num;
    expectEq(wo.asset_tag, V.tag, "asset_tag");
    expectEq(wo.priority, "high", "priority");
    expectEq(wo.wo_type, "breakdown", "wo_type");
    expectEq(wo.status, "open", "status");
    expectEq(wo.attrs?.estimatedHours, "2", "estimatedHours");
    if (!/^WO-\d+$/.test(woNum)) throw new Error(`number ${woNum} is not MES's WO-n`);
    return woNum;
  });

  await step(page, "work order: edit priority", async () => {
    const err = await editRow(page, "work-orders", woNum, async () => {
      await selectNative(page, "priority", "Critical");
    });
    if (err) throw new Error(err);
    const wo = await workOrder(woNum);
    expectEq(wo.priority, "critical", "priority");
    expectEq(wo.attrs?.estimatedHours, "2", "estimate kept");
  });

  await step(page, "work order: Start work moves it to in progress", async () => {
    const err = await runRowAction(page, "work-orders", woNum, /start work/i);
    if (err) throw new Error(err);
    expectEq((await workOrder(woNum)).status, "in_progress", "status");
  });

  /* Job cards */
  await step(page, "job card: create on the work order", async () => {
    await openNew(page, "batch-records");
    await pick(page, "workOrder", woNum);
    await fillText(page, "date", plantToday());
    await pick(page, "technician", V.tech, { custom: true });
    await fillText(page, "hours", "1.5");
    await fillText(page, "meterReading", "1200");
    await fillText(page, "partsUsed", "Bearing 6205 x 1");
    await selectNative(page, "status", "In Progress");
    await fillText(page, "workDone", "Replaced the drive-end bearing");
    const err = await submit(page);
    if (err) throw new Error(err);
    const card = (await workOrder(woNum)).attrs?.job_card;
    expectEq(card?.hours, "1.5", "hours");
    expectEq(card?.technician, V.tech, "technician");
  });

  await step(page, "job card: editing hours keeps the rest of the card", async () => {
    const err = await editRow(page, "batch-records", woNum, async () => {
      await fillText(page, "hours", "2.5");
    });
    if (err) throw new Error(err);
    const card = (await workOrder(woNum)).attrs?.job_card;
    expectEq(card?.hours, "2.5", "hours");
    expectEq(card?.workDone, "Replaced the drive-end bearing", "work done kept");
    expectEq(card?.partsUsed, "Bearing 6205 x 1", "parts kept");
  });

  await step(page, "job card: Completed closes the work order through /complete", async () => {
    const err = await editRow(page, "batch-records", woNum, async () => {
      await selectNative(page, "status", "Completed");
    });
    if (err) throw new Error(err);
    const wo = await workOrder(woNum);
    expectEq(wo.status, "completed", "status");
    if (!wo.completed_at) throw new Error("completed_at not stamped");
  });

  /* PM templates and schedules */
  await step(page, "PM template: create with a checklist", async () => {
    await openNew(page, "pm-templates");
    await fillText(page, "code", V.pmCode);
    await fillText(page, "name", `${STAMP} pump service`);
    await fillText(page, "assetCategory", "Pump");
    await fillText(page, "intervalDays", "30");
    await fillText(page, "checklist", "Check seals\nGrease bearings\nLog hours");
    const err = await submit(page);
    if (err) throw new Error(err);
    const t = await templateByCode(V.pmCode);
    expectEq(t?.interval_days, 30, "interval");
    expectEq((t?.checklist || []).length, 3, "checklist steps");
  });

  await step(page, "PM template: edit interval", async () => {
    const err = await editRow(page, "pm-templates", V.pmCode, async () => {
      await fillText(page, "intervalDays", "45");
    });
    if (err) throw new Error(err);
    expectEq((await templateByCode(V.pmCode))?.interval_days, 45, "interval");
  });

  await step(page, "preventive schedule: put the template on the machine", async () => {
    await openNew(page, "pm-schedules");
    await pick(page, "template", V.pmCode);
    await pick(page, "workCenter", V.tag);
    await fillText(page, "nextDue", plantToday(60));
    const err = await submit(page);
    if (err) throw new Error(err);
    const s = await scheduleFor(V.tag);
    if (!s) throw new Error("no schedule for the machine in MES");
    expectEq(String(s.next_due_at).slice(0, 10), plantToday(60), "next due");
    expectEq(s.status, "scheduled", "status");
  });

  await step(page, "preventive schedule: reschedule", async () => {
    const err = await editRow(page, "pm-schedules", V.pmCode, async () => {
      await fillText(page, "nextDue", plantToday(90));
    });
    if (err) throw new Error(err);
    expectEq(String((await scheduleFor(V.tag))?.next_due_at).slice(0, 10), plantToday(90), "next due");
  });

  /* Downtime */
  await step(page, "downtime: log an ongoing stop, then End downtime closes it", async () => {
    await openNew(page, "downtime-logs");
    await fillText(page, "date", plantToday());
    await fillText(page, "startTime", plantClock(-60));
    await pick(page, "workCenter", V.tag);
    await fillText(page, "reason", V.faultOpen);
    await selectNative(page, "category", "Breakdown");
    await pick(page, "reportedBy", V.tech, { custom: true });
    const err = await submit(page);
    if (err) throw new Error(err);
    const open = await downtimeByReason(V.tag, V.faultOpen);
    if (!open) throw new Error("downtime event not in MES");
    if (open.ended_at) throw new Error("ongoing stop arrived already ended");
    const endErr = await runRowAction(page, "downtime-logs", V.faultOpen, /end downtime/i);
    if (endErr) throw new Error(endErr);
    const closed = await downtimeByReason(V.tag, V.faultOpen);
    if (!closed?.ended_at) throw new Error("End downtime did not set ended_at");
  });

  await step(page, "downtime: log a stop that is already over, with its minutes", async () => {
    await openNew(page, "downtime-logs");
    await fillText(page, "date", plantToday());
    await fillText(page, "startTime", plantClock(-180));
    await pick(page, "workCenter", V.tag);
    await fillText(page, "reason", V.faultDone);
    await selectNative(page, "category", "Breakdown");
    await pick(page, "reportedBy", V.tech, { custom: true });
    await fillText(page, "minutes", "30");
    const err = await submit(page);
    if (err) throw new Error(err);
    const d = await downtimeByReason(V.tag, V.faultDone);
    if (!d?.ended_at) throw new Error("ended_at not stored (iag-mes#3 not live?)");
    const mins = Math.round((Date.parse(d.ended_at) - Date.parse(d.started_at)) / 60_000);
    expectEq(mins, 30, "minutes");
  });

  /* Spare parts */
  await step(page, "spare part: create as a warehouse spare part with machine types", async () => {
    await openNew(page, "spare-parts");
    await fillText(page, "name", `${STAMP} mechanical seal`);
    await fillText(page, "code", V.spSku);
    await fillText(page, "manufacturer", "QA Seals Ltd");
    await fillText(page, "fitsMachineTypes", "Pump, Compressor");
    await fillText(page, "unit", "pcs");
    await fillText(page, "reorderLevel", "2");
    await selectNative(page, "status", "Active");
    const err = await submit(page);
    if (err) throw new Error(err);
    const item = await itemBySku(V.spSku);
    expectEq(item?.material_class, "spare_part", "material_class");
    expectEq(item?.min_qty, 2, "reorder level");
    const compat = (await wh(`/spare-compat?item_id=${item?.id}`)).body?.items || [];
    expectEq(compat.map((c: any) => c.asset_type).sort().join(","), "Compressor,Pump", "machine types");
  });

  await step(page, "spare part: edit keeps the other details; machine types follow the form", async () => {
    const err = await editRow(page, "spare-parts", V.spSku, async () => {
      await fillText(page, "partNumber", "MS-40");
      await fillText(page, "fitsMachineTypes", "Pump");
    });
    if (err) throw new Error(err);
    const item = await itemBySku(V.spSku);
    expectEq(item?.attrs?.partNumber, "MS-40", "part number");
    expectEq(item?.attrs?.manufacturer, "QA Seals Ltd", "manufacturer kept");
    const compat = (await wh(`/spare-compat?item_id=${item?.id}`)).body?.items || [];
    expectEq(compat.map((c: any) => c.asset_type).join(","), "Pump", "machine types");
  });

  /* Energy */
  await step(page, "energy: record a meter reading", async () => {
    const before = Number((await mes(`/energy/summary?plant=kampala&since=${plantToday()}T00:00:00%2B03:00`)).body?.kwh_by_band?.total || 0);
    await openNew(page, "energy");
    await pick(page, "plantCode", "kampala");
    await pick(page, "workCenter", V.tag);
    await fillText(page, "kwh", "0.001");
    await selectNative(page, "tariffBand", "Standard");
    await fillText(page, "date", plantToday());
    await fillText(page, "time", plantClock(-5));
    const err = await submit(page);
    if (err) throw new Error(err);
    const after = Number((await mes(`/energy/summary?plant=kampala&since=${plantToday()}T00:00:00%2B03:00`)).body?.kwh_by_band?.total || 0);
    if (Math.abs(after - before - 0.001) > 0.0005) throw new Error(`kWh today went ${before} → ${after}`);
  });

  /* Read-only screens */
  for (const view of ["reliability", "alerts", "recommendations", "machine-performance"]) {
    await step(page, `${view}: loads`, async () => {
      // Judged by the list request the app itself makes; a bare request from
      // the test runner does not carry the app's session the way the page does.
      const listed = page.waitForResponse(
        (r) => r.url().includes(`/api/records/production/${view}`) && r.request().method() === "GET",
        { timeout: 60_000 },
      ).catch(() => null);
      await gotoList(page, view);
      const res = await listed;
      if (res && !res.ok() && res.status() !== 304) throw new Error(`${res.status()} ${(await res.text()).slice(0, 160)}`);
      const heading = page.locator("main h1, h1").filter({ hasText: VIEW[view].label }).first();
      if (!(await heading.isVisible().catch(() => false))) throw new Error("the tab did not open");
      const rows = await page.locator("table tbody tr").count();
      return `${res ? `HTTP ${res.status()}` : "served from cache"}, ${rows} row(s) shown`;
    });
  }

  /* Cleanup */
  await step(page, "cleanup: spare part obsolete; machine retired (or idle)", async () => {
    const notes: string[] = [];
    const spErr = await editRow(page, "spare-parts", V.spSku, async () => {
      await selectNative(page, "status", "Obsolete");
    });
    notes.push(spErr ? `spare part: ${spErr}` : `spare part ${(await itemBySku(V.spSku))?.status}`);
    const retErr = await editRow(page, "work-centers", V.tag, async () => {
      await selectNative(page, "status", "Retired");
    });
    await dismissToasts(page);
    await page.keyboard.press("Escape").catch(() => undefined);
    if (retErr) {
      notes.push(`retire refused (${retErr.slice(0, 80)})`);
      const idleErr = await editRow(page, "work-centers", V.tag, async () => {
        await selectNative(page, "status", "Idle");
      });
      notes.push(idleErr ? `idle: ${idleErr}` : "machine left idle");
    } else {
      notes.push(`machine ${(await asset(V.tag))?.status}`);
    }
    return notes.join("; ");
  });

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  const report = { base: BASE, gateway: GW, stamp: STAMP, workOrder: woNum, passed, failed: results.length - passed, results, apiErrors, pageErrors };
  writeFileSync(`${OUT}report.json`, JSON.stringify(report, null, 2));
  console.log(`\n${passed}/${results.length} steps passed — stamp ${STAMP}, work order ${woNum}`);
  if (apiErrors.length) console.log(`API errors seen:\n  ${apiErrors.join("\n  ")}`);
  if (pageErrors.length) console.log(`Page errors:\n  ${pageErrors.slice(0, 5).join("\n  ")}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
