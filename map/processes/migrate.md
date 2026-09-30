---
type: process
status: verified
verified: 2026-09-28 @ 28823cd
consumes: ["[[platform/db-schema]]"]
produces: ["[[platform/db-schema]]"]
---

# migrate

A schema edit in a package's `src/schema.ts` becomes a numbered SQL file, applied to prod by the next deploy.

## Input → Movement → Output

An edited `schema.ts` or `views.ts`. `pnpm db:generate` diffs every listed schema file against the migration history and writes `packages/db/drizzle/NNNN_<name>.sql`; `pnpm db:migrate` applies pending files (locally now, in prod on deploy).

## Why this shape

Every package owns its tables, but there is one migration history, so two channels can never race on the same number. Views live in the same history, so a column drop that breaks a view fails at generate time, not at read time.

## Steps

1. Edit the owning schema file (list at `packages/db/drizzle.config.ts:8`–`16`).
2. `pnpm db:generate` (`package.json:18`); review the SQL under `packages/db/drizzle/`.
3. `pnpm db:migrate` locally; integration tests run on testcontainers.
4. Push; CI migrates prod before bundling (`.github/workflows/deploy.yml:29`).
5. Every `migrate()` then installs the audit log: triggers on every table, append-only guards, eras (`packages/db/src/index.ts:79`). A client database also gets its own login and grants (`packages/db/src/clients.ts:156`).

## If you change this

- **Hits:** [[platform/db-schema]]; the cards of any table touched; [[platform/audit-log]]; [[clients/client-login]]
- **Does not hit:** Restate journals

## Surfaces

| Surface | Role |
|---|---|
| William | edits, generates |
| CI | applies to prod |

## See

- Objects: [[platform/db-schema]]
- Source: `packages/db/drizzle.config.ts`
