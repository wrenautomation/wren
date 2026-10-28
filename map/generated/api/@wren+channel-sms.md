# @wren/channel-sms: interface

Exports: 338. Files: 42.

## packages/channel-sms/src/bookings.ts

- **Booking** (interface) `interface Booking { uid: string; start: Date; createdAt: Date; name: string | null; email: string; timeZone: string | null; application: string | null; }`
- **Bookings** (interface) `interface Bookings { name: string; booked(email: string): Promise<boolean>; upcoming(from: Date, to: Date): Promise<Booking[]>; }`
- **CalcomBookings** (class) `readonly name; constructor(source: string | BookingsQuery, fetchImpl: typeof fetch = globalThis.fetch); booked(email: string): Promise<boolean>; upcoming(from: Date, to: Date): Promise<Booking[]>; history(since: Date): Promise<CalcomBooking[]>`
- **FakeBookings** (class) `readonly name; readonly asked: string[]; constructor(private readonly emails: Iterable<string> = [], readonly calls: Booking[] = []); booked(email: string): Promise<boolean>; upcoming(from: Date, to: Date): Promise<Booking[]>`

## packages/channel-sms/src/classify.ts

- **buildPrompt** (function) `(s: ReplyState): string`
- **ground** (function) `(s: ReplyState, proposal: Proposal | null, why: string | null): Verdict`
- **classifyReplies** (function) `(db: Db, llm: LlmClient, opts: { limit?: number; runId?: string | null; now: Date }): Promise<ClassifyStats>`
- **labelReply** (function) `(db: Db, input: { messageId: number; disposition: Disposition; now: Date }): Promise<void>`
- **STAGE_NAME** (const) `"sms_reply_disposition"`
- **MIN_CONFIDENCE** (const) `0.6`
- **proposalSchema** (const) `z.ZodObject<{ disposition: z.ZodString; evidence: z.ZodOptional<z.ZodNullable<z.ZodString>>; confidence: z.ZodOptional<z.ZodNullable<z.ZodNumber>>; reason: z.ZodOptional<z.ZodNullable<z.ZodString>>; }, z.core.$strip>`
- **Proposal** (type) `type Proposal = z.infer<typeof proposalSchema>;`
- **Verdict** (interface) `interface Verdict { disposition: Disposition | null; grounded: boolean; reason: string; }`
- **ClassifyStats** (interface) `interface ClassifyStats { selected: number; labelled: number; ungrounded: number; optOuts: number; aborted: string | null; }`

## packages/channel-sms/src/clients.ts

- **clientSms** (function) `(main: Db, id: string): Promise<ClientSms>`
- **TEXTS** (const) `"sms.texts"`
- **REMINDERS** (const) `"sms.reminders"`
- **textsSettingsSchema** (const) `z.ZodObject<{ senderName: z.ZodDefault<z.ZodNullable<z.ZodString>>; campaignId: z.ZodDefault<z.ZodNullable<z.ZodString>>; bookingLink: z.ZodDefault<z.ZodNullable<z.ZodURL>>; }, z.core.$strict>`
- **remindersSettingsSchema** (const) `z.ZodObject<{}, z.core.$strict>`
- **ClientSms** (type) `type ClientSms = | { kind: "gone"; why: string } | { kind: "work"; client: Pick<Client, "id" | "database">; profile: string; senderName: string | null; campaignId: string | null; bookingLink: string | null; calcom: string | null; calendar: boolean; };`

## packages/channel-sms/src/components.ts

- **SPEED** (const) `"speed-to-lead"`
- **TOUCH** (const) `"sms.touch"`
- **FOLLOW_UP** (const) `"sms.follow_up"`
- **MISSED_CALL** (const) `"missed_call"`
- **TEXT_BACK** (const) `"sms.text_back"`
- **REVIEWS** (const) `"reviews"`
- **REVIEW_STEP** (const) `"reviews.ask"`
- **missedCallSettingsSchema** (const) `z.ZodObject<{ hoursBetween: z.ZodDefault<z.ZodNumber>; zone: z.ZodDefault<z.ZodNullable<z.ZodString>>; }, z.core.$strict>`
- **reviewsSettingsSchema** (const) `z.ZodObject<{ via: z.ZodDefault<z.ZodEnum<{ email: "email"; text: "text"; }>>; feedback: z.ZodDefault<z.ZodBoolean>; daysBetween: z.ZodDefault<z.ZodNumber>; }, z.core.$strict>`
- **SMS_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/channel-sms/src/console-routes.ts

- **SMS_CONSOLE_ROUTES** (const) `{ readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsGet: "read"; readonly recordsExport: "read"; readonly recordsStats: "read"; readonly reply: "act"; readonly callDone: "act"; readonly askReview: "act"; }`
- **SMS_CONSOLE_APPS** (const) `{ readonly "*": null; readonly reply: { readonly app: "texts"; readonly channel: "sms"; }; readonly callDone: { readonly app: "texts"; readonly channel: "sms"; }; readonly askReview: { readonly app: "texts"; readonly channel: "sms"; }; }`
- **SMS_CONSOLE_WRITES** (const) `readonly SmsConsoleRoute[]`

## packages/channel-sms/src/contacts.ts

- **addContact** (function) `(db: Queryable, input: { phone: string; basis: ContactBasis; why: string; niche?: string | null }): Promise<{ contact: SmsContact; created: boolean }>`
- **startThread** (function) `(db: Queryable, input: { phone: string; why: string; body: string; now: Date; policy: Pick<SmsPolicy, "monthlyPerContact">; }): Promise<{ contactId: number; messageId: number }>`

## packages/channel-sms/src/deliver.ts

