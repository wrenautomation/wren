# @wren/outreach: interface

Exports: 524. Files: 55.

## packages/channel-reddit/src/warmup.ts

- **Warmup** (interface) `interface Warmup { stage: WarmupStage; caps: WarmupCaps; ageDays: number; karma: number; next: string; frozen: string | null; }`
- **WarmupStage** (type) `type WarmupStage = "lurk" | "comment" | "post" | "reach";`
- **warmupOf** (function) `(health: AccountHealth, now: Date): Warmup`

## packages/outreach/src/accounts.ts

- **viewOf** (function) `(a: ReachAccount, policy: ReachPolicy, now: Date): AccountView`
- **platformOf** (function) `(text: string): Platform`
- **addAccount** (function) `(db: Queryable, req: { platform: Platform; account: string; now: Date }): Promise<ReachAccount>`
- **listAccounts** (function) `(db: Queryable, platform?: Platform | null): Promise<ReachAccount[]>`
- **recordAccountsOf** (function) `(db: Queryable): Promise<RecordAccount[]>`
- **lastTouches** (function) `(db: Queryable): Promise<Record<string, string>>`
- **accountById** (function) `(db: Queryable, id: string): Promise<ReachAccount>`
- **activeAccounts** (function) `(db: Queryable, platform?: Platform | null): Promise<ReachAccount[]>`
- **setAccountState** (function) `(db: Queryable, id: string, state: AccountState, o: { reason?: string | null; now: Date }): Promise<ReachAccount>`
- **refreshHealth** (function) `(db: Queryable, accounts: readonly ReachAccount[], channelFor: (a: ReachAccount) => OutreachChannel | null, now: Date): Promise<HealthStats>`
- **AccountView** (interface) `interface AccountView extends Omit<ReachAccount, "health"> { health: AccountHealth | null; standing: Standing; }`
- **healthOf** (function) `(a: ReachAccount): AccountHealth | null`
- **HealthStats** (interface) `interface HealthStats { checked: number; frozen: string[]; errors: string[]; }`

## packages/outreach/src/clients.ts

- **loginsOf** (function) `(accounts: Readonly<Record<string, string>>, wren: ReadonlySet<string>): { logins: ClientLogin[]; skipped: string[] }`
- **clientReach** (function) `(main: Queryable, id: string, wants: readonly ReachPart[]): Promise<ClientReach>`
- **syncLogins** (function) `(db: Queryable, logins: readonly ClientLogin[], now: Date): Promise<ReachAccount[]>`
- **ReachPart** (type) `type ReachPart = (typeof REACH_PARTS)[number];`
- **ClientReach** (type) `type ClientReach = | { kind: "gone"; why: string } | { kind: "work"; client: Client; parts: ReachPart[]; logins: ClientLogin[]; skipped: string[]; };`
- **clientSends** (function) `(client: Pick<Client, "sends">, globalLive: boolean): (kind: string) => boolean`

## packages/outreach/src/comments.ts

- **noiseInWords** (function) `(text: string, kind?: string): string | null`
- **keepComments** (function) `(db: Queryable, account: Pick<ReachAccount, "id" | "platform">, items: readonly CommentIn[], ours: readonly string[]): Promise<Array<Pick<Comment, "id" | "platform" | "author" | "post">>>`
- **sortComment** (function) `(db: Db, llm: LlmClient | null, id: number, guide?: CommentGuide, facts: readonly string[] = []): Promise<CommentSort | null>`
- **commentById** (function) `(db: Queryable, id: number): Promise<Comment>`
- **planAnswer** (function) `(db: Queryable, id: number, now: Date): Promise<AnswerPlan>`
- **checkThread** (function) `(authors: readonly string[], others: readonly string[]): void`
- **markAnswered** (function) `(db: Queryable, id: number, r: { body: string; ref: string | null; now: Date; by?: string; via?: "person" | "wren" }): Promise<void>`
- **answerFor** (function) `(c: Pick<Comment, "platform" | "ref" | "post" | "parent" | "author">, body: string): { target: string; text: string }`
- **answerComment** (function) `(db: Queryable, ch: OutreachChannel, req: { id: number; body: string; now: Date }): Promise<{ ref: string | null }>`
- **checkCanDm** (function) `(account: ReachAccount, now: Date): void`
- **dmCommenter** (function) `(db: Queryable, req: { id: number; body: string; subject?: string | null; now: Date }): Promise<{ contactId: number; messageId: number }>`
- **dmDoorOf** (function) `(c: Pick<Comment, "platform" | "accountId">): DmDoor`
- **planPrivateReply** (function) `(db: Queryable, id: number, now: Date): Promise<Comment>`
- **privateReplied** (function) `(db: Queryable, c: Comment, o: { body: string; ref: string | null; now: Date; by?: string | null; via?: "person" | "wren" }): Promise<{ contactId: number; messageId: number }>`
- **dropComment** (function) `(db: Queryable, id: number, o: { by?: string; reason?: RejectReason | null; note?: string | null } = {}): Promise<void>`
- **COMMENTS_FLOW** (const) `"reach.comments"`
- **COMMENTS_FROM** (const) `"read.comment"`
- **askedInWords** (function) `(text: string): boolean`
- **commentEvent** (function) `(c: Pick<Comment, "id" | "platform" | "author" | "post">): { subject: string; kind: "comment"; data: { commentId: number; platform: import("@wren/core").Platform; author: string; post: string; }; }`
- **systemFor** (function) `(platform: string, guide = "", facts: readonly string[] = []): string`
- **promptFor** (function) `(c: Comment): string`
- **sortStep** (function) `(db: Db, llm: LlmClient | null, guide?: CommentGuide, forClient?: ( client: string, ) => Promise<{ db: Db; llm: LlmClient | null; guide?: CommentGuide }>, facts?: () => Promise<readonly string[]>): Step`

## packages/outreach/src/components.ts

- **OUTREACH_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **OUTREACH_WORKFLOWS** (const) `import("@wren/core/workflows").Workflow[]`

## packages/outreach/src/contacts.ts

- **addProspects** (function) `(db: Queryable, platform: Platform, prospects: readonly Prospect[], o: { niche?: string | null } = {}): Promise<AddStats>`
- **addContact** (function) `(db: Queryable, req: { platform: Platform; handle: string; name?: string | null; niche?: string | null }): Promise<ReachContact>`
- **contactByHandle** (function) `(db: Queryable, platform: Platform, handle: string): Promise<ReachContact>`
- **contactById** (function) `(db: Queryable, id: number): Promise<ReachContact>`
- **listContacts** (function) `(db: Queryable, f: { platform?: Platform | null; state?: ContactState | null; limit?: number } = {}): Promise<ReachContact[]>`
- **enrichContact** (function) `(db: Queryable, contact: ReachContact, channel: OutreachChannel, now: Date): Promise<Profile>`
- **fieldsFor** (function) `(contact: ReachContact, sender: string): RenderFields`
- **setContactState** (function) `(db: Queryable, id: number, state: ContactState, o: { reason?: string | null; now: Date; ended?: boolean }): Promise<void>`
- **contactsById** (function) `(db: Queryable, ids: readonly number[]): Promise<Map<number, ReachContact>>`
- **loadByAccount** (function) `(db: Queryable, platform: Platform): Promise<Map<string, number>>`
- **AddStats** (interface) `interface AddStats { added: number; known: number; }`
- **profileOf** (function) `(c: ReachContact): Profile | null`

## packages/outreach/src/decide.ts

- **commentsDue** (function) `(db: Queryable, now: Date, limit: number): Promise<DecideSubject[]>`
- **commentsCalled** (function) `(db: Queryable, limit: number): Promise<DecideSubject[]>`
- **commentSource** (const) `DecideSource`

## packages/outreach/src/discovery/people.ts

- **personFacts** (function) `(p: Profile, now: Date): PersonFacts`
- **readWords** (function) `(llm: LlmClient, p: Profile, audience: string): Promise<{ read: PersonRead; fit: number; site: string | null } | null>`
- **keepPerson** (function) `(db: Queryable, p: Profile, read: Awaited<ReturnType<typeof readWords>>, now: Date): Promise<RedditPerson>`
- **readPerson** (function) `(r: Reader, db: Queryable, llm: LlmClient | null, handle: string, o: { audience: string; now: Date; step?: <T>(name: string, fn: () => Promise<T>) => Promise<T> }): Promise<RedditPerson>`
- **personLine** (function) `(p: Pick<RedditPerson, "read" | "fit" | "site">): string | null`
- **peopleToRead** (function) `(db: Queryable, ours: string[], now: Date, limit: number): Promise<string[]>`
- **wordsOf** (function) `(p: Profile): string`

## packages/outreach/src/discovery/places.ts

