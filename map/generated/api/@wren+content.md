# @wren/content: interface

Exports: 632. Files: 88.

## packages/content/src/analytics/catalog.ts

- **CADENCE_GOALS** (const) `readonly CadenceGoal[]`
- **CadenceGoal** (interface) `interface CadenceGoal { id: string; platform: GoalPlace; label: string; name: string; goal: number; upTo?: number; daily: number | null; pace: string; how: string; piece: string; starts: "words" | "video" | "thread"; counts: readonly Format[] | "any" | "thread_comment" | null; }`
- **PIECE_NAMES** (const) `Readonly<Record<string, string>>`

## packages/content/src/analytics/goals.ts

- **cadenceGoals** (function) `(db: Queryable): Promise<readonly CadenceGoal[]>`
- **GOALS_COMPONENT** (const) `"marketing.cadence"`
- **goalsSchema** (const) `z.ZodObject<{ goals: z.ZodArray<z.ZodObject<{ id: z.ZodString; platform: z.ZodString; label: z.ZodString; name: z.ZodString; goal: z.ZodNumber; upTo: z.ZodOptional<z.ZodNumber>; daily: z.ZodNullable<z.ZodNumber>; pace: z.ZodString; how: z.ZodString; piece: z.ZodString; starts: z.ZodEnum<{ words: "wo…`

## packages/content/src/analytics/records.ts

- **ANALYTICS_RECORDS** (const) `import("@wren/core/records").RecordType[]`

## packages/content/src/analytics/variants.ts

- **askSwap** (function) `(db: Queryable, a: { draftId: string; field: VariantField; value: string; why?: string | null; by: string }, now: Date): Promise<PostVariant>`
- **SWAPS** (const) `Partial<Record<Platform, readonly VariantField[]>>`
- **VariantWindow** (interface) `interface VariantWindow { id: number; field: VariantField; value: string; state: PostVariant["state"]; source: PostVariant["source"]; started: string | null; ended: string | null; from: string | null; to: string | null; days: number; views: number | null; viewsPerDay: number | null; impressions: number | null; ctr: number | null; }`
- **variantWindows** (function) `(db: Queryable, draftId: string, today: Date): Promise<VariantWindow[]>`
- **WaitingSwap** (interface) `interface WaitingSwap { id: number; draftId: string; platform: Platform; title: string | null; field: VariantField; value: string; live: string | null; why: string | null; by: string; at: Date; url: string | null; }`
- **waitingSwaps** (function) `(db: Queryable): Promise<WaitingSwap[]>`

## packages/content/src/attach.ts

- **attachmentOf** (function) `(platform: ContentDraft["platform"], field: string, name: string, bytes: Uint8Array): string`
- **attachFile** (function) `(db: Queryable, store: MediaStoreOptions, req: { draftId: string; field: string; name: string; data: string }, who: { by: string }): Promise<ContentDraft>`
- **ATTACH_MAX_BYTES** (const) `number`

## packages/content/src/blog.ts

- **slugOf** (function) `(title: string): string`
- **blogProblem** (function) `(p: Pick<BlogPost, "slug" | "title" | "description" | "body">): "the address can't be used" | "it needs a title" | "the title is over 120 characters" | "it needs a one-line description" | "the description is over 300 characters" | "it has no words yet" | null`
- **blogFile** (function) `(p: BlogPost): string`
- **blogRows** (function) `(db: Queryable, limit = 30): Promise<BlogRow[]>`
- **blogRow** (function) `(db: Queryable, slug: string): Promise<BlogRow | null>`
- **keepBlogRow** (function) `(db: Queryable, p: BlogPost, o: { commit: string | null; by: string; now: Date; from?: string | null; }): Promise<BlogRow>`
- **markEmailed** (function) `(db: Queryable, slug: string, at: Date): Promise<void>`
- **BLOG_DIR** (const) `"src/content/blog"`
- **BlogPost** (interface) `interface BlogPost { slug: string; title: string; description: string; body: string; date: string; draft: boolean; }`
- **BlogRow** (type) `type BlogRow = typeof blogPosts.$inferSelect;`

## packages/content/src/carousel.ts

- **saveSlides** (function) `(db: Queryable, id: string, slides: unknown, who?: { by: string; via?: DraftVia }): Promise<ContentDraft[]>`
- **slidesToDraw** (function) `(db: Queryable, id: string, by?: string): Promise<{ slides: Slide[]; html: string }>`
- **paintSlides** (function) `(slides: readonly Slide[], html: string, paint: SlidePainter, store: MediaStoreOptions): Promise<SlideFiles>`
- **keepSlideFiles** (function) `(db: Queryable, id: string, files: SlideFiles): Promise<ContentDraft[]>`
- **renderSlides** (function) `(db: Queryable, id: string, paint: SlidePainter, store: MediaStoreOptions, o: { by?: string } = {}): Promise<SlideFiles>`
- **writeCarousel** (function) `(db: Queryable, o: { slides: unknown; text: string; platforms: readonly CarouselPlatform[]; by: string | null; }): Promise<{ ideaId: string; results: DraftResult[] }>`
- **SlidePainter** (type) `type SlidePainter = (html: string, count: number) => Promise<SlidePaint>;`
- **CAROUSEL_PLATFORMS** (const) `readonly ["instagram", "linkedin"]`
- **CarouselPlatform** (type) `type CarouselPlatform = (typeof CAROUSEL_PLATFORMS)[number];`

## packages/content/src/check.ts

- **judgePrompt** (function) `(text: string, check: PieceCheck, own: SopCall[], playbook: Pick<ContentPlaybook, "text"> | null): string`
- **checkDraft** (function) `(db: Queryable, llm: LlmClient, draftId: string, o: { tracer?: Tracer; runId?: string; now?: Date } = {}): Promise<DraftCheck | null>`
- **RuleVerdict** (type) `type RuleVerdict = "meets" | "breaks" | "n/a";`
- **DraftCheck** (interface) `interface DraftCheck extends PieceCheck { version: string; at: string; sop: string | null; hook: string | null; rules: { call: SopCall["call"]; say: string; cite: string; verdict: RuleVerdict }[]; changes: string[]; why: string | null; }`

## packages/content/src/client-reports/tiles.ts

- **changeOf** (function) `(l: Pick<ReportLine, "value" | "prior">): string | null`
- **shown** (function) `(l: Pick<ReportLine, "value" | "currency">, locale = "en-US"): string`
- **REPORT_TILES** (const) `readonly [{ readonly id: "views"; readonly label: "Content views"; readonly record: "marketing.post"; readonly sum: "views"; readonly view: "all"; }, { readonly id: "post_visits"; readonly label: "Site visitors from posts"; readonly record: "marketing.link_day"; readonly sum: "clicks"; readonly view…`
- **ReportTileId** (type) `type ReportTileId = ReportTile["id"];`
- **REPORT_TILE_IDS** (const) `["visits" | "forms" | "bookings" | "calls" | "paid" | "views" | "spend" | "post_visits" | "ad_impressions" | "search_impressions", ...("visits" | "forms" | "bookings" | "calls" | "paid" | "views" | "spend" | "post_visits" | "ad_impressions" | "search_impressions")[]]`
- **REPORT_EVERY** (const) `readonly ["week", "month"]`
- **ReportEvery** (type) `type ReportEvery = (typeof REPORT_EVERY)[number];`
- **EVERY_NAMES** (const) `Record<ReportEvery, string>`
- **REPORT_HOUR** (const) `9`
- **MAX_RECIPIENTS** (const) `10`
- **MAX_REPORTS** (const) `20`
- **ReportLine** (interface) `interface ReportLine { tile: ReportTileId; label: string; value: number | null; prior: number | null; currency: string | null; error?: string; }`

## packages/content/src/clients.ts

- **clientContent** (function) `(main: Queryable, id: string, part: string): Promise<ClientContent>`
- **clientPlan** (function) `(client: Client): | { ok: true; settings: ClientPlannerSettings; brand: Brand; voice: string } | { ok: false; why: string }`
- **CLIENT_VOICE** (const) `"Plain and concise. Short sentences a person would say out loud.\nConcrete over abstract: what was done, for whom, what changed, with numbers where there are any.\nNo hype, no jargon, no emoji, no hashtags, no exclamation marks, no calls to follow or like."`

## packages/content/src/components.ts

- **POSTS_UNIT** (const) `"posts"`
- **SOCIAL_UNIT** (const) `"social"`
- **clientPlannerSchema** (const) `z.ZodObject<{ about: z.ZodOptional<z.ZodString>; voice: z.ZodOptional<z.ZodString>; platforms: z.ZodOptional<z.ZodArray<z.ZodEnum<{ reddit: "reddit"; linkedin: "linkedin"; }>>>; draft: z.ZodDefault<z.ZodBoolean>; }, z.core.$strip>`
- **ClientPlannerSettings** (type) `type ClientPlannerSettings = z.infer<typeof clientPlannerSchema>;`
- **CONTENT_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **CONTENT_WORKFLOWS** (const) `import("@wren/core/workflows").Workflow[]`

## packages/content/src/connect/access.ts

- **tokenName** (function) `(platform: SocialPlatform, externalId: string): string`
- **platformStates** (function) `(conns: readonly SocialConnectionRow[], o: { apps: SocialApps; live: ReadonlySet<SocialPlatform>; ready: boolean; now: Date }): PlatformView[]`
- **socialAccess** (function) `(deps: SocialDeps): { connection: (id: number) => Promise<{ id: number; client: string; platform: "linkedin" | "youtube" | "linkedin_page" | "x" | "tiktok" | "instagram" | "google_business" | "facebook"; accountId: number; externalId: string; name: string | null; handle: string | null; scopes: string; tokenRef: string;…`
- **liveConnections** (function) `(main: Queryable, client: string): Promise<SocialConnectionRow[]>`
- **socialAppsFrom** (function) `(keys: KeyStore | null, env: Record<string, string | undefined> = {}): () => Promise<SocialApps>`
- **SOCIAL_FACT** (const) `"social.connected"`
- **callbackUrl** (function) `(origin: string, platform: SocialPlatform): string`
- **loginOf** (function) `(id: number): string`
- **connectionIdOf** (function) `(login: string | null | undefined): number | null`
- **PlatformView** (interface) `interface PlatformView { platform: SocialPlatform; label: string; state: SocialStateName; blocking: string | null; today: string | null; selfServe: string; forYou: string; dms: boolean; comments: boolean; connections: ConnectionView[]; may: { connect: boolean }; }`
- **SocialAccessApi** (type) `type SocialAccessApi = ReturnType<typeof socialAccess>;`

## packages/content/src/connect/app-reviews.ts

