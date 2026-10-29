# @wren/channel-sms: interface

Exports: 338. Files: 42.

## packages/channel-sms/src/bookings.ts

- **Booking** (interface) `interface Booking { uid: string; start: Date; createdAt: Date; name: string | null; email: string; timeZone: string | null; application: string | null; }`
- **Bookings** (interface) `interface Bookings { name: string; booked(email: string): Promise<boolean>; upcoming(from: Date, to: Date): Promise<Booking[]>; }`
- **CalcomBookings** (class) `readonly name; constructor(source: string | BookingsQuery, fetchImpl: typeof fetch = globalThis.fetch); booked(email: string): Promise<boolean>; upcoming(from: Date, to: Date): Promise<Booking[]>; history(since: Date): Promise<CalcomBooking[]>`
- **FakeBookings** (class) `readonly name; readonly asked: string[]; constructor(private readonly emails: Iterable<string> = [], readonly calls: Booking[] = []); booked(email: string): Promise<boolean>; upcoming(from: Date, to: Date): Promise<Booking[]>`

## packages/channel-sms/src/classify.ts

- **ClassifyStats** (interface) `interface ClassifyStats { selected: number; labelled: number; ungrounded: number; optOuts: number; aborted: string | null; }`
- **MIN_CONFIDENCE** (const) `0.6`
- **Proposal** (type) `type Proposal = z.infer<typeof proposalSchema>;`
- **STAGE_NAME** (const) `"sms_reply_disposition"`
- **Verdict** (interface) `interface Verdict { disposition: Disposition | null; grounded: boolean; reason: string; }`
- **buildPrompt** (function) `(s: ReplyState): string`
- **classifyReplies** (function) `(db: Db, llm: LlmClient, opts: { limit?: number; runId?: string | null; now: Date }): Promise<ClassifyStats>`
- **ground** (function) `(s: ReplyState, proposal: Proposal | null, why: string | null): Verdict`
- **labelReply** (function) `(db: Db, input: { messageId: number; disposition: Disposition; now: Date }): Promise<void>`
- **proposalSchema** (const) `z.ZodObject<{ disposition: z.ZodString; evidence: z.ZodOptional<z.ZodNullable<z.ZodString>>; confidence: z.ZodOptional<z.ZodNullable<z.ZodNumber>>; reason: z.ZodOptional<z.ZodNullable<z.ZodString>>; }, z.core.$strip>`

## packages/channel-sms/src/clients.ts

- **ClientSms** (type) `type ClientSms = | { kind: "gone"; why: string } | { kind: "work"; client: Pick<Client, "id" | "database">; profile: string; senderName: string | null; campaignId: string | null; bookingLink: string | null; calcom: string | null; calendar: boolean; };`
- **REMINDERS** (const) `"sms.reminders"`
- **TEXTS** (const) `"sms.texts"`
- **clientSms** (function) `(main: Db, id: string): Promise<ClientSms>`
- **remindersSettingsSchema** (const) `z.ZodObject<{}, z.core.$strict>`
- **textsSettingsSchema** (const) `z.ZodObject<{ senderName: z.ZodDefault<z.ZodNullable<z.ZodString>>; campaignId: z.ZodDefault<z.ZodNullable<z.ZodString>>; bookingLink: z.ZodDefault<z.ZodNullable<z.ZodURL>>; }, z.core.$strict>`

## packages/channel-sms/src/components.ts

- **FOLLOW_UP** (const) `"sms.follow_up"`
- **MISSED_CALL** (const) `"missed_call"`
- **REVIEWS** (const) `"reviews"`
- **REVIEW_STEP** (const) `"reviews.ask"`
- **SMS_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **SPEED** (const) `"speed-to-lead"`
- **TEXT_BACK** (const) `"sms.text_back"`
- **TOUCH** (const) `"sms.touch"`
- **missedCallSettingsSchema** (const) `z.ZodObject<{ hoursBetween: z.ZodDefault<z.ZodNumber>; zone: z.ZodDefault<z.ZodNullable<z.ZodString>>; }, z.core.$strict>`
- **reviewsSettingsSchema** (const) `z.ZodObject<{ via: z.ZodDefault<z.ZodEnum<{ email: "email"; text: "text"; }>>; feedback: z.ZodDefault<z.ZodBoolean>; daysBetween: z.ZodDefault<z.ZodNumber>; }, z.core.$strict>`

## packages/channel-sms/src/console-routes.ts

- **SMS_CONSOLE_APPS** (const) `{ readonly "*": null; readonly reply: { readonly app: "texts"; readonly channel: "sms"; }; readonly callDone: { readonly app: "texts"; readonly channel: "sms"; }; readonly askReview: { readonly app: "texts"; readonly channel: "sms"; }; }`
- **SMS_CONSOLE_ROUTES** (const) `{ readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsGet: "read"; readonly recordsExport: "read"; readonly recordsStats: "read"; readonly reply: "act"; readonly callDone: "act"; readonly askReview: "act"; }`
- **SMS_CONSOLE_WRITES** (const) `readonly SmsConsoleRoute[]`

## packages/channel-sms/src/contacts.ts

- **addContact** (function) `(db: Queryable, input: { phone: string; basis: ContactBasis; why: string; niche?: string | null }): Promise<{ contact: SmsContact; created: boolean }>`
- **startThread** (function) `(db: Queryable, input: { phone: string; why: string; body: string; now: Date; policy: Pick<SmsPolicy, "monthlyPerContact">; }): Promise<{ contactId: number; messageId: number }>`

## packages/channel-sms/src/deliver.ts