- **topicsOf** (function) `(llm: LlmClient | null, a: Audience): Promise<string[]>`
- **addPlaces** (function) `(db: Queryable, found: { name: string; foundBy: string; subscribers?: number | null }[]): Promise<number>`
- **addKarmaPlaces** (function) `(db: Queryable, subs: readonly string[] = KARMA_PLACES): Promise<number>`
- **placesOfPeople** (function) `(db: Queryable): Promise<string[]>`
- **placesToRead** (function) `(db: Queryable, now: Date, limit: number): Promise<{ subreddit: string; state: "skipped" | "found" | "watching"; purpose: "reach" | "karma"; }[]>`
- **paceOf** (function) `(latest: readonly Post[]): { postsADay: number; medianComments: number }`
- **judgePlace** (function) `(llm: LlmClient, sub: string, read: PlaceRead, audience: Audience, purpose: PlacePurpose = "reach"): Promise<PlaceJudged | null>`
- **keepPlace** (function) `(db: Queryable, sub: string, read: PlaceRead, judged: PlaceJudged | null, now: Date): Promise<{ rulesChanged: boolean }>`
- **placeBySub** (function) `(db: Queryable, sub: string): Promise<RedditPlace>`
- **accountFor** (function) `(db: Queryable, place: RedditPlace, now: Date): Promise<string | null>`
- **watchPlace** (function) `(db: Queryable, sub: string, now: Date): Promise<{ account: string | null }>`
- **settleKarmaPlace** (function) `(db: Queryable, sub: string, now: Date): Promise<RedditPlace["state"] | null>`
- **skipPlace** (function) `(db: Queryable, sub: string): Promise<void>`
- **movePlace** (function) `(db: Queryable, sub: string, account: string): Promise<void>`
- **failPlace** (function) `(db: Queryable, sub: string, why: string, now: Date): Promise<void>`
- **placesDue** (function) `(db: Queryable, now: Date, everyMs: number, limit: number, purpose: PlacePurpose = "reach"): Promise<{ subreddit: string; name: string; foundBy: string; raw: unknown; judged: PlaceJudged | null; fit: number | null; subscribers: number | null; state: "skipped" | "found" | "watching"; purpose: "reach" | "karma"; accountId: string | null; readAt: Date | null; threadsAt: Date | null; joinedAt: …`
- **placesToJoin** (function) `(db: Queryable, limit: number): Promise<{ subreddit: string; account: string; }[]>`
- **joined** (function) `(db: Queryable, sub: string, now: Date): Promise<void>`
- **threadsRead** (function) `(db: Queryable, sub: string, now: Date): Promise<void>`
- **WREN_ABOUT** (const) `"Medium-sized businesses that charge a lot per client: agencies, consultancies, recruiters, B2B services, clinics and firms like them. Owners and operators who sell, deliver and hire."`
- **discoverySettingsSchema** (const) `z.ZodObject<{ about: z.ZodDefault<z.ZodString>; topics: z.ZodDefault<z.ZodArray<z.ZodString>>; subreddits: z.ZodDefault<z.ZodArray<z.ZodString>>; minMembers: z.ZodDefault<z.ZodNumber>; minPostsADay: z.ZodDefault<z.ZodNumber>; exaSearches: z.ZodDefault<z.ZodNumber>; autoSend: z.ZodDefault<z.ZodBoolea…`
- **Audience** (type) `type Audience = z.infer<typeof discoverySettingsSchema>;`
- **WREN_AUDIENCE** (const) `Audience`
- **PLACE_FRESH_MS** (const) `number`
- **KARMA_PLACES** (const) `readonly ["NoStupidQuestions", "CasualConversation", "careerguidance", "productivity", "Entrepreneur", "excel", "googlesheets", "answers", "getdisciplined", "learnprogramming", "nocode", "automation"]`

## packages/outreach/src/discovery/reads.ts

- **reader** (function) `(sites: SiteClient, as?: string): Reader`
- **PUBLIC_SITE** (const) `"reddit-public"`
- **signedOut** (function) `(sites: SiteClient): SiteClient`
- **Post** (type) `type Post = Thing & { subreddit?: string; url?: string; over_18?: boolean; locked?: boolean; archived?: boolean; stickied?: boolean; removed_by_category?: string | null; link_flair_text?: string | null; };`
- **itemsOf** (function) `(l: Listing | undefined): T[]`
- **PlaceRead** (interface) `interface PlaceRead { about: SubredditAbout; rules: unknown; top: Post[]; latest: Post[]; }`
- **Reader** (interface) `interface Reader { person(handle: string): Promise<Profile>; searchPlaces(topic: string): Promise<{ name: string; subscribers: number }[]>; exaPlaces(topic: string): Promise<string[]>; place(sub: string): Promise<PlaceRead>; latest(subs: readonly string[], since: number, pages?: number): Promise<Post[]>; thread(id: string): Promise<{ post: Post; comments: (Thing & { depth: number })[] }>; info(ids: string[]): Promise<Thing[]>; }`
- **SUBS_PER_READ** (const) `25`
- **subredditsIn** (function) `(urls: readonly string[]): string[]`

## packages/outreach/src/discovery/requirements.ts

- **parseNeed** (function) `(raw: string): Need`
- **standingOfAccount** (function) `(a: ReachAccount, now: Date): AccountStanding`
- **shortfall** (function) `(need: Need, s: AccountStanding): Shortfall`
- **effectiveNeed** (function) `(rows: readonly RedditRequirement[]): Need & { hold: boolean }`
- **decide** (function) `(name: string, pinned: string | null, need: Need & { hold: boolean }, pool: readonly { id: string; standing: AccountStanding }[]): Gate`
- **gatesFor** (function) `(db: Queryable, subs: readonly string[] | null, now: Date): Promise<Map<string, Gate>>`
- **applyGates** (function) `(db: Queryable, now: Date): Promise<Map<string, Gate>>`
- **learnFromProof** (function) `(db: Queryable, item: string, proof: { state: string; note: string | null; checkedAt: string }): Promise<boolean>`
- **backfillFromProofs** (function) `(db: Queryable): Promise<number>`
- **keepRulesNeed** (function) `(db: Queryable, sub: string, judged: PlaceJudged | null, rules: string): Promise<void>`
- **setNeed** (function) `(db: Queryable, subName: string, need: Partial<Need>, note: string | null): Promise<void>`
- **learnText** (function) `(db: Queryable, subName: string, text: string, now: Date): Promise<Need>`
- **clearGate** (function) `(db: Queryable, subName: string, now: Date): Promise<number>`
- **gateList** (function) `(db: Queryable, now: Date): Promise<GateRow[]>`
- **Need** (interface) `interface Need { minAgeDays: number | null; minKarma: number | null; minCommentKarma: number | null; other: string | null; }`
- **NO_NEED** (const) `Need`
- **AccountStanding** (interface) `interface AccountStanding { account: string; ageDays: number | null; karma: number | null; commentKarma: number | null; }`
- **Gate** (interface) `interface Gate { ok: boolean; reason: string | null; accountId: string | null; switched: boolean; need: Need; hold: boolean; }`
- **ThreadHeld** (class) ``
- **holdsThread** (function) `(g: Gate | undefined, picked: boolean): boolean`

## packages/outreach/src/discovery/threads.ts

