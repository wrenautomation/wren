#!/usr/bin/env node
// Load every LLM key into the gateway Worker (apps/llm-gateway) and deploy it. Run inside
// `secrets.mjs run deploy/prod.env` so the Cloudflare token and WREN_LLM_GATEWAY_TOKEN
// are in the environment:
//   node scripts/secrets.mjs run deploy/prod.env -- node scripts/llm-gateway-keys.mjs [../llm.env]
// Reads llm.env (keycycle format: NUM_<P> + <P>_API_KEY_n), writes the keys one per line to
// the Worker's GEMINI_KEYS / OPENROUTER_KEYS / COHERE_KEYS through a 0600 temp file that is
// deleted after, resets the gateway's ledger, and prints counts only.
import { execFileSync } from "node:child_process";
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

const token = process.env.WREN_LLM_GATEWAY_TOKEN;
if (!token)
  throw new Error("WREN_LLM_GATEWAY_TOKEN missing: run inside secrets.mjs run deploy/prod.env");
const secrets = {
  GATEWAY_TOKEN: token,
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
// Key indexes may have moved: start the ledger over.
const reset = await fetch("https://llm.wrenautomation.com/reset", {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
});
if (!reset.ok) console.error(`ledger reset failed: ${reset.status}`);
console.log(
  `deployed wren-llm-gateway: gemini ${fleet("gemini").length}, openrouter ${fleet("openrouter").length}, cohere ${fleet("cohere").length} keys`,
);
