# @wren/channel-email: interface

Exports: 840. Files: 118.

## node_modules/.pnpm/mailifier@0.3.9/node_modules/mailifier/dist/client.d.ts

- **RemoteProbeError** (class) `name: string;`

## packages/channel-email/src/calls/brief.ts

- **factLine** (function) `(f: Pick<Fact, "what" | "value">): string | null`
- **ownWords** (function) `(body: string): string`
- **gapQuestions** (function) `(b: Omit<CallBrief, "questions" | "built" | "model" | "top">): Question[]`
- **checkQuestions** (function) `(answer: string, facts: string, have: readonly string[], max: number = BRIEF_LIMITS.questions): string[]`
- **buildBrief** (function) `(db: Queryable, id: number, o: BuildOptions): Promise<CallBrief | null>`
- **saveBrief** (function) `(db: Queryable, brief: CallBrief): Promise<void>`
- **markSent** (function) `(db: Queryable, id: number, at: Date): Promise<void>`
- **briefOf** (function) `(db: Queryable, id: string, now = new Date()): Promise<StoredBrief | null>`
- **Cited** (interface) `interface Cited { text: string; source: string; href: string | null; at: string; }`
- **Question** (interface) `interface Question { text: string; from: "code" | "model"; }`
- **CallBrief** (interface) `interface CallBrief { call: { id: number; who: string; email: string | null; title: string | null; company: string | null; domain: string | null; start: string | null; offer: string | null; }; top: Cited[]; cameIn: Cited[]; thread: Cited[]; facts: Cited[]; posts: Cited[]; signals: Cited[]; site?: Cited[]; touches?: Cited[]; questions: Question[]; built: string; model: string | null; }`
- **factsText** (function) `(b: Omit<CallBrief, "questions" | "built" | "model" | "top">): string`
- **BuildOptions** (interface) `interface BuildOptions { now: Date; llm?: LlmClient | null; site?: ((email: string) => Promise<Cited[]>) | null; }`
- **StoredBrief** (interface) `interface StoredBrief { brief: CallBrief; saved: boolean; sentAt: string | null; recording?: RecordingNote | null; }`

## packages/channel-email/src/calls/outcome.ts

- **setCallOutcome** (function) `(db: Queryable, o: OutcomeAsk): Promise<MarkedCall[]>`
- **outcomeEmits** (function) `(marked: readonly MarkedCall[]): OutcomeEmit[]`
- **callSubject** (function) `(id: number): string`

## packages/channel-email/src/calls/recording.ts

- **upcomingCalls** (function) `(db: Queryable, now = new Date(), aheadH = 24): Promise<UpcomingCall[]>`
- **matchBooking** (function) `(db: Queryable, startedAt: Date): Promise<number | null>`
- **clock** (function) `(s: number): string`
- **writeNotes** (function) `(llm: LlmClient, transcript: string, who: string | null): Promise<{ notes: CallNotes; model: string } | null>`
- **recordingLine** (function) `(id: number, r: Pick<NewRecording, "startedAt" | "durationS" | "notes">): ElsewhereLine`
- **saveRecording** (function) `(db: Queryable, r: NewRecording): Promise<number>`
- **recordingOf** (function) `(db: Queryable, callBookingId: number): Promise<RecordingNote | null>`
- **Segment** (interface) `interface Segment { start: number; end: number; text: string; }`
- **transcriptOf** (function) `(segments: readonly Segment[]): string`
- **CALL_NOTES** (const) `z.ZodObject<{ summary: z.ZodString; needs: z.ZodArray<z.ZodString>; objections: z.ZodArray<z.ZodString>; next: z.ZodArray<z.ZodString>; }, z.core.$strip>`
- **CallNotes** (type) `type CallNotes = z.infer<typeof CALL_NOTES>;`
- **RecordingNote** (interface) `interface RecordingNote { id: number; startedAt: string; durationS: number; notes: CallNotes | null; }`

## packages/channel-email/src/calls/restate.ts

- **markOutcome** (function) `(ctx: restate.Context, db: Db, client: string | null, ask: { ids: readonly number[]; outcome: MeetingOutcome | null; reason?: string | null; by: string; }): Promise<{ changed: number; done: number[] }>`
- **makeCallBriefs** (function) `(deps: CallBriefsDeps): restate.ServiceDefinition<"CallBriefs", { build: (ctx: restate.Context, req: { client?: string | null; id: number; }) => Promise<{ built: boolean; }>; send: (ctx: restate.Context, req: SendAsk) => Promise<{ sent: boolean; why: string; } | { sent: boolean; why?: never; }>; }>`
- **bookedCall** (function) `(id: number, start: Date | string | null): ExecutorEvent`
- **bookingEmit** (function) `(o: { id: number; state: string; start: Date | string | null }): { workflow: string; from: string; events: ExecutorEvent[]; } | null`
- **bookingFired** (function) `(client: string | null, o: { id: number; state: "booked" | "cancelled"; enrollmentId?: number | null }, b: { start: Date | string | null; email: string | null; name: string | null; offer: string | null; }): Fired`
- **SendAsk** (interface) `interface SendAsk { client: string | null; id: number; start: string; }`
- **briefStep** (function) `(deps: BriefDeps & { queue(ask: SendAsk, delayMs: number, key: string): Promise<void>; now?: () => Date; }): Step`
- **briefPath** (function) `(client: string | null, id: number): string`
- **CallBriefs** (type) `type CallBriefs = ReturnType<typeof makeCallBriefs>;`

## packages/channel-email/src/calls/settings.ts

- **CALL_BRIEF** (const) `"calls.brief"`
- **CALL_OUTCOME** (const) `"calls.outcome"`
- **briefSettingsSchema** (const) `z.ZodObject<{ leadMinutes: z.ZodDefault<z.ZodNumber>; questions: z.ZodDefault<z.ZodBoolean>; ping: z.ZodDefault<z.ZodBoolean>; }, z.core.$strict>`
- **BriefSettings** (type) `type BriefSettings = z.infer<typeof briefSettingsSchema>;`
- **outcomeSettingsSchema** (const) `z.ZodObject<{ reasons: z.ZodDefault<z.ZodArray<z.ZodString>>; }, z.core.$strict>`
- **briefSettingsOf** (function) `(block: unknown): BriefSettings`
- **outcomeSettingsOf** (function) `(block: unknown): OutcomeSettings`

## packages/channel-email/src/calls/site.ts

- **landerVisits** (function) `(site: Site): (email: string) => Promise<Cited[]>`
- **landerVisitLines** (function) `(site: Site): (visitors: readonly string[]) => Promise<{ at: string; text: string; href: string | null }[]>`
- **landerHits** (function) `(site: Site): (visitor: string) => Promise<{ ts: string; page: string }[]>`
- **visitorsOf** (function) `(apps: readonly SiteApplication[], email: string): string[]`

## packages/channel-email/src/components.ts

- **INBOX_HEALTH** (const) `"email.inbox_health"`
- **EMAIL_TOUCH** (const) `"email.touch"`
- **EMAIL_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/channel-email/src/concurrent.ts

- **eachConcurrently** (function) `(items: readonly T[], width: number, work: (item: T) => Promise<void>, stopped: () => boolean = () => false): Promise<void>`

## packages/channel-email/src/console-routes.ts

- **EMAIL_CONSOLE_ROUTES** (const) `{ readonly answers: "read"; readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsGet: "read"; readonly recordsExport: "read"; readonly recordsStats: "read"; readonly dossier: "read"; readonly approve: "act"; readonly drop: "act"; readonly pause: "act"; readonly resume: "act";…`
- **EMAIL_CONSOLE_APPS** (const) `{ readonly "*": { readonly app: "outbound"; readonly channel: "email"; }; readonly answers: null; readonly recordsTypes: null; readonly recordsList: null; readonly recordsGet: null; readonly recordsExport: null; readonly recordsStats: null; readonly dossier: null; readonly callWon: "calls"; readonly…`
- **EMAIL_CONSOLE_WRITES** (const) `readonly EmailConsoleRoute[]`

## packages/channel-email/src/dossier.ts

- **emailFacts** (function) `(db: Queryable, companyIds: readonly number[], personIds: readonly number[]): Promise<MoreFacts>`

## packages/channel-email/src/follow.ts

- **emailCadence** (function) `(niche: string, seq: Sequence): Workflow`
- **executorTouches** (function) `(db: Queryable, sent: readonly (readonly [number, number])[]): Promise<Touch[]>`
- **release** (function) `(db: Queryable, enrollmentId: number, step: number, now: Date): Promise<"released" | "replied" | "ended">`
- **Touch** (interface) `interface Touch { workflow: string; from: string; event: ExecutorEvent; }`
- **AskFollowEmail** (type) `type AskFollowEmail = ( client: string | null, o: { subject: string; enrollmentId: number; body: string; by: string; why: string }, ) => Promise<{ asked: boolean; why: string | null }>;`
- **emailTouchStep** (function) `(dbFor: (client: string | null) => Db, ask: AskFollowEmail | null = null): Step`

## packages/channel-email/src/guards.ts

- **activeSuppression** (function) `(db: Queryable, email: string, shared?: SharedSuppressions | null): Promise<Suppression | null>`
- **activeSuppressions** (function) `(db: Queryable, emails: Iterable<string>, shared?: SharedSuppressions | null): Promise<(email: string) => Suppression | null>`
- **SharedSuppressions** (interface) `interface SharedSuppressions { readonly main: Queryable; readonly client: string; }`

## packages/channel-email/src/inbox/bookings.ts

- **bookingFromWebhook** (function) `(body: unknown): BookingEvent | null`
- **bookingFromList** (function) `(b: ListedBooking): BookingEvent | null`
- **applyBooking** (function) `(db: Db, e: BookingEvent, opts: { now: Date }): Promise<BookingOutcome>`
- **BookingChange** (type) `type BookingChange = "created" | "rescheduled" | "cancelled";`
- **BookingEvent** (interface) `interface BookingEvent { change: BookingChange; uid: string; fromUid: string | null; start: Date | null; bookedAt: Date | null; email: string | null; name: string | null; offer: string | null; code: string | null; }`
- **BookingOutcome** (interface) `interface BookingOutcome { id: number; state: "booked" | "cancelled"; enrollmentId: number | null; stopped: number; }`

## packages/channel-email/src/inbox/click-sync.ts

- **syncClicks** (function) `(db: Db, opts: SyncClicksOptions): Promise<ClickSyncStats>`
- **ClickSyncStats** (interface) `interface ClickSyncStats { fetched: number; coded: number; matched: number; unknown_code: number; unreadable: number; pages: number; }`

## packages/channel-email/src/inbox/clicks.ts

- **sitePage** (function) `(table: T, opts: SiteReadOptions): Promise<SiteTables[T][]>`
- **siteExport** (function) `(table: T, opts: SiteReadOptions): Promise<SiteTables[T][]>`
- **clickedEmails** (function) `(db: Queryable, opts: { limit?: number } = {}): Promise<ClickedEmail[]>`
- **clickFollowUps** (function) `(hits: readonly SiteHit[], applications: readonly SiteApplication[]): Map<string, ClickFollowUp>`
- **SITE_PAGE** (const) `5000`
- **SITE_MAX_PAGES** (const) `20`
- **SiteExportError** (class) `constructor(message: string)`
- **SiteHit** (interface) `interface SiteHit { id: number; ts: string; visitor: string | null; page: string; secs: number; cta: number; touched: number; r: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; ref?: string; }`
- **SiteApplication** (interface) `interface SiteApplication { id: number; ts: string; visitor: string | null; offer: string; fit: number; r: string; email?: string | null; first_touch?: string | null; last_touch?: string | null; }`
- **SiteReplay** (interface) `interface SiteReplay { id: number; view: string; visitor: string | null; page: string; started: string; last: string; chunks: number; bytes: number; w: number | null; country: string | null; capped: number; first_touch?: string | null; }`
- **SiteEvent** (interface) `interface SiteEvent { id: number; ts: string; view: string; visitor: string | null; page: string; name: string; props: string; }`
- **SiteAnswer** (interface) `interface SiteAnswer { id: number; ts: string; survey: string; visitor: string; view: string; page: string; value: string; }`
- **ClickedEmail** (interface) `interface ClickedEmail { code: string; pages: string[]; firstAt: Date; lastAt: Date; clicks: number; message: { id: number; step: number; niche: string; toEmail: string; company: string | null; sentAt: Date | null; } | null; }`
- **ClickFollowUp** (interface) `interface ClickFollowUp { visitors: number; views: number; secs: number; reachedForm: boolean; applied: { offer: string; fit: boolean; ts: string } | null; }`

## packages/channel-email/src/inbox/disposition.ts

- **route** (function) `(state: DispositionState): "classify" | "no_text"`
- **buildPrompt** (function) `(state: DispositionState): string`
- **ground** (function) `(state: DispositionState, step: Omit<DispositionResult, "verdict">): DispositionVerdict`
- **runGraph** (function) `(llm: LlmClient, state: DispositionState, opts: ClassifyOptions = {}): Promise<DispositionResult>`
- **pendingEvents** (function) `(db: Queryable, opts: { model: string; niche?: string | null; limit?: number | null }): Promise<ThreadEvent[]>`
- **gatherState** (function) `(db: Queryable, event: ThreadEvent): Promise<DispositionState>`
- **runDisposition** (function) `(db: Db, llm: LlmClient, opts: RunDispositionOptions = {}): Promise<DispositionStats>`
- **DISPOSITION_VERSION** (const) `"v1"`
- **STAGE_NAME** (const) `"reply_disposition"`
- **MIN_CONFIDENCE** (const) `0.6`
- **DispositionState** (interface) `interface DispositionState { event: DispositionEvent; ours: DispositionOurs; company: DispositionCompany; }`
- **proposalSchema** (const) `z.ZodObject<{ disposition: z.ZodString; evidence: z.ZodOptional<z.ZodNullable<z.ZodString>>; confidence: z.ZodOptional<z.ZodNullable<z.ZodNumber>>; reason: z.ZodOptional<z.ZodNullable<z.ZodString>>; }, z.core.$strip>`
- **Proposal** (type) `type Proposal = z.infer<typeof proposalSchema>;`
- **ClassifyOptions** (interface) `interface ClassifyOptions { runId?: string | null; tracer?: Tracer | null; }`
- **DispositionStats** (interface) `interface DispositionStats { selected: number; classified: number; labelled: number; ungrounded: number; no_text: number; parse_errors: number; provider_rejected: number; skipped_labelled_meanwhile: number; aborted: string | null; }`

