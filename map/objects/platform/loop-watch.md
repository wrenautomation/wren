---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-11-09 @ 9a8b862e
entity: packages/core/src/loop-watch.ts:405
---

# loop-watch

The loop watchdog: `LoopRevive/all` checks every [[platform/loop-object]] every 10 minutes, wakes a dead one and names a stuck one, once per incident.

## Why this shape

A loop ends without a word two ways: its next call is lost (dead), or its pass waits on a call that never answers and holds the key's lock (stuck). On 2026-10-14 `PostPublish/default` sat stuck for hours behind a `Content/publish` the runtime had paused (`designs/2026-10-16-loop-watchdog.md`). The loops come from the runtime's object state (view `rt_admin.state`), the same read as Console → Loops, so a new loop is watched with no list. Cadence is each loop's own `last.delayMs`; only stall limits have exceptions. A stuck loop is never woken or killed here: ending the blocker can lose a post or a send, so that stays `wren dlq`.

## Shape

- `readLoopViews` (`loop-watch.ts:285`): `LOOPS_SQL` (`console/loops.ts:68`) for state; one `rt_admin.sys_invocation` read for timers and open calls (`:268`), so a timer firing between reads can't look like none; the lock holder's children by `invoked_by_id`; a key left by a retired service is skipped
- `healthOf` (`loop-watch.ts:89`): `stopped`, `alive` (a call queued or moving, or between passes within `delayMs` + 10 min), `dead` (running, nothing queued, overdue), `stuck` (the holder or its child `paused`, or nothing moved for 45 min; `LOOP_EXPECT` `:35`: ReachInboxRead 90)
- `planWatch` (`loop-watch.ts:184`): incidents in object state (`incidents`); a dead loop is woken (`wake`: new generation, fresh `loop` call) at most every 15 min, 6 times, then one give-up notice; healthy an hour or stopped closes it. No table, no migration
- each loop's `last.timeouts` (calls its last pass gave up on, `held` when the unit went to [[platform/checks]]) rides on its row; a check counts them per loop (`timedOut`)
- `makeLoopRevive` (`loop-watch.ts:406`): a `runPass` per check (ledger `loops watch`), always wired beside `DeadLetterFile` (`apps/worker/src/services/platform.ts:92`)

Citations: `packages/core/src/loop-watch.ts:406`

## Connected to

- **reads:** [[platform/loop-object]] state, `rt_admin.sys_invocation`; [[platform/dead-letter]] rows to name a stuck loop's letter
- **looks-like-but-is-not:** `scripts/runtime-lag-check.mjs`, hourly in CI (late rows, dead leases, and a LoopRevive with no next check); `DeadLetterFile/all` (files paused calls, not the loops behind them)

## If you change this

- **Hits:** every loop (it may `wake` any of them), `wren loops` (`apps/cli/src/loops.ts:21`; `wren loops cancel` cancels one call), `docs/operations.md` "Loop health"
- **Does not hit:** a loop's own pass or retries, the runtime's retry policy, the dead-letter rows (read only)

## Surfaces

| Surface | Role |
|---|---|
| `LoopRevive/all` | drives (`wake`), tells Discord |
| `wren loops [--all] [--json]` | reads |
| `wren loops watch start|stop|status|sync` | drives |

## See

- Source: `packages/core/src/loop-watch.ts`, `designs/2026-10-16-loop-watchdog.md`
