/**
 * Drive the real Receipts & Payments form in a browser and watch the wire.
 *
 * The single-record write change reroutes create/edit/delete off the
 * whole-collection PUT. Server-side tests prove the endpoints behave; only a
 * browser proves the component actually calls them, that the row appears in the
 * table, and that it is still there after a reload. That last part is the whole
 * complaint this work started from.
 *
 * Needs the app on :3000 pointed at a THROWAWAY API, and a seeded admin.
 *   npx tsx scripts/test-browser-save-path.mts [baseUrl]
 */
import { config as loadEnv } from "dotenv";
import { chromium, type Page, type Request } from "playwright";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const BASE = (process.argv[2] || "http://127.0.0.1:3000").replace(/\/$/, "");
const API = (process.env.API_URL || "http://127.0.0.1:8099").replace(/\/$/, "");

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok  ${name}`);
  } else {
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
    console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

type Write = { method: string; url: string; bytes: number };

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input:not([type="password"])').first().fill(
    process.env.RT_USER || "roundtrip@test.local",
  );
  await page.fill('input[type="password"]', process.env.RT_PASSWORD || "LocalTest123!");
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 45_000 });
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const writes: Write[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("request", (req: Request) => {
    const url = req.url();
    if (!/\/api\/records\//.test(url)) return;
    const method = req.method();
    if (method === "GET") return;
    writes.push({ method, url, bytes: (req.postData() || "").length });
  });

  try {
    await signIn(page);
    console.log("signed in\n");

    const reference = `UI-${Date.now()}`;
    await page.goto(`${BASE}/receipts-payments?view=payments`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(4000);

    // Open the create form and wait for the dialog to finish animating in —
    // its fields are in the DOM before they are interactable.
    await page.getByRole("button", { name: "New Payment", exact: true }).first().click({
      timeout: 20_000,
    });
    await page.locator('input[name="reference"]').first().waitFor({
      state: "visible",
      timeout: 20_000,
    });

    // Field shapes differ: plain text inputs carry name+id; money and
    // picker-backed fields keep a hidden input[name] and expose a separate
    // visible control (amount is input#amount, inputmode=decimal).
    const fillById = async (id: string, value: string) => {
      const field = page.locator(`input#${id}`).first();
      await field.waitFor({ state: "visible", timeout: 15_000 });
      await field.fill(value);
    };
    // Pickers render their choices as buttons, not role=option.
    const pick = async (trigger: RegExp, choice: string) => {
      await page.getByRole("button", { name: trigger }).first().click({ timeout: 15_000 });
      const option = page.locator(`[cmdk-item], [role="option"], button`).filter({
        hasText: choice,
      });
      await option.first().click({ timeout: 15_000 });
      await page.waitForTimeout(400);
    };
    const chooseFirst = async (name: string) => {
      const select = page.locator(`select[name="${name}"]`).first();
      if (!(await select.count())) return;
      const values = await select
        .locator("option")
        .evaluateAll((els) =>
          els.map((e) => (e as HTMLOptionElement).value).filter((v) => v && v.trim()),
        );
      if (values.length) await select.selectOption(values[0]);
    };

    await fillById("reference", reference);
    await fillById("date", "2026-08-06");
    await fillById("amount", "4321");
    await pick(/select bank account/i, "Scale Bank");
    await pick(/search suppliers or contractors/i, "Browser Payee");
    await chooseFirst("clearance");
    await chooseFirst("status");
    await page.waitForTimeout(500);

    const before = writes.length;
    await page
      .getByRole("button", { name: /^create record$|^save$|^create payment$/i })
      .first()
      .click({ timeout: 20_000 });
    await page.waitForTimeout(3000);
    // A confirmation step may stand between the form and the write.
    const confirm = page
      .getByRole("button", { name: /^(confirm|yes|save|create|ok)/i })
      .first();
    if (await confirm.count()) await confirm.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(6000);

    if (process.env.DEBUG_UI) {
      await page.screenshot({ path: "/tmp/after-save.png", fullPage: true });
      const body = await page.locator("body").innerText();
      console.log("--- PAGE TEXT ---\n" + body.slice(0, 2500) + "\n--- END ---");
      const vals = await page.locator("input").evaluateAll((els) =>
        els.map((e) => `${(e as HTMLInputElement).name || "?"}=${(e as HTMLInputElement).value}`),
      );
      console.log("INPUT VALUES:", vals.join(" | "));
    }
    const madeWrites = writes.slice(before);
    const itemWrites = madeWrites.filter((w) => /\/api\/records\/[^/]+\/[^/]+\/?$/.test(w.url) && w.method === "POST");
    // Only a collection PUT to the entity being saved matters. documents/history
    // is the audit trail — a capped list that is meant to be written wholesale.
    const collectionPuts = madeWrites.filter(
      (w) => w.method === "PUT" && /\/api\/records\/banking\/payments\/?$/.test(w.url),
    );

    check(
      "saving issued a single-record POST, not a collection PUT",
      itemWrites.length > 0 && collectionPuts.length === 0,
      `POSTs=${itemWrites.length} PUTs=${collectionPuts.length} :: ${madeWrites
        .map((w) => `${w.method} ${w.url.split("/api/")[1]} (${w.bytes}B)`)
        .join(", ")}`,
    );

    if (itemWrites.length) {
      check(
        "the save payload is one row, not the whole table",
        itemWrites[0].bytes < 8000,
        `${itemWrites[0].bytes} bytes`,
      );
    }

    // The row must be on screen…
    const visible = await page.getByText(reference, { exact: false }).count();
    check("the new payment appears in the table", visible > 0);

    // …and still there after a full reload (the original bug).
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const afterReload = await page.getByText(reference, { exact: false }).count();
    check("the payment is still there after a reload", afterReload > 0);

    // …and in the database.
    const token = await page.evaluate(() => sessionStorage.getItem("financeiag-api-token"));
    if (token) {
      const res = await fetch(`${API}/api/records/banking/payments`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as { data?: Array<Record<string, string>> };
      const row = (body.data || []).find((r) => r.reference === reference);
      check("the payment is in Postgres", Boolean(row));
      check(
        "it is the first row the API returns",
        (body.data || [])[0]?.reference === reference,
        `first row is ${(body.data || [])[0]?.reference}`,
      );
    }

    check("no uncaught errors in the page", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
  }
}

await main();

console.log(`\n===== SUMMARY =====`);
if (failures.length) {
  console.error(`${failures.length} browser check(s) failed:`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("The browser save path uses single-record writes and the row survives a reload.");
