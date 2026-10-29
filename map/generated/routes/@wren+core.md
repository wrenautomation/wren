# @wren/core: routes

Services: 15.

## AccountsConsole (service via `portalService`)

File: packages/core/src/accounts-console.ts

- **accounts** `?` → `?` (serviceHandler): reads public.account_facts, public.client_accounts, public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.setup_alerts, public.setup_runs
- **addAccount** `?` → `?` (serviceHandler): writes public.client_accounts; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **checkNow** `?` → `?` (serviceHandler): reads public.account_facts, public.client_accounts, public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.setup_runs
- **limits** `?` → `?` (serviceHandler): reads public.client_members, public.clients, public.limits, public.roles
- **mark** `?` → `?` (serviceHandler): writes public.account_facts, public.setup_alerts; reads public.client_accounts, public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.setup_runs
- **now** `?` → `?` (serviceHandler): reads public.client_accounts, public.client_members, public.clients, public.roles, public.setup_alerts
- **setLimit** `?` → `?` (serviceHandler): writes public.limits; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **setVendor** `?` → `?` (serviceHandler): writes public.vendor_modes; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.wren_settings
- **start** `?` → `?` (serviceHandler): writes public.setup_runs; reads public.account_facts, public.client_accounts, public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **usage** `?` → `?` (serviceHandler): reads public.clients, public.vendor_usage
- **vendors** `?` → `?` (serviceHandler): reads public.client_members, public.clients, public.roles, public.vendor_modes, public.vendor_usage, public.wren_settings
  - outside: npm @wrenautomation/models

## Ask (service)

File: packages/core/src/ask.ts

- **answer** `{ id: string }` → `void` (restate.handlers.handler): writes public.runs
- **edit** `{ id: string }` → `void` (restate.handlers.handler): writes public.runs

## Broadcast (object)

File: packages/core/src/broadcast-run.ts

- **run** `{ gen: number }` → `RunStats | { skipped: string; waiting?: never; } | { waiting: string; skipped?: never; }` (exclusiveHandler): writes public.broadcast_recipients, public.broadcasts, public.consent_events, public.consents, public.marketing_sends, public.segments, public.sms_messages; reads public.companies, public.message_settings, public.profile_keys, public.profile_traits, public.profiles, public.segment_members, public.sms_contacts, public.suppressions, public.topics
- **schedule** `{ at: string }` → `{ gen: number; at: string; }` (exclusiveHandler)
- **status** `void` → `{ key: string; gen: number; last: {} | null; }` (sharedHandler)

## ConsolePortal (service via `portalService`)

File: packages/core/src/console/console-portal.ts

- **accessAsk** `?` → `?` (write): writes public.access_asks; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **addClient** `AddClientRequest` → `{ id: string; name: string; demo: boolean; }` (plain): writes public.client_accounts, public.clients
  - outside: npm postgres
- **agents** `PortalRequest` → `import("./loops.js").AgentLine[]` (plain)
- **ask** `ComponentRequest` → `{ component: string; }` (plain): reads public.client_members, public.clients, public.roles
- **askDecide** `?` → `?` (write): writes public.access_asks, public.grants; reads public.client_members, public.clients, public.operators, public.role_grants, public.roles
- **businessFactSave** `?` → `?` (write): writes public.custom_values; reads public.client_members, public.clients, public.custom_fields, public.grants, public.operators, public.role_grants, public.roles
- **businessFacts** `Input` → `{ value: string; key: string; id: string; createdAt: Date; label: string; updatedAt: Date; owner: string | null; createdBy: string; updatedBy: string; }[]` (plain): reads public.client_members, public.clients, public.custom_fields, public.custom_values, public.grants, public.operators, public.role_grants, public.roles
- **call** `CallRequest` → `unknown` (plain): writes public.grants, public.runs
- **configure** `InstallRequest` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain): writes public.client_accounts, public.clients, public.runs, public.template_versions, public.templates, public.wren_settings; reads public.client_members, public.roles
  - outside: npm postgres
