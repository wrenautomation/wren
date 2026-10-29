# @wren/reactivation: interface

Exports: 266. Files: 48.

## packages/channel-email/src/sequences.ts

- **sendPolicyFor** (function) `(settings: Sending, base: SendPolicy): SendPolicy`
- **senderFleet** (function) `(settings: Senders): Fleet`

## packages/core/src/portal.ts

- **PortalRequest** (interface) `interface PortalRequest { viewer: Viewer; client?: string; asClient?: boolean; viewAs?: ViewAs | unknown; }`
- **Viewer** (type) `type Viewer = | { email: string; operator?: boolean; team?: TeamSeat; access?: Who; cap?: Cap; as?: Viewing } | { demo: true };`

## packages/core/src/records-serve.ts

- **ActivityLine** (interface) `interface ActivityLine { at: string; kind: string | null; what: string; link?: string | null; context?: string | null; }`
- **ExportAsk** (interface) `interface ExportAsk extends Omit<ListAsk, "cursor" | "limit" | "offset"> { format?: ExportFormat; }`
- **GetAsk** (interface) `interface GetAsk { record: string; id: string | number; }`
- **ListAsk** (interface) `interface ListAsk { record: string; view?: string; where?: unknown; sort?: string; group?: string; q?: string; cursor?: string; limit?: number; offset?: number; of?: { record: string; id: string | number }; facets?: boolean; thumbs?: boolean; known?: string[]; }`
- **RecordAnswer** (interface) `interface RecordAnswer { record: string; row: Row; related: { record: string; count: number }[]; activity: ActivityLine[] | null; detail: object | null; edit?: EditState | null; }`
- **RecordsFile** (interface) `interface RecordsFile { record: string; format: ExportFormat; body: string; rows: number; capped: boolean; }`
- **RecordsPage** (interface) `interface RecordsPage { record: string; view: string | null; rows: Row[]; total: number; counts: Record<string, number>; next: string | null; totals: Record<string, Total>; facets?: Record<string, Record<string, number>>; thumbs?: Record<string, Thumb>; hashes?: string[]; same?: number[]; }`
- **RecordsStat** (interface) `interface RecordsStat { record: string; view: string | null; value: number | null; prior: number | null; series: { at: string; value: number | null; by?: Record<string, number> }[]; currency: string | null; latest?: number | null; }`
- **Row** (type) `type Row = { id: string | number } & Record<string, Cell>;`
- **StatsAsk** (interface) `interface StatsAsk extends ExportAsk { at?: string; period?: Period; sum?: string; median?: string; pick?: string; zone?: string; until?: string; by?: string; }`

## packages/core/src/records.ts

- **Cell** (type) `type Cell = | string | number | null | { name: string; domain: string | null } | { amount: number; currency: string } | { n: number; of: number };`
- **FieldMeta** (interface) `interface FieldMeta { key: string; kind: Kind; label: string; states?: Readonly<Record<string, State>>; max?: number; words?: Words; grain?: "month"; slots?: Readonly<Record<string, string>>; ops: readonly Op[]; sortable: boolean; searchable: boolean; column: KindFacts["column"]; group?: string; account?: true; }`
- **Kind** (type) `type Kind = keyof typeof KINDS;`
- **Op** (type) `type Op = "eq" | "in" | "contains" | "gte" | "lte" | "empty";`
- **RecordMeta** (interface) `interface RecordMeta { id: string; name: { one: string; many: string }; title: string; subtitle: string | null; fields: FieldMeta[]; views: readonly SavedView[]; related: readonly { record: string }[]; actions: readonly string[]; activity: boolean; activityLabel?: string; activityEmpty?: string; activityLinks?: boolean; detail: boolean; drafts?: boolean; thumbs?: boolean; edits?: readonly string[] | null; editNeeds?: "manage"; quick?: readonly string[]; by?: string; account?: string; fold?: string; app: string; channel: RecordChannel; }`
- **SavedView** (interface) `interface SavedView { id: string; label: string; where?: Where; sort?: string; at?: string; hint?: string; mine?: string; }`
- **State** (interface) `interface State { label: string; tone: Tone; mark?: Mark; tint?: number; line?: number; about?: string; }`
- **Tone** (type) `type Tone = "good" | "warn" | "bad" | "neutral";`

## packages/core/src/refusal.ts

- **PortalRefusal** (class) `constructor(message: string, readonly status: RefusalStatus = 400, readonly field?: string, readonly code?: "conflict")`

## packages/reactivation/src/approve.ts

- **ReviewResult** (interface) `interface ReviewResult { done: number[]; skipped: number[]; }`
- **approveDrafts** (function) `(db: Queryable, selector: DraftSelector, by: Extract<ApprovalSource, "client" | "operator">, now: Date = new Date()): Promise<ReviewResult>`
- **skipDrafts** (function) `(db: Queryable, selector: DraftSelector, by: Extract<ApprovalSource, "client" | "operator">, now: Date = new Date()): Promise<ReviewResult>`
- **unapproveDrafts** (function) `(db: Queryable, ids: readonly number[]): Promise<ReviewResult>`

