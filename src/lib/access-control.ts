/**
 * Access control / segregation of duties (SoD).
 * Primary model: CRUD (view / create / edit / delete) on roles.
 * Operational permissions and module access are derived from CRUD.
 */
import {
  findSessionUserRow,
  getCurrentSessionUser,
  loadSessionUsers,
} from "@/lib/session-profile";
import { readAuthSession } from "@/lib/auth";
import {
  PAGE_WILDCARD_KEY,
  ROLES_KEY,
  contractorDefaultPagePermissions,
  defaultRoles,
  loadList,
  saveList,
  type RoleRow,
  type UserRow,
} from "@/lib/manager-settings";
import { MODULE_SLUGS, NAV_MODULES, type ModuleSlug } from "@/lib/module-data";
import { entityKey } from "@/lib/manager-entities";
import { canAccessApprovalDesk } from "@/lib/approval-desk";
import { setModuleAccessGate } from "@/lib/access-gate";

export type Permission =
  | "post"
  | "approve"
  | "void"
  | "close-period"
  | "edit-settings"
  | "view-reports"
  | "bank-recon"
  | "payroll"
  | "delete";

/** Built-in role names. Custom roles use free-form names. */
export type AppRole =
  | "Administrator"
  | "Super Admin"
  | "Accountant"
  | "Accounts Assistant"
  | "Quantity Surveyor"
  | "Clerk"
  | "Viewer"
  | "Reviewer"
  | "Approver"
  | "Department Head"
  | "HR"
  | "General Manager"
  | "CEO"
  | "Finance"
  | "Project Manager"
  | "Stores Manager"
  | "Procurement"
  | "Contractor";

export const APP_ROLES: AppRole[] = [
  "Administrator",
  "Super Admin",
  "Quantity Surveyor",
  "Project Manager",
  "Accounts Assistant",
  "Department Head",
  "HR",
  "General Manager",
  "CEO",
  "Finance",
  "Stores Manager",
  "Procurement",
  "Accountant",
  "Contractor",
  "Reviewer",
  "Approver",
  "Clerk",
  "Viewer",
];

export const LOGIN_ROLES: AppRole[] = [
  "Administrator",
  "Super Admin",
  "Quantity Surveyor",
  "Project Manager",
  "Accounts Assistant",
  "Department Head",
  "HR",
  "General Manager",
  "CEO",
  "Finance",
  "Stores Manager",
  "Procurement",
  "Accountant",
  "Contractor",
  "Reviewer",
  "Approver",
  "Clerk",
  "Viewer",
];

export const ALL_PERMISSIONS: Permission[] = [
  "post",
  "approve",
  "void",
  "close-period",
  "edit-settings",
  "view-reports",
  "bank-recon",
  "payroll",
  "delete",
];

export const CRUD_OPS = ["view", "create", "edit", "delete"] as const;
export type CrudOp = (typeof CRUD_OPS)[number];

export const CRUD_LABELS: Record<CrudOp, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  post: "Post journals & documents",
  approve: "Approve documents",
  void: "Void / reverse entries",
  "close-period": "Close accounting periods",
  "edit-settings": "Edit workspace settings",
  "view-reports": "View reports",
  "bank-recon": "Bank reconciliation",
  payroll: "Run payroll",
  delete: "Delete records",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  Administrator: "Full CRUD — view, create, edit, and delete across the workspace.",
  "Super Admin":
    "Full system access — Overview, every module, settings, users, and admin surfaces (same as Administrator).",
  "Quantity Surveyor":
    "Reviews material requests after initiator submit (before Project Manager → Stores).",
  "Project Manager":
    "PM desk — QS-approved material requests on the stores path; owns assigned projects. Payment requests skip this desk (Accounts → GM → CEO).",
  "Accounts Assistant":
    "Accounts desk — first approver on submitted payments / oral / general / fleet / payroll, plus Make payment after CEO (shared with Finance / Accountant).",
  "Department Head": "HOD desk — first approver on leave requests (Requestor → HOD → HR → Approved).",
  HR: "HR desk — final approver on leave requests after HOD (Requestor → HOD → HR → Approved).",
  "General Manager":
    "GM desk — Accounts-approved requests before CEO / Paid.",
  CEO: "CEO desk — only GM-approved requests before Finance makes payment.",
  Finance:
    "Finance desk — Make payment after CEO approval; shared with Accounts Assistant and Accountant.",
  "Stores Manager":
    "Stores desk — issues materials on the stores path after QS → PM.",
  Procurement:
    "Procurement desk — completes follow-up after Finance payment on the low/no-stock material path.",
  Accountant:
    "Accounts desk — same queue as Accounts Assistant, including Make payment after CEO.",
  Contractor:
    "Projects + Contract Manager only — assigned projects, progress certificates, requisitions, and tasks.",
  Reviewer:
    "Legacy notify-only role — no approval desk and no document approve. Prefer Accounts Assistant / GM / CEO / Finance.",
  Approver:
    "Legacy notify-only role — no approval desk and no document approve. Prefer Accounts Assistant / GM / CEO / Finance.",
  Clerk: "View and create day-to-day documents. Cannot edit or delete.",
  Viewer: "View only — reports and inquiry. No create, edit, or delete.",
};

function yes(value: string | undefined, fallback = "No"): boolean {
  return /^yes$/i.test(value || fallback);
}

/**
 * Administrator / Super Admin only — exact names.
 * Do not treat titles containing "admin" (e.g. "HR Admin") as full workspace admins.
 */
