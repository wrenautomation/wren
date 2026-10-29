# @wren/outreach: interface

Exports: 524. Files: 55.

## packages/channel-reddit/src/warmup.ts

- **Warmup** (interface) `interface Warmup { stage: WarmupStage; caps: WarmupCaps; ageDays: number; karma: number; next: string; frozen: string | null; }`
- **WarmupStage** (type) `type WarmupStage = "lurk" | "comment" | "post" | "reach";`
- **warmupOf** (function) `(health: AccountHealth, now: Date): Warmup`

## packages/outreach/src/accounts.ts

- **AccountView** (interface) `interface AccountView extends Omit<ReachAccount, "health"> { health: AccountHealth | null; standing: Standing; }`
- **HealthStats** (interface) `interface HealthStats { checked: number; frozen: string[]; errors: string[]; }`
- **accountById** (function) `(db: Queryable, id: string): Promise<ReachAccount>`
- **activeAccounts** (function) `(db: Queryable, platform?: Platform | null): Promise<ReachAccount[]>`
- **addAccount** (function) `(db: Queryable, req: { platform: Platform; account: string; now: Date }): Promise<ReachAccount>`
- **healthOf** (function) `(a: ReachAccount): AccountHealth | null`
- **lastTouches** (function) `(db: Queryable): Promise<Record<string, string>>`
- **listAccounts** (function) `(db: Queryable, platform?: Platform | null): Promise<ReachAccount[]>`
- **platformOf** (function) `(text: string): Platform`
- **recordAccountsOf** (function) `(db: Queryable): Promise<RecordAccount[]>`
- **refreshHealth** (function) `(db: Queryable, accounts: readonly ReachAccount[], channelFor: (a: ReachAccount) => OutreachChannel | null, now: Date): Promise<HealthStats>`
- **setAccountState** (function) `(db: Queryable, id: string, state: AccountState, o: { reason?: string | null; now: Date }): Promise<ReachAccount>`
- **viewOf** (function) `(a: ReachAccount, policy: ReachPolicy, now: Date): AccountView`

## packages/outreach/src/clients.ts

- **ClientReach** (type) `type ClientReach = | { kind: "gone"; why: string } | { kind: "work"; client: Client; parts: ReachPart[]; logins: ClientLogin[]; skipped: string[]; };`
- **ReachPart** (type) `type ReachPart = (typeof REACH_PARTS)[number];`
- **clientReach** (function) `(main: Queryable, id: string, wants: readonly ReachPart[]): Promise<ClientReach>`
- **clientSends** (function) `(client: Pick<Client, "sends">, globalLive: boolean): (kind: string) => boolean`
- **loginsOf** (function) `(accounts: Readonly<Record<string, string>>, wren: ReadonlySet<string>): { logins: ClientLogin[]; skipped: string[] }`
- **syncLogins** (function) `(db: Queryable, logins: readonly ClientLogin[], now: Date): Promise<ReachAccount[]>`

## packages/outreach/src/comments.ts

- **COMMENTS_FLOW** (const) `"reach.comments"`
- **COMMENTS_FROM** (const) `"read.comment"`
- **answerComment** (function) `(db: Queryable, ch: OutreachChannel, req: { id: number; body: string; now: Date }): Promise<{ ref: string | null }>`
- **answerFor** (function) `(c: Pick<Comment, "platform" | "ref" | "post" | "parent" | "author">, body: string): { target: string; text: string }`
- **askedInWords** (function) `(text: string): boolean`
- **checkCanDm** (function) `(account: ReachAccount, now: Date): void`
- **checkThread** (function) `(authors: readonly string[], others: readonly string[]): void`
- **commentById** (function) `(db: Queryable, id: number): Promise<Comment>`
- **commentEvent** (function) `(c: Pick<Comment, "id" | "platform" | "author" | "post">): { subject: string; kind: "comment"; data: { commentId: number; platform: import("@wren/core").Platform; author: string; post: string; }; }`
- **dmCommenter** (function) `(db: Queryable, req: { id: number; body: string; subject?: string | null; now: Date }): Promise<{ contactId: number; messageId: number }>`
- **dmDoorOf** (function) `(c: Pick<Comment, "platform" | "accountId">): DmDoor`
- **dropComment** (function) `(db: Queryable, id: number, o: { by?: string; reason?: RejectReason | null; note?: string | null } = {}): Promise<void>`
- **keepComments** (function) `(db: Queryable, account: Pick<ReachAccount, "id" | "platform">, items: readonly CommentIn[], ours: readonly string[]): Promise<Array<Pick<Comment, "id" | "platform" | "author" | "post">>>`
- **markAnswered** (function) `(db: Queryable, id: number, r: { body: string; ref: string | null; now: Date; by?: string; via?: "person" | "wren" }): Promise<void>`
- **noiseInWords** (function) `(text: string, kind?: string): string | null`
- **planAnswer** (function) `(db: Queryable, id: number, now: Date): Promise<AnswerPlan>`
- **planPrivateReply** (function) `(db: Queryable, id: number, now: Date): Promise<Comment>`
- **privateReplied** (function) `(db: Queryable, c: Comment, o: { body: string; ref: string | null; now: Date; by?: string | null; via?: "person" | "wren" }): Promise<{ contactId: number; messageId: number }>`
- **promptFor** (function) `(c: Comment): string`
- **sortComment** (function) `(db: Db, llm: LlmClient | null, id: number, guide?: CommentGuide, facts: readonly string[] = []): Promise<CommentSort | null>`
- **sortStep** (function) `(db: Db, llm: LlmClient | null, guide?: CommentGuide, forClient?: ( client: string, ) => Promise<{ db: Db; llm: LlmClient | null; guide?: CommentGuide }>, facts?: () => Promise<readonly string[]>): Step`
- **systemFor** (function) `(platform: string, guide = "", facts: readonly string[] = []): string`

## packages/outreach/src/components.ts

- **OUTREACH_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **OUTREACH_WORKFLOWS** (const) `import("@wren/core/workflows").Workflow[]`

## packages/outreach/src/contacts.ts

- **AddStats** (interface) `interface AddStats { added: number; known: number; }`
- **addContact** (function) `(db: Queryable, req: { platform: Platform; handle: string; name?: string | null; niche?: string | null }): Promise<ReachContact>`
- **addProspects** (function) `(db: Queryable, platform: Platform, prospects: readonly Prospect[], o: { niche?: string | null } = {}): Promise<AddStats>`
- **contactByHandle** (function) `(db: Queryable, platform: Platform, handle: string): Promise<ReachContact>`
- **contactById** (function) `(db: Queryable, id: number): Promise<ReachContact>`
- **contactsById** (function) `(db: Queryable, ids: readonly number[]): Promise<Map<number, ReachContact>>`
- **enrichContact** (function) `(db: Queryable, contact: ReachContact, channel: OutreachChannel, now: Date): Promise<Profile>`
- **fieldsFor** (function) `(contact: ReachContact, sender: string): RenderFields`
- **listContacts** (function) `(db: Queryable, f: { platform?: Platform | null; state?: ContactState | null; limit?: number } = {}): Promise<ReachContact[]>`
- **loadByAccount** (function) `(db: Queryable, platform: Platform): Promise<Map<string, number>>`
- **profileOf** (function) `(c: ReachContact): Profile | null`
- **setContactState** (function) `(db: Queryable, id: number, state: ContactState, o: { reason?: string | null; now: Date; ended?: boolean }): Promise<void>`

## packages/outreach/src/decide.ts

- **commentSource** (const) `DecideSource`
- **commentsCalled** (function) `(db: Queryable, limit: number): Promise<DecideSubject[]>`
- **commentsDue** (function) `(db: Queryable, now: Date, limit: number): Promise<DecideSubject[]>`

## packages/outreach/src/discovery/people.ts

- **keepPerson** (function) `(db: Queryable, p: Profile, read: Awaited<ReturnType<typeof readWords>>, now: Date): Promise<RedditPerson>`
- **peopleToRead** (function) `(db: Queryable, ours: string[], now: Date, limit: number): Promise<string[]>`
- **personFacts** (function) `(p: Profile, now: Date): PersonFacts`
- **personLine** (function) `(p: Pick<RedditPerson, "read" | "fit" | "site">): string | null`
- **readPerson** (function) `(r: Reader, db: Queryable, llm: LlmClient | null, handle: string, o: { audience: string; now: Date; step?: <T>(name: string, fn: () => Promise<T>) => Promise<T> }): Promise<RedditPerson>`
- **readWords** (function) `(llm: LlmClient, p: Profile, audience: string): Promise<{ read: PersonRead; fit: number; site: string | null } | null>`
- **wordsOf** (function) `(p: Profile): string`

