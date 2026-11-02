# @wren/starling-core: routes

Services: 1.

## Content (service)

File: packages/starling/core/src/service.ts

- **accountInsights** `{ platform: Platform } & ForClient` → `AccountInsights | null` (serviceHandler)
- **activity** `{ platform: Platform; q?: ActivityQuery | null } & ForClient` → `ActivityRow[] | null` (serviceHandler)
- **arm** `{ platform: Platform; commentId: string; postId?: string | null; text: string; } & ForClient` → `{ armed: boolean }` (serviceHandler)
- **audience** `{ platform: Platform } & ForClient` → `Audience | null` (serviceHandler)
- **commentCounts** `{ platform: Platform; ids: string[] } & ForClient` → `Record<string, number> | null` (serviceHandler)
- **comments** `{ platform: Platform; id: string; q?: ListQuery } & ForClient` → `CommentRow[]` (serviceHandler)
- **following** `{ platform: Platform } & ForClient` → `FollowingRow[] | null` (serviceHandler)
- **insights** `{ platform: Platform; id: string; published?: string | null; kind?: string | null; media?: "image" | "video" | null; read?: unknown; } & ForClient` → `Insights | null` (serviceHandler)
- **list** `{ platform: Platform; q?: ListQuery } & ForClient` → `import("./index.js").PublishedRow[]` (serviceHandler)
- **metrics** `{ platform: Platform; id: string } & ForClient` → `Metrics` (serviceHandler)
- **metricsMany** `{ platform: Platform; posts: { id: string; kind?: string | null }[] } & ForClient` → `Metrics[] | null` (serviceHandler)
- **ownComments** `{ platform: Platform } & ForClient` → `OwnCommentRow[] | null` (serviceHandler)
- **platforms** `void` → `Platform[]` (serviceHandler)
- **privateReply** `{ platform: Platform; commentId: string; text: string } & ForClient & Keyed` → `{ ref: string | null } | Delivery<{ ref: string | null }>` (serviceHandler)
- **publish** `{ platform: Platform; post: Post } & ForClient & AsAccount & Keyed` → `Published | Delivery<Published>` (serviceHandler)
- **reply** `{ platform: Platform; commentId: string; postId?: string | null; text: string; } & ForClient & AsAccount & Keyed` → `void | Delivery<void>` (serviceHandler)
- **reportDays** `{ platform: Platform; after?: string | null } & ForClient` → `ReportDays | null` (serviceHandler)
- **reviews** `{ platform: Platform; q?: ActivityQuery | null } & ForClient` → `CommentRow[] | null` (serviceHandler)
- **update** `{ platform: Platform; id: string; patch: PostPatch } & ForClient` → `void` (serviceHandler)
