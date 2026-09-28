---
type: process
status: verified
verified: 2026-09-28 @ 28823cd
consumes: ["[[email/roster]]", "[[email/inbox-sync-cursor]]", "[[email/enrollment]]"]
produces: ["[[email/thread-event]]", "[[leads/suppression]]", "[[email/enrollment]]", "[[email/inbox-sync-cursor]]"]
---

# inbox-sync

Read every fleet mailbox from its cursor, attach what belongs to us, act on it, then label human replies.

## Input → Movement → Output

One sender's mailbox and cursor. `InboxScheduler/{sender}` runs `syncInbox`: classify each message (bounce, receipt, auto-reply, unsubscribe, reply), write one `thread_events` row per Gmail id, apply the stop and suppression that follow, advance the cursor. A pass that found replies sends `Disposition/fleet` a `classify`, which proposes a label and a verbatim quote, gated before it is applied.

## Why this shape

Evidence before action, append-only and idempotent: a lost race gets no row and does not act, so a one-day overlap is free. The LLM writes one column and never a suppression; operators are never overwritten.

## Steps

1. `syncInbox` (`packages/channel-email/src/inbox/sync.ts:660`); inserts at `:422`, `:762`.
2. Pure classification (`inbox/inbound.ts:474`).
3. Stops and suppressions (`packages/core/src/suppress.ts:72`; `ENROLLMENT_TRANSITIONS`, `state.ts:29`).
4. Hand-off to disposition (`restate/inbox-scheduler.ts:66`); `runDisposition` (`inbox/disposition.ts:337`).
5. Opens and Postmaster are sibling reads on their own loops (`inbox/opens.ts:100`, `inbox/postmaster.ts:364`).

## If you change this

- **Hits:** [[email/thread-event]], [[leads/suppression]], the kill switches (bounces), `reply_outcomes`, the digest
- **Does not hit:** the send tick's pacing; stored message text

## Surfaces

| Surface | Role |
|---|---|
| `InboxScheduler/{sender}`, `Disposition/fleet` | run |
| Restate ingress; `wren email reply`, `wren email event` | drive, label |

## See

- Objects: [[email/thread-event]]
- Source: `packages/channel-email/src/inbox/sync.ts`