## packages/outreach/src/discovery/places.ts

- **Audience** (type) `type Audience = z.infer<typeof discoverySettingsSchema>;`
- **KARMA_PLACES** (const) `readonly ["NoStupidQuestions", "CasualConversation", "careerguidance", "productivity", "Entrepreneur", "excel", "googlesheets", "answers", "getdisciplined", "learnprogramming", "nocode", "automation"]`
- **PLACE_FRESH_MS** (const) `number`
- **WREN_ABOUT** (const) `"Medium-sized businesses that charge a lot per client: agencies, consultancies, recruiters, B2B services, clinics and firms like them. Owners and operators who sell, deliver and hire."`
- **WREN_AUDIENCE** (const) `Audience`
- **accountFor** (function) `(db: Queryable, place: RedditPlace, now: Date): Promise<string | null>`
- **addKarmaPlaces** (function) `(db: Queryable, subs: readonly string[] = KARMA_PLACES): Promise<number>`
- **addPlaces** (function) `(db: Queryable, found: { name: string; foundBy: string; subscribers?: number | null }[]): Promise<number>`
- **discoverySettingsSchema** (const) `z.ZodObject<{ about: z.ZodDefault<z.ZodString>; topics: z.ZodDefault<z.ZodArray<z.ZodString>>; subreddits: z.ZodDefault<z.ZodArray<z.ZodString>>; minMembers: z.ZodDefault<z.ZodNumber>; minPostsADay: z.ZodDefault<z.ZodNumber>; exaSearches: z.ZodDefault<z.ZodNumber>; autoSend: z.ZodDefault<z.ZodBoolea…`
- **failPlace** (function) `(db: Queryable, sub: string, why: string, now: Date): Promise<void>`
- **joined** (function) `(db: Queryable, sub: string, now: Date): Promise<void>`
- **judgePlace** (function) `(llm: LlmClient, sub: string, read: PlaceRead, audience: Audience, purpose: PlacePurpose = "reach"): Promise<PlaceJudged | null>`
- **keepPlace** (function) `(db: Queryable, sub: string, read: PlaceRead, judged: PlaceJudged | null, now: Date): Promise<{ rulesChanged: boolean }>`
- **movePlace** (function) `(db: Queryable, sub: string, account: string): Promise<void>`
- **paceOf** (function) `(latest: readonly Post[]): { postsADay: number; medianComments: number }`
- **placeBySub** (function) `(db: Queryable, sub: string): Promise<RedditPlace>`
- **placesDue** (function) `(db: Queryable, now: Date, everyMs: number, limit: number, purpose: PlacePurpose = "reach"): Promise<{ subreddit: string; name: string; foundBy: string; raw: unknown; judged: PlaceJudged | null; fit: number | null; subscribers: number | null; state: "skipped" | "found" | "watching"; purpose: "reach" | "karma"; accountId: string | null; readAt: Date | null; threadsAt: Date | null; joinedAt: …`
- **placesOfPeople** (function) `(db: Queryable): Promise<string[]>`
- **placesToJoin** (function) `(db: Queryable, limit: number): Promise<{ subreddit: string; account: string; }[]>`
- **placesToRead** (function) `(db: Queryable, now: Date, limit: number): Promise<{ subreddit: string; state: "skipped" | "found" | "watching"; purpose: "reach" | "karma"; }[]>`
- **settleKarmaPlace** (function) `(db: Queryable, sub: string, now: Date): Promise<RedditPlace["state"] | null>`
- **skipPlace** (function) `(db: Queryable, sub: string): Promise<void>`
- **threadsRead** (function) `(db: Queryable, sub: string, now: Date): Promise<void>`
- **topicsOf** (function) `(llm: LlmClient | null, a: Audience): Promise<string[]>`
- **watchPlace** (function) `(db: Queryable, sub: string, now: Date): Promise<{ account: string | null }>`

## packages/outreach/src/discovery/reads.ts

- **PUBLIC_SITE** (const) `"reddit-public"`
- **PlaceRead** (interface) `interface PlaceRead { about: SubredditAbout; rules: unknown; top: Post[]; latest: Post[]; }`
- **Post** (type) `type Post = Thing & { subreddit?: string; url?: string; over_18?: boolean; locked?: boolean; archived?: boolean; stickied?: boolean; removed_by_category?: string | null; link_flair_text?: string | null; };`
- **Reader** (interface) `interface Reader { person(handle: string): Promise<Profile>; searchPlaces(topic: string): Promise<{ name: string; subscribers: number }[]>; exaPlaces(topic: string): Promise<string[]>; place(sub: string): Promise<PlaceRead>; latest(subs: readonly string[], since: number, pages?: number): Promise<Post[]>; thread(id: string): Promise<{ post: Post; comments: (Thing & { depth: number })[] }>; info(ids: string[]): Promise<Thing[]>; }`
- **SUBS_PER_READ** (const) `25`
- **itemsOf** (function) `(l: Listing | undefined): T[]`
- **reader** (function) `(sites: SiteClient, as?: string): Reader`
- **signedOut** (function) `(sites: SiteClient): SiteClient`
- **subredditsIn** (function) `(urls: readonly string[]): string[]`

## packages/outreach/src/discovery/requirements.ts

- **AccountStanding** (interface) `interface AccountStanding { account: string; ageDays: number | null; karma: number | null; commentKarma: number | null; }`
- **Gate** (interface) `interface Gate { ok: boolean; reason: string | null; accountId: string | null; switched: boolean; need: Need; hold: boolean; }`
- **NO_NEED** (const) `Need`
- **Need** (interface) `interface Need { minAgeDays: number | null; minKarma: number | null; minCommentKarma: number | null; other: string | null; }`
- **ThreadHeld** (class) ``
- **applyGates** (function) `(db: Queryable, now: Date): Promise<Map<string, Gate>>`
- **backfillFromProofs** (function) `(db: Queryable): Promise<number>`
- **clearGate** (function) `(db: Queryable, subName: string, now: Date): Promise<number>`
- **decide** (function) `(name: string, pinned: string | null, need: Need & { hold: boolean }, pool: readonly { id: string; standing: AccountStanding }[]): Gate`
- **effectiveNeed** (function) `(rows: readonly RedditRequirement[]): Need & { hold: boolean }`
- **gateList** (function) `(db: Queryable, now: Date): Promise<GateRow[]>`
- **gatesFor** (function) `(db: Queryable, subs: readonly string[] | null, now: Date): Promise<Map<string, Gate>>`
- **holdsThread** (function) `(g: Gate | undefined, picked: boolean): boolean`
- **keepRulesNeed** (function) `(db: Queryable, sub: string, judged: PlaceJudged | null, rules: string): Promise<void>`
- **learnFromProof** (function) `(db: Queryable, item: string, proof: { state: string; note: string | null; checkedAt: string }): Promise<boolean>`
- **learnText** (function) `(db: Queryable, subName: string, text: string, now: Date): Promise<Need>`
- **parseNeed** (function) `(raw: string): Need`
- **setNeed** (function) `(db: Queryable, subName: string, need: Partial<Need>, note: string | null): Promise<void>`
- **shortfall** (function) `(need: Need, s: AccountStanding): Shortfall`
- **standingOfAccount** (function) `(a: ReachAccount, now: Date): AccountStanding`

## packages/outreach/src/discovery/threads.ts

