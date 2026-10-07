---
type: object
cluster: sms
universe: live
status: verified
verified: 2026-10-07 @ da86269
entity: packages/channel-sms/src/schema.ts:555
---

# missed-call

One incoming call to a client's number and what the missed-call text back did with it. Table `sms_calls`, in each client's database. Product words: Missed calls, Texted back, Callers who replied, Callers who booked.

## Why this shape

One row per Telnyx call session (`uq_sms_calls_call_id`), filled as `call.initiated/answered/bridged/hangup` arrive (`applyCall`, `packages/channel-sms/src/events.ts:325`). `result` is set once, at hangup (`callResult`, `events.ts:312`): bridged is answered, `user_busy` busy, answered but never bridged voicemail, the rest missed. Every way a text back doesn't go is kept on the row (`text_back`, `text_back_detail`), so the page says why.

## Shape

- `call_id`, `from_e164`, `to_e164`, `number_id` ([[sms/sms-number]]), `started_at`, `answered_at`, `bridged_at`, `ended_at`, `cause`, `result` (answered, missed, busy, voicemail), `known`, `contact_id` ([[sms/sms-contact]], set null), `text_back` (queued, would_send, skipped, refused), `text_back_at`, `text_back_detail`, `replied_at`, `booked_at` (`schema.ts:555`); migration 0178
- the walk (`missed_call.steps`, `apps/worker/src/workflows.ts`): `in.calls` → `sms.text_back` (`textBack`, `packages/channel-sms/src/missed.ts:106`). Entered by `callHooks` (`restate/answers.ts:29`) with `onlyLive`
- rules: hidden or non-US numbers refused, opt-outs refused, once per caller per `hoursBetween` (24), a caller in a running thread skipped; copy `missed-call-new` or `missed-call-known`; sends 8:00 to 20:00 caller-local (`ASKED_WINDOW`, `policy.ts`)
- a reply: `callReplied` (`missed.ts:209`) sets `replied_at`; with speed to lead live, `runOfCall` (`missed.ts:240`) opens a [[sms/speed-run]] (subject `call:<id>`) at `text.texted`
- record `sms.call` (`missedCallRecord`, `records.ts:269`): views Missed, Texted back, Replied, Booked, All; `load` gives each step

Citations: `packages/channel-sms/src/schema.ts:555`, `packages/channel-sms/src/events.ts:325`, `packages/channel-sms/src/missed.ts:106`, `packages/channel-sms/src/restate/answers.ts:29`, `packages/channel-sms/src/records.ts:269`

## Connected to

- **owned-by:** the `missed_call` part (`packages/channel-sms/src/components.ts`), a Shop template; needs fact `number.calls_routed` (setup `setup.call_routing`, `setups.ts:111`)
- **joins:** [[sms/sms-event]] (call events), [[sms/sms-message]] (the `text_back` text), [[sms/speed-run]], [[platform/spine]]
- **looks-like-but-is-not:** `voice_calls` ([[voice/call]], calls we place)

## If you change this

- **Hits:** `telnyx.ts` (`parseTelnyxEvent`, incoming only), `events.ts`, `missed.ts`, `answers.ts`, `records.ts`, Texts > Missed calls and its Overview tiles (`apps/portal/web/src/modules/texts/index.tsx`)
- **Does not hit:** the main database; cold text sequences

## Surfaces

| Surface | Role |
|---|---|
| Telnyx `/webhooks/telnyx/<client>` → `SmsEvents/ingestFor` | writes |
| `Spine/emit` → `sms.text_back` | writes the text back |
| portal Texts > Missed calls (`SmsConsole.records*`) | reads |

## See

- Source: `packages/channel-sms/src/missed.ts`
- Design: `designs/2026-10-07-missed-call-and-reviews.md`
