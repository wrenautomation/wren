# @wren/connectors: routes

Services: 3.

## ConnectorCallback (service)

File: packages/connectors/src/restate.ts

- **land** `z.infer<typeof CONNECTOR_LANDING>` → `{ ok: boolean; said: string; }` (serviceHandler)

## ConnectorSync (object)

File: packages/connectors/src/restate.ts

- **run** `{ chain?: string }` → `{ state: string; people: number; fired: number }` (restate.handlers.object.exclusive)

## Connectors (service via `portalService`)

File: packages/connectors/src/restate.ts

- **connect** `?` → `?` (serviceHandler)
- **connectors** `?` → `?` (serviceHandler)
- **disconnect** `?` → `?` (serviceHandler)
- **syncNow** `PortalRequest & { id: number }` → `{ ok: boolean; }` (serviceHandler)