- **REMINDER_FRESH_MS** (const) `number`
- **STALE_SENDING_MS** (const) `number`
- **TickOptions** (interface) `interface TickOptions { provider: SmsProvider; policy: SmsPolicy; live: boolean; sequences: ReadonlyMap<string, SmsSequence>; senderName: string; bookingLink?: string | null; linkSource?: string | null; now: Date; runId?: string | null; }`
- **TickStats** (interface) `interface TickStats { due: number; sent: number; failed: number; retried: number; unknown: number; skipped: number; outOfWindow: number; capped: number; gated: number; noCapacity: number; unreachable: number; reconciled: number; remainingToday: number; activeNumbers: number; stepped: Array<{ contactId: number; sequence: string; step: number }>; nextDue: string | null; }`
- **endContact** (function) `(db: Queryable, contactId: number, state: SmsContact["state"], reason: string, now: Date): Promise<void>`
- **monthlyRoomAt** (function) `(db: Queryable, e164: string, policy: Pick<SmsPolicy, "monthlyPerContact">, now: Date): Promise<Date | null>`
- **queueManual** (function) `(db: Queryable, input: { contactId: number; body: string; now: Date; policy: Pick<SmsPolicy, "monthlyPerContact">; kind?: "manual" | "pay" | "doc"; }): Promise<SmsMessage>`
- **reconcile** (function) `(db: Queryable, now: Date): Promise<number>`
- **skipQueued** (function) `(db: Queryable, contactId: number, why: string): Promise<number>`
- **textedThisMonth** (function) `(db: Queryable, e164: string, now: Date): Promise<number>`
- **tick** (function) `(db: Db, opts: TickOptions): Promise<TickStats>`

## packages/channel-sms/src/enroll.ts

- **EnrollOptions** (interface) `interface EnrollOptions { sequence: SmsSequence; policy: SmsPolicy; provider: SmsProvider; senderName: string; niche?: string | null; heldNiches: readonly string[]; contactIds?: readonly number[]; bookingLink?: string | null; limit: number; now: Date; runId?: string | null; }`
- **EnrollStats** (interface) `interface EnrollStats { considered: number; enrolled: number; lookedUp: number; notTextable: number; suppressed: number; companyBusy: number; leadBusy: number; noNumber: boolean; lookupErrors: string[]; }`
- **enroll** (function) `(db: Db, opts: EnrollOptions): Promise<EnrollStats>`

## packages/channel-sms/src/events.ts

- **applyEvent** (function) `(db: Db, raw: unknown, event: SmsEvent, opts: ApplyOptions): Promise<ApplyResult>`
- **callResult** (function) `(c: { bridgedAt: Date | null; answeredAt: Date | null }, cause: string | null): CallResult`
- **classifyInbound** (function) `(text: string): { kind: InboundClass; disposition: Disposition | null; }`

## packages/channel-sms/src/follow.ts

- **TouchTexts** (type) `type TouchTexts = Omit<TouchOptions, "now"> & { db: Db; main?: Queryable; off?: string | null; };`
- **bookedRun** (function) `(db: Db, contactId: number, at: Date): Promise<void>`
- **textCadence** (function) `(seq: SmsSequence): Workflow`
- **textLead** (function) `(contactId: number): ExecutorEvent`
- **touch** (function) `(db: Db, contactId: number, step: number, opts: TouchOptions): Promise<"queued" | "replied" | "booked" | "ended">`
- **touchStep** (function) `(textsFor: (client: string | null) => TouchTexts | Promise<TouchTexts>): Step`

## packages/channel-sms/src/form-after.ts

- **AfterOptions** (interface) `interface AfterOptions { send: SendMail | null; bookings: Bookings | null; senderName: string; notifier: Notifier | null; policy: SmsPolicy; site?: SiteSource | null; now: Date; }`
- **AfterStats** (interface) `interface AfterStats { emailed: number; booked: number; noticed: number; errors: string[]; }`
- **EMAIL_AFTER_MS** (const) `number`
- **EmailOutcome** (type) `type EmailOutcome = "sent" | "booked" | "not_yet" | "skipped";`
- **NOTICE_AFTER_MS** (const) `number`
- **formAfter** (function) `(db: Db, o: AfterOptions): Promise<AfterStats>`
- **formEmail** (function) `(db: Db, runId: number, o: AfterOptions): Promise<EmailOutcome>`
- **noTextNotice** (function) `(db: Db, runId: number, o: Pick<AfterOptions, "notifier" | "policy" | "now">): Promise<"sent" | "not_yet" | "skipped">`
- **whyNoText** (function) `(db: Queryable, run: SpeedRun, contact: SmsContact | null, policy: SmsPolicy, now: Date): Promise<string>`

## packages/channel-sms/src/form.ts

- **FIRST_TEXT_AFTER_MS** (const) `number`
- **FORM_SEQUENCES** (const) `readonly SmsSequence[]`
- **FORM_WORKFLOW** (const) `"site.forms"`
- **FormApplication** (interface) `interface FormApplication { id: number; ts: string; offer: string; name: string | null; email: string; phone: string | null; sms_consent: number; fit: number; page: string; }`
- **FormOptions** (interface) `interface FormOptions { site: SiteSource; bookings: Bookings | null; sequences: ReadonlyMap<string, SmsSequence>; policy: SmsPolicy; provider: SmsProvider; senderName: string; heldNiches: readonly string[]; countries?: readonly string[]; now: Date; runId?: string | null; }`
- **FormOutcome** (type) `type FormOutcome = | { kind: "no_consent" } | { kind: "no_phone"; why: string } | { kind: "done" } | { kind: "waiting"; due: Date } | { kind: "texted"; contactId: number } | { kind: "booked" } | { kind: "ended"; why: string } | { kind: "error"; why: string };`
- **FormStats** (interface) `interface FormStats { read: number; seeded: number; added: number; texted: number; booked: number; noPhone: number; ended: number; waiting: number; errors: string[]; }`
- **SEEDED** (const) `"applied before form texts were on: not texted"`
- **SiteSource** (interface) `interface SiteSource { baseUrl: string; exportToken: string; fetch?: typeof fetch; }`
- **followUpForms** (function) `(db: Db, opts: FormOptions): Promise<FormStats>`
- **formBookingLink** (function) `(baseUrl: string, app: Pick<FormApplication, "id" | "offer">): string`
- **formStep** (function) `(db: Db, app: FormApplication, opts: FormOptions): Promise<FormOutcome>`
- **formSubject** (function) `(id: number): string`
- **readApplication** (function) `(site: SiteSource, id: number): Promise<FormApplication | null>`