- **KARMA_FRESH_MS** (const) `number`
- **RANK_BATCH** (const) `10`
- **SLOT_WITHIN_MS** (const) `number`
- **ThreadRead** (interface) `interface ThreadRead { post: Post; comments: Array<{ name: string; author?: string; body?: string; depth: number; score?: number }>; }`
- **commentsToday** (function) `(db: Queryable, accountId: string, now: Date): Promise<number>`
- **dayStart** (function) `(now: Date): Date`
- **draftThread** (function) `(db: Queryable, llm: LlmClient, id: string, o: { read: ThreadRead; op: RedditPerson | null; facts: readonly { label: string; text: string }[]; truths?: readonly string[]; voice: string; ours: readonly string[]; posts?: readonly OurPost[]; karma?: boolean; }): Promise<"drafted" | "dropped" | "unread">`
- **dropReason** (function) `(p: Post, o: { now: Date; ours: readonly string[]; judged: PlaceJudged | null; purpose?: PlacePurpose }): string | null`
- **expireStale** (function) `(db: Queryable, now: Date): Promise<number>`
- **factsFor** (function) `(words: string, facts: readonly { label: string; text: string }[], n = 2): { label: string; text: string }[]`
- **inKarmaPlace** (const) `import("drizzle-orm").SQL<boolean>`
- **keepScores** (function) `(db: Queryable, scores: readonly { ref: string; score: number }[], now: Date): Promise<void>`
- **keepThreads** (function) `(db: Queryable, sub: string, posts: readonly Post[], o: { now: Date; ours: readonly string[]; judged: PlaceJudged | null; purpose?: PlacePurpose }): Promise<string[]>`
- **markCommented** (function) `(db: Queryable, id: string, r: { body: string; ref: string | null; accountId: string; now: Date; by?: string }): Promise<void>`
- **pitchIn** (function) `(text: string): string | null`
- **planThreadComment** (function) `(db: Queryable, id: string, now: Date): Promise<CommentPlan>`
- **queueThreads** (function) `(db: Queryable, sub: string, now: Date): Promise<string[]>`
- **rankThreads** (function) `(db: Queryable, llm: LlmClient, ids: readonly string[], audience: Audience, purpose: PlacePurpose = "reach"): Promise<number>`
- **roomFor** (function) `(purpose: PlacePurpose, caps: { comments: number; reachComments: number }, used: PlaceUse): number`
- **skipThread** (function) `(db: Queryable, id: string, o: { by?: string; reason?: RejectReason | null; note?: string | null } = {}): Promise<void>`
- **threadsToDraft** (function) `(db: Queryable, limit: number, now = new Date()): Promise<{ id: string; author: string; accountId: string | null; karma: boolean; }[]>`
- **threadsToScore** (function) `(db: Queryable, now: Date, limit = 50): Promise<{ id: string; ref: string | null; }[]>`
- **unrankedThreads** (function) `(db: Queryable, sub: string, purpose: PlacePurpose = "reach"): Promise<string[]>`

## packages/outreach/src/draft-accounts.ts

- **accountPickFor** (function) `(db: Queryable, item: string, now = new Date()): Promise<AccountPick | null>`
- **pickAccount** (function) `(db: Queryable, req: { item: string; account: string | null; by?: string | null; now?: Date }): Promise<AccountPick | null>`
- **pickedAccount** (function) `(db: Queryable, item: string): Promise<string | null>`
- **pickedAccounts** (function) `(db: Queryable, items: readonly string[]): Promise<Map<string, string>>`
- **pickedReachAccount** (function) `(db: Queryable, item: string): Promise<ReachAccount | null>`

## packages/outreach/src/draft-llm.ts

- **ArmedLlm** (class) `readonly name: string;; readonly provider: string;; constructor(private readonly base: LlmClient, private readonly arms: () => Promise<readonly DraftArm[]>, private readonly client: (model: string) => LlmClient | null); complete(prompt: string, opts?: CompleteOptions): Promise<LlmResponse>; forItem(item: string): Promise<Picked>`
- **Picked** (interface) `interface Picked { llm: LlmClient; arm: string | null; }`
- **armMeta** (function) `(arm: string | null): Record<string, unknown>`
- **guardBy** (function) `(p: Picked): string | null`
- **modelFor** (function) `(llm: LlmClient, item: string): Promise<Picked>`
- **savedArms** (function) `(db: Queryable): () => Promise<readonly { model: string; weight: number; }[]>`

## packages/outreach/src/draft-models.ts

- **draftScorecard** (function) `(db: Queryable, since: Date): Promise<Scorecard>`
- **parseSince** (function) `(v: string, now: Date): Date | null`
- **scoredFrom** (function) `(item: string, steps: readonly Step[]): Omit<ScoredDraft, "proof" | "replies"> | null`

## packages/outreach/src/drafts.ts

- **BRIEF** (const) `string`
- **DRAFTS_PER_DAY** (const) `30`
- **DRAFT_MAX** (const) `1000`
- **DmGuide** (type) `type DmGuide = (platform: DmPlatform) => Promise<string>;`
- **contactsToDraft** (function) `(db: Queryable, limit: number, now = new Date()): Promise<number[]>`
- **dmContext** (function) `(db: Queryable, contactId: number, now = new Date()): Promise<{ contact: { name: string | null; id: number; niche: string | null; url: string; state: "finished" | "enrolled" | "replied" | "new" | "opted_out" | "unreachable" | "connected" | "blocked"; createdAt: Date; draft: string | null; personId: number | null; companyId: number | null; endedAt: Date…`
- **draftDm** (function) `(db: Queryable, llm: LlmClient, contactId: number, o: { sender: string; guide?: DmGuide; facts?: readonly string[]; now: Date; }): Promise<string | null>`
- **draftsToday** (function) `(db: Queryable, now: Date): Promise<number>`
- **queueDraft** (function) `(db: Queryable, contact: ReachContact, body: string | null | undefined, subject: string | null, now: Date, by = "console"): Promise<{ kind: "manual" | "inbound" | "sequence" | "follow_up" | "connect"; runId: string | null; id: number; state: "proposed" | "unknown" | "sent" | "sending" | "skipped" | "failed" | "queued" | "received"; createdAt: Date; step: number | null; template: string | null; templateVersion: string | n…`

## packages/outreach/src/enroll.ts

- **EnrollOptions** (interface) `interface EnrollOptions { sequence: ReachSequence; sender: string; contactIds?: readonly number[]; ordered?: boolean; first?: "queued" | "proposed"; enrichedOnly?: boolean; limit: number; take?: number; account?: string; now: Date; runId?: string | null; }`
- **EnrollStats** (interface) `interface EnrollStats { considered: number; enrolled: number; noAccount: boolean; leadBusy: number; }`
- **enroll** (function) `(db: Queryable, o: EnrollOptions): Promise<EnrollStats>`

## packages/outreach/src/examples.ts

- **COMMENT_KINDS_LEARNED** (const) `readonly ["comment", "thread", "post_comment"]`
- **CommentExample** (interface) `interface CommentExample { item: string; kind: LearnedKind; platform: string | null; yes: boolean; text: string; reason: RejectReason | null; note: string | null; about: string; at: Date; }`
- **EXAMPLES_MAX** (const) `6`
- **commentDecisions** (function) `(db: Queryable, kinds: readonly LearnedKind[] = COMMENT_KINDS_LEARNED, now = new Date()): Promise<CommentExample[]>`
- **commentExamples** (function) `(db: Queryable, o: { kinds?: readonly LearnedKind[]; about: string; limit?: number; now?: Date }): Promise<CommentExample[]>`
- **examplesBlock** (function) `(examples: readonly CommentExample[]): string`
- **examplesFor** (function) `(db: Queryable, kinds: readonly LearnedKind[], about: string): Promise<string>`
- **pickExamples** (function) `(pool: readonly CommentExample[], about: string, limit = EXAMPLES_MAX): CommentExample[]`
- **termsOf** (function) `(text: string): Set<string>`

## packages/outreach/src/follow-ups.ts

- **Applied** (interface) `interface Applied { kept: Array<Pick<Comment, "id" | "platform" | "author" | "post">>; answered: number[]; }`
- **COMMENTS_READ** (const) `"comments.read"`
- **ContextNode** (interface) `interface ContextNode { ref: string; parent: string; handle: string; text: string; at: string; url: string | null; ours: boolean; row: { id: number; state: string } | null; }`
- **THREAD_FLOOR_MS** (const) `number`
- **THREAD_IDLE_MS** (const) `number`
- **THREAD_READS_PER_PASS** (const) `3`
- **ThreadContext** (interface) `interface ThreadContext { platform: string; post: ContextPost; nodes: ContextNode[]; focus: string; readAt: string | null; more: number; refresh: boolean; }`
- **adoptNode** (function) `(db: Queryable, from: number, ref: string): Promise<number>`
- **applyThread** (function) `(db: Queryable, t: CommentThread, account: Pick<ReachAccount, "id" | "platform">, read: ThreadRead, ours: readonly string[], now: Date, r: number, days: number): Promise<Applied>`
- **asThread** (function) `(t: CommentThread): CommentThread`
- **commentsReadSettings** (function) `(block: unknown): CommentsReadSettings`
- **commentsReadSettingsSchema** (const) `z.ZodObject<{ followUpDays: z.ZodDefault<z.ZodNumber>; }, z.core.$strict>`
- **dueThreads** (function) `(db: Queryable, now: Date, accounts: readonly string[]): Promise<CommentThread[]>`
- **focusesOf** (function) `(read: ThreadRead, ours: readonly string[], limit = FOCUS_READS): string[]`
- **followUpsOf** (function) `(read: ThreadRead, scope: FollowUpScope): CommentIn[]`
- **mergeReads** (function) `(base: ThreadRead, more: readonly ThreadRead[]): ThreadRead`
- **needsRead** (function) `(t: CommentThread, count: number | undefined, now: Date): boolean`
- **nextCheckAt** (function) `(activeAt: Date, now: Date, r: number): Date`
- **probed** (function) `(db: Queryable, id: number, at: Date): Promise<void>`
- **threadContextOf** (function) `(db: Queryable, id: number, postOf?: (platform: string, post: string) => Promise<Partial<ContextPost> | null>): Promise<ThreadContext | null>`
- **threadFor** (function) `(db: Queryable, id: number, now = new Date(), days = 7): Promise<{ thread: CommentThread; account: ReachAccount } | null>`
- **watchFromComments** (function) `(db: Queryable, now: Date, days: number, platforms: readonly string[]): Promise<number>`
- **wrenCommentsRead** (function) `(db: Queryable): Promise<{ followUpDays: number; }>`

