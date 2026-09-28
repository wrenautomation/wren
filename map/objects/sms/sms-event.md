---
type: object
cluster: sms
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-sms/src/schema.ts:280
---

# sms-event

One provider webhook as received, keyed by the provider's event id. Table `sms_events`.

## Why this shape

A webhook delivered twice, or replayed by Restate, applies once (`events.ts:1`). The phone Worker checks the Ed25519 signature and forwards with the event id as the idempotency key (`apps/phone/src/worker.ts:1`, `webhook.ts:1`); the rules that act on it are deterministic and ordered: STOP, START, else reply.

## Shape

- `provider`, `provider_event_id`, `type`, `payload`, `received_at`, `outcome` (`schema.ts:284`–`291`)
- `classifyInbound`, `applyEvent` (`events.ts:53`, `:230`)

Citations: `packages/channel-sms/src/schema.ts:280`

## Connected to

- **produces:** [[sms/sms-message]] (inbound rows, delivery states), [[leads/suppression]] (phone), [[sms/sms-contact]] state
- **joins:** [[platform/phone-worker]] (the door), [[sms/sms-provider]] (the body shape)

## If you change this

- **Hits:** `events.ts:239`, `webhook.ts`, `restate/index.ts` (`SmsEvents.ingest`), `apps/phone/src/worker.ts`, `telnyx.ts` (body shape)
- **Does not hit:** the send tick

## Surfaces

| Surface | Role |
|---|---|
| `SmsEvents.ingest` (from the phone Worker) | writes |

## See

- Source: `packages/channel-sms/src/events.ts`
