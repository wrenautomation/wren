---
type: process
status: verified
verified: 2026-10-03 @ fc9fe66
consumes: ["[[clients/client]]", "[[reactivation/crm-contact]]", "[[reactivation/client-profile]]", "[[email/thread-event]]"]
produces: ["[[email/message]]", "[[reactivation/handoff]]", "[[ledger/run]]", "[[clients/engagement]]"]
---

# reactivation-pass

One pass of one client's reactivation: read its settings, run the due CRM stages, forward warm replies, fill its work portal, and point its mailbox loops.

## Input → Movement → Output

The client's registry row and database. `Reactivation/{client}` plans from the registry, runs `runCrm` (verify, score, brief, compose; `crm run` also does lookup, signals and movers, on the worker's `CrmRun/{client}` so the client's own keys apply, sites legs gated and metered on its share; `crm lookup`, `redraft` and `settle` are its `lookup`, `redraft`, `settle` handlers, `packages/reactivation/src/crm-run.ts`), `forwardHandoffs` and `feedDelivery`, then starts or stops `SendScheduler` / `InboxScheduler` at `<client>/<mailbox>`. It records a run and schedules the next pass.

## Why this shape

One loop per client, keyed by client, so fifty clients are fifty keys, not fifty deploys. The mailboxes follow the settings on every pass, failed or not, so a sender dropped or a client gone stops its loops. `stop` stops every mailbox it started.

## Steps

1. Plan from the registry (`packages/reactivation/src/loop.ts:163`); a failed read settles and notifies (`:167`).
2. Off, demo or gone: point loops at none (`:177`).
3. Work: `runPass` with `runCrm` (`:196`, `run.ts:66`), then `forwardHandoffs` (`:209`).
4. Fill the work portal (`:211`, `delivery.ts:94`): contacts reached, replies and meetings as results, written only when changed; the bill as the meetings note; one timeline line a day on what moved. A failure lands in the pass stats, never fails the pass. A meeting marked in the portal feeds at once (`portal/service.ts:236`).
5. Point mailbox loops (`:221`), tell forwards (`:223`, `:245`).
6. Stop hook `stopLoops` (`:234`); primitive `packages/core/src/restate/loop.ts`.

## If you change this

- **Hits:** [[email/message]] drafts (compose), [[reactivation/handoff]], [[clients/engagement]] results and updates, the client's mailbox loops, `crm loop start|stop|status`
- **Does not hit:** Wren's own `Campaign` loops (bare keys)

## Surfaces

| Surface | Role |
|---|---|
| `Reactivation/{client}` | runs |
| `wren --client <id> crm loop` | drives |

## See

- Objects: [[clients/client]], [[reactivation/handoff]], [[clients/engagement]]
- Source: `packages/reactivation/src/loop.ts`
