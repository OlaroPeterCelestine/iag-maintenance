import type { EmailTemplateRow } from "@/lib/manager-settings";

/**
 * Settings → Email templates for every request type in the app.
 *
 * Placeholders: {{label}} {{reference}} {{business}} {{status}} {{waitingOn}}
 * {{party}} {{amount}} {{originalAmount}} {{amendedAmount}} {{details}} {{summary}}
 * {{actor}} {{recipientRole}} {{comment}}
 *
 * {{amount}} shows "Amended … · Original …" when the figure was revised.
 */
const SHARED_CHAIN =
  "Chain: Requestor → Accounts Assistant → GM → CEO → Finance → Paid";

const OFFICE_CHAIN =
  "Chain: Requestor → Accounts Assistant → GM → CEO → Finance → Paid";

function requestStatusBody(formHint?: string) {
  return `Hello {{recipientRole}},

{{label}} {{reference}} is at {{status}} (waiting on {{waitingOn}}).

Summary: {{summary}}

Reference: {{reference}}
Status: {{status}}
Waiting on: {{waitingOn}}
Party: {{party}}
Amount: {{amount}}

What's being requested:
{{details}}
${formHint ? `\n${formHint}\n` : ""}
Updated by: {{actor}}
{{business}} · FinaceManagerIAG`;
}

export const REQUEST_CHAIN_EMAIL_TEMPLATES: EmailTemplateRow[] = [
  {
    id: "req-submitted",
    name: "Request submitted",
    formType: "Payment requests",
    subject: "{{label}} {{reference}}: {{summary}} — waiting on {{waitingOn}} · {{business}}",
    body: `Hello {{recipientRole}},

{{label}} {{reference}} has been submitted and is waiting on {{waitingOn}}.

Summary: {{summary}}

Reference: {{reference}}
Status: {{status}}
Waiting on: {{waitingOn}}
Party: {{party}}
Amount: {{amount}}

What's being requested:
{{details}}

${SHARED_CHAIN}

Updated by: {{actor}}
{{business}} · FinaceManagerIAG`,
  },
  {
    id: "req-advanced",
    name: "Request advanced",
    formType: "Payment requests",
    subject: "{{label}} {{reference}}: {{summary}} — {{status}} · {{business}}",
    body: `Hello {{recipientRole}},

{{label}} {{reference}} moved to {{status}}.

Summary: {{summary}}

Reference: {{reference}}
Status: {{status}}
Waiting on: {{waitingOn}}
Party: {{party}}
Amount: {{amount}}

What's being requested:
{{details}}

${SHARED_CHAIN}

Updated by: {{actor}}
{{business}} · FinaceManagerIAG`,
  },
  {
    id: "req-rejected",
    name: "Request rejected",
    formType: "Payment requests",
    subject: "{{label}} {{reference}}: {{summary}} was rejected · {{business}}",
    body: `Hello,

{{label}} {{reference}} was rejected and the approval chain has stopped.

Reference: {{reference}}
Party: {{party}}
Amount: {{amount}}
Comment: {{comment}}

What's being requested:
{{details}}

Updated by: {{actor}}
{{business}} · FinaceManagerIAG`,
  },
  {
    id: "req-amended",
    name: "Request returned for amendment",
    formType: "Payment requests",
    subject: "{{label}} {{reference}}: returned for amendment · {{business}}",
    body: `Hello {{recipientRole}},

{{label}} {{reference}} was sent back to {{waitingOn}} for amendment.

Summary: {{summary}}

Reference: {{reference}}
Status: {{status}}
Waiting on: {{waitingOn}}
Party: {{party}}
Amount: {{amount}}
Original amount: {{originalAmount}}
Amended amount: {{amendedAmount}}
Amendment comment: {{comment}}

What's being requested:
{{details}}

Please review the changes and continue the approval chain when ready.

Updated by: {{actor}}
{{business}} · FinaceManagerIAG`,
  },
  {
    id: "req-commented",
    name: "Request comment",
    formType: "Payment requests",
    subject: "{{label}} {{reference}}: new comment · {{business}}",
    body: `Hello {{recipientRole}},

A comment was added on {{label}} {{reference}}.

Comment: {{comment}}

Reference: {{reference}}
Status: {{status}}
Waiting on: {{waitingOn}}
Party: {{party}}
Amount: {{amount}}

What's being requested:
{{details}}

Updated by: {{actor}}
{{business}} · FinaceManagerIAG`,
  },
  {
    id: "req-paid",
    name: "Request paid",
    formType: "Payment requests",
    subject: "{{label}} {{reference}}: {{summary}} marked paid · {{business}}",
    body: `Hello,

{{label}} {{reference}} has completed the chain and is marked Paid.

Reference: {{reference}}
Party: {{party}}
Amount: {{amount}}

What's being requested:
{{details}}

Chain complete: Requestor → Accounts Assistant → GM → CEO → Finance → Paid

Updated by: {{actor}}
{{business}} · FinaceManagerIAG`,
  },
  {
    id: "req-oral",
    name: "Oral payment request",
    formType: "Oral payment requests",
    subject: "{{label}} {{reference}}: {{summary}} — {{status}} · {{business}}",
    body: requestStatusBody(OFFICE_CHAIN),
  },
  {
    id: "req-requisition",
    name: "Material request",
    formType: "Material Requests",
    subject: "{{label}} {{reference}}: {{summary}} — {{status}} · {{business}}",
    body: requestStatusBody(
      "Stores path: Initiator → QS → PM → Stores · Procurement path: Procurement → Finance → GM → CEO → Finance → Follow-up",
    ),
  },
  {
    id: "req-general",
    name: "General request",
    formType: "General requests",
    subject: "{{label}} {{reference}}: {{summary}} — {{status}} · {{business}}",
    body: requestStatusBody(OFFICE_CHAIN),
  },
  {
    id: "req-fuel",
    name: "Fuel request",
    formType: "Fuel requests",
    subject: "{{label}} {{reference}}: {{summary}} — {{status}} · {{business}}",
    body: requestStatusBody(SHARED_CHAIN),
  },
  {
    id: "req-trip",
    name: "Trip request",
    formType: "Trip requests",
    subject: "{{label}} {{reference}}: {{summary}} — {{status}} · {{business}}",
    body: requestStatusBody(SHARED_CHAIN),
  },
  {
    id: "req-maintenance",
    name: "Maintenance request",
    formType: "Maintenance requests",
    subject: "{{label}} {{reference}}: {{summary}} — {{status}} · {{business}}",
    body: requestStatusBody(SHARED_CHAIN),
  },
  {
    id: "req-equipment",
    name: "Equipment / vehicle request",
    formType: "Equipment and vehicle requests",
    subject: "{{label}} {{reference}}: {{summary}} — {{status}} · {{business}}",
    body: requestStatusBody(SHARED_CHAIN),
  },
  {
    id: "req-document",
    name: "Document request",
    formType: "Document requests",
    subject: "{{label}} {{reference}}: {{summary}} — {{status}} · {{business}}",
    body: requestStatusBody(SHARED_CHAIN),
  },
  {
    id: "req-leave",
    name: "Leave request",
    formType: "Leave requests",
    subject: "{{label}} {{reference}}: {{summary}} — {{status}} · {{business}}",
    body: requestStatusBody("Chain: Requestor → HR → General Manager → Approved"),
  },
];
