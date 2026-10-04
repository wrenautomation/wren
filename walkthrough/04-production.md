# 4 · Production

**Goal:** know what is live, how a change gets there, and how to poke any
loop.

## What is live

| | |
|---|---|
| Restate Cloud | env `wren-automation`, region `us`; the only always-on piece: every loop's timer and state |
| Worker | AWS Lambda `wren-prod-worker` (Node 22 arm64); runs only when Restate invokes it |
| State | Postgres 17 in Docker on one EC2 `t4g.small`, own EBS, TLS only, nightly dump → S3 |
| Browser | browserless Chromium on the same box over CDP (`WREN_RENDERER=cdp`) |
| Secrets | one SSM SecureString `/wren/prod/env`, loaded at cold start |
| Sites / posting | autobrowse's box (`i-0416f466bb82982eb`), woken by wren before a `sites` call |

≈ $15/month. Full table: `../docs/restate-operations.md`.

## A change gets there by push

`git push` to main → `ci` (gates) → `deploy`: `pnpm db:migrate` against
prod, build `lambda.zip`, publish a version, register it with Restate
Cloud. Nothing by hand. A schema change = edit `src/schema.ts`, `pnpm
db:generate --name <what>`, review the SQL, commit.

Secrets: edit `deploy/prod.env`, `scripts/push-secrets.sh`, push (a cold
start reads the store).

## Poke a loop

Every loop is a Restate Virtual Object with `start | stop | status | sync`
(one pass now). From the CLI where one exists, or curl:

```sh
H="Authorization: Bearer $RESTATE_AUTH_TOKEN"     # in .env
U=https://201m2vp6sq3x11xdaatsmjej302.env.us.restate.cloud:8080
curl -X POST -H "$H" $U/ContentScheduler/default/status
curl -X POST -H "$H" $U/AdsWatch/default/sync
curl -X POST -H "$H" $U/SendScheduler/<inbox>/status
curl -X POST -H "$H" $U/ComposeScheduler/agencies/status
curl -X POST -H "$H" $U/PoolScheduler/agencies/start
```

`walkthrough/demos/01-loops.sh` prints every loop's running flag and last
pass. `restate invocations list` shows what is sleeping and until when;
`restate invocations describe <id>` one journal.

## The loops on prod today

| Object | Key | Cadence |
|---|---|---|
| SendScheduler | one per inbox | inside the send window, at the ramp |
| InboxScheduler | one per inbox | replies + bounces every few minutes |
| ComposeScheduler | per niche | daily, local midnight |
| PoolScheduler | per niche | a minute apart while any stage finds work, then daily |
| PostmasterScheduler, OpensScheduler, DigestScheduler, PlacementScheduler | fleet | daily |
| ReportScheduler | weekly | Friday 19:00 |
| ContentScheduler | default | a minute while due drafts remain, else until the next slot |
| ContentMetrics | default | every 6 h (one look per post per day); Monday report |
| AdsWatch | default | daily |

## Durability

A loop is one short invocation that sends itself the next; state and timers
live in Restate, so a Lambda crash or a laptop closing changes nothing. Paid
steps (a model call, a send, a Graph write) are `ctx.run` steps: a retry
resumes after the last one that finished, never paying twice.
`../docs/restate-durability.md`.
