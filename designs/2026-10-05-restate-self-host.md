# Restate self-host

Living doc. Started 2026-10-05. William: "Self hosting restate is fine, that along with potential cuts in tandem."

## Answer first

- Restate moves from Restate Cloud to the Postgres box. The box goes from `t4g.small` to `t4g.medium`: +$12/month, about $27/month in all.
- We stop running about 2.9M journal entries a month on a 50k-action free tier, and we never face the $75+/month plans.
- Nothing about the services changes. Only where they register, and the ingress URL, change.
- Two cuts ship with it:
  - pool units in batches;
  - fewer writes per loop pass.

  They make the box do less work. The bill no longer depends on them.

## What runs where after

| Piece | Today | After |
|---|---|---|
| Restate server | Restate Cloud, env `wren-automation` | `restate-server` in Docker on `wren-prod-pg`, data on the EBS volume (`/var/lib/wren-pg/restate`) |
| Ingress | `https://<env>.env.us.restate.cloud:8080`, Cloud API key | `https://restate.wrenautomation.com`, through Caddy on the box. Caddy checks `Authorization: Bearer <RESTATE_AUTH_TOKEN>` and passes to `127.0.0.1:8080` |
| Admin API | Cloud | `127.0.0.1:9070` only. CI reaches it over SSM, the way it ships the box worker today |
| Lambda worker | Cloud assumes `wren-prod-restate-invoker` | The box's instance role invokes the worker directly (`lambda:InvokeFunction` on the worker's ARN and versions). The invoker role and its trust policy go |
| Box worker | dials Cloud's tunnel | serves HTTP on `127.0.0.1:9080`, registered as `http://127.0.0.1:9080` |
| autobrowse desk (Mac) | dials Cloud's tunnel | serves HTTP on localhost, reached through a Cloudflare Tunnel at `desk.wrenautomation.com`. Restate's request signing (`request-identity-private-key-pem-file`, the key `WREN_RESTATE_IDENTITY_KEY` already pairs with) means only our server is served. Calls still wait in Restate while the Mac sleeps |

The server config: `rocksdb-total-memory-size = "512 MB"` and one partition set. The box budget on 4 GB is roughly:

| Process | Memory |
|---|---|
| Postgres | 1 GB |
| browserless | 1 GB |
| box worker | 640 MB |
| Restate | about 700 MB |

That leaves headroom.

## Moving

State is small: 24 services, about 140 keys (`select ... from state` on Cloud). It is copied, not rebuilt.

