# @wren/core: interface

Exports: 2340. Files: 224.

## packages/core/src/access-records.ts

- **ACCESS_SHAPES** (const) `readonly RecordType[]`
- **ACCESS_TYPES** (const) `readonly ["access.role", "access.grant", "access.issue", "access.ask", "access.review"]`
- **ASK** (const) `"access.ask"`
- **ISSUE** (const) `"access.issue"`
- **REVIEW** (const) `"access.review"`
- **ROLE** (const) `"access.role"`
- **accessRecords** (function) `(o: AccessReader): RecordType[]`

## packages/core/src/access.ts

- **ACCESS_CHANNELS** (const) `readonly ["youtube", "linkedin", "x", "tiktok", "instagram", "facebook", "reddit", "google_business", "email", "sms", "phone"]`
- **ADMIN_ONLY_AT_WREN** (const) `readonly Permission[]`
- **APPROVERS** (const) `readonly ["wren", "client", "either"]`
- **APPS** (const) `Readonly<Record<string, string>>`
- **AccessChannel** (type) `type AccessChannel = (typeof ACCESS_CHANNELS)[number];`
- **App** (type) `type App = keyof typeof APPS & string;`
- **Approver** (type) `type Approver = (typeof APPROVERS)[number];`
- **BUILT_IN_ROLES** (const) `readonly { id: TeamRole | MemberRole; name: string; about: string; side: "team" | "client" | "both"; }[]`
- **CHANNEL_NAMES** (const) `Readonly<Record<AccessChannel, string>>`
- **Cap** (interface) `interface Cap { verbs: readonly Permission[]; apps?: readonly string[]; }`
- **Grant** (interface) `interface Grant { verbs: readonly Permission[]; scope: Scope; until?: string | null; usesLeft?: number | null; id?: number; role?: RoleId; builtIn?: true; reason?: string | null; }`
- **MEMBER_GRANTS** (const) `Readonly<Record<MemberRole, readonly Permission[]>>`
- **MEMBER_ROLES** (const) `readonly ["owner", "member", "viewer"]`
- **MemberRole** (type) `type MemberRole = (typeof MEMBER_ROLES)[number];`
- **Need** (type) `type Need = Permission | 'wren:${Permission}';`
- **PERMISSIONS** (const) `readonly ["read", "act", "run", "effect", "money", "manage", "team", "comment"]`
- **Permission** (type) `type Permission = (typeof PERMISSIONS)[number];`
- **Reach** (interface) `interface Reach { channels: readonly AccessChannel[]; ids: readonly string[]; }`
- **RoleId** (type) `type RoleId = string;`
- **RouteApps** (type) `type RouteApps<R> = { readonly "*": RouteAt } & { readonly [K in keyof R]?: RouteAt };`
- **Scope** (interface) `interface Scope { client?: string | undefined; apps?: readonly string[]; channels?: readonly string[]; record?: string; }`
- **TEAM_GRANTS** (const) `Readonly<Record<TeamRole, readonly Permission[]>>`
- **TEAM_ROLES** (const) `readonly ["admin", "operator", "viewer"]`
- **Target** (interface) `interface Target { client?: string | undefined; app?: string | null; channel?: string | null; record?: string | null; }`
- **TeamRole** (type) `type TeamRole = (typeof TEAM_ROLES)[number];`
- **ViewAs** (interface) `interface ViewAs { client: string; email?: string; role?: RoleId; act?: boolean; }`
- **WREN** (const) `"wren"`
- **Who** (type) `type Who = | { demo: true } | { team: RoleId; clients: readonly string[] | null; grants?: readonly Grant[]; cap?: Cap } | { member: RoleId; client: string; grants?: readonly Grant[]; cap?: Cap } | null;`
- **can** (function) `(who: Who, p: Permission, at?: string | Target, now?: Date): boolean`
- **channelsIn** (function) `(input: unknown): AccessChannel[]`
- **covers** (function) `(scope: Scope, at: Target): boolean`
- **granted** (function) `(who: Who, at?: string | Target): Permission[]`
- **isBuiltIn** (function) `(role: string): role is TeamRole | MemberRole`
- **isChannel** (function) `(v: unknown): v is AccessChannel`
- **isNeed** (function) `(v: unknown): v is Need`
- **live** (function) `(g: Grant, now: Date = new Date()): boolean`
- **mayApprove** (function) `(who: Who, client: string | null, approver: Approver = "wren"): boolean`
- **needOf** (function) `(need: Need): { permission: Permission; wren: boolean }`
- **reach** (function) `(who: Who, p: Permission, at: { client?: string | undefined; app: string; type: string; channel: string | object | null }, now = new Date()): Reach | null`
- **refusal** (function) `(by: Who, g: Pick<Grant, "verbs" | "scope">, now = new Date()): string | null`
- **routeAt** (function) `(apps: RouteApps<object>, route: string): Target`
- **sentence** (function) `(g: Grant, now = new Date(), zone?: string): string`
- **targetsOf** (function) `(s: Scope): Target[]`
- **toSpend** (function) `(who: Who, p: Permission, at: Target, now = new Date()): Grant[] | null`
- **viewAsShape** (function) `(raw: unknown): ViewAs | null | "bad"`
- **whole** (function) `(who: Who, p: Permission, client?: string): boolean`
- **why** (function) `(who: Who, p: Permission, at?: string | Target, now = new Date()): Grant[]`

## packages/core/src/accounts-console-routes.ts

- **ACCOUNTS_CONSOLE_APPS** (const) `{ readonly "*": "account"; readonly usage: "clients"; }`
- **ACCOUNTS_CONSOLE_ROUTES** (const) `{ readonly accounts: "read"; readonly vendors: "read"; readonly now: "read"; readonly start: "act"; readonly mark: "act"; readonly checkNow: "act"; readonly addAccount: "act"; readonly setVendor: "act"; readonly limits: "read"; readonly setLimit: "act"; readonly usage: "wren:read"; }`
- **ACCOUNTS_CONSOLE_WRITES** (const) `readonly (keyof typeof ACCOUNTS_CONSOLE_ROUTES)[]`

## packages/core/src/accounts-console.ts

- **AccountRequest** (interface) `interface AccountRequest extends PortalRequest { account: number; setup: string; }`
- **AccountsView** (type) `type AccountsView = Awaited<ReturnType<ReturnType<typeof accountsApi>["accounts"]>>;`
- **LimitsView** (type) `type LimitsView = Awaited<ReturnType<ReturnType<typeof accountsApi>["limits"]>>;`
- **NowView** (type) `type NowView = Awaited<ReturnType<ReturnType<typeof accountsApi>["now"]>>;`
- **UsageView** (type) `type UsageView = Awaited<ReturnType<ReturnType<typeof accountsApi>["usage"]>>;`
- **VendorsView** (type) `type VendorsView = Awaited<ReturnType<ReturnType<typeof accountsApi>["vendors"]>>;`
- **accountsApi** (function) `(deps: AccountsDeps): { accounts(req: PortalRequest): Promise<{ owner: { id: string | null; name: string; }; team: boolean; mayAct: boolean; agent: boolean; accounts: { facts: { fact: string; label: string; state: "waiting" | "lost" | "ok"; why: string | null; checkedAt: string | null; okAt: string | null; }[]; runs: { s…`
- **makeAccountsConsole** (function) `(deps: AccountsDeps): restate.ServiceDefinition<"AccountsConsole", { accounts: (_: restate.Context, req: PortalRequest) => Promise<{ owner: { id: string | null; name: string; }; team: boolean; mayAct: boolean; agent: boolean; accounts: { facts: { fact: string; label: string; state: "waiting" | "lost" | "ok"; why: string …`

## packages/core/src/ask.ts

- **AskContext** (type) `type AskContext = (req: QuestionRequest, question: string) => Promise<string>;`
- **AskService** (type) `type AskService = { answer: (ctx: restate.Context, req: { id: string }) => Promise<void>; edit: (ctx: restate.Context, req: { id: string }) => Promise<void>; };`
- **CLAUDE** (const) `{ readonly name: "claude"; }`
- **ClaudeService** (type) `type ClaudeService = { ask: ( ctx: restate.Context, req: { question: string; system: string; dir: string; also: string[]; commands: string[]; }, ) => Promise<{ answer: string; ms: number; turns: number; model: string; denied: number }>; };`
- **DraftCommand** (type) `type DraftCommand = "draft-ask" | "draft-set" | "draft-undo";`
- **DraftEdit** (interface) `interface DraftEdit { record: string; id: string; by: string | null; at: string; before: string; after: string; }`
- **DraftTurn** (interface) `interface DraftTurn { id: string; command: DraftCommand; by: string | null; message: string | null; at: string; state: "thinking" | "done" | "failed"; reply: string | null; draft: string | null; before: string | null; error: string | null; }`
- **QuestionRequest** (interface) `interface QuestionRequest extends PortalRequest { question?: unknown; page?: unknown; }`
- **ask** (function) `(ctx: restate.Context, main: Db, req: QuestionRequest, context?: AskContext): Promise<{ id: string; }>`
- **askRecord** (const) `import("./records.js").RecordType`
- **byOf** (function) `(req: unknown): string`
- **draftAnswerOf** (function) `(text: string): z.infer<typeof DRAFT_ANSWER>`
- **draftEdits** (function) `(db: Queryable, o: { records?: readonly string[]; limit?: number } = {}): Promise<DraftEdit[]>`
- **draftTurns** (function) `(db: Queryable, record: string, id: string): Promise<DraftTurn[]>`
- **editsFor** (function) `(db: Queryable, records: readonly string[]): Promise<string>`
- **keepSentEdit** (function) `(db: Queryable, o: { record: string; id: string; by: string; before: string | null; after: string }): Promise<void>`
- **makeAsk** (function) `(main: Db): restate.ServiceDefinition<"Ask", { answer: (ctx: restate.Context, input: { id: string; }) => Promise<void>; edit: (ctx: restate.Context, input: { id: string; }) => Promise<void>; }>`
- **questionOf** (function) `(req: QuestionRequest): { by: string; question: string; page: string | null; }`
- **ASK** (const) `{ readonly name: "Ask"; }`

## packages/core/src/audit.ts

- **AuditSealer** (type) `type AuditSealer = ReturnType<typeof makeAuditSealer>;`
- **SEALER_KEY** (const) `"all"`
- **makeAuditSealer** (function) `(deps: AuditSealerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<SealerStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<SealerStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) …`
- **sealEverywhere** (function) `(deps: AuditSealerDeps): Promise<SealerStats>`

## packages/core/src/automations.ts

- **AutomationKind** (type) `type AutomationKind = "workflow" | "made" | "loop" | "keyword" | "reply";`
- **AutomationRow** (interface) `interface AutomationRow { id: string; name: string; kind: AutomationKind; trigger: string; state: AutomationState; health: "failing" | "ok"; runs: number | null; failed: number | null; waiting: number | null; lastAt: string | null; nextAt: string | null; error: string | null; ref: string; }`
- **AutomationState** (type) `type AutomationState = "on" | "off" | "draft" | "suggest" | "auto";`
- **automationRecord** (function) `(o: { workflows: readonly Workflow[]; components: readonly Component[]; loops?: (() => Promise<LoopRow[]>) | null; }): RecordType`
- **automationRows** (function) `(i: AutomationInput): AutomationRow[]`
- **triggerWords** (function) `(w: Pick<Workflow, "nodes" | "in">): string`

## packages/core/src/bounces-schema.ts

