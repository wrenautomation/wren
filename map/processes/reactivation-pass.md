---
type: process
status: verified
verified: 2026-09-29 @ 23a6170
consumes: ["[[clients/client]]", "[[reactivation/crm-contact]]", "[[reactivation/client-profile]]", "[[email/thread-event]]"]
produces: ["[[email/message]]", "[[reactivation/handoff]]", "[[ledger/run]]"]
---

# reactivation-pass

One pass of one client's reactivation: read its settings, run the due CRM stages, forward warm replies, and point its mailbox loops.

## Input → Movement → Output

The client's registry row and database. `Reactivation/{client}` plans from the registry, runs `runCrm` (verify, score, brief, compose) and `forwardHandoffs`, then starts or stops `SendScheduler` / `InboxScheduler` at `<client>/<mailbox>`. It records a run and schedules the next pass.

## Why this shape

One loop per client, keyed by client, so fifty clients are fifty keys, not fifty deploys. The mailboxes follow the settings on every pass, failed or not, so a sender dropped or a client gone stops its loops. `stop` stops every mailbox it started.

## Steps

1. Plan from the registry (`packages/reactivation/src/loop.ts:158`); a failed read settles and notifies (`:160`).
2. Off, demo or gone: point loops at none (`:172`).
3. Work: `runPass` with `runCrm` (`:186`, `run.ts:54`), then `forwardHandoffs` (`:203`).
4. Point mailbox loops (`:212`), tell forwards (`:214`, `:233`).
5. Stop hook `stopLoops` (`:265`); primitive `packages/core/src/restate/loop.ts`.

## If you change this

- **Hits:** [[email/message]] drafts (compose), [[reactivation/handoff]], the client's mailbox loops, `crm loop start|stop|status`
- **Does not hit:** Wren's own `Campaign` loops (bare keys)

## Surfaces

| Surface | Role |
|---|---|
| `Reactivation/{client}` | runs |
| `wren --client <id> crm loop` | drives |

## See

- Objects: [[clients/client]], [[reactivation/handoff]]
- Source: `packages/reactivation/src/loop.ts`