- **reconcile** (function) `(db: Queryable, now: Date): Promise<number>`
- **skipQueued** (function) `(db: Queryable, contactId: number, why: string): Promise<number>`
- **endContact** (function) `(db: Queryable, contactId: number, state: SmsContact["state"], reason: string, now: Date): Promise<void>`
- **textedThisMonth** (function) `(db: Queryable, e164: string, now: Date): Promise<number>`
- **monthlyRoomAt** (function) `(db: Queryable, e164: string, policy: Pick<SmsPolicy, "monthlyPerContact">, now: Date): Promise<Date | null>`
- **tick** (function) `(db: Db, opts: TickOptions): Promise<TickStats>`
- **queueManual** (function) `(db: Queryable, input: { contactId: number; body: string; now: Date; policy: Pick<SmsPolicy, "monthlyPerContact">; kind?: "manual" | "pay" | "doc"; }): Promise<SmsMessage>`
- **STALE_SENDING_MS** (const) `number`
- **REMINDER_FRESH_MS** (const) `number`
- **TickOptions** (interface) `interface TickOptions { provider: SmsProvider; policy: SmsPolicy; live: boolean; sequences: ReadonlyMap<string, SmsSequence>; senderName: string; bookingLink?: string | null; linkSource?: string | null; now: Date; runId?: string | null; }`
- **TickStats** (interface) `interface TickStats { due: number; sent: number; failed: number; retried: number; unknown: number; skipped: number; outOfWindow: number; capped: number; gated: number; noCapacity: number; unreachable: number; reconciled: number; remainingToday: number; activeNumbers: number; stepped: Array<{ contactId: number; sequence: string; step: number }>; nextDue: string | null; }`

## packages/channel-sms/src/enroll.ts

- **enroll** (function) `(db: Db, opts: EnrollOptions): Promise<EnrollStats>`
- **EnrollOptions** (interface) `interface EnrollOptions { sequence: SmsSequence; policy: SmsPolicy; provider: SmsProvider; senderName: string; niche?: string | null; heldNiches: readonly string[]; contactIds?: readonly number[]; bookingLink?: string | null; limit: number; now: Date; runId?: string | null; }`
- **EnrollStats** (interface) `interface EnrollStats { considered: number; enrolled: number; lookedUp: number; notTextable: number; suppressed: number; companyBusy: number; leadBusy: number; noNumber: boolean; lookupErrors: string[]; }`

## packages/channel-sms/src/events.ts

- **classifyInbound** (function) `(text: string): { kind: InboundClass; disposition: Disposition | null; }`
- **callResult** (function) `(c: { bridgedAt: Date | null; answeredAt: Date | null }, cause: string | null): CallResult`
- **applyEvent** (function) `(db: Db, raw: unknown, event: SmsEvent, opts: ApplyOptions): Promise<ApplyResult>`

## packages/channel-sms/src/follow.ts

- **textCadence** (function) `(seq: SmsSequence): Workflow`
- **bookedRun** (function) `(db: Db, contactId: number, at: Date): Promise<void>`
- **touch** (function) `(db: Db, contactId: number, step: number, opts: TouchOptions): Promise<"queued" | "replied" | "booked" | "ended">`
- **textLead** (function) `(contactId: number): ExecutorEvent`
- **TouchTexts** (type) `type TouchTexts = Omit<TouchOptions, "now"> & { db: Db; main?: Queryable; off?: string | null; };`
- **touchStep** (function) `(textsFor: (client: string | null) => TouchTexts | Promise<TouchTexts>): Step`

## packages/channel-sms/src/form-after.ts

- **formEmail** (function) `(db: Db, runId: number, o: AfterOptions): Promise<EmailOutcome>`
- **formAfter** (function) `(db: Db, o: AfterOptions): Promise<AfterStats>`
- **whyNoText** (function) `(db: Queryable, run: SpeedRun, contact: SmsContact | null, policy: SmsPolicy, now: Date): Promise<string>`
- **noTextNotice** (function) `(db: Db, runId: number, o: Pick<AfterOptions, "notifier" | "policy" | "now">): Promise<"sent" | "not_yet" | "skipped">`
- **EMAIL_AFTER_MS** (const) `number`
- **NOTICE_AFTER_MS** (const) `number`
- **AfterOptions** (interface) `interface AfterOptions { send: SendMail | null; bookings: Bookings | null; senderName: string; notifier: Notifier | null; policy: SmsPolicy; site?: SiteSource | null; now: Date; }`
- **EmailOutcome** (type) `type EmailOutcome = "sent" | "booked" | "not_yet" | "skipped";`
- **AfterStats** (interface) `interface AfterStats { emailed: number; booked: number; noticed: number; errors: string[]; }`

## packages/channel-sms/src/form.ts

- **readApplication** (function) `(site: SiteSource, id: number): Promise<FormApplication | null>`
- **formBookingLink** (function) `(baseUrl: string, app: Pick<FormApplication, "id" | "offer">): string`
- **formStep** (function) `(db: Db, app: FormApplication, opts: FormOptions): Promise<FormOutcome>`
- **followUpForms** (function) `(db: Db, opts: FormOptions): Promise<FormStats>`
- **FIRST_TEXT_AFTER_MS** (const) `number`
- **FORM_WORKFLOW** (const) `"site.forms"`
- **formSubject** (function) `(id: number): string`
- **FORM_SEQUENCES** (const) `readonly SmsSequence[]`
- **SiteSource** (interface) `interface SiteSource { baseUrl: string; exportToken: string; fetch?: typeof fetch; }`
- **FormApplication** (interface) `interface FormApplication { id: number; ts: string; offer: string; name: string | null; email: string; phone: string | null; sms_consent: number; fit: number; page: string; }`
- **FormOptions** (interface) `interface FormOptions { site: SiteSource; bookings: Bookings | null; sequences: ReadonlyMap<string, SmsSequence>; policy: SmsPolicy; provider: SmsProvider; senderName: string; heldNiches: readonly string[]; countries?: readonly string[]; now: Date; runId?: string | null; }`
- **FormOutcome** (type) `type FormOutcome = | { kind: "no_consent" } | { kind: "no_phone"; why: string } | { kind: "done" } | { kind: "waiting"; due: Date } | { kind: "texted"; contactId: number } | { kind: "booked" } | { kind: "ended"; why: string } | { kind: "error"; why: string };`
- **FormStats** (interface) `interface FormStats { read: number; seeded: number; added: number; texted: number; booked: number; noPhone: number; ended: number; waiting: number; errors: string[]; }`
- **SEEDED** (const) `"applied before form texts were on: not texted"`