## packages/channel-email/src/inbox/health.ts

- **domainOf** (function) `(sender: string): string`
- **activePauses** (function) `(db: Queryable): Promise<Map<string, SenderPause>>`
- **domainHealth** (function) `(db: Queryable, opts: { policy: SendPolicy; now: Date; senders: readonly string[] }): Promise<DomainHealth[]>`
- **evaluateKillSwitches** (function) `(db: Queryable, opts: { policy: SendPolicy; now: Date; senders: readonly string[]; runId?: string | null }): Promise<SenderPause[]>`
- **wouldTrip** (function) `(health: DomainHealth, policy: SendPolicy): string | null`
- **pause** (function) `(db: Queryable, opts: { target: string; reason: string; by: string; now: Date; senders: readonly string[] }): Promise<SenderPause[]>`
- **resume** (function) `(db: Queryable, opts: { target: string; by: string; now: Date; senders: readonly string[] }): Promise<SenderPause[]>`
- **resolveTarget** (function) `(target: string, senders: readonly string[]): string[]`
- **senderDays** (function) `(db: Queryable, opts: { since: string }): Promise<SenderDay[]>`
- **killSwitches** (const) `KillSwitches`

## packages/channel-email/src/inbox/inbound.ts

- **normalizeMessageId** (function) `(value: string): string`
- **messageIds** (function) `(raw: string | null): string[]`
- **bodyText** (function) `(msg: MimePart): string`
- **ownText** (function) `(msg: MimePart): string`
- **stripQuoted** (function) `(body: string): string`
- **mayBeBounce** (function) `(m: { fromAddress: string | null; fromName: string | null; subject: string | null; }): boolean`
- **classify** (function) `(raw: Uint8Array | string, opts: { ourMessageIds?: Iterable<string> } = {}): Inbound`
- **TEXT_MAX_CHARS** (const) `4000`
- **InboundKind** (type) `type InboundKind = (typeof INBOUND_KINDS)[number];`
- **InboundBounceClass** (type) `type InboundBounceClass = "hard" | "soft";`
- **Inbound** (interface) `interface Inbound { readonly kind: InboundKind; readonly bounceClass: InboundBounceClass | null; readonly bouncedAddress: string | null; readonly bounceStatus: string | null; readonly diagnostic: string | null; readonly messageId: string | null; readonly inReplyTo: string | null; readonly references: readonly string[]; readonly originalMessageId: string | null; readonly matchedMessageId: string | null; readonly matchedBy: MatchedBy | null; readonly fromAddress: string | null; readonly fromName: string | null; readonly subject: string | null; readonly date: Date | null; readonly autoSubmitted: string | null; readonly isAuto: boolean; readonly snippet: string | null; readonly text: string | null; }`

## packages/channel-email/src/inbox/instantly.ts

- **InstantlyTransport** (class) `readonly name; send(email: { fromAddress: string }): Promise<SendReceipt>; find(): Promise<SendReceipt | null>`

## packages/channel-email/src/inbox/invite.ts

- **ApproveOptions** (interface) `interface ApproveOptions extends SendReplyOptions { calendar: Calendar; body?: string | null; }`
- **ApproveOutcome** (type) `type ApproveOutcome = | { ok: true; state: CallInviteState; said: string | null; reply: ReplyOutcome | null } | { ok: false; state: CallInviteState; reason: string };`
- **approveInvite** (function) `(db: Db, id: number, opts: ApproveOptions): Promise<ApproveOutcome>`
- **dropInvite** (function) `(db: Db, id: number): Promise<CallInviteState>`
- **InviteStats** (interface) `interface InviteStats { selected: number; proposed: number; already_booked: number; needs_you: number; aborted: string | null; }`
- **openInvites** (function) `(db: Db): Promise<{ id: number; state: "proposed" | "dropped" | "booked" | "booking" | "sent" | "already_booked" | "needs_you"; email: string; start: Date | null; timeZone: string | null; detail: string | null; createdAt: Date; words: string | null; snippet: string | null; draft: string | null; }[]>`
- **RunInvitesOptions** (interface) `interface RunInvitesOptions { calendar: Calendar; notifier?: Notifier | null; copies?: ReadonlyMap<string, ReplyCopy> | null; runId?: string | null; tracer?: Tracer | null; now?: Date; niches?: readonly string[] | null; client?: string | null; }`
- **runInvites** (function) `(db: Db, llm: LlmClient, opts: RunInvitesOptions): Promise<InviteStats>`

## packages/channel-email/src/inbox/marketing-bounces.ts

- **readBounces** (function) `(db: Queryable, box: Mailbox, now: Date, onError?: (id: string, err: unknown) => void): Promise<BounceReadStats>`
- **BOUNCE_QUERY** (const) `string`
- **BounceReadStats** (interface) `interface BounceReadStats { mailbox: string; listed: number; kept: number; other: number; unmatched: number; soft: number; suppressed: number; mismatch: number; errors: number; }`

## packages/channel-email/src/inbox/opens.ts

- **syncOpens** (function) `(db: Db, opts: SyncOpensOptions): Promise<OpenSyncStats>`
- **PAGE** (const) `1000`
- **MAX_PAGES** (const) `50`
- **OpenSyncError** (class) `constructor(message: string)`
- **OpenSyncStats** (interface) `interface OpenSyncStats { fetched: number; stored: number; already_seen: number; unknown_token: number; pages: number; }`

## packages/channel-email/src/inbox/placement.ts

- **parseAuthResults** (function) `(header: string | null | undefined): AuthResults`
- **authFailures** (function) `(auth: AuthResults): string[]`
- **verdictOf** (function) `(plain: Tally, real: Tally): PlacementVerdict`
- **placementSummary** (function) `(d: DomainPlacement): string`
- **placementTrouble** (function) `(d: DomainPlacement, now: Date): string[]`
- **placementVerdicts** (function) `(db: Queryable, opts: { now: Date; senders: readonly string[] }): Promise<DomainPlacement[]>`
- **evaluatePlacement** (function) `(db: Db, opts: { now: Date; senders: readonly string[] }): Promise<PlacementChanges>`
- **WINDOW_DAYS** (const) `2`
- **MIN_PAUSE_DAYS** (const) `7`
- **Tally** (interface) `interface Tally { inbox: number; landed: number; }`
- **DomainPlacement** (interface) `interface DomainPlacement { domain: string; senders: string[]; plain: Tally; real: Tally; auth: string[]; verdict: PlacementVerdict; pausedAt: Date | null; }`

## packages/channel-email/src/inbox/postmaster.ts

- **registeredDomains** (function) `(client: PostmasterClient): Promise<string[]>`
- **syncPostmaster** (function) `(db: Db, opts: SyncPostmasterOptions): Promise<PostmasterStats>`
- **API** (const) `"https://gmailpostmastertools.googleapis.com/v2"`
- **METRICS** (const) `ReadonlyArray<readonly [MetricColumn, string, string | null]>`
- **PostmasterError** (class) `constructor(message: string)`
- **PostmasterClient** (interface) `interface PostmasterClient { fetch: FetchLike; token: string | (() => Promise<string>); sleep?: Sleep; }`
- **Day** (type) `type Day = string;`
- **PostmasterStats** (interface) `interface PostmasterStats { domains: number; domains_failed: number; days_with_data: number; days_without_data: number; rows_unparseable: number; stored: number; per_domain: Record<string, number>; failed: Record<string, string>; }`

## packages/channel-email/src/inbox/reply.ts

- **draftReply** (function) `(db: Queryable, copy: ReplyCopy, enrollment: Enrollment, event: ThreadEvent, extra: Readonly<Record<string, string>> = {}): Promise<Message | null>`
- **draftByHand** (function) `(db: Queryable, enrollment: Enrollment, event: ThreadEvent | null, body: string): Promise<Message>`
- **sendReply** (function) `(db: Db, messageId: number, event: ThreadEvent | null, enrollment: Enrollment, opts: SendReplyOptions & { body?: string | null }): Promise<ReplyOutcome>`
- **ReplyCopy** (interface) `interface ReplyCopy { readonly sequences: ReadonlyMap<string, Sequence>; readonly offerFacts: ReadonlyMap<string, Readonly<Record<string, string>>>; readonly site?: string | null; readonly factsView: string | null; readonly signatures: Readonly<Record<string, string>>; readonly fill?: Filler; }`
- **SendReplyOptions** (interface) `interface SendReplyOptions { transport: Transport; fleet: Pick<Fleet, "fromNames" | "signatureHtml" | "pages">; now?: Date; }`
- **ReplyOutcome** (type) `type ReplyOutcome = | { sent: true; message: Message } | { sent: false; message: Message; reason: string };`

## packages/channel-email/src/inbox/sync.ts

- **since** (function) `(cursorMs: number, opts: { now: Date; firstSyncLookbackMs: number; overlapMs: number }): Date`
- **syncInbox** (function) `(db: Db, opts: SyncInboxOptions): Promise<SyncStats>`
- **recordOperatorReply** (function) `(db: Queryable, opts: { enrollment: Enrollment; disposition: ReplyDisposition; note: string | null; fromAddress: string | null; now: Date; runId?: string | null; }): Promise<ThreadEvent>`
- **labelEvent** (function) `(db: Queryable, opts: { event: ThreadEvent; disposition: ReplyDisposition; now: Date; source?: DispositionSource; }): Promise<void>`
- **SyncStats** (interface) `interface SyncStats extends SyncCounts { senders: number; per_sender: Record<string, SyncCounts>; replied?: number[]; }`
- **DAY_MS** (const) `86400000`

## packages/channel-email/src/listmonk/campaign.ts

- **issueOf** (function) `(c: { uuid: string; name: string; tags?: string[] | null | undefined; }): IssueRef | null`
- **ensureTemplate** (function) `(lm: Listmonk): Promise<number>`
- **startCampaign** (function) `(lm: Listmonk, o: { listId: number; topic: string; slug: string; subject: string; body: string }): Promise<CampaignStart>`
- **MESSENGER** (const) `"wren"`
- **issueTag** (function) `(topic: string, slug: string): string`

## packages/channel-email/src/listmonk/client.ts

- **listmonk** (function) `(cfg: ListmonkConfig): { lists: () => Promise<{ [x: string]: unknown; id: number; name: string; tags?: string[] | null | undefined; }[]>; createList(o: { name: string; tags: string[]; }): Promise<{ [x: string]: unknown; id: number; name: string; tags?: string[] | null | undefined; }>; subscribers: () => Promise<{ [x: stri…`
- **ListmonkError** (class) `constructor(readonly status: number, message: string)`
- **ListmonkSubscriber** (type) `type ListmonkSubscriber = z.infer<typeof SUBSCRIBER>;`
- **ListmonkList** (type) `type ListmonkList = z.infer<typeof LIST>;`
- **ListmonkCampaign** (type) `type ListmonkCampaign = z.infer<typeof CAMPAIGN>;`
- **SettingsMap** (type) `type SettingsMap = Record<string, unknown>;`
- **Listmonk** (type) `type Listmonk = ReturnType<typeof listmonk>;`
- **escapeTemplate** (function) `(text: string): string`

## packages/channel-email/src/listmonk/setup.ts

- **settingsFor** (function) `(current: SettingsMap, o: SetupOptions): { settings: SettingsMap; unknown: string[] }`
- **applySetup** (function) `(lm: Listmonk, o: SetupOptions, wait = { tries: 30, gapMs: 1000 }): Promise<{ templateId: number; unknown: string[]; }>`

## packages/channel-email/src/listmonk/sync.ts

- **planTopic** (function) `(o: { consents: WrenConsent[]; subscribers: ListmonkSubscriber[]; listId: number; }): TopicPlan`
- **syncTopic** (function) `(o: { lm: Listmonk; topic: string; publicName?: string | null; consents: WrenConsent[]; withdraw: (c: { consentId: number; address: string }) => Promise<unknown>; }): Promise<TopicSync>`
- **topicTag** (function) `(topic: string): string`
- **WrenConsent** (interface) `interface WrenConsent { consentId: number; address: string; state: string; changedAt: Date; }`
- **TopicSync** (interface) `interface TopicSync extends Record<keyof TopicPlan, number> { topic: string; listId: number; }`

## packages/channel-email/src/outreach/compose.ts

- **bestReachableFirst** (function) `(groups: Iterable<R[]>, addressable: ReadonlySet<number>): R[][]`
- **nextToEnroll** (function) `(db: Queryable, opts: { niche: string; verificationHorizonDays: number; companies?: number | null }): Promise<number[]>`
- **eligibleRoleInboxes** (function) `(db: Queryable, opts: ListingOptions & { excludeCompanies?: ReadonlySet<number>; needsVerdict?: boolean; }): Promise<EligibleRoleInbox[]>`
- **compose** (function) `(db: Queryable, opts: ComposeOptions): Promise<ComposeStats>`
- **linkFacts** (function) `(site: string | null, offer: string, values: Readonly<FactRow>, offerFacts: Readonly<Record<string, string>>, code: string): Record<string, string>`
- **isUniqueViolation** (function) `(err: unknown): boolean`
- **ComposeOptions** (interface) `interface ComposeOptions { readonly niche: string; readonly fill?: Filler; readonly sequence: Sequence; readonly offer: string; readonly offerFacts?: Readonly<Record<string, string>>; readonly site?: string | null; readonly templates: ReadonlyMap<string, Template>; readonly verificationHorizonDays: number; readonly senders: readonly string[]; readonly signatures?: Readonly<Record<string, string>>; readonly trackOpens?: boolean; readonly factsView?: string | null; readonly limit?: number | null; readonly autoApprove?: boolean; readonly runId?: string | null; readonly kind?: ComposeKind; readonly where?: Readonly<Record<string, string>>; readonly roleInboxNeedsVerdict?: boolean; readonly audience?: Audience; readonly recontact?: RecontactPolicy; readonly shared?: SharedSuppressions | null; }`
- **ComposeStats** (interface) `interface ComposeStats { enrolled: number; enrolled_person: number; enrolled_role_inbox: number; messages_drafted: number; auto_approved: number; facts_refused: number; skipped_no_address: number; skipped_suppressed: number; skipped_missing_facts: number; skipped_where: number; skipped_address_done: number; skipped_already_enrolled: number; skipped_lead_busy: number; flagged_possible_duplicate: number; }`
- **EligiblePerson** (interface) `interface EligiblePerson { readonly personId: number; readonly companyId: number; readonly fullName: string | null; readonly title: string | null; readonly roleRank: number; readonly companyName: string | null; readonly companyDomain: string | null; readonly email: string | null; readonly suppressed: boolean; readonly wouldEnroll: boolean; }`
- **signed** (function) `(body: string, signature: string): string`
- **mintOpenToken** (function) `(): string`
- **mintLinkCode** (function) `(): string`

