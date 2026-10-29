# @wren/content: interface

Exports: 632. Files: 88.

## packages/content/src/analytics/catalog.ts

- **CADENCE_GOALS** (const) `readonly CadenceGoal[]`
- **CadenceGoal** (interface) `interface CadenceGoal { id: string; platform: GoalPlace; label: string; name: string; goal: number; upTo?: number; daily: number | null; pace: string; how: string; piece: string; starts: "words" | "video" | "thread"; counts: readonly Format[] | "any" | "thread_comment" | null; }`
- **PIECE_NAMES** (const) `Readonly<Record<string, string>>`

## packages/content/src/analytics/goals.ts

- **GOALS_COMPONENT** (const) `"marketing.cadence"`
- **cadenceGoals** (function) `(db: Queryable): Promise<readonly CadenceGoal[]>`
- **goalsSchema** (const) `z.ZodObject<{ goals: z.ZodArray<z.ZodObject<{ id: z.ZodString; platform: z.ZodString; label: z.ZodString; name: z.ZodString; goal: z.ZodNumber; upTo: z.ZodOptional<z.ZodNumber>; daily: z.ZodNullable<z.ZodNumber>; pace: z.ZodString; how: z.ZodString; piece: z.ZodString; starts: z.ZodEnum<{ words: "wo…`

## packages/content/src/analytics/records.ts

- **ANALYTICS_RECORDS** (const) `import("@wren/core/records").RecordType[]`

## packages/content/src/analytics/variants.ts

- **SWAPS** (const) `Partial<Record<Platform, readonly VariantField[]>>`
- **VariantWindow** (interface) `interface VariantWindow { id: number; field: VariantField; value: string; state: PostVariant["state"]; source: PostVariant["source"]; started: string | null; ended: string | null; from: string | null; to: string | null; days: number; views: number | null; viewsPerDay: number | null; impressions: number | null; ctr: number | null; }`
- **WaitingSwap** (interface) `interface WaitingSwap { id: number; draftId: string; platform: Platform; title: string | null; field: VariantField; value: string; live: string | null; why: string | null; by: string; at: Date; url: string | null; }`
- **askSwap** (function) `(db: Queryable, a: { draftId: string; field: VariantField; value: string; why?: string | null; by: string }, now: Date): Promise<PostVariant>`
- **variantWindows** (function) `(db: Queryable, draftId: string, today: Date): Promise<VariantWindow[]>`
- **waitingSwaps** (function) `(db: Queryable): Promise<WaitingSwap[]>`

## packages/content/src/attach.ts

- **ATTACH_MAX_BYTES** (const) `number`
- **attachFile** (function) `(db: Queryable, store: MediaStoreOptions, req: { draftId: string; field: string; name: string; data: string }, who: { by: string }): Promise<ContentDraft>`
- **attachmentOf** (function) `(platform: ContentDraft["platform"], field: string, name: string, bytes: Uint8Array): string`

## packages/content/src/blog.ts

- **BLOG_DIR** (const) `"src/content/blog"`
- **BlogPost** (interface) `interface BlogPost { slug: string; title: string; description: string; body: string; date: string; draft: boolean; }`
- **BlogRow** (type) `type BlogRow = typeof blogPosts.$inferSelect;`
- **blogFile** (function) `(p: BlogPost): string`
- **blogProblem** (function) `(p: Pick<BlogPost, "slug" | "title" | "description" | "body">): "the address can't be used" | "it needs a title" | "the title is over 120 characters" | "it needs a one-line description" | "the description is over 300 characters" | "it has no words yet" | null`
- **blogRow** (function) `(db: Queryable, slug: string): Promise<BlogRow | null>`
- **blogRows** (function) `(db: Queryable, limit = 30): Promise<BlogRow[]>`
- **keepBlogRow** (function) `(db: Queryable, p: BlogPost, o: { commit: string | null; by: string; now: Date; from?: string | null; }): Promise<BlogRow>`
- **markEmailed** (function) `(db: Queryable, slug: string, at: Date): Promise<void>`
- **slugOf** (function) `(title: string): string`

## packages/content/src/carousel.ts

- **CAROUSEL_PLATFORMS** (const) `readonly ["instagram", "linkedin"]`
- **CarouselPlatform** (type) `type CarouselPlatform = (typeof CAROUSEL_PLATFORMS)[number];`
- **SlidePainter** (type) `type SlidePainter = (html: string, count: number) => Promise<SlidePaint>;`
- **keepSlideFiles** (function) `(db: Queryable, id: string, files: SlideFiles): Promise<ContentDraft[]>`
- **paintSlides** (function) `(slides: readonly Slide[], html: string, paint: SlidePainter, store: MediaStoreOptions): Promise<SlideFiles>`
- **renderSlides** (function) `(db: Queryable, id: string, paint: SlidePainter, store: MediaStoreOptions, o: { by?: string } = {}): Promise<SlideFiles>`
- **saveSlides** (function) `(db: Queryable, id: string, slides: unknown, who?: { by: string; via?: DraftVia }): Promise<ContentDraft[]>`
- **slidesToDraw** (function) `(db: Queryable, id: string, by?: string): Promise<{ slides: Slide[]; html: string }>`
- **writeCarousel** (function) `(db: Queryable, o: { slides: unknown; text: string; platforms: readonly CarouselPlatform[]; by: string | null; }): Promise<{ ideaId: string; results: DraftResult[] }>`

## packages/content/src/check.ts

- **DraftCheck** (interface) `interface DraftCheck extends PieceCheck { version: string; at: string; sop: string | null; hook: string | null; rules: { call: SopCall["call"]; say: string; cite: string; verdict: RuleVerdict }[]; changes: string[]; why: string | null; }`
- **RuleVerdict** (type) `type RuleVerdict = "meets" | "breaks" | "n/a";`
- **checkDraft** (function) `(db: Queryable, llm: LlmClient, draftId: string, o: { tracer?: Tracer; runId?: string; now?: Date } = {}): Promise<DraftCheck | null>`
- **judgePrompt** (function) `(text: string, check: PieceCheck, own: SopCall[], playbook: Pick<ContentPlaybook, "text"> | null): string`

## packages/content/src/client-reports/tiles.ts

- **EVERY_NAMES** (const) `Record<ReportEvery, string>`
- **MAX_RECIPIENTS** (const) `10`
- **MAX_REPORTS** (const) `20`
- **REPORT_EVERY** (const) `readonly ["week", "month"]`
- **REPORT_HOUR** (const) `9`
- **REPORT_TILES** (const) `readonly [{ readonly id: "views"; readonly label: "Content views"; readonly record: "marketing.post"; readonly sum: "views"; readonly view: "all"; }, { readonly id: "post_visits"; readonly label: "Site visitors from posts"; readonly record: "marketing.link_day"; readonly sum: "clicks"; readonly view…`
- **REPORT_TILE_IDS** (const) `["visits" | "forms" | "bookings" | "calls" | "paid" | "views" | "spend" | "post_visits" | "ad_impressions" | "search_impressions", ...("visits" | "forms" | "bookings" | "calls" | "paid" | "views" | "spend" | "post_visits" | "ad_impressions" | "search_impressions")[]]`
- **ReportEvery** (type) `type ReportEvery = (typeof REPORT_EVERY)[number];`
- **ReportLine** (interface) `interface ReportLine { tile: ReportTileId; label: string; value: number | null; prior: number | null; currency: string | null; error?: string; }`
- **ReportTileId** (type) `type ReportTileId = ReportTile["id"];`
- **changeOf** (function) `(l: Pick<ReportLine, "value" | "prior">): string | null`
- **shown** (function) `(l: Pick<ReportLine, "value" | "currency">, locale = "en-US"): string`

## packages/content/src/clients.ts

- **CLIENT_VOICE** (const) `"Plain and concise. Short sentences a person would say out loud.\nConcrete over abstract: what was done, for whom, what changed, with numbers where there are any.\nNo hype, no jargon, no emoji, no hashtags, no exclamation marks, no calls to follow or like."`
- **clientContent** (function) `(main: Queryable, id: string, part: string): Promise<ClientContent>`
- **clientPlan** (function) `(client: Client): | { ok: true; settings: ClientPlannerSettings; brand: Brand; voice: string } | { ok: false; why: string }`

## packages/content/src/components.ts

- **CONTENT_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **CONTENT_WORKFLOWS** (const) `import("@wren/core/workflows").Workflow[]`
- **ClientPlannerSettings** (type) `type ClientPlannerSettings = z.infer<typeof clientPlannerSchema>;`
- **POSTS_UNIT** (const) `"posts"`
- **SOCIAL_UNIT** (const) `"social"`
- **clientPlannerSchema** (const) `z.ZodObject<{ about: z.ZodOptional<z.ZodString>; voice: z.ZodOptional<z.ZodString>; platforms: z.ZodOptional<z.ZodArray<z.ZodEnum<{ reddit: "reddit"; linkedin: "linkedin"; }>>>; draft: z.ZodDefault<z.ZodBoolean>; }, z.core.$strip>`

## packages/content/src/connect/access.ts

- **PlatformView** (interface) `interface PlatformView { platform: SocialPlatform; label: string; state: SocialStateName; blocking: string | null; today: string | null; selfServe: string; forYou: string; dms: boolean; comments: boolean; connections: ConnectionView[]; may: { connect: boolean }; }`
- **SOCIAL_FACT** (const) `"social.connected"`
- **SocialAccessApi** (type) `type SocialAccessApi = ReturnType<typeof socialAccess>;`
- **callbackUrl** (function) `(origin: string, platform: SocialPlatform): string`
- **connectionIdOf** (function) `(login: string | null | undefined): number | null`
- **liveConnections** (function) `(main: Queryable, client: string): Promise<SocialConnectionRow[]>`
- **loginOf** (function) `(id: number): string`
- **platformStates** (function) `(conns: readonly SocialConnectionRow[], o: { apps: SocialApps; live: ReadonlySet<SocialPlatform>; ready: boolean; now: Date }): PlatformView[]`
- **socialAccess** (function) `(deps: SocialDeps): { connection: (id: number) => Promise<{ id: number; client: string; platform: "linkedin" | "youtube" | "linkedin_page" | "x" | "tiktok" | "instagram" | "google_business" | "facebook"; accountId: number; externalId: string; name: string | null; handle: string | null; scopes: string; tokenRef: string;…`
- **socialAppsFrom** (function) `(keys: KeyStore | null, env: Record<string, string | undefined> = {}): () => Promise<SocialApps>`
- **tokenName** (function) `(platform: SocialPlatform, externalId: string): string`

## packages/content/src/connect/app-reviews.ts

