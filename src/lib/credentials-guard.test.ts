/**
 * Nothing that grants access may be compiled into this app.
 *
 * `auth.ts` shipped one account — `admin`, Administrator — whose
 * `DEMO_PASSWORD = "iagdemo"` was committed to this repository and inlined into
 * the browser bundle by Next. Anyone reading the source, or the shipped JS,
 * could sign in with full rights. (A second `superadmin` account had already
 * been removed here on the same reasoning; this is the other half.)
 *
 * `loginWithCredentials` only accepted them when `FRONTEND_ONLY` was true, and
 * the design intent was right — its own docstring said "sign in against Postgres
 * users only, no hardcoded fallback". The flag defaulted to true, which inverted
 * it. Two separately-reasonable decisions produced a live credential.
 *
 * That is what this file guards, and it is deliberately a source scan rather
 * than a behavioural test. The failure is not "login misbehaves" — it is "a
 * credential exists in code at all", which no amount of exercising the login
 * path can see. A scan is also what catches it coming back in a file nobody
 * thought to write a test for.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !full.endsWith("credentials-guard.test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC);
const rel = (f: string) => f.slice(SRC.length + 1);

/**
 * Executable text only — comments stripped.
 *
 * A comment naming what was removed is exactly the history that explains why
 * the code looks like this, and the sibling apps that made this change keep
 * theirs. Scanning raw source flags those, so the guard would either fail on
 * an accurate comment or push people to delete the explanation to get green.
 * Both are worse than the risk being guarded.
 *
 * The first version of this file scanned the raw body while its own comment
 * claimed to skip prose — which is the same defect it exists to catch, in
 * miniature: a stated guarantee the code did not implement.
 */
function code(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("no credential ships in the bundle", () => {
  it("does not reintroduce the removed demo password", () => {
    // password-strength.ts is the one legitimate home for this string: it is a
    // blocklist entry and must keep rejecting the password it used to be.
    const offenders = FILES.filter((f) => {
      if (rel(f) === "lib/password-strength.ts") return false;
      return /["'`]iagdemo["'`]/.test(code(readFileSync(f, "utf8")));
    }).map(rel);

    expect(
      offenders,
      `"iagdemo" is back as a value in:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("declares no account list with a password field", () => {
    // The shape that shipped: an exported array of objects each carrying a
    // password. Catches a rename of SAMPLE_ACCOUNTS as well as its return.
    const offenders = FILES.filter((f) => {
      const body = code(readFileSync(f, "utf8"));
      if (!/\bpassword\s*:/.test(body)) return false;
      // A literal password beside a username or email is a credential, not a
      // form field or an API payload built from user input.
      return /password\s*:\s*["'`][^"'`]{3,}["'`]/.test(body);
    }).map(rel);

    expect(
      offenders,
      `A literal password appears beside an account in:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps iagdemo in the weak-password blocklist", () => {
    // The mirror of the first check: removing it from the blocklist would let
    // anyone who knows the old password keep using it.
    const blocklist = readFileSync(join(SRC, "lib", "password-strength.ts"), "utf8");
    expect(blocklist, "iagdemo must stay rejected").toContain("iagdemo");
  });
});

describe("standalone mode is not the default", () => {
  it("FRONTEND_ONLY defaults to false", () => {
    const body = readFileSync(join(SRC, "lib", "frontend-only.ts"), "utf8");

    // The original read `!== "false"`, so anything unset was standalone: every
    // data call resolved to a synthetic 200 with an empty payload and the auth
    // probes returned true unconditionally. A deployment with no backend
    // rendered as a working-but-empty app rather than a disconnected one.
    expect(
      body,
      "FRONTEND_ONLY must opt IN to standalone, not out of it — an unset " +
        "variable has to mean 'expect a backend'",
    ).toMatch(/===\s*["']true["']/);
    expect(body).not.toMatch(/!==\s*["']false["']/);
  });

  it("the standalone login path grants nothing", () => {
    const auth = readFileSync(join(SRC, "lib", "auth.ts"), "utf8");
    const start = auth.indexOf("export async function loginWithCredentials");
    expect(start, "loginWithCredentials was renamed or removed").toBeGreaterThan(-1);

    const branch = auth.slice(start, auth.indexOf("loginViaDatabase", start));
    expect(branch, "the FRONTEND_ONLY branch is gone — check this guard still applies")
      .toContain("FRONTEND_ONLY");
    // It must refuse, not authenticate: no finishLogin, no session, no user row.
    expect(
      branch,
      "the standalone branch calls finishLogin again — it must refuse instead",
    ).not.toContain("finishLogin");
    expect(branch).toMatch(/ok:\s*false/);
  });
});

describe("no fabricated directory entries", () => {
  it("defaultUsers is empty", () => {
    // It held one invented administrator and was the fallback whenever the real
    // directory could not be read, so it reached the Users screen and the
    // recipient list for request emails — where an invented address is
    // indistinguishable from a real one until something is sent to it.
    const body = readFileSync(join(SRC, "lib", "manager-settings.ts"), "utf8");
    const decl = /export const defaultUsers: UserRow\[\] = (\[[\s\S]*?\]);/.exec(body);
    expect(decl, "defaultUsers was renamed or removed").toBeTruthy();
    expect(
      decl![1].replace(/\s/g, ""),
      "defaultUsers must stay empty — when the directory cannot be read the " +
        "honest answer is nobody, not a plausible-looking stand-in",
    ).toBe("[]");
  });

  it("the demo document pack stays deleted", () => {
    const gone = ["lib/sample-documents.ts", "lib/ledger/accounting-principles-seed.ts"];
    for (const path of gone) {
      let exists = true;
      try {
        statSync(join(SRC, path));
      } catch {
        exists = false;
      }
      expect(exists, `${path} is back — it wrote fake business records upstream`).toBe(false);
    }
  });
});
