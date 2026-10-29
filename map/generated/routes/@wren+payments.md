# @wren/payments: routes

Services: 2.

## Payments (service)

File: packages/payments/src/service.ts

- **send** `{ id: string }` → `{ sent: boolean; why?: never; } | { sent: boolean; why: string; }` (serviceHandler)
- **stripe** `{ client: string; raw: string; signature?: string | null }` → `HookAnswer` (serviceHandler)

## PaymentsConsole (service via `portalService`)

File: packages/payments/src/console.ts

- **again** `IdsRequest` → `{ links: { id: string; status: string; }[]; }` (serviceHandler)
- **approve** `IdsRequest` → `{ done: string[]; }` (serviceHandler)
- **connect** `ConnectRequest` → `{ connected: boolean; webhook: "pasted"; last4: null; url?: never; why?: never; } | { connected: boolean; webhook: "pasted"; last4: string; url?: never; why?: never; } | { connected: boolean; webhook: "api"; last4: string; url?: never; why?: never; } | { connected: boolean; webhook: null; url: string; last4: string; why: string; }` (serviceHandler)
- **create** `CreateRequest` → `{ links: { id: string; status: string; }[]; }` (serviceHandler)
- **decline** `IdsRequest` → `{ done: string[]; }` (serviceHandler)
- **fromThread** `FromThreadRequest` → `{ links: { id: string; status: string; }[]; }` (serviceHandler)
- **recordsExport** `PortalRequest & ExportAsk` → `import("@wren/core/records/serve").RecordsFile` (serviceHandler)
- **recordsGet** `PortalRequest & GetAsk` → `import("@wren/core/records/serve").RecordAnswer` (serviceHandler)
- **recordsList** `PortalRequest & ListAsk` → `import("@wren/core/records/serve").RecordsPage` (serviceHandler)
- **recordsStats** `PortalRequest & StatsAsk` → `import("@wren/core/records/serve").RecordsStat` (serviceHandler)
- **recordsTypes** `PortalRequest` → `import("@wren/core/records").RecordMeta[]` (serviceHandler)
- **status** `PortalRequest` → `{ connected: boolean; live: boolean | null; webhook: string | null; url: string; keyStore: boolean; last4: string | null; managed: string; approves: boolean; note: string | null; drift: number; }` (serviceHandler)
