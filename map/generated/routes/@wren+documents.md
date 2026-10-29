# @wren/documents: routes

Services: 2.

## Documents (service)

File: packages/documents/src/service.ts

- **act** `Req & { act: "sign" | "decline"; fields: Record<string, string> }` → `Answer` (serviceHandler)
- **cancel** `{ id: string; by?: string | null }` → `{ done: boolean; why?: never; did?: never; } | { done: boolean; why: string; did?: never; } | { done: boolean; did: "cancelled" | "deleted" | "kept"; why?: never; }` (serviceHandler)
- **deposit** `Req` → `Answer` (serviceHandler)
- **pdf** `Req` → `Answer` (serviceHandler)
- **send** `{ id: string; remind?: boolean | null; by?: string | null }` → `{ sent: boolean; url: null; why?: never; } | { sent: boolean; why: string; url: null; } | { sent: boolean; url: string; why?: never; }` (serviceHandler)
- **serve** `Req` → `Answer` (serviceHandler)
- **signed** `{ event: string; payload: object }` → `{ ok: boolean; why: string; ignored?: never; } | { ok: boolean; why?: never; ignored?: never; } | { ok: boolean; ignored: string; why?: never; }` (serviceHandler)

## DocumentsConsole (service via `portalService`)

File: packages/documents/src/console.ts

- **approve** `IdsRequest` → `{ done: string[]; }` (serviceHandler)
- **create** `?` → `?` (serviceHandler)
- **decline** `?` → `?` (serviceHandler)
- **duplicate** `?` → `?` (serviceHandler)
- **pdf** `IdRequest & { part?: string | null }` → `{ name: string; url: string; base64?: never; } | { name: string; base64: string; url?: never; }` (serviceHandler)
- **recordsExport** `PortalRequest & ExportAsk` → `import("@wren/core/records/serve").RecordsFile` (serviceHandler)
- **recordsGet** `PortalRequest & GetAsk` → `import("@wren/core/records/serve").RecordAnswer` (serviceHandler)
- **recordsList** `PortalRequest & ListAsk` → `import("@wren/core/records/serve").RecordsPage` (serviceHandler)
- **recordsStats** `PortalRequest & StatsAsk` → `import("@wren/core/records/serve").RecordsStat` (serviceHandler)
- **recordsTypes** `PortalRequest` → `import("@wren/core/records").RecordMeta[]` (serviceHandler)
- **remind** `IdRequest` → `{ id: string; }` (serviceHandler)
- **send** `IdRequest` → `{ docs: { id: string; status: string; }[]; url: null; why?: never; } | { docs: { id: string; status: string; }[]; url: string | null; why: string | null; }` (serviceHandler)
- **templateArchive** `?` → `?` (serviceHandler)
- **templateSave** `?` → `?` (serviceHandler)
- **templates** `PortalRequest` → `{ templates: { id: string; kind: string; name: string; body: string; lines: import("./lines.js").DocLine[]; depositPct: number | null; expiresDays: number; version: string; }[]; approves: boolean; }` (serviceHandler)
- **update** `?` → `?` (serviceHandler)
- **void** `IdsRequest` → `{ done: number; }` (serviceHandler)
