---
type: object
cluster: clients
universe: live
status: verified
verified: 2026-10-04 @ 85fad62
entity: packages/core/src/clients/schema.ts:22
---

# client

A firm we do work for: one `clients` row in the main database, pointing at its own database `wren_client_<id>`. Core knows no product; each product parses its own block of `products`.

## Why this shape

Fifty clients must not mean fifty code paths. A client is data: its database, its accounts, its product settings, its members. Its own database keeps one firm's contacts out of every other firm's queries and lets a client be dropped whole.

## Shape

- `clients` (`schema.ts:22`): `id`, `database` (unique), `accounts` (site → autobrowse account), `products` (per-product JSON the product owns), `demo`, `look` (`schema.ts:42`, the portal's look: a preset name or `readTheme` input, often just a brand color; null is Wren's); who signs in is [[clients/client-member]]
- `ConsolePortal.setLook {client, look}` (`packages/core/src/console.ts:600`): an operator's for any client, the demo's too; an owner's for their own only (`isOwner`, `packages/core/src/clients/index.ts:177`). The portal reads it from `delivery/me` and themes the workspace with it; `?theme=` still tries a preset over it. It's edited with `LookEditor` (`packages/ui/src/look.tsx`): Account's Look page for an owner, the Clients app's record for the team
- Each `products` key is an installed component (`packages/core/src/components.ts`, `COMPONENTS` in `apps/worker/src/components.ts`). `ConsolePortal.install|configure|uninstall {client, component, settings}` (operator, each a `runs` row) write it; `ask` lets a client's person ask for one. `delivery/me` lists them as `installed`; the portal shows a client only those apps (`appsIn`, `apps/portal/web/src/modules/index.ts`). The Marketplace app is the catalog (`console.component`)
- `addClient` creates and migrates the database, then writes the row (`packages/core/src/clients/index.ts:42`). Safe to retry: a registered id comes back as it is, a half-made database is migrated again; callers refuse a taken id. `ConsolePortal.addClient {id, name}` runs it in one `ctx.run` step on the worker, which ships the migrations (`apps/worker/scripts/build-lambda.mjs:64`); people are added after with `DeliveryPortal.invite`
- Loop keys: `<client>/<unit>`; a bare key is Wren's own (`packages/core/src/restate`, `clientKey` / `clientOfKey`)

Citations: `packages/core/src/clients/schema.ts:22`, `packages/core/src/clients/index.ts:31`

## Connected to

- **owns:** a whole client database: [[reactivation/crm-contact]], [[reactivation/client-profile]], [[reactivation/handoff]], and the channel tables ([[email/enrollment]], [[email/message]], [[email/thread-event]])
- **owned-by:** nothing (main database)
- **joins:** [[clients/client-member]] (who signs in), [[clients/client-login]] (the Postgres login its database is reached by), [[platform/audit-log]] (every write in its database)
- **looks-like-but-is-not:** [[leads/company]] (a firm we reach, not one we work for)

## If you change this

- **Hits:** `wren clients` (`apps/cli`), the worker's per-client db pool and key routing (`apps/worker/src/services.ts:261`), the portal's login check and its look (`apps/portal/web/src/App.tsx`, `useLook`), every product's settings parser; `client_records` (the `console.client` record, migration 0061)
- **Does not hit:** Wren's own campaign (bare keys, main database)

## Surfaces

| Surface | Role |
|---|---|
| `wren clients add\|list` | writes |
| `ConsolePortal.addClient` (`console.addClient`) | writes |
| `ConsolePortal.setLook` (operator, or the client's owner) | writes `look` |
| `ConsolePortal.install\|configure\|uninstall` (operator), Marketplace | writes `products` |
| `Reactivation/{client}`, portal | reads |

## See

- Design: `designs/2026-09-29-client-reactivation.md`, `designs/2026-10-04-brand-palette.md` (look), `designs/2026-10-04-components-and-marketplace.md` (installs)
