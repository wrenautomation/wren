#!/usr/bin/env node
/**
 * dist/lambda.zip: lambda.mjs (handler `lambda.handler`) bundled, with playwright-core and
 * @sparticuz/chromium installed beside it (the chromium binary ships brotli'd in that package;
 * x86_64 only). The zip is over 50 MB: deploy.sh uploads it through S3.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(app, "dist/lambda");
const zip = resolve(app, "dist/lambda.zip");
const pkg = JSON.parse(readFileSync(resolve(app, "package.json"), "utf8"));
const NATIVE = ["@sparticuz/chromium", "playwright-core"];

rmSync(resolve(app, "dist"), { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [resolve(app, "src/lambda.ts")],
  outfile: resolve(out, "lambda.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: [...NATIVE, "@aws-sdk/*"],
  logLevel: "info",
});
execFileSync("node", ["--check", resolve(out, "lambda.mjs")], { stdio: "inherit" });
const deps = Object.fromEntries(NATIVE.map((n) => [n, pkg.dependencies[n]]));
writeFileSync(
  resolve(out, "package.json"),
  `${JSON.stringify({ type: "module", dependencies: deps }, null, 2)}\n`,
);
// --cpu/--os: the Lambda's platform, whatever this machine is
execFileSync(
  "npm",
  [
    "install",
    "--omit=dev",
    "--ignore-scripts",
    "--no-package-lock",
    "--silent",
    "--cpu=x64",
    "--os=linux",
  ],
  { cwd: out, stdio: "inherit" },
);
execFileSync("zip", ["-qr", "-X", zip, "."], { cwd: out, stdio: "inherit" });
console.log(`built ${zip}`);
