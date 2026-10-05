#!/usr/bin/env node
// Move Restate from Cloud to the box (designs/2026-10-05-restate-self-host.md, "Moving").
//   node scripts/restate-move.mjs          dry run: read Cloud, save a snapshot, print the plan
//   node scripts/restate-move.mjs --go     stop Cloud's loops, drain, copy every state row to the
//                                          box with loops stopped, start there what ran on Cloud
//   node scripts/restate-move.mjs --go --force   the same, past invocations still busy after 10 min
//   node scripts/restate-move.mjs --rearm  the saved snapshot onto the box again (Restate lost)
// Cloud is read with the API key in .env. The box's admin API is loopback only, so its writes
// run there over SSM (AWS-RunShellScript), like CI's registration. The snapshot holds state
// values: it lives in ~/.config/wren (0600), never in the repo.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(join(root, ".env"));
const ingress =
  process.env.WREN_PROD_INGRESS_URL ??
  "https://201m2vp6sq3x11xdaatsmjej302.env.us.restate.cloud:8080";
const cloudAdmin = ingress.replace(/:8080\/?$/, ":9070");
const auth = { authorization: `Bearer ${process.env.RESTATE_AUTH_TOKEN}` };
const SNAPSHOT = join(homedir(), ".config/wren/restate-snapshot.json");
const BOX = "wren-prod-pg";
const mode = process.argv.includes("--go")
  ? "go"
  : process.argv.includes("--rearm")
    ? "rearm"
    : "dry";

async function cloudQuery(query) {
  const res = await fetch(`${cloudAdmin}/query`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`cloud query: ${res.status} ${await res.text()}`);
  return (await res.json()).rows;
}

/** Every object's state, as UTF-8 JSON text per key. A non-UTF-8 value would not copy: refuse. */
export function objectsOf(rows) {
  const out = {};
  for (const r of rows) {
    if (r.value_utf8 == null)
      throw new Error(`${r.service_name}/${r.service_key} ${r.key}: not UTF-8`);
    const id = `${r.service_name}/${r.service_key}`;
    out[id] ??= { service: r.service_name, key: r.service_key, state: {} };
    out[id].state[r.key] = r.value_utf8;
  }
  return out;
}

/** A loop runs when its `loop` key says so, or its `running` key from before cut 2. */
export function isRunning(state) {
  if (state.loop) return JSON.parse(state.loop).running === true;
  return state.running === "true";
}

/** The state to write on the box: the same, with every loop stopped (`start` there restarts it). */
export function stopped(state) {
  const out = { ...state };
  if (out.loop) out.loop = JSON.stringify({ ...JSON.parse(out.loop), running: false });
  if (out.running) out.running = "false";
  return out;
}

/**
 * Invocations still working on Cloud. A scheduled `loop` call is a no-op once its loop stops;
 * a paused one waits for a person and never drains (it stays on Cloud, listed).
 */
const BUSY_SQL = `SELECT target_service_name, target_service_key, target_handler_name, status
FROM sys_invocation WHERE status NOT IN ('completed')`;
export const busyOf = (rows) =>
  rows.filter(
    (r) => r.status !== "paused" && !(r.target_handler_name === "loop" && r.status === "scheduled"),
  );

const readCloud = async () =>
  objectsOf(await cloudQuery("SELECT service_name, service_key, key, value_utf8 FROM state"));

/** The snapshot `--rearm` replays: every object, and the loops to start. */
function save(objects, restart) {
  mkdirSync(dirname(SNAPSHOT), { recursive: true });
  const at = new Date().toISOString();
  writeFileSync(SNAPSHOT, JSON.stringify({ at, objects, restart }, null, 1), { mode: 0o600 });
}

function aws(args) {
  return JSON.parse(execFileSync("aws", [...args, "--output", "json"], { encoding: "utf8" }));
}

/** One shell script on the box; its stdout back. */
function onBox(instance, script) {
  const sent = aws([
    "ssm",
    "send-command",
    "--instance-ids",
    instance,
    "--document-name",
    "AWS-RunShellScript",
    "--parameters",
    JSON.stringify({ commands: [script] }),
  ]);
  const id = sent.Command.CommandId;
  for (let i = 0; i < 90; i++) {
    execFileSync("sleep", ["2"]);
    let r;
    try {
      r = aws(["ssm", "get-command-invocation", "--command-id", id, "--instance-id", instance]);
    } catch {
      continue; // InvocationDoesNotExist for the first moment
    }
    if (["Pending", "InProgress", "Delayed"].includes(r.Status)) continue;
    if (r.Status !== "Success") throw new Error(`on box: ${r.Status} ${r.StandardErrorContent}`);
    return r.StandardOutputContent;
  }
  throw new Error("on box: no answer in 3 minutes");
}

