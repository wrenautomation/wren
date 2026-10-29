# @wren/content: routes

Services: 18.

## AutoReply (object)

File: packages/content/src/restate/auto-reply.ts

- **arrived** `Arrived` → `{ asked: number | null; why: string }` (restate.handlers.object.exclusive)

## Blog (object)

File: packages/content/src/restate/blog.ts

- **audience** `{ slug: string }` → `{ live: boolean; tally: Record<string, number>; sent: number; }` (sharedHandler)
- **email** `{ slug: string; test?: string }` → `{ sending: boolean; test: string | null; }` (exclusiveHandler)
- **posts** `void` → `{ on: boolean; site: string; posts: { date: string; description: string; title: string; createdAt: Date; updatedAt: Date; body: string; draft: boolean; updatedBy: string | null; publishedAt: Date | null; slug: string; emailedAt: Date | null; commitSha: string | null; fromRef: string | null; }[]; }` (sharedHandler)
- **save** `{ slug?: string; title: string; description: string; body: string; publish: boolean; from?: string | null; viewer?: unknown; }` → `{ post: { date: string; description: string; title: string; createdAt: Date; updatedAt: Date; body: string; draft: boolean; updatedBy: string | null; publishedAt: Date | null; slug: string; emailedAt: Date | null; commitSha: string | null; fromRef: string | null; }; url: string; }` (exclusiveHandler)

## Chat (service)

File: packages/content/src/restate/chat.ts

- **read** `Req` → `Answer` (plain)
- **say** `Req` → `Answer` (plain)

## ClientReport (object)

File: packages/content/src/restate/reports.ts

- **run** `{ chain?: string }` → `{ state: "stale" | "off" | "ran" | "waiting"; nextAt: string | null }` (restate.handlers.object.exclusive)

## ContentDesk (object)

File: packages/content/src/restate/desk.ts

- **add** `{ text: string; media?: Media | null; draft?: boolean; platforms?: Platform[]; source?: IdeaSource; }` → `{ idea: ContentIdea; drafts: DraftReport | null }` (exclusiveHandler)
- **approve** `{ ids: string[]; now?: boolean | null; at?: string | null; expect?: string | null; viewer?: unknown; }` → `{ done: string[]; }` (exclusiveHandler)
- **approveVideo** `{ id: number; short?: number | null; vertical?: boolean | null; privacy?: VideoPrivacy | null; replace?: boolean | null; publishAt?: string | null; }` → `{ done: string[]; }` (exclusiveHandler)
- **attach** `{ draftId: string; field: string; name: string; data: string; viewer?: unknown }` → `{ done: string[]; }` (exclusiveHandler)
- **carousel** `{ slides: { title: string; lines: string[] }[]; text: string; platforms: CarouselPlatform[]; go?: WriteGo | null; viewer?: unknown; }` → `{ posts: { ideaId: string; results: import("./desk-context.js").WriteResult[]; }[]; }` (exclusiveHandler)
- **check** `{ draftId: string }` → `{ check: DraftCheck | null; why: string | null }` (sharedHandler)
- **draft** `DraftRequest` → `DraftReport` (exclusiveHandler)
- **edit** `{ draftId: string; text: string; title?: string | null; viewer?: unknown }` → `{ done: string[]; }` (exclusiveHandler)
- **fields** `{ draftId: string; patch: Record<string, unknown>; viewer?: unknown }` → `{ done: string[]; saved?: import("../shape-view.js").FieldsSaved; }` (exclusiveHandler)
- **funnel** `FunnelRequest` → `{ done: string[]; }` (exclusiveHandler)
- **pickThumbnail** `{ id: number; n: number }` → `{ done: string[]; }` (exclusiveHandler)
- **promote** `{ video?: number | null; draftId?: string | null; platforms?: PromoPlatform[] | null; again?: boolean | null; pieces?: PromoPiece[] | null; viewer?: unknown; }` → `DraftReport` (exclusiveHandler)
- **redraft** `{ draftId: string; note: string }` → `DraftReport` (exclusiveHandler)
- **reject** `{ ids: string[]; reason?: string | null; note?: string | null; viewer?: unknown }` → `{ done: string[]; }` (exclusiveHandler)
- **settlePost** `{ id: string; outcome: SettleOutcome; by: string }` → `{ id: string; outcome: SettleOutcome; found: boolean }` (exclusiveHandler)
- **slides** `{ draftId: string; slides?: { title: string; lines: string[] }[] | null; draw?: boolean | null; viewer?: unknown; }` → `{ done: string[]; saved?: SlidesSaved }` (exclusiveHandler)
- **story** `{ platforms: StoryPlatform[]; photo?: { name: string; data: string } | null; clip?: string | null; go?: WriteGo | null; viewer?: unknown; }` → `{ posts: { ideaId: string; results: import("./desk-context.js").WriteResult[]; }[]; }` (exclusiveHandler)
- **storyClips** `void` → `{ clips: import("../story.js").StoryClip[]; }` (sharedHandler)
- **swap** `{ draftId: string; field: VariantField; value: string; why?: string | null; viewer?: unknown; }` → `{ id: number }` (exclusiveHandler)
- **swapApprove** `{ ids: number[]; viewer?: unknown }` → `{ done: number[] }` (exclusiveHandler)
- **swapSkip** `{ ids: number[]; viewer?: unknown }` → `{ done: number[] }` (exclusiveHandler)
- **waiting** `void` → `{ ideas: import("../own.js").WaitingIdea[]; }` (sharedHandler)
- **write** `{ text: string; title?: string | null; platforms: Platform[]; adapt?: boolean | null; thread?: boolean | null; go?: WriteGo | null; from?: string | null; media?: Media | null; line?: string | null; angle?: IdeaAngle | null; viewer?: unknown; }` → `{ posts: { ideaId: string; results: WriteResult[]; }[]; }` (exclusiveHandler)

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

