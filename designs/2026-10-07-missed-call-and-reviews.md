# Missed-call text back and review requests (2026-10-07)

Items 3 and 4 of `2026-10-07-product-audit.md`. Both are templates in the Shop, off by default
per client. Both run on the spine and send through the client's texts, behind its sends switch
and approver. Nothing sends on prod until a client installs one, Wren approves it, and the
setup facts hold.

## Answer first

- Missed-call text back: when nobody picks up a call to the client's number (missed, busy or
  voicemail), the caller gets a text from that number within a minute. New callers and known
  contacts get different copy. A reply opens the thread in Texts. With speed to lead live, the
  reply also starts a speed-to-lead run, so the rep gets "Call now".
- Review requests: every customer is asked, by text or by email. Rating never decides who
  gets asked. The ask carries a counted link that sends them to Google's review form. One reminder goes out after
  3 days unless they opened the link. An optional private feedback line goes to everyone and
  is never a gate.
- Triggers: a call marked won, or met (not yet or not fit), enters review requests. Invoice
  paid and anything else come in through the template's door (`/hooks/<token>`). The Reviews
  page has an "Ask for a review" form.
- Needs setup: missed calls need `number.calls_routed`, which the call routing setup holds
  once Telnyx call events arrive for the number. Reviews need `google_business.place_id`,
  which the Google review link setup holds once the Place ID resolves. The client sends it,
  or Wren finds it on Google Maps from the business's name and address.
- Metrics in Texts > Overview: missed calls, texted back, callers who replied, callers who
  booked, review asks, review links opened. Reviews gained is "In development" until
  Google approves Business Profile API access.

## How a missed call flows

1. Telnyx posts `call.initiated/answered/bridged/hangup` to `/webhooks/telnyx/<client>`.
   `parseTelnyxEvent` reads only incoming calls. `applyCall` keeps one `sms_calls` row per call
   session and sets `result` at hangup: bridged means answered, `user_busy` means busy, picked
   up by the app alone means voicemail, anything else means missed.
2. An unanswered call is emitted into `missed_call.steps` (`in.calls`) with `onlyLive`. The
   spine drops it unless the client's install is live.
3. `sms.text_back` (`textBack` in `missed.ts`) checks, in order: hidden or non-US number,
   opt-out, already texted back within `hoursBetween` (24), caller in a running thread. With
   texts or sends off it records "would send". Otherwise it queues one `text_back` message
   from the called number, due now, and nudges the sender. Every outcome and its reason stay
   on the call row.
4. The sender delivers in the asked window: 8:00 to 20:00 on the caller's clock, every day
   (`policyFor`). A call at 21:30 gets its text at 8:00.
5. A reply runs `callReplied`: the call gets `replied_at` and the contact becomes "replied".
   If speed to lead is live, `runOfCall` opens a run (subject `call:<id>`) and emits it at
   `text.texted`. That gives the rep "Call now" without a second text. A booking sets
   `booked_at` on the call.

## How a review ask flows

1. A customer arrives at `reviews.steps` (`in.customers`) with name, phone and email. Call
   outcomes carry only an email, so the ask finds the phone on that person's text thread.
2. `reviews.ask` (`askReview` in `reviews.ts`) keeps one `review_asks` row per subject. The
   part's `via` setting picks text (the default) or email. A customer with only the other
   channel is asked on that one, and the row keeps `via`. It refuses with no Place ID, skips
   with no phone and no email, refuses on opt-out, an ended thread or an email suppression,
   and skips anyone asked within `daysBetween` (90) by phone or email. It records "would send"
   when sends are off. Otherwise it queues the `review-ask` text with
   `https://phone.wrenautomation.com/r/<client>/<token>`, plus the `review-feedback` line when
   that setting is on.
3. By email, the same link goes in `email:reviews/review-ask`, sent from portal@ under the
   client's name (the mailer payments and the client calendar use). The feedback line follows
   when on, then a stop line, with `List-Unsubscribe` one-click headers. `sent_at` marks the
   send, so a retry after a failed send sends once. No portal mailer or the client's sends off:
   "would send".
4. After the wire's 3-day wait, the same step with `round: 2` sends `review-reminder` on the
   ask's channel, but only if the ask was queued and the link is still unopened.
5. The phone Worker's `/r/<client>/<token>` calls `Reviews/click`. That counts the click and
   302s to `search.google.com/local/writereview?placeid=...`. Link previews (bot user agents)
   count nothing. `/r/.../feedback` serves a plain form whose words go to `Reviews/feedback`.
   `/r/.../stop` confirms on GET and on POST (or a mail client's one-click) adds an `opt_out`
   email suppression in the client's database.

## How the Place ID is found

Self-serve, the client adds the Google review link account under its Place ID. Done for you,
they add it under the business's name and address. The step's first round queues
`SetupAgent`, which runs the step's finder (`find: google_business.place`) instead of the
`do` agent. `findPlace` calls autobrowse `web GET /place` on the desk: Google Maps, signed
out. One match lands on the place's page, and the Place ID comes from Maps' own search
response. Many land on a list, and the first result whose name fits is taken. `agentDone`
makes the Place ID the account's ref and marks the fact. The setup's check then confirms
Google serves the review form. No match, or the Mac off: the step waits on Wren's team with
the reason, and the client step still works.

## Copy

Defaults in `packages/templates/defaults/sms/texts/`. The client edits them in Library.
The slot rules in `ANSWER_SLOTS` enforce what each must say.

| Key | Must say |
|---|---|
| `missed-call-new` | the sender's name, STOP |
| `missed-call-known` | none |
| `review-ask` | the review link, STOP |
| `review-reminder` | the review link |
| `review-feedback` | the feedback link |

Email defaults are in `packages/templates/defaults/email/reviews/` (`review-ask`,
`review-reminder`, `review-feedback`). Ask and reminder must carry `{review_link}`.

## Decisions

- Templates gate through `EmitRequest.onlyLive` on the spine emit. A trigger anywhere (call
  events, call outcomes) emits freely, and only live installs hear it. That keeps the trigger
  code free of install checks.
- Wren (client null) never enters these templates.
- A caller counts as opted in (`basis: opt_in`, source `call`). They called the number.
  STOP still applies.
- Review tokens are stored plain. A token can only count a click and open a public URL.
- Appointment done means a call marked not yet or not fit (source `done`). Won means won.
- Text-to-pay is not on main, so invoice paid has no direct trigger. The door takes
  `source: paid`.
- Copy keys use dashes so Shop labels read "Review ask text".

## Live

- Call routing: the Telnyx Call Control app `wren-calls` points both numbers at
  `phone.wrenautomation.com/webhooks/telnyx`. The setup check passes once a call event
  arrives.

## Not built

- Reviews gained: needs Google Business Profile API approval.
- Email-only customers through the door: the door's subject is `phone`, so a customer with
  only an email is refused there. Call outcomes and the by-hand form take an email.
- A per-client sender for review emails. They go from portal@ under the client's name.
