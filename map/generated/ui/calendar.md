# Calendar: app, wren workspace

Calls booked on your page, a brief before each, and how each went.

Sidebar: team: Tools.

Registered in `apps/portal/web/src/modules/calendar/index.ts`.

| Page | Template | Drawn in | Calls | For |
|---|---|---|---|---|
| Schedule | hand | `apps/portal/web/src/modules/calendar/schedule.tsx` | `CalendarConsole/range`, `CalendarConsole/recorder` | Your calls on a calendar, by day, week or month. |
| Overview | overview | `apps/portal/web/src/records.tsx` |  | Your calls at a glance. |
| Calls | list of `calendar.booking` | `apps/portal/web/src/records.tsx` | `calendar.booking_records` | Every booked call, past and coming up. |
| Recordings | list of `calendar.recording` | `apps/portal/web/src/records.tsx` | `public.call_bookings`, `public.call_recordings` | Calls recorded on the Mac, each with notes and a transcript. |
