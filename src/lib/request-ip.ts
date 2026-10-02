/**
 * Client IP from proxy headers (Vercel / Railway / nginx).
 */

export function getRequestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 128);
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 128);
  return "";
}

export function getRequestUserAgent(request: Request): string {
  return (request.headers.get("user-agent") || "").slice(0, 512);
}
