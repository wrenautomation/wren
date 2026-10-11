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
- Sweep `deadLetterPass` (`dead-letters.ts:126`): SQL over `sys_invocation` where `status = 'paused'` (`:37`); the error from the journal when the row has none; a retried letter that paused again reopens (same id); open rows no longer paused close as `cleared`; one Discord warning per batch of new letters
- `endDeadLetter` (`dead-letters.ts:223`): `retry` = admin `PATCH /invocations/<id>/resume`, `kill` = `/kill`, `drop` = the row only
- Loop `DeadLetters/all` (`dead-letters.ts:248`), every 10 minutes; wired only when `WREN_RESTATE_ADMIN_URL` is set (`apps/worker/src/services.ts:2016`)
- Caddy passes exactly those two PATCH routes with the ingress bearer (`deploy/scripts/box-restate.sh:59`)

Citations: `packages/core/src/dead-letter-schema.ts:26`

## Connected to

- **joins:** Restate's `sys_invocation` and `sys_journal` by invocation id
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
