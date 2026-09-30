---
type: object
cluster: clients
universe: live
status: verified
verified: 2026-09-30 @ 2fe9568
entity: packages/db/src/clients.ts:112
---

# client-login

Each client database's own Postgres login, named like the database (`wren_client_<id>`): it opens that database and nothing else.

## Why this shape

A bug that picks the wrong pool, or runs a main query on a client, hits a wall instead of another firm's data. The password is derived from main's (HMAC), so there is no new secret to store or read.

## Shape

- `clientLoginPassword`, `clientDatabaseUrl` (the client's login), `clientAdminUrl` (main's login, database swapped) (`packages/db/src/clients.ts:38`, `:48`, `:60`)
- `grantClientAccess`: role, SCRAM verifier, its own settings cleared, `CONNECT` here only, DML on tables, `USAGE, SELECT` on sequences, audit tables read-only (`:112`)
- `migrateClient` = migrate, then grant; every migrate (`:156`). `createDatabase` closes `PUBLIC` at creation (`:80`)
- Used by the worker's per-client pools (`apps/worker/src/services.ts:171`), `clientUrl` (`packages/core/src/clients/index.ts:118`), `wren audit verify --all` (`apps/cli/src/main.ts:166`)

Citations: `packages/db/src/clients.ts:112`, `packages/db/src/clients.ts:48`

## Connected to

- **owned-by:** [[clients/client]] (one login per client database)
- **joins:** [[platform/audit-log]] (`db_user`), [[processes/migrate]]
- **looks-like-but-is-not:** main's login (a superuser; migrations and grants only)

## If you change this

- **Hits:** the worker's client pools, CLI `--client`, the portal and the sealer all connect as it; main's password change resets every client's on the next migrate
- **Does not hit:** main's tables; Wren's own campaign

## Surfaces

| Surface | Role |
|---|---|
| worker, CLI `--client`, portal, sealer | connect as it |
| `pnpm db:migrate`, `wren clients add` | make and grant it |

## See

- Design: `designs/2026-09-30-client-isolation-and-audit.md`
