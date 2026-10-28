# @wren/core: routes

Services: 12.

## Ask (service)

File: packages/core/src/ask.ts

- **answer** `{ id: string }` → `void` (restate.handlers.handler)
- **edit** `{ id: string }` → `void` (restate.handlers.handler)

## Broadcast (object)

File: packages/core/src/broadcast-run.ts

- **schedule** `{ at: string }` → `{ gen: number; at: string; }` (exclusiveHandler)
- **run** `{ gen: number }` → `RunStats | { skipped: string; waiting?: never; } | { waiting: string; skipped?: never; }` (exclusiveHandler)
- **status** `void` → `{ key: string; gen: number; last: {} | null; }` (sharedHandler)

## Executor (service)

File: packages/core/src/executor.ts

- **emit** `EmitRequest` → `Tally` (restate.handlers.handler)
- **release** `Target & { id: string; happened?: ExecutorEvent }` → `Tally | null` (restate.handlers.handler)
- **retry** `Target & { id: string; auto?: number }` → `Tally | null` (restate.handlers.handler)
- **fire** `Fired` → `{ entered: number; resolved: number; }` (restate.handlers.handler)
- **hook** `{ token: string; payload: unknown }` → `{ status: number; error: string; subject?: never; } | { status: number; subject: string; error?: never; }` (plain)
- **door** `{ hook: string; payload: unknown }` → `{ status: number; error: string; subject?: never; } | { status: number; subject: string; error?: never; }` (restate.handlers.handler)

## ExecutorClock (object)

File: packages/core/src/executor.ts

- **start** `void` → `{ next: string | null; }` (restate.handlers.object.exclusive)
- **stop** `void` → `void` (restate.handlers.object.exclusive)
- **tick** `{ slot: string }` → `void` (restate.handlers.object.exclusive)

## PeopleMap (object)

File: packages/core/src/people-map-pass.ts

- **wake** `void` → `PeopleMapStats | { error: string; } | { skipped: string; }` (exclusiveHandler)
- **status** `void` → `{ key: string; last: {} | null; }` (sharedHandler)

## o.name (service)

File: packages/core/src/portal.ts


## Segments (object)

File: packages/core/src/segments-pass.ts

- **wake** `void` → `{ recomputed: number; entered: number; left: number; archived: number[]; told: number; more: boolean; cursor: SegmentCursor; } | { skipped: string; error?: never; } | { error: string; skipped?: never; }` (exclusiveHandler)
- **status** `void` → `{ key: string; cursor: SegmentCursor | null; last: {} | null; }` (sharedHandler)

## SetupAgent (service)

File: packages/core/src/setup-agent.ts

- **run** `AgentJob` → `AgentAnswer` (serviceHandler)

## Executor@packages/core/src/testing.ts (service)

File: packages/core/src/testing.ts

- **emit** `(typeof emitted)[number]` → `{ arrived: number; seen: number; waiting: number; failed: number; out: number; }` (plain)

## Tokens (service)

File: packages/core/src/tokens.ts

- **check** `{ token: string }` → `restate.RestatePromise<TokenViewer | null>` (serviceHandler)

## Webhooks (service)

File: packages/core/src/webhooks.ts

- **publish** `Published` → `{ queued: number; }` (restate.handlers.handler)
- **deliver** `{ id: string }` → `{ state: string; }` (restate.handlers.handler)
- **redeliver** `{ id: string }` → `{ id: string; }` (serviceHandler)

## Content (service)

File: packages/core/src/content/restate.ts

- **platforms** `void` → `Platform[]` (serviceHandler)
- **publish** `{ platform: Platform; post: Post } & ForClient & AsAccount & Keyed` → `Published | Delivery<Published>` (serviceHandler)
- **list** `{ platform: Platform; q?: ListQuery } & ForClient` → `import("./index.js").PublishedRow[]` (serviceHandler)
- **metrics** `{ platform: Platform; id: string } & ForClient` → `Metrics` (serviceHandler)
- **metricsMany** `{ platform: Platform; posts: { id: string; kind?: string | null }[] } & ForClient` → `Metrics[] | null` (serviceHandler)
- **commentCounts** `{ platform: Platform; ids: string[] } & ForClient` → `Record<string, number> | null` (serviceHandler)
- **comments** `{ platform: Platform; id: string; q?: ListQuery } & ForClient` → `CommentRow[]` (serviceHandler)
- **reply** `{ platform: Platform; commentId: string; postId?: string | null; text: string; } & ForClient & AsAccount & Keyed` → `void | Delivery<void>` (serviceHandler)
- **arm** `{ platform: Platform; commentId: string; postId?: string | null; text: string; } & ForClient` → `{ armed: boolean }` (serviceHandler)
- **privateReply** `{ platform: Platform; commentId: string; text: string } & ForClient & Keyed` → `{ ref: string | null } | Delivery<{ ref: string | null }>` (serviceHandler)
- **update** `{ platform: Platform; id: string; patch: PostPatch } & ForClient` → `void` (serviceHandler)
- **reviews** `{ platform: Platform; q?: ActivityQuery | null } & ForClient` → `CommentRow[] | null` (serviceHandler)
- **activity** `{ platform: Platform; q?: ActivityQuery | null } & ForClient` → `ActivityRow[] | null` (serviceHandler)
- **following** `{ platform: Platform } & ForClient` → `FollowingRow[] | null` (serviceHandler)
- **ownComments** `{ platform: Platform } & ForClient` → `OwnCommentRow[] | null` (serviceHandler)
- **audience** `{ platform: Platform } & ForClient` → `Audience | null` (serviceHandler)
- **insights** `{ platform: Platform; id: string; published?: string | null; kind?: string | null; media?: "image" | "video" | null; read?: unknown; } & ForClient` → `Insights | null` (serviceHandler)
- **accountInsights** `{ platform: Platform } & ForClient` → `AccountInsights | null` (serviceHandler)
- **reportDays** `{ platform: Platform; after?: string | null } & ForClient` → `ReportDays | null` (serviceHandler)