## MarketingConsole (service via `portalService`)

File: packages/content/src/restate/marketing-console.ts

- **approveDraft** `ApproveRequest` → `{ done: string[]; }` (serviceHandler)
- **draftAttach** `AttachRequest` → `{ done: string[]; }` (serviceHandler)
- **draftFields** `FieldsRequest` → `{ done: string[]; saved?: import("../shape-view.js").FieldsSaved; }` (serviceHandler)
- **draftFunnel** `FunnelConsoleRequest` → `{ done: string[]; }` (serviceHandler)
- **draftSlides** `SlidesRequest` → `{ done: string[]; saved?: import("../shape-view.js").SlidesSaved; }` (serviceHandler)
- **inboxApprove** `PortalRequest & { id: number }` → `{ sent: boolean; queued?: string; copy?: import("../inbox/send.js").Copied; }` (serviceHandler)
- **inboxAsk** `InboxReplyRequest` → `{ asked: number; }` (serviceHandler)
- **inboxAssign** `ThreadRequest & { assignee?: string | null }` → `{ assignee: string | null; }` (serviceHandler)
- **inboxAuto** `PortalRequest` → `{ modes: Record<InboxChannel, AutoReplyMode>; held: boolean; }` (serviceHandler)
- **inboxAutoSet** `PortalRequest & { channel: InboxChannel; mode: AutoReplyMode }` → `{ modes: Record<InboxChannel, AutoReplyMode>; held: boolean; }` (serviceHandler)
- **inboxDrop** `PortalRequest & { id: number }` → `{ dropped: boolean; }` (serviceHandler)
- **inboxNote** `ThreadRequest & { body: string }` → `{ id: string; mentioned: string[]; }` (serviceHandler)
- **inboxReply** `InboxReplyRequest` → `{ sent: boolean; asked: number | null; why: string | null; copy?: import("../inbox/send.js").Copied; }` (serviceHandler)
- **inboxSnooze** `ThreadRequest & { until?: string | null }` → `{ until: string | null; }` (serviceHandler)
- **inboxStatus** `ThreadRequest & { status: InboxStatus }` → `{ status: InboxStatus; }` (serviceHandler)
- **inboxSuggest** `Omit<InboxReplyRequest, "body">` → `{ text: string | null; }` (serviceHandler)
- **inboxTake** `ThreadRequest` → `{ assignee: string; }` (serviceHandler)
- **promote** `PromoteRequest` → `{ started: boolean; platforms: ("linkedin" | "reddit" | "instagram" | "x")[]; }` (serviceHandler)
- **recordsExport** `PortalRequest & ExportAsk` → `import("@wren/core/records/serve").RecordsFile` (serviceHandler)
- **recordsGet** `PortalRequest & GetAsk` → `import("@wren/core/records/serve").RecordAnswer` (serviceHandler)
- **recordsList** `PortalRequest & ListAsk` → `import("@wren/core/records/serve").RecordsPage` (serviceHandler)
- **recordsStats** `PortalRequest & StatsAsk` → `import("@wren/core/records/serve").RecordsStat` (serviceHandler)
- **recordsTypes** `PortalRequest` → `import("@wren/core/records").RecordMeta[]` (serviceHandler)
- **redraft** `RedraftRequest` → `import("./desk-context.js").DraftReport` (serviceHandler)
- **rejectDraft** `RejectRequest` → `{ done: string[]; }` (serviceHandler)
- **reportDelete** `PortalRequest & { id: number }` → `{ ok: boolean; }` (serviceHandler)
- **reportRun** `PortalRequest & { id: number }` → `{ id: number | null; }` (serviceHandler)
- **reportSave** `ReportSaveRequest` → `{ id: number; }` (serviceHandler)
- **reports** `PortalRequest` → `{ mail: boolean; zone: string; reports: { sends: { id: number; from: string; to: string; closed: boolean; lines: import("../client-reports/tiles.js").ReportLine[]; sentTo: string[]; why: string | null; by: string | null; at: string; }[]; id: number; name: string; tiles: ("calls" | "views" | "bookings" | "paid" | "forms" | "post_visits" | "ad_impressions" | "search_impressions" | "visits" | "spend")[]; every: "week" | "month"; zone: string; recipients: string[]; on: boolean; nextAt: string | null; by: string; updatedAt: string; }[]; members: { email: string; role: string; }[]; }` (serviceHandler)
- **sendSettle** `SettleRequest` → `{ item: string; outcome: SettleOutcome; }` (serviceHandler)

## Pieces (object)

File: packages/content/src/restate/pieces.ts

- **list** `void` → `{ pieces: import("../pieces.js").Piece[]; }` (sharedHandler)

## SocialAccess (service via `portalService`)

File: packages/content/src/connect/console.ts

- **check** `?` → `?` (serviceHandler)
- **connect** `?` → `?` (serviceHandler)
- **disconnect** `?` → `?` (serviceHandler)
- **ownCheck** `PortalRequest & { platform: string; requestId?: string }` → `OwnCheck` (serviceHandler)
- **social** `?` → `?` (serviceHandler)

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