- **connect** `ConnectRequest` → `{ client: string; site: string; set: boolean; }` (plain): writes public.client_accounts, public.clients, public.runs; reads public.client_members, public.roles
- **customFieldOrder** `?` → `?` (write): writes public.custom_fields; reads public.client_members, public.clients, public.custom_values, public.grants, public.operators, public.role_grants, public.roles
- **customFieldSave** `?` → `?` (write): writes public.custom_fields; reads public.client_members, public.clients, public.custom_field_values, public.custom_values, public.grants, public.operators, public.role_grants, public.roles
- **customFields** `Input` → `FieldsView` (plain): reads public.client_members, public.clients, public.custom_fields, public.custom_values, public.grants, public.operators, public.role_grants, public.roles
- **decisions** `PortalRequest` → `import("../decide/stats.js").KindStats[]` (plain): reads public.clients, public.decision_calls, public.decisions, public.wren_settings
- **doorReveal** `DoorRequest` → `{ token: string; }` (plain): reads public.client_members, public.clients, public.hooks, public.roles, public.workflow_saves
- **doorRotate** `DoorRequest` → `{ token: string; }` (plain): writes public.hooks; reads public.client_members, public.clients, public.roles, public.workflow_saves
- **experimentAdd** `PortalRequest & ExperimentInput` → `{ flag: string; }` (plain): writes public.flag_experiments; reads public.flags
- **experimentRemove** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain): writes public.flag_experiments; reads public.flags
- **experimentShip** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain): writes public.flag_experiments, public.flags; reads public.surveys
- **experimentStart** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain): writes public.flag_experiments; reads public.flags, public.surveys
- **experimentStop** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain): writes public.flag_experiments; reads public.flags, public.surveys
- **flagAdd** `PortalRequest & FlagInput` → `{ key: string; }` (plain): writes public.flags; reads public.flag_experiments, public.surveys
- **flagRemove** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain): writes public.flags; reads public.flag_experiments, public.surveys
- **grantAdd** `?` → `?` (write): writes public.grants; reads public.client_members, public.clients, public.operators, public.role_grants, public.roles
- **grantEnd** `?` → `?` (write): writes public.grants; reads public.client_members, public.clients, public.operators, public.role_grants, public.roles
- **install** `InstallRequest` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain): writes public.client_accounts, public.clients, public.runs, public.template_versions, public.templates; reads public.client_members, public.roles
  - outside: npm postgres
- **issueRaise** `?` → `?` (write): writes public.issues; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **issueResolve** `?` → `?` (write): writes public.issues; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **issues** `Input` → `IssueView[]` (plain): reads public.client_members, public.clients, public.grants, public.issues, public.operators, public.role_grants, public.roles
- **loops** `PortalRequest` → `import("./loops.js").LoopRow[]` (plain)
- **moveViews** `KeepRequest` → `import("../saved-views.js").SavedViewLine[]` (plain): writes public.viewer_prefs; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.saved_views
- **prefs** `KeepRequest` → `Record<string, unknown>` (plain): reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.viewer_prefs
- **question** `QuestionRequest` → `{ id: string; }` (plain): writes public.runs
- **recordsAsk** `AskRequest` → `{ id: string; }` (plain): writes public.runs; reads public.changes, public.custom_field_values, public.custom_fields
- **recordsCounts** `PortalRequest & { asks?: unknown }` → `{ totals: number[]; }` (plain): reads public.custom_field_values, public.custom_fields
- **recordsEdit** `EditRequest` → `import("../edits.js").Edited` (plain): writes public.changes, public.grants; reads public.runs
- **recordsExport** `PortalRequest & ExportAsk` → `import("../records-serve.js").RecordsFile` (plain): reads public.custom_field_values, public.custom_fields, public.draft_events, public.draft_outcomes, public.draft_people
- **recordsGet** `PortalRequest & GetAsk` → `import("../records-serve.js").RecordAnswer` (plain): reads public.changes, public.custom_field_values, public.custom_fields, public.runs
- **recordsList** `PortalRequest & ListAsk` → `import("../records-serve.js").RecordsPage` (plain): reads public.custom_field_values, public.custom_fields
- **recordsStats** `PortalRequest & StatsAsk` → `import("../records-serve.js").RecordsStat` (plain): reads public.custom_field_values, public.custom_fields
- **recordsTypes** `PortalRequest` → `import("@wren/reactivation/restate").RecordMeta[]` (plain)
- **recordsUndo** `UndoRequest` → `import("../edits.js").Edited` (plain): writes public.changes, public.grants; reads public.runs
- **releaseHold** `PortalRequest & { id?: unknown }` → `{ done: number[]; }` (plain): writes public.unit_holds
- **removeView** `KeepRequest` → `{ removed: unknown; }` (plain): writes public.saved_views; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **replay** `PortalRequest & { ids?: unknown }` → `{ done: string[]; replayed: number; }` (plain): reads public.events
- **retryEvent** `PortalRequest & { id?: unknown }` → `{ arrived: number; seen: number; waiting: number; failed: number; out: number; done: string[]; }` (plain)
- **roleCopy** `?` → `?` (write): writes public.role_grants, public.roles; reads public.client_members, public.clients, public.grants, public.operators
- **roleGrant** `?` → `?` (write): writes public.role_grants, public.roles; reads public.client_members, public.clients, public.grants, public.operators
- **roleRemove** `?` → `?` (write): writes public.roles; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants
- **roleSave** `?` → `?` (write): writes public.role_grants, public.roles; reads public.client_members, public.clients, public.grants, public.operators
- **sandboxMake** `PortalRequest` → `{ id: string; name: string; }` (plain): writes public.client_accounts, public.clients
  - outside: npm postgres
