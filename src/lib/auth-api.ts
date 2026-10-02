/**
 * Client helpers for Go-backed auth APIs (/api/auth/*).
 */
import type { RoleRow, UserRow } from "@/lib/manager-settings";
import { apiFetch, clearApiToken, setApiToken } from "@/lib/api-auth";

export type DbUser = UserRow & {
  status?: string;
  hasPassword?: boolean;
  roleId?: string | null;
  mustChangePassword?: boolean;
};

async function parseJson<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      typeof (json as { error?: string }).error === "string"
        ? (json as { error: string }).error
        : `Request failed (${res.status})`,
    );
  }
  return json;
}

export async function requestPasswordReset(emailOrUsername: string): Promise<{
  message: string;
  expiresInSeconds?: number;
}> {
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ emailOrUsername }),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    message?: string;
    data?: { expiresInSeconds?: number };
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "Could not send reset code");
  }
  return {
    message: json.message || "If an account exists, a reset code has been sent.",
    expiresInSeconds: json.data?.expiresInSeconds,
  };
}

export async function verifyPasswordResetOTP(
  emailOrUsername: string,
  otp: string,
): Promise<{ resetToken: string; expiresInSeconds?: number }> {
  const res = await fetch("/api/auth/verify-reset-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ emailOrUsername, otp }),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    data?: { resetToken?: string; expiresInSeconds?: number };
  };
  if (!res.ok || !json.ok || !json.data?.resetToken) {
    throw new Error(json.error || "Invalid or expired reset code");
  }
  return {
    resetToken: json.data.resetToken,
    expiresInSeconds: json.data.expiresInSeconds,
  };
}

export async function resetPasswordWithToken(
  resetToken: string,
  newPassword: string,
): Promise<string> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ resetToken, newPassword }),
  });
  const json = (await res.json()) as { ok?: boolean; error?: string; message?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || "Could not reset password");
  }
  return json.message || "Password updated. You can sign in with your new password.";
}

export async function changeOwnPassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const res = await apiFetch("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await parseJson(res);
}

export async function updateOwnProfile(input: { name: string }): Promise<DbUser> {
  const res = await apiFetch("/api/auth/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await parseJson<{ data: DbUser }>(res);
  return json.data;
}

export async function fetchAuthMe(): Promise<{
  uid?: string;
  email?: string;
  username?: string;
  name?: string;
  role?: string;
  mustChangePassword?: boolean;
  /** True when an admin reset/created the password (vs monthly rotation). */
  passwordChangeForced?: boolean;
}> {
  const res = await apiFetch("/api/auth/me", { cache: "no-store" });
  const json = await parseJson<{ data?: Record<string, unknown> }>(res);
  const data = json.data || {};
  return {
    uid: typeof data.uid === "string" ? data.uid : undefined,
    email: typeof data.email === "string" ? data.email : undefined,
    username: typeof data.username === "string" ? data.username : undefined,
    name: typeof data.name === "string" ? data.name : undefined,
    role: typeof data.role === "string" ? data.role : undefined,
    mustChangePassword: Boolean(data.mustChangePassword),
    passwordChangeForced: Boolean(data.passwordChangeForced),
  };
}

export async function fetchDbUsers(): Promise<DbUser[]> {
  const res = await apiFetch("/api/auth/users", { cache: "no-store" });
  const json = await parseJson<{ data: DbUser[] }>(res);
  return json.data || [];
}

export async function fetchDbRoles(): Promise<RoleRow[]> {
  const res = await apiFetch("/api/auth/roles", { cache: "no-store" });
  const json = await parseJson<{ data: RoleRow[] }>(res);
  return json.data || [];
}

export async function createDbUser(input: {
  email: string;
  username?: string;
  name?: string;
  password: string;
  role: string;
}): Promise<DbUser> {
  const res = await apiFetch("/api/auth/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await parseJson<{ data: DbUser }>(res);
  return json.data;
}

export async function updateDbUser(
  id: string,
  input: {
    email?: string;
    username?: string;
    name?: string;
    password?: string;
    role?: string;
    canView?: string;
    canCreate?: string;
    canEdit?: string;
    canDelete?: string;
  },
): Promise<DbUser> {
  const res = await apiFetch(`/api/auth/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await parseJson<{ data: DbUser }>(res);
  return json.data;
}

export async function deleteDbUser(id: string): Promise<void> {
  const res = await apiFetch(`/api/auth/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseJson(res);
}

export async function createDbRole(input: {
  name: string;
  description?: string;
  canView?: string;
  canCreate?: string;
  canEdit?: string;
  canDelete?: string;
}): Promise<RoleRow> {
  const res = await apiFetch("/api/auth/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await parseJson<{ data: RoleRow }>(res);
  return json.data;
}

export async function updateDbRole(
  id: string,
  input: Partial<RoleRow>,
): Promise<RoleRow> {
  const res = await apiFetch(`/api/auth/roles/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await parseJson<{ data: RoleRow }>(res);
  return json.data;
}

export async function deleteDbRole(id: string): Promise<void> {
  const res = await apiFetch(`/api/auth/roles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await parseJson(res);
}

export async function seedDbAuth(): Promise<{ roles: number; users: number }> {
  const res = await apiFetch("/api/auth/seed", { method: "POST" });
  const json = await parseJson<{ data: { roles: number; users: number } }>(res);
  return json.data;
}

export async function loginViaDatabase(
  emailOrUsername: string,
  password: string,
  keepSignedIn = true,
): Promise<
  | { ok: true; user: DbUser; sessionId?: string }
  | { ok: false; error: string; unavailable?: boolean }
> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ emailOrUsername, password, keepSignedIn }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      error?: string;
      data?: { user: DbUser; token?: string; expiresAt?: string; sessionId?: string };
    };
    if (res.status === 503) {
      return { ok: false, error: json.error || "Database unavailable", unavailable: true };
    }
    if (!res.ok || !json.ok || !json.data?.user) {
      return { ok: false, error: json.error || "Login failed" };
    }
    if (!json.data.token) {
      return { ok: false, error: "Login succeeded but no API token was issued" };
    }
    setApiToken(json.data.token, json.data.expiresAt);
    return {
      ok: true,
      user: json.data.user,
      sessionId: json.data.sessionId ? String(json.data.sessionId) : undefined,
    };
  } catch {
    return { ok: false, error: "Network error — API unreachable", unavailable: true };
  }
}

export { clearApiToken };
