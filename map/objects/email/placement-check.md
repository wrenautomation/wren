---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-04 @ fe76e6d
entity: packages/channel-email/src/schema.ts:717
---

# placement-check

Where one seed Gmail's copy of a ramped inbox's newest opener landed, one row per inbox, seed and send day. Table `placement_checks`; the loop is `PlacementScheduler/fleet`.

## Why this shape

Postmaster says nothing below its volume threshold, so warmup is blind without seeds. The key (sender, seed, day) is the idempotency guard: the row is claimed with its Message-ID before the send, so a retried pass never mails a seed twice (`sendPlacements`, `restate/placement-scheduler.ts:118`). Seed copies never touch `messages`, lead rows or the caps. The landing is read two hours later from the seed's own labels through autobrowse's `gmail` site (`landedAt`, `:72`); a 4xx refusal records why and is not asked again.

## Shape

- `sender`, `seed`, `day` (fleet clock, PK); `message_id`, `sent_at`; `landed` (`inbox | promotions | spam | missing`, null until read); `checked_at`; `detail` (`no draft yet`, `send failed`, `check refused`) (`schema.ts:717`)
- seeds: `WREN_PLACEMENT_SEEDS` (`packages/config/src/index.ts:111`); empty = the loop sends nothing

Citations: `packages/channel-email/src/schema.ts:717`, `packages/channel-email/src/restate/placement-scheduler.ts:219`

## Connected to

- **joins:** [[email/roster]] ramps (inboxes measured, warmup included); [[email/message]] (the newest step-0 draft pinned to the inbox, read only); [[email/transport]] (`carrierOf`); the digest (`restate/digest-scheduler.ts:120`)
- **looks-like-but-is-not:** [[email/postmaster-day]] (Google's domain numbers, not our seeds)

## If you change this

- **Hits:** `PlacementScheduler`, the digest's placement lines and its `inbox placement` warning, `mintMessageId` (`send/deliver.ts:133`, shared with the send path)
- **Does not hit:** `messages`, `enrollments`, `send_health`, the caps, `sender_pauses`

## Surfaces

| Surface | Role |
|---|---|
| `PlacementScheduler` (`apps/worker/src/services.ts:541`) | writes |
| `DigestScheduler` (when seeds set) | read |
| autobrowse `sites` (`gmail`, account = seed) | read by the loop |

## See

- Source: `packages/channel-email/src/restate/placement-scheduler.ts`
