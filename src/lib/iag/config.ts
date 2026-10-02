/**
 * IAG platform wiring — server-side config.
 *
 * This app was built against its own Go Gin API (`GO_API_URL`), a generic
 * record store. The adapter layer in `src/lib/iag/*` re-points that contract at
 * the IAG microservice platform, reached through `iag-api-gateway`.
 *
 * Nothing here is `NEXT_PUBLIC_*` on purpose: the browser keeps calling
 * same-origin `/api/*`, and only the server talks to the gateway. That keeps the
 * platform bearer token out of the browser entirely.
 */

function env(key: string): string {
  return (process.env[key] || "").trim();
}

function flag(key: string, fallback: boolean): boolean {
  const raw = env(key).toLowerCase();
  if (!raw) return fallback;
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") return false;
  if (raw === "true" || raw === "1" || raw === "on" || raw === "yes") return true;
  return fallback;
}

/** Gateway origin, e.g. https://iag-api-gateway-production.up.railway.app */
export function gatewayOrigin(): string {
  return env("IAG_GATEWAY_ORIGIN").replace(/\/+$/, "");
}

/**
 * Master switch. When off, every route handler falls through to the legacy Go
 * API so the app behaves exactly as before — this is what makes an A/B test run
 * possible without swapping branches.
 */
export function adapterEnabled(): boolean {
  return flag("IAG_ADAPTER_ENABLED", Boolean(gatewayOrigin()));
}

/**
 * What to do with a module/entity that has no IAG owner (many of the 206
 * catalog entities are app-only: report views, layouts, desk widgets…).
 *
 * passthrough — proxy to GO_API_URL (default; nothing regresses)
 * empty       — serve an empty collection (proves what is genuinely unwired)
 */
export function unmappedMode(): "passthrough" | "empty" {
  return env("IAG_UNMAPPED_MODE").toLowerCase() === "empty" ? "empty" : "passthrough";
}

/** Legacy Go API base — still the fallback for unmapped surface. */
export function legacyApiOrigin(): string {
  return env("GO_API_URL").replace(/\/+$/, "");
}

/**
 * Credentials for the legacy Go API.
 *
 * The Go API has its own user table and signs with its own secret, so a
 * platform session means nothing to it — forwarding the platform bearer gets a
 * 401 and every unmapped entity goes dark. This is the "dual session" answer:
 * the server holds one Go credential of its own and attaches it when proxying,
 * so the platform serves what it owns and Go still serves the rest.
 *
 * An API key is preferred (no login round-trip, nothing to expire). Username
 * and password are supported because not every deployment issues keys.
 */
export function legacyApiKey(): string {
  // Vercel dashboards use `API_KEY` (same secret as the Go API). `GO_API_KEY`
  // is the adapter name. Accept either so a project that only has the Vercel
  // name still authenticates the passthrough.
  return env("API_KEY") || env("GO_API_KEY");
}

export function legacyCredentials(): { user: string; password: string } | null {
  const user = env("GO_API_USER");
  const password = env("GO_API_PASSWORD");
  return user && password ? { user, password } : null;
}

/** True when the server can authenticate to Go on the caller's behalf. */
export function legacyAuthConfigured(): boolean {
  return Boolean(legacyApiKey() || legacyCredentials());
}

/** Per-service gateway prefixes. Overridable so a local stack can differ. */
export const SERVICE_PREFIX = {
  authentication: () => env("IAG_AUTH_PREFIX") || "/api/v1/authentication",
  users: () => env("IAG_USERS_PREFIX") || "/api/v1/users",
  finance: () => env("IAG_FINANCE_PREFIX") || "/api/v1/finance",
  procurement: () => env("IAG_PROCUREMENT_PREFIX") || "/api/v1/procurement",
  warehouse: () => env("IAG_WAREHOUSE_PREFIX") || "/api/v1/warehouse",
  inventory: () => env("IAG_INVENTORY_PREFIX") || "/api/v1/warehouse",
  fleet: () => env("IAG_FLEET_PREFIX") || "/api/v1/fleet",
  crm: () => env("IAG_CRM_PREFIX") || "/api/v1/crm",
  projectManagement: () =>
    env("IAG_PM_PREFIX") || "/api/v1/project-management",
  contractManagement: () =>
    env("IAG_CONTRACTS_PREFIX") || "/api/v1/contract-management",
  production: () => env("IAG_PRODUCTION_PREFIX") || "/api/v1/production",
  qualityControl: () => env("IAG_QC_PREFIX") || "/api/v1/quality-control",
  mes: () => env("IAG_MES_PREFIX") || "/api/v1/mes",
  supplyChain: () => env("IAG_SCM_PREFIX") || "/api/v1/supply-chain",
  dms: () => env("IAG_DMS_PREFIX") || "/api/v1/dms",
  notifications: () => env("IAG_NOTIFICATIONS_PREFIX") || "/api/v1/notifications",
  reports: () => env("IAG_REPORTS_PREFIX") || "/api/v1/reports",
  erp: () => env("IAG_ERP_PREFIX") || "/api/v1/erp",
} as const;

export type ServiceKey = keyof typeof SERVICE_PREFIX;

/** Upstream request timeout — a cold Railway service can take a while. */
export function gatewayTimeoutMs(): number {
  const raw = Number(env("IAG_GATEWAY_TIMEOUT_MS"));
  return Number.isFinite(raw) && raw > 0 ? raw : 30_000;
}

/** Platform credentials for the OAuth2 password grant. */
export function oauthClient(): { id: string; secret: string } {
  return {
    id: env("IAG_OAUTH_CLIENT_ID") || "iag-platform",
    secret: env("IAG_OAUTH_CLIENT_SECRET"),
  };
}

/** httpOnly cookie holding the platform RS256 access token (server use only). */
export const PLATFORM_TOKEN_COOKIE = "iag_pt";
/** httpOnly cookie holding the platform refresh token. */
export const PLATFORM_REFRESH_COOKIE = "iag_rt";