## packages/outreach/src/follow.ts

- **reachCadence** (function) `(seq: ReachSequence): Workflow`
- **reachLead** (function) `(contactId: number): ExecutorEvent`
- **touchStep** (function) `(db: Queryable, o: Pick<TickOptions, "sequences" | "sender">, clientDb?: (client: string) => Queryable, follow?: FollowDms): Step`

## packages/outreach/src/invites.ts

- **DRIFT_ERROR** (const) `"drift:"`
- **INVITES_COMPONENT** (const) `"linkedin.invites"`
- **INVITE_SEQUENCE** (const) `"linkedin-invite"`
- **InviteSettings** (type) `type InviteSettings = z.infer<typeof invitesSettingsSchema>;`
- **ProposedInvite** (interface) `interface ProposedInvite { id: number; handle: string; name: string | null; fit: InviteFit | null; at: Date; }`
- **SweepStats** (interface) `interface SweepStats { accepted: number[]; backfilled: number; byHand: number; settled: number; drift: { site: number; wren: number; gone: string[] } | null; withdrawn: number; gone: number; errors: string[]; }`
- **TopUpStats** (interface) `interface TopUpStats { target: number; queued: number; added: number; enrolled: number; leadBusy: number; }`
- **VANITY** (const) `SQL<unknown>`
- **applyWithdraw** (function) `(db: Queryable, contactId: number, r: { withdrawn: boolean; relationship: Relationship }, days: number, now: Date): Promise<WithdrawOutcome>`
- **approveInvites** (function) `(db: Queryable, contactIds: readonly number[], now: Date): Promise<number[]>`
- **connectionsDrift** (function) `(db: Queryable, accountId: string, connections: readonly Connection[], max: number): Promise<{ site: number; wren: number; gone: string[] } | null>`
- **emptySweep** (function) `(errors: string[] = []): SweepStats`
- **inviteSettings** (function) `(db: Queryable): Promise<InviteSettings>`
- **invitedSql** (function) `(contactId: SQL): SQL<unknown>`
- **invitesSettingsSchema** (const) `z.ZodObject<{ account: z.ZodDefault<z.ZodString>; perDay: z.ZodDefault<z.ZodNumber>; niches: z.ZodDefault<z.ZodArray<z.ZodString>>; titles: z.ZodDefault<z.ZodArray<z.ZodString>>; decisionMakers: z.ZodDefault<z.ZodBoolean>; minEmployees: z.ZodDefault<z.ZodNumber>; knownSizeOnly: z.ZodDefault<z.ZodBoo…`
- **markAccepted** (function) `(db: Queryable, accountId: string, connections: readonly Connection[], now: Date): Promise<{ accepted: number[]; byHand: number }>`
- **peopleForInvites** (function) `(db: Queryable, partial: Partial<PickSettings>, held: readonly string[], limit: number): Promise<InviteTarget[]>`
- **proposedInvites** (function) `(db: Queryable, limit = 100): Promise<ProposedInvite[]>`
- **skipInvites** (function) `(db: Queryable, contactIds: readonly number[], now: Date): Promise<number[]>`
- **sweepInvites** (function) `(db: Queryable, ch: OutreachChannel, account: ReachAccount, s: InviteSettings, now: Date, run: Journal = (_n, fn) => fn()): Promise<SweepStats>`
- **topUp** (function) `(db: Queryable, o: { settings: InviteSettings; account: ReachAccount; policy: ReachPolicy; sequences: ReadonlyMap<string, ReachSequence>; sender: string; held: readonly string[]; now: Date; runId?: string | null; }): Promise<TopUpStats>`
- **whyOf** (function) `(t: InviteTarget): InviteFit`

## packages/outreach/src/limits.ts

- **WREN_LIMITS** (const) `readonly LimitDef[]`
- **followsLeft** (function) `(db: Queryable, main: Queryable, platform: ReachPostPlatform, now: Date): Promise<number>`

## packages/outreach/src/pain.ts

- **MAX_AGE_DAYS** (const) `14`
- **PER_CALL** (const) `10`
- **Pain** (type) `type Pain = z.infer<typeof PAINS>["pains"][number];`
- **PainPass** (interface) `interface PainPass { fires: Fired[]; cursor: number; scanned: number; read: number; pains: number; unproven: number; waiting: boolean; more: boolean; }`
- **painBatch** (function) `(db: Queryable): Promise<string>`
- **painFired** (function) `(source: string, p: { id: number; profile: number; pain: string }, now: Date): Fired`
- **painKey** (function) `(document: number, quote: string): string`
- **painPass** (function) `(db: Queryable, llm: LlmClient, sources: readonly string[], cursor: number, now: Date, limit = 50): Promise<PainPass>`
- **painPrompt** (function) `(posts: readonly ReachPost[]): string`
- **proven** (function) `(text: string, quote: string): boolean`
- **readPains** (function) `(llm: LlmClient, posts: readonly ReachPost[]): Promise<Pain[]>`

## packages/outreach/src/passes.ts

- **Who** (interface) `interface Who { platform: string; handle: string; name: string; }`
- **liftPass** (function) `(db: Queryable, platform: string, handle: string, now: Date): Promise<boolean>`
- **listPasses** (function) `(db: Queryable, o: { limit?: number } = {}): Promise<{ id: number; platform: string; handle: string; name: string; reason: "not_now" | "spam" | "not_lead" | "not_worth" | "competitor" | "rude"; note: string | null; item: string | null; by: string | null; until: Date | null; liftedAt: Date | null; createdAt: Date; }[]>`
- **passKey** (function) `(handle: string | null | undefined, name: string): string`
- **passOn** (function) `(db: Queryable, items: readonly string[], o: { reason: PassReason; note?: string | null; by?: string | null; now: Date }): Promise<{ people: number; closed: number }>`
- **passedOn** (function) `(db: Queryable, platform: string): Promise<Set<string>>`
- **whoOf** (function) `(db: Queryable, item: string): Promise<Who | null>`

## packages/outreach/src/policy.ts

- **DEFAULT_POLICY** (const) `ReachPolicy`
- **FLEET_ZONE** (const) `"America/New_York"`
- **ReachPolicy** (interface) `interface ReachPolicy { windowStartMinute: number; windowEndMinute: number; days: readonly number[]; gapSeconds: number; reddit: { messagesPerDay: number; }; linkedin: { connectsStart: number; connectsStep: number; rampEverySendDays: number; connectsCap: number; messagesPerDay: number; notesPerMonth: number; }; }`
- **Standing** (interface) `interface Standing { caps: { connects: number; messages: number }; frozen: string | null; stage: string; }`
- **fleetDay** (function) `(at: Date): string`
- **inWindow** (function) `(at: Date, policy: ReachPolicy): boolean`
- **parseClock** (function) `(text: string): number`
- **sendDaysBetween** (function) `(from: string, to: string, days: readonly number[]): number`
- **standingOf** (function) `(a: { platform: Platform; startedOn: string; health: AccountHealth | null }, policy: ReachPolicy, now: Date): Standing`

## packages/outreach/src/proofs.ts

- **HAND_ROUND** (const) `0`
- **PROOF_ROUNDS** (const) `readonly [{ readonly round: 1; readonly delayMs: number; }, { readonly round: 2; readonly delayMs: number; }, { readonly round: 3; readonly delayMs: number; }]`
- **isProofItem** (function) `(item: string): boolean`
- **keepProof** (function) `(db: Queryable, item: string, platform: string, proof: Proof, round: number): Promise<{ warn: boolean }>`
- **proofOf** (function) `(db: Queryable, item: string): Promise<CommentProofRow | null>`
- **proofTarget** (function) `(db: Queryable, item: string): Promise<ProofTarget | null>`
- **proofsSince** (function) `(db: Queryable, since: Date): Promise<CommentProofRow[]>`
- **sentSince** (function) `(db: Queryable, sinceAt: Date): Promise<string[]>`
- **warningOf** (function) `(item: string, platform: string, proof: Proof): { title: string; body: string; }`

## packages/outreach/src/reach-posts/acts.ts

