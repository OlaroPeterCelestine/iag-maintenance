/**
 * Lightweight checks for request popup helpers (no jest/vitest in repo).
 * Run: npx tsx scripts/test-request-popups.mts
 */
import assert from "node:assert/strict";
import {
  formatApprovalPopupCopy,
  isRequestPopupEntity,
  requestPopupTitleForEvent,
  REQUEST_POPUP_ENTITIES,
} from "../src/lib/request-popup-notifications.ts";

assert.equal(isRequestPopupEntity("requisitions"), true);
assert.equal(isRequestPopupEntity("payment-requests"), true);
assert.equal(isRequestPopupEntity("equipment-and-vehicle-requests"), true);
assert.equal(isRequestPopupEntity("document-requests"), true);
assert.equal(isRequestPopupEntity("projects"), false);
assert.ok(REQUEST_POPUP_ENTITIES.size >= 8);

assert.equal(requestPopupTitleForEvent("submitted"), "Request submitted");
assert.equal(requestPopupTitleForEvent("advanced"), "Request advanced");
assert.equal(requestPopupTitleForEvent("rejected"), "Request rejected");
assert.equal(requestPopupTitleForEvent("paid"), "Request completed");

const copy = formatApprovalPopupCopy({
  action: "Advanced",
  label: "MAT-001",
  details: "MAT-001 → QS Review · waiting on Quantity Surveyor",
});
assert.equal(copy.title, "Advanced");
assert.match(copy.description, /MAT-001/);

console.log("request-popup-notifications: ok");
