/**
 * Exercises EGO_SMS_ENABLED / EGO_SMS_API_URL against a local mock EgoSMS so the
 * transport selection and error reporting are covered without spending credits.
 *
 *   npx tsx scripts/test-egosms-transport.mts
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  describeSmsConfig,
  isSmsEnabled,
  isValidPhone,
  normalizePhone,
  normalizeRecipients,
  resolveTransport,
  sendViaEgoSms,
} from "../src/lib/sms/egosms.ts";

type Hit = { method: string; path: string; query: URLSearchParams; body: string };

const hits: Hit[] = [];

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    hits.push({
      method: req.method || "",
      path: url.pathname,
      query: url.searchParams,
      body,
    });
    // 256700000999 is the designated "carrier rejects this" number.
    const rejected =
      url.searchParams.get("number") === "256700000999" ||
      body.includes("256700000999");
    if (url.pathname.endsWith("/plain")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(rejected ? "Failed: invalid destination" : "Ok");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        rejected
          ? { Status: "Failed", Message: "invalid destination" }
          : { Status: "OK", Cost: "1.00" },
      ),
    );
  });
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

const creds = { EGO_SMS_USERNAME: "u", EGO_SMS_PASSWORD: "p", EGO_SMS_SENDER: "IAG" };
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

console.log("EGO_SMS_ENABLED");
check("unset → enabled", isSmsEnabled({} as NodeJS.ProcessEnv));
check("true → enabled", isSmsEnabled({ EGO_SMS_ENABLED: "true" } as NodeJS.ProcessEnv));
for (const value of ["false", "0", "no", "off", "FALSE", " Off "]) {
  check(
    `${JSON.stringify(value)} → disabled`,
    !isSmsEnabled({ EGO_SMS_ENABLED: value } as NodeJS.ProcessEnv),
  );
}

console.log("\nEGO_SMS_API_URL");
check(
  "unset → json batch endpoint",
  resolveTransport({} as NodeJS.ProcessEnv).mode === "json",
);
check(
  "/api/v1/plain → plain mode",
  resolveTransport({
    EGO_SMS_API_URL: "https://www.egosms.co/api/v1/plain",
  } as NodeJS.ProcessEnv).mode === "plain",
);
check(
  "/api/v1/plain/ (trailing slash) → plain mode",
  resolveTransport({
    EGO_SMS_API_URL: "https://www.egosms.co/api/v1/plain/",
  } as NodeJS.ProcessEnv).mode === "plain",
);
check(
  "/api/v1/json/ → json mode",
  resolveTransport({
    EGO_SMS_API_URL: "https://www.egosms.co/api/v1/json/",
  } as NodeJS.ProcessEnv).mode === "json",
);
{
  const msg = await expectError(async () =>
    resolveTransport({ EGO_SMS_API_URL: "not a url" } as NodeJS.ProcessEnv),
  );
  check("garbage URL → clear error", msg.includes("not a valid URL"), msg);
}
{
  const msg = await expectError(async () =>
    resolveTransport({ EGO_SMS_API_URL: "ftp://egosms.co/x" } as NodeJS.ProcessEnv),
  );
  check("non-http scheme → rejected", msg.includes("http(s)"), msg);
}

console.log("\nSend — disabled");
{
  const msg = await expectError(() =>
    sendViaEgoSms(["256700000001"], "hi", {
      ...creds,
      EGO_SMS_ENABLED: "false",
      EGO_SMS_API_URL: `${base}/api/v1/json/`,
    } as NodeJS.ProcessEnv),
  );
  check("disabled blocks the send", msg.includes("disabled"), msg);
  check("no request reached the gateway", hits.length === 0, `${hits.length} hits`);
}

console.log("\nSend — json transport");
hits.length = 0;
{
  const out = await sendViaEgoSms(["256700000001", "256700000002"], "hello", {
    ...creds,
    EGO_SMS_API_URL: `${base}/api/v1/json/`,
  } as NodeJS.ProcessEnv);
  check("reports via=json", out.via === "json", out.via);
  check("batches into one POST", hits.length === 1, `${hits.length} hits`);
  check("uses POST", hits[0]?.method === "POST", hits[0]?.method);
  const payload = JSON.parse(hits[0]?.body || "{}");
  check("sends both recipients", payload.msgdata?.length === 2);
  check("passes sender id", payload.msgdata?.[0]?.senderid === "IAG");
}

console.log("\nSend — plain transport");
hits.length = 0;
{
  const out = await sendViaEgoSms(["256700000001", "256700000002"], "hello", {
    ...creds,
    EGO_SMS_API_URL: `${base}/api/v1/plain`,
  } as NodeJS.ProcessEnv);
  check("reports via=plain", out.via === "plain", out.via);
  check("one GET per recipient", hits.length === 2, `${hits.length} hits`);
  check("uses GET", hits.every((h) => h.method === "GET"));
  check("passes message", hits[0]?.query.get("message") === "hello");
  check("passes sender", hits[0]?.query.get("sender") === "IAG");
  check(
    "passes each number",
    new Set(hits.map((h) => h.query.get("number"))).size === 2,
  );
}

console.log("\nSend — plain partial failure");
hits.length = 0;
{
  const msg = await expectError(() =>
    sendViaEgoSms(["256700000001", "256700000999"], "hello", {
      ...creds,
      EGO_SMS_API_URL: `${base}/api/v1/plain`,
    } as NodeJS.ProcessEnv),
  );
  check("surfaces partial-send count", msg.includes("Sent to 1 of 2"), msg);
  check("names the failed number", msg.includes("256700000999"), msg);
  check("includes carrier reason", msg.includes("invalid destination"), msg);
}

console.log("\nCredentials — server env only");
{
  hits.length = 0;
  const msg = await expectError(() =>
    sendViaEgoSms(["256700000001"], "hi", {
      EGO_SMS_API_URL: `${base}/api/v1/plain`,
    } as NodeJS.ProcessEnv),
  );
  check("missing creds → actionable error", msg.includes("not configured"), msg);
  check("names the missing vars", msg.includes("EGO_SMS_USERNAME"), msg);
  check("no request attempted", hits.length === 0, `${hits.length} hits`);

  const partial = await expectError(() =>
    sendViaEgoSms(["256700000001"], "hi", {
      EGO_SMS_USERNAME: "u",
      EGO_SMS_API_URL: `${base}/api/v1/plain`,
    } as NodeJS.ProcessEnv),
  );
  check(
    "partial creds → names only what is missing",
    partial.includes("EGO_SMS_PASSWORD") &&
      partial.includes("EGO_SMS_SENDER") &&
      !partial.includes("EGO_SMS_USERNAME"),
    partial,
  );

  hits.length = 0;
  await sendViaEgoSms(["256700000001"], "hi", {
    ...creds,
    EGO_SMS_API_URL: `${base}/api/v1/plain`,
  } as NodeJS.ProcessEnv);
  check(
    "uses env credentials",
    hits[0]?.query.get("username") === "u",
    hits[0]?.query.get("username") || "",
  );

  const longSender = await expectError(() =>
    sendViaEgoSms(["256700000001"], "hi", {
      ...creds,
      EGO_SMS_SENDER: "TWELVECHARSX",
      EGO_SMS_API_URL: `${base}/api/v1/plain`,
    } as NodeJS.ProcessEnv),
  );
  check("sender >11 chars rejected", longSender.includes("11 characters"), longSender);
}

console.log("\nConfig status (Settings panel payload)");
{
  // Distinctive values so a leak check cannot pass by coincidence.
  const status = describeSmsConfig({
    EGO_SMS_USERNAME: "SECRET-USERNAME-XYZ",
    EGO_SMS_PASSWORD: "SECRET-PASSWORD-XYZ",
    EGO_SMS_SENDER: "IAG",
    EGO_SMS_API_URL: "https://www.egosms.co/api/v1/plain",
  } as NodeJS.ProcessEnv);
  check("reports configured", status.configured && status.enabled);
  check("reports transport", status.transport === "plain", status.transport);
  check("exposes sender id", status.sender === "IAG", status.sender);
  const serialized = JSON.stringify(status);
  check("leaks no username", !serialized.includes("SECRET-USERNAME-XYZ"), serialized);
  check("leaks no password", !serialized.includes("SECRET-PASSWORD-XYZ"), serialized);

  const off = describeSmsConfig({
    ...creds,
    EGO_SMS_ENABLED: "off",
  } as NodeJS.ProcessEnv);
  check("reports disabled", !off.enabled);

  const bare = describeSmsConfig({} as NodeJS.ProcessEnv);
  check("reports unconfigured", !bare.configured && bare.missing.length === 3);
}

console.log("\nPhone normalization (server-side)");
{
  check("UG local 07… → 2567…", normalizePhone("0781234567") === "256781234567");
  check("+256 stripped to digits", normalizePhone("+256 781 234 567") === "256781234567");
  check("already international kept", normalizePhone("256781234567") === "256781234567");
  check("empty → empty", normalizePhone("  ") === "");
  check("valid length accepted", isValidPhone("256781234567"));
  check("too short rejected", !isValidPhone("12345"));
  check(
    "comma/newline recipient lists split",
    normalizeRecipients("0781234567, 0700000000\n0755555555").length === 3,
  );
  check("array recipients kept", normalizeRecipients(["0781234567", ""]).length === 1);
}

server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
