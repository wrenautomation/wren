# At least once: every send and every inbound event

2026-11-04. Tasks WA-1057 to WA-1063. Status: agreed (William, 11-04). All built and deployed (WA-1057 to WA-1063).

## Goal

Every send of ours and every event sent to us gets to its target at least once. A duplicate is
allowed. Where the receiver takes a key, the duplicate is dropped there, so the send is exactly once.

## Decision

William, 11-04: "switch them to at least once designs then? those are fine. just fix the gaps".
This reverses `designs/2026-10-16-maybe-sent.md` and the SMS rule "texting a stranger twice is
worse than missing one". Accepted cost: a person may get one duplicate text, email, DM, comment or
post. Measured before the switch: email had no unknown outcomes; DMs, comments and posts had
about 1 in 70 unsure.

Each resend:
- Runs only when the outcome is not known. A send the receiver refused stays refused.
- Is a real send. It takes the normal path, so daily caps and site limits count it.
- Happens at most once (`tries`, cap 2 tries in all). After that, a person decides, as before.

## Target shape

| Path | Before | After |
|---|---|---|
| SMS (Telnyx) | stale `sending` → `unknown`, never resent | the send carries `Idempotency-Key: sms-<id>`. A stale `sending` row goes back to `queued` and sends again with the same key. Telnyx replays the first answer for 24 h: exactly once |
| SMS (Linq) | same | same resend, no key: at least once |
| Email | not in Sent after the grace → `failed`; a person re-arms | → `approved` again with the same Message-ID, once. `TransportRefused` stays `failed` |
| DMs, comments, posts | `unsure` after the rechecks → To approve | → sent again under a new key, once, through the item's own queue. To approve gets only a second unsure |
| Restate retries | server defaults, not written down | the same values in `config.toml` (`[default-retry-policy]`): 500 ms, x2, 1 min max, 70 tries, then pause |
| Webhook dedupe | 24 h (Restate default) | 7 days (`WEBHOOK_SERVICE` in `@wren/core/restate`) on SmsEvents, CallBookings, Documents, SmsForms, SocialPush, InboxPush |
| Webhooks while Restate is down | 502; the sender retries | short-retry senders: kept in KV, answered 200, replayed every 2 min under the same key |
| TouchFeed | id cursor plus a 30 s wait: a late commit can be skipped | `touches.fired_at`, marked after the fires are journaled; rows older than an hour backfilled |

## Webhooks while Restate is down

Telnyx retries about 6 times over minutes. A Restate restart or a short outage loses a text.
Pub/Sub (Gmail, Google Business) retries for 7 days, so those routes keep the 502.

| Option | Cost | Result |
|---|---|---|
| Rely on the senders' retries | 0 | texts, bookings, signatures and forms lost after a few minutes down |
| KV buffer + cron replay (chosen) | 0 (KV free tier: 1,000 writes a day; only failed forwards write) | nothing lost while KV is up; replay keeps the idempotency key |
| Cloudflare Queues | Workers Paid, $5 a month | the same, with a managed retry; money is William's call |
| Telnyx failover URL | 0 | covers Telnyx only, and still needs a store |

## Restate's disk (William picked hourly, 11-04)

Restate runs as one node on the Postgres box. A lost volume lost every queued call since the
08:30 snapshot. Now hourly (WA-1063): a ring of 24 data tarballs, at most 1 h lost.

| Option | Cost | Data lost if the volume dies |
|---|---|---|
| Restate snapshot hourly, not nightly | about 0 | up to 1 h |
| EBS snapshots hourly (DLM) | a few $ a month | up to 1 h, Postgres too |
| 3-node Restate cluster | 2 more instances | none |
| Restate Cloud | its plan | none |

## Not changed

- A paused call still holds its key until `wren dlq` ends it.
- `pg_notify` wakes can be lost; each loop's timed pass covers them.
- `sdm:` (a client's answer in its Inbox) is never resent: the client's own word sends it.
- A client's pass resends its DMs only. Its comments and posts wait on the client, as before.
- A past-cap DM `unknown` from a send error or a stale `sending` has no ledger row, so To approve
  does not show it. This was true before.
- A not-sent try on a comment or post deletes its row (`releaseSend`), so that try is not counted.
  The send never left, so no duplicate can come of it.
- Auto resends record `by: wren` on the settle; the draft record's `by` reads "console".
- The door (`/hooks/<token>`, `Executor/hook`) keeps the 502: its sender and its retries are
  unknown, and it answers the Executor's status, which a hold cannot.

## Decision log

- 2026-11-04: at least once (William). Resend cap 1. Same Message-ID on an email resend: receivers
  that dedupe on it drop the copy, the rest show two. SMS via Telnyx is exactly once by its key.
- 2026-11-04 (WA-1059): a recheck that proves `verified_absent` is sent once more, not handed to a
  person. A send error with no verdict is sent once more. Unsure rows from before the switch keep
  `tries >= 2`: they stay a person's. A post of ours on Send again keeps its ledger row
  (`markResend`), so the scheduler's claim counts the try; deleting it reset the count and could
  resend without end.
- 2026-11-04 (WA-1061): the replay cron runs every 2 min, not each minute: KV's free tier lists
  1,000 times a day. A Telnyx event whose signer Restate could not name is held whole (raw body,
  signature, timestamp, receive time) and checked on replay; its signature stays valid against
  the receive time. A held key is written once: a vendor retry while down costs a read only.
- 2026-11-04 (WA-1060): Restate 1.7 reads the retry policy at the top level
  (`[default-retry-policy]`); `[invocation.default-retry-policy]` is ignored without an error.
  `--dump-config` gave the defaults (500 ms first, not 50 ms); the pin copies them, so no behavior
  changes now. The 7-day key covers the KV hold's TTL: a replay inside it is applied once.
- 2026-11-04 (WA-1062): TouchFeed marks `fired_at` after the executor sends, not before. A claim
  first (`SKIP LOCKED`) loses a touch when the step commits and the Lambda dies before Restate
  journals it: the retry finds the rows claimed. One key (`TouchFeed/all`) runs one pass at a
  time, so no lock is needed. The settle wait and the cursor in loop state are gone. Backfill
  leaves the last hour untold: told again at most, never skipped.