- **dropReason** (function) `(p: Post, o: { now: Date; ours: readonly string[]; judged: PlaceJudged | null; purpose?: PlacePurpose }): string | null`
- **keepThreads** (function) `(db: Queryable, sub: string, posts: readonly Post[], o: { now: Date; ours: readonly string[]; judged: PlaceJudged | null; purpose?: PlacePurpose }): Promise<string[]>`
- **unrankedThreads** (function) `(db: Queryable, sub: string, purpose: PlacePurpose = "reach"): Promise<string[]>`
- **rankThreads** (function) `(db: Queryable, llm: LlmClient, ids: readonly string[], audience: Audience, purpose: PlacePurpose = "reach"): Promise<number>`
- **commentsToday** (function) `(db: Queryable, accountId: string, now: Date): Promise<number>`
- **roomFor** (function) `(purpose: PlacePurpose, caps: { comments: number; reachComments: number }, used: PlaceUse): number`
- **expireStale** (function) `(db: Queryable, now: Date): Promise<number>`
- **queueThreads** (function) `(db: Queryable, sub: string, now: Date): Promise<string[]>`
- **threadsToDraft** (function) `(db: Queryable, limit: number, now = new Date()): Promise<{ id: string; author: string; accountId: string | null; karma: boolean; }[]>`
- **factsFor** (function) `(words: string, facts: readonly { label: string; text: string }[], n = 2): { label: string; text: string }[]`
- **pitchIn** (function) `(text: string): string | null`
- **draftThread** (function) `(db: Queryable, llm: LlmClient, id: string, o: { read: ThreadRead; op: RedditPerson | null; facts: readonly { label: string; text: string }[]; truths?: readonly string[]; voice: string; ours: readonly string[]; posts?: readonly OurPost[]; karma?: boolean; }): Promise<"drafted" | "dropped" | "unread">`
- **planThreadComment** (function) `(db: Queryable, id: string, now: Date): Promise<CommentPlan>`
- **markCommented** (function) `(db: Queryable, id: string, r: { body: string; ref: string | null; accountId: string; now: Date; by?: string }): Promise<void>`
- **skipThread** (function) `(db: Queryable, id: string, o: { by?: string; reason?: RejectReason | null; note?: string | null } = {}): Promise<void>`
- **threadsToScore** (function) `(db: Queryable, now: Date, limit = 50): Promise<{ id: string; ref: string | null; }[]>`
- **keepScores** (function) `(db: Queryable, scores: readonly { ref: string; score: number }[], now: Date): Promise<void>`
- **SLOT_WITHIN_MS** (const) `number`
- **KARMA_FRESH_MS** (const) `number`
- **inKarmaPlace** (const) `import("drizzle-orm").SQL<boolean>`
- **RANK_BATCH** (const) `10`
- **dayStart** (function) `(now: Date): Date`
- **ThreadRead** (interface) `interface ThreadRead { post: Post; comments: Array<{ name: string; author?: string; body?: string; depth: number; score?: number }>; }`

## packages/outreach/src/draft-accounts.ts

- **pickedAccount** (function) `(db: Queryable, item: string): Promise<string | null>`
- **pickedAccounts** (function) `(db: Queryable, items: readonly string[]): Promise<Map<string, string>>`
- **pickAccount** (function) `(db: Queryable, req: { item: string; account: string | null; by?: string | null; now?: Date }): Promise<AccountPick | null>`
- **accountPickFor** (function) `(db: Queryable, item: string, now = new Date()): Promise<AccountPick | null>`
- **pickedReachAccount** (function) `(db: Queryable, item: string): Promise<ReachAccount | null>`

## packages/outreach/src/draft-llm.ts

- **modelFor** (function) `(llm: LlmClient, item: string): Promise<Picked>`
- **Picked** (interface) `interface Picked { llm: LlmClient; arm: string | null; }`
- **ArmedLlm** (class) `readonly name: string;; readonly provider: string;; constructor(private readonly base: LlmClient, private readonly arms: () => Promise<readonly DraftArm[]>, private readonly client: (model: string) => LlmClient | null); complete(prompt: string, opts?: CompleteOptions): Promise<LlmResponse>; forItem(item: string): Promise<Picked>`
- **armMeta** (function) `(arm: string | null): Record<string, unknown>`
- **guardBy** (function) `(p: Picked): string | null`
- **savedArms** (function) `(db: Queryable): () => Promise<readonly { model: string; weight: number; }[]>`

## packages/outreach/src/draft-models.ts

- **parseSince** (function) `(v: string, now: Date): Date | null`
- **scoredFrom** (function) `(item: string, steps: readonly Step[]): Omit<ScoredDraft, "proof" | "replies"> | null`
- **draftScorecard** (function) `(db: Queryable, since: Date): Promise<Scorecard>`

## packages/outreach/src/drafts.ts

- **contactsToDraft** (function) `(db: Queryable, limit: number, now = new Date()): Promise<number[]>`
- **draftsToday** (function) `(db: Queryable, now: Date): Promise<number>`
- **dmContext** (function) `(db: Queryable, contactId: number, now = new Date()): Promise<{ contact: { name: string | null; id: number; niche: string | null; url: string; state: "finished" | "enrolled" | "replied" | "new" | "opted_out" | "unreachable" | "connected" | "blocked"; createdAt: Date; draft: string | null; personId: number | null; companyId: number | null; endedAt: Date…`
- **draftDm** (function) `(db: Queryable, llm: LlmClient, contactId: number, o: { sender: string; guide?: DmGuide; facts?: readonly string[]; now: Date; }): Promise<string | null>`
- **queueDraft** (function) `(db: Queryable, contact: ReachContact, body: string | null | undefined, subject: string | null, now: Date, by = "console"): Promise<{ kind: "manual" | "inbound" | "sequence" | "follow_up" | "connect"; runId: string | null; id: number; state: "proposed" | "unknown" | "sent" | "sending" | "skipped" | "failed" | "queued" | "received"; createdAt: Date; step: number | null; template: string | null; templateVersion: string | n…`
- **DRAFTS_PER_DAY** (const) `30`
- **DRAFT_MAX** (const) `1000`
- **DmGuide** (type) `type DmGuide = (platform: DmPlatform) => Promise<string>;`
- **BRIEF** (const) `string`

## packages/outreach/src/enroll.ts

- **enroll** (function) `(db: Queryable, o: EnrollOptions): Promise<EnrollStats>`
- **EnrollOptions** (interface) `interface EnrollOptions { sequence: ReachSequence; sender: string; contactIds?: readonly number[]; ordered?: boolean; first?: "queued" | "proposed"; enrichedOnly?: boolean; limit: number; take?: number; account?: string; now: Date; runId?: string | null; }`
- **EnrollStats** (interface) `interface EnrollStats { considered: number; enrolled: number; noAccount: boolean; leadBusy: number; }`

## packages/outreach/src/examples.ts

- **termsOf** (function) `(text: string): Set<string>`
- **pickExamples** (function) `(pool: readonly CommentExample[], about: string, limit = EXAMPLES_MAX): CommentExample[]`
- **commentDecisions** (function) `(db: Queryable, kinds: readonly LearnedKind[] = COMMENT_KINDS_LEARNED, now = new Date()): Promise<CommentExample[]>`
- **commentExamples** (function) `(db: Queryable, o: { kinds?: readonly LearnedKind[]; about: string; limit?: number; now?: Date }): Promise<CommentExample[]>`
- **examplesBlock** (function) `(examples: readonly CommentExample[]): string`
- **COMMENT_KINDS_LEARNED** (const) `readonly ["comment", "thread", "post_comment"]`
- **EXAMPLES_MAX** (const) `6`
- **CommentExample** (interface) `interface CommentExample { item: string; kind: LearnedKind; platform: string | null; yes: boolean; text: string; reason: RejectReason | null; note: string | null; about: string; at: Date; }`
- **examplesFor** (function) `(db: Queryable, kinds: readonly LearnedKind[], about: string): Promise<string>`

## packages/outreach/src/follow-ups.ts

- **commentsReadSettings** (function) `(block: unknown): CommentsReadSettings`
- **nextCheckAt** (function) `(activeAt: Date, now: Date, r: number): Date`
- **followUpsOf** (function) `(read: ThreadRead, scope: FollowUpScope): CommentIn[]`
- **mergeReads** (function) `(base: ThreadRead, more: readonly ThreadRead[]): ThreadRead`
- **watchFromComments** (function) `(db: Queryable, now: Date, days: number, platforms: readonly string[]): Promise<number>`
- **dueThreads** (function) `(db: Queryable, now: Date, accounts: readonly string[]): Promise<CommentThread[]>`
- **needsRead** (function) `(t: CommentThread, count: number | undefined, now: Date): boolean`
- **probed** (function) `(db: Queryable, id: number, at: Date): Promise<void>`
- **applyThread** (function) `(db: Queryable, t: CommentThread, account: Pick<ReachAccount, "id" | "platform">, read: ThreadRead, ours: readonly string[], now: Date, r: number, days: number): Promise<Applied>`
- **focusesOf** (function) `(read: ThreadRead, ours: readonly string[], limit = FOCUS_READS): string[]`
- **threadContextOf** (function) `(db: Queryable, id: number, postOf?: (platform: string, post: string) => Promise<Partial<ContextPost> | null>): Promise<ThreadContext | null>`
- **adoptNode** (function) `(db: Queryable, from: number, ref: string): Promise<number>`
- **threadFor** (function) `(db: Queryable, id: number, now = new Date(), days = 7): Promise<{ thread: CommentThread; account: ReachAccount } | null>`
- **asThread** (function) `(t: CommentThread): CommentThread`
- **COMMENTS_READ** (const) `"comments.read"`
- **commentsReadSettingsSchema** (const) `z.ZodObject<{ followUpDays: z.ZodDefault<z.ZodNumber>; }, z.core.$strict>`
- **wrenCommentsRead** (function) `(db: Queryable): Promise<{ followUpDays: number; }>`
- **THREAD_FLOOR_MS** (const) `number`
- **THREAD_IDLE_MS** (const) `number`
- **THREAD_READS_PER_PASS** (const) `3`
- **Applied** (interface) `interface Applied { kept: Array<Pick<Comment, "id" | "platform" | "author" | "post">>; answered: number[]; }`
- **ContextNode** (interface) `interface ContextNode { ref: string; parent: string; handle: string; text: string; at: string; url: string | null; ours: boolean; row: { id: number; state: string } | null; }`
- **ThreadContext** (interface) `interface ThreadContext { platform: string; post: ContextPost; nodes: ContextNode[]; focus: string; readAt: string | null; more: number; refresh: boolean; }`

