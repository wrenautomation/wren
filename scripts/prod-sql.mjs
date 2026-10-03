#!/usr/bin/env node
// One read-only query against prod. The URL comes from `tofu output` and is never printed;
// the query runs inside a READ ONLY transaction, so a stray write fails instead of landing.
// Usage, from the repo root: node scripts/prod-sql.mjs "SELECT count(*) FROM companies"
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const query = process.argv[2];
if (!query) {
  console.error('usage: node scripts/prod-sql.mjs "<sql>"');
  process.exit(2);
}
const url = execFileSync("tofu", ["output", "-raw", "database_url"], {
  cwd: join(root, "deploy/terraform"),
  encoding: "utf8",
}).trim();
const postgres = createRequire(join(root, "packages/db/package.json"))("postgres");
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const rows = await sql.begin("READ ONLY", (tx) => tx.unsafe(query));
  for (const r of rows) console.log(JSON.stringify(r));
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
