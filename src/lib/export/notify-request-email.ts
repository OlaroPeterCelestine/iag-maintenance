/**
 * Auto-email parties involved when requests are created or change status.
 * Fire-and-forget — never blocks save / approval.
 */
import { apiFetch } from "@/lib/api-auth";
import { buildRequestChainEmail } from "@/lib/export/request-chain-email-template";
import type { ManagerRecord } from "@/lib/manager-entities";
import {
  materialActionableStage,
  materialRequestWaitingOn,
  materialStageContactRole,
  pathFromRecord,
  roleMatchesMaterialStage,
} from "@/lib/material-request-chain";
import {
  leaveChainStage,
  roleMatchesLeaveStage,
  type LeaveActionableStage,
} from "@/lib/leave-request-chain";
import {
  oralChainStage,
  roleMatchesOralStage,
} from "@/lib/oral-payment-approval-chain";
import {
  paymentChainStage,
  roleMatchesPaymentStage,
} from "@/lib/payment-approval-chain";
import {
  REQUISITION_NO_PM_ENTITIES,
  REQUISITION_STAGE_ROLE,
  requisitionChainStage,
  requisitionIncludesPm,
  roleMatchesRequisitionStage,
  type RequisitionActionableStage,
} from "@/lib/requisition-chain";
import { loadRecords } from "@/lib/records-store";
import {
  DEFAULT_REQUEST_ALERT_EMAIL,
  REQUEST_EMAIL_CONTACTS_KEY,
  USERS_KEY,
  defaultRequestEmailContacts,
  defaultUsers,
  fetchRequestEmailContacts,
  loadEmailSettings,
  loadList,
  mergeRequestEmailContactDefaults,
  saveList,
  type EmailSettings,
  type RequestEmailContact,
  type UserRow,
} from "@/lib/manager-settings";
import { toast } from "@/components/ui/toast";
import {
  popupRequestNotification,
  requestPopupTitleForEvent,
  suppressRequestPopups,
} from "@/lib/request-popup-notifications";

/** Every request form in the app — create / status / reject / notes all email parties. */
export const REQUEST_EMAIL_ENTITIES = new Set([
  "payment-requests",
  "oral-payment-requests",
  "general-requests",
  "requisitions",
  "fuel-requests",
  "trip-requests",
  "maintenance-requests",
  "equipment-and-vehicle-requests",
  "document-requests",
  "leave-requests",
  "payroll-runs",
]);

export type RequestEmailEvent =
  | "created"
  | "submitted"
  | "advanced"
  | "rejected"
  | "amended"
  | "paid"
  | "commented";