1. Resize the box and start `restate-server` and Caddy. They're Terraform plus `user-data.sh`, so a rebuilt box comes up the same way.
2. Register the Lambda's live version, the box worker and the desk on the new server. Nothing is sent to it yet.
3. Run `scripts/restate-move.mjs`:
   - On Cloud, it stops every running loop and waits for in-flight invocations to drain (`sys_invocation` empty, except loops' delayed sends).
   - It reads every state row from Cloud and writes each to the new server through the admin state API, with `RUNNING` forced to false.
   - On the new server, it calls `start` on every loop that was running.
   - It prints a before and after table of loop keys and running.
4. Flip the ingress URL everywhere it lives, in one commit plus one secrets push:
   - SSM `/wren/prod/env`;
   - GitHub secrets `RESTATE_HOST` and `RESTATE_AUTH_TOKEN`;
   - the phone and portal Workers (CI writes them);
   - autobrowse's env (`src/app/config.ts`);
   - `scripts/ingress.mjs` and `prod-wren.mjs` (they read `.env`).
5. Watch one day: every loop's `status`, and `restate invocations list` on the new server.
6. Delete the Cloud environment a week later. Until then it is the way back.

Webhooks lose nothing in the gap. Telnyx, cal.com and Gmail push all retry, and each is applied once by its Postgres unique row.

## Backups

The nightly backup job that dumps Postgres also takes a Restate snapshot: `restatectl snapshots create`, then the data dir is synced to the same S3 bucket under `restate/`, with a 7-day lifecycle.

Losing Restate entirely is survivable. Every loop's settings can be re-made with `start` and its body, and work in flight is idempotent by design (the run durability principle). `scripts/restate-move.mjs --rearm` restarts every loop from a list in code, for that day.

## Cuts

1. **Pool units in batches.** Enrichment, Discovery and Resolution do one unit per invocation, at about 30 entries a unit. They take up to 20 units per invocation, with one `ctx.run` per unit (`run` already checkpoints per unit). That should take the pool chain from about 68k entries a day to about 10k. It changes no queue semantics: a crash replays from the last finished unit.
2. **One write per loop pass.** `makeLoopObject` writes `LAST` and the outcome separately, and reads `RUNNING` and `GENERATION` as two gets. One state key, `loop`, holds `{running, generation, last}`, taking a pass from about 12 entries to about 8. `status` reads the same key, so its output doesn't change.
3. **SmsSender idle.** While no number is active it sleeps 6 hours, not 5 minutes. A new number or `start` wakes it.

## Phases

- R1. Terraform (instance type, Caddy, DNS for `restate`), `restate-server` and Caddy in `user-data.sh`, the instance role's invoke grant, the box worker on HTTP, the backup step.
- R2. autobrowse desk on HTTP, plus the Cloudflare Tunnel (`cloudflared` under launchd, installed by `deploy/desk/install.sh`).
- R3. `scripts/restate-move.mjs` and the move itself, then the ingress flip.
- R4. Cuts 1 to 3, each with its unit test. A pass's entry count is measured before and after with `restate sql`.
- R5. Docs: the hosts table and the diagram in `docs/restate-operations.md`, `deploy/README.md`, the map cards for restate and the box.

## Done when

- Every loop that was running on Cloud is running on the box, with the same settings.
- A Telnyx test webhook, a cal.com ping and a Gmail push each land.
- A desk `sites` call works, and works again after the Mac sleeps.
- One day later: no stuck invocations, the box's memory is under 80%, and the backup has a snapshot.
- The Cloud environment is deleted after a quiet week.

## Decision log

- 2026-10-05: Written. On the box, not a new instance: one host to keep alive, and Restate's journal next to Postgres makes no new network hop. Cloudflare Tunnel for the desk, not Tailscale: everything public already sits on Cloudflare, and the tunnel is free. Copy the state, not "restart each loop" as round 2 said: 140 keys copy in seconds and keep settings exactly. Cuts ship anyway: fewer entries are less disk and CPU on a shared box.
- 2026-10-05 (R4): Measured on Cloud over 48 h: 101k entries (about 50k a day), the pool chain about 36k a day. Cut 1's premise was wrong: Enrichment and Discovery already run many units per invocation, each its own `ctx.run` (2 entries). The cut batches free, idempotent units 20 per `ctx.run` (`research/restate/units.ts`); a unit that throws runs alone under its old retry. Units that buy a model call or a metered read (pick with a model, extract, opener, profiles) stay one per run, so a crash never buys twice. Resolution already ran one step per pass: unchanged.
- 2026-10-05 (R4): Cut 2 lands at about 10 entries a pass, not 8: `ctx.date.now()` and the self-send's notification are journaled too. The `loop` key takes over `running`, `generation` and `last` on its first write and clears them, so a revert of cut 2 needs a `start` per loop. SendScheduler moved to the same key; the console reads `loop` first.
- 2026-10-05 (R4): Cut 3 wakes through a new `wake` handler on every loop (a running loop passes now, a stopped one stays stopped), sent by `syncNumbers` when it adds a number and by `resume`. `start` on a running loop stays a no-op: making it pass at once would change every loop's `start`.
- 2026-10-05 (R1): The desk's tunnel carries raw TCP, not HTTP. Tested on a quick tunnel: an HTTP origin gets Cloudflare's 524 at 100 s, and h2 streaming through it breaks ("stream error"). In TCP mode, with a `cloudflared access tcp` hop on the box at `127.0.0.1:9082`, a 130 s call finished. Desk calls on Cloud: 350 in 48 h, longest 56 s, so the ceiling would bite rarely, but it costs one small container to remove it.
- 2026-10-05 (R1): Caddy opens two admin reads under the same bearer: `POST /admin/query` and `GET /admin/services*`. The console in the Lambda reads loops and services from the admin API (`WREN_RESTATE_ADMIN_URL`). Every other admin call stays on loopback; CI and the desk register over SSM.
- 2026-10-05 (R1): The `restate-invoker` role stays until Cloud is deleted: it is the way back. The box's instance role invokes the worker. The Lambda still enforces no identity key (it never did); IAM is its gate.
- 2026-10-05 (R1): The Restate backup is its own cron at 08:30, after the 08:00 Postgres dump. The live box's dump script came from user-data, which never re-runs. The data dir goes up as one dated tarball, not a sync: a 7-day expiry would delete unchanged files of a synced dir. With a snapshot destination set, partitions read S3 on start, so the role gets `GetObject` on `restate/`.