## packages/channel-sms/src/health.ts

- **checkHealth** (function) `(db: Queryable, opts: { now: Date; policy: HealthPolicy; provider?: SmsProvider | null; notifier?: Notifier | null; }): Promise<HealthReport>`
- **HealthPolicy** (interface) `interface HealthPolicy { windowDays: number; minSample: number; maxFailRate: number; maxNumberOptOutRate: number; maxFleetOptOutRate: number; minFleetSample: number; lowBalanceUsd: number; }`
- **DEFAULT_HEALTH** (const) `HealthPolicy`
- **HealthReport** (interface) `interface HealthReport { numbers: NumberHealth[]; fleet: { sent: number; texted: number; optOuts: number }; paused: { e164: string; reason: string }[]; balanceUsd: number | null; warnings: string[]; }`

## packages/channel-sms/src/keyed.ts

- **keyedProvider** (function) `(o: KeyedOptions): SmsProvider`
- **meteredProvider** (function) `(p: SmsProvider, main: Db, part = "sms.send"): SmsProvider`

## packages/channel-sms/src/lift.ts

- **liftPhones** (function) `(db: Db, opts: LiftOptions): Promise<LiftStats>`
- **LiftOptions** (interface) `interface LiftOptions { niche?: string | null; heldNiches: readonly string[]; batch?: number; limit?: number | null; onBatch?: (stats: LiftStats) => void | Promise<void>; }`
- **LiftStats** (interface) `interface LiftStats { read: number; added: number; tollFree: number; companies: number; }`

## packages/channel-sms/src/missed.ts

- **textBack** (function) `(db: Db, id: number, o: TextBackOptions): Promise<TextBack>`
- **callReplied** (function) `(db: Queryable, contactId: number, now: Date): Promise<{ id: number; callId: string; fromE164: string; toE164: string; numberId: string | null; startedAt: Date; answeredAt: Date | null; bridgedAt: Date | null; endedAt: Date | null; cause: string | null; result: "answered" | "voicemail" | "missed" | "busy" | null; known: boolean | null; contactId…`
- **runOfCall** (function) `(db: Queryable, workflow: string, call: SmsCall, now: Date): Promise<SpeedRun | null>`
- **TextBackOptions** (interface) `interface TextBackOptions { live: boolean; why: string | null; senderName: string; bookingLink: string | null; onceEvery: number; zone: string | null; now: Date; }`
- **missedCallEvent** (function) `(id: number): { subject: string; kind: "call"; data: { call: number; }; }`
- **textBackStep** (function) `(depsFor: (client: string | null) => Promise<TextBackDeps>): Step`

## packages/channel-sms/src/operator.ts

- **SmsNotifier** (class) `readonly name; constructor(private readonly db: Queryable, private readonly provider: SmsProvider, private readonly to: string, private readonly log: (line: string) => void = console.warn); notify(title: string, body = "", level: NotifyLevel = "info"): Promise<boolean>`

## packages/channel-sms/src/phone.ts

- **toPhoneE164** (function) `(raw: string, countries: readonly string[] = PHONE_COUNTRIES): string | null`
- **phoneCountry** (function) `(raw: string): string | null`
- **countryOf** (function) `(e164: string): PhoneCountry | null`
- **formatPhone** (function) `(e164: string): string`
- **E164** (const) `RegExp`
- **COUNTRY_ZONES** (const) `Readonly<Record<string, string>>`
- **zoneOfPhone** (function) `(e164: string): string | null`

## packages/channel-sms/src/policy.ts

- **policyFor** (function) `(source: SourceKind, policy: SmsPolicy, kind?: string, basis?: ContactBasis): SmsPolicy`
- **parseClock** (function) `(text: string): number`
- **inWindow** (function) `(zone: string | null, at: Date, policy: SmsPolicy): boolean`
- **nextOpen** (function) `(zone: string | null, from: Date, policy: SmsPolicy): Date | null`
- **fleetDay** (function) `(at: Date): string`
- **daysBetween** (function) `(from: string, to: string): number`
- **numberCapOn** (function) `(rampStartedOn: string, day: string, policy: SmsPolicy): number`
- **FLEET_ZONE** (const) `"America/New_York"`
- **LATEST_MINUTE** (const) `number`
- **SmsPolicy** (interface) `interface SmsPolicy { windowStartMinute: number; windowEndMinute: number; days: readonly number[]; dailyCap: number; monthlyPerContact: number; numberCap: number; rampStart: number; rampStep: number; rampEveryDays: number; gapSeconds: number; maxNumbers: number; bases: readonly ContactBasis[]; asked?: AskedWindow; }`
- **ASKED_WINDOW** (const) `AskedWindow`
- **ASKED** (const) `ReadonlySet<SourceKind>`
- **DEFAULT_POLICY** (const) `SmsPolicy`

## packages/channel-sms/src/pool.ts

