---
type: object
cluster: calendar
universe: live
status: verified
verified: 2026-10-07 @ 29640d6
entity: packages/calendar/src/schema.ts:46
---

# booking (calendar)

A call booked on our own calendar (designs/2026-10-06-calendar.md): table `calendar.bookings`, one row per call, booked on the lander's `/book/<offer>` page (Wren) or a client's own booking page, moved or cancelled by its signed link. Product word: Calendar.

## Why this shape

Two people must never get one slot, so the slot is a partial unique index on `(calendar, start)` over booked rows (`schema.ts:75`), and `claim` takes it in a serializable transaction that also checks the open hours, the buffer around neighbours and the day's cap (`book.ts:103`). A loser gets 409 `SlotTaken`; both pages say "That time was just taken. Pick another.", reload the times in place and keep what was typed. Google's busy times are read before the transaction, so a Google event made in that same second can overlap (accepted). Google is not the source of truth: its event (with Meet, `sendUpdates=all`) is made after the row, and a Google or mail failure never undoes a booking (`restate.ts:116`). Every change is mirrored into `call_bookings` as uid `wren-<id>` through the same `applyBooking` cal.com's webhook uses, so follow-up stops, booked counts and attribution read one table (`book.ts:206`). Reminders are delayed Restate self-sends that check the call's start, so a moved call ignores its old ones (`restate.ts:174`). No new secret: the lander signs a booking with `EXPORT_TOKEN` and the manage token derives from it too (`links.ts:37`).

## Shape

- `calendar` (default `wren`), `state` (booked | cancelled), `start`, `end`, `name`, `email`, `zone` (the booker's), `offer`, `code` (the email's `r`), `application`, `source` jsonb (utm_*, ref, visitor, page), `google_event_id`, `meet_url`, `reminded_day_at`, `reminded_hour_at`, `cancelled_*`, `reason` (`schema.ts:46`)
- view `calendar.booking_records` (`schema.ts:91`): status cancelled, else the mirror's outcome (won | not_yet | no_show | not_fit), else upcoming | past; with `outcome_reason`, `marked_by`, `marked` from the mirror; console record `calendar.booking` (`records.ts`), portal app `calendar`
- how a call went lives on the mirror ([[email/call-booking]]), not here: `CalendarConsole.won|notYet|noShow|notFit|clear` map ids to `wren-<id>` and call `markOutcome` (`console.ts:50`); `book` and `reschedule` emit the mirror into `close` (`restate.ts:362`)
- settings: Wren's `calendar.booking` block in `wren_settings` (`rules.ts`), set from the Shop part's Configure or `wren calendar settings`; owner account william@ by delegation on the full calendar scope (`google.ts:58`). A client's block is in `clients.products`, edited on the part's page in the portal, even while it waits on its account. `account` is `wrenOnly` (never on a client's form); `contact` (email, phone, Instagram, X, LinkedIn; `contact.ts`) is `clientOnly`, its links under the times as "Or message me directly", the main block when no time is open. Wren's own links are the lander's `site.yaml` `contact`
- services: `Calendar{slots,book,booking,reschedule,cancel}` + private `remind` (`restate.ts:567`), `CalendarConsole{range,won,notYet,noShow,notFit,clear,cancel}` (`console.ts`; `range` feeds the portal Schedule); bound at `apps/worker/src/services.ts:503`
- per client: `ClientCalendar{slots,book,booking,reschedule,cancel}` + private `remind` (`restate.ts:714`) runs the same flows on the client's database and its connected `accounts.google_calendar`; `calendarOwner` (`restate.ts:656`) refuses a client without the part; `ownerDeps` (`restate.ts:675`) gates the invite and mails on the client's `sends` flag (off: no guest, `sendUpdates=none`, no mail); manage tokens scoped `manage:<client>:<id>` (`links.ts`). The page is the portal Worker's `bookRoute` (`apps/portal/src/book.ts`) serving `web/book.html` (`web/src/book.tsx`, the client's name on top), on the client's live domain or `/c/<client>/book` on the app host. `CalendarConsole` takes `client` (`console.ts:181`); its `range` also says the page's address, whether sends are on and whether Google is connected, shown above the client's Schedule
- SMS: `CalendarBookings` (`sms.ts:11`) feeds SmsWatch's reminder pass beside cal.com's (`AllBookings`); the hour-before template is empty until written

Citations: `packages/calendar/src/schema.ts:75`, `packages/calendar/src/book.ts:103`, `packages/calendar/src/restate.ts:567`

## Connected to

- **owns:** the Google event and Meet link on the owner's calendar
- **joins:** [[email/call-booking]] (the mirror), [[platform/phone-worker]] (`/calendar/<handler>`), [[platform/records]], the spine (Booking triggers)
- **looks-like-but-is-not:** `call_bookings` (every source's bookings, cal.com's too); `call_invites` (a reply's proposed slot)

## If you change this

- **Hits:** client booking pages (`apps/portal/src/book.ts`, `web/book.html`, `web/src/book.tsx`), the preview's in-process page (`apps/portal/scripts/preview.ts`), the client login's grants (`CLIENT_SCHEMAS`), the lander (`../lander/functions/api/{slots,book,booking}.ts`, `functions/_shared/calendar.ts` signs `bookSig` the same way), the phone Worker's handler list, `call_bookings` via the mirror, SmsWatch reminders, `apps/portal/web/src/modules/calendar`
- **Does not hit:** cal.com's webhook path (`CallBookings/ingest`); the lander's `/api/calcom` Discord ping

## Surfaces

| Surface | Role |
|---|---|
| lander `/book/<offer>`, `/booking/<token>` | books, moves, cancels; Wren's contact links from `site.yaml` |
| client host `/book/<tag>`, `/booking/<token>` (or app host `/c/<client>/...`) | a client's bookers book, move, cancel |
| Google Calendar (william@, or the client's connected account) | busy times in; events with Meet out |
| booker's inbox | confirmation, moved, cancelled, day and hour reminders from portal@ |
| portal Calendar app | Schedule (week/day/month/list over `range`), Calls list; Won, Not yet, No-show, Not a fit, cancel; the call's brief in the panel |

## See

- Source: `packages/calendar/src/`
- Design: `designs/2026-10-06-calendar.md`
