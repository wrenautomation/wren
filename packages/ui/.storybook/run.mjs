/**
 * Stories as tests, with screenshots compared to the committed baselines.
 *   pnpm --filter @wren/ui test:stories          compare (fails on a diff, writes test-results/visual/)
 *   pnpm --filter @wren/ui test:visual:update    write new baselines to __screenshots__/
 * Other arguments go to Vitest: `--project dark-390`, a story file's path.
 *
 * Pixels come from one place: the Playwright image CI runs in (linux/arm64, as on a Mac). On Linux (CI, or
 * inside that image) it runs Vitest itself; elsewhere it runs this script in that image under
 * Docker. Off CI it waits for the Mac's checks lock first, as scripts/gates.sh does.
 * Nothing outlives it: on an exit, a failure or Ctrl-C it stops Vitest, Chromium and the container.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE = "mcr.microsoft.com/playwright:v1.63.0-noble";
const LOCK = "/tmp/wren_automation-checks.lock";
/** Marks this script's containers, so a run can clear one that a killed run left. */
const LABEL = "wren-ui-stories";
const args = process.argv.slice(2);
const update = args.includes("--update");
const ui = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

/**
 * Runs a command; passes on each stop signal; on its end runs `after`, then exits with its code.
 * `group`: the command and all it starts get the signal (lockf passes none on to its command).
 */
function hand(cmd, argv, opts, after = async () => {}, group = false) {
  const child = spawn(cmd, argv, { stdio: "inherit", detached: group, ...opts });
  for (const sig of SIGNALS) {
    process.on(sig, () => (group ? process.kill(-child.pid, sig) : child.kill(sig)));
  }
  child.on("exit", async (code, sig) => {
    await after();
    process.exit(code ?? (sig ? 130 : 1));
  });
  return child;
}

// One heavy check at a time on the Mac. A run under gates.sh already holds the lock.
if (!process.env.CI && !process.env.CHECKS_LOCKED) {
  if (spawnSync("lockf", ["-s", "-t", "0", LOCK, "true"]).status !== 0) {
    console.log("==> waiting for another gate run to finish");
  }
  hand(
    "lockf",
    ["-s", LOCK, process.execPath, fileURLToPath(import.meta.url), ...args],
    { env: { ...process.env, CHECKS_LOCKED: "1" } },
    undefined,
    true,
  );
} else if (process.platform === "linux") {
  // One Chromium for the whole run: each project opens its own context in it.
  const { chromium } = await import("playwright");
  const { SHOTS } = await import("./shots.ts");
  const browser = await chromium.launchServer({ headless: true });
  const vitest = ["run", "--config", ".storybook/vitest.config.ts", ...(update ? ["-u"] : [])];
  const rest = args.filter((a) => a !== "--update");
  // One project at a time: four at once open four Vite servers and peak past 4 GB; one is ~2.3.
  const runs = rest.includes("--project") ? [[]] : SHOTS.map((s) => ["--project", s.name]);
  // CI=1 makes a missing baseline fail; without it Vitest writes one quietly.
  const env = { ...process.env, WREN_UI_BROWSER: browser.wsEndpoint(), CI: update ? "" : "1" };
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
    child = spawn(join(ui, "node_modules/.bin/vitest"), [...vitest, ...run, ...rest], {
      cwd: ui,
      env,
      stdio: "inherit",
    });
    const code = await new Promise((done) => child.on("exit", (c) => done(c ?? 1)));
    failed ||= code;
  }
  await browser.close();
  process.exit(stopped ? 130 : failed);
} else {
  // Off Linux: the repo's files (tracked and new, never node_modules) go into a Docker volume,
  // which keeps the Linux node_modules between runs. Baselines and diffs are mounted from here.
  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: ui }).toString().trim();
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: repo })
    .toString()
    .split("\0")
    .filter((f) => f && !f.startsWith("packages/ui/__screenshots__/") && existsSync(join(repo, f)));
  for (const dir of ["__screenshots__", "test-results"])
    mkdirSync(join(ui, dir), { recursive: true });

  // Under the lock, a container still up is one a killed run left: it goes first.
  const left = execFileSync("docker", ["ps", "-aq", "--filter", `label=${LABEL}`])
    .toString()
    .split(/\s+/)
    .filter(Boolean);
  if (left.length) execFileSync("docker", ["rm", "-f", ...left]);

  const name = `${LABEL}-${process.pid}`;
  const quote = (a) => `'${a.replaceAll("'", "'\\''")}'`;
  const inside = [
    "set -e",
    "mkdir -p /vol/src && cd /vol/src",
    // Drop last run's files, keep each node_modules and the two mounts.
    "find . -path '*/node_modules' -prune -o -path ./packages/ui/__screenshots__ -prune -o -path ./packages/ui/test-results -prune -o -type f -print0 | xargs -0 rm -f",
    "tar -xf - --no-same-owner",
    "rm -rf packages/ui/test-results/*",
    "corepack enable >/dev/null",
    "COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile --filter @wren/ui... --reporter=silent",
    `cd packages/ui && exec node .storybook/run.mjs ${args.map(quote).join(" ")}`,
  ].join(" && ");

  // A 3 GB cap: a run that grows past it stops in the container, not on the Mac.
  const docker = hand(
    "docker",
    [
      ...["run", "--rm", "-i", "--init", "--ipc=host", "--platform=linux/arm64"],
      ...["--name", name, "--label", LABEL, "--memory=3g", "--memory-swap=3g"],
      ...["-e", "TZ=UTC", "-e", "CHECKS_LOCKED=1", "-e", "COREPACK_HOME=/vol/corepack"],
      ...["-e", "npm_config_store_dir=/vol/store", "-v", "wren-ui-stories-arm64:/vol"],
      ...["-v", `${join(ui, "__screenshots__")}:/vol/src/packages/ui/__screenshots__`],
      ...["-v", `${join(ui, "test-results")}:/vol/src/packages/ui/test-results`],
      ...[IMAGE, "bash", "-c", inside],
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
    // `docker run` can end before its container does (a killed CLI): remove it by name.
    async () => void spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" }),
  );
  // bsdtar: no macOS metadata in the stream (GNU tar inside warns on it).
  const tar = spawn("tar", ["-cf", "-", "--no-mac-metadata", "--no-xattrs", "--null", "-T", "-"], {
    cwd: repo,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  tar.stdout.pipe(docker.stdin);
  tar.stdin.end(files.join("\0"));
}
