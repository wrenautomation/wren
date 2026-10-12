# Push, not poll

2026-10-11. William's temp note: "Intercepting notification events (potential upgrades so it
doesn't use polling where better solns exist). Check how email checker does it. Scaling
architecture templates."

## How the email checker does it

Gmail inboxes: each `InboxScheduler` pass renews the mailbox's `users.watch`. Gmail publishes a
change to Pub/Sub, Pub/Sub pushes to the phone Worker's `/webhooks/gmail`, and the Worker sends
`InboxPush/<address>/notify` keyed by the message id. That runs a pass now. While the watch
lives, the loop's own poll drops to a 30-minute net (`designs/2026-10-06-mail-push.md`).

The shape: **an event wakes the loop, and a slow poll stays as the net.** The event is never
trusted to arrive, so nothing is lost when one doesn't.

## Every loop, measured (prod runs ledger, 24 h to 2026-10-11)

| Loop | Passes/day | Passes that found work | Push source | Now |
|---|---|---|---|---|
| `InboxScheduler`, 9 Instantly-held inboxes | 5,263 | 0 | none (below) | 30 min pace: ~430/day |
| `InboxScheduler`, Gmail inboxes | few | | Gmail Pub/Sub | already push + net |
| `SmsSender` | 288 | 0 | a queued row | wake on row, sleep to next due: ~96/day |
| `ReachSender` | 288 | 0 | a queued row | same |
| `DeadLetters` sweep | 121 | | Restate has no dead-letter event | 10 min, kept |
| Monitor (`Watch`) | 100 | | Gmail push on Workspace; personal gmail.com has no topic | kept |
| audit seal | 96 | clock | | kept |
| delivery watch, setup watch, guard, opens, page archive | 24 each | clock or a vendor without push | | kept |

### Instantly's inboxes

Instantly's webhooks (`POST /api/v2/webhooks`, open on our plan, custom headers for a secret)
fire for its own campaigns: `reply_received`, `email_bounced` and the like. These inboxes are in
no campaign and never send from here, so no event would ever come and no reply waits on them.
They poll at the net's pace (`quiet` on `InboxScheduler`). When we send through Instantly, a
`reply_received` webhook to the phone Worker, then `InboxPush/<address>/notify`, is the push.

### Wake on row

A text or a reach message is queued by eight paths (enroll, follow-up, operator reply, missed
call, review ask, reminder, form, retry). The senders ticked every 5 minutes to find them, so an
operator's reply waited up to 5 minutes.

Now the row tells. Migration 0235: `wren_wake()` runs `pg_notify('wren_wake', '<Service>/<unit>')`
after a row is queued outbound (`sms_messages`, `reach_messages`). The box worker LISTENs on
Wren's database and every client's (`apps/worker/src/wake.ts`, its own connection straight to
Postgres; LISTEN does not survive PgBouncer) and calls that loop's `wake` through the ingress,
keyed to the database's owner. Notices for one loop within a second are one wake.

After a pass, each sender sleeps until the next queued row is due, at most 15 minutes (the net).
Due rows held back (quiet hours, caps, a number's gap) are asked again in 5 minutes, as before.

## Template: a new loop

Pick the first that fits. Every loop keeps a net.

1. **Someone pushes.** A vendor webhook, Pub/Sub, IMAP IDLE, our own row (`wren_wake`). The event
   calls the loop's `wake` (or `sync`) with the event's id as the idempotency key. The poll
   drops to a net of 15 to 30 minutes.
2. **Work has a due time.** Sleep until the next due row, capped by the net. The paths that add
   work wake it (a `wren_wake` trigger on the table, so no path can forget).
3. **A clock.** A digest or a report: sleep to the next slot (`untilNextLocalDay`).
4. **Nobody pushes.** A vendor with no events: poll at the pace the answer matters. Nothing
   waits on it: the net's pace (`quiet`).

Scaling rules every loop already follows (`packages/core/src/restate/loop.ts`):

- **One key per unit of work** (an inbox, a client's sender). Keys run in parallel, a key runs
  one pass at a time. A client's keys are `<client>/<unit>`.
- **Bounded passes.** A pass takes at most a batch (`SCAN`) and comes back soon if more is due.
- **Idempotent at the edge.** Webhooks enter with their event id as the idempotency key, so a
  retry applies once.
- **Failure is the pass's, not the loop's.** Backoff from seconds to the retry cap, recorded on
  the run row.

## Not now

- **IMAP IDLE.** The push for an inbox on its own IMAP login. None is in the roster today (the
  9 are Instantly's). The box would hold one IDLE per mailbox and send `InboxPush/<address>/notify`.
- **A dead-letter event.** Restate has none; the 10-minute sweep stays.

## Decision log

- Postgres LISTEN/NOTIFY over an outbox table: nothing to clean, no new service, and the net
  already covers a missed notice.
- Triggers, not a wake call in each of the eight paths: a ninth path can't forget.
- The listener on the box, not Lambda: it needs a connection that stays open, and the box
  already reaches Postgres on loopback.
- 15-minute net for the senders: a wake lost while the box restarts costs at most that.
