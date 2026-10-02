/**
 * Gap audit: Activity logs / sessions / profile FE ↔ Go Gin API.
 * Run: npx tsx scripts/audit-activity-fe-be-gaps.mts
 */
import fs from "node:fs";
import path from "node:path";

type Sev = "critical" | "high" | "medium" | "low";
const issues: Array<{ severity: Sev; area: string; issue: string }> = [];

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

function mustInclude(rel: string, needle: string | RegExp, area: string, issue: string, sev: Sev = "high") {
  if (!exists(rel)) {
    issues.push({ severity: "critical", area, issue: `Missing file ${rel}` });
    return;
  }
  const src = read(rel);
  const ok = typeof needle === "string" ? src.includes(needle) : needle.test(src);
  if (!ok) issues.push({ severity: sev, area, issue });
}

function mustNotInclude(rel: string, needle: string | RegExp, area: string, issue: string, sev: Sev = "medium") {
  if (!exists(rel)) return;
  const src = read(rel);
  const hit = typeof needle === "string" ? src.includes(needle) : needle.test(src);
  if (hit) issues.push({ severity: sev, area, issue });
}

// --- Shared client ---
mustInclude(
  "src/lib/activity-api.ts",
  "fetchAdminActivity",
  "activity-client",
  "activity-api.ts missing fetchAdminActivity",
  "critical",
);
mustInclude(
  "src/lib/activity-api.ts",
  "fetchAdminSessions",
  "activity-client",
  "activity-api.ts missing fetchAdminSessions",
  "critical",
);
mustInclude(
  "src/lib/activity-api.ts",
  "sessionId",
  "activity-client",
  "FE activity client must send sessionId query (matches Gin meta->>'sessionId')",
  "high",
);
mustInclude(
  "src/lib/activity-api.ts",
  'params.set("user"',
  "activity-client",
  "FE sessions/activity client must support user filter",
  "high",
);

// --- Page uses shared client (not raw ad-hoc /api/activity) ---
mustInclude(
  "src/app/(main)/activity-logs/page.tsx",
  "fetchAdminActivity",
  "activity-page",
  "Activity logs page should call fetchAdminActivity",
  "critical",
);
mustInclude(
  "src/app/(main)/activity-logs/page.tsx",
  "fetchAdminSessions",
  "activity-page",
  "Activity logs page should call fetchAdminSessions",
  "critical",
);
mustInclude(
  "src/app/(main)/activity-logs/page.tsx",
  "By user",
  "activity-page",
  "Super Admin by-user tab missing",
  "high",
);
mustInclude(
  "src/app/(main)/activity-logs/page.tsx",
  "currentUserIsAdmin",
  "activity-page",
  "Activity logs must gate on Super Admin / Administrator",
  "critical",
);

// --- Tracking writes sessionId into meta ---
mustInclude(
  "src/lib/user-activity.ts",
  "sessionId",
  "activity-tracking",
  "Page-view tracker must attach sessionId from auth session",
  "critical",
);
mustInclude(
  "src/lib/auth.ts",
  "sessionId",
  "activity-tracking",
  "Auth session must store server sessionId from login",
  "critical",
);
mustInclude(
  "src/lib/auth-api.ts",
  "sessionId",
  "activity-tracking",
  "loginViaDatabase must return sessionId from Go login response",
  "critical",
);

// --- Proxy allowlist ---
mustInclude("src/proxy.ts", '"/api/activity"', "proxy", "proxy must forward /api/activity to Go", "critical");
mustInclude("src/proxy.ts", '"/api/auth"', "proxy", "proxy must forward /api/auth to Go", "critical");
mustInclude(
  "src/proxy.ts",
  '"/profile"',
  "proxy",
  "Contractor allowlist must include /profile",
  "high",
);
mustInclude(
  "src/proxy.ts",
  '"/contract-manager"',
  "proxy",
  "Contractor allowlist should include /contract-manager",
  "high",
);

// --- Go routes ---
mustInclude(
  "backend/internal/httpapi/server.go",
  'auth.GET("/activity"',
  "go-routes",
  "Gin missing GET /api/activity",
  "critical",
);
mustInclude(
  "backend/internal/httpapi/server.go",
  'auth.GET("/auth/sessions"',
  "go-routes",
  "Gin missing GET /api/auth/sessions",
  "critical",
);
mustInclude(
  "backend/internal/httpapi/server.go",
  'auth.GET("/activity", s.handleActivityList)',
  "go-routes",
  "GET /api/activity must be signed-in (admin full trail; others own rows)",
  "critical",
);

