# @wren/learn: interface

Exports: 316. Files: 27.

## packages/learn/src/alerts.ts

- **oneLine** (function) `(text: string | null | undefined, max = 140): string | null`
- **learnPeople** (function) `(db: Queryable, client: string): Promise<string[]>`
- **alertLearn** (function) `(db: Db, now: Date, perHour = ALERTS_PER_HOUR): Promise<AlertStats>`
- **bellOf** (function) `(db: Queryable, client: string, email: string): Promise<{ unseen: number; alerts: BellLine[] }>`
- **bellSeen** (function) `(db: Queryable, client: string, email: string, now = new Date()): Promise<number>`
- **todayOf** (function) `(db: Queryable, client: string, email: string, now = new Date()): Promise<{ since: string; total: number; held: number; items: TodayLine[] }>`
- **picksOf** (function) `(db: Queryable, client: string, email: string): Promise<{ saved: AlertPick; sources: Record<number, AlertPick>; }>`
- **setPick** (function) `(db: Queryable, client: string, email: string, on: number | "saved", pick: AlertPick): Promise<boolean>`
- **digestMailOn** (function) `(db: Queryable, client: string): Promise<boolean>`
- **setDigestMail** (function) `(db: Queryable, client: string, on: boolean, by: string): Promise<void>`
- **mailLearnDigests** (function) `(db: Db, send: (m: DigestMail) => Promise<void>, p: { now: Date; today: string; hour: number; portal: string | null }): Promise<{ sent: number; failed: number }>`
- **BellLine** (interface) `interface BellLine { id: number; itemId: number; title: string; type: ItemType; source: string; score: number | null; line: string | null; why: AlertWhy; at: string; seen: boolean; }`
- **TodayLine** (interface) `interface TodayLine { id: number; title: string; type: ItemType; url: string; source: string; score: number | null; line: string | null; told: AlertState | null; read: boolean; pick?: LearnPick | null; at: string; }`
- **DigestMail** (interface) `interface DigestMail { to: string; subject: string; text: string; }`

## packages/learn/src/breakdown.ts

- **postCounts** (function) `(text: string): Omit<PostFacts, "shape" | "format">`
- **breakdownPrompt** (function) `(item: { kind?: BrokenDown; title: string; url: string; text: string; }): string`
- **beatsOf** (function) `(raw: Answer["beats"]): Beat[]`
- **filmFactsOf** (function) `(transcript: string): FilmFacts | null`
- **factsOf** (function) `(item: { kind: BrokenDown; text: string; transcript: string }, v: Answer): Record<string, unknown> | null`
- **breakdownItem** (function) `(db: Db, judgeFor: JudgeFor, id: number, hand?: { facts: Record<string, unknown>; by: BreakdownBy }): Promise<boolean>`
- **BROKEN_DOWN** (const) `readonly ["reel", "video", "post", "film"]`
- **BrokenDown** (type) `type BrokenDown = (typeof BROKEN_DOWN)[number];`
- **HOOK_STYLE_ABOUT** (const) `Record<HookStyle, string>`
- **breakdownSchema** (const) `z.ZodObject<{ hook_style: z.ZodEnum<{ other: "other"; news: "news"; question: "question"; story: "story"; contrarian: "contrarian"; "demo-first": "demo-first"; "result-first": "result-first"; "identity-call": "identity-call"; "list-tease": "list-tease"; warning: "warning"; "how-to": "how-to"; "patte…`
- **answerSchema** (function) `(kind: K): z.ZodObject<{ [k in keyof (("topic" | "hook" | "cta" | "hook_style" | "hook_why" | "beats" | "cta_kind") & keyof { readonly reel: { readonly format: z.ZodEnum<{ "talking-head": "talking-head"; "screen-demo": "screen-demo"; voiceover: "voiceover"; "text-on-screen": "text-on-screen"; mixed: "mixed"; }…`
- **postFactsSchema** (const) `z.ZodObject<{ format: z.ZodNullable<z.ZodEnum<{ text: "text"; video: "video"; doc: "doc"; carousel: "carousel"; image: "image"; }>>; chars: z.ZodNumber; lines: z.ZodNumber; first_line_chars: z.ZodNumber; link: z.ZodNullable<z.ZodEnum<{ comment: "comment"; none: "none"; body: "body"; }>>; hashtags: z…`
- **PostFacts** (type) `type PostFacts = z.infer<typeof postFactsSchema>;`
- **FACTS** (const) `{ readonly reel: z.ZodObject<{ format: z.ZodEnum<{ "talking-head": "talking-head"; "screen-demo": "screen-demo"; voiceover: "voiceover"; "text-on-screen": "text-on-screen"; mixed: "mixed"; }>; }, z.core.$strip>; readonly video: z.ZodObject<{ format: z.ZodEnum<{ "talking-head": "talking-head"; "scree…`

## packages/learn/src/calls.ts

