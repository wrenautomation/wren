---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-26 @ dcdb71d9
entity: packages/core/src/limits.ts:19
---

# limits

Daily limits over the code's defaults: table `limits` in main. Code names each limit and its default (`LimitDef`); a row overrides one. No client: Wren-wide. A client: that client only.

## Why this shape

Limits are config, not secrets: env grew too big (designs/2026-10-26-limits.md). A row is audited, edited in the portal or the CLI, and read at each run's start, so no deploy. The code keeps the default, so an empty table changes nothing. A client row holds only where the spend is the client's own (`scope: "client"`); a shared pool or a Wren-only part takes the Wren-wide row only (`checkOwner`, `limits.ts:125`).

## Shape

- table `limits` (`packages/core/src/limits-schema.ts:21`): `client` null or a client id, `name`, `per_day` >= 0, `burst` null or >= 1, `updated_by`; unique (client, name) nulls not distinct; migration `0347_limits.sql`
- `LimitDef` (`limits.ts:19`): `name`, `unit`, `why`, `perDay`, `burst` (null: a daily count), `scope` client | shared | wren
- order of what holds (`holds`, `limits.ts:53`): client row (scope client only), then Wren-wide row, then the default
- reads: `limitOf`, `bucketOf` (`limits.ts:60`, `:82`), always inside `ctx.run`; writes: `setLimit`, `unsetLimit` (`:138`, `:168`)
- research's defs: `RESEARCH_LIMITS` (`packages/research/src/limits.ts:114`); `collectorsWithLimits`, `googleLimits` (`:130`, `:141`)
- today no research def has scope client: every part is shared or Wren-only

Citations: `packages/core/src/limits.ts:19`, `:53`, `:125`; `packages/research/src/limits.ts:114`

## Connected to

- **owns:** the buckets of [[research/signal]], [[research/team-search]], [[research/social-group]] and the Google day of profiles
- **joins:** [[platform/vendors]] (the portal section sits on Vendors), [[platform/audit-log]] (trigger on the table)
- **looks-like-but-is-not:** [[platform/settings]] (env, typed at start); `wren_settings` (a Wren part's form values); autobrowse's `limits.json` (site and account caps on the Mac, LinkedIn invites)

## If you change this

- **Hits:** a new limit: a `LimitDef` in its package, its list (`RESEARCH_LIMITS`), the worker's `makeAccountsConsole` deps (`apps/worker/src/services/accounts.ts:89`) and the CLI (`apps/cli/src/limits.ts`); the reader passes `bucketOf` into its room call
- **Does not hit:** env, SSM, autobrowse

## Surfaces

| Surface | Role |
|---|---|
| Accounts > Vendors, "Daily limits" (`apps/portal/web/src/modules/account/Limits.tsx`) | team reads; admin (money) writes |
| `wren limits`, `limits set`, `limits unset` (`apps/cli/src/limits.ts`) | reads / writes |
| AccountsConsole `limits`, `setLimit` (`packages/core/src/accounts-console.ts:501`, `:526`) | reads / writes |
| enrichment Restate services, `wren enrich`, CRM run | read at start |

## See

- Source: `packages/core/src/limits.ts`
- Design: `designs/2026-10-26-limits.md`
