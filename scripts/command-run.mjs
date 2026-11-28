#!/usr/bin/env node
// Mac command runner (designs/2026-11-27-central-queue.md, phase 2). Claims `CommandRun` rows the
// box's schedules make, over the door's /rt routes, and runs each job's command from
// deploy/mac/commands.json. The row names the job only: a write to prod never picks a command.
// - one run per job at a time: the door's key lock (job = key)
// - lost lease (Mac slept, the row went to another claim) or a cancel: the job's process group dies
// - a failed exit retries on the job's `retry`, then the row is a dead letter
// - runner stops (launchd restart): its children die, their leases lapse, the runs start again
// Token: WREN_API_TOKEN from the prod env file, as prod-wren.mjs reads it. Log per job:
// ~/Library/Logs/wren/jobs/<job>.log. Runs under launchd: deploy/mac/install.sh.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./secrets.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prod = parse(readFileSync(join(root, "deploy/prod.env"), "utf8"));
const DOOR = (process.env.WREN_PROD_INGRESS_URL ?? "https://api.wrenautomation.com").replace(
  /\/$/,
  "",
);
const TOKEN = prod.WREN_API_TOKEN;
const SERVICE = "CommandRun";
const MAX = 2;
const RENEW_MS = 15_000;
const KILL_GRACE_MS = 10_000;
const TAIL = 4_000;
const LOGS = join(homedir(), "Library/Logs/wren/jobs");
mkdirSync(LOGS, { recursive: true });
if (!TOKEN) throw new Error("the prod env file lacks WREN_API_TOKEN");

// read per run: an edit needs no restart
const commands = () => JSON.parse(readFileSync(join(root, "deploy/mac/commands.json"), "utf8"));
const say = (m, o = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), m, ...o }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function door(path, body) {
  const res = await fetch(`${DOOR}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(path === "/rt/claim" ? 40_000 : 30_000),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}
  return { status: res.status, json };
}

async function finish(call, body) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await door("/rt/finish", { id: call.id, attempt: call.attempt, ...body });
      if (r.status === 200 || r.status === 409) return r.status;
    } catch {}
    await sleep(5_000 * (i + 1));
  }
  say("finish lost; the lease lapses and the run starts again", { id: call.id });
}

/** Live children: run id → stop. */
const running = new Map();

function killGroup(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, KILL_GRACE_MS).unref();
}

async function run(call) {
  const input = JSON.parse(Buffer.from(call.input, "base64").toString() || "{}");
  const job = String(input.job ?? "");
  const spec = commands()[job];
  if (!spec) {
    say("no command", { job, id: call.id });
    return finish(call, {
      error: { message: `no command for job "${job}" on this Mac`, code: 404 },
      terminal: true,
    });
  }
  const log = join(LOGS, `${job}.log`);
  const write = (s) => appendFileSync(log, s);
  write(
    `\n== ${new Date().toISOString()} run ${call.id} attempt ${call.attempt} tick ${input.tick ?? "-"}\n`,
  );
  const t0 = Date.now();
  let tail = "";
  let ended = null; // lost | cancel | timeout | runner stops
  const [cmd, ...args] = spec.argv;
  const child = spawn(cmd, args, {
    cwd: resolve(root, spec.cwd ?? "."),
    env: {
      ...process.env,
      ...(spec.env ?? {}),
      AUTOBROWSE_JOB: `job:${job}/${call.id}`,
      WREN_JOB: job,
      WREN_JOB_RUN: call.id,
    },
    detached: true, // own process group: a kill reaches the job's children too
    stdio: ["ignore", "pipe", "pipe"],
  });
  const take = (b) => {
    const s = b.toString();
    write(s);
    tail = (tail + s).slice(-TAIL);
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  const stop = (why) => {
    if (ended) return;
    ended = why;
    say("stopping", { job, id: call.id, why });
    killGroup(child);
  };
  running.set(call.id, () => stop("runner stops"));
  say("start", { job, id: call.id, attempt: call.attempt, pid: child.pid });
  const renew = setInterval(async () => {
    try {
      const r = await door("/rt/renew", { id: call.id, attempt: call.attempt });
      if (r.status === 409) stop("lost");
      else if (r.json.cancel) stop("cancel");
    } catch {} // door away: the lease may lapse; the next renew's 409 says so
  }, RENEW_MS);
  const limit = setTimeout(() => stop("timeout"), (spec.timeoutMin ?? 60) * 60_000);
  const [code, signal] = await new Promise((r) => {
    child.on("error", (e) => {
      take(String(e));
      r([127, null]);
    });
    child.on("exit", (c, s) => r([c, s]));
  });
  clearInterval(renew);
  clearTimeout(limit);
  running.delete(call.id);
  const ms = Date.now() - t0;
  write(`== exit ${code ?? signal} in ${Math.round(ms / 1000)} s${ended ? ` (${ended})` : ""}\n`);
  say("end", { job, id: call.id, code, signal, ms, ended });
  if (ended === "lost" || ended === "runner stops") return; // the row is another claim's now
  if (ended === "cancel")
    return finish(call, { error: { message: "cancelled", code: 409 }, terminal: true });
  if (code === 0 && !ended)
    return finish(call, {
      value: Buffer.from(JSON.stringify({ exit: 0, ms, tail })).toString("base64"),
    });
  const last = tail.trim().split("\n").at(-1) ?? "";
  const what = ended === "timeout" ? "timed out" : `exit ${code ?? signal}`;
  return finish(call, { error: { message: `${what}: ${last}`.slice(0, 500) }, retry: spec.retry });
}

let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"])
  process.once(sig, () => {
    stopping = true;
    for (const stop of running.values()) stop();
    setTimeout(() => process.exit(0), 1_000);
  });

for (;;) {
  try {
    const r = await door("/rt/register", {
      services: [{ name: SERVICE, handlers: [{ name: "run" }] }],
    });
    if (r.status === 200) break;
    say("register refused", { status: r.status, body: r.json });
  } catch (e) {
    say("register failed", { err: String(e) });
  }
  await sleep(10_000);
}
say("ready", { door: DOOR });

const active = new Set();
while (!stopping) {
  if (active.size >= MAX) {
    await Promise.race(active);
    continue;
  }
  let calls = [];
  try {
    const r = await door("/rt/claim", {
      services: [SERVICE],
      max: MAX - active.size,
      waitMs: 25_000,
    });
    if (r.status !== 200) throw new Error(`claim ${r.status}`);
    calls = r.json.calls ?? [];
  } catch (e) {
    say("claim failed", { err: String(e) });
    await sleep(5_000);
    continue;
  }
  for (const c of calls) {
    const p = run(c)
      .catch((e) => say("run failed", { id: c.id, err: String(e) }))
      .finally(() => active.delete(p));
    active.add(p);
  }
}