- **sandboxReset** `PortalRequest` → `{ id: string; name: string; }` (plain): writes public.client_accounts, public.clients, public.grants, public.roles
  - outside: npm postgres
- **saveView** `KeepRequest` → `import("../saved-views.js").SavedViewLine` (plain): writes public.saved_views; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **savedViews** `KeepRequest` → `import("../saved-views.js").SavedViewLine[]` (plain): reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.saved_views, public.viewer_prefs
- **setLook** `SetLookRequest` → `{ client: string; look: unknown; }` (plain): writes public.clients; reads public.client_members, public.roles
- **setLoop** `SetLoopRequest` → `{ running: boolean; service: string; key: string; lastAt: string | null; failures: number; error: string | null; nextAt: string | null; delayMs: number | null; timeouts: import("@wren/channel-email/restate").TimedOut[]; }` (plain)
- **setPref** `KeepRequest` → `{ key: string; }` (plain): writes public.viewer_prefs; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **snippetAdd** `PortalRequest & SnippetInput` → `import("../library.js").SnippetLine` (plain): writes public.snippets
- **snippetRemove** `PortalRequest & { ids?: unknown }` → `{ done: number[]; }` (plain): writes public.snippets
- **snippets** `PortalRequest` → `import("../library.js").SnippetLine[]` (plain): reads public.snippets
- **surveyAdd** `PortalRequest & SurveyInput` → `{ key: string; }` (plain): writes public.surveys
- **surveyAnswer** `PortalRequest & { survey?: unknown; value?: unknown }` → `{ saved: boolean; }` (plain): writes public.survey_answers; reads public.client_members, public.clients, public.roles, public.surveys
- **surveyPause** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain): writes public.surveys; reads public.flag_experiments, public.flags
- **surveyRemove** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain): writes public.surveys
- **surveyStart** `PortalRequest & { ids?: unknown }` → `{ done: string[]; }` (plain): writes public.surveys; reads public.flag_experiments, public.flags
- **surveysDue** `PortalRequest` → `import("../surveys.js").SurveyDef[]` (plain): reads public.client_members, public.clients, public.roles, public.survey_answers, public.surveys
- **teamRemove** `TeamSeatRequest` → `{ removed: string; }` (plain): writes auth.session, public.operators; reads auth.user, public.client_members, public.clients, public.grants, public.role_grants, public.roles
- **teamSet** `TeamSeatRequest` → `{ email: string; role: import("../access.js").RoleId; clients: string[] | null; }` (plain): writes auth.session, public.operators; reads auth.user, public.client_members, public.clients, public.grants, public.role_grants, public.roles
- **templateApprove** `IdsRequest` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain): writes public.hooks, public.workflow_installs, public.workflow_saves; reads public.clients
- **templateDecline** `IdsRequest` → `{ done: string[]; }` (plain): writes public.workflow_installs; reads public.clients, public.hooks
- **templateInstall** `TemplateRequest` → `import("../template-install.js").Installed` (plain): writes public.client_accounts, public.clients, public.hooks, public.runs, public.template_versions, public.templates, public.workflow_installs, public.workflow_saves; reads public.account_facts, public.client_members, public.roles
- **templateInstalls** `PortalRequest` → `{ template: string; name: string; state: "draft" | "live" | "waiting" | "off"; current: boolean; parts: number; at: string; by: string; }[]` (plain): reads public.client_members, public.clients, public.hooks, public.roles, public.workflow_installs
- **templatePlan** `TemplateRequest` → `import("../template-install.js").Plan` (plain): reads public.account_facts, public.client_accounts, public.client_members, public.clients, public.hooks, public.roles, public.templates, public.workflow_installs, public.workflow_saves
- **templatePublish** `TemplateRequest` → `{ id: string; state: import("../schema.js").InstallState; }` (plain): writes public.workflow_installs; reads public.client_members, public.clients, public.hooks, public.roles, public.workflow_saves
- **templateUninstall** `TemplateRequest` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain): writes public.client_accounts, public.clients, public.hooks, public.workflow_installs; reads public.client_members, public.roles, public.workflow_saves
- **tokenMake** `PortalRequest & { name?: unknown; pin?: unknown; days?: unknown }` → `import("../tokens.js").TokenRow & { token: string; }` (plain): writes public.access_tokens; reads public.client_members, public.clients, public.operators, public.roles
- **tokenRevoke** `PortalRequest & { id?: unknown }` → `{ revoked: string; }` (plain): writes public.access_tokens; reads public.clients
- **tokens** `PortalRequest` → `import("../tokens.js").TokenRow[]` (plain): reads public.access_tokens, public.clients
- **uninstall** `ComponentRequest` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain): writes public.client_accounts, public.clients, public.runs, public.template_versions, public.templates; reads public.client_members, public.roles
  - outside: npm postgres