- **poolToday** (function) `(db: Queryable, policy: SmsPolicy, now: Date): Promise<PoolToday>`
- **numberReady** (function) `(n: NumberToday, now: Date, policy: SmsPolicy): boolean`
- **wrongCountry** (function) `(number: Pick<SmsNumber, "country">, to: string): boolean`
- **cannotReach** (function) `(number: Pick<SmsNumber, "e164" | "country" | "registeredAt">, to: string): string | null`
- **pickSender** (function) `(db: Queryable, to: string): Promise<SmsNumber | null>`
- **pickNumber** (function) `(db: Queryable, country: PhoneCountry): Promise<SmsNumber | null>`
- **syncNumbers** (function) `(db: Queryable, provider: SmsProvider, policy: SmsPolicy, now: Date): Promise<SyncStats>`
- **pauseNumber** (function) `(db: Queryable, e164: string, reason: string, now: Date): Promise<boolean>`
- **resumeNumber** (function) `(db: Queryable, e164: string): Promise<boolean>`
- **numberByE164** (function) `(db: Queryable, e164: string): Promise<SmsNumber | null>`
- **SyncStats** (interface) `interface SyncStats { seen: number; added: string[]; retired: string[]; overCap: string[]; notUsOrCa: string[]; }`

## packages/channel-sms/src/provider.ts

- **callJson** (function) `(fetchImpl: typeof fetch, base: string, opts: { apiKey: string; timeoutMs?: number }, method: string, path: string, body: unknown, unparsed: (text: string) => unknown): Promise<{ status: number; json: unknown }>`
- **SendRequest** (interface) `interface SendRequest { from: string; to: string; text: string; }`
- **SendResult** (type) `type SendResult = | { ok: true; providerId: string; parts: number | null; costUsd: number | null; service?: Service | null; } | { ok: false; retry: false; code: string | null; detail: string; optedOut: boolean; } | { ok: false; retry: true; detail: string };`
- **LookupResult** (interface) `interface LookupResult { e164: string; lineType: LineType; carrier: string | null; raw: unknown; imessage?: boolean; }`
- **ProviderNumber** (interface) `interface ProviderNumber { e164: string; providerId: string; }`
- **DeliveryStatus** (type) `type DeliveryStatus = "sent" | "delivered" | "failed" | "unconfirmed";`
- **SmsEvent** (type) `type SmsEvent = | { kind: "status"; eventId: string; type: string; messageId: string; status: DeliveryStatus; at: Date; code: string | null; detail: string | null; parts: number | null; costUsd: number | null; service?: Service | null; } | { kind: "inbound"; eventId: string; type: string; messageId: string; from: string; to: string; text: string; at: Date; service?: Service | null; } | { kind: "call"; eventId: string; type: string; callId: string; stage: CallStage; from: string; to: string; at: Date; cause: string | null; } | { kind: "ignored"; eventId: string; type: string };`
- **CallStage** (type) `type CallStage = "ringing" | "answered" | "bridged" | "ended";`
- **SmsProvider** (interface) `interface SmsProvider { readonly name: string; send(req: SendRequest): Promise<SendResult>; lookup(e164: string): Promise<LookupResult>; listNumbers(): Promise<ProviderNumber[]>; balance(): Promise<number | null>; parseEvent(body: unknown): SmsEvent; readonly registration?: Registration; readonly keywordReplies?: KeywordReplies; }`
- **KeywordReplies** (interface) `interface KeywordReplies { set(keyword: Keyword, words: readonly string[], text: string | null): Promise<void>; }`
- **CampaignState** (interface) `interface CampaignState { status: "pending" | "approved" | "rejected"; raw: string; detail: string | null; }`
- **NumberAssignment** (interface) `interface NumberAssignment { status: "none" | "pending" | "assigned" | "failed"; campaignId: string | null; detail: string | null; }`
- **Registration** (interface) `interface Registration { campaign(campaignId: string): Promise<CampaignState>; number(e164: string): Promise<NumberAssignment>; assign(e164: string, campaignId: string): Promise<NumberAssignment>; }`
- **FakeRegistration** (class) `campaignState: CampaignState; readonly assignments; campaign(): Promise<CampaignState>; number(e164: string): Promise<NumberAssignment>; assign(e164: string, campaignId: string): Promise<NumberAssignment>; settle(): void`
- **FakeProvider** (class) `readonly name; readonly sent: (SendRequest &; readonly reject; readonly retry; readonly explode; readonly landlines; numbers: ProviderNumber[]; usd: number | null; readonly registration; readonly keywordReplies; send(req: SendRequest): Promise<SendResult>; lookup(e164: string): Promise<LookupResult>; listNumbers(): Promise<ProviderNumber[]>; balance(): Promise<number | null>; parseEvent(body: unknown): SmsEvent`
- **NoProvider** (class) `readonly name; send(): Promise<SendResult>; lookup(): Promise<LookupResult>; listNumbers(): Promise<ProviderNumber[]>; balance(): Promise<number | null>; parseEvent(): SmsEvent`

## packages/channel-sms/src/push.ts

- **subscribe** (function) `(db: Queryable, sub: PushSubscriptionInput, operator: string): Promise<void>`
- **unsubscribe** (function) `(db: Queryable, endpoint: string): Promise<boolean>`
- **pushOne** (function) `(db: Queryable, pusher: Pusher, endpoint: string, alert: PushAlert): Promise<{ pushed: boolean; error: string | null }>`
- **pushAll** (function) `(db: Queryable, pusher: Pusher, alert: PushAlert): Promise<PushStats>`
- **PushAlert** (interface) `interface PushAlert { title: string; body: string; url: string; tag: string; }`
- **Pusher** (interface) `interface Pusher { name: string; publicKey: string; push(sub: SmsPushSubscription, alert: PushAlert): Promise<"ok" | "gone">; }`
- **WebPusher** (class) `readonly name; readonly publicKey: string;; constructor(private readonly vapid: Vapid); push(sub: SmsPushSubscription, alert: PushAlert): Promise<"ok" | "gone">`
- **FakePusher** (class) `readonly name; readonly publicKey; readonly sent:; readonly gone; push(sub: SmsPushSubscription, alert: PushAlert): Promise<"ok" | "gone">`
- **PushSubscriptionInput** (interface) `interface PushSubscriptionInput { endpoint: string; keys: { p256dh: string; auth: string }; }`

## packages/channel-sms/src/records.ts