## packages/channel-sms/src/health.ts

- **DEFAULT_HEALTH** (const) `HealthPolicy`
- **HealthPolicy** (interface) `interface HealthPolicy { windowDays: number; minSample: number; maxFailRate: number; maxNumberOptOutRate: number; maxFleetOptOutRate: number; minFleetSample: number; lowBalanceUsd: number; }`
- **HealthReport** (interface) `interface HealthReport { numbers: NumberHealth[]; fleet: { sent: number; texted: number; optOuts: number }; paused: { e164: string; reason: string }[]; balanceUsd: number | null; warnings: string[]; }`
- **checkHealth** (function) `(db: Queryable, opts: { now: Date; policy: HealthPolicy; provider?: SmsProvider | null; notifier?: Notifier | null; }): Promise<HealthReport>`

## packages/channel-sms/src/keyed.ts

- **keyedProvider** (function) `(o: KeyedOptions): SmsProvider`
- **meteredProvider** (function) `(p: SmsProvider, main: Db, part = "sms.send"): SmsProvider`

## packages/channel-sms/src/lift.ts

- **LiftOptions** (interface) `interface LiftOptions { niche?: string | null; heldNiches: readonly string[]; batch?: number; limit?: number | null; onBatch?: (stats: LiftStats) => void | Promise<void>; }`
- **LiftStats** (interface) `interface LiftStats { read: number; added: number; tollFree: number; companies: number; }`
- **liftPhones** (function) `(db: Db, opts: LiftOptions): Promise<LiftStats>`

## packages/channel-sms/src/missed.ts

- **TextBackOptions** (interface) `interface TextBackOptions { live: boolean; why: string | null; senderName: string; bookingLink: string | null; onceEvery: number; zone: string | null; now: Date; }`
- **callReplied** (function) `(db: Queryable, contactId: number, now: Date): Promise<{ id: number; callId: string; fromE164: string; toE164: string; numberId: string | null; startedAt: Date; answeredAt: Date | null; bridgedAt: Date | null; endedAt: Date | null; cause: string | null; result: "answered" | "voicemail" | "missed" | "busy" | null; known: boolean | null; contactId…`
- **missedCallEvent** (function) `(id: number): { subject: string; kind: "call"; data: { call: number; }; }`
- **runOfCall** (function) `(db: Queryable, workflow: string, call: SmsCall, now: Date): Promise<SpeedRun | null>`
- **textBack** (function) `(db: Db, id: number, o: TextBackOptions): Promise<TextBack>`
- **textBackStep** (function) `(depsFor: (client: string | null) => Promise<TextBackDeps>): Step`

## packages/channel-sms/src/operator.ts

- **SmsNotifier** (class) `readonly name; constructor(private readonly db: Queryable, private readonly provider: SmsProvider, private readonly to: string, private readonly log: (line: string) => void = console.warn); notify(title: string, body = "", level: NotifyLevel = "info"): Promise<boolean>`

## packages/channel-sms/src/phone.ts

- **COUNTRY_ZONES** (const) `Readonly<Record<string, string>>`
- **E164** (const) `RegExp`
- **countryOf** (function) `(e164: string): PhoneCountry | null`
- **formatPhone** (function) `(e164: string): string`
- **phoneCountry** (function) `(raw: string): string | null`
- **toPhoneE164** (function) `(raw: string, countries: readonly string[] = PHONE_COUNTRIES): string | null`
- **zoneOfPhone** (function) `(e164: string): string | null`

## packages/channel-sms/src/policy.ts

- **ASKED** (const) `ReadonlySet<SourceKind>`
- **ASKED_WINDOW** (const) `AskedWindow`
- **DEFAULT_POLICY** (const) `SmsPolicy`
- **FLEET_ZONE** (const) `"America/New_York"`
- **LATEST_MINUTE** (const) `number`
- **SmsPolicy** (interface) `interface SmsPolicy { windowStartMinute: number; windowEndMinute: number; days: readonly number[]; dailyCap: number; monthlyPerContact: number; numberCap: number; rampStart: number; rampStep: number; rampEveryDays: number; gapSeconds: number; maxNumbers: number; bases: readonly ContactBasis[]; asked?: AskedWindow; }`
- **daysBetween** (function) `(from: string, to: string): number`
- **fleetDay** (function) `(at: Date): string`
- **inWindow** (function) `(zone: string | null, at: Date, policy: SmsPolicy): boolean`
- **nextOpen** (function) `(zone: string | null, from: Date, policy: SmsPolicy): Date | null`
- **numberCapOn** (function) `(rampStartedOn: string, day: string, policy: SmsPolicy): number`
- **parseClock** (function) `(text: string): number`
- **policyFor** (function) `(source: SourceKind, policy: SmsPolicy, kind?: string, basis?: ContactBasis): SmsPolicy`

## packages/channel-sms/src/pool.ts

