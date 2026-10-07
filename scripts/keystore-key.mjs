#!/usr/bin/env node
// The key store's key pair (designs/2026-10-07-key-store.md). Makes an X25519 pair, writes the
// private key into its own SSM parameter as {"WREN_KEYSTORE_KEY": "kid:base64url"} and prints only
// the public key, for terraform.tfvars `keystore_public_key`.
//   node scripts/keystore-key.mjs            the first key; refuses if one is there
//   node scripts/keystore-key.mjs --rotate   a new key in front; old ones stay so old values open.
//                                            Then `wren keys rewrap`, then drop the old one.
// Run after `tofu apply` made the parameter. The private key never reaches stdout or argv.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PARAM = process.env.WREN_KEYSTORE_PARAM ?? "/wren/prod/keystore";
const rotate = process.argv.includes("--rotate");

const aws = (args) =>
  execFileSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

let current;
try {
  current = JSON.parse(
    aws([
      "ssm",
      "get-parameter",
      "--name",
      PARAM,
      "--with-decryption",
      "--query",
      "Parameter.Value",
      "--output",
      "text",
    ]),
  );
} catch {
  console.error(`${PARAM} isn't there or can't be read. Run tofu apply first.`);
  process.exit(1);
}
const ring = (current.WREN_KEYSTORE_KEY ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (ring.length && !rotate) {
  console.error(`${PARAM} has a key already. --rotate adds a new one in front.`);
  process.exit(1);
}

const { privateKey } = generateKeyPairSync("x25519");
const jwk = privateKey.export({ format: "jwk" });
const kids = new Set(ring.map((s) => s.slice(0, s.indexOf(":"))));
const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
let kid = `k${day}`;
for (let i = 0; kids.has(kid); i++) kid = `k${day}${String.fromCharCode(97 + i)}`;

const dir = mkdtempSync(join(tmpdir(), "keystore-"));
try {
  const file = join(dir, "value.json");
  writeFileSync(
    file,
    JSON.stringify({ ...current, WREN_KEYSTORE_KEY: [`${kid}:${jwk.d}`, ...ring].join(",") }),
    {
      mode: 0o600,
    },
  );
  aws([
    "ssm",
    "put-parameter",
    "--name",
    PARAM,
    "--type",
    "SecureString",
    "--overwrite",
    "--value",
    `file://${file}`,
  ]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.error(`wrote ${PARAM}: ${[kid, ...kids].join(", ")} (newest first)`);
console.log(`${kid}:${jwk.x}`);