- **textCopyRecord** (function) `(sequences: Iterable<SmsSequence>, sender: string): import("@wren/core/records").RecordType`
- **threadRecord** (const) `import("@wren/core/records").RecordType`
- **reviewRecord** (const) `import("@wren/core/records").RecordType`
- **SMS_RECORDS** (const) `import("@wren/core/records").RecordType[]`
- **textContactRecord** (const) `import("@wren/core/records").RecordType`

## packages/channel-sms/src/refusal.ts

- **SmsRefusal** (class) `override name`

## packages/channel-sms/src/registration.ts

- **watchRegistration** (function) `(db: Queryable, provider: SmsProvider, campaignId: string | null, now: Date): Promise<RegistrationStats>`
- **RegistrationStats** (interface) `interface RegistrationStats { campaign: CampaignState | null; skipped: string | null; registered: string[]; asked: string[]; pending: string[]; failed: string[]; }`

## packages/channel-sms/src/reminders.ts

- **remindBookings** (function) `(db: Queryable, opts: ReminderOptions): Promise<ReminderStats>`
- **ReminderStats** (interface) `interface ReminderStats { calls: number; due: number; queued: number; already: number; bookedToday: number; outOfHours: number; empty: number; noConsent: number; ended: number; capped: number; unreachable: number; }`

## packages/channel-sms/src/restate/answers.ts

- **CallHooks** (interface) `interface CallHooks { missed(ctx: restate.Context, client: string | null, callId: number): void; replied(ctx: restate.Context, client: string | null, contactId: number): Promise<void>; }`
- **callHooks** (function) `(d: { main: Db; clientDb(id: string): Db }): CallHooks`
- **MISSED_FLOW** (const) `"missed_call.steps"`
- **makeReviews** (function) `(d: { main: Db; clientDb(id: string): Db }): restate.ServiceDefinition<"Reviews", { click: (ctx: restate.Context, req: z.infer<typeof CLICK>) => Promise<{ to: string | null; }>; feedback: (ctx: restate.Context, req: z.infer<typeof FEEDBACK>) => Promise<{ ok: boolean; }>; stop: (ctx: restate.Context, req: z.infer<typeof CLICK>) => Promise<{ ok:…`
- **REVIEWS_FLOW** (const) `"reviews.steps"`

## packages/channel-sms/src/restate/console.ts

- **makeSmsConsole** (function) `(deps: SmsConsoleDeps): restate.ServiceDefinition<"SmsConsole", { recordsTypes: (_: restate.Context, req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (_: restate.Context, req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (_: restate.…`
- **SmsConsoleService** (type) `type SmsConsoleService = ReturnType<typeof makeSmsConsole>;`
- **smsConsoleApi** (function) `({ db, open }: SmsConsoleDeps): { recordsTypes: (req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (req: PortalRequest & GetAsk) => Promise<import("@wren/core/records/serve").RecordAnswer>; r…`

## packages/channel-sms/src/restate/forms.ts

- **FORMS_SERVICE** (const) `{ readonly name: "SmsForms"; }`
- **makeSmsForms** (function) `(deps: SmsDeps): restate.ServiceDefinition<"SmsForms", { applied: (ctx: restate.Context, req: { application: number; }) => Promise<Stepped | null>; first: (ctx: restate.Context, req: FirstRequest) => Promise<Stepped>; email: (ctx: restate.Context, req: RunRequest) => Promise<EmailOutcome>; check: (ctx: restate.Conte…`
- **SmsFormsService** (type) `type SmsFormsService = ReturnType<typeof makeSmsForms>;`

## packages/channel-sms/src/restate/index.ts

- **senderDelayMs** (function) `(s: TickStats, gapSeconds: number, now: Date): number`
- **makeSmsSender** (function) `(wren: SmsDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<TickStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<TickStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) => P…`
- **makeSmsEvents** (function) `(deps: Pick< SmsDeps, "db" | "provider" | "notifier" | "pusher" | "clock" | "campaignId" | "clientDb" > & { fire?: FireTriggers; calls?: CallHooks; keys?: KeyStore | null; }): restate.ServiceDefinition<"SmsEvents", { signer: (ctx: restate.Context, req: { number?: string | null; client?: string | null; }) => Promise<Signer>; ingest: (ctx: restate.Context, body: unknown) => Promise<{ duplicate: boolean; outcome: string; }>; ingestFor: (ctx: restate.Context, req: { client: s…`
- **makeSmsDesk** (function) `(deps: SmsDeps): restate.ServiceDefinition<"SmsDesk", { threads: (ctx: restate.Context, req?: { filter?: ThreadFilter; limit?: number; offset?: number; } & ForClient) => Promise<ThreadSummary[]>; thread: (ctx: restate.Context, req: { contactId: number; } & ForClient) => Promise<Thread | null>; markRead: (ctx: restat…`
- **makeSmsWatch** (function) `(wren: SmsDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<WatchStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<WatchStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) =>…`
- **SENDER_KEY** (const) `"fleet"`
- **WATCH_KEY** (const) `"daily"`
- **SmsDeps** (interface) `interface SmsDeps { db: Db; provider: SmsProvider; policy: SmsPolicy; health: HealthPolicy; live: boolean; campaignId: string | null; sequences: ReadonlyMap<string, SmsSequence>; senderName: string; bookingLink?: string | null; heldNiches: readonly string[]; site?: SiteSource | null; formCountries?: readonly string[]; formMail?: SendMail | null; bookings?: Bookings | null; notifier?: Notifier; pusher?: Pusher | null; llm?: LlmClient | null; clock?: () => Date; forClient?: ((plan: Extract<ClientSms, { kind: "work" }>) => SmsDeps) | null; clientDb?: ((client: string) => Db) | null; }`
- **WatchStats** (interface) `interface WatchStats { registration: RegistrationStats; forms: FormStats | null; formsAfter: AfterStats | null; formsError?: string; reminders: ReminderStats | null; remindersError?: string; classify: ClassifyStats | null; health: Pick<HealthReport, "paused" | "warnings" | "balanceUsd" | "fleet">; summarized: string | null; }`
- **SmsSender** (type) `type SmsSender = ReturnType<typeof makeSmsSender>;`
- **SmsEventsService** (type) `type SmsEventsService = ReturnType<typeof makeSmsEvents>;`
- **SmsDeskService** (type) `type SmsDeskService = ReturnType<typeof makeSmsDesk>;`
- **SmsWatchObject** (type) `type SmsWatchObject = ReturnType<typeof makeSmsWatch>;`

