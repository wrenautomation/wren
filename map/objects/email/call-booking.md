---
type: object
cluster: email
universe: live
status: verified
verified: 2026-10-04 @ 4beff56
entity: packages/channel-email/src/schema.ts:638
---

# call-booking

A call booked on Wren's cal.com, from its webhook or the catch-up list, or on our own calendar, mirrored as uid `wren-<id>` ([[calendar/booking]]). Table `call_bookings`, one row per booking uid.

## Why this shape

A lead who books from an email's link must stop getting mail, and the booking must count as a result, whether or not William answered a reply first (designs/2026-10-04-booking-webhook.md). The row matches its email by the link's `r` code (`messages.link_code`), else by the attendee's address; a matched booking stops the firm with stop reason `booked` (`packages/channel-email/src/inbox/bookings.ts:139`). A cancel only marks the row and never restarts a sequence. A reschedule moves the row to the new uid and time. An unmatched booking is still kept.

## Shape

- `uid` (unique), `state` (booked | cancelled), `start`, `email`, `name`, `offer`, `code`, `message_id`, `enrollment_id` (both nullable), `booked_at` (`schema.ts:638`)
- in: `CallBookings/ingest` (`restate/call-bookings.ts`), fed by the phone Worker's `/webhooks/calcom` (`apps/phone/src/worker.ts:114`); `wren email bookings sync [--since]` (`apps/cli/src/email.ts`)
- a client's cal.com: `CallBookings/ingestFor {client, body}` (`restate/call-bookings.ts:37`), same rules, into its database
- `call_invites` is the other source of "booked": a slot William approved from a reply

Citations: `packages/channel-email/src/schema.ts:638`, `packages/channel-email/src/inbox/bookings.ts:66`

## Connected to

- **owned-by:** [[email/enrollment]], [[email/message]] (by `link_code`)
- **joins:** [[platform/phone-worker]]
- **joins:** [[calendar/booking]] (writes here through `applyBooking`, `packages/calendar/src/book.ts:206`)
- **looks-like-but-is-not:** `call_invites` (a reply's proposed slot, booked through the API on William's approve)

## If you change this

- **Hits:** evolution's booked outcome (`evolve/stats.ts`); `books.econ_channels` booked stage (`packages/books/src/economics.ts`, skips enrollments `call_invites` already counts); `contact_outcomes` (booked = warm, never recycled, `views.ts`); console record `email.call` (`records.ts`) and the inbox Calls page
- **Does not hit:** the lander's own cal.com webhook (`../lander/functions/api/calcom.ts`); SMS reminders

## Surfaces

| Surface | Role |
|---|---|
| cal.com | posts webhooks; listed by sync |
| console inbox → Calls | reads |

## See

- Source: `packages/channel-email/src/inbox/bookings.ts`
