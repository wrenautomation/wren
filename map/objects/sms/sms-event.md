---
type: object
cluster: sms
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-sms/src/schema.ts:300
---

# sms-event

One provider webhook as received, keyed by the provider's event id. Table `sms_events`.

## Why this shape

A webhook delivered twice, or replayed by Restate, applies once (`events.ts:1`). The phone Worker checks the Ed25519 signature and forwards with the event id as the idempotency key (`apps/phone/src/worker.ts:1`, `webhook.ts:1`); the rules that act on it are deterministic and ordered: STOP, START, a topic's keyword (marketing consent, [[leads/consent]]), else reply.

## Shape

- `provider`, `provider_event_id`, `type`, `payload`, `received_at`, `outcome` (`schema.ts:304`–`310`)
- `classifyInbound`, `applyEvent` (`events.ts:56`, `:256`)
- A reply or STOP alerts every device in `sms_push_subscriptions` after the commit (`push.ts`); a failed push never fails the event.

Citations: `packages/channel-sms/src/schema.ts:300`

## Connected to

- **produces:** [[sms/sms-message]] (inbound rows, delivery states), [[leads/suppression]] (phone), [[sms/sms-contact]] state, reply alerts (web push to the phone app), a lead's reply to the spine's Reply triggers (`ApplyResult.replied`, the `fire` dep; [[platform/spine]])
- **joins:** [[platform/phone-worker]] (the door), [[sms/sms-provider]] (the body shape)

## If you change this

- **Hits:** `events.ts:256`, `push.ts`, `webhook.ts`, `restate/index.ts` (`SmsEvents.ingest`), `apps/phone/src/worker.ts`, `telnyx.ts` (body shape)
- **Does not hit:** the send tick

## Surfaces

| Surface | Role |
|---|---|
| `SmsEvents.ingest` (from the phone Worker) | writes |
| phone app reply alerts (`SmsDesk.subscribe`, `sw.js`) | reads |

## See

- Source: `packages/channel-sms/src/events.ts`
