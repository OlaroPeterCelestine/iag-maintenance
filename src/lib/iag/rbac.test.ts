/**
 * Domain prefixes for Production. MES and (when present) production.
 */
import { describe, expect, it } from "vitest";
import { crudFromClaims } from "@/lib/iag/rbac";
import type { PlatformClaims } from "@/lib/iag/identity";

function claims(overrides: Partial<PlatformClaims> = {}): PlatformClaims {
  return {
    sub: "u-1",
    email: "tester@iag.local",
    name: "Tester",
    groups: [],
    permissions: [],
    isStaff: false,
    isSuperuser: false,
    ...overrides,
  } as PlatformClaims;
}

describe("domain permission prefixes", () => {
  it("recognises MES downtime and work-order grants", () => {
    const crud = crudFromClaims(
      claims({ permissions: ["mes.view_downtime", "mes.add_downtime"] }),
    );
    expect(crud.view).toBe(true);
    expect(crud.create).toBe(true);
  });

  it("recognises production run grants", () => {
    const crud = crudFromClaims(
      claims({ permissions: ["production.view_run", "production.change_run"] }),
    );
    expect(crud.edit).toBe(true);
  });

  it("does not let an unrelated app's permission raise a verb here", () => {
    const crud = crudFromClaims(
      claims({ permissions: ["mes.view_work_order", "fleet.add_vehicle"] }),
    );
    expect(crud.create).toBe(false);
  });
});

describe("verb scoping", () => {
  it("gives a superuser everything", () => {
    const crud = crudFromClaims(claims({ isSuperuser: true }));
    expect(crud).toEqual({ view: true, create: true, edit: true, delete: true });
  });
});
