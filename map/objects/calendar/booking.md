---
type: object
cluster: calendar
universe: live
status: verified
verified: 2026-10-06 @ ef9e34c
entity: packages/calendar/src/schema.ts:46
---

# booking (calendar)

A call booked on our own calendar (designs/2026-10-06-calendar.md): table `calendar.bookings`, one row per call, booked on the lander's `/book/<offer>` page, moved or cancelled by its signed link. Product word: Calendar.

## Why this shape

Two people must never get one slot, so the slot is a partial unique index on `(calendar, start)` over booked rows (`schema.ts:80`), and `claim` takes it in a serializable transaction that also checks the open hours, the buffer around neighbours and the day's cap (`book.ts:64`). Google is not the source of truth: its event (with Meet, `sendUpdates=all`) is made after the row, and a Google or mail failure never undoes a booking (`restate.ts:116`). Every change is mirrored into `call_bookings` as uid `wren-<id>` through the same `applyBooking` cal.com's webhook uses, so follow-up stops, booked counts and attribution read one table (`book.ts:206`). Reminders are delayed Restate self-sends that check the call's start, so a moved call ignores its old ones (`restate.ts:174`). No new secret: the lander signs a booking with `EXPORT_TOKEN` and the manage token derives from it too (`links.ts:37`).

## Shape

- `calendar` (default `wren`), `state` (booked | cancelled), `start`, `end`, `name`, `email`, `zone` (the booker's), `offer`, `code` (the email's `r`), `application`, `source` jsonb (utm_*, ref, visitor, page), `google_event_id`, `meet_url`, `showed` (held | no_show), `reminded_day_at`, `reminded_hour_at`, `cancelled_*`, `reason` (`schema.ts:46`)
- view `calendar.booking_records` (`schema.ts:97`): status upcoming | past | held | no_show | cancelled; console record `calendar.booking` (`records.ts`), portal app `calendar`
- settings: Wren's `calendar.booking` block in `wren_settings` (`rules.ts`), set from the Shop part's Configure or `wren calendar settings`; owner account william@ by delegation on the full calendar scope (`google.ts:58`)
- services: `Calendar{slots,book,booking,reschedule,cancel}` + private `remind` (`restate.ts:255`), `CalendarConsole{held,noShow,clear,cancel}` (`console.ts`); bound at `apps/worker/src/services.ts:503`
- SMS: `CalendarBookings` (`sms.ts:11`) feeds SmsWatch's reminder pass beside cal.com's (`AllBookings`); the hour-before template is empty until written

Citations: `packages/calendar/src/schema.ts:80`, `packages/calendar/src/book.ts:64`, `packages/calendar/src/restate.ts:255`

## Connected to

- **owns:** the Google event and Meet link on the owner's calendar
- **joins:** [[email/call-booking]] (the mirror), [[platform/phone-worker]] (`/calendar/<handler>`), [[platform/records]]
- **looks-like-but-is-not:** `call_bookings` (every source's bookings, cal.com's too); `call_invites` (a reply's proposed slot)

## If you change this

- **Hits:** the lander (`../lander/functions/api/{slots,book,booking}.ts`, `functions/_shared/calendar.ts` signs `bookSig` the same way), the phone Worker's handler list, `call_bookings` via the mirror, SmsWatch reminders, `apps/portal/web/src/modules/calendar`
- **Does not hit:** cal.com's webhook path (`CallBookings/ingest`); the lander's `/api/calcom` Discord ping

## Surfaces

| Surface | Role |
|---|---|
| lander `/book/<offer>`, `/booking/<token>` | books, moves, cancels |
| Google Calendar (william@) | busy times in; events with Meet out |
| booker's inbox | confirmation, moved, cancelled, day and hour reminders from portal@ |
| portal Calendar app | reads; held, no-show, cancel |

## See

- Source: `packages/calendar/src/`
- Design: `designs/2026-10-06-calendar.md`
