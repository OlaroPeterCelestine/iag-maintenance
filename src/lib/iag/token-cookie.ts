/**
 * Platform access tokens carry every granted permission. A token is often
 * larger than the 4KB a browser will store in one cookie, so the browser
 * drops `iag_pt` and keeps only the small app session cookie. The dashboard
 * still opens, and every shop-floor call goes out with no Authorization
 * header.
 *
 * Split the value across `name`, `name.0`, `name.1`, … so it actually sticks.
 */

/** Room left for the cookie name and attributes under the 4096-byte browser cap. */
export const TOKEN_COOKIE_CHUNK = 3200;
const MAX_CHUNKS = 12;

export type TokenCookiePart = { name: string; value: string };

export function planTokenCookies(
  name: string,
  value: string,
): { set: TokenCookiePart[]; clear: string[] } {
  const chunkNames = Array.from({ length: MAX_CHUNKS }, (_, i) => `${name}.${i}`);
  if (value.length > TOKEN_COOKIE_CHUNK * MAX_CHUNKS) {
    throw new Error("Platform token is too large to store in session cookies");
  }
  if (value.length <= TOKEN_COOKIE_CHUNK) {
    return { set: [{ name, value }], clear: chunkNames };
  }
  const set: TokenCookiePart[] = [];
  for (let i = 0; i < value.length; i += TOKEN_COOKIE_CHUNK) {
    set.push({ name: `${name}.${set.length}`, value: value.slice(i, i + TOKEN_COOKIE_CHUNK) });
  }
  const used = new Set(set.map((part) => part.name));
  return { set, clear: [name, ...chunkNames.filter((n) => !used.has(n))] };
}

export function readTokenCookie(
  get: (name: string) => string | undefined | null,
  name: string,
): string | null {
  const whole = get(name);
  if (whole) return whole;
  let out = "";
  for (let i = 0; i < MAX_CHUNKS; i += 1) {
    const part = get(`${name}.${i}`);
    if (!part) break;
    out += part;
  }
  return out || null;
}

/** Base name plus every chunk, for logout. */
export function tokenCookieNames(name: string): string[] {
  return [name, ...Array.from({ length: MAX_CHUNKS }, (_, i) => `${name}.${i}`)];
}

type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
};

/** Write a platform token, splitting it when one cookie cannot hold it. */
export function writeTokenCookie(
  set: (name: string, value: string, options: CookieOptions) => void,
  name: string,
  value: string,
  options: CookieOptions,
) {
  const plan = planTokenCookies(name, value);
  for (const stale of plan.clear) {
    set(stale, "", { ...options, maxAge: 0 });
  }
  for (const part of plan.set) {
    set(part.name, part.value, options);
  }
}
