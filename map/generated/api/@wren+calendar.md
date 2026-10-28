# @wren/calendar: interface

Exports: 80. Files: 15.

## packages/calendar/src/book.ts

- **bookedCalls** (function) `(db: Queryable, calendar: string, from: Date, to: Date, except?: number): Promise<Span[]>`
- **callsBetween** (function) `(db: Queryable, calendar: string, from: Date, to: Date): Promise<CallBlock[]>`
- **claim** (function) `(db: Db, o: { calendar: string; rules: Rules; start: Date; booker: Booker; now: Date; busy: readonly Span[]; }): Promise<CalendarBooking>`
- **heldBy** (function) `(db: Queryable, calendar: string, start: Date, email: string): Promise<CalendarBooking | null>`
- **bookingById** (function) `(db: Queryable, id: number): Promise<CalendarBooking | null>`
- **moveBooking** (function) `(db: Db, o: { id: number; rules: Rules; start: Date; now: Date; busy: readonly Span[] }): Promise<{ before: CalendarBooking; after: CalendarBooking }>`
- **cancelBooking** (function) `(db: Queryable, o: { id: number; by: string; reason: string | null; now: Date }): Promise<{ row: CalendarBooking; changed: boolean }>`
- **setEvent** (function) `(db: Queryable, id: number, made: { eventId: string; meetUrl: string | null }): Promise<void>`
- **mirror** (function) `(db: Db, row: CalendarBooking, change: BookingChange, now: Date): Promise<BookingOutcome>`
- **SlotTaken** (class) `constructor()`
- **Unchangeable** (class) ``
- **CallBlock** (interface) `interface CallBlock { id: number; start: Date; end: Date; name: string; offer: string | null; state: "booked" | "cancelled"; outcome: MeetingOutcome | null; meet: string | null; }`
- **Booker** (interface) `interface Booker { name: string; email: string; zone: string; offer: string | null; code: string | null; application: string | null; source: BookingSource; }`
- **mirrorUid** (function) `(id: number): string`

## packages/calendar/src/components.ts

- **CALENDAR_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/calendar/src/console-routes.ts

- **CALENDAR_CONSOLE_ROUTES** (const) `{ readonly range: "read"; readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsGet: "read"; readonly recordsExport: "read"; readonly recordsStats: "read"; readonly won: "act"; readonly notYet: "act"; readonly noShow: "act"; readonly notFit: "act"; readonly clear: "act"; reado…`
- **CALENDAR_CONSOLE_APPS** (const) `{ readonly "*": "calendar"; }`
- **CALENDAR_CONSOLE_WRITES** (const) `readonly (keyof typeof CALENDAR_CONSOLE_ROUTES)[]`

## packages/calendar/src/console.ts