- **SyncStats** (interface) `interface SyncStats { seen: number; added: string[]; retired: string[]; overCap: string[]; notUsOrCa: string[]; }`
- **cannotReach** (function) `(number: Pick<SmsNumber, "e164" | "country" | "registeredAt">, to: string): string | null`
- **numberByE164** (function) `(db: Queryable, e164: string): Promise<SmsNumber | null>`
- **numberReady** (function) `(n: NumberToday, now: Date, policy: SmsPolicy): boolean`
- **pauseNumber** (function) `(db: Queryable, e164: string, reason: string, now: Date): Promise<boolean>`
- **pickNumber** (function) `(db: Queryable, country: PhoneCountry): Promise<SmsNumber | null>`
- **pickSender** (function) `(db: Queryable, to: string): Promise<SmsNumber | null>`
- **poolToday** (function) `(db: Queryable, policy: SmsPolicy, now: Date): Promise<PoolToday>`
- **resumeNumber** (function) `(db: Queryable, e164: string): Promise<boolean>`
- **syncNumbers** (function) `(db: Queryable, provider: SmsProvider, policy: SmsPolicy, now: Date): Promise<SyncStats>`
- **wrongCountry** (function) `(number: Pick<SmsNumber, "country">, to: string): boolean`

## packages/channel-sms/src/provider.ts

- **CallStage** (type) `type CallStage = "ringing" | "answered" | "bridged" | "ended";`
- **CampaignState** (interface) `interface CampaignState { status: "pending" | "approved" | "rejected"; raw: string; detail: string | null; }`
- **DeliveryStatus** (type) `type DeliveryStatus = "sent" | "delivered" | "failed" | "unconfirmed";`
- **FakeProvider** (class) `readonly name; readonly sent: (SendRequest &; readonly reject; readonly retry; readonly explode; readonly landlines; numbers: ProviderNumber[]; usd: number | null; readonly registration; readonly keywordReplies; send(req: SendRequest): Promise<SendResult>; lookup(e164: string): Promise<LookupResult>; listNumbers(): Promise<ProviderNumber[]>; balance(): Promise<number | null>; parseEvent(body: unknown): SmsEvent`
- **FakeRegistration** (class) `campaignState: CampaignState; readonly assignments; campaign(): Promise<CampaignState>; number(e164: string): Promise<NumberAssignment>; assign(e164: string, campaignId: string): Promise<NumberAssignment>; settle(): void`
- **KeywordReplies** (interface) `interface KeywordReplies { set(keyword: Keyword, words: readonly string[], text: string | null): Promise<void>; }`
- **LookupResult** (interface) `interface LookupResult { e164: string; lineType: LineType; carrier: string | null; raw: unknown; imessage?: boolean; }`
- **NoProvider** (class) `readonly name; send(): Promise<SendResult>; lookup(): Promise<LookupResult>; listNumbers(): Promise<ProviderNumber[]>; balance(): Promise<number | null>; parseEvent(): SmsEvent`
- **NumberAssignment** (interface) `interface NumberAssignment { status: "none" | "pending" | "assigned" | "failed"; campaignId: string | null; detail: string | null; }`
- **ProviderNumber** (interface) `interface ProviderNumber { e164: string; providerId: string; }`
- **Registration** (interface) `interface Registration { campaign(campaignId: string): Promise<CampaignState>; number(e164: string): Promise<NumberAssignment>; assign(e164: string, campaignId: string): Promise<NumberAssignment>; }`
- **SendRequest** (interface) `interface SendRequest { from: string; to: string; text: string; }`
- **SendResult** (type) `type SendResult = | { ok: true; providerId: string; parts: number | null; costUsd: number | null; service?: Service | null; } | { ok: false; retry: false; code: string | null; detail: string; optedOut: boolean; } | { ok: false; retry: true; detail: string };`
- **SmsEvent** (type) `type SmsEvent = | { kind: "status"; eventId: string; type: string; messageId: string; status: DeliveryStatus; at: Date; code: string | null; detail: string | null; parts: number | null; costUsd: number | null; service?: Service | null; } | { kind: "inbound"; eventId: string; type: string; messageId: string; from: string; to: string; text: string; at: Date; service?: Service | null; } | { kind: "call"; eventId: string; type: string; callId: string; stage: CallStage; from: string; to: string; at: Date; cause: string | null; } | { kind: "ignored"; eventId: string; type: string };`
- **SmsProvider** (interface) `interface SmsProvider { readonly name: string; send(req: SendRequest): Promise<SendResult>; lookup(e164: string): Promise<LookupResult>; listNumbers(): Promise<ProviderNumber[]>; balance(): Promise<number | null>; parseEvent(body: unknown): SmsEvent; readonly registration?: Registration; readonly keywordReplies?: KeywordReplies; }`
- **callJson** (function) `(fetchImpl: typeof fetch, base: string, opts: { apiKey: string; timeoutMs?: number }, method: string, path: string, body: unknown, unparsed: (text: string) => unknown): Promise<{ status: number; json: unknown }>`

## packages/channel-sms/src/push.ts

- **FakePusher** (class) `readonly name; readonly publicKey; readonly sent:; readonly gone; push(sub: SmsPushSubscription, alert: PushAlert): Promise<"ok" | "gone">`
- **PushAlert** (interface) `interface PushAlert { title: string; body: string; url: string; tag: string; }`
- **PushSubscriptionInput** (interface) `interface PushSubscriptionInput { endpoint: string; keys: { p256dh: string; auth: string }; }`
- **Pusher** (interface) `interface Pusher { name: string; publicKey: string; push(sub: SmsPushSubscription, alert: PushAlert): Promise<"ok" | "gone">; }`
- **WebPusher** (class) `readonly name; readonly publicKey: string;; constructor(private readonly vapid: Vapid); push(sub: SmsPushSubscription, alert: PushAlert): Promise<"ok" | "gone">`
- **pushAll** (function) `(db: Queryable, pusher: Pusher, alert: PushAlert): Promise<PushStats>`
- **pushOne** (function) `(db: Queryable, pusher: Pusher, endpoint: string, alert: PushAlert): Promise<{ pushed: boolean; error: string | null }>`
- **subscribe** (function) `(db: Queryable, sub: PushSubscriptionInput, operator: string): Promise<void>`
- **unsubscribe** (function) `(db: Queryable, endpoint: string): Promise<boolean>`

## packages/channel-sms/src/records.ts