## packages/reactivation/src/brief.ts

- **BriefFact** (interface) `interface BriefFact { mark: string; text: string; }`
- **CrmBriefStats** (interface) `interface CrmBriefStats { selected: number; written: number; empty: number; failed: number; dropped: number; errors: number; aborted: string | null; }`
- **MARKS** (const) `RegExp`
- **STAGE_NAME** (const) `"reactivation_brief"`
- **briefLines** (function) `(text: string): string[]`
- **briefSubjects** (function) `(db: Queryable, opts: { limit?: number } = {}): Promise<BriefSubject[]>`
- **briefsDue** (function) `(db: Queryable): Promise<number>`
- **buildBriefPrompt** (function) `(s: BriefSubject): string`
- **gateBrief** (function) `(sentences: string[], facts: BriefFact[], signal: string | null = null): Gated`
- **madeUp** (function) `(sentence: string, source: string): string[]`
- **writeCrmBriefs** (function) `(db: Queryable, llm: LlmClient, opts: { limit?: number; runId?: string | null; feed?: Feed } = {}): Promise<CrmBriefStats>`

## packages/reactivation/src/components.ts

- **REACTIVATION_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/reactivation/src/compose.ts

- **Answer** (type) `type Answer = z.infer<typeof answerSchema>;`
- **COMPOSE_VERSION** (const) `"v5"`
- **ComposeOptions** (interface) `interface ComposeOptions { settings: ReactivationSettings; profile: ClientProfile | null; limit?: number; runId?: string | null; demo?: boolean; feed?: Feed; }`
- **ComposeSubject** (interface) `interface ComposeSubject { personId: number; companyId: number; firstName: string | null; lastName: string | null; firm: string; movedTo: string | null; brief: string; lines: string[]; briefHash: string; citations: unknown; candidateId: number; email: string; evidence: string; owner: string | null; }`
- **CrmComposeStats** (interface) `interface CrmComposeStats { selected: number; drafted: number; approved: number; failed: number; suppressed: number; raced: number; errors: number; aborted: string | null; }`
- **Draft** (interface) `interface Draft { subject: string; opener: string; followup: string; }`
- **REACTIVATION** (const) `"reactivation"`
- **RedraftStats** (interface) `interface RedraftStats { selected: number; redrafted: number; failed: number; skipped: number; aborted: string | null; last: number | null; }`
- **SEQUENCE** (const) `{ readonly name: "reactivation"; readonly arm: null; readonly steps: readonly [{ readonly template: "reactivation_opener"; readonly day: 0; }, { readonly template: "reactivation_followup"; readonly day: 4; }]; }`
- **WhyLine** (interface) `interface WhyLine { text: string; lines: number[]; }`
- **buildComposePrompt** (function) `(s: ComposeSubject, profile: Pick<ClientProfile, "firm" | "sells" | "voice">, sender: Pick<Sender, "name">, prompt: Pick<LiveTemplate, "template"> = { template: composeDefault() }): string`
- **composeBlocked** (function) `(settings: ReactivationSettings, profile: ClientProfile | null, gate: { ok: boolean; reason: string }, demo = false): string | null`
- **composeCrmEmails** (function) `(db: Queryable, llm: LlmClient, opts: ComposeOptions): Promise<CrmComposeStats>`
- **composeDefault** (function) `(): import("@wren/channel-email").Template`
- **composeDue** (function) `(db: Queryable, settings: ReactivationSettings, profile: ClientProfile | null, demo = false): Promise<{ due: number; blocked: string | null }>`
- **composeEligible** (function) `(db: Queryable, catchAll = false): Promise<number>`
- **composeRoom** (function) `(db: Queryable, perDay: number): Promise<number>`
- **composeSubjects** (function) `(db: Queryable, opts: { limit?: number; catchAll?: boolean } = {}): Promise<ComposeSubject[]>`
- **gateDraft** (function) `(d: Draft, ctx: GateContext): string[]`
- **pickSender** (function) `(owner: string | null, profile: Pick<ClientProfile, "recruiters" | "defaultRecruiter">, senders: readonly Sender[]): { sender: Sender; recruiter: Recruiter | null } | null`
- **readBody** (function) `(body: Answer["opener"], lineCount: number, sender: string): { text: string; why: WhyLine[] }`
- **recruiterFor** (function) `(owner: string | null, profile: Pick<ClientProfile, "recruiters">): Recruiter | null`
- **redraftAwaiting** (function) `(db: Queryable, llm: LlmClient, opts: { profile: ClientProfile | null; senders: readonly Sender[]; enrollmentIds?: number[]; after?: number | null; limit?: number | null; runId?: string | null; }): Promise<RedraftStats>`
- **saysHiring** (function) `(brief: string): boolean`
- **stripMarks** (function) `(text: string): string`
- **unsign** (function) `(body: string, sender: string): string`

## packages/reactivation/src/crm-run.ts

