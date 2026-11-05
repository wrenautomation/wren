#!/usr/bin/env node
// Loop renames on the box (designs/2026-11-04-loops.md): state from an old service name to its new one.
//   node scripts/secrets.mjs run .env -- node scripts/restate-rename.mjs          dry run: the plan
//   ... restate-rename.mjs --stop   before the push: stop the old loops that run, drain, kill their
//                                   pending timers (the box retires the old slot), keep the list
//   ... restate-rename.mjs --go     after the deploy: copy state to the new names (loops stopped),
//                                   clear old and DROPPED state, point InboxPush listeners at
//                                   the new names, start what --stop stopped
// Reads over the ingress's /admin/query; state writes over SSM (the full admin API is loopback
// only). The plan never prints state values.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const ingress = process.env.WREN_PROD_INGRESS_URL ?? "https://restate.wrenautomation.com";
const auth = { authorization: `Bearer ${process.env.RESTATE_AUTH_TOKEN}` };
const BOX = "wren-prod-pg";
const mode = process.argv.includes("--go")
  ? "go"
  : process.argv.includes("--stop")
    ? "stop"
    : "dry";
const STOPPED = join(homedir(), ".config/wren/rename-stopped.json");

/** Old service name → new. Edit per rename; empty once done. */
export const RENAMES = {
  Decide: "Judge",
};
/** Deleted loops: state cleared. */
export const DROPPED = [];

async function query(sql) {
  const res = await fetch(`${ingress}/admin/query`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`query: ${res.status} ${await res.text()}`);
  return (await res.json()).rows;
}

const list = (names) => names.map((n) => `'${n}'`).join(", ");

/** Every object's state per key, as UTF-8 text. A non-UTF-8 value would not copy: refuse. */
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

/** The state as written under the new name: the same, loop stopped (`start` restarts it). */
export function stopped(state) {
  const out = { ...state };
  if (out.loop) out.loop = JSON.stringify({ ...JSON.parse(out.loop), running: false });
  if (out.running) out.running = "false";
  return out;
}

const readOld = async () =>
  objectsOf(
    await query(
      `SELECT service_name, service_key, key, value_utf8 FROM state WHERE service_name IN (${list([...Object.keys(RENAMES), ...DROPPED])})`,
    ),
  );

/** `InboxPush` listeners name a loop by service: a renamed one's push would hit a gone name. */
export function relisten(objects) {
  const out = [];
  for (const o of Object.values(objects)) {
    if (!o.state.listeners) continue;
    const ls = JSON.parse(o.state.listeners);
    if (!ls.some((l) => RENAMES[l.service])) continue;
    const listeners = ls.map((l) => ({ ...l, service: RENAMES[l.service] ?? l.service }));
    out.push({ ...o, state: { ...o.state, listeners: JSON.stringify(listeners) } });
  }
  return out;
}
const readPush = async () =>
  objectsOf(
    await query(
      "SELECT service_name, service_key, key, value_utf8 FROM state WHERE service_name = 'InboxPush'",
    ),
  );

/** Calls not done on an old or dropped name; paused ones wait in the dead-letter queue. */
const open = () =>
  query(
    `SELECT id, target_service_name, target_handler_name, status FROM sys_invocation WHERE status NOT IN ('completed', 'paused') AND target_service_name IN (${list([...Object.keys(RENAMES), ...DROPPED])})`,
  );
/** A scheduled `loop` call is a timer: killed once its loop stops. Anything else drains first. */
const isTimer = (r) => r.target_handler_name === "loop" && r.status === "scheduled";

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
const setState = (service, key, state, tag) => {
  const body = JSON.stringify({
    object_key: key,
    new_state: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, bytes(v)])),
  });
  return `curl -sf -X POST http://127.0.0.1:9070/services/${encodeURIComponent(service)}/state -H 'content-type: application/json' -d ${sh(body)} && echo "${tag} ${service}/${key}" || echo "FAILED ${tag} ${service}/${key}"`;
};

/** Copy (stopped), clear old, start what ran. Batched under SSM's size limit. */
function toBox(objects, restart, push) {
  const instance = aws([
    "ec2",
    "describe-instances",
    "--filters",
    `Name=tag:Name,Values=${BOX}`,
    "Name=instance-state-name,Values=running",
  ]).Reservations[0]?.Instances[0]?.InstanceId;
  if (!instance) throw new Error(`no running ${BOX}`);
  const lines = [];
  for (const o of Object.values(objects)) {
    const to = RENAMES[o.service];
    if (to) lines.push(setState(to, o.key, stopped(o.state), "copied"));
    lines.push(setState(o.service, o.key, {}, "cleared"));
  }
  for (const o of push) lines.push(setState(o.service, o.key, o.state, "relistened"));
  for (const o of restart)
    lines.push(
      `curl -sf -o /dev/null -X POST http://127.0.0.1:8080/${RENAMES[o.service]}/${encodeURIComponent(o.key)}/start && echo "started ${RENAMES[o.service]}/${o.key}" || echo "FAILED start ${RENAMES[o.service]}/${o.key}"`,
    );
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

const before = await readOld();
for (const o of Object.values(before))
  console.log(
    `${isRunning(o.state) ? "running" : "stopped"}  ${o.service}/${o.key} → ${RENAMES[o.service] ?? "(cleared)"}  ${Object.keys(o.state).length} keys`,
  );
if (mode === "dry") {
  console.log("dry run. --stop before the push, --go after the deploy.");
} else if (mode === "stop") {
  // a rerun keeps the list an earlier --stop saved: those loops show stopped now
  const saved = existsSync(STOPPED) ? JSON.parse(readFileSync(STOPPED, "utf8")) : [];
  const running = Object.values(before)
    .filter((o) => RENAMES[o.service] && isRunning(o.state))
    .map(({ service, key }) => ({ service, key }));
  const restart = [
    ...saved,
    ...running.filter((o) => !saved.some((s) => s.service === o.service && s.key === o.key)),
  ];
  mkdirSync(dirname(STOPPED), { recursive: true });
  writeFileSync(STOPPED, JSON.stringify(restart, null, 1));
  for (const o of restart) {
    // send: a loop mid-run holds the object; the drain below waits for it
    const res = await fetch(`${ingress}/${o.service}/${encodeURIComponent(o.key)}/stop/send`, {
      method: "POST",
      headers: auth,
    });
    if (!res.ok) throw new Error(`stop ${o.service}/${o.key}: ${res.status}`);
    console.log(`stop sent ${o.service}/${o.key}`);
  }
  for (let i = 0; ; i++) {
    const left = (await open()).filter((r) => !isTimer(r));
    if (!left.length) break;
    if (i >= 60)
      throw new Error(
        `still busy after 10 minutes: ${left.map((b) => `${b.target_service_name}/${b.target_handler_name}`).join(", ")}`,
      );
    await new Promise((r) => setTimeout(r, 10_000));
  }
  for (const t of (await open()).filter(isTimer)) {
    const res = await fetch(`${ingress}/admin/invocations/${t.id}/kill`, {
      method: "PATCH",
      headers: auth,
    });
    console.log(`${res.ok ? "killed" : `FAILED ${res.status}`} timer ${t.target_service_name}`);
  }
  console.log(`saved ${restart.length} to restart in ${STOPPED}. Push, then --go.`);
} else {
  if (!existsSync(STOPPED)) throw new Error(`no ${STOPPED}: run --stop first`);
  toBox(before, JSON.parse(readFileSync(STOPPED, "utf8")), relisten(await readPush()));
  console.log("renamed.");
}