## packages/outreach/src/follow.ts

- **reachCadence** (function) `(seq: ReachSequence): Workflow`
- **reachLead** (function) `(contactId: number): ExecutorEvent`
- **touchStep** (function) `(db: Queryable, o: Pick<TickOptions, "sequences" | "sender">, clientDb?: (client: string) => Queryable, follow?: FollowDms): Step`

## packages/outreach/src/invites.ts

- **inviteSettings** (function) `(db: Queryable): Promise<InviteSettings>`
- **peopleForInvites** (function) `(db: Queryable, partial: Partial<PickSettings>, held: readonly string[], limit: number): Promise<InviteTarget[]>`
- **whyOf** (function) `(t: InviteTarget): InviteFit`
- **topUp** (function) `(db: Queryable, o: { settings: InviteSettings; account: ReachAccount; policy: ReachPolicy; sequences: ReadonlyMap<string, ReachSequence>; sender: string; held: readonly string[]; now: Date; runId?: string | null; }): Promise<TopUpStats>`
- **proposedInvites** (function) `(db: Queryable, limit = 100): Promise<ProposedInvite[]>`
- **approveInvites** (function) `(db: Queryable, contactIds: readonly number[], now: Date): Promise<number[]>`
- **skipInvites** (function) `(db: Queryable, contactIds: readonly number[], now: Date): Promise<number[]>`
- **markAccepted** (function) `(db: Queryable, accountId: string, connections: readonly Connection[], now: Date): Promise<{ accepted: number[]; byHand: number }>`
- **connectionsDrift** (function) `(db: Queryable, accountId: string, connections: readonly Connection[], max: number): Promise<{ site: number; wren: number; gone: string[] } | null>`
- **applyWithdraw** (function) `(db: Queryable, contactId: number, r: { withdrawn: boolean; relationship: Relationship }, days: number, now: Date): Promise<WithdrawOutcome>`
- **sweepInvites** (function) `(db: Queryable, ch: OutreachChannel, account: ReachAccount, s: InviteSettings, now: Date, run: Journal = (_n, fn) => fn()): Promise<SweepStats>`
- **INVITES_COMPONENT** (const) `"linkedin.invites"`
- **INVITE_SEQUENCE** (const) `"linkedin-invite"`
- **invitedSql** (function) `(contactId: SQL): SQL<unknown>`
- **DRIFT_ERROR** (const) `"drift:"`
- **VANITY** (const) `SQL<unknown>`
- **invitesSettingsSchema** (const) `z.ZodObject<{ account: z.ZodDefault<z.ZodString>; perDay: z.ZodDefault<z.ZodNumber>; niches: z.ZodDefault<z.ZodArray<z.ZodString>>; titles: z.ZodDefault<z.ZodArray<z.ZodString>>; decisionMakers: z.ZodDefault<z.ZodBoolean>; minEmployees: z.ZodDefault<z.ZodNumber>; knownSizeOnly: z.ZodDefault<z.ZodBoo…`
- **InviteSettings** (type) `type InviteSettings = z.infer<typeof invitesSettingsSchema>;`
- **TopUpStats** (interface) `interface TopUpStats { target: number; queued: number; added: number; enrolled: number; leadBusy: number; }`
- **ProposedInvite** (interface) `interface ProposedInvite { id: number; handle: string; name: string | null; fit: InviteFit | null; at: Date; }`
- **SweepStats** (interface) `interface SweepStats { accepted: number[]; backfilled: number; byHand: number; settled: number; drift: { site: number; wren: number; gone: string[] } | null; withdrawn: number; gone: number; errors: string[]; }`
- **emptySweep** (function) `(errors: string[] = []): SweepStats`

## packages/outreach/src/limits.ts

- **followsLeft** (function) `(db: Queryable, main: Queryable, platform: ReachPostPlatform, now: Date): Promise<number>`
- **WREN_LIMITS** (const) `readonly LimitDef[]`

## packages/outreach/src/pain.ts

- **painBatch** (function) `(db: Queryable): Promise<string>`
- **proven** (function) `(text: string, quote: string): boolean`
- **readPains** (function) `(llm: LlmClient, posts: readonly ReachPost[]): Promise<Pain[]>`
- **painPass** (function) `(db: Queryable, llm: LlmClient, sources: readonly string[], cursor: number, now: Date, limit = 50): Promise<PainPass>`
- **PER_CALL** (const) `10`
- **MAX_AGE_DAYS** (const) `14`
- **PainPass** (interface) `interface PainPass { fires: Fired[]; cursor: number; scanned: number; read: number; pains: number; unproven: number; waiting: boolean; more: boolean; }`
- **Pain** (type) `type Pain = z.infer<typeof PAINS>["pains"][number];`
- **painPrompt** (function) `(posts: readonly ReachPost[]): string`
- **painKey** (function) `(document: number, quote: string): string`
- **painFired** (function) `(source: string, p: { id: number; profile: number; pain: string }, now: Date): Fired`

## packages/outreach/src/passes.ts

- **passedOn** (function) `(db: Queryable, platform: string): Promise<Set<string>>`
- **whoOf** (function) `(db: Queryable, item: string): Promise<Who | null>`
- **passOn** (function) `(db: Queryable, items: readonly string[], o: { reason: PassReason; note?: string | null; by?: string | null; now: Date }): Promise<{ people: number; closed: number }>`
- **liftPass** (function) `(db: Queryable, platform: string, handle: string, now: Date): Promise<boolean>`
- **listPasses** (function) `(db: Queryable, o: { limit?: number } = {}): Promise<{ id: number; platform: string; handle: string; name: string; reason: "not_now" | "spam" | "not_lead" | "not_worth" | "competitor" | "rude"; note: string | null; item: string | null; by: string | null; until: Date | null; liftedAt: Date | null; createdAt: Date; }[]>`
- **passKey** (function) `(handle: string | null | undefined, name: string): string`
- **Who** (interface) `interface Who { platform: string; handle: string; name: string; }`

## packages/outreach/src/policy.ts

- **parseClock** (function) `(text: string): number`
- **fleetDay** (function) `(at: Date): string`
- **sendDaysBetween** (function) `(from: string, to: string, days: readonly number[]): number`
- **inWindow** (function) `(at: Date, policy: ReachPolicy): boolean`
- **standingOf** (function) `(a: { platform: Platform; startedOn: string; health: AccountHealth | null }, policy: ReachPolicy, now: Date): Standing`
- **FLEET_ZONE** (const) `"America/New_York"`
- **ReachPolicy** (interface) `interface ReachPolicy { windowStartMinute: number; windowEndMinute: number; days: readonly number[]; gapSeconds: number; reddit: { messagesPerDay: number; }; linkedin: { connectsStart: number; connectsStep: number; rampEverySendDays: number; connectsCap: number; messagesPerDay: number; notesPerMonth: number; }; }`
- **DEFAULT_POLICY** (const) `ReachPolicy`
- **Standing** (interface) `interface Standing { caps: { connects: number; messages: number }; frozen: string | null; stage: string; }`

## packages/outreach/src/proofs.ts

- **proofTarget** (function) `(db: Queryable, item: string): Promise<ProofTarget | null>`
- **keepProof** (function) `(db: Queryable, item: string, platform: string, proof: Proof, round: number): Promise<{ warn: boolean }>`
- **sentSince** (function) `(db: Queryable, sinceAt: Date): Promise<string[]>`
- **PROOF_ROUNDS** (const) `readonly [{ readonly round: 1; readonly delayMs: number; }, { readonly round: 2; readonly delayMs: number; }, { readonly round: 3; readonly delayMs: number; }]`
- **HAND_ROUND** (const) `0`
- **isProofItem** (function) `(item: string): boolean`
- **proofOf** (function) `(db: Queryable, item: string): Promise<CommentProofRow | null>`
- **proofsSince** (function) `(db: Queryable, since: Date): Promise<CommentProofRow[]>`
- **warningOf** (function) `(item: string, platform: string, proof: Proof): { title: string; body: string; }`

## packages/outreach/src/reach-posts/acts.ts

