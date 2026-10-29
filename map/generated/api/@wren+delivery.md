# @wren/delivery: interface

Exports: 288. Files: 40.

## packages/core/src/portal.ts

- **Me** (interface) `interface Me { clients: { id: string; name: string; demo?: true; look?: unknown; installed: string[]; can: Permission[]; role?: RoleId; flags: Record<string, string>; grants?: Grant[]; }[]; demo: boolean; operator: boolean; team?: { role: RoleId; wren: Permission[]; flags: Record<string, string>; grants?: Grant[] }; as?: { client: string; name: string; who: string; role: RoleId; act: boolean; sandbox: boolean; }; }`

## packages/delivery/src/billing/console-routes.ts

- **BILLING_CONSOLE_APPS** (const) `{ readonly "*": "money"; }`
- **BILLING_CONSOLE_ROUTES** (const) `{ readonly match: "wren:money"; readonly dismiss: "wren:money"; }`
- **BILLING_CONSOLE_WRITES** (const) `readonly (keyof typeof BILLING_CONSOLE_ROUTES)[]`

## packages/delivery/src/billing/console.ts

- **billingConsoleApi** (function) `(db: Db): { match: (req: CreditsRequest) => Promise<{ done: string[]; }>; dismiss: (req: CreditsRequest) => Promise<{ done: string[]; }>; }`
- **creditApprovalId** (function) `(id: number): string`
- **makeBillingConsole** (function) `(db: Db): restate.ServiceDefinition<"BillingConsole", { match: (ctx: restate.Context, req: CreditsRequest) => Promise<{ done: string[]; }>; dismiss: (ctx: restate.Context, req: CreditsRequest) => Promise<{ done: string[]; }>; }>`

## packages/delivery/src/billing/credits.ts

- **CREDIT_STATUSES_SHOWN** (const) `readonly ["review", "matched", "dismissed"]`
- **CreditView** (interface) `interface CreditView { id: number; at: string; status: CreditStatus; currency: string; cents: number; feeCents: number; kind: string; payer: string | null; memo: string | null; why: string | null; invoice: string | null; client: string | null; clientName: string | null; decidedBy: string | null; }`
- **Taken** (interface) `interface Taken { credit: WiseCredit; match: Match; invoice: (Invoice & { clientId: string; clientName: string }) | null; }`
- **creditsList** (function) `(db: Queryable, o: { status?: readonly CreditStatus[]; limit?: number } = {}): Promise<CreditView[]>`
- **dismissCredit** (function) `(db: Queryable, creditId: number, by: string): Promise<WiseCredit>`
- **matchByHand** (function) `(db: Queryable, creditId: number, number: string, by: string): Promise<Taken>`
- **takeCredits** (function) `(db: Queryable, credits: readonly CreditIn[]): Promise<Taken[]>`

## packages/delivery/src/billing/mail.ts

- **billToOf** (function) `(c: { name: string; products: Record<string, unknown>; }): BillTo & { name: string }`
- **invoiceFile** (function) `(i: Pick< Invoice, "number" | "issuedOn" | "dueOn" | "currency" | "cents" | "lines" | "description" >, to: BillTo & { name: string }, receive: ReceiveDetails, taxNumber?: string): Promise<Uint8Array>`
- **mailInvoices** (function) `(main: Db, send: (m: PortalMail) => Promise<void>, receive: ReceiveDetails, app: string, now: Date, taxNumber?: string): Promise<MailStats & { sent: { number: string; client: string }[] }>`
- **parseBillTo** (function) `(raw: unknown): BillTo`
- **pdfName** (function) `(i: Pick<Invoice, "number">): string`
- **setBillTo** (function) `(db: Queryable, clientId: string, change: BillTo): Promise<BillTo & { name: string }>`

## packages/delivery/src/billing/match.ts

- **CreditFacts** (interface) `interface CreditFacts { kind: string; currency: string; cents: number; feeCents: number; payer: string | null; memo: string | null; description: string | null; }`
- **InvoiceFacts** (interface) `interface InvoiceFacts { id: number; number: string; currency: string; cents: number; receivedCents: number; status: "open" | "paid" | "void"; clientName: string; }`
- **Match** (type) `type Match = | { status: "matched"; invoiceId: number; why: string; cents: number } | { status: "review"; invoiceId: number | null; why: string } | { status: "ignored"; invoiceId: null; why: string };`
- **dueOf** (function) `(i: Pick<InvoiceFacts, "cents" | "receivedCents">): number`
- **matchCredit** (function) `(c: CreditFacts, invoices: readonly InvoiceFacts[]): Match`
- **nameKey** (function) `(s: string): string`
- **referencesIn** (function) `(text: string): string[]`
- **samePayer** (function) `(payer: string | null, client: string): boolean`

## packages/delivery/src/billing/receive.ts

