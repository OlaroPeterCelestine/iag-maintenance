/**
 * Page-by-page smoke crawl: mint local JWT, visit every route/view, collect pageerrors.
 * Usage: npx tsx scripts/smoke-pages.mts [baseUrl]
 */
import { config as loadEnv } from "dotenv";
import { chromium, type Page } from "playwright";
import { NAV_MODULES } from "../src/lib/module-data";
import { entityKey } from "../src/lib/manager-entities";
import { API_TOKEN_COOKIE, issueApiToken } from "../src/lib/server-jwt";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const BASE = (process.argv[2] || "http://127.0.0.1:3000").replace(/\/$/, "");

const EXTRA_PATHS = [
  "/",
  "/forgot-password",
  "/guides",
  "/qna",
  "/lab",
  "/qa",
  "/production",
  "/benchmark",
  "/templates",
  "/profile",
  "/settings",
  "/users",
  "/activity-logs",
  "/request-emails",
  "/payment-requests",
  "/accounting-documents",
  "/requests",
];

type Finding = {
  url: string;
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: string[];
  bodySignals: string[];
  ok: boolean;
};

function isNoise(text: string) {
  const t = text.toLowerCase();
  return (
    t.includes("favicon") ||
    t.includes("download the react devtools") ||
    t.includes("third-party cookie") ||
    t.includes("net::err_aborted") ||
    t.includes("failed to load resource: the server responded with a status of 401") ||
    t.includes("failed to load resource: the server responded with a status of 404") ||
    t.includes("hydration") ||
    t.includes("err_network_changed") ||
    t.includes("err_internet_disconnected")
  );
}

function bodyErrorSignals(text: string): string[] {
  const signals: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/this page couldn[’']t load/i, "page couldn't load"],
    [/application error/i, "application error"],
    [/uncaught (error|exception)/i, "uncaught error in body"],
    [/minimum update depth exceeded|maximum update depth exceeded/i, "infinite update loop"],
    [/runtime error/i, "runtime error"],
    [/something went wrong/i, "something went wrong"],
    [/this page could not be found/i, "404 not found"],
    [/digest:\s*[a-z0-9]+/i, "next error digest"],
  ];
  for (const [re, label] of checks) {
    if (re.test(text)) signals.push(label);
  }
  return signals;
}

async function probe(page: Page, path: string): Promise<Finding> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!isNoise(text)) consoleErrors.push(text.slice(0, 500));
    }
  };
  const onPageError = (err: Error) => {
    pageErrors.push((err.stack || err.message || String(err)).slice(0, 800));
  };
  const onFail = (req: {
    method: () => string;
    url: () => string;
    failure: () => { errorText?: string } | null;
  }) => {
    const u = req.url();
    if (u.includes("favicon") || u.includes("chrome-extension")) return;
    failedRequests.push(
      `${req.method()} ${u.slice(0, 180)} -> ${req.failure()?.errorText || "failed"}`,
    );
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onFail);

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1800);
  } catch (err) {
    pageErrors.push(`navigation: ${err instanceof Error ? err.message : String(err)}`);
  }

  let body = "";
  try {
    body = await page.locator("body").innerText({ timeout: 5000 });
  } catch {
    body = "";
  }
  const bodySignals = bodyErrorSignals(body);
  if (page.url().includes("/login") && !path.includes("login") && !path.includes("forgot")) {
    bodySignals.push("redirected-to-login");
  }

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("requestfailed", onFail);

  const ok =
    pageErrors.length === 0 &&
    consoleErrors.length === 0 &&
    bodySignals.length === 0;

  return {
    url: page.url(),
    pageErrors: [...new Set(pageErrors)],
    consoleErrors: [...new Set(consoleErrors)].slice(0, 8),
    failedRequests: [...new Set(failedRequests)].slice(0, 8),
    bodySignals: [...new Set(bodySignals)],
    ok,
  };
}

function buildUrls(): string[] {
  const urls = new Set<string>(EXTRA_PATHS);
  for (const mod of NAV_MODULES) {
    urls.add(`/${mod.slug}`);
    for (const item of mod.items) {
      urls.add(`/${mod.slug}?view=${entityKey(item)}`);
    }
  }
  return [...urls];
}

async function main() {
  if (!process.env.JWT_SECRET?.trim()) {
    console.error("JWT_SECRET missing — cannot mint smoke auth cookie");
    process.exit(2);
  }

  const urls = buildUrls();
  console.log(`SMOKE base=${BASE} pages=${urls.length}`);

  const { token, expiresAt } = await issueApiToken({
    id: "smoke-admin",
    email: "admin@iag.local",
    username: "admin",
    role: "Administrator",
    name: "Smoke Admin",
  });

  const session = {
    sessionId: "smoke-session",
    userId: "smoke-admin",
    email: "admin@iag.local",
    name: "Smoke Admin",
    username: "admin",
    role: "Administrator",
    canView: "Yes",
    canCreate: "Yes",
    canEdit: "Yes",
    canDelete: "Yes",
  };

  const browser = await chromium.launch({
    headless: true,
    channel: process.env.SMOKE_CHANNEL || "chrome",
  });
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: API_TOKEN_COOKIE,
      value: token,
      url: BASE,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await context.addInitScript(
    ({ sessionJson, tokenValue, expires }) => {
      try {
        sessionStorage.setItem("financeiag-session", sessionJson);
        sessionStorage.setItem("financeiag-api-token", tokenValue);
        sessionStorage.setItem("financeiag-api-token-expires", expires);
        sessionStorage.setItem(
          "financeiag-login-grace-until",
          String(Date.now() + 120_000),
        );
        sessionStorage.removeItem("financeiag-just-logged-out");
      } catch {
        /* ignore */
      }
    },
    {
      sessionJson: JSON.stringify(session),
      tokenValue: token,
      expires: expiresAt,
    },
  );

  const page = await context.newPage();
  const home = await probe(page, "/");
  console.log(
    `AUTH_HOME ok=${home.ok} url=${home.url} body=${home.bodySignals.join("|") || "-"}`,
  );
  if (home.bodySignals.includes("redirected-to-login")) {
    console.log("AUTH_FAILED still on login");
    await browser.close();
    process.exit(2);
  }

  const results: Array<{ path: string } & Finding> = [];
  for (const path of urls) {
    const finding = await probe(page, path);
    results.push({ path, ...finding });
    const mark = finding.ok ? "OK" : "FAIL";
    console.log(
      `${mark} ${path} :: pageErr=${finding.pageErrors.length} consoleErr=${finding.consoleErrors.length} body=${finding.bodySignals.join("|") || "-"}`,
    );
  }

  await browser.close();

  const fails = results.filter((r) => !r.ok);
  console.log("\n===== SUMMARY =====");
  console.log(`total=${results.length} ok=${results.length - fails.length} fail=${fails.length}`);
  for (const f of fails) {
    console.log(`\n--- ${f.path} ---`);
    console.log(`finalUrl=${f.url}`);
    if (f.bodySignals.length) console.log(`bodySignals=${f.bodySignals.join(", ")}`);
    for (const e of f.pageErrors) console.log(`pageerror: ${e}`);
    for (const e of f.consoleErrors) console.log(`console: ${e}`);
    for (const e of f.failedRequests.slice(0, 3)) console.log(`requestfailed: ${e}`);
  }

  process.exit(fails.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(3);
});
