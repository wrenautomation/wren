#!/usr/bin/env node
/**
 * Bundle the CLI into one file so `wren` starts in ~0.1s instead of compiling
 * TypeScript on every run: dist/app/wren.mjs plus the niche templates beside
 * it (the niches resolve `../templates` from their module, as in the Lambda).
 * `bin/wren` runs this whenever a source file is newer than the bundle.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "..");
const repo = resolve(cli, "../..");
const out = resolve(cli, "dist");
const bundle = resolve(out, "app/wren.mjs");

rmSync(out, { recursive: true, force: true });
mkdirSync(resolve(out, "app"), { recursive: true });

await build({
  entryPoints: [resolve(cli, "src/main.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  minify: false,
  // Same banner as the Lambda build: bundled CJS deps call require() for node builtins,
  // and the alias keeps clear of a dep that imports `createRequire` by name.
  banner: {
    js: 'import { createRequire as __wrenCreateRequire } from "node:module"; const require = __wrenCreateRequire(import.meta.url);',
  },
  logLevel: "warning",
});

// A duplicate top-level binding is a SyntaxError only seen on load; catch it here.
execFileSync("node", ["--check", bundle], { stdio: "inherit" });
cpSync(resolve(repo, "packages/niches/templates"), resolve(out, "templates"), { recursive: true });
// `wren clients add` migrates the new client's database from these.
cpSync(resolve(repo, "packages/db/drizzle"), resolve(out, "drizzle"), { recursive: true });
