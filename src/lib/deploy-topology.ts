/**
 * Live deploy topology for IAG ERP.
 *
 * Vercel team inspireafrcagroup / project financialtooliag is Pro (Team).
 * Pro serverless default is 15s — too short for SSE (heartbeat is 25s).
 * Railway "finace trial" Hobby services all run in europe-west4 (Netherlands).
 * Pin Vercel functions to fra1 so Uganda → Frankfurt → Amsterdam stays on one
 * continent instead of hopping via iad1 (Washington, D.C.).
 */

export const VERCEL_PLAN = "pro";
export const VERCEL_TEAM = "inspireafrcagroup";
export const VERCEL_PROJECT = "financialtooliag";
export const VERCEL_REGION = "fra1";

/** Pro/Team max for a single serverless invocation (seconds). */
export const VERCEL_SSE_MAX_DURATION_SEC = 300;
/** Close the stream before Vercel hard-kills it so EventSource reconnects cleanly. */
export const VERCEL_SSE_CLOSE_AFTER_MS = 270_000;

export const RAILWAY_WORKSPACE = "PETER Celestine OLARO";
export const RAILWAY_PROJECT = "finace trial";
export const RAILWAY_PLAN = "hobby";
export const RAILWAY_REGION = "europe-west4-drams3a";

export function isVercelRuntime(): boolean {
  return Boolean(process.env.VERCEL);
}

export function vercelSseLifetimeSec(): number {
  if (!isVercelRuntime()) return 0;
  return VERCEL_SSE_MAX_DURATION_SEC;
}

export function deployTopologyDetail(): string {
  if (isVercelRuntime()) {
    const region = process.env.VERCEL_REGION || VERCEL_REGION;
    return `Vercel ${VERCEL_PLAN} · ${region} · SSE ${VERCEL_SSE_MAX_DURATION_SEC}s. Railway ${RAILWAY_PLAN} · ${RAILWAY_REGION}.`;
  }
  return `Railway ${RAILWAY_PLAN} · ${RAILWAY_REGION} (long-lived SSE/WS on custom server).`;
}
