#!/usr/bin/env node
// dist/lambda.zip: turborepo-remote-cache's own Lambda handler as one ESM file, `lambda.handler`.
// deploy.sh builds it and replaces the function's code; Terraform made the function once.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "dist/lambda");
rmSync(resolve(here, "dist"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  stdin: {
    contents: 'export { handler } from "turborepo-remote-cache/aws-lambda";',
    resolveDir: here,
  },
  outfile: resolve(out, "lambda.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // CJS dependencies bundled into ESM still call require() for node builtins.
  banner: {
    js: 'import { createRequire as __wrenCreateRequire } from "node:module"; const require = __wrenCreateRequire(import.meta.url);',
  },
  logLevel: "warning",
});
execFileSync("zip", ["-qj", resolve(here, "dist/lambda.zip"), resolve(out, "lambda.mjs")]);
console.log("dist/lambda.zip");
