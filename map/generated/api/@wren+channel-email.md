# @wren/channel-email: interface

Exports: 840. Files: 118.

## node_modules/.pnpm/mailifier@0.3.9/node_modules/mailifier/dist/client.d.ts

- **RemoteProbeError** (class) `name: string;`

## packages/channel-email/src/calls/brief.ts

- **BuildOptions** (interface) `interface BuildOptions { now: Date; llm?: LlmClient | null; site?: ((email: string) => Promise<Cited[]>) | null; }`
- **CallBrief** (interface) `interface CallBrief { call: { id: number; who: string; email: string | null; title: string | null; company: string | null; domain: string | null; start: string | null; offer: string | null; }; top: Cited[]; cameIn: Cited[]; thread: Cited[]; facts: Cited[]; posts: Cited[]; signals: Cited[]; site?: Cited[]; touches?: Cited[]; questions: Question[]; built: string; model: string | null; }`
- **Cited** (interface) `interface Cited { text: string; source: string; href: string | null; at: string; }`
- **Question** (interface) `interface Question { text: string; from: "code" | "model"; }`
- **StoredBrief** (interface) `interface StoredBrief { brief: CallBrief; saved: boolean; sentAt: string | null; recording?: RecordingNote | null; }`
- **briefOf** (function) `(db: Queryable, id: string, now = new Date()): Promise<StoredBrief | null>`
- **buildBrief** (function) `(db: Queryable, id: number, o: BuildOptions): Promise<CallBrief | null>`
- **checkQuestions** (function) `(answer: string, facts: string, have: readonly string[], max: number = BRIEF_LIMITS.questions): string[]`
- **factLine** (function) `(f: Pick<Fact, "what" | "value">): string | null`
- **factsText** (function) `(b: Omit<CallBrief, "questions" | "built" | "model" | "top">): string`
- **gapQuestions** (function) `(b: Omit<CallBrief, "questions" | "built" | "model" | "top">): Question[]`
- **markSent** (function) `(db: Queryable, id: number, at: Date): Promise<void>`
- **ownWords** (function) `(body: string): string`
- **saveBrief** (function) `(db: Queryable, brief: CallBrief): Promise<void>`

## packages/channel-email/src/calls/outcome.ts

- **callSubject** (function) `(id: number): string`
- **outcomeEmits** (function) `(marked: readonly MarkedCall[]): OutcomeEmit[]`
- **setCallOutcome** (function) `(db: Queryable, o: OutcomeAsk): Promise<MarkedCall[]>`

## packages/channel-email/src/calls/recording.ts

- **CALL_NOTES** (const) `z.ZodObject<{ summary: z.ZodString; needs: z.ZodArray<z.ZodString>; objections: z.ZodArray<z.ZodString>; next: z.ZodArray<z.ZodString>; }, z.core.$strip>`
- **CallNotes** (type) `type CallNotes = z.infer<typeof CALL_NOTES>;`
- **RecordingNote** (interface) `interface RecordingNote { id: number; startedAt: string; durationS: number; notes: CallNotes | null; }`
- **Segment** (interface) `interface Segment { start: number; end: number; text: string; }`
- **clock** (function) `(s: number): string`
- **matchBooking** (function) `(db: Queryable, startedAt: Date): Promise<number | null>`
- **recordingLine** (function) `(id: number, r: Pick<NewRecording, "startedAt" | "durationS" | "notes">): ElsewhereLine`
- **recordingOf** (function) `(db: Queryable, callBookingId: number): Promise<RecordingNote | null>`
- **saveRecording** (function) `(db: Queryable, r: NewRecording): Promise<number>`
- **transcriptOf** (function) `(segments: readonly Segment[]): string`
- **upcomingCalls** (function) `(db: Queryable, now = new Date(), aheadH = 24): Promise<UpcomingCall[]>`
- **writeNotes** (function) `(llm: LlmClient, transcript: string, who: string | null): Promise<{ notes: CallNotes; model: string } | null>`

## packages/channel-email/src/calls/restate.ts

- **CallBriefs** (type) `type CallBriefs = ReturnType<typeof makeCallBriefs>;`
- **SendAsk** (interface) `interface SendAsk { client: string | null; id: number; start: string; }`
- **bookedCall** (function) `(id: number, start: Date | string | null): ExecutorEvent`
- **bookingEmit** (function) `(o: { id: number; state: string; start: Date | string | null }): { workflow: string; from: string; events: ExecutorEvent[]; } | null`
- **bookingFired** (function) `(client: string | null, o: { id: number; state: "booked" | "cancelled"; enrollmentId?: number | null }, b: { start: Date | string | null; email: string | null; name: string | null; offer: string | null; }): Fired`
- **briefPath** (function) `(client: string | null, id: number): string`
- **briefStep** (function) `(deps: BriefDeps & { queue(ask: SendAsk, delayMs: number, key: string): Promise<void>; now?: () => Date; }): Step`
- **makeCallBriefs** (function) `(deps: CallBriefsDeps): restate.ServiceDefinition<"CallBriefs", { build: (ctx: restate.Context, req: { client?: string | null; id: number; }) => Promise<{ built: boolean; }>; send: (ctx: restate.Context, req: SendAsk) => Promise<{ sent: boolean; why: string; } | { sent: boolean; why?: never; }>; }>`
- **markOutcome** (function) `(ctx: restate.Context, db: Db, client: string | null, ask: { ids: readonly number[]; outcome: MeetingOutcome | null; reason?: string | null; by: string; }): Promise<{ changed: number; done: number[] }>`

## packages/channel-email/src/calls/settings.ts

- **BriefSettings** (type) `type BriefSettings = z.infer<typeof briefSettingsSchema>;`
- **CALL_BRIEF** (const) `"calls.brief"`
- **CALL_OUTCOME** (const) `"calls.outcome"`
- **briefSettingsOf** (function) `(block: unknown): BriefSettings`
- **briefSettingsSchema** (const) `z.ZodObject<{ leadMinutes: z.ZodDefault<z.ZodNumber>; questions: z.ZodDefault<z.ZodBoolean>; ping: z.ZodDefault<z.ZodBoolean>; }, z.core.$strict>`
- **outcomeSettingsOf** (function) `(block: unknown): OutcomeSettings`
- **outcomeSettingsSchema** (const) `z.ZodObject<{ reasons: z.ZodDefault<z.ZodArray<z.ZodString>>; }, z.core.$strict>`

## packages/channel-email/src/calls/site.ts

- **landerHits** (function) `(site: Site): (visitor: string) => Promise<{ ts: string; page: string }[]>`
- **landerVisitLines** (function) `(site: Site): (visitors: readonly string[]) => Promise<{ at: string; text: string; href: string | null }[]>`
- **landerVisits** (function) `(site: Site): (email: string) => Promise<Cited[]>`
- **visitorsOf** (function) `(apps: readonly SiteApplication[], email: string): string[]`

## packages/channel-email/src/components.ts

- **EMAIL_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **EMAIL_TOUCH** (const) `"email.touch"`
- **INBOX_HEALTH** (const) `"email.inbox_health"`

## packages/channel-email/src/concurrent.ts

- **eachConcurrently** (function) `(items: readonly T[], width: number, work: (item: T) => Promise<void>, stopped: () => boolean = () => false): Promise<void>`

## packages/channel-email/src/console-routes.ts

- **EMAIL_CONSOLE_APPS** (const) `{ readonly "*": { readonly app: "outbound"; readonly channel: "email"; }; readonly answers: null; readonly recordsTypes: null; readonly recordsList: null; readonly recordsGet: null; readonly recordsExport: null; readonly recordsStats: null; readonly dossier: null; readonly callWon: "calls"; readonly…`
- **EMAIL_CONSOLE_ROUTES** (const) `{ readonly answers: "read"; readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsGet: "read"; readonly recordsExport: "read"; readonly recordsStats: "read"; readonly dossier: "read"; readonly approve: "act"; readonly drop: "act"; readonly pause: "act"; readonly resume: "act";…`
- **EMAIL_CONSOLE_WRITES** (const) `readonly EmailConsoleRoute[]`

## packages/channel-email/src/dossier.ts

- **emailFacts** (function) `(db: Queryable, companyIds: readonly number[], personIds: readonly number[]): Promise<MoreFacts>`

## packages/channel-email/src/follow.ts

- **AskFollowEmail** (type) `type AskFollowEmail = ( client: string | null, o: { subject: string; enrollmentId: number; body: string; by: string; why: string }, ) => Promise<{ asked: boolean; why: string | null }>;`
- **Touch** (interface) `interface Touch { workflow: string; from: string; event: ExecutorEvent; }`
- **emailCadence** (function) `(niche: string, seq: Sequence): Workflow`
- **emailTouchStep** (function) `(dbFor: (client: string | null) => Db, ask: AskFollowEmail | null = null): Step`
- **executorTouches** (function) `(db: Queryable, sent: readonly (readonly [number, number])[]): Promise<Touch[]>`
- **release** (function) `(db: Queryable, enrollmentId: number, step: number, now: Date): Promise<"released" | "replied" | "ended">`

## packages/channel-email/src/guards.ts

- **SharedSuppressions** (interface) `interface SharedSuppressions { readonly main: Queryable; readonly client: string; }`
- **activeSuppression** (function) `(db: Queryable, email: string, shared?: SharedSuppressions | null): Promise<Suppression | null>`
- **activeSuppressions** (function) `(db: Queryable, emails: Iterable<string>, shared?: SharedSuppressions | null): Promise<(email: string) => Suppression | null>`

## packages/channel-email/src/inbox/bookings.ts

- **BookingChange** (type) `type BookingChange = "created" | "rescheduled" | "cancelled";`
- **BookingEvent** (interface) `interface BookingEvent { change: BookingChange; uid: string; fromUid: string | null; start: Date | null; bookedAt: Date | null; email: string | null; name: string | null; offer: string | null; code: string | null; }`
- **BookingOutcome** (interface) `interface BookingOutcome { id: number; state: "booked" | "cancelled"; enrollmentId: number | null; stopped: number; }`
- **applyBooking** (function) `(db: Db, e: BookingEvent, opts: { now: Date }): Promise<BookingOutcome>`
- **bookingFromList** (function) `(b: ListedBooking): BookingEvent | null`
- **bookingFromWebhook** (function) `(body: unknown): BookingEvent | null`

## packages/channel-email/src/inbox/click-sync.ts

- **ClickSyncStats** (interface) `interface ClickSyncStats { fetched: number; coded: number; matched: number; unknown_code: number; unreadable: number; pages: number; }`
- **syncClicks** (function) `(db: Db, opts: SyncClicksOptions): Promise<ClickSyncStats>`

## packages/channel-email/src/inbox/clicks.ts

- **ClickFollowUp** (interface) `interface ClickFollowUp { visitors: number; views: number; secs: number; reachedForm: boolean; applied: { offer: string; fit: boolean; ts: string } | null; }`
- **ClickedEmail** (interface) `interface ClickedEmail { code: string; pages: string[]; firstAt: Date; lastAt: Date; clicks: number; message: { id: number; step: number; niche: string; toEmail: string; company: string | null; sentAt: Date | null; } | null; }`
- **SITE_MAX_PAGES** (const) `20`
- **SITE_PAGE** (const) `5000`
- **SiteAnswer** (interface) `interface SiteAnswer { id: number; ts: string; survey: string; visitor: string; view: string; page: string; value: string; }`
- **SiteApplication** (interface) `interface SiteApplication { id: number; ts: string; visitor: string | null; offer: string; fit: number; r: string; email?: string | null; first_touch?: string | null; last_touch?: string | null; }`
- **SiteEvent** (interface) `interface SiteEvent { id: number; ts: string; view: string; visitor: string | null; page: string; name: string; props: string; }`
- **SiteExportError** (class) `constructor(message: string)`
- **SiteHit** (interface) `interface SiteHit { id: number; ts: string; visitor: string | null; page: string; secs: number; cta: number; touched: number; r: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; ref?: string; }`
- **SiteReplay** (interface) `interface SiteReplay { id: number; view: string; visitor: string | null; page: string; started: string; last: string; chunks: number; bytes: number; w: number | null; country: string | null; capped: number; first_touch?: string | null; }`
- **clickFollowUps** (function) `(hits: readonly SiteHit[], applications: readonly SiteApplication[]): Map<string, ClickFollowUp>`
- **clickedEmails** (function) `(db: Queryable, opts: { limit?: number } = {}): Promise<ClickedEmail[]>`
- **siteExport** (function) `(table: T, opts: SiteReadOptions): Promise<SiteTables[T][]>`
- **sitePage** (function) `(table: T, opts: SiteReadOptions): Promise<SiteTables[T][]>`

## packages/channel-email/src/inbox/disposition.ts

