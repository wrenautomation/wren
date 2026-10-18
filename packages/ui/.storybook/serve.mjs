/**
 * One Storybook per Mac, on :61000. If one already serves there, it says where and exits 0;
 * if something else holds the port, it says so and exits 1. It never moves to another port.
 *   pnpm --filter @wren/ui storybook
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 61000;
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
const ui = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(
  resolve(ui, "node_modules/.bin/storybook"),
  ["dev", "--port", String(PORT), "--exact-port", "--ci"],
  { cwd: ui, stdio: "inherit" },
);
// Ctrl-C or a kill stops the server with this script.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
