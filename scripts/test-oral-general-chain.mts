/**
 * FE parity checks for oral + general + payroll-run chains
 * (advance / reject / amend / resubmit / edit lock).
 */
import {
  assertRequisitionChainStatusChange,
  canAdvanceRequisitionStatus,
  canRejectRequisitionStatus,
  canAmendRequisitionStatus,
  requisitionChainWaitingOn,
} from "../src/lib/requisition-chain.ts";
import { canEditRequestChainRecord } from "../src/lib/request-amend-flow.ts";
import { entityDefinitions } from "../src/lib/manager-entities.ts";
import { payrollRunAdvanceActionLabel } from "../src/lib/payroll-run-chain.ts";

const entities = ["oral-payment-requests", "general-requests", "payroll-runs"];
let failed = 0;

function check(name: string, ok: boolean) {
  if (!ok) {
    console.error("FAIL:", name);
    failed++;
  } else {
    console.log("ok:", name);
  }
}

const oral = entityDefinitions("oral-payment-requests").find(
  (d) => d.key === "oral-payment-requests",
);
const payee = oral?.fields.find((f) => f.key === "payee");
check("oral payee required", Boolean(payee?.required));

for (const e of entities) {
  check(
    `${e} Draft→Submitted allowed`,
    assertRequisitionChainStatusChange("Draft", "Submitted", e) === null,
  );
  check(
    `${e} Returned→Submitted allowed`,
    assertRequisitionChainStatusChange("Returned for Amendment", "Submitted", e) ===
      null,
  );
  check(
    `${e} Submitted→AA blocked`,
    assertRequisitionChainStatusChange(
      "Submitted",
      "Accounts Assistant Approved",
      e,
    ) !== null,
  );
  check(
    `${e} Submitted waits Accounts`,
    canAdvanceRequisitionStatus("Submitted", "Accounts Assistant", e).ok,
  );
  check(
    `${e} PM cannot advance Submitted`,
    !canAdvanceRequisitionStatus("Submitted", "Project Manager", e).ok,
  );
  check(
    `${e} AA can reject Submitted`,
    canRejectRequisitionStatus("Submitted", "Accounts Assistant", e),
  );
  check(
    `${e} waiting amend label`,
    requisitionChainWaitingOn("Returned for Amendment", e) ===
      "Requestor (amend & resubmit)",
  );
  check(
    `${e} owner can amend Rejected`,
    canAmendRequisitionStatus(
      "Rejected",
      "Clerk",
      e,
      { createdBy: "alice" },
      { username: "alice" },
    ),
  );
  check(
    `${e} non-owner cannot amend Rejected`,
    !canAmendRequisitionStatus(
      "Rejected",
      "Clerk",
      e,
      { createdBy: "alice" },
      { username: "bob" },
    ),
  );
  check(
    `${e} owner can edit Returned`,
    canEditRequestChainRecord(
      e,
      "Returned for Amendment",
      "Clerk",
      { createdBy: "alice" },
      { username: "alice" },
    ),
  );
  check(
    `${e} non-owner cannot edit Returned`,
    !canEditRequestChainRecord(
      e,
      "Returned for Amendment",
      "Clerk",
      { createdBy: "alice" },
      { username: "bob" },
    ),
  );
  check(
    `${e} owner cannot edit Submitted form`,
    !canEditRequestChainRecord(
      e,
      "Submitted",
      "Clerk",
      { createdBy: "alice" },
      { username: "alice" },
    ),
  );

  const path = [
    "Submitted",
    "Accounts Assistant Approved",
    "GM Approved",
    "CEO Approved",
    "Paid",
  ];
  let status = "Submitted";
  const roles = ["Accounts Assistant", "General Manager", "CEO", "Finance"];
  for (let i = 0; i < roles.length; i++) {
    const gate = canAdvanceRequisitionStatus(status, roles[i], e);
    check(
      `${e} ${roles[i]} → ${path[i + 1]}`,
      Boolean(gate.ok && gate.nextStatus === path[i + 1]),
    );
    status = path[i + 1]!;
  }

  check(
    `${e} Finance cannot reject after CEO`,
    !canRejectRequisitionStatus("CEO Approved", "Finance", e),
  );
  check(
    `${e} Finance cannot amend after CEO`,
    !canAmendRequisitionStatus("CEO Approved", "Finance", e, {
      createdBy: "alice",
    }),
  );
}

check(
  "payroll Release payroll label",
  payrollRunAdvanceActionLabel("CEO Approved") === "Release payroll",
);
check(
  "oral Make payment still advances",
  canAdvanceRequisitionStatus("CEO Approved", "Finance", "oral-payment-requests")
    .ok &&
    !canRejectRequisitionStatus(
      "CEO Approved",
      "Finance",
      "oral-payment-requests",
    ),
);

if (failed) {
  console.error(failed, "failures");
  process.exit(1);
}
console.log("All FE chain checks passed");
