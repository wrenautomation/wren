#!/usr/bin/env node
/**
 * Bundle the Lambda handler: dist/lambda.zip with app/lambda.mjs (one ESM
 * file, handler `app/lambda.handler`) and app/box.mjs (the pool chain on the
 * Postgres box, `node app/box.mjs`), the niche templates beside it (the
 * niches resolve `../templates` from their module), the migrations (the db
 * resolves `../drizzle`, so the worker can migrate a new client's database:
 * the SQL files and the journal, not the snapshots), the sender roster when
 * the repo has one, and playwright-core for the Browserbase render tier.
 * Node 22 runtime; nothing in the bundle needs a native module.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  entryPoints: [resolve(worker, "src/lambda.ts"), resolve(worker, "src/box.ts")],
  outdir: resolve(out, "app"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  minify: false,
  // Browsers never ship in the zip; the Browserbase tier connects to a remote one.
  // DuckDB is native and only `wren fetch` loads it (lazily), never the Lambda.
  external: ["playwright", "playwright-core", "@duckdb/node-api"],
  // CJS dependencies bundled into ESM still call require() for node builtins. The
  // import is aliased: a bundled ESM dep (fflate) imports `createRequire` by its own
  // name at top level, and two declarations of it made the whole module unloadable.
  banner: {
    js: 'import { createRequire as __wrenCreateRequire } from "node:module"; const require = __wrenCreateRequire(import.meta.url);',
  },
  logLevel: "info",
});

// Parse the bundle before shipping it: a duplicate top-level binding is a SyntaxError
// the Lambda would only report at cold start, after publish, during register.
for (const app of ["lambda", "box"])
  execFileSync("node", ["--check", resolve(out, `app/${app}.mjs`)], { stdio: "inherit" });

// Template defaults beside the bundle: `defaultsDir()` finds them at out/defaults.
cpSync(resolve(repo, "packages/templates/defaults"), resolve(out, "defaults"), { recursive: true });
// drizzle's migrator reads meta/_journal.json and each entry's <tag>.sql, nothing else.
const migrations = resolve(repo, "packages/db/drizzle");
const drizzle = resolve(out, "drizzle");
mkdirSync(resolve(drizzle, "meta"), { recursive: true });
cpSync(resolve(migrations, "meta/_journal.json"), resolve(drizzle, "meta/_journal.json"));
for (const f of readdirSync(migrations).filter((f) => f.endsWith(".sql")))
  cpSync(resolve(migrations, f), resolve(drizzle, f));
const journal = JSON.parse(readFileSync(resolve(drizzle, "meta/_journal.json"), "utf8")).entries;
const shipped = readdirSync(drizzle).filter((f) => f.endsWith(".sql"));
const missing = journal.filter((e) => !existsSync(resolve(drizzle, `${e.tag}.sql`)));
if (journal.length === 0 || journal.length !== shipped.length || missing.length)
  throw new Error(
    `bundle migrations: ${journal.length} journal entries, ${shipped.length} SQL files` +
      (missing.length ? `, missing ${missing.map((e) => e.tag).join(", ")}` : ""),
  );

const roster = resolve(repo, "senders_config.toml");
if (existsSync(roster)) cpSync(roster, resolve(out, "senders_config.toml"));
else console.warn("no senders_config.toml at the repo root: the Lambda takes its roster from SSM");

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