- **SMS_RECORDS** (const) `import("@wren/core/records").RecordType[]`
- **reviewRecord** (const) `import("@wren/core/records").RecordType`
- **textContactRecord** (const) `import("@wren/core/records").RecordType`
- **textCopyRecord** (function) `(sequences: Iterable<SmsSequence>, sender: string): import("@wren/core/records").RecordType`
- **threadRecord** (const) `import("@wren/core/records").RecordType`

## packages/channel-sms/src/refusal.ts

- **SmsRefusal** (class) `override name`

## packages/channel-sms/src/registration.ts

- **RegistrationStats** (interface) `interface RegistrationStats { campaign: CampaignState | null; skipped: string | null; registered: string[]; asked: string[]; pending: string[]; failed: string[]; }`
- **watchRegistration** (function) `(db: Queryable, provider: SmsProvider, campaignId: string | null, now: Date): Promise<RegistrationStats>`

## packages/channel-sms/src/reminders.ts

- **ReminderStats** (interface) `interface ReminderStats { calls: number; due: number; queued: number; already: number; bookedToday: number; outOfHours: number; empty: number; noConsent: number; ended: number; capped: number; unreachable: number; }`
- **remindBookings** (function) `(db: Queryable, opts: ReminderOptions): Promise<ReminderStats>`

## packages/channel-sms/src/restate/answers.ts

- **CallHooks** (interface) `interface CallHooks { missed(ctx: restate.Context, client: string | null, callId: number): void; replied(ctx: restate.Context, client: string | null, contactId: number): Promise<void>; }`
- **MISSED_FLOW** (const) `"missed_call.steps"`
- **REVIEWS_FLOW** (const) `"reviews.steps"`
- **callHooks** (function) `(d: { main: Db; clientDb(id: string): Db }): CallHooks`
- **makeReviews** (function) `(d: { main: Db; clientDb(id: string): Db }): restate.ServiceDefinition<"Reviews", { click: (ctx: restate.Context, req: z.infer<typeof CLICK>) => Promise<{ to: string | null; }>; feedback: (ctx: restate.Context, req: z.infer<typeof FEEDBACK>) => Promise<{ ok: boolean; }>; stop: (ctx: restate.Context, req: z.infer<typeof CLICK>) => Promise<{ ok:…`

## packages/channel-sms/src/restate/console.ts

- **SmsConsoleService** (type) `type SmsConsoleService = ReturnType<typeof makeSmsConsole>;`
- **makeSmsConsole** (function) `(deps: SmsConsoleDeps): restate.ServiceDefinition<"SmsConsole", { recordsTypes: (_: restate.Context, req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (_: restate.Context, req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (_: restate.…`
- **smsConsoleApi** (function) `({ db, open }: SmsConsoleDeps): { recordsTypes: (req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (req: PortalRequest & GetAsk) => Promise<import("@wren/core/records/serve").RecordAnswer>; r…`

## packages/channel-sms/src/restate/forms.ts

- **FORMS_SERVICE** (const) `{ readonly name: "SmsForms"; }`
- **SmsFormsService** (type) `type SmsFormsService = ReturnType<typeof makeSmsForms>;`
- **makeSmsForms** (function) `(deps: SmsDeps): restate.ServiceDefinition<"SmsForms", { applied: (ctx: restate.Context, req: { application: number; }) => Promise<Stepped | null>; first: (ctx: restate.Context, req: FirstRequest) => Promise<Stepped>; email: (ctx: restate.Context, req: RunRequest) => Promise<EmailOutcome>; check: (ctx: restate.Conte…`

## packages/channel-sms/src/restate/index.ts

- **SENDER_KEY** (const) `"fleet"`
- **SmsDeps** (interface) `interface SmsDeps { db: Db; provider: SmsProvider; policy: SmsPolicy; health: HealthPolicy; live: boolean; campaignId: string | null; sequences: ReadonlyMap<string, SmsSequence>; senderName: string; bookingLink?: string | null; heldNiches: readonly string[]; site?: SiteSource | null; formCountries?: readonly string[]; formMail?: SendMail | null; bookings?: Bookings | null; notifier?: Notifier; pusher?: Pusher | null; llm?: LlmClient | null; clock?: () => Date; forClient?: ((plan: Extract<ClientSms, { kind: "work" }>) => SmsDeps) | null; clientDb?: ((client: string) => Db) | null; }`
- **SmsDeskService** (type) `type SmsDeskService = ReturnType<typeof makeSmsDesk>;`
- **SmsEventsService** (type) `type SmsEventsService = ReturnType<typeof makeSmsEvents>;`
- **SmsSender** (type) `type SmsSender = ReturnType<typeof makeSmsSender>;`
- **SmsWatchObject** (type) `type SmsWatchObject = ReturnType<typeof makeSmsWatch>;`
- **WATCH_KEY** (const) `"daily"`
- **WatchStats** (interface) `interface WatchStats { registration: RegistrationStats; forms: FormStats | null; formsAfter: AfterStats | null; formsError?: string; reminders: ReminderStats | null; remindersError?: string; classify: ClassifyStats | null; health: Pick<HealthReport, "paused" | "warnings" | "balanceUsd" | "fleet">; summarized: string | null; }`
- **makeSmsDesk** (function) `(deps: SmsDeps): restate.ServiceDefinition<"SmsDesk", { threads: (ctx: restate.Context, req?: { filter?: ThreadFilter; limit?: number; offset?: number; } & ForClient) => Promise<ThreadSummary[]>; thread: (ctx: restate.Context, req: { contactId: number; } & ForClient) => Promise<Thread | null>; markRead: (ctx: restat…`
- **makeSmsEvents** (function) `(deps: Pick< SmsDeps, "db" | "provider" | "notifier" | "pusher" | "clock" | "campaignId" | "clientDb" > & { fire?: FireTriggers; calls?: CallHooks; keys?: KeyStore | null; }): restate.ServiceDefinition<"SmsEvents", { signer: (ctx: restate.Context, req: { number?: string | null; client?: string | null; }) => Promise<Signer>; ingest: (ctx: restate.Context, body: unknown) => Promise<{ duplicate: boolean; outcome: string; }>; ingestFor: (ctx: restate.Context, req: { client: s…`
- **makeSmsSender** (function) `(wren: SmsDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<TickStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<TickStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) => P…`
- **makeSmsWatch** (function) `(wren: SmsDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<WatchStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<WatchStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) =>…`
- **senderDelayMs** (function) `(s: TickStats, gapSeconds: number, now: Date): number`

