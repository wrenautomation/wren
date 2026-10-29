# @wren/content: routes

Services: 16.

## AutoReply (object)

File: packages/content/src/restate/auto-reply.ts

- **arrived** `Arrived` → `{ asked: number | null; why: string }` (restate.handlers.object.exclusive)

## Blog (object)

File: packages/content/src/restate/blog.ts

- **audience** `{ slug: string }` → `{ live: boolean; tally: Record<string, number>; sent: number; }` (sharedHandler)
- **email** `{ slug: string; test?: string }` → `{ sending: boolean; test: string | null; }` (exclusiveHandler)
- **posts** `void` → `{ on: boolean; site: string; posts: { date: string; createdAt: Date; updatedAt: Date; description: string; title: string; body: string; draft: boolean; updatedBy: string | null; slug: string; publishedAt: Date | null; emailedAt: Date | null; commitSha: string | null; fromRef: string | null; }[]; }` (sharedHandler)
- **save** `{ slug?: string; title: string; description: string; body: string; publish: boolean; from?: string | null; viewer?: unknown; }` → `{ post: { date: string; createdAt: Date; updatedAt: Date; description: string; title: string; body: string; draft: boolean; updatedBy: string | null; slug: string; publishedAt: Date | null; emailedAt: Date | null; commitSha: string | null; fromRef: string | null; }; url: string; }` (exclusiveHandler)

## Chat (service)

File: packages/content/src/restate/chat.ts

- **read** `Req` → `Answer` (plain)
- **say** `Req` → `Answer` (plain)

## ClientReport (object)

File: packages/content/src/restate/reports.ts

- **run** `{ chain?: string }` → `{ state: "stale" | "off" | "ran" | "waiting"; nextAt: string | null }` (restate.handlers.object.exclusive)

## ContentDesk (object)

File: packages/content/src/restate/desk.ts


## DraftAsk (service)

File: packages/content/src/restate/draft-ask.ts

- **answer** `{ id: string }` → `undefined` (restate.handlers.handler)
- **ask** `Item & { message: string }` → `{ id: string; }` (serviceHandler)
- **set** `Item & { text?: string; expect?: string | null; account?: string | null }` → `{ run?: string; turn?: DraftTurn | null; version?: string | null; accounts?: AccountPick | null; }` (serviceHandler)
- **undo** `Item` → `{ run: string; before: string | null; turn: DraftTurn | null; version: string | null; }` (serviceHandler)

## InboxDesk (service)

File: packages/content/src/restate/inbox-desk.ts

- **approve** `Req & { id: number }` → `{ sent: boolean; queued?: string; copy?: Copied }` (serviceHandler)
- **ask** `Req & { thread: string; channel: InboxChannel; target: string; body: string }` → `{ asked: number }` (serviceHandler)
- **assign** `Req & { thread: string; assignee?: string | null }` → `{ assignee: string | null }` (serviceHandler)
- **autoReplies** `Req` → `{ modes: Record<InboxChannel, AutoReplyMode>; held: boolean }` (serviceHandler)
- **autoReplySet** `Req & { channel: InboxChannel; mode: AutoReplyMode }` → `{ modes: Record<InboxChannel, AutoReplyMode>; held: boolean }` (serviceHandler)
- **drop** `Req & { id: number }` → `{ dropped: boolean }` (serviceHandler)
- **note** `Req & { thread: string; body: string }` → `{ id: string; mentioned: string[] }` (serviceHandler)
- **release** `{ id: number; client?: string }` → `{ state: "sent" | "queued" | "failed" | "gone" }` (serviceHandler)
- **reply** `Req & { thread: string; channel: InboxChannel; target: string; body: string }` → `{ sent: boolean; asked: number | null; why: string | null; copy?: Copied; }` (serviceHandler)
- **snooze** `Req & { thread: string; until?: string | null }` → `{ until: string | null }` (serviceHandler)
- **status** `Req & { thread: string; status: InboxStatus }` → `{ status: InboxStatus }` (serviceHandler)
- **suggest** `Req & { thread: string; channel: InboxChannel; target: string }` → `{ text: string | null }` (serviceHandler)
- **take** `Req & { thread: string }` → `{ assignee: string }` (serviceHandler)

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

