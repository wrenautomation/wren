# @wren/content: routes

Services: 16.

## SocialCallback (service)

File: packages/content/src/connect/console.ts

- **land** `z.infer<typeof SOCIAL_LANDING>` → `{ ok: boolean; said: string; }` (serviceHandler)

## AutoReply (object)

File: packages/content/src/restate/auto-reply.ts

- **arrived** `Arrived` → `{ asked: number | null; why: string }` (restate.handlers.object.exclusive)

## Blog (object)

File: packages/content/src/restate/blog.ts

- **posts** `void` → `{ on: boolean; site: string; posts: { date: string; createdAt: Date; updatedAt: Date; description: string; title: string; body: string; draft: boolean; updatedBy: string | null; slug: string; publishedAt: Date | null; emailedAt: Date | null; commitSha: string | null; fromRef: string | null; }[]; }` (sharedHandler)
- **save** `{ slug?: string; title: string; description: string; body: string; publish: boolean; from?: string | null; viewer?: unknown; }` → `{ post: { date: string; createdAt: Date; updatedAt: Date; description: string; title: string; body: string; draft: boolean; updatedBy: string | null; slug: string; publishedAt: Date | null; emailedAt: Date | null; commitSha: string | null; fromRef: string | null; }; url: string; }` (exclusiveHandler)
- **audience** `{ slug: string }` → `{ live: boolean; tally: Record<string, number>; sent: number; }` (sharedHandler)
- **email** `{ slug: string; test?: string }` → `{ sending: boolean; test: string | null; }` (exclusiveHandler)

## Chat (service)

File: packages/content/src/restate/chat.ts

- **say** `Req` → `Answer` (plain)
- **read** `Req` → `Answer` (plain)

## ContentDesk (object)

File: packages/content/src/restate/desk.ts


## DraftAsk (service)

File: packages/content/src/restate/draft-ask.ts

- **ask** `Item & { message: string }` → `{ id: string; }` (serviceHandler)
- **set** `Item & { text?: string; expect?: string | null; account?: string | null }` → `{ run?: string; turn?: DraftTurn | null; version?: string | null; accounts?: AccountPick | null; }` (serviceHandler)
- **undo** `Item` → `{ run: string; before: string | null; turn: DraftTurn | null; version: string | null; }` (serviceHandler)
- **answer** `{ id: string }` → `undefined` (restate.handlers.handler)

## InboxDesk (service)

File: packages/content/src/restate/inbox-desk.ts

- **autoReplies** `Req` → `{ modes: Record<InboxChannel, AutoReplyMode>; held: boolean }` (serviceHandler)
- **autoReplySet** `Req & { channel: InboxChannel; mode: AutoReplyMode }` → `{ modes: Record<InboxChannel, AutoReplyMode>; held: boolean }` (serviceHandler)
- **reply** `Req & { thread: string; channel: InboxChannel; target: string; body: string }` → `{ sent: boolean; asked: number | null; why: string | null; copy?: Copied; }` (serviceHandler)
- **ask** `Req & { thread: string; channel: InboxChannel; target: string; body: string }` → `{ asked: number }` (serviceHandler)
- **approve** `Req & { id: number }` → `{ sent: boolean; queued?: string; copy?: Copied }` (serviceHandler)
- **release** `{ id: number; client?: string }` → `{ state: "sent" | "queued" | "failed" | "gone" }` (serviceHandler)
- **drop** `Req & { id: number }` → `{ dropped: boolean }` (serviceHandler)
- **suggest** `Req & { thread: string; channel: InboxChannel; target: string }` → `{ text: string | null }` (serviceHandler)
- **note** `Req & { thread: string; body: string }` → `{ id: string; mentioned: string[] }` (serviceHandler)
- **assign** `Req & { thread: string; assignee?: string | null }` → `{ assignee: string | null }` (serviceHandler)
- **take** `Req & { thread: string }` → `{ assignee: string }` (serviceHandler)
- **status** `Req & { thread: string; status: InboxStatus }` → `{ status: InboxStatus }` (serviceHandler)
- **snooze** `Req & { thread: string; until?: string | null }` → `{ until: string | null }` (serviceHandler)

## KeywordDm (service)

File: packages/content/src/restate/keyword-dm.ts