- **checkReview** (function) `(r: Review, deps: CheckDeps): Promise<Check[]>`
- **packetOf** (function) `(r: Review, checks: readonly Check[] | null, state: string | null = null): string`
- **SITE** (const) `"https://wrenautomation.com"`
- **PORTAL** (const) `"https://app.wrenautomation.com"`
- **PRIVACY** (const) `"https://wrenautomation.com/privacy"`
- **TERMS** (const) `"https://wrenautomation.com/terms"`
- **DELETION** (const) `"https://wrenautomation.com/data-deletion"`
- **ICON** (const) `"deploy/reviews/app-icon-1024.png"`
- **callbackOf** (function) `(p: SocialPlatform): string`
- **Need** (type) `type Need = | { kind: "page"; url: string; has: readonly string[]; why: string } | { kind: "callback"; url: string } | { kind: "key"; name: string } | { kind: "icon" };`
- **Review** (interface) `interface Review { id: string; name: string; app: SocialApp | "meta-business" | "whatsapp" | "mail-google" | "mail-microsoft" | "reddit"; unlocks: readonly SocialPlatform[]; where: string; after: readonly string[]; needs: readonly Need[]; fields: readonly (readonly [string, string])[]; scopes: readonly (readonly [string, string])[]; video: readonly string[]; open: readonly string[]; }`
- **REVIEWS** (const) `readonly Review[]`
- **reviewOf** (function) `(id: string): Review | null`
- **Check** (interface) `interface Check { need: string; ok: boolean; detail: string; }`
- **CheckDeps** (interface) `interface CheckDeps { fetch: (url: string) => Promise<{ status: number; text: () => Promise<string> }>; hasKey: (name: string) => boolean | null; icon: () => Promise<Uint8Array | null>; }`

## packages/content/src/connect/business.ts

- **reviewText** (function) `(r: Pick<Review, "starRating" | "comment">): string`
- **businessProfileContent** (function) `(sites: SiteClient, o: BusinessProfileOptions): ContentChannel`

## packages/content/src/connect/console-routes.ts

- **SOCIAL_ACCESS_ROUTES** (const) `{ readonly social: "read"; readonly connect: "act"; readonly check: "act"; readonly disconnect: "act"; readonly ownCheck: "act"; }`
- **SOCIAL_ACCESS_APPS** (const) `{ readonly "*": "account"; }`
- **SOCIAL_ACCESS_WRITES** (const) `readonly (keyof typeof SOCIAL_ACCESS_ROUTES)[]`

## packages/content/src/connect/console.ts

- **socialConsoleApi** (function) `(deps: SocialConsoleDeps): { social(req: PortalRequest): Promise<{ owner: { id: null; name: string; }; wren: true; mayAct: boolean; own: OwnView | null; } | { platforms: import("./access.js").PlatformView[]; apps: Record<import("./platforms.js").SocialApp, boolean>; owner: { id: string; name: string; }; wren: false; mayAct: b…`
- **makeSocialAccess** (function) `(deps: SocialConsoleDeps): restate.ServiceDefinition<"SocialAccess", { social: (_: restate.Context, req: PortalRequest) => Promise<{ owner: { id: null; name: string; }; wren: true; mayAct: boolean; own: OwnView | null; } | { platforms: import("./access.js").PlatformView[]; apps: Record<import("./platforms.js").SocialApp, bool…`
- **makeSocialCallback** (function) `(deps: SocialConsoleDeps): restate.ServiceDefinition<"SocialCallback", { land: (ctx: restate.Context, q: z.infer<typeof SOCIAL_LANDING>) => Promise<{ ok: boolean; said: string; }>; }>`
- **SocialPageView** (type) `type SocialPageView = Awaited<ReturnType<ReturnType<typeof socialConsoleApi>["social"]>>;`

## packages/content/src/connect/dms.ts

- **readDms** (function) `(sites: SiteClient, c: DmAccount): Promise<DmThread[]>`
- **keepDms** (function) `(db: Queryable, c: DmAccount, threads: readonly DmThread[]): Promise<{ threads: number; messages: number }>`
- **planDm** (function) `(db: Queryable, o: { contactId: number; body: string; now: Date; live: (id: number) => Promise<boolean> }): Promise<DmPlan>`
- **sendDm** (function) `(sites: SiteClient, plan: DmPlan, pageId: string | null): Promise<{ ref: string | null }>`
- **sentDm** (function) `(db: Queryable, plan: DmPlan, o: { ref: string | null; now: Date; by: string }): Promise<void>`
- **unknownDm** (function) `(db: Queryable, messageId: number, why: string): Promise<void>`
- **dropDm** (function) `(db: Queryable, messageId: number, why: string): Promise<void>`
- **dmPlanOf** (function) `(db: Queryable, messageId: number): Promise<DmPlan>`
- **failedDm** (function) `(db: Queryable, messageId: number, why: string): Promise<void>`
- **isDmSocial** (function) `(p: string): p is DmSocial`
- **DmAccount** (type) `type DmAccount = Pick< SocialConnectionRow, "id" | "platform" | "externalId" | "handle" | "name" | "extra" >;`
- **profileOf** (function) `(c: ReachContact): DmProfile | null`
- **DmPlan** (interface) `interface DmPlan { contactId: number; platform: DmSocial; connection: number; to: string; handle: string; url: string | null; body: string; messageId: number; }`

## packages/content/src/connect/oauth.ts

- **whoAmI** (function) `(fetch: FetchLike, platform: SocialPlatform, access: string, extra: SocialExtra): Promise<{ externalId: string; name: string | null; handle: string | null; extra?: import("@wrenautomation/autobrowse/oauth").SocialExtra; }>`
- **connectUrl** (function) `(platform: SocialPlatform, app: SocialAppKeys, o: { redirect: string; state: string; verifier: string | null }): string`
- **landCode** (function) `(fetch: FetchLike, platform: SocialPlatform, app: SocialAppKeys, o: { code: string; redirect: string; verifier: string | null; now: Date }): Promise<Landed>`
- **refreshToken** (function) `(fetch: FetchLike, platform: SocialPlatform, app: SocialAppKeys, kept: StoredToken, now: Date): Promise<{ access: string; expiresIn: number; stored: StoredToken | null }>`
- **SocialAppKeys** (interface) `interface SocialAppKeys { id: string; secret: string; }`
- **StoredToken** (type) `type StoredToken = | { kind: "refresh"; refresh: string } | { kind: "access"; access: string; expiresAt: string } | { kind: "page"; page: string };`
- **Landed** (interface) `interface Landed { externalId: string; name: string | null; handle: string | null; scopes: string[]; stored: StoredToken; access: string; accessFor: number; expiresAt: Date | null; extra: SocialExtra; }`

## packages/content/src/connect/own.ts

- **ownSwitchesOf** (function) `(s: OwnSettings): OwnSwitches`
- **ownChannels** (function) `(s: OwnSwitches): OwnChannel[]`
- **scrub** (function) `(text: string): string`
- **plainFailure** (function) `(text: string | null | undefined): string`
- **handleOf** (function) `(raw: unknown, depth = 0): string | null`
- **handleFromUrl** (function) `(url: string | null | undefined): string | null`
- **readOwnRows** (function) `(db: Queryable, platforms: readonly Platform[]): Promise<OwnRows>`
- **renewalLine** (function) `(line: string): { site: string; ok: boolean | null; lapses: string | null; why: string | null } | null`
- **ownView** (function) `(channels: readonly OwnChannel[], rows: OwnRows, every: readonly Platform[]): OwnView`
- **checkOwn** (function) `(sites: OwnSites, c: OwnChannel): Promise<OwnCheck>`
- **restateOwnSites** (function) `(ctx: restate.Context, box: SitesHost): OwnSites`
- **OwnSwitches** (interface) `interface OwnSwitches { channels: readonly Platform[]; tiktokPostVia: "web" | "api"; instagramGraph: boolean; redditApi: boolean; box: boolean; }`
- **OwnRows** (interface) `interface OwnRows { posts: Array<{ platform: string; at: Date | null; url: string | null }>; failures: Array<{ platform: string | null; at: Date; kind: string; note: string | null }>; days: Array<{ platform: string; raw: unknown }>; renewals: Array<{ at: Date; finishedAt: Date | null; stats: unknown }>; }`
- **OwnView** (interface) `interface OwnView { channels: OwnChannelView[]; off: string[]; renewal: { at: string; ok: boolean; why: string | null; next: string | null } | null; }`
- **OwnSites** (interface) `interface OwnSites { status(where: OwnWhere, site: string): Promise<OwnSiteRow>; read( where: OwnWhere, site: string, path: string, input: Record<string, unknown>, account: string | null, ): Promise<unknown>; renewDry(where: OwnWhere): Promise<OwnRenewDry | null>; now(): Promise<number>; }`
- **OwnCheck** (interface) `interface OwnCheck { platform: Platform; at: string; ok: boolean | null; said: string; ms: number | null; authed: boolean | null; routes: { api: number; browser: number; none: number } | null; lapses: string | null; handle: string | null; }`

## packages/content/src/connect/platforms.ts

- **liveFrom** (function) `(list: string | null | undefined): ReadonlySet<SocialPlatform>`
- **SOCIAL_PLATFORMS** (const) `readonly ["facebook", "instagram", "linkedin", "linkedin_page", "youtube", "x", "tiktok", "google_business"]`
- **SocialPlatform** (type) `type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];`
- **SOCIAL_APPS** (const) `readonly ["meta", "linkedin", "linkedin_pages", "google", "x", "tiktok"]`
- **SocialApp** (type) `type SocialApp = (typeof SOCIAL_APPS)[number];`
- **APP_NAMES** (const) `Record<SocialApp, string>`
- **appKey** (function) `(app: SocialApp, part: "ID" | "SECRET"): string`
- **SOCIAL** (const) `Record<SocialPlatform, SocialSpec>`
- **channelOf** (function) `(p: SocialPlatform): SocialChannel`

## packages/content/src/connect/review-log.ts

- **stateAfter** (function) `(state: ReviewState, event: ReviewEvent): ReviewState`
- **logReview** (function) `(db: Db, s: ReviewStep): Promise<AccessReviewRow>`
- **listReviews** (function) `(db: Db, client?: string): Promise<ReviewView[]>`
- **reviewHistory** (function) `(db: Db, client: string, kind: string): Promise<{ review: AccessReviewRow; events: AccessReviewEventRow[] } | null>`
- **RECHECK_DAYS** (const) `7`
- **ReviewView** (interface) `interface ReviewView extends AccessReviewRow { title: string; last: AccessReviewEventRow | null; }`

## packages/content/src/connect/reviews-schema.ts

- **REVIEW_STATES** (const) `readonly ["draft", "filed", "more_info", "refused", "passed", "withdrawn"]`
- **ReviewState** (type) `type ReviewState = (typeof REVIEW_STATES)[number];`
- **REVIEW_EVENTS** (const) `readonly ["filed", "more_info", "answered", "refused", "passed", "withdrawn", "note", "checked"]`
- **ReviewEvent** (type) `type ReviewEvent = (typeof REVIEW_EVENTS)[number];`
- **accessReviews** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "access_reviews"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "access_reviews"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`
- **AccessReviewRow** (type) `type AccessReviewRow = typeof accessReviews.$inferSelect;`
- **accessReviewEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "access_review_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "access_review_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; has…`
- **AccessReviewEventRow** (type) `type AccessReviewEventRow = typeof accessReviewEvents.$inferSelect;`

