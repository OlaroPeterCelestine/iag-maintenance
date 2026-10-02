/**
 * Standalone mode switch for the Maintenance app.
 *
 * Defaults to `false`: an unset variable means "expect a backend", and the app
 * talks to iag-mes through the adapter in `src/lib/iag/*`. Set
 * `NEXT_PUBLIC_FRONTEND_ONLY=true` explicitly for a browser-only demo that
 * keeps everything in localStorage.
 *
 * It used to default to `true`, which meant a deployment that forgot the
 * variable rendered as a working-but-empty app: every data call resolved to a
 * synthetic empty 200, nothing reached MES, and nothing said so. A missing
 * backend should look like a missing backend.
 *
 * There is no compiled-in account. Standalone mode has nothing to sign in with;
 * sign-in goes to the API.
 *
 * NEXT_PUBLIC_* is inlined at build time, so this is a per-deployment switch,
 * not a per-request one.
 */
export const FRONTEND_ONLY =
  (process.env.NEXT_PUBLIC_FRONTEND_ONLY || "").trim().toLowerCase() === "true";
