# Central job queue: list, pause and trace every job (WA-1465)

2026-11-27. Status: A agreed, call 4 (c) agreed; phases 1-3 built and live; phase 4 (CDC relay) built and live 11-28. Handoff: `handoffs/2026-11-27-central-queue.md`. Diagram: `2026-11-27-central-queue.excalidraw` (devboard project "Central queue").

## Goal

One place to list, pause, resume and trace every job: wren loops, desk calls, Mac crons, internships. Each browser launch names the job that owns it. More machines can join later with no rewrite.

```
wren jobs                          # every job: where it runs, next run, held or live, last result
wren jobs pause <job> [--for 2h] --why "..."
wren jobs resume <job>
wren jobs trace <job|inv_id>       # runs, steps, browser launches, logs
```

`held` is the CLI word for a pause by a person. `paused` in `rt.invocations` keeps its meaning: a dead letter (`packages/runtime/src/pg/schema.ts:18`).

## Target architecture (William, 11-27)

| Layer | Is | Today |
|---|---|---|
| Door | the one way in: auth, submit, cancel, `/rt/claim` for pull workers | `rt` door, `api.wrenautomation.com` |
| Source of truth | Postgres tables: `jobs` (definitions), `invocations` (runs = the queue), `journal` + `state` (durable steps), `job_pauses` (control), `events` (outbox, append-only, same transaction as the run) | `invocations`, `journal`, `state`; the rest are new |
| Orchestrator | scheduler (jobs → runs when due) + dispatcher (claim `SKIP LOCKED`, lease, fence, retry, timers). One node now; N later with a leader lock on the scheduler | dispatcher on the box worker |
| Pooled workers | each claims only runs it can do. Push: Lambda, box. Pull over the door: Mac desk, Mac command runner, more hosts | Lambda, box, desk |
| Fan-out | CDC (Postgres logical replication) reads `rt.events` → NATS JetStream (`RT_EVENTS`) → consumers. Nothing writes the broker directly. Relay: our own Node reader on `pgoutput`, inside the box worker (`packages/runtime/src/pg/relay.ts`); options in the 11-28 log line | none |

Rules (standard job-system rules; references in Canon topic `system-design`):

- The table is the only truth. A broker gets rows only through outbox + CDC, never a dual write.
- Schedules make runs. Workers are pooled and generic. No cron belongs to a worker.
- Each claimed run has a lease and a fence. Delivery is at-least-once, so each outside act has an idempotency key.
- A scarce resource (a browser profile, an account) has one holder at a time, and the holder is named.

## Today (checked 11-27)

| Job | Trigger | Runs on | Browser | Stop today |
|---|---|---|---|---|
| wren loops (~62 services, e.g. `ReachInboxRead/daily`, `ReachSend/fleet`) | the loop sends its own next tick (`core/src/restate/loop.ts:466-476`) | box, Lambda | through desk calls | per-loop CLI (`wren social stop`, ...) or `wren loops cancel` |
| parts of a loop pass (`replies <acct>`, `comments <acct>`, `invites <acct>`) | inside the pass (`watch.ts:589-652`) | same | through desk calls | `unit_holds`: set after 3 timeouts, cleared by `wren loops release`; no "hold" verb |
| desk calls (`desk`, `claude`, `studio`, `calls`, `apps/worker/src/rt.ts:73`) | rt rows, pulled over `/rt/claim` | Mac desk | yes | stop the caller loop; a profile reserve (`autobrowse/src/browser/reserve.ts`) |
| `creator-refresh` (launchd 10:45) | launchd | Mac; calls prod via `prod-wren.mjs` | via weaver → desk | `launchctl disable` |
| `capture` (launchd 10:15) | launchd | Mac; calls prod | yes: `autobrowse site call` runs Chrome in its own process | `launchctl disable` |
| `canon-drain` (KeepAlive) | claims `canon_add_requests` rows | Mac; calls prod | no | `launchctl disable` |
| `internships-mail` (every 180 s), `-poll`, `-prepare`, `-draft`, `-apply-0..2` | launchd | Mac; no prod | yes: `mailcode.mjs` and `prepare.mjs` run bare Playwright; `mailcode` skips autobrowse because autobrowse treats "enter the code" as a wall | `toggle.sh` |
| `skill-use-report`, `devboard-backup`, `autobrowse-desk-deploy` (every 60 s) | launchd | Mac | no | `launchctl disable` |
| `autobrowse run` jobs | autobrowse local SQLite runner (WA-1415) | Mac | yes | none |

