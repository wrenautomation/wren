# @wren/connectors: routes

Services: 2.

## ConnectorCallback (service)

File: packages/connectors/src/restate.ts

- **land** `z.infer<typeof CONNECTOR_LANDING>` → `{ ok: boolean; said: string; }` (serviceHandler)

## ConnectorSync (object)

File: packages/connectors/src/restate.ts

- **run** `{ chain?: string }` → `{ state: string; people: number; fired: number }` (restate.handlers.object.exclusive)
