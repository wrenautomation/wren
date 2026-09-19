#!/usr/bin/env node
/**
 * Bundle the Lambda handler: dist/lambda.zip with app/lambda.mjs (one ESM
 * file, handler `app/lambda.handler`), the niche templates beside it (the
 * niches resolve `../templates` from their module), the sender roster when
 * the repo has one, and playwright-core for the Browserbase render tier.
 * Node 22 runtime; nothing in the bundle needs a native module.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const worker = resolve(here, "..");
const repo = resolve(worker, "../..");
const out = resolve(worker, "dist/lambda");
const zip = resolve(worker, "dist/lambda.zip");
const PLAYWRIGHT_CORE = "1.63.0";

rmSync(resolve(worker, "dist"), { recursive: true, force: true });
mkdirSync(resolve(out, "app"), { recursive: true });

await build({
  entryPoints: [resolve(worker, "src/lambda.ts")],
  outfile: resolve(out, "app/lambda.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  minify: false,
  // Browsers never ship in the zip; the Browserbase tier connects to a remote one.
  external: ["playwright", "playwright-core"],
  // CJS dependencies bundled into ESM still call require() for node builtins.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  logLevel: "info",
});

cpSync(resolve(repo, "packages/niches/templates"), resolve(out, "templates"), { recursive: true });
const roster = resolve(repo, "senders_config.toml");
if (existsSync(roster)) cpSync(roster, resolve(out, "senders_config.toml"));
else console.warn("no senders_config.toml at the repo root: the bundle has no sender roster");

writeFileSync(
  resolve(out, "package.json"),
  `${JSON.stringify({ type: "module", dependencies: { "playwright-core": PLAYWRIGHT_CORE } }, null, 2)}\n`,
);
execFileSync(
  "npm",
  ["install", "--omit=dev", "--ignore-scripts", "--no-package-lock", "--silent"],
  {
    cwd: out,
    stdio: "inherit",
  },
);
execFileSync("zip", ["-qr", "-X", zip, "."], { cwd: out, stdio: "inherit" });
console.log(`built ${zip}`);
