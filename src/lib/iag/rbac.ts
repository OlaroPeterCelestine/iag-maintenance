/**
 * Platform RBAC → this app's RBAC.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 * `appRoleFromClaims` maps a platform identity onto one of the app's role
 * names, and that is enough for most modules — `canAccessModule` derives them
 * from workspace CRUD. But this app's core module is in
 * `EXPLICIT_GRANT_MODULES`:
 *
 *     crm, fleet, logistics, distribution, contract-manager,
 *     qa, production, rnd, lab, benchmark, investments, assets, capital
 *
 * For those, `canAccessModule` returns **false** for everyone who is not an
 * Administrator, unless the role carries an explicit page-matrix grant. Role
 * alone never opens them.
 *
 * The page matrix lives on `RoleRow.pagePermissions`, which the app loads from
 * `GET /api/auth/roles`. Wire the app to the platform without serving that
 * route and every non-admin signs in successfully and lands on an empty
 * workspace — the data plumbing works and the UI shows nothing.
 *
 * ── What this does ──────────────────────────────────────────────────────────
 * Builds the role rows for the signed-in platform identity, granting exactly
 * this app's own modules and nothing else, with a CRUD level derived from the
 * caller's platform permissions.
 *
 * Two properties worth keeping:
 *   - The grant is scoped to this app's modules. A platform user who can reach
 *     the CRM app does not thereby gain payroll or banking here.
 *   - It grants no more than the platform already allows. The owning service
 *     re-checks every call with its own `RequirePerm`, so this layer decides
 *     what to *show*, never what is permitted. If the two disagree the service
 *     wins, and the user sees a 403 rather than data they should not have.
 */
import type { PlatformClaims } from "@/lib/iag/identity";
import { appRoleFromClaims } from "@/lib/iag/identity";

/**
 * The modules this app owns. Must stay in step with `CORE_TABS` /
 * `DEFAULT_ENABLED_TABS` in manager-settings.ts — a module granted here but not
 * enabled there stays hidden, and one enabled there but not granted here opens
 * empty for non-admins.
 */
export const APP_MODULES = ["production"] as const;

/** Always granted alongside the core module — every app enables Documents. */
export const SHARED_MODULES = ["documents"] as const;

/**
 * Platform permission prefixes that indicate the caller works in this app's
 * domain. Matched case-insensitively against `permissions[]` claims, which are
 * Django-style `app_label.action_model` codenames.
 *
 * Read off the services this app actually calls:
 *   iag-mes          `mes.*`         (view_work_order, add_downtime, …)
 *   iag-production   `production.*`  (private remote; still the domain signal)
 */
const DOMAIN_PERMISSION_PREFIXES = [
  "mes.",
  "production.",
];

/** Group names that mean the same thing when permissions are not populated. */
const DOMAIN_GROUPS = [
  "production",
  "mes",
  "factory",
  "plant",
  "maintenance",
];

type Crud = { view: boolean; create: boolean; edit: boolean; delete: boolean };

const ADMIN_ROLES = new Set(["administrator", "super admin"]);

function has(set: Set<string>, ...needles: string[]): boolean {
  for (const needle of needles) if (set.has(needle)) return true;
  return false;
}

function matchesPrefix(permissions: Set<string>, prefixes: string[]): boolean {
  for (const permission of permissions) {
    for (const prefix of prefixes) {
      if (permission.startsWith(prefix)) return true;
    }
  }
  return false;
}

/**
 * Derive workspace CRUD from platform claims.
 *
 * Django codenames carry the verb (`add_`, `change_`, `delete_`, `view_`), and
 * this service's own permissions use `.create` / `.update` / `.delete` /
 * `.read`. Both spellings are checked because the platform mixes them.
 */
export function crudFromClaims(claims: PlatformClaims): Crud {
  if (claims.isSuperuser) {
    return { view: true, create: true, edit: true, delete: true };
  }

  const permissions = new Set(
    claims.permissions.map((p) => p.trim().toLowerCase()),
  );
  const groups = new Set(claims.groups.map((g) => g.trim().toLowerCase()));

  const domain = matchesPrefix(permissions, DOMAIN_PERMISSION_PREFIXES);
  const inDomainGroup = DOMAIN_GROUPS.some((g) => groups.has(g));

  // Admin-ish groups get full CRUD in this app's own modules.
  if (has(groups, "admin", "administrator", "superadmin", "super admin")) {
    return { view: true, create: true, edit: true, delete: true };
  }

  // Only permissions in this app's own domain may raise a verb here.
  //
  // Scanning every codename the caller holds meant an unrelated grant answered
  // for this app: someone with `fleet.add_vehicle` and no warehouse permission
  // at all got Create on stock screens, because the check only ever asked
  // "does any permission contain add_". The service refuses the write, so this
  // was never a privilege escalation — but it offers controls that 403, which
  // is its own kind of wrong.
  const domainPermissions = [...permissions].filter((p) =>
    DOMAIN_PERMISSION_PREFIXES.some((prefix) => p.startsWith(prefix)),
  );
  const verb = (...needles: string[]) =>
    domainPermissions.some((p) => needles.some((n) => p.includes(n)));

  // Someone with no domain signal at all still reads — the service is the gate
  // and will refuse anything they may not see.
  if (!domain && !inDomainGroup) {
    return { view: true, create: false, edit: false, delete: false };
  }

  return {
    view: true,
    create: verb(".create", ".add_", "add_"),
    edit: verb(".update", ".change_", "change_", ".edit"),
    delete: verb(".delete", "delete_"),
  };
}

function flags(crud: Crud) {
  const yes = (on: boolean) => (on ? "Yes" : "No");
  return {
    canView: yes(crud.view),
    canCreate: yes(crud.create),
    canEdit: yes(crud.edit),
    canDelete: yes(crud.delete),
  };
}

/**
 * The role rows `GET /api/auth/roles` returns for a platform session.
 *
 * One row — the caller's own role. The app only ever consults the row matching
 * the signed-in user's role, and returning the full role catalogue would leak
 * the platform's role structure into an app that cannot edit it anyway.
 */
export function roleRowsForClaims(claims: PlatformClaims) {
  const role = appRoleFromClaims(claims);
  const crud = crudFromClaims(claims);
  const isAdmin = ADMIN_ROLES.has(role.toLowerCase()) || claims.isSuperuser;

  // Admins already short-circuit canAccessModule; the grant is harmless and
  // keeps the row consistent for the Settings screens that render the matrix.
  const grant = flags(crud);
  const pagePermissions: Record<string, ReturnType<typeof flags>> = {};
  for (const slug of [...APP_MODULES, ...SHARED_MODULES]) {
    pagePermissions[slug] = grant;
  }

  return [
    {
      id: `platform-${role.toLowerCase().replace(/\s+/g, "-")}`,
      name: role,
      description: `Platform-derived role for ${claims.email || claims.sub}.`,
      ...flags(isAdmin ? { view: true, create: true, edit: true, delete: true } : crud),
      system: true,
      pagePermissions,
    },
  ];
}
