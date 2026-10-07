# Speed to lead: a text in a minute, a call, follow-up until they book (2026-10-07)

Third in the end-goal build order (`2026-10-05-end-goal.md`), and the first template
(`2026-10-05-workflows.md`, Templates). The part and its workflow are declared "In development"
today (`apps/worker/src/planned.ts`, `speed_to_lead.steps` in `apps/worker/src/workflows.ts`).
This makes them run.

## Answer first

- A lead enters through the client's door: the hook URL (`/hooks/<token>`) from any form or
  CRM. Each lead is a `lead` event on the spine.
- Within 60 seconds it gets a text with the client's booking link. Today's form texts wait on a
  30-minute poll; this one goes when the event arrives.
- After a wait (2 minutes by default) the client's rep gets "Call now" in their Inbox, with the
  lead's details and a tap-to-call link. The voice dialer replaces that step once voice is set
  up; until then the step shows "voice not set up".
- No reply and no booking: the follow-up sub-part texts on a cadence until they book, say stop,
  or the cadence ends.
- The client's page shows the time from form to first text for every lead, and the median.
- Everything respects the live switches. With `WREN_SMS_LIVE` off or the client's texts off,
  the text step records "would send" and goes no further. $0 to build and test.

## Steps (the part's inside)

| Step | Does | Settings (defaults) |
|---|---|---|
| door | `lead` event from the hook; maps fields to name, phone, email, consent, source | field map per hook |
| first text | enrolls the number if new, queues one text, nudges the sender | copy, booking link, window 8:00 to 21:00 lead-local |
| wait | a wire's wait | 2 minutes |
| call | "Call now" Inbox item for the client's rep, or a dial once voice is live | who gets it |
| follow-up | a sub-part other templates reuse: texts on a cadence, stops on reply, booking or STOP | cadence (day 1, 3, 7), copy |
| booked | a booking for that phone or email ends the run | none |

## Rules

- Consent: a text goes only to a lead whose form carried consent (a checked box, recorded
  with the source). No consent: the run skips the texts and still alerts the rep.
- Window: a lead who just asked to hear from us gets a wider window than cold texts: 8:00
  to 21:00 in the lead's time zone, every day. Outside it, the first text waits for 8:00. Both times
  are settings.
- STOP and suppressions apply as for every text. The first text names the client and says
  how to stop.
- One lead across channels: form leads already skip the first-touch guard
  (`packages/core/src/leads.ts`). A lead in an active email sequence is not texted by the
  follow-up.
- Metric: `lead_at` (the event) and `first_touch_at` (the text left, or "would send" when
  off) on the run. A new Overview tile kind shows a duration and its median.

## Build

1. Door to first text: `lead` event mapping on hooks, the first-text step on the spine (enroll
   plus `queueManual` plus sender nudge), the wider window for form leads, consent check.
   Integration test on synthetic data: hook post to text queued under 60 s with the switch on
   in the test, "would send" with it off.
2. Wait, Call now, follow-up sub-part, booking ends the run. The dial step calls voice's
   `placeCall` only when voice is configured.
3. The duration tile and the speed-to-lead page under Texts (runs, each step's state, first
   touch times). Shop entry goes from "In development" to ready.
4. Mark the part and its workflow ready in the catalog. Screenshots at 1440 and 390.

## Left out

- Installing it as a template on a client: the next build, with the template install for all
  funnels.
- Pushing lander and Meta lead forms into the door. The lander posts to a hook later (lander
  repo); Meta lead forms need a webhook subscription on the app, which is William's call.
- A per-client calendar: the booking link is a setting until calendars are per client.
- Live texts and calls: William turns them on per client.

## Decision log

- 2026-10-07: written from the end-goal order. Call step alerts a person until voice is set
  up, since voice setup is deferred to William's yes (`2026-10-06-voice-agent.md`). Form leads
  get an 8:00 to 21:00 daily window because they asked to be contacted; cold texts keep 10:00 to
  17:00 weekdays.
- 2026-10-07: built, steps 1 to 4 (20bae86, 081bace, 7bed582, and the step 4 commit).
  - Door: a hook has a field map (`hooks.fields`, `wren hooks add --field name=contact.full_name`).
    `Spine/hook` puts the lead on the event as `data.lead` (`packages/core/src/door.ts`).
  - First text (`sms.forms`, `speed.ts`): one `speed_runs` row per lead, the number enrolled under
    source kind `hook`, the text queued, the client's sender nudged. No consent or no phone: no
    text, straight to the call. Texts off or `WREN_SMS_LIVE` off: `would_send` with why, nothing
    queued. The first text must name the sender and say STOP (`mustUse`).
  - Window: form leads get 8:00 to 21:00 lead-local every day (`WREN_SMS_FORM_WINDOW`,
    `WREN_SMS_FORM_DAYS`), but the existing legal clamp still ends it at 20:00. Lifting that is
    William's call. The zone comes from the form, else both coasts.
  - Call (`voice.call_now`, `packages/voice/src/call-now.ts`): the worker passes no dialer, so
    every run shows "voice not set up" and Call now. A booking found first skips the call and ends
    the run. "Call now" lives on Texts > Speed to lead with a tap-to-call link, not an Inbox: the
    Inbox is inbound only. It has no Done action yet; the list grows.
  - Follow-up (`sms.follow_up`, part over cadence `follow_up.speed-to-lead`, day 1, 3, 7): driven
    by `SmsSender`'s sends like every text cadence. Stops on reply, STOP, a booking (by email
    only), or an active email sequence. The booking link is the texts setting `bookingLink`.
  - Metric: `lead_at`, `first_touch_at`; the `duration` record kind and a `median` stat make the
    Time to first text tile. Screenshots of the page, tile and Shop entry at 1440 and 390 on a
    throwaway database with synthetic leads.
  - Shop: `speed_to_lead` moved out of `planned.ts` into `packages/channel-sms/src/components.ts`,
    ready; `sms.forms` renamed First text and ready, so `speed_to_lead.steps` reads ready.
    `voice.dialer` and `voice.voicemail` stay planned, used by no workflow now.
  - Map: `sms/speed-run` (new), `sms/sms-contact`, `voice/call`, `platform/spine`,
    `platform/records`.
