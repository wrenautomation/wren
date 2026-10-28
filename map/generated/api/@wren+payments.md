# @wren/payments: interface

Exports: 101. Files: 11.

## packages/payments/src/components.ts

- **PAY_LINKS** (const) `"payments.links"`
- **PAYMENTS_COMPONENTS** (const) `import("@wren/core/components").Component[]`

## packages/payments/src/console-routes.ts

- **PAYMENTS_CONSOLE_ROUTES** (const) `{ readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsGet: "read"; readonly recordsExport: "read"; readonly recordsStats: "read"; readonly status: "read"; readonly create: "act"; readonly fromThread: "act"; readonly approve: "act"; readonly decline: "act"; readonly again: "a…`
- **PAYMENTS_CONSOLE_APPS** (const) `{ readonly "*": null; readonly status: "payments"; readonly create: "payments"; readonly fromThread: { readonly app: "texts"; readonly channel: "sms"; }; readonly approve: "payments"; readonly decline: "payments"; readonly again: "payments"; readonly connect: "payments"; }`
- **PAYMENTS_CONSOLE_WRITES** (const) `readonly PaymentsConsoleRoute[]`

## packages/payments/src/console.ts

- **paymentsConsoleApi** (function) `(deps: PaymentsConsoleDeps): { recordsTypes: (req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (req: PortalRequest & GetAsk) => Promise<import("@wren/core/records/serve").RecordAnswer>; r…`
- **makePaymentsConsole** (function) `(deps: PaymentsConsoleDeps): restate.ServiceDefinition<"PaymentsConsole", { recordsTypes: (_: restate.Context, req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (_: restate.Context, req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (_: res…`
- **CreateRequest** (interface) `interface CreateRequest extends PortalRequest { channel?: string | null; phone?: string | null; email?: string | null; name?: string | null; amount: string | number; description: string; quantity?: string | number | null; }`
- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids: string[]; }`
- **ConnectRequest** (interface) `interface ConnectRequest extends PortalRequest { keyRef?: string | null; secretRef?: string | null; }`

## packages/payments/src/reconcile.ts

- **reconcileAll** (function) `(d: Pick<PaymentsDeps, "main" | "open" | "keys" | "fetch" | "stripeBase" | "portal">, now: Date): Promise<ReconcileStats>`
- **makePayReconcile** (function) `(deps: PayReconcileDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<ReconcileStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<ReconcileStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | …`
- **ReconcileStats** (interface) `interface ReconcileStats { clients: number; checked: number; healed: number; drift: number; endpoints: number; noted: number; skipped: { client: string; why: string }[]; touched: string[]; }`
- **PayReconcile** (type) `type PayReconcile = ReturnType<typeof makePayReconcile>;`

## packages/payments/src/records.ts

- **linkRecordFor** (function) `(client: string): RecordType`
- **LINK_RECORD** (const) `"payments.link"`
- **PAYMENTS_RECORDS** (const) `readonly RecordType[]`

## packages/payments/src/schema.ts

- **PAY_CHANNELS** (const) `readonly ["sms", "email"]`
- **PayChannel** (type) `type PayChannel = (typeof PAY_CHANNELS)[number];`
- **payLinks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "pay_links"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "pay_links"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimary…`
- **PayLink** (type) `type PayLink = typeof payLinks.$inferSelect;`
- **payAccounts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "pay_accounts"; schema: undefined; columns: { client: import("drizzle-orm/pg-core").PgColumn<{ name: "client"; tableName: "pay_accounts"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault…`
- **PayAccount** (type) `type PayAccount = typeof payAccounts.$inferSelect;`
- **payEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "pay_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "pay_events"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false; isP…`

## packages/payments/src/service.ts

- **stripeStep** (function) `(ctx: restate.Context, name: string, retry: StripeRetry, fn: () => Promise<T>): Promise<T | { error: string }>`
- **stripeKeyOf** (function) `(d: Pick<PaymentsDeps, "main" | "keys">, client: string, why: string): Promise<string>`
- **payEmail** (function) `(business: string, l: PayLink, url: string): { subject: string; text: string; }`
- **paymentFired** (function) `(l: PayLink, change: PayChange = "paid"): Fired`
- **takeWebhook** (function) `(d: Pick<PaymentsDeps, "main" | "open" | "keys">, req: { client: string; raw: string; signature?: string | null }, now: Date): Promise<HookAnswer & { link: string | null }>`
- **settleLink** (function) `(d: Pick<PaymentsDeps, "main" | "open">, id: string): Promise<void>`
- **tellChanges** (function) `(ctx: restate.Context, d: PaymentsDeps, id: string): Promise<("paid" | "failed" | "refunded")[]>`
- **makePayments** (function) `(deps: PaymentsDeps): restate.ServiceDefinition<"Payments", { send: (ctx: restate.Context, req: { id: string; }) => Promise<{ sent: boolean; why?: never; } | { sent: boolean; why: string; }>; stripe: (ctx: restate.Context, req: { client: string; raw: string; signature?: string | null; }) => Promise<HookAnswer>; }>`
- **SendMail** (type) `type SendMail = (m: { to: string; subject: string; text: string }) => Promise<void>;`
- **PaymentsDeps** (interface) `interface PaymentsDeps { main: Db; open: (client: Pick<Client, "id" | "database">) => Db; keys: KeyStore | null; fetch: Fetch; portal: string; mailer: ((from: string) => SendMail) | null; fire?: FireTriggers; stripeBase?: string; stripeRetry?: StripeRetry; }`
- **STRIPE_RETRY** (const) `StripeRetry`
- **PAYMENTS** (const) `{ readonly name: "Payments"; }`
- **WEBHOOK_SECRET** (const) `"STRIPE_WEBHOOK_SECRET"`
- **webhookUrl** (function) `(portal: string, client: string): string`
- **payText** (function) `(business: string, l: PayLink, url: string): string`
- **PaymentsService** (type) `type PaymentsService = ReturnType<typeof makePayments>;`

## packages/payments/src/setups.ts

- **stripeChecks** (function) `(main: Queryable): Record<string, SetupCheck>`
- **PAYMENTS_SETUPS** (const) `import("@wren/core/setup").Setup[]`

## packages/payments/src/states.ts

- **PAY_STATUSES** (const) `readonly ["waiting", "sending", "sent", "processing", "unpaid", "paid", "refunded", "declined", "failed"]`
- **PayStatus** (type) `type PayStatus = (typeof PAY_STATUSES)[number];`
- **PAY_EVENT_RESULTS** (const) `readonly ["paid", "processing", "unpaid", "refunded", "disputed", "stale", "unknown", "ignored", "drift"]`
- **settled** (function) `(m: LinkMoney): PayStatus`
- **step** (function) `(m: LinkMoney, f: StripeFact, now: Date): Stepped`
- **reached** (function) `(m: Pick<LinkMoney, "status" | "paidCents">): PayChange[]`
- **DISPUTES** (const) `readonly ["open", "won", "lost"]`
- **Dispute** (type) `type Dispute = (typeof DISPUTES)[number];`
- **disputeOf** (function) `(status: string | null): Dispute | null`
- **LinkMoney** (interface) `interface LinkMoney { status: PayStatus; due: number; paidCents: number | null; paidAt: Date | null; session: string | null; intent: string | null; live: boolean | null; refundedCents: number; refundedAt: Date | null; dispute: Dispute | null; disputeAt: number | null; }`
- **EventResult** (type) `type EventResult = (typeof PAY_EVENT_RESULTS)[number];`
- **Stepped** (interface) `interface Stepped { next: LinkMoney; result: EventResult; changed: boolean; drift: string | null; }`
- **hasAccess** (function) `(m: Pick<LinkMoney, "status">): boolean`
- **PAY_CHANGES** (const) `readonly ["paid", "refunded", "failed"]`
- **PayChange** (type) `type PayChange = (typeof PAY_CHANGES)[number];`
- **netCents** (function) `(m: Pick<LinkMoney, "status" | "paidCents" | "refundedCents">): number`

## packages/payments/src/store.ts

- **linkIdFor** (function) `(seed: string, part: string | number = ""): string`
- **centsOf** (function) `(amount: unknown): number`
- **createLink** (function) `(main: Db, l: NewLink): Promise<PayLink>`
- **linkById** (function) `(main: Queryable, id: string): Promise<PayLink | null>`
- **approveLinks** (function) `(main: Db, ids: readonly string[], by: string, now: Date): Promise<PayLink[]>`
- **declineLinks** (function) `(main: Db, ids: readonly string[], by: string, now: Date): Promise<string[]>`
- **keepStripeLink** (function) `(main: Db, id: string, l: { stripeLink: string; url: string; live: boolean }): Promise<void>`
- **markSent** (function) `(main: Db, id: string, o: { message: number | null; now: Date }): Promise<void>`
- **markFailed** (function) `(main: Db, id: string, why: string): Promise<void>`
- **waitingPayLinks** (function) `(main: Queryable): Promise<{ id: string; client: string; clientName: string | null; channel: string; name: string | null; email: string | null; description: string; cents: number; quantity: number; currency: string; by: string; at: Date; }[]>`
- **applyEvent** (function) `(main: Db, client: string, f: StripeFact, now: Date): Promise<Applied>`
- **syncContactPaid** (function) `(main: Queryable, db: Queryable, client: string, contact: number): Promise<{ cents: number; at: Date | null }>`
- **claimChanges** (function) `(main: Db, id: string, token: string): Promise<{ link: PayLink | null; changes: PayChange[] }>`
- **linksToCheck** (function) `(main: Queryable, client: string, now: Date, limit = 50): Promise<{ id: string; client: string; contact: number | null; email: string | null; name: string | null; channel: string; description: string; amountCents: number; quantity: number; currency: string; status: string; why: string | null; stripeLink: string | null; url: string | null; message: number |…`
- **payClients** (function) `(main: Queryable): Promise<PayAccount[]>`
- **markChecked** (function) `(main: Db, id: string, now: Date): Promise<void>`
- **noteDrift** (function) `(main: Db, l: Pick<PayLink, "id" | "client">, key: string, what: string, now: Date): Promise<boolean>`
- **payAccountOf** (function) `(main: Queryable, client: string): Promise<PayAccount | null>`
- **keepWebhookNote** (function) `(main: Queryable, client: string, note: string | null): Promise<void>`
- **savePayAccount** (function) `(main: Db, a: { client: string; endpoint?: string | null; secretName?: string | null; how?: "api" | "pasted" | null; live?: boolean | null; note?: string | null; by: string; }): Promise<void>`
- **PayRefusal** (class) ``
- **money** (function) `(cents: number, currency = "usd"): string`
- **NewLink** (interface) `interface NewLink { client: string; channel: PayChannel; contact?: number | null; email?: string | null; name?: string | null; description: string; cents: number; quantity?: number; by: string; approved?: boolean; now: Date; id?: string; }`
- **payApprovalId** (function) `(id: string): string`
- **linkIdOf** (function) `(id: string): string`
- **moneyOf** (function) `(l: PayLink): LinkMoney`
- **Applied** (interface) `interface Applied { fresh: boolean; result: EventResult; link: PayLink | null; drift: string | null; }`

## packages/payments/src/stripe.ts

- **stripeApi** (function) `(key: string, fetchFn: Fetch, base = STRIPE_API, retries?: number): { createPrice: (o: { id: string; cents: number; currency: string; description: string; }) => Promise<StripePrice>; createPaymentLink: (o: { id: string; client: string; price: string; quantity: number; }) => Promise<StripeLink>; registerWebhook: (o: { client: string; url: string; idem: string; }) => …`
- **keyMode** (function) `(key: string): "live" | "test" | null`
- **verifySignature** (function) `(raw: string, header: string | null | undefined, secret: string, now: Date): { ok: true } | { ok: false; why: string }`
- **signFor** (function) `(raw: string, secret: string, at: Date): string`
- **factsOf** (function) `(raw: string): StripeFact | null`
- **STRIPE_API** (const) `"https://api.stripe.com"`
- **STRIPE_VERSION** (const) `"2026-08-26.dahlia"`
- **STRIPE_EVENTS** (const) `readonly ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]`
- **READ_ACCESS** (const) `"Checkout Sessions, Payment Intents, Charges and Disputes"`
- **TOLERANCE_S** (const) `300`
- **Fetch** (type) `type Fetch = (url: string, init: RequestInit) => Promise<Response>;`
- **StripeError** (class) `constructor(message: string, readonly status: number, readonly code: string | null, readonly transient = false); get denied()`
- **StripeApi** (type) `type StripeApi = ReturnType<typeof stripeApi>;`
- **isSigningSecret** (function) `(s: string): boolean`
- **StripeFact** (interface) `interface StripeFact { event: string; type: string; kind: FactKind; created: number | null; session: string | null; link: string | null; intent: string | null; wren: string | null; status: string | null; cents: number | null; currency: string | null; email: string | null; refunded: number | null; live: boolean; }`
- **kindOf** (function) `(type: string): FactKind`
