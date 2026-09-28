---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/schema.ts:170
---

# enrollment

One company in one email sequence, from one sender, with every step drafted up front. Table `enrollments`. The word means only this; SMS has no enrollments table.

## Why this shape

Compose writes the whole sequence before anything can send (`packages/channel-email/src/outreach/compose.ts:22`), and three partial unique indexes make "one active enrollment per company / person / address" a database fact, not a check (`packages/channel-email/src/schema.ts:196`–`202`). `sequence_snapshot` pins the cadence so a later edit of the niche never changes a running thread. `offer` names what was pitched (`:179`).

## Shape

- `person_id`, `company_id`, `niche`, `sequence_name`, `sequence_snapshot`, `offer`, `state` (active | finished | stopped), `stop_reason`, `kind` (person | role_inbox), `to_email`, `sender`, `run_id` (`:174`–`188`)
- transitions: `ENROLLMENT_TRANSITIONS` (`packages/channel-email/src/state.ts:29`)

Citations: `packages/channel-email/src/schema.ts:170`

## Connected to

- **owns:** [[email/message]] (one per step), [[email/thread-event]]
- **owned-by:** [[leads/company]], [[leads/person]] (person kind), [[email/sequence]], [[platform/offer]] by name
- **looks-like-but-is-not:** [[sms/sms-contact]] in state `enrolled`

## If you change this

- **Hits:** compose (`compose.ts:606`); the send walk's per-enrollment rule (`send/deliver.ts:190`); inbox sync's stop (`inbox/sync.ts`); the queue-keeper's capacity count (`restate/compose-scheduler.ts`); views `campaign_funnel`, `enrollment_outcomes`, `reply_by_arm_step` (`views.ts:153`, `:176`, `:77`)
- **Does not hit:** templates or facts; the roster

## Surfaces

| Surface | Role |
|---|---|
| `ComposeScheduler/{niche}` | writes |
| `SendScheduler/{sender}`, `InboxScheduler/{sender}` | move state |
| `wren email drafts/stop` | reads, stops |

## See

- Source: `packages/channel-email/src/outreach/compose.ts`