export function isAdminRoleName(role: string | null | undefined): boolean {
  const r = String(role || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return r === "administrator" || r === "super admin" || r === "superadmin";
}

/** Exact "Administrator" only (not Super Admin). */
export function isAdministratorOnlyRoleName(role: string | null | undefined): boolean {
  const r = String(role || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return r === "administrator";
}

/** Exact Super Admin (including legacy "superadmin"). */
export function isSuperAdminRoleName(role: string | null | undefined): boolean {
  const r = String(role || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return r === "super admin" || r === "superadmin";
}

/** Signed-in user row bound to this session id (never username cross-match). */
function currentUserRow() {
  if (typeof window === "undefined") return undefined;
  return findSessionUserRow(loadSessionUsers(), readAuthSession());
}

export function currentUserIsAdmin(): boolean {
  if (typeof window === "undefined") return false;
  const session = readAuthSession();
  if (!session) return false;
  const row = currentUserRow();
  // Prefer DB row role; fall back to session only before users hydrate.
  if (row) return isAdminRoleName(row.role);
  return isAdminRoleName(session.role);
}

/** Administrator and Super Admin may delete users. */
export function currentUserCanDeleteUsers(): boolean {
  if (typeof window === "undefined") return false;
  const session = readAuthSession();
  if (!session) return false;
  const row = currentUserRow();
  const role = row?.role || session.role;
  return isAdminRoleName(role);
}

/** Most restrictive CRUD across sources (deny wins). */
function intersectCrud(
  ...sources: Array<Record<CrudOp, boolean> | null | undefined>
): Record<CrudOp, boolean> {
  const list = sources.filter(Boolean) as Record<CrudOp, boolean>[];
  if (!list.length) {
    return { view: false, create: false, edit: false, delete: false };
  }
  return {
    view: list.every((s) => s.view),
    create: list.every((s) => s.create),
    edit: list.every((s) => s.edit),
    delete: list.every((s) => s.delete),
  };
}

export function flagsToCrud(flags: {
  canView?: string;
  canCreate?: string;
  canEdit?: string;
  canDelete?: string;
}): Record<CrudOp, boolean> {
  return {
    // A page override is an explicit grant — an absent canView is not a grant.
    view: yes(flags.canView),
    create: yes(flags.canCreate),
    edit: yes(flags.canEdit),
    delete: yes(flags.canDelete),
  };
}

export function crudToFlags(
  crud: Record<CrudOp, boolean>,
): Pick<UserRow, "canView" | "canCreate" | "canEdit" | "canDelete"> {
  return {
    canView: crud.view ? "Yes" : "No",
    canCreate: crud.create ? "Yes" : "No",
    canEdit: crud.edit ? "Yes" : "No",
    canDelete: crud.delete ? "Yes" : "No",
  };
}

/**
 * Map CRUD → baseline operational permissions.
 * Sensitive ops (approve / void / bank-recon / payroll) are NOT derived from edit alone —
 * see currentUserCan() role allow-lists (SoD).
 */
export function permissionsFromCrud(crud: Record<CrudOp, boolean>): Permission[] {
  const perms = new Set<Permission>();
  if (crud.view) perms.add("view-reports");
  if (crud.create) perms.add("post");
  if (crud.delete) perms.add("delete");
  // Full workspace CRUD (admins / owner roles) unlocks the sensitive set.
  if (crud.view && crud.create && crud.edit && crud.delete) {
    perms.add("close-period");
    perms.add("edit-settings");
    perms.add("payroll");
    perms.add("approve");
    perms.add("void");
    perms.add("bank-recon");
  }
  return ALL_PERMISSIONS.filter((p) => perms.has(p));
}

function currentRoleName(): string {
  if (typeof window === "undefined") return "";
  return (
    currentUserRow()?.role ||
    getCurrentSessionUser()?.role ||
    readAuthSession()?.role ||
    ""
  );
}

/** Role allow-lists for sensitive ops — CRUD alone is not enough. */
function roleGrantsSensitiveOp(role: string, permission: Permission): boolean {
  if (isAdminRoleName(role)) return true;
  const r = (role || "").trim().toLowerCase().replace(/\s+/g, " ");
  switch (permission) {
    case "approve":
      // Payment / leave desks only — chain stage still gates each step.
      return canAccessApprovalDesk(role);
    case "void":
      return (
        r === "finance" ||
        r === "accountant" ||
        r === "accounts assistant" ||
        r === "accounts"
      );
    case "bank-recon":
      // Accountant keeps the cashbook (receipts/payments) but not bank
      // accounts, statements, transfers, or reconciliation (SoD).
      return r === "finance" || r === "accounts assistant" || r === "accounts";
    case "payroll":
      return r === "hr" || r === "human resources" || r === "accountant" || r === "finance";
    default:
      return false;
  }
}

/** True for the Contractor role — gates the contractor portal and its home path. */
export function isContractorRole(role: string | undefined): boolean {
  return String(role || "").trim().toLowerCase() === "contractor";
}

/** Built-in CRUD defaults (used before custom roles load / for login samples). */
export function builtInCrudFlags(role: string): Pick<
  UserRow,
  "canView" | "canCreate" | "canEdit" | "canDelete"
> {
  if (isAdminRoleName(role)) {
    return { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "Yes" };
  }
  switch (role) {
    case "Project Manager":
    case "Accounts Assistant":
    case "Department Head":
    case "HR":
    case "General Manager":
    case "CEO":
    case "Finance":
    case "Accountant":
    case "Quantity Surveyor":
    case "Stores Manager":
    case "Procurement":
    case "Contractor":
      // Edit required for desk / material-chain status advances — approve still role-gated.
      return { canView: "Yes", canCreate: "Yes", canEdit: "Yes", canDelete: "No" };
    case "Reviewer":
    case "Approver":
      // Legacy notify-only — no Edit so they do not inherit ledger approve/void.
      return { canView: "Yes", canCreate: "Yes", canEdit: "No", canDelete: "No" };
    case "Clerk":
      return { canView: "Yes", canCreate: "Yes", canEdit: "No", canDelete: "No" };
    default:
      return { canView: "Yes", canCreate: "No", canEdit: "No", canDelete: "No" };
  }
}

export function loadRoles(): RoleRow[] {
  if (typeof window === "undefined") return defaultRoles;
  const stored = loadList(ROLES_KEY, defaultRoles);
  return ensureSystemRoles(stored);
}


function roleNameOf(role: { name?: unknown } | null | undefined): string {
  return String(role?.name ?? "").trim();
}

function roleNameKey(role: { name?: unknown } | null | undefined): string {
  return roleNameOf(role).toLowerCase();
}

/** Merge missing system roles into stored list. */
export function ensureSystemRoles(roles: RoleRow[]): RoleRow[] {
  const byName = new Map(
    roles.filter((r) => roleNameOf(r)).map((r) => [roleNameKey(r), r]),
  );
  let changed = false;
  const next = [...roles];
  for (const sys of defaultRoles) {
    const key = sys.name.trim().toLowerCase();
    if (!byName.has(key)) {
      // Do not invent roles the API did not return — Postgres is source of truth.
      continue;
    } else {
      const existing = byName.get(key)!;
      if (!existing.system) {
        const idx = next.findIndex((r) => r.id === existing.id);
        if (idx >= 0) {
          next[idx] = { ...existing, system: true };
          changed = true;
        }
      }
      // Refresh system roles whose SoD defaults tightened (legacy / notify-only).
      if (
        key === "approver" ||
        key === "reviewer" ||
        key === "department head" ||
        key === "super admin"
      ) {
        const idx = next.findIndex(
          (r) => roleNameKey(r) === key || r.id === existing.id,
        );
        if (idx >= 0) {
          const row = next[idx]!;
          if (
            row.description !== sys.description ||
            row.canView !== sys.canView ||
            row.canCreate !== sys.canCreate ||
            row.canEdit !== sys.canEdit ||
            row.canDelete !== sys.canDelete
          ) {
            next[idx] = {
              ...row,
              description: sys.description,
              canView: sys.canView,
              canCreate: sys.canCreate,
              canEdit: sys.canEdit,
              canDelete: sys.canDelete,
              system: true,
            };
            changed = true;
          }
        }
      }
      // Contractors are locked to Projects + Contract Manager + profile.
      if (key === "contractor") {
        const idx = next.findIndex(
          (r) => roleNameKey(r) === key || r.id === existing.id,
        );
        if (idx >= 0) {
          const row = next[idx]!;
          const expected = contractorDefaultPagePermissions();
          const current = row.pagePermissions || {};
          const matrixDrift =
            JSON.stringify(current) !== JSON.stringify(expected) ||
            row.description !== sys.description ||
            row.canView !== sys.canView ||
            row.canCreate !== sys.canCreate ||
            row.canEdit !== sys.canEdit ||
            row.canDelete !== sys.canDelete;
          if (matrixDrift) {
            next[idx] = {
              ...row,
              description: sys.description,
              canView: sys.canView,
              canCreate: sys.canCreate,
              canEdit: sys.canEdit,
              canDelete: sys.canDelete,
              system: true,
              pagePermissions: expected,
            };
            changed = true;
          }
        }
      }
      // Several modules became explicit-grant-required (see
      // EXPLICIT_GRANT_MODULES) without a matching page entry for these
      // roles' real, already-in-use access. Merge back just the specific
      // keys each role needs, without touching any other page override an
      // admin has set (e.g. Accountant/AA's existing fleet/investments grant).
      if (
        key === "project manager" ||
        key === "quantity surveyor" ||
        key === "accountant" ||
        key === "accounts assistant" ||
        key === "stores manager" ||
        key === "procurement"
      ) {
        const idx = next.findIndex(
          (r) => roleNameKey(r) === key || r.id === existing.id,
        );
        if (idx >= 0) {
          const row = next[idx]!;
          const expectedGrants = sys.pagePermissions || {};
          let merged: RoleRow["pagePermissions"] | undefined;
          for (const [pageKey, expectedGrant] of Object.entries(expectedGrants)) {
            const currentGrant = row.pagePermissions?.[pageKey];
            if (JSON.stringify(currentGrant) !== JSON.stringify(expectedGrant)) {
              merged = { ...(merged || row.pagePermissions || {}), [pageKey]: expectedGrant };
            }
          }
          if (merged) {
            next[idx] = { ...row, pagePermissions: merged };
            changed = true;
          }
        }
      }
    }
  }
  // Administrators / Superadmins always inherit full access — drop stale page denials.
  for (let i = 0; i < next.length; i++) {
    const role = next[i];
    if (!isAdminRoleName(role.name)) continue;
    const hasDenials =
      role.canView !== "Yes" ||
      role.canCreate !== "Yes" ||
      role.canEdit !== "Yes" ||
      role.canDelete !== "Yes" ||
      (role.pagePermissions && Object.keys(role.pagePermissions).length > 0);
    if (!hasDenials) continue;
    next[i] = {
      ...role,
      canView: "Yes",
      canCreate: "Yes",
      canEdit: "Yes",
      canDelete: "Yes",
      pagePermissions: undefined,
    };
    changed = true;
  }
  // Every role with a page matrix must keep Profile reachable.
  for (let i = 0; i < next.length; i++) {
    const fixed = ensureProfilePagePermission(next[i]!);
    if (fixed !== next[i]) {
      next[i] = fixed;
      changed = true;
    }
  }
  if (changed && typeof window !== "undefined") {
    saveList(ROLES_KEY, next, { persist: false });
  }
  return next;
}

export function saveRoles(roles: RoleRow[], options?: { persist?: boolean }) {
  saveList(ROLES_KEY, roles, options);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
  }
}

export function findRoleByName(name: string, roles?: RoleRow[]): RoleRow | undefined {
  const list = roles ?? loadRoles();
  const key = name.trim().toLowerCase();
  return list.find((r) => roleNameKey(r) === key);
}

export function listRoleNames(roles?: RoleRow[]): string[] {
  return (roles ?? loadRoles()).map((r) => roleNameOf(r)).filter(Boolean);
}

/** CRUD flags for a role name — custom roles from store, else built-in. */
export function crudFlagsForRole(role: string): Pick<
  UserRow,
  "canView" | "canCreate" | "canEdit" | "canDelete"
> {
  const found = typeof window !== "undefined" ? findRoleByName(role) : undefined;
  if (found) {
    return {
      canView: found.canView,
      canCreate: found.canCreate,
      canEdit: found.canEdit,
      canDelete: found.canDelete,
    };
  }
  return builtInCrudFlags(role);
}

export function crudOpsForRole(role: string): Record<CrudOp, boolean> {
  return flagsToCrud(crudFlagsForRole(role));
}

export function currentUserCrud(): Record<CrudOp, boolean> {
  if (typeof window === "undefined") {
    return { view: false, create: false, edit: false, delete: false };
  }
  if (currentUserIsAdmin()) {
    return { view: true, create: true, edit: true, delete: true };
  }
  const session = readAuthSession();
  const user = getCurrentSessionUser();
  const roleName = currentUserRow()?.role || user.role || session?.role || "";
  const fromRole = roleName
    ? crudOpsForRole(roleName)
    : { view: false, create: false, edit: false, delete: false };
  const row = currentUserRow();
  const fromRow = row ? flagsToCrud(row) : null;
  const fromSession =
    session &&
    (session.canView != null ||
      session.canCreate != null ||
      session.canEdit != null ||
      session.canDelete != null)
      ? flagsToCrud({
          canView: session.canView || "No",
          canCreate: session.canCreate || "No",
          canEdit: session.canEdit || "No",
          canDelete: session.canDelete || "No",
        })
      : null;
  // Strict SoD: user flags ∩ role ∩ session — a "No" anywhere denies.
  return intersectCrud(fromRole, fromRow, fromSession);
}

export function currentUserCanCrud(op: CrudOp): boolean {
  return currentUserCrud()[op];
}

/** Pages that can carry their own View / Create / Edit / Delete matrix. */
/** Page key for a module entity tab — used in role pagePermissions. */
export function moduleTabPermissionKey(moduleSlug: string, entityKeyName: string) {
  return `${moduleSlug}/${entityKeyName}`;
}

export const PERMISSION_PAGES: Array<{ key: string; label: string; group: string }> = [
  ...MODULE_SLUGS.filter((slug) => slug !== "requests").map((slug) => ({
    key: slug,
    label: slug
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    group: "Modules",
  })),
  ...NAV_MODULES.flatMap((mod) =>
    mod.items.map((label) => {
      const key = moduleTabPermissionKey(mod.slug, entityKey(label));
      return {
        key,
        label,
        group: `${mod.label} tabs`,
      };
    }),
  ),
  { key: "dashboard", label: "Overview", group: "App" },
  { key: "guides", label: "Guides", group: "App" },
  { key: "qna", label: "Q&A", group: "App" },
  { key: "release-notes", label: "Release notes", group: "App" },
  { key: "templates", label: "Templates", group: "App" },
  { key: "comms", label: "Comms", group: "App" },
  { key: "accounting-documents", label: "Accounting documents", group: "App" },
  { key: "payment-requests", label: "Approval desks", group: "App" },
  // Settings / Users / request-emails / activity-logs are Administrator-only
  // (API requireAdmin) — not matrix-grantable.
  { key: "profile", label: "Profile", group: "App" },
];

/**
 * Modules that must be explicitly granted per role — no implicit fallback to
 * workspace CRUD. These shipped without a dedicated owning role; until an
 * Administrator grants a role explicit access via the page matrix, only
 * Administrator / Super Admin can reach them. Mirrored in the Go backend
 * (explicitGrantModules in role_access.go).
 */
export const EXPLICIT_GRANT_MODULES: ReadonlySet<string> = new Set([
  "rnd",
  "lab",
  "qa",
  "production",
  "benchmark",
  "crm",
  "logistics",
  "distribution",
  "fleet",
  "investments",
  "assets",
  "capital",
  "contract-manager",
]);

/**
 * Whether the current user may see a module entity tab.
 * No override → inherit module access (visible). Set View off on the tab to hide it.
 */
export function canAccessModuleTab(moduleSlug: ModuleSlug, entityKeyName: string): boolean {
  if (typeof window === "undefined") return false;
  if (currentUserIsAdmin()) return true;
  if (!canAccessModule(moduleSlug)) return false;
  // Request tabs stay visible so every user can raise general / oral payment requests.
  if (
    moduleSlug === "requests" ||
    moduleSlug === "general-requests" ||
    moduleSlug === "oral-payment-requests"
  ) {
    return true;
  }
  const key = moduleTabPermissionKey(moduleSlug, entityKeyName);
  const roleName =
    currentUserRow()?.role || getCurrentSessionUser().role || readAuthSession()?.role || "";
  const role = findRoleByName(roleName);
  const override = role?.pagePermissions?.[key];
  // No tab override — the module grant above already covers this tab.
  if (!override) return true;
  return flagsToCrud(override).view;
}

const DENY_ALL_CRUD: Record<CrudOp, boolean> = {
  view: false,
  create: false,
  edit: false,
  delete: false,
};

/** True when pageKey's owning module has no CRUD-derived fallback (see EXPLICIT_GRANT_MODULES). */
function pageKeyRequiresExplicitGrant(pageKey: string): boolean {
  const moduleKey = pageKey.indexOf("/") > 0 ? pageKey.slice(0, pageKey.indexOf("/")) : pageKey;
  return EXPLICIT_GRANT_MODULES.has(moduleKey);
}

/** Resolve CRUD for one page — role override if set, otherwise workspace CRUD. */
export function pageCrudForRole(roleName: string, pageKey: string): Record<CrudOp, boolean> {
  const global = crudOpsForRole(roleName);
  const fallback = pageKeyRequiresExplicitGrant(pageKey) ? DENY_ALL_CRUD : global;
  if (typeof window === "undefined") return applyPageCrudGates(pageKey, fallback, "workspace");
  const role = findRoleByName(roleName);
  const override = role?.pagePermissions?.[pageKey];
  if (!override) {
    // Tab keys inherit a module-level override when the tab itself is not customized.
    const slash = pageKey.indexOf("/");
    if (slash > 0) {
      const moduleKey = pageKey.slice(0, slash);
      const moduleOverride = role?.pagePermissions?.[moduleKey];
      if (moduleOverride) {
        return applyPageCrudGates(pageKey, flagsToCrud(moduleOverride), "override");
      }
    }
    // Allowlist roles fall back to their "*" default instead of workspace CRUD.
    const wildcard = role?.pagePermissions?.[PAGE_WILDCARD_KEY];
    if (wildcard) return applyPageCrudGates(pageKey, flagsToCrud(wildcard), "override");
    return applyPageCrudGates(pageKey, fallback, "workspace");
  }
  return applyPageCrudGates(pageKey, flagsToCrud(override), "override");
}

export function currentUserPageCrud(pageKey: string): Record<CrudOp, boolean> {
  if (typeof window === "undefined") {
    return { view: false, create: false, edit: false, delete: false };
  }
  // Administrators / Superadmins always keep full CRUD on every page.
  if (currentUserIsAdmin()) {
    return { view: true, create: true, edit: true, delete: true };
  }
  const session = readAuthSession();
  const user = getCurrentSessionUser();
  const roleName = currentUserRow()?.role || user.role || session?.role || "";
  const role = findRoleByName(roleName);
  const override = role?.pagePermissions?.[pageKey];
  if (override) {
    // Explicit page matrix replaces workspace CRUD for this page only.
    return applyPageCrudGates(pageKey, flagsToCrud(override), "override");
  }
  // Tab keys (module/entity) fall back to the module page override, then workspace.
  const slash = pageKey.indexOf("/");
  if (slash > 0) {
    const moduleKey = pageKey.slice(0, slash);
    const moduleOverride = role?.pagePermissions?.[moduleKey];
    if (moduleOverride) {
      return applyPageCrudGates(pageKey, flagsToCrud(moduleOverride), "override");
    }
  }
  const wildcard = role?.pagePermissions?.[PAGE_WILDCARD_KEY];
  if (wildcard) return applyPageCrudGates(pageKey, flagsToCrud(wildcard), "override");

  if (pageKeyRequiresExplicitGrant(pageKey)) {
    return applyPageCrudGates(pageKey, DENY_ALL_CRUD, "workspace");
  }

  const workspace = currentUserCrud();
  // User-row Create=No often blocks cashiers whose role still allows posting.
  // For money documents, prefer the role's create/edit when the role grants them.
  if (isMoneyDocumentPageKey(pageKey) && roleName && !workspace.create) {
    const roleOnly = crudOpsForRole(roleName);
    if (roleOnly.view && (roleOnly.create || roleOnly.edit)) {
      return applyPageCrudGates(
        pageKey,
        {
          view: workspace.view || roleOnly.view,
          create: true,
          edit: true,
          delete: workspace.delete,
        },
        "workspace",
      );
    }
  }
  return applyPageCrudGates(pageKey, workspace, "workspace");
}

/**
 * CRUD for a module entity workspace: tab override → module override → workspace.
 * Form create / edit / delete buttons and handlers should use this, not workspace-only ops.
 */
export function currentUserEntityCrud(
  moduleSlug: string,
  entityKeyName?: string,
): Record<CrudOp, boolean> {
  if (entityKeyName) {
    return currentUserPageCrud(moduleTabPermissionKey(moduleSlug, entityKeyName));
  }
  return currentUserPageCrud(moduleSlug);
}

/**
 * Requests (general + oral payment) are open to every role that can view the app:
 * anyone may raise a request as Requestor, and edit/resubmit their own after
 * amendment or rejection. Review/approve still use role gates.
 * Delete remains matrix/workspace-gated.
 */
export function isOpenRequestPageKey(pageKey: string): boolean {
  const key = (pageKey || "").trim().toLowerCase();
  return (
    key === "requests" ||
    key.startsWith("requests:") ||
    key.startsWith("requests/") ||
    key === "general-requests" ||
    key.startsWith("general-requests:") ||
    key.startsWith("general-requests/") ||
    key === "oral-payment-requests" ||
    key.startsWith("oral-payment-requests:") ||
    key.startsWith("oral-payment-requests/") ||
    // Project IPC payment requests + material requests — contractors must be
    // able to raise these even when a role matrix forgot create.
    key === "payment-requests" ||
    key.endsWith("/payment-requests") ||
    key === "requisitions" ||
    key.endsWith("/requisitions")
  );
}

/**
 * Receipts & Payments cashbook — viewing the page means posting money in/out.
 * Explicit page denials (view off) still lock Contractors / Viewers out.
 * Delete stays matrix/workspace-gated.
 */
export function isMoneyDocumentPageKey(pageKey: string): boolean {
  const key = (pageKey || "").trim().toLowerCase();
  return (
    key === "receipts-payments" ||
    key.startsWith("receipts-payments/") ||
    key === "banking/receipts" ||
    key === "banking/payments" ||
    key === "banking/receipt-rules" ||
    key === "banking/payment-rules" ||
    key === "expense-claims" ||
    key.startsWith("expense-claims/")
  );
}

/** @deprecated Use isOpenRequestPageKey */
function isRequestsPageKey(pageKey: string): boolean {
  return isOpenRequestPageKey(pageKey);
}

function withRequestsCreateAccess(
  pageKey: string,
  crud: Record<CrudOp, boolean>,
): Record<CrudOp, boolean> {
  if (!isRequestsPageKey(pageKey)) return crud;
  // Honor explicit page denials (e.g. Contractor locked out of oral/general requests).
  if (!crud.view) return crud;
  return {
    ...crud,
    view: true,
    create: true,
    // Needed so Clerk / Dept Head / etc. can fix Returned for Amendment and resubmit.
    edit: true,
  };
}

function withMoneyDocumentCreateAccess(
  pageKey: string,
  crud: Record<CrudOp, boolean>,
  source: "override" | "workspace",
): Record<CrudOp, boolean> {
  if (!isMoneyDocumentPageKey(pageKey)) return crud;
  // Honor explicit page denials (Contractor / allowlist lockouts).
  if (!crud.view) return crud;
  if (source === "override") {
    // Matrix granted access to the cashbook — posting must work even when the
    // Users page only toggled View and left Create unchecked.
    return { ...crud, create: true, edit: true };
  }
  // Workspace path: if the role can create or edit, ensure both for money docs.
  if (crud.create || crud.edit) {
    return { ...crud, create: true, edit: true };
  }
  return crud;
}

function applyPageCrudGates(
  pageKey: string,
  crud: Record<CrudOp, boolean>,
  source: "override" | "workspace",
): Record<CrudOp, boolean> {
  return withMoneyDocumentCreateAccess(
    pageKey,
    withRequestsCreateAccess(pageKey, crud),
    source,
  );
}

export function currentUserCanPageCrud(pageKey: string, op: CrudOp): boolean {
  return currentUserPageCrud(pageKey)[op];
}

/** Block message when page/entity CRUD denies an action. */
export function assertPageCrud(
  crud: Record<CrudOp, boolean>,
  op: CrudOp,
): string | null {
  if (crud[op]) return null;
  const label = CRUD_LABELS[op].toLowerCase();
  return `Your role cannot ${label} records on this page. Ask an Administrator.`;
}

export function setRolePageCrud(
  role: RoleRow,
  pageKey: string,
  crud: Record<CrudOp, boolean> | null,
): RoleRow {
  // Profile must stay reachable for every role — ignore attempts to deny/clear it.
  if (pageKey === "profile") {
    const pagePermissions = {
      ...(role.pagePermissions || {}),
      profile: { canView: "Yes", canCreate: "No", canEdit: "Yes", canDelete: "No" },
    };
    return { ...role, pagePermissions };
  }
  const pagePermissions = { ...(role.pagePermissions || {}) };
  if (!crud) {
    delete pagePermissions[pageKey];
  } else {
    pagePermissions[pageKey] = crudToFlags(crud);
  }
  return {
    ...role,
    pagePermissions: Object.keys(pagePermissions).length ? pagePermissions : undefined,
  };
}

/** Ensure allowlist roles always keep Profile (view + edit own name/password). */
export function ensureProfilePagePermission(role: RoleRow): RoleRow {
  const pages = role.pagePermissions;
  if (!pages || Object.keys(pages).length === 0) return role;
  const profile = pages.profile;
  if (
    profile &&
    /^yes$/i.test(profile.canView || "") &&
    /^yes$/i.test(profile.canEdit || "")
  ) {
    return role;
  }
  return {
    ...role,
    pagePermissions: {
      ...pages,
      profile: { canView: "Yes", canCreate: "No", canEdit: "Yes", canDelete: "No" },
    },
  };
}

export function permissionsForRole(role: string): Permission[] {
  return permissionsFromCrud(crudOpsForRole(role));
}

export function currentUserCan(permission: Permission): boolean {
  if (typeof window === "undefined") return false;
  if (currentUserIsAdmin()) return true;
  const crud = currentUserCrud();
  if (permissionsFromCrud(crud).includes(permission)) return true;

  // Sensitive ops: role allow-list + matching CRUD floor (never edit-alone).
  const role = currentRoleName();
  switch (permission) {
    case "approve":
      return crud.edit && roleGrantsSensitiveOp(role, "approve");
    case "void":
      return (crud.edit || crud.delete) && roleGrantsSensitiveOp(role, "void");
    case "bank-recon":
      return (
        crud.edit &&
        roleGrantsSensitiveOp(role, "bank-recon") &&
        currentUserPageCrud("banking").view &&
        currentUserPageCrud("reports/bank-reconciliation").view
      );
    case "payroll":
      return crud.create && crud.edit && roleGrantsSensitiveOp(role, "payroll");
    default:
      return false;
  }
}

export function assertPermission(permission: Permission): string | null {
  if (currentUserCan(permission)) return null;
  return `Your role cannot perform “${permission}”. Ask an Administrator.`;
}

/** Maker–checker: poster cannot approve their own document. */
export function assertMakerChecker(createdBy: string | undefined): string | null {
  if (typeof window === "undefined") return null;
  const user = getCurrentSessionUser();
  if (!createdBy) return null;
  if (currentUserIsAdmin()) return null;
  const created = createdBy.trim().toLowerCase();
  const candidates = [user.username, user.id, user.email, user.name]
    .map((s) => (s || "").trim().toLowerCase())
    .filter(Boolean);
  if (candidates.some((c) => c === created)) {
    return "Maker–checker: you cannot approve a document you created.";
  }
  if (!currentUserCan("approve")) {
    return "Your role cannot approve documents.";
  }
  return null;
}

export function listUsersWithRoles(): UserRow[] {
  return loadSessionUsers();
}

export type SpecialNavKey =
  | "dashboard"
  | "guides"
  | "qna"
  | "release-notes"
  | "templates"
  | "comms"
  | "accounting-documents"
  | "payment-requests"
  | "settings"
  | "users"
  | "request-emails"
  | "activity-logs"
  | "crash-analytics"
  | "system-health"
  | "analytics"
  | "profile";

/** All special-nav keys (for audits / sidebar completeness checks). */
export const SPECIAL_NAV_KEYS: readonly SpecialNavKey[] = [
  "dashboard",
  "guides",
  "qna",
  "release-notes",
  "templates",
  "comms",
  "accounting-documents",
  "payment-requests",
  "settings",
  "users",
  "request-emails",
  "activity-logs",
  "crash-analytics",
  "system-health",
  "analytics",
  "profile",
] as const;

/**
 * App routes that are not MODULE_SLUGS and not a SpecialNavKey folder name
 * (dashboard lives at `/`). Used by route↔RBAC gap audits.
 */
export const SPECIAL_APP_ROUTES: readonly string[] = [
  "contractor",
  "contract-manager",
] as const;

/** Surfaces that stay Administrator-only even if pagePermissions say View. */
export const ADMIN_ONLY_SPECIAL_NAV: ReadonlySet<SpecialNavKey> = new Set([
  "settings",
  "users",
  "request-emails",
  "activity-logs",
  "crash-analytics",
  "system-health",
  "analytics",
]);

/** Approval desks are for chain roles only (PM / AA / Accountant / GM / CEO / Finance / HOD / HR) + admin. */
function roleHasApprovalDesk(role: string): boolean {
  return canAccessApprovalDesk(role);
}

/**
 * Module visibility: page override View when set, else CRUD-derived defaults.
 * Administrators / Superadmins always see every module.
 */
/** The signed-in role's page matrix, or null when the role has none. */
function currentRoleMatrix(): NonNullable<RoleRow["pagePermissions"]> | null {
  if (typeof window === "undefined") return null;
  const roleName =
    currentUserRow()?.role || getCurrentSessionUser().role || readAuthSession()?.role || "";
  const pages = findRoleByName(roleName)?.pagePermissions;
  if (!pages || Object.keys(pages).length === 0) return null;
  return pages;
}

/**
 * Resolve one page key against the role matrix. Mirrors resolvePageDecision in
 * the Go page ACL: an explicit entry wins, otherwise the "*" wildcard applies
 * when the role opted into allowlist mode, otherwise the page is unmatched and
 * the caller falls back to workspace CRUD.
 */
function matrixDecision(key: string): Record<CrudOp, boolean> | null {
  const matrix = currentRoleMatrix();
  if (!matrix) return null;
  const override = matrix[key];
  if (override) return flagsToCrud(override);
  const wildcard = matrix[PAGE_WILDCARD_KEY];
  if (wildcard) return flagsToCrud(wildcard);
  return null;
}

export function canAccessModule(slug: ModuleSlug): boolean {
  if (typeof window !== "undefined" && currentUserIsAdmin()) return true;

  const crud = currentUserCrud();

  // Role page matrix wins first (including explicit denials for Contractor).
  const decision = matrixDecision(slug);
  if (decision) return decision.view;

  // These modules have no CRUD-derived fallback — a role must be explicitly
  // granted via the page matrix (or be admin, handled above).
  if (EXPLICIT_GRANT_MODULES.has(slug)) return false;

  // Requests stay open to every role that can view when no page override is set.
  if (
    slug === "requests" ||
    slug === "general-requests" ||
    slug === "oral-payment-requests"
  ) {
    return crud.view;
  }

  if (!crud.view) return false;

  switch (slug) {
    case "payroll":
      return crud.create && crud.edit;
    case "reports":
      return crud.view;
    case "banking":
      return crud.create || crud.edit;
    case "receipts-payments":
    case "expense-claims":
    case "inventory":
    case "pos":
      return crud.create;
    case "sales":
    case "purchases":
      return crud.create || crud.edit;
    case "accounts":
    case "documents":
      return crud.view;
    case "projects":
      // contract-manager, fleet, crm, logistics, distribution, rnd, lab, qa,
      // production, benchmark, investments, assets, capital are handled by
      // the EXPLICIT_GRANT_MODULES check above — never reach this switch.
      return crud.create;
    default:
      return crud.view;
  }
}

export function canAccessSpecialNav(key: SpecialNavKey): boolean {
  // Administrators / Superadmins always see Settings, Users, desks, etc.
  if (typeof window !== "undefined" && currentUserIsAdmin()) return true;

  // Never grant admin surfaces via pagePermissions — API still requireAdmin.
  if (ADMIN_ONLY_SPECIAL_NAV.has(key)) return false;

  // Every signed-in user can open their own profile (name, password) — never
  // lock this behind a page matrix denial.
  if (key === "profile") return true;

  const decision = matrixDecision(key);
  if (decision) return decision.view;

  const crud = currentUserCrud();
  switch (key) {
    case "dashboard":
    case "guides":
    case "qna":
    case "release-notes":
      return crud.view;
    case "templates":
    case "comms":
    case "accounting-documents":
      return crud.view;
    case "payment-requests":
      // Desk roles see the approval queue; every signed-in viewer can open the page
      // to review their own rejected / returned-for-amendment requests.
      return crud.view;
    case "settings":
    case "users":
    case "request-emails":
    case "activity-logs":
    case "crash-analytics":
    case "system-health":
    case "analytics":
      return false;
    default:
      return false;
  }
}

/** Whether the signed-in role may open this app path. */
export function canAccessPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] || "/").replace(/\/$/, "") || "/";
  if (path === "/contractor") {
    const role =
      currentUserRow()?.role || getCurrentSessionUser().role || readAuthSession()?.role || "";
    return isContractorRole(role);
  }
  if (path === "/") return canAccessSpecialNav("dashboard");
  if (path.startsWith("/guides")) return canAccessSpecialNav("guides");
  if (path.startsWith("/qna")) return canAccessSpecialNav("qna");
  if (path.startsWith("/release-notes")) return canAccessSpecialNav("release-notes");
  if (path.startsWith("/profile")) {
    // Own profile is always reachable when a session exists.
    return Boolean(
      currentUserRow() || getCurrentSessionUser()?.id || readAuthSession()?.userId,
    );
  }
  if (path.startsWith("/templates")) return canAccessSpecialNav("templates");
  if (path.startsWith("/comms")) return canAccessSpecialNav("comms");
  if (path.startsWith("/accounting-documents")) {
    return canAccessSpecialNav("accounting-documents");
  }
  if (path.startsWith("/payment-requests")) {
    return canAccessSpecialNav("payment-requests");
  }
  if (path.startsWith("/settings")) return canAccessSpecialNav("settings");
  if (path.startsWith("/users")) return canAccessSpecialNav("users");
  if (path.startsWith("/request-emails")) return canAccessSpecialNav("request-emails");
  if (path.startsWith("/activity-logs")) return canAccessSpecialNav("activity-logs");
  if (path.startsWith("/crash-analytics")) return canAccessSpecialNav("crash-analytics");
  if (path.startsWith("/system-health")) return canAccessSpecialNav("system-health");
  if (path.startsWith("/analytics")) return canAccessSpecialNav("analytics");
  const slug = path.replace(/^\//, "").split("/")[0] || "";
  if ((MODULE_SLUGS as readonly string[]).includes(slug)) {
    return canAccessModule(slug as ModuleSlug);
  }
  // Deny unknown routes by default.
  return false;
}

