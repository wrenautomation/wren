---
type: process
status: verified
verified: 2026-09-28 @ 28823cd
consumes: ["[[email/message]]", "[[email/send-policy]]", "[[email/roster]]", "[[email/sender-pause]]", "[[leads/suppression]]", "[[email/transport]]"]
produces: ["[[email/message]]", "[[email/sender-pause]]", "[[ledger/run]]"]
---

# send-tick

One paced walk of the outbox for one inbox: kill switches, reconcile, then send what may leave right now.

## Input → Movement → Output

Approved messages, the clock, the policy, this sender's pauses. `SendScheduler/{sender}` runs `sendTick`: evaluate kill switches, reconcile in-flight rows, then `sendDue` commits `sending` with our Message-ID, calls the transport, records `sent`, `failed` or `unknown`. Then it schedules its next `loop` with a durable delay.

## Why this shape

Intent before act, so a crash costs at most one message and never a double send. Ambiguity is a state, not a retry. Follow-ups before openers, one send per enrollment per tick, inside the lead's own window when known.

## Steps

1. `sendTick` (`packages/channel-email/src/send/tick.ts:81`): switches (`:83`, `inbox/health.ts:166`), then the walk (`:89`).
2. `reconcile` (`send/reconcile.ts:42`).
3. `sendDue` (`send/deliver.ts:190`): per-company clock (`:377`), transitions (`packages/channel-email/src/state.ts:6`).
4. Transport (`send/transport.ts:78`, `send/gmail.ts`).
5. Loop and delay (`restate/send-scheduler.ts:1`; primitive `packages/core/src/restate/loop.ts:179`).

## If you change this

- **Hits:** [[email/message]] states, [[email/sender-pause]], `send_health`, `funnel_latency`
- **Does not hit:** compose; the inbox sync (a separate loop on the same key space)

## Surfaces

| Surface | Role |
|---|---|
| `SendScheduler/{sender}` | runs |
| Restate ingress (`docs/restate-operations.md`), `walkthrough/demos/01-loops.sh` | drives |

## See

- Objects: [[email/message]], [[email/transport]]
- Source: `packages/channel-email/src/send/deliver.ts`
