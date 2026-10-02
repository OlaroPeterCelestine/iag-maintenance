/**
 * Email templates for the shared requisition approval chain:
 * Payment requests: Requestor → Accounts Assistant → GM → CEO → Finance → Paid
 * Oral / general / fleet / equipment / document: same (no PM)
 */
import { getCompanyLetterhead } from "@/lib/export/letterhead";
import { REQUEST_CHAIN_EMAIL_TEMPLATES } from "@/lib/export/request-chain-email-defaults";
import type { ManagerRecord } from "@/lib/manager-entities";
import { parseAmount } from "@/lib/ledger/types";
import {
  materialRequestWaitingOn,
  pathFromRecord,
} from "@/lib/material-request-chain";
import {
  leaveChainProgress,
  leaveChainWaitingOn,
  LEAVE_CHAIN_LABEL,
} from "@/lib/leave-request-chain";
import {
  requisitionChainProgress,
  type RequisitionTrackerStepId,
} from "@/lib/requisition-chain";
import { getCurrentSessionUser } from "@/lib/session-profile";
import type { EmailTemplateRow } from "@/lib/manager-settings";

export type RequestNotifyEvent =
  | "created"
  | "submitted"
  | "advanced"
  | "rejected"
  | "amended"
  | "paid"
  | "commented";

export { REQUEST_CHAIN_EMAIL_TEMPLATES };

const STEP_COLOR: Record<"done" | "current" | "todo", string> = {
  done: "#0d9488",
  current: "#d97706",
  todo: "#94a3b8",
};

function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

function entityLabel(entityKey: string) {
  switch (entityKey) {
    case "payment-requests":
      return "Payment request";
    case "oral-payment-requests":
      return "Oral payment request";
    case "general-requests":
      return "General request";
    case "requisitions":
      return "Material request";
    case "fuel-requests":
      return "Fuel request";
    case "trip-requests":
      return "Trip request";
    case "maintenance-requests":
      return "Maintenance request";
    case "equipment-and-vehicle-requests":
      return "Equipment / vehicle request";
    case "document-requests":
      return "Document request";
    case "leave-requests":
      return "Leave request";
    case "payroll-runs":
      return "Payroll run";
    default:
      return "Request";
  }
}

function templateFor(entityKey: string, event: RequestNotifyEvent): EmailTemplateRow {
  if (event === "rejected") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-rejected")!;
  }
  if (event === "amended") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-amended")!;
  }
  if (event === "commented") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-commented")!;
  }
  if (event === "paid") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-paid")!;
  }
  // Prefer entity-specific templates (including on create/submit).
  if (entityKey === "oral-payment-requests") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-oral")!;
  }
  if (entityKey === "requisitions") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-requisition")!;
  }
  if (entityKey === "general-requests") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-general")!;
  }
  if (entityKey === "fuel-requests") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-fuel")!;
  }
  if (entityKey === "trip-requests") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-trip")!;
  }
  if (entityKey === "maintenance-requests") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-maintenance")!;
  }
  if (entityKey === "equipment-and-vehicle-requests") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-equipment")!;
  }
  if (entityKey === "document-requests") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-document")!;
  }
  if (entityKey === "leave-requests") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-leave")!;
  }
  if (event === "submitted" || event === "created") {
    return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-submitted")!;
  }
  return REQUEST_CHAIN_EMAIL_TEMPLATES.find((t) => t.id === "req-advanced")!;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function chainHtml(status: string, entityKey?: string) {
  const progress =
    entityKey === "leave-requests"
      ? leaveChainProgress(status)
      : requisitionChainProgress(status, entityKey);
  const cells = progress.steps
    .map((step, index) => {
      const tone = step.done ? "done" : step.current ? "current" : "todo";
      const color = STEP_COLOR[tone];
      const weight = step.current || step.done ? "700" : "500";
      const connector =
        index < progress.steps.length - 1
          ? `<td style="width:28px;border-top:2px solid ${
              step.done ? STEP_COLOR.done : STEP_COLOR.todo
            };padding:0;"></td>`
          : "";
      return `<td style="text-align:center;vertical-align:top;padding:0 4px;">
  <div style="width:36px;height:36px;line-height:36px;border-radius:999px;border:2px solid ${color};background:${
    tone === "todo" ? "#f8fafc" : tone === "current" ? "#fffbeb" : "#f0fdfa"
  };color:${color};font-size:12px;font-weight:${weight};margin:0 auto;">${
    step.done ? "✓" : index + 1
  }</div>
  <div style="margin-top:8px;font-size:11px;font-weight:${weight};color:${color};">${step.label}</div>
</td>${connector}`;
    })
    .join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px auto 0;"><tr>${cells}</tr></table>`;
}

