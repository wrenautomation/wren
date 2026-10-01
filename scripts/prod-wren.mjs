#!/usr/bin/env node
// ./bin/wren against prod: the database and the search settings come from deploy/prod.env, parsed here and
// handed to the CLI's environment (an existing variable beats .env). Nothing is printed from the file.
// Usage, from the repo root: node scripts/prod-wren.mjs search brief
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prod = parseEnv(readFileSync(join(root, "deploy/prod.env"), "utf8"));
const KEYS = ["WREN_DATABASE_URL", "WREN_SEARCH_SITE", "WREN_SEARCH_ORIGIN"];
const missing = KEYS.filter((k) => !prod[k]);
if (missing.length) {
  console.error(`deploy/prod.env lacks ${missing.join(", ")}`);
  process.exit(1);
}
const env = { ...process.env, ...Object.fromEntries(KEYS.map((k) => [k, prod[k]])) };
const r = spawnSync(join(root, "bin/wren"), process.argv.slice(2), { env, stdio: "inherit" });
process.exit(r.status ?? 1);
