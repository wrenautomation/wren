// The package layers (designs/2026-10-24-code-quality-handoff.md, Dependency inversion): arrows
// point down. A package imports its own layer or a lower one, never a higher one, and never in a
// cycle; apps import anything. A new package goes in one row here, or this fails naming it.
import { existsSync, globSync, readdirSync, readFileSync } from "node:fs";

const LAYERS = [
  // What everything stands on: no product knowledge.
  "auth config connectors core db experiments llm notes offers research sites ui video",
  // Starling's shared contract: what its channels and both sides speak.
  "starling-core",
  // One vendor or one outside system behind an interface.
  "channel-sms starling-email starling-linkedin starling-meta starling-reddit starling-search starling-tiktok starling-x starling-youtube",
  // One domain, used by products: the money, the calendar, the shape, the papers, the studio.
  "books calendar documents learn niches payments pipeline starling-studio watch",
  // What a client buys or Wren runs as a loop.
  "delivery reactivation starling-inbound starling-outbound voice",
].flatMap((row, layer) => row.split(" ").map((name) => [name, layer]));
const layerOf = new Map(LAYERS);

// Package dirs from the workspace globs, nested ones too (packages/starling/*).
const dirs = readFileSync("pnpm-workspace.yaml", "utf8")
  .split("\n")
  .map((l) => /^\s*-\s*["']?(packages\/[^"'\s]+)/.exec(l)?.[1])
  .filter(Boolean)
  .flatMap((g) => globSync(g))
  .filter((d) => existsSync(`${d}/package.json`));

const deps = new Map();
for (const dir of dirs) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  } catch {
    continue;
  }
  const name = pkg.name.replace(/^@wren\//, "");
  const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  deps.set(
    name,
    Object.keys(all)
      .filter((d) => d.startsWith("@wren/"))
      .map((d) => d.slice(6)),
  );
}

const bad = [];
for (const [name, imports] of deps) {
  const layer = layerOf.get(name);
  if (layer === undefined) {
    bad.push(`${name}: not in a layer (scripts/layers-guard.mjs LAYERS)`);
    continue;
  }
  for (const dep of imports)
    if (!layerOf.has(dep)) bad.push(`${name} -> ${dep}: ${dep} is not in a layer`);
    else if (layerOf.get(dep) > layer)
      bad.push(`${name} -> ${dep}: a lower layer imports a higher one`);
}
// A cycle: DFS, the stack says where it closes.
const seen = new Set();
const walk = (name, stack) => {
  if (stack.includes(name))
    return bad.push(`cycle: ${[...stack.slice(stack.indexOf(name)), name].join(" -> ")}`);
  if (seen.has(name)) return;
  seen.add(name);
  for (const dep of deps.get(name) ?? []) walk(dep, [...stack, name]);
};
for (const name of deps.keys()) walk(name, []);

// Fetching and reading outside content is `@wrenautomation/read`'s: no package spawns yt-dlp
// itself. Apps wire its readers; they are not checked here.
const YT_DLP = /--flat-playlist|--no-playlist|ytDlp\.split\(/;
const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? d.name === "node_modules"
        ? []
        : sources(`${dir}/${d.name}`)
      : /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name)
        ? [`${dir}/${d.name}`]
        : [],
  );
for (const dir of dirs)
  for (const file of existsSync(`${dir}/src`) ? sources(`${dir}/src`) : [])
    if (YT_DLP.test(readFileSync(file, "utf8")))
      bad.push(`${file}: runs yt-dlp itself; read through @wrenautomation/read/video`);

if (bad.length) {
  console.error(bad.join("\n"));
  process.exit(1);
}
console.log(
  `${deps.size} packages, no arrow up a layer, no cycle, no yt-dlp outside @wrenautomation/read`,
);
