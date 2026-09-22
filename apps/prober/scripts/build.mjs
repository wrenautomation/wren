#!/usr/bin/env node
/** Bundle the prober into one ESM file, dist/prober.mjs, for `node prober.mjs` on the box. */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(app, "dist/prober.mjs");
rmSync(resolve(app, "dist"), { recursive: true, force: true });
mkdirSync(resolve(app, "dist"));
await build({
  entryPoints: [resolve(app, "src/main.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: 'import { createRequire as __wrenCreateRequire } from "node:module"; const require = __wrenCreateRequire(import.meta.url);',
  },
  logLevel: "info",
});
execFileSync("node", ["--check", out], { stdio: "inherit" });
console.log(`built ${out}`);