## packages/channel-email/src/outreach/facts.ts

- **sentenceReady** (function) `(facts: Readonly<FactRow>): Facts`
- **personFacts** (function) `(db: Queryable, personId: number): Promise<FactRow>`
- **factsFor** (function) `(db: Queryable, personId: number, factsView: string | null): Promise<Facts>`
- **factsForCompany** (function) `(db: Queryable, companyId: number, factsView: string | null): Promise<Facts>`
- **FactRow** (type) `type FactRow = Record<string, unknown>;`
- **Facts** (interface) `interface Facts { readonly values: Readonly<FactRow>; readonly refused: Readonly<FactRow>; readonly filed?: Readonly<FactRow>; }`

## packages/channel-email/src/outreach/fills.ts

- **checkCompanyName** (function) `(input: string, out: string, maxWords: number): string | null`
- **checkFirstName** (function) `(input: string, out: string): string | null`
- **checkSlot** (function) `(prompt: string, out: string): string | null`
- **requestsFor** (function) `(facts: Facts, templates: Iterable<Template>): FillRequest[]`
- **resolvePrompt** (function) `(prompt: string, values: Readonly<FactRow>): string | null`
- **makeFiller** (function) `(db: Queryable, llm: LlmClient): Filler`
- **CASUAL_COMPANY** (const) `"You turn a company name, as filed in a registry or a listing, into what people call the firm in a casual email.\n\nAnswer with JSON only: {\"name\": \"...\", \"short\": \"...\"}\n\nname: the firm's name as people say it.\n- Drop legal forms (Inc, LLC, Ltd, Corp, Co, PLLC, LLP, PC), ® and ™, locatio…`
- **CASUAL_PERSON** (const) `"You read a contact as filed in a lead list and give the first name to greet them by, as in \"Hi ___,\".\n\nAnswer with JSON only: {\"first\": \"...\"}\n\n- Their first name in normal case: \"JOHN\" is \"John\", \"mckenzie\" is \"McKenzie\".\n- If the first-name field is junk (a job title, an email …`
- **SLOT** (const) `"You write one short phrase that goes inside a sentence of a cold email a person wrote by hand. Follow the instruction.\n\nAnswer with JSON only: {\"text\": \"...\"}\n\n- Plain words, the way someone would say it out loud. No marketing words, no exclamation marks, no emoji, no quotes, no dashes.\n- …`
- **promptVersion** (function) `(kind: FillKind): string`
- **Filler** (interface) `interface Filler { fill(facts: Facts, templates: Iterable<Template>): Promise<Facts>; warm(rows: readonly Facts[], templates: Iterable<Template>): Promise<void>; }`

## packages/channel-email/src/outreach/live.ts

- **liveEmails** (function) `(db: Queryable, niche: string, names?: readonly string[]): Promise<Map<string, Template>>`
- **copyGap** (function) `(sequence: Sequence, live: ReadonlyMap<string, Template>, offerFacts: Readonly<Record<string, string>> = {}): string | null`

## packages/channel-email/src/outreach/plan.ts

- **enrollmentPlan** (function) `(rules: readonly EnrollmentRule[], known: ReadonlySet<string>, where: string): readonly EnrollmentRule[]`
- **EnrollmentRule** (interface) `interface EnrollmentRule { readonly sequence: string; readonly where?: Readonly<Record<string, string>>; readonly audience?: Audience; }`
- **ruleCovers** (function) `(rule: EnrollmentRule, audience: Audience): boolean`

## packages/channel-email/src/outreach/provenance.ts

- **describeAddress** (function) `(address: Partial<Record<string, unknown>> | null | undefined, opts: { brief?: boolean } = {}): string`
- **peopleWithAddress** (function) `(db: Queryable, personIds: readonly number[], horizonDays: number): Promise<Set<number>>`
- **roleInboxAddress** (function) `(db: Queryable, ref: RoleInboxRef): Promise<AddressRecord>`
- **AddressRecord** (interface) `interface AddressRecord { readonly email: string; readonly evidence: string; readonly lead_id: number | null; readonly candidate_id: number | null; readonly pattern: string | null; readonly source_ref: string | null; readonly verification_id: number | null; readonly verification_result: string | null; readonly verified_at: string | null; readonly verifier: string | null; readonly pick_enrichment_id: number | null; readonly pick_method: string | null; readonly extraction_enrichment_id: number | null; readonly document_id: number | null; readonly source_url: string | null; }`
- **personAddressIn** (function) `(db: Queryable, addressable: ReadonlySet<number>, personId: number, horizonDays: number): Promise<PersonAddress>`

## packages/channel-email/src/outreach/readable.ts

- **readablePersonName** (function) `(value: unknown): string | null`
- **readableCompany** (function) `(value: unknown): string | null`
- **shortCompany** (function) `(value: unknown): string | null`
- **readableTitle** (function) `(value: unknown): string | null`
- **readableCount** (function) `(value: unknown): string | null`
- **readableMoney** (function) `(value: unknown): string | null`
- **TITLE_MAX_CHARS** (const) `80`

## packages/channel-email/src/outreach/refresh.ts

- **refreshQueue** (function) `(db: Queryable, opts: RefreshOptions): Promise<RefreshStats>`
- **RefreshStats** (interface) `interface RefreshStats { checked: number; kept_started_or_inactive: number; rerendered: number; tokens_changed: number; kept_unrenderable: number; kept_current: number; raced: number; }`

## packages/channel-email/src/outreach/review.ts

- **listDrafts** (function) `(db: Queryable, opts: { enrollmentId?: number; flagged?: boolean } = {}): Promise<DraftRow[]>`
- **approveMessages** (function) `(db: Queryable, selector: ApproveSelector, now: Date = new Date()): Promise<ApproveResult>`
- **rejectMessages** (function) `(db: Queryable, ids: number[], reason: RejectReason, note: string | null = null): Promise<number>`
- **editableText** (function) `(subject: string | null, body: string): string`
- **parseEditable** (function) `(text: string, opts: { riding: boolean }): { subject: string | null; body: string }`
- **editMessage** (function) `(db: Queryable, id: number, edited: { subject: string | null; body: string }, now: Date = new Date()): Promise<number | null>`
- **stopByHand** (function) `(db: Queryable, target: { enrollmentId: number } | { companyDomain: string }, reason: StopReason, detail: string | null = null, now: Date = new Date()): Promise<StopOutcome>`
- **DraftRow** (interface) `interface DraftRow { id: number; enrollmentId: number; step: number; to: string; addressVia: string; template: string; duplicate: string; subject: string | null; firstLine: string; }`

## packages/channel-email/src/outreach/sequences.ts

- **armOf** (function) `(templateName: string): string | null`
- **sequenceStep** (function) `(templateName: string, day: number): SequenceStep`
- **sequence** (function) `(name: string, steps: readonly SequenceStep[]): Sequence`
- **threeEmailSequence** (function) `(opener: string, followup: string, finalFollowup: string, opts: { name?: string; days?: readonly [number, number, number] } = {}): Sequence`
- **twoEmailSequence** (function) `(opener: string, followup: string, opts: { name?: string; days?: readonly [number, number] } = {}): Sequence`
- **Sequence** (interface) `interface Sequence { readonly name: string; readonly steps: readonly SequenceStep[]; readonly arm: string | null; }`

## packages/channel-email/src/recontact.ts

- **recontactPolicy** (function) `(overrides: RecontactOverrides = {}, where = "recontact"): RecontactPolicy`
- **audienceGate** (function) `(company: SQL, audience: Audience, policy: RecontactPolicy, pitch: Pitch | null = null): SQL`
- **doneAddresses** (function) `(db: Queryable): Promise<Set<string>>`
- **RESTING_OUTCOMES** (const) `readonly ["no_reply", "not_now", "not_interested", "wrong_person", "referral", "bounced"]`
- **ContactOutcome** (type) `type ContactOutcome = RestingOutcome | (typeof BLOCKING_OUTCOMES)[number];`
- **RecontactPolicy** (interface) `interface RecontactPolicy { readonly restDays: Readonly<Record<RestingOutcome, number | null>>; readonly perYear: number; }`
- **DEFAULT_RECONTACT** (const) `RecontactPolicy`
- **RecontactOverrides** (interface) `interface RecontactOverrides { readonly restDays?: Partial<Record<RestingOutcome, number | null>>; readonly perYear?: number; }`
- **Audience** (type) `type Audience = "first_contact" | "returning";`
- **AUDIENCES** (const) `readonly Audience[]`

## packages/channel-email/src/records.ts

- **inboxRecord** (function) `(roster: readonly Sender[], env: SendPolicy): RecordType`
- **replyRecord** (const) `RecordType`
- **callRecord** (const) `RecordType`
- **firmRecord** (const) `RecordType`
- **modelRecord** (const) `RecordType`
- **stallRecord** (const) `RecordType`
- **emailRecords** (function) `(roster: readonly Sender[], policy: SendPolicy): RecordType[]`

## packages/channel-email/src/report/schedule.ts

- **nextReportAt** (function) `(policy: SendPolicy, now: Date): Date`
- **untilNextReport** (function) `(policy: SendPolicy, now: Date): number`
- **REPORT_HOUR** (const) `19`

## packages/channel-email/src/report/send.ts

- **previousWeekly** (function) `(db: Db, before: Date): Promise<WeeklyStats | null>`
- **runWeeklyReport** (function) `(deps: WeeklyReportDeps): Promise<WeeklyReportStats>`
- **WeeklyReportStats** (interface) `interface WeeklyReportStats extends Record<string, unknown> { reportId: number; periodStart: string; periodEnd: string; sent: number; replies: number; mailedTo: string | null; body: string; }`

## packages/channel-email/src/report/variants.ts

- **variantTexts** (function) `(name: string, source: string): { texts: Map<string, string[]>; subject: Set<string>; }`
- **variantOutcomes** (function) `(db: Queryable, niche?: string): Promise<VariantOutcome[]>`

## packages/channel-email/src/report/weekly.ts

- **collectWeekly** (function) `(db: Queryable, opts: CollectOptions): Promise<WeeklyStats>`
- **mondayLine** (function) `(s: WeeklyStats): string`
- **renderWeekly** (function) `(s: WeeklyStats, previous: WeeklyStats | null = null): string`
- **Counts** (interface) `interface Counts { sent: number; openers: number; replies: number; interested: number; hardBounces: number; unsubscribes: number; complaints: number; }`
- **Pause** (interface) `interface Pause { sender: string; domain: string; reason: string; pausedAt: string; }`
- **Pool** (interface) `interface Pool { approved: number; drafts: number; activeEnrollments: number; openersPerSendDay: number; sendDaysLeft: number | null; }`
- **WeeklyStats** (interface) `interface WeeklyStats { periodStart: string; periodEnd: string; headline: SliceStats<"campaign">; byNiche: SliceStats<{ niche: string }>[]; byArm: SliceStats<{ niche: string; arm: string }>[]; domains: ReportDomain[]; pauses: Pause[]; replies: ReplyLine[]; pool: Pool; }`
- **ZERO** (const) `Counts`

## packages/channel-email/src/resolution/listed.ts

- **runListedContacts** (function) `(db: Queryable, niche: string): Promise<ListedContactsStats>`
- **settledBy** (function) `(status: LeadStatus): CandidateState | null`

## packages/channel-email/src/resolution/service.ts

- **domainKnowledge** (function) `(db: Queryable, domain: string): Promise<DomainKnowledge>`
- **buildCandidates** (function) `(db: Queryable, opts: { limitPeople?: number } = {}): Promise<BuildCandidatesStats>`
- **queueCandidates** (function) `(db: Queryable, opts: QueueOptions = {}): Promise<QueueStats>`
- **strandedPromotions** (function) `(db: Queryable): Promise<PromotionRef[]>`
- **promoteCandidates** (function) `(db: Queryable, refs: PromotionRef[]): Promise<void>`
- **selectResolutionTargets** (function) `(db: Queryable): Promise<string[]>`
- **selectNewResolutionTargets** (function) `(db: Queryable, opts: { limit: number; niche?: string; retryRiskyAfterDays?: number; domainBudget?: number }): Promise<string[]>`
- **resolveDomainUnit** (function) `(db: Queryable, verifier: EmailVerifier, domain: string, opts: DomainUnitOptions): Promise<DomainUnitResult>`
- **addResolutionStats** (function) `(total: ResolutionStats, delta: ResolutionStats): ResolutionStats`
- **emptyResolutionStats** (function) `(): ResolutionStats`
- **runResolution** (function) `(db: Queryable, verifier: EmailVerifier, opts: ResolutionOptions = {}): Promise<ResolutionStats>`
- **ledger** (function) `(db: Queryable): Promise<Ledger>`
- **DEFAULT_DOMAIN_BUDGET** (const) `5`
- **COMMON_GUESS_RANKS** (const) `3`
- **BuildCandidatesStats** (interface) `interface BuildCandidatesStats extends Record<string, number> { people_seen: number; scraped: number; derived: number; guessed: number; no_usable_names: number; }`
- **QueueOptions** (interface) `interface QueueOptions { domain?: string | null; companySourceKey?: string | null; companyDomain?: string | null; niche?: string | null; limitPeople?: number | null; }`
- **QueueStats** (interface) `interface QueueStats extends Record<string, number> { people_queued: number; candidates_queued: number; suppressed_skipped: number; }`
- **PromotionRef** (interface) `interface PromotionRef { candidateId: number; verificationId: number; }`
- **ResolutionStats** (interface) `interface ResolutionStats { domains_processed: number; credits_spent: number; valid: number; invalid: number; risky: number; catch_all: number; promoted: number; patterns_proven: number; catch_all_domains: number; pattern_unknown_domains: number; deferred_domains: number; dead_domains: number; people_unresolved: number; email_collisions: number; dead_pattern_candidates_pruned: number; stranded_repaired: number; suppressed_skipped: number; aborted: string | null; }`
- **Ledger** (interface) `interface Ledger { by_verifier: Array<[string, number]>; top_domains: Array<[string, number]>; }`

