/**
 * Standalone mode switch for the Production app.
 *
 * Defaults to `true` — the app runs entirely in the browser against
 * localStorage, with no backend and no Postgres, exactly as the standalone
 * clone always has. An un-configured deployment is unchanged by the platform
 * wiring.
 *
 * Set `NEXT_PUBLIC_FRONTEND_ONLY=false` (with `IAG_GATEWAY_ORIGIN`) to run
 * against the IAG microservice platform through the adapter in
 * `src/lib/iag/*` — orders, runs, downtime and work centres then come from iag-mes and iag-production.
 * That flip turns every stubbed data call into a real network request, so read
 * the migration note in `.env.example` before setting it.
 *
 * This used to be a hardcoded `true`, which meant the adapter under
 * `src/lib/iag` could never be reached from a deployment at all — the switch
 * every other app has was missing here, not merely off.
 *
 * There is no compiled-in account. Standalone mode has nothing to sign in with;
 * sign-in goes to the API.
 *
 * NEXT_PUBLIC_* is inlined at build time, so this is a per-deployment switch,
 * not a per-request one.
 */
export const FRONTEND_ONLY =
  (process.env.NEXT_PUBLIC_FRONTEND_ONLY || "").trim().toLowerCase() !== "false";
