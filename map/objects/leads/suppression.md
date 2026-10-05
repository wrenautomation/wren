---
type: object
cluster: leads
universe: live
status: verified
verified: 2026-10-05 @ 6573a02
entity: packages/core/src/suppress.ts:72
---

# suppression

A promise not to contact an address, a domain or a phone. Tables `suppressions` and `suppression_events`; the writers are `addSuppression` and `liftSuppression` in core.

## Why this shape

Every channel writes one table through one path (`packages/core/src/suppress.ts:72`, `:113`), so an opt-out by text is honoured by email and back. A lift is an event, not a delete: `revoked_at` plus a `lifted` event keeps the history (`packages/core/src/schema.ts:269`, `:279`).

## Shape

- `suppressions`: `kind` (email | domain | phone), `value`, `reason` (opt_out | bounce | complaint | manual | lifted), `revoked_at` (`packages/core/src/schema.ts:264`–`269`)
- `suppression_events`: `suppression_id`, `reason`, `evidence` (`:315`–`319`)

Citations: `packages/core/src/suppress.ts:72`, `packages/core/src/schema.ts:261`

## Connected to

- **owns:** `suppression_events`
- **joins:** [[leads/consent]] (beats every consent), [[leads/lead]] (`suppression_id`), [[email/thread-event]] (the evidence), [[sms/sms-event]]
- **looks-like-but-is-not:** [[email/sender-pause]] (our side is paused, theirs is not suppressed)

## If you change this

- **Hits:** the read gate `activeSuppression` (`packages/channel-email/src/guards.ts`) used by compose, resolution and the send tick; the inbox sync (`packages/channel-email/src/inbox/sync.ts`); SMS STOP handling (`packages/channel-sms/src/events.ts:230`) and grounded opt-outs (`packages/channel-sms/src/classify.ts`); email's bulk import and CSV (`packages/channel-email/src/send/suppress.ts`); marketing's `mayMarket`, unsubscribe-everything and the double opt-in lift ([[leads/consent]])
- **Does not hit:** `leads.status = suppressed` is set separately; the LLM classifiers never write here on their own say

## Surfaces

| Surface | Role |
|---|---|
| `InboxScheduler`, `SmsEvents`, `SmsWatch` | write |
| `wren email suppress add/lift` | writes |
| compose, resolution, both send ticks | read |

## See

- Source: `packages/core/src/suppress.ts`