// --- Go query contracts FE depends on ---
mustInclude(
  "backend/internal/httpapi/activity.go",
  "sessionId",
  "go-activity",
  "Go activity list missing ?sessionId= meta filter",
  "critical",
);
mustInclude(
  "backend/internal/httpapi/activity.go",
  'c.Query("user")',
  "go-activity",
  "Go activity list missing ?user= filter",
  "critical",
);
mustInclude(
  "backend/internal/httpapi/activity.go",
  'c.Query("from")',
  "go-activity",
  "Go activity list missing ?from= filter",
  "high",
);
mustInclude(
  "backend/internal/httpapi/auth.go",
  '"sessionId": sessionID',
  "go-auth",
  "Login response must include sessionId for FE tracking",
  "critical",
);
mustInclude(
  "backend/internal/httpapi/auth.go",
  "listAllAuthSessions",
  "go-auth",
  "Admin sessions list must support all=1 path",
  "critical",
);
mustInclude(
  "backend/internal/httpapi/auth.go",
  "userNeedle",
  "go-auth",
  "Admin sessions list must accept user filter (FE By user → Sessions)",
  "high",
);
mustInclude(
  "backend/internal/httpapi/sessions.go",
  "DurationLabel",
  "go-sessions",
  "Session DTO must expose durationLabel",
  "high",
);
mustInclude(
  "backend/internal/httpapi/sessions.go",
  "UserName",
  "go-sessions",
  "All-sessions query must join user display fields",
  "high",
);

// --- Profile always reachable ---
mustInclude(
  "src/lib/access-control.ts",
  'if (key === "profile") return true',
  "profile",
  "canAccessSpecialNav(profile) must always allow signed-in users",
  "critical",
);
mustInclude(
  "src/lib/access-control.ts",
  "ensureProfilePagePermission",
  "profile",
  "Role matrices must force profile open",
  "high",
);
mustInclude(
  "backend/internal/httpapi/page_acl.go",
  "ensureProfilePageFlag",
  "profile",
  "Go ACL must force profile open on load",
  "high",
);
mustInclude(
  "backend/internal/authdata/defaults.go",
  "pageProfile()",
  "profile",
  "Contractor default matrix must grant profile",
  "high",
);
mustInclude(
  "src/lib/manager-settings.ts",
  "contractorDefaultPagePermissions",
  "profile",
  "FE contractor defaults missing",
  "high",
);
mustInclude(
  "src/lib/manager-settings.ts",
  '"contract-manager"',
  "contractor",
  "FE contractor defaults must grant contract-manager",
  "high",
);
mustInclude(
  "backend/internal/authdata/defaults.go",
  '"contract-manager"',
  "contractor",
  "Go contractor defaults must grant contract-manager",
  "high",
);

// --- DTO field parity (camelCase JSON) ---
const feSessionFields = [
  "userId",
  "userName",
  "createdAt",
  "lastActiveAt",
  "durationSeconds",
  "durationLabel",
  "revokedAt",
  "endReason",
];
const goSessions = exists("backend/internal/httpapi/sessions.go")
  ? read("backend/internal/httpapi/sessions.go")
  : "";
for (const f of feSessionFields) {
  if (!goSessions.includes(`json:"${f}`)) {
    issues.push({
      severity: "high",
      area: "dto-parity",
      issue: `Go authSessionDTO missing json:"${f}" (FE SessionRow expects it)`,
    });
  }
}

const feActivityFields = [
  "recordId",
  "recordLabel",
  "userId",
  "userName",
  "userAgent",
];
const goActivity = exists("backend/internal/httpapi/activity.go")
  ? read("backend/internal/httpapi/activity.go")
  : "";
for (const f of feActivityFields) {
  if (!goActivity.includes(`json:"${f}`)) {
    issues.push({
      severity: "high",
      area: "dto-parity",
      issue: `Go activityDTO missing json:"${f}" (FE ActivityRow expects it)`,
    });
  }
}

// --- Known remaining gaps / soft checks ---
if (exists("src/lib/realtime-notifications.ts")) {
  const rt = read("src/lib/realtime-notifications.ts");
  if (rt.includes("/api/activity") && !rt.includes("fetchAdminActivity")) {
    issues.push({
      severity: "medium",
      area: "activity-client",
      issue:
        "realtime-notifications should use fetchAdminActivity (own-rows for non-admins)",
    });
  }
}

if (exists("src/app/(main)/activity-logs/page.tsx")) {
  const page = read("src/app/(main)/activity-logs/page.tsx");
  if (!page.includes("fetchDbUsers")) {
    issues.push({
      severity: "medium",
      area: "activity-page",
      issue: "By-user tab should load directory via fetchDbUsers (/api/auth/users)",
    });
  }
}

// Deploy drift: FE uses helpers that need deployed API with sessionId/user filters
mustInclude(
  "backend/internal/httpapi/activity.go",
  "meta->>'sessionId'",
  "deploy",
  "API must filter meta->>'sessionId' — redeploy Go if production lacks this",
  "critical",
);

const order: Sev[] = ["critical", "high", "medium", "low"];
issues.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

console.log("=== Activity / profile FE↔BE gap audit ===\n");
if (!issues.length) {
  printOk();
  process.exit(0);
}

const counts: Record<string, number> = {};
for (const i of issues) {
  counts[i.severity] = (counts[i.severity] || 0) + 1;
  console.log(`[${i.severity.toUpperCase()}] (${i.area}) ${i.issue}`);
}
console.log("\n--- summary ---");
for (const s of order) {
  if (counts[s]) console.log(`${s}: ${counts[s]}`);
}
console.log(`total: ${issues.length}`);
process.exit(issues.some((i) => i.severity === "critical" || i.severity === "high") ? 1 : 0);

function printOk() {
  console.log("0 issues — FE activity/profile clients aligned with Go contracts.");
}