- **ACTS_PER_PASS** (const) `5`
- **ActsStats** (interface) `interface ActsStats { liked: number; followed: number; held: string[]; errors: string[]; }`
- **autoActs** (function) `(db: Queryable, o: { platform: ReachPostPlatform; settings: Pick<CommentsSettings, "like" | "follow" | "minFit">; call: (act: SiteAct) => Promise<unknown>; step: <T>(name: string, fn: () => Promise<T>) => Promise<T>; holds: CapHolds; now: Date; followsLeft?: number; }): Promise<ActsStats>`
- **followAct** (function) `(platform: ReachPostPlatform, who: { handle: string } | { company: string }): SiteAct`
- **listPosts** (function) `(db: Queryable, o: { state?: string; limit?: number } = {}): Promise<{ id: number; platform: "linkedin" | "youtube" | "x" | "tiktok" | "instagram" | "threads"; state: "dropped" | "skipped" | "queued" | "found" | "commented"; author: string; fit: number | null; why: string | null; draft: string | null; url: string; foundBy: string; }[]>`
- **markPostActed** (function) `(db: Queryable, id: number, act: "like" | "follow", now: Date): Promise<void>`
- **markPostCommented** (function) `(db: Queryable, post: ReachPost, r: { body: string; by: string; now: Date }): Promise<void>`
- **ownCircle** (function) `(p: Pick<ReachPost, "platform" | "handle" | "author" | "headline" | "text">): boolean`
- **planPostAct** (function) `(db: Queryable, id: number, act: "like" | "follow"): Promise<ReachPost>`
- **planPostComment** (function) `(db: Queryable, id: number): Promise<ReachPost>`
- **postActs** (function) `(p: ReachPost, s: Pick<CommentsSettings, "like" | "follow">, body: string): { comment: SiteAct | null; like: SiteAct | null; follow: SiteAct | null }`
- **skipPost** (function) `(db: Queryable, ids: readonly number[], o: { by?: string; reason?: RejectReason | null; note?: string | null } = {}): Promise<number[]>`

## packages/outreach/src/reach-posts/draft.ts

- **RedraftResult** (interface) `interface RedraftResult { redrafted: number[]; dropped: { id: number; why: string }[]; skipped: { id: number; why: string }[]; }`
- **draftPost** (function) `(db: Queryable, llm: LlmClient, id: number, o: CommentDraftOptions & { now: Date }): Promise<"queued" | "dropped" | "gone">`
- **redraftPosts** (function) `(db: Queryable, llm: LlmClient, ids: readonly number[], o: CommentDraftOptions & { settings: Readonly<Record<ReachPostPlatform, CommentsSettings>>; why?: string; now: Date; }): Promise<RedraftResult>`

## packages/outreach/src/reach-posts/pass.ts

- **PostsStats** (interface) `interface PostsStats { platform: ReachPostPlatform; account: string; reads: number; kept: number; dropped: number; queued: number; scheduled?: number; acts?: ActsStats; capped: boolean; topics: string[]; rested: string[]; errors: string[]; }`
- **keepPosts** (function) `(db: Queryable, posts: readonly FeedPost[], o: { platform: ReachPostPlatform; foundBy: string; account: string; topics: readonly string[]; audience?: readonly string[]; key?: boolean; ours: readonly string[]; halfLifeHours: number; maxAgeHours: number; now: Date; }): Promise<{ found: number[]; dropped: number }>`
- **postsPass** (function) `(db: Queryable, o: { platform: ReachPostPlatform; settings: CommentsSettings; read: PostReader; llm: LlmClient | null; guide?: () => Promise<string>; voice?: string; facts?: () => Promise<readonly string[]>; ours?: () => Promise<readonly OurPost[]>; now: Date; step: <T>(name: string, fn: () => Promise<T>) => Promise<T>; capped?: (err: unknown) => boolean; }): Promise<PostsStats>`

## packages/outreach/src/reach-posts/rank.ts

- **MOMENTUM_MAX** (const) `14`
- **authorFit** (function) `(headline: string, audience: readonly string[]): { points: number; kind: "buyer" | "seller" | "owner" | "manager" | null }`
- **isJobAd** (function) `(text: string, headline = ""): boolean`
- **jobPost** (function) `(text: string, headline = ""): JobPost | null`
- **momentum** (function) `(p: Pick<FeedPost, "reactions" | "comments">, ageH: number | null, halfLifeHours: number): number`
- **rankPost** (function) `(p: FeedPost, o: { topics: readonly string[]; audience?: readonly string[]; key: boolean; foundBy: string; halfLifeHours: number; now: Date; }): { fit: number; why: string; off: string | null }`
- **topicCore** (function) `(topic: string): string`

## packages/outreach/src/reach-posts/read.ts

- **FeedPost** (interface) `interface FeedPost { ref: string; author: string; authorUrl: string | null; handle?: string | null; headline?: string; text: string; age?: string; at?: string; approx?: true; reactions: number; comments: number; url: string; off?: string; raw?: unknown; }`
- **KeyPerson** (interface) `interface KeyPerson { handle: string; name: string; }`
- **PostReader** (interface) `interface PostReader { search(keywords: string, since: Since): Promise<FeedPost[]>; page(handle: string): Promise<FeedPost[]>; person(k: KeyPerson, since: Since): Promise<FeedPost[]>; one(ref: string): Promise<FeedPost | null>; feed(): Promise<FeedPost[]>; }`
- **Since** (type) `type Since = "past-24h" | "past-week" | "past-month";`
- **YtVideo** (interface) `interface YtVideo { id: string; snippet?: { title?: string; description?: string; channelId?: string; channelTitle?: string; publishedAt?: string; categoryId?: string; defaultAudioLanguage?: string; }; statistics?: { likeCount?: string; commentCount?: string }; }`
- **nameOfVanity** (function) `(vanity: string): string`
- **phrase** (function) `(keywords: string): string`
- **postReader** (function) `(sites: SiteClient, platform: ReachPostPlatform, account: string, o: { authorTitle?: string; now: Date }): PostReader`
- **shortcodeAt** (function) `(code: string): Date | null`
- **vanityOf** (function) `(url: string | null | undefined): string | null`
- **ytPostOf** (function) `(v: YtVideo): FeedPost | null`

## packages/outreach/src/reach-posts/settings.ts

- **COMMENTS_COMPONENTS** (const) `Readonly<Record<ReachPostPlatform, string>>`
- **COMMENTS_SETTINGS** (const) `Record<"linkedin" | "youtube" | "x" | "tiktok" | "instagram" | "threads", z.ZodObject<{ account: z.ZodDefault<z.ZodString>; perDay: z.ZodDefault<z.ZodNumber>; autoSend: z.ZodDefault<z.ZodBoolean>; topics: z.ZodDefault<z.ZodArray<z.ZodString>>; pages: z.ZodDefault<z.ZodArray<z.ZodString>>; people: z.…`
- **COMMENT_LENGTH** (const) `Readonly<Record<ReachPostPlatform, string>>`
- **COMMENT_MAX** (const) `Readonly<Record<ReachPostPlatform, number>>`
- **CommentsSettings** (type) `type CommentsSettings = z.infer<ReturnType<typeof commentsSettingsSchemaFor>>;`
- **DEFAULT_AUDIENCE** (const) `readonly ["business", "compan", "firm", "agency", "founder", "owner", "ceo", "b2b", "startup", "client", "customer"]`
- **MIN_FIT** (const) `70`
- **PLATFORM_NAME** (const) `Readonly<Record<ReachPostPlatform, string>>`
- **allCommentsSettings** (function) `(db: Queryable): Promise<Record<ReachPostPlatform, CommentsSettings>>`
- **commentsSettings** (function) `(db: Queryable, platform: ReachPostPlatform): Promise<CommentsSettings>`

## packages/outreach/src/reach-posts/topics.ts

- **REST_AFTER** (const) `15`
- **planTopics** (function) `(own: readonly string[], yields: readonly TopicYield[], fresh: readonly string[], extra: number, audience?: readonly string[]): { topics: string[]; rested: string[] }`
- **proposeTopics** (function) `(llm: LlmClient, o: { platform?: ReachPostPlatform; about: string; n: number; yields: readonly TopicYield[]; known: readonly string[]; audience?: readonly string[]; }): Promise<string[]>`
- **topicYields** (function) `(db: Queryable, o: { platform: ReachPostPlatform; minFit: number; now: Date }): Promise<TopicYield[]>`

## packages/outreach/src/records.ts

