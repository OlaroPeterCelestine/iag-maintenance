"use client";

import { ChangePasswordForm } from "@/components/change-password-dialog";
import { useAppShell } from "@/components/app-shell";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CRUD_LABELS,
  CRUD_OPS,
  ROLE_DESCRIPTIONS,
  crudOpsForRole,
  currentUserCan,
  currentUserCanCrud,
  type AppRole,
  type CrudOp,
} from "@/lib/access-control";
import {
  AUTH_CHANGED_EVENT,
  getKeepSignedInPreference,
  logout,
  readAuthSession,
  writeAuthSession,
} from "@/lib/auth";
import { updateOwnProfile } from "@/lib/auth-api";
import {
  getCurrentSessionUser,
  getSessionBusiness,
  type SessionBusiness,
  type SessionUser,
} from "@/lib/session-profile";
import { USERS_KEY, loadList, saveList, type UserRow } from "@/lib/manager-settings";
import {
  Briefcase,
  Calendar,
  Call,
  Clock,
  Edit2,
  HambergerMenu,
  Key,
  Location,
  Logout,
  Profile,
  ShieldTick,
  Sms,
} from "iconsax-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function ProfilePage() {
  const { openSidebar } = useAppShell();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [business, setBusiness] = useState<SessionBusiness | null>(null);
  const [canEditSettings, setCanEditSettings] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameSaved, setNameSaved] = useState(false);

  useEffect(() => {
    const reload = () => {
      const next = getCurrentSessionUser();
      setUser(next);
      setDisplayName(next.name || "");
      setBusiness(getSessionBusiness());
      setCanEditSettings(currentUserCan("edit-settings"));
    };
    queueMicrotask(reload);
    window.addEventListener("storage", reload);
    window.addEventListener(AUTH_CHANGED_EVENT, reload);
    window.addEventListener("financeiag-records-changed", reload);
    return () => {
      window.removeEventListener("storage", reload);
      window.removeEventListener(AUTH_CHANGED_EVENT, reload);
      window.removeEventListener("financeiag-records-changed", reload);
    };
  }, []);

  const name = user?.name || user?.username || "Signed in";
  const role = user?.role || "User";
  const initials = user?.initials || "—";
  const roleCopy =
    role in ROLE_DESCRIPTIONS
      ? ROLE_DESCRIPTIONS[role as AppRole]
      : "Custom role — CRUD defaults to Viewer unless mapped.";
  const crud = user
    ? {
        view: currentUserCanCrud("view"),
        create: currentUserCanCrud("create"),
        edit: currentUserCanCrud("edit"),
        delete: currentUserCanCrud("delete"),
      }
    : crudOpsForRole(role);

  const details = [
    { label: "Full name", value: name, icon: Profile },
    { label: "User ID", value: user?.id || "—", icon: Profile },
    { label: "Username", value: user?.username || "—", icon: Sms },
    { label: "Email address", value: user?.email || business?.email || "—", icon: Sms },
    { label: "Phone number", value: business?.phone || "—", icon: Call },
    {
      label: "Location",
      value: business?.city || business?.country || business?.address || "—",
      icon: Location,
    },
    { label: "Role", value: role, icon: Briefcase },
    { label: "Business", value: business?.businessName || "—", icon: Calendar },
  ];

  function onSignOut() {
    logout();
  }

  async function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    setNameError("");
    setNameSaved(false);
    const trimmed = displayName.trim();
    if (!trimmed) {
      setNameError("Name is required");
      return;
    }
    setNameBusy(true);
    try {
      const updated = await updateOwnProfile({ name: trimmed });
      const session = readAuthSession();
      if (session) {
        writeAuthSession(
          { ...session, name: updated.name || trimmed },
          getKeepSignedInPreference(),
        );
      }
      const users = loadList<UserRow>(USERS_KEY, []);
      const idx = users.findIndex((u) => u.id === updated.id || u.id === session?.userId);
      if (idx >= 0) {
        users[idx] = { ...users[idx], name: updated.name || trimmed };
        saveList(USERS_KEY, users);
      }
      setUser(getCurrentSessionUser());
      setNameSaved(true);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Could not update profile");
    } finally {
      setNameBusy(false);
    }
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
            <span className="font-medium text-slate-700">Profile</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <NotificationsMenu />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-600"
            onClick={onSignOut}
          >
            <Logout size={14} variant="Linear" color="currentColor" />
            Sign out
          </Button>
          {canEditSettings ? (
            <Link
              href="/users"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800"
            >
              <Edit2 size={14} variant="Linear" color="currentColor" />
              Edit users
            </Link>
          ) : null}
          <PageMoreMenu />
        </div>
      </header>

      <main className="w-full p-4 sm:p-5">
        <div className="w-full space-y-4">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="h-28 bg-[linear-gradient(115deg,#111827_0%,#1e293b_60%,#334155_100%)]" />
            <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="-mt-10 flex flex-col gap-3 sm:flex-row sm:items-end">
                <Avatar className="size-20 border-4 border-white shadow-sm">
                  <AvatarFallback className="bg-slate-900 text-2xl font-semibold text-white">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="pb-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-semibold tracking-tight text-slate-900">{name}</h1>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700">
                      <ShieldTick size={12} variant="Bold" color="currentColor" />
                      Active
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-slate-500">{role}</p>
                  <p className="mt-1 max-w-md text-[12px] text-slate-400">{roleCopy}</p>
                </div>
              </div>
              <p className="flex items-center gap-1.5 pb-1 text-[12px] text-slate-400">
                <Clock size={14} variant="Linear" color="currentColor" />
                Manage your account below
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5">
              <h2 className="text-[16px] font-semibold text-slate-900">Personal information</h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Your signed-in account details. Update your display name here; username and email
                are managed by an administrator.
              </p>
            </div>
            <form className="mb-6 max-w-md space-y-3" onSubmit={onSaveName}>
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">Display name</Label>
                <Input
                  id="profile-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={nameBusy}
                />
              </div>
              {nameError ? (
                <p className="text-[12px] font-medium text-red-600">{nameError}</p>
              ) : null}
              {nameSaved ? (
                <p className="text-[12px] font-medium text-emerald-700">Name saved.</p>
              ) : null}
              <Button type="submit" size="sm" disabled={nameBusy}>
                {nameBusy ? "Saving…" : "Save name"}
              </Button>
            </form>
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
              {details.map(({ label, value, icon: Icon }) => (
                <div key={label} className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <Icon size={17} variant="Linear" color="currentColor" />
                  </span>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      {label}
                    </p>
                    <p className="mt-1 text-[13px] font-medium text-slate-800">{value}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <Key size={17} variant="Linear" color="currentColor" />
              </span>
              <div>
                <h2 className="text-[16px] font-semibold text-slate-900">Security</h2>
                <p className="mt-1 text-[12px] text-slate-500">
                  Change your password anytime. Any password is allowed. Use Show to view what you
                  type.
                </p>
              </div>
            </div>
            <div className="max-w-md">
              <ChangePasswordForm submitLabel="Update password" />
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5">
              <h2 className="text-[16px] font-semibold text-slate-900">CRUD access</h2>
              <p className="mt-1 text-[12px] text-slate-500">
                {roleCopy} Access is enforced as View, Create, Edit, and Delete.
              </p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {CRUD_OPS.map((op: CrudOp) => {
                const allowed = crud[op];
                return (
                  <li
                    key={op}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${
                      allowed
                        ? "border-emerald-100 bg-emerald-50/60 text-emerald-800"
                        : "border-slate-100 bg-slate-50 text-slate-400"
                    }`}
                  >
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        allowed ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    />
                    {CRUD_LABELS[op]}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}