Gaps:

1. **Many control planes.** rt, `unit_holds`, profile reserves, launchd, `toggle.sh`, the SQLite runner. Stopping the desk's reads on 11-27 needed 4 tools.
2. **No pause by a person.** A loop's `stop` ends its chain. A tick queued before the stop does nothing (`loop.ts:470-472`), but desk calls the pass already sent still run.
3. **Browsers with no named job.** `assertProfileFree` already names the holder's pid and opener (`autobrowse/src/browser/browsers.ts:388-403`). It cannot name the job. The 11-27 browser had parent pid 1, so the parent walk found nothing.
4. **No verb to hold one part of a loop.** The parts are `unit_holds` units, but only the system sets a hold.

## Where a pause acts

One CLI, one table (`job_pauses`: service, key, unit or site, until, why, by). Each kind of job reads it at its own layer:

| Job kind | Pause acts in | Effect |
|---|---|---|
| Loop | the pass reads `job_pauses` first and returns `pausedPass` (`loop.ts:143-159`) | no work; the chain lives and checks again after its delay; LoopRevive sees it alive |
| Part of a loop | a person-written `forever` row in `unit_holds` (`checks.ts:45-51`), read each pass by `holdsOn` (`limits.ts:232`): `wren jobs pause ReachInboxRead/daily --unit "replies <acct>"` | the pass skips that unit; the other parts go on. Browser units per account: `replies`, `comments`, `health`, `threads`, `invites`; per platform: `posts` (`watch.ts:438-676`) |
| Desk call | the door, which has the pg rows. At submit it reads `site` and `caller` from the JSON input (`autobrowse/src/sites/service.ts:88-96`) and refuses a match; at claim it ends a queued match the same way | a terminal error at once; the pass's catch skips the unit, and only a timeout counts a strike (`limits.ts:6-9`) |
| Scheduled job | the scheduler | `drop` skips the tick; `hold` keeps one run for resume |

Never drop a loop tick, and never filter loop rows at claim. The chain sends its own next tick, so a dropped tick ends the loop and LoopRevive wakes it or calls it dead (`core/src/loop-watch.ts:3-7`). A held row also blocks every handler on its key (`store.ts:102-108`).

Browser owner, two levels:

- **Process:** the launch reads `AUTOBROWSE_JOB` (set by the runner for its children: `job:<name>/<inv_id>`), else `XPC_SERVICE_NAME` from the browser's env. launchd sets that variable on every job, and child processes inherit it (checked 11-27: the desk and canon-drain show their labels). `ProfileBusy` and `autobrowse browsers` show it. This covers bare Playwright (internships) with no change to that code.
- **Call:** a desk browser is born under the desk, so its env says `autobrowse-desk` for every call. The call's owner is its `caller` field, kept in the desk's call log. `wren jobs trace` joins on it.

## Options

Ranked by: (1) one place to pause each job, (2) each browser launch has an owner, (3) free and self-hostable, (4) cluster later with no rewrite. Hard limits: Docker VM 2 GB, Mac 16 GB, the t4g.small already runs Postgres, PgBouncer, listmonk and the box worker.

The pause layers and the browser owner above are the same under every option. The options differ in where schedules and the queue live.

### A. Central orchestrator on rt (recommended)

The target architecture above, built on `rt.*`. Add `rt.schedules` to the scheduler. The Mac crons that call prod (capture, creator-refresh) become runs claimed by a **Mac command runner**: its own launchd KeepAlive process, apart from the desk, so a desk restart (`update.mjs:206`) does not kill a job. Each job gets one key with an exclusive lock, so two ticks never overlap; pulled rows have no key lock today (`pull.ts:78-80`), so this is new runtime work. Each tick's idempotency key is the job plus the tick time, so two scheduler nodes never insert it twice. A missed tick while the Mac sleeps waits as one pending row; the next tick is not inserted while one waits. canon-drain stays KeepAlive; its table is already in pg.

For: one plane for all wren jobs; no new server; scheduler and pooled workers cluster with `SKIP LOCKED` and pull. These two already call prod (`prod-wren.mjs`), so they gain no new dependency. `skill-use-report` (canon) and `devboard-backup` are local and stay on launchd: moved, a local backup would need prod and the internet, the trade-off call 2(b) refused for internships. Against: we own schedule semantics (~cron table + leader lock); the command runner is new.

### E. One CLI, an adapter per plane

