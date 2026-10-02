/**
 * Platform identity → app identity.
 *
 * The IAG access token is RS256 and carries Django-style RBAC
 * (`is_superuser`, `is_staff`, `groups[]`, `permissions[]`). This app's whole
 * UI keys off a single role string from `AppRole`, so login maps one onto the
 * other and then issues the app's own session token with that role.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { SERVICE_PREFIX, gatewayOrigin } from "@/lib/iag/config";
import type { AppRole } from "@/lib/access-control";

export type PlatformClaims = {
  sub: string;
  email: string;
  name: string;
  groups: string[];
  permissions: string[];
  isSuperuser: boolean;
  isStaff: boolean;
  audiences: string[];
  jti?: string;
  iat?: number;
  exp?: number;
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksOrigin = "";

function remoteJwks() {
  const origin = gatewayOrigin();
  if (!origin) return null;
  if (!jwks || jwksOrigin !== origin) {
    jwks = createRemoteJWKSet(
      new URL(`${origin}${SERVICE_PREFIX.authentication()}/.well-known/jwks.json`),
      // Cache aggressively; a key rotation still triggers a refetch on unknown kid.
      { cacheMaxAge: 10 * 60 * 1000, cooldownDuration: 30 * 1000 },
    );
    jwksOrigin = origin;
  }
  return jwks;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function claimsFromPayload(payload: JWTPayload): PlatformClaims | null {
  const sub = String(payload.sub || "");
  if (!sub) return null;
  return {
    sub,
    email: String(payload.email || ""),
    name: String(payload.name || ""),
    groups: stringList(payload.groups),
    permissions: stringList(payload.permissions),
    isSuperuser: payload.is_superuser === true,
    isStaff: payload.is_staff === true,
    audiences: stringList(payload.aud),
    jti: payload.jti ? String(payload.jti) : undefined,
    iat: typeof payload.iat === "number" ? payload.iat : undefined,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
  };
}

/**
 * Verify a platform access token against the live JWKS.
 * Audience is deliberately not enforced here — the gateway and each service
 * enforce their own `aud`; this app only needs to know who the caller is.
 */
export async function verifyPlatformToken(
  token: string,
): Promise<PlatformClaims | null> {
  const keys = remoteJwks();
  if (!keys || !token) return null;
  try {
    const { payload } = await jwtVerify(token, keys, { algorithms: ["RS256"] });
    return claimsFromPayload(payload);
  } catch {
    return null;
  }
}

/**
 * Decode without verifying — only for reading `exp` off a token we just
 * received over TLS from the token endpoint. Never use for authorization.
 */
export function decodePlatformToken(token: string): PlatformClaims | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = Buffer.from(
      part.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    return claimsFromPayload(JSON.parse(json) as JWTPayload);
  } catch {
    return null;
  }
}

/** Optional pin: IAG_ROLE_MAP='{"finance.manager":"Finance"}' (group → AppRole). */
function roleOverrides(): Record<string, string> {
  const raw = (process.env.IAG_ROLE_MAP || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Ordered group/permission → AppRole rules. First match wins, so the most
 * privileged sit at the top. Matching is on lowercased group names and
 * permission codenames (`app_label.action_model`).
 */
const ROLE_RULES: Array<{ role: AppRole; groups?: string[]; permissions?: string[] }> = [
  { role: "Super Admin", groups: ["superadmin", "super admin", "super_admin"] },
  { role: "Administrator", groups: ["admin", "administrator", "iam.admin"] },
  { role: "CEO", groups: ["ceo", "executive"] },
  { role: "General Manager", groups: ["gm", "general manager", "general_manager"] },
  {
    role: "Finance",
    groups: ["finance", "finance.manager", "finance_manager"],
    permissions: ["finance.change_ledger", "platform.access_finance"],
  },
  {
    role: "Accountant",
    groups: ["accountant", "finance.accountant"],
    permissions: ["finance.create_journal", "finance.post_journal"],
  },
  {
    role: "Accounts Assistant",
    groups: ["accounts assistant", "finance.assistant"],
    permissions: ["finance.manage_ar", "finance.manage_ap"],
  },
  {
    role: "Procurement",
    groups: ["procurement", "procurement.officer", "buyer"],
    permissions: ["procurement.change_requisition", "platform.access_procurement"],
  },
  {
    role: "Stores Manager",
    groups: ["stores", "warehouse", "stores manager", "warehouse.manager"],
    permissions: ["warehouse.change_stock", "platform.access_warehouse"],
  },
  {
    role: "Project Manager",
    groups: ["project manager", "pm", "projects.manager"],
    permissions: ["project_management.change_project", "platform.access_project_management"],
  },
  {
    role: "Quantity Surveyor",
    groups: ["quantity surveyor", "qs"],
  },
  { role: "HR", groups: ["hr", "human resources", "people"] },
  { role: "Department Head", groups: ["department head", "head", "hod"] },
  { role: "Contractor", groups: ["contractor", "vendor", "supplier"] },
  { role: "Approver", groups: ["approver"] },
  { role: "Reviewer", groups: ["reviewer"] },
  { role: "Clerk", groups: ["clerk", "data entry"] },
];

/** Map platform RBAC onto this app's single role string. */
export function appRoleFromClaims(claims: PlatformClaims): AppRole {
  if (claims.isSuperuser) return "Super Admin";

  const groups = new Set(claims.groups.map((g) => g.trim().toLowerCase()));
  const permissions = new Set(
    claims.permissions.map((p) => p.trim().toLowerCase()),
  );

  const overrides = roleOverrides();
  for (const group of groups) {
    const mapped = overrides[group];
    if (mapped) return mapped as AppRole;
  }

  for (const rule of ROLE_RULES) {
    if (rule.groups?.some((g) => groups.has(g))) return rule.role;
    if (rule.permissions?.some((p) => permissions.has(p))) return rule.role;
  }

  // Staff with no recognised group still needs the workspace, read-only.
  return claims.isStaff ? "Clerk" : "Viewer";
}

/** Username the app displays — platform tokens carry email, not username. */
export function usernameFromClaims(claims: PlatformClaims): string {
  if (claims.email.includes("@")) return claims.email.split("@")[0];
  return claims.email || claims.sub;
}
