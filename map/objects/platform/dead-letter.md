---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-11-09 @ 9a8b862e
entity: packages/core/src/dead-letter-schema.ts:26
---

# dead-letter

One runtime invocation (`rt.invocations`) that used up its retries and paused (`dead_letters`), filed by the `DeadLetterFile/all` loop and ended by `wren dlq retry|kill|drop`.

## Why this shape

A paused call holds its object's lock and moves only when someone acts, so it must not live only in a Discord line. The `rt.invocations` row stays the source of truth for the call; the row is the handle and the history: who ended it, how, and whether it paused again (`designs/2026-10-11-dead-letters.md`). A terminal error is not a letter: it goes back to its caller. An executor step's error is not either: it waits on its event with Replay ([[platform/executor]]).

## Shape

- Table `dead_letters` (`dead-letter-schema.ts:26`): `invocation_id` unique, `target`, `key`, `error`, `invoked_by`, `paused_at`, `told_at`, `ended_at`, `end` (`retried`, `killed`, `dropped`, `cleared`), `ended_by`. Main only. Migration 0225
- Sweep `deadLetterPass` (`dead-letters.ts:188`): SQL over the view `rt_admin.sys_invocation` where `status = 'paused'` (`:26`); the error from the journal when the row has none, else the `Paused` event's last failure; a retried letter that paused again reopens (same id); open rows no longer paused close as `cleared`; one Discord warning per batch of new letters, except desk calls the desk did not take (`deskUnreachable`, `:103`: the Mac asleep), posted silent
- `pausedUnder` (`dead-letters.ts:137`): the paused call under an invocation, walking `invoked_by_id` 5 levels; the content scheduler parks a publish held by one (map/processes/content-loop.md)
- `endDeadLetter` (`dead-letters.ts:311`): `retry` = `runtimeAdmin` patch `/invocations/<id>/resume?deployment=latest` on the row (`packages/runtime/src/pg/admin.ts`) (the newest code, not the deployment it was pinned to), `kill` = `/kill`, `drop` = the row only
- Loop `DeadLetterFile/all` (`dead-letters.ts:336`), every 10 minutes, always wired (`apps/worker/src/services/platform.ts:90`)

Citations: `packages/core/src/dead-letter-schema.ts:26`

## Connected to

- **joins:** the `rt_admin` views `sys_invocation`, `sys_journal`, `sys_journal_events` (Restate's shapes over `rt.*`, `packages/runtime/src/pg/schema.ts:153`) by invocation id
- **looks-like-but-is-not:** an executor step's error (`events.error`, Replay); a loop's failed pass (`runs`, `last`, [[platform/loop-object]]); `scripts/runtime-lag-check.mjs` (late rows and dead leases; not paused ones)

## If you change this

- **Hits:** `wren dlq` (`apps/cli/src/dlq.ts:31`), `docs/operations.md` "Dead letters"
- **Does not hit:** the executor, loops' own retries, the runtime's retry policy (`SERVER_RETRY`)

## Surfaces

| Surface | Role |
|---|---|
| `DeadLetterFile/all` | writes |
| `wren dlq list|show` | reads |
| `wren dlq retry|kill|drop` | writes, drives the runtime |

## See

- Source: `packages/core/src/dead-letters.ts`, `designs/2026-10-11-dead-letters.md`