- **Check** (interface) `interface Check { need: string; ok: boolean; detail: string; }`
- **CheckDeps** (interface) `interface CheckDeps { fetch: (url: string) => Promise<{ status: number; text: () => Promise<string> }>; hasKey: (name: string) => boolean | null; icon: () => Promise<Uint8Array | null>; }`
- **DELETION** (const) `"https://wrenautomation.com/data-deletion"`
- **ICON** (const) `"deploy/reviews/app-icon-1024.png"`
- **Need** (type) `type Need = | { kind: "page"; url: string; has: readonly string[]; why: string } | { kind: "callback"; url: string } | { kind: "key"; name: string } | { kind: "icon" };`
- **PORTAL** (const) `"https://app.wrenautomation.com"`
- **PRIVACY** (const) `"https://wrenautomation.com/privacy"`
- **REVIEWS** (const) `readonly Review[]`
- **Review** (interface) `interface Review { id: string; name: string; app: SocialApp | "meta-business" | "whatsapp" | "mail-google" | "mail-microsoft" | "reddit"; unlocks: readonly SocialPlatform[]; where: string; after: readonly string[]; needs: readonly Need[]; fields: readonly (readonly [string, string])[]; scopes: readonly (readonly [string, string])[]; video: readonly string[]; open: readonly string[]; }`
- **SITE** (const) `"https://wrenautomation.com"`
- **TERMS** (const) `"https://wrenautomation.com/terms"`
- **callbackOf** (function) `(p: SocialPlatform): string`
- **checkReview** (function) `(r: Review, deps: CheckDeps): Promise<Check[]>`
- **packetOf** (function) `(r: Review, checks: readonly Check[] | null, state: string | null = null): string`
- **reviewOf** (function) `(id: string): Review | null`

## packages/content/src/connect/business.ts

- **businessProfileContent** (function) `(sites: SiteClient, o: BusinessProfileOptions): ContentChannel`
- **reviewText** (function) `(r: Pick<Review, "starRating" | "comment">): string`

## packages/content/src/connect/console-routes.ts

- **SOCIAL_ACCESS_APPS** (const) `{ readonly "*": "account"; }`
- **SOCIAL_ACCESS_ROUTES** (const) `{ readonly social: "read"; readonly connect: "act"; readonly check: "act"; readonly disconnect: "act"; readonly ownCheck: "act"; }`
- **SOCIAL_ACCESS_WRITES** (const) `readonly (keyof typeof SOCIAL_ACCESS_ROUTES)[]`

## packages/content/src/connect/console.ts

- **SocialPageView** (type) `type SocialPageView = Awaited<ReturnType<ReturnType<typeof socialConsoleApi>["social"]>>;`
- **makeSocialAccess** (function) `(deps: SocialConsoleDeps): restate.ServiceDefinition<"SocialAccess", { social: (_: restate.Context, req: PortalRequest) => Promise<{ owner: { id: null; name: string; }; wren: true; mayAct: boolean; own: OwnView | null; } | { platforms: import("./access.js").PlatformView[]; apps: Record<import("./platforms.js").SocialApp, bool…`
- **makeSocialCallback** (function) `(deps: SocialConsoleDeps): restate.ServiceDefinition<"SocialCallback", { land: (ctx: restate.Context, q: z.infer<typeof SOCIAL_LANDING>) => Promise<{ ok: boolean; said: string; }>; }>`
- **socialConsoleApi** (function) `(deps: SocialConsoleDeps): { social(req: PortalRequest): Promise<{ owner: { id: null; name: string; }; wren: true; mayAct: boolean; own: OwnView | null; } | { platforms: import("./access.js").PlatformView[]; apps: Record<import("./platforms.js").SocialApp, boolean>; owner: { id: string; name: string; }; wren: false; mayAct: b…`

## packages/content/src/connect/dms.ts

- **DmAccount** (type) `type DmAccount = Pick< SocialConnectionRow, "id" | "platform" | "externalId" | "handle" | "name" | "extra" >;`
- **DmPlan** (interface) `interface DmPlan { contactId: number; platform: DmSocial; connection: number; to: string; handle: string; url: string | null; body: string; messageId: number; }`
- **dmPlanOf** (function) `(db: Queryable, messageId: number): Promise<DmPlan>`
- **dropDm** (function) `(db: Queryable, messageId: number, why: string): Promise<void>`
- **failedDm** (function) `(db: Queryable, messageId: number, why: string): Promise<void>`
- **isDmSocial** (function) `(p: string): p is DmSocial`
- **keepDms** (function) `(db: Queryable, c: DmAccount, threads: readonly DmThread[]): Promise<{ threads: number; messages: number }>`
- **planDm** (function) `(db: Queryable, o: { contactId: number; body: string; now: Date; live: (id: number) => Promise<boolean> }): Promise<DmPlan>`
- **profileOf** (function) `(c: ReachContact): DmProfile | null`
- **readDms** (function) `(sites: SiteClient, c: DmAccount): Promise<DmThread[]>`
- **sendDm** (function) `(sites: SiteClient, plan: DmPlan, pageId: string | null): Promise<{ ref: string | null }>`
- **sentDm** (function) `(db: Queryable, plan: DmPlan, o: { ref: string | null; now: Date; by: string }): Promise<void>`
- **unknownDm** (function) `(db: Queryable, messageId: number, why: string): Promise<void>`

## packages/content/src/connect/oauth.ts

- **Landed** (interface) `interface Landed { externalId: string; name: string | null; handle: string | null; scopes: string[]; stored: StoredToken; access: string; accessFor: number; expiresAt: Date | null; extra: SocialExtra; }`
- **SocialAppKeys** (interface) `interface SocialAppKeys { id: string; secret: string; }`
- **StoredToken** (type) `type StoredToken = | { kind: "refresh"; refresh: string } | { kind: "access"; access: string; expiresAt: string } | { kind: "page"; page: string };`
- **connectUrl** (function) `(platform: SocialPlatform, app: SocialAppKeys, o: { redirect: string; state: string; verifier: string | null }): string`
- **landCode** (function) `(fetch: FetchLike, platform: SocialPlatform, app: SocialAppKeys, o: { code: string; redirect: string; verifier: string | null; now: Date }): Promise<Landed>`
- **refreshToken** (function) `(fetch: FetchLike, platform: SocialPlatform, app: SocialAppKeys, kept: StoredToken, now: Date): Promise<{ access: string; expiresIn: number; stored: StoredToken | null }>`
- **whoAmI** (function) `(fetch: FetchLike, platform: SocialPlatform, access: string, extra: SocialExtra): Promise<{ externalId: string; name: string | null; handle: string | null; extra?: import("@wrenautomation/autobrowse/oauth").SocialExtra; }>`

## packages/content/src/connect/own.ts

- **OwnCheck** (interface) `interface OwnCheck { platform: Platform; at: string; ok: boolean | null; said: string; ms: number | null; authed: boolean | null; routes: { api: number; browser: number; none: number } | null; lapses: string | null; handle: string | null; }`
- **OwnRows** (interface) `interface OwnRows { posts: Array<{ platform: string; at: Date | null; url: string | null }>; failures: Array<{ platform: string | null; at: Date; kind: string; note: string | null }>; days: Array<{ platform: string; raw: unknown }>; renewals: Array<{ at: Date; finishedAt: Date | null; stats: unknown }>; }`
- **OwnSites** (interface) `interface OwnSites { status(where: OwnWhere, site: string): Promise<OwnSiteRow>; read( where: OwnWhere, site: string, path: string, input: Record<string, unknown>, account: string | null, ): Promise<unknown>; renewDry(where: OwnWhere): Promise<OwnRenewDry | null>; now(): Promise<number>; }`
- **OwnSwitches** (interface) `interface OwnSwitches { channels: readonly Platform[]; tiktokPostVia: "web" | "api"; instagramGraph: boolean; redditApi: boolean; box: boolean; }`
- **OwnView** (interface) `interface OwnView { channels: OwnChannelView[]; off: string[]; renewal: { at: string; ok: boolean; why: string | null; next: string | null } | null; }`
- **checkOwn** (function) `(sites: OwnSites, c: OwnChannel): Promise<OwnCheck>`
- **handleFromUrl** (function) `(url: string | null | undefined): string | null`
- **handleOf** (function) `(raw: unknown, depth = 0): string | null`
- **ownChannels** (function) `(s: OwnSwitches): OwnChannel[]`
- **ownSwitchesOf** (function) `(s: OwnSettings): OwnSwitches`
- **ownView** (function) `(channels: readonly OwnChannel[], rows: OwnRows, every: readonly Platform[]): OwnView`
- **plainFailure** (function) `(text: string | null | undefined): string`
- **readOwnRows** (function) `(db: Queryable, platforms: readonly Platform[]): Promise<OwnRows>`
- **renewalLine** (function) `(line: string): { site: string; ok: boolean | null; lapses: string | null; why: string | null } | null`
- **restateOwnSites** (function) `(ctx: restate.Context, box: SitesHost): OwnSites`
- **scrub** (function) `(text: string): string`

## packages/content/src/connect/platforms.ts

- **APP_NAMES** (const) `Record<SocialApp, string>`
- **SOCIAL** (const) `Record<SocialPlatform, SocialSpec>`
- **SOCIAL_APPS** (const) `readonly ["meta", "linkedin", "linkedin_pages", "google", "x", "tiktok"]`
- **SOCIAL_PLATFORMS** (const) `readonly ["facebook", "instagram", "linkedin", "linkedin_page", "youtube", "x", "tiktok", "google_business"]`
- **SocialApp** (type) `type SocialApp = (typeof SOCIAL_APPS)[number];`
- **SocialPlatform** (type) `type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];`
- **appKey** (function) `(app: SocialApp, part: "ID" | "SECRET"): string`
- **channelOf** (function) `(p: SocialPlatform): SocialChannel`
- **liveFrom** (function) `(list: string | null | undefined): ReadonlySet<SocialPlatform>`

## packages/content/src/connect/review-log.ts

- **RECHECK_DAYS** (const) `7`
- **ReviewView** (interface) `interface ReviewView extends AccessReviewRow { title: string; last: AccessReviewEventRow | null; }`
- **listReviews** (function) `(db: Db, client?: string): Promise<ReviewView[]>`
- **logReview** (function) `(db: Db, s: ReviewStep): Promise<AccessReviewRow>`
- **reviewHistory** (function) `(db: Db, client: string, kind: string): Promise<{ review: AccessReviewRow; events: AccessReviewEventRow[] } | null>`
- **stateAfter** (function) `(state: ReviewState, event: ReviewEvent): ReviewState`

## packages/content/src/connect/reviews-schema.ts

