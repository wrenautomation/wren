#!/usr/bin/env node
/**
 * Scorecards (Backstage's, without Backstage): one row per workspace package and per Restate
 * service, graded A to F, worst first. Read only, local, no network. Run it through
 * `map/_meta/build.sh --scorecard`; `scripts/gates.sh` prints the worst rows at hand-off.
 *
 * Each row's checks (· = does not apply):
 * - card: a map card is about it. Package: a card's `entity:` sits in it. Service: a card other
 *   than [[platform/restate-services]] names it in backticks.
 * - unit / int: tests exist. Package: a `test:unit` / `test:integration` script and a test file
 *   for it (`test/integration/` is integration, every other `*.test.ts` is unit). Service: a test
 *   file says its name, or one in its package imports the file that declares it.
 * - health: a running thing reports its health. A loop service: LoopWatch watches it. A deployed
 *   app (wrangler or `build:lambda`): a `/health` route, or it binds LoopWatch. A package: one of
 *   its services is a loop. Plain services and libraries: ·.
 * - owner: the owning card lists it. Package: `map/effects/CONTEXT.md` routes a change to it.
 *   Service: [[platform/restate-services]] names it.
 * Grade by misses: none A, 1 B, 2 C, 3 D, 4 or more F.
 *
 * The services come from the component registry (each `components.ts`'s `provides.services`, and
 * `PLATFORM.services` in apps/worker), which `apps/worker/src/components.test.ts` holds to every
 * service the worker binds. A service's package is where it is declared, found by its name.
 *
 * Flags: --top=N (the N worst rows), --min=<grade> (exit 1 when a row is below it), --json.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repoFiles } from "../../scripts/portal-sources.mjs";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));

const GRADES = "ABCDF";
const CHECKS = ["card", "unit", "int", "health", "owner"];
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const texts = new Map();
/** A file's text, read once; a tracked file deleted in the tree reads as empty. */
function text(file) {
  if (!texts.has(file)) {
    try {
      texts.set(file, readFileSync(file, "utf8"));
    } catch {
      texts.set(file, "");
    }
  }
  return texts.get(file);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const strings = (list) => [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

const files = repoFiles(["packages", "apps", "map"]);
const dirs = files
  .filter((f) => /^(packages|apps)\/[^/]+\/package\.json$/.test(f))
  .map((f) => dirname(f));
const pkgOf = (file) => dirs.find((d) => file.startsWith(`${d}/`));
const isTest = (f) => /\.test\.tsx?$/.test(f);
const sources = files.filter(
  (f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !isTest(f) && !/\/(test|stories?)\//.test(f),
);
const tests = files.filter(isTest);

// The map: every card, its entity, its text.
const cards = files
  .filter(
    (f) => /^map\/(objects\/[^/]+|processes)\/[^/]+\.md$/.test(f) && !f.endsWith("CONTEXT.md"),
  )
  .map((file) => ({
    file,
    entity: (text(file).match(/^entity: *`?([^`\n]*)/m)?.[1] ?? "").trim(),
  }));
const OWNER_SERVICES = "map/objects/platform/restate-services.md";
const OWNER_PACKAGES = "map/effects/CONTEXT.md";

// The services, from the component registry.
const loopsListed = new Set();
const services = new Map();
for (const f of files.filter((f) => /^packages\/[^/]+\/src\/(.*\/)?components\.ts$/.test(f))) {
  for (const m of text(f).matchAll(/\bservices:\s*\[([^\]]*)\]/g))
    for (const name of strings(m[1])) services.set(name, { name, listedIn: pkgOf(f) });
  for (const m of text(f).matchAll(/\bloops:\s*\[([^\]]*)\]/g))
    for (const name of strings(m[1])) loopsListed.add(name);
}
const platform = text("apps/worker/src/components.ts").match(
  /export const PLATFORM = \{\s*services: \{([\s\S]*?)\n {2}\},/,
);
for (const m of platform?.[1].matchAll(/^ {4}([A-Z]\w*):/gm) ?? [])
  services.set(m[1], { name: m[1], listedIn: "apps/worker" });

const declSources = sources.filter((f) => !f.endsWith("components.ts"));
const RESTATE = /restate\.(service|object|workflow)\(|portalService\(|makeLoopObject\(/;
/**
 * Where `name` is declared: a literal at `makeLoopObject(`, or a `name:` line beside Restate (a
 * client's inline `({ name: "X" })` is a call, not a declaration), else a constant.
 */
function declared(name) {
  const direct = new RegExp(
    `makeLoopObject\\(\\s*"${esc(name)}"|^\\s*name:\\s*"${esc(name)}"`,
    "m",
  );
  const constant = new RegExp(`\\b([A-Z][A-Z0-9_]*)\\s*=\\s*(\\{\\s*name:\\s*)?"${esc(name)}"`);
  let best = null;
  for (const file of declSources) {
    const t = text(file);
    if (!t.includes(`"${name}"`)) continue;
    const score = direct.test(t) && RESTATE.test(t) ? 2 : constant.test(t) ? 1 : 0;
    if (score > (best?.score ?? 0)) best = { file, score, constant: t.match(constant)?.[1] };
    if (score === 2) break;
  }
  return best;
}
/** A loop: listed as one by its component, or built by `makeLoopObject` from its name or constant. */
function isLoop(name, decl) {
  if (loopsListed.has(name)) return true;
  if (!decl) return false;
  if (new RegExp(`makeLoopObject\\(\\s*"${esc(name)}"`).test(text(decl.file))) return true;
  if (!decl.constant) return false;
  const via = new RegExp(`makeLoopObject\\(\\s*${decl.constant}\\b`);
  return declSources.some((f) => pkgOf(f) === pkgOf(decl.file) && via.test(text(f)));
}
const named = (name) => new RegExp(`\`${esc(name)}[\`/{.]`);

const rows = [];
const pkgLoops = new Set();
for (const s of services.values()) {
  const decl = declared(s.name);
  const pkg = decl ? pkgOf(decl.file) : s.listedIn;
  const loop = isLoop(s.name, decl);
  if (loop) pkgLoops.add(pkg);
  const base = decl ? decl.file.replace(/^.*\//, "").replace(/\.tsx?$/, "") : null;
  const imports = base && base !== "index" ? new RegExp(`[/"]${esc(base)}(\\.js)?"`) : null;
  const covering = tests.filter(
    (f) =>
      text(f).includes(`"${s.name}"`) || (imports && pkgOf(f) === pkg && imports.test(text(f))),
  );
  const mention = named(s.name);
  rows.push({
    kind: "service",
    name: s.name,
    pkg,
    card: cards.some((c) => c.file !== OWNER_SERVICES && mention.test(text(c.file))),
    unit: covering.some((f) => !f.includes("/test/integration/")),
    int: covering.some((f) => f.includes("/test/integration/")),
    health: loop ? true : null,
    owner: mention.test(text(OWNER_SERVICES)),
  });
}

for (const dir of dirs) {
  const pkg = JSON.parse(text(`${dir}/package.json`));
  const own = tests.filter((f) => f.startsWith(`${dir}/`));
  const mine = sources.filter((f) => f.startsWith(`${dir}/`));
  const deployed =
    dir.startsWith("apps/") &&
    (files.some((f) => f.startsWith(`${dir}/wrangler.`)) || Boolean(pkg.scripts?.["build:lambda"]));
  const served = mine.some((f) => /["'`]\/health(z)?["'`]|makeLoopWatch\(/.test(text(f)));
  rows.push({
    kind: "package",
    name: dir,
    pkg: dir,
    card: cards.some((c) => c.entity.startsWith(`${dir}/`)),
    unit: Boolean(pkg.scripts?.["test:unit"]) && own.some((f) => !f.includes("/test/integration/")),
    int:
      Boolean(pkg.scripts?.["test:integration"]) &&
      own.some((f) => f.includes("/test/integration/")),
    health: deployed ? served || pkgLoops.has(dir) : pkgLoops.has(dir) ? true : null,
    owner: text(OWNER_PACKAGES).includes(`${dir}/`) || text(OWNER_PACKAGES).includes(`\`${dir}\``),
  });
}

for (const r of rows) {
  r.misses = CHECKS.filter((c) => r[c] === false);
  r.grade = GRADES[Math.min(r.misses.length, 4)];
}
rows.sort(
  (a, b) =>
    b.misses.length - a.misses.length ||
    a.kind.localeCompare(b.kind) ||
    a.name.localeCompare(b.name),
);

const min = typeof args.min === "string" ? args.min.toUpperCase() : null;
if (min && !GRADES.includes(min)) {
  console.error(`scorecard: --min takes one of ${GRADES.split("").join(" ")}`);
  process.exit(2);
}
const below = min ? rows.filter((r) => GRADES.indexOf(r.grade) > GRADES.indexOf(min)) : [];

if (args.json) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const shown = args.top ? rows.slice(0, Number(args.top)) : rows;
  const mark = (v) => (v === null ? "·" : v ? "✓" : "✗");
  const label = (r) => (r.kind === "service" ? `${r.name} (${r.pkg ?? "?"})` : r.name);
  const width = Math.max(...shown.map((r) => label(r).length), 4);
  const count = (k) => rows.filter((r) => r.kind === k).length;
  const tally = [...GRADES].map((g) => `${g} ${rows.filter((r) => r.grade === g).length}`);
  console.log(
    `scorecard: ${count("package")} packages, ${count("service")} services · ${tally.join(" · ")}`,
  );
  console.log(
    `grade  kind     ${"name".padEnd(width)}  ${CHECKS.map((c) => c.padEnd(7)).join("")}`,
  );
  for (const r of shown)
    console.log(
      `${r.grade.padEnd(7)}${r.kind.padEnd(9)}${label(r).padEnd(width)}  ${CHECKS.map((c) => mark(r[c]).padEnd(7)).join("")}`,
    );
  if (shown.length < rows.length) console.log(`… ${rows.length - shown.length} more rows`);
  console.log(
    "skipped: deploy current (Restate registers a Lambda version, not a commit; its admin API is on the box) · last green gate (no local record)",
  );
}
if (below.length) {
  console.log(`scorecard: ${below.length} rows below ${min}`);
  process.exit(1);
}