- **COMMENT_FOLD** (const) `RecordFold`
- **PLATFORM_LABELS** (const) `Record<"reddit" | "linkedin" | "youtube" | "x" | "tiktok" | "instagram" | "google_business" | "facebook", import("@wren/core/records").State>`
- **accountRecord** (const) `import("@wren/core/records").RecordType`
- **accountRecordOf** (function) `(policy: ReachPolicy = DEFAULT_POLICY): import("@wren/core/records").RecordType`
- **commentRecord** (const) `import("@wren/core/records").RecordType`
- **dmCopyRecord** (function) `(sender: string): import("@wren/core/records").RecordType`
- **dmRecord** (const) `import("@wren/core/records").RecordType`
- **inviteRecord** (const) `import("@wren/core/records").RecordType`
- **personRecord** (const) `import("@wren/core/records").RecordType`
- **placeRecord** (const) `import("@wren/core/records").RecordType`
- **threadRecord** (const) `import("@wren/core/records").RecordType`
- **turnOf** (function) `(unread: boolean, draft: string | null | undefined, last: string | null): "reply" | "draft" | "sent" | null`

## packages/outreach/src/refusal.ts

- **ReachRefusal** (class) `override name`

## packages/outreach/src/replies.ts

- **RepliesStats** (interface) `interface RepliesStats { checked: number; received: number; optedOut: number; errors: string[]; replied?: number[]; }`
- **isOptOut** (function) `(text: string): boolean`
- **pullReplies** (function) `(db: Queryable, accounts: readonly ReachAccount[], channelFor: (a: ReachAccount) => OutreachChannel | null, now: Date): Promise<RepliesStats>`
- **receive** (function) `(db: Queryable, platform: Platform, accountId: string, r: Reply, now: Date): Promise<{ received: number; optedOut: number; contactId?: number }>`

## packages/outreach/src/reply-drafts.ts

- **clearReplyDrafts** (function) `(db: Queryable): Promise<{ threads: number; posts: number; comments: number; dms: number; }>`

## packages/outreach/src/restate/deps.ts

- **ReachClients** (interface) `interface ReachClients { clientDb: (id: string) => Db; llm: LlmClient | null; keys?: KeyStore | null; dmGuide?: (db: Db, platform: DmPlatform) => Promise<string>; facts?: (db: Db) => Promise<{ label: string; text: string }[]>; }`
- **ReachDeps** (interface) `interface ReachDeps { db: Db; pushes?: (ctx: restate.ObjectContext) => Promise<ReachView>; fire?: FireTriggers; policy: ReachPolicy; sequences: ReadonlyMap<string, ReachSequence>; live: boolean; senderName: string; heldNiches: readonly string[]; sitesFor: (ctx: restate.Context) => SiteClient; deskUp?: (ctx: restate.Context) => Promise<boolean>; notifier?: Notifier; clock?: () => Date; postedAt?: (platform: Platform) => Promise<string | null>; drafts?: { llm: LlmClient | null; guide?: DmGuide; commentGuide?: (platform: DmPlatform | ReachPostPlatform) => Promise<string>; voice?: string; facts?: () => Promise<readonly string[]>; ours?: () => Promise<readonly OurPost[]>; }; clients?: ReachClients; }`
- **ReachView** (type) `type ReachView = { pushed: string[]; watched: string[] };`
- **SENDER_KEY** (const) `"fleet"`
- **WATCH_KEY** (const) `"daily"`
- **channelsFor** (function) `(deps: ReachDeps, ctx: restate.Context): (a: ReachAccount) => OutreachChannel | null`
- **clientDeps** (function) `(deps: ReachDeps, plan: Extract<ClientReach, { kind: "work" }>, part: ReachPart, now: Date, model = false): ReachDeps`
- **finalRefusal** (function) `(err: unknown): unknown`
- **wakeWatch** (function) `(ctx: restate.Context, client: string | null = null): restate.InvocationHandle`

## packages/outreach/src/restate/desk-context.ts

- **terminalWhy** (function) `(req: { reason?: unknown; note?: unknown }): { reason: import("@wren/core/reject-reasons").RejectReason | null; note: string | null; }`

## packages/outreach/src/restate/desk-settle.ts

- **PostSettle** (type) `type PostSettle = { settlePost: ( ctx: restate.ObjectContext, req: { id: string; outcome: SettleOutcome; by: string }, ) => Promise<{ id: string; outcome: SettleOutcome; found: boolean }>; };`

## packages/outreach/src/restate/desk.ts

- **ReachDeskService** (type) `type ReachDeskService = ReturnType<typeof makeReachDesk>;`
- **makeReachDesk** (function) `(deps: ReachDeps): restate.ServiceDefinition<"ReachDesk", { draftModels: (ctx: restate.Context, req?: { since?: string | null; }) => Promise<import("@wren/core/draft-models").Scorecard>; stats: (ctx: restate.Context, req?: { platform?: string | null; days?: number; }) => Promise<import("../threads.js").ReachStats>; fi…`

## packages/outreach/src/restate/discovery.ts

- **DiscoveryDeps** (interface) `interface DiscoveryDeps { llm: LlmClient | null; voice: string; facts: () => Promise<{ label: string; text: string }[]>; truths?: () => Promise<readonly string[]>; ours?: () => Promise<readonly OurPost[]>; audience: () => Promise<Audience>; limits?: Partial<Limits>; karmaPlaces?: readonly string[]; }`
- **READS_KEY** (const) `"wren"`
- **RedditReadsObject** (type) `type RedditReadsObject = ReturnType<typeof makeRedditReads>;`
- **makeRedditReads** (function) `(deps: ReachDeps & { discovery: DiscoveryDeps }): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<DiscoveryStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<DiscoveryStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | …`

## packages/outreach/src/restate/maybe-sent.ts

- **SendNotSent** (class) `readonly notSent; constructor(message: string, readonly how: "before_submit" | "verified_absent")`
- **SendTaken** (class) `readonly taken`
- **SendUnsure** (class) `readonly unsure`
- **isSendNotSent** (function) `(err: unknown): err is SendNotSent`
- **isSendTaken** (function) `(err: unknown): err is SendTaken`
- **isSendUnsure** (function) `(err: unknown): err is SendUnsure`
- **sendAtMostOnce** (function) `(ctx: restate.Context, db: Queryable, o: AtMostOnce): Promise<Landed>`
- **sendError** (function) `(err: unknown): unknown`

## packages/outreach/src/restate/proofs.ts

- **CommentProofsService** (type) `type CommentProofsService = ReturnType<typeof makeCommentProofs>;`
- **PROOFS_SERVICE** (const) `{ readonly name: "CommentProofs"; }`
- **ProofCheck** (interface) `interface ProofCheck { item: string; round?: number; }`
- **ProofsDeps** (interface) `interface ProofsDeps { db: Db; sitesFor: (ctx: restate.Context) => SiteClient; keep?: KeepShot; notifier?: Notifier; linkedinAccount?: string; }`
- **makeCommentProofs** (function) `(deps: ProofsDeps): restate.ServiceDefinition<"CommentProofs", { check: (ctx: restate.Context, req: ProofCheck) => Promise<Proof>; }>`
- **scheduleProofs** (function) `(ctx: restate.Context, item: string): void`

## packages/outreach/src/restate/sender.ts

- **ReachSender** (type) `type ReachSender = ReturnType<typeof makeReachSender>;`
- **makeReachSender** (function) `(deps: ReachDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<TickStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<TickStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) => P…`
- **reachDelayMs** (function) `(s: TickStats, next: string | null, gapSeconds: number, now: Date): number`

## packages/outreach/src/restate/watch.ts

- **InvitesPass** (interface) `interface InvitesPass { account: string; sweep: SweepStats; topUp: TopUpStats | null; notes: { written: number; errors: string[] }; }`
- **ReachWatchObject** (type) `type ReachWatchObject = ReturnType<typeof makeReachWatch>;`
- **ThreadsStats** (interface) `interface ThreadsStats { probed: number; read: number; kept: number; answered: number; errors: string[]; }`
- **WatchStats** (interface) `interface WatchStats { replies: RepliesStats; comments: { kept: number; errors: string[] }; threads: ThreadsStats; health: HealthStats; invites: InvitesPass | null; drafts: { written: number; errors: string[] }; posts: PostsStats[]; stopped: string | null; skipped?: number; deskOffline?: true; }`
- **makeReachWatch** (function) `(deps: ReachDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<WatchStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<WatchStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) =>…`

## packages/outreach/src/schema.ts

