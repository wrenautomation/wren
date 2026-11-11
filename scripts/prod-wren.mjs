#!/usr/bin/env node
// ./bin/wren against prod: the database, the search settings and prod's Restate ingress (site calls reach the
// desk the way the worker does) come from deploy/prod.env, parsed here and handed to the CLI's environment (an
// existing variable beats .env). Nothing is printed from the file.
// Usage, from the repo root: node scripts/prod-wren.mjs search brief
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./secrets.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prod = parse(readFileSync(join(root, "deploy/prod.env"), "utf8"));
const KEYS = ["WREN_DATABASE_URL"];
const missing = KEYS.filter((k) => !prod[k]);
if (missing.length) {
  console.error(`deploy/prod.env lacks ${missing.join(", ")}`);
  process.exit(1);
}
// Prod's verifier, contact fetcher and placement seeds when the shell sets none: without them the CLI falls back to the fake
// verifier, whose verdicts the movers stage refuses.
const OPTIONAL = [
  "WREN_API_TOKEN",
  "WREN_VERIFIER",
  "WREN_SMTP_PROBE_URL",
  "WREN_SMTP_PROBE_TOKEN",
  "WREN_FETCH_CONTACT",
  "WREN_CALCOM_API_KEY",
  "WREN_PLACEMENT_SEEDS",
  // The worker's model and its keys, and its LinkedIn pool account: demand and hiring read with them.
  "WREN_LLM",
  "WREN_LLM_GATEWAY_URL",
  "WREN_LLM_GATEWAY_TOKEN",
  "WREN_POOL_LINKEDIN",
  // The lake: its bucket (designs/2026-10-11-lake.md); the catalog is wren_lake beside the database.
  "WREN_LAKE_PATH",
  // autotrack's bucket, read by the autotrack_* models (designs/2026-10-11-lake.md).
  "WREN_LAKE_TRACK_PATH",
  // Our Page and Instagram account: `social push meta` subscribes them.
  "WREN_META_PAGE_ID",
  "WREN_META_IG_ID",
  // The files bucket: `calls add` uploads each recorded call there (designs/2026-10-16-call-recording.md).
  "WREN_FILES_BUCKET",
  // The shape mirror's git repo: `shape mirror`, `shape draft apply` and every shape save commit with them.
  "WREN_SHAPES_GITHUB_TOKEN",
  "WREN_SHAPES_GITHUB_REPO",
  "WREN_SHAPES_GITHUB_API",
  // Live topics: CLI writes push "this changed" to open tabs (designs/2026-11-08-live-topics.md).
  "WREN_LIVE_SECRET",
];
const isOptional = (k) => OPTIONAL.includes(k) || /^(NUM_COHERE|COHERE_)/.test(k);
// `keys put|delete` seal with the key store's public key (designs/2026-10-07-key-store.md). It lives in
// deploy/terraform/terraform.tfvars as keystore_public_key, the value the sign-in Lambda gets. Only that one line is
// read from the file, and never printed. A shell's WREN_KEYSTORE_PUBLIC wins.
function keystorePublic() {
  let tfvars;
  try {
    tfvars = readFileSync(join(root, "deploy/terraform/terraform.tfvars"), "utf8");
  } catch {
    return null;
  }
  const value = /^\s*keystore_public_key\s*=\s*"([^"\n]*)"/m.exec(tfvars)?.[1];
  return value && /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(value) ? value : null;
}
// a locked role (Wrenfile `db`) reaches loopback only: go through its db relay, TLS unchanged
const relay = process.env.WREN_DB_RELAY;
if (relay) {
  const u = new URL(prod.WREN_DATABASE_URL);
  u.host = relay;
  prod.WREN_DATABASE_URL = u.toString();
}
const keystore = keystorePublic();
const ingress = process.env.WREN_PROD_INGRESS_URL ?? "https://api.wrenautomation.com";
const env = {
  ...(keystore ? { WREN_KEYSTORE_PUBLIC: keystore } : {}),
  ...Object.fromEntries(
    Object.keys(prod)
      .filter((k) => isOptional(k) && prod[k])
      .map((k) => [k, prod[k]]),
  ),
  ...process.env,
  ...Object.fromEntries(KEYS.map((k) => [k, prod[k]])),
  WREN_API_URL: ingress,
};
const r = spawnSync(join(root, "bin/wren"), process.argv.slice(2), { env, stdio: "inherit" });
process.exit(r.status ?? 1);