- **factRows** (function) `(b: Pick< BreakdownRow, "hookStyle" | "hook" | "hookWhy" | "topic" | "beats" | "ctaKind" | "cta" | "facts" >): FactRow[]`
- **recordFactCall** (function) `(db: Queryable, p: { client: string; id: number; path: string; call: FactCall; comment?: string | null | undefined; by: string | null; source: "console" | "cli"; }): Promise<{ subject: string; row: FactRow | null }>`
- **factCalls** (function) `(db: Queryable, id: number): Promise<FactCallRow[]>`
- **FACT_CALLS** (const) `readonly ["keep", "tune", "drop"]`
- **FactCall** (type) `type FactCall = (typeof FACT_CALLS)[number];`
- **isFactCall** (function) `(c: string): c is FactCall`
- **ITEM_PATH** (const) `"/"`
- **FactRow** (interface) `interface FactRow { path: string; label: string; value: string; proof?: Proof; }`
- **FactCallRow** (interface) `interface FactCallRow { path: string; call: FactCall; comment: string | null; by: string | null; at: Date; }`
- **factSubject** (function) `(document: number, path: string): string`
- **FactCallRefusal** (class) ``

## packages/learn/src/catalog.ts

- **readCatalog** (function) `(db: Db, read: CatalogReader, o: { client: string; url: string; want: number; now: Date; reelsOnly?: boolean; pageSize?: number; maxPages?: number; onPage?: (pass: Readonly<CatalogPass>) => void; }): Promise<CatalogPass>`
- **catalogSummary** (function) `(reads: readonly CatalogRead[], seconds: number, stopped: string | null): CatalogSummary`
- **readQueued** (function) `(db: Db, ids: readonly number[], o: { read: VideoReader; judge: JudgeFor; giveUp?: number; onRead?: (r: CatalogRead, n: number, of: number) => void; clock?: () => number; }): Promise<{ reads: CatalogRead[]; stopped: string | null }>`
- **CatalogReader** (type) `type CatalogReader = ( kind: CreatorKind, handle: string, page: { after: string | null; limit: number }, ) => Promise<CreatorPage> | null;`
- **CatalogRead** (interface) `interface CatalogRead { id: number; read: "read" | "mac" | "failed" | "waits" | null; verdict: Verdict | null; why: string | null; seconds: number; }`

## packages/learn/src/check.ts

- **checkPiece** (function) `(kind: string, standard: KindStandard | null, patterns: PatternRule[], ours: Ours): PieceCheck`
- **Where** (type) `type Where = "below" | "inside" | "above";`
- **PatternVerdict** (type) `type PatternVerdict = "meets" | "breaks" | "off";`
- **PieceCheck** (interface) `interface PieceCheck { kind: string; n: number; numbers: { label: string; ours: number | null; median: number; p25: number; p75: number; where: Where | null; }[]; shares: { label: string; ours: string | null; n: number; of: [string, number][] }[]; patterns: { label: string; ours: string | null; kept: string[]; dropped: string[]; verdict: PatternVerdict; }[]; }`
- **Ours** (type) `type Ours = Partial<Record<keyof StandardRow, string | number | boolean | null>>;`

## packages/learn/src/components.ts

- **LEARN_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **LEARN_WORKFLOWS** (const) `import("@wren/core/workflows").Workflow[]`

## packages/learn/src/console-routes.ts

- **LEARN_CONSOLE_ROUTES** (const) `{ readonly save: "act"; readonly follow: "act"; readonly tell: "manage"; readonly unfollow: "act"; readonly browse: "read"; readonly rail: "read"; readonly home: "read"; readonly sources: "read"; readonly mark: "act"; readonly call: "act"; readonly open: "read"; readonly progress: "read"; readonly m…`
- **LEARN_CONSOLE_APPS** (const) `{ readonly "*": "learn"; }`
- **LEARN_CONSOLE_WRITES** (const) `readonly (keyof typeof LEARN_CONSOLE_ROUTES)[]`

## packages/learn/src/console.ts