export function defaultHomePath(): string {
  return "/";
}

// Let db/sync ask about module access without importing this module directly
// (that would cycle through manager-settings).
setModuleAccessGate((moduleSlug, entityKey) => {
  const slug = moduleSlug as ModuleSlug;
  if (!canAccessModule(slug)) return false;
  if (!entityKey) return true;
  return canAccessModuleTab(slug, entityKey);
});

/** Keep ROLE_PERMS for any UI that still lists derived ops by built-in name. */
export const ROLE_PERMS: Record<AppRole, Permission[]> = {
  Administrator: permissionsFromCrud(flagsToCrud(builtInCrudFlags("Administrator"))),
  "Super Admin": permissionsFromCrud(flagsToCrud(builtInCrudFlags("Super Admin"))),
  "Quantity Surveyor": permissionsFromCrud(flagsToCrud(builtInCrudFlags("Quantity Surveyor"))),
  "Project Manager": permissionsFromCrud(flagsToCrud(builtInCrudFlags("Project Manager"))),
  "Accounts Assistant": permissionsFromCrud(flagsToCrud(builtInCrudFlags("Accounts Assistant"))),
  "Department Head": permissionsFromCrud(flagsToCrud(builtInCrudFlags("Department Head"))),
  HR: permissionsFromCrud(flagsToCrud(builtInCrudFlags("HR"))),
  "General Manager": permissionsFromCrud(flagsToCrud(builtInCrudFlags("General Manager"))),
  CEO: permissionsFromCrud(flagsToCrud(builtInCrudFlags("CEO"))),
  Finance: permissionsFromCrud(flagsToCrud(builtInCrudFlags("Finance"))),
  Accountant: permissionsFromCrud(flagsToCrud(builtInCrudFlags("Accountant"))),
  Contractor: permissionsFromCrud(flagsToCrud(builtInCrudFlags("Contractor"))),
  Reviewer: permissionsFromCrud(flagsToCrud(builtInCrudFlags("Reviewer"))),
  Approver: permissionsFromCrud(flagsToCrud(builtInCrudFlags("Approver"))),
  Clerk: permissionsFromCrud(flagsToCrud(builtInCrudFlags("Clerk"))),
  Viewer: permissionsFromCrud(flagsToCrud(builtInCrudFlags("Viewer"))),
  "Stores Manager": permissionsFromCrud(flagsToCrud(builtInCrudFlags("Stores Manager"))),
  Procurement: permissionsFromCrud(flagsToCrud(builtInCrudFlags("Procurement"))),
};