const sh = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const bytes = (text) => [...Buffer.from(text, "utf8")];

/** Write every object's state on the box (loops stopped), then start `restart`. Batched under SSM's size limit. */
function toBox(objects, restart) {
  const instance = aws([
    "ec2",
    "describe-instances",
    "--filters",
    `Name=tag:Name,Values=${BOX}`,
    "Name=instance-state-name,Values=running",
  ]).Reservations[0]?.Instances[0]?.InstanceId;
  if (!instance) throw new Error(`no running ${BOX}`);
  const lines = Object.values(objects).map((o) => {
    const body = JSON.stringify({
      object_key: o.key,
      new_state: Object.fromEntries(
        Object.entries(stopped(o.state)).map(([k, v]) => [k, bytes(v)]),
      ),
    });
    return `curl -sf -X POST http://127.0.0.1:9070/services/${encodeURIComponent(o.service)}/state -H 'content-type: application/json' -d ${sh(body)} && echo "state ${o.service}/${o.key}" || echo "FAILED state ${o.service}/${o.key}"`;
  });
  for (const id of restart) {
    const o = objects[id];
    if (o)
      lines.push(
        `curl -sf -o /dev/null -X POST http://127.0.0.1:8080/${encodeURIComponent(o.service)}/${encodeURIComponent(o.key)}/start && echo "started ${o.service}/${o.key}" || echo "FAILED start ${o.service}/${o.key}"`,
      );
  }
  // ponytail: ~20 KB per command keeps under SSM's parameter limit; S3 handoff if state grows past a few MB.
  let batch = [];
  const flush = () => {
    if (batch.length) process.stdout.write(onBox(instance, batch.join("\n")));
    batch = [];
  };
  for (const l of lines) {
    if (batch.join("\n").length + l.length > 20_000) flush();
    batch.push(l);
  }
  flush();
}

function table(objects) {
  const loops = Object.entries(objects).filter(([, o]) => o.state.loop || o.state.running);
  for (const [id, o] of loops) console.log(`${isRunning(o.state) ? "running" : "stopped"}  ${id}`);
  const keys = Object.values(objects).reduce((n, o) => n + Object.keys(o.state).length, 0);
  console.log(`${Object.keys(objects).length} objects, ${keys} keys, ${loops.length} loops`);
}

const running = (objects) => Object.keys(objects).filter((id) => isRunning(objects[id].state));

if (mode === "rearm") {
  const { at, objects, restart } = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  console.log(`snapshot from ${at}; starts ${restart.length} loops`);
  toBox(objects, restart);
} else {
  const before = await readCloud();
  table(before);
  for (const b of await cloudQuery(BUSY_SQL))
    if (b.status !== "scheduled")
      console.log(
        `${b.status}  ${b.target_service_name}/${b.target_service_key ?? ""}/${b.target_handler_name}`,
      );
  const restart = running(before);
  if (mode === "dry") {
    save(before, restart);
    console.log(`dry run; snapshot at ${SNAPSHOT}. --go moves.`);
  } else {
    for (const id of restart) {
      const { service, key } = before[id];
      const res = await fetch(`${ingress}/${service}/${encodeURIComponent(key)}/stop`, {
        method: "POST",
        headers: auth,
      });
      if (!res.ok) throw new Error(`stop ${id} on Cloud: ${res.status}`);
    }
    // A pass in flight finishes first; wait up to 10 minutes for Cloud to go quiet.
    for (let i = 0; ; i++) {
      const left = busyOf(await cloudQuery(BUSY_SQL));
      if (!left.length) break;
      const names = left.map((b) => `${b.target_service_name}/${b.target_handler_name}`).join(", ");
      // --force leaves them on Cloud: fine for idempotent work a restarted loop redoes.
      if (i >= 60 && process.argv.includes("--force")) {
        console.log(`left on Cloud: ${names}`);
        break;
      }
      if (i >= 60)
        throw new Error(`still busy on Cloud after 10 minutes: ${names}. --force moves anyway.`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
    const after = await readCloud();
    save(after, restart);
    toBox(after, restart);
    console.log("moved. Next: flip the ingress (runbook in the design doc).");
  }
}
