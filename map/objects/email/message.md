---
type: object
cluster: email
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-email/src/schema.ts:236
---

# message

One rendered email of one enrollment step, with its exact text and where its address came from. Table `messages`. Not `sms_messages`.

## Why this shape

Text is pinned at compose, so what a reviewer approves is the bytes that go out. `state` is a strict machine (`MESSAGE_TRANSITIONS`, `packages/channel-email/src/state.ts:6`): there is no `approved → sent` edge, `approved → draft` is the portal's undo (it locks first, so a send in flight wins), every send commits `sending` with our own `message_id` first, and `unknown` can only be moved by reconcile. `provenance` pins template@version, every variant pick, and the address record (`packages/channel-email/src/outreach/provenance.ts:31`).

## Shape

- `enrollment_id`, `step`, `template`, `template_version`, `to_email`, `subject`, `body`, `provenance`, `state`, `message_id`, `gmail_id`, `thread_id`, `attempted_at`, `transport`, `run_id`, `sent_run_id`, `review_reason`, `edited_at`, `open_token`, `approved_by` (operator | auto), `link_code` (the `?r=` on the sign-off link; `wren email clicks` reads it back from the lander, `packages/channel-email/src/inbox/clicks.ts`), `held` (a follow-up waiting for its cadence's `email.touch` on the spine; the tick counts it `waiting_touch`), `released_at` (when the touch let it go; `packages/channel-email/src/follow.ts`) (`packages/channel-email/src/schema.ts:239`–`261`)

Citations: `packages/channel-email/src/schema.ts:236`, `packages/channel-email/src/state.ts:6`

## Connected to

- **owned-by:** [[email/enrollment]], [[email/template]] (`template`, `template_version`)
- **owns:** [[email/open-event]] (`message_id`)
- **joins:** [[email/thread-event]] (`in_reply_to_message_id`), [[ledger/run]]
- **looks-like-but-is-not:** [[sms/sms-message]]; a `content_drafts` row

## If you change this

- **Hits:** compose (`compose.ts:744`); the send walk and reconcile (`send/deliver.ts:190`, `send/reconcile.ts:42`); review (`outreach/review.ts`); every view in `packages/channel-email/src/views.ts`; open tracking (`inbox/opens.ts:100`)
- **Does not hit:** `enrollments` columns; the transport contract (`send/transport.ts:78`)

## Surfaces

| Surface | Role |
|---|---|
| `ComposeScheduler` | writes drafts |
| `wren email approve/reject/edit` | writes one-row facts |
| `SendScheduler/{sender}` | moves `approved → sending → sent/failed/unknown` |
| views, weekly report | read |

## See

- Source: `packages/channel-email/src/send/deliver.ts`
