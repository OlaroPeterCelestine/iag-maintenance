/**
 * Attachment security + form upload coverage checks.
 * Run: npx tsx scripts/audit-form-uploads.mts
 */
import assert from "node:assert/strict";
import { entityDefinitions } from "../src/lib/manager-entities.ts";
import {
  isAllowedAttachmentType,
  parseRecordAttachments,
  readFileAsAttachment,
  sanitizeAttachmentFilename,
  sanitizeAttachmentsJson,
} from "../src/lib/record-attachments.ts";

const mustHaveUploads = [
  ["general-requests", "general-requests"],
  ["oral-payment-requests", "oral-payment-requests"],
  ["projects", "payment-requests"],
  ["projects", "requisitions"],
  ["payroll", "leave-requests"],
  ["expense-claims", "expense-claims"],
  ["fleet", "fuel-requests"],
  ["fleet", "trip-requests"],
  ["fleet", "maintenance-requests"],
  ["projects", "equipment-and-vehicle-requests"],
  ["projects", "document-requests"],
] as const;

for (const [mod, key] of mustHaveUploads) {
  const def = entityDefinitions(mod as never).find((d) => d.key === key);
  assert.ok(def, `missing entity ${mod}/${key}`);
  assert.ok(
    def!.fields.some((f) => f.key === "attachments" && f.type === "attachments"),
    `${mod}/${key} missing attachments field`,
  );
}

assert.equal(isAllowedAttachmentType("a.pdf", "application/pdf"), true);
assert.equal(isAllowedAttachmentType("a.svg", "image/svg+xml"), false);
assert.equal(isAllowedAttachmentType("a.html", "text/html"), false);
assert.equal(sanitizeAttachmentFilename("../../etc/passwd.pdf"), "passwd.pdf");

const evil = JSON.stringify([
  {
    id: "1",
    name: "x.svg",
    mime: "image/svg+xml",
    size: 10,
    dataUrl: "data:image/svg+xml;base64,PHN2Zy",
    uploadedAt: "",
  },
]);
assert.equal(sanitizeAttachmentsJson(evil), "");
assert.equal(parseRecordAttachments(evil).length, 0);

// Ensure readFileAsAttachment rejects SVG File-like objects when available.
if (typeof File !== "undefined") {
  const svg = new File(["<svg></svg>"], "x.svg", { type: "image/svg+xml" });
  await assert.rejects(() => readFileAsAttachment(svg));
}

console.log("form-uploads + attachment security: ok");
