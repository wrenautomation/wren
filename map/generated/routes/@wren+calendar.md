# @wren/calendar: routes

Services: 3.

## Calendar (service)

File: packages/calendar/src/restate.ts

- **book** `BookRequest` → `BookingView & { manage: string; }` (serviceHandler)
- **booking** `{ token: string }` → `BookingView` (serviceHandler)
- **cancel** `{ token: string; reason?: string }` → `BookingView` (serviceHandler)
- **remind** `RemindRequest` → `{ sent: boolean; }` (serviceHandler)
- **reschedule** `{ token: string; start: string }` → `BookingView` (serviceHandler)
- **slots** `void` → `SlotsView` (serviceHandler)

## CalendarConsole (service via `portalService`)

File: packages/calendar/src/console.ts

- **cancel** `IdsRequest` → `{ cancelled: number; }` (serviceHandler)
- **clear** `IdsRequest` → `{ changed: number; done: (number | undefined)[]; }` (serviceHandler)
- **noShow** `IdsRequest` → `{ changed: number; done: (number | undefined)[]; }` (serviceHandler)
- **notFit** `IdsRequest` → `{ changed: number; done: (number | undefined)[]; }` (serviceHandler)
- **notYet** `IdsRequest` → `{ changed: number; done: (number | undefined)[]; }` (serviceHandler)
- **range** `RangeRequest` → `CalendarRange` (serviceHandler)
- **record** `PortalRequest` → `import("./recorder.js").RecorderState` (serviceHandler)
- **recorder** `PortalRequest` → `import("./recorder.js").RecorderState` (serviceHandler)
- **recordsExport** `PortalRequest & ExportAsk` → `import("@wren/core/records/serve").RecordsFile` (serviceHandler)
- **recordsGet** `PortalRequest & GetAsk` → `import("@wren/core/records/serve").RecordAnswer` (serviceHandler)
- **recordsList** `PortalRequest & ListAsk` → `import("@wren/core/records/serve").RecordsPage` (serviceHandler)
- **recordsStats** `PortalRequest & StatsAsk` → `import("@wren/core/records/serve").RecordsStat` (serviceHandler)
- **recordsTypes** `PortalRequest` → `import("@wren/core/records").RecordMeta[]` (serviceHandler)
- **stopRecording** `PortalRequest` → `import("./recorder.js").RecorderState` (serviceHandler)
- **won** `IdsRequest` → `{ changed: number; done: (number | undefined)[]; }` (serviceHandler)

## ClientCalendar (service)

File: packages/calendar/src/restate.ts

- **book** `z.infer<typeof CLIENT_BOOK>` → `BookingView & { manage: string; }` (serviceHandler)
- **booking** `{ client: string; token: string }` → `{ id: number; state: "booked" | "cancelled"; start: string; end: string; name: string; zone: string; title: string; offer: string | null; meetUrl: string | null; open: boolean; owner: string; mails: boolean; meet: boolean; contact: import("./contact.js").ContactLink[]; }` (serviceHandler)
- **cancel** `{ client: string; token: string; reason?: string }` → `BookingView` (serviceHandler)
- **remind** `RemindRequest` → `{ sent: boolean; }` (serviceHandler)
- **reschedule** `{ client: string; token: string; start: string }` → `BookingView` (serviceHandler)
- **slots** `{ client: string }` → `{ zone: string; length: number; title: string; slots: string[]; owner: string; mails: boolean; meet: boolean; contact: import("./contact.js").ContactLink[]; }` (serviceHandler)
