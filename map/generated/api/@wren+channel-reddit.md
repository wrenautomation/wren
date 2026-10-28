# @wren/channel-reddit: interface

Exports: 19. Files: 6.

## packages/channel-reddit/src/api.ts

- **redditApi** (function) `(o: RedditApiOptions): SiteClient`
- **REDDIT_TOKEN_URL** (const) `"https://www.reddit.com/api/v1/access_token"`

## packages/channel-reddit/src/content.ts

- **answerOf** (function) `(path: string, a: JsonAnswer<T>): T`
- **redditContent** (function) `(sites: SiteClient, o: RedditContentOptions = {}): ContentChannel`
- **REDDIT_SITE** (const) `"reddit"`
- **Thing** (interface) `interface Thing { id: string; name: string; title?: string; selftext?: string; body?: string; author?: string; author_fullname?: string; permalink?: string; created_utc?: number; score?: number; num_comments?: number; num_crossposts?: number; view_count?: number | null; upvote_ratio?: number; link_id?: string; link_author?: string; parent_id?: string; }`
- **Listing** (interface) `interface Listing { kind?: string; data?: { children?: Array<{ kind: string; data: Thing }>; after?: string | null }; }`
- **redditUrl** (function) `(permalink: string): string`

## packages/channel-reddit/src/outreach.ts

- **parseFindQuery** (function) `(query: string): { sr: string | null; words: string }`
- **redditOutreach** (function) `(sites: import("@wren/core/content").SiteClient, o: RedditOutreachOptions): RedditOutreach`
- **postOf** (function) `(context: string | undefined): string | null`

## packages/channel-reddit/src/thread.ts

- **threadOf** (function) `(post: string, answer: [Listing, Listing] | unknown, now: () => Date): ThreadRead`
- **threadQuery** (function) `(focus?: string | null): { comment: string; context: number; raw_json: 1; limit: 500; depth: 10; sort: "old"; } | { raw_json: 1; limit: 500; depth: 10; sort: "old"; }`

## packages/channel-reddit/src/warmup.ts

- **warmupOf** (function) `(health: AccountHealth, now: Date): Warmup`
- **WarmupStage** (type) `type WarmupStage = "lurk" | "comment" | "post" | "reach";`
- **Warmup** (interface) `interface Warmup { stage: WarmupStage; caps: WarmupCaps; ageDays: number; karma: number; next: string; frozen: string | null; }`
- **STAGES** (const) `Record<WarmupStage, { minDays: number; minKarma: number; caps: StageCaps }>`
- **REACH_FULL_KARMA** (const) `50`

## packages/core/src/objects/canon.ts

- **commentRef** (function) `(raw: string): string`