- **planPostComment** (function) `(db: Queryable, id: number): Promise<ReachPost>`
- **planPostAct** (function) `(db: Queryable, id: number, act: "like" | "follow"): Promise<ReachPost>`
- **markPostCommented** (function) `(db: Queryable, post: ReachPost, r: { body: string; by: string; now: Date }): Promise<void>`
- **ownCircle** (function) `(p: Pick<ReachPost, "platform" | "handle" | "author" | "headline" | "text">): boolean`
- **followAct** (function) `(platform: ReachPostPlatform, who: { handle: string } | { company: string }): SiteAct`
- **postActs** (function) `(p: ReachPost, s: Pick<CommentsSettings, "like" | "follow">, body: string): { comment: SiteAct | null; like: SiteAct | null; follow: SiteAct | null }`
- **autoActs** (function) `(db: Queryable, o: { platform: ReachPostPlatform; settings: Pick<CommentsSettings, "like" | "follow" | "minFit">; call: (act: SiteAct) => Promise<unknown>; step: <T>(name: string, fn: () => Promise<T>) => Promise<T>; holds: CapHolds; now: Date; followsLeft?: number; }): Promise<ActsStats>`
- **markPostActed** (function) `(db: Queryable, id: number, act: "like" | "follow", now: Date): Promise<void>`
- **skipPost** (function) `(db: Queryable, ids: readonly number[], o: { by?: string; reason?: RejectReason | null; note?: string | null } = {}): Promise<number[]>`
- **listPosts** (function) `(db: Queryable, o: { state?: string; limit?: number } = {}): Promise<{ id: number; platform: "linkedin" | "youtube" | "x" | "tiktok" | "instagram" | "threads"; state: "dropped" | "skipped" | "queued" | "found" | "commented"; author: string; fit: number | null; why: string | null; draft: string | null; url: string; foundBy: string; }[]>`
- **ACTS_PER_PASS** (const) `5`
- **ActsStats** (interface) `interface ActsStats { liked: number; followed: number; held: string[]; errors: string[]; }`

## packages/outreach/src/reach-posts/draft.ts

- **draftPost** (function) `(db: Queryable, llm: LlmClient, id: number, o: CommentDraftOptions & { now: Date }): Promise<"queued" | "dropped" | "gone">`
- **redraftPosts** (function) `(db: Queryable, llm: LlmClient, ids: readonly number[], o: CommentDraftOptions & { settings: Readonly<Record<ReachPostPlatform, CommentsSettings>>; why?: string; now: Date; }): Promise<RedraftResult>`
- **RedraftResult** (interface) `interface RedraftResult { redrafted: number[]; dropped: { id: number; why: string }[]; skipped: { id: number; why: string }[]; }`

## packages/outreach/src/reach-posts/pass.ts

- **keepPosts** (function) `(db: Queryable, posts: readonly FeedPost[], o: { platform: ReachPostPlatform; foundBy: string; account: string; topics: readonly string[]; audience?: readonly string[]; key?: boolean; ours: readonly string[]; halfLifeHours: number; maxAgeHours: number; now: Date; }): Promise<{ found: number[]; dropped: number }>`
- **postsPass** (function) `(db: Queryable, o: { platform: ReachPostPlatform; settings: CommentsSettings; read: PostReader; llm: LlmClient | null; guide?: () => Promise<string>; voice?: string; facts?: () => Promise<readonly string[]>; ours?: () => Promise<readonly OurPost[]>; now: Date; step: <T>(name: string, fn: () => Promise<T>) => Promise<T>; capped?: (err: unknown) => boolean; }): Promise<PostsStats>`
- **PostsStats** (interface) `interface PostsStats { platform: ReachPostPlatform; account: string; reads: number; kept: number; dropped: number; queued: number; scheduled?: number; acts?: ActsStats; capped: boolean; topics: string[]; rested: string[]; errors: string[]; }`

## packages/outreach/src/reach-posts/rank.ts

- **momentum** (function) `(p: Pick<FeedPost, "reactions" | "comments">, ageH: number | null, halfLifeHours: number): number`
- **jobPost** (function) `(text: string, headline = ""): JobPost | null`
- **authorFit** (function) `(headline: string, audience: readonly string[]): { points: number; kind: "buyer" | "seller" | "owner" | "manager" | null }`
- **rankPost** (function) `(p: FeedPost, o: { topics: readonly string[]; audience?: readonly string[]; key: boolean; foundBy: string; halfLifeHours: number; now: Date; }): { fit: number; why: string; off: string | null }`
- **topicCore** (function) `(topic: string): string`
- **MOMENTUM_MAX** (const) `14`
- **isJobAd** (function) `(text: string, headline = ""): boolean`

## packages/outreach/src/reach-posts/read.ts

- **shortcodeAt** (function) `(code: string): Date | null`
- **phrase** (function) `(keywords: string): string`
- **postReader** (function) `(sites: SiteClient, platform: ReachPostPlatform, account: string, o: { authorTitle?: string; now: Date }): PostReader`
- **FeedPost** (interface) `interface FeedPost { ref: string; author: string; authorUrl: string | null; handle?: string | null; headline?: string; text: string; age?: string; at?: string; approx?: true; reactions: number; comments: number; url: string; off?: string; raw?: unknown; }`
- **Since** (type) `type Since = "past-24h" | "past-week" | "past-month";`
- **KeyPerson** (interface) `interface KeyPerson { handle: string; name: string; }`
- **PostReader** (interface) `interface PostReader { search(keywords: string, since: Since): Promise<FeedPost[]>; page(handle: string): Promise<FeedPost[]>; person(k: KeyPerson, since: Since): Promise<FeedPost[]>; one(ref: string): Promise<FeedPost | null>; feed(): Promise<FeedPost[]>; }`
- **YtVideo** (interface) `interface YtVideo { id: string; snippet?: { title?: string; description?: string; channelId?: string; channelTitle?: string; publishedAt?: string; categoryId?: string; defaultAudioLanguage?: string; }; statistics?: { likeCount?: string; commentCount?: string }; }`
- **ytPostOf** (function) `(v: YtVideo): FeedPost | null`
- **nameOfVanity** (function) `(vanity: string): string`
- **vanityOf** (function) `(url: string | null | undefined): string | null`

## packages/outreach/src/reach-posts/settings.ts

- **commentsSettings** (function) `(db: Queryable, platform: ReachPostPlatform): Promise<CommentsSettings>`
- **allCommentsSettings** (function) `(db: Queryable): Promise<Record<ReachPostPlatform, CommentsSettings>>`
- **COMMENTS_COMPONENTS** (const) `Readonly<Record<ReachPostPlatform, string>>`
- **PLATFORM_NAME** (const) `Readonly<Record<ReachPostPlatform, string>>`
- **COMMENT_MAX** (const) `Readonly<Record<ReachPostPlatform, number>>`
- **COMMENT_LENGTH** (const) `Readonly<Record<ReachPostPlatform, string>>`
- **MIN_FIT** (const) `70`
- **DEFAULT_AUDIENCE** (const) `readonly ["business", "compan", "firm", "agency", "founder", "owner", "ceo", "b2b", "startup", "client", "customer"]`
- **COMMENTS_SETTINGS** (const) `Record<"linkedin" | "youtube" | "x" | "tiktok" | "instagram" | "threads", z.ZodObject<{ account: z.ZodDefault<z.ZodString>; perDay: z.ZodDefault<z.ZodNumber>; autoSend: z.ZodDefault<z.ZodBoolean>; topics: z.ZodDefault<z.ZodArray<z.ZodString>>; pages: z.ZodDefault<z.ZodArray<z.ZodString>>; people: z.…`
- **CommentsSettings** (type) `type CommentsSettings = z.infer<ReturnType<typeof commentsSettingsSchemaFor>>;`

## packages/outreach/src/reach-posts/topics.ts

- **topicYields** (function) `(db: Queryable, o: { platform: ReachPostPlatform; minFit: number; now: Date }): Promise<TopicYield[]>`
- **planTopics** (function) `(own: readonly string[], yields: readonly TopicYield[], fresh: readonly string[], extra: number, audience?: readonly string[]): { topics: string[]; rested: string[] }`
- **proposeTopics** (function) `(llm: LlmClient, o: { platform?: ReachPostPlatform; about: string; n: number; yields: readonly TopicYield[]; known: readonly string[]; audience?: readonly string[]; }): Promise<string[]>`
- **REST_AFTER** (const) `15`

## packages/outreach/src/records.ts

