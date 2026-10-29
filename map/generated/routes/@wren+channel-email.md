# @wren/channel-email: routes

Services: 13.

## CallBookings (service)

File: packages/channel-email/src/restate/call-bookings.ts

- **ingest** `unknown` → `BookingOutcome | null` (plain)
- **ingestFor** `{ client: string; body: unknown }` → `BookingOutcome | null` (plain)

## CallBriefs (service)

File: packages/channel-email/src/calls/restate.ts

- **build** `{ client?: string | null; id: number }` → `{ built: boolean; }` (serviceHandler)
- **send** `SendAsk` → `{ sent: boolean; why: string; } | { sent: boolean; why?: never; }` (serviceHandler)

## Disposition (object)

File: packages/channel-email/src/restate/disposition.ts

- **approve** `{ id: number; body?: string | null }` → `ApproveOutcome` (exclusiveHandler)
- **classify** `void` → `ClassifyOutcome` (exclusiveHandler)
- **drop** `{ id: number }` → `{ state: string }` (exclusiveHandler)
- **followUp** `{ enrollmentId: number; body: string; campaign?: string | null }` → `{ ok: boolean; reason: string | null; until: string | null }` (exclusiveHandler)
- **reply** `{ threadEventId: number; body: string }` → `{ ok: boolean; reason: string | null }` (exclusiveHandler)
- **status** `void` → `ClassifyOutcome | null` (sharedHandler)

## EmailConsole (service via `portalService`)

File: packages/channel-email/src/restate/console.ts

- **answers** `PortalRequest` → `{ id: number; state: "booked" | "sent" | "booking" | "dropped" | "proposed" | "already_booked" | "needs_you"; email: string; start: Date | null; timeZone: string | null; detail: string | null; createdAt: Date; words: string | null; snippet: string | null; draft: string | null; }[]` (serviceHandler)
- **approve** `InviteRequest` → `{ ok: true; state: import("../schema.js").CallInviteState; said: string | null; reply: import("../index.js").ReplyOutcome | null; }` (serviceHandler)
- **callBrief** `CallsRequest` → `{ done: string[]; }` (serviceHandler)
- **callClear** `CallsRequest` → `{ changed: number; done: string[]; }` (serviceHandler)
- **callNoShow** `CallsRequest` → `{ changed: number; done: string[]; }` (serviceHandler)
- **callNotFit** `CallsRequest` → `{ changed: number; done: string[]; }` (serviceHandler)
- **callNotYet** `CallsRequest` → `{ changed: number; done: string[]; }` (serviceHandler)
- **callWon** `CallsRequest` → `{ changed: number; done: string[]; }` (serviceHandler)
- **dossier** `PortalRequest & { id?: unknown }` → `import("@wren/research/dossier").DossierBrief` (serviceHandler)
- **drop** `InviteRequest` → `{ state: string; }` (serviceHandler)
- **killSwitchOff** `CampaignsRequest` → `Done` (serviceHandler)
- **killSwitchOn** `CampaignsRequest` → `Done` (serviceHandler)
- **pause** `SenderRequest` → `{ paused: string[]; }` (serviceHandler)
- **recordsExport** `PortalRequest & ExportAsk` → `import("@wren/core/records/serve").RecordsFile` (serviceHandler)
- **recordsGet** `PortalRequest & GetAsk` → `import("@wren/core/records/serve").RecordAnswer` (serviceHandler)
- **recordsList** `PortalRequest & ListAsk` → `import("@wren/core/records/serve").RecordsPage` (serviceHandler)
- **recordsStats** `PortalRequest & StatsAsk` → `import("@wren/core/records/serve").RecordsStat` (serviceHandler)
- **recordsTypes** `PortalRequest` → `import("@wren/core/records").RecordMeta[]` (serviceHandler)
- **resume** `SenderRequest` → `{ resumed: string[]; }` (serviceHandler)
- **resumeOpeners** `CampaignsRequest` → `Done` (serviceHandler)
- **setCampaign** `CampaignRequest` → `{ updatedAt: Date; campaign: string; updatedBy: string; killSwitch: boolean | null; openersPerDay: number | null; }` (serviceHandler)
- **stopOpeners** `CampaignsRequest` → `Done` (serviceHandler)

## InboxPush (object)

File: packages/channel-email/src/restate/inbox-scheduler.ts

- **claim** `string` → `void` (exclusiveHandler)
- **listen** `PushListener` → `void` (exclusiveHandler)
- **notify** `void` → `void` (sharedHandler)

## ListmonkIntake (service)

File: packages/channel-email/src/restate/listmonk.ts

- **post** `ListmonkMessage` → `{ ok: true }` (serviceHandler)

## ListmonkMail (object)

File: packages/channel-email/src/restate/listmonk.ts

- **send** `ListmonkMessage` → `IssueSent` (exclusiveHandler)

## MailAccess (service via `portalService`)

File: packages/channel-email/src/access/console.ts

- **addMailbox** `?` → `?` (serviceHandler)
- **check** `?` → `?` (serviceHandler)
- **connect** `?` → `?` (serviceHandler)
- **consent** `?` → `?` (serviceHandler)
- **done** `?` → `?` (serviceHandler)
- **mail** `?` → `?` (serviceHandler)

## MailCallback (service)

File: packages/channel-email/src/access/console.ts

- **land** `z.infer<typeof LANDING>` → `{ ok: boolean; said: string; }` (serviceHandler)

## Marketing (service)

File: packages/channel-email/src/restate/marketing.ts

- **confirm** `Visit & { token: string }` → `{ ok: boolean; prefs: { channel: "email" | "sms"; topic: string | null; named: string | null; from: string | null; address: string; everything: boolean; frequency: "as_sent" | "weekly" | "monthly"; pausedUntil: Date | null; topics: { name: string; publicName: string; line: string; cadence: string; on: boolean; }[]; }; }` (serviceHandler)
- **prefs** `{ token: string }` → `{ channel: "email" | "sms"; topic: string | null; named: string | null; from: string | null; address: string; everything: boolean; frequency: "as_sent" | "weekly" | "monthly"; pausedUntil: Date | null; topics: { name: string; publicName: string; line: string; cadence: string; on: boolean; }[]; }` (serviceHandler)
- **set** `Visit & { token: string; change: Change }` → `{ prefs: { channel: "email" | "sms"; topic: string | null; named: string | null; from: string | null; address: string; everything: boolean; frequency: "as_sent" | "weekly" | "monthly"; pausedUntil: Date | null; topics: { name: string; publicName: string; line: string; cadence: string; on: boolean; }[]; }; event: number | null; }` (serviceHandler)
- **signUp** `SignUpRequest` → `{ ok: true }` (serviceHandler)

## Newsletter (object)

File: packages/channel-email/src/restate/newsletter.ts

- **send** `Issue` → `IssueRun` (exclusiveHandler)

## QueueRefresh (service)

File: packages/channel-email/src/restate/queue-refresh.ts

- **all** `void` → `Record<string, RefreshStats>` (serviceHandler)

## Resolution (object)

File: packages/channel-email/src/restate/resolution.ts

- **build** `{ limitPeople?: number } & ClientInput` → `import("../resolution/service.js").BuildCandidatesStats` (exclusiveHandler)
- **queue** `QueueOptions & ClientInput` → `import("../resolution/service.js").QueueStats` (exclusiveHandler)
- **resolve** `ResolveInput` → `ResolutionStats` (exclusiveHandler)
- **resolveNewDomains** `ResolveNewInput` → `ResolutionStats` (exclusiveHandler)
- **verifyLeads** `VerifyLeadsInput` → `VerificationStats` (exclusiveHandler)