- **CrmRunObject** (type) `type CrmRunObject = ReturnType<typeof makeCrmRun>;`
- **CrmRunScope** (interface) `interface CrmRunScope { part: string; runId: string | null; }`
- **MAX_LIMIT** (const) `25`
- **makeCrmRun** (function) `(deps: CrmRunWorkerDeps): restate.VirtualObjectDefinition<"CrmRun", { run: (ctx: restate.ObjectContext, req: CrmRunRequest) => Promise<CrmRunResult>; lookup: (ctx: restate.ObjectContext, req: CrmLookupRequest) => Promise<CrmSliceResult<CrmLookupStats>>; redraft: (ctx: restate.ObjectContext, req: CrmRedraftRequest) => Promise…`

## packages/reactivation/src/crm/dates.ts

- **DayOrder** (type) `type DayOrder = "mdy" | "dmy";`
- **dayOrder** (function) `(values: Iterable<string | null>): DayOrder`
- **parseCrmDate** (function) `(raw: string | null, order: DayOrder = "mdy"): string | null`

## packages/reactivation/src/crm/formats.ts

- **CRM_DATE_FIELDS** (const) `readonly ["lastContacted", "lastPlacement", "created"]`
- **CRM_FIELDS** (const) `readonly ["id", "fullName", "firstName", "lastName", "email", "phone", "title", "company", "website", "linkedin", "owner", "lastContacted", "lastPlacement", "status", "created"]`
- **CRM_FORMATS** (const) `ReadonlyMap<string, CrmFormat>`
- **CrmDateField** (type) `type CrmDateField = (typeof CRM_DATE_FIELDS)[number];`
- **CrmField** (type) `type CrmField = (typeof CRM_FIELDS)[number];`
- **CrmFormat** (interface) `interface CrmFormat { name: string; help: string; headers: Partial<Record<CrmField, readonly string[]>>; }`
- **HeaderMap** (type) `type HeaderMap = Partial<Record<CrmField, string>>;`
- **checkHeaders** (function) `(format: CrmFormat, map: HeaderMap, headers: readonly string[]): void`
- **guessHeaders** (function) `(format: CrmFormat, headers: readonly string[]): HeaderMap`
- **mapHeaders** (function) `(format: CrmFormat, headers: readonly string[]): HeaderMap`
- **missingFields** (function) `(map: HeaderMap): string[]`
- **normalizeHeader** (function) `(h: string): string`

## packages/reactivation/src/crm/health.ts

- **CrmHealth** (interface) `interface CrmHealth { rows: number; people: number; duplicateRows: number; companies: number; emails: { missing: number; badSyntax: number; freemail: number; role: number; shared: number; }; noTitle: number; lastContacted: { under6mo: number; from6to12mo: number; from1to2y: number; over2y: number; never: number; }; owners: { owner: string; rows: number }[]; verification: { valid: number; invalid: number; risky: number; catch_all: number; unchecked: number; }; importErrors: number; gate: { ok: boolean; deadShare: number | null; reason: string }; }`
- **crmHealth** (function) `(db: Queryable, today = new Date()): Promise<CrmHealth>`
- **formatCrmHealth** (function) `(h: CrmHealth): string[]`
- **monthsBefore** (function) `(today: Date, months: number): string`

## packages/reactivation/src/crm/import.ts

- **CrmImportStats** (interface) `interface CrmImportStats extends PeopleImportStats { crm_contacts: number; crm_ids_repeated: number; candidates_added: number; emails_missing: number; emails_bad: number; }`
- **runCrmImport** (function) `(db: Queryable, source: CrmCsvSource, opts: { niche?: string | null } = {}): Promise<{ batch: ImportBatch; stats: CrmImportStats }>`

## packages/reactivation/src/crm/job-orders.ts

- **ORDER_FORMATS** (const) `ReadonlyMap<string, OrderFormat>`
- **importJobOrders** (function) `(db: Queryable, format: OrderFormat, read: { orders: JobOrder[]; skipped: number }): Promise<JobOrderStats>`
- **readJobOrders** (function) `(format: OrderFormat, path: string, bytes: Uint8Array = readFileSync(path)): { headers: Partial<Record<OrderField, string>>; orders: JobOrder[]; skipped: number }`

## packages/reactivation/src/crm/landing.ts

- **crmLanding** (const) `CrmLanding`

## packages/reactivation/src/crm/source.ts

- **CrmCsvSource** (class) `readonly sourceType: string;; readonly sourceRef: string;; readonly contentHash: string;; readonly headers: HeaderMap;; readonly fileHeaders: string[];; constructor(readonly format: CrmFormat, readonly path: string, bytes: Uint8Array = readFileSync(path), map?: HeaderMap); get rowCount(): number; record(rowNumber: number): CrmRecord | null; rows(): Generator<PersonItem>`
- **emailsIn** (function) `(cell: string | null): string[]`
- **fileHeadersOf** (function) `(bytes: Uint8Array, name: string): string[]`

## packages/reactivation/src/crm/verify.ts