- **AccessReviewEventRow** (type) `type AccessReviewEventRow = typeof accessReviewEvents.$inferSelect;`
- **AccessReviewRow** (type) `type AccessReviewRow = typeof accessReviews.$inferSelect;`
- **REVIEW_EVENTS** (const) `readonly ["filed", "more_info", "answered", "refused", "passed", "withdrawn", "note", "checked"]`
- **REVIEW_STATES** (const) `readonly ["draft", "filed", "more_info", "refused", "passed", "withdrawn"]`
- **ReviewEvent** (type) `type ReviewEvent = (typeof REVIEW_EVENTS)[number];`
- **ReviewState** (type) `type ReviewState = (typeof REVIEW_STATES)[number];`
- **accessReviewEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "access_review_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "access_review_events"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; has…`
- **accessReviews** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "access_reviews"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "access_reviews"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: tru…`

## packages/content/src/connect/schema.ts

- **SOCIAL_STATES** (const) `readonly ["connected", "broken"]`
- **SocialConnectionRow** (type) `type SocialConnectionRow = typeof socialConnections.$inferSelect;`
- **SocialExtra** (interface) `interface SocialExtra { pageId?: string; pageName?: string; igUserId?: string; orgUrn?: string; location?: string; avatarUrl?: string; }`
- **SocialGrantRow** (type) `type SocialGrantRow = typeof socialGrants.$inferSelect;`
- **SocialState** (type) `type SocialState = (typeof SOCIAL_STATES)[number];`
- **socialConnections** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_connections"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "social_connections"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefa…`
- **socialGrants** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_grants"; schema: undefined; columns: { state: import("drizzle-orm/pg-core").PgColumn<{ name: "state"; tableName: "social_grants"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault…`

## packages/content/src/connect/setups.ts

- **SOCIAL_SETUP** (const) `import("@wren/core/setup").Setup`
- **SOCIAL_SETUPS** (const) `import("@wren/core/setup").Setup[]`
- **socialChecks** (function) `(o: { main: Queryable; access: SocialAccessApi; }): Record<string, SetupCheck>`

## packages/content/src/connect/sites.ts

- **TIKTOK_CHUNK** (const) `number`
- **X_CHUNK** (const) `number`
- **socialSites** (function) `(deps: SocialSitesDeps): SiteClient`

## packages/content/src/connect/tiktok-numbers.ts

- **TIKTOK_RECENT** (const) `5`
- **TikTokNumbers** (interface) `interface TikTokNumbers { followers: number | null; likes: number | null; videos: number | null; recent: TikTokVideoLine[]; gaps: string[]; asOf: string; }`
- **tiktokNumbers** (function) `(sites: SiteClient, c: Pick<SocialConnectionRow, "id" | "scopes">, o: { now: Date; ms?: number } = { now: new Date() }): Promise<TikTokNumbers>`
- **videoLine** (function) `(v: Json): TikTokVideoLine`

## packages/content/src/costs.ts

- **draftCosts** (function) `(db: Queryable, now: Date, days = 30): Promise<CostRow[]>`
- **formatCosts** (function) `(rows: readonly CostRow[]): string[]`

## packages/content/src/draft-ask.ts

- **ASK_MESSAGE_MAX** (const) `2000`
- **DRAFT_ASK_REF** (const) `{ readonly system: "content"; readonly name: "draft-ask"; }`
- **DRAFT_TYPES** (const) `readonly ["post", "comment", "thread", "dm", "invite", "onpost"]`
- **DraftItem** (interface) `interface DraftItem { what: string; platform?: string; title: string; draft: string | null; max: number; open: boolean; context: string; guide: string; edits?: string; about?: string; examples?: string; }`
- **DraftType** (type) `type DraftType = (typeof DRAFT_TYPES)[number];`
- **Waiting** (interface) `interface Waiting { item: string; type: DraftType; title: string; draft: string | null; at: Date; }`
- **askPrompt** (function) `(d: DraftItem, ask: { by: string; message: string }, prompt: Pick<LiveTemplate, "template"> = { template: draftAskDefault() }): { question: string; system: string } | { error: string }`
- **draftAskDefault** (function) `(): import("@wren/core/slots").Template`
- **itemOf** (function) `(item: string): { record: string; id: string; kind: DraftKind }`
- **listEdits** (function) `(db: Queryable, o: { type?: DraftType; limit?: number } = {}): Promise<import("@wren/core/ask").DraftEdit[]>`
- **listWaiting** (function) `(db: Queryable, o: { type?: DraftType; limit?: number } = {}): Promise<Waiting[]>`
- **readDraft** (function) `(db: Queryable, item: string): Promise<{ edits: string; examples: string; what: string; platform?: string; title: string; draft: string | null; max: number; open: boolean; context: string; guide: string; about?: string; }>`
- **undoDraft** (function) `(db: Queryable, item: string, by: string): Promise<{ run: string; before: string | null; turn: import("@wren/core/ask").DraftTurn | null; version: string | null; }>`
- **writeDraft** (function) `(db: Queryable, item: string, text: string | null, o: { command: DraftCommand; by: string; expect?: string | null; argv?: object; run?: string; stats?: object; ask?: string; llm?: Record<string, unknown>; }): Promise<{ run: string; before: string | null; turn: import("@wren/core/ask").DraftTurn | null; version: string | null; }>`

## packages/content/src/draft-calls.ts

- **DRAFT_CALLS** (const) `{ readonly "ContentDesk/approve": "ids"; readonly "ContentDesk/reject": "ids"; readonly "ContentDesk/redraft": "draftId"; readonly "ContentDesk/check": "draftId"; readonly "ContentDesk/fields": "draftId"; readonly "ContentDesk/funnel": "draftId"; readonly "ContentDesk/attach": "draftId"; readonly "D…`

## packages/content/src/draft.ts

- **DRAFT_STAGE** (const) `"content_draft"`
- **DraftOptions** (interface) `interface DraftOptions { by?: string | null; voice?: string; brand?: Brand; tracer?: Tracer | null; runId?: string | null; again?: boolean; facts?: readonly string[]; }`
- **DraftResult** (type) `type DraftResult = | { platform: Platform; ok: true; draft: ContentDraft } | { platform: Platform; ok: false; reason: string };`
- **Proposal** (type) `type Proposal = z.infer<typeof proposal>;`
- **askGuarded** (function) `(db: Queryable, llm: LlmClient, prompt: string, own: readonly string[], o: Pick<DraftOptions, "runId" | "tracer" | "facts"> & { item: string; metadata: Record<string, unknown>; }): Promise<{ outcome: Outcome<Proposal>; why: string | null }>`
- **draftIdea** (function) `(db: Queryable, llm: LlmClient, idea: ContentIdea, platforms: readonly Platform[], o: DraftOptions = {}): Promise<DraftResult[]>`
- **draftPrompt** (function) `(idea: Pick<ContentIdea, "text" | "media">, spec: PlatformSpec, o: { voice: string; brand: Brand; lessons?: Lessons; playbook?: Pick<ContentPlaybook, "text"> | null; standard?: KindStandard | null; facts?: readonly string[]; }): string`
- **keepGenerated** (function) `(db: Queryable, llm: LlmClient, d: ContentDraft, outcome: Outcome<unknown>, o: { ask?: string; by: string | null | undefined }): Promise<void>`
- **redraft** (function) `(db: Queryable, llm: LlmClient, previous: ContentDraft, idea: Pick<ContentIdea, "text" | "media">, note: string, o: Omit<DraftOptions, "again"> = {}): Promise<DraftResult>`
- **redraftPrompt** (function) `(idea: Pick<ContentIdea, "text" | "media">, spec: PlatformSpec, previous: { text: string; title: string | null }, note: string, o: { voice: string; brand: Brand; lessons?: Lessons; playbook?: Pick<ContentPlaybook, "text"> | null; standard?: KindStandard | null; facts?: readonly string[]; }): string`
- **unfitProposal** (function) `(spec: PlatformSpec, p: Proposal): string | null`

## packages/content/src/film-check.ts

- **FILM_MAX_S** (const) `180`
- **FilmCheck** (type) `type FilmCheck = PieceCheck & { sop: string | null };`
- **cutTimeline** (function) `(e: Pick<VideoEdit, "cuts" | "tracks">): { durationS: number; cuts: number[]; }`
- **filmCheck** (function) `(db: Queryable, e: Pick<VideoEdit, "cuts" | "tracks" | "words">): Promise<FilmCheck | null>`

## packages/content/src/funnel.ts

- **FunnelContext** (interface) `interface FunnelContext { video: FunnelVideo | null; page?: FunnelPage | null; place: { name: string; links: boolean } | null; client: boolean; }`
- **FunnelPage** (interface) `interface FunnelPage { id: string; title: string; slug: string; live: boolean; }`
- **FunnelPatch** (interface) `interface FunnelPatch { stage?: FunnelStage; to?: FunnelTarget; video?: string | null; page?: string | null; linked?: boolean | null; }`
- **FunnelVideo** (interface) `interface FunnelVideo { id: string; title: string | null; url: string | null; status: DraftStatus; }`
- **FunnelView** (interface) `interface FunnelView { stage: FunnelStage; to: FunnelTarget; video: FunnelVideo | null; page: FunnelPage | null; linked: boolean; chosen: boolean; allowed: boolean; link: string | null; posts: string | null; comment: string | null; note: string | null; }`
- **WREN_SITE** (const) `"https://wrenautomation.com"`
- **funnelLine** (function) `(f: Pick<FunnelView, "stage" | "to" | "posts" | "comment" | "note">): string`
- **funnelOf** (function) `(d: FunnelRow, ctx: FunnelContext): FunnelView`
- **linkRule** (function) `(d: Pick<FunnelRow, "platform" | "extra" | "pointsTo">, place: FunnelContext["place"]): { allowed: boolean; on: boolean; why: string | null }`
- **pickablePages** (function) `(db: Queryable): Promise<FunnelPage[]>`
- **postedLink** (function) `(db: Queryable, d: FunnelRow): Promise<string | null>`
- **postedLinks** (function) `(db: Queryable, d: FunnelRow): Promise<{ text: string | null; comment: string | null }>`
- **readFunnel** (function) `(db: Queryable, d: FunnelRow): Promise<FunnelView>`
- **refuseUnlinked** (function) `(db: Queryable, rows: readonly FunnelRow[]): Promise<void>`
- **setFunnel** (function) `(db: Queryable, id: string, patch: FunnelPatch, who?: { by: string }): Promise<ContentDraft>`
- **targetLink** (function) `(d: FunnelRow, video: FunnelVideo | null, client = false, page: FunnelPage | null = null): string | null`
- **youtubeId** (function) `(url: string): string | null`

## packages/content/src/ideas.ts

- **IdeaMark** (interface) `interface IdeaMark { line?: string | null; angle?: IdeaAngle | null; }`
- **addIdea** (function) `(db: Queryable, text: string, source: IdeaSource, media: Media | null = null, ref: string | null = null, mark: IdeaMark = {}): Promise<ContentIdea>`
- **addIdeaOnce** (function) `(db: Queryable, text: string, source: IdeaSource, ref: string): Promise<ContentIdea | null>`
- **getIdea** (function) `(db: Queryable, id: string): Promise<ContentIdea>`
- **listIdeas** (function) `(db: Queryable, status: IdeaStatus, limit = 50): Promise<ContentIdea[]>`

## packages/content/src/inbox/conversation.ts