## packages/content/src/connect/schema.ts

- **SOCIAL_STATES** (const) `readonly ["connected", "broken"]`
- **SocialState** (type) `type SocialState = (typeof SOCIAL_STATES)[number];`
- **socialGrants** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_grants"; schema: undefined; columns: { state: import("drizzle-orm/pg-core").PgColumn<{ name: "state"; tableName: "social_grants"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault…`
- **SocialGrantRow** (type) `type SocialGrantRow = typeof socialGrants.$inferSelect;`
- **SocialExtra** (interface) `interface SocialExtra { pageId?: string; pageName?: string; igUserId?: string; orgUrn?: string; location?: string; avatarUrl?: string; }`
- **socialConnections** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_connections"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "social_connections"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefa…`
- **SocialConnectionRow** (type) `type SocialConnectionRow = typeof socialConnections.$inferSelect;`

## packages/content/src/connect/setups.ts

- **socialChecks** (function) `(o: { main: Queryable; access: SocialAccessApi; }): Record<string, SetupCheck>`
- **SOCIAL_SETUP** (const) `import("@wren/core/setup").Setup`
- **SOCIAL_SETUPS** (const) `import("@wren/core/setup").Setup[]`

## packages/content/src/connect/sites.ts

- **socialSites** (function) `(deps: SocialSitesDeps): SiteClient`
- **TIKTOK_CHUNK** (const) `number`
- **X_CHUNK** (const) `number`

## packages/content/src/connect/tiktok-numbers.ts

- **videoLine** (function) `(v: Json): TikTokVideoLine`
- **tiktokNumbers** (function) `(sites: SiteClient, c: Pick<SocialConnectionRow, "id" | "scopes">, o: { now: Date; ms?: number } = { now: new Date() }): Promise<TikTokNumbers>`
- **TIKTOK_RECENT** (const) `5`
- **TikTokNumbers** (interface) `interface TikTokNumbers { followers: number | null; likes: number | null; videos: number | null; recent: TikTokVideoLine[]; gaps: string[]; asOf: string; }`

## packages/content/src/costs.ts

- **draftCosts** (function) `(db: Queryable, now: Date, days = 30): Promise<CostRow[]>`
- **formatCosts** (function) `(rows: readonly CostRow[]): string[]`

## packages/content/src/draft-ask.ts

- **itemOf** (function) `(item: string): { record: string; id: string; kind: DraftKind }`
- **readDraft** (function) `(db: Queryable, item: string): Promise<{ edits: string; examples: string; what: string; platform?: string; title: string; draft: string | null; max: number; open: boolean; context: string; guide: string; about?: string; }>`
- **listWaiting** (function) `(db: Queryable, o: { type?: DraftType; limit?: number } = {}): Promise<Waiting[]>`
- **writeDraft** (function) `(db: Queryable, item: string, text: string | null, o: { command: DraftCommand; by: string; expect?: string | null; argv?: object; run?: string; stats?: object; ask?: string; llm?: Record<string, unknown>; }): Promise<{ run: string; before: string | null; turn: import("@wren/core/ask").DraftTurn | null; version: string | null; }>`
- **undoDraft** (function) `(db: Queryable, item: string, by: string): Promise<{ run: string; before: string | null; turn: import("@wren/core/ask").DraftTurn | null; version: string | null; }>`
- **askPrompt** (function) `(d: DraftItem, ask: { by: string; message: string }, prompt: Pick<LiveTemplate, "template"> = { template: draftAskDefault() }): { question: string; system: string } | { error: string }`
- **DRAFT_TYPES** (const) `readonly ["post", "comment", "thread", "dm", "invite", "onpost"]`
- **DraftType** (type) `type DraftType = (typeof DRAFT_TYPES)[number];`
- **DraftItem** (interface) `interface DraftItem { what: string; platform?: string; title: string; draft: string | null; max: number; open: boolean; context: string; guide: string; edits?: string; about?: string; examples?: string; }`
- **Waiting** (interface) `interface Waiting { item: string; type: DraftType; title: string; draft: string | null; at: Date; }`
- **listEdits** (function) `(db: Queryable, o: { type?: DraftType; limit?: number } = {}): Promise<import("@wren/core/ask").DraftEdit[]>`
- **ASK_MESSAGE_MAX** (const) `2000`
- **DRAFT_ASK_REF** (const) `{ readonly system: "content"; readonly name: "draft-ask"; }`
- **draftAskDefault** (function) `(): import("@wren/core/slots").Template`

## packages/content/src/draft-calls.ts

- **DRAFT_CALLS** (const) `{ readonly "ContentDesk/approve": "ids"; readonly "ContentDesk/reject": "ids"; readonly "ContentDesk/redraft": "draftId"; readonly "ContentDesk/check": "draftId"; readonly "ContentDesk/fields": "draftId"; readonly "ContentDesk/funnel": "draftId"; readonly "ContentDesk/attach": "draftId"; readonly "D…`

## packages/content/src/draft.ts

- **draftPrompt** (function) `(idea: Pick<ContentIdea, "text" | "media">, spec: PlatformSpec, o: { voice: string; brand: Brand; lessons?: Lessons; playbook?: Pick<ContentPlaybook, "text"> | null; standard?: KindStandard | null; facts?: readonly string[]; }): string`
- **redraftPrompt** (function) `(idea: Pick<ContentIdea, "text" | "media">, spec: PlatformSpec, previous: { text: string; title: string | null }, note: string, o: { voice: string; brand: Brand; lessons?: Lessons; playbook?: Pick<ContentPlaybook, "text"> | null; standard?: KindStandard | null; facts?: readonly string[]; }): string`
- **askGuarded** (function) `(db: Queryable, llm: LlmClient, prompt: string, own: readonly string[], o: Pick<DraftOptions, "runId" | "tracer" | "facts"> & { item: string; metadata: Record<string, unknown>; }): Promise<{ outcome: Outcome<Proposal>; why: string | null }>`
- **keepGenerated** (function) `(db: Queryable, llm: LlmClient, d: ContentDraft, outcome: Outcome<unknown>, o: { ask?: string; by: string | null | undefined }): Promise<void>`
- **unfitProposal** (function) `(spec: PlatformSpec, p: Proposal): string | null`
- **redraft** (function) `(db: Queryable, llm: LlmClient, previous: ContentDraft, idea: Pick<ContentIdea, "text" | "media">, note: string, o: Omit<DraftOptions, "again"> = {}): Promise<DraftResult>`
- **draftIdea** (function) `(db: Queryable, llm: LlmClient, idea: ContentIdea, platforms: readonly Platform[], o: DraftOptions = {}): Promise<DraftResult[]>`
- **DRAFT_STAGE** (const) `"content_draft"`
- **Proposal** (type) `type Proposal = z.infer<typeof proposal>;`
- **DraftOptions** (interface) `interface DraftOptions { by?: string | null; voice?: string; brand?: Brand; tracer?: Tracer | null; runId?: string | null; again?: boolean; facts?: readonly string[]; }`
- **DraftResult** (type) `type DraftResult = | { platform: Platform; ok: true; draft: ContentDraft } | { platform: Platform; ok: false; reason: string };`

## packages/content/src/film-check.ts

- **cutTimeline** (function) `(e: Pick<VideoEdit, "cuts" | "tracks">): { durationS: number; cuts: number[]; }`
- **filmCheck** (function) `(db: Queryable, e: Pick<VideoEdit, "cuts" | "tracks" | "words">): Promise<FilmCheck | null>`
- **FILM_MAX_S** (const) `180`
- **FilmCheck** (type) `type FilmCheck = PieceCheck & { sop: string | null };`

## packages/content/src/funnel.ts

- **youtubeId** (function) `(url: string): string | null`
- **targetLink** (function) `(d: FunnelRow, video: FunnelVideo | null, client = false, page: FunnelPage | null = null): string | null`
- **linkRule** (function) `(d: Pick<FunnelRow, "platform" | "extra" | "pointsTo">, place: FunnelContext["place"]): { allowed: boolean; on: boolean; why: string | null }`
- **funnelOf** (function) `(d: FunnelRow, ctx: FunnelContext): FunnelView`
- **pickablePages** (function) `(db: Queryable): Promise<FunnelPage[]>`
- **readFunnel** (function) `(db: Queryable, d: FunnelRow): Promise<FunnelView>`
- **postedLink** (function) `(db: Queryable, d: FunnelRow): Promise<string | null>`
- **postedLinks** (function) `(db: Queryable, d: FunnelRow): Promise<{ text: string | null; comment: string | null }>`
- **setFunnel** (function) `(db: Queryable, id: string, patch: FunnelPatch, who?: { by: string }): Promise<ContentDraft>`
- **refuseUnlinked** (function) `(db: Queryable, rows: readonly FunnelRow[]): Promise<void>`
- **WREN_SITE** (const) `"https://wrenautomation.com"`
- **FunnelVideo** (interface) `interface FunnelVideo { id: string; title: string | null; url: string | null; status: DraftStatus; }`
- **FunnelPage** (interface) `interface FunnelPage { id: string; title: string; slug: string; live: boolean; }`
- **FunnelContext** (interface) `interface FunnelContext { video: FunnelVideo | null; page?: FunnelPage | null; place: { name: string; links: boolean } | null; client: boolean; }`
- **FunnelView** (interface) `interface FunnelView { stage: FunnelStage; to: FunnelTarget; video: FunnelVideo | null; page: FunnelPage | null; linked: boolean; chosen: boolean; allowed: boolean; link: string | null; posts: string | null; comment: string | null; note: string | null; }`
- **FunnelPatch** (interface) `interface FunnelPatch { stage?: FunnelStage; to?: FunnelTarget; video?: string | null; page?: string | null; linked?: boolean | null; }`
- **funnelLine** (function) `(f: Pick<FunnelView, "stage" | "to" | "posts" | "comment" | "note">): string`

## packages/content/src/ideas.ts

- **addIdea** (function) `(db: Queryable, text: string, source: IdeaSource, media: Media | null = null, ref: string | null = null, mark: IdeaMark = {}): Promise<ContentIdea>`
- **addIdeaOnce** (function) `(db: Queryable, text: string, source: IdeaSource, ref: string): Promise<ContentIdea | null>`
- **listIdeas** (function) `(db: Queryable, status: IdeaStatus, limit = 50): Promise<ContentIdea[]>`
- **getIdea** (function) `(db: Queryable, id: string): Promise<ContentIdea>`
- **IdeaMark** (interface) `interface IdeaMark { line?: string | null; angle?: IdeaAngle | null; }`

## packages/content/src/inbox/conversation.ts