- **CrmVerifyStats** (interface) `interface CrmVerifyStats { selected: number; local_invalid: number; local_errors: number; valid: number; invalid: number; risky: number; catch_all: number; held: number; aborted: string | null; }`
- **checkCrmEmails** (function) `(db: Queryable, verifier: EmailVerifier, checker: LocalCheckerLike, opts: { limit?: number; concurrency?: number } = {}): Promise<CrmVerifyStats>`

## packages/reactivation/src/delivery.ts

- **FEED_BY** (const) `"reactivation"`
- **FeedStats** (interface) `interface FeedStats { engagements: number; changed: string[]; posted: boolean; }`
- **feedDelivery** (function) `(main: Queryable, db: Queryable, clientId: string, settings: Pick<ReactivationSettings, "offer">, now: Date): Promise<FeedStats>`

## packages/reactivation/src/demo/seed.ts

- **SeedRow** (interface) `interface SeedRow { id: string; firstName: string; lastName: string; email: string; title: string; company: string; website: string; linkedin: string; owner: string; status: string; created: string; lastContacted: string; lastPlacement: string; }`
- **guessEmail** (function) `(first: string, last: string, domain: string): string | null`
- **messUp** (function) `(rng: Rng, rows: SeedRow[]): SeedRow[]`
- **resetCrmData** (function) `(db: Queryable): Promise<void>`
- **seedDemo** (function) `(db: Queryable, deps: SeedDeps, opts: SeedOptions): Promise<{ stats: SeedStats; csv: string }>`
- **toBullhornCsv** (function) `(rows: SeedRow[]): string`

## packages/reactivation/src/family.ts

- **Judge** (type) `type Judge = (from: string, to: string) => Promise<Relation>;`
- **SettleStats** (interface) `interface SettleStats { selected: number; settled: number; last: number | null; }`
- **familyJudge** (function) `(llm: LlmClient, runId: string | null = null): Judge`
- **settleDrafts** (function) `(drafts: readonly FindingDraft[], firm: Firm, judge: Judge | null): Promise<FindingDraft[]>`
- **settleMoves** (function) `(db: Queryable, judge: Judge | null, opts: { after?: number | null; limit?: number | null } = {}): Promise<SettleStats>`

## packages/reactivation/src/forward.ts

- **ForwardStats** (interface) `interface ForwardStats { opened: number; forwarded: number; found: number; noRecruiter: number; failed: number; sent: string[]; errors: string[]; }`
- **forwardEmail** (function) `(row: Pending, to: string, fromName: string | null): OutgoingEmail`
- **forwardHandoffs** (function) `(db: Queryable, transport: Transport, opts: ForwardOptions): Promise<ForwardStats>`

## packages/reactivation/src/handoff.ts

- **Booking** (interface) `interface Booking { threadEventId: number; booked: boolean; by: string; operator?: boolean; }`
- **HandoffRefusal** (class) `constructor(message: string, readonly kind: "missing" | "forbidden" = "missing")`
- **billOf** (function) `(meetings: number, offer: { upfront: number; perMeeting: number; cap: number }): { meetings: number; upfront: number; perMeeting: number; cap: number; meetingFees: number; total: number; }`
- **ensureHandoff** (function) `(db: Queryable, reply: ReplyRef, profile: Pick<ClientProfile, "recruiters" | "defaultRecruiter"> | null): Promise<void>`
- **forwardMessageId** (function) `(sender: string): string`
- **handoffRecruiter** (function) `(wroteAs: string | null, profile: Pick<ClientProfile, "recruiters" | "defaultRecruiter"> | null, sender: string): string`
- **markMeetingBooked** (function) `(db: Queryable, booking: Booking, profile: Pick<ClientProfile, "recruiters" | "defaultRecruiter"> | null, now: Date = new Date()): Promise<{ bookedAt: Date | null; by: string | null }>`
- **replyRef** (function) `(db: Queryable, threadEventId: number): Promise<ReplyRef | null>`

## packages/reactivation/src/keep.ts

- **VisitStats** (interface) `interface VisitStats { read: number; added: number; }`
- **readVisits** (function) `(main: Queryable, db: Queryable, clientId: string, now: Date): Promise<VisitStats>`

## packages/reactivation/src/lookup.ts

- **CrmLookupStats** (interface) `interface CrmLookupStats { selected: number; matched: number; unresolved: number; capped: number; errors: number; findings: Partial<Record<FindingKind, number>>; moved: number; left: number; aborted: string | null; last: number | null; }`
- **crmLookupSubjects** (function) `(db: Queryable, opts: { limit?: number; again?: boolean; after?: number | null } = {}): Promise<(LookupSubject & { personId: number; retry: boolean })[]>`
- **dueForLookup** (function) `(personId: SQL): SQL<unknown>`
- **lookUpCrmPeople** (function) `(db: Queryable, sites: SiteClient, opts: CrmLookupOptions): Promise<CrmLookupStats>`

## packages/reactivation/src/loop.ts