- **Conversation** (type) `type Conversation = NonNullable<Awaited<ReturnType<typeof conversationOf>>>;`
- **Entry** (interface) `interface Entry { id: string; at: string; channel: EntryChannel; direction: "in" | "out" | "note"; platform: string | null; who: string | null; body: string; subject?: string | null; state?: string | null; mentions?: string[]; start?: string; }`
- **ReplyOption** (interface) `interface ReplyOption { channel: InboxChannel; target: string; label: string; platform: string | null; own: boolean; off: string | null; fix?: "social" | "mail" | null; from?: string | null; copy?: string | null; }`
- **conversationOf** (function) `(db: Queryable, thread: string): Promise<{ thread: string; who: string | null; personId: number | null; entries: Entry[]; options: ReplyOption[]; } | null>`
- **optionsOf** (function) `(db: Queryable, p: Party): Promise<ReplyOption[]>`
- **partyOf** (function) `(db: Queryable, thread: string): Promise<Party | null>`
- **threadChannelOf** (function) `(db: Queryable, thread: string): Promise<string | null>`
- **timelineOf** (function) `(db: Queryable, p: Party): Promise<Entry[]>`

## packages/content/src/inbox/mail-reply.ts

- **MailPlan** (interface) `interface MailPlan { sentId: number; mailbox: string; to: ReplyTo; ours: string; }`
- **MailReplyRefusal** (class) `override name`
- **failedMailReply** (function) `(db: Queryable, id: number, why: string): Promise<void>`
- **planMailReply** (function) `(db: Queryable, o: { mailId: number; body: string; ours: (mailbox: string) => string; by: string }): Promise<MailPlan>`
- **sentMailReply** (function) `(db: Queryable, id: number, o: { providerId: string | null; now: Date }): Promise<void>`

## packages/content/src/inbox/routes.ts

- **AccountState** (interface) `interface AccountState { platform: string; state: string; }`
- **MailboxState** (interface) `interface MailboxState { address: string; state: string; }`
- **Routes** (interface) `interface Routes { accounts: readonly AccountState[]; mailboxes: readonly MailboxState[]; }`
- **Shut** (interface) `interface Shut { off: string; fix: "social" | "mail" | null; }`
- **clientAccounts** (function) `(main: Queryable, client: string): Promise<AccountState[]>`
- **clientRoute** (function) `(channel: InboxChannel, platform: string | null, accounts: readonly AccountState[]): Shut | null`
- **clientRoutes** (function) `(main: Queryable, client: string): Promise<Routes>`
- **mailRoute** (function) `(from: string, mailboxes: readonly MailboxState[]): Shut | null`
- **routeOf** (function) `(o: ReplyOption, r: Routes): Shut | null`
- **withRoutes** (function) `(options: readonly ReplyOption[], r: Routes): ReplyOption[]`

## packages/content/src/inbox/send.ts

- **Copied** (interface) `interface Copied { text: string; url: string; }`
- **Gate** (interface) `interface Gate { mode: "send" | "ask"; why: string | null; }`
- **HeldReply** (class) `constructor(message: string, readonly until: Date)`
- **MAIL_PART** (const) `"mail.triage"`
- **QUEUED_WHY** (const) `"Held by the frequency cap. They are at their limit for now."`
- **REPLY_MAX** (const) `4000`
- **ReplySender** (interface) `interface ReplySender { dm(contactId: number, body: string): Promise<void>; text(contactId: number, body: string): Promise<void>; comment(commentId: number, body: string): Promise<void>; invite(inviteId: number, body: string): Promise<void>; email(threadEventId: number, body: string): Promise<void>; thread(enrollmentId: number, body: string, campaign?: string | null): Promise<void>; mail(mailId: number, body: string): Promise<void>; chat(threadId: number, body: string): Promise<void>; posted(commentId: number, body: string): Promise<void>; }`
- **accessChannel** (function) `(channel: InboxChannel, platform: string | null): string | null`
- **askFollowEmail** (function) `(db: Queryable, o: { subject: string; enrollmentId: number; body: string; by: string; why: string }): Promise<{ asked: boolean; why: string | null }>`
- **askReply** (function) `(db: Queryable, o: { thread: string; option: ReplyOption; body: string; who: string | null; by: string; why: string | null; }): Promise<InboxReply>`
- **campaignOfAsker** (function) `(askedBy: string): string | null`
- **copiedOf** (function) `(option: ReplyOption, body: string): Copied | null`
- **failReply** (function) `(db: Queryable, id: number, detail: string): Promise<void>`
- **mayWork** (function) `(who: Who, client: string, channel: string | null): boolean`
- **partOf** (function) `(o: Pick<ReplyOption, "channel" | "from">): string`
- **pickOption** (function) `(db: Queryable, thread: string, channel: InboxChannel, target: string): Promise<ReplyOption>`
- **queueReply** (function) `(db: Queryable, id: number, until: Date): Promise<void>`
- **queuedReplies** (function) `(db: Queryable, limit = 500): Omit<import("drizzle-orm/pg-core").PgSelectBase<"inbox_replies", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "inbox_replies"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement…`
- **releaseReply** (function) `(db: Queryable, id: number): Promise<InboxReply | null>`
- **replyGate** (function) `(o: { channel: InboxChannel; platform?: string | null; part?: string; client: Pick<Client, "id" | "sends" | "approver"> | null; who: Who; }): Gate`
- **replyWords** (function) `(body: unknown): string`
- **sendOn** (function) `(sender: ReplySender, option: ReplyOption, body: string, campaign: string | null = null): Promise<void>`
- **settleReply** (function) `(db: Queryable, id: number, state: "sent" | "dropped" | "failed", by: string, detail: string | null = null, now = new Date()): Promise<boolean>`
- **waitingReplies** (function) `(db: Queryable, limit = 500): Omit<import("drizzle-orm/pg-core").PgSelectBase<"inbox_replies", { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "inbox_replies"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement…`
- **waitingReply** (function) `(db: Queryable, id: number): Promise<InboxReply>`

## packages/content/src/inbox/suggest.ts

- **suggestReply** (function) `(db: Queryable, deps: SuggestDeps, o: { thread: string; channel: InboxChannel; target: string; now: Date }): Promise<string | null>`

## packages/content/src/inbox/threads.ts

- **setThread** (function) `(db: Queryable, thread: string, change: ThreadChange, by: string, now = new Date()): Promise<InboxThread>`
- **statusOf** (function) `(row: { state: unknown; at: unknown }, kept: Pick<InboxThread, "status" | "statusAt" | "snoozeUntil"> | undefined, now: Date): ThreadStatus`
- **threadStates** (function) `(db: Queryable): Promise<Map<string, InboxThread>>`
- **typed** (function) `(id: string): readonly [string, string]`

## packages/content/src/learn-back.ts

- **LearnBack** (interface) `interface LearnBack { pieces: number; saved: number; broken: number; checks: CheckRow[]; }`
- **kindOfPost** (function) `(r: Pick<Row, "format" | "hook" | "avg_view_pct" | "avg_view_secs">): ItemKind | null`
- **learnBack** (function) `(db: Db, o: { client: string; sop: string; scope: SopScope; read: VideoReader; judge: JudgeFor; say?: (line: string) => void; }): Promise<LearnBack>`
- **ourPieces** (function) `(db: Queryable, scope: SopScope): Promise<OurPiece[]>`
- **outcomeOf** (function) `(kind: ItemKind, r: Pick<Row, "hook" | "avg_view_pct" | "score">): number | null`

## packages/content/src/lessons.ts

- **Lessons** (interface) `interface Lessons { notes: string[]; winners: { text: string; views: number; score: number }[]; digest?: string[]; }`
- **NO_LESSONS** (const) `Lessons`
- **lessonsBlock** (function) `(l: Lessons): string`
- **lessonsFor** (function) `(db: Queryable, platform: Platform): Promise<Lessons>`

## packages/content/src/library.ts

- **mediaRecord** (function) `(signer?: VideoSigner): import("@wren/core/records").RecordType`
- **sopRecord** (const) `import("@wren/core/records").RecordType`

## packages/content/src/media.ts

- **AWS_LOGIN_HINT** (const) `"run aws-login (cd autobrowse && pnpm -s autobrowse aws-login --user william)"`
- **MediaStoreOptions** (interface) `interface MediaStoreOptions { bucket: string; region?: string; client?: S3Client; }`
- **checkMediaStore** (function) `(o: MediaStoreOptions): Promise<void>`
- **getKey** (function) `(key: string, path: string, o: MediaStoreOptions): Promise<void>`
- **parseStored** (function) `(source: string): { bucket: string; key: string } | null`
- **putKey** (function) `(path: string, key: string, o: MediaStoreOptions): Promise<string>`
- **putMedia** (function) `(bytes: Uint8Array, ext: string, o: MediaStoreOptions): Promise<string>`
- **s3MediaHost** (function) `(o: MediaStoreOptions & { expiresSeconds?: number }): MediaHost`
- **uploadMedia** (function) `(path: string, o: MediaStoreOptions): Promise<string>`

## packages/content/src/metrics.ts

- **WorkedRow** (interface) `interface WorkedRow { draftId: string; platform: ContentDraft["platform"]; ideaId: string; text: string; url: string | null; publishedAt: Date; views: number; reactions: number; comments: number; shares: number; asOf: Date; score: number; looks: number; }`
- **formatWhatWorked** (function) `(rows: readonly WorkedRow[]): string[]`
- **metricsDue** (function) `(db: Queryable, now: Date, o: { watchDays?: number; lookEveryMs?: number; limit?: number } = {}): Promise<ContentDraft[]>`
- **recordMetrics** (function) `(db: Queryable, draftId: string, m: Metrics): Promise<ContentMetric>`
- **scoreOf** (function) `(m: { views: number; reactions: number; comments: number; shares: number; }): number`
- **whatWorked** (function) `(db: Queryable, now: Date, o: { days?: number; platform?: ContentDraft["platform"] } = {}): Promise<WorkedRow[]>`

## packages/content/src/our-posts.ts

- **ourPosts** (function) `(db: Queryable): Promise<OurPost[]>`

## packages/content/src/own.ts

- **waitingIdeas** (function) `(db: Queryable, limit = 120): Promise<WaitingIdea[]>`
- **writeOwn** (function) `(db: Queryable, o: { text: string; title?: string | null; platforms: readonly Platform[]; by: string | null; source?: IdeaSource; from?: string | null; media?: Media | null; at?: Date | null; thread?: boolean; mark?: IdeaMark; }): Promise<{ idea: ContentIdea; results: DraftResult[] }>`

## packages/content/src/pieces.ts

- **Branch** (interface) `interface Branch { id: string; platform: string; format: string; state: BranchState; at: string | null; url: string | null; views: number | null; engaged: number | null; error: string | null; waitingForBrowser?: true; }`
- **DraftRow** (interface) `interface DraftRow { id: string; idea_id: string; platform: string; format: string; status: string; title: string | null; text: string; scheduled_for: string | Date | null; published_at: string | Date | null; url: string | null; error: string | null; video_draft: string | null; created_at: string | Date; views: number | null; engaged: number | null; }`
- **Piece** (interface) `interface Piece { id: string; kind: PieceKind; title: string; text: string; at: string; branches: Branch[]; children: Piece[]; video?: number; }`
- **PieceKind** (type) `type PieceKind = (typeof PIECE_KINDS)[number];`
- **PieceRows** (interface) `interface PieceRows { drafts: readonly DraftRow[]; ideas: readonly IdeaRow[]; videos: readonly VideoRow[]; blogs: readonly Pick< BlogRow, | "slug" | "title" | "description" | "draft" | "publishedAt" | "emailedAt" | "createdAt" | "fromRef" >[]; site: string; }`
- **VideoRow** (interface) `interface VideoRow { id: number; title: string; state: string; shorts: readonly { title: string }[]; created_at: string | Date; }`
- **pieceRows** (function) `(db: Queryable, site: string, days = 120): Promise<PieceRows>`
- **piecesOf** (function) `(rows: PieceRows): Piece[]`
- **titleOf** (function) `(words: string): string`
- **waitingOf** (function) `(p: Pick<Piece, "branches">): Branch[]`

