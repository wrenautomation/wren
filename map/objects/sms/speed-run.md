---
type: object
cluster: sms
universe: live
status: verified
verified: 2026-10-15 @ 687cde1f
entity: packages/channel-sms/src/schema.ts:518
---

# speed-run

One lead through speed to lead: what the door said, its first text and when it left, the call step, a booking. Wren's own site applications run as workflow `site.forms` (below): the email after the text and the one no-text notice live here too. Table `speed_runs`, in each client's database. Product words: Speed to lead, Call now, Time to first text.

## Why this shape

The metric is two columns: `lead_at` (the event) and `first_touch_at` (the text left, or "would send" was recorded with texts off). One row per workflow and subject, so a retried step finds the first run and queues nothing more (`firstText`, `packages/channel-sms/src/speed.ts:119`). The follow-up's state is its [[sms/sms-contact]]'s, not copied here. The call step writes once (`where call is null`), so a retry never calls twice (`callNow`, `packages/voice/src/call-now.ts:65`).

## Shape

- `workflow`, `subject` (`form:<the hook's subject>`; the lander's is `form:site:<table>:<row id>`), `lead_at`, `name`, `phone`, `e164`, `email`, `source`, `consent`, `consent_detail`, `zone`, `sms_contact_id` (set null on delete), `first_touch` (`FIRST_TOUCHES`: queued, sent, would_send, no_consent, no_phone, refused, booked), `first_touch_at`, `first_touch_detail`, `call` (`SPEED_CALLS`: alerted, dialed, skipped), `call_at`, `call_detail`, `call_done_at`, `call_outcome` (`DIAL_OUTCOMES` in `@wren/core/calls`, `packages/core/src/calls.ts:9`: reached, voicemail, no_answer, wrong_number; the meeting outcomes beside it are [[email/call-booking]]'s), `call_done_by`, `booked_at`, `first_due_at` (when the first text may go), `email_at` + `email_detail` (the email after it; `sending` while claimed), `notice_at` (the one no-text notice) (`schema.ts:518`)
- `uq_speed_runs_workflow_subject`; indexes on `sms_contact_id`, `lead_at`; migrations 0139, 0143, 0273; audited
- the walk (`speed_to_lead.steps`, `apps/worker/src/workflows.ts`): `sms.forms` (`firstTextStep`, `speed.ts:211`) → wait 2 minutes → `voice.call_now` ([[voice/call]]); untexted leads go straight to the call; texted ones also to `sms.follow_up` (cadence `follow_up.speed-to-lead`, day 1, 3, 7). `call.booked` ends it
- site applications (`site.forms`, subject `site:applications:<id>`, `packages/channel-sms/src/form.ts:290` `formStep`): the lander pushes each texts-OK application through the phone Worker (`/webhooks/site` → `SmsForms/applied`, `restate/forms.ts`); the SmsWatch pass (`followUpForms`, `form.ts:431`) is the net. Its first pass seeds: every application already there is recorded and never texted (`form.ts:423`). First text 2 minutes after applying, at the window's next start on their clock (`nextOpen`, `policy.ts:130`; zone from the number's country, `COUNTRY_ZONES` in `phone.ts`); phones in `WREN_SMS_FORM_COUNTRIES` (US, CA, IN); a booking first = `booked`, no text. Sequences `form-fit`/`form-not-fit`: step 1 their own, then borrowed `follow-up#1` (day 1) and `follow-up#2` (day 3). The email (`formEmail`, `form-after.ts:84`) goes 5 minutes after the text from `WREN_FORM_MAIL_FROM`, template `email/forms/form-booking`, none if booked. No text 10 minutes past `first_due_at`: one notice naming why (`noTextNotice`, `form-after.ts:234`). `wren sms stats` shows median minutes to the text and the email (`stats.ts`)
- live: `WREN_SMS_LIVE` and the client's texts both on, else `would_send` with why and nothing queued (`apps/worker/src/services.ts:1124`). Form leads text 8:00 to 21:00 lead-local every day (`ASKED_WINDOW`, `policy.ts:53`), held to 20:00 by the legal clamp
- a booking (by email) during the follow-up sets `booked_at` and finishes the contact (`bookedRun`, `follow.ts:57`); a lead in an active email sequence gets no follow-up texts
- record `sms.speed` (`records.ts:128`, rows, newest 500): the Call column is derived (`callState`): an alerted run reads Booked once booked, Called once done, else Call now. Views Call now (open only), Done, All, Booked; `load` gives each step's state and why
- Done: `SmsConsole.callDone` (`restate/console.ts`, need `act` in Texts, off the demo) closes open runs only (alerted, not done, not booked), with an optional outcome and the viewer's email; the rest come back `skipped`

Citations: `packages/channel-sms/src/schema.ts:518`, `packages/channel-sms/src/form.ts:290`, `packages/channel-sms/src/form-after.ts:84`, `packages/channel-sms/src/restate/forms.ts`, `packages/channel-sms/src/restate/console.ts`, `packages/channel-sms/src/speed.ts:119`, `packages/voice/src/call-now.ts:65`, `packages/channel-sms/src/follow.ts:57`, `packages/channel-sms/src/policy.ts:53`, `apps/worker/src/services.ts:1124`

## Connected to

- **owned-by:** the `speed_to_lead` part (`packages/channel-sms/src/components.ts`), in development in the Shop with its parts `sms.forms`, `sms.follow_up`, `voice.call_now`: Install stores a block only, no door hook
- **joins:** [[sms/sms-contact]] (`sms_contact_id`), [[platform/spine]] (the door's `data.lead`), [[voice/call]] (Call now), [[calendar/booking]] (booked check)
- **looks-like-but-is-not:** `voice_calls` (a call made), `events` (every arrival on the spine)

## If you change this

- **Hits:** `speed.ts`, `form.ts`, `form-after.ts`, `stats.ts` (speed), `follow.ts` (`bookedRun`), `call-now.ts`, `records.ts` (`sms.speed`), the Texts app's Speed to lead page and tiles (`apps/portal/web/src/modules/texts/index.tsx`)
- **Does not hit:** cold text sequences; the main database (client databases only, and Wren's own)

## Surfaces

| Surface | Role |
|---|---|
| `Spine/hook` → `sms.forms`, `voice.call_now`, `SmsSender` (first touch on send) | writes |
| `SmsForms` (the lander's push), `SmsWatch` form pass, `wren sms forms` | writes `site.forms` runs, emails, notices |
| `wren sms stats`, the phone app's Stats (`SmsDesk.stats`) | reads minutes to text and email |
| portal Texts > Speed to lead, Overview tiles Call now and Time to first text (`SmsConsole.records*`) | reads |
| portal Texts > Speed to lead, Done (`SmsConsole.callDone`) | writes the call's close |

## See

- Source: `packages/channel-sms/src/speed.ts`
- Design: `designs/2026-10-07-speed-to-lead.md`