- **Reactivation** (type) `type Reactivation = ReturnType<typeof makeReactivation>;`
- **mailboxLoops** (function) `(clientId: string, client: Pick<Client, "demo">, settings: ReactivationSettings): MailboxLoops`
- **makeReactivation** (function) `(deps: ReactivationLoopDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<ReactivationPassStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<ReactivationPassStats>>; start: (ctx: restate.ObjectContext, settings?: Record<strin…`

## packages/reactivation/src/portal/import.ts

- **ImportPreview** (interface) `interface ImportPreview { format: string; formats: { id: string; label: string }[]; headers: string[]; columns: Partial<Record<CrmField, string>>; fields: { id: CrmField; label: string }[]; rows: number; missing: string[]; skipped: number; why: { reason: string; n: number }[]; noEmail: number; badEmail: number; sample: ImportSampleRow[]; seen: number | null; }`
- **ImportResult** (interface) `interface ImportResult { id: number; rows: number; created: number; merged: number; skipped: number; why: { reason: string; n: number }[]; noEmail: number; badEmail: number; seen: number | null; }`
- **ImportSampleRow** (interface) `interface ImportSampleRow { row: number; name: string | null; company: string | null; email: string | null; title: string | null; skip: string | null; note: string | null; }`

## packages/reactivation/src/portal/outbox.ts

- **EMAIL_FILTERS** (const) `readonly ["awaiting", "approved", "sent", "stopped", "all"]`
- **EMAIL_FROM** (const) `SQL<unknown>`
- **EMAIL_STATUS** (const) `SQL<unknown>`
- **EmailFilter** (type) `type EmailFilter = (typeof EMAIL_FILTERS)[number];`
- **EmailRow** (interface) `interface EmailRow { enrollmentId: number; personId: number | null; name: string; firm: string; to: string; from: string; subject: string | null; opener: string; followup: string | null; why: { brief: string[]; opener: WhyLine[]; followup: WhyLine[] } | null; sources: Source[]; status: EmailStatus; stopReason: string | null; sent: number; approvedBy: string | null; writtenAt: string; lastSentAt: string | null; }`
- **EmailStatus** (type) `type EmailStatus = "stopped" | "sent" | "awaiting" | "approved";`
- **EmailsPage** (interface) `interface EmailsPage { rows: EmailRow[]; total: number; offset: number; counts: Record<EmailFilter, number>; approval: { mode: "first" | "every"; firstApproved: boolean }; }`
- **portalEmails** (function) `(db: Queryable, query: { filter?: EmailFilter; offset?: number; approval: "first" | "every"; id?: number }): Promise<EmailsPage>`
- **whyOf** (function) `(opener: unknown, followup: unknown): EmailRow["why"]`

## packages/reactivation/src/portal/pipeline.ts

- **Pipeline** (interface) `interface Pipeline { steps: PipelineStep[]; sends: boolean; }`
- **PipelineStep** (interface) `interface PipelineStep { id: PipelineStepId; count: number; of: number | null; state: StepState; resumesAt: string | null; parked: number; }`
- **PipelineStepId** (type) `type PipelineStepId = (typeof PIPELINE_STEPS)[number];`
- **StepState** (type) `type StepState = "done" | "next" | "waiting" | "yours" | "idle";`

## packages/reactivation/src/portal/records.ts

- **EDITABLE** (const) `readonly ["emails.sells", "emails.voice", "emails.signature"]`
- **REACTIVATION_RECORDS** (const) `readonly RecordType[]`
- **email** (const) `RecordType`
- **finding** (const) `RecordType`
- **importLog** (const) `RecordType`
- **keep** (const) `RecordType`
- **person** (const) `RecordType`
- **reply** (const) `RecordType`
- **settingOf** (function) `(client: Client): RecordType`

## packages/reactivation/src/portal/routes.ts

- **IMPORT_MAX_BYTES** (const) `1000000`
- **IMPORT_MAX_ROWS** (const) `1000`
- **PORTAL_APPS** (const) `{ readonly "*": { readonly app: "reactivation"; readonly channel: "email"; }; readonly overview: "reactivation"; readonly person: "reactivation"; readonly importPreview: "people"; readonly importRun: "people"; readonly run: "reactivation"; readonly work: null; readonly recordsTypes: null; readonly r…`
- **PORTAL_MAX_BODY** (const) `Readonly<Record<string, number>>`
- **PORTAL_ROUTES** (const) `{ readonly overview: "read"; readonly person: "read"; readonly emails: "read"; readonly approve: "act"; readonly unapprove: "act"; readonly skip: "act"; readonly book: "act"; readonly unbook: "act"; readonly change: "act"; readonly called: "act"; readonly uncalled: "act"; readonly settle: "act"; rea…`
- **PORTAL_WRITES** (const) `readonly PortalRoute[]`

## packages/reactivation/src/portal/run.ts

- **LiveRun** (interface) `interface LiveRun { run: string; command: string; startedAt: string; finishedAt: string | null; open: boolean; lines: FeedLine[]; last: number; }`
- **RunPage** (interface) `interface RunPage { live: LiveRun | null; story: Story | null; }`

