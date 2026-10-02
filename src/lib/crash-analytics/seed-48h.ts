import type { CrashEventInput } from "./types";

/**
 * Known crash / soft-crash incidents from the last ~48h audit window
 * (3 Aug 11:31 → 5 Aug 11:31 EAT / 2026-08-03T08:31Z → 2026-08-05T08:31Z).
 * Used to bootstrap analytics until live client reports accumulate.
 */
export function historicalCrashSeed48h(now = new Date()): CrashEventInput[] {
  const toIso = (eatLocal: string) => {
    // eatLocal: "2026-08-03T21:42:00" interpreted as Africa/Nairobi (+03)
    const d = new Date(`${eatLocal}+03:00`);
    return Number.isNaN(d.getTime()) ? now.toISOString() : d.toISOString();
  };

  return [
    {
      message:
        "TypeError: Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate.",
      name: "TypeError",
      stack:
        "TypeError: Maximum update depth exceeded\n    at ContractorInvoicesPage (src/app/(main)/projects/page.tsx)\n    at useSyncExternalStore\n    at currentUserEntityCrud",
      severity: "fatal",
      source: "react-boundary",
      route: "/projects?view=contractor-invoices",
      url: "https://app.inspireafrica.group/projects?view=contractor-invoices",
      release: "c7be3a9",
      context: {
        fixCommit: "c7be3a9",
        status: "fixed",
        note: "Unstable getSnapshot object from currentUserEntityCrud",
      },
      occurredAt: toIso("2026-08-03T18:20:00"),
    },
    {
      message: "Failed to compile — TypeScript build Error on Vercel/Railway",
      name: "BuildError",
      stack: "error TS2322: Type ... is not assignable\n    at next build",
      severity: "error",
      source: "proxy",
      route: "(ci/build)",
      context: {
        status: "transient",
        window: "≈21:42–21:45 EAT 3 Aug",
        note: "Deploy pipeline Error; subsequent deploys Ready",
      },
      occurredAt: toIso("2026-08-03T21:42:00"),
    },
    {
      message: "Failed to compile — TypeScript build Error (retry)",
      name: "BuildError",
      stack: "error TS2322: Type ... is not assignable\n    at next build",
      severity: "error",
      source: "proxy",
      route: "(ci/build)",
      context: {
        status: "transient",
        window: "≈21:45 EAT 3 Aug",
      },
      occurredAt: toIso("2026-08-03T21:45:00"),
    },
    {
      message: "read ECONNRESET while proxying /api/ledger/lines",
      name: "ProxyError",
      stack:
        "Error: read ECONNRESET\n    at TCP.onStreamRead\n    at proxyToGo (/api/ledger/lines)",
      severity: "error",
      source: "proxy",
      route: "/api/ledger/lines",
      url: "/api/ledger/lines",
      context: {
        status: "recurring",
        impact: "Reports/ledger soft-stall; sync swallows error",
      },
      occurredAt: toIso("2026-08-04T09:15:00"),
    },
    {
      message: "read ECONNRESET while proxying /api/ledger/lines",
      name: "ProxyError",
      stack:
        "Error: read ECONNRESET\n    at TCP.onStreamRead\n    at proxyToGo (/api/ledger/lines)",
      severity: "error",
      source: "proxy",
      route: "/api/ledger/lines",
      url: "/api/ledger/lines",
      context: { status: "recurring" },
      occurredAt: toIso("2026-08-04T14:40:00"),
    },
    {
      message: "read ECONNRESET while proxying /api/ledger/lines",
      name: "ProxyError",
      stack:
        "Error: read ECONNRESET\n    at TCP.onStreamRead\n    at proxyToGo (/api/ledger/lines)",
      severity: "error",
      source: "proxy",
      route: "/api/ledger/lines",
      url: "/api/ledger/lines",
      context: { status: "recurring" },
      occurredAt: toIso("2026-08-05T08:05:00"),
    },
    {
      message: "Railway healthcheck transient 503 during deploy",
      name: "DeployError",
      stack: "HTTP 503 Service Unavailable\n    at railway healthcheck",
      severity: "warning",
      source: "proxy",
      route: "/api/health",
      context: {
        status: "transient",
        note: "Deploy recovered; service Online afterward",
      },
      occurredAt: toIso("2026-08-04T16:22:00"),
    },
    {
      message:
        "Confirm modal onConfirm dropped on unmount — approval appeared to do nothing",
      name: "UiBug",
      stack:
        "Error: onConfirm not invoked\n    at FeedbackModals (src/components/feedback-modals.tsx)",
      severity: "error",
      source: "manual",
      route: "/payment-requests",
      release: "35b93d4",
      context: {
        fixCommit: "35b93d4",
        status: "fixed",
        note: "queueMicrotask(onConfirm) so unmount does not drop confirm",
      },
      occurredAt: toIso("2026-08-04T11:05:00"),
    },
    {
      message: "Stale desk status after approval confirmation",
      name: "UiBug",
      stack:
        "Error: status not refreshed\n    at PaymentRequestsPage (src/app/(main)/payment-requests/page.tsx)",
      severity: "warning",
      source: "manual",
      route: "/payment-requests",
      release: "d6a0a6a",
      context: {
        fixCommit: "d6a0a6a",
        status: "fixed",
        note: "refreshDeskFromApi + live record status",
      },
      occurredAt: toIso("2026-08-04T11:20:00"),
    },
    {
      message:
        "No error.tsx / global-error.tsx — uncaught render errors white-screen the session",
      name: "ArchitectureGap",
      stack: "Error: Missing React error boundary\n    at root layout",
      severity: "warning",
      source: "manual",
      route: "/",
      context: {
        status: "mitigated",
        note: "Crash analytics + error boundaries added with this feature",
      },
      occurredAt: toIso("2026-08-05T10:00:00"),
    },
  ];
}