type RequestField = { label: string; value: string };

/** Fields that describe what is being requested, per entity type. */
function requestContentFields(
  entityKey: string,
  record: ManagerRecord,
  amountText: string,
): { summary: string; fields: RequestField[] } {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const v = String(record[key] || "").trim();
      if (v) return v;
    }
    return "";
  };
  const add = (fields: RequestField[], label: string, value: string) => {
    const v = value.trim();
    if (v) fields.push({ label, value: v });
  };

  const fields: RequestField[] = [];
  let summary = "";

  switch (entityKey) {
    case "general-requests": {
      summary = pick("subject", "description") || "General request";
      add(fields, "What is needed", pick("subject"));
      add(fields, "Description", pick("description"));
      add(fields, "Category", pick("category"));
      add(fields, "Department", pick("department"));
      add(fields, "Requested by", pick("requestedBy", "createdBy"));
      add(fields, "Priority", pick("priority"));
      add(fields, "Needed by", pick("neededBy"));
      add(fields, "Amount", amountText !== "—" ? amountText : "");
      add(fields, "Notes", pick("notes"));
      break;
    }
    case "oral-payment-requests": {
      summary = pick("purpose", "description", "subject") || "Oral payment";
      add(fields, "Purpose / what for", pick("purpose", "description", "subject"));
      add(fields, "Payee", pick("payee", "contractor"));
      add(fields, "Amount", amountText !== "—" ? amountText : "");
      add(fields, "Requested by", pick("requestedBy", "createdBy"));
      add(fields, "Department", pick("department"));
      add(fields, "Pay from", pick("bankAccount"));
      add(fields, "Priority", pick("priority"));
      add(fields, "Needed by", pick("neededBy"));
      add(fields, "Notes", pick("notes"));
      break;
    }
    case "payment-requests": {
      summary = pick("description", "subject", "purpose") || "IPC payment request";
      add(fields, "Description", pick("description", "subject", "purpose"));
      add(fields, "Pay to / payee", pick("payTo", "payee", "contractor"));
      add(fields, "Amount", amountText !== "—" ? amountText : "");
      add(fields, "Project", pick("project"));
      add(fields, "Phase / milestone", [pick("phase"), pick("milestone")].filter(Boolean).join(" · "));
      add(fields, "Department", pick("department"));
      add(fields, "Requested by", pick("requestedBy", "createdBy"));
      add(fields, "Due date", pick("dueDate"));
      add(fields, "Pay from", pick("bankAccount"));
      add(fields, "Notes", pick("notes"));
      break;
    }
    case "requisitions": {
      summary = pick("description", "subject") || "Material request";
      add(fields, "Materials / items", pick("description", "subject"));
      add(fields, "Fulfillment path", pick("fulfillmentPath", "stockPath"));
      add(fields, "Quantity", [pick("quantity"), pick("unit")].filter(Boolean).join(" "));
      add(fields, "Amount", amountText !== "—" ? amountText : "");
      add(fields, "Project", pick("project"));
      add(fields, "Phase / activity", [pick("phase"), pick("activity")].filter(Boolean).join(" · "));
      add(fields, "Contractor / initiator", pick("contractor", "requestedBy", "createdBy"));
      add(fields, "Date required", pick("neededBy"));
      add(fields, "Notes", pick("notes"));
      break;
    }
    case "fuel-requests": {
      summary = pick("purpose", "description") || "Fuel request";
      add(fields, "Purpose", pick("purpose", "description"));
      add(fields, "Vehicle", pick("vehicle"));
      add(fields, "Driver", pick("driver"));
      add(fields, "Litres", pick("litres"));
      add(fields, "Amount", amountText !== "—" ? amountText : "");
      add(fields, "Department", pick("department"));
      add(fields, "Station", pick("station"));
      add(fields, "Needed by", pick("neededBy"));
      break;
    }
    case "trip-requests": {
      summary =
        [pick("fromLocation"), pick("toLocation")].filter(Boolean).join(" → ") ||
        pick("purpose") ||
        "Trip request";
      add(fields, "Route", [pick("fromLocation"), pick("toLocation")].filter(Boolean).join(" → "));
      add(fields, "Purpose", pick("purpose", "description"));
      add(fields, "Vehicle", pick("vehicle"));
      add(fields, "Driver", pick("driver"));
      add(fields, "Depart", pick("departDate"));
      add(fields, "Return", pick("returnDate"));
      add(fields, "Department", pick("department"));
      break;
    }
    case "maintenance-requests": {
      summary = pick("description", "subject") || "Maintenance request";
      add(fields, "Work needed", pick("description", "subject"));
      add(fields, "Vehicle", pick("vehicle"));
      add(fields, "Requested by", pick("requestedBy", "createdBy"));
      add(fields, "Priority", pick("priority"));
      add(fields, "Needed by", pick("neededBy"));
      add(fields, "Estimated cost", pick("estimatedCost", "amount"));
      add(fields, "Supplier", pick("supplier"));
      break;
    }
    case "equipment-and-vehicle-requests": {
      summary = pick("requestType", "description", "subject") || "Equipment / vehicle request";
      add(fields, "Request type", pick("requestType"));
      add(fields, "Description", pick("description", "subject"));
      add(fields, "Project", pick("project"));
      add(fields, "Requested by", pick("requestedBy", "createdBy"));
      add(fields, "Needed by", pick("neededBy"));
      add(fields, "Notes", pick("notes"));
      break;
    }
    case "document-requests": {
      summary = pick("documentType", "description", "subject") || "Document request";
      add(fields, "Document type", pick("documentType"));
      add(fields, "Description", pick("description", "subject"));
      add(fields, "Project", pick("project"));
      add(fields, "Requested by", pick("requestedBy", "createdBy"));
      add(fields, "Needed by", pick("neededBy"));
      add(fields, "Notes", pick("notes"));
      break;
    }
    case "leave-requests": {
      summary =
        [pick("leaveType"), pick("employee")].filter(Boolean).join(" · ") ||
        "Leave request";
      add(fields, "Employee", pick("employee", "requestedBy"));
      add(fields, "Leave type", pick("leaveType"));
      add(fields, "Start date", pick("startDate"));
      add(fields, "End date", pick("endDate"));
      add(fields, "Days", pick("days"));
      add(fields, "Reason", pick("reason", "notes", "description"));
      break;
    }
    case "payroll-runs": {
      summary = pick("purpose", "reference") || "Payroll run";
      add(fields, "Pay date", pick("date", "payDate"));
      add(fields, "Employees", pick("employeeCount"));
      add(fields, "Default days worked", pick("defaultDays"));
      add(fields, "Gross total", pick("grossTotal"));
      add(fields, "PAYE total", pick("payeTotal"));
      add(fields, "NSSF total", pick("nssfTotal"));
      add(fields, "Net pay total", amountText !== "—" ? amountText : pick("amount"));
      add(fields, "Requested by", pick("requestedBy", "createdBy"));
      add(fields, "Department", pick("department"));
      add(fields, "Notes", pick("purpose", "notes"));
      break;
    }
    default: {
      summary = pick("subject", "purpose", "description") || "Request";
      add(fields, "What is needed", pick("subject", "purpose", "description"));
      add(fields, "Amount", amountText !== "—" ? amountText : "");
      add(fields, "Requested by", pick("requestedBy", "createdBy"));
      add(fields, "Notes", pick("notes"));
    }
  }

  if (!fields.length) {
    add(fields, "What is needed", summary);
  }

  return { summary, fields };
}