- **view** `ViewRequest` → `import("./console-api.js").ViewAnswer` (plain)
- **viewAsList** `PortalRequest` → `ViewAsChoices` (plain): reads public.client_members, public.clients, public.operators, public.roles
- **workflowAnswer** `PortalRequest & { id?: unknown }` → `{ state: "thinking"; error?: never; reply?: never; patch?: never; } | { state: "failed"; error: string; reply?: never; patch?: never; } | { state: "done"; reply: string; patch: import("../workflows.js").WorkflowEdits | null; error?: never; }` (plain): reads public.runs
- **workflowAsk** `WorkflowSaveRequest & { message?: unknown }` → `{ id: string; }` (plain): writes public.runs; reads public.client_members, public.clients, public.roles, public.workflow_saves
- **workflowBuild** `PortalRequest & { message?: unknown; name?: unknown }` → `{ workflow: string; ask: string | null; }` (plain): writes public.runs, public.workflow_saves; reads public.client_members, public.clients, public.roles
- **workflowDelete** `WorkflowSaveRequest` → `{ done: number; }` (plain): writes public.workflow_saves; reads public.client_members, public.clients, public.roles
- **workflowDiscard** `WorkflowSaveRequest` → `{ done: number; }` (plain): writes public.workflow_saves; reads public.client_members, public.clients, public.roles
- **workflowDoors** `DoorRequest` → `import("../doors.js").Door[]` (plain): reads public.client_members, public.clients, public.hooks, public.roles, public.workflow_saves
- **workflowPublish** `WorkflowSaveRequest` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain): writes public.hooks, public.workflow_installs, public.workflow_saves; reads public.client_members, public.clients, public.roles
- **workflowSave** `WorkflowSaveRequest` → `{ id: number; problems: string[]; }` (plain): writes public.workflow_saves; reads public.client_members, public.clients, public.roles
- **workflowSwitch** `WorkflowSaveRequest & { on?: unknown }` → `{ start: LoopKey[]; stop: LoopKey[]; }` (plain): writes public.workflow_saves; reads public.client_members, public.clients, public.roles
- **workflowTemplateDelete** `PortalRequest & { template?: unknown }` → `{ id: string; name: string; }` (plain): writes public.workflow_templates; reads public.clients, public.hooks, public.workflow_installs
- **workflowTemplateSave** `WorkflowSaveRequest & { name?: unknown; blurb?: unknown }` → `{ id: string; name: string; updated: boolean; }` (plain): writes public.workflow_templates; reads public.client_members, public.clients, public.roles, public.workflow_saves
- **workflowTest** `WorkflowTestRequest` → `import("../dry.js").DryResult & { entered?: import("../executor.js").ExecutorEvent; }` (plain): reads public.client_members, public.clients, public.events, public.hooks, public.roles, public.workflow_saves
- **workflowsMade** `PortalRequest` → `import("../executor.js").MadeWorkflow[]` (plain): reads public.client_members, public.clients, public.roles, public.workflow_saves

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

