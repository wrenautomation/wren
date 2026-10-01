#!/usr/bin/env node
/**
 * Bundle the sign-in Lambda: dist/lambda.zip holding index.mjs (one ESM
 * file, handler `index.handler`). Node 22, no native modules.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(app, "dist/lambda");
const zip = resolve(app, "dist/lambda.zip");

rmSync(out, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [resolve(app, "lambda/index.ts")],
  outfile: resolve(out, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Bundled CJS dependencies still call require() for node builtins.
  banner: {
    js: 'import { createRequire as __wrenCreateRequire } from "node:module"; const require = __wrenCreateRequire(import.meta.url);',
  },
  logLevel: "info",
});

// A broken bundle fails here, not at the first cold start.
execFileSync("node", ["--check", resolve(out, "index.mjs")], { stdio: "inherit" });
execFileSync("zip", ["-qr", "-X", zip, "."], { cwd: out, stdio: "inherit" });
console.log(`built ${zip}`);
