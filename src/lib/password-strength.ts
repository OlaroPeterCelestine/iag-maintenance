/**
 * Shared password strength rules for Profile / forced change / Users admin.
 * Keep in sync with backend/internal/httpapi/auth.go validateNewPassword.
 */

export const PASSWORD_MIN_LENGTH = 10;

export const PASSWORD_REQUIREMENTS = [
  "At least 10 characters",
  "One uppercase letter (A–Z)",
  "One lowercase letter (a–z)",
  "One number (0–9)",
  "One symbol (!@#$%^&*…)",
] as const;

export type PasswordCheck = {
  id: string;
  label: string;
  ok: boolean;
};

export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Too weak" | "Weak" | "Fair" | "Strong" | "Very strong";
  checks: PasswordCheck[];
  ok: boolean;
  message: string;
};

const COMMON = new Set(
  [
    "password",
    "password1",
    "password123",
    "1234567890",
    "qwerty123",
    "admin123",
    "iagdemo",
    "welcome1",
    "letmein1",
    "changeme",
    "financeiag",
  ].map((s) => s.toLowerCase()),
);

export function passwordChecks(password: string): PasswordCheck[] {
  const value = password || "";
  return [
    {
      id: "length",
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      ok: value.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: "upper",
      label: "One uppercase letter",
      ok: /[A-Z]/.test(value),
    },
    {
      id: "lower",
      label: "One lowercase letter",
      ok: /[a-z]/.test(value),
    },
    {
      id: "digit",
      label: "One number",
      ok: /\d/.test(value),
    },
    {
      id: "symbol",
      label: "One symbol (!@#$%…)",
      ok: /[^A-Za-z0-9]/.test(value),
    },
    {
      id: "common",
      label: "Not a common/easy password",
      ok: value.length > 0 && !COMMON.has(value.toLowerCase()),
    },
  ];
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  const checks = passwordChecks(password);
  const passed = checks.filter((c) => c.ok).length;
  const requiredOk = checks
    .filter((c) => c.id !== "common")
    .every((c) => c.ok);
  const ok = requiredOk && checks.find((c) => c.id === "common")!.ok;

  let score: PasswordStrength["score"] = 0;
  if (password.length === 0) score = 0;
  else if (passed <= 2) score = 1;
  else if (passed === 3) score = 2;
  else if (passed === 4) score = 3;
  else score = 4;

  const labels: PasswordStrength["label"][] = [
    "Too weak",
    "Weak",
    "Fair",
    "Strong",
    "Very strong",
  ];

  const failed = checks.find((c) => !c.ok);
  const message = ok
    ? "Password meets the strong-password rules."
    : failed
      ? `Use a stronger password: ${failed.label.toLowerCase()}.`
      : "Use a stronger password.";

  return {
    score,
    label: labels[score]!,
    checks,
    ok,
    message,
  };
}

/** Returns an error string if invalid, or "" if acceptable. */
export function validateStrongPassword(password: string): string {
  const strength = evaluatePasswordStrength(password);
  if (!password.trim()) return "Password is required";
  if (!strength.ok) return strength.message;
  return "";
}

/** Example that always passes the rules — for UI recommendation only. */
export function suggestStrongPassword(): string {
  const words = ["Cedar", "Orbit", "Nova", "Lake", "Forge", "Atlas", "Pulse", "Ridge"];
  const a = words[Math.floor(Math.random() * words.length)]!;
  const b = words[Math.floor(Math.random() * words.length)]!;
  const n = String(Math.floor(10 + Math.random() * 89));
  const symbols = ["!", "@", "#", "$", "%"];
  const s = symbols[Math.floor(Math.random() * symbols.length)]!;
  return `${a}${b}${n}${s}`;
}