- **ClassifyOptions** (interface) `interface ClassifyOptions { runId?: string | null; tracer?: Tracer | null; }`
- **DISPOSITION_VERSION** (const) `"v1"`
- **DispositionState** (interface) `interface DispositionState { event: DispositionEvent; ours: DispositionOurs; company: DispositionCompany; }`
- **DispositionStats** (interface) `interface DispositionStats { selected: number; classified: number; labelled: number; ungrounded: number; no_text: number; parse_errors: number; provider_rejected: number; skipped_labelled_meanwhile: number; aborted: string | null; }`
- **MIN_CONFIDENCE** (const) `0.6`
- **Proposal** (type) `type Proposal = z.infer<typeof proposalSchema>;`
- **STAGE_NAME** (const) `"reply_disposition"`
- **buildPrompt** (function) `(state: DispositionState): string`
- **gatherState** (function) `(db: Queryable, event: ThreadEvent): Promise<DispositionState>`
- **ground** (function) `(state: DispositionState, step: Omit<DispositionResult, "verdict">): DispositionVerdict`
- **pendingEvents** (function) `(db: Queryable, opts: { model: string; niche?: string | null; limit?: number | null }): Promise<ThreadEvent[]>`
- **proposalSchema** (const) `z.ZodObject<{ disposition: z.ZodString; evidence: z.ZodOptional<z.ZodNullable<z.ZodString>>; confidence: z.ZodOptional<z.ZodNullable<z.ZodNumber>>; reason: z.ZodOptional<z.ZodNullable<z.ZodString>>; }, z.core.$strip>`
- **route** (function) `(state: DispositionState): "classify" | "no_text"`
- **runDisposition** (function) `(db: Db, llm: LlmClient, opts: RunDispositionOptions = {}): Promise<DispositionStats>`
- **runGraph** (function) `(llm: LlmClient, state: DispositionState, opts: ClassifyOptions = {}): Promise<DispositionResult>`

## packages/channel-email/src/inbox/health.ts

- **activePauses** (function) `(db: Queryable): Promise<Map<string, SenderPause>>`
- **domainHealth** (function) `(db: Queryable, opts: { policy: SendPolicy; now: Date; senders: readonly string[] }): Promise<DomainHealth[]>`
- **domainOf** (function) `(sender: string): string`
- **evaluateKillSwitches** (function) `(db: Queryable, opts: { policy: SendPolicy; now: Date; senders: readonly string[]; runId?: string | null }): Promise<SenderPause[]>`
- **killSwitches** (const) `KillSwitches`
- **pause** (function) `(db: Queryable, opts: { target: string; reason: string; by: string; now: Date; senders: readonly string[] }): Promise<SenderPause[]>`
- **resolveTarget** (function) `(target: string, senders: readonly string[]): string[]`
- **resume** (function) `(db: Queryable, opts: { target: string; by: string; now: Date; senders: readonly string[] }): Promise<SenderPause[]>`
- **senderDays** (function) `(db: Queryable, opts: { since: string }): Promise<SenderDay[]>`
- **wouldTrip** (function) `(health: DomainHealth, policy: SendPolicy): string | null`

## packages/channel-email/src/inbox/inbound.ts

- **Inbound** (interface) `interface Inbound { readonly kind: InboundKind; readonly bounceClass: InboundBounceClass | null; readonly bouncedAddress: string | null; readonly bounceStatus: string | null; readonly diagnostic: string | null; readonly messageId: string | null; readonly inReplyTo: string | null; readonly references: readonly string[]; readonly originalMessageId: string | null; readonly matchedMessageId: string | null; readonly matchedBy: MatchedBy | null; readonly fromAddress: string | null; readonly fromName: string | null; readonly subject: string | null; readonly date: Date | null; readonly autoSubmitted: string | null; readonly isAuto: boolean; readonly snippet: string | null; readonly text: string | null; }`
- **InboundBounceClass** (type) `type InboundBounceClass = "hard" | "soft";`
- **InboundKind** (type) `type InboundKind = (typeof INBOUND_KINDS)[number];`
- **TEXT_MAX_CHARS** (const) `4000`
- **bodyText** (function) `(msg: MimePart): string`
- **classify** (function) `(raw: Uint8Array | string, opts: { ourMessageIds?: Iterable<string> } = {}): Inbound`
- **mayBeBounce** (function) `(m: { fromAddress: string | null; fromName: string | null; subject: string | null; }): boolean`
- **messageIds** (function) `(raw: string | null): string[]`
- **normalizeMessageId** (function) `(value: string): string`
- **ownText** (function) `(msg: MimePart): string`
- **stripQuoted** (function) `(body: string): string`

## packages/channel-email/src/inbox/instantly.ts

- **InstantlyTransport** (class) `readonly name; send(email: { fromAddress: string }): Promise<SendReceipt>; find(): Promise<SendReceipt | null>`

## packages/channel-email/src/inbox/invite.ts

- **ApproveOptions** (interface) `interface ApproveOptions extends SendReplyOptions { calendar: Calendar; body?: string | null; }`
- **ApproveOutcome** (type) `type ApproveOutcome = | { ok: true; state: CallInviteState; said: string | null; reply: ReplyOutcome | null } | { ok: false; state: CallInviteState; reason: string };`
- **InviteStats** (interface) `interface InviteStats { selected: number; proposed: number; already_booked: number; needs_you: number; aborted: string | null; }`
- **RunInvitesOptions** (interface) `interface RunInvitesOptions { calendar: Calendar; notifier?: Notifier | null; copies?: ReadonlyMap<string, ReplyCopy> | null; runId?: string | null; tracer?: Tracer | null; now?: Date; niches?: readonly string[] | null; client?: string | null; }`
- **approveInvite** (function) `(db: Db, id: number, opts: ApproveOptions): Promise<ApproveOutcome>`
- **dropInvite** (function) `(db: Db, id: number): Promise<CallInviteState>`
- **openInvites** (function) `(db: Db): Promise<{ id: number; state: "proposed" | "dropped" | "booked" | "booking" | "sent" | "already_booked" | "needs_you"; email: string; start: Date | null; timeZone: string | null; detail: string | null; createdAt: Date; words: string | null; snippet: string | null; draft: string | null; }[]>`
- **runInvites** (function) `(db: Db, llm: LlmClient, opts: RunInvitesOptions): Promise<InviteStats>`

## packages/channel-email/src/inbox/marketing-bounces.ts

- **BOUNCE_QUERY** (const) `string`
- **BounceReadStats** (interface) `interface BounceReadStats { mailbox: string; listed: number; kept: number; other: number; unmatched: number; soft: number; suppressed: number; mismatch: number; errors: number; }`
- **readBounces** (function) `(db: Queryable, box: Mailbox, now: Date, onError?: (id: string, err: unknown) => void): Promise<BounceReadStats>`

## packages/channel-email/src/inbox/opens.ts

- **MAX_PAGES** (const) `50`
- **OpenSyncError** (class) `constructor(message: string)`
- **OpenSyncStats** (interface) `interface OpenSyncStats { fetched: number; stored: number; already_seen: number; unknown_token: number; pages: number; }`
- **PAGE** (const) `1000`
- **syncOpens** (function) `(db: Db, opts: SyncOpensOptions): Promise<OpenSyncStats>`

## packages/channel-email/src/inbox/placement.ts

- **DomainPlacement** (interface) `interface DomainPlacement { domain: string; senders: string[]; plain: Tally; real: Tally; auth: string[]; verdict: PlacementVerdict; pausedAt: Date | null; }`
- **MIN_PAUSE_DAYS** (const) `7`
- **Tally** (interface) `interface Tally { inbox: number; landed: number; }`
- **WINDOW_DAYS** (const) `2`
- **authFailures** (function) `(auth: AuthResults): string[]`
- **evaluatePlacement** (function) `(db: Db, opts: { now: Date; senders: readonly string[] }): Promise<PlacementChanges>`
- **parseAuthResults** (function) `(header: string | null | undefined): AuthResults`
- **placementSummary** (function) `(d: DomainPlacement): string`
- **placementTrouble** (function) `(d: DomainPlacement, now: Date): string[]`
- **placementVerdicts** (function) `(db: Queryable, opts: { now: Date; senders: readonly string[] }): Promise<DomainPlacement[]>`
- **verdictOf** (function) `(plain: Tally, real: Tally): PlacementVerdict`

## packages/channel-email/src/inbox/postmaster.ts

- **API** (const) `"https://gmailpostmastertools.googleapis.com/v2"`
- **Day** (type) `type Day = string;`
- **METRICS** (const) `ReadonlyArray<readonly [MetricColumn, string, string | null]>`
- **PostmasterClient** (interface) `interface PostmasterClient { fetch: FetchLike; token: string | (() => Promise<string>); sleep?: Sleep; }`
- **PostmasterError** (class) `constructor(message: string)`
- **PostmasterStats** (interface) `interface PostmasterStats { domains: number; domains_failed: number; days_with_data: number; days_without_data: number; rows_unparseable: number; stored: number; per_domain: Record<string, number>; failed: Record<string, string>; }`
- **registeredDomains** (function) `(client: PostmasterClient): Promise<string[]>`
- **syncPostmaster** (function) `(db: Db, opts: SyncPostmasterOptions): Promise<PostmasterStats>`

## packages/channel-email/src/inbox/reply.ts

- **ReplyCopy** (interface) `interface ReplyCopy { readonly sequences: ReadonlyMap<string, Sequence>; readonly offerFacts: ReadonlyMap<string, Readonly<Record<string, string>>>; readonly site?: string | null; readonly factsView: string | null; readonly signatures: Readonly<Record<string, string>>; readonly fill?: Filler; }`
- **ReplyOutcome** (type) `type ReplyOutcome = | { sent: true; message: Message } | { sent: false; message: Message; reason: string };`
- **SendReplyOptions** (interface) `interface SendReplyOptions { transport: Transport; fleet: Pick<Fleet, "fromNames" | "signatureHtml" | "pages">; now?: Date; }`
- **draftByHand** (function) `(db: Queryable, enrollment: Enrollment, event: ThreadEvent | null, body: string): Promise<Message>`
- **draftReply** (function) `(db: Queryable, copy: ReplyCopy, enrollment: Enrollment, event: ThreadEvent, extra: Readonly<Record<string, string>> = {}): Promise<Message | null>`
- **sendReply** (function) `(db: Db, messageId: number, event: ThreadEvent | null, enrollment: Enrollment, opts: SendReplyOptions & { body?: string | null }): Promise<ReplyOutcome>`

## packages/channel-email/src/inbox/sync.ts

- **DAY_MS** (const) `86400000`
- **SyncStats** (interface) `interface SyncStats extends SyncCounts { senders: number; per_sender: Record<string, SyncCounts>; replied?: number[]; }`
- **labelEvent** (function) `(db: Queryable, opts: { event: ThreadEvent; disposition: ReplyDisposition; now: Date; source?: DispositionSource; }): Promise<void>`
- **recordOperatorReply** (function) `(db: Queryable, opts: { enrollment: Enrollment; disposition: ReplyDisposition; note: string | null; fromAddress: string | null; now: Date; runId?: string | null; }): Promise<ThreadEvent>`
- **since** (function) `(cursorMs: number, opts: { now: Date; firstSyncLookbackMs: number; overlapMs: number }): Date`
- **syncInbox** (function) `(db: Db, opts: SyncInboxOptions): Promise<SyncStats>`

## packages/channel-email/src/listmonk/campaign.ts

- **MESSENGER** (const) `"wren"`
- **ensureTemplate** (function) `(lm: Listmonk): Promise<number>`
- **issueOf** (function) `(c: { uuid: string; name: string; tags?: string[] | null | undefined; }): IssueRef | null`
- **issueTag** (function) `(topic: string, slug: string): string`
- **startCampaign** (function) `(lm: Listmonk, o: { listId: number; topic: string; slug: string; subject: string; body: string }): Promise<CampaignStart>`

## packages/channel-email/src/listmonk/client.ts

- **Listmonk** (type) `type Listmonk = ReturnType<typeof listmonk>;`
- **ListmonkCampaign** (type) `type ListmonkCampaign = z.infer<typeof CAMPAIGN>;`
- **ListmonkError** (class) `constructor(readonly status: number, message: string)`
- **ListmonkList** (type) `type ListmonkList = z.infer<typeof LIST>;`
- **ListmonkSubscriber** (type) `type ListmonkSubscriber = z.infer<typeof SUBSCRIBER>;`
- **SettingsMap** (type) `type SettingsMap = Record<string, unknown>;`
- **escapeTemplate** (function) `(text: string): string`
- **listmonk** (function) `(cfg: ListmonkConfig): { lists: () => Promise<{ [x: string]: unknown; id: number; name: string; tags?: string[] | null | undefined; }[]>; createList(o: { name: string; tags: string[]; }): Promise<{ [x: string]: unknown; id: number; name: string; tags?: string[] | null | undefined; }>; subscribers: () => Promise<{ [x: stri…`

## packages/channel-email/src/listmonk/setup.ts

- **applySetup** (function) `(lm: Listmonk, o: SetupOptions, wait = { tries: 30, gapMs: 1000 }): Promise<{ templateId: number; unknown: string[]; }>`
- **settingsFor** (function) `(current: SettingsMap, o: SetupOptions): { settings: SettingsMap; unknown: string[] }`

## packages/channel-email/src/listmonk/sync.ts