- **door** `{ hook: string; payload: unknown }` → `{ status: number; error: string; subject?: never; } | { status: number; subject: string; error?: never; }` (restate.handlers.handler): writes public.hooks; reads public.clients, public.workflow_saves
- **emit** `EmitRequest` → `Tally` (restate.handlers.handler): writes public.events; reads public.clients, public.hooks, public.workflow_installs, public.workflow_saves
- **fire** `Fired` → `{ entered: number; resolved: number; }` (restate.handlers.handler): reads public.clients, public.enrollments, public.events, public.hooks, public.lead_channels, public.sms_contacts, public.workflow_installs, public.workflow_saves
- **hook** `{ token: string; payload: unknown }` → `{ status: number; error: string; subject?: never; } | { status: number; subject: string; error?: never; }` (plain): writes public.hooks; reads public.clients, public.workflow_saves
- **release** `Target & { id: string; happened?: ExecutorEvent }` → `Tally | null` (restate.handlers.handler): writes public.events; reads public.clients, public.workflow_saves
- **retry** `Target & { id: string; auto?: number }` → `Tally | null` (restate.handlers.handler): writes public.events; reads public.clients, public.workflow_saves

## Executor@packages/core/src/testing.ts (service)

File: packages/core/src/testing.ts

- **emit** `(typeof emitted)[number]` → `{ arrived: number; seen: number; waiting: number; failed: number; out: number; }` (plain)

## ExecutorClock (object)

File: packages/core/src/executor.ts

- **start** `void` → `{ next: string | null; }` (restate.handlers.object.exclusive): reads public.clients, public.workflow_saves
- **stop** `void` → `void` (restate.handlers.object.exclusive)
- **tick** `{ slot: string }` → `void` (restate.handlers.object.exclusive): reads public.clients, public.workflow_saves

## PeopleConsole (service via `portalService`)

File: packages/core/src/people-console.ts

