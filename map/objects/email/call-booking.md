---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-07 @ 2cdad29
entity: packages/channel-email/src/schema.ts:639
---

# call-booking

A call booked on Wren's cal.com, from its webhook or the catch-up list, or on our own calendar, mirrored as uid `wren-<id>` ([[calendar/booking]]). Table `call_bookings`, one row per booking uid.

## Why this shape

A lead who books from an email's link must stop getting mail, and the booking must count as a result, whether or not William answered a reply first (designs/2026-10-04-booking-webhook.md). The row matches its email by the link's `r` code (`messages.link_code`), else by the attendee's address; a matched booking stops the firm with stop reason `booked` (`packages/channel-email/src/inbox/bookings.ts:139`). A cancel only marks the row and never restarts a sequence. A reschedule moves the row to the new uid and time. An unmatched booking is still kept.

## Shape

- `uid` (unique), `state` (booked | cancelled), `start`, `email`, `name`, `offer`, `code`, `message_id`, `enrollment_id` (both nullable), `booked_at` (`schema.ts:639`)
- how the call went, for every source (our calendar's too, on its mirror): `outcome` (`MEETING_OUTCOMES` in `@wren/core/calls`: won, not_yet, no_show, not_fit, checked), `outcome_reason`, `outcome_at`, `outcome_by`. `setCallOutcome` marks only a booked call that has started (`calls/outcome.ts:36`); `markOutcome` audits it and emits `outcomeEmits` on the spine: won leaves `close` and enters `onboarding` (queue only), not_yet leaves by `later` to keep warm (`calls/outcome.ts:79`)
- every booking write emits `bookingEmit` into `close` at `in.calls`, one arrival per call and start (`calls/restate.ts:32`); its brief is [[email/call-brief]]
- in: `CallBookings/ingest` (`restate/call-bookings.ts`), fed by the phone Worker's `/webhooks/calcom` (`apps/phone/src/worker.ts:114`); `wren email bookings sync [--since]` (`apps/cli/src/email.ts`)
- a client's cal.com: `CallBookings/ingestFor {client, body}` (`restate/call-bookings.ts:37`), same rules, into its database
- each booking, move or cancel also fires the spine's Booking triggers (`bookingFired`, the `fire` dep; [[platform/spine]])
- `call_invites` is the other source of "booked": a slot William approved from a reply

Citations: `packages/channel-email/src/schema.ts:639`, `packages/channel-email/src/inbox/bookings.ts:66`, `packages/channel-email/src/calls/outcome.ts:36`

## Connected to

- **owned-by:** [[email/enrollment]], [[email/message]] (by `link_code`)
- **joins:** [[platform/phone-worker]]
- **joins:** [[calendar/booking]] (writes here through `applyBooking`, `packages/calendar/src/book.ts:206`)
- **owns:** [[email/call-brief]]
- **joins:** [[platform/spine]] (`close`, `onboarding`)
- **looks-like-but-is-not:** `call_invites` (a reply's proposed slot, booked through the API on William's approve)

## If you change this

- **Hits:** evolution's booked outcome (`evolve/stats.ts`); `books.econ_channels` booked stage (`packages/books/src/economics.ts`, skips enrollments `call_invites` already counts); `contact_outcomes` (booked = warm, never recycled, `views.ts`); console record `email.call` (`records.ts:253`, served by EmailConsole for a client with `calls.outcome`), Inbox > Calls and a client's Calls app (`apps/portal/web/src/modules/calls`), `calendar.booking_records` (reads the outcome through the mirror)
- **Does not hit:** the lander's own cal.com webhook (`../lander/functions/api/calcom.ts`); SMS reminders

## Surfaces

| Surface | Role |
|---|---|
| cal.com | posts webhooks; listed by sync |
| console inbox → Calls, client Calls app | reads; Won, Not yet, No-show, Not a fit (`EmailConsole.callWon` … `callClear`, `restate/console.ts:700`) |

## See

- Source: `packages/channel-email/src/inbox/bookings.ts`