## packages/content/src/plan.ts

- **DayPlan** (interface) `interface DayPlan { day: string; platforms: PlatformPlan[]; openIdeas: number; }`
- **formatPlan** (function) `(p: DayPlan): string[]`
- **freeSlots** (function) `(instants: readonly Date[], taken: readonly Date[]): Date[]`
- **nextIdea** (function) `(db: Queryable, o: { now: Date; exclude?: readonly string[]; client?: boolean; }): Promise<NextIdea>`
- **openSlots** (function) `(db: Queryable, platforms: readonly Platform[], day: { from: Date; to: Date }, zone: string, slots: Slots = DEFAULT_SLOTS): Promise<Partial<Record<Platform, Date[]>>>`
- **planFor** (function) `(db: Queryable, platforms: readonly Platform[], day: { day: string; from: Date; to: Date }, zone: string, slots: Slots = DEFAULT_SLOTS): Promise<DayPlan>`
- **shortfallOf** (function) `(p: DayPlan): number`
- **tomorrowOf** (function) `(now: Date, zone: string): { day: string; from: Date; to: Date }`

## packages/content/src/platforms.ts

- **GONE** (const) `"That draft isn't here any more. Reload the page to see what's left."`
- **MAY_HAVE_GONE_OUT** (const) `"May have gone out"`
- **PLATFORM_SPECS** (const) `Readonly<Record<Platform, PlatformSpec>>`
- **PlatformSpec** (interface) `interface PlatformSpec { readonly platform: Platform; readonly name: string; readonly maxChars: number; readonly title?: { readonly maxChars: number }; readonly needsMedia?: "video" | "image-or-video"; readonly words?: { readonly kind: string; readonly name: string }; readonly shape: string; readonly goCode: string; readonly feed: { readonly laptop: number | null; readonly phone: number | null }; }`
- **aboutDraft** (function) `(r: { title?: string | null; text: string; platform: string }, why: string): string`
- **lockedWhy** (function) `(r: { title?: string | null; text: string; platform: string; status: string; error?: string | null; }, doing: string): string`
- **named** (function) `(r: { title?: string | null; text: string; platform: string }): string`
- **postOf** (function) `(draft: Pick<ContentDraft, "text" | "title" | "media" | "extra" | "platform">, link?: string | null): Post`
- **unfitReason** (function) `(spec: PlatformSpec, media: Media | null | undefined): string | null`
- **wordsUnfit** (function) `(d: { platform: Platform; extra?: Readonly<Record<string, unknown>> | null }, text: string): string | null`

## packages/content/src/playbook.ts

- **COMMENTS_SOP** (const) `"comments"`
- **DM_SOP** (const) `"outbound-copy"`
- **commentGuide** (function) `(db: Queryable, platform: Platform): Promise<string>`
- **dmGuide** (function) `(db: Queryable, platform: Platform): Promise<string>`
- **playbookBlock** (function) `(playbook: Pick<ContentPlaybook, "text"> | null): string`
- **playbookFor** (function) `(db: Queryable, platform: Platform): Promise<ContentPlaybook | null>`
- **postStandardFor** (function) `(db: Queryable, playbook: Pick<ContentPlaybook, "sop" | "scope"> | null, platform: Platform): Promise<KindStandard | null>`
- **pushPlaybook** (function) `(db: Queryable, p: { platform: Platform; sop: string; text: string; scope?: SopScope | null }): Promise<{ playbook: ContentPlaybook; changed: boolean }>`
- **standardBlock** (function) `(standard: KindStandard | null): string`

## packages/content/src/promo.ts

- **PROMO_PIECES** (const) `readonly ["posts", "thread", "carousel"]`
- **PROMO_PLATFORMS** (const) `readonly ["linkedin", "x", "reddit", "instagram"]`
- **PromoPiece** (type) `type PromoPiece = (typeof PROMO_PIECES)[number];`
- **PromoPlatform** (type) `type PromoPlatform = (typeof PROMO_PLATFORMS)[number];`
- **RECORDED** (const) `"I recorded a walkthrough video of this."`
- **draftCarousel** (function) `(db: Queryable, llm: LlmClient, base: PromoBase, o: DraftOptions = {}): Promise<DraftResult[]>`
- **draftPromo** (function) `(db: Queryable, llm: LlmClient, base: PromoBase, platform: PromoPlatform, o: DraftOptions = {}): Promise<DraftResult>`
- **draftThread** (function) `(db: Queryable, llm: LlmClient, base: PromoBase, o: DraftOptions = {}): Promise<DraftResult>`
- **liveOf** (function) `(db: Queryable, ideaId: string): Promise<Map<string, string>>`
- **promoBase** (function) `(db: Queryable, videoDraft: string): Promise<PromoBase>`
- **promosOf** (function) `(db: Queryable, videoDraft: string): Promise<PromoRow[]>`
- **promotable** (function) `(db: Queryable, videoDraft: string): Promise<{ id: string; title: string | null; text: string; status: "draft" | "approved" | "rejected" | "failed" | "published" | "publishing"; url: string | null; platform: Platform; extra: Record<string, unknown>; ref: string | null; }>`
- **promoteVideo** (function) `(db: Queryable, llm: LlmClient, videoDraft: string, platforms: readonly PromoPlatform[] = PROMO_PLATFORMS, o: DraftOptions & { pieces?: readonly PromoPiece[] } = {}): Promise<{ ideaId: string; results: DraftResult[] }>`
- **videoDraftOf** (function) `(db: Queryable, video: number): Promise<string>`

## packages/content/src/queue.ts

- **claim** (function) `(db: Queryable, id: string): Promise<ContentDraft | null>`
- **dropDraft** (function) `(db: Queryable, id: string, by: string): Promise<ContentDraft | null>`
- **dueDrafts** (function) `(db: Queryable, now: Date, limit = 20): Promise<ContentDraft[]>`
- **markCapped** (function) `(db: Queryable, id: string, until: Date, why: string): Promise<void>`
- **markFailed** (function) `(db: Queryable, id: string, error: string): Promise<void>`
- **markPostedBy** (function) `(db: Queryable, id: string, o: { by: string; at: Date }): Promise<void>`
- **markPublished** (function) `(db: Queryable, id: string, published: Published, link?: string | null, by = "scheduler"): Promise<void>`
- **markUnsure** (function) `(db: Queryable, id: string, why: string): Promise<void>`
- **markWaiting** (function) `(db: Queryable, id: string, why: string): Promise<void>`
- **nextDue** (function) `(db: Queryable, now: Date): Promise<string | null>`
- **noteOnDraft** (function) `(db: Queryable, id: string, note: string): Promise<void>`
- **sendAgain** (function) `(db: Queryable, id: string): Promise<ContentDraft | null>`
- **waitingForBrowser** (function) `(d: { status: string; error: string | null }): boolean`

## packages/content/src/records.ts

- **CONTENT_RECORDS** (const) `import("@wren/core/records").RecordType[]`
- **Sibling** (interface) `interface Sibling { id: string; platform: Platform; title: string; state: DraftStatus; }`
- **contentRecords** (function) `(signer?: VideoSigner): import("@wren/core/records").RecordType[]`
- **draftRecord** (const) `import("@wren/core/records").RecordType`
- **draftRecordOf** (function) `(signer?: VideoSigner): import("@wren/core/records").RecordType`
- **postRecord** (const) `import("@wren/core/records").RecordType`
- **siblingsOf** (function) `(db: Queryable, draftId: string): Promise<Sibling[]>`

## packages/content/src/restate/auto-reply.ts

- **AutoReply** (type) `type AutoReply = ReturnType<typeof makeAutoReply>;`
- **autoReplyFire** (const) `FireTriggers`
- **autoReplyReviews** (function) `(ctx: restate.Context, client: string | null, ids: readonly number[]): void`
- **makeAutoReply** (function) `(deps: AutoReplyDeps): restate.VirtualObjectDefinition<"AutoReply", { arrived: (ctx: restate.ObjectContext<restate.UntypedState>, input: Arrived) => Promise<{ asked: number | null; why: string; }>; }>`

## packages/content/src/restate/blog.ts

- **Blog** (type) `type Blog = ReturnType<typeof makeBlog>;`
- **makeBlog** (function) `(deps: BlogDeps): restate.VirtualObjectDefinition<"Blog", { posts: (ctx: restate.ObjectSharedContext) => Promise<{ on: boolean; site: string; posts: { title: string; description: string; date: string; createdAt: Date; updatedAt: Date; body: string; draft: boolean; publishedAt: Date | null; updatedBy: string | null; s…`

## packages/content/src/restate/chat.ts

- **Chat** (type) `type Chat = ReturnType<typeof makeChat>;`
- **makeChat** (function) `(deps: ChatDeps): restate.ServiceDefinition<"Chat", { say: (ctx: restate.Context, req: Req) => Promise<Answer>; read: (_ctx: restate.Context, req: Req) => Promise<Answer>; }>`

## packages/content/src/restate/desk-context.ts

- **ContentDeskDeps** (interface) `interface ContentDeskDeps { db: Db; llm: LlmClient; platforms: readonly Platform[]; zone: string; voice?: string; brand?: Brand; tracer?: Tracer | null; media?: MediaStoreOptions; slides?: SlidePainter; clients?: { clientDb: (client: string) => Db; llm: LlmClient | null; keys?: KeyStore | null }; posted?: (ctx: restate.ObjectContext, platform: Platform, client: string | null) => void; }`
- **DraftReport** (type) `type DraftReport = { ideaId: string; results: DraftResult[]; runId: string };`
- **DraftRequest** (interface) `interface DraftRequest { ideaId: string; platforms?: Platform[]; again?: boolean; }`
- **WriteResult** (interface) `interface WriteResult { platform: Platform; draftId: string | null; text: string | null; title: string | null; reason: string | null; at?: string | null; held?: string; }`
- **clientDrafting** (function) `(main: Db, id: string): Promise<{ ok: false; why: string; } | { platforms: Platform[]; ok: true; settings: import("../components.js").ClientPlannerSettings; brand: Brand; voice: string; }>`

## packages/content/src/restate/desk-edits.ts

- **FunnelRequest** (interface) `interface FunnelRequest { draftId: string; stage?: FunnelStage | null; to?: FunnelTarget | null; video?: string | null; page?: string | null; linked?: boolean | "on" | "off" | "auto" | null; viewer?: unknown; }`
- **NOT_CONNECTED** (const) `"no login of this client's posts here yet"`
- **funnelPatch** (function) `(req: FunnelRequest): FunnelPatch`

