# @wren/books: interface

Exports: 181. Files: 27.

## packages/books/src/alerts.ts

- **Condition** (interface) `interface Condition { key: string; kind: AlertKind; message: string; }`
- **bookConditions** (function) `(db: Db, on: string): Promise<Condition[]>`
- **openAlerts** (function) `(db: Db, kind?: AlertKind): Promise<{ key: string; kind: "held" | "unread" | "card" | "capture" | "new_subscription" | "renewal" | "lapsed" | "spike"; message: string; raisedAt: Date; clearedAt: Date | null; }[]>`
- **settleAlerts** (function) `(db: Db, kinds: readonly AlertKind[], open: readonly Condition[]): Promise<Condition[]>`

## packages/books/src/bills.ts

- **billsStep** (function) `(d: BillsStepDeps): Step`

## packages/books/src/capture.ts

- **CaptureOptions** (interface) `interface CaptureOptions { since: string; store: DocumentStore; runId?: string | null; vendorSpecs?: readonly VendorSpec[]; log?: (line: string) => void; }`
- **Captured** (interface) `interface Captured { mailbox: string; found: number; known: number; kept: number; attachments: number; unmatched: number; }`
- **capture** (function) `(db: Db, mailbox: Mailbox, opts: CaptureOptions): Promise<Captured>`

## packages/books/src/card.ts

- **AlertsRead** (interface) `interface AlertsRead { read: number; added: number; }`
- **CARD_ALERT_SPEC** (const) `VendorSpec`
- **CardMatch** (interface) `interface CardMatch { matched: number; charged: number; made: number; }`
- **amountPrinted** (function) `(amount: number, text: string): boolean`
- **cardVendor** (function) `(descriptor: string, specs: readonly VendorSpec[] = VENDORS): VendorSpec | null`
- **csvRows** (function) `(text: string): string[][]`
- **descriptorOf** (function) `(description: string): string`
- **descriptorOfLine** (function) `(db: Db, id: number): Promise<string | null>`
- **endSubscription** (function) `(db: Db, vendorKey: string, endedOn: string, plan?: string | null): Promise<void>`
- **fingerprints** (function) `(lines: readonly StatementLine[]): string[]`
- **importStatement** (function) `(db: Db, store: DocumentStore, file: { bytes: Uint8Array; filename: string; card?: string }, runId: string | null = null): Promise<CardImport>`
- **matchCard** (function) `(db: Db, on: string, runId: string | null = null): Promise<CardMatch>`
- **parseStatement** (function) `(text: string, card?: string): StatementLine[]`
- **readCardAlerts** (function) `(db: Db, llm: LlmClient, opts: { runId?: string | null; tracer?: Tracer | null; card?: string } = {}): Promise<AlertsRead>`
- **ruleCard** (function) `(db: Db, descriptor: string, to: { vendor: string } | "personal"): Promise<number>`
- **sortCard** (function) `(db: Db): Promise<number>`
- **statementDay** (function) `(s: string): string`
- **unsortedCard** (function) `(db: Db): Promise<{ descriptor: string; lines: number; last: string; }[]>`

## packages/books/src/chart.ts

- **CARD** (const) `"card-bmo"`
- **GST_PAID** (const) `"gst-paid"`
- **MailSpec** (interface) `interface MailSpec { from: readonly string[]; subject?: readonly string[]; }`
- **VENDORS** (const) `readonly VendorSpec[]`
- **VendorSpec** (interface) `interface VendorSpec { key: string; name: string; account: string; mail: MailSpec; currency?: string; cycle?: BillCycle; plansOnly?: boolean; plan?: string; gstClaimable?: boolean; card?: readonly string[]; }`
- **seedBooks** (function) `(db: Queryable): Promise<void>`
- **vendorSpec** (function) `(key: string): VendorSpec | undefined`

## packages/books/src/components.ts

- **BOOKS_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/books/src/console-routes.ts

