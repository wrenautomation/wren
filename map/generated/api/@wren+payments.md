# @wren/payments: interface

Exports: 101. Files: 11.

## packages/payments/src/components.ts

- **PAYMENTS_COMPONENTS** (const) `import("@wren/core/components").Component[]`
- **PAY_LINKS** (const) `"payments.links"`

## packages/payments/src/console-routes.ts

- **PAYMENTS_CONSOLE_APPS** (const) `{ readonly "*": null; readonly status: "payments"; readonly create: "payments"; readonly fromThread: { readonly app: "texts"; readonly channel: "sms"; }; readonly approve: "payments"; readonly decline: "payments"; readonly again: "payments"; readonly connect: "payments"; }`
- **PAYMENTS_CONSOLE_ROUTES** (const) `{ readonly recordsTypes: "read"; readonly recordsList: "read"; readonly recordsGet: "read"; readonly recordsExport: "read"; readonly recordsStats: "read"; readonly status: "read"; readonly create: "act"; readonly fromThread: "act"; readonly approve: "act"; readonly decline: "act"; readonly again: "a…`
- **PAYMENTS_CONSOLE_WRITES** (const) `readonly PaymentsConsoleRoute[]`

## packages/payments/src/console.ts

- **ConnectRequest** (interface) `interface ConnectRequest extends PortalRequest { keyRef?: string | null; secretRef?: string | null; }`
- **CreateRequest** (interface) `interface CreateRequest extends PortalRequest { channel?: string | null; phone?: string | null; email?: string | null; name?: string | null; amount: string | number; description: string; quantity?: string | number | null; }`
- **IdsRequest** (interface) `interface IdsRequest extends PortalRequest { ids: string[]; }`
- **makePaymentsConsole** (function) `(deps: PaymentsConsoleDeps): restate.ServiceDefinition<"PaymentsConsole", { recordsTypes: (_: restate.Context, req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (_: restate.Context, req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (_: res…`
- **paymentsConsoleApi** (function) `(deps: PaymentsConsoleDeps): { recordsTypes: (req: PortalRequest) => Promise<import("@wren/core/records").RecordMeta[]>; recordsList: (req: PortalRequest & ListAsk) => Promise<import("@wren/core/records/serve").RecordsPage>; recordsGet: (req: PortalRequest & GetAsk) => Promise<import("@wren/core/records/serve").RecordAnswer>; r…`

## packages/payments/src/reconcile.ts

- **PayReconcile** (type) `type PayReconcile = ReturnType<typeof makePayReconcile>;`
- **ReconcileStats** (interface) `interface ReconcileStats { clients: number; checked: number; healed: number; drift: number; endpoints: number; noted: number; skipped: { client: string; why: string }[]; touched: string[]; }`
- **makePayReconcile** (function) `(deps: PayReconcileDeps): restate.VirtualObjectDefinition<string, Record<never, never> & Record<never, (ctx: restate.ObjectContext) => Promise<PassOutcome<ReconcileStats>>> & { sync: (ctx: restate.ObjectContext) => Promise<PassOutcome<ReconcileStats>>; start: (ctx: restate.ObjectContext, settings?: Record<string, unknown> | …`
- **reconcileAll** (function) `(d: Pick<PaymentsDeps, "main" | "open" | "keys" | "fetch" | "stripeBase" | "portal">, now: Date): Promise<ReconcileStats>`

## packages/payments/src/records.ts

- **LINK_RECORD** (const) `"payments.link"`
- **PAYMENTS_RECORDS** (const) `readonly RecordType[]`
- **linkRecordFor** (function) `(client: string): RecordType`

## packages/payments/src/schema.ts

