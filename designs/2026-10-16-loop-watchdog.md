# Loop watchdog

2026-10-16. Bead wa-6dr: "ContentScheduler loop stop: find why, self-restart."

## What happened

On 2026-10-14 `ContentScheduler/default` posted nothing from about 15:05 to 20:05 UTC, and
for a shorter spell before that (13:00 to 14:54). Its state still said `running`, no error,
and its `last` pass was hours old. Nothing said why.

The cause: a pass calls `Content.publish` and waits for the answer with no limit. On 10-14 an
X video upload kept failing (`HTTP 0 TypeError` on `media/upload/<id>/append`). Restate retried
it, then paused it at 16:17 (dead letter #11255). A paused call never answers. So the loop's own
invocation stayed suspended, holding `ContentScheduler/default`'s lock, and every later call to
that key queued behind it. The 13:00 spell was the same thing on a desk call (the Mac's tunnel
reset, letters #11209 and on, retried at 14:54). The loop never died. It was stuck behind a call
that would never return.

Nothing caught it. The dead-letter sweep told Discord about `Content/publish`, but not that a
loop was waiting on it. `scripts/restate-lag.mjs` looks at late timers and at calls stuck
`ready`, `running` or `backing-off`. A suspended loop waiting on a paused call is neither.

The same thing is happening on other loops now. `ContentMetrics/default` waited 16 h on a paused
`Content/metrics` (#11208) and `SocialWatch/wren` 16 h on its own paused pass (#11501, X's search
cap).

Ruled out: no `kill` or `cancel` of a ContentScheduler invocation (the 10-14 kills were the
`Content/publish` children, and each let the pass go on). No deployment prune: the prune keeps
any deployment a live call is pinned to, and the pass resumed after each kill. No early return
without a reschedule: every return path of `loop` either sends the next call or sets
`running: false` on purpose. Restate keeps finished calls about a day; from 10-14 23:31 on they
show one unbroken chain.

## Decisions

- **A pass waits on a publish for at most 15 minutes** (`PUBLISH_WAIT_MS`). Past that the call
  keeps running on its own. The draft stays `publishing` with a note, and the loop moves on. The
  call's invocation id is kept in the object's state (`publishing`). Each later pass looks at it
  for a second. Posted: the row is marked published as usual. Failed or killed: marked failed.
  Still going: it waits for the next pass. A first comment waits at most 5 minutes, then is noted
  on the draft. So one bad platform can't hold the queue, and nothing posts twice: the draft is
  never claimed again while its call is open.
- **One watchdog for every loop: `LoopWatch/all`**, every 10 minutes (`core/loop-watch.ts`). It
  reads Restate's admin SQL. The loops come from `state` (the same read as Console → Loops, so a
  new loop is covered without a list). Their open calls and those calls' children come from
  `sys_invocation`. Each running loop is one of:
  - **alive**: a `loop` call is scheduled, or an open call moved recently, or the last pass is
    within its own `delayMs` plus a 10-minute grace.
  - **dead**: running, no scheduled call, no open call, and the next pass is overdue. Restart:
    `wake` (it bumps the generation and sends a fresh `loop` call; a late old call drops out).
  - **stuck**: an open call, or a call it waits on, is `paused`, or nothing moved for 45 minutes
    (90 for `ReachWatch`, whose passes are long). No restart: the lock is held, and only a person
    or agent should end the blocker, since killing it can lose a post or a send. The notice names
    the blocker and its dead letter, if it has one.
  - **stopped**: `running` is false. Left alone.
- **Cadence lives in one place.** Each loop says when its next pass is due (`last.delayMs`).
  `LOOP_EXPECT` holds only the exceptions to the stall limit. No second list of loops to keep.
- **One notice per incident.** An incident opens the first time a loop is dead or stuck and
  closes after an hour of health or when someone stops the loop. A dead loop is restarted at most
  once per 15 minutes, up to 6 times per incident. A loop that keeps dying is restarted quietly
  inside its incident. If the restarts don't hold, one last notice says the watchdog gave up.
  Incidents are kept in the watchdog's own state. No table, no migration.
- **Only services Restate still lists.** A leftover `running` key on a retired service is
  skipped, so no `wake` goes to a service that no longer exists.
- **Who watches the watchdog.** `scripts/restate-lag.mjs` (hourly in CI) says so when
  `LoopWatch/all` is running with no call scheduled.
- **CLI** `wren loops [--all] [--json]`: every loop with its health, why, the next call and the
  blocker. `wren loops watch start|stop|status|sync` drives the loop.

- **Every call a loop pass makes has a time limit** (10-16, bead wa-vfd; `core/restate/limits.ts`).
  - `within(ctx, call, { ms, call })`: a Restate call (a `Content` read, a desk or `sites`
    call). Past its limit the call is cancelled, or left running with `keep` when it is a write
    that may land. The pass gets `CallTimeout`, a terminal error, so the unit's usual catch skips
    it and the pass goes on. `restateSites(ctx, { limitMs })` puts every desk call through it; a
    write past its limit says it may have posted, and `sendOnce` answers unsure, never twice.
  - `limitedRun(ctx, name, fn, { ms })`: a `ctx.run` around outbound HTTP. Each try is cut at
    its limit; after 3 tries the step fails terminally instead of retrying until Restate pauses
    the pass. HTTP clients carry their own limits too (`core/fetch-limit.ts`).
  - `LIMITS`: read 5 min, batch 10, desk 10, publish 15, quick 1, http 2. A loop takes
    `limits` in its deps (tests shorten them).
  - `unitLimits(ctx, db, service)`: a unit (post, account, stage, idea) that times out 3 passes
    in a row is held in Checks' `unit_holds` (stage `loop.<service>/<key>`): 7 days, one more
    try, then a person. Units sit in a group (their platform). A timeout counts against its unit
    only once the group answered something this pass; two unanswered timeouts in a group leave
    the group out until the next pass. So a platform that is down never gets its posts held.
  - Each pass keeps its timeouts in `last.timeouts`. `wren loops` prints them under the loop;
    `LoopWatch` keeps a count per loop (`timedOut`, with how many units it held).
- **A pass that throws is a failed pass, not a parked loop** (`passOrFailed`). A terminal error,
  or a plain one rethrown from replayed results (SocialWatch's journaled 429, 10-15, DLQ #11501),
  is kept as `last.error` with the usual backoff, and the next pass is queued. Only Restate's own
  signals (suspend, cancel) go through.
- **Loops and their limits:**
  - `ContentScheduler`: publish 15 min (`keep`), first comment 5 min (`keep`).
  - `ContentMetrics`: batch read 10 min, counts and insights 5 min, reports 5 min, account
    reads 5 min, `platforms` 1 min. Unit: the post; group: its platform.
  - `SocialWatch`: comments, counts, reviews, activity, audience 5 min; `SocialInbox.read` 10;
    `SocialPushed.take` 1; Maps reviews through the desk 10.
  - `ReachWatch`: every desk read 10 min (`sitesFor`); `SocialPushed.reach` 1 min. Units:
    each account's replies, comments, health, threads; invites; posts. Group: the platform.
  - `ReachSender`: each desk call 10 min. A send past it is recorded unsure, never resent.
  - `RedditReads`: desk reads 10 min, grouped by signed-out; topics model call `limitedRun`.
  - `PoolScheduler`: each stage call 60 min, cancelled; a timed-out stage waits its later ones.
  - `PlacementScheduler`: Gmail reads 5 min, unit per seed and day.
  - `AdsWatch`: insights 5 min, cancelled; stop and add 5 min with `keep`.
  - `ContentPlanner`: a draft 15 min with `keep`; a timeout ends drafting for the pass (the
    desk's lock is still held), held on its third.
  - `TokenRenewal`: a renew 30 min with `keep`.
  - HTTP clients (Discord, Restate admin, Gmail, mailbox access, pixel and lander exports,
    Postmaster, Wise, Search Console, sitemap) 30 s to 2 min; a model call 5 min.

## Not done

- `SendScheduler` is its own loop (not `makeLoopObject`): its pass is not under `passOrFailed`.
- No integration test for `TokenRenewal`'s limit or RedditReads' topics `limitedRun`.
- Ending a paused blocker on its own (kill, then `wake`) is a judgment call per loop. It stays a
  person's or an agent's, through `wren dlq`.

## Order

1. Scheduler wait, watchdog, CLI, tests, docs. Deploy, then `wren loops watch start`.