- **threadChannelOf** (function) `(db: Queryable, thread: string): Promise<string | null>`
- **partyOf** (function) `(db: Queryable, thread: string): Promise<Party | null>`
- **timelineOf** (function) `(db: Queryable, p: Party): Promise<Entry[]>`
- **optionsOf** (function) `(db: Queryable, p: Party): Promise<ReplyOption[]>`
- **conversationOf** (function) `(db: Queryable, thread: string): Promise<{ thread: string; who: string | null; personId: number | null; entries: Entry[]; options: ReplyOption[]; } | null>`
- **Entry** (interface) `interface Entry { id: string; at: string; channel: EntryChannel; direction: "in" | "out" | "note"; platform: string | null; who: string | null; body: string; subject?: string | null; state?: string | null; mentions?: string[]; start?: string; }`
- **ReplyOption** (interface) `interface ReplyOption { channel: InboxChannel; target: string; label: string; platform: string | null; own: boolean; off: string | null; fix?: "social" | "mail" | null; from?: string | null; copy?: string | null; }`
- **Conversation** (type) `type Conversation = NonNullable<Awaited<ReturnType<typeof conversationOf>>>;`

## packages/content/src/inbox/mail-reply.ts

- **planMailReply** (function) `(db: Queryable, o: { mailId: number; body: string; ours: (mailbox: string) => string; by: string }): Promise<MailPlan>`
- **sentMailReply** (function) `(db: Queryable, id: number, o: { providerId: string | null; now: Date }): Promise<void>`
- **failedMailReply** (function) `(db: Queryable, id: number, why: string): Promise<void>`
- **MailPlan** (interface) `interface MailPlan { sentId: number; mailbox: string; to: ReplyTo; ours: string; }`
- **MailReplyRefusal** (class) `override name`

## packages/content/src/inbox/routes.ts

- **clientRoute** (function) `(channel: InboxChannel, platform: string | null, accounts: readonly AccountState[]): Shut | null`
- **mailRoute** (function) `(from: string, mailboxes: readonly MailboxState[]): Shut | null`
- **withRoutes** (function) `(options: readonly ReplyOption[], r: Routes): ReplyOption[]`
- **clientRoutes** (function) `(main: Queryable, client: string): Promise<Routes>`
- **clientAccounts** (function) `(main: Queryable, client: string): Promise<AccountState[]>`
- **AccountState** (interface) `interface AccountState { platform: string; state: string; }`
- **MailboxState** (interface) `interface MailboxState { address: string; state: string; }`
- **Shut** (interface) `interface Shut { off: string; fix: "social" | "mail" | null; }`
- **Routes** (interface) `interface Routes { accounts: readonly AccountState[]; mailboxes: readonly MailboxState[]; }`
- **routeOf** (function) `(o: ReplyOption, r: Routes): Shut | null`

## packages/content/src/inbox/send.ts

- **accessChannel** (function) `(channel: InboxChannel, platform: string | null): string | null`
- **replyGate** (function) `(o: { channel: InboxChannel; platform?: string | null; part?: string; client: Pick<Client, "id" | "sends" | "approver"> | null; who: Who; }): Gate`
- **pickOption** (function) `(db: Queryable, thread: string, channel: InboxChannel, target: string): Promise<ReplyOption>`
- **replyWords** (function) `(body: unknown): string`
- **sendOn** (function) `(sender: ReplySender, option: ReplyOption, body: string, campaign: string | null = null): Promise<void>`
- **askReply** (function) `(db: Queryable, o: { thread: string; option: ReplyOption; body: string; who: string | null; by: string; why: string | null; }): Promise<InboxReply>`
- **waitingReply** (function) `(db: Queryable, id: number): Promise<InboxReply>`
- **settleReply** (function) `(db: Queryable, id: number, state: "sent" | "dropped" | "failed", by: string, detail: string | null = null, now = new Date()): Promise<boolean>`
- **waitingReplies** (function) `(db: Queryable, limit = 500): Omit<import("drizzle-orm/pg-core").PgSelectBase<"inbox_replies", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "inbox_replies"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement…`
- **queueReply** (function) `(db: Queryable, id: number, until: Date): Promise<void>`
- **queuedReplies** (function) `(db: Queryable, limit = 500): Omit<import("drizzle-orm/pg-core").PgSelectBase<"inbox_replies", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "inbox_replies"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement…`
- **releaseReply** (function) `(db: Queryable, id: number): Promise<InboxReply | null>`
- **failReply** (function) `(db: Queryable, id: number, detail: string): Promise<void>`
- **askFollowEmail** (function) `(db: Queryable, o: { subject: string; enrollmentId: number; body: string; by: string; why: string }): Promise<{ asked: boolean; why: string | null }>`
- **partOf** (function) `(o: Pick<ReplyOption, "channel" | "from">): string`
- **MAIL_PART** (const) `"mail.triage"`
- **REPLY_MAX** (const) `4000`
- **Gate** (interface) `interface Gate { mode: "send" | "ask"; why: string | null; }`
- **mayWork** (function) `(who: Who, client: string, channel: string | null): boolean`
- **ReplySender** (interface) `interface ReplySender { dm(contactId: number, body: string): Promise<void>; text(contactId: number, body: string): Promise<void>; comment(commentId: number, body: string): Promise<void>; invite(inviteId: number, body: string): Promise<void>; email(threadEventId: number, body: string): Promise<void>; thread(enrollmentId: number, body: string, campaign?: string | null): Promise<void>; mail(mailId: number, body: string): Promise<void>; chat(threadId: number, body: string): Promise<void>; posted(commentId: number, body: string): Promise<void>; }`
- **Copied** (interface) `interface Copied { text: string; url: string; }`
- **copiedOf** (function) `(option: ReplyOption, body: string): Copied | null`
- **campaignOfAsker** (function) `(askedBy: string): string | null`
- **HeldReply** (class) `constructor(message: string, readonly until: Date)`
- **QUEUED_WHY** (const) `"Held by the frequency cap. They are at their limit for now."`

## packages/content/src/inbox/suggest.ts

- **suggestReply** (function) `(db: Queryable, deps: SuggestDeps, o: { thread: string; channel: InboxChannel; target: string; now: Date }): Promise<string | null>`

## packages/content/src/inbox/threads.ts

- **statusOf** (function) `(row: { state: unknown; at: unknown }, kept: Pick<InboxThread, "status" | "statusAt" | "snoozeUntil"> | undefined, now: Date): ThreadStatus`
- **threadStates** (function) `(db: Queryable): Promise<Map<string, InboxThread>>`
- **setThread** (function) `(db: Queryable, thread: string, change: ThreadChange, by: string, now = new Date()): Promise<InboxThread>`
- **typed** (function) `(id: string): readonly [string, string]`

## packages/content/src/learn-back.ts

- **kindOfPost** (function) `(r: Pick<Row, "format" | "hook" | "avg_view_pct" | "avg_view_secs">): ItemKind | null`
- **outcomeOf** (function) `(kind: ItemKind, r: Pick<Row, "hook" | "avg_view_pct" | "score">): number | null`
- **ourPieces** (function) `(db: Queryable, scope: SopScope): Promise<OurPiece[]>`
- **learnBack** (function) `(db: Db, o: { client: string; sop: string; scope: SopScope; read: VideoReader; judge: JudgeFor; say?: (line: string) => void; }): Promise<LearnBack>`
- **LearnBack** (interface) `interface LearnBack { pieces: number; saved: number; broken: number; checks: CheckRow[]; }`

## packages/content/src/lessons.ts

- **lessonsFor** (function) `(db: Queryable, platform: Platform): Promise<Lessons>`
- **lessonsBlock** (function) `(l: Lessons): string`
- **Lessons** (interface) `interface Lessons { notes: string[]; winners: { text: string; views: number; score: number }[]; digest?: string[]; }`
- **NO_LESSONS** (const) `Lessons`

## packages/content/src/library.ts

- **mediaRecord** (function) `(signer?: VideoSigner): import("@wren/core/records").RecordType`
- **sopRecord** (const) `import("@wren/core/records").RecordType`

## packages/content/src/media.ts

- **checkMediaStore** (function) `(o: MediaStoreOptions): Promise<void>`
- **parseStored** (function) `(source: string): { bucket: string; key: string } | null`
- **uploadMedia** (function) `(path: string, o: MediaStoreOptions): Promise<string>`
- **putMedia** (function) `(bytes: Uint8Array, ext: string, o: MediaStoreOptions): Promise<string>`
- **putKey** (function) `(path: string, key: string, o: MediaStoreOptions): Promise<string>`
- **getKey** (function) `(key: string, path: string, o: MediaStoreOptions): Promise<void>`
- **s3MediaHost** (function) `(o: MediaStoreOptions & { expiresSeconds?: number }): MediaHost`
- **MediaStoreOptions** (interface) `interface MediaStoreOptions { bucket: string; region?: string; client?: S3Client; }`
- **AWS_LOGIN_HINT** (const) `"run aws-login (cd autobrowse && pnpm -s autobrowse aws-login --user william)"`

## packages/content/src/metrics.ts

- **metricsDue** (function) `(db: Queryable, now: Date, o: { watchDays?: number; lookEveryMs?: number; limit?: number } = {}): Promise<ContentDraft[]>`
- **recordMetrics** (function) `(db: Queryable, draftId: string, m: Metrics): Promise<ContentMetric>`
- **whatWorked** (function) `(db: Queryable, now: Date, o: { days?: number; platform?: ContentDraft["platform"] } = {}): Promise<WorkedRow[]>`
- **formatWhatWorked** (function) `(rows: readonly WorkedRow[]): string[]`
- **WorkedRow** (interface) `interface WorkedRow { draftId: string; platform: ContentDraft["platform"]; ideaId: string; text: string; url: string | null; publishedAt: Date; views: number; reactions: number; comments: number; shares: number; asOf: Date; score: number; looks: number; }`
- **scoreOf** (function) `(m: { views: number; reactions: number; comments: number; shares: number; }): number`

## packages/content/src/our-posts.ts

- **ourPosts** (function) `(db: Queryable): Promise<OurPost[]>`

## packages/content/src/own.ts

- **waitingIdeas** (function) `(db: Queryable, limit = 120): Promise<WaitingIdea[]>`
- **writeOwn** (function) `(db: Queryable, o: { text: string; title?: string | null; platforms: readonly Platform[]; by: string | null; source?: IdeaSource; from?: string | null; media?: Media | null; at?: Date | null; thread?: boolean; mark?: IdeaMark; }): Promise<{ idea: ContentIdea; results: DraftResult[] }>`

## packages/content/src/pieces.ts

