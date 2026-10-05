# Webhooks and serverless, round 2 (2026-10-04)

Round 1 is `2026-10-04-booking-webhook.md` (the per-seam push or poll table).

## Answer first

- Lambda is not the meter. Since the pool chain moved to the box on 10-02, the worker bills about 2,500 GB-s a day. That is under a fifth of the free tier, so ≈ $0.
- Restate Cloud is the meter. In the last day it ran 6,460 invocations and wrote about 97,000 journal entries, roughly 2.9M a month. The free tier advertises 50k actions a month, and paid plans start at $75/month. We have run above it for two weeks and nothing has been cut off. **William: open cloud.restate.dev and check usage and billing.** Every choice below depends on it.
- Built now: the open-pixel pull drops from every 2 min to hourly while tracking is off. It ran 3,342 times last week, and the pixel has recorded 12 opens in total.
- Gmail push is the next webhook. It needs a Pub/Sub topic, and gcloud's login has expired (`! gcloud auth login`, his Google sign-in).

## Lambda (7 days to 10-04)

| Measure | Value | Verdict |
|---|---|---|
| Billed time | 34k to 73k GB-s on pool days (09-27, 09-30, 10-01); 2k to 3.8k GB-s since 10-02 | Free tier is 400k GB-s/month. ≈ $0 |
| Requests | 5.6k to 8k a day since 10-02 | Free tier is 1M/month |
| Memory | peak 455 MB of 1 GB | Keep 1 GB: it costs nothing and CPU scales with memory |
| Cold starts | about 7 a day, 1.8 s init | Loops keep an instance warm; a portal click rarely pays it |
| Throttles | 331, at the reserved cap of 6 | Pool runs on 10-01, then today's 30 deploys. Restate retries them; nothing is lost. Keep the cap |
| Postgres connections | Lambda pool 2 × cap 6 = 12, box 6, of 60 | Fine |

## Restate, by service (last 24 h)

| Service | Invocations | Journal entries | Note |
|---|---|---|---|
| Enrichment, Discovery, PoolScheduler, Resolution (box) | 2,431 | 68,153 (70%) | about 30 entries per unit |
| OpensScheduler | 714 | 8,556 | tracking off; now hourly |
| InboxScheduler (1 inbox) | 706 | 8,460 | every 2 min |
| SmsSender | 286 | 3,411 | every 5 min idle |
| ConsolePortal, DeliveryPortal, ReactivationPortal | 1,639 | 3,278 | real clicks and reads, 2 entries each |
| the rest | 684 | 5,430 | |

A loop pass writes 12 entries: the state reads, the clock, the pass, its outcome, the next timer.

If Restate bills per action, the options are William's call:

1. Pay. Plans start at $75/month (5× today's AWS bill).
2. Self-host Restate on the box. It is a single binary, but the box has 905 MB free of 1.8 GB, so it moves to `t4g.medium` (+$12/month). Ingress then needs its own auth proxy, and loop state moves over by restarting each loop.
3. Cut entries: pool units batched per invocation (the 70%), loop state in one key (12 → about 8 per pass), Gmail push (below).

## Webhooks, round 2

| Seam | Verdict |
|---|---|
| Gmail replies (Wren's Workspace inboxes and clients' mailboxes, all on the Gmail API) | **Push next.** `users.watch` → Pub/Sub → push subscription to the phone Worker (`/webhooks/gmail`, a secret in the URL) → `InboxScheduler/<inbox>/sync`. The poll drops to 30 min as a net, and a daily pass renews the watch (it lapses after 7 days). Pub/Sub free tier, $0. Saves about 8,400 entries a day per inbox and brings replies in within seconds. Blocked on `gcloud auth login`. |
| Fleet inboxes (9, SMTP/IMAP on Inbox Insiders' Workspace) | No Gmail API there, so no watch. IMAP IDLE needs a held connection: the box can hold one when those inboxes start cold sends (14+ days of warmup). Until then, leave their inbox loops unstarted. |
| Approving a reply | Already direct: `approve` books and sends in the call. No awakeable needed. |
| Telnyx, cal.com doors | Signed, an idempotency key at Restate, and a unique row in Postgres (`provider_event_id`, booking uid). A replay past Restate's key window still applies once. |
| Outbound webhooks to a client's systems | None until a client asks. The portal and Discord cover it. |
| Wise, Meta lead forms, lander forms | Unchanged from round 1. |

## Done when

- The opens loop runs hourly on prod (deployed with this doc).
- William answers the Restate billing question; the matching option above gets its own design.
- Gmail push is built after `gcloud auth login`.

## Decision log

- 2026-10-04: William: "investigate more webhook stuff, and serverless function stuff." Measured from CloudWatch, Logs Insights and Restate's `sys_invocation`. Built only the opens cadence: it is free and removes 9% of journal entries. Gmail push reverses round 1's "keep polling": the poll costs Restate entries, not just latency, and per-client mailboxes multiply it.