## packages/reactivation/src/portal/service.ts

- **DEMO_NAME** (const) `"Sample recruiting firm"`
- **makeReactivationPortal** (function) `(deps: PortalDeps): restate.ServiceDefinition<"ReactivationPortal", { overview: (_: restate.Context, req: PortalRequest) => Promise<Overview>; recordsTypes: (_: restate.Context, req: PortalRequest) => Promise<RecordMeta[]>; recordsList: (_: restate.Context, req: PortalRequest & ListAsk) => Promise<RecordsPage>; records…`
- **portalApi** (function) `(deps: PortalDeps): { overview: (req: PortalRequest) => Promise<Overview>; recordsTypes: (req: PortalRequest) => Promise<RecordMeta[]>; recordsList: (req: PortalRequest & ListAsk) => Promise<RecordsPage>; recordsGet: (req: PortalRequest & GetAsk) => Promise<RecordAnswer>; recordsExport: (req: PortalRequest & ExportAsk)…`

## packages/reactivation/src/portal/story.ts

- **Story** (interface) `interface Story { lines: FeedLine[]; asOf: string | null; }`

## packages/reactivation/src/portal/views.ts

- **Now** (type) `type Now = | { kind: "still_there"; company: string | null; title: string | null } | { kind: "job_change"; company: string | null; title: string | null; from: string | null } | { kind: "left"; from: string | null };`
- **Overview** (interface) `interface Overview { people: number; companies: number; lookedUp: number; moved: number; stillThere: number; left: number; hiringCompanies: number; atHiring: number; briefs: number; top: RankedContact[]; pipeline: Pipeline; }`
- **PersonRow** (interface) `interface PersonRow { personId: number; name: string; title: string | null; firm: string; domain: string | null; now: Now | null; hiring: { count: number } | null; score: number | null; reasons: Reason[]; brief: boolean; owner: string | null; lastContactedOn: string | null; lastPlacementOn: string | null; email: { address: string; verdict: string | null } | null; oldEmail: { address: string; verdict: string | null } | null; }`
- **PersonView** (interface) `interface PersonView { row: PersonRow; brief: { text: string; writtenAt: string } | null; sources: Source[]; crm: { id: number; status: string | null; owner: string | null; addedOn: string | null; lastContactedOn: string | null; lastPlacementOn: string | null; }[]; }`
- **Source** (interface) `interface Source { mark: string; kind: string; via: string; url: string | null; title: string | null; confidence: number | null; observedAt: string | null; value: Record<string, unknown>; }`

## packages/reactivation/src/portal/work.ts

- **WorkFact** (interface) `interface WorkFact { kind: string; title: string | null; fields: [label: string, value: string][]; sure: number | null; page: WorkLink | null; seen: string | null; }`
- **WorkIcon** (type) `type WorkIcon = "mail" | "search" | "page" | "board" | "wait" | "rank" | "write";`
- **WorkLink** (interface) `interface WorkLink { label: string; href: string | null; }`
- **WorkOption** (interface) `interface WorkOption { page: WorkLink; verdict: string; kept: boolean; }`
- **WorkStep** (interface) `interface WorkStep { icon: WorkIcon; did: string; query: string | null; queryHref: string | null; page: WorkLink | null; read: WorkLink | null; result: string | null; options: WorkOption[]; tone: "kept" | "dropped" | "plain"; detail: string | null; }`
- **WorkView** (interface) `interface WorkView { step: string; subject: string; personId: number | null; steps: WorkStep[]; facts: WorkFact[]; reasons: { reason: string; points: number }[]; at: string | null; }`

## packages/reactivation/src/profile.ts

- **ClientProfileInput** (type) `type ClientProfileInput = z.input<typeof clientProfileSchema>;`
- **parseClientProfile** (function) `(input: unknown): z.output<typeof clientProfileSchema>`
- **readClientProfile** (function) `(db: Queryable): Promise<ClientProfile | null>`
- **setClientProfile** (function) `(db: Queryable, input: unknown): Promise<ClientProfile>`

## packages/reactivation/src/ranked.ts

- **RankedContact** (interface) `interface RankedContact { personId: number; name: string; firm: string; score: number; reasons: Reason[]; brief: string | null; }`
- **formatRanked** (function) `(list: RankedContact[]): string[]`
- **rankedContacts** (function) `(db: Queryable, opts: { limit?: number } = {}): Promise<RankedContact[]>`

## packages/reactivation/src/run.ts

- **CrmRunDeps** (interface) `interface CrmRunDeps { verifier: EmailVerifier; checker: LocalCheckerLike; sites: SiteClient | null; fetcher: Fetcher | null; llm: LlmClient | null; }`
- **CrmStageResult** (type) `type CrmStageResult = | { stage: "verify"; stats: CrmVerifyStats } | { stage: "lookup"; stats: CrmLookupStats } | { stage: "signals"; stats: CrmSignalsStats } | { stage: "movers"; stats: CrmMoverStats } | { stage: "events"; stats: CrmEventsStats } | { stage: "score"; stats: CrmScoreStats } | { stage: "brief"; stats: CrmBriefStats } | { stage: "compose"; stats: CrmComposeStats };`
- **runCrm** (function) `(db: Queryable, deps: CrmRunDeps, opts: CrmRunOptions, onStage: (r: CrmStageResult) => void = () => {}): Promise<CrmStageResult[]>`