- **TopicSync** (interface) `interface TopicSync extends Record<keyof TopicPlan, number> { topic: string; listId: number; }`
- **WrenConsent** (interface) `interface WrenConsent { consentId: number; address: string; state: string; changedAt: Date; }`
- **planTopic** (function) `(o: { consents: WrenConsent[]; subscribers: ListmonkSubscriber[]; listId: number; }): TopicPlan`
- **syncTopic** (function) `(o: { lm: Listmonk; topic: string; publicName?: string | null; consents: WrenConsent[]; withdraw: (c: { consentId: number; address: string }) => Promise<unknown>; }): Promise<TopicSync>`
- **topicTag** (function) `(topic: string): string`

## packages/channel-email/src/outreach/compose.ts

- **ComposeOptions** (interface) `interface ComposeOptions { readonly niche: string; readonly fill?: Filler; readonly sequence: Sequence; readonly offer: string; readonly offerFacts?: Readonly<Record<string, string>>; readonly site?: string | null; readonly templates: ReadonlyMap<string, Template>; readonly verificationHorizonDays: number; readonly senders: readonly string[]; readonly signatures?: Readonly<Record<string, string>>; readonly trackOpens?: boolean; readonly factsView?: string | null; readonly limit?: number | null; readonly autoApprove?: boolean; readonly runId?: string | null; readonly kind?: ComposeKind; readonly where?: Readonly<Record<string, string>>; readonly roleInboxNeedsVerdict?: boolean; readonly audience?: Audience; readonly recontact?: RecontactPolicy; readonly shared?: SharedSuppressions | null; }`
- **ComposeStats** (interface) `interface ComposeStats { enrolled: number; enrolled_person: number; enrolled_role_inbox: number; messages_drafted: number; auto_approved: number; facts_refused: number; skipped_no_address: number; skipped_suppressed: number; skipped_missing_facts: number; skipped_where: number; skipped_address_done: number; skipped_already_enrolled: number; skipped_lead_busy: number; flagged_possible_duplicate: number; }`
- **EligiblePerson** (interface) `interface EligiblePerson { readonly personId: number; readonly companyId: number; readonly fullName: string | null; readonly title: string | null; readonly roleRank: number; readonly companyName: string | null; readonly companyDomain: string | null; readonly email: string | null; readonly suppressed: boolean; readonly wouldEnroll: boolean; }`
- **bestReachableFirst** (function) `(groups: Iterable<R[]>, addressable: ReadonlySet<number>): R[][]`
- **compose** (function) `(db: Queryable, opts: ComposeOptions): Promise<ComposeStats>`
- **eligibleRoleInboxes** (function) `(db: Queryable, opts: ListingOptions & { excludeCompanies?: ReadonlySet<number>; needsVerdict?: boolean; }): Promise<EligibleRoleInbox[]>`
- **isUniqueViolation** (function) `(err: unknown): boolean`
- **linkFacts** (function) `(site: string | null, offer: string, values: Readonly<FactRow>, offerFacts: Readonly<Record<string, string>>, code: string): Record<string, string>`
- **mintLinkCode** (function) `(): string`
- **mintOpenToken** (function) `(): string`
- **nextToEnroll** (function) `(db: Queryable, opts: { niche: string; verificationHorizonDays: number; companies?: number | null }): Promise<number[]>`
- **signed** (function) `(body: string, signature: string): string`

## packages/channel-email/src/outreach/facts.ts

- **FactRow** (type) `type FactRow = Record<string, unknown>;`
- **Facts** (interface) `interface Facts { readonly values: Readonly<FactRow>; readonly refused: Readonly<FactRow>; readonly filed?: Readonly<FactRow>; }`
- **factsFor** (function) `(db: Queryable, personId: number, factsView: string | null): Promise<Facts>`
- **factsForCompany** (function) `(db: Queryable, companyId: number, factsView: string | null): Promise<Facts>`
- **personFacts** (function) `(db: Queryable, personId: number): Promise<FactRow>`
- **sentenceReady** (function) `(facts: Readonly<FactRow>): Facts`

## packages/channel-email/src/outreach/fills.ts

- **CASUAL_COMPANY** (const) `"You turn a company name, as filed in a registry or a listing, into what people call the firm in a casual email.\n\nAnswer with JSON only: {\"name\": \"...\", \"short\": \"...\"}\n\nname: the firm's name as people say it.\n- Drop legal forms (Inc, LLC, Ltd, Corp, Co, PLLC, LLP, PC), ® and ™, locatio…`
- **CASUAL_PERSON** (const) `"You read a contact as filed in a lead list and give the first name to greet them by, as in \"Hi ___,\".\n\nAnswer with JSON only: {\"first\": \"...\"}\n\n- Their first name in normal case: \"JOHN\" is \"John\", \"mckenzie\" is \"McKenzie\".\n- If the first-name field is junk (a job title, an email …`
- **Filler** (interface) `interface Filler { fill(facts: Facts, templates: Iterable<Template>): Promise<Facts>; warm(rows: readonly Facts[], templates: Iterable<Template>): Promise<void>; }`
- **SLOT** (const) `"You write one short phrase that goes inside a sentence of a cold email a person wrote by hand. Follow the instruction.\n\nAnswer with JSON only: {\"text\": \"...\"}\n\n- Plain words, the way someone would say it out loud. No marketing words, no exclamation marks, no emoji, no quotes, no dashes.\n- …`
- **checkCompanyName** (function) `(input: string, out: string, maxWords: number): string | null`
- **checkFirstName** (function) `(input: string, out: string): string | null`
- **checkSlot** (function) `(prompt: string, out: string): string | null`
- **makeFiller** (function) `(db: Queryable, llm: LlmClient): Filler`
- **promptVersion** (function) `(kind: FillKind): string`
- **requestsFor** (function) `(facts: Facts, templates: Iterable<Template>): FillRequest[]`
- **resolvePrompt** (function) `(prompt: string, values: Readonly<FactRow>): string | null`

## packages/channel-email/src/outreach/live.ts

- **copyGap** (function) `(sequence: Sequence, live: ReadonlyMap<string, Template>, offerFacts: Readonly<Record<string, string>> = {}): string | null`
- **liveEmails** (function) `(db: Queryable, niche: string, names?: readonly string[]): Promise<Map<string, Template>>`

## packages/channel-email/src/outreach/plan.ts

- **EnrollmentRule** (interface) `interface EnrollmentRule { readonly sequence: string; readonly where?: Readonly<Record<string, string>>; readonly audience?: Audience; }`
- **enrollmentPlan** (function) `(rules: readonly EnrollmentRule[], known: ReadonlySet<string>, where: string): readonly EnrollmentRule[]`
- **ruleCovers** (function) `(rule: EnrollmentRule, audience: Audience): boolean`

## packages/channel-email/src/outreach/provenance.ts

- **AddressRecord** (interface) `interface AddressRecord { readonly email: string; readonly evidence: string; readonly lead_id: number | null; readonly candidate_id: number | null; readonly pattern: string | null; readonly source_ref: string | null; readonly verification_id: number | null; readonly verification_result: string | null; readonly verified_at: string | null; readonly verifier: string | null; readonly pick_enrichment_id: number | null; readonly pick_method: string | null; readonly extraction_enrichment_id: number | null; readonly document_id: number | null; readonly source_url: string | null; }`
- **describeAddress** (function) `(address: Partial<Record<string, unknown>> | null | undefined, opts: { brief?: boolean } = {}): string`
- **peopleWithAddress** (function) `(db: Queryable, personIds: readonly number[], horizonDays: number): Promise<Set<number>>`
- **personAddressIn** (function) `(db: Queryable, addressable: ReadonlySet<number>, personId: number, horizonDays: number): Promise<PersonAddress>`
- **roleInboxAddress** (function) `(db: Queryable, ref: RoleInboxRef): Promise<AddressRecord>`

## packages/channel-email/src/outreach/readable.ts

- **TITLE_MAX_CHARS** (const) `80`
- **readableCompany** (function) `(value: unknown): string | null`
- **readableCount** (function) `(value: unknown): string | null`
- **readableMoney** (function) `(value: unknown): string | null`
- **readablePersonName** (function) `(value: unknown): string | null`
- **readableTitle** (function) `(value: unknown): string | null`
- **shortCompany** (function) `(value: unknown): string | null`

## packages/channel-email/src/outreach/refresh.ts

- **RefreshStats** (interface) `interface RefreshStats { checked: number; kept_started_or_inactive: number; rerendered: number; tokens_changed: number; kept_unrenderable: number; kept_current: number; raced: number; }`
- **refreshQueue** (function) `(db: Queryable, opts: RefreshOptions): Promise<RefreshStats>`

## packages/channel-email/src/outreach/review.ts

- **DraftRow** (interface) `interface DraftRow { id: number; enrollmentId: number; step: number; to: string; addressVia: string; template: string; duplicate: string; subject: string | null; firstLine: string; }`
- **approveMessages** (function) `(db: Queryable, selector: ApproveSelector, now: Date = new Date()): Promise<ApproveResult>`
- **editMessage** (function) `(db: Queryable, id: number, edited: { subject: string | null; body: string }, now: Date = new Date()): Promise<number | null>`
- **editableText** (function) `(subject: string | null, body: string): string`
- **listDrafts** (function) `(db: Queryable, opts: { enrollmentId?: number; flagged?: boolean } = {}): Promise<DraftRow[]>`
- **parseEditable** (function) `(text: string, opts: { riding: boolean }): { subject: string | null; body: string }`
- **rejectMessages** (function) `(db: Queryable, ids: number[], reason: RejectReason, note: string | null = null): Promise<number>`
- **stopByHand** (function) `(db: Queryable, target: { enrollmentId: number } | { companyDomain: string }, reason: StopReason, detail: string | null = null, now: Date = new Date()): Promise<StopOutcome>`

## packages/channel-email/src/outreach/sequences.ts

- **Sequence** (interface) `interface Sequence { readonly name: string; readonly steps: readonly SequenceStep[]; readonly arm: string | null; }`
- **armOf** (function) `(templateName: string): string | null`
- **sequence** (function) `(name: string, steps: readonly SequenceStep[]): Sequence`
- **sequenceStep** (function) `(templateName: string, day: number): SequenceStep`
- **threeEmailSequence** (function) `(opener: string, followup: string, finalFollowup: string, opts: { name?: string; days?: readonly [number, number, number] } = {}): Sequence`
- **twoEmailSequence** (function) `(opener: string, followup: string, opts: { name?: string; days?: readonly [number, number] } = {}): Sequence`

## packages/channel-email/src/recontact.ts

- **AUDIENCES** (const) `readonly Audience[]`
- **Audience** (type) `type Audience = "first_contact" | "returning";`
- **ContactOutcome** (type) `type ContactOutcome = RestingOutcome | (typeof BLOCKING_OUTCOMES)[number];`
- **DEFAULT_RECONTACT** (const) `RecontactPolicy`
- **RESTING_OUTCOMES** (const) `readonly ["no_reply", "not_now", "not_interested", "wrong_person", "referral", "bounced"]`
- **RecontactOverrides** (interface) `interface RecontactOverrides { readonly restDays?: Partial<Record<RestingOutcome, number | null>>; readonly perYear?: number; }`
- **RecontactPolicy** (interface) `interface RecontactPolicy { readonly restDays: Readonly<Record<RestingOutcome, number | null>>; readonly perYear: number; }`
- **audienceGate** (function) `(company: SQL, audience: Audience, policy: RecontactPolicy, pitch: Pitch | null = null): SQL`
- **doneAddresses** (function) `(db: Queryable): Promise<Set<string>>`
- **recontactPolicy** (function) `(overrides: RecontactOverrides = {}, where = "recontact"): RecontactPolicy`

## packages/channel-email/src/records.ts

- **callRecord** (const) `RecordType`
- **emailRecords** (function) `(roster: readonly Sender[], policy: SendPolicy): RecordType[]`
- **firmRecord** (const) `RecordType`
- **inboxRecord** (function) `(roster: readonly Sender[], env: SendPolicy): RecordType`
- **modelRecord** (const) `RecordType`
- **replyRecord** (const) `RecordType`
- **stallRecord** (const) `RecordType`

## packages/channel-email/src/report/schedule.ts

- **REPORT_HOUR** (const) `19`
- **nextReportAt** (function) `(policy: SendPolicy, now: Date): Date`
- **untilNextReport** (function) `(policy: SendPolicy, now: Date): number`

## packages/channel-email/src/report/send.ts

- **WeeklyReportStats** (interface) `interface WeeklyReportStats extends Record<string, unknown> { reportId: number; periodStart: string; periodEnd: string; sent: number; replies: number; mailedTo: string | null; body: string; }`
- **previousWeekly** (function) `(db: Db, before: Date): Promise<WeeklyStats | null>`
- **runWeeklyReport** (function) `(deps: WeeklyReportDeps): Promise<WeeklyReportStats>`

## packages/channel-email/src/report/variants.ts

- **variantOutcomes** (function) `(db: Queryable, niche?: string): Promise<VariantOutcome[]>`
- **variantTexts** (function) `(name: string, source: string): { texts: Map<string, string[]>; subject: Set<string>; }`

## packages/channel-email/src/report/weekly.ts

