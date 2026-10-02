---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-09-30 @ 2fe9568
entity: packages/db/src/audit/schema.ts:26
---

# audit-log

Every change to every table in every database: one `audit_events` row each (who, which row, what changed), chained into `audit_seals` so a later edit shows.

## Why this shape

One trigger function on every table of every schema (`public`, `books`, any new one), installed by code at each migrate, not a numbered migration: a new table is audited by default, and a dropped or disabled trigger comes back. Seals take finished transactions only, in (era, tx, id) order, so a slow transaction's rows are never skipped and a restore onto another server keeps sealing. The worker log keeps each seal's hash, a copy the database cannot rewrite.

## Shape

- `audit_events` (`packages/db/src/audit/schema.ts:26`): `era, tx, table_name, op, row_key, old_values, new_values, db_user, app, actor`; `audit_seals` (`:62`); `audit_eras` (`:78`)
- The SQL: `audit_era()` (`packages/db/src/audit/install.ts:17`); `audit_row()`, `audit_seal()`, `audit_verify()` (`:76`)
- `installAudit` ends every `migrate()` (`packages/db/src/audit/index.ts:87`, `packages/db/src/index.ts:79`); `syncAuditTriggers` (`packages/db/src/audit/index.ts:114`); skip lists `AUDIT_SKIPPED`, `AUDIT_SKIPPED_SCHEMAS` (`:20`, `:39`); outside `public` a table is logged as `schema.table` (`auditName`, `:44`)
- `sealAudit`, `verifyAudit`, `setAuditActor` (`:190`, `:222`, `:249`)
- `AuditSealer/all`: every database, 4 at a time, every 15 min (`packages/core/src/audit.ts:47`, `:78`); registered in `apps/worker/src/services.ts:369`, off until started
- CLI `wren [--client id] audit show|seal|verify|sealer` (`apps/cli/src/main.ts:127`)

Citations: `packages/db/src/audit/schema.ts:26`, `packages/db/src/audit/install.ts:76`, `packages/core/src/audit.ts:47`

## Connected to

- **owns:** nothing; it watches every table card
- **joins:** [[processes/migrate]] (installs and re-syncs each run), [[clients/client-login]] (`db_user` is the client's login)
- **looks-like-but-is-not:** `runs`, the run ledger (stages and costs; skipped here)

## If you change this

- **Hits:** a new table or schema is audited on the next migrate unless listed in `AUDIT_SKIPPED` or `AUDIT_SKIPPED_SCHEMAS`; a changed event line (`audit_event_hash`) breaks every existing seal's verify; the portal sets `actor` per write (`packages/reactivation/src/portal/service.ts:138`)
- **Does not hit:** Restate state; the run ledger

## Surfaces

| Surface | Role |
|---|---|
| every write, any login | appends (trigger) |
| `AuditSealer/all`, `wren audit seal` | seals |
| `wren audit verify [--all]`, `wren audit show` | reads |
| worker log (CloudWatch) | keeps each seal's hash |

## See

- Design: `designs/2026-09-30-client-isolation-and-audit.md`
