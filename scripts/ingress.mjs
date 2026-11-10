#!/usr/bin/env node
// One call to a prod handler through the door, with WREN_API_TOKEN from deploy/prod.env.
// Usage, from the repo root: node scripts/ingress.mjs LeadPoolFill/recruiting/status ['{"json":1}']
// Writes too (start, stop, queue): read the handler first.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// not .env: its ingress URL is the retired Restate host (11-09) and it holds no door token
process.loadEnvFile(join(root, "deploy/prod.env"));
const ingress = process.env.WREN_PROD_INGRESS_URL ?? "https://api.wrenautomation.com";
const [path, body] = process.argv.slice(2);
if (!path) {
  console.error("usage: node scripts/ingress.mjs <Service/key/handler> [json]");
  process.exit(2);
}
const res = await fetch(`${ingress}/${path}`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.WREN_API_TOKEN}`,
    ...(body ? { "content-type": "application/json" } : {}),
  },
  body: body ?? undefined,
});
console.log(res.status, await res.text());
if (!res.ok) process.exitCode = 1;