- **titleOf** (function) `(words: string): string`
- **piecesOf** (function) `(rows: PieceRows): Piece[]`
- **pieceRows** (function) `(db: Queryable, site: string, days = 120): Promise<PieceRows>`
- **PieceKind** (type) `type PieceKind = (typeof PIECE_KINDS)[number];`
- **Branch** (interface) `interface Branch { id: string; platform: string; format: string; state: BranchState; at: string | null; url: string | null; views: number | null; engaged: number | null; error: string | null; waitingForBrowser?: true; }`
- **Piece** (interface) `interface Piece { id: string; kind: PieceKind; title: string; text: string; at: string; branches: Branch[]; children: Piece[]; video?: number; }`
- **DraftRow** (interface) `interface DraftRow { id: string; idea_id: string; platform: string; format: string; status: string; title: string | null; text: string; scheduled_for: string | Date | null; published_at: string | Date | null; url: string | null; error: string | null; video_draft: string | null; created_at: string | Date; views: number | null; engaged: number | null; }`
- **VideoRow** (interface) `interface VideoRow { id: number; title: string; state: string; shorts: readonly { title: string }[]; created_at: string | Date; }`
- **PieceRows** (interface) `interface PieceRows { drafts: readonly DraftRow[]; ideas: readonly IdeaRow[]; videos: readonly VideoRow[]; blogs: readonly Pick< BlogRow, | "slug" | "title" | "description" | "draft" | "publishedAt" | "emailedAt" | "createdAt" | "fromRef" >[]; site: string; }`
- **waitingOf** (function) `(p: Pick<Piece, "branches">): Branch[]`

## packages/content/src/plan.ts

- **tomorrowOf** (function) `(now: Date, zone: string): { day: string; from: Date; to: Date }`
- **planFor** (function) `(db: Queryable, platforms: readonly Platform[], day: { day: string; from: Date; to: Date }, zone: string, slots: Slots = DEFAULT_SLOTS): Promise<DayPlan>`
- **freeSlots** (function) `(instants: readonly Date[], taken: readonly Date[]): Date[]`
- **openSlots** (function) `(db: Queryable, platforms: readonly Platform[], day: { from: Date; to: Date }, zone: string, slots: Slots = DEFAULT_SLOTS): Promise<Partial<Record<Platform, Date[]>>>`
- **nextIdea** (function) `(db: Queryable, o: { now: Date; exclude?: readonly string[]; client?: boolean; }): Promise<NextIdea>`
- **formatPlan** (function) `(p: DayPlan): string[]`
- **DayPlan** (interface) `interface DayPlan { day: string; platforms: PlatformPlan[]; openIdeas: number; }`
- **shortfallOf** (function) `(p: DayPlan): number`

## packages/content/src/platforms.ts

- **unfitReason** (function) `(spec: PlatformSpec, media: Media | null | undefined): string | null`
- **wordsUnfit** (function) `(d: { platform: Platform; extra?: Readonly<Record<string, unknown>> | null }, text: string): string | null`
- **postOf** (function) `(draft: Pick<ContentDraft, "text" | "title" | "media" | "extra" | "platform">, link?: string | null): Post`
- **named** (function) `(r: { title?: string | null; text: string; platform: string }): string`
- **lockedWhy** (function) `(r: { title?: string | null; text: string; platform: string; status: string; error?: string | null; }, doing: string): string`
- **aboutDraft** (function) `(r: { title?: string | null; text: string; platform: string }, why: string): string`
- **PlatformSpec** (interface) `interface PlatformSpec { readonly platform: Platform; readonly name: string; readonly maxChars: number; readonly title?: { readonly maxChars: number }; readonly needsMedia?: "video" | "image-or-video"; readonly words?: { readonly kind: string; readonly name: string }; readonly shape: string; readonly goCode: string; readonly feed: { readonly laptop: number | null; readonly phone: number | null }; }`
- **PLATFORM_SPECS** (const) `Readonly<Record<Platform, PlatformSpec>>`
- **MAY_HAVE_GONE_OUT** (const) `"May have gone out"`
- **GONE** (const) `"That draft isn't here any more. Reload the page to see what's left."`

## packages/content/src/playbook.ts

- **playbookFor** (function) `(db: Queryable, platform: Platform): Promise<ContentPlaybook | null>`
- **dmGuide** (function) `(db: Queryable, platform: Platform): Promise<string>`
- **commentGuide** (function) `(db: Queryable, platform: Platform): Promise<string>`
- **pushPlaybook** (function) `(db: Queryable, p: { platform: Platform; sop: string; text: string; scope?: SopScope | null }): Promise<{ playbook: ContentPlaybook; changed: boolean }>`
- **playbookBlock** (function) `(playbook: Pick<ContentPlaybook, "text"> | null): string`
- **postStandardFor** (function) `(db: Queryable, playbook: Pick<ContentPlaybook, "sop" | "scope"> | null, platform: Platform): Promise<KindStandard | null>`
- **standardBlock** (function) `(standard: KindStandard | null): string`
- **COMMENTS_SOP** (const) `"comments"`
- **DM_SOP** (const) `"outbound-copy"`

## packages/content/src/promo.ts

- **videoDraftOf** (function) `(db: Queryable, video: number): Promise<string>`
- **promotable** (function) `(db: Queryable, videoDraft: string): Promise<{ id: string; title: string | null; text: string; status: "draft" | "approved" | "rejected" | "failed" | "published" | "publishing"; url: string | null; platform: Platform; extra: Record<string, unknown>; ref: string | null; }>`
- **promoBase** (function) `(db: Queryable, videoDraft: string): Promise<PromoBase>`
- **liveOf** (function) `(db: Queryable, ideaId: string): Promise<Map<string, string>>`
- **draftPromo** (function) `(db: Queryable, llm: LlmClient, base: PromoBase, platform: PromoPlatform, o: DraftOptions = {}): Promise<DraftResult>`
- **promoteVideo** (function) `(db: Queryable, llm: LlmClient, videoDraft: string, platforms: readonly PromoPlatform[] = PROMO_PLATFORMS, o: DraftOptions & { pieces?: readonly PromoPiece[] } = {}): Promise<{ ideaId: string; results: DraftResult[] }>`
- **promosOf** (function) `(db: Queryable, videoDraft: string): Promise<PromoRow[]>`
- **draftThread** (function) `(db: Queryable, llm: LlmClient, base: PromoBase, o: DraftOptions = {}): Promise<DraftResult>`
- **draftCarousel** (function) `(db: Queryable, llm: LlmClient, base: PromoBase, o: DraftOptions = {}): Promise<DraftResult[]>`
- **PROMO_PLATFORMS** (const) `readonly ["linkedin", "x", "reddit", "instagram"]`
- **PromoPlatform** (type) `type PromoPlatform = (typeof PROMO_PLATFORMS)[number];`
- **PROMO_PIECES** (const) `readonly ["posts", "thread", "carousel"]`
- **PromoPiece** (type) `type PromoPiece = (typeof PROMO_PIECES)[number];`
- **RECORDED** (const) `"I recorded a walkthrough video of this."`

## packages/content/src/queue.ts

- **dueDrafts** (function) `(db: Queryable, now: Date, limit = 20): Promise<ContentDraft[]>`
- **nextDue** (function) `(db: Queryable, now: Date): Promise<string | null>`
- **claim** (function) `(db: Queryable, id: string): Promise<ContentDraft | null>`
- **markPublished** (function) `(db: Queryable, id: string, published: Published, link?: string | null, by = "scheduler"): Promise<void>`
- **markPostedBy** (function) `(db: Queryable, id: string, o: { by: string; at: Date }): Promise<void>`
- **noteOnDraft** (function) `(db: Queryable, id: string, note: string): Promise<void>`
- **markWaiting** (function) `(db: Queryable, id: string, why: string): Promise<void>`
- **markCapped** (function) `(db: Queryable, id: string, until: Date, why: string): Promise<void>`
- **markFailed** (function) `(db: Queryable, id: string, error: string): Promise<void>`
- **markUnsure** (function) `(db: Queryable, id: string, why: string): Promise<void>`
- **sendAgain** (function) `(db: Queryable, id: string): Promise<ContentDraft | null>`
- **dropDraft** (function) `(db: Queryable, id: string, by: string): Promise<ContentDraft | null>`
- **waitingForBrowser** (function) `(d: { status: string; error: string | null }): boolean`

## packages/content/src/records.ts

- **siblingsOf** (function) `(db: Queryable, draftId: string): Promise<Sibling[]>`
- **Sibling** (interface) `interface Sibling { id: string; platform: Platform; title: string; state: DraftStatus; }`
- **draftRecordOf** (function) `(signer?: VideoSigner): import("@wren/core/records").RecordType`
- **draftRecord** (const) `import("@wren/core/records").RecordType`
- **postRecord** (const) `import("@wren/core/records").RecordType`
- **contentRecords** (function) `(signer?: VideoSigner): import("@wren/core/records").RecordType[]`
- **CONTENT_RECORDS** (const) `import("@wren/core/records").RecordType[]`

## packages/content/src/restate/auto-reply.ts

- **autoReplyReviews** (function) `(ctx: restate.Context, client: string | null, ids: readonly number[]): void`
- **makeAutoReply** (function) `(deps: AutoReplyDeps): restate.VirtualObjectDefinition<"AutoReply", { arrived: (ctx: restate.ObjectContext<restate.UntypedState>, input: Arrived) => Promise<{ asked: number | null; why: string; }>; }>`
- **autoReplyFire** (const) `FireTriggers`
- **AutoReply** (type) `type AutoReply = ReturnType<typeof makeAutoReply>;`

## packages/content/src/restate/blog.ts

- **makeBlog** (function) `(deps: BlogDeps): restate.VirtualObjectDefinition<"Blog", { posts: (ctx: restate.ObjectSharedContext) => Promise<{ on: boolean; site: string; posts: { title: string; description: string; date: string; createdAt: Date; updatedAt: Date; body: string; draft: boolean; publishedAt: Date | null; updatedBy: string | null; s…`
- **Blog** (type) `type Blog = ReturnType<typeof makeBlog>;`

## packages/content/src/restate/chat.ts

- **makeChat** (function) `(deps: ChatDeps): restate.ServiceDefinition<"Chat", { say: (ctx: restate.Context, req: Req) => Promise<Answer>; read: (_ctx: restate.Context, req: Req) => Promise<Answer>; }>`
- **Chat** (type) `type Chat = ReturnType<typeof makeChat>;`

## packages/content/src/restate/desk-context.ts

- **ContentDeskDeps** (interface) `interface ContentDeskDeps { db: Db; llm: LlmClient; platforms: readonly Platform[]; zone: string; voice?: string; brand?: Brand; tracer?: Tracer | null; media?: MediaStoreOptions; slides?: SlidePainter; clients?: { clientDb: (client: string) => Db; llm: LlmClient | null; keys?: KeyStore | null }; posted?: (ctx: restate.ObjectContext, platform: Platform, client: string | null) => void; }`
- **clientDrafting** (function) `(main: Db, id: string): Promise<{ ok: false; why: string; } | { platforms: Platform[]; ok: true; settings: import("../components.js").ClientPlannerSettings; brand: Brand; voice: string; }>`
- **DraftReport** (type) `type DraftReport = { ideaId: string; results: DraftResult[]; runId: string };`
- **DraftRequest** (interface) `interface DraftRequest { ideaId: string; platforms?: Platform[]; again?: boolean; }`
- **WriteResult** (interface) `interface WriteResult { platform: Platform; draftId: string | null; text: string | null; title: string | null; reason: string | null; at?: string | null; held?: string; }`

## packages/content/src/restate/desk-edits.ts

