# @wren/channel-email: routes

Services: 11.

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
