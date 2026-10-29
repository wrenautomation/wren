# @wren/documents: routes

Services: 1.

## Documents (service)

File: packages/documents/src/service.ts

- **act** `Req & { act: "sign" | "decline"; fields: Record<string, string> }` → `Answer` (serviceHandler)
- **cancel** `{ id: string; by?: string | null }` → `{ done: boolean; why?: never; did?: never; } | { done: boolean; why: string; did?: never; } | { done: boolean; did: "cancelled" | "deleted" | "kept"; why?: never; }` (serviceHandler)
- **deposit** `Req` → `Answer` (serviceHandler)
- **pdf** `Req` → `Answer` (serviceHandler)
- **send** `{ id: string; remind?: boolean | null; by?: string | null }` → `{ sent: boolean; url: null; why?: never; } | { sent: boolean; why: string; url: null; } | { sent: boolean; url: string; why?: never; }` (serviceHandler)
- **serve** `Req` → `Answer` (serviceHandler)
- **signed** `{ event: string; payload: object }` → `{ ok: boolean; why: string; ignored?: never; } | { ok: boolean; why?: never; ignored?: never; } | { ok: boolean; ignored: string; why?: never; }` (serviceHandler)