## packages/content/src/restate/desk.ts

- **ContentDesk** (type) `type ContentDesk = ReturnType<typeof makeContentDesk>;`
- **DESK_KEY** (const) `"default"`
- **DESK_UNIT** (const) `"desk"`
- **makeContentDesk** (function) `(deps: ContentDeskDeps): restate.VirtualObjectDefinition<"ContentDesk", { fields: (ctx: restate.ObjectContext, req: { draftId: string; patch: Record<string, unknown>; viewer?: unknown; }) => Promise<{ done: string[]; saved?: import("../shape-view.js").FieldsSaved; }>; promote: (ctx: restate.ObjectContext, req: { video?: num…`

## packages/content/src/restate/draft-ask.ts

- **DRAFT_ASK** (const) `{ readonly name: "DraftAsk"; }`
- **makeDraftAsk** (function) `(db: Db): restate.ServiceDefinition<"DraftAsk", { ask: (ctx: restate.Context, req: Item & { message: string; }) => Promise<{ id: string; }>; set: (ctx: restate.Context, req: Item & { text?: string; expect?: string | null; account?: string | null; }) => Promise<{ run?: string; turn?: DraftTurn | null; version?…`

## packages/content/src/restate/inbox-desk.ts

- **InboxDesk** (type) `type InboxDesk = ReturnType<typeof makeInboxDesk>;`
- **makeInboxDesk** (function) `(deps: InboxDeskDeps): restate.ServiceDefinition<"InboxDesk", { autoReplies: (ctx: restate.Context, req: Req) => Promise<{ modes: Record<InboxChannel, AutoReplyMode>; held: boolean; }>; autoReplySet: (ctx: restate.Context, req: Req & { channel: InboxChannel; mode: AutoReplyMode; }) => Promise<{ modes: Record<InboxChannel,…`

## packages/content/src/restate/keyword-dm.ts

- **KeywordDm** (type) `type KeywordDm = ReturnType<typeof makeKeywordDm>;`
- **catchKeywordDms** (function) `(ctx: restate.Context, db: Db, client: string | null, ids: readonly number[]): Promise<number>`
- **makeKeywordDm** (function) `(deps: KeywordDmDeps): restate.ServiceDefinition<"KeywordDm", { add: (ctx: restate.Context, req: z.infer<typeof ADD>) => restate.RestatePromise<{ id: number; keyword: string; }>; remove: (ctx: restate.Context, req: { ids: unknown[]; }) => Promise<{ done: number; }>; send: (ctx: restate.Context, req: Send) => Promise<{ sta…`

## packages/content/src/restate/mail-reply.ts

- **MailReply** (type) `type MailReply = ReturnType<typeof makeMailReply>;`
- **makeMailReply** (function) `(deps: MailReplyDeps): restate.ServiceDefinition<"MailReply", { send: (ctx: restate.Context, req: { client: string; mailId: number; body: string; by?: string | null; }) => Promise<{ id: string | null; }>; }>`

## packages/content/src/restate/marketing-console.ts

- **AttachRequest** (interface) `interface AttachRequest extends PortalRequest { draftId: string; field: string; name: string; data: string; }`
- **MarketingConsoleService** (type) `type MarketingConsoleService = ReturnType<typeof makeMarketingConsole>;`
- **makeMarketingConsole** (function) `(deps: MarketingConsoleDeps): restate.ServiceDefinition<"MarketingConsole", { recordsTypes: (_: restate.Context, req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (_: restate.Context, req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (_: re…`
- **marketingConsoleApi** (function) `({ db, open, records, tiktokCreator, reportMail, zone, }: MarketingConsoleDeps): { recordsTypes: (req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (req: PortalRequest & GetAsk) => Promise<import("@wren/core/records/serve").RecordAnswer>; r…`

## packages/content/src/restate/metrics.ts

- **ContentMetrics** (type) `type ContentMetrics = ReturnType<typeof makeContentMetrics>;`
- **METRICS_KEY** (const) `"default"`
- **MetricsStats** (interface) `interface MetricsStats { looked: { id: string; platform: Platform; views: number; insights?: number; gaps?: number }[]; failed: { id: string; platform: Platform; error: string }[]; reported: boolean; reports?: Partial<Record<Platform, number | string>>; accounts?: Partial<Record<Platform, number | string>>; digest?: boolean; skipped?: number; }`
- **lookOf** (function) `(id: string, i: Insights): Metrics | null`
- **makeContentMetrics** (function) `(deps: ContentMetricsDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<MetricsStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<MetricsStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null…`
- **missWaitMs** (function) `(n: number): number`
- **weekOf** (function) `(now: Date): string`
- **withCounts** (function) `(m: Metrics, i: Insights | null): Insights`

## packages/content/src/restate/pieces.ts

- **makePieces** (function) `(deps: PiecesDeps): restate.VirtualObjectDefinition<"Pieces", { list: (ctx: restate.ObjectSharedContext) => Promise<{ pieces: import("../pieces.js").Piece[]; }>; }>`

## packages/content/src/restate/planner.ts

- **ContentPlanner** (type) `type ContentPlanner = ReturnType<typeof makeContentPlanner>;`
- **DEFAULT_PLAN_PLATFORMS** (const) `readonly Platform[]`
- **Drafted** (interface) `interface Drafted { platform: Platform; draftId: string; slot: string; source: string; }`
- **PLANNER_KEY** (const) `"default"`
- **PlannerSettings** (interface) `interface PlannerSettings { platforms?: Platform[]; draft?: boolean; approve?: boolean; slots?: Partial<Record<Platform, Slot[]>>; }`
- **PlannerStats** (type) `type PlannerStats = DayPlan & { drafted: Drafted[]; skipped: string[] };`
- **makeContentPlanner** (function) `(deps: ContentPlannerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<PlannerStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<PlannerStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null…`
- **nextRunAt** (function) `(now: Date, zone: string, hour: number): Date`
- **plannerTitle** (function) `(plan: DayPlan, drafted: readonly Drafted[]): string`

## packages/content/src/restate/reports.ts

- **makeClientReport** (function) `(deps: ReportDeps): restate.VirtualObjectDefinition<"ClientReport", { run: (ctx: restate.ObjectContext<restate.UntypedState>, input: { chain?: string; }) => Promise<{ state: "stale" | "off" | "ran" | "waiting"; nextAt: string | null; }>; }>`
- **startReport** (function) `(ctx: restate.Context, id: number): restate.InvocationHandle`

## packages/content/src/restate/scheduler.ts

- **ContentScheduler** (type) `type ContentScheduler = ReturnType<typeof makeContentScheduler>;`
- **PublishStats** (interface) `interface PublishStats { published: { id: string; platform: Platform; url: string }[]; failed: { id: string; platform: Platform; error: string }[]; remaining: number; held?: number; waiting?: { id: string; platform: Platform }[]; posting?: { id: string; platform: Platform; since: string }[]; unsure?: { id: string; platform: Platform; why: string }[]; }`
- **SCHEDULER_KEY** (const) `"default"`
- **makeContentScheduler** (function) `(deps: ContentSchedulerDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<PublishStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<PublishStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null…`

## packages/content/src/restate/social-inbox.ts

- **SocialInbox** (type) `type SocialInbox = ReturnType<typeof makeSocialInbox>;`
- **makeSocialInbox** (function) `(deps: SocialInboxDeps): restate.ServiceDefinition<"SocialInbox", { read: (ctx: restate.Context, req: { client: string; }) => Promise<{ accounts: number; threads: number; messages: number; errors: string[]; }>; send: (ctx: restate.Context, req: { client: string; contactId: number; body: string; by?: string | null; again?: b…`

## packages/content/src/restate/social-push.ts

- **Pushed** (interface) `interface Pushed { platform: Platform; kind: PushKind; post?: string; }`
- **ReachView** (interface) `interface ReachView { pushed: string[]; watched: string[]; }`
- **SocialPush** (type) `type SocialPush = ReturnType<typeof makeSocialPush>;`
- **SocialPushed** (type) `type SocialPushed = typeof socialPushed;`
- **gbpPush** (function) `(note: unknown): PushedAt | null`
- **makeSocialPush** (function) `(deps: SocialPushDeps): restate.ServiceDefinition<"SocialPush", { meta: (ctx: restate.Context, body: unknown) => Promise<PushResult>; gbp: (ctx: restate.Context, note: unknown) => Promise<PushResult>; watch: (ctx: restate.Context, w: z.infer<typeof WATCH>) => Promise<PushResult>; }>`
- **metaPushes** (function) `(body: unknown): PushedAt[]`
- **ownerOf** (function) `(db: Db, p: PushedAt, ours: { pageId?: string | null; igId?: string | null }): Promise<string | null>`
- **pushKey** (function) `(p: Pushed): string`
- **socialPushed** (const) `restate.VirtualObjectDefinition<"SocialPushed", { add: (ctx: restate.ObjectContext, pushes: Pushed[]) => Promise<number>; take: (ctx: restate.ObjectContext) => Promise<Pushed[]>; alive: (ctx: restate.ObjectContext, { platform }: { platform: string; }) => Promise<void>; reach: (ctx: restate.ObjectCon…`
- **socialWatchKey** (function) `(owner: string): string`

## packages/content/src/restate/social.ts

- **LOGIN_GAP_MS** (const) `number`
- **SITE_EVERY_MS** (const) `number`
- **SOCIAL_KEY** (const) `"wren"`
- **SocialDesk** (type) `type SocialDesk = ReturnType<typeof makeSocialDesk>;`
- **SocialStats** (interface) `interface SocialStats { posts: number; skipped: number; comments: number; reviews: number; asked: number; activity: number; following: number; sitePosts: number; ownComments: number; unfollowed: string[]; dms: number; keywordDms: number; audience: Platform[]; missed: string[]; held: string[]; slow?: number; errors: string[]; }`
- **SocialWatch** (type) `type SocialWatch = ReturnType<typeof makeSocialWatch>;`
- **makeSocialDesk** (function) `(deps: { db: Db; zone: string }): restate.ServiceDefinition<"SocialDesk", { markSeen: (ctx: restate.Context, req: { ids: number[]; }) => Promise<{ seen: number; }>; markAllSeen: (ctx: restate.Context) => Promise<{ seen: number; }>; readPost: (ctx: restate.Context, req: { id: number; }) => Promise<{ read: boolean; kept: number; }>; r…`
- **makeSocialWatch** (function) `(deps: SocialWatchDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<SocialStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<SocialStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | null) …`
- **nextPassAt** (function) `(now: Date, zone: string): Date`
- **siteReadDue** (function) `(unit: string, last: Readonly<Record<string, number>>, now: number): boolean`

## packages/content/src/restate/video-desk.ts

