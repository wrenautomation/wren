# How wren's email pipeline survives on Restate

2026-09-19. What Restate gives the pipeline, the loop pattern every scheduler
uses, and a walkthrough of "sleep until Monday, then send".

## The three guarantees

The Python daemon kept its schedule in process memory (`while True: sleep()`).
When the laptop slept, the schedule died with it (2026-09-17 crash). Restate
replaces that with:

1. **Durable timers.** "Call me again in 9 hours" is written to Restate's log
   before the handler returns. The Lambda exits. Nine hours later Restate makes
   the call against whatever deployment is current. No process stays alive.
2. **Journaled steps.** Every side effect is wrapped in `ctx.run("name", …)` and
   its result recorded. If the Lambda dies mid-handler (timeout, OOM, deploy),
   Restate re-invokes it and replays the journal: finished steps return their
   recorded result instantly; execution resumes at the first unfinished step.
   A send that already went out is never re-sent by replay.
3. **Virtual Object state.** Each service is keyed (one key per inbox, or
   `fleet`). Restate stores `running` and `last` per key and serializes
   handlers per key: two calls on the same inbox queue, never race. This
   replaced the Python advisory locks.

What a crash costs now: at most one unfinished step is redone. For the send
loop that step is one tick, and the tick is re-runnable by construction:
intent row before the Gmail call; reconcile on the next pass resolves any row a
crash left half-done.

## The loop pattern

All periodic work uses one shape: `packages/channel-email/src/restate/loop.ts`
(the send loop in `send-scheduler.ts` is the same shape with a smarter delay).
A Virtual Object with five handlers:

| Handler | What it does |
|---|---|
| `start` | sets `running=true`, sends itself `loop`. No-op if already running. |
| `loop` | if not running, return. Else run one pass, then send itself `loop` with a **durable delay** the pass chose. |
| `stop` | sets `running=false`. The pass in flight finishes; the next `loop` sees the flag and exits. |
| `sync` / `tick` | one pass now, loop untouched. Operator button. |
| `status` | read-only shared handler (never queues behind a pass): `running` plus the last pass's stats, error and chosen delay. |

The pass is one `ctx.run`. It catches its own error and returns
`{stats, error}` instead of throwing, so a failing stage retries on *our*
schedule, not Restate's, and the loop never dies. Failures in a row back off
15s, 30s, 1m, ... up to the loop's `retryMs` cap (8 min for PoolScheduler);
one clean pass resets it (`failures` in `last`). The delay is computed from the journaled result, so a replay
picks the same delay.

```
Restate ──loop(key=inbox)──▶ Lambda
                             ctx.run("send tick"): kill switches, reconcile, paced walk
                             journal result, set last
Lambda ──self.loop(delay=9h12m)──▶ Restate
                             (Lambda gone; the timer lives in Restate)
Restate ──loop, 9h12m later──▶ Lambda (cold start if needed)
```

## The nine services

| Service | Key | Sleeps for | Notes |
|---|---|---|---|
| `SendScheduler` | sender address | gap after a send (policy-drawn, seeded from the journal); 60 s tick while the window is open and nothing went; **until the next window opens** when closed | Daily cap, ramp and window are policy, per inbox. Kill switches run first every tick and pause a domain whose trailing bounces cross the line. |
| `InboxScheduler` | sender address | 2 min after a pass; 1 min after a failure | Reads the mailbox from its cursor. Human replies found → fires `Disposition/fleet/classify`, so replies are labelled within minutes. |
| `Disposition` | `fleet` | on demand | One classify at a time: two inboxes finding replies in the same minute queue instead of paying the LLM twice. |
| `PostmasterScheduler` | `fleet` | **until next local midnight**, success or failure | Re-reads the last 7 days per sending domain (Google revises late). Bound because `WREN_POSTMASTER_USER` is set. |
| `OpensScheduler` | `fleet` | 2 min / 1 min | Pulls the pixel host's export from the last row id. Bound because the pixel host + export token are set. |
| `ReportScheduler` | `weekly` | **until next Friday 19:00** on the fleet's clock, success or failure | The weekly report (E8): counts from the same tables the views read, stored in `reports`, mailed through the send transport. No LLM. Bound because `WREN_REPORT_TO` is set. |
| `Resolution` | `default` | on demand | One key because verifier credits are one global budget. Each domain's walk is one journaled step; a crash loses at most one domain's spend. |
| `Enrichment` | population (`all` or a niche) | on demand | crawl / render / scan / extract / pick / apply. Every unit (one company, one document) is its own journaled step: replay resumes after the last finished unit, never buys a completion twice. |

## "Sleep until Monday, then send" — walked through

Send window 09:00–17:00 America/Toronto. An inbox finishes at 16:52 Friday.

1. The tick sends its last message for the day. The policy says the next
   allowed instant is Monday 09:00 (window questions are answered on the
   operator's local clock and returned as a UTC instant).
2. `nextDelay` returns ~64 h. The handler journals `last = {stats, delayMs,
   now}` and sends itself `loop` with that delay. Lambda exits within a second.
3. Nothing runs over the weekend. No process. Laptop state is irrelevant. Deploy
   a new Lambda version on Sunday and Monday's call goes to it: each `loop` is
   a fresh invocation and Restate routes new invocations to the latest
   registered deployment.
4. Monday 09:00 Restate invokes `loop`. Cold start ~1.2 s (SSM env, roster,
   Gmail client). The tick runs kill switches, reconciles anything stale, sends
   one message, sleeps for the per-inbox gap. Repeats until the daily cap or
   the window end.

If the tick crashes at step 4 (Gmail 5xx after the intent row, Lambda timeout,
anything): Restate re-invokes `loop`. The journal shows "send tick" unfinished,
so it runs again; reconcile sees the intent row and resolves it before the walk
picks the next lead. The seeded RNG comes from the journal, so pacing is
identical on the retry.

The Postmaster pull is the same shape on a fixed 24 h cadence: pass, then sleep
to the next local midnight whether it worked or not, so an outage never becomes
a call per minute.

## Limits that matter

- **15-minute Lambda cap.** A handler that runs longer is killed and replayed.
  Loops are fine (one tick is seconds). `Enrichment` over a large population
  can exceed it: pass a `limit` and call repeatedly. Nothing is lost, but one
  huge call burns replays.
- **Journal size.** One `ctx.run` per unit means big enrichment calls write
  thousands of entries. Keep per-call limits in the hundreds.
- **Request signatures not verified** (cold-start log: `Accepting requests
  without validating request signatures`). Acceptable: only the invoker role
  can invoke the Lambda and only Restate Cloud can assume it (external id =
  the env id). If the Cloud UI ever shows a `publickeyv1_…` key, set
  `restate_identity_key` in `terraform.tfvars` and re-apply.