## packages/channel-sms/src/reviews.ts

- **AskOptions** (interface) `interface AskOptions { live: boolean; why: string | null; senderName: string; placeId: string | null; via: ReviewVia; mail: MailOptions; feedback: boolean; onceEvery: number; client: string; origin: string; now: Date; }`
- **Customer** (interface) `interface Customer { subject: string; source: ReviewSource; name: string | null; phone: string | null; email: string | null; zone: string | null; }`
- **LINK_ORIGIN** (const) `"https://phone.wrenautomation.com"`
- **SendMail** (type) `type SendMail = (m: { to: string; subject: string; text: string; headers?: readonly (readonly [string, string])[]; }) => Promise<void>;`
- **askReview** (function) `(db: Db, c: Customer, o: AskOptions): Promise<ReviewAsk>`
- **channelOf** (function) `(via: ReviewVia, phone: string | null, email: string | null): "email" | "text" | null`
- **cleanEmail** (function) `(raw: string | null | undefined): string | null`
- **clickReview** (function) `(db: Queryable, token: string, now: Date): Promise<string | null>`
- **handSubject** (function) `(id: string): string`
- **newToken** (function) `(): string`
- **placeIdOf** (function) `(main: Queryable, client: string): Promise<string | null>`
- **remindReview** (function) `(db: Db, id: number, o: Pick< AskOptions, "live" | "why" | "senderName" | "feedback" | "client" | "origin" | "now" | "mail" >): Promise<ReviewAsk>`
- **reviewStep** (function) `(depsFor: (client: string) => Promise<ReviewDeps>): Step`
- **saveFeedback** (function) `(db: Queryable, token: string, words: string, now: Date): Promise<boolean>`
- **sourceOf** (function) `(e: ExecutorEvent): ReviewSource`
- **stopReview** (function) `(db: Queryable, token: string, now: Date): Promise<boolean>`

## packages/channel-sms/src/schema.ts

