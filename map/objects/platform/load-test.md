---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-11 @ 46ecd7e4
entity: scripts/loadtest.mjs:1
---

# load test

A k6 scenario run on a throwaway local stack to a PASS/FAIL verdict: `pnpm loadtest <scenario>`.

## Why this shape

Performance work needs a target, not a guess (`designs/2026-10-11-load-testing.md`). A scenario's k6 `thresholds` are the success criteria and the exit code is the verdict. The stack is built from source and migrations each run, with a prod-shaped synthetic seed, so a result holds for the code under test. The worker gets an env built from nothing, so a run cannot reach prod.

## Shape

- Runner `scripts/loadtest.mjs`: Postgres 17 (`pg_stat_statements`, `fsync=off`) and Restate in Docker on random ports, migrate, seed, worker on :19080, register, k6, verdict (`:295`)
- Profile: CPU of worker, Postgres, Restate every 2 s (`sample`, `:71`); top statements by database time (`topQueries`, `:109`)
- `--up` (no k6), `--keep`, `--down` (`down`, `:125`, frees the worker port and both containers)
- Worker `WREN_ENV_FILE=none` skips `.env` (`apps/worker/src/main.ts:11`)
- Scenarios `loadtest/scenarios/*.js`, seeds `loadtest/seeds/*.sql`, results `loadtest/results/` (ignored)

Citations: `scripts/loadtest.mjs:1`

## Connected to

- **reads:** [[platform/worker]] (runs it), [[platform/records]] (`portal-reads` calls `ConsolePortal/recordsList`)
- **looks-like-but-is-not:** the integration tests (correctness on one Postgres per package run and a clone per file, no Restate); the drift and schema gates

## If you change this

- **Hits:** nothing in prod; a scenario's thresholds are a decision, so change them in the design doc too
- **Does not hit:** CI (not a gate: it needs Docker, k6 and minutes)

## Surfaces

| Surface | Role |
|---|---|
| `pnpm loadtest` | runs a scenario |

## See

- Source: `scripts/loadtest.mjs`, `loadtest/README.md`, `designs/2026-10-11-load-testing.md`