## packages/channel-email/src/restate/bounce-scheduler.ts

- **readAllBounces** (function) `(d: BounceSchedulerDeps, now: Date): Promise<BouncePassStats>`
- **makeBounceScheduler** (function) `(deps: BounceSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<BouncePassStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<BouncePassStats>>; start: (ctx: …`
- **SEND_ONLY** (const) `"connected to send only: its bounces can't be read"`
- **GONE** (const) `"not connected to read: its late bounces can't be read"`
- **BounceScheduler** (type) `type BounceScheduler = ReturnType<typeof makeBounceScheduler>;`

## packages/channel-email/src/restate/call-bookings.ts

- **makeCallBookings** (function) `(deps: { db: Db; clientDb?: ((client: string) => Db) | null; fire?: FireTriggers; }): restate.ServiceDefinition<"CallBookings", { ingest: (ctx: restate.Context, body: unknown) => Promise<BookingOutcome | null>; ingestFor: (ctx: restate.Context, req: { client: string; body: unknown; }) => Promise<BookingOutcome | null>; }>`
- **CallBookings** (type) `type CallBookings = ReturnType<typeof makeCallBookings>;`

## packages/channel-email/src/restate/clicks-scheduler.ts

- **makeClicksScheduler** (function) `(deps: ClicksSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<ClickSyncStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<ClickSyncStats>>; start: (ctx: re…`
- **CLICKS_KEY** (const) `"fleet"`
- **CLICKS_SYNC_COMMAND** (const) `"outreach clicks sync"`
- **ClicksScheduler** (type) `type ClicksScheduler = ReturnType<typeof makeClicksScheduler>;`

## packages/channel-email/src/restate/compose-scheduler.ts

- **queuedOpeners** (function) `(db: Db, niche: string): Promise<number>`
- **dailyOpenerCapacity** (function) `(policy: SendPolicy, niche: string, senders: readonly string[], now: Date, ramps?: RampMap): number`
- **refreshCampaign** (function) `(db: Db, campaign: Campaign, trackOpens: boolean, staleOnly = false): Promise<RefreshStats>`
- **topUp** (function) `(db: Db, campaign: Campaign, opts: { policy: SendPolicy; now: Date; daysAhead: number; verificationHorizonDays: number; trackOpens: boolean; roleInboxNeedsVerdict: boolean; runId: string | null; shared?: SharedSuppressions | null; }): Promise<TopUpStats>`
- **makeComposeScheduler** (function) `(deps: ComposeSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<TopUpStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<TopUpStats>>; start: (ctx: restate.Ob…`
- **Campaign** (interface) `interface Campaign { readonly niche: string; readonly plan: readonly EnrollmentRule[]; readonly mailsRoleInboxes: boolean; readonly sequences: ReadonlyMap<string, Sequence>; readonly offers: ReadonlyMap<string, string>; readonly offerFacts: ReadonlyMap<string, Readonly<Record<string, string>>>; readonly site?: string | null; readonly factsView: string | null; readonly senders: readonly string[]; readonly ramps?: RampMap; readonly signatures: Readonly<Record<string, string>>; readonly companyLocation: (company: Company) => string | null; readonly recontact: RecontactPolicy; readonly fill?: Filler; }`
- **TopUpStats** (interface) `interface TopUpStats { niche: string; refresh: RefreshStats; timezones: TimezoneFillStats; capacity_per_day: number; queued: number; target: number; shortfall: number; enrolled: number; messages_drafted: number; passes: { sequence: string; audience: Audience; stats: ComposeStats }[]; skipped: { sequence: string; why: string }[]; exhausted: boolean; }`
- **ComposeScheduler** (type) `type ComposeScheduler = ReturnType<typeof makeComposeScheduler>;`

## packages/channel-email/src/restate/console.ts

