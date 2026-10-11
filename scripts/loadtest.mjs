#!/usr/bin/env node
/**
 * One load test, start to verdict, on a throwaway stack: Postgres and Restate in Docker, the
 * worker from source, the scenario's synthetic seed, then k6. Nothing reaches prod: the worker
 * gets no .env (WREN_ENV_FILE=none), no AWS credentials, no webhooks.
 *
 *   node scripts/loadtest.mjs <scenario> [--vus 100] [--firms 66000] [--keep | --up]
 *
 * Scenarios are `loadtest/scenarios/<name>.js` (k6, with thresholds = the success criteria)
 * and an optional `loadtest/seeds/<name>.sql`. The summary lands in `loadtest/results/`;
 * exit 0 = every threshold held. `--keep` leaves the stack up after k6 and prints how to reach
 * it; `--up` brings it up seeded and skips k6 (to EXPLAIN or try a fix by hand); `--down`
 * takes a kept stack away.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const flag = (f, d) => {
  const i = args.indexOf(`--${f}`);
  return i >= 0 ? args[i + 1] : d;
};
if (!name && !args.includes("--down")) {
  console.error("usage: node scripts/loadtest.mjs <scenario> [--vus N] [--firms N] [--keep]");
  process.exit(2);
}
const scenario = join(repo, "loadtest/scenarios", `${name}.js`);
if (name && !existsSync(scenario)) throw new Error(`no scenario ${scenario}`);
const seed = join(repo, "loadtest/seeds", `${name}.sql`);
const up = args.includes("--up");
const keep = up || args.includes("--keep");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = join(repo, "loadtest/results");
mkdirSync(out, { recursive: true });

const PG = "wren-load-pg";
const RS = "wren-load-restate";
const sh = (cmd, a, o = {}) => execFileSync(cmd, a, { encoding: "utf8", ...o }).trim();
const docker = (...a) => sh("docker", a);
const portOf = (c, p) => Number(docker("port", c, String(p)).split("\n")[0].split(":").pop());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, ok, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await ok()) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`${what} never came up`);
}

const listens = (port) =>
  new Promise((ok) => {
    const c = connect(port, "127.0.0.1");
    c.once("connect", () => ok(c.end() && true));
    c.once("error", () => ok(false));
  });

const psql = (q) =>
  docker("exec", PG, "psql", "-qAtX", "-v", "ON_ERROR_STOP=1", "-U", "wren", "-d", "wren", "-c", q);

/**
 * CPU every two seconds while k6 runs: the worker (one Node process, so 100% = one core full)
 * and each container. Which one is pinned says where the ceiling is.
 */
function sample() {
  const seen = { worker: [], postgres: [], restate: [] };
  const tick = () => {
    try {
      const pid = sh("pgrep", ["-f", "apps/worker/src/main.ts|src/main.ts"]).split("\n").pop();
      seen.worker.push(Number(sh("ps", ["-o", "%cpu=", "-p", pid])));
    } catch {}
    try {
      for (const line of docker(
        "stats",
        "--no-stream",
        "--format",
        "{{.Name}} {{.CPUPerc}}",
        PG,
        RS,
      ).split("\n")) {
        const [c, v] = line.split(" ");
        seen[c === PG ? "postgres" : "restate"].push(Number.parseFloat(v));
      }
    } catch {}
  };
  const t = setInterval(tick, 2000);
  return {
    stop() {
      clearInterval(t);
      const of = (xs) =>
        xs.length
          ? {
              avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
              max: Math.round(Math.max(...xs)),
            }
          : null;
      return { worker: of(seen.worker), postgres: of(seen.postgres), restate: of(seen.restate) };
    },
  };
}

/** The statements that took the most database time during the run. */
function topQueries() {
  try {
    const rows = psql(`select json_agg(q) from (
      select left(regexp_replace(query, '\\s+', ' ', 'g'), 160) as query, calls,
             round(mean_exec_time::numeric, 1) as mean_ms, round(total_exec_time::numeric) as total_ms
      from pg_stat_statements where query not ilike '%pg_stat_statements%'
      order by total_exec_time desc limit 6) q`);
    return JSON.parse(rows || "[]");
  } catch {
    return [];
  }
}

const WORKER_PORT = 19080;
let worker;
/** The stack gone: whatever holds the worker's port (a kept run's too), and both containers. */
function down() {
  try {
    if (worker?.pid) process.kill(keep ? -worker.pid : worker.pid, "SIGTERM");
  } catch {}
  try {
    for (const pid of sh("lsof", ["-ti", `tcp:${WORKER_PORT}`, "-sTCP:LISTEN"]).split("\n"))
      if (pid) process.kill(Number(pid), "SIGTERM");
  } catch {}
  for (const c of [PG, RS]) {
    try {
      docker("rm", "-f", c);
    } catch {}
  }
}

if (args.includes("--down")) {
  down();
  process.exit(0);
}