- **broadcastApprove** `BroadcastIdsRequest` → `{ done: number[]; }` (serviceHandler): writes public.broadcasts; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.segments, public.topics
- **broadcastAsk** `BroadcastIdsRequest` → `{ done: number[]; }` (serviceHandler): writes public.broadcasts; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.segments, public.topics
- **broadcastCancel** `BroadcastIdsRequest` → `{ done: number[]; }` (serviceHandler): writes public.broadcast_recipients, public.broadcasts; reads public.client_members, public.clients, public.grants, public.operators, public.profiles, public.role_grants, public.roles, public.segments, public.topics
- **broadcastContext** `PortalRequest` → `{ email: boolean; emailUnset: string | null; text: boolean; testDomain: string | null; testPhone: string | null; segments: { id: number; name: string; size: number; }[]; topics: { id: number; name: string; publicName: string; channel: "email" | "sms"; }[]; fields: ("name" | "first_name")[]; textMost: number; }` (serviceHandler): reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.segments, public.topics
- **broadcastDecline** `BroadcastIdsRequest` → `{ done: number[]; }` (serviceHandler): writes public.broadcasts; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.segments, public.topics
- **broadcastMonth** `PortalRequest & { from?: string; to?: string }` → `{ broadcasts: { id: number; name: string; channel: import("./broadcasts-schema.js").BroadcastChannel; state: import("./broadcasts-schema.js").BroadcastState; at: string; }[]; }` (serviceHandler): reads public.broadcast_records, public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **broadcastPreview** `BroadcastSaveRequest` → `{ subject: string | null; body: string; people: number; yes: number; }` (serviceHandler): reads public.client_members, public.clients, public.consents, public.grants, public.operators, public.profile_keys, public.profiles, public.role_grants, public.roles, public.segment_members, public.topics
- **broadcastRestore** `BroadcastIdsRequest` → `{ done: number[]; }` (serviceHandler): writes public.broadcast_recipients, public.broadcasts; reads public.client_members, public.clients, public.grants, public.operators, public.profiles, public.role_grants, public.roles, public.segments, public.topics
- **broadcastSave** `BroadcastSaveRequest` → `{ broadcast: { name: string; id: number; channel: "email" | "sms"; createdAt: Date; state: "draft" | "sending" | "sent" | "scheduled" | "waiting" | "declined" | "canceled"; zone: string; updatedAt: Date; subject: string | null; body: string; startedAt: Date | null; finishedAt: Date | null; by: string; note: string | null; topicId: number; segmentId: number; sendAt: Date | null; local: boolean; askedBy: string | null; askedAt: Date | null; decidedBy: string | null; decidedAt: Date | null; testedTo: string | null; testedAt: Date | null; }; }` (serviceHandler): writes public.broadcasts; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.segments, public.topics
- **broadcastTest** `BroadcastTestRequest` → `{ sent: string; }` (serviceHandler): writes public.broadcasts, public.sms_messages; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.segments, public.sms_contacts, public.topics
- **channelPeople** `PortalRequest & StatsQuery & { key?: string; step?: string }` → `{ people: import("./channel-stats.js").StepPerson[]; }` (serviceHandler): reads pipeline.instances, public.client_members, public.clients, public.consents, public.grants, public.operators, public.profile_keys, public.profile_steps, public.profile_timeline, public.profile_traits, public.profiles, public.role_grants, public.roles, public.segment_members, public.segments, public.sent_records, public.sms_contacts
- **channelStats** `PortalRequest & StatsQuery` → `import("./channel-stats.js").ChannelStats` (serviceHandler): reads pipeline.instances, public.client_members, public.clients, public.consents, public.content_drafts, public.content_metrics, public.grants, public.link_days, public.operators, public.profile_keys, public.profile_steps, public.profile_timeline, public.profile_traits, public.profiles, public.role_grants, public.roles, public.segment_members, public.segments, public.sent_records, public.sms_contacts
- **findingDrop** `ResearchRequest` → `{ done: number[]; }` (serviceHandler): writes pipeline.deals, pipeline.instances, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.social_handles; reads pipeline.shape_versions, public.client_members, public.clients, public.grants, public.leads, public.operators, public.own_contact_points, public.people, public.reach_contacts, public.role_grants, public.roles
- **findingKeep** `ResearchRequest` → `{ done: number[]; keys: number; }` (serviceHandler): writes pipeline.deals, pipeline.instances, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_trait_events, public.profile_traits, public.profiles, public.social_handles; reads pipeline.shape_versions, public.client_members, public.clients, public.grants, public.leads, public.operators, public.own_contact_points, public.people, public.reach_contacts, public.role_grants, public.roles
- **leadCheck** `LeadRequest` → `{ done: number[]; }` (serviceHandler): writes public.decisions; reads public.client_members, public.clients, public.grants, public.operators, public.profiles, public.role_grants, public.roles, public.wren_settings
- **leadFit** `LeadRequest` → `{ done: number[]; label: string; }` (serviceHandler): writes public.decision_calls, public.profile_trait_events, public.profile_traits; reads public.client_members, public.clients, public.decisions, public.grants, public.operators, public.profiles, public.role_grants, public.roles
- **leadNot** `LeadRequest` → `{ done: number[]; label: string; }` (serviceHandler): writes public.decision_calls, public.profile_trait_events, public.profile_traits; reads public.client_members, public.clients, public.decisions, public.grants, public.operators, public.profiles, public.role_grants, public.roles
- **memberAdd** `MemberAddRequest` → `{ done: number[]; group: string; made: boolean; }` (serviceHandler): writes public.segment_member_events, public.segment_members, public.segment_versions, public.segments; reads pipeline.instances, public.client_members, public.clients, public.consents, public.grants, public.operators, public.profile_keys, public.profile_steps, public.profile_timeline, public.profile_traits, public.profiles, public.role_grants, public.roles, public.sent_records, public.sms_contacts
- **memberRemove** `PortalRequest & { ids?: string[] }` → `{ done: string[]; }` (serviceHandler): writes public.segment_member_events, public.segment_members, public.segments; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **recordsExport** `PortalRequest & ExportAsk` → `import("./records-serve.js").RecordsFile` (serviceHandler): reads public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.draft_events, public.draft_outcomes, public.draft_people, public.roles
- **recordsGet** `PortalRequest & GetAsk` → `import("./records-serve.js").RecordAnswer` (serviceHandler): reads public.changes, public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.roles, public.runs
- **recordsList** `PortalRequest & ListAsk` → `import("./records-serve.js").RecordsPage` (serviceHandler): reads public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.roles
- **recordsStats** `PortalRequest & StatsAsk` → `import("./records-serve.js").RecordsStat` (serviceHandler): reads public.client_members, public.clients, public.custom_field_values, public.custom_fields, public.roles
- **recordsTypes** `PortalRequest` → `import("./records.js").RecordMeta[]` (serviceHandler): reads public.client_members, public.clients, public.roles
- **research** `ResearchRequest` → `{ done: number[]; }` (serviceHandler): writes public.profile_lookups; reads public.client_members, public.clients, public.grants, public.operators, public.profiles, public.role_grants, public.roles
- **segmentArchive** `SegmentIdsRequest` → `{ done: number[]; }` (serviceHandler): writes public.segments; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **segmentContext** `PortalRequest` → `{ traits: string[]; segments: { id: number; name: string; kind: "manual" | "live" | "snapshot"; }[]; shape: import("./segments.js").JourneyShape; describe: boolean; }` (serviceHandler): reads pipeline.shape_versions, public.client_members, public.clients, public.grants, public.operators, public.profile_traits, public.role_grants, public.roles, public.segments
- **segmentDescribe** `PortalRequest & { words?: string }` → `{ rule: import("./segments.js").Rule; name: string; words: string; unknownTraits: string[]; }` (serviceHandler): reads pipeline.shape_versions, public.client_members, public.clients, public.grants, public.operators, public.profile_traits, public.role_grants, public.roles, public.segments
- **segmentPreview** `PortalRequest & { rule?: unknown }` → `import("./segments.js").Preview` (serviceHandler): reads pipeline.instances, public.client_members, public.clients, public.consents, public.grants, public.operators, public.profile_keys, public.profile_steps, public.profile_timeline, public.profile_traits, public.profiles, public.role_grants, public.roles, public.segment_members, public.segments, public.sent_records, public.sms_contacts
- **segmentRestore** `SegmentIdsRequest` → `{ done: number[]; }` (serviceHandler): writes public.segment_member_events, public.segment_members, public.segments; reads pipeline.instances, public.client_members, public.clients, public.consents, public.grants, public.operators, public.profile_keys, public.profile_steps, public.profile_timeline, public.profile_traits, public.profiles, public.role_grants, public.roles, public.sent_records, public.sms_contacts
- **segmentRetake** `SegmentIdsRequest` → `{ done: number[]; }` (serviceHandler): writes public.segment_member_events, public.segment_members, public.segments; reads pipeline.instances, public.client_members, public.clients, public.consents, public.grants, public.operators, public.profile_keys, public.profile_steps, public.profile_timeline, public.profile_traits, public.profiles, public.role_grants, public.roles, public.sent_records, public.sms_contacts
- **segmentSave** `SegmentSaveRequest` → `{ segment: import("./segments.js").Segment; entered: number; left: number; }` (serviceHandler): writes public.segment_member_events, public.segment_members, public.segment_versions, public.segments; reads pipeline.instances, public.client_members, public.clients, public.consents, public.grants, public.operators, public.profile_keys, public.profile_steps, public.profile_timeline, public.profile_traits, public.profiles, public.role_grants, public.roles, public.sent_records, public.sms_contacts
- **segmentText** `PortalRequest & { rule?: unknown; text?: string }` → `{ rule: import("./segments.js").Rule; } | { problems: string[]; } | { text: string; }` (serviceHandler): reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.segments
- **segmentVersions** `PortalRequest & { id?: number }` → `{ versions: import("./segments.js").SegmentVersion[]; }` (serviceHandler): reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.segment_versions

