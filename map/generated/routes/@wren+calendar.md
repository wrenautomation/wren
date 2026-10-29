# @wren/calendar: routes

Services: 2.

## Calendar (service)

File: packages/calendar/src/restate.ts

- **book** `BookRequest` → `BookingView & { manage: string; }` (serviceHandler)
- **booking** `{ token: string }` → `BookingView` (serviceHandler)
- **cancel** `{ token: string; reason?: string }` → `BookingView` (serviceHandler)
- **remind** `RemindRequest` → `{ sent: boolean; }` (serviceHandler)
- **reschedule** `{ token: string; start: string }` → `BookingView` (serviceHandler)
- **slots** `void` → `SlotsView` (serviceHandler)

## ClientCalendar (service)

File: packages/calendar/src/restate.ts

- **book** `z.infer<typeof CLIENT_BOOK>` → `BookingView & { manage: string; }` (serviceHandler)
- **booking** `{ client: string; token: string }` → `{ id: number; state: "booked" | "cancelled"; start: string; end: string; name: string; zone: string; title: string; offer: string | null; meetUrl: string | null; open: boolean; owner: string; mails: boolean; meet: boolean; contact: import("./contact.js").ContactLink[]; }` (serviceHandler)
- **cancel** `{ client: string; token: string; reason?: string }` → `BookingView` (serviceHandler)
- **remind** `RemindRequest` → `{ sent: boolean; }` (serviceHandler)
- **reschedule** `{ client: string; token: string; start: string }` → `BookingView` (serviceHandler)
- **slots** `{ client: string }` → `{ zone: string; length: number; title: string; slots: string[]; owner: string; mails: boolean; meet: boolean; contact: import("./contact.js").ContactLink[]; }` (serviceHandler)
