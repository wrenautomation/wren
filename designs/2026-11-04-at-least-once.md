# At least once: every send and every inbound event

2026-11-04. Tasks WA-1057 to WA-1063. Status: agreed (William, 11-04), building.

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
| Restate retries | server defaults, not written down | the same values in `config.toml` (`[invocation.default-retry-policy]`): 50 ms, x2, 60 s max, 70 tries, then pause |
| Webhook dedupe | 24 h (Restate default) | 7 days on the services webhooks call (`idempotencyRetention`) |
| Webhooks while Restate is down | 502; the sender retries | short-retry senders: kept in KV, answered 200, replayed each minute under the same key |
| TouchFeed | id cursor plus a 30 s wait: a late commit can be skipped | `touches.fired_at`, claimed with `SKIP LOCKED`; old rows backfilled |

## Webhooks while Restate is down

Telnyx retries about 6 times over minutes. A Restate restart or a short outage loses a text.
Pub/Sub (Gmail, Google Business) retries for 7 days, so those routes keep the 502.

| Option | Cost | Result |
|---|---|---|
| Rely on the senders' retries | 0 | texts, bookings, signatures and forms lost after a few minutes down |
| KV buffer + cron replay (chosen) | 0 (KV free tier: 1,000 writes a day; only failed forwards write) | nothing lost while KV is up; replay keeps the idempotency key |
| Cloudflare Queues | Workers Paid, $5 a month | the same, with a managed retry; money is William's call |
| Telnyx failover URL | 0 | covers Telnyx only, and still needs a store |

## Restate's disk (William picks)

Restate runs as one node on the Postgres box. A lost volume loses every queued call since the
08:30 snapshot.

| Option | Cost | Data lost if the volume dies |
|---|---|---|
| Restate snapshot hourly, not nightly | about 0 | up to 1 h |
| EBS snapshots hourly (DLM) | a few $ a month | up to 1 h, Postgres too |
| 3-node Restate cluster | 2 more instances | none |
| Restate Cloud | its plan | none |

## Not changed

- A paused call still holds its key until `wren dlq` ends it.
- `pg_notify` wakes can be lost; each loop's timed pass covers them.

## Decision log

- 2026-11-04: at least once (William). Resend cap 1. Same Message-ID on an email resend: receivers
  that dedupe on it drop the copy, the rest show two. SMS via Telnyx is exactly once by its key.
