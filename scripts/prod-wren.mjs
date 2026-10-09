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
  // The worker's model and its keys, and its LinkedIn pool account: demand and hiring read with them.
  "WREN_LLM",
  "WREN_LLM_GATEWAY_URL",
  "WREN_LLM_GATEWAY_TOKEN",
  "WREN_POOL_LINKEDIN",
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
const keystore = keystorePublic();
const env = {
  ...(keystore ? { WREN_KEYSTORE_PUBLIC: keystore } : {}),
  ...Object.fromEntries(
    Object.keys(prod)
      .filter((k) => isOptional(k) && prod[k])
      .map((k) => [k, prod[k]]),
  ),
  ...process.env,
  ...Object.fromEntries(KEYS.map((k) => [k, prod[k]])),
  WREN_RESTATE_INGRESS_URL:
    process.env.WREN_PROD_INGRESS_URL ?? "https://restate.wrenautomation.com",
};
const r = spawnSync(join(root, "bin/wren"), process.argv.slice(2), { env, stdio: "inherit" });
process.exit(r.status ?? 1);
