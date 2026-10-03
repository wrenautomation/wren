#!/usr/bin/env node
// One call to a prod Restate handler through the ingress, with the API key from .env.
// Usage, from the repo root: node scripts/ingress.mjs PoolScheduler/recruiting/status ['{"json":1}']
// Writes too (start, stop, queue): read the handler first.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(join(root, ".env"));
const ingress =
  process.env.WREN_PROD_INGRESS_URL ??
  "https://201m2vp6sq3x11xdaatsmjej302.env.us.restate.cloud:8080";
const [path, body] = process.argv.slice(2);
if (!path) {
  console.error("usage: node scripts/ingress.mjs <Service/key/handler> [json]");
  process.exit(2);
}
const res = await fetch(`${ingress}/${path}`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.RESTATE_AUTH_TOKEN}`,
    ...(body ? { "content-type": "application/json" } : {}),
  },
  body: body ?? undefined,
});
console.log(res.status, await res.text());
if (!res.ok) process.exitCode = 1;