- **turnOf** (function) `(unread: boolean, draft: string | null | undefined, last: string | null): "reply" | "draft" | "sent" | null`
- **dmCopyRecord** (function) `(sender: string): import("@wren/core/records").RecordType`
- **COMMENT_FOLD** (const) `RecordFold`
- **dmRecord** (const) `import("@wren/core/records").RecordType`
- **PLATFORM_LABELS** (const) `Record<"reddit" | "linkedin" | "youtube" | "x" | "tiktok" | "instagram" | "google_business" | "facebook", import("@wren/core/records").State>`
- **commentRecord** (const) `import("@wren/core/records").RecordType`
- **placeRecord** (const) `import("@wren/core/records").RecordType`
- **threadRecord** (const) `import("@wren/core/records").RecordType`
- **inviteRecord** (const) `import("@wren/core/records").RecordType`
- **personRecord** (const) `import("@wren/core/records").RecordType`
- **accountRecordOf** (function) `(policy: ReachPolicy = DEFAULT_POLICY): import("@wren/core/records").RecordType`
- **accountRecord** (const) `import("@wren/core/records").RecordType`

## packages/outreach/src/refusal.ts

- **ReachRefusal** (class) `override name`

## packages/outreach/src/replies.ts

- **pullReplies** (function) `(db: Queryable, accounts: readonly ReachAccount[], channelFor: (a: ReachAccount) => OutreachChannel | null, now: Date): Promise<RepliesStats>`
- **receive** (function) `(db: Queryable, platform: Platform, accountId: string, r: Reply, now: Date): Promise<{ received: number; optedOut: number; contactId?: number }>`
- **isOptOut** (function) `(text: string): boolean`
- **RepliesStats** (interface) `interface RepliesStats { checked: number; received: number; optedOut: number; errors: string[]; replied?: number[]; }`

## packages/outreach/src/reply-drafts.ts

- **clearReplyDrafts** (function) `(db: Queryable): Promise<{ threads: number; posts: number; comments: number; dms: number; }>`

## packages/outreach/src/restate/deps.ts

- **channelsFor** (function) `(deps: ReachDeps, ctx: restate.Context): (a: ReachAccount) => OutreachChannel | null`
- **clientDeps** (function) `(deps: ReachDeps, plan: Extract<ClientReach, { kind: "work" }>, part: ReachPart, now: Date, model = false): ReachDeps`
- **finalRefusal** (function) `(err: unknown): unknown`
- **ReachClients** (interface) `interface ReachClients { clientDb: (id: string) => Db; llm: LlmClient | null; keys?: KeyStore | null; dmGuide?: (db: Db, platform: DmPlatform) => Promise<string>; facts?: (db: Db) => Promise<{ label: string; text: string }[]>; }`
- **ReachDeps** (interface) `interface ReachDeps { db: Db; pushes?: (ctx: restate.ObjectContext) => Promise<ReachView>; fire?: FireTriggers; policy: ReachPolicy; sequences: ReadonlyMap<string, ReachSequence>; live: boolean; senderName: string; heldNiches: readonly string[]; sitesFor: (ctx: restate.Context) => SiteClient; deskUp?: (ctx: restate.Context) => Promise<boolean>; notifier?: Notifier; clock?: () => Date; postedAt?: (platform: Platform) => Promise<string | null>; drafts?: { llm: LlmClient | null; guide?: DmGuide; commentGuide?: (platform: DmPlatform | ReachPostPlatform) => Promise<string>; voice?: string; facts?: () => Promise<readonly string[]>; ours?: () => Promise<readonly OurPost[]>; }; clients?: ReachClients; }`
- **ReachView** (type) `type ReachView = { pushed: string[]; watched: string[] };`
- **SENDER_KEY** (const) `"fleet"`
- **WATCH_KEY** (const) `"daily"`
- **wakeWatch** (function) `(ctx: restate.Context, client: string | null = null): restate.InvocationHandle`

## packages/outreach/src/restate/desk-context.ts

- **terminalWhy** (function) `(req: { reason?: unknown; note?: unknown }): { reason: import("@wren/core/reject-reasons").RejectReason | null; note: string | null; }`

## packages/outreach/src/restate/desk-settle.ts

- **PostSettle** (type) `type PostSettle = { settlePost: ( ctx: restate.ObjectContext, req: { id: string; outcome: SettleOutcome; by: string }, ) => Promise<{ id: string; outcome: SettleOutcome; found: boolean }>; };`

## packages/outreach/src/restate/desk.ts

- **makeReachDesk** (function) `(deps: ReachDeps): restate.ServiceDefinition<"ReachDesk", { draftModels: (ctx: restate.Context, req?: { since?: string | null; }) => Promise<import("@wren/core/draft-models").Scorecard>; stats: (ctx: restate.Context, req?: { platform?: string | null; days?: number; }) => Promise<import("../threads.js").ReachStats>; fi…`
- **ReachDeskService** (type) `type ReachDeskService = ReturnType<typeof makeReachDesk>;`

## packages/outreach/src/restate/discovery.ts

- **DiscoveryDeps** (interface) `interface DiscoveryDeps { llm: LlmClient | null; voice: string; facts: () => Promise<{ label: string; text: string }[]>; truths?: () => Promise<readonly string[]>; ours?: () => Promise<readonly OurPost[]>; audience: () => Promise<Audience>; limits?: Partial<Limits>; karmaPlaces?: readonly string[]; }`
- **makeRedditReads** (function) `(deps: ReachDeps & { discovery: DiscoveryDeps }): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<DiscoveryStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<DiscoveryStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | …`
- **READS_KEY** (const) `"wren"`
- **RedditReadsObject** (type) `type RedditReadsObject = ReturnType<typeof makeRedditReads>;`

## packages/outreach/src/restate/maybe-sent.ts

- **isSendNotSent** (function) `(err: unknown): err is SendNotSent`
- **isSendTaken** (function) `(err: unknown): err is SendTaken`
- **isSendUnsure** (function) `(err: unknown): err is SendUnsure`
- **SendNotSent** (class) `readonly notSent; constructor(message: string, readonly how: "before_submit" | "verified_absent")`
- **SendTaken** (class) `readonly taken`
- **SendUnsure** (class) `readonly unsure`
- **sendAtMostOnce** (function) `(ctx: restate.Context, db: Queryable, o: AtMostOnce): Promise<Landed>`
- **sendError** (function) `(err: unknown): unknown`

## packages/outreach/src/restate/proofs.ts

- **CommentProofsService** (type) `type CommentProofsService = ReturnType<typeof makeCommentProofs>;`
- **makeCommentProofs** (function) `(deps: ProofsDeps): restate.ServiceDefinition<"CommentProofs", { check: (ctx: restate.Context, req: ProofCheck) => Promise<Proof>; }>`
- **PROOFS_SERVICE** (const) `{ readonly name: "CommentProofs"; }`
- **ProofCheck** (interface) `interface ProofCheck { item: string; round?: number; }`
- **ProofsDeps** (interface) `interface ProofsDeps { db: Db; sitesFor: (ctx: restate.Context) => SiteClient; keep?: KeepShot; notifier?: Notifier; linkedinAccount?: string; }`
- **scheduleProofs** (function) `(ctx: restate.Context, item: string): void`

## packages/outreach/src/restate/sender.ts

- **makeReachSender** (function) `(deps: ReachDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<TickStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<TickStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) => P…`
- **ReachSender** (type) `type ReachSender = ReturnType<typeof makeReachSender>;`
- **reachDelayMs** (function) `(s: TickStats, next: string | null, gapSeconds: number, now: Date): number`

## packages/outreach/src/restate/watch.ts

- **InvitesPass** (interface) `interface InvitesPass { account: string; sweep: SweepStats; topUp: TopUpStats | null; notes: { written: number; errors: string[] }; }`
- **makeReachWatch** (function) `(deps: ReachDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<WatchStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<WatchStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) =>…`
- **ReachWatchObject** (type) `type ReachWatchObject = ReturnType<typeof makeReachWatch>;`
- **ThreadsStats** (interface) `interface ThreadsStats { probed: number; read: number; kept: number; answered: number; errors: string[]; }`
- **WatchStats** (interface) `interface WatchStats { replies: RepliesStats; comments: { kept: number; errors: string[] }; threads: ThreadsStats; health: HealthStats; invites: InvitesPass | null; drafts: { written: number; errors: string[] }; posts: PostsStats[]; stopped: string | null; skipped?: number; deskOffline?: true; }`

## packages/outreach/src/schema.ts

