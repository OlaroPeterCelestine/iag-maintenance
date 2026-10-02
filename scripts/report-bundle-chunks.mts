/**
 * Bundle chunk report — what each route actually ships to the browser.
 *
 * Reads the production build in `.next` and prints the heaviest chunks, the
 * heaviest routes, and the shared baseline every page pays for. Sizes are
 * reported gzipped as well as raw, because gzip is what crosses the wire and
 * raw is what the browser has to parse — the two tell different stories about
 * a slow page.
 *
 * Usage: npm run build && npm run report:chunks
 *        npm run report:chunks -- --json      (machine-readable)
 *        npm run report:chunks -- --top 40
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const nextDir = join(root, ".next");
const staticDir = join(nextDir, "static");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const topIndex = args.indexOf("--top");
const TOP = topIndex >= 0 ? Number(args[topIndex + 1]) || 25 : 25;

/** Chunks above this gzipped size are called out as worth splitting. */
const HEAVY_CHUNK_GZIP_KB = 120;
/** First-load budget per route; Next's own guidance sits around this mark. */
const ROUTE_BUDGET_GZIP_KB = 350;

if (!existsSync(staticDir)) {
  console.error(
    `No build found at ${relative(root, staticDir)}.\n` +
      `Run \`npm run build\` first (or \`npm run clean && npm run build\` for a cold build).`,
  );
  process.exit(1);
}

type FileSize = { file: string; rawBytes: number; gzipBytes: number };