- **BOOKS_CONSOLE_APPS** (const) `{ readonly "*": "money"; }`
- **BOOKS_CONSOLE_ROUTES** (const) `{ readonly setAccount: "wren:money"; }`
- **BOOKS_CONSOLE_WRITES** (const) `readonly (keyof typeof BOOKS_CONSOLE_ROUTES)[]`

## packages/books/src/console.ts

- **AccountRequest** (interface) `interface AccountRequest extends PortalRequest { ids: string[]; bucket?: string | null; channel?: string | null; }`
- **booksConsoleApi** (function) `(db: Db): { setAccount(req: AccountRequest): Promise<{ done: string[]; }>; }`
- **makeBooksConsole** (function) `(db: Db): restate.ServiceDefinition<"BooksConsole", { setAccount: (_: restate.Context, req: AccountRequest) => Promise<{ done: string[]; }>; }>`

## packages/books/src/daily.ts

- **BooksDay** (interface) `interface BooksDay { captured: Captured[]; unreachable: Array<{ mailbox: string; error: string }>; read: ReadReport; card: AlertsRead & CardMatch & { sorted: number }; posted: Posted; aws: UsageIngest | null; usageLines: { month: string; lines: number; amountCents: number }[]; raised: string[]; }`
- **BooksDayDeps** (interface) `interface BooksDayDeps { db: Db; mailboxes: readonly Mailbox[]; store: DocumentStore; llm: LlmClient; rates: RateFeed; aws: UsageFeed | null; decrypts?: DecryptFeed | null; since: string; log?: (line: string) => void; }`
- **booksDay** (function) `(deps: BooksDayDeps, now: Date, runId: string | null): Promise<BooksDay>`

## packages/books/src/day.ts

- **shiftDay** (function) `(day: string, n: number): string`
- **today** (function) `(now: Date = new Date()): string`

## packages/books/src/decrypts.ts

- **DecryptFeed** (type) `type DecryptFeed = (from: Date, to: Date) => Promise<Map<string, number>>;`
- **cloudTrailDecrypts** (function) `(client: CloudTrailClient = new CloudTrailClient({ region: "us-east-1" })): DecryptFeed`
- **decryptSpikes** (function) `(day: ReadonlyMap<string, number>, before: ReadonlyMap<string, number>): DecryptSpike[]`
- **principalOf** (function) `(id: Identity | undefined): string`

## packages/books/src/economics.ts