- **BOUNCE_CLASSES** (const) `readonly ["hard", "soft"]`
- **BOUNCE_MATCHES** (const) `readonly ["message_id", "address"]`
- **BounceClass** (type) `type BounceClass = (typeof BOUNCE_CLASSES)[number];`
- **BounceMatch** (type) `type BounceMatch = (typeof BOUNCE_MATCHES)[number];`
- **mailBounceReads** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "mail_bounce_reads"; schema: undefined; columns: { mailbox: import("drizzle-orm/pg-core").PgColumn<{ name: "mailbox"; tableName: "mail_bounce_reads"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true…`
- **mailBounces** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "mail_bounces"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "mail_bounces"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`

## packages/core/src/bounces.ts

- **BOUNCE_LATE_MS** (const) `number`
- **BounceVerdict** (type) `type BounceVerdict = "seen" | "unmatched" | "soft" | "suppressed" | "mismatch";`
- **bounceMailboxes** (function) `(db: Queryable, now: Date): Promise<string[]>`
- **bouncesReadAt** (function) `(db: Queryable, mailbox: string): Promise<Date | null>`
- **keptBounces** (function) `(db: Queryable, mailbox: string, providerIds: readonly string[]): Promise<Set<string>>`
- **keptMessageId** (function) `(id: string): string`
- **markBouncesRead** (function) `(db: Queryable, mailbox: string, at: Date, stats: Record<string, unknown>): Promise<void>`
- **mintMessageId** (function) `(domain: string): string`
- **noteBounceSender** (function) `(db: Queryable, mailbox: string, at: Date): Promise<void>`
- **recordBounce** (function) `(db: Queryable, r: BounceReport): Promise<BounceVerdict>`
- **sendOf** (function) `(db: Queryable, r: Pick<BounceReport, "messageIds" | "address" | "receivedAt">): Promise<Send | null>`

## packages/core/src/broadcast-records.ts

- **BROADCAST_RECORDS** (const) `import("./records.js").RecordType[]`
- **BroadcastDetail** (interface) `interface BroadcastDetail { results: BroadcastResults | null; version: string; }`
- **broadcastDetail** (function) `(db: Queryable, id: string): Promise<BroadcastDetail | null>`

## packages/core/src/broadcast-run.ts

- **BROADCAST** (const) `{ readonly name: "Broadcast"; }`
- **BroadcastObject** (type) `type BroadcastObject = ReturnType<typeof makeBroadcast>;`
- **broadcastKey** (function) `(client: string | null, id: number): string`
- **makeBroadcast** (function) `(d: BroadcastDeps): restate.VirtualObjectDefinition<"Broadcast", { schedule: (ctx: restate.ObjectContext, input: { at: string; }) => Promise<{ gen: number; at: string; }>; run: (ctx: restate.ObjectContext, input: { gen: number; }) => Promise<RunStats | { skipped: string; waiting?: never; } | { waiting: string; skipped?…`

## packages/core/src/broadcasts-schema.ts

- **BROADCAST_CHANNELS** (const) `readonly ["email", "sms"]`
- **BROADCAST_STATES** (const) `readonly ["draft", "waiting", "scheduled", "sending", "sent", "declined", "canceled"]`
- **BroadcastChannel** (type) `type BroadcastChannel = (typeof BROADCAST_CHANNELS)[number];`
- **BroadcastState** (type) `type BroadcastState = (typeof BROADCAST_STATES)[number];`
- **RECIPIENT_STATES** (const) `readonly ["due", "held", "sending", "queued", "sent", "skipped", "failed"]`
- **RecipientState** (type) `type RecipientState = (typeof RECIPIENT_STATES)[number];`
- **broadcastRecipientRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"broadcast_recipient_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "broadcast_recipient_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDef…`
- **broadcastRecipients** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "broadcast_recipients"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "broadcast_recipients"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; has…`
- **broadcastRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"broadcast_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "broadcast_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrima…`
- **broadcasts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "broadcasts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "broadcasts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPri…`

## packages/core/src/broadcasts.ts

- **BroadcastInput** (interface) `interface BroadcastInput { id?: number | null; name?: string; channel?: BroadcastChannel; segmentId?: number; topic?: string | number; subject?: string | null; body?: string; sendAt?: string | null; local?: boolean; zone?: string; ask?: boolean; expect?: string | null; }`
- **BroadcastMail** (interface) `interface BroadcastMail { send(m: { to: string; subject: string; text: string; headers: [string, string][]; messageId: string; }): Promise<void>; envelope( address: string, topic: { name: string; publicName: string }, ): { footer: string; headers: [string, string][] }; domain: string; daily: number; }`
- **BroadcastResults** (interface) `interface BroadcastResults { ladder: { state: string; n: number; link: string }[]; skipped: { why: string; n: number; link: string }[]; held: number; failed: number; }`
- **EMAIL_BATCH** (const) `20`
- **EMAIL_DAILY** (const) `1500`
- **EMAIL_PAUSE_MS** (const) `30000`
- **MailOf** (type) `type MailOf = (client: string | null, db: Queryable) => Promise<BroadcastMail | MailUnset>;`
- **MailUnset** (interface) `interface MailUnset { unset: string; }`
- **Outcome** (type) `type Outcome = | { state: "sent" | "queued" } | { state: "held"; until: string; why: string } | { state: "skipped" | "failed"; why: string } | { state: "gone" };`
- **PERSONAL_DAILY** (const) `400`
- **TEXT_BATCH** (const) `200`
- **TEXT_MOST** (const) `459`
- **askBroadcast** (function) `(db: Queryable, id: number, by: string, now: Date): Promise<{ name: string; id: number; startedAt: Date | null; finishedAt: Date | null; state: "sent" | "draft" | "sending" | "waiting" | "declined" | "scheduled" | "canceled"; channel: "email" | "sms"; by: string; createdAt: Date; updatedAt: Date; subject: string | null; body: string; note: string | n…`
- **broadcastById** (function) `(db: Queryable, id: number): Promise<Broadcast | null>`
- **broadcastContext** (function) `(db: Queryable): Promise<{ segments: { id: number; name: string; size: number; }[]; topics: { id: number; name: string; publicName: string; channel: "email" | "sms"; }[]; fields: ("name" | "first_name")[]; textMost: number; }>`
- **broadcastLine** (function) `(w: Awaited<ReturnType<typeof waitingBroadcasts>>[number]): string`
- **broadcastMonth** (function) `(db: Queryable, from: Date, to: Date): Promise<{ id: number; name: string; channel: BroadcastChannel; state: BroadcastState; at: string; }[]>`
- **broadcastResults** (function) `(db: Queryable, id: number): Promise<BroadcastResults>`
- **broadcastUses** (function) `(db: Queryable): Promise<Map<number, SegmentUse[]>>`
- **cancelBroadcast** (function) `(db: Queryable, id: number, by: string, now: Date): Promise<{ name: string; id: number; startedAt: Date | null; finishedAt: Date | null; state: "sent" | "draft" | "sending" | "waiting" | "declined" | "scheduled" | "canceled"; channel: "email" | "sms"; by: string; createdAt: Date; updatedAt: Date; subject: string | null; body: string; note: string | n…`
- **checkWords** (function) `(channel: BroadcastChannel, subject: string | null, body: string): { subject: string | null; body: string }`
- **decideBroadcast** (function) `(db: Queryable, id: number, yes: boolean, by: string, now: Date, note: string | null = null, expect: string | null = null): Promise<{ broadcast: Broadcast; startAt: Date | null }>`
- **dueFor** (function) `(b: Pick<Broadcast, "sendAt" | "local" | "zone">, zone: string | null, now: Date): Date`
- **dueRecipients** (function) `(db: Queryable, id: number, now: Date, limit: number): Promise<number[]>`
- **emailsToday** (function) `(db: Queryable, now: Date): Promise<number>`
- **isUnset** (function) `(m: BroadcastMail | MailUnset): m is MailUnset`
- **markTested** (function) `(db: Queryable, id: number, to: string, now: Date): Promise<void>`
- **nextOrFinish** (function) `(db: Queryable, id: number, now: Date): Promise<Date | null>`
- **previewBroadcast** (function) `(db: Queryable, input: BroadcastInput): Promise<{ subject: string | null; body: string; people: number; yes: number }>`
- **renderFor** (function) `(b: Pick<Broadcast, "id" | "channel" | "subject" | "body">, facts: Record<string, string | null>, seed: string): { subject: string | null; body: string } | { missing: string }`
- **restoreBroadcast** (function) `(db: Queryable, id: number, now: Date): Promise<{ broadcast: Broadcast; startAt: Date | null }>`
- **saveBroadcast** (function) `(db: Queryable, input: BroadcastInput, by: string, now: Date): Promise<Broadcast>`
- **sendRecipient** (function) `(db: Queryable, recipientId: number, deps: { mail: BroadcastMail | MailUnset; now: Date }): Promise<Outcome>`
- **startBroadcast** (function) `(db: Queryable, id: number, now: Date): Promise<number>`
- **startOf** (function) `(b: Pick<Broadcast, "sendAt" | "local" | "zone">, now: Date): Date`
- **waitingBroadcasts** (function) `(db: Queryable): Promise<{ id: number; name: string; channel: BroadcastChannel; segment: string; size: number; topic: string; subject: string | null; body: string; sendAt: Date | null; local: boolean; by: string; askedAt: Date; }[]>`
- **Broadcast** (type) `type Broadcast = typeof broadcasts.$inferSelect;`
- **Recipient** (type) `type Recipient = typeof broadcastRecipients.$inferSelect;`
- **factsOf** (function) `(name: string | null): Record<string, string | null>`

## packages/core/src/buckets.ts

- **Bucket** (interface) `interface Bucket { perDay: number; burst: number; }`
- **bucketRoom** (function) `(spent: readonly number[], now: number, bucket: Bucket): { room: number; nextInMs: number }`

## packages/core/src/cache.ts

- **Cache** (interface) `interface Cache { readonly name: "memory" | "valkey"; get(key: string): Promise<string | null>; set(key: string, value: string, ttlMs: number): Promise<void>; del(...keys: string[]): Promise<void>; }`
- **cacheFrom** (function) `(url: string | undefined): Cache`
- **invalidate** (function) `(cache: Cache, ...keys: string[]): Promise<void>`
- **memoryCache** (function) `(now: () => number = Date.now, max = MEMORY_MAX): Cache`
- **readThrough** (function) `(cache: Cache, key: string, ttlMs: number, load: () => Promise<T>): Promise<T>`
- **valkeyCache** (function) `(url: string, client: RespClient = respClient(url)): Cache`

## packages/core/src/calendar.ts

- **CalcomCalendar** (class) `readonly name; constructor(private readonly apiKey: string, private readonly event: { username: string; slug: string }, private readonly fetchImpl: typeof fetch = globalThis.fetch); open(from: Date, to: Date): Promise<Date[]>; book(start: Date, attendee: Attendee, metadata: Record<string, string> = {}): Promise<string>; booked(email: string): Promise<boolean>`
- **Calendar** (interface) `interface Calendar { readonly name: string; open(from: Date, to: Date): Promise<Date[]>; book(start: Date, attendee: Attendee, metadata?: Record<string, string>): Promise<string>; booked(email: string): Promise<boolean>; }`
- **FakeCalendar** (class) `readonly name; readonly bookings:; constructor(private slots: Date[] = [], private readonly already: Iterable<string> = []); open(from: Date, to: Date): Promise<Date[]>; book(start: Date, attendee: Attendee): Promise<string>; booked(email: string): Promise<boolean>`
- **calcomEvent** (function) `(bookingUrl: string): { username: string; slug: string } | null`

## packages/core/src/calls.ts

- **CALL_OUTCOMES** (const) `readonly ["reached", "voicemail", "no_answer", "wrong_number", "won", "not_yet", "no_show", "not_fit"]`
- **CALL_OUTCOME_LABELS** (const) `Record<CallOutcome, { label: string; tone: Tone }>`
- **CallOutcome** (type) `type CallOutcome = (typeof CALL_OUTCOMES)[number];`
- **DIAL_OUTCOMES** (const) `readonly ["reached", "voicemail", "no_answer", "wrong_number"]`
- **DialOutcome** (type) `type DialOutcome = (typeof DIAL_OUTCOMES)[number];`
- **MEETING_OUTCOMES** (const) `readonly ["won", "not_yet", "no_show", "not_fit"]`
- **MeetingOutcome** (type) `type MeetingOutcome = (typeof MEETING_OUTCOMES)[number];`
- **outcomeIn** (function) `(kind: readonly T[], said: string | null | undefined): T | null | undefined`
- **outcomeStatus** (function) `(kind: readonly T[]): Record<T, { label: string; tone: Tone; }>`

## packages/core/src/channel-stats-schema.ts

- **FUNNEL_STEPS** (const) `readonly ["reached", "saw", "engaged", "replied", "booked", "paid"]`
- **FUNNEL_STEP_NAMES** (const) `Readonly<Record<FunnelStep, string>>`
- **FunnelStep** (type) `type FunnelStep = (typeof FUNNEL_STEPS)[number];`
- **STAT_CHANNELS** (const) `readonly ["email", "sms", "linkedin", "x", "reddit", "youtube", "tiktok", "instagram", "facebook", "threads", "newsletter", "site", "referral", "search", "ads"]`
- **STAT_CHANNEL_NAMES** (const) `Readonly<Record<StatChannel, string>>`
- **StatChannel** (type) `type StatChannel = (typeof STAT_CHANNELS)[number];`
- **profileSteps** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"profile_steps", false, { profileId: import("drizzle-orm/pg-core").PgColumn<{ name: "profile_id"; tableName: "profile_steps"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; …`
- **provesOf** (function) `(channel: string): readonly FunnelStep[]`

## packages/core/src/channel-stats.ts

- **ATTRIBUTIONS** (const) `readonly ["any", "first", "last"]`
- **Attribution** (type) `type Attribution = (typeof ATTRIBUTIONS)[number];`
- **ChannelStats** (interface) `interface ChannelStats { by: string; attribution: Attribution; from: string | null; to: string; rows: StatsRow[]; }`
- **StatsQuery** (interface) `interface StatsQuery { by?: "channel" | "source" | 'trait:${string}'; channel?: string | null; days?: number | null; segment?: number | null; rule?: unknown; attribution?: Attribution; }`
- **StatsRow** (interface) `interface StatsRow { key: string; label: string; channel: string | null; sourceKind: string | null; source: string | null; people: Record<FunnelStep, number | null>; rates: Record<FunnelStep, number | null>; sends: number; costUsd: number | null; views: number | null; visits: number | null; }`
- **StepPerson** (interface) `interface StepPerson { id: number; name: string; email: string | null; at: string; link: string; }`
- **channelPeople** (function) `(db: Queryable, q: StatsQuery & { key: string; step: FunnelStep }, now: Date): Promise<StepPerson[]>`
- **channelStats** (function) `(db: Queryable, q: StatsQuery, now: Date): Promise<ChannelStats>`
- **stepRule** (function) `(row: Pick<StatsRow, "channel" | "source">, step: FunnelStep, days?: number | null): Rule`

## packages/core/src/checks.ts

- **PAUSE_WINDOW** (const) `50`
- **SETTLED** (const) `"checks"`
- **counted** (function) `(db: Queryable, o: { stage: string; source: string; check: string; ok: boolean; subject?: string | null; reason?: string | null; pauses?: boolean; }): Promise<boolean>`
- **hold** (function) `(db: Queryable, h: { stage: string; subject: string; reason: string; spent?: boolean; forever?: boolean }): Promise<void>`
- **holdsOn** (function) `(db: Queryable, stage: string): Promise<{ held: string[]; due: string[] }>`
- **isHeld** (function) `(stage: string, subject: SQL): SQL<unknown>`
- **pausedSources** (function) `(db: Queryable, stage: string): Promise<Set<string>>`
- **release** (function) `(db: Queryable, ids: readonly number[], by: string): Promise<never[] | import(".pnpm/postgres@3.4.9/node_modules/postgres").RowList<{ id: number; }[]>>`
- **retryDue** (function) `(stage: string, subject: SQL): SQL<unknown>`
- **settle** (function) `(db: Queryable, stage: string, subjects: readonly string[]): Promise<number>`
- **Check** (interface) `interface Check<In, Out> { name: string; before?(input: In): string | null; after(input: In, out: Out): string | null; }`

## packages/core/src/clients/domains.ts

- **CustomHostnames** (class) `constructor(private readonly o: { token: string; zone: string; fetch?: typeof fetch }); create(hostname: string): Promise<CloudflareHostname>; find(hostname: string): Promise<CloudflareHostname | null>; get(id: string): Promise<CloudflareHostname>; remove(id: string): Promise<void>`
- **DomainRefusal** (class) ``
- **DomainsDeps** (interface) `interface DomainsDeps { main: Db; cloudflare?: CustomHostnames; target: string; }`
- **HOST_LOOKUP** (const) `z.ZodObject<{ host: z.ZodString; }, z.core.$strip>`
- **addDomain** (function) `(d: DomainsDeps, clientId: string, raw: string, by: string): Promise<ClientDomain>`
- **checkDomain** (function) `(d: DomainsDeps, row: ClientDomain): Promise<ClientDomain>`
- **clientOfHost** (function) `(main: Queryable, host: string): Promise<string | null>`
- **domainState** (function) `(cf: CloudflareHostname, target: string): { status: string; sslStatus: string; records: DomainRecords; problem: string | null; }`
- **isLive** (function) `(d: Pick<ClientDomain, "status" | "sslStatus">): boolean`
- **listDomains** (function) `(main: Queryable, clientId: string): Promise<ClientDomain[]>`
- **mayHandOff** (function) `(main: Queryable, host: string, email: string): Promise<boolean>`
- **normalHost** (function) `(raw: string, own: string): string`
- **removeDomain** (function) `(d: DomainsDeps, clientId: string, raw: string): Promise<boolean>`

## packages/core/src/clients/index.ts

- **CHANGE_FIELDS** (const) `{ at: Omit<import("../records.js").Field, "label"> & { label?: string; }; who: Omit<import("../records.js").Field, "label"> & { label?: string; }; as: Omit<import("../records.js").Field, "label"> & { label?: string; }; madeBy: Omit<import("../records.js").Field, "label"> & { label?: string; }; op: O…`
- **CHANGE_VIEWS** (const) `readonly [{ readonly id: "today"; readonly label: "Today"; readonly where: { readonly age: readonly ["today"]; }; readonly sort: "-at"; readonly at: "at"; }, { readonly id: "people"; readonly label: "People"; readonly where: { readonly madeBy: readonly ["person"]; }; readonly sort: "-at"; readonly a…`
- **LastAdmin** (class) `constructor()`
- **addClient** (function) `(main: Db, mainUrl: string, input: NewClient, by?: string): Promise<Client>`
- **addMember** (function) `(main: Queryable, clientId: string, email: string, opts: { role?: MemberRole | RoleId; invitedBy?: string } = {}): Promise<ClientMember>`
- **addOperator** (function) `(main: Db, email: string): Promise<void>`
- **changeRecord** (const) `import("../records.js").RecordType`
- **clientRecord** (const) `import("../records.js").RecordType`
- **clientUrl** (function) `(mainUrl: string, client: Pick<Client, "database">): string`
- **endSessions** (function) `(db: Queryable, email: string): Promise<void>`
- **findClient** (function) `(main: Queryable, id: string): Promise<Client | null>`
- **getClient** (function) `(main: Queryable, id: string): Promise<Client>`
- **isOperator** (function) `(main: Db, email: string): Promise<boolean>`
- **isOwner** (function) `(main: Queryable, clientId: string, email: string): Promise<boolean>`
- **listClients** (function) `(main: Db): Promise<Client[]>`
- **listMembers** (function) `(main: Queryable, clientId: string): Promise<ClientMember[]>`
- **listOperators** (function) `(main: Db): Promise<string[]>`
- **mayHaveAccount** (function) `(main: Db, email: string): Promise<boolean>`
- **normalEmail** (function) `(email: string): string`
- **removeMember** (function) `(main: Queryable, clientId: string, email: string): Promise<boolean>`
- **removeOperator** (function) `(main: Db, email: string): Promise<boolean>`
- **removeTeamSeat** (function) `(db: Queryable, email: string): Promise<boolean>`
- **sendsOn** (function) `(client: Pick<Client, "sends">, part: string): boolean`
- **sendsWords** (function) `(client: Pick<Client, "sends">, part: string): string`
- **setTeamSeat** (function) `(db: Queryable, email: string, seat: { role?: RoleId; clients?: readonly string[] | null }): Promise<{ email: string; role: RoleId; clients: string[] | null }>`
- **setWrenSettings** (function) `(db: Queryable, component: string, settings: Record<string, unknown>, by: string): Promise<void>`
- **settingsFor** (function) `(db: Queryable, client: string | null): Promise<Record<string, unknown>>`
- **sharedAccounts** (function) `(all: readonly Pick<Client, "id" | "accounts">[]): string[]`
- **teamRecord** (const) `import("../records.js").RecordType`
- **touchMember** (function) `(main: Db, email: string): Promise<void>`
- **updateClient** (function) `(main: Queryable, id: string, change: ClientChange, by = "clients"): Promise<Client>`

## packages/core/src/clients/schema.ts

- **AccessAskRow** (type) `type AccessAskRow = typeof accessAsks.$inferSelect;`
- **CHANNELS** (const) `readonly ["email", "sms", "ads", "content", "search", "reach"]`
- **Channel** (type) `type Channel = (typeof CHANNELS)[number];`
- **Client** (type) `type Client = typeof clients.$inferSelect;`
- **ClientDomain** (type) `type ClientDomain = typeof clientDomains.$inferSelect;`
- **ClientMember** (type) `type ClientMember = typeof clientMembers.$inferSelect;`
- **DomainRecords** (interface) `interface DomainRecords { cname: { name: string; target: string }; txt: { name: string; value: string } | null; }`
- **GrantRow** (type) `type GrantRow = typeof grants.$inferSelect;`
- **IssueRow** (type) `type IssueRow = typeof issues.$inferSelect;`
- **SETUP_MODES** (const) `readonly ["self", "for_you"]`
- **SetupMode** (type) `type SetupMode = (typeof SETUP_MODES)[number];`
- **accessAsks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "access_asks"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "access_asks"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **accessTokens** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "access_tokens"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "access_tokens"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; i…`
- **clientDomains** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "client_domains"; schema: undefined; columns: { hostname: import("drizzle-orm/pg-core").PgColumn<{ name: "hostname"; tableName: "client_domains"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDe…`
- **clientMembers** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "client_members"; schema: undefined; columns: { clientId: import("drizzle-orm/pg-core").PgColumn<{ name: "client_id"; tableName: "client_members"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; h…`
- **clientRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"client_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "client_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAu…`
- **clients** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "clients"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "clients"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimary…`
- **grants** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "grants"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "grants"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey:…`
- **issues** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "issues"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "issues"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey:…`
- **operators** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "operators"; schema: undefined; columns: { email: import("drizzle-orm/pg-core").PgColumn<{ name: "email"; tableName: "operators"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: false; is…`
- **roleGrants** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "role_grants"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "role_grants"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **roles** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "roles"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "roles"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey:…`
- **wrenSettings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "wren_settings"; schema: undefined; columns: { component: import("drizzle-orm/pg-core").PgColumn<{ name: "component"; tableName: "wren_settings"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; ha…`

## packages/core/src/clients/touch.ts

- **touchChannel** (function) `(t: Record<string, unknown>): { channel: Channel; campaign: string | null } | null`

## packages/core/src/components.ts

- **ACCOUNTS** (const) `Record<AccountSite, AccountHow>`
- **ACCOUNT_SITES** (const) `readonly ["gmail", "linkedin", "calcom", "telnyx", "meta", "search_console", "google_calendar", "youtube", "linkedin_page", "x", "tiktok", "instagram", "reddit", "postmaster", "google_business", "stripe"]`
- **AccountSite** (type) `type AccountSite = (typeof ACCOUNT_SITES)[number];`
- **Check** (interface) `interface Check { use: string; held: boolean; why: string; }`
- **Component** (interface) `interface Component { id: string; name: string; blurb: string; icon: string; for: "client" | "wren"; stage: Stage; channels: Channel[]; ready: boolean; missing: string[]; planned: boolean; settings: z.ZodType; wrenSettings: boolean; editor: string | null; priced: string[]; wrenOnly: string[]; clientOnly: string[]; requires: { components: string[]; accounts: AccountSite[]; anyAccount: AccountSite[]; facts: string[]; }; provides: { services: string[]; loops: string[]; records: string[]; apps: string[]; templates: string[]; }; effects: Effect[]; liveSwitch: boolean; soon: AccountSite[]; in: Port[]; out: Port[]; inside: string | null; hypothesis: Hypothesis; clientLoops: (client: string, settings: Record<string, unknown>) => LoopKey[]; comesWith: string | null; }`
- **EVENT_KINDS** (const) `{ readonly firm: "a firm"; readonly person: "a person at a firm"; readonly lead: "a person whose address takes mail"; readonly reply: "a lead's answer, on any channel"; readonly call: "a booked call"; readonly form: "a filled form"; readonly post: "a post"; readonly video: "a demo video"; readonly c…`
- **Effect** (type) `type Effect = "spends" | "sends" | "posts";`
- **EventKind** (type) `type EventKind = keyof typeof EVENT_KINDS;`
- **Guess** (type) `type Guess = | { is: "change" | "needs"; says: string; built: string | null; checked?: readonly Check[]; } | { is: "fixed"; says: string; checked?: readonly Check[] };`
- **Hypothesis** (interface) `interface Hypothesis { from: string; guesses: readonly Guess[]; }`
- **LoopKey** (interface) `interface LoopKey { service: string; key: string; }`
- **Port** (interface) `interface Port { id: string; label: string; kind: EventKind; count?: { record: string; view: string }; }`
- **STAGES** (const) `{ readonly find: "Find leads"; readonly reach: "Reach out"; readonly follow: "Follow up"; readonly book: "Book"; readonly deliver: "Deliver"; readonly content: "Content"; readonly run: "Run Wren"; }`
- **Stage** (type) `type Stage = keyof typeof STAGES;`
- **defineComponent** (function) `(c: Input): Component`
- **CHANNELS** (const) `{ readonly email: "Email"; readonly text: "Texts"; readonly voice: "Calls"; readonly dm: "DMs"; readonly ads: "Ads"; readonly social: "Social"; readonly web: "Web"; }`
- **Channel** (type) `type Channel = keyof typeof CHANNELS;`

## packages/core/src/console-routes.ts

- **CONSOLE_APPS** (const) `{ readonly "*": null; readonly view: "outbound"; readonly loops: "loops"; readonly setLoop: "loops"; readonly flagAdd: "loops"; readonly flagRemove: "loops"; readonly experimentAdd: "marketing"; readonly experimentStart: "marketing"; readonly experimentShip: "marketing"; readonly experimentStop: "ma…`
- **CONSOLE_ROUTES** (const) `{ readonly view: "wren:read"; readonly loops: "wren:read"; readonly agents: "wren:read"; readonly decisions: "wren:read"; readonly setLoop: "wren:run"; readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsCounts: "read"; readonly recordsGet: "read"; readonly recordsExport: "r…`
- **CONSOLE_WRITES** (const) `readonly ConsoleRoute[]`

## packages/core/src/console/api/context.ts

- **consoleTypes** (function) `({ records = [], admin, adminGet, components = [], workflows = [], edge, }: { records?: readonly RecordType[]; admin?: RestateAdmin | undefined; adminGet?: RestateAdminGet | undefined; components?: readonly Component[]; workflows?: readonly Workflow[]; edge?: EdgePush | undefined; }): RecordType[]`

## packages/core/src/console/api/requests.ts

- **AddClientRequest** (interface) `interface AddClientRequest extends PortalRequest { id: string; name: string; }`
- **AskRequest** (interface) `interface AskRequest extends RecordRequest { message?: unknown; }`
- **CallRequest** (interface) `interface CallRequest extends PortalRequest { service: string; handler: string; key?: string; input?: unknown; confirm?: string; send?: boolean; on?: { record?: unknown; id?: unknown }; }`
- **Cell** (type) `type Cell = string | number | boolean | null;`
- **ConnectRequest** (interface) `interface ConnectRequest extends PortalRequest { site: string; account: string; }`
- **DoorRequest** (interface) `interface DoorRequest extends PortalRequest { workflow?: string; id?: unknown; }`
- **EditRequest** (interface) `interface EditRequest extends RecordRequest { patch?: unknown; expect?: unknown; run?: unknown; }`
- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids?: unknown; }`
- **KeepRequest** (interface) `interface KeepRequest extends PortalRequest { record?: unknown; id?: unknown; name?: unknown; params?: unknown; shared?: unknown; ids?: unknown[]; key?: unknown; keys?: unknown[]; value?: unknown; }`
- **SHOWCASE_LOOKS** (const) `readonly string[]`
- **SetLookRequest** (interface) `interface SetLookRequest extends PortalRequest { look: unknown; }`
- **TeamSeatRequest** (interface) `interface TeamSeatRequest extends PortalRequest { email: string; role?: RoleId; clients?: string[] | string | null; }`
- **TemplateRequest** (interface) `interface TemplateRequest extends PortalRequest { template?: unknown; confirm?: unknown; update?: unknown; }`
- **UndoRequest** (interface) `interface UndoRequest extends RecordRequest { change?: unknown; }`
- **ViewAnswer** (type) `type ViewAnswer = ViewTable | { view: string; csv: string };`
- **ViewRequest** (interface) `interface ViewRequest extends PortalRequest { view: string; format?: "json" | "csv"; }`
- **ViewTable** (interface) `interface ViewTable { view: string; columns: string[]; rows: Cell[][]; }`
- **WorkflowSaveRequest** (interface) `interface WorkflowSaveRequest extends PortalRequest { workflow: string; wires?: unknown; steps?: unknown; settings?: unknown; retry?: unknown; reset?: boolean; name?: unknown; confirm?: string; expect?: unknown; }`
- **WorkflowTestRequest** (interface) `interface WorkflowTestRequest extends PortalRequest { workflow: string; wires?: unknown; steps?: unknown; settings?: unknown; node?: unknown; port?: unknown; kind?: unknown; data?: unknown; from?: unknown; event?: unknown; rules?: unknown; heard?: unknown; }`
- **callCommand** (function) `(service: string, handler: string): string`
- **showcaseIn** (function) `(look: unknown): boolean`

## packages/core/src/console/api/workflows.ts

- **workflowEffects** (function) `(id: string, flows: readonly Workflow[], components: readonly Component[]): string[]`

## packages/core/src/console/components.ts

- **ComponentRequest** (interface) `interface ComponentRequest extends PortalRequest { component: string; }`
- **InstallRequest** (interface) `interface InstallRequest extends ComponentRequest { settings?: unknown; confirm?: string; }`
- **componentRecord** (function) `(all: readonly Component[], client: Client | null, team: boolean, workflows: readonly Workflow[] = [], saves: { saved: Record<string, SavedWorkflow>; broken: Record<string, string[]>; history?: ( db: Queryable, workflow: string, ) => Promise<{ draft: WorkflowVersion | null; versions: WorkflowVersion[]; }>; code?: readonly Workflow[]; } = { saved: {}, broken: {}, }, running?: () => Promise<ReadonlySet<string>>, sold: { list: readonly Template[]; installs: readonly WorkflowInstall[]; plan?: ((db: Queryable, t: Template) => Promise<Plan>) | undefined; facts?: ReadonlySet<string> | null; setups?: readonly Setup[]; paused?: ReadonlyMap<string, string> | null; } = { list: [], installs: [] }): RecordType`

## packages/core/src/console/console-api.ts

- **consoleApi** (function) `(deps: ConsoleDeps): { reader(req: import("./api/requests.js").CallRequest): () => Promise<import("./handlers.js").HandlerRow[]>; target(req: import("./api/requests.js").CallRequest, all: readonly import("./handlers.js").HandlerRow[]): import("./handlers.js").HandlerRow; callOn(req: import("./api/requests.js").CallReque…`

## packages/core/src/console/console-portal.ts

- **makeConsolePortal** (function) `(deps: Parameters<typeof consoleApi>[0]): restate.ServiceDefinition<"ConsolePortal", { view: (_: restate.Context, req: ViewRequest) => Promise<import("./console-api.js").ViewAnswer>; loops: (_: restate.Context, req: PortalRequest) => Promise<import("./loops.js").LoopRow[]>; agents: (_: restate.Context, req: PortalRequest) => Promise<import(…`

## packages/core/src/console/executions.ts

- **ExecutionStep** (interface) `interface ExecutionStep { id: string; node: string; port: string; kind: string; data: Record<string, unknown>; at: string; due: string | null; until: string | null; error: string | null; sent: SentEvent[] | null; sentAt: string | null; }`
- **checkRecord** (const) `import("../records.js").RecordType`
- **executionId** (function) `(workflow: string, subject: string): string`
- **executionRecord** (const) `import("../records.js").RecordType`
- **executionRecordOf** (function) `(labels: Readonly<Record<string, string>> = {}): import("../records.js").RecordType`
- **executionSteps** (function) `(db: Queryable, id: string): Promise<ExecutionStep[]>`
- **holdRecord** (const) `import("../records.js").RecordType`
- **nowAtLabels** (function) `(workflows: readonly Workflow[], components: readonly Component[]): Record<string, string>`

## packages/core/src/console/handlers.ts

- **HandlerField** (interface) `interface HandlerField { field: string; label: string; type?: "long" | "date" | "url" | "number" | "switch" | "select" | "lines" | "numbers" | "json"; optional?: true; hint?: string; options?: readonly string[]; labels?: Readonly<Record<string, string>>; }`
- **HandlerRow** (interface) `interface HandlerRow { service: string; handler: string; kind: "service" | "object" | "workflow"; public: boolean; effect: string | null; form: boolean; viewer: boolean; }`
- **formOf** (function) `(input: unknown): HandlerField[] | null`
- **handlerRecord** (function) `(get: RestateAdminGet): RecordType`
- **handlersOf** (function) `(services: unknown): HandlerRow[]`
- **inputSchemaOf** (function) `(openapi: unknown, service: string, handler: string): unknown`

## packages/core/src/console/loops.ts

- **AgentLine** (interface) `interface AgentLine { id: string; name: string; blurb: string; icon: string; stage: Stage; department: string; ready: boolean; loops: string[]; counts: { port: string; label: string; record: string; view: string }[]; }`
- **LOOPS_SQL** (const) `"SELECT s.service_name, s.service_key, s.key, s.value_utf8, i.scheduled_at, i.scheduled_start_at\nFROM state s\nLEFT JOIN sys_invocation i ON i.target_service_name = s.service_name AND i.target_service_key = s.service_key\n AND i.target_handler_name = 'loop' AND i.status = 'scheduled'\nWHERE s.key I…`
- **LoopRow** (interface) `interface LoopRow { service: string; key: string; running: boolean; lastAt: string | null; failures: number; error: string | null; nextAt: string | null; delayMs: number | null; timeouts: TimedOut[]; }`
- **SetLoopRequest** (interface) `interface SetLoopRequest extends PortalRequest { service: string; key: string; run: boolean; }`
- **eventRecord** (const) `RecordType`
- **loopRecord** (function) `(admin: RestateAdmin): RecordType`
- **loopsOf** (function) `(rows: Record<string, unknown>[]): LoopRow[]`

## packages/core/src/console/restate-admin.ts

- **RestateAdmin** (type) `type RestateAdmin = (query: string) => Promise<Record<string, unknown>[]>;`
- **RestateAdminGet** (type) `type RestateAdminGet = (path: string) => Promise<unknown>;`
- **restateAdmin** (function) `(url: string, token?: string): RestateAdmin`
- **restateAdminGet** (function) `(url: string, token?: string, cache: Cache = memoryCache()): RestateAdminGet`
- **runningLoops** (function) `(admin: RestateAdmin): () => Promise<ReadonlySet<string>>`

## packages/core/src/console/settings.ts

- **builtWords** (function) `(c: Component, built: string, name: (id: string) => string | null): string | null`
- **settingRecord** (function) `(all: readonly Component[]): RecordType`
- **settingShown** (function) `(f: HandlerField, v: unknown): string`
- **settingsForm** (function) `(c: Component, forClient = false): HandlerField[] | null`
- **shownSettings** (function) `(c: Component, block: unknown): Record<string, unknown> | null`

## packages/core/src/content/autobrowse.ts

- **CapHolds** (type) `type CapHolds = Record<string, number>;`
- **SiteCallError** (class) `readonly site: string;; readonly status: number;; journaled; constructor(site: string, method: string, path: string, status: number, message: string)`
- **SiteClient** (interface) `interface SiteClient { call<T = unknown>( site: string, method: SiteMethod, path: string, input?: Record<string, unknown>, account?: string, ): Promise<T>; via(site: string, method: SiteMethod, path: string): Promise<FetchedWith | "none">; }`
- **SiteMethod** (type) `type SiteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";`
- **SiteStatus** (interface) `interface SiteStatus { routes: Array<{ method: string; path: string; via: "api" | "browser" | "none" }>; }`
- **asAccount** (function) `(sites: SiteClient, account: string | null | undefined): SiteClient`
- **autobrowseSites** (function) `(o: { url: string; token?: string | null; fetch?: FetchLike; caller?: string; }): SiteClient`
- **capHeld** (function) `(holds: CapHolds, key: string, now: number): boolean`
- **capWaitMs** (function) `(err: unknown): number | null`
- **holdCap** (function) `(holds: CapHolds, key: string, err: unknown, now: number): boolean`
- **liveHolds** (function) `(holds: CapHolds, now: number): CapHolds`
- **matches** (function) `(pattern: string, path: string): boolean`
- **pageFollowing** (function) `(sites: SiteClient, site: string, path: string, profile: (handle: string) => string): Promise<FollowingRow[]>`
- **viaOf** (function) `(status: SiteStatus, method: string, path: string): FetchedWith | "none"`

## packages/core/src/content/box.ts

- **BoxPort** (interface) `interface BoxPort { state(id: string): Promise<string>; start(id: string, startedBy: string): Promise<void>; }`
- **boxPort** (function) `(client: EC2Client): BoxPort`
- **ec2Wake** (function) `(id: string, region?: string): Wake`
- **sitesHost** (function) `(instanceId: string | undefined): SitesHost`
- **wakeBox** (function) `(box: BoxPort, id: string, startedBy = "wren"): Wake`

## packages/core/src/content/do.ts

- **DO_OWNER** (const) `"wren"`
- **Do** (type) `type Do = (req: DoRequest) => Promise<DoOutcome>;`
- **DoFailed** (class) `readonly status: number;; constructor(goal: string, status: number, message: string)`
- **DoOutcome** (interface) `interface DoOutcome { via: "site" | "workflow" | "flow" | "agent" | "none"; name: string | null; input: Record<string, unknown>; output: unknown; status: "done" | "needs-human" | "failed" | "planned"; built: string | null; session: string | null; summary: string; }`
- **DoRequest** (interface) `interface DoRequest { goal: string; inputs?: Record<string, string>; site?: string | null; url?: string | null; dryRun?: boolean; owner?: string | null; }`
- **autobrowseDo** (function) `(o: { url: string; token?: string | null; fetch?: FetchLike; waitMs?: number; }): Do`
- **doServiceFor** (function) `(owner: string = DO_OWNER): string`
- **restateDo** (function) `(ctx: restate.Context, wake?: Wake, o: { owner?: string; timeoutMs?: number } = {}): Do`

## packages/core/src/content/index.ts

- **ACTIVITY_KINDS** (const) `readonly ["follow", "subscribe", "mention", "reaction", "notification"]`
- **ActivityKind** (type) `type ActivityKind = (typeof ACTIVITY_KINDS)[number];`
- **ActivityQuery** (interface) `interface ActivityQuery { since?: string; limit?: number; }`
- **ActivityRow** (interface) `interface ActivityRow { id: string; kind: ActivityKind; actor: string | null; actorUrl: string | null; text: string; url: string | null; at: string | null; raw: unknown; }`
- **Audience** (interface) `interface Audience { followers: number; asOf: string; raw: unknown; }`
- **CONTENT_LIST_LIMIT** (const) `100`
- **CommentRow** (interface) `interface CommentRow { id: string; postId: string; author: string; authorName?: string; text: string; at: string; repliedWith?: string; parentId?: string; url?: string; mine?: boolean; stars?: number; raw?: unknown; }`
- **ContentChannel** (interface) `interface ContentChannel { readonly platform: Platform; publish(post: Post): Promise<Published>; list(q?: ListQuery): Promise<PublishedRow[]>; metrics(id: string): Promise<Metrics>; metricsMany?(posts: { id: string; kind?: string | null }[]): Promise<Metrics[]>; commentCounts?(ids: string[]): Promise<Record<string, number>>; comments(id: string, q?: ListQuery): Promise<CommentRow[]>; reply?(commentId: string, text: string, on?: { postId?: string | null }): Promise<void>; privateReply?(commentId: string, text: string): Promise<{ ref: string | null }>; reviews?(q?: ActivityQuery): Promise<CommentRow[]>; activity?(q?: ActivityQuery): Promise<ActivityRow[]>; audience?(): Promise<Audience>; following?(): Promise<FollowingRow[]>; ownComments?(): Promise<OwnCommentRow[]>; insights?(q: InsightsQuery): Promise<Insights>; accountInsights?(): Promise<AccountInsights>; reportDays?(q: { after?: string | null }): Promise<ReportDays>; update?(id: string, patch: PostPatch): Promise<void>; }`
- **FetchedWith** (type) `type FetchedWith = "api" | "browser";`
- **FollowingRow** (interface) `interface FollowingRow { handle: string; name: string | null; url: string | null; at: string | null; }`
- **ListQuery** (interface) `interface ListQuery { limit?: number; before?: string; }`
- **Media** (interface) `interface Media { kind: "image" | "video"; source: string; title?: string; }`
- **MediaHost** (interface) `interface MediaHost { host(source: string): Promise<string>; }`
- **Metrics** (interface) `interface Metrics { id: string; views: number; reactions: number; comments: number; shares: number; follows?: number | null; read?: unknown; asOf: string; fetchedWith: FetchedWith; }`
- **OwnCommentRow** (interface) `interface OwnCommentRow { id: string; url: string; at: string; text: string; postId: string; reply: boolean; to: { handle: string; name: string | null } | null; }`
- **PLATFORMS** (const) `readonly Platform[]`
- **Platform** (type) `type Platform = | "linkedin" | "reddit" | "youtube" | "x" | "instagram" | "threads" | "facebook" | "tiktok" | "google_business";`
- **Post** (interface) `interface Post { text: string; media?: Media; scheduledFor?: string; extra?: Record<string, unknown>; }`
- **PostPatch** (interface) `interface PostPatch { title?: string; thumbnail?: string; hook?: string; }`
- **Published** (interface) `interface Published { id: string; url: string; publishedAt: string; fetchedWith: FetchedWith; notes?: string[]; }`
- **PublishedRow** (interface) `interface PublishedRow extends Published { preview: string; text?: string; title?: string; }`
- **fakeContentChannel** (function) `(platform: Platform, o: { now?: () => Date; urlOf?: (id: string) => string } = {}): ContentChannel & { posts: Array<Published & { post: Post }>; updates: Array<{ id: string; patch: PostPatch }>; privateReplies: Array<{ commentId: string; text: string }>; count(id: string, m: Partial<Omit<Metrics, "id" | "asOf" | "fetchedWith">>): void; receive(c: Omit<CommentRow, "repliedWith">): void; happen(a: ActivityRow): void; follow(followers: number): void; followOut(f: FollowingRow): void; commentOut(c: OwnCommentRow): void; measure(id: string, i: Omit<Insights, "asOf">): void; measureAccount(a: Omit<AccountInsights, "asOf">): void; report(r: Omit<ReportDays, "asOf">): void; }`
- **hookOf** (function) `(text: string): string`
- **isStoredMedia** (function) `(source: string): boolean`
- **isUrl** (function) `(source: string): boolean`
- **mediaFileOf** (function) `(source: string, host: MediaHost | undefined, platform: string): Promise<string>`
- **pageOf** (function) `(rows: readonly T[], q: ListQuery = {}): T[]`
- **previewOf** (function) `(text: string, max = 120): string`
- **publicUrlOf** (function) `(source: string, host: MediaHost | undefined, platform: string): Promise<string>`
- **withHook** (function) `(text: string, hook: string): string`

## packages/core/src/content/ingress.ts

- **ingressSites** (function) `(ingress: { url: string; headers?: Record<string, string> }, o: IngressSitesOptions): SiteClient`

## packages/core/src/content/insights.ts

- **AccountInsights** (interface) `interface AccountInsights { days: Array<{ day: string; values: InsightValue[] }>; gaps: InsightGap[]; asOf: string; }`
- **GAP_STATES** (const) `readonly ["needs_scope", "needs_william", "not_built", "no_api", "error", "waiting"]`
- **GapState** (type) `type GapState = (typeof GAP_STATES)[number];`
- **InsightGap** (interface) `interface InsightGap { metric: string; state: GapState; why: string; }`
- **InsightValue** (interface) `interface InsightValue { metric: string; key?: string; value: number; }`
- **Insights** (interface) `interface Insights { values: InsightValue[]; gaps: InsightGap[]; asOf: string; fetchedWith?: FetchedWith; }`
- **InsightsQuery** (interface) `interface InsightsQuery { id: string; published?: string | null; kind?: string | null; media?: "image" | "video" | null; read?: unknown; }`
- **METRICS** (const) `{ readonly views: "views"; readonly reach: "reach"; readonly impressions: "impressions"; readonly ctr: "ctr"; readonly impressionsDay: "impressions_day"; readonly ctrDay: "ctr_day"; readonly likes: "likes"; readonly comments: "comments"; readonly shares: "shares"; readonly saves: "saves"; readonly i…`
- **MetricName** (type) `type MetricName = (typeof METRICS)[keyof typeof METRICS];`
- **ReportDays** (interface) `interface ReportDays { rows: Array<{ id: string; day: string; values: InsightValue[] }>; gaps: InsightGap[]; cursor: string | null; asOf: string; }`
- **browserRead** (function) `(metrics: readonly string[], q: Pick<InsightsQuery, "published">, now: Date, work: () => Promise<InsightValue[]>, into: { values: InsightValue[]; gaps: InsightGap[] }): Promise<boolean>`
- **browserReadDue** (function) `(published: string | null | undefined, now: Date): boolean`
- **gapStateOf** (function) `(err: unknown): GapState | null`
- **holdAt** (function) `(curve: ReadonlyArray<{ ratio: number; watch: number }>, at: number): number | null`
- **knownGaps** (function) `(state: GapState, why: string, metrics: readonly string[]): InsightGap[]`
- **numberOf** (function) `(metric: string, v: unknown, key?: string): InsightValue[]`
- **readGroup** (function) `(metrics: readonly string[], work: () => Promise<InsightValue[]>, into: { values: InsightValue[]; gaps: InsightGap[] }): Promise<boolean>`

## packages/core/src/content/page-inbox.ts

- **pageInboxOf** (function) `(body: unknown, self: string): PageInbox`
- **pageInboxQuery** (function) `(platform: "facebook" | "instagram", limit = 25): { platform: string; fields: string; limit: number; }`

## packages/core/src/content/proof.ts

- **KeepShot** (type) `type KeepShot = (jpeg: Uint8Array) => Promise<string>;`
- **PROOF_STATES** (const) `readonly ["live", "hidden", "missing", "pending"]`
- **Proof** (interface) `interface Proof { state: ProofState; checkedAt: string; url: string | null; shot: string | null; note: string | null; }`
- **ProofTarget** (interface) `interface ProofTarget { platform: string; ref: string | null; parent: string | null; url: string | null; text?: string | null; account?: string | null; post?: string | null; peers?: string[]; }`
- **RedditReads** (interface) `interface RedditReads { open: RedditThing | null; inThread: boolean | null; own?: RedditThing | null; }`
- **holds** (function) `(page: string, text: string): boolean`
- **idsIn** (function) `(tree: RedditListing | undefined): { ids: Set<string>; partial: boolean }`
- **linkedinVerdict** (function) `(loaded: boolean, own: boolean | null): { state: ProofState; note: string }`
- **modNoteIn** (function) `(tree: RedditListing | undefined, ref: string): string | null`
- **readable** (function) `(t: RedditThing | null | undefined): boolean`
- **redditPermalink** (function) `(t: ProofTarget, thing?: RedditThing | null): string | null`
- **redditVerdict** (function) `(r: RedditReads): { state: ProofState; note: string | null }`
- **siteProof** (function) `(deps: ProofDeps): CommentProof`
- **wordsOf** (function) `(text: string, n = 60): string`

## packages/core/src/content/renewal.ts

- **RENEWAL_COMMAND** (const) `"sites renew"`
- **RENEWAL_KEY** (const) `"box"`
- **RenewReport** (interface) `interface RenewReport { lines: string[]; results: Array<{ site: string; step: string; ok: boolean }>; next: string | null; }`
- **TokenRenewal** (type) `type TokenRenewal = ReturnType<typeof makeTokenRenewal>;`
- **makeTokenRenewal** (function) `(deps: TokenRenewalDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<RenewalStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<RenewalStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null…`

## packages/core/src/content/restate.ts

- **ArmedStop** (class) `constructor()`
- **Channels** (type) `type Channels = Partial<Record<Platform, ContentChannel>>;`
- **ChannelsFor** (type) `type ChannelsFor = ( ctx: restate.Context, o?: { arm?: boolean; account?: string | null }, ) => Channels;`
- **Content** (type) `type Content = ReturnType<typeof makeContent>;`
- **ContentClients** (interface) `interface ContentClients { channels: (ctx: restate.Context, client: string, part: ContentPart) => Promise<Channels>; sends: (client: string) => Promise<boolean>; }`
- **DESK** (const) `{ readonly name: "desk"; }`
- **MANY_POSTS** (const) `100`
- **SENDS_OFF** (const) `"Sends off. An admin turns them on."`
- **SITES** (const) `{ readonly name: "sites"; }`
- **SitesHost** (interface) `interface SitesHost { service: { name: string }; wake?: Wake | undefined; arm?: boolean; dayZone?: string; }`
- **SitesService** (type) `type SitesService = { status: (ctx: restate.Context, req: { site: string }) => Promise<SiteStatus>; call: ( ctx: restate.Context, req: { site: string; method: SiteMethod; path: string; input?: Record<string, unknown>; account?: string; caller?: string; sendKey?: string; until?: string; }, ) => Promise<unknown>; verdict: (ctx: restate.Context, req: { sendKey: string }) => Promise<SendVerdict>; setup: ( ctx: restate.Context, req: { site: string; step: string }, ) => Promise<{ made: readonly string[] }>; arm: ( ctx: restate.Context, req: { site: string; method: SiteMethod; path: string; input?: Record<string, unknown>; account?: string; caller?: string; }, ) => Promise<unknown>; };`
- **Wake** (type) `type Wake = () => Promise<"started" | "running">;`
- **isRefusal** (function) `(err: unknown): err is SiteCallError`
- **journaledHost** (function) `(ctx: restate.Context, host: MediaHost): MediaHost`
- **journaledSites** (function) `(ctx: restate.Context, sites: SiteClient, journal: SendJournal): SiteClient`
- **makeContent** (function) `(channelsFor: ChannelsFor, clients?: ContentClients): restate.ServiceDefinition<"Content", { platforms: (ctx: restate.Context) => Promise<Platform[]>; publish: (ctx: restate.Context, req: { platform: Platform; post: Post; } & ForClient & AsAccount & Keyed) => Promise<Published | Delivery<Published>>; list: (ctx: restate.Context, req: { platform: Platfo…`
- **restateSites** (function) `(ctx: restate.Context, o: { caller: string; limitMs?: number } & Partial<SitesHost>): SiteClient`
- **siteCallErrorFrom** (function) `(err: unknown, site: string, method: string, path: string): Error`

## packages/core/src/content/routes.ts

- **routeKind** (function) `(site: string, method: SiteMethod, path: string): RouteKind`
- **routeTable** (function) `(): readonly Readonly<Row>[]`

## packages/core/src/content/shapes.ts

- **FieldInput** (type) `type FieldInput = | "line" | "long" | "pick" | "switch" | "list" | "image" | "files" | "captions" | "number" | "slides";`
- **FieldView** (interface) `interface FieldView extends FieldUi { key: string; value: unknown; }`
- **FieldsOf** (type) `type FieldsOf<P extends Platform> = z.output<(typeof SHAPES)[P]["schema"]>;`
- **SHAPES** (const) `{ readonly youtube: Shape<{ kind: { zod: z.ZodOptional<z.ZodEnum<{ video: "video"; short: "short"; community: "community"; }>>; ui: { label: string; input: FieldInput; status: FieldStatus; max?: number; maxTotal?: number; options: readonly { value: string; label: string; }[]; required?: boolean; def…`
- **Shape** (interface) `interface Shape<F extends Fields = Fields> extends ShapeRules { schema: SchemaOf<F>; fields: readonly (FieldUi & { key: string })[]; }`
- **ShapeError** (class) `override name`
- **YOUTUBE_PRIVACY** (const) `readonly ["private", "unlisted", "public"]`
- **coerceField** (function) `(platform: Platform, key: string, raw: string): unknown`
- **consented** (function) `(platform: Platform): boolean`
- **fieldViews** (function) `(platform: Platform, extra: Readonly<Record<string, unknown>>, title: string | null | undefined): FieldView[]`
- **fieldsOf** (function) `(platform: P, extra: unknown): FieldsOf<P>`
- **kindOf** (function) `(extra: Readonly<Record<string, unknown>> | null | undefined): string`
- **languageName** (function) `(code: string): string`
- **mediaUnfit** (function) `(platform: Platform, extra: Readonly<Record<string, unknown>> | null | undefined, media: Pick<Media, "kind"> | null | undefined): string | null`
- **missingFields** (function) `(platform: Platform, extra: Readonly<Record<string, unknown>>, title: string | null | undefined): string[]`
- **patchFields** (function) `(platform: Platform, current: Readonly<Record<string, unknown>>, patch: Readonly<Record<string, unknown>>): { extra: Record<string, unknown>; title?: string | null; changed: Record<string, [unknown, unknown]>; }`
- **tagsLength** (function) `(tags: readonly string[]): number`

## packages/core/src/content/slides.ts

- **SLIDES_CSS** (const) `string`
- **SLIDES_MAX** (const) `10`
- **SLIDES_MIN** (const) `5`
- **SLIDE_LINES_MAX** (const) `4`
- **SLIDE_LINE_MAX** (const) `110`
- **SLIDE_PX** (const) `1080`
- **SLIDE_TITLE_MAX** (const) `70`
- **Slide** (interface) `interface Slide { title: string; lines: string[]; }`
- **carouselFiles** (function) `(d: { extra?: Readonly<Record<string, unknown>> | null; }): CarouselFiles`
- **carouselUnfit** (function) `(d: { platform: string; extra?: Readonly<Record<string, unknown>> | null; }): string | null`
- **cleanSlides** (function) `(v: unknown): Slide[]`
- **isCarousel** (function) `(d: { platform: string; extra?: Readonly<Record<string, unknown>> | null; }): boolean`
- **slidesFromText** (function) `(text: string): Slide[]`
- **slidesHtml** (function) `(slides: readonly Slide[], o: { only?: number; by?: string } = {}): string`
- **slidesKey** (function) `(slides: readonly Slide[]): string`
- **slidesText** (function) `(slides: readonly Slide[]): string`
- **slidesUnfit** (function) `(slides: readonly Slide[]): string | null`

## packages/core/src/content/thread.ts

- **THREAD_BREAK** (const) `"\n\n---\n\n"`
- **THREAD_MAX** (const) `7`
- **THREAD_MIN** (const) `3`
- **WREN_X_SUBSCRIPTION** (const) `XSubscription`
- **X_POST_MAX** (const) `280`
- **isThread** (function) `(d: { platform: string; extra?: Readonly<Record<string, unknown>> | null; }): boolean`
- **threadPosts** (function) `(text: string): string[]`
- **threadText** (function) `(posts: readonly string[]): string`
- **threadUnfit** (function) `(posts: readonly string[], link?: string | null): string | null`
- **withLink** (function) `(posts: readonly string[], link: string | null | undefined): string[]`
- **xLength** (function) `(text: string): number`
- **xPostMax** (function) `(s: XSubscription): number`

## packages/core/src/content/tiktok.ts

- **TIKTOK_BC_URL** (const) `"https://www.tiktok.com/legal/page/global/bc-policy/en"`
- **TIKTOK_COPY** (const) `{ readonly disclose: "Disclose post content"; readonly discloseHint: "Indicate whether this content promotes yourself, a brand, product or service."; readonly yourBrand: "Your brand"; readonly yourBrandHint: "You are promoting yourself or your own business. This content will be classified as Brand O…`
- **TIKTOK_MUSIC_URL** (const) `"https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"`
- **TIKTOK_PRIVACY** (const) `readonly ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]`
- **TIKTOK_PRIVACY_LABELS** (const) `Record<TikTokPrivacy, string>`
- **TikTokCreator** (interface) `interface TikTokCreator { nickname: string; username: string | null; avatarUrl: string | null; privacyOptions: TikTokPrivacy[]; commentOff: boolean; duetOff: boolean; stitchOff: boolean; maxVideoSec: number | null; canPost: boolean; why: string | null; }`
- **TikTokPrivacy** (type) `type TikTokPrivacy = (typeof TIKTOK_PRIVACY)[number];`
- **creatorFrom** (function) `(answer: unknown): TikTokCreator`
- **tiktokBroken** (function) `(f: TikTokChoices): string | null`
- **tiktokDeclaration** (function) `(f: TikTokChoices): { text: string; links: { label: string; url: string }[]; }`
- **tiktokHold** (function) `(f: TikTokChoices, c: TikTokCreator, videoSec?: number | null): string | null`
- **tiktokLabel** (function) `(f: TikTokChoices): string | null`
- **tiktokMissing** (function) `(f: TikTokChoices): string[]`

## packages/core/src/custom-fields.ts

- **businessFactLines** (function) `(main: Queryable, owner: string | null): Promise<string[]>`
- **businessFacts** (function) `(main: Queryable, owner: string | null): Promise<CustomValue[]>`
- **customFacts** (function) `(main: Queryable, owner: string | null, subject?: string | null, rows: Queryable = main): Promise<Record<string, string>>`
- **customFieldsOf** (function) `(db: Queryable, owner: string | null, record: string, o: { archived?: boolean } = {}): Promise<CustomField[]>`
- **fieldOf** (function) `(f: Pick<CustomField, "key" | "label" | "kind" | "options">): Field`
- **orderCustomFields** (function) `(db: Queryable, owner: string | null, record: string, ids: readonly string[], by: string): Promise<void>`
- **saveBusinessFact** (function) `(main: Queryable, owner: string | null, input: { key?: string; label: string; value: string }, by: string): Promise<CustomValue | null>`
- **saveCustomField** (function) `(db: Queryable, owner: string | null, input: FieldInput, by: string): Promise<CustomField>`
- **setFieldStep** (function) `(main: Queryable, open: (client: string) => Queryable): Step`
- **withCustomFields** (function) `(types: readonly RecordType[], db: Queryable): Promise<RecordType[]>`
- **FieldInput** (interface) `interface FieldInput { id?: string; record: string; label?: string | null; key?: string; kind?: string; options?: readonly { key?: string; label: string }[]; archived?: boolean; }`
- **keyOf** (function) `(label: string): string`

## packages/core/src/custom-schema.ts

- **CUSTOM_KINDS** (const) `readonly ["text", "number", "money", "date", "choice", "yes_no", "link"]`
- **CustomField** (type) `type CustomField = typeof customFields.$inferSelect;`
- **CustomKind** (type) `type CustomKind = (typeof CUSTOM_KINDS)[number];`
- **CustomOption** (interface) `interface CustomOption { key: string; label: string; }`
- **CustomValue** (type) `type CustomValue = typeof customValues.$inferSelect;`
- **customFieldValues** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "custom_field_values"; schema: undefined; columns: { field: import("drizzle-orm/pg-core").PgColumn<{ name: "field"; tableName: "custom_field_values"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; h…`
- **customFields** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "custom_fields"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "custom_fields"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; i…`
- **customValues** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "custom_values"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "custom_values"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; i…`

## packages/core/src/dead-letter-schema.ts

- **DEAD_LETTER_ENDS** (const) `readonly ["retried", "killed", "dropped", "cleared"]`
- **DeadLetterEnd** (type) `type DeadLetterEnd = (typeof DEAD_LETTER_ENDS)[number];`
- **DeadLetterRow** (type) `type DeadLetterRow = typeof deadLetters.$inferSelect;`
- **deadLetters** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "dead_letters"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "dead_letters"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`

## packages/core/src/dead-letters.ts

- **DEAD_LETTERS_KEY** (const) `"all"`
- **DeadLetterAct** (type) `type DeadLetterAct = "retry" | "kill" | "drop";`
- **DeadLetters** (type) `type DeadLetters = ReturnType<typeof makeDeadLetters>;`
- **Paused** (interface) `interface Paused { invocationId: string; target: string; key: string | null; error: string | null; invokedBy: string | null; pausedAt: Date; }`
- **deadLetter** (function) `(main: Db, id: number): Promise<DeadLetterRow | null>`
- **deadLetterList** (function) `(main: Db, all = false): Promise<DeadLetterRow[]>`
- **deadLetterPass** (function) `(deps: DeadLetterDeps, now: Date): Promise<DeadLetterPass>`
- **deskUnreachable** (function) `(l: Pick<DeadLetterRow, "target" | "error">): boolean`
- **endDeadLetter** (function) `(deps: Pick<DeadLetterDeps, "main" | "patch">, id: number, act: DeadLetterAct, by: string, now: Date = new Date()): Promise<DeadLetterRow>`
- **failureOf** (function) `(entryJson: unknown): string | null`
- **journalOf** (function) `(admin: RestateAdmin, id: string): Promise<{ index: number; type: string; name: string; failure: string | null }[]>`
- **letterLine** (function) `(l: Pick<DeadLetterRow, "id" | "target" | "key" | "error">): string`
- **makeDeadLetters** (function) `(deps: DeadLetterDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<DeadLetterPass>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<DeadLetterPass>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | …`
- **pausedFailureOf** (function) `(eventJson: unknown): string | null`
- **pausedOf** (function) `(rows: readonly Record<string, unknown>[]): Paused[]`
- **pausedUnder** (function) `(admin: RestateAdmin): (invocationId: string) => Promise<string | null>`
- **restateAdminPatch** (function) `(url: string, token?: string): RestateAdminPatch`

## packages/core/src/decide-schema.ts

- **DECIDE_MODES** (const) `readonly ["off", "shadow", "recommend", "gate"]`
- **DECISION_KINDS** (const) `readonly ["comment_quality", "document", "lead_fit", "finding"]`
- **DecideMode** (type) `type DecideMode = (typeof DECIDE_MODES)[number];`
- **DecisionCallRow** (type) `type DecisionCallRow = typeof decisionCalls.$inferSelect;`
- **DecisionKind** (type) `type DecisionKind = (typeof DECISION_KINDS)[number];`
- **DecisionRow** (type) `type DecisionRow = typeof decisions.$inferSelect;`
- **decisionCalls** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "decision_calls"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "decision_calls"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **decisions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "decisions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "decisions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrima…`

## packages/core/src/decide/backends.ts

- **Answered** (interface) `interface Answered { model: string; answers: Record<string, unknown>; usage: { input_tokens: number; output_tokens: number }; }`
- **BackendChoice** (interface) `interface BackendChoice { chain: DecideBackend[]; note: string | null; }`
- **CompleteLike** (interface) `interface CompleteLike { readonly name: string; complete( prompt: string, opts?: { maxTokens?: number; system?: string }, ): Promise<{ text: string; raw: Record<string, unknown> }>; }`
- **DecideBackend** (interface) `interface DecideBackend { readonly name: string; readonly price: { input: number; output: number }; ask( req: { state: EntryType; questions: Questions }, o: { signal?: AbortSignal }, ): Promise<Answered>; }`
- **Failure** (type) `type Failure = "refused" | "key" | "down";`
- **JEV_PRICE** (const) `{ readonly input: 0.042; readonly output: 0; }`
- **backendsFromEnv** (function) `(env: Readonly<Record<string, string | undefined>>, llm?: ((spec: string) => CompleteLike) | null, o: { fetch?: Fetch } = {}): BackendChoice`
- **choiceConfidence** (function) `(probs: Record<string, number>): number`
- **costOf** (function) `(price: DecideBackend["price"], usage: Answered["usage"]): number`
- **gatewayBackend** (function) `(llm: CompleteLike): DecideBackend`
- **jevBackend** (function) `(o: { apiKey: string; name?: "jev" | "laya"; model?: string; baseURL?: string; fetch?: Fetch; tryMs?: number; price?: DecideBackend["price"]; }): DecideBackend`
- **failureOf** (function) `(err: unknown): Failure`

## packages/core/src/decide/calls.ts

- **keepSql** (function) `(kind: DecisionKind, label: ReturnType<typeof sql>): import("drizzle-orm").SQL<unknown>`
- **newestCall** (function) `(db: Queryable, kind: DecisionKind, subject: string): Promise<{ id: number; kind: "document" | "finding" | "comment_quality" | "lead_fit"; subject: string; label: string; keep: boolean; source: string; by: string | null; decisionId: number | null; agreed: boolean | null; override: boolean; ref: string | null; comment: string | null; at: Date; } | null>`
- **recordCall** (function) `(db: Queryable, c: CallInput): Promise<void>`

## packages/core/src/decide/comments.ts

- **backfillCommentCalls** (function) `(db: Queryable): Promise<{ items: number; kept: number }>`
- **isCommentCall** (function) `(s: { kind: DraftRecordKind; event: DraftEvent; via: DraftVia; ref?: string | null; }): boolean`
- **recordCommentCall** (function) `(db: Queryable, item: string, o: { backfill?: boolean } = {}): Promise<boolean>`

## packages/core/src/decide/decide.ts

- **DEFAULT_DAILY_USD** (const) `1`
- **DecideStop** (class) `override name`
- **Pick** (interface) `interface Pick { label: string; p: number | null; }`
- **decide** (function) `(db: Queryable, d: DecideInput): Promise<DecisionRow | null>`
- **decideModes** (function) `(db: Queryable): Promise<Record<DecisionKind, DecideMode>>`
- **decideSettings** (function) `(db: Queryable): Promise<DecideSettings>`
- **pickStates** (function) `(kind: DecisionKind): Record<string, { label: string; tone: LabelSpec["tone"]; about: string; }>`
- **picksOf** (function) `(db: Queryable, kind: DecisionKind, subjects: readonly string[]): Promise<Map<string, Pick>>`
- **setDecideMode** (function) `(db: Queryable, kind: DecisionKind, mode: DecideMode, by: string): Promise<DecideSettings>`
- **spentToday** (function) `(db: Queryable, now: Date): Promise<number>`

## packages/core/src/decide/export.ts

- **decisionRecords** (function) `(db: Queryable, o: { kind?: DecisionKind; called?: boolean; since?: Date } = {}): Promise<DecisionRecord[]>`

## packages/core/src/decide/kinds.ts

- **GATE_AT** (const) `{ readonly rate: 0.95; readonly calls: 200; }`
- **LabelSpec** (interface) `interface LabelSpec { name: string; keep: boolean; tone: Tone; about: string; }`
- **PICK** (const) `"pick"`
- **Tone** (type) `type Tone = "good" | "warn" | "bad" | "neutral";`
- **isDecideMode** (function) `(m: string): m is DecideMode`
- **isDecisionKind** (function) `(k: string): k is DecisionKind`
- **keepOf** (function) `(kind: DecisionKind, label: string): boolean`
- **machineLabel** (function) `(kind: DecisionKind, answers: Record<string, unknown>): { label: string; p: number; confidence: number | null } | null`
- **KINDS** (const) `Readonly<Record<DecisionKind, KindSpec>>`

## packages/core/src/decide/lead-fit.ts

- **FoundFact** (interface) `interface FoundFact { kind: string; platform: string | null; employer?: string; confidence: number; }`
- **LEAD_KIND** (const) `"lead_fit"`
- **LEAD_TEXT_MAX** (const) `280`
- **LeadFitView** (interface) `interface LeadFitView { pick: { label: string; name: string; tone: Tone; percent: number | null; why: string; at: string; } | null; call: { label: string; name: string; at: string; overrode: boolean } | null; lastAt: string | null; failed: string | null; }`
- **leadFitDue** (function) `(db: Queryable, limit: number): Promise<{ id: number; since: string }[]>`
- **leadFitSource** (function) `(offers: readonly LeadOffer[]): DecideSource`
- **leadFitState** (function) `(db: Queryable, profileId: number, offers: readonly LeadOffer[]): Promise<Record<string, unknown>>`
- **leadFitView** (function) `(db: Queryable, profileId: number): Promise<LeadFitView>`
- **leadProfileOf** (function) `(subject: string): number | null`
- **leadSubject** (function) `(profileId: number): string`
- **leadWhy** (function) `(label: string, state: unknown): string`
- **pickPercent** (function) `(answers: unknown, label: string, confidence: number | null): number | null`
- **scrubList** (function) `(o: { names?: readonly (string | null | undefined)[]; handles?: readonly (string | null | undefined)[]; }): { names: string[]; handles: string[] }`
- **scrubText** (function) `(text: string | null | undefined, list: { names: readonly string[]; handles: readonly string[] }, max = LEAD_TEXT_MAX): string`

## packages/core/src/decide/loop.ts

- **DecideService** (type) `type DecideService = ReturnType<typeof makeDecide>;`
- **DecideSource** (interface) `interface DecideSource { kind: DecisionKind; due(db: Queryable, now: Date, limit: number): Promise<DecideSubject[]>; one?(db: Queryable, subject: string): Promise<DecideSubject | null>; }`
- **DecideSubject** (interface) `interface DecideSubject { subject: string; state: Record<string, unknown>; }`
- **decideOne** (function) `(db: Queryable, o: { sources: readonly DecideSource[]; backends: BackendChoice; kind: DecisionKind; subject: string; now?: Date; limitMs?: number; }): Promise<DecideOneOutcome>`
- **decidePass** (function) `(db: Queryable, o: { sources: readonly DecideSource[]; backends: BackendChoice; now?: Date; max?: number; budgetMs?: number; limitMs?: number; maxUsd?: number; mode?: DecideMode; }): Promise<DecidePassStats>`
- **makeDecide** (function) `(d: DecideDeps): restate.VirtualObjectDefinition<string, { one: (ctx: restate.ObjectContext, req: z.infer<typeof ONE_INPUT>) => Promise<DecideOneOutcome>; } & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<DecidePassStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<DecidePassS…`

## packages/core/src/decide/stats.ts

- **KindStats** (interface) `interface KindStats { kind: DecisionKind; name: string; mode: DecideMode; calls: number; judged: number; agreed: number; rate: number | null; overrides: number; decisions: number; failed: number; inputTokens: number; outputTokens: number; usd: number; usdToday: number; gateReady: boolean; }`
- **decideStats** (function) `(db: Queryable, now = new Date()): Promise<KindStats[]>`

## packages/core/src/doh.ts

- **DnsType** (type) `type DnsType = "TXT" | "MX" | "A" | "AAAA";`
- **DohStatusError** (class) `override name`
- **FetchLike** (type) `type FetchLike = (url: string, init: RequestInit) => Promise<Response>;`
- **Resolver** (type) `type Resolver = (name: string, rtype: DnsType) => Promise<string[]>;`
- **optionalInit** (function) `(fetch: FetchLike): (url: string, init?: RequestInit) => Promise<Response>`
- **resolve** (function) `(name: string, rtype: DnsType, fetchImpl: FetchLike = fetch): Promise<string[]>`

## packages/core/src/door.ts

- **COMMON** (const) `Record<Exclude<LeadField, "name">, readonly string[]>`
- **DOOR_URL** (const) `"https://phone.wrenautomation.com/hooks/"`
- **DoorLead** (interface) `interface DoorLead { name: string | null; phone: string | null; email: string | null; consent: boolean; consentDetail: string | null; source: string | null; zone: string | null; niche: string | null; }`
- **FieldMap** (type) `type FieldMap = Partial<Record<LeadField, string>>;`
- **HOOK_PRESETS** (const) `Readonly<Record<string, HookPreset>>`
- **LEAD_FIELDS** (const) `readonly ["name", "phone", "email", "consent", "source", "zone", "niche"]`
- **LeadField** (type) `type LeadField = (typeof LEAD_FIELDS)[number];`
- **NAMES** (const) `readonly ["name", "full_name", "fullName"]`
- **fieldMapOf** (function) `(pairs: readonly string[]): FieldMap`
- **fieldMapOfWith** (function) `(w: Readonly<Record<string, string | number>>): FieldMap`
- **fieldMapProblems** (function) `(map: FieldMap): string[]`
- **leadOf** (function) `(payload: unknown, map: FieldMap = {}): DoorLead`
- **mapKey** (function) `(fact: LeadField): string`

## packages/core/src/draft-models.ts

- **ArmRow** (interface) `interface ArmRow { by: string; armed: boolean; label: string; generated: number; approvedUnedited: number; approvedEdited: number; rejected: number; open: number; dropped: number; redrafted: number; editChars: number | null; editShare: number | null; proof: { live: number; hidden: number; missing: number }; replied: number; repliable: number; uneditedRate: number | null; decided: number; }`
- **DEFAULT_ARMS** (const) `readonly DraftArm[]`
- **DRAFT_MODELS_COMPONENT** (const) `"drafts.model"`
- **DraftArm** (type) `type DraftArm = z.infer<typeof draftArmSchema>;`
- **DraftModels** (type) `type DraftModels = z.infer<typeof draftModelsSchema>;`
- **GuardHit** (interface) `interface GuardHit { by: string; outcome: "dropped" | "redrafted"; }`
- **MIN_DECIDED_PER_ARM** (const) `40`
- **REACH_DRAFT_KINDS** (const) `readonly ["thread", "post_comment", "comment", "dm", "invite_note"]`
- **REACH_GUARD_STAGES** (const) `readonly ["reddit.draft", "comments.sort", "reach.dm_draft", "reach.invite_note"]`
- **Scorecard** (interface) `interface Scorecard { since: string; arms: readonly DraftArm[]; rows: ArmRow[]; verdict: Verdict; }`
- **ScoredDraft** (interface) `interface ScoredDraft { item: string; by: string; armed: boolean; written: string; end: { is: "approved"; text: string } | { is: "rejected" } | { is: "open" }; proof?: string | null; replies?: number | null; }`
- **Verdict** (interface) `interface Verdict { winner: string | null; says: string; }`
- **armLabel** (function) `(id: string): string`
- **armOf** (function) `(item: string, arms: readonly DraftArm[]): DraftArm`
- **draftArms** (function) `(db: Queryable): Promise<readonly DraftArm[]>`
- **draftModelsSchema** (const) `z.ZodObject<{ arms: z.ZodArray<z.ZodObject<{ model: z.ZodString; weight: z.ZodNumber; }, z.core.$strict>>; }, z.core.$strict>`
- **editChars** (function) `(from: string, to: string): number`
- **scoreArms** (function) `(drafts: readonly ScoredDraft[], guard: readonly GuardHit[] = []): ArmRow[]`
- **verdict** (function) `(rows: readonly ArmRow[]): Verdict`

## packages/core/src/draft-record.ts

- **DraftRecordView** (interface) `interface DraftRecordView { item: string; round: number; rounds: number; versions: DraftVersion[]; decisions: { event: DraftEvent; via: DraftVia; by: string | null; reason: RejectReason | null; note: string | null; slot: string | null; url: string | null; at: string; }[]; }`
- **DraftStep** (interface) `interface DraftStep { item: string; kind?: DraftRecordKind; platform?: string | null; event: DraftEvent; via: DraftVia; by?: string | null; text?: string | null; title?: string | null; ask?: string | null; reason?: RejectReason | null; note?: string | null; llm?: Record<string, unknown> | null; slot?: Date | null; externalId?: string | null; url?: string | null; meta?: Record<string, unknown>; runId?: string | null; ref?: string | null; round?: number; at?: Date; }`
- **DraftVersion** (interface) `interface DraftVersion { n: number; event: DraftEvent; via: DraftVia; by: string | null; ask: string | null; text: string; title: string | null; at: string; }`
- **draftItemsOf** (function) `(type: string, id: string): string[]`
- **draftRecordOf** (function) `(db: Queryable, items: string | readonly string[]): Promise<DraftRecordView | null>`
- **draftSteps** (function) `(db: Queryable, item: string): Promise<DraftEventRow[]>`
- **isDraftKind** (function) `(k: string): k is DraftRecordKind`
- **llmOf** (function) `(o: AskedModel, stage: string, extra: Record<string, unknown> = {}): { stage: string; model: string | null; provider: string | null; system: string | null; prompt: string | null; max_tokens: number | null; usage: {} | null; raw_text: string | null; }`
- **recordDraft** (function) `(db: Queryable, s: DraftStep): Promise<void>`
- **recordOfPage** (function) `(db: Queryable, type: string, id: string): Promise<DraftRecordView | null>`
- **rejectWhy** (function) `(input: { reason?: unknown; note?: unknown }): { reason: RejectReason | null; note: string | null; }`

## packages/core/src/edits.ts

- **ASK_COMMAND** (const) `"record-ask"`
- **ASK_MESSAGE_MAX** (const) `2000`
- **AskTurn** (interface) `interface AskTurn { run: string; at: string; by: string; message: string; state: "thinking" | "answered" | "failed"; reply: string | null; proposal: Proposal | null; accepted: number | null; }`
- **ChangeLine** (interface) `interface ChangeLine { id: number; at: string; by: string; via: ChangeVia; before: Values; after: Values; undoes: number | null; undone: boolean; }`
- **EditAsk** (interface) `interface EditAsk { record: string; id: string | number; patch: Values; expect?: string | null; run?: string | null; }`
- **EditState** (interface) `interface EditState { values: Values; version: string; history: ChangeLine[]; asks: AskTurn[]; }`
- **Edited** (interface) `interface Edited { values: Values; version: string; change: number | null; }`
- **Proposal** (interface) `interface Proposal { patch: Values; problem: string | null; diff: { field: string; before: unknown; after: unknown }[]; }`
- **RecordAskAsk** (interface) `interface RecordAskAsk { record: string; id: string | number; message: string; }`
- **UndoAsk** (interface) `interface UndoAsk { record: string; id: string | number; change: number; }`
- **askAnswerOf** (function) `(text: string): { reply: string; patch: Values | null }`
- **askPrompt** (function) `(db: Queryable, type: RecordType, id: string, row: object, message: string, by: string): Promise<{ question: string; system: string; values: Values }>`
- **askTurns** (function) `(db: Queryable, type: RecordType, id: string, now: Values): Promise<AskTurn[]>`
- **editRecord** (function) `(db: Queryable, type: RecordType, id: string, o: EditOpts): Promise<Edited>`
- **editState** (function) `(db: Queryable, type: RecordType, id: string): Promise<EditState | null>`
- **historyOf** (function) `(db: Queryable, type: RecordType, id: string): Promise<ChangeLine[]>`
- **patchOf** (function) `(type: RecordType, patch: unknown): Values`
- **undoChange** (function) `(db: Queryable, type: RecordType, id: string, change: number, by: string): Promise<Edited>`
- **versionOf** (function) `(values: Values): string`
- **wordsPatch** (function) `(caps: Readonly<Record<string, number>>): ZodType<Values>`

## packages/core/src/email-patterns.ts

- **PATTERNS** (const) `readonly ["{first}.{last}", "{f}{last}", "{first}", "{first}{last}", "{first}_{last}", "{f}.{last}", "{last}"]`
- **applyPattern** (function) `(pattern: string, firstName: string | null | undefined, lastName: string | null | undefined): string | null`
- **inferPattern** (function) `(localPart: string, firstName: string | null | undefined, lastName: string | null | undefined): Pattern | null`
- **nameFromLocalPart** (function) `(localPart: string, domain: string): { firstName: string; lastName: string } | null`
- **nameToken** (function) `(name: string | null | undefined): string | null`

## packages/core/src/emails.ts

- **ROLE_LOCALPARTS** (const) `ReadonlySet<string>`
- **emailDomain** (function) `(email: string): string`
- **emailSyntaxError** (function) `(email: string): string | null`
- **extractDomain** (function) `(raw: string): string | null`
- **isFreemail** (function) `(domain: string): boolean`
- **isPlatformDomain** (function) `(domain: string, extra: Iterable<string> = []): boolean`
- **isRoleLocalpart** (function) `(email: string): boolean`
- **normalizeEmail** (function) `(raw: string): string`
- **registrableDomain** (function) `(domain: string): string`
- **validDomain** (function) `(domain: string): boolean`

## packages/core/src/epsilon.ts

- **nudge** (function) `(at: Date, rand: () => number): Date`
- **nudgeFixed** (function) `(at: Date, key: string): Date`
- **seeded** (function) `(key: string): () => number`

## packages/core/src/executor.ts

- **Arrival** (interface) `interface Arrival { workflow: string; node: string; port: string; event: ExecutorEvent; version?: number | null; until?: Until | null; }`
- **EXECUTOR** (const) `{ readonly name: "Executor"; }`
- **ExecutorClock** (type) `type ExecutorClock = ReturnType<typeof makeExecutorClock>;`
- **ExecutorEvent** (interface) `interface ExecutorEvent { subject: string; kind: EventKind; data: Record<string, unknown>; }`
- **ExecutorService** (type) `type ExecutorService = { emit: (ctx: restate.Context, req: EmitRequest) => Promise<Tally>; release: ( ctx: restate.Context, req: Target & { id: string; happened?: ExecutorEvent }, ) => Promise<Tally | null>; retry: ( ctx: restate.Context, req: Target & { id: string; auto?: number }, ) => Promise<Tally | null>; fire: (ctx: restate.Context, req: Fired) => Promise<{ entered: number; resolved: number }>; door: ( ctx: restate.Context, req: { hook: string; payload: unknown }, ) => Promise<{ status: number; error?: string; subject?: string }>; };`
- **ExecutorStore** (interface) `interface ExecutorStore { claim(a: Arrival, by: string, due?: Date): Promise<string | null>; entered?(workflow: string, subject: string): Promise<number | null | undefined>; release(id: string, by: string): Promise<Arrival | null>; fail(a: Arrival, error: string): Promise<unknown>; retry(id: string, by: string): Promise<Arrival | null>; sent?(id: string, outs: Array<{ port: string; event: ExecutorEvent }>): Promise<void>; }`
- **FireTriggers** (type) `type FireTriggers = (ctx: restate.Context, req: Fired) => void;`
- **Fired** (type) `type Fired = Target & { facts: TriggerFacts; event: ExecutorEvent; about?: string[] };`
- **MadeLive** (class) `constructor()`
- **MadeWorkflow** (interface) `interface MadeWorkflow { id: string; made: Made; live: boolean; draft: boolean; nodes: number; by: string; at: string; }`
- **OFF** (const) `"this workflow is off"`
- **REPLAY_MOST** (const) `200`
- **SHUT** (const) `"this door opens once its workflow is approved"`
- **SavedWorkflow** (interface) `interface SavedWorkflow { id: number; edits: WorkflowEdits | null; by: string; at: string; }`
- **Step** (type) `type Step = ( port: string, e: ExecutorEvent, at: StepAt, ) => Promise<Array<{ port: string; event: ExecutorEvent }>>;`
- **StepAt** (interface) `interface StepAt { client: string | null; workflow: string; node: string; with: Record<string, string | number>; template?: TemplateRef | null; part?: string | null; fire?(f: Omit<Fired, "client">): void; }`
- **Tally** (interface) `interface Tally { arrived: number; seen: number; waiting: number; failed: number; out: number; }`
- **Walk** (interface) `interface Walk { flows: ReadonlyMap<string, Workflow>; version?: number; liveOf?(workflow: string): number; flowsAt?(workflow: string, version: number): Promise<ReadonlyMap<string, Workflow>>; parts: ReadonlyMap<string, Component>; steps: Readonly<Record<string, Step>>; store: ExecutorStore; client: string | null; by: string; run<T>(name: string, fn: () => Promise<T>, capped?: boolean): Promise<T>; later(id: string, ms: number): void; rule(when: string, e: ExecutorEvent): Promise<boolean>; failed?(id: string, workflow: string): void; fire?(req: Fired): void; dry?: (n: WorkflowNode) => Step; }`
- **WorkflowVersion** (interface) `interface WorkflowVersion { id: number; edits: WorkflowEdits | null; by: string; at: string; }`
- **aboutsOf** (function) `(f: Pick<Fired, "event" | "about">): string[]`
- **addHook** (function) `(main: Db, h: HookAsk): Promise<string>`
- **clockKey** (function) `(client: string | null, workflow: string, node: string): string`
- **clockOfKey** (function) `(key: string): { client: string | null; workflow: string; node: string } | null`
- **clocksOf** (function) `(client: string | null, flow: Workflow): LoopKey[]`
- **dropMade** (function) `(db: Queryable, client: string | null, workflow: string): Promise<{ done: number }>`
- **editsOf** (function) `(saved: Readonly<Record<string, SavedWorkflow>>): { [k: string]: WorkflowEdits | null; }`
- **executorEmit** (function) `(ctx: restate.Context, req: EmitRequest): restate.InvocationHandle`
- **executorFire** (function) `(ctx: restate.Context, req: Fired): void`
- **failedOf** (function) `(db: Queryable, refs: readonly string[]): Promise<string[]>`
- **failedRuns** (function) `(db: Queryable): Promise<FailedRuns[]>`
- **heardAs** (function) `(h: { repeat?: true }, event: ExecutorEvent): ExecutorEvent`
- **hearersOf** (function) `(flows: Iterable<Workflow>, facts: TriggerFacts): Array<{ workflow: string; from: string; repeat?: true }>`
- **hookEvent** (function) `(h: Pick<typeof hooks.$inferSelect, "workflow" | "input" | "subject">, flows: ReadonlyMap<string, Workflow>, payload: unknown): { from: string; event: ExecutorEvent } | { status: number; error: string }`
- **httpStep** (function) `(url: string, o: PostOptions = {}): Step`
- **liveFor** (function) `(db: Queryable, client: string, workflow: string): Promise<boolean>`
- **lockWorkflowSaves** (function) `(tx: Tx, client: string | null, workflow: string): Promise<number>`
- **madeWorkflows** (function) `(db: Queryable, client: string | null): Promise<MadeWorkflow[]>`
- **makeExecutor** (function) `(d: ExecutorDeps): restate.ServiceDefinition<"Executor", { emit: (ctx: restate.Context, input: EmitRequest) => Promise<Tally>; release: (ctx: restate.Context, input: Target & { id: string; happened?: ExecutorEvent; }) => Promise<Tally | null>; retry: (ctx: restate.Context, input: Target & { id: string; auto?: number; …`
- **makeExecutorClock** (function) `(d: Pick<ExecutorDeps, "main" | "workflows" | "components">): restate.VirtualObjectDefinition<"ExecutorClock", { start: (ctx: restate.ObjectContext<restate.UntypedState>) => Promise<{ next: string | null; }>; stop: (ctx: restate.ObjectContext<restate.UntypedState>) => Promise<void>; tick: (ctx: restate.ObjectContext<restate.UntypedState>, input: { slot: string…`
- **makeHook** (function) `(db: Queryable, h: HookAsk): Promise<{ id: string; token: string }>`
- **notLive** (function) `(db: Queryable, client: string): Promise<string[]>`
- **passOn** (function) `(e: ExecutorEvent, channel: "email" | "sms" | "reach"): { port: string; event: ExecutorEvent; }[] | null`
- **pgExecutorStore** (function) `(db: Db): ExecutorStore`
- **replyFired** (function) `(client: string | null, channel: "email" | "sms" | "dm", id: number, who: Record<string, string | number> = {}): Fired`
- **resume** (function) `(w: Walk, id: string, happened?: ExecutorEvent): Promise<Tally | null>`
- **retry** (function) `(w: Walk, id: string): Promise<Tally | null>`
- **savedWorkflows** (function) `(db: Queryable, client: string | null): Promise<Record<string, SavedWorkflow>>`
- **sentOf** (function) `(outs: ReadonlyArray<{ port: string; event: ExecutorEvent }>): SentEvent[]`
- **slotEvent** (function) `(node: string, slot: Date): ExecutorEvent`
- **waitMs** (function) `(wait: string): number`
- **walk** (function) `(w: Walk, workflow: string, from: string, batch: ExecutorEvent[]): Promise<Tally>`
- **workflowHistory** (function) `(db: Queryable, client: string | null, workflow: string): Promise<{ draft: WorkflowVersion | null; versions: WorkflowVersion[] }>`

## packages/core/src/experiment-store.ts

- **ExperimentInput** (type) `type ExperimentInput = z.input<typeof ExperimentIn>;`
- **VariantCounts** (interface) `interface VariantCounts { variant: string; visitors: number; forms: number; calls: number; paid: number; }`
- **addExperiment** (function) `(db: Queryable, input: ExperimentInput, by: string): Promise<{ flag: string }>`
- **experimentRecord** (function) `(): RecordType`
- **liveExperiments** (function) `(db: Queryable): Omit<import("drizzle-orm/pg-core").PgSelectBase<"flag_experiments", { e: import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "flag_experiments"; schema: undefined; columns: { flag: import("drizzle-orm/pg-core").PgColumn<{ name: "flag"; tableName: "flag_experiments"; dataType: "string"; columnTy…`
- **removeExperiments** (function) `(db: Queryable, keys: readonly string[]): Promise<string[]>`
- **saveDecision** (function) `(db: Queryable, flag: string, d: Pick<FlagExperiment, "shares" | "pBest" | "retired" | "best"> & { settled: boolean }): Promise<void>`
- **shipExperiments** (function) `(db: Queryable, keys: readonly string[], by: string, push?: EdgePush): Promise<string[]>`
- **startExperiments** (function) `(db: Queryable, keys: readonly string[], by: string, push?: EdgePush): Promise<string[]>`
- **stopExperiments** (function) `(db: Queryable, keys: readonly string[], by: string, push?: EdgePush): Promise<string[]>`
- **variantCounts** (function) `(db: Queryable, flag: string, since: string | null): Promise<VariantCounts[]>`
- **writeFlagDays** (function) `(db: Queryable, rows: readonly Omit<typeof flagDays.$inferInsert, "syncedAt">[]): Promise<number>`

## packages/core/src/facts-list.ts

- **DEFAULT_FACTS** (const) `readonly string[]`
- **FACTS_CAP** (const) `40`
- **FACTS_DROP** (const) `"made things up: "`
- **FACTS_PAGE** (const) `"/marketing/facts"`
- **FACT_MAX** (const) `300`
- **factsChange** (function) `(before: readonly string[], after: readonly string[]): FactsChange`
- **factsChangeText** (function) `(c: FactsChange): string`
- **factsOf** (function) `(text: string): string[]`
- **factsProblem** (function) `(facts: readonly string[]): string | null`
- **factsText** (function) `(facts: readonly string[]): string`

## packages/core/src/facts.ts

- **FACTS_COMPONENTS** (const) `import("./components.js").Component[]`
- **FACTS_ID** (const) `"wren"`
- **factsBlock** (function) `(facts: readonly string[]): string`
- **factsRecord** (const) `import("./records.js").RecordType`
- **humanBlock** (function) `(swear = true): string`
- **wrenFacts** (function) `(db: Queryable): Promise<string[]>`

## packages/core/src/feed.ts

- **Feed** (interface) `interface Feed { emit(e: FeedEvent): Promise<void>; }`
- **FeedEvent** (interface) `interface FeedEvent { step: string; kind: RunEventKind; line: string; subject?: string | null; count?: number | null; source?: FeedSource | null; detail?: string | null; traceId?: string | null; }`
- **FeedLine** (interface) `interface FeedLine extends Required<Omit<FeedEvent, "traceId">> { seq: number; at: string; }`
- **NO_FEED** (const) `Feed`
- **errorText** (function) `(err: unknown): string`
- **readFeed** (function) `(db: Queryable, runId: string, opts: { after?: number; limit?: number } = {}): Promise<FeedLine[]>`
- **runFeed** (function) `(db: Queryable, runId: string, warn = console.warn): Feed`

## packages/core/src/fetch-limit.ts

- **limitSignal** (function) `(ms: number, signal?: AbortSignal | null): AbortSignal`
- **timedFetch** (function) `(ms: number, fetchImpl: Fetchy<I> = (input, init) => fetch(input as string | URL | Request, init)): Fetchy<I>`

## packages/core/src/flag-store.ts

- **EdgePush** (type) `type EdgePush = (flags: readonly FlagDef[], surveys: readonly SurveyDef[]) => Promise<void>;`
- **FlagInput** (type) `type FlagInput = z.input<typeof FlagIn>;`
- **addFlag** (function) `(db: Queryable, input: FlagInput, by: string, push?: EdgePush): Promise<{ key: string }>`
- **flagRecord** (function) `(push?: EdgePush): RecordType`
- **flagsFor** (function) `(db: Queryable, s: FlagSubject): Promise<Record<string, string>>`
- **pushEdge** (function) `(db: Queryable, push: EdgePush | undefined): Promise<void>`
- **removeFlags** (function) `(db: Queryable, keys: readonly string[], push?: EdgePush): Promise<string[]>`
- **siteEdge** (function) `(baseUrl: string, token: string, fetcher: typeof fetch = fetch): EdgePush`

## packages/core/src/flags.ts

- **EXPERIMENT_GOALS** (const) `readonly ["forms", "calls", "paid"]`
- **EXPERIMENT_STATES** (const) `readonly ["draft", "running", "settled", "shipped", "stopped"]`
- **ExperimentGoal** (type) `type ExperimentGoal = (typeof EXPERIMENT_GOALS)[number];`
- **ExperimentState** (type) `type ExperimentState = (typeof EXPERIMENT_STATES)[number];`
- **FlagDef** (interface) `interface FlagDef { key: string; variants: readonly string[]; rules: readonly FlagRule[]; fallback: string; killed: boolean; }`
- **FlagRule** (interface) `interface FlagRule { variant: string; roles?: string[]; clients?: string[]; people?: string[]; percent?: number; }`
- **FlagSubject** (interface) `interface FlagSubject { id: string | null; roles: readonly string[]; client: string | null; person: string | null; }`
- **SURFACES** (const) `readonly ["portal", "site", "both"]`
- **Surface** (type) `type Surface = (typeof SURFACES)[number];`
- **bucketOf** (function) `(key: string, id: string): number`
- **evaluateFlags** (function) `(flags: readonly FlagDef[], s: FlagSubject): Record<string, string>`
- **fnv** (function) `(s: string): number`
- **formatRules** (function) `(rules: readonly FlagRule[]): string`
- **parseRules** (function) `(text: string, variants: readonly string[]): { rules: FlagRule[] } | { error: string }`
- **shareRules** (function) `(variants: readonly string[], shares: Readonly<Record<string, number>>): FlagRule[]`
- **subjectOf** (function) `(who: Who, email: string | null, client: string | null): FlagSubject`
- **variantOf** (function) `(flag: FlagDef, s: FlagSubject): string`

## packages/core/src/follow.ts

- **FOLLOW_COMPONENTS** (const) `import("./components.js").Component[]`
- **FOLLOW_UP** (const) `"follow_up"`
- **FOLLOW_WORKFLOWS** (const) `import("./workflows.js").Workflow[]`
- **FollowNote** (interface) `interface FollowNote { part: FollowPart; node: string; channel: FollowChannel; did: "queued" | "asked" | "would_send" | "skipped" | "answered"; why: string | null; }`
- **NURTURE** (const) `"nurture"`
- **Outs** (type) `type Outs = Array<{ port: string; event: ExecutorEvent }>;`
- **answered** (function) `(e: ExecutorEvent, note: FollowNote): Outs`
- **followPartOf** (function) `(at: Pick<StepAt, "part">): FollowPart`
- **followStart** (function) `(o: { db: Queryable; main: Queryable; channel: FollowChannel; globalOff: GlobalGate; }, e: ExecutorEvent, at: StepAt): Promise<{ outs: Outs } | FollowStart>`
- **isFollowTouch** (function) `(at: Pick<StepAt, "with">): boolean`
- **passed** (function) `(e: ExecutorEvent, note: FollowNote): Outs`

## packages/core/src/github.ts

- **GithubFiles** (interface) `interface GithubFiles { read(path: string): Promise<{ text: string; sha: string } | null>; write(path: string, text: string, message: string): Promise<string | null>; lastCommit(path: string): Promise<string | null>; }`
- **githubRepo** (function) `(o: { token: string; repo: string; branch?: string; api?: string; fetch?: typeof fetch; }): GithubFiles`

## packages/core/src/grants.ts

- **addGrant** (function) `(tx: Queryable, granter: Who, by: string, g: NewGrant): Promise<{ id: number }>`
- **endGrant** (function) `(tx: Queryable, granter: Who, by: string, id: number): Promise<{ ended: number }>`
- **grantInput** (function) `(input: Record<string, unknown>, client: string, email: string): NewGrant`
- **grantsFor** (function) `(db: Queryable, email: string, role: RoleId, client?: string): Promise<Grant[]>`
- **removeRole** (function) `(tx: Queryable, client: string, id: string): Promise<{ removed: string }>`
- **roleFits** (function) `(db: Queryable, role: string, client: string): Promise<boolean>`
- **roleRefusal** (function) `(db: Queryable, by: Who, role: string, client: string): Promise<string | null>`
- **rolesIn** (function) `(db: Queryable, client: string): Promise<RoleView[]>`
- **saveRole** (function) `(tx: Queryable, granter: Who, by: string, r: RoleInput): Promise<{ id: string }>`
- **spendGrant** (function) `(tx: Queryable, who: Who, verb: Permission, at: Target): Promise<number | null>`

## packages/core/src/grounded.ts

- **Grounding** (interface) `interface Grounding { facts: readonly string[]; sources: readonly string[]; own?: readonly string[]; }`
- **Guarded** (interface) `interface Guarded<T> { outcome: GuardOutcome; text: string | null; result: T; flags: GroundingFlag[]; first: string | null; still: GroundingFlag[]; }`
- **claimIn** (function) `(sentence: string): string | null`
- **droppedWhy** (function) `(g: Pick<Guarded<unknown>, "still" | "flags">): string`
- **groundingFlags** (function) `(draft: string, g: Grounding): GroundingFlag[]`
- **guardDraft** (function) `(attempt: (fix: string | null) => Promise<{ text: string; result: T }>, g: Grounding): Promise<Guarded<T>>`
- **guardParts** (function) `(attempt: (fix: string | null) => Promise<{ parts: readonly DraftPart[]; result: T }>, g: Grounding): Promise<Guarded<T>>`
- **numbersIn** (function) `(text: string): { text: string; value: number }[]`
- **partFlags** (function) `(parts: readonly DraftPart[], g: Grounding): GroundingFlag[]`
- **recordGuard** (function) `(db: Queryable, stage: string, item: string, g: Guarded<unknown>, by?: string | null): Promise<void>`

## packages/core/src/html.ts

- **decodeHtml** (function) `(s: string): string`

## packages/core/src/http.ts

- **readBody** (function) `(req: Request, max: number): Promise<string | null>`

## packages/core/src/ids.ts

- **UUID** (const) `RegExp`

## packages/core/src/in-house.ts

- **IN_HOUSE** (const) `readonly InHouse[]`
- **inHouseOfApp** (function) `(app: string): InHouse | null`
- **inHouseOfPart** (function) `(part: string): InHouse | null`
- **includedIn** (function) `(installed: ReadonlySet<string>): { tools: InHouse[]; monthly: number; }`
- **monthlyOf** (function) `(t: InHouse): number | null`
- **totalOf** (function) `(ts: readonly InHouse[]): { tools: InHouse[]; monthly: number }`

## packages/core/src/ingest/countries.ts

- **ISO_ALPHA2** (const) `ReadonlySet<string>`
- **normalizeCountry** (function) `(raw: string | null | undefined): string | null`

## packages/core/src/ingest/google-maps.ts

- **GoogleMapsCsvSource** (class) `readonly sourceType; readonly sourceRef: string;; readonly contentHash: string;; constructor(readonly path: string); rows(): Generator<RawRow>`
- **mapsRow** (function) `(row: RawRow): RawRow`

## packages/core/src/ingest/importer.ts

- **ImportResult** (interface) `interface ImportResult { batch: ImportBatch; stats: ImportStats; }`
- **ImportStats** (interface) `interface ImportStats { rows: number; leads_created: number; leads_suppressed: number; duplicate_leads: number; companies_created: number; companies_seen: number; companies_suppressed: number; domain_conflicts: number; country_unrecognized: number; errors: number; lead_fields: Record<(typeof LEAD_FIELDS)[number], number>; company_fields: Record<(typeof COMPANY_FIELDS)[number], number>; unmapped_headers: string[]; replay_of?: number; declined?: Record<string, number>; }`
- **findReplay** (function) `(db: Queryable, batch: ImportBatch): Promise<number | null>`
- **runImport** (function) `(db: Queryable, source: LeadSource, opts: ImportOptions = {}): Promise<ImportResult>`

## packages/core/src/ingest/overture.ts

- **CHAIN_AT** (const) `3`
- **OverturePlace** (type) `type OverturePlace = Record<string, unknown>;`
- **OverturePlacesSource** (class) `readonly sourceType; readonly sourceRef: string;; readonly contentHash: string;; constructor(readonly path: string, private readonly opts: { chainAt?: number; decline?: PlaceDecline } = {}); rows(): Generator<RawRow>; declined(): Record<string, number>`
- **PUBLIC_BODY** (const) `RegExp`
- **PlaceDecline** (type) `type PlaceDecline = (place: OverturePlace, domain: string | null) => string | null;`
- **declineReason** (function) `(place: OverturePlace, domain: string | null, placesWithDomain: number, opts: { chainAt: number; decline?: PlaceDecline | undefined }): string | null`
- **overtureFormat** (function) `(spec: { name: string; help: string; niche: string; chainAt?: number; decline?: PlaceDecline; }): SourceFormat`
- **overtureRow** (function) `(place: OverturePlace, placesWithDomain: number): RawRow`
- **placeDomain** (function) `(place: OverturePlace): string | null`

## packages/core/src/ingest/sba.ts

- **SbaFirm** (type) `type SbaFirm = Record<string, unknown>;`
- **SbaSearchSource** (class) `readonly sourceType; readonly sourceRef: string;; readonly contentHash: string;; readonly files: string[];; constructor(readonly path: string, private readonly naics: ReadonlySet<string>); rows(): Generator<RawRow>; declined(): Record<string, number>`
- **principalTitle** (function) `(principals: string | null, contact: string | null): string | null`
- **sbaRow** (function) `(firm: SbaFirm): RawRow`
- **sbaSearchFormat** (function) `(spec: { name: string; help: string; niche: string; naics: readonly string[]; }): SourceFormat`
- **stateCode** (function) `(state: string | null): string | null`
- **unshout** (function) `(s: string): string`

## packages/core/src/ingest/schema.ts

- **CANONICAL_FIELDS** (const) `ReadonlySet<string>`
- **CanonicalField** (type) `type CanonicalField = keyof typeof ALIASES;`
- **ClassifiedRow** (type) `type ClassifiedRow = LeadRow | CompanyRow | RowError;`
- **ClassifyOptions** (interface) `interface ClassifyOptions { columnMap?: Record<string, string>; extraPlatformDomains?: Iterable<string>; }`
- **CompanyRow** (interface) `interface CompanyRow { kind: "company"; domain: string | null; name: string | null; sourceKey: string | null; socialUrl: string | null; country: string | null; }`
- **Fields** (type) `type Fields = Partial<Record<CanonicalField, string>>;`
- **IDENTITY_KEY** (const) `"_identity"`
- **LeadRow** (interface) `interface LeadRow { kind: "lead"; email: string; firstName: string | null; lastName: string | null; title: string | null; companyName: string | null; companyDomain: string | null; socialUrl: string | null; country: string | null; countryRaw: string | null; persona: string | null; source: string | null; geo: string | null; sourceKey: string | null; }`
- **RawRow** (type) `type RawRow = Record<string, unknown>;`
- **RowError** (interface) `interface RowError { kind: "error"; reason: string; }`
- **canonicalize** (function) `(raw: RawRow, columnMap?: Record<string, string>): Fields`
- **classifyRow** (function) `(raw: RawRow, opts: ClassifyOptions = {}): ClassifiedRow`
- **mintedIdentity** (function) `(raw: RawRow): string | null`
- **validateCompanyRow** (function) `(row: Omit<CompanyRow, "kind">): CompanyRow | RowError`
- **validateLeadRow** (function) `(row: Omit<LeadRow, "kind">): LeadRow | RowError`

## packages/core/src/ingest/screen.ts

- **CompanyScreen** (interface) `interface CompanyScreen { readonly countries: readonly string[]; readonly chainAt: number; readonly decline?: (company: ScreenedCompany) => string | null; }`
- **ScreenedCompany** (type) `type ScreenedCompany = Pick<Company, "id" | "domain" | "name" | "country" | "raw">;`
- **chainSizes** (function) `(rows: readonly Pick<ScreenedCompany, "domain" | "raw">[]): Map<string, number>`
- **domainCountry** (function) `(domain: string): string | null`
- **inPlay** (const) `import("drizzle-orm").SQL<unknown>`
- **isCommercialName** (function) `(name: string): boolean`
- **publicBodyName** (function) `(name: string): boolean`
- **runScreen** (function) `(db: Queryable, niche: string, screen: CompanyScreen, opts: { dryRun?: boolean } = {}): Promise<ScreenStats>`
- **screenCompany** (function) `(company: ScreenedCompany, screen: CompanyScreen, chains: ReadonlyMap<string, number>): string | null`

## packages/core/src/ingest/sources.ts

- **BUILTIN_FORMATS** (const) `Readonly<Record<string, SourceFormat>>`
- **CsvLeadSource** (class) `readonly sourceType; readonly sourceRef: string;; readonly contentHash: string;; constructor(readonly path: string); rows(): Generator<RawRow>`
- **LeadSource** (interface) `interface LeadSource { sourceType: string; sourceRef: string; contentHash?: string; rows(): Iterable<RawRow> | AsyncIterable<RawRow>; declined?(): Record<string, number>; }`
- **SourceFormat** (interface) `interface SourceFormat { name: string; help: string; build: (path: string) => LeadSource; niche: string | null; columnMapped: boolean; directory: boolean; }`
- **decodeCsvBytes** (function) `(data: Uint8Array, name = "<bytes>"): { text: string; encoding: "utf-8" | "cp1252" }`
- **dedupeHeaders** (function) `(headers: string[]): string[]`
- **parseCsvRecords** (function) `(text: string): string[][]`
- **rowsFromRecords** (function) `(records: Iterable<string[]>): Generator<RawRow>`

## packages/core/src/installs.ts

- **accountsLacking** (function) `(c: Component, client: Pick<Client, "accounts">): string[]`
- **lacking** (function) `(c: Component, client: Pick<Client, "products" | "accounts">): string[]`

## packages/core/src/key-id.ts

- **keyId** (function) `(secret: string): string`

## packages/core/src/key-refs.ts

- **KEY_LABEL** (const) `RegExp`
- **KEY_MAX** (const) `4096`
- **KEY_REF** (const) `RegExp`
- **KEY_STAGE_PATH** (const) `"/api/keys/stage"`
- **KEY_VIEWER_HEADER** (const) `"x-wren-viewer"`
- **MAIL_TOKEN_NAME** (const) `RegExp`
- **REF_ROUTES** (const) `readonly string[]`
- **keyProblem** (function) `(name: string, value: string, from: "person" | "wren" = "person", label = "default"): string | null`
- **keyRef** (const) `z.ZodString`
- **last4** (function) `(value: string): string`
- **looksLikeKey** (function) `(s: string): boolean`
- **noRawKeys** (function) `(schema: T): T`
- **rawKeyAt** (function) `(input: unknown, path = ""): string | null`

## packages/core/src/keys-schema.ts

- **ClientSecretEvent** (type) `type ClientSecretEvent = typeof clientSecretEvents.$inferSelect;`
- **ClientSecretRow** (type) `type ClientSecretRow = typeof clientSecrets.$inferSelect;`
- **SECRET_OPS** (const) `readonly ["stage", "bind", "put", "rotate", "read", "delete", "expire", "rewrap"]`
- **SECRET_STATES** (const) `readonly ["staged", "live"]`
- **SecretOp** (type) `type SecretOp = (typeof SECRET_OPS)[number];`
- **SecretState** (type) `type SecretState = (typeof SECRET_STATES)[number];`
- **VAULT_KEY_STATES** (const) `readonly ["live", "spent", "revoked"]`
- **VaultKeyRow** (type) `type VaultKeyRow = typeof vaultKeys.$inferSelect;`
- **VaultKeyState** (type) `type VaultKeyState = (typeof VAULT_KEY_STATES)[number];`
- **clientSecretEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "client_secret_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "client_secret_events"; dataType: "number"; columnType: "PgBigSerial53"; data: number; driverParam: number; notNull: true…`
- **clientSecrets** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "client_secrets"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "client_secrets"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: fa…`
- **vaultKeys** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "vault_keys"; schema: undefined; columns: { address: import("drizzle-orm/pg-core").PgColumn<{ name: "address"; tableName: "vault_keys"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: …`

## packages/core/src/keys.ts

- **KeyRefusal** (class) ``
- **KeyStore** (interface) `interface KeyStore { stage(o: { client: string; name: string; label?: string; value: string; by: string }): Promise<{ ref: string; last4: string; }>; bind(o: { ref: string; client: string; name: string; label?: string; by: string; }): Promise<KeyInfo>; put(o: { client: string; name: string; label?: string; value: string; by: string; }): Promise<KeyInfo>; rotate(o: { ref: string; client: string; value: string; by: string }): Promise<KeyInfo>; get(o: { ref: string; client: string; by: string; why: string }): Promise<string | null>; named(o: { client: string; name: string; label?: string; by: string; why: string; }): Promise<string | null>; delete(o: { ref: string; client: string; by: string }): Promise<boolean>; info(o: { ref: string; client: string }): Promise<KeyInfo | null>; }`
- **STAGED_FOR_MS** (const) `number`
- **Sealer** (interface) `interface Sealer { kid: string; seal(aad: string, value: string): { kid: string; wrapped: Uint8Array; sealed: Uint8Array }; }`
- **intakeKey** (function) `(main: Db, sealer: Sealer | null, email: string | null, body: unknown, may: (main: Queryable, email: string, client: string) => Promise<boolean> = maySaveKeys): Promise<{ status: number; body: { ref: string; last4: string } | { error: string } }>`
- **keyRing** (function) `(spec: string): KeyRing`
- **keySealer** (function) `(spec: string): Sealer`
- **keyStoreFromEnv** (function) `(main: Db, env: NodeJS.ProcessEnv = process.env): KeyStore | null`
- **maySaveKeys** (function) `(main: Queryable, email: string, client: string): Promise<boolean>`
- **newKeyPair** (function) `(kid: string): { privateSpec: string; publicSpec: string }`
- **pgKeyStore** (function) `(main: Db, ring: KeyRing | Sealer, clock: () => Date = () => new Date()): KeyStore`
- **publicSpecOf** (function) `(privateSpec: string): string`
- **rewrapAll** (function) `(main: Db, ring: KeyRing): Promise<number>`
- **sealerFromEnv** (function) `(env: NodeJS.ProcessEnv = process.env): Sealer | null`
- **stageKey** (function) `(main: Db, sealer: Sealer, o: { client: string; name: string; label?: string; value: string; by: string; now?: Date }): Promise<{ ref: string; last4: string }>`
- **throwawayRing** (function) `(kid = "t1"): KeyRing`

## packages/core/src/leads.ts

- **Thread** (interface) `interface Thread { channel: LeadChannel; id: number; }`
- **activeElsewhere** (function) `(db: Queryable, lead: Lead, channel: LeadChannel): Promise<string | null>`
- **activeSequence** (function) `(db: Queryable, who: Who): Promise<string | null>`
- **firstTouchElsewhere** (function) `(db: Queryable, companyId: number, channel: LeadChannel, now: Date): Promise<string | null>`
- **leadAnswered** (function) `(db: Queryable, who: Who): Promise<string | null>`
- **leadOfEvent** (function) `(db: Queryable, e: { subject: string; data: Record<string, unknown> }): Promise<Who | null>`
- **leadRefusal** (function) `(db: Queryable, lead: Lead, channel: LeadChannel, now: Date, keys: readonly ProfileKey[] = []): Promise<string | null>`
- **leadThreads** (function) `(db: Queryable, abouts: readonly string[]): Promise<string[]>`
- **linkPeople** (function) `(db: Queryable, table: ContactTable, ids?: readonly number[]): Promise<number>`
- **threadOf** (function) `(subject: string): Thread | null`
- **threadOn** (function) `(db: Queryable, who: Who, channel: LeadChannel): Promise<number | null>`
- **Lead** (interface) `interface Lead { personId: number | null; companyId: number | null; }`
- **Who** (type) `type Who = Lead | Thread;`

## packages/core/src/library.ts

- **SNIPPET** (const) `"library.snippet"`
- **SnippetInput** (type) `type SnippetInput = z.input<typeof SnippetIn>;`
- **SnippetLine** (interface) `interface SnippetLine { id: number; title: string; body: string; tags: string[]; channel: SnippetChannel; }`
- **addSnippet** (function) `(db: Queryable, input: SnippetInput, by: string, workspace = WREN): Promise<SnippetLine>`
- **removeSnippet** (function) `(db: Queryable, id: number, workspace = WREN): Promise<void>`
- **snippetRecord** (function) `(seen: readonly string[] = []): RecordType`
- **snippetTags** (function) `(db: Queryable): Promise<string[]>`
- **snippetsOf** (function) `(db: Queryable, workspace = WREN): Promise<SnippetLine[]>`
- **tagsOf** (function) `(raw: unknown): string[]`
- **workflowRecord** (function) `(workflows: readonly Workflow[], parts: readonly Component[]): RecordType`
- **CHANNELS** (const) `readonly ["any", "email", "sms", "dm", "comment"]`

## packages/core/src/limits-schema.ts

- **LimitRow** (type) `type LimitRow = typeof limits.$inferSelect;`
- **limits** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "limits"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "limits"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey:…`

## packages/core/src/limits.ts

- **Limit** (interface) `interface Limit { perDay: number; burst: number | null; }`
- **LimitDef** (interface) `interface LimitDef { name: string; unit: string; why: string; perDay: number; burst: number | null; scope: LimitScope; }`
- **LimitScope** (type) `type LimitScope = "client" | "shared" | "wren";`
- **LimitSource** (type) `type LimitSource = "default" | "wren" | "client";`
- **LimitView** (interface) `interface LimitView { def: LimitDef; wren: Limit | null; client: Limit | null; holds: Limit; from: LimitSource; }`
- **limitOf** (function) `(main: Queryable, client: string | null, def: LimitDef): Promise<Limit>`
- **limitsView** (function) `(main: Queryable, client: string | null, defs: readonly LimitDef[]): Promise<LimitView[]>`
- **setLimit** (function) `(main: Db, defs: readonly LimitDef[], o: { client: string | null; name: string; perDay: number; burst?: number | null; by: string }): Promise<{ before: Limit | null; after: Limit }>`
- **unsetLimit** (function) `(main: Db, defs: readonly LimitDef[], o: { client: string | null; name: string }): Promise<{ before: Limit | null }>`
- **bucketOf** (function) `(main: Queryable, client: string | null, def: LimitDef): Promise<Bucket>`

## packages/core/src/line-diff.ts

- **DiffLine** (interface) `interface DiffLine { op: " " | "-" | "+"; text: string; a: number | null; b: number | null; }`
- **changed** (function) `(lines: readonly DiffLine[]): boolean`
- **lineDiff** (function) `(a: string, b: string): DiffLine[]`
- **unified** (function) `(lines: readonly DiffLine[], names: [string, string], context = 3): string`

## packages/core/src/logic.ts

- **AppChange** (type) `type AppChange = keyof typeof APP_CHANGES;`
- **CODE_MOST** (const) `10000`
- **CONNECTOR_APP_NAMES** (const) `{ readonly hubspot: "HubSpot"; readonly quickbooks: "QuickBooks"; readonly jobber: "Jobber"; }`
- **DOOR_TRIGGERS** (const) `ReadonlySet<string>`
- **DateEvery** (type) `type DateEvery = keyof typeof DATE_EVERY;`
- **KINDS** (const) `readonly ["firm", "person", "lead", "reply", "call", "form", "post", "video", "client", "invoice", "mail", "comment", "item", "account", "deal", "document", "journey", "doc"]`
- **LOGIC** (const) `readonly LogicPart[]`
- **LogicSetting** (interface) `interface LogicSetting { field: string; label: string; type: "text" | "long" | "number" | "choice"; options?: readonly string[]; labels?: Readonly<Record<string, string>>; hint?: string; start?: string | number; shows?: Readonly<Record<string, string>>; }`
- **PAY_CHANGES** (const) `{ readonly paid: "Paid"; readonly refunded: "Refunded or a dispute lost"; readonly failed: "A bank payment failed"; readonly invoiced: "An invoice issued"; readonly late: "An invoice past due"; }`
- **PayChange** (type) `type PayChange = keyof typeof PAY_CHANGES;`
- **SCHEDULE_ZONE** (const) `"America/New_York"`
- **SOP_NAME** (const) `RegExp`
- **SOURCE_ID** (const) `RegExp`
- **STUDY_SLUG** (const) `RegExp`
- **TOUCH_ON_DIRECTIONS** (const) `readonly ["ours", "theirs"]`
- **TOUCH_ON_KINDS** (const) `readonly ["follow", "connect", "comment", "reply", "dm", "like", "mention"]`
- **TOUCH_ON_PLATFORMS** (const) `readonly ["linkedin", "reddit", "youtube", "x", "instagram", "facebook", "tiktok", "google_business"]`
- **TRIGGER_IDS** (const) `ReadonlySet<string>`
- **TriggerFacts** (type) `type TriggerFacts = | { trigger: "trigger.reply"; channel: "email" | "sms" | "dm" } | { trigger: "trigger.booking"; change: "booked" | "cancelled" } | { trigger: "trigger.flag"; change: "raised" | "cleared"; side: "risk" | "opportunity" } | { trigger: "trigger.payment"; change: PayChange } | { trigger: "trigger.touch"; kind: string; direction: string; platform: string } | { trigger: "trigger.document"; change: DocChange; kind: string } | { trigger: "trigger.journey"; node: string; change: JourneyChange; sale?: true; } | { trigger: "trigger.app"; app: string; change: AppChange } | { trigger: "trigger.segment"; segment: number; change: SegmentChange } | { trigger: "trigger.source"; source: string } | { trigger: "trigger.found"; sop?: string; study?: string } | { trigger: "trigger.station"; station: string } | { trigger: "trigger.trait"; key: string; value: string | null } | { trigger: "trigger.date"; key: string; offset: number; every: DateEvery };`
- **UNTILS** (const) `readonly ["reply", "booking", "answer", "cancelled"]`
- **UNTIL_LABELS** (const) `Record<Until, string>`
- **UNTIL_WORDS** (const) `Record<Until, string>`
- **Until** (type) `type Until = (typeof UNTILS)[number];`
- **aboutOf** (function) `(subject: string): string`
- **casesOf** (function) `(raw: unknown): { id: string; label: string }[]`
- **codeProblems** (function) `(code: string): string[]`
- **dig** (function) `(v: unknown, path: string): unknown`
- **doorOf** (function) `(n: WorkflowNode): { subject: string; fields: FieldMap } | null`
- **everyOf** (function) `(v: unknown): DateEvery`
- **holdOf** (function) `(n: WorkflowNode | undefined): string | undefined`
- **isUntil** (function) `(v: unknown): v is Until`
- **logicOf** (function) `(id: string | null | undefined): LogicPart | undefined`
- **logicProblems** (function) `(at: string, n: WorkflowNode): string[]`
- **logicSteps** (function) `(rule: (when: string, e: ExecutorEvent, client?: string | null) => Promise<boolean>): Record<string, Step>`
- **nextSlot** (function) `(w: Readonly<Record<string, string | number>>, after: Date): Date | null`
- **offsetOf** (function) `(v: unknown): number`
- **segmentRepeatOf** (function) `(v: unknown): SegmentRepeat`
- **shareOf** (function) `(v: unknown): number`
- **startWith** (function) `(l: LogicPart): Record<string, string | number>`
- **triggerHears** (function) `(n: WorkflowNode, f: TriggerFacts): boolean`
- **untilOf** (function) `(n: { uses?: string | null; with?: WorkflowNode["with"] | undefined } | undefined): { until: Until; most: string } | undefined`
- **untilOfFacts** (function) `(f: TriggerFacts): Until | null`
- **untilText** (function) `(until: string | null | undefined): string | null`
- **untilsFreedBy** (function) `(fired: Until): Until[]`
- **bucketOf** (function) `(subject: string, node: string): number`

## packages/core/src/loop-watch.ts

- **COOL_MS** (const) `number`
- **Health** (type) `type Health = "alive" | "stopped" | "dead" | "stuck";`
- **Incident** (interface) `interface Incident { id: string; service: string; key: string; kind: "dead" | "stuck"; why: string; since: string; restarts: number; restartedAt: string | null; healthySince: string | null; gaveUp: boolean; letter?: number | null; blocker?: OpenCall | null; }`
- **LOOP_WATCH_KEY** (const) `"all"`
- **LoopHealth** (interface) `interface LoopHealth { id: string; service: string; key: string; health: Health; why: string; blocker: OpenCall | null; lastAt: string | null; nextAt: string | null; timeouts: TimedOut[]; }`
- **LoopView** (interface) `interface LoopView extends LoopRow { open: OpenCall[]; waitsOn: OpenCall[]; }`
- **LoopWatch** (type) `type LoopWatch = ReturnType<typeof makeLoopWatch>;`
- **LoopWatchPass** (interface) `interface LoopWatchPass { loops: number; alive: number; stopped: number; dead: number; stuck: number; restart: { service: string; key: string }[]; notices: Notice[]; incidents: Record<string, Incident>; timedOut: Record<string, { calls: number; held: number }>; }`
- **MAX_RESTARTS** (const) `6`
- **OpenCall** (interface) `interface OpenCall { id: string; target: string; status: string; movedAt: string; }`
- **RESTART_EVERY_MS** (const) `number`
- **expectOf** (function) `(service: string): LoopExpect`
- **healthOf** (function) `(l: LoopView, now: Date, ex: LoopExpect = expectOf(l.service)): LoopHealth`
- **loopHealth** (function) `(admin: RestateAdmin, now: Date): Promise<LoopHealth[]>`
- **makeLoopWatch** (function) `(deps: LoopWatchDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<LoopWatchPass>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<LoopWatchPass>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | nu…`
- **noticesOf** (function) `(plan: WatchPlan): Notice[]`
- **planWatch** (function) `(health: readonly LoopHealth[], before: Readonly<Record<string, Incident>>, now: Date): WatchPlan`

## packages/core/src/mail.ts

- **ContentType** (interface) `interface ContentType { readonly type: string; readonly params: Readonly<Record<string, string>>; }`
- **MimePart** (class) `constructor(readonly headers: readonly MimeHeader[], private readonly rawBody: string, readonly parts: readonly MimePart[]); get(name: string): string | null; getAll(name: string): string[]; getRaw(name: string): string | null; getAllRaw(name: string): string[]; has(name: string): boolean; get contentType(): ContentType; get type(): string; get maintype(): string; param(name: string): string | null; isAttachment(): boolean; filename(): string | null; walk(): IterableIterator<MimePart>; bytes(): Uint8Array; text(): string`
- **decodeEncodedWords** (function) `(value: string): string`
- **getAddresses** (function) `(values: readonly string[]): Array<[string, string]>`
- **parseAddr** (function) `(value: string): [string, string]`
- **parseDate** (function) `(value: string | null): Date | null`
- **parseMessage** (function) `(raw: Uint8Array | string): MimePart`

## packages/core/src/mailbox.ts

- **DelegatedGmail** (interface) `interface DelegatedGmail { searchAll(sender: string, query: string): Promise<string[]>; getRaw(sender: string, messageId: string): Promise<Uint8Array>; getMetadata(sender: string, messageId: string, headers: readonly string[]): Promise<unknown>; }`
- **MailMeta** (interface) `interface MailMeta { id: string; threadId: string; fromName: string; fromAddress: string; subject: string; snippet: string; at: Date; link?: string | null; }`
- **MailSender** (interface) `interface MailSender { readonly address: string; reply(to: ReplyTo, body: string, ours: string): Promise<Replied>; }`
- **Mailbox** (interface) `interface Mailbox { readonly address: string; search(query: string): Promise<string[]>; raw(id: string): Promise<Uint8Array>; meta(id: string): Promise<MailMeta>; }`
- **Replied** (interface) `interface Replied { id: string | null; threadId: string | null; }`
- **ReplyTo** (interface) `interface ReplyTo { messageId: string; threadId: string; to: string; subject: string; }`
- **delegatedMailbox** (function) `(gmail: DelegatedGmail, address: string): Mailbox`
- **isWarmupMail** (function) `(subject: string): boolean`
- **metaOf** (function) `(raw: unknown): MailMeta`
- **senderMatches** (function) `(address: string, sender: string): boolean`
- **siteMailbox** (function) `(sites: SiteClient, address: string): Mailbox`

## packages/core/src/marketing-console-routes.ts

- **MARKETING_CONSOLE_APPS** (const) `{ readonly "*": null; readonly approveDraft: "marketing"; readonly rejectDraft: "marketing"; readonly redraft: "marketing"; readonly draftFields: "marketing"; readonly draftAttach: "marketing"; readonly draftFunnel: "marketing"; readonly draftSlides: "marketing"; readonly promote: "marketing"; reado…`
- **MARKETING_CONSOLE_ROUTES** (const) `{ readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsGet: "read"; readonly recordsExport: "read"; readonly recordsStats: "read"; readonly approveDraft: "act"; readonly rejectDraft: "act"; readonly redraft: "act"; readonly draftFields: "act"; readonly draftAttach: "act"; rea…`
- **MARKETING_CONSOLE_WRITES** (const) `readonly MarketingConsoleRoute[]`
- **POST_NOW** (const) `"post_now"`

## packages/core/src/marketing-records.ts

- **MARKETING_RECORDS** (const) `import("./records.js").RecordType[]`

## packages/core/src/marketing.ts

- **LinkFor** (interface) `interface LinkFor { channel: MarketingChannel; address: string; topic?: string | undefined; client?: string | undefined; }`
- **addressOf** (function) `(channel: MarketingChannel, address: string): string`
- **askConsent** (function) `(db: Queryable, input: SignUp): Promise<{ consent: Consent; confirm: boolean }>`
- **confirmConsent** (function) `(db: Queryable, input: { channel: MarketingChannel; address: string; topic: string; evidence: Evidence; by: string; now?: Date; }): Promise<Consent | null>`
- **consentIdOf** (function) `(db: Queryable, channel: MarketingChannel, address: string, topic: string): Promise<number | null>`
- **emailTopics** (function) `(db: Queryable): Omit<import("drizzle-orm/pg-core").PgSelectBase<"topics", { name: import("drizzle-orm/pg-core").PgColumn<{ name: "name"; tableName: "topics"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false;…`
- **giveConsent** (function) `(db: Queryable, input: SignUp): Promise<Consent>`
- **issueAudience** (function) `(db: Queryable, topic: string): Promise<{ consentId: number; address: string; }[]>`
- **issueSends** (function) `(db: Queryable, issue: string): Promise<number>`
- **issueSentTo** (function) `(db: Queryable, consentId: number, issue: string): Promise<boolean>`
- **linkKey** (function) `(shared: string): string`
- **marketingEnvelope** (function) `(o: { key: string; site: string; address: string; topic: string; postal: string; why: string; client?: string | null; }): { headers: [string, string][]; footer: string }`
- **marketingRoomAt** (function) `(db: Queryable, input: { channel: MarketingChannel; address: string; now: Date; person?: string }): Promise<Date | null>`
- **mayAskConsent** (function) `(db: Queryable, channel: MarketingChannel, address: string): Promise<boolean>`
- **mayMarket** (function) `(db: Queryable, input: { channel: MarketingChannel; address: string; topic: string; now?: Date; person?: string; }): Promise<Verdict>`
- **pauseMarketing** (function) `(db: Queryable, input: { channel: MarketingChannel; address: string; days: 30 | 90 | null; by: string; now?: Date; }): Promise<number>`
- **preferencesOf** (function) `(db: Queryable, channel: MarketingChannel, address: string): Promise<{ address: string; everything: boolean; frequency: "weekly" | "as_sent" | "monthly"; pausedUntil: Date | null; topics: { name: string; publicName: string; line: string; cadence: string; on: boolean; }[]; }>`
- **readLink** (function) `(key: string, token: string): LinkFor | null`
- **recordMarketingSend** (function) `(db: Queryable, input: { consentId: number; by: string; evidence?: Evidence; now?: Date; person?: string; campaign?: string | null; capped?: boolean; messageId?: string | null; }): Promise<void>`
- **saveTopic** (function) `(db: Queryable, t: { name: string; channel: MarketingChannel; publicName: string; line: string; cadence: string; public: boolean; }): Promise<{ name: string; id: number; channel: "email" | "sms"; keyword: string | null; createdAt: Date; publicName: string; line: string; cadence: string; public: boolean; }>`
- **setFrequency** (function) `(db: Queryable, input: { channel: MarketingChannel; address: string; frequency: Frequency; by: string }): Promise<number>`
- **signLink** (function) `(key: string, to: LinkFor): string`
- **signupSig** (function) `(shared: string, topic: string, address: string): string`
- **topicByKeyword** (function) `(db: Queryable, text: string): Promise<{ id: number; name: string; publicName: string; line: string; channel: "email" | "sms"; cadence: string; public: boolean; keyword: string | null; createdAt: Date; } | null>`
- **topicConsents** (function) `(db: Queryable, topic: string): Promise<{ changedAt: Date; consentId: number; address: string; state: "pending" | "confirmed" | "withdrawn"; }[]>`
- **undoUnsubscribeEverything** (function) `(db: Queryable, input: { channel: MarketingChannel; address: string; event: number; now?: Date }): Promise<boolean>`
- **unsubscribeEverything** (function) `(db: Queryable, input: { channel: MarketingChannel; address: string; evidence: Evidence }): Promise<number>`
- **withdrawConsent** (function) `(db: Queryable, input: { channel: MarketingChannel; address: string; topic: string; evidence?: Evidence; by: string; now?: Date; }): Promise<Consent | null>`
- **Verdict** (type) `type Verdict = | { send: true; consent: Consent } | { send: false; why: "suppressed" | "no consent" | "pending" | "withdrawn" | "paused" | "capped"; consent?: Consent; };`

## packages/core/src/maybe-sent.ts

- **refusalOf** (function) `(err: NotSent): SiteCallError`
- **sendOnce** (function) `(o: SendOnce<S>): Promise<SendOutcome<S>>`

## packages/core/src/message-settings.ts

- **CAP_MAX** (const) `100`
- **LinkTags** (interface) `interface LinkTags { source: string; medium: string; campaign?: string | null; }`
- **MESSAGE_DEFAULTS** (const) `Readonly<MessageSettings>`
- **MessageSettings** (interface) `interface MessageSettings { capPerDay: number | null; capPerWeek: number | null; utmLinks: boolean; sender: string | null; postal: string | null; }`
- **campaignOfRef** (function) `(ref: string | null | undefined): string | null`
- **capCheck** (function) `(db: Queryable, channel: SendChannel, address: string, now: Date, platform?: string): Promise<{ person: string; until: Date | null }>`
- **capOf** (function) `(input: unknown): number | null`
- **capRoomAt** (function) `(db: Queryable, personKey: string, now: Date = new Date()): Promise<Date | null>`
- **countMarketingSend** (function) `(db: Queryable, input: Parameters<typeof recordMessageSend>[1]): Promise<void>`
- **keysOfPerson** (function) `(db: Queryable, personKey: string): Promise<string[]>`
- **overCap** (function) `(db: Queryable, personKey: string, now: Date = new Date()): Promise<"day" | "week" | null>`
- **personKeyOf** (function) `(db: Queryable, channel: SendChannel, address: string, platform?: string): Promise<string>`
- **postalOf** (function) `(input: unknown): string | null`
- **readMessageSettings** (function) `(db: Queryable): Promise<MessageSettings>`
- **recordMessageSend** (function) `(db: Queryable, input: { personKey: string; channel: SendChannel; campaign?: string | null; now?: Date; }): Promise<void>`
- **saveMessageSettings** (function) `(db: Queryable, patch: Partial<MessageSettings>, by: string): Promise<MessageSettings>`
- **setPersonResolver** (function) `(fn: PersonResolver | null): void`
- **slugOf** (function) `(name: string): string`
- **tagLinks** (function) `(text: string, tags: LinkTags): string`
- **tagged** (function) `(db: Queryable, text: string, tags: LinkTags): Promise<string>`

## packages/core/src/message-step.ts

- **messageStep** (function) `(main: Queryable, deps: { mail: MailOf; open: (client: string) => Queryable }): Step`
- **messageWould** (function) `(w: StepAt["with"], e: ExecutorEvent): string`
- **notifyLine** (function) `(w: StepAt["with"], e: ExecutorEvent, workflow: string): string`
- **notifyStep** (function) `(notifierFor: (client: string | null) => Notifier | null, portal = "https://app.wrenautomation.com"): Step`
- **personOf** (function) `(e: ExecutorEvent): { email: string; phone: string; name: string | null }`

## packages/core/src/metered.ts

- **keyedSites** (function) `(sites: SiteClient, s: Omit<MeterScope, "part"> & { part?: string; store: KeyStore | null; fetch?: FetchLike }): SiteClient`
- **meteredModel** (function) `(llm: L, s: Omit<MeterScope, "step"> & { store: KeyStore | null; own: (key: string) => Pick<L, "complete">; unset?: "refuse" | "managed"; }): L`
- **meteredSites** (function) `(sites: SiteClient, s: MeterScope & { store: KeyStore | null; fetch?: FetchLike; unset?: "refuse" | "managed" }): SiteClient`

## packages/core/src/model-labels.ts

- **Words** (type) `type Words = true | "model" | "reason";`
- **modelLabel** (function) `(id: string): string`
- **modelVia** (function) `(id: string): string | null`
- **wordsOf** (function) `(words: Words, s: string): string`

## packages/core/src/notify.ts

- **Broadcast** (class) `readonly name: string;; constructor(private readonly subscribers: readonly Notifier[]); notify(title: string, body?: string, level?: NotifyLevel): Promise<boolean>`
- **ConsoleNotifier** (class) `readonly name; constructor(private readonly write: (line: string) => void = console.log); notify(title: string, body = "", level: NotifyLevel = "info"): Promise<boolean>`
- **DiscordNotifier** (class) `readonly name; constructor(private readonly webhookUrl: string, private readonly http: typeof fetch = fetch, private readonly log: (line: string) => void = console.warn, private readonly pingUserId?: string); notify(title: string, body = "", level: NotifyLevel = "info"): Promise<boolean>`
- **NoneNotifier** (class) `readonly name; notify(): Promise<boolean>`
- **Notifier** (interface) `interface Notifier { readonly name: string; notify(title: string, body?: string, level?: NotifyLevel): Promise<boolean>; }`
- **NotifyLevel** (type) `type NotifyLevel = "info" | "action" | "warning";`
- **makeNotifier** (function) `(kind: NotifierKind, opts: { discordWebhookUrl?: string | null; discordPingUserId?: string | null; http?: typeof fetch; } = {}): Notifier`
- **namedFor** (function) `(notifier: Notifier, who: string): Notifier`
- **pings** (function) `(level: NotifyLevel): boolean`
- **plural** (function) `(n: number, one: string, many = '${one}s'): string`

## packages/core/src/objects-schema.ts

- **OBJECT_KINDS** (const) `readonly ["post", "comment", "group"]`
- **ObjectKind** (type) `type ObjectKind = (typeof OBJECT_KINDS)[number];`
- **PlatformObject** (type) `type PlatformObject = typeof platformObjects.$inferSelect;`
- **PlatformObjectRef** (type) `type PlatformObjectRef = typeof platformObjectRefs.$inferSelect;`
- **platformObjectRefs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "platform_object_refs"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "platform_object_refs"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNu…`
- **platformObjects** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "platform_objects"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "platform_objects"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true…`

## packages/core/src/objects/canon.ts

- **CANON_PLATFORMS** (const) `Platform[]`
- **CanonError** (class) `override name`
- **canonRef** (function) `(platform: string, kind: ObjectKind, raw: string): string`
- **fromUrl** (function) `(url: string): ObjectId | null`
- **looksLikeUrl** (function) `(text: string): boolean`
- **normalUrl** (function) `(url: string): string`
- **preferRef** (function) `(platform: string, a: string, b: string): string`
- **redditCommentRef** (function) `(raw: string): string`
- **redditPostRef** (function) `(raw: string): string`

## packages/core/src/objects/index.ts

- **FoundObject** (interface) `interface FoundObject extends PlatformObject { aliases: string[]; }`
- **LinkRefusedError** (class) `override name`
- **LinkResult** (interface) `interface LinkResult { platform: string; kept: string; dropped: string | null; moves: LinkMove[]; }`
- **RoleRows** (interface) `interface RoleRows { table: string; column: string; count: number; ids: string[]; }`
- **findObject** (function) `(db: Queryable, spelling: string, platform?: string | null): Promise<FoundObject | null>`
- **linkRefs** (function) `(db: Queryable, platform: string, a: string, b: string, o: { by: string }): Promise<LinkResult>`
- **resolveComments** (function) `(db: Queryable, platform: Platform, post: { raw: string; url?: string | null | undefined; author?: string | null | undefined; at?: Date | null | undefined; }, seen: readonly CommentSeen[]): Promise<CommentsResolved>`
- **resolveObject** (function) `(db: Queryable, input: ObjectInput): Promise<string>`
- **resolveObjectOrNull** (function) `(db: Queryable, input: ObjectInput): Promise<string | null>`
- **resolveObjects** (function) `(db: Queryable, items: readonly ObjectInput[]): Promise<Map<string, string>>`
- **roleRowsOf** (function) `(db: Queryable, platform: string, refs: readonly string[]): Promise<RoleRows[]>`

## packages/core/src/objects/roles.ts

- **ITEM_HOMES** (const) `readonly ItemHome[]`
- **OBJECT_ROLES** (const) `readonly ObjectRole[]`
- **ObjectRole** (interface) `interface ObjectRole { table: string; platform: string; column: string; kind: ObjectKind; twin: TwinRule; key?: readonly string[]; }`
- **ROLE_ITEMS** (const) `{ readonly comment: { readonly item: (id: number) => string; readonly touches: (id: number) => string[]; }; readonly reach: { readonly item: (id: number) => string; readonly touches: (id: number) => string[]; }; }`
- **TwinRule** (type) `type TwinRule = "comment" | "reach" | "drop" | "refuse" | "move";`

## packages/core/src/our-posts.ts

- **COMMENT_RULE** (const) `string`
- **OurPost** (interface) `interface OurPost { platform: string; text: string; }`
- **cleanComment** (function) `(text: string): string`
- **ourPostsBlock** (function) `(posts: readonly OurPost[]): string`
- **plainComment** (function) `(ask: (fix: string | null) => Promise<{ text: string; result: T }>, fix: string | null): Promise<{ text: string; result: T }>`
- **postsFor** (function) `(words: string, posts: readonly OurPost[], n = 3): OurPost[]`
- **stockPhrases** (function) `(text: string): string[]`

## packages/core/src/outreach/index.ts

- **AccountHealth** (interface) `interface AccountHealth { handle: string; createdAt: string | null; karma: number | null; suspended: boolean; acceptsMessages: boolean | null; raw: Record<string, unknown>; asOf: string; }`
- **CommentIn** (interface) `interface CommentIn { ref: string; post: string; parent: string; kind: string; channel?: "reach" | "content"; place: string | null; postTitle: string | null; handle: string; text: string; url: string; at: string; raw: Record<string, unknown>; }`
- **Connection** (interface) `interface Connection { handle: string; name: string | null; url: string | null; headline: string | null; connectedOn: Date | null; }`
- **FindQuery** (interface) `interface FindQuery { query: string; limit: number; cursor?: string | null; }`
- **Found** (interface) `interface Found { prospects: Prospect[]; cursor: string | null; fetchedWith: FetchedWith; }`
- **HANDLE_RE** (const) `Record<ReachPlatform, RegExp>`
- **NoInvite** (interface) `interface NoInvite { noInvite: NoInviteReason; at: string; fetchedWith: FetchedWith; }`
- **NoInviteReason** (type) `type NoInviteReason = "connected" | "pending" | "follow-only" | "unknown";`
- **OutreachChannel** (interface) `interface OutreachChannel { readonly platform: ReachPlatform; readonly account: string; find(q: FindQuery): Promise<Found>; enrich(handle: string): Promise<Profile>; relationship?(handle: string): Promise<Relationship>; connect?(handle: string, note: string | null): Promise<Sent | NoInvite>; connections?(max: number): Promise<Connection[]>; withdraw?(handle: string): Promise<{ withdrawn: boolean; relationship: Relationship }>; message(handle: string, text: string, subject?: string | null): Promise<Sent>; replies(since: Date | null): Promise<Reply[]>; comments?(): Promise<CommentIn[]>; comment?(parent: string, text: string): Promise<Sent>; threadAuthors?(post: string): Promise<string[]>; thread?(post: string, focus?: string | null): Promise<ThreadRead>; commentCounts?(posts: readonly string[]): Promise<Record<string, number>>; health(): Promise<AccountHealth>; }`
- **Profile** (interface) `interface Profile extends Prospect { about: string | null; current: string | null; company: string | null; location: string | null; recent: Array<{ at: string; where: string; text: string; url: string | null }>; raw: Record<string, unknown>; fetchedAt: string; fetchedWith: FetchedWith; }`
- **Prospect** (interface) `interface Prospect { handle: string; url: string; name: string | null; headline: string | null; foundIn: string; }`
- **Relationship** (type) `type Relationship = "none" | "pending" | "connected" | "unknown";`
- **Reply** (interface) `interface Reply { ref: string; handle: string; name: string | null; text: string; at: string; threadUrl: string | null; }`
- **Sent** (interface) `interface Sent { ref: string | null; at: string; fetchedWith: FetchedWith; }`
- **ThreadNode** (interface) `interface ThreadNode { ref: string; parent: string; handle: string; text: string; at: string; url: string; }`
- **ThreadRead** (interface) `interface ThreadRead { post: { ref: string; title: string | null; text: string | null; handle: string | null; url: string; place: string | null; media: string | null; at: string | null; count: number | null; }; nodes: ThreadNode[]; more: number; }`
- **fakeOutreachChannel** (function) `(platform: ReachPlatform, o: { account?: string; now?: () => Date; prospects?: Prospect[]; connects?: boolean; } = {}): OutreachChannel & { sent: Array<{ kind: "connect" | "message" | "comment"; handle: string; text: string | null }>; relationships: Map<string, Relationship>; receive(r: Reply): void; inbox: CommentIn[]; threads: Map<string, string[]>; conversations: Map<string, ThreadRead>; reads: string[]; faults: Array<{ err: Error; landed: boolean }>; setHealth(h: Partial<AccountHealth>): void; }`
- **handleOf** (function) `(platform: ReachPlatform, text: string): string`

## packages/core/src/pass-reasons.ts

- **PASS_DAYS** (const) `Readonly<Partial<Record<PassReason, number>>>`
- **PASS_LABELS** (const) `Readonly<Record<PassReason, string>>`
- **PASS_REASONS** (const) `readonly ["not_lead", "not_worth", "spam", "competitor", "rude", "not_now"]`
- **PassReason** (type) `type PassReason = (typeof PASS_REASONS)[number];`

## packages/core/src/people-console-routes.ts

- **PEOPLE_CONSOLE_APPS** (const) `{ readonly "*": "people"; readonly recordsTypes: null; readonly recordsList: null; readonly recordsGet: null; readonly recordsExport: null; readonly recordsStats: null; }`
- **PEOPLE_CONSOLE_ROUTES** (const) `{ readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsGet: "read"; readonly recordsExport: "read"; readonly recordsStats: "read"; readonly segmentContext: "read"; readonly segmentPreview: "read"; readonly segmentText: "read"; readonly segmentVersions: "read"; readonly channe…`
- **PEOPLE_CONSOLE_WRITES** (const) `readonly PeopleConsoleRoute[]`

## packages/core/src/people-console.ts

- **PEOPLE_RECORDS** (const) `RecordType[]`
- **makePeopleConsole** (function) `(deps: PeopleConsoleDeps): restate.ServiceDefinition<"PeopleConsole", { recordsTypes: (_: restate.Context, req: PortalRequest) => Promise<import("./records.js").RecordMeta[]>; recordsList: (_: restate.Context, req: PortalRequest & ListAsk) => Promise<import("./records-serve.js").RecordsPage>; recordsGet: (_: restate.Context, …`
- **peopleConsoleApi** (function) `({ db, open, records = PEOPLE_RECORDS, model, mail = async () => ({ unset: "Email isn't set up here" }), testPhone = null, now = () => new Date(), }: PeopleConsoleDeps): { segmentContext: (req: PortalRequest) => Promise<{ traits: string[]; segments: { id: number; name: string; kind: "manual" | "live" | "snapshot"; }[]; shape: import("./segments.js").JourneyShape; describe: boolean; }>; segmentPreview: (req: PortalRequest & { rule?: unknown; }) => Promise<import("./s…`

## packages/core/src/people-map-pass.ts

- **makePeopleMap** (function) `(d: PeopleMapDeps): restate.VirtualObjectDefinition<"PeopleMap", { wake: (ctx: restate.ObjectContext) => Promise<PeopleMapStats | { error: string; } | { skipped: string; }>; status: (ctx: restate.ObjectSharedContext) => Promise<{ key: string; last: {} | null; }>; }>`
- **makePeopleMapNet** (function) `(d: Pick<PeopleMapDeps, "main" | "clients">): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<{ woken: number; keys: string[]; }>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<{ woken: number; keys: string[]; }>>; start: (ctx: restate.ObjectContex…`
- **peopleMapPass** (function) `(db: Db, o: { site?: SiteCountReader | null } = {}): Promise<PeopleMapStats>`

## packages/core/src/people-map-schema.ts

- **PERSONA_ROLES** (const) `readonly ["owner", "executive", "manager", "staff", "unknown"]`
- **PERSONA_SIZES** (const) `readonly ["solo", "small", "mid", "large", "unknown"]`
- **PersonaRole** (type) `type PersonaRole = (typeof PERSONA_ROLES)[number];`
- **PersonaSize** (type) `type PersonaSize = (typeof PERSONA_SIZES)[number];`
- **ROLLUP_COUNTS** (const) `readonly ["subscribed", "replied", "booked", "form", "visited", "watched", "opened", "clicked", "engaged", "contacted"]`
- **RollupCount** (type) `type RollupCount = (typeof ROLLUP_COUNTS)[number];`
- **WARM_REASONS** (const) `readonly ["subscribed", "replied", "booked", "form", "visited", "watched", "opened", "clicked", "engaged"]`
- **WarmReason** (type) `type WarmReason = (typeof WARM_REASONS)[number];`
- **profileRollups** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "profile_rollups"; schema: undefined; columns: { profileId: import("drizzle-orm/pg-core").PgColumn<{ name: "profile_id"; tableName: "profile_rollups"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; not…`
- **profileSiteReads** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "profile_site_reads"; schema: undefined; columns: { profileId: import("drizzle-orm/pg-core").PgColumn<{ name: "profile_id"; tableName: "profile_site_reads"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | numbe…`
- **STAGES** (const) `readonly ["stranger", "lead", "replied", "booked", "client", "past_client"]`
- **Stage** (type) `type Stage = (typeof STAGES)[number];`

## packages/core/src/people-map.ts

- **PeopleFilter** (interface) `interface PeopleFilter { stage?: Stage; warmth?: "warm" | "cold"; persona?: string; reason?: WarmReason; subscribed?: boolean | string; replied?: boolean; source?: string; sort?: "last" | "warm" | "replied" | "id"; limit?: number; }`
- **PersonaModel** (type) `type PersonaModel = (facts: { title: string | null; company: string | null; headline: string | null; }) => Promise<{ role: PersonaRole | null; niche: string | null; size: PersonaSize | null }>;`
- **REASON_WORDS** (const) `Readonly<Record<WarmReason, string>>`
- **Recipient** (interface) `interface Recipient { personId?: number | null; keys?: readonly ProfileKey[]; }`
- **Rollup** (interface) `interface Rollup { profileId: number; stage: Stage; warmth: "warm" | "cold"; why: WarmReason[]; warmthLine: string | null; warmSince: string | null; counts: Record<RollupCount, { n: number; first: string | null; last: string | null }>; subscriptions: string | null; repliedChannels: string | null; repliedLastChannel: string | null; firstTouch: { at: string; channel: string | null; what: string | null } | null; lastTouch: { at: string; channel: string | null; what: string | null } | null; cameFrom: string | null; persona: string; personaRole: PersonaRole; personaNiche: string; personaSize: PersonaSize; }`
- **STAGE_WORDS** (const) `Readonly<Record<Stage, string>>`
- **SiteCountReader** (type) `type SiteCountReader = (visitors: readonly string[]) => Promise<SiteCounts | null>;`
- **WARM_SEQUENCES** (const) `ReadonlySet<string>`
- **coldOpenerRefusal** (function) `(db: Queryable, who: Recipient): Promise<string | null>`
- **countHits** (function) `(hits: readonly { ts: string | number; page: string }[]): SiteCounts`
- **fillPersonas** (function) `(db: Queryable, model: PersonaModel, o: { limit?: number; dryRun?: boolean } = {}): Promise<{ asked: number; set: number }>`
- **findProfile** (function) `(db: Queryable, who: string): Promise<number | null>`
- **isWatchPage** (function) `(page: string): boolean`
- **keyLooseHandles** (function) `(db: Queryable): Promise<{ seen: number; keyed: number }>`
- **listPeople** (function) `(db: Queryable, f: PeopleFilter = {}): Promise<PersonRow[]>`
- **peopleCounts** (function) `(db: Queryable): Promise<{ stage: Stage; warmth: string; n: number }[]>`
- **personaOf** (function) `(niche: string, role: PersonaRole): string`
- **readSiteCounts** (function) `(db: Queryable, read: SiteCountReader, o: { most?: number; now?: Date } = {}): Promise<number>`
- **refreshPeople** (function) `(db: Queryable, o: { ids?: readonly number[] } = {}): Promise<RefreshCount>`
- **roleOf** (function) `(title: string | null | undefined): PersonaRole`
- **siteCountReader** (function) `(hits: (visitor: string) => Promise<readonly { ts: string | number; page: string }[]>): SiteCountReader`
- **sizeOf** (function) `(n: number | null | undefined): PersonaSize`
- **storedRollup** (function) `(db: Queryable, id: number): Promise<Rollup | null>`
- **warmthOf** (function) `(db: Queryable, ids: readonly number[]): Promise<Rollup[]>`
- **PersonRow** (interface) `interface PersonRow { profileId: number; name: string; stage: Stage; warmth: "warm" | "cold"; warmthLine: string | null; persona: string; personaSize: PersonaSize; cameFrom: string | null; lastTouchAt: string | null; }`

## packages/core/src/people/formats.ts

- **BUILTIN_PERSON_FORMATS** (const) `readonly PersonSourceFormat[]`

## packages/core/src/people/importer.ts

- **PeopleImportStats** (interface) `interface PeopleImportStats { rows: number; people_created: number; people_seen: number; companies_created: number; compliance_flagged: number; company_domain_conflicts: number; errors: number; person_fields: Record<(typeof PERSON_FIELDS)[number], number>; replay_of?: number; }`
- **runPeopleImport** (function) `(db: Queryable, source: PersonSource, opts: { niche?: string | null; onPerson?: (landed: PersonLanded) => Promise<void>; } = {}): Promise<PeopleImportResult>`

## packages/core/src/people/linkedin.ts

- **LINKEDIN_FORMAT** (const) `PersonSourceFormat`
- **linkedinPersonRow** (function) `(row: RawRow, sourceRef: string): PersonItem`

## packages/core/src/people/officers.ts

- **OFFICERS_FORMAT** (const) `PersonSourceFormat`
- **officerPersonRow** (function) `(row: RawRow, sourceRef: string): PersonItem`

## packages/core/src/people/schema.ts

- **ParsedName** (type) `type ParsedName = [full: string, first: string | null, last: string | null];`
- **PersonItem** (type) `type PersonItem = PersonRow | PersonRowError;`
- **PersonRow** (interface) `interface PersonRow { kind: "person"; companySourceKey: string | null; companyDomain: string | null; companyName: string | null; fullName: string; firstName: string | null; lastName: string | null; title: string | null; isCompliance: boolean; isTestimonial: boolean; testimonialOrg: string | null; origin: PersonOrigin; originRef: string; asOf: string | null; sourceKey: string | null; linkedinUrl: string | null; raw: Record<string, unknown>; }`
- **PersonRowError** (interface) `interface PersonRowError { kind: "error"; reason: string; raw: Record<string, unknown> | null; }`
- **PersonRowInput** (type) `type PersonRowInput = Pick<PersonRow, "fullName" | "origin" | "originRef" | "raw"> & Partial<Omit<PersonRow, "kind" | "fullName" | "origin" | "originRef" | "raw">>;`
- **PersonRowInvalid** (class) `override name`
- **matchKey** (function) `(firstName: string | null, lastName: string | null, fullName: string): string`
- **parseDirectName** (function) `(raw: string): ParsedName | null`
- **parseInvertedName** (function) `(raw: string): ParsedName | null`
- **parseName** (function) `(raw: string): ParsedName | null`
- **personRow** (function) `(input: PersonRowInput): PersonRow`
- **personRowError** (function) `(reason: string, raw: Record<string, unknown> | null = null): PersonRowError`
- **smartCase** (function) `(word: string): string`

## packages/core/src/people/sources.ts

- **PersonSource** (interface) `interface PersonSource { sourceType: string; sourceRef: string; contentHash?: string; rows(): Iterable<PersonItem> | AsyncIterable<PersonItem>; }`
- **PersonSourceFormat** (interface) `interface PersonSourceFormat { name: string; help: string; build: (path: string) => PersonSource; niche: string | null; }`

## packages/core/src/portal.ts

- **Me** (interface) `interface Me { clients: { id: string; name: string; demo?: true; look?: unknown; installed: string[]; can: Permission[]; role?: RoleId; flags: Record<string, string>; grants?: Grant[]; }[]; demo: boolean; operator: boolean; team?: { role: RoleId; wren: Permission[]; flags: Record<string, string>; grants?: Grant[] }; as?: { client: string; name: string; who: string; role: RoleId; act: boolean; sandbox: boolean; }; }`
- **PortalRequest** (interface) `interface PortalRequest { viewer: Viewer; client?: string; asClient?: boolean; viewAs?: ViewAs | unknown; }`
- **SignedViewer** (type) `type SignedViewer = Exclude<Viewer, { demo: true }>;`
- **Unnamed** (type) `type Unnamed = "first" | "wren";`
- **Viewer** (type) `type Viewer = | { email: string; operator?: boolean; team?: TeamSeat; access?: Who; cap?: Cap; as?: Viewing } | { demo: true };`
- **accessOf** (function) `(req: PortalRequest): Who`
- **answer** (function) `(fn: () => Promise<T>): Promise<T>`
- **canAt** (function) `(main: Db, req: PortalRequest, p: Permission, at: Target): Promise<boolean>`
- **clientsFor** (function) `(main: Db, viewer: Viewer): Promise<Client[]>`
- **guard** (function) `(main: Db, need: Need, req: R, unnamed: Unnamed, place: Target = {}): Promise<R>`
- **isDemo** (function) `(v: Viewer): v is { demo: true }`
- **lookingOnly** (function) `(req: PortalRequest): boolean`
- **pickClient** (function) `(main: Db, req: PortalRequest): Promise<Client>`
- **pickForWrite** (function) `(main: Db, req: PortalRequest): Promise<{ client: Client; viewer: SignedViewer }>`
- **portalMe** (function) `(main: Db, viewer: Viewer, demoName: string, touch = true): Promise<Me>`
- **portalService** (function) `(o: { name: N; main: Db; routes: R; apps: RouteApps<R>; unnamed: Unnamed; handlers: H; }): restate.ServiceDefinition<N, H>`
- **seesInternal** (function) `(req: PortalRequest): boolean`
- **teamCan** (function) `(req: PortalRequest, p: Permission, at: string | Target): boolean`
- **teamSeat** (function) `(main: Db, email: string): Promise<TeamSeat | null>`
- **viewingAs** (function) `(req: PortalRequest): boolean`
- **whoIs** (function) `(main: Db, viewer: Viewer, client?: string): Promise<Who>`
- **isOperator** (function) `(v: Viewer): boolean`
- **terminalOf** (function) `(err: PortalRefusal): restate.TerminalError`

## packages/core/src/profile-findings.ts

- **PROFILE_RESEARCH** (const) `{ readonly name: "ProfileResearch"; }`
- **ProfileResearchObject** (interface) `interface ProfileResearchObject { run: (ctx: restate.ObjectContext, input: { lookupId: number }) => Promise<unknown>; }`
- **ResearchDetail** (interface) `interface ResearchDetail { run: ResearchRun | null; findings: ResearchFinding[]; }`
- **ResearchFinding** (interface) `interface ResearchFinding { id: string; kind: string; platform: string | null; value: string; url: string | null; source: string; confidence: number; state: string; at: string; }`
- **abandonProfileResearch** (function) `(db: Queryable, lookupId: number, why: string): Promise<void>`
- **decideFindings** (function) `(db: Queryable, ids: readonly number[], decision: FindingDecision, by: string, at: Date = new Date()): Promise<{ done: number[]; keys: number }>`
- **findingRows** (function) `(db: Queryable): Promise<Record<string, unknown>[]>`
- **queueProfileResearch** (function) `(db: Queryable, profileId: number, by: string): Promise<{ lookupId: number; profileId: number }>`
- **researchDetail** (function) `(db: Queryable, profileId: number): Promise<ResearchDetail>`

## packages/core/src/profile-records.ts

- **ProfileDetail** (interface) `interface ProfileDetail { timeline: { kind: string; label: string; count: number; last: string | null; href: string }[]; total: number; lines: ProfileLine[]; href: string; visits: VisitLine[] | null; warmth: WarmthDetail | null; reach: ProfileReach | null; research: ResearchDetail | null; leadFit: LeadFitView | null; failed: string[]; }`
- **VisitLine** (interface) `interface VisitLine { at: string; text: string; href: string | null; }`
- **datumRecord** (function) `(workflows: readonly Workflow[] = []): RecordType`
- **findingRecord** (const) `RecordType`
- **profileRecord** (const) `RecordType`
- **usesOf** (function) `(workflows: readonly Workflow[]): Map<string, string[]>`
- **eventRecord** (const) `RecordType`
- **profileRecords** (function) `(workflows: readonly Workflow[] = [], o: { visits?: VisitReader; research?: boolean } = {}): RecordType[]`

## packages/core/src/profiles-backfill.ts

- **BackfillCount** (interface) `interface BackfillCount { source: ProfileSource; rows: number; created: number; merged: number; skipped: number; }`
- **PROFILE_SOURCES** (const) `readonly ["lead_import", "people_import", "enrollment", "sms_contact", "consent", "social_handle", "crm", "site_form", "site_chat", "booking", "call_booking", "payment"]`
- **ProfileInput** (interface) `interface ProfileInput extends ResolveOptions { keys: ProfileKey[]; }`
- **ProfileSource** (type) `type ProfileSource = (typeof PROFILE_SOURCES)[number];`
- **SOURCES** (const) `Source[]`
- **SeenPage** (interface) `interface SeenPage { path: string; at: number; }`
- **Source** (interface) `interface Source { name: ProfileSource; rows: (db: Queryable, after: string, limit: number) => Promise<Record<string, unknown>[]>; first: string; input: (r: Record<string, unknown>) => ProfileInput; }`
- **backfillClientRows** (function) `(main: Queryable, client: string, workspace: Queryable, o: { dryRun?: boolean; batch?: number } = {}): Promise<ElsewhereCount[]>`
- **backfillProfiles** (function) `(db: Queryable, o: { dryRun?: boolean; only?: readonly string[]; batch?: number; progress?: (c: BackfillCount) => void; } = {}): Promise<BackfillCount[]>`
- **handleOfUrl** (function) `(url: string | null | undefined): ProfileKey | null`
- **noteClientForm** (function) `(db: Queryable, e: ClientForm): Promise<number | null>`
- **noteClientPayLink** (function) `(db: Queryable, l: ClientPayLink): Promise<number | null>`
- **noteContacts** (function) `(db: Queryable, ids: readonly number[]): Promise<void>`
- **noteProfileFrom** (function) `(db: Queryable, source: ProfileSource, input: ProfileInput): Promise<import("./profiles.js").Resolved | null>`
- **profileFrom** (const) `{ lead: (l: { email: string; personId?: number | null | undefined; firstName?: string | null | undefined; lastName?: string | null | undefined; title?: string | null | undefined; company?: string | null | undefined; country?: string | null | undefined; socialUrl?: string | null | undefined; at?: Dat…`

## packages/core/src/profiles-bulk.ts

- **BulkCount** (interface) `interface BulkCount extends BackfillCount { chunks: number; perRow: number; }`
- **bulkBackfillProfiles** (function) `(db: Queryable, o: { dryRun?: boolean; only?: readonly string[]; batch?: number; lockBudget?: number; sources?: readonly Source[]; progress?: (c: BulkCount) => void; } = {}): Promise<BulkCount[]>`

## packages/core/src/profiles-link.ts

- **linkBookers** (function) `(db: Queryable, at = new Date()): Promise<Linked[]>`
- **linkByName** (function) `(db: Queryable, profileId: number, source: string, at = new Date()): Promise<Linked>`
- **nameKey** (function) `(name: string | null | undefined): string | null`

## packages/core/src/profiles-schema.ts

- **PROFILE_FINDING_KINDS** (const) `readonly ["handle", "link", "employer"]`
- **PROFILE_FINDING_STATES** (const) `readonly ["found", "kept", "dropped"]`
- **PROFILE_KEY_KINDS** (const) `readonly ["email", "phone", "visitor", "person"]`
- **PROFILE_LOOKUP_STATES** (const) `readonly ["queued", "running", "done", "failed"]`
- **ProfileFinding** (type) `type ProfileFinding = typeof profileFindings.$inferSelect;`
- **ProfileFindingKind** (type) `type ProfileFindingKind = (typeof PROFILE_FINDING_KINDS)[number];`
- **ProfileFindingState** (type) `type ProfileFindingState = (typeof PROFILE_FINDING_STATES)[number];`
- **ProfileLookupState** (type) `type ProfileLookupState = (typeof PROFILE_LOOKUP_STATES)[number];`
- **TIMELINE_KINDS** (const) `readonly ["email_sent", "email_received", "text_sent", "text_received", "call_in", "voice_call", "call", "touch", "consent", "form", "chat", "booking", "payment", "workflow", "trait", "merge", "journey", "finding"]`
- **TIMELINE_KIND_NAMES** (const) `Readonly<Record<TimelineKind, string>>`
- **TimelineKind** (type) `type TimelineKind = (typeof TIMELINE_KINDS)[number];`
- **profileEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "profile_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "profile_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **profileFindings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "profile_findings"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "profile_findings"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault:…`
- **profileKeyRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"profile_key_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "profile_key_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isP…`
- **profileKeys** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "profile_keys"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "profile_keys"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **profileList** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "profile_list"; schema: undefined; columns: { profileId: import("drizzle-orm/pg-core").PgColumn<{ name: "profile_id"; tableName: "profile_list"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: …`
- **profileLookups** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "profile_lookups"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "profile_lookups"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **profileMergeRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"profile_merge_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "profile_merge_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false;…`
- **profileMerges** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "profile_merges"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "profile_merges"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **profileRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"profile_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "profile_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKe…`
- **profileTimeline** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"profile_timeline", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "profile_timeline"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; …`
- **profileTraitActivity** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"profile_trait_activity", false, { trait: import("drizzle-orm/pg-core").PgColumn<{ name: "trait"; tableName: "profile_trait_activity"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isP…`
- **profileTraitEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "profile_trait_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "profile_trait_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; has…`
- **profileTraitRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"profile_trait_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "profile_trait_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKe…`
- **profileTraits** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "profile_traits"; schema: undefined; columns: { profileId: import("drizzle-orm/pg-core").PgColumn<{ name: "profile_id"; tableName: "profile_traits"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNu…`
- **profiles** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "profiles"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "profiles"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`

## packages/core/src/profiles.ts

- **ElsewhereLine** (interface) `interface ElsewhereLine { kind: string; channel: string; at: Date; summary: string; body?: string | null; link?: string | null; source: string; sourceId: string; }`
- **Key** (interface) `interface Key { kind: string; value: string; }`
- **ProfileKey** (interface) `interface ProfileKey { kind: string; value: string | number | null | undefined; }`
- **ResolveOptions** (interface) `interface ResolveOptions { name?: string | null | undefined; at?: Date | undefined; traits?: Record<string, unknown> | undefined; }`
- **Resolved** (interface) `interface Resolved { id: number; created: boolean; added: number; merged: number[]; }`
- **TRAIT_KEY** (const) `RegExp`
- **emailKey** (function) `(raw: unknown): string | null`
- **keyOf** (function) `(k: ProfileKey): Key | null`
- **keysOf** (function) `(keys: readonly ProfileKey[]): Key[]`
- **keysOfFields** (function) `(fields: Record<string, unknown> | null | undefined, visitor?: string | null): ProfileKey[]`
- **keysOfProfile** (function) `(db: Queryable, ids: readonly number[]): Promise<{ id: number; profileId: number; kind: string; value: string; source: string; firstSeen: Date; }[]>`
- **mergeProfiles** (function) `(db: Queryable, into: number, from: number, by: string, source: string, at = new Date()): Promise<{ keys: number; traits: number }>`
- **nameOf** (function) `(s: string | null | undefined): string | null`
- **nameOfFields** (function) `(fields: Record<string, unknown> | null | undefined): string | null`
- **noteElsewhere** (function) `(db: Queryable, keys: readonly ProfileKey[], source: string, o: ResolveOptions, line: ElsewhereLine): Promise<number | null>`
- **noteProfile** (function) `(db: Queryable, keys: readonly ProfileKey[], source: string, o: ResolveOptions = {}): Promise<Resolved | null>`
- **phoneKey** (function) `(raw: unknown): string | null`
- **profileOf** (function) `(db: Queryable, key: ProfileKey): Promise<number | null>`
- **resolveProfile** (function) `(db: Queryable, keys: readonly ProfileKey[], source: string, o: ResolveOptions = {}): Promise<Resolved | null>`
- **setTraits** (function) `(db: Queryable, profileId: number, traits: Record<string, unknown>, source: string, at = new Date()): Promise<number>`
- **syncTraits** (function) `(db: Queryable, rows: SQL, source: string, defaults: Readonly<Record<string, string>>, at = new Date()): Promise<number>`
- **traitValue** (function) `(v: unknown): string | number | boolean | null`

## packages/core/src/promise.ts

- **hoursSince** (function) `(at: string | Date | null | undefined, now: Date): number | null`
- **lateOf** (function) `(at: string | Date | null | undefined, promise: string | null | undefined, now: Date): boolean`
- **promiseHours** (function) `(p: string): number | null`

## packages/core/src/ramp.ts

- **Ramp** (interface) `interface Ramp { start: number; step: number; everyDays: number; }`
- **rampFor** (function) `(cap: number): Ramp`
- **rampedCap** (function) `(cap: number, days: number, ramp: Ramp = rampFor(cap)): number`

## packages/core/src/record-accounts.ts

- **AccountOption** (interface) `interface AccountOption { key: string; label: string; state: string | null; warn: string | null; }`
- **AccountPick** (interface) `interface AccountPick { platform: string; current: string | null; fallback: string | null; picked: boolean; options: AccountOption[]; }`
- **RecordAccount** (interface) `interface RecordAccount { key: string; platform: string; label: string; }`
- **accountChoices** (function) `(): Record<string, string>`
- **accountLabel** (function) `(platform: string, key: string, handle: string | null): string`
- **accountSource** (function) `(load: Source | null): void`
- **accountsOn** (function) `(platform: string): RecordAccount[]`
- **defaultAccount** (function) `(o: { picked?: string | null; spokeTo?: string | null; assigned?: string | null; }): string | null`
- **recordAccount** (function) `(key: string): RecordAccount | undefined`
- **refreshRecordAccounts** (function) `(db: Queryable, now = Date.now()): Promise<void>`
- **setRecordAccounts** (function) `(rows: readonly RecordAccount[]): void`

## packages/core/src/records-delta.ts

- **KNOWN_MAX** (const) `500`
- **Marked** (interface) `interface Marked<R extends Keyed = Row> { rows: R[]; hashes?: string[]; same?: number[]; }`
- **changedOnly** (function) `(page: P, known: Set<string> | null, markOf: (row: R) => string = rowHash): P & { hashes: string[] }`
- **knownIn** (function) `(known: unknown): Set<string> | null`
- **knownOf** (function) `(before: Marked<Keyed> | undefined): string[]`
- **mergeChanged** (function) `(page: P, before: Marked<R> | undefined): P | null`
- **rowHash** (function) `(row: object): string`
- **versionMark** (function) `(id: string | number, version: number, derived: object = {}): string`

## packages/core/src/records-serve.ts

- **ActivityLine** (interface) `interface ActivityLine { at: string; kind: string | null; what: string; link?: string | null; context?: string | null; }`
- **ExportAsk** (interface) `interface ExportAsk extends Omit<ListAsk, "cursor" | "limit" | "offset"> { format?: ExportFormat; }`
- **ExportFormat** (type) `type ExportFormat = "csv" | "jsonl";`
- **Fence** (type) `type Fence = (t: RecordType) => Reach | null;`
- **GetAsk** (interface) `interface GetAsk { record: string; id: string | number; }`
- **ListAsk** (interface) `interface ListAsk { record: string; view?: string; where?: unknown; sort?: string; group?: string; q?: string; cursor?: string; limit?: number; offset?: number; of?: { record: string; id: string | number }; facets?: boolean; thumbs?: boolean; known?: string[]; }`
- **Mask** (type) `type Mask = <T>(v: T) => T;`
- **Period** (type) `type Period = number | "month";`
- **RecordAnswer** (interface) `interface RecordAnswer { record: string; row: Row; related: { record: string; count: number }[]; activity: ActivityLine[] | null; detail: object | null; edit?: EditState | null; }`
- **RecordsApi** (type) `type RecordsApi = ReturnType<typeof serveRecords>;`
- **RecordsFile** (interface) `interface RecordsFile { record: string; format: ExportFormat; body: string; rows: number; capped: boolean; }`
- **RecordsPage** (interface) `interface RecordsPage { record: string; view: string | null; rows: Row[]; total: number; counts: Record<string, number>; next: string | null; totals: Record<string, Total>; facets?: Record<string, Record<string, number>>; thumbs?: Record<string, Thumb>; hashes?: string[]; same?: number[]; }`
- **RecordsStat** (interface) `interface RecordsStat { record: string; view: string | null; value: number | null; prior: number | null; series: { at: string; value: number | null; by?: Record<string, number> }[]; currency: string | null; latest?: number | null; }`
- **Row** (type) `type Row = { id: string | number } & Record<string, Cell>;`
- **StatsAsk** (interface) `interface StatsAsk extends ExportAsk { at?: string; period?: Period; sum?: string; median?: string; pick?: string; zone?: string; until?: string; by?: string; }`
- **Total** (type) `type Total = | { sum: number; currency: string } | { n: number; of: number } | { newest: string } | { most: string; n: number; of: number };`
- **fenceFor** (function) `(req: PortalRequest, client: string): Fence | undefined`
- **meOf** (function) `(req: PortalRequest): Me | null`
- **opens** (function) `(t: RecordType, r: Reach | null): boolean`
- **searchSql** (function) `(f: Field, q: string): SQL`
- **serveRecords** (function) `(given: readonly RecordType[], db: Queryable, mask?: Mask, fence?: Fence, me: Me | null = null): { types: () => RecordMeta[]; list: (ask: ListAsk) => Promise<RecordsPage>; get: (ask: GetAsk) => Promise<RecordAnswer>; export: (ask: ExportAsk) => Promise<RecordsFile>; stats: (ask: StatsAsk, now?: Date) => Promise<RecordsStat>; }`
- **statWindows** (function) `(period: Period, zone: string, now: Date): { from: Date; priorFrom: Date; priorTo: Date; days: Date[]; }`
- **toCsv** (function) `({ columns, rows }: { columns: string[]; rows: CsvCell[][] }): string`

## packages/core/src/records.ts

- **BadAsk** (class) ``
- **CUSTOM_CURRENCY** (const) `"x__currency"`
- **CUSTOM_RECORDS** (const) `Map<string, { one: string; many: string; }>`
- **Clause** (interface) `interface Clause { field: string; op: Op; value: string | number | boolean | (string | number)[]; }`
- **Column** (interface) `interface Column { align: "start" | "end"; width: "s" | "m" | "l"; max: number; }`
- **DECLARED** (const) `Map<string, { app: string; channel: RecordChannel; }>`
- **EDITABLE** (const) `ReadonlySet<Kind>`
- **Field** (interface) `interface Field { kind: Kind; label: string; from?: string; states?: Readonly<Record<string, State>>; choices?: () => Readonly<Record<string, string>>; platforms?: readonly string[]; domain?: string; currency?: string; of?: string; max?: number; total?: false; words?: Words; grain?: "month"; slots?: Readonly<Record<string, string>>; listed?: false; group?: string; }`
- **FieldMeta** (interface) `interface FieldMeta { key: string; kind: Kind; label: string; states?: Readonly<Record<string, State>>; max?: number; words?: Words; grain?: "month"; slots?: Readonly<Record<string, string>>; ops: readonly Op[]; sortable: boolean; searchable: boolean; column: KindFacts["column"]; group?: string; account?: true; }`
- **Filter** (type) `type Filter = string | number | readonly (string | number)[] | Partial<Record<Op, unknown>>;`
- **FoldMessage** (interface) `interface FoldMessage { id: string; text: string; at: string; state: string; open: boolean; }`
- **Kind** (type) `type Kind = keyof typeof KINDS;`
- **MARKS** (const) `readonly ["youtube", "linkedin", "instagram", "threads", "x", "tiktok", "reddit", "facebook", "meta", "discord", "google", "whatsapp", "podcast", "email", "text", "call", "dm", "web"]`
- **Mark** (type) `type Mark = (typeof MARKS)[number];`
- **Op** (type) `type Op = "eq" | "in" | "contains" | "gte" | "lte" | "empty";`
- **RecordEdits** (interface) `interface RecordEdits { fields: readonly string[]; patch: ZodType<Values>; check?: ( patch: Values, now: Values, db: Queryable, id: string, ) => Promise<string | null> | string | null; read: (db: Queryable, id: string) => Promise<Values | null>; write: (db: Queryable, id: string, patch: Values, by: string) => Promise<void>; context?: (db: Queryable, id: string) => Promise<string | null>; about?: string; needs?: "run" | "manage"; }`
- **RecordFold** (interface) `interface RecordFold { by: (row: Readonly<Record<string, unknown>>) => string | null; at: string; open: (row: Readonly<Record<string, unknown>>) => boolean; text: string; state: string; due?: string; into: string; }`
- **RecordMeta** (interface) `interface RecordMeta { id: string; name: { one: string; many: string }; title: string; subtitle: string | null; fields: FieldMeta[]; views: readonly SavedView[]; related: readonly { record: string }[]; actions: readonly string[]; activity: boolean; activityLabel?: string; activityEmpty?: string; activityLinks?: boolean; detail: boolean; drafts?: boolean; thumbs?: boolean; edits?: readonly string[] | null; editNeeds?: "manage"; quick?: readonly string[]; by?: string; account?: string; fold?: string; app: string; channel: RecordChannel; }`
- **RecordType** (type) `type RecordType = Omit<RecordDecl<Record<string, Draft>>, "fields"> & { fields: Readonly<Record<string, Field>>; };`
- **SYSTEM** (const) `"System"`
- **State** (interface) `interface State { label: string; tone: Tone; mark?: Mark; tint?: number; line?: number; about?: string; }`
- **Thumb** (interface) `interface Thumb { url: string; kind: "image" | "video"; }`
- **VERDICTS** (const) `Readonly<Record<string, State>>`
- **Values** (type) `type Values = Record<string, unknown>;`
- **Where** (type) `type Where = Readonly<Record<string, Filter>>;`
- **accountField** (function) `(label = "Account", opts: Opts = {}): Draft`
- **actor** (const) `(label?: string, opts?: Opts) => Draft`
- **allowed** (function) `(f: Field, demo: boolean): { ops: readonly Op[]; sortable: boolean; searchable: boolean; }`
- **choice** (function) `(choices: () => Readonly<Record<string, string>>, label?: string, opts: Opts = {}): Draft`
- **cited** (const) `(label?: string, opts?: Opts) => Draft`
- **clausesOf** (function) `(type: RecordType, where: unknown): Clause[]`
- **company** (const) `(label?: string, opts?: Opts) => Draft`
- **csvRow** (function) `(type: RecordType, row: Record<string, Cell>): (string | number | null)[]`
- **cued** (function) `(states: Readonly<Record<K, State>>, marks?: Readonly<Partial<Record<K, Mark>>>): Record<K, State>`
- **customColumn** (function) `(key: string): string`
- **date** (const) `(label?: string, opts?: Opts) => Draft`
- **defineRecord** (function) `(decl: RecordDecl<F>): RecordType`
- **duration** (const) `(label?: string, opts?: Opts) => Draft`
- **foldRows** (function) `(rows: readonly R[], fold: RecordFold, key: string): R[]`
- **link** (const) `(label?: string, opts?: Opts) => Draft`
- **markOf** (function) `(key: string): Mark | undefined`
- **markOfHost** (function) `(site: string): Mark | undefined`
- **modelName** (function) `(label?: string, opts: Opts = {}): Draft`
- **money** (function) `(label?: string, opts: Opts = {}): Draft`
- **name** (const) `(label?: string, opts?: Opts) => Draft`
- **named** (function) `(label?: string, opts: Opts = {}): Draft`
- **number** (const) `(label?: string, opts?: Opts) => Draft`
- **percent** (const) `(label?: string, opts?: Opts) => Draft`
- **prose** (const) `(label?: string, opts?: Opts) => Draft`
- **rate** (function) `(of: string, label?: string, opts: Opts = {}): Draft`
- **score** (function) `(label?: string, opts: Opts = {}): Draft`
- **sortOf** (function) `(type: RecordType, sort: unknown): { field: string; desc: boolean }`
- **status** (function) `(states: Record<string, State>, label?: string, opts: Opts = {}): Draft`
- **tags** (function) `(states: Record<string, State>, label?: string, opts: Opts = {}): Draft`
- **text** (const) `(label?: string, opts?: Opts) => Draft`
- **tintOf** (function) `(key: string): number`
- **withEdits** (function) `(type: RecordType, edits: RecordEdits): RecordType`
- **Cell** (type) `type Cell = | string | number | null | { name: string; domain: string | null } | { amount: number; currency: string } | { n: number; of: number };`
- **KINDS** (const) `{ readonly text: { readonly sql: "text"; readonly ops: readonly ["eq", "in", "contains", "empty"]; readonly sortable: true; readonly searchable: true; readonly masked: false; readonly column: { readonly align: "start"; readonly width: "m"; readonly max: 280; }; readonly csv: (c: Cell, f: Field) => s…`
- **Me** (interface) `interface Me { email: string; team: boolean; }`
- **SavedView** (interface) `interface SavedView { id: string; label: string; where?: Where; sort?: string; at?: string; hint?: string; mine?: string; }`
- **Tone** (type) `type Tone = "good" | "warn" | "bad" | "neutral";`
- **metaOf** (function) `(type: RecordType, demo: boolean): RecordMeta`
- **verdict** (function) `(label?: string, opts: Opts = {}): Draft`

## packages/core/src/refusal.ts

- **PortalRefusal** (class) `constructor(message: string, readonly status: RefusalStatus = 400, readonly field?: string, readonly code?: "conflict")`
- **RefusalStatus** (type) `type RefusalStatus = 400 | 403 | 404 | 409 | 410 | 422 | 429 | 503;`
- **setUp** (function) `(v: T | null | undefined, what: string): asserts v is T`
- **staleRefusal** (function) `(what: string, field?: string): PortalRefusal`

## packages/core/src/reject-reasons.ts

- **REJECT_LABELS** (const) `Readonly<Record<RejectReason, string>>`
- **REJECT_NOTE_MAX** (const) `280`
- **REJECT_REASONS** (const) `readonly ["voice", "facts", "length", "salesy", "topic", "timing", "repeat"]`
- **RejectReason** (type) `type RejectReason = (typeof REJECT_REASONS)[number];`

## packages/core/src/reply-drafts.ts

- **REPLY_DRAFTS_COMPONENT** (const) `"drafts.replies"`
- **modelDrafts** (function) `(db: Queryable): Promise<boolean>`

## packages/core/src/reply-who.ts

- **replyWho** (function) `(db: Queryable, channel: Channel, id: number): Promise<ReplyWho>`

## packages/core/src/restate/form.ts

- **Form** (interface) `interface Form { input?: z.ZodType; effect?: Effect; ingressPrivate?: true; }`
- **NO_INPUT** (const) `z.ZodPreprocess<z.ZodOptional<z.ZodObject<{}, z.core.$loose>>, unknown>`
- **PORTAL_FIELDS** (const) `{ viewer: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>; client: z.ZodOptional<z.ZodString>; asClient: z.ZodOptional<z.ZodBoolean>; }`
- **exclusiveHandler** (const) `<F>(form: Form, fn: F) => F`
- **formOptions** (function) `(form: Form): { ingressPrivate?: boolean; metadata?: { effect: Effect; }; input?: restate.Serde<unknown>; accept?: string; }`
- **handlerForm** (function) `(handler: unknown): Form | undefined`
- **serviceHandler** (const) `<F>(form: Form, fn: F) => F`
- **sharedHandler** (const) `<F>(form: Form, fn: F) => F`
- **Effect** (type) `type Effect = "spends" | "sends" | "posts";`

## packages/core/src/restate/ingress.ts

- **Ingress** (interface) `interface Ingress { url: string; headers?: Record<string, string>; }`
- **ingressSend** (function) `(ingress: Ingress, to: { service: string; key?: string; handler: string }, idempotencyKey: string, body: unknown = null, delayMs = 0): Promise<void>`

## packages/core/src/restate/keys.ts

- **clientKey** (function) `(client: string, unit: string): string`
- **clientOfKey** (function) `(key: string): { client: string; unit: string } | null`
- **unitOfKey** (function) `(key: string): string`

## packages/core/src/restate/limits.ts

- **CallTimeout** (class) `override name; constructor(readonly call: string, readonly ms: number, note?: string)`
- **LIMITS** (const) `{ readonly read: number; readonly batch: number; readonly publish: number; readonly desk: number; readonly quick: number; readonly http: number; }`
- **Limits** (type) `type Limits = { [K in keyof typeof LIMITS]: number };`
- **TimedOut** (interface) `interface TimedOut { call: string; unit: string | null; ms: number; held?: boolean; }`
- **UnitLimits** (interface) `interface UnitLimits { stage: string; skip(unit: string, group?: string): boolean; within<T>(unit: string, p: Waitable<T>, o: UnitWithinOpts): Promise<T>; guard<T>(unit: string, fn: () => Promise<T>, group?: string): Promise<T>; }`
- **answers** (function) `(ctx: restate.Context, p: Waitable<unknown>, call: string): Promise<boolean>`
- **limitStage** (function) `(service: string, key: string): string`
- **limitedRun** (function) `(ctx: restate.Context, name: string, fn: (signal: AbortSignal) => Promise<T>, o: LimitedRunOpts): Promise<T>`
- **limitsWith** (function) `(over?: Partial<Limits>): Limits`
- **timeoutsOf** (function) `(ctx: object): TimedOut[]`
- **unitLimits** (function) `(ctx: restate.ObjectContext, db: Queryable, service: string): Promise<UnitLimits>`
- **within** (function) `(ctx: restate.Context, p: Waitable<T>, o: WithinOpts): Promise<T>`

## packages/core/src/restate/loop.ts

- **LOOP** (const) `"loop"`
- **LoopStatus** (interface) `interface LoopStatus<S> { key: string; running: boolean; last: PassOutcome<S> | null; settings: Record<string, unknown> | null; }`
- **MIN_DELAY_MS** (const) `1000`
- **PassOutcome** (interface) `interface PassOutcome<S> { stats: S | null; error: string | null; failures: number; delayMs: number; now: string; stopped?: string; paused?: string; timeouts?: TimedOut[]; }`
- **failsThePass** (function) `(err: unknown): boolean`
- **failuresInARow** (function) `(ctx: restate.ObjectContext, failed: boolean): Promise<number>`
- **formatDelay** (function) `(ms: number): string`
- **lastPass** (function) `(ctx: AnyObjectContext): Promise<L | null>`
- **loopSettings** (function) `(ctx: restate.ObjectContext | restate.ObjectSharedContext): Promise<T | null>`
- **loopState** (function) `(ctx: AnyObjectContext): Promise<LoopState<L>>`
- **makeLoopObject** (function) `(name: string, pass: (ctx: restate.ObjectContext) => Promise<PassOutcome<S>>, hooks: LoopHooks<A, X> = {}): restate.VirtualObjectDefinition<string, X & Record<A, (ctx: restate.ObjectContext) => Promise<PassOutcome<S>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<S>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) => Promise<LoopStatus<S>>; wake: (ctx: rest…`
- **notifyErrorEdges** (function) `(ctx: restate.ObjectContext, notifier: Notifier, stage: string, previous: PassOutcome<S> | null, outcome: PassOutcome<S>): Promise<void>`
- **pausedPass** (function) `(ctx: restate.ObjectContext, now: Date, why: string, delayMs: number): Promise<PassOutcome<S>>`
- **retryDelayMs** (function) `(failures: number, capMs: number): number`
- **runPass** (function) `(ctx: restate.ObjectContext, db: Db, now: Date, spec: PassSpec<S>): Promise<PassOutcome<S>>`
- **setLastPass** (function) `(ctx: restate.ObjectContext, outcome: L): Promise<void>`
- **stoppedPass** (function) `(ctx: restate.ObjectContext, now: Date, why: string): Promise<PassOutcome<S>>`
- **writeLoop** (function) `(ctx: restate.ObjectContext, patch: Partial<LoopState<L>>): Promise<LoopState<L>>`
- **errorText** (function) `(err: unknown): string`

## packages/core/src/retention.ts

- **RUNS_RETENTION_DAYS** (const) `30`
- **pruneRuns** (function) `(db: Queryable, now: Date): Promise<number>`

## packages/core/src/runs.ts

- **RunOptions** (interface) `interface RunOptions { command: string; argv: Record<string, unknown>; niche?: string | null; model?: string | null; }`
- **finishRun** (function) `(db: Queryable, runId: string, stats: object | null): Promise<void>`
- **openRun** (function) `(db: Queryable, opts: RunOptions): Promise<Run>`
- **recordedRun** (function) `(db: Queryable, opts: RunOptions, body: (run: Run) => Promise<T>): Promise<{ run: Run; stats: T }>`

## packages/core/src/saved-views.ts

- **SaveView** (interface) `interface SaveView { id?: number | undefined; record: string; name?: string | undefined; params?: string | undefined; shared?: boolean | undefined; }`
- **SavedViewLine** (interface) `interface SavedViewLine { id: number; name: string; params: string; shared: boolean; mine: boolean; }`
- **moveViews** (function) `(db: Queryable, s: Scope, record: string, ids: number[]): Promise<SavedViewLine[]>`
- **prefsOf** (function) `(db: Queryable, { workspace, viewer }: Scope, keys?: string[]): Promise<Record<string, unknown>>`
- **removeView** (function) `(db: Queryable, s: Scope, id: number, share: boolean): Promise<void>`
- **saveView** (function) `(db: Queryable, s: Scope, v: SaveView, share: boolean): Promise<SavedViewLine>`
- **savedViewsOf** (function) `(db: Queryable, { workspace, viewer }: Scope, record: string): Promise<SavedViewLine[]>`
- **setPref** (function) `(db: Queryable, s: Scope, key: string, value: unknown): Promise<void>`
- **Scope** (interface) `interface Scope { workspace: string; viewer: string; }`

## packages/core/src/schema.ts

- **CHANGE_VIAS** (const) `readonly ["person", "claude"]`
- **CONSENT_EVENTS** (const) `readonly ["pending", "confirmed", "withdrawn", "frequency", "paused", "sent"]`
- **CONSENT_SOURCES** (const) `readonly ["lander_form", "meta_lead_form", "sms_keyword", "calcom_booking", "preference_center"]`
- **CONSENT_STATES** (const) `readonly ["pending", "confirmed", "withdrawn"]`
- **Change** (type) `type Change = typeof changes.$inferSelect;`
- **ChangeVia** (type) `type ChangeVia = (typeof CHANGE_VIAS)[number];`
- **Company** (type) `type Company = typeof companies.$inferSelect;`
- **Consent** (type) `type Consent = typeof consents.$inferSelect;`
- **ConsentEvent** (type) `type ConsentEvent = typeof consentEvents.$inferSelect;`
- **ConsentEventKind** (type) `type ConsentEventKind = (typeof CONSENT_EVENTS)[number];`
- **ConsentSource** (type) `type ConsentSource = (typeof CONSENT_SOURCES)[number];`
- **ConsentState** (type) `type ConsentState = (typeof CONSENT_STATES)[number];`
- **DELIVERY_STATES** (const) `readonly ["pending", "delivered", "failed"]`
- **DRAFT_EVENTS** (const) `readonly ["generated", "edited", "approved", "rejected", "scheduled", "sent", "failed"]`
- **DRAFT_RECORD_KINDS** (const) `readonly ["post", "comment", "thread", "dm", "invite", "video", "invite_note", "post_comment"]`
- **DRAFT_VIAS** (const) `readonly ["model", "person", "claude", "wren"]`
- **DeliveryState** (type) `type DeliveryState = (typeof DELIVERY_STATES)[number];`
- **DraftEvent** (type) `type DraftEvent = (typeof DRAFT_EVENTS)[number];`
- **DraftEventRow** (type) `type DraftEventRow = typeof draftEvents.$inferSelect;`
- **DraftRecordKind** (type) `type DraftRecordKind = (typeof DRAFT_RECORD_KINDS)[number];`
- **DraftVia** (type) `type DraftVia = (typeof DRAFT_VIAS)[number];`
- **ExecutorRow** (type) `type ExecutorRow = typeof events.$inferSelect;`
- **FREQUENCIES** (const) `readonly ["as_sent", "weekly", "monthly"]`
- **Flag** (type) `type Flag = typeof flags.$inferSelect;`
- **FlagDay** (type) `type FlagDay = typeof flagDays.$inferSelect;`
- **FlagExperiment** (type) `type FlagExperiment = typeof flagExperiments.$inferSelect;`
- **Frequency** (type) `type Frequency = (typeof FREQUENCIES)[number];`
- **Hook** (type) `type Hook = typeof hooks.$inferSelect;`
- **IMPORT_ERROR_KINDS** (const) `readonly ["rejected", "domain_conflict", "domain_changed"]`
- **INSTALL_STATES** (const) `readonly ["draft", "waiting", "live", "off"]`
- **ImportBatch** (type) `type ImportBatch = typeof imports.$inferSelect;`
- **ImportError** (type) `type ImportError = typeof importErrors.$inferSelect;`
- **ImportErrorKind** (type) `type ImportErrorKind = (typeof IMPORT_ERROR_KINDS)[number];`
- **InstallApplied** (interface) `interface InstallApplied { added: string[]; blocks: Record<string, Record<string, unknown>>; copy: string[]; name?: string; kept?: Record<string, Record<string, unknown>>; }`
- **InstallState** (type) `type InstallState = (typeof INSTALL_STATES)[number];`
- **LEAD_STATUSES** (const) `readonly ["imported", "verified", "suppressed", "undeliverable"]`
- **Lead** (type) `type Lead = typeof leads.$inferSelect;`
- **LeadStatus** (type) `type LeadStatus = (typeof LEAD_STATUSES)[number];`
- **MARKETING_CHANNELS** (const) `readonly ["email", "sms"]`
- **MarketingChannel** (type) `type MarketingChannel = (typeof MARKETING_CHANNELS)[number];`
- **NewCompany** (type) `type NewCompany = typeof companies.$inferInsert;`
- **NewLead** (type) `type NewLead = typeof leads.$inferInsert;`
- **NewTemplateVersion** (type) `type NewTemplateVersion = typeof templateVersions.$inferInsert;`
- **PERSON_ORIGINS** (const) `readonly ["registry", "website", "document", "manual", "linkedin", "crm"]`
- **Person** (type) `type Person = typeof people.$inferSelect;`
- **PersonOrigin** (type) `type PersonOrigin = (typeof PERSON_ORIGINS)[number];`
- **RUN_EVENT_KINDS** (const) `readonly ["started", "did", "found", "waiting", "failed", "done"]`
- **Run** (type) `type Run = typeof runs.$inferSelect;`
- **RunEvent** (type) `type RunEvent = typeof runEvents.$inferSelect;`
- **RunEventKind** (type) `type RunEventKind = (typeof RUN_EVENT_KINDS)[number];`
- **SEND_CHANNELS** (const) `readonly ["email", "sms", "dm"]`
- **SUPPRESSION_KINDS** (const) `readonly ["email", "domain", "phone"]`
- **SUPPRESSION_REASONS** (const) `readonly ["opt_out", "bounce", "complaint", "manual", "lifted"]`
- **SavedView** (type) `type SavedView = typeof savedViews.$inferSelect;`
- **SendChannel** (type) `type SendChannel = (typeof SEND_CHANNELS)[number];`
- **SentEvent** (interface) `interface SentEvent { port: string; subject: string; kind: string; data: Record<string, unknown>; }`
- **Sighting** (type) `type Sighting = typeof sightings.$inferSelect;`
- **Snippet** (type) `type Snippet = typeof snippets.$inferSelect;`
- **Suppression** (type) `type Suppression = typeof suppressions.$inferSelect;`
- **SuppressionEvent** (type) `type SuppressionEvent = typeof suppressionEvents.$inferSelect;`
- **SuppressionKind** (type) `type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];`
- **SuppressionReason** (type) `type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];`
- **Survey** (type) `type Survey = typeof surveys.$inferSelect;`
- **SurveyAnswer** (type) `type SurveyAnswer = typeof surveyAnswers.$inferSelect;`
- **TEMPLATE_KIND_VALUES** (const) `readonly ["email", "sms", "dm", "post", "prompt"]`
- **TEMPLATE_ORIGINS** (const) `readonly ["default", "edit", "restore", "ai", "import"]`
- **TemplateOrigin** (type) `type TemplateOrigin = (typeof TEMPLATE_ORIGINS)[number];`
- **TemplateRow** (type) `type TemplateRow = typeof templates.$inferSelect;`
- **TemplateVersion** (type) `type TemplateVersion = typeof templateVersions.$inferSelect;`
- **Topic** (type) `type Topic = typeof topics.$inferSelect;`
- **UnitHold** (type) `type UnitHold = typeof unitHolds.$inferSelect;`
- **WebhookAttempt** (type) `type WebhookAttempt = typeof webhookAttempts.$inferSelect;`
- **WebhookDelivery** (type) `type WebhookDelivery = typeof webhookDeliveries.$inferSelect;`
- **WebhookSubscription** (type) `type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;`
- **WorkflowInstall** (type) `type WorkflowInstall = typeof workflowInstalls.$inferSelect;`
- **WorkflowTemplateRow** (type) `type WorkflowTemplateRow = typeof workflowTemplates.$inferSelect;`
- **changes** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "changes"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "changes"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKe…`
- **checkOutcomes** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "check_outcomes"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "check_outcomes"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **checkRates** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"check_rates", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "check_rates"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincr…`
- **companies** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "companies"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "companies"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrima…`
- **consentEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "consent_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "consent_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **consents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "consents"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "consents"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`
- **draftEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "draft_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "draft_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **events** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "events"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: f…`
- **executions** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"executions", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "executions"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrem…`
- **executorEvents** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"executor_events", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "executor_events"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; is…`
- **flagDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "flag_days"; schema: undefined; columns: { flag: import("drizzle-orm/pg-core").PgColumn<{ name: "flag"; tableName: "flag_days"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false; i…`
- **flagExperiments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "flag_experiments"; schema: undefined; columns: { flag: import("drizzle-orm/pg-core").PgColumn<{ name: "flag"; tableName: "flag_experiments"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDef…`
- **flags** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "flags"; schema: undefined; columns: { key: import("drizzle-orm/pg-core").PgColumn<{ name: "key"; tableName: "flags"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKe…`
- **hooks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "hooks"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "hooks"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: fal…`
- **importErrors** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "import_errors"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "import_errors"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **imports** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "imports"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "imports"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKe…`
- **leads** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "leads"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "leads"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: f…`
- **marketingSends** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "marketing_sends"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_sends"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **messageSettings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "message_settings"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "message_settings"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; h…`
- **people** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "people"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "people"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey:…`
- **runEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "run_events"; schema: undefined; columns: { seq: import("drizzle-orm/pg-core").PgColumn<{ name: "seq"; tableName: "run_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **runs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "runs"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "runs"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: fals…`
- **savedViews** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "saved_views"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "saved_views"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **sightings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sightings"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sightings"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrima…`
- **snippets** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "snippets"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "snippets"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`
- **suppressionEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "suppression_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "suppression_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefa…`
- **suppressions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "suppressions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "suppressions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **surveyAnswers** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "survey_answers"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "survey_answers"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **surveyDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "survey_days"; schema: undefined; columns: { survey: import("drizzle-orm/pg-core").PgColumn<{ name: "survey"; tableName: "survey_days"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: …`
- **surveys** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "surveys"; schema: undefined; columns: { key: import("drizzle-orm/pg-core").PgColumn<{ name: "key"; tableName: "surveys"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrima…`
- **templateVersions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "template_versions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "template_versions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefaul…`
- **templates** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "templates"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "templates"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrima…`
- **topics** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "topics"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "topics"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey:…`
- **unitHolds** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "unit_holds"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "unit_holds"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPri…`
- **unitHoldsNow** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"unit_holds_now", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "unit_holds_now"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey:…`
- **viewerPrefs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "viewer_prefs"; schema: undefined; columns: { workspace: import("drizzle-orm/pg-core").PgColumn<{ name: "workspace"; tableName: "viewer_prefs"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasD…`
- **webhookAttempts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "webhook_attempts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "webhook_attempts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault:…`
- **webhookDeliveries** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "webhook_deliveries"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "webhook_deliveries"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefaul…`
- **webhookSubscriptions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "webhook_subscriptions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "webhook_subscriptions"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; has…`
- **workflowInstalls** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "workflow_installs"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "workflow_installs"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefaul…`
- **workflowSaves** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "workflow_saves"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "workflow_saves"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **workflowTemplates** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "workflow_templates"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "workflow_templates"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDef…`

## packages/core/src/segment-records.ts

- **SEGMENT_RECORDS** (const) `import("./records.js").RecordType[]`
- **SegmentDetail** (interface) `interface SegmentDetail { rule: Rule | null; ruleWords: string | null; moves: { entered7: number; left7: number; entered30: number; left30: number }; version: string; }`
- **segmentDetail** (function) `(db: Queryable, id: string): Promise<SegmentDetail | null>`

## packages/core/src/segment-step.ts

- **profileOfEvent** (function) `(db: Queryable, e: ExecutorEvent): Promise<number | null>`
- **segmentStep** (function) `(main: Queryable, open: (client: string) => Queryable): Step`
- **segmentWould** (function) `(w: StepAt["with"], e: ExecutorEvent): string`

## packages/core/src/segments-pass.ts

- **dueOn** (function) `(db: Queryable, d: { key: string; offset: number; every: DateEvery }, day: string): Promise<{ profile: number; date: string }[]>`
- **heard** (function) `(flows: readonly Workflow[]): { segments: Set<number>; traits: Set<string>; dates: { key: string; offset: number; every: DateEvery; }[]; }`
- **makeSegments** (function) `(d: SegmentsDeps): restate.VirtualObjectDefinition<"Segments", { wake: (ctx: restate.ObjectContext) => Promise<{ recomputed: number; entered: number; left: number; archived: number[]; told: number; more: boolean; cursor: SegmentCursor; } | { skipped: string; error?: never; } | { error: string; skipped?: never; }>; sta…`
- **makeSegmentsNet** (function) `(d: Pick<SegmentsDeps, "main" | "clients">): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<SegmentsNetStats & { keys: string[]; }>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<SegmentsNetStats & { keys: string[]; }>>; start: (ctx: restate.Obje…`
- **segmentsPass** (function) `(db: Db, client: string | null, flows: readonly Workflow[], now: Date, from: SegmentCursor | null): Promise<SegmentsPassStats>`
- **workflowUses** (function) `(flows: readonly Workflow[]): Map<number, SegmentUse[]>`

## packages/core/src/segments-schema.ts

- **SEGMENT_KINDS** (const) `readonly ["live", "manual", "snapshot"]`
- **SEGMENT_STATES** (const) `readonly ["active", "archived"]`
- **SegmentKind** (type) `type SegmentKind = (typeof SEGMENT_KINDS)[number];`
- **SegmentState** (type) `type SegmentState = (typeof SEGMENT_STATES)[number];`
- **SegmentUse** (interface) `interface SegmentUse { kind: "workflow" | "segment" | "broadcast"; id: string; name: string; }`
- **segmentMemberEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "segment_member_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "segment_member_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; h…`
- **segmentMemberRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"segment_member_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "segment_member_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimary…`
- **segmentRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"segment_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "segment_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKe…`
- **segments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "segments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "segments"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`
- **segmentMembers** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "segment_members"; schema: undefined; columns: { segmentId: import("drizzle-orm/pg-core").PgColumn<{ name: "segment_id"; tableName: "segment_members"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; not…`
- **segmentVersions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "segment_versions"; schema: undefined; columns: { segmentId: import("drizzle-orm/pg-core").PgColumn<{ name: "segment_id"; tableName: "segment_versions"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; n…`

## packages/core/src/segments-text.ts

- **parseRule** (function) `(src: string, names: ReadonlyMap<string, number> = new Map()): { rule: Rule } | { problems: string[] }`
- **ruleText** (function) `(rule: Rule, names: ReadonlyMap<number, string> = new Map()): string`

## packages/core/src/segments.ts

- **Anchor** (type) `type Anchor = z.infer<typeof anchorSchema>;`
- **CONSENT_CHANNELS** (const) `readonly ["email", "sms"]`
- **CONSENT_CONDITION_STATES** (const) `readonly ["confirmed", "pending", "withdrawn", "opted_out"]`
- **Condition** (type) `type Condition = | TraitCondition | EventCondition | ConsentCondition | MessageCondition | StepCondition | JourneyCondition | SegmentCondition;`
- **DescribeContext** (interface) `interface DescribeContext { traits: readonly string[]; segments: readonly { id: number; name: string }[]; shape?: JourneyShape; today: string; }`
- **Described** (type) `type Described = | { rule: Rule; name: string; words: string; unknownTraits: string[] } | { error: string };`
- **Group** (interface) `interface Group { kind: "group"; match: "all" | "any"; of: Node[]; not?: boolean | undefined; }`
- **JOURNEY_KEY** (const) `RegExp`
- **JOURNEY_STATUS_NAMES** (const) `readonly ["open", "done", "dropped"]`
- **JourneyCondition** (type) `type JourneyCondition = z.infer<typeof journeyCondition>;`
- **JourneyShape** (interface) `interface JourneyShape { nodes: { id: string; name: string; kind: string; depth: number }[]; sources: string[]; }`
- **MESSAGE_CHANNELS** (const) `readonly ["any", "email", "sms", "linkedin", "reddit", "x", "instagram", "youtube", "tiktok", "facebook"]`
- **MESSAGE_STATES** (const) `{ readonly sent: readonly ["sent", "delivered", "opened", "clicked", "replied"]; readonly delivered: readonly ["delivered", "opened", "clicked", "replied"]; readonly opened: readonly ["opened", "clicked", "replied"]; readonly clicked: readonly ["clicked", "replied"]; readonly replied: readonly ["rep…`
- **MembershipChange** (interface) `interface MembershipChange { segment: number; entered: number[]; left: number[]; size: number; }`
- **MessageState** (type) `type MessageState = keyof typeof MESSAGE_STATES;`
- **Node** (type) `type Node = Condition | Group;`
- **Preview** (interface) `interface Preview { size: number; sample: { id: number; name: string }[]; words: string; }`
- **RULE_MOST** (const) `{ readonly conditions: 30; readonly depth: 4; }`
- **Rule** (type) `type Rule = Group;`
- **Segment** (interface) `interface Segment { id: number; name: string; kind: SegmentKind; rule: Rule | null; words: string | null; state: SegmentState; size: number; computedAt: string | null; uses: SegmentUse[]; usedAt: string; archivedAt: string | null; by: string; createdAt: string; updatedAt: string; version: number; }`
- **SegmentInput** (interface) `interface SegmentInput { id?: number | null; name: string; kind: SegmentKind; rule?: unknown; words?: string | null; expect?: string | null; }`
- **SegmentModel** (interface) `interface SegmentModel { complete( prompt: string, opts?: { maxTokens?: number; system?: string }, ): Promise<{ text: string }>; }`
- **SegmentVersion** (interface) `interface SegmentVersion { version: number; name: string; kind: SegmentKind; rule: Rule | null; words: string | null; by: string; at: string; }`
- **TRAIT_OPS** (const) `{ readonly is: "is"; readonly contains: "contains"; readonly gt: "is more than"; readonly lt: "is less than"; readonly exists: "is set"; readonly before: "is before"; readonly after: "is after"; readonly in_next: "falls in the next (days)"; readonly in_last: "fell in the last (days)"; readonly one_o…`
- **addMembers** (function) `(db: Queryable, id: number, profileIds: readonly number[], now: Date): Promise<MembershipChange>`
- **addToGroup** (function) `(db: Queryable, said: string | number | null | undefined, profileIds: readonly number[], by: string, now: Date): Promise<{ group: Segment; made: boolean; change: MembershipChange }>`
- **archiveSegment** (function) `(db: Queryable, id: number, now: Date): Promise<Segment>`
- **archiveUnused** (function) `(db: Queryable, now: Date): Promise<number[]>`
- **compileRule** (function) `(n: Node, now: Date): SQL`
- **conditionsOf** (function) `(rule: Rule): Condition[]`
- **dataOf** (function) `(c: Condition): string[]`
- **dayOf** (function) `(now: Date): string`
- **describePrompt** (function) `(words: string, c: DescribeContext): string`
- **describeSegment** (function) `(model: SegmentModel, words: string, c: DescribeContext): Promise<Described>`
- **inSegment** (function) `(db: Queryable, profileId: number, of: number | Segment | Rule, now: Date): Promise<boolean>`
- **journeyShape** (function) `(db: Queryable): Promise<JourneyShape>`
- **jsonIn** (function) `(text: string): unknown`
- **listOf** (function) `(v: unknown): string[]`
- **listSegments** (function) `(db: Queryable, state?: SegmentState): Promise<Segment[]>`
- **markUsed** (function) `(db: Queryable, ids: readonly number[], now: Date): Promise<void>`
- **matchingSql** (function) `(rule: Rule, now: Date): SQL`
- **pickGroup** (function) `(groups: readonly Pick<Segment, "id" | "name" | "kind">[], said: string | number | null | undefined): { group: Pick<Segment, "id" | "name" | "kind"> } | { make: string }`
- **previewRule** (function) `(db: Queryable, raw: unknown, now: Date): Promise<Preview>`
- **readRule** (function) `(raw: unknown): { rule: Rule } | { problems: string[] }`
- **recomputeLive** (function) `(db: Queryable, now: Date): Promise<MembershipChange[]>`
- **recomputeOrder** (function) `(live: readonly Pick<Segment, "id" | "rule">[]): number[]`
- **removeMembers** (function) `(db: Queryable, id: number, profileIds: readonly number[], now: Date): Promise<MembershipChange>`
- **restoreSegment** (function) `(db: Queryable, id: number, now: Date): Promise<{ segment: Segment; change: MembershipChange | null }>`
- **retake** (function) `(db: Queryable, id: number, now: Date): Promise<MembershipChange>`
- **ruleWords** (function) `(n: Node, names: ReadonlyMap<number, string> = new Map()): string`
- **saveSegment** (function) `(db: Queryable, input: SegmentInput, by: string, now: Date): Promise<{ segment: Segment; change: MembershipChange | null }>`
- **segmentById** (function) `(db: Queryable, id: number): Promise<Segment | null>`
- **segmentMembers** (function) `(db: Queryable, segmentId: number, o: { after?: number; limit?: number; now?: Date } = {}): Promise<SegmentMember[]>`
- **segmentNames** (function) `(db: Queryable): Promise<Map<number, string>>`
- **segmentVersions** (function) `(db: Queryable, id: number): Promise<SegmentVersion[]>`
- **segmentsIn** (function) `(rule: Rule): number[]`
- **setUses** (function) `(db: Queryable, workflows: ReadonlyMap<number, readonly SegmentUse[]>, now: Date): Promise<void>`
- **traitKeys** (function) `(db: Queryable): Promise<string[]>`

## packages/core/src/send-journal-schema.ts

- **SendJournalRow** (type) `type SendJournalRow = typeof sendJournal.$inferSelect;`
- **sendJournal** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "send_journal"; schema: undefined; columns: { key: import("drizzle-orm/pg-core").PgColumn<{ name: "key"; tableName: "send_journal"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: fals…`

## packages/core/src/send-journal.ts

- **JournalEntry** (interface) `interface JournalEntry { key: string; site: string; method: string; path: string; account: string | null; }`
- **JournalRecord** (interface) `interface JournalRecord { verdict: SendVerdict | null; startedAt: string; }`
- **SendJournal** (interface) `interface SendJournal { begin( entry: JournalEntry, now: Date, ): Promise<{ won: true } | { won: false; record: JournalRecord }>; settle(key: string, verdict: SendVerdict, now: Date): Promise<void>; read(key: string): Promise<JournalRecord | null>; }`
- **dbSendJournal** (function) `(db: Db): SendJournal`
- **openTry** (function) `(r: JournalRecord): SendVerdict`

## packages/core/src/send-verdict.ts

- **Delivery** (type) `type Delivery<T> = | { kind: "sent"; out: T } | { kind: "found"; id: string | null; url: string | null; at: string } | { kind: "not_sent"; how: "refused" | "before_submit" | "verified_absent"; reason: string; status: number | null; } | { kind: "unknown"; reason: string; since: string };`
- **NotSent** (class) `constructor(readonly how: "refused" | "before_submit" | "verified_absent", readonly reason: string, readonly status: number | null = null)`
- **SendTrace** (interface) `interface SendTrace { wrote: boolean; }`
- **SendUnknown** (class) `constructor(readonly reason: string, readonly since: string)`
- **SendVerdict** (type) `type SendVerdict = | { verdict: "sent"; id: string | null; url: string | null; at: string; how: "answer" | "verified"; output?: unknown; } | { verdict: "not_sent"; reason: string; how: "refused" | "before_submit" | "verified_absent"; status?: number; } | { verdict: "unknown"; reason: string; since: string };`
- **SentFound** (class) `constructor(readonly id: string | null, readonly url: string | null, readonly at: string)`
- **currentSendKey** (function) `(): string | null`
- **delivered** (function) `(d: Delivery<T>): T`
- **deliveryOf** (function) `(key: string, fn: () => Promise<T>, o: SendScopeOptions = {}): Promise<Delivery<T>>`
- **isDelivery** (function) `(v: unknown): v is Delivery<unknown>`
- **isSendOutcome** (function) `(err: unknown): err is SentFound | NotSent | SendUnknown`
- **newSendKey** (function) `(item: string): string`
- **noteAnswer** (function) `(kind: "sent" | "found" | "not_sent" | "unknown"): void`
- **outputOf** (function) `(v: SendVerdict): T`
- **rechecking** (function) `(): boolean`
- **sendAcross** (function) `(call: (k: { sendKey: string; recheck: boolean; verifyOnly: boolean }) => Promise<unknown>): Promise<T>`
- **terminalOf** (function) `(err: SentFound | NotSent | SendUnknown): restate.TerminalError`
- **unknownSend** (function) `(reason: string, since: string): SendUnknown`
- **verifyingOnly** (function) `(): boolean`
- **withSendKey** (function) `(key: string, fn: () => Promise<T>, o: SendScopeOptions = {}): Promise<T>`
- **writeKey** (function) `(site: string, method: string, path: string): string | null`

## packages/core/src/sent-records.ts

- **SENT_RECORDS** (const) `import("./records.js").RecordType[]`
- **SentDetail** (interface) `interface SentDetail { as: "email" | "sms" | "dm" | "post"; site: string | null; from: string | null; to: string; subject: string | null; body: string; }`
- **sentDetail** (function) `(db: Queryable, id: string): Promise<SentDetail | null>`
- **sentRecord** (const) `import("./records.js").RecordType`

## packages/core/src/sent-url.ts

- **whereSent** (function) `(platform: string, place: string | null, ref: string | null): string | null`

## packages/core/src/setup-agent.ts

- **SETUP_AGENT** (const) `"SetupAgent"`
- **makeSetupAgent** (function) `(deps: { main: Db; setups: readonly Setup[]; wake?: Wake | undefined; timeoutMs?: number; parts?: readonly AlertPart[]; finders?: Readonly<Record<string, SetupFinder>>; }): restate.ServiceDefinition<"SetupAgent", { run: (ctx: restate.Context, job: AgentJob) => Promise<AgentAnswer>; }>`

## packages/core/src/setup-alerts.ts

- **AlertPart** (type) `type AlertPart = Pick<Component, "id" | "name" | "requires">;`
- **AlertView** (interface) `interface AlertView { id: number; kind: AlertKind; for: AlertFor; level: string; client: string | null; accountId: number; site: string; ref: string; setup: string | null; step: string | null; fact: string | null; part: string | null; title: string; why: string | null; at: string; open: boolean; }`
- **alertTimeline** (function) `(db: Queryable, accountIds: readonly number[], perAccount = 20): Promise<Map<number, AlertView[]>>`
- **clearStep** (function) `(db: Queryable, o: { accountId: number; setup: string; step: string; now: Date }): Promise<void>`
- **clientAlerts** (function) `(db: Queryable, client: string, now: Date, limit = 50): Promise<AlertView[]>`
- **clientMailAlerts** (function) `(db: Queryable, client: string, since: Date, now: Date): Promise<AlertView[]>`
- **digestAlerts** (function) `(db: Queryable, notifierFor: ((client: string | null) => Notifier | null) | undefined, now: Date): Promise<number>`
- **factMoved** (function) `(db: Queryable, o: { account: AlertAccount; siteLabel: string; fact: string; factLabel: string; step: AlertStep | null; setup: { id: string; name: string } | null; mode: SetupMode | null; from: FactState | null; to: FactState; okAt: Date | null; why: string | null; parts: readonly AlertPart[]; now: Date; }): Promise<void>`
- **openAlerts** (function) `(db: Queryable, o: { client?: string | null; for?: AlertFor; limit?: number } = {}): Promise<AlertView[]>`
- **openCount** (function) `(db: Queryable, client: string | null, forWho?: AlertFor): Promise<number>`
- **partPaused** (function) `(db: Queryable, client: string | null, part: Pick<Component, "requires">): Promise<string | null>`
- **pausedParts** (function) `(db: Queryable, client: string | null, parts: readonly AlertPart[]): Promise<Map<string, string>>`
- **pausedText** (function) `(factLabel: string): string`
- **setupAlert** (function) `(db: Queryable, a: AlertInput): Promise<AlertRow | null>`
- **teamAlerts** (function) `(db: Queryable, limit = 100): Promise<AlertView[]>`
- **tellAlerts** (function) `(db: Queryable, notifierFor: ((client: string | null) => Notifier | null) | undefined, now: Date): Promise<number>`

## packages/core/src/setup-schema.ts

- **ALERT_FOR** (const) `readonly ["client", "wren"]`
- **ALERT_KINDS** (const) `readonly ["lost", "stuck", "waiting", "done", "paused", "resumed"]`
- **ALERT_LEVELS** (const) `readonly ["info", "action", "warning"]`
- **AccountRow** (type) `type AccountRow = typeof clientAccounts.$inferSelect;`
- **AlertFor** (type) `type AlertFor = (typeof ALERT_FOR)[number];`
- **AlertKind** (type) `type AlertKind = (typeof ALERT_KINDS)[number];`
- **AlertRow** (type) `type AlertRow = typeof setupAlerts.$inferSelect;`
- **FACT_STATES** (const) `readonly ["ok", "waiting", "lost"]`
- **FactRow** (type) `type FactRow = typeof accountFacts.$inferSelect;`
- **FactState** (type) `type FactState = (typeof FACT_STATES)[number];`
- **SETUP_STATES** (const) `readonly ["checking", "waiting_client", "waiting_wren", "done", "stuck", "lost"]`
- **SetupRunRow** (type) `type SetupRunRow = typeof setupRuns.$inferSelect;`
- **SetupState** (type) `type SetupState = (typeof SETUP_STATES)[number];`
- **accountFacts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "account_facts"; schema: undefined; columns: { accountId: import("drizzle-orm/pg-core").PgColumn<{ name: "account_id"; tableName: "account_facts"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull…`
- **clientAccounts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "client_accounts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "client_accounts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **setupAlerts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "setup_alerts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "setup_alerts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **setupRuns** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "setup_runs"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "setup_runs"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPri…`

## packages/core/src/setup-watch.ts

- **SetupWatch** (type) `type SetupWatch = ReturnType<typeof makeSetupWatch>;`
- **makeSetupWatch** (function) `(deps: SetupWatchDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<SetupWatchPass>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<SetupWatchPass>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | …`
- **setupWatchPass** (function) `(deps: SetupWatchDeps, now: Date): Promise<SetupWatchPass>`

## packages/core/src/setup.ts

- **AGENT_ON_IT** (const) `"Wren's agent is on it"`
- **AccountView** (interface) `interface AccountView extends AccountRow { facts: FactRow[]; runs: SetupRunRow[]; }`
- **AgentAnswer** (interface) `interface AgentAnswer { done: boolean; why: string; ref?: string; }`
- **AgentJob** (interface) `interface AgentJob { accountId: number; gen: number; setup: string; step: string; owner: string; request: DoRequest; }`
- **CheckResult** (interface) `interface CheckResult { ok: boolean; why: string; seen?: unknown; }`
- **REGISTRY_SITES** (const) `readonly ["gmail", "linkedin", "calcom", "telnyx", "meta", "search_console", "google_calendar", "youtube", "linkedin_page", "x", "tiktok", "instagram", "reddit", "postmaster", "google_business", "stripe", "domain", "inbox", "number", "google_workspace", "microsoft_365", "mailbox", "social"]`
- **RegistrySite** (type) `type RegistrySite = (typeof REGISTRY_SITES)[number];`
- **SETUP_STEP** (const) `"setup.step"`
- **Setup** (interface) `interface Setup { id: string; name: string; blurb: string; site: RegistrySite; steps: readonly SetupStep[]; repeat?: string; }`
- **SetupCheck** (type) `type SetupCheck = (c: { account: AccountRow; now: Date }) => Promise<CheckResult>;`
- **SetupEmit** (interface) `interface SetupEmit { client: string | null; workflow: string; from: string; events: ExecutorEvent[]; }`
- **WAITING_ON_WREN** (const) `"Waiting on Wren's team"`
- **accountRow** (function) `(main: Queryable, id: number): Promise<AccountRow | null>`
- **accountsOf** (function) `(main: Queryable, client: string | null): Promise<AccountView[]>`
- **addAccount** (function) `(main: Db, a: { client: string | null; site: RegistrySite; ref: string; role?: string; mode?: SetupMode; login?: string | null; by: string; }): Promise<AccountRow>`
- **agentDone** (function) `(main: Db, s: Setup, job: AgentJob, out: AgentAnswer, now: Date = new Date(), parts: readonly AlertPart[] = []): Promise<SetupEmit | null>`
- **checkNow** (function) `(main: Queryable, s: Setup, o: { accountId: number; now?: Date }): Promise<SetupEmit | null>`
- **defineSetup** (function) `(s: Setup): Setup`
- **dnsChecks** (function) `(resolve: Resolver): Record<string, SetupCheck>`
- **factLost** (function) `(main: Db, setups: readonly Setup[], o: { client: string | null; site: RegistrySite; fact: string; why: string; by: string; parts?: readonly AlertPart[]; }, now: Date = new Date()): Promise<SetupEmit[]>`
- **factsHeld** (function) `(main: Queryable, client: string | null): Promise<Set<string>>`
- **factsLacking** (function) `(c: Pick<Component, "requires">, held: ReadonlySet<string>): string[]`
- **markStep** (function) `(main: Db, s: Setup, o: { accountId: number; step: string; by: string; now?: Date; parts?: readonly AlertPart[]; }): Promise<SetupEmit | null>`
- **parseSetupSubject** (function) `(subject: string): { accountId: number; gen: number; base: string } | null`
- **recheck** (function) `(main: Db, setups: readonly Setup[], checks: Readonly<Record<string, SetupCheck>>, o: { now: Date; limit?: number; parts?: readonly AlertPart[] }): Promise<{ checked: number; lost: number; emits: SetupEmit[] }>`
- **setupOf** (function) `(fact: string, setups: Iterable<Setup>): { setup: Setup; step: SetupStep } | null`
- **setupStep** (function) `(d: SetupDeps): Step`
- **setupSubject** (function) `(accountId: number, gen: number): string`
- **setupWorkflow** (function) `(s: Setup): Workflow`
- **siteLabel** (function) `(site: string): string`
- **startSetup** (function) `(main: Db, s: Setup, o: { accountId: number; mode?: SetupMode; by: string; now?: Date }): Promise<SetupEmit>`
- **sweepStuck** (function) `(main: Db, setups: readonly Setup[], now: Date): Promise<number>`

## packages/core/src/setups.ts

- **CORE_SETUPS** (const) `import("./setup.js").Setup[]`

## packages/core/src/slots/kinds.ts

- **SlotRules** (interface) `interface SlotRules { readonly fields?: readonly string[]; readonly mustSayStop?: boolean; readonly mustUse?: readonly string[]; readonly minLength?: number; readonly maxLength?: number; }`
- **TEMPLATE_KINDS** (const) `readonly ["email", "sms", "dm", "post", "prompt"]`
- **TemplateKind** (type) `type TemplateKind = (typeof TEMPLATE_KINDS)[number];`
- **checkSource** (function) `(kind: TemplateKind, key: string, source: string, rules: SlotRules = {}): { source: string; template: Template } | null`
- **parseKind** (function) `(kind: TemplateKind, name: string, source: string): Template`
- **renderKind** (function) `(kind: TemplateKind, tpl: Template, facts: FactValues, seed: string, allocation?: Allocation): Rendered`
- **sampleRender** (function) `(kind: TemplateKind, tpl: Template, facts: FactValues): string`
- **squeeze** (function) `(assembled: string): string`

## packages/core/src/slots/parse.ts

- **AuthoringError** (class) `override readonly name`
- **loadTemplates** (function) `(directory: string): Map<string, Template>`
- **parseBody** (function) `(name: string, source: string): Template`
- **parseTemplate** (function) `(name: string, rawSource: string): Template`
- **toSource** (function) `(tpl: Template, opts: { nameAll?: boolean } = {}): string`

## packages/core/src/slots/pickers.ts

- **FactValues** (type) `type FactValues = Readonly<Record<string, unknown>>;`
- **HASH_PICK** (const) `HashPick`
- **Picker** (type) `type Picker = HashPick | RulePick | FixedPick;`
- **fact** (function) `(facts: FactValues, key: string): unknown`
- **factText** (function) `(value: unknown): string | null`
- **pickOption** (function) `(picker: Picker, variant: string, eligible: readonly number[], seed: string, facts: FactValues, shares?: readonly number[]): number`
- **rule** (function) `(fact: string, pattern: string, option: number): Rule`
- **rulePick** (function) `(rules: readonly Rule[]): RulePick`
- **Rule** (interface) `interface Rule { readonly fact: string; readonly pattern: string; readonly option: number; }`

## packages/core/src/slots/preview.ts

- **enumerateRenders** (function) `(tpl: Template, facts: FactValues): Generator<[choices: Record<string, number>, rendered: Rendered]>`
- **fieldKeys** (function) `(tpl: Template): string[]`
- **placeholderFacts** (function) `(tpl: Template): Record<string, string>`
- **promptLabel** (function) `(prompt: string): string`
- **variantCounts** (function) `(tpl: Template): Record<string, number>`

## packages/core/src/slots/pyrepr.ts

- **PyValue** (type) `type PyValue = string | null | readonly PyValue[];`
- **pyRepr** (function) `(value: PyValue): string`
- **pyReprStr** (function) `(text: string): string`

## packages/core/src/slots/tree.ts

- **Allocation** (interface) `interface Allocation { readonly snapshot: number; readonly shares: Readonly<Record<string, readonly number[]>>; }`
- **Block** (type) `type Block = TextBlock | FieldBlock | VariantsBlock | GroupBlock;`
- **FieldBlock** (interface) `interface FieldBlock { readonly kind: "field"; readonly key: string; readonly fallback: string | null; readonly prompt?: string; }`
- **MissingFactError** (class) `override readonly name`
- **RenderProvenance** (interface) `interface RenderProvenance { readonly template: string; readonly version: string; readonly seed: string; readonly picks: Readonly<Record<string, number>>; readonly snapshot?: number; readonly fields: readonly string[]; readonly fallbacks: readonly string[]; }`
- **RenderStyle** (interface) `interface RenderStyle { readonly finish?: (assembled: string) => string; readonly exact?: boolean; }`
- **Rendered** (interface) `interface Rendered { readonly subject: string | null; readonly body: string; readonly provenance: RenderProvenance; }`
- **Template** (interface) `interface Template { readonly name: string; readonly subject: readonly Block[] | null; readonly body: readonly Block[]; readonly version: string; }`
- **TextBlock** (interface) `interface TextBlock { readonly kind: "text"; readonly text: string; }`
- **VariantsBlock** (interface) `interface VariantsBlock { readonly kind: "variants"; readonly name: string; readonly options: readonly Option[]; readonly picker: Picker; readonly named?: true; }`
- **alleleKey** (function) `(o: Option): string`
- **factKeys** (function) `(tpl: Template): ReadonlySet<string>`
- **field** (function) `(key: string, fallback: string | null = null): FieldBlock`
- **group** (function) `(blocks: readonly (TextBlock | FieldBlock | VariantsBlock)[]): GroupBlock`
- **optionText** (function) `(o: Option): string`
- **render** (function) `(tpl: Template, facts: FactValues, seed: string, allocation?: Allocation, style: RenderStyle = {}): Rendered`
- **slot** (function) `(prompt: string): FieldBlock`
- **slotKey** (function) `(prompt: string): string`
- **slots** (function) `(tpl: Template): ReadonlyMap<string, string>`
- **template** (function) `(name: string, subject: readonly Block[] | null, body: readonly Block[]): Template`
- **templateVersion** (function) `(subject: readonly Block[] | null, body: readonly Block[]): string`
- **tidy** (function) `(input: string): string`
- **variantPoints** (function) `(blocks: readonly Block[]): Generator<VariantsBlock>`
- **variants** (function) `(name: string, options: readonly OptionInput[], picker: Picker = HASH_PICK, named = false): VariantsBlock`
- **text** (function) `(value: string): TextBlock`

## packages/core/src/state.ts

- **IllegalTransition** (class) `constructor(readonly machine: string, readonly current: string, readonly next: string)`
- **LEAD_TRANSITIONS** (const) `TransitionTable<LeadStatus>`
- **TransitionTable** (type) `type TransitionTable<S extends string> = Readonly<Record<S, ReadonlySet<S>>>;`
- **sourcesOf** (function) `(table: TransitionTable<S>, states: readonly S[], target: S): S[]`
- **transition** (function) `(machine: string, table: TransitionTable<S>, current: S, next: S): S`
- **transitionLead** (function) `(current: LeadStatus, next: LeadStatus): "undeliverable" | "imported" | "verified" | "suppressed"`

## packages/core/src/stats.ts

- **Interval** (interface) `interface Interval { readonly low: number; readonly high: number; }`
- **formatRate** (function) `(successes: number, trials: number): string`
- **wilsonInterval** (function) `(successes: number, trials: number, z = Z_95): Interval`

## packages/core/src/suppress.ts

- **AddSuppressionInput** (interface) `interface AddSuppressionInput { kind: SuppressionKind; value: string; reason: SuppressionReason; evidence?: Evidence; }`
- **Evidence** (type) `type Evidence = Record<string, unknown> | null;`
- **activeSuppressionOf** (function) `(db: Queryable, kind: SuppressionKind, value: string): Promise<Suppression | null>`
- **activeSuppressionsOf** (function) `(db: Queryable, kind: SuppressionKind, values: Iterable<string>): Promise<(value: string) => boolean>`
- **addSuppression** (function) `(db: Queryable, input: AddSuppressionInput): Promise<{ row: Suppression; created: boolean }>`
- **liftSuppression** (function) `(db: Queryable, input: { kind: SuppressionKind; value: string; evidence?: Evidence; now?: Date }): Promise<Suppression | null>`
- **normalizeValue** (function) `(kind: SuppressionKind, value: string): string`

## packages/core/src/survey-store.ts

- **SurveyInput** (type) `type SurveyInput = z.input<typeof SurveyIn>;`
- **addSurvey** (function) `(db: Queryable, input: SurveyInput, by: string): Promise<{ key: string }>`
- **answerSurvey** (function) `(db: Queryable, a: { survey: string; client: string; person: string; value: unknown }): Promise<{ saved: boolean }>`
- **pauseSurveys** (function) `(db: Queryable, keys: readonly string[], push?: EdgePush): Promise<string[]>`
- **removeSurveys** (function) `(db: Queryable, keys: readonly string[]): Promise<string[]>`
- **startSurveys** (function) `(db: Queryable, keys: readonly string[], by: string, push?: EdgePush): Promise<string[]>`
- **surveyKinds** (function) `(db: Queryable): Promise<Map<string, SurveyKind>>`
- **surveyRecord** (function) `(push?: EdgePush): RecordType`
- **surveysDue** (function) `(db: Queryable, client: string, person: string, now = new Date()): Promise<SurveyDef[]>`
- **writeSurveyDays** (function) `(db: Queryable, rows: readonly Omit<typeof surveyDays.$inferInsert, "syncedAt">[]): Promise<number>`

## packages/core/src/surveys.ts

- **SCALE** (const) `string[]`
- **SITE_CHANNELS** (const) `readonly ["email", "sms", "ads", "content", "search", "reach", "other", "direct"]`
- **SURVEY_KINDS** (const) `readonly ["choice", "scale", "text"]`
- **SURVEY_STATES** (const) `readonly ["draft", "live", "paused"]`
- **SURVEY_SURFACES** (const) `readonly ["site", "portal"]`
- **SurveyAudience** (interface) `interface SurveyAudience { channels?: string[]; flag?: { key: string; variant: string }; clients?: string[]; }`
- **SurveyDef** (interface) `interface SurveyDef { key: string; question: string; kind: SurveyKind; choices: string[]; trigger: SurveyTrigger; audience: SurveyAudience; }`
- **SurveyKind** (type) `type SurveyKind = (typeof SURVEY_KINDS)[number];`
- **SurveyState** (type) `type SurveyState = (typeof SURVEY_STATES)[number];`
- **SurveySurface** (type) `type SurveySurface = (typeof SURVEY_SURFACES)[number];`
- **SurveyTrigger** (interface) `interface SurveyTrigger { on: SurveyEvent; page?: string; after?: number; }`
- **answerOf** (function) `(kind: SurveyKind, choices: readonly string[], value: unknown): string | null`
- **formatAudience** (function) `(a: SurveyAudience): string`
- **formatTrigger** (function) `(t: SurveyTrigger, surface: SurveySurface): string`
- **parseAudience** (function) `(text: string, surface: SurveySurface): { audience: SurveyAudience } | { error: string }`
- **parseChoices** (function) `(text: string, kind: SurveyKind): { choices: string[] } | { error: string }`
- **parseTrigger** (function) `(text: string, surface: SurveySurface): { trigger: SurveyTrigger } | { error: string }`

## packages/core/src/template-defaults.ts

- **DefaultFile** (interface) `interface DefaultFile { ref: TemplateRef; source: string; hash: string; }`
- **defaultPath** (function) `(dir: string, ref: TemplateRef): string`
- **defaultSource** (function) `(ref: TemplateRef): string`
- **defaultsDir** (function) `(): string`
- **installDefaults** (function) `(db: Queryable, patterns: readonly string[], opts: { files?: readonly DefaultFile[]; by: string }): Promise<SyncStats & { templates: string[] }>`
- **liveOrDefault** (function) `(db: Queryable, ref: TemplateRef): Promise<LiveTemplate | null>`
- **livePrompt** (function) `(db: Queryable, ref: { system: string; name: string }): Promise<LiveTemplate>`
- **loadDefaults** (function) `(dir: string = defaultsDir()): DefaultFile[]`
- **syncDefaults** (function) `(db: Queryable, opts: { only: "all" | "present"; files?: readonly DefaultFile[]; by?: string }): Promise<SyncStats>`
- **writeDefaultFile** (function) `(dir: string, ref: TemplateRef, source: string): string`
- **SyncStats** (interface) `interface SyncStats { files: number; written: number; live: number; }`
- **covers** (function) `(pattern: string, ref: TemplateRef): boolean`

## packages/core/src/template-edits.ts

- **LIBRARY_EDITS** (const) `ReadonlySet<TemplateKind>`
- **TEMPLATE_EDITS** (const) `RecordEdits`
- **TemplateDetail** (type) `type TemplateDetail = NonNullable<Awaited<ReturnType<typeof templateDetail>>>;`
- **WORDS_MAX** (const) `60000`
- **pointsOf** (function) `(tpl: Template, rows: readonly { picks: unknown; sends: number; replies: number }[]): VariantPoint[]`
- **sampleOf** (function) `(kind: TemplateKind, name: string, source: string): { sample: { subject: string | null; body: string; }; problem: null; } | { sample: null; problem: string; }`
- **templateDetail** (function) `(db: Queryable, id: string): Promise<{ kind: "email" | "sms" | "post" | "dm" | "prompt"; system: string; name: string; folder: string; status: import("./templates.js").TemplateStatus; followsDefault: boolean; newestDefault: number | null; editable: boolean; live: { sample: { subject: string | null; body: string; }; problem: nul…`

## packages/core/src/template-install.ts

- **INSTALL_STATE_LABELS** (const) `{ readonly draft: { readonly label: "Not live yet"; readonly tone: "neutral"; }; readonly waiting: { readonly label: "Waiting on approval"; readonly tone: "warn"; }; readonly live: { readonly label: "Live"; readonly tone: "good"; }; readonly off: { readonly label: "Uninstalled"; readonly tone: "neut…`
- **Installed** (interface) `interface Installed { plan: Plan; changed: boolean; token: string | null; state: InstallState; }`
- **Plan** (interface) `interface Plan { template: string; name: string; client: string; workflow: string; state: InstallState | null; version: string; installed: string | null; kind: "new" | "same" | "update" | "back"; parts: PlanPart[]; copy: { ref: string; status: CopyStatus }[]; draft: "add" | "have" | "edited" | "live"; door: { status: "add" | "have"; input: string; subject: string } | null; effects: Effect[]; confirm: string | null; changes: number; }`
- **approveInstall** (function) `(main: Queryable, id: unknown, deps: { by: string; workflows: readonly Workflow[]; components: readonly Component[]; templates?: readonly Template[]; }): Promise<{ id: string; client: string; template: string; start: LoopKey[] }>`
- **askTemplate** (function) `(main: Queryable, t: Template, ask: { client: string; by: string }): Promise<{ id: string; state: InstallState }>`
- **confirmed** (function) `(t: Pick<Template, "id" | "name">, typed: unknown): boolean`
- **copyLabel** (function) `(ref: string): string`
- **copyRefs** (function) `(patterns: readonly string[], files: readonly DefaultFile[]): { ref: string; file: boolean; }[]`
- **declineInstall** (function) `(main: Queryable, id: unknown, by: string): Promise<{ id: string }>`
- **defaultsOnce** (function) `(): DefaultFile[]`
- **installApprovalId** (function) `(id: number): string`
- **installOf** (function) `(db: Queryable, client: string, template: string): Promise<WorkflowInstall | null>`
- **installOnWorkflow** (function) `(db: Queryable, client: string, workflow: string): Promise<WorkflowInstall | null>`
- **installTemplate** (function) `(main: Queryable, clientDb: Queryable | null, t: Template, ask: InstallAsk): Promise<Installed>`
- **installsOf** (function) `(db: Queryable, client: string): Promise<WorkflowInstall[]>`
- **parseInstallApprovalId** (function) `(id: unknown): number | null`
- **planOf** (function) `(t: Template, now: { client: Pick<Client, "id" | "products" | "accounts">; row: WorkflowInstall | null; copy: readonly CopyRow[]; saves: readonly { live: boolean; edits: WorkflowEdits | null }[]; files: readonly DefaultFile[]; facts?: ReadonlySet<string>; setups?: readonly Setup[]; paused?: ReadonlyMap<string, string>; }): Plan`
- **readPlan** (function) `(main: Queryable, clientDb: Queryable | null, t: Template, client: string, files: readonly DefaultFile[] = defaultsOnce(), setups: readonly Setup[] = []): Promise<Plan>`
- **templateNamed** (function) `(all: readonly Template[], id: unknown): Template`
- **templatesNow** (function) `(db: Queryable, workflows: readonly Workflow[], components: readonly Component[]): Promise<Template[]>`
- **templatesOf** (function) `(workflows: readonly Workflow[], components: readonly Component[]): Template[]`
- **uninstallTemplate** (function) `(main: Queryable, t: Template, ask: { client: string; by: string }, deps: { workflows: readonly Workflow[]; components: readonly Component[]; templates?: readonly Template[]; }): Promise<{ removed: string[]; kept: string[]; stop: LoopKey[] }>`
- **waitingInstalls** (function) `(db: Queryable): Promise<{ id: number; client: string; clientName: string; template: string; workflow: string; askedBy: string | null; askedAt: Date | null; applied: InstallApplied; }[]>`
- **Template** (interface) `interface Template { id: string; name: string; blurb: string; icon: string; workflow: Workflow; spec: TemplateSpec; parts: { part: Component; settings: Record<string, unknown> }[]; copy: string[]; effects: Effect[]; version: string; edits?: WorkflowEdits | null; saved?: { by: string; at: string; from: string | null }; of?: string; }`
- **loopsOf** (function) `(components: readonly Component[], client: Pick<Client, "id" | "products">, ids: readonly string[]): LoopKey[]`

## packages/core/src/template-labels.ts

- **codeLabel** (function) `(name: string): string`
- **folderLabel** (function) `(path: string, from = ""): string`
- **labelOf** (function) `(part: string): string`
- **nameLabel** (function) `(name: string): string`
- **nameParts** (function) `(labels: Readonly<Record<string, string>>): void`
- **namedParts** (function) `(): Record<string, string>`
- **sequenceLabel** (function) `(name: string): string`

## packages/core/src/template-records.ts

- **templateRecords** (function) `(workflows: readonly Workflow[]): RecordType[]`

## packages/core/src/templates-console-routes.ts

- **TEMPLATES_CONSOLE_APPS** (const) `{ readonly "*": null; readonly move: "library"; readonly renameFolder: "library"; }`
- **TEMPLATES_CONSOLE_ROUTES** (const) `{ readonly list: "wren:read"; readonly detail: "wren:read"; readonly preview: "wren:read"; readonly save: "wren:act"; readonly publish: "wren:act"; readonly approve: "wren:act"; readonly decline: "wren:act"; readonly restore: "wren:act"; readonly reset: "wren:act"; readonly move: "wren:act"; readonl…`
- **TEMPLATES_CONSOLE_WRITES** (const) `readonly (keyof typeof TEMPLATES_CONSOLE_ROUTES)[]`

## packages/core/src/templates-console.ts

- **SaveRequest** (interface) `interface SaveRequest extends RefRequest { words: string; why?: string | null; expect: number | null; }`
- **TemplateListRow** (type) `type TemplateListRow = Awaited<ReturnType<TemplatesApi["list"]>>["templates"][number];`
- **TemplateOpen** (type) `type TemplateOpen = Awaited<ReturnType<TemplatesApi["detail"]>>;`
- **TemplateSaved** (type) `type TemplateSaved = Awaited<ReturnType<TemplatesApi["save"]>>;`
- **approvalId** (function) `(templateId: number, number: number): string`
- **makeTemplatesConsole** (function) `(deps: { db: Db }): restate.ServiceDefinition<"TemplatesConsole", { list: (_: restate.Context, req: PortalRequest) => Promise<{ templates: { ref: string; app: string; at: string | null; editable: boolean; id: number; folder: string; status: import("./templates.js").TemplateStatus; live: number | null; draft: number | n…`
- **templateAt** (function) `(ref: Pick<TemplateRef, "kind" | "system">): Target`
- **templatesApi** (function) `(deps: { db: Db }): { list(req: PortalRequest): Promise<{ templates: { ref: string; app: string; at: string | null; editable: boolean; id: number; folder: string; status: import("./templates.js").TemplateStatus; live: number | null; draft: number | null; waiting: number | null; newestDefault: number | null; by: string …`
- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids: string[]; }`

## packages/core/src/templates.ts

- **ListOpts** (interface) `interface ListOpts { folder?: string; kind?: TemplateKind; status?: TemplateStatus; }`
- **LiveTemplate** (interface) `interface LiveTemplate { templateId: number; versionId: number; number: number; version: string; source: string; template: Template; publishedAt: Date | null; publishedBy: string | null; }`
- **SENDS** (const) `ReadonlySet<TemplateKind>`
- **TemplateConflict** (class) `constructor(readonly current: VersionHead | null)`
- **TemplateRef** (interface) `interface TemplateRef { kind: TemplateKind; system: string; name: string; }`
- **TemplateRefusal** (class) `constructor(message: string, status: RefusalStatus = 409)`
- **TemplateState** (interface) `interface TemplateState extends TemplateRef { id: number; folder: string; followsDefault: boolean; live: VersionHead | null; draft: VersionHead | null; waiting: VersionHead | null; waitingBy: string | null; newestDefault: VersionHead | null; status: TemplateStatus; }`
- **TemplateStatus** (type) `type TemplateStatus = "waiting" | "default" | "updated" | "edited" | "empty";`
- **VersionHead** (interface) `interface VersionHead { id: number; number: number; version: string; source: string; origin: TemplateOrigin; by: string | null; at: Date; }`
- **VersionRow** (interface) `interface VersionRow extends VersionHead { why: string | null; openedFrom: number | null; publishedAt: Date | null; publishedBy: string | null; }`
- **approve** (function) `(db: Queryable, ref: TemplateRef, opts: { by: string; number: number; why?: string | null }): Promise<TemplateState>`
- **askPublish** (function) `(db: Queryable, ref: TemplateRef, opts: { by: string; number?: number; why?: string | null }): Promise<TemplateState>`
- **clearTemplate** (function) `(db: Queryable, ref: TemplateRef, by?: string): Promise<void>`
- **decline** (function) `(db: Queryable, ref: TemplateRef, opts: { by: string }): Promise<TemplateState>`
- **defaultFolder** (function) `(ref: TemplateRef): string`
- **emailRef** (function) `(niche: string, name: string): TemplateRef`
- **ensureTemplate** (function) `(db: Queryable, ref: TemplateRef, opts: { folder?: string; followsDefault?: boolean } = {}): Promise<number>`
- **importVersion** (function) `(db: Queryable, ref: TemplateRef, source: string, opts: { by: string; at?: Date }): Promise<{ version: string; live: boolean }>`
- **listTemplates** (function) `(db: Queryable, opts: ListOpts = {}): Promise<TemplateRow[]>`
- **liveTemplates** (function) `(db: Queryable, kind: TemplateKind, system: string, names?: readonly string[]): Promise<Map<string, LiveTemplate>>`
- **moveTemplate** (function) `(db: Queryable, ref: TemplateRef, folder: string, by: string): Promise<void>`
- **openedOf** (function) `(s: Pick<TemplateState, "draft" | "live"> | null): VersionHead | null`
- **parseRef** (function) `(text: string): TemplateRef`
- **promptRef** (function) `(system: string, name: string): TemplateRef`
- **publish** (function) `(db: Queryable, ref: TemplateRef, opts: { by: string; number?: number; why?: string | null }): Promise<TemplateState>`
- **recordVersion** (function) `(db: Queryable, ref: TemplateRef, version: string, opts: VersionOpts): Promise<number>`
- **refText** (function) `(ref: TemplateRef): string`
- **renameFolder** (function) `(db: Queryable, from: string, to: string, by: string): Promise<number>`
- **renderPrompt** (function) `(live: Pick<LiveTemplate, "template">, facts: FactValues = {}): string`
- **reset** (function) `(db: Queryable, ref: TemplateRef, opts: { by: string; why: string }): Promise<TemplateState>`
- **resolveTemplate** (function) `(db: Queryable, ref: TemplateRef): Promise<LiveTemplate | null>`
- **restore** (function) `(db: Queryable, ref: TemplateRef, number: number, opts: { by: string; why?: string | null; expect?: number | null }): Promise<TemplateState>`
- **saveDraft** (function) `(db: Queryable, ref: TemplateRef, source: string, opts: SaveOpts): Promise<TemplateState>`
- **saveLive** (function) `(db: Queryable, ref: TemplateRef, source: string, opts: SaveOpts): Promise<TemplateState>`
- **statusOf** (function) `(s: { followsDefault: boolean; live: Pick<VersionHead, "number"> | null; waiting: unknown; newestDefault: Pick<VersionHead, "number"> | null; }): TemplateStatus`
- **templateState** (function) `(db: Queryable, ref: TemplateRef, lock = false): Promise<TemplateState | null>`
- **versionsOf** (function) `(db: Queryable, ref: TemplateRef): Promise<VersionRow[]>`
- **waitingAsks** (function) `(db: Queryable): Promise<WaitingAsk[]>`
- **writeDefault** (function) `(db: Queryable, ref: TemplateRef, source: string, opts: { hash: string; folder?: string; by?: string }): Promise<{ written: boolean; live: boolean }>`
- **TemplateRow** (interface) `interface TemplateRow extends TemplateRef { id: number; folder: string; status: TemplateStatus; live: number | null; draft: number | null; waiting: number | null; newestDefault: number | null; by: string | null; origin: string | null; at: Date | null; words: string; }`

## packages/core/src/testing.ts

- **executorRecorder** (function) `(): { service: restate.ServiceDefinition<"Executor", { emit: (_ctx: restate.Context, req: { client: string | null; workflow: string; from: string; events: ExecutorEvent[]; }) => Promise<{ arrived: number; seen: number; waiting: number; failed: number; out: number; }>; }>; emitted: { client: string | nul…`
- **startTestRestate** (function) `(options: TestEnvironmentOptions): Promise<RestateTestEnvironment>`

## packages/core/src/time.ts

- **assertInstant** (function) `(at: Date): Date`
- **canonicalZone** (function) `(zone: string): string | null`
- **dayEnd** (function) `(zone: string, at: Date): Date`
- **dayStart** (function) `(zone: string, at: Date): Date`
- **offsetMinutes** (function) `(zone: string, at: Date): number`
- **wallClock** (function) `(zone: string, at: Date): WallClock`
- **zonedInstant** (function) `(zone: string, year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date`

## packages/core/src/tokens.ts

- **TOKENS_MAX** (const) `20`
- **TokenRow** (interface) `interface TokenRow { id: string; name: string; prefix: string; client: string | null; verbs: string[] | null; apps: string[] | null; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date | null; }`
- **checkToken** (function) `(main: Queryable, token: string): Promise<TokenViewer | null>`
- **listTokens** (function) `(main: Queryable, email: string): Promise<TokenRow[]>`
- **makeToken** (function) `(main: Queryable, email: string, ask: { name: string; client?: string | null; days?: number | null; verbs?: readonly string[] | null; apps?: readonly string[] | null; }): Promise<TokenRow & { token: string }>`
- **makeTokens** (function) `(main: Db): restate.ServiceDefinition<"Tokens", { check: (ctx: restate.Context, req: { token: string; }) => restate.RestatePromise<TokenViewer | null>; }>`
- **revokeToken** (function) `(main: Queryable, email: string, id: string): Promise<void>`
- **tokenHash** (function) `(token: string): string`

## packages/core/src/touch-feed.ts

- **Cursors** (type) `type Cursors = Record<string, number>;`
- **SETTLE_MS** (const) `30000`
- **TouchRow** (interface) `interface TouchRow { id: number; kind: string; direction: string; platform: string; handle: string; account: string | null; url: string | null; text: string | null; at: string; source: string; profile: number | null; }`
- **makeTouchFeed** (function) `(d: TouchFeedDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("./restate/loop.js").PassOutcome<TouchFeedStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("./restate/loop.js").PassOutcome<TouchFeedStats>>; start: (ctx: rest…`
- **nextCursor** (function) `(cursor: number | undefined, read: readonly number[], newest: number): number`
- **touchFired** (function) `(client: string | null, t: TouchRow): Fired`
- **touchPass** (function) `(db: Queryable, cursor: number | undefined, now: Date): Promise<{ ids: number[]; next: number } | null>`
- **touchRows** (function) `(db: Queryable, ids: readonly number[]): Promise<TouchRow[]>`

## packages/core/src/touch-link.ts

- **itemLink** (function) `(platform: string, kind: TouchKind, ref: ItemRef): string | null`
- **usableUrl** (function) `(url: string | null | undefined): string | null`

## packages/core/src/touches-schema.ts

- **BROKEN_IG_URL** (const) `"^https://www\\.instagram\\.com/(p|reel|tv)/[0-9]+/?$"`
- **HANDLE_LINKS** (const) `readonly ["reach_contact", "linkedin_url", "contact_point", "lead_person", "lead_social", "given"]`
- **HandleLink** (type) `type HandleLink = (typeof HANDLE_LINKS)[number];`
- **SocialHandle** (type) `type SocialHandle = typeof socialHandles.$inferSelect;`
- **TOUCH_DIRECTIONS** (const) `readonly ["ours", "theirs"]`
- **TOUCH_KINDS** (const) `readonly ["follow", "connect", "comment", "reply", "dm", "like", "mention"]`
- **TOUCH_PLATFORMS** (const) `readonly ["linkedin", "reddit", "youtube", "x", "instagram", "facebook", "tiktok", "google_business"]`
- **TOUCH_RESPONSES** (const) `readonly ["accepted", "replied", "liked", "ignored"]`
- **Touch** (type) `type Touch = typeof touches.$inferSelect;`
- **TouchDirection** (type) `type TouchDirection = (typeof TOUCH_DIRECTIONS)[number];`
- **TouchKind** (type) `type TouchKind = (typeof TOUCH_KINDS)[number];`
- **TouchResponse** (type) `type TouchResponse = (typeof TOUCH_RESPONSES)[number];`
- **personTouchLines** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"person_touch_lines", false, { person: import("drizzle-orm/pg-core").PgColumn<{ name: "person"; tableName: "person_touch_lines"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimary…`
- **socialHandles** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_handles"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "social_handles"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **touches** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "touches"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "touches"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKe…`

## packages/core/src/touches.ts

- **PLATFORM_LABELS** (const) `Record<string, string>`
- **TouchLine** (interface) `interface TouchLine { id: number; platform: string; handle: string; name: string | null; profileUrl: string | null; personId: number | null; leadId: number | null; kind: TouchKind; direction: TouchDirection; account: string | null; url: string | null; link: string | null; text: string | null; at: Date; response: TouchResponse | null; responseAt: Date | null; }`
- **findHandle** (function) `(db: Queryable, platform: string, raw: string): Promise<SocialHandle | null>`
- **handleUrl** (function) `(platform: string, handle: string): string | null`
- **linkHandle** (function) `(db: Queryable, ref: HandleRef, to: { personId: number | null; leadId?: number | null }): Promise<SocialHandle>`
- **lookupTouches** (function) `(db: Queryable, query: string, limit = 100): Promise<{ who: string; handles: SocialHandle[]; touches: TouchLine[] } | null>`
- **mergeHandle** (function) `(db: Queryable, fromId: number, to: HandleRef, o: { name?: string | null } = {}): Promise<SocialHandle | null>`
- **nameHandle** (function) `(platform: string, text: string | null | undefined): HandleRef | null`
- **normalizeHandle** (function) `(platform: string, text: string | null | undefined): HandleRef | null`
- **parseHandle** (function) `(text: string): HandleRef | null`
- **platformLabel** (const) `(p: string) => string`
- **recordTouch** (function) `(db: Queryable, t: TouchIn): Promise<{ id: number; handleId: number; created: boolean; linked: boolean } | null>`
- **relinkHandles** (function) `(db: Queryable, limit = 500): Promise<number>`
- **resolveHandle** (function) `(db: Queryable, ref: HandleRef, o: { name?: string | null; personId?: number | null; leadId?: number | null } = {}): Promise<SocialHandle>`
- **respond** (function) `(db: Queryable, where: { ref: string } | { handleId: number; kinds: readonly TouchKind[]; before?: Date }, response: TouchResponse, at: Date): Promise<number>`
- **touchFacts** (function) `(rows: readonly TouchLine[], now: Date): Record<string, string | number>`
- **touchFactsFor** (function) `(db: Queryable, personId: number, now = new Date()): Promise<Record<string, string | number>>`
- **touchText** (function) `(t: TouchLine, now: Date): string`
- **touchesContext** (function) `(rows: readonly TouchLine[], now: Date, max = 6): string`
- **touchesFor** (function) `(db: Queryable, who: { personId?: number | null; leadId?: number | null; handleIds?: readonly number[] }, limit = 50): Promise<TouchLine[]>`
- **touchesForPeople** (function) `(db: Queryable, personIds: readonly number[], each = 10): Promise<Map<number, TouchLine[]>>`
- **answerOf** (function) `(t: Pick<TouchLine, "direction" | "kind" | "at" | "response">, now: Date): "replied" | "ignored" | "accepted" | "liked" | null`

## packages/core/src/train.ts

- **TrainAsk** (interface) `interface TrainAsk { kinds?: readonly DraftRecordKind[]; since?: Date; items?: readonly string[]; people?: boolean; }`
- **TrainRecord** (interface) `interface TrainRecord { schema: typeof TRAIN_RECORD; id: string; item: string; kind: DraftRecordKind; platform: string | null; round: number; group: string; started: string; input: Record<string, unknown> | null; context: Record<string, unknown>; versions: TrainVersion[]; decisions: TrainDecision[]; final: { text: string | null; title: string | null; at: string; external_id: string | null; url: string | null; fields: Record<string, unknown> | null; } | null; outcome: TrainOutcome | null; }`
- **jsonl** (function) `(rows: readonly unknown[]): string`
- **redact** (function) `(r: TrainRecord, names: readonly string[]): TrainRecord`
- **trainPairs** (function) `(records: readonly TrainRecord[]): TrainPair[]`
- **trainRecords** (function) `(db: Queryable, ask: TrainAsk = {}): Promise<TrainRecord[]>`

## packages/core/src/vault-keys.ts

- **KeyAccount** (interface) `interface KeyAccount { id: string; origin: "vault" | "client"; address: string; vendor: string; owner: string; purposes: string[]; state: KeyState; until: Date | null; keyId: string | null; spendMicros: number | null; lastUsedAt: Date | null; }`
- **KeyRow** (interface) `interface KeyRow { address: string; id: string; site: string; account: string; owner: string; via?: string; vendorId?: string; purposes: string[]; status: "live" | "spent" | "revoked"; spentUntil?: string; madeAt: string; revokedAt?: string; uses: number; lastUsedAt: string | null; }`
- **SyncStats** (interface) `interface SyncStats { keys: number; removed: number; refused: number; }`
- **VAULT_KEYS_KEY** (const) `"box"`
- **VaultKeys** (type) `type VaultKeys = ReturnType<typeof makeVaultKeys>;`
- **dollars** (function) `(micros: number): number`
- **keyAccounts** (function) `(db: Queryable, o: { now?: Date; vendor?: string; client?: string } = {}): Promise<KeyAccount[]>`
- **makeVaultKeys** (function) `(deps: VaultKeysDeps): restate.VirtualObjectDefinition<string, { rotate: (ctx: restate.ObjectContext, req: { address: string; }) => Promise<KeyRotateAnswer>; revoke: (ctx: restate.ObjectContext, req: { address: string; }) => Promise<{ address: string; status: string; projected: KeyRevokeAnswer["projected"]; }>; spend: (ct…`
- **syncVaultKeys** (function) `(db: Db, sites: KeysSource, o: { now?: Date; warn?: (line: string) => void } = {}): Promise<SyncStats>`

## packages/core/src/vendor-direct.ts

- **DirectAnswer** (interface) `interface DirectAnswer { ok: boolean; status: number; body: unknown; }`
- **directCall** (function) `(vendor: string, key: string, site: string, path: string, input: Record<string, unknown> | undefined, fetch: FetchLike = globalThis.fetch): Promise<DirectAnswer>`
- **directRefusal** (function) `(vendor: string, site: string, method: string, path: string): string | null`
- **isExaRoute** (function) `(site: string, method: string, path: string): boolean`
- **unitsOfRead** (function) `(vendor: string, path: string, body: unknown): number`

## packages/core/src/vendor-keys.ts

- **Spent** (interface) `interface Spent { units: number; micros?: number; }`
- **VENDOR_READER** (const) `"wren:vendors"`
- **VendorKey** (type) `type VendorKey = | { mode: "own"; key: string; source: string; last4: string; id: string } | { mode: "managed"; key: string | null; source: string; id: string | null; unset?: true };`
- **VendorKeyMissing** (class) `readonly client: string;; constructor(client: string, vendor: string, why: string)`
- **VendorKeys** (interface) `interface VendorKeys { key(client: string | null, vendor: string, why: string, purpose?: string): Promise<VendorKey>; use<T>(o: VendorUse<T>, run: (k: VendorKey) => Promise<T>): Promise<T>; }`
- **VendorUse** (interface) `interface VendorUse<T> { client: string | null; vendor: string; why: string; purpose?: string; units?: number; spent?: (out: T) => Spent | null; part?: string | null; runId?: string | null; }`
- **scrubKey** (function) `(err: unknown, key: string | null): unknown`
- **vendorKey** (function) `(db: Db, client: string | null, vendor: string, o: VendorKeyOptions): Promise<VendorKey>`
- **vendorKeys** (function) `(deps: { main: Db; keys: KeyStore | null; env?: Readonly<Record<string, string | undefined>>; by?: string; now?: () => Date; unset?: "refuse" | "managed"; }): VendorKeys`

## packages/core/src/vendor-schema.ts

- **UsageRow** (type) `type UsageRow = typeof vendorUsage.$inferSelect;`
- **VENDOR_MODES** (const) `readonly ["own", "managed"]`
- **VendorMode** (type) `type VendorMode = (typeof VENDOR_MODES)[number];`
- **VendorModeRow** (type) `type VendorModeRow = typeof vendorModes.$inferSelect;`
- **vendorModes** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "vendor_modes"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "vendor_modes"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **vendorUsage** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "vendor_usage"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "vendor_usage"; dataType: "number"; columnType: "PgBigSerial53"; data: number; driverParam: number; notNull: true; hasDefault: tr…`

## packages/core/src/vendor-stop.ts

- **VendorStop** (class) `readonly vendor: string;; readonly why: string;; constructor(site: string, method: string, path: string, vendor: string, why: string, status = 429)`
- **isVendorStop** (function) `(err: unknown): err is VendorStop`

## packages/core/src/vendors.ts

- **DEFAULT_PURPOSE** (const) `"default"`
- **Gate** (type) `type Gate = | { ok: true; mode: VendorMode; bucket: string; room: number | null } | { ok: false; why: string; mode: VendorMode | null };`
- **VENDORS** (const) `readonly Vendor[]`
- **Vendor** (interface) `interface Vendor { id: string; name: string; unit: string; micros: number | null; url: string | null; asOf: string; quota: Bucket | null; own: "key" | "login" | null; keyName: string | null; publicKeyName?: string; managedDev?: true; wrenOnly?: true; budgetMicros?: number; }`
- **clearMode** (function) `(main: Db, client: string, vendor: string): Promise<void>`
- **gate** (function) `(main: Queryable, client: string | null, vendor: string, units: number, now: Date = new Date()): Promise<Gate>`
- **isFree** (function) `(v: Vendor): boolean`
- **meter** (function) `(main: Db, o: { client: string | null; vendor: string; units: number; micros?: number; part?: string | null; runId?: string | null; keyId?: string | null; at?: Date; }): Promise<{ mode: VendorMode; bucket: string; micros: number }>`
- **meterTokens** (function) `(main: Db, o: { model: string; usage: TokenUsage; part: string; runId?: string | null; warn?: (line: string) => void; at?: Date; }): Promise<{ units: number; micros: number }>`
- **modeOf** (function) `(main: Queryable, client: string, vendor: string, purpose: string = DEFAULT_PURPOSE): Promise<{ id: number; client: string | null; vendor: string; purpose: string; mode: "own" | "managed"; keyName: string | null; perDay: number; capCents: number; updatedBy: string; updatedAt: Date; } | null>`
- **modesOf** (function) `(main: Queryable, client: string): Promise<VendorModeRow[]>`
- **monthSpend** (function) `(main: Queryable, client: string, vendor: string, now: Date): Promise<number>`
- **monthStart** (function) `(now: Date): Date`
- **ownBucket** (function) `(vendor: string, client: string): string`
- **ownRoom** (function) `(main: Queryable, client: string, vendor: string, now: Date = new Date()): Promise<{ room: number; nextInMs: number } | null>`
- **priceText** (function) `(v: Vendor): string`
- **roomToday** (function) `(main: Queryable, client: string | null, vendor: string, now: Date = new Date()): Promise<Gate>`
- **setManaged** (function) `(main: Db, o: { client: string; vendor: string; perDay: number; capCents: number; by: string }): Promise<void>`
- **setOwnKey** (function) `(main: Db, store: KeyStore | null, o: { client: string; vendor: string; keyRef: string; publicKeyRef?: string | null; by: string }): Promise<{ keyName: string; last4: string }>`
- **setOwnLogin** (function) `(main: Db, o: { client: string; vendor: string; by: string }): Promise<void>`
- **setPurposeKey** (function) `(main: Db, store: KeyStore | null, o: { client: string; vendor: string; purpose: string; keyRef: string; by: string }): Promise<{ keyName: string; last4: string; label: string }>`
- **unitsOf** (function) `(v: Pick<Vendor, "unit">): string`
- **usageByKey** (function) `(main: Queryable, o: { since: Date }): Promise<Map<string, { micros: number; units: number; calls: number }>>`
- **usageByPart** (function) `(main: Queryable, o: { since: Date }): Promise<{ vendor: string; part: string | null; micros: number; calls: number }[]>`
- **usageSince** (function) `(main: Queryable, client: string | null, from: Date): Promise<UsageSum[]>`
- **vendorOf** (function) `(id: string): Vendor`
- **vendorSettings** (function) `(main: Queryable): Promise<VendorSettings>`
- **vendorSettingsSchema** (const) `z.ZodObject<{ markupPct: z.ZodDefault<z.ZodNumber>; reservePct: z.ZodDefault<z.ZodNumber>; managedForClients: z.ZodDefault<z.ZodArray<z.ZodString>>; }, z.core.$strip>`

## packages/core/src/view-as.ts

- **SANDBOX** (const) `"sandbox"`
- **ViewAsChoices** (interface) `interface ViewAsChoices { clients: ViewAsPlace[]; team?: { people: ViewAsPerson[]; roles: ViewAsRole[] }; sandbox: boolean; act: boolean; }`
- **ViewAsPerson** (interface) `interface ViewAsPerson { email: string; role: RoleId; }`
- **ViewAsPlace** (interface) `interface ViewAsPlace { id: string; name: string; kind: "client" | "demo" | "sandbox"; people: ViewAsPerson[]; roles: ViewAsRole[]; }`
- **ViewAsRole** (interface) `interface ViewAsRole { id: RoleId; name: string; }`
- **viewAsApi** (function) `({ main, mainUrl, components = [], bound = () => true, }: { main: Db; mainUrl?: string | undefined; components?: readonly Component[] | undefined; bound?: ((service: string) => boolean) | undefined; }): { viewAsList(req: PortalRequest): Promise<ViewAsChoices>; sandboxMake(req: PortalRequest): Promise<{ id: string; name: string; }>; sandboxReset(req: PortalRequest): Promise<{ id: string; name: string; stop: LoopKey[]; }>; }`
- **viewAsHandlers** (function) `(api: ViewAsApi): { viewAsList: (_: restate.Context, req: PortalRequest) => Promise<ViewAsChoices>; sandboxMake: (ctx: restate.Context, req: PortalRequest) => Promise<{ id: string; name: string; }>; sandboxReset: (ctx: restate.Context, req: PortalRequest) => Promise<{ id: string; name: string; }>; }`

## packages/core/src/views.ts

- **agencyFacts** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"agency_facts", false, { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "agency_facts"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; is…`
- **firmFacts** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"firm_facts", false, { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "firm_facts"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrim…`
- **leadChannels** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"lead_channels", false, { channel: import("drizzle-orm/pg-core").PgColumn<{ name: "channel"; tableName: "lead_channels"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: fal…`
- **personFacts** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"person_facts", false, { personId: import("drizzle-orm/pg-core").PgColumn<{ name: "person_id"; tableName: "person_facts"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPr…`
- **recruitingFacts** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"recruiting_facts", false, { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "recruiting_facts"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: f…`
- **templateStats** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"template_stats", false, { kind: import("drizzle-orm/pg-core").PgColumn<{ name: "kind"; tableName: "template_stats"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; …`

## packages/core/src/warm.ts

- **COLD_EVERY_MS** (const) `number`
- **warmEveryMs** (function) `(lastTouch: Date | null, now: Date, r: number): number`

## packages/core/src/webhook-events.ts

- **RETRY_LADDER_MS** (const) `readonly [300000, 1800000, 3600000, 10800000, 21600000]`
- **TEST_EVENT** (const) `"webhook.test"`
- **WEBHOOK_EVENTS** (const) `{ readonly "lead.created": "A lead came in through a door"; readonly "form.submitted": "A form was filled"; readonly "reply.received": "A lead replied by email, text or DM"; readonly "booking.made": "A call was booked or moved"; readonly "booking.cancelled": "A call was cancelled"; readonly "deal.wo…`
- **WEBHOOK_METHODS** (const) `readonly ["POST", "PUT", "PATCH", "GET", "DELETE"]`
- **WebhookEvent** (type) `type WebhookEvent = keyof typeof WEBHOOK_EVENTS;`
- **answerKept** (function) `(answer: { status: number; ms: number; body: string }, keep: Readonly<Record<string, string>>): Record<string, unknown>`
- **bodyOf** (function) `(template: unknown, e: { subject: string; kind: string; data: unknown }): unknown`
- **bodyProblem** (function) `(template: unknown): string | null`
- **fillText** (function) `(template: string, from: unknown, url = false): string`
- **headersOf** (function) `(text: unknown, from: unknown): { headers: Record<string, string>; problems: string[] }`
- **isWebhookEvent** (function) `(v: unknown): v is WebhookEvent`
- **privateIp** (function) `(ip: string): boolean`
- **retryTriesOf** (function) `(v: unknown): number`
- **urlProblem** (function) `(raw: unknown): string | null`
- **webhookEventOfDoor** (function) `(kind: EventKind): WebhookEvent | null`
- **webhookEventOfEmit** (function) `(workflow: string, from: string): WebhookEvent | null`
- **webhookEventsOfFired** (function) `(f: TriggerFacts): WebhookEvent[]`
- **keepOf** (function) `(text: unknown): { keep: Record<string, string>; problems: string[] }`

## packages/core/src/webhooks.ts

- **Answer** (interface) `interface Answer { status: number | null; ms: number; body: string; error?: string; }`
- **DELIVERY_LADDER_MS** (const) `readonly [60000, 300000, 1800000, 7200000, 21600000, 43200000]`
- **DISABLE_AFTER_MS** (const) `number`
- **DeliveryView** (interface) `interface DeliveryView { id: string; subscription: string; event: string; eventId: string; state: DeliveryState; attempts: number; status: number | null; latencyMs: number | null; response: string | null; error: string | null; at: string; lastAt: string | null; nextAt: string | null; }`
- **PostOptions** (interface) `interface PostOptions { resolve?: Resolve; timeoutMs?: number; maxBytes?: number; }`
- **SubscriptionInput** (const) `z.ZodObject<{ name: z.ZodString; url: z.ZodString; events: z.ZodArray<z.ZodString>; }, z.core.$strip>`
- **SubscriptionView** (interface) `interface SubscriptionView { id: string; name: string; url: string; events: string[]; active: boolean; by: string; at: string; rotatedAt: string | null; prevUntil: string | null; failingSince: string | null; disabledAt: string | null; disabledWhy: string | null; }`
- **TOLERANCE_S** (const) `300`
- **WEBHOOKS** (const) `{ readonly name: "Webhooks"; }`
- **WebhooksService** (type) `type WebhooksService = { publish: (ctx: restate.Context, p: Published) => Promise<{ queued: number }>; deliver: (ctx: restate.Context, req: { id: string }) => Promise<{ state: string }>; redeliver: (ctx: restate.Context, req: { id: string }) => Promise<{ id: string }>; };`
- **addSubscription** (function) `(db: Queryable, client: string | null, input: { name: string; url: string; events: readonly string[] }, by: string): Promise<{ subscription: SubscriptionView; secret: string }>`
- **attemptDelivery** (function) `(db: Queryable, id: string, last: boolean, o: PostOptions & { now?: Date; key?: string } = {}): Promise<{ done: boolean; answer: Answer | null; off?: TurnedOff }>`
- **deliveriesOf** (function) `(db: Queryable, client: string | null, o: { subscription?: string; limit?: number } = {}): Promise<DeliveryView[]>`
- **editSubscription** (function) `(db: Queryable, client: string | null, id: string, edit: { name?: string; url?: string; events?: readonly string[]; active?: boolean }): Promise<SubscriptionView>`
- **eventIdOf** (function) `(call: string, event: string, subject: string): string`
- **makeWebhooks** (function) `(d: { main: Db; tell?: (off: TurnedOff) => Promise<void>; }): restate.ServiceDefinition<"Webhooks", { publish: (ctx: restate.Context, input: Published) => Promise<{ queued: number; }>; deliver: (ctx: restate.Context, input: { id: string; }) => Promise<{ state: string; }>; redeliver: (ctx: restate.Context, req: { id: string; }) => Promise<{ id: string; }>; }>`
- **newSecret** (function) `(): string`
- **queueDeliveries** (function) `(db: Queryable, p: { client: string | null; event: WebhookEvent | typeof TEST_EVENT; id: string; payload: Payload; }, only?: string): Promise<string[]>`
- **removeSubscription** (function) `(db: Queryable, client: string | null, id: string): Promise<{ removed: string; }>`
- **reopen** (function) `(db: Queryable, id: string): Promise<string | null>`
- **reopenDelivery** (function) `(db: Queryable, client: string | null, id: string): Promise<string>`
- **retryable** (function) `(a: Pick<Answer, "status">): boolean`
- **rotateSubscription** (function) `(db: Queryable, client: string | null, id: string, now = new Date()): Promise<{ subscription: SubscriptionView; secret: string }>`
- **safePost** (function) `(r: { url: string; method?: string; headers?: Record<string, string>; body?: string }, o: PostOptions = {}): Promise<Answer>`
- **secretsOf** (function) `(s: WebhookSubscription, now: Date, raw?: string): string[]`
- **signatureOf** (function) `(secret: string, id: string, ts: number, body: string): string`
- **signedHeaders** (function) `(secrets: readonly string[], id: string, ts: number, body: string): Record<string, string>`
- **subscriptionsOf** (function) `(db: Queryable, client: string | null): Promise<SubscriptionView[]>`
- **testSubscription** (function) `(db: Queryable, client: string | null, id: string, o: PostOptions & { now?: Date } = {}): Promise<DeliveryView & { answer: Answer | null }>`
- **turnedOffTeller** (function) `(main: Queryable, send: (m: { to: string; subject: string; text: string }) => Promise<void>, portal = "https://app.wrenautomation.com"): (off: TurnedOff) => Promise<void>`
- **verifyWebhook** (function) `(secret: string, headers: Readonly<Record<string, string | undefined>>, body: string, nowS = Math.floor(Date.now() / 1000)): boolean`
- **webhookStep** (function) `(o: PostOptions = {}): Step`
- **webhooksPublish** (function) `(ctx: restate.Context, p: { client: string | null; event: WebhookEvent; subject: string; data: Record<string, unknown> }): void`
- **Published** (interface) `interface Published { client: string | null; event: WebhookEvent; id: string; subject: string; data: Record<string, unknown>; }`
- **SNIPPET** (const) `1000`
- **delivered** (function) `(a: Pick<Answer, "status">): boolean`
- **deliveryOf** (function) `(db: Queryable, client: string | null, id: string): Promise<{ payload: unknown; tries: { n: number; status: number | null; latencyMs: number; response: string | null; error: string | null; at: string; }[]; id: string; subscription: string; event: string; eventId: string; state: DeliveryState; attempts: number; status: number | null; latencyMs: number…`

## packages/core/src/wire.ts

- **Wire** (interface) `interface Wire { method: string; url: string; query?: Record<string, string>; headers: Record<string, string>; form?: Record<string, string>; json?: unknown; text?: string; }`
- **shapeOfError** (function) `(e: unknown): { isError: boolean; class: string | undefined; name: string | undefined; code: unknown; revoked: unknown; message: string | undefined; }`
- **wireRecorder** (function) `(route: (wire: Wire, n: number) => Response | undefined = () => undefined): { fetch: (url: string, init?: RequestInit) => Promise<Response>; calls: Wire[]; }`

## packages/core/src/workflow-templates.ts

- **deleteWorkflowTemplate** (function) `(db: Queryable, ask: { template: unknown; by: string }): Promise<{ id: string; name: string }>`
- **saveWorkflowTemplate** (function) `(db: Queryable, ask: SaveTemplateAsk, deps: { workflows: readonly Workflow[]; components: readonly Component[] }): Promise<{ id: string; name: string; updated: boolean }>`
- **savedIdOf** (function) `(name: string): string`

## packages/core/src/workflows.ts

- **MADE_PREFIX** (const) `"made."`
- **Made** (interface) `interface Made { name: string; blurb: string; for: Workflow["for"]; }`
- **Own** (interface) `interface Own { name: string; blurb: string; icon: string; in: Port[]; out: Port[]; run: string; }`
- **TemplateSpec** (interface) `interface TemplateSpec { parts: Record<string, Record<string, unknown>>; copy?: string[]; door?: { input: string; subject: string }; }`
- **Workflow** (interface) `interface Workflow { id: string; kind?: "setup"; name: string; blurb: string; icon: string; for: "client" | "wren"; stage: Stage; in: Port[]; out: Port[]; nodes: WorkflowNode[]; wires: Wire[]; template?: TemplateSpec; retry?: number; off?: true; }`
- **WorkflowEdits** (interface) `interface WorkflowEdits { wires: Wire[]; steps: WorkflowNode[]; settings?: Record<string, Record<string, string | number>>; retry?: number; made?: Made; off?: boolean; }`
- **WorkflowNode** (interface) `interface WorkflowNode { id: string; uses?: string; own?: Own; note?: string; with?: Record<string, string | number>; template?: TemplateRef; }`
- **cadenceId** (function) `(name: string): string`
- **cadenceWorkflow** (function) `(c: { name: string; label: string; blurb: string; for: Workflow["for"]; steps: readonly CadenceStep[]; }): Workflow`
- **checkWorkflows** (function) `(workflows: readonly Workflow[], components: readonly Component[]): string[]`
- **defineWorkflow** (function) `(w: Input): Workflow`
- **effectsIn** (function) `(id: string, workflows: readonly Workflow[], components: readonly Component[]): Effect[]`
- **flowsWith** (function) `(workflows: readonly Workflow[], saves: Readonly<Record<string, WorkflowEdits | null>>, components: readonly Component[]): { flows: Workflow[]; broken: Record<string, string[]> }`
- **isMade** (function) `(id: string): boolean`
- **madeBase** (function) `(id: string, m: Made): Workflow`
- **madeIdOf** (function) `(words: string, nonce: string): string`
- **partsIn** (function) `(id: string, workflows: readonly Workflow[], components: readonly Component[]): Component[]`
- **portsOf** (function) `(n: WorkflowNode, parts: ReadonlyMap<string, Component>, flows: ReadonlyMap<string, Workflow>): { in: Port[]; out: Port[] } | null`
- **templateIdOf** (function) `(w: Pick<Workflow, "id">, components: readonly Component[]): string`
- **Wire** (interface) `interface Wire { from: string; to: string; via: "code" | "events"; when?: string; wait?: string; }`
- **withEdits** (function) `(w: Workflow, e: WorkflowEdits): Workflow`
