# @wren/channel-sms: routes

Services: 5.

## Reviews (service)

File: packages/channel-sms/src/restate/answers.ts

- **click** `z.infer<typeof CLICK>` → `{ to: string | null }` (serviceHandler)
- **feedback** `z.infer<typeof FEEDBACK>` → `{ ok: boolean }` (serviceHandler)
- **stop** `z.infer<typeof CLICK>` → `{ ok: boolean }` (serviceHandler)

## SmsConsole (service via `portalService`)

File: packages/channel-sms/src/restate/console.ts

- **askReview** `AskReviewRequest` → `{ asked: boolean; }` (serviceHandler)
- **callDone** `CallDoneRequest` → `{ done: string[]; skipped: string[]; }` (serviceHandler)
- **recordsExport** `PortalRequest & ExportAsk` → `import("@wren/core/records/serve").RecordsFile` (serviceHandler)
- **recordsGet** `PortalRequest & GetAsk` → `import("@wren/core/records/serve").RecordAnswer` (serviceHandler)
- **recordsList** `PortalRequest & ListAsk` → `import("@wren/core/records/serve").RecordsPage` (serviceHandler)
- **recordsStats** `PortalRequest & StatsAsk` → `import("@wren/core/records/serve").RecordsStat` (serviceHandler)
- **recordsTypes** `PortalRequest` → `import("@wren/core/records").RecordMeta[]` (serviceHandler)
- **reply** `ReplyRequest` → `{ messageId: number; }` (serviceHandler)

## SmsDesk (service)

File: packages/channel-sms/src/restate/index.ts

- **addContact** `{ phone: string; basis: ContactBasis; why: string; niche?: string } & ForClient` → `{ contactId: number; e164: string; created: boolean }` (serviceHandler)
- **enroll** `{ sequence: string; niche?: string; limit: number } & ForClient` → `EnrollStats` (serviceHandler)
- **forms** `void` → `FormStats` (serviceHandler)
- **label** `{ messageId: number; disposition: Disposition } & ForClient` → `void` (serviceHandler)
- **lift** `{ niche?: string; limit?: number } & ForClient` → `LiftStats` (serviceHandler)
- **markRead** `{ contactId: number } & ForClient` → `void` (serviceHandler)
- **numbers** `void` → `NumbersView` (serviceHandler)
- **pause** `{ e164: string; reason?: string }` → `boolean` (serviceHandler)
- **pushKey** `void` → `{ publicKey: string | null }` (serviceHandler)
- **register** `void` → `RegistrationStats` (serviceHandler)
- **reminders** `{ client?: string | null }` → `ReminderStats` (serviceHandler)
- **reply** `{ contactId: number; body: string; kind?: "manual" | "pay" | "doc" } & ForClient` → `{ messageId: number }` (serviceHandler)
- **resume** `{ e164: string }` → `boolean` (serviceHandler)
- **setTemplate** `Omit<SetTemplate, "by"> & { by?: string | null; viewer?: { email?: string }; client?: string | null; }` → `SlotView` (serviceHandler)
- **start** `{ phone: string; why: string; body: string }` → `{ contactId: number; messageId: number }` (serviceHandler)
- **stats** `{ days?: number; niche?: string } & ForClient` → `SmsStats` (serviceHandler)
- **subscribe** `{ subscription: PushSubscriptionInput; by: string }` → `{ pushed: boolean; error: string | null }` (serviceHandler)
- **syncNumbers** `void` → `SyncStats` (serviceHandler)
- **templates** `{ client?: string | null }` → `SlotView[]` (serviceHandler)
- **thread** `{ contactId: number } & ForClient` → `Thread | null` (serviceHandler)
- **threads** `{ filter?: ThreadFilter; limit?: number; offset?: number } & ForClient` → `ThreadSummary[]` (serviceHandler)
- **unsubscribe** `{ endpoint: string }` → `{ removed: boolean }` (serviceHandler)

## SmsEvents (service)

File: packages/channel-sms/src/restate/index.ts

- **ingest** `unknown` → `{ duplicate: boolean; outcome: string }` (plain)
- **ingestFor** `{ client: string; body: unknown }` → `{ duplicate: boolean; outcome: string }` (plain)
- **signer** `{ number?: string | null; client?: string | null }` → `Signer` (serviceHandler)

## SmsForms (service)

File: packages/channel-sms/src/restate/forms.ts

- **applied** `{ application: number }` → `Stepped | null` (serviceHandler)
- **check** `RunRequest` → `string` (serviceHandler)
- **email** `RunRequest` → `EmailOutcome` (serviceHandler)
- **first** `FirstRequest` → `Stepped` (serviceHandler)
