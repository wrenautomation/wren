---
type: object
cluster: sms
universe: live
status: verified
verified: 2026-10-07 @ 2cdad29
entity: packages/channel-sms/src/schema.ts:457
---

# speed-run

One lead through speed to lead: what the door said, its first text and when it left, the call step, a booking. Table `speed_runs`, in each client's database. Product words: Speed to lead, Call now, Time to first text.

## Why this shape

The metric is two columns: `lead_at` (the event) and `first_touch_at` (the text left, or "would send" was recorded with texts off). One row per workflow and subject, so a retried step finds the first run and queues nothing more (`firstText`, `packages/channel-sms/src/speed.ts:119`). The follow-up's state is its [[sms/sms-contact]]'s, not copied here. The call step writes once (`where call is null`), so a retry never calls twice (`callNow`, `packages/voice/src/call-now.ts:65`).

## Shape

- `workflow`, `subject` (`form:<the hook's subject>`; the lander's is `form:site:<table>:<row id>`), `lead_at`, `name`, `phone`, `e164`, `email`, `source`, `consent`, `consent_detail`, `zone`, `sms_contact_id` (set null on delete), `first_touch` (`FIRST_TOUCHES`: queued, sent, would_send, no_consent, no_phone, refused), `first_touch_at`, `first_touch_detail`, `call` (`SPEED_CALLS`: alerted, dialed, skipped), `call_at`, `call_detail`, `call_done_at`, `call_outcome` (`DIAL_OUTCOMES` in `@wren/core/calls`, `packages/core/src/calls.ts:9`: reached, voicemail, no_answer, wrong_number; the meeting outcomes beside it are [[email/call-booking]]'s), `call_done_by`, `booked_at` (`schema.ts:457`)
- `uq_speed_runs_workflow_subject`; indexes on `sms_contact_id`, `lead_at`; migrations 0139, 0143; audited
- the walk (`speed_to_lead.steps`, `apps/worker/src/workflows.ts`): `sms.forms` (`firstTextStep`, `speed.ts:211`) → wait 2 minutes → `voice.call_now` ([[voice/call]]); untexted leads go straight to the call; texted ones also to `sms.follow_up` (cadence `follow_up.speed-to-lead`, day 1, 3, 7). `call.booked` ends it
- live: `WREN_SMS_LIVE` and the client's texts both on, else `would_send` with why and nothing queued (`apps/worker/src/services.ts:1124`). Form leads text 8:00 to 21:00 lead-local every day (`ASKED_WINDOW`, `policy.ts:53`), held to 20:00 by the legal clamp
- a booking (by email) during the follow-up sets `booked_at` and finishes the contact (`bookedRun`, `follow.ts:57`); a lead in an active email sequence gets no follow-up texts
- record `sms.speed` (`records.ts:128`, rows, newest 500): the Call column is derived (`callState`): an alerted run reads Booked once booked, Called once done, else Call now. Views Call now (open only), Done, All, Booked; `load` gives each step's state and why
- Done: `SmsConsole.callDone` (`restate/console.ts`, need `act` in Texts, off the demo) closes open runs only (alerted, not done, not booked), with an optional outcome and the viewer's email; the rest come back `skipped`

Citations: `packages/channel-sms/src/schema.ts:457`, `packages/channel-sms/src/restate/console.ts`, `packages/channel-sms/src/speed.ts:119`, `packages/voice/src/call-now.ts:65`, `packages/channel-sms/src/follow.ts:57`, `packages/channel-sms/src/policy.ts:53`, `apps/worker/src/services.ts:1124`

## Connected to

- **owned-by:** the `speed_to_lead` part (`packages/channel-sms/src/components.ts`), in development in the Shop with its parts `sms.forms`, `sms.follow_up`, `voice.call_now`: Install stores a block only, no door hook
- **joins:** [[sms/sms-contact]] (`sms_contact_id`), [[platform/spine]] (the door's `data.lead`), [[voice/call]] (Call now), [[calendar/booking]] (booked check)
- **looks-like-but-is-not:** `voice_calls` (a call made), `events` (every arrival on the spine)

## If you change this

- **Hits:** `speed.ts`, `follow.ts` (`bookedRun`), `call-now.ts`, `records.ts` (`sms.speed`), the Texts app's Speed to lead page and tiles (`apps/portal/web/src/modules/texts/index.tsx`)
- **Does not hit:** cold text sequences; the main database (client databases only, and Wren's own)

## Surfaces

| Surface | Role |
|---|---|
| `Spine/hook` → `sms.forms`, `voice.call_now`, `SmsSender` (first touch on send) | writes |
| portal Texts > Speed to lead, Overview tiles Call now and Time to first text (`SmsConsole.records*`) | reads |
| portal Texts > Speed to lead, Done (`SmsConsole.callDone`) | writes the call's close |

## See

- Source: `packages/channel-sms/src/speed.ts`
- Design: `designs/2026-10-07-speed-to-lead.md`