- **ReceiveDetails** (type) `type ReceiveDetails = Readonly<Record<string, ReceiveFields>>;`
- **parseReceive** (function) `(raw: string | undefined): ReceiveDetails`
- **payFields** (function) `(details: ReceiveDetails, currency: string): [string, string][]`

## packages/delivery/src/billing/records.ts

- **BILLING_RECORDS** (const) `readonly RecordType[]`

## packages/delivery/src/billing/tell.ts

- **claimInvoiceChanges** (function) `(db: Db, token: string, today: string): Promise<Fired[]>`
- **invoiceFired** (function) `(i: Invoice, change: InvoiceChange, who: { client: string; name: string; email: string | null }): Fired`
- **invoiceReached** (function) `(i: Pick<Invoice, "status" | "refundedCents" | "dueOn">, today: string): InvoiceChange[]`

## packages/delivery/src/billing/watch.ts

- **BILLING_KEY** (const) `"fleet"`
- **BILLING_WATCH** (const) `"BillingWatch"`
- **BillingWatch** (type) `type BillingWatch = ReturnType<typeof makeBillingWatch>;`
- **billingPass** (function) `(deps: BillingDeps, now: Date): Promise<BillingStats>`
- **makeBillingWatch** (function) `(deps: BillingDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<BillingStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<BillingStats>>; start: (ctx: restat…`

## packages/delivery/src/billing/wise.ts

- **CreditIn** (interface) `interface CreditIn { wiseId: string; balanceId: string; currency: string; cents: number; feeCents: number; at: Date; kind: string; payer: string | null; memo: string | null; description: string | null; raw: Record<string, unknown>; }`
- **OWN_KINDS** (const) `Set<string>`
- **WiseError** (class) ``
- **WiseReader** (interface) `interface WiseReader { credits(from: Date, to: Date): Promise<CreditIn[]>; }`
- **creditOf** (function) `(balanceId: string, t: Record<string, unknown>): CreditIn | null`
- **wiseReader** (function) `(o: { token: string; profileId: string; fetch?: typeof fetch; base?: string; }): WiseReader`

## packages/delivery/src/components.ts

- **DELIVERY_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **DELIVERY_WORKFLOWS** (const) `import("@wren/core/workflows").Workflow[]`

## packages/delivery/src/contract.ts

- **CONTRACT_VERSION** (const) `"2026-10-01.4"`
- **WREN_PARTY** (const) `{ readonly name: "William Jin, operating as Wren Automation"; readonly place: "Toronto, Ontario, Canada"; readonly email: "william@wrenautomation.com"; }`
- **amount** (function) `(cents: number, currency: string): string`
- **contractText** (function) `(input: { clientName: string; offer: Offer; terms: Terms }): string`

## packages/delivery/src/domains.ts

- **DomainView** (interface) `interface DomainView { hostname: string; live: boolean; status: string; sslStatus: string; records: ClientDomain["records"]; problem: string | null; checkedAt: string; }`
- **makeDomainsResolver** (function) `(deps: Pick<DomainsDeps, "main">): restate.ServiceDefinition<"Domains", { resolve: (_: restate.Context, req: { host: string; }) => Promise<{ client: string | null; }>; }>`

## packages/delivery/src/files.ts

- **FileStore** (interface) `interface FileStore { putUrl(key: string, type: string, size: number): Promise<string>; getUrl(key: string): Promise<string>; put(key: string, bytes: Uint8Array, type: string): Promise<void>; }`
- **fileNameOf** (function) `(key: string): string`
- **newFileKey** (function) `(clientId: string, name: string, now = new Date()): string`
- **putLocalFile** (function) `(o: { bucket: string; region?: string }, key: string, path: string, type: string): Promise<number>`
- **s3Files** (function) `(o: { bucket: string; region?: string }): FileStore`

## packages/delivery/src/health/console-routes.ts

- **HEALTH_CONSOLE_APPS** (const) `{ readonly "*": "clients"; }`
- **HEALTH_CONSOLE_ROUTES** (const) `{ readonly rate: "wren:run"; readonly override: "wren:run"; readonly clearOverride: "wren:run"; readonly flagRaise: "wren:run"; readonly flagTake: "wren:run"; readonly flagOwn: "wren:run"; readonly flagAddress: "wren:run"; readonly flagClear: "wren:run"; }`
- **HEALTH_CONSOLE_WRITES** (const) `readonly (keyof typeof HEALTH_CONSOLE_ROUTES)[]`

## packages/delivery/src/health/console.ts

- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids?: string[]; }`
- **healthConsoleApi** (function) `(db: Db): { rate: (req: RateRequest) => Promise<{ done: string[]; }>; override: (req: OverrideRequest) => Promise<{ done: string[]; }>; clearOverride: (req: IdsRequest) => Promise<{ done: string[]; }>; flagRaise: (req: RaiseRequest) => Promise<{ done: string[]; id: string | undefined; }>; flagTake: (req: IdsR…`
- **makeHealthConsole** (function) `(db: Db): restate.ServiceDefinition<"HealthConsole", { rate: (ctx: restate.Context, req: RateRequest) => Promise<{ done: string[]; }>; override: (ctx: restate.Context, req: OverrideRequest) => Promise<{ done: string[]; }>; clearOverride: (ctx: restate.Context, req: IdsRequest) => Promise<{ done: string[]; }>;…`

## packages/delivery/src/health/flags.ts

- **DIGEST_HOUR** (const) `9`
- **FailedRun** (interface) `interface FailedRun { workflow: string; runs: number; top: string; }`
- **FlagFind** (interface) `interface FlagFind { clientId: string; engagementId: number | null; side: FlagSide; cause: string; what: string; how?: string | null; once?: boolean; urgent?: boolean; remindDays?: number; }`
- **FlagRefusal** (class) ``
- **addressFlag** (function) `(db: Queryable, id: number, by: string, note: string | null, now = new Date()): Promise<void>`
- **clearFlag** (function) `(db: Queryable, id: number, by: string, now = new Date()): Promise<void>`
- **failedLines** (function) `(runs: readonly FailedRun[], name: (workflow: string) => string): string[]`
- **flagsToFire** (function) `(db: Db, now: Date): Promise<Fired[]>`
- **ownFlag** (function) `(db: Queryable, id: number, owner: string | null): Promise<void>`
- **raiseFlag** (function) `(db: Queryable, r: { clientId: string; side: FlagSide; what: string; owner?: string | null; by: string }, now = new Date()): Promise<ClientFlag>`
- **syncFlags** (function) `(db: Db, source: Exclude<FlagSource, "person">, found: readonly FlagFind[], now: Date): Promise<{ raised: number; cleared: number }>`
- **tellFlags** (function) `(db: Db, notifier: Notifier, today: string, hour: number, now: Date, wren: readonly string[] = [], ops?: Notifier): Promise<{ urgent: number; digest: number }>`
- **workflowFlags** (function) `(clientId: string, runs: readonly FailedRun[], name: (workflow: string) => string): FlagFind[]`

## packages/delivery/src/health/hand.ts

- **clearOverride** (function) `(db: Queryable, clientId: string, by: string, now = new Date()): Promise<void>`
- **overrideHealth** (function) `(db: Queryable, r: { clientId: string; score: number; reason: string; by: string }, now = new Date()): Promise<void>`
- **rateClient** (function) `(db: Queryable, r: { clientId: string; score: number; note?: string | null; by: string }, now = new Date()): Promise<void>`

## packages/delivery/src/health/pass.ts

- **healthPass** (function) `(main: Db, zone: string, now: Date): Promise<{ scored: number; flags: FlagFind[] }>`
- **readHealth** (function) `(main: Db, zone: string, now: Date, only?: string): Promise<HealthRead[]>`

## packages/delivery/src/health/records.ts

- **HEALTH_RECORDS** (const) `readonly RecordType[]`
- **flagRecord** (const) `RecordType`

## packages/delivery/src/health/schema.ts

- **ClientFlag** (type) `type ClientFlag = typeof clientFlags.$inferSelect;`
- **FLAG_SIDES** (const) `readonly ["risk", "opportunity"]`
- **FLAG_SOURCES** (const) `readonly ["delivery", "health", "workflows", "person"]`
- **FlagSide** (type) `type FlagSide = (typeof FLAG_SIDES)[number];`
- **FlagSource** (type) `type FlagSource = (typeof FLAG_SOURCES)[number];`
- **HealthDay** (type) `type HealthDay = typeof healthDays.$inferSelect;`
- **clientFlags** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "flags"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "flags"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: …`
- **flagDigests** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "flag_digests"; schema: "delivery"; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "flag_digests"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: …`
- **healthDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "health_days"; schema: "delivery"; columns: { clientId: import("drizzle-orm/pg-core").PgColumn<{ name: "client_id"; tableName: "health_days"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDef…`
- **healthOverrides** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "health_overrides"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "health_overrides"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault…`
- **healthRatings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "health_ratings"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "health_ratings"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tr…`

## packages/delivery/src/health/score.ts

- **BANDS** (const) `readonly ["healthy", "watch", "risk", "none"]`
- **Band** (type) `type Band = (typeof BANDS)[number];`
- **DROP** (const) `15`
- **HealthInput** (interface) `interface HealthInput { part: Part; what: string; value: string; at: string | null; href: string | null; }`
- **PARTS** (const) `readonly ["results", "engagement", "sentiment", "money"]`
- **Part** (type) `type Part = (typeof PARTS)[number];`
- **PartScore** (interface) `interface PartScore { score: number | null; why: string; at: string | null; stale: boolean; }`
- **STALE_DAYS** (const) `Readonly<Partial<Record<Part, number>>>`
- **VISITS_WANTED** (const) `4`
- **WEIGHTS** (const) `Readonly<Record<Part, number>>`
- **ageDays** (function) `(at: string | Date, now: Date): number`
- **bandOf** (function) `(score: number | null): Band`
- **combine** (function) `(parts: Readonly<Record<Part, Pick<PartScore, "score">>>, weights: Readonly<Record<Part, number>> = WEIGHTS): { score: number | null; weights: Record<Part, number> }`
- **expectedBy** (function) `(t: { count: number; fromDay: number }, days: number, day: number): number`
- **meanOf** (function) `(xs: readonly (number | null)[]): number | null`
- **moneyScore** (function) `(daysLate: number | null): number`
- **ratingScore** (function) `(rating: number): number`
- **resultsScore** (function) `(actual: number, expected: number): { score: number | null; why: string }`
- **shareScore** (function) `(done: number, late: number): number | null`
- **shownScore** (function) `(model: number | null, override: number | null): number | null`
- **staleOf** (function) `(part: Part, at: string | null, now: Date): boolean`
- **visitsScore** (function) `(days: number): number`

## packages/delivery/src/health/views.ts

- **consoleFlags** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"console_flags", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "console_flags"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: f…`
- **consoleHealth** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"console_health", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "console_health"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAu…`
- **consoleHealthDays** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"console_health_days", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "console_health_days"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: f…`
- **consoleHealthInputs** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"console_health_inputs", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "console_health_inputs"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKe…`

## packages/delivery/src/invoices.ts

- **Bill** (interface) `interface Bill { engagementId: number; clientId: string; period: string; monthlyCents: number; units: number; unitCents: number; unit: string | null; currency: string; payDays: number; usage: UsageItem[]; }`
- **Reversed** (interface) `interface Reversed { invoice: Invoice; paused: boolean; }`
- **UsageItem** (interface) `interface UsageItem { vendor: string; month: string; units: number; cents: number; }`
- **addInvoice** (function) `(db: Queryable, e: Engagement, input: { description: string; cents: number; currency?: string | undefined; issuedOn?: string | undefined; dueOn: string; setup?: boolean | undefined; period?: string | undefined; units?: number | undefined; by: string; }): Promise<Invoice>`
- **billCents** (function) `(b: Bill): number`
- **billLines** (function) `(b: Bill): InvoiceLine[]`
- **billMonth** (function) `(db: Queryable, period: string, today: string, by: string): Promise<Invoice[]>`
- **billsDue** (function) `(db: Queryable, period: string): Promise<Bill[]>`
- **disputeInvoice** (function) `(db: Queryable, clientId: string, number: string, dispute: InvoiceDispute | null, by: string): Promise<Reversed>`
- **markInvoice** (function) `(db: Queryable, clientId: string, number: string, status: string, on?: string): Promise<Invoice>`
- **monthName** (function) `(period: string): string`
- **refundInvoice** (function) `(db: Queryable, clientId: string, number: string, refundedCents: number, by: string): Promise<Reversed>`
- **setupInvoice** (function) `(db: Queryable, e: Engagement, terms: Pick<Terms, "setupCents" | "currency" | "payDays">, by: string, today = todayUtc()): Promise<Invoice | null>`
- **stopIfReversed** (function) `(db: Queryable, e: Engagement, by: string): Promise<boolean>`

## packages/delivery/src/messaging.ts

- **capText** (function) `(n: number | null): string`
- **messagingApi** (function) `(deps: MessagingDeps): { messagingChange: (req: Change) => Promise<Done>; messagingSender: (req: Change) => Promise<Done>; messagingPostal: (req: Change) => Promise<Done>; messagingLinksOn: (req: Change) => Promise<Done>; messagingLinksOff: (req: Change) => Promise<Done>; }`

## packages/delivery/src/moments.ts

- **HALFWAY** (const) `"halfway"`
- **LAST_WEEK** (const) `"last_week"`
- **WORK_APP** (const) `"work"`
- **appOf** (function) `(offerId: string): string`
- **mailLevelOf** (function) `(db: Queryable, clientId: string, email: string): Promise<MailLevel>`
- **momentLabel** (function) `(offer: Offer, moment: string): string | null`
- **momentsReached** (function) `(offer: Offer, e: Pick<Engagement, "status" | "startsOn">, values: ReadonlyMap<string, number | null>, today: string): string[]`
- **nextOffers** (function) `(offer: Offer): Offer[]`
- **pagePath** (function) `(offerIds: readonly string[], page: string): string`
- **recordInterest** (function) `(db: Queryable, e: Engagement, input: { email: string; offerId: string }): Promise<void>`
- **recordReview** (function) `(db: Queryable, e: Engagement, input: { email: string; moment: string; score: number | null; words?: string | undefined; mayQuote?: string | undefined; }): Promise<void>`
- **setMailLevel** (function) `(db: Queryable, clientId: string, email: string, level: string): Promise<MailLevel>`

## packages/delivery/src/onboarding.ts

- **agreementOf** (function) `(db: Queryable, e: Engagement): Promise<Agreement | null>`
- **answerAccess** (function) `(db: Queryable, clientId: string, input: { id: number; status: string; note?: string | undefined; by: string }): Promise<AccessRequest>`
- **onboard** (function) `(db: Queryable, input: { clientId: string; offerId: string; startsOn: string; terms?: Partial<Terms>; flat?: boolean; by: string; }): Promise<{ engagement: Engagement; agreement: Agreement }>`
- **planOf** (function) `(flat: boolean | undefined): "flat" | "standard"`
- **requestAccess** (function) `(db: Queryable, e: Engagement, input: { system: string; scope: string; why: string; revoke: string; by: string }): Promise<AccessRequest>`
- **signAgreement** (function) `(db: Queryable, e: Engagement, input: { sha256: string; name: string; title?: string | undefined; email: string; agreed: boolean; ip?: string | undefined; agent?: string | undefined; }): Promise<Agreement>`
- **startIfReady** (function) `(db: Queryable, e: Engagement, today = todayUtc()): Promise<boolean>`
- **termsFor** (function) `(offer: Offer, over: Partial<Terms> = {}, flat = false, live?: Terms): Terms`

## packages/delivery/src/records.ts

- **deliveryRecords** (function) `(db: Queryable, clientId: string, operator: boolean, app = WORK_APP, bills: () => Promise<boolean> = async () => operator, manages: () => Promise<boolean> = async () => operator, messaging?: () => Promise<MessageSettings & { senderReads?: boolean }>, receive: ReceiveDetails = {}): RecordType[]`

## packages/delivery/src/routes.ts

- **DELIVERY_APPS** (const) `{ readonly "*": "work"; readonly me: null; readonly mail: null; readonly recordsTypes: null; readonly recordsList: null; readonly recordsGet: null; readonly recordsExport: null; readonly recordsStats: null; readonly people: "account"; readonly account: "account"; readonly invite: "account"; readonly…`
- **DELIVERY_ROUTES** (const) `{ readonly me: "read"; readonly board: "read"; readonly home: "read"; readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsGet: "read"; readonly recordsExport: "read"; readonly recordsStats: "read"; readonly updates: "read"; readonly answer: "act"; readonly decide: "act"; rea…`
- **DELIVERY_WRITES** (const) `readonly DeliveryRoute[]`
- **FILE_TYPES** (const) `Readonly<Record<string, string>>`
- **GOOGLE_REVIEW_URL** (const) `string | null`
- **MAX_FILE_BYTES** (const) `number`
- **PULSE_WORDS** (const) `Readonly<Record<number, string>>`
- **REVIEW_WORDS** (const) `Readonly<Record<number, string>>`
- **typeOfName** (function) `(name: string): string | undefined`

## packages/delivery/src/rows.ts

- **DeliveryRefusal** (class) ``
- **addDays** (function) `(day: string, n: number): string`
- **dayOf** (function) `(v: string, what = "date"): string`
- **engagementOf** (function) `(db: Queryable, clientId: string, id?: number): Promise<Engagement>`
- **mondayOf** (function) `(day: string): string`
- **todayUtc** (function) `(): string`
- **weekday** (function) `(day: string): number`

## packages/delivery/src/sample.ts

- **SAMPLE_REFRESH_DAYS** (const) `7`
- **keepSampleFresh** (function) `(db: Db, today: string): Promise<boolean>`
- **seedSample** (function) `(db: Queryable, clientId: string, today: string): Promise<number>`

## packages/delivery/src/schema.ts

- **ACCESS_STATUSES** (const) `readonly ["open", "granted", "declined", "revoked"]`
- **AccessRequest** (type) `type AccessRequest = typeof accessRequests.$inferSelect;`
- **AccessStatus** (type) `type AccessStatus = (typeof ACCESS_STATUSES)[number];`
- **Agreement** (type) `type Agreement = typeof agreements.$inferSelect;`
- **Ask** (type) `type Ask = typeof asks.$inferSelect;`
- **CREDIT_STATUSES** (const) `readonly ["matched", "review", "ignored", "dismissed"]`
- **Comment** (type) `type Comment = typeof comments.$inferSelect;`
- **CreditStatus** (type) `type CreditStatus = (typeof CREDIT_STATUSES)[number];`
- **DELIVERABLE_KINDS** (const) `readonly ["file", "link", "loom", "doc"]`
- **DELIVERABLE_STATES** (const) `readonly ["waiting", "approved", "changes"]`
- **Deliverable** (type) `type Deliverable = typeof deliverables.$inferSelect;`
- **DeliverableKind** (type) `type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];`
- **DeliverableState** (type) `type DeliverableState = (typeof DELIVERABLE_STATES)[number];`
- **ENGAGEMENT_STATUSES** (const) `readonly ["onboarding", "active", "paused", "done"]`
- **Engagement** (type) `type Engagement = typeof engagements.$inferSelect;`
- **EngagementStatus** (type) `type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];`
- **INVOICE_CHANGES** (const) `readonly ["invoiced", "paid", "refunded", "late"]`
- **INVOICE_DISPUTES** (const) `readonly ["open", "won", "lost"]`
- **INVOICE_STATUSES** (const) `readonly ["open", "paid", "void"]`
- **Interest** (type) `type Interest = typeof interests.$inferSelect;`
- **Invoice** (type) `type Invoice = typeof invoices.$inferSelect;`
- **InvoiceChange** (type) `type InvoiceChange = (typeof INVOICE_CHANGES)[number];`
- **InvoiceDispute** (type) `type InvoiceDispute = (typeof INVOICE_DISPUTES)[number];`
- **InvoiceLine** (interface) `interface InvoiceLine { what: string; cents: number; usage?: { vendor: string; month: string }; }`
- **InvoiceStatus** (type) `type InvoiceStatus = (typeof INVOICE_STATUSES)[number];`
- **MAIL_LEVELS** (const) `readonly ["all", "digest", "off"]`
- **MailLevel** (type) `type MailLevel = (typeof MAIL_LEVELS)[number];`
- **MemberMail** (type) `type MemberMail = typeof memberMail.$inferSelect;`
- **Milestone** (type) `type Milestone = typeof milestones.$inferSelect;`
- **Moment** (type) `type Moment = typeof moments.$inferSelect;`
- **Pulse** (type) `type Pulse = typeof pulses.$inferSelect;`
- **QUOTE_CONSENTS** (const) `readonly ["private", "anonymous", "named"]`
- **QuoteConsent** (type) `type QuoteConsent = (typeof QUOTE_CONSENTS)[number];`
- **Result** (type) `type Result = typeof results.$inferSelect;`
- **Review** (type) `type Review = typeof reviews.$inferSelect;`
- **Update** (type) `type Update = typeof updates.$inferSelect;`
- **WiseCredit** (type) `type WiseCredit = typeof wiseCredits.$inferSelect;`
- **accessRequests** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "access_requests"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "access_requests"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: …`
- **agreements** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "agreements"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "agreements"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPr…`
- **asks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "asks"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "asks"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: fa…`
- **comments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "comments"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "comments"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimar…`
- **deliverables** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "deliverables"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "deliverables"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; …`
- **delivery** (const) `import("drizzle-orm/pg-core").PgSchema<"delivery">`
- **engagements** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "engagements"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "engagements"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; is…`
- **interests** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "interests"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "interests"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrim…`
- **invoiceNumbers** (const) `import("drizzle-orm/pg-core").PgSequence`
- **invoices** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "invoices"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "invoices"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimar…`
- **memberMail** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "member_mail"; schema: "delivery"; columns: { clientId: import("drizzle-orm/pg-core").PgColumn<{ name: "client_id"; tableName: "member_mail"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDef…`
- **milestones** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "milestones"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "milestones"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPr…`
- **moments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "moments"; schema: "delivery"; columns: { engagementId: import("drizzle-orm/pg-core").PgColumn<{ name: "engagement_id"; tableName: "moments"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: tru…`
- **pulses** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "pulses"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "pulses"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey…`
- **results** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "results"; schema: "delivery"; columns: { engagementId: import("drizzle-orm/pg-core").PgColumn<{ name: "engagement_id"; tableName: "results"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: tru…`
- **reviews** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reviews"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reviews"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryK…`
- **updates** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "updates"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "updates"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryK…`
- **wiseCredits** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "wise_credits"; schema: "delivery"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "wise_credits"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; …`

## packages/delivery/src/service.ts

- **AccountView** (interface) `interface AccountView { name: string; since: string; you: { email: string | null; role: RoleId | null; wren: boolean }; bought: Awaited<ReturnType<typeof boughtBy>>; people: number; owners: string[]; billing: { open: number; overdue: number } | null; }`
- **ContractView** (interface) `interface ContractView { engagementId: number; version: string; body: string; sha256: string; terms: Terms; issuedAt: string; signed: { name: string; title: string | null; email: string; at: string } | null; }`
- **DeliveryApi** (type) `type DeliveryApi = ReturnType<typeof deliveryApi>;`
- **MemberView** (interface) `interface MemberView { email: string; role: RoleId; invitedBy: string | null; invitedAt: string; lastSeenAt: string | null; }`
- **deliveryApi** (function) `(deps: DeliveryDeps): { me: (req: PortalRequest) => Promise<Me>; board: (req: PortalRequest) => Promise<BoardRow[]>; home: (req: PortalRequest) => Promise<DeliveryHome>; recordsTypes: (req: RecordsReq) => Promise<RecordMeta[]>; recordsList: (req: RecordsReq & ListAsk) => Promise<RecordsPage>; recordsGet: (req: RecordsReq…`
- **makeDeliveryPortal** (function) `(deps: DeliveryDeps): restate.ServiceDefinition<"DeliveryPortal", { me: (_: restate.Context, req: PortalRequest) => Promise<Me>; board: (_: restate.Context, req: PortalRequest) => Promise<BoardRow[]>; home: (_: restate.Context, req: PortalRequest) => Promise<DeliveryHome>; recordsTypes: (_: restate.Context, req: RecordsR…`

## packages/delivery/src/source.ts

- **sourceHints** (function) `(db: Queryable, clientId: string, applications: readonly SiteApplicationTouch[]): Promise<SourceHint[]>`
- **touchSource** (function) `(raw: string): { channel: Channel; campaign: string | null } | null`

## packages/delivery/src/views.ts

- **AccessView** (type) `type AccessView = Pick< AccessRequest, "id" | "system" | "scope" | "why" | "revoke" | "status" | "note" | "answeredBy" > & { answeredAt: string | null };`
- **AskView** (type) `type AskView = Pick<Ask, "id" | "text" | "dueOn" | "answer" | "answeredBy"> & { step: string | null; file: string | null; answeredAt: string | null; overdue: boolean; };`
- **CommentView** (type) `type CommentView = Pick<Comment, "id" | "author" | "fromWren" | "body"> & { at: string };`
- **DeliverableView** (type) `type DeliverableView = Pick< Deliverable, "id" | "title" | "kind" | "url" | "version" | "status" | "decidedBy" | "decisionNote" > & { step: string | null; file: string | null; at: string; decidedAt: string | null; comments: CommentView[]; };`
- **DeliveryHome** (interface) `interface DeliveryHome { engagements: EngagementView[]; }`
- **EngagementView** (interface) `interface EngagementView { id: number; offer: { id: string; name: string; app: string; promise: string; guarantee: string | null; youGet: readonly string[]; youGive: readonly string[]; }; paperwork: PaperworkView; startsOn: string; status: EngagementStatus; steps: StepView[]; updates: UpdateView[]; deliverables: DeliverableView[]; asks: AskView[]; results: ResultView[]; pulse: PulseView; moments: MomentView[]; next: NextView[]; }`
- **InvoiceView** (type) `type InvoiceView = Pick< Invoice, | "id" | "number" | "description" | "cents" | "currency" | "issuedOn" | "dueOn" | "paidOn" | "refundedCents" | "dispute" | "receivedCents" | "lines" > & { status: InvoiceStatus | "overdue"; offer: string; };`
- **MilestoneState** (type) `type MilestoneState = "done" | "late" | "now" | "next";`
- **MomentView** (interface) `interface MomentView { moment: string; label: string; reachedOn: string; mine: ReviewView | null; reviews: ReviewView[]; }`
- **NextView** (interface) `interface NextView { id: string; name: string; promise: string; pitch: string; interested: boolean; }`
- **PaperworkView** (interface) `interface PaperworkView { contract: { issuedAt: string; signedBy: string | null; signedAt: string | null } | null; setupPaid: boolean | null; access: AccessView[]; }`
- **PulseView** (interface) `interface PulseView { week: string; mine: number | null; scores: number[]; }`
- **ResultView** (interface) `interface ResultView { key: string; label: string; unit: string; value: number | null; note: string | null; at: string | null; }`
- **ReviewView** (interface) `interface ReviewView { email: string; score: number | null; words: string | null; mayQuote: QuoteConsent; }`
- **StepView** (interface) `interface StepView extends Pick< Milestone, "key" | "name" | "plannedFrom" | "plannedTo" | "dueOn" | "doneOn" | "slipReason" | "promised" > { state: MilestoneState; }`
- **UpdateView** (type) `type UpdateView = Pick<Update, "id" | "author" | "body" | "internal"> & { step: string | null; at: string; hidden: boolean; comments: CommentView[]; };`
- **boughtBy** (function) `(db: Queryable, clientId: string): Promise< { id: number; offerId: string; offer: string; app: string; addOn: string | null; startsOn: string; status: EngagementStatus; }[] >`
- **deliveryHome** (function) `(db: Queryable, clientId: string, opts: { operator: boolean; today?: string; email?: string | null }): Promise<DeliveryHome>`
- **invoicesOf** (function) `(db: Queryable, clientId: string, today = todayUtc()): Promise<InvoiceView[]>`
- **storedFile** (function) `(db: Queryable, clientId: string, of: { deliverableId: number } | { askId: number }): Promise<string | null>`
- **timeline** (function) `(db: Queryable, clientId: string, opts: { operator: boolean; engagementId?: number; before?: number; limit?: number }): Promise<{ updates: UpdateView[]; more: boolean }>`

## packages/delivery/src/watch.ts

- **BoardRow** (interface) `interface BoardRow { clientId: string; name: string; engagementId: number | null; offer: string | null; path: string; status: Engagement["status"] | null; startsOn: string | null; phase: string | null; stepsDone: number; steps: number; next: { name: string; dueOn: string } | null; lastUpdateAt: string | null; openAsks: number; lastSeenAt: string | null; pulse: number | null; risks: string[]; }`
- **DeliveryWatch** (type) `type DeliveryWatch = ReturnType<typeof makeDeliveryWatch>;`
- **PortalMail** (interface) `interface PortalMail { to: string; subject: string; text: string; attachments?: readonly { filename: string; contentType: string; content: Uint8Array }[]; }`
- **WATCH** (const) `"DeliveryWatch"`
- **WATCH_KEY** (const) `"fleet"`
- **WatchDeps** (interface) `interface WatchDeps { main: Db; send: ((m: PortalMail) => Promise<void>) | null; app: string; zone: string; notifier?: Notifier; ops?: Notifier; fire?: FireTriggers; failures?: { of(client: string | null): Promise<FailedRun[]>; name(workflow: string): string; }; }`
- **WatchStats** (interface) `interface WatchStats { welcomed: number; contracts: number; told: number; digests: number; raised: number; cleared: number; alerted: number; scored: number; fired: Fired[]; moments: number; reminded: number; heard: number; failed: number; lastError: string | null; sample: boolean; }`
- **makeDeliveryWatch** (function) `(deps: WatchDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<WatchStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<WatchStats>>; start: (ctx: restate.Ob…`

## packages/delivery/src/webhooks.ts

- **webhooksApi** (function) `(deps: { main: Db }): { webhooks: (req: PortalRequest) => Promise<{ webhooks: import("@wren/core/webhooks").SubscriptionView[]; deliveries: import("@wren/core/webhooks").DeliveryView[]; events: { id: string; says: "A lead came in through a door" | "A form was filled" | "A lead replied by email, text or DM" | "A call was …`

## packages/delivery/src/work.ts

- **CommentOn** (type) `type CommentOn = { updateId: number } | { deliverableId: number };`
- **addAsk** (function) `(db: Queryable, e: Engagement, input: { text: string; dueOn?: string | undefined; milestone?: string | undefined; by: string }): Promise<Ask>`
- **addComment** (function) `(db: Queryable, clientId: string, input: { on: CommentOn; body: string; by: string; fromWren: boolean }): Promise<Comment>`
- **addDeliverable** (function) `(db: Queryable, e: Engagement, input: { title: string; kind: DeliverableKind; url?: string | undefined; fileKey?: string | undefined; milestone?: string | undefined; replaces?: number | undefined; by: string; }): Promise<Deliverable>`
- **answerAsk** (function) `(db: Queryable, clientId: string, input: { id: number; answer?: string | undefined; fileKey?: string | undefined; by: string }): Promise<Ask>`
- **datedPlan** (function) `(offer: Offer, startsOn: string): { phase: import("@wren/offers").Phase; position: number; plannedFrom: string; plannedTo: string | null; asksDue: string; }[]`
- **decideDeliverable** (function) `(db: Queryable, clientId: string, input: { id: number; decision: Exclude<DeliverableState, "waiting">; note?: string | undefined; by: string; }): Promise<Deliverable>`
- **hideUpdate** (function) `(db: Queryable, clientId: string, id: number): Promise<void>`
- **markDone** (function) `(db: Queryable, e: Engagement, input: { milestone: string; on: string | null }): Promise<Milestone>`
- **postUpdate** (function) `(db: Queryable, e: Engagement, input: { body: string; author: string; milestone?: string | undefined; internal?: boolean | undefined; at?: Date | undefined; }): Promise<Update>`
- **recordPulse** (function) `(db: Queryable, e: Engagement, input: { email: string; score: number; note?: string | undefined; today?: string }): Promise<void>`
- **recordResult** (function) `(db: Queryable, e: Engagement, input: { key: string; value: number; note?: string | undefined; by: string }): Promise<void>`
- **setEngagementSource** (function) `(db: Queryable, clientId: string, id: number, source: { channel: string | null; campaign: string | null }): Promise<void>`
- **setEngagementStatus** (function) `(db: Queryable, clientId: string, id: number, status: EngagementStatus): Promise<void>`
- **slipMilestone** (function) `(db: Queryable, e: Engagement, input: { milestone: string; to: string; reason: string }): Promise<Milestone>`
- **startEngagement** (function) `(db: Queryable, input: { clientId: string; offerId: string; startsOn: string; by: string; status?: "onboarding" | "active"; }): Promise<Engagement>`

## packages/offers/src/terms.ts

- **Terms** (interface) `interface Terms { currency: string; setupCents: number; monthlyCents: number | null; perUnitCents: number | null; unit: string | null; capCents: number | null; days: number | null; until?: number | null; refundIfNone?: { minContacts: number } | null; payDays: number; shareBps?: number | null; floorCents?: number | null; installments?: { count: number; everyDays: number } | null; trialDays?: number | null; }`