- **mayManage** (function) `(main: Db, req: PortalRequest, client: string): Promise<boolean>`
- **learnConsoleApi** (function) `(db: Db, fetchFn: FetchFn = fetch, clientDb?: ClientDbOf, embed: Embed | null = null): { save: (req: SaveRequest) => Promise<{ id: string; url: string; kind: "post" | "video" | "reel" | "article" | "film" | "episode"; fresh: boolean; unread: boolean; }>; follow: (req: FollowRequest) => Promise<{ id: string; name: string; kind: "reddit" | "youtube" | "x" | "tiktok" | "instagram" | "new…`
- **makeLearnConsole** (function) `(db: Db, fetchFn: FetchFn = fetch, clientDb?: ClientDbOf, embed: Embed | null = null): restate.ServiceDefinition<"LearnConsole", { save: (ctx: restate.Context, req: SaveRequest) => Promise<{ id: string; url: string; kind: "post" | "video" | "reel" | "article" | "film" | "episode"; fresh: boolean; unread: boolean; }>; follow: (_: restate.Context, req: FollowRequest) => Promise<{ id: st…`
- **LEARN_FLOW** (const) `"learn"`
- **LEARN_SAVED_FROM** (const) `"saved.item"`
- **LEARN_FEEDS_FROM** (const) `"feeds.items"`
- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids: string[]; }`
- **SaveRequest** (interface) `interface SaveRequest extends PortalRequest { url: string; title?: string | null; via?: string | null; }`
- **MoveRequest** (interface) `interface MoveRequest extends IdsRequest { collection?: string | null; }`
- **TagRequest** (interface) `interface TagRequest extends IdsRequest { add?: string[] | null; remove?: string[] | null; }`

## packages/learn/src/creators.ts

- **statsOf** (function) `(n: { likes?: number | null | undefined; comments?: number | null | undefined; views?: number | null | undefined; }): PostStats | null`
- **creatorOf** (function) `(raw: string): { kind: CreatorKind; handle: string; page: string } | null`
- **profileOf** (function) `(raw: string): { kind: CreatorKind; handle: string; page: string } | null`
- **instagramPage** (function) `(sites: SiteClient, handle: string, page: { after?: string | null; limit?: number } = {}): Promise<CreatorPage>`
- **tiktokPage** (function) `(ytDlp: string, handle: string, page: { after?: string | null; limit?: number } = {}): Promise<CreatorPage>`
- **pullCreators** (function) `(db: Db, read: CreatorReader, now: Date, opts: { kinds: readonly CreatorKind[]; macReads?: boolean }): Promise<PullStats>`
- **creatorSource** (function) `(raw: string): { kind: SourceKind; url: string; name: string } | null`
- **CREATOR_KINDS** (const) `readonly ["instagram", "x", "tiktok"]`
- **CreatorKind** (type) `type CreatorKind = (typeof CREATOR_KINDS)[number];`
- **isCreatorKind** (function) `(k: string): k is CreatorKind`
- **FOLLOWED_BEFORE** (const) `"Posted before you followed."`
- **CreatorPost** (interface) `interface CreatorPost extends FeedItem { kind: ItemKind; stats?: PostStats | null; }`
- **CreatorPage** (interface) `interface CreatorPage { posts: CreatorPost[]; next: string | null; }`
- **sitesReader** (function) `(sites: SiteClient): CreatorReader`
- **tiktokReader** (function) `(ytDlp: string): CreatorReader`

## packages/learn/src/decide.ts

- **learnDue** (function) `(db: Queryable, now: Date, limit: number): Promise<DecideSubject[]>`
- **learnCalled** (function) `(db: Queryable, limit: number): Promise<DecideSubject[]>`
- **learnMarkCalls** (function) `(db: Queryable, client: string, ids: readonly number[], m: string, by: string | null = null): Promise<void>`
- **learnWorthCall** (function) `(db: Queryable, client: string, id: number, source: "save" | "sop", by: string | null): Promise<void>`
- **backfillLearnCalls** (function) `(db: Queryable): Promise<{ keep: number; drop: number }>`
- **withLearnPicks** (function) `(db: Queryable, client: string, cards: C[]): Promise<(C & { pick: LearnPick | null })[]>`
- **learnSource** (const) `DecideSource`
- **LearnPick** (type) `type LearnPick = "keep" | "drop";`

## packages/learn/src/drive.ts

- **browse** (function) `(db: Queryable, client: string, b: Browse): Promise<{ place: string; sort: "title" | "length" | "source" | "score" | "newest"; items: (Card & { pick: LearnPick | null; })[]; more: boolean; total: number; types: Partial<Record<ItemType, number>>; sources: { n: number; id: number; name: string; kind: "reddit" | "youtube" | "x" | "tiktok" | "ins…`
- **unseen** (function) `(db: Queryable, client: string, email: string): Promise<number>`
- **markSeen** (function) `(db: Queryable, client: string, email: string, at = new Date()): Promise<void>`
- **mediaOf** (function) `(db: Queryable, ids: readonly number[], client: string): Promise<string[]>`
- **rail** (function) `(db: Queryable, client: string): Promise<{ places: { inbox: number; all: number; later: number; starred: number; saved: number; archived: number; }; collections: { n: number; id: number; name: string; parentId: number | null; }[]; sources: { kind: "reddit" | "youtube" | "x" | "tiktok" | "instagram" | "newsletter" | "podcast" | "blo…`
- **home** (function) `(db: Queryable, client: string, now = new Date()): Promise<{ shelves: { type: "reddit" | "link" | "youtube" | "x" | "tiktok" | "instagram" | "newsletter" | "shorts" | "podcast" | "blog" | "releases"; total: number; items: (Card & { pick: LearnPick | null; })[]; }[]; continue: (Card & { pick: LearnPick | null; })[]; top: (Card & { pick: LearnPick | n…`
- **itemPage** (function) `(db: Queryable, client: string, id: number): Promise<{ pick: "drop" | "keep" | null; text: string; transcript: string | null; file: string | null; mediaUrl: string | null; moments: Moment[]; why: string | null; changes: string[]; verdict: "drop" | "hold" | "show" | null; failure: string | null; kind: "post" | "video" | "reel" | "article" | "fi…`
- **mark** (function) `(db: Queryable, client: string, ids: number[], m: Mark, by: string | null = null): Promise<number[]>`
- **opened** (function) `(db: Queryable, client: string, id: number): Promise<void>`
- **progress** (function) `(db: Queryable, client: string, p: { id: number; position: number; duration?: number | null | undefined }): Promise<void>`
- **moveItems** (function) `(db: Queryable, client: string, ids: number[], collectionId: number | null): Promise<number[]>`
- **tagOf** (function) `(raw: string): string`
- **tagItems** (function) `(db: Queryable, client: string, picked: number[], p: { add?: string[]; remove?: string[] }): Promise<number[]>`
- **addCollection** (function) `(db: Queryable, client: string, p: { name: string; parentId?: number | null; by?: string | null }): Promise<{ name: string; id: number; parentId: number | null; client: string; by: string | null; createdAt: Date; }>`
- **editCollection** (function) `(db: Queryable, client: string, p: { id: number; name?: string | null | undefined; parentId?: number | null }): Promise<{ id: number; client: string; name: string; parentId: number | null; by: string | null; createdAt: Date; }>`
- **dropCollection** (function) `(db: Queryable, client: string, id: number): Promise<boolean>`
- **sourcesByKind** (function) `(db: Queryable, client: string): Promise<{ kind: "reddit" | "youtube" | "x" | "tiktok" | "instagram" | "newsletter" | "podcast" | "blog" | "forum" | "releases"; sources: { items: number; fresh: number; last: string | null; id: number; name: string; url: string; page: string | null; kind: "reddit" | "youtube" | "x" | "tiktok" | "ins…`
- **PLACES** (const) `readonly ["inbox", "all", "later", "starred", "saved", "archived"]`
- **Place** (type) `type Place = (typeof PLACES)[number] | 'c${number}' | 's${number}';`
- **SORTS** (const) `readonly ["newest", "score", "length", "source", "title"]`
- **Sort** (type) `type Sort = (typeof SORTS)[number];`
- **MARKS** (const) `readonly ["star", "unstar", "pin", "unpin", "later", "unlater", "archive", "unarchive", "read", "unread"]`
- **Mark** (type) `type Mark = (typeof MARKS)[number];`
- **Card** (interface) `interface Card { id: number; title: string; type: ItemType; url: string; thumbnail: string | null; duration: number | null; chars: number; source: { id: number; name: string; kind: SourceKind; avatar: string | null } | null; creator: string | null; score: number | null; summary: string | null; status: "unread" | "read" | "archived"; state: "reading" | "failed" | "mac" | "scoring" | "ready"; starred: boolean; pinned: boolean; later: boolean; position: number | null; collectionId: number | null; tags: string[]; saved: boolean; pick?: LearnPick | null; at: string; }`
- **Browse** (interface) `interface Browse { place?: string | null | undefined; types?: string[] | null | undefined; sources?: (string | number)[] | null | undefined; tag?: string | null | undefined; q?: string | null | undefined; sort?: string | null | undefined; offset?: number | null | undefined; limit?: number | null | undefined; }`

## packages/learn/src/embed.ts

- **embedMissing** (function) `(db: Queryable, embed: Embed, limit = 50): Promise<{ embedded: number }>`
- **nearItems** (function) `(db: Queryable, client: string, query: readonly number[], limit = 40): Promise<{ id: number; near: number }[]>`
- **keepQueries** (function) `(embed: Embed, max = 500): Embed`

## packages/learn/src/feeds.ts

- **plain** (function) `(raw: string): string`
- **secondsOf** (function) `(raw: string): number | null`
- **parseFeed** (function) `(xml: string): Feed`
- **feedLinkOf** (function) `(html: string, base: string): string | null`
- **fetchFeed** (function) `(fetchFn: FetchFn, url: string): Promise<Feed>`
- **sourceKindOf** (function) `(feedUrl: string, feed: Feed): SourceKind`
- **ogImageOf** (function) `(html: string): string | null`
- **follow** (function) `(db: Db, fetchFn: FetchFn, p: { client: string; url: string; name?: string | null; tell?: Tell | null; by?: string | null; }): Promise<{ id: number; name: string; kind: SourceKind; items: number }>`
- **tellSources** (function) `(db: Queryable, client: string, ids: number[], tell: Tell): Promise<number[]>`
- **unfollowSources** (function) `(db: Queryable, client: string, ids: number[]): Promise<number[]>`
- **pullFeeds** (function) `(db: Db, fetchFn: FetchFn, now: Date): Promise<PullStats>`
- **IN_FEED_BEFORE** (const) `"In the feed before you followed it."`
- **FeedItem** (interface) `interface FeedItem { url: string; title: string; text: string; publishedAt: Date | null; creator: string | null; enclosure: string | null; thumbnail: string | null; duration: number | null; }`
- **Feed** (interface) `interface Feed { title: string; podcast: boolean; image: string | null; generator: string; items: FeedItem[]; }`
- **decode** (const) `(s: string) => string`
- **FetchFn** (type) `type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;`
- **PullStats** (interface) `interface PullStats { added: number[]; failed: Array<{ source: string; error: string }>; }`
- **itemEvent** (function) `(id: number): ExecutorEvent`

## packages/learn/src/film.ts

- **filmShots** (function) `(facts: unknown): Shot[]`
- **shotsOf** (function) `(cuts: readonly number[], durationS: number): Shot[]`
- **shotStats** (function) `(shots: readonly Shot[], durationS: number): { shot_median_s: number; shot_p90_s: number; cuts_per_10s: number[]; }`
- **cutsTrust** (function) `(hash: number, adaptive: number, handCuts?: number | null): CutsTrust`
- **filmFacts** (function) `(w: WatchFacts, o: { speech: boolean }): FilmFacts`
- **seedFilmFacts** (function) `(f: SeedFilm): FilmFacts`
- **shotSchema** (const) `z.ZodObject<{ t: z.ZodNumber; len: z.ZodNumber; src: z.ZodEnum<{ hand: "hand"; scene: "scene"; }>; type: z.ZodNullable<z.ZodEnum<{ "talking-head": "talking-head"; ui: "ui"; "b-roll": "b-roll"; graphic: "graphic"; logo: "logo"; "text-card": "text-card"; }>>; move: z.ZodNullable<z.ZodEnum<{ push: "pus…`
- **Shot** (type) `type Shot = z.infer<typeof shotSchema>;`
- **filmFactsSchema** (const) `z.ZodObject<{ duration_s: z.ZodNumber; cuts: z.ZodNumber; cuts_by_signal: z.ZodRecord<z.ZodString, z.ZodNumber>; cuts_trust: z.ZodEnum<{ ok: "ok"; low: "low"; }>; shot_median_s: z.ZodNumber; shot_p90_s: z.ZodNumber; cuts_per_10s: z.ZodArray<z.ZodNumber>; first_product_s: z.ZodNullable<z.ZodNumber>; …`
- **FilmFacts** (type) `type FilmFacts = z.infer<typeof filmFactsSchema>;`
- **seedFilmSchema** (const) `z.ZodObject<{ url: z.ZodString; slug: z.ZodString; brand: z.ZodString; rival: z.ZodBoolean; duration_s: z.ZodNumber; cuts_by_signal: z.ZodRecord<z.ZodString, z.ZodNumber>; first_product_s: z.ZodNullable<z.ZodNumber>; logo_s: z.ZodNullable<z.ZodNumber>; cta_s: z.ZodNullable<z.ZodNumber>; cta: z.ZodNu…`
- **SeedFilm** (type) `type SeedFilm = z.infer<typeof seedFilmSchema>;`
- **seedStudySchema** (const) `z.ZodObject<{ films: z.ZodArray<z.ZodObject<{ url: z.ZodString; slug: z.ZodString; brand: z.ZodString; rival: z.ZodBoolean; duration_s: z.ZodNumber; cuts_by_signal: z.ZodRecord<z.ZodString, z.ZodNumber>; first_product_s: z.ZodNullable<z.ZodNumber>; logo_s: z.ZodNullable<z.ZodNumber>; cta_s: z.ZodNul…`

## packages/learn/src/findings.ts

- **factFindings** (function) `(db: Queryable, b: BreakdownRow): Promise<number>`

## packages/learn/src/hunt.ts

- **rankFinds** (function) `(lists: readonly Find[][]): Find[]`
- **huntSop** (function) `(db: Db, o: { client: string; name: string; scope: SopScope; search: TopicSearch; catalog: CatalogReader | null; cap?: number; perQuery?: number; now?: Date; }): Promise<Hunt>`
- **Find** (interface) `interface Find { url: string; title: string; creator: string | null; views: number | null; publishedAt: Date | null; duration: number | null; }`
- **TopicSearch** (type) `type TopicSearch = (query: string, n: number) => Promise<Find[]>;`
- **HUNT_CAP** (const) `10`
- **HUNT_PER_QUERY** (const) `30`
- **youtubeSearch** (function) `(ytDlp: string): TopicSearch`
- **phrasesOf** (function) `(topic: string): string[]`
- **Hunt** (interface) `interface Hunt { tag: string; cap: number; before: number; revived: number[]; walked: { creator: string; queued: number }[]; unfollowed: string[]; searched: string[]; found: number; known: number; saved: number[]; left: number; }`
- **huntedIds** (function) `(h: Hunt): number[]`

## packages/learn/src/items.ts

- **saveLink** (function) `(db: Db, p: { client: string; url: string; by: string | null; via: Via; title?: string | null; kind?: ItemKind; creator?: string | null; now?: Date; stats?: PostStats | null; worth?: boolean; }): Promise<Saved>`
- **searchItems** (function) `(db: Queryable, client: string, q: string, limit = 40, embed: Embed | null = null): Promise<Hit[]>`
- **findItems** (function) `(db: Queryable, client: string, q: string, limit = 6): Promise<Found[]>`
- **itemOf** (function) `(db: Queryable, client: string, id: number): Promise<{ source: string | null; sops: { id: number; itemId: number | null; noteId: string | null; client: string | null; title: string | null; text: string | null; sop: string; state: "added" | "asked" | "failed"; file: string | null; points: Date | null; error: string | null; by: string | null; as…`
- **listItems** (function) `(db: Queryable, client: string, o: { saved?: boolean; waiting?: boolean; limit?: number } = {}): Promise<{ id: number; title: string; kind: "post" | "video" | "reel" | "article" | "film" | "episode"; url: string; score: number | null; verdict: "drop" | "hold" | "show" | null; readAt: Date | null; readFailure: string | null; savedAt: Date | null; source: string | null; }[]>`
- **Saved** (interface) `interface Saved { id: number; url: string; kind: ItemKind; fresh: boolean; unread: boolean; }`
- **Hit** (interface) `interface Hit { id: number; title: string; url: string; kind: string; source: string; score: number | null; savedAt: Date | null; at: Date; snippet: string; rank: number; }`
- **Found** (interface) `interface Found { id: number; title: string; kind: ItemKind; source: string; }`

## packages/learn/src/learnback.ts

- **saveOurs** (function) `(db: Db, client: string, pieces: OurPiece[]): Promise<{ ids: Map<string, number>; saved: number }>`
- **ourPatterns** (function) `(db: Db, ids: readonly number[]): Promise<Map<number, Map<string, string>>>`
- **patternsOf** (function) `(b: { hookStyle: string; ctaKind: string; facts: Record<string, unknown>; }): Map<string, string>`
- **checksOf** (function) `(sop: string, kind: ItemKind, patterns: PatternRule[], ours: { values: Map<string, string>; outcome: number }[], measure: CheckMeasure): CheckRow[]`
- **writeChecks** (function) `(db: Db, sop: string, rows: CheckRow[]): Promise<void>`
- **OurPiece** (interface) `interface OurPiece { draftId: string; kind: ItemKind; platform: string; url: string; title: string; text: string; outcome: number; measure: CheckMeasure; }`
- **MEASURE_OF** (const) `Partial<Record<ItemKind, CheckMeasure>>`
- **CheckRow** (type) `type CheckRow = typeof checks.$inferInsert;`

## packages/learn/src/links.ts

- **youtubeId** (function) `(url: URL): string | null`
- **cleanUrl** (function) `(raw: string): string`
- **kindOf** (function) `(clean: string, audio?: string | null): ItemKind`
- **creatorSite** (function) `(raw: string): string | null`
- **typeOf** (function) `(clean: string, kind: ItemKind, sourceKind?: SourceKind | null): ItemType`
- **youtubeThumb** (function) `(clean: string): string | null`
- **needsMac** (function) `(kind: ItemKind, media?: string | null): boolean`

## packages/learn/src/pictures.ts

- **keepPictures** (function) `(db: Db, store: PictureStore, fetchFn: FetchFn = fetch, limit = PICTURES_PER_PASS): Promise<PictureStats>`
- **makeLearnPictures** (function) `(db: Db, store: PictureStore | null): restate.ServiceDefinition<"LearnPictures", { sign: (_: restate.Context, req: { ref: string; }) => Promise<{ url: string | null; }>; }>`
- **PictureStore** (interface) `interface PictureStore { put(bytes: Uint8Array, ext: string): Promise<string>; sign(ref: string): Promise<string>; }`
- **isStoredPicture** (function) `(u: string | null | undefined): u is string`

## packages/learn/src/read.ts

- **pageText** (function) `(html: string): { title: string; creator: string | null; text: string; image: string | null; }`
- **fileOf** (function) `(url: string): string`
- **articleMd** (function) `(p: { url: string; title: string; creator: string | null; publishedAt: Date | null; text: string; }): string`
- **frontField** (function) `(md: string, key: string): string | null`
- **readItem** (function) `(db: Db, pages: Fetcher, id: number, video: VideoReader | null = null): Promise<ReadResult>`
- **waitingForMac** (function) `(db: Db, opts: { limit?: number; retry?: boolean; client?: string | null } = {}): Promise<{ id: number; client: string; url: string; kind: "post" | "video" | "reel" | "article" | "film" | "episode"; title: string; }[]>`
- **readVideo** (function) `(db: Db, reader: VideoReader, id: number, now = new Date()): Promise<ReadResult | "waits">`
- **pageFetcher** (function) `(): Fetcher`
- **readStep** (function) `(db: Db, pages: Fetcher, video: VideoReader | null = null): Step`
- **VideoReader** (type) `type VideoReader = (item: { url: string; kind: ItemKind; title: string; creator: string | null; duration: number | null; mediaUrl: string | null; }) => Promise<{ file: string; md: string }>;`

## packages/learn/src/records.ts

- **sopRecordFor** (function) `(sopsDir: string | null): import("@wren/core/records").RecordType`
- **LEARN_RECORDS** (const) `import("@wren/core/records").RecordType[]`

## packages/learn/src/schema.ts

- **learn** (const) `import("drizzle-orm/pg-core").PgSchema<"learn">`
- **VERDICTS** (const) `readonly ["show", "hold", "drop"]`
- **Verdict** (type) `type Verdict = (typeof VERDICTS)[number];`
- **SOURCE_KINDS** (const) `readonly ["youtube", "podcast", "newsletter", "blog", "reddit", "forum", "releases", "instagram", "x", "tiktok"]`
- **SourceKind** (type) `type SourceKind = (typeof SOURCE_KINDS)[number];`
- **TYPES** (const) `readonly ["youtube", "shorts", "podcast", "newsletter", "blog", "reddit", "x", "instagram", "tiktok", "releases", "link"]`
- **ItemType** (type) `type ItemType = (typeof TYPES)[number];`
- **Moment** (interface) `interface Moment { t: number; label: string; }`
- **TELLS** (const) `readonly ["every", "top", "digest"]`
- **Tell** (type) `type Tell = (typeof TELLS)[number];`
- **TOP_SCORE** (const) `8`
- **ITEM_KINDS** (const) `readonly ["article", "video", "reel", "post", "film", "episode"]`
- **PostStats** (interface) `interface PostStats { likes?: number; comments?: number; views?: number; }`
- **ItemKind** (type) `type ItemKind = (typeof ITEM_KINDS)[number];`
- **VIAS** (const) `readonly ["portal", "shortcut", "cli"]`
- **Via** (type) `type Via = (typeof VIAS)[number];`
- **SOP_STATES** (const) `readonly ["asked", "added", "failed"]`
- **SopState** (type) `type SopState = (typeof SOP_STATES)[number];`
- **sources** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sources"; schema: "learn"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sources"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey:…`
- **collections** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "collections"; schema: "learn"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "collections"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPri…`
- **items** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "items"; schema: "learn"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "items"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: fal…`
- **HOOK_STYLES** (const) `readonly ["contrarian", "demo-first", "result-first", "identity-call", "list-tease", "question", "story", "warning", "news", "how-to", "pattern-break", "other"]`
- **HookStyle** (type) `type HookStyle = (typeof HOOK_STYLES)[number];`
- **CTA_KINDS** (const) `readonly ["comment-word", "follow", "link", "dm", "save-share", "none", "other"]`
- **CtaKind** (type) `type CtaKind = (typeof CTA_KINDS)[number];`
- **POST_FORMATS** (const) `readonly ["talking-head", "screen-demo", "voiceover", "text-on-screen", "mixed"]`
- **PostFormat** (type) `type PostFormat = (typeof POST_FORMATS)[number];`
- **POST_MEDIA** (const) `readonly ["text", "image", "carousel", "doc", "video"]`
- **PostMedia** (type) `type PostMedia = (typeof POST_MEDIA)[number];`
- **POST_LINKS** (const) `readonly ["body", "comment", "none"]`
- **PostLink** (type) `type PostLink = (typeof POST_LINKS)[number];`
- **POST_SHAPES** (const) `readonly ["list", "story", "essay", "one-liner", "thread"]`
- **PostShape** (type) `type PostShape = (typeof POST_SHAPES)[number];`
- **SHOT_TYPES** (const) `readonly ["ui", "b-roll", "graphic", "logo", "text-card", "talking-head"]`
- **ShotType** (type) `type ShotType = (typeof SHOT_TYPES)[number];`
- **SHOT_MOVES** (const) `readonly ["static", "push", "pull", "pan", "track", "orbit", "roll", "rack-focus", "macro", "ui-zoom"]`
- **ShotMove** (type) `type ShotMove = (typeof SHOT_MOVES)[number];`
- **SHOT_INS** (const) `readonly ["cut", "dissolve", "fade", "whip"]`
- **ShotIn** (type) `type ShotIn = (typeof SHOT_INS)[number];`
- **SHOT_SOUNDS** (const) `readonly ["music", "vo", "both", "silent"]`
- **ShotSound** (type) `type ShotSound = (typeof SHOT_SOUNDS)[number];`
- **SHOT_SRCS** (const) `readonly ["hand", "scene"]`
- **ShotSrc** (type) `type ShotSrc = (typeof SHOT_SRCS)[number];`
- **CUTS_TRUSTS** (const) `readonly ["ok", "low"]`
- **CutsTrust** (type) `type CutsTrust = (typeof CUTS_TRUSTS)[number];`
- **BREAKDOWN_BYS** (const) `readonly ["model", "hand"]`
- **BreakdownBy** (type) `type BreakdownBy = (typeof BREAKDOWN_BYS)[number];`
- **Beat** (interface) `interface Beat { t: number | null; beat: string; }`
- **BreakdownRow** (type) `type BreakdownRow = typeof breakdowns.$inferSelect;`
- **breakdowns** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "breakdowns"; schema: "learn"; columns: { itemId: import("drizzle-orm/pg-core").PgColumn<{ name: "item_id"; tableName: "breakdowns"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDef…`
- **CHECK_MEASURES** (const) `readonly ["hook", "watched", "engagement"]`
- **CheckMeasure** (type) `type CheckMeasure = (typeof CHECK_MEASURES)[number];`
- **checks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "checks"; schema: "learn"; columns: { itemId: import("drizzle-orm/pg-core").PgColumn<{ name: "item_id"; tableName: "checks"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefault: fa…`
- **seen** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "seen"; schema: "learn"; columns: { client: import("drizzle-orm/pg-core").PgColumn<{ name: "client"; tableName: "seen"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimary…`
- **sopSources** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sop_sources"; schema: "learn"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "sop_sources"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPri…`
- **itemTags** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "item_tags"; schema: "learn"; columns: { itemId: import("drizzle-orm/pg-core").PgColumn<{ name: "item_id"; tableName: "item_tags"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: true; hasDefau…`
- **ALERT_PICKS** (const) `readonly ["every", "top", "off"]`
- **AlertPick** (type) `type AlertPick = (typeof ALERT_PICKS)[number];`
- **ALERT_WHYS** (const) `readonly ["new", "score", "saved"]`
- **AlertWhy** (type) `type AlertWhy = (typeof ALERT_WHYS)[number];`
- **ALERT_STATES** (const) `readonly ["bell", "digest"]`
- **AlertState** (type) `type AlertState = (typeof ALERT_STATES)[number];`
- **ALERTS_PER_HOUR** (const) `5`
- **alertPicks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "alert_picks"; schema: "learn"; columns: { client: import("drizzle-orm/pg-core").PgColumn<{ name: "client"; tableName: "alert_picks"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: fa…`
- **readers** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "readers"; schema: "learn"; columns: { client: import("drizzle-orm/pg-core").PgColumn<{ name: "client"; tableName: "readers"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false; isP…`
- **alerts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "alerts"; schema: "learn"; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "alerts"; dataType: "number"; columnType: "PgSerial"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: f…`
- **learnSettings** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "settings"; schema: "learn"; columns: { client: import("drizzle-orm/pg-core").PgColumn<{ name: "client"; tableName: "settings"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false; i…`
- **digests** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "digests"; schema: "learn"; columns: { day: import("drizzle-orm/pg-core").PgColumn<{ name: "day"; tableName: "digests"; dataType: "string"; columnType: "PgDateString"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrim…`
- **itemRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"item_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "item_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: fal…`
- **savedRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"saved_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "saved_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: f…`
- **sourceRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"source_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "source_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey:…`
- **breakdownRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"breakdown_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "breakdown_records"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrima…`
- **standards** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"standards", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "standards"; dataType: "number"; columnType: "PgInteger"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; is…`
- **hookRecords** (const) `import("drizzle-orm/pg-core").PgViewWithSelection<"hook_records", false, { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "hook_records"; dataType: "string"; columnType: "PgText"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoin…`

## packages/learn/src/score.ts

- **practiceOf** (function) `(name: string, sop: string): Practice`
- **momentsOf** (function) `(raw: readonly { at: string; label: string }[]): Moment[]`
- **chaptersOf** (function) `(transcript: string | null): Moment[]`
- **judges** (function) `(o: { db: Db; llm: LlmClient | null; wrenPractices: () => Promise<Practice[]>; now?: () => Date; keys?: KeyStore | null; }): JudgeFor`
- **scoreItem** (function) `(db: Db, judgeFor: JudgeFor, id: number): Promise<Verdict | null>`
- **unscore** (function) `(db: Db, client: string, ids: readonly number[]): Promise<number[]>`
- **itemIdOf** (function) `(e: { subject: string; data: Record<string, unknown> }): number`
- **Practice** (interface) `interface Practice { name: string; about: string; headings: string[]; }`
- **timed** (function) `(text: string): boolean`
- **verdictOf** (function) `(score: number): Verdict`
- **WREN_FOCUS** (const) `readonly string[]`
- **Judge** (interface) `interface Judge { name: string; wren: boolean; llm: LlmClient | null; practices: readonly Practice[]; focus?: readonly string[]; wait?: string | null; }`
- **JudgeFor** (type) `type JudgeFor = (client: string) => Promise<Judge>;`
- **scoreStep** (function) `(db: Db, judgeFor: JudgeFor, after?: (itemId: number) => Promise<unknown>): Step`

## packages/learn/src/sops.ts

- **askSop** (function) `(db: Db, p: { client: string; itemId: number; sop: string; by: string | null }): Promise<{ error: string | null; title: string | null; file: string | null; id: number; state: "added" | "asked" | "failed"; text: string | null; client: string | null; by: string | null; sop: string; askedAt: Date; itemId: number | null; noteId: string | null; points: Date | null; doneAt: Date | nul…`
- **writeAsked** (function) `(db: Db, sopsDir: string, writer: SopWriter, only?: { itemId?: number; sop?: string }): Promise<Array<{ sop: string; file: string | null; error: string | null }>>`
- **askNoteSop** (function) `(db: Db, notesDb: Db, p: { client: string; noteId: string; sop: string; title: string; text: string; by: string }): Promise<{ sop: string; state: "asked" | "added"; note: string | null }>`
- **sopLibrary** (function) `(db: Queryable, client: string, sopsDir: string | null): Promise<SopRow[]>`
- **writeClientAsked** (function) `(db: Db, client: string, notesDb: Db, only?: { itemId?: number }): Promise<Array<{ sop: string; note: string | null; error: string | null }>>`
- **clientAskedOnRead** (function) `(db: Db, clientDb: (client: string) => Db): (itemId: number) => Promise<void>`

## packages/learn/src/standard.ts

- **scopeOf** (function) `(notes: string, sop?: string): SopScope | null`
- **standardRows** (function) `(db: Queryable, scope: SopScope): Promise<StandardRow[]>`
- **kindStandard** (function) `(kind: string, rows: StandardRow[]): KindStandard`
- **standardOf** (function) `(db: Queryable, scope: SopScope): Promise<KindStandard[]>`
- **standardLines** (function) `(k: KindStandard): string[]`
- **kindStandardOf** (function) `(db: Queryable, scope: SopScope): Promise<KindStandard | null>`
- **standardMarkdown** (function) `(scope: SopScope, kinds: KindStandard[], at = new Date()): string`
- **callsOf** (function) `(db: Queryable, scope: SopScope, sop: string): Promise<SopCall[]>`
- **rulesOf** (function) `(calls: SopCall[]): { patterns: PatternRule[]; own: SopCall[] }`
- **callsMarkdown** (function) `(scope: SopScope, calls: SopCall[], at = new Date()): string`
- **writeSopFiles** (function) `(db: Queryable, dir: string, sop: string, notes: string): Promise<{ scope: SopScope; files: string[]; pieces: number; calls: number } | null>`
- **SopScope** (interface) `interface SopScope { kinds: string[]; platforms: string[]; topic: string; set: string[]; sop?: string; }`
- **StandardRow** (type) `type StandardRow = typeof standards.$inferSelect;`
- **median** (function) `(xs: number[]): number`
- **NUMBERS** (const) `Record< string, { key: keyof StandardRow; label: string; trusted?: boolean }[] >`
- **SHARES** (const) `Record<string, { key: keyof StandardRow; label: string }[]>`
- **KindStandard** (interface) `interface KindStandard { kind: string; n: number; trusted: number; numbers: { label: string; n: number; median: number; p25: number; p75: number }[]; shares: { label: string; n: number; of: [string, number][] }[]; }`
- **MIN_STANDARD** (const) `5`
- **draftScope** (function) `(playbook: { sop: string; scope: SopScope | null } | null, kind: string, platform: string): SopScope`
- **SopCall** (interface) `interface SopCall { id: number; title: string; creator: string | null; path: string; label: string; value: string; call: FactCall; comment: string | null; at: Date; }`
- **RULE_KEEPS** (const) `3`
- **PATTERN_PATHS** (const) `Set<string>`
- **patternValue** (function) `(path: string, value: string): string`
- **PatternRule** (interface) `interface PatternRule { path: string; label: string; value: string; keeps: number; tunes: number; drops: number; rule: boolean; calls: SopCall[]; }`

## packages/learn/src/tell.ts

- **tellLearn** (function) `(db: Db, notifier: Notifier, p: { today: string; hour: number; now: Date; portal?: string | null }): Promise<{ alerts: number; digest: number }>`
- **DIGEST_HOUR** (const) `9`
