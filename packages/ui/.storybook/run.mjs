#!/usr/bin/env node
/**
 * Stories as tests: each renders, its `play` runs, axe checks it. Runs the Storybook of the package
 * it is called from (its `.storybook/vitest.config.ts`); a package's `test:stories` is `wren-stories`.
 *   pnpm --filter @wren/ui test:stories
 * Other arguments go to Vitest: `--project dark-1280`, a story file's path.
 *
 * Off CI it waits for the Mac's checks lock first, as scripts/gates.sh does. One Chromium for the
 * whole run, one project at a time. Nothing outlives it: on an exit, a failure or Ctrl-C it stops
 * Vitest and Chromium. No screenshots are compared (designs/2026-10-17-storybook-visual-tests.md,
 * "Screenshots off"), so it runs on the Mac as it is, with no Docker.
 */
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LOCK = "/tmp/wren_automation-checks.lock";
const args = process.argv.slice(2);
const pkg = process.cwd();
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

// One heavy check at a time on the Mac. A run under gates.sh already holds the lock.
if (!process.env.CI && !process.env.CHECKS_LOCKED) {
  if (spawnSync("lockf", ["-s", "-t", "0", LOCK, "true"]).status !== 0) {
    console.log("==> waiting for another gate run to finish");
  }
  // detached: the signal goes to lockf's whole group (lockf passes none on to its command).
  const child = spawn(
    "lockf",
    ["-s", LOCK, process.execPath, fileURLToPath(import.meta.url), ...args],
    {
      stdio: "inherit",
      detached: true,
      env: { ...process.env, CHECKS_LOCKED: "1" },
    },
  );
  for (const sig of SIGNALS) process.on(sig, () => process.kill(-child.pid, sig));
  child.on("exit", (code, sig) => process.exit(code ?? (sig ? 130 : 1)));
} else {
  // One Chromium for the whole run: each project opens its own context in it.
  const { chromium } = await import("playwright");
  const { LOOKS } = await import("./looks.ts");
  const browser = await chromium.launchServer({ headless: true });
  const vitest = ["run", "--config", ".storybook/vitest.config.ts"];
  // One project at a time: two at once open two Vite servers and double the peak.
  const runs = args.includes("--project") ? [[]] : LOOKS.map((s) => ["--project", s.name]);
  const env = { ...process.env, WREN_UI_BROWSER: browser.wsEndpoint() };
  let child;
  let stopped = false;
  for (const sig of SIGNALS) {
    process.on(sig, () => {
      stopped = true;
      child?.kill(sig);
    });
  }
  let failed = 0;
  for (const run of runs) {
    if (stopped) break;
    child = spawn(join(pkg, "node_modules/.bin/vitest"), [...vitest, ...run, ...args], {
      cwd: pkg,
      env,
      stdio: "inherit",
    });
    const code = await new Promise((done) => child.on("exit", (c) => done(c ?? 1)));
    failed ||= code;
  }
  await browser.close();
  process.exit(stopped ? 130 : failed);
}
