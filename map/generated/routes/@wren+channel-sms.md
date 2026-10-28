# @wren/channel-sms: routes

Services: 4.

## Reviews (service)

File: packages/channel-sms/src/restate/answers.ts

- **click** `z.infer<typeof CLICK>` → `{ to: string | null }` (serviceHandler)
- **feedback** `z.infer<typeof FEEDBACK>` → `{ ok: boolean }` (serviceHandler)
- **stop** `z.infer<typeof CLICK>` → `{ ok: boolean }` (serviceHandler)

## SmsForms (service)

File: packages/channel-sms/src/restate/forms.ts

- **applied** `{ application: number }` → `Stepped | null` (serviceHandler)
- **first** `FirstRequest` → `Stepped` (serviceHandler)
- **email** `RunRequest` → `EmailOutcome` (serviceHandler)
- **check** `RunRequest` → `string` (serviceHandler)

## SmsEvents (service)

File: packages/channel-sms/src/restate/index.ts

- **signer** `{ number?: string | null; client?: string | null }` → `Signer` (serviceHandler)
- **ingest** `unknown` → `{ duplicate: boolean; outcome: string }` (plain)
- **ingestFor** `{ client: string; body: unknown }` → `{ duplicate: boolean; outcome: string }` (plain)

## SmsDesk (service)

File: packages/channel-sms/src/restate/index.ts

- **threads** `{ filter?: ThreadFilter; limit?: number; offset?: number } & ForClient` → `ThreadSummary[]` (serviceHandler)
- **thread** `{ contactId: number } & ForClient` → `Thread | null` (serviceHandler)
- **markRead** `{ contactId: number } & ForClient` → `void` (serviceHandler)
- **reply** `{ contactId: number; body: string; kind?: "manual" | "pay" | "doc" } & ForClient` → `{ messageId: number }` (serviceHandler)
- **start** `{ phone: string; why: string; body: string }` → `{ contactId: number; messageId: number }` (serviceHandler)
- **pushKey** `void` → `{ publicKey: string | null }` (serviceHandler)
- **subscribe** `{ subscription: PushSubscriptionInput; by: string }` → `{ pushed: boolean; error: string | null }` (serviceHandler)
- **unsubscribe** `{ endpoint: string }` → `{ removed: boolean }` (serviceHandler)
- **label** `{ messageId: number; disposition: Disposition } & ForClient` → `void` (serviceHandler)
- **numbers** `void` → `NumbersView` (serviceHandler)
- **syncNumbers** `void` → `SyncStats` (serviceHandler)
- **templates** `{ client?: string | null }` → `SlotView[]` (serviceHandler)
- **setTemplate** `Omit<SetTemplate, "by"> & { by?: string | null; viewer?: { email?: string }; client?: string | null; }` → `SlotView` (serviceHandler)
- **register** `void` → `RegistrationStats` (serviceHandler)
- **pause** `{ e164: string; reason?: string }` → `boolean` (serviceHandler)
- **resume** `{ e164: string }` → `boolean` (serviceHandler)
- **stats** `{ days?: number; niche?: string } & ForClient` → `SmsStats` (serviceHandler)
- **addContact** `{ phone: string; basis: ContactBasis; why: string; niche?: string } & ForClient` → `{ contactId: number; e164: string; created: boolean }` (serviceHandler)
- **lift** `{ niche?: string; limit?: number } & ForClient` → `LiftStats` (serviceHandler)
- **forms** `void` → `FormStats` (serviceHandler)
- **reminders** `{ client?: string | null }` → `ReminderStats` (serviceHandler)
- **enroll** `{ sequence: string; niche?: string; limit: number } & ForClient` → `EnrollStats` (serviceHandler)