## packages/channel-sms/src/reviews.ts

- **channelOf** (function) `(via: ReviewVia, phone: string | null, email: string | null): "email" | "text" | null`
- **askReview** (function) `(db: Db, c: Customer, o: AskOptions): Promise<ReviewAsk>`
- **remindReview** (function) `(db: Db, id: number, o: Pick< AskOptions, "live" | "why" | "senderName" | "feedback" | "client" | "origin" | "now" | "mail" >): Promise<ReviewAsk>`
- **clickReview** (function) `(db: Queryable, token: string, now: Date): Promise<string | null>`
- **saveFeedback** (function) `(db: Queryable, token: string, words: string, now: Date): Promise<boolean>`
- **stopReview** (function) `(db: Queryable, token: string, now: Date): Promise<boolean>`
- **sourceOf** (function) `(e: ExecutorEvent): ReviewSource`
- **placeIdOf** (function) `(main: Queryable, client: string): Promise<string | null>`
- **LINK_ORIGIN** (const) `"https://phone.wrenautomation.com"`
- **SendMail** (type) `type SendMail = (m: { to: string; subject: string; text: string; headers?: readonly (readonly [string, string])[]; }) => Promise<void>;`
- **cleanEmail** (function) `(raw: string | null | undefined): string | null`
- **newToken** (function) `(): string`
- **Customer** (interface) `interface Customer { subject: string; source: ReviewSource; name: string | null; phone: string | null; email: string | null; zone: string | null; }`
- **AskOptions** (interface) `interface AskOptions { live: boolean; why: string | null; senderName: string; placeId: string | null; via: ReviewVia; mail: MailOptions; feedback: boolean; onceEvery: number; client: string; origin: string; now: Date; }`
- **reviewStep** (function) `(depsFor: (client: string) => Promise<ReviewDeps>): Step`
- **handSubject** (function) `(id: string): string`

## packages/channel-sms/src/schema.ts