- **FunnelRequest** (interface) `interface FunnelRequest { draftId: string; stage?: FunnelStage | null; to?: FunnelTarget | null; video?: string | null; page?: string | null; linked?: boolean | "on" | "off" | "auto" | null; viewer?: unknown; }`
- **funnelPatch** (function) `(req: FunnelRequest): FunnelPatch`
- **NOT_CONNECTED** (const) `"no login of this client's posts here yet"`

## packages/content/src/restate/desk.ts

- **makeContentDesk** (function) `(deps: ContentDeskDeps): restate.VirtualObjectDefinition<"ContentDesk", { fields: (ctx: restate.ObjectContext, req: { draftId: string; patch: Record<string, unknown>; viewer?: unknown; }) => Promise<{ done: string[]; saved?: import("../shape-view.js").FieldsSaved; }>; promote: (ctx: restate.ObjectContext, req: { video?: num…`
- **DESK_KEY** (const) `"default"`
- **DESK_UNIT** (const) `"desk"`
- **ContentDesk** (type) `type ContentDesk = ReturnType<typeof makeContentDesk>;`

## packages/content/src/restate/draft-ask.ts

- **makeDraftAsk** (function) `(db: Db): restate.ServiceDefinition<"DraftAsk", { ask: (ctx: restate.Context, req: Item & { message: string; }) => Promise<{ id: string; }>; set: (ctx: restate.Context, req: Item & { text?: string; expect?: string | null; account?: string | null; }) => Promise<{ run?: string; turn?: DraftTurn | null; version?…`
- **DRAFT_ASK** (const) `{ readonly name: "DraftAsk"; }`

## packages/content/src/restate/inbox-desk.ts

- **makeInboxDesk** (function) `(deps: InboxDeskDeps): restate.ServiceDefinition<"InboxDesk", { autoReplies: (ctx: restate.Context, req: Req) => Promise<{ modes: Record<InboxChannel, AutoReplyMode>; held: boolean; }>; autoReplySet: (ctx: restate.Context, req: Req & { channel: InboxChannel; mode: AutoReplyMode; }) => Promise<{ modes: Record<InboxChannel,…`
- **InboxDesk** (type) `type InboxDesk = ReturnType<typeof makeInboxDesk>;`

## packages/content/src/restate/keyword-dm.ts

- **catchKeywordDms** (function) `(ctx: restate.Context, db: Db, client: string | null, ids: readonly number[]): Promise<number>`
- **makeKeywordDm** (function) `(deps: KeywordDmDeps): restate.ServiceDefinition<"KeywordDm", { add: (ctx: restate.Context, req: z.infer<typeof ADD>) => restate.RestatePromise<{ id: number; keyword: string; }>; remove: (ctx: restate.Context, req: { ids: unknown[]; }) => Promise<{ done: number; }>; send: (ctx: restate.Context, req: Send) => Promise<{ sta…`
- **KeywordDm** (type) `type KeywordDm = ReturnType<typeof makeKeywordDm>;`

## packages/content/src/restate/mail-reply.ts

- **makeMailReply** (function) `(deps: MailReplyDeps): restate.ServiceDefinition<"MailReply", { send: (ctx: restate.Context, req: { client: string; mailId: number; body: string; by?: string | null; }) => Promise<{ id: string | null; }>; }>`
- **MailReply** (type) `type MailReply = ReturnType<typeof makeMailReply>;`

## packages/content/src/restate/marketing-console.ts

- **marketingConsoleApi** (function) `({ db, open, records, tiktokCreator, reportMail, zone, }: MarketingConsoleDeps): { recordsTypes: (req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (req: PortalRequest & GetAsk) => Promise<import("@wren/core/records/serve").RecordAnswer>; r…`
- **makeMarketingConsole** (function) `(deps: MarketingConsoleDeps): restate.ServiceDefinition<"MarketingConsole", { recordsTypes: (_: restate.Context, req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (_: restate.Context, req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (_: re…`
- **AttachRequest** (interface) `interface AttachRequest extends PortalRequest { draftId: string; field: string; name: string; data: string; }`
- **MarketingConsoleService** (type) `type MarketingConsoleService = ReturnType<typeof makeMarketingConsole>;`

## packages/content/src/restate/metrics.ts

- **lookOf** (function) `(id: string, i: Insights): Metrics | null`
- **withCounts** (function) `(m: Metrics, i: Insights | null): Insights`
- **weekOf** (function) `(now: Date): string`
- **makeContentMetrics** (function) `(deps: ContentMetricsDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<MetricsStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<MetricsStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null…`
- **METRICS_KEY** (const) `"default"`
- **MetricsStats** (interface) `interface MetricsStats { looked: { id: string; platform: Platform; views: number; insights?: number; gaps?: number }[]; failed: { id: string; platform: Platform; error: string }[]; reported: boolean; reports?: Partial<Record<Platform, number | string>>; accounts?: Partial<Record<Platform, number | string>>; digest?: boolean; skipped?: number; }`
- **missWaitMs** (function) `(n: number): number`
- **ContentMetrics** (type) `type ContentMetrics = ReturnType<typeof makeContentMetrics>;`

## packages/content/src/restate/pieces.ts

- **makePieces** (function) `(deps: PiecesDeps): restate.VirtualObjectDefinition<"Pieces", { list: (ctx: restate.ObjectSharedContext) => Promise<{ pieces: import("../pieces.js").Piece[]; }>; }>`

## packages/content/src/restate/planner.ts

- **nextRunAt** (function) `(now: Date, zone: string, hour: number): Date`
- **plannerTitle** (function) `(plan: DayPlan, drafted: readonly Drafted[]): string`
- **makeContentPlanner** (function) `(deps: ContentPlannerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<PlannerStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<PlannerStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null…`
- **PLANNER_KEY** (const) `"default"`
- **DEFAULT_PLAN_PLATFORMS** (const) `readonly Platform[]`
- **PlannerSettings** (interface) `interface PlannerSettings { platforms?: Platform[]; draft?: boolean; approve?: boolean; slots?: Partial<Record<Platform, Slot[]>>; }`
- **Drafted** (interface) `interface Drafted { platform: Platform; draftId: string; slot: string; source: string; }`
- **PlannerStats** (type) `type PlannerStats = DayPlan & { drafted: Drafted[]; skipped: string[] };`
- **ContentPlanner** (type) `type ContentPlanner = ReturnType<typeof makeContentPlanner>;`

## packages/content/src/restate/reports.ts

- **makeClientReport** (function) `(deps: ReportDeps): restate.VirtualObjectDefinition<"ClientReport", { run: (ctx: restate.ObjectContext<restate.UntypedState>, input: { chain?: string; }) => Promise<{ state: "stale" | "off" | "ran" | "waiting"; nextAt: string | null; }>; }>`
- **startReport** (function) `(ctx: restate.Context, id: number): restate.InvocationHandle`

## packages/content/src/restate/scheduler.ts

- **makeContentScheduler** (function) `(deps: ContentSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<PublishStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<PublishStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null…`
- **SCHEDULER_KEY** (const) `"default"`
- **PublishStats** (interface) `interface PublishStats { published: { id: string; platform: Platform; url: string }[]; failed: { id: string; platform: Platform; error: string }[]; remaining: number; held?: number; waiting?: { id: string; platform: Platform }[]; posting?: { id: string; platform: Platform; since: string }[]; unsure?: { id: string; platform: Platform; why: string }[]; }`
- **ContentScheduler** (type) `type ContentScheduler = ReturnType<typeof makeContentScheduler>;`

## packages/content/src/restate/social-inbox.ts

- **makeSocialInbox** (function) `(deps: SocialInboxDeps): restate.ServiceDefinition<"SocialInbox", { read: (ctx: restate.Context, req: { client: string; }) => Promise<{ accounts: number; threads: number; messages: number; errors: string[]; }>; send: (ctx: restate.Context, req: { client: string; contactId: number; body: string; by?: string | null; again?: b…`
- **SocialInbox** (type) `type SocialInbox = ReturnType<typeof makeSocialInbox>;`

## packages/content/src/restate/social-push.ts

- **metaPushes** (function) `(body: unknown): PushedAt[]`
- **gbpPush** (function) `(note: unknown): PushedAt | null`
- **ownerOf** (function) `(db: Db, p: PushedAt, ours: { pageId?: string | null; igId?: string | null }): Promise<string | null>`
- **makeSocialPush** (function) `(deps: SocialPushDeps): restate.ServiceDefinition<"SocialPush", { meta: (ctx: restate.Context, body: unknown) => Promise<PushResult>; gbp: (ctx: restate.Context, note: unknown) => Promise<PushResult>; watch: (ctx: restate.Context, w: z.infer<typeof WATCH>) => Promise<PushResult>; }>`
- **Pushed** (interface) `interface Pushed { platform: Platform; kind: PushKind; post?: string; }`
- **pushKey** (function) `(p: Pushed): string`
- **socialWatchKey** (function) `(owner: string): string`
- **socialPushed** (const) `restate.VirtualObjectDefinition<"SocialPushed", { add: (ctx: restate.ObjectContext, pushes: Pushed[]) => Promise<number>; take: (ctx: restate.ObjectContext) => Promise<Pushed[]>; alive: (ctx: restate.ObjectContext, { platform }: { platform: string; }) => Promise<void>; reach: (ctx: restate.ObjectCon…`
- **ReachView** (interface) `interface ReachView { pushed: string[]; watched: string[]; }`
- **SocialPushed** (type) `type SocialPushed = typeof socialPushed;`
- **SocialPush** (type) `type SocialPush = ReturnType<typeof makeSocialPush>;`

## packages/content/src/restate/social.ts

- **siteReadDue** (function) `(unit: string, last: Readonly<Record<string, number>>, now: number): boolean`
- **nextPassAt** (function) `(now: Date, zone: string): Date`
- **makeSocialWatch** (function) `(deps: SocialWatchDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<SocialStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<SocialStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) …`
- **makeSocialDesk** (function) `(deps: { db: Db; zone: string }): restate.ServiceDefinition<"SocialDesk", { markSeen: (ctx: restate.Context, req: { ids: number[]; }) => Promise<{ seen: number; }>; markAllSeen: (ctx: restate.Context) => Promise<{ seen: number; }>; readPost: (ctx: restate.Context, req: { id: number; }) => Promise<{ read: boolean; kept: number; }>; r…`
- **SOCIAL_KEY** (const) `"wren"`
- **SITE_EVERY_MS** (const) `number`
- **LOGIN_GAP_MS** (const) `number`
- **SocialStats** (interface) `interface SocialStats { posts: number; skipped: number; comments: number; reviews: number; asked: number; activity: number; following: number; sitePosts: number; ownComments: number; unfollowed: string[]; dms: number; keywordDms: number; audience: Platform[]; missed: string[]; held: string[]; slow?: number; errors: string[]; }`
- **SocialWatch** (type) `type SocialWatch = ReturnType<typeof makeSocialWatch>;`
- **SocialDesk** (type) `type SocialDesk = ReturnType<typeof makeSocialDesk>;`

## packages/content/src/restate/video-desk.ts

