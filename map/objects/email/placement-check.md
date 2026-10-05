---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-05 @ f21d65f
entity: packages/channel-email/src/schema.ts:918
---

# placement-check

Where one seed Gmail's copy from a ramped inbox landed, and what the receiver said about its SPF, DKIM and DMARC. Two copies per inbox, seed and send day: `plain` (a personal note: the domain) and `real` (the newest opener: the copy). Table `placement_checks`; the loop is `PlacementScheduler/fleet`; the verdict and its pause are `inbox/placement.ts` (designs/2026-10-05-deliverability-tests.md).

## Why this shape

Postmaster says nothing below its volume threshold, so warmup is blind without seeds. The key (sender, seed, day, kind) is the idempotency guard: the row is claimed with its Message-ID before the send, so a retried pass never mails a seed twice (`sendPlacements`, `restate/placement-scheduler.ts:200`). Plain decides the pause: a plain note in spam means the domain is burned whatever the copy says; real failing while plain passes is a copy warning only, since a pause cannot fix copy. Seed copies never touch `messages`, lead rows or the caps. The landing is read two hours later from the seed's own labels through autobrowse's `gmail` site (`landedAt`, `:137`, `format=metadata` so the same call returns `Authentication-Results`); a 4xx refusal records why and is not asked again.

## Shape

- `sender`, `seed`, `day` (fleet clock), `kind` (`plain | real`) (PK); `message_id`, `sent_at`; `landed` (`inbox | promotions | spam | missing`, null until read); `auth` (`{spf, dkim, dmarc}`, the receiver's word); `checked_at`; `detail` (`no draft yet`, `send failed`, `check refused`) (`schema.ts:918`)
- verdict per domain over its last 2 send days: plain < 80% of ≥ 6 landed = `domain problem` → pause (source `placement`); lifts itself after 7 days once plain passes; 14 days still failing = consider a new domain (`placementVerdicts`, `evaluatePlacement`, `inbox/placement.ts`)
- plain notes: `PLAIN_NOTES`, one per day (`plainNote`, `restate/placement-scheduler.ts:79`)
- seeds: `WREN_PLACEMENT_SEEDS` (`packages/config/src/index.ts:111`); empty = the loop sends nothing

Citations: `packages/channel-email/src/schema.ts:918`, `packages/channel-email/src/restate/placement-scheduler.ts:308`, `packages/channel-email/src/inbox/placement.ts:205`

## Connected to

- **joins:** [[email/roster]] ramps (inboxes measured, warmup included); [[email/message]] (the newest step-0 draft pinned to the inbox, read only); [[email/transport]] (`carrierOf`); the digest (`placementLines`, `restate/digest-scheduler.ts:152`); [[email/sender-pause]] (source `placement`)
- **looks-like-but-is-not:** [[email/postmaster-day]] (Google's domain numbers, not our seeds)

## If you change this

- **Hits:** `PlacementScheduler`, its email-lane warnings, the digest's per-domain placement lines, `wren email deliverability`, `sender_pauses` (placement pauses and lifts), `mintMessageId` (`send/deliver.ts:133`, shared with the send path)
- **Does not hit:** `messages`, `enrollments`, `send_health`, the caps, kill-switch or operator pauses

## Surfaces

| Surface | Role |
|---|---|
| `PlacementScheduler` (`apps/worker/src/services.ts:633`) | writes; pauses and lifts |
| `wren email deliverability` | read |
| `DigestScheduler` (when seeds set) | read |
| autobrowse `sites` (`gmail`, account = seed) | read by the loop |

## See

- Source: `packages/channel-email/src/restate/placement-scheduler.ts`