- **UNKNOWN_CHANNEL** (const) `"unknown"`
- **econChannels** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"econ_channels", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "econ_channels"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAuto…`
- **econClientMonths** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"econ_client_months", false, { clientId: import("drizzle-orm/pg-core").PgColumn<{ name: "client_id"; tableName: "econ_client_months"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPr…`
- **econCohorts** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"econ_cohorts", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "econ_cohorts"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoin…`
- **econMonths** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"econ_months", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "econ_months"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincr…`
- **econPaid** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"econ_paid", false, { invoiceId: import("drizzle-orm/pg-core").PgColumn<{ name: "invoice_id"; tableName: "econ_paid"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimar…`

## packages/books/src/ground.ts

- **Checked** (interface) `interface Checked { kind: DocumentKind; bill: CheckedBill | null; payments: CheckedPayment[]; notes: string[]; }`
- **CheckedBill** (interface) `interface CheckedBill { number: string; kind: "invoice" | "receipt" | "credit_note"; issuedOn: string; dueOn: string | null; periodStart: string | null; periodEnd: string | null; currency: string; subtotalCents: number; taxCents: number; totalCents: number; chargedCadCents: number | null; plan: string | null; cycle: BillCycle | null; paymentMethod: string | null; billedTo: string | null; vendorTaxNumber: string | null; lines: CheckedLine[]; taxes: CheckedTax[]; reasons: string[]; }`
- **Reading** (const) `z.ZodObject<{ kind: z.ZodOptional<z.ZodNullable<z.ZodString>>; bill: z.ZodOptional<z.ZodNullable<z.ZodObject<{ number: z.ZodOptional<z.ZodNullable<z.ZodString>>; kind: z.ZodOptional<z.ZodNullable<z.ZodString>>; issued_on: z.ZodOptional<z.ZodNullable<z.ZodString>>; due_on: z.ZodOptional<z.ZodNullable…`
- **VendorFacts** (interface) `interface VendorFacts { name: string; currency: string | null; cycle: BillCycle | null; plansOnly?: boolean; plan?: string | null; gstClaimable: boolean | null; }`
- **check** (function) `(reading: Reading, corpus: Corpus, vendor: VendorFacts): Checked`
- **invoiceNumber** (function) `(s: string): string`
- **isDay** (function) `(value: string | null | undefined): value is string`
- **printedDays** (function) `(text: string): Set<string>`

## packages/books/src/mailbox.ts

- **billingQuery** (function) `(vendorSpecs: readonly VendorSpec[], since: string): string`
- **mailClause** (function) `(mail: MailSpec): string`
- **vendorFor** (function) `(vendorSpecs: readonly VendorSpec[], fromAddress: string, subject: string): VendorSpec | null`

## packages/books/src/money.ts

- **currencyOf** (function) `(printed: string): string | null`
- **formatCents** (function) `(cents: number): string`
- **formatMoney** (function) `(cents: number, currency: string): string`
- **mentionsCurrency** (function) `(text: string, code: string): boolean`
- **parseCents** (function) `(printed: string): number | null`
- **printedCents** (function) `(text: string): Set<number>`
- **toCad** (function) `(cents: number, rate: string): number`

## packages/books/src/post.ts

- **PostOptions** (interface) `interface PostOptions { feed: RateFeed; runId?: string | null; log?: (line: string) => void; }`
- **Posted** (interface) `interface Posted { posted: number; reversed: number; unchanged: number; }`
- **planLines** (function) `(db: Db, feed: RateFeed, bill: Bill, vendorName: string, claimableCents: number, ids: { card: number; gst: number }): Promise<PlannedLine[]>`
- **post** (function) `(db: Db, opts: PostOptions): Promise<Posted>`

## packages/books/src/rates.ts

- **RateFeed** (type) `type RateFeed = ( currency: string, from: string, to: string, ) => Promise<Array<{ on: string; cadPerUnit: string }>>;`
- **bankOfCanada** (function) `(fetchFn: typeof fetch = fetch): RateFeed`
- **bocRate** (function) `(db: Db, feed: RateFeed, currency: string, on: string): Promise<{ rate: string; on: string }>`

## packages/books/src/read.ts

- **ReadReport** (interface) `interface ReadReport { read: number; bills: number; payments: number; review: number; unreadable: number; voided: number; }`
- **Readable** (interface) `interface Readable { subject: string | null; fromAddress: string | null; sentAt: Date | null; text: string | null; attachments: ReadonlyArray<{ filename: string | null; text: string | null }>; }`
- **assignVendor** (function) `(db: Db, ids: readonly number[], vendorKey: string): Promise<number>`
- **dismissDocuments** (function) `(db: Db, ids: readonly number[]): Promise<number>`
- **readDocuments** (function) `(db: Db, llm: LlmClient, opts: ReadOptions = {}): Promise<ReadReport>`
- **setReview** (function) `(db: Db, billId: number, review: "accepted" | "personal"): Promise<Bill | undefined>`

## packages/books/src/records.ts

- **BOOKS_RECORDS** (const) `import("@wren/core/records").RecordType[]`
- **accountRecord** (const) `import("@wren/core/records").RecordType`

## packages/books/src/report.ts

- **Range** (interface) `interface Range { from?: string; to?: string; }`
- **billDetail** (function) `(db: Db, id: number): Promise<{ bill: { id: number; vendorId: number; number: string; kind: "invoice" | "receipt" | "credit_note"; issuedOn: string; dueOn: string | null; periodStart: string | null; periodEnd: string | null; currency: string; subtotalCents: number; taxCents: number; totalCents: number; chargedCadCents: n…`
- **getDocument** (function) `(db: Db, id: number): Promise<{ id: number; sha256: string; mediaType: string; size: number; storeKey: string; source: "file" | "mailbox" | "attachment"; parentId: number | null; filename: string | null; mailbox: string | null; mailboxKey: string | null; messageId: string | null; fromAddress: string | null; fromName: str…`
- **listBills** (function) `(db: Db, opts: Range & { vendor?: string; review?: boolean } = {}): Promise<{ billId: number | null; vendorId: number | null; vendor: string | null; vendorName: string | null; number: string | null; kind: string | null; issuedOn: string | null; periodStart: string | null; periodEnd: string | null; currency: string | null; totalCents: number | null; taxCents: number …`
- **listPayments** (function) `(db: Db, opts: Range & { vendor?: string } = {}): Promise<{ id: number; paidOn: string; vendor: string; invoiceNumber: string | null; billId: number | null; amountCents: number; currency: string; method: string | null; reference: string | null; documentId: number; }[]>`
- **listSpend** (function) `(db: Db, opts: Range = {}): Promise<{ month: string | null; account: string | null; accountName: string | null; t2125Line: string | null; vendor: string | null; vendorName: string | null; cadCents: number | null; }[]>`
- **listSubscriptions** (function) `(db: Db, opts: { on?: string } = {}): Promise<{ vendorId: number | null; vendor: string | null; vendorName: string | null; plan: string | null; cycle: string | null; currency: string | null; lastTotalCents: number | null; lastCadCents: number | null; lastBilledOn: string | null; renewsOn: string | null; monthlyCadCents: number | null; s…`
- **reviewQueue** (function) `(db: Db): Promise<{ bills: { id: number; vendor: string; number: string; issuedOn: string; totalCents: number; currency: string; reasons: string[]; }[]; payments: { id: number; vendor: string; invoiceNumber: string | null; paidOn: string; amountCents: number; currency: string; documentId: number; }[]; documen…`

## packages/books/src/restate.ts

- **BOOKS_KEY** (const) `"all"`
- **Books** (type) `type Books = ReturnType<typeof makeBooks>;`
- **makeBooks** (function) `(deps: BooksDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<BooksDay>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<BooksDay>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) => Pro…`

## packages/books/src/schema.ts

- **ACCOUNT_TYPES** (const) `readonly ["asset", "liability", "equity", "income", "expense"]`
- **ALERT_KINDS** (const) `readonly ["capture", "held", "unread", "new_subscription", "renewal", "lapsed", "spike", "card"]`
- **Account** (type) `type Account = typeof accounts.$inferSelect;`
- **AccountType** (type) `type AccountType = (typeof ACCOUNT_TYPES)[number];`
- **AlertKind** (type) `type AlertKind = (typeof ALERT_KINDS)[number];`
- **BILL_CYCLES** (const) `readonly ["monthly", "yearly", "usage", "once"]`
- **BILL_KINDS** (const) `readonly ["invoice", "receipt", "credit_note"]`
- **BOOKS_CONSOLE_VIEWS** (const) `readonly ["books.spend", "books.subscriptions", "books.usage_by_month"]`
- **BUCKETS** (const) `readonly ["acquisition", "delivery", "overhead"]`
- **Bill** (type) `type Bill = typeof bills.$inferSelect;`
- **BillCycle** (type) `type BillCycle = (typeof BILL_CYCLES)[number];`
- **BillLine** (type) `type BillLine = typeof billLines.$inferSelect;`
- **BillPayment** (type) `type BillPayment = typeof billPayments.$inferSelect;`
- **BillTax** (type) `type BillTax = typeof billTaxes.$inferSelect;`
- **Bucket** (type) `type Bucket = (typeof BUCKETS)[number];`
- **CARD_SOURCES** (const) `readonly ["statement", "alert"]`
- **CardLine** (type) `type CardLine = typeof cardLines.$inferSelect;`
- **CardSource** (type) `type CardSource = (typeof CARD_SOURCES)[number];`
- **DOCUMENT_KINDS** (const) `readonly ["bill", "payment", "notice", "other"]`
- **DOCUMENT_SOURCES** (const) `readonly ["mailbox", "file", "attachment"]`
- **Document** (type) `type Document = typeof documents.$inferSelect;`
- **DocumentKind** (type) `type DocumentKind = (typeof DOCUMENT_KINDS)[number];`
- **Entry** (type) `type Entry = typeof entries.$inferSelect;`
- **Line** (type) `type Line = typeof lines.$inferSelect;`
- **RATE_SOURCES** (const) `readonly ["same", "boc", "stated", "card"]`
- **REVIEW_STATES** (const) `readonly ["ok", "needs_review", "accepted", "personal", "void"]`
- **RateSource** (type) `type RateSource = (typeof RATE_SOURCES)[number];`
- **ReviewState** (type) `type ReviewState = (typeof REVIEW_STATES)[number];`
- **USAGE_LINE_STATES** (const) `readonly ["draft", "on_invoice"]`
- **USAGE_PROVIDERS** (const) `readonly ["aws"]`
- **UsageLine** (type) `type UsageLine = typeof usageLines.$inferSelect;`
- **UsageLineState** (type) `type UsageLineState = (typeof USAGE_LINE_STATES)[number];`
- **UsageProvider** (type) `type UsageProvider = (typeof USAGE_PROVIDERS)[number];`
- **Vendor** (type) `type Vendor = typeof vendors.$inferSelect;`
- **accounts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "accounts"; schema: "books"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "accounts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKe…`
- **alerts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "alerts"; schema: "books"; columns: { key: import("drizzle-orm/pg-core").PgColumn<{ name: "key"; tableName: "alerts"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: …`
- **billCosts** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"bill_costs", false, { billId: import("drizzle-orm/pg-core").PgColumn<{ name: "bill_id"; tableName: "bill_costs"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey…`
- **billDocuments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "bill_documents"; schema: "books"; columns: { billId: import("drizzle-orm/pg-core").PgColumn<{ name: "bill_id"; tableName: "bill_documents"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true…`
- **billLines** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "bill_lines"; schema: "books"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "bill_lines"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrima…`
- **billPayments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "bill_payments"; schema: "books"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "bill_payments"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **billTaxes** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "bill_taxes"; schema: "books"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "bill_taxes"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrima…`
- **bills** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "bills"; schema: "books"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "bills"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: fal…`
- **books** (const) `import("drizzle-orm/pg-core").PgSchema<"books">`
- **cardLines** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "card_lines"; schema: "books"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "card_lines"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrima…`
- **cardRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"card_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "card_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: fal…`
- **cardRules** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "card_rules"; schema: "books"; columns: { descriptor: import("drizzle-orm/pg-core").PgColumn<{ name: "descriptor"; tableName: "card_rules"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault:…`
- **documents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "documents"; schema: "books"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "documents"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`
- **entries** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "entries"; schema: "books"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "entries"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey:…`
- **lines** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "lines"; schema: "books"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "lines"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: fal…`
- **rates** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "rates"; schema: "books"; columns: { on: import("drizzle-orm/pg-core").PgColumn<{ name: "on"; tableName: "rates"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey…`
- **spend** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"spend", false, { month: import("drizzle-orm/pg-core").PgColumn<{ name: "month"; tableName: "spend"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincr…`
- **spendRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"spend_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "spend_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAuto…`
- **subscriptionEnds** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "subscription_ends"; schema: "books"; columns: { vendorId: import("drizzle-orm/pg-core").PgColumn<{ name: "vendor_id"; tableName: "subscription_ends"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; not…`
- **subscriptionRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"subscription_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "subscription_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey:…`
- **subscriptions** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"subscriptions", false, { vendorId: import("drizzle-orm/pg-core").PgColumn<{ name: "vendor_id"; tableName: "subscriptions"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; is…`
- **usage** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "usage"; schema: "books"; columns: { on: import("drizzle-orm/pg-core").PgColumn<{ name: "on"; tableName: "usage"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey…`
- **usageByMonth** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"usage_by_month", false, { month: import("drizzle-orm/pg-core").PgColumn<{ name: "month"; tableName: "usage_by_month"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey:…`
- **usageLines** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "usage_lines"; schema: "books"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "usage_lines"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPri…`
- **vendors** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "vendors"; schema: "books"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "vendors"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey:…`

## packages/books/src/store.ts

- **DocumentStore** (interface) `interface DocumentStore { put(key: string, bytes: Uint8Array, mediaType: string): Promise<void>; get(key: string): Promise<Uint8Array>; }`
- **dirStore** (function) `(root: string): { put(key: string, bytes: Uint8Array<ArrayBufferLike>): Promise<void>; get(key: string): Promise<Uint8Array<ArrayBuffer>>; }`
- **s3Store** (function) `(bucket: string, opts: { client?: S3Client; region?: string } = {}): { put(key: string, bytes: Uint8Array<ArrayBufferLike>, mediaType: string): Promise<void>; get(key: string): Promise<Uint8Array<ArrayBufferLike>>; }`
- **sha256** (function) `(bytes: Uint8Array): string`
- **storeKey** (function) `(hash: string, mediaType: string): string`

## packages/books/src/text.ts

- **bodyText** (function) `(message: MimePart): string`

## packages/books/src/usage-lines.ts

- **monthBounds** (function) `(month: string): { from: Date; to: Date; day: string }`
- **monthOf** (function) `(d: Date): string`
- **usageLinesOf** (function) `(main: Db, month: string, client?: string | null): Promise<UsageLine[]>`
- **writeUsageLines** (function) `(main: Db, month: string): Promise<{ lines: number; costCents: number; amountCents: number; kept: number }>`

## packages/books/src/usage.ts

- **UsageDay** (interface) `interface UsageDay { on: string; service: string; currency: string; amount: string; }`
- **UsageFeed** (type) `type UsageFeed = (from: string, to: string) => Promise<UsageDay[]>;`
- **UsageIngest** (interface) `interface UsageIngest { from: string; to: string; rows: number; }`
- **awsCostExplorer** (function) `(client: CostExplorerClient = new CostExplorerClient({ region: "us-east-1" })): UsageFeed`
- **ingestUsage** (function) `(db: Db, provider: UsageProvider, feed: UsageFeed, opts: { since: string; on: string }): Promise<UsageIngest>`
- **shiftMonth** (function) `(day: string, n: number): string`
- **usageByService** (function) `(db: Db, provider: UsageProvider, from: string, to: string): Promise<{ service: string; currency: string; amount: number }[]>`
- **usageMonth** (function) `(db: Db, provider: UsageProvider, on: string): Promise<UsageMonth[]>`
- **usageSpikes** (function) `(db: Db, provider: UsageProvider, on: string): Promise<Spike[]>`

## packages/core/src/mailbox.ts

- **DelegatedGmail** (interface) `interface DelegatedGmail { searchAll(sender: string, query: string): Promise<string[]>; getRaw(sender: string, messageId: string): Promise<Uint8Array>; getMetadata(sender: string, messageId: string, headers: readonly string[]): Promise<unknown>; }`
- **Mailbox** (interface) `interface Mailbox { readonly address: string; search(query: string): Promise<string[]>; raw(id: string): Promise<Uint8Array>; meta(id: string): Promise<MailMeta>; }`
- **delegatedMailbox** (function) `(gmail: DelegatedGmail, address: string): Mailbox`
- **siteMailbox** (function) `(sites: SiteClient, address: string): Mailbox`
