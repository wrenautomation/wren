---
type: object
cluster: platform
universe: live
status: verified
verified: 2026-10-11 @ ec72a24a
entity: packages/core/src/dead-letter-schema.ts:26
---

# dead-letter

One Restate invocation that used up its retries and paused (`dead_letters`), filed by the `DeadLetters/all` loop and ended by `wren dlq retry|kill|drop`.

## Why this shape

A paused call holds its object's lock and moves only when someone acts, so it must not live only in a Discord line. Restate stays the source of truth for the call; the row is the handle and the history: who ended it, how, and whether it paused again (`designs/2026-10-11-dead-letters.md`). A terminal error is not a letter: it goes back to its caller. A spine step's error is not either: it waits on its event with Replay ([[platform/spine]]).

## Shape

- Table `dead_letters` (`dead-letter-schema.ts:26`): `invocation_id` unique, `target`, `key`, `error`, `invoked_by`, `paused_at`, `told_at`, `ended_at`, `end` (`retried`, `killed`, `dropped`, `cleared`), `ended_by`. Main only. Migration 0225
- Sweep `deadLetterPass` (`dead-letters.ts:202`): SQL over `sys_invocation` where `status = 'paused'` (`:40`); the error from the journal when the row has none, else the `Paused` event's last failure; a retried letter that paused again reopens (same id); open rows no longer paused close as `cleared`; one Discord warning per batch of new letters, except desk calls Restate could not deliver (`deskUnreachable`, `:118`: the Mac asleep), posted silent
- `pausedUnder` (`dead-letters.ts:151`): the paused call under an invocation, walking `invoked_by_id` 5 levels; the content scheduler parks a publish held by one (map/processes/content-loop.md)
- `endDeadLetter` (`dead-letters.ts:325`): `retry` = admin `PATCH /invocations/<id>/resume?deployment=latest` (the newest code, not the deployment it was pinned to), `kill` = `/kill`, `drop` = the row only
- Loop `DeadLetters/all` (`dead-letters.ts:350`), every 10 minutes; wired only when `WREN_RESTATE_ADMIN_URL` is set (`apps/worker/src/services.ts:2016`)
- Caddy passes exactly those two PATCH routes with the ingress bearer (`deploy/scripts/box-restate.sh:65`)

Citations: `packages/core/src/dead-letter-schema.ts:26`

## Connected to

- **joins:** Restate's `sys_invocation`, `sys_journal` and `sys_journal_events` by invocation id
- **looks-like-but-is-not:** a spine step's error (`events.error`, Replay); a loop's failed pass (`runs`, `last`, [[platform/loop-object]]); `scripts/restate-lag.mjs` (late timers and calls stuck ready, running or backing off; no longer paused ones)

## If you change this

- **Hits:** `wren dlq` (`apps/cli/src/dlq.ts:32`), the Caddyfile on the box (rerun `box-restate.sh` over SSM), `docs/restate-operations.md` "Dead letters"
- **Does not hit:** the spine, loops' own retries, Restate's retry policy

## Surfaces

| Surface | Role |
|---|---|
| `DeadLetters/all` | writes |
| `wren dlq list|show` | reads |
| `wren dlq retry|kill|drop` | writes, drives Restate |

## See

- Source: `packages/core/src/dead-letters.ts`, `designs/2026-10-11-dead-letters.md`
