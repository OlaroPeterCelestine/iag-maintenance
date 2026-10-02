/** Firebase-Crashlytics-style crash event captured from the browser / Next edge. */

export type CrashSeverity = "fatal" | "error" | "warning";

export type CrashSource =
  | "window.onerror"
  | "unhandledrejection"
  | "react-boundary"
  | "global-error"
  | "manual"
  | "import"
  | "proxy"
  | "console";

export type CrashEventInput = {
  message: string;
  name?: string;
  stack?: string;
  severity?: CrashSeverity;
  source?: CrashSource;
  url?: string;
  route?: string;
  userAgent?: string;
  release?: string;
  userId?: string;
  username?: string;
  role?: string;
  /** Stamped server-side from proxy headers; client values are ignored. */
  ip?: string;
  componentStack?: string;
  context?: Record<string, string | number | boolean | null | undefined>;
  /** Client-side occurrence time (ISO). Server stamps receivedAt. */
  occurredAt?: string;
};

export type CrashEvent = CrashEventInput & {
  id: string;
  fingerprint: string;
  title: string;
  severity: CrashSeverity;
  source: CrashSource;
  occurredAt: string;
  receivedAt: string;
};

export type CrashIssue = {
  fingerprint: string;
  title: string;
  severity: CrashSeverity;
  source: CrashSource;
  count: number;
  firstSeen: string;
  lastSeen: string;
  sample: CrashEvent;
  routes: string[];
  users: string[];
  ips: string[];
};

/** One row of the "who / where from" breakdown — a user or an IP address. */
export type CrashActorRow = {
  key: string;
  label: string;
  secondary: string;
  count: number;
  fatalCount: number;
  errorCount: number;
  warningCount: number;
  issues: number;
  firstSeen: string;
  lastSeen: string;
  lastTitle: string;
  routes: string[];
  /** IPs used by a user row, users seen on an IP row. */
  related: string[];
};

export type CrashQuery = {
  hours?: number;
  limit?: number;
  q?: string;
  user?: string;
  ip?: string;
  severity?: string;
  source?: string;
  route?: string;
};

export type CrashAnalyticsSummary = {
  ok: true;
  windowHours: number;
  from: string;
  to: string;
  totalEvents: number;
  uniqueIssues: number;
  fatalCount: number;
  errorCount: number;
  warningCount: number;
  affectedUsers: number;
  affectedIps: number;
  topIssues: CrashIssue[];
  byUser: CrashActorRow[];
  byIp: CrashActorRow[];
  timeline: { hour: string; count: number }[];
  bySource: { source: string; count: number }[];
  byRoute: { route: string; count: number }[];
  events: CrashEvent[];
  storage: "redis" | "memory";
};
