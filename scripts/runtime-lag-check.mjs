#!/usr/bin/env node
// Is the runtime keeping up? Checked from outside the box, so a dead box is told too.
// Late: a row due over LAG_MINUTES ago that nothing claimed (its key's lock not held by another).
// Stuck: a running row whose lease ran out over LAG_MINUTES ago: no lane takes it back.
// Paused rows are the DeadLetterFile loop's (`wren dlq`): told there once, not here hourly.
// It also watches the watchdog: `LoopRevive/all` wakes every other dead loop
// (designs/2026-10-16-loop-watchdog.md), so its own lost chain is told here.
// It watches the CDC relay's slot (designs/2026-11-27-central-queue.md phase 4) once wal_level is
// logical: missing, unread with WAL piling up, over 500 MB behind, or past max_slot_wal_keep_size.
// CI runs it hourly (.github/workflows/runtime-lag-check.yml) with psql. Env: WREN_DATABASE_URL,
// WREN_DISCORD_WEBHOOK_URL (unset: print only), LAG_MINUTES (default 15).
import { execFileSync } from "node:child_process";

const db = process.env.WREN_DATABASE_URL;
const minutes = Number(process.env.LAG_MINUTES ?? 15);
const hook = process.env.WREN_DISCORD_WEBHOOK_URL;
if (!db) throw new Error("WREN_DATABASE_URL is unset");
if (!Number.isInteger(minutes) || minutes < 1) throw new Error("LAG_MINUTES: a whole number");

const LATE = `SELECT i.id, i.service, i.key, i.handler,
  round(extract(epoch FROM now() - i.run_at) / 60) AS min
FROM rt.invocations i
WHERE i.status IN ('pending', 'suspended') AND i.run_at < now() - interval '${minutes} minutes'
  AND NOT (i.exclusive AND NOT i.holds AND EXISTS (
    SELECT 1 FROM rt.invocations h WHERE h.holds AND h.service = i.service AND h.key = i.key))
ORDER BY i.run_at LIMIT 50`;
const STUCK = `SELECT id, service, key, handler, build,
  round(extract(epoch FROM now() - lease_until) / 60) AS min
FROM rt.invocations
WHERE status = 'running' AND lease_until < now() - interval '${minutes} minutes'
ORDER BY lease_until LIMIT 50`;
const WATCH = `SELECT convert_from(s.value, 'UTF8') AS value, (SELECT count(*) FROM rt.invocations i
  WHERE i.service = 'LoopRevive' AND i.key = 'all' AND i.status NOT IN ('done', 'killed')) AS calls
FROM rt.state s WHERE s.service = 'LoopRevive' AND s.key = 'all' AND s.name = 'loop'`;

const SLOT = `SELECT current_setting('wal_level') AS wal_level, s.slot_name IS NOT NULL AS present,
  s.active, s.wal_status,
  round(pg_wal_lsn_diff(pg_current_wal_lsn(), s.confirmed_flush_lsn) / 1048576) AS behind_mb
FROM (SELECT 1) x LEFT JOIN pg_replication_slots s ON s.slot_name = 'rt_events_relay'`;
const SLOT_BEHIND_MB = 500;
// a deploy hands the slot from one box slot to the other in seconds: idle under this is that
const SLOT_IDLE_MB = 64;

async function say(text) {
  console.log(text);
  if (!hook) return;
  const res = await fetch(hook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: text.slice(0, 1900) }),
  });
  if (!res.ok) throw new Error(`discord: ${res.status}`);
}

/** Rows as JSON. */
function query(sql) {
  const out = execFileSync(
    "psql",
    [
      "-X",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      db,
      "-c",
      `SELECT coalesce(json_agg(t), '[]') FROM (${sql}) t`,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  return JSON.parse(out.trim() || "[]");
}

let late;
let stuck;
let watch;
let slot;
try {
  [late, stuck, watch, [slot]] = [query(LATE), query(STUCK), query(WATCH), query(SLOT)];
} catch (err) {
  await say(`The runtime's database did not answer: ${String(err.message).split("\n")[0]}`);
  process.exit(1);
}

const name = (r) => `${r.service}/${r.key ? `${r.key}/` : ""}${r.handler}`;
if (late.length)
  await say(
    `The runtime is late: ${late.length} rows due over ${minutes} min ago, not claimed. Is the box worker up?\n${late
      .slice(0, 20)
      .map((r) => `${name(r)} ${r.min} min late (${r.id})`)
      .join("\n")}`,
  );
else console.log("no row late");

if (stuck.length)
  await say(
    `The runtime has ${stuck.length} running rows whose lease ran out and no lane took back.\n${stuck
      .slice(0, 20)
      .map((r) => `${name(r)} on ${r.build ?? "?"}, ${r.min} min (${r.id})`)
      .join("\n")}\nIs the slot that pins them still up?`,
  );
else console.log("no row stuck");

const watchdog = watch[0];
if (watchdog && JSON.parse(watchdog.value).running && Number(watchdog.calls) === 0)
  await say(
    "LoopRevive/all is running but has no next check: no dead loop gets woken. `wren loops watch stop`, then `start`.",
  );
else console.log(watchdog ? "LoopRevive has its next check" : "LoopRevive not started");

const relay = (() => {
  if (slot?.wal_level !== "logical") return null; // the relay waits for it by design
  if (!slot.present) return "has no slot rt_events_relay: is WREN_NATS_URL set on the box worker?";
  if (slot.wal_status === "lost" || slot.wal_status === "unreserved")
    return `slot is ${slot.wal_status}: past max_slot_wal_keep_size; the relay backfills from rt.events once it reads again`;
  if (!slot.active && Number(slot.behind_mb) > SLOT_IDLE_MB)
    return `slot is unread and ${slot.behind_mb} MB behind: is the box worker's relay up (\`docker logs wren-worker | grep relay\`)?`;
  if (Number(slot.behind_mb) > SLOT_BEHIND_MB)
    return `slot is ${slot.behind_mb} MB behind: is NATS (wren-nats) up?`;
  return "";
})();
if (relay) await say(`The CDC relay ${relay}`);
else console.log(relay === null ? "CDC relay: wal_level not logical yet" : "CDC relay keeps up");
