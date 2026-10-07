#!/usr/bin/env node
// Load every LLM key and every caller into the gateway Worker (apps/llm-gateway) and deploy
// it. Run inside `secrets.mjs run deploy/prod.env` so the Cloudflare token and prod's
// WREN_LLM_GATEWAY_TOKEN are in the environment:
//   node scripts/secrets.mjs run deploy/prod.env -- node scripts/llm-gateway-keys.mjs [../llm.env]
// Reads llm.env (keycycle format: NUM_<P> + <P>_API_KEY_n), writes the keys one per line to
// the Worker's GEMINI_KEYS / OPENROUTER_KEYS / COHERE_KEYS through a 0600 temp file that is
// deleted after, resets the gateway's key ledger, and prints counts only. Callers (guard.ts):
// `prod` is deploy/prod.env's WREN_LLM_GATEWAY_TOKEN, `william` is the one in the LLM env
// file; the Worker gets only their sha256 hashes. Rotate one: change it, run this again.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "./secrets.mjs";

const llmEnv = parse(readFileSync(resolve(process.argv[2] ?? "../llm.env"), "utf8"));

/** The key alone: a line may carry an inline `# account` note after it. */
const bare = (v) => (v ?? "").trim().split(/\s/)[0];

function fleet(provider) {
  const up = provider.toUpperCase();
  const n = Number.parseInt(llmEnv[`NUM_${up}`] ?? "0", 10);
  const keys = [];
  for (let i = 1; i <= n; i++) keys.push(bare(llmEnv[`${up}_API_KEY_${i}`]));
  if (!keys.some(Boolean)) keys.push(bare(llmEnv[`${up}_API_KEY`]));
  return [...new Set(keys.filter(Boolean))];
}

const callers = {
  prod: process.env.WREN_LLM_GATEWAY_TOKEN,
  william: llmEnv.WREN_LLM_GATEWAY_TOKEN,
};
for (const [name, t] of Object.entries(callers))
  if (!t || t.length < 32) throw new Error(`no gateway token for caller ${name}`);
if (callers.prod === callers.william) throw new Error("prod and william share a token");
const sha256 = (t) => createHash("sha256").update(t).digest("hex");
const secrets = {
  GATEWAY_CALLERS: Object.entries(callers)
    .map(([name, t]) => `${name} ${sha256(t)}`)
    .join("\n"),
  GEMINI_KEYS: fleet("gemini").join("\n"),
  OPENROUTER_KEYS: fleet("openrouter").join("\n"),
  COHERE_KEYS: fleet("cohere").join("\n"),
};
for (const [k, v] of Object.entries(secrets))
  if (v.length > 5000) throw new Error(`${k} is ${v.length} bytes, over a Worker secret's 5 KB`);

const dir = mkdtempSync(join(tmpdir(), "gw-"));
const file = join(dir, "secrets.json");
try {
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  execFileSync("npx", ["wrangler", "deploy", "--secrets-file", file], {
    cwd: new URL("../apps/llm-gateway/", import.meta.url),
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID:
        process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.WREN_CLOUDFLARE_ACCOUNT_ID,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
// Key indexes may have moved: start the key ledger over (callers' caps stay).
const reset = await fetch("https://llm.wrenautomation.com/reset", {
  method: "POST",
  headers: { authorization: `Bearer ${callers.william}` },
});
if (!reset.ok) console.error(`ledger reset failed: ${reset.status}`);
console.log(
  `deployed wren-llm-gateway: gemini ${fleet("gemini").length}, openrouter ${fleet("openrouter").length}, cohere ${fleet("cohere").length} keys`,
);
