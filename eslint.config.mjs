import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Browser storage is sealed at runtime (src/lib/browser-storage-guard.ts).
 * These rules surface the mistake at lint time instead of letting a write
 * silently disappear.
 */
const storageRestrictions = {
  "no-restricted-globals": [
    "error",
    {
      name: "localStorage",
      message: "Browser storage is sealed — persist through the API (Postgres).",
    },
    {
      name: "sessionStorage",
      message:
        "sessionStorage is reserved for the auth/boot flags in browser-storage-guard.ts.",
    },
    {
      name: "indexedDB",
      message: "Browser storage is sealed — persist through the API (Postgres).",
    },
  ],
  "no-restricted-properties": [
    "error",
    {
      object: "window",
      property: "localStorage",
      message: "Browser storage is sealed — persist through the API (Postgres).",
    },
    {
      object: "window",
      property: "sessionStorage",
      message:
        "sessionStorage is reserved for the auth/boot flags in browser-storage-guard.ts.",
    },
    {
      object: "window",
      property: "indexedDB",
      message: "Browser storage is sealed — persist through the API (Postgres).",
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx,mts}"],
    rules: {
      // Production browsers get a locked console; anything logged there would
      // only leak data. Errors are allowed and routed to /api/crash.
      "no-console": ["error", { allow: ["error"] }],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: storageRestrictions,
  },
  {
    // Owners of the tab-scoped auth/boot flags.
    files: [
      "src/app/login/page.tsx",
      "src/components/app-shell.tsx",
      "src/components/pwa-register.tsx",
    ],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Nested / generated trees (not source):
    "web/**",
    "backend/**",
  ]),
]);

export default eslintConfig;
