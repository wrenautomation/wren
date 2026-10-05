#!/usr/bin/env node
// Is Restate keeping up? Every loop's next pass is a timer; one still waiting well past its
// time means Restate is late (Cloud throttles its free plan past 100k actions a month).
// Late loops go to Discord: the sign to move to the box (designs/2026-10-05-restate-self-host.md).
// CI runs it hourly (.github/workflows/restate-lag.yml). Env: RESTATE_HOST (default prod's, as
// scripts/ingress.mjs), RESTATE_AUTH_TOKEN, WREN_DISCORD_WEBHOOK_URL (unset: print only),
// LAG_MINUTES (default 15).
const host = process.env.RESTATE_HOST ?? "201m2vp6sq3x11xdaatsmjej302.env.us.restate.cloud";
// Cloud's admin API is public on :9070; the box's Caddy serves its query under /admin.
const admin = host.endsWith(".restate.cloud") ? `https://${host}:9070` : `https://${host}/admin`;
const slackMs = Number(process.env.LAG_MINUTES ?? 15) * 60_000;
const hook = process.env.WREN_DISCORD_WEBHOOK_URL;

// `scheduled_at` rides along: without it Restate leaves `scheduled_start_at` out (console.ts).
const SQL = `SELECT target_service_name, target_service_key, scheduled_at, scheduled_start_at
FROM sys_invocation WHERE target_handler_name = 'loop' AND status = 'scheduled'`;

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

let rows;
try {
  const res = await fetch(`${admin}/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESTATE_AUTH_TOKEN}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ query: SQL }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  rows = (await res.json()).rows;
} catch (err) {
  await say(
    `Restate admin did not answer: ${err.message}. Throttled? See the self-host design doc.`,
  );
  process.exit(1);
}

const now = Date.now();
const late = rows
  .filter((r) => r.scheduled_start_at && now - Date.parse(r.scheduled_start_at) > slackMs)
  .map((r) => {
    const min = Math.round((now - Date.parse(r.scheduled_start_at)) / 60_000);
    return `${r.target_service_name}/${r.target_service_key} ${min} min late`;
  });
if (late.length)
  await say(
    `Restate is late: ${late.length} loop timers past due by over ${slackMs / 60_000} min.\n${late.slice(0, 20).join("\n")}\nTime to move to the box: \`node scripts/restate-move.mjs\` (designs/2026-10-05-restate-self-host.md).`,
  );
else console.log(`${rows.length} loop timers, none late`);