No scheduler. `wren jobs` drives each plane where it is: rt rows, `unit_holds`, the desk's pause list, and launchd (`launchctl print`, `disable`/`enable`, `toggle.sh`, each plist's log file).

For: the least new code; Mac jobs keep running with no internet. Against: launchd stays a scheduler outside the queue; Mac jobs do not cluster; trace for launchd jobs is only a log file. It is a step toward A, not an end state.

### B. A broker as the queue (RabbitMQ, NATS, Kafka, SQS)

A broker carries runs; rt keeps workflow state. Two stores, so a run row and its message can disagree unless every write goes through an outbox. Schedules, pause and owner stay ours.

- **RabbitMQ:** no native queue pause; you cancel consumers. No crons without a plugin. No.
- **Kafka:** a log, not a job queue; no server-side consumer pause; the JVM does not fit the 2 GB cap. No.
- **SQS:** hosted, so it fails "self-hostable"; no pause; no list of queued jobs. No.
- **NATS JetStream:** pauses a consumer until a time (server 2.11+); small. The right broker for fan-out under A, fed by CDC. Not as the queue.

### C. Replace rt with a framework

- **Hatchet** (Postgres-only mode via `hatchet-lite`): workflow pause with hold or drop for crons, worker pause, a dashboard. Against: rewrite of ~850 `ctx.run` sites off the Restate shape; a new always-on engine; workers run in a process, so Lambda goes unused (why DBOS lost on 11-09, `2026-11-09-own-runtime.md:26-38`).
- **DBOS:** lost on 11-09, same reason.
- **pg-boss, graphile-worker:** a second queue in the same pg, with crons and no pause. They help only with schedules, which A needs as one table.

### Score

| | 1 One pause place | 2 Owner | 3 Free, self-host | 4 Cluster | New servers | Size (estimate) |
|---|---|---|---|---|---|---|
| **A. Orchestrator on rt** | **yes** | env | yes | yes | 0 | medium |
| E. Adapter per plane | one CLI, many planes | env | yes | no for Mac jobs | 0 | small |
| B. Broker as queue | split | env | yes (not SQS) | yes | 1 | medium + outbox |
| C. Hatchet | yes | env | yes | yes | 1 | rewrite |

## Recommendation

A, in phases. Each phase works alone.

1. **Owner + holds.** Browser owner from env. `job_pauses` + `wren jobs list|pause|resume` over loops (`pausedPass`), units (`unit_holds`), desk calls (refused at the door) and launchd jobs (the adapter from option E: `launchctl` and `toggle.sh`). `wren jobs` replaces `wren loops`; `wren loops` stays as an alias. After this phase, the 11-27 case is one command: `wren jobs pause internships-mail`.
2. **Schedules.** `rt.schedules` + scheduler + Mac command runner. Move capture and creator-refresh off launchd; the adapter keeps whatever stays (internships, skill-use-report, devboard-backup).
3. **Outbox.** `events`, written in the same transaction as each run change. `wren jobs trace` reads `events`, `journal`, the desk ledger and the runner's logs.
4. **Fan-out.** CDC on `rt.events` → NATS JetStream. Needs `wal_level=logical` (a Postgres restart) and a replication slot. Relay: a Node reader in the box worker (11-28 log line). First consumers: the dead-letter wake and `wren jobs watch`.

The autobrowse SQLite runner stays standalone, as 11-16 decided. `wren jobs` reads it through its store interface.

## Non-goals

- Moving loop chains into the scheduler. Loops keep their own tick.
- Moving autobrowse's runner onto prod pg.
- Long-lived servers under launchd (`egress-*`, `weaver-serve`, `agent-serve`, `peers-view`, `excalidraw-*`, `autotrack`, `metered`, `aerie-mirror`).

## Risks

- A replication slot whose consumer stops keeps WAL, and the disk on the box fills. Built: `max_slot_wal_keep_size=2GB` (then the slot is lost and the relay backfills from `rt.events`) and the hourly slot alarm in `scripts/runtime-lag-check.mjs`.
- A desk pause refuses a call at once. A caller that treats 409 as a failure counts strikes. Check each desk caller before phase 1 ships.
- `XPC_SERVICE_NAME` is launchd's, not a documented contract. `AUTOBROWSE_JOB` wins when set.
- The Mac command runner holds a lease while the Mac sleeps. The lease runs out and the run is claimed again on wake; jobs must be safe to rerun.

## William's calls