- **NUMBER_STATES** (const) `readonly ["active", "paused", "retired"]`
- **NumberState** (type) `type NumberState = (typeof NUMBER_STATES)[number];`
- **PHONE_COUNTRIES** (const) `readonly ["US", "CA"]`
- **PhoneCountry** (type) `type PhoneCountry = (typeof PHONE_COUNTRIES)[number];`
- **LINE_TYPES** (const) `readonly ["mobile", "landline", "voip", "toll_free", "unknown"]`
- **SERVICES** (const) `readonly ["imessage", "rcs", "sms"]`
- **Service** (type) `type Service = (typeof SERVICES)[number];`
- **LineType** (type) `type LineType = (typeof LINE_TYPES)[number];`
- **CONTACT_STATES** (const) `readonly ["new", "enrolled", "replied", "opted_out", "finished", "stopped", "unreachable"]`
- **ContactState** (type) `type ContactState = (typeof CONTACT_STATES)[number];`
- **CONTACT_BASES** (const) `readonly ["published", "opt_in"]`
- **ContactBasis** (type) `type ContactBasis = (typeof CONTACT_BASES)[number];`
- **SOURCE_KINDS** (const) `readonly ["tel_link", "page_text", "manual", "inbound", "form", "hook", "call", "customer"]`
- **SourceKind** (type) `type SourceKind = (typeof SOURCE_KINDS)[number];`
- **DIRECTIONS** (const) `readonly ["out", "in"]`
- **Direction** (type) `type Direction = (typeof DIRECTIONS)[number];`
- **MESSAGE_KINDS** (const) `readonly ["sequence", "manual", "reminder", "inbound", "follow_up", "text_back", "review", "pay", "doc", "broadcast"]`
- **ANSWER_KINDS** (const) `ReadonlySet<string>`
- **CONSENTED_KINDS** (const) `ReadonlySet<string>`
- **MessageKind** (type) `type MessageKind = (typeof MESSAGE_KINDS)[number];`
- **MESSAGE_STATES** (const) `readonly ["queued", "sending", "sent", "delivered", "failed", "unknown", "skipped", "received"]`
- **MessageState** (type) `type MessageState = (typeof MESSAGE_STATES)[number];`
- **DISPOSITIONS** (const) `readonly ["interested", "not_interested", "question", "wrong_person", "opt_out", "other"]`
- **Disposition** (type) `type Disposition = (typeof DISPOSITIONS)[number];`
- **DISPOSITION_SOURCES** (const) `readonly ["rule", "llm", "operator"]`
- **DispositionSource** (type) `type DispositionSource = (typeof DISPOSITION_SOURCES)[number];`
- **smsNumbers** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sms_numbers"; schema: undefined; columns: { e164: import("drizzle-orm/pg-core").PgColumn<{ name: "e164"; tableName: "sms_numbers"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: fals…`
- **smsContacts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sms_contacts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sms_contacts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **smsMessages** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sms_messages"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sms_messages"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **smsEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sms_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sms_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPri…`
- **smsPushSubscriptions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sms_push_subscriptions"; schema: undefined; columns: { endpoint: import("drizzle-orm/pg-core").PgColumn<{ name: "endpoint"; tableName: "sms_push_subscriptions"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notN…`
- **SmsNumber** (type) `type SmsNumber = typeof smsNumbers.$inferSelect;`
- **SmsContact** (type) `type SmsContact = typeof smsContacts.$inferSelect;`
- **NewSmsContact** (type) `type NewSmsContact = typeof smsContacts.$inferInsert;`
- **SmsMessage** (type) `type SmsMessage = typeof smsMessages.$inferSelect;`
- **SmsEventRow** (type) `type SmsEventRow = typeof smsEvents.$inferSelect;`
- **SmsPushSubscription** (type) `type SmsPushSubscription = typeof smsPushSubscriptions.$inferSelect;`
- **marketingTextContactRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_text_contact_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_text_contact_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; …`
- **FIRST_TOUCHES** (const) `readonly ["queued", "sent", "would_send", "no_consent", "no_phone", "refused", "booked"]`
- **FirstTouch** (type) `type FirstTouch = (typeof FIRST_TOUCHES)[number];`
- **SPEED_CALLS** (const) `readonly ["alerted", "dialed", "skipped"]`
- **SpeedCall** (type) `type SpeedCall = (typeof SPEED_CALLS)[number];`
- **CALL_OUTCOMES** (const) `readonly ["reached", "voicemail", "no_answer", "wrong_number"]`
- **CallOutcome** (type) `type CallOutcome = DialOutcome;`
- **speedRuns** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "speed_runs"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "speed_runs"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPri…`
- **SpeedRun** (type) `type SpeedRun = typeof speedRuns.$inferSelect;`
- **CALL_RESULTS** (const) `readonly ["answered", "missed", "busy", "voicemail"]`
- **CallResult** (type) `type CallResult = (typeof CALL_RESULTS)[number];`
- **ANSWER_STATES** (const) `readonly ["queued", "would_send", "skipped", "refused"]`
- **AnswerState** (type) `type AnswerState = (typeof ANSWER_STATES)[number];`
- **smsCalls** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sms_calls"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sms_calls"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrima…`
- **SmsCall** (type) `type SmsCall = typeof smsCalls.$inferSelect;`
- **REVIEW_SOURCES** (const) `readonly ["won", "done", "paid", "hand", "door"]`
- **ReviewSource** (type) `type ReviewSource = (typeof REVIEW_SOURCES)[number];`
- **REVIEW_VIA** (const) `readonly ["text", "email"]`
- **ReviewVia** (type) `type ReviewVia = (typeof REVIEW_VIA)[number];`
- **reviewAsks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "review_asks"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "review_asks"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **ReviewAsk** (type) `type ReviewAsk = typeof reviewAsks.$inferSelect;`

## packages/channel-sms/src/settings.ts

- **policyFrom** (function) `(s: Settings): SmsPolicy`
- **formCountriesFrom** (function) `(s: Pick<Settings, "smsFormCountries">): readonly string[]`
- **healthFrom** (function) `(s: Settings): HealthPolicy`
- **providerFrom** (function) `(s: Settings): SmsProvider`
- **pusherFrom** (function) `(s: Settings): Pusher | null`

## packages/channel-sms/src/setups.ts

- **findPlace** (function) `(sites: SiteClient, ref: string): Promise<{ ref: string | null; why: string }>`
- **answerChecks** (function) `(dbOf: (client: string | null) => Promise<Db>, get: typeof fetch): Record<string, SetupCheck>`
- **smsChecks** (function) `(main: Db, reg: Registration, wrenCampaign: string | null): Record<string, SetupCheck>`
- **PLACE_FINDER** (const) `"google_business.place"`
- **PlaceFound** (interface) `interface PlaceFound { placeId: string | null; name: string | null; address: string | null; via: "place" | "list" | "none"; }`
- **reviewUrl** (function) `(placeId: string): string`
- **SMS_SETUPS** (const) `import("@wren/core/setup").Setup[]`

## packages/channel-sms/src/speed.ts

- **firstText** (function) `(db: Db, r: { workflow: string; subject: string; lead: DoorLead; leadAt: Date }, t: Omit<SpeedTexts, "db" | "nudge">, now: Date): Promise<FirstText>`
- **SPEED_SEQUENCES** (const) `readonly SmsSequence[]`
- **firstTextStep** (function) `(textsFor: (client: string | null) => Promise<SpeedTexts>): Step`

## packages/channel-sms/src/stats.ts

- **rate** (function) `(k: number, n: number): Rate`
- **smsStats** (function) `(db: Queryable, opts: { since: Date; niche?: string | null }): Promise<SmsStats>`
- **Rate** (interface) `interface Rate { k: number; n: number; low: number; high: number; text: string; }`
- **StepRow** (interface) `interface StepRow { sequence: string | null; step: number | null; sent: number; delivered: number; failed: number; costUsd: number; }`
- **SmsStats** (interface) `interface SmsStats { since: string; steps: StepRow[]; contacts: Record<string, number>; texted: number; delivery: Rate; reply: Rate; interested: Rate; optOut: Rate; costUsd: number; costPerReplyUsd: number | null; speed: SpeedStats; }`

## packages/channel-sms/src/telnyx.ts

- **lineTypeOf** (function) `(type: string | null | undefined): LineType`
- **assignmentOf** (function) `(body: unknown): NumberAssignment`
- **campaignOf** (function) `(body: unknown): CampaignState`
- **parseTelnyxEvent** (function) `(body: unknown): SmsEvent`
- **TelnyxProvider** (class) `readonly name; constructor(private readonly opts: TelnyxOptions); send(req: SendRequest): Promise<SendResult>; lookup(e164: string): Promise<LookupResult>; listNumbers(): Promise<ProviderNumber[]>; balance(): Promise<number | null>; parseEvent(body: unknown): SmsEvent; readonly registration: Registration; readonly keywordReplies: KeywordReplies`

## packages/channel-sms/src/template-store.ts

- **slotsOf** (function) `(sequences: Iterable<SmsSequence>): TemplateSlot[]`
- **fieldsFor** (function) `(db: Queryable, contact: Pick<SmsContact, "companyId" | "personId" | "name"> & Partial<Pick<SmsContact, "bookingLink">>, sender: string, bookingLink: string | null = null): Promise<RenderFields>`
- **liveTexts** (function) `(db: Queryable, keys: readonly string[]): Promise<Map<string, Template>>`
- **listTemplates** (function) `(db: Queryable, slots: readonly TemplateSlot[], sender: string): Promise<SlotView[]>`
- **setTemplate** (function) `(db: Queryable, opts: { provider: SmsProvider; slots: readonly TemplateSlot[]; sender: string }, req: SetTemplate): Promise<SlotView>`
- **TEXTS_SYSTEM** (const) `"texts"`
- **textRef** (function) `(key: string): TemplateRef`
- **SlotView** (interface) `interface SlotView extends TemplateSlot { body: string; version: string | null; updatedAt: string | null; updatedBy: string | null; preview: string; segments: Segments | null; }`
- **SetTemplate** (interface) `interface SetTemplate { key: string; body: string; by: string; }`

## packages/channel-sms/src/templates.ts

- **sampleFields** (function) `(sender: string): RenderFields`
- **keywordOf** (function) `(key: string): Keyword | null`
- **stepKey** (function) `(sequence: string, step: number): string`
- **stepTemplate** (function) `(seq: SmsSequence, step: number): string`
- **sequenceSlots** (function) `(seq: SmsSequence): TemplateSlot[]`
- **checkSequence** (function) `(seq: SmsSequence): SmsSequence`
- **checkBody** (function) `(slot: TemplateSlot, body: string): string`
- **render** (function) `(tpl: Template, fields: RenderFields, seed: string): RenderedText`
- **firstName** (function) `(full: string | null | undefined): string | null`
- **segments** (function) `(text: string): Segments`
- **SmsSequence** (interface) `interface SmsSequence { name: string; label?: string; steps: readonly SmsStep[]; firstGoes?: string; fields?: readonly RenderField[]; namesSender?: boolean; }`
- **RenderFields** (interface) `interface RenderFields { first_name: string | null; company: string | null; sender: string; time: string | null; booking_link: string | null; review_link?: string | null; feedback_link?: string | null; }`
- **RenderField** (type) `type RenderField = keyof RenderFields;`
- **TemplateSlot** (interface) `interface TemplateSlot { key: string; purpose: string; goes?: string; fields: readonly RenderField[]; mustSayStop: boolean; mustUse?: readonly RenderField[]; minLength: number; }`
- **KEYWORDS** (const) `readonly ["help", "start", "stop"]`
- **Keyword** (type) `type Keyword = (typeof KEYWORDS)[number];`
- **KEYWORD_WORDS** (const) `Record<Keyword, readonly string[]>`
- **KEYWORD_SLOTS** (const) `readonly TemplateSlot[]`
- **DAY_BEFORE** (const) `"reminder.day-before"`
- **HOUR_BEFORE** (const) `"reminder.hour-before"`
- **REMINDER_SLOTS** (const) `readonly TemplateSlot[]`
- **ANSWER_SLOTS** (const) `readonly TemplateSlot[]`
- **preview** (function) `(source: string, fields: RenderFields): string`
- **textSeed** (function) `(contactId: number): string`
- **Segments** (interface) `interface Segments { encoding: "GSM-7" | "UCS-2"; units: number; parts: number; }`

## packages/channel-sms/src/threads.ts

- **listThreads** (function) `(db: Queryable, opts: { filter?: ThreadFilter; limit?: number; offset?: number } = {}): Promise<ThreadSummary[]>`
- **getThread** (function) `(db: Queryable, contactId: number, opts: { now: Date; cap: number }): Promise<Thread | null>`
- **markRead** (function) `(db: Queryable, contactId: number, now: Date): Promise<void>`
- **ThreadSummary** (interface) `interface ThreadSummary { contactId: number; e164: string; display: string; company: string | null; name: string | null; state: SmsContact["state"]; lastAt: string; lastBody: string; lastDirection: "in" | "out"; unread: number; disposition: string | null; }`
- **ThreadFilter** (type) `type ThreadFilter = "all" | "unread" | "replied";`
- **Thread** (interface) `interface Thread { contact: SmsContact & { display: string; company: string | null; companyDomain: string | null; fromNumber: string | null; }; messages: (Pick< SmsMessage, | "id" | "direction" | "kind" | "step" | "body" | "state" | "errorCode" | "detail" | "disposition" | "dispositionSource" | "service" > & { at: string })[]; month: { sent: number; cap: number }; }`

## packages/channel-sms/src/webhook.ts

- **SIGNATURE_HEADER** (const) `"telnyx-signature-ed25519"`
- **TIMESTAMP_HEADER** (const) `"telnyx-timestamp"`
- **verifyTelnyx** (function) `(input: { publicKey: string; signature: string | null; timestamp: string | null; rawBody: string; nowSeconds?: number; }): Promise<Verdict>`
- **signedFresh** (function) `(input: { signature: string | null; timestamp: string | null; nowSeconds?: number; }): Verdict`
- **ourNumber** (function) `(body: unknown): string | null`
- **verifyStandardWebhook** (function) `(input: { secret: string; id: string | null; signature: string | null; timestamp: string | null; rawBody: string; nowSeconds?: number; }): Promise<Verdict>`
- **Verdict** (type) `type Verdict = { ok: true } | { ok: false; reason: string };`
- **STANDARD_ID_HEADER** (const) `"webhook-id"`
- **STANDARD_TIMESTAMP_HEADER** (const) `"webhook-timestamp"`
- **STANDARD_SIGNATURE_HEADER** (const) `"webhook-signature"`

## packages/research/src/phones.ts

- **isTollFree** (function) `(e164: string): boolean`
- **toUsE164** (function) `(raw: string): string | null`