- **PLATFORMS** (const) `readonly ["reddit", "linkedin"]`
- **Platform** (type) `type Platform = (typeof PLATFORMS)[number];`
- **DM_PLATFORMS** (const) `readonly ["reddit", "linkedin", "facebook", "instagram", "x"]`
- **DmPlatform** (type) `type DmPlatform = (typeof DM_PLATFORMS)[number];`
- **isReachPlatform** (function) `(p: string): p is Platform`
- **ACCOUNT_STATES** (const) `readonly ["warming", "active", "paused", "retired"]`
- **AccountState** (type) `type AccountState = (typeof ACCOUNT_STATES)[number];`
- **CONTACT_STATES** (const) `readonly ["new", "enrolled", "connected", "replied", "finished", "unreachable", "opted_out", "blocked"]`
- **ContactState** (type) `type ContactState = (typeof CONTACT_STATES)[number];`
- **DIRECTIONS** (const) `readonly ["out", "in"]`
- **Direction** (type) `type Direction = (typeof DIRECTIONS)[number];`
- **MESSAGE_KINDS** (const) `readonly ["connect", "sequence", "manual", "inbound", "follow_up"]`
- **MessageKind** (type) `type MessageKind = (typeof MESSAGE_KINDS)[number];`
- **MESSAGE_STATES** (const) `readonly ["proposed", "queued", "sending", "sent", "failed", "unknown", "skipped", "received"]`
- **MessageState** (type) `type MessageState = (typeof MESSAGE_STATES)[number];`
- **reachAccounts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reach_accounts"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "reach_accounts"; dataType: "string"; columnType: "PgVarchar"; data: "reddit" | "linkedin"; driverParam: string; no…`
- **draftAccounts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "draft_accounts"; schema: undefined; columns: { item: import("drizzle-orm/pg-core").PgColumn<{ name: "item"; tableName: "draft_accounts"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault…`
- **DraftAccount** (type) `type DraftAccount = typeof draftAccounts.$inferSelect;`
- **InviteFit** (interface) `interface InviteFit { why: string; title: string | null; company: string | null; employees: number | null; size: string | null; engaged: string | null; }`
- **reachContacts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reach_contacts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reach_contacts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **reachMessages** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reach_messages"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reach_messages"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **COMMENT_KINDS** (const) `readonly ["post_reply", "comment_reply", "username_mention", "review", "thread_reply"]`
- **CommentKind** (type) `type CommentKind = (typeof COMMENT_KINDS)[number];`
- **COMMENT_SORTS** (const) `readonly ["asked", "question", "chat", "hostile", "ours", "noise"]`
- **CommentSort** (type) `type CommentSort = (typeof COMMENT_SORTS)[number];`
- **COMMENT_STATES** (const) `readonly ["new", "waiting", "answered", "dropped"]`
- **CommentState** (type) `type CommentState = (typeof COMMENT_STATES)[number];`
- **COMMENT_CHANNELS** (const) `readonly ["reach", "content"]`
- **CommentChannel** (type) `type CommentChannel = (typeof COMMENT_CHANNELS)[number];`
- **comments** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "comments"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "comments"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimary…`
- **ThreadNodeRow** (interface) `interface ThreadNodeRow { ref: string; parent: string; handle: string; text: string; at: string; url: string; }`
- **commentThreads** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "comment_threads"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "comment_threads"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **CommentThread** (type) `type CommentThread = typeof commentThreads.$inferSelect;`
- **ReachAccount** (type) `type ReachAccount = typeof reachAccounts.$inferSelect;`
- **reachInvites** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"reach_invites", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reach_invites"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: f…`
- **ReachContact** (type) `type ReachContact = typeof reachContacts.$inferSelect;`
- **ReachMessage** (type) `type ReachMessage = typeof reachMessages.$inferSelect;`
- **Comment** (type) `type Comment = typeof comments.$inferSelect;`
- **PLACE_STATES** (const) `readonly ["found", "watching", "skipped"]`
- **PLACE_PURPOSES** (const) `readonly ["reach", "karma"]`
- **PlacePurpose** (type) `type PlacePurpose = (typeof PLACE_PURPOSES)[number];`
- **THREAD_STATES** (const) `readonly ["new", "dropped", "ranked", "queued", "commented", "skipped"]`
- **THREAD_KINDS** (const) `readonly ["help", "tools", "story", "venting", "hiring", "other"]`
- **Quoted** (interface) `interface Quoted { value: string; quote: string; }`
- **PersonFacts** (interface) `interface PersonFacts { ageDays: number | null; karma: number | null; places: { place: string; n: number }[]; domains: { domain: string; n: number }[]; peakHourUtc: number | null; }`
- **PersonRead** (interface) `interface PersonRead { role: Quoted | null; business: Quoted | null; size: Quoted | null; location: Quoted | null; website: Quoted | null; struggles: Quoted[]; why: string; }`
- **redditPeople** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reddit_people"; schema: undefined; columns: { handle: import("drizzle-orm/pg-core").PgColumn<{ name: "handle"; tableName: "reddit_people"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefau…`
- **PlaceJudged** (interface) `interface PlaceJudged { fit: number; why: string; rules: string; mayComment: boolean; mayPost: boolean; linkOnly: boolean; karmaMin: number | null; ageMinDays: number | null; postsADay: number; medianComments: number; }`
- **redditPlaces** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reddit_places"; schema: undefined; columns: { subreddit: import("drizzle-orm/pg-core").PgColumn<{ name: "subreddit"; tableName: "reddit_places"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; ha…`
- **redditThreads** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reddit_threads"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "reddit_threads"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; ha…`
- **REQUIREMENT_SOURCES** (const) `readonly ["removal", "rules", "manual"]`
- **RequirementSource** (type) `type RequirementSource = (typeof REQUIREMENT_SOURCES)[number];`
- **redditRequirements** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reddit_requirements"; schema: undefined; columns: { subreddit: import("drizzle-orm/pg-core").PgColumn<{ name: "subreddit"; tableName: "reddit_requirements"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNu…`
- **RedditRequirement** (type) `type RedditRequirement = typeof redditRequirements.$inferSelect;`
- **RedditPerson** (type) `type RedditPerson = typeof redditPeople.$inferSelect;`
- **RedditPlace** (type) `type RedditPlace = typeof redditPlaces.$inferSelect;`
- **RedditThread** (type) `type RedditThread = typeof redditThreads.$inferSelect;`
- **REACH_POST_STATES** (const) `readonly ["found", "queued", "commented", "skipped", "dropped"]`
- **ReachPostState** (type) `type ReachPostState = (typeof REACH_POST_STATES)[number];`
- **REACH_POST_PLATFORMS** (const) `readonly ["linkedin", "x", "instagram", "youtube", "tiktok", "threads"]`
- **ReachPostPlatform** (type) `type ReachPostPlatform = (typeof REACH_POST_PLATFORMS)[number];`
- **reachPosts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reach_posts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reach_posts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isP…`
- **ReachPost** (type) `type ReachPost = typeof reachPosts.$inferSelect;`
- **reachPasses** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "reach_passes"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "reach_passes"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **ReachPass** (type) `type ReachPass = typeof reachPasses.$inferSelect;`
- **commentProofs** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "comment_proofs"; schema: undefined; columns: { item: import("drizzle-orm/pg-core").PgColumn<{ name: "item"; tableName: "comment_proofs"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault…`
- **CommentProofRow** (type) `type CommentProofRow = typeof commentProofs.$inferSelect;`
- **SEND_ATTEMPT_STATES** (const) `readonly ["sending", "sent", "unsure"]`
- **SendAttemptState** (type) `type SendAttemptState = (typeof SEND_ATTEMPT_STATES)[number];`
- **sendAttempts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "send_attempts"; schema: undefined; columns: { item: import("drizzle-orm/pg-core").PgColumn<{ name: "item"; tableName: "send_attempts"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: …`
- **SendAttempt** (type) `type SendAttempt = typeof sendAttempts.$inferSelect;`

## packages/outreach/src/send-attempts.ts

- **claimSend** (function) `(db: Queryable, c: SendClaim): Promise<Claimed>`
- **settleSent** (function) `(db: Queryable, item: string, s: { ref: string | null; at: Date; by: string; now: Date }): Promise<void>`
- **settleUnsure** (function) `(db: Queryable, item: string, s: { why: string; now: Date }): Promise<void>`
- **releaseSend** (function) `(db: Queryable, item: string): Promise<void>`
- **forgetUnsure** (function) `(db: Queryable, item: string): Promise<void>`
- **parkUnsure** (function) `(db: Queryable, a: Omit<SendClaim, "invocation" | "again"> & { why: string; tries: number; since?: Date; sendKey?: string | null; }): Promise<void>`
- **sendAttempt** (function) `(db: Queryable, item: string): Promise<SendAttempt | null>`
- **unsureSends** (function) `(db: Queryable, now = new Date()): Promise<SendAttempt[]>`
- **sendsToRecheck** (function) `(db: Queryable, now: Date): Promise<SendAttempt[]>`
- **UNSURE_WAITS** (const) `"may have gone out. It waits in To approve, where you can open it on the site, mark it posted, or send it again"`
- **RECHECK_WHYS** (const) `string[]`
- **RECHECK_FOR_MS** (const) `number`
- **RECHECK_EVERY_MS** (const) `number`
- **KEYLESS_TRY** (const) `"an earlier try ran with no send key, so no verdict can say if it went out"`
- **SendClaim** (interface) `interface SendClaim { item: string; platform: string; account: string | null; words: string; target: string; url: string | null; invocation: string; now: Date; again?: boolean; }`
- **sendOpen** (function) `(item: ReturnType<typeof sql>): SQL<unknown>`

## packages/outreach/src/sequences.ts

- **sampleFields** (function) `(sender: string): RenderFields`
- **sequenceSlots** (function) `(seq: ReachSequence): TemplateSlot[]`
- **slotsOf** (function) `(sequences: Iterable<ReachSequence>): TemplateSlot[]`
- **checkBody** (function) `(slot: TemplateSlot, body: string): string`
- **render** (function) `(tpl: Template, fields: RenderFields, seed: string): RenderedDm`
- **firstName** (function) `(full: string | null | undefined): string | null`
- **ReachSequence** (interface) `interface ReachSequence { name: string; label: string; platform: Platform; steps: readonly ReachStep[]; connectFirst: boolean; connectWaitDays: number; }`
- **RenderFields** (interface) `interface RenderFields { first_name: string | null; company: string | null; headline: string | null; found_in: string | null; sender: string; }`
- **RenderField** (type) `type RenderField = keyof RenderFields;`
- **TemplateSlot** (interface) `interface TemplateSlot { key: string; platform: Platform; purpose: string; fields: readonly RenderField[]; maxLength: number; }`
- **MESSAGE_MAX** (const) `2000`
- **CONNECT_NOTE** (const) `"linkedin:connect-note"`
- **REACH_SEQUENCES** (const) `ReadonlyMap<string, ReachSequence>`
- **stepKey** (function) `(seq: ReachSequence, step: number): string`
- **subjectKey** (function) `(seq: ReachSequence, step: number): string`
- **dmSeed** (function) `(contactId: number): string`
- **preview** (function) `(source: string, fields: RenderFields): string`

## packages/outreach/src/settings.ts

- **policyFrom** (function) `(s: Settings): ReachPolicy`

## packages/outreach/src/settle-send.ts

- **itemOf** (function) `(item: string): { kind: SendItem; id: string }`
- **unsureItem** (function) `(db: Queryable, item: string): Promise<{ why: string | null; startedAt: Date; url: string | null; state: "sent" | "sending" | "unsure"; target: string; words: string; account: string | null; updatedAt: Date; sentAt: Date | null; item: string; ref: string | null; tries: number; platform: string; invocation: string | null; sendKey:…`
- **markPosted** (function) `(db: Queryable, item: string, o: Partial<Pick<TickOptions, "sequences" | "sender">> & { by: string; now: Date }): Promise<TickStats>`
- **requeueDm** (function) `(db: Queryable, id: number, now: Date): Promise<void>`
- **dropItem** (function) `(db: Queryable, item: string, o: { by: string; now: Date }): Promise<void>`
- **SETTLE_OUTCOMES** (const) `readonly ["posted", "again", "dropped"]`
- **SettleOutcome** (type) `type SettleOutcome = (typeof SETTLE_OUTCOMES)[number];`

## packages/outreach/src/store.ts

- **liveDms** (function) `(db: Queryable, keys: readonly string[]): Promise<Map<string, Template>>`
- **listTemplates** (function) `(db: Queryable, slots: readonly TemplateSlot[], sender: string): Promise<SlotView[]>`
- **setTemplate** (function) `(db: Queryable, opts: { slots: readonly TemplateSlot[]; sender: string }, req: SetTemplate): Promise<SlotView>`
- **dmRef** (function) `(key: string): TemplateRef`
- **SlotView** (interface) `interface SlotView extends TemplateSlot { body: string; version: string | null; updatedAt: string | null; updatedBy: string | null; preview: string; }`
- **SetTemplate** (interface) `interface SetTemplate { key: string; body?: string | null; by: string; }`

## packages/outreach/src/threads.ts

- **listThreads** (function) `(db: Queryable, f: ThreadFilter = {}): Promise<ThreadSummary[]>`
- **getThread** (function) `(db: Queryable, contactId: number): Promise<Thread>`
- **markRead** (function) `(db: Queryable, contactId: number, now: Date): Promise<void>`
- **reachStats** (function) `(db: Queryable, o: { platform?: Platform | null; days: number; now: Date }): Promise<ReachStats>`
- **ThreadFilter** (interface) `interface ThreadFilter { platform?: Platform | null; state?: ContactState | null; unread?: boolean; limit?: number; }`
- **ThreadSummary** (interface) `interface ThreadSummary { contact: ReachContact; account: string | null; last: Pick<ReachMessage, "direction" | "kind" | "body" | "state" | "sentAt" | "createdAt"> | null; unread: boolean; dms: number; }`
- **Thread** (interface) `interface Thread { contact: ReachContact; messages: ReachMessage[]; }`
- **ReachStats** (interface) `interface ReachStats { contacts: Record<string, number>; out: Record<string, number>; replies: number; days: number; }`

## packages/outreach/src/tick.ts

- **reconcile** (function) `(db: Queryable, now: Date): Promise<number>`
- **sentToday** (function) `(db: Queryable, accountIds: readonly string[], now: Date): Promise<Map<string, { connects: number; messages: number }>>`
- **notesThisMonth** (function) `(db: Queryable, accountId: string, now: Date): Promise<number>`
- **touch** (function) `(db: Queryable, contactId: number, step: number, o: Pick<TickOptions, "sequences" | "sender" | "now">): Promise<"queued" | "replied" | "ended">`
- **recordSent** (function) `(db: Queryable, c: Candidate, sent: Sent, o: Pick<TickOptions, "sequences" | "sender" | "now" | "runId">, stats: TickStats): Promise<void>`
- **limitWaitMs** (function) `(text: string): number | null`
- **tick** (function) `(db: Queryable, o: TickOptions, run: Journal = (_n, fn) => fn()): Promise<TickStats>`
- **nextDue** (function) `(db: Queryable, now: Date): Promise<string | null>`
- **queueManual** (function) `(db: Queryable, req: { contact: ReachContact; body: string; subject?: string | null; now: Date }): Promise<ReachMessage>`
- **STALE_SENDING_MS** (const) `number`
- **TickOptions** (interface) `interface TickOptions { channelFor: (a: ReachAccount) => OutreachChannel | null; policy: ReachPolicy; sequences: ReadonlyMap<string, ReachSequence>; sender: string; live: boolean; sends?: (kind: ReachMessage["kind"]) => boolean; linkSource?: string | null; now: Date; runId?: string | null; }`
- **TickStats** (interface) `interface TickStats { sent: number; connected: number; held: Record<string, number>; failed: number; noInvite: number; reconciled: number; finished: number; unreachable: number; stepped: Array<{ contactId: number; sequence: string; step: number }>; }`
- **Candidate** (interface) `interface Candidate { row: ReachMessage; contact: ReachContact; account: ReachAccount; checkRelationship: boolean; person?: string; }`
- **emptyStats** (function) `(): TickStats`
- **LIMIT_HOLD_MS** (const) `number`
- **Journal** (type) `type Journal = <T>(name: string, fn: () => Promise<T>) => Promise<T>;`

## packages/outreach/src/touches.ts

- **keepTouch** (function) `(what: string, write: () => Promise<T>): Promise<T | null>`
- **touchFromMessage** (function) `(db: Queryable, messageId: number): Promise<{ id: number; handleId: number; created: boolean; linked: boolean; } | null>`
- **touchInvites** (function) `(db: Queryable, contactIds: readonly number[], response: TouchResponse, at: Date): Promise<number>`
- **touchFromComment** (function) `(db: Queryable, id: number): Promise<{ id: number; handleId: number; created: boolean; linked: boolean; } | null>`
- **touchFromAnswer** (function) `(db: Queryable, id: number): Promise<{ id: number; handleId: number; created: boolean; linked: boolean; } | null>`
- **touchFromThread** (function) `(db: Queryable, id: string): Promise<{ id: number; handleId: number; created: boolean; linked: boolean; } | null>`
- **touchesFromReachPost** (function) `(db: Queryable, id: number): Promise<{ created: boolean; linked: boolean; } | null>`
- **backfillOutreachTouches** (function) `(db: Queryable, o: { dryRun?: boolean; now?: Date } = {}): Promise<TouchBackfill>`
- **TouchBackfill** (interface) `interface TouchBackfill { messages: number; comments: number; answers: number; threads: number; posts: number; responses: number; links: number; }`