- **STUDIO** (const) `{ readonly name: "studio"; }`
- **makeVideoDesk** (function) `(db: Db, o: { llm?: VideoModel | null } = {}): restate.ServiceDefinition<"VideoDesk", { set: (ctx: restate.Context, req: One & { patch: unknown; expect?: Record<string, unknown>; proposal?: string; }) => Promise<{ run: string; view: import("../video.js").VideoView; }>; propose: (ctx: restate.Context, req: One & { sentence: string; beat?: string …`

## packages/content/src/review.ts

- **FAN_GAP_MS** (const) `number`
- **approveDrafts** (function) `(db: Queryable, ids: readonly string[], o: { now: Date; at?: Date | null; zone?: string; asap?: boolean; slots?: Slots; by?: string; expect?: string | null; }): Promise<ContentDraft[]>`
- **draftVersion** (function) `(text: string): string`
- **draftsOfIdea** (function) `(db: Queryable, ideaId: string): Promise<ContentDraft[]>`
- **editDraft** (function) `(db: Queryable, id: string, change: { text: string; title?: string | null }, who?: { by: string; via?: DraftVia }): Promise<ContentDraft>`
- **getDraft** (function) `(db: Queryable, id: string): Promise<ContentDraft>`
- **listDrafts** (function) `(db: Queryable, f: DraftFilter = {}): Promise<ContentDraft[]>`
- **rejectDrafts** (function) `(db: Queryable, ids: readonly string[], o: { by?: string; reason?: RejectReason | null; note?: string | null } = {}): Promise<ContentDraft[]>`
- **respreadApproved** (function) `(db: Queryable, platform: Platform, o: { now: Date; zone: string; slots?: Slots; by?: string }): Promise<ContentDraft[]>`
- **setFields** (function) `(db: Queryable, id: string, patch: Readonly<Record<string, unknown>>, who?: { by: string; via?: DraftVia }): Promise<ContentDraft>`

## packages/content/src/schema.ts