## PeopleMap (object)

File: packages/core/src/people-map-pass.ts

- **status** `void` → `{ key: string; last: {} | null; }` (sharedHandler)
- **wake** `void` → `PeopleMapStats | { error: string; } | { skipped: string; }` (exclusiveHandler): writes pipeline.deals, pipeline.instances, public.profile_events, public.profile_findings, public.profile_keys, public.profile_lookups, public.profile_merges, public.profile_rollups, public.profile_site_reads, public.profile_trait_events, public.profile_traits, public.profiles; reads calendar.bookings, pipeline.shape_versions, public.call_bookings, public.chat_messages, public.chat_threads, public.client_members, public.clients, public.comments, public.companies, public.consent_events, public.consents, public.email_clicks, public.enrollments, public.messages, public.open_events, public.people, public.reach_contacts, public.reach_posts, public.reddit_threads, public.site_form_defs, public.site_forms, public.site_pages, public.sms_contacts, public.sms_messages, public.social_handles, public.thread_events, public.topics, public.touches

## Segments (object)

File: packages/core/src/segments-pass.ts

- **status** `void` → `{ key: string; cursor: SegmentCursor | null; last: {} | null; }` (sharedHandler)
- **wake** `void` → `{ recomputed: number; entered: number; left: number; archived: number[]; told: number; more: boolean; cursor: SegmentCursor; } | { skipped: string; error?: never; } | { error: string; skipped?: never; }` (exclusiveHandler): writes public.segment_member_events, public.segment_members, public.segments; reads pipeline.instances, public.broadcasts, public.consents, public.profile_keys, public.profile_steps, public.profile_timeline, public.profile_trait_events, public.profile_traits, public.profiles, public.sent_records, public.sms_contacts

