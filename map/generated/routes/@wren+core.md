# @wren/core: routes

Services: 15.

## AccountsConsole (service via `portalService`)

File: packages/core/src/accounts-console.ts

- **accounts** `?` → `?` (serviceHandler)
- **addAccount** `?` → `?` (serviceHandler)
- **checkNow** `?` → `?` (serviceHandler)
- **limits** `?` → `?` (serviceHandler)
- **mark** `?` → `?` (serviceHandler)
- **now** `?` → `?` (serviceHandler)
- **setLimit** `?` → `?` (serviceHandler)
- **setVendor** `?` → `?` (serviceHandler)
- **start** `?` → `?` (serviceHandler)
- **usage** `?` → `?` (serviceHandler)
- **vendors** `?` → `?` (serviceHandler)

## Ask (service)

File: packages/core/src/ask.ts

- **answer** `{ id: string }` → `void` (restate.handlers.handler)
- **edit** `{ id: string }` → `void` (restate.handlers.handler)

## Broadcast (object)

File: packages/core/src/broadcast-run.ts

- **run** `{ gen: number }` → `RunStats | { skipped: string; waiting?: never; } | { waiting: string; skipped?: never; }` (exclusiveHandler)
- **schedule** `{ at: string }` → `{ gen: number; at: string; }` (exclusiveHandler)
- **status** `void` → `{ key: string; gen: number; last: {} | null; }` (sharedHandler)

## ConsolePortal (service via `portalService`)

File: packages/core/src/console/console-portal.ts

