/**
 * Go Gin API base URL (Railway). When set, next.config rewrites /api/* there.
 */
export function isGoApiConfigured(): boolean {
  return Boolean(process.env.GO_API_URL?.trim());
}

export function goApiBaseUrl(): string {
  return (process.env.GO_API_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
}