- **makeVideoDesk** (function) `(db: Db, o: { llm?: VideoModel | null } = {}): restate.ServiceDefinition<"VideoDesk", { set: (ctx: restate.Context, req: One & { patch: unknown; expect?: Record<string, unknown>; proposal?: string; }) => Promise<{ run: string; view: import("../video.js").VideoView; }>; propose: (ctx: restate.Context, req: One & { sentence: string; beat?: string …`
- **STUDIO** (const) `{ readonly name: "studio"; }`

## packages/content/src/review.ts

- **listDrafts** (function) `(db: Queryable, f: DraftFilter = {}): Promise<ContentDraft[]>`
- **getDraft** (function) `(db: Queryable, id: string): Promise<ContentDraft>`
- **approveDrafts** (function) `(db: Queryable, ids: readonly string[], o: { now: Date; at?: Date | null; zone?: string; asap?: boolean; slots?: Slots; by?: string; expect?: string | null; }): Promise<ContentDraft[]>`
- **respreadApproved** (function) `(db: Queryable, platform: Platform, o: { now: Date; zone: string; slots?: Slots; by?: string }): Promise<ContentDraft[]>`
- **setFields** (function) `(db: Queryable, id: string, patch: Readonly<Record<string, unknown>>, who?: { by: string; via?: DraftVia }): Promise<ContentDraft>`
- **rejectDrafts** (function) `(db: Queryable, ids: readonly string[], o: { by?: string; reason?: RejectReason | null; note?: string | null } = {}): Promise<ContentDraft[]>`
- **editDraft** (function) `(db: Queryable, id: string, change: { text: string; title?: string | null }, who?: { by: string; via?: DraftVia }): Promise<ContentDraft>`
- **draftsOfIdea** (function) `(db: Queryable, ideaId: string): Promise<ContentDraft[]>`
- **draftVersion** (function) `(text: string): string`
- **FAN_GAP_MS** (const) `number`

## packages/content/src/schema.ts

