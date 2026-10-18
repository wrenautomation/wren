#!/usr/bin/env node
/**
 * One Storybook per port: the package it is called from, on the port it is given (default 61000).
 * If one already serves there, it says where and exits 0; if something else holds the port, it
 * says so and exits 1. It never moves to another port. A package's `storybook` is `wren-storybook`.
 *   pnpm --filter @wren/ui storybook          (61000)
 *   pnpm --filter @wren/portal storybook      (61001)
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const PORT = Number(process.argv[2] ?? 61000);
const url = `http://localhost:${PORT}`;
const answer = await fetch(`${url}/index.json`, { signal: AbortSignal.timeout(2000) }).then(
  async (r) => (r.ok && "entries" in (await r.json()) ? "storybook" : "other"),
  (e) => (e?.cause?.code === "ECONNREFUSED" ? "free" : "other"),
);
if (answer === "storybook") {
  console.log(`Storybook already runs: ${url}`);
  process.exit(0);
}
if (answer === "other") {
  console.error(`Port ${PORT} is held by something that is not Storybook: lsof -i :${PORT}`);
  process.exit(1);
}
const pkg = process.cwd();
const child = spawn(
  resolve(pkg, "node_modules/.bin/storybook"),
  ["dev", "--port", String(PORT), "--exact-port", "--ci"],
  { cwd: pkg, stdio: "inherit" },
);
// Ctrl-C or a kill stops the server with this script.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