function requestFieldsHtml(fields: RequestField[]) {
  const rows = fields
    .map(
      (field) => `<tr>
  <td style="padding:8px 12px;width:140px;color:#64748b;font-size:12px;vertical-align:top;border-bottom:1px solid #e2e8f0;">${escapeHtml(field.label)}</td>
  <td style="padding:8px 12px;color:#0f172a;font-size:13px;font-weight:600;vertical-align:top;border-bottom:1px solid #e2e8f0;white-space:pre-wrap;">${escapeHtml(field.value)}</td>
</tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">${rows}</table>`;
}

function requestFieldsText(fields: RequestField[]) {
  return fields.map((f) => `${f.label}: ${f.value}`).join("\n");
}

export function buildRequestChainEmail(input: {
  entityKey: string;
  record: ManagerRecord;
  event: RequestNotifyEvent;
  recipientRole?: string;
  comment?: string;
  /** When set (e.g. "CEO"), subject is prefixed with Action required. */
  actionRequiredFor?: string;
}): { subject: string; text: string; html: string } {
  const company = getCompanyLetterhead();
  const record = input.record;
  const label = entityLabel(input.entityKey);
  const ref = record.reference || record.code || record.id.slice(0, 8);
  const amount = parseAmount(record.amount || record.total || record.estimatedCost || "0");
  const originalAmount = parseAmount(record.originalAmount || "0");
  const currency = record.currency || company.currency || "UGX";
  const amountText = amount
    ? `${currency} ${amount.toLocaleString()}`
    : "—";
  const originalText =
    record.originalAmount && originalAmount >= 0
      ? `${currency} ${originalAmount.toLocaleString()}`
      : "";
  const revised =
    Boolean(originalText) &&
    record.originalAmount &&
    originalAmount !== amount;
  const amountDisplay = revised
    ? `Amended ${amountText} · Original ${originalText}`
    : amountText;
  const party =
    record.payee ||
    record.contractor ||
    record.requestedBy ||
    record.driver ||
    record.customer ||
    record.supplier ||
    "party";
  const status = record.status || "";
  const leaveWaitingOn =
    input.entityKey === "leave-requests" ? leaveChainWaitingOn(status) : "";
  const progress =
    input.entityKey === "leave-requests"
      ? leaveChainProgress(status)
      : requisitionChainProgress(status, input.entityKey);
  const materialWaitingOn =
    input.entityKey === "requisitions"
      ? materialRequestWaitingOn(status, pathFromRecord(record))
      : "";
  const waitingOn =
    materialWaitingOn || leaveWaitingOn || progress.waitingOn;
  const content = requestContentFields(input.entityKey, record, amountDisplay);
  const detail = content.summary;
  const detailsBlock = requestFieldsText(content.fields);
  const actor =
    getCurrentSessionUser()?.name ||
    getCurrentSessionUser()?.username ||
    "System";
  const comment = (
    input.comment ||
    record.rejectionReason ||
    record.approvalComment ||
    record.amountRevisionNote ||
    record.comment ||
    (input.event === "commented" ? record.notes : "") ||
    ""
  ).trim();

  const vars: Record<string, string> = {
    label,
    reference: ref,
    business: company.businessName || "FinanceIAG",
    status: status || "—",
    waitingOn,
    party,
    amount: amountDisplay,
    originalAmount: originalText || "—",
    amendedAmount: amountText,
    details: detailsBlock || detail,
    summary: detail,
    actor,
    recipientRole: input.recipientRole || "team",
    comment: comment || "—",
    chainLabel:
      input.entityKey === "leave-requests"
        ? LEAVE_CHAIN_LABEL
        : progress.chainLabel || "",
  };

  const tpl = templateFor(input.entityKey, input.event);
  const filledSubject = fill(tpl.subject, vars);
  const actionFor = (input.actionRequiredFor || "").trim();
  const subject =
    actionFor && !/^action required/i.test(filledSubject)
      ? `Action required — ${actionFor}: ${filledSubject}`
      : filledSubject;
  const text = fill(tpl.body, vars);

  const headline =
    input.event === "paid"
      ? `${label} ${ref} marked paid`
      : input.event === "rejected"
        ? `${label} ${ref} was rejected`
        : input.event === "amended"
          ? `${label} ${ref} returned for amendment`
          : input.event === "commented"
            ? `${label} ${ref} — new comment`
            : input.event === "submitted" || input.event === "created"
              ? `${label} ${ref} submitted for approval`
              : `${label} ${ref} — ${status || "updated"}`;

  const commentBlock =
    comment &&
    (input.event === "rejected" ||
      input.event === "amended" ||
      input.event === "commented" ||
      input.event === "advanced" ||
      input.event === "paid")
      ? `<div style="margin-top:16px;padding:12px 14px;background:${
          input.event === "rejected"
            ? "#fff1f2"
            : input.event === "amended"
              ? "#fffbeb"
              : "#f8fafc"
        };border:1px solid ${
          input.event === "rejected"
            ? "#fecdd3"
            : input.event === "amended"
              ? "#fde68a"
              : "#e2e8f0"
        };border-radius:12px;">
  <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;">${
    input.event === "rejected"
      ? "Rejection comment"
      : input.event === "amended"
        ? "Amendment comment"
        : "Approval comment"
  }</div>
  <div style="font-size:13px;line-height:1.5;color:#0f172a;white-space:pre-wrap;">${escapeHtml(comment)}</div>
</div>`
      : "";

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="padding:20px 24px;background:#0f172a;color:#fff;">
            <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.7;">${escapeHtml(company.businessName || "FinanceIAG")}</div>
            <div style="margin-top:6px;font-size:18px;font-weight:700;">${escapeHtml(headline)}</div>
            <div style="margin-top:8px;font-size:14px;line-height:1.4;opacity:0.92;">${escapeHtml(detail)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px 8px;">
            <p style="margin:0 0 12px;font-size:14px;color:#334155;">Hello ${escapeHtml(vars.recipientRole)},</p>
            <table role="presentation" width="100%" style="font-size:13px;color:#334155;">
              <tr><td style="padding:4px 0;width:110px;color:#64748b;">Reference</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(ref)}</td></tr>
              <tr><td style="padding:4px 0;color:#64748b;">Status</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(status || "—")}</td></tr>
              <tr><td style="padding:4px 0;color:#64748b;">Waiting on</td><td style="padding:4px 0;font-weight:600;color:#d97706;">${escapeHtml(waitingOn)}</td></tr>
              <tr><td style="padding:4px 0;color:#64748b;">Party</td><td style="padding:4px 0;">${escapeHtml(party)}</td></tr>
              ${
                revised
                  ? `<tr><td style="padding:4px 0;color:#64748b;">Original amount</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(originalText)}</td></tr>
              <tr><td style="padding:4px 0;color:#64748b;">Amended amount</td><td style="padding:4px 0;font-weight:600;color:#d97706;">${escapeHtml(amountText)}</td></tr>`
                  : `<tr><td style="padding:4px 0;color:#64748b;">Amount</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(amountDisplay)}</td></tr>`
              }
            </table>
            ${commentBlock}
            <div style="margin-top:18px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;">What's being requested</div>
            ${requestFieldsHtml(content.fields)}
          </td>
        </tr>
        <tr>
          <td style="padding:8px 24px 20px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;">Chain of command</div>
            ${chainHtml(status, input.entityKey)}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
            Updated by ${escapeHtml(actor)}. This message was sent automatically by ${escapeHtml(company.businessName || "FinanceIAG")}.
            ${company.email ? ` Reply to ${escapeHtml(company.email)} if you have questions.` : ""}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

/** Expose step ids for tests / docs. */
export const REQUEST_CHAIN_STEP_IDS: RequisitionTrackerStepId[] = [
  "requestor",
  "accounts",
  "gm",
  "ceo",
  "finance",
  "paid",
];
