"use client";

import { useAppShell } from "@/components/app-shell";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { PaginationBar } from "@/components/pagination-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePagination } from "@/hooks/use-pagination";
import {
  CRUD_LABELS,
  CRUD_OPS,
  PERMISSION_PAGES,
  assertPermission,
  crudFlagsForRole,
  crudToFlags,
  currentUserCan,
  currentUserCanDeleteUsers,
  currentUserIsAdmin,
  flagsToCrud,
  isOpenRequestPageKey,
  loadRoles,
  pageCrudForRole,
  permissionsFromCrud,
  saveRoles,
  setRolePageCrud,
  type CrudOp,
} from "@/lib/access-control";
import {
  createDbRole,
  createDbUser,
  deleteDbRole,
  deleteDbUser,
  fetchDbRoles,
  fetchDbUsers,
  seedDbAuth,
  updateDbRole,
  updateDbUser,
} from "@/lib/auth-api";
import {
  IDENTITY_MANAGED_ELSEWHERE,
  OWNS_IDENTITY_DIRECTORY,
  identityUsersHref,
} from "@/lib/identity-directory";
import {
  suggestStrongPassword,
  validateStrongPassword,
} from "@/lib/password-strength";
import {
  USERS_KEY,
  defaultRoles,
  defaultUsers,
  loadList,
  saveList,
  type RoleRow,
  type UserRow,
} from "@/lib/manager-settings";
import { NAV_MODULES } from "@/lib/module-data";
import { Add, HambergerMenu, Profile2User, Trash } from "iconsax-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, Fragment, Suspense } from "react";
import { appToastError, appToastSuccess } from "@/lib/app-toast";

function pageLabel(key: string) {
  const fromNav = NAV_MODULES.find((m) => m.slug === key)?.label;
  if (fromNav) return fromNav;
  const fromPages = PERMISSION_PAGES.find((p) => p.key === key);
  if (fromPages) {
    if (key.includes("/")) {
      const mod = NAV_MODULES.find((m) => key.startsWith(`${m.slug}/`));
      return mod ? `${mod.label} · ${fromPages.label}` : fromPages.label;
    }
    return fromPages.label;
  }
  return key;
}

function emptyUser(defaultRole: string): UserRow {
  return {
    id: crypto.randomUUID(),
    name: "",
    username: "",
    email: "",
    role: defaultRole,
    ...crudFlagsForRole(defaultRole),
  };
}

function emptyRole(): RoleRow {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: "",
    canView: "Yes",
    canCreate: "No",
    canEdit: "No",
    canDelete: "No",
    system: false,
  };
}

function CrudToggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium select-none ${
        checked
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-slate-50 text-slate-400"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type="checkbox"
        className="size-3.5 accent-orange-500"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function PageCrudMatrix({
  role,
  onSetPagePermission,
  onClearPagePermission,
  onApplyWorkspace,
  onClearAll,
  readOnly = false,
}: {
  role: RoleRow;
  onSetPagePermission: (pageKey: string, op: CrudOp, allowed: boolean) => void;
  onClearPagePermission: (pageKey: string) => void;
  onApplyWorkspace?: () => void;
  onClearAll?: () => void;
  readOnly?: boolean;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof PERMISSION_PAGES>();
    for (const page of PERMISSION_PAGES) {
      const list = map.get(page.group) || [];
      list.push(page);
      map.set(page.group, list);
    }
    return Array.from(map.entries());
  }, []);

  return (
    <div className="space-y-3">
      {!readOnly && (onApplyWorkspace || onClearAll) ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[13px] font-semibold text-slate-800">
              All page CRUD — {role.name || "Role"}
            </p>
            <p className="text-[11px] text-slate-500">
              View / Create / Edit / Delete for every module and app page. Tab rows use their own
              flags when customized; otherwise they inherit the module override, then workspace
              CRUD.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onApplyWorkspace ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={onApplyWorkspace}
              >
                Apply workspace to all pages
              </Button>
            ) : null}
            {onClearAll ? (
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onClearAll}>
                Clear overrides
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-[12px]">
          <thead className="sticky top-0 bg-slate-50 text-[10px] font-medium tracking-wide text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2.5">Page</th>
              <th className="px-3 py-2.5">Source</th>
              {CRUD_OPS.map((op) => (
                <th key={op} className="px-3 py-2.5 text-center">
                  {CRUD_LABELS[op]}
                </th>
              ))}
              {!readOnly ? <th className="px-3 py-2.5 text-right">Reset</th> : null}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, pages]) => (
              <Fragment key={group}>
                <tr className="border-t border-slate-200 bg-slate-100/70">
                  <td
                    colSpan={readOnly ? 6 : 7}
                    className="px-3 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-slate-500 uppercase"
                  >
                    {group}
                  </td>
                </tr>
                {pages.map((page) => {
                  const hasOverride = Boolean(role.pagePermissions?.[page.key]);
                  const moduleKey =
                    !hasOverride && page.key.includes("/")
                      ? page.key.slice(0, page.key.indexOf("/"))
                      : "";
                  const inheritsModule = Boolean(
                    moduleKey && role.pagePermissions?.[moduleKey],
                  );
                  const pageCrud = pageCrudForRole(role.name, page.key);
                  const openRequest = isOpenRequestPageKey(page.key);
                  const alwaysOwnProfile = page.key === "profile";
                  const sourceLabel = hasOverride
                    ? "Custom"
                    : inheritsModule
                      ? "Module"
                      : "Inherited";
                  return (
                    <tr key={page.key} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {pageLabel(page.key)}
                        <span className="ml-2 font-mono text-[10px] font-normal text-slate-400">
                          {page.key}
                        </span>
                        {openRequest ? (
                          <p className="mt-0.5 text-[10px] font-normal text-slate-400">
                            View / Create / Edit always on (anyone may raise &amp; amend). Only Delete is customizable.
                          </p>
                        ) : null}
                        {alwaysOwnProfile ? (
                          <p className="mt-0.5 text-[10px] font-normal text-slate-400">
                            Always on — every user can open their own profile.
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            alwaysOwnProfile
                              ? "bg-emerald-50 text-emerald-700"
                              : hasOverride
                              ? "bg-orange-50 text-orange-700"
                              : inheritsModule
                                ? "bg-sky-50 text-sky-700"
                                : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {alwaysOwnProfile ? "Always" : sourceLabel}
                        </span>
                      </td>
                      {CRUD_OPS.map((op) => {
                        const lockedOpen =
                          (openRequest && op !== "delete") ||
                          (alwaysOwnProfile && (op === "view" || op === "edit"));
                        const lockedOff = alwaysOwnProfile && (op === "create" || op === "delete");
                        const shown = lockedOff ? false : lockedOpen ? true : pageCrud[op];
                        return (
                          <td key={op} className="px-3 py-2 text-center">
                            {readOnly || lockedOpen || lockedOff ? (
                              <span
                                className={`inline-flex min-w-10 justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                  shown
                                    ? "bg-emerald-50 text-emerald-700"
                                    : "bg-slate-50 text-slate-300"
                                }`}
                                title={
                                  alwaysOwnProfile
                                    ? "Profile stays available for every signed-in user"
                                    : lockedOpen
                                      ? "Always allowed so requestors can submit and amend"
                                      : undefined
                                }
                              >
                                {shown ? "Yes" : "No"}
                              </span>
                            ) : (
                              <input
                                type="checkbox"
                                className="size-3.5 accent-orange-500"
                                checked={pageCrud[op]}
                                onChange={(e) =>
                                  onSetPagePermission(page.key, op, e.target.checked)
                                }
                                aria-label={`${pageLabel(page.key)} ${CRUD_LABELS[op]}`}
                              />
                            )}
                          </td>
                        );
                      })}
                      {!readOnly ? (
                        <td className="px-3 py-2 text-right">
                          {hasOverride ? (
                            <button
                              type="button"
                              className="text-[11px] text-slate-500 hover:text-slate-800"
                              onClick={() => onClearPagePermission(page.key)}
                            >
                              Inherit
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-300">—</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function UsersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-[13px] text-slate-500">
          Loading users & roles…
        </div>
      }
    >
      <UsersPageInner />
    </Suspense>
  );
}

function UsersPageInner() {
  const { openSidebar } = useAppShell();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [ready, setReady] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [canDeleteUsers, setCanDeleteUsers] = useState(false);
  const canMutate = canManage && OWNS_IDENTITY_DIRECTORY;
  const [apiLive, setApiLive] = useState(false);
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [passwordVisible, setPasswordVisible] = useState<Record<string, boolean>>({});
  const [passwordStatus, setPasswordStatus] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState("users");
  const [pagePermRoleId, setPagePermRoleId] = useState<string | null>(null);
  const [permRoleId, setPermRoleId] = useState<string | null>(null);
  const [userPermId, setUserPermId] = useState<string | null>(null);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [assignRoleOpen, setAssignRoleOpen] = useState(false);
  const [assignRoleName, setAssignRoleName] = useState("");
  const [assignUserIds, setAssignUserIds] = useState<string[]>([]);
  const [assigningRole, setAssigningRole] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    username: "",
    email: "",
    role: "Viewer",
    password: "",
  });
  const [newRole, setNewRole] = useState({
    name: "",
    description: "",
    canView: true,
    canCreate: false,
    canEdit: false,
    canDelete: false,
  });

  useEffect(() => {
    queueMicrotask(() => {
      void (async () => {
        const allowed = currentUserIsAdmin() && currentUserCan("edit-settings");
        setCanManage(allowed);
        setCanDeleteUsers(allowed && currentUserCanDeleteUsers());
        if (!allowed) {
          appToastError("Access denied", "Only Administrators can manage users and roles.");
          router.replace("/");
          return;
        }
        try {
          const [dbUsers, dbRoles] = await Promise.all([fetchDbUsers(), fetchDbRoles()]);
          setUsers(dbUsers);
          setRoles(dbRoles);
          setPermRoleId(dbRoles[0]?.id || null);
          saveList(USERS_KEY, dbUsers);
          saveRoles(dbRoles);
          setApiLive(true);
          const status: Record<string, boolean> = {};
          const drafts: Record<string, string> = {};
          const visible: Record<string, boolean> = {};
          for (const u of dbUsers) {
            status[u.id] = Boolean(u.hasPassword);
          }
          setPasswordStatus(status);
          setPasswordDrafts(drafts);
          setPasswordVisible(visible);
        } catch {
          setUsers(loadList<UserRow>(USERS_KEY, []));
          const loaded = loadRoles();
          setRoles(loaded);
          setPermRoleId(loaded[0]?.id || null);
          setApiLive(false);
        }
        setReady(true);
      })();
    });
  }, [router]);

  const roleNames = useMemo(
    () => roles.map((r) => String(r?.name ?? "").trim()).filter(Boolean),
    [roles],
  );

  useEffect(() => {
    if (!ready) return;
    const nextTab = searchParams.get("tab");
    if (nextTab === "users" || nextTab === "roles" || nextTab === "permissions") {
      setTab(nextTab);
    }
    const create = searchParams.get("new");
    if (OWNS_IDENTITY_DIRECTORY && create === "user") {
      setNewUser({
        name: "",
        username: "",
        email: "",
        role: roleNames.includes("Viewer") ? "Viewer" : roleNames[0] || "Viewer",
        password: suggestStrongPassword(),
      });
      setCreateUserOpen(true);
    } else if (OWNS_IDENTITY_DIRECTORY && create === "role") {
      setNewRole({
        name: "",
        description: "",
        canView: true,
        canCreate: false,
        canEdit: false,
        canDelete: false,
      });
      setCreateRoleOpen(true);
    }
  }, [ready, searchParams, roleNames]);

  const usersPager = usePagination(users);
  const rolesPager = usePagination(roles);

  const selectedPermRole = useMemo(
    () => roles.find((r) => r.id === permRoleId) || roles[0] || null,
    [roles, permRoleId],
  );

  /** Clamp a user row so CRUD never exceeds their role. */
  function clampUserToRole(user: UserRow): UserRow {
    const roleCap = flagsToCrud(crudFlagsForRole(user.role));
    const own = flagsToCrud(user);
    return {
      ...user,
      ...crudToFlags({
        view: own.view && roleCap.view,
        create: own.create && roleCap.create,
        edit: own.edit && roleCap.edit,
        delete: own.delete && roleCap.delete,
      }),
    };
  }

  function persistUsers(next: UserRow[]) {
    if (!OWNS_IDENTITY_DIRECTORY) {
      appToastError("Managed in Admin", IDENTITY_MANAGED_ELSEWHERE);
      return;
    }
    const blocked = assertPermission("edit-settings");
    if (blocked) {
      appToastError("Permission denied", blocked);
      return;
    }
    const clamped = next.map(clampUserToRole);
    setUsers(clamped);
    saveList(USERS_KEY, clamped);
    window.dispatchEvent(new CustomEvent("financeiag-records-changed"));
  }

  function persistRoles(next: RoleRow[], syncRoleId?: string) {
    if (!OWNS_IDENTITY_DIRECTORY) {
      appToastError("Managed in Admin", IDENTITY_MANAGED_ELSEWHERE);
      return;
    }
    const blocked = assertPermission("edit-settings");
    if (blocked) {
      appToastError("Permission denied", blocked);
      return;
    }
    setRoles(next);
    saveRoles(next);
    if (apiLive && syncRoleId) {
      const role = next.find((r) => r.id === syncRoleId);
      if (role?.name.trim()) {
        void updateDbRole(role.id, {
          name: role.name,
          description: role.description,
          canView: role.canView,
          canCreate: role.canCreate,
          canEdit: role.canEdit,
          canDelete: role.canDelete,
          pagePermissions: role.pagePermissions,
        }).catch((err) => {
          appToastError("Role sync failed", err instanceof Error ? err.message : "Unknown error");
        });
      }
    }
  }

  function updateUser(id: string, patch: Partial<UserRow>) {
    persistUsers(users.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  async function saveUserCredentials(user: UserRow) {
    if (!apiLive) {
      appToastError("Database unavailable", "The API must be online to save login credentials.");
      return;
    }
    const email = (user.email || `${user.username}@iag.local`).trim().toLowerCase();
    const password = passwordDrafts[user.id]?.trim();
    try {
      const remote = (await fetchDbUsers()).find(
        (u) =>
          u.id === user.id ||
          u.email?.toLowerCase() === email ||
          (user.username && u.username.toLowerCase() === user.username.toLowerCase()),
      );
      if (!remote && !password) {
        appToastError(
          "Password required",
          "New users need a strong password (10+ chars, upper, lower, number, symbol).",
        );
        return;
      }
      if (password) {
        const strengthError = validateStrongPassword(password);
        if (strengthError) {
          appToastError("Weak password", strengthError);
          return;
        }
      }
      if (remote) {
        await updateDbUser(remote.id, {
          email,
          username: user.username,
          name: user.name,
          password: password || undefined,
          role: user.role,
          canView: user.canView,
          canCreate: user.canCreate,
          canEdit: user.canEdit,
          canDelete: user.canDelete,
        });
      } else {
        await createDbUser({
          email,
          username: user.username,
          name: user.name,
          password: password!,
          role: user.role,
        });
      }
      const fresh = await fetchDbUsers();
      persistUsers(fresh);
      const status: Record<string, boolean> = {};
      const drafts: Record<string, string> = { ...passwordDrafts };
      const visible: Record<string, boolean> = { ...passwordVisible };
      for (const u of fresh) {
        status[u.id] = Boolean(u.hasPassword);
      }
      // Never keep plaintext passwords in UI state after save.
      drafts[user.id] = "";
      visible[user.id] = false;
      setPasswordStatus(status);
      setPasswordDrafts(drafts);
      setPasswordVisible(visible);
      appToastSuccess(
        "Saved successfully",
        password
          ? `${user.username || email} password was updated (stored as a hash only).`
          : `${user.username || email} can sign in with their password.`,
      );
    } catch (err) {
      appToastError("Save failed", err instanceof Error ? err.message : "Unknown error");
    }
  }

  function onRoleChange(id: string, role: string) {
    const flags = crudFlagsForRole(role);
    updateUser(id, { role, ...flags });
    if (apiLive) {
      const user = users.find((u) => u.id === id);
      if (user) {
        void updateDbUser(id, {
          email: user.email || `${user.username}@iag.local`,
          username: user.username,
          name: user.name,
          role,
          canView: flags.canView,
          canCreate: flags.canCreate,
          canEdit: flags.canEdit,
          canDelete: flags.canDelete,
        })
          .then(() => {
            appToastSuccess(
              "Permissions applied",
              `${user.username || user.name} now has the ${role} role and its page access.`,
            );
          })
          .catch((err) => {
            appToastError(
              "Role save failed",
              err instanceof Error ? err.message : "Could not save role to the server",
            );
          });
        return;
      }
    }
    appToastSuccess("Role updated", `${role} permissions applied (save password if this is a new user).`);
  }

  function openAssignRoleDialog(roleName?: string) {
    const name =
      roleName ||
      selectedPermRole?.name ||
      roleNames[0] ||
      "";
    setAssignRoleName(name);
    const already = users
      .filter((u) => u.role.trim().toLowerCase() === name.trim().toLowerCase())
      .map((u) => u.id);
    setAssignUserIds(already);
    setAssignRoleOpen(true);
  }

  async function submitAssignRole() {
    const role = assignRoleName.trim();
    if (!role) {
      appToastError("Pick a role");
      return;
    }
    if (!assignUserIds.length) {
      appToastError("Pick at least one user");
      return;
    }
    setAssigningRole(true);
    const flags = crudFlagsForRole(role);
    try {
      const next = users.map((u) =>
        assignUserIds.includes(u.id) ? { ...u, role, ...flags } : u,
      );
      persistUsers(next);
      if (apiLive) {
        const errors: string[] = [];
        for (const id of assignUserIds) {
          const user = next.find((u) => u.id === id);
          if (!user) continue;
          try {
            await updateDbUser(id, {
              email: user.email || `${user.username}@iag.local`,
              username: user.username,
              name: user.name,
              role,
              canView: flags.canView,
              canCreate: flags.canCreate,
              canEdit: flags.canEdit,
              canDelete: flags.canDelete,
            });
          } catch (err) {
            errors.push(user.username || user.name || id);
          }
        }
        if (errors.length) {
          appToastError(
            "Some users failed",
            `Could not save role for: ${errors.join(", ")}`,
          );
        } else {
          appToastSuccess(
            "Permissions given",
            `${assignUserIds.length} user(s) now have the ${role} role.`,
          );
        }
      } else {
        appToastSuccess(
          "Permissions given",
          `${assignUserIds.length} user(s) assigned to ${role}.`,
        );
      }
      setAssignRoleOpen(false);
      setTab("users");
    } finally {
      setAssigningRole(false);
    }
  }

  function addUser() {
    const fallback = roleNames[0] || "Viewer";
    persistUsers([...users, emptyUser(fallback)]);
    appToastSuccess("User added");
  }

  async function removeUser(id: string) {
    if (!canDeleteUsers) {
      appToastError(
        "Delete not allowed",
        "Only Administrator or Super Admin can delete users.",
      );
      return;
    }
    if (users.length <= 1) {
      appToastError("Keep at least one user");
      return;
    }
    if (apiLive) {
      try {
        await deleteDbUser(id);
      } catch (err) {
        appToastError("Delete failed", err instanceof Error ? err.message : "Unknown error");
        return;
      }
    }
    persistUsers(users.filter((u) => u.id !== id));
    appToastSuccess("User removed");
  }

  async function resetSampleUsers() {
    if (apiLive) {
      try {
        await seedDbAuth();
        const fresh = await fetchDbUsers();
        persistUsers(fresh);
        appToastSuccess("Admin account restored");
        return;
      } catch {
        // fall through
      }
    }
    persistUsers(defaultUsers.map((u) => ({ ...u })));
    appToastSuccess("Admin account restored");
  }

  function updateRole(id: string, patch: Partial<RoleRow>) {
    const next = roles.map((r) => (r.id === id ? { ...r, ...patch } : r));
    persistRoles(next, id);

    // Keep assigned users in sync when role CRUD or name changes
    const updated = next.find((r) => r.id === id);
    if (!updated) return;
    const prev = roles.find((r) => r.id === id);
    if (!prev) return;

    const nameChanged = prev.name !== updated.name;
    const crudChanged =
      prev.canView !== updated.canView ||
      prev.canCreate !== updated.canCreate ||
      prev.canEdit !== updated.canEdit ||
      prev.canDelete !== updated.canDelete;

    if (nameChanged || crudChanged) {
      const flags = {
        canView: updated.canView,
        canCreate: updated.canCreate,
        canEdit: updated.canEdit,
        canDelete: updated.canDelete,
      };
      persistUsers(
        users.map((u) => {
          const match =
            u.role.trim().toLowerCase() === prev.name.trim().toLowerCase() ||
            (nameChanged && u.role.trim().toLowerCase() === updated.name.trim().toLowerCase());
          if (!match) return u;
          return {
            ...u,
            role: updated.name || u.role,
            ...flags,
          };
        }),
      );
    }
  }

  function setRoleCrud(id: string, op: CrudOp, allowed: boolean) {
    const role = roles.find((r) => r.id === id);
    if (!role) return;
    const crud = flagsToCrud(role);
    crud[op] = allowed;
    if (op !== "view" && allowed) crud.view = true;
    if (op === "view" && !allowed) {
      crud.create = false;
      crud.edit = false;
      crud.delete = false;
    }
    updateRole(id, crudToFlags(crud));
  }

  function setPagePermission(roleId: string, pageKey: string, op: CrudOp, allowed: boolean) {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    // Request pages: View/Create/Edit stay forced on — only Delete is matrix-editable.
    if (isOpenRequestPageKey(pageKey) && op !== "delete") return;
    const current = pageCrudForRole(role.name, pageKey);
    const next = { ...current, [op]: allowed };
    if (op !== "view" && allowed) next.view = true;
    if (op === "view" && !allowed) {
      next.create = false;
      next.edit = false;
      next.delete = false;
    }
    if (isOpenRequestPageKey(pageKey)) {
      next.view = true;
      next.create = true;
      next.edit = true;
    }
    persistRoles(roles.map((r) => (r.id === roleId ? setRolePageCrud(r, pageKey, next) : r)), roleId);
  }

  function clearPagePermission(roleId: string, pageKey: string) {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    persistRoles(roles.map((r) => (r.id === roleId ? setRolePageCrud(r, pageKey, null) : r)), roleId);
  }

  function applyWorkspaceCrudToAllPages(roleId: string) {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    const workspace = flagsToCrud(role);
    let next = role;
    for (const page of PERMISSION_PAGES) {
      const crud = isOpenRequestPageKey(page.key)
        ? { ...workspace, view: true, create: true, edit: true }
        : { ...workspace };
      next = setRolePageCrud(next, page.key, crud);
    }
    persistRoles(roles.map((r) => (r.id === roleId ? next : r)), roleId);
    appToastSuccess("Applied workspace CRUD to every page");
  }

  function clearAllPagePermissions(roleId: string) {
    const role = roles.find((r) => r.id === roleId);
    if (!role) return;
    persistRoles(
      roles.map((r) =>
        r.id === roleId ? { ...r, pagePermissions: undefined } : r,
      ),
      roleId,
    );
    appToastSuccess("Page overrides cleared — pages inherit workspace CRUD");
  }

  async function addRole() {
    const created = emptyRole();
    if (apiLive) {
      try {
        const saved = await createDbRole({
          name: created.name || `Custom role ${roles.length + 1}`,
          description: created.description,
          canView: created.canView,
          canCreate: created.canCreate,
          canEdit: created.canEdit,
          canDelete: created.canDelete,
        });
        const next = [...roles, saved];
        setRoles(next);
        saveRoles(next);
        setPermRoleId(saved.id);
        setPagePermRoleId(saved.id);
        setTab("permissions");
        appToastSuccess("Custom role added — set page CRUD below");
        return;
      } catch (err) {
        appToastError("Create role failed", err instanceof Error ? err.message : "Unknown error");
        return;
      }
    }
    persistRoles([...roles, created]);
    setPermRoleId(created.id);
    setPagePermRoleId(created.id);
    setTab("permissions");
    appToastSuccess("Custom role added — set page CRUD below");
  }

  function openCreateUserDialog() {
    setNewUser({
      name: "",
      username: "",
      email: "",
      role: roleNames.includes("Viewer") ? "Viewer" : roleNames[0] || "Viewer",
      password: suggestStrongPassword(),
    });
    setCreateUserOpen(true);
  }

  function openCreateRoleDialog() {
    setNewRole({
      name: "",
      description: "",
      canView: true,
      canCreate: false,
      canEdit: false,
      canDelete: false,
    });
    setCreateRoleOpen(true);
  }

  async function submitCreateUser() {
    const name = newUser.name.trim();
    const username = newUser.username.trim();
    const email = (newUser.email.trim() || `${username}@iag.local`).toLowerCase();
    const role = newUser.role.trim() || roleNames[0] || "Viewer";
    const password = newUser.password.trim();
    if (!name || !username) {
      appToastError("Missing fields", "Name and username are required.");
      return;
    }
    if (!password) {
      appToastError("Password required", "New users need a strong password.");
      return;
    }
    const strengthError = validateStrongPassword(password);
    if (strengthError) {
      appToastError("Weak password", strengthError);
      return;
    }
    setCreatingUser(true);
    try {
      if (apiLive) {
        await createDbUser({
          email,
          username,
          name,
          password,
          role,
        });
        const fresh = await fetchDbUsers();
        persistUsers(fresh);
        const status: Record<string, boolean> = {};
        for (const u of fresh) status[u.id] = Boolean(u.hasPassword);
        setPasswordStatus(status);
      } else {
        const row: UserRow = {
          ...emptyUser(role),
          name,
          username,
          email,
          role,
          ...crudFlagsForRole(role),
        };
        persistUsers([...users, row]);
        setPasswordDrafts((prev) => ({ ...prev, [row.id]: password }));
      }
      setCreateUserOpen(false);
      setTab("users");
      appToastSuccess("User created", `${username} can sign in with the password you set.`);
    } catch (err) {
      appToastError("Create user failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreatingUser(false);
    }
  }

  async function submitCreateRole() {
    const name = newRole.name.trim();
    if (!name) {
      appToastError("Role name required");
      return;
    }
    if (roles.some((r) => String(r?.name ?? "").trim().toLowerCase() === name.toLowerCase())) {
      appToastError("Role exists", "Choose a different role name.");
      return;
    }
    setCreatingRole(true);
    const payload = {
      name,
      description: newRole.description.trim(),
      canView: newRole.canView ? "Yes" : "No",
      canCreate: newRole.canCreate ? "Yes" : "No",
      canEdit: newRole.canEdit ? "Yes" : "No",
      canDelete: newRole.canDelete ? "Yes" : "No",
    };
    try {
      if (apiLive) {
        const saved = await createDbRole(payload);
        const next = [...roles, saved];
        setRoles(next);
        saveRoles(next);
        setPermRoleId(saved.id);
        setPagePermRoleId(saved.id);
      } else {
        const created: RoleRow = {
          ...emptyRole(),
          ...payload,
          system: false,
        };
        persistRoles([...roles, created]);
        setPermRoleId(created.id);
        setPagePermRoleId(created.id);
      }
      setCreateRoleOpen(false);
      setTab("permissions");
      appToastSuccess("Role created", "Set page permissions for this role next.");
    } catch (err) {
      appToastError("Create role failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setCreatingRole(false);
    }
  }

  async function removeRole(id: string) {
    const role = roles.find((r) => r.id === id);
    if (!role) return;
    if (role.system) {
      appToastError("Built-in roles cannot be deleted");
      return;
    }
    if (!role.name.trim()) {
      persistRoles(roles.filter((r) => r.id !== id));
      appToastSuccess("Role removed");
      return;
    }
    const assigned = users.filter(
      (u) => u.role.trim().toLowerCase() === role.name.trim().toLowerCase(),
    );
    if (assigned.length > 0) {
      appToastError(
        "Role in use",
        `Reassign ${assigned.length} user(s) before deleting this role.`,
      );
      return;
    }
    if (apiLive) {
      try {
        await deleteDbRole(id);
      } catch (err) {
        appToastError("Delete failed", err instanceof Error ? err.message : "Unknown error");
        return;
      }
    }
    persistRoles(roles.filter((r) => r.id !== id));
    appToastSuccess("Role removed");
  }

  async function resetSystemRoles() {
    if (apiLive) {
      try {
        await seedDbAuth();
        const fresh = await fetchDbRoles();
        setRoles(fresh);
        saveRoles(fresh);
        appToastSuccess("Built-in roles restored");
        return;
      } catch (err) {
        appToastError("Seed failed", err instanceof Error ? err.message : "Unknown error");
      }
    }
    const custom = roles.filter((r) => !r.system);
    persistRoles([...defaultRoles.map((r) => ({ ...r })), ...custom]);
    appToastSuccess("Built-in roles restored");
  }

  if (!canManage) {
    return <div className="min-h-dvh bg-[#fbfbfc]" />;
  }

  return (
    <>
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-3 sm:px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={openSidebar}
            aria-label="Open navigation"
          >
            <HambergerMenu size={18} variant="Linear" color="currentColor" />
          </Button>
          <div className="flex items-center gap-2 text-[13px] text-slate-400">
            <Link href="/" className="hover:text-slate-700">
              Overview
            </Link>
            <span>/</span>
            <span className="font-medium text-slate-700">Users & roles</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <NotificationsMenu />
          <ThemeToggle />
          <PageMoreMenu />
        </div>
      </header>

      <main className="w-full space-y-4 p-4 sm:p-5">
        {!OWNS_IDENTITY_DIRECTORY ? (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-[13px] text-orange-950">
            <p className="font-medium">Users and roles come from IAG Admin</p>
            <p className="mt-0.5 text-orange-800/90">
              {IDENTITY_MANAGED_ELSEWHERE}{" "}
              <a
                href={identityUsersHref()}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-orange-700 underline underline-offset-2 hover:text-orange-800"
              >
                Open Users & roles in Admin
              </a>
            </p>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
              <Profile2User size={22} variant="Linear" color="currentColor" />
              Users & roles
            </h1>
            <p className="mt-1 text-[13px] text-slate-500">
              {OWNS_IDENTITY_DIRECTORY
                ? "System directory for every IAG tool. Create users, create roles, and set View / Create / Edit / Delete permissions per page."
                : "Directory from IAG Admin. Create and edit accounts there — this app only reads the shared users and roles."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canMutate ? (
              <>
                <Button
                  size="sm"
                  className="bg-orange-500 text-white hover:bg-orange-600"
                  onClick={openCreateUserDialog}
                >
                  <Add size={16} variant="Linear" color="currentColor" />
                  Create user
                </Button>
                <Button size="sm" variant="outline" onClick={openCreateRoleDialog}>
                  <Add size={16} variant="Linear" color="currentColor" />
                  Create role
                </Button>
                <Button size="sm" variant="outline" onClick={() => openAssignRoleDialog()}>
                  Give permissions
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className="bg-orange-500 text-white hover:bg-orange-600"
                onClick={() => window.open(identityUsersHref(), "_blank", "noopener,noreferrer")}
              >
                Manage in IAG Admin
              </Button>
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList variant="line" className="h-9">
              <TabsTrigger value="users" className="px-3 text-[13px]">
                Users
              </TabsTrigger>
              <TabsTrigger value="roles" className="px-3 text-[13px]">
                Roles
              </TabsTrigger>
              <TabsTrigger value="permissions" className="px-3 text-[13px]">
                Permissions
              </TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap gap-2">
              {canMutate && tab === "users" ? (
                <>
                  <Button variant="outline" size="sm" onClick={resetSampleUsers}>
                    Restore admin
                  </Button>
                  <Button
                    size="sm"
                    className="bg-orange-500 text-white hover:bg-orange-600"
                    onClick={openCreateUserDialog}
                  >
                    <Add size={16} variant="Linear" color="currentColor" />
                    Create user
                  </Button>
                </>
              ) : canMutate && tab === "roles" ? (
                <>
                  <Button variant="outline" size="sm" onClick={resetSystemRoles}>
                    Restore built-in roles
                  </Button>
                  <Button
                    size="sm"
                    className="bg-orange-500 text-white hover:bg-orange-600"
                    onClick={openCreateRoleDialog}
                  >
                    <Add size={16} variant="Linear" color="currentColor" />
                    Create role
                  </Button>
                </>
              ) : canMutate ? (
                <Button
                  size="sm"
                  className="bg-orange-500 text-white hover:bg-orange-600"
                  onClick={() => openAssignRoleDialog(selectedPermRole?.name)}
                >
                  Give this role to users
                </Button>
              ) : null}
            </div>
          </div>

          <TabsContent value="users" className="mt-0 space-y-4">
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-[14px] font-semibold text-slate-900">Workspace users</h2>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  Only the admin bootstrap login is seeded. Add other users yourself.
                  {!canDeleteUsers
                    ? " Your role cannot delete users — ask an Administrator or Super Admin."
                    : null}
                  {apiLive
                    ? " Set a strong password in Actions (Suggest helps), then Save. Users can also change their own password from Profile."
                    : " Connect the database to manage logins."}
                </p>
              </div>
              {!ready ? (
                <div className="p-8 text-center text-[13px] text-slate-400">Loading users…</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] text-left text-[13px]">
                    <thead className="bg-slate-50 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                      <tr>
                        <th className="px-4 py-2.5">Name</th>
                        <th className="px-4 py-2.5">Username</th>
                        <th className="px-4 py-2.5">Email</th>
                        <th className="px-4 py-2.5">Role</th>
                        <th className="px-4 py-2.5">CRUD</th>
                        <th className="px-4 py-2.5">Password</th>
                        <th className="px-4 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usersPager.pageItems.map((user) => {
                        const crud = flagsToCrud(user);
                        const roleValue = roleNames.includes(user.role)
                          ? user.role
                          : roleNames[0] || user.role;
                        const showUserPerms = userPermId === user.id;
                        const userRole = roles.find(
                          (r) => String(r?.name ?? "").trim().toLowerCase() === String(user.role || "").trim().toLowerCase(),
                        );
                        return (
                          <Fragment key={user.id}>
                            <tr className="border-t border-slate-100 align-top">
                              <td className="px-4 py-3">
                                <Input
                                  value={user.name}
                                  onChange={(e) => updateUser(user.id, { name: e.target.value })}
                                  className="h-8 text-[13px]"
                                  placeholder="Full name"
                                  disabled={!canMutate}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <Input
                                  value={user.username}
                                  onChange={(e) =>
                                    updateUser(user.id, { username: e.target.value })
                                  }
                                  className="h-8 text-[13px]"
                                  placeholder="username"
                                  disabled={!canMutate}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <Input
                                  value={user.email || ""}
                                  onChange={(e) => updateUser(user.id, { email: e.target.value })}
                                  className="h-8 text-[13px]"
                                  placeholder="email@iag.local"
                                  disabled={!canMutate}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <select
                                  value={roleValue}
                                  onChange={(e) => onRoleChange(user.id, e.target.value)}
                                  disabled={!canMutate}
                                  className="h-8 w-full min-w-[140px] rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-800 outline-none focus:border-orange-400 disabled:bg-slate-50"
                                >
                                  {!roleNames.includes(user.role) && user.role ? (
                                    <option value={user.role}>{user.role} (missing)</option>
                                  ) : null}
                                  {roleNames.map((name) => (
                                    <option key={name} value={name}>
                                      {name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="mt-1.5 text-[11px] font-medium text-orange-600 hover:text-orange-700"
                                  onClick={() =>
                                    setUserPermId(showUserPerms ? null : user.id)
                                  }
                                >
                                  {showUserPerms ? "Hide page CRUD" : "Show permissions from role"}
                                </button>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex max-w-[280px] flex-wrap gap-1">
                                  {CRUD_OPS.map((op: CrudOp) => (
                                    <span
                                      key={op}
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                        crud[op]
                                          ? "bg-emerald-50 text-emerald-700"
                                          : "bg-slate-50 text-slate-300"
                                      }`}
                                    >
                                      {CRUD_LABELS[op]}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex min-w-[180px] flex-col gap-1">
                                  <div className="flex items-center gap-1">
                                    <Input
                                      type={passwordVisible[user.id] ? "text" : "password"}
                                      value={passwordDrafts[user.id] || ""}
                                      onChange={(e) =>
                                        setPasswordDrafts((prev) => ({
                                          ...prev,
                                          [user.id]: e.target.value,
                                        }))
                                      }
                                      className="h-8 w-[140px] text-[12px]"
                                      placeholder={
                                        passwordStatus[user.id] ? "Strong password" : "New strong password"
                                      }
                                      autoComplete="new-password"
                                      disabled={!canMutate}
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 shrink-0 px-2 text-[11px]"
                                      disabled={!canMutate}
                                      onClick={() =>
                                        setPasswordVisible((prev) => ({
                                          ...prev,
                                          [user.id]: !prev[user.id],
                                        }))
                                      }
                                    >
                                      {passwordVisible[user.id] ? "Hide" : "Show"}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 shrink-0 px-2 text-[11px]"
                                      title="Suggest a strong password"
                                      disabled={!canMutate}
                                      onClick={() =>
                                        setPasswordDrafts((prev) => ({
                                          ...prev,
                                          [user.id]: suggestStrongPassword(),
                                        }))
                                      }
                                    >
                                      Suggest
                                    </Button>
                                  </div>
                                  <span className="text-[10px] text-slate-500">
                                    10+ chars · upper · lower · number · symbol
                                  </span>
                                  <span
                                    className={`text-[10px] font-medium ${
                                      passwordStatus[user.id]
                                        ? "text-emerald-700"
                                        : "text-slate-400"
                                    }`}
                                  >
                                    {passwordStatus[user.id]
                                      ? passwordDrafts[user.id]
                                        ? "Stored — use Show / Hide"
                                        : "Password on file"
                                      : "No password yet"}
                                  </span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {canMutate ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-[11px]"
                                    onClick={() => void saveUserCredentials(user)}
                                  >
                                    Save
                                  </Button>
                                  ) : null}
                                  {canMutate && canDeleteUsers ? (
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      className="text-slate-400 hover:text-rose-600"
                                      onClick={() => void removeUser(user.id)}
                                      aria-label={`Remove ${user.name || user.username || "user"}`}
                                    >
                                      <Trash size={16} variant="Linear" color="currentColor" />
                                    </Button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                            {showUserPerms ? (
                              <tr className="border-t border-slate-100 bg-slate-50/80">
                                <td colSpan={7} className="px-4 py-4">
                                  {userRole ? (
                                    <PageCrudMatrix
                                      role={userRole}
                                      readOnly
                                      onSetPagePermission={() => {}}
                                      onClearPagePermission={() => {}}
                                    />
                                  ) : (
                                    <p className="text-[13px] text-slate-500">
                                      Role “{user.role}” not found — assign a valid role to see page
                                      CRUD.
                                    </p>
                                  )}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {ready && users.length > 0 ? (
                <PaginationBar
                  page={usersPager.page}
                  pages={usersPager.pages}
                  total={usersPager.total}
                  from={usersPager.from}
                  to={usersPager.to}
                  pageSize={usersPager.pageSize}
                  onPageChange={usersPager.setPage}
                  onPageSizeChange={usersPager.setPageSize}
                />
              ) : null}
            </section>
          </TabsContent>

          <TabsContent value="roles" className="mt-0 space-y-4">
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-[14px] font-semibold text-slate-900">Roles</h2>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  Workspace CRUD sets the default. Open “Page permissions” on a role to set CRUD for
                  each module and app page. Import / create / edit / delete on a page follow that
                  page’s flags.
                </p>
              </div>
              {!ready ? (
                <div className="p-8 text-center text-[13px] text-slate-400">Loading roles…</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-left text-[13px]">
                    <thead className="bg-slate-50 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                      <tr>
                        <th className="px-4 py-2.5">Role name</th>
                        <th className="px-4 py-2.5">Description</th>
                        <th className="px-4 py-2.5">CRUD access</th>
                        <th className="px-4 py-2.5">Derived permissions</th>
                        <th className="px-4 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rolesPager.pageItems.map((role) => {
                        const crud = flagsToCrud(role);
                        const derived = permissionsFromCrud(crud);
                        const pageOverrideCount = Object.keys(role.pagePermissions || {}).length;
                        const showPages = pagePermRoleId === role.id;
                        return (
                          <Fragment key={role.id}>
                            <tr className="border-t border-slate-100 align-top">
                              <td className="px-4 py-3">
                                <Input
                                  value={role.name}
                                  onChange={(e) => updateRole(role.id, { name: e.target.value })}
                                  className="h-8 text-[13px]"
                                  placeholder="Role name"
                                  disabled={role.system || !canMutate}
                                />
                                {role.system ? (
                                  <p className="mt-1 text-[10px] font-medium tracking-wide text-slate-400 uppercase">
                                    Built-in
                                  </p>
                                ) : (
                                  <p className="mt-1 text-[10px] font-medium tracking-wide text-orange-500 uppercase">
                                    Custom
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <Input
                                  value={role.description}
                                  onChange={(e) =>
                                    updateRole(role.id, { description: e.target.value })
                                  }
                                  className="h-8 min-w-[180px] text-[13px]"
                                  placeholder="What this role can do"
                                  disabled={!canMutate}
                                />
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-1.5">
                                  {CRUD_OPS.map((op) => (
                                    <CrudToggle
                                      key={op}
                                      label={CRUD_LABELS[op]}
                                      checked={crud[op]}
                                      disabled={!canMutate}
                                      onChange={(next) => setRoleCrud(role.id, op, next)}
                                    />
                                  ))}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="mt-2 h-7 px-2 text-[11px] text-orange-600 hover:text-orange-700"
                                  onClick={() =>
                                    setPagePermRoleId(showPages ? null : role.id)
                                  }
                                >
                                  {showPages ? "Hide page CRUD" : "Show all page CRUD"}
                                  {pageOverrideCount
                                    ? ` (${pageOverrideCount} override${pageOverrideCount === 1 ? "" : "s"})`
                                    : ""}
                                </Button>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex max-w-[260px] flex-wrap gap-1">
                                  {derived.length === 0 ? (
                                    <span className="text-[11px] text-slate-300">None</span>
                                  ) : (
                                    derived.map((perm) => (
                                      <span
                                        key={perm}
                                        className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                                      >
                                        {perm}
                                      </span>
                                    ))
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-slate-400 hover:text-rose-600 disabled:opacity-30"
                                  onClick={() => removeRole(role.id)}
                                  disabled={role.system || !canMutate}
                                  aria-label={`Remove ${role.name || "role"}`}
                                >
                                  <Trash size={16} variant="Linear" color="currentColor" />
                                </Button>
                              </td>
                            </tr>
                            {showPages ? (
                              <tr className="border-t border-slate-100 bg-slate-50/80">
                                <td colSpan={5} className="px-4 py-4">
                                  <PageCrudMatrix
                                    role={role}
                                    readOnly={!canMutate}
                                    onSetPagePermission={(pageKey, op, allowed) =>
                                      setPagePermission(role.id, pageKey, op, allowed)
                                    }
                                    onClearPagePermission={(pageKey) =>
                                      clearPagePermission(role.id, pageKey)
                                    }
                                    onApplyWorkspace={() => applyWorkspaceCrudToAllPages(role.id)}
                                    onClearAll={() => clearAllPagePermissions(role.id)}
                                  />
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {ready && roles.length > 0 ? (
                <PaginationBar
                  page={rolesPager.page}
                  pages={rolesPager.pages}
                  total={rolesPager.total}
                  from={rolesPager.from}
                  to={rolesPager.to}
                  pageSize={rolesPager.pageSize}
                  onPageChange={rolesPager.setPage}
                  onPageSizeChange={rolesPager.setPageSize}
                />
              ) : null}
            </section>
          </TabsContent>

          <TabsContent value="permissions" className="mt-0 space-y-4">
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-[14px] font-semibold text-slate-900">
                    All page CRUD permissions
                  </h2>
                  <p className="mt-0.5 text-[12px] text-slate-500">
                    Set what this role can open, then give the role to users so they inherit these
                    permissions ({PERMISSION_PAGES.length} pages).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-[12px] text-slate-600">
                    <span className="font-medium">Role</span>
                    <select
                      value={permRoleId || ""}
                      onChange={(e) => setPermRoleId(e.target.value || null)}
                      className="h-9 min-w-[200px] rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800 outline-none focus:border-orange-400"
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name || "Unnamed role"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {canMutate ? (
                  <Button
                    size="sm"
                    className="bg-orange-500 text-white hover:bg-orange-600"
                    onClick={() => openAssignRoleDialog(selectedPermRole?.name)}
                  >
                    Give to users
                  </Button>
                  ) : null}
                </div>
              </div>
              <div className="p-4">
                {!ready ? (
                  <div className="p-8 text-center text-[13px] text-slate-400">
                    Loading permissions…
                  </div>
                ) : selectedPermRole ? (
                  <>
                    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[12px] text-slate-600">
                          <span className="font-semibold text-slate-800">
                            {users.filter(
                              (u) =>
                                u.role.trim().toLowerCase() ===
                                selectedPermRole.name.trim().toLowerCase(),
                            ).length}
                          </span>{" "}
                          user(s) currently have{" "}
                          <span className="font-semibold text-slate-800">
                            {selectedPermRole.name}
                          </span>
                          . Assign more below to give them these page permissions.
                        </p>
                        {canMutate ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => openAssignRoleDialog(selectedPermRole.name)}
                        >
                          Assign users
                        </Button>
                        ) : null}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {users
                          .filter(
                            (u) =>
                              u.role.trim().toLowerCase() ===
                              selectedPermRole.name.trim().toLowerCase(),
                          )
                          .slice(0, 12)
                          .map((u) => (
                            <span
                              key={u.id}
                              className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600"
                            >
                              {u.name || u.username || u.email}
                            </span>
                          ))}
                      </div>
                    </div>
                    <div className="mb-4 flex flex-wrap gap-1.5">
                      <span className="mr-1 self-center text-[11px] font-medium text-slate-400 uppercase">
                        Workspace
                      </span>
                      {CRUD_OPS.map((op) => {
                        const crud = flagsToCrud(selectedPermRole);
                        return (
                          <CrudToggle
                            key={op}
                            label={CRUD_LABELS[op]}
                            checked={crud[op]}
                            disabled={!canMutate}
                            onChange={(next) => setRoleCrud(selectedPermRole.id, op, next)}
                          />
                        );
                      })}
                    </div>
                    <PageCrudMatrix
                      role={selectedPermRole}
                      readOnly={!canMutate}
                      onSetPagePermission={(pageKey, op, allowed) =>
                        setPagePermission(selectedPermRole.id, pageKey, op, allowed)
                      }
                      onClearPagePermission={(pageKey) =>
                        clearPagePermission(selectedPermRole.id, pageKey)
                      }
                      onApplyWorkspace={() =>
                        applyWorkspaceCrudToAllPages(selectedPermRole.id)
                      }
                      onClearAll={() => clearAllPagePermissions(selectedPermRole.id)}
                    />
                  </>
                ) : (
                  <p className="text-[13px] text-slate-500">Add a role to edit page permissions.</p>
                )}
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              Add a login and assign a role. Permissions come from that role’s matrix.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1 text-[12px] font-medium text-slate-600">
              Full name
              <Input
                value={newUser.name}
                onChange={(e) => setNewUser((p) => ({ ...p, name: e.target.value }))}
                placeholder="Ada Admin"
              />
            </label>
            <label className="grid gap-1 text-[12px] font-medium text-slate-600">
              Username
              <Input
                value={newUser.username}
                onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))}
                placeholder="ada"
              />
            </label>
            <label className="grid gap-1 text-[12px] font-medium text-slate-600">
              Email
              <Input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
                placeholder="ada@company.com"
              />
            </label>
            <label className="grid gap-1 text-[12px] font-medium text-slate-600">
              Role
              <select
                value={newUser.role}
                onChange={(e) => setNewUser((p) => ({ ...p, role: e.target.value }))}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-800 outline-none focus:border-orange-400"
              >
                {roleNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-[12px] font-medium text-slate-600">
              Password
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={newUser.password}
                  onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Strong password"
                  className="font-mono text-[12px]"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() =>
                    setNewUser((p) => ({ ...p, password: suggestStrongPassword() }))
                  }
                >
                  Suggest
                </Button>
              </div>
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateUserOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-orange-500 text-white hover:bg-orange-600"
              disabled={creatingUser}
              onClick={() => void submitCreateUser()}
            >
              {creatingUser ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createRoleOpen} onOpenChange={setCreateRoleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create role</DialogTitle>
            <DialogDescription>
              Set workspace CRUD defaults, then fine-tune page permissions on the Permissions tab.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1 text-[12px] font-medium text-slate-600">
              Role name
              <Input
                value={newRole.name}
                onChange={(e) => setNewRole((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Site Supervisor"
              />
            </label>
            <label className="grid gap-1 text-[12px] font-medium text-slate-600">
              Description
              <Input
                value={newRole.description}
                onChange={(e) => setNewRole((p) => ({ ...p, description: e.target.value }))}
                placeholder="What this role can do"
              />
            </label>
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-slate-600">Workspace CRUD</p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["canView", "View"],
                    ["canCreate", "Create"],
                    ["canEdit", "Edit"],
                    ["canDelete", "Delete"],
                  ] as const
                ).map(([key, label]) => (
                  <CrudToggle
                    key={key}
                    label={label}
                    checked={newRole[key]}
                    onChange={(next) => setNewRole((p) => ({ ...p, [key]: next }))}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateRoleOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-orange-500 text-white hover:bg-orange-600"
              disabled={creatingRole}
              onClick={() => void submitCreateRole()}
            >
              {creatingRole ? "Creating…" : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignRoleOpen} onOpenChange={setAssignRoleOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Give permissions to users</DialogTitle>
            <DialogDescription>
              Pick a role and the users who should get its page access. Permissions come from the
              role matrix (Permissions tab).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1 text-[12px] font-medium text-slate-600">
              Role / permissions pack
              <select
                value={assignRoleName}
                onChange={(e) => {
                  const name = e.target.value;
                  setAssignRoleName(name);
                  setAssignUserIds(
                    users
                      .filter((u) => u.role.trim().toLowerCase() === name.trim().toLowerCase())
                      .map((u) => u.id),
                  );
                }}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] text-slate-800 outline-none focus:border-orange-400"
              >
                {roleNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[12px] font-medium text-slate-600">Users</p>
                <button
                  type="button"
                  className="text-[11px] font-medium text-orange-600 hover:text-orange-700"
                  onClick={() => {
                    if (assignUserIds.length === users.length) setAssignUserIds([]);
                    else setAssignUserIds(users.map((u) => u.id));
                  }}
                >
                  {assignUserIds.length === users.length ? "Clear all" : "Select all"}
                </button>
              </div>
              <div className="max-h-64 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">
                {users.length === 0 ? (
                  <p className="px-1 py-3 text-[12px] text-slate-500">
                    No users yet — create a user first.
                  </p>
                ) : (
                  users.map((u) => {
                    const checked = assignUserIds.includes(u.id);
                    return (
                      <label
                        key={u.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${
                          checked ? "bg-orange-50 text-slate-900" : "hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="size-3.5 accent-orange-500"
                          checked={checked}
                          onChange={(e) => {
                            setAssignUserIds((prev) =>
                              e.target.checked
                                ? [...prev, u.id]
                                : prev.filter((id) => id !== u.id),
                            );
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {u.name || u.username || u.email || "Unnamed"}
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {u.role || "—"}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAssignRoleOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-orange-500 text-white hover:bg-orange-600"
              disabled={assigningRole}
              onClick={() => void submitAssignRole()}
            >
              {assigningRole ? "Saving…" : "Give permissions"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
