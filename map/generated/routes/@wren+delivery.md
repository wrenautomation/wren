# @wren/delivery: routes

Services: 4.

## BillingConsole (service via `portalService`)

File: packages/delivery/src/billing/console.ts

- **dismiss** `?` → `?` (serviceHandler)
- **match** `?` → `?` (serviceHandler)

## DeliveryPortal (service via `portalService`)

File: packages/delivery/src/service.ts

- **access** `Req<"access">` → `{ id: number; status: "open" | "declined" | "granted" | "revoked"; }` (plain)
- **account** `Req<"account">` → `AccountView` (plain)
- **addDomain** `PortalRequest & { hostname: string }` → `import("./domains.js").DomainView` (plain)
- **answer** `Req<"answer">` → `{ id: number; answeredAt: string | null; }` (plain)
- **ask** `Req<"ask">` → `{ id: number; }` (plain)
- **board** `Req<"board">` → `BoardRow[]` (plain)
- **comment** `Req<"comment">` → `{ id: number; }` (plain)
- **contract** `Req<"contract">` → `ContractView` (plain)
- **decide** `Req<"decide">` → `{ id: number; status: "approved" | "waiting" | "changes"; }` (plain)
- **deliver** `Req<"deliver">` → `{ id: number; version: number; }` (plain)
- **domains** `PortalRequest` → `{ domains: import("./domains.js").DomainView[]; target: string; ready: boolean; canManage: boolean; }` (plain)
- **done** `Req<"done">` → `{ step: string; doneOn: string | null; }` (plain)
- **file** `Req<"file">` → `{ url: string; }` (plain)
- **hide** `Req<"hide">` → `{ hidden: boolean; }` (plain)
- **home** `Req<"home">` → `DeliveryHome` (plain)
- **interest** `Req<"interest">` → `{ offerId: string; }` (plain)
- **invite** `Req<"invite">` → `{ email: string; role: string; }` (plain)
- **invoicePdf** `Req<"invoicePdf">` → `{ name: string; base64: string; }` (plain)
- **mail** `Req<"mail">` → `{ level: "off" | "all" | "digest"; }` (plain)
- **me** `Req<"me">` → `Me` (plain)
- **messagingChange** `Parameters<typeof rules.messagingChange>[0]` → `{ done: string[]; skipped: string[]; }` (plain)
- **messagingLinksOff** `Parameters<typeof rules.messagingLinksOff>[0]` → `{ done: string[]; skipped: string[]; }` (plain)
- **messagingLinksOn** `Parameters<typeof rules.messagingLinksOn>[0]` → `{ done: string[]; skipped: string[]; }` (plain)
- **messagingPostal** `Parameters<typeof rules.messagingPostal>[0]` → `{ done: string[]; skipped: string[]; }` (plain)
- **messagingSender** `Parameters<typeof rules.messagingSender>[0]` → `{ done: string[]; skipped: string[]; }` (plain)
- **people** `Req<"people">` → `{ people: MemberView[]; canManage: boolean; roles: { id: string; name: string; }[]; mail: MailLevel | null; }` (plain)
- **post** `Req<"post">` → `{ id: number; }` (plain)
- **pulse** `Req<"pulse">` → `{ score: number; }` (plain)
- **recap** `Req<"recap">` → `{ recap: { subject: string; text: string; } | null; }` (plain)
- **recordsExport** `Req<"recordsExport">` → `RecordsFile` (plain)
- **recordsGet** `Req<"recordsGet">` → `RecordAnswer` (plain)
- **recordsList** `Req<"recordsList">` → `RecordsPage` (plain)
- **recordsStats** `Req<"recordsStats">` → `RecordsStat` (plain)
- **recordsTypes** `Req<"recordsTypes">` → `RecordMeta[]` (plain)
- **remove** `Req<"remove">` → `{ removed: string; }` (plain)
- **removeDomain** `PortalRequest & { hostname: string }` → `{ removed: string; }` (plain)
- **result** `Req<"result">` → `{ key: string; value: number; }` (plain)
- **review** `Req<"review">` → `{ moment: string; score: number | null; }` (plain)
- **sign** `Req<"sign">` → `{ signedAt: string | null; }` (plain)
- **slip** `Req<"slip">` → `{ step: string; dueOn: string | null; }` (plain)
- **start** `Req<"start">` → `{ id: number; }` (plain)
- **updates** `Req<"updates">` → `{ updates: UpdateView[]; more: boolean; }` (plain)
- **upload** `Req<"upload">` → `{ key: string; url: string; }` (plain)
- **webhookAdd** `PortalRequest & Record<string, unknown>` → `{ subscription: import("@wren/core/webhooks").SubscriptionView; secret: string; }` (plain)
- **webhookDelivery** `PortalRequest & { id?: unknown }` → `{ payload: unknown; tries: { n: number; status: number | null; latencyMs: number; response: string | null; error: string | null; at: string; }[]; id: string; subscription: string; event: string; eventId: string; state: import("@wren/core").DeliveryState; attempts: number; status: number | null; latencyMs: number | null; response: string | null; error: string | null; at: string; lastAt: string | null; nextAt: string | null; }` (plain)
- **webhookEdit** `PortalRequest & Record<string, unknown>` → `import("@wren/core/webhooks").SubscriptionView` (plain)
- **webhookRedeliver** `PortalRequest & { id?: unknown }` → `{ id: string; }` (plain)
- **webhookRemove** `PortalRequest & { id?: unknown }` → `{ removed: string; }` (plain)
- **webhookRotate** `PortalRequest & { id?: unknown }` → `{ subscription: import("@wren/core/webhooks").SubscriptionView; secret: string; }` (plain)
- **webhookTest** `PortalRequest & { id?: unknown }` → `{ error: string | null; id: string; subscription: string; event: string; eventId: string; state: import("@wren/core").DeliveryState; attempts: number; status: number | null; latencyMs: number | null; response: string | null; at: string; lastAt: string | null; nextAt: string | null; }` (plain)
- **webhooks** `PortalRequest` → `{ webhooks: import("@wren/core/webhooks").SubscriptionView[]; deliveries: import("@wren/core/webhooks").DeliveryView[]; events: { id: string; says: "A lead came in through a door" | "A form was filled" | "A lead replied by email, text or DM" | "A call was booked or moved" | "A call was cancelled" | "A person reached an offer node, or a call was marked won" | "A person moved to another node of the shape, or was dropped" | "A pay link was paid" | "A payment was refunded, or a dispute lost" | "A bank payment on a pay link failed" | "A document you sent was opened" | "A document you sent was signed" | "A document you sent was declined" | "A connected app added a contact, got an invoice paid or finished a job"; }[]; canManage: boolean; }` (plain)

## Domains (service)

File: packages/delivery/src/domains.ts

- **resolve** `{ host: string }` → `{ client: string | null; }` (serviceHandler)

## HealthConsole (service via `portalService`)

File: packages/delivery/src/health/console.ts

- **clearOverride** `?` → `?` (serviceHandler)
- **flagAddress** `?` → `?` (serviceHandler)
- **flagClear** `?` → `?` (serviceHandler)
- **flagOwn** `?` → `?` (serviceHandler)
- **flagRaise** `?` → `?` (serviceHandler)
- **flagTake** `?` → `?` (serviceHandler)
- **override** `?` → `?` (serviceHandler)
- **rate** `?` → `?` (serviceHandler)