- **addClient** `AddClientRequest` → `{ id: string; name: string; demo: boolean; }` (plain)
- **agents** `PortalRequest` → `import("./loops.js").AgentLine[]` (plain)
- **ask** `ComponentRequest` → `{ component: string; }` (plain)
- **call** `CallRequest` → `unknown` (plain)
- **configure** `InstallRequest` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain)
- **connect** `ConnectRequest` → `{ client: string; site: string; set: boolean; }` (plain)
- **decisions** `PortalRequest` → `import("../decide/stats.js").KindStats[]` (plain)
- **doorReveal** `DoorRequest` → `{ token: string; }` (plain)
- **doorRotate** `DoorRequest` → `{ token: string; }` (plain)
- **experimentAdd** `PortalRequest & ExperimentInput` → `{ flag: string; }` (plain)
- **experimentRemove** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain)
- **experimentShip** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain)
- **experimentStart** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain)
- **experimentStop** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain)
- **flagAdd** `PortalRequest & FlagInput` → `{ key: string; }` (plain)
- **flagRemove** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain)
- **install** `InstallRequest` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain)
- **loops** `PortalRequest` → `import("./loops.js").LoopRow[]` (plain)
- **moveViews** `KeepRequest` → `import("../saved-views.js").SavedViewLine[]` (plain)
- **prefs** `KeepRequest` → `Record<string, unknown>` (plain)
- **question** `QuestionRequest` → `{ id: string; }` (plain)
- **recordsAsk** `AskRequest` → `{ id: string; }` (plain)
- **recordsCounts** `PortalRequest & { asks?: unknown }` → `{ totals: number[]; }` (plain)
- **recordsEdit** `EditRequest` → `import("../edits.js").Edited` (plain)
- **recordsExport** `PortalRequest & ExportAsk` → `import("../records-serve.js").RecordsFile` (plain)
- **recordsGet** `PortalRequest & GetAsk` → `import("../records-serve.js").RecordAnswer` (plain)
- **recordsList** `PortalRequest & ListAsk` → `import("../records-serve.js").RecordsPage` (plain)
- **recordsStats** `PortalRequest & StatsAsk` → `import("../records-serve.js").RecordsStat` (plain)
- **recordsTypes** `PortalRequest` → `import("@wren/reactivation/restate").RecordMeta[]` (plain)
- **recordsUndo** `UndoRequest` → `import("../edits.js").Edited` (plain)
- **releaseHold** `PortalRequest & { id?: unknown }` → `{ done: number[]; }` (plain)
- **removeView** `KeepRequest` → `{ removed: unknown; }` (plain)
- **replay** `PortalRequest & { ids?: unknown }` → `{ done: string[]; replayed: number; }` (plain)
- **retryEvent** `PortalRequest & { id?: unknown }` → `{ arrived: number; seen: number; waiting: number; failed: number; out: number; done: string[]; }` (plain)
- **saveView** `KeepRequest` → `import("../saved-views.js").SavedViewLine` (plain)
- **savedViews** `KeepRequest` → `import("../saved-views.js").SavedViewLine[]` (plain)
- **setLook** `SetLookRequest` → `{ client: string; look: unknown; }` (plain)
- **setLoop** `SetLoopRequest` → `{ running: boolean; service: string; key: string; lastAt: string | null; failures: number; error: string | null; nextAt: string | null; delayMs: number | null; timeouts: import("@wren/channel-email/restate").TimedOut[]; }` (plain)
- **setPref** `KeepRequest` → `{ key: string; }` (plain)
- **snippetAdd** `PortalRequest & SnippetInput` → `import("../library.js").SnippetLine` (plain)
- **snippetRemove** `PortalRequest & { ids?: unknown }` → `{ done: number[]; }` (plain)
- **snippets** `PortalRequest` → `import("../library.js").SnippetLine[]` (plain)
- **surveyAdd** `PortalRequest & SurveyInput` → `{ key: string; }` (plain)
- **surveyAnswer** `PortalRequest & { survey?: unknown; value?: unknown }` → `{ saved: boolean; }` (plain)
- **surveyPause** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain)
- **surveyRemove** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain)
- **surveyStart** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain)
- **surveysDue** `PortalRequest` → `import("../surveys.js").SurveyDef[]` (plain)
- **teamRemove** `TeamSeatRequest` → `{ removed: string; }` (plain)
- **teamSet** `TeamSeatRequest` → `{ email: string; role: import("../access.js").RoleId; clients: string[] | null; }` (plain)
- **templateApprove** `IdsRequest` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain)
- **templateDecline** `IdsRequest` → `{ done: string[]; }` (plain)
- **templateInstall** `TemplateRequest` → `import("../template-install.js").Installed` (plain)
- **templateInstalls** `PortalRequest` → `{ template: string; name: string; state: "draft" | "waiting" | "live" | "off"; current: boolean; parts: number; at: string; by: string; }[]` (plain)
- **templatePlan** `TemplateRequest` → `import("../template-install.js").Plan` (plain)
- **templatePublish** `TemplateRequest` → `{ id: string; state: import("../schema.js").InstallState; }` (plain)
- **templateUninstall** `TemplateRequest` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain)
- **tokenMake** `PortalRequest & { name?: unknown; pin?: unknown; days?: unknown }` → `import("../tokens.js").TokenRow & { token: string; }` (plain)
- **tokenRevoke** `PortalRequest & { id?: unknown }` → `{ revoked: string; }` (plain)
- **tokens** `PortalRequest` → `import("../tokens.js").TokenRow[]` (plain)
- **uninstall** `ComponentRequest` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain)
- **view** `ViewRequest` → `import("./console-api.js").ViewAnswer` (plain)
- **workflowAnswer** `PortalRequest & { id?: unknown }` → `{ state: "thinking"; error?: never; reply?: never; patch?: never; } | { state: "failed"; error: string; reply?: never; patch?: never; } | { state: "done"; reply: string; patch: import("../workflows.js").WorkflowEdits | null; error?: never; }` (plain)
- **workflowAsk** `WorkflowSaveRequest & { message?: unknown }` → `{ id: string; }` (plain)
- **workflowBuild** `PortalRequest & { message?: unknown; name?: unknown }` → `{ workflow: string; ask: string | null; }` (plain)
- **workflowDelete** `WorkflowSaveRequest` → `{ done: number; }` (plain)
- **workflowDiscard** `WorkflowSaveRequest` → `{ done: number; }` (plain)
- **workflowDoors** `DoorRequest` → `import("../doors.js").Door[]` (plain)
- **workflowPublish** `WorkflowSaveRequest` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain)
- **workflowSave** `WorkflowSaveRequest` → `{ id: number; problems: string[]; }` (plain)
- **workflowSwitch** `WorkflowSaveRequest & { on?: unknown }` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain)
- **workflowTemplateDelete** `PortalRequest & { template?: unknown }` → `{ id: string; name: string; }` (plain)
- **workflowTemplateSave** `WorkflowSaveRequest & { name?: unknown; blurb?: unknown }` → `{ id: string; name: string; updated: boolean; }` (plain)
- **workflowTest** `WorkflowTestRequest` → `import("../dry.js").DryResult & { entered?: import("../executor.js").ExecutorEvent; }` (plain)
- **workflowsMade** `PortalRequest` → `import("../executor.js").MadeWorkflow[]` (plain)

