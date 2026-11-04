---
type: process
status: verified
verified: 2026-11-04 + WA-1058 (resend once)
consumes: ["[[email/message]]", "[[email/send-policy]]", "[[email/roster]]", "[[email/sender-pause]]", "[[leads/suppression]]", "[[email/transport]]"]
produces: ["[[email/message]]", "[[email/sender-pause]]", "[[ledger/run]]"]
---

# send-tick

One paced walk of the outbox for one inbox: kill switches, reconcile, then send what may leave right now.

## Input → Movement → Output

Approved messages, the clock, the policy, this sender's pauses. `EmailSend/{sender}` runs `sendTick`: evaluate kill switches, reconcile in-flight rows, then `sendDue` commits `sending` with our Message-ID, calls the transport, records `sent`, `failed` or `unknown`. Then it schedules its next `loop` with a durable delay. A tick that throws 3 times is a failed pass with a backoff, never a parked key (`passOrFailed`).

## Why this shape

Intent before act, so a crash costs at most one message. At least once (2026-11-04, `designs/2026-11-04-at-least-once.md`): a send not in the mailbox after the grace goes back to `approved` once, under the same Message-ID (`tries`, cap 2); a refused send stays `failed`. Follow-ups before openers, one send per enrollment per tick, inside the lead's own window when known.

## Steps

1. `sendTick` (`packages/starling/outbound/src/email/send/tick.ts:81`): switches (`:83`, `inbox/health.ts:166`), then the walk (`:89`).
2. `reconcile` (`send/reconcile.ts:42`).
3. `sendDue` (`send/deliver.ts:190`): per-company clock (`:377`), transitions (`packages/starling/channels/email/src/state.ts:6`).
4. Transport (`send/transport.ts:78`, `send/gmail.ts`; the Gmail wire and service-account tokens are autobrowse's `./google`).
5. Loop and delay (`restate/send-scheduler.ts:80`, on `makeLoopObject`, `packages/core/src/restate/loop.ts:366`). The transport carries its own limits (Gmail `timedFetch`, SMTP socket timeouts); the tick is not cut, since a cut tick could run beside its retry.
6. Test: `packages/starling/outbound/test/integration/email/restate-send-scheduler.test.ts` (a throwing tick: failed pass, chain on, `wake`).

## If you change this

- **Hits:** [[email/message]] states, [[email/sender-pause]], `send_health`, `funnel_latency`
- **Does not hit:** compose; the inbox sync (a separate loop on the same key space)

## Surfaces

| Surface | Role |
|---|---|
| `EmailSend/{sender}` | runs |
| Restate ingress (`docs/restate-operations.md`), `walkthrough/demos/01-loops.sh` | drives |

## See

- Objects: [[email/message]], [[email/transport]]
- Source: `packages/starling/outbound/src/email/send/deliver.ts`
