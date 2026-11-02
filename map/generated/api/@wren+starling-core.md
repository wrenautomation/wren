# @wren/starling-core: interface

Exports: 130. Files: 10.

## packages/starling/core/src/campaigns.ts

- **LoopCampaign** (interface) `interface LoopCampaign { id: string; offer?: string; audience?: { segment?: string; lines?: string[] }; accounts: Readonly<Record<string, string>>; caps: Readonly<Record<string, number>>; }`
- **capLeft** (function) `(global: number, cap: number | undefined, used: number): number`

## packages/starling/core/src/index.ts

- **ACTIVITY_KINDS** (const) `readonly ["follow", "subscribe", "mention", "reaction", "notification"]`
- **ActivityKind** (type) `type ActivityKind = (typeof ACTIVITY_KINDS)[number];`
- **ActivityQuery** (interface) `interface ActivityQuery { since?: string; limit?: number; }`
- **ActivityRow** (interface) `interface ActivityRow { id: string; kind: ActivityKind; actor: string | null; actorUrl: string | null; text: string; url: string | null; at: string | null; raw: unknown; }`
- **Audience** (interface) `interface Audience { followers: number; asOf: string; raw: unknown; }`
- **CONTENT_LIST_LIMIT** (const) `100`
- **CommentRow** (interface) `interface CommentRow { id: string; postId: string; author: string; authorName?: string; text: string; at: string; repliedWith?: string; parentId?: string; url?: string; mine?: boolean; stars?: number; raw?: unknown; }`
- **ContentChannel** (interface) `interface ContentChannel { readonly platform: Platform; publish(post: Post): Promise<Published>; list(q?: ListQuery): Promise<PublishedRow[]>; metrics(id: string): Promise<Metrics>; metricsMany?(posts: { id: string; kind?: string | null }[]): Promise<Metrics[]>; commentCounts?(ids: string[]): Promise<Record<string, number>>; comments(id: string, q?: ListQuery): Promise<CommentRow[]>; reply?(commentId: string, text: string, on?: { postId?: string | null }): Promise<void>; privateReply?(commentId: string, text: string): Promise<{ ref: string | null }>; reviews?(q?: ActivityQuery): Promise<CommentRow[]>; activity?(q?: ActivityQuery): Promise<ActivityRow[]>; audience?(): Promise<Audience>; following?(): Promise<FollowingRow[]>; ownComments?(): Promise<OwnCommentRow[]>; insights?(q: InsightsQuery): Promise<Insights>; accountInsights?(): Promise<AccountInsights>; reportDays?(q: { after?: string | null }): Promise<ReportDays>; update?(id: string, patch: PostPatch): Promise<void>; }`
- **FollowingRow** (interface) `interface FollowingRow { handle: string; name: string | null; url: string | null; at: string | null; }`
- **ListQuery** (interface) `interface ListQuery { limit?: number; before?: string; }`
- **Media** (interface) `interface Media { kind: "image" | "video"; source: string; title?: string; }`
- **MediaHost** (interface) `interface MediaHost { host(source: string): Promise<string>; }`
- **Metrics** (interface) `interface Metrics { id: string; views: number; reactions: number; comments: number; shares: number; follows?: number | null; read?: unknown; asOf: string; fetchedWith: FetchedWith; }`
- **OwnCommentRow** (interface) `interface OwnCommentRow { id: string; url: string; at: string; text: string; postId: string; reply: boolean; to: { handle: string; name: string | null } | null; }`
- **Post** (interface) `interface Post { text: string; media?: Media; scheduledFor?: string; extra?: Record<string, unknown>; }`
- **PostPatch** (interface) `interface PostPatch { title?: string; thumbnail?: string; hook?: string; }`
- **Published** (interface) `interface Published { id: string; url: string; publishedAt: string; fetchedWith: FetchedWith; notes?: string[]; }`
- **PublishedRow** (interface) `interface PublishedRow extends Published { preview: string; text?: string; title?: string; }`
- **fakeContentChannel** (function) `(platform: Platform, o: { now?: () => Date; urlOf?: (id: string) => string } = {}): ContentChannel & { posts: Array<Published & { post: Post }>; updates: Array<{ id: string; patch: PostPatch }>; privateReplies: Array<{ commentId: string; text: string }>; count(id: string, m: Partial<Omit<Metrics, "id" | "asOf" | "fetchedWith">>): void; receive(c: Omit<CommentRow, "repliedWith">): void; happen(a: ActivityRow): void; follow(followers: number): void; followOut(f: FollowingRow): void; commentOut(c: OwnCommentRow): void; measure(id: string, i: Omit<Insights, "asOf">): void; measureAccount(a: Omit<AccountInsights, "asOf">): void; report(r: Omit<ReportDays, "asOf">): void; }`
- **hookOf** (function) `(text: string): string`
- **isStoredMedia** (function) `(source: string): boolean`
- **isUrl** (function) `(source: string): boolean`
- **mediaFileOf** (function) `(source: string, host: MediaHost | undefined, platform: string): Promise<string>`
- **pageFollowing** (function) `(sites: SiteClient, site: string, path: string, profile: (handle: string) => string): Promise<FollowingRow[]>`
- **pageOf** (function) `(rows: readonly T[], q: ListQuery = {}): T[]`
- **previewOf** (function) `(text: string, max = 120): string`
- **publicUrlOf** (function) `(source: string, host: MediaHost | undefined, platform: string): Promise<string>`
- **withHook** (function) `(text: string, hook: string): string`

## packages/starling/core/src/insights.ts

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

## packages/starling/core/src/page-inbox.ts

- **pageInboxOf** (function) `(body: unknown, self: string): PageInbox`
- **pageInboxQuery** (function) `(platform: "facebook" | "instagram", limit = 25): { platform: string; fields: string; limit: number; }`

## packages/starling/core/src/proof.ts

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

## packages/starling/core/src/service.ts

- **Channels** (type) `type Channels = Partial<Record<Platform, ContentChannel>>;`
- **ChannelsFor** (type) `type ChannelsFor = ( ctx: restate.Context, o?: { arm?: boolean; account?: string | null }, ) => Channels;`
- **Content** (type) `type Content = ReturnType<typeof makeContent>;`
- **ContentClients** (interface) `interface ContentClients { channels: (ctx: restate.Context, client: string, part: ContentPart) => Promise<Channels>; sends: (client: string) => Promise<boolean>; }`
- **MANY_POSTS** (const) `100`
- **SENDS_OFF** (const) `"Sends off. An admin turns them on."`
- **journaledHost** (function) `(ctx: restate.Context, host: MediaHost): MediaHost`
- **makeContent** (function) `(channelsFor: ChannelsFor, clients?: ContentClients): restate.ServiceDefinition<"Content", { platforms: (ctx: restate.Context) => Promise<Platform[]>; publish: (ctx: restate.Context, req: { platform: Platform; post: Post; } & ForClient & AsAccount & Keyed) => Promise<Published | Delivery<Published>>; list: (ctx: restate.Context, req: { platform: Platfo…`

## packages/starling/core/src/shapes.ts

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

## packages/starling/core/src/slides.ts

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

## packages/starling/core/src/thread.ts

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

## packages/starling/core/src/tiktok.ts

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
