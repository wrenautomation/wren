---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/db/drizzle.config.ts:7
---

# db-schema

Postgres 17 through Drizzle: every package owns its `src/schema.ts` (and `views.ts`), and `drizzle.config.ts` is the only place they meet. Migrations in `packages/db/drizzle/`.

## Why this shape

`@wren/db` stays a leaf: the config lists paths, not imports (`drizzle.config.ts:3`). Casing is `snake_case` on the wire; every enum column carries a `oneOf` check so a bad value is refused by the database, not the app. Views are the read surface for numbers (`packages/channel-email/src/views.ts`, `packages/core/src/views.ts`).

## Shape

- schema files (`drizzle.config.ts:8`–`18`): core, core views, clients, research, channel-email (+views), content, channel-meta, channel-sms, reactivation, books (its own `books` schema)
- `createDb`, `migrate` (`packages/db/src/index.ts:33`, `:77`); `pnpm db:generate`, `pnpm db:migrate` (`package.json:18`)
- Isolation per transaction (`packages/db/src/isolation.ts`): `atomic` (read committed), `snapshot` (repeatable read, read only), `serializable` (retries 40001/40P01, 5 tries); inside a transaction, a savepoint. Pick by `designs/2026-10-04-postgres-isolation.md`. Every connection drops a transaction idle 10 min (research units hold one across fetch and LLM calls); prod sets it server-wide (`deploy/pg-settings.sql`).
- Pooling: the worker (Lambda and box) reaches prod through PgBouncer on the box, port 6432, transaction mode, when `WREN_DATABASE_POOL_PORT` is set (`apps/worker/src/services.ts:225`, `deploy/scripts/box-pgbouncer.sh`). The CLI and migrations stay on 5432: a pooled connection can't keep session state, so nothing may use `SET` (session), session advisory locks, `LISTEN` or prepared statements (`prepare: false`). `wren.actor` at startup is refused there; inside a transaction use `setAuditActor`.
- CI migrates before it bundles (`.github/workflows/deploy.yml:29`)
- names: every PK is `pk_<table>`, FK `fk_<table>_<col>_<parent>`, check `ck_`, index `ix_`/`uq_`; `baseColumns.id` carries no `.primaryKey()`, each table names its own. Closed sets are `oneOf(...)` CHECKs paired with a `varchar` enum

Citations: `packages/db/drizzle.config.ts:7`

## Connected to

- **owns:** every table card in this map
- **joins:** [[processes/migrate]], [[platform/audit-log]] (every table is audited unless listed in `AUDIT_SKIPPED`)

## If you change this

- **Hits:** a `serializable` body can run up to 5 times: database work only, no network. A schema edit needs `db:generate` (a new SQL file) and lands in prod on the next push; a dropped column breaks any view naming it; a new enum value needs its `oneOf`
- **Does not hit:** Restate state (journal and object state live in Restate's own data dir on the box, not Postgres)

## Surfaces

| Surface | Role |
|---|---|
| CI (`deploy.yml`) | migrates prod |
| `wren db check` | reads |

## See

- Source: `packages/db/drizzle.config.ts`