function smtpPayload(settings: EmailSettings) {
  const port = Number.parseInt(settings.port || "587", 10);
  return {
    host: settings.host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    username: settings.username,
    password: settings.password,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    replyTo: settings.replyTo,
    useTLS: settings.useTls,
  };
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

/** Gather contact rows that may hold party emails. */
function contactDirectory(): ManagerRecord[] {
  return [
    ...loadRecords("sales", "customers"),
    ...loadRecords("purchases", "suppliers"),
    ...loadRecords("projects", "contractors"),
    ...loadRecords("projects", "project-managers"),
    ...loadRecords("payroll", "employees"),
    ...loadRecords("expense-claims", "employees"),
  ];
}

function emailForName(name: string, directory: ManagerRecord[]): string {
  const needle = normalizeName(name);
  if (!needle) return "";
  if (isEmail(name)) return name.trim();
  const match = directory.find((row) => {
    const candidates = [
      row.name,
      row.company,
      row.customer,
      row.supplier,
      row.contractor,
      row.employee,
      row.party,
      row.fullName,
      row.username,
    ]
      .filter(Boolean)
      .map((v) => normalizeName(String(v)));
    return candidates.includes(needle) && Boolean(row.email);
  });
  return (match?.email || "").trim();
}

type EmailUser = UserRow & { status?: string };

/** Active app users (Users & roles) — preferred alongside Request email contacts. */
function appUsers(): EmailUser[] {
  return loadList<EmailUser>(USERS_KEY, defaultUsers as EmailUser[]);
}

function isActiveUser(user: EmailUser): boolean {
  const status = String(user.status || "Active").trim();
  return !/^(inactive|disabled|suspended|archived|deleted)$/i.test(status);
}

/** Emails for signed-up users whose role matches (skips inactive accounts). */
function userEmailsMatching(predicate: (user: EmailUser) => boolean): string[] {
  return appUsers()
    .filter((user) => isActiveUser(user) && predicate(user) && isEmail(user.email || ""))
    .map((user) => (user.email || "").trim());
}

/**
 * Pull latest Users & roles from the API so chain emails reach real role holders,
 * not only Request email contacts / a stale local list.
 */
async function refreshAppUsersForEmail(): Promise<void> {
  try {
    const { fetchDbUsers } = await import("@/lib/auth-api");
    const users = await fetchDbUsers();
    if (users.length) saveList(USERS_KEY, users, { persist: false });
  } catch {
    /* keep memory / defaults */
  }
}

function partyNames(record: ManagerRecord): string[] {
  return [
    record.payee,
    record.contractor,
    record.requestedBy,
    record.driver,
    record.approver,
    record.customer,
    record.supplier,
    record.party,
    record.employee,
    record.createdBy,
  ]
    .map((v) => (v || "").trim())
    .filter(Boolean);
}

function activeContacts(): RequestEmailContact[] {
  const stored = loadList<RequestEmailContact>(
    REQUEST_EMAIL_CONTACTS_KEY,
    defaultRequestEmailContacts,
  );
  return mergeRequestEmailContactDefaults(stored).filter(
    (row) => row.active !== "No" && isEmail(row.email || ""),
  );
}

function contactRoleMatches(role: string, pattern: RegExp) {
  return pattern.test((role || "").trim());
}

const PAYMENT_STAGE_ROLE = REQUISITION_STAGE_ROLE;

const HR_ROLE = /\bhr\b|human\s*resources?|people\s*ops|people\s*operations|hr\s*manager|hr\s*officer/i;
const QS_ROLE = /quantity\s*surveyor|\bqs\b|qty\s*surveyor/i;
const STORES_ROLE = /stores?\s*manager|store\s*keeper|warehouse\s*manager|inventory\s*manager/i;
const PROCUREMENT_ROLE = /procurement|purchasing|buyer/i;

function contactEmailsMatching(predicate: (row: RequestEmailContact) => boolean): string[] {
  return activeContacts()
    .filter(predicate)
    .map((row) => row.email.trim());
}

/** Every active request-email contact — ensures alerts always have somewhere to go. */
function allActiveContactEmails(): string[] {
  return activeContacts().map((row) => row.email.trim());
}

function emailsForRolePattern(pattern: RegExp): string[] {
  const emails = new Set<string>();
  // 1) Manual Request email contacts for this role
  for (const email of contactEmailsMatching((row) => contactRoleMatches(row.role, pattern))) {
    emails.add(email);
  }
  // 2) Every active app user (Users & roles) whose role matches the stage
  for (const email of userEmailsMatching((user) => pattern.test(user.role || ""))) {
    emails.add(email);
  }
  return [...emails];
}

function emailsForPaymentStages(stages: RequisitionActionableStage[]): string[] {
  const emails = new Set<string>();
  for (const stage of stages) {
    if (stage === "finance") {
      // Whole finance department: Finance + Accounts Assistant + Accountant contacts/users.
      for (const email of emailsForRolePattern(PAYMENT_STAGE_ROLE.finance)) emails.add(email);
      for (const email of emailsForRolePattern(PAYMENT_STAGE_ROLE.accounts)) emails.add(email);
      continue;
    }
    const pattern = PAYMENT_STAGE_ROLE[stage];
    for (const email of emailsForRolePattern(pattern)) emails.add(email);
  }
  return [...emails];
}

/**
 * Every role on this request type's approval line (contacts + matching users).
 * Keeps the full chain looped in — not only the next desk.
 */
function approvalLineEmails(entityKey: string, record: ManagerRecord): string[] {
  const emails = new Set<string>();

  if (entityKey === "leave-requests") {
    for (const email of emailsForRolePattern(HR_ROLE)) emails.add(email);
    for (const email of emailsForPaymentStages(["gm"])) emails.add(email);
    return [...emails];
  }

  if (entityKey === "requisitions") {
    const path = pathFromRecord(record);
    if (path === "stores") {
      for (const email of emailsForRolePattern(QS_ROLE)) emails.add(email);
      for (const email of emailsForPaymentStages(["pm"])) emails.add(email);
      for (const email of emailsForRolePattern(STORES_ROLE)) emails.add(email);
    } else {
      for (const email of emailsForPaymentStages(["accounts", "gm", "ceo", "finance"])) {
        emails.add(email);
      }
      for (const email of emailsForRolePattern(PROCUREMENT_ROLE)) emails.add(email);
    }
    return [...emails];
  }

  const stages: RequisitionActionableStage[] = requisitionIncludesPm(entityKey)
    ? ["pm", "accounts", "gm", "ceo", "finance"]
    : ["accounts", "gm", "ceo", "finance"];
  for (const email of emailsForPaymentStages(stages)) emails.add(email);
  return [...emails];
}

function nextMaterialApproverEmails(record: ManagerRecord): string[] {
  const emails = new Set<string>();
  const stage = materialActionableStage(record.status || "", pathFromRecord(record));
  if (!stage) return [];
  const rolePattern = materialStageContactRole(stage);
  // Contacts + every app user whose role matches this material stage (QS / PM / Stores / …).
  for (const email of emailsForRolePattern(rolePattern)) emails.add(email);
  // Also include users matched via desk helpers (covers role aliases).
  for (const email of userEmailsMatching((user) =>
    roleMatchesMaterialStage(user.role || "", stage),
  )) {
    emails.add(email);
  }
  return [...emails];
}

function nextApproverEmails(entityKey: string, record: ManagerRecord): string[] {
  const emails = new Set<string>();
  const status = record.status || "";

  if (entityKey === "payment-requests") {
    const stage = paymentChainStage(status);
    if (stage === "done" || stage === "rejected" || stage === "unknown" || stage === "requestor") {
      return [];
    }
    const actionable = stage as keyof typeof PAYMENT_STAGE_ROLE;
    if (!(actionable in PAYMENT_STAGE_ROLE)) return [];
    for (const email of emailsForRolePattern(PAYMENT_STAGE_ROLE[actionable])) {
      emails.add(email);
    }
    if (actionable === "finance") {
      for (const email of emailsForRolePattern(PAYMENT_STAGE_ROLE.accounts)) {
        emails.add(email);
      }
    }
    for (const email of userEmailsMatching((user) =>
      roleMatchesPaymentStage(user.role, actionable),
    )) {
      emails.add(email);
    }
    return [...emails];
  }

  if (entityKey === "oral-payment-requests") {
    const stage = oralChainStage(status);
    if (stage === "done" || stage === "rejected" || stage === "unknown" || stage === "requestor") {
      return [];
    }
    const actionable = stage as keyof typeof PAYMENT_STAGE_ROLE;
    if (!(actionable in PAYMENT_STAGE_ROLE)) return [];
    for (const email of emailsForRolePattern(PAYMENT_STAGE_ROLE[actionable])) {
      emails.add(email);
    }
    if (actionable === "finance") {
      for (const email of emailsForRolePattern(PAYMENT_STAGE_ROLE.accounts)) {
        emails.add(email);
      }
    }
    for (const email of userEmailsMatching((user) =>
      roleMatchesOralStage(user.role, actionable),
    )) {
      emails.add(email);
    }
    return [...emails];
  }

  if (entityKey === "requisitions") {
    // Stage-accurate — QS / PM / Stores / Finance / GM / CEO users + contacts.
    return nextMaterialApproverEmails(record);
  }

  if (entityKey === "leave-requests") {
    const stage = leaveChainStage(status);
    if (stage === "done" || stage === "rejected" || stage === "unknown" || stage === "requestor") {
      return [...emails];
    }
    const actionable = stage as LeaveActionableStage;
    const roleRe = actionable === "hr" ? HR_ROLE : PAYMENT_STAGE_ROLE.gm;
    for (const email of emailsForRolePattern(roleRe)) emails.add(email);
    for (const email of userEmailsMatching((user) =>
      roleMatchesLeaveStage(user.role, actionable),
    )) {
      emails.add(email);
    }
    return [...emails];
  }

  if (
    entityKey === "general-requests" ||
    entityKey === "fuel-requests" ||
    entityKey === "trip-requests" ||
    entityKey === "maintenance-requests" ||
    entityKey === "equipment-and-vehicle-requests" ||
    entityKey === "document-requests" ||
    entityKey === "payroll-runs"
  ) {
    const stage = requisitionChainStage(status, entityKey);
    if (stage === "done" || stage === "rejected" || stage === "unknown" || stage === "requestor") {
      // Equipment Issued / Returned still notify PMs so the desk stays informed.
      if (
        entityKey === "equipment-and-vehicle-requests" &&
        /^(issued|returned|approved)$/i.test(status)
      ) {
        for (const email of emailsForRolePattern(PAYMENT_STAGE_ROLE.pm)) emails.add(email);
        for (const email of userEmailsMatching((user) =>
          roleMatchesRequisitionStage(user.role, "pm"),
        )) {
          emails.add(email);
        }
      }
      return [...emails];
    }
    const actionable = stage as keyof typeof PAYMENT_STAGE_ROLE;
    if (!(actionable in PAYMENT_STAGE_ROLE)) return [...emails];
    for (const email of emailsForRolePattern(PAYMENT_STAGE_ROLE[actionable])) {
      emails.add(email);
    }
    if (actionable === "finance") {
      for (const email of emailsForRolePattern(PAYMENT_STAGE_ROLE.accounts)) {
        emails.add(email);
      }
    }
    for (const email of userEmailsMatching((user) =>
      roleMatchesRequisitionStage(user.role, actionable),
    )) {
      emails.add(email);
    }
    return [...emails];
  }
  return [...emails];
}

/** CEO + GM — always CC’d on every request alert. */
function alwaysExecutiveEmails(): string[] {
  const emails = new Set<string>();
  for (const email of contactEmailsMatching((row) =>
    contactRoleMatches(row.role, PAYMENT_STAGE_ROLE.gm),
  )) {
    emails.add(email);
  }
  for (const email of contactEmailsMatching((row) =>
    contactRoleMatches(row.role, PAYMENT_STAGE_ROLE.ceo),
  )) {
    emails.add(email);
  }
  for (const email of userEmailsMatching((user) =>
    PAYMENT_STAGE_ROLE.gm.test(user.role || ""),
  )) {
    emails.add(email);
  }
  for (const email of userEmailsMatching((user) =>
    PAYMENT_STAGE_ROLE.ceo.test(user.role || ""),
  )) {
    emails.add(email);
  }
  return [...emails];
}

/** Person who raised the request (requestedBy / contractor / createdBy / Requestor contact). */
function requestorEmails(record: ManagerRecord): string[] {
  const directory = contactDirectory();
  const users = appUsers();
  const emails = new Set<string>();

  // Material requests use contractor as initiator; equipment uses requestedBy.
  const names = [
    record.requestedBy,
    record.contractor,
    record.createdBy,
    record.initiator,
  ]
    .map((v) => (v || "").trim())
    .filter(Boolean);

  for (const name of names) {
    if (isEmail(name)) {
      emails.add(name.trim());
      continue;
    }
    const fromContact = emailForName(name, directory);
    if (fromContact && isEmail(fromContact)) emails.add(fromContact);
    const fromUser = users.find(
      (user) =>
        isActiveUser(user) &&
        (normalizeName(user.name) === normalizeName(name) ||
          normalizeName(user.username) === normalizeName(name) ||
          normalizeName(user.email || "") === normalizeName(name)),
    );
    if (fromUser?.email && isEmail(fromUser.email)) emails.add(fromUser.email.trim());
  }

  // Configured "Requestor" desk contact — keeps the raiser looped in when names don't resolve.
  for (const email of contactEmailsMatching((row) =>
    /requestor|requester/i.test(row.role || ""),
  )) {
    emails.add(email);
  }

  return [...emails];
}

/** Extra chain contacts (named parties + PM contacts only on PM-chain request types). */
function stakeholderContactEmails(entityKey: string, record: ManagerRecord): string[] {
  const emails = new Set<string>();
  const names = new Set(partyNames(record).map(normalizeName));
  const includePmContacts =
    entityKey !== "leave-requests" &&
    entityKey !== "requisitions" &&
    !REQUISITION_NO_PM_ENTITIES.has(entityKey);

  for (const row of activeContacts()) {
    const role = row.role || "";
    const name = normalizeName(row.name || "");
    if (/project\s*manager/i.test(role)) {
      if (includePmContacts) emails.add(row.email.trim());
      continue;
    }
    if (/contractor/i.test(role)) {
      if (name) {
        if (names.has(name)) emails.add(row.email.trim());
      } else if (record.contractor || record.payee) {
        emails.add(row.email.trim());
      }
    }
    if (name && names.has(name)) emails.add(row.email.trim());
  }
  return [...emails];
}

function resolveRecipients(
  entityKey: string,
  record: ManagerRecord,
  event: RequestEmailEvent,
): string[] {
  const directory = contactDirectory();
  const emails = new Set<string>();

  // 1) Always: CEO + General Manager on every request alert.
  for (const email of alwaysExecutiveEmails()) {
    emails.add(email);
  }

  // 2) Always: the person who requested (plus Requestor desk contact).
  for (const email of requestorEmails(record)) {
    emails.add(email);
  }

  // 3) Other named parties on the record (payee, contractor, etc.).
  const users = appUsers();
  for (const name of partyNames(record)) {
    const fromContact = emailForName(name, directory);
    if (fromContact && isEmail(fromContact)) emails.add(fromContact);
    const fromUser = users.find(
      (user) =>
        isActiveUser(user) &&
        (normalizeName(user.name) === normalizeName(name) ||
          normalizeName(user.username) === normalizeName(name) ||
          normalizeName(user.email || "") === normalizeName(name)),
    );
    if (fromUser?.email && isEmail(fromUser.email)) emails.add(fromUser.email.trim());
  }

  // 4) Next-stage approvers on every live chain step (submit / advance / comment / amend).
  //    After advance the record already has the new status, so this hits who must act next.
  if (
    event === "created" ||
    event === "submitted" ||
    event === "advanced" ||
    event === "amended" ||
    event === "commented"
  ) {
    for (const email of nextApproverEmails(entityKey, record)) {
      emails.add(email);
    }
  }

  // 5) Full approval line for this request type — every role in the chain stays informed
  //    on submit, each advance, reject, amend, paid, and comments.
  if (
    event === "created" ||
    event === "submitted" ||
    event === "advanced" ||
    event === "rejected" ||
    event === "amended" ||
    event === "paid" ||
    event === "commented"
  ) {
    for (const email of approvalLineEmails(entityKey, record)) {
      emails.add(email);
    }
  }

  // 6) Finance department also on paid; reject/comment still reach executives + requestor + line above.
  if (event === "paid") {
    for (const email of emailsForRolePattern(PAYMENT_STAGE_ROLE.finance)) {
      emails.add(email);
    }
    for (const email of emailsForRolePattern(PAYMENT_STAGE_ROLE.accounts)) {
      emails.add(email);
    }
    for (const email of userEmailsMatching((user) =>
      roleMatchesRequisitionStage(user.role || "", "finance"),
    )) {
      emails.add(email);
    }
  }

  for (const email of stakeholderContactEmails(entityKey, record)) {
    emails.add(email);
  }

  if (record.approver) {
    const email = emailForName(record.approver, directory);
    if (email && isEmail(email)) emails.add(email);
  }

  if (!emails.size) {
    // Last resort if CEO/GM/requestor contacts are empty.
    for (const email of allActiveContactEmails()) {
      emails.add(email);
    }
  }

  // Always include the default alert inbox so material / equipment alerts never drop silently.
  if (isEmail(DEFAULT_REQUEST_ALERT_EMAIL)) {
    emails.add(DEFAULT_REQUEST_ALERT_EMAIL.trim());
  }

  return [...emails];
}

async function sendRequestNotificationEmails(input: {
  entityKey: string;
  record: ManagerRecord;
  event: RequestEmailEvent;
  comment?: string;
}): Promise<{ sent: boolean; to: string[]; error?: string }> {
  if (typeof window === "undefined") {
    return { sent: false, to: [], error: "server" };
  }
  if (!REQUEST_EMAIL_ENTITIES.has(input.entityKey)) {
    return { sent: false, to: [] };
  }

  // Refresh contacts + Users & roles so every role holder in the chain gets the alert.
  try {
    await fetchRequestEmailContacts();
  } catch {
    /* keep local list */
  }
  await refreshAppUsersForEmail();

  const settings = loadEmailSettings();
  // Prefer server SMTP on Vercel — client password is often empty.

  const to = resolveRecipients(input.entityKey, input.record, input.event);
  // Always force-include CEO when the next desk is CEO (GM Approved → waiting on CEO).
  const waitingOnCeo =
    input.entityKey !== "leave-requests" &&
    (input.entityKey === "requisitions"
      ? /ceo/i.test(
          materialRequestWaitingOn(
            input.record.status || "",
            pathFromRecord(input.record),
          ),
        )
      : requisitionChainStage(input.record.status || "", input.entityKey) === "ceo");
  const ceoEmails = waitingOnCeo
    ? [
        ...emailsForRolePattern(PAYMENT_STAGE_ROLE.ceo),
        ...userEmailsMatching((user) =>
          roleMatchesRequisitionStage(user.role || "", "ceo"),
        ),
      ]
    : [];
  const recipients: string[] = [];
  const seen = new Set<string>();
  for (const email of [...ceoEmails, ...to]) {
    const trimmed = email.trim();
    const key = trimmed.toLowerCase();
    if (!isEmail(trimmed) || seen.has(key)) continue;
    seen.add(key);
    recipients.push(trimmed);
  }

  if (!recipients.length) {
    return {
      sent: false,
      to: [],
      error: "No party emails found — add contacts under Request emails",
    };
  }

  const copy = buildRequestChainEmail({
    entityKey: input.entityKey,
    record: input.record,
    event: input.event,
    recipientRole: waitingOnCeo ? "CEO" : "team",
    comment: input.comment,
    actionRequiredFor: waitingOnCeo ? "CEO" : undefined,
  });
  try {
    const res = await apiFetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: recipients,
        subject: copy.subject,
        body: copy.html,
        html: true,
        smtp: smtpPayload(settings),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      via?: string;
      error?: { message?: string } | string;
    };
    if (!res.ok || json.ok === false) {
      const errMsg =
        typeof json.error === "string"
          ? json.error
          : json.error?.message || `Email failed (${res.status})`;
      return { sent: false, to: recipients, error: errMsg };
    }
    return { sent: true, to: recipients };
  } catch (err) {
    return {
      sent: false,
      to: recipients,
      error: err instanceof Error ? err.message : "Email request failed",
    };
  }
}

