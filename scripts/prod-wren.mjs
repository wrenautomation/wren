#!/usr/bin/env node
// ./bin/wren against prod: the database, the search settings and prod's Restate ingress (site calls reach the
// desk the way the worker does) come from deploy/prod.env, parsed here and handed to the CLI's environment (an
// existing variable beats .env). Nothing is printed from the file.
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
// Prod's verifier, contact fetcher and placement seeds when the shell sets none: without them the CLI falls back to the fake
// verifier, whose verdicts the movers stage refuses.
const OPTIONAL = [
  "RESTATE_AUTH_TOKEN",
  "WREN_VERIFIER",
  "WREN_SMTP_PROBE_URL",
  "WREN_SMTP_PROBE_TOKEN",
  "WREN_FETCH_CONTACT",
  "WREN_CALCOM_API_KEY",
  "WREN_PLACEMENT_SEEDS",
];
const env = {
  ...Object.fromEntries(OPTIONAL.filter((k) => prod[k]).map((k) => [k, prod[k]])),
  ...process.env,
  ...Object.fromEntries(KEYS.map((k) => [k, prod[k]])),
  WREN_RESTATE_INGRESS_URL:
    process.env.WREN_PROD_INGRESS_URL ??
    "https://201m2vp6sq3x11xdaatsmjej302.env.us.restate.cloud:8080",
};
const r = spawnSync(join(root, "bin/wren"), process.argv.slice(2), { env, stdio: "inherit" });
process.exit(r.status ?? 1);