1. **Option.** A (central orchestrator on rt; one plane; schedules are ours), E (one CLI over today's planes; least code; Mac jobs stay on launchd), B (broker as the queue; two stores) or C (Hatchet; rewrite; no Lambda).
2. **Internships.** (a) Its jobs become rt runs under a `personal` area. One plane, but a personal job then needs wren prod and the internet, and its rows sit in the business database. (b) It stays on launchd, and `wren jobs` drives it through the launchd adapter. Recommend (b).
3. **`ReachInboxRead` part hold.** The parts are already `unit_holds` units. Only a verb is missing: `wren jobs pause <loop> --unit <unit>...` writes `forever` holds (the first slice of phase 1). Holds on `replies`, `comments`, `health` and `threads` for each account, and on `posts`, stop the inbox reads and keep `invites` (the 20-a-day refill). Build it now, before the rest of the queue (recommended), or wait for phase 1.
4. **The broker's job.** (a) Fan-out only: CDC feeds consumers (trace, alerts, other repos); workers claim from the table. One truth, no dual write; the broker is optional. (b) The broker feeds workers: CDC turns each new run into a message, and workers consume it. Push delivery, but two places hold a run's state, the lease and fence move to the broker, and the Mac must hold a broker connection. Recommend (a); revisit (b) only if claim polling becomes the bottleneck.

## Decision log

- 2026-11-27: written; waiting on William.
- 2026-11-27: William set the target architecture: one table as the truth, outbox + CDC to a broker, a central scheduler (one node, cluster later), pooled workers. The broker's job (fan-out or feeding workers) is call 4.
- 2026-11-27: goldfish review: 36 findings (critic 15, reader 15, zoom-out 6), 30 applied, 6 rejected (C3 moot under layered pause; F2, F5, F6, F9, F13). Reports kept in the session scratchpad. Main changes: pause by layer (`pausedPass`, `unit_holds`, desk 409), never at claim; browser owner from env, not an owner file; option E added; the runner stays standalone (11-16); call 3 is now a verb on `unit_holds`. Open: calls 1-4.
- 2026-11-27: William: A (orchestrator on the pg runtime, the table is the truth); 2(b) internships stays on launchd; 3 yes, build the pause now. Scope taken: phase 1 pause (unit holds, loop pause, launchd adapter, `wren jobs`). Browser owner, scheduler, outbox and CDC wait.
- 2026-11-27: call 4. William: "fine" if workers still claim through the table; asked if the standard is a broker that feeds workers, with dedupe. Answer: (c) the broker (or `LISTEN/NOTIFY`) only signals "work ready"; the worker claims the row with a fenced UPDATE. Dedupe covers a double send but not pause, cancel, key locks or a scarce profile, which only a table read sees. Slack's own fix keeps workers polling the queue store; Kafka only buffers in front of it. Recommend (c); waiting on his yes. Phase 4 only.
- 2026-11-27: all internships launchd groups paused (`toggle.sh all off`), on William's "pause the internship job asap".
- 2026-11-27: call 4 closed: (c). William agreed: workers pick runs only through the table, so claim consistency stays in one place. The broker (phase 4) carries only "work ready" signals and fan-out.
- 2026-11-27: William: "continue with work"; `ReachInboxRead/daily` stays wholly paused. Phases 1-3 built in order; phase 4 waits (no outside consumer; `wal_level=logical` needs a Postgres restart).
- 2026-11-27: the doc said all four Mac crons call prod; only capture and creator-refresh do. Those two move; skill-use-report and devboard-backup stay on launchd.
- 2026-11-27: build choices (phase 1-2):
  - **Desk-call pause at claim, not at submit.** Loop calls reach `rt.invocations` from the box in-process, never through the door's HTTP submit, so a submit check misses them. The claim route sees every desk call, new or queued. Job names: `desk`, `desk/<handler>`, `desk:<site>`, `desk:<site>/<account>`, `caller:<who>`. The refusal is a terminal `held: ...` error; checked 11-27: `unitLimits.guard` counts only `CallTimeout` as a strike (`restate/limits.ts:290-296`), so a refusal clears strikes and adds none.
  - **The command map lives on the Mac** (`deploy/mac/commands.json`), the row names only the job. Option against: argv in the row (one place to edit, but a write to prod runs any command on his Mac). Safety wins.
  - **Key lock per pulled service** (`locked`), on for `CommandRun` only. The desk keeps `lock: false`: its calls are not keyed jobs. A lost lease (Mac slept) re-claims with attempt + 1 and no failure count, so sleep never pushes a run toward a dead letter; the runner kills the old process group on renew 409.
  - **Scheduler** on the box, every 30 s, in one transaction under `pg_try_advisory_xact_lock` (a session lock breaks behind PgBouncer). Ticks from croner 10.0.1 (MIT) in the job's zone (`America/Toronto`; the box runs UTC). Pause = drop the tick; "hold one run for resume" is not built (no job needs it). A failed run retries on the job's `retry` (creator-refresh: 3 tries, 10 min apart, as its plist did), then dead-letters; the next tick queues behind it, one deep.
  - **Cutover per job:** run it by hand through the runner, see one scheduled tick succeed, then `launchctl disable` the old plist (kept on disk). Never both triggers live.
- 2026-11-27: first scheduled tick (capture, 22:17) found two bugs. (1) `AUTOBROWSE_OWNER` is taken: it names the credvault owner (autobrowse `designs/2026-09-30-owner-keys.md`), so `job:...` failed every autobrowse call. The job is now `AUTOBROWSE_JOB`. (2) `capture run` exited 0 with every source failed, so the queue saw success. It now exits 1 when no source reads. creator-refresh's old plist was already disabled by someone after 11-26: its schedule is held until that owner says why.
- 2026-11-28: phase 3 built. `rt.events` is written by two triggers on `rt.invocations` (insert; status or attempt change), so no code path can skip it and it shares the move's transaction. A lease renew writes nothing. No retention cap: runs are never pruned either (about 3k runs, 12k events a day), and the house rule is to keep data. `wren jobs trace` reads events, journal, child calls, the runner's log section and live browsers (`autobrowse browsers`, by `--autobrowse-job`). Desk calls joined by `caller` wait: the desk's call log is not in the table yet.
- 2026-11-28: phase 4, on William's "Relay makes sense do it", with no new VM cost ("idont want to pay more for infra / vps rn"). Relay options:
  - **Sequin** (MIT): not one container, as this doc said. It needs Redis and its own Postgres database; about 500 MB+ beside a box with about 570 MB free. Rejected on RAM.
  - **Debezium Server**: a JVM, 300-500 MB heap. Rejected on RAM.
  - **Postgres → NATS through a trigger and `pg_notify`**: no slot, but a notify is lost when no one listens, and the stream would gain a second writer path. Rejected: not CDC.
  - **Our own Node reader** (chosen): `pg-logical-replication` 2.6.0 (MIT, pgoutput) inside the box worker, no new process. About 200 lines; the parts no library gives are the ack rule and the backfill.
- 2026-11-28: phase 4 build choices:
  - **At least once.** Each insert is published (JetStream msg id = `seq`) before its commit's LSN is acked; auto-ack is off. A crash resends from the last acked commit; JetStream drops a repeat inside its 1 h window; past it, consumers dedupe by `seq`.
  - **Idle ack.** With no tx open and nothing queued, a keepalive's position is acked, so an idle slot holds no WAL.
  - **One reader.** Postgres lets one connection read a slot. A deploy's new box slot waits as standby; the old one frees the slot in `standDown`.
  - **Lost or dropped slot.** A new slot first publishes `rt.events` rows from 1 h before the stream's last event (a commit can land after a later `at`). The table is the truth; the stream can always be refilled.
  - **NATS on the box** (`deploy/scripts/box-nats.sh`): loopback 4222, file store on the data volume, 128 MB container cap. Stream `RT_EVENTS`: 14 days or 1 GiB.
  - **Consumers.** Dead-letter wake: a `paused` event submits `DeadLetterFile/all wake` (one a minute), so a dead letter is filed in seconds, not at the 10-minute sweep. `wren jobs watch` reads the door's `GET /rt/events` (SSE). Dropped: a Mac-wake consumer; the desk and the runner already wake on `NOTIFY rt_wake` through the door.
  - **Lambda stays lean.** The relay and NATS client load by dynamic import (`@wren/runtime/pg/events`), so no cold start pays for them.
  - **What it does not change.** Workers still claim from the table (call 4 (c)); nothing runs sooner. It adds a live event feed for consumers.
- 2026-11-28: phase 4 live (2f93f1d83, CI 46118226891). Prod: `max_slot_wal_keep_size=2GB` on reload, then `wal_level=logical` and `docker restart wren-pg` at 01:57 EST: 3 s down, 5 failed claims, all retried. The waiting relay saw `logical` on its 5-minute recheck and streamed at 06:59 UTC; slot lag 0. Dev drill on the compose Postgres and NATS: commit order, a rolled-back move never published, durable consumer, standby, hand-over.