- **ACCOUNT_STATES** (const) `readonly ["warming", "active", "paused", "retired"]`
- **AccountState** (type) `type AccountState = (typeof ACCOUNT_STATES)[number];`
- **COMMENT_CHANNELS** (const) `readonly ["reach", "content"]`
- **COMMENT_KINDS** (const) `readonly ["post_reply", "comment_reply", "username_mention", "review", "thread_reply"]`
- **COMMENT_SORTS** (const) `readonly ["asked", "question", "chat", "hostile", "ours", "noise"]`
- **COMMENT_STATES** (const) `readonly ["new", "waiting", "answered", "dropped"]`
- **CONTACT_STATES** (const) `readonly ["new", "enrolled", "connected", "replied", "finished", "unreachable", "opted_out", "blocked"]`
- **Comment** (type) `type Comment = typeof comments.$inferSelect;`
- **CommentChannel** (type) `type CommentChannel = (typeof COMMENT_CHANNELS)[number];`
- **CommentKind** (type) `type CommentKind = (typeof COMMENT_KINDS)[number];`
- **CommentProofRow** (type) `type CommentProofRow = typeof commentProofs.$inferSelect;`
- **CommentSort** (type) `type CommentSort = (typeof COMMENT_SORTS)[number];`
- **CommentState** (type) `type CommentState = (typeof COMMENT_STATES)[number];`
- **CommentThread** (type) `type CommentThread = typeof commentThreads.$inferSelect;`
- **ContactState** (type) `type ContactState = (typeof CONTACT_STATES)[number];`
- **DIRECTIONS** (const) `readonly ["out", "in"]`
- **DM_PLATFORMS** (const) `readonly ["reddit", "linkedin", "facebook", "instagram", "x"]`
- **Direction** (type) `type Direction = (typeof DIRECTIONS)[number];`
- **DmPlatform** (type) `type DmPlatform = (typeof DM_PLATFORMS)[number];`
- **DraftAccount** (type) `type DraftAccount = typeof draftAccounts.$inferSelect;`
- **InviteFit** (interface) `interface InviteFit { why: string; title: string | null; company: string | null; employees: number | null; size: string | null; engaged: string | null; }`
- **MESSAGE_KINDS** (const) `readonly ["connect", "sequence", "manual", "inbound", "follow_up"]`
- **MESSAGE_STATES** (const) `readonly ["proposed", "queued", "sending", "sent", "failed", "unknown", "skipped", "received"]`
- **MessageKind** (type) `type MessageKind = (typeof MESSAGE_KINDS)[number];`
- **MessageState** (type) `type MessageState = (typeof MESSAGE_STATES)[number];`
- **PLACE_PURPOSES** (const) `readonly ["reach", "karma"]`
- **PLACE_STATES** (const) `readonly ["found", "watching", "skipped"]`
- **PLATFORMS** (const) `readonly ["reddit", "linkedin"]`
- **PersonFacts** (interface) `interface PersonFacts { ageDays: number | null; karma: number | null; places: { place: string; n: number }[]; domains: { domain: string; n: number }[]; peakHourUtc: number | null; }`
- **PersonRead** (interface) `interface PersonRead { role: Quoted | null; business: Quoted | null; size: Quoted | null; location: Quoted | null; website: Quoted | null; struggles: Quoted[]; why: string; }`
- **PlaceJudged** (interface) `interface PlaceJudged { fit: number; why: string; rules: string; mayComment: boolean; mayPost: boolean; linkOnly: boolean; karmaMin: number | null; ageMinDays: number | null; postsADay: number; medianComments: number; }`
- **PlacePurpose** (type) `type PlacePurpose = (typeof PLACE_PURPOSES)[number];`
- **Platform** (type) `type Platform = (typeof PLATFORMS)[number];`
- **Quoted** (interface) `interface Quoted { value: string; quote: string; }`
- **REACH_POST_PLATFORMS** (const) `readonly ["linkedin", "x", "instagram", "youtube", "tiktok", "threads"]`
- **REACH_POST_STATES** (const) `readonly ["found", "queued", "commented", "skipped", "dropped"]`
- **REQUIREMENT_SOURCES** (const) `readonly ["removal", "rules", "manual"]`
- **ReachAccount** (type) `type ReachAccount = typeof reachAccounts.$inferSelect;`
- **ReachContact** (type) `type ReachContact = typeof reachContacts.$inferSelect;`
- **ReachMessage** (type) `type ReachMessage = typeof reachMessages.$inferSelect;`
- **ReachPass** (type) `type ReachPass = typeof reachPasses.$inferSelect;`
- **ReachPost** (type) `type ReachPost = typeof reachPosts.$inferSelect;`
- **ReachPostPlatform** (type) `type ReachPostPlatform = (typeof REACH_POST_PLATFORMS)[number];`
- **ReachPostState** (type) `type ReachPostState = (typeof REACH_POST_STATES)[number];`
- **RedditPerson** (type) `type RedditPerson = typeof redditPeople.$inferSelect;`
- **RedditPlace** (type) `type RedditPlace = typeof redditPlaces.$inferSelect;`
- **RedditRequirement** (type) `type RedditRequirement = typeof redditRequirements.$inferSelect;`
- **RedditThread** (type) `type RedditThread = typeof redditThreads.$inferSelect;`
- **RequirementSource** (type) `type RequirementSource = (typeof REQUIREMENT_SOURCES)[number];`
- **SEND_ATTEMPT_STATES** (const) `readonly ["sending", "sent", "unsure"]`
- **SendAttempt** (type) `type SendAttempt = typeof sendAttempts.$inferSelect;`
- **SendAttemptState** (type) `type SendAttemptState = (typeof SEND_ATTEMPT_STATES)[number];`
- **THREAD_KINDS** (const) `readonly ["help", "tools", "story", "venting", "hiring", "other"]`
- **THREAD_STATES** (const) `readonly ["new", "dropped", "ranked", "queued", "commented", "skipped"]`
- **ThreadNodeRow** (interface) `interface ThreadNodeRow { ref: string; parent: string; handle: string; text: string; at: string; url: string; }`
- **commentProofs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "comment_proofs"; schema: undefined; columns: { item: import("drizzle-orm/pg-core").PgColumn<{ name: "item"; tableName: "comment_proofs"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault…`
- **commentThreads** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "comment_threads"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "comment_threads"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **comments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "comments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "comments"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`
- **draftAccounts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "draft_accounts"; schema: undefined; columns: { item: import("drizzle-orm/pg-core").PgColumn<{ name: "item"; tableName: "draft_accounts"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault…`
- **isReachPlatform** (function) `(p: string): p is Platform`
- **reachAccounts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reach_accounts"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "reach_accounts"; dataType: "string"; columnType: "PgVarchar"; data: "reddit" | "linkedin"; driverParam: string; no…`
- **reachContacts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reach_contacts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reach_contacts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **reachInvites** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"reach_invites", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reach_invites"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: f…`
- **reachMessages** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reach_messages"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reach_messages"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **reachPasses** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reach_passes"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reach_passes"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **reachPosts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reach_posts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reach_posts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **redditPeople** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reddit_people"; schema: undefined; columns: { handle: import("drizzle-orm/pg-core").PgColumn<{ name: "handle"; tableName: "reddit_people"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefau…`
- **redditPlaces** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reddit_places"; schema: undefined; columns: { subreddit: import("drizzle-orm/pg-core").PgColumn<{ name: "subreddit"; tableName: "reddit_places"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; ha…`
- **redditRequirements** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reddit_requirements"; schema: undefined; columns: { subreddit: import("drizzle-orm/pg-core").PgColumn<{ name: "subreddit"; tableName: "reddit_requirements"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNu…`
- **redditThreads** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reddit_threads"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "reddit_threads"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; ha…`
- **sendAttempts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "send_attempts"; schema: undefined; columns: { item: import("drizzle-orm/pg-core").PgColumn<{ name: "item"; tableName: "send_attempts"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: …`

## packages/outreach/src/send-attempts.ts

- **KEYLESS_TRY** (const) `"an earlier try ran with no send key, so no verdict can say if it went out"`
- **RECHECK_EVERY_MS** (const) `number`
- **RECHECK_FOR_MS** (const) `number`
- **RECHECK_WHYS** (const) `string[]`
- **SendClaim** (interface) `interface SendClaim { item: string; platform: string; account: string | null; words: string; target: string; url: string | null; invocation: string; now: Date; again?: boolean; }`
- **UNSURE_WAITS** (const) `"may have gone out. It waits in To approve, where you can open it on the site, mark it posted, or send it again"`
- **claimSend** (function) `(db: Queryable, c: SendClaim): Promise<Claimed>`
- **forgetUnsure** (function) `(db: Queryable, item: string): Promise<void>`
- **parkUnsure** (function) `(db: Queryable, a: Omit<SendClaim, "invocation" | "again"> & { why: string; tries: number; since?: Date; sendKey?: string | null; }): Promise<void>`
- **releaseSend** (function) `(db: Queryable, item: string): Promise<void>`
- **sendAttempt** (function) `(db: Queryable, item: string): Promise<SendAttempt | null>`
- **sendOpen** (function) `(item: ReturnType<typeof sql>): SQL<unknown>`
- **sendsToRecheck** (function) `(db: Queryable, now: Date): Promise<SendAttempt[]>`
- **settleSent** (function) `(db: Queryable, item: string, s: { ref: string | null; at: Date; by: string; now: Date }): Promise<void>`
- **settleUnsure** (function) `(db: Queryable, item: string, s: { why: string; now: Date }): Promise<void>`
- **unsureSends** (function) `(db: Queryable, now = new Date()): Promise<SendAttempt[]>`

## packages/outreach/src/sequences.ts

- **CONNECT_NOTE** (const) `"linkedin:connect-note"`
- **MESSAGE_MAX** (const) `2000`
- **REACH_SEQUENCES** (const) `ReadonlyMap<string, ReachSequence>`
- **ReachSequence** (interface) `interface ReachSequence { name: string; label: string; platform: Platform; steps: readonly ReachStep[]; connectFirst: boolean; connectWaitDays: number; }`
- **RenderField** (type) `type RenderField = keyof RenderFields;`
- **RenderFields** (interface) `interface RenderFields { first_name: string | null; company: string | null; headline: string | null; found_in: string | null; sender: string; }`
- **TemplateSlot** (interface) `interface TemplateSlot { key: string; platform: Platform; purpose: string; fields: readonly RenderField[]; maxLength: number; }`
- **checkBody** (function) `(slot: TemplateSlot, body: string): string`
- **dmSeed** (function) `(contactId: number): string`
- **firstName** (function) `(full: string | null | undefined): string | null`
- **preview** (function) `(source: string, fields: RenderFields): string`
- **render** (function) `(tpl: Template, fields: RenderFields, seed: string): RenderedDm`
- **sampleFields** (function) `(sender: string): RenderFields`
- **sequenceSlots** (function) `(seq: ReachSequence): TemplateSlot[]`
- **slotsOf** (function) `(sequences: Iterable<ReachSequence>): TemplateSlot[]`
- **stepKey** (function) `(seq: ReachSequence, step: number): string`
- **subjectKey** (function) `(seq: ReachSequence, step: number): string`

## packages/outreach/src/settings.ts

- **policyFrom** (function) `(s: Settings): ReachPolicy`

## packages/outreach/src/settle-send.ts

- **SETTLE_OUTCOMES** (const) `readonly ["posted", "again", "dropped"]`
- **SettleOutcome** (type) `type SettleOutcome = (typeof SETTLE_OUTCOMES)[number];`
- **dropItem** (function) `(db: Queryable, item: string, o: { by: string; now: Date }): Promise<void>`
- **itemOf** (function) `(item: string): { kind: SendItem; id: string }`
- **markPosted** (function) `(db: Queryable, item: string, o: Partial<Pick<TickOptions, "sequences" | "sender">> & { by: string; now: Date }): Promise<TickStats>`
- **requeueDm** (function) `(db: Queryable, id: number, now: Date): Promise<void>`
- **unsureItem** (function) `(db: Queryable, item: string): Promise<{ why: string | null; startedAt: Date; url: string | null; state: "sent" | "sending" | "unsure"; target: string; words: string; account: string | null; updatedAt: Date; sentAt: Date | null; item: string; ref: string | null; tries: number; platform: string; invocation: string | null; sendKey:…`

## packages/outreach/src/store.ts

- **SetTemplate** (interface) `interface SetTemplate { key: string; body?: string | null; by: string; }`
- **SlotView** (interface) `interface SlotView extends TemplateSlot { body: string; version: string | null; updatedAt: string | null; updatedBy: string | null; preview: string; }`
- **dmRef** (function) `(key: string): TemplateRef`
- **listTemplates** (function) `(db: Queryable, slots: readonly TemplateSlot[], sender: string): Promise<SlotView[]>`
- **liveDms** (function) `(db: Queryable, keys: readonly string[]): Promise<Map<string, Template>>`
- **setTemplate** (function) `(db: Queryable, opts: { slots: readonly TemplateSlot[]; sender: string }, req: SetTemplate): Promise<SlotView>`

## packages/outreach/src/threads.ts

- **ReachStats** (interface) `interface ReachStats { contacts: Record<string, number>; out: Record<string, number>; replies: number; days: number; }`
- **Thread** (interface) `interface Thread { contact: ReachContact; messages: ReachMessage[]; }`
- **ThreadFilter** (interface) `interface ThreadFilter { platform?: Platform | null; state?: ContactState | null; unread?: boolean; limit?: number; }`
- **ThreadSummary** (interface) `interface ThreadSummary { contact: ReachContact; account: string | null; last: Pick<ReachMessage, "direction" | "kind" | "body" | "state" | "sentAt" | "createdAt"> | null; unread: boolean; dms: number; }`
- **getThread** (function) `(db: Queryable, contactId: number): Promise<Thread>`
- **listThreads** (function) `(db: Queryable, f: ThreadFilter = {}): Promise<ThreadSummary[]>`
- **markRead** (function) `(db: Queryable, contactId: number, now: Date): Promise<void>`
- **reachStats** (function) `(db: Queryable, o: { platform?: Platform | null; days: number; now: Date }): Promise<ReachStats>`

## packages/outreach/src/tick.ts

- **Candidate** (interface) `interface Candidate { row: ReachMessage; contact: ReachContact; account: ReachAccount; checkRelationship: boolean; person?: string; }`
- **Journal** (type) `type Journal = <T>(name: string, fn: () => Promise<T>) => Promise<T>;`
- **LIMIT_HOLD_MS** (const) `number`
- **STALE_SENDING_MS** (const) `number`
- **TickOptions** (interface) `interface TickOptions { channelFor: (a: ReachAccount) => OutreachChannel | null; policy: ReachPolicy; sequences: ReadonlyMap<string, ReachSequence>; sender: string; live: boolean; sends?: (kind: ReachMessage["kind"]) => boolean; linkSource?: string | null; now: Date; runId?: string | null; }`
- **TickStats** (interface) `interface TickStats { sent: number; connected: number; held: Record<string, number>; failed: number; noInvite: number; reconciled: number; finished: number; unreachable: number; stepped: Array<{ contactId: number; sequence: string; step: number }>; }`
- **emptyStats** (function) `(): TickStats`
- **limitWaitMs** (function) `(text: string): number | null`
- **nextDue** (function) `(db: Queryable, now: Date): Promise<string | null>`
- **notesThisMonth** (function) `(db: Queryable, accountId: string, now: Date): Promise<number>`
- **queueManual** (function) `(db: Queryable, req: { contact: ReachContact; body: string; subject?: string | null; now: Date }): Promise<ReachMessage>`
- **reconcile** (function) `(db: Queryable, now: Date): Promise<number>`
- **recordSent** (function) `(db: Queryable, c: Candidate, sent: Sent, o: Pick<TickOptions, "sequences" | "sender" | "now" | "runId">, stats: TickStats): Promise<void>`
- **sentToday** (function) `(db: Queryable, accountIds: readonly string[], now: Date): Promise<Map<string, { connects: number; messages: number }>>`
- **tick** (function) `(db: Queryable, o: TickOptions, run: Journal = (_n, fn) => fn()): Promise<TickStats>`
- **touch** (function) `(db: Queryable, contactId: number, step: number, o: Pick<TickOptions, "sequences" | "sender" | "now">): Promise<"queued" | "replied" | "ended">`

## packages/outreach/src/touches.ts

- **TouchBackfill** (interface) `interface TouchBackfill { messages: number; comments: number; answers: number; threads: number; posts: number; responses: number; links: number; }`
- **backfillOutreachTouches** (function) `(db: Queryable, o: { dryRun?: boolean; now?: Date } = {}): Promise<TouchBackfill>`
- **keepTouch** (function) `(what: string, write: () => Promise<T>): Promise<T | null>`
- **touchFromAnswer** (function) `(db: Queryable, id: number): Promise<{ id: number; handleId: number; created: boolean; linked: boolean; } | null>`
- **touchFromComment** (function) `(db: Queryable, id: number): Promise<{ id: number; handleId: number; created: boolean; linked: boolean; } | null>`
- **touchFromMessage** (function) `(db: Queryable, messageId: number): Promise<{ id: number; handleId: number; created: boolean; linked: boolean; } | null>`
- **touchFromThread** (function) `(db: Queryable, id: string): Promise<{ id: number; handleId: number; created: boolean; linked: boolean; } | null>`
- **touchInvites** (function) `(db: Queryable, contactIds: readonly number[], response: TouchResponse, at: Date): Promise<number>`
- **touchesFromReachPost** (function) `(db: Queryable, id: number): Promise<{ created: boolean; linked: boolean; } | null>`
