---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/schema.ts:172
---

# enrollment

One company in one email sequence, from one sender, with every step drafted up front. Table `enrollments`. The word means only this; SMS has no enrollments table.

## Why this shape

Compose writes the whole sequence before anything can send (`packages/channel-email/src/outreach/compose.ts:15`), and three partial unique indexes make "one active enrollment per company / person / address" a database fact, not a check (`packages/channel-email/src/schema.ts:200`–`208`). Across channels, `@wren/core/leads` adds two checks: compose skips a lead a text or DM sequence holds (`skipped_lead_busy`), and the send gate holds an opener while the firm had a text or DM first touch in the last day (`first_touch_waiting`, `packages/core/src/leads.ts`). `sequence_snapshot` pins the cadence so a later edit of the niche never changes a running thread. `offer` names what was pitched (`:181`). `contact_round` counts the company's cold sequences (1 = first contact, 2+ = recycled, `:192`); view `contact_outcomes` says how each one ended and when it was last touched, which is what lead recycling rests on (`packages/channel-email/src/views.ts:225`; `packages/channel-email/src/recontact.ts:123`).

## Shape

- `person_id`, `company_id`, `niche`, `sequence_name`, `sequence_snapshot`, `offer`, `state` (active | finished | stopped), `stop_reason`, `kind` (person | role_inbox), `to_email`, `sender`, `run_id`, `contact_round` (`:176`–`192`)
- transitions: `ENROLLMENT_TRANSITIONS` (`packages/channel-email/src/state.ts:29`)
- `lead_id` and `candidate_id` (FKs, indexed, set at enrollment: the address and its evidence; null on rows older than 2026-10-06 that no lead matched). View `lead_channels`: one row per channel enrollment, per lead (`packages/core`). `enrollment_outcomes` now carries `last_touch_at` and `outcome`; `contact_outcomes` is a plain select from it, so recycling and the funnel read one definition

Citations: `packages/channel-email/src/schema.ts:172`

## Connected to

- **owns:** [[email/message]] (one per step), [[email/thread-event]], [[email/call-booking]] (a matched one stops it with `stop_reason` `booked`, outcome warm)
- **owned-by:** [[leads/company]], [[leads/person]] (person kind), [[email/sequence]], [[platform/offer]] by name
- **looks-like-but-is-not:** [[sms/sms-contact]] in state `enrolled`

## If you change this

- **Hits:** compose (`compose.ts:598`); the send walk's per-enrollment rule (`send/deliver.ts:190`); inbox sync's stop (`inbox/sync.ts`); the queue-keeper's capacity count (`restate/compose-scheduler.ts`); views `campaign_funnel`, `enrollment_outcomes`, `contact_outcomes`, `reply_by_arm_step` (`views.ts:154`, `:179`, `:225`, `:78`); the recycling gate (`recontact.ts:123`); the console views `email_campaign_records` and `email_reply_records` (migration 0061)
- **Does not hit:** templates or facts; the roster

## Surfaces

| Surface | Role |
|---|---|
| `ComposeScheduler/{niche}` | writes |
| `SendScheduler/{sender}`, `InboxScheduler/{sender}` | move state |
| `wren email drafts/stop` | reads, stops |

## See

- Source: `packages/channel-email/src/outreach/compose.ts`
