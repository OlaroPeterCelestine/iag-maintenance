"use client";

import {
  BUSINESS_PROFILE_KEY,
  emptyBusinessForm,
  type BusinessForm,
} from "@/components/business-profile-form";
import { readAuthSession } from "@/lib/auth";
import { getMemorySetting } from "@/lib/db/client-store";
import {
  USERS_KEY,
  loadBusinessLogo,
  loadList,
  loadManagerSettings,
  type UserRow,
} from "@/lib/manager-settings";

export type SessionUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  initials: string;
};

export type SessionBusiness = {
  businessName: string;
  address: string;
  country: string;
  email: string;
  phone: string;
  city: string;
  taxId: string;
  logoPreview: string | null;
};

function initialsFrom(name: string) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}


function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function loadSessionUsers(): UserRow[] {
  if (typeof window === "undefined") return [];
  return loadList<UserRow>(USERS_KEY, []);
}

/**
 * Resolve the signed-in user row by user id only.
 * Never match by email/username — that mixes up people who share a desk/role
 * (e.g. Ritah Accounts Assistant vs Richard Accountant).
 */
export function findSessionUserRow(
  users: UserRow[],
  session: { userId: string; email?: string; username?: string } | null,
): UserRow | undefined {
  const id = text(session?.userId);
  if (!id) return undefined;
  return users.find((u) => u.id === id);
}

/**
 * Current signed-in user from auth session + DB-backed users list.
 * Session carries role/CRUD from login so modules work before users hydrate.
 * Prefer the DB row when id matches; never borrow another user's profile.
 */
export function getCurrentSessionUser(): SessionUser {
  const users = loadSessionUsers();
  const session = typeof window !== "undefined" ? readAuthSession() : null;
  const user = findSessionUserRow(users, session);

  if (!user && session) {
    const email = text(session.email);
    const username = text(session.username) || email.split("@")[0] || "user";
    // Prefer session display name from login /auth/me — never invent another person.
    const name = text(session.name) || username;
    return {
      id: session.userId,
      name,
      username,
      email,
      role: text(session.role) || "",
      initials: initialsFrom(name),
    };
  }

  if (!user && !session) {
    return {
      id: "",
      name: "",
      username: "",
      email: "",
      role: "",
      initials: "—",
    };
  }

  // Prefer the JWT/login session display name for this userId — users-list
  // rows can lag after a desk switch and briefly show another person's name.
  const name =
    text(session?.name) ||
    text(user?.name) ||
    text(session?.username) ||
    text(user?.username) ||
    "";
  const username = text(session?.username) || text(user?.username) || "";
  return {
    id: text(session?.userId) || text(user?.id),
    name: name || username || "User",
    username: username || "user",
    email: text(session?.email) || text(user?.email) || "",
    role: text(session?.role) || text(user?.role) || "",
    initials: initialsFrom(name || username || "User"),
  };
}

function loadStoredBusinessForm(): BusinessForm | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = getMemorySetting<Partial<BusinessForm> | null>(BUSINESS_PROFILE_KEY, null);
    if (!raw) return null;
    return { ...emptyBusinessForm, ...raw };
  } catch {
    return null;
  }
}

/** Business details from Settings / stored profile — never hardcoded demo companies. */
export function getSessionBusiness(): SessionBusiness {
  const settings = loadManagerSettings();
  const form = loadStoredBusinessForm();
  const logo = loadBusinessLogo();
  return {
    businessName: text(form?.businessName) || settings.businessName || "",
    address: form
      ? [form.addressLine1, form.city, form.country].filter(Boolean).join(", ")
      : settings.address || "",
    country: text(form?.country) || settings.country || "",
    email: text(form?.email) || "",
    phone: text(form?.phone) || "",
    city: text(form?.city) || "",
    taxId: text(form?.taxId) || "",
    logoPreview: form?.logoPreview || logo.dataUrl || null,
  };
}