- **PAY_CHANNELS** (const) `readonly ["sms", "email"]`
- **PayAccount** (type) `type PayAccount = typeof payAccounts.$inferSelect;`
- **PayChannel** (type) `type PayChannel = (typeof PAY_CHANNELS)[number];`
- **PayLink** (type) `type PayLink = typeof payLinks.$inferSelect;`
- **payAccounts** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "pay_accounts"; schema: undefined; columns: { client: import("drizzle-orm/pg-core").PgColumn<{ name: "client"; tableName: "pay_accounts"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault…`
- **payEvents** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "pay_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "pay_events"; dataType: "string"; columnType: "PgVarchar"; data: string; driverParam: string; notNull: true; hasDefault: false; isP…`
- **payLinks** (const) `import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "pay_links"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgColumn<{ name: "id"; tableName: "pay_links"; dataType: "string"; columnType: "PgUUID"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimary…`

## packages/payments/src/service.ts

- **PAYMENTS** (const) `{ readonly name: "Payments"; }`
- **PaymentsDeps** (interface) `interface PaymentsDeps { main: Db; open: (client: Pick<Client, "id" | "database">) => Db; keys: KeyStore | null; fetch: Fetch; portal: string; mailer: ((from: string) => SendMail) | null; fire?: FireTriggers; stripeBase?: string; stripeRetry?: StripeRetry; }`
- **PaymentsService** (type) `type PaymentsService = ReturnType<typeof makePayments>;`
- **STRIPE_RETRY** (const) `StripeRetry`
- **SendMail** (type) `type SendMail = (m: { to: string; subject: string; text: string }) => Promise<void>;`
- **WEBHOOK_SECRET** (const) `"STRIPE_WEBHOOK_SECRET"`
- **makePayments** (function) `(deps: PaymentsDeps): restate.ServiceDefinition<"Payments", { send: (ctx: restate.Context, req: { id: string; }) => Promise<{ sent: boolean; why?: never; } | { sent: boolean; why: string; }>; stripe: (ctx: restate.Context, req: { client: string; raw: string; signature?: string | null; }) => Promise<HookAnswer>; }>`
- **payEmail** (function) `(business: string, l: PayLink, url: string): { subject: string; text: string; }`
- **payText** (function) `(business: string, l: PayLink, url: string): string`
- **paymentFired** (function) `(l: PayLink, change: PayChange = "paid"): Fired`
- **settleLink** (function) `(d: Pick<PaymentsDeps, "main" | "open">, id: string): Promise<void>`
- **stripeKeyOf** (function) `(d: Pick<PaymentsDeps, "main" | "keys">, client: string, why: string): Promise<string>`
- **stripeStep** (function) `(ctx: restate.Context, name: string, retry: StripeRetry, fn: () => Promise<T>): Promise<T | { error: string }>`
- **takeWebhook** (function) `(d: Pick<PaymentsDeps, "main" | "open" | "keys">, req: { client: string; raw: string; signature?: string | null }, now: Date): Promise<HookAnswer & { link: string | null }>`
- **tellChanges** (function) `(ctx: restate.Context, d: PaymentsDeps, id: string): Promise<("paid" | "failed" | "refunded")[]>`
- **webhookUrl** (function) `(portal: string, client: string): string`

## packages/payments/src/setups.ts

- **PAYMENTS_SETUPS** (const) `import("@wren/core/setup").Setup[]`
- **stripeChecks** (function) `(main: Queryable): Record<string, SetupCheck>`

## packages/payments/src/states.ts

- **DISPUTES** (const) `readonly ["open", "won", "lost"]`
- **Dispute** (type) `type Dispute = (typeof DISPUTES)[number];`
- **EventResult** (type) `type EventResult = (typeof PAY_EVENT_RESULTS)[number];`
- **LinkMoney** (interface) `interface LinkMoney { status: PayStatus; due: number; paidCents: number | null; paidAt: Date | null; session: string | null; intent: string | null; live: boolean | null; refundedCents: number; refundedAt: Date | null; dispute: Dispute | null; disputeAt: number | null; }`
- **PAY_CHANGES** (const) `readonly ["paid", "refunded", "failed"]`
- **PAY_EVENT_RESULTS** (const) `readonly ["paid", "processing", "unpaid", "refunded", "disputed", "stale", "unknown", "ignored", "drift"]`
- **PAY_STATUSES** (const) `readonly ["waiting", "sending", "sent", "processing", "unpaid", "paid", "refunded", "declined", "failed"]`
- **PayChange** (type) `type PayChange = (typeof PAY_CHANGES)[number];`
- **PayStatus** (type) `type PayStatus = (typeof PAY_STATUSES)[number];`
- **Stepped** (interface) `interface Stepped { next: LinkMoney; result: EventResult; changed: boolean; drift: string | null; }`
- **disputeOf** (function) `(status: string | null): Dispute | null`
- **hasAccess** (function) `(m: Pick<LinkMoney, "status">): boolean`
- **netCents** (function) `(m: Pick<LinkMoney, "status" | "paidCents" | "refundedCents">): number`
- **reached** (function) `(m: Pick<LinkMoney, "status" | "paidCents">): PayChange[]`
- **settled** (function) `(m: LinkMoney): PayStatus`
- **step** (function) `(m: LinkMoney, f: StripeFact, now: Date): Stepped`

## packages/payments/src/store.ts

- **Applied** (interface) `interface Applied { fresh: boolean; result: EventResult; link: PayLink | null; drift: string | null; }`
- **NewLink** (interface) `interface NewLink { client: string; channel: PayChannel; contact?: number | null; email?: string | null; name?: string | null; description: string; cents: number; quantity?: number; by: string; approved?: boolean; now: Date; id?: string; }`
- **PayRefusal** (class) ``
- **applyEvent** (function) `(main: Db, client: string, f: StripeFact, now: Date): Promise<Applied>`
- **approveLinks** (function) `(main: Db, ids: readonly string[], by: string, now: Date): Promise<PayLink[]>`
- **centsOf** (function) `(amount: unknown): number`
- **claimChanges** (function) `(main: Db, id: string, token: string): Promise<{ link: PayLink | null; changes: PayChange[] }>`
- **createLink** (function) `(main: Db, l: NewLink): Promise<PayLink>`
- **declineLinks** (function) `(main: Db, ids: readonly string[], by: string, now: Date): Promise<string[]>`
- **keepStripeLink** (function) `(main: Db, id: string, l: { stripeLink: string; url: string; live: boolean }): Promise<void>`
- **keepWebhookNote** (function) `(main: Queryable, client: string, note: string | null): Promise<void>`
- **linkById** (function) `(main: Queryable, id: string): Promise<PayLink | null>`
- **linkIdFor** (function) `(seed: string, part: string | number = ""): string`
- **linkIdOf** (function) `(id: string): string`
- **linksToCheck** (function) `(main: Queryable, client: string, now: Date, limit = 50): Promise<{ id: string; client: string; contact: number | null; email: string | null; name: string | null; channel: string; description: string; amountCents: number; quantity: number; currency: string; status: string; why: string | null; stripeLink: string | null; url: string | null; message: number |…`
- **markChecked** (function) `(main: Db, id: string, now: Date): Promise<void>`
- **markFailed** (function) `(main: Db, id: string, why: string): Promise<void>`
- **markSent** (function) `(main: Db, id: string, o: { message: number | null; now: Date }): Promise<void>`
- **money** (function) `(cents: number, currency = "usd"): string`
- **moneyOf** (function) `(l: PayLink): LinkMoney`
- **noteDrift** (function) `(main: Db, l: Pick<PayLink, "id" | "client">, key: string, what: string, now: Date): Promise<boolean>`
- **payAccountOf** (function) `(main: Queryable, client: string): Promise<PayAccount | null>`
- **payApprovalId** (function) `(id: string): string`
- **payClients** (function) `(main: Queryable): Promise<PayAccount[]>`
- **savePayAccount** (function) `(main: Db, a: { client: string; endpoint?: string | null; secretName?: string | null; how?: "api" | "pasted" | null; live?: boolean | null; note?: string | null; by: string; }): Promise<void>`
- **syncContactPaid** (function) `(main: Queryable, db: Queryable, client: string, contact: number): Promise<{ cents: number; at: Date | null }>`
- **waitingPayLinks** (function) `(main: Queryable): Promise<{ id: string; client: string; clientName: string | null; channel: string; name: string | null; email: string | null; description: string; cents: number; quantity: number; currency: string; by: string; at: Date; }[]>`

## packages/payments/src/stripe.ts

- **Fetch** (type) `type Fetch = (url: string, init: RequestInit) => Promise<Response>;`
- **READ_ACCESS** (const) `"Checkout Sessions, Payment Intents, Charges and Disputes"`
- **STRIPE_API** (const) `"https://api.stripe.com"`
- **STRIPE_EVENTS** (const) `readonly ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "charge.refunded", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]`
- **STRIPE_VERSION** (const) `"2026-08-26.dahlia"`
- **StripeApi** (type) `type StripeApi = ReturnType<typeof stripeApi>;`
- **StripeError** (class) `constructor(message: string, readonly status: number, readonly code: string | null, readonly transient = false); get denied()`
- **StripeFact** (interface) `interface StripeFact { event: string; type: string; kind: FactKind; created: number | null; session: string | null; link: string | null; intent: string | null; wren: string | null; status: string | null; cents: number | null; currency: string | null; email: string | null; refunded: number | null; live: boolean; }`
- **TOLERANCE_S** (const) `300`
- **factsOf** (function) `(raw: string): StripeFact | null`
- **isSigningSecret** (function) `(s: string): boolean`
- **keyMode** (function) `(key: string): "live" | "test" | null`
- **kindOf** (function) `(type: string): FactKind`
- **signFor** (function) `(raw: string, secret: string, at: Date): string`
- **stripeApi** (function) `(key: string, fetchFn: Fetch, base = STRIPE_API, retries?: number): { createPrice: (o: { id: string; cents: number; currency: string; description: string; }) => Promise<StripePrice>; createPaymentLink: (o: { id: string; client: string; price: string; quantity: number; }) => Promise<StripeLink>; registerWebhook: (o: { client: string; url: string; idem: string; }) => …`
- **verifySignature** (function) `(raw: string, header: string | null | undefined, secret: string, now: Date): { ok: true } | { ok: false; why: string }`
