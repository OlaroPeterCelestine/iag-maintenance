/**
 * Regression: confirm dialog must invoke onConfirm even when AlertDialog
 * onOpenChange(false) never fires (FeedbackModals unmounts the host).
 *
 * Run: npx tsx scripts/test-confirm-modal-callback.mts
 */
import assert from "node:assert/strict";

type ConfirmExtras = {
  comment?: string;
  amount?: string;
  paymentMethod?: string;
  bankAccount?: string;
};

/**
 * Mirrors the fixed WarningModal.submitConfirm + onOpenChange interaction.
 */
function runConfirmFlow(options: {
  onOpenChangeFires: boolean;
  validateOk?: boolean;
}): Promise<{ calls: number; extras?: ConfirmExtras }> {
  let calls = 0;
  let lastExtras: ConfirmExtras | undefined;
  const onConfirm = (_note?: string, extras?: ConfirmExtras) => {
    calls += 1;
    lastExtras = extras;
  };

  let confirmed = false;
  let pending: (() => void) | null = null;

  function submitConfirm() {
    if (options.validateOk === false) return;
    const extras: ConfirmExtras = {
      comment: "ok",
      paymentMethod: "Cash",
      bankAccount: "Cash at bank",
    };
    confirmed = true;
    pending = null;
    // parent onClose() unmounts dialog
    queueMicrotask(() => onConfirm("ok", extras));
  }

  function onOpenChange(next: boolean) {
    if (next) return;
    const wasConfirmed = confirmed;
    const leftover = pending;
    confirmed = false;
    pending = null;
    if (wasConfirmed) {
      if (leftover) queueMicrotask(() => leftover());
    }
  }

  submitConfirm();
  if (options.onOpenChangeFires) onOpenChange(false);

  return new Promise((resolve) => {
    queueMicrotask(() => resolve({ calls, extras: lastExtras }));
  });
}

/** Broken pre-fix pattern: only run via onOpenChange pending. */
function runBrokenConfirmFlow(onOpenChangeFires: boolean): Promise<number> {
  let calls = 0;
  const onConfirm = () => {
    calls += 1;
  };
  let confirmed = false;
  let pending: (() => void) | null = null;

  function submitConfirm() {
    confirmed = true;
    pending = () => onConfirm();
    // parent onClose() — no microtask queued here (bug)
  }

  function onOpenChange(next: boolean) {
    if (!next) {
      const wasConfirmed = confirmed;
      const leftover = pending;
      confirmed = false;
      pending = null;
      if (wasConfirmed) queueMicrotask(() => leftover?.());
    }
  }

  submitConfirm();
  if (onOpenChangeFires) onOpenChange(false);

  return new Promise((resolve) => {
    queueMicrotask(() => resolve(calls));
  });
}

const brokenSilent = await runBrokenConfirmFlow(false);
assert.equal(
  brokenSilent,
  0,
  "broken path: unmount without onOpenChange must NOT run (documents the bug)",
);

const brokenOk = await runBrokenConfirmFlow(true);
assert.equal(brokenOk, 1, "broken path still works when onOpenChange fires");

const fixedSilent = await runConfirmFlow({ onOpenChangeFires: false });
assert.equal(
  fixedSilent.calls,
  1,
  "fixed path: Confirm must run even when onOpenChange never fires",
);
assert.equal(fixedSilent.extras?.paymentMethod, "Cash");

const fixedBoth = await runConfirmFlow({ onOpenChangeFires: true });
assert.equal(
  fixedBoth.calls,
  1,
  "fixed path: must not double-fire when onOpenChange also fires",
);

const blocked = await runConfirmFlow({
  onOpenChangeFires: false,
  validateOk: false,
});
assert.equal(blocked.calls, 0, "failed validation must not run onConfirm");

console.log("confirm-modal-callback: ok");