## SocialCallback (service)

File: packages/content/src/connect/console.ts

- **land** `z.infer<typeof SOCIAL_LANDING>` → `{ ok: boolean; said: string; }` (serviceHandler)

## SocialDesk (service)

File: packages/content/src/restate/social.ts

- **markAllSeen** `void` → `{ seen: number }` (serviceHandler)
- **markSeen** `{ ids: number[] }` → `{ seen: number }` (serviceHandler)
- **readAudience** `{ platform: Platform }` → `{ platform: Platform; day: string; followers: number; }` (serviceHandler)
- **readPost** `{ id: number }` → `{ read: boolean; kept: number }` (serviceHandler)

## SocialInbox (service)

File: packages/content/src/restate/social-inbox.ts

- **answer** `{ client: string; id: number; body: string; by?: string | null; again?: boolean }` → `{ ok: true }` (serviceHandler)
- **read** `{ client: string }` → `{ accounts: number; threads: number; messages: number; errors: string[]; }` (serviceHandler)
- **send** `{ client: string; contactId: number; body: string; by?: string | null; again?: boolean; }` → `{ ref: string | null }` (serviceHandler)
- **settle** `{ client: string; item: string; outcome: SettleOutcome; by?: string | null }` → `{ item: string; outcome: SettleOutcome }` (serviceHandler)

## SocialPush (service)

File: packages/content/src/restate/social-push.ts

- **gbp** `unknown` → `PushResult` (serviceHandler)
- **meta** `unknown` → `PushResult` (serviceHandler)
- **watch** `z.infer<typeof WATCH>` → `PushResult` (serviceHandler)

## SocialPushed (object)

File: packages/content/src/restate/social-push.ts

- **add** `Pushed[]` → `number` (exclusiveHandler)
- **alive** `{ platform: string }` → `void` (exclusiveHandler)
- **reach** `void` → `ReachView` (exclusiveHandler)
- **take** `void` → `Pushed[]` (exclusiveHandler)

## VideoDesk (service)

File: packages/content/src/restate/video-desk.ts

- **answer** `{ run: string }` → `undefined` (restate.handlers.handler)
- **ask** `One & { message: string }` → `{ run: string; }` (serviceHandler)
- **cut** `One & { from: number; to: number; state: "cut" | "kept" }` → `{ run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **edit** `One & { note?: string | null }` → `{ run: string; }` (serviceHandler)
- **editing** `{ run: string }` → `undefined` (restate.handlers.handler)
- **line** `One & { at: number[]; text: string; was: string }` → `{ run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **propose** `One & { sentence: string; beat?: string | null }` → `import("@wren/studio/change").Proposal` (serviceHandler)
- **punctuate** `One` → `{ n: number; run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **reject** `One & { note?: string | null }` → `{ run: string; }` (serviceHandler)
- **render** `One & { only?: string; again?: boolean }` → `{ queued: boolean; }` (serviceHandler)
- **rendering** `{ id: number; only?: string; again?: boolean }` → `void` (restate.handlers.handler)
- **restore** `One` → `{ run: string; state: string; }` (serviceHandler)
- **set** `One & { patch: unknown; expect?: Record<string, unknown>; proposal?: string }` → `{ run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **stress** `One` → `{ n: number; run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **swap** `One & { short?: number | null }` → `{ run: string; swapped: number; missing: number; }` (serviceHandler)
- **undo** `One` → `{ run: string; view: import("../video.js").VideoView; }` (serviceHandler)
- **words** `One & { wrong?: string | null; right?: string | null; at?: number | null; text?: string | null; }` → `{ n: number; run: string; view: import("../video.js").VideoView; }` (serviceHandler)
