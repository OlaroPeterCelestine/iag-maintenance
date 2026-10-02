/**
 * Prefetch master lists that SearchablePickers read from memory.
 * Forms open before deferred catalog hydrate finishes — without this,
 * payee / apply-to-bill / inventory pickers show empty hints incorrectly.
 */

import { getMemoryRecords } from "@/lib/db/client-store";
import {
  hydrateEntityFromDatabase,
  hydrateSettingFromDatabase,
} from "@/lib/db/sync";
import {
  FORM_PICKER_SETTINGS_KEYS,
  formPickerRecordKeys,
} from "@/lib/form-picker-keys";
import {
  fetchRequestEmailContacts,
} from "@/lib/manager-settings";
import { REQUEST_EMAIL_ENTITIES } from "@/lib/export/notify-request-email";
import { appToastError } from "@/lib/app-toast";

export { formPickerRecordKeys } from "@/lib/form-picker-keys";

/**
 * Pull picker master data from Postgres into memory, then notify UI.
 * Safe to call repeatedly — overwrites memory from DB (source of truth).
 */
export async function hydrateFormPickerSources(entityKey?: string): Promise<void> {
  if (typeof window === "undefined") return;

  const keys = formPickerRecordKeys(entityKey);
  let failedEmpty = false;
  const chunkSize = 6;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async ({ module, entity }) => {
        try {
          await hydrateEntityFromDatabase(module, entity);
        } catch {
          if (getMemoryRecords(module, entity).length === 0) failedEmpty = true;
        }
      }),
    );
  }

  await Promise.all(
    FORM_PICKER_SETTINGS_KEYS.map((key) =>
      hydrateSettingFromDatabase(key).catch(() => false),
    ),
  );

  if (entityKey && REQUEST_EMAIL_ENTITIES.has(entityKey)) {
    try {
      await fetchRequestEmailContacts();
    } catch {
      failedEmpty = true;
    }
  }

  if (failedEmpty) {
    appToastError("Could not load form options", "Some dropdowns may be empty. Check your connection and reopen the form.");
  }

  window.dispatchEvent(
    new CustomEvent("financeiag-records-changed", {
      detail: { silent: true, reason: "form-picker-hydrate", entity: entityKey },
    }),
  );
  window.dispatchEvent(new CustomEvent("financeiag-settings-changed"));
  window.dispatchEvent(new CustomEvent("financeiag-ledger-changed"));
}

/** Party / AR-AP workbench: masters + open documents for one side. */
export async function hydratePartyLedgerSources(side: "receivable" | "payable"): Promise<void> {
  if (typeof window === "undefined") return;
  const keys =
    side === "receivable"
      ? ([
          { module: "sales", entity: "customers" },
          { module: "sales", entity: "sales-invoices" },
          { module: "sales", entity: "invoices" },
          { module: "sales", entity: "late-payment-fees" },
          { module: "banking", entity: "receipts" },
          { module: "banking", entity: "bank-and-cash-accounts" },
        ] as const)
      : ([
          { module: "purchases", entity: "suppliers" },
          { module: "projects", entity: "contractors" },
          { module: "purchases", entity: "purchase-invoices" },
          { module: "purchases", entity: "bills" },
          { module: "banking", entity: "payments" },
          { module: "banking", entity: "bank-and-cash-accounts" },
        ] as const);

  await Promise.all(
    keys.map(({ module, entity }) =>
      hydrateEntityFromDatabase(module, entity).catch(() => []),
    ),
  );
  window.dispatchEvent(
    new CustomEvent("financeiag-records-changed", {
      detail: { silent: true, reason: "party-ledger-hydrate", side },
    }),
  );
}