- **Counts** (interface) `interface Counts { sent: number; openers: number; replies: number; interested: number; hardBounces: number; unsubscribes: number; complaints: number; }`
- **Pause** (interface) `interface Pause { sender: string; domain: string; reason: string; pausedAt: string; }`
- **Pool** (interface) `interface Pool { approved: number; drafts: number; activeEnrollments: number; openersPerSendDay: number; sendDaysLeft: number | null; }`
- **WeeklyStats** (interface) `interface WeeklyStats { periodStart: string; periodEnd: string; headline: SliceStats<"campaign">; byNiche: SliceStats<{ niche: string }>[]; byArm: SliceStats<{ niche: string; arm: string }>[]; domains: ReportDomain[]; pauses: Pause[]; replies: ReplyLine[]; pool: Pool; }`
- **ZERO** (const) `Counts`
- **collectWeekly** (function) `(db: Queryable, opts: CollectOptions): Promise<WeeklyStats>`
- **mondayLine** (function) `(s: WeeklyStats): string`
- **renderWeekly** (function) `(s: WeeklyStats, previous: WeeklyStats | null = null): string`

## packages/channel-email/src/resolution/listed.ts

- **runListedContacts** (function) `(db: Queryable, niche: string): Promise<ListedContactsStats>`
- **settledBy** (function) `(status: LeadStatus): CandidateState | null`

## packages/channel-email/src/resolution/service.ts

- **BuildCandidatesStats** (interface) `interface BuildCandidatesStats extends Record<string, number> { people_seen: number; scraped: number; derived: number; guessed: number; no_usable_names: number; }`
- **COMMON_GUESS_RANKS** (const) `3`
- **DEFAULT_DOMAIN_BUDGET** (const) `5`
- **Ledger** (interface) `interface Ledger { by_verifier: Array<[string, number]>; top_domains: Array<[string, number]>; }`
- **PromotionRef** (interface) `interface PromotionRef { candidateId: number; verificationId: number; }`
- **QueueOptions** (interface) `interface QueueOptions { domain?: string | null; companySourceKey?: string | null; companyDomain?: string | null; niche?: string | null; limitPeople?: number | null; }`
- **QueueStats** (interface) `interface QueueStats extends Record<string, number> { people_queued: number; candidates_queued: number; suppressed_skipped: number; }`
- **ResolutionStats** (interface) `interface ResolutionStats { domains_processed: number; credits_spent: number; valid: number; invalid: number; risky: number; catch_all: number; promoted: number; patterns_proven: number; catch_all_domains: number; pattern_unknown_domains: number; deferred_domains: number; dead_domains: number; people_unresolved: number; email_collisions: number; dead_pattern_candidates_pruned: number; stranded_repaired: number; suppressed_skipped: number; aborted: string | null; }`
- **addResolutionStats** (function) `(total: ResolutionStats, delta: ResolutionStats): ResolutionStats`
- **buildCandidates** (function) `(db: Queryable, opts: { limitPeople?: number } = {}): Promise<BuildCandidatesStats>`
- **domainKnowledge** (function) `(db: Queryable, domain: string): Promise<DomainKnowledge>`
- **emptyResolutionStats** (function) `(): ResolutionStats`
- **ledger** (function) `(db: Queryable): Promise<Ledger>`
- **promoteCandidates** (function) `(db: Queryable, refs: PromotionRef[]): Promise<void>`
- **queueCandidates** (function) `(db: Queryable, opts: QueueOptions = {}): Promise<QueueStats>`
- **resolveDomainUnit** (function) `(db: Queryable, verifier: EmailVerifier, domain: string, opts: DomainUnitOptions): Promise<DomainUnitResult>`
- **runResolution** (function) `(db: Queryable, verifier: EmailVerifier, opts: ResolutionOptions = {}): Promise<ResolutionStats>`
- **selectNewResolutionTargets** (function) `(db: Queryable, opts: { limit: number; niche?: string; retryRiskyAfterDays?: number; domainBudget?: number }): Promise<string[]>`
- **selectResolutionTargets** (function) `(db: Queryable): Promise<string[]>`
- **strandedPromotions** (function) `(db: Queryable): Promise<PromotionRef[]>`

## packages/channel-email/src/restate/bounce-scheduler.ts

- **BounceScheduler** (type) `type BounceScheduler = ReturnType<typeof makeBounceScheduler>;`
- **GONE** (const) `"not connected to read: its late bounces can't be read"`
- **SEND_ONLY** (const) `"connected to send only: its bounces can't be read"`
- **makeBounceScheduler** (function) `(deps: BounceSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<BouncePassStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<BouncePassStats>>; start: (ctx: …`
- **readAllBounces** (function) `(d: BounceSchedulerDeps, now: Date): Promise<BouncePassStats>`

## packages/channel-email/src/restate/call-bookings.ts

- **CallBookings** (type) `type CallBookings = ReturnType<typeof makeCallBookings>;`
- **makeCallBookings** (function) `(deps: { db: Db; clientDb?: ((client: string) => Db) | null; fire?: FireTriggers; }): restate.ServiceDefinition<"CallBookings", { ingest: (ctx: restate.Context, body: unknown) => Promise<BookingOutcome | null>; ingestFor: (ctx: restate.Context, req: { client: string; body: unknown; }) => Promise<BookingOutcome | null>; }>`

## packages/channel-email/src/restate/clicks-scheduler.ts

- **CLICKS_KEY** (const) `"fleet"`
- **CLICKS_SYNC_COMMAND** (const) `"outreach clicks sync"`
- **ClicksScheduler** (type) `type ClicksScheduler = ReturnType<typeof makeClicksScheduler>;`
- **makeClicksScheduler** (function) `(deps: ClicksSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<ClickSyncStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<ClickSyncStats>>; start: (ctx: re…`

## packages/channel-email/src/restate/compose-scheduler.ts

- **Campaign** (interface) `interface Campaign { readonly niche: string; readonly plan: readonly EnrollmentRule[]; readonly mailsRoleInboxes: boolean; readonly sequences: ReadonlyMap<string, Sequence>; readonly offers: ReadonlyMap<string, string>; readonly offerFacts: ReadonlyMap<string, Readonly<Record<string, string>>>; readonly site?: string | null; readonly factsView: string | null; readonly senders: readonly string[]; readonly ramps?: RampMap; readonly signatures: Readonly<Record<string, string>>; readonly companyLocation: (company: Company) => string | null; readonly recontact: RecontactPolicy; readonly fill?: Filler; }`
- **ComposeScheduler** (type) `type ComposeScheduler = ReturnType<typeof makeComposeScheduler>;`
- **TopUpStats** (interface) `interface TopUpStats { niche: string; refresh: RefreshStats; timezones: TimezoneFillStats; capacity_per_day: number; queued: number; target: number; shortfall: number; enrolled: number; messages_drafted: number; passes: { sequence: string; audience: Audience; stats: ComposeStats }[]; skipped: { sequence: string; why: string }[]; exhausted: boolean; }`
- **dailyOpenerCapacity** (function) `(policy: SendPolicy, niche: string, senders: readonly string[], now: Date, ramps?: RampMap): number`
- **makeComposeScheduler** (function) `(deps: ComposeSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<TopUpStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<TopUpStats>>; start: (ctx: restate.Ob…`
- **queuedOpeners** (function) `(db: Db, niche: string): Promise<number>`
- **refreshCampaign** (function) `(db: Db, campaign: Campaign, trackOpens: boolean, staleOnly = false): Promise<RefreshStats>`
- **topUp** (function) `(db: Db, campaign: Campaign, opts: { policy: SendPolicy; now: Date; daysAhead: number; verificationHorizonDays: number; trackOpens: boolean; roleInboxNeedsVerdict: boolean; runId: string | null; shared?: SharedSuppressions | null; }): Promise<TopUpStats>`

## packages/channel-email/src/restate/console.ts

- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids: (string | number)[]; }`
- **emailConsoleApi** (function) `({ db, senders, policy, clients }: EmailConsoleDeps): { callsOf(req: CallsRequest): Promise<{ client: string | null; on: import("drizzle-orm/postgres-js").PostgresJsDatabase<Record<string, unknown>> & { $client: import(".pnpm/postgres@3.4.9/node_modules/postgres").Sql<{}>; }; ids: number[]; by: string; }>; recordsTypes: (req: PortalRequest) => Promise<…`
- **makeEmailConsole** (function) `(deps: EmailConsoleDeps): restate.ServiceDefinition<"EmailConsole", { answers: (_: restate.Context, req: PortalRequest) => Promise<{ id: number; state: "proposed" | "dropped" | "booked" | "booking" | "sent" | "already_booked" | "needs_you"; email: string; start: Date | null; timeZone: string | null; detail: string | null; cr…`

## packages/channel-email/src/restate/digest-scheduler.ts

- **DIGEST_HOUR** (const) `7`
- **DigestScheduler** (type) `type DigestScheduler = ReturnType<typeof makeDigestScheduler>;`
- **makeDigestScheduler** (function) `(deps: DigestSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<DigestStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<DigestStats>>; start: (ctx: restate.…`
- **nextDigestAt** (function) `(policy: SendPolicy, now: Date): Date`
- **rampSummary** (function) `(policy: SendPolicy, ramps: RampMap, now: Date): string | null`

## packages/channel-email/src/restate/disposition.ts

- **DISPOSITION_COMMAND** (const) `"outreach inbox classify"`
- **DISPOSITION_KEY** (const) `"fleet"`
- **Disposition** (type) `type Disposition = ReturnType<typeof makeDisposition>;`
- **Invites** (interface) `interface Invites { calendar: Calendar; notifier?: Notifier | null; copies?: ReadonlyMap<string, ReplyCopy> | null; send?: Omit<SendReplyOptions, "now"> | null; niches?: readonly string[] | null; }`
- **makeDisposition** (function) `(deps: DispositionDeps): restate.VirtualObjectDefinition<"Disposition", { classify: (ctx: restate.ObjectContext) => Promise<ClassifyOutcome>; approve: (ctx: restate.ObjectContext, req: { id: number; body?: string | null; }) => Promise<ApproveOutcome>; reply: (ctx: restate.ObjectContext, req: { threadEventId: number; body: s…`

## packages/channel-email/src/restate/inbox-scheduler.ts

- **INBOX_SYNC_COMMAND** (const) `"outreach inbox sync"`
- **InboxPush** (type) `type InboxPush = typeof inboxPush;`
- **InboxScheduler** (type) `type InboxScheduler = ReturnType<typeof makeInboxScheduler>;`
- **inboxPush** (const) `restate.VirtualObjectDefinition<"InboxPush", { claim: (ctx: restate.ObjectContext, key: string) => Promise<void>; listen: (ctx: restate.ObjectContext, l: PushListener) => Promise<void>; notify: (ctx: restate.ObjectSharedContext) => Promise<void>; }>`
- **makeInboxScheduler** (function) `(deps: InboxSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<SyncStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<SyncStats>>; start: (ctx: restate.Obje…`

## packages/channel-email/src/restate/listmonk.ts

- **ListmonkIntake** (type) `type ListmonkIntake = ReturnType<typeof makeListmonkIntake>;`
- **ListmonkMail** (type) `type ListmonkMail = ReturnType<typeof makeListmonkMail>;`
- **ListmonkSync** (type) `type ListmonkSync = ReturnType<typeof makeListmonkSync>;`
- **SYNC_EVERY_MS** (const) `3600000`
- **SyncDeps** (interface) `interface SyncDeps { db: Db; lm: Listmonk; }`
- **makeListmonkIntake** (function) `(): restate.ServiceDefinition<"ListmonkIntake", { post: (ctx: restate.Context, m: ListmonkMessage) => Promise<{ ok: true; }>; }>`
- **makeListmonkMail** (function) `(deps: IssueMailer): restate.VirtualObjectDefinition<"ListmonkMail", { send: (ctx: restate.ObjectContext, m: ListmonkMessage) => Promise<IssueSent>; }>`
- **makeListmonkSync** (function) `(deps: { db: Db; lm: Listmonk | null; everyMs?: number }): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<SyncStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<SyncStats>>; start: (ctx: restate.Obje…`
- **syncAllTopics** (function) `(d: SyncDeps): Promise<SyncStats>`
- **syncTopicByName** (function) `(d: SyncDeps, name: string): Promise<number>`
- **SyncStats** (interface) `interface SyncStats extends Record<string, unknown> { topics: TopicSync[]; }`

## packages/channel-email/src/restate/marketing.ts

- **Change** (type) `type Change = | { topic: string; on: boolean } | { frequency: Frequency } | { pause: 30 | 90 | null } | { everything: true } | { undo: number };`
- **Marketing** (type) `type Marketing = ReturnType<typeof makeMarketing>;`
- **makeMarketing** (function) `(deps: { db: Db; shared: string | null; site: string; send: ((m: PlainMail) => Promise<void>) | null; clientDb?: (id: string) => Db; }): restate.ServiceDefinition<"Marketing", { signUp: (ctx: restate.Context, req: SignUpRequest) => Promise<{ ok: true; }>; confirm: (ctx: restate.Context, req: Visit & { token: string; }) => Promise<{ ok: boolean; prefs: { channel: "email" | "sms"; topic: string | null; named: string | null; from: strin…`

## packages/channel-email/src/restate/newsletter.ts

- **Issue** (interface) `interface Issue { topic: string; slug: string; subject: string; text: string; url: string; test?: string; }`
- **IssueMailer** (interface) `interface IssueMailer { db: Db; shared: string | null; site: string; from: string | null; postal: string | null; send: ((m: PlainMail) => Promise<void>) | null; }`
- **IssueSent** (type) `type IssueSent = { messageId: string } | { skip: string };`
- **Newsletter** (type) `type Newsletter = ReturnType<typeof makeNewsletter>;`
- **deliverIssue** (function) `(d: IssueMailer, o: { issueKey: string; topic: string; consentId: number; address: string; build: (wrap: IssueWrap) => PlainMail; }): Promise<IssueSent>`
- **issueBody** (function) `(issue: Pick<Issue, "text" | "url">): string`
- **issueMail** (function) `(o: { issue: Issue; to: string; footer: string; headers: [string, string][]; test?: boolean; tags?: LinkTags | null; }): PlainMail`
- **issueTags** (function) `(db: Db, slug: string): Promise<LinkTags | null>`
- **makeNewsletter** (function) `(deps: IssueMailer & { listmonk?: Listmonk | null; syncTopic?: (topic: string) => Promise<number>; }): restate.VirtualObjectDefinition<"Newsletter", { send: (ctx: restate.ObjectContext, issue: Issue) => Promise<IssueRun>; }>`
- **recordIssueSend** (function) `(db: Db, o: { consentId: number; issueKey: string; slug: string; messageId: string; evidence?: Record<string, unknown>; }): Promise<void>`
- **testAllowed** (function) `(address: string, from: string): boolean`

## packages/channel-email/src/restate/opens-scheduler.ts

- **OPENS_KEY** (const) `"fleet"`
- **OpensScheduler** (type) `type OpensScheduler = ReturnType<typeof makeOpensScheduler>;`
- **makeOpensScheduler** (function) `(deps: OpensSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<OpenSyncStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<OpenSyncStats>>; start: (ctx: rest…`

## packages/channel-email/src/restate/placement-scheduler.ts

- **CHECK_AFTER_MS** (const) `number`
- **Landing** (interface) `interface Landing { landed: Placement; auth: AuthResults | null; }`
- **NO_DRAFT** (const) `"no draft yet"`
- **PLACEMENT_KEY** (const) `"fleet"`
- **PLAIN_NOTES** (const) `readonly { subject: string; body: string }[]`
- **PlacementScheduler** (type) `type PlacementScheduler = ReturnType<typeof makePlacementScheduler>;`
- **landedAt** (function) `(sites: SiteClient, seed: string, messageId: string): Promise<Landing>`
- **landedFrom** (function) `(labelIds: readonly string[]): Placement`
- **makePlacementScheduler** (function) `(deps: PlacementSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<PlacementStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<PlacementStats>>; start: (ctx: re…`
- **placementLines** (function) `(db: Db, senders: readonly string[], now: Date): Promise<{ lines: string[]; trouble: string[] }>`
- **plainNote** (function) `(day: string): { subject: string; body: string }`
- **sendPlacements** (function) `(deps: Omit<PlacementSchedulerDeps, "sitesFor">, now: Date): Promise<Pick<PlacementStats, "sent" | "noDraft" | "failed">>`

## packages/channel-email/src/restate/pool-scheduler.ts

- **FeedStats** (interface) `interface FeedStats { niche: string; model_stages: ModelStages; stages: StageOutcome[]; progress: number; failed: number; }`
- **PROBE_WIDTH** (const) `32`
- **STAGES** (const) `readonly ["adLibrary", "exaSearch", "youtubeSearch", "triggers", "fbGroups", "discover", "verify", "crawl", "render", "scan", "contacts", "extract", "pick", "applyPicks", "resolveMailboxes", "verifyMailboxes", "team", "youtube", "instagram", "profiles", "signals"]`
- **Stage** (type) `type Stage = (typeof STAGES)[number];`
- **Wired** (type) `type Wired = Partial<Record<WiredStage, boolean>>;`
- **makePoolScheduler** (function) `(deps: PoolSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<FeedStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<FeedStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) => P…`
- **progressOf** (const) `Record<Stage, (s: Record<string, number>) => number>`
- **stageEnabled** (function) `(stage: Stage, modelStages: ModelStages, freeVerifier = false, wired: Wired = {}): boolean`
- **stagesToRun** (function) `(settings: PoolSettings | null, modelStages: ModelStages, freeVerifier = false, wired: Wired = {}): Set<Stage>`

## packages/channel-email/src/restate/postmaster-scheduler.ts

- **POSTMASTER_KEY** (const) `"fleet"`
- **PostmasterScheduler** (type) `type PostmasterScheduler = ReturnType<typeof makePostmasterScheduler>;`
- **clientPostmaster** (function) `(main: Queryable, id: string): Promise<ClientPostmaster>`
- **domainsOf** (function) `(raw: string | undefined): string[]`
- **makePostmasterScheduler** (function) `(deps: PostmasterSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<PostmasterStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<PostmasterStats>>; start: (ctx: …`
- **untilNextLocalDay** (function) `(policy: SendPolicy, now: Date): number`

## packages/channel-email/src/restate/queue-refresh.ts

- **QueueRefresh** (type) `type QueueRefresh = ReturnType<typeof makeQueueRefresh>;`
- **makeQueueRefresh** (function) `(deps: QueueRefreshDeps): restate.ServiceDefinition<"QueueRefresh", { all: (ctx: restate.Context) => Promise<Record<string, RefreshStats>>; }>`

## packages/channel-email/src/restate/report-scheduler.ts

- **ReportScheduler** (type) `type ReportScheduler = ReturnType<typeof makeReportScheduler>;`
- **makeReportScheduler** (function) `(deps: ReportSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<WeeklyReportStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<WeeklyReportStats>>; start: (c…`

## packages/channel-email/src/restate/resolution.ts

- **RESOLUTION_KEY** (const) `"default"`
- **Resolution** (type) `type Resolution = ReturnType<typeof makeResolution>;`
- **makeResolution** (function) `(deps: ResolutionDeps): restate.VirtualObjectDefinition<"Resolution", { build: (ctx: restate.ObjectContext, input?: { limitPeople?: number; } & ClientInput) => Promise<import("../resolution/service.js").BuildCandidatesStats>; queue: (ctx: restate.ObjectContext, input?: QueueOptions & ClientInput) => Promise<import("../reso…`

## packages/channel-email/src/restate/send-scheduler.ts

- **NO_SCOPE** (const) `"no send scope for this key: sending is off or the mailbox is gone"`
- **SendScheduler** (type) `type SendScheduler = ReturnType<typeof makeSendScheduler>;`
- **SendScope** (interface) `interface SendScope { db: Db; policy: SendPolicy; fleet: Fleet; pixelBaseUrl?: string | null; calendar?: Calendar | null; shared?: SharedSuppressions | null; }`
- **TickStats** (type) `type TickStats = SendStats & { newPauses: number };`
- **makeSendScheduler** (function) `(deps: SendSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<"tick", (ctx: restate.ObjectContext) => Promise<PassOutcome<TickStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<TickStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) => …`
- **nextDelay** (function) `(policy: SendPolicy, stats: SendStats, now: Date, nextSendAt: Date | null, tickMs: number): number`
- **oneScope** (function) `(scope: SendScope): ((key: string) => Promise<SendScope>)`

## packages/channel-email/src/schema.ts

- **APPROVAL_SOURCES** (const) `readonly ["operator", "auto", "client"]`
- **ApprovalSource** (type) `type ApprovalSource = (typeof APPROVAL_SOURCES)[number];`
- **AuthResults** (interface) `interface AuthResults { spf: string | null; dkim: string | null; dmarc: string | null; }`
- **BOUNCE_CLASSES** (const) `readonly ["hard", "soft"]`
- **BounceClass** (type) `type BounceClass = (typeof BOUNCE_CLASSES)[number];`
- **CALL_BOOKING_STATES** (const) `readonly ["booked", "cancelled"]`
- **CALL_INVITE_STATES** (const) `readonly ["proposed", "booking", "booked", "sent", "already_booked", "needs_you", "dropped"]`
- **CALL_RECORDING_BY** (const) `readonly ["desk", "manual"]`
- **CANDIDATE_EVIDENCE** (const) `readonly ["scraped", "derived_pattern", "guessed_pattern", "crm"]`
- **CANDIDATE_STATES** (const) `readonly ["candidate", "queued", "verified", "rejected"]`
- **CallBooking** (type) `type CallBooking = typeof callBookings.$inferSelect;`
- **CallBookingState** (type) `type CallBookingState = (typeof CALL_BOOKING_STATES)[number];`
- **CallBriefRow** (type) `type CallBriefRow = typeof callBriefs.$inferSelect;`
- **CallInvite** (type) `type CallInvite = typeof callInvites.$inferSelect;`
- **CallInviteState** (type) `type CallInviteState = (typeof CALL_INVITE_STATES)[number];`
- **CallRecordingRow** (type) `type CallRecordingRow = typeof callRecordings.$inferSelect;`
- **CampaignControlRow** (type) `type CampaignControlRow = typeof campaignControls.$inferSelect;`
- **CandidateEvidence** (type) `type CandidateEvidence = (typeof CANDIDATE_EVIDENCE)[number];`
- **CandidateState** (type) `type CandidateState = (typeof CANDIDATE_STATES)[number];`
- **ClickSync** (type) `type ClickSync = typeof clickSyncs.$inferSelect;`
- **ContactCandidate** (type) `type ContactCandidate = typeof contactCandidates.$inferSelect;`
- **DISPOSITION_SOURCES** (const) `readonly ["rule", "operator", "llm"]`
- **DispositionSource** (type) `type DispositionSource = (typeof DISPOSITION_SOURCES)[number];`
- **ENROLLMENT_KINDS** (const) `readonly ["person", "role_inbox"]`
- **ENROLLMENT_STATES** (const) `readonly ["active", "finished", "stopped"]`
- **EmailClickRow** (type) `type EmailClickRow = typeof emailClicks.$inferSelect;`
- **Enrollment** (type) `type Enrollment = typeof enrollments.$inferSelect;`
- **EnrollmentKind** (type) `type EnrollmentKind = (typeof ENROLLMENT_KINDS)[number];`
- **EnrollmentState** (type) `type EnrollmentState = (typeof ENROLLMENT_STATES)[number];`
- **FILL_KINDS** (const) `readonly ["company", "person", "slot"]`
- **InboxSync** (type) `type InboxSync = typeof inboxSyncs.$inferSelect;`
- **LEAD_CHECK_KINDS** (const) `readonly ["mailbox_fits_name", "domain_is_firm", "works_there", "title_agrees", "page_is_firm", "phone_agrees"]`
- **LEAD_CHECK_RESULTS** (const) `readonly ["pass", "fail", "unknown"]`
- **LeadCheck** (type) `type LeadCheck = typeof leadChecks.$inferSelect;`
- **LeadCheckKind** (type) `type LeadCheckKind = (typeof LEAD_CHECK_KINDS)[number];`
- **LeadCheckResult** (type) `type LeadCheckResult = (typeof LEAD_CHECK_RESULTS)[number];`
- **MESSAGE_STATES** (const) `readonly ["draft", "approved", "rejected", "sending", "sent", "skipped", "failed", "unknown"]`
- **Message** (type) `type Message = typeof messages.$inferSelect;`
- **MessageState** (type) `type MessageState = (typeof MESSAGE_STATES)[number];`
- **NewClickSync** (type) `type NewClickSync = typeof clickSyncs.$inferInsert;`
- **NewContactCandidate** (type) `type NewContactCandidate = typeof contactCandidates.$inferInsert;`
- **NewEmailClickRow** (type) `type NewEmailClickRow = typeof emailClicks.$inferInsert;`
- **NewEnrollment** (type) `type NewEnrollment = typeof enrollments.$inferInsert;`
- **NewInboxSync** (type) `type NewInboxSync = typeof inboxSyncs.$inferInsert;`
- **NewMessage** (type) `type NewMessage = typeof messages.$inferInsert;`
- **NewOpenEvent** (type) `type NewOpenEvent = typeof openEvents.$inferInsert;`
- **NewOpenSync** (type) `type NewOpenSync = typeof openSyncs.$inferInsert;`
- **NewPostmasterDay** (type) `type NewPostmasterDay = typeof postmasterDays.$inferInsert;`
- **NewReport** (type) `type NewReport = typeof reports.$inferInsert;`
- **NewSenderPause** (type) `type NewSenderPause = typeof senderPauses.$inferInsert;`
- **NewThreadEvent** (type) `type NewThreadEvent = typeof threadEvents.$inferInsert;`
- **NewVerification** (type) `type NewVerification = typeof verifications.$inferInsert;`
- **OpenEvent** (type) `type OpenEvent = typeof openEvents.$inferSelect;`
- **OpenSync** (type) `type OpenSync = typeof openSyncs.$inferSelect;`
- **PAUSE_SOURCES** (const) `readonly ["kill_switch", "operator", "placement"]`
- **PLACEMENTS** (const) `readonly ["inbox", "promotions", "spam", "missing"]`
- **PROBE_KINDS** (const) `readonly ["plain", "real"]`
- **PauseSource** (type) `type PauseSource = (typeof PAUSE_SOURCES)[number];`
- **Placement** (type) `type Placement = (typeof PLACEMENTS)[number];`
- **PlacementCheck** (type) `type PlacementCheck = typeof placementChecks.$inferSelect;`
- **PostmasterDay** (type) `type PostmasterDay = typeof postmasterDays.$inferSelect;`
- **ProbeKind** (type) `type ProbeKind = (typeof PROBE_KINDS)[number];`
- **REJECT_REASONS** (const) `readonly ["wrong_fact", "too_salesy", "generic_opener", "bad_tone", "wrong_person", "bad_address", "other"]`
- **REPLY_DISPOSITIONS** (const) `readonly ["interested", "meeting_booked", "not_interested", "not_now", "wrong_person", "referral", "other"]`
- **REPORT_KINDS** (const) `readonly ["weekly"]`
- **RejectReason** (type) `type RejectReason = (typeof REJECT_REASONS)[number];`
- **ReplyDisposition** (type) `type ReplyDisposition = (typeof REPLY_DISPOSITIONS)[number];`
- **Report** (type) `type Report = typeof reports.$inferSelect;`
- **STOP_REASONS** (const) `readonly ["reply", "bounce", "opt_out", "complaint", "manual", "undeliverable", "booked"]`
- **SenderPause** (type) `type SenderPause = typeof senderPauses.$inferSelect;`
- **StopReason** (type) `type StopReason = (typeof STOP_REASONS)[number];`
- **THREAD_EVENT_KINDS** (const) `readonly ["reply", "bounce", "auto_reply", "unsubscribe", "complaint", "note"]`
- **ThreadEvent** (type) `type ThreadEvent = typeof threadEvents.$inferSelect;`
- **ThreadEventKind** (type) `type ThreadEventKind = (typeof THREAD_EVENT_KINDS)[number];`
- **VERIFICATION_RESULTS** (const) `readonly ["valid", "invalid", "risky", "catch_all"]`
- **Verification** (type) `type Verification = typeof verifications.$inferSelect;`
- **VerificationResult** (type) `type VerificationResult = (typeof VERIFICATION_RESULTS)[number];`
- **callBookings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "call_bookings"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "call_bookings"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **callBriefs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "call_briefs"; schema: undefined; columns: { callBookingId: import("drizzle-orm/pg-core").PgColumn<{ name: "call_booking_id"; tableName: "call_briefs"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; no…`
- **callInvites** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "call_invites"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "call_invites"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **callRecordings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "call_recordings"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "call_recordings"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **campaignControls** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "campaign_controls"; schema: undefined; columns: { campaign: import("drizzle-orm/pg-core").PgColumn<{ name: "campaign"; tableName: "campaign_controls"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true;…`
- **candidateMints** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "candidate_mints"; schema: undefined; columns: { personId: import("drizzle-orm/pg-core").PgColumn<{ name: "person_id"; tableName: "candidate_mints"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNu…`
- **clickSyncs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "click_syncs"; schema: undefined; columns: { baseUrl: import("drizzle-orm/pg-core").PgColumn<{ name: "base_url"; tableName: "click_syncs"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefaul…`
- **contactCandidates** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "contact_candidates"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "contact_candidates"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefa…`
- **emailClicks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "email_clicks"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "email_clicks"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **enrollments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "enrollments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "enrollments"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **fills** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "fills"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "fills"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: f…`
- **inboxSyncs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "inbox_syncs"; schema: undefined; columns: { sender: import("drizzle-orm/pg-core").PgColumn<{ name: "sender"; tableName: "inbox_syncs"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: …`
- **leadChecks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "lead_checks"; schema: undefined; columns: { leadId: import("drizzle-orm/pg-core").PgColumn<{ name: "lead_id"; tableName: "lead_checks"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; ha…`
- **messages** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "messages"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "messages"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`
- **openEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "open_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "open_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **openSyncs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "open_syncs"; schema: undefined; columns: { baseUrl: import("drizzle-orm/pg-core").PgColumn<{ name: "base_url"; tableName: "open_syncs"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault:…`
- **placementChecks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "placement_checks"; schema: undefined; columns: { sender: import("drizzle-orm/pg-core").PgColumn<{ name: "sender"; tableName: "placement_checks"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; ha…`
- **postmasterDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "postmaster_days"; schema: undefined; columns: { domain: import("drizzle-orm/pg-core").PgColumn<{ name: "domain"; tableName: "postmaster_days"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasD…`
- **reports** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reports"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reports"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKe…`
- **senderPauses** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sender_pauses"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sender_pauses"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **threadEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "thread_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "thread_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **verifications** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "verifications"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "verifications"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`

## packages/channel-email/src/send/call-times.ts

- **CALL_TIMES** (const) `"{call.times}"`
- **FLEET_ZONE** (const) `"America/New_York"`
- **LOOKAHEAD_MS** (const) `number`
- **fillCallTimes** (function) `(body: string, open: readonly Date[] | null, zone: string | null, now: Date): { body: string; offered: Date[] }`
- **firstOfferDay** (function) `(sendDay: string): string`
- **pickTimes** (function) `(open: readonly Date[], zone: string, now: Date): Date[]`
- **sayTimes** (function) `(times: readonly Date[], zone: string): string`
- **weekdaysAfter** (function) `(day: string, n: number): string`

## packages/channel-email/src/send/campaign-controls.ts

- **CampaignChange** (interface) `interface CampaignChange { campaign: string; killSwitch?: boolean | null | undefined; openersPerDay?: number | null | undefined; }`
- **campaignPolicy** (function) `(db: Queryable, policy: SendPolicy): Promise<SendPolicy>`
- **loadCampaignControls** (function) `(db: Queryable): Promise<CampaignControlRow[]>`
- **setCampaignControl** (function) `(db: Queryable, base: SendPolicy, change: CampaignChange, by: string): Promise<CampaignControlRow>`

## packages/channel-email/src/send/dates.ts

- **ClockTime** (interface) `interface ClockTime { readonly hour: number; readonly minute: number; }`
- **PlainDate** (class) `constructor(readonly year: number, readonly month: number, readonly day: number); fromIso(text: string): PlainDate; utcDayOf(at: Date): PlainDate; weekday(): number; addDays(n: number): PlainDate; daysUntil(other: PlainDate): number; compare(other: PlainDate): number; equals(other: PlainDate): boolean; toString(): string`
- **addBusinessDays** (function) `(start: PlainDate, days: number, holiday: (day: PlainDate) => boolean = () => false): PlainDate`
- **formatClock** (function) `(t: ClockTime): string`
- **minutesOfDay** (function) `(t: ClockTime): number`

## packages/channel-email/src/send/deliver.ts

- **LIVE** (const) `readonly ["draft", "approved", "failed"]`
- **RampMap** (type) `type RampMap = Readonly<Record<string, Ramp>>;`
- **SendDueOptions** (interface) `interface SendDueOptions { transport: Transport; policy: SendPolicy; now?: Date; rng?: Rng; limit?: number | null; runId?: string | null; fromNames?: NameMap | null; signatureHtml?: StringMap | null; pages?: StringMap | null; pixelBaseUrl?: string | null; calendar?: Calendar | null; senders?: readonly string[] | null; ramps?: RampMap | null; reconcileFirst?: boolean; shared?: SharedSuppressions | null; onSent?: (enrollmentId: number, step: number) => void; }`
- **SendStats** (type) `type SendStats = Record<StatKey, number>;`
- **emptySendStats** (function) `(): SendStats`
- **lockSender** (function) `(tx: Queryable, sender: string): Promise<void>`
- **mintMessageId** (function) `(sender: string): string`
- **nextSendAt** (function) `(db: Queryable, policy: SendPolicy, senders: readonly string[], now: Date, ramps?: RampMap | null): Promise<Date | null>`
- **recordStop** (function) `(db: Queryable, enrollment: Enrollment, reason: StopReason, opts: { detail?: string | null; now?: Date; messages?: Message[]; shared?: SharedSuppressions | null; } = {}): Promise<number>`
- **sendDue** (function) `(db: Db, opts: SendDueOptions): Promise<SendStats>`
- **stopCompany** (function) `(db: Queryable, opts: { companyId: number; reason: StopReason; detail?: string | null; now?: Date; shared?: SharedSuppressions | null; }): Promise<number>`
- **todaysSends** (function) `(db: Queryable, policy: SendPolicy, now: Date): Promise<{ sentToday: Map<string, number>; openersToday: number; nicheOpeners: Map<string, number>; }>`

## packages/channel-email/src/send/gmail.ts

- **GMAIL_LIMIT_MS** (const) `number`
- **GmailClient** (class) `constructor(opts: GmailClientOptions)`
- **GmailTransport** (class) `readonly name; constructor(private readonly client: GmailClient); send(email: OutgoingEmail): Promise<SendReceipt>; find(sender: string, messageId: string): Promise<SendReceipt | null>`
- **PlainMail** (interface) `interface PlainMail { to: string; subject: string; text: string; headers?: readonly (readonly [string, string])[]; messageId?: string; attachments?: readonly MailFile[]; }`
- **plainMailer** (function) `(gmail: GmailClient, o: { mailbox: string; from: string; name: string }): (m: PlainMail) => Promise<void>`

## packages/channel-email/src/send/holidays.ts

- **HolidayCalendar** (type) `type HolidayCalendar = (typeof HOLIDAY_CALENDARS)[number];`
- **holidayOn** (function) `(calendars: ReadonlySet<HolidayCalendar>, day: PlainDate): string | null`
- **holidaysIn** (function) `(calendars: Iterable<HolidayCalendar>, year: number): ReadonlyMap<string, string>`
- **parseHolidayCalendars** (function) `(raw: string, key: string): ReadonlySet<HolidayCalendar>`
- **windowEnd** (function) `(start: PlainDate, days: number, calendars: ReadonlySet<HolidayCalendar>): PlainDate`

## packages/channel-email/src/send/lead-timezone.ts

- **TimezoneFillStats** (interface) `interface TimezoneFillStats { candidates: number; resolved: number; unresolved: number; }`
- **ZONE_BY_REGION** (const) `Readonly<Record<string, string>>`
- **fillTimezones** (function) `(db: Queryable, opts: { niche: string; locationOf: (company: Company) => string | null }): Promise<TimezoneFillStats>`
- **timezoneForLocation** (function) `(location: string | null | undefined): string | null`

## packages/channel-email/src/send/mailboxes.ts

- **Mailbox** (interface) `interface Mailbox { readonly smtp: Login; readonly imap: Login; }`
- **Mailboxes** (type) `type Mailboxes = ReadonlyMap<string, Mailbox>;`
- **loadMailboxes** (function) `(path: string | undefined): Map<string, Mailbox>`
- **parseMailboxes** (function) `(text: string, where: string): Map<string, Mailbox>`

## packages/channel-email/src/send/mime.ts

- **buildMime** (function) `(email: OutgoingEmail, opts: { now?: Date; boundary?: string } = {}): Buffer`
- **formatAddress** (function) `(rawName: string | null, address: string): string`

## packages/channel-email/src/send/policy.ts

- **EPOCH** (const) `Date`
- **Ramp** (interface) `interface Ramp { readonly start: PlainDate; readonly from: number; readonly step: number; readonly ceiling: number; readonly warmupStart?: PlainDate | null; }`
- **SendPolicy** (class) `readonly timezone: string;; readonly days: ReadonlySet<number>;; readonly holidays: ReadonlySet<HolidayCalendar>;; readonly windowStart: ClockTime;; readonly windowEnd: ClockTime;; readonly leadWindowStart: ClockTime | null;; readonly leadWindowEnd: ClockTime | null;; readonly perInboxCeiling: number;; readonly rampStart: PlainDate | null;; readonly rampFrom: number;; readonly rampStep: number;; readonly rampEverySendDays: number;; readonly warmupPerCold: number;; readonly warmupStep: number;; readonly warmupLimit: number;; readonly gapMinMs: number;; readonly gapMaxMs: number;; readonly newOpenersPerDay: number | null;; readonly nicheOpenersPerDay: ReadonlyMap<string, number>;; readonly killSwitchOffFor: ReadonlySet<string>;; readonly resendCooldownDays: number;; readonly reconcileGraceMs: number;; readonly bouncePauseRate: number;; readonly bouncePauseMinBounces: number;; readonly healthWindowMs: number;; constructor(fields: SendPolicyFields); fromSettings(s: SendPolicySettings): SendPolicy; withCampaigns(controls: readonly CampaignControl[]): SendPolicy; localNow(now: Date): { date: PlainDate; time: ClockTime; weekday: number }; localDay(now: Date): PlainDate; localDayBounds(now: Date): [Date, Date]; holidayOn(day: PlainDate): string | null; sendsOn(day: PlainDate): boolean; windowOpen(now: Date): boolean; nextWindowOpen(now: Date): Date; windowClose(now: Date): Date | null; leadWindowOpen(now: Date, leadZone: string | null): boolean; leadWindowMeetsFleetWindow(now: Date, leadZone: string): boolean; sendDaysElapsed(now: Date, ramp?: Ramp | null): number; perInboxCap(now: Date, ramp?: Ramp | null): number; warmupOn(now: Date, ramp?: Ramp | null): number | null; gapFor(rng: Rng): number; gapAfter(lastSent: Date, sentThatDay: number, ramp?: Ramp | null): number; earliestNextSend(lastSent: Date | null, sentThatDay: number, ramp?: Ramp | null): Date; nicheOpenerCap(niche: string): number | null; killSwitchOn(niche: string): boolean; describe(now?: Date): string`
- **SendPolicySettings** (interface) `interface SendPolicySettings { readonly sendTimezone: string; readonly sendDays: string; readonly sendHolidays: string; readonly sendWindowStart: string; readonly sendWindowEnd: string; readonly sendLeadWindowStart?: string | undefined; readonly sendLeadWindowEnd?: string | undefined; readonly coldSendsPerInboxPerDay: number; readonly coldSendsRampStart?: string | undefined; readonly coldSendsRampFrom: number; readonly coldSendsRampStep: number; readonly coldSendsRampEveryDays: number; readonly warmupPerCold?: number; readonly warmupStep?: number; readonly warmupLimit?: number; readonly sendGapMinMinutes: number; readonly sendGapMaxMinutes: number; readonly newOpenersPerDay?: number | undefined; readonly nicheOpenersPerDay?: string | undefined; readonly killSwitchOffFor?: string | undefined; readonly resendCooldownDays: number; readonly reconcileGraceMinutes: number; readonly bouncePauseRate: number; readonly bouncePauseMinBounces: number; readonly healthWindowDays: number; }`

## packages/channel-email/src/send/reconcile.ts

- **IN_FLIGHT** (const) `readonly ["sending", "unknown"]`
- **ReconcileStats** (interface) `interface ReconcileStats { reconciled_sent: number; reconciled_failed: number; pending: number; errors: number; transport_mismatch: number; }`
- **reconcile** (function) `(db: Db, opts: { transport: Transport; policy: SendPolicy; now: Date; onSent?: (enrollmentId: number, step: number) => void; }): Promise<ReconcileStats>`

## packages/channel-email/src/send/rng.ts

- **Rng** (interface) `interface Rng { int(low: number, high: number): number; }`
- **seededRng** (function) `(seed: number): Rng`
- **systemRng** (const) `Rng`

## packages/channel-email/src/send/roster.ts

- **RosterError** (class) `constructor(message: string)`
- **Sender** (interface) `interface Sender { readonly address: string; readonly niches: readonly string[] | null; readonly excludedNiches: readonly string[]; readonly suspended: boolean; readonly displayName: string | null; readonly signature: Signature | null; readonly transport: SenderTransport; readonly ramp: Ramp | null; readonly dkim: string | null; }`
- **Signature** (class) `constructor(readonly text: string, readonly html: string); forPage(page: string): Signature`
- **activeSenders** (function) `(roster: readonly Sender[], niche?: string | null): Sender[]`
- **loadRoster** (function) `(path: string, knownNiches?: ReadonlySet<string>, mailboxes?: ReadonlySet<string>): Sender[]`
- **parseRoster** (function) `(text: string, where: string, knownNiches?: ReadonlySet<string>, mailboxes?: ReadonlySet<string>): Sender[]`
- **senderDomain** (function) `(sender: Pick<Sender, "address">): string`

## packages/channel-email/src/send/smtp.ts

- **SmtpTransport** (class) `readonly name; constructor(private readonly mailbox: Mailbox, opts: SmtpTransportOptions = {}); send(email: OutgoingEmail): Promise<SendReceipt>; find(_sender: string, messageId: string): Promise<SendReceipt | null>`
- **threadOf** (function) `(rootMessageId: string): string`

## packages/channel-email/src/send/suppress.ts

- **ImportStats** (interface) `interface ImportStats { read: number; added: number; reasserted: number; invalid: number; emails: number; domains: number; invalid_values: string[]; }`
- **classifyValue** (function) `(value: string): [SuppressionKind, string]`
- **csvValues** (function) `(rows: readonly (readonly string[])[], opts: { column?: string | null; where?: string } = {}): string[]`
- **ensureSuppression** (function) `(db: Queryable, email: string, reason: StopReason, evidence?: Evidence, shared?: SharedSuppressions | null): Promise<Suppression | null>`
- **importValues** (function) `(db: Queryable, values: Iterable<string>, opts: { reason: SuppressionReason; evidence?: Evidence; dryRun?: boolean; checkpoint?: () => Promise<void> | void; }): Promise<ImportStats>`

## packages/channel-email/src/send/tick.ts

- **Fleet** (interface) `interface Fleet { readonly senders: readonly string[]; readonly domainFleet: readonly string[]; readonly fromNames: Readonly<Record<string, string | null>>; readonly signatureHtml: Readonly<Record<string, string>>; readonly pages: Readonly<Record<string, string>>; readonly ramps?: RampMap; }`
- **KillSwitches** (type) `type KillSwitches = ( db: Db, opts: { policy: SendPolicy; now: Date; senders: readonly string[]; runId: string | null }, ) => Promise<SenderPause[]>;`
- **TickOptions** (interface) `interface TickOptions { policy: SendPolicy; transport: Transport; now: Date; runId: string | null; fleet: Fleet; pixelBaseUrl?: string | null; calendar?: Calendar | null; limit?: number | null; reconcileFirst?: boolean; rng?: Rng; killSwitches?: KillSwitches; shared?: SharedSuppressions | null; }`
- **TickResult** (interface) `interface TickResult { stats: SendStats; newPauses: SenderPause[]; nextSendAt: Date | null; touches: Touch[]; }`
- **rosterFleet** (function) `(rosterAll: readonly Sender[], active: readonly Sender[], pages: Readonly<Record<string, string>> = {}): Fleet`
- **sendTick** (function) `(db: Db, opts: TickOptions): Promise<TickResult>`

## packages/channel-email/src/send/transport.ts

- **ConsoleTransport** (class) `readonly name; readonly mailbox; constructor(opts: ConsoleTransportOptions = {}); send(email: OutgoingEmail): Promise<SendReceipt>; find(sender: string, messageId: string): Promise<SendReceipt | null>`
- **ConsoleTransportOptions** (interface) `interface ConsoleTransportOptions { write?: (line: string) => void; refuse?: (email: OutgoingEmail) => Error | null; ambiguousAfter?: (email: OutgoingEmail) => boolean; findFails?: Error | null; }`
- **OutgoingEmail** (interface) `interface OutgoingEmail { readonly fromAddress: string; readonly fromName: string | null; readonly to: string; readonly subject: string | null; readonly replySubject: string | null; readonly body: string; readonly messageId: string; readonly inReplyTo?: string | null; readonly references?: readonly string[]; readonly threadId?: string | null; readonly signatureHtml?: string | null; readonly pixelUrl?: string | null; readonly linkCode?: string | null; readonly headers?: readonly (readonly [string, string])[]; }`
- **RoutedTransport** (class) `readonly name: string;; constructor(private readonly fallback: Transport, private readonly routes: ReadonlyMap<string, Transport>); carrier(sender: string): Transport; send(email: OutgoingEmail): Promise<SendReceipt>; find(sender: string, messageId: string): Promise<SendReceipt | null>`
- **SendReceipt** (interface) `interface SendReceipt { readonly messageId: string; readonly providerId: string; readonly threadId: string; readonly internalDate: Date | null; }`
- **Transport** (interface) `interface Transport { readonly name: string; send(email: OutgoingEmail): Promise<SendReceipt>; find(sender: string, messageId: string): Promise<SendReceipt | null>; carrier?(sender: string): Transport; }`
- **TransportAmbiguous** (class) `constructor(message: string, opts: { cause?: unknown } = {})`
- **TransportRefused** (class) `readonly senderLevel: boolean;; constructor(message: string, opts: { senderLevel?: boolean; cause?: unknown } = {})`
- **buildPixelUrl** (function) `(base: string | null | undefined, token: string | null | undefined): string | null`
- **carrierOf** (function) `(transport: Transport, sender: string): Transport`
- **fillPage** (function) `(form: string, page: string): string`
- **oneLine** (function) `(value: string): string`
- **renderedSubject** (function) `(email: OutgoingEmail): string`
- **toHtml** (function) `(body: string, signatureHtml?: string | null, pixel?: string | null, linkCode?: string | null): string`
- **visibleText** (function) `(html: string): string`
- **withLinkCode** (function) `(html: string, code: string | null | undefined): string`

## packages/channel-email/src/sequences-settings.ts

- **REPLIES** (const) `"email.replies"`
- **SEQUENCES** (const) `"email.sequences"`
- **SequencesSettings** (type) `type SequencesSettings = z.infer<typeof sequencesSettingsSchema>;`
- **repliesSettingsSchema** (const) `z.ZodObject<{}, z.core.$strict>`
- **sendingOverridesSchema** (const) `z.ZodPrefault<z.ZodObject<{ perInboxPerDay: z.ZodDefault<z.ZodNullable<z.ZodNumber>>; openersPerDay: z.ZodDefault<z.ZodNullable<z.ZodNumber>>; rampStart: z.ZodDefault<z.ZodNullable<z.ZodString>>; }, z.core.$strict>>`
- **sequencesSettingsSchema** (const) `z.ZodObject<{ niche: z.ZodDefault<z.ZodNullable<z.ZodString>>; senders: z.ZodDefault<z.ZodArray<z.ZodObject<{ address: z.ZodString; name: z.ZodString; signature: z.ZodDefault<z.ZodNullable<z.ZodString>>; suspended: z.ZodDefault<z.ZodBoolean>; }, z.core.$strict>>>; mailsRoleInboxes: z.ZodDefault<z.Zo…`

## packages/channel-email/src/sequences.ts

- **clientCampaign** (function) `(base: Campaign, settings: SequencesSettings): Campaign`
- **clientPolicy** (function) `(db: Db, settings: SequencesSettings, base: SendPolicy): Promise<SendPolicy>`
- **clientReplies** (function) `(main: Db, id: string): Promise<{ settings: SequencesSettings; calcom: string | null } | null>`
- **clientSequences** (function) `(main: Db, id: string): Promise<ClientSequences>`
- **sendPolicyFor** (function) `(settings: Sending, base: SendPolicy): SendPolicy`
- **senderFleet** (function) `(settings: Senders): Fleet`
- **sequencesSendScope** (function) `(deps: ClientScopeDeps, key: string): Promise<SendScope | null>`
- **sharedFor** (function) `(main: Db, client: string): SharedSuppressions`

## packages/channel-email/src/setups.ts

- **DOMAIN_SETUP** (const) `import("@wren/core/setup").Setup`
- **EMAIL_SETUPS** (const) `import("@wren/core/setup").Setup[]`
- **Warmup** (interface) `interface Warmup { start: Date; step: number; limit: number; }`
- **emailChecks** (function) `(o: { dbOf: (client: string | null) => Promise<Queryable>; warmupOf: (address: string) => Promise<Warmup | null>; signIn: (address: string) => Promise<SignedIn | null>; }): Record<string, SetupCheck>`

## packages/channel-email/src/spam/coverage.ts

- **coveringRenders** (function) `(tpl: Template, facts: FactValues): Rendered[]`

## packages/channel-email/src/spam/spamassassin.ts

- **SPAM_LIMIT** (const) `2`
- **SpamScore** (interface) `interface SpamScore { score: number; rules: SpamRule[]; }`
- **parseReport** (function) `(out: string): SpamScore`
- **startSpamd** (function) `(opts: { dockerDir: string; log?: (line: string) => void; }): Promise<Spamd>`

## packages/channel-email/src/state.ts

- **CANDIDATE_TRANSITIONS** (const) `TransitionTable<CandidateState>`
- **ENROLLMENT_TRANSITIONS** (const) `TransitionTable<EnrollmentState>`
- **MESSAGE_TRANSITIONS** (const) `TransitionTable<MessageState>`
- **transitionCandidate** (function) `(current: CandidateState, next: CandidateState): "rejected" | "verified" | "candidate" | "queued"`
- **transitionEnrollment** (function) `(current: EnrollmentState, next: EnrollmentState): "active" | "finished" | "stopped"`
- **transitionMessage** (function) `(current: MessageState, next: MessageState): "unknown" | "sent" | "draft" | "approved" | "rejected" | "sending" | "skipped" | "failed"`

## packages/channel-email/src/verification/checks.ts

- **CompanyPage** (interface) `interface CompanyPage { readonly id: number; readonly value: Record<string, unknown>; }`
- **LeadCheckInput** (interface) `interface LeadCheckInput { readonly email: string; readonly firmDomain: string | null; readonly person: (NamedPerson & { readonly title: string | null }) | null; readonly colleagues: readonly NamedPerson[]; readonly lookup: LookupFinding | null; readonly page: CompanyPage | null; readonly companyLookupState: string | null; readonly importPhone: unknown; }`
- **LookupFinding** (interface) `interface LookupFinding { readonly id: number; readonly kind: string; readonly confidence: number; readonly value: Record<string, unknown>; }`
- **MOVED_ON_CONFIDENCE** (const) `0.8`
- **NamedPerson** (interface) `interface NamedPerson { readonly id: number; readonly fullName: string; readonly firstName?: string | null; readonly lastName?: string | null; }`
- **checkLead** (function) `(input: LeadCheckInput): CheckOutcome[]`
- **domainIsFirm** (function) `(email: string, firmDomain: string | null): CheckOutcome`
- **mailboxFitsName** (function) `(email: string, person: NamedPerson | null, colleagues: readonly NamedPerson[]): CheckOutcome | null`
- **mailboxForms** (function) `(person: NamedPerson): Set<string>`
- **mailboxOf** (function) `(email: string): string`
- **pageIsFirm** (function) `(page: CompanyPage | null, firmDomain: string | null, lookupState: string | null): CheckOutcome`
- **phoneAgrees** (function) `(page: CompanyPage | null, importPhone: unknown): CheckOutcome`
- **titleAgrees** (function) `(heldTitle: string | null, newest: LookupFinding | null): CheckOutcome`
- **worksThere** (function) `(newest: LookupFinding | null): CheckOutcome`

## packages/channel-email/src/verification/domain-health.ts

- **DomainResolver** (interface) `interface DomainResolver extends Resolver { resolveNs(host: string): Promise<string[]>; resolveMx(host: string): Promise<{ exchange: string; priority: number }[]>; resolveTxt(host: string): Promise<string[][]>; }`
- **DomainTarget** (interface) `interface DomainTarget { domain: string; fleet: boolean; dkimSelector: string | null; smtpHost: string | null; }`
- **domainProblems** (function) `(h: DomainStanding): string[]`
- **domainStanding** (function) `(target: DomainTarget, resolver: DomainResolver = bounded()): Promise<DomainStanding>`
- **domainStandings** (function) `(targets: readonly DomainTarget[], resolver: DomainResolver = bounded()): Promise<DomainStanding[]>`
- **mailDomainTargets** (function) `(roster: readonly Sender[], mailboxes: Mailboxes, siteBaseUrl: string): DomainTarget[]`
- **namedDomains** (function) `(text: string): string[]`
- **readListAnswer** (function) `(list: DomainList, answer: string): "listed" | "refused" | null`

## packages/channel-email/src/verification/lead-checks.ts

- **recheckLeads** (function) `(db: Queryable, companyIds: readonly number[]): Promise<RecheckStats>`
- **recheckNiche** (function) `(db: Queryable, niche: string, opts: { chunk?: number; onChunk?: (s: RecheckStats) => void } = {}): Promise<RecheckStats>`

## packages/channel-email/src/verification/local.ts

- **LocalCheck** (interface) `interface LocalCheck { email: string; failure: string | null; flags: readonly LocalFlag[]; mxHosts: readonly string[]; mxPath: MxPath | null; passed: boolean; }`
- **LocalCheckerLike** (interface) `interface LocalCheckerLike { check(email: string): Promise<LocalCheck>; }`

## packages/channel-email/src/verification/mailifier.ts

- **ProbeFleet** (class) `readonly name; constructor(private readonly members: readonly FleetMember[], private readonly ready: Ready = async () => true, private readonly now: () => number = Date.now); verify(email: string): Promise<Verdict>`
- **ProbeVerifier** (class) `readonly name: string;; readonly authoritative; readonly costsCredits; constructor(private readonly probe: MailboxProbe); verify(email: string): Promise<Verdict>`
- **READY_TTL_MS** (const) `number`
- **Ready** (type) `type Ready = (host: string) => Promise<boolean>;`
- **defaultLocalChecker** (function) `(): LocalCheckerLike`
- **directProbeVerifier** (function) `(helo: string): EmailVerifier`
- **fleetOrder** (function) `(members: readonly T[], domain: string): T[]`
- **remoteProbeVerifier** (function) `(urls: string, token: string): EmailVerifier`

## packages/channel-email/src/verification/prober-health.ts

- **ProberHealth** (interface) `interface ProberHealth { host: string; ip: string | null; ptr: string | null; listed: string[]; checks: number; refused: number; held: number; }`
- **Resolver** (interface) `interface Resolver { resolve4(host: string): Promise<string[]>; reverse(ip: string): Promise<string[]>; }`
- **ipStanding** (function) `(host: string, resolver: Resolver = dns): Promise<Pick<ProberHealth, "ip" | "ptr" | "listed">>`
- **isListing** (function) `(list: string, answer: string): boolean`
- **proberHealth** (function) `(db: Db, hosts: readonly string[], since: Date, resolver: Resolver = dns): Promise<ProberHealth[]>`
- **proberHosts** (function) `(urls: string | null | undefined): string[]`
- **proberProblems** (function) `(h: ProberHealth): string[]`

## packages/channel-email/src/verification/retry.ts

- **SERVER_HOLD_REASONS** (const) `ReadonlySet<string>`
- **riskyBackoff** (function) `(row: { email: SQL; checkedAt: SQL; raw: SQL }, fallback: SQL): SQL`
- **riskyHolds** (function) `(v: string, fallback: SQL): SQL`
- **waitingDomains** (function) `(): SQL`

## packages/channel-email/src/verification/service.ts

- **VerificationStats** (interface) `interface VerificationStats { selected: number; local_invalid: number; local_errors: number; valid: number; invalid: number; risky: number; catch_all: number; held: number; flags: Record<string, number>; aborted: string | null; }`
- **latestValidCheckedAt** (function) `(): SQL<Date | null>`
- **runVerification** (function) `(db: Queryable, verifier: EmailVerifier, opts: VerificationOptions = {}): Promise<VerificationStats>`

## packages/channel-email/src/verification/verifier.ts

- **EmailVerifier** (interface) `interface EmailVerifier { name: string; authoritative: boolean; costsCredits: boolean; verify(email: string): Promise<Verdict>; }`
- **FakeVerifier** (class) `readonly name; readonly authoritative: boolean;; readonly costsCredits; constructor(opts: { authoritative?: boolean } = {}); verify(email: string): Promise<Verdict>`
- **Verdict** (interface) `interface Verdict { result: VerificationResult; raw: Record<string, unknown>; }`
- **makeVerifier** (function) `(name: string, env: VerifierEnv): Promise<EmailVerifier>`

## packages/channel-email/src/views.ts

- **EMAIL_CONSOLE_VIEWS** (const) `readonly ["pipeline_funnel", "pipeline_leaks", "campaign_funnel", "send_health", "reply_by_arm_step", "verification_yield"]`
- **EMAIL_COST_VIEWS** (const) `readonly ["email_stage_costs", "llm_usage_by_month"]`
- **campaignFunnel** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"campaign_funnel", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "campaign_funnel"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: …`
- **contactOutcomes** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"contact_outcomes", false, { enrollmentId: import("drizzle-orm/pg-core").PgColumn<{ name: "enrollment_id"; tableName: "contact_outcomes"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefa…`
- **emailLlmCalls** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"email_llm_calls", false, { enrichmentId: import("drizzle-orm/pg-core").PgColumn<{ name: "enrichment_id"; tableName: "email_llm_calls"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefaul…`
- **emailStageCosts** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"email_stage_costs", false, { runId: import("drizzle-orm/pg-core").PgColumn<{ name: "run_id"; tableName: "email_stage_costs"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey…`
- **enrollmentOutcomes** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"enrollment_outcomes", false, { enrollmentId: import("drizzle-orm/pg-core").PgColumn<{ name: "enrollment_id"; tableName: "enrollment_outcomes"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; h…`
- **funnelLatency** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"funnel_latency", false, { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "funnel_latency"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false…`
- **latestVerifications** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"latest_verifications", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "latest_verifications"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; i…`
- **leadSheet** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"lead_sheet", false, { leadId: import("drizzle-orm/pg-core").PgColumn<{ name: "lead_id"; tableName: "lead_sheet"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey…`
- **llmUsageByMonth** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"llm_usage_by_month", false, { month: import("drizzle-orm/pg-core").PgColumn<{ name: "month"; tableName: "llm_usage_by_month"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: false; hasDefault: false; isPri…`
- **openOutcomes** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"open_outcomes", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "open_outcomes"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: fals…`
- **pipelineFunnel** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"pipeline_funnel", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "pipeline_funnel"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: …`
- **pipelineLeaks** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"pipeline_leaks", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "pipeline_leaks"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: fa…`
- **rejectionsByReason** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"rejections_by_reason", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "rejections_by_reason"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPr…`
- **replyByArmStep** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"reply_by_arm_step", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "reply_by_arm_step"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryK…`
- **replyByEvidence** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"reply_by_evidence", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "reply_by_evidence"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryK…`
- **replyOutcomes** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"reply_outcomes", false, { eventId: import("drizzle-orm/pg-core").PgColumn<{ name: "event_id"; tableName: "reply_outcomes"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; is…`
- **reviewOutcomes** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"review_outcomes", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "review_outcomes"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: …`
- **sendHealth** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"send_health", false, { sender: import("drizzle-orm/pg-core").PgColumn<{ name: "sender"; tableName: "send_health"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false;…`
- **verificationYield** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"verification_yield", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "verification_yield"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimar…`

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

## packages/core/src/restate/form.ts

- **Effect** (type) `type Effect = "spends" | "sends" | "posts";`
- **Form** (interface) `interface Form { input?: z.ZodType; effect?: Effect; ingressPrivate?: true; }`
- **NO_INPUT** (const) `z.ZodPreprocess<z.ZodOptional<z.ZodObject<{}, z.core.$loose>>, unknown>`
- **PORTAL_FIELDS** (const) `{ viewer: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>; client: z.ZodOptional<z.ZodString>; asClient: z.ZodOptional<z.ZodBoolean>; }`
- **exclusiveHandler** (const) `<F>(form: Form, fn: F) => F`
- **formOptions** (function) `(form: Form): { ingressPrivate?: boolean; metadata?: { effect: Effect; }; input?: restate.Serde<unknown>; accept?: string; }`
- **handlerForm** (function) `(handler: unknown): Form | undefined`
- **serviceHandler** (const) `<F>(form: Form, fn: F) => F`
- **sharedHandler** (const) `<F>(form: Form, fn: F) => F`

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
- **errorText** (function) `(err: unknown): string`
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

## packages/core/src/schema.ts

- **NewTemplateVersion** (type) `type NewTemplateVersion = typeof templateVersions.$inferInsert;`
- **TemplateVersion** (type) `type TemplateVersion = typeof templateVersions.$inferSelect;`
- **templateVersions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "template_versions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "template_versions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefaul…`

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
- **Rule** (interface) `interface Rule { readonly fact: string; readonly pattern: string; readonly option: number; }`
- **fact** (function) `(facts: FactValues, key: string): unknown`
- **factText** (function) `(value: unknown): string | null`
- **pickOption** (function) `(picker: Picker, variant: string, eligible: readonly number[], seed: string, facts: FactValues, shares?: readonly number[]): number`
- **rule** (function) `(fact: string, pattern: string, option: number): Rule`
- **rulePick** (function) `(rules: readonly Rule[]): RulePick`

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
- **text** (function) `(value: string): TextBlock`
- **tidy** (function) `(input: string): string`
- **variantPoints** (function) `(blocks: readonly Block[]): Generator<VariantsBlock>`
- **variants** (function) `(name: string, options: readonly OptionInput[], picker: Picker = HASH_PICK, named = false): VariantsBlock`

## packages/core/src/stats.ts

- **Interval** (interface) `interface Interval { readonly low: number; readonly high: number; }`
- **formatRate** (function) `(successes: number, trials: number): string`
- **wilsonInterval** (function) `(successes: number, trials: number, z = Z_95): Interval`

## packages/core/src/suppress.ts

- **AddSuppressionInput** (interface) `interface AddSuppressionInput { kind: SuppressionKind; value: string; reason: SuppressionReason; evidence?: Evidence; }`
- **Evidence** (type) `type Evidence = Record<string, unknown> | null;`
- **addSuppression** (function) `(db: Queryable, input: AddSuppressionInput): Promise<{ row: Suppression; created: boolean }>`
- **liftSuppression** (function) `(db: Queryable, input: { kind: SuppressionKind; value: string; evidence?: Evidence; now?: Date }): Promise<Suppression | null>`
- **normalizeValue** (function) `(kind: SuppressionKind, value: string): string`

## packages/core/src/time.ts

- **assertInstant** (function) `(at: Date): Date`
- **canonicalZone** (function) `(zone: string): string | null`
- **dayEnd** (function) `(zone: string, at: Date): Date`
- **dayStart** (function) `(zone: string, at: Date): Date`
- **offsetMinutes** (function) `(zone: string, at: Date): number`
- **wallClock** (function) `(zone: string, at: Date): WallClock`
- **zonedInstant** (function) `(zone: string, year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date`
