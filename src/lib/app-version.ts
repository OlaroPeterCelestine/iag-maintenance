/**
 * SemVer for this app. `next.config.ts` inlines package.json into
 * NEXT_PUBLIC_APP_VERSION at build time. Keep the fallback in lockstep
 * with package.json when you bump a release.
 */
export const APP_VERSION =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_APP_VERSION?.trim()) ||
  "1.1.0";

export function appVersionLabel(): string {
  return APP_VERSION.startsWith("v") ? APP_VERSION : `v${APP_VERSION}`;
}