## Content (service)

File: packages/core/src/content/restate.ts

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

## Executor (service)

File: packages/core/src/executor.ts

- **door** `{ hook: string; payload: unknown }` → `{ status: number; error: string; subject?: never; } | { status: number; subject: string; error?: never; }` (restate.handlers.handler)
- **emit** `EmitRequest` → `Tally` (restate.handlers.handler)
- **fire** `Fired` → `{ entered: number; resolved: number; }` (restate.handlers.handler)
- **hook** `{ token: string; payload: unknown }` → `{ status: number; error: string; subject?: never; } | { status: number; subject: string; error?: never; }` (plain)
- **release** `Target & { id: string; happened?: ExecutorEvent }` → `Tally | null` (restate.handlers.handler)
- **retry** `Target & { id: string; auto?: number }` → `Tally | null` (restate.handlers.handler)

## Executor@packages/core/src/testing.ts (service)

File: packages/core/src/testing.ts

- **emit** `(typeof emitted)[number]` → `{ arrived: number; seen: number; waiting: number; failed: number; out: number; }` (plain)

## ExecutorClock (object)

File: packages/core/src/executor.ts

- **start** `void` → `{ next: string | null; }` (restate.handlers.object.exclusive)
- **stop** `void` → `void` (restate.handlers.object.exclusive)
- **tick** `{ slot: string }` → `void` (restate.handlers.object.exclusive)

## PeopleConsole (service via `portalService`)

File: packages/core/src/people-console.ts

- **broadcastApprove** `BroadcastIdsRequest` → `{ done: number[]; }` (serviceHandler)
- **broadcastAsk** `BroadcastIdsRequest` → `{ done: number[]; }` (serviceHandler)
- **broadcastCancel** `BroadcastIdsRequest` → `{ done: number[]; }` (serviceHandler)
- **broadcastContext** `PortalRequest` → `{ email: boolean; emailUnset: string | null; text: boolean; testDomain: string | null; testPhone: string | null; segments: { id: number; name: string; size: number; }[]; topics: { id: number; name: string; publicName: string; channel: "email" | "sms"; }[]; fields: ("name" | "first_name")[]; textMost: number; }` (serviceHandler)
- **broadcastDecline** `BroadcastIdsRequest` → `{ done: number[]; }` (serviceHandler)
- **broadcastMonth** `PortalRequest & { from?: string; to?: string }` → `{ broadcasts: { id: number; name: string; channel: import("./broadcasts-schema.js").BroadcastChannel; state: import("./broadcasts-schema.js").BroadcastState; at: string; }[]; }` (serviceHandler)
- **broadcastPreview** `BroadcastSaveRequest` → `{ subject: string | null; body: string; people: number; yes: number; }` (serviceHandler)
- **broadcastRestore** `BroadcastIdsRequest` → `{ done: number[]; }` (serviceHandler)
- **broadcastSave** `BroadcastSaveRequest` → `{ broadcast: { name: string; id: number; channel: "email" | "sms"; state: "draft" | "sending" | "sent" | "waiting" | "scheduled" | "declined" | "canceled"; zone: string; createdAt: Date; updatedAt: Date; subject: string | null; body: string; startedAt: Date | null; finishedAt: Date | null; by: string; segmentId: number; topicId: number; sendAt: Date | null; local: boolean; askedBy: string | null; askedAt: Date | null; decidedBy: string | null; decidedAt: Date | null; note: string | null; testedTo: string | null; testedAt: Date | null; }; }` (serviceHandler)
- **broadcastTest** `BroadcastTestRequest` → `{ sent: string; }` (serviceHandler)
- **channelPeople** `PortalRequest & StatsQuery & { key?: string; step?: string }` → `{ people: import("./channel-stats.js").StepPerson[]; }` (serviceHandler)
- **channelStats** `PortalRequest & StatsQuery` → `import("./channel-stats.js").ChannelStats` (serviceHandler)
- **findingDrop** `ResearchRequest` → `{ done: number[]; }` (serviceHandler)
- **findingKeep** `ResearchRequest` → `{ done: number[]; keys: number; }` (serviceHandler)
- **leadCheck** `LeadRequest` → `{ done: number[]; }` (serviceHandler)
- **leadFit** `LeadRequest` → `{ done: number[]; label: string; }` (serviceHandler)
- **leadNot** `LeadRequest` → `{ done: number[]; label: string; }` (serviceHandler)
- **memberAdd** `MemberAddRequest` → `{ done: number[]; group: string; made: boolean; }` (serviceHandler)
- **memberRemove** `PortalRequest & { ids?: string[] }` → `{ done: string[]; }` (serviceHandler)
- **recordsExport** `PortalRequest & ExportAsk` → `import("./records-serve.js").RecordsFile` (serviceHandler)
- **recordsGet** `PortalRequest & GetAsk` → `import("./records-serve.js").RecordAnswer` (serviceHandler)
- **recordsList** `PortalRequest & ListAsk` → `import("./records-serve.js").RecordsPage` (serviceHandler)
- **recordsStats** `PortalRequest & StatsAsk` → `import("./records-serve.js").RecordsStat` (serviceHandler)
- **recordsTypes** `PortalRequest` → `import("./records.js").RecordMeta[]` (serviceHandler)
- **research** `ResearchRequest` → `{ done: number[]; }` (serviceHandler)
- **segmentArchive** `SegmentIdsRequest` → `{ done: number[]; }` (serviceHandler)
- **segmentContext** `PortalRequest` → `{ traits: string[]; segments: { id: number; name: string; kind: "manual" | "live" | "snapshot"; }[]; shape: import("./segments.js").JourneyShape; describe: boolean; }` (serviceHandler)
- **segmentDescribe** `PortalRequest & { words?: string }` → `{ rule: import("./segments.js").Rule; name: string; words: string; unknownTraits: string[]; }` (serviceHandler)
- **segmentPreview** `PortalRequest & { rule?: unknown }` → `import("./segments.js").Preview` (serviceHandler)
- **segmentRestore** `SegmentIdsRequest` → `{ done: number[]; }` (serviceHandler)
- **segmentRetake** `SegmentIdsRequest` → `{ done: number[]; }` (serviceHandler)
- **segmentSave** `SegmentSaveRequest` → `{ segment: import("./segments.js").Segment; entered: number; left: number; }` (serviceHandler)
- **segmentText** `PortalRequest & { rule?: unknown; text?: string }` → `{ rule: import("./segments.js").Rule; } | { problems: string[]; } | { text: string; }` (serviceHandler)
- **segmentVersions** `PortalRequest & { id?: number }` → `{ versions: import("./segments.js").SegmentVersion[]; }` (serviceHandler)

