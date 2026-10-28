# @wren/payments: routes

Services: 1.

## Payments (service)

File: packages/payments/src/service.ts

- **send** `{ id: string }` → `{ sent: boolean; why?: never; } | { sent: boolean; why: string; }` (serviceHandler)
- **stripe** `{ client: string; raw: string; signature?: string | null }` → `HookAnswer` (serviceHandler)
