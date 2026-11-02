# Loop calls: fewer empty passes

2026-11-01 (WA-994). Trigger: the October AWS bill. The worker took 23,306 Lambda calls in 24 h at ~116 ms each. Most were empty passes. A pass is ~3 Lambda calls: Restate on Lambda suspends at each `ctx.run`, and each resume is a new call.

## Where the calls went (24 h to 2026-11-01)

| Loop | Beat | Calls |
|---|---|---|
| TouchFeed | 1 min | 5,267 |
| LineFeed, PainFeed, SourcedFeed | 5 min | 2,589 |
| Segments, 4 workspaces | ~6 min | 2,450 |
| PeopleMap, 4 workspaces + net | 15 min | 1,440 |
| ReachSender, ReachWatch | 30 min + wakes | 2,241 |
| ~15 upkeep loops | 5–15 min | ~5,000 |
| Content work | on demand | ~1,000 |

Today this is free (~700k of 1M requests a month). But Segments and PeopleMap scale with workspaces, not with work: ~900 calls a day per client.

## Causes

- Statement triggers fire on a statement that changes no row. PeopleMap's trait sync (`insert … on conflict … where distinct`) ran every 15 min and woke Segments in every workspace. That doubled the Segments passes. In demo and wren_test, 12 PeopleMapNet runs in 3 h gave 12 ingress wakes.
- TouchFeed polled every minute. A touch has many writers outside Restate, so nothing woke it.
- The demo workspace (`demo = true`: no writes, no sends) ran every net.

## Changes

1. Row triggers (migration 0353). Segments wakes only on a changed row. An update fires only `WHEN OLD IS DISTINCT FROM NEW`. Postgres folds equal notices in one transaction, so a bulk write is still one wake.
2. `touches_feed_wake` wakes `TouchFeed/all`. The box keys `all` as is (not to the owner) and waits `SETTLE_MS + 2 s` first. TouchFeed reads only settled rows. A pass that sees an unsettled row comes back in 35 s. The net is 15 min. A pass with no new touches skips the "touch events" step.
3. `loopClients` (core/clients): the nets skip demo workspaces. wake.ts still listens on every database, so a demo row change still runs its own loop. wren_test stays in: it backs App Review sign-ins and content posts.
4. Feeds' idle beat 5 → 15 min (LineFeed, PainFeed, SourcedFeed). Imports and finds come in batches, so 15 min is fine.
5. SegmentsNet 15 → 60 min, PeopleMapNet 15 → 30 min. A row change still wakes Segments at commit. A Date trigger fires by 10:00, not 09:15. The warm gate reads live, so the map's lag does not hold a send.

Expected: ~23k → ~13k calls a day. A new client adds ~220 calls a day, not ~900.

## Options for the per-workspace loops

William's ask was "one loop for all workspaces". I did not do that.

| | How | For | Against |
|---|---|---|---|
| A. Keep one object per workspace, slow the nets (chosen) | Change 5 | Per-workspace state, failure and wake stay apart; no new code | Still one pass per workspace per net beat |
| B. One loop walks every workspace | `Segments/all` holds every cursor | One pass per beat, whatever the client count | A slow or failing workspace holds the rest; a row change in one runs all; state grows toward Restate's metadata cap |
| C. Net wakes only changed workspaces | Net reads a "changed since" mark per workspace first | Fewest passes | Date and time-window rules change with no row, so the net must pass anyway; a new mark to keep true |

Ranked by: isolation between clients, then calls per client, then new surface. A keeps isolation and cuts calls per client by ~4x. B saves more calls but couples clients. C saves little for its cost.

## The clock read (WA-995)

`runPass` read `ctx.date.now()` before its run: its own step, so one more Lambda call per pass. Now the pass reads the clock inside its `ctx.run` and journals it with the stats. `body` and `delayAfter` get that `now`; after the pass, `outcome.now` is it. A loop that needs the time before its pass (to pause, to pick work) still reads it and passes `now`.

A pass is now 2 calls, not 3. Two is the floor: code can use a run's result only after Restate acks it.

Folded: 24 loops. Not folded: loops that use the clock before the pass, and box loops (no Lambda calls).

InboxScheduler made 4 calls a pass: clock, `renew watch`, sync. A mailbox with no push ran `renew watch` each pass to learn "none". Now `watch(sender)` says so from the address, with no step. A watched mailbox renews after the pass, when under a day is left. Its first pass polls at `syncMs`, since the watch is not yet live. Now 2 calls a pass.

Expected: ~2.3k fewer calls a day (InboxScheduler ~860, the other folded loops ~1,400). Not the ~4k I first said: a third of the loops read the clock before the pass.

## Decision log

- 2026-11-01: row triggers, TouchFeed on wake, demo out of the nets, slower nets and feeds (William: "yes and then do all those"). Option A over B for change 3 (my call, said to William).
- 2026-11-01: demo flag flipped back to false gives TouchFeed its old cursor: the next pass tells the touches written while it was demo. Demo writes nothing, so none.
- 2026-11-02: the clock read folds into the pass step (William: "yes sure"). A caller that needs the clock first still passes `now`. InboxScheduler: no-push mailboxes take no renew step.