## PeopleMap (object)

File: packages/core/src/people-map-pass.ts

- **status** `void` → `{ key: string; last: {} | null; }` (sharedHandler)
- **wake** `void` → `PeopleMapStats | { error: string; } | { skipped: string; }` (exclusiveHandler)

## Segments (object)

File: packages/core/src/segments-pass.ts

- **status** `void` → `{ key: string; cursor: SegmentCursor | null; last: {} | null; }` (sharedHandler)
- **wake** `void` → `{ recomputed: number; entered: number; left: number; archived: number[]; told: number; more: boolean; cursor: SegmentCursor; } | { skipped: string; error?: never; } | { error: string; skipped?: never; }` (exclusiveHandler)

## SetupAgent (service)

File: packages/core/src/setup-agent.ts

- **run** `AgentJob` → `AgentAnswer` (serviceHandler)

## TemplatesConsole (service via `portalService`)

File: packages/core/src/templates-console.ts

- **approve** `?` → `?` (serviceHandler)
- **decline** `?` → `?` (serviceHandler)
- **detail** `?` → `?` (serviceHandler)
- **list** `?` → `?` (serviceHandler)
- **move** `?` → `?` (serviceHandler)
- **preview** `?` → `?` (serviceHandler)
- **publish** `?` → `?` (serviceHandler)
- **renameFolder** `?` → `?` (serviceHandler)
- **reset** `?` → `?` (serviceHandler)
- **restore** `?` → `?` (serviceHandler)
- **save** `?` → `?` (serviceHandler)

## Tokens (service)

File: packages/core/src/tokens.ts

- **check** `{ token: string }` → `restate.RestatePromise<TokenViewer | null>` (serviceHandler)

## Webhooks (service)

File: packages/core/src/webhooks.ts

- **deliver** `{ id: string }` → `{ state: string; }` (restate.handlers.handler)
- **publish** `Published` → `{ queued: number; }` (restate.handlers.handler)
- **redeliver** `{ id: string }` → `{ id: string; }` (serviceHandler)