- **ACTIVITY_STATES** (const) `readonly ["new", "seen"]`
- **AD_FORMAT_FAMILIES** (const) `readonly ["offer", "proof", "contrast", "story", "native", "alarm", "lesson", "humor"]`
- **AD_FORMAT_STATES** (const) `readonly ["idea", "testing", "proven", "retired"]`
- **AUTO_REPLY_MODES** (const) `readonly ["off", "suggest", "auto"]`
- **ActivityState** (type) `type ActivityState = (typeof ACTIVITY_STATES)[number];`
- **AdFormatFamily** (type) `type AdFormatFamily = (typeof AD_FORMAT_FAMILIES)[number];`
- **AdFormatState** (type) `type AdFormatState = (typeof AD_FORMAT_STATES)[number];`
- **AutoReplyMode** (type) `type AutoReplyMode = (typeof AUTO_REPLY_MODES)[number];`
- **CHAT_DIRECTIONS** (const) `readonly ["in", "out"]`
- **ChatDirection** (type) `type ChatDirection = (typeof CHAT_DIRECTIONS)[number];`
- **ChatMessage** (type) `type ChatMessage = typeof chatMessages.$inferSelect;`
- **ChatThread** (type) `type ChatThread = typeof chatThreads.$inferSelect;`
- **ContentDraft** (type) `type ContentDraft = typeof contentDrafts.$inferSelect;`
- **ContentIdea** (type) `type ContentIdea = typeof contentIdeas.$inferSelect;`
- **ContentMetric** (type) `type ContentMetric = typeof contentMetrics.$inferSelect;`
- **ContentPlaybook** (type) `type ContentPlaybook = typeof contentPlaybooks.$inferSelect;`
- **DRAFT_STATUSES** (const) `readonly ["draft", "approved", "rejected", "publishing", "published", "failed"]`
- **DigestLine** (interface) `interface DigestLine { kind: "top" | "bottom" | "moved" | "next" | "cadence"; text: string; post?: string; }`
- **DraftStatus** (type) `type DraftStatus = (typeof DRAFT_STATUSES)[number];`
- **FUNNEL_STAGES** (const) `readonly ["reach", "trust", "convert"]`
- **FUNNEL_TARGETS** (const) `readonly ["video", "site", "booking", "page", "repo"]`
- **FunnelStage** (type) `type FunnelStage = (typeof FUNNEL_STAGES)[number];`
- **FunnelTarget** (type) `type FunnelTarget = (typeof FUNNEL_TARGETS)[number];`
- **IDEA_SOURCES** (const) `readonly ["cli", "api", "ads", "build_log", "question", "promo", "note", "site"]`
- **IDEA_STATUSES** (const) `readonly ["open", "drafted", "archived"]`
- **INBOX_CHANNELS** (const) `readonly ["email", "text", "dm", "comment", "chat"]`
- **INBOX_REPLY_STATES** (const) `readonly ["waiting", "queued", "sent", "dropped", "failed"]`
- **INBOX_STATUSES** (const) `readonly ["open", "waiting", "closed"]`
- **IdeaSource** (type) `type IdeaSource = (typeof IDEA_SOURCES)[number];`
- **IdeaStatus** (type) `type IdeaStatus = (typeof IDEA_STATUSES)[number];`
- **InboxChannel** (type) `type InboxChannel = (typeof INBOX_CHANNELS)[number];`
- **InboxReply** (type) `type InboxReply = typeof inboxReplies.$inferSelect;`
- **InboxReplyState** (type) `type InboxReplyState = (typeof INBOX_REPLY_STATES)[number];`
- **InboxStatus** (type) `type InboxStatus = (typeof INBOX_STATUSES)[number];`
- **InboxThread** (type) `type InboxThread = typeof inboxThreads.$inferSelect;`
- **KEYWORD_HIT_STATES** (const) `readonly ["queued", "sent", "failed"]`
- **KEYWORD_PLATFORMS** (const) `readonly ["instagram", "facebook"]`
- **KeywordHitState** (type) `type KeywordHitState = (typeof KEYWORD_HIT_STATES)[number];`
- **KeywordPlatform** (type) `type KeywordPlatform = (typeof KEYWORD_PLATFORMS)[number];`
- **NewContentDraft** (type) `type NewContentDraft = typeof contentDrafts.$inferInsert;`
- **NewContentIdea** (type) `type NewContentIdea = typeof contentIdeas.$inferInsert;`
- **PostVariant** (type) `type PostVariant = typeof postVariants.$inferSelect;`
- **SOURCE_STATES** (const) `readonly ["live", "needs_scope", "needs_william", "not_built", "no_api", "error", "waiting"]`
- **SocialActivity** (type) `type SocialActivity = typeof socialActivity.$inferSelect;`
- **SourceState** (type) `type SourceState = (typeof SOURCE_STATES)[number];`
- **VARIANT_FIELDS** (const) `readonly ["title", "thumbnail", "hook"]`
- **VARIANT_SOURCES** (const) `readonly ["publish", "swap"]`
- **VARIANT_STATES** (const) `readonly ["proposed", "live", "ended", "rejected"]`
- **VariantField** (type) `type VariantField = (typeof VARIANT_FIELDS)[number];`
- **VariantState** (type) `type VariantState = (typeof VARIANT_STATES)[number];`
- **accountMetricDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "account_metric_days"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "account_metric_days"; dataType: "string"; columnType: "PgVarchar"; data: Platform; driverParam: string; notNu…`
- **adFormatRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"ad_format_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "ad_format_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false…`
- **adFormats** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "ad_formats"; schema: undefined; columns: { slug: import("drizzle-orm/pg-core").PgColumn<{ name: "slug"; tableName: "ad_formats"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false;…`
- **autoReplies** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "auto_replies"; schema: undefined; columns: { channel: import("drizzle-orm/pg-core").PgColumn<{ name: "channel"; tableName: "auto_replies"; dataType: "string"; columnType: "PgVarchar"; data: "comment" | "email" | "text" | "dm" | "chat"; driver…`
- **blogPosts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "blog_posts"; schema: undefined; columns: { slug: import("drizzle-orm/pg-core").PgColumn<{ name: "slug"; tableName: "blog_posts"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false;…`
- **chatMessages** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "chat_messages"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "chat_messages"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **chatThreads** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "chat_threads"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "chat_threads"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **commentKeywordRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"comment_keyword_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "comment_keyword_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrima…`
- **commentKeywords** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "comment_keywords"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "comment_keywords"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault:…`
- **contentDigests** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "content_digests"; schema: undefined; columns: { week: import("drizzle-orm/pg-core").PgColumn<{ name: "week"; tableName: "content_digests"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDe…`
- **contentDrafts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "content_drafts"; schema: undefined; columns: { ideaId: import("drizzle-orm/pg-core").PgColumn<{ name: "idea_id"; tableName: "content_drafts"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefau…`
- **contentIdeas** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "content_ideas"; schema: undefined; columns: { text: import("drizzle-orm/pg-core").PgColumn<{ name: "text"; tableName: "content_ideas"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: true; hasDefault: fal…`
- **contentMetrics** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "content_metrics"; schema: undefined; columns: { draftId: import("drizzle-orm/pg-core").PgColumn<{ name: "draft_id"; tableName: "content_metrics"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasD…`
- **contentPlaybooks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "content_playbooks"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "content_playbooks"; dataType: "string"; columnType: "PgVarchar"; data: Platform; driverParam: string; notNull: …`
- **doneRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"done_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "done_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: fal…`
- **draftActivity** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"draft_activity", false, { item: import("drizzle-orm/pg-core").PgColumn<{ name: "item"; tableName: "draft_activity"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; …`
- **draftOutcomes** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"draft_outcomes", false, { item: import("drizzle-orm/pg-core").PgColumn<{ name: "item"; tableName: "draft_outcomes"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; …`
- **draftPeople** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"draft_people", false, { item: import("drizzle-orm/pg-core").PgColumn<{ name: "item"; tableName: "draft_people"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAu…`
- **formatSql** (const) `"case\n when d.platform = 'youtube' then case d.extra->>'kind' when 'short' then 'short'\n when 'community' then 'post' else 'long' end\n when d.platform = 'tiktok' then 'video'\n when d.platform in ('instagram', 'facebook') and d.extra->>'kind' = 'story' then 'story'\n when d.platform = 'instagram'…`
- **inboxReplies** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "inbox_replies"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "inbox_replies"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **inboxThreads** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "inbox_threads"; schema: undefined; columns: { thread: import("drizzle-orm/pg-core").PgColumn<{ name: "thread"; tableName: "inbox_threads"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefau…`
- **keywordHitRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"keyword_hit_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "keyword_hit_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: f…`
- **keywordHits** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "keyword_hits"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "keyword_hits"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; i…`
- **marketingConversation** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_conversation", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_conversation"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimary…`
- **marketingDraftRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_draft_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_draft_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrima…`
- **marketingPostRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"marketing_post_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "marketing_post_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimary…`
- **metricSources** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "metric_sources"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "metric_sources"; dataType: "string"; columnType: "PgVarchar"; data: Platform; driverParam: string; notNull: true; …`
- **postMetricDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "post_metric_days"; schema: undefined; columns: { draftId: import("drizzle-orm/pg-core").PgColumn<{ name: "draft_id"; tableName: "post_metric_days"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; ha…`
- **postVariants** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "post_variants"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "post_variants"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true;…`
- **socialActivity** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_activity"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "social_activity"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: t…`
- **socialDays** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "social_days"; schema: undefined; columns: { platform: import("drizzle-orm/pg-core").PgColumn<{ name: "platform"; tableName: "social_days"; dataType: "string"; columnType: "PgVarchar"; data: Platform; driverParam: string; notNull: true; hasDef…`

## packages/content/src/shape-view.ts

- **ShapeView** (interface) `interface ShapeView { draftId: string; platform: Platform; site: string; kind: string; status: DraftStatus; editable: boolean; title: string | null; text: string; max: number; fields: FieldView[]; missing: string[]; places?: string[]; links: Record<string, string>; media: { kind: "image" | "video"; name: string } | null; scheduled: string | null; published: { url: string | null; at: string | null; notes: string | null } | null; funnel: FunnelView & { videos: FunnelVideo[]; pages: FunnelPage[] }; thread: ThreadView | null; carousel: CarouselView | null; tiktok?: { creator: TikTokCreator | null; note: string | null }; }`
- **shapeView** (function) `(db: Queryable, draftId: string, signer?: VideoSigner): Promise<ShapeView | null>`

## packages/content/src/slide-paint.ts

- **PaintUnavailable** (class) `override name`
- **slidePainter** (function) `(o: { connectUrl?: string | null } = {}): SlidePainter`

## packages/content/src/slots.ts

- **DEFAULT_SLOTS** (const) `Slots`
- **Slot** (interface) `interface Slot { hour: number; minute: number; days?: readonly number[]; }`
- **Slots** (type) `type Slots = Readonly<Record<Platform, readonly Slot[]>>;`
- **nextSlot** (function) `(platform: Platform, now: Date, zone: string, slots: Slots = DEFAULT_SLOTS, taken: readonly Date[] = []): Date`
- **slotInstants** (function) `(platform: Platform, from: Date, zone: string, days: number, slots: Slots = DEFAULT_SLOTS): Date[]`
- **slotsOf** (function) `(custom: Partial<Record<Platform, readonly Slot[]>> | null | undefined): Slots`

## packages/content/src/social/records.ts

- **FORMATS** (const) `{ post: { label: string; tone: "neutral"; }; thread: { label: string; tone: "neutral"; }; carousel: { label: string; tone: "neutral"; }; }`
- **MISSING_PICKS** (const) `{ privacy: { label: string; tone: "warn"; }; disclosure: { label: "You need to indicate if your content promotes yourself, a third party, or both."; tone: "warn"; }; }`
- **PROOF_STATES** (const) `{ readonly live: { readonly label: "Live"; readonly tone: "good"; readonly about: "Someone signed out sees it"; }; readonly hidden: { readonly label: "Hidden"; readonly tone: "warn"; readonly about: "We see it, strangers don't: a filter or a mod holds it"; }; readonly missing: { readonly label: "Mis…`
- **activityRecord** (const) `import("@wren/core/records").RecordType`
- **approvalRecord** (const) `import("@wren/core/records").RecordType`
- **askedReplyRecord** (const) `import("@wren/core/records").RecordType`
- **audienceRecord** (const) `import("@wren/core/records").RecordType`
- **engageRecord** (const) `import("@wren/core/records").RecordType`
- **exploreRecord** (const) `import("@wren/core/records").RecordType`
- **inboxRecord** (const) `import("@wren/core/records").RecordType`
- **socialRecords** (function) `(signer?: VideoSigner): import("@wren/core/records").RecordType[]`

## packages/content/src/social/review-record.ts

- **reviewRecord** (const) `import("@wren/core/records").RecordType`

## packages/content/src/social/store.ts

- **FRESH_DAYS** (const) `3`
- **KeptComment** (type) `type KeptComment = Pick<Comment, "id" | "platform" | "author" | "post"> & { asked: boolean; };`
- **PLATFORM_NAMES** (const) `Record<Platform, string>`
- **RecentPost** (interface) `interface RecentPost { platform: Platform; id: string; url: string | null; title: string; publishedAt: string; }`
- **canSkip** (function) `(p: RecentPost, probed: number | undefined, stored: number | undefined, lastFull: number | undefined, now: Date): boolean`
- **fromMaps** (function) `(raw: unknown): boolean`
- **hasDay** (function) `(db: Queryable, platform: Platform, day: string): Promise<boolean>`
- **isDue** (function) `(p: RecentPost, lastRead: number | undefined, now: Date): boolean`
- **keepActivity** (function) `(db: Queryable, platform: Platform, rows: readonly ActivityRow[], now: Date): Promise<Array<{ id: number; kind: ActivityRow["kind"] }>>`
- **keepDay** (function) `(db: Queryable, platform: Platform, day: string, a: Audience, latest = false): Promise<boolean>`
- **keepPostComments** (function) `(db: Queryable, post: RecentPost, rows: readonly CommentRow[], o: { reviews?: boolean; now?: Date } = {}): Promise<KeptComment[]>`
- **keepReviews** (function) `(db: Queryable, platform: Platform, rows: readonly CommentRow[], now: Date): Promise<KeptComment[]>`
- **markSeen** (function) `(db: Queryable, ids: readonly number[] | null): Promise<number>`
- **newestActivityAt** (function) `(db: Queryable, platform: Platform): Promise<string | null>`
- **pingOf** (function) `(kept: readonly Pick<KeptComment, "platform">[], activity: readonly { kind: ActivityRow["kind"] }[]): string | null`
- **postOfComment** (function) `(db: Queryable, id: number): Promise<RecentPost | null>`
- **recentPosts** (function) `(db: Queryable, platforms: readonly Platform[], now: Date, followUpDays = 0): Promise<RecentPost[]>`

## packages/content/src/status.ts

- **StatusReport** (interface) `interface StatusReport { draftsByStatus: Readonly<Record<string, number>>; oldestDraftDays: number | null; openIdeas: number; draftedThisWeek: number; tokensThisMonth: { calls: number; input: number; output: number }; }`
- **THURSDAY** (const) `3`
- **collectStatus** (function) `(db: Queryable, now: Date): Promise<StatusReport>`
- **formatStatusLines** (function) `(r: StatusReport): string[]`
- **startOfWeekUtc** (function) `(today: Date): Date`
- **weekSlipped** (function) `(today: Date, draftedThisWeek: number): boolean`

## packages/content/src/touches.ts

- **FOLLOWING_SOURCE** (const) `"following"`
- **OWN_COMMENTS_SOURCE** (const) `"own_comments"`
- **backfillTouches** (function) `(db: Queryable, o: { dryRun?: boolean; now?: Date } = {}): Promise<TouchesBackfill>`
- **keepFollowing** (function) `(db: Queryable, platform: string, rows: readonly FollowingRow[], now: Date): Promise<FollowingKept>`
- **keepOwnComments** (function) `(db: Queryable, platform: string, rows: readonly OwnCommentRow[]): Promise<number>`
- **linkCommentAuthors** (function) `(db: Queryable): Promise<number>`
- **touchFromActivity** (function) `(db: Queryable, id: number): Promise<{ id: number; handleId: number; created: boolean; linked: boolean; } | null>`

## packages/content/src/train-backfill.ts

- **backfillTraining** (function) `(db: Queryable, o: { dryRun?: boolean } = {}): Promise<BackfillReport>`

## packages/content/src/video-ask.ts

- **undoVideo** (function) `(db: Queryable, id: number, by: string): Promise<{ run: string; n: number; edit: VideoEdit; } | { run: string; edit: VideoEdit; snapped: import("@wren/studio").Moved[]; }>`
- **videoChanges** (function) `(db: Queryable, id: number): Promise<{ run: string; command: string; by: string | null; at: string; before: object; }[]>`

## packages/content/src/video.ts

- **ApprovedVideo** (interface) `interface ApprovedVideo { id: string; again: boolean; reel?: { id: string; again: boolean } | { missing: string }; also?: { platform: string; id: string }[]; }`
- **SwappedDraft** (interface) `interface SwappedDraft { id: string; platform: string; short: number; from: string; to: string; }`
- **VIDEO_FOOTERS** (const) `{ readonly long: { readonly kind: "post"; readonly system: "youtube"; readonly name: "footer"; }; readonly short: { readonly kind: "post"; readonly system: "youtube"; readonly name: "shorts-footer"; }; readonly reel: { readonly kind: "post"; readonly system: "instagram"; readonly name: "reel-footer"…`
- **VIDEO_PRIVACY** (const) `readonly ["private", "unlisted", "public"]`
- **VideoFooter** (type) `type VideoFooter = keyof typeof VIDEO_FOOTERS;`
- **VideoPrivacy** (type) `type VideoPrivacy = (typeof VIDEO_PRIVACY)[number];`
- **VideoSigner** (interface) `interface VideoSigner { bucket: string; host: { host(source: string): Promise<string> }; }`
- **approveVideo** (function) `(db: Queryable, id: number, o: ApproveVideo): Promise<ApprovedVideo>`
- **fillFooter** (function) `(tpl: Template | null, e: Pick<VideoEdit, "id" | "title">): string`
- **pickThumbnail** (function) `(db: Queryable, id: number, n: number): Promise<string>`
- **reelKey** (function) `(short: number | CroppedFormat): string`
- **swapShortMedia** (function) `(db: Queryable, id: number, o: { short?: number; by: string }): Promise<{ run: string; swapped: SwappedDraft[]; missing: string[] }>`
- **videoFooters** (function) `(db: Queryable): Promise<Record<VideoFooter, Template | null>>`
- **videoRecord** (function) `(signer?: VideoSigner): import("@wren/core/records").RecordType`
- **videoRef** (function) `(id: number, short?: number | "vertical"): string`
- **videoSlug** (function) `(e: Pick<VideoEdit, "id" | "title">): string`
- **withFooter** (function) `(parts: string[], footer: string, max: number): string`

## packages/content/src/voice.ts

- **Brand** (interface) `interface Brand { readonly name: string; readonly about: string; }`
- **DEFAULT_BRAND** (const) `Brand`
- **DEFAULT_VOICE** (const) `"Extremely concise. Short plain sentences a person would say out loud.\nFewer words, more signal. No filler, no hedging, no hype, no jargon, no buzzwords.\nLead with the point. Concrete over abstract: the real numbers and events you are given, never made-up ones.\nFirst person, one person talking, n…`

## packages/content/src/write.ts

- **IDEA_ANGLES** (const) `readonly ["Proof", "Contrarian", "How I do it", "Story"]`
- **IdeaAngle** (type) `type IdeaAngle = (typeof IDEA_ANGLES)[number];`
- **OWN_WORDS** (const) `"own"`
- **ownDraftOf** (function) `(platform: Platform, text: string, title?: string | null, media?: Media | null): { text: string; title: string | null; extra?: Record<string, unknown> } | { reason: string }`
- **ownThreadOf** (function) `(text: string): { text: string; title: null; extra: Record<string, unknown> } | { reason: string }`
- **splitPosts** (function) `(text: string): string[]`
