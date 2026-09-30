---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-28 @ 83459e9
entity: packages/db/drizzle.config.ts:7
---

# db-schema

Postgres 17 through Drizzle: every package owns its `src/schema.ts` (and `views.ts`), and `drizzle.config.ts` is the only place they meet. Migrations in `packages/db/drizzle/`, 26 so far.

## Why this shape

`@wren/db` stays a leaf: the config lists paths, not imports (`drizzle.config.ts:3`). Casing is `snake_case` on the wire; every enum column carries a `oneOf` check so a bad value is refused by the database, not the app. Views are the read surface for numbers (`packages/channel-email/src/views.ts`, `packages/core/src/views.ts`).

## Shape

- schema files (`drizzle.config.ts:8`–`18`): core, core views, clients, research, channel-email (+views), content, channel-meta, channel-sms, reactivation, books (its own `books` schema)
- `createDb`, `migrate` (`packages/db/src/index.ts:33`, `:77`); `pnpm db:generate`, `pnpm db:migrate` (`package.json:18`)
- CI migrates before it bundles (`.github/workflows/deploy.yml:29`)

Citations: `packages/db/drizzle.config.ts:7`

## Connected to

- **owns:** every table card in this map
- **joins:** [[processes/migrate]], [[platform/audit-log]] (every table is audited unless listed in `AUDIT_SKIPPED`)

## If you change this

- **Hits:** a schema edit needs `db:generate` (a new SQL file) and lands in prod on the next push; a dropped column breaks any view naming it; a new enum value needs its `oneOf`
- **Does not hit:** Restate state (journal and object state live in Restate Cloud, not Postgres)

## Surfaces

| Surface | Role |
|---|---|
| CI (`deploy.yml`) | migrates prod |
| `wren db check` | reads |

## See

- Source: `packages/db/drizzle.config.ts`