function formatRecipientList(emails: string[]): string {
  if (emails.length <= 2) return emails.join(", ");
  return `${emails.slice(0, 2).join(", ")} +${emails.length - 2} more`;
}

/**
 * Notify involved parties. Safe to call after every request create / status change.
 * Never throws — surfaces failures via toast / console.
 */
export function notifyRequestParties(input: {
  entityKey: string;
  record: ManagerRecord;
  event: RequestEmailEvent;
  previousStatus?: string;
  /** Rejection reason or notes comment included in the email body. */
  comment?: string;
}): void {
  if (typeof window === "undefined") return;
  if (!REQUEST_EMAIL_ENTITIES.has(input.entityKey)) return;

  let event = input.event;
  const status = (input.record.status || "").trim();
  const prev = (input.previousStatus || "").trim();
  const comment = (input.comment || "").trim();

  if (event === "created") {
    if (/^(submitted|pending|awaiting approval)$/i.test(status)) {
      event = "submitted";
    } else if (/^draft$/i.test(status)) {
      // Draft creates stay quiet until submitted.
      return;
    } else if (!status) {
      // Blank status on request forms — treat as submitted so alerts still fire.
      event = "submitted";
    }
  }

  if (event === "advanced") {
    if (/^(paid|complete|completed|settled|issued|follow-up complete|fulfilled)$/i.test(status)) {
      event = "paid";
    }
    if (/^(rejected|declined)$/i.test(status)) event = "rejected";
  }

  if (event === "commented" && !comment && !(input.record.notes || "").trim()) {
    return;
  }

  // Skip no-op status updates.
  if (prev && status && prev.toLowerCase() === status.toLowerCase() && event === "advanced") {
    return;
  }

  // Local actor already gets a success toast on advance/reject; pop on submit and comments.
  // Advanced / paid / rejected / amended still email via Vercel below.
  if (event === "created" || event === "submitted" || event === "commented") {
    const ref = (input.record.reference || input.record.id || "Request").trim();
    const statusLine =
      event === "commented"
        ? `${ref}: ${comment.slice(0, 120) || "comment added"}`
        : status
          ? `${ref} → ${status}`
          : ref;
    popupRequestNotification({
      title: requestPopupTitleForEvent(event),
      description: statusLine,
      tone: event === "commented" ? "info" : "success",
      tag: `request-${input.entityKey}-${input.record.id || ref}-${event}`,
      osWhenHidden: true,
    });
  }
  // Suppress realtime echo so the same browser does not stack duplicate popups.
  suppressRequestPopups(3200);

  void sendRequestNotificationEmails({
    entityKey: input.entityKey,
    record: input.record,
    event,
    comment:
      comment ||
      (event === "rejected" ? (input.record.rejectionReason || "").trim() : "") ||
      (event === "amended" ? (input.record.amendmentReason || "").trim() : "") ||
      (event === "advanced" || event === "paid"
        ? (input.record.approvalComment || input.record.amountRevisionNote || "").trim()
        : "") ||
      (event === "commented" ? (input.record.notes || "").trim() : "") ||
      undefined,
  })
    .then((result) => {
      if (result.sent) {
        const step =
          event === "submitted"
            ? "submitted"
            : event === "advanced"
              ? "advanced"
              : event === "rejected"
                ? "rejected"
                : event === "amended"
                  ? "returned for amendment"
                  : event === "paid"
                    ? "completed"
                    : event === "commented"
                      ? "commented"
                      : "updated";
        toast.add({
          title: "Request alert emailed",
          description: `${step[0]!.toUpperCase()}${step.slice(1)} — sent to ${formatRecipientList(result.to)}`,
          type: "success",
          timeout: 4500,
        });
        return;
      }
      if (result.error) {
        toast.add({
          title: "Request alert not sent",
          description: result.error,
          type: "warning",
          timeout: 5000,
        });
      }
    })
    .catch((err) => {
      toast.add({
        title: "Request alert not sent",
        description: err instanceof Error ? err.message : "Email failed",
        type: "warning",
        timeout: 5000,
      });
    });
}