## SetupAgent (service)

File: packages/core/src/setup-agent.ts

- **run** `AgentJob` → `AgentAnswer` (serviceHandler): writes public.account_facts, public.client_accounts, public.setup_alerts, public.setup_runs; reads public.clients

## TemplatesConsole (service via `portalService`)

File: packages/core/src/templates-console.ts

- **approve** `?` → `?` (serviceHandler): writes public.template_versions, public.templates; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **decline** `?` → `?` (serviceHandler): writes public.templates; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.template_versions
- **detail** `?` → `?` (serviceHandler): reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.template_versions, public.templates
- **list** `?` → `?` (serviceHandler): reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.template_versions, public.templates
- **move** `?` → `?` (serviceHandler): writes public.templates; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles, public.template_versions
- **preview** `?` → `?` (serviceHandler): reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **publish** `?` → `?` (serviceHandler): writes public.template_versions, public.templates; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **renameFolder** `?` → `?` (serviceHandler): writes public.templates
- **reset** `?` → `?` (serviceHandler): writes public.template_versions, public.templates; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **restore** `?` → `?` (serviceHandler): writes public.template_versions, public.templates; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **save** `?` → `?` (serviceHandler): writes public.template_versions, public.templates; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles

## Tokens (service)

File: packages/core/src/tokens.ts

- **check** `{ token: string }` → `restate.RestatePromise<TokenViewer | null>` (serviceHandler): writes public.access_tokens; reads public.clients, public.operators

## Webhooks (service)

File: packages/core/src/webhooks.ts

- **deliver** `{ id: string }` → `{ state: string; }` (restate.handlers.handler): writes public.webhook_attempts, public.webhook_deliveries, public.webhook_subscriptions; reads public.clients
- **publish** `Published` → `{ queued: number; }` (restate.handlers.handler): writes public.webhook_deliveries; reads public.clients, public.webhook_subscriptions
- **redeliver** `{ id: string }` → `{ id: string; }` (serviceHandler): writes public.webhook_deliveries; reads public.webhook_subscriptions