const sizeCache = new Map<string, FileSize>();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(js|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function measure(absPath: string): FileSize | null {
  const cached = sizeCache.get(absPath);
  if (cached) return cached;
  if (!existsSync(absPath)) return null;
  const raw = readFileSync(absPath);
  const entry: FileSize = {
    file: relative(nextDir, absPath),
    rawBytes: statSync(absPath).size,
    gzipBytes: gzipSync(raw).length,
  };
  sizeCache.set(absPath, entry);
  return entry;
}

function kb(bytes: number): number {
  return Math.round((bytes / 1024) * 10) / 10;
}

function fmt(bytes: number): string {
  const k = kb(bytes);
  return k >= 1024 ? `${(k / 1024).toFixed(2)} MB` : `${k.toFixed(1)} KB`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function padStart(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

// --- every emitted asset -----------------------------------------------------
const allFiles = walk(staticDir)
  .map(measure)
  .filter((f): f is FileSize => Boolean(f))
  .sort((a, b) => b.gzipBytes - a.gzipBytes);

const totalRaw = allFiles.reduce((sum, f) => sum + f.rawBytes, 0);
const totalGzip = allFiles.reduce((sum, f) => sum + f.gzipBytes, 0);

// --- per-route first load ----------------------------------------------------
type RouteRow = { route: string; files: number; rawBytes: number; gzipBytes: number };

function readPagesManifest(): Record<string, string[]> {
  const path = join(nextDir, "build-manifest.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      pages?: Record<string, string[]>;
    };
    return parsed.pages || {};
  } catch {
    return {};
  }
}

type RscManifest = {
  clientModules?: Record<string, { chunks?: string[] }>;
};

/**
 * App Router routes are not in build-manifest.json — Next emits one
 * `page_client-reference-manifest.js` per route that assigns
 * `globalThis.__RSC_MANIFEST["<route>"]`. Its clientModules carry the chunk
 * list, so the union across a route's modules is its client payload.
 */
function readAppRouteChunks(): { pages: Record<string, string[]>; modules: Map<string, string[]> } {
  const pages: Record<string, string[]> = {};
  /** chunk file -> source modules that pull it in, for attribution. */
  const chunkOwners = new Map<string, string[]>();
  const appDir = join(nextDir, "server", "app");
  if (!existsSync(appDir)) return { pages, modules: chunkOwners };

  const manifests: string[] = [];
  const collect = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.name.endsWith("_client-reference-manifest.js")) manifests.push(full);
    }
  };
  collect(appDir);

  for (const file of manifests) {
    const src = readFileSync(file, "utf8");
    const match = /globalThis\.__RSC_MANIFEST\[(?:"|')(.+?)(?:"|')\]\s*=\s*(\{[\s\S]*?\})\s*;?\s*$/m.exec(
      src,
    );
    if (!match) continue;
    const route = match[1].replace(/\/page$/, "").replace(/\(([^)]+)\)\//g, "") || "/";
    let parsed: RscManifest;
    try {
      parsed = JSON.parse(match[2]) as RscManifest;
    } catch {
      continue;
    }
    const chunks = new Set<string>();
    for (const [moduleId, entry] of Object.entries(parsed.clientModules || {})) {
      for (const chunk of entry.chunks || []) {
        // Chunk paths are served as /_next/static/... but live at .next/static/...
        const relPath = chunk.replace(/^\/_next\//, "");
        chunks.add(relPath);
        const owners = chunkOwners.get(relPath) || [];
        owners.push(moduleId);
        chunkOwners.set(relPath, owners);
      }
    }
    if (chunks.size) pages[route] = [...chunks];
  }
  return { pages, modules: chunkOwners };
}

const { pages: appPages, modules: chunkOwners } = readAppRouteChunks();
const pages = { ...readPagesManifest(), ...appPages };

/** Best-guess source of a chunk: the npm package or src/ file that pulls it in. */
function attributeChunk(file: string): string {
  const owners = chunkOwners.get(file);
  if (!owners?.length) return "";
  const labels = new Set<string>();
  for (const owner of owners) {
    const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(owner);
    if (pkg) {
      labels.add(pkg[1]);
      continue;
    }
    const local = /\[project\]\/(src\/[^\s"]+?)(?:\s|$|\.[jt]sx?)/.exec(owner);
    if (local) labels.add(local[1]);
  }
  const list = [...labels].filter((l) => l !== "next").slice(0, 3);
  return list.join(", ");
}

const routes: RouteRow[] = Object.entries(pages)
  .map(([route, files]) => {
    const unique = [...new Set(files)];
    let rawBytes = 0;
    let gzipBytes = 0;
    let counted = 0;
    for (const file of unique) {
      const entry = measure(join(nextDir, file));
      if (!entry) continue;
      rawBytes += entry.rawBytes;
      gzipBytes += entry.gzipBytes;
      counted += 1;
    }
    return { route, files: counted, rawBytes, gzipBytes };
  })
  .filter((r) => r.files > 0)
  .sort((a, b) => b.gzipBytes - a.gzipBytes);

// A chunk on (nearly) every route is the shared baseline — trimming one of
// those helps every page, while trimming a route-only chunk helps one page.
const routeCount = Object.keys(pages).length;
const fileUse = new Map<string, number>();
for (const files of Object.values(pages)) {
  for (const file of new Set(files)) {
    fileUse.set(file, (fileUse.get(file) || 0) + 1);
  }
}
const sharedFiles = [...fileUse.entries()]
  .filter(([, count]) => routeCount > 1 && count >= routeCount * 0.9)
  .map(([file]) => measure(join(nextDir, file)))
  .filter((f): f is FileSize => Boolean(f));
const sharedGzip = sharedFiles.reduce((sum, f) => sum + f.gzipBytes, 0);

const heavy = allFiles.filter((f) => kb(f.gzipBytes) >= HEAVY_CHUNK_GZIP_KB);
const overBudget = routes.filter((r) => kb(r.gzipBytes) >= ROUTE_BUDGET_GZIP_KB);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        totals: { files: allFiles.length, rawKb: kb(totalRaw), gzipKb: kb(totalGzip) },
        sharedBaselineGzipKb: kb(sharedGzip),
        heaviestChunks: allFiles.slice(0, TOP).map((f) => ({
          file: f.file,
          rawKb: kb(f.rawBytes),
          gzipKb: kb(f.gzipBytes),
        })),
        heaviestRoutes: routes.slice(0, TOP).map((r) => ({
          route: r.route,
          files: r.files,
          rawKb: kb(r.rawBytes),
          gzipKb: kb(r.gzipBytes),
        })),
        overBudget: overBudget.map((r) => r.route),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

console.log("");
console.log("Bundle chunk report");
console.log("===================");
console.log(
  `${allFiles.length} build assets · ${fmt(totalRaw)} raw · ${fmt(totalGzip)} gzipped` +
    (sharedFiles.length
      ? `\nShared baseline every route loads: ${fmt(sharedGzip)} gzipped across ${sharedFiles.length} files`
      : ""),
);

console.log("");
console.log(`Heaviest chunks (top ${Math.min(TOP, allFiles.length)}, by gzipped size)`);
console.log(`${pad("chunk", 34)}${padStart("gzip", 11)}${padStart("raw", 12)}   contains`);
for (const f of allFiles.slice(0, TOP)) {
  const flag = kb(f.gzipBytes) >= HEAVY_CHUNK_GZIP_KB ? " *" : "  ";
  const source = attributeChunk(f.file) || "—";
  console.log(
    `${pad(f.file.replace(/^static\//, ""), 34)}${padStart(fmt(f.gzipBytes), 11)}${padStart(fmt(f.rawBytes), 12)}${flag} ${source}`,
  );
}
console.log("(* over the heavy-chunk threshold)");

if (routes.length) {
  console.log("");
  console.log(`Heaviest routes (first load, top ${Math.min(TOP, routes.length)})`);
  console.log(`${pad("route", 62)}${padStart("gzip", 11)}${padStart("files", 8)}`);
  for (const r of routes.slice(0, TOP)) {
    const flag = kb(r.gzipBytes) >= ROUTE_BUDGET_GZIP_KB ? "  <-- over budget" : "";
    console.log(
      `${pad(r.route, 62)}${padStart(fmt(r.gzipBytes), 11)}${padStart(String(r.files), 8)}${flag}`,
    );
  }
}

console.log("");
if (heavy.length || overBudget.length) {
  console.log("Findings");
  if (heavy.length) {
    console.log(
      `· ${heavy.length} chunk(s) over ${HEAVY_CHUNK_GZIP_KB} KB gzipped — split them behind ` +
        `next/dynamic or a lazy import so only the pages that need them pay.`,
    );
  }
  if (overBudget.length) {
    console.log(
      `· ${overBudget.length} route(s) over the ${ROUTE_BUDGET_GZIP_KB} KB first-load budget: ` +
        overBudget
          .slice(0, 8)
          .map((r) => r.route)
          .join(", ") +
        (overBudget.length > 8 ? ", …" : ""),
    );
  }
} else {
  console.log(
    `No chunk exceeds ${HEAVY_CHUNK_GZIP_KB} KB gzipped and no route exceeds the ` +
      `${ROUTE_BUDGET_GZIP_KB} KB first-load budget.`,
  );
}
console.log("");
