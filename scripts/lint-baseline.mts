/**
 * CI blocks on NEW lint errors only, not the pre-existing ~72-error backlog
 * (mostly react-hooks/set-state-in-effect — deliberately deferred, see the
 * "Remaining: ... They need per-screen verification, not a lint sweep" note
 * on f601d5b8). Blocking on the whole backlog would demand it get cleared
 * under CI pressure instead of the planned per-screen pass; leaving lint
 * fully non-blocking (the old `continue-on-error: true`) let real regressions
 * merge silently. This is the middle ground: a per (file, rule) count
 * baseline, committed as .eslint-baseline.json — CI fails only when a file's
 * count for a rule goes up, or a new file/rule pair appears.
 *
 * Counting per (file, rule) rather than matching exact line/message keeps
 * this robust to lines shifting from unrelated edits above a finding.
 *
 * Usage:
 *   npx tsx scripts/lint-baseline.mts           # check against the baseline (CI)
 *   npx tsx scripts/lint-baseline.mts --write   # regenerate the baseline (after a real cleanup pass)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const baselinePath = path.join(repoRoot, ".eslint-baseline.json");

type EslintMessage = { ruleId: string | null; severity: number };
type EslintResult = { filePath: string; messages: EslintMessage[] };
type Counts = Record<string, number>;

function runEslint(): EslintResult[] {
  let raw = "";
  try {
    raw = execFileSync("npx", ["eslint", "src", "-f", "json"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // eslint exits 1 when it finds errors — stdout still has the JSON report.
    const e = err as { stdout?: string };
    raw = e.stdout || "";
  }
  return JSON.parse(raw || "[]") as EslintResult[];
}

function toCounts(results: EslintResult[]): Counts {
  const counts: Counts = {};
  for (const result of results) {
    const relFile = path.relative(repoRoot, result.filePath);
    for (const msg of result.messages) {
      if (msg.severity !== 2) continue; // errors only — warnings aren't gated
      const key = `${relFile}::${msg.ruleId ?? "(unknown)"}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

const results = runEslint();
const current = toCounts(results);

if (process.argv.includes("--write")) {
  writeFileSync(baselinePath, JSON.stringify(current, null, 2) + "\n");
  const total = Object.values(current).reduce((a, b) => a + b, 0);
  console.log(`Wrote ${baselinePath} — ${total} error(s) across ${Object.keys(current).length} (file, rule) pair(s).`);
  process.exit(0);
}

let baseline: Counts = {};
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch {
  console.error(`No baseline at ${baselinePath} — run with --write once to create it.`);
  process.exit(1);
}

const regressions: string[] = [];
for (const [key, count] of Object.entries(current)) {
  const before = baseline[key] || 0;
  if (count > before) {
    regressions.push(`${key}: ${before} → ${count}`);
  }
}

if (regressions.length) {
  console.error(`New lint errors beyond the baseline (${regressions.length}):`);
  for (const line of regressions) console.error(`  ${line}`);
  console.error(
    "\nFix these before merging, or if this is a deliberate, reviewed change to the backlog, " +
      "run `npx tsx scripts/lint-baseline.mts --write` and commit the updated .eslint-baseline.json.",
  );
  process.exit(1);
}

console.log("lint-baseline: ok — no new errors beyond the committed baseline.");
