# @wren/connectors: routes

Services: 3.

## ConnectorCallback (service)

File: packages/connectors/src/restate.ts

- **land** `z.infer<typeof CONNECTOR_LANDING>` → `{ ok: boolean; said: string; }` (serviceHandler): writes public.connector_fired, public.connector_grants, public.connector_links

## ConnectorSync (object)

File: packages/connectors/src/restate.ts

- **run** `{ chain?: string }` → `{ state: string; people: number; fired: number }` (restate.handlers.object.exclusive): writes public.connector_fired, public.connector_links

## Connectors (service via `portalService`)

File: packages/connectors/src/restate.ts

- **connect** `?` → `?` (serviceHandler): writes public.connector_grants; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **connectors** `?` → `?` (serviceHandler): reads public.client_members, public.clients, public.connector_links, public.grants, public.operators, public.role_grants, public.roles
- **disconnect** `?` → `?` (serviceHandler): writes public.connector_links; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
- **syncNow** `PortalRequest & { id: number }` → `{ ok: boolean; }` (serviceHandler): writes public.connector_fired, public.connector_links; reads public.client_members, public.clients, public.grants, public.operators, public.role_grants, public.roles