- **IDEA_STATUSES** (const) `readonly ["open", "drafted", "archived"]`
- **IdeaStatus** (type) `type IdeaStatus = (typeof IDEA_STATUSES)[number];`
- **IDEA_SOURCES** (const) `readonly ["cli", "api", "ads", "build_log", "question", "promo", "note", "site"]`
- **IdeaSource** (type) `type IdeaSource = (typeof IDEA_SOURCES)[number];`
- **DRAFT_STATUSES** (const) `readonly ["draft", "approved", "rejected", "publishing", "published", "failed"]`
- **DraftStatus** (type) `type DraftStatus = (typeof DRAFT_STATUSES)[number];`
- **FUNNEL_STAGES** (const) `readonly ["reach", "trust", "convert"]`
- **FunnelStage** (type) `type FunnelStage = (typeof FUNNEL_STAGES)[number];`
- **FUNNEL_TARGETS** (const) `readonly ["video", "site", "booking", "page", "repo"]`
- **FunnelTarget** (type) `type FunnelTarget = (typeof FUNNEL_TARGETS)[number];`
- **contentIdeas** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "content_ideas"; schema: undefined; columns: { text: import("drizzle-orm/pg-core").PgColumn<{ name: "text"; tableName: "content_ideas"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: fal…`
- **contentPlaybooks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "content_playbooks"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "content_playbooks"; dataType: "string"; columnType: "PgVarchar"; data: Platform; driverParam: string; notNull: …`
- **contentDrafts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "content_drafts"; schema: undefined; columns: { ideaId: import("drizzle-orm/pg-core").PgColumn<{ name: "idea_id"; tableName: "content_drafts"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefau…`
- **contentMetrics** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "content_metrics"; schema: undefined; columns: { draftId: import("drizzle-orm/pg-core").PgColumn<{ name: "draft_id"; tableName: "content_metrics"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasD…`
- **ACTIVITY_STATES** (const) `readonly ["new", "seen"]`
- **ActivityState** (type) `type ActivityState = (typeof ACTIVITY_STATES)[number];`
- **socialActivity** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_activity"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "social_activity"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **socialDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_days"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "social_days"; dataType: "string"; columnType: "PgVarchar"; data: Platform; driverParam: string; notNull: true; hasDef…`
- **postMetricDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "post_metric_days"; schema: undefined; columns: { draftId: import("drizzle-orm/pg-core").PgColumn<{ name: "draft_id"; tableName: "post_metric_days"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; ha…`
- **accountMetricDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "account_metric_days"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "account_metric_days"; dataType: "string"; columnType: "PgVarchar"; data: Platform; driverParam: string; notNu…`
- **SOURCE_STATES** (const) `readonly ["live", "needs_scope", "needs_william", "not_built", "no_api", "error", "waiting"]`
- **SourceState** (type) `type SourceState = (typeof SOURCE_STATES)[number];`
- **metricSources** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "metric_sources"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "metric_sources"; dataType: "string"; columnType: "PgVarchar"; data: Platform; driverParam: string; notNull: true; …`
- **VARIANT_FIELDS** (const) `readonly ["title", "thumbnail", "hook"]`
- **VariantField** (type) `type VariantField = (typeof VARIANT_FIELDS)[number];`
- **VARIANT_STATES** (const) `readonly ["proposed", "live", "ended", "rejected"]`
- **VariantState** (type) `type VariantState = (typeof VARIANT_STATES)[number];`
- **VARIANT_SOURCES** (const) `readonly ["publish", "swap"]`
- **postVariants** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "post_variants"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "post_variants"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **PostVariant** (type) `type PostVariant = typeof postVariants.$inferSelect;`
- **contentDigests** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "content_digests"; schema: undefined; columns: { week: import("drizzle-orm/pg-core").PgColumn<{ name: "week"; tableName: "content_digests"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDe…`
- **DigestLine** (interface) `interface DigestLine { kind: "top" | "bottom" | "moved" | "next" | "cadence"; text: string; post?: string; }`
- **SocialActivity** (type) `type SocialActivity = typeof socialActivity.$inferSelect;`
- **ContentIdea** (type) `type ContentIdea = typeof contentIdeas.$inferSelect;`
- **NewContentIdea** (type) `type NewContentIdea = typeof contentIdeas.$inferInsert;`
- **ContentDraft** (type) `type ContentDraft = typeof contentDrafts.$inferSelect;`
- **NewContentDraft** (type) `type NewContentDraft = typeof contentDrafts.$inferInsert;`
- **ContentMetric** (type) `type ContentMetric = typeof contentMetrics.$inferSelect;`
- **ContentPlaybook** (type) `type ContentPlaybook = typeof contentPlaybooks.$inferSelect;`
- **formatSql** (const) `"case\n when d.platform = 'youtube' then case d.extra->>'kind' when 'short' then 'short'\n when 'community' then 'post' else 'long' end\n when d.platform = 'tiktok' then 'video'\n when d.platform in ('instagram', 'facebook') and d.extra->>'kind' = 'story' then 'story'\n when d.platform = 'instagram'…`
- **marketingPostRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_post_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_post_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimary…`
- **marketingConversation** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_conversation", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_conversation"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimary…`
- **draftActivity** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"draft_activity", false, { item: import("drizzle-orm/pg-core").PgColumn<{ name: "item"; tableName: "draft_activity"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; …`
- **doneRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"done_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "done_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: fal…`
- **draftOutcomes** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"draft_outcomes", false, { item: import("drizzle-orm/pg-core").PgColumn<{ name: "item"; tableName: "draft_outcomes"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; …`
- **draftPeople** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"draft_people", false, { item: import("drizzle-orm/pg-core").PgColumn<{ name: "item"; tableName: "draft_people"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAu…`
- **marketingDraftRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_draft_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_draft_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrima…`
- **INBOX_STATUSES** (const) `readonly ["open", "waiting", "closed"]`
- **InboxStatus** (type) `type InboxStatus = (typeof INBOX_STATUSES)[number];`
- **inboxThreads** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "inbox_threads"; schema: undefined; columns: { thread: import("drizzle-orm/pg-core").PgColumn<{ name: "thread"; tableName: "inbox_threads"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefau…`
- **InboxThread** (type) `type InboxThread = typeof inboxThreads.$inferSelect;`
- **INBOX_CHANNELS** (const) `readonly ["email", "text", "dm", "comment", "chat"]`
- **InboxChannel** (type) `type InboxChannel = (typeof INBOX_CHANNELS)[number];`
- **INBOX_REPLY_STATES** (const) `readonly ["waiting", "queued", "sent", "dropped", "failed"]`
- **InboxReplyState** (type) `type InboxReplyState = (typeof INBOX_REPLY_STATES)[number];`
- **inboxReplies** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "inbox_replies"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "inbox_replies"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **InboxReply** (type) `type InboxReply = typeof inboxReplies.$inferSelect;`
- **chatThreads** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "chat_threads"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "chat_threads"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **ChatThread** (type) `type ChatThread = typeof chatThreads.$inferSelect;`
- **CHAT_DIRECTIONS** (const) `readonly ["in", "out"]`
- **ChatDirection** (type) `type ChatDirection = (typeof CHAT_DIRECTIONS)[number];`
- **chatMessages** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "chat_messages"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "chat_messages"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **ChatMessage** (type) `type ChatMessage = typeof chatMessages.$inferSelect;`
- **AUTO_REPLY_MODES** (const) `readonly ["off", "suggest", "auto"]`
- **AutoReplyMode** (type) `type AutoReplyMode = (typeof AUTO_REPLY_MODES)[number];`
- **autoReplies** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "auto_replies"; schema: undefined; columns: { channel: import("drizzle-orm/pg-core").PgColumn<{ name: "channel"; tableName: "auto_replies"; dataType: "string"; columnType: "PgVarchar"; data: "comment" | "email" | "text" | "dm" | "chat"; driver…`
- **AD_FORMAT_STATES** (const) `readonly ["idea", "testing", "proven", "retired"]`
- **AdFormatState** (type) `type AdFormatState = (typeof AD_FORMAT_STATES)[number];`
- **AD_FORMAT_FAMILIES** (const) `readonly ["offer", "proof", "contrast", "story", "native", "alarm", "lesson", "humor"]`
- **AdFormatFamily** (type) `type AdFormatFamily = (typeof AD_FORMAT_FAMILIES)[number];`
- **adFormats** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "ad_formats"; schema: undefined; columns: { slug: import("drizzle-orm/pg-core").PgColumn<{ name: "slug"; tableName: "ad_formats"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false;…`
- **adFormatRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"ad_format_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "ad_format_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false…`
- **KEYWORD_PLATFORMS** (const) `readonly ["instagram", "facebook"]`
- **KeywordPlatform** (type) `type KeywordPlatform = (typeof KEYWORD_PLATFORMS)[number];`
- **commentKeywords** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "comment_keywords"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "comment_keywords"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault:…`
- **KEYWORD_HIT_STATES** (const) `readonly ["queued", "sent", "failed"]`
- **KeywordHitState** (type) `type KeywordHitState = (typeof KEYWORD_HIT_STATES)[number];`
- **keywordHits** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "keyword_hits"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "keyword_hits"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **commentKeywordRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"comment_keyword_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "comment_keyword_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrima…`
- **keywordHitRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"keyword_hit_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "keyword_hit_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: f…`
- **blogPosts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "blog_posts"; schema: undefined; columns: { slug: import("drizzle-orm/pg-core").PgColumn<{ name: "slug"; tableName: "blog_posts"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false;…`

## packages/content/src/shape-view.ts

- **ShapeView** (interface) `interface ShapeView { draftId: string; platform: Platform; site: string; kind: string; status: DraftStatus; editable: boolean; title: string | null; text: string; max: number; fields: FieldView[]; missing: string[]; places?: string[]; links: Record<string, string>; media: { kind: "image" | "video"; name: string } | null; scheduled: string | null; published: { url: string | null; at: string | null; notes: string | null } | null; funnel: FunnelView & { videos: FunnelVideo[]; pages: FunnelPage[] }; thread: ThreadView | null; carousel: CarouselView | null; tiktok?: { creator: TikTokCreator | null; note: string | null }; }`
- **shapeView** (function) `(db: Queryable, draftId: string, signer?: VideoSigner): Promise<ShapeView | null>`

## packages/content/src/slide-paint.ts

- **PaintUnavailable** (class) `override name`
- **slidePainter** (function) `(o: { connectUrl?: string | null } = {}): SlidePainter`

## packages/content/src/slots.ts

- **slotsOf** (function) `(custom: Partial<Record<Platform, readonly Slot[]>> | null | undefined): Slots`
- **slotInstants** (function) `(platform: Platform, from: Date, zone: string, days: number, slots: Slots = DEFAULT_SLOTS): Date[]`
- **nextSlot** (function) `(platform: Platform, now: Date, zone: string, slots: Slots = DEFAULT_SLOTS, taken: readonly Date[] = []): Date`
- **Slot** (interface) `interface Slot { hour: number; minute: number; days?: readonly number[]; }`
- **Slots** (type) `type Slots = Readonly<Record<Platform, readonly Slot[]>>;`
- **DEFAULT_SLOTS** (const) `Slots`

## packages/content/src/social/records.ts

- **activityRecord** (const) `import("@wren/core/records").RecordType`
- **PROOF_STATES** (const) `{ readonly live: { readonly label: "Live"; readonly tone: "good"; readonly about: "Someone signed out sees it"; }; readonly hidden: { readonly label: "Hidden"; readonly tone: "warn"; readonly about: "We see it, strangers don't: a filter or a mod holds it"; }; readonly missing: { readonly label: "Mis…`
- **FORMATS** (const) `{ post: { label: string; tone: "neutral"; }; thread: { label: string; tone: "neutral"; }; carousel: { label: string; tone: "neutral"; }; }`
- **MISSING_PICKS** (const) `{ privacy: { label: string; tone: "warn"; }; disclosure: { label: "You need to indicate if your content promotes yourself, a third party, or both."; tone: "warn"; }; }`
- **inboxRecord** (const) `import("@wren/core/records").RecordType`
- **approvalRecord** (const) `import("@wren/core/records").RecordType`
- **engageRecord** (const) `import("@wren/core/records").RecordType`
- **exploreRecord** (const) `import("@wren/core/records").RecordType`
- **askedReplyRecord** (const) `import("@wren/core/records").RecordType`
- **audienceRecord** (const) `import("@wren/core/records").RecordType`
- **socialRecords** (function) `(signer?: VideoSigner): import("@wren/core/records").RecordType[]`

## packages/content/src/social/review-record.ts

- **reviewRecord** (const) `import("@wren/core/records").RecordType`

## packages/content/src/social/store.ts

- **recentPosts** (function) `(db: Queryable, platforms: readonly Platform[], now: Date, followUpDays = 0): Promise<RecentPost[]>`
- **postOfComment** (function) `(db: Queryable, id: number): Promise<RecentPost | null>`
- **keepPostComments** (function) `(db: Queryable, post: RecentPost, rows: readonly CommentRow[], o: { reviews?: boolean; now?: Date } = {}): Promise<KeptComment[]>`
- **keepReviews** (function) `(db: Queryable, platform: Platform, rows: readonly CommentRow[], now: Date): Promise<KeptComment[]>`
- **newestActivityAt** (function) `(db: Queryable, platform: Platform): Promise<string | null>`
- **keepActivity** (function) `(db: Queryable, platform: Platform, rows: readonly ActivityRow[], now: Date): Promise<Array<{ id: number; kind: ActivityRow["kind"] }>>`
- **hasDay** (function) `(db: Queryable, platform: Platform, day: string): Promise<boolean>`
- **keepDay** (function) `(db: Queryable, platform: Platform, day: string, a: Audience, latest = false): Promise<boolean>`
- **markSeen** (function) `(db: Queryable, ids: readonly number[] | null): Promise<number>`
- **pingOf** (function) `(kept: readonly Pick<KeptComment, "platform">[], activity: readonly { kind: ActivityRow["kind"] }[]): string | null`
- **FRESH_DAYS** (const) `3`
- **RecentPost** (interface) `interface RecentPost { platform: Platform; id: string; url: string | null; title: string; publishedAt: string; }`
- **isDue** (function) `(p: RecentPost, lastRead: number | undefined, now: Date): boolean`
- **canSkip** (function) `(p: RecentPost, probed: number | undefined, stored: number | undefined, lastFull: number | undefined, now: Date): boolean`
- **KeptComment** (type) `type KeptComment = Pick<Comment, "id" | "platform" | "author" | "post"> & { asked: boolean; };`
- **fromMaps** (function) `(raw: unknown): boolean`
- **PLATFORM_NAMES** (const) `Record<Platform, string>`

## packages/content/src/status.ts

- **startOfWeekUtc** (function) `(today: Date): Date`
- **weekSlipped** (function) `(today: Date, draftedThisWeek: number): boolean`
- **formatStatusLines** (function) `(r: StatusReport): string[]`
- **collectStatus** (function) `(db: Queryable, now: Date): Promise<StatusReport>`
- **THURSDAY** (const) `3`
- **StatusReport** (interface) `interface StatusReport { draftsByStatus: Readonly<Record<string, number>>; oldestDraftDays: number | null; openIdeas: number; draftedThisWeek: number; tokensThisMonth: { calls: number; input: number; output: number }; }`

## packages/content/src/touches.ts

- **touchFromActivity** (function) `(db: Queryable, id: number): Promise<{ id: number; handleId: number; created: boolean; linked: boolean; } | null>`
- **keepFollowing** (function) `(db: Queryable, platform: string, rows: readonly FollowingRow[], now: Date): Promise<FollowingKept>`
- **keepOwnComments** (function) `(db: Queryable, platform: string, rows: readonly OwnCommentRow[]): Promise<number>`
- **linkCommentAuthors** (function) `(db: Queryable): Promise<number>`
- **backfillTouches** (function) `(db: Queryable, o: { dryRun?: boolean; now?: Date } = {}): Promise<TouchesBackfill>`
- **FOLLOWING_SOURCE** (const) `"following"`
- **OWN_COMMENTS_SOURCE** (const) `"own_comments"`

## packages/content/src/train-backfill.ts

- **backfillTraining** (function) `(db: Queryable, o: { dryRun?: boolean } = {}): Promise<BackfillReport>`

## packages/content/src/video-ask.ts

- **undoVideo** (function) `(db: Queryable, id: number, by: string): Promise<{ run: string; n: number; edit: VideoEdit; } | { run: string; edit: VideoEdit; snapped: import("@wren/studio").Moved[]; }>`
- **videoChanges** (function) `(db: Queryable, id: number): Promise<{ run: string; command: string; by: string | null; at: string; before: object; }[]>`

## packages/content/src/video.ts

- **ApprovedVideo** (interface) `interface ApprovedVideo { id: string; again: boolean; reel?: { id: string; again: boolean } | { missing: string }; also?: { platform: string; id: string }[]; }`
- **approveVideo** (function) `(db: Queryable, id: number, o: ApproveVideo): Promise<ApprovedVideo>`
- **fillFooter** (function) `(tpl: Template | null, e: Pick<VideoEdit, "id" | "title">): string`
- **pickThumbnail** (function) `(db: Queryable, id: number, n: number): Promise<string>`
- **reelKey** (function) `(short: number | CroppedFormat): string`
- **SwappedDraft** (interface) `interface SwappedDraft { id: string; platform: string; short: number; from: string; to: string; }`
- **swapShortMedia** (function) `(db: Queryable, id: number, o: { short?: number; by: string }): Promise<{ run: string; swapped: SwappedDraft[]; missing: string[] }>`
- **VIDEO_FOOTERS** (const) `{ readonly long: { readonly kind: "post"; readonly system: "youtube"; readonly name: "footer"; }; readonly short: { readonly kind: "post"; readonly system: "youtube"; readonly name: "shorts-footer"; }; readonly reel: { readonly kind: "post"; readonly system: "instagram"; readonly name: "reel-footer"…`
- **VIDEO_PRIVACY** (const) `readonly ["private", "unlisted", "public"]`
- **VideoFooter** (type) `type VideoFooter = keyof typeof VIDEO_FOOTERS;`
- **VideoPrivacy** (type) `type VideoPrivacy = (typeof VIDEO_PRIVACY)[number];`
- **videoFooters** (function) `(db: Queryable): Promise<Record<VideoFooter, Template | null>>`
- **videoRef** (function) `(id: number, short?: number | "vertical"): string`
- **videoSlug** (function) `(e: Pick<VideoEdit, "id" | "title">): string`
- **withFooter** (function) `(parts: string[], footer: string, max: number): string`
- **VideoSigner** (interface) `interface VideoSigner { bucket: string; host: { host(source: string): Promise<string> }; }`
- **videoRecord** (function) `(signer?: VideoSigner): import("@wren/core/records").RecordType`

## packages/content/src/voice.ts

- **DEFAULT_VOICE** (const) `"Extremely concise. Short plain sentences a person would say out loud.\nFewer words, more signal. No filler, no hedging, no hype, no jargon, no buzzwords.\nLead with the point. Concrete over abstract: the real numbers and events you are given, never made-up ones.\nFirst person, one person talking, n…`
- **Brand** (interface) `interface Brand { readonly name: string; readonly about: string; }`
- **DEFAULT_BRAND** (const) `Brand`

## packages/content/src/write.ts

- **splitPosts** (function) `(text: string): string[]`
- **ownDraftOf** (function) `(platform: Platform, text: string, title?: string | null, media?: Media | null): { text: string; title: string | null; extra?: Record<string, unknown> } | { reason: string }`
- **ownThreadOf** (function) `(text: string): { text: string; title: null; extra: Record<string, unknown> } | { reason: string }`
- **OWN_WORDS** (const) `"own"`
- **IDEA_ANGLES** (const) `readonly ["Proof", "Contrarian", "How I do it", "Story"]`
- **IdeaAngle** (type) `type IdeaAngle = (typeof IDEA_ANGLES)[number];`