- **add** `z.infer<typeof ADD>` → `restate.RestatePromise<{ id: number; keyword: string; }>` (serviceHandler)
- **remove** `{ ids: unknown[] }` → `{ done: number; }` (serviceHandler)
- **send** `Send` → `{ state: string }` (serviceHandler)

## MailReply (service)

File: packages/content/src/restate/mail-reply.ts

- **send** `{ client: string; mailId: number; body: string; by?: string | null }` → `{ id: string | null }` (serviceHandler)

## Pieces (object)

File: packages/content/src/restate/pieces.ts

- **list** `void` → `{ pieces: import("../pieces.js").Piece[]; }` (sharedHandler)

## ClientReport (object)

File: packages/content/src/restate/reports.ts

- **run** `{ chain?: string }` → `{ state: "stale" | "off" | "ran" | "waiting"; nextAt: string | null }` (restate.handlers.object.exclusive)

## SocialInbox (service)

File: packages/content/src/restate/social-inbox.ts

- **read** `{ client: string }` → `{ accounts: number; threads: number; messages: number; errors: string[]; }` (serviceHandler)
- **send** `{ client: string; contactId: number; body: string; by?: string | null; again?: boolean; }` → `{ ref: string | null }` (serviceHandler)
- **answer** `{ client: string; id: number; body: string; by?: string | null; again?: boolean }` → `{ ok: true }` (serviceHandler)
- **settle** `{ client: string; item: string; outcome: SettleOutcome; by?: string | null }` → `{ item: string; outcome: SettleOutcome }` (serviceHandler)

## SocialPushed (object)

File: packages/content/src/restate/social-push.ts

- **add** `Pushed[]` → `number` (exclusiveHandler)
- **take** `void` → `Pushed[]` (exclusiveHandler)
- **alive** `{ platform: string }` → `void` (exclusiveHandler)
- **reach** `void` → `ReachView` (exclusiveHandler)

## SocialPush (service)

File: packages/content/src/restate/social-push.ts

- **meta** `unknown` → `PushResult` (serviceHandler)
- **gbp** `unknown` → `PushResult` (serviceHandler)
- **watch** `z.infer<typeof WATCH>` → `PushResult` (serviceHandler)

## SocialDesk (service)

File: packages/content/src/restate/social.ts

- **markSeen** `{ ids: number[] }` → `{ seen: number }` (serviceHandler)
- **markAllSeen** `void` → `{ seen: number }` (serviceHandler)
- **readPost** `{ id: number }` → `{ read: boolean; kept: number }` (serviceHandler)
- **readAudience** `{ platform: Platform }` → `{ platform: Platform; day: string; followers: number; }` (serviceHandler)

## VideoDesk (service)

File: packages/content/src/restate/video-desk.ts

- **set** `One & { patch: unknown; expect?: Record<string, unknown>; proposal?: string }` → `{ run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **propose** `One & { sentence: string; beat?: string | null }` → `import("@wren/studio/change").Proposal` (serviceHandler)
- **line** `One & { at: number[]; text: string; was: string }` → `{ run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **cut** `One & { from: number; to: number; state: "cut" | "kept" }` → `{ run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **words** `One & { wrong?: string | null; right?: string | null; at?: number | null; text?: string | null; }` → `{ n: number; run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **stress** `One` → `{ n: number; run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **punctuate** `One` → `{ n: number; run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **swap** `One & { short?: number | null }` → `{ run: string; swapped: number; missing: number; }` (serviceHandler)
- **undo** `One` → `{ run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **ask** `One & { message: string }` → `{ run: string; }` (serviceHandler)
- **render** `One & { only?: string; again?: boolean }` → `{ queued: boolean; }` (serviceHandler)
- **edit** `One & { note?: string | null }` → `{ run: string; }` (serviceHandler)
- **reject** `One & { note?: string | null }` → `{ run: string; }` (serviceHandler)
- **restore** `One` → `{ run: string; state: string; }` (serviceHandler)
- **rendering** `{ id: number; only?: string; again?: boolean }` → `void` (restate.handlers.handler)
- **editing** `{ run: string }` → `undefined` (restate.handlers.handler)
- **answer** `{ run: string }` → `undefined` (restate.handlers.handler)