## packages/reactivation/src/schema.ts

- **BRIEF_STATES** (const) `readonly ["written", "empty", "failed"]`
- **Brief** (type) `type Brief = typeof briefs.$inferSelect;`
- **BriefState** (type) `type BriefState = (typeof BRIEF_STATES)[number];`
- **COMPOSITION_STATES** (const) `readonly ["drafted", "failed", "raced"]`
- **ClientProfile** (type) `type ClientProfile = typeof clientProfile.$inferSelect;`
- **Composition** (type) `type Composition = typeof compositions.$inferSelect;`
- **CompositionState** (type) `type CompositionState = (typeof COMPOSITION_STATES)[number];`
- **ContactScore** (type) `type ContactScore = typeof contactScores.$inferSelect;`
- **CrmContact** (type) `type CrmContact = typeof crmContacts.$inferSelect;`
- **Handoff** (type) `type Handoff = typeof handoffs.$inferSelect;`
- **MOVER_OUTCOMES** (const) `readonly ["found", "no_domain", "catch_all", "not_found"]`
- **MoverAddress** (type) `type MoverAddress = typeof moverAddresses.$inferSelect;`
- **MoverOutcome** (type) `type MoverOutcome = (typeof MOVER_OUTCOMES)[number];`
- **NEXT_STEPS** (const) `readonly ["reach_out", "keep_warm", "none"]`
- **NextStep** (type) `type NextStep = (typeof NEXT_STEPS)[number];`
- **Recruiter** (interface) `interface Recruiter { name: string; email: string; owners: string[]; }`
- **accountVisits** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "account_visits"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "account_visits"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **briefs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "briefs"; schema: undefined; columns: { personId: import("drizzle-orm/pg-core").PgColumn<{ name: "person_id"; tableName: "briefs"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefau…`
- **calls** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "calls"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "calls"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: f…`
- **clientProfile** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "client_profile"; schema: undefined; columns: { one: import("drizzle-orm/pg-core").PgColumn<{ name: "one"; tableName: "client_profile"; dataType: "boolean"; columnType: "PgBoolean"; data: boolean; driverParam: boolean; notNull: true; hasDefaul…`
- **compositions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "compositions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "compositions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **contactScores** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "contact_scores"; schema: undefined; columns: { personId: import("drizzle-orm/pg-core").PgColumn<{ name: "person_id"; tableName: "contact_scores"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull…`
- **crmContacts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "crm_contacts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "crm_contacts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **handoffs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "handoffs"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "handoffs"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`
- **jobOrders** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "job_orders"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "job_orders"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPri…`
- **moverAddresses** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "mover_addresses"; schema: undefined; columns: { findingId: import("drizzle-orm/pg-core").PgColumn<{ name: "finding_id"; tableName: "mover_addresses"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; not…`

## packages/reactivation/src/score.ts

- **CrmScoreStats** (interface) `interface CrmScoreStats { selected: number; hiringThere: number; moved: number; stillThere: number; unknown: number; left: number; conflicted: number; keepWarm: number; aborted: string | null; }`
- **LATEST_CRM_ROW** (const) `SQL<unknown>`
- **POINTS** (const) `{ readonly hiringThere: 60; readonly hiringUnknown: 30; readonly moved: 70; readonly stillThere: 40; readonly unknown: 10; readonly news: 25; readonly placedRecently: 15; readonly contactedRecently: 10; }`
- **Reading** (interface) `interface Reading { id: number; via: string; kind: WhereKind; value: Record<string, unknown>; }`
- **Reason** (interface) `interface Reason { reason: string; points: number; cites: string[]; }`
- **ScoreInput** (interface) `interface ScoreInput { firm: string; where: { id: number; kind: WhereKind; value: Record<string, unknown> } | null; conflict?: Reading[] | null; hiring: { id: number; count: number } | null; news?: { id: number; value: Record<string, unknown> } | null; placed: { on: string; crmId: number } | null; contacted: { on: string; crmId: number } | null; }`
- **Scored** (interface) `interface Scored { score: number; reasons: Reason[]; nextStep: NextStep; }`
- **WHERE_STAGE** (const) `"reactivation.where"`
- **hiringFinding** (function) `(companyId: SQL): SQL<unknown>`
- **newsFinding** (function) `(companyId: SQL, whereId: SQL): SQL<unknown>`
- **personSubject** (function) `(personId: number): string`
- **scoreContact** (function) `(s: ScoreInput, today = new Date()): Scored`
- **scoreCrmContacts** (function) `(db: Queryable, today = new Date()): Promise<CrmScoreStats>`
- **scoreDue** (function) `(db: Queryable): Promise<number>`
- **startedAgo** (function) `(dates: unknown, today: Date): string`
- **startedIn** (function) `(dates: unknown): string | null`
- **whereConflict** (function) `(personId: SQL): SQL<unknown>`
- **whereFinding** (function) `(personId: SQL): SQL<unknown>`

## packages/reactivation/src/sending.ts

- **clientSendScope** (function) `(deps: ClientSendDeps, key: string): Promise<SendScope | null>`
- **sendingOff** (function) `(client: Pick<Client, "demo">, settings: ReactivationSettings): "the demo never sends" | "reactivation is off" | "stages.send is off" | null`
- **settingsOrNull** (function) `(products: Record<string, unknown>): ReactivationSettings | null`

## packages/reactivation/src/settings.ts

- **PRODUCT** (const) `"reactivation"`
- **ReactivationSettings** (type) `type ReactivationSettings = z.infer<typeof reactivationSettingsSchema>;`
- **Sender** (type) `type Sender = ReactivationSettings["senders"][number];`
- **parseReactivationSettings** (function) `(block: unknown): ReactivationSettings`
- **reactivationSettingsOf** (function) `(products: Record<string, unknown>): ReactivationSettings`
- **reactivationSettingsSchema** (const) `z.ZodObject<{ on: z.ZodDefault<z.ZodBoolean>; stages: z.ZodPrefault<z.ZodObject<{ research: z.ZodDefault<z.ZodBoolean>; compose: z.ZodDefault<z.ZodBoolean>; send: z.ZodDefault<z.ZodBoolean>; handoff: z.ZodDefault<z.ZodBoolean>; }, z.core.$strict>>; compose: z.ZodPrefault<z.ZodObject<{ perDay: z.ZodD…`

## packages/reactivation/src/signals.ts

- **CrmSignalsStats** (interface) `interface CrmSignalsStats { selected: number; hiring: number; no_openings: number; unresolved: number; capped: number; errors: number; aborted: string | null; }`
- **checkCrmCompanies** (function) `(db: Queryable, deps: CrmSignalsDeps, opts: CrmSignalsOptions): Promise<CrmSignalsStats>`
- **crmSignalSubjects** (function) `(db: Queryable, opts: { limit?: number } = {}): Promise<CompanySubject[]>`
- **dueForCheck** (function) `(companyId: SQL): SQL<unknown>`

## packages/reactivation/src/status.ts

- **CRM_STAGES** (const) `readonly ["verify", "lookup", "signals", "movers", "events", "score", "brief", "compose"]`
- **CrmStage** (type) `type CrmStage = (typeof CRM_STAGES)[number];`
- **CrmStatus** (interface) `interface CrmStatus { health: CrmHealth; lookup: { matched: number; unresolved: number; capped: number; due: number; waitingUntil: string | null; }; signals: { hiring: number; noOpenings: number; unresolved: number; capped: number; due: number; waitingUntil: string | null; }; events: { found: number; none: number; due: number }; score: { scored: number; due: number; top: { score: number; count: number }[] }; briefs: { written: number; empty: number; failed: number; due: number }; emails: { drafted: number; awaiting: number; approved: number; sent: number; failed: number; due: number; blocked: string | null; }; due: CrmStage[]; next: string; }`
- **crmStatus** (function) `(db: Queryable, opts: CrmStatusOptions = {}): Promise<CrmStatus>`
- **formatCrmStatus** (function) `(s: CrmStatus): string[]`

## packages/reactivation/src/video/brief.ts

- **FIRM_MAX** (const) `40`
- **VideoBrief** (interface) `interface VideoBrief { companyId: number; firm: string; domain: string | null; }`
- **displayFirm** (function) `(raw: string): string | null`
- **videoBrief** (function) `(d: Dossier): VideoBrief | { skip: string }`

## packages/reactivation/src/video/lead.ts

- **LeadVideo** (type) `type LeadVideo = | { status: "had"; companyId: number; url: string } | { status: "skipped"; companyId: number; why: string } | { status: "made"; companyId: number; url: string; seconds: number };`
- **LeadVideoOptions** (interface) `interface LeadVideoOptions extends Omit<WalkOptions, "dir"> { workDir: string; store: PublishOptions; watchUrl: (id: string) => string; runId?: string | null; }`
- **videoForCompany** (function) `(db: Db, companyId: number, o: LeadVideoOptions): Promise<LeadVideo>`

## packages/reactivation/src/video/walk.ts

- **DEMO_ORIGIN** (const) `"https://demo.wrenautomation.com"`
- **WALK** (const) `{ readonly name: "reactivation-demo"; readonly version: "1"; }`
- **WALK_COPY** (const) `WalkCopy`
- **WalkCopy** (interface) `interface WalkCopy { home: string; run: string; brief: string; emails: string; why: string; }`
- **WalkOptions** (interface) `interface WalkOptions { dir: string; origin?: string; copy?: Partial<WalkCopy>; offer?: Offer; ffmpeg?: string; }`
- **renderWalk** (function) `(brief: VideoBrief, o: WalkOptions): Promise<Encoded>`