- **rangeOf** (function) `(db: Db, calendar: string, settings: unknown, req: { from: string; to: string }): Promise<CalendarRange>`
- **calendarRecordsApi** (function) `(d: Pick<ClientCalendarDeps, "main" | "open" | "portal"> & { mailer?: unknown }): { installed: (req: PortalRequest) => Promise<{ name: string; id: string; accounts: Record<string, string>; sends: string[]; createdAt: Date; database: string; products: Record<string, unknown>; look: unknown; demo: boolean; setupMode: "self" | "for_you"; buysOk: boolean; approver: "client" | "wren" …`
- **makeCalendarConsole** (function) `(deps: CalendarConsoleDeps): restate.ServiceDefinition<"CalendarConsole", { range: (ctx: restate.Context, req: RangeRequest) => Promise<CalendarRange>; recordsTypes: (_: restate.Context, req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (_: restate.Context, req: PortalRequest & ListAsk) => …`
- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids: string[]; reason?: string | null; }`

## packages/calendar/src/google.ts

- **CALENDAR_SCOPE** (const) `"https://www.googleapis.com/auth/calendar"`
- **Made** (interface) `interface Made { eventId: string; meetUrl: string | null; }`
- **CalendarHost** (interface) `interface CalendarHost { readonly name: string; busy(account: string, from: Date, to: Date): Promise<Span[]>; create(account: string, event: NewEvent): Promise<Made>; move( account: string, eventId: string, start: Date, end: Date, zone: string, notify: boolean, ): Promise<Made>; remove(account: string, eventId: string, notify: boolean): Promise<void>; }`
- **eventIdOf** (function) `(id: number, createdAt: Date): string`
- **GoogleHost** (class) `readonly name; constructor(private readonly tokenFor: (account: string) => TokenSupplier, fetchImpl?: Fetch); busy(account: string, from: Date, to: Date): Promise<Span[]>; create(account: string, e: NewEvent): Promise<Made>; move(account: string, eventId: string, start: Date, end: Date, zone: string, notify: boolean): Promise<Made>; remove(account: string, eventId: string, notify: boolean): Promise<void>`
- **FakeHost** (class) `readonly name; readonly events; readonly log: string[]; down; constructor(public busyTimes: Span[] = []); busy(_account: string, from: Date, to: Date): Promise<Span[]>; create(account: string, e: NewEvent): Promise<Made>; move(_account: string, eventId: string, start: Date, end: Date, _zone: string, notify: boolean): Promise<Made>; remove(_account: string, eventId: string, notify: boolean): Promise<void>`

## packages/calendar/src/links.ts

- **bookSigned** (function) `(shared: string, sig: string, offer: string, start: string, email: string): boolean`
- **readManage** (function) `(shared: string, token: string, scope?: string): number | null`
- **bookSig** (function) `(shared: string, offer: string, start: string, email: string): string`
- **manageToken** (function) `(shared: string, id: number, scope?: string): string`
- **manageUrl** (function) `(site: string, shared: string, id: number, scope?: string): string`

## packages/calendar/src/mail.ts

- **mailFor** (function) `(kind: Kind, b: CalendarBooking, o: { title: string; manage: string; rebook: string | null; signer?: string; recorded?: boolean }): Mail`
- **Mail** (interface) `interface Mail { to: string; subject: string; text: string; }`
- **Kind** (type) `type Kind = "booked" | "moved" | "cancelled" | "day" | "hour";`
- **titleFor** (function) `(title: string, name: string): string`
- **RECORDED** (const) `"I record calls so I can keep good notes. If you'd rather I didn't, say so at the start."`

## packages/calendar/src/recorder.ts

- **askRecorder** (function) `(ctx: restate.Context, what: keyof RecorderCalls, by: string): Promise<RecorderState>`
- **RecorderState** (interface) `interface RecorderState { recording: boolean; since: string | null; booking: number | null; who: string | null; by: "desk" | "manual" | null; next: string | null; }`
- **RecorderCalls** (type) `type RecorderCalls = { status: (ctx: restate.Context, req: RecorderAsk) => Promise<RecorderState>; start: (ctx: restate.Context, req: RecorderAsk) => Promise<RecorderState>; stop: (ctx: restate.Context, req: RecorderAsk) => Promise<RecorderState>; };`

## packages/calendar/src/records.ts

- **RecordingDetail** (interface) `interface RecordingDetail { url: string | null; notes: CallNotes | null; model: string | null; segments: Segment[]; booking: number | null; }`
- **recordingRecord** (function) `(signGet?: (key: string) => Promise<string>): import("@wren/core/records").RecordType`
- **CALENDAR_RECORDS** (const) `import("@wren/core/records").RecordType[]`

## packages/calendar/src/restate.ts

- **calendarFlows** (function) `(deps: CalendarDeps): { rulesNow: (ctx: restate.Context) => Promise<import("./rules.js").Rules & { account: string | null; title: string; }>; shared: () => string; busyAround: (ctx: restate.Context, account: string | null, from: Date, to: Date) => Promise<Span[]>; mail: (ctx: restate.Context, kind: Kind, id: number, titl…`
- **makeCalendar** (function) `(deps: CalendarDeps): restate.ServiceDefinition<"Calendar", { slots: (ctx: restate.Context) => Promise<SlotsView>; book: (ctx: restate.Context, req: BookRequest) => Promise<BookingView & { manage: string; }>; booking: (ctx: restate.Context, req: { token: string; }) => Promise<BookingView>; reschedule: (ctx: restate.Conte…`
- **calendarOwner** (function) `(main: Db, portal: string, id: string): Promise<CalendarOwner>`
- **ownerDeps** (function) `(d: ClientCalendarDeps, o: CalendarOwner): CalendarDeps`
- **makeClientCalendar** (function) `(deps: ClientCalendarDeps): restate.ServiceDefinition<"ClientCalendar", { slots: (ctx: restate.Context, req: { client: string; }) => Promise<{ zone: string; length: number; title: string; slots: string[]; owner: string; mails: boolean; meet: boolean; contact: import("./contact.js").ContactLink[]; }>; book: (ctx: restate.Contex…`
- **SendMail** (type) `type SendMail = (m: { to: string; subject: string; text: string }) => Promise<void>;`
- **CalendarDeps** (interface) `interface CalendarDeps { db: Db; calendar: string; client?: string | null; settings: () => Promise<unknown>; host: CalendarHost | null; shared: string | null; site: string; send: SendMail | null; notify?: boolean; signer?: string; fire?: FireTriggers; leads?: { day: number; hour: number }; }`
- **Reminder** (type) `type Reminder = "day" | "hour";`
- **Calendar** (type) `type Calendar = ReturnType<typeof makeCalendar>;`
- **ClientCalendarDeps** (interface) `interface ClientCalendarDeps { main: Db; open: (client: Pick<Client, "id" | "database">) => Db; host: CalendarHost | null; shared: string | null; portal: string; mailer: ((from: string) => SendMail) | null; fire?: FireTriggers; leads?: { day: number; hour: number }; }`
- **bookingPage** (function) `(owner: CalendarOwner, d: CalendarDeps): { owner: string; mails: boolean; meet: boolean; contact: import("./contact.js").ContactLink[]; }`
- **ClientCalendar** (type) `type ClientCalendar = ReturnType<typeof makeClientCalendar>;`

## packages/calendar/src/rules.ts

- **parseHours** (function) `(text: string): Stretch[] | null`
- **rulesOf** (function) `(settings: unknown): Rules & { account: string | null; title: string }`
- **CALENDAR** (const) `"calendar.booking"`
- **DAYS** (const) `readonly ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]`
- **Day** (type) `type Day = (typeof DAYS)[number];`
- **Stretch** (interface) `interface Stretch { from: number; to: number; }`
- **calendarSettingsSchema** (const) `z.ZodObject<{ account: z.ZodOptional<z.ZodString>; zone: z.ZodDefault<z.ZodString>; title: z.ZodDefault<z.ZodString>; hours: z.ZodPrefault<z.ZodObject<{ mon: z.ZodDefault<z.ZodString>; tue: z.ZodDefault<z.ZodString>; wed: z.ZodDefault<z.ZodString>; thu: z.ZodDefault<z.ZodString>; fri: z.ZodDefault<z…`
- **CalendarSettings** (type) `type CalendarSettings = z.infer<typeof calendarSettingsSchema>;`
- **Rules** (interface) `interface Rules { zone: string; week: readonly (readonly Stretch[])[]; length: number; step: number; notice: number; buffer: number; perDay: number; days: number; }`

## packages/calendar/src/schema.ts

- **calendar** (const) `import("drizzle-orm/pg-core").PgSchema<"calendar">`
- **BOOKING_STATES** (const) `readonly ["booked", "cancelled"]`
- **BookingState** (type) `type BookingState = (typeof BOOKING_STATES)[number];`
- **BookingSource** (interface) `interface BookingSource { utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; ref?: string; visitor?: string; page?: string; }`
- **bookings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "bookings"; schema: "calendar"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "bookings"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimar…`
- **CalendarBooking** (type) `type CalendarBooking = typeof bookings.$inferSelect;`
- **bookingRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"booking_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "booking_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKe…`

## packages/calendar/src/setups.ts

- **calendarChecks** (function) `(host: CalendarHost): Record<string, SetupCheck>`

## packages/calendar/src/slots.ts

- **dayOn** (function) `(zone: string, at: Date): string`
- **openSlots** (function) `(rules: Rules, o: { from: Date; to: Date; now: Date; busy: readonly Span[]; calls: readonly Span[] }): Date[]`
- **openHours** (function) `(rules: Rules, from: Date, to: Date): Span[]`
- **isOpen** (function) `(rules: Rules, start: Date, o: { now: Date; busy: readonly Span[]; calls: readonly Span[] }): boolean`
- **Span** (interface) `interface Span { start: Date; end: Date; }`

## packages/calendar/src/sms.ts

- **CalendarBookings** (class) `readonly name; constructor(private readonly db: Queryable, private readonly calendar = "wren", private readonly now: () => Date = () => new Date()); booked(email: string): Promise<boolean>; upcoming(from: Date, to: Date): Promise<Booking[]>`
- **AllBookings** (class) `readonly name: string;; constructor(private readonly sources: readonly Bookings[]); booked(email: string): Promise<boolean>; upcoming(from: Date, to: Date): Promise<Booking[]>`