- **ANSWER_KINDS** (const) `ReadonlySet<string>`
- **ANSWER_STATES** (const) `readonly ["queued", "would_send", "skipped", "refused"]`
- **AnswerState** (type) `type AnswerState = (typeof ANSWER_STATES)[number];`
- **CALL_OUTCOMES** (const) `readonly ["reached", "voicemail", "no_answer", "wrong_number"]`
- **CALL_RESULTS** (const) `readonly ["answered", "missed", "busy", "voicemail"]`
- **CONSENTED_KINDS** (const) `ReadonlySet<string>`
- **CONTACT_BASES** (const) `readonly ["published", "opt_in"]`
- **CONTACT_STATES** (const) `readonly ["new", "enrolled", "replied", "opted_out", "finished", "stopped", "unreachable"]`
- **CallOutcome** (type) `type CallOutcome = DialOutcome;`
- **CallResult** (type) `type CallResult = (typeof CALL_RESULTS)[number];`
- **ContactBasis** (type) `type ContactBasis = (typeof CONTACT_BASES)[number];`
- **ContactState** (type) `type ContactState = (typeof CONTACT_STATES)[number];`
- **DIRECTIONS** (const) `readonly ["out", "in"]`
- **DISPOSITIONS** (const) `readonly ["interested", "not_interested", "question", "wrong_person", "opt_out", "other"]`
- **DISPOSITION_SOURCES** (const) `readonly ["rule", "llm", "operator"]`
- **Direction** (type) `type Direction = (typeof DIRECTIONS)[number];`
- **Disposition** (type) `type Disposition = (typeof DISPOSITIONS)[number];`
- **DispositionSource** (type) `type DispositionSource = (typeof DISPOSITION_SOURCES)[number];`
- **FIRST_TOUCHES** (const) `readonly ["queued", "sent", "would_send", "no_consent", "no_phone", "refused", "booked"]`
- **FirstTouch** (type) `type FirstTouch = (typeof FIRST_TOUCHES)[number];`
- **LINE_TYPES** (const) `readonly ["mobile", "landline", "voip", "toll_free", "unknown"]`
- **LineType** (type) `type LineType = (typeof LINE_TYPES)[number];`
- **MESSAGE_KINDS** (const) `readonly ["sequence", "manual", "reminder", "inbound", "follow_up", "text_back", "review", "pay", "doc", "broadcast"]`
- **MESSAGE_STATES** (const) `readonly ["queued", "sending", "sent", "delivered", "failed", "unknown", "skipped", "received"]`
- **MessageKind** (type) `type MessageKind = (typeof MESSAGE_KINDS)[number];`
- **MessageState** (type) `type MessageState = (typeof MESSAGE_STATES)[number];`
- **NUMBER_STATES** (const) `readonly ["active", "paused", "retired"]`
- **NewSmsContact** (type) `type NewSmsContact = typeof smsContacts.$inferInsert;`
- **NumberState** (type) `type NumberState = (typeof NUMBER_STATES)[number];`
- **PHONE_COUNTRIES** (const) `readonly ["US", "CA"]`
- **PhoneCountry** (type) `type PhoneCountry = (typeof PHONE_COUNTRIES)[number];`
- **REVIEW_SOURCES** (const) `readonly ["won", "done", "paid", "hand", "door"]`
- **REVIEW_VIA** (const) `readonly ["text", "email"]`
- **ReviewAsk** (type) `type ReviewAsk = typeof reviewAsks.$inferSelect;`
- **ReviewSource** (type) `type ReviewSource = (typeof REVIEW_SOURCES)[number];`
- **ReviewVia** (type) `type ReviewVia = (typeof REVIEW_VIA)[number];`
- **SERVICES** (const) `readonly ["imessage", "rcs", "sms"]`
- **SOURCE_KINDS** (const) `readonly ["tel_link", "page_text", "manual", "inbound", "form", "hook", "call", "customer"]`
- **SPEED_CALLS** (const) `readonly ["alerted", "dialed", "skipped"]`
- **Service** (type) `type Service = (typeof SERVICES)[number];`
- **SmsCall** (type) `type SmsCall = typeof smsCalls.$inferSelect;`
- **SmsContact** (type) `type SmsContact = typeof smsContacts.$inferSelect;`
- **SmsEventRow** (type) `type SmsEventRow = typeof smsEvents.$inferSelect;`
- **SmsMessage** (type) `type SmsMessage = typeof smsMessages.$inferSelect;`
- **SmsNumber** (type) `type SmsNumber = typeof smsNumbers.$inferSelect;`
- **SmsPushSubscription** (type) `type SmsPushSubscription = typeof smsPushSubscriptions.$inferSelect;`
- **SourceKind** (type) `type SourceKind = (typeof SOURCE_KINDS)[number];`
- **SpeedCall** (type) `type SpeedCall = (typeof SPEED_CALLS)[number];`
- **SpeedRun** (type) `type SpeedRun = typeof speedRuns.$inferSelect;`
- **marketingTextContactRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_text_contact_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_text_contact_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; …`
- **reviewAsks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "review_asks"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "review_asks"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **smsCalls** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sms_calls"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sms_calls"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrima…`
- **smsContacts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sms_contacts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sms_contacts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **smsEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sms_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sms_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPri…`
- **smsMessages** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sms_messages"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sms_messages"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **smsNumbers** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sms_numbers"; schema: undefined; columns: { e164: import("drizzle-orm/pg-core").PgColumn<{ name: "e164"; tableName: "sms_numbers"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: fals…`
- **smsPushSubscriptions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sms_push_subscriptions"; schema: undefined; columns: { endpoint: import("drizzle-orm/pg-core").PgColumn<{ name: "endpoint"; tableName: "sms_push_subscriptions"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notN…`
- **speedRuns** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "speed_runs"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "speed_runs"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPri…`

## packages/channel-sms/src/settings.ts

- **formCountriesFrom** (function) `(s: Pick<Settings, "smsFormCountries">): readonly string[]`
- **healthFrom** (function) `(s: Settings): HealthPolicy`
- **policyFrom** (function) `(s: Settings): SmsPolicy`
- **providerFrom** (function) `(s: Settings): SmsProvider`
- **pusherFrom** (function) `(s: Settings): Pusher | null`

## packages/channel-sms/src/setups.ts

- **PLACE_FINDER** (const) `"google_business.place"`
- **PlaceFound** (interface) `interface PlaceFound { placeId: string | null; name: string | null; address: string | null; via: "place" | "list" | "none"; }`
- **SMS_SETUPS** (const) `import("@wren/core/setup").Setup[]`
- **answerChecks** (function) `(dbOf: (client: string | null) => Promise<Db>, get: typeof fetch): Record<string, SetupCheck>`
- **findPlace** (function) `(sites: SiteClient, ref: string): Promise<{ ref: string | null; why: string }>`
- **reviewUrl** (function) `(placeId: string): string`
- **smsChecks** (function) `(main: Db, reg: Registration, wrenCampaign: string | null): Record<string, SetupCheck>`

## packages/channel-sms/src/speed.ts

- **SPEED_SEQUENCES** (const) `readonly SmsSequence[]`
- **firstText** (function) `(db: Db, r: { workflow: string; subject: string; lead: DoorLead; leadAt: Date }, t: Omit<SpeedTexts, "db" | "nudge">, now: Date): Promise<FirstText>`
- **firstTextStep** (function) `(textsFor: (client: string | null) => Promise<SpeedTexts>): Step`

## packages/channel-sms/src/stats.ts

- **Rate** (interface) `interface Rate { k: number; n: number; low: number; high: number; text: string; }`
- **SmsStats** (interface) `interface SmsStats { since: string; steps: StepRow[]; contacts: Record<string, number>; texted: number; delivery: Rate; reply: Rate; interested: Rate; optOut: Rate; costUsd: number; costPerReplyUsd: number | null; speed: SpeedStats; }`
- **StepRow** (interface) `interface StepRow { sequence: string | null; step: number | null; sent: number; delivered: number; failed: number; costUsd: number; }`
- **rate** (function) `(k: number, n: number): Rate`
- **smsStats** (function) `(db: Queryable, opts: { since: Date; niche?: string | null }): Promise<SmsStats>`

## packages/channel-sms/src/telnyx.ts

- **TelnyxProvider** (class) `readonly name; constructor(private readonly opts: TelnyxOptions); send(req: SendRequest): Promise<SendResult>; lookup(e164: string): Promise<LookupResult>; listNumbers(): Promise<ProviderNumber[]>; balance(): Promise<number | null>; parseEvent(body: unknown): SmsEvent; readonly registration: Registration; readonly keywordReplies: KeywordReplies`
- **assignmentOf** (function) `(body: unknown): NumberAssignment`
- **campaignOf** (function) `(body: unknown): CampaignState`
- **lineTypeOf** (function) `(type: string | null | undefined): LineType`
- **parseTelnyxEvent** (function) `(body: unknown): SmsEvent`

## packages/channel-sms/src/template-store.ts

- **SetTemplate** (interface) `interface SetTemplate { key: string; body: string; by: string; }`
- **SlotView** (interface) `interface SlotView extends TemplateSlot { body: string; version: string | null; updatedAt: string | null; updatedBy: string | null; preview: string; segments: Segments | null; }`
- **TEXTS_SYSTEM** (const) `"texts"`
- **fieldsFor** (function) `(db: Queryable, contact: Pick<SmsContact, "companyId" | "personId" | "name"> & Partial<Pick<SmsContact, "bookingLink">>, sender: string, bookingLink: string | null = null): Promise<RenderFields>`
- **listTemplates** (function) `(db: Queryable, slots: readonly TemplateSlot[], sender: string): Promise<SlotView[]>`
- **liveTexts** (function) `(db: Queryable, keys: readonly string[]): Promise<Map<string, Template>>`
- **setTemplate** (function) `(db: Queryable, opts: { provider: SmsProvider; slots: readonly TemplateSlot[]; sender: string }, req: SetTemplate): Promise<SlotView>`
- **slotsOf** (function) `(sequences: Iterable<SmsSequence>): TemplateSlot[]`
- **textRef** (function) `(key: string): TemplateRef`

## packages/channel-sms/src/templates.ts

- **ANSWER_SLOTS** (const) `readonly TemplateSlot[]`
- **DAY_BEFORE** (const) `"reminder.day-before"`
- **HOUR_BEFORE** (const) `"reminder.hour-before"`
- **KEYWORDS** (const) `readonly ["help", "start", "stop"]`
- **KEYWORD_SLOTS** (const) `readonly TemplateSlot[]`
- **KEYWORD_WORDS** (const) `Record<Keyword, readonly string[]>`
- **Keyword** (type) `type Keyword = (typeof KEYWORDS)[number];`
- **REMINDER_SLOTS** (const) `readonly TemplateSlot[]`
- **RenderField** (type) `type RenderField = keyof RenderFields;`
- **RenderFields** (interface) `interface RenderFields { first_name: string | null; company: string | null; sender: string; time: string | null; booking_link: string | null; review_link?: string | null; feedback_link?: string | null; }`
- **Segments** (interface) `interface Segments { encoding: "GSM-7" | "UCS-2"; units: number; parts: number; }`
- **SmsSequence** (interface) `interface SmsSequence { name: string; label?: string; steps: readonly SmsStep[]; firstGoes?: string; fields?: readonly RenderField[]; namesSender?: boolean; }`
- **TemplateSlot** (interface) `interface TemplateSlot { key: string; purpose: string; goes?: string; fields: readonly RenderField[]; mustSayStop: boolean; mustUse?: readonly RenderField[]; minLength: number; }`
- **checkBody** (function) `(slot: TemplateSlot, body: string): string`
- **checkSequence** (function) `(seq: SmsSequence): SmsSequence`
- **firstName** (function) `(full: string | null | undefined): string | null`
- **keywordOf** (function) `(key: string): Keyword | null`
- **preview** (function) `(source: string, fields: RenderFields): string`
- **render** (function) `(tpl: Template, fields: RenderFields, seed: string): RenderedText`
- **sampleFields** (function) `(sender: string): RenderFields`
- **segments** (function) `(text: string): Segments`
- **sequenceSlots** (function) `(seq: SmsSequence): TemplateSlot[]`
- **stepKey** (function) `(sequence: string, step: number): string`
- **stepTemplate** (function) `(seq: SmsSequence, step: number): string`
- **textSeed** (function) `(contactId: number): string`

## packages/channel-sms/src/threads.ts

- **Thread** (interface) `interface Thread { contact: SmsContact & { display: string; company: string | null; companyDomain: string | null; fromNumber: string | null; }; messages: (Pick< SmsMessage, | "id" | "direction" | "kind" | "step" | "body" | "state" | "errorCode" | "detail" | "disposition" | "dispositionSource" | "service" > & { at: string })[]; month: { sent: number; cap: number }; }`
- **ThreadFilter** (type) `type ThreadFilter = "all" | "unread" | "replied";`
- **ThreadSummary** (interface) `interface ThreadSummary { contactId: number; e164: string; display: string; company: string | null; name: string | null; state: SmsContact["state"]; lastAt: string; lastBody: string; lastDirection: "in" | "out"; unread: number; disposition: string | null; }`
- **getThread** (function) `(db: Queryable, contactId: number, opts: { now: Date; cap: number }): Promise<Thread | null>`
- **listThreads** (function) `(db: Queryable, opts: { filter?: ThreadFilter; limit?: number; offset?: number } = {}): Promise<ThreadSummary[]>`
- **markRead** (function) `(db: Queryable, contactId: number, now: Date): Promise<void>`

## packages/channel-sms/src/webhook.ts

- **SIGNATURE_HEADER** (const) `"telnyx-signature-ed25519"`
- **STANDARD_ID_HEADER** (const) `"webhook-id"`
- **STANDARD_SIGNATURE_HEADER** (const) `"webhook-signature"`
- **STANDARD_TIMESTAMP_HEADER** (const) `"webhook-timestamp"`
- **TIMESTAMP_HEADER** (const) `"telnyx-timestamp"`
- **ourNumber** (function) `(body: unknown): string | null`
- **signedFresh** (function) `(input: { signature: string | null; timestamp: string | null; nowSeconds?: number; }): Verdict`
- **verifyStandardWebhook** (function) `(input: { secret: string; id: string | null; signature: string | null; timestamp: string | null; rawBody: string; nowSeconds?: number; }): Promise<Verdict>`
- **verifyTelnyx** (function) `(input: { publicKey: string; signature: string | null; timestamp: string | null; rawBody: string; nowSeconds?: number; }): Promise<Verdict>`
- **Verdict** (type) `type Verdict = { ok: true } | { ok: false; reason: string };`

## packages/research/src/phones.ts

- **isTollFree** (function) `(e164: string): boolean`
- **toUsE164** (function) `(raw: string): string | null`
