---
type: object
cluster: sms
universe: live
status: verified
verified: 2026-09-28 @ 28823cd
entity: packages/channel-sms/src/schema.ts:200
---

# sms-message

One text, out or in, on one contact's thread. Table `sms_messages`. Not the email `messages` table.

## Why this shape

Intent before act, same as email: `sending` is written before the provider is called, a crash leaves a row that reconcile turns `unknown`, and nothing ever resends (`deliver.ts:1`). One row per contact per step (`uq_sms_messages_contact_step`, `:238`) and one per provider id (`:237`) make webhooks and retries idempotent. A reply's label is proposed by the LLM and gated; a grounded `opt_out` suppresses (`classify.ts:1`).

## Shape

- `contact_id`, `direction`, `kind` (sequence | manual | inbound), `step`, `template`, `number_id`, `body`, `state` (`MESSAGE_STATES`, `:85`), `provider_id`, `parts`, `cost_usd`, `error_code`, `due_at`, `attempted_at`, `sent_at`, `delivered_at`, `received_at`, `disposition`, `disposition_source`, `classification`, `run_id` (`schema.ts:204`–`231`)

Citations: `packages/channel-sms/src/schema.ts:200`

## Connected to

- **owned-by:** [[sms/sms-contact]], [[sms/sms-number]]
- **joins:** [[sms/sms-event]] (delivery receipts update it), [[ledger/run]]
- **looks-like-but-is-not:** [[email/message]]

## If you change this

- **Hits:** `deliver.ts:134`, `:344`, `:63`; `enroll.ts:172`; `events.ts:168`; `classify.ts`; `threads.ts`; `templates.ts` (step bodies); `SmsSender`, `SmsDesk.reply`, the phone app
- **Does not hit:** email's state machine

## Surfaces

| Surface | Role |
|---|---|
| `SmsSender/fleet` | writes sends |
| `SmsEvents.ingest` | writes inbound and receipts |
| `SmsDesk.reply` | writes manual |
| `SmsWatch/daily` | labels |

## See

- Source: `packages/channel-sms/src/deliver.ts`
