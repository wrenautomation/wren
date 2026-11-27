# Central job queue: list, pause and trace every job (WA-1465)

2026-11-27. Status: A agreed, call 4 (c) agreed; phase 1 pause in build. Handoff: `handoffs/2026-11-27-central-queue.md`. Diagram: `2026-11-27-central-queue.excalidraw` (devboard project "Central queue").

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
| Fan-out (later) | CDC (Postgres logical replication) reads `events` → a broker (NATS JetStream) → consumers. Nothing writes the broker directly. Relay: Sequin (MIT, one Docker container, has a NATS sink), Debezium Server (JVM; RAM unchecked against the 2 GB cap) or our own Node reader on `pgoutput` | none |

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

- **Process:** the launch reads `AUTOBROWSE_OWNER` (set by the runner for its children: `job:<name>/<inv_id>`), else `XPC_SERVICE_NAME` from the browser's env. launchd sets that variable on every job, and child processes inherit it (checked 11-27: the desk and canon-drain show their labels). `ProfileBusy` and `autobrowse browsers` show it. This covers bare Playwright (internships) with no change to that code.
- **Call:** a desk browser is born under the desk, so its env says `autobrowse-desk` for every call. The call's owner is its `caller` field, kept in the desk's call log. `wren jobs trace` joins on it.

## Options

Ranked by: (1) one place to pause each job, (2) each browser launch has an owner, (3) free and self-hostable, (4) cluster later with no rewrite. Hard limits: Docker VM 2 GB, Mac 16 GB, the t4g.small already runs Postgres, PgBouncer, listmonk and the box worker.

The pause layers and the browser owner above are the same under every option. The options differ in where schedules and the queue live.

### A. Central orchestrator on rt (recommended)

The target architecture above, built on `rt.*`. Add `jobs` (schedules) to the scheduler. wren's Mac crons (capture, creator-refresh, skill-use-report, devboard-backup) become runs claimed by a **Mac command runner**: its own launchd KeepAlive process, apart from the desk, so a desk restart (`update.mjs:206`) does not kill a job. Each job gets one key with an exclusive lock, so two ticks never overlap; pulled rows have no key lock today (`pull.ts:78-80`), so this is new runtime work. Each tick's idempotency key is the job plus the tick time, so two scheduler nodes never insert it twice. A missed tick while the Mac sleeps waits as one pending row; the next tick is not inserted while one waits. canon-drain stays KeepAlive; its table is already in pg.

For: one plane for all wren jobs; no new server; scheduler and pooled workers cluster with `SKIP LOCKED` and pull. These crons already call prod (`prod-wren.mjs`), so they gain no new dependency. Against: we own schedule semantics (~cron table + leader lock); the command runner is new.

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
2. **Schedules.** `jobs` table + scheduler + Mac command runner. Move the four wren Mac crons off launchd; the adapter keeps whatever stays (internships, under call 2(b)).
3. **Outbox.** `events`, written in the same transaction as each run change. `wren jobs trace` reads `events`, `journal`, the desk ledger and the runner's logs.
4. **Fan-out (only when an outside consumer exists).** CDC on `events` → NATS JetStream. Needs `wal_level=logical` (a Postgres restart) and a replication slot. Relay: Sequin first (a vetted, MIT, self-hosted framework with a NATS sink); measure its RAM against the 2 GB cap before it ships.

The autobrowse SQLite runner stays standalone, as 11-16 decided. `wren jobs` reads it through its store interface.

## Non-goals

- Moving loop chains into the scheduler. Loops keep their own tick.
- Moving autobrowse's runner onto prod pg.
- Long-lived servers under launchd (`egress-*`, `weaver-serve`, `agent-serve`, `peers-view`, `excalidraw-*`, `autotrack`, `metered`, `aerie-mirror`).

## Risks

- A replication slot whose consumer stops keeps WAL, and the disk on the box fills. Phase 4 needs a slot-lag alarm and a max size (`max_slot_wal_keep_size`).
- A desk pause refuses a call at once. A caller that treats 409 as a failure counts strikes. Check each desk caller before phase 1 ships.
- `XPC_SERVICE_NAME` is launchd's, not a documented contract. `AUTOBROWSE_OWNER` wins when set.
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
