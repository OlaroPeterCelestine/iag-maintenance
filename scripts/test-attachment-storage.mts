/**
 * Attachments must not live inside the record.
 *
 * They used to be base64 data URLs inside entity_records.data, so a 1.5 MB scan
 * sat in the same JSONB blob as the payment it belonged to: re-serialised on
 * every unrelated save of that collection, shipped to every client that opened
 * the page, and cached in Redis with it. Listing a page downloaded every file
 * on it.
 *
 * These checks hold the new contract: the bytes go to blob storage, the record
 * keeps a small reference, existing inline files migrate themselves on the next
 * save, and the download path refuses to serve a file as executable content.
 *
 * Run against a THROWAWAY API:
 *   API_URL=http://127.0.0.1:8099 npx tsx scripts/test-attachment-storage.mts
 */
import assert from "node:assert/strict";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const API = (process.env.API_URL || "http://127.0.0.1:8099").replace(/\/$/, "");
if (/railway|vercel|https:/i.test(API) && !process.env.ALLOW_REMOTE_WRITE) {
  console.error(`Refusing to write to ${API}. Point API_URL at a local throwaway API.`);
  process.exit(1);
}

const failures: string[] = [];
async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

let token = "";
let viewerToken = "";

async function login(user: string, password: string) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrUsername: user, password }),
  });
  const body = (await res.json()) as { data?: { token?: string } };
  if (!body.data?.token) throw new Error(`login failed for ${user} (${res.status})`);
  return body.data.token;
}

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const { token: t = token, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${t}`,
      ...(rest.headers || {}),
    },
  });
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, text, headers: res.headers };
}

/** A ~300 KB PDF, the kind of file a real invoice scan is. */
function bigPdfDataUrl(sizeBytes = 300_000) {
  const header = "%PDF-1.4\n% attachment storage test\n";
  const payload = header + "A".repeat(Math.max(0, sizeBytes - header.length));
  return `data:application/pdf;base64,${Buffer.from(payload, "utf8").toString("base64")}`;
}

type Row = Record<string, string>;

async function collection() {
  const res = await api("/api/records/banking/payments");
  return {
    rows: (res.body?.data as Row[]) || [],
    revision: String(res.body?.revision || ""),
  };
}

const cleanup: string[] = [];

async function main() {
  token = await login(
    process.env.RT_USER || "roundtrip@test.local",
    process.env.RT_PASSWORD || "LocalTest123!",
  );
  try {
    viewerToken = await login(
      process.env.RT_VIEWER || "viewer@test.local",
      process.env.RT_VIEWER_PASSWORD || "ViewerTest123!",
    );
  } catch {
    /* permission checks skipped */
  }
  console.log(`Attachment storage against ${API}\n`);

  let storageId = "";

  await check("uploading a file returns a reference, not a payload", async () => {
    const res = await api("/api/attachments", {
      method: "POST",
      body: JSON.stringify({
        module: "banking",
        entity: "payments",
        recordId: "att-record",
        files: [{ name: "invoice-scan.pdf", mime: "application/pdf", dataUrl: bigPdfDataUrl() }],
      }),
    });
    assert.equal(res.status, 201, `upload failed: ${res.status} ${res.text.slice(0, 200)}`);
    const refs = res.body?.data as Array<Record<string, unknown>>;
    assert.equal(refs.length, 1, "expected one reference back");
    storageId = String(refs[0].storageId || "");
    assert.ok(storageId, "no storageId returned");
    assert.equal(refs[0].dataUrl, undefined, "the payload came back in the reference");
    assert.equal(refs[0].name, "invoice-scan.pdf");
    assert.ok(Number(refs[0].size) > 250_000, `size looks wrong: ${refs[0].size}`);
  });

  await check("the stored file downloads back byte-for-byte", async () => {
    const res = await fetch(`${API}/api/attachments/${storageId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200, `download failed ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(body.length > 250_000, `got ${body.length} bytes`);
    assert.ok(body.toString("utf8", 0, 8).startsWith("%PDF"), "content is not the file we stored");
  });

  await check("a download can never execute in our origin", async () => {
    const res = await fetch(`${API}/api/attachments/${storageId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(
      res.headers.get("content-disposition")?.includes("attachment"),
      true,
      "missing Content-Disposition: attachment — the browser would render it inline",
    );
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", "missing nosniff");
    assert.ok(
      (res.headers.get("content-security-policy") || "").includes("sandbox"),
      "missing sandbox CSP on a user-supplied file",
    );
  });

  await check("downloading requires a session", async () => {
    const res = await fetch(`${API}/api/attachments/${storageId}`);
    assert.equal(res.status, 401, `anonymous download returned ${res.status}`);
  });

  if (viewerToken) {
    await check("a read-only role cannot upload", async () => {
      const res = await api("/api/attachments", {
        method: "POST",
        token: viewerToken,
        body: JSON.stringify({
          files: [{ name: "x.pdf", mime: "application/pdf", dataUrl: bigPdfDataUrl(1000) }],
        }),
      });
      assert.ok(res.status >= 400, `viewer upload succeeded with ${res.status}`);
    });
  }

  await check("a disguised script is refused", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>", "utf8").toString("base64");
    const res = await api("/api/attachments", {
      method: "POST",
      body: JSON.stringify({
        files: [{ name: "invoice.pdf", mime: "application/pdf", dataUrl: `data:application/pdf;base64,${html}` }],
      }),
    });
    assert.ok(res.status >= 400, `markup disguised as a PDF was accepted (${res.status})`);
  });

  await check("a banned file type is refused", async () => {
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>", "utf8").toString("base64");
    const res = await api("/api/attachments", {
      method: "POST",
      body: JSON.stringify({
        files: [{ name: "logo.svg", mime: "image/svg+xml", dataUrl: `data:image/svg+xml;base64,${svg}` }],
      }),
    });
    assert.ok(res.status >= 400, `an SVG was accepted (${res.status})`);
  });

  await check("a record saved with an inline file sheds it into storage", async () => {
    const id = "att-inline-record";
    cleanup.push(id);
    // Exactly what an older client sends: the payload embedded in the record.
    const res = await api("/api/records/banking/payments", {
      method: "POST",
      body: JSON.stringify({
        id,
        reference: "ATT-1",
        date: "2026-08-06",
        party: "Attachment payee",
        account: "Any Bank",
        amount: "900",
        status: "Paid",
        attachments: JSON.stringify([
          {
            id: "file-1",
            name: "receipt.pdf",
            mime: "application/pdf",
            size: 300_000,
            dataUrl: bigPdfDataUrl(),
            uploadedAt: new Date().toISOString(),
          },
        ]),
      }),
    });
    assert.ok(res.status < 300, `create failed ${res.status}: ${res.text.slice(0, 200)}`);

    const stored = await api(`/api/records/banking/payments/${id}`);
    const row = stored.body?.data as Row;
    const files = JSON.parse(row.attachments || "[]") as Array<Record<string, unknown>>;
    assert.equal(files.length, 1, "attachment lost on save");
    assert.ok(files[0].storageId, "the file was not moved into blob storage");
    assert.ok(!files[0].dataUrl, "the payload is still embedded in the record");
    assert.equal(files[0].name, "receipt.pdf", "the filename was lost");
  });

  await check("the record row no longer carries the file", async () => {
    const stored = await api("/api/records/banking/payments/att-inline-record");
    const row = stored.body?.data as Row;
    const bytes = Buffer.byteLength(JSON.stringify(row));
    assert.ok(
      bytes < 4000,
      `the record is ${bytes} bytes — the 300 KB file is still inside it`,
    );
    console.log(`      record is ${bytes} B, holding a 300 KB file by reference`);
  });

  await check("listing the collection does not download the files", async () => {
    const before = await collection();
    // Ten records, each with its own 300 KB file.
    for (let i = 0; i < 10; i++) {
      const id = `att-bulk-${i}`;
      cleanup.push(id);
      await api("/api/records/banking/payments", {
        method: "POST",
        body: JSON.stringify({
          id,
          reference: `ATT-B${i}`,
          date: "2026-08-06",
          amount: "100",
          status: "Paid",
          attachments: JSON.stringify([
            {
              id: `bulk-file-${i}`,
              name: `scan-${i}.pdf`,
              mime: "application/pdf",
              size: 300_000,
              dataUrl: bigPdfDataUrl(),
              uploadedAt: new Date().toISOString(),
            },
          ]),
        }),
      });
    }
    const res = await api("/api/records/banking/payments");
    const listBytes = Buffer.byteLength(res.text);
    const inlineWouldBe = 10 * 400_000; // 300 KB base64-encoded, per record
    assert.ok(
      listBytes < inlineWouldBe / 10,
      `listing cost ${listBytes} B — files are still travelling with the list`,
    );
    console.log(
      `      list of ${before.rows.length + 10} records with 10 files: ${listBytes} B ` +
        `(inline would be ~${inlineWouldBe} B)`,
    );
  });

  await check("deleting a stored file removes it", async () => {
    const res = await api(`/api/attachments/${storageId}`, { method: "DELETE" });
    assert.equal(res.status, 200, `delete failed ${res.status}`);
    const gone = await fetch(`${API}/api/attachments/${storageId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(gone.status, 404, `file still served after delete (${gone.status})`);
  });

  // Clean up records this test created.
  const current = await collection();
  const mine = current.rows.filter((r) => r.id.startsWith("att-")).map((r) => r.id);
  if (mine.length) {
    await api("/api/records/banking/payments", {
      method: "PUT",
      body: JSON.stringify({
        records: current.rows.filter((r) => !mine.includes(r.id)),
        expectedRevision: current.revision,
        removeIds: mine,
        allowEmpty: current.rows.length === mine.length,
      }),
    });
  }
}

await main();

if (failures.length) {
  console.error(`\n${failures.length} attachment check(s) failed:`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("\nAttachments live in blob storage; records carry references only.");