try {
  down();
  console.log("stack: postgres, restate");
  docker(
    "run",
    "-d",
    "--name",
    PG,
    "-e",
    "POSTGRES_USER=wren",
    "-e",
    "POSTGRES_PASSWORD=wren",
    "-e",
    "POSTGRES_DB=wren",
    "-p",
    "127.0.0.1::5432",
    "postgres:17",
    // A load box is throwaway: speed over durability.
    "-c",
    "fsync=off",
    "-c",
    "synchronous_commit=off",
    "-c",
    "max_connections=200",
    "-c",
    "shared_preload_libraries=pg_stat_statements",
  );
  docker(
    "run",
    "-d",
    "--name",
    RS,
    "--add-host",
    "host.docker.internal:host-gateway",
    "-p",
    "127.0.0.1::8080",
    "-p",
    "127.0.0.1::9070",
    "restatedev/restate:1.7.10",
  );
  const pgPort = portOf(PG, 5432);
  const ingress = `http://127.0.0.1:${portOf(RS, 8080)}`;
  const admin = `http://127.0.0.1:${portOf(RS, 9070)}`;
  const dbUrl = `postgresql://wren:wren@127.0.0.1:${pgPort}/wren`;
  await until("postgres", () =>
    docker("exec", PG, "pg_isready", "-U", "wren").includes("accepting"),
  );
  await until("restate", async () => (await fetch(`${admin}/health`)).ok);

  // The worker's env from nothing: the shell's PATH and HOME, then the load stack's own.
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    WREN_ENV_FILE: "none",
    WREN_DATABASE_URL: dbUrl,
    WREN_RESTATE_INGRESS_URL: ingress,
    WREN_RESTATE_ADMIN_URL: admin,
    WREN_LOG_LEVEL: "warn",
    WREN_WORKER_PORT: String(WORKER_PORT),
    AWS_EC2_METADATA_DISABLED: "true",
  };
  console.log("migrate");
  sh("pnpm", ["-s", "--filter", "@wren/db", "migrate"], { cwd: repo, env });
  if (existsSync(seed)) {
    const firms = flag("firms", "66000");
    console.log(`seed: ${name}.sql (firms ${firms})`);
    docker("cp", seed, `${PG}:/tmp/seed.sql`);
    docker(
      "exec",
      PG,
      "psql",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      `firms=${firms}`,
      "-U",
      "wren",
      "-d",
      "wren",
      "-f",
      "/tmp/seed.sql",
    );
  }
  psql("create extension if not exists pg_stat_statements; select pg_stat_statements_reset()");

  console.log("worker");
  // Straight to the file: with --keep it outlives this script.
  const log = openSync(join(out, `${stamp}-${name}.worker.log`), "a");
  worker = spawn("pnpm", ["-s", "--filter", "@wren/worker", "start"], {
    cwd: repo,
    env,
    stdio: ["ignore", log, log],
    detached: keep,
  });
  // The endpoint speaks HTTP/2 cleartext, which fetch can't: a connect means it listens.
  await until("worker", () => listens(WORKER_PORT), 240);
  const reg = await fetch(`${admin}/deployments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uri: `http://host.docker.internal:${WORKER_PORT}`, force: true }),
  });
  if (!reg.ok) throw new Error(`register: ${reg.status} ${await reg.text()}`);

  if (up) {
    console.log(`up: ingress ${ingress}, admin ${admin}, db ${dbUrl}; worker pid ${worker.pid}`);
    console.log(`psql: docker exec -it ${PG} psql -U wren`);
    worker.unref();
    process.exit(0);
  }

  const summary = join(out, `${stamp}-${name}.json`);
  console.log(`k6: ${name}, peak ${flag("vus", "100")} users`);
  const k6 = spawn(
    "k6",
    [
      "run",
      "--quiet",
      "--summary-export",
      summary,
      "-e",
      `INGRESS=${ingress}`,
      "-e",
      `VUS=${flag("vus", "100")}`,
      scenario,
    ],
    { stdio: "inherit" },
  );
  const sampler = sample();
  const code = await new Promise((r) => k6.on("close", r));
  const profile = { cpu: sampler.stop(), queries: topQueries() };
  writeFileSync(
    join(out, `${stamp}-${name}.profile.json`),
    `${JSON.stringify(profile, null, 2)}\n`,
  );
  verdict(summary, code, profile);
  if (keep) {
    console.log(`kept: ingress ${ingress}, admin ${admin}, db ${dbUrl}; worker pid ${worker.pid}`);
    console.log("stop: node scripts/loadtest.mjs --down");
    worker.unref();
    process.exit(code ?? 1);
  }
  down();
  process.exit(code ?? 1);
} catch (err) {
  down();
  throw err;
}

/** One line per threshold and the numbers an agent iterates on. */
function verdict(path, code, profile) {
  if (!existsSync(path)) return console.log(`no summary (k6 exit ${code})`);
  const s = JSON.parse(readFileSync(path, "utf8"));
  const m = s.metrics ?? {};
  const fmt = (v) => (v === undefined ? "-" : Math.round(v));
  console.log(
    `\nrequests ${m.http_reqs?.count ?? 0}, ${fmt(m.http_reqs?.rate)}/s, failed ${((m.http_req_failed?.value ?? 0) * 100).toFixed(2)}%`,
  );
  for (const [k, v] of Object.entries(m)) {
    if (!v.thresholds) continue;
    const pass = Object.values(v.thresholds).every((t) => t === false || t?.ok === true);
    const p = v["p(95)"] !== undefined ? ` p95 ${fmt(v["p(95)"])} ms, med ${fmt(v.med)} ms` : "";
    console.log(`${pass ? "PASS" : "FAIL"} ${k}${p}`);
  }
  const c = profile.cpu;
  const pct = (x) => (x ? `${x.avg}% avg, ${x.max}% max` : "-");
  console.log(
    `cpu: worker ${pct(c.worker)}; postgres ${pct(c.postgres)}; restate ${pct(c.restate)}`,
  );
  for (const q of profile.queries.slice(0, 3))
    console.log(
      `db: ${q.total_ms} ms total, ${q.calls} calls, ${q.mean_ms} ms mean: ${q.query.slice(0, 100)}`,
    );
  console.log(code === 0 ? "verdict: PASS" : `verdict: FAIL (k6 exit ${code})`);
  console.log(`summary: ${path}`);
}
