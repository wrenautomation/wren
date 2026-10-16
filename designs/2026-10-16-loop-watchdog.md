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

## Not done

- Other loops make the same unbounded calls: `ContentMetrics` → `Content.metrics`, `SocialWatch`
  → `Content.comments`, `ReachWatch` → desk calls. The watchdog now names them when they stick.
  Bounding each one is its own change.
- Ending a paused blocker on its own (kill, then `wake`) is a judgment call per loop. It stays a
  person's or an agent's, through `wren dlq`.

## Order

1. Scheduler wait, watchdog, CLI, tests, docs. Deploy, then `wren loops watch start`.
