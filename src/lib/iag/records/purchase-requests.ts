/**
 * Asking procurement to buy spare parts.
 *
 *   iag-mes          POST /purchase-requests        → create (procurement.requested
 *                                                     on iag.operations, iag-mes#15)
 *   iag-procurement  GET  /requisitions             → the list: requisitions whose
 *                                                     origin is "maintenance"
 *                    GET  /budgets                  → the departments that have a budget
 *
 * The request travels as an event, so a new one appears in the list once
 * procurement has imported it (seconds, normally). Procurement charges it to
 * the department's budget; a department with none is refused there, which is
 * why the department picker offers only departments that have one.
 */
import { GatewayError, gatewayFetch, unwrapList, unwrapOne } from "@/lib/iag/gateway";
import { InputError, isoDate, pick, str, type AppRecord, type RecordAdapter } from "@/lib/iag/records/types";

type Row = Record<string, unknown>;

function withMeta(mapped: Omit<AppRecord, "id"> & { id?: string }, id: string): AppRecord {
  return { ...mapped, id: mapped.id || id, createdAt: mapped.createdAt || "", updatedAt: mapped.updatedAt || mapped.createdAt || "" } as AppRecord;
}

export const purchaseRequests: RecordAdapter = {
  service: "procurement",
  resource: "/api/v1/requisitions (origin maintenance)",

  async list() {
    const rows = unwrapList<Row>(
      await gatewayFetch({ service: "procurement", path: "/api/v1/requisitions", query: { limit: 200 } }),
    );
    return rows
      .filter((r) => str(pick(r, "originSystem", "origin_system")) === "maintenance")
      .map((r) => {
        const ref = str(pick(r, "originRef", "origin_ref"));
        return withMeta(
          {
            id: ref || str(pick(r, "id")),
            reference: ref,
            docNo: str(pick(r, "docNo", "doc_no")),
            date: isoDate(pick(r, "createdAt", "created_at")),
            title: str(pick(r, "title")),
            department: str(pick(r, "dept")),
            requester: str(pick(r, "requester")),
            total: str(pick(r, "total")),
            currency: str(pick(r, "currency")),
            status: str(pick(r, "status")) || "Pending Approval",
            createdAt: str(pick(r, "createdAt", "created_at")),
          },
          ref,
        );
      });
  },

  async create(_ctx, record) {
    const sku = str(record.part).trim();
    const qty = Number(str(record.qty).trim());
    const dept = str(record.department).trim();
    if (!sku) throw new InputError("Pick the spare part.");
    if (!Number.isFinite(qty) || qty <= 0) throw new InputError("Quantity must be more than zero.");
    if (!dept) throw new InputError("Pick the department whose budget pays.");
    const costRaw = str(record.estimatedCost).replace(/,/g, "").trim();
    const cost = costRaw ? Number(costRaw) : undefined;
    if (cost !== undefined && (!Number.isFinite(cost) || cost < 0)) throw new InputError("The estimate is an amount.");
    let row: Row | null;
    try {
      row = unwrapOne<Row>(
        await gatewayFetch({
          service: "mes",
          path: "/api/v1/purchase-requests",
          method: "POST",
          body: {
            sku,
            name: str(record.partName).trim() || undefined,
            qty,
            uom: str(record.unit).trim() || undefined,
            estimated_cost: cost,
            currency: str(record.currency).trim() || "UGX",
            department: dept,
            reason: str(record.reason).trim() || undefined,
            urgent: /^(yes|urgent)$/i.test(str(record.urgent).trim()),
            // Idempotent in procurement: the parts forecast sends one ref per
            // part per shortfall, so asking twice does not order twice.
            ref: str(record.ref).trim() || undefined,
          },
        }),
      );
    } catch (err) {
      if (err instanceof GatewayError && err.status === 404) {
        throw new InputError("MES cannot send purchase requests yet (iag-mes#15 is not deployed).", 503);
      }
      throw err;
    }
    const ref = str(row && pick(row, "ref"));
    return withMeta(
      {
        reference: ref,
        date: isoDate(new Date().toISOString()),
        title: `Spare part ${sku} × ${qty}`,
        department: dept,
        total: cost !== undefined ? String(cost) : "",
        // Procurement imports it from the event; the list shows it once it has.
        status: "Sent to procurement",
      },
      ref,
    );
  },
};

/** Departments that have a procurement budget, for the request's picker. */
export const budgetDepartments: RecordAdapter = {
  service: "procurement",
  resource: "/api/v1/budgets",
  readOnly: true,
  async list() {
    const rows = unwrapList<Row>(await gatewayFetch({ service: "procurement", path: "/api/v1/budgets" }));
    const seen = new Map<string, Row>();
    for (const r of rows) {
      const dept = str(pick(r, "dept")).trim();
      if (dept && !seen.has(dept.toLowerCase())) seen.set(dept.toLowerCase(), r);
    }
    return Array.from(seen.values()).map((r) => {
      const dept = str(pick(r, "dept")).trim();
      return withMeta({ name: dept, code: str(pick(r, "code")), period: str(pick(r, "period")), remaining: str(pick(r, "remaining")) }, dept);
    });
  },
};
