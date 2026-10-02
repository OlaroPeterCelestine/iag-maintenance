/**
 * Users and roles are owned by IAG Admin. Other apps read the shared
 * directory (Go API / platform) and must not create or edit accounts.
 */
export const OWNS_IDENTITY_DIRECTORY = false;

export function identityConsoleUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_ADMIN_URL || "http://127.0.0.1:3090").trim();
  return raw.replace(/\/$/, "");
}

export function identityUsersHref(): string {
  return `${identityConsoleUrl()}/users`;
}

export const IDENTITY_MANAGED_ELSEWHERE =
  "Users and roles are managed in IAG Admin. Open Admin to create accounts, assign roles, or change permissions.";
