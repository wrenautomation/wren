// The package layers (designs/2026-10-24-code-quality-handoff.md, Dependency inversion): arrows
// point down. A package imports its own layer or a lower one, never a higher one, and never in a
// cycle; apps import anything. A new package goes in one row here, or this fails naming it.
import { readdirSync, readFileSync } from "node:fs";

const LAYERS = [
  // What everything stands on: no product knowledge.
  "auth config connectors core db experiments llm notes offers research sites ui video",
  // One vendor or one outside system behind an interface.
  "channel-email channel-linkedin channel-meta channel-reddit channel-search channel-sms channel-tiktok channel-x channel-youtube",
  // One domain, used by products: the money, the calendar, the shape, the papers, the studio.
  "books calendar documents learn niches payments pipeline studio watch",
  // What a client buys or Wren runs as a loop.
  "content delivery outreach reactivation voice",
].flatMap((row, layer) => row.split(" ").map((name) => [name, layer]));
const layerOf = new Map(LAYERS);

const deps = new Map();
for (const dir of readdirSync("packages", { withFileTypes: true }).filter((d) => d.isDirectory())) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(`packages/${dir.name}/package.json`, "utf8"));
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
    if ((layerOf.get(dep) ?? -1) > layer)
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

if (bad.length) {
  console.error(bad.join("\n"));
  process.exit(1);
}
console.log(`${deps.size} packages, no arrow up a layer, no cycle`);