- **emailConsoleApi** (function) `({ db, senders, policy, clients }: EmailConsoleDeps): { callsOf(req: CallsRequest): Promise<{ client: string | null; on: import("drizzle-orm/postgres-js").PostgresJsDatabase<Record<string, unknown>> & { $client: import(".pnpm/postgres@3.4.9/node_modules/postgres").Sql<{}>; }; ids: number[]; by: string; }>; recordsTypes: (req: PortalRequest) => Promise<…`
- **makeEmailConsole** (function) `(deps: EmailConsoleDeps): restate.ServiceDefinition<"EmailConsole", { answers: (_: restate.Context, req: PortalRequest) => Promise<{ id: number; state: "proposed" | "dropped" | "booked" | "booking" | "sent" | "already_booked" | "needs_you"; email: string; start: Date | null; timeZone: string | null; detail: string | null; cr…`
- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids: (string | number)[]; }`

## packages/channel-email/src/restate/digest-scheduler.ts

- **nextDigestAt** (function) `(policy: SendPolicy, now: Date): Date`
- **rampSummary** (function) `(policy: SendPolicy, ramps: RampMap, now: Date): string | null`
- **makeDigestScheduler** (function) `(deps: DigestSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<DigestStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<DigestStats>>; start: (ctx: restate.…`
- **DIGEST_HOUR** (const) `7`
- **DigestScheduler** (type) `type DigestScheduler = ReturnType<typeof makeDigestScheduler>;`

## packages/channel-email/src/restate/disposition.ts

- **makeDisposition** (function) `(deps: DispositionDeps): restate.VirtualObjectDefinition<"Disposition", { classify: (ctx: restate.ObjectContext) => Promise<ClassifyOutcome>; approve: (ctx: restate.ObjectContext, req: { id: number; body?: string | null; }) => Promise<ApproveOutcome>; reply: (ctx: restate.ObjectContext, req: { threadEventId: number; body: s…`
- **DISPOSITION_KEY** (const) `"fleet"`
- **DISPOSITION_COMMAND** (const) `"outreach inbox classify"`
- **Invites** (interface) `interface Invites { calendar: Calendar; notifier?: Notifier | null; copies?: ReadonlyMap<string, ReplyCopy> | null; send?: Omit<SendReplyOptions, "now"> | null; niches?: readonly string[] | null; }`
- **Disposition** (type) `type Disposition = ReturnType<typeof makeDisposition>;`

## packages/channel-email/src/restate/inbox-scheduler.ts

- **makeInboxScheduler** (function) `(deps: InboxSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<SyncStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<SyncStats>>; start: (ctx: restate.Obje…`
- **INBOX_SYNC_COMMAND** (const) `"outreach inbox sync"`
- **inboxPush** (const) `restate.VirtualObjectDefinition<"InboxPush", { claim: (ctx: restate.ObjectContext, key: string) => Promise<void>; listen: (ctx: restate.ObjectContext, l: PushListener) => Promise<void>; notify: (ctx: restate.ObjectSharedContext) => Promise<void>; }>`
- **InboxPush** (type) `type InboxPush = typeof inboxPush;`
- **InboxScheduler** (type) `type InboxScheduler = ReturnType<typeof makeInboxScheduler>;`

## packages/channel-email/src/restate/listmonk.ts

- **makeListmonkMail** (function) `(deps: IssueMailer): restate.VirtualObjectDefinition<"ListmonkMail", { send: (ctx: restate.ObjectContext, m: ListmonkMessage) => Promise<IssueSent>; }>`
- **makeListmonkIntake** (function) `(): restate.ServiceDefinition<"ListmonkIntake", { post: (ctx: restate.Context, m: ListmonkMessage) => Promise<{ ok: true; }>; }>`
- **syncTopicByName** (function) `(d: SyncDeps, name: string): Promise<number>`
- **syncAllTopics** (function) `(d: SyncDeps): Promise<SyncStats>`
- **makeListmonkSync** (function) `(deps: { db: Db; lm: Listmonk | null; everyMs?: number }): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<SyncStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<SyncStats>>; start: (ctx: restate.Obje…`
- **ListmonkMail** (type) `type ListmonkMail = ReturnType<typeof makeListmonkMail>;`
- **ListmonkIntake** (type) `type ListmonkIntake = ReturnType<typeof makeListmonkIntake>;`
- **SYNC_EVERY_MS** (const) `3600000`
- **SyncDeps** (interface) `interface SyncDeps { db: Db; lm: Listmonk; }`
- **SyncStats** (interface) `interface SyncStats extends Record<string, unknown> { topics: TopicSync[]; }`
- **ListmonkSync** (type) `type ListmonkSync = ReturnType<typeof makeListmonkSync>;`

## packages/channel-email/src/restate/marketing.ts

- **makeMarketing** (function) `(deps: { db: Db; shared: string | null; site: string; send: ((m: PlainMail) => Promise<void>) | null; clientDb?: (id: string) => Db; }): restate.ServiceDefinition<"Marketing", { signUp: (ctx: restate.Context, req: SignUpRequest) => Promise<{ ok: true; }>; confirm: (ctx: restate.Context, req: Visit & { token: string; }) => Promise<{ ok: boolean; prefs: { channel: "email" | "sms"; topic: string | null; named: string | null; from: strin…`
- **Change** (type) `type Change = | { topic: string; on: boolean } | { frequency: Frequency } | { pause: 30 | 90 | null } | { everything: true } | { undo: number };`
- **Marketing** (type) `type Marketing = ReturnType<typeof makeMarketing>;`

## packages/channel-email/src/restate/newsletter.ts

- **issueMail** (function) `(o: { issue: Issue; to: string; footer: string; headers: [string, string][]; test?: boolean; tags?: LinkTags | null; }): PlainMail`
- **deliverIssue** (function) `(d: IssueMailer, o: { issueKey: string; topic: string; consentId: number; address: string; build: (wrap: IssueWrap) => PlainMail; }): Promise<IssueSent>`
- **issueTags** (function) `(db: Db, slug: string): Promise<LinkTags | null>`
- **makeNewsletter** (function) `(deps: IssueMailer & { listmonk?: Listmonk | null; syncTopic?: (topic: string) => Promise<number>; }): restate.VirtualObjectDefinition<"Newsletter", { send: (ctx: restate.ObjectContext, issue: Issue) => Promise<IssueRun>; }>`
- **IssueSent** (type) `type IssueSent = { messageId: string } | { skip: string };`
- **Issue** (interface) `interface Issue { topic: string; slug: string; subject: string; text: string; url: string; test?: string; }`
- **issueBody** (function) `(issue: Pick<Issue, "text" | "url">): string`
- **testAllowed** (function) `(address: string, from: string): boolean`
- **IssueMailer** (interface) `interface IssueMailer { db: Db; shared: string | null; site: string; from: string | null; postal: string | null; send: ((m: PlainMail) => Promise<void>) | null; }`
- **recordIssueSend** (function) `(db: Db, o: { consentId: number; issueKey: string; slug: string; messageId: string; evidence?: Record<string, unknown>; }): Promise<void>`
- **Newsletter** (type) `type Newsletter = ReturnType<typeof makeNewsletter>;`

## packages/channel-email/src/restate/opens-scheduler.ts

- **makeOpensScheduler** (function) `(deps: OpensSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<OpenSyncStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<OpenSyncStats>>; start: (ctx: rest…`
- **OPENS_KEY** (const) `"fleet"`
- **OpensScheduler** (type) `type OpensScheduler = ReturnType<typeof makeOpensScheduler>;`

## packages/channel-email/src/restate/placement-scheduler.ts

- **plainNote** (function) `(day: string): { subject: string; body: string }`
- **landedFrom** (function) `(labelIds: readonly string[]): Placement`
- **landedAt** (function) `(sites: SiteClient, seed: string, messageId: string): Promise<Landing>`
- **sendPlacements** (function) `(deps: Omit<PlacementSchedulerDeps, "sitesFor">, now: Date): Promise<Pick<PlacementStats, "sent" | "noDraft" | "failed">>`
- **placementLines** (function) `(db: Db, senders: readonly string[], now: Date): Promise<{ lines: string[]; trouble: string[] }>`
- **makePlacementScheduler** (function) `(deps: PlacementSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<PlacementStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<PlacementStats>>; start: (ctx: re…`
- **PLACEMENT_KEY** (const) `"fleet"`
- **NO_DRAFT** (const) `"no draft yet"`
- **CHECK_AFTER_MS** (const) `number`
- **PLAIN_NOTES** (const) `readonly { subject: string; body: string }[]`
- **Landing** (interface) `interface Landing { landed: Placement; auth: AuthResults | null; }`
- **PlacementScheduler** (type) `type PlacementScheduler = ReturnType<typeof makePlacementScheduler>;`

## packages/channel-email/src/restate/pool-scheduler.ts

- **stagesToRun** (function) `(settings: PoolSettings | null, modelStages: ModelStages, freeVerifier = false, wired: Wired = {}): Set<Stage>`
- **stageEnabled** (function) `(stage: Stage, modelStages: ModelStages, freeVerifier = false, wired: Wired = {}): boolean`
- **makePoolScheduler** (function) `(deps: PoolSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<FeedStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<FeedStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) => P…`
- **STAGES** (const) `readonly ["adLibrary", "exaSearch", "youtubeSearch", "triggers", "fbGroups", "discover", "verify", "crawl", "render", "scan", "contacts", "extract", "pick", "applyPicks", "resolveMailboxes", "verifyMailboxes", "team", "youtube", "instagram", "profiles", "signals"]`
- **Stage** (type) `type Stage = (typeof STAGES)[number];`
- **Wired** (type) `type Wired = Partial<Record<WiredStage, boolean>>;`
- **PROBE_WIDTH** (const) `32`
- **FeedStats** (interface) `interface FeedStats { niche: string; model_stages: ModelStages; stages: StageOutcome[]; progress: number; failed: number; }`
- **progressOf** (const) `Record<Stage, (s: Record<string, number>) => number>`

## packages/channel-email/src/restate/postmaster-scheduler.ts

- **clientPostmaster** (function) `(main: Queryable, id: string): Promise<ClientPostmaster>`
- **untilNextLocalDay** (function) `(policy: SendPolicy, now: Date): number`
- **makePostmasterScheduler** (function) `(deps: PostmasterSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<PostmasterStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<PostmasterStats>>; start: (ctx: …`
- **POSTMASTER_KEY** (const) `"fleet"`
- **domainsOf** (function) `(raw: string | undefined): string[]`
- **PostmasterScheduler** (type) `type PostmasterScheduler = ReturnType<typeof makePostmasterScheduler>;`

## packages/channel-email/src/restate/queue-refresh.ts

- **makeQueueRefresh** (function) `(deps: QueueRefreshDeps): restate.ServiceDefinition<"QueueRefresh", { all: (ctx: restate.Context) => Promise<Record<string, RefreshStats>>; }>`
- **QueueRefresh** (type) `type QueueRefresh = ReturnType<typeof makeQueueRefresh>;`

## packages/channel-email/src/restate/report-scheduler.ts

- **makeReportScheduler** (function) `(deps: ReportSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<WeeklyReportStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<import("@wren/core/restate").PassOutcome<WeeklyReportStats>>; start: (c…`
- **ReportScheduler** (type) `type ReportScheduler = ReturnType<typeof makeReportScheduler>;`

## packages/channel-email/src/restate/resolution.ts

- **makeResolution** (function) `(deps: ResolutionDeps): restate.VirtualObjectDefinition<"Resolution", { build: (ctx: restate.ObjectContext, input?: { limitPeople?: number; } & ClientInput) => Promise<import("../resolution/service.js").BuildCandidatesStats>; queue: (ctx: restate.ObjectContext, input?: QueueOptions & ClientInput) => Promise<import("../reso…`
- **RESOLUTION_KEY** (const) `"default"`
- **Resolution** (type) `type Resolution = ReturnType<typeof makeResolution>;`

## packages/channel-email/src/restate/send-scheduler.ts

- **makeSendScheduler** (function) `(deps: SendSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<"tick", (ctx: restate.ObjectContext) => Promise<PassOutcome<TickStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<TickStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) => …`
- **nextDelay** (function) `(policy: SendPolicy, stats: SendStats, now: Date, nextSendAt: Date | null, tickMs: number): number`
- **SendScope** (interface) `interface SendScope { db: Db; policy: SendPolicy; fleet: Fleet; pixelBaseUrl?: string | null; calendar?: Calendar | null; shared?: SharedSuppressions | null; }`
- **TickStats** (type) `type TickStats = SendStats & { newPauses: number };`
- **oneScope** (function) `(scope: SendScope): ((key: string) => Promise<SendScope>)`
- **NO_SCOPE** (const) `"no send scope for this key: sending is off or the mailbox is gone"`
- **SendScheduler** (type) `type SendScheduler = ReturnType<typeof makeSendScheduler>;`

## packages/channel-email/src/schema.ts

- **CANDIDATE_EVIDENCE** (const) `readonly ["scraped", "derived_pattern", "guessed_pattern", "crm"]`
- **CandidateEvidence** (type) `type CandidateEvidence = (typeof CANDIDATE_EVIDENCE)[number];`
- **CANDIDATE_STATES** (const) `readonly ["candidate", "queued", "verified", "rejected"]`
- **CandidateState** (type) `type CandidateState = (typeof CANDIDATE_STATES)[number];`
- **VERIFICATION_RESULTS** (const) `readonly ["valid", "invalid", "risky", "catch_all"]`
- **VerificationResult** (type) `type VerificationResult = (typeof VERIFICATION_RESULTS)[number];`
- **ENROLLMENT_KINDS** (const) `readonly ["person", "role_inbox"]`
- **EnrollmentKind** (type) `type EnrollmentKind = (typeof ENROLLMENT_KINDS)[number];`
- **ENROLLMENT_STATES** (const) `readonly ["active", "finished", "stopped"]`
- **EnrollmentState** (type) `type EnrollmentState = (typeof ENROLLMENT_STATES)[number];`
- **STOP_REASONS** (const) `readonly ["reply", "bounce", "opt_out", "complaint", "manual", "undeliverable", "booked"]`
- **StopReason** (type) `type StopReason = (typeof STOP_REASONS)[number];`
- **APPROVAL_SOURCES** (const) `readonly ["operator", "auto", "client"]`
- **ApprovalSource** (type) `type ApprovalSource = (typeof APPROVAL_SOURCES)[number];`
- **MESSAGE_STATES** (const) `readonly ["draft", "approved", "rejected", "sending", "sent", "skipped", "failed", "unknown"]`
- **MessageState** (type) `type MessageState = (typeof MESSAGE_STATES)[number];`
- **REJECT_REASONS** (const) `readonly ["wrong_fact", "too_salesy", "generic_opener", "bad_tone", "wrong_person", "bad_address", "other"]`
- **RejectReason** (type) `type RejectReason = (typeof REJECT_REASONS)[number];`
- **BOUNCE_CLASSES** (const) `readonly ["hard", "soft"]`
- **BounceClass** (type) `type BounceClass = (typeof BOUNCE_CLASSES)[number];`
- **DISPOSITION_SOURCES** (const) `readonly ["rule", "operator", "llm"]`
- **DispositionSource** (type) `type DispositionSource = (typeof DISPOSITION_SOURCES)[number];`
- **REPLY_DISPOSITIONS** (const) `readonly ["interested", "meeting_booked", "not_interested", "not_now", "wrong_person", "referral", "other"]`
- **ReplyDisposition** (type) `type ReplyDisposition = (typeof REPLY_DISPOSITIONS)[number];`
- **THREAD_EVENT_KINDS** (const) `readonly ["reply", "bounce", "auto_reply", "unsubscribe", "complaint", "note"]`
- **ThreadEventKind** (type) `type ThreadEventKind = (typeof THREAD_EVENT_KINDS)[number];`
- **PAUSE_SOURCES** (const) `readonly ["kill_switch", "operator", "placement"]`
- **PauseSource** (type) `type PauseSource = (typeof PAUSE_SOURCES)[number];`
- **contactCandidates** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "contact_candidates"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "contact_candidates"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefa…`
- **candidateMints** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "candidate_mints"; schema: undefined; columns: { personId: import("drizzle-orm/pg-core").PgColumn<{ name: "person_id"; tableName: "candidate_mints"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNu…`
- **verifications** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "verifications"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "verifications"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **enrollments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "enrollments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "enrollments"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **messages** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "messages"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "messages"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`
- **threadEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "thread_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "thread_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **CALL_INVITE_STATES** (const) `readonly ["proposed", "booking", "booked", "sent", "already_booked", "needs_you", "dropped"]`
- **CallInviteState** (type) `type CallInviteState = (typeof CALL_INVITE_STATES)[number];`
- **callInvites** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "call_invites"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "call_invites"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **CallInvite** (type) `type CallInvite = typeof callInvites.$inferSelect;`
- **CALL_BOOKING_STATES** (const) `readonly ["booked", "cancelled"]`
- **CallBookingState** (type) `type CallBookingState = (typeof CALL_BOOKING_STATES)[number];`
- **callBookings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "call_bookings"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "call_bookings"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **CallBooking** (type) `type CallBooking = typeof callBookings.$inferSelect;`
- **callBriefs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "call_briefs"; schema: undefined; columns: { callBookingId: import("drizzle-orm/pg-core").PgColumn<{ name: "call_booking_id"; tableName: "call_briefs"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; no…`
- **CallBriefRow** (type) `type CallBriefRow = typeof callBriefs.$inferSelect;`
- **CALL_RECORDING_BY** (const) `readonly ["desk", "manual"]`
- **callRecordings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "call_recordings"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "call_recordings"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **CallRecordingRow** (type) `type CallRecordingRow = typeof callRecordings.$inferSelect;`
- **openEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "open_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "open_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **openSyncs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "open_syncs"; schema: undefined; columns: { baseUrl: import("drizzle-orm/pg-core").PgColumn<{ name: "base_url"; tableName: "open_syncs"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault:…`
- **emailClicks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "email_clicks"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "email_clicks"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **clickSyncs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "click_syncs"; schema: undefined; columns: { baseUrl: import("drizzle-orm/pg-core").PgColumn<{ name: "base_url"; tableName: "click_syncs"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefaul…`
- **inboxSyncs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "inbox_syncs"; schema: undefined; columns: { sender: import("drizzle-orm/pg-core").PgColumn<{ name: "sender"; tableName: "inbox_syncs"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: …`
- **senderPauses** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sender_pauses"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sender_pauses"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **campaignControls** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "campaign_controls"; schema: undefined; columns: { campaign: import("drizzle-orm/pg-core").PgColumn<{ name: "campaign"; tableName: "campaign_controls"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true;…`
- **CampaignControlRow** (type) `type CampaignControlRow = typeof campaignControls.$inferSelect;`
- **postmasterDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "postmaster_days"; schema: undefined; columns: { domain: import("drizzle-orm/pg-core").PgColumn<{ name: "domain"; tableName: "postmaster_days"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasD…`
- **REPORT_KINDS** (const) `readonly ["weekly"]`
- **reports** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reports"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reports"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKe…`
- **ContactCandidate** (type) `type ContactCandidate = typeof contactCandidates.$inferSelect;`
- **NewContactCandidate** (type) `type NewContactCandidate = typeof contactCandidates.$inferInsert;`
- **Verification** (type) `type Verification = typeof verifications.$inferSelect;`
- **NewVerification** (type) `type NewVerification = typeof verifications.$inferInsert;`
- **Enrollment** (type) `type Enrollment = typeof enrollments.$inferSelect;`
- **NewEnrollment** (type) `type NewEnrollment = typeof enrollments.$inferInsert;`
- **Message** (type) `type Message = typeof messages.$inferSelect;`
- **NewMessage** (type) `type NewMessage = typeof messages.$inferInsert;`
- **ThreadEvent** (type) `type ThreadEvent = typeof threadEvents.$inferSelect;`
- **NewThreadEvent** (type) `type NewThreadEvent = typeof threadEvents.$inferInsert;`
- **OpenEvent** (type) `type OpenEvent = typeof openEvents.$inferSelect;`
- **NewOpenEvent** (type) `type NewOpenEvent = typeof openEvents.$inferInsert;`
- **OpenSync** (type) `type OpenSync = typeof openSyncs.$inferSelect;`
- **NewOpenSync** (type) `type NewOpenSync = typeof openSyncs.$inferInsert;`
- **EmailClickRow** (type) `type EmailClickRow = typeof emailClicks.$inferSelect;`
- **NewEmailClickRow** (type) `type NewEmailClickRow = typeof emailClicks.$inferInsert;`
- **ClickSync** (type) `type ClickSync = typeof clickSyncs.$inferSelect;`
- **NewClickSync** (type) `type NewClickSync = typeof clickSyncs.$inferInsert;`
- **InboxSync** (type) `type InboxSync = typeof inboxSyncs.$inferSelect;`
- **NewInboxSync** (type) `type NewInboxSync = typeof inboxSyncs.$inferInsert;`
- **SenderPause** (type) `type SenderPause = typeof senderPauses.$inferSelect;`
- **NewSenderPause** (type) `type NewSenderPause = typeof senderPauses.$inferInsert;`
- **PostmasterDay** (type) `type PostmasterDay = typeof postmasterDays.$inferSelect;`
- **NewPostmasterDay** (type) `type NewPostmasterDay = typeof postmasterDays.$inferInsert;`
- **Report** (type) `type Report = typeof reports.$inferSelect;`
- **NewReport** (type) `type NewReport = typeof reports.$inferInsert;`
- **LEAD_CHECK_KINDS** (const) `readonly ["mailbox_fits_name", "domain_is_firm", "works_there", "title_agrees", "page_is_firm", "phone_agrees"]`
- **LeadCheckKind** (type) `type LeadCheckKind = (typeof LEAD_CHECK_KINDS)[number];`
- **LEAD_CHECK_RESULTS** (const) `readonly ["pass", "fail", "unknown"]`
- **LeadCheckResult** (type) `type LeadCheckResult = (typeof LEAD_CHECK_RESULTS)[number];`
- **leadChecks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "lead_checks"; schema: undefined; columns: { leadId: import("drizzle-orm/pg-core").PgColumn<{ name: "lead_id"; tableName: "lead_checks"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; ha…`
- **LeadCheck** (type) `type LeadCheck = typeof leadChecks.$inferSelect;`
- **PLACEMENTS** (const) `readonly ["inbox", "promotions", "spam", "missing"]`
- **Placement** (type) `type Placement = (typeof PLACEMENTS)[number];`
- **PROBE_KINDS** (const) `readonly ["plain", "real"]`
- **ProbeKind** (type) `type ProbeKind = (typeof PROBE_KINDS)[number];`
- **AuthResults** (interface) `interface AuthResults { spf: string | null; dkim: string | null; dmarc: string | null; }`
- **placementChecks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "placement_checks"; schema: undefined; columns: { sender: import("drizzle-orm/pg-core").PgColumn<{ name: "sender"; tableName: "placement_checks"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; ha…`
- **PlacementCheck** (type) `type PlacementCheck = typeof placementChecks.$inferSelect;`
- **FILL_KINDS** (const) `readonly ["company", "person", "slot"]`
- **fills** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "fills"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "fills"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: f…`

## packages/channel-email/src/send/call-times.ts

- **weekdaysAfter** (function) `(day: string, n: number): string`
- **firstOfferDay** (function) `(sendDay: string): string`
- **pickTimes** (function) `(open: readonly Date[], zone: string, now: Date): Date[]`
- **sayTimes** (function) `(times: readonly Date[], zone: string): string`
- **fillCallTimes** (function) `(body: string, open: readonly Date[] | null, zone: string | null, now: Date): { body: string; offered: Date[] }`
- **CALL_TIMES** (const) `"{call.times}"`
- **FLEET_ZONE** (const) `"America/New_York"`
- **LOOKAHEAD_MS** (const) `number`

## packages/channel-email/src/send/campaign-controls.ts

- **setCampaignControl** (function) `(db: Queryable, base: SendPolicy, change: CampaignChange, by: string): Promise<CampaignControlRow>`
- **loadCampaignControls** (function) `(db: Queryable): Promise<CampaignControlRow[]>`
- **campaignPolicy** (function) `(db: Queryable, policy: SendPolicy): Promise<SendPolicy>`
- **CampaignChange** (interface) `interface CampaignChange { campaign: string; killSwitch?: boolean | null | undefined; openersPerDay?: number | null | undefined; }`

## packages/channel-email/src/send/dates.ts

- **minutesOfDay** (function) `(t: ClockTime): number`
- **formatClock** (function) `(t: ClockTime): string`
- **addBusinessDays** (function) `(start: PlainDate, days: number, holiday: (day: PlainDate) => boolean = () => false): PlainDate`
- **PlainDate** (class) `constructor(readonly year: number, readonly month: number, readonly day: number); fromIso(text: string): PlainDate; utcDayOf(at: Date): PlainDate; weekday(): number; addDays(n: number): PlainDate; daysUntil(other: PlainDate): number; compare(other: PlainDate): number; equals(other: PlainDate): boolean; toString(): string`
- **ClockTime** (interface) `interface ClockTime { readonly hour: number; readonly minute: number; }`

## packages/channel-email/src/send/deliver.ts

- **emptySendStats** (function) `(): SendStats`
- **sendDue** (function) `(db: Db, opts: SendDueOptions): Promise<SendStats>`
- **todaysSends** (function) `(db: Queryable, policy: SendPolicy, now: Date): Promise<{ sentToday: Map<string, number>; openersToday: number; nicheOpeners: Map<string, number>; }>`
- **nextSendAt** (function) `(db: Queryable, policy: SendPolicy, senders: readonly string[], now: Date, ramps?: RampMap | null): Promise<Date | null>`
- **lockSender** (function) `(tx: Queryable, sender: string): Promise<void>`
- **recordStop** (function) `(db: Queryable, enrollment: Enrollment, reason: StopReason, opts: { detail?: string | null; now?: Date; messages?: Message[]; shared?: SharedSuppressions | null; } = {}): Promise<number>`
- **stopCompany** (function) `(db: Queryable, opts: { companyId: number; reason: StopReason; detail?: string | null; now?: Date; shared?: SharedSuppressions | null; }): Promise<number>`
- **LIVE** (const) `readonly ["draft", "approved", "failed"]`
- **SendStats** (type) `type SendStats = Record<StatKey, number>;`
- **RampMap** (type) `type RampMap = Readonly<Record<string, Ramp>>;`
- **mintMessageId** (function) `(sender: string): string`
- **SendDueOptions** (interface) `interface SendDueOptions { transport: Transport; policy: SendPolicy; now?: Date; rng?: Rng; limit?: number | null; runId?: string | null; fromNames?: NameMap | null; signatureHtml?: StringMap | null; pages?: StringMap | null; pixelBaseUrl?: string | null; calendar?: Calendar | null; senders?: readonly string[] | null; ramps?: RampMap | null; reconcileFirst?: boolean; shared?: SharedSuppressions | null; onSent?: (enrollmentId: number, step: number) => void; }`

## packages/channel-email/src/send/gmail.ts

- **plainMailer** (function) `(gmail: GmailClient, o: { mailbox: string; from: string; name: string }): (m: PlainMail) => Promise<void>`
- **GMAIL_LIMIT_MS** (const) `number`
- **GmailClient** (class) `constructor(opts: GmailClientOptions)`
- **PlainMail** (interface) `interface PlainMail { to: string; subject: string; text: string; headers?: readonly (readonly [string, string])[]; messageId?: string; attachments?: readonly MailFile[]; }`
- **GmailTransport** (class) `readonly name; constructor(private readonly client: GmailClient); send(email: OutgoingEmail): Promise<SendReceipt>; find(sender: string, messageId: string): Promise<SendReceipt | null>`

## packages/channel-email/src/send/holidays.ts

- **holidaysIn** (function) `(calendars: Iterable<HolidayCalendar>, year: number): ReadonlyMap<string, string>`
- **holidayOn** (function) `(calendars: ReadonlySet<HolidayCalendar>, day: PlainDate): string | null`
- **windowEnd** (function) `(start: PlainDate, days: number, calendars: ReadonlySet<HolidayCalendar>): PlainDate`
- **parseHolidayCalendars** (function) `(raw: string, key: string): ReadonlySet<HolidayCalendar>`
- **HolidayCalendar** (type) `type HolidayCalendar = (typeof HOLIDAY_CALENDARS)[number];`

## packages/channel-email/src/send/lead-timezone.ts

- **timezoneForLocation** (function) `(location: string | null | undefined): string | null`
- **fillTimezones** (function) `(db: Queryable, opts: { niche: string; locationOf: (company: Company) => string | null }): Promise<TimezoneFillStats>`
- **ZONE_BY_REGION** (const) `Readonly<Record<string, string>>`
- **TimezoneFillStats** (interface) `interface TimezoneFillStats { candidates: number; resolved: number; unresolved: number; }`

## packages/channel-email/src/send/mailboxes.ts

- **parseMailboxes** (function) `(text: string, where: string): Map<string, Mailbox>`
- **loadMailboxes** (function) `(path: string | undefined): Map<string, Mailbox>`
- **Mailbox** (interface) `interface Mailbox { readonly smtp: Login; readonly imap: Login; }`
- **Mailboxes** (type) `type Mailboxes = ReadonlyMap<string, Mailbox>;`

## packages/channel-email/src/send/mime.ts

- **formatAddress** (function) `(rawName: string | null, address: string): string`
- **buildMime** (function) `(email: OutgoingEmail, opts: { now?: Date; boundary?: string } = {}): Buffer`

## packages/channel-email/src/send/policy.ts

- **EPOCH** (const) `Date`
- **Ramp** (interface) `interface Ramp { readonly start: PlainDate; readonly from: number; readonly step: number; readonly ceiling: number; readonly warmupStart?: PlainDate | null; }`
- **SendPolicySettings** (interface) `interface SendPolicySettings { readonly sendTimezone: string; readonly sendDays: string; readonly sendHolidays: string; readonly sendWindowStart: string; readonly sendWindowEnd: string; readonly sendLeadWindowStart?: string | undefined; readonly sendLeadWindowEnd?: string | undefined; readonly coldSendsPerInboxPerDay: number; readonly coldSendsRampStart?: string | undefined; readonly coldSendsRampFrom: number; readonly coldSendsRampStep: number; readonly coldSendsRampEveryDays: number; readonly warmupPerCold?: number; readonly warmupStep?: number; readonly warmupLimit?: number; readonly sendGapMinMinutes: number; readonly sendGapMaxMinutes: number; readonly newOpenersPerDay?: number | undefined; readonly nicheOpenersPerDay?: string | undefined; readonly killSwitchOffFor?: string | undefined; readonly resendCooldownDays: number; readonly reconcileGraceMinutes: number; readonly bouncePauseRate: number; readonly bouncePauseMinBounces: number; readonly healthWindowDays: number; }`
- **SendPolicy** (class) `readonly timezone: string;; readonly days: ReadonlySet<number>;; readonly holidays: ReadonlySet<HolidayCalendar>;; readonly windowStart: ClockTime;; readonly windowEnd: ClockTime;; readonly leadWindowStart: ClockTime | null;; readonly leadWindowEnd: ClockTime | null;; readonly perInboxCeiling: number;; readonly rampStart: PlainDate | null;; readonly rampFrom: number;; readonly rampStep: number;; readonly rampEverySendDays: number;; readonly warmupPerCold: number;; readonly warmupStep: number;; readonly warmupLimit: number;; readonly gapMinMs: number;; readonly gapMaxMs: number;; readonly newOpenersPerDay: number | null;; readonly nicheOpenersPerDay: ReadonlyMap<string, number>;; readonly killSwitchOffFor: ReadonlySet<string>;; readonly resendCooldownDays: number;; readonly reconcileGraceMs: number;; readonly bouncePauseRate: number;; readonly bouncePauseMinBounces: number;; readonly healthWindowMs: number;; constructor(fields: SendPolicyFields); fromSettings(s: SendPolicySettings): SendPolicy; withCampaigns(controls: readonly CampaignControl[]): SendPolicy; localNow(now: Date): { date: PlainDate; time: ClockTime; weekday: number }; localDay(now: Date): PlainDate; localDayBounds(now: Date): [Date, Date]; holidayOn(day: PlainDate): string | null; sendsOn(day: PlainDate): boolean; windowOpen(now: Date): boolean; nextWindowOpen(now: Date): Date; windowClose(now: Date): Date | null; leadWindowOpen(now: Date, leadZone: string | null): boolean; leadWindowMeetsFleetWindow(now: Date, leadZone: string): boolean; sendDaysElapsed(now: Date, ramp?: Ramp | null): number; perInboxCap(now: Date, ramp?: Ramp | null): number; warmupOn(now: Date, ramp?: Ramp | null): number | null; gapFor(rng: Rng): number; gapAfter(lastSent: Date, sentThatDay: number, ramp?: Ramp | null): number; earliestNextSend(lastSent: Date | null, sentThatDay: number, ramp?: Ramp | null): Date; nicheOpenerCap(niche: string): number | null; killSwitchOn(niche: string): boolean; describe(now?: Date): string`

## packages/channel-email/src/send/reconcile.ts

- **reconcile** (function) `(db: Db, opts: { transport: Transport; policy: SendPolicy; now: Date; onSent?: (enrollmentId: number, step: number) => void; }): Promise<ReconcileStats>`
- **IN_FLIGHT** (const) `readonly ["sending", "unknown"]`
- **ReconcileStats** (interface) `interface ReconcileStats { reconciled_sent: number; reconciled_failed: number; pending: number; errors: number; transport_mismatch: number; }`

## packages/channel-email/src/send/rng.ts

- **seededRng** (function) `(seed: number): Rng`
- **Rng** (interface) `interface Rng { int(low: number, high: number): number; }`
- **systemRng** (const) `Rng`

## packages/channel-email/src/send/roster.ts

- **senderDomain** (function) `(sender: Pick<Sender, "address">): string`
- **parseRoster** (function) `(text: string, where: string, knownNiches?: ReadonlySet<string>, mailboxes?: ReadonlySet<string>): Sender[]`
- **loadRoster** (function) `(path: string, knownNiches?: ReadonlySet<string>, mailboxes?: ReadonlySet<string>): Sender[]`
- **activeSenders** (function) `(roster: readonly Sender[], niche?: string | null): Sender[]`
- **RosterError** (class) `constructor(message: string)`
- **Signature** (class) `constructor(readonly text: string, readonly html: string); forPage(page: string): Signature`
- **Sender** (interface) `interface Sender { readonly address: string; readonly niches: readonly string[] | null; readonly excludedNiches: readonly string[]; readonly suspended: boolean; readonly displayName: string | null; readonly signature: Signature | null; readonly transport: SenderTransport; readonly ramp: Ramp | null; readonly dkim: string | null; }`

## packages/channel-email/src/send/smtp.ts

- **threadOf** (function) `(rootMessageId: string): string`
- **SmtpTransport** (class) `readonly name; constructor(private readonly mailbox: Mailbox, opts: SmtpTransportOptions = {}); send(email: OutgoingEmail): Promise<SendReceipt>; find(_sender: string, messageId: string): Promise<SendReceipt | null>`

## packages/channel-email/src/send/suppress.ts

- **classifyValue** (function) `(value: string): [SuppressionKind, string]`
- **ensureSuppression** (function) `(db: Queryable, email: string, reason: StopReason, evidence?: Evidence, shared?: SharedSuppressions | null): Promise<Suppression | null>`
- **importValues** (function) `(db: Queryable, values: Iterable<string>, opts: { reason: SuppressionReason; evidence?: Evidence; dryRun?: boolean; checkpoint?: () => Promise<void> | void; }): Promise<ImportStats>`
- **csvValues** (function) `(rows: readonly (readonly string[])[], opts: { column?: string | null; where?: string } = {}): string[]`
- **ImportStats** (interface) `interface ImportStats { read: number; added: number; reasserted: number; invalid: number; emails: number; domains: number; invalid_values: string[]; }`

## packages/channel-email/src/send/tick.ts

- **rosterFleet** (function) `(rosterAll: readonly Sender[], active: readonly Sender[], pages: Readonly<Record<string, string>> = {}): Fleet`
- **sendTick** (function) `(db: Db, opts: TickOptions): Promise<TickResult>`
- **Fleet** (interface) `interface Fleet { readonly senders: readonly string[]; readonly domainFleet: readonly string[]; readonly fromNames: Readonly<Record<string, string | null>>; readonly signatureHtml: Readonly<Record<string, string>>; readonly pages: Readonly<Record<string, string>>; readonly ramps?: RampMap; }`
- **KillSwitches** (type) `type KillSwitches = ( db: Db, opts: { policy: SendPolicy; now: Date; senders: readonly string[]; runId: string | null }, ) => Promise<SenderPause[]>;`
- **TickOptions** (interface) `interface TickOptions { policy: SendPolicy; transport: Transport; now: Date; runId: string | null; fleet: Fleet; pixelBaseUrl?: string | null; calendar?: Calendar | null; limit?: number | null; reconcileFirst?: boolean; rng?: Rng; killSwitches?: KillSwitches; shared?: SharedSuppressions | null; }`
- **TickResult** (interface) `interface TickResult { stats: SendStats; newPauses: SenderPause[]; nextSendAt: Date | null; touches: Touch[]; }`

## packages/channel-email/src/send/transport.ts

- **renderedSubject** (function) `(email: OutgoingEmail): string`
- **fillPage** (function) `(form: string, page: string): string`
- **visibleText** (function) `(html: string): string`
- **buildPixelUrl** (function) `(base: string | null | undefined, token: string | null | undefined): string | null`
- **withLinkCode** (function) `(html: string, code: string | null | undefined): string`
- **toHtml** (function) `(body: string, signatureHtml?: string | null, pixel?: string | null, linkCode?: string | null): string`
- **OutgoingEmail** (interface) `interface OutgoingEmail { readonly fromAddress: string; readonly fromName: string | null; readonly to: string; readonly subject: string | null; readonly replySubject: string | null; readonly body: string; readonly messageId: string; readonly inReplyTo?: string | null; readonly references?: readonly string[]; readonly threadId?: string | null; readonly signatureHtml?: string | null; readonly pixelUrl?: string | null; readonly linkCode?: string | null; readonly headers?: readonly (readonly [string, string])[]; }`
- **SendReceipt** (interface) `interface SendReceipt { readonly messageId: string; readonly providerId: string; readonly threadId: string; readonly internalDate: Date | null; }`
- **TransportRefused** (class) `readonly senderLevel: boolean;; constructor(message: string, opts: { senderLevel?: boolean; cause?: unknown } = {})`
- **TransportAmbiguous** (class) `constructor(message: string, opts: { cause?: unknown } = {})`
- **Transport** (interface) `interface Transport { readonly name: string; send(email: OutgoingEmail): Promise<SendReceipt>; find(sender: string, messageId: string): Promise<SendReceipt | null>; carrier?(sender: string): Transport; }`
- **carrierOf** (function) `(transport: Transport, sender: string): Transport`
- **RoutedTransport** (class) `readonly name: string;; constructor(private readonly fallback: Transport, private readonly routes: ReadonlyMap<string, Transport>); carrier(sender: string): Transport; send(email: OutgoingEmail): Promise<SendReceipt>; find(sender: string, messageId: string): Promise<SendReceipt | null>`
- **oneLine** (function) `(value: string): string`
- **ConsoleTransportOptions** (interface) `interface ConsoleTransportOptions { write?: (line: string) => void; refuse?: (email: OutgoingEmail) => Error | null; ambiguousAfter?: (email: OutgoingEmail) => boolean; findFails?: Error | null; }`
- **ConsoleTransport** (class) `readonly name; readonly mailbox; constructor(opts: ConsoleTransportOptions = {}); send(email: OutgoingEmail): Promise<SendReceipt>; find(sender: string, messageId: string): Promise<SendReceipt | null>`

## packages/channel-email/src/sequences-settings.ts

- **SEQUENCES** (const) `"email.sequences"`
- **REPLIES** (const) `"email.replies"`
- **sendingOverridesSchema** (const) `z.ZodPrefault<z.ZodObject<{ perInboxPerDay: z.ZodDefault<z.ZodNullable<z.ZodNumber>>; openersPerDay: z.ZodDefault<z.ZodNullable<z.ZodNumber>>; rampStart: z.ZodDefault<z.ZodNullable<z.ZodString>>; }, z.core.$strict>>`
- **sequencesSettingsSchema** (const) `z.ZodObject<{ niche: z.ZodDefault<z.ZodNullable<z.ZodString>>; senders: z.ZodDefault<z.ZodArray<z.ZodObject<{ address: z.ZodString; name: z.ZodString; signature: z.ZodDefault<z.ZodNullable<z.ZodString>>; suspended: z.ZodDefault<z.ZodBoolean>; }, z.core.$strict>>>; mailsRoleInboxes: z.ZodDefault<z.Zo…`
- **SequencesSettings** (type) `type SequencesSettings = z.infer<typeof sequencesSettingsSchema>;`
- **repliesSettingsSchema** (const) `z.ZodObject<{}, z.core.$strict>`

## packages/channel-email/src/sequences.ts

- **senderFleet** (function) `(settings: Senders): Fleet`
- **sendPolicyFor** (function) `(settings: Sending, base: SendPolicy): SendPolicy`
- **clientSequences** (function) `(main: Db, id: string): Promise<ClientSequences>`
- **clientCampaign** (function) `(base: Campaign, settings: SequencesSettings): Campaign`
- **clientPolicy** (function) `(db: Db, settings: SequencesSettings, base: SendPolicy): Promise<SendPolicy>`
- **sequencesSendScope** (function) `(deps: ClientScopeDeps, key: string): Promise<SendScope | null>`
- **clientReplies** (function) `(main: Db, id: string): Promise<{ settings: SequencesSettings; calcom: string | null } | null>`
- **sharedFor** (function) `(main: Db, client: string): SharedSuppressions`

## packages/channel-email/src/setups.ts

- **emailChecks** (function) `(o: { dbOf: (client: string | null) => Promise<Queryable>; warmupOf: (address: string) => Promise<Warmup | null>; signIn: (address: string) => Promise<SignedIn | null>; }): Record<string, SetupCheck>`
- **DOMAIN_SETUP** (const) `import("@wren/core/setup").Setup`
- **EMAIL_SETUPS** (const) `import("@wren/core/setup").Setup[]`
- **Warmup** (interface) `interface Warmup { start: Date; step: number; limit: number; }`

## packages/channel-email/src/spam/coverage.ts

- **coveringRenders** (function) `(tpl: Template, facts: FactValues): Rendered[]`

## packages/channel-email/src/spam/spamassassin.ts

- **parseReport** (function) `(out: string): SpamScore`
- **startSpamd** (function) `(opts: { dockerDir: string; log?: (line: string) => void; }): Promise<Spamd>`
- **SPAM_LIMIT** (const) `2`
- **SpamScore** (interface) `interface SpamScore { score: number; rules: SpamRule[]; }`

## packages/channel-email/src/state.ts

- **MESSAGE_TRANSITIONS** (const) `TransitionTable<MessageState>`
- **ENROLLMENT_TRANSITIONS** (const) `TransitionTable<EnrollmentState>`
- **CANDIDATE_TRANSITIONS** (const) `TransitionTable<CandidateState>`
- **transitionMessage** (function) `(current: MessageState, next: MessageState): "unknown" | "sent" | "draft" | "approved" | "rejected" | "sending" | "skipped" | "failed"`
- **transitionEnrollment** (function) `(current: EnrollmentState, next: EnrollmentState): "active" | "finished" | "stopped"`
- **transitionCandidate** (function) `(current: CandidateState, next: CandidateState): "rejected" | "verified" | "candidate" | "queued"`

## packages/channel-email/src/verification/checks.ts

- **mailboxOf** (function) `(email: string): string`
- **mailboxForms** (function) `(person: NamedPerson): Set<string>`
- **mailboxFitsName** (function) `(email: string, person: NamedPerson | null, colleagues: readonly NamedPerson[]): CheckOutcome | null`
- **domainIsFirm** (function) `(email: string, firmDomain: string | null): CheckOutcome`
- **worksThere** (function) `(newest: LookupFinding | null): CheckOutcome`
- **titleAgrees** (function) `(heldTitle: string | null, newest: LookupFinding | null): CheckOutcome`
- **pageIsFirm** (function) `(page: CompanyPage | null, firmDomain: string | null, lookupState: string | null): CheckOutcome`
- **phoneAgrees** (function) `(page: CompanyPage | null, importPhone: unknown): CheckOutcome`
- **checkLead** (function) `(input: LeadCheckInput): CheckOutcome[]`
- **NamedPerson** (interface) `interface NamedPerson { readonly id: number; readonly fullName: string; readonly firstName?: string | null; readonly lastName?: string | null; }`
- **LookupFinding** (interface) `interface LookupFinding { readonly id: number; readonly kind: string; readonly confidence: number; readonly value: Record<string, unknown>; }`
- **CompanyPage** (interface) `interface CompanyPage { readonly id: number; readonly value: Record<string, unknown>; }`
- **MOVED_ON_CONFIDENCE** (const) `0.8`
- **LeadCheckInput** (interface) `interface LeadCheckInput { readonly email: string; readonly firmDomain: string | null; readonly person: (NamedPerson & { readonly title: string | null }) | null; readonly colleagues: readonly NamedPerson[]; readonly lookup: LookupFinding | null; readonly page: CompanyPage | null; readonly companyLookupState: string | null; readonly importPhone: unknown; }`

## packages/channel-email/src/verification/domain-health.ts

- **readListAnswer** (function) `(list: DomainList, answer: string): "listed" | "refused" | null`
- **domainStanding** (function) `(target: DomainTarget, resolver: DomainResolver = bounded()): Promise<DomainStanding>`
- **domainStandings** (function) `(targets: readonly DomainTarget[], resolver: DomainResolver = bounded()): Promise<DomainStanding[]>`
- **domainProblems** (function) `(h: DomainStanding): string[]`
- **mailDomainTargets** (function) `(roster: readonly Sender[], mailboxes: Mailboxes, siteBaseUrl: string): DomainTarget[]`
- **DomainResolver** (interface) `interface DomainResolver extends Resolver { resolveNs(host: string): Promise<string[]>; resolveMx(host: string): Promise<{ exchange: string; priority: number }[]>; resolveTxt(host: string): Promise<string[][]>; }`
- **DomainTarget** (interface) `interface DomainTarget { domain: string; fleet: boolean; dkimSelector: string | null; smtpHost: string | null; }`
- **namedDomains** (function) `(text: string): string[]`

## packages/channel-email/src/verification/lead-checks.ts

- **recheckLeads** (function) `(db: Queryable, companyIds: readonly number[]): Promise<RecheckStats>`
- **recheckNiche** (function) `(db: Queryable, niche: string, opts: { chunk?: number; onChunk?: (s: RecheckStats) => void } = {}): Promise<RecheckStats>`

## packages/channel-email/src/verification/local.ts

- **LocalCheck** (interface) `interface LocalCheck { email: string; failure: string | null; flags: readonly LocalFlag[]; mxHosts: readonly string[]; mxPath: MxPath | null; passed: boolean; }`
- **LocalCheckerLike** (interface) `interface LocalCheckerLike { check(email: string): Promise<LocalCheck>; }`

## packages/channel-email/src/verification/mailifier.ts

- **fleetOrder** (function) `(members: readonly T[], domain: string): T[]`
- **defaultLocalChecker** (function) `(): LocalCheckerLike`
- **ProbeVerifier** (class) `readonly name: string;; readonly authoritative; readonly costsCredits; constructor(private readonly probe: MailboxProbe); verify(email: string): Promise<Verdict>`
- **Ready** (type) `type Ready = (host: string) => Promise<boolean>;`
- **READY_TTL_MS** (const) `number`
- **ProbeFleet** (class) `readonly name; constructor(private readonly members: readonly FleetMember[], private readonly ready: Ready = async () => true, private readonly now: () => number = Date.now); verify(email: string): Promise<Verdict>`
- **remoteProbeVerifier** (function) `(urls: string, token: string): EmailVerifier`
- **directProbeVerifier** (function) `(helo: string): EmailVerifier`

## packages/channel-email/src/verification/prober-health.ts

- **isListing** (function) `(list: string, answer: string): boolean`
- **ipStanding** (function) `(host: string, resolver: Resolver = dns): Promise<Pick<ProberHealth, "ip" | "ptr" | "listed">>`
- **proberHealth** (function) `(db: Db, hosts: readonly string[], since: Date, resolver: Resolver = dns): Promise<ProberHealth[]>`
- **proberProblems** (function) `(h: ProberHealth): string[]`
- **Resolver** (interface) `interface Resolver { resolve4(host: string): Promise<string[]>; reverse(ip: string): Promise<string[]>; }`
- **ProberHealth** (interface) `interface ProberHealth { host: string; ip: string | null; ptr: string | null; listed: string[]; checks: number; refused: number; held: number; }`
- **proberHosts** (function) `(urls: string | null | undefined): string[]`

## packages/channel-email/src/verification/retry.ts

- **riskyBackoff** (function) `(row: { email: SQL; checkedAt: SQL; raw: SQL }, fallback: SQL): SQL`
- **riskyHolds** (function) `(v: string, fallback: SQL): SQL`
- **waitingDomains** (function) `(): SQL`
- **SERVER_HOLD_REASONS** (const) `ReadonlySet<string>`

## packages/channel-email/src/verification/service.ts

- **runVerification** (function) `(db: Queryable, verifier: EmailVerifier, opts: VerificationOptions = {}): Promise<VerificationStats>`
- **latestValidCheckedAt** (function) `(): SQL<Date | null>`
- **VerificationStats** (interface) `interface VerificationStats { selected: number; local_invalid: number; local_errors: number; valid: number; invalid: number; risky: number; catch_all: number; held: number; flags: Record<string, number>; aborted: string | null; }`

## packages/channel-email/src/verification/verifier.ts

- **makeVerifier** (function) `(name: string, env: VerifierEnv): Promise<EmailVerifier>`
- **Verdict** (interface) `interface Verdict { result: VerificationResult; raw: Record<string, unknown>; }`
- **EmailVerifier** (interface) `interface EmailVerifier { name: string; authoritative: boolean; costsCredits: boolean; verify(email: string): Promise<Verdict>; }`
- **FakeVerifier** (class) `readonly name; readonly authoritative: boolean;; readonly costsCredits; constructor(opts: { authoritative?: boolean } = {}); verify(email: string): Promise<Verdict>`

## packages/channel-email/src/views.ts

- **latestVerifications** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"latest_verifications", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "latest_verifications"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; i…`
- **emailLlmCalls** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"email_llm_calls", false, { enrichmentId: import("drizzle-orm/pg-core").PgColumn<{ name: "enrichment_id"; tableName: "email_llm_calls"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefaul…`
- **emailStageCosts** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"email_stage_costs", false, { runId: import("drizzle-orm/pg-core").PgColumn<{ name: "run_id"; tableName: "email_stage_costs"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey…`
- **openOutcomes** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"open_outcomes", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "open_outcomes"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: fals…`
- **replyByArmStep** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"reply_by_arm_step", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "reply_by_arm_step"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryK…`
- **rejectionsByReason** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"rejections_by_reason", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "rejections_by_reason"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPr…`
- **verificationYield** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"verification_yield", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "verification_yield"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimar…`
- **sendHealth** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"send_health", false, { sender: import("drizzle-orm/pg-core").PgColumn<{ name: "sender"; tableName: "send_health"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false;…`
- **replyOutcomes** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"reply_outcomes", false, { eventId: import("drizzle-orm/pg-core").PgColumn<{ name: "event_id"; tableName: "reply_outcomes"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; is…`
- **campaignFunnel** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"campaign_funnel", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "campaign_funnel"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: …`
- **enrollmentOutcomes** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"enrollment_outcomes", false, { enrollmentId: import("drizzle-orm/pg-core").PgColumn<{ name: "enrollment_id"; tableName: "enrollment_outcomes"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; h…`
- **contactOutcomes** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"contact_outcomes", false, { enrollmentId: import("drizzle-orm/pg-core").PgColumn<{ name: "enrollment_id"; tableName: "contact_outcomes"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefa…`
- **replyByEvidence** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"reply_by_evidence", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "reply_by_evidence"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryK…`
- **reviewOutcomes** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"review_outcomes", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "review_outcomes"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: …`
- **funnelLatency** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"funnel_latency", false, { companyId: import("drizzle-orm/pg-core").PgColumn<{ name: "company_id"; tableName: "funnel_latency"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false…`
- **pipelineFunnel** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"pipeline_funnel", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "pipeline_funnel"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: …`
- **pipelineLeaks** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"pipeline_leaks", false, { niche: import("drizzle-orm/pg-core").PgColumn<{ name: "niche"; tableName: "pipeline_leaks"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: fa…`
- **llmUsageByMonth** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"llm_usage_by_month", false, { month: import("drizzle-orm/pg-core").PgColumn<{ name: "month"; tableName: "llm_usage_by_month"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: false; hasDefault: false; isPri…`
- **leadSheet** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"lead_sheet", false, { leadId: import("drizzle-orm/pg-core").PgColumn<{ name: "lead_id"; tableName: "lead_sheet"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey…`
- **EMAIL_CONSOLE_VIEWS** (const) `readonly ["pipeline_funnel", "pipeline_leaks", "campaign_funnel", "send_health", "reply_by_arm_step", "verification_yield"]`
- **EMAIL_COST_VIEWS** (const) `readonly ["email_stage_costs", "llm_usage_by_month"]`

## packages/core/src/notify.ts

- **makeNotifier** (function) `(kind: NotifierKind, opts: { discordWebhookUrl?: string | null; discordPingUserId?: string | null; http?: typeof fetch; } = {}): Notifier`
- **NotifyLevel** (type) `type NotifyLevel = "info" | "action" | "warning";`
- **pings** (function) `(level: NotifyLevel): boolean`
- **Notifier** (interface) `interface Notifier { readonly name: string; notify(title: string, body?: string, level?: NotifyLevel): Promise<boolean>; }`
- **NoneNotifier** (class) `readonly name; notify(): Promise<boolean>`
- **ConsoleNotifier** (class) `readonly name; constructor(private readonly write: (line: string) => void = console.log); notify(title: string, body = "", level: NotifyLevel = "info"): Promise<boolean>`
- **DiscordNotifier** (class) `readonly name; constructor(private readonly webhookUrl: string, private readonly http: typeof fetch = fetch, private readonly log: (line: string) => void = console.warn, private readonly pingUserId?: string); notify(title: string, body = "", level: NotifyLevel = "info"): Promise<boolean>`
- **Broadcast** (class) `readonly name: string;; constructor(private readonly subscribers: readonly Notifier[]); notify(title: string, body?: string, level?: NotifyLevel): Promise<boolean>`
- **plural** (function) `(n: number, one: string, many = '${one}s'): string`
- **namedFor** (function) `(notifier: Notifier, who: string): Notifier`

## packages/core/src/restate/form.ts

- **Effect** (type) `type Effect = "spends" | "sends" | "posts";`
- **Form** (interface) `interface Form { input?: z.ZodType; effect?: Effect; ingressPrivate?: true; }`
- **NO_INPUT** (const) `z.ZodPreprocess<z.ZodOptional<z.ZodObject<{}, z.core.$loose>>, unknown>`
- **PORTAL_FIELDS** (const) `{ viewer: z.ZodOptional<z.ZodObject<{}, z.core.$loose>>; client: z.ZodOptional<z.ZodString>; asClient: z.ZodOptional<z.ZodBoolean>; }`
- **formOptions** (function) `(form: Form): { ingressPrivate?: boolean; metadata?: { effect: Effect; }; input?: restate.Serde<unknown>; accept?: string; }`
- **handlerForm** (function) `(handler: unknown): Form | undefined`
- **serviceHandler** (const) `<F>(form: Form, fn: F) => F`
- **exclusiveHandler** (const) `<F>(form: Form, fn: F) => F`
- **sharedHandler** (const) `<F>(form: Form, fn: F) => F`

## packages/core/src/restate/ingress.ts

- **ingressSend** (function) `(ingress: Ingress, to: { service: string; key?: string; handler: string }, idempotencyKey: string, body: unknown = null, delayMs = 0): Promise<void>`
- **Ingress** (interface) `interface Ingress { url: string; headers?: Record<string, string>; }`

## packages/core/src/restate/keys.ts

- **clientOfKey** (function) `(key: string): { client: string; unit: string } | null`
- **clientKey** (function) `(client: string, unit: string): string`
- **unitOfKey** (function) `(key: string): string`

## packages/core/src/restate/limits.ts

- **within** (function) `(ctx: restate.Context, p: Waitable<T>, o: WithinOpts): Promise<T>`
- **answers** (function) `(ctx: restate.Context, p: Waitable<unknown>, call: string): Promise<boolean>`
- **limitedRun** (function) `(ctx: restate.Context, name: string, fn: (signal: AbortSignal) => Promise<T>, o: LimitedRunOpts): Promise<T>`
- **unitLimits** (function) `(ctx: restate.ObjectContext, db: Queryable, service: string): Promise<UnitLimits>`
- **LIMITS** (const) `{ readonly read: number; readonly batch: number; readonly publish: number; readonly desk: number; readonly quick: number; readonly http: number; }`
- **Limits** (type) `type Limits = { [K in keyof typeof LIMITS]: number };`
- **limitsWith** (function) `(over?: Partial<Limits>): Limits`
- **TimedOut** (interface) `interface TimedOut { call: string; unit: string | null; ms: number; held?: boolean; }`
- **CallTimeout** (class) `override name; constructor(readonly call: string, readonly ms: number, note?: string)`
- **timeoutsOf** (function) `(ctx: object): TimedOut[]`
- **UnitLimits** (interface) `interface UnitLimits { stage: string; skip(unit: string, group?: string): boolean; within<T>(unit: string, p: Waitable<T>, o: UnitWithinOpts): Promise<T>; guard<T>(unit: string, fn: () => Promise<T>, group?: string): Promise<T>; }`
- **limitStage** (function) `(service: string, key: string): string`

## packages/core/src/restate/loop.ts

- **loopState** (function) `(ctx: AnyObjectContext): Promise<LoopState<L>>`
- **writeLoop** (function) `(ctx: restate.ObjectContext, patch: Partial<LoopState<L>>): Promise<LoopState<L>>`
- **lastPass** (function) `(ctx: AnyObjectContext): Promise<L | null>`
- **setLastPass** (function) `(ctx: restate.ObjectContext, outcome: L): Promise<void>`
- **retryDelayMs** (function) `(failures: number, capMs: number): number`
- **stoppedPass** (function) `(ctx: restate.ObjectContext, now: Date, why: string): Promise<PassOutcome<S>>`
- **pausedPass** (function) `(ctx: restate.ObjectContext, now: Date, why: string, delayMs: number): Promise<PassOutcome<S>>`
- **failuresInARow** (function) `(ctx: restate.ObjectContext, failed: boolean): Promise<number>`
- **loopSettings** (function) `(ctx: restate.ObjectContext | restate.ObjectSharedContext): Promise<T | null>`
- **errorText** (function) `(err: unknown): string`
- **formatDelay** (function) `(ms: number): string`
- **runPass** (function) `(ctx: restate.ObjectContext, db: Db, now: Date, spec: PassSpec<S>): Promise<PassOutcome<S>>`
- **notifyErrorEdges** (function) `(ctx: restate.ObjectContext, notifier: Notifier, stage: string, previous: PassOutcome<S> | null, outcome: PassOutcome<S>): Promise<void>`
- **failsThePass** (function) `(err: unknown): boolean`
- **makeLoopObject** (function) `(name: string, pass: (ctx: restate.ObjectContext) => Promise<PassOutcome<S>>, hooks: LoopHooks<A, X> = {}): restate.VirtualObjectDefinition<string, X & Record<A, (ctx: restate.ObjectContext) => Promise<PassOutcome<S>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<S>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) => Promise<LoopStatus<S>>; wake: (ctx: rest…`
- **LOOP** (const) `"loop"`
- **MIN_DELAY_MS** (const) `1000`
- **PassOutcome** (interface) `interface PassOutcome<S> { stats: S | null; error: string | null; failures: number; delayMs: number; now: string; stopped?: string; paused?: string; timeouts?: TimedOut[]; }`
- **LoopStatus** (interface) `interface LoopStatus<S> { key: string; running: boolean; last: PassOutcome<S> | null; settings: Record<string, unknown> | null; }`

## packages/core/src/schema.ts

- **NewTemplateVersion** (type) `type NewTemplateVersion = typeof templateVersions.$inferInsert;`
- **TemplateVersion** (type) `type TemplateVersion = typeof templateVersions.$inferSelect;`
- **templateVersions** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "template_versions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "template_versions"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefaul…`

## packages/core/src/slots/kinds.ts

- **parseKind** (function) `(kind: TemplateKind, name: string, source: string): Template`
- **renderKind** (function) `(kind: TemplateKind, tpl: Template, facts: FactValues, seed: string, allocation?: Allocation): Rendered`
- **checkSource** (function) `(kind: TemplateKind, key: string, source: string, rules: SlotRules = {}): { source: string; template: Template } | null`
- **sampleRender** (function) `(kind: TemplateKind, tpl: Template, facts: FactValues): string`
- **TEMPLATE_KINDS** (const) `readonly ["email", "sms", "dm", "post", "prompt"]`
- **TemplateKind** (type) `type TemplateKind = (typeof TEMPLATE_KINDS)[number];`
- **squeeze** (function) `(assembled: string): string`
- **SlotRules** (interface) `interface SlotRules { readonly fields?: readonly string[]; readonly mustSayStop?: boolean; readonly mustUse?: readonly string[]; readonly minLength?: number; readonly maxLength?: number; }`

## packages/core/src/slots/parse.ts

- **loadTemplates** (function) `(directory: string): Map<string, Template>`
- **parseTemplate** (function) `(name: string, rawSource: string): Template`
- **parseBody** (function) `(name: string, source: string): Template`
- **toSource** (function) `(tpl: Template, opts: { nameAll?: boolean } = {}): string`
- **AuthoringError** (class) `override readonly name`

## packages/core/src/slots/pickers.ts

- **rule** (function) `(fact: string, pattern: string, option: number): Rule`
- **rulePick** (function) `(rules: readonly Rule[]): RulePick`
- **factText** (function) `(value: unknown): string | null`
- **pickOption** (function) `(picker: Picker, variant: string, eligible: readonly number[], seed: string, facts: FactValues, shares?: readonly number[]): number`
- **FactValues** (type) `type FactValues = Readonly<Record<string, unknown>>;`
- **fact** (function) `(facts: FactValues, key: string): unknown`
- **Rule** (interface) `interface Rule { readonly fact: string; readonly pattern: string; readonly option: number; }`
- **Picker** (type) `type Picker = HashPick | RulePick | FixedPick;`
- **HASH_PICK** (const) `HashPick`

## packages/core/src/slots/preview.ts

- **fieldKeys** (function) `(tpl: Template): string[]`
- **promptLabel** (function) `(prompt: string): string`
- **placeholderFacts** (function) `(tpl: Template): Record<string, string>`
- **variantCounts** (function) `(tpl: Template): Record<string, number>`
- **enumerateRenders** (function) `(tpl: Template, facts: FactValues): Generator<[choices: Record<string, number>, rendered: Rendered]>`

## packages/core/src/slots/pyrepr.ts

- **pyReprStr** (function) `(text: string): string`
- **pyRepr** (function) `(value: PyValue): string`
- **PyValue** (type) `type PyValue = string | null | readonly PyValue[];`

## packages/core/src/slots/tree.ts

- **text** (function) `(value: string): TextBlock`
- **field** (function) `(key: string, fallback: string | null = null): FieldBlock`
- **slot** (function) `(prompt: string): FieldBlock`
- **variants** (function) `(name: string, options: readonly OptionInput[], picker: Picker = HASH_PICK, named = false): VariantsBlock`
- **group** (function) `(blocks: readonly (TextBlock | FieldBlock | VariantsBlock)[]): GroupBlock`
- **variantPoints** (function) `(blocks: readonly Block[]): Generator<VariantsBlock>`
- **templateVersion** (function) `(subject: readonly Block[] | null, body: readonly Block[]): string`
- **template** (function) `(name: string, subject: readonly Block[] | null, body: readonly Block[]): Template`
- **render** (function) `(tpl: Template, facts: FactValues, seed: string, allocation?: Allocation, style: RenderStyle = {}): Rendered`
- **tidy** (function) `(input: string): string`
- **slots** (function) `(tpl: Template): ReadonlyMap<string, string>`
- **factKeys** (function) `(tpl: Template): ReadonlySet<string>`
- **MissingFactError** (class) `override readonly name`
- **TextBlock** (interface) `interface TextBlock { readonly kind: "text"; readonly text: string; }`
- **FieldBlock** (interface) `interface FieldBlock { readonly kind: "field"; readonly key: string; readonly fallback: string | null; readonly prompt?: string; }`
- **VariantsBlock** (interface) `interface VariantsBlock { readonly kind: "variants"; readonly name: string; readonly options: readonly Option[]; readonly picker: Picker; readonly named?: true; }`
- **Block** (type) `type Block = TextBlock | FieldBlock | VariantsBlock | GroupBlock;`
- **Template** (interface) `interface Template { readonly name: string; readonly subject: readonly Block[] | null; readonly body: readonly Block[]; readonly version: string; }`
- **slotKey** (function) `(prompt: string): string`
- **optionText** (function) `(o: Option): string`
- **alleleKey** (function) `(o: Option): string`
- **RenderProvenance** (interface) `interface RenderProvenance { readonly template: string; readonly version: string; readonly seed: string; readonly picks: Readonly<Record<string, number>>; readonly snapshot?: number; readonly fields: readonly string[]; readonly fallbacks: readonly string[]; }`
- **Rendered** (interface) `interface Rendered { readonly subject: string | null; readonly body: string; readonly provenance: RenderProvenance; }`
- **Allocation** (interface) `interface Allocation { readonly snapshot: number; readonly shares: Readonly<Record<string, readonly number[]>>; }`
- **RenderStyle** (interface) `interface RenderStyle { readonly finish?: (assembled: string) => string; readonly exact?: boolean; }`

## packages/core/src/stats.ts

- **formatRate** (function) `(successes: number, trials: number): string`
- **Interval** (interface) `interface Interval { readonly low: number; readonly high: number; }`
- **wilsonInterval** (function) `(successes: number, trials: number, z = Z_95): Interval`

## packages/core/src/suppress.ts

- **AddSuppressionInput** (interface) `interface AddSuppressionInput { kind: SuppressionKind; value: string; reason: SuppressionReason; evidence?: Evidence; }`
- **addSuppression** (function) `(db: Queryable, input: AddSuppressionInput): Promise<{ row: Suppression; created: boolean }>`
- **Evidence** (type) `type Evidence = Record<string, unknown> | null;`
- **liftSuppression** (function) `(db: Queryable, input: { kind: SuppressionKind; value: string; evidence?: Evidence; now?: Date }): Promise<Suppression | null>`
- **normalizeValue** (function) `(kind: SuppressionKind, value: string): string`

## packages/core/src/time.ts

- **canonicalZone** (function) `(zone: string): string | null`
- **assertInstant** (function) `(at: Date): Date`
- **wallClock** (function) `(zone: string, at: Date): WallClock`
- **offsetMinutes** (function) `(zone: string, at: Date): number`
- **zonedInstant** (function) `(zone: string, year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date`
- **dayEnd** (function) `(zone: string, at: Date): Date`
- **dayStart** (function) `(zone: string, at: Date): Date`
